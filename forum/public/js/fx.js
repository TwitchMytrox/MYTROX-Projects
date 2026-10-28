/* turkac.org – visuelle Effekte (Klick-Ripple, Maus-Glow). Keine Abhängigkeiten, CSP-konform. */
(() => {
  'use strict';
  const mq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const off = () => (mq && mq.matches) || document.documentElement.dataset.motion === 'reduce';

  const BTN = '.btn, .mini-btn, .icon-btn, .link-btn, button.tab, .tab, .chip, .sort, .react, .set-tab, .menu-item, .user-btn, .dm-item, .back, .no, .nav, .burger, .modal-close, .lb-close';

  // Klick-Ripple per Event-Delegation
  document.addEventListener('pointerdown', (e) => {
    if (off() || (e.button !== undefined && e.button > 0)) return;
    const t = e.target instanceof Element ? e.target.closest(BTN) : null;
    if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    const r = t.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const size = Math.max(r.width, r.height) * 2;
    const s = document.createElement('span');
    s.className = 'fx-ripple';
    s.setAttribute('aria-hidden', 'true');
    s.style.width = s.style.height = size + 'px';
    s.style.left = (e.clientX - r.left - size / 2) + 'px';
    s.style.top = (e.clientY - r.top - size / 2) + 'px';
    t.appendChild(s);
    const done = () => s.remove();
    s.addEventListener('animationend', done, { once: true });
    setTimeout(done, 900);
  }, { passive: true });

  // Maus-Glow: --mx/--my (in %) auf Karten. Thread-Karten setzt app.js selbst.
  const GLOW = '.card, .post, .panel, .kpi, .stat, .modal, .hero';
  let raf = 0; let last = null;
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || off()) return;
    const c = e.target instanceof Element ? e.target.closest(GLOW) : null;
    if (!c || c.closest('.threads')) return;
    last = { c, x: e.clientX, y: e.clientY };
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!last) return;
      const r = last.c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      last.c.style.setProperty('--mx', (((last.x - r.left) / r.width) * 100).toFixed(1) + '%');
      last.c.style.setProperty('--my', (((last.y - r.top) / r.height) * 100).toFixed(1) + '%');
    });
  }, { passive: true });
})();
