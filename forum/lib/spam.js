/* Spam-Schutz: selbstgehostetes Captcha (kein Drittanbieter), Honeypot, Mindest-Ausfüllzeit,
   Inhaltsprüfung für neue Konten, Verstoß-Zähler mit automatischem Timeout. */
const crypto = require('node:crypto');

module.exports = function init(ctx, acc) {
  const { db, now, getSetting, GET, send, fail, rl, audit } = ctx;
  // Ziffern als Punktmatrix (5x7): Die Antwort steht NICHT als Text im SVG, sondern nur als gezeichnete Formen.
  const FONT = {
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], 3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], 5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], 7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], 9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  };
  const CH = '23456789';
  const store = new Map(); // id → {answer, exp}
  const rnd = (n) => crypto.randomInt(n);
  const enabled = () => getSetting('captcha_on', '1') === '1';

  function makeSvg(text) {
    const W = 220, H = 70; let out = '';
    for (let i = 0; i < 6; i++) out += `<path d="M${rnd(W)} ${rnd(H)} Q${rnd(W)} ${rnd(H)} ${rnd(W)} ${rnd(H)}" stroke="hsl(${rnd(360)} 70% 60%)" stroke-width="1.6" fill="none" opacity=".7"/>`;
    [...text].forEach((c, i) => {
      const cell = 4.2 + rnd(10) / 10, ox = 12 + i * 34 + rnd(5), oy = 14 + rnd(8), rot = rnd(40) - 20, hue = rnd(360);
      let g = '';
      FONT[c].forEach((row, y) => [...row].forEach((v, x) => { if (v === '1') g += `<rect x="${(x * cell + (rnd(10) - 5) / 12).toFixed(2)}" y="${(y * cell + (rnd(10) - 5) / 12).toFixed(2)}" width="${(cell * 0.85).toFixed(2)}" height="${(cell * 0.85).toFixed(2)}" rx="1"/>`; }));
      out += `<g transform="translate(${ox} ${oy}) rotate(${rot} 10 14)" fill="hsl(${hue} 80% 70%)">${g}</g>`;
    });
    for (let i = 0; i < 50; i++) out += `<circle cx="${rnd(W)}" cy="${rnd(H)}" r="${0.8 + rnd(18) / 10}" fill="hsl(${rnd(360)} 60% 60%)" opacity=".6"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Captcha-Bild"><rect width="100%" height="100%" fill="#0a0a18"/>${out}</svg>`;
  }

  // Modi: "pow" (Standard: unsichtbare Rechenaufgabe im Browser, nichts zu tippen), "math" (einfache Textfrage), "image" (Bild mit 4 Ziffern)
  const modeSetting = () => { const m = getSetting('captcha_mode', 'pow'); return ['pow', 'math', 'image'].includes(m) ? m : 'pow'; };
  const POW_BITS = 16;
  const WORDS = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn'];
  const leadingZeroBits = (buf) => { let n = 0; for (const byte of buf) { if (byte === 0) { n += 8; continue; } n += Math.clz32(byte) - 24; break; } return n; };

  GET('/api/captcha', rl('captcha', 60, 600_000), (req, res) => {
    for (const [k, v] of store) if (v.exp < now()) store.delete(k);
    if (store.size > 5000) store.clear();
    const id = crypto.randomBytes(12).toString('hex');
    let mode = modeSetting();
    if (req.query.fallback === '1' && mode === 'pow') mode = 'math'; // Browser ohne Web-Crypto
    if (mode === 'pow') {
      const challenge = crypto.randomBytes(12).toString('hex');
      store.set(id, { mode, challenge, exp: now() + 10 * 60_000 });
      return send(res, 200, { id, mode, enabled: enabled(), challenge, bits: POW_BITS });
    }
    if (mode === 'math') {
      const a = 1 + rnd(9), b = 1 + rnd(9), plus = rnd(2) === 0 || a < b;
      store.set(id, { mode, answer: String(plus ? a + b : a - b), exp: now() + 10 * 60_000 });
      return send(res, 200, { id, mode, enabled: enabled(), question: `Was ergibt ${WORDS[a]} ${plus ? 'plus' : 'minus'} ${WORDS[b]}? (als Ziffer)` });
    }
    const answer = Array.from({ length: 4 }, () => CH[rnd(CH.length)]).join('');
    store.set(id, { mode, answer, exp: now() + 10 * 60_000 });
    send(res, 200, { id, mode, enabled: enabled(), svg: makeSvg(answer) });
  });

  // Prüft Captcha + Honeypot + Ausfüllzeit. Gibt Fehlertext oder null.
  function checkRegistration(body) {
    if (body.website) return 'Anfrage abgelehnt'; // Honeypot: Menschen sehen das Feld nicht
    if (process.env.NX_TEST_BYPASS_CAPTCHA === '1') return null; // nur für automatische Tests
    if (Number(body.took_ms) < 2500) return 'Das ging zu schnell – bitte noch einmal in Ruhe absenden';
    if (!enabled()) return null;
    const c = store.get(String(body.captcha_id || ''));
    store.delete(String(body.captcha_id || '')); // einmalig
    if (!c || c.exp < now()) return 'Die Sicherheitsprüfung ist abgelaufen – bitte Seite neu laden und noch einmal versuchen';
    const given = String(body.captcha || '').trim();
    if (c.mode === 'pow') {
      const h = crypto.createHash('sha256').update(c.challenge + ':' + given.slice(0, 40)).digest();
      return leadingZeroBits(h) >= POW_BITS ? null : 'Die Sicherheitsprüfung ist fehlgeschlagen – bitte Seite neu laden';
    }
    return given.toUpperCase().replace(/\s/g, '') === c.answer ? null : 'Die Antwort stimmt nicht – bitte erneut versuchen';
  }

  // ---- Inhaltsprüfung ----
  const LINK = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|ru|xyz|top|click|link|shop|site)\b/gi;
  const dayMs = 86_400_000;
  function strike(user, why) {
    db.prepare('INSERT INTO spam_strikes(user_id, why, created_at) VALUES(?,?,?)').run(user.id, why, now());
    const n = db.prepare('SELECT COUNT(*) n FROM spam_strikes WHERE user_id = ? AND created_at > ?').get(user.id, now() - 3600_000).n;
    if (n >= 5) { // 5 Verstöße in einer Stunde → 30 Minuten Schreibsperre
      db.prepare('UPDATE users SET timeout_until = ?, timeout_mode = ?, timeout_reason = ? WHERE id = ?').run(now() + 30 * 60_000, 'write', 'Automatisch: Spam-Verdacht', user.id);
      audit('(System)', 'spam_timeout', `${user.username} – ${why}`);
    }
  }
  // Gibt Fehlertext zurück, wenn der Beitrag wie Spam aussieht. Team ist ausgenommen.
  function checkContent(user, kind, text, title = '') {
    if (!user || acc.isTeam(user)) return null;
    const all = `${title}\n${text}`;
    const age = now() - user.created_at;
    const links = (all.match(LINK) || []).length;
    let why = null, msg = null;
    if (age < dayMs && links > 1) { why = 'links_neu'; msg = 'Neue Konten dürfen in den ersten 24 Stunden nur einen Link pro Beitrag posten'; }
    else if (links > 5) { why = 'links_viele'; msg = 'Zu viele Links in einem Beitrag'; }
    else if (/(.)\1{14,}/.test(all)) { why = 'flut'; msg = 'Bitte keine Zeichen-Wiederholungen'; }
    else if (all.length > 40 && (all.match(/[A-ZÄÖÜ]/g) || []).length / all.replace(/[^A-Za-zÄÖÜäöü]/g, '').length > 0.8) { why = 'gross'; msg = 'Bitte nicht nur in GROSSBUCHSTABEN schreiben'; }
    else {
      const dup = db.prepare(`SELECT 1 FROM (SELECT body FROM comments WHERE user_id = ? AND created_at > ? UNION ALL SELECT body FROM threads WHERE user_id = ? AND created_at > ?) WHERE body = ? AND length(body) > 5 LIMIT 1`).get(user.id, now() - 600_000, user.id, now() - 600_000, text);
      if (dup) { why = 'duplikat'; msg = 'Diesen Text hast du gerade schon gepostet'; }
    }
    if (kind === 'thread' && age < 10 * 60_000 && !why) { why = 'zu_neu'; msg = 'Dein Konto ist ganz frisch – du kannst in ein paar Minuten den ersten Thread starten'; }
    if (!why) return null;
    strike(user, why);
    return msg;
  }
  db.exec('CREATE TABLE IF NOT EXISTS spam_strikes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, why TEXT NOT NULL, created_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS idx_strikes ON spam_strikes(user_id, created_at);');
  return { checkRegistration, checkContent, enabled };
};
