# turkac.org – API (Stand Etappe 1)

Alle Antworten sind JSON. Fehler: `{ "error": "Text auf Deutsch", "code": "OPTIONAL_CODE" }`.
Anmeldung per Cookie `nx_session` (HttpOnly, SameSite=Lax) – das Frontend braucht nichts weiter zu tun
(`fetch` mit `credentials: 'same-origin'`, das ist Standard). Schreibende Anfragen: `Content-Type: application/json`.

## Fehlercodes (`code`)
`LOGIN_REQUIRED` (401) · `SETUP_REQUIRED` (403, Team ohne 2FA/E-Mail) · `BANNED` · `TIMEOUT` (+`until`) · `HIDDEN` · `RESTRICTED` · `maintenance:true` (503)

## Öffentlich
| Methode | Pfad | Antwort |
|---|---|---|
| GET | `/api/config` | `site_name, tagline, announcement, guest_read, require_login_to_post, registration_open, uploads_enabled, max_upload_mb, maintenance (nur Team)` … |
| GET | `/api/stats` | `{threads, comments, files, reactions, members}` |
| GET | `/api/maintenance` | `{active, until (ms|null), message, name}` |

## Auth (`/api/auth/*`)
| Methode | Pfad | Body → Antwort |
|---|---|---|
| GET | `/api/auth/suggest` | → `{name}` zufälliger freier Name |
| GET | `/api/auth/check-name?name=X` | → `{ok, problem}` (Live-Prüfung beim Tippen) |
| POST | `/api/auth/register` | `{username, password, accept:true}` → 201 `{user, recovery_codes:[10 Strings]}` – Codes werden NUR hier einmalig geliefert; Sitzung ist sofort aktiv |
| POST | `/api/auth/login` | `{username, password, code?}` → `{need_2fa:true}` (noch KEINE Sitzung) oder `{user, remind_2fa, recovery_codes_left?}`. `code` = 6-stelliger App-Code ODER Wiederherstellungscode |
| POST | `/api/auth/logout` | → `{ok}` |
| GET | `/api/auth/me` | → `{user|null}` |
| POST | `/api/auth/recover` | `{username, code, new_password}` → `{ok}` (Passwort vergessen, nur mit Wiederherstellungscode) |

`user`-Objekt: `id, username, role{key,name,color,level}|null, team, perms[], setup_required, status (normal|verdacht|untersuchung|gebannt), status_label, status_desc, status_note, status_since, timeout{mode,until,reason}|null, warnings, bio, avatar (URL|null), settings{theme,font_size,notify_popups,reduce_motion,high_contrast,sound}, totp_on, has_email, created_at, login_count, rename_available_at`

Regeln: Benutzername 3–20 Zeichen `A-Za-z0-9_-`; Passwort min. 8 Zeichen; Wiederherstellungscode-Format `ABCD-EFGH-JKLM`.
Nach 5 Fehlversuchen ist ein Konto 10 Min. gesperrt (HTTP 429).

## Konto (`/api/account/*`, Login nötig)
| Methode | Pfad | Body |
|---|---|---|
| GET | `/api/account` | → `{user, recovery_codes_left, sessions}` |
| PATCH | `/api/account/profile` | `{bio}` (max 300) |
| POST | `/api/account/avatar` | multipart, Feld `avatar` (PNG/JPG/WebP/GIF, max 1 MB) → `{avatar}` |
| DELETE | `/api/account/avatar` | |
| POST | `/api/account/username` | `{username, password}` (alle 14 Tage; alter Name bleibt reserviert) |
| POST | `/api/account/password` | `{current, next}` |
| PATCH | `/api/account/settings` | `{theme:'dark'|'light'|'system', font_size:'normal'|'large'|'xlarge', notify_popups, reduce_motion, high_contrast, sound}` |
| POST | `/api/account/2fa/setup` | `{password}` → `{secret (Base32), uri (otpauth://…)}` |
| POST | `/api/account/2fa/enable` | `{code}` → `{ok, recovery_codes:[…]}` (neue Codes!) |
| POST | `/api/account/2fa/disable` | `{password, code}` (nicht für Team) |
| POST | `/api/account/recovery-codes` | `{password, code?}` → `{recovery_codes}` (ersetzt alle alten) |
| POST | `/api/account/email` | `{password, email}` (leer = entfernen; Team: Pflicht) |
| POST | `/api/account/logout-all` | beendet alle anderen Sitzungen |
| GET | `/api/account/export` | JSON-Download aller eigenen Daten |
| POST | `/api/account/delete` | `{password, confirm: <Benutzername>, code?}` |
| GET | `/api/users/:name` | öffentliches Profil `{username, role, bio, avatar, created_at, threads, comments, banned}` |

## Admin (`/api/admin/*`) – Rechte-geprüft
Nur Konten mit Rolle + Recht `admin.access`; Team MUSS 2FA + E-Mail haben, sonst `SETUP_REQUIRED`
(dann nur `/api/account/*` und `GET /api/admin/me` nutzbar). Die Login-Seite ist dieselbe wie im Forum (`/api/auth/login`).

`GET /api/admin/me` → `{username, user (siehe oben, mit perms + setup_required), permissions:[{key,group,label}]}`

Rechte-Schlüssel: `admin.access, stats.view, threads.moderate, comments.moderate, media.manage, reports.handle, categories.manage, words.manage, users.view, users.warn, users.timeout, users.status, users.ban, users.names, users.roles, bans.ip, roles.manage, settings.edit, maintenance.manage, audit.view, backup.download`

| Methode | Pfad | Recht | Hinweis |
|---|---|---|---|
| GET | `/api/admin/stats` | stats.view | zusätzlich `members`, `today_members` |
| GET/PATCH/DELETE | `/api/admin/threads…`, `/comments…` | *.moderate | Zeilen haben jetzt `author` (Benutzername|null) |
| GET/DELETE | `/api/admin/media…` | media.manage | |
| GET/POST | `/api/admin/reports…` | reports.handle | `target.author` |
| GET/POST/DELETE | `/api/admin/bans…` (IP) | bans.ip | |
| GET/POST/DELETE | `/api/admin/words…` | words.manage | |
| GET/POST/PUT/DELETE | `/api/admin/categories…` | categories.manage | |
| GET/PUT | `/api/admin/settings` | settings.edit | neu: `registration_open, require_login_to_post, guest_read` (je `'1'`/`'0'` bzw. bool) |
| GET | `/api/admin/audit` | audit.view | |
| GET | `/api/admin/backup` | backup.download | Datei-Download |
| GET | `/api/admin/users?q&status&role&timeout&page` | users.view | `role`: `team` \| `none` \| Rollen-key. → `{total,pages,rows:[{id,username,role,status,timeout,created_at,last_login,login_count,totp_on,threads,comments,warnings}],statuses}` |
| GET | `/api/admin/users/:id` | users.view | → `{user (+bio,avatar,status_note,status_since,timeout_reason,has_email,recovery_codes_left,sessions,locked_until), warnings_list, names, recent}` |
| PATCH | `/api/admin/users/:id/status` | users.status (+users.ban für „gebannt“) | `{status, note}` |
| POST/DELETE | `/api/admin/users/:id/timeout` | users.timeout | `{minutes, mode:'write'|'hidden', reason}` (Mod: max. 30 Tage) |
| POST | `/api/admin/users/:id/warn` | users.warn | `{reason}` → `{count, escalated}` (3 Verwarnungen → „Verdacht“) |
| DELETE | `/api/admin/warnings/:id` | users.status | |
| POST | `/api/admin/users/:id/role` | users.roles | `{role_id|null}` |
| POST | `/api/admin/users/:id/reset-sessions` | users.status | beendet Sitzungen, hebt Login-Sperre auf |
| POST | `/api/admin/users/:id/clear-profile` | users.status | Avatar + Bio entfernen |
| GET | `/api/admin/names?q&kind=reserved|registered&page` | users.names | → `{rows:[{name_lc,name,kind,created_at,user_id,owner_name,in_use,owner_deleted}]}` |
| POST | `/api/admin/names` | users.names | `{name}` Name reservieren |
| DELETE | `/api/admin/names/:name_lc` | users.names | Name freigeben (409 wenn aktiv in Benutzung) |
| GET | `/api/admin/roles` | users.view | → `{roles:[{id,key,name,color,level,system,permissions[],users}], catalogue:[{key,group,label}], my_level}` |
| POST/PUT/DELETE | `/api/admin/roles…` | roles.manage | `{name,color,level,permissions[]}`; Stufe muss unter der eigenen liegen; nur eigene Rechte vergebbar; Inhaber-Rolle fest |
| GET/PUT | `/api/admin/maintenance` | maintenance.manage | s. u. |

### Wartungsmodus
`GET` → `{active, scheduled, start, until, message, redirect, on}` (Zeiten in ms seit 1970)
`PUT` Body (Beispiele):
- sofort an, 30 Min.: `{on:true, minutes:30, message, redirect}`
- sofort an, unbefristet: `{on:true, message}`
- geplant: `{start:<ms>, until:<ms>, message}`
- aus / Plan löschen: `{on:false}`
`redirect` optional (http/https-URL): Besucher werden während der Wartung dorthin geleitet.
Nach `until` schaltet sich die Seite automatisch wieder ein. Team kann währenddessen normal weiterarbeiten.

## Seiten
`/` → Landingpage (Gäste) bzw. Forum (angemeldet) · `/forum` → Forum (Gäste nur wenn `guest_read`) · `/auth/` → Anmelden/Registrieren · `/admin/` → Admin · bei Wartung: `/maintenance.html` (503)

## Etappe 2: Meldezentrum & Protokoll
- `POST /api/report` `{type:'thread'|'comment', id, category: spam|beleidigung|hass|illegal|jugendschutz|datenschutz|sonstiges, reason}` – Login nötig.
- `GET /api/admin/reports?status=open|resolved&category=` → Karten pro Inhalt `{id, count, urgent, categories{}, status: open|working|done, handled_by, note, outcome, reports[{reason,category,reporter}], target}`; illegal/jugendschutz = dringend, oben einsortiert.
- `POST /api/admin/reports/:id/claim` `{release?}` · `POST /api/admin/reports/:id/resolve` `{action: dismiss|delete|ban, note}`.
- `GET /api/admin/audit?page&q` → `{rows, total, pages, chain:{ok, checked, broken_at?}}`. Einträge sind AES-256-GCM-verschlüsselt, per Hash-Kette verkettet, SQLite-Trigger verbieten UPDATE/DELETE.
  Grenze: Wer Dateizugriff auf Datenbank UND Schlüssel hat, könnte die Kette komplett neu aufbauen; Löschen am Ende ist ohne externen Anker nicht erkennbar.

## Etappe 3: Ränge, XP, Credits, Abzeichen
- `GET /api/ranks` → Rangleiter, Abzeichen-Katalog, Regeln. `GET /api/account/progress` (Login) → `{xp, credits, rank{name,icon,index,next,progress}, badges[{earned_at}], recent}`. `GET /api/leaderboard` → Top 20.
- `POST /api/threads` / `/comments` liefern `reward:{xp, rank_up, badges[]}|null`. `user.xp/credits/rank` in `/api/auth/me`; `author.rank` an Beiträgen.
- Anti-Farming: Tageslimits (Thread 5, Kommentar 20, Reaktion 30, Login 1), Mindestlängen, keine Duplikate, max. 5 belohnte Kommentare je Thread/Tag, Reaktionen nur von Konten >24 h, nie selbst, max. 3 je Paar/Tag, jedes Ereignis nur einmal (UNIQUE).
- Team: `POST /api/admin/users/:id/xp {delta, reason}` (Recht `users.status`, wird protokolliert).
- Credits werden gesammelt, ein Ausgeben (Shop) gibt es noch nicht.

## Etappe 4: Direktnachrichten
Alles mit Login; Texte AES-256-GCM-verschlüsselt gespeichert; Schreiben unterliegt Bann/Timeout.
- `GET /api/dm` Gespräche (+unread, blocked) · `GET /api/dm/unread` · `GET /api/dm/users?q=` Suche/Zuletzt · `GET /api/dm/:name` Verlauf (markiert gelesen)
- `POST /api/dm/:name {body}` · `POST /api/dm/share {to, type: thread|comment, id, note}` · `POST /api/dm/block {name}` · `DELETE /api/dm/block/:name`
- Schutz: max. 30 Nachrichten/Min., max. 15 neue Gespräche/Tag, Blockieren, gelöschtes Konto löscht seine Nachrichten; Export enthält eigene Nachrichten.
- Noch offen: Nachrichten melden, damit das Team sie sehen kann (bewusst nicht lesbar fürs Team).

## Etappe 5: Spam-Schutz
- `GET /api/captcha` → `{id, svg, enabled}` (Ziffern-Bild, selbst gehostet, 5 Min. gültig, einmalig). `POST /api/auth/register` nimmt zusätzlich `captcha_id, captcha, website (Honeypot, leer lassen), took_ms (Formularzeit ≥ 2,5 s)`.
- Einstellung `captcha_on` (Admin → Einstellungen). Honeypot + Zeitprüfung laufen immer.
- Beiträge (Nicht-Team): neue Konten max. 1 Link in den ersten 24 h (sonst max. 5), keine Zeichen-Fluten, nicht nur GROSSBUCHSTABEN, gleicher Text nicht erneut binnen 10 Min., erster Thread frühestens nach 10 Min. Konto-Alter. 5 Verstöße/Std. → 30 Min. Schreibsperre (automatisch, protokolliert).
- Tests: `NX_TEST_BYPASS_CAPTCHA=1` schaltet Captcha/Zeitprüfung NUR für automatische Tests ab (nie in Produktion setzen).
- Grenze: Ein selbst gebautes Captcha hält einfache Bots auf, keine gezielten. Später: Cloudflare Turnstile (zurückgestellt).

## Etappe 6: PWA, Rechtsseiten, Barrierefreiheit
- PWA: `/manifest.webmanifest`, `/sw.js` (cached nur Oberfläche, nie `/api/`, Uploads, Admin), `/offline.html`, Icons unter `/icons/`. Installieren-Knopf erscheint, wenn der Browser es anbietet.
- Rechtsseiten (immer öffentlich, auch bei Wartung/ohne Gast-Lesen): `/impressum`, `/datenschutz`, `/agb` (= `/nutzungsbedingungen`), `/regeln`. Mustertexte, Betreiberangaben und eigene Texte im Admin → Rechtstexte (`GET/PUT /api/admin/legal`, Recht `settings.edit`). Nicht Rechtsberatung.
- Offen: Google Fonts werden noch von Google geladen (Datenschutz!). Vor dem Livegang Schriftarten selbst hosten (woff2 nach `public/fonts/`, CSS anpassen, CSP-Einträge entfernen).

## Etappe 7: Sicherheitsschlüssel (WebAuthn / FIDO2)
Ohne Fremdbibliothek, Attestation „none“, Algorithmen ES256/RS256/EdDSA. Zählt als zweiter Faktor (Teammitglieder: erfüllt die 2FA-Pflicht, zusätzlich E-Mail nötig).
- `POST /api/account/webauthn/options {password}` → `{id, publicKey}` · `POST /api/account/webauthn/register {id, name, credential}` → `{recovery_codes?}` (bei erstem Faktor) · `GET /api/account/webauthn` · `DELETE /api/account/webauthn/:id {password}`
- Login: `POST /api/auth/login` ohne Code → `{need_2fa, methods:{totp, webauthn, challenge_id, publicKey}}`, danach erneut mit `webauthn:{id: challenge_id, credential}`. Wiederherstellungscodes funktionieren weiter, falls der Schlüssel verloren geht.
- Betrieb: Relying-Party-ID = Hostname der Seite (bei Domain-Wechsel Schlüssel neu registrieren). Optional `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` setzen (z. B. hinter Proxy). Klon-Erkennung über Zähler. Browser braucht HTTPS (außer localhost).
- Der Admin-Einrichtungsassistent führt weiterhin über die Authenticator-App; Schlüssel kannst du danach unter Konto → Sicherheit ergänzen.

## Etappe 8 – Support-Tickets & Blog

### Support (Mitglieder, Anmeldung nötig)
- `GET /api/support/categories` – Kategorien + Statusnamen
- `GET /api/support/tickets` – eigene Tickets (`unread` = neue Teamantwort)
- `GET /api/support/unread` – Anzahl ungelesener Tickets
- `POST /api/support/tickets` `{category, subject, body}` – erstellt Ticket, Nummer `T-XXXXXXXX` (zufällig). Limit: 6/Stunde, max. 8 offene.
- `GET /api/support/tickets/:id` – Verlauf (interne Notizen werden nie ausgeliefert)
- `POST /api/support/tickets/:id/reply|withdraw|reactivate|close`

Status: `open`, `in_progress`, `pending` (wartet auf Nutzer), `closed`, `withdrawn`.

### Support (Team, Recht `tickets.handle`)
- `GET /api/admin/tickets?status=active|all|<status>&category&group&assignee=me|none&q&page`
- `GET /api/admin/tickets/staff` – zuständige Teammitglieder
- `GET /api/admin/tickets/:id` – Ticket mit internen Notizen, Nutzerinfo, frühere Tickets
- `POST /api/admin/tickets/:id/reply` `{body, internal?}`
- `PATCH /api/admin/tickets/:id` `{status?, priority?, category?, subject?}`
- `POST /api/admin/tickets/:id/forward` `{assignee_id?, team_group?, note?}` (Bereiche: support, moderation, admin)

### Blog / News / Werbung
- Öffentlich: `GET /blog`, `GET /blog/:slug` (serverseitig gerendert, Slug zufällig), `GET /api/blog`
- Team (Recht `blog.manage`): `GET/POST /api/admin/blog`, `PATCH/DELETE /api/admin/blog/:id`
- Art `werbung` wird öffentlich immer als „Anzeige“ gekennzeichnet. Button-Links nur `https://`.

### Zwei-Faktor
- Für Teammitglieder freiwillig. Pflicht wieder einschalten: Admin → Einstellungen (`team_mfa_required`) oder Umgebungsvariable `TEAM_MFA_REQUIRED=1`.

## Etappe 9 – Credit-Wirtschaft, Turniere, Lostopf

### Wirtschaft
- Feste Gesamtmenge 11.000.000.000 Credits; Belohnungen kommen aus dem **Staatskonto**, Gebühren fließen zurück. Team-Korrekturen (`POST /api/admin/users/:id/xp`) buchen ebenfalls über das Staatskonto.
- Belohnungen (einstellbar): Anmeldung 2, Thread 7, Kommentar 4, Reaktion erhalten 3; **Tageslimit 20** (rollierend 24 h). XP laufen unabhängig weiter.
- `GET/PUT /api/admin/economy` (Recht `settings.edit`): Bestand, Limits, letzte Buchungen. `POST /api/admin/economy/draw`: Lostopf sofort ziehen.

### Lostopf
- `GET /api/lottery`, `POST /api/lottery/ticket` (Los = max(Mindest-Los 50, 20 % des Topfs), 1 Los pro Woche). Ziehung automatisch sonntags ab 18 Uhr (Serverzeit); Gewinner bekommt den ganzen Topf, gewichtet nach gezahltem Betrag.

### Turniere
- Einsatz 5.000 (einstellbar): Gebühr 1.000 → Staatskonto, Preise 1.600 / 800 / 400, Lostopf 1.200. Der Einsatz liegt ab dem Einreichen in Treuhand.
- Ablauf: `POST /api/tournaments` (→ Status `review`, automatisches Prüf-Ticket, Kategorie „turnier“) → Team `approve` (→ `open`) oder `reject` (Erstattung) → Mitglieder `join`/`leave` → Veranstalter `start`, `PATCH points`, `finish` (Gewinner + Beweis-Link/Beschreibung → `proof`) → anderes Teammitglied `confirm` (Auszahlung; Vier-Augen-Prinzip abschaltbar) oder `deny-proof`.
- Veranstalter darf nicht teilnehmen und nicht Gewinner sein. Nicht vergebene Plätze fließen in den Lostopf. Abbruch/Ablehnung erstattet den Einsatz.
- Endpunkte: `GET /api/tournaments`, `GET /api/tournaments/:id`, Veranstalter: `/start /withdraw /points /finish`; Team (Recht `tournaments.review`): `GET /api/admin/tournaments`, `POST /api/admin/tournaments/:id/{approve,reject,confirm,deny-proof,cancel}`; `PUT /api/admin/tournaments/config` (Recht `settings.edit`).
- Seite: `/turniere/` (Live-Tabelle aktualisiert sich alle 10 s).

### Admin
- Menü-Suche („Menü durchsuchen…“), neue Einträge „Turniere“ und „Wirtschaft“.

### Captcha (geändert)
- `GET /api/captcha` liefert je nach Einstellung `captcha_mode`: `pow` (Standard; Browser löst unsichtbar `sha256(challenge:nonce)` mit 16 führenden Nullbits, Nonce als `captcha` senden), `math` (Textfrage) oder `image` (4 Ziffern). `?fallback=1` erzwingt `math` für Browser ohne Web-Crypto.

## Etappe 10 – Spiele, Bestenliste, Inaktivität

Alle Spiel-Aktionen: Konto nötig, vorher einmalig `POST /api/games/consent {adult:true, no_value:true}`. Antworten enthalten das neue Guthaben (`credits`).

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/games/info` | Konfiguration (Gebühren, Limits, Preise, Auszahlquoten), bei Login `me` mit Guthaben und Restlimits |
| POST | `/api/games/consent` | Zustimmung (ab 18, Credits ohne Geldwert) |
| POST | `/api/games/prefs {hidden}` | aus den Bestenlisten ausblenden |
| POST | `/api/games/slots/spin {bet}` | Slots |
| POST | `/api/games/roulette/spin {bet,type,value}` | Roulette (`color`,`parity`,`half`,`dozen`,`number`) |
| GET | `/api/games/blackjack/current` | offene Runde |
| POST | `/api/games/blackjack/deal {bet}` · `/action {id,action}` | `hit`, `stand`, `double` |
| POST | `/api/games/reaction/start` · `/:id/click` | Server misst die Zeit |
| POST | `/api/games/memory/start` · `/:id/flip {i}` | Kartenlage nur auf dem Server |
| POST | `/api/games/snake/start` · `/:id/finish {turns,ticks}` | Server spielt nach (`public/js/snake-sim.js`) |
| GET | `/api/games/leaderboard?game=all|slots|…&week=cur|prev` | Bestenliste |
| GET | `/api/games/halloffame` | Wochensieger + aktuelle Top 10 |
| GET | `/api/economy/inactivity` | Status Inaktivität/Pause |
| POST | `/api/economy/vacation {action?:"end"}` | Pause starten/beenden |
| GET/PUT | `/api/admin/games` · `/api/admin/inactivity` | Einstellungen (Recht `settings.edit`) |
| POST | `/api/admin/games/settle` · `/api/admin/inactivity/sweep` | Woche abschließen / Gebühr jetzt prüfen |

