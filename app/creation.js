// 요청한 동화·노래 보기 (관리자가 올린 글·그림·음원·링크), 하드북 주문
import { sb, guardConfig, requireUser, h, $, toast, fmtDate, photoUrls, busy, processSteps, songCoverPath } from './lib.js';
import { renderPdfPages } from './story-pdf.js';
import { activeLyric, hasLyricTiming } from './song-lyrics.js';

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
  // 관리자 미리보기: 완료 전에도 사용자에게 보일 모습 그대로
  if (new URLSearchParams(location.search).has('preview')) {
    const { data: isAdmin } = await sb.rpc('is_admin');
    if (isAdmin) {
      await renderReady();
      root.prepend(h('p', { class: 'notice' }, '관리자 미리보기예요. 사용자에게는 완료로 저장한 뒤에 보여요.'));
      return;
    }
  }
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
    h('div', { class: 'process process--page' },
      h('p', { class: 'process__title' }, '진행 상황'),
      processSteps(making ? 2 : 1)),
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
  const mp3 = audios.find((a) => /\.mp3$/i.test(a.name ?? '') || /\.mp3$/i.test(a.path));
  const downloadableAudio = !isStory && (mp3 ?? audios[0]);
  const pdf = isStory && media.find((m) => m.type === 'pdf');
  const [murls, purls] = await Promise.all([
    mediaUrls(media),
    !images.length && rec?.photo_paths?.[0] ? photoUrls([rec.photo_paths[0]]) : Promise.resolve({}),
  ]);
  document.title = `${c.title ?? KIND[c.kind]} — 꼬물상자`;

  const pages = c.content?.pages ?? [];
  const lines = c.content?.lines ?? [];
  let readableText = lines;
  let imagePaths = [];
  let body;
  let hasPlayer = false;
  if (isStory) {
    // 쪽마다 그림(content.pages[].image). 예전 방식이면 올린 순서대로 쪽에 붙임
    const perPage = pages.some((p) => p.image);
    const legacy = perPage ? [] : images.filter((m) => m.path !== c.content?.cover);
    const count = Math.max(pages.length, legacy.length);
    const bookPages = Array.from({ length: count }, (_, i) => {
      const path = pages[i]?.image ?? legacy[i]?.path;
      if (path) imagePaths.push(path);
      return { text: pages[i]?.text ?? '', img: murls[path] ?? null };
    });
    if (c.content?.cover && (imagePaths.length || !pdf) && !imagePaths.includes(c.content.cover)) {
      imagePaths.unshift(c.content.cover);
    }
    const coverImg = murls[c.content?.cover] ?? bookPages.find((p) => p.img)?.img
      ?? (rec?.photo_paths?.[0] && purls[rec.photo_paths[0]]) ?? null;
    readableText = bookPages.filter((p) => !p.img && p.text).map((p) => p.text);
    if (bookPages.length || !pdf) {
      body = renderBook({ title: c.title ?? '동화', child: c.children?.name ?? '', coverImg, pages: bookPages });
    }
  } else {
    const tracks = audios.filter((a) => murls[a.path]).map((a) => ({
      path: a.path,
      audio: h('audio', {
        class: 'song-audio', controls: true, preload: 'metadata', src: murls[a.path],
        'aria-label': a.name ?? '노래 재생',
      }),
    }));
    hasPlayer = tracks.length > 0;
    const mainTrack = tracks.find((track) => track.path === audios[0]?.path);
    const timingMatches = !c.content?.lyric_audio || c.content.lyric_audio === audios[0]?.path;
    body = h('div', {}, songPlayers(tracks),
      lines.length > 0 && renderLyrics(lines, timingMatches ? c.content?.line_times : null, mainTrack?.audio));
  }
  // 노래: 올린 커버 그림, 없으면 기록 사진 (동화는 책 표지에 들어감)
  const coverPath = songCoverPath(media, c.content?.cover);
  const cover = isStory ? null : (coverPath ? murls[coverPath] : purls[rec?.photo_paths?.[0]]);

  // replaceChildren 은 false 를 글자로 넣으므로 빈 항목을 걸러 냄
  root.classList.toggle('creation--has-player', hasPlayer);
  root.replaceChildren(...[
    h('div', { class: `creation__actions creation__actions--top${isStory ? ' creation__actions--story' : ''}` },
      h('a', { class: 'btn btn--ghost btn--sm', href: 'index.html' }, '← 앨범으로'),
      readableText.length > 0 && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => copyText(readableText) }, '글 복사'),
      downloadableAudio && h('button', { class: 'btn btn--ghost btn--sm', type: 'button',
        onclick: (event) => downloadAudio(event.currentTarget, downloadableAudio, c.title) }, mp3 ? 'MP3 다운로드' : '음원 다운로드'),
      isStory && (imagePaths.length > 0 || pdf) && h('button', { class: 'btn btn--ghost btn--sm', type: 'button',
        'aria-label': '이미지 다운로드 (ZIP)',
        onclick: (event) => downloadImages(event.currentTarget, imagePaths, pdf, c.title) }, '이미지 다운로드'),
      isStory && h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: openOrder }, '하드북으로 받기')),
    h('div', { class: 'creation__heading' },
      h('span', { class: 'creation__type' }, KIND[c.kind]),
      h('h1', { class: 'creation__title' }, c.title ?? KIND[c.kind])),
    !isStory && c.content?.mood && h('p', { class: 'muted' }, c.content.mood),
    h('p', { class: 'muted' },
      `${c.children?.name ?? ''}의 ${rec ? `${fmtDate(rec.record_date)} 「${rec.title}」` : ''} 기록으로 만들었어요`),
    cover && h('img', { class: 'creation__photo', src: cover, alt: `${c.title ?? '노래'} 커버 이미지` }),
    !isStory && coverPath && !cover && h('p', { class: 'notice' }, '노래 커버를 불러오지 못했어요.'),
    pdf && !murls[pdf.path] && h('p', { class: 'notice' }, '동화 PDF를 불러오지 못했어요. 새로고침해 주세요.'),
    body,
    h('div', { class: 'creation__actions' },
      pdf && murls[pdf.path] && h('a', { class: 'btn btn--ghost btn--sm', href: murls[pdf.path], target: '_blank', rel: 'noopener noreferrer' }, '동화 PDF 열기 ↗'),
      pdf && h('button', { class: 'btn btn--ghost btn--sm', type: 'button',
        onclick: (event) => downloadPdf(event.currentTarget, pdf, c.title) }, 'PDF 다운로드'),
      c.external_url && h('a', { class: 'btn btn--ghost btn--sm', href: c.external_url, target: '_blank', rel: 'noopener noreferrer' },
        isStory ? '크게 보기 ↗' : '다른 곳에서 듣기 ↗'),
    ),
  ].filter(Boolean));
}

function songPlayers(tracks) {
  const bars = tracks.map(({ audio }, index) =>
    h('div', { class: `song-player${index === 0 ? ' song-player--dock' : ''}` }, audio));
  for (const [index, { audio }] of tracks.entries()) {
    audio.addEventListener('play', () => {
      bars.forEach((bar, other) => {
        bar.classList.toggle('song-player--dock', other === index);
        if (other !== index) tracks[other].audio.pause();
      });
    });
  }
  return bars;
}

function renderLyrics(lines, times, player) {
  const rows = lines.map((line) => h('li', {}, line));
  const synced = Boolean(player) && hasLyricTiming(lines, times);
  const list = h('ol', {
    class: `song-lines${synced ? ' song-lines--synced' : ''}`,
    tabindex: synced ? '0' : null, 'aria-label': '노래 가사',
  }, rows);
  if (!synced) return list;
  let active = -1;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function update(event) {
    const index = activeLyric(player.currentTime, times);
    if (active === index) return;
    rows[active]?.removeAttribute('aria-current');
    active = index;
    if (index < 0) {
      list.scrollTop = 0;
      return;
    }
    const row = rows[index];
    row.setAttribute('aria-current', 'true');
    const offset = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTo({
      top: list.scrollTop + offset + (row.offsetHeight - list.clientHeight) / 2,
      behavior: reducedMotion.matches || event.type === 'seeked' ? 'instant' : 'smooth',
    });
  }
  for (const name of ['play', 'timeupdate', 'seeked']) player.addEventListener(name, update);
  return list;
}

function fileName(value) {
  return (value ?? '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/\.+$/, '') || '동화';
}

function startDownload(url, name) {
  const link = h('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
}

async function downloadPdf(button, pdf, title) {
  await busy(button, 'PDF 준비 중…', async () => {
    const name = `${fileName(pdf.name?.replace(/\.pdf$/i, '') ?? title)}.pdf`;
    const { data, error } = await sb.storage.from('creation-media').createSignedUrl(pdf.path, 120, { download: name });
    if (error || !data?.signedUrl) return toast('PDF를 다운로드하지 못했어요. 다시 시도해 주세요.', 'error');
    startDownload(data.signedUrl, name);
  });
}

async function downloadAudio(button, audio, title) {
  await busy(button, '음원 준비 중…', async () => {
    try {
      const extension = /\.[a-z0-9]+$/i.exec(audio.path)?.[0] ?? '';
      const name = fileName(audio.name || `${title || '노래'}${extension}`);
      const { data, error } = await sb.storage.from('creation-media').createSignedUrl(audio.path, 120, { download: name });
      if (error || !data?.signedUrl) throw new Error('Missing download URL');
      startDownload(data.signedUrl, name);
    } catch {
      toast('음원을 다운로드하지 못했어요. 다시 시도해 주세요.', 'error');
    }
  });
}

async function downloadImages(button, paths, pdf, title) {
  await busy(button, '이미지 준비 중…', async () => {
    try {
      const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
      const zip = new JSZip();
      const pagePaths = paths.length ? paths : [pdf.path];
      const urls = await mediaUrls([...new Set(pagePaths)].map((path) => ({ path })));
      const fetchFile = async (path) => {
        if (!urls[path]) throw new Error('파일 주소를 받을 수 없어요.');
        const response = await fetch(urls[path]);
        if (!response.ok) throw new Error('파일을 읽을 수 없어요.');
        return response;
      };
      if (paths.length) {
        for (const [index, path] of paths.entries()) {
          button.textContent = `이미지 준비 중 · ${index + 1} / ${paths.length}`;
          const response = await fetchFile(path);
          const ext = /\.(jpe?g|png|webp)$/i.exec(path)?.[1].toLowerCase()
            ?? ({ 'image/png': 'png', 'image/webp': 'webp' }[response.headers.get('content-type')] ?? 'jpg');
          zip.file(`page-${String(index + 1).padStart(Math.max(3, String(paths.length).length), '0')}.${ext}`, await response.arrayBuffer());
        }
      } else {
        const response = await fetchFile(pdf.path);
        await renderPdfPages(await response.arrayBuffer(), async (blob, name, number, total) => {
          button.textContent = `이미지 만드는 중 · ${number} / ${total}`;
          zip.file(name, await blob.arrayBuffer());
        });
      }
      const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }));
      try { startDownload(url, `${fileName(title)}-이미지.zip`); }
      finally { setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    } catch (error) {
      toast(error.name === 'PasswordException' ? '암호가 걸린 PDF는 이미지로 받을 수 없어요.'
        : '이미지 ZIP을 만들지 못했어요. 연결을 확인하고 다시 시도해 주세요.', 'error');
    }
  });
}

// ---------------------------------------------------------------- 그림책 보기
// 표지 → 쪽마다 그림 한 장(예전 글 전용 쪽은 글) → 끝
function renderBook({ title, child, coverImg, pages }) {
  const views = [{ kind: 'cover' }, ...pages.map((p, i) => ({ kind: 'page', ...p, n: i + 1 })), { kind: 'end' }];
  const mobile = matchMedia('(max-width: 720px)');
  let at = 0;

  const stage = h('div', { class: 'pbook__stage' });
  const counter = h('span', { class: 'pbook__count', 'aria-live': 'polite' });
  const prev = h('button', { type: 'button', class: 'pbook__arrow pbook__arrow--prev', 'aria-label': '앞 쪽' }, '‹');
  const next = h('button', { type: 'button', class: 'pbook__arrow pbook__arrow--next', 'aria-label': '다음 쪽' }, '›');
  const bar = h('input', { type: 'range', class: 'pbook__bar', min: 0, max: views.length - 1, value: 0, 'aria-label': '쪽 고르기' });
  const full = h('button', { type: 'button', class: 'btn btn--ghost btn--sm pbook__full' }, '크게 보기');
  full.hidden = !document.fullscreenEnabled;
  const book = h('section', { class: 'pbook', tabindex: '0', 'aria-roledescription': '그림책', 'aria-label': `「${title}」 그림책` },
    h('p', { class: 'pbook__rotate-hint muted' }, '휴대폰을 가로로 돌리면 그림책을 더 크게 볼 수 있어요.'),
    h('div', { class: 'pbook__frame' }, prev, stage, next),
    h('div', { class: 'pbook__nav' }, counter, bar, full),
    h('p', { class: 'pbook__tap-hint muted' }, '책 왼쪽은 이전 장, 오른쪽은 다음 장'));

  const textPage = (v) => h('div', { class: 'pbook__page pbook__page--text' },
    h('p', { class: 'pbook__text' }, v.text),
    h('span', { class: 'pbook__num' }, `${v.n}`));

  function spread(v) {
    if (v.kind === 'cover') {
      return h('div', { class: 'pbook__spread pbook__spread--cover' },
        h('div', { class: 'pbook__cover pbook__cover--front' },
          coverImg ? h('img', { src: coverImg, alt: `「${title}」 표지` })
            : h('div', { class: 'pbook__cover-band' },
            h('p', { class: 'pbook__cover-title' }, title),
            child && h('p', { class: 'pbook__cover-sub' }, `${child}의 이야기 · 꼬물상자`))));
    }
    if (v.kind === 'end') {
      return h('div', { class: 'pbook__spread pbook__spread--cover' },
        h('div', { class: 'pbook__cover pbook__cover--end' },
          h('p', { class: 'pbook__end' }, '끝'),
          h('p', { class: 'pbook__cover-sub' }, child ? `사랑하는 ${child}에게` : '사랑을 담아'),
          h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => go(0) }, '처음부터 다시 보기')));
    }
    if (!v.img) return h('div', { class: 'pbook__spread pbook__spread--solo' }, textPage(v));
    return h('div', { class: 'pbook__spread pbook__spread--solo pbook__spread--image-only' },
      h('div', { class: 'pbook__page pbook__page--art' }, h('img', { src: v.img, alt: `${v.n}쪽 그림` })));
  }

  function go(to, dir = to > at ? 'next' : 'prev') {
    to = Math.max(0, Math.min(views.length - 1, to));
    const turned = to !== at;
    at = to;
    const s = spread(views[at]);
    if (turned) s.classList.add(`is-turn-${dir}`);
    stage.replaceChildren(s);
    const v = views[at];
    counter.textContent = v.kind === 'cover' ? '표지' : v.kind === 'end' ? '끝' : `${v.n} / ${pages.length}쪽`;
    bar.value = at;
    prev.disabled = at === 0;
    next.disabled = at === views.length - 1;
    // 다음 그림 미리 받아 두기
    for (const w of [views[at + 1], views[at + 2]]) if (w?.img) new Image().src = w.img;
  }

  prev.addEventListener('click', () => go(at - 1));
  next.addEventListener('click', () => go(at + 1));
  bar.addEventListener('input', () => go(Number(bar.value)));
  book.addEventListener('keydown', (e) => {
    if (e.target.closest('button, input')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(at + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(at - 1); }
    if (e.key === 'Home') go(0);
    if (e.key === 'End') go(views.length - 1);
  });
  // 밀어서 넘기기, 쪽 왼쪽/오른쪽 끝 누르기
  let start = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.isPrimary && e.button === 0) start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  stage.addEventListener('pointercancel', () => { start = null; });
  stage.addEventListener('pointerup', (e) => {
    if (start?.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (e.target.closest('button')) return;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) return go(at + (dx < 0 ? 1 : -1));
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
    const r = stage.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (mobile.matches) return go(at + (x < 0.5 ? -1 : 1));
    if (x > 0.8) go(at + 1); else if (x < 0.2) go(at - 1);
  });
  full.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else book.requestFullscreen?.().catch(() => toast('이 기기에서는 크게 보기를 할 수 없어요', 'error'));
  });
  document.addEventListener('fullscreenchange', () => {
    full.textContent = document.fullscreenElement === book ? '작게 보기' : '크게 보기';
  });

  go(0);
  return book;
}

async function copyText(lines) {
  const text = [creation.title, '', ...lines].join('\n');
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
