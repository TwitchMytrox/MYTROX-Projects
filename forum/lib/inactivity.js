/* Inaktivitätsgebühr + Urlaubs-Pause.
   Wer lange weder online war noch etwas geschrieben hat, zahlt in Stufen einen Prozentsatz seines Kontostands ans Staatskonto
   (Standard: nach 5 Tagen 2 %, nach 10 Tagen 4 %, … bis höchstens 20 % je Stufe). Jede Aktivität setzt die Zählung zurück.
   Pause: bis zu 60 Tage komplett gebührenfrei, danach 5 Tage Schonfrist; erneute Pause erst nach 90 aktiven Tagen. Das Team ist ausgenommen. */
module.exports = function init(ctx, acc) {
  const { db, now, getSetting, GET, POST, PUT, send, fail, jsonBody, rl, audit } = ctx;
  const eco = ctx.eco, DAY = 86_400_000;

  db.exec(`CREATE TABLE IF NOT EXISTS inactivity (user_id INTEGER PRIMARY KEY, stage INTEGER NOT NULL DEFAULT 0, vac_end INTEGER NOT NULL DEFAULT 0, cooldown_until INTEGER NOT NULL DEFAULT 0, vac_count INTEGER NOT NULL DEFAULT 0);`);
  const int = (k, d) => { const v = parseInt(getSetting(k, String(d)), 10); return Number.isFinite(v) ? v : d; };
  const cfg = () => ({ on: getSetting('g_inact_on', '1') === '1', days: Math.max(1, int('g_inact_days', 5)), pct: int('g_inact_pct', 2), cap: int('g_inact_cap', 20), vac_days: int('g_vac_days', 60), cooldown_days: int('g_vac_cooldown', 90), max_stage: 10 });

  const rowOf = (id) => db.prepare('SELECT * FROM inactivity WHERE user_id = ?').get(id) || { user_id: id, stage: 0, vac_end: 0, cooldown_until: 0, vac_count: 0 };
  const save = (r) => db.prepare('INSERT INTO inactivity(user_id,stage,vac_end,cooldown_until,vac_count) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET stage=excluded.stage, vac_end=excluded.vac_end, cooldown_until=excluded.cooldown_until, vac_count=excluded.vac_count').run(r.user_id, r.stage, r.vac_end, r.cooldown_until, r.vac_count);
  const lastActive = (id) => db.prepare(`SELECT MAX(
      COALESCE((SELECT last_login FROM users WHERE id = ?),0),
      COALESCE((SELECT created_at FROM users WHERE id = ?),0),
      COALESCE((SELECT MAX(last_seen) FROM user_sessions WHERE user_id = ?),0),
      COALESCE((SELECT MAX(created_at) FROM threads WHERE user_id = ?),0),
      COALESCE((SELECT MAX(created_at) FROM comments WHERE user_id = ?),0)) t`).get(id, id, id, id, id).t;

  // Bezugspunkt: letzte Aktivität, aber nie vor dem Ende einer Pause (dann 5 Tage Schonfrist)
  const reference = (id, r) => Math.max(lastActive(id), r.vac_end || 0);
  const pctFor = (stage, c) => Math.min(c.cap, c.pct * stage);

  function runFor(u, c, at = now()) {
    const r = rowOf(u.id);
    if (r.vac_end > at) return 0; // Pause läuft
    const days = Math.floor((at - reference(u.id, r)) / DAY);
    const stage = Math.min(c.max_stage, Math.max(0, Math.floor(days / c.days)));
    if (stage < r.stage) { r.stage = stage; save(r); return 0; } // wieder aktiv
    if (stage === r.stage) return 0;
    let taken = 0;
    for (let s = r.stage + 1; s <= stage; s++) {
      const bal = db.prepare('SELECT credits FROM users WHERE id = ?').get(u.id).credits;
      const amt = Math.floor((bal * pctFor(s, c)) / 100);
      if (amt >= 1 && eco.charge(u.id, amt, 'inactivity', `Stufe ${s} (${pctFor(s, c)} %)`)) { eco.toTreasury(amt); taken += amt; }
    }
    r.stage = stage; save(r);
    return taken;
  }
  function sweep() {
    const c = cfg(); if (!c.on) return 0;
    let total = 0;
    for (const u of db.prepare("SELECT u.id FROM users u WHERE u.deleted = 0 AND u.status <> 'gebannt' AND u.credits > 0").all()) {
      const full = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
      if (acc.isTeam(acc.hydrate(full))) continue;
      total += runFor(u, c);
    }
    return total;
  }
  const iv = setInterval(() => { try { sweep(); } catch (e) { console.error('inactivity', e.message); } }, 3600_000); iv.unref();
  const st = setTimeout(() => { try { sweep(); } catch { /* egal */ } }, 30_000); st.unref();

  function status(u) {
    const c = cfg(), r = rowOf(u.id), t = now();
    const ref = reference(u.id, r), days = Math.floor((t - ref) / DAY), onVac = r.vac_end > t;
    const nextStage = Math.min(c.max_stage, Math.floor(days / c.days) + 1);
    return { enabled: c.on, exempt: acc.isTeam(u), on_vacation: onVac, vacation_until: onVac ? r.vac_end : null, grace_until: !onVac && r.vac_end && t < r.vac_end + c.days * DAY ? r.vac_end + c.days * DAY : null,
      can_start_vacation: !onVac && t >= r.cooldown_until, vacation_available_at: r.cooldown_until > t ? r.cooldown_until : null, inactive_days: days, stage: r.stage,
      next_deduction_in_days: onVac ? null : Math.max(0, nextStage * c.days - days), next_percent: pctFor(nextStage, c), rule: { days: c.days, pct: c.pct, cap: c.cap, vac_days: c.vac_days, cooldown_days: c.cooldown_days } };
  }
  GET('/api/economy/inactivity', acc.requireUser, (req, res) => send(res, 200, status(req.user)));
  POST('/api/economy/vacation', rl('vac', 10, 3600_000), acc.requireUser, jsonBody, (req, res) => {
    const c = cfg(), r = rowOf(req.user.id), t = now();
    if (req.body.action === 'end') {
      if (r.vac_end <= t) return fail(res, 400, 'Keine Pause aktiv');
      r.vac_end = t; save(r); return send(res, 200, status(req.user));
    }
    if (r.vac_end > t) return fail(res, 400, 'Du bist schon in der Pause');
    if (t < r.cooldown_until) return fail(res, 400, `Die nächste Pause ist erst am ${new Date(r.cooldown_until).toLocaleDateString('de-DE')} möglich`);
    r.vac_end = t + c.vac_days * DAY; r.cooldown_until = r.vac_end + c.cooldown_days * DAY; r.vac_count++; r.stage = 0; save(r);
    send(res, 200, status(req.user));
  });

  // Admin
  const perm = acc.requirePerm('settings.edit');
  GET('/api/admin/inactivity', perm, (req, res) => send(res, 200, { config: cfg() }));
  PUT('/api/admin/inactivity', perm, jsonBody, (req, res) => {
    const b = req.body, c = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(Number(v) || 0)));
    const { setSetting } = ctx;
    if ('on' in b) setSetting('g_inact_on', b.on ? '1' : '0');
    for (const [k, key, lo, hi] of [['days', 'g_inact_days', 1, 365], ['pct', 'g_inact_pct', 0, 50], ['cap', 'g_inact_cap', 0, 100], ['vac_days', 'g_vac_days', 1, 365], ['cooldown_days', 'g_vac_cooldown', 0, 730]]) if (k in b) setSetting(key, String(c(b[k], lo, hi)));
    audit(req.admin.username, 'inactivity_update', Object.keys(b).join(', '));
    send(res, 200, { ok: true, config: cfg() });
  });
  POST('/api/admin/inactivity/sweep', perm, jsonBody, (req, res) => { const n = sweep(); audit(req.admin.username, 'inactivity_sweep', String(n)); send(res, 200, { taken: n }); });

  return { sweep, runFor, status };
};
