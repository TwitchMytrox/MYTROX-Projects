'use strict';
// Rechte-Katalog und Standard-Rollen für das Team.
// Neue Rechte hier eintragen – sie erscheinen automatisch im Admin unter "Rollen".

const PERMISSIONS = [
  { key: 'admin.access', group: 'Allgemein', label: 'Admin-Bereich betreten' },
  { key: 'stats.view', group: 'Allgemein', label: 'Statistiken ansehen' },
  { key: 'threads.moderate', group: 'Inhalte', label: 'Threads moderieren (pinnen, sperren, löschen, verschieben)' },
  { key: 'comments.moderate', group: 'Inhalte', label: 'Kommentare moderieren' },
  { key: 'media.manage', group: 'Inhalte', label: 'Medien/Uploads verwalten' },
  { key: 'reports.handle', group: 'Inhalte', label: 'Meldungen bearbeiten' },
  { key: 'categories.manage', group: 'Inhalte', label: 'Kategorien verwalten' },
  { key: 'words.manage', group: 'Inhalte', label: 'Wortfilter verwalten' },
  { key: 'tournaments.review', group: 'Inhalte', label: 'Turniere prüfen, freigeben und Gewinner bestätigen' },
  { key: 'tickets.handle', group: 'Inhalte', label: 'Support-Tickets bearbeiten (antworten, schließen, weiterleiten)' },
  { key: 'blog.manage', group: 'Inhalte', label: 'Blog, News & Werbung schreiben und veröffentlichen' },
  { key: 'users.view', group: 'Nutzer', label: 'Nutzerliste & Profile ansehen' },
  { key: 'users.warn', group: 'Nutzer', label: 'Nutzer verwarnen' },
  { key: 'users.timeout', group: 'Nutzer', label: 'Timeouts setzen (zeitlich begrenzt)' },
  { key: 'users.status', group: 'Nutzer', label: 'Konto-Stufe ändern (normal / Verdacht / Untersuchung)' },
  { key: 'users.ban', group: 'Nutzer', label: 'Konten dauerhaft bannen' },
  { key: 'users.names', group: 'Nutzer', label: 'Benutzernamen-Liste verwalten (Namen freigeben)' },
  { key: 'users.roles', group: 'Nutzer', label: 'Rollen an Nutzer vergeben' },
  { key: 'bans.ip', group: 'Nutzer', label: 'Netzwerk-Sperren (IP) verwalten' },
  { key: 'roles.manage', group: 'System', label: 'Rollen & Rechte bearbeiten' },
  { key: 'settings.edit', group: 'System', label: 'Einstellungen ändern' },
  { key: 'maintenance.manage', group: 'System', label: 'Wartungsmodus & Timer steuern' },
  { key: 'audit.view', group: 'System', label: 'Protokoll ansehen' },
  { key: 'backup.download', group: 'System', label: 'Datenbank-Backup herunterladen' },
];
const ALL_KEYS = PERMISSIONS.map((p) => p.key);

// level: höhere Rollen dürfen niedrigere verwalten, nie umgekehrt
const DEFAULT_ROLES = [
  { key: 'owner', name: 'Inhaber', color: '#ffb800', level: 100, permissions: ['*'] },
  { key: 'admin', name: 'Administrator', color: '#ff2bd6', level: 80, permissions: ALL_KEYS.filter((k) => k !== 'roles.manage') },
  {
    key: 'moderator',
    name: 'Moderator',
    color: '#00f0ff',
    level: 50,
    permissions: [
      'admin.access', 'stats.view', 'threads.moderate', 'comments.moderate', 'media.manage', 'reports.handle',
      'users.view', 'users.warn', 'users.timeout', 'tickets.handle', 'tournaments.review',
    ],
  },
  { key: 'support', name: 'Support', color: '#b6ff3b', level: 20, permissions: ['admin.access', 'stats.view', 'reports.handle', 'tickets.handle', 'tournaments.review', 'users.view', 'users.warn'] },
];

const STATUSES = {
  normal: { label: 'Normal', desc: 'Alles in Ordnung.' },
  verdacht: { label: 'Verdacht', desc: 'Dein Konto wird beobachtet, weil etwas auffällig war.' },
  untersuchung: { label: 'Untersuchung', desc: 'Dein Konto wird geprüft. Uploads und neue Threads sind vorübergehend eingeschränkt.' },
  gebannt: { label: 'Gebannt', desc: 'Dein Konto wurde gesperrt. Du kannst nichts mehr schreiben.' },
};

// Rechte, die später dazukamen: werden bestehenden System-Rollen einmalig nachgetragen
const ADDED_LATER = ['tickets.handle', 'blog.manage', 'tournaments.review'];
module.exports = { ADDED_LATER, PERMISSIONS, ALL_KEYS, DEFAULT_ROLES, STATUSES };
