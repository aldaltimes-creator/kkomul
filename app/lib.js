// 꼬물상자 앱 공통: Supabase 클라이언트, 로그인 확인, 작은 도우미들
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR-ANON-KEY');

export const sb = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// 설정 전이면 안내 띠를 보여 주고 멈춤
export function guardConfig() {
  if (configured) return true;
  const bar = document.createElement('div');
  bar.className = 'setup-bar';
  bar.innerHTML = '<b>Supabase 연결이 아직 안 됐어요.</b> <code>app/config.js</code>에 프로젝트 URL과 anon 키를 넣어 주세요. 자세한 방법은 <code>supabase/SETUP.md</code>에 있어요.';
  document.body.prepend(bar);
  return false;
}

// 로그인한 사용자 (없으면 로그인 화면으로)
export async function requireUser() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    location.replace(`login.html?next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`);
    return new Promise(() => {}); // 이동하는 동안 아래 코드가 돌지 않게
  }
  decorateNav();
  return session.user;
}

// 모든 앱 화면의 상단 메뉴를 같은 모양으로: 앨범 · 모아보기 · 이용권 · 계정 · (관리) · 소개 · 로그아웃
function decorateNav() {
  const nav = document.querySelector('.app-top__nav');
  if (!nav || nav.dataset.ready) return;
  nav.dataset.ready = '1';
  const page = location.pathname.split('/').pop() || 'index.html';
  const links = [['index.html', '앨범'], ['albums.html', '모아보기'], ['plans.html', '이용권'], ['account.html', '계정']];
  const admin = nav.querySelector('a[href="admin.html"]'); // 관리 화면은 처음부터 들어 있음
  nav.replaceChildren(...links.map(([href, label]) => {
    const a = h('a', { href }, label);
    if (href === page) a.setAttribute('aria-current', 'page');
    return a;
  }));
  if (admin) nav.append(admin);
  const intro = h('a', { href: '../index.html', class: 'nav-intro' }, '소개');
  const out = h('button', { type: 'button', class: 'nav-logout', onclick: signOut }, '로그아웃');
  nav.append(intro, out);
  const menu = h('button', {
    type: 'button', class: 'app-top__toggle',
    'aria-controls': 'app-menu', 'aria-expanded': 'false',
  }, '메뉴');
  nav.id = 'app-menu';
  nav.before(menu);
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') === 'true';
    menu.setAttribute('aria-expanded', String(!open));
  });
  nav.parentElement.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || menu.getAttribute('aria-expanded') !== 'true' || !menu.offsetWidth) return;
    menu.setAttribute('aria-expanded', 'false');
    menu.focus();
  });
  addAdminLink(nav, intro);
}

// 관리자 계정이면 '관리' 링크를 붙임
async function addAdminLink(nav, before) {
  if (nav.querySelector('a[href="admin.html"]')) return;
  const { data: isAdmin } = await sb.rpc('is_admin');
  if (!isAdmin || nav.querySelector('a[href="admin.html"]')) return;
  nav.insertBefore(h('a', { href: 'admin.html' }, '관리'), before);
}

export async function signOut() {
  // 서버 세션이 이미 끊긴 경우에도 이 기기에서는 꼭 로그아웃되게 저장된 토큰을 지움
  try { await sb.auth.signOut({ scope: 'local' }); } catch { /* 무시 */ }
  try { Object.keys(localStorage).filter((k) => /^sb-.*-auth-token/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch { /* 무시 */ }
  location.replace('../index.html');
}

// DOM 도우미: 텍스트는 언제나 textContent로 넣어 사용자 입력이 HTML로 해석되지 않게
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function songCoverPath(media, preferred) {
  return media.find((item) => item.type === 'image' && item.path === preferred)?.path
    ?? media.find((item) => item.type === 'image')?.path;
}

// 알림 한 줄
let toastTimer;
export function toast(msg, kind = 'info') {
  let t = $('.toast');
  if (!t) { t = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg;
  t.dataset.kind = kind;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 3600);
}

// 날짜
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const fmtDate = (s) => { const d = new Date(`${s}T00:00:00`); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
export const fmtMonth = (d) => `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
export const won = (n) => `${n.toLocaleString('ko-KR')}원`;

export function ageLabel(birth) {
  if (!birth) return '';
  const b = new Date(`${birth}T00:00:00`); const n = new Date();
  const m = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth()) - (n.getDate() < b.getDate() ? 1 : 0);
  if (m < 0) return '';
  return m < 36 ? `${m}개월` : `${Math.floor(m / 12)}살`;
}

// 비공개 사진 주소 (1시간짜리 서명 URL)
export async function photoUrls(paths) {
  if (!paths?.length) return {};
  const { data, error } = await sb.storage.from('record-photos').createSignedUrls(paths, 3600);
  if (error) return {};
  return Object.fromEntries(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}

// 지금 이용권과 남은 횟수
export async function creditStatus() {
  const { data, error } = await sb.rpc('credit_status');
  if (error) throw error;
  return data?.[0] ?? null;
}

// 버튼을 잠깐 '진행 중' 상태로
export async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = label;
  try { return await fn(); }
  finally { btn.disabled = false; btn.textContent = old; }
}

// ---------------------------------------------------------------- 동화·노래 만드는 순서
export const PROCESS_STEPS = [
  { title: '요청 접수', desc: '요청이 관리자에게 바로 전달돼요.' },
  { title: '필요하면 연락', desc: '추가 설명이 필요하면 가입한 이메일로 관리자가 연락드려요.' },
  { title: '초안 작성', desc: '기록과 바라는 점을 바탕으로 초안을 만들어요.' },
  { title: '확인(컨펌)', desc: '초안을 보여 드리고, 고칠 곳이 있으면 반영해요.' },
  { title: '사이트에 올려 드려요', desc: '완성되면 앨범에서 바로 보고 들을 수 있어요.' },
];

// current: 지금 진행 중인 단계 번호(0부터). 그 앞은 끝난 단계로 표시
export function processSteps(current = -1) {
  return h('ol', { class: 'steps' }, ...PROCESS_STEPS.map((s, i) => h('li', {
    class: `steps__item${i < current ? ' is-done' : i === current ? ' is-now' : ''}`,
    'aria-current': i === current ? 'step' : null,
  },
  h('span', { class: 'steps__dot', 'aria-hidden': 'true' }, i < current ? '✓' : `${i + 1}`),
  h('span', { class: 'steps__body' }, h('b', {}, s.title), h('span', {}, s.desc)))));
}
