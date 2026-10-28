/* turkac.org – Admin: Nutzer (Liste + Detail), Rollen, Namen-Liste */
(() => {
  'use strict';
  const NX = window.NX;
  const { el, fmt, fmtDate, short, api, j, toast, guard, modal, confirmBox, pager, table, nw, empty, field, head, reload, VIEWS, can, myLevel, statusChip, roleBadge, STATUS, state } = NX;

  const cancel = () => { const e = new Error('Abgebrochen'); e.silent = true; throw e; };
  const timeoutChip = (t) => (t ? el('span', { class: 'chip st-timeout', title: `bis ${fmt(t.until)}` }, (t.mode === 'hidden' ? '🙈 Timeout' : '⏳ Timeout') + ' bis ' + fmt(t.until)) : null);
  const searchInput = (st, ph) => {
    const s = el('input', { type: 'search', placeholder: ph, value: st.q, 'aria-label': ph });
    s.addEventListener('keydown', (e) => { if (e.key === 'Enter') { st.q = s.value.trim(); st.page = 1; reload(); } });
    return s;
  };
  const sel = (opts, cur, label, onch) => {
    const s = el('select', { 'aria-label': label }, opts.map(([v, l]) => el('option', { value: v, selected: v === cur }, l)));
    s.onchange = () => onch(s.value);
    return s;
  };

  // ======================================================================
  // Nutzer-Liste
  // ======================================================================
  const U = { q: '', status: '', role: '', timeout: false, page: 1 };
  VIEWS.users = async () => {
    const qs = new URLSearchParams({ q: U.q, status: U.status, role: U.role, page: U.page });
    if (U.timeout) qs.set('timeout', '1');
    const [d, rl] = await Promise.all([api('/api/admin/users?' + qs), api('/api/admin/roles').catch(() => ({ roles: [] }))]);
    const search = searchInput(U, 'Nutzer suchen…');
    const fStatus = sel([['', 'Alle Stufen'], ...Object.entries(STATUS).map(([k, v]) => [k, v[0]])], U.status, 'Konto-Stufe filtern', (v) => { U.status = v; U.page = 1; reload(); });
    const fRole = sel([['', 'Alle Rollen'], ['team', 'Nur Team'], ['none', 'Ohne Rolle'], ...rl.roles.map((r) => [r.key, r.name])], U.role, 'Rolle filtern', (v) => { U.role = v; U.page = 1; reload(); });
    const chk = el('input', { type: 'checkbox', checked: U.timeout });
    chk.onchange = () => { U.timeout = chk.checked; U.page = 1; reload(); };
    const rows = d.rows.map((u) => ({
      cells: [
        el('div', {}, el('button', { class: 'ulink', type: 'button', onclick: () => openUser(u.id) }, u.username), ' ', roleBadge(u.role)),
        statusChip(u.status), timeoutChip(u.timeout) || el('span', { class: 'muted' }, '—'),
        nw(`${u.threads} / ${u.comments}`), nw(u.warnings ? el('span', { class: 'pill warn' }, u.warnings) : '0'),
        nw(u.last_login ? fmt(u.last_login) : 'nie'), nw(u.totp_on ? el('span', { class: 'pill green' }, 'an') : el('span', { class: 'muted' }, 'aus')),
      ],
    }));
    return [head('Nutzer', `${d.total} Konten`),
      el('div', { class: 'bar' }, search, fStatus, fRole, el('label', { class: 'check' }, chk, 'nur Timeout'), el('button', { class: 'btn', type: 'button', onclick: () => { U.q = search.value.trim(); U.page = 1; reload(); } }, 'Suchen')),
      rows.length ? table(['Name', 'Konto-Stufe', 'Timeout', 'Threads / Komm.', 'Verwarn.', 'Letzter Login', '2FA'], rows) : empty('Keine Nutzer gefunden.'),
      pager(U.page, d.pages, (p) => { U.page = p; reload(); })];
  };

  // ======================================================================
  // Nutzer-Detail
  // ======================================================================
  const PRESETS = [['10 Min', 10], ['1 Std', 60], ['6 Std', 360], ['24 Std', 1440], ['7 Tage', 10080], ['30 Tage', 43200]];

  function openUser(id) {
    const holder = el('div', { class: 'stack' }, el('div', { class: 'boot' }, 'LADE', el('span', { class: 'dots' })));
    const m = modal('Nutzer', holder, { wide: true });
    const render = guard(async () => {
      const [d, rl] = await Promise.all([api('/api/admin/users/' + id), can('users.roles') ? api('/api/admin/roles') : null]);
      const u = d.user;
      m.setTitle(u.username);
      const self = state.me.user.id === u.id;
      const manageable = !self && (!u.role || u.role.level < myLevel());
      const act = (fn, msg) => guard(async () => { await fn(); if (msg) toast(msg); render(); reloadListSoon(); });
      const sec = (title, ...kids) => el('section', { class: 'sect' }, el('h3', {}, title), ...kids);

      const stats = el('div', { class: 'facts' },
        [['Threads', u.threads], ['Kommentare', u.comments], ['Verwarnungen', u.warnings], ['Logins', u.login_count], ['Sitzungen', u.sessions], ['Dabei seit', fmtDate(u.created_at)], ['Letzter Login', u.last_login ? fmt(u.last_login) : 'nie'], ['2FA', u.totp_on ? 'an' : 'aus'], ['E-Mail', u.has_email ? 'ja' : 'nein'], ['Wiederherst.-Codes', u.recovery_codes_left]]
          .map(([k, v]) => el('div', {}, el('b', {}, v), el('span', {}, k))));
      const kids = [
        el('div', { class: 'ud-head' }, u.avatar && el('img', { class: 'ava', src: u.avatar, alt: '' }), el('div', {}, el('div', {}, roleBadge(u.role), ' ', statusChip(u.status), ' ', timeoutChip(u.timeout), u.locked_until && el('span', { class: 'chip st-gebannt' }, 'Login-Sperre bis ' + fmt(u.locked_until))),
          u.status_note && el('p', { class: 'small muted' }, `Notiz zur Stufe: ${u.status_note}`), u.timeout && u.timeout_reason && el('p', { class: 'small muted' }, `Timeout-Grund: ${u.timeout_reason}`))),
        sec('Beschreibung', el('p', { class: 'bio' }, u.bio || '— keine —')), stats,
      ];
      if (self) kids.push(el('p', { class: 'note' }, 'Das bist du selbst – heikle Aktionen sind bei dir selbst gesperrt.'));
      else if (!manageable) kids.push(el('p', { class: 'note' }, 'Dieses Konto hat eine gleich hohe oder höhere Rolle als du – du kannst es nur ansehen.'));

      if (manageable) {
        // --- Konto-Stufe ---
        if (can('users.status') && (can('users.ban') || u.status !== 'gebannt')) {
          const opts = Object.entries(STATUS).filter(([k]) => k !== 'gebannt' || can('users.ban'));
          const s = el('select', { 'aria-label': 'Neue Konto-Stufe' }, opts.map(([k, v]) => el('option', { value: k, selected: k === u.status }, v[0])));
          const note = el('input', { type: 'text', maxlength: '300', placeholder: 'Notiz (optional)', value: u.status_note || '' });
          kids.push(sec('Konto-Stufe ändern',
            el('ul', { class: 'levels' }, Object.entries(STATUS).map(([k, v]) => el('li', {}, statusChip(k), ' ', v[1]))),
            el('div', { class: 'row' }, field('Stufe', s), field('Notiz', note, null, 'grow2'),
              el('button', { class: 'btn primary', type: 'button', onclick: act(async () => {
                if (s.value === 'gebannt' && !(await confirmBox('Konto bannen?', `${u.username} kann danach gar nichts mehr – nicht einmal lesen.`, 'Bannen'))) cancel();
                await j('PATCH', `/api/admin/users/${id}/status`, { status: s.value, note: note.value });
              }, 'Konto-Stufe gespeichert') }, 'Speichern'))));
        }
        // --- Timeout ---
        if (can('users.timeout')) {
          const mins = el('input', { type: 'number', min: '1', max: '525600', placeholder: 'Minuten' });
          const mode = el('select', { 'aria-label': 'Timeout-Art' }, el('option', { value: 'write' }, 'Schreiben gesperrt'), el('option', { value: 'hidden' }, 'Seite unsichtbar'));
          const reason = el('input', { type: 'text', maxlength: '200', placeholder: 'Grund (optional)' });
          kids.push(sec('Timeout',
            u.timeout && el('div', { class: 'bar' }, timeoutChip(u.timeout), el('button', { class: 'btn sm danger', type: 'button', onclick: act(() => j('DELETE', `/api/admin/users/${id}/timeout`), 'Timeout beendet') }, 'Timeout beenden')),
            el('div', { class: 'acts' }, PRESETS.map(([l, v]) => el('button', { class: 'btn sm', type: 'button', onclick: () => { mins.value = v; } }, l))),
            el('div', { class: 'row', style: 'margin-top:10px' }, field('Dauer (Minuten)', mins), field('Art', mode, null, 'w190'), field('Grund', reason, null, 'grow2'),
              el('button', { class: 'btn primary', type: 'button', onclick: act(async () => {
                if (!(Number(mins.value) >= 1)) throw new Error('Bitte eine Dauer wählen oder Minuten eintragen');
                await j('POST', `/api/admin/users/${id}/timeout`, { minutes: Number(mins.value), mode: mode.value, reason: reason.value });
              }, 'Timeout gesetzt') }, 'Timeout setzen'))));
        }
        // --- Verwarnen ---
        if (can('users.warn')) {
          const reason = el('input', { type: 'text', maxlength: '300', placeholder: 'Grund der Verwarnung' });
          kids.push(sec('Verwarnen', el('p', { class: 'small muted' }, 'Bei 3 Verwarnungen springt ein normales Konto automatisch auf „Verdacht“.'),
            el('div', { class: 'row' }, field('Grund', reason, null, 'grow2'), el('button', { class: 'btn primary', type: 'button', onclick: act(async () => {
              const r = await j('POST', `/api/admin/users/${id}/warn`, { reason: reason.value });
              if (r.escalated) toast('Automatisch auf „Verdacht“ gesetzt (3 Verwarnungen)');
            }, 'Verwarnung eingetragen') }, 'Verwarnen'))));
        }
        // --- Rolle ---
        if (can('users.roles') && rl) {
          const choices = rl.roles.filter((r) => r.key !== 'owner' && r.level < rl.my_level);
          const s = el('select', { 'aria-label': 'Rolle' }, el('option', { value: '' }, '— keine Rolle —'), choices.map((r) => el('option', { value: r.id, selected: u.role && u.role.id === r.id }, `${r.name} (Stufe ${r.level})`)));
          kids.push(sec('Rolle', el('p', { class: 'small muted' }, 'Du kannst nur Rollen unterhalb deiner eigenen Stufe vergeben. Team-Rollen (mit Admin-Zugang) erzwingen E-Mail und Zwei-Faktor – die Person richtet das beim nächsten Login ein.'),
            el('div', { class: 'row' }, field('Rolle', s), el('button', { class: 'btn primary', type: 'button', onclick: act(async () => {
              const r = await j('POST', `/api/admin/users/${id}/role`, { role_id: s.value ? Number(s.value) : null });
              if (r.setup_required) toast('Hinweis: Das Konto muss noch E-Mail und Zwei-Faktor einrichten.');
            }, 'Rolle gespeichert') }, 'Speichern'))));
        }
        // --- Sonstiges ---
        if (can('users.status')) {
          kids.push(sec('Weitere Aktionen', el('div', { class: 'acts' },
            el('button', { class: 'btn', type: 'button', onclick: act(async () => { if (await confirmBox('Sitzungen beenden?', `${u.username} wird überall abgemeldet; eine Login-Sperre wird aufgehoben.`, 'Beenden', false)) await j('POST', `/api/admin/users/${id}/reset-sessions`); else cancel(); }, 'Sitzungen beendet') }, 'Sitzungen beenden / Login-Sperre aufheben'),
            el('button', { class: 'btn danger', type: 'button', onclick: act(async () => { if (await confirmBox('Profil zurücksetzen?', 'Profilbild und Beschreibung werden entfernt.', 'Zurücksetzen')) await j('POST', `/api/admin/users/${id}/clear-profile`); else cancel(); }, 'Profil zurückgesetzt') }, 'Profil zurücksetzen'))));
        }
      }
      // --- Verwarnungen ---
      kids.push(sec(`Verwarnungen (${d.warnings_list.length})`, d.warnings_list.length ? el('ul', { class: 'list' }, d.warnings_list.map((w) => el('li', {},
        el('div', {}, el('b', {}, w.reason), el('div', { class: 'small muted' }, `${w.by_name} · ${fmt(w.created_at)}`)),
        can('users.status') && el('button', { class: 'btn sm danger', type: 'button', onclick: act(async () => { if (await confirmBox('Verwarnung löschen?', short(w.reason, 100), 'Löschen')) await j('DELETE', '/api/admin/warnings/' + w.id); else cancel(); }, 'Verwarnung gelöscht') }, 'Löschen')))) : el('p', { class: 'muted' }, 'Keine.')));
      kids.push(sec('Bisherige Namen', d.names.length ? el('div', { class: 'tags' }, d.names.map((n) => el('span', { class: 'pill' + (n.kind === 'reserved' ? ' warn' : '') }, n.name))) : el('p', { class: 'muted' }, '—')));
      kids.push(sec('Letzte Beiträge', d.recent.length ? el('ul', { class: 'list' }, d.recent.map((r) => el('li', {},
        el('div', {}, el('span', { class: 'pill ' + (r.type === 'thread' ? '' : 'green') }, r.type === 'thread' ? 'Thread' : 'Kommentar'), ' ', short(r.text, 110), el('div', { class: 'small muted' }, fmt(r.created_at)))))) : el('p', { class: 'muted' }, 'Noch nichts.')));
      kids.push(el('div', { class: 'modal-actions' }, el('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Schließen')));
      holder.replaceChildren(...kids.filter(Boolean));
    });
    render();
  }
  let listTimer = 0;
  function reloadListSoon() { clearTimeout(listTimer); listTimer = setTimeout(() => { if (location.hash === '#users') reload(); }, 300); }
  NX.openUser = openUser;

  // ======================================================================
  // Rollen
  // ======================================================================
  VIEWS.roles = async () => {
    const d = await api('/api/admin/roles');
    const manage = can('roles.manage');
    const rows = d.roles.map((r) => ({
      cells: [
        el('b', { style: `color:${r.color}` }, r.name), nw(r.level), nw(r.users), r.system ? el('span', { class: 'pill' }, 'System') : '',
        el('span', { class: 'small muted' }, r.key === 'owner' ? 'alle Rechte' : `${r.permissions.length} Rechte`),
        nw(manage && r.key !== 'owner' && r.level < d.my_level ? el('div', { class: 'acts' },
          el('button', { class: 'btn sm', type: 'button', onclick: () => roleDialog(d, r) }, 'Bearbeiten'),
          !r.system && el('button', { class: 'btn sm danger', type: 'button', onclick: guard(async () => {
            if (r.users) return toast('Der Rolle sind noch Nutzer zugeordnet.', 'err');
            if (await confirmBox('Rolle löschen?', `Die Rolle „${r.name}“ wird entfernt.`, 'Löschen')) { await j('DELETE', '/api/admin/roles/' + r.id); toast('Rolle gelöscht'); reload(); }
          }) }, 'Löschen')) : ''),
      ],
    }));
    return [head('Rollen', null, manage && el('button', { class: 'btn primary', type: 'button', onclick: () => roleDialog(d, null) }, '+ Neue Rolle')),
      el('div', { class: 'panel', style: 'margin-bottom:14px' }, el('h3', {}, 'So funktionieren Stufen'),
        el('p', { class: 'small', style: 'margin:0' }, `Jede Rolle hat eine Stufe. Du (Stufe ${d.my_level}) kannst nur Nutzer verwalten und Rollen vergeben, die eine niedrigere Stufe haben als du – und nur Rechte weitergeben, die du selbst besitzt. Die Inhaber-Rolle ist fest.`)),
      table(['Rolle', 'Stufe', 'Nutzer', '', 'Rechte', ''], rows)];
  };

  function roleDialog(d, role) {
    const name = el('input', { type: 'text', maxlength: '30', required: true, value: role ? role.name : '' });
    const color = el('input', { type: 'color', value: role ? role.color : '#00f0ff' });
    const level = el('input', { type: 'number', min: '1', max: String(d.my_level - 1), value: role ? role.level : Math.max(1, Math.min(10, d.my_level - 1)) });
    const boxes = new Map();
    const groups = [...new Set(d.catalogue.map((p) => p.group))];
    const permBox = el('div', { class: 'perm-groups' }, groups.map((g) => el('fieldset', {}, el('legend', {}, g), d.catalogue.filter((p) => p.group === g).map((p) => {
      const mine = can(p.key);
      const cb = el('input', { type: 'checkbox', checked: !!(role && role.permissions.includes(p.key)), disabled: !mine });
      boxes.set(p.key, cb);
      return el('label', { class: 'check perm' + (mine ? '' : ' off'), title: mine ? '' : 'Dieses Recht hast du selbst nicht' }, cb, p.label);
    }))));
    const err = el('div', { class: 'err-msg', role: 'alert', hidden: true });
    const save = el('button', { class: 'btn primary', type: 'submit' }, 'Speichern');
    const f = el('form', { class: 'stack' }, err,
      el('div', { class: 'row' }, field('Name', name, null, 'grow2'), field('Farbe', color, null, 'narrow'), field(`Stufe (1–${d.my_level - 1})`, level, null, 'narrow')),
      el('p', { class: 'small muted' }, 'Rechte, die du selbst nicht hast, sind ausgegraut und können nicht vergeben werden.'), permBox,
      el('div', { class: 'modal-actions' }, el('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Abbrechen'), save));
    const m = modal(role ? `Rolle bearbeiten: ${role.name}` : 'Neue Rolle', f, { wide: true });
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); save.disabled = true; err.hidden = true;
      const body = { name: name.value.trim(), color: color.value, level: Number(level.value), permissions: [...boxes].filter(([, c]) => c.checked).map(([k]) => k) };
      try { if (role) await j('PUT', '/api/admin/roles/' + role.id, body); else await j('POST', '/api/admin/roles', body); m.close(); toast('Rolle gespeichert'); reload(); }
      catch (ex) { if (ex instanceof NX.AuthError) return NX.route(); err.textContent = ex.message; err.hidden = false; save.disabled = false; }
    });
  }

  // ======================================================================
  // Namen-Liste
  // ======================================================================
  const N = { q: '', kind: '', page: 1 };
  VIEWS.names = async () => {
    const qs = new URLSearchParams({ q: N.q, kind: N.kind, page: N.page });
    const d = await api('/api/admin/names?' + qs);
    const search = searchInput(N, 'Namen suchen…');
    const fKind = sel([['', 'Alle'], ['reserved', 'Reserviert'], ['registered', 'Registriert']], N.kind, 'Art filtern', (v) => { N.kind = v; N.page = 1; reload(); });
    const rows = d.rows.map((n) => ({
      cells: [el('b', {}, n.name), n.kind === 'reserved' ? el('span', { class: 'pill warn' }, 'reserviert') : el('span', { class: 'pill' }, 'registriert'),
        n.user_id && can('users.view') ? el('button', { class: 'ulink', type: 'button', onclick: () => openUser(n.user_id) }, n.owner_name || '—') : (n.owner_name || '—'),
        n.in_use ? el('span', { class: 'chip st-normal' }, 'in Benutzung') : el('span', { class: 'muted' }, n.owner_deleted ? 'Konto gelöscht' : 'frei'),
        nw(fmtDate(n.created_at)),
        nw(el('button', { class: 'btn sm danger', type: 'button', onclick: guard(async () => {
          if (await confirmBox('Namen freigeben?', `„${n.name}“ kann danach wieder von jedem registriert werden.`, 'Freigeben')) {
            try { await j('DELETE', '/api/admin/names/' + encodeURIComponent(n.name_lc)); toast('Name freigegeben'); reload(); } catch (e) { if (e.status === 409) toast(e.message, 'err'); else throw e; }
          }
        }) }, 'Freigeben'))],
    }));
    return [head('Namen-Liste', `${d.total} Namen`, el('button', { class: 'btn primary', type: 'button', onclick: reserveDialog }, '+ Namen reservieren')),
      el('div', { class: 'bar' }, search, fKind, el('button', { class: 'btn', type: 'button', onclick: () => { N.q = search.value.trim(); N.page = 1; reload(); } }, 'Suchen')),
      rows.length ? table(['Name', 'Art', 'Gehört zu', 'Status', 'Datum', ''], rows) : empty('Keine Namen gefunden.'),
      pager(N.page, d.pages, (p) => { N.page = p; reload(); })];
  };
  function reserveDialog() {
    const name = el('input', { type: 'text', maxlength: '20', required: true, autocapitalize: 'none', spellcheck: 'false' });
    const err = el('div', { class: 'err-msg', role: 'alert', hidden: true });
    const f = el('form', { class: 'stack' }, err, field('Name', name, '3–20 Zeichen: Buchstaben, Zahlen, _ und -. Niemand kann sich dann mit diesem (oder einem sehr ähnlichen) Namen registrieren.'),
      el('div', { class: 'modal-actions' }, el('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Abbrechen'), el('button', { class: 'btn primary', type: 'submit' }, 'Reservieren')));
    const m = modal('Namen reservieren', f);
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      try { await j('POST', '/api/admin/names', { name: name.value.trim() }); m.close(); toast('Name reserviert'); reload(); } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
  }
})();
