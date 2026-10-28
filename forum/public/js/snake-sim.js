/* turkac.org – Snake-Simulation. Läuft im Browser (Spiel) UND auf dem Server (Nachprüfung der Punkte).
   Gleicher Startwert (seed) + gleiche Richtungswechsel = gleiches Ergebnis. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.SnakeSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const N = 16;
  const V = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
  const OPP = { U: 'D', D: 'U', L: 'R', R: 'L' };
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function create(seed) {
    const s = { n: N, rnd: rng(seed), body: [[7, 8], [6, 8], [5, 8]], dir: 'R', food: null, score: 0, dead: false, tick: 0 };
    place(s); return s;
  }
  function place(s) {
    const taken = new Set(s.body.map((p) => p[0] + ',' + p[1])), free = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!taken.has(x + ',' + y)) free.push([x, y]);
    s.food = free.length ? free[Math.floor(s.rnd() * free.length)] : null;
  }
  // Ein Schritt. turn = 'U'|'D'|'L'|'R' oder null.
  function step(s, turn) {
    if (s.dead) return s;
    if (turn && V[turn] && OPP[turn] !== s.dir) s.dir = turn;
    s.tick++;
    const h = s.body[0], v = V[s.dir], nx = h[0] + v[0], ny = h[1] + v[1];
    const eat = s.food && nx === s.food[0] && ny === s.food[1];
    const body = eat ? s.body : s.body.slice(0, -1);
    if (nx < 0 || ny < 0 || nx >= N || ny >= N || body.some((p) => p[0] === nx && p[1] === ny)) { s.dead = true; return s; }
    s.body.unshift([nx, ny]);
    if (eat) { s.score++; place(s); } else s.body.pop();
    return s;
  }
  // Nachspielen: turns = [[tick, 'U'], ...] (Richtungswechsel VOR dem Schritt mit dieser Nummer), ticks = Anzahl Schritte
  function replay(seed, turns, ticks) {
    const s = create(seed), map = new Map();
    for (const t of turns) if (Array.isArray(t) && Number.isInteger(t[0]) && V[t[1]]) map.set(t[0], t[1]);
    for (let i = 1; i <= ticks && !s.dead; i++) step(s, map.get(i) || null);
    return { score: s.score, dead: s.dead, ticks: s.tick };
  }
  return { N, create, step, replay };
});
