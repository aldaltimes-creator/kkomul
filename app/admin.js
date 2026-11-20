// 관리자 화면: 요약, 동화·노래 요청, 회원 목록, 하드북 주문
import { sb, guardConfig, requireUser, h, $, toast } from './lib.js';
import { REQ_STATUS, KIND, PLAN, dt, statusBadge, emptyRow } from './admin-common.js';

if (!guardConfig()) await new Promise(() => {}); // 설정 전에는 여기서 멈춤
await requireUser();

const ORDER_STATUS = { requested: '접수', paid: '결제 완료', printing: '제작 중', shipped: '배송 중', canceled: '취소' };

const { data: isAdmin } = await sb.rpc('is_admin');
if (!isAdmin) {
  $('#denied').hidden = false;
  await new Promise(() => {});
}
$('#admin').hidden = false;

let emails = {}; // user_id → email
const memberLink = (userId, text, hash = '') =>
  h('a', { class: 'link', href: `admin-member.html?id=${userId}${hash}` }, text ?? emails[userId] ?? '회원');

async function loadStats() {
  const { data, error } = await sb.rpc('admin_overview');
  if (error) return toast(`요약을 불러오지 못했어요: ${error.message}`, 'error');
  const plans = Object.entries(data.active_plans ?? {}).map(([k, n]) => `${PLAN[k] ?? k} ${n}`).join(' · ') || '없음';
  const cards = [
    ['새 요청', `${data.requests_new ?? 0}건`, `만드는 중 ${data.requests_making ?? 0}건`, (data.requests_new ?? 0) > 0],
    ['처리할 주문', `${data.orders_open}건`, `전체 ${data.orders_total}건`, data.orders_open > 0],
    ['가입자', `${data.users}명`, `최근 7일 +${data.users_7d}`],
    ['쓰는 이용권', plans, '지금 기간 안에 있는 것'],
    ['이번 달 기록', `${data.records_month}개`, `아이 ${data.children}명`],
    ['이번 달 완성', `동화 ${data.stories_month} · 노래 ${data.songs_month}`, `취소 ${data.failed_month}건`],
  ];
  $('#stats').replaceChildren(...cards.map(([label, value, sub, alert]) =>
    h('div', { class: `stat${alert ? ' stat--alert' : ''}` },
      h('p', { class: 'stat__label' }, label),
      h('p', { class: 'stat__value' }, value),
      h('p', { class: 'muted' }, sub))));
}

async function loadUsers() {
  const { data, error } = await sb.rpc('admin_users', { p_limit: 200 });
  if (error) return toast(`회원을 불러오지 못했어요: ${error.message}`, 'error');
  emails = Object.fromEntries(data.map((u) => [u.id, u.email]));
  $('#users').replaceChildren(...(data.length ? data.map((u) => h('tr', {},
    h('td', {}, dt(u.created_at)),
    h('td', {}, memberLink(u.id, u.email)),
    h('td', {}, u.child_name ?? '–'),
    h('td', {}, PLAN[u.plan_code] ?? '없음'),
    h('td', {}, `${u.records_count ?? 0}개`),
    h('td', {}, u.open_requests ? h('b', { style: 'color:var(--coral-btn)' }, `${u.open_requests}건`) : '–'),
    h('td', {}, dt(u.last_sign_in_at)))) : [emptyRow(7, '아직 가입자가 없어요')]));
}

async function loadRequests() {
  let q = sb.from('creations')
    .select('id, created_at, kind, status, request_note, user_id, records(title, record_date), children(name)')
    .order('created_at', { ascending: $('#req-filter').value === 'open' }).limit(200);
  if ($('#req-filter').value === 'open') q = q.in('status', ['pending', 'making']);
  const { data, error } = await q;
  if (error) return toast(`요청을 불러오지 못했어요: ${error.message}`, 'error');
  $('#requests').replaceChildren(...(data.length ? data.map((c) => h('tr', {},
    h('td', {}, dt(c.created_at)),
    h('td', {}, memberLink(c.user_id)),
    h('td', {}, c.children?.name ?? '–'),
    h('td', {}, c.records ? `${c.records.record_date.slice(5).replace('-', '.')} 「${c.records.title}」` : '–'),
    h('td', {}, KIND[c.kind]),
    h('td', { class: 'cell-wrap' }, c.request_note ?? '–'),
    h('td', {}, statusBadge(c.status)),
    h('td', {}, h('a', { class: 'btn btn--primary btn--sm', href: `admin-member.html?id=${c.user_id}#req-${c.id}` },
      c.status === 'ready' ? '보기' : '만들어 올리기')))) : [emptyRow(8, $('#req-filter').value === 'open' ? '처리할 요청이 없어요' : '아직 요청이 없어요')]));
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
      ...Object.entries(ORDER_STATUS).map(([v, label]) => h('option', { value: v, selected: v === o.status }, label)));
    sel.addEventListener('change', () => setOrderStatus(o, sel));
    return h('tr', {},
      h('td', {}, dt(o.created_at)),
      h('td', {}, h('a', { href: `creation.html?id=${o.creation_id}`, class: 'link' }, `「${o.creations?.title ?? '동화'}」`)),
      h('td', {}, o.cover_name),
      h('td', {}, o.recipient),
      h('td', { class: 'cell-wrap' }, o.phone, h('br'), h('span', { class: 'muted' }, o.address)),
      h('td', {}, memberLink(o.user_id)),
      h('td', {}, sel, o.status_changed_at ? h('p', { class: 'muted', style: 'font-size:12px;margin-top:4px' }, `${dt(o.status_changed_at)} 변경`) : null));
  }) : [emptyRow(7, $('#order-filter').value === 'open' ? '처리할 주문이 없어요' : '아직 주문이 없어요')]));
}

async function setOrderStatus(order, sel) {
  const next = sel.value;
  if (next === 'canceled' && !confirm(`「${order.creations?.title ?? '동화'}」 주문을 취소로 바꿀까요?`)) {
    sel.value = order.status;
    return;
  }
  sel.disabled = true;
  const { error } = await sb.from('book_orders').update({ status: next }).eq('id', order.id);
  sel.disabled = false;
  if (error) { sel.value = order.status; return toast(`바꾸지 못했어요: ${error.message}`, 'error'); }
  toast(`주문 상태를 '${ORDER_STATUS[next]}'(으)로 바꿨어요`);
  await Promise.all([loadOrders(), loadStats()]);
}

async function loadAll() {
  await loadUsers(); // 이메일 표를 먼저 채움
  await Promise.all([loadStats(), loadRequests(), loadOrders()]);
}

$('#req-filter').addEventListener('change', loadRequests);
$('#order-filter').addEventListener('change', loadOrders);
$('#reload').addEventListener('click', loadAll);

// 새 요청·주문이 들어오면 화면을 자동으로 새로 고침
sb.channel('admin-live')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'creations' }, () => {
    toast('새 동화·노래 요청이 들어왔어요');
    loadAll();
  })
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'book_orders' }, () => {
    toast('새 하드북 주문이 들어왔어요');
    loadAll();
  })
  .subscribe();

loadAll();
