// 관리자 화면: 요약, 하드북 주문 상태 바꾸기, 만들기 실패, 최근 가입자
import { sb, guardConfig, requireUser, h, $, toast, won } from './lib.js';

if (!guardConfig()) await new Promise(() => {}); // 설정 전에는 여기서 멈춤
await requireUser();

const STATUS = { requested: '접수', paid: '결제 완료', printing: '제작 중', shipped: '배송 중', canceled: '취소' };
const PLAN = { trial_once: '1회 체험권', trial_month: '1개월 체험권', monthly: '월간 구독' };
const KIND = { story: '동화', song: '노래' };
const dt = (s) => (s ? new Date(s).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');

const { data: isAdmin } = await sb.rpc('is_admin');
if (!isAdmin) {
  $('#denied').hidden = false;
  await new Promise(() => {});
}
$('#admin').hidden = false;

let emails = {}; // user_id → email

async function loadStats() {
  const { data, error } = await sb.rpc('admin_overview');
  if (error) return toast(`요약을 불러오지 못했어요: ${error.message}`, 'error');
  const plans = Object.entries(data.active_plans ?? {}).map(([k, n]) => `${PLAN[k] ?? k} ${n}`).join(' · ') || '없음';
  const cards = [
    ['가입자', `${data.users}명`, `최근 7일 +${data.users_7d}`],
    ['쓰는 이용권', plans, '지금 기간 안에 있는 것'],
    ['이번 달 기록', `${data.records_month}개`, `아이 ${data.children}명`],
    ['이번 달 만든 작품', `동화 ${data.stories_month} · 노래 ${data.songs_month}`, `실패 ${data.failed_month}건`],
    ['처리할 주문', `${data.orders_open}건`, `전체 ${data.orders_total}건`],
  ];
  $('#stats').replaceChildren(...cards.map(([label, value, sub], i) =>
    h('div', { class: `stat${i === 4 && data.orders_open ? ' stat--alert' : ''}` },
      h('p', { class: 'stat__label' }, label),
      h('p', { class: 'stat__value' }, value),
      h('p', { class: 'muted' }, sub))));
}

async function loadUsers() {
  const { data, error } = await sb.rpc('admin_users', { p_limit: 50 });
  if (error) return toast(`가입자를 불러오지 못했어요: ${error.message}`, 'error');
  emails = Object.fromEntries(data.map((u) => [u.id, u.email]));
  $('#users').replaceChildren(...(data.length ? data.map((u) => h('tr', {},
    h('td', {}, dt(u.created_at)),
    h('td', {}, u.email),
    h('td', {}, u.child_name ?? '–'),
    h('td', {}, PLAN[u.plan_code] ?? '없음'),
    h('td', {}, dt(u.last_sign_in_at)))) : [emptyRow(5, '아직 가입자가 없어요')]));
}

function emptyRow(cols, text) {
  return h('tr', {}, h('td', { colspan: cols, class: 'muted', style: 'text-align:center;padding:24px' }, text));
}

async function loadOrders() {
  let q = sb.from('book_orders')
    .select('id, created_at, cover_name, recipient, phone, address, price, status, status_changed_at, user_id, creation_id, creations(title)')
    .order('created_at', { ascending: false }).limit(100);
  if ($('#order-filter').value === 'open') q = q.in('status', ['requested', 'paid', 'printing']);
  const { data, error } = await q;
  if (error) return toast(`주문을 불러오지 못했어요: ${error.message}`, 'error');

  $('#orders').replaceChildren(...(data.length ? data.map((o) => {
    const sel = h('select', { class: 'input input--sm', 'aria-label': `「${o.creations?.title ?? ''}」 주문 상태` },
      ...Object.entries(STATUS).map(([v, label]) => h('option', { value: v, selected: v === o.status }, label)));
    sel.addEventListener('change', () => setStatus(o, sel));
    return h('tr', {},
      h('td', {}, dt(o.created_at)),
      h('td', {}, h('a', { href: `creation.html?id=${o.creation_id}`, class: 'link' }, `「${o.creations?.title ?? '동화'}」`)),
      h('td', {}, o.cover_name),
      h('td', {}, o.recipient),
      h('td', { class: 'cell-wrap' }, o.phone, h('br'), h('span', { class: 'muted' }, o.address)),
      h('td', {}, emails[o.user_id] ?? '–'),
      h('td', {}, sel, o.status_changed_at ? h('p', { class: 'muted', style: 'font-size:12px;margin-top:4px' }, `${dt(o.status_changed_at)} 변경`) : null));
  }) : [emptyRow(7, $('#order-filter').value === 'open' ? '처리할 주문이 없어요' : '아직 주문이 없어요')]));
}

async function setStatus(order, sel) {
  const next = sel.value;
  if (next === 'canceled' && !confirm(`「${order.creations?.title ?? '동화'}」 주문을 취소로 바꿀까요?`)) {
    sel.value = order.status;
    return;
  }
  sel.disabled = true;
  const { error } = await sb.from('book_orders').update({ status: next }).eq('id', order.id);
  sel.disabled = false;
  if (error) { sel.value = order.status; return toast(`바꾸지 못했어요: ${error.message}`, 'error'); }
  toast(`주문 상태를 '${STATUS[next]}'(으)로 바꿨어요`);
  await Promise.all([loadOrders(), loadStats()]);
}

async function loadFails() {
  const { data, error } = await sb.from('creations')
    .select('created_at, kind, error, user_id').eq('status', 'failed')
    .order('created_at', { ascending: false }).limit(20);
  if (error) return;
  $('#fails').replaceChildren(...(data.length ? data.map((c) => h('tr', {},
    h('td', {}, dt(c.created_at)),
    h('td', {}, KIND[c.kind]),
    h('td', { class: 'cell-wrap' }, c.error ?? '–'),
    h('td', {}, emails[c.user_id] ?? '–'))) : [emptyRow(4, '실패한 작품이 없어요')]));
}

async function loadAll() {
  await loadUsers(); // 이메일 표를 먼저 채움
  await Promise.all([loadStats(), loadOrders(), loadFails()]);
}

$('#order-filter').addEventListener('change', loadOrders);
$('#reload').addEventListener('click', loadAll);

// 새 주문이 들어오면 화면을 자동으로 새로 고침
sb.channel('admin-orders')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'book_orders' }, () => {
    toast('새 하드북 주문이 들어왔어요');
    loadAll();
  })
  .subscribe();

loadAll();
