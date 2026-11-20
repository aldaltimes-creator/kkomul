-- ============================================================
-- 꼬물상자 '요청 → 관리자가 만들어 올림' 구조
-- schema.sql, admin.sql 다음에 실행하세요. 여러 번 실행해도 안전해요.
--
-- 흐름: 사용자가 기록으로 동화·노래를 '요청' (이용권 횟수 1 차감)
--      → 관리자에게 알림 → 관리자가 외부에서 만든 글·그림·음원·링크를 올림
--      → 상태를 '완료'로 바꾸면 사용자 화면에 보임
-- ============================================================

-- ---------- 작품(요청) 테이블 확장 ----------
alter table public.creations add column if not exists request_note text;
alter table public.creations add column if not exists media jsonb not null default '[]'::jsonb; -- [{type:'image'|'audio', path, name}]
alter table public.creations add column if not exists external_url text;
alter table public.creations add column if not exists updated_at timestamptz;
alter table public.creations add column if not exists notified_at timestamptz;

alter table public.creations drop constraint if exists creations_request_note_check;
alter table public.creations add constraint creations_request_note_check check (request_note is null or char_length(request_note) <= 500);
alter table public.creations drop constraint if exists creations_external_url_check;
alter table public.creations add constraint creations_external_url_check check (external_url is null or external_url ~* '^https?://');

-- 상태: pending(요청됨) → making(만드는 중) → ready(완료) / failed(취소·실패, 횟수 돌려줌)
alter table public.creations drop constraint if exists creations_status_check;
alter table public.creations add constraint creations_status_check check (status in ('pending', 'making', 'ready', 'failed'));

-- 사용자가 요청을 지워서 횟수를 되돌리지 못하게 (취소는 관리자가 'failed'로)
drop policy if exists "own delete" on public.creations;
revoke delete on public.creations from authenticated;

create or replace function public.touch_creation()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists creations_touch on public.creations;
create trigger creations_touch before update on public.creations
  for each row execute function public.touch_creation();

-- ---------- 요청하기 (남은 횟수 확인 + 요청 행 만들기, 동시에 눌러도 한 번만 차감) ----------
create or replace function public.request_creation(p_record uuid, p_kind text, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_rec   records;
  v_sub   subscriptions;
  v_plan  plans;
  v_used  integer;
  v_limit integer;
  v_id    uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  if p_kind not in ('story', 'song') then raise exception '동화 또는 노래만 요청할 수 있어요'; end if;

  select * into v_rec from records where id = p_record and user_id = auth.uid();
  if not found then raise exception '기록을 찾을 수 없어요'; end if;

  select * into v_sub from subscriptions
   where user_id = auth.uid() and status = 'active' and now() between starts_at and ends_at
   order by starts_at desc limit 1
   for update;
  if not found then raise exception 'NO_PLAN'; end if;

  select * into v_plan from plans where code = v_sub.plan_code;
  select count(*) into v_used from creations
   where subscription_id = v_sub.id and kind = p_kind and status <> 'failed';
  v_limit := case when p_kind = 'story' then v_plan.stories else v_plan.songs end;
  if v_used >= v_limit then raise exception 'NO_CREDIT'; end if;

  insert into creations (user_id, child_id, record_id, subscription_id, kind, status, request_note)
  values (auth.uid(), v_rec.child_id, v_rec.id, v_sub.id, p_kind, 'pending',
          nullif(left(trim(coalesce(p_note, '')), 500), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.request_creation(uuid, text, text) from public, anon;
grant execute on function public.request_creation(uuid, text, text) to authenticated;

-- ---------- 관리자: 작품 내용·상태를 채우고 바꿀 수 있음 ----------
grant update (title, content, status, media, external_url, error) on public.creations to authenticated;
drop policy if exists "admin update" on public.creations;
create policy "admin update" on public.creations for update
  using (public.is_admin()) with check (public.is_admin());

-- ---------- 저장소: 관리자는 사용자 사진을 볼 수 있음 ----------
drop policy if exists "admin photos read" on storage.objects;
create policy "admin photos read" on storage.objects for select to authenticated
  using (bucket_id = 'record-photos' and public.is_admin());

-- ---------- 저장소: 관리자가 올리는 그림·음원 (creation-media, 비공개) ----------
-- 경로: {사용자 id}/{작품 id}/{파일}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creation-media', 'creation-media', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/ogg'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "creation media read"   on storage.objects;
drop policy if exists "creation media insert" on storage.objects;
drop policy if exists "creation media update" on storage.objects;
drop policy if exists "creation media delete" on storage.objects;
create policy "creation media read" on storage.objects for select to authenticated
  using (bucket_id = 'creation-media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "creation media insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'creation-media' and public.is_admin());
create policy "creation media update" on storage.objects for update to authenticated
  using (bucket_id = 'creation-media' and public.is_admin());
create policy "creation media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'creation-media' and public.is_admin());

-- ---------- 관리자 요약: 처리할 요청 수 추가 ----------
create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '관리자만 볼 수 있어요'; end if;
  return jsonb_build_object(
    'users',           (select count(*) from auth.users),
    'users_7d',        (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'children',        (select count(*) from children),
    'records_month',   (select count(*) from records where created_at >= date_trunc('month', now())),
    'active_plans',    (select coalesce(jsonb_object_agg(plan_code, n), '{}'::jsonb)
                          from (select plan_code, count(*) n from subscriptions
                                 where status = 'active' and now() between starts_at and ends_at
                                 group by plan_code) x),
    'requests_new',    (select count(*) from creations where status = 'pending'),
    'requests_making', (select count(*) from creations where status = 'making'),
    'stories_month',   (select count(*) from creations where kind = 'story' and status = 'ready' and created_at >= date_trunc('month', now())),
    'songs_month',     (select count(*) from creations where kind = 'song'  and status = 'ready' and created_at >= date_trunc('month', now())),
    'failed_month',    (select count(*) from creations where status = 'failed' and created_at >= date_trunc('month', now())),
    'orders_open',     (select count(*) from book_orders where status in ('requested', 'paid', 'printing')),
    'orders_total',    (select count(*) from book_orders where status <> 'canceled')
  );
end $$;

-- ---------- 관리자 회원 목록: 기록 수, 처리할 요청 수 추가 ----------
drop function if exists public.admin_users(integer);
create function public.admin_users(p_limit integer default 100)
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz,
               child_name text, plan_code text, records_count integer, open_requests integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '관리자만 볼 수 있어요'; end if;
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at,
           (select c.name from children c where c.user_id = u.id order by c.created_at limit 1),
           (select s.plan_code from subscriptions s
             where s.user_id = u.id and s.status = 'active' and now() between s.starts_at and s.ends_at
             order by s.starts_at desc limit 1),
           (select count(*)::int from records r where r.user_id = u.id),
           (select count(*)::int from creations k where k.user_id = u.id and k.status in ('pending', 'making'))
      from auth.users u
     order by u.created_at desc
     limit least(greatest(p_limit, 1), 500);
end $$;
revoke all on function public.admin_users(integer) from public, anon;
grant execute on function public.admin_users(integer) to authenticated;

-- ---------- 새 요청 → 관리자 알림 (notify-order 함수가 요청 알림도 보냄) ----------
create or replace function private.notify_new_request()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url     := (select value from private.settings where key = 'notify_url'),
    body    := jsonb_build_object('creation_id', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select value from private.settings where key = 'anon_key'))
  );
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists creations_notify on public.creations;
create trigger creations_notify after insert on public.creations
  for each row when (new.status = 'pending') execute function private.notify_new_request();

-- 관리자 화면이 새 요청을 실시간으로 받도록
do $$
begin
  alter publication supabase_realtime add table public.creations;
exception when duplicate_object then null;
end $$;
