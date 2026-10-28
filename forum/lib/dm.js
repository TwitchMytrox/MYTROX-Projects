/* Direktnachrichten + „Als Nachricht teilen“. Texte werden verschlüsselt gespeichert (AES-256-GCM). */
module.exports = function init(ctx, acc) {
  const { db, now, GET, POST, DEL, send, fail, num, jsonBody, rl, clean } = ctx;
  const { requireUser, postGate, box, avatarUrl } = acc;
  const { rankOf } = require('./rankdata');

  db.exec(`
    CREATE TABLE IF NOT EXISTS dm_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER NOT NULL, recipient_id INTEGER NOT NULL,
      body_enc TEXT NOT NULL, share_type TEXT, share_id INTEGER, created_at INTEGER NOT NULL, read_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_dm_pair ON dm_messages(sender_id, recipient_id, id);
    CREATE INDEX IF NOT EXISTS idx_dm_rcpt ON dm_messages(recipient_id, read_at);
    CREATE TABLE IF NOT EXISTS dm_blocks (user_id INTEGER NOT NULL, blocked_id INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id, blocked_id));
  `);
  const DAY = 86_400_000;
  const dmGate = [requireUser, postGate('dm')];

  const userByName = (name) => db.prepare("SELECT id, username, avatar, xp, status, deleted FROM users WHERE name_lc = ? AND deleted = 0").get(String(name || '').toLowerCase());
  const pub = (u) => ({ username: u.username, avatar: u.avatar ? '/avatars/' + u.avatar : null, rank: (({ name, icon }) => ({ name, icon }))(rankOf(u.xp || 0)) });
  const blocked = (a, b) => !!db.prepare('SELECT 1 FROM dm_blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)').get(a, b, b, a);

  function canSendTo(req, res, other) {
    if (!other || other.status === 'gebannt') { fail(res, 404, 'Nutzer nicht gefunden'); return false; }
    if (other.id === req.user.id) { fail(res, 400, 'Du kannst dir nicht selbst schreiben'); return false; }
    if (blocked(req.user.id, other.id)) { fail(res, 403, 'Nachricht nicht möglich (blockiert)'); return false; }
    // Neue Gespräche pro Tag begrenzen (gegen Massen-Nachrichten)
    const talked = db.prepare('SELECT 1 FROM dm_messages WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?) LIMIT 1').get(req.user.id, other.id, other.id, req.user.id);
    if (!talked) {
      const n = db.prepare('SELECT COUNT(DISTINCT recipient_id) n FROM dm_messages WHERE sender_id = ? AND created_at > ?').get(req.user.id, now() - DAY).n;
      if (n >= 15) { fail(res, 429, 'Du hast heute schon viele neue Gespräche begonnen – versuche es morgen wieder'); return false; }
    }
    return true;
  }
  const store = (from, to, text, st, sid) => Number(db.prepare('INSERT INTO dm_messages(sender_id,recipient_id,body_enc,share_type,share_id,created_at) VALUES(?,?,?,?,?,?)').run(from, to, box.encrypt(text), st || null, sid || null, now()).lastInsertRowid);

  function present(m, meId) {
    let text = '';
    try { text = box.decrypt(m.body_enc); } catch { text = '(nicht lesbar)'; }
    const out = { id: m.id, mine: m.sender_id === meId, text, created_at: m.created_at, read: !!m.read_at };
    if (m.share_type) {
      const t = m.share_type === 'thread'
        ? db.prepare('SELECT id, title, deleted FROM threads WHERE id = ?').get(m.share_id)
        : db.prepare('SELECT c.id, c.thread_id, substr(c.body,1,80) title, c.deleted FROM comments c WHERE c.id = ?').get(m.share_id);
      out.share = t && !t.deleted ? { type: m.share_type, id: m.share_id, thread_id: m.share_type === 'thread' ? t.id : t.thread_id, title: t.title } : { type: m.share_type, gone: true };
    }
    return out;
  }

  // Übersicht: Gespräche mit letzter Nachricht und Ungelesen-Zähler
  GET('/api/dm', requireUser, (req, res) => {
    const me = req.user.id;
    const rows = db.prepare(`SELECT CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END other, MAX(id) last_id, SUM(recipient_id = ? AND read_at IS NULL) unread
      FROM dm_messages WHERE sender_id = ? OR recipient_id = ? GROUP BY other ORDER BY last_id DESC LIMIT 50`).all(me, me, me, me);
    const list = rows.map((r) => {
      const o = db.prepare('SELECT id, username, avatar, xp, deleted FROM users WHERE id = ?').get(r.other);
      const last = db.prepare('SELECT * FROM dm_messages WHERE id = ?').get(r.last_id);
      const p = present(last, me);
      return { user: o && !o.deleted ? pub(o) : { username: 'Gelöschter Nutzer', avatar: null, rank: null, deleted: true }, unread: r.unread || 0,
        preview: p.share ? '🔗 ' + (p.share.title || 'Geteilter Beitrag') : p.text.slice(0, 60), last_at: last.created_at, mine: p.mine };
    });
    send(res, 200, { conversations: list, blocked: db.prepare('SELECT u.username FROM dm_blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ?').all(me).map((x) => x.username) });
  });

  GET('/api/dm/unread', requireUser, (req, res) => send(res, 200, { unread: db.prepare('SELECT COUNT(*) n FROM dm_messages WHERE recipient_id = ? AND read_at IS NULL').get(req.user.id).n }));

  // Nutzer suchen (für Teilen/Neue Nachricht): Präfix-Suche, nie die eigene Person
  GET('/api/dm/users', requireUser, rl('dmusers', 60, 60_000), (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const me = req.user.id;
    const recent = db.prepare(`SELECT DISTINCT CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END o FROM dm_messages WHERE sender_id = ? OR recipient_id = ? ORDER BY id DESC LIMIT 6`).all(me, me, me)
      .map((r) => db.prepare("SELECT id, username, avatar, xp FROM users WHERE id = ? AND deleted = 0 AND status <> 'gebannt'").get(r.o)).filter(Boolean);
    const found = q.length >= 2 ? db.prepare("SELECT id, username, avatar, xp FROM users WHERE name_lc LIKE ? AND id <> ? AND deleted = 0 AND status <> 'gebannt' ORDER BY xp DESC LIMIT 8").all(q + '%', me) : [];
    send(res, 200, { recent: recent.map(pub), found: found.map(pub) });
  });

  GET('/api/dm/:name', requireUser, (req, res) => {
    const o = userByName(req.params.name);
    if (!o) return fail(res, 404, 'Nutzer nicht gefunden');
    const me = req.user.id;
    const rows = db.prepare('SELECT * FROM (SELECT * FROM dm_messages WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?) ORDER BY id DESC LIMIT 100) ORDER BY id').all(me, o.id, o.id, me);
    db.prepare('UPDATE dm_messages SET read_at = ? WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL').run(now(), me, o.id);
    send(res, 200, { user: pub(o), messages: rows.map((m) => present(m, me)), blocked: blocked(me, o.id) });
  });

  POST('/api/dm/share', rl('dm', 30, 60_000), ...dmGate, jsonBody, (req, res) => {
    const o = userByName(req.body.to);
    if (!canSendTo(req, res, o)) return;
    const type = req.body.type === 'comment' ? 'comment' : 'thread', id = num(req.body.id);
    const ok = type === 'thread' ? db.prepare('SELECT 1 FROM threads WHERE id = ? AND deleted = 0').get(id) : db.prepare('SELECT 1 FROM comments WHERE id = ? AND deleted = 0').get(id);
    if (!ok) return fail(res, 400, 'Beitrag nicht gefunden');
    store(req.user.id, o.id, clean(req.body.note || '', 300), type, id);
    send(res, 201, { ok: true });
  });

  POST('/api/dm/block', ...dmGate.slice(0, 1), jsonBody, (req, res) => {
    const o = userByName(req.body.name);
    if (!o || o.id === req.user.id) return fail(res, 400, 'Nicht möglich');
    db.prepare('INSERT OR IGNORE INTO dm_blocks VALUES(?,?,?)').run(req.user.id, o.id, now());
    send(res, 200, { ok: true });
  });
  DEL('/api/dm/block/:name', requireUser, (req, res) => {
    const o = userByName(req.params.name);
    if (o) db.prepare('DELETE FROM dm_blocks WHERE user_id = ? AND blocked_id = ?').run(req.user.id, o.id);
    send(res, 200, { ok: true });
  });

  POST('/api/dm/:name', rl('dm', 30, 60_000), ...dmGate, jsonBody, (req, res) => {
    const o = userByName(req.params.name);
    if (!canSendTo(req, res, o)) return;
    const body = clean(req.body.body, 2000);
    if (!body) return fail(res, 400, 'Nachricht ist leer');
    store(req.user.id, o.id, body);
    send(res, 201, { ok: true });
  });
  return {};
};
