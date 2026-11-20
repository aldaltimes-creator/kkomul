// 관리자: 회원별 화면 (아이, 기록·사진, 이달의 순간, 요청, 주문) + 요청한 작품 만들어 올리기
import { sb, guardConfig, requireUser, h, $, toast, fmtDate, ageLabel, busy } from './lib.js';
import { REQ_STATUS, KIND, PLAN, dt, statusBadge, emptyRow } from './admin-common.js';

if (!guardConfig()) await new Promise(() => {}); // 설정 전에는 여기서 멈춤
await requireUser();

const { data: isAdmin } = await sb.rpc('is_admin');
if (!isAdmin) { $('#denied').hidden = false; await new Promise(() => {}); }

const userId = new URLSearchParams(location.search).get('id');
if (!userId) location.replace('admin.html');
$('#member').hidden = false;

const ORDER_STATUS = { requested: '접수', paid: '결제 완료', printing: '제작 중', shipped: '배송 중', canceled: '취소' };
const state = { records: [], requests: [], photoUrls: {} };

// 사진·파일 서명 주소 (1시간)
async function signed(bucket, paths) {
  if (!paths.length) return {};
  const { data } = await sb.storage.from(bucket).createSignedUrls(paths, 3600);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}

// ---------------------------------------------------------------- 회원 정보
async function loadHead() {
  const [{ data: users }, { data: children }, { data: subs }] = await Promise.all([
    sb.rpc('admin_users', { p_limit: 500 }),
    sb.from('children').select('*').eq('user_id', userId).order('created_at'),
    sb.from('subscriptions').select('plan_code, starts_at, ends_at, status, is_demo').eq('user_id', userId).order('starts_at', { ascending: false }),
  ]);
  const u = (users ?? []).find((x) => x.id === userId);
  $('#m-email').textContent = u?.email ?? '알 수 없는 회원';
  document.title = `${u?.email ?? '회원'} — 꼬물상자 관리`;
  $('#m-meta').textContent = u ? `가입 ${dt(u.created_at)} · 마지막 로그인 ${dt(u.last_sign_in_at)}` : '';

  const now = Date.now();
  const active = (subs ?? []).find((s) => s.status === 'active' && new Date(s.starts_at) <= now && now <= new Date(s.ends_at));
  $('#m-plan').replaceChildren(active
    ? h('div', {}, h('p', { class: 'plan-box__name' }, `${PLAN[active.plan_code]}${active.is_demo ? ' (시험용)' : ''}`),
        h('p', { class: 'muted' }, `${new Date(active.ends_at).toLocaleDateString('ko-KR')}까지`))
    : h('p', { class: 'plan-box__name' }, '쓰는 이용권 없음'));

  $('#m-child').replaceChildren(...((children ?? []).length ? children.map((c) =>
    h('div', { class: 'member-child__row' },
      h('b', {}, `${c.name}${ageLabel(c.birth_date) ? ` · ${ageLabel(c.birth_date)}` : ''}`),
      c.birth_date && h('span', { class: 'muted' }, `생일 ${c.birth_date}`),
      c.likes.length > 0 && h('span', {}, `좋아하는 것: ${c.likes.join(', ')}`),
      c.family_call && h('span', {}, `가족 호칭: ${c.family_call}`)))
    : [h('p', { class: 'muted' }, '아직 아이를 소개하지 않았어요')]));
}

// ---------------------------------------------------------------- 기록
async function loadRecords() {
  const { data } = await sb.from('records').select('*').eq('user_id', userId)
    .order('record_date', { ascending: false }).order('created_at', { ascending: false });
  state.records = data ?? [];
  state.photoUrls = await signed('record-photos', state.records.flatMap((r) => r.photo_paths));
  $('#m-rec-count').textContent = `${state.records.length}개`;
  $('#m-records').replaceChildren(...(state.records.length ? state.records.map((r) => recordBlock(r))
    : [h('p', { class: 'muted' }, '아직 기록이 없어요')]));
}

function recordBlock(r, compact = false) {
  return h('article', { class: `card arec${compact ? ' arec--compact' : ''}`, id: compact ? null : `rec-${r.id}` },
    h('p', { class: 'rec__date' }, `${fmtDate(r.record_date)} · 올린 날 ${dt(r.created_at)}`),
    h('h3', { class: 'rec__title' }, r.title),
    h('p', { class: 'rec__text' }, r.happened),
    r.child_words && h('p', { class: 'rec__words' }, `“${r.child_words}”`),
    r.worry && h('p', { class: 'rec__worry' }, h('b', {}, '힘들어하는 것 '), r.worry),
    r.photo_paths.length > 0 && h('div', { class: 'arec__photos' }, ...r.photo_paths.map((p, i) => state.photoUrls[p]
      ? h('a', { href: state.photoUrls[p], target: '_blank', rel: 'noopener', title: '원본 크게 보기' },
          h('img', { src: state.photoUrls[p], alt: `${r.title} 사진 ${i + 1}`, loading: 'lazy' }))
      : null)));
}

// ---------------------------------------------------------------- 이달의 순간, 주문
async function loadMomentsOrders() {
  const [{ data: moments }, { data: orders }] = await Promise.all([
    sb.from('moments').select('*').eq('user_id', userId).order('month', { ascending: false }),
    sb.from('book_orders').select('created_at, recipient, phone, address, status, creations(title)').eq('user_id', userId).order('created_at', { ascending: false }),
  ]);
  $('#m-moments').replaceChildren(...((moments ?? []).length ? moments.map((m) => h('tr', {},
    h('td', {}, m.month.slice(0, 7).replace('-', '년 ') + '월'),
    h('td', { class: 'cell-wrap' }, m.favorite_word ?? '–'),
    h('td', { class: 'cell-wrap' }, m.first_word ?? '–'),
    h('td', { class: 'cell-wrap' }, m.first_action ?? '–'))) : [emptyRow(4, '아직 적은 순간이 없어요')]));
  $('#m-orders').replaceChildren(...((orders ?? []).length ? orders.map((o) => h('tr', {},
    h('td', {}, dt(o.created_at)),
    h('td', {}, `「${o.creations?.title ?? '동화'}」`),
    h('td', {}, o.recipient),
    h('td', { class: 'cell-wrap' }, o.phone, h('br'), h('span', { class: 'muted' }, o.address)),
    h('td', {}, ORDER_STATUS[o.status]))) : [emptyRow(5, '주문이 없어요')]));
}

// ---------------------------------------------------------------- 요청
async function loadRequests() {
  const { data } = await sb.from('creations').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  state.requests = data ?? [];
  $('#m-requests').replaceChildren(...(state.requests.length ? state.requests.map((c) => {
    const rec = state.records.find((r) => r.id === c.record_id);
    const pages = c.content?.pages?.length ?? 0;
    const lines = c.content?.lines?.length ?? 0;
    const files = (c.media ?? []).length;
    return h('article', { class: `card areq${['pending', 'making'].includes(c.status) ? ' areq--open' : ''}`, id: `req-${c.id}` },
      h('div', { class: 'areq__head' },
        h('b', {}, `${KIND[c.kind]} 요청`), statusBadge(c.status),
        h('span', { class: 'muted' }, `요청 ${dt(c.created_at)}${c.updated_at ? ` · 수정 ${dt(c.updated_at)}` : ''}`)),
      h('p', {}, rec ? `기록: ${fmtDate(rec.record_date)} 「${rec.title}」` : '기록: (지워진 기록)'),
      c.request_note && h('p', { class: 'areq__note' }, `바라는 점: ${c.request_note}`),
      c.title && h('p', {}, `제목: 「${c.title}」 · ${c.kind === 'story' ? `${pages}쪽` : `가사 ${lines}줄`} · 파일 ${files}개${c.external_url ? ' · 외부 링크 있음' : ''}`),
      h('div', { class: 'areq__actions' },
        h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => openEditor(c) },
          c.status === 'ready' ? '고치기' : '만들어 올리기'),
        c.status === 'ready' && h('a', { class: 'btn btn--ghost btn--sm', href: `creation.html?id=${c.id}`, target: '_blank' }, '사용자 화면 보기 ↗')));
  }) : [h('p', { class: 'muted' }, '아직 요청이 없어요')]));
}

// ---------------------------------------------------------------- 만들어 올리기
const form = $('#edit-form');
let editing = null;   // 편집 중인 요청
let media = [];       // 저장돼 있는 파일 [{type, path, name}]
let removed = [];     // 저장할 때 지울 파일 경로
let added = [];       // 새로 고른 파일 [{file, type}]

function syncFields() {
  const isStory = editing.kind === 'story';
  form.querySelector('[data-only="song"]').hidden = isStory;
  form.querySelector('[data-only="failed"]').hidden = form.status.value !== 'failed';
  $('#text-label').firstChild.textContent = isStory ? '동화 글 ' : '노래 가사 ';
  $('#text-label small').textContent = isStory ? '쪽마다 빈 줄로 나눠 주세요' : '한 줄에 한 소절씩';
  $('#file-hint').textContent = isStory
    ? '그림(JPG·PNG·WEBP). 올린 순서대로 1쪽, 2쪽에 붙어요'
    : '음원(MP3·M4A·WAV)과 커버 그림. 최대 50MB';
  $('#media-input').accept = isStory ? 'image/*' : 'audio/*,image/*';
}
form.status.addEventListener('change', syncFields);

function renderMedia() {
  $('#media-list').replaceChildren(
    ...media.map((m, i) => h('li', {},
      h('span', {}, `${m.type === 'audio' ? '🎵' : '🖼'} ${m.name ?? m.path.split('/').pop()}`),
      h('button', { type: 'button', class: 'btn--text', onclick: () => { removed.push(m.path); media.splice(i, 1); renderMedia(); } }, '빼기'))),
    ...added.map((a, i) => h('li', {},
      h('span', {}, `${a.type === 'audio' ? '🎵' : '🖼'} ${a.file.name} (새 파일)`),
      h('button', { type: 'button', class: 'btn--text', onclick: () => { added.splice(i, 1); renderMedia(); } }, '빼기'))),
  );
}

$('#media-input').addEventListener('change', (e) => {
  for (const file of e.target.files) {
    const type = file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('image/') ? 'image' : null;
    if (!type) { toast(`${file.name}: 그림이나 음원만 올릴 수 있어요`, 'error'); continue; }
    if (file.size > 50 * 1024 * 1024) { toast(`${file.name}: 50MB까지 올릴 수 있어요`, 'error'); continue; }
    added.push({ file, type });
  }
  e.target.value = '';
  renderMedia();
});

function openEditor(c) {
  editing = c;
  media = [...(c.media ?? [])];
  removed = [];
  added = [];
  const rec = state.records.find((r) => r.id === c.record_id);
  $('#edit-title').textContent = `${KIND[c.kind]} 만들어 올리기`;
  $('#edit-source').replaceChildren(
    h('p', { class: 'source__label' }, '요청한 기록'),
    rec ? recordBlock(rec, true) : h('p', { class: 'muted' }, '(지워진 기록)'),
    c.request_note ? h('p', { class: 'areq__note' }, `바라는 점: ${c.request_note}`) : '');

  form.reset();
  form.status.value = c.status === 'pending' ? 'making' : c.status;
  form.elements.title.value = c.title ?? '';
  form.mood.value = c.content?.mood ?? '';
  form.text.value = c.kind === 'story'
    ? (c.content?.pages ?? []).map((p) => p.text).join('\n\n')
    : (c.content?.lines ?? []).join('\n');
  form.external_url.value = c.external_url ?? '';
  form.error.value = c.error ?? '';
  syncFields();
  renderMedia();
  $('#edit-dialog').showModal();
}

form.addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  if (!form.reportValidity()) return;
  const c = editing;
  const status = form.status.value;
  const text = form.text.value.trim();
  const content = c.kind === 'story'
    ? { pages: text ? text.split(/\n\s*\n/).map((t) => ({ text: t.trim() })).filter((p) => p.text) : [] }
    : { mood: form.mood.value.trim(), lines: text ? text.split('\n').map((l) => l.trim()).filter(Boolean) : [] };

  if (status === 'ready') {
    const hasBody = (content.pages?.length || content.lines?.length || media.length || added.length || form.external_url.value.trim());
    if (!form.elements.title.value.trim()) return toast('완료로 바꾸려면 제목을 적어 주세요', 'error');
    if (!hasBody) return toast('완료로 바꾸려면 글, 파일, 외부 링크 중 하나는 있어야 해요', 'error');
  }
  if (status === 'failed' && !confirm('이 요청을 취소할까요? 사용자의 남은 횟수가 1 돌아가요.')) return;

  await busy(e.submitter, '저장하는 중…', async () => {
    const uploaded = [];
    try {
      for (const a of added) {
        const ext = (a.file.name.split('.').pop() || (a.type === 'audio' ? 'mp3' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `${c.user_id}/${c.id}/${Date.now()}-${uploaded.length + 1}.${ext}`;
        const { error } = await sb.storage.from('creation-media').upload(path, a.file, { contentType: a.file.type, upsert: false });
        if (error) throw new Error(`${a.file.name} 올리기 실패: ${error.message}`);
        uploaded.push({ type: a.type, path, name: a.file.name });
      }
      const { error } = await sb.from('creations').update({
        status,
        title: form.elements.title.value.trim() || null,
        content,
        media: [...media, ...uploaded],
        external_url: form.external_url.value.trim() || null,
        error: status === 'failed' ? (form.error.value.trim() || '요청이 취소됐어요') : null,
      }).eq('id', c.id);
      if (error) throw new Error(`저장하지 못했어요: ${error.message}`);
      if (removed.length) await sb.storage.from('creation-media').remove(removed);
    } catch (err) {
      if (uploaded.length) await sb.storage.from('creation-media').remove(uploaded.map((u) => u.path));
      return toast(err.message, 'error');
    }
    $('#edit-dialog').close();
    toast(status === 'ready' ? '완료! 사용자 앨범에 보여요' : `'${REQ_STATUS[status]}'(으)로 저장했어요`);
    await loadRequests();
  });
});

// ---------------------------------------------------------------- 시작
await loadHead();
await loadRecords();
await Promise.all([loadRequests(), loadMomentsOrders()]);

// 알림 메일의 링크(#req-…)로 들어오면 그 요청으로 이동해 바로 편집
const target = location.hash.startsWith('#req-') && document.getElementById(location.hash.slice(1));
if (target) {
  target.scrollIntoView({ block: 'center' });
  target.classList.add('is-target');
}
