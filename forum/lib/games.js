/* Spiele: Blackjack, Slots, Roulette (Glücksspiel mit Spielwährung) und Reaktionstest, Memory, Snake (Geschicklichkeit).
   Regeln, die alles zusammenhalten:
   - Credits haben KEINEN Geldwert, sind nicht kaufbar und nicht auszahlbar (nur gegen Extras im Spiel einlösbar).
   - Einsätze und Gebühren fließen ans Staatskonto, Gewinne werden daraus bezahlt (die Gesamtmenge bleibt konstant).
   - Der Server würfelt/mischt und prüft alles nach – der Browser zeigt nur an.
   - Bestenliste pro Woche, Top-10-Rang mit kleinem Wochenbonus (gedeckelt), Hall of Fame. */
const crypto = require('node:crypto');
const Snake = require('../public/js/snake-sim.js');

module.exports = function init(ctx, acc) {
  const { db, now, getSetting, setSetting, GET, POST, PUT, send, fail, jsonBody, rl, audit } = ctx;
  const { requireUser, requirePerm, postGate } = acc;
  const eco = ctx.eco;
  const DAY = 86_400_000;

  db.exec(`
    CREATE TABLE IF NOT EXISTS game_consent (user_id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS game_prefs (user_id INTEGER PRIMARY KEY, hidden INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS game_sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, game TEXT NOT NULL, state TEXT NOT NULL, stake INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_gs_user ON game_sessions(user_id, game, status);
    CREATE TABLE IF NOT EXISTS game_rounds (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, game TEXT NOT NULL, week TEXT NOT NULL, net INTEGER NOT NULL DEFAULT 0, score INTEGER, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_gr_week ON game_rounds(week, game, user_id);
    CREATE TABLE IF NOT EXISTS game_top10 (week TEXT NOT NULL, place INTEGER NOT NULL, user_id INTEGER NOT NULL, bonus INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, PRIMARY KEY(week, place));
  `);

  // ---------- Einstellungen (alles im Admin änderbar) ----------
  const int = (k, d) => { const v = parseInt(getSetting(k, String(d)), 10); return Number.isFinite(v) ? v : d; };
  const BONUS_DEFAULT = [100, 70, 50, 40, 30, 25, 20, 15, 10, 5];
  const bonusList = () => { try { const a = JSON.parse(getSetting('g_bonus', '')); if (Array.isArray(a) && a.length) return a.slice(0, 10).map((n) => Math.max(0, Math.trunc(Number(n) || 0))); } catch { /* Standard */ } return BONUS_DEFAULT; };
  const cfg = () => ({
    fee: int('g_fee', 10), bet_min: int('g_bet_min', 10), bet_max: int('g_bet_max', 300), bj_fee_pct: int('g_bj_fee_pct', 5), bj_fee_min: int('g_bj_fee_min', 5),
    loss_cap: int('g_loss_cap', 1000), prize_cap: int('g_prize_cap', 100), min_rounds: int('g_min_rounds', 10), bonus: bonusList(), bonus_cap: int('g_bonus_cap', 500),
    prizes: { reaction: [int('g_p_react_hi', 25), int('g_p_react_lo', 15)], memory: [int('g_p_mem_hi', 25), int('g_p_mem_lo', 15)], snake: [int('g_p_snake_hi', 25), int('g_p_snake_lo', 15)] },
  });
  const GAMBLING = ['blackjack', 'slots', 'roulette'];
  const MINI = ['reaction', 'memory', 'snake'];
  const NAMES = { blackjack: 'Blackjack', slots: 'Slots', roulette: 'Roulette', reaction: 'Reaktionstest', memory: 'Memory', snake: 'Snake' };

  // ---------- Hilfen ----------
  const rnd = (n) => crypto.randomInt(n);
  const newId = () => crypto.randomBytes(12).toString('hex');
  const week = () => eco.weekKey();
  // Team (Admin/Moderation) spielt mit unbegrenztem Spielgeld: es wird nichts abgebucht, nichts aus dem Staatskonto gezahlt,
  // und es landet nichts in Bestenlisten oder Statistik. So kann das Team alles testen, ohne echte Credits zu bewegen.
  const UNLIMITED = 999999999;
  const isStaff = (id) => { try { const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id); return !!u && acc.isTeam(acc.hydrate(u)); } catch { return false; } };
  const credits = (id) => (isStaff(id) ? UNLIMITED : (db.prepare('SELECT credits FROM users WHERE id = ?').get(id) || {}).credits || 0);
  const gcharge = (uid, amt, kind, ref) => (isStaff(uid) ? true : eco.charge(uid, amt, kind, ref));
  const gpay = (uid, amt, kind, ref) => (isStaff(uid) ? Math.max(0, Math.trunc(amt)) : eco.pay(uid, amt, kind, ref));
  const gtreas = (uid, amt) => { if (!isStaff(uid)) eco.toTreasury(amt); };
  const hasConsent = (id) => !!db.prepare('SELECT 1 FROM game_consent WHERE user_id = ?').get(id);
  const isHidden = (id) => !!(db.prepare('SELECT hidden FROM game_prefs WHERE user_id = ?').get(id) || {}).hidden;
  const GAMBLE_KINDS = GAMBLING.flatMap((g) => ['bet_' + g, 'win_' + g]).concat(['fee_blackjack']);
  const PRIZE_KINDS = MINI.map((g) => 'prize_' + g);
  const sumKinds = (uid, kinds) => db.prepare(`SELECT COALESCE(SUM(delta),0) n FROM credit_tx WHERE user_id = ? AND created_at > ? AND kind IN (${kinds.map(() => '?').join(',')})`).get(uid, now() - DAY, ...kinds).n;
  const lossToday = (uid) => Math.max(0, -sumKinds(uid, GAMBLE_KINDS));
  const prizeToday = (uid) => sumKinds(uid, PRIZE_KINDS);
  const addRound = (uid, game, net, score) => isStaff(uid) ? null : db.prepare('INSERT INTO game_rounds(user_id,game,week,net,score,created_at) VALUES(?,?,?,?,?,?)').run(uid, game, week(), net, score == null ? null : score, now());

  // Gate für alle Spiel-Aktionen: Konto, Zustimmung, Konto-Status
  const play = [rl('game', 150, 60_000), requireUser, postGate('game'), jsonBody, (req, res, next) => {
    if (!hasConsent(req.user.id)) return send(res, 403, { error: 'Bitte bestätige zuerst die Spielregeln (ab 18, Credits ohne Geldwert).', code: 'CONSENT' });
    next();
  }];

  // Einsatz prüfen und abbuchen (Glücksspiel). extraFee wird zusätzlich ans Staatskonto gezahlt.
  function takeBet(req, res, game, stakeRaw, feeFn) {
    const c = cfg(), stake = Math.trunc(Number(stakeRaw));
    if (!Number.isFinite(stake) || stake < c.bet_min || stake > c.bet_max) { fail(res, 400, `Einsatz: ${c.bet_min} bis ${c.bet_max} Credits`); return null; }
    const fee = feeFn ? feeFn(stake, c) : 0;
    if (credits(req.user.id) < stake + fee) { fail(res, 400, `Dir fehlen Credits (Einsatz ${stake}${fee ? ` + Gebühr ${fee}` : ''})`); return null; }
    if (lossToday(req.user.id) + stake + fee > c.loss_cap) { send(res, 400, { error: `Tages-Verlustlimit erreicht (${c.loss_cap} Credits in 24 Stunden). Mach eine Pause – morgen geht es weiter.`, code: 'LOSS_CAP' }); return null; }
    if (!gcharge(req.user.id, stake, 'bet_' + game, game)) { fail(res, 400, 'Dir fehlen Credits'); return null; }
    gtreas(req.user.id, stake);
    if (fee) { gcharge(req.user.id, fee, 'fee_' + game, game); gtreas(req.user.id, fee); }
    return { stake, fee };
  }
  const payout = (uid, game, amount) => (amount > 0 ? gpay(uid, amount, 'win_' + game, game) : 0);

  // ---------- Slots ----------
  const SYM = [['🍒', 30], ['🍋', 25], ['🔔', 18], ['⭐', 12], ['💎', 6], ['7️⃣', 3]];
  const SYM_TOTAL = SYM.reduce((s, x) => s + x[1], 0);
  const PAY3 = { '🍒': 5, '🍋': 9, '🔔': 16, '⭐': 32, '💎': 80, '7️⃣': 220 };
  const PAIR_CHERRY = 2;
  const spinReel = () => { let r = rnd(SYM_TOTAL); for (const [s, w] of SYM) { if (r < w) return s; r -= w; } return SYM[0][0]; };
  const slotMult = (a, b, c) => {
    if (a === b && b === c) return PAY3[a];
    return [a, b, c].filter((x) => x === '🍒').length === 2 ? PAIR_CHERRY : 0;
  };
  const slotsRtp = () => { let rtp = 0; for (const [a, wa] of SYM) for (const [b, wb] of SYM) for (const [c, wc] of SYM) rtp += (wa * wb * wc) / SYM_TOTAL ** 3 * slotMult(a, b, c); return rtp; };

  POST('/api/games/slots/spin', ...play, (req, res) => {
    const bet = takeBet(req, res, 'slots', req.body.bet); if (!bet) return;
    const reels = [spinReel(), spinReel(), spinReel()], mult = slotMult(...reels);
    const won = payout(req.user.id, 'slots', bet.stake * mult);
    addRound(req.user.id, 'slots', won - bet.stake, null);
    send(res, 200, { reels, mult, won, net: won - bet.stake, credits: credits(req.user.id) });
  });

  // ---------- Roulette (europäisch, eine Null) ----------
  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  function rouletteWin(n, type, value) {
    switch (type) {
      case 'color': return n !== 0 && (value === 'red') === RED.has(n) ? 2 : 0;
      case 'parity': return n !== 0 && (value === 'even') === (n % 2 === 0) ? 2 : 0;
      case 'half': return n !== 0 && (value === 'low' ? n <= 18 : n >= 19) ? 2 : 0;
      case 'dozen': return n !== 0 && Math.ceil(n / 12) === Number(value) ? 3 : 0;
      case 'number': return n === Number(value) ? 36 : 0;
      default: return 0;
    }
  }
  const validBet = (type, v) => (type === 'color' && ['red', 'black'].includes(v)) || (type === 'parity' && ['even', 'odd'].includes(v)) || (type === 'half' && ['low', 'high'].includes(v))
    || (type === 'dozen' && [1, 2, 3].includes(Number(v))) || (type === 'number' && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 36 && v !== '' && v !== null);
  POST('/api/games/roulette/spin', ...play, (req, res) => {
    const { type, value } = req.body;
    if (!validBet(type, value)) return fail(res, 400, 'Ungültige Wette');
    const bet = takeBet(req, res, 'roulette', req.body.bet); if (!bet) return;
    const n = rnd(37), mult = rouletteWin(n, type, value);
    const won = payout(req.user.id, 'roulette', bet.stake * mult);
    addRound(req.user.id, 'roulette', won - bet.stake, null);
    send(res, 200, { number: n, color: n === 0 ? 'green' : RED.has(n) ? 'red' : 'black', mult, won, net: won - bet.stake, credits: credits(req.user.id) });
  });

  // ---------- Blackjack ----------
  const SUITS = ['♠', '♥', '♦', '♣'], RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = () => { const d = []; for (const s of SUITS) for (const r of RANKS) d.push(r + s); for (let i = d.length - 1; i > 0; i--) { const j = rnd(i + 1); [d[i], d[j]] = [d[j], d[i]]; } return d; };
  const cardVal = (c) => { const r = c.slice(0, -1); return r === 'A' ? 11 : ['J', 'Q', 'K'].includes(r) ? 10 : Number(r); };
  function total(hand) { let t = 0, aces = 0; for (const c of hand) { t += cardVal(c); if (c.startsWith('A')) aces++; } while (t > 21 && aces) { t -= 10; aces--; } return t; }
  const isBJ = (h) => h.length === 2 && total(h) === 21;
  const bjFee = (stake, c) => Math.max(c.bj_fee_min, Math.round((stake * c.bj_fee_pct) / 100));

  function bjView(row, st, done, result) {
    const v = { id: row.id, stake: row.stake, player: st.player, player_total: total(st.player), dealer: done ? st.dealer : [st.dealer[0], '??'], dealer_total: done ? total(st.dealer) : cardVal(st.dealer[0]) === 11 ? 11 : cardVal(st.dealer[0]), done, can_double: !done && st.player.length === 2 && !st.doubled };
    if (done) Object.assign(v, result);
    return v;
  }
  function bjFinish(row, st, userId) {
    // Dealer zieht bis 17 (auch bei weichen 17 bleibt er stehen)
    const pt = total(st.player);
    if (pt <= 21) while (total(st.dealer) < 17) st.dealer.push(st.deck.pop());
    const dt = total(st.dealer);
    let back = 0, outcome;
    if (pt > 21) outcome = 'bust';
    else if (isBJ(st.player) && !isBJ(st.dealer) && !st.doubled) { back = Math.floor(row.stake * 2.5); outcome = 'blackjack'; }
    else if (isBJ(st.dealer) && !isBJ(st.player)) outcome = 'lose';
    else if (dt > 21 || pt > dt) { back = row.stake * 2; outcome = 'win'; }
    else if (pt === dt) { back = row.stake; outcome = 'push'; }
    else outcome = 'lose';
    const won = payout(userId, 'blackjack', back);
    const net = won - row.stake - (st.fee || 0);
    addRound(userId, 'blackjack', net, null);
    db.prepare("UPDATE game_sessions SET state = ?, status = 'done', updated_at = ? WHERE id = ?").run(JSON.stringify(st), now(), row.id);
    return { outcome, won, net, credits: credits(userId) };
  }
  const openBj = (uid) => db.prepare("SELECT * FROM game_sessions WHERE user_id = ? AND game = 'blackjack' AND status = 'open' ORDER BY created_at DESC LIMIT 1").get(uid);

  GET('/api/games/blackjack/current', requireUser, (req, res) => {
    const row = openBj(req.user.id);
    if (!row) return send(res, 200, { game: null });
    send(res, 200, { game: bjView(row, JSON.parse(row.state), false) });
  });
  POST('/api/games/blackjack/deal', ...play, (req, res) => {
    let row = openBj(req.user.id);
    if (row) {
      if (now() - row.updated_at > 10 * 60_000) { const st = JSON.parse(row.state); bjFinish(row, st, req.user.id); } // vergessene Runde wird beendet
      else return send(res, 400, { error: 'Du hast noch eine offene Runde.', code: 'OPEN', game: bjView(row, JSON.parse(row.state), false) });
    }
    const bet = takeBet(req, res, 'blackjack', req.body.bet, bjFee); if (!bet) return;
    const d = deck(), st = { deck: d, player: [d.pop(), d.pop()], dealer: [d.pop(), d.pop()], doubled: false, fee: bet.fee };
    const id = newId();
    db.prepare('INSERT INTO game_sessions(id,user_id,game,state,stake,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, req.user.id, 'blackjack', JSON.stringify(st), bet.stake, 'open', now(), now());
    row = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(id);
    if (isBJ(st.player) || isBJ(st.dealer)) return send(res, 200, { game: bjView(row, st, true, bjFinish(row, st, req.user.id)), fee: bet.fee });
    send(res, 200, { game: bjView(row, st, false), fee: bet.fee, credits: credits(req.user.id) });
  });
  POST('/api/games/blackjack/action', ...play, (req, res) => {
    const row = db.prepare("SELECT * FROM game_sessions WHERE id = ? AND user_id = ? AND game = 'blackjack' AND status = 'open'").get(String(req.body.id || ''), req.user.id);
    if (!row) return fail(res, 404, 'Keine offene Runde');
    const st = JSON.parse(row.state), a = req.body.action;
    if (a === 'hit') {
      st.player.push(st.deck.pop());
      if (total(st.player) >= 21) return send(res, 200, { game: bjView(row, st, true, bjFinish(row, st, req.user.id)) });
    } else if (a === 'stand') {
      return send(res, 200, { game: bjView(row, st, true, bjFinish(row, st, req.user.id)) });
    } else if (a === 'double') {
      if (st.player.length !== 2 || st.doubled) return fail(res, 400, 'Verdoppeln geht nur mit den ersten zwei Karten');
      const c = cfg();
      if (lossToday(req.user.id) + row.stake > c.loss_cap) return send(res, 400, { error: 'Tages-Verlustlimit erreicht', code: 'LOSS_CAP' });
      if (!gcharge(req.user.id, row.stake, 'bet_blackjack', 'double')) return fail(res, 400, 'Dir fehlen Credits zum Verdoppeln');
      gtreas(req.user.id, row.stake);
      row.stake *= 2; st.doubled = true; st.player.push(st.deck.pop());
      db.prepare('UPDATE game_sessions SET stake = ? WHERE id = ?').run(row.stake, row.id);
      return send(res, 200, { game: bjView(row, st, true, bjFinish(row, st, req.user.id)) });
    } else return fail(res, 400, 'Unbekannte Aktion');
    db.prepare('UPDATE game_sessions SET state = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(st), now(), row.id);
    send(res, 200, { game: bjView(row, st, false) });
  });

  // ---------- Geschicklichkeitsspiele ----------
  function startMini(req, res, game, state) {
    const c = cfg();
    if (credits(req.user.id) < c.fee) return fail(res, 400, `Dir fehlen Credits (Eintritt ${c.fee})`), null;
    // Alte offene Runden desselben Spiels verfallen (Gebühr bleibt beim Staatskonto)
    db.prepare("UPDATE game_sessions SET status = 'expired' WHERE user_id = ? AND game = ? AND status = 'open'").run(req.user.id, game);
    if (!gcharge(req.user.id, c.fee, 'fee_' + game, game)) return fail(res, 400, 'Dir fehlen Credits'), null;
    gtreas(req.user.id, c.fee);
    const id = newId();
    db.prepare('INSERT INTO game_sessions(id,user_id,game,state,stake,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, req.user.id, game, JSON.stringify(state), c.fee, 'open', now(), now());
    return id;
  }
  const loadMini = (req, res, game) => {
    const row = db.prepare("SELECT * FROM game_sessions WHERE id = ? AND user_id = ? AND game = ? AND status = 'open'").get(String(req.params.id || ''), req.user.id, game);
    if (!row) { fail(res, 404, 'Runde nicht gefunden oder schon beendet'); return null; }
    if (now() - row.created_at > 20 * 60_000) { db.prepare("UPDATE game_sessions SET status = 'expired' WHERE id = ?").run(row.id); fail(res, 400, 'Runde ist abgelaufen'); return null; }
    return row;
  };
  // Preis zahlen (Tageslimit für Preise beachten) und Runde beenden
  function finishMini(row, userId, game, tier, score) {
    const c = cfg(), want = tier === 'hi' ? c.prizes[game][0] : tier === 'lo' ? c.prizes[game][1] : 0;
    const room = Math.max(0, c.prize_cap - prizeToday(userId));
    const prize = want > 0 ? gpay(userId, Math.min(want, room), 'prize_' + game, game) : 0;
    db.prepare("UPDATE game_sessions SET status = 'done', updated_at = ? WHERE id = ?").run(now(), row.id);
    addRound(userId, game, prize - row.stake, score);
    return { prize, wanted: want, capped: want > 0 && prize < want, fee: row.stake, net: prize - row.stake, credits: credits(userId) };
  }

  // Reaktionstest: Server bestimmt die Wartezeit und misst mit seiner Uhr
  POST('/api/games/reaction/start', ...play, (req, res) => {
    const delay = 1500 + rnd(3500);
    const id = startMini(req, res, 'reaction', { delay, at: now() }); if (!id) return;
    send(res, 200, { id, delay, credits: credits(req.user.id) });
  });
  POST('/api/games/reaction/:id/click', ...play, (req, res) => {
    const row = loadMini(req, res, 'reaction'); if (!row) return;
    const st = JSON.parse(row.state), ms = now() - (st.at + st.delay);
    if (ms < 0) return send(res, 200, { ...finishMini(row, req.user.id, 'reaction', null, null), early: true, ms: null });
    if (ms < 100) return send(res, 200, { ...finishMini(row, req.user.id, 'reaction', null, null), suspicious: true, ms });
    const tier = ms < 250 ? 'hi' : ms < 330 ? 'lo' : null;
    send(res, 200, { ...finishMini(row, req.user.id, 'reaction', tier, ms), ms });
  });

  // Memory: der Server kennt die Kartenlage, der Browser sieht nur aufgedeckte Karten
  const EMOJI = ['🎮', '🕹️', '👾', '🏆', '🎯', '⚔️', '🛡️', '🚀', '💣', '🧩', '🎲', '🔥'];
  POST('/api/games/memory/start', ...play, (req, res) => {
    const pick = EMOJI.slice().sort(() => rnd(2) - 0.5).slice(0, 8), cards = pick.concat(pick);
    for (let i = cards.length - 1; i > 0; i--) { const j = rnd(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    const id = startMini(req, res, 'memory', { cards, matched: [], open: null, moves: 0, at: now() }); if (!id) return;
    send(res, 200, { id, cards: 16, credits: credits(req.user.id) });
  });
  POST('/api/games/memory/:id/flip', ...play, (req, res) => {
    const row = loadMini(req, res, 'memory'); if (!row) return;
    const st = JSON.parse(row.state), i = Number(req.body.i);
    if (!Number.isInteger(i) || i < 0 || i > 15 || st.matched.includes(i) || st.open === i) return fail(res, 400, 'Diese Karte geht nicht');
    const out = { i, symbol: st.cards[i] };
    if (st.open === null) { st.open = i; }
    else {
      st.moves++;
      out.first = st.open; out.first_symbol = st.cards[st.open];
      out.match = st.cards[st.open] === st.cards[i];
      if (out.match) st.matched.push(st.open, i);
      st.open = null;
    }
    out.moves = st.moves;
    if (st.matched.length === 16) {
      const secs = (now() - st.at) / 1000;
      const tier = secs < 6 ? null : st.moves <= 12 ? 'hi' : st.moves <= 18 ? 'lo' : null;
      out.done = true; Object.assign(out, finishMini(row, req.user.id, 'memory', tier, st.moves), { seconds: Math.round(secs) });
    } else db.prepare('UPDATE game_sessions SET state = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(st), now(), row.id);
    send(res, 200, out);
  });

  // Snake: Browser schickt nur Richtungswechsel; der Server spielt nach und zählt selbst
  POST('/api/games/snake/start', ...play, (req, res) => {
    const seed = crypto.randomInt(1, 2 ** 31);
    const id = startMini(req, res, 'snake', { seed, at: now() }); if (!id) return;
    send(res, 200, { id, seed, credits: credits(req.user.id) });
  });
  POST('/api/games/snake/:id/finish', ...play, (req, res) => {
    const row = loadMini(req, res, 'snake'); if (!row) return;
    const st = JSON.parse(row.state), ticks = Math.trunc(Number(req.body.ticks)), turns = Array.isArray(req.body.turns) ? req.body.turns.slice(0, 4000) : [];
    if (!Number.isInteger(ticks) || ticks < 1 || ticks > 5000) return fail(res, 400, 'Ungültige Daten');
    const r = Snake.replay(st.seed, turns, ticks);
    const real = now() - st.at;
    if (real < r.ticks * 70) return send(res, 200, { ...finishMini(row, req.user.id, 'snake', null, null), suspicious: true, score: 0 });
    const tier = r.score >= 15 ? 'hi' : r.score >= 8 ? 'lo' : null;
    send(res, 200, { ...finishMini(row, req.user.id, 'snake', tier, r.score), score: r.score });
  });

  // ---------- Bestenlisten ----------
  const SCORE_GAMES = { blackjack: 'net', slots: 'net', roulette: 'net', reaction: 'low', memory: 'low', snake: 'high' };
  const nameOf = (id) => (db.prepare('SELECT username FROM users WHERE id = ? AND deleted = 0').get(id) || {}).username || null;
  function perGame(game, wk) {
    const k = SCORE_GAMES[game];
    const sel = k === 'net' ? 'SUM(net)' : k === 'low' ? 'MIN(score)' : 'MAX(score)';
    const order = k === 'low' ? 'ASC' : 'DESC';
    return db.prepare(`SELECT user_id, ${sel} val, COUNT(*) rounds FROM game_rounds WHERE week = ? AND game = ? ${k === 'net' ? '' : 'AND score IS NOT NULL'} GROUP BY user_id ORDER BY val ${order}, MIN(created_at) LIMIT 100`).all(wk, game);
  }
  // Gesamtwertung: Platzpunkte (10 für Platz 1 … 1 für Platz 10) je Spiel, nur wer genug Runden gespielt hat
  function overall(wk, includeHidden) {
    const minR = cfg().min_rounds, pts = new Map();
    const rounds = new Map(db.prepare('SELECT user_id, COUNT(*) n FROM game_rounds WHERE week = ? GROUP BY user_id').all(wk).map((r) => [r.user_id, r.n]));
    for (const g of Object.keys(SCORE_GAMES)) {
      let place = 0;
      for (const r of perGame(g, wk)) {
        if ((rounds.get(r.user_id) || 0) < minR || (!includeHidden && isHidden(r.user_id))) continue;
        if (++place > 10) break;
        pts.set(r.user_id, (pts.get(r.user_id) || 0) + (11 - place));
      }
    }
    return [...pts.entries()].map(([user_id, points]) => ({ user_id, points, rounds: rounds.get(user_id) || 0 })).sort((a, b) => b.points - a.points || b.rounds - a.rounds || a.user_id - b.user_id);
  }
  const topCache = { week: null, map: new Map() };
  function loadTop() {
    const w = (db.prepare('SELECT MAX(week) w FROM game_top10').get() || {}).w;
    topCache.week = w || null; topCache.map = new Map();
    if (w) for (const r of db.prepare('SELECT user_id, place FROM game_top10 WHERE week = ?').all(w)) if (!isHidden(r.user_id)) topCache.map.set(r.user_id, r.place);
  }
  loadTop();
  ctx.topRank = (userId) => { const p = topCache.map.get(userId); return p ? { name: `Top 10 · Platz ${p}`, icon: '🏆', top10: p } : null; };

  function settle(wk, force) {
    const mark = 'g_settled_' + wk;
    if (getSetting(mark, '') && !force) return null;
    setSetting(mark, String(now()));
    const rows = overall(wk, true).slice(0, 10), bon = cfg().bonus, cap = cfg().bonus_cap;
    let left = cap; const out = [];
    rows.forEach((r, i) => {
      const want = Math.min(bon[i] || 0, left);
      const paid = want > 0 ? eco.pay(r.user_id, want, 'game_bonus', wk) : 0;
      left -= paid;
      db.prepare('INSERT OR REPLACE INTO game_top10(week,place,user_id,bonus,created_at) VALUES(?,?,?,?,?)').run(wk, i + 1, r.user_id, paid, now());
      out.push({ place: i + 1, user_id: r.user_id, bonus: paid });
    });
    loadTop();
    return out;
  }
  function tick() {
    const cur = week(), last = getSetting('g_last_week', '');
    if (!last) return setSetting('g_last_week', cur);
    if (last !== cur) { settle(last); setSetting('g_last_week', cur); }
  }
  tick();
  const iv = setInterval(tick, 60_000); iv.unref();

  GET('/api/games/leaderboard', (req, res) => {
    const wk = req.query.week === 'prev' ? prevWeek() : week(), g = String(req.query.game || 'all');
    const label = (r, i, val) => ({ place: i + 1, username: nameOf(r.user_id), ...val });
    let rows;
    if (g === 'all') rows = overall(wk, false).slice(0, 10).map((r, i) => label(r, i, { points: r.points, rounds: r.rounds }));
    else if (SCORE_GAMES[g]) rows = perGame(g, wk).filter((r) => !isHidden(r.user_id)).slice(0, 10).map((r, i) => label(r, i, { value: r.val, rounds: r.rounds }));
    else return fail(res, 400, 'Unbekanntes Spiel');
    send(res, 200, { week: wk, game: g, unit: g === 'reaction' ? 'ms' : g === 'memory' ? 'Züge' : g === 'snake' ? 'Äpfel' : g === 'all' ? 'Punkte' : 'Credits', rows: rows.filter((r) => r.username), min_rounds: cfg().min_rounds });
  });
  function prevWeek() { return eco.weekKey(now() - 7 * DAY); }
  GET('/api/games/halloffame', (req, res) => {
    const rows = db.prepare('SELECT week, user_id, bonus FROM game_top10 WHERE place = 1 ORDER BY week DESC LIMIT 52').all().filter((r) => !isHidden(r.user_id));
    const cur = [...topCache.map.entries()].sort((a, b) => a[1] - b[1]).map(([id, place]) => ({ place, username: nameOf(id) })).filter((r) => r.username);
    send(res, 200, { champions: rows.map((r) => ({ week: r.week, username: nameOf(r.user_id), bonus: r.bonus })).filter((r) => r.username), top10: cur, top10_week: topCache.week });
  });

  // ---------- Info, Zustimmung, Sichtbarkeit ----------
  GET('/api/games/info', (req, res) => {
    const c = cfg(), u = req.user;
    const out = { names: NAMES, fee: c.fee, bet_min: c.bet_min, bet_max: c.bet_max, bj_fee_pct: c.bj_fee_pct, bj_fee_min: c.bj_fee_min, loss_cap: c.loss_cap, prize_cap: c.prize_cap, min_rounds: c.min_rounds, bonus: c.bonus, bonus_cap: c.bonus_cap,
      prizes: c.prizes, slots: { symbols: SYM.map((s) => s[0]), pay3: PAY3, pair_cherry: PAIR_CHERRY, rtp: Math.round(slotsRtp() * 1000) / 10 }, roulette: { rtp: 97.3 }, week: week() };
    if (u) Object.assign(out, { me: { username: u.username, credits: credits(u.id), unlimited: isStaff(u.id), consent: hasConsent(u.id), hidden: isHidden(u.id), loss_left: Math.max(0, c.loss_cap - lossToday(u.id)), prize_left: Math.max(0, c.prize_cap - prizeToday(u.id)),
      top10: (ctx.topRank(u.id) || {}).top10 || null, rounds_week: db.prepare('SELECT COUNT(*) n FROM game_rounds WHERE user_id = ? AND week = ?').get(u.id, week()).n } });
    send(res, 200, out);
  });
  POST('/api/games/consent', rl('gconsent', 30, 600_000), requireUser, jsonBody, (req, res) => {
    if (req.body.adult !== true || req.body.no_value !== true) return fail(res, 400, 'Bitte beide Hinweise bestätigen');
    db.prepare('INSERT OR IGNORE INTO game_consent(user_id, created_at) VALUES(?,?)').run(req.user.id, now());
    send(res, 200, { ok: true });
  });
  POST('/api/games/prefs', rl('gprefs', 30, 600_000), requireUser, jsonBody, (req, res) => {
    db.prepare('INSERT INTO game_prefs(user_id, hidden) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET hidden = excluded.hidden').run(req.user.id, req.body.hidden ? 1 : 0);
    loadTop();
    send(res, 200, { ok: true, hidden: !!req.body.hidden });
  });

  // ---------- Admin ----------
  const perm = requirePerm('settings.edit');
  GET('/api/admin/games', perm, (req, res) => {
    const c = cfg(), w = week();
    send(res, 200, { config: c, week: w, rounds_week: db.prepare('SELECT COUNT(*) n FROM game_rounds WHERE week = ?').get(w).n, players_week: db.prepare('SELECT COUNT(DISTINCT user_id) n FROM game_rounds WHERE week = ?').get(w).n,
      house_week: -db.prepare("SELECT COALESCE(SUM(net),0) n FROM game_rounds WHERE week = ?").get(w).n, last_settled: getSetting('g_last_week', ''), top10: db.prepare('SELECT t.place, u.username, t.bonus, t.week FROM game_top10 t LEFT JOIN users u ON u.id = t.user_id WHERE t.week = ? ORDER BY t.place').all(topCache.week || '') });
  });
  PUT('/api/admin/games', perm, jsonBody, (req, res) => {
    const b = req.body, c = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(Number(v) || 0)));
    const map = { fee: ['g_fee', 0, 100000], bet_min: ['g_bet_min', 1, 100000], bet_max: ['g_bet_max', 1, 1000000], bj_fee_pct: ['g_bj_fee_pct', 0, 50], bj_fee_min: ['g_bj_fee_min', 0, 10000], loss_cap: ['g_loss_cap', 0, 10000000], prize_cap: ['g_prize_cap', 0, 10000000], min_rounds: ['g_min_rounds', 0, 1000], bonus_cap: ['g_bonus_cap', 0, 10000000] };
    for (const [k, [key, lo, hi]] of Object.entries(map)) if (k in b) setSetting(key, String(c(b[k], lo, hi)));
    if (Array.isArray(b.bonus)) setSetting('g_bonus', JSON.stringify(b.bonus.slice(0, 10).map((n) => c(n, 0, 1000000))));
    if (b.prizes && typeof b.prizes === 'object') {
      const pm = { reaction: ['g_p_react_hi', 'g_p_react_lo'], memory: ['g_p_mem_hi', 'g_p_mem_lo'], snake: ['g_p_snake_hi', 'g_p_snake_lo'] };
      for (const [g, keys] of Object.entries(pm)) if (Array.isArray(b.prizes[g])) keys.forEach((k, i) => setSetting(k, String(c(b.prizes[g][i], 0, 100000))));
    }
    if (cfg().bet_min > cfg().bet_max) setSetting('g_bet_min', String(cfg().bet_max));
    audit(req.admin.username, 'games_update', Object.keys(b).join(', '));
    send(res, 200, { ok: true, config: cfg() });
  });
  POST('/api/admin/games/settle', perm, jsonBody, (req, res) => {
    const w = /^\d{4}-W\d{2}$/.test(String(req.body.week || '')) ? req.body.week : week();
    const r = settle(w, true); audit(req.admin.username, 'games_settle', w);
    send(res, 200, { week: w, top10: r });
  });

  return { settle, overall, slotsRtp, cfg };
};
