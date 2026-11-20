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
        c.status === 'ready'
          ? h('a', { class: 'btn btn--ghost btn--sm', href: `creation.html?id=${c.id}`, target: '_blank' }, '사용자 화면 보기 ↗')
          : (c.content?.pages?.length || c.content?.lines?.length)
            && h('a', { class: 'btn btn--ghost btn--sm', href: `creation.html?id=${c.id}&preview=1`, target: '_blank' }, '미리보기 ↗')));
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
  form.querySelectorAll('[data-only="song"]').forEach((el) => { el.hidden = isStory; });
  form.querySelectorAll('[data-only="story"]').forEach((el) => { el.hidden = !isStory; });
  form.querySelector('[data-only="failed"]').hidden = form.status.value !== 'failed';
  $('#file-hint').textContent = '음원(MP3·M4A·WAV)과 커버 그림. 최대 50MB';
  $('#media-input').accept = 'audio/*,image/*';
}
form.status.addEventListener('change', syncFields);

// ---------------------------------------------------------------- 동화 쪽 편집 (쪽마다 그림 + 글)
// 그림 칸: { path } 저장된 그림 | { file, url } 새로 고른 그림 | null
let pages = [];        // [{ text, img }]
let cover = null;
let storedUrls = {};   // 저장된 그림의 서명 주소

const imgSrc = (img) => img && (img.url ?? storedUrls[img.path]);
const MAX = 50 * 1024 * 1024;
const imageFile = (file) => {
  if (!file.type.startsWith('image/')) { toast(`${file.name}: 그림 파일만 넣을 수 있어요`, 'error'); return null; }
  if (file.size > MAX) { toast(`${file.name}: 50MB까지 올릴 수 있어요`, 'error'); return null; }
  return { file, url: URL.createObjectURL(file) };
};
const pickImage = (onPick) => {
  const input = h('input', { type: 'file', accept: 'image/*' });
  input.addEventListener('change', () => { const img = input.files[0] && imageFile(input.files[0]); if (img) onPick(img); });
  input.click();
};

function imageSlot(img, { label, onPick, onRemove, wide = false }) {
  const src = imgSrc(img);
  return h('div', { class: `img-slot${wide ? ' img-slot--wide' : ''}` },
    src
      ? h('img', { src, alt: label })
      : h('button', { type: 'button', class: 'img-slot__empty', onclick: () => pickImage(onPick) }, '＋ 그림 넣기'),
    src && h('div', { class: 'img-slot__bar' },
      h('button', { type: 'button', class: 'btn--text', onclick: () => pickImage(onPick) }, '바꾸기'),
      h('button', { type: 'button', class: 'btn--text', onclick: onRemove }, '빼기')));
}

function renderPages() {
  $('#cover-slot').replaceChildren(imageSlot(cover, {
    label: '표지 그림', wide: true,
    onPick: (img) => { cover = img; renderPages(); },
    onRemove: () => { cover = null; renderPages(); },
  }));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= pages.length) return; [pages[i], pages[j]] = [pages[j], pages[i]]; renderPages(); };
  $('#page-editor').replaceChildren(...(pages.length ? pages.map((p, i) => h('li', { class: 'page-ed' },
    h('div', { class: 'page-ed__num' }, `${i + 1}쪽`),
    imageSlot(p.img, {
      label: `${i + 1}쪽 그림`,
      onPick: (img) => { p.img = img; renderPages(); },
      onRemove: () => { p.img = null; renderPages(); },
    }),
    (() => {
      const ta = h('textarea', { class: 'textarea page-ed__text', rows: 4, maxlength: 600, placeholder: `${i + 1}쪽 글` });
      ta.value = p.text;
      ta.addEventListener('input', () => { p.text = ta.value; });
      return ta;
    })(),
    h('div', { class: 'page-ed__tools' },
      h('button', { type: 'button', class: 'btn--text', disabled: i === 0, onclick: () => move(i, -1), 'aria-label': `${i + 1}쪽 위로` }, '↑'),
      h('button', { type: 'button', class: 'btn--text', disabled: i === pages.length - 1, onclick: () => move(i, 1), 'aria-label': `${i + 1}쪽 아래로` }, '↓'),
      h('button', { type: 'button', class: 'btn--text', onclick: () => {
        if ((p.text.trim() || p.img) && !confirm(`${i + 1}쪽을 지울까요?`)) return;
        pages.splice(i, 1); renderPages();
      } }, '지우기'))))
    : [h('li', { class: 'muted page-ed--empty' }, '아직 쪽이 없어요. ‘+ 쪽 추가’나 ‘그림 여러 장 한 번에 넣기’로 시작하세요.')]));
}

$('#page-add').addEventListener('click', () => { pages.push({ text: '', img: null }); renderPages(); });
$('#page-bulk').addEventListener('change', (e) => {
  const files = [...e.target.files].sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
  e.target.value = '';
  for (const file of files) {
    const img = imageFile(file);
    if (!img) continue;
    const empty = pages.find((p) => !p.img);
    if (empty) empty.img = img; else pages.push({ text: '', img });
  }
  renderPages();
});
$('#page-split').addEventListener('click', () => {
  const raw = prompt('동화 글 전체를 붙여 넣으세요. 빈 줄마다 한 쪽으로 나눠요.\n(이미 있는 쪽에 차례로 들어가고, 남으면 쪽을 새로 만들어요)');
  if (!raw?.trim()) return;
  raw.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).forEach((t, i) => {
    if (pages[i]) pages[i].text = t; else pages.push({ text: t, img: null });
  });
  renderPages();
});

async function loadStoryPages(c) {
  const images = (c.media ?? []).filter((m) => m.type === 'image');
  storedUrls = await signed('creation-media', images.map((m) => m.path));
  const saved = c.content?.pages ?? [];
  const hasPageImages = saved.some((p) => p.image);
  // 예전 방식(그림을 올린 순서대로 쪽에 붙임)으로 저장된 것도 쪽마다 나눠서 불러옴
  const legacy = hasPageImages ? [] : images.filter((m) => m.path !== c.content?.cover);
  const count = Math.max(saved.length, legacy.length);
  pages = Array.from({ length: count }, (_, i) => ({
    text: saved[i]?.text ?? '',
    img: saved[i]?.image ? { path: saved[i].image } : legacy[i] ? { path: legacy[i].path } : null,
  }));
  cover = c.content?.cover ? { path: c.content.cover } : null;
  if (!pages.length) pages = [{ text: '', img: null }];
  renderPages();
}

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
  if (c.kind === 'story') {
    pages = []; cover = null;
    renderPages();
    loadStoryPages(c);
  }
  $('#edit-dialog').showModal();
}

// 새로 고른 그림 하나 올리기 → 저장 경로
async function uploadOne(c, file, uploaded) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${c.user_id}/${c.id}/${Date.now()}-${uploaded.length + 1}.${ext}`;
  const { error } = await sb.storage.from('creation-media').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`${file.name} 올리기 실패: ${error.message}`);
  uploaded.push({ type: 'image', path, name: file.name });
  return path;
}

// 동화 저장: 쪽마다 그림 경로를 content.pages[].image 에 넣고, 안 쓰게 된 그림은 지움
async function saveStory(c, status, uploaded) {
  const used = async (img) => (!img ? null : img.path ?? await uploadOne(c, img.file, uploaded));
  const outPages = [];
  for (const p of pages) {
    const text = p.text.trim();
    const image = await used(p.img);
    if (text || image) outPages.push(image ? { text, image } : { text });
  }
  const coverPath = await used(cover);
  const keep = new Set([...outPages.map((p) => p.image).filter(Boolean), coverPath].filter(Boolean));
  const old = (c.media ?? []).filter((m) => m.type === 'image');
  const nextMedia = [
    ...old.filter((m) => keep.has(m.path)),
    ...uploaded.filter((u) => keep.has(u.path)),
  ];
  return {
    content: { pages: outPages, ...(coverPath ? { cover: coverPath } : {}) },
    media: nextMedia,
    drop: old.filter((m) => !keep.has(m.path)).map((m) => m.path),
  };
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
    const hasBody = c.kind === 'story'
      ? (pages.some((p) => p.text.trim() || p.img) || form.external_url.value.trim())
      : (content.lines?.length || media.length || added.length || form.external_url.value.trim());
    if (!form.elements.title.value.trim()) return toast('완료로 바꾸려면 제목을 적어 주세요', 'error');
    if (!hasBody) return toast('완료로 바꾸려면 글, 파일, 외부 링크 중 하나는 있어야 해요', 'error');
  }
  if (status === 'failed' && !confirm('이 요청을 취소할까요? 사용자의 남은 횟수가 1 돌아가요.')) return;

  await busy(e.submitter, '저장하는 중…', async () => {
    const uploaded = [];
    try {
      if (c.kind === 'story') {
        const story = await saveStory(c, status, uploaded);
        const { error } = await sb.from('creations').update({
          status,
          title: form.elements.title.value.trim() || null,
          content: story.content,
          media: story.media,
          external_url: form.external_url.value.trim() || null,
          error: status === 'failed' ? (form.error.value.trim() || '요청이 취소됐어요') : null,
        }).eq('id', c.id);
        if (error) throw new Error(`저장하지 못했어요: ${error.message}`);
        if (story.drop.length) await sb.storage.from('creation-media').remove(story.drop);
        $('#edit-dialog').close();
        toast(status === 'ready' ? '완료! 사용자 앨범에서 책처럼 보여요' : `'${REQ_STATUS[status]}'(으)로 저장했어요`);
        await loadRequests();
        return;
      }
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
