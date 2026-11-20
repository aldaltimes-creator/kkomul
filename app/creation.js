// 요청한 동화·노래 보기 (관리자가 올린 글·그림·음원·링크), 하드북 주문
import { sb, guardConfig, requireUser, h, $, toast, fmtDate, photoUrls, busy } from './lib.js';

if (!guardConfig()) await new Promise(() => {}); // 설정 전에는 여기서 멈춤
await requireUser();

const id = new URLSearchParams(location.search).get('id');
const root = $('#creation');
const KIND = { story: '동화', song: '노래' };
let creation = null;

async function load() {
  const { data, error } = await sb.from('creations')
    .select('*, records(title, record_date, photo_paths), children(name)')
    .eq('id', id).maybeSingle();
  if (error || !data) {
    root.replaceChildren(h('div', { class: 'empty' },
      h('b', {}, '작품을 찾을 수 없어요'),
      h('a', { class: 'btn btn--ghost btn--sm', href: 'index.html' }, '앨범으로')));
    return;
  }
  creation = data;
  if (data.status === 'ready') return renderReady();
  if (data.status === 'failed') return renderFailed();
  return renderWaiting();
}

const back = () => h('a', { class: 'btn btn--ghost btn--sm', href: 'index.html', style: 'margin-top:12px' }, '앨범으로');

function renderWaiting() {
  const c = creation;
  const making = c.status === 'making';
  root.replaceChildren(h('div', { class: 'empty' },
    h('b', {}, making ? `${KIND[c.kind]}를 만들고 있어요` : `${KIND[c.kind]} 요청을 받았어요`),
    h('p', { class: 'muted' }, making ? '완성되면 이 화면과 앨범에서 바로 볼 수 있어요.' : '곧 만들기 시작할게요. 완성되면 앨범에서 볼 수 있어요.'),
    c.request_note && h('p', { class: 'muted', style: 'margin-top:8px' }, `바라는 점: ${c.request_note}`),
    back()));
}

function renderFailed() {
  root.replaceChildren(h('div', { class: 'empty' },
    h('b', {}, '요청이 취소됐어요'),
    h('p', { class: 'muted' }, creation.error ?? '자세한 내용은 고객센터로 문의해 주세요.'),
    h('p', { class: 'muted' }, '취소된 요청은 횟수에서 빠져요.'),
    back()));
}

// 관리자가 올린 파일의 1시간짜리 주소
async function mediaUrls(media) {
  const paths = (media ?? []).map((m) => m.path);
  if (!paths.length) return {};
  const { data } = await sb.storage.from('creation-media').createSignedUrls(paths, 3600);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}

async function renderReady() {
  const c = creation;
  const rec = c.records;
  const isStory = c.kind === 'story';
  const media = c.media ?? [];
  const images = media.filter((m) => m.type === 'image');
  const audios = media.filter((m) => m.type === 'audio');
  const [murls, purls] = await Promise.all([
    mediaUrls(media),
    !images.length && rec?.photo_paths?.[0] ? photoUrls([rec.photo_paths[0]]) : Promise.resolve({}),
  ]);
  document.title = `${c.title ?? KIND[c.kind]} — 꼬물상자`;

  const pages = c.content?.pages ?? [];
  const lines = c.content?.lines ?? [];
  let body;
  if (isStory) {
    // 그림이 있으면 쪽마다 한 장씩, 남는 그림은 뒤에 이어서
    const count = Math.max(pages.length, images.length);
    body = h('div', { class: 'story-pages' }, ...Array.from({ length: count }, (_, i) => {
      const img = images[i] && murls[images[i].path];
      return h('section', { class: 'story-page', 'aria-label': `${i + 1}쪽` },
        img && h('img', { class: 'story-page__img', src: img, alt: `${i + 1}쪽 그림`, loading: 'lazy' }),
        pages[i]?.text && h('p', {}, pages[i].text),
        h('span', { class: 'story-page__num', 'aria-hidden': 'true' }, `${i + 1}`));
    }));
  } else {
    body = h('div', {},
      ...audios.map((a) => murls[a.path] && h('audio', { class: 'song-audio', controls: true, preload: 'metadata', src: murls[a.path] })),
      lines.length > 0 && h('ol', { class: 'song-lines' }, ...lines.map((l) => h('li', {}, l))));
  }
  const cover = !images.length && rec?.photo_paths?.[0] && purls[rec.photo_paths[0]];

  // replaceChildren 은 false 를 글자로 넣으므로 빈 항목을 걸러 냄
  root.replaceChildren(...[
    h('p', { class: 'creation__type' }, isStory ? '동화' : `노래${c.content?.mood ? ` · ${c.content.mood}` : ''}`),
    h('h1', { class: 'creation__title' }, c.title ?? KIND[c.kind]),
    h('p', { class: 'muted' },
      `${c.children?.name ?? ''}의 ${rec ? `${fmtDate(rec.record_date)} 「${rec.title}」` : ''} 기록으로 만들었어요`),
    cover && h('img', { class: 'creation__photo', src: cover, alt: `${rec.title} 사진` }),
    body,
    h('div', { class: 'creation__actions' },
      h('a', { class: 'btn btn--ghost btn--sm', href: 'index.html' }, '← 앨범으로'),
      c.external_url && h('a', { class: 'btn btn--ghost btn--sm', href: c.external_url, target: '_blank', rel: 'noopener noreferrer' },
        isStory ? '크게 보기 ↗' : '다른 곳에서 듣기 ↗'),
      isStory && h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: openOrder }, '하드북으로 받기 · 35,000원'),
      (pages.length > 0 || lines.length > 0) && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: copyText }, '글 복사'),
    ),
  ].filter(Boolean));
}

async function copyText() {
  const c = creation;
  const text = [c.title, '', ...(c.kind === 'story' ? (c.content?.pages ?? []).map((p) => p.text) : (c.content?.lines ?? []))].join('\n');
  try { await navigator.clipboard.writeText(text); toast('복사했어요'); }
  catch { toast('복사하지 못했어요. 글을 길게 눌러 복사해 주세요.', 'error'); }
}

function openOrder() {
  const f = $('#order-form');
  f.reset();
  f.cover_name.value = creation.children?.name ?? '';
  $('#order-dialog').showModal();
}

$('#order-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  if (!e.target.reportValidity()) return;
  const f = new FormData(e.target);
  await busy(e.submitter, '접수하는 중…', async () => {
    const { error } = await sb.from('book_orders').insert({
      creation_id: creation.id,
      cover_name: String(f.get('cover_name')).trim(),
      recipient: String(f.get('recipient')).trim(),
      phone: String(f.get('phone')).trim(),
      address: String(f.get('address')).trim(),
    });
    if (error) return toast(`접수하지 못했어요: ${error.message}`, 'error');
    $('#order-dialog').close();
    toast('하드북 주문을 접수했어요. 이용권 화면에서 확인할 수 있어요.');
  });
});

if (!id) location.replace('index.html');
else load();
