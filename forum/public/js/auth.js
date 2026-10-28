/* turkac.org – Anmelden / Registrieren / Passwort vergessen */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const TABS = ['login', 'register', 'recover'];
  const q = new URLSearchParams(location.search).get('next');
  const NEXT = q && q.startsWith('/') && !q.startsWith('//') && !q.startsWith('/\\') ? q : '/forum';
  let regActive = false;   // Codes-Schritt aktiv
  let regOpen = true;
  let me = null;
  let codes = [];

  async function api(method, url, body) {
    let r;
    try {
      r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    } catch { throw new Error('Keine Verbindung zum Server.'); }
    let d = {};
    try { d = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(d.error || ('Fehler ' + r.status)); e.status = r.status; throw e; }
    return d;
  }
  const showErr = (panel, msg) => { const el = panel.querySelector('[data-err]'); el.textContent = msg || ''; el.hidden = !msg; };
  async function busy(btn, fn) {
    const t = btn.textContent; btn.disabled = true; btn.textContent = '…';
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = t; }
  }
  const go = (url) => { location.href = url; };

  // ---- Tabs ----
  function select(name, focus) {
    if (!TABS.includes(name)) name = 'login';
    TABS.forEach((t) => {
      const on = t === name;
      const tab = $('tab-' + t);
      tab.setAttribute('aria-selected', on); tab.tabIndex = on ? 0 : -1;
      $('p-' + t).hidden = !on || (me && !regActive);
      if (on && focus) tab.focus();
    });
    document.title = { login: 'Anmelden', register: 'Registrieren', recover: 'Passwort vergessen' }[name] + ' – turkac.org';
    if (location.hash !== '#' + name) history.replaceState(null, '', location.pathname + location.search + '#' + name);
  }
  const current = () => TABS.find((t) => $('tab-' + t).getAttribute('aria-selected') === 'true');
  $('tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) select(t.dataset.tab); });
  $('tabs').addEventListener('keydown', (e) => {
    const i = TABS.indexOf(current());
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % 3; else if (e.key === 'ArrowLeft') n = (i + 2) % 3;
    else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = 2;
    if (n >= 0) { e.preventDefault(); select(TABS[n], true); }
  });
  addEventListener('hashchange', () => { if (!regActive) select(location.hash.slice(1)); });

  // ---- Passwort anzeigen ----
  document.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const show = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', show); b.textContent = show ? 'Verbergen' : 'Anzeigen';
    b.dataset.toggle.split(' ').forEach((id) => { $(id).type = show ? 'text' : 'password'; });
  }));

  // ---- Bereits angemeldet ----
  function showMe() {
    TABS.forEach((t) => { $('p-' + t).hidden = true; });
    $('tabs').hidden = true; $('p-me').hidden = false;
    $('meName').textContent = me.username; $('meGo').href = NEXT;
  }
  $('meLogout').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    try { await api('POST', '/api/auth/logout'); me = null; $('p-me').hidden = true; $('tabs').hidden = false; select('login'); }
    catch (err) { showErr($('p-me'), err.message); }
  }));

  // ---- Login ----
  let pending = null, keyOpts = null;
  $('keyLogin').addEventListener('click', async () => {
    const p = $('p-login'); showErr(p, '');
    const username = $('l-user').value.trim(), password = $('l-pass').value;
    await busy($('keyLogin'), async () => {
      try {
        const credential = await NXWebAuthn.get(keyOpts.publicKey);
        const d = await api('POST', '/api/auth/login', { username, password, webauthn: { id: keyOpts.challenge_id, credential } });
        go(d.user && d.user.setup_required ? '/admin/' : NEXT);
      } catch (err) { showErr(p, err.message); }
    });
  });
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = $('p-login'); showErr(p, ''); $('loginOk').hidden = true;
    const username = $('l-user').value.trim(), password = $('l-pass').value;
    const code = $('l-code').value.trim();
    if (!username || !password) return showErr(p, 'Bitte Benutzername und Passwort eingeben.');
    if (!$('l-code-field').hidden && !code) return showErr(p, 'Bitte den Code eingeben.');
    await busy($('loginBtn'), async () => {
      try {
        const body = { username, password }; if (code) body.code = code;
        const d = await api('POST', '/api/auth/login', body);
        if (d.need_2fa) {
          const m = d.methods || {};
          $('l-code-field').hidden = false;
          if (m.webauthn && window.NXWebAuthn && NXWebAuthn.supported()) {
            keyOpts = m; $('keyLogin').hidden = false; $('keyLogin').focus();
            showErr(p, m.totp ? 'Bestätige mit deinem Sicherheitsschlüssel oder gib den App-Code ein.' : 'Bestätige mit deinem Sicherheitsschlüssel (oder einem Wiederherstellungscode).');
          } else { $('l-code').focus(); showErr(p, 'Zwei-Faktor aktiv: Bitte gib deinen Code ein.'); }
          return;
        }
        const dest = d.user && d.user.setup_required ? '/admin/' : NEXT;
        if (typeof d.recovery_codes_left === 'number' && d.recovery_codes_left <= 3) {
          pending = dest;
          $('remindText').textContent = d.recovery_codes_left === 0 ? 'Du hast keine Wiederherstellungscodes mehr.' : 'Dir bleiben nur noch ' + d.recovery_codes_left + ' Wiederherstellungscode(s).';
          $('loginStep').hidden = true; $('loginRemind').hidden = false; $('remindOk').focus(); return;
        }
        go(dest);
      } catch (err) { showErr(p, err.message); }
    });
  });
  $('remindOk').addEventListener('click', () => go(pending || NEXT));

  // ---- Registrieren ----
  const ru = $('r-user'), hint = $('r-user-hint');
  const HINT0 = '3–20 Zeichen: Buchstaben, Ziffern, _ und -';
  let timer = 0, seq = 0, nameOk = false;
  function checkName() {
    clearTimeout(timer); nameOk = false;
    const v = ru.value.trim();
    if (!v) { hint.textContent = HINT0; hint.className = 'hint'; return; }
    hint.textContent = 'Prüfe …'; hint.className = 'hint';
    const my = ++seq;
    timer = setTimeout(async () => {
      try {
        const d = await api('GET', '/api/auth/check-name?name=' + encodeURIComponent(v));
        if (my !== seq) return;
        nameOk = !!d.ok;
        hint.textContent = d.ok ? '✔ Name ist frei' : '✘ ' + (d.problem || 'Name nicht verfügbar');
        hint.className = 'hint ' + (d.ok ? 'ok' : 'bad');
      } catch (err) { if (my === seq) { hint.textContent = '✘ ' + err.message; hint.className = 'hint bad'; } }
    }, 350);
  }
  ru.addEventListener('input', checkName);
  $('suggestBtn').addEventListener('click', async (e) => {
    try { const d = await api('GET', '/api/auth/suggest'); ru.value = d.name; checkName(); }
    catch (err) { showErr($('p-register'), err.message); }
  });
  function strength(p) {
    let s = 0;
    if (p.length >= 8) s++; if (p.length >= 12) s++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
    if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++;
    return Math.min(s, 4);
  }
  $('r-pass').addEventListener('input', () => {
    const p = $('r-pass').value, s = p ? Math.max(1, strength(p)) : 0;
    const m = $('r-meter');
    m.style.width = (s * 25) + '%';
    m.style.background = ['transparent', 'var(--danger)', 'var(--warn)', 'var(--cyan)', 'var(--ok)'][s];
    $('r-meter-hint').textContent = p ? ['', 'Schwach', 'Geht so', 'Gut', 'Stark'][s] + (p.length < 8 ? ' – mindestens 8 Zeichen' : '') : 'Mindestens 8 Zeichen';
  });
  let capId = '', shownAt = Date.now(), capOn = false, capMode = '', powDone = null, powNonce = '';
  async function solvePow(ch, bits) {
    const enc = new TextEncoder();
    for (let n = 0; ; n++) {
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(ch + ':' + n)));
      let z = 0; for (const b of h) { if (b === 0) { z += 8; continue; } z += Math.clz32(b) - 24; break; }
      if (z >= bits) return String(n);
      if (n % 3000 === 0) await new Promise((r) => setTimeout(r, 0)); // Oberfläche bleibt bedienbar
    }
  }
  async function loadCaptcha(fallback) {
    try {
      const noCrypto = !(window.crypto && crypto.subtle);
      const d = await fetch('/api/captcha' + (fallback === true || noCrypto ? '?fallback=1' : '')).then((r) => r.json());
      capOn = !!d.enabled; capId = d.id; capMode = d.mode; shownAt = Date.now(); powDone = null; powNonce = '';
      $('captchaBox').hidden = !capOn; $('powState').hidden = !(capOn && d.mode === 'pow'); $('qBox').hidden = !(capOn && d.mode !== 'pow');
      $('r-captcha').value = '';
      if (!capOn) return;
      if (d.mode === 'pow') {
        $('powState').textContent = 'Sicherheitsprüfung läuft … (automatisch, du musst nichts tun)';
        powDone = solvePow(d.challenge, d.bits).then((n) => { powNonce = n; $('powState').textContent = '✔ Sicherheitsprüfung bestanden'; return n; }, () => { $('powState').textContent = 'Sicherheitsprüfung fehlgeschlagen – bitte Seite neu laden.'; return ''; });
      } else if (d.mode === 'math') {
        $('captchaLabel').textContent = d.question; $('imgRow').hidden = true; $('r-captcha').inputMode = 'numeric';
      } else {
        $('captchaLabel').textContent = 'Welche 4 Ziffern siehst du?'; $('imgRow').hidden = false; $('captchaImg').innerHTML = d.svg; $('r-captcha').inputMode = 'numeric';
      }
    } catch { /* später erneut */ }
  }
  $('captchaNew').addEventListener('click', () => loadCaptcha());
  loadCaptcha();
  $('regForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = $('p-register'); showErr(p, '');
    const username = ru.value.trim(), pw = $('r-pass').value;
    if (!username) return showErr(p, 'Bitte einen Benutzernamen wählen.');
    if (pw.length < 8) return showErr(p, 'Das Passwort braucht mindestens 8 Zeichen.');
    if (pw !== $('r-pass2').value) return showErr(p, 'Die Passwörter stimmen nicht überein.');
    if (!$('r-accept').checked) return showErr(p, 'Bitte bestätige die Regeln und das Anmelde-Cookie.');
    await busy($('regBtn'), async () => {
      try {
        const wait = 3000 - (Date.now() - shownAt); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); // Mindest-Ausfüllzeit, ohne Fehlermeldung
        if (capOn && capMode === 'pow') { $('powState').textContent = 'Sicherheitsprüfung läuft …'; await powDone; }
        const d = await api('POST', '/api/auth/register', { username, password: pw, accept: true, website: $('r-web').value, took_ms: Date.now() - shownAt, captcha_id: capId, captcha: capMode === 'pow' ? powNonce : $('r-captcha').value });
        codes = d.recovery_codes || []; regActive = true;
        $('codeList').replaceChildren(...codes.map((c) => { const li = document.createElement('li'); li.textContent = c; return li; }));
        $('regStep').hidden = true; $('regCodes').hidden = false; $('tabs').hidden = true;
        $('regCodes').querySelector('h1').tabIndex = -1; $('regCodes').querySelector('h1').focus();
      } catch (err) { showErr(p, err.message); loadCaptcha(); }
    });
  });
  const note = (t) => { const m = $('copyMsg'); m.textContent = t; m.hidden = false; };
  $('copyCodes').addEventListener('click', async () => {
    const text = codes.join('\n');
    try { await navigator.clipboard.writeText(text); note('Codes kopiert.'); return; } catch {}
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    note(ok ? 'Codes kopiert.' : 'Kopieren nicht möglich – markiere die Codes bitte von Hand.');
  });
  $('saveCodes').addEventListener('click', () => {
    const txt = 'turkac.org – Wiederherstellungscodes\nJeder Code funktioniert nur einmal. Sicher aufbewahren!\n\n' + codes.join('\n') + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = 'turkac-wiederherstellungscodes.txt';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    note('Datei gespeichert.');
  });
  $('codesSaved').addEventListener('change', () => { $('codesGo').disabled = !$('codesSaved').checked; });
  $('codesGo').addEventListener('click', () => go(NEXT));

  // ---- Passwort vergessen ----
  $('recForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = $('p-recover'); showErr(p, '');
    const username = $('c-user').value.trim(), code = $('c-code').value.trim(), np = $('c-pass').value;
    if (!username || !code) return showErr(p, 'Bitte Benutzername und Wiederherstellungscode eingeben.');
    if (np.length < 8) return showErr(p, 'Das neue Passwort braucht mindestens 8 Zeichen.');
    if (np !== $('c-pass2').value) return showErr(p, 'Die Passwörter stimmen nicht überein.');
    await busy($('recBtn'), async () => {
      try {
        await api('POST', '/api/auth/recover', { username, code, new_password: np });
        $('recForm').reset(); select('login');
        $('l-user').value = username; $('loginOk').textContent = 'Passwort geändert. Du kannst dich jetzt anmelden. Der benutzte Code ist verbraucht.'; $('loginOk').hidden = false; $('l-pass').focus();
      } catch (err) { showErr(p, err.message); }
    });
  });

  // ---- Start ----
  select(location.hash.slice(1));
  (async () => {
    try { const c = await api('GET', '/api/config'); regOpen = c.registration_open !== false; } catch {}
    if (!regOpen) { $('regStep').hidden = true; $('regClosed').hidden = false; }
    try { const d = await api('GET', '/api/auth/me'); if (d.user && !regActive) { me = d.user; showMe(); } } catch {}
  })();
})();
