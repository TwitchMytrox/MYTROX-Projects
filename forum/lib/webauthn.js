/* WebAuthn / Sicherheitsschlüssel (FIDO2) ohne Fremdbibliothek.
   Rolle: zweiter Faktor nach dem Passwort (zählt für Teammitglieder als Pflicht-2FA). Attestation "none". */
const crypto = require('node:crypto');

// ---- Minimaler CBOR-Dekoder (reicht für attestationObject und COSE-Schlüssel) ----
function cbor(buf, off = 0) {
  const ib = buf[off++], major = ib >> 5, info = ib & 31;
  let val = info;
  if (info === 24) val = buf[off++];
  else if (info === 25) { val = buf.readUInt16BE(off); off += 2; }
  else if (info === 26) { val = buf.readUInt32BE(off); off += 4; }
  else if (info === 27) { val = Number(buf.readBigUInt64BE(off)); off += 8; }
  else if (info > 27) throw new Error('CBOR nicht unterstützt');
  switch (major) {
    case 0: return [val, off];
    case 1: return [-1 - val, off];
    case 2: return [Buffer.from(buf.subarray(off, off + val)), off + val];
    case 3: return [buf.toString('utf8', off, off + val), off + val];
    case 4: { const a = []; for (let i = 0; i < val; i++) { const [v, o] = cbor(buf, off); a.push(v); off = o; } return [a, off]; }
    case 5: { const m = new Map(); for (let i = 0; i < val; i++) { const [k, o1] = cbor(buf, off); const [v, o2] = cbor(buf, o1); m.set(k, v); off = o2; } return [m, off]; }
    case 7: return [info === 20 ? false : info === 21 ? true : null, off];
    default: throw new Error('CBOR nicht unterstützt');
  }
}
const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

function coseToJwk(m) {
  const kty = m.get(1), alg = m.get(3);
  if (kty === 2 && alg === -7) return { alg, jwk: { kty: 'EC', crv: 'P-256', x: b64u(m.get(-2)), y: b64u(m.get(-3)) } };
  if (kty === 3 && alg === -257) return { alg, jwk: { kty: 'RSA', n: b64u(m.get(-1)), e: b64u(m.get(-2)) } };
  if (kty === 1 && alg === -8) return { alg, jwk: { kty: 'OKP', crv: 'Ed25519', x: b64u(m.get(-2)) } };
  throw new Error('Schlüsselart wird nicht unterstützt');
}
function parseAuthData(ad) {
  if (ad.length < 37) throw new Error('authData zu kurz');
  const out = { rpIdHash: ad.subarray(0, 32), flags: ad[32], signCount: ad.readUInt32BE(33) };
  if (out.flags & 0x40) {
    let o = 37 + 16; const len = ad.readUInt16BE(o); o += 2;
    out.credId = ad.subarray(o, o + len); o += len;
    out.cose = cbor(ad, o)[0];
  }
  return out;
}

module.exports = function init(ctx, acc) {
  const { db, now, GET, POST, DEL, send, fail, jsonBody, rl, audit, SECURE_COOKIES } = ctx;
  const { requireUser, hydrate, userRow } = acc;
  const { verifyPassword } = ctx;

  db.exec(`CREATE TABLE IF NOT EXISTS webauthn_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, cred_id TEXT UNIQUE NOT NULL, jwk TEXT NOT NULL, alg INTEGER NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_used INTEGER);
    CREATE INDEX IF NOT EXISTS idx_wak_user ON webauthn_keys(user_id);`);
  const keysOf = (uid) => db.prepare('SELECT * FROM webauthn_keys WHERE user_id = ?').all(uid);

  const chal = new Map(); // id → {uid, challenge, purpose, exp}
  const newChallenge = (uid, purpose) => {
    for (const [k, v] of chal) if (v.exp < now()) chal.delete(k);
    const id = crypto.randomBytes(12).toString('hex'), challenge = crypto.randomBytes(32);
    chal.set(id, { uid, challenge: b64u(challenge), purpose, exp: now() + 5 * 60_000 });
    return { id, challenge: b64u(challenge) };
  };
  const take = (id, uid, purpose) => { const c = chal.get(String(id)); chal.delete(String(id)); return c && c.exp > now() && c.uid === uid && c.purpose === purpose ? c : null; };

  const rpOf = (req) => {
    const host = String(req.headers.host || 'localhost');
    const proto = req.headers['x-forwarded-proto'] || (SECURE_COOKIES ? 'https' : 'http');
    return { rpId: process.env.WEBAUTHN_RP_ID || host.replace(/:\d+$/, ''), origin: process.env.WEBAUTHN_ORIGIN || `${proto}://${host}` };
  };

  function checkClient(clientDataB64, type, c, req) {
    const cd = JSON.parse(fromB64u(clientDataB64).toString('utf8'));
    const { origin } = rpOf(req);
    if (cd.type !== type || cd.challenge !== c.challenge || cd.origin !== origin) throw new Error('Anfrage passt nicht (Challenge/Herkunft)');
    return cd;
  }
  const rpHashOk = (ad, req) => crypto.createHash('sha256').update(rpOf(req).rpId).digest().equals(ad.rpIdHash);

  // ---- Registrierung ----
  POST('/api/account/webauthn/options', requireUser, rl('wa', 20, 600_000), jsonBody, (req, res) => {
    if (!verifyPassword(String(req.body.password || ''), req.user.pass_hash)) return fail(res, 403, 'Passwort falsch');
    const c = newChallenge(req.user.id, 'register');
    const { rpId } = rpOf(req);
    send(res, 200, { id: c.id, publicKey: {
      challenge: c.challenge, rp: { name: ctx.getSetting('site_name', 'turkac.org'), id: rpId },
      user: { id: b64u('u' + req.user.id), name: req.user.username, displayName: req.user.username },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }, { type: 'public-key', alg: -8 }],
      authenticatorSelection: { residentKey: 'discouraged', userVerification: 'preferred' }, attestation: 'none', timeout: 120000,
      excludeCredentials: keysOf(req.user.id).map((k) => ({ type: 'public-key', id: k.cred_id })),
    } });
  });

  POST('/api/account/webauthn/register', requireUser, rl('wa', 20, 600_000), jsonBody, (req, res) => {
    try {
      const c = take(req.body.id, req.user.id, 'register');
      if (!c) return fail(res, 400, 'Sitzung abgelaufen – bitte erneut starten');
      const cr = req.body.credential || {};
      checkClient(cr.clientDataJSON, 'webauthn.create', c, req);
      const att = cbor(fromB64u(cr.attestationObject))[0];
      const ad = parseAuthData(att.get('authData'));
      if (!rpHashOk(ad, req) || !(ad.flags & 1) || !ad.credId) return fail(res, 400, 'Schlüssel konnte nicht geprüft werden');
      const { alg, jwk } = coseToJwk(ad.cose);
      const first = keysOf(req.user.id).length === 0;
      db.prepare('INSERT INTO webauthn_keys(user_id,cred_id,jwk,alg,sign_count,name,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(req.user.id, b64u(ad.credId), JSON.stringify(jwk), alg, ad.signCount, String(req.body.name || 'Sicherheitsschlüssel').slice(0, 40), now());
      audit(req.user.username, 'security_key_added', '');
      // Erster Faktor überhaupt → frische Wiederherstellungscodes (falls Schlüssel verloren geht)
      let codes;
      if (first && !req.user.totp_on && acc.issueRecoveryCodes) codes = acc.issueRecoveryCodes(req.user.id);
      send(res, 201, { ok: true, recovery_codes: codes });
    } catch (e) { fail(res, 400, e.message.includes('UNIQUE') ? 'Dieser Schlüssel ist schon registriert' : 'Schlüssel konnte nicht geprüft werden'); }
  });

  GET('/api/account/webauthn', requireUser, (req, res) => send(res, 200, { keys: keysOf(req.user.id).map((k) => ({ id: k.id, name: k.name, created_at: k.created_at, last_used: k.last_used })) }));
  DEL('/api/account/webauthn/:id', requireUser, rl('wa', 20, 600_000), jsonBody, (req, res) => {
    if (!verifyPassword(String(req.body.password || ''), req.user.pass_hash)) return fail(res, 403, 'Passwort falsch');
    const k = db.prepare('SELECT * FROM webauthn_keys WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!k) return fail(res, 404, 'Nicht gefunden');
    if (acc.isTeam(req.user) && acc.teamMfaRequired() && !req.user.totp_on && keysOf(req.user.id).length <= 1) return fail(res, 403, 'Für Teammitglieder ist ein zweiter Faktor Pflicht – richte zuerst einen anderen ein');
    db.prepare('DELETE FROM webauthn_keys WHERE id = ?').run(k.id);
    audit(req.user.username, 'security_key_removed', '');
    send(res, 200, { ok: true });
  });

  // ---- Anmeldung (wird von accounts.js beim Login aufgerufen) ----
  ctx.mfaInfo = (u, req) => {
    const keys = keysOf(u.id);
    const out = { totp: !!u.totp_on, webauthn: keys.length > 0 };
    if (keys.length) {
      const c = newChallenge(u.id, 'login');
      out.challenge_id = c.id;
      out.publicKey = { challenge: c.challenge, rpId: rpOf(req).rpId, allowCredentials: keys.map((k) => ({ type: 'public-key', id: k.cred_id })), userVerification: 'preferred', timeout: 120000 };
    }
    return out;
  };
  ctx.mfaVerifyKey = (u, req, w) => {
    try {
      const c = take(w.id, u.id, 'login');
      if (!c) return false;
      const cr = w.credential || {};
      const key = db.prepare('SELECT * FROM webauthn_keys WHERE cred_id = ? AND user_id = ?').get(String(cr.id || ''), u.id);
      if (!key) return false;
      checkClient(cr.clientDataJSON, 'webauthn.get', c, req);
      const adBuf = fromB64u(cr.authenticatorData), ad = parseAuthData(adBuf);
      if (!rpHashOk(ad, req) || !(ad.flags & 1)) return false;
      const data = Buffer.concat([adBuf, crypto.createHash('sha256').update(fromB64u(cr.clientDataJSON)).digest()]);
      const pub = crypto.createPublicKey({ key: JSON.parse(key.jwk), format: 'jwk' });
      const sig = fromB64u(cr.signature);
      const ok = key.alg === -8 ? crypto.verify(null, data, pub, sig) : crypto.verify('sha256', data, pub, sig);
      if (!ok) return false;
      if ((ad.signCount || key.sign_count) && ad.signCount <= key.sign_count) return false; // Klon-Erkennung
      db.prepare('UPDATE webauthn_keys SET sign_count = ?, last_used = ? WHERE id = ?').run(ad.signCount, now(), key.id);
      return true;
    } catch { return false; }
  };
  ctx.keyCount = (uid) => db.prepare('SELECT COUNT(*) n FROM webauthn_keys WHERE user_id = ?').get(uid).n;
  return { keysOf, cbor, coseToJwk, parseAuthData };
};
module.exports.cbor = cbor;
