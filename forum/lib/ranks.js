/* Ränge, Erfahrungspunkte (XP), Credits, Abzeichen – mit Anti-Farming. */
const { RANKS, rankOf, BADGES } = require('./rankdata');

module.exports = function init(ctx, acc) {
  const { db, now, GET, POST, send, fail, num, jsonBody, audit } = ctx;
  const { requireUser, requirePerm, readGate } = acc;
  const DAY = 86_400_000;

  db.exec(`
    CREATE TABLE IF NOT EXISTS xp_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '',
      amount INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(user_id, kind, ref)
    );
    CREATE INDEX IF NOT EXISTS idx_xp_user_time ON xp_events(user_id, created_at);
    CREATE TABLE IF NOT EXISTS user_badges (user_id INTEGER NOT NULL, badge TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id, badge));
  `);

  // Regeln: Tageslimit (rolling 24h) und XP je Ereignis
  const RULES = {
    thread: { xp: 10, perDay: 5 },
    comment: { xp: 3, perDay: 20 },
    reaction: { xp: 1, perDay: 30 },
    login: { xp: 5, perDay: 1 },
  };

  const countSince = db.prepare('SELECT COUNT(*) n FROM xp_events WHERE user_id = ? AND kind = ? AND amount > 0 AND created_at > ?');
  const insEvt = db.prepare('INSERT OR IGNORE INTO xp_events(user_id,kind,ref,amount,created_at) VALUES(?,?,?,?,?)');

  const stats = (u) => ({
    threads: db.prepare('SELECT COUNT(*) n FROM threads WHERE user_id = ? AND deleted = 0').get(u.id).n,
    comments: db.prepare('SELECT COUNT(*) n FROM comments WHERE user_id = ? AND deleted = 0').get(u.id).n,
    reactions_got: db.prepare("SELECT COUNT(*) n FROM xp_events WHERE user_id = ? AND kind = 'reaction'").get(u.id).n,
    days: Math.floor((now() - u.created_at) / DAY),
    totp: !!u.totp_on || db.prepare('SELECT 1 FROM webauthn_keys WHERE user_id = ?').get(u.id) != null,
  });

  function checkBadges(userId) {
    const u = db.prepare('SELECT id, created_at, totp_on FROM users WHERE id = ?').get(userId);
    if (!u) return [];
    const s = stats(u), have = new Set(db.prepare('SELECT badge FROM user_badges WHERE user_id = ?').all(userId).map((r) => r.badge));
    const got = [];
    for (const b of BADGES) if (!have.has(b.key) && b.need(s)) { db.prepare('INSERT OR IGNORE INTO user_badges VALUES(?,?,?)').run(userId, b.key, now()); got.push({ key: b.key, icon: b.icon, name: b.name }); }
    return got;
  }

  // Grundfunktion: vergibt XP+Credits, wenn Regeln es erlauben. Gibt {xp, rank_up, badges} zurück.
  function grant(userId, kind, ref, amount) {
    const rule = RULES[kind];
    if (!userId || !rule) return null;
    amount = amount ?? rule.xp;
    if (countSince.get(userId, kind, now() - DAY).n >= rule.perDay) return null;
    const r = insEvt.run(userId, kind, String(ref), amount, now());
    if (!r.changes) return null; // dasselbe Ereignis schon belohnt (z. B. Reaktion an/aus/an)
    const before = rankOf(db.prepare('SELECT xp FROM users WHERE id = ?').get(userId).xp);
    db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(amount, userId);
    if (ctx.eco) ctx.eco.reward(userId, kind, ref); // Credits kommen aus dem Staatskonto (Tageslimit)
    const after = rankOf(before.xp + amount);
    return { xp: amount, rank_up: after.index > before.index ? { name: after.name, icon: after.icon } : null, badges: checkBadges(userId) };
  }

  // ---- Hooks (vom Server aufgerufen) ----
  function onThread(user, tid, title, body) {
    if (!user || title.length + body.length < 30) return null;
    return grant(user.id, 'thread', tid);
  }
  function onComment(user, cid, threadId, body) {
    if (!user || body.length < 15) return null;
    const last = db.prepare('SELECT body FROM comments WHERE user_id = ? AND id <> ? ORDER BY id DESC LIMIT 20').all(user.id, cid);
    if (last.some((c) => c.body === body)) return null; // Wiederholungen zählen nicht
    // Pro Thread und Tag höchstens 5 belohnte Kommentare
    const perThread = db.prepare("SELECT COUNT(*) n FROM xp_events e JOIN comments c ON e.kind='comment' AND e.ref = CAST(c.id AS TEXT) WHERE e.user_id = ? AND c.thread_id = ? AND e.created_at > ?").get(user.id, threadId, now() - DAY).n;
    if (perThread >= 5) return null;
    return grant(user.id, 'comment', cid);
  }
  function onReaction(giver, type, id) {
    if (!giver) return;
    const t = type === 'thread' ? db.prepare('SELECT user_id FROM threads WHERE id = ?').get(id) : db.prepare('SELECT user_id FROM comments WHERE id = ?').get(id);
    if (!t || !t.user_id || t.user_id === giver.id) return; // Selbst-Likes zählen nicht
    if (now() - giver.created_at < DAY) return; // frische Konten (Mehrfachkonten) zählen nicht
    // Pro Geber → Autor höchstens 3 XP pro Tag
    const pair = db.prepare("SELECT COUNT(*) n FROM xp_events WHERE user_id = ? AND kind = 'reaction' AND ref LIKE ? AND created_at > ?").get(t.user_id, `${giver.id}:%`, now() - DAY).n;
    if (pair >= 3) return;
    grant(t.user_id, 'reaction', `${giver.id}:${type}:${id}`);
  }
  function onLogin(userId) { return grant(userId, 'login', new Date().toISOString().slice(0, 10)); }

  // ---- Darstellung ----
  function progress(u) {
    const earned = new Map(db.prepare('SELECT badge, created_at FROM user_badges WHERE user_id = ?').all(u.id).map((r) => [r.badge, r.created_at]));
    return {
      xp: u.xp || 0, credits: u.credits || 0, rank: rankOf(u.xp || 0),
      badges: BADGES.map((b) => ({ key: b.key, icon: b.icon, name: b.name, desc: b.desc, earned_at: earned.get(b.key) || null })),
    };
  }

  GET('/api/ranks', (req, res) => send(res, 200, { ranks: RANKS, badges: BADGES.map(({ key, icon, name, desc }) => ({ key, icon, name, desc })), rules: RULES }));
  GET('/api/account/progress', requireUser, (req, res) => {
    checkBadges(req.user.id);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    send(res, 200, { ...progress(u), recent: db.prepare('SELECT kind, amount, created_at FROM xp_events WHERE user_id = ? ORDER BY id DESC LIMIT 15').all(u.id) });
  });
  GET('/api/leaderboard', readGate, (req, res) => {
    const rows = db.prepare("SELECT u.username, u.avatar, u.xp, r.name r_name, r.color r_color FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.deleted = 0 AND u.status <> 'gebannt' ORDER BY u.xp DESC, u.id LIMIT 20").all();
    send(res, 200, { rows: rows.map((r) => ({ username: r.username, avatar: r.avatar ? '/avatars/' + r.avatar : null, xp: r.xp, rank: rankOf(r.xp), role: r.r_name ? { name: r.r_name, color: r.r_color } : null })) });
  });

  // Team: XP/Credits korrigieren (z. B. bei Missbrauch)
  POST('/api/admin/users/:id/xp', requirePerm('users.status'), jsonBody, (req, res) => {
    const u = db.prepare('SELECT id, username, xp FROM users WHERE id = ? AND deleted = 0').get(num(req.params.id));
    if (!u) return fail(res, 404, 'Nutzer nicht gefunden');
    const delta = Math.max(-100000, Math.min(100000, Math.trunc(Number(req.body.delta) || 0)));
    if (!delta) return fail(res, 400, 'Änderung fehlt');
    const to = Math.max(0, u.xp + delta);
    db.prepare('UPDATE users SET xp = ? WHERE id = ?').run(to, u.id);
    if (ctx.eco) ctx.eco.adjust(u.id, delta, String(req.body.reason || '').slice(0, 100));
    db.prepare('INSERT INTO xp_events(user_id,kind,ref,amount,created_at) VALUES(?,?,?,?,?)').run(u.id, 'admin', String(now()), delta, now());
    audit(req.admin.username, 'xp_adjust', `${u.username} ${delta > 0 ? '+' : ''}${delta} (${String(req.body.reason || '').slice(0, 100)})`);
    send(res, 200, { xp: to, rank: rankOf(to) });
  });

  return { onThread, onComment, onReaction, onLogin, progress, checkBadges, rankOf };
};
