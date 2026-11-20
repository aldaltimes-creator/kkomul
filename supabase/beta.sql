-- ============================================================
-- 사전 체험단 무료 이용권
-- 0원 · 동화 3편 · 노래 3곡 · 30일 · 앨범 저장. 계정마다 한 번만 받을 수 있어요.
-- 여러 번 실행해도 안전해요.
-- ============================================================
insert into public.plans (code, name, price, stories, songs, saves_album, is_subscription, period_days)
values ('beta_tester', '사전 체험단', 0, 3, 3, true, false, 30)
on conflict (code) do update set
  name = excluded.name, price = excluded.price, stories = excluded.stories, songs = excluded.songs,
  saves_album = excluded.saves_album, is_subscription = excluded.is_subscription, period_days = excluded.period_days;

-- 이용권 켜기: 무료 이용권은 계정마다 한 번만
create or replace function public.activate_plan(p_plan text)
returns public.subscriptions
language plpgsql security definer set search_path = public as $$
declare
  v_plan plans;
  v_sub  subscriptions;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  select * into v_plan from plans where code = p_plan;
  if not found then raise exception '없는 요금제예요'; end if;

  if v_plan.price = 0 and exists (
    select 1 from subscriptions where user_id = auth.uid() and plan_code = v_plan.code
  ) then
    raise exception '% 이용권은 계정마다 한 번만 받을 수 있어요', v_plan.name;
  end if;

  -- 쓰던 이용권은 끝내고 새로 시작
  update subscriptions set status = 'expired'
   where user_id = auth.uid() and status = 'active';

  insert into subscriptions (user_id, plan_code, starts_at, ends_at, is_demo)
  values (auth.uid(), v_plan.code, now(), now() + make_interval(days => v_plan.period_days), v_plan.price > 0)
  returning * into v_sub;
  return v_sub;
end $$;
