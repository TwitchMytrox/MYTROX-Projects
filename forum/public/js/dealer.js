/* turkac.org – Croupier: kurze Sprüche mit Untertitel, optional mit Stimme (MP3 aus /audio/dealer/).
   Fehlen die MP3-Dateien, erscheint nur der Untertitel. Ein-/Ausschalter, Wahl wird gemerkt (nx_dealer). */
(() => {
  'use strict';
  const KEY = 'nx_dealer';
  const get = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const put = (v) => { try { localStorage.setItem(KEY, v); } catch { /* egal */ } };
  let on = get() !== '0', lines = null, files = {}, loading = null, cur = null, hideT = null;
  const last = {};
  const bubble = document.createElement('div');
  bubble.className = 'dealer-bubble'; bubble.setAttribute('aria-hidden', 'true'); bubble.hidden = true;
  const load = () => loading || (loading = fetch('/audio/dealer/lines.json').then((r) => (r.ok ? r.json() : {})).then((j) => { lines = j; }).catch(() => { lines = {}; }).then(() => fetch('/audio/dealer/files.json').then((r) => (r.ok ? r.json() : {})).then((f) => { files = f || {}; }).catch(() => { files = {}; })));

  async function say(key) {
    if (!on) return;
    await load();
    const arr = lines && lines[key]; if (!arr || !arr.length) return;
    let i = Math.floor(Math.random() * arr.length);
    if (arr.length > 1 && i === last[key]) i = (i + 1) % arr.length;
    last[key] = i;
    stop();
    if (!bubble.isConnected) document.body.append(bubble);
    bubble.textContent = '🎩 ' + arr[i]; bubble.hidden = false;
    clearTimeout(hideT); hideT = setTimeout(() => { bubble.hidden = true; }, Math.max(4500, arr[i].length * 75));
    if (!files[`${key}-${i + 1}`]) return;
    try {
      const a = new Audio(`/audio/dealer/${key}-${i + 1}.mp3`); a.volume = 0.9; cur = a;
      a.addEventListener('error', () => { if (cur === a) cur = null; });
      a.play().catch(() => { /* Datei fehlt oder Autoplay gesperrt – Untertitel genügt */ });
    } catch { /* kein Audio */ }
  }
  function stop() { if (cur) { try { cur.pause(); } catch { /* egal */ } cur = null; } }
  function paint() { document.querySelectorAll('.dealer-toggle').forEach((b) => { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '🎩 Croupier: an' : '🎩 Croupier: aus'; }); }
  function set(v) { on = !!v; put(on ? '1' : '0'); if (!on) { stop(); bubble.hidden = true; } paint(); }
  function toggleBtn() {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sbtn dealer-toggle';
    b.addEventListener('click', () => { set(!on); if (on) say('welcome'); });
    setTimeout(paint, 0); return b;
  }
  window.TDealer = { say, stop, set, toggleBtn, get on() { return on; } };
})();
