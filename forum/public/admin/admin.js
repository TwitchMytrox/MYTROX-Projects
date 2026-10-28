/* turkac.org – Admin Console: Kern (Helfer, Anmeldung, Einrichtungs-Assistent, Navigation)
   Weitere Dateien (Reihenfolge in index.html): admin-content.js, admin-users.js, admin-system.js */
(() => {
  'use strict';

  // ======================================================================
  // Helfer
  // ======================================================================
  const $ = (s, r = document) => r.querySelector(s);
  const PROP = new Set(['value', 'checked', 'disabled', 'hidden', 'textContent', 'selected']);
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'vars') for (const [a, b] of Object.entries(v)) n.style.setProperty(a, b);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (PROP.has(k)) n[k] = v;
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, ...kids) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    for (const k of kids) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }

  const fmt = (ts) => (ts ? new Date(ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString('de-DE') : '—');
  const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`);
  const short = (s, n = 70) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));
  const dur = (ms) => {
    let s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    return [d && `${d} Tg`, (d || h) && `${h} Std`, `${m} Min`, !d && `${s} Sek`].filter(Boolean).join(' ');
  };

  class AuthError extends Error {}
  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.json); }
    let res;
    try { res = await fetch(path, init); } catch { throw new Error('Keine Verbindung zum Server'); }
    let data = {};
    try { data = await res.json(); } catch { /* leer */ }
    if (res.status === 401 && !path.includes('/auth/login')) throw new AuthError(data.error || 'Nicht angemeldet');
    if (!res.ok) {
      const e = new Error(data.error || `Fehler ${res.status}`);
      e.status = res.status; e.code = data.code; e.data = data;
      throw e;
    }
    return data;
  }
  const j = (method, path, json) => api(path, { method, json: json || {} });

  function toast(msg, kind = '') {
    const t = el('div', { class: 'toast ' + kind, role: kind === 'err' ? 'alert' : 'status' }, msg);
    $('#toasts').append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'err' ? 5500 : 3400);
  }
  const guard = (fn) => async (...a) => {
    try { return await fn(...a); } catch (e) {
      if (e && e.silent) return;
      if (e instanceof AuthError) return showLogin('Sitzung abgelaufen – bitte melde dich neu an.');
      if (e.code === 'SETUP_REQUIRED') return startWizard();
      toast(e.message, 'err');
    }
  };

  // ---------- Modal (Esc, Fokusfalle, Fokus zurück) ----------
  const stack = [];
  let mid = 0;
  function modal(title, content, opts = {}) {
    const back = el('div', { class: 'modal-back' + (opts.drawer ? ' drawer' : '') });
    const h = el('h2', { id: 'mt' + ++mid }, title);
    const box = el('div', { class: 'modal' + (opts.wide ? ' wide' : ''), role: opts.alert ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-labelledby': h.id, tabindex: '-1' }, h, content);
    const prev = document.activeElement;
    const m = {
      box, persistent: !!opts.persistent,
      close() {
        const i = stack.indexOf(m); if (i >= 0) stack.splice(i, 1);
        back.remove();
        if (prev && prev.isConnected && prev.focus) prev.focus();
        if (opts.onClose) opts.onClose();
      },
      setTitle(t) { h.textContent = t; },
    };
    back.append(box);
    back.addEventListener('mousedown', (e) => { if (e.target === back && !m.persistent) m.close(); });
    $('#modalRoot').append(back);
    stack.push(m);
    setTimeout(() => {
      const f = opts.focus ? opts.focus() : box.querySelector('input:not([type=hidden]),textarea,select');
      (f || box).focus();
    }, 30);
    return m;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const top = stack[stack.length - 1];
      if (top) { if (!top.persistent) { e.preventDefault(); top.close(); } return; }
      const side = $('#side'); if (side && side.classList.contains('open')) { setMenu(false); const b = $('#burger'); if (b) b.focus(); }
    } else if (e.key === 'Tab' && stack.length) {
      const box = stack[stack.length - 1].box;
      const f = [...box.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]')].filter((x) => x.offsetParent !== null);
      if (!f.length) { e.preventDefault(); box.focus(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
  });
  function confirmBox(title, text, okLabel = 'Bestätigen', danger = true) {
    return new Promise((resolve) => {
      const ok = el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button' }, okLabel);
      const no = el('button', { class: 'btn', type: 'button' }, 'Abbrechen');
      let answered = false;
      const m = modal(title, el('div', { class: 'stack' }, el('p', {}, text), el('div', { class: 'modal-actions' }, no, ok)), { alert: true, focus: () => no, onClose: () => { if (!answered) resolve(false); } });
      ok.onclick = () => { answered = true; m.close(); resolve(true); };
      no.onclick = () => { answered = true; m.close(); resolve(false); };
    });
  }

  function pager(page, pages, go) {
    if (pages <= 1) return null;
    return el('nav', { class: 'pager', 'aria-label': 'Seiten' },
      el('button', { class: 'btn sm', type: 'button', 'aria-label': 'Vorherige Seite', disabled: page <= 1, onclick: () => go(page - 1) }, '‹'),
      el('span', {}, `Seite ${page} / ${pages}`),
      el('button', { class: 'btn sm', type: 'button', 'aria-label': 'Nächste Seite', disabled: page >= pages, onclick: () => go(page + 1) }, '›'));
  }
  function table(heads, rows, rowClass) {
    const tb = el('tbody');
    rows.forEach((r) => { tb.append(el('tr', { class: rowClass ? rowClass(r.__row) : '' }, ...r.cells.map((c) => el('td', { class: c && c.nowrap ? 'nowrap' : '' }, c && c.node !== undefined ? c.node : c)))); });
    return el('div', { class: 'tbl-wrap', tabindex: '0', role: 'region', 'aria-label': 'Tabelle, horizontal scrollbar' }, el('table', {}, el('thead', {}, el('tr', {}, heads.map((h) => el('th', { scope: 'col' }, h)))), tb));
  }
  const nw = (node) => ({ nowrap: true, node });
  const empty = (txt) => el('div', { class: 'empty' }, txt);
  const field = (label, input, hint, cls) => {
    const id = 'f' + ++mid;
    input.id = id;
    return el('div', { class: 'field ' + (cls || '') }, el('label', { for: id }, label), input, hint && el('small', { class: 'hint' }, hint));
  };

  // ---------- Kopieren / Speichern ----------
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('In die Zwischenablage kopiert'); return; } catch { /* Fallback */ }
    const ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('In die Zwischenablage kopiert'); } catch { toast('Kopieren nicht möglich – bitte markieren und von Hand kopieren.', 'err'); }
    ta.remove();
  }
  function saveFile(name, text) {
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), download: name });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- Zustand ----------
  const root = $('#root');
  const state = { me: null };
  const myPerms = () => (state.me && state.me.user.perms) || [];
  const can = (k) => { const p = myPerms(); return p.includes('*') || p.includes(k); };
  const myLevel = () => (state.me && state.me.user.role ? state.me.user.role.level : 0);
  const cleanups = [];
  const onCleanup = (fn) => cleanups.push(fn);

  // ---------- kleine UI-Bausteine ----------
  const STATUS = {
    normal: ['Normal', 'Alles in Ordnung.'],
    verdacht: ['Verdacht', 'Wird beobachtet – keine Einschränkung, aber das Team behält das Konto im Auge.'],
    untersuchung: ['Untersuchung', 'Keine neuen Threads und keine Uploads, bis die Prüfung abgeschlossen ist.'],
    gebannt: ['Gebannt', 'Nichts mehr möglich – nicht einmal Lesen. Nur für schwere Verstöße.'],
  };
  const statusChip = (s) => el('span', { class: 'chip st-' + s }, (STATUS[s] || [s])[0]);
  const roleBadge = (role) => (role ? el('span', { class: 'rolebadge', vars: { '--c': role.color || '#00f0ff' } }, role.name) : null);
  function authorCell(r) {
    const box = el('div', {});
    if (r.author) {
      box.append(can('users.view') && r.user_id
        ? el('button', { class: 'ulink', type: 'button', title: 'Nutzer-Details öffnen', onclick: () => NX.openUser(r.user_id) }, r.author)
        : el('span', { class: 'uname' }, r.author));
    } else {
      box.append(r.nickname || 'Anonym');
      if (r.ip_hash) box.append(el('div', { class: 'hash' }, r.ip_hash === 'system' ? 'system' : r.ip_hash.slice(0, 10)));
    }
    return box;
  }

  // ======================================================================
  // Anmeldung
  // ======================================================================
  function showLogin(msg) {
    state.me = null; stack.splice(0).forEach((m) => m.close());
    let need2fa = false;
    const user = el('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
    const pass = el('input', { type: 'password', autocomplete: 'current-password', required: true });
    const code = el('input', { type: 'text', autocomplete: 'one-time-code', autocapitalize: 'characters', spellcheck: 'false', inputmode: 'text' });
    const err = el('div', { class: 'err-msg', role: 'alert', hidden: !msg }, msg || '');
    const codeField = field('App-Code oder Wiederherstellungscode', code, '6-stelliger Code aus deiner Authenticator-App oder ein Wiederherstellungscode (ABCD-EFGH-JKLM).');
    codeField.hidden = true;
    const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Anmelden');
    const form = el('form', { class: 'login-card' },
      el('h1', {}, 'ADMIN CONSOLE'), el('p', {}, 'Melde dich mit deinem Forum-Konto an.'), err,
      field('Benutzername', user), field('Passwort', pass), codeField, btn,
      el('a', { class: 'small center', href: '/' }, '← Zurück zum Forum'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); btn.disabled = true; err.hidden = true;
      try {
        const body = { username: user.value.trim(), password: pass.value };
        if (need2fa) body.code = code.value.trim();
        const d = await j('POST', '/api/auth/login', body);
        if (d.need_2fa) {
          need2fa = true; codeField.hidden = false; user.readOnly = true; pass.readOnly = true; code.required = true; code.focus();
          err.textContent = 'Bitte gib deinen Zwei-Faktor-Code ein.'; err.hidden = false; err.classList.add('info');
        } else { W.pw = pass.value; pass.value = ''; await start(); }
      } catch (ex) {
        err.classList.remove('info'); err.textContent = ex.message; err.hidden = false; err.style.animation = 'none'; void err.offsetWidth; err.style.animation = '';
        if (need2fa) { code.value = ''; code.focus(); } else { pass.value = ''; pass.focus(); }
      }
      btn.disabled = false;
    });
    root.replaceChildren(el('div', { class: 'login' }, form));
    setTimeout(() => user.focus(), 50);
  }

  function showNoAccess() {
    root.replaceChildren(el('div', { class: 'login' }, el('div', { class: 'login-card' },
      el('h1', {}, 'KEIN ZUGRIFF'), el('p', {}, 'Dein Konto hat keinen Zugriff auf den Admin-Bereich.'),
      el('a', { class: 'btn primary center', href: '/' }, 'Zum Forum'),
      el('button', { class: 'btn', type: 'button', onclick: doLogout }, 'Abmelden'))));
  }
  const doLogout = guard(async () => { await j('POST', '/api/auth/logout'); W.pw = ''; W.secret = null; W.codes = null; showLogin(); });

  // ======================================================================
  // Wiederherstellungscodes anzeigen (Assistent + Mein Konto)
  // ======================================================================
  function codesView(codes, onDone, doneLabel = 'Fertig') {
    const text = codes.join('\n');
    const chk = el('input', { type: 'checkbox' });
    const done = el('button', { class: 'btn primary', type: 'button', disabled: true, onclick: onDone }, doneLabel);
    chk.onchange = () => { done.disabled = !chk.checked; };
    return el('div', { class: 'stack' },
      el('p', {}, 'Jeder Code funktioniert nur ', el('b', {}, 'einmal'), ' und ersetzt deinen App-Code, falls du dein Handy verlierst. Ohne diese Codes kann dir niemand dein Konto zurückgeben.'),
      el('ol', { class: 'codes', 'aria-label': 'Wiederherstellungscodes' }, codes.map((c) => el('li', {}, el('code', {}, c)))),
      el('div', { class: 'acts' },
        el('button', { class: 'btn', type: 'button', onclick: () => copyText(text) }, 'Alle kopieren'),
        el('button', { class: 'btn', type: 'button', onclick: () => saveFile('turkac-wiederherstellungscodes.txt', `turkac.org – Wiederherstellungscodes\n(jeder Code nur einmal verwendbar)\n\n${text}\n`) }, 'Als Datei speichern')),
      el('label', { class: 'check' }, chk, 'Ich habe die Codes an einem sicheren Ort gespeichert.'), done);
  }

  // ======================================================================
  // Einrichtungs-Assistent (Pflicht für Teammitglieder)
  // ======================================================================
  const W = { pw: '', step: 1, secret: null, uri: null, codes: null };
  async function startWizard() {
    let u;
    try { u = (await api('/api/account')).user; } catch (e) { if (e instanceof AuthError) return showLogin(); return toast(e.message, 'err'); }
    state.me = state.me || { user: u, permissions: [] };
    W.step = !u.has_email ? 1 : !u.totp_on ? 2 : 3;
    W.user = u;
    renderWizard();
  }
  function renderWizard() {
    const steps = ['E-Mail', 'Zwei-Faktor', 'Codes'];
    const bar = el('ol', { class: 'steps', 'aria-label': 'Fortschritt' }, steps.map((s, i) => el('li', { class: i + 1 === W.step ? 'cur' : i + 1 < W.step ? 'done' : '', 'aria-current': i + 1 === W.step ? 'step' : null }, el('b', {}, i + 1 < W.step ? '✔' : i + 1), s)));
    const err = el('div', { class: 'err-msg', role: 'alert', hidden: true });
    const fail = (e) => { if (e instanceof AuthError) return showLogin('Sitzung abgelaufen – bitte melde dich neu an.'); err.textContent = e.message; err.hidden = false; };
    const body = el('div', { class: 'stack' });
    const pwInput = el('input', { type: 'password', autocomplete: 'current-password', required: true });
    const pwField = () => field('Dein aktuelles Passwort', pwInput, 'Wird nur zur Bestätigung gebraucht und nicht gespeichert.');

    if (W.step === 1) {
      const mail = el('input', { type: 'email', autocomplete: 'email', required: true, value: '' });
      const go = el('button', { class: 'btn primary', type: 'submit' }, 'Weiter');
      const f = el('form', { class: 'stack' },
        el('p', {}, 'Als Teammitglied brauchst du eine E-Mail-Adresse. Sie wird verschlüsselt gespeichert und nur für die Kontosicherheit verwendet.'),
        field('E-Mail-Adresse', mail), !W.pw && pwField(), go);
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); err.hidden = true; go.disabled = true;
        try { const pw = W.pw || pwInput.value; await j('POST', '/api/account/email', { password: pw, email: mail.value.trim() }); W.pw = pw; W.step = W.user.totp_on ? 3 : 2; W.user.has_email = true; renderWizard(); }
        catch (ex) { fail(ex); go.disabled = false; }
      });
      body.append(f);
      setTimeout(() => mail.focus(), 50);
    } else if (W.step === 2) {
      if (!W.secret) {
        const go = el('button', { class: 'btn primary', type: 'submit' }, W.pw ? 'Schlüssel erzeugen' : 'Weiter');
        const run = async (pw) => { try { const d = await j('POST', '/api/account/2fa/setup', { password: pw }); W.pw = pw; W.secret = d.secret; W.uri = d.uri; renderWizard(); } catch (ex) { fail(ex); go.disabled = false; } };
        const f = el('form', { class: 'stack' },
          el('p', {}, 'Mit Zwei-Faktor schützt du dein Teamkonto zusätzlich zum Passwort. Du brauchst eine Authenticator-App (z. B. Aegis, Google Authenticator, Authy, 2FAS oder Bitwarden).'),
          !W.pw && pwField(), go);
        f.addEventListener('submit', (e) => { e.preventDefault(); err.hidden = true; go.disabled = true; run(W.pw || pwInput.value); });
        body.append(f);
        if (W.pw) setTimeout(() => go.focus(), 50);
      } else {
        const grouped = W.secret.replace(/\s/g, '').match(/.{1,4}/g).join(' ');
        const code = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '8', required: true, placeholder: '123456' });
        const go = el('button', { class: 'btn primary', type: 'submit' }, 'Bestätigen und aktivieren');
        const f = el('form', { class: 'stack' },
          el('ol', { class: 'howto' },
            el('li', {}, 'Öffne deine Authenticator-App und wähle ', el('b', {}, 'Konto hinzufügen → Schlüssel eingeben'), ' (kein QR-Code verfügbar).'),
            el('li', {}, 'Gib diesen Schlüssel ein, Typ ', el('b', {}, 'zeitbasiert'), ':'),
          ),
          el('div', { class: 'secret' }, el('code', { 'aria-label': 'Geheimer Schlüssel: ' + grouped.split('').join(' ') }, grouped), el('button', { class: 'btn sm', type: 'button', onclick: () => copyText(W.secret) }, 'Kopieren')),
          el('p', { class: 'small muted' }, 'Auf dem Handy: ', el('a', { href: W.uri }, 'In Authenticator-App öffnen'), ' · Setup-Link zum Kopieren: ', el('code', { class: 'uri' }, W.uri)),
          el('ol', { class: 'howto', start: '3' }, el('li', {}, 'Trage den aktuellen 6-stelligen Code aus der App ein:')),
          field('Code aus der App', code), go);
        f.addEventListener('submit', async (e) => {
          e.preventDefault(); err.hidden = true; go.disabled = true;
          try { const d = await j('POST', '/api/account/2fa/enable', { code: code.value.replace(/\s/g, '') }); W.codes = d.recovery_codes; W.step = 3; renderWizard(); }
          catch (ex) { fail(ex); go.disabled = false; code.select(); }
        });
        body.append(f);
        setTimeout(() => code.focus(), 50);
      }
    } else {
      if (!W.codes) { body.append(el('p', {}, 'Zwei-Faktor ist bereits aktiv. Du kannst jetzt zum Panel.'), el('button', { class: 'btn primary', type: 'button', onclick: finish }, 'Zum Admin-Panel')); }
      else body.append(codesView(W.codes, finish, 'Fertig – Panel öffnen'));
    }
    root.replaceChildren(el('div', { class: 'login' }, el('div', { class: 'login-card wide' },
      el('h1', {}, 'KONTO EINRICHTEN'),
      el('p', {}, 'Für den Admin-Bereich sind E-Mail und Zwei-Faktor Pflicht. Das dauert ca. 2 Minuten.'),
      bar, err, el('h2', { class: 'step-title' }, ['', 'Schritt 1: E-Mail-Adresse', 'Schritt 2: Zwei-Faktor einrichten', 'Schritt 3: Wiederherstellungscodes sichern'][W.step]), body,
      el('button', { class: 'btn sm', type: 'button', onclick: doLogout }, 'Abbrechen und abmelden'))));
    function finish() { W.pw = ''; W.secret = null; W.uri = null; W.codes = null; start(); }
  }

  // ======================================================================
  // Shell + Navigation
  // ======================================================================
  const VIEWS = {};
  // [key, icon, label, Recht (Funktion), Gruppe]
  const NAV = [
    ['dash', '📊', 'Übersicht', () => can('stats.view'), null],
    ['threads', '🧵', 'Threads', () => can('threads.moderate'), 'Inhalte'],
    ['comments', '💬', 'Kommentare', () => can('comments.moderate'), 'Inhalte'],
    ['reports', '🚩', 'Meldungen', () => can('reports.handle'), 'Inhalte'],
    ['tickets', '🎫', 'Support', () => can('tickets.handle'), 'Inhalte'],
    ['tournaments', '🏆', 'Turniere', () => can('tournaments.review'), 'Inhalte'],
    ['blog', '📣', 'Blog & Werbung', () => can('blog.manage'), 'Inhalte'],
    ['media', '🖼️', 'Medien', () => can('media.manage'), 'Inhalte'],
    ['cats', '🗂️', 'Kategorien', () => can('categories.manage'), 'Inhalte'],
    ['words', '🔤', 'Wortfilter', () => can('words.manage'), 'Inhalte'],
    ['users', '👥', 'Nutzer', () => can('users.view'), 'Nutzer'],
    ['roles', '🛡️', 'Rollen', () => can('users.view') || can('roles.manage'), 'Nutzer'],
    ['names', '🏷️', 'Namen-Liste', () => can('users.names'), 'Nutzer'],
    ['bans', '🚫', 'IP-Sperren', () => can('bans.ip'), 'Nutzer'],
    ['maint', '🛠️', 'Wartung', () => can('maintenance.manage'), 'System'],
    ['settings', '⚙️', 'Einstellungen', () => can('settings.edit'), 'System'],
    ['economy', '🪙', 'Wirtschaft', () => can('settings.edit'), 'System'],
    ['games', '🎮', 'Spiele', () => can('settings.edit'), 'System'],
    ['legal', '⚖️', 'Rechtstexte', () => can('settings.edit'), 'System'],
    ['audit', '📜', 'Protokoll', () => can('audit.view'), 'System'],
    ['backup', '💾', 'Backup', () => can('backup.download'), 'System'],
    ['account', '👤', 'Mein Konto', () => true, 'System'],
  ];
  let current = 'dash';
  let token = 0;
  const allowed = () => NAV.filter((n) => n[3]()).map((n) => n[0]);

  function setMenu(open) {
    const s = $('#side'), b = $('#burger'); if (!s) return;
    s.classList.toggle('open', open); document.body.classList.toggle('menu-open', open);
    if (b) b.setAttribute('aria-expanded', String(open));
  }

  // Menü-Suche: filtert Einträge und blendet leere Gruppen aus; Enter öffnet den ersten Treffer
  function navSearch(nav) {
    const inp = el('input', { type: 'search', class: 'nav-search', placeholder: 'Menü durchsuchen…', 'aria-label': 'Menü durchsuchen', autocomplete: 'off' });
    const apply = () => {
      const q = inp.value.trim().toLowerCase(); let group = null, any = false;
      [...nav.children].forEach((c) => {
        if (c.classList.contains('nav-group')) { group = c; c.hidden = !!q; return; }
        const hit = !q || c.textContent.toLowerCase().includes(q); c.hidden = !hit; if (hit && q) any = true;
      });
      if (q && !any) nav.dataset.empty = '1'; else delete nav.dataset.empty;
    };
    inp.addEventListener('input', apply);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = [...nav.querySelectorAll('a.nav')].find((x) => !x.hidden); if (a) { a.click(); location.hash = a.getAttribute('href'); inp.value = ''; apply(); } } });
    return el('div', { class: 'nav-search-wrap' }, inp);
  }

  function showShell() {
    const items = NAV.filter((n) => n[3]());
    const nav = el('nav', { 'aria-label': 'Hauptnavigation' });
    let lastGroup = '§';
    items.forEach(([k, ico, label, , group]) => {
      if (group !== lastGroup) { lastGroup = group; if (group) nav.append(el('div', { class: 'nav-group' }, group)); }
      nav.append(el('a', { class: 'nav', href: '#' + k, 'data-k': k, onclick: () => setMenu(false) },
        el('span', { class: 'ico', 'aria-hidden': 'true' }, ico), el('span', { class: 'label' }, label), k === 'reports' && el('span', { class: 'badge-n', id: 'repBadge', hidden: true, 'aria-label': 'offene Meldungen' })));
    });
    const u = state.me.user;
    const burger = el('button', { class: 'burger', id: 'burger', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'side', 'aria-label': 'Menü', onclick: () => setMenu(!$('#side').classList.contains('open')) }, el('span'), el('span'), el('span'));
    root.replaceChildren(el('div', { class: 'shell' },
      el('header', { class: 'topbar' }, burger, el('b', {}, 'turkac.org'), el('span', {}, 'ADMIN'), el('span', { class: 'badge-n', id: 'repBadge2', hidden: true })),
      el('div', { class: 'scrim', onclick: () => setMenu(false) }),
      el('aside', { class: 'side', id: 'side' }, el('div', { class: 'brand' }, el('b', {}, 'turkac.org'), el('span', {}, 'ADMIN CONSOLE')), navSearch(nav), nav,
        el('div', { class: 'side-foot' },
          el('div', { class: 'who' }, el('span', {}, u.username), roleBadge(u.role)),
          el('a', { href: '/', target: '_blank', rel: 'noopener' }, '↗ Forum ansehen'),
          el('button', { class: 'btn sm', type: 'button', onclick: doLogout }, 'Abmelden'))),
      el('main', { class: 'main', id: 'view', tabindex: '-1' })));
    window.removeEventListener('hashchange', route); window.addEventListener('hashchange', route);
    route();
  }

  function route() {
    cleanups.splice(0).forEach((f) => { try { f(); } catch { /* egal */ } });
    const ok = allowed();
    let k = location.hash.slice(1);
    if (!VIEWS[k] || !ok.includes(k)) k = ok[0] || 'account';
    current = k;
    document.querySelectorAll('.nav').forEach((n) => { const a = n.dataset.k === current; n.classList.toggle('active', a); if (a) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current'); });
    const box = $('#view'); if (!box) return;
    token++;
    box.replaceChildren(el('div', { class: 'boot' }, 'LADE', el('span', { class: 'dots' })));
    const t = token;
    guard(async () => {
      const content = await VIEWS[current]();
      if (t === token) { box.replaceChildren(...[].concat(content).filter(Boolean)); document.title = (NAV.find((n) => n[0] === current) || [])[2] + ' – Admin Console'; }
    })();
  }
  const reload = () => route();
  const head = (title, sub, ...right) => el('div', { class: 'page-head' }, el('h1', {}, title, sub && el('small', {}, sub)), el('div', { class: 'bar', style: 'margin:0' }, ...right));
  function setBadge(n) { ['repBadge', 'repBadge2'].forEach((id) => { const b = document.getElementById(id); if (b) { b.hidden = !n; b.textContent = n; } }); }

  // ======================================================================
  // Start
  // ======================================================================
  async function start() {
    try {
      const d = await api('/api/admin/me');
      state.me = d;
      if (d.user.setup_required) return startWizard();
      showShell();
      if (can('reports.handle') && can('stats.view')) api('/api/admin/stats').then((s) => setBadge(s.open_reports)).catch(() => {});
    } catch (e) {
      if (e instanceof AuthError) showLogin();
      else if (e.code === 'SETUP_REQUIRED') startWizard();
      else if (e.status === 403) showNoAccess();
      else root.replaceChildren(el('div', { class: 'boot' }, e.message));
    }
  }

  const NX = { $, el, sv, fmt, fmtDate, fmtSize, short, dur, api, j, toast, guard, modal, confirmBox, pager, table, nw, empty, field, head, reload, VIEWS, state, can, myLevel, onCleanup, copyText, saveFile, codesView, statusChip, roleBadge, authorCell, setBadge, STATUS, AuthError, startWizard, openUser: null, route };
  window.NX = NX;
  // Start nach dem Laden der übrigen Skripte (stehen in index.html dahinter)
  setTimeout(start, 0);
})();
