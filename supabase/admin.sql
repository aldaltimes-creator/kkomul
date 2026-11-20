-- ============================================================
-- 꼬물상자 관리자 기능 + 새 하드북 주문 알림
-- schema.sql 을 먼저 실행한 뒤, 이 파일을 SQL Editor에서 실행하세요.
-- 여러 번 실행해도 안전해요.
-- ============================================================

-- ---------- 관리자 목록 (API로는 아무도 읽거나 쓸 수 없음. SQL Editor에서만 관리) ----------
create table if not exists public.admin_emails (
  email      text primary key,
  created_at timestamptz not null default now()
);
alter table public.admin_emails enable row level security;
revoke all on public.admin_emails from anon, authenticated;

-- 관리자 추가 예시 (이메일을 바꿔서 실행):
-- insert into public.admin_emails (email) values ('admin@example.com') on conflict do nothing;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from admin_emails
     where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------- 관리자는 모든 행을 읽을 수 있음 (기존 '본인 것만' 규칙과 OR 로 합쳐짐) ----------
do $$
declare t text;
begin
  foreach t in array array['children', 'records', 'moments', 'subscriptions', 'creations', 'book_orders'] loop
    execute format('drop policy if exists "admin read" on public.%I', t);
    execute format('create policy "admin read" on public.%I for select using (public.is_admin())', t);
  end loop;
end $$;

-- 관리자는 하드북 주문의 '상태'만 바꿀 수 있음
grant update (status) on public.book_orders to authenticated;
drop policy if exists "admin update" on public.book_orders;
create policy "admin update" on public.book_orders for update
  using (public.is_admin()) with check (public.is_admin());

-- 주문 상태가 바뀐 시각 기록
alter table public.book_orders add column if not exists status_changed_at timestamptz;
alter table public.book_orders add column if not exists notified_at timestamptz;

create or replace function public.touch_order_status()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then new.status_changed_at := now(); end if;
  return new;
end $$;
drop trigger if exists book_orders_touch on public.book_orders;
create trigger book_orders_touch before update on public.book_orders
  for each row execute function public.touch_order_status();

-- 관리자 화면이 새 주문을 실시간으로 받도록 (이미 들어 있으면 넘어감)
do $$
begin
  alter publication supabase_realtime add table public.book_orders;
exception when duplicate_object then null;
end $$;

-- ---------- 관리자 화면용 요약 ----------
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
    'stories_month',   (select count(*) from creations where kind = 'story' and status = 'ready' and created_at >= date_trunc('month', now())),
    'songs_month',     (select count(*) from creations where kind = 'song'  and status = 'ready' and created_at >= date_trunc('month', now())),
    'failed_month',    (select count(*) from creations where status = 'failed' and created_at >= date_trunc('month', now())),
    'orders_open',     (select count(*) from book_orders where status in ('requested', 'paid', 'printing')),
    'orders_total',    (select count(*) from book_orders where status <> 'canceled')
  );
end $$;

-- 관리자 화면용: 사용자 이메일 (auth.users 는 API로 직접 못 읽으므로)
create or replace function public.admin_users(p_limit integer default 50)
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, child_name text, plan_code text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '관리자만 볼 수 있어요'; end if;
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at,
           (select c.name from children c where c.user_id = u.id order by c.created_at limit 1),
           (select s.plan_code from subscriptions s
             where s.user_id = u.id and s.status = 'active' and now() between s.starts_at and s.ends_at
             order by s.starts_at desc limit 1)
      from auth.users u
     order by u.created_at desc
     limit least(greatest(p_limit, 1), 200);
end $$;

revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_users(integer) from public, anon;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_users(integer) to authenticated;

-- ============================================================
-- 새 하드북 주문 → notify-order Edge Function 호출 → 관리자에게 알림
-- ============================================================
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from anon, authenticated;
create table if not exists private.settings (key text primary key, value text not null);
alter table private.settings enable row level security; -- 정책 없음: API로는 접근 불가, 트리거(소유자 권한)만 읽음

-- 함수 주소와 anon 키(공개 키)를 저장. 프로젝트가 바뀌면 이 두 값을 고쳐 주세요.
insert into private.settings (key, value) values
  ('notify_url', 'https://bsmcvcchvpeuunarnpvq.supabase.co/functions/v1/notify-order'),
  ('anon_key',   'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzbWN2Y2NodnBldXVuYXJucHZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxNDc2MTAsImV4cCI6MjExMDcyMzYxMH0.n_9xCH_bRO4sbUiBw2xrcIVllQizcKUZ9HoCGBkXTi0')
on conflict (key) do update set value = excluded.value;

create or replace function private.notify_new_order()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url     := (select value from private.settings where key = 'notify_url'),
    body    := jsonb_build_object('order_id', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select value from private.settings where key = 'anon_key'))
  );
  return new;
exception when others then
  -- 알림이 실패해도 주문 접수는 막지 않음
  return new;
end $$;

drop trigger if exists book_orders_notify on public.book_orders;
create trigger book_orders_notify after insert on public.book_orders
  for each row execute function private.notify_new_order();
