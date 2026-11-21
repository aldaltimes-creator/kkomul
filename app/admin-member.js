// 관리자: 회원별 화면 (아이, 기록·사진, 이달의 순간, 요청, 주문) + 요청한 작품 만들어 올리기
import { sb, guardConfig, requireUser, h, $, toast, fmtDate, ageLabel, busy, songCoverPath } from './lib.js';
import { REQ_STATUS, KIND, PLAN, dt, statusBadge, emptyRow, historyDate, historySummary } from './admin-common.js';
import { renderPdfPages } from './story-pdf.js';
import { formatLyrics, parseLyrics } from './song-lyrics.js';

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
  const [{ data, error }, history] = await Promise.all([
    sb.from('creations').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    sb.from('creation_upload_history').select('creation_id, occurred_at, added_count, removed_count, published, status')
      .eq('member_id', userId).order('occurred_at', { ascending: false }).order('id', { ascending: false }),
  ]);
  if (error) return toast(`요청을 불러오지 못했어요: ${error.message}`, 'error');
  const byRequest = new Map();
  for (const event of history.data ?? []) {
    if (!byRequest.has(event.creation_id)) byRequest.set(event.creation_id, []);
    byRequest.get(event.creation_id).push(event);
  }
  state.requests = data ?? [];
  $('#m-requests').replaceChildren(...(state.requests.length ? state.requests.map((c) => {
    const rec = state.records.find((r) => r.id === c.record_id);
    const pages = c.content?.pages?.length ?? 0;
    const lines = c.content?.lines?.length ?? 0;
    const files = (c.media ?? []).length;
    const uploaded = files > 0 || pages > 0 || lines > 0 || Boolean(c.external_url);
    const canEditFiles = c.status === 'ready' || uploaded;
    const events = byRequest.get(c.id) ?? [];
    const lastUpload = events.find((event) => event.added_count > 0);
    const publication = events.find((event) => event.published);
    return h('article', { class: `card areq${['pending', 'making'].includes(c.status) ? ' areq--open' : ''}`, id: `req-${c.id}` },
      h('div', { class: 'areq__head' },
        h('b', {}, `${KIND[c.kind]} 요청`), statusBadge(c.status),
        h('span', { class: 'badge', dataset: { status: uploaded ? 'ready' : 'pending' } },
          uploaded ? '업로드됨' : '업로드 전'),
        h('span', { class: 'muted' }, `요청 ${dt(c.created_at)}${c.updated_at ? ` · 수정 ${dt(c.updated_at)}` : ''}`)),
      h('p', {}, rec ? `기록: ${fmtDate(rec.record_date)} 「${rec.title}」` : '기록: (지워진 기록)'),
      c.bundle_id && h('p', { class: 'muted' }, c.bundle_youtube_requested ? '동화 + 노래 동시 요청 · YouTube 주소 요청' : '동화 + 노래 동시 요청'),
      c.request_note && h('p', { class: 'areq__note' }, `바라는 점: ${c.request_note}`),
      c.title && h('p', {}, `제목: 「${c.title}」 · ${c.kind === 'story' ? `${pages}쪽` : `가사 ${lines}줄`} · 파일 ${files}개${c.external_url ? ' · 외부 링크 있음' : ''}`),
      uploaded && h('p', { class: 'muted' },
        lastUpload ? `최근 파일 업로드 ${historyDate(lastUpload.occurred_at)}`
          : !files && events.length ? `최근 작품 저장 ${historyDate(events[0].occurred_at)}`
          : c.updated_at ? `업로드 시각 미기록 · 마지막 변경 ${historyDate(c.updated_at)}` : '업로드 시각 미기록',
        c.status === 'ready' && publication ? ` · 공개 ${historyDate(publication.occurred_at)}` : ''),
      (uploaded || events.length > 0) && h('details', { class: 'upload-history' },
        h('summary', {}, '작품 이력'),
        events.length > 0
          ? h('ul', { class: 'upload-history__list' }, events.map((event) =>
            h('li', {}, h('time', { datetime: event.occurred_at }, historyDate(event.occurred_at)),
              h('span', {}, historySummary(event)), statusBadge(event.status))))
          : h('p', { class: 'muted' }, history.error ? '업로드 이력을 불러올 수 없어요.' : '기록된 이력이 없어요. 다음 변경부터 표시됩니다.')),
      h('div', { class: 'areq__actions' },
        h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => openEditor(c) },
          canEditFiles ? '작품·파일 수정' : '만들어 올리기'),
        c.status === 'ready'
          ? h('a', { class: 'btn btn--ghost btn--sm', href: `creation.html?id=${c.id}`, target: '_blank' }, '사용자 화면 보기 ↗')
          : (c.content?.pages?.length || c.content?.lines?.length || c.media?.length)
            && h('a', { class: 'btn btn--ghost btn--sm', href: `creation.html?id=${c.id}&preview=1`, target: '_blank' }, '미리보기 ↗')));
  }) : [h('p', { class: 'muted' }, '아직 요청이 없어요')]));
}

// ---------------------------------------------------------------- 만들어 올리기
const form = $('#edit-form');
const dialog = $('#edit-dialog');
let saving = false;
let convertingPdf = false;
dialog.addEventListener('cancel', (event) => {
  if (saving || convertingPdf) event.preventDefault();
});
let editing = null;   // 편집 중인 요청
let media = [];       // 저장돼 있는 파일 [{type, path, name}]
let removed = [];     // 저장할 때 지울 파일 경로
let added = [];       // 새로 고른 파일 [{file, type}]
const lyricAudio = $('#lyric-audio');
const lyricStart = $('#lyric-timing-start');
const lyricMark = $('#lyric-timing-mark');
const lyricCancel = $('#lyric-timing-cancel');
const lyricHelp = $('#lyric-timing-help');
let timing = null;
let timedAudioSource;
let previewVersion = 0;
let previewObjects = [];

function currentSongAudio() {
  return media.find((item) => item.type === 'audio')?.path
    ?? added.find((item) => item.type === 'audio')?.file;
}

form.text.addEventListener('input', () => { timedAudioSource = currentSongAudio(); });

function stopTiming(message) {
  timing = null;
  form.text.readOnly = false;
  lyricStart.hidden = false;
  lyricMark.hidden = lyricCancel.hidden = true;
  lyricHelp.textContent = message;
}

function showTimingLine() {
  const index = timing.line_times.length;
  lyricHelp.textContent = `${index + 1} / ${timing.lines.length}줄 · ${timing.lines[index]}`;
}

lyricStart.addEventListener('click', () => {
  try {
    const { lines } = parseLyrics(form.text.value);
    if (!lines.length) return toast('먼저 가사를 적어 주세요.', 'error');
    lyricAudio.pause();
    lyricAudio.currentTime = 0;
    timing = { lines, line_times: [] };
    form.text.readOnly = true;
    lyricStart.hidden = true;
    lyricMark.hidden = lyricCancel.hidden = false;
    showTimingLine();
  } catch (error) {
    toast(error.message, 'error');
  }
});
lyricMark.addEventListener('click', () => {
  if (!timing) return;
  const time = Math.round(lyricAudio.currentTime * 1000) / 1000;
  if (time <= (timing.line_times.at(-1) ?? -1)) return toast('이전 줄보다 뒤의 재생 위치에서 눌러 주세요.', 'error');
  timing.line_times.push(time);
  if (timing.line_times.length < timing.lines.length) return showTimingLine();
  form.text.value = formatLyrics(timing);
  timedAudioSource = currentSongAudio();
  stopTiming('모든 줄의 시간을 기록했어요. 저장하면 반영됩니다.');
});
lyricCancel.addEventListener('click', () => stopTiming('이번에 찍은 시간은 적용하지 않았어요.'));
lyricAudio.addEventListener('loadedmetadata', () => { lyricStart.disabled = false; });
lyricAudio.addEventListener('error', () => {
  lyricStart.disabled = true;
  stopTiming('미리보기 음원을 재생할 수 없어요.');
});

function clearSongPreview() {
  ++previewVersion;
  lyricAudio.pause();
  if (lyricAudio.hasAttribute('src')) {
    lyricAudio.removeAttribute('src');
    lyricAudio.load();
  }
  lyricAudio.hidden = lyricStart.disabled = true;
  stopTiming('음원을 첨부하면 가사 시간을 맞출 수 있어요.');
  $('#song-cover-preview').hidden = true;
  $('#song-cover-preview').removeAttribute('src');
  $('#song-cover-status').textContent = '';
  previewObjects.forEach((url) => URL.revokeObjectURL(url));
  previewObjects = [];
}
dialog.addEventListener('close', clearSongPreview);

async function refreshSongPreview() {
  clearSongPreview();
  if (editing.kind !== 'song') return;
  const version = previewVersion;
  const savedCover = songCoverPath(media, editing.content?.cover);
  const newCover = added.find((item) => item.type === 'image');
  const savedAudio = media.find((item) => item.type === 'audio')?.path;
  const newAudio = savedAudio ? null : added.find((item) => item.type === 'audio');
  const record = state.records.find((item) => item.id === editing.record_id);
  const fallback = !savedCover && !newCover ? state.photoUrls[record?.photo_paths?.[0]] : null;
  const paths = [!newCover && savedCover, savedAudio].filter(Boolean);
  const urls = await signed('creation-media', paths);
  if (version !== previewVersion) return;
  const local = (item) => {
    const url = URL.createObjectURL(item.file);
    previewObjects.push(url);
    return url;
  };
  const coverUrl = newCover ? local(newCover) : urls[savedCover] ?? fallback;
  const coverPreview = $('#song-cover-preview');
  if (coverUrl) {
    coverPreview.src = coverUrl;
    coverPreview.hidden = false;
  }
  $('#song-cover-status').textContent = newCover ? '저장하면 이 이미지가 대표 이미지로 표시돼요.'
    : savedCover ? (coverUrl ? '저장된 노래 커버' : '저장된 커버를 불러오지 못했어요.')
    : fallback ? '노래 커버를 첨부하기 전에는 기록의 첫 사진이 표시돼요.' : '대표 이미지가 없어요.';
  const audioUrl = newAudio ? local(newAudio) : urls[savedAudio];
  if (audioUrl) {
    lyricAudio.src = audioUrl;
    lyricAudio.hidden = false;
    lyricHelp.textContent = '첫 번째 음원을 틀고, 각 줄을 부르기 시작할 때 시작을 찍어 주세요.';
  }
}

function syncFields() {
  const isStory = editing.kind === 'story';
  const bundleStory = isStory && Boolean(editing.bundle_id);
  form.querySelectorAll('[data-only="song"]').forEach((el) => { el.hidden = isStory; });
  form.querySelectorAll('[data-only="story"]').forEach((el) => { el.hidden = !isStory; });
  form.querySelector('[data-only="bundle"]').hidden = !bundleStory;
  $('#external-label').textContent = bundleStory
    ? `연결 영상의 YouTube 주소 (${editing.bundle_youtube_requested ? '사용자가 요청했어요' : '선택'})`
    : '외부 링크 (선택)';
  form.querySelector('[data-only="failed"]').hidden = form.status.value !== 'failed';
}
form.status.addEventListener('change', syncFields);

// ---------------------------------------------------------------- 동화 쪽 그림 편집
// 그림 칸: { path } 저장된 그림 | { file, url } 새로 고른 그림 | null
let pages = [];        // [{ text, img }]
let cover = null;
let storedUrls = {};   // 저장된 그림의 서명 주소

const imgSrc = (img) => img && (img.url ?? storedUrls[img.path]);
const MAX = 50 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const imageFile = (file) => {
  if (!IMAGE_TYPES.includes(file.type)) { toast(`${file.name}: JPG, PNG, WebP 그림을 넣어 주세요`, 'error'); return null; }
  if (file.size > MAX) { toast(`${file.name}: 50MB까지 올릴 수 있어요`, 'error'); return null; }
  return { file, url: URL.createObjectURL(file) };
};
const pickImage = (onPick) => {
  const input = h('input', { type: 'file', accept: IMAGE_TYPES.join(',') });
  input.addEventListener('change', () => { const img = input.files[0] && imageFile(input.files[0]); if (img) onPick(img); });
  input.click();
};

function imageSlot(img, { label, onPick, onRemove, wide = false }) {
  const src = imgSrc(img);
  return h('div', { class: `img-slot${wide ? ' img-slot--wide' : ''}` },
    src
      ? h('img', { src, alt: label })
      : h('button', { type: 'button', class: 'img-slot__empty', onclick: () => pickImage(onPick) }, '＋ 그림 넣기'),
    img && h('div', { class: 'img-slot__bar' },
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
$('#page-bulk-button').addEventListener('click', () => $('#page-bulk').click());
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

async function loadStoryPages(c) {
  const images = (c.media ?? []).filter((m) => m.type === 'image');
  storedUrls = {};
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
  const urls = await signed('creation-media', images.map((m) => m.path));
  if (editing === c) {
    storedUrls = urls;
    renderPages();
  }
}

function renderMedia() {
  refreshSongPreview();
  $('#media-section').hidden = !media.length && !added.length;
  const label = { audio: '음원', image: '커버 이미지', pdf: '동화 PDF', video: '연결 영상' };
  const replace = (type, onSelect) => {
    const input = h('input', {
      type: 'file',
      accept: { audio: 'audio/*', image: IMAGE_TYPES.join(','), pdf: 'application/pdf,.pdf', video: 'video/mp4,.mp4' }[type],
    });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file || !validAttachment(file, type)) return;
      if (type === 'pdf') await selectStoryPdf(file);
      else {
        onSelect(file);
        renderMedia();
      }
    });
    input.click();
  };
  $('#media-list').replaceChildren(
    ...media.map((m, i) => h('li', {},
      h('span', {}, `${label[m.type]} · ${m.name ?? m.path.split('/').pop()}`),
      h('button', { type: 'button', class: 'btn--text', onclick: () => replace(m.type, (file) => {
        removed.push(m.path);
        media = media.filter((item) => item !== m);
        added.push({ file, type: m.type });
      }) }, '교체'),
      h('button', { type: 'button', class: 'btn--text', onclick: () => { removed.push(m.path); media.splice(i, 1); renderMedia(); } }, '빼기'))),
    ...added.map((a, i) => h('li', {},
      h('span', {}, `${label[a.type]} · ${a.file.name} (새 파일)`),
      h('button', { type: 'button', class: 'btn--text', onclick: () => replace(a.type, (file) => { a.file = file; }) }, '교체'),
      h('button', { type: 'button', class: 'btn--text', onclick: () => { added.splice(i, 1); renderMedia(); } }, '빼기'))),
  );
}

function validAttachment(file, type) {
  const valid = type === 'audio' ? file.type.startsWith('audio/')
    : type === 'image' ? IMAGE_TYPES.includes(file.type)
    : type === 'video' ? file.type === 'video/mp4' || (!file.type && /\.mp4$/i.test(file.name))
    : file.type === 'application/pdf' || (!file.type && /\.pdf$/i.test(file.name));
  if (!valid) toast(`${file.name}: 선택한 파일 형식을 확인해 주세요`, 'error');
  else if (file.size > MAX) toast(`${file.name}: 50MB까지 올릴 수 있어요`, 'error');
  return valid && file.size <= MAX;
}

$('#media-input').addEventListener('change', (e) => {
  for (const file of e.target.files) {
    if (!validAttachment(file, 'audio')) continue;
    added.push({ file, type: 'audio' });
  }
  e.target.value = '';
  renderMedia();
});

function selectAttachment(file, type) {
  removed.push(...media.filter((m) => m.type === type).map((m) => m.path));
  media = media.filter((m) => m.type !== type);
  added = added.filter((a) => a.type !== type);
  added.push({ file, type });
  renderMedia();
}

async function selectStoryPdf(file) {
  if (saving || convertingPdf) return;
  if (pages.some((page) => page.img || page.text.trim())
      && !confirm('현재 쪽을 이 PDF의 페이지로 바꿀까요? 저장하면 반영됩니다.')) return;
  convertingPdf = true;
  const controls = form.querySelectorAll('button, input, select, textarea');
  const enabled = [...controls].filter((element) => !element.disabled);
  enabled.forEach((element) => { element.disabled = true; });
  const progress = $('#pdf-progress');
  progress.textContent = 'PDF를 읽는 중이에요…';
  const generated = [];
  try {
    await renderPdfPages(await file.arrayBuffer(), (blob, name, number, total) => {
      generated.push({ text: '', img: imageFile(new File([blob], name, { type: 'image/jpeg' })) });
      progress.textContent = `페이지 만드는 중 · ${number} / ${total}쪽`;
    });
    pages.forEach(({ img }) => { if (img?.url) URL.revokeObjectURL(img.url); });
    pages = generated;
    selectAttachment(file, 'pdf');
    renderPages();
    progress.textContent = `${pages.length}쪽을 만들었어요. 저장하면 원본 PDF와 함께 올라갑니다.`;
  } catch (error) {
    generated.forEach(({ img }) => { if (img?.url) URL.revokeObjectURL(img.url); });
    progress.textContent = '';
    toast(error.name === 'PasswordException'
      ? '암호가 걸린 PDF예요. 잠금이 없는 PDF로 올려 주세요.'
      : 'PDF를 읽거나 페이지 이미지로 만들지 못했어요. 파일을 확인하고 다시 시도해 주세요.', 'error');
  } finally {
    enabled.forEach((element) => { element.disabled = false; });
    convertingPdf = false;
  }
}

$('#song-cover-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file && validAttachment(file, 'image')) selectAttachment(file, 'image');
});

$('#pdf-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file && validAttachment(file, 'pdf')) selectStoryPdf(file);
});

$('#bundle-video-input').addEventListener('change', (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file && validAttachment(file, 'video')) selectAttachment(file, 'video');
});

function openEditor(c) {
  editing = c;
  media = (c.media ?? []).filter((m) => c.kind === 'story' ? ['pdf', 'video'].includes(m.type) : ['image', 'audio'].includes(m.type));
  removed = [];
  added = [];
  const rec = state.records.find((r) => r.id === c.record_id);
  const action = c.status === 'ready' || c.media?.length ? '작품·파일 수정' : '만들어 올리기';
  $('#edit-title').textContent = `${KIND[c.kind]} ${action}`;
  $('#edit-source').replaceChildren(
    h('p', { class: 'source__label' }, '요청한 기록'),
    rec ? recordBlock(rec, true) : h('p', { class: 'muted' }, '(지워진 기록)'),
    c.request_note ? h('p', { class: 'areq__note' }, `바라는 점: ${c.request_note}`) : '');

  form.reset();
  $('#pdf-progress').textContent = '';
  form.status.value = c.status === 'pending' ? 'making' : c.status;
  form.elements.title.value = c.title ?? '';
  form.mood.value = c.content?.mood ?? '';
  form.text.value = formatLyrics(c.content ?? {});
  timedAudioSource = c.content?.lyric_audio ?? currentSongAudio();
  form.external_url.value = c.external_url ?? '';
  form.error.value = c.error ?? '';
  syncFields();
  renderMedia();
  if (c.kind === 'story') {
    pages = []; cover = null;
    renderPages();
    loadStoryPages(c);
  }
  dialog.showModal();
}

// 새로 고른 그림 하나 올리기 → 저장 경로
async function uploadOne(c, file, uploaded, type = 'image') {
  const contentType = { pdf: 'application/pdf', video: 'video/mp4' }[type] ?? file.type;
  const ext = type === 'pdf' ? 'pdf' : type === 'video' ? 'mp4' : /\.([a-z0-9]+)$/i.exec(file.name)?.[1].toLowerCase();
  const path = `${c.user_id}/${c.id}/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;
  const { error } = await sb.storage.from('creation-media').upload(path, file, {
    contentType, upsert: false,
  });
  if (error) throw new Error(`${file.name} 올리기 실패: ${error.message}`);
  uploaded.push({ type, path, name: file.name });
  return path;
}

// 동화 저장: 쪽마다 그림 경로를 content.pages[].image 에 넣고, 안 쓰게 된 그림은 지움
async function saveStory(c, uploaded) {
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
    media: [...nextMedia, ...media, ...uploaded.filter((m) => m.type === 'pdf' || m.type === 'video')],
    drop: [...old.filter((m) => !keep.has(m.path)).map((m) => m.path), ...removed],
  };
}

form.addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  if (convertingPdf || saving) return;
  if (timing) return toast('가사 시간을 모두 찍거나 그만하기를 누른 뒤 저장해 주세요.', 'error');
  if (!form.reportValidity()) return;
  const c = editing;
  const status = form.status.value;
  const externalUrl = form.external_url.value.trim();
  if (c.kind === 'story' && c.bundle_id) {
    if (externalUrl && !/^https:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(externalUrl)) {
      return toast('연결 영상의 YouTube 주소를 입력해 주세요.', 'error');
    }
    if (status === 'ready' && ![...media, ...added].some((item) => item.type === 'video')) {
      return toast('완료하기 전에 동화와 노래를 연결한 MP4 파일을 올려 주세요.', 'error');
    }
    if (status === 'ready' && c.bundle_youtube_requested && !externalUrl) {
      return toast('사용자가 요청한 YouTube 주소를 입력해 주세요.', 'error');
    }
  }
  let content;
  if (c.kind === 'song') {
    try {
      content = { mood: form.mood.value.trim(), ...parseLyrics(form.text.value) };
    } catch (error) {
      return toast(error.message, 'error');
    }
    if (content.line_times && currentSongAudio() !== timedAudioSource) {
      if (!confirm('첫 번째 음원이 바뀌었어요. 기존 가사 시간을 해제하고 저장할까요?')) return;
      delete content.line_times;
    }
  }

  if (status === 'ready') {
    const hasBody = c.kind === 'story'
      ? (pages.some((p) => p.text.trim() || p.img) || [...media, ...added].some((item) => item.type === 'pdf') || (!c.bundle_id && externalUrl))
      : (content.lines?.length || media.length || added.length || form.external_url.value.trim());
    if (!form.elements.title.value.trim()) return toast('완료로 바꾸려면 제목을 적어 주세요', 'error');
    if (!hasBody) return toast('완료로 바꾸려면 글, 파일, 외부 링크 중 하나는 있어야 해요', 'error');
  }
  if (status === 'failed' && !confirm('이 요청을 취소할까요? 사용자의 남은 횟수가 1 돌아가요.')) return;

  await busy(e.submitter, '저장하는 중…', async () => {
    saving = true;
    form.querySelector('.sheet__body').inert = true;
    const dismiss = form.querySelectorAll('button[value="cancel"]');
    dismiss.forEach((button) => { button.disabled = true; });
    const uploaded = [];
    let drop;
    try {
      for (const a of added) await uploadOne(c, a.file, uploaded, a.type);
      const nextMedia = [...media, ...uploaded];
      const preferredCover = songCoverPath(uploaded) ?? c.content?.cover;
      if (content?.line_times) content.lyric_audio = nextMedia.find((item) => item.type === 'audio')?.path ?? null;
      const result = c.kind === 'story' ? await saveStory(c, uploaded)
        : { content: { ...content, cover: songCoverPath(nextMedia, preferredCover) ?? null }, media: nextMedia, drop: removed };
      const { error } = await sb.from('creations').update({
        status,
        title: form.elements.title.value.trim() || null,
        content: result.content,
        media: result.media,
        external_url: externalUrl || null,
        error: status === 'failed' ? (form.error.value.trim() || '요청이 취소됐어요') : null,
      }).eq('id', c.id);
      if (error) throw new Error(`저장하지 못했어요: ${error.message}`);
      drop = result.drop;
    } catch (err) {
      if (uploaded.length) await sb.storage.from('creation-media').remove(uploaded.map((u) => u.path));
      return toast(err.message, 'error');
    } finally {
      saving = false;
      form.querySelector('.sheet__body').inert = false;
      dismiss.forEach((button) => { button.disabled = false; });
    }
    dialog.close();
    if (drop.length) await sb.storage.from('creation-media').remove(drop);
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
