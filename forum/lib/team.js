'use strict';
// ======================================================================
// Team-Verwaltung (Admin-API): Nutzer, Konto-Stufen, Timeouts, Verwarnungen,
// Rollen & Rechte, Benutzernamen-Liste.
// ======================================================================
const { PERMISSIONS, ALL_KEYS, STATUSES } = require('./permissions');

module.exports = function initTeam(ctx, acc) {
  const { db, now, tx, GET, POST, PUT, DEL, PATCH, send, fail, jsonBody, audit, num } = ctx;
  const { requirePerm, hydrate, has, roleById, removeAvatarFile } = acc;

  const PAGE = 20;
  const pageOf = (req) => Math.max(1, parseInt(req.query.page) || 1);
  const likeOf = (q) => '%' + String(q).slice(0, 40).replace(/[\\%_]/g, (m) => '\\' + m) + '%';
  const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);

  // Wer darf wen verwalten? Nur strikt höhere Rollen – nie sich selbst bei heiklen Aktionen.
  const levelOf = (u) => (u.role ? u.role.level : 0);
  function actOn(req, res, targetId, { self = false } = {}) {
    const row = db.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').get(num(targetId));
    if (!row) { fail(res, 404, 'Nutzer nicht gefunden'); return null; }
    const target = hydrate(row);
    if (target.id === req.user.id && !self) { fail(res, 400, 'Das kannst du bei dir selbst nicht tun'); return null; }
    if (target.id !== req.user.id && levelOf(req.user) <= levelOf(target)) { fail(res, 403, 'Du kannst nur Nutzer mit niedrigerer Rolle verwalten'); return null; }
    return target;
  }

  const userCard = (r) => ({
    id: r.id,
    username: r.username,
    role: r.role_key ? { id: r.role_id, key: r.role_key, name: r.role_name, color: r.role_color, level: r.role_level } : null,
    status: r.status,
    timeout: r.timeout_until && r.timeout_until > now() ? { until: r.timeout_until, mode: r.timeout_mode } : null,
    created_at: r.created_at,
    last_login: r.last_login,
    login_count: r.login_count,
    totp_on: !!r.totp_on,
    threads: r.threads,
    comments: r.comments,
    warnings: r.warnings,
  });

  // ------------------------------------------------------------------
  GET('/api/admin/me', (req, res) => {
    if (!req.user) return send(res, 401, { error: 'Nicht angemeldet', code: 'LOGIN_REQUIRED' });
    if (!acc.isTeam(req.user)) return fail(res, 403, 'Kein Zugriff auf den Admin-Bereich');
    send(res, 200, { username: req.user.username, user: acc.meOf(req.user), permissions: PERMISSIONS });
  });

  // ----- Nutzer -----
  GET('/api/admin/users', requirePerm('users.view'), (req, res) => {
    const where = ['u.deleted = 0'];
    const args = [];
    if (req.query.q) { where.push("u.username LIKE ? ESCAPE '\\'"); args.push(likeOf(req.query.q)); }
    if (req.query.status && STATUSES[req.query.status]) { where.push('u.status = ?'); args.push(req.query.status); }
    if (req.query.role === 'team') where.push('u.role_id IS NOT NULL');
    else if (req.query.role === 'none') where.push('u.role_id IS NULL');
    else if (req.query.role) { where.push('r.key = ?'); args.push(String(req.query.role)); }
    if (req.query.timeout === '1') { where.push('u.timeout_until > ?'); args.push(now()); }
    const W = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE ${W}`).get(...args).n;
    const rows = db.prepare(
      `SELECT u.*, r.key role_key, r.name role_name, r.color role_color, r.level role_level,
        (SELECT COUNT(*) FROM threads t WHERE t.user_id = u.id AND t.deleted = 0) threads,
        (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id AND c.deleted = 0) comments,
        (SELECT COUNT(*) FROM warnings w WHERE w.user_id = u.id) warnings
       FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE ${W} ORDER BY u.id DESC LIMIT ? OFFSET ?`
    ).all(...args, PAGE, (pageOf(req) - 1) * PAGE);
    send(res, 200, { total, pages: Math.max(1, Math.ceil(total / PAGE)), rows: rows.map(userCard), statuses: STATUSES });
  });

  GET('/api/admin/users/:id', requirePerm('users.view'), (req, res) => {
    const id = num(req.params.id);
    const r = db.prepare(
      `SELECT u.*, r.key role_key, r.name role_name, r.color role_color, r.level role_level,
        (SELECT COUNT(*) FROM threads t WHERE t.user_id = u.id AND t.deleted = 0) threads,
        (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id AND c.deleted = 0) comments,
        (SELECT COUNT(*) FROM warnings w WHERE w.user_id = u.id) warnings
       FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.deleted = 0`
    ).get(id);
    if (!r) return fail(res, 404, 'Nutzer nicht gefunden');
    send(res, 200, {
      user: {
        ...userCard(r),
        bio: r.bio,
        avatar: r.avatar ? '/avatars/' + r.avatar : null,
        status_note: r.status_note,
        status_since: r.status_since,
        timeout_reason: r.timeout_reason,
        has_email: !!r.email_enc,
        recovery_codes_left: db.prepare('SELECT COUNT(*) n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').get(id).n,
        sessions: db.prepare('SELECT COUNT(*) n FROM user_sessions WHERE user_id = ? AND expires_at > ?').get(id, now()).n,
        locked_until: r.locked_until && r.locked_until > now() ? r.locked_until : null,
      },
      warnings_list: db.prepare('SELECT id, by_name, reason, created_at FROM warnings WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(id),
      names: db.prepare('SELECT name, kind, created_at FROM usernames WHERE user_id = ? ORDER BY created_at DESC').all(id),
      recent: [
        ...db.prepare('SELECT id, title, created_at FROM threads WHERE user_id = ? AND deleted = 0 ORDER BY id DESC LIMIT 5').all(id).map((t) => ({ type: 'thread', id: t.id, text: t.title, created_at: t.created_at })),
        ...db.prepare('SELECT id, thread_id, body, created_at FROM comments WHERE user_id = ? AND deleted = 0 ORDER BY id DESC LIMIT 5').all(id).map((c) => ({ type: 'comment', id: c.id, thread_id: c.thread_id, text: c.body.slice(0, 120), created_at: c.created_at })),
      ].sort((a, b) => b.created_at - a.created_at),
    });
  });

  // Konto-Stufe ändern (normal / Verdacht / Untersuchung / gebannt)
  PATCH('/api/admin/users/:id/status', requirePerm('users.status'), jsonBody, (req, res) => {
    const target = actOn(req, res, req.params.id);
    if (!target) return;
    const status = String(req.body.status || '');
    if (!STATUSES[status]) return fail(res, 400, 'Unbekannte Stufe');
    if ((status === 'gebannt' || target.status === 'gebannt') && !has(req.user, 'users.ban')) return fail(res, 403, 'Bannen und Entbannen darf nur, wer das Recht „Konten dauerhaft bannen“ hat');
    const note = clip(req.body.note, 300);
    db.prepare('UPDATE users SET status = ?, status_note = ?, status_since = ? WHERE id = ?').run(status, note, now(), target.id);
    audit(req.admin.username, 'user_status', `${target.username}: ${target.status} → ${status}${note ? ' (' + note + ')' : ''}`);
    send(res, 200, { ok: true });
  });

  // Timeout: nicht schreiben ODER Seite unsichtbar – zeitlich begrenzt
  POST('/api/admin/users/:id/timeout', requirePerm('users.timeout'), jsonBody, (req, res) => {
    const target = actOn(req, res, req.params.id);
    if (!target) return;
    const minutes = Math.round(num(req.body.minutes));
    const mode = req.body.mode === 'hidden' ? 'hidden' : 'write';
    const cap = has(req.user, 'users.ban') ? 365 * 1440 : 30 * 1440; // Moderatoren: höchstens 30 Tage
    if (!(minutes >= 1)) return fail(res, 400, 'Bitte eine Dauer in Minuten angeben');
    if (minutes > cap) return fail(res, 400, `Maximale Dauer für dich: ${Math.floor(cap / 1440)} Tage`);
    const reason = clip(req.body.reason, 200);
    const until = now() + minutes * 60_000;
    db.prepare('UPDATE users SET timeout_until = ?, timeout_mode = ?, timeout_reason = ? WHERE id = ?').run(until, mode, reason, target.id);
    audit(req.admin.username, 'user_timeout', `${target.username}: ${minutes} Min, ${mode === 'hidden' ? 'Seite unsichtbar' : 'Schreiben gesperrt'}${reason ? ' (' + reason + ')' : ''}`);
    send(res, 200, { ok: true, until });
  });

  DEL('/api/admin/users/:id/timeout', requirePerm('users.timeout'), (req, res) => {
    const target = actOn(req, res, req.params.id);
    if (!target) return;
    db.prepare("UPDATE users SET timeout_until = NULL, timeout_reason = '' WHERE id = ?").run(target.id);
    audit(req.admin.username, 'user_timeout_end', target.username);
    send(res, 200, { ok: true });
  });

  // Verwarnung (3 Verwarnungen setzen ein normales Konto automatisch auf „Verdacht“)
  POST('/api/admin/users/:id/warn', requirePerm('users.warn'), jsonBody, (req, res) => {
    const target = actOn(req, res, req.params.id);
    if (!target) return;
    const reason = clip(req.body.reason, 300);
    if (reason.length < 3) return fail(res, 400, 'Bitte einen Grund angeben');
    db.prepare('INSERT INTO warnings(user_id, by_name, reason, created_at) VALUES(?,?,?,?)').run(target.id, req.admin.username, reason, now());
    const n = db.prepare('SELECT COUNT(*) n FROM warnings WHERE user_id = ?').get(target.id).n;
    let escalated = false;
    if (n >= 3 && target.status === 'normal') {
      db.prepare("UPDATE users SET status = 'verdacht', status_note = ?, status_since = ? WHERE id = ?").run('Automatisch nach 3 Verwarnungen', now(), target.id);
      escalated = true;
    }
    audit(req.admin.username, 'user_warn', `${target.username}: ${reason}`);
    send(res, 201, { ok: true, count: n, escalated });
  });

  DEL('/api/admin/warnings/:id', requirePerm('users.status'), (req, res) => {
    const w = db.prepare('SELECT w.*, u.username FROM warnings w JOIN users u ON u.id = w.user_id WHERE w.id = ?').get(num(req.params.id));
    if (!w) return fail(res, 404, 'Nicht gefunden');
    db.prepare('DELETE FROM warnings WHERE id = ?').run(w.id);
    audit(req.admin.username, 'warning_removed', w.username);
    send(res, 200, { ok: true });
  });

  // Rolle zuweisen (null = Rolle entziehen)
  POST('/api/admin/users/:id/role', requirePerm('users.roles'), jsonBody, (req, res) => {
    const target = actOn(req, res, req.params.id);
    if (!target) return;
    let role = null;
    if (req.body.role_id != null && req.body.role_id !== '') {
      role = roleById(num(req.body.role_id));
      if (!role) return fail(res, 400, 'Rolle nicht gefunden');
      if (role.key === 'owner') return fail(res, 403, 'Die Inhaber-Rolle kann nicht vergeben werden');
      if (role.level >= levelOf(req.user)) return fail(res, 403, 'Du kannst nur Rollen unterhalb deiner eigenen vergeben');
    }
    tx(() => {
      db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(role ? role.id : null, target.id);
      // Teamrollen haben kürzere Sitzungen (12 Std.)
      if (role && role.perms.includes('admin.access')) db.prepare('UPDATE user_sessions SET expires_at = MIN(expires_at, ?) WHERE user_id = ?').run(now() + 12 * 3600_000, target.id);
    });
    audit(req.admin.username, 'user_role', `${target.username} → ${role ? role.name : '(keine)'}`);
    send(res, 200, { ok: true, setup_required: !!(acc.teamMfaRequired() && role && role.perms.includes('admin.access') && !(acc.hydrate(target).mfa && target.email_enc)) });
  });

  // Alle Sitzungen beenden + Fehlversuche-Sperre aufheben
  POST('/api/admin/users/:id/reset-sessions', requirePerm('users.status'), (req, res) => {
    const target = actOn(req, res, req.params.id);
    if (!target) return;
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(target.id);
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(target.id);
    audit(req.admin.username, 'user_sessions_reset', target.username);
    send(res, 200, { ok: true });
  });

  // Profilbild/Beschreibung eines Nutzers entfernen (z. B. unpassender Inhalt)
  POST('/api/admin/users/:id/clear-profile', requirePerm('users.status'), (req, res) => {
    const target = actOn(req, res, req.params.id);
    if (!target) return;
    removeAvatarFile(target.avatar);
    db.prepare("UPDATE users SET avatar = NULL, bio = '' WHERE id = ?").run(target.id);
    audit(req.admin.username, 'user_profile_cleared', target.username);
    send(res, 200, { ok: true });
  });

  // ----- Benutzernamen-Liste -----
  GET('/api/admin/names', requirePerm('users.names'), (req, res) => {
    const where = ['1=1'];
    const args = [];
    if (req.query.q) { where.push("n.name LIKE ? ESCAPE '\\'"); args.push(likeOf(req.query.q)); }
    if (req.query.kind === 'reserved') where.push("n.kind = 'reserved'");
    if (req.query.kind === 'registered') where.push("n.kind = 'registered'");
    const W = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n FROM usernames n WHERE ${W}`).get(...args).n;
    const rows = db.prepare(
      `SELECT n.name_lc, n.name, n.kind, n.created_at, n.user_id, u.username owner_name, (u.deleted = 0 AND u.name_lc = n.name_lc) in_use, u.deleted owner_deleted
       FROM usernames n LEFT JOIN users u ON u.id = n.user_id WHERE ${W} ORDER BY n.created_at DESC, n.name LIMIT ? OFFSET ?`
    ).all(...args, PAGE, (pageOf(req) - 1) * PAGE);
    send(res, 200, { total, pages: Math.max(1, Math.ceil(total / PAGE)), rows });
  });

  POST('/api/admin/names', requirePerm('users.names'), jsonBody, (req, res) => {
    const name = clip(req.body.name, 20);
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(name)) return fail(res, 400, 'Name: 3–20 Zeichen (Buchstaben, Zahlen, _ und -)');
    const lc = name.toLowerCase();
    if (db.prepare('SELECT 1 FROM usernames WHERE name_lc = ?').get(lc)) return fail(res, 409, 'Der Name steht bereits in der Liste');
    acc.insName.run(lc, name, null, 'reserved', now(), acc.skeleton(lc));
    audit(req.admin.username, 'name_reserved', name);
    send(res, 201, { ok: true });
  });

  // Namen freigeben (wieder registrierbar machen)
  DEL('/api/admin/names/:lc', requirePerm('users.names'), (req, res) => {
    const lc = String(req.params.lc).toLowerCase();
    const n = db.prepare('SELECT n.*, (u.deleted = 0 AND u.name_lc = n.name_lc) in_use FROM usernames n LEFT JOIN users u ON u.id = n.user_id WHERE n.name_lc = ?').get(lc);
    if (!n) return fail(res, 404, 'Name nicht gefunden');
    if (n.in_use) return fail(res, 409, 'Der Name wird gerade von einem aktiven Konto genutzt');
    db.prepare('DELETE FROM usernames WHERE name_lc = ?').run(lc);
    audit(req.admin.username, 'name_released', n.name);
    send(res, 200, { ok: true });
  });

  // ----- Rollen & Rechte -----
  const roleOut = (r) => {
    let perms = [];
    try { perms = JSON.parse(r.permissions); } catch { /* leer */ }
    return { id: r.id, key: r.key, name: r.name, color: r.color, level: r.level, system: !!r.system, permissions: perms, users: r.users };
  };

  GET('/api/admin/roles', requirePerm('users.view'), (req, res) => {
    const rows = db.prepare('SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.deleted = 0) users FROM roles r ORDER BY r.level DESC').all();
    send(res, 200, { roles: rows.map(roleOut), catalogue: PERMISSIONS, my_level: levelOf(req.user) });
  });

  function roleFields(req, res, existing) {
    const name = clip(req.body.name, 30);
    if (name.length < 2) { fail(res, 400, 'Name zu kurz'); return null; }
    const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color) ? req.body.color : '#00f0ff';
    const level = Math.round(num(req.body.level, 10));
    if (level < 1 || level >= levelOf(req.user)) { fail(res, 400, `Die Stufe muss zwischen 1 und ${levelOf(req.user) - 1} liegen (niedriger als deine eigene)`); return null; }
    let perms = Array.isArray(req.body.permissions) ? req.body.permissions.filter((p) => ALL_KEYS.includes(p)) : [];
    perms = [...new Set(perms)];
    // Niemand kann Rechte vergeben, die er selbst nicht hat
    const bad = perms.filter((p) => !has(req.user, p));
    if (bad.length) { fail(res, 403, 'Du kannst nur Rechte vergeben, die du selbst besitzt'); return null; }
    if (existing && existing.system && existing.key === 'owner') { fail(res, 403, 'Die Inhaber-Rolle ist fest'); return null; }
    return { name, color, level, perms };
  }

  POST('/api/admin/roles', requirePerm('roles.manage'), jsonBody, (req, res) => {
    const f = roleFields(req, res);
    if (!f) return;
    const key = 'r' + Date.now().toString(36);
    const r = db.prepare('INSERT INTO roles(key,name,color,level,permissions,system,created_at) VALUES(?,?,?,?,?,0,?)').run(key, f.name, f.color, f.level, JSON.stringify(f.perms), now());
    audit(req.admin.username, 'role_create', f.name);
    send(res, 201, { id: Number(r.lastInsertRowid) });
  });

  PUT('/api/admin/roles/:id', requirePerm('roles.manage'), jsonBody, (req, res) => {
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(num(req.params.id));
    if (!role) return fail(res, 404, 'Rolle nicht gefunden');
    if (role.key === 'owner') return fail(res, 403, 'Die Inhaber-Rolle ist fest');
    if (role.level >= levelOf(req.user)) return fail(res, 403, 'Du kannst nur Rollen unterhalb deiner eigenen bearbeiten');
    const f = roleFields(req, res, role);
    if (!f) return;
    db.prepare('UPDATE roles SET name = ?, color = ?, level = ?, permissions = ? WHERE id = ?').run(f.name, f.color, f.level, JSON.stringify(f.perms), role.id);
    audit(req.admin.username, 'role_edit', f.name);
    send(res, 200, { ok: true });
  });

  DEL('/api/admin/roles/:id', requirePerm('roles.manage'), (req, res) => {
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(num(req.params.id));
    if (!role) return fail(res, 404, 'Rolle nicht gefunden');
    if (role.system) return fail(res, 403, 'Standard-Rollen können nicht gelöscht werden');
    if (role.level >= levelOf(req.user)) return fail(res, 403, 'Du kannst nur Rollen unterhalb deiner eigenen löschen');
    if (db.prepare('SELECT 1 FROM users WHERE role_id = ? AND deleted = 0').get(role.id)) return fail(res, 409, 'Der Rolle sind noch Nutzer zugeordnet');
    db.prepare('DELETE FROM roles WHERE id = ?').run(role.id);
    audit(req.admin.username, 'role_delete', role.name);
    send(res, 200, { ok: true });
  });
};
