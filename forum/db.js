'use strict';
// Datenbank-Schicht: SQLite (eingebautes node:sqlite, keine externen Pakete nötig)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'forum.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '🎮',
  color TEXT NOT NULL DEFAULT '#00f0ff',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  bumped_at INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_threads_cat ON threads(category_id, deleted);
CREATE INDEX IF NOT EXISTS idx_threads_bump ON threads(deleted, pinned, bumped_at);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread_id, deleted, id);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  comment_id INTEGER,
  stored_name TEXT UNIQUE NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_att_thread ON attachments(thread_id, comment_id);

CREATE TABLE IF NOT EXISTS reactions (
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  PRIMARY KEY (target_type, target_id, emoji, ip_hash)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT UNIQUE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- ===== Etappe 1: Konten, Rollen, Namen-Liste =====
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#00f0ff',
  level INTEGER NOT NULL DEFAULT 10,
  permissions TEXT NOT NULL DEFAULT '[]',
  system INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  name_lc TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  role_id INTEGER REFERENCES roles(id),
  status TEXT NOT NULL DEFAULT 'normal',
  status_note TEXT NOT NULL DEFAULT '',
  status_since INTEGER,
  timeout_until INTEGER,
  timeout_mode TEXT NOT NULL DEFAULT 'write',
  timeout_reason TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  email_enc TEXT,
  totp_enc TEXT,
  totp_on INTEGER NOT NULL DEFAULT 0,
  totp_last INTEGER NOT NULL DEFAULT 0,
  login_count INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  last_login INTEGER,
  last_rename INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);

-- Liste aller jemals vergebenen Benutzernamen (bleiben belegt, bis ein Admin sie freigibt)
CREATE TABLE IF NOT EXISTS usernames (
  name_lc TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'registered',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  ip_hash TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_usess_user ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rec_user ON recovery_codes(user_id);

CREATE TABLE IF NOT EXISTS warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  by_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_warn_user ON warnings(user_id);
`);

// Spalten nachrüsten (bestehende Datenbanken bleiben erhalten)
function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn('threads', 'user_id', 'INTEGER');
addColumn('comments', 'user_id', 'INTEGER');
db.exec(`CREATE TABLE IF NOT EXISTS webauthn_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, cred_id TEXT UNIQUE NOT NULL, jwk TEXT NOT NULL, alg INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_used INTEGER);
CREATE INDEX IF NOT EXISTS idx_wak_user ON webauthn_keys(user_id);`);
addColumn('reports', 'category', "TEXT NOT NULL DEFAULT 'sonstiges'");
addColumn('reports', 'status', "TEXT NOT NULL DEFAULT 'open'");
addColumn('reports', 'reporter_user', 'INTEGER');
addColumn('reports', 'handled_by', 'TEXT');
addColumn('reports', 'handled_at', 'INTEGER');
addColumn('reports', 'note', "TEXT NOT NULL DEFAULT ''");
addColumn('reports', 'outcome', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'xp', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'credits', 'INTEGER NOT NULL DEFAULT 0');
addColumn('usernames', 'skel', "TEXT NOT NULL DEFAULT ''");
db.exec('CREATE INDEX IF NOT EXISTS idx_usernames_skel ON usernames(skel);');
db.exec('CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_id); CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);');

const now = () => Date.now();

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------- Standardwerte beim ersten Start ----------
const DEFAULTS = {
  site_name: 'turkac.org',
  tagline: 'Anonym posten. Clips teilen. Level up.',
  announcement: '',
  announcement_on: '0',
  uploads_enabled: '1',
  max_upload_mb: '25',
  slowmode_seconds: '10',
  allow_new_threads: '1',
  // Etappe 1
  registration_open: '1',
  captcha_on: '1',
  captcha_mode: 'pow',
  team_mfa_required: process.env.TEAM_MFA_REQUIRED === '1' ? '1' : '0',
  require_login_to_post: '1',
  guest_read: '1',
  maintenance_on: '0',
  maintenance_start: '',
  maintenance_until: '',
  maintenance_message: 'Wir arbeiten gerade an der Arena und sind bald wieder da.',
  maintenance_redirect: '',
};
for (const [k, v] of Object.entries(DEFAULTS)) {
  if (!db.prepare('SELECT 1 FROM settings WHERE key = ?').get(k)) setSetting(k, v);
}
if (!getSetting('ip_salt')) setSetting('ip_salt', crypto.randomBytes(24).toString('hex'));

if (db.prepare('SELECT COUNT(*) n FROM categories').get().n === 0) {
  const seed = [
    ['allgemein', 'Allgemein', 'Alles rund ums Zocken', '💬', '#00f0ff'],
    ['pc', 'PC Gaming', 'Rigs, Mods, Steam & Co.', '🖥️', '#8a5cff'],
    ['konsole', 'Konsole', 'PlayStation, Xbox, Nintendo', '🎮', '#ff2bd6'],
    ['mobile', 'Mobile', 'Games für unterwegs', '📱', '#b6ff3b'],
    ['retro', 'Retro', 'Pixel-Nostalgie & Klassiker', '👾', '#ffb800'],
    ['clips', 'Clips & Highlights', 'Deine besten Momente', '🎬', '#ff4d4d'],
    ['hilfe', 'Hilfe & Tech', 'Probleme? Wir lösen sie.', '🛠️', '#35e0a1'],
    ['offtopic', 'Off-Topic', 'Der Rest vom Schützenfest', '🎲', '#9aa4ff'],
  ];
  const st = db.prepare('INSERT INTO categories(slug,name,description,icon,color,sort) VALUES(?,?,?,?,?,?)');
  seed.forEach((c, i) => st.run(c[0], c[1], c[2], c[3], c[4], i));

  const t = now();
  const r = db
    .prepare('INSERT INTO threads(category_id,title,body,nickname,ip_hash,created_at,bumped_at,pinned) VALUES(1,?,?,?,?,?,?,1)')
    .run(
      'Willkommen in der Arena! Lies das zuerst 🎮',
      'Hier kann jeder **komplett anonym** posten – nur mit einem Benutzernamen, ohne Klarnamen und E-Mail.\n\n' +
        '> Greentext funktioniert auch\n\n' +
        '• Bilder, Videos und Dateien kannst du an Beiträge und Kommentare hängen\n' +
        '• Mit `Code`, **fett** und ||Spoilern|| kannst du formatieren\n' +
        '• Reagiere mit Emojis und sammle XP für dein Level\n\n' +
        'Sei nett, bleib beim Thema und viel Spaß!',
      'Admin',
      'system',
      t,
      t
    );
  void r;
}

db.prepare("UPDATE settings SET value = 'turkac.org' WHERE key = 'site_name' AND value = 'NEXUS ARENA'").run();
module.exports = { db, now, getSetting, setSetting, tx, DATA_DIR, addColumn };
