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
  sb.from('records').select('id, record_date, title, photo_paths').eq('child_id', child.id).order('record_date', { ascending: false }),
  sb.from('creations').select('id, record_id, kind, status, title, created_at').eq('user_id', user.id).neq('status', 'failed').order('created_at', { ascending: false }),
  sb.from('moments').select('month, favorite_word').eq('child_id', child.id),
]);
if (error) toast(`불러오지 못했어요: ${error.message}`, 'error');

const recs = records ?? [];
const works = creations ?? [];
const allPhotos = recs.flatMap((r) => r.photo_paths.map((p) => ({ path: p, rec: r })));
$('#summary').textContent = `기록 ${recs.length}개 · 사진 ${allPhotos.length}장 · 받은 작품 ${works.filter((w) => w.status === 'ready').length}개`;

// 사진 주소는 한 번에 (최대 300장)
const urls = await photoUrls(allPhotos.slice(0, 300).map((p) => p.path));

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
$('#photos').replaceChildren(...(allPhotos.length ? allPhotos.filter((p) => urls[p.path]).map((p) =>
  h('a', { href: `index.html?m=${p.rec.record_date.slice(0, 7)}`, title: `${fmtDate(p.rec.record_date)} ${p.rec.title}` },
    h('img', { src: urls[p.path], alt: `${fmtDate(p.rec.record_date)} ${p.rec.title}`, loading: 'lazy' })))
  : [h('p', { class: 'muted' }, '아직 올린 사진이 없어요.')]));
