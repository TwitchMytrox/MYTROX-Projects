(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const getJSON = async (url) => {
    const r = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  };

  // Scroll-Reveal
  const items = document.querySelectorAll('.reveal');
  if (reduce || !('IntersectionObserver' in window)) items.forEach((n) => n.classList.add('in'));
  else {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.1 });
    items.forEach((n) => io.observe(n));
    setTimeout(() => items.forEach((n) => n.classList.add('in')), 5000); // Sicherheitsnetz
  }

  function countUp(node, to) {
    const fmt = (v) => Math.round(v).toLocaleString('de-DE');
    if (reduce || to < 2) { node.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 1400);
      node.textContent = fmt(to * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  async function loadStats() {
    try {
      const s = await getJSON('/api/stats');
      const nodes = [...document.querySelectorAll('[data-stat]')];
      const vals = nodes.map((n) => Number(s[n.dataset.stat]));
      if (!vals.some(Number.isFinite)) return;
      $('#statsSec').hidden = false;
      nodes.forEach((n, i) => { if (Number.isFinite(vals[i])) countUp(n, vals[i]); else n.parentElement.hidden = true; });
    } catch (e) { /* Zahlen sind optional */ }
  }

  async function loadConfig() {
    try {
      const cfg = await getJSON('/api/config');
      if (cfg.site_name) {
        document.querySelectorAll('.site-name').forEach((n) => { n.textContent = cfg.site_name; if (n.dataset.text) n.dataset.text = cfg.site_name; });
        document.title = cfg.site_name + ' – Das anonyme Gaming-Forum';
      }
      if (cfg.guest_read) $('#ctaForum').hidden = false;
      if (cfg.registration_open === false) {
        for (const sfx of ['', '2']) { $('#ctaRegister' + sfx).hidden = true; $('#regClosed' + sfx).hidden = false; }
      }
    } catch (e) { /* Standardtexte bleiben */ }
  }

  (async () => {
    try {
      const me = await getJSON('/api/auth/me');
      if (me && me.user) { location.replace('/forum'); return; }
    } catch (e) { /* Seite trotzdem zeigen */ }
    loadConfig();
    loadStats();
  })();
})();
