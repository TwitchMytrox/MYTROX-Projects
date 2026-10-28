/* turkac.org – Admin: Wartung, Einstellungen, Protokoll, Backup, Mein Konto */
(() => {
  'use strict';
  const NX = window.NX;
  const { el, fmt, dur, api, j, toast, guard, modal, confirmBox, pager, table, nw, empty, field, head, reload, VIEWS, can, state, onCleanup, copyText, codesView, roleBadge } = NX;

  // ======================================================================
  // Wartung
  // ======================================================================
  const DURATIONS = [['unbefristet', 0], ['15 Min', 15], ['30 Min', 30], ['1 Std', 60], ['2 Std', 120], ['6 Std', 360], ['12 Std', 720], ['24 Std', 1440]];
  const toLocalInput = (ms) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

  VIEWS.maint = async () => {
    const m = await api('/api/admin/maintenance');
    const live = el('span', { class: 'countdown' });
    const tick = () => {
      const t = Date.now();
      if (m.active) live.textContent = m.until ? `Endet in ${dur(m.until - t)}` : 'Unbefristet – bis du sie beendest';
      else if (m.scheduled) live.textContent = `Startet in ${dur(m.start - t)}`;
      else live.textContent = '';
      if ((m.active && m.until && m.until <= t) || (m.scheduled && m.start <= t)) { clearInterval(iv); setTimeout(reload, 1200); }
    };
    const iv = setInterval(tick, 1000); onCleanup(() => clearInterval(iv)); tick();

    const status = m.active ? ['AN', 'red', m.until ? `bis ${fmt(m.until)}` : 'unbefristet'] : m.scheduled ? ['GEPLANT', 'warn', `${fmt(m.start)}${m.until ? ' bis ' + fmt(m.until) : ' (unbefristet)'}`] : ['AUS', 'green', 'Die Seite ist normal erreichbar.'];
    const card = el('div', { class: 'panel maint-card ' + status[1] }, el('div', { class: 'maint-state' }, el('span', { class: 'pill ' + status[1] }, status[0]), el('b', {}, status[2])), live,
      (m.active || m.scheduled) && el('div', {}, el('button', { class: 'btn danger', type: 'button', onclick: guard(async () => {
        if (await confirmBox(m.active ? 'Wartung beenden?' : 'Geplante Wartung löschen?', m.active ? 'Die Seite ist sofort wieder für alle erreichbar.' : 'Der Plan wird verworfen.', m.active ? 'Wartung beenden' : 'Plan löschen', false)) { await j('PUT', '/api/admin/maintenance', { on: false }); toast('Wartung beendet'); reload(); }
      }) }, m.active ? 'Wartung beenden' : 'Plan löschen')),
      el('p', { class: 'small muted', style: 'margin:0' }, 'Das Team kann während der Wartung normal weiterarbeiten. Nach dem Ende schaltet sich die Seite automatisch wieder ein.'));

    const message = el('textarea', { rows: '2', maxlength: '300', placeholder: 'z. B. Wir sind gleich wieder da!' }); message.value = m.message || '';
    const redirect = el('input', { type: 'text', inputmode: 'url', placeholder: 'https://… (optional)', value: m.redirect || '' });
    const mins = el('input', { type: 'number', min: '1', max: '43200', placeholder: 'eigene Minuten' });
    const send = (body, msg) => guard(async () => { await j('PUT', '/api/admin/maintenance', { message: message.value, redirect: redirect.value.trim(), ...body }); toast(msg); reload(); });
    const start = el('input', { type: 'datetime-local', value: m.scheduled ? toLocalInput(m.start) : '' });
    const end = el('input', { type: 'datetime-local', value: m.scheduled && m.until ? toLocalInput(m.until) : '' });
    const plan = guard(async () => {
      if (!start.value) throw new Error('Bitte einen Start wählen');
      const body = { start: new Date(start.value).getTime() };
      if (end.value) body.until = new Date(end.value).getTime();
      await send(body, 'Wartung geplant')();
    });
    return [head('Wartung'), card,
      el('div', { class: 'grid cols-eq', style: 'margin-top:14px' },
        el('div', { class: 'panel stack' }, el('h3', {}, 'Jetzt einschalten'),
          field('Nachricht für Besucher', message), field('Weiterleitung', redirect, 'Besucher werden während der Wartung dorthin geleitet.'),
          el('div', { class: 'acts' }, DURATIONS.map(([l, v]) => el('button', { class: 'btn' + (v ? '' : ' danger'), type: 'button', onclick: guard(async () => {
            if (await confirmBox('Wartung jetzt einschalten?', `Besucher sehen sofort die Wartungsseite (${l}). Das Team kann weiterarbeiten.`, 'Einschalten')) await send(v ? { on: true, minutes: v } : { on: true }, 'Wartung ist AN')();
          }) }, l))),
          el('div', { class: 'row' }, field('Eigene Dauer', mins), el('button', { class: 'btn', type: 'button', onclick: guard(async () => {
            if (!(Number(mins.value) >= 1)) throw new Error('Bitte Minuten eintragen');
            if (await confirmBox('Wartung jetzt einschalten?', `Dauer: ${mins.value} Minuten.`, 'Einschalten')) await send({ on: true, minutes: Number(mins.value) }, 'Wartung ist AN')();
          }) }, 'Einschalten'))),
        el('div', { class: 'panel stack' }, el('h3', {}, 'Wartung planen'),
          el('p', { class: 'small muted', style: 'margin:0' }, 'Nachricht und Weiterleitung nimmst du von links. Zeiten gelten in deiner Ortszeit.'),
          field('Start', start), field('Ende (optional)', end), el('div', {}, el('button', { class: 'btn primary', type: 'button', onclick: plan }, 'Planen'))))];
  };

  // ======================================================================
  // Einstellungen
  // ======================================================================
  VIEWS.settings = async () => {
    const s = await api('/api/admin/settings');
    const on = (v) => v === true || v === '1' || v === 1;
    const text = (k, max) => el('input', { type: 'text', maxlength: String(max), value: s[k] || '' });
    const area = (k) => { const t = el('textarea', { rows: '2', maxlength: '300' }); t.value = s[k] || ''; return t; };
    const num = (k, min, max) => el('input', { type: 'number', min: String(min), max: String(max), value: s[k] });
    const sw = (k, label, hint) => { const c = el('input', { type: 'checkbox', checked: on(s[k]) }); return { k, c, node: el('div', { class: 'switch-row' }, el('label', { class: 'check' }, c, label), el('small', { class: 'hint' }, hint)) }; };
    const f = { site_name: text('site_name', 30), tagline: text('tagline', 100), announcement: area('announcement'), max_upload_mb: num('max_upload_mb', 1, 200), slowmode_seconds: num('slowmode_seconds', 0, 3600) };
    const sws = [
      sw('announcement_on', 'Ankündigung anzeigen', 'Zeigt den Ankündigungstext als Banner im Forum.'),
      sw('uploads_enabled', 'Datei-Uploads erlauben', 'Aus: Niemand kann Bilder oder Videos hochladen.'),
      sw('allow_new_threads', 'Neue Threads erlauben', 'Aus: Nur noch Kommentare möglich – praktisch bei Raids oder Spam-Wellen.'),
      sw('registration_open', 'Registrierung offen', 'Aus: Neue Konten können nicht mehr angelegt werden; bestehende Mitglieder melden sich weiter an.'),
      sw('captcha_on', 'Captcha bei Registrierung', 'An: Neue Konten müssen eine Sicherheitsprüfung bestehen (selbst gehostet, kein Drittanbieter). Honeypot und Zeitprüfung laufen immer.'),
      sw('team_mfa_required', 'Zwei-Faktor + E-Mail für das Team erzwingen', 'Aus (Standard): Zwei-Faktor ist für alle freiwillig, auch fürs Team. An: Teammitglieder müssen 2FA und E-Mail einrichten, bevor sie den Admin-Bereich nutzen können.'),
      sw('require_login_to_post', 'Schreiben nur mit Konto', 'An: Gäste dürfen nur lesen; Threads, Kommentare und Uploads brauchen ein Konto.'),
      sw('guest_read', 'Gäste dürfen lesen', 'An: Das Forum ist ohne Anmeldung lesbar. Aus: Gäste sehen nur die Startseite und müssen sich anmelden.'),
    ];
    const capMode = el('select', { 'aria-label': 'Art der Sicherheitsprüfung' }, [['pow', 'Automatisch im Hintergrund (empfohlen, nichts zu tippen)'], ['math', 'Einfache Rechenfrage (z. B. „drei plus vier“)'], ['image', 'Bild mit 4 Ziffern']].map(([v, l]) => el('option', { value: v, selected: (s.captcha_mode || 'pow') === v }, l)));
    const save = guard(async () => {
      const body = { site_name: f.site_name.value, tagline: f.tagline.value, announcement: f.announcement.value, max_upload_mb: Number(f.max_upload_mb.value), slowmode_seconds: Number(f.slowmode_seconds.value) };
      body.captcha_mode = capMode.value;
      sws.forEach((x) => { body[x.k] = x.c.checked ? '1' : '0'; });
      await j('PUT', '/api/admin/settings', body); toast('Einstellungen gespeichert');
    });
    return [head('Einstellungen'), el('form', { class: 'panel stack', onsubmit: (e) => { e.preventDefault(); save(); } },
      el('div', { class: 'form-grid' }, field('Seitenname', f.site_name), field('Untertitel', f.tagline), field('Ankündigung', f.announcement, null, 'full'),
        field('Art der Sicherheitsprüfung', capMode, 'Gilt bei der Registrierung, wenn das Captcha an ist.'), field('Max. Upload (MB)', f.max_upload_mb), field('Slowmode (Sekunden zwischen Beiträgen)', f.slowmode_seconds, '0 = aus')),
      el('div', { class: 'switches' }, sws.map((x) => x.node)),
      el('div', {}, el('button', { class: 'btn primary', type: 'submit' }, 'Speichern')))];
  };

  // ======================================================================
  // Protokoll + Backup
  // ======================================================================
  let auditPage = 1, auditQ = '';
  VIEWS.audit = async () => {
    const d = await api(`/api/admin/audit?page=${auditPage}&q=${encodeURIComponent(auditQ)}`);
    const q = el('input', { type: 'search', placeholder: 'Suchen …', value: auditQ, 'aria-label': 'Protokoll durchsuchen' });
    q.onkeydown = (e) => { if (e.key === 'Enter') { auditQ = q.value.trim(); auditPage = 1; reload(); } };
    const chain = d.chain.ok ? el('span', { class: 'pill' }, `🔗 Kette gültig (${d.chain.checked} gesichert)`) : el('span', { class: 'pill red' }, `⚠ Kette gebrochen bei Eintrag #${d.chain.broken_at}`);
    return [head('Protokoll', `${d.total} Einträge · verschlüsselt, unveränderlich`), el('div', { class: 'bar' }, q, chain),
      d.rows.length ? table(['Zeit', 'Wer', 'Aktion', 'Details'], d.rows.map((r) => ({ cells: [nw(fmt(r.created_at)), nw(r.admin), nw(el('span', { class: 'pill' }, r.action)), el('span', { class: 'small' }, r.detail)] }))) : empty('Keine Einträge.'),
      pager(auditPage, d.pages, (p) => { auditPage = p; reload(); })];
  };

  VIEWS.legal = async () => {
    const d = await api('/api/admin/legal');
    const inp = (k, ph) => el('input', { type: 'text', maxlength: '300', value: d[k] || '', placeholder: ph });
    const area = (k) => { const t = el('textarea', { rows: '10', maxlength: '20000', placeholder: 'Leer lassen = Mustertext verwenden. Format: „## Überschrift“, „- Liste“, „**fett**“.' }); t.value = d[k] || ''; return t; };
    const f = { operator_name: inp('operator_name', 'Name / Firma'), operator_address: inp('operator_address', 'Straße, PLZ Ort'), operator_email: inp('operator_email', 'E-Mail für Anfragen'), impressum: area('impressum'), datenschutz: area('datenschutz'), agb: area('agb'), regeln: area('regeln') };
    const fill = (k) => el('button', { class: 'btn sm', type: 'button', onclick: () => { f[k].value = d.defaults[k]; toast('Mustertext eingefügt – jetzt anpassen und speichern'); } }, 'Mustertext einfügen');
    const save = guard(async () => { const body = {}; Object.keys(f).forEach((k) => { body[k] = f[k].value; }); await j('PUT', '/api/admin/legal', body); toast('Rechtstexte gespeichert'); });
    return [head('Rechtstexte', 'Impressum, Datenschutz, Nutzungsbedingungen, Regeln'),
      el('div', { class: 'alert warn' }, 'Die Mustertexte sind keine Rechtsberatung. Lass sie vor dem Start prüfen. Für ein Impressum in Deutschland brauchst du eine ladungsfähige Anschrift – ein Postfach reicht nicht.'),
      el('form', { class: 'panel stack', onsubmit: (e) => { e.preventDefault(); save(); } },
        el('h3', {}, 'Betreiber (fließt in Impressum und Datenschutz ein)'),
        el('div', { class: 'form-grid' }, field('Name / Firma', f.operator_name), field('Anschrift', f.operator_address), field('E-Mail', f.operator_email)),
        ...['impressum', 'datenschutz', 'agb', 'regeln', 'cookies', 'barrierefreiheit'].flatMap((k) => [el('h3', {}, { impressum: 'Impressum', datenschutz: 'Datenschutzerklärung', agb: 'Nutzungsbedingungen', regeln: 'Regeln', cookies: 'Cookies', barrierefreiheit: 'Barrierefreiheit' }[k]), f[k], el('div', {}, fill(k), ' ', el('a', { href: '/' + k, target: '_blank', rel: 'noopener', class: 'small' }, '↗ Seite ansehen'))]),
        el('div', {}, el('button', { class: 'btn primary', type: 'submit' }, 'Speichern')))];
  };

  VIEWS.backup = async () => [head('Backup'), el('div', { class: 'panel stack' },
    el('p', { style: 'margin:0' }, 'Lädt eine vollständige Kopie der Datenbank (Konten, Threads, Kommentare, Einstellungen) herunter. Bewahre die Datei sicher auf – sie enthält sensible Daten.'),
    el('div', {}, el('a', { class: 'btn primary', href: '/api/admin/backup', download: '' }, '💾 Backup herunterladen')))];

  // ======================================================================
  // Mein Konto
  // ======================================================================
  VIEWS.account = async () => {
    const d = await api('/api/account');
    const u = d.user;
    const pwForm = (() => {
      const cur = el('input', { type: 'password', autocomplete: 'current-password', required: true });
      const nw1 = el('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
      const nw2 = el('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
      return el('form', { class: 'panel stack', onsubmit: guard(async (e) => {
        e.preventDefault();
        if (nw1.value !== nw2.value) throw new Error('Die neuen Passwörter stimmen nicht überein');
        await j('POST', '/api/account/password', { current: cur.value, next: nw1.value }); toast('Passwort geändert'); cur.value = nw1.value = nw2.value = '';
      }) }, el('h3', {}, 'Passwort ändern'), field('Aktuelles Passwort', cur), field('Neues Passwort (min. 8 Zeichen)', nw1), field('Neues Passwort wiederholen', nw2), el('div', {}, el('button', { class: 'btn primary', type: 'submit' }, 'Passwort ändern')));
    })();
    const mailForm = (() => {
      const pw = el('input', { type: 'password', autocomplete: 'current-password', required: true });
      const mail = el('input', { type: 'email', autocomplete: 'email', required: true });
      return el('form', { class: 'panel stack', onsubmit: guard(async (e) => {
        e.preventDefault(); await j('POST', '/api/account/email', { password: pw.value, email: mail.value.trim() }); toast('E-Mail gespeichert'); pw.value = mail.value = '';
      }) }, el('h3', {}, 'E-Mail ändern'), el('p', { class: 'small muted', style: 'margin:0' }, u.has_email ? 'Es ist eine E-Mail hinterlegt (aus Sicherheitsgründen wird sie nicht angezeigt).' : 'Noch keine E-Mail hinterlegt.'),
      field('Neue E-Mail', mail), field('Passwort zur Bestätigung', pw), el('div', {}, el('button', { class: 'btn primary', type: 'submit' }, 'Speichern')));
    })();
    const recForm = (() => {
      const pw = el('input', { type: 'password', autocomplete: 'current-password', required: true });
      const code = el('input', { type: 'text', autocomplete: 'one-time-code', required: u.totp_on, placeholder: '6-stelliger App-Code' });
      return el('form', { class: 'panel stack', onsubmit: guard(async (e) => {
        e.preventDefault();
        const r = await j('POST', '/api/account/recovery-codes', { password: pw.value, code: code.value.replace(/\s/g, '') });
        pw.value = code.value = '';
        const mm = modal('Neue Wiederherstellungscodes', codesView(r.recovery_codes, () => mm.close(), 'Fertig'), { persistent: true });
        reload();
      }) }, el('h3', {}, 'Wiederherstellungscodes'), el('p', { class: 'small muted', style: 'margin:0' }, `Noch ${d.recovery_codes_left} von 10 Codes übrig. Neue Codes ersetzen alle alten.`),
      field('Passwort', pw), u.totp_on && field('App-Code', code), el('div', {}, el('button', { class: 'btn', type: 'submit' }, 'Neue Codes erzeugen')));
    })();
    const perms = state.me.permissions || [];
    const mine = (state.me.user.perms || []);
    const groups = [...new Set(perms.map((p) => p.group))];
    return [head('Mein Konto', u.username), el('div', { class: 'grid cols-eq' },
      el('div', { class: 'stack' },
        el('div', { class: 'panel stack' }, el('h3', {}, 'Status'),
          el('div', {}, roleBadge(u.role) || el('span', { class: 'muted' }, 'keine Rolle'), u.role && el('span', { class: 'small muted' }, `  Stufe ${u.role.level}`)),
          el('div', { class: 'facts' }, [['Zwei-Faktor', u.totp_on ? 'aktiv' : 'aus'], ['E-Mail', u.has_email ? 'hinterlegt' : 'fehlt'], ['Sitzungen', d.sessions], ['Dabei seit', new Date(u.created_at).toLocaleDateString('de-DE')]].map(([k, v]) => el('div', {}, el('b', {}, v), el('span', {}, k)))),
          el('div', {}, el('button', { class: 'btn', type: 'button', onclick: guard(async () => { if (await confirmBox('Andere Sitzungen beenden?', 'Alle anderen Geräte werden abgemeldet. Diese Sitzung bleibt.', 'Beenden', false)) { await j('POST', '/api/account/logout-all'); toast('Andere Sitzungen beendet'); reload(); } }) }, 'Alle anderen Sitzungen beenden'))),
        pwForm, mailForm, recForm),
      el('div', { class: 'panel stack' }, el('h3', {}, 'Meine Rechte'), el('p', { class: 'small muted', style: 'margin:0' }, `${mine.includes('*') ? 'Alle' : mine.length} Rechte durch deine Rolle.`),
        groups.map((g) => el('div', {}, el('b', { class: 'gname' }, g), el('ul', { class: 'perm-list' }, perms.filter((p) => p.group === g).map((p) => el('li', { class: can(p.key) ? 'yes' : 'no' }, el('span', { 'aria-hidden': 'true' }, can(p.key) ? '✔' : '✖'), ' ', p.label, el('span', { class: 'sr' }, can(p.key) ? ' (ja)' : ' (nein)')))))))) ];
  };
})();
