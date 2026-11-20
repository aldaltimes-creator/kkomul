// 로그인 / 회원가입 / 비밀번호 재설정 메일
import { sb, guardConfig, $ } from './lib.js';

const ok = guardConfig();
const form = $('#auth-form');
const email = $('#email');
const password = $('#password');
const submit = $('#submit');
const msg = $('#msg');
const tabIn = $('#tab-in');
const tabUp = $('#tab-up');
let mode = 'in';

const params = new URLSearchParams(location.search);
// 같은 사이트 안의 앱 화면으로만 돌려보냄
const next = /^[a-z-]+\.html(\?[\w=&%-]*)?$/.test(params.get('next') ?? '') ? params.get('next') : 'index.html';

const say = (text, kind = 'info') => { msg.textContent = text; msg.dataset.kind = kind; };

function setMode(m) {
  mode = m;
  tabIn.setAttribute('aria-selected', m === 'in');
  tabUp.setAttribute('aria-selected', m === 'up');
  tabIn.tabIndex = m === 'in' ? 0 : -1;
  tabUp.tabIndex = m === 'up' ? 0 : -1;
  form.setAttribute('aria-labelledby', m === 'in' ? 'tab-in' : 'tab-up');
  submit.textContent = m === 'in' ? '로그인' : '가입하기';
  password.autocomplete = m === 'in' ? 'current-password' : 'new-password';
  $('#forgot').hidden = m === 'up';
  say('');
}
tabIn.addEventListener('click', () => setMode('in'));
tabUp.addEventListener('click', () => setMode('up'));
[tabIn, tabUp].forEach((t) => t.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const other = t === tabIn ? tabUp : tabIn;
  other.focus(); setMode(other === tabIn ? 'in' : 'up');
}));
if (params.get('mode') === 'signup') setMode('up');

// 이미 로그인돼 있으면 바로 앱으로
if (ok) {
  const { data: { session } } = await sb.auth.getSession();
  if (session) location.replace(next);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!ok) return say('먼저 Supabase 연결 정보를 넣어 주세요.', 'error');
  if (!email.value || !email.checkValidity()) return say('이메일을 확인해 주세요.', 'error');
  if (password.value.length < 8) return say('비밀번호는 8자 이상이에요.', 'error');

  submit.disabled = true;
  say(mode === 'in' ? '로그인하는 중…' : '가입하는 중…');
  try {
    if (mode === 'in') {
      const { error } = await sb.auth.signInWithPassword({ email: email.value, password: password.value });
      if (error) throw error;
      location.replace(next);
    } else {
      const redirect = new URL('index.html', location.href).href;
      const { data, error } = await sb.auth.signUp({
        email: email.value, password: password.value, options: { emailRedirectTo: redirect },
      });
      if (error) throw error;
      if (data.session) location.replace('index.html');
      else say('확인 메일을 보냈어요. 메일의 링크를 누르면 가입이 끝나요.');
    }
  } catch (err) {
    const m = err.message ?? '';
    if (m.includes('Invalid login credentials')) say('이메일 또는 비밀번호가 맞지 않아요.', 'error');
    else if (m.includes('Email not confirmed')) say('메일함에서 가입 확인 링크를 먼저 눌러 주세요.', 'error');
    else if (m.includes('already registered')) say('이미 가입된 이메일이에요. 로그인해 주세요.', 'error');
    else say(`문제가 생겼어요: ${m}`, 'error');
  } finally {
    submit.disabled = false;
  }
});

// 카카오·구글로 시작하기: 그 회사 화면에서 로그인하고 돌아옴 (비밀번호는 꼬물상자에 오지 않음)
const NAMES = { kakao: '카카오', google: '구글' };
document.querySelectorAll('[data-provider]').forEach((btn) => btn.addEventListener('click', async () => {
  if (!ok) return say('먼저 Supabase 연결 정보를 넣어 주세요.', 'error');
  const provider = btn.dataset.provider;
  btn.disabled = true;
  say(`${NAMES[provider]}로 이동하는 중…`);
  const { error } = await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo: new URL(next, location.href).href },
  });
  if (error) {
    btn.disabled = false;
    say(error.message.includes('not enabled')
      ? `${NAMES[provider]} 로그인은 아직 준비 중이에요. 이메일로 시작해 주세요.`
      : `문제가 생겼어요: ${error.message}`, 'error');
  }
}));

// 간편 로그인에서 돌아왔는데 실패한 경우 (취소 등)
const back = new URLSearchParams(location.hash.slice(1));
if (back.get('error')) say(back.get('error_description')?.includes('email')
  ? '이메일 제공에 동의해야 가입할 수 있어요. 다시 시도해 주세요.'
  : '간편 로그인을 마치지 못했어요. 다시 시도해 주세요.', 'error');

$('#forgot').addEventListener('click', async () => {
  if (!ok) return;
  if (!email.value || !email.checkValidity()) return say('비밀번호를 찾을 이메일을 먼저 적어 주세요.', 'error');
  const { error } = await sb.auth.resetPasswordForEmail(email.value, {
    redirectTo: new URL('account.html', location.href).href,
  });
  say(error ? `문제가 생겼어요: ${error.message}` : '비밀번호를 다시 정하는 메일을 보냈어요.', error ? 'error' : 'info');
});
