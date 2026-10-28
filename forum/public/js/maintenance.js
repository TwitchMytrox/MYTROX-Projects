(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let until = null, done = false, tick = null;
  const pad = (n) => String(n).padStart(2, '0');

  function render() {
    const cd = $('countdown'), soon = $('soon');
    if (done) return;
    if (!until) { cd.hidden = true; soon.hidden = false; return; }
    const left = Math.max(0, Math.floor((until - Date.now()) / 1000));
    cd.hidden = false; soon.hidden = true;
    const d = Math.floor(left / 86400), h = Math.floor(left % 86400 / 3600), m = Math.floor(left % 3600 / 60), s = left % 60;
    $('cd-d').textContent = pad(d); $('cd-h').textContent = pad(h); $('cd-m').textContent = pad(m); $('cd-s').textContent = pad(s);
    if (s === 0 || !$('cd-sr').textContent) $('cd-sr').textContent = `Noch ${d} Tage, ${h} Stunden und ${m} Minuten`;
    if (left === 0) { $('note').textContent = 'Gleich geschafft – wir prüfen, ob das Forum wieder erreichbar ist.'; }
  }

  async function poll() {
    if (done) return;
    try {
      const r = await fetch('/api/maintenance', { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const m = await r.json();
      if (m.name) {
        $('siteName').textContent = m.name;
        document.title = 'Wartungsarbeiten – ' + m.name;
      }
      if (m.active === false) {
        done = true; clearInterval(tick);
        $('countdown').hidden = true; $('soon').hidden = true; $('back').hidden = false; $('note').textContent = '';
        setTimeout(() => { location.href = '/'; }, 2000);
        return;
      }
      if (m.message) $('msg').textContent = m.message;
      until = Number(m.until) > 0 ? Number(m.until) : null;
      if (!until || until > Date.now()) $('note').textContent = '';
      render();
    } catch (e) {
      $('note').textContent = 'Verbindung gerade nicht möglich – wir versuchen es weiter.';
    }
  }

  poll();
  setInterval(poll, 15000);
  tick = setInterval(render, 1000);
})();
