'use strict';
// turkac.org – anonymes Gaming-Forum (Backend)
// Läuft ohne externe Pakete: nur Node.js >= 22.13

// node:sqlite gibt beim Laden eine "ExperimentalWarning" aus – die brauchen wir nicht in der Konsole
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.warn(w);
});

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, now, getSetting, setSetting, tx, DATA_DIR, addColumn } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const SECURE_COOKIES = process.env.SECURE_COOKIES === 'true';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EMOJIS = ['🔥', '👍', '😂', '💀', '❤️', '🎮'];

// Erlaubte Upload-Typen (Endung -> Art, MIME). Bewusst KEIN svg/html, damit kein Skript hochgeladen werden kann.
const FILE_TYPES = {
  '.jpg': ['image', 'image/jpeg'],
  '.jpeg': ['image', 'image/jpeg'],
  '.png': ['image', 'image/png'],
  '.gif': ['image', 'image/gif'],
  '.webp': ['image', 'image/webp'],
  '.mp4': ['video', 'video/mp4'],
  '.webm': ['video', 'video/webm'],
  '.zip': ['file', 'application/zip'],
  '.7z': ['file', 'application/x-7z-compressed'],
  '.pdf': ['file', 'application/pdf'],
  '.txt': ['file', 'text/plain; charset=utf-8'],
};

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

// ======================================================================
// Hilfsfunktionen
// ======================================================================
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
const fail = (res, code, msg) => send(res, code, { error: msg });

function clientIp(req) {
  if (TRUST_PROXY) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '0';
}

// IP wird nie im Klartext gespeichert – nur als gesalzener Hash (für Sperren, Slowmode, Anon-IDs)
const ipHash = (req) => sha(req.ip + getSetting('ip_salt'));
const anonId = (ipH, threadId) => sha(ipH + ':' + threadId).slice(0, 6).toUpperCase();

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* ignorieren */
      }
    }
  }
  return out;
}

// Einfaches In-Memory-Rate-Limit pro IP
const buckets = new Map();
const RATE_FACTOR = Number(process.env.RATE_LIMIT_FACTOR) || 1; // nur für Tests erhöhen
const rl = (name, max, windowMs) => (req, res, next) => {
  max *= RATE_FACTOR;
  const key = name + ':' + req.ip;
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < t) {
    b = { count: 0, reset: t + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  if (b.count > max) {
    res.setHeader('Retry-After', Math.ceil((b.reset - t) / 1000));
    return fail(res, 429, 'Zu viele Anfragen – bitte kurz warten.');
  }
  return next();
};
setInterval(() => {
  const t = Date.now();
  for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM user_sessions WHERE expires_at < ?').run(t);
}, 60_000).unref();

// Text bereinigen + Wortfilter
let wordCache = { at: 0, re: null };
function wordRegex() {
  if (Date.now() - wordCache.at > 5000) {
    const words = db.prepare('SELECT word FROM words').all().map((r) => r.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    wordCache = { at: Date.now(), re: words.length ? new RegExp(words.join('|'), 'gi') : null };
  }
  return wordCache.re;
}
function clean(s, max) {
  let t = String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
  const re = wordRegex();
  if (re) t = t.replace(re, (m) => '✱'.repeat(m.length));
  return t;
}

const _auditLib = require('./lib/audit')({ db, box: require('./lib/secure').makeBox(DATA_DIR), now, addColumn });
const audit = _auditLib.audit;

// ----- Passwörter (scrypt) -----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(pw, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ======================================================================
// Request-Parsing (JSON + multipart/form-data, ohne Fremdpakete)
// ======================================================================
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) {
      req.resume();
      return reject(Object.assign(new Error('Anfrage zu groß'), { status: 413 }));
    }
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return;
      size += c.length;
      if (size > limit) {
        tooBig = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => (tooBig ? reject(Object.assign(new Error('Anfrage zu groß'), { status: 413 })) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

async function jsonBody(req, res, next) {
  try {
    const buf = await readBody(req, 100 * 1024);
    req.body = buf.length ? JSON.parse(buf.toString('utf8')) : {};
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) throw new Error('bad');
  } catch (e) {
    return fail(res, e.status || 400, e.status === 413 ? 'Anfrage zu groß' : 'Ungültige Anfrage');
  }
  return next();
}

function parseMultipart(buf, boundary) {
  const fields = {};
  const files = [];
  const delim = Buffer.from('--' + boundary);
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    pos += delim.length;
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break; // Ende
    pos += 2; // CRLF nach Boundary
    const headerEnd = buf.indexOf('\r\n\r\n', pos);
    if (headerEnd === -1) break;
    const header = buf.subarray(pos, headerEnd).toString('utf8');
    const next = buf.indexOf(delim, headerEnd + 4);
    if (next === -1) break;
    const content = buf.subarray(headerEnd + 4, next - 2); // CRLF vor der nächsten Boundary abschneiden
    const name = /name="([^"]*)"/i.exec(header);
    const filename = /filename="([^"]*)"/i.exec(header);
    if (name) {
      if (filename !== null && filename !== undefined) {
        if (filename[1] && content.length) files.push({ field: name[1], originalname: filename[1], buffer: content, size: content.length });
      } else if (Object.keys(fields).length < 20) {
        fields[name[1]] = content.toString('utf8').slice(0, 20000);
      }
    }
    pos = next;
  }
  return { fields, files };
}

async function multipart(req, res, next) {
  const m = /multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.headers['content-type'] || '');
  if (!m) return fail(res, 400, 'Ungültiger Upload');
  const maxMb = num(getSetting('max_upload_mb', '25'), 25);
  try {
    const buf = await readBody(req, maxMb * 1024 * 1024 * 4 + 512 * 1024);
    const parsed = parseMultipart(buf, m[1] || m[2]);
    req.body = parsed.fields;
    req.files = parsed.files;
  } catch (e) {
    return fail(res, e.status || 400, e.status === 413 ? `Upload zu groß (max. ${maxMb} MB pro Datei, 4 Dateien)` : 'Ungültiger Upload');
  }
  return next();
}

// Dateien prüfen (Endung, Größe, Dateisignatur) – gibt Fehlertext oder null zurück
function sniff(b, ext) {
  const s = (a, z) => b.subarray(a, z).toString('latin1');
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case '.png':
      return b[0] === 0x89 && s(1, 4) === 'PNG';
    case '.gif':
      return s(0, 4) === 'GIF8';
    case '.webp':
      return s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP';
    case '.mp4':
      return s(4, 8) === 'ftyp';
    case '.webm':
      return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    case '.zip':
      return b[0] === 0x50 && b[1] === 0x4b;
    case '.7z':
      return b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf;
    case '.pdf':
      return s(0, 5) === '%PDF-';
    case '.txt':
      return !b.subarray(0, 2048).includes(0);
    default:
      return false;
  }
}

function validateFiles(files) {
  if (!files.length) return null;
  if (getSetting('uploads_enabled', '1') !== '1') return 'Uploads sind aktuell deaktiviert';
  if (files.length > 4) return 'Maximal 4 Dateien pro Beitrag';
  const maxMb = num(getSetting('max_upload_mb', '25'), 25);
  for (const f of files) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (!FILE_TYPES[ext]) return `Dateityp nicht erlaubt: ${ext || f.originalname}`;
    if (f.size > maxMb * 1024 * 1024) return `„${f.originalname}“ ist zu groß (max. ${maxMb} MB)`;
    if (!sniff(f.buffer, ext)) return `„${f.originalname}“ ist keine gültige ${ext}-Datei`;
  }
  return null;
}

function saveFiles(files, threadId, commentId) {
  const written = [];
  try {
    const st = db.prepare(
      'INSERT INTO attachments(thread_id,comment_id,stored_name,original_name,mime,size,kind,created_at) VALUES(?,?,?,?,?,?,?,?)'
    );
    for (const f of files) {
      const ext = path.extname(f.originalname).toLowerCase();
      const stored = crypto.randomBytes(16).toString('hex') + ext;
      fs.writeFileSync(path.join(UPLOAD_DIR, stored), f.buffer);
      written.push(stored);
      const [kind, mime] = FILE_TYPES[ext];
      st.run(threadId, commentId || null, stored, path.basename(f.originalname).slice(0, 120), mime, f.size, kind, now());
    }
  } catch (e) {
    for (const w of written) fs.rmSync(path.join(UPLOAD_DIR, w), { force: true });
    throw e;
  }
}

function removeStored(rows) {
  for (const r of rows) fs.rmSync(path.join(UPLOAD_DIR, r.stored_name), { force: true });
}

// ======================================================================
// Middleware
// ======================================================================
function banCheck(req, res, next) {
  const b = db.prepare('SELECT reason, expires_at FROM bans WHERE ip_hash = ? AND (expires_at IS NULL OR expires_at > ?)').get(ipHash(req), now());
  if (b) {
    const until = b.expires_at ? ` (bis ${new Date(b.expires_at).toLocaleString('de-DE')})` : ' (dauerhaft)';
    return fail(res, 403, 'Du wurdest gesperrt' + (b.reason ? `: ${b.reason}` : '') + until);
  }
  return next();
}

function slowmodeWait(req) {
  const sec = num(getSetting('slowmode_seconds', '10'));
  if (!sec) return 0;
  if (req.user && acc.isTeam(req.user)) return 0; // Team ist vom Slowmode ausgenommen
  const h = ipHash(req);
  const last = req.user
    ? db.prepare('SELECT MAX(t) t FROM (SELECT MAX(created_at) t FROM threads WHERE user_id=? UNION ALL SELECT MAX(created_at) FROM comments WHERE user_id=?)').get(req.user.id, req.user.id).t || 0
    : db.prepare('SELECT MAX(t) t FROM (SELECT MAX(created_at) t FROM threads WHERE ip_hash=? UNION ALL SELECT MAX(created_at) FROM comments WHERE ip_hash=?)').get(h, h).t || 0;
  return Math.max(0, Math.ceil((last + sec * 1000 - Date.now()) / 1000));
}

// ======================================================================
// Router
// ======================================================================
const routes = [];
function route(method, pattern, ...handlers) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push({ method, re, keys, handlers });
}
const GET = (p, ...h) => route('GET', p, ...h);
const POST = (p, ...h) => route('POST', p, ...h);
const PATCH = (p, ...h) => route('PATCH', p, ...h);
const PUT = (p, ...h) => route('PUT', p, ...h);
const DEL = (p, ...h) => route('DELETE', p, ...h);

// ======================================================================
// Module (Konten, Team, Seite) – jedes in eigener Datei unter lib/
// ======================================================================
const ctx = {
  db, now, getSetting, setSetting, tx, DATA_DIR, UPLOAD_DIR, PUBLIC_DIR, SECURE_COOKIES,
  GET, POST, PATCH, PUT, DEL, send, fail, rl, jsonBody, multipart, audit,
  hashPassword, verifyPassword, sha, num, clean, parseCookies, ipHash, wordRegex, serveFile,
};
const acc = require('./lib/accounts')(ctx); // Registrierung, Login, 2FA, Profil
require('./lib/team')(ctx, acc);
require('./lib/economy')(ctx, acc); // Credit-Wirtschaft: Staatskonto, Lostopf
const ranks = require('./lib/ranks')(ctx, acc);
ctx.onLogin = ranks.onLogin;
const spam = require('./lib/spam')(ctx, acc); // Captcha, Spam-Erkennung
ctx.spamRegCheck = spam.checkRegistration;
require('./lib/webauthn')(ctx, acc); // Sicherheitsschlüssel
require('./lib/support')(ctx, acc); // Support-Tickets
require('./lib/tournaments')(ctx, acc); // Turniere
require('./lib/games')(ctx, acc); // Spiele, Bestenliste, Top-10-Rang
require('./lib/inactivity')(ctx, acc); // Inaktivitätsgebühr, Urlaubs-Pause
require('./lib/blog')(ctx, acc); // Blog, News, Werbung
require('./lib/legal')(ctx, acc); // Impressum, Datenschutz, Nutzungsbedingungen, Regeln
require('./lib/dm')(ctx, acc); // Direktnachrichten, Teilen als Nachricht
const site = require('./lib/site')(ctx, acc); // Wartungsmodus, Landingpage
const { requirePerm, readGate, postGate, filesGate, identity, authorOf, AUTHOR_COLS, AUTHOR_JOIN_T, AUTHOR_JOIN_C } = acc;

// ======================================================================
// Öffentliche API
// ======================================================================
const catOf = (r) => ({ slug: r.cat_slug, name: r.cat_name, icon: r.cat_icon, color: r.cat_color });

GET('/api/config', (req, res) => {
  send(res, 200, {
    site_name: getSetting('site_name'),
    tagline: getSetting('tagline'),
    announcement: getSetting('announcement_on') === '1' ? getSetting('announcement') : '',
    uploads_enabled: getSetting('uploads_enabled') === '1',
    allow_new_threads: getSetting('allow_new_threads') === '1',
    max_upload_mb: num(getSetting('max_upload_mb'), 25),
    emojis: EMOJIS,
    allowed_ext: Object.keys(FILE_TYPES),
    guest_read: getSetting('guest_read', '1') === '1',
    require_login_to_post: getSetting('require_login_to_post', '1') === '1',
    registration_open: getSetting('registration_open', '1') === '1',
    captcha: getSetting('captcha_on', '1') === '1',
    maintenance: req.user && acc.isTeam(req.user) && site.maintenanceState().active ? { active: true, until: site.maintenanceState().until || null } : null,
  });
});

GET('/api/categories', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.description, c.icon, c.color,
        (SELECT COUNT(*) FROM threads t WHERE t.category_id = c.id AND t.deleted = 0) threads
       FROM categories c ORDER BY c.sort, c.id`
    )
    .all();
  send(res, 200, { categories: rows });
});

GET('/api/stats', (req, res) => {
  const n = (sql) => db.prepare(sql).get().n;
  send(res, 200, {
    threads: n('SELECT COUNT(*) n FROM threads WHERE deleted=0'),
    comments: n('SELECT COUNT(*) n FROM comments WHERE deleted=0'),
    files: n('SELECT COUNT(*) n FROM attachments'),
    reactions: n('SELECT COUNT(*) n FROM reactions'),
    members: n('SELECT COUNT(*) n FROM users WHERE deleted=0'),
  });
});

GET('/api/threads', readGate, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const per = 12;
  const where = ['t.deleted = 0'];
  const args = [];
  if (req.query.cat) {
    where.push('c.slug = ?');
    args.push(String(req.query.cat));
  }
  if (req.query.q) {
    const like = '%' + String(req.query.q).slice(0, 60).replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    where.push("(t.title LIKE ? ESCAPE '\\' OR t.body LIKE ? ESCAPE '\\')");
    args.push(like, like);
  }
  const W = where.join(' AND ');
  const base = `
    SELECT t.id, t.title, t.body, t.nickname, t.ip_hash, t.user_id, t.created_at, t.bumped_at, t.pinned, t.locked, t.views, ${AUTHOR_COLS},
      c.slug cat_slug, c.name cat_name, c.icon cat_icon, c.color cat_color,
      (SELECT COUNT(*) FROM comments m WHERE m.thread_id = t.id AND m.deleted = 0) comment_count,
      (SELECT COUNT(*) FROM reactions r WHERE r.target_type = 'thread' AND r.target_id = t.id) reaction_count,
      (SELECT a.stored_name FROM attachments a WHERE a.thread_id = t.id AND a.comment_id IS NULL AND a.kind IN ('image','video') ORDER BY (a.kind='image') DESC, a.id LIMIT 1) thumb,
      (SELECT a.kind FROM attachments a WHERE a.thread_id = t.id AND a.comment_id IS NULL AND a.kind IN ('image','video') ORDER BY (a.kind='image') DESC, a.id LIMIT 1) thumb_kind,
      (SELECT COUNT(*) FROM attachments a WHERE a.thread_id = t.id) file_count
    FROM threads t JOIN categories c ON c.id = t.category_id ${AUTHOR_JOIN_T} WHERE ${W}`;
  const total = db.prepare(`SELECT COUNT(*) n FROM threads t JOIN categories c ON c.id = t.category_id WHERE ${W}`).get(...args).n;

  const sort = ['new', 'active', 'top', 'hot'].includes(req.query.sort) ? req.query.sort : 'active';
  let rows;
  if (sort === 'hot') {
    rows = db.prepare(`SELECT * FROM (${base}) ORDER BY created_at DESC LIMIT 300`).all(...args);
    const t = Date.now();
    const score = (r) => (r.reaction_count * 2 + r.comment_count * 3 + r.views * 0.1 + 1) / Math.pow((t - r.created_at) / 3600000 + 2, 1.3);
    rows.sort((a, b) => b.pinned - a.pinned || score(b) - score(a));
    rows = rows.slice((page - 1) * per, page * per);
  } else {
    const order = {
      new: 'pinned DESC, created_at DESC',
      active: 'pinned DESC, bumped_at DESC',
      top: 'pinned DESC, (reaction_count * 2 + comment_count) DESC, created_at DESC',
    }[sort];
    rows = db.prepare(`SELECT * FROM (${base}) ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per);
  }

  send(res, 200, {
    page,
    pages: Math.max(1, Math.ceil(total / per)),
    total,
    threads: rows.map((r) => ({
      id: r.id,
      title: r.title,
      snippet: r.body.slice(0, 220),
      nickname: r.nickname,
      anon_id: anonId(r.ip_hash, r.id),
      author: authorOf(r),
      created_at: r.created_at,
      bumped_at: r.bumped_at,
      pinned: !!r.pinned,
      locked: !!r.locked,
      views: r.views,
      category: catOf(r),
      comment_count: r.comment_count,
      reaction_count: r.reaction_count,
      thumb: r.thumb,
      thumb_kind: r.thumb_kind,
      file_count: r.file_count,
    })),
  });
});

const attOut = (a) => ({ id: a.id, name: a.stored_name, original: a.original_name, mime: a.mime, size: a.size, kind: a.kind });

GET('/api/threads/:id', readGate, (req, res) => {
  const id = num(req.params.id);
  const t = db
    .prepare(
      `SELECT t.*, c.slug cat_slug, c.name cat_name, c.icon cat_icon, c.color cat_color, ${AUTHOR_COLS}
       FROM threads t JOIN categories c ON c.id = t.category_id ${AUTHOR_JOIN_T} WHERE t.id = ? AND t.deleted = 0`
    )
    .get(id);
  if (!t) return fail(res, 404, 'Thread nicht gefunden');
  if (req.query.v !== '0') db.prepare('UPDATE threads SET views = views + 1 WHERE id = ?').run(id);

  const me = identity(req);
  const comments = db.prepare(`SELECT c.*, ${AUTHOR_COLS} FROM comments c ${AUTHOR_JOIN_C} WHERE c.thread_id = ? AND c.deleted = 0 ORDER BY c.id`).all(id);
  const atts = db.prepare('SELECT * FROM attachments WHERE thread_id = ? ORDER BY id').all(id);
  const rx = db
    .prepare(
      `SELECT target_type, target_id, emoji, COUNT(*) n, SUM(ip_hash = ?) mine FROM reactions
       WHERE (target_type = 'thread' AND target_id = ?) OR (target_type = 'comment' AND target_id IN (SELECT id FROM comments WHERE thread_id = ?))
       GROUP BY target_type, target_id, emoji`
    )
    .all(me, id, id);

  const rxMap = {};
  for (const r of rx) {
    const k = r.target_type + ':' + r.target_id;
    (rxMap[k] = rxMap[k] || {})[r.emoji] = { n: r.n, mine: !!r.mine };
  }
  const attMap = {};
  for (const a of atts) (attMap[a.comment_id || 0] = attMap[a.comment_id || 0] || []).push(attOut(a));

  send(res, 200, {
    thread: {
      id: t.id,
      title: t.title,
      body: t.body,
      nickname: t.nickname,
      anon_id: anonId(t.ip_hash, t.id),
      author: authorOf(t),
      created_at: t.created_at,
      views: t.views,
      pinned: !!t.pinned,
      locked: !!t.locked,
      category: catOf(t),
      attachments: attMap[0] || [],
      reactions: rxMap['thread:' + t.id] || {},
    },
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      nickname: c.nickname,
      anon_id: anonId(c.ip_hash, id),
      author: authorOf(c),
      is_op: c.user_id ? c.user_id === t.user_id : c.ip_hash === t.ip_hash,
      created_at: c.created_at,
      attachments: attMap[c.id] || [],
      reactions: rxMap['comment:' + c.id] || {},
    })),
  });
});

POST('/api/threads', rl('post', 20, 60_000), banCheck, postGate('thread'), multipart, filesGate, (req, res) => {
  if (getSetting('allow_new_threads', '1') !== '1') return fail(res, 403, 'Neue Threads sind aktuell deaktiviert');
  const files = req.files || [];
  const title = clean(req.body.title, 120);
  const body = clean(req.body.body, 5000);
  const nickname = req.user ? '' : clean(req.body.nickname, 24).replace(/\n/g, ' ');
  const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(num(req.body.category_id));
  if (!cat) return fail(res, 400, 'Bitte wähle eine Kategorie');
  if (title.length < 3) return fail(res, 400, 'Der Titel braucht mindestens 3 Zeichen');
  if (!body && !files.length) return fail(res, 400, 'Schreib etwas oder hänge eine Datei an');
  const fe = validateFiles(files);
  if (fe) return fail(res, 400, fe);
  const sp = spam.checkContent(req.user, 'thread', body, title);
  if (sp) return fail(res, 400, sp);
  const wait = slowmodeWait(req);
  if (wait) return fail(res, 429, `Slowmode: bitte noch ${wait}s warten`);

  const t = now();
  const id = tx(() => {
    const r = db
      .prepare('INSERT INTO threads(category_id,title,body,nickname,ip_hash,created_at,bumped_at,user_id) VALUES(?,?,?,?,?,?,?,?)')
      .run(cat.id, title, body, nickname, ipHash(req), t, t, req.user ? req.user.id : null);
    const tid = Number(r.lastInsertRowid);
    saveFiles(files, tid, null);
    return tid;
  });
  send(res, 201, { id, reward: ranks.onThread(req.user, id, title, body) });
});

POST('/api/threads/:id/comments', rl('comment', 40, 60_000), banCheck, postGate('comment'), multipart, filesGate, (req, res) => {
  const id = num(req.params.id);
  const t = db.prepare('SELECT id, locked FROM threads WHERE id = ? AND deleted = 0').get(id);
  if (!t) return fail(res, 404, 'Thread nicht gefunden');
  if (t.locked) return fail(res, 403, 'Dieser Thread ist gesperrt 🔒');
  const files = req.files || [];
  const body = clean(req.body.body, 2000);
  const nickname = req.user ? '' : clean(req.body.nickname, 24).replace(/\n/g, ' ');
  if (!body && !files.length) return fail(res, 400, 'Schreib etwas oder hänge eine Datei an');
  const fe = validateFiles(files);
  if (fe) return fail(res, 400, fe);
  const sp = spam.checkContent(req.user, 'comment', body);
  if (sp) return fail(res, 400, sp);
  const wait = slowmodeWait(req);
  if (wait) return fail(res, 429, `Slowmode: bitte noch ${wait}s warten`);

  const cid = tx(() => {
    const r = db.prepare('INSERT INTO comments(thread_id,body,nickname,ip_hash,created_at,user_id) VALUES(?,?,?,?,?,?)').run(id, body, nickname, ipHash(req), now(), req.user ? req.user.id : null);
    const c = Number(r.lastInsertRowid);
    saveFiles(files, id, c);
    db.prepare('UPDATE threads SET bumped_at = ? WHERE id = ?').run(now(), id);
    return c;
  });
  send(res, 201, { id: cid, reward: ranks.onComment(req.user, cid, id, body) });
});

function reactionsFor(type, id, me) {
  const out = {};
  for (const r of db
    .prepare('SELECT emoji, COUNT(*) n, SUM(ip_hash = ?) mine FROM reactions WHERE target_type = ? AND target_id = ? GROUP BY emoji')
    .all(me, type, id))
    out[r.emoji] = { n: r.n, mine: !!r.mine };
  return out;
}

function targetExists(type, id) {
  if (type === 'thread') return !!db.prepare('SELECT 1 FROM threads WHERE id = ? AND deleted = 0').get(id);
  if (type === 'comment') return !!db.prepare('SELECT 1 FROM comments WHERE id = ? AND deleted = 0').get(id);
  return false;
}

POST('/api/react', rl('react', 120, 60_000), banCheck, jsonBody, postGate('react'), (req, res) => {
  const { type, emoji } = req.body;
  const id = num(req.body.id);
  if (!EMOJIS.includes(emoji) || !targetExists(type, id)) return fail(res, 400, 'Ungültige Reaktion');
  const me = identity(req);
  const del = db.prepare('DELETE FROM reactions WHERE target_type=? AND target_id=? AND emoji=? AND ip_hash=?').run(type, id, emoji, me);
  if (!del.changes) { db.prepare('INSERT INTO reactions(target_type,target_id,emoji,ip_hash) VALUES(?,?,?,?)').run(type, id, emoji, me); ranks.onReaction(req.user, type, id); }
  send(res, 200, { added: !del.changes, reactions: reactionsFor(type, id, me) });
});

const REPORT_CATS = ['spam', 'beleidigung', 'hass', 'illegal', 'jugendschutz', 'datenschutz', 'sonstiges'];
POST('/api/report', rl('report', 10, 600_000), banCheck, jsonBody, postGate('report'), (req, res) => {
  const { type } = req.body;
  const id = num(req.body.id);
  if (!targetExists(type, id)) return fail(res, 400, 'Ungültiges Ziel');
  const me = identity(req);
  if (db.prepare('SELECT 1 FROM reports WHERE target_type=? AND target_id=? AND ip_hash=? AND resolved=0').get(type, id, me))
    return fail(res, 409, 'Du hast das bereits gemeldet');
  const category = REPORT_CATS.includes(req.body.category) ? req.body.category : 'sonstiges';
  db.prepare('INSERT INTO reports(target_type,target_id,reason,ip_hash,created_at,category,reporter_user) VALUES(?,?,?,?,?,?,?)').run(type, id, clean(req.body.reason, 300), me, now(), category, req.user ? req.user.id : null);
  send(res, 201, { ok: true });
});

// Uploads ausliefern (mit Range-Unterstützung für Videos)
function serveFile(req, res, file, opts = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return fail(res, 404, 'Nicht gefunden');
    const ext = path.extname(file).toLowerCase();
    const type = opts.type || STATIC_MIME[ext] || 'application/octet-stream';
    const h = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': opts.cache || 'no-cache',
      'Last-Modified': st.mtime.toUTCString(),
    };
    if (opts.download) h['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`;
    if (opts.extra) Object.assign(h, opts.extra);
    let start = 0;
    let end = st.size - 1;
    let code = opts.status || 200;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && st.size > 0) {
      if (m[1] === '' && m[2] !== '') start = Math.max(0, st.size - Number(m[2]));
      else {
        if (m[1] !== '') start = Number(m[1]);
        if (m[2] !== '') end = Math.min(end, Number(m[2]));
      }
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      code = 206;
      h['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    h['Content-Length'] = st.size ? end - start + 1 : 0;
    res.writeHead(code, h);
    if (req.method === 'HEAD' || !st.size) return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
  });
}

GET('/uploads/:name', readGate, (req, res) => {
  const name = req.params.name;
  if (!/^[a-f0-9]{32}\.[a-z0-9]{2,5}$/.test(name)) return fail(res, 404, 'Nicht gefunden');
  const a = db.prepare('SELECT * FROM attachments WHERE stored_name = ?').get(name);
  if (!a) return fail(res, 404, 'Nicht gefunden');
  serveFile(req, res, path.join(UPLOAD_DIR, name), {
    type: a.mime,
    cache: 'public, max-age=604800, immutable',
    download: a.kind === 'file' ? a.original_name : null,
    extra: { 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin' },
  });
});

// ======================================================================
// Admin-API
// ======================================================================
GET('/api/admin/stats', requirePerm('stats.view'), (req, res) => {
  const n = (sql, ...p) => db.prepare(sql).get(...p).n;
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const d0 = day.getTime();
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const a = d0 - i * 86400000;
    const b = a + 86400000;
    series.push({
      day: new Date(a).toISOString().slice(5, 10),
      threads: n('SELECT COUNT(*) n FROM threads WHERE created_at >= ? AND created_at < ?', a, b),
      comments: n('SELECT COUNT(*) n FROM comments WHERE created_at >= ? AND created_at < ?', a, b),
    });
  }
  send(res, 200, {
    threads: n('SELECT COUNT(*) n FROM threads WHERE deleted = 0'),
    comments: n('SELECT COUNT(*) n FROM comments WHERE deleted = 0'),
    deleted: n('SELECT (SELECT COUNT(*) FROM threads WHERE deleted=1) + (SELECT COUNT(*) FROM comments WHERE deleted=1) n'),
    files: n('SELECT COUNT(*) n FROM attachments'),
    storage: n('SELECT COALESCE(SUM(size),0) n FROM attachments'),
    reactions: n('SELECT COUNT(*) n FROM reactions'),
    members: n('SELECT COUNT(*) n FROM users WHERE deleted = 0'),
    today_members: n('SELECT COUNT(*) n FROM users WHERE created_at >= ?', d0),
    open_reports: n('SELECT COUNT(*) n FROM reports WHERE resolved = 0'),
    open_tickets: n("SELECT COUNT(*) n FROM tickets WHERE status = 'open'"),
    active_bans: n('SELECT COUNT(*) n FROM bans WHERE expires_at IS NULL OR expires_at > ?', now()),
    today_threads: n('SELECT COUNT(*) n FROM threads WHERE created_at >= ?', d0),
    today_comments: n('SELECT COUNT(*) n FROM comments WHERE created_at >= ?', d0),
    series,
    categories: db
      .prepare('SELECT c.name, c.color, COUNT(t.id) n FROM categories c LEFT JOIN threads t ON t.category_id = c.id AND t.deleted = 0 GROUP BY c.id ORDER BY n DESC')
      .all(),
  });
});

const PAGE = 20;
const pageOf = (req) => Math.max(1, parseInt(req.query.page) || 1);
const likeOf = (q) => '%' + String(q).slice(0, 60).replace(/[\\%_]/g, (m) => '\\' + m) + '%';

// ----- Threads -----
GET('/api/admin/threads', requirePerm('threads.moderate'), (req, res) => {
  const where = ['1=1'];
  const args = [];
  const st = req.query.status;
  if (st === 'active') where.push('t.deleted = 0');
  if (st === 'deleted') where.push('t.deleted = 1');
  if (st === 'pinned') where.push('t.pinned = 1');
  if (st === 'locked') where.push('t.locked = 1');
  if (req.query.q) {
    where.push("(t.title LIKE ? ESCAPE '\\' OR t.body LIKE ? ESCAPE '\\')");
    args.push(likeOf(req.query.q), likeOf(req.query.q));
  }
  const W = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) n FROM threads t WHERE ${W}`).get(...args).n;
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.body, t.nickname, t.ip_hash, t.user_id, (SELECT username FROM users WHERE id = t.user_id) author, t.created_at, t.pinned, t.locked, t.deleted, t.views, t.category_id, c.name cat_name,
        (SELECT COUNT(*) FROM comments m WHERE m.thread_id = t.id) comments,
        (SELECT COUNT(*) FROM attachments a WHERE a.thread_id = t.id AND a.comment_id IS NULL) files
       FROM threads t JOIN categories c ON c.id = t.category_id WHERE ${W} ORDER BY t.id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, PAGE, (pageOf(req) - 1) * PAGE);
  send(res, 200, { total, pages: Math.max(1, Math.ceil(total / PAGE)), rows });
});

PATCH('/api/admin/threads/:id', requirePerm('threads.moderate'), jsonBody, (req, res) => {
  const id = num(req.params.id);
  const t = db.prepare('SELECT * FROM threads WHERE id = ?').get(id);
  if (!t) return fail(res, 404, 'Nicht gefunden');
  const b = req.body;
  const log = [];
  for (const f of ['pinned', 'locked', 'deleted']) {
    if (f in b) {
      db.prepare(`UPDATE threads SET ${f} = ? WHERE id = ?`).run(b[f] ? 1 : 0, id);
      log.push(`${f}=${b[f] ? 1 : 0}`);
    }
  }
  if ('category_id' in b) {
    if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(num(b.category_id))) return fail(res, 400, 'Kategorie ungültig');
    db.prepare('UPDATE threads SET category_id = ? WHERE id = ?').run(num(b.category_id), id);
    log.push('category=' + num(b.category_id));
  }
  if ('title' in b) {
    const title = String(b.title).trim().slice(0, 120);
    if (title.length < 3) return fail(res, 400, 'Titel zu kurz');
    db.prepare('UPDATE threads SET title = ? WHERE id = ?').run(title, id);
    log.push('title');
  }
  audit(req.admin.username, 'thread_update', `#${id} ${log.join(', ')}`);
  send(res, 200, { ok: true });
});

DEL('/api/admin/threads/:id', requirePerm('threads.moderate'), (req, res) => {
  const id = num(req.params.id);
  if (!db.prepare('SELECT 1 FROM threads WHERE id = ?').get(id)) return fail(res, 404, 'Nicht gefunden');
  const atts = db.prepare('SELECT stored_name FROM attachments WHERE thread_id = ?').all(id);
  tx(() => {
    const cids = db.prepare('SELECT id FROM comments WHERE thread_id = ?').all(id).map((r) => r.id);
    for (const c of cids) {
      db.prepare("DELETE FROM reactions WHERE target_type='comment' AND target_id=?").run(c);
      db.prepare("DELETE FROM reports WHERE target_type='comment' AND target_id=?").run(c);
    }
    db.prepare("DELETE FROM reactions WHERE target_type='thread' AND target_id=?").run(id);
    db.prepare("DELETE FROM reports WHERE target_type='thread' AND target_id=?").run(id);
    db.prepare('DELETE FROM attachments WHERE thread_id = ?').run(id);
    db.prepare('DELETE FROM threads WHERE id = ?').run(id);
  });
  removeStored(atts);
  audit(req.admin.username, 'thread_purge', `#${id}`);
  send(res, 200, { ok: true });
});

// ----- Kommentare -----
GET('/api/admin/comments', requirePerm('comments.moderate'), (req, res) => {
  const where = ['1=1'];
  const args = [];
  if (req.query.status === 'active') where.push('m.deleted = 0');
  if (req.query.status === 'deleted') where.push('m.deleted = 1');
  if (req.query.q) {
    where.push("m.body LIKE ? ESCAPE '\\'");
    args.push(likeOf(req.query.q));
  }
  const W = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) n FROM comments m WHERE ${W}`).get(...args).n;
  const rows = db
    .prepare(
      `SELECT m.id, m.thread_id, m.body, m.nickname, m.ip_hash, m.user_id, (SELECT username FROM users WHERE id = m.user_id) author, m.created_at, m.deleted, t.title thread_title,
        (SELECT COUNT(*) FROM attachments a WHERE a.comment_id = m.id) files
       FROM comments m JOIN threads t ON t.id = m.thread_id WHERE ${W} ORDER BY m.id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, PAGE, (pageOf(req) - 1) * PAGE);
  send(res, 200, { total, pages: Math.max(1, Math.ceil(total / PAGE)), rows });
});

PATCH('/api/admin/comments/:id', requirePerm('comments.moderate'), jsonBody, (req, res) => {
  const id = num(req.params.id);
  if (!db.prepare('SELECT 1 FROM comments WHERE id = ?').get(id)) return fail(res, 404, 'Nicht gefunden');
  db.prepare('UPDATE comments SET deleted = ? WHERE id = ?').run(req.body.deleted ? 1 : 0, id);
  audit(req.admin.username, 'comment_update', `#${id} deleted=${req.body.deleted ? 1 : 0}`);
  send(res, 200, { ok: true });
});

DEL('/api/admin/comments/:id', requirePerm('comments.moderate'), (req, res) => {
  const id = num(req.params.id);
  if (!db.prepare('SELECT 1 FROM comments WHERE id = ?').get(id)) return fail(res, 404, 'Nicht gefunden');
  const atts = db.prepare('SELECT stored_name FROM attachments WHERE comment_id = ?').all(id);
  tx(() => {
    db.prepare('DELETE FROM attachments WHERE comment_id = ?').run(id);
    db.prepare("DELETE FROM reactions WHERE target_type='comment' AND target_id=?").run(id);
    db.prepare("DELETE FROM reports WHERE target_type='comment' AND target_id=?").run(id);
    db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  });
  removeStored(atts);
  audit(req.admin.username, 'comment_purge', `#${id}`);
  send(res, 200, { ok: true });
});

// ----- Medien -----
GET('/api/admin/media', requirePerm('media.manage'), (req, res) => {
  const total = db.prepare('SELECT COUNT(*) n FROM attachments').get().n;
  const rows = db
    .prepare(
      `SELECT a.id, a.stored_name, a.original_name, a.kind, a.size, a.created_at, a.thread_id, a.comment_id, t.title thread_title
       FROM attachments a LEFT JOIN threads t ON t.id = a.thread_id ORDER BY a.id DESC LIMIT 24 OFFSET ?`
    )
    .all((pageOf(req) - 1) * 24);
  send(res, 200, { total, pages: Math.max(1, Math.ceil(total / 24)), rows });
});

DEL('/api/admin/media/:id', requirePerm('media.manage'), (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(num(req.params.id));
  if (!a) return fail(res, 404, 'Nicht gefunden');
  db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
  removeStored([a]);
  audit(req.admin.username, 'media_delete', `${a.original_name} (#${a.id})`);
  send(res, 200, { ok: true });
});

// ----- Meldungen (Meldezentrum) -----
// Eine Karte pro gemeldetem Inhalt; Status: open → working → done
GET('/api/admin/reports', requirePerm('reports.handle'), (req, res) => {
  const done = req.query.status === 'resolved';
  const cat = REPORT_CATS.includes(req.query.category) ? req.query.category : null;
  const groups = db.prepare(`SELECT target_type, target_id, COUNT(*) n, MAX(created_at) last_at, MIN(created_at) first_at, MIN(id) id
    FROM reports WHERE resolved = ? ${cat ? 'AND category = ?' : ''} GROUP BY target_type, target_id
    ORDER BY ${done ? 'last_at' : "(SUM(category IN ('illegal','jugendschutz')) > 0) DESC, n DESC, first_at"} ${done ? 'DESC' : ''} LIMIT 100`).all(...(cat ? [done ? 1 : 0, cat] : [done ? 1 : 0]));
  const rows = groups.map((g) => {
    const reps = db.prepare('SELECT id, reason, category, status, handled_by, handled_at, note, outcome, created_at, reporter_user, (SELECT username FROM users WHERE id = reports.reporter_user) reporter FROM reports WHERE target_type=? AND target_id=? AND resolved=? ORDER BY id').all(g.target_type, g.target_id, done ? 1 : 0);
    let tgt;
    if (g.target_type === 'thread') tgt = db.prepare('SELECT id, title, body, ip_hash, deleted, user_id, (SELECT username FROM users WHERE id = threads.user_id) author FROM threads WHERE id = ?').get(g.target_id);
    else tgt = db.prepare('SELECT m.id, m.thread_id, m.body, m.ip_hash, m.deleted, m.user_id, (SELECT username FROM users WHERE id = m.user_id) author FROM comments m WHERE m.id = ?').get(g.target_id);
    const cats = {}; for (const r of reps) cats[r.category] = (cats[r.category] || 0) + 1;
    const status = reps.some((r) => r.status === 'working') ? 'working' : reps[0] ? reps[0].status : 'open';
    return { id: reps[0] ? reps[0].id : g.id, target_type: g.target_type, target_id: g.target_id, count: g.n, created_at: g.first_at, last_at: g.last_at, status,
      handled_by: (reps.find((r) => r.handled_by) || {}).handled_by || null, note: (reps.find((r) => r.note) || {}).note || '', outcome: (reps.find((r) => r.outcome) || {}).outcome || '',
      categories: cats, urgent: !!(cats.illegal || cats.jugendschutz),
      reports: reps.map((r) => ({ id: r.id, reason: r.reason, category: r.category, created_at: r.created_at, reporter: r.reporter || null })),
      reason: (reps.find((r) => r.reason) || {}).reason || '',
      target: tgt ? { ...tgt, body: String(tgt.body).slice(0, 600) } : null };
  });
  send(res, 200, { rows, categories: REPORT_CATS });
});

// „In Bearbeitung nehmen“ (Status working) bzw. zurückgeben (open)
POST('/api/admin/reports/:id/claim', requirePerm('reports.handle'), jsonBody, (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(num(req.params.id));
  if (!r) return fail(res, 404, 'Nicht gefunden');
  const release = req.body.release === true;
  db.prepare('UPDATE reports SET status = ?, handled_by = ?, handled_at = ? WHERE target_type = ? AND target_id = ? AND resolved = 0').run(release ? 'open' : 'working', release ? null : req.admin.username, now(), r.target_type, r.target_id);
  audit(req.admin.username, release ? 'report_release' : 'report_claim', `${r.target_type} #${r.target_id}`);
  send(res, 200, { ok: true });
});

POST('/api/admin/reports/:id/resolve', requirePerm('reports.handle'), jsonBody, (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(num(req.params.id));
  if (!r) return fail(res, 404, 'Nicht gefunden');
  const action = ['dismiss', 'delete', 'ban'].includes(req.body.action) ? req.body.action : 'dismiss';
  const table = r.target_type === 'thread' ? 'threads' : 'comments';
  if (action === 'ban' && !acc.has(req.user, 'bans.ip')) return fail(res, 403, 'Dir fehlt das Recht für IP-Sperren');
  if (action === 'delete') db.prepare(`UPDATE ${table} SET deleted = 1 WHERE id = ?`).run(r.target_id);
  if (action === 'ban') {
    const t = db.prepare(`SELECT ip_hash FROM ${table} WHERE id = ?`).get(r.target_id);
    if (t && t.ip_hash !== 'system') {
      db.prepare('INSERT INTO bans(ip_hash,reason,created_at,expires_at) VALUES(?,?,?,NULL) ON CONFLICT(ip_hash) DO UPDATE SET reason = excluded.reason, expires_at = NULL').run(t.ip_hash, 'Meldung bestätigt', now());
    }
    db.prepare(`UPDATE ${table} SET deleted = 1 WHERE id = ?`).run(r.target_id);
  }
  const note = clean(req.body.note || '', 300);
  db.prepare("UPDATE reports SET resolved = 1, status = 'done', handled_by = ?, handled_at = ?, note = ?, outcome = ? WHERE target_type = ? AND target_id = ? AND resolved = 0").run(req.admin.username, now(), note, action, r.target_type, r.target_id);
  audit(req.admin.username, 'report_' + action, `${r.target_type} #${r.target_id}${note ? ' – ' + note : ''}`);
  send(res, 200, { ok: true });
});

// ----- Sperren -----
GET('/api/admin/bans', requirePerm('bans.ip'), (req, res) => {
  send(res, 200, { rows: db.prepare('SELECT * FROM bans ORDER BY id DESC').all().map((b) => ({ ...b, active: !b.expires_at || b.expires_at > now() })) });
});

POST('/api/admin/bans', requirePerm('bans.ip'), jsonBody, (req, res) => {
  let h = String(req.body.ip_hash || '');
  if (!h && req.body.type && req.body.id) {
    const table = req.body.type === 'thread' ? 'threads' : 'comments';
    const row = db.prepare(`SELECT ip_hash FROM ${table} WHERE id = ?`).get(num(req.body.id));
    h = row ? row.ip_hash : '';
  }
  if (!/^[a-f0-9]{64}$/.test(h)) return fail(res, 400, 'Dieser Beitrag kann nicht gesperrt werden');
  const hours = num(req.body.hours);
  const expires = hours > 0 ? now() + hours * 3600_000 : null;
  db.prepare('INSERT INTO bans(ip_hash,reason,created_at,expires_at) VALUES(?,?,?,?) ON CONFLICT(ip_hash) DO UPDATE SET reason=excluded.reason, created_at=excluded.created_at, expires_at=excluded.expires_at').run(
    h,
    String(req.body.reason || '').slice(0, 200),
    now(),
    expires
  );
  audit(req.admin.username, 'ban', `${h.slice(0, 8)}… ${hours > 0 ? hours + 'h' : 'permanent'}`);
  send(res, 201, { ok: true });
});

DEL('/api/admin/bans/:id', requirePerm('bans.ip'), (req, res) => {
  db.prepare('DELETE FROM bans WHERE id = ?').run(num(req.params.id));
  audit(req.admin.username, 'unban', '#' + num(req.params.id));
  send(res, 200, { ok: true });
});

// ----- Wortfilter -----
GET('/api/admin/words', requirePerm('words.manage'), (req, res) => send(res, 200, { rows: db.prepare('SELECT * FROM words ORDER BY word').all() }));
POST('/api/admin/words', requirePerm('words.manage'), jsonBody, (req, res) => {
  const w = String(req.body.word || '').trim().toLowerCase().slice(0, 40);
  if (w.length < 2) return fail(res, 400, 'Mindestens 2 Zeichen');
  db.prepare('INSERT OR IGNORE INTO words(word) VALUES(?)').run(w);
  wordCache.at = 0;
  audit(req.admin.username, 'word_add', w);
  send(res, 201, { ok: true });
});
DEL('/api/admin/words/:id', requirePerm('words.manage'), (req, res) => {
  db.prepare('DELETE FROM words WHERE id = ?').run(num(req.params.id));
  wordCache.at = 0;
  audit(req.admin.username, 'word_remove', '#' + num(req.params.id));
  send(res, 200, { ok: true });
});

// ----- Kategorien -----
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);

function catFields(b) {
  const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#00f0ff';
  return { name: String(b.name || '').trim().slice(0, 40), description: String(b.description || '').trim().slice(0, 120), icon: String(b.icon || '🎮').trim().slice(0, 8), color, sort: num(b.sort) };
}

GET('/api/admin/categories', requirePerm('categories.manage'), (req, res) => {
  send(res, 200, { rows: db.prepare('SELECT c.*, (SELECT COUNT(*) FROM threads t WHERE t.category_id = c.id) threads FROM categories c ORDER BY sort, id').all() });
});
POST('/api/admin/categories', requirePerm('categories.manage'), jsonBody, (req, res) => {
  const f = catFields(req.body);
  const slug = slugify(f.name);
  if (f.name.length < 2 || !slug) return fail(res, 400, 'Name ungültig');
  if (db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(slug)) return fail(res, 409, 'Kategorie existiert bereits');
  db.prepare('INSERT INTO categories(slug,name,description,icon,color,sort) VALUES(?,?,?,?,?,?)').run(slug, f.name, f.description, f.icon, f.color, f.sort);
  audit(req.admin.username, 'category_add', f.name);
  send(res, 201, { ok: true });
});
PUT('/api/admin/categories/:id', requirePerm('categories.manage'), jsonBody, (req, res) => {
  const f = catFields(req.body);
  if (f.name.length < 2) return fail(res, 400, 'Name ungültig');
  db.prepare('UPDATE categories SET name=?, description=?, icon=?, color=?, sort=? WHERE id=?').run(f.name, f.description, f.icon, f.color, f.sort, num(req.params.id));
  audit(req.admin.username, 'category_edit', f.name);
  send(res, 200, { ok: true });
});
DEL('/api/admin/categories/:id', requirePerm('categories.manage'), (req, res) => {
  const id = num(req.params.id);
  if (db.prepare('SELECT 1 FROM threads WHERE category_id = ?').get(id)) return fail(res, 409, 'Kategorie enthält noch Threads – verschiebe sie zuerst');
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  audit(req.admin.username, 'category_delete', '#' + id);
  send(res, 200, { ok: true });
});

// ----- Einstellungen -----
const SETTING_KEYS = ['site_name', 'tagline', 'announcement', 'announcement_on', 'uploads_enabled', 'max_upload_mb', 'slowmode_seconds', 'allow_new_threads', 'registration_open', 'require_login_to_post', 'guest_read', 'captcha_on', 'captcha_mode', 'team_mfa_required'];
GET('/api/admin/settings', requirePerm('settings.edit'), (req, res) => {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = getSetting(k);
  send(res, 200, out);
});
PUT('/api/admin/settings', requirePerm('settings.edit'), jsonBody, (req, res) => {
  const b = req.body;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(num(v, lo))));
  for (const k of SETTING_KEYS) {
    if (!(k in b)) continue;
    let v = b[k];
    if (k === 'site_name') v = String(v).trim().slice(0, 30) || 'turkac.org';
    else if (k === 'tagline') v = String(v).trim().slice(0, 100);
    else if (k === 'announcement') v = String(v).trim().slice(0, 300);
    else if (k === 'max_upload_mb') v = clamp(v, 1, 200);
    else if (k === 'slowmode_seconds') v = clamp(v, 0, 3600);
    else if (k === 'captcha_mode') v = ['pow', 'math', 'image'].includes(v) ? v : 'pow';
    else v = v === true || v === '1' || v === 1 ? '1' : '0';
    setSetting(k, v);
  }
  audit(req.admin.username, 'settings_update', Object.keys(b).join(', '));
  send(res, 200, { ok: true });
});

GET('/api/admin/audit', requirePerm('audit.view'), (req, res) => {
  const page = Math.max(1, num(req.query.page) || 1);
  send(res, 200, { ..._auditLib.list({ page, q: String(req.query.q || '').slice(0, 80) }), chain: _auditLib.verify() });
});

// ----- Backup (komplette Datenbank als Datei) -----
GET('/api/admin/backup', requirePerm('backup.download'), (req, res) => {
  const tmp = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  } catch (e) {
    console.error(e);
    return fail(res, 500, 'Backup fehlgeschlagen');
  }
  audit(req.admin.username, 'backup_download');
  const stamp = new Date().toISOString().slice(0, 10);
  const size = fs.statSync(tmp).size;
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': size,
    'Content-Disposition': `attachment; filename="turkac-backup-${stamp}.db"`,
    'Cache-Control': 'no-store',
  });
  const stream = fs.createReadStream(tmp);
  stream.pipe(res);
  const done = () => fs.rm(tmp, { force: true }, () => {});
  stream.on('close', done);
  res.on('close', done);
});

// ======================================================================
// Statische Dateien + Server
// ======================================================================
function serveStatic(req, res, pathname) {
  if (pathname === '/admin') {
    res.writeHead(301, { Location: '/admin/' });
    return res.end();
  }
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return fail(res, 403, 'Verboten');
  return serveFile(req, res, file);
}

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const server = http.createServer(async (req, res) => {
  try {
    req.ip = clientIp(req);
    acc.loadUser(req);
    const u = new URL(req.url, 'http://x');
    req.query = Object.fromEntries(u.searchParams);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', CSP);

    const method = req.method === 'HEAD' ? 'GET' : req.method;
    if (site.maintenanceGate(req, res, u.pathname)) return;
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(u.pathname);
      if (!m) continue;
      req.params = {};
      r.keys.forEach((k, i) => (req.params[k] = decodeURIComponent(m[i + 1])));
      let i = 0;
      const next = async () => {
        const h = r.handlers[i++];
        if (h) return h(req, res, next);
      };
      return await next();
    }
    if (u.pathname.startsWith('/api/')) return fail(res, 404, 'Unbekannter Endpunkt');
    if (method !== 'GET') return fail(res, 405, 'Methode nicht erlaubt');
    if (site.servePage(req, res, u.pathname)) return;
    return serveStatic(req, res, u.pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) fail(res, 500, 'Serverfehler');
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`🎮 ${getSetting('site_name')} läuft auf http://localhost:${PORT}`);
  console.log(`🛠️  Admin-Bereich:  http://localhost:${PORT}/admin/`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
