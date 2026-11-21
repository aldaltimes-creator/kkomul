// 우리 아이 앨범: 아이 소개, 달별 기록, 이달의 순간, 동화·노래 만들기
import {
  sb, guardConfig, requireUser, h, $, toast, ymd, monthStart, fmtDate, fmtMonth,
  ageLabel, photoUrls, creditStatus, busy, processSteps,
} from './lib.js';

if (!guardConfig()) await new Promise(() => {}); // 설정 전에는 여기서 멈춤
const user = await requireUser();

const state = {
  child: null,
  // 모아보기에서 ?m=YYYY-MM 으로 들어오면 그 달을 보여 줌
  month: /^\d{4}-\d{2}$/.test(new URLSearchParams(location.search).get('m') ?? '')
    ? new Date(`${new URLSearchParams(location.search).get('m')}-01T00:00:00`)
    : monthStart(new Date()),
  credit: null,
  moment: null,
  pendingPhotos: [], // { file, url }
};

// ---------------------------------------------------------------- 아이
async function loadChild() {
  const { data, error } = await sb.from('children').select('*').eq('user_id', user.id).order('created_at').limit(1);
  if (error) throw error;
  state.child = data[0] ?? null;
}

$('#child-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const likes = String(f.get('likes') ?? '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const btn = e.target.querySelector('button[type=submit]');
  await busy(btn, '저장하는 중…', async () => {
    const { data, error } = await sb.from('children').insert({
      name: String(f.get('name')).trim(),
      birth_date: f.get('birth_date') || null,
      likes,
      family_call: String(f.get('family_call') ?? '').trim() || null,
    }).select().single();
    if (error) return toast(`저장하지 못했어요: ${error.message}`, 'error');
    state.child = data;
    await showDash();
  });
});

// ---------------------------------------------------------------- 이용권
function renderPlan() {
  const box = $('#plan-box');
  const c = state.credit;
  box.replaceChildren();
  box.classList.toggle('plan-box--none', !c);
  if (!c) {
    box.append(
      h('p', { class: 'plan-box__name' }, '이용권이 없어요'),
      h('p', { class: 'muted' }, '기록은 남길 수 있어요. 동화·노래를 만들려면 이용권을 골라 주세요.'),
      h('a', { class: 'btn btn--primary btn--sm', href: 'plans.html', style: 'margin-top:8px' }, '이용권 고르기'),
    );
  } else {
    const end = new Date(c.ends_at);
    box.append(
      h('p', { class: 'plan-box__name' }, c.plan_name),
      h('p', { class: 'plan-box__left' },
        h('span', {}, '동화 ', h('b', {}, `${c.stories_left}편`), ' 남음'),
        h('span', {}, '노래 ', h('b', {}, `${c.songs_left}곡`), ' 남음')),
      h('p', { class: 'muted' }, `${end.getMonth() + 1}월 ${end.getDate()}일까지`),
    );
  }
  const notice = $('#save-notice');
  notice.hidden = !(c && !c.saves_album);
  notice.textContent = '기존 체험권의 앨범 보관 조건은 이용권 안내를 확인해 주세요.';
}

// ---------------------------------------------------------------- 달 이동
const monthEnd = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
$('#prev-month').addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); loadMonth(); });
$('#next-month').addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); loadMonth(); });

// ---------------------------------------------------------------- 이달의 순간
function renderMoments() {
  const m = state.moment ?? {};
  const items = [['가장 좋아한 말', m.favorite_word], ['이번 달에 처음으로 말한 말', m.first_word], ['이번 달에 처음으로 한 행동', m.first_action]];
  $('#moment-list').replaceChildren(...items.map(([label, v]) =>
    h('div', { class: 'moment-item' },
      h('dt', {}, label),
      h('dd', { class: v ? '' : 'is-empty' }, v ? (label.includes('말') ? `“${v}”` : v) : '아직 비어 있어요'))));
  $('#edit-moments').textContent = state.moment ? '고치기' : '적기';
}

$('#edit-moments').addEventListener('click', () => {
  const f = $('#moment-form');
  const m = state.moment ?? {};
  f.favorite_word.value = m.favorite_word ?? '';
  f.first_word.value = m.first_word ?? '';
  f.first_action.value = m.first_action ?? '';
  $('#moment-dialog-title').textContent = `${state.month.getMonth() + 1}월의 순간`;
  $('#moment-dialog').showModal();
});

$('#moment-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const row = {
    child_id: state.child.id,
    month: ymd(state.month),
    favorite_word: String(f.get('favorite_word')).trim() || null,
    first_word: String(f.get('first_word')).trim() || null,
    first_action: String(f.get('first_action')).trim() || null,
    updated_at: new Date().toISOString(),
  };
  await busy(e.submitter, '저장하는 중…', async () => {
    const { data, error } = await sb.from('moments').upsert(row, { onConflict: 'child_id,month' }).select().single();
    if (error) return toast(`저장하지 못했어요: ${error.message}`, 'error');
    state.moment = data;
    renderMoments();
    $('#moment-dialog').close();
    toast('이달의 순간을 남겼어요');
  });
});

// ---------------------------------------------------------------- 기록 목록
const KIND = { story: '동화', song: '노래', bundle: '동화 + 노래' };

async function loadMonth() {
  $('#month-label').textContent = fmtMonth(state.month);
  $('#next-month').disabled = state.month >= monthStart(new Date());
  const list = $('#records');
  list.replaceChildren(h('p', { class: 'muted' }, '불러오는 중…'));

  const [recRes, momRes] = await Promise.all([
    sb.from('records').select('*')
      .eq('child_id', state.child.id)
      .gte('record_date', ymd(state.month)).lte('record_date', ymd(monthEnd(state.month)))
      .order('record_date', { ascending: false }).order('created_at', { ascending: false }),
    sb.from('moments').select('*').eq('child_id', state.child.id).eq('month', ymd(state.month)).maybeSingle(),
  ]);
  if (recRes.error) return list.replaceChildren(h('p', { class: 'muted' }, `불러오지 못했어요: ${recRes.error.message}`));
  state.moment = momRes.data ?? null;
  renderMoments();

  const records = recRes.data;
  if (!records.length) {
    list.replaceChildren(h('div', { class: 'empty' },
      h('b', {}, `${state.month.getMonth() + 1}월 기록이 아직 없어요`),
      h('p', { class: 'muted' }, '한 달에 3~4번, 사진과 그날 있었던 일을 남겨 보세요.')));
    return;
  }

  const ids = records.map((r) => r.id);
  const [{ data: creations }, urls] = await Promise.all([
    sb.from('creations').select(state.credit?.plan_code === 'story_song_bundle'
      ? 'id, record_id, kind, status, title, bundle_id, subscription_id'
      : 'id, record_id, kind, status, title').in('record_id', ids).order('created_at'),
    photoUrls(records.map((r) => r.photo_paths[0]).filter(Boolean)),
  ]);
  // 취소된 요청은 앨범에서 숨김 (횟수는 이미 돌려받음)
  list.replaceChildren(...records.map((r) => recordCard(r, urls,
    (creations ?? []).filter((c) => c.record_id === r.id && c.status !== 'failed'))));
}

function recordCard(r, urls, made) {
  const cover = r.photo_paths[0] && urls[r.photo_paths[0]];
  const c = state.credit;
  const bundlePlan = c?.plan_code === 'story_song_bundle';
  const existingPair = made.find((item) => item.bundle_id && item.subscription_id === c?.subscription_id);
  const canRequestBundle = bundlePlan && ((c.stories_left > 0 && c.songs_left > 0)
    || (existingPair?.kind === 'song' && c.stories_left > 0)
    || (existingPair?.kind === 'story' && c.songs_left > 0));
  const makeBtn = (kind) => {
    const left = c ? (kind === 'story' ? c.stories_left : c.songs_left) : 0;
    return h('button', {
      class: 'btn btn--ghost btn--sm', type: 'button', disabled: !c || left < 1,
      title: !c ? '이용권이 필요해요' : left < 1 ? `이번 기간 ${KIND[kind]} 요청을 모두 썼어요` : null,
      onclick: () => askMake(r, kind),
    }, `${KIND[kind]} 요청`);
  };
  const STATUS_LABEL = { pending: '요청됨', making: '만드는 중', failed: '취소됨' };

  return h('article', { class: 'card rec' },
    cover
      ? h('img', { class: 'rec__photo', src: cover, alt: `${r.title} 사진`, loading: 'lazy' })
      : h('div', { class: 'rec__photo rec__photo--empty' }, '사진 없음'),
    h('div', { class: 'rec__body' },
      h('p', { class: 'rec__date' }, `${fmtDate(r.record_date)}${r.photo_paths.length > 1 ? ` · 사진 ${r.photo_paths.length}장` : ''}`),
      h('h3', { class: 'rec__title' }, r.title),
      h('p', { class: 'rec__text' }, r.happened),
      r.child_words && h('p', { class: 'rec__words' }, `“${r.child_words}”`),
      r.worry && h('p', { class: 'rec__worry' }, h('b', {}, '힘들어하는 것 '), r.worry),
      h('div', { class: 'rec__actions' },
        r.photo_paths.length > 0 && h('a', {
          class: 'btn btn--ghost btn--sm', href: `albums.html#photos-${r.record_date}`,
        }, `사진 ${r.photo_paths.length}장 보기`),
        ...made.map((m) => h('a', {
          class: 'made-link', href: `creation.html?id=${m.id}`, dataset: { status: m.status },
        }, m.status === 'ready' ? `${KIND[m.kind]} 「${m.title}」` : `${KIND[m.kind]} ${STATUS_LABEL[m.status]}`)),
        bundlePlan ? h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', disabled: !canRequestBundle,
          onclick: () => askMake(r, 'bundle'),
        }, '동화 + 노래 함께 요청') : [makeBtn('story'), makeBtn('song')],
        h('button', { class: 'btn--text', type: 'button', style: 'margin-left:auto;color:var(--ink-sub)', onclick: () => removeRecord(r) }, '지우기'),
      )));
}

async function removeRecord(r) {
  if (!confirm(`「${r.title}」 기록을 지울까요? 사진도 함께 지워지고 되돌릴 수 없어요.`)) return;
  const { error } = await sb.from('records').delete().eq('id', r.id);
  if (error) return toast(`지우지 못했어요: ${error.message}`, 'error');
  if (r.photo_paths.length) await sb.storage.from('record-photos').remove(r.photo_paths);
  toast('기록을 지웠어요');
  loadMonth();
}

// ---------------------------------------------------------------- 동화·노래 요청
let makeTarget = null;

// 요청 메모 예시: {name} 은 아이 이름으로 바뀜
const MAKE_EXAMPLES = {
  song: [
    { tag: '신나는 노래', text: "후렴구에 '위잉위잉'을 넣어 주세요. 신나는 노래로 해 주시고, 우리 아이 이름 '{name}'{j:이/가} 노래에 나오게 해 주세요. 엄마를 '마미'라고 부르는데 '마미'라는 말도 넣어 주세요." },
    { tag: '자장가', text: "잠들기 전에 들려줄 잔잔한 자장가로 해 주세요. '사랑해 우리 {name}, 잘 자요 {name}'처럼 아이 이름을 부르는 소절이 반복되면 좋겠어요. 1분 정도로 짧게, 피아노 반주면 좋겠어요." },
    { tag: '습관 노래', text: "양치하기 싫어해서 양치할 때 같이 부를 노래가 필요해요. 박자가 빠르고 율동하기 좋게, 후렴은 '치카치카 반짝반짝'으로 해 주세요. 마지막엔 '{name} 이가 반짝!'으로 끝나면 좋겠어요." },
    { tag: '가족 노래', text: "아빠, 마미, 할머니가 다 나오는 노래로 만들어 주세요. 아이가 요즘 자주 하는 말 '꼭 안아!'를 가사에 넣어 주시고, 따라 부르기 쉬운 짧은 멜로디였으면 해요." },
  ],
  story: [
    { tag: '모험 이야기', text: "'{name}'{j:이/가} 꼬마 소방관이 되어 친구들을 구하는 모험 이야기로 해 주세요. 제일 좋아하는 빨간 소방차 '빵빵이'가 꼭 나오고, 마지막엔 마미에게 꼭 안기며 끝났으면 좋겠어요. 10쪽 정도면 좋겠어요." },
    { tag: '용기 주는 이야기', text: "요즘 어린이집 가는 걸 무서워해서 용기를 주는 이야기면 좋겠어요. 아이가 한 말 '나 혼자 할 수 있어!'를 꼭 넣어 주시고, 그림은 따뜻한 수채화 느낌으로 부탁드려요." },
    { tag: '잠자리 동화', text: "잠자리에서 읽어 줄 짧은 동화로 해 주세요. 그날 본 강아지 '몽이'와 밤하늘 별님이 나오고, 문장은 짧게, '멍멍', '반짝반짝' 같은 소리 흉내 말이 많았으면 좋겠어요." },
    { tag: '습관 동화', text: "편식을 해서 채소와 친해지는 이야기를 부탁드려요. 브로콜리 나무 숲을 여행하는 '{name}'의 이야기로, 혼내는 느낌 없이 재미있게요. 주인공 얼굴은 올린 사진처럼 동그란 단발머리로 그려 주세요." },
  ],
};

// 예시 글에 아이 이름 넣기: {name}, {j:이/가} 는 이름 받침에 맞춰 고름
function fillName(text, name) {
  const code = name.charCodeAt(name.length - 1) - 0xac00;
  const batchim = code >= 0 && code <= 11171 && code % 28 !== 0;
  return text.replaceAll('{name}', name).replace(/\{j:([^/}]*)\/([^}]*)\}/g, (_, a, b) => (batchim ? a : b));
}

function renderExamples(kind) {
  const name = state.child?.name || '우리 아이';
  const note = $('#make-note');
  note.placeholder = `예) ${fillName(MAKE_EXAMPLES[kind][0].text, name)}`;
  $('#make-examples').replaceChildren(...MAKE_EXAMPLES[kind].map((ex) => {
    const text = fillName(ex.text, name);
    return h('li', {}, h('button', {
      type: 'button', class: 'example',
      onclick: () => {
        const cur = note.value.trim();
        note.value = (cur ? `${cur}\n${text}` : text).slice(0, 500);
        note.focus();
      },
    }, h('b', {}, ex.tag), h('span', {}, text)));
  }));
}

function askMake(record, kind) {
  makeTarget = { record, kind };
  const bundle = kind === 'bundle';
  const left = kind === 'story' ? state.credit.stories_left : state.credit.songs_left;
  $('#make-dialog-title').textContent = `${KIND[kind]} 요청`;
  $('#make-text').textContent = bundle
    ? `「${record.title}」 기록으로 동화와 노래를 함께 요청해요. 두 작품을 연결한 영상 파일도 제공돼요.`
    : `「${record.title}」 기록으로 ${KIND[kind]}를 요청해요. 이번 기간에 남은 ${KIND[kind]} ${left}${kind === 'story' ? '편' : '곡'} 중 1번을 써요.`;
  $('#make-note').value = '';
  $('#bundle-youtube-field').hidden = !bundle;
  $('#bundle-youtube').checked = false;
  renderExamples(bundle ? 'story' : kind);
  renderChips(bundle ? 'story' : kind);
  $('#make-process').replaceChildren(processSteps(-1));
  $('#make-dialog').showModal();
}

// ---------------------------------------------------------------- 자주 쓰는 문구 뱃지
// 문구를 누르면 메모 끝에 한 문장으로 붙이고, 다시 누르면 뺌
const thing = (word) => [word, fillName(`'${word}'{j:이/가} 나오게 해 주세요.`, word)];
const CHIP_GROUPS = {
  song: [
    { label: '분위기', items: [
      ['신나는 노래', '신나는 노래로 해 주세요.'],
      ['잔잔한 자장가', '잔잔한 자장가로 해 주세요.'],
      ['율동하기 좋게', '율동하기 좋은 빠른 박자로 해 주세요.'],
      ['쉬운 후렴', '따라 부르기 쉬운 짧은 후렴이면 좋겠어요.'],
      ['1분 정도', '1분 정도로 짧게 해 주세요.'],
      ['피아노 반주', '피아노 반주로 해 주세요.'],
    ] },
    { label: '가사에 꼭', items: [
      ['아이 이름 후렴에', '아이 이름이 후렴에 나오게 해 주세요.'],
      ['아이가 한 말', '아이가 한 말을 가사에 넣어 주세요.'],
      ["엄마는 '마미'", "엄마를 '마미'라고 불러 주세요."],
      ["아빠는 '대디'", "아빠를 '대디'라고 불러 주세요."],
      ['소리 흉내 말', "후렴에 '위잉위잉' 같은 소리 흉내 말을 넣어 주세요."],
      ["'사랑해' 반복", "'사랑해'라는 말이 반복되면 좋겠어요."],
    ] },
  ],
  story: [
    { label: '이야기', items: [
      ['모험 이야기', '모험 이야기로 해 주세요.'],
      ['용기 주는 이야기', '용기를 주는 이야기로 해 주세요.'],
      ['잠자리 동화', '잠자리에서 읽기 좋게 짧게 해 주세요.'],
      ['웃긴 장면 많이', '웃긴 장면이 많았으면 좋겠어요.'],
      ['아이가 한 말 대사로', '아이가 한 말을 대사로 넣어 주세요.'],
      ['10쪽 정도', '10쪽 정도면 좋겠어요.'],
    ] },
    { label: '그림', items: [
      ['수채화 느낌', '따뜻한 수채화 느낌으로 그려 주세요.'],
      ['알록달록 밝게', '알록달록 밝은 색으로 그려 주세요.'],
      ['사진 속 아이처럼', '주인공을 올린 사진 속 아이처럼 그려 주세요.'],
      ['그림 크게, 글 짧게', '그림을 크게, 글은 짧게 해 주세요.'],
    ] },
  ],
  common: [
    { label: '남자아이 인기', items: ['공룡', '소방차', '포크레인', '경찰차', '기차', '로봇', '우주선', '상어', '슈퍼히어로', '축구공'].map(thing) },
    { label: '여자아이 인기', items: ['공주', '유니콘', '무지개', '요정', '토끼', '인어공주', '고양이', '발레리나', '꽃밭', '반짝이 리본'].map(thing) },
    { label: '가족·습관', items: [
      ['엄마 아빠 함께', '엄마 아빠가 함께 나오게 해 주세요.'],
      ['할머니 할아버지', '할머니 할아버지도 나오게 해 주세요.'],
      ['형제자매', '형제자매도 함께 나오게 해 주세요.'],
      ['양치 습관', '양치 습관을 즐겁게 알려 주세요.'],
      ['편식 고치기', '편식하지 않게 도와주는 내용이면 좋겠어요.'],
      ['혼자 자기', '혼자 자는 용기를 주는 내용이면 좋겠어요.'],
      ['어린이집 적응', '어린이집에 즐겁게 가는 내용이면 좋겠어요.'],
      ['인사 잘하기', '인사를 잘하는 내용이면 좋겠어요.'],
    ] },
  ],
};

function renderChips(kind) {
  const note = $('#make-note');
  const has = (t) => note.value.includes(t);
  const groups = [...CHIP_GROUPS[kind], ...CHIP_GROUPS.common];
  const buttons = [];
  const sync = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(has(b.dataset.text))));
  $('#make-chips').replaceChildren(...groups.map((g) => h('div', { class: 'chip-group' },
    h('p', { class: 'chip-group__label' }, g.label),
    h('div', { class: 'chip-group__list' }, ...g.items.map(([short, t]) => {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', dataset: { text: t }, title: t, onclick: () => {
        note.value = has(t)
          ? note.value.replace(t, '').replace(/[ \n]{2,}/g, ' ').trim()
          : `${note.value.trim()}${note.value.trim() ? ' ' : ''}${t}`.slice(0, 500);
        sync();
      } }, short);
      buttons.push(b);
      return b;
    })))));
  note.oninput = sync;
  sync();
}

$('#make-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'make' || !makeTarget) return;
  e.preventDefault();
  const { record, kind } = makeTarget;
  await busy(e.submitter, '요청하는 중…', async () => {
    const params = { p_record: record.id, p_note: $('#make-note').value.trim() || null };
    const { error } = kind === 'bundle'
      ? await sb.rpc('request_creation_bundle', { ...params, p_youtube: $('#bundle-youtube').checked })
      : await sb.rpc('request_creation', { ...params, p_kind: kind });
    if (error) {
      const m = error.message;
      toast(m.includes('NO_BUNDLE_PLAN') ? '동화와 노래를 함께 요청하려면 동시 제작 이용권을 먼저 골라 주세요.'
        : m.includes('NO_PLAN') ? '이용권이 없어요. 이용권을 먼저 골라 주세요.'
        : m.includes('NO_CREDIT') ? `이번 기간 ${KIND[kind]} 요청을 모두 썼어요.`
        : `요청하지 못했어요: ${m}`, 'error');
      return;
    }
    makeTarget = null;
    $('#make-dialog').close();
    $('#made-text').textContent = `「${record.title}」 기록으로 ${KIND[kind]}를 요청했어요. 정성껏 만들어 드릴게요.`;
    $('#made-process').replaceChildren(processSteps(1));
    $('#made-dialog').showModal();
    await refreshCredit();
    loadMonth();
  });
});

async function refreshCredit() {
  try { state.credit = await creditStatus(); } catch { state.credit = null; }
  renderPlan();
}

// ---------------------------------------------------------------- 기록 쓰기
const MAX_PHOTOS = 10;

$('#new-record').addEventListener('click', () => {
  const f = $('#record-form');
  f.reset();
  const today = new Date();
  // 보고 있는 달이 이번 달이 아니면 그달 1일로
  f.record_date.value = monthStart(today).getTime() === state.month.getTime() ? ymd(today) : ymd(state.month);
  clearPhotos();
  $('#record-dialog').showModal();
});

function clearPhotos() {
  state.pendingPhotos.forEach((p) => URL.revokeObjectURL(p.url));
  state.pendingPhotos = [];
  renderPhotoPick();
}

function renderPhotoPick() {
  const pick = $('#photo-pick');
  pick.replaceChildren(
    ...state.pendingPhotos.map((p, i) => h('button', {
      type: 'button', class: 'photo-pick__remove', 'aria-label': `${i + 1}번째 사진 빼기`,
      onclick: () => {
        URL.revokeObjectURL(p.url);
        state.pendingPhotos.splice(i, 1);
        renderPhotoPick();
        (pick.children[i] ?? pick.lastElementChild ?? $('#photo-browse')).focus();
      },
    }, h('img', { src: p.url, alt: '' }), h('span', { 'aria-hidden': 'true' }, '×'))),
  );
  $('#photo-actions').hidden = state.pendingPhotos.length >= MAX_PHOTOS;
  $('#photo-count').textContent = state.pendingPhotos.length
    ? `${state.pendingPhotos.length} / ${MAX_PHOTOS}장 선택됨`
    : '';
}

function addPhotos(e) {
  for (const file of e.target.files) {
    if (state.pendingPhotos.length >= MAX_PHOTOS) break;
    if (!file.type.startsWith('image/')) continue;
    state.pendingPhotos.push({ file, url: URL.createObjectURL(file) });
  }
  e.target.value = '';
  renderPhotoPick();
  if ($('#photo-actions').hidden) $('#photo-pick').lastElementChild?.focus();
}

for (const [button, input] of [['#photo-browse', '#photo-input'], ['#photo-capture', '#camera-input']]) {
  $(button).addEventListener('click', () => $(input).click());
  $(input).addEventListener('change', addPhotos);
}
$('#record-dialog').addEventListener('close', clearPhotos);
$('#record-dialog').addEventListener('cancel', (event) => {
  if ($('#record-save').disabled) event.preventDefault();
});

// 긴 변 1600px JPEG로 줄여서 올림 (읽지 못하는 형식은 원본 그대로)
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = Object.assign(document.createElement('canvas'), {
      width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale),
    });
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return blob ? { blob, ext: 'jpg', type: 'image/jpeg' } : { blob: file, ext: file.name.split('.').pop(), type: file.type };
  } catch {
    return { blob: file, ext: (file.name.split('.').pop() || 'jpg').toLowerCase(), type: file.type };
  }
}

$('#record-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const form = e.target;
  if (!form.reportValidity()) return;
  const f = new FormData(form);
  const id = crypto.randomUUID();
  const uploaded = [];

  await busy(e.submitter, '저장하는 중…', async () => {
    const dismissButtons = form.querySelectorAll('button[value="cancel"]');
    dismissButtons.forEach((button) => { button.disabled = true; });
    try {
      for (const [i, p] of state.pendingPhotos.entries()) {
        const { blob, ext, type } = await shrink(p.file);
        const path = `${user.id}/${id}/${i + 1}.${ext}`;
        const { error } = await sb.storage.from('record-photos').upload(path, blob, { contentType: type, upsert: false });
        if (error) throw new Error(`사진을 올리지 못했어요: ${error.message}`);
        uploaded.push(path);
      }
      const { error } = await sb.from('records').insert({
        id,
        child_id: state.child.id,
        record_date: f.get('record_date'),
        title: String(f.get('title')).trim(),
        happened: String(f.get('happened')).trim(),
        child_words: String(f.get('child_words')).trim() || null,
        worry: String(f.get('worry')).trim() || null,
        photo_paths: uploaded,
      });
      if (error) throw new Error(`저장하지 못했어요: ${error.message}`);

      $('#record-dialog').close();
      clearPhotos();
      toast('기록을 남겼어요');
      const d = new Date(`${f.get('record_date')}T00:00:00`);
      state.month = monthStart(d);
      loadMonth();
    } catch (err) {
      if (uploaded.length) await sb.storage.from('record-photos').remove(uploaded);
      toast(err.message, 'error');
    } finally {
      dismissButtons.forEach((button) => { button.disabled = false; });
    }
  });
});

// ---------------------------------------------------------------- 시작
async function showDash() {
  $('#onboard').hidden = true;
  $('#dash').hidden = false;
  const c = state.child;
  $('#kid-initial').textContent = c.name.slice(-2, -1) || c.name[0];
  $('#kid-name').textContent = `${c.name}${ageLabel(c.birth_date) ? ` · ${ageLabel(c.birth_date)}` : ''}`;
  $('#kid-likes').replaceChildren(...c.likes.map((l) => h('span', {}, l)));
  await refreshCredit();
  await loadMonth();
}

try {
  await loadChild();
  if (state.child) await showDash();
  else $('#onboard').hidden = false;
} catch (err) {
  toast(`불러오지 못했어요: ${err.message}`, 'error');
}
