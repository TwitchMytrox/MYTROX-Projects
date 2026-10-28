/* Turniere: Mitglieder mit genug Credits eröffnen ein Turnier. Ablauf mit Vier-Augen-Prinzip:
   Einreichen (Einsatz in Treuhand) → Support prüft/gibt frei → Anmeldung → Start → Veranstalter meldet Gewinner + Beweis → ein ANDERER Prüfer bestätigt → Auszahlung.
   Credits: Einsatz = Gebühr (Staatskonto) + Preise Platz 1–3 + Lostopf. Alles einstellbar (Summe muss dem Einsatz entsprechen). */
const crypto = require('node:crypto');

module.exports = function init(ctx, acc) {
  const { db, now, getSetting, setSetting, GET, POST, PATCH, PUT, send, fail, jsonBody, rl, audit, clean } = ctx;
  const { requireUser, requirePerm, postGate, readGate } = acc;
  const eco = ctx.eco;

  db.exec(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, pid TEXT UNIQUE NOT NULL, organizer_id INTEGER NOT NULL, title TEXT NOT NULL, game TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', goals TEXT NOT NULL DEFAULT '', starts_at INTEGER NOT NULL, max_players INTEGER NOT NULL DEFAULT 32,
      status TEXT NOT NULL DEFAULT 'review', cfg TEXT NOT NULL, ticket_pid TEXT, approved_by INTEGER, review_note TEXT NOT NULL DEFAULT '',
      winners TEXT, proof_url TEXT NOT NULL DEFAULT '', proof_note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_tour_status ON tournaments(status, starts_at);
    CREATE TABLE IF NOT EXISTS tournament_players (tournament_id INTEGER NOT NULL, user_id INTEGER NOT NULL, points INTEGER NOT NULL DEFAULT 0, joined_at INTEGER NOT NULL, PRIMARY KEY(tournament_id, user_id));
  `);

  const STATUS = { review: 'In Prüfung', open: 'Anmeldung offen', running: 'Läuft', proof: 'Ergebnis wird geprüft', finished: 'Beendet', rejected: 'Abgelehnt', cancelled: 'Abgebrochen' };
  const int = (k, d) => { const v = parseInt(getSetting(k, String(d)), 10); return Number.isFinite(v) ? v : d; };
  const cfg = () => ({ cost: int('t_cost', 5000), fee: int('t_fee', 1000), p1: int('t_p1', 1600), p2: int('t_p2', 800), p3: int('t_p3', 400), lot: int('t_lot', 1200), four_eyes: getSetting('t_four_eyes', '1') === '1' });
  const cfgOk = (c) => c.cost > 0 && [c.fee, c.p1, c.p2, c.p3, c.lot].every((n) => n >= 0) && c.fee + c.p1 + c.p2 + c.p3 + c.lot === c.cost;
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newPid = () => 'TN-' + Array.from({ length: 6 }, () => A[crypto.randomInt(32)]).join('');
  const byPid = (pid) => db.prepare('SELECT * FROM tournaments WHERE pid = ?').get(String(pid || ''));
  const players = (id) => db.prepare('SELECT p.user_id, p.points, u.username FROM tournament_players p JOIN users u ON u.id = p.user_id WHERE p.tournament_id = ? ORDER BY p.points DESC, p.joined_at').all(id);
  const name = (id) => (db.prepare('SELECT username FROM users WHERE id = ?').get(id) || {}).username || null;
  const safeUrl = (u) => { u = String(u || '').trim().slice(0, 300); return /^https:\/\//.test(u) ? u : ''; };

  const prizes = (t) => { const c = JSON.parse(t.cfg); return c; };
  const view = (t, user) => {
    const c = JSON.parse(t.cfg), pl = players(t.id);
    const isOrg = !!user && user.id === t.organizer_id;
    return { id: t.pid, title: t.title, game: t.game, description: t.description, goals: t.goals, starts_at: t.starts_at, max_players: t.max_players, status: t.status, status_label: STATUS[t.status],
      organizer: name(t.organizer_id), prize: { first: c.p1, second: c.p2, third: c.p3 }, players: pl.map((p, i) => ({ rank: i + 1, username: p.username, points: p.points, id: isOrg ? p.user_id : undefined })), count: pl.length,
      joined: !!user && pl.some((p) => p.user_id === user.id), is_organizer: isOrg, review_note: isOrg ? t.review_note : undefined,
      winners: t.winners ? JSON.parse(t.winners).map((w) => ({ place: w.place, username: name(w.user_id) })) : null, proof_url: t.status === 'finished' || isOrg ? t.proof_url : undefined, ticket: isOrg ? t.ticket_pid : undefined, updated_at: t.updated_at };
  };

  // ---- Öffentlich / Mitglieder ----
  GET('/api/tournaments', readGate, (req, res) => {
    const rows = db.prepare("SELECT * FROM tournaments WHERE status IN ('open','running','proof','finished') ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'open' THEN 1 WHEN 'proof' THEN 2 ELSE 3 END, starts_at DESC LIMIT 60").all().map((t) => view(t, req.user));
    const mine = req.user ? db.prepare("SELECT * FROM tournaments WHERE organizer_id = ? AND status IN ('review','rejected','cancelled') ORDER BY id DESC LIMIT 20").all(req.user.id).map((t) => view(t, req.user)) : [];
    const c = cfg();
    send(res, 200, { rows, mine, config: { cost: c.cost, fee: c.fee, prizes: [c.p1, c.p2, c.p3], lottery: c.lot }, credits: req.user ? db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id).credits : null, statuses: STATUS });
  });
  GET('/api/tournaments/:pid', readGate, (req, res) => {
    const t = byPid(req.params.pid);
    if (!t || (['review', 'rejected', 'cancelled'].includes(t.status) && !(req.user && req.user.id === t.organizer_id))) return fail(res, 404, 'Turnier nicht gefunden');
    send(res, 200, { tournament: view(t, req.user) });
  });

  POST('/api/tournaments', rl('tcreate', 60, 3600_000), requireUser, postGate('ticket'), jsonBody, (req, res) => {
    const c = cfg();
    if (!cfgOk(c)) return fail(res, 503, 'Turniere sind gerade nicht eingerichtet');
    const b = req.body;
    const title = clean(b.title, 80).replace(/\n/g, ' '), game = clean(b.game, 60).replace(/\n/g, ' ');
    const description = clean(b.description, 2000), goals = clean(b.goals, 1000);
    const starts = Number(b.starts_at), max = Math.max(2, Math.min(500, Math.trunc(Number(b.max_players) || 32)));
    if (title.length < 4 || game.length < 2) return fail(res, 400, 'Titel und Spiel fehlen');
    if (description.length < 20) return fail(res, 400, 'Bitte beschreibe das Turnier genauer (mindestens 20 Zeichen)');
    if (!Number.isFinite(starts) || starts < now() + 3600_000) return fail(res, 400, 'Der Start muss mindestens eine Stunde in der Zukunft liegen');
    const pending = db.prepare("SELECT COUNT(*) n FROM tournaments WHERE organizer_id = ? AND status IN ('review','open','running','proof')").get(req.user.id).n;
    if (pending >= 2) return fail(res, 429, 'Du hast schon zwei laufende Turniere');
    const pid = newPid();
    if (!eco.charge(req.user.id, c.cost, 'tournament_fund', pid)) return fail(res, 400, `Dir fehlen Credits: Ein Turnier kostet ${c.cost} Credits (liegt bis zur Entscheidung in Treuhand)`);
    const ticket = ctx.createTicket(req.user.id, 'turnier', `Turnier-Prüfung: ${title}`, `Turnier ${pid} (${game}) wartet auf Prüfung.\nStart: ${new Date(starts).toLocaleString('de-DE')}\nMax. Spieler: ${max}\n\n${description}\n\nZiele: ${goals || '–'}\n\nBitte antworten, falls das Team Rückfragen hat.`);
    const t = now();
    db.prepare('INSERT INTO tournaments(pid,organizer_id,title,game,description,goals,starts_at,max_players,status,cfg,ticket_pid,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(pid, req.user.id, title, game, description, goals, starts, max, 'review', JSON.stringify(c), ticket, t, t);
    send(res, 201, { id: pid, ticket });
  });

  const refund = (t, why) => { eco.give(t.organizer_id, JSON.parse(t.cfg).cost, 'tournament_refund', t.pid + ':' + why); };
  const setStatus = (t, st, extra = {}) => { const keys = Object.keys(extra); db.prepare(`UPDATE tournaments SET status = ?, updated_at = ?${keys.map((k) => `, ${k} = ?`).join('')} WHERE id = ?`).run(st, now(), ...keys.map((k) => extra[k]), t.id); };
  const own = (req, res) => { const t = byPid(req.params.pid); if (!t || t.organizer_id !== req.user.id) { fail(res, 404, 'Turnier nicht gefunden'); return null; } return t; };

  POST('/api/tournaments/:pid/join', rl('tjoin', 20, 600_000), requireUser, postGate('ticket'), jsonBody, (req, res) => {
    const t = byPid(req.params.pid);
    if (!t || t.status !== 'open') return fail(res, 400, 'Die Anmeldung ist nicht offen');
    if (t.organizer_id === req.user.id) return fail(res, 403, 'Veranstalter dürfen nicht selbst teilnehmen');
    if (db.prepare('SELECT COUNT(*) n FROM tournament_players WHERE tournament_id = ?').get(t.id).n >= t.max_players) return fail(res, 400, 'Das Turnier ist voll');
    db.prepare('INSERT OR IGNORE INTO tournament_players(tournament_id,user_id,joined_at) VALUES(?,?,?)').run(t.id, req.user.id, now());
    send(res, 200, { ok: true });
  });
  POST('/api/tournaments/:pid/leave', requireUser, jsonBody, (req, res) => {
    const t = byPid(req.params.pid);
    if (!t || t.status !== 'open') return fail(res, 400, 'Abmelden ist nur während der Anmeldung möglich');
    db.prepare('DELETE FROM tournament_players WHERE tournament_id = ? AND user_id = ?').run(t.id, req.user.id);
    send(res, 200, { ok: true });
  });

  // Veranstalter
  POST('/api/tournaments/:pid/withdraw', requireUser, jsonBody, (req, res) => {
    const t = own(req, res); if (!t) return;
    if (!['review', 'open'].includes(t.status)) return fail(res, 400, 'Jetzt nicht mehr möglich – bitte wende dich an den Support');
    refund(t, 'withdraw'); setStatus(t, 'cancelled', { review_note: 'Vom Veranstalter zurückgezogen' });
    send(res, 200, { ok: true });
  });
  POST('/api/tournaments/:pid/start', requireUser, jsonBody, (req, res) => {
    const t = own(req, res); if (!t) return;
    if (t.status !== 'open') return fail(res, 400, 'Das Turnier ist nicht in der Anmeldephase');
    if (players(t.id).length < 2) return fail(res, 400, 'Es brauchen mindestens 2 Teilnehmer');
    setStatus(t, 'running'); send(res, 200, { ok: true });
  });
  PATCH('/api/tournaments/:pid/points', requireUser, jsonBody, (req, res) => {
    const t = own(req, res); if (!t) return;
    if (t.status !== 'running') return fail(res, 400, 'Punkte können nur während des Turniers geändert werden');
    const pts = Math.trunc(Number(req.body.points));
    if (!Number.isFinite(pts) || pts < 0 || pts > 1_000_000) return fail(res, 400, 'Ungültige Punktzahl');
    const r = db.prepare('UPDATE tournament_players SET points = ? WHERE tournament_id = ? AND user_id = ?').run(pts, t.id, Number(req.body.user_id));
    if (!r.changes) return fail(res, 404, 'Teilnehmer nicht gefunden');
    db.prepare('UPDATE tournaments SET updated_at = ? WHERE id = ?').run(now(), t.id);
    send(res, 200, { ok: true });
  });
  POST('/api/tournaments/:pid/finish', requireUser, jsonBody, (req, res) => {
    const t = own(req, res); if (!t) return;
    if (t.status !== 'running') return fail(res, 400, 'Das Turnier läuft nicht');
    const ids = [req.body.first, req.body.second, req.body.third].map((x) => (x == null || x === '' ? null : Number(x)));
    const pl = new Set(players(t.id).map((p) => p.user_id));
    const win = ids.map((uid, i) => (uid ? { place: i + 1, user_id: uid } : null)).filter(Boolean);
    if (!win.length || !ids[0]) return fail(res, 400, 'Mindestens der erste Platz muss angegeben werden');
    if (new Set(win.map((w) => w.user_id)).size !== win.length) return fail(res, 400, 'Jede Person kann nur einen Platz belegen');
    if (win.some((w) => w.user_id === t.organizer_id || !pl.has(w.user_id))) return fail(res, 400, 'Gewinner müssen angemeldete Teilnehmer sein (nicht der Veranstalter)');
    const url = safeUrl(req.body.proof_url), note = clean(req.body.proof_note, 1000);
    if (!url && note.length < 20) return fail(res, 400, 'Bitte gib einen Beweis an: Link (https://…) zu Video/Screenshots oder eine ausführliche Beschreibung');
    if (req.body.proof_url && !url) return fail(res, 400, 'Der Link muss mit https:// beginnen');
    setStatus(t, 'proof', { winners: JSON.stringify(win), proof_url: url, proof_note: note });
    send(res, 200, { ok: true });
  });

  // ---- Team ----
  const perm = requirePerm('tournaments.review');
  const adminRow = (t) => ({ ...view(t, null), organizer_id: t.organizer_id, approved_by: t.approved_by ? name(t.approved_by) : null, approved_by_id: t.approved_by, proof_url: t.proof_url, proof_note: t.proof_note, ticket: t.ticket_pid, cfg: JSON.parse(t.cfg), review_note: t.review_note, winner_ids: t.winners ? JSON.parse(t.winners) : null });
  GET('/api/admin/tournaments', perm, (req, res) => {
    const st = String(req.query.status || 'todo');
    const where = st === 'todo' ? "status IN ('review','proof')" : st === 'all' ? '1=1' : STATUS[st] ? 'status = ?' : '1=0';
    const rows = db.prepare(`SELECT * FROM tournaments WHERE ${where} ORDER BY updated_at DESC LIMIT 100`).all(...(STATUS[st] ? [st] : [])).map(adminRow);
    send(res, 200, { rows, statuses: STATUS, config: cfg(), me: req.user.id });
  });
  const need = (req, res, ...states) => { const t = byPid(req.params.pid); if (!t) { fail(res, 404, 'Turnier nicht gefunden'); return null; } if (!states.includes(t.status)) { fail(res, 400, 'Das geht in diesem Status nicht'); return null; } return t; };
  POST('/api/admin/tournaments/:pid/approve', perm, jsonBody, (req, res) => {
    const t = need(req, res, 'review'); if (!t) return;
    setStatus(t, 'open', { approved_by: req.user.id, review_note: clean(req.body.note || '', 300) });
    audit(req.admin.username, 'tournament_approve', t.pid); send(res, 200, { ok: true });
  });
  POST('/api/admin/tournaments/:pid/reject', perm, jsonBody, (req, res) => {
    const t = need(req, res, 'review'); if (!t) return;
    const note = clean(req.body.note || '', 300); if (note.length < 3) return fail(res, 400, 'Bitte einen Grund angeben');
    refund(t, 'reject'); setStatus(t, 'rejected', { review_note: note });
    audit(req.admin.username, 'tournament_reject', `${t.pid}: ${note}`); send(res, 200, { ok: true });
  });
  POST('/api/admin/tournaments/:pid/deny-proof', perm, jsonBody, (req, res) => {
    const t = need(req, res, 'proof'); if (!t) return;
    const note = clean(req.body.note || '', 300); if (note.length < 3) return fail(res, 400, 'Bitte einen Grund angeben');
    setStatus(t, 'running', { review_note: note, winners: null });
    audit(req.admin.username, 'tournament_deny_proof', `${t.pid}: ${note}`); send(res, 200, { ok: true });
  });
  POST('/api/admin/tournaments/:pid/confirm', perm, jsonBody, (req, res) => {
    const t = need(req, res, 'proof'); if (!t) return;
    const c = JSON.parse(t.cfg);
    if (c.four_eyes && getSetting('t_four_eyes', '1') === '1' && t.approved_by === req.user.id) return fail(res, 403, 'Vier-Augen-Prinzip: Die Auszahlung muss eine andere Person bestätigen als die Freigabe');
    const win = JSON.parse(t.winners), prize = { 1: c.p1, 2: c.p2, 3: c.p3 };
    let toPot = c.lot, paid = 0;
    for (const w of win) { eco.give(w.user_id, prize[w.place], 'tournament_prize', `${t.pid}:${w.place}`); paid += prize[w.place]; }
    toPot += c.p1 + c.p2 + c.p3 - paid; // nicht vergebene Plätze → Lostopf
    eco.setPot(eco.pot() + toPot); eco.toTreasury(c.fee);
    setStatus(t, 'finished', { review_note: clean(req.body.note || '', 300) });
    audit(req.admin.username, 'tournament_confirm', `${t.pid} ausgezahlt ${paid}, Lostopf +${toPot}, Gebühr ${c.fee}`);
    send(res, 200, { ok: true, paid, lottery: toPot });
  });
  POST('/api/admin/tournaments/:pid/cancel', perm, jsonBody, (req, res) => {
    const t = need(req, res, 'review', 'open', 'running', 'proof'); if (!t) return;
    const note = clean(req.body.note || '', 300); if (note.length < 3) return fail(res, 400, 'Bitte einen Grund angeben');
    refund(t, 'cancel'); setStatus(t, 'cancelled', { review_note: note });
    audit(req.admin.username, 'tournament_cancel', `${t.pid}: ${note}`); send(res, 200, { ok: true });
  });
  PUT('/api/admin/tournaments/config', requirePerm('settings.edit'), jsonBody, (req, res) => {
    const c = cfg(), b = req.body, n = { cost: c.cost, fee: c.fee, p1: c.p1, p2: c.p2, p3: c.p3, lot: c.lot };
    for (const k of Object.keys(n)) if (k in b) n[k] = Math.max(0, Math.min(1_000_000_000, Math.trunc(Number(b[k]) || 0)));
    if (!cfgOk({ ...n, four_eyes: true })) return fail(res, 400, 'Gebühr + Preise + Lostopf müssen zusammen genau dem Einsatz entsprechen');
    for (const k of Object.keys(n)) setSetting('t_' + k, String(n[k]));
    if ('four_eyes' in b) setSetting('t_four_eyes', b.four_eyes ? '1' : '0');
    audit(req.admin.username, 'tournament_config', JSON.stringify(n)); send(res, 200, { ok: true });
  });
  return {};
};
