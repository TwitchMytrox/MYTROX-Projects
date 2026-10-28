/* Unveränderliches, verschlüsseltes Protokoll mit Hash-Kette.
   - Inhalt (wer/was/Details) liegt AES-256-GCM-verschlüsselt in `enc`.
   - Jeder Eintrag enthält den Hash seines Vorgängers → Änderungen/Löschungen in der Mitte fallen auf.
   - SQLite-Trigger verbieten UPDATE und DELETE auf audit_log. */
const crypto = require('node:crypto');

module.exports = function makeAudit({ db, box, now, addColumn }) {
  addColumn('audit_log', 'prev_hash', 'TEXT');
  addColumn('audit_log', 'hash', 'TEXT');
  addColumn('audit_log', 'enc', 'TEXT');
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'Protokoll ist unveränderlich'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'Protokoll ist unveränderlich'); END;
  `);
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const lastHash = db.prepare("SELECT hash FROM audit_log WHERE hash IS NOT NULL ORDER BY id DESC LIMIT 1");
  const ins = db.prepare("INSERT INTO audit_log(admin,action,detail,created_at,prev_hash,hash,enc) VALUES('','','',?,?,?,?)");

  function audit(who, action, detail = '') {
    const ts = now();
    const enc = box.encrypt(JSON.stringify({ who: String(who).slice(0, 60), action: String(action).slice(0, 60), detail: String(detail).slice(0, 300) }));
    const prev = (lastHash.get() || {}).hash || 'GENESIS';
    ins.run(ts, prev, sha(`${prev}|${ts}|${enc}`), enc);
  }

  const open = (r) => {
    if (!r.enc) return { id: r.id, created_at: r.created_at, admin: r.admin, action: r.action, detail: r.detail, legacy: true };
    try { const p = JSON.parse(box.decrypt(r.enc)); return { id: r.id, created_at: r.created_at, admin: p.who, action: p.action, detail: p.detail }; }
    catch { return { id: r.id, created_at: r.created_at, admin: '?', action: '(nicht lesbar)', detail: '' }; }
  };

  function verify() {
    let prev = 'GENESIS', n = 0;
    for (const r of db.prepare('SELECT id, created_at, prev_hash, hash, enc FROM audit_log WHERE hash IS NOT NULL ORDER BY id').iterate()) {
      if (r.prev_hash !== prev || sha(`${r.prev_hash}|${r.created_at}|${r.enc}`) !== r.hash) return { ok: false, broken_at: r.id, checked: n };
      prev = r.hash; n++;
    }
    return { ok: true, checked: n };
  }

  function list({ page = 1, per = 50, q = '' } = {}) {
    const total = db.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
    let rows;
    if (q) { // Verschlüsselt → in Speicher filtern (Protokoll ist klein)
      const needle = q.toLowerCase();
      rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC').all().map(open).filter((r) => `${r.admin} ${r.action} ${r.detail}`.toLowerCase().includes(needle));
      const t = rows.length;
      return { total: t, pages: Math.max(1, Math.ceil(t / per)), page, rows: rows.slice((page - 1) * per, page * per) };
    }
    rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?').all(per, (page - 1) * per).map(open);
    return { total, pages: Math.max(1, Math.ceil(total / per)), page, rows };
  }
  return { audit, list, verify };
};
