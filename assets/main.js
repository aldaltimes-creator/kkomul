// 꼬물상자 랜딩 — 탭, 샘플 노래 재생, 동화 넘김
(() => {
  // 헤더 스크롤 구분선
  const top = document.querySelector('.top');
  const onScroll = () => top.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // 탭 (화살표 키 이동 지원): 탭 묶음(tablist)마다 따로 동작
  document.querySelectorAll('[role="tablist"]').forEach((list) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const select = (tab) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', on);
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
      const video = document.getElementById('sample-video');
      if (video && list.contains(document.getElementById('tab-song'))) {
        if (tab.id !== 'tab-song' && video.hasAttribute('src')) {
          video.dataset.src = video.getAttribute('src');
          video.removeAttribute('src');
        } else if (tab.id === 'tab-song' && !video.hasAttribute('src')) {
          video.src = video.dataset.src;
        }
      }
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!dir) return;
        const next = tabs[(i + dir + tabs.length) % tabs.length];
        next.focus();
        select(next);
      });
    });
  });

  document.querySelector('[data-sample-video-link]')?.addEventListener('click', () => {
    document.getElementById('tab-song').click();
  });

  // [data-pager] 안의 [data-page]를 한 장씩 보여 줌
  document.querySelectorAll('[data-pager]').forEach((root) => {
    const pages = [...root.querySelectorAll('[data-page]')];
    const prev = root.querySelector('[data-prev]');
    const next = root.querySelector('[data-next]');
    const count = root.querySelector('[data-count]');
    let page = 0;
    const go = (n) => {
      page = Math.max(0, Math.min(pages.length - 1, n));
      pages.forEach((p, i) => p.classList.toggle('is-active', i === page));
      count.textContent = `${page + 1} / ${pages.length}`;
      prev.disabled = page === 0;
      next.disabled = page === pages.length - 1;
    };
    prev.addEventListener('click', () => go(page - 1));
    next.addEventListener('click', () => go(page + 1));
    go(0);
  });

})();
