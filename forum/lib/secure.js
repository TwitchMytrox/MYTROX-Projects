'use strict';
// Sicherheits-Helfer: Verschlüsselung gespeicherter Daten, Zwei-Faktor (TOTP), Zufallscodes.
// Läuft ohne Fremdpakete (nur Node-Crypto).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------- Schlüssel für die Verschlüsselung ----------
// Der Schlüssel liegt in data/secret.key (oder in der Umgebungsvariable TURKAC_SECRET (alt: NEXUS_SECRET)).
// WICHTIG: Ohne diese Datei sind verschlüsselte Daten (2FA-Geheimnisse, E-Mail-Adressen) nicht lesbar –
// sichere sie getrennt von der Datenbank!
function loadKey(dataDir) {
  if (process.env.TURKAC_SECRET || process.env.NEXUS_SECRET) return crypto.createHash('sha256').update(process.env.TURKAC_SECRET || process.env.NEXUS_SECRET).digest();
  const file = path.join(dataDir, 'secret.key');
  try {
    const k = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
    if (k.length === 32) return k;
  } catch {
    /* noch nicht vorhanden */
  }
  const k = crypto.randomBytes(32);
  fs.writeFileSync(file, k.toString('hex'), { mode: 0o600 });
  return k;
}

function makeBox(dataDir) {
  const key = loadKey(dataDir);
  return {
    // AES-256-GCM: verschlüsselt + manipulationssicher
    encrypt(text) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
      return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
    },
    decrypt(blob) {
      try {
        const [v, iv, tag, ct] = String(blob).split('.');
        if (v !== 'v1') return null;
        const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
        d.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
      } catch {
        return null;
      }
    },
  };
}

// ---------- Base32 + TOTP (RFC 4226 / 6238) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secretB32, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

// Gibt den passenden Zeitschritt zurück (für Wiederverwendungs-Schutz) oder 0
function verifyTotp(secretB32, code, lastStep = 0, now = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return 0;
  const step = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) {
    const s = step + d;
    if (s <= lastStep) continue;
    const expect = hotp(secretB32, s);
    if (crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(c))) return s;
  }
  return 0;
}

const otpauthUri = (secret, account, issuer) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---------- Wiederherstellungscodes ----------
// Alphabet ohne leicht verwechselbare Zeichen (0/O, 1/I/L)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newRecoveryCode() {
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

module.exports = { makeBox, newTotpSecret, verifyTotp, otpauthUri, base32Encode, base32Decode, hotp, newRecoveryCode, normCode };
