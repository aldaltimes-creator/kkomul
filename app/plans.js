// 이용권 고르기 (결제 연동 전 시험용 활성화) + 하드북 주문 목록
import { sb, guardConfig, requireUser, h, $, toast, won, creditStatus, busy } from './lib.js';

if (!guardConfig()) await new Promise(() => {}); // 설정 전에는 여기서 멈춤
const user = await requireUser();

const ORDER_STATUS = { requested: '접수', paid: '결제 완료', printing: '제작 중', shipped: '배송 중', canceled: '취소' };
const FOR = {
  beta_tester: '서비스를 열기 전에 먼저 써 보고 의견을 주시는 분께',
  trial_once: '어떤지 한 번만 먼저 보고 싶을 때',
  trial_month: '한 달 동안 기록하며 여러 편 받아 보고 싶을 때',
  monthly: '아이의 매달을 계속 모아 두고 싶을 때',
};

async function render() {
  const [{ data: plans, error }, credit, { data: mySubs }] = await Promise.all([
    sb.from('plans').select('*').order('price'),
    creditStatus().catch(() => null),
    sb.from('subscriptions').select('plan_code').eq('user_id', user.id),
  ]);
  const used = new Set((mySubs ?? []).map((s) => s.plan_code));
  if (error) return toast(`불러오지 못했어요: ${error.message}`, 'error');

  $('#current').textContent = credit
    ? `지금: ${credit.plan_name} · 동화 ${credit.stories_left}편, 노래 ${credit.songs_left}곡 남음 · ${new Date(credit.ends_at).toLocaleDateString('ko-KR')}까지`
    : '지금 쓰는 이용권이 없어요.';

  const order = ['beta_tester', 'trial_once', 'trial_month', 'monthly'];
  plans.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));

  $('#plan-list').replaceChildren(...plans.map((p) => {
    const isCurrent = credit?.plan_code === p.code;
    const best = p.code === 'monthly';
    const free = p.price === 0;
    const usedFree = free && used.has(p.code) && !isCurrent;
    return h('li', { class: `plan${best ? ' plan--best' : ''}${free ? ' plan--free' : ''}` },
      best && h('p', { class: 'plan__badge' }, '추천'),
      free && h('p', { class: 'plan__badge plan__badge--free' }, '사전 체험단'),
      h('p', { class: 'plan__name' }, p.name),
      free
        ? h('p', { class: 'plan__price' }, h('b', {}, '무료'))
        : h('p', { class: 'plan__price' }, p.is_subscription ? '월 ' : '', h('b', {}, p.price.toLocaleString('ko-KR')), '원'),
      h('p', { class: 'plan__for' }, FOR[p.code] ?? ''),
      h('ul', { class: 'plan__list' },
        h('li', {}, `${p.is_subscription ? '매달 ' : ''}동화 ${p.stories}편`),
        h('li', {}, `${p.is_subscription ? '매달 ' : ''}노래 ${p.songs}곡`),
        p.saves_album ? h('li', { class: 'is-plus' }, '앨범이 계속 저장돼요') : h('li', { class: 'is-no' }, '앨범 저장 안 됨')),
      h('button', {
        class: `btn ${best || free ? 'btn--primary' : 'btn--ghost'} plan__btn`, type: 'button', disabled: isCurrent || usedFree,
        onclick: (e) => activate(p, e.currentTarget, credit),
      }, isCurrent ? '사용 중' : usedFree ? '이미 받았어요' : free ? '무료로 받기' : '시험용으로 켜기'),
      free && h('p', { class: 'plan__save' }, '계정마다 한 번만 받을 수 있어요'),
    );
  }));

  const { data: orders } = await sb.from('book_orders')
    .select('id, cover_name, price, status, created_at, creations(title)').eq('user_id', user.id)
    .order('created_at', { ascending: false });
  $('#orders').replaceChildren(...(orders?.length
    ? orders.map((o) => h('div', { class: 'order' },
        h('div', {}, h('b', {}, `「${o.creations?.title ?? '동화'}」`), h('p', { class: 'muted' }, `표지 이름 ${o.cover_name} · ${new Date(o.created_at).toLocaleDateString('ko-KR')}`)),
        h('div', { style: 'text-align:right' }, h('b', {}, ORDER_STATUS[o.status] ?? o.status), h('p', { class: 'muted' }, won(o.price)))))
    : [h('p', { class: 'muted' }, '아직 주문이 없어요.')]));
}

async function activate(plan, btn, credit) {
  const msg = credit
    ? `지금 쓰는 ${credit.plan_name}을 끝내고 ${plan.name}을 시작할까요? 남은 횟수는 사라져요.`
    : plan.price === 0 ? `${plan.name} 무료 이용권을 받을까요? 계정마다 한 번만 받을 수 있어요.` : `${plan.name}을 시험용으로 켤까요?`;
  if (!confirm(msg)) return;
  await busy(btn, '켜는 중…', async () => {
    const { error } = await sb.rpc('activate_plan', { p_plan: plan.code });
    if (error) return toast(`켜지 못했어요: ${error.message}`, 'error');
    toast(`${plan.name}을 켰어요`);
    await render();
  });
}

render();
