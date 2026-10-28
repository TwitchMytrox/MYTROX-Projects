/* Credit-Wirtschaft: feste Gesamtmenge, Staatskonto, Tageslimit, Buchungsprotokoll, Wochen-Lostopf.
   Credits entstehen nie aus dem Nichts: Belohnungen kommen aus dem Staatskonto, Gebühren fließen zurück. */
const crypto = require('node:crypto');

module.exports = function init(ctx, acc) {
  const { db, now, getSetting, setSetting, GET, POST, PUT, send, fail, jsonBody, audit } = ctx;
  const DAY = 86_400_000;
  const TOTAL = 11_000_000_000;

  db.exec(`
    CREATE TABLE IF NOT EXISTS credit_tx (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_ctx_user ON credit_tx(user_id, created_at);
    CREATE TABLE IF NOT EXISTS lottery_tickets (week TEXT NOT NULL, user_id INTEGER NOT NULL, paid INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(week, user_id));
    CREATE TABLE IF NOT EXISTS lottery_draws (week TEXT PRIMARY KEY, winner_id INTEGER, amount INTEGER NOT NULL, tickets INTEGER NOT NULL, created_at INTEGER NOT NULL);
  `);

  const int = (k, d) => { const v = parseInt(getSetting(k, String(d)), 10); return Number.isFinite(v) ? v : d; };
  const total = () => int('eco_total', TOTAL);
  // Erststart: das Staatskonto ist die Gesamtmenge minus alles, was schon im Umlauf ist
  if (getSetting('eco_treasury', '') === '') {
    const inCirc = db.prepare('SELECT COALESCE(SUM(credits),0) n FROM users').get().n;
    setSetting('eco_treasury', String(Math.max(0, total() - inCirc)));
  }
  const treasury = () => int('eco_treasury', 0);
  const setTreasury = (n) => setSetting('eco_treasury', String(Math.max(0, Math.trunc(n))));
  const pot = () => int('lottery_pot', 0);
  const setPot = (n) => setSetting('lottery_pot', String(Math.max(0, Math.trunc(n))));

  const EARN_DEFAULT = { login: 2, thread: 7, comment: 4, reaction: 3 };
  const earnTable = () => { try { return { ...EARN_DEFAULT, ...JSON.parse(getSetting('eco_earn', '{}')) }; } catch { return { ...EARN_DEFAULT }; } };
  const dailyCap = () => int('eco_daily_cap', 20);
  const lotMin = () => int('lottery_min', 50);

  const log = db.prepare('INSERT INTO credit_tx(user_id,delta,kind,ref,created_at) VALUES(?,?,?,?,?)');
  const EARN_KINDS = Object.keys(EARN_DEFAULT).map((k) => 'earn_' + k);

  // Aus dem Staatskonto an ein Mitglied (so viel, wie das Konto hergibt). Gibt den gezahlten Betrag zurück.
  function pay(userId, amount, kind, ref = '') {
    amount = Math.min(Math.trunc(amount), treasury());
    if (amount <= 0) return 0;
    setTreasury(treasury() - amount);
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(amount, userId);
    log.run(userId, amount, kind, String(ref), now());
    return amount;
  }
  // Vom Mitglied abbuchen (zahlt NIEMANDEM direkt; der Aufrufer legt den Betrag selbst irgendwohin). false = zu wenig Guthaben.
  function charge(userId, amount, kind, ref = '') {
    amount = Math.trunc(amount);
    const r = db.prepare('UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?').run(amount, userId, amount);
    if (!r.changes) return false;
    log.run(userId, -amount, kind, String(ref), now());
    return true;
  }
  // Auszahlung aus Treuhand (Turnier-Fonds, Rückerstattung): kommt nicht aus dem Staatskonto
  function give(userId, amount, kind, ref = '') {
    amount = Math.trunc(amount); if (amount <= 0) return 0;
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(amount, userId);
    log.run(userId, amount, kind, String(ref), now());
    return amount;
  }
  const toTreasury = (n) => setTreasury(treasury() + Math.trunc(n));

  // Belohnung für Aktivität (Tageslimit, rollierende 24 h)
  function reward(userId, kind, ref) {
    const want = earnTable()[kind] || 0;
    if (!want) return 0;
    const got = db.prepare(`SELECT COALESCE(SUM(delta),0) n FROM credit_tx WHERE user_id = ? AND kind IN (${EARN_KINDS.map(() => '?').join(',')}) AND created_at > ?`).get(userId, ...EARN_KINDS, now() - DAY).n;
    const room = Math.max(0, dailyCap() - got);
    return pay(userId, Math.min(want, room), 'earn_' + kind, ref);
  }
  // Team-Korrektur
  function adjust(userId, delta, reason) {
    delta = Math.trunc(delta);
    if (delta > 0) return pay(userId, delta, 'admin', reason);
    const cur = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;
    const take = Math.min(-delta, cur);
    if (take > 0 && charge(userId, take, 'admin', reason)) { toTreasury(take); return -take; }
    return 0;
  }

  // ---- Lostopf ----
  const weekKey = (t = now()) => { const d = new Date(t); const dn = (d.getUTCDay() + 6) % 7; const th = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dn + 3)); const y = th.getUTCFullYear(); const w = 1 + Math.round(((th - Date.UTC(y, 0, 4)) / DAY - 3 + ((new Date(Date.UTC(y, 0, 4)).getUTCDay() + 6) % 7)) / 7); return `${y}-W${String(w).padStart(2, '0')}`; };
  const ticketPrice = () => Math.max(lotMin(), Math.floor(pot() * 0.2));

  function draw(week = weekKey(), force = false) {
    if (db.prepare('SELECT 1 FROM lottery_draws WHERE week = ?').get(week)) return null;
    const rows = db.prepare('SELECT t.user_id, t.paid FROM lottery_tickets t JOIN users u ON u.id = t.user_id WHERE t.week = ? AND u.deleted = 0 AND u.status <> \'gebannt\'').all(week);
    if (!rows.length) { if (force) db.prepare('INSERT INTO lottery_draws VALUES(?,?,?,?,?)').run(week, null, 0, 0, now()); return null; }
    const sum = rows.reduce((s, r) => s + r.paid, 0);
    let pick = crypto.randomInt(sum), winner = rows[0];
    for (const r of rows) { if (pick < r.paid) { winner = r; break; } pick -= r.paid; }
    const amount = pot(); setPot(0);
    // Lostopf liegt außerhalb des Staatskontos: direkt gutschreiben
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(amount, winner.user_id);
    log.run(winner.user_id, amount, 'lottery_win', week, now());
    db.prepare('INSERT INTO lottery_draws VALUES(?,?,?,?,?)').run(week, winner.user_id, amount, rows.length, now());
    return { winner: winner.user_id, amount, tickets: rows.length };
  }
  // sonntags ab 18:00 (Serverzeit) einmal pro Woche
  const tick = () => { const d = new Date(); if (d.getDay() === 0 && d.getHours() >= 18) draw(); };
  const iv = setInterval(tick, 60_000); iv.unref();

  GET('/api/lottery', (req, res) => {
    const w = weekKey(), last = db.prepare('SELECT d.*, u.username FROM lottery_draws d LEFT JOIN users u ON u.id = d.winner_id WHERE d.winner_id IS NOT NULL ORDER BY d.created_at DESC LIMIT 1').get();
    send(res, 200, { pot: pot(), price: ticketPrice(), week: w, tickets: db.prepare('SELECT COUNT(*) n FROM lottery_tickets WHERE week = ?').get(w).n,
      mine: req.user ? !!db.prepare('SELECT 1 FROM lottery_tickets WHERE week = ? AND user_id = ?').get(w, req.user.id) : false,
      last: last ? { winner: last.username, amount: last.amount, week: last.week } : null, rule: 'Ziehung jeden Sonntag ab 18 Uhr. Der Gewinner bekommt den ganzen Topf.' });
  });
  POST('/api/lottery/ticket', acc.requireUser, jsonBody, (req, res) => {
    const w = weekKey(), price = ticketPrice();
    if (db.prepare('SELECT 1 FROM lottery_tickets WHERE week = ? AND user_id = ?').get(w, req.user.id)) return fail(res, 400, 'Du bist diese Woche schon dabei');
    if (!charge(req.user.id, price, 'lottery_ticket', w)) return fail(res, 400, `Dir fehlen Credits (Los kostet ${price})`);
    setPot(pot() + price);
    db.prepare('INSERT INTO lottery_tickets VALUES(?,?,?,?)').run(w, req.user.id, price, now());
    send(res, 201, { ok: true, pot: pot() });
  });

  // ---- Admin ----
  const perm = acc.requirePerm('settings.edit');
  GET('/api/admin/economy', perm, (req, res) => {
    const circ = db.prepare('SELECT COALESCE(SUM(credits),0) n FROM users').get().n;
    send(res, 200, { total: total(), treasury: treasury(), circulation: circ, lottery_pot: pot(), escrow: Math.max(0, total() - treasury() - circ - pot()), daily_cap: dailyCap(), earn: earnTable(), lottery_min: lotMin(),
      recent: db.prepare('SELECT t.*, u.username FROM credit_tx t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.id DESC LIMIT 30').all() });
  });
  PUT('/api/admin/economy', perm, jsonBody, (req, res) => {
    const b = req.body, c = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(Number(v) || 0)));
    if ('daily_cap' in b) setSetting('eco_daily_cap', String(c(b.daily_cap, 0, 100000)));
    if ('lottery_min' in b) setSetting('lottery_min', String(c(b.lottery_min, 1, 1000000)));
    if (b.earn && typeof b.earn === 'object') { const e = {}; for (const k of Object.keys(EARN_DEFAULT)) if (k in b.earn) e[k] = c(b.earn[k], 0, 10000); setSetting('eco_earn', JSON.stringify({ ...earnTable(), ...e })); }
    audit(req.admin.username, 'economy_update', Object.keys(b).join(', '));
    send(res, 200, { ok: true });
  });
  POST('/api/admin/economy/draw', perm, jsonBody, (req, res) => { const r = draw(weekKey(), true); audit(req.admin.username, 'lottery_draw', r ? `${r.amount}` : 'keine Lose'); send(res, 200, { result: r }); });

  const eco = { give, treasury, pay, charge, toTreasury, reward, adjust, pot, setPot, total, draw, weekKey };
  ctx.eco = eco;
  return eco;
};
