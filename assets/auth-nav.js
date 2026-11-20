// 소개 페이지 헤더: 로그인돼 있으면 '로그인' 대신 '내 앨범'과 '로그아웃'을 보여 줌
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../app/config.js';

const box = document.querySelector('.top__actions');
const ready = window.supabase && box && !SUPABASE_URL.includes('YOUR-PROJECT');

if (ready) {
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    const login = box.querySelector('a[href="app/login.html"]');
    const start = box.querySelector('.btn');

    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'link link-btn';
    out.textContent = '로그아웃';
    out.addEventListener('click', async () => {
      out.disabled = true;
      try { await sb.auth.signOut({ scope: 'local' }); } catch { /* 무시 */ }
      try { Object.keys(localStorage).filter((k) => /^sb-.*-auth-token/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch { /* 무시 */ }
      location.reload();
    });
    login?.replaceWith(out);

    if (start) {
      start.textContent = '내 앨범';
      start.href = 'app/index.html';
    }
  }
}
