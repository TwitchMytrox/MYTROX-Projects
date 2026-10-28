# turkac.org – anonymes Gaming-Forum

Keine externen Abhängigkeiten, nur Node.js >= 22.13 (SQLite ist eingebaut).

## Starten
    node server.js          # oder: npm start
    PORT=8080 node server.js

- Forum:  http://localhost:3000
- Admin:  http://localhost:3000/admin/
- Beim ERSTEN Start wird ein Admin-Passwort in der Konsole angezeigt. Danach im Admin unter "Team & Sicherheit" ändern.

## Features
- Anonyme Threads & Kommentare (kein Account, anonyme ID pro Nutzer), Kategorien, Suche, Sortierung
- Uploads: Bilder, Videos (mit Streaming), Dateien; Reaktionen, Greentext, Spoiler, Code
- Neon-Gaming-Design mit Animationen, Partikel-Hintergrund, Level-System, Sounds
- Alles in SQLite: data/ (Datenbank), uploads/ (Dateien)
- Admin: Dashboard, Threads/Kommentare moderieren (pinnen, sperren, löschen), Meldungen,
  Medien, IP-Sperren, Wortfilter, Kategorien, Einstellungen, Admin-Team, Audit-Log, DB-Backup-Download
- Support: Mitglieder erstellen Tickets unter /support/ (Kategorie, Text), verwalten sie selbst (zurückziehen/schließen); das Team bearbeitet sie im Admin-Bereich (antworten, interne Notizen, schließen, weiterleiten)
- Blog & Werbung unter /blog (getrennt vom Forum, nur für Team mit Recht „blog.manage“; Werbung wird als Anzeige gekennzeichnet)
- Credits mit fester Gesamtmenge (Staatskonto), Tageslimit, Turniere mit Prüfung durch das Team und Wochen-Lostopf (/turniere/)
- Zwei-Faktor ist freiwillig (Pflicht für Team optional einschaltbar)
- Schutz: Rate-Limits, Slowmode, Dateityp-Prüfung, gehashte IPs, sichere Upload-Auslieferung

## Online stellen
Auf einem Server mit Node 22 starten (z. B. hinter nginx/Caddy mit HTTPS). Ordner data/ und uploads/ regelmäßig sichern.

## Spiele (Etappe 10)
Unter `/spiele/`: Blackjack, Slots, Roulette (Glücksspiel mit Spielwährung), Reaktionstest, Memory, Snake (Geschicklichkeit), Bestenliste (pro Woche), Hall of Fame und Top-10-Rang mit Wochenbonus.
Credits haben keinen Geldwert. Alles wird serverseitig gewürfelt/nachgerechnet, Einsätze und Gebühren fließen ans Staatskonto, Preise kommen daraus. Alle Zahlen (Gebühren, Limits, Preise, Bonus) stehen im Admin unter **Spiele**.
Inaktivitätsgebühr (Stufen alle 5 Tage, 2 % · Stufe) und Urlaubs-Pause (60 Tage, danach 5 Tage Schonfrist, 90 Tage Sperrfrist) laufen in `lib/inactivity.js`.


## Croupier-Stimme (optional)
Sprüche stehen in `public/audio/dealer/lines.json`. Mit `Croupier-Stimme.bat` (Windows) bzw. `node tools/make-dealer-voice.js` werden daraus MP3s über ElevenLabs erzeugt; der Schlüssel liegt in `elevenlabs.key` (nicht ins Repository, nicht auf den Server). Ohne MP3s zeigt der Croupier nur Untertitel. Schalter „Croupier an/aus“ auf der Spiele-Seite.
