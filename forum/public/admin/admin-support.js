/* turkac.org – Admin: Support-Tickets und Blog/News/Werbung */
(() => {
  'use strict';
  const { el, fmt, short, api, j, toast, guard, modal, confirmBox, pager, table, nw, empty, field, head, reload, VIEWS, can } = window.NX;

  // ================= Tickets =================
  const F = { status: 'active', category: '', group: '', assignee: '', q: '', page: 1 };
  const PRIO = { low: 'niedrig', normal: 'normal', high: 'hoch', urgent: 'dringend' };
  const prioPill = (p) => el('span', { class: 'pill' + (p === 'urgent' ? ' red' : p === 'high' ? ' warn' : '') }, PRIO[p] || p);
  const statusPill = (t) => el('span', { class: 'pill' + (t.status === 'open' ? ' warn' : t.status === 'closed' || t.status === 'withdrawn' ? '' : ' ok') }, t.status_label);

  VIEWS.tickets = async () => {
    const qs = new URLSearchParams({ status: F.status, category: F.category, group: F.group, assignee: F.assignee, q: F.q, page: F.page });
    const d = await api('/api/admin/tickets?' + qs);
    const sel = (label, key, opts) => { const s = el('select', { 'aria-label': label }, opts.map(([v, l]) => el('option', { value: v, selected: v === F[key] }, l))); s.onchange = () => { F[key] = s.value; F.page = 1; reload(); }; return s; };
    const q = el('input', { type: 'search', placeholder: 'Suche: Betreff, Nr., Nutzer', 'aria-label': 'Suche', value: F.q });
    q.onkeydown = (e) => { if (e.key === 'Enter') { F.q = q.value; F.page = 1; reload(); } };
    const bar = el('div', { class: 'bar' },
      sel('Status', 'status', [['active', 'Aktiv (offen/in Arbeit/wartend)'], ['all', 'Alle'], ...Object.entries(d.statuses)]),
      sel('Kategorie', 'category', [['', 'Alle Kategorien'], ...d.categories.map((c) => [c.key, c.label])]),
      sel('Bereich', 'group', [['', 'Alle Bereiche'], ...Object.entries(d.groups)]),
      sel('Zuständig', 'assignee', [['', 'Alle'], ['me', 'Nur meine'], ['none', 'Nicht zugewiesen']]), q);
    const catL = Object.fromEntries(d.categories.map((c) => [c.key, c.label.split(' (')[0]]));
    const rows = d.rows.map((t) => ({ __row: t, cells: [
      el('button', { class: 'ulink', type: 'button', onclick: () => openTicket(t.id) }, t.id), el('span', {}, short(t.subject, 48)), nw(catL[t.category] || t.category), nw(t.user ? t.user.username : '—'),
      nw(statusPill(t)), nw(prioPill(t.priority)), nw(`${t.group_label}${t.assignee ? ' · ' + t.assignee.username : ''}`), nw(fmt(t.updated_at))] }));
    return [head('Support', `${d.total} Tickets · ${d.counts.open || 0} offen`), bar, rows.length ? table(['Nr.', 'Betreff', 'Kategorie', 'Nutzer', 'Status', 'Priorität', 'Zuständig', 'Aktualisiert'], rows) : empty('Keine Tickets für diesen Filter.'), pager(F.page, d.pages, (p) => { F.page = p; reload(); })];
  };

  async function openTicket(id) {
    const [d, st] = await Promise.all([api('/api/admin/tickets/' + id), api('/api/admin/tickets/staff')]);
    const t = d.ticket, holder = el('div', { class: 'stack' });
    const m = modal(`${t.id} – ${short(t.subject, 50)}`, holder, { wide: true });
    const refresh = () => { m.close(); openTicket(id); reload(); };
    const run = (fn, msg) => guard(async () => { await fn(); toast(msg); refresh(); });

    const msgs = el('div', { class: 'ticket-msgs', role: 'log', 'aria-label': 'Verlauf' }, d.messages.map((x) => el('div', { class: 'tmsg' + (x.internal ? ' internal' : x.staff ? ' staff' : ''), style: `border:1px solid var(--line,#333);border-radius:12px;padding:10px 14px;margin:8px 0;${x.internal ? 'border-style:dashed;' : ''}` },
      el('div', { class: 'small muted' }, `${x.internal ? '🔒 Interne Notiz · ' : x.staff ? 'Team · ' : ''}${x.from} · ${fmt(x.created_at)}`), el('div', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, x.body))));

    const body = el('textarea', { rows: '4', maxlength: '4000', 'aria-label': 'Antwort', style: 'width:100%' });
    const internal = el('input', { type: 'checkbox', id: 'tk-int' });
    const send = el('button', { class: 'btn primary', type: 'button', onclick: run(async () => { await j('POST', `/api/admin/tickets/${id}/reply`, { body: body.value, internal: internal.checked }); }, 'Gesendet') }, 'Senden');

    const stSel = el('select', { 'aria-label': 'Status' }, Object.entries(d.ticket.status === 'withdrawn' ? { withdrawn: 'Zurückgezogen' } : { open: 'Offen', in_progress: 'In Bearbeitung', pending: 'Wartet auf Nutzer', closed: 'Geschlossen' }).map(([v, l]) => el('option', { value: v, selected: v === t.status }, l)));
    const prSel = el('select', { 'aria-label': 'Priorität' }, Object.entries(PRIO).map(([v, l]) => el('option', { value: v, selected: v === t.priority }, l)));
    const subj = el('input', { type: 'text', value: t.subject, maxlength: '120', 'aria-label': 'Betreff' });
    const save = el('button', { class: 'btn', type: 'button', onclick: run(async () => { const b = { priority: prSel.value, subject: subj.value }; if (t.status !== 'withdrawn') b.status = stSel.value; await j('PATCH', '/api/admin/tickets/' + id, b); }, 'Gespeichert') }, 'Speichern');

    const who = el('select', { 'aria-label': 'An Teammitglied' }, el('option', { value: '' }, '— niemand / unverändert —'), st.staff.map((s) => el('option', { value: s.id, selected: t.assignee && t.assignee.id === s.id }, `${s.username} (${s.role})`)));
    const grp = el('select', { 'aria-label': 'Bereich' }, Object.entries({ support: 'Support', moderation: 'Moderation', admin: 'Administration' }).map(([v, l]) => el('option', { value: v, selected: v === t.team_group }, l)));
    const note = el('input', { type: 'text', maxlength: '300', placeholder: 'Hinweis für die nächste Person (optional)', 'aria-label': 'Hinweis' });
    const fwd = el('button', { class: 'btn', type: 'button', onclick: run(async () => { const b = { team_group: grp.value, note: note.value }; if (who.value) b.assignee_id = Number(who.value); await j('POST', `/api/admin/tickets/${id}/forward`, b); }, 'Weitergeleitet') }, '➡ Weiterleiten');
    const take = el('button', { class: 'btn sm', type: 'button', onclick: run(async () => { await j('POST', `/api/admin/tickets/${id}/forward`, { assignee_id: window.NX.state.me.user.id, team_group: t.team_group }); }, 'Übernommen') }, '🛠 Übernehmen');
    const closeB = el('button', { class: 'btn sm danger', type: 'button', onclick: run(async () => { await j('PATCH', '/api/admin/tickets/' + id, { status: 'closed' }); }, 'Ticket geschlossen') }, 'Schließen');

    holder.append(
      el('p', { class: 'small muted' }, `Von ${d.user ? d.user.username : 'gelöscht'}${d.user ? ` (Status: ${d.user.status}, seit ${fmt(d.user.member_since)})` : ''} · ${t.category} · erstellt ${fmt(t.created_at)} · `, statusPill(t), ' ', prioPill(t.priority), ' ', can('users.view') && d.user ? el('button', { class: 'ulink', type: 'button', onclick: () => window.NX.openUser && window.NX.openUser(d.user.id) }, '→ Konto öffnen') : ''),
      d.earlier.length ? el('details', { class: 'small' }, el('summary', {}, `Frühere Tickets (${d.earlier.length})`), d.earlier.map((e) => el('div', {}, el('button', { class: 'ulink', type: 'button', onclick: () => { m.close(); openTicket(e.pid); } }, e.pid), ' ', short(e.subject, 50), ' · ', e.status))) : '',
      msgs,
      el('div', { class: 'stack' }, el('label', { for: 'tk-body' }, 'Antwort'), (body.id = 'tk-body', body), el('label', { class: 'small', for: 'tk-int' }, internal, ' Nur interne Notiz (Nutzer sieht sie nicht)'), el('div', { class: 'acts' }, send, take, closeB)),
      el('details', { open: true }, el('summary', {}, 'Bearbeiten'), el('div', { class: 'row' }, field('Betreff', subj, null, 'grow2'), field('Status', stSel, null, 'narrow'), field('Priorität', prSel, null, 'narrow'), save)),
      el('details', {}, el('summary', {}, 'Weiterleiten'), el('div', { class: 'row' }, field('An Teammitglied', who, null, 'grow2'), field('Bereich', grp, null, 'narrow'), field('Hinweis', note, null, 'grow2'), fwd)));
  }


  // ================= Turniere =================
  let tFilter = 'todo';
  VIEWS.tournaments = async () => {
    const d = await api('/api/admin/tournaments?status=' + tFilter);
    const sel = el('select', { 'aria-label': 'Status' }, [['todo', 'Zu bearbeiten'], ['all', 'Alle'], ...Object.entries(d.statuses)].map(([v, l]) => el('option', { value: v, selected: v === tFilter }, l)));
    sel.onchange = () => { tFilter = sel.value; reload(); };
    const ask = async (title, label, cb) => { const note = el('input', { type: 'text', maxlength: '300', 'aria-label': label, placeholder: label }); const ok = el('button', { class: 'btn primary', type: 'button' }, 'Bestätigen'); const m = modal(title, el('div', { class: 'stack' }, note, el('div', { class: 'modal-actions' }, el('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Abbrechen'), ok))); ok.onclick = guard(async () => { await cb(note.value); m.close(); reload(); }); };
    const post = (t, path, body, msg) => guard(async () => { await j('POST', `/api/admin/tournaments/${t.id}/${path}`, body || {}); toast(msg); reload(); });
    const cards = d.rows.map((t) => {
      const mine = t.approved_by_id === d.me;
      return el('div', { class: 'panel' },
        el('div', {}, el('b', {}, t.title), ' ', el('span', { class: 'pill' }, t.status_label), ' ', el('span', { class: 'muted small' }, `${t.id} · ${t.game} · von ${t.organizer} · Start ${fmt(t.starts_at)} · ${t.count}/${t.max_players}`)),
        el('div', { class: 'small', style: 'white-space:pre-wrap' }, short(t.description, 400)), t.goals && el('div', { class: 'small muted' }, 'Ziele: ' + short(t.goals, 200)),
        t.ticket && el('div', { class: 'small muted' }, `Prüf-Ticket: ${t.ticket} (unter „Support“ Rückfragen stellen)`),
        t.status === 'proof' && el('div', { class: 'small' }, '🏆 Gemeldet: ' + (t.winners || []).map((w) => `${w.place}. ${w.username}`).join(' · '), ' · ', t.proof_url ? el('a', { href: t.proof_url, target: '_blank', rel: 'noopener noreferrer nofollow' }, 'Beweis-Link ↗') : '', t.proof_note && el('div', { class: 'quote' }, t.proof_note), el('div', { class: 'muted small' }, `Freigegeben von ${t.approved_by || '–'}${mine && t.cfg.four_eyes ? ' – das bist du: Auszahlung muss eine andere Person bestätigen' : ''}`)),
        el('div', { class: 'acts' },
          t.status === 'review' && [el('button', { class: 'btn sm primary', type: 'button', onclick: post(t, 'approve', {}, 'Freigegeben') }, '✔ Freigeben'), el('button', { class: 'btn sm danger', type: 'button', onclick: () => ask('Turnier ablehnen', 'Grund (der Veranstalter sieht ihn)', (note) => j('POST', `/api/admin/tournaments/${t.id}/reject`, { note })) }, 'Ablehnen')],
          t.status === 'proof' && [el('button', { class: 'btn sm primary', type: 'button', onclick: guard(async () => { if (await confirmBox('Auszahlung bestätigen?', 'Die Preise werden sofort ausgezahlt, Gebühr und Lostopf verbucht.', 'Auszahlen', false)) { await j('POST', `/api/admin/tournaments/${t.id}/confirm`, {}); toast('Ausgezahlt'); reload(); } }) }, '💰 Beweis ok – auszahlen'), el('button', { class: 'btn sm danger', type: 'button', onclick: () => ask('Beweis ablehnen', 'Grund', (note) => j('POST', `/api/admin/tournaments/${t.id}/deny-proof`, { note })) }, 'Beweis ablehnen')],
          ['review', 'open', 'running', 'proof'].includes(t.status) && el('button', { class: 'btn sm', type: 'button', onclick: () => ask('Turnier abbrechen', 'Grund – Einsatz geht zurück an den Veranstalter', (note) => j('POST', `/api/admin/tournaments/${t.id}/cancel`, { note })) }, 'Abbrechen + erstatten')));
    });
    return [head('Turniere', `${d.rows.length} Einträge`), el('div', { class: 'bar' }, sel), cards.length ? el('div', { class: 'cards' }, cards) : empty('Nichts zu tun.')];
  };

  // ================= Wirtschaft =================
  VIEWS.economy = async () => {
    const [e, t] = await Promise.all([api('/api/admin/economy'), api('/api/admin/tournaments?status=none')]);
    const n = (x) => Number(x).toLocaleString('de-DE');
    const cap = el('input', { type: 'number', min: '0', value: e.daily_cap }), lm = el('input', { type: 'number', min: '1', value: e.lottery_min });
    const earn = Object.fromEntries(Object.entries(e.earn).map(([k, v]) => [k, el('input', { type: 'number', min: '0', value: v })]));
    const L = { login: 'Anmeldung', thread: 'Thread', comment: 'Kommentar', reaction: 'Reaktion erhalten' };
    const save = el('button', { class: 'btn primary', type: 'button', onclick: guard(async () => { await j('PUT', '/api/admin/economy', { daily_cap: Number(cap.value), lottery_min: Number(lm.value), earn: Object.fromEntries(Object.entries(earn).map(([k, i]) => [k, Number(i.value)])) }); toast('Gespeichert'); reload(); }) }, 'Speichern');
    const c = t.config, tc = Object.fromEntries(['cost', 'fee', 'p1', 'p2', 'p3', 'lot'].map((k) => [k, el('input', { type: 'number', min: '0', value: c[k] })]));
    const fe = el('input', { type: 'checkbox', id: 'fe', checked: c.four_eyes });
    const tsave = el('button', { class: 'btn primary', type: 'button', onclick: guard(async () => { await j('PUT', '/api/admin/tournaments/config', { ...Object.fromEntries(Object.entries(tc).map(([k, i]) => [k, Number(i.value)])), four_eyes: fe.checked }); toast('Gespeichert'); reload(); }) }, 'Speichern');
    const draw = el('button', { class: 'btn', type: 'button', onclick: guard(async () => { if (await confirmBox('Lostopf jetzt ziehen?', 'Normalerweise zieht der Server sonntags ab 18 Uhr automatisch.', 'Ziehen', false)) { const r = await j('POST', '/api/admin/economy/draw', {}); toast(r.result ? `Gezogen: ${n(r.result.amount)} Credits` : 'Keine Lose diese Woche'); reload(); } }) }, '🎟️ Lostopf jetzt ziehen');
    return [head('Wirtschaft', 'Feste Gesamtmenge – nichts entsteht aus dem Nichts'),
      el('div', { class: 'panel' }, el('h3', {}, 'Bestand'), el('table', { class: 'table' }, el('tbody', {}, [['Gesamtmenge', e.total], ['Staatskonto', e.treasury], ['Im Umlauf (Mitglieder)', e.circulation], ['Lostopf', e.lottery_pot], ['In Treuhand (Turniere)', e.escrow]].map(([l, v]) => el('tr', {}, el('td', {}, l), el('td', { style: 'text-align:right' }, n(v))))))),
      el('div', { class: 'panel', style: 'margin-top:14px' }, el('h3', {}, 'Belohnungen'), el('div', { class: 'row' }, field('Tageslimit (Credits/Mitglied)', cap, null, 'narrow'), ...Object.entries(L).map(([k, l]) => field(l, earn[k], null, 'narrow')), field('Mindest-Los', lm, null, 'narrow'), save)),
      el('div', { class: 'panel', style: 'margin-top:14px' }, el('h3', {}, 'Turnier-Einsatz'), el('p', { class: 'small muted' }, 'Gebühr + Platz 1–3 + Lostopf müssen genau dem Einsatz entsprechen. Gebühr fließt ins Staatskonto.'), el('div', { class: 'row' }, field('Einsatz', tc.cost, null, 'narrow'), field('Gebühr', tc.fee, null, 'narrow'), field('Platz 1', tc.p1, null, 'narrow'), field('Platz 2', tc.p2, null, 'narrow'), field('Platz 3', tc.p3, null, 'narrow'), field('Lostopf', tc.lot, null, 'narrow')), el('label', { for: 'fe' }, fe, ' Vier-Augen-Prinzip: Auszahlung muss eine andere Person bestätigen als die Freigabe'), el('div', { class: 'acts' }, tsave, draw)),
      el('div', { class: 'panel', style: 'margin-top:14px' }, el('h3', {}, 'Letzte Buchungen'), e.recent.length ? table(['Zeit', 'Mitglied', 'Betrag', 'Art', 'Bezug'], e.recent.map((r) => ({ __row: r, cells: [nw(fmt(r.created_at)), r.username || '—', nw((r.delta > 0 ? '+' : '') + n(r.delta)), r.kind, short(r.ref, 30)] }))) : empty('Noch keine Buchungen.'))];
  };

  // ================= Spiele & Inaktivität =================
  VIEWS.games = async () => {
    const [g, ia] = await Promise.all([api('/api/admin/games'), api('/api/admin/inactivity')]);
    const c = g.config, n = (x) => Number(x).toLocaleString('de-DE'), I = ia.config;
    const num = (v, min = 0) => el('input', { type: 'number', min: String(min), value: v });
    const f = { fee: num(c.fee), bet_min: num(c.bet_min, 1), bet_max: num(c.bet_max, 1), bj_fee_pct: num(c.bj_fee_pct), bj_fee_min: num(c.bj_fee_min), loss_cap: num(c.loss_cap), prize_cap: num(c.prize_cap), min_rounds: num(c.min_rounds), bonus_cap: num(c.bonus_cap) };
    const lab = (i, t) => { i.setAttribute('aria-label', t); return i; };
    const pr = Object.fromEntries([['reaction', 'Reaktion'], ['memory', 'Memory'], ['snake', 'Snake']].map(([k, nm]) => [k, [lab(num(c.prizes[k][0]), nm + ': Preis bei sehr gutem Ergebnis'), lab(num(c.prizes[k][1]), nm + ': Preis bei gutem Ergebnis')]]));
    const bonus = el('input', { type: 'text', value: c.bonus.join(', '), 'aria-label': 'Wochenbonus Platz 1 bis 10, durch Komma getrennt' });
    const save = el('button', { class: 'btn primary', type: 'button', onclick: guard(async () => {
      await j('PUT', '/api/admin/games', { ...Object.fromEntries(Object.entries(f).map(([k, i]) => [k, Number(i.value)])), bonus: bonus.value.split(',').map((x) => Number(x.trim()) || 0), prizes: Object.fromEntries(Object.entries(pr).map(([k, a]) => [k, a.map((i) => Number(i.value))])) });
      toast('Gespeichert'); reload(); }) }, 'Spiele speichern');
    const on = el('input', { type: 'checkbox', id: 'ia-on', checked: I.on });
    const iv = { days: num(I.days, 1), pct: num(I.pct), cap: num(I.cap), vac_days: num(I.vac_days, 1), cooldown_days: num(I.cooldown_days) };
    const isave = el('button', { class: 'btn primary', type: 'button', onclick: guard(async () => { await j('PUT', '/api/admin/inactivity', { on: on.checked, ...Object.fromEntries(Object.entries(iv).map(([k, i]) => [k, Number(i.value)])) }); toast('Gespeichert'); reload(); }) }, 'Inaktivität speichern');
    const settle = el('button', { class: 'btn', type: 'button', onclick: guard(async () => { if (await confirmBox('Woche jetzt abschließen?', 'Zahlt den Wochenbonus an die Top 10 der aktuellen Woche. Normalerweise macht der Server das automatisch zum Wochenwechsel.', 'Abschließen', false)) { const r = await j('POST', '/api/admin/games/settle', {}); toast(`Woche ${r.week} abgeschlossen`); reload(); } }) }, '🏆 Woche jetzt abschließen');
    const sweep = el('button', { class: 'btn', type: 'button', onclick: guard(async () => { if (await confirmBox('Inaktivitätsgebühr jetzt prüfen?', 'Läuft sonst stündlich automatisch.', 'Prüfen', false)) { const r = await j('POST', '/api/admin/inactivity/sweep', {}); toast(`${n(r.taken)} Credits ans Staatskonto`); reload(); } }) }, 'Inaktivität jetzt prüfen');
    return [head('Spiele', 'Blackjack, Slots, Roulette, Reaktionstest, Memory, Snake – alles aus dem Staatskonto'),
      el('div', { class: 'panel' }, el('h3', {}, `Diese Woche (${g.week})`), el('p', {}, `${n(g.rounds_week)} Runden · ${n(g.players_week)} Spieler · Gewinn des Hauses: ${n(g.house_week)} Credits`),
        g.top10.length ? table(['Platz', 'Mitglied', 'Bonus', 'Woche'], g.top10.map((r) => ({ __row: r, cells: [nw('#' + r.place), nw(r.username || '–'), nw(n(r.bonus)), nw(r.week)] }))) : el('p', { class: 'small muted' }, 'Noch keine abgeschlossene Wertung.'), el('div', { class: 'bar' }, settle)),
      el('div', { class: 'panel', style: 'margin-top:14px' }, el('h3', {}, 'Gebühren, Limits, Preise'),
        el('div', { class: 'row' }, field('Eintritt Minigames', f.fee, null, 'narrow'), field('Einsatz min.', f.bet_min, null, 'narrow'), field('Einsatz max.', f.bet_max, null, 'narrow'), field('Blackjack-Gebühr %', f.bj_fee_pct, null, 'narrow'), field('Blackjack-Gebühr min.', f.bj_fee_min, null, 'narrow')),
        el('div', { class: 'row' }, field('Verlustlimit / 24 h', f.loss_cap, 'Netto-Verlust bei Glücksspielen', 'narrow'), field('Preise-Limit / 24 h', f.prize_cap, 'Minigame-Preise pro Mitglied', 'narrow'), field('Mindest-Runden für Top 10', f.min_rounds, null, 'narrow')),
        el('div', { class: 'row' }, field('Reaktion: Preis gut / okay', el('div', { class: 'row' }, pr.reaction), null, 'grow2'), field('Memory: Preis gut / okay', el('div', { class: 'row' }, pr.memory), null, 'grow2'), field('Snake: Preis gut / okay', el('div', { class: 'row' }, pr.snake), null, 'grow2')),
        el('div', { class: 'row' }, field('Wochenbonus Platz 1–10', bonus, 'Zehn Zahlen, durch Komma getrennt', 'grow3'), field('Bonus-Deckel / Woche', f.bonus_cap, null, 'narrow')), el('div', { class: 'bar' }, save)),
      el('div', { class: 'panel', style: 'margin-top:14px' }, el('h3', {}, 'Inaktivitätsgebühr & Pause'), el('label', { for: 'ia-on' }, on, ' Inaktivitätsgebühr aktiv'),
        el('div', { class: 'row' }, field('Stufe alle … Tage', iv.days, null, 'narrow'), field('% je Stufe (Stufe × %)', iv.pct, null, 'narrow'), field('höchstens % je Stufe', iv.cap, null, 'narrow'), field('Pause (Tage)', iv.vac_days, null, 'narrow'), field('Sperrfrist (Tage)', iv.cooldown_days, null, 'narrow')),
        el('p', { class: 'small muted' }, 'Beispiel: Stufe alle 5 Tage, 2 % → nach 5 Tagen 2 %, nach 10 Tagen 4 %, … (jeweils vom aktuellen Kontostand). Teammitglieder sind ausgenommen.'), el('div', { class: 'bar' }, isave, sweep))];
  };

  // ================= Blog / News / Werbung =================
  VIEWS.blog = async () => {
    const d = await api('/api/admin/blog');
    const rows = d.posts.map((p) => ({ __row: p, cells: [
      el('button', { class: 'ulink', type: 'button', onclick: () => editPost(p, d.kinds) }, short(p.title, 50)), nw(d.kinds[p.kind]), nw(el('span', { class: 'pill' + (p.published ? ' ok' : '') }, p.published ? 'Veröffentlicht' : 'Entwurf')), nw(p.pinned ? '📌' : ''), nw(p.author || '—'), nw(fmt(p.updated_at)),
      nw(p.published ? el('a', { href: '/blog/' + p.slug, target: '_blank', rel: 'noopener' }, 'Ansehen ↗') : '')] }));
    const add = el('button', { class: 'btn primary', type: 'button', onclick: () => editPost(null, d.kinds) }, '＋ Neuer Beitrag');
    return [head('Blog & Werbung', `${d.posts.filter((p) => p.published).length} veröffentlicht · öffentlich unter /blog`), el('div', { class: 'bar' }, add), rows.length ? table(['Titel', 'Art', 'Status', '', 'Autor', 'Geändert', ''], rows) : empty('Noch keine Beiträge.')];
  };

  function editPost(p, kinds) {
    p = p || { title: '', summary: '', body: '', kind: 'blog', cta_url: '', cta_text: '', published: false, pinned: false };
    const title = el('input', { type: 'text', maxlength: '140', value: p.title, required: true });
    const kind = el('select', { 'aria-label': 'Art' }, Object.entries(kinds).map(([v, l]) => el('option', { value: v, selected: v === p.kind }, l)));
    const summary = el('input', { type: 'text', maxlength: '300', value: p.summary });
    const body = el('textarea', { rows: '12', maxlength: '30000', style: 'width:100%' }, p.body);
    const cta = el('input', { type: 'text', maxlength: '300', value: p.cta_url, placeholder: 'https://…' });
    const ctaT = el('input', { type: 'text', maxlength: '60', value: p.cta_text, placeholder: 'Mehr erfahren' });
    const pub = el('input', { type: 'checkbox', id: 'bp-pub', checked: p.published });
    const pin = el('input', { type: 'checkbox', id: 'bp-pin', checked: p.pinned });
    const err = el('div', { class: 'err-msg', role: 'alert', hidden: true });
    const save = el('button', { class: 'btn primary', type: 'submit' }, 'Speichern');
    const f = el('form', { class: 'stack' }, err,
      el('div', { class: 'row' }, field('Titel', title, null, 'grow3'), field('Art', kind, null, 'narrow')),
      field('Kurztext (Vorschau auf der Blog-Seite)', summary), field('Text', body, 'Formatierung: ## Überschrift, - Liste, **fett**, [Text](https://…)'),
      el('div', { class: 'row' }, field('Button-Link (nur https://)', cta, null, 'grow2'), field('Button-Text', ctaT, null, 'grow2')),
      el('label', { for: 'bp-pub' }, pub, ' Veröffentlichen'), el('label', { for: 'bp-pin' }, pin, ' Oben anpinnen'),
      el('p', { class: 'small muted' }, 'Beiträge der Art „Anzeige“ werden öffentlich automatisch als Anzeige gekennzeichnet.'),
      el('div', { class: 'modal-actions' }, p.id && el('button', { class: 'btn danger', type: 'button', onclick: guard(async () => { if (await confirmBox('Beitrag löschen?', `„${p.title}“ wird endgültig entfernt.`, 'Löschen')) { await j('DELETE', '/api/admin/blog/' + p.id); m.close(); toast('Gelöscht'); reload(); } }) }, 'Löschen'), el('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Abbrechen'), save));
    const m = modal(p.id ? 'Beitrag bearbeiten' : 'Neuer Beitrag', f, { wide: true });
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); save.disabled = true; err.hidden = true;
      const b = { title: title.value, kind: kind.value, summary: summary.value, body: body.value, cta_url: cta.value, cta_text: ctaT.value, published: pub.checked, pinned: pin.checked };
      try { if (p.id) await j('PATCH', '/api/admin/blog/' + p.id, b); else await j('POST', '/api/admin/blog', b); m.close(); toast('Gespeichert'); reload(); }
      catch (ex) { if (ex instanceof window.NX.AuthError) return window.NX.route(); err.textContent = ex.message; err.hidden = false; save.disabled = false; }
    });
  }
})();
