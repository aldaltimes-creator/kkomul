// 앨범 모아보기: 달별 앨범, 받은 동화·노래, 올린 사진 전체
import { sb, guardConfig, requireUser, h, $, toast, fmtDate, photoUrls } from './lib.js';

if (!guardConfig()) await new Promise(() => {}); // 설정 전에는 여기서 멈춤
const user = await requireUser();

const KIND = { story: '동화', song: '노래' };
const STATUS = { pending: '요청됨', making: '만드는 중' };

const { data: children } = await sb.from('children').select('id, name').eq('user_id', user.id).order('created_at').limit(1);
const child = children?.[0];
if (!child) {
  $('#summary').textContent = '아직 아이를 소개하지 않았어요.';
  $('#months').replaceChildren(h('li', { class: 'empty' }, h('b', {}, '앨범이 아직 없어요'), h('a', { class: 'btn btn--primary btn--sm', href: 'index.html' }, '아이 소개하러 가기')));
  await new Promise(() => {});
}
$('#title').textContent = `${child.name}의 앨범 모아보기`;

const [{ data: records, error }, { data: creations }, { data: moments }] = await Promise.all([
  sb.from('records').select('id, record_date, title, photo_paths').eq('child_id', child.id)
    .order('record_date', { ascending: false }).order('created_at', { ascending: false }),
  sb.from('creations').select('id, record_id, kind, status, title, created_at').eq('user_id', user.id).neq('status', 'failed').order('created_at', { ascending: false }),
  sb.from('moments').select('month, favorite_word').eq('child_id', child.id),
]);
if (error) toast(`불러오지 못했어요: ${error.message}`, 'error');

const recs = records ?? [];
const works = creations ?? [];
const allPhotos = recs.flatMap((r) => r.photo_paths.map((p) => ({ path: p, rec: r })));
$('#summary').textContent = `기록 ${recs.length}개 · 사진 ${allPhotos.length}장 · 받은 작품 ${works.filter((w) => w.status === 'ready').length}개`;

// 사진 주소를 나눠 받아 오래된 기록의 사진도 표시해요.
const urls = {};
for (let start = 0; start < allPhotos.length; start += 300) {
  Object.assign(urls, await photoUrls(allPhotos.slice(start, start + 300).map((p) => p.path)));
}

// ---------------------------------------------------------------- 달별 앨범
const byMonth = new Map();
for (const r of recs) {
  const key = r.record_date.slice(0, 7); // YYYY-MM
  if (!byMonth.has(key)) byMonth.set(key, { recs: [], works: 0 });
  byMonth.get(key).recs.push(r);
}
for (const w of works) {
  const r = recs.find((x) => x.id === w.record_id);
  if (r && w.status === 'ready') byMonth.get(r.record_date.slice(0, 7)).works += 1;
}
const momentOf = Object.fromEntries((moments ?? []).map((m) => [m.month.slice(0, 7), m.favorite_word]));

$('#months').replaceChildren(...(byMonth.size ? [...byMonth.entries()].map(([key, m]) => {
  const [y, mo] = key.split('-');
  const cover = m.recs.flatMap((r) => r.photo_paths).find((p) => urls[p]);
  const photos = m.recs.reduce((n, r) => n + r.photo_paths.length, 0);
  return h('li', {},
    h('a', { class: 'month-book', href: `index.html?m=${key}` },
      cover
        ? h('img', { src: urls[cover], alt: '', loading: 'lazy' })
        : h('div', { class: 'month-book__blank', 'aria-hidden': 'true' }, `${Number(mo)}월`),
      h('div', { class: 'month-book__body' },
        h('p', { class: 'month-book__name' }, `${y}년 ${Number(mo)}월`),
        h('p', { class: 'muted' }, `기록 ${m.recs.length} · 사진 ${photos} · 작품 ${m.works}`),
        momentOf[key] && h('p', { class: 'month-book__word' }, `“${momentOf[key]}”`))));
}) : [h('li', { class: 'empty' }, h('b', {}, '아직 올린 기록이 없어요'), h('p', { class: 'muted' }, '앨범 화면에서 첫 기록을 남겨 보세요.'))]));

// ---------------------------------------------------------------- 받은 동화·노래
$('#works').replaceChildren(...(works.length ? works.map((w) => {
  const r = recs.find((x) => x.id === w.record_id);
  return h('li', {},
    h('a', { class: 'work', href: `creation.html?id=${w.id}`, dataset: { status: w.status } },
      h('span', { class: 'work__kind' }, KIND[w.kind]),
      h('span', { class: 'work__title' }, w.status === 'ready' ? `「${w.title ?? KIND[w.kind]}」` : STATUS[w.status]),
      h('span', { class: 'muted' }, r ? `${fmtDate(r.record_date)} 「${r.title}」` : '')));
}) : [h('li', { class: 'muted' }, '아직 요청한 동화·노래가 없어요.')]));

// ---------------------------------------------------------------- 올린 사진
$('#photo-count').textContent = allPhotos.length ? `${allPhotos.length}장` : '';
const photosByDay = new Map();
for (const photo of allPhotos) {
  const day = photo.rec.record_date;
  if (!photosByDay.has(day)) photosByDay.set(day, []);
  photosByDay.get(day).push(photo);
}
const viewer = $('#photo-viewer');
const image = $('#viewer-image');
const previous = $('#viewer-prev');
const next = $('#viewer-next');
let viewing = [];
let active = 0;

function openPhoto(photos, index) {
  viewing = photos;
  setPhoto(index);
  viewer.showModal();
}

function setPhoto(index) {
  if (index < 0 || index >= viewing.length) return;
  active = index;
  const { path, rec } = viewing[index];
  image.src = urls[path];
  image.alt = rec.title;
  $('#viewer-caption').textContent = `${fmtDate(rec.record_date)} · ${rec.title} · ${index + 1} / ${viewing.length}`;
  previous.disabled = index === 0;
  next.disabled = index === viewing.length - 1;
  if (document.activeElement === previous && previous.disabled) next.focus();
  if (document.activeElement === next && next.disabled) previous.focus();
}

previous.addEventListener('click', () => setPhoto(active - 1));
next.addEventListener('click', () => setPhoto(active + 1));
viewer.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  setPhoto(active + (event.key === 'ArrowLeft' ? -1 : 1));
});

const book = $('#photo-book');
const bookPage = $('#photo-book-page');
const bookPrev = $('#photo-book-prev');
const bookNext = $('#photo-book-next');
const bookPages = [];
const PHOTOS_PER_BOOK_PAGE = 6;
let bookIndex = 0;

function showBookPage(index) {
  const page = bookPages[index];
  if (!page) return;
  const direction = index > bookIndex ? 'next' : 'prev';
  const turnClass = book.open && index !== bookIndex ? ` photo-leaf--${direction}` : '';
  bookIndex = index;
  const photos = page.photos.slice(page.start, page.start + PHOTOS_PER_BOOK_PAGE);
  bookPage.replaceChildren(h('article', { class: `photo-leaf${turnClass}` },
    h('h3', { class: 'photo-leaf__date' }, h('time', { datetime: page.day }, page.date)),
    h('div', { class: 'photo-leaf__grid', dataset: { size: photos.length } },
      photos.map(({ path, rec }, i) => h('button', {
        class: 'photo-leaf__frame', type: 'button', 'aria-label': `${rec.title} · ${page.start + i + 1}번째 사진 크게 보기`,
        onclick: () => openPhoto(page.photos, page.start + i),
      }, h('img', { src: urls[path], alt: '', decoding: 'async' })))),
    h('ul', { class: 'photo-leaf__notes' },
      [...new Set(photos.map(({ rec }) => rec.title))].map((title) => h('li', {}, title)))));
  $('#photo-book-count').textContent = `${page.date} · ${index + 1} / ${bookPages.length}쪽`;
  bookPrev.setAttribute('aria-disabled', String(index === 0));
  bookNext.setAttribute('aria-disabled', String(index === bookPages.length - 1));
}

function openBook(index) {
  showBookPage(index);
  book.showModal();
}

bookPrev.addEventListener('click', () => showBookPage(bookIndex - 1));
bookNext.addEventListener('click', () => showBookPage(bookIndex + 1));
book.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  showBookPage(bookIndex + (event.key === 'ArrowLeft' ? -1 : 1));
});

const daySections = [...photosByDay].map(([day, photos]) => {
  const date = `${day.slice(0, 4)}년 ${fmtDate(day)}`;
  const available = photos.filter((photo) => urls[photo.path]);
  const firstPage = bookPages.length;
  for (let start = 0; start < available.length; start += PHOTOS_PER_BOOK_PAGE) {
    bookPages.push({ day, date, photos: available, start });
  }
  return h('section', { class: 'photo-day', id: `photos-${day}` },
    h('h3', { class: 'photo-day__title' }, h('time', { datetime: day }, date),
      h('span', { class: 'muted' }, `${photos.length}장`),
      available.length > 0 && h('button', { class: 'photo-day__book btn--text', type: 'button', onclick: () => openBook(firstPage) }, '포토북에서 보기')),
    h('div', { class: 'photo-wall' }, ...available.map((photo, index) =>
      h('button', {
        class: 'photo-thumb', type: 'button', 'aria-label': `${photo.rec.title} · ${index + 1}번째 사진 크게 보기`,
        onclick: () => openPhoto(available, index),
      }, h('img', { src: urls[photo.path], alt: '', loading: 'lazy', decoding: 'async' })))),
    available.length < photos.length && h('p', { class: 'muted' }, '일부 사진을 불러오지 못했어요. 새로고침해서 다시 시도해 주세요.'));
});
$('#photo-book-open').hidden = !bookPages.length;
$('#photo-book-open').addEventListener('click', () => openBook(0));
$('#photos').replaceChildren(...(daySections.length ? daySections : [h('p', { class: 'muted' }, '아직 올린 사진이 없어요.')]));
document.getElementById(location.hash.slice(1))?.scrollIntoView();
