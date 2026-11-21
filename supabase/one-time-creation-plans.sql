-- schema.sql, admin.sql, requests.sql 적용 후 실행합니다.
begin;

-- 기존 이용권은 이미 활성화한 계정의 남은 횟수 계산에 계속 사용합니다.
insert into public.plans (code, name, price, stories, songs, saves_album, is_subscription, period_days) values
  ('story_once', '동화 제작', 20000, 1, 0, true, false, 30),
  ('song_once', '노래 제작', 10000, 0, 1, true, false, 30),
  ('story_song_bundle', '동화 + 노래 제작', 30000, 1, 1, true, false, 30)
on conflict (code) do update set
  name = excluded.name, price = excluded.price, stories = excluded.stories, songs = excluded.songs,
  saves_album = excluded.saves_album, is_subscription = excluded.is_subscription, period_days = excluded.period_days;

alter table public.creations add column if not exists bundle_id uuid;
alter table public.creations add column if not exists bundle_youtube_requested boolean not null default false;
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'video/mp4')
where id = 'creation-media' and allowed_mime_types is not null
  and not ('video/mp4' = any(allowed_mime_types));

create or replace function public.request_creation_bundle(
  p_record uuid, p_note text default null, p_youtube boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_plan text;
  v_subscription uuid;
  v_bundle uuid := gen_random_uuid();
  v_existing_bundle uuid;
  v_existing_kind text;
  v_story uuid;
  v_song uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  select id, plan_code into v_subscription, v_plan from public.subscriptions
   where user_id = auth.uid() and status = 'active' and now() between starts_at and ends_at
   order by starts_at desc limit 1 for update;
  if v_plan is distinct from 'story_song_bundle' then raise exception 'NO_BUNDLE_PLAN'; end if;

  select bundle_id, kind into v_existing_bundle, v_existing_kind
    from public.creations
   where subscription_id = v_subscription and record_id = p_record
     and status <> 'failed' and bundle_id is not null
   order by created_at, id limit 1;
  if found then
    -- 한 작품만 취소된 경우, 같은 기록의 취소된 종류를 다시 요청할 수 있습니다.
    v_bundle := v_existing_bundle;
    if v_existing_kind = 'story' then
      v_song := public.request_creation(p_record, 'song', p_note);
    else
      v_story := public.request_creation(p_record, 'story', p_note);
    end if;
  else
    -- 한 종류라도 남은 횟수가 없으면 두 요청을 모두 되돌립니다.
    v_story := public.request_creation(p_record, 'story', p_note);
    v_song := public.request_creation(p_record, 'song', p_note);
  end if;
  update public.creations
     set bundle_id = v_bundle, bundle_youtube_requested = coalesce(p_youtube, false)
   where id in (v_story, v_song) or (bundle_id = v_bundle and status <> 'failed');
  return v_bundle;
end $$;
revoke all on function public.request_creation_bundle(uuid, text, boolean) from public, anon;
grant execute on function public.request_creation_bundle(uuid, text, boolean) to authenticated;

commit;
