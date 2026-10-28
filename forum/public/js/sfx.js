/* turkac.org – Gaming-Sounds (kurze Effekte, KEINE Hintergrundmusik).
   Alles wird live per Web Audio erzeugt: keine Dateien, kein Tracking.
   Standard: an, leise. Schalter unten links (🔊/🔇) bzw. im Forum-Kopf. Merkt sich die Wahl (nx_sound). */
(() => {
  'use strict';
  const KEY = 'nx_sound';
  const get = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const put = (v) => { try { localStorage.setItem(KEY, v); } catch { /* egal */ } };
  let on = get() !== '0';
  let ctx = null, master = null, lastClick = 0, lastHover = 0;

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.22;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // Ein Ton: Wellenform, Start-/Endfrequenz, Dauer, Lautstärke, Verzögerung
  function tone(type, f0, f1, dur, vol = 0.5, delay = 0) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const play = (fn) => { if (on) { try { fn(); } catch { /* Audio nicht verfügbar */ } } };

  const S = {
    click: () => play(() => { const n = performance.now(); if (n - lastClick < 90) return; lastClick = n; tone('square', 880, 520, 0.05, 0.28); tone('sine', 1760, 1200, 0.03, 0.12); }),
    hover: () => play(() => { const n = performance.now(); if (n - lastHover < 70) return; lastHover = n; tone('sine', 1500, 1700, 0.025, 0.05); }),
    ok:    () => play(() => { tone('triangle', 988, 988, 0.08, 0.4); tone('triangle', 1319, 1319, 0.14, 0.4, 0.07); }),
    err:   () => play(() => { tone('sawtooth', 220, 110, 0.22, 0.35); tone('square', 150, 90, 0.2, 0.2, 0.05); }),
    open:  () => play(() => tone('sine', 320, 900, 0.12, 0.3)),
    close: () => play(() => tone('sine', 800, 300, 0.1, 0.25)),
    coin:  () => play(() => { tone('square', 1568, 1568, 0.06, 0.25); tone('square', 2093, 2093, 0.2, 0.25, 0.06); }),
    // Spiele
    card:  () => play(() => { tone('square', 260, 110, 0.05, 0.22); tone('sine', 1900, 900, 0.03, 0.08); }),
    tick:  () => play(() => tone('square', 900, 700, 0.02, 0.16)),
    reel:  () => play(() => { tone('triangle', 330, 330, 0.07, 0.34); tone('sine', 660, 660, 0.05, 0.14); }),
    plop:  () => play(() => tone('sine', 700, 180, 0.12, 0.45)),
    eat:   () => play(() => tone('square', 620, 1040, 0.06, 0.24)),
    crash: () => play(() => { tone('sawtooth', 240, 40, 0.45, 0.4); tone('square', 120, 40, 0.4, 0.2, 0.05); }),
    go:    () => play(() => tone('triangle', 880, 880, 0.16, 0.45)),
    win:   () => play(() => { [659, 784, 988, 1319].forEach((f, i) => tone('triangle', f, f, 0.12, 0.36, i * 0.07)); }),
    lose:  () => play(() => { tone('sawtooth', 300, 140, 0.3, 0.28); tone('sawtooth', 220, 100, 0.35, 0.22, 0.12); }),
    lvl:   () => play(() => { [523, 659, 784, 1046, 1318].forEach((f, i) => tone('triangle', f, f, 0.16, 0.38, i * 0.085)); tone('sine', 2637, 2637, 0.4, 0.12, 0.45); }),
  };

  function paint() {
    document.querySelectorAll('#soundBtn,.sfx-toggle').forEach((b) => {
      b.textContent = on ? '🔊' : '🔇';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('title', on ? 'Sound ausschalten' : 'Sound einschalten');
      b.setAttribute('aria-label', on ? 'Sound ist an – ausschalten' : 'Sound ist aus – einschalten');
    });
  }
  function setOn(v) { on = !!v; put(on ? '1' : '0'); paint(); if (on) S.ok(); }

  window.TSFX = Object.assign({ get enabled() { return on; }, set: setOn }, S);

  const SEL = 'button,a[href],[role="button"],[role="tab"],summary,input[type="checkbox"],input[type="radio"],select,label.chip,.chip,.btn';
  const target = (e) => (e.target && e.target.closest ? e.target.closest(SEL) : null);
  const mute = (el) => el.closest('[data-nosfx]') || el.id === 'soundBtn' || el.classList.contains('sfx-toggle');

  document.addEventListener('pointerdown', (e) => {
    const t = target(e); if (!t || mute(t) || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    S.click();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = target(e); if (!t || mute(t) || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== 'checkbox' && t.type !== 'radio') return;
    S.click();
  }, true);
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.addEventListener('pointerover', (e) => {
      const t = target(e); if (!t || mute(t) || t.contains(e.relatedTarget)) return;
      if (t.matches('button,a[href],[role="button"],.btn,.chip')) S.hover();
    }, true);
  }
  // Fehler-/Erfolgs-Hinweise (Toasts) automatisch vertonen
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) {
      if (!(n instanceof HTMLElement)) continue;
      if (n.matches('.alert.err,.msg.err,.error[role="alert"]')) S.err();
      else if (n.matches('.modal-back,[role="dialog"]')) S.open();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  function mount() {
    let b = document.getElementById('soundBtn');
    if (b) { b.classList.add('sfx-bound'); b.addEventListener('click', (e) => { e.stopImmediatePropagation(); setOn(!on); }, true); }
    else {
      b = document.createElement('button');
      b.type = 'button'; b.className = 'sfx-toggle';
      b.addEventListener('click', () => setOn(!on));
      document.body.appendChild(b);
    }
    paint();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
