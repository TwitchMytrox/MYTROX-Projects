/* turkac.org – Admin: Übersicht, Inhalte (Threads, Kommentare, Meldungen, Medien, Kategorien, Wortfilter), IP-Sperren */
(() => {
  'use strict';
  const { el, sv, fmt, fmtSize, short, api, j, toast, guard, modal, confirmBox, pager, table, nw, empty, field, head, reload, VIEWS, can, authorCell, setBadge } = window.NX;

  // ---------- Dashboard ----------
  function barChart(series) {
    const W = 700, H = 230, pad = { l: 34, r: 8, t: 10, b: 26 };
    const max = Math.max(4, ...series.flatMap((s) => [s.threads, s.comments]));
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, gw = iw / series.length;
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Aktivität der letzten 14 Tage: Threads und Kommentare pro Tag' });
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ih * (1 - i / 4);
      svg.append(sv('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: 'grid-line' }), sv('text', { x: pad.l - 6, y: y + 4, 'text-anchor': 'end' }, Math.round((max * i) / 4)));
    }
    series.forEach((s, i) => {
      const x = pad.l + gw * i; const bw = gw * 0.34;
      [['threads', '#00f0ff', 0.12], ['comments', '#ff2bd6', 0.48]].forEach(([k, c, off]) => {
        const h = Math.max(s[k] ? 2 : 0, (ih * s[k]) / max);
        svg.append(sv('rect', { x: x + gw * off, y: pad.t + ih - h, width: bw, height: h, rx: 3, fill: c }, sv('title', {}, `${s.day}: ${s[k]} ${k === 'threads' ? 'Threads' : 'Kommentare'}`)));
      });
      if (i % 2 === 0 || series.length < 9) svg.append(sv('text', { x: x + gw / 2, y: H - 8, 'text-anchor': 'middle' }, s.day));
    });
    return svg;
  }

  VIEWS.dash = async () => {
    const s = await api('/api/admin/stats');
    if (can('reports.handle')) setBadge(s.open_reports);
    const kpis = [
      ['Mitglieder', s.members || 0, '#b6ff3b', `+${s.today_members || 0} heute`],
      ['Threads', s.threads, '#00f0ff', `+${s.today_threads} heute`], ['Kommentare', s.comments, '#ff2bd6', `+${s.today_comments} heute`],
      ['Dateien', s.files, '#8a5cff', fmtSize(s.storage)], ['Reaktionen', s.reactions, '#7aa2ff', ''],
      ['Offene Meldungen', s.open_reports, s.open_reports ? '#ff4d6d' : '#8b91bb', s.open_reports ? 'Bitte prüfen' : 'Alles ruhig'],
      ['Aktive IP-Sperren', s.active_bans, '#ffb800', ''], ['Gelöschte Inhalte', s.deleted, '#8b91bb', 'wiederherstellbar'],
    ];
    const grid = el('div', { class: 'grid cols-4' }, kpis.map(([l, v, c, sub], i) => el('div', { class: 'kpi', vars: { '--c': c, '--i': i } }, el('b', {}, v.toLocaleString('de-DE')), el('span', {}, l), sub && el('em', {}, sub))));
    const maxC = Math.max(1, ...s.categories.map((c) => c.n));
    const bars = el('div', {}, s.categories.map((c) => el('div', { class: 'hbar' }, el('span', {}, c.name), el('div', { class: 'track' }, el('i', { style: `color:${c.color};background:${c.color}`, 'data-w': (c.n / maxC) * 100 })), el('b', {}, c.n))));
    requestAnimationFrame(() => setTimeout(() => bars.querySelectorAll('i').forEach((i) => (i.style.width = i.dataset.w + '%')), 60));
    return [head('Übersicht', 'Dashboard'), grid,
      el('div', { class: 'grid cols-2', style: 'margin-top:14px' },
        el('div', { class: 'panel' }, el('h3', {}, 'Aktivität – letzte 14 Tage'), barChart(s.series),
          el('div', { class: 'legend' }, el('span', {}, el('i', { style: 'background:#00f0ff' }), 'Threads'), el('span', {}, el('i', { style: 'background:#ff2bd6' }), 'Kommentare'))),
        el('div', { class: 'panel' }, el('h3', {}, 'Threads je Kategorie'), bars))];
  };

  // ---------- IP-Sperr-Dialog ----------
  function banDialog(type, id) {
    const reason = el('input', { type: 'text', maxlength: '200', placeholder: 'Grund (wird dem Nutzer angezeigt)' });
    const dur = el('select', {}, [['1', '1 Stunde'], ['24', '24 Stunden'], ['168', '7 Tage'], ['720', '30 Tage'], ['0', 'Dauerhaft']].map(([v, l]) => el('option', { value: v }, l)));
    const go = el('button', { class: 'btn danger', type: 'button' }, 'Sperren');
    const m = modal('Netzwerk des Autors sperren', el('div', { class: 'stack' },
      el('p', {}, 'Die Sperre gilt für das Netzwerk (gesalzener IP-Hash, nie die echte IP) hinter diesem Beitrag. Für Konten nutze besser Timeout oder Konto-Stufe in der Nutzer-Ansicht.'),
      field('Grund', reason), field('Dauer', dur),
      el('div', { class: 'modal-actions' }, el('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Abbrechen'), go)));
    go.onclick = guard(async () => { await j('POST', '/api/admin/bans', { type, id, reason: reason.value, hours: Number(dur.value) }); m.close(); toast('Netzwerk gesperrt'); });
  }

  // ---------- Threads ----------
  const listState = { threads: { q: '', status: 'all', page: 1 }, comments: { q: '', status: 'all', page: 1 } };
  const searchBox = (st, ph) => {
    const search = el('input', { type: 'search', placeholder: ph, value: st.q, 'aria-label': ph });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { st.q = search.value.trim(); st.page = 1; reload(); } });
    return search;
  };

  VIEWS.threads = async () => {
    const st = listState.threads;
    const qs = new URLSearchParams({ q: st.q, status: st.status, page: st.page });
    const [d, catsRes] = await Promise.all([api('/api/admin/threads?' + qs), can('categories.manage') ? api('/api/admin/categories').catch(() => null) : null]);
    const search = searchBox(st, 'Threads durchsuchen…');
    const sel = el('select', { 'aria-label': 'Status filtern' }, [['all', 'Alle'], ['active', 'Aktiv'], ['pinned', 'Angepinnt'], ['locked', 'Gesperrt'], ['deleted', 'Gelöscht']].map(([v, l]) => el('option', { value: v, selected: v === st.status }, l)));
    sel.onchange = () => { st.status = sel.value; st.page = 1; reload(); };
    const patch = (id, body, msg) => guard(async () => { await j('PATCH', '/api/admin/threads/' + id, body); toast(msg); reload(); });
    const rows = d.rows.map((t) => ({
      __row: t,
      cells: [
        el('span', { class: 'muted' }, '#' + t.id),
        el('div', {}, el('a', { class: 'ttl', href: '/#/t/' + t.id, target: '_blank', rel: 'noopener', title: t.title }, t.title), el('span', { class: 'sub' }, short(t.body.replace(/\n/g, ' '), 90) || '—'),
          el('div', {}, t.pinned ? el('span', { class: 'pill warn' }, 'Pin') : null, t.locked ? el('span', { class: 'pill red' }, 'Gesperrt') : null, t.deleted ? el('span', { class: 'pill red' }, 'Gelöscht') : null)),
        (() => {
          if (!catsRes) return t.cat_name || '—';
          const s = el('select', { class: 'sm', 'aria-label': 'Kategorie von ' + t.title }, catsRes.rows.map((c) => el('option', { value: c.id, selected: c.id === t.category_id }, `${c.icon} ${c.name}`)));
          s.onchange = () => patch(t.id, { category_id: Number(s.value) }, 'Kategorie geändert')(); return nw(s);
        })(),
        authorCell(t), nw(fmt(t.created_at)), nw(`💬 ${t.comments}  📎 ${t.files}  👁 ${t.views}`),
        nw(el('div', { class: 'acts' },
          el('button', { class: 'btn sm' + (t.pinned ? ' on' : ''), type: 'button', title: t.pinned ? 'Anpinnen aufheben' : 'Anpinnen', 'aria-label': t.pinned ? 'Anpinnen aufheben' : 'Anpinnen', 'aria-pressed': String(!!t.pinned), onclick: patch(t.id, { pinned: !t.pinned }, t.pinned ? 'Pin entfernt' : 'Angepinnt') }, '📌'),
          el('button', { class: 'btn sm' + (t.locked ? ' on-red' : ''), type: 'button', title: t.locked ? 'Entsperren' : 'Sperren', 'aria-label': t.locked ? 'Thread entsperren' : 'Thread sperren', 'aria-pressed': String(!!t.locked), onclick: patch(t.id, { locked: !t.locked }, t.locked ? 'Entsperrt' : 'Gesperrt') }, '🔒'),
          el('button', { class: 'btn sm', type: 'button', title: t.deleted ? 'Wiederherstellen' : 'Ausblenden', 'aria-label': t.deleted ? 'Wiederherstellen' : 'Ausblenden', onclick: patch(t.id, { deleted: !t.deleted }, t.deleted ? 'Wiederhergestellt' : 'Ausgeblendet') }, t.deleted ? '♻️' : '🙈'),
          can('bans.ip') && t.ip_hash !== 'system' && el('button', { class: 'btn sm danger', type: 'button', title: 'Netzwerk sperren', 'aria-label': 'Netzwerk des Autors sperren', onclick: () => banDialog('thread', t.id) }, '🚫'),
          el('button', { class: 'btn sm danger', type: 'button', title: 'Endgültig löschen (inkl. Dateien)', 'aria-label': 'Thread endgültig löschen', onclick: guard(async () => { if (await confirmBox('Thread endgültig löschen?', `„${short(t.title, 60)}“ wird samt Kommentaren und Dateien unwiderruflich entfernt.`, 'Endgültig löschen')) { await j('DELETE', '/api/admin/threads/' + t.id); toast('Thread gelöscht'); reload(); } }) }, '☠')))],
    }));
    return [head('Threads', `${d.total} Einträge`), el('div', { class: 'bar' }, search, sel, el('button', { class: 'btn', type: 'button', onclick: () => { st.q = search.value.trim(); st.page = 1; reload(); } }, 'Suchen')),
      rows.length ? table(['ID', 'Thread', 'Kategorie', 'Autor', 'Erstellt', 'Stats', 'Aktionen'], rows, (t) => (t.deleted ? 'is-deleted' : '')) : empty('Keine Threads gefunden.'),
      pager(st.page, d.pages, (p) => { st.page = p; reload(); })];
  };

  // ---------- Kommentare ----------
  VIEWS.comments = async () => {
    const st = listState.comments;
    const d = await api('/api/admin/comments?' + new URLSearchParams({ q: st.q, status: st.status, page: st.page }));
    const search = searchBox(st, 'Kommentare durchsuchen…');
    const sel = el('select', { 'aria-label': 'Status filtern' }, [['all', 'Alle'], ['active', 'Aktiv'], ['deleted', 'Gelöscht']].map(([v, l]) => el('option', { value: v, selected: v === st.status }, l)));
    sel.onchange = () => { st.status = sel.value; st.page = 1; reload(); };
    const rows = d.rows.map((c) => ({
      __row: c,
      cells: [el('span', { class: 'muted' }, '#' + c.id),
        el('div', {}, el('span', { class: 'ttl wrap' }, short(c.body || '(nur Datei)', 160)), el('a', { class: 'sub', href: '/#/t/' + c.thread_id, target: '_blank', rel: 'noopener' }, '↳ ' + short(c.thread_title, 60)), c.deleted ? el('span', { class: 'pill red' }, 'Gelöscht') : null),
        authorCell(c), nw(fmt(c.created_at)), nw(c.files ? `📎 ${c.files}` : '—'),
        nw(el('div', { class: 'acts' },
          el('button', { class: 'btn sm', type: 'button', title: c.deleted ? 'Wiederherstellen' : 'Ausblenden', 'aria-label': c.deleted ? 'Wiederherstellen' : 'Ausblenden', onclick: guard(async () => { await j('PATCH', '/api/admin/comments/' + c.id, { deleted: !c.deleted }); toast(c.deleted ? 'Wiederhergestellt' : 'Ausgeblendet'); reload(); }) }, c.deleted ? '♻️' : '🙈'),
          can('bans.ip') && el('button', { class: 'btn sm danger', type: 'button', title: 'Netzwerk sperren', 'aria-label': 'Netzwerk des Autors sperren', onclick: () => banDialog('comment', c.id) }, '🚫'),
          el('button', { class: 'btn sm danger', type: 'button', title: 'Endgültig löschen', 'aria-label': 'Kommentar endgültig löschen', onclick: guard(async () => { if (await confirmBox('Kommentar endgültig löschen?', 'Der Kommentar und seine Dateien werden unwiderruflich entfernt.', 'Endgültig löschen')) { await j('DELETE', '/api/admin/comments/' + c.id); toast('Kommentar gelöscht'); reload(); } }) }, '☠')))],
    }));
    return [head('Kommentare', `${d.total} Einträge`), el('div', { class: 'bar' }, search, sel), rows.length ? table(['ID', 'Inhalt', 'Autor', 'Erstellt', 'Dateien', 'Aktionen'], rows, (c) => (c.deleted ? 'is-deleted' : '')) : empty('Keine Kommentare gefunden.'), pager(st.page, d.pages, (p) => { st.page = p; reload(); })];
  };

  // ---------- Meldezentrum ----------
  let repStatus = 'open', repCat = '';
  const CAT_L = { spam: 'Spam', beleidigung: 'Beleidigung', hass: 'Hass', illegal: 'Illegal', jugendschutz: 'Jugendschutz', datenschutz: 'Private Daten', sonstiges: 'Sonstiges' };
  VIEWS.reports = async () => {
    const d = await api('/api/admin/reports?status=' + (repStatus === 'open' ? 'open' : 'resolved') + (repCat ? '&category=' + repCat : ''));
    if (repStatus === 'open' && !repCat) setBadge(d.rows.length);
    const sel = el('select', { 'aria-label': 'Status' }, [['open', 'Offen'], ['resolved', 'Erledigt']].map(([v, l]) => el('option', { value: v, selected: v === repStatus }, l)));
    sel.onchange = () => { repStatus = sel.value; reload(); };
    const csel = el('select', { 'aria-label': 'Kategorie' }, el('option', { value: '' }, 'Alle Kategorien'), d.categories.map((c) => el('option', { value: c, selected: c === repCat }, CAT_L[c] || c)));
    csel.onchange = () => { repCat = csel.value; reload(); };
    const cards = d.rows.map((r) => {
      const t = r.target;
      const act = (action, msg, note) => guard(async () => { await j('POST', `/api/admin/reports/${r.id}/resolve`, { action, note: note ? note() : '' }); toast(msg); reload(); });
      const note = el('input', { type: 'text', maxlength: '300', placeholder: 'Notiz zur Entscheidung (optional, wird protokolliert)', 'aria-label': 'Notiz' });
      return el('div', { class: 'panel report' + (r.urgent ? ' urgent' : '') },
        el('div', {}, r.urgent && el('span', { class: 'pill red' }, '⚠ Dringend'), ' ', el('span', { class: 'pill' }, r.target_type === 'thread' ? 'Thread' : 'Kommentar'), ` #${r.target_id} `,
          r.count > 1 && el('span', { class: 'pill warn' }, `${r.count}× gemeldet`), ' ',
          ...Object.entries(r.categories).map(([c, n]) => el('span', { class: 'pill' }, `${CAT_L[c] || c}${n > 1 ? ' ×' + n : ''}`)),
          r.status === 'working' && el('span', { class: 'pill warn' }, '🛠 ' + (r.handled_by || '') + ' bearbeitet'),
          el('span', { class: 'muted small' }, ' · ' + fmt(r.created_at)),
          t && el('a', { class: 'small', style: 'margin-left:8px', target: '_blank', rel: 'noopener', href: '/forum#/t/' + (r.target_type === 'thread' ? t.id : t.thread_id) }, '↗ ansehen')),
        t && el('div', { class: 'small' }, 'Autor: ', t.author || 'anonym', ' ', t.author && can('users.view') && t.user_id && el('button', { class: 'ulink', type: 'button', onclick: () => NX.openUser(t.user_id) }, '→ Konto öffnen')),
        el('details', { class: 'small' }, el('summary', {}, `Meldungen (${r.reports.length})`), ...r.reports.map((x) => el('div', {}, `${CAT_L[x.category] || x.category} · ${x.reporter || 'Gast'} · ${fmt(x.created_at)}${x.reason ? ' – ' + x.reason : ''}`))),
        t ? el('div', { class: 'quote' }, (t.title ? t.title + '\n' : '') + (t.body || '(nur Datei)')) : el('div', { class: 'muted' }, 'Inhalt existiert nicht mehr.'),
        repStatus === 'resolved' ? el('div', { class: 'small muted' }, `Entscheidung: ${{ dismiss: 'verworfen', delete: 'ausgeblendet', ban: 'ausgeblendet + gesperrt' }[r.outcome] || r.outcome} · von ${r.handled_by || '?'}${r.note ? ' – ' + r.note : ''}`) :
        [note, el('div', { class: 'acts' },
          el('button', { class: 'btn sm', type: 'button', onclick: guard(async () => { await j('POST', `/api/admin/reports/${r.id}/claim`, { release: r.status === 'working' }); reload(); }) }, r.status === 'working' ? '↩ Zurückgeben' : '🛠 Übernehmen'),
          el('button', { class: 'btn sm', type: 'button', onclick: act('dismiss', 'Meldung verworfen', () => note.value) }, '✔ Verwerfen'),
          el('button', { class: 'btn sm danger', type: 'button', onclick: act('delete', 'Inhalt ausgeblendet', () => note.value) }, 'Inhalt ausblenden'),
          can('bans.ip') && t && t.ip_hash !== 'system' && el('button', { class: 'btn sm danger', type: 'button', onclick: guard(async () => { if (await confirmBox('Ausblenden und Netzwerk sperren?', 'Der Inhalt wird ausgeblendet und das Netzwerk des Autors gesperrt.', 'Ausblenden + sperren')) await act('ban', 'Ausgeblendet und Autor gesperrt', () => note.value)(); }) }, 'Ausblenden + sperren'))]);
    });
    return [head('Meldezentrum', `${d.rows.length} ${repStatus === 'open' ? 'offen' : 'erledigt'}`), el('div', { class: 'bar' }, sel, csel), cards.length ? el('div', { class: 'cards' }, cards) : empty(repStatus === 'open' ? 'Keine offenen Meldungen.' : 'Noch nichts erledigt.')];
  };

  // ---------- Medien ----------
  let mediaPage = 1;
  VIEWS.media = async () => {
    const d = await api('/api/admin/media?page=' + mediaPage);
    const items = d.rows.map((m, i) => {
      const url = '/uploads/' + m.stored_name;
      const pv = m.kind === 'image' ? el('img', { src: url, loading: 'lazy', alt: m.original_name }) : m.kind === 'video' ? el('video', { src: url + '#t=0.1', preload: 'metadata', muted: true, 'aria-label': m.original_name }) : '📦';
      return el('div', { class: 'media', vars: { 'animation-delay': i * 30 + 'ms' } },
        el('a', { class: 'pv', href: url, target: '_blank', rel: 'noopener', 'aria-label': m.original_name + ' öffnen' }, pv),
        el('div', { class: 'info' }, el('b', { title: m.original_name }, m.original_name), el('span', { class: 'muted' }, `${fmtSize(m.size)} · ${fmt(m.created_at)}`),
          m.thread_title && el('a', { href: '/#/t/' + m.thread_id, target: '_blank', rel: 'noopener', class: 'small' }, '↳ ' + short(m.thread_title, 26)),
          el('div', { class: 'acts' }, el('button', { class: 'btn sm danger', type: 'button', onclick: guard(async () => { if (await confirmBox('Datei löschen?', `„${m.original_name}“ wird endgültig entfernt.`, 'Löschen')) { await j('DELETE', '/api/admin/media/' + m.id); toast('Datei gelöscht'); reload(); } }) }, 'Löschen'))));
    });
    return [head('Medien', `${d.total} Dateien`), items.length ? el('div', { class: 'media-grid' }, items) : empty('Noch keine Uploads.'), pager(mediaPage, d.pages, (p) => { mediaPage = p; reload(); })];
  };

  // ---------- IP-Sperren ----------
  VIEWS.bans = async () => {
    const d = await api('/api/admin/bans');
    const hash = el('input', { type: 'text', placeholder: '64 Zeichen – einfacher: über Threads/Kommentare sperren', maxlength: '64' });
    const reason = el('input', { type: 'text', placeholder: 'Grund', maxlength: '200' });
    const hours = el('input', { type: 'number', min: '0', value: '0' });
    const add = el('button', { class: 'btn primary', type: 'button', onclick: guard(async () => { await j('POST', '/api/admin/bans', { ip_hash: hash.value.trim(), reason: reason.value, hours: Number(hours.value) }); toast('Sperre angelegt'); reload(); }) }, 'Sperre hinzufügen');
    const rows = d.rows.map((b) => ({ __row: b, cells: [el('span', { class: 'hash' }, b.ip_hash.slice(0, 16) + '…'), b.reason || '—', nw(fmt(b.created_at)), nw(b.expires_at ? fmt(b.expires_at) : 'dauerhaft'), nw(el('span', { class: 'pill ' + (b.active ? 'red' : '') }, b.active ? 'aktiv' : 'abgelaufen')),
      nw(el('button', { class: 'btn sm', type: 'button', onclick: guard(async () => { if (await confirmBox('Sperre aufheben?', 'Das Netzwerk darf danach wieder schreiben.', 'Aufheben', false)) { await j('DELETE', '/api/admin/bans/' + b.id); toast('Sperre aufgehoben'); reload(); } }) }, 'Aufheben'))] }));
    return [head('IP-Sperren', `${d.rows.filter((b) => b.active).length} aktiv`),
      el('div', { class: 'panel', style: 'margin-bottom:14px' }, el('h3', {}, 'Manuelle Sperre'), el('div', { class: 'row' }, field('IP-Hash', hash, null, 'grow3'), field('Grund', reason, null, 'grow2'), field('Stunden (0 = dauerhaft)', hours, null, 'narrow'), add)),
      rows.length ? table(['Hash', 'Grund', 'Seit', 'Bis', 'Status', ''], rows) : empty('Keine Sperren.')];
  };

  // ---------- Wortfilter ----------
  VIEWS.words = async () => {
    const d = await api('/api/admin/words');
    const input = el('input', { type: 'text', placeholder: 'Wort oder Begriff, z. B. spam-link.xyz', maxlength: '40' });
    const add = guard(async () => { if (!input.value.trim()) return; await j('POST', '/api/admin/words', { word: input.value }); toast('Wort hinzugefügt'); reload(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    return [head('Wortfilter', 'wird in neuen Beiträgen durch ✱✱✱ ersetzt'),
      el('div', { class: 'panel', style: 'margin-bottom:14px' }, el('div', { class: 'row' }, field('Neues Wort', input), el('button', { class: 'btn primary', type: 'button', onclick: add }, 'Hinzufügen'))),
      d.rows.length ? el('div', { class: 'tags' }, d.rows.map((w) => el('span', { class: 'tag' }, w.word, el('button', { type: 'button', title: 'Entfernen', 'aria-label': `„${w.word}“ entfernen`, onclick: guard(async () => { await j('DELETE', '/api/admin/words/' + w.id); reload(); }) }, '✕')))) : empty('Noch keine Wörter gefiltert.')];
  };

  // ---------- Kategorien ----------
  VIEWS.cats = async () => {
    const d = await api('/api/admin/categories');
    const mk = (c) => {
      const f = { icon: el('input', { type: 'text', value: c.icon, maxlength: '8', style: 'width:64px;text-align:center', 'aria-label': 'Icon' }), name: el('input', { type: 'text', value: c.name, maxlength: '40', 'aria-label': 'Name' }), description: el('input', { type: 'text', value: c.description, maxlength: '120', 'aria-label': 'Beschreibung' }), color: el('input', { type: 'color', value: c.color, 'aria-label': 'Farbe' }), sort: el('input', { type: 'number', value: c.sort, style: 'width:70px', 'aria-label': 'Position' }) };
      return { __row: c, cells: [nw(f.icon), f.name, f.description, nw(f.color), nw(f.sort), nw(`${c.threads}`),
        nw(el('div', { class: 'acts' },
          el('button', { class: 'btn sm primary', type: 'button', onclick: guard(async () => { await j('PUT', '/api/admin/categories/' + c.id, { icon: f.icon.value, name: f.name.value, description: f.description.value, color: f.color.value, sort: Number(f.sort.value) }); toast('Gespeichert'); reload(); }) }, 'Speichern'),
          el('button', { class: 'btn sm danger', type: 'button', onclick: guard(async () => { if (await confirmBox('Kategorie löschen?', `„${c.name}“ wird entfernt. Das geht nur, wenn keine Threads mehr darin liegen.`, 'Löschen')) { await j('DELETE', '/api/admin/categories/' + c.id); toast('Kategorie gelöscht'); reload(); } }) }, 'Löschen')))] };
    };
    const n = { icon: el('input', { type: 'text', value: '🎮', maxlength: '8' }), name: el('input', { type: 'text', maxlength: '40', placeholder: 'Name' }), description: el('input', { type: 'text', maxlength: '120', placeholder: 'Kurzbeschreibung' }), color: el('input', { type: 'color', value: '#00f0ff' }) };
    const create = el('button', { class: 'btn primary', type: 'button', onclick: guard(async () => { await j('POST', '/api/admin/categories', { icon: n.icon.value, name: n.name.value, description: n.description.value, color: n.color.value, sort: d.rows.length }); toast('Kategorie angelegt'); reload(); }) }, 'Anlegen');
    return [head('Kategorien'),
      el('div', { class: 'panel', style: 'margin-bottom:14px' }, el('h3', {}, 'Neue Kategorie'), el('div', { class: 'row' }, field('Icon', n.icon, null, 'narrow'), field('Name', n.name), field('Beschreibung', n.description, null, 'grow2'), field('Farbe', n.color, null, 'narrow'), create)),
      table(['Icon', 'Name', 'Beschreibung', 'Farbe', 'Pos.', 'Threads', ''], d.rows.map(mk))];
  };
})();
