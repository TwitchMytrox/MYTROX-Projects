'use strict';
// ======================================================================
// Konten-System: Registrierung, Login, Sitzungen (Cookie), Zwei-Faktor,
// Wiederherstellungscodes, Profil, Einstellungen, Datenexport, Konto löschen.
// Anonym: es gibt keine E-Mail-Pflicht (nur für Teammitglieder).
// ======================================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PERMISSIONS, ALL_KEYS, DEFAULT_ROLES, STATUSES, ADDED_LATER } = require('./permissions');
const secure = require('./secure');

module.exports = function initAccounts(ctx) {
  const {
    db, now, getSetting, setSetting, tx, DATA_DIR, UPLOAD_DIR,
    GET, POST, PATCH, DEL, send, fail, rl, jsonBody, multipart, audit,
    hashPassword, verifyPassword, sha, num, parseCookies, ipHash, wordRegex, serveFile, SECURE_COOKIES,
  } = ctx;

  const box = secure.makeBox(DATA_DIR);
  const { rankOf } = require('./rankdata');
  const AVATAR_DIR = path.join(UPLOAD_DIR, 'avatars');
  fs.mkdirSync(AVATAR_DIR, { recursive: true });

  const COOKIE = 'nx_session';
  const MEMBER_SESSION_MS = 30 * 86400_000;
  const TEAM_SESSION_MS = 12 * 3600_000;
  const MAX_FAILS = 5;
  const LOCK_MS = 10 * 60_000;
  const RENAME_COOLDOWN_MS = 14 * 86400_000;

  // ------------------------------------------------------------------
  // Rollen
  // ------------------------------------------------------------------
  for (const r of DEFAULT_ROLES) {
    if (!db.prepare('SELECT 1 FROM roles WHERE key = ?').get(r.key)) {
      db.prepare('INSERT INTO roles(key,name,color,level,permissions,system,created_at) VALUES(?,?,?,?,?,1,?)').run(r.key, r.name, r.color, r.level, JSON.stringify(r.permissions), now());
    }
  }
  // Neue Rechte in bestehende Standard-Rollen übernehmen (Datenbank aus älterer Version)
  for (const r of DEFAULT_ROLES) {
    const row = db.prepare('SELECT id, permissions FROM roles WHERE key = ? AND system = 1').get(r.key);
    if (!row || r.permissions.includes('*')) continue;
    let cur = []; try { cur = JSON.parse(row.permissions); } catch { /* leer */ }
    const add = ADDED_LATER.filter((k) => r.permissions.includes(k) && !cur.includes(k) && !(db.prepare('SELECT 1 FROM settings WHERE key = ?').get('perm_added_' + r.key + '_' + k)));
    if (add.length) {
      db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(JSON.stringify([...cur, ...add]), row.id);
      for (const k of add) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run('perm_added_' + r.key + '_' + k, '1');
    }
  }
  const roleById = (id) => {
    const r = id ? db.prepare('SELECT * FROM roles WHERE id = ?').get(id) : null;
    if (!r) return null;
    let perms = [];
    try { perms = JSON.parse(r.permissions); } catch { /* leer */ }
    if (perms.includes('*')) perms = ALL_KEYS.slice();
    return { id: r.id, key: r.key, name: r.name, color: r.color, level: r.level, system: !!r.system, perms: perms.filter((p) => ALL_KEYS.includes(p)) };
  };
  const has = (u, perm) => !!u && !!u.role && u.role.perms.includes(perm);
  const isTeam = (u) => has(u, 'admin.access');
  const teamMfaRequired = () => getSetting('team_mfa_required', process.env.TEAM_MFA_REQUIRED === '1' ? '1' : '0') === '1';
  const setupRequired = (u) => teamMfaRequired() && isTeam(u) && !(u.mfa && u.email_enc);

  // ------------------------------------------------------------------
  // Benutzernamen
  // ------------------------------------------------------------------
  const NAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
  const skeleton = (lc) =>
    lc.replace(/[_-]/g, '').replace(/0/g, 'o').replace(/[1il|]/g, 'l').replace(/3/g, 'e').replace(/[5$]/g, 's').replace(/7/g, 't').replace(/4/g, 'a');

  // Name-Liste: reservierte Begriffe, die niemand registrieren darf (Admin kann sie freigeben)
  const RESERVED = ['admin', 'administrator', 'support', 'moderator', 'mod', 'team', 'system', 'nexus', 'nexusarena', 'staff', 'owner', 'root', 'anonym', 'anonymous', 'anon', 'null', 'undefined', 'deleted', 'bot', 'help', 'info', 'security', 'sicherheit', 'official'];
  const insName = db.prepare('INSERT OR IGNORE INTO usernames(name_lc,name,user_id,kind,created_at,skel) VALUES(?,?,?,?,?,?)');
  for (const n of RESERVED) insName.run(n, n, null, 'reserved', now(), skeleton(n));

  function nameProblem(name, forUserId) {
    if (!NAME_RE.test(name)) return 'Benutzername: 3–20 Zeichen (Buchstaben, Zahlen, _ und -)';
    const lc = name.toLowerCase();
    const re = wordRegex();
    if (re && name.search(re) !== -1) return 'Dieser Name ist nicht erlaubt';
    const row = db.prepare('SELECT user_id, kind FROM usernames WHERE name_lc = ?').get(lc);
    if (row && !(forUserId && row.user_id === forUserId)) return row.kind === 'reserved' ? 'Dieser Name ist reserviert' : 'Dieser Benutzername ist bereits vergeben';
    const sk = skeleton(lc);
    const sim = db.prepare('SELECT user_id, name_lc FROM usernames WHERE skel = ? AND name_lc != ?').get(sk, lc);
    if (sim && !(forUserId && sim.user_id === forUserId)) return 'Dieser Name ist einem vorhandenen zu ähnlich';
    return null;
  }

  const ADJ = ['Neon', 'Pixel', 'Turbo', 'Shadow', 'Cyber', 'Rapid', 'Frozen', 'Lunar', 'Toxic', 'Hyper', 'Silent', 'Crimson', 'Atomic', 'Glitch', 'Savage', 'Mystic', 'Iron', 'Ghost', 'Solar', 'Rogue'];
  const NOUN = ['Fox', 'Wolf', 'Falcon', 'Ninja', 'Raven', 'Golem', 'Viper', 'Phantom', 'Rogue', 'Titan', 'Drifter', 'Cobra', 'Pilot', 'Ranger', 'Sniper', 'Knight', 'Wizard', 'Tiger', 'Hunter', 'Pirate'];
  function suggestName() {
    for (let i = 0; i < 40; i++) {
      const pick = (a) => a[crypto.randomInt(a.length)];
      const n = `${pick(ADJ)}${pick(NOUN)}${crypto.randomInt(10, 999)}`;
      if (!nameProblem(n)) return n;
    }
    return 'Player' + crypto.randomInt(10000, 99999);
  }

  function passwordProblem(pw, username) {
    if (typeof pw !== 'string' || pw.length < 8) return 'Passwort: mindestens 8 Zeichen';
    if (pw.length > 200) return 'Passwort ist zu lang';
    const lc = pw.toLowerCase();
    if (username && lc.includes(String(username).toLowerCase()) && username.length >= 4) return 'Das Passwort darf deinen Namen nicht enthalten';
    if (['12345678', 'password', 'passwort', 'qwertzui', 'qwertyui', '11111111', 'abcd1234', 'passwort1', 'password1'].includes(lc)) return 'Dieses Passwort ist zu einfach';
    if (/^(.)\1+$/.test(pw)) return 'Dieses Passwort ist zu einfach';
    return null;
  }

  // ------------------------------------------------------------------
  // Nutzer / Sitzungen
  // ------------------------------------------------------------------
  const userRow = (id) => db.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').get(id);
  function hydrate(row) {
    if (!row) return null;
    row.role = roleById(row.role_id);
    row.key_count = db.prepare('SELECT COUNT(*) n FROM webauthn_keys WHERE user_id = ?').get(row.id).n;
    row.mfa = !!(row.totp_on || row.key_count);
    return row;
  }

  function loadUser(req) {
    const tok = parseCookies(req)[COOKIE];
    req.user = null;
    if (!tok || !/^[a-f0-9]{64}$/.test(tok)) return;
    const th = sha(tok);
    const s = db.prepare('SELECT s.last_seen, s.created_at sess_created, u.* FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.deleted = 0').get(th, now());
    if (!s) return;
    if (now() - s.last_seen > 300_000) db.prepare('UPDATE user_sessions SET last_seen = ? WHERE token_hash = ?').run(now(), th);
    req.user = hydrate(s);
    req.user.sessionHash = th;
  }

  function startSession(req, res, user) {
    const token = crypto.randomBytes(32).toString('hex');
    const role = roleById(user.role_id);
    const ttl = role && role.perms.includes('admin.access') ? TEAM_SESSION_MS : MEMBER_SESSION_MS;
    db.prepare('INSERT INTO user_sessions(token_hash,user_id,created_at,expires_at,last_seen,ip_hash,ua) VALUES(?,?,?,?,?,?,?)').run(
      sha(token), user.id, now(), now() + ttl, now(), ipHash(req), String(req.headers['user-agent'] || '').slice(0, 120)
    );
    const secureFlag = SECURE_COOKIES || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(ttl / 1000)}${secureFlag}`);
  }
  const clearCookie = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);

  const activeTimeout = (u) => (u.timeout_until && u.timeout_until > now() ? { mode: u.timeout_mode, until: u.timeout_until, reason: u.timeout_reason } : null);
  const avatarUrl = (u) => (u.avatar ? '/avatars/' + u.avatar : null);

  function parseSettings(u) {
    try { return JSON.parse(u.settings || '{}'); } catch { return {}; }
  }

  // Was der Nutzer über sich selbst sehen darf
  function meOf(u) {
    const st = STATUSES[u.status] || STATUSES.normal;
    const team = isTeam(u);
    return {
      id: u.id,
      username: u.username,
      role: u.role ? { key: u.role.key, name: u.role.name, color: u.role.color, level: u.role.level } : null,
      team,
      perms: team ? u.role.perms : [],
      setup_required: setupRequired(u),
      status: u.status,
      status_label: st.label,
      status_desc: st.desc,
      status_note: u.status_note || '',
      status_since: u.status_since || null,
      timeout: activeTimeout(u),
      warnings: db.prepare('SELECT COUNT(*) n FROM warnings WHERE user_id = ?').get(u.id).n,
      bio: u.bio,
      avatar: avatarUrl(u),
      settings: parseSettings(u),
      totp_on: !!u.totp_on,
      webauthn_keys: u.key_count || 0,
      mfa: !!u.mfa,
      has_email: !!u.email_enc,
      created_at: u.created_at,
      xp: u.xp || 0, credits: u.credits || 0, rank: (ctx.topRank && ctx.topRank(u.id)) || rankOf(u.xp || 0),
      login_count: u.login_count,
      rename_available_at: u.last_rename ? u.last_rename + RENAME_COOLDOWN_MS : null,
      // Freiwillige Erinnerung: jede 12. Anmeldung, nur in der frischen Sitzung
      remind_2fa: !u.mfa && !team && u.login_count > 0 && u.login_count % 12 === 0 && !!u.sess_created && now() - u.sess_created < 10 * 60_000,
    };
  }

  // Anzeige eines Autors in Thread-/Kommentar-Listen
  function authorOf(row) {
    if (!row.user_id) return null;
    if (row.u_deleted) return { name: 'Gelöschter Nutzer', deleted: true, avatar: null, role: null };
    return {
      name: row.u_name,
      avatar: row.u_avatar ? '/avatars/' + row.u_avatar : null,
      role: row.r_name ? { name: row.r_name, color: row.r_color } : null,
      rank: (() => { const t = ctx.topRank && ctx.topRank(row.user_id); if (t) return { name: t.name, icon: t.icon }; const r = rankOf(row.u_xp || 0); return { name: r.name, icon: r.icon }; })(),
      status: row.u_status === 'gebannt' ? 'gebannt' : undefined,
    };
  }
  const AUTHOR_COLS = 'u.username u_name, u.avatar u_avatar, u.deleted u_deleted, u.status u_status, u.xp u_xp, r.name r_name, r.color r_color';
  const AUTHOR_JOIN_T = 'LEFT JOIN users u ON u.id = t.user_id LEFT JOIN roles r ON r.id = u.role_id';
  const AUTHOR_JOIN_C = 'LEFT JOIN users u ON u.id = c.user_id LEFT JOIN roles r ON r.id = u.role_id';

  // ------------------------------------------------------------------
  // Middleware
  // ------------------------------------------------------------------
  function originOk(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  }

  function requireUser(req, res, next) {
    if (!req.user) return send(res, 401, { error: 'Bitte melde dich an', code: 'LOGIN_REQUIRED' });
    if (req.method !== 'GET' && !originOk(req)) return fail(res, 403, 'Origin nicht erlaubt');
    return next();
  }

  function requirePerm(perm) {
    return (req, res, next) => {
      const u = req.user;
      if (!u) return send(res, 401, { error: 'Nicht angemeldet', code: 'LOGIN_REQUIRED' });
      if (!isTeam(u)) return fail(res, 403, 'Kein Zugriff auf den Admin-Bereich');
      if (setupRequired(u)) return send(res, 403, { error: 'Für Teammitglieder sind Zwei-Faktor und eine E-Mail-Adresse Pflicht – bitte zuerst einrichten.', code: 'SETUP_REQUIRED' });
      if (perm && !has(u, perm)) return fail(res, 403, `Dir fehlt das Recht dafür (${perm})`);
      if (req.method !== 'GET' && !originOk(req)) return fail(res, 403, 'Origin nicht erlaubt');
      req.admin = { id: u.id, username: u.username, tokenHash: u.sessionHash, level: u.role.level };
      return next();
    };
  }

  // Lesen: Gäste nur, wenn der Admin es erlaubt; Nutzer im Modus "Seite unsichtbar" sehen nichts
  function readGate(req, res, next) {
    const u = req.user;
    if (!u && getSetting('guest_read', '1') !== '1') return send(res, 401, { error: 'Bitte melde dich an, um das Forum zu lesen', code: 'LOGIN_REQUIRED' });
    if (u) {
      const t = activeTimeout(u);
      if (t && t.mode === 'hidden') return send(res, 403, { error: 'Das Forum ist für dich vorübergehend ausgeblendet' + (t.reason ? ` (${t.reason})` : ''), code: 'HIDDEN', until: t.until });
      if (u.status === 'gebannt') return send(res, 403, { error: 'Dein Konto ist gebannt', code: 'BANNED' });
    }
    return next();
  }

  // Schreiben: Konto Pflicht (einstellbar), Konto-Stufe und Timeouts beachten.
  // Läuft VOR dem Einlesen der Anfrage, damit gesperrte Nutzer keine großen Uploads erzeugen.
  const postGate = (kind) => (req, res, next) => {
    const u = req.user;
    if (!u) {
      if (getSetting('require_login_to_post', '1') === '1') return send(res, 401, { error: 'Zum Schreiben brauchst du ein (anonymes) Konto', code: 'LOGIN_REQUIRED' });
      return next();
    }
    if (!originOk(req)) return fail(res, 403, 'Origin nicht erlaubt');
    if (u.status === 'gebannt') return send(res, 403, { error: 'Dein Konto ist gebannt' + (u.status_note ? `: ${u.status_note}` : ''), code: 'BANNED' });
    const t = activeTimeout(u);
    if (t) return send(res, 403, { error: `Timeout bis ${new Date(t.until).toLocaleString('de-DE')}` + (t.reason ? ` – ${t.reason}` : ''), code: 'TIMEOUT', until: t.until });
    if (u.status === 'untersuchung' && kind === 'thread')
      return send(res, 403, { error: 'Dein Konto wird geprüft – neue Threads und Uploads sind vorübergehend nicht möglich', code: 'RESTRICTED' });
    return next();
  };

  // Läuft NACH multipart: Konten unter Untersuchung dürfen keine Dateien hochladen
  const filesGate = (req, res, next) => {
    if (req.user && req.user.status === 'untersuchung' && req.files && req.files.length)
      return send(res, 403, { error: 'Dein Konto wird geprüft – Uploads sind vorübergehend nicht möglich', code: 'RESTRICTED' });
    return next();
  };

  const identity = (req) => (req.user ? 'u' + req.user.id : ipHash(req));

  // ------------------------------------------------------------------
  // Wiederherstellungscodes
  // ------------------------------------------------------------------
  const codeHash = (c) => sha('rc:' + getSetting('ip_salt') + ':' + secure.normCode(c));
  function issueRecoveryCodes(userId, n = 10) {
    const codes = Array.from({ length: n }, () => secure.newRecoveryCode());
    tx(() => {
      db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
      const st = db.prepare('INSERT INTO recovery_codes(user_id, code_hash) VALUES(?,?)');
      for (const c of codes) st.run(userId, codeHash(c));
    });
    return codes;
  }
  function useRecoveryCode(userId, code) {
    if (!secure.normCode(code) || secure.normCode(code).length !== 12) return false;
    const r = db.prepare('SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL').get(userId, codeHash(code));
    if (!r) return false;
    db.prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ?').run(now(), r.id);
    return true;
  }
  const codesLeft = (userId) => db.prepare('SELECT COUNT(*) n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').get(userId).n;

  // Zweiter Faktor beim Login: App-Code (TOTP) oder Wiederherstellungscode
  function checkSecondFactor(u, code) {
    const secret = u.totp_enc ? box.decrypt(u.totp_enc) : null;
    if (secret) {
      const step = secure.verifyTotp(secret, code, u.totp_last);
      if (step) {
        db.prepare('UPDATE users SET totp_last = ? WHERE id = ?').run(step, u.id);
        return 'totp';
      }
    }
    if (useRecoveryCode(u.id, code)) return 'recovery';
    return null;
  }

  // ------------------------------------------------------------------
  // Erster Start / Migration alter Admin-Konten
  // ------------------------------------------------------------------
  function createUser({ username, passHash, roleKey = null }) {
    const role = roleKey ? db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey) : null;
    const lc = username.toLowerCase();
    const id = tx(() => {
      db.prepare('DELETE FROM usernames WHERE name_lc = ? AND user_id IS NULL').run(lc);
      const r = db.prepare('INSERT INTO users(username,name_lc,pass_hash,role_id,created_at) VALUES(?,?,?,?,?)').run(username, lc, passHash, role ? role.id : null, now());
      const uid = Number(r.lastInsertRowid);
      insName.run(lc, username, uid, 'registered', now(), skeleton(lc));
      return uid;
    });
    return id;
  }

  function ensureOwner() {
    if (db.prepare("SELECT COUNT(*) n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = 'owner' AND u.deleted = 0").get().n > 0) return;
    // Alte Admin-Tabelle (vor Etappe 1) übernehmen
    const old = db.prepare('SELECT * FROM admins ORDER BY id').all();
    if (old.length) {
      old.forEach((a, i) => {
        if (db.prepare('SELECT 1 FROM users WHERE name_lc = ?').get(a.username.toLowerCase())) return;
        createUser({ username: a.username, passHash: a.pass_hash, roleKey: i === 0 ? 'owner' : 'admin' });
      });
      console.log('ℹ️  Bisherige Admin-Konten wurden übernommen (erster = Inhaber). Zwei-Faktor ist freiwillig (Admin → Einstellungen).');
      return;
    }
    const username = process.env.ADMIN_USER || 'admin';
    const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    createUser({ username, passHash: hashPassword(pw), roleKey: 'owner' });
    console.log('\n┌──────────────────────────────────────────────────────┐');
    console.log('│  ERSTER START – Inhaber-Zugang wurde angelegt         │');
    console.log(`│  Benutzer:  ${username.padEnd(41)}│`);
    console.log(`│  Passwort:  ${pw.padEnd(41)}│`);
    console.log('│  Wird nur jetzt angezeigt – bitte notieren!           │');
    console.log('│  Zwei-Faktor kannst du freiwillig einrichten.         │');
    console.log('└──────────────────────────────────────────────────────┘\n');
  }
  ensureOwner();

  // ------------------------------------------------------------------
  // Routen: /api/auth
  // ------------------------------------------------------------------
  GET('/api/auth/suggest', rl('suggest', 40, 60_000), (req, res) => send(res, 200, { name: suggestName() }));

  GET('/api/auth/check-name', rl('checkname', 60, 60_000), (req, res) => {
    const name = String(req.query.name || '').trim();
    const problem = nameProblem(name);
    send(res, 200, { ok: !problem, problem });
  });

  POST('/api/auth/register', rl('register', 30, 3600_000), jsonBody, (req, res) => {
    if (getSetting('registration_open', '1') !== '1') return fail(res, 403, 'Die Registrierung ist aktuell geschlossen');
    const sp = ctx.spamRegCheck && ctx.spamRegCheck(req.body);
    if (sp) return fail(res, 400, sp);
    const username = String(req.body.username || '').trim();
    const pw = String(req.body.password || '');
    if (req.body.accept !== true) return fail(res, 400, 'Bitte bestätige die Regeln und den Hinweis zum Cookie');
    const np = nameProblem(username);
    if (np) return fail(res, 400, np);
    const pp = passwordProblem(pw, username);
    if (pp) return fail(res, 400, pp);
    const id = createUser({ username, passHash: hashPassword(pw) });
    const codes = issueRecoveryCodes(id);
    const u = hydrate(userRow(id));
    db.prepare('UPDATE users SET last_login = ?, login_count = 1 WHERE id = ?').run(now(), id);
    startSession(req, res, u);
    audit(username, 'register', '');
    send(res, 201, { user: meOf(hydrate(userRow(id))), recovery_codes: codes });
  });

  POST('/api/auth/login', rl('login', 20, 10 * 60_000), jsonBody, (req, res) => {
    const username = String(req.body.username || '').trim().slice(0, 40);
    const pw = String(req.body.password || '').slice(0, 200);
    const code = req.body.code ? String(req.body.code).slice(0, 40) : '';
    const row = db.prepare('SELECT * FROM users WHERE name_lc = ? AND deleted = 0').get(username.toLowerCase());
    if (row && row.locked_until && row.locked_until > now()) {
      return fail(res, 429, `Zu viele Fehlversuche – Konto bis ${new Date(row.locked_until).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr gesperrt`);
    }
    const ok = row ? verifyPassword(pw, row.pass_hash) : (verifyPassword(pw, 'x:00'), false);
    const bad = (msg) => {
      if (row) {
        const fails = row.failed_logins + 1;
        db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? now() + LOCK_MS : null, row.id);
      }
      audit(username || '?', 'login_failed', '');
      return fail(res, 401, msg);
    };
    if (!ok) return bad('Benutzername oder Passwort falsch');
    const u = hydrate(row);
    let usedRecovery = false;
    if (u.mfa) {
      const w = req.body.webauthn;
      if (!code && !w) return send(res, 200, { need_2fa: true, methods: ctx.mfaInfo ? ctx.mfaInfo(u, req) : { totp: !!u.totp_on } });
      if (w) { if (!ctx.mfaVerifyKey(u, req, w)) return bad('Sicherheitsschlüssel konnte nicht bestätigt werden'); }
      else {
        const how = checkSecondFactor(u, code);
        if (!how) return bad('Code ungültig oder abgelaufen');
        usedRecovery = how === 'recovery';
      }
    }
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login = ?, login_count = login_count + 1 WHERE id = ?').run(now(), u.id);
    startSession(req, res, u);
    if (ctx.onLogin) ctx.onLogin(u.id);
    const fresh = hydrate(userRow(u.id));
    audit(u.username, isTeam(u) ? 'team_login' : 'login', usedRecovery ? 'mit Wiederherstellungscode' : '');
    send(res, 200, {
      user: meOf(fresh),
      remind_2fa: !fresh.mfa && !isTeam(fresh) && fresh.login_count % 12 === 0,
      recovery_codes_left: usedRecovery ? codesLeft(u.id) : undefined,
    });
  });

  POST('/api/auth/logout', (req, res) => {
    if (req.user) db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(req.user.sessionHash);
    clearCookie(res);
    send(res, 200, { ok: true });
  });

  GET('/api/auth/me', (req, res) => send(res, 200, { user: req.user ? meOf(req.user) : null }));

  // Passwort vergessen: nur mit einem Wiederherstellungscode möglich (es gibt keine E-Mail)
  POST('/api/auth/recover', rl('recover', 8, 3600_000), jsonBody, (req, res) => {
    const username = String(req.body.username || '').trim().slice(0, 40);
    const row = db.prepare('SELECT * FROM users WHERE name_lc = ? AND deleted = 0').get(username.toLowerCase());
    const generic = 'Benutzername oder Wiederherstellungscode falsch';
    if (!row) return fail(res, 400, generic);
    if (row.locked_until && row.locked_until > now()) return fail(res, 429, 'Zu viele Fehlversuche – bitte später erneut versuchen');
    const pp = passwordProblem(String(req.body.new_password || ''), row.username);
    if (!useRecoveryCode(row.id, req.body.code)) {
      const fails = row.failed_logins + 1;
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? now() + LOCK_MS : null, row.id);
      return fail(res, 400, generic);
    }
    if (pp) {
      // Code wurde bereits verbraucht → zurückgeben, damit er nicht verloren geht
      db.prepare('UPDATE recovery_codes SET used_at = NULL WHERE user_id = ? AND code_hash = ?').run(row.id, codeHash(req.body.code));
      return fail(res, 400, pp);
    }
    db.prepare('UPDATE users SET pass_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?').run(hashPassword(String(req.body.new_password)), row.id);
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(row.id);
    audit(row.username, 'password_recovered', '');
    send(res, 200, { ok: true, recovery_codes_left: codesLeft(row.id) });
  });

  // ------------------------------------------------------------------
  // Routen: /api/account (eingeloggt)
  // ------------------------------------------------------------------
  const needPassword = (req, res) => {
    if (!verifyPassword(String(req.body.password || '').slice(0, 200), req.user.pass_hash)) {
      fail(res, 400, 'Passwort falsch');
      return false;
    }
    return true;
  };

  GET('/api/account', requireUser, (req, res) => {
    send(res, 200, { user: meOf(req.user), recovery_codes_left: codesLeft(req.user.id), sessions: db.prepare('SELECT COUNT(*) n FROM user_sessions WHERE user_id = ? AND expires_at > ?').get(req.user.id, now()).n });
  });

  PATCH('/api/account/profile', requireUser, jsonBody, (req, res) => {
    const bio = String(req.body.bio == null ? req.user.bio : req.body.bio).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, 300);
    const re = wordRegex();
    db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(re ? bio.replace(re, (m) => '✱'.repeat(m.length)) : bio, req.user.id);
    send(res, 200, { ok: true });
  });

  const AV_TYPES = { '.png': (b) => b[0] === 0x89 && b[1] === 0x50, '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8, '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8, '.webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP', '.gif': (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' };
  const removeAvatarFile = (name) => name && fs.rmSync(path.join(AVATAR_DIR, name), { force: true });

  POST('/api/account/avatar', requireUser, rl('avatar', 10, 600_000), multipart, (req, res) => {
    const f = (req.files || []).find((x) => x.field === 'avatar');
    if (!f) return fail(res, 400, 'Keine Datei erhalten');
    const ext = path.extname(f.originalname).toLowerCase();
    if (!AV_TYPES[ext] || !AV_TYPES[ext](f.buffer)) return fail(res, 400, 'Nur PNG, JPG, WebP oder GIF erlaubt');
    if (f.size > 1024 * 1024) return fail(res, 400, 'Profilbild darf höchstens 1 MB groß sein');
    const name = crypto.randomBytes(12).toString('hex') + (ext === '.jpeg' ? '.jpg' : ext);
    fs.writeFileSync(path.join(AVATAR_DIR, name), f.buffer);
    removeAvatarFile(req.user.avatar);
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(name, req.user.id);
    send(res, 200, { avatar: '/avatars/' + name });
  });

  DEL('/api/account/avatar', requireUser, (req, res) => {
    removeAvatarFile(req.user.avatar);
    db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(req.user.id);
    send(res, 200, { ok: true });
  });

  GET('/avatars/:file', (req, res) => {
    const f = req.params.file;
    if (!/^[a-f0-9]{24}\.(png|jpg|webp|gif)$/.test(f)) return fail(res, 404, 'Nicht gefunden');
    serveFile(req, res, path.join(AVATAR_DIR, f), { cache: 'public, max-age=604800, immutable', extra: { 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin' } });
  });

  POST('/api/account/username', requireUser, rl('rename', 5, 3600_000), jsonBody, (req, res) => {
    if (!needPassword(req, res)) return;
    const u = req.user;
    if (isTeam(u)) return fail(res, 403, 'Teammitglieder können ihren Namen nur über die Inhaber ändern lassen');
    if (u.last_rename && u.last_rename + RENAME_COOLDOWN_MS > now())
      return fail(res, 429, `Du kannst deinen Namen erst am ${new Date(u.last_rename + RENAME_COOLDOWN_MS).toLocaleDateString('de-DE')} wieder ändern`);
    const name = String(req.body.username || '').trim();
    if (name === u.username) return fail(res, 400, 'Das ist bereits dein Name');
    const np = nameProblem(name, u.id);
    if (np) return fail(res, 400, np);
    tx(() => {
      db.prepare('UPDATE users SET username = ?, name_lc = ?, last_rename = ? WHERE id = ?').run(name, name.toLowerCase(), now(), u.id);
      insName.run(name.toLowerCase(), name, u.id, 'registered', now(), skeleton(name.toLowerCase())); // alter Name bleibt reserviert
    });
    audit(u.username, 'rename', `→ ${name}`);
    send(res, 200, { username: name });
  });

  POST('/api/account/password', requireUser, rl('pwchange', 10, 600_000), jsonBody, (req, res) => {
    if (!verifyPassword(String(req.body.current || ''), req.user.pass_hash)) return fail(res, 400, 'Aktuelles Passwort falsch');
    const pp = passwordProblem(String(req.body.next || ''), req.user.username);
    if (pp) return fail(res, 400, pp);
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(String(req.body.next)), req.user.id);
    db.prepare('DELETE FROM user_sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.user.sessionHash);
    audit(req.user.username, 'password_change', '');
    send(res, 200, { ok: true });
  });

  const SETTING_SCHEMA = {
    theme: ['dark', 'light', 'system'],
    font_size: ['normal', 'large', 'xlarge'],
    notify_popups: 'bool',
    reduce_motion: 'bool',
    high_contrast: 'bool',
    sound: 'bool',
  };
  PATCH('/api/account/settings', requireUser, jsonBody, (req, res) => {
    const cur = parseSettings(req.user);
    for (const [k, rule] of Object.entries(SETTING_SCHEMA)) {
      if (!(k in req.body)) continue;
      if (rule === 'bool') cur[k] = !!req.body[k];
      else if (rule.includes(req.body[k])) cur[k] = req.body[k];
    }
    db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(cur), req.user.id);
    send(res, 200, { settings: cur });
  });

  // ----- Zwei-Faktor (Authenticator-App) -----
  POST('/api/account/2fa/setup', requireUser, rl('tfa', 10, 600_000), jsonBody, (req, res) => {
    if (!needPassword(req, res)) return;
    if (req.user.totp_on) return fail(res, 400, 'Zwei-Faktor ist bereits aktiv');
    const secret = secure.newTotpSecret();
    db.prepare('UPDATE users SET totp_enc = ?, totp_on = 0, totp_last = 0 WHERE id = ?').run(box.encrypt(secret), req.user.id);
    send(res, 200, { secret, uri: secure.otpauthUri(secret, req.user.username, getSetting('site_name', 'turkac.org')) });
  });

  POST('/api/account/2fa/enable', requireUser, rl('tfa', 10, 600_000), jsonBody, (req, res) => {
    const secret = req.user.totp_enc ? box.decrypt(req.user.totp_enc) : null;
    if (!secret || req.user.totp_on) return fail(res, 400, 'Bitte starte die Einrichtung neu');
    const step = secure.verifyTotp(secret, req.body.code, 0);
    if (!step) return fail(res, 400, 'Code stimmt nicht – prüfe die Uhrzeit deines Handys');
    db.prepare('UPDATE users SET totp_on = 1, totp_last = ? WHERE id = ?').run(step, req.user.id);
    // Bei der ersten Aktivierung gibt es frische Backup-Codes
    const codes = issueRecoveryCodes(req.user.id);
    audit(req.user.username, '2fa_enabled', '');
    send(res, 200, { ok: true, recovery_codes: codes });
  });

  POST('/api/account/2fa/disable', requireUser, rl('tfa', 10, 600_000), jsonBody, (req, res) => {
    if (!needPassword(req, res)) return;
    if (isTeam(req.user) && teamMfaRequired()) return fail(res, 403, 'Für Teammitglieder ist Zwei-Faktor aktuell Pflicht');
    if (!req.user.totp_on) return fail(res, 400, 'Zwei-Faktor ist nicht aktiv');
    if (!checkSecondFactor(req.user, String(req.body.code || ''))) return fail(res, 400, 'Code ungültig');
    db.prepare('UPDATE users SET totp_on = 0, totp_enc = NULL WHERE id = ?').run(req.user.id);
    audit(req.user.username, '2fa_disabled', '');
    send(res, 200, { ok: true });
  });

  POST('/api/account/recovery-codes', requireUser, rl('rcodes', 6, 3600_000), jsonBody, (req, res) => {
    if (!needPassword(req, res)) return;
    if (req.user.totp_on && !checkSecondFactor(req.user, String(req.body.code || ''))) return fail(res, 400, 'Zwei-Faktor-Code ungültig');
    const codes = issueRecoveryCodes(req.user.id);
    audit(req.user.username, 'recovery_codes_new', '');
    send(res, 200, { recovery_codes: codes });
  });

  // ----- E-Mail (verschlüsselt gespeichert; Pflicht nur für Team) -----
  POST('/api/account/email', requireUser, rl('email', 10, 600_000), jsonBody, (req, res) => {
    if (!needPassword(req, res)) return;
    const email = String(req.body.email || '').trim();
    if (!email) {
      if (isTeam(req.user) && teamMfaRequired()) return fail(res, 400, 'Für Teammitglieder ist eine E-Mail-Adresse aktuell Pflicht');
      db.prepare('UPDATE users SET email_enc = NULL WHERE id = ?').run(req.user.id);
      return send(res, 200, { ok: true, has_email: false });
    }
    if (email.length > 254 || !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) return fail(res, 400, 'Das sieht nicht wie eine E-Mail-Adresse aus');
    db.prepare('UPDATE users SET email_enc = ? WHERE id = ?').run(box.encrypt(email), req.user.id);
    audit(req.user.username, 'email_set', '');
    send(res, 200, { ok: true, has_email: true });
  });

  POST('/api/account/logout-all', requireUser, (req, res) => {
    db.prepare('DELETE FROM user_sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.user.sessionHash);
    send(res, 200, { ok: true });
  });

  // ----- Datenexport (DSGVO) -----
  GET('/api/account/export', requireUser, rl('export', 5, 3600_000), (req, res) => {
    const u = req.user;
    const data = {
      exportiert_am: new Date().toISOString(),
      konto: {
        benutzername: u.username, rolle: u.role ? u.role.name : null, status: u.status, status_hinweis: u.status_note,
        beschreibung: u.bio, erstellt: new Date(u.created_at).toISOString(), letzter_login: u.last_login ? new Date(u.last_login).toISOString() : null,
        anmeldungen: u.login_count, zwei_faktor: !!u.totp_on, email_hinterlegt: !!u.email_enc, einstellungen: parseSettings(u),
      },
      verwarnungen: db.prepare('SELECT reason grund, by_name von, created_at zeit FROM warnings WHERE user_id = ?').all(u.id).map((w) => ({ ...w, zeit: new Date(w.zeit).toISOString() })),
      threads: db.prepare('SELECT id, title titel, body text, created_at zeit FROM threads WHERE user_id = ? ORDER BY id').all(u.id).map((t) => ({ ...t, zeit: new Date(t.zeit).toISOString() })),
      kommentare: db.prepare('SELECT id, thread_id, body text, created_at zeit FROM comments WHERE user_id = ? ORDER BY id').all(u.id).map((c) => ({ ...c, zeit: new Date(c.zeit).toISOString() })),
      dateien: db.prepare('SELECT a.original_name name, a.size groesse, a.mime typ, a.thread_id FROM attachments a LEFT JOIN threads t ON t.id = a.thread_id AND a.comment_id IS NULL LEFT JOIN comments c ON c.id = a.comment_id WHERE t.user_id = ? OR c.user_id = ?').all(u.id, u.id),
      nachrichten: db.prepare('SELECT sender_id, recipient_id, body_enc, created_at FROM dm_messages WHERE sender_id = ? OR recipient_id = ? ORDER BY id').all(u.id, u.id).map((m) => ({ richtung: m.sender_id === u.id ? 'gesendet' : 'empfangen', text: (() => { try { return box.decrypt(m.body_enc); } catch { return ''; } })(), zeit: new Date(m.created_at).toISOString() })),
      rang: { xp: u.xp || 0, credits: u.credits || 0 },
      hinweis: 'Passwort, 2FA-Geheimnis und Wiederherstellungscodes werden nur als Hash bzw. verschlüsselt gespeichert und sind nicht Teil des Exports.',
    };
    const body = JSON.stringify(data, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="turkac-daten-${u.username}.json"`,
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(body);
    audit(u.username, 'data_export', '');
  });

  // ----- Konto löschen -----
  POST('/api/account/delete', requireUser, rl('delacc', 4, 3600_000), jsonBody, (req, res) => {
    if (!needPassword(req, res)) return;
    const u = req.user;
    if (u.role && u.role.key === 'owner') return fail(res, 403, 'Das Inhaber-Konto kann nicht gelöscht werden');
    if (isTeam(u)) return fail(res, 403, 'Teammitglieder müssen zuerst von der Inhaber-Rolle entbunden werden');
    if (u.totp_on && !checkSecondFactor(u, String(req.body.code || ''))) return fail(res, 400, 'Zwei-Faktor-Code ungültig');
    if (String(req.body.confirm || '') !== u.username) return fail(res, 400, 'Bitte tippe zur Bestätigung deinen Benutzernamen ein');
    removeAvatarFile(u.avatar);
    tx(() => {
      db.prepare("UPDATE users SET deleted = 1, name_lc = ?, pass_hash = '', totp_enc = NULL, totp_on = 0, email_enc = NULL, bio = '', avatar = NULL, settings = '{}', role_id = NULL WHERE id = ?").run('deleted-' + u.id, u.id);
      db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM ticket_messages WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id = ?)').run(u.id);
      db.prepare('DELETE FROM tickets WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM webauthn_keys WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM dm_messages WHERE sender_id = ? OR recipient_id = ?').run(u.id, u.id);
      db.prepare('DELETE FROM dm_blocks WHERE user_id = ? OR blocked_id = ?').run(u.id, u.id);
    });
    clearCookie(res);
    audit('(gelöscht)', 'account_deleted', '#' + u.id);
    send(res, 200, { ok: true });
  });

  // ----- Öffentliches Profil -----
  GET('/api/users/:name', readGate, (req, res) => {
    const u = db.prepare('SELECT u.*, r.name r_name, r.color r_color FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.name_lc = ? AND u.deleted = 0').get(String(req.params.name).toLowerCase());
    if (!u) return fail(res, 404, 'Nutzer nicht gefunden');
    send(res, 200, {
      username: u.username,
      role: u.r_name ? { name: u.r_name, color: u.r_color } : null,
      bio: u.bio,
      avatar: avatarUrl(u),
      created_at: u.created_at,
      threads: db.prepare('SELECT COUNT(*) n FROM threads WHERE user_id = ? AND deleted = 0').get(u.id).n,
      comments: db.prepare('SELECT COUNT(*) n FROM comments WHERE user_id = ? AND deleted = 0').get(u.id).n,
      banned: u.status === 'gebannt',
      xp: u.xp, rank: rankOf(u.xp || 0),
      badges: db.prepare('SELECT badge FROM user_badges WHERE user_id = ?').all(u.id).map((b) => b.badge),
    });
  });

  return {
    box, loadUser, requireUser, requirePerm, readGate, postGate, filesGate, identity, meOf, authorOf, AUTHOR_COLS, AUTHOR_JOIN_T, AUTHOR_JOIN_C,
    has, isTeam, setupRequired, teamMfaRequired, issueRecoveryCodes, roleById, hydrate, userRow, nameProblem, skeleton, insName, createUser, passwordProblem,
    activeTimeout, avatarUrl, removeAvatarFile, originOk, PERMISSIONS, STATUSES,
  };
};
