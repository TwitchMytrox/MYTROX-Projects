/* Rechtstexte: /impressum, /datenschutz, /agb, /regeln – aus Mustertexten + Betreiberangaben (im Admin-Bereich pflegbar).
   WICHTIG: Die Mustertexte sind keine Rechtsberatung. Vor dem Öffentlichgehen prüfen lassen. */
const chrome = require('./chrome');
module.exports = function init(ctx, acc) {
  const { db, getSetting, setSetting, GET, PUT, send, fail, jsonBody, audit, clean } = ctx;
  const { requirePerm } = acc;
  const KEYS = ['operator_name', 'operator_address', 'operator_email', 'impressum', 'datenschutz', 'agb', 'regeln', 'cookies', 'barrierefreiheit'];
  const get = (k) => getSetting('legal_' + k, '') || '';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const TODO = '[Bitte im Admin-Bereich unter „Rechtstexte“ ausfüllen]';
  const op = () => ({ name: get('operator_name') || TODO, address: get('operator_address') || TODO, email: get('operator_email') || TODO });

  const DEFAULTS = {
    impressum: () => { const o = op(); return `## Angaben gemäß § 5 DDG\n${o.name}\n${o.address}\n\n## Kontakt\nE-Mail: ${o.email}\n\n## Verantwortlich für den Inhalt\n${o.name}, Anschrift wie oben.\n\n## Hinweis zu Nutzerbeiträgen\nBeiträge, Kommentare und Dateien stammen von Mitgliedern. Für diese Inhalte sind die jeweiligen Autoren verantwortlich. Rechtsverstöße können über die Meldefunktion im Forum oder per E-Mail gemeldet werden; wir prüfen Meldungen zeitnah.`; },
    datenschutz: () => { const o = op(); return `## 1. Verantwortlicher\n${o.name}, ${o.address}\nE-Mail: ${o.email}\n\n## 2. Überblick\nDieses Forum funktioniert mit einem anonymen Konto: Du brauchst keinen Klarnamen und keine E-Mail-Adresse. Wir erheben nur die Daten, die für den Betrieb nötig sind.\n\n## 3. Welche Daten wir verarbeiten\n- **Konto:** Benutzername, Passwort (nur als Hash, nie im Klartext), Wiederherstellungscodes (nur als Hash), optional Profilbild und Kurzbeschreibung, Einstellungen, Zeitpunkt der Registrierung und Anmeldungen.\n- **Zwei-Faktor:** Das Geheimnis wird verschlüsselt gespeichert.\n- **Team-Konten:** zusätzlich eine verschlüsselte E-Mail-Adresse für Sicherheitszwecke.\n- **Beiträge:** Threads, Kommentare, Reaktionen und hochgeladene Dateien, verknüpft mit deinem Benutzernamen.\n- **Direktnachrichten:** werden verschlüsselt gespeichert und vom Team nicht gelesen.\n- **Netzwerkkennung:** Deine IP-Adresse wird nur als nicht umkehrbarer Hash gespeichert, um Missbrauch zu begrenzen (Sperren, Spam-Schutz, Mehrfach-Meldungen).\n- **Sicherheitsprotokoll:** Verwaltungs- und Sicherheitsereignisse werden manipulationssicher und verschlüsselt protokolliert.\n- **Fortschritt:** Erfahrungspunkte, Credits und Abzeichen.\n\n## 4. Zwecke und Rechtsgrundlagen\nBetrieb des Forums und der Konten (Art. 6 Abs. 1 lit. b DSGVO), Sicherheit und Missbrauchsabwehr (Art. 6 Abs. 1 lit. f DSGVO), Erfüllung rechtlicher Pflichten (Art. 6 Abs. 1 lit. c DSGVO).\n\n## 5. Cookies und lokaler Speicher\nWir setzen ein technisch notwendiges Cookie („nx_session“), das dich angemeldet hält. Es dient nicht dem Tracking. Zusätzlich speichert dein Browser Anzeige-Einstellungen (z. B. Design, Schriftgröße, Sound) lokal. Es gibt keine Werbe- oder Analyse-Cookies.\n\n## 6. Schriftarten\nDie Seite lädt Schriftarten derzeit von Google Fonts. Dabei wird deine IP-Adresse an Google übertragen. ${'[Betreiber: Schriftarten besser selbst hosten und diesen Absatz dann streichen.]'}\n\n## 7. Speicherdauer\nKontodaten bis zur Löschung deines Kontos. Beim Löschen werden Anmeldedaten, Profil und Direktnachrichten entfernt; Beiträge bleiben anonymisiert („Gelöschter Nutzer“) bestehen. Sicherheitsprotokolle werden nach Bedarf aufbewahrt.\n\n## 8. Deine Rechte\nDu kannst Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch verlangen. Einen Export deiner Daten findest du im Menü unter „Konto“ → „Daten“, dort kannst du dein Konto auch löschen. Außerdem hast du das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren.\n\n## 9. Kontakt\nFragen zum Datenschutz: ${o.email}`; },
    agb: () => `## Nutzungsbedingungen\n## 1. Geltungsbereich\nDiese Bedingungen gelten für die Nutzung des Forums. Mit der Registrierung erklärst du dich einverstanden.\n\n## 2. Konto\nDu wählst einen Benutzernamen und ein Passwort. Bewahre deine Wiederherstellungscodes sicher auf: Ohne E-Mail ist ein Zurücksetzen des Passworts nur damit möglich. Du bist für Aktivitäten über dein Konto verantwortlich.\n\n## 3. Inhalte\nDu darfst nur Inhalte veröffentlichen, an denen du die nötigen Rechte hast. Du räumst uns das einfache Recht ein, diese Inhalte im Forum anzuzeigen und zu speichern. Verboten sind insbesondere rechtswidrige, jugendgefährdende, hasserfüllte, belästigende oder private Daten Dritter enthaltende Inhalte sowie Spam und Schadsoftware.\n\n## 4. Moderation\nDas Team kann Inhalte entfernen, Verwarnungen aussprechen, Konten zeitweise sperren oder dauerhaft bannen, wenn gegen diese Bedingungen oder die Regeln verstoßen wird.\n\n## 5. Haftung\nWir haften nicht für Nutzerinhalte. Wir bemühen uns um einen stabilen Betrieb, können aber keine ständige Verfügbarkeit garantieren.\n\n## 6. Änderungen\nWir können diese Bedingungen anpassen. Wesentliche Änderungen werden im Forum angekündigt.`,
    regeln: () => `## Die Regeln der Arena\n- Sei fair und respektvoll. Kritik am Beitrag, nicht an der Person.\n- Keine Beleidigungen, Hetze, Diskriminierung oder Belästigung.\n- Keine privaten Daten anderer (Doxxing), keine Aufrufe zu Gewalt.\n- Keine illegalen Inhalte, kein Jugendgefährdendes, keine Raubkopien oder Cheats-Verkauf.\n- Kein Spam, keine Massenwerbung, keine Mehrfach-Konten, um Ränge oder Reaktionen zu erschleichen.\n- Spoiler bitte mit ||Spoiler|| verstecken.\n- Beiträge in die passende Kategorie.\n- Verstöße melden, nicht anheizen. Das Team entscheidet.`,
    cookies: () => `## Welche Cookies setzen wir?\nWir setzen nur ein **technisch notwendiges** Cookie: das Anmelde-Cookie. Es hält dich angemeldet und wird nur gesetzt, wenn du dich anmeldest oder registrierst.\n\n## Was wir nicht tun\n- Kein Tracking, keine Werbe-Cookies, keine Analyse-Dienste.\n- Keine Drittanbieter-Cookies. Hinweis: Die Schriftarten werden aktuell von Google Fonts geladen, dabei wird deine IP-Adresse an Google übertragen. [Bitte vor dem Livegang auf selbst gehostete Schriften umstellen oder diesen Satz anpassen.]\n\n## Lokale Speicherung im Browser\nEinstellungen wie Schriftgröße, Kontrast, Sound und Bewegung speichert dein Browser lokal (localStorage). Diese Daten verlassen dein Gerät nicht.\n\n## Cookie löschen\nDu kannst das Cookie jederzeit in deinem Browser löschen oder dich abmelden. Danach bist du abgemeldet.`,
    barrierefreiheit: () => { const o = op(); return `## Unser Ziel\nturkac.org soll für alle nutzbar sein – mit Tastatur, Screenreader, am Handy und am PC.\n\n## Was wir umgesetzt haben\n- Bedienung komplett per Tastatur, sichtbarer Fokus, Sprunglink „Zum Inhalt springen“.\n- Ausreichende Kontraste und große Klickflächen.\n- Einstellbare Schriftgröße, hoher Kontrast und reduzierte Bewegung (unter Konto → Barrierefreiheit).\n- Animationen werden abgeschaltet, wenn dein Gerät „weniger Bewegung“ meldet.\n- Sicherheitsprüfung bei der Registrierung läuft automatisch im Hintergrund, mit einfacher Textfrage als Alternative.\n\n## Noch nicht perfekt\nWir testen laufend, haben aber noch nicht jede Seite mit allen Hilfsmitteln geprüft. Wenn dir etwas auffällt, sag uns Bescheid.\n\n## Barriere melden\nErstelle ein Ticket im [Support](/support/) oder schreibe an ${o.email}.`; },
  };
  const TITLES = { impressum: 'Impressum', datenschutz: 'Datenschutzerklärung', agb: 'Nutzungsbedingungen', regeln: 'Regeln', cookies: 'Cookies', barrierefreiheit: 'Barrierefreiheit' };

  function md(src) {
    const out = []; let list = false;
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\((\/[^\s)"<]*)\)/g, '<a href="$2">$1</a>');
    for (const line of String(src).split('\n')) {
      if (/^- /.test(line)) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(line.slice(2))}</li>`); continue; }
      if (list) { out.push('</ul>'); list = false; }
      if (/^## /.test(line)) out.push(`<h2>${inline(line.slice(3))}</h2>`);
      else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
    if (list) out.push('</ul>');
    return out.join('\n');
  }

  function page(key) {
    const text = get(key) || DEFAULTS[key]();
    const siteName = getSetting('site_name', 'turkac.org');
    const nav = Object.keys(TITLES).map((k) => `<a href="/${k}"${k === key ? ' aria-current="page"' : ''}>${TITLES[k]}</a>`).join(' · ');
    return `<!doctype html><html lang="de" data-site="${esc(siteName)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${TITLES[key]} – ${esc(siteName)}</title><meta name="robots" content="noindex,follow"><meta name="theme-color" content="#07070f"><link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/css/pages.css"><link rel="stylesheet" href="/css/chrome.css"><link rel="stylesheet" href="/css/legal.css"></head><body><a class="skip-link" href="#main">Zum Inhalt springen</a><canvas id="bg" aria-hidden="true"></canvas>${chrome.header(siteName, '')}<main id="main" class="wrap legal"><article class="card"><h1>${TITLES[key]}</h1>${md(text)}</article></main>${chrome.footer(siteName, '/' + (key === 'agb' ? 'agb' : key))}<script src="/js/chrome.js"></script><script src="/js/bg.js"></script><script src="/js/sfx.js"></script><script src="/js/fx.js"></script></body></html>`;
  }
  const slug = { '/impressum': 'impressum', '/datenschutz': 'datenschutz', '/agb': 'agb', '/nutzungsbedingungen': 'agb', '/regeln': 'regeln', '/cookies': 'cookies', '/barrierefreiheit': 'barrierefreiheit' };
  for (const [p, key] of Object.entries(slug)) GET(p, (req, res) => {
    const html = page(key);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(html);
  });

  GET('/api/admin/legal', requirePerm('settings.edit'), (req, res) => {
    const out = { defaults: {} };
    for (const k of KEYS) out[k] = get(k);
    for (const k of Object.keys(DEFAULTS)) out.defaults[k] = DEFAULTS[k]();
    send(res, 200, out);
  });
  PUT('/api/admin/legal', requirePerm('settings.edit'), jsonBody, (req, res) => {
    for (const k of KEYS) if (k in req.body) setSetting('legal_' + k, String(req.body[k] || '').replace(/\r/g, '').slice(0, 20000));
    audit(req.admin.username, 'legal_update', Object.keys(req.body).join(', '));
    send(res, 200, { ok: true });
  });
  return {};
};
