/* turkac.org – gemeinsame Kopf- und Fußzeile (Gegenstück zu lib/chrome.js, gleiches Markup).
   Seiten setzen <header id="siteHeader"> / <footer id="siteFooter"> (oder body[data-chrome=forum] für das Forum). */
(() => {
  'use strict';
  document.documentElement.classList.add('js');
  const NAV = [['forum', '/forum', 'Forum'], ['blog', '/blog', 'Blog'], ['turniere', '/turniere/', 'Turniere']];
  const GAMES = [['/spiele/#blackjack', '🃏 Blackjack'], ['/spiele/#slots', '🎰 Slots'], ['/spiele/#roulette', '🎡 Roulette'], ['/spiele/#reaction', '⚡ Reaktionstest'], ['/spiele/#memory', '🧠 Memory'], ['/spiele/#snake', '🐍 Snake'], ['/spiele/#board', '🏆 Bestenliste']];
  const FOOT = NAV.concat([['spiele', '/spiele/', 'Spiele'], ['support', '/support/', 'Support']]);
  const LEGAL = [['/impressum', 'Impressum'], ['/datenschutz', 'Datenschutz'], ['/agb', 'Nutzungsbedingungen (AGB)'], ['/regeln', 'Regeln'], ['/cookies', 'Cookies'], ['/barrierefreiheit', 'Barrierefreiheit']];
  const path = location.pathname.replace(/\/$/, '') || '/';
  const activeKey = (FOOT.find(([, h]) => path === h.replace(/\/$/, '')) || [])[0] || '';
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  const site = () => (document.documentElement.dataset.site || 'turkac.org');
  const logo = () => el('a', { class: 'sh-logo', href: '/' }, el('span', { class: 'sh-mark', 'aria-hidden': 'true' }, '◢◣'), el('span', {}, site()));

  function buildHeader() {
    const burger = el('button', { class: 'sh-burger', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'shNav', 'aria-label': 'Menü öffnen' }, el('span', { 'aria-hidden': 'true' }, '☰'));
    const dd = el('div', { class: 'sh-dd' }, el('button', { class: 'sh-dd-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'shGames', 'aria-current': activeKey === 'spiele' ? 'page' : null }, '🎮 Spiele ', el('span', { 'aria-hidden': 'true' }, '▾')),
      el('ul', { id: 'shGames', class: 'sh-menu', hidden: true }, el('li', {}, el('a', { href: '/spiele/' }, 'Alle Spiele')), GAMES.map(([h, l]) => el('li', {}, el('a', { href: h }, l)))));
    const nav = el('nav', { id: 'shNav', class: 'sh-nav', 'aria-label': 'Hauptnavigation' }, NAV.map(([k, h, l]) => el('a', { href: h, 'aria-current': k === activeKey ? 'page' : null }, l)), dd);
    return el('header', { class: 'site-head' }, el('div', { class: 'sh-in' }, logo(), burger, nav, el('div', { class: 'sh-acc' }, el('a', { class: 'sh-btn', href: '/auth/', 'data-acc': '' }, 'Anmelden'))));
  }
  function buildFooter() {
    return el('footer', { class: 'site-foot' }, el('div', { class: 'sf-in' },
      el('div', { class: 'sf-brand' }, logo(), el('p', {}, 'Anonym diskutieren, zocken, aufsteigen – nur mit deinem Benutzernamen.')),
      el('nav', { 'aria-label': 'Entdecken' }, el('h2', {}, 'Entdecken'), el('ul', {}, FOOT.map(([, h, l]) => el('li', {}, el('a', { href: h }, l))), el('li', {}, el('a', { href: '/auth/' }, 'Anmelden / Registrieren')))),
      el('nav', { 'aria-label': 'Rechtliches' }, el('h2', {}, 'Rechtliches'), el('ul', {}, LEGAL.map(([h, l]) => el('li', {}, el('a', { href: h, 'aria-current': path === h ? 'page' : null }, l))))),
      el('p', { class: 'sf-bottom' }, `© ${new Date().getFullYear()} ${site()} · Eine Community von Gamern für Gamer`)));
  }

  function init() {
    const forum = document.body.dataset.chrome === 'forum';
    const ph = document.getElementById('siteHeader'), pf = document.getElementById('siteFooter');
    if (ph) ph.replaceWith(buildHeader());
    if (pf) pf.replaceWith(buildFooter());
    if (forum) { // Forum behält seine Werkzeugleiste; Links + Fußzeile kommen dazu
      const top = document.querySelector('header.topbar');
      if (top && !document.querySelector('.site-links')) top.after(el('nav', { class: 'site-links', 'aria-label': 'Seitenbereiche' }, FOOT.map(([k, h, l]) => el('a', { href: h, 'aria-current': k === 'forum' ? 'page' : null }, l))));
      const old = document.querySelector('footer.footer'); if (old) old.replaceWith(buildFooter());
    }
    // Burger-Menü
    const b = document.querySelector('.sh-burger'), n = document.getElementById('shNav');
    if (b && n) {
      const set = (open) => { n.classList.toggle('open', open); b.setAttribute('aria-expanded', String(open)); b.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen'); };
      b.addEventListener('click', () => set(!n.classList.contains('open')));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && n.classList.contains('open')) { set(false); b.focus(); } });
    }
    // Aufklapp-Menüs (Spiele + Benutzer): Tastatur, Escape, Klick daneben
    const dds = [];
    const bindDD = (wrap) => {
      const btn = wrap.querySelector('.sh-dd-btn'), menu = wrap.querySelector('.sh-menu');
      if (!btn || !menu || btn._bound) return; btn._bound = true;
      const set = (open, focusBtn) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); wrap.classList.toggle('open', open); if (!open && focusBtn) btn.focus(); };
      btn.addEventListener('click', () => { const open = menu.hidden; dds.forEach((d) => d !== set && d.close()); set(open); if (open && window.TSFX) TSFX.open(); });
      wrap.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !menu.hidden) { set(false, true); e.stopPropagation(); }
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !menu.hidden) {
          const items = [...menu.querySelectorAll('a,button')], i = items.indexOf(document.activeElement); e.preventDefault();
          items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
        } else if (e.key === 'ArrowDown' && document.activeElement === btn) { set(true); const f = menu.querySelector('a,button'); if (f) f.focus(); e.preventDefault(); }
      });
      wrap.addEventListener('focusout', (e) => { if (!wrap.contains(e.relatedTarget)) set(false); });
      dds.push({ close: () => set(false) }); dds[dds.length - 1].wrap = wrap;
    };
    document.querySelectorAll('.sh-dd').forEach(bindDD);
    document.addEventListener('click', (e) => { document.querySelectorAll('.sh-dd.open').forEach((w) => { if (!w.contains(e.target)) { w.querySelector('.sh-menu').hidden = true; w.querySelector('.sh-dd-btn').setAttribute('aria-expanded', 'false'); w.classList.remove('open'); } }); });

    // Konto: eingeloggt = Benutzermenü, sonst Anmelden-Knopf
    fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => r.json()).then((d) => {
      const host = document.querySelector('.sh-acc'); if (!host || !d.user) return;
      const u = d.user;
      const item = (href, label) => el('li', {}, el('a', { href }, label));
      const sound = el('button', { type: 'button', class: 'sh-sound' }, '');
      const paint = () => { const on = window.TSFX ? TSFX.enabled : false; sound.textContent = (on ? '🔊 Sound: an' : '🔇 Sound: aus'); };
      sound.addEventListener('click', () => { if (window.TSFX) TSFX.set(!TSFX.enabled); paint(); });
      paint();
      const menu = el('ul', { id: 'shUser', class: 'sh-menu sh-menu-r', hidden: true },
        el('li', { class: 'sh-head' }, el('b', {}, u.username), el('span', {}, `💰 ${Number(u.credits || 0).toLocaleString('de-DE')} Credits`)),
        item('/forum#konto', '👤 Profil & Konto'), item('/spiele/', '🎮 Spiele & Credits'), item('/spiele/#board', '🏆 Bestenliste'), item('/support/', '🛟 Support'),
        u.team && item('/admin/', '🛠️ Admin-Bereich'), el('li', {}, sound),
        el('li', {}, el('button', { type: 'button', class: 'sh-logout', onclick: async () => { try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* egal */ } location.href = '/'; } }, '🚪 Abmelden')));
      const wrap = el('div', { class: 'sh-dd sh-user' }, el('button', { class: 'sh-dd-btn sh-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'shUser', 'aria-label': 'Mein Konto: ' + u.username }, '👤 ' + u.username + ' ', el('span', { 'aria-hidden': 'true' }, '▾')), menu);
      host.replaceChildren(wrap); bindDD(wrap);
      document.querySelectorAll('.sfx-toggle').forEach((b) => b.remove()); // Sound-Schalter steckt jetzt im Benutzermenü
    }).catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
