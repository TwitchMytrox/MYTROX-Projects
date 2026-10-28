/* turkac.org – Konto-Oberfläche im Forum: Benutzermenü, Profil, Sicherheit, Einstellungen, Status, Daten.
   Wird von app.js über window.NXAccountFactory(NX) eingebunden (muss VOR app.js geladen werden). */
window.NXAccountFactory = (NX) => {
  'use strict';
  const { el, api, upload, toast, modal, store } = NX;
  const root = document.documentElement;
  let me = null;
  let accInfo = { recovery_codes_left: 0, sessions: 1 };

  // ------------------------------------------------------------------
  // Einstellungen anwenden (Design, Schrift, Bewegung, Kontrast)
  // ------------------------------------------------------------------
  const loadPrefs = () => { try { return JSON.parse(store.get('nx_prefs', '{}') || '{}'); } catch { return {}; } };
  function apply() {
    const s = me ? me.settings || {} : loadPrefs();
    if (me) store.set('nx_prefs', JSON.stringify(s));
    const light = s.theme === 'light' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
    root.dataset.theme = light ? 'light' : 'dark';
    root.dataset.font = s.font_size || 'normal';
    root.dataset.motion = s.reduce_motion ? 'reduce' : '';
    root.dataset.contrast = s.high_contrast ? 'high' : '';
    if (me && typeof s.sound === 'boolean') NX.setSound(s.sound);
  }

  async function load() {
    try { me = (await api('/api/auth/me')).user; } catch { me = null; }
    apply();
    return me;
  }

  const fmtDate = (ts) => new Date(ts).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  const needLogin = (why) => {
    const m = modal('Anmeldung nötig', el('div', { style: 'display:grid;gap:14px' },
      el('p', {}, why || 'Dafür brauchst du ein Konto. Es ist anonym: nur ein Benutzername, keine E-Mail nötig.'),
      el('div', { class: 'row' },
        el('a', { class: 'btn btn-primary', href: '/auth/#register' }, 'Registrieren'),
        el('a', { class: 'btn btn-ghost', href: '/auth/?next=' + encodeURIComponent(location.pathname) + '#login' }, 'Anmelden'))));
    return m;
  };

  // Autor-Anzeige (Konto oder alter anonymer Beitrag)
  function whoBadge(author, fallbackName) {
    if (!author) return null;
    return author.role ? el('span', { class: 'tag role-tag', vars: { '--rc': author.role.color } }, author.role.name) : null;
  }

  // ------------------------------------------------------------------
  // Hilfen für Formulare
  // ------------------------------------------------------------------
  const add = (node, ...kids) => node.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  const field = (label, input, hint) => el('div', { class: 'field' }, el('label', {}, label), input, hint && el('div', { class: 'hint' }, hint));
  const pwInput = (ph) => el('input', { type: 'password', autocomplete: 'off', placeholder: ph || '' });

  function showCodes(codes, title) {
    const text = `turkac.org – Wiederherstellungscodes für ${me ? me.username : ''}\nJeder Code funktioniert nur einmal. Bewahre die Datei sicher auf (nicht im Forum teilen)!\n\n${codes.join('\n')}\n`;
    const saved = el('input', { type: 'checkbox' });
    const done = el('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Fertig');
    saved.addEventListener('change', () => { done.disabled = !saved.checked; });
    const body = el('div', { style: 'display:grid;gap:12px' },
      el('p', {}, 'Mit diesen Codes kommst du in dein Konto, wenn du dein Passwort oder dein Handy verlierst. Es gibt keine E-Mail zum Zurücksetzen!'),
      el('ul', { class: 'codes' }, ...codes.map((c) => el('li', {}, c))),
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(codes.join('\n')); toast('Codes kopiert 📋'); } catch { toast('Kopieren nicht möglich – bitte markieren und kopieren', 'err'); } } }, 'Kopieren'),
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => {
          const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'turkac-wiederherstellungscodes.txt' });
          document.body.append(a); a.click(); a.remove();
        } }, 'Als Datei speichern')),
      el('label', { class: 'check' }, saved, el('span', {}, 'Ich habe meine Codes sicher gespeichert.')), done);
    const m = modal(title || 'Deine Wiederherstellungscodes', body);
    done.addEventListener('click', m.close);
  }

  // ------------------------------------------------------------------
  // Tabs: Profil
  // ------------------------------------------------------------------
  function tabProfile(box, refresh) {
    const avatarBox = el('div', { class: 'av-big' });
    const drawAvatar = () => avatarBox.replaceChildren(me.avatar ? el('img', { src: me.avatar, alt: 'Profilbild' }) : NX.avatar(me.username, 96));
    drawAvatar();
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      const fd = new FormData(); fd.append('avatar', file.files[0], file.files[0].name);
      try { const r = await upload('/api/account/avatar', fd); me.avatar = r.avatar; drawAvatar(); NX.renderUserArea(); toast('Profilbild gespeichert ✔'); }
      catch (e) { toast(e.message, 'err'); }
      file.value = '';
    });
    const bio = el('textarea', { maxlength: '300', rows: '3', placeholder: 'Ein, zwei Sätze über dich (optional, für alle sichtbar)' }, me.bio || '');
    bio.value = me.bio || '';
    const nu = el('input', { type: 'text', maxlength: '20', placeholder: 'Neuer Benutzername', autocomplete: 'off' });
    const npw = pwInput('Dein Passwort zur Bestätigung');
    const cool = me.rename_available_at && me.rename_available_at > Date.now();
    add(box, 
      el('div', { class: 'av-row' }, avatarBox, el('div', { style: 'display:grid;gap:8px' },
        el('div', { class: 'row' },
          el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => file.click() }, 'Bild hochladen'),
          me.avatar && el('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
            try { await api('/api/account/avatar', { method: 'DELETE' }); me.avatar = null; drawAvatar(); NX.renderUserArea(); toast('Profilbild entfernt'); } catch (e) { toast(e.message, 'err'); }
          } }, 'Entfernen')),
        el('div', { class: 'hint' }, 'PNG, JPG, WebP oder GIF, höchstens 1 MB.'), file)),
      field('Kurzbeschreibung', bio),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        try { await api('/api/account/profile', { method: 'PATCH', json: { bio: bio.value } }); me.bio = bio.value; toast('Beschreibung gespeichert ✔'); } catch (e) { toast(e.message, 'err'); }
      } }, 'Speichern'),
      el('hr', { class: 'sep' }),
      el('h3', {}, 'Benutzernamen ändern'),
      el('p', { class: 'hint' }, cool ? `Du kannst deinen Namen erst am ${new Date(me.rename_available_at).toLocaleDateString('de-DE')} wieder ändern.` : 'Möglich alle 14 Tage. Dein alter Name bleibt reserviert, damit ihn niemand übernehmen kann.'),
      !cool && field('Neuer Name', nu), !cool && field('Passwort', npw),
      !cool && el('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
        try { const r = await api('/api/account/username', { method: 'POST', json: { username: nu.value.trim(), password: npw.value } }); me.username = r.username; toast('Name geändert ✔'); NX.renderUserArea(); refresh(); } catch (e) { toast(e.message, 'err'); }
      } }, 'Namen ändern'));
  }

  // ------------------------------------------------------------------
  // Tabs: Sicherheit
  // ------------------------------------------------------------------
  function tabSecurity(box, refresh) {
    const cur = pwInput('Aktuelles Passwort'); const nw = pwInput('Neues Passwort (min. 8 Zeichen)'); const nw2 = pwInput('Neues Passwort wiederholen');
    add(box, 
      el('h3', {}, 'Passwort ändern'),
      field('Aktuell', cur), field('Neu', nw), field('Wiederholen', nw2),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        if (nw.value !== nw2.value) return toast('Die neuen Passwörter stimmen nicht überein', 'err');
        try { await api('/api/account/password', { method: 'POST', json: { current: cur.value, next: nw.value } }); cur.value = nw.value = nw2.value = ''; toast('Passwort geändert ✔ (andere Geräte wurden abgemeldet)'); } catch (e) { toast(e.message, 'err'); }
      } }, 'Passwort ändern'),
      el('hr', { class: 'sep' }));

    // Zwei-Faktor
    const tf = el('div', { style: 'display:grid;gap:10px' });
    add(box, el('h3', {}, 'Zwei-Faktor-Anmeldung'), tf, el('hr', { class: 'sep' }));
    if (me.totp_on) {
      const pw = pwInput('Passwort'); const code = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'App-Code oder Wiederherstellungscode', autocomplete: 'off' });
      add(tf, el('p', { class: 'ok-line' }, '✔ Aktiv – dein Konto verlangt beim Login zusätzlich einen Code aus deiner Authenticator-App.'),
        me.team ? el('p', { class: 'hint' }, 'Für Teammitglieder ist Zwei-Faktor Pflicht und kann nicht abgeschaltet werden.')
          : el('details', {}, el('summary', {}, 'Zwei-Faktor abschalten'), field('Passwort', pw), field('Code', code),
            el('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
              try { await api('/api/account/2fa/disable', { method: 'POST', json: { password: pw.value, code: code.value } }); me.totp_on = false; toast('Zwei-Faktor abgeschaltet'); refresh(); } catch (e) { toast(e.message, 'err'); }
            } }, 'Abschalten')));
    } else {
      const pw = pwInput('Dein Passwort');
      const area = el('div', { style: 'display:grid;gap:10px' });
      add(tf, el('p', {}, 'Empfohlen: Mit einer Authenticator-App (z. B. Aegis, Google Authenticator, Microsoft Authenticator) schützt du dein Konto auch dann, wenn jemand dein Passwort kennt.'),
        field('Passwort bestätigen', pw),
        el('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
          try {
            const r = await api('/api/account/2fa/setup', { method: 'POST', json: { password: pw.value } });
            const code = el('input', { type: 'text', inputmode: 'numeric', maxlength: '6', placeholder: '6-stelliger Code', autocomplete: 'off' });
            area.replaceChildren(
              el('p', {}, 'Trage diesen Schlüssel in deiner Authenticator-App ein (Konto hinzufügen → Schlüssel manuell eingeben, zeitbasiert):'),
              el('code', { class: 'secret' }, r.secret.match(/.{1,4}/g).join(' ')),
              el('div', { class: 'row' }, el('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(r.secret); toast('Schlüssel kopiert'); } catch { /* ignorieren */ } } }, 'Schlüssel kopieren'),
                el('a', { class: 'btn btn-ghost', href: r.uri }, 'In App öffnen')),
              field('Code aus der App', code),
              el('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
                try { const e = await api('/api/account/2fa/enable', { method: 'POST', json: { code: code.value } }); me.totp_on = true; toast('Zwei-Faktor aktiv ✔'); refresh(); showCodes(e.recovery_codes, 'Neue Wiederherstellungscodes'); } catch (er) { toast(er.message, 'err'); }
              } }, 'Bestätigen & aktivieren'));
          } catch (e) { toast(e.message, 'err'); }
        } }, 'Einrichten'), area);
    }

    // Sicherheitsschlüssel (WebAuthn)
    {
      const wa = el('div', { style: 'display:grid;gap:10px' });
      add(box, el('h3', {}, '🔑 Sicherheitsschlüssel'),
        el('p', { class: 'hint' }, 'Ein USB-/NFC-Schlüssel (z. B. YubiKey), Windows Hello, Touch ID oder ein Handy-Passkey dient als zweiter Faktor – ohne Code abtippen. Beim Anmelden bestätigst du nur noch am Schlüssel.'), wa);
      const draw = async () => {
        let d; try { d = await api('/api/account/webauthn'); } catch (e) { wa.replaceChildren(el('p', { class: 'hint' }, e.message)); return; }
        me.webauthn_keys = d.keys.length; me.mfa = !!(me.totp_on || d.keys.length);
        const pw = pwInput('Passwort'); const nm = el('input', { type: 'text', maxlength: '40', placeholder: 'Name, z. B. „YubiKey blau“', autocomplete: 'off' });
        wa.replaceChildren(
          ...d.keys.map((k) => el('div', { class: 'row' }, el('span', {}, `🔑 ${k.name} · seit ${fmtDate(k.created_at)}${k.last_used ? ' · zuletzt ' + fmtDate(k.last_used) : ''}`),
            el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
              if (!pw.value) return toast('Bitte unten dein Passwort eingeben', 'err');
              try { await api('/api/account/webauthn/' + k.id, { method: 'DELETE', json: { password: pw.value } }); toast('Schlüssel entfernt'); draw(); } catch (e) { toast(e.message, 'err'); }
            } }, 'Entfernen'))),
          window.NXWebAuthn && NXWebAuthn.supported() ? el('div', { style: 'display:grid;gap:8px' }, field('Name', nm), field('Passwort bestätigen', pw),
            el('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
              try {
                const o = await api('/api/account/webauthn/options', { method: 'POST', json: { password: pw.value } });
                toast('Bitte jetzt den Schlüssel berühren …');
                const credential = await NXWebAuthn.create(o.publicKey);
                const r = await api('/api/account/webauthn/register', { method: 'POST', json: { id: o.id, name: nm.value || 'Sicherheitsschlüssel', credential } });
                toast('Sicherheitsschlüssel hinzugefügt ✔'); draw(); if (r.recovery_codes) showCodes(r.recovery_codes, 'Wiederherstellungscodes (falls der Schlüssel verloren geht)');
              } catch (e) { toast(e.message, 'err'); }
            } }, '＋ Schlüssel hinzufügen')) : el('p', { class: 'hint' }, 'Dieser Browser unterstützt keine Sicherheitsschlüssel.'));
      };
      draw();
      add(box, el('hr', { class: 'sep' }));
    }

    // Wiederherstellungscodes
    const rp = pwInput('Passwort'); const rc = el('input', { type: 'text', placeholder: 'App-Code (nur wenn Zwei-Faktor aktiv)', autocomplete: 'off' });
    add(box, el('h3', {}, 'Wiederherstellungscodes'),
      el('p', { class: 'hint' }, `Noch ${accInfo.recovery_codes_left} von 10 Codes übrig. Neue Codes machen alle alten ungültig.`),
      field('Passwort', rp), me.totp_on && field('Code', rc),
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
        try { const r = await api('/api/account/recovery-codes', { method: 'POST', json: { password: rp.value, code: rc.value } }); rp.value = ''; showCodes(r.recovery_codes, 'Neue Wiederherstellungscodes'); } catch (e) { toast(e.message, 'err'); }
      } }, 'Neue Codes erzeugen'),
      el('hr', { class: 'sep' }));

    // E-Mail (optional)
    const ep = pwInput('Passwort'); const em = el('input', { type: 'text', placeholder: me.has_email ? '(hinterlegt – zum Ändern neue Adresse eingeben)' : 'name@beispiel.de', autocomplete: 'off' });
    add(box, el('h3', {}, 'E-Mail (freiwillig)'),
      el('p', { class: 'hint' }, 'Nur wenn du magst. Sie wird verschlüsselt gespeichert und nicht für die Anmeldung gebraucht. Leer lassen und speichern entfernt sie.'),
      field('E-Mail', em), field('Passwort', ep),
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
        try { const r = await api('/api/account/email', { method: 'POST', json: { password: ep.value, email: em.value } }); me.has_email = r.has_email; toast(r.has_email ? 'E-Mail gespeichert ✔' : 'E-Mail entfernt'); ep.value = ''; } catch (e) { toast(e.message, 'err'); }
      } }, 'Speichern'),
      el('hr', { class: 'sep' }),
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { try { await api('/api/account/logout-all', { method: 'POST', json: {} }); toast('Alle anderen Geräte wurden abgemeldet'); } catch (e) { toast(e.message, 'err'); } } }, `Alle anderen Geräte abmelden (${Math.max(0, accInfo.sessions - 1)} aktiv)`));
  }

  // ------------------------------------------------------------------
  // Tabs: Einstellungen / Status / Daten
  // ------------------------------------------------------------------
  function tabSettings(box) {
    const s = { theme: 'dark', font_size: 'normal', notify_popups: true, reduce_motion: false, high_contrast: false, sound: false, ...(me.settings || {}) };
    const save = async (patch) => {
      Object.assign(s, patch);
      try { const r = await api('/api/account/settings', { method: 'PATCH', json: patch }); me.settings = r.settings; apply(); } catch (e) { toast(e.message, 'err'); }
    };
    const sel = (key, opts) => { const x = el('select', {}, ...opts.map(([v, l]) => el('option', { value: v }, l))); x.value = s[key]; x.addEventListener('change', () => save({ [key]: x.value })); return x; };
    const sw = (key, label, hint) => {
      const c = el('input', { type: 'checkbox' }); c.checked = !!s[key]; c.addEventListener('change', () => save({ [key]: c.checked }));
      return el('label', { class: 'switch-row' }, c, el('span', {}, el('b', {}, label), hint && el('small', {}, hint)));
    };
    add(box, 
      field('Design', sel('theme', [['dark', '🌙 Dunkel'], ['light', '☀️ Hell'], ['system', '💻 Wie mein Gerät']])),
      field('Schriftgröße', sel('font_size', [['normal', 'Normal'], ['large', 'Groß'], ['xlarge', 'Sehr groß']])),
      sw('reduce_motion', 'Weniger Animationen', 'Schaltet Bewegung und Effekte weitgehend ab (hilft bei Schwindel/Reizüberflutung).'),
      sw('high_contrast', 'Hoher Kontrast', 'Kräftigere Farben und Rahmen für bessere Lesbarkeit.'),
      sw('sound', 'Sound-Effekte', 'Kleine Töne bei Aktionen.'),
      sw('notify_popups', 'Benachrichtigungen als Pop-up', 'Kleine Hinweise im Forum (z. B. später bei Antworten auf deine Beiträge).'),
      el('p', { class: 'hint' }, 'Änderungen werden sofort gespeichert und gelten auf allen Geräten, auf denen du angemeldet bist.'));
  }

  function tabStatus(box) {
    const order = [['normal', 'Normal'], ['verdacht', 'Verdacht'], ['untersuchung', 'Untersuchung'], ['gebannt', 'Gebannt']];
    const idx = order.findIndex(([k]) => k === me.status);
    add(box, 
      el('div', { class: 'status-track' }, ...order.map(([k, l], i) => el('div', { class: `st st-${k}` + (i === idx ? ' on' : '') + (i < idx ? ' past' : '') }, el('i', {}), el('span', {}, l)))),
      el('div', { class: `status-card st-${me.status}` }, el('h3', {}, me.status_label), el('p', {}, me.status_desc),
        me.status_note && el('p', { class: 'note' }, 'Hinweis vom Team: ', me.status_note),
        me.status_since && el('p', { class: 'hint' }, 'Seit ' + fmtDate(me.status_since))),
      me.timeout && el('div', { class: 'status-card st-untersuchung' }, el('h3', {}, me.timeout.mode === 'hidden' ? '⏳ Forum für dich ausgeblendet' : '⏳ Schreiben vorübergehend gesperrt'),
        el('p', {}, 'Bis ' + fmtDate(me.timeout.until) + (me.timeout.reason ? ' – ' + me.timeout.reason : ''))),
      el('p', {}, `Verwarnungen: ${me.warnings}`, me.warnings >= 2 ? ' – bei 3 Verwarnungen wird dein Konto automatisch auf „Verdacht“ gesetzt.' : ''),
      el('p', { class: 'hint' }, 'Die Stufen: Normal = alles in Ordnung · Verdacht = dein Konto wird beobachtet · Untersuchung = neue Threads und Uploads pausiert · Gebannt = gesperrt.'),
      el('p', { class: 'hint' }, `Dabei seit ${fmtDate(me.created_at)} · ${me.login_count} Anmeldungen`));
  }

  function tabData(box) {
    const pw = pwInput('Passwort'); const cf = el('input', { type: 'text', placeholder: `Tippe zur Bestätigung: ${me.username}`, autocomplete: 'off' });
    const code = el('input', { type: 'text', placeholder: 'App-Code', autocomplete: 'off' });
    add(box, 
      el('h3', {}, 'Deine Daten herunterladen'),
      el('p', { class: 'hint' }, 'Profil, Beiträge, Kommentare und Einstellungen als JSON-Datei. Passwörter und Geheimnisse sind nicht enthalten.'),
      el('a', { class: 'btn btn-ghost', href: '/api/account/export' }, '⬇ Export herunterladen'),
      el('hr', { class: 'sep' }),
      el('h3', { class: 'danger-h' }, 'Konto löschen'),
      el('p', { class: 'hint' }, me.team ? 'Teammitglieder müssen zuerst von der Inhaber-Rolle entbunden werden.' : 'Dein Profil, deine Anmeldedaten und deine Codes werden gelöscht. Deine Beiträge bleiben als „Gelöschter Nutzer“ sichtbar. Dein Name bleibt gesperrt, damit ihn niemand übernimmt. Das kann nicht rückgängig gemacht werden.'),
      !me.team && field('Passwort', pw), !me.team && me.totp_on && field('Zwei-Faktor-Code', code), !me.team && field('Bestätigung', cf),
      !me.team && el('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
        try { await api('/api/account/delete', { method: 'POST', json: { password: pw.value, confirm: cf.value.trim(), code: code.value } }); location.href = '/'; } catch (e) { toast(e.message, 'err'); }
      } }, 'Konto endgültig löschen'));
  }

  // ------------------------------------------------------------------
  // Einstellungs-Fenster
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // Ränge, XP, Credits, Abzeichen
  // ------------------------------------------------------------------
  function paintXp() {
    const lvl = document.getElementById('lvl'), fill = document.getElementById('xpFill'), box = document.getElementById('xp');
    if (!me || !lvl) return;
    const r = me.rank;
    lvl.parentElement.firstChild.textContent = r.icon + ' ';
    lvl.textContent = r.name;
    fill.style.width = Math.round(r.progress * 100) + '%';
    if (box) box.title = `${me.xp} XP · ${me.credits} Credits${r.next ? ` · noch ${r.next.xp - me.xp} XP bis ${r.next.name}` : ' · höchster Rang'}`;
  }
  async function reward(rw) {
    if (!rw || !me) return;
    me.xp += rw.xp; me.credits += rw.xp;
    try { const d = await api('/api/auth/me'); if (d.user) me = d.user; } catch { /* egal */ }
    paintXp();
    if (rw.rank_up) { toast(`${rw.rank_up.icon} BEFÖRDERUNG: ${rw.rank_up.name}!`, 'lvl'); NX.sfx && NX.sfx.lvl(); NX.confetti && NX.confetti(); }
    (rw.badges || []).forEach((b) => toast(`${b.icon} Neues Abzeichen: ${b.name}`, 'lvl'));
  }
  async function tabRank(box) {
    add(box, el('p', { class: 'hint' }, 'Lade …'));
    let p, rk, lb;
    try { [p, rk, lb] = await Promise.all([api('/api/account/progress'), api('/api/ranks'), api('/api/leaderboard')]); } catch (e) { box.replaceChildren(el('p', { class: 'hint' }, e.message)); return; }
    const r = p.rank;
    box.replaceChildren(
      el('div', { class: 'rank-hero' }, el('div', { class: 'rank-ico' }, r.icon),
        el('div', {}, el('h3', {}, r.name), el('div', { class: 'hint' }, `${p.xp} XP · ${p.credits} Credits`),
          el('div', { class: 'meter' }, el('i', { style: `width:${Math.round(r.progress * 100)}%;background:linear-gradient(90deg,var(--cyan),var(--pink))` })),
          el('div', { class: 'hint' }, r.next ? `Noch ${r.next.xp - p.xp} XP bis ${r.next.name}` : 'Höchster Rang erreicht'))),
      el('h4', {}, 'Abzeichen'),
      el('div', { class: 'badge-grid' }, p.badges.map((b) => el('div', { class: 'badge' + (b.earned_at ? ' on' : ''), title: b.desc }, el('span', { class: 'bi' }, b.earned_at ? b.icon : '🔒'), el('b', {}, b.name), el('span', { class: 'hint' }, b.desc)))),
      el('h4', {}, 'So sammelst du XP'),
      el('ul', { class: 'rules' }, el('li', {}, 'Thread mit Inhalt: +10 (max. 5 pro Tag)'), el('li', {}, 'Sinnvoller Kommentar: +3 (max. 20 pro Tag, max. 5 pro Thread)'),
        el('li', {}, 'Reaktion von anderen Mitgliedern: +1 (nur von Konten, die älter als 1 Tag sind, max. 3 pro Person und Tag)'), el('li', {}, 'Tägliche Anmeldung: +5'),
        el('li', {}, 'Kein Gewinn durch Selbst-Reaktionen, Wiederholungen oder sehr kurze Texte. Das Team kann XP bei Missbrauch korrigieren.')),
      el('h4', {}, 'Ränge'),
      el('div', { class: 'ladder' }, rk.ranks.map((x, i) => el('span', { class: 'rung' + (i === r.index ? ' me' : '') + (i < r.index ? ' past' : '') }, x.icon + ' ' + x.name, el('small', {}, x.xp + ' XP')))),
      el('h4', {}, 'Bestenliste'),
      el('ol', { class: 'lb' }, lb.rows.slice(0, 10).map((x) => el('li', {}, el('span', {}, x.rank.icon + ' ' + x.username), el('span', { class: 'hint' }, x.xp + ' XP')))));
  }

  async function openSettings(tab = 'profil') {
    if (!me) return needLogin();
    try { accInfo = await api('/api/account'); me = accInfo.user; } catch { /* alte Daten nutzen */ }
    const tabs = [['profil', '👤 Profil', tabProfile], ['raenge', '🎖️ Ränge', tabRank], ['sicherheit', '🔐 Sicherheit', tabSecurity], ['einstellungen', '⚙️ Einstellungen', tabSettings], ['status', '🛡️ Konto-Status', tabStatus], ['daten', '📦 Daten', tabData]];
    const body = el('div', { class: 'set-body' });
    const bar = el('div', { class: 'set-tabs', role: 'tablist' });
    let m;
    const show = (key) => {
      [...bar.children].forEach((b) => b.setAttribute('aria-selected', String(b.dataset.k === key)));
      body.replaceChildren();
      const t = tabs.find((x) => x[0] === key);
      t[2](body, () => show(key));
      sessionStorage.setItem('nx_settab', key);
    };
    tabs.forEach(([k, l]) => bar.append(el('button', { class: 'set-tab', type: 'button', role: 'tab', 'data-k': k, onclick: () => show(k) }, l)));
    m = modal(`Konto von ${me.username}`, el('div', { class: 'settings' }, bar, body));
    show(tab);
  }

  // ------------------------------------------------------------------
  // Benutzermenü in der Kopfzeile
  // ------------------------------------------------------------------
  let menuEl = null;
  const closeMenu = () => { if (menuEl) { menuEl.remove(); menuEl = null; } };
  function renderUserArea() {
    const host = document.getElementById('userArea');
    if (!host) return;
    closeMenu();
    if (!me) {
      host.replaceChildren(
        el('a', { class: 'btn btn-ghost btn-sm', href: '/auth/?next=' + encodeURIComponent(location.pathname) + '#login' }, 'Anmelden'),
        el('a', { class: 'btn btn-primary btn-sm', href: '/auth/#register' }, 'Registrieren'));
      return;
    }
    const av = me.avatar ? el('img', { class: 'avatar av-img', src: me.avatar, alt: '', width: 28, height: 28 }) : NX.avatar(me.username, 28);
    const btn = el('button', { class: 'user-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Mein Konto' }, av, el('span', { class: 'user-name' }, me.username), el('span', { class: 'badge-n', id: 'dmBadge', hidden: true, title: 'Ungelesene Nachrichten' }),
      me.status !== 'normal' && el('span', { class: `st-dot st-${me.status}`, title: 'Konto-Status: ' + me.status_label }));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menuEl) return closeMenu();
      const item = (icon, label, fn, href) => (href ? el('a', { class: 'menu-item', role: 'menuitem', href }, icon, ' ', label) : el('button', { class: 'menu-item', type: 'button', role: 'menuitem', onclick: () => { closeMenu(); fn(); } }, icon, ' ', label));
      menuEl = el('div', { class: 'user-menu', role: 'menu' },
        el('div', { class: 'um-head' }, el('b', {}, me.username), me.role && el('span', { class: 'tag role-tag', vars: { '--rc': me.role.color } }, me.role.name),
          el('span', { class: `chip-st st-${me.status}` }, me.status_label)),
        item('👤', 'Profil & Name', () => openSettings('profil')),
        item('✉️', 'Nachrichten', () => NX.dm.open()),
        item('🎖️', `${me.rank.name} · ${me.xp} XP`, () => openSettings('raenge')),
        item('🔐', 'Sicherheit', () => openSettings('sicherheit')),
        item('⚙️', 'Einstellungen', () => openSettings('einstellungen')),
        item('🛡️', 'Konto-Status', () => openSettings('status')),
        item('🎮', 'Spiele & Credits', null, '/spiele/'),
        item('🛟', 'Support', null, '/support/'),
        me.team && item('🛠️', 'Admin-Bereich', null, '/admin/'),
        el('div', { class: 'um-sep' }),
        item('🚪', 'Abmelden', async () => { try { await api('/api/auth/logout', { method: 'POST', json: {} }); } catch { /* egal */ } location.href = '/'; }));
      btn.setAttribute('aria-expanded', 'true');
      host.append(menuEl);
      const first = menuEl.querySelector('.menu-item'); if (first) first.focus();
    });
    host.replaceChildren(btn);
    if (location.hash === '#konto') { history.replaceState(null, '', location.pathname + location.search); openSettings('profil'); }
    paintXp(); if (NX.dm) NX.dm.paintBadge();
  }
  document.addEventListener('click', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  // Erinnerung an Zwei-Faktor (alle 12 Anmeldungen, nur einmal je Sitzung, freiwillig)
  function maybeRemind() {
    if (!me || !me.remind_2fa || sessionStorage.getItem('nx_reminded')) return;
    sessionStorage.setItem('nx_reminded', '1');
    const m = modal('🔐 Schütze dein Konto', el('div', { style: 'display:grid;gap:12px' },
      el('p', {}, 'Du hast dich schon ' + me.login_count + ' Mal angemeldet. Mit Zwei-Faktor (Authenticator-App) kann niemand dein Konto übernehmen, selbst wenn dein Passwort bekannt wird. Das ist freiwillig.'),
      el('div', { class: 'row' }, el('button', { class: 'btn btn-primary', type: 'button', onclick: () => { m.close(); openSettings('sicherheit'); } }, 'Jetzt einrichten'),
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Später'))));
  }

  // Hinweisbalken oben (Gast, Status, Wartung)
  function banner() {
    const host = document.getElementById('notice');
    if (!host) return;
    host.replaceChildren();
    const add = (cls, ...kids) => { host.append(el('div', { class: 'notice ' + cls }, ...kids)); host.hidden = false; };
    host.hidden = true;
    if (NX.cfg().maintenance) add('warn', '🛠️ Wartungsmodus ist aktiv – Besucher sehen die Wartungsseite, du als Team arbeitest normal weiter.');
    if (!me) add('info', '👀 Du liest als Gast. ', el('a', { href: '/auth/#register' }, 'Registrieren'), ' oder ', el('a', { href: '/auth/?next=' + encodeURIComponent(location.pathname) + '#login' }, 'anmelden'), ', um mitzuschreiben.');
    else if (me.status === 'gebannt') add('bad', '⛔ Dein Konto ist gebannt. ', me.status_note || '', ' ', el('button', { class: 'linklike', type: 'button', onclick: () => openSettings('status') }, 'Details'));
    else if (me.timeout) add('warn', `⏳ ${me.timeout.mode === 'hidden' ? 'Forum ausgeblendet' : 'Schreiben gesperrt'} bis ${fmtDate(me.timeout.until)}${me.timeout.reason ? ' – ' + me.timeout.reason : ''}`);
    else if (me.status === 'untersuchung') add('warn', '🔎 Dein Konto wird geprüft: neue Threads und Uploads sind vorübergehend pausiert. ', el('button', { class: 'linklike', type: 'button', onclick: () => openSettings('status') }, 'Details'));
    else if (me.status === 'verdacht') add('info', '👁️ Dein Konto steht unter Beobachtung. ', el('button', { class: 'linklike', type: 'button', onclick: () => openSettings('status') }, 'Details'));
  }

  // Darf der Nutzer gerade schreiben? → null oder Hinweistext
  function writeBlock(kind) {
    if (!me) return 'login';
    if (me.status === 'gebannt') return 'Dein Konto ist gebannt.';
    if (me.timeout) return `Du bist bis ${fmtDate(me.timeout.until)} gesperrt.`;
    if (kind === 'thread' && me.status === 'untersuchung') return 'Dein Konto wird geprüft – neue Threads sind pausiert.';
    return null;
  }

  return { get me() { return me; }, paintXp, reward, load, apply, openSettings, renderUserArea, needLogin, whoBadge, maybeRemind, banner, writeBlock };
};
