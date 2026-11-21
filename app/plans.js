// 이용권 고르기 (결제 연동 전 시험용 활성화) + 하드북 주문 목록
import { sb, guardConfig, requireUser, h, $, toast, won, creditStatus, busy } from './lib.js';

if (!guardConfig()) await new Promise(() => {}); // 설정 전에는 여기서 멈춤
const user = await requireUser();

const ORDER_STATUS = { requested: '접수', paid: '결제 완료', printing: '제작 중', shipped: '배송 중', canceled: '취소' };
const OFFER_CODES = ['beta_tester', 'story_once', 'song_once', 'story_song_bundle'];
const selectedOffer = new URLSearchParams(location.search).get('plan');

async function render() {
  const [{ data: plans, error }, credit, { data: betaClaims, error: betaError }] = await Promise.all([
    sb.from('plans').select('*').in('code', OFFER_CODES),
    creditStatus().catch(() => null),
    sb.from('subscriptions').select('id').eq('user_id', user.id).eq('plan_code', 'beta_tester').limit(1),
  ]);
  if (error) return toast(`불러오지 못했어요: ${error.message}`, 'error');

  $('#current').textContent = credit
    ? `지금: ${credit.plan_name} · 동화 ${credit.stories_left}편, 노래 ${credit.songs_left}곡 남음 · ${new Date(credit.ends_at).toLocaleDateString('ko-KR')}까지`
    : '지금 쓰는 이용권이 없어요.';

  plans.sort((a, b) => OFFER_CODES.indexOf(a.code) - OFFER_CODES.indexOf(b.code));

  $('#plan-list').replaceChildren(...(plans.length ? plans.map((p) => {
    const isCurrent = credit?.plan_code === p.code && (credit.stories_left > 0 || credit.songs_left > 0);
    const bundle = p.code === 'story_song_bundle';
    if (p.code === 'beta_tester') {
      const used = Boolean(betaClaims?.length);
      return h('li', { class: 'plan plan--trial', id: p.code },
        h('div', {},
          h('p', { class: 'plan__name' }, p.name),
          h('p', { class: 'plan__price' }, h('b', {}, '무료')),
          h('p', {}, `${p.period_days}일 동안 동화 ${p.stories}편과 노래 ${p.songs}곡을 요청할 수 있어요. 계정당 한 번 받을 수 있어요.`)),
        h('button', { class: 'btn btn--primary plan__btn', type: 'button', disabled: isCurrent || used || Boolean(betaError),
          onclick: (e) => activate(p, e.currentTarget, credit),
        }, isCurrent ? '사용 중' : used ? '이미 받았어요' : betaError ? '이용권 확인 중' : '무료로 받기'));
    }
    return h('li', { class: `plan${bundle ? ' plan--best' : ''}`, id: p.code },
      bundle && h('p', { class: 'plan__badge' }, '동시 요청'),
      h('p', { class: 'plan__name' }, p.name),
      h('p', { class: 'plan__price' }, h('b', {}, p.price.toLocaleString('ko-KR')), '원 ', h('span', {}, '/ 1회')),
      h('ul', { class: 'plan__list' },
        p.stories > 0 && h('li', {}, `동화 ${p.stories}편`),
        p.songs > 0 && h('li', {}, `노래 ${p.songs}곡`),
        bundle && h('li', { class: 'is-plus' }, '동화와 노래를 연결한 영상 파일 제공 ',
          h('a', { class: 'link', href: '../index.html#samples' }, '(예시 참조)')),
        bundle && h('li', {}, '요청 시 YouTube 주소 제공')),
      h('button', {
        class: `btn ${bundle ? 'btn--primary' : 'btn--ghost'} plan__btn`, type: 'button', disabled: isCurrent,
        onclick: (e) => activate(p, e.currentTarget, credit),
      }, isCurrent ? '사용 중' : '시험용으로 켜기'),
    );
  }) : [h('li', { class: 'notice' }, '새 제작 이용권이 아직 준비되지 않았어요.')]));
  if (OFFER_CODES.includes(selectedOffer)) document.getElementById(selectedOffer)?.scrollIntoView({ block: 'center' });

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
  const action = plan.code === 'beta_tester' ? '무료 사전 체험단 이용권을 받을까요?' : `${plan.name}을 시험용으로 켤까요?`;
  const msg = credit ? `${action} 지금 쓰는 ${credit.plan_name}은 종료되고 남은 횟수는 사라져요.` : action;
  if (!confirm(msg)) return;
  await busy(btn, '켜는 중…', async () => {
    const { error } = await sb.rpc('activate_plan', { p_plan: plan.code });
    if (error) return toast(`켜지 못했어요: ${error.message}`, 'error');
    toast(`${plan.name}을 켰어요`);
    await render();
  });
}

render();
