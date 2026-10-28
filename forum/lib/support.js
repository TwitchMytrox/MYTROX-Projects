/* Support-Tickets: Mitglieder erstellen/verwalten eigene Tickets, das Team (Recht tickets.handle) bearbeitet sie.
   Ticket-Nummern sind zufällig (nicht durchzählbar). */
const crypto = require('node:crypto');

module.exports = function init(ctx, acc) {
  const { db, now, GET, POST, PATCH, send, fail, jsonBody, rl, audit, clean } = ctx;
  const { requireUser, requirePerm, postGate } = acc;

  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, pid TEXT UNIQUE NOT NULL, user_id INTEGER NOT NULL, category TEXT NOT NULL,
      subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal',
      assignee_id INTEGER, team_group TEXT NOT NULL DEFAULT 'support', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      closed_at INTEGER, closed_by TEXT, user_seen_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, updated_at);
    CREATE TABLE IF NOT EXISTS ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, user_id INTEGER, staff INTEGER NOT NULL DEFAULT 0,
      internal INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tmsg ON ticket_messages(ticket_id, id);
  `);

  const CATEGORIES = [
    { key: 'personalisierung', label: 'Personalisierung (Profil, Name, Design)' },
    { key: 'konto', label: 'Mein Konto (Anmeldung, 2FA, Passwort)' },
    { key: 'fehler', label: 'Fehler / Technisches Problem' },
    { key: 'beschwerde', label: 'Beschwerde oder Einspruch (Verwarnung, Sperre)' },
    { key: 'datenschutz', label: 'Datenschutz (Auskunft, Löschung)' },
    { key: 'turnier', label: 'Turnier (Prüfung, Rückfragen)' },
    { key: 'vorschlag', label: 'Vorschlag / Feedback' },
    { key: 'sonstiges', label: 'Sonstiges' },
  ];
  const CAT = new Set(CATEGORIES.map((c) => c.key));
  const STATUS = { open: 'Offen', in_progress: 'In Bearbeitung', pending: 'Wartet auf dich', closed: 'Geschlossen', withdrawn: 'Zurückgezogen' };
  const PRIORITY = ['low', 'normal', 'high', 'urgent'];
  const GROUPS = { support: 'Support', moderation: 'Moderation', admin: 'Administration' };
  const A32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newPid = () => { for (;;) { const pid = 'T-' + Array.from({ length: 8 }, () => A32[crypto.randomInt(32)]).join(''); if (!db.prepare('SELECT 1 FROM tickets WHERE pid = ?').get(pid)) return pid; } };

  const OPEN_LIMIT = 8;
  const mine = (req, pid) => db.prepare('SELECT * FROM tickets WHERE pid = ? AND user_id = ?').get(String(pid || ''), req.user.id);
  const msgs = (id, staffView) => db.prepare(`SELECT m.id, m.staff, m.internal, m.body, m.created_at, u.username FROM ticket_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.ticket_id = ? ${staffView ? '' : 'AND m.internal = 0'} ORDER BY m.id`).all(id)
    .map((m) => ({ id: m.id, staff: !!m.staff, internal: !!m.internal, body: m.body, created_at: m.created_at, from: m.staff && !staffView ? 'Support-Team' : (m.username || 'Gelöschter Nutzer') }));
  const view = (t) => ({ id: t.pid, category: t.category, subject: t.subject, status: t.status, status_label: STATUS[t.status], created_at: t.created_at, updated_at: t.updated_at, closed_at: t.closed_at, unread: t.updated_at > t.user_seen_at && t.status !== 'withdrawn' && !!db.prepare('SELECT 1 FROM ticket_messages WHERE ticket_id = ? AND staff = 1 AND internal = 0 AND created_at > ? LIMIT 1').get(t.id, t.user_seen_at) });

  // ---------------- Mitglieder ----------------
  GET('/api/support/categories', (req, res) => send(res, 200, { categories: CATEGORIES, statuses: STATUS }));

  GET('/api/support/tickets', requireUser, (req, res) => {
    const rows = db.prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100').all(req.user.id).map(view);
    send(res, 200, { tickets: rows, unread: rows.filter((r) => r.unread).length });
  });
  GET('/api/support/unread', requireUser, (req, res) => send(res, 200, { unread: db.prepare('SELECT * FROM tickets WHERE user_id = ?').all(req.user.id).map(view).filter((r) => r.unread).length }));

  POST('/api/support/tickets', rl('ticket', 120, 3600_000), requireUser, postGate('ticket'), jsonBody, (req, res) => {
    const category = CAT.has(req.body.category) ? req.body.category : null;
    const subject = clean(req.body.subject, 120).replace(/\n/g, ' ');
    const body = clean(req.body.body, 4000);
    if (!category) return fail(res, 400, 'Bitte wähle eine Kategorie');
    if (subject.length < 4) return fail(res, 400, 'Bitte gib einen Betreff an (mindestens 4 Zeichen)');
    if (body.length < 10) return fail(res, 400, 'Bitte beschreibe dein Anliegen (mindestens 10 Zeichen)');
    // Limit zählt nur erfolgreich erstellte Tickets (Tippfehler im Formular sperren niemanden aus)
    if (db.prepare('SELECT COUNT(*) n FROM tickets WHERE user_id = ? AND created_at > ?').get(req.user.id, now() - 3600_000).n >= 6) return fail(res, 429, 'Du hast in der letzten Stunde schon mehrere Tickets erstellt – bitte warte etwas');
    const open = db.prepare("SELECT COUNT(*) n FROM tickets WHERE user_id = ? AND status IN ('open','in_progress','pending')").get(req.user.id).n;
    if (open >= OPEN_LIMIT) return fail(res, 429, `Du hast schon ${OPEN_LIMIT} offene Tickets – bitte schließe oder ziehe zuerst eines zurück`);
    const pid = newPid(), t = now();
    const group = category === 'beschwerde' ? 'moderation' : category === 'datenschutz' ? 'admin' : 'support';
    const id = Number(db.prepare('INSERT INTO tickets(pid,user_id,category,subject,status,team_group,created_at,updated_at,user_seen_at) VALUES(?,?,?,?,?,?,?,?,?)').run(pid, req.user.id, category, subject, 'open', group, t, t, t).lastInsertRowid);
    db.prepare('INSERT INTO ticket_messages(ticket_id,user_id,staff,body,created_at) VALUES(?,?,0,?,?)').run(id, req.user.id, body, t);
    send(res, 201, { id: pid });
  });

  GET('/api/support/tickets/:pid', requireUser, (req, res) => {
    const t = mine(req, req.params.pid);
    if (!t) return fail(res, 404, 'Ticket nicht gefunden');
    db.prepare('UPDATE tickets SET user_seen_at = ? WHERE id = ?').run(now(), t.id);
    send(res, 200, { ticket: { ...view(t), unread: false }, messages: msgs(t.id, false) });
  });

  POST('/api/support/tickets/:pid/reply', rl('ticketreply', 20, 600_000), requireUser, postGate('ticket'), jsonBody, (req, res) => {
    const t = mine(req, req.params.pid);
    if (!t) return fail(res, 404, 'Ticket nicht gefunden');
    if (t.status === 'withdrawn') return fail(res, 400, 'Dieses Ticket hast du zurückgezogen – aktiviere es zuerst wieder');
    const body = clean(req.body.body, 4000);
    if (body.length < 2) return fail(res, 400, 'Nachricht ist leer');
    if (t.status === 'closed' && now() - t.closed_at > 14 * 86400_000) return fail(res, 400, 'Das Ticket ist schon länger geschlossen – bitte erstelle ein neues');
    db.prepare('INSERT INTO ticket_messages(ticket_id,user_id,staff,body,created_at) VALUES(?,?,0,?,?)').run(t.id, req.user.id, body, now());
    db.prepare("UPDATE tickets SET status = CASE WHEN status IN ('closed','pending') THEN 'open' ELSE status END, closed_at = NULL, updated_at = ?, user_seen_at = ? WHERE id = ?").run(now(), now(), t.id);
    send(res, 201, { ok: true });
  });

  // Zurückziehen / wieder aktivieren / selbst als erledigt schließen
  POST('/api/support/tickets/:pid/withdraw', requireUser, jsonBody, (req, res) => {
    const t = mine(req, req.params.pid);
    if (!t) return fail(res, 404, 'Ticket nicht gefunden');
    if (t.status === 'closed' || t.status === 'withdrawn') return fail(res, 400, 'Ticket ist bereits beendet');
    db.prepare("UPDATE tickets SET status = 'withdrawn', updated_at = ?, closed_at = ?, closed_by = ? WHERE id = ?").run(now(), now(), req.user.username, t.id);
    send(res, 200, { ok: true });
  });
  POST('/api/support/tickets/:pid/reactivate', requireUser, jsonBody, (req, res) => {
    const t = mine(req, req.params.pid);
    if (!t || t.status !== 'withdrawn') return fail(res, 400, 'Nur zurückgezogene Tickets können wieder aktiviert werden');
    const open = db.prepare("SELECT COUNT(*) n FROM tickets WHERE user_id = ? AND status IN ('open','in_progress','pending')").get(req.user.id).n;
    if (open >= OPEN_LIMIT) return fail(res, 429, 'Zu viele offene Tickets');
    db.prepare("UPDATE tickets SET status = 'open', updated_at = ?, closed_at = NULL, closed_by = NULL WHERE id = ?").run(now(), t.id);
    send(res, 200, { ok: true });
  });
  POST('/api/support/tickets/:pid/close', requireUser, jsonBody, (req, res) => {
    const t = mine(req, req.params.pid);
    if (!t || t.status === 'closed' || t.status === 'withdrawn') return fail(res, 400, 'Ticket ist bereits beendet');
    db.prepare("UPDATE tickets SET status = 'closed', updated_at = ?, closed_at = ?, closed_by = ? WHERE id = ?").run(now(), now(), req.user.username, t.id);
    send(res, 200, { ok: true });
  });

  // ---------------- Team ----------------
  const perm = requirePerm('tickets.handle');
  const staffRow = (t) => {
    const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(t.user_id);
    const a = t.assignee_id ? db.prepare('SELECT id, username FROM users WHERE id = ?').get(t.assignee_id) : null;
    return { id: t.pid, category: t.category, subject: t.subject, status: t.status, status_label: STATUS[t.status], priority: t.priority, team_group: t.team_group, group_label: GROUPS[t.team_group],
      created_at: t.created_at, updated_at: t.updated_at, closed_at: t.closed_at, closed_by: t.closed_by, user: u ? { id: u.id, username: u.username } : null, assignee: a ? { id: a.id, username: a.username } : null,
      replies: db.prepare('SELECT COUNT(*) n FROM ticket_messages WHERE ticket_id = ? AND internal = 0').get(t.id).n };
  };
  const byPid = (pid) => db.prepare('SELECT * FROM tickets WHERE pid = ?').get(String(pid || ''));

  GET('/api/admin/tickets', perm, (req, res) => {
    const where = [], args = [];
    const st = String(req.query.status || 'active');
    if (st === 'active') where.push("status IN ('open','in_progress','pending')");
    else if (st !== 'all' && STATUS[st]) { where.push('status = ?'); args.push(st); }
    if (CAT.has(req.query.category)) { where.push('category = ?'); args.push(req.query.category); }
    if (GROUPS[req.query.group]) { where.push('team_group = ?'); args.push(req.query.group); }
    if (req.query.assignee === 'me') { where.push('assignee_id = ?'); args.push(req.user.id); }
    else if (req.query.assignee === 'none') where.push('assignee_id IS NULL');
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q) { where.push("(subject LIKE ? OR pid LIKE ? OR user_id IN (SELECT id FROM users WHERE name_lc LIKE ?))"); args.push(`%${q}%`, `%${q.toUpperCase()}%`, `%${q.toLowerCase()}%`); }
    const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const page = Math.max(1, Number(req.query.page) || 1), per = 30;
    const total = db.prepare(`SELECT COUNT(*) n FROM tickets ${W}`).get(...args).n;
    const rows = db.prepare(`SELECT * FROM tickets ${W} ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, updated_at DESC LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per).map(staffRow);
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM tickets GROUP BY status').all().map((r) => [r.status, r.n]));
    send(res, 200, { rows, total, pages: Math.max(1, Math.ceil(total / per)), page, counts, categories: CATEGORIES, statuses: STATUS, groups: GROUPS, priorities: PRIORITY });
  });

  GET('/api/admin/tickets/staff', perm, (req, res) => {
    const rows = db.prepare('SELECT u.id, u.username, r.name role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.deleted = 0 AND u.status <> \'gebannt\'').all()
      .filter((u) => acc.has(acc.hydrate(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)), 'tickets.handle'));
    send(res, 200, { staff: rows });
  });

  GET('/api/admin/tickets/:pid', perm, (req, res) => {
    const t = byPid(req.params.pid);
    if (!t) return fail(res, 404, 'Ticket nicht gefunden');
    const u = db.prepare('SELECT id, username, status, created_at FROM users WHERE id = ?').get(t.user_id);
    const earlier = db.prepare('SELECT pid, subject, status FROM tickets WHERE user_id = ? AND id <> ? ORDER BY id DESC LIMIT 5').all(t.user_id, t.id);
    send(res, 200, { ticket: staffRow(t), messages: msgs(t.id, true), user: u ? { id: u.id, username: u.username, status: u.status, member_since: u.created_at } : null, earlier });
  });

  POST('/api/admin/tickets/:pid/reply', rl('ticketstaff', 60, 600_000), perm, jsonBody, (req, res) => {
    const t = byPid(req.params.pid);
    if (!t) return fail(res, 404, 'Ticket nicht gefunden');
    const body = clean(req.body.body, 4000);
    if (body.length < 2) return fail(res, 400, 'Nachricht ist leer');
    const internal = req.body.internal === true ? 1 : 0;
    db.prepare('INSERT INTO ticket_messages(ticket_id,user_id,staff,internal,body,created_at) VALUES(?,?,1,?,?,?)').run(t.id, req.user.id, internal, body, now());
    if (!internal) {
      db.prepare("UPDATE tickets SET status = CASE WHEN ? = 1 THEN status WHEN status IN ('open','in_progress') THEN 'pending' ELSE status END, assignee_id = COALESCE(assignee_id, ?), updated_at = ? WHERE id = ?").run(req.body.keep_status === true ? 1 : 0, req.user.id, now(), t.id);
    }
    audit(req.admin.username, internal ? 'ticket_note' : 'ticket_reply', t.pid);
    send(res, 201, { ok: true });
  });

  // Bearbeiten: Status, Priorität, Kategorie, Betreff (inkl. Schließen)
  PATCH('/api/admin/tickets/:pid', perm, jsonBody, (req, res) => {
    const t = byPid(req.params.pid);
    if (!t) return fail(res, 404, 'Ticket nicht gefunden');
    const b = req.body, sets = [], args = [], log = [];
    if (b.status && STATUS[b.status] && b.status !== 'withdrawn' && b.status !== t.status) {
      sets.push('status = ?'); args.push(b.status); log.push('status=' + b.status);
      if (b.status === 'closed') { sets.push('closed_at = ?', 'closed_by = ?'); args.push(now(), req.user.username); } else { sets.push('closed_at = NULL', 'closed_by = NULL'); }
    }
    if (b.priority && PRIORITY.includes(b.priority)) { sets.push('priority = ?'); args.push(b.priority); log.push('prio=' + b.priority); }
    if (b.category && CAT.has(b.category)) { sets.push('category = ?'); args.push(b.category); log.push('kat=' + b.category); }
    if (typeof b.subject === 'string' && b.subject.trim().length >= 4) { sets.push('subject = ?'); args.push(clean(b.subject, 120).replace(/\n/g, ' ')); log.push('betreff'); }
    if (!sets.length) return fail(res, 400, 'Nichts zu ändern');
    sets.push('updated_at = ?'); args.push(now());
    db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...args, t.id);
    audit(req.admin.username, 'ticket_update', `${t.pid} ${log.join(', ')}`);
    send(res, 200, { ok: true });
  });

  // Weiterleiten: an Teammitglied und/oder Bereich (Support / Moderation / Administration)
  POST('/api/admin/tickets/:pid/forward', perm, jsonBody, (req, res) => {
    const t = byPid(req.params.pid);
    if (!t) return fail(res, 404, 'Ticket nicht gefunden');
    const sets = [], args = [], log = [];
    if ('assignee_id' in req.body) {
      if (req.body.assignee_id === null) { sets.push('assignee_id = NULL'); log.push('niemand'); }
      else {
        const u = db.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').get(Number(req.body.assignee_id));
        if (!u || !acc.has(acc.hydrate(u), 'tickets.handle')) return fail(res, 400, 'Diese Person kann keine Tickets bearbeiten');
        sets.push('assignee_id = ?'); args.push(u.id); log.push('an ' + u.username);
      }
    }
    if (GROUPS[req.body.team_group]) { sets.push('team_group = ?'); args.push(req.body.team_group); log.push('bereich ' + req.body.team_group); }
    if (!sets.length) return fail(res, 400, 'Bitte Person oder Bereich wählen');
    sets.push('updated_at = ?'); args.push(now());
    db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...args, t.id);
    const note = clean(req.body.note || '', 500);
    db.prepare('INSERT INTO ticket_messages(ticket_id,user_id,staff,internal,body,created_at) VALUES(?,?,1,1,?,?)').run(t.id, req.user.id, `➡️ Weitergeleitet (${log.join(', ')})${note ? ': ' + note : ''}`, now());
    audit(req.admin.username, 'ticket_forward', `${t.pid} ${log.join(', ')}`);
    send(res, 200, { ok: true });
  });

  // Für andere Module (z. B. Turnier-Prüfung): legt ein Ticket für ein Mitglied an
  ctx.createTicket = (userId, category, subject, body, group = 'support') => {
    const pid = newPid(), t = now();
    const id = Number(db.prepare('INSERT INTO tickets(pid,user_id,category,subject,status,priority,team_group,created_at,updated_at,user_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(pid, userId, category, clean(subject, 120), 'open', 'normal', group, t, t, t).lastInsertRowid);
    db.prepare('INSERT INTO ticket_messages(ticket_id,user_id,staff,body,created_at) VALUES(?,?,0,?,?)').run(id, userId, body, t);
    return pid;
  };

  // Zähler für das Admin-Menü
  ctx.openTickets = () => db.prepare("SELECT COUNT(*) n FROM tickets WHERE status IN ('open')").get().n;
  return {};
};
