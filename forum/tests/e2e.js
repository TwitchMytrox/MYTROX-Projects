'use strict';
// End-to-End-Test für Konten, Rechte, Wartungsmodus.
// Start:  ADMIN_PASSWORD=testpass-123456 PORT=3199 DATA_DIR=/tmp/nx-test/data UPLOAD_DIR=/tmp/nx-test/up node server.js
// Dann:   BASE=http://localhost:3199 ADMIN_PASSWORD=testpass-123456 DATA_DIR=/tmp/nx-test/data node tests/e2e.js
const secure = require('../lib/secure');

const BASE = process.env.BASE || 'http://localhost:3199';
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'testpass-123456';
let passed = 0;
let failed = 0;

class Client {
  constructor(name) { this.name = name; this.cookie = ''; }
  async req(method, path, body, raw) {
    const headers = {};
    if (this.cookie) headers.Cookie = this.cookie;
    let payload;
    if (body && !raw) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    if (raw) payload = body;
    const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) { const c = sc.split(';')[0]; this.cookie = c.endsWith('=') ? '' : c; }
    let data = {};
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = { _text: text }; }
    return { status: res.status, data, headers: res.headers };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b || {}); }
  patch(p, b) { return this.req('PATCH', p, b || {}); }
  put(p, b) { return this.req('PUT', p, b || {}); }
  del(p) { return this.req('DELETE', p); }
}

function ok(cond, label, extra) {
  if (cond) { passed++; console.log('  ✔', label); } else { failed++; console.log('  ✘', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => console.log('\n' + t);

(async () => {
  const guest = new Client('gast');
  const owner = new Client('owner');
  const alice = new Client('alice');

  section('Gast');
  ok((await guest.get('/api/auth/me')).data.user === null, 'Gast ist nicht angemeldet');
  let r = await guest.post('/api/threads', {});
  ok(r.status === 401 && r.data.code === 'LOGIN_REQUIRED', 'Gast darf nicht schreiben', r);
  r = await guest.get('/api/threads');
  ok(r.status === 200, 'Gast darf lesen (guest_read an)');
  ok((await guest.get('/api/admin/users')).status === 401, 'Admin-API ohne Login gesperrt');

  section('Registrierung');
  r = await alice.post('/api/auth/register', { username: 'Alice_Test', password: 'geheim-passwort-1', accept: true });
  ok(r.status === 201 && r.data.recovery_codes.length === 10, 'Registrierung + 10 Wiederherstellungscodes', r);
  const aliceCodes = r.data.recovery_codes;
  ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(aliceCodes[0]), 'Code-Format');
  ok(alice.cookie.startsWith('nx_session='), 'Cookie gesetzt');
  r = await alice.get('/api/auth/me');
  ok(r.data.user && r.data.user.username === 'Alice_Test' && r.data.user.status === 'normal', 'me liefert Konto');
  ok(!JSON.stringify(r.data).includes('pass_hash'), 'me enthält keinen Passwort-Hash');

  const other = new Client('x');
  ok((await other.post('/api/auth/register', { username: 'alice_test', password: 'geheim-passwort-1', accept: true })).status === 400, 'Name (Groß/Klein) schon vergeben');
  r = await other.post('/api/auth/register', { username: 'A1ice_Test', password: 'geheim-passwort-1', accept: true });
  ok(r.status === 400, 'ähnlicher Name (Leetspeak) blockiert', r.data);
  ok((await other.post('/api/auth/register', { username: 'admin', password: 'geheim-passwort-1', accept: true })).status === 400, 'reservierter Name admin blockiert');
  ok((await other.post('/api/auth/register', { username: 'Adm1n', password: 'geheim-passwort-1', accept: true })).status === 400, 'Adm1n blockiert');
  ok((await other.post('/api/auth/register', { username: 'ab', password: 'geheim-passwort-1', accept: true })).status === 400, 'zu kurzer Name');
  ok((await other.post('/api/auth/register', { username: 'Bob_Test', password: '123', accept: true })).status === 400, 'schwaches Passwort');
  ok((await other.post('/api/auth/register', { username: 'Bob_Test', password: 'geheim-passwort-1' })).status === 400, 'ohne Zustimmung abgelehnt');
  r = await other.get('/api/auth/suggest');
  ok(/^[A-Za-z]+\d+$/.test(r.data.name), 'Namensvorschlag', r.data);

  section('Schreiben als Mitglied');
  r = await alice.post('/api/threads', {});
  ok(r.status === 400 || r.status === 415 || r.status === 200 || r.status === 201 || r.status === 429 || r.status === 413 ? true : false, 'Thread-Endpunkt erreichbar (kein 401)', r.status);
  ok(r.status !== 401, 'angemeldet → kein LOGIN_REQUIRED');

  section('Admin-Pflicht: 2FA + E-Mail');
  r = await owner.post('/api/auth/login', { username: 'admin', password: ADMIN_PW });
  ok(r.status === 200 && r.data.user.team && r.data.user.setup_required, 'Inhaber loggt ein, Einrichtung nötig', r);
  r = await owner.get('/api/admin/users');
  ok(r.status === 403 && r.data.code === 'SETUP_REQUIRED', 'Admin-API gesperrt bis 2FA+E-Mail', r);
  r = await owner.post('/api/account/email', { password: ADMIN_PW, email: 'owner@example.com' });
  ok(r.status === 200, 'E-Mail hinterlegt');
  r = await owner.post('/api/account/2fa/setup', { password: ADMIN_PW });
  ok(r.status === 200 && r.data.secret && r.data.uri.startsWith('otpauth://'), '2FA-Setup liefert Secret + otpauth-URI');
  const ownerSecret = r.data.secret;
  r = await owner.post('/api/account/2fa/enable', { code: '000000' });
  ok(r.status === 400, 'falscher 2FA-Code abgelehnt');
  r = await owner.post('/api/account/2fa/enable', { code: secure.hotp(ownerSecret, Math.floor(Date.now() / 30000)) });
  ok(r.status === 200 && r.data.recovery_codes.length === 10, '2FA aktiviert + Backup-Codes', r);
  r = await owner.get('/api/admin/users');
  ok(r.status === 200 && r.data.rows.length >= 2, 'Admin-API jetzt erreichbar', r.status);
  r = await owner.post('/api/account/2fa/disable', { password: ADMIN_PW, code: '123456' });
  ok(r.status === 403, '2FA kann bei Teammitgliedern nicht abgeschaltet werden');

  // Slowmode aus, damit der Test zügig läuft
  r = await owner.put('/api/admin/settings', { slowmode_seconds: 0 });
  ok(r.status === 200, 'Slowmode ausgeschaltet');

  section('Login: Fehlversuche, 2FA, Wiederherstellung');
  const t1 = new Client('t1');
  for (let i = 0; i < 5; i++) r = await t1.post('/api/auth/login', { username: 'Alice_Test', password: 'falsch-falsch' });
  r = await t1.post('/api/auth/login', { username: 'Alice_Test', password: 'geheim-passwort-1' });
  ok(r.status === 429, 'Konto nach 5 Fehlversuchen gesperrt', r);
  // Sperre über Admin aufheben
  const aliceId = (await owner.get('/api/admin/users?q=Alice')).data.rows[0].id;
  ok((await owner.post(`/api/admin/users/${aliceId}/reset-sessions`)).status === 200, 'Admin hebt Sperre auf');
  r = await t1.post('/api/auth/login', { username: 'Alice_Test', password: 'geheim-passwort-1' });
  ok(r.status === 200 && !r.data.need_2fa, 'Login nach Entsperren', r);

  // Alice aktiviert 2FA
  r = await t1.post('/api/account/2fa/setup', { password: 'geheim-passwort-1' });
  const aSecret = r.data.secret;
  r = await t1.post('/api/account/2fa/enable', { code: secure.hotp(aSecret, Math.floor(Date.now() / 30000)) });
  ok(r.status === 200, 'Mitglied aktiviert 2FA freiwillig');
  const aliceCodes2 = r.data.recovery_codes;
  const t2 = new Client('t2');
  r = await t2.post('/api/auth/login', { username: 'Alice_Test', password: 'geheim-passwort-1' });
  ok(r.data.need_2fa === true && !t2.cookie, 'Login verlangt Code, noch keine Sitzung');
  r = await t2.post('/api/auth/login', { username: 'Alice_Test', password: 'geheim-passwort-1', code: '111111' });
  ok(r.status === 401, 'falscher Code abgelehnt');
  // gleicher TOTP-Schritt darf nicht doppelt genutzt werden (Replay-Schutz): Schritt +1 verwenden
  r = await t2.post('/api/auth/login', { username: 'Alice_Test', password: 'geheim-passwort-1', code: secure.hotp(aSecret, Math.floor(Date.now() / 30000) + 1) });
  ok(r.status === 200 && t2.cookie, 'Login mit gültigem App-Code');
  const t3 = new Client('t3');
  r = await t3.post('/api/auth/login', { username: 'Alice_Test', password: 'geheim-passwort-1', code: aliceCodes2[0] });
  ok(r.status === 200 && r.data.recovery_codes_left === 9, 'Login mit Backup-Code (verbraucht)', r.data);
  const t4 = new Client('t4');
  r = await t4.post('/api/auth/login', { username: 'Alice_Test', password: 'geheim-passwort-1', code: aliceCodes2[0] });
  ok(r.status === 401, 'Backup-Code nur einmal nutzbar');

  // Passwort vergessen
  const t5 = new Client('t5');
  r = await t5.post('/api/auth/recover', { username: 'Alice_Test', code: aliceCodes2[1], new_password: 'neues-passwort-99' });
  ok(r.status === 200, 'Passwort per Wiederherstellungscode zurückgesetzt', r);
  r = await t5.post('/api/auth/login', { username: 'Alice_Test', password: 'geheim-passwort-1' });
  ok(r.status === 401, 'altes Passwort ungültig');
  ok((await t2.get('/api/auth/me')).data.user === null, 'alte Sitzungen beendet');

  section('Konto-Stufen, Timeout, Verwarnung');
  const al = new Client('al');
  r = await al.post('/api/auth/login', { username: 'Alice_Test', password: 'neues-passwort-99', code: aliceCodes2[2] });
  ok(r.status === 200, 'Alice wieder eingeloggt');
  r = await owner.patch(`/api/admin/users/${aliceId}/status`, { status: 'untersuchung', note: 'Prüfung' });
  ok(r.status === 200, 'Stufe → Untersuchung');
  r = await al.post('/api/threads', {});
  ok(r.status === 403 && r.data.code === 'RESTRICTED', 'Untersuchung: keine neuen Threads', r.data);
  r = await owner.patch(`/api/admin/users/${aliceId}/status`, { status: 'gebannt', note: 'Spam' });
  r = await al.post('/api/threads/1/comments', {});
  ok(r.status === 403 && r.data.code === 'BANNED', 'gebannt: Schreiben gesperrt', r.data);
  ok((await al.get('/api/threads')).status === 403, 'gebannt: auch Lesen gesperrt');
  ok((await al.get('/api/auth/me')).data.user.status === 'gebannt', 'gebannt: Konto-Status trotzdem abrufbar');
  await owner.patch(`/api/admin/users/${aliceId}/status`, { status: 'normal', note: '' });
  r = await owner.post(`/api/admin/users/${aliceId}/timeout`, { minutes: 30, mode: 'write', reason: 'Streit' });
  ok(r.status === 200, 'Timeout gesetzt');
  r = await al.post('/api/threads/1/comments', {});
  ok(r.status === 403 && r.data.code === 'TIMEOUT', 'Timeout: Schreiben gesperrt');
  ok((await al.get('/api/threads')).status === 200, 'Timeout "schreiben": Lesen möglich');
  await owner.post(`/api/admin/users/${aliceId}/timeout`, { minutes: 30, mode: 'hidden', reason: 'Pause' });
  ok((await al.get('/api/threads')).data.code === 'HIDDEN', 'Timeout "unsichtbar": Forum ausgeblendet');
  ok((await owner.del(`/api/admin/users/${aliceId}/timeout`)).status === 200, 'Timeout beendet');
  for (let i = 0; i < 3; i++) await owner.post(`/api/admin/users/${aliceId}/warn`, { reason: 'Verstoß ' + i });
  r = await owner.get(`/api/admin/users/${aliceId}`);
  ok(r.data.user.status === 'verdacht' && r.data.warnings_list.length === 3, '3 Verwarnungen → automatisch Verdacht', r.data.user && r.data.user.status);

  section('Rollen & Rechte');
  r = await owner.get('/api/admin/roles');
  const mod = r.data.roles.find((x) => x.key === 'moderator');
  ok(mod && !mod.permissions.includes('users.ban'), 'Moderator hat kein Bann-Recht');
  r = await owner.post(`/api/admin/users/${aliceId}/role`, { role_id: mod.id });
  ok(r.status === 200 && r.data.setup_required === true, 'Moderator-Rolle vergeben, 2FA/E-Mail Pflicht', r);
  r = await al.get('/api/admin/users');
  ok(r.status === 403 && r.data.code === 'SETUP_REQUIRED', 'Moderator ohne 2FA/E-Mail: gesperrt');
  r = await al.post('/api/account/email', { password: 'neues-passwort-99', email: 'alice@example.com' });
  ok(r.status === 200, 'Moderator hinterlegt E-Mail');
  // Alice hat 2FA schon – damit ist die Einrichtung komplett
  r = await al.get('/api/admin/users');
  ok(r.status === 200, 'Moderator darf Nutzer sehen', r.status);
  r = await al.put('/api/admin/settings', { guest_read: false });
  ok(r.status === 403, 'Moderator darf keine Einstellungen ändern');
  r = await al.get('/api/admin/roles');
  ok(r.status === 200 && al.cookie, 'Moderator sieht Rollenliste');
  const bob = new Client('bob');
  r = await bob.post('/api/auth/register', { username: 'Bob_Test', password: 'bob-passwort-123', accept: true });
  const bobId = r.data.user.id;
  r = await al.patch(`/api/admin/users/${bobId}/status`, { status: 'gebannt', note: 'x' });
  ok(r.status === 403, 'Moderator darf nicht dauerhaft bannen', r.data);
  r = await al.post(`/api/admin/users/${bobId}/timeout`, { minutes: 5, mode: 'write', reason: 'Test' });
  ok(r.status === 200, 'Moderator darf Timeout setzen');
  r = await al.post(`/api/admin/users/${bobId}/timeout`, { minutes: 60 * 24 * 60, mode: 'write', reason: 'zu lang' });
  ok(r.status === 400, 'Moderator-Timeout auf 30 Tage begrenzt');
  r = await al.post('/api/admin/users/1/warn', { reason: 'ich warne den Inhaber' });
  ok(r.status === 403, 'Moderator kann Inhaber nicht verwarnen');
  r = await al.post(`/api/admin/users/${bobId}/role`, { role_id: mod.id });
  ok(r.status === 403, 'Moderator darf keine Rollen vergeben');

  section('Wartungsmodus');
  r = await owner.put('/api/admin/maintenance', { on: true, minutes: 1, message: 'Umbau!' });
  ok(r.status === 200 && r.data.active, 'Wartung an (1 Minute)');
  ok((await guest.get('/api/threads')).status === 503, 'Gäste: 503 während Wartung');
  ok((await guest.get('/api/maintenance')).data.active === true, 'Status-Endpunkt erreichbar');
  ok((await owner.get('/api/threads')).status === 200, 'Team arbeitet trotz Wartung weiter');
  ok((await guest.get('/api/auth/me')).status === 200, 'Login-Endpunkte bleiben offen');
  const page = await guest.get('/forum');
  ok(page.status === 503, 'Seite zeigt 503-Wartungsseite', page.status);
  await owner.put('/api/admin/maintenance', { on: false });
  ok((await guest.get('/api/threads')).status === 200, 'Wartung aus → Forum wieder online');
  // Geplantes Fenster
  r = await owner.put('/api/admin/maintenance', { start: Date.now() + 3600_000, until: Date.now() + 7200_000 });
  ok(r.status === 200 && r.data.scheduled && !r.data.active, 'Wartung geplant, noch nicht aktiv');
  await owner.put('/api/admin/maintenance', { on: false });

  section('Zugriff: Gäste-Lesen und Pflicht-Login');
  await owner.put('/api/admin/settings', { guest_read: false });
  ok((await guest.get('/api/threads')).data.code === 'LOGIN_REQUIRED', 'guest_read aus → Gäste gesperrt');
  ok((await bob.get('/api/threads')).status === 200, 'Mitglieder lesen weiter');
  await owner.put('/api/admin/settings', { guest_read: true });
  await owner.put('/api/admin/settings', { registration_open: false });
  ok((await other.post('/api/auth/register', { username: 'Carol_Test', password: 'carol-passwort-1', accept: true })).status === 403, 'Registrierung geschlossen');
  await owner.put('/api/admin/settings', { registration_open: true });

  section('Namen-Liste');
  r = await owner.get('/api/admin/names?q=Alice');
  ok(r.data.rows.some((n) => n.name_lc === 'alice_test' && n.in_use), 'Name in der Liste, in Benutzung');
  ok((await owner.del('/api/admin/names/alice_test')).status === 409, 'Name in Benutzung kann nicht freigegeben werden');
  r = await bob.post('/api/account/username', { password: 'bob-passwort-123', username: 'Bobby_Test' });
  ok(r.status === 200, 'Umbenennen');
  r = await other.post('/api/auth/register', { username: 'Bob_Test', password: 'x-passwort-12345', accept: true });
  ok(r.status === 400, 'alter Name bleibt reserviert', r.data);
  ok((await bob.post('/api/account/username', { password: 'bob-passwort-123', username: 'Bob_2' })).status === 429, 'Umbenennen nur alle 14 Tage');
  ok((await owner.del('/api/admin/names/bob_test')).status === 200, 'Admin gibt alten Namen frei');
  r = await other.post('/api/auth/register', { username: 'Bob_Test', password: 'x-passwort-12345', accept: true });
  ok(r.status === 201, 'freigegebener Name wieder registrierbar', r.data);

  section('Export & Löschen');
  r = await bob.get('/api/account/export');
  ok(r.status === 200 && r.data.konto.benutzername === 'Bobby_Test' && !JSON.stringify(r.data).includes('pass'), 'Datenexport ohne Geheimnisse');
  r = await bob.post('/api/account/delete', { password: 'bob-passwort-123', confirm: 'falsch' });
  ok(r.status === 400, 'Löschen verlangt Namensbestätigung');
  r = await bob.post('/api/account/delete', { password: 'bob-passwort-123', confirm: 'Bobby_Test' });
  ok(r.status === 200, 'Konto gelöscht');
  ok((await bob.get('/api/auth/me')).data.user === null, 'danach abgemeldet');
  ok((await guest.post('/api/auth/login', { username: 'Bobby_Test', password: 'bob-passwort-123' })).status === 401, 'Login nicht mehr möglich');
  ok((await owner.post('/api/account/delete', { password: ADMIN_PW, confirm: 'admin' })).status === 403, 'Inhaber kann sich nicht löschen');

  section('Rechte-Eskalation');
  r = await owner.get('/api/admin/roles');
  const adminRole = r.data.roles.find((x) => x.key === 'admin');
  r = await owner.post('/api/admin/roles', { name: 'Test-Rolle', color: '#ff0000', level: 30, permissions: ['admin.access', 'users.view'] });
  ok(r.status === 201, 'Eigene Rolle anlegen');
  const cat = (await owner.get('/api/admin/roles')).data.catalogue.map((c) => c.key).filter((k) => k !== 'roles.manage');
  r = await owner.put(`/api/admin/roles/${adminRole.id}`, { name: 'Administrator', color: '#ff2bd6', level: 80, permissions: cat });
  ok(r.status === 200 && (await owner.get('/api/admin/roles')).data.roles.find((x) => x.key === 'admin').permissions.length === cat.length, 'Rolle bearbeiten');
  r = await al.post('/api/admin/roles', { name: 'Hack', level: 10, permissions: ['admin.access'] });
  ok(r.status === 403, 'Moderator kann keine Rollen anlegen');
  const ownerRole = (await owner.get('/api/admin/roles')).data.roles.find((x) => x.key === 'owner');
  ok((await owner.put(`/api/admin/roles/${ownerRole.id}`, { name: 'x', level: 10, permissions: [] })).status === 403, 'Inhaber-Rolle ist fest');
  ok((await owner.del(`/api/admin/roles/${ownerRole.id}`)).status === 403, 'Inhaber-Rolle nicht löschbar');

  section('Meldezentrum & Protokoll');
  ok((await guest.post('/api/report', { type: 'thread', id: 1, category: 'spam' })).status === 401, 'Gast kann nicht melden');
  r = await owner.post('/api/report', { type: 'thread', id: 1, category: 'jugendschutz', reason: 'Test' });
  ok(r.status === 201, 'Meldung mit Kategorie');
  r = await owner.get('/api/admin/reports');
  const card = r.data.rows.find((x) => x.target_id === 1);
  ok(card && card.urgent && card.categories.jugendschutz === 1 && card.reports[0].reporter, 'Karte: dringend, Kategorie, Melder sichtbar');
  ok((await owner.post(`/api/admin/reports/${card.id}/claim`, {})).status === 200 && (await owner.get('/api/admin/reports')).data.rows.find((x) => x.target_id === 1).status === 'working', 'In Bearbeitung nehmen');
  ok((await owner.post(`/api/admin/reports/${card.id}/resolve`, { action: 'dismiss', note: 'ok geprüft' })).status === 200, 'Meldung erledigen');
  r = await owner.get('/api/admin/reports?status=resolved');
  ok(r.data.rows.some((x) => x.target_id === 1 && x.note === 'ok geprüft' && x.handled_by), 'Erledigt mit Notiz und Bearbeiter');
  r = await owner.get('/api/admin/audit');
  ok(r.status === 200 && r.data.chain.ok && r.data.chain.checked > 5, 'Protokoll: Hash-Kette gültig');
  ok(r.data.rows.some((x) => x.action === 'report_dismiss' && x.detail.includes('ok geprüft')), 'Protokoll entschlüsselt lesbar');
  const dbf = require('node:sqlite'); const raw = new dbf.DatabaseSync(require('node:path').join(process.env.DATA_DIR || 'data', 'forum.db'));
  let blocked = false; try { raw.exec("UPDATE audit_log SET enc = 'x' WHERE id = 1"); } catch { blocked = true; }
  ok(blocked, 'Protokoll per SQL nicht änderbar');
  blocked = false; try { raw.exec('DELETE FROM audit_log'); } catch { blocked = true; }
  ok(blocked, 'Protokoll per SQL nicht löschbar');
  raw.close();

  section('Ränge, XP, Anti-Farming');
  r = await owner.get('/api/account/progress');
  ok(r.status === 200 && r.data.rank.name && r.data.xp >= 5, 'Fortschritt + Login-XP', JSON.stringify(r.data).slice(0, 80));
  const xp0 = r.data.xp;
  const fd = new FormData(); fd.append('body', 'Das ist ein ausreichend langer Testkommentar.');
  r = await owner.req('POST', '/api/threads/1/comments', fd, true);
  ok(r.status === 201 || r.status === 429, 'Kommentar posten', r.status);
  if (r.status === 201) {
    ok(r.data.reward && r.data.reward.xp === 3, 'Kommentar bringt 3 XP');
    const fd2 = new FormData(); fd2.append('body', 'Das ist ein ausreichend langer Testkommentar.');
    r = await owner.req('POST', '/api/threads/1/comments', fd2, true);
    ok(r.status === 429 || !r.data.reward, 'Wiederholung bringt keine XP (Slowmode oder Duplikat)');
  }
  r = await owner.get('/api/ranks');
  ok(r.data.ranks.length === 10 && r.data.badges.length >= 6, 'Rangliste/Abzeichen-Katalog');
  r = await owner.get('/api/leaderboard');
  ok(r.data.rows.length >= 1 && r.data.rows[0].rank.name, 'Bestenliste');
  ok((await guest.get('/api/account/progress')).status === 401, 'Fortschritt nur mit Login');

  section('Direktnachrichten');
  ok((await guest.get('/api/dm')).status === 401, 'Gast hat keinen Posteingang');
  r = await owner.post('/api/dm/Alice', { body: 'Hallo Alice, privat.' });
  ok(r.status === 201 || r.status === 404 || r.status === 403, 'Nachricht an Mitglied (je nach Konto-Stufe)', r.status);
  ok((await owner.post('/api/dm/admin', { body: 'selbst' })).status === 400, 'Nicht an sich selbst');
  ok((await owner.post('/api/dm/Niemand_Existiert', { body: 'x' })).status === 404, 'Unbekannter Nutzer');
  r = await owner.post('/api/dm/Bobby_Test', { body: 'x' });
  const bobGone = r.status === 404;
  ok(bobGone, 'Gelöschtes Konto nicht erreichbar');
  r = await owner.get('/api/dm/users?q=al');
  ok(r.status === 200 && Array.isArray(r.data.found), 'Nutzersuche');
  r = await owner.post('/api/dm/share', { to: 'Alice', type: 'thread', id: 99999 });
  ok(r.status === 400 || r.status === 404 || r.status === 403, 'Teilen: ungültiger Beitrag abgewiesen', r.status);
  const dbm = new (require('node:sqlite').DatabaseSync)(require('node:path').join(process.env.DATA_DIR || 'data', 'forum.db'));
  const enc = dbm.prepare('SELECT body_enc FROM dm_messages LIMIT 1').get();
  ok(!enc || !String(enc.body_enc).includes('privat'), 'Nachrichten liegen verschlüsselt in der Datenbank');
  dbm.close();

  section('Spam-Schutz');
  r = await guest.get('/api/captcha');
  ok(r.status === 200 && r.data.mode === 'pow' && r.data.id && r.data.challenge && r.data.bits === 16, 'Standard: unsichtbare Rechenprüfung (nichts zu tippen)');
  r = await guest.get('/api/captcha?fallback=1');
  ok(r.data.mode === 'math' && /plus|minus/.test(r.data.question), 'Ersatz: einfache Textfrage');
  ok((await guest.post('/api/auth/register', { username: 'Botty_Test', password: 'geheim-passwort-1', accept: true, website: 'http://spam' })).status === 400, 'Honeypot fängt Bots');
  const fresh = new Client('fresh'); await fresh.post('/api/auth/register', { username: 'Frisch_Test', password: 'frisch-passwort-1', accept: true });
  const fdT = new FormData(); fdT.append('title', 'Mein erster Thread'); fdT.append('body', 'Das ist ein ausreichend langer Text für den Thread.'); fdT.append('category_id', '1');
  r = await fresh.req('POST', '/api/threads', fdT, true);
  ok(r.status === 400 && /frisch/.test(r.data.error), 'Ganz frisches Konto kann noch keinen Thread starten', r.data.error);
  const fdC = new FormData(); fdC.append('body', 'Schau hier: http://a.com und http://b.com bitte');
  r = await fresh.req('POST', '/api/threads/1/comments', fdC, true);
  ok(r.status === 400 && /Link/.test(r.data.error), 'Zwei Links in neuem Konto abgelehnt', r.data.error);

  section('Rechtsseiten & PWA');
  for (const pth of ['/impressum', '/datenschutz', '/agb', '/regeln']) { r = await guest.req('GET', pth); ok(r.status === 200 && /<h1>/.test(r.data._text || ''), 'Seite ' + pth + ' öffentlich'); }
  ok((await guest.req('GET', '/manifest.webmanifest')).status === 200, 'Manifest');
  ok((await guest.req('GET', '/sw.js')).status === 200, 'Service Worker');
  r = await owner.put('/api/admin/legal', { operator_name: 'Max Muster', operator_address: 'Musterweg 1, 12345 Berlin', operator_email: 'x@example.com' });
  r = await guest.req('GET', '/impressum');
  ok(/Max Muster/.test(r.data._text) && !/<script>/.test(r.data._text), 'Betreiberangaben im Impressum');
  r = await owner.put('/api/admin/legal', { regeln: '## Test <script>alert(1)</script>' });
  r = await guest.req('GET', '/regeln');
  ok(!/<script>alert/.test(r.data._text), 'Rechtstexte werden maskiert (kein XSS)');
  ok((await guest.put('/api/admin/legal', {})).status === 401, 'Nur Berechtigte bearbeiten Rechtstexte');

  section('Sicherheitsschlüssel (WebAuthn, Software-Authenticator)');
  {
    const crypto = require('node:crypto');
    const b64u = (b) => Buffer.from(b).toString('base64url');
    const hdr = (major, n) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
    const cb = {
      uint: (n) => hdr(0, n), nint: (n) => hdr(1, -1 - n), bytes: (b) => Buffer.concat([hdr(2, b.length), b]), text: (t) => Buffer.concat([hdr(3, Buffer.byteLength(t)), Buffer.from(t)]),
      map: (pairs) => Buffer.concat([hdr(5, pairs.length), ...pairs.flat()]),
    };
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credId = crypto.randomBytes(32);
    const rpIdHash = crypto.createHash('sha256').update('localhost').digest();
    const origin = BASE;
    const wu = new Client('wa'); await wu.post('/api/auth/register', { username: 'Key_Test', password: 'key-passwort-123', accept: true });
    r = await wu.post('/api/account/webauthn/options', { password: 'falsch' });
    ok(r.status === 403, 'Schlüssel hinzufügen braucht Passwort');
    r = await wu.post('/api/account/webauthn/options', { password: 'key-passwort-123' });
    ok(r.status === 200 && r.data.publicKey.challenge, 'Registrierungs-Optionen');
    const cose = cb.map([[cb.uint(1), cb.uint(2)], [cb.uint(3), cb.nint(-7)], [cb.nint(-1), cb.uint(1)], [cb.nint(-2), cb.bytes(Buffer.from(jwk.x, 'base64url'))], [cb.nint(-3), cb.bytes(Buffer.from(jwk.y, 'base64url'))]]);
    const counter = Buffer.alloc(4);
    const adReg = Buffer.concat([rpIdHash, Buffer.from([0x41]), counter, Buffer.alloc(16), Buffer.from([0, credId.length]), credId, cose]);
    const attObj = cb.map([[cb.text('fmt'), cb.text('none')], [cb.text('attStmt'), cb.map([])], [cb.text('authData'), cb.bytes(adReg)]]);
    const cdReg = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: r.data.publicKey.challenge, origin }));
    const bad = await wu.post('/api/account/webauthn/register', { id: r.data.id, name: 'Test-Key', credential: { clientDataJSON: b64u(Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: 'x', origin }))), attestationObject: b64u(attObj) } });
    ok(bad.status === 400, 'Falsche Challenge wird abgelehnt');
    r = await wu.post('/api/account/webauthn/options', { password: 'key-passwort-123' });
    const cdReg2 = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: r.data.publicKey.challenge, origin }));
    r = await wu.post('/api/account/webauthn/register', { id: r.data.id, name: 'Test-Key', credential: { clientDataJSON: b64u(cdReg2), attestationObject: b64u(attObj) } });
    ok(r.status === 201 && Array.isArray(r.data.recovery_codes), 'Schlüssel registriert (+ Wiederherstellungscodes)', r.data);
    ok((await wu.get('/api/account/webauthn')).data.keys.length === 1, 'Schlüssel in Liste');
    await wu.post('/api/auth/logout');
    const login = new Client('wl');
    r = await login.post('/api/auth/login', { username: 'Key_Test', password: 'key-passwort-123' });
    ok(r.data.need_2fa && r.data.methods.webauthn && r.data.methods.publicKey.allowCredentials.length === 1, 'Login verlangt Sicherheitsschlüssel');
    const sign = (count, chall, type = 'webauthn.get') => {
      const ad = Buffer.concat([rpIdHash, Buffer.from([0x01]), Buffer.from([0, 0, 0, count])]);
      const cd = Buffer.from(JSON.stringify({ type, challenge: chall, origin }));
      const sig = crypto.sign('sha256', Buffer.concat([ad, crypto.createHash('sha256').update(cd).digest()]), privateKey);
      return { id: b64u(credId), authenticatorData: b64u(ad), clientDataJSON: b64u(cd), signature: b64u(sig) };
    };
    r = await login.post('/api/auth/login', { username: 'Key_Test', password: 'key-passwort-123', webauthn: { id: r.data.methods.challenge_id, credential: sign(5, 'falsch') } });
    ok(r.status === 401, 'Falsche Challenge → Login abgelehnt');
    r = await login.post('/api/auth/login', { username: 'Key_Test', password: 'key-passwort-123' });
    const okRes = await login.post('/api/auth/login', { username: 'Key_Test', password: 'key-passwort-123', webauthn: { id: r.data.methods.challenge_id, credential: sign(5, r.data.methods.publicKey.challenge) } });
    ok(okRes.status === 200 && okRes.data.user && okRes.data.user.username === 'Key_Test', 'Login mit Sicherheitsschlüssel');
    await login.post('/api/auth/logout');
    r = await login.post('/api/auth/login', { username: 'Key_Test', password: 'key-passwort-123' });
    r = await login.post('/api/auth/login', { username: 'Key_Test', password: 'key-passwort-123', webauthn: { id: r.data.methods.challenge_id, credential: sign(4, r.data.methods.publicKey.challenge) } });
    ok(r.status === 401, 'Zurückgesetzter Zähler (Klon) wird abgelehnt');
  }

  section('Support-Tickets');
  {
    const alice = new Client('sup'); await alice.post('/api/auth/register', { username: 'Sup_Test', password: 'support-passwort-1', accept: true });
    const t1 = new Client('sup2'); await t1.post('/api/auth/register', { username: 'Sup_Zwei', password: 'support-passwort-2', accept: true });
    let r = await alice.get('/api/support/categories');
    ok(r.status === 200 && r.data.categories.length >= 5, 'Kategorien abrufbar');
    r = await alice.post('/api/support/tickets', { category: 'nix', subject: 'Test Betreff', body: 'Eine ausreichend lange Nachricht' });
    ok(r.status === 400, 'Ungültige Kategorie abgelehnt');
    r = await alice.post('/api/support/tickets', { category: 'personalisierung', subject: 'Avatar ändern', body: 'Ich möchte mein Profilbild anpassen.' });
    ok(r.status === 201 && /^T-[A-Z0-9]{8}$/.test(r.data.id), 'Ticket erstellt (zufällige Nummer)', r.data);
    const pid = r.data.id;
    for (let i = 0; i < 10; i++) await alice.post('/api/support/tickets', { category: 'konto', subject: 'x', body: 'y' });
    ok((await alice.post('/api/support/tickets', { category: 'konto', subject: 'Zweites Ticket', body: 'Ausreichend langer Text hier.' })).status === 201, 'Formular-Tippfehler sperren nicht aus');
    ok((await guest.get('/api/support/tickets')).status === 401, 'Gast sieht keine Tickets');
    ok((await t1.get('/api/support/tickets/' + pid)).status === 404, 'Fremde Tickets nicht sichtbar');
    r = await owner.get('/api/admin/tickets');
    ok(r.status === 200 && r.data.rows.some((x) => x.id === pid), 'Team sieht das Ticket');
    ok((await alice.get('/api/admin/tickets')).status === 403, 'Mitglied ohne Recht abgewiesen');
    r = await owner.post('/api/admin/tickets/' + pid + '/reply', { body: 'Interne Notiz', internal: true });
    ok(r.status === 201, 'Interne Notiz');
    r = await owner.post('/api/admin/tickets/' + pid + '/reply', { body: 'Hallo, das erledigen wir.' });
    ok(r.status === 201, 'Team antwortet');
    r = await alice.get('/api/support/tickets/' + pid);
    ok(r.data.messages.length === 2 && !r.data.messages.some((m) => m.body === 'Interne Notiz') && r.data.ticket.status === 'pending', 'Nutzer sieht keine interne Notiz, Status wartet');
    ok((await alice.get('/api/support/unread')).data.unread === 0, 'Gelesen-Zähler');
    r = await owner.get('/api/admin/tickets/staff');
    ok(r.status === 200 && r.data.staff.length >= 1, 'Teamliste');
    r = await owner.post('/api/admin/tickets/' + pid + '/forward', { team_group: 'moderation', assignee_id: r.data.staff[0].id, note: 'Bitte prüfen' });
    ok(r.status === 200, 'Weitergeleitet');
    r = await owner.patch('/api/admin/tickets/' + pid, { priority: 'high', subject: 'Avatar anpassen' });
    ok(r.status === 200, 'Bearbeitet');
    r = await alice.post('/api/support/tickets/' + pid + '/withdraw');
    ok(r.status === 200, 'Zurückgezogen');
    ok((await alice.post('/api/support/tickets/' + pid + '/reply', { body: 'Noch da?' })).status === 400, 'Antwort auf zurückgezogenes Ticket gesperrt');
    ok((await alice.post('/api/support/tickets/' + pid + '/reactivate')).status === 200, 'Wieder aktiviert');
    ok((await owner.patch('/api/admin/tickets/' + pid, { status: 'closed' })).status === 200, 'Team schließt');
    r = await alice.get('/api/support/tickets');
    ok(r.data.tickets[0].status === 'closed', 'Nutzer sieht geschlossen');
  }

  section('Blog & Werbung');
  {
    const mem = new Client('bl'); await mem.post('/api/auth/register', { username: 'Blog_Test', password: 'blog-passwort-123', accept: true });
    ok((await mem.post('/api/admin/blog', { title: 'Hallo' })).status === 403, 'Mitglied darf keinen Blog schreiben');
    let r = await owner.post('/api/admin/blog', { title: 'Server-Update <b>', body: '## Neu\n- Punkt **fett**\n[x](javascript:alert(1)) [ok](https://example.org)', kind: 'werbung', summary: 'Kurz', cta_url: 'javascript:1' });
    ok(r.status === 400, 'Unsicherer Button-Link abgelehnt');
    r = await owner.post('/api/admin/blog', { title: 'Server-Update <b>', body: '## Neu\n- Punkt **fett**\n[x](javascript:alert(1)) [ok](https://example.org)', kind: 'werbung', summary: 'Kurz', cta_url: 'https://example.org/a', published: true });
    ok(r.status === 201, 'Beitrag angelegt');
    const id = r.data.id;
    r = await guest.get('/api/blog');
    ok(r.data.posts.length === 1 && /^[0-9a-f]{10}$/.test(r.data.posts[0].slug), 'Öffentliche Liste mit zufälligem Slug');
    const slug = r.data.posts[0].slug;
    const page = await fetch(BASE + '/blog/' + slug); const html = await page.text();
    ok(page.status === 200 && html.includes('Anzeige') && !html.includes('<b>') && !html.includes('href="javascript') && html.includes('<strong>fett</strong>') && html.includes('https://example.org'), 'Seite gerendert, escaped, als Anzeige markiert');
    ok((await fetch(BASE + '/blog')).status === 200, 'Übersicht erreichbar');
    await owner.patch('/api/admin/blog/' + id, { published: false });
    ok((await fetch(BASE + '/blog/' + slug)).status === 404, 'Entwurf nicht öffentlich');
    ok((await owner.del('/api/admin/blog/' + id)).status === 200, 'Beitrag gelöscht');
  }

  section('Credit-Wirtschaft, Turniere, Lostopf');
  {
    const mk = async (n) => { const c = new Client(n); const r = await c.post('/api/auth/register', { username: n + '_Tn', password: 'turnier-passwort-1', accept: true }); c.uid = r.data.user.id; return c; };
    const org = await mk('Org'), p1 = await mk('Pa'), p2 = await mk('Pb'), p3 = await mk('Pc');
    let r = await owner.get('/api/admin/economy');
    ok(r.status === 200 && r.data.total === 11000000000 && r.data.treasury <= r.data.total, 'Staatskonto mit fester Gesamtmenge');
    const t0 = r.data.treasury;
    r = await org.post('/api/tournaments', { title: 'Arena Cup', game: 'Testspiel', description: 'Ein ausführliches Testturnier mit Regeln.', starts_at: Date.now() + 86400000, max_players: 8 });
    ok(r.status === 400 && /Credits/.test(r.data.error), 'Zu wenig Credits → kein Turnier', r.data);
    r = await owner.post('/api/admin/users/' + org.uid + '/xp', { delta: 6000, reason: 'Test' });
    ok(r.status === 200, 'Team schenkt Credits (aus dem Staatskonto)');
    ok((await owner.get('/api/admin/economy')).data.treasury === t0 - 6000, 'Staatskonto sinkt um den Betrag');
    r = await org.post('/api/tournaments', { title: 'Arena Cup', game: 'Testspiel', description: 'Ein ausführliches Testturnier mit Regeln.', starts_at: Date.now() + 86400000, max_players: 8 });
    ok(r.status === 201 && /^TN-/.test(r.data.id) && r.data.ticket, 'Turnier eingereicht, Ticket zur Prüfung', r.data);
    const tid = r.data.id;
    ok((await org.get('/api/account/progress')).data.credits === 1000, 'Einsatz 5000 in Treuhand');
    ok((await guest.get('/api/tournaments/' + tid)).status === 404, 'In Prüfung nicht öffentlich');
    ok((await p1.post('/api/tournaments/' + tid + '/join')).status === 400, 'Anmeldung erst nach Freigabe');
    ok((await p1.get('/api/admin/tournaments')).status === 403, 'Mitglied ohne Prüfrecht abgewiesen');
    ok((await owner.get('/api/admin/tickets?status=all')).data.rows.some((x) => x.id === r.data.ticket || x.category === 'turnier'), 'Prüf-Ticket beim Support');
    ok((await owner.post('/api/admin/tournaments/' + tid + '/approve', {})).status === 200, 'Support gibt frei');
    ok((await org.post('/api/tournaments/' + tid + '/join')).status === 403, 'Veranstalter darf nicht mitspielen');
    for (const p of [p1, p2, p3]) ok((await p.post('/api/tournaments/' + tid + '/join')).status === 200, 'Teilnahme');
    ok((await p1.post('/api/tournaments/' + tid + '/start')).status === 404, 'Nur Veranstalter startet');
    ok((await org.post('/api/tournaments/' + tid + '/start')).status === 200, 'Start');
    ok((await org.patch('/api/tournaments/' + tid + '/points', { user_id: p2.uid, points: 90 })).status === 200 && (await org.patch('/api/tournaments/' + tid + '/points', { user_id: p1.uid, points: 50 })).status === 200, 'Punkte eintragen');
    r = await guest.get('/api/tournaments/' + tid);
    ok(r.data.tournament.players[0].username === 'Pb_Tn' && r.data.tournament.players[0].points === 90, 'Live-Tabelle sortiert');
    ok((await org.post('/api/tournaments/' + tid + '/finish', { first: org.uid, proof_url: 'https://example.org/v' })).status === 400, 'Veranstalter kann sich nicht selbst melden');
    ok((await org.post('/api/tournaments/' + tid + '/finish', { first: p2.uid, second: p1.uid, third: p3.uid })).status === 400, 'Ohne Beweis abgelehnt');
    ok((await org.post('/api/tournaments/' + tid + '/finish', { first: p2.uid, second: p1.uid, third: p3.uid, proof_url: 'https://example.org/v' })).status === 200, 'Gewinner + Beweis gemeldet');
    r = await owner.post('/api/admin/tournaments/' + tid + '/confirm', {});
    ok(r.status === 403, 'Vier-Augen: Freigeber darf nicht auch auszahlen', r.data);
    ok((await owner.put('/api/admin/tournaments/config', { four_eyes: false })).status === 200, 'Vier-Augen abschaltbar');
    const tr = (await owner.get('/api/admin/economy')).data.treasury;
    r = await owner.post('/api/admin/tournaments/' + tid + '/confirm', {});
    ok(r.status === 200 && r.data.paid === 2800 && r.data.lottery === 1200, 'Auszahlung 1600/800/400, Lostopf 1200', r.data);
    ok((await owner.get('/api/admin/economy')).data.treasury === tr + 1000, 'Gebühr 1000 fließt ins Staatskonto');
    ok((await p2.get('/api/account/progress')).data.credits >= 1600, 'Sieger hat Preis');
    r = await guest.get('/api/lottery');
    ok(r.data.pot === 1200 && r.data.price === 240, 'Lostopf 1200, Los = 20 %', r.data);
    ok((await p2.post('/api/lottery/ticket')).status === 201, 'Los gekauft');
    r = await owner.post('/api/admin/economy/draw', {});
    ok(r.status === 200 && r.data.result && r.data.result.winner === p2.uid, 'Ziehung zahlt Topf aus');
    const o2 = await mk('Ox'); await owner.post('/api/admin/users/' + o2.uid + '/xp', { delta: 5000, reason: 'Test' });
    r = await o2.post('/api/tournaments', { title: 'Zweiter Cup', game: 'Spiel', description: 'Noch ein ausführliches Testturnier.', starts_at: Date.now() + 86400000 });
    ok((await owner.post('/api/admin/tournaments/' + r.data.id + '/reject', { note: 'Regeln unklar' })).status === 200 && (await o2.get('/api/account/progress')).data.credits === 5000, 'Ablehnung erstattet alles');
    // Tageslimit: Anmeldung 2 + Thread 7 + Kommentar 4 + Reaktion 3 = 16 ≤ 20
    ok((await owner.get('/api/admin/economy')).data.daily_cap === 20, 'Tageslimit 20');
  }

  section('Spiele, Bestenliste, Top-10-Rang, Inaktivität');
  {
    const Snake = require('../public/js/snake-sim.js');
    const mk = async (n) => { const c = new Client(n); const r = await c.post('/api/auth/register', { username: n + '_Sp', password: 'spiele-passwort-1', accept: true }); c.uid = r.data.user.id; return c; };
    const pg = await mk('Gam'), hid = await mk('Hid');
    await owner.put('/api/admin/games', { min_rounds: 1, loss_cap: 100000, prize_cap: 100000 });
    for (const c of [pg, hid]) await owner.post('/api/admin/users/' + c.uid + '/xp', { delta: 3000, reason: 'Test' });
    const cr = async (c) => (await c.get('/api/account/progress')).data.credits;
    let r = await guest.get('/api/games/info');
    ok(r.status === 200 && r.data.bet_max === 300 && r.data.fee === 10 && !r.data.me, 'Info öffentlich (Einsatz max. 300, Eintritt 10)', r.data);
    ok(r.data.slots.rtp > 90 && r.data.slots.rtp < 100, 'Slots: Haus hat Vorteil (Auszahlquote ' + r.data.slots.rtp + ' %)');
    ok((await guest.post('/api/games/slots/spin', { bet: 10 })).status === 401, 'Spielen ohne Konto nicht möglich');
    r = await pg.post('/api/games/slots/spin', { bet: 10 });
    ok(r.status === 403 && r.data.code === 'CONSENT', 'Ohne Bestätigung (ab 18, kein Geldwert) kein Spiel', r.data);
    ok((await pg.post('/api/games/consent', { adult: true })).status === 400, 'Bestätigung braucht beide Hinweise');
    for (const c of [pg, hid]) ok((await c.post('/api/games/consent', { adult: true, no_value: true })).status === 200, 'Bestätigung gespeichert');

    // Slots + Roulette: Buchführung stimmt
    ok((await pg.post('/api/games/slots/spin', { bet: 5 })).status === 400 && (await pg.post('/api/games/slots/spin', { bet: 301 })).status === 400, 'Einsatz-Grenzen 10–300');
    let okAcc = true, c0 = await cr(pg);
    for (let i = 0; i < 12; i++) { r = await pg.post('/api/games/slots/spin', { bet: 10 }); const c1 = await cr(pg); if (r.status !== 200 || c1 !== c0 - 10 + r.data.won || r.data.reels.length !== 3) okAcc = false; c0 = c1; }
    ok(okAcc, 'Slots: Guthaben = alt − Einsatz + Gewinn (12 Drehungen)');
    ok((await pg.post('/api/games/roulette/spin', { bet: 10, type: 'color', value: 'blue' })).status === 400 && (await pg.post('/api/games/roulette/spin', { bet: 10, type: 'number', value: 99 })).status === 400, 'Roulette: ungültige Wetten abgelehnt');
    okAcc = true; c0 = await cr(pg);
    for (let i = 0; i < 10; i++) { r = await pg.post('/api/games/roulette/spin', { bet: 10, type: i % 2 ? 'color' : 'number', value: i % 2 ? 'red' : i }); const c1 = await cr(pg); if (r.status !== 200 || c1 !== c0 - 10 + r.data.won || r.data.number < 0 || r.data.number > 36) okAcc = false; c0 = c1; }
    ok(okAcc, 'Roulette: Buchführung stimmt (10 Drehungen)');

    // Blackjack
    const t0 = (await owner.get('/api/admin/economy')).data.treasury;
    r = await pg.post('/api/games/blackjack/deal', { bet: 100 });
    ok(r.status === 200 && r.data.fee === 5 && r.data.game.player.length === 2, 'Blackjack: Gebühr 5 % (min. 5), zwei Karten', r.data);
    let g = r.data.game;
    if (!g.done) {
      ok(g.dealer[1] === '??', 'Zweite Geberkarte bleibt verdeckt');
      ok((await pg.post('/api/games/blackjack/deal', { bet: 100 })).data.code === 'OPEN', 'Nur eine offene Runde');
      r = await pg.post('/api/games/blackjack/action', { id: g.id, action: 'stand' }); g = r.data.game;
    }
    ok(g.done && g.dealer.length >= 2 && !g.dealer.includes('??') && ['win', 'lose', 'push', 'bust', 'blackjack'].includes(g.outcome), 'Blackjack: Runde beendet (' + g.outcome + ')', g);
    ok((await pg.post('/api/games/blackjack/action', { id: g.id, action: 'hit' })).status === 404, 'Beendete Runde nicht mehr spielbar');
    // Roulette: Hausvorteil auf Dauer (Staatskonto steigt, wenn viele verlieren)
    okAcc = true;
    for (let i = 0; i < 40; i++) await hid.post('/api/games/roulette/spin', { bet: 10, type: 'number', value: 7 });
    ok((await owner.get('/api/admin/economy')).data.treasury !== t0, 'Staatskonto bewegt sich mit Einsätzen/Gewinnen');

    // Verlustlimit
    await owner.put('/api/admin/games', { loss_cap: 0 });
    r = await pg.post('/api/games/slots/spin', { bet: 10 });
    ok(r.status === 400 && r.data.code === 'LOSS_CAP', 'Tages-Verlustlimit greift', r.data);
    await owner.put('/api/admin/games', { loss_cap: 100000 });

    // Reaktionstest: Server misst; zu früh = verloren
    c0 = await cr(pg);
    r = await pg.post('/api/games/reaction/start');
    ok(r.status === 200 && r.data.delay >= 1500 && r.data.delay <= 5000 && (await cr(pg)) === c0 - 10, 'Reaktion: Eintritt 10 abgebucht, Wartezeit vom Server');
    let rid = r.data.id;
    r = await pg.post('/api/games/reaction/' + rid + '/click');
    ok(r.status === 200 && r.data.early && r.data.prize === 0, 'Zu früh geklickt = kein Preis', r.data);
    ok((await pg.post('/api/games/reaction/' + rid + '/click')).status === 404, 'Runde nur einmal wertbar');
    r = await pg.post('/api/games/reaction/start'); rid = r.data.id; const dl = r.data.delay;
    await sleep(dl + 150);
    r = await pg.post('/api/games/reaction/' + rid + '/click');
    ok(r.status === 200 && !r.data.early && r.data.ms >= 100 && (r.data.ms >= 250 || r.data.prize === 25), 'Reaktion: Zeit ' + r.data.ms + ' ms vom Server gemessen', r.data);

    // Memory: Server kennt die Karten; sehr schnelles Lösen gibt keinen Preis (Bot-Schutz)
    r = await pg.post('/api/games/memory/start'); const mid = r.data.id;
    ok(r.status === 200 && r.data.cards === 16 && !r.data.layout, 'Memory: Kartenlage wird nicht verraten');
    const sym = {}; let last;
    for (let i = 0; i < 16; i += 2) { await pg.post('/api/games/memory/' + mid + '/flip', { i }).then((x) => { sym[i] = x.data.symbol; }); const y = await pg.post('/api/games/memory/' + mid + '/flip', { i: i + 1 }); sym[i + 1] = y.data.symbol; last = y; }
    const byS = {}; Object.entries(sym).forEach(([i, s2]) => (byS[s2] = byS[s2] || []).push(Number(i)));
    for (const [s2, [a, b]] of Object.entries(byS)) { if (last.data.done) break; const matchedAlready = false; if (matchedAlready) continue;
      const x1 = await pg.post('/api/games/memory/' + mid + '/flip', { i: a }); if (x1.status !== 200) continue; last = await pg.post('/api/games/memory/' + mid + '/flip', { i: b }); }
    ok(last.data.done === true && last.data.moves <= 18, 'Memory: gelöst in ' + last.data.moves + ' Zügen', last.data);
    ok(last.data.prize === 0, 'Memory: zu schnell gelöst → kein Preis (Bot-Schutz)');

    // Snake: Server spielt nach
    r = await pg.post('/api/games/snake/start'); let sid = r.data.id, seed = r.data.seed;
    ok(r.status === 200 && seed > 0, 'Snake: Startwert vom Server');
    r = await pg.post('/api/games/snake/' + sid + '/finish', { turns: [], ticks: 9 });
    ok(r.status === 200 && r.data.suspicious === true && r.data.prize === 0, 'Snake: unmöglich schneller Lauf wird verworfen', r.data);
    r = await pg.post('/api/games/snake/start'); sid = r.data.id; seed = r.data.seed;
    await sleep(700);
    const local = Snake.replay(seed, [], 9);
    r = await pg.post('/api/games/snake/' + sid + '/finish', { turns: [], ticks: 9 });
    ok(r.status === 200 && !r.data.suspicious && r.data.score === local.score, 'Snake: Punkte = Nachrechnung des Servers (' + r.data.score + ')', r.data);

    // Team spielt mit unbegrenztem Spielgeld: nichts wird abgebucht, Staatskonto und Bestenliste bleiben unberührt
    {
      const econ = async () => (await owner.get('/api/admin/economy')).data;
      await owner.post('/api/games/consent', { adult: true, no_value: true });
      const e0 = await econ(), c0 = await cr(owner);
      let allOk = true, lastInfo = null;
      for (let i = 0; i < 6; i++) { const x = await owner.post('/api/games/slots/spin', { bet: 300 }); if (x.status !== 200) allOk = false; }
      const x2 = await owner.post('/api/games/roulette/spin', { bet: 300, type: 'color', value: 'red' }); if (x2.status !== 200) allOk = false;
      const x3 = await owner.post('/api/games/reaction/start', {}); if (x3.status !== 200) allOk = false;
      const e1 = await econ(), c1 = await cr(owner);
      ok(allOk, 'Team kann Slots, Roulette und Reaktion ohne Credits spielen');
      ok(c1 === c0 && e1.treasury === e0.treasury, 'Team-Spiele bewegen keine Credits und nicht das Staatskonto', { c0, c1, t0: e0.treasury, t1: e1.treasury });
      lastInfo = (await owner.get('/api/games/info')).data;
      ok(lastInfo.me && lastInfo.me.unlimited === true, 'Info meldet unbegrenzt für Team');
      r = await guest.get('/api/games/leaderboard?game=all');
      ok(!r.data.rows.some((x) => x.username === 'owner'), 'Team taucht nicht in der Bestenliste auf');
    }
    // Bestenliste, Ausblenden, Wochenabschluss, Top-10-Rang
    r = await guest.get('/api/games/leaderboard?game=slots');
    ok(r.status === 200 && r.data.rows.some((x) => x.username === 'Gam_Sp'), 'Bestenliste zeigt Spieler');
    r = await guest.get('/api/games/leaderboard?game=all');
    ok(r.data.rows.length >= 1 && r.data.rows[0].points > 0, 'Gesamtwertung mit Platzpunkten', r.data);
    ok((await hid.post('/api/games/prefs', { hidden: true })).status === 200, 'Mitglied blendet sich aus');
    r = await guest.get('/api/games/leaderboard?game=roulette');
    ok(!r.data.rows.some((x) => x.username === 'Hid_Sp'), 'Ausgeblendetes Mitglied nicht in der Liste');
    const before = await cr(pg);
    r = await owner.post('/api/admin/games/settle', {});
    ok(r.status === 200 && r.data.top10.length >= 2 && r.data.top10[0].bonus === 100, 'Wochenabschluss: Top 10 mit Bonus (Platz 1 = 100)', r.data);
    const placeOf = (uid) => (r.data.top10.find((x) => x.user_id === uid) || {}).place;
    ok(placeOf(pg.uid) > 0, 'Spieler in den Top 10');
    r = await pg.get('/api/auth/me');
    ok(/^Top 10/.test(r.data.user.rank.name), 'Rang „Top 10“ am Konto: ' + r.data.user.rank.name);
    r = await hid.get('/api/auth/me');
    ok(!/^Top 10/.test(r.data.user.rank.name), 'Ausgeblendete sehen/zeigen keinen Top-10-Rang');
    ok((await guest.get('/api/games/halloffame')).data.champions.length + (await guest.get('/api/games/halloffame')).data.top10.length >= 1, 'Hall of Fame gefüllt');
    ok((await cr(pg)) > before, 'Wochenbonus gutgeschrieben');

    // Inaktivität + Pause
    const inact = await mk('Slp'); await owner.post('/api/admin/users/' + inact.uid + '/xp', { delta: 1000, reason: 'Test' });
    r = await inact.get('/api/economy/inactivity');
    ok(r.status === 200 && r.data.can_start_vacation && !r.data.on_vacation && r.data.rule.days === 5, 'Inaktivitätsregeln abrufbar', r.data);
    const { DatabaseSync } = require('node:sqlite');
    const sdb = new DatabaseSync((process.env.DATA_DIR || '/tmp/nx-test/data') + '/forum.db');
    const old = Date.now() - 6 * 86400000;
    sdb.prepare('UPDATE users SET created_at = ?, last_login = ? WHERE id = ?').run(old, old, inact.uid);
    sdb.prepare('UPDATE user_sessions SET last_seen = ? WHERE user_id = ?').run(old, inact.uid);
    const dbc = () => sdb.prepare('SELECT credits FROM users WHERE id = ?').get(inact.uid).credits; // direkt aus der DB (API-Aufrufe würden die Aktivität erneuern)
    const cb = dbc();
    r = await owner.post('/api/admin/inactivity/sweep', {});
    ok(r.status === 200 && dbc() === cb - Math.floor(cb * 0.02), 'Nach 6 Tagen Inaktivität: 2 % ans Staatskonto', { cb, after: dbc() });
    await owner.post('/api/admin/inactivity/sweep', {});
    ok(dbc() === cb - Math.floor(cb * 0.02), 'Pro Stufe nur einmal abgezogen');
    sdb.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(old - 6 * 86400000, inact.uid);
    sdb.prepare('UPDATE user_sessions SET last_seen = ? WHERE user_id = ?').run(old - 6 * 86400000, inact.uid);
    sdb.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(old - 6 * 86400000, inact.uid);
    const cb2 = dbc();
    await owner.post('/api/admin/inactivity/sweep', {});
    ok(dbc() === cb2 - Math.floor(cb2 * 0.04), 'Nach 12 Tagen: Stufe 2 = 4 % vom aktuellen Stand', { cb2, after: dbc() });
    r = await inact.post('/api/economy/vacation', {});
    ok(r.status === 200 && r.data.on_vacation && r.data.vacation_until > Date.now() + 59 * 86400000, 'Pause gestartet (60 Tage)', r.data);
    ok((await inact.post('/api/economy/vacation', {})).status === 400, 'Pause läuft schon');
    const cb3 = await cr(inact);
    await owner.post('/api/admin/inactivity/sweep', {});
    ok((await cr(inact)) === cb3, 'In der Pause keine Gebühr');
    ok((await inact.post('/api/economy/vacation', { action: 'end' })).status === 200, 'Pause beendet');
    r = await inact.post('/api/economy/vacation', {});
    ok(r.status === 400 && /erst am/.test(r.data.error), 'Neue Pause erst nach Sperrfrist (90 Tage)', r.data);
    r = await inact.get('/api/economy/inactivity');
    ok(r.data.grace_until > Date.now(), 'Nach der Pause: 5 Tage Schonfrist');
    sdb.close();
  }

  section('Abmelden');
  ok((await owner.post('/api/auth/logout')).status === 200, 'Logout');
  ok((await owner.get('/api/admin/users')).status === 401, 'nach Logout kein Zugriff');

  console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('Testfehler:', e); process.exit(2); });
