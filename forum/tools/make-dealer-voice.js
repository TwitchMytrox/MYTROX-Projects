#!/usr/bin/env node
/* turkac.org – Croupier-Stimme erzeugen (ElevenLabs).
   Liest den Schlüssel aus der Datei elevenlabs.key (neben package.json) oder aus ELEVENLABS_API_KEY,
   erzeugt für jede Zeile aus public/audio/dealer/lines.json eine MP3 (<schluessel>-<nr>.mp3).
   Bereits vorhandene Dateien werden übersprungen. Der Schlüssel verlässt deinen PC nur Richtung ElevenLabs.

   Aufruf:
     node tools/make-dealer-voice.js --list                 Stimmen anzeigen
     node tools/make-dealer-voice.js --voice <ID oder Name> Alle fehlenden Zeilen erzeugen
     node tools/make-dealer-voice.js --only welcome,bj_win  Nur diese Schlüssel
     node tools/make-dealer-voice.js --force                Vorhandene Dateien neu erzeugen
     node tools/make-dealer-voice.js --dry                  Nur zählen (Zeichen), nichts erzeugen */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'public', 'audio', 'dealer');
const API = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb'; // „George“ (warm, sonor) – mit --voice änderbar

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf('--' + name); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };

function readKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  try { return fs.readFileSync(path.join(ROOT, 'elevenlabs.key'), 'utf8').trim(); } catch { return ''; }
}
const KEY = readKey();
if (!KEY) { console.error('Kein Schlüssel gefunden. Lege elevenlabs.key in den Projektordner.'); process.exit(1); }
const H = { 'xi-api-key': KEY };

async function listVoices() {
  const r = await fetch(API + '/voices', { headers: H });
  if (!r.ok) throw new Error('Stimmenliste: HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return (await r.json()).voices || [];
}
async function resolveVoice(v) {
  if (!v || v === true) return DEFAULT_VOICE;
  if (/^[A-Za-z0-9]{20}$/.test(v)) return v;
  const hit = (await listVoices()).find((x) => x.name.toLowerCase().startsWith(String(v).toLowerCase()));
  if (!hit) throw new Error('Stimme nicht gefunden: ' + v + ' (mit --list ansehen)');
  return hit.voice_id;
}
async function tts(voice, text) {
  const r = await fetch(`${API}/text-to-speech/${voice}?output_format=mp3_44100_96`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', language_code: 'de', voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true } }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return Buffer.from(await r.arrayBuffer());
}

function writeIndex() {
  const idx = {};
  for (const f of fs.readdirSync(DIR)) if (f.endsWith('.mp3')) idx[f.slice(0, -4)] = true;
  fs.writeFileSync(path.join(DIR, 'files.json'), JSON.stringify(idx));
  console.log('files.json: ' + Object.keys(idx).length + ' Dateien eingetragen.');
}

(async () => {
  if (opt('list')) {
    for (const v of await listVoices()) console.log(v.voice_id + '  ' + v.name + (v.labels && v.labels.gender ? '  (' + v.labels.gender + ')' : ''));
    return;
  }
  const lines = JSON.parse(fs.readFileSync(path.join(DIR, 'lines.json'), 'utf8'));
  const only = opt('only') && opt('only') !== true ? String(opt('only')).split(',') : null;
  const jobs = [];
  for (const [k, arr] of Object.entries(lines)) {
    if (only && !only.includes(k)) continue;
    arr.forEach((t, i) => { const f = path.join(DIR, `${k}-${i + 1}.mp3`); if (opt('force') || !fs.existsSync(f)) jobs.push({ f, t, name: `${k}-${i + 1}` }); });
  }
  const chars = jobs.reduce((s, j) => s + j.t.length, 0);
  console.log(`${jobs.length} Dateien, ${chars} Zeichen.`);
  if (opt('dry')) return;
  if (!jobs.length) { writeIndex(); return; }
  const voice = await resolveVoice(opt('voice'));
  let ok = 0;
  for (const j of jobs) {
    try { fs.writeFileSync(j.f, await tts(voice, j.t)); ok++; console.log('ok   ' + j.name); }
    catch (e) { console.error('FEHL ' + j.name + ': ' + e.message); if (/HTTP (401|402|403|429)/.test(e.message)) { console.error('Abbruch (Schlüssel/Guthaben/Limit).'); break; } }
  }
  console.log(`Fertig: ${ok}/${jobs.length}.`);
  writeIndex();
})().catch((e) => { console.error(e.message); process.exit(1); });
