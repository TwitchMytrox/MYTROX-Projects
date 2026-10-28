/* Ränge & Abzeichen – reine Daten (keine Datenbank) */
const RANKS = [
  { name: 'Rekrut', icon: '🪖', xp: 0 },
  { name: 'Gefreiter', icon: '🔰', xp: 50 },
  { name: 'Obergefreiter', icon: '🥉', xp: 150 },
  { name: 'Unteroffizier', icon: '🥈', xp: 350 },
  { name: 'Feldwebel', icon: '🥇', xp: 700 },
  { name: 'Leutnant', icon: '🎖️', xp: 1200 },
  { name: 'Hauptmann', icon: '🏅', xp: 2000 },
  { name: 'Major', icon: '⭐', xp: 3200 },
  { name: 'Oberst', icon: '🌟', xp: 5000 },
  { name: 'General', icon: '👑', xp: 8000 },
];
function rankOf(xp = 0) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const next = RANKS[i + 1] || null;
  return { index: i, name: RANKS[i].name, icon: RANKS[i].icon, xp, next: next ? { name: next.name, xp: next.xp } : null,
    progress: next ? Math.min(1, (xp - RANKS[i].xp) / (next.xp - RANKS[i].xp)) : 1 };
}
// need(stats) → true, wenn verdient. stats: {threads, comments, reactions_got, days, totp}
const BADGES = [
  { key: 'erstkontakt', icon: '📡', name: 'Erstkontakt', desc: 'Ersten Beitrag geschrieben', need: (s) => s.threads + s.comments >= 1 },
  { key: 'stratege', icon: '🧭', name: 'Stratege', desc: '3 eigene Threads gestartet', need: (s) => s.threads >= 3 },
  { key: 'funker', icon: '📻', name: 'Funker', desc: '25 Kommentare geschrieben', need: (s) => s.comments >= 25 },
  { key: 'sprachrohr', icon: '📢', name: 'Sprachrohr', desc: '150 Kommentare geschrieben', need: (s) => s.comments >= 150 },
  { key: 'beliebt', icon: '🔥', name: 'Beliebt', desc: '25 Reaktionen erhalten', need: (s) => s.reactions_got >= 25 },
  { key: 'legende', icon: '💎', name: 'Legende', desc: '200 Reaktionen erhalten', need: (s) => s.reactions_got >= 200 },
  { key: 'veteran', icon: '🛡️', name: 'Veteran', desc: '30 Tage dabei', need: (s) => s.days >= 30 },
  { key: 'gesichert', icon: '🔐', name: 'Gesichert', desc: 'Zwei-Faktor aktiviert', need: (s) => s.totp },
];
module.exports = { RANKS, rankOf, BADGES };
