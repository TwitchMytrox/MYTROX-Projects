/* turkac.org – Spiele (Blackjack, Slots, Roulette, Reaktionstest, Memory, Snake), Bestenliste, Pause */
(() => {
  'use strict';
  const app = document.getElementById('app');
  const D = (k) => { try { if (window.TDealer) window.TDealer.say(k); } catch { /* egal */ } };
  const S = () => window.TSFX || new Proxy({}, { get: () => () => {} });
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== false && c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  async function api(method, url, body) {
    let r; try { r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); } catch { throw new Error('Keine Verbindung zum Server'); }
    let d = {}; try { d = await r.json(); } catch { /* leer */ }
    if (!r.ok) { const e = new Error(d.error || 'Fehler ' + r.status); e.status = r.status; e.data = d; throw e; }
    return d;
  }
  const n = (x) => Number(x).toLocaleString('de-DE');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let info = null, tab = 'blackjack', stopTimers = [];
  const TABS = [['blackjack', '🃏 Blackjack'], ['slots', '🎰 Slots'], ['roulette', '🎡 Roulette'], ['reaction', '⚡ Reaktion'], ['memory', '🧠 Memory'], ['snake', '🐍 Snake'], ['board', '🏆 Bestenliste'], ['hof', '👑 Hall of Fame'], ['pause', '🏖️ Pause'], ['rules', 'ℹ️ Regeln']];

  const statEls = {};
  const showC = (c) => (info.me && info.me.unlimited ? '∞' : n(c));
  function setCredits(c) { if (c == null) return; info.me.credits = c; if (statEls.credits) statEls.credits.textContent = showC(c); if (ovCredits) ovCredits.textContent = '💰 ' + showC(c); }
  async function refreshStats() { try { info = await api('GET', '/api/games/info'); paintStats(); } catch { /* egal */ } }
  function paintStats() {
    if (!info.me) return;
    const m = info.me;
    if (statEls.credits) { statEls.credits.textContent = showC(m.credits); statEls.loss.textContent = n(m.loss_left); statEls.prize.textContent = n(m.prize_left); statEls.rounds.textContent = n(m.rounds_week) + ' / ' + n(info.min_rounds); }
  }
  const result = (text, kind) => el('div', { class: 'sp-result ' + (kind || ''), role: 'status', 'aria-live': 'polite' }, text || '');
  const setRes = (box, text, kind) => { box.className = 'sp-result ' + (kind || ''); box.textContent = text; };
  const errTxt = (e) => { const m = String(e.message || ''); if ((e.data && e.data.code === 'LOSS_CAP') || /limit/i.test(m)) D('limit'); else if (/fehlen Credits/i.test(m)) D('broke'); return errTxt0(e); };
  const errTxt0 = (e) => (e.data && e.data.code === 'CONSENT' ? 'Bitte bestätige oben zuerst die Spielregeln.' : e.message);

  // ---------- Einsatz-Eingabe ----------
  function betBox(def = 50) {
    const inp = el('input', { type: 'number', id: 'bet' + Math.random().toString(36).slice(2, 6), min: info.bet_min, max: info.bet_max, step: 10, value: def, inputmode: 'numeric' });
    const chk = () => { if (Number(inp.value) >= 250) D('bet_high'); };
    inp.addEventListener('change', chk);
    const chips = [10, 50, 100, info.bet_max].filter((v, i, a) => v <= info.bet_max && a.indexOf(v) === i).map((v) => el('button', { type: 'button', class: 'sp-chip', onclick: () => { inp.value = v; chk(); } }, String(v)));
    return { inp, node: el('div', { class: 'sp-row' }, el('label', { for: inp.id }, `Einsatz (${info.bet_min}–${info.bet_max})`, inp), el('div', { class: 'sp-row', style: 'margin:0', role: 'group', 'aria-label': 'Schnellauswahl' }, chips)), val: () => Math.trunc(Number(inp.value)) };
  }

  // ---------- Effekte & Anzeige (Wette / Gewinn) ----------
  const reduceMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  function countTo(node, to, ms = 900) {
    const from = node._v || 0; node._v = to;
    const fmt = (v) => (v > 0 ? '+' : '') + n(Math.round(v));
    node.classList.toggle('pos', to > 0); node.classList.toggle('neg', to < 0);
    if (reduceMotion() || from === to) { node.textContent = fmt(to); return; }
    const t0 = performance.now();
    const tick = (t) => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); node.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  function hud() {
    const bet = el('b', { class: 'hud-v' }, '–'), win = el('b', { class: 'hud-v hud-win' }, '0'); win._v = 0;
    const node = el('aside', { class: 'sp-hud', 'aria-label': 'Wette und Gewinn' },
      el('div', { class: 'hud-box' }, el('span', {}, 'Wette'), bet),
      el('div', { class: 'hud-box big' }, el('span', {}, 'Gewinn'), win));
    return {
      node, setBet: (t) => { bet.textContent = typeof t === 'number' ? n(t) : t; },
      win: (v, ms) => countTo(win, v, ms),
      reset: () => { win._v = 0; win.textContent = '0'; win.classList.remove('pos', 'neg'); },
    };
  }
  function burst(count = 26, big = false) {
    if (reduceMotion() || !overlay) return;
    const sy = big ? ['💰', '⭐', '🪙', '💎', '🎉'] : ['🪙', '✨', '⭐'];
    const wrap = el('div', { class: 'sp-confetti', 'aria-hidden': 'true' });
    for (let k = 0; k < count; k++) wrap.append(el('span', { style: `left:${Math.random() * 100}%;animation-delay:${(Math.random() * 0.35).toFixed(2)}s;animation-duration:${(1.1 + Math.random() * 0.9).toFixed(2)}s;font-size:${Math.round(18 + Math.random() * 24)}px` }, sy[k % sy.length]));
    overlay.append(wrap); setTimeout(() => wrap.remove(), 2400);
  }
  const CHIPS = [[100, 'c100'], [50, 'c50'], [10, 'c10']];
  function chipStack(amount) {
    const out = []; let left = Math.max(0, Math.trunc(amount) || 0);
    for (const [v, cls] of CHIPS) while (left >= v && out.length < 14) { out.push(cls); left -= v; }
    return el('div', { class: 'chipstack', 'aria-hidden': 'true' }, out.reverse().map((c, i) => el('i', { class: 'chip3d ' + c, style: `--i:${i}` })));
  }
  const stage = (h, ...cols) => el('div', { class: 'sp-stage' }, h.node, el('div', { class: 'sp-col' }, ...cols));

  // ---------- Blackjack ----------
  function cardEl(c, anim, delay) {
    const st = `--r:${(Math.random() * 6 - 3).toFixed(1)}deg;` + (delay ? `animation-delay:${delay}ms` : '');
    if (c === '??') return el('div', { class: 'sp-card back' + (anim ? ' ' + anim : ''), style: st, 'aria-label': 'verdeckte Karte' });
    const red = /[♥♦]/.test(c), rank = c.slice(0, -1), suit = c.slice(-1);
    return el('div', { class: 'sp-card' + (red ? ' red' : '') + (anim ? ' ' + anim : ''), style: st, 'aria-label': c.replace('♠', ' Pik').replace('♥', ' Herz').replace('♦', ' Karo').replace('♣', ' Kreuz') },
      el('span', { class: 'cr' }, rank), el('span', { class: 'cs' }, suit));
  }
  function blackjack() {
    const bet = betBox(50), res = result('Setze deinen Einsatz und teile aus.'), H = hud();
    const dealer = el('div', { class: 'sp-hand', 'aria-label': 'Karten des Gebers' }), player = el('div', { class: 'sp-hand', 'aria-label': 'Deine Karten' });
    const dTot = el('div', { class: 'bj-total', 'aria-live': 'polite' }), pTot = el('div', { class: 'bj-total', 'aria-live': 'polite' });
    const act = el('div', { class: 'btn-row' }), chipsBox = el('div', { class: 'bj-chips' }), shoe = el('div', { class: 'bj-shoe', 'aria-hidden': 'true' });
    let gid = null, busy = false, prevD = [], prevP = [];
    const dealBtn = el('button', { class: 'sbtn big', type: 'button', onclick: deal }, `Austeilen (Gebühr ${info.bj_fee_pct} %, min. ${info.bj_fee_min})`);
    const mk = (label, a) => el('button', { class: 'sbtn big', type: 'button', onclick: () => action(a) }, label);
    const hit = mk('Karte', 'hit'), stand = mk('Halten', 'stand'), dbl = mk('Verdoppeln', 'double');
    const paint = (box, arr, prev) => box.replaceChildren(...arr.map((c, i) => cardEl(c, i >= prev.length ? 'deal' : (prev[i] === '??' && c !== '??' ? 'flipin' : ''), i >= prev.length ? (i - prev.length) * 140 : 0)));
    const tot = (node, who, v, label) => {
      const num = typeof v === 'number' ? v : parseInt(v, 10);
      node.className = 'bj-total' + (num > 21 ? ' bust' : num === 21 ? ' tw' : '');
      node.replaceChildren(...[el('span', { class: 'num' }, String(label == null ? v : label)), num > 21 ? el('small', {}, 'Überkauft') : num === 21 ? el('small', {}, '21!') : null].filter(Boolean));
    };

    function show(g) {
      gid = g.done ? null : g.id;
      paint(dealer, g.dealer, prevD); prevD = g.dealer.slice(); paint(player, g.player, prevP); prevP = g.player.slice();
      tot(dTot, 'Geber', g.dealer_total, g.done ? g.dealer_total : g.dealer_total + ' + ?'); tot(pTot, 'Du', g.player_total);
      H.setBet(g.stake); chipsBox.replaceChildren(chipStack(g.stake));
      [hit, stand, dbl].forEach((b) => { b.hidden = g.done; }); dbl.hidden = g.done || !g.can_double;
      dealBtn.hidden = !g.done; bet.node.hidden = !g.done;
      if (g.done) {
        const t = { blackjack: ['Blackjack! 🎉', 'win'], win: ['Gewonnen! 🎉', 'win'], push: ['Unentschieden – Einsatz zurück.', ''], bust: ['Überkauft – verloren.', 'lose'], lose: ['Verloren.', 'lose'] }[g.outcome];
        setRes(res, `${t[0]} ${g.net >= 0 ? '+' : ''}${n(g.net)} Credits (inkl. Gebühr).`, t[1]); setCredits(g.credits); S()[g.net > 0 ? 'win' : g.net < 0 ? 'lose' : 'ok'](); D({ blackjack: 'bj_blackjack', win: 'bj_win', push: 'bj_push', bust: 'bj_bust', lose: 'bj_lose' }[g.outcome]); refreshStats();
        setTimeout(() => { H.win(g.net); if (g.net > 0) burst(g.outcome === 'blackjack' ? 44 : 26, g.outcome === 'blackjack'); }, 450);
      }
    }
    async function deal() {
      if (busy) return; busy = true;
      try { prevD = []; prevP = []; H.reset(); const d = await api('POST', '/api/games/blackjack/deal', { bet: bet.val() }); S().card(); setTimeout(() => S().card(), 140); show(d.game); setCredits(d.credits); if (!d.game.done) { setRes(res, 'Karte, halten oder verdoppeln?'); D('bj_deal'); } }
      catch (e) { if (e.data && e.data.game) { show(e.data.game); setRes(res, 'Offene Runde fortgesetzt.'); } else setRes(res, errTxt(e), 'lose'); }
      busy = false;
    }
    async function action(a) {
      if (busy || !gid) return; busy = true;
      try { const d = await api('POST', '/api/games/blackjack/action', { id: gid, action: a }); S().card(); show(d.game); if (!d.game.done) { setRes(res, 'Karte oder halten?'); if (Math.random() < 0.5) D('bj_prompt'); } }
      catch (e) { setRes(res, errTxt(e), 'lose'); }
      busy = false;
    }
    [hit, stand, dbl].forEach((b) => { b.hidden = true; });
    api('GET', '/api/games/blackjack/current').then((d) => { if (d.game) { show(d.game); setRes(res, 'Offene Runde fortgesetzt.'); } }).catch(() => {});
    return el('section', { class: 'sp-panel' }, el('h2', {}, 'Blackjack'), el('p', { class: 'muted' }, 'Komm näher an 21 als der Geber, ohne drüber zu gehen. Blackjack zahlt 3:2, Gewinn 1:1. Geber bleibt ab 17 stehen. Die Punkte werden automatisch gezählt.'),
      stage(H, el('div', { class: 'bj-scene' }, el('div', { class: 'bj-felt' }, shoe, chipsBox, el('div', { class: 'bj-seat' }, el('h3', {}, 'Geber'), dealer, dTot), el('div', { class: 'bj-seat' }, el('h3', {}, 'Du'), player, pTot))),
        bet.node, el('div', { class: 'btn-row' }, dealBtn), act, el('div', { class: 'btn-row' }, hit, stand, dbl), res));
  }

  // ---------- Slots (echte 3D-Walzen) ----------
  const FH = 104, FACES = 12, R3 = FH / 2 / Math.tan(Math.PI / FACES);
  function slots() {
    const bet = betBox(20), res = result('Dreh die Walzen!'), H = hud();
    const sy = info.slots.symbols, rots = [0, 0, 0];
    const cyls = [0, 1, 2].map(() => el('div', { class: 'cyl', style: `transform: translateZ(${-R3}px) rotateX(0deg)` }, Array.from({ length: FACES }, (_, k) => el('div', { class: 'face', style: `transform: rotateX(${k * (360 / FACES)}deg) translateZ(${R3}px)` }, sy[k % sy.length]))));
    const reels = cyls.map((c) => el('div', { class: 'sp-reel3d', role: 'img', 'aria-label': 'Walze' }, c));
    const bulbs = el('div', { class: 'cab-bulbs', 'aria-hidden': 'true' }, Array.from({ length: 14 }, (_, k) => el('i', { style: `--k:${k}` })));
    let busy = false;
    const btn = el('button', { class: 'sbtn big', type: 'button', onclick: spin }, 'Drehen');
    async function spin() {
      if (busy) return; busy = true; btn.disabled = true; reels.forEach((r) => r.classList.remove('stop', 'win'));
      let d;
      try { d = await api('POST', '/api/games/slots/spin', { bet: bet.val() }); } catch (e) { setRes(res, errTxt(e), 'lose'); busy = false; btn.disabled = false; return; }
      H.reset(); H.setBet(bet.val());
      D('slots_spin'); setCredits(d.credits - d.won + bet.val()); // Anzeige: Einsatz ist weg, Gewinn kommt gleich
      const fast = reduceMotion(), durs = [1.9, 2.5, 3.1].map((x) => (fast ? 0.15 : x));
      reels.forEach((r, i) => {
        const cand = []; for (let k = 0; k < FACES; k++) if (sy[k % sy.length] === d.reels[i]) cand.push(k);
        const idx = cand[Math.floor(Math.random() * cand.length)] ?? 0, m = Math.ceil((360 * (3 + i) - rots[i] - idx * (360 / FACES)) / 360);
        rots[i] = -(idx * (360 / FACES)) - 360 * m;
        cyls[i].style.transition = `transform ${durs[i]}s cubic-bezier(.15,.7,.15,1)`;
        cyls[i].style.transform = `translateZ(${-R3}px) rotateX(${rots[i]}deg)`;
        r.classList.add('spin');
        setTimeout(() => { r.classList.remove('spin'); r.classList.add('stop'); r.setAttribute('aria-label', 'Walze: ' + d.reels[i]); S().reel(); }, durs[i] * 1000);
      });
      const t0 = performance.now(); while (performance.now() - t0 < durs[2] * 1000) { if (Math.random() < 0.6) S().tick(); await wait(85); }
      await wait(fast ? 0 : 350);
      setCredits(d.credits);
      setRes(res, d.won > 0 ? `Gewinn: ${n(d.won)} Credits (×${d.mult})` : `Leider nichts. −${n(bet.val())} Credits`, d.won > 0 ? 'win' : 'lose');
      d.won > 0 ? (d.mult >= 16 ? S().lvl() : S().win()) : S().lose(); D(d.won > 0 ? (d.mult >= 16 ? 'slots_big' : 'slots_win') : 'slots_lose');
      H.win(d.won - bet.val());
      if (d.won > 0) { reels.forEach((r) => r.classList.add('win')); bulbs.classList.add('flash'); setTimeout(() => bulbs.classList.remove('flash'), 2600); burst(d.mult >= 16 ? 50 : 24, d.mult >= 16); }
      refreshStats(); busy = false; btn.disabled = false;
    }
    const p3 = info.slots.pay3, pay = Object.keys(p3).map((k) => el('span', {}, `${k}${k}${k} ×${p3[k]}`));
    return el('section', { class: 'sp-panel' }, el('h2', {}, 'Slots'), el('p', { class: 'muted' }, `Drei gleiche Symbole gewinnen. Zwei 🍒 zahlen ×${info.slots.pair_cherry}. Auszahlquote ca. ${info.slots.rtp} % – das Haus hat einen kleinen Vorteil.`),
      stage(H, el('div', { class: 'slot-cab' }, bulbs, el('div', { class: 'cab-title', 'aria-hidden': 'true' }, '★ TURKAC ARCADE ★'), el('div', { class: 'sp-reels' }, reels, el('div', { class: 'cab-line', 'aria-hidden': 'true' }))), bet.node, el('div', { class: 'btn-row' }, btn), res, el('div', { class: 'sp-pay' }, pay)));
  }

  // ---------- Roulette ----------
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const REDN = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  function wheelSvg() {
    const ns = 'http://www.w3.org/2000/svg', mk = (t, a) => { const x = document.createElementNS(ns, t); for (const [k, v] of Object.entries(a)) x.setAttribute(k, v); return x; };
    const svg = mk('svg', { viewBox: '-150 -150 300 300', 'aria-hidden': 'true' }), step = (2 * Math.PI) / 37, R = 146, r = 92;
    const pt = (rad, a) => `${(rad * Math.cos(a)).toFixed(2)} ${(rad * Math.sin(a)).toFixed(2)}`;
    WHEEL.forEach((num, i) => {
      const a0 = -Math.PI / 2 + i * step, a1 = a0 + step;
      svg.append(mk('path', { d: `M ${pt(r, a0)} L ${pt(R, a0)} A ${R} ${R} 0 0 1 ${pt(R, a1)} L ${pt(r, a1)} A ${r} ${r} 0 0 0 ${pt(r, a0)} Z`, fill: num === 0 ? '#0b8a3c' : REDN.has(num) ? '#c8102e' : '#15151f', stroke: '#e8c660', 'stroke-width': '1' }));
      const am = (a0 + a1) / 2, tx = mk('text', { x: (120 * Math.cos(am)).toFixed(2), y: (120 * Math.sin(am)).toFixed(2), transform: `rotate(${((am * 180) / Math.PI + 90).toFixed(2)} ${(120 * Math.cos(am)).toFixed(2)} ${(120 * Math.sin(am)).toFixed(2)})`, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#fff', 'font-size': '13', 'font-weight': '700' });
      tx.textContent = String(num); svg.append(tx);
    });
    svg.append(mk('circle', { r: 88, fill: '#0b0b14', stroke: '#e8c660', 'stroke-width': '3' }), mk('circle', { r: 40, fill: '#1c1c2c', stroke: '#e8c660', 'stroke-width': '2' }), mk('circle', { r: 8, fill: '#e8c660' }));
    return svg;
  }
  function roulette() {
    const bet = betBox(20), res = result('Wähle deine Wette und lass die Kugel rollen.'), H = hud();
    let pick = null, rot = 0, orbit = 0;
    const chip = el('div', { class: 'sp-ball green', role: 'img', 'aria-label': 'Ergebnis' }, '?');
    const rotor = el('div', { class: 'rw-rotor' }, wheelSvg()), orb = el('div', { class: 'rw-orbit' }, el('i', { class: 'rw-ball' }));
    const wheel = el('div', { class: 'rw', 'aria-hidden': 'true' }, rotor, orb, el('b', { class: 'rw-pointer' }));
    const btns = [];
    const opt = (label, type, value) => { const b = el('button', { type: 'button', class: 'sp-chip', 'aria-pressed': 'false', onclick: () => { pick = { type, value, label }; btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); numIn.value = ''; } }, label); btns.push(b); return b; };
    const numIn = el('input', { type: 'number', min: 0, max: 36, id: 'rnum', inputmode: 'numeric', 'aria-label': 'Einzelne Zahl 0 bis 36', style: 'width:6rem', oninput: () => { if (numIn.value !== '') { pick = { type: 'number', value: Number(numIn.value), label: 'Zahl ' + numIn.value }; btns.forEach((x) => x.setAttribute('aria-pressed', 'false')); } } });
    let busy = false;
    const btn = el('button', { class: 'sbtn big', type: 'button', onclick: spin }, 'Kugel rollen');
    async function spin() {
      if (busy) return; if (!pick) return setRes(res, 'Bitte zuerst eine Wette wählen.', 'lose');
      busy = true; btn.disabled = true;
      let d; try { d = await api('POST', '/api/games/roulette/spin', { bet: bet.val(), type: pick.type, value: pick.value }); } catch (e) { setRes(res, errTxt(e), 'lose'); busy = false; btn.disabled = false; return; }
      H.reset(); H.setBet(`${n(bet.val())} · ${pick.label}`); chip.className = 'sp-ball green'; chip.textContent = '?'; D('roul_spin');
      const idx = WHEEL.indexOf(d.number), center = (idx + 0.5) * (360 / 37), fast = reduceMotion();
      rot += ((((-center - rot) % 360) + 360) % 360) + 360 * 5; orbit -= 360 * 6;
      const dur = fast ? 0.2 : 4.6;
      rotor.style.transition = `transform ${dur}s cubic-bezier(.1,.6,.1,1)`; orb.style.transition = `transform ${dur}s cubic-bezier(.1,.6,.1,1)`;
      rotor.style.transform = `rotate(${rot}deg)`; orb.style.transform = `rotate(${orbit}deg)`;
      if (fast) await wait(300); else for (let i = 0; i < 22; i++) { S().tick(); await wait(45 + i * i * 1.1); }
      await wait(fast ? 0 : 250);
      chip.textContent = String(d.number); chip.className = 'sp-ball ' + d.color; chip.setAttribute('aria-label', `Kugel: ${d.number} ${d.color === 'red' ? 'rot' : d.color === 'black' ? 'schwarz' : 'grün'}`); S().plop();
      setCredits(d.credits);
      setRes(res, d.won > 0 ? `${d.number} – Gewonnen! +${n(d.net)} Credits` : `${d.number} – leider verloren. −${n(bet.val())} Credits`, d.won > 0 ? 'win' : 'lose');
      H.win(d.net);
      setTimeout(() => { d.won > 0 ? S().win() : S().lose(); D(d.number === 0 ? 'roul_zero' : d.won > 0 ? 'roul_win' : 'roul_lose'); if (d.won > 0) burst(d.net >= 1000 ? 50 : 26, d.net >= 1000); }, 250);
      refreshStats(); busy = false; btn.disabled = false;
    }
    return el('section', { class: 'sp-panel' }, el('h2', {}, 'Roulette'), el('p', { class: 'muted' }, 'Europäisches Roulette mit einer Null (0 verliert bei allen Außenwetten). Rot/Schwarz, Gerade/Ungerade, 1–18/19–36 zahlen 1:1, Dutzend 2:1, Einzelzahl 35:1.'),
      stage(H, el('div', { class: 'rw-layout' }, el('div', { class: 'rw-wrap' }, el('div', { class: 'rw-scene' }, wheel), chip), el('div', { class: 'rw-side' }, el('div', { class: 'sp-grid-bets' },
        el('div', { class: 'grp', role: 'group', 'aria-label': 'Farbe' }, opt('Rot', 'color', 'red'), opt('Schwarz', 'color', 'black')),
        el('div', { class: 'grp', role: 'group', 'aria-label': 'Gerade oder ungerade' }, opt('Gerade', 'parity', 'even'), opt('Ungerade', 'parity', 'odd')),
        el('div', { class: 'grp', role: 'group', 'aria-label': 'Hälfte' }, opt('1–18', 'half', 'low'), opt('19–36', 'half', 'high')),
        el('div', { class: 'grp', role: 'group', 'aria-label': 'Dutzend' }, opt('1. Dutzend (1–12)', 'dozen', 1), opt('2. Dutzend (13–24)', 'dozen', 2), opt('3. Dutzend (25–36)', 'dozen', 3)),
        el('div', { class: 'grp' }, el('label', { for: 'rnum', style: 'margin:0' }, 'Einzelzahl:'), numIn)),
      bet.node, el('div', { class: 'btn-row' }, btn), res))));
  }

  // ---------- Reaktionstest ----------
  function reaction() {
    const res = result(`Eintritt ${info.fee} Credits. Klick, sobald das Feld GRÜN wird. Unter 250 ms: ${info.prizes.reaction[0]} Credits, unter 330 ms: ${info.prizes.reaction[1]}.`);
    const field = el('button', { type: 'button', class: 'sp-react', onclick: onField }, `Start (${info.fee} Credits)`);
    let state = 'idle', id = null, timer = null;
    async function onField() {
      if (state === 'busy') return;
      if (state === 'idle') {
        state = 'busy';
        try {
          const d = await api('POST', '/api/games/reaction/start'); id = d.id; setCredits(d.credits);
          state = 'wait'; field.className = 'sp-react wait'; field.textContent = 'Warte … nicht klicken!'; setRes(res, 'Gleich wird es grün …'); D('react_start');
          timer = setTimeout(() => { state = 'go'; field.className = 'sp-react go'; field.textContent = 'JETZT KLICKEN!'; S().go(); }, d.delay);
        } catch (e) { state = 'idle'; setRes(res, errTxt(e), 'lose'); }
        return;
      }
      clearTimeout(timer); const was = state; state = 'busy';
      try {
        const d = await api('POST', `/api/games/reaction/${id}/click`);
        field.className = 'sp-react'; field.textContent = 'Nochmal? (Start)'; setCredits(d.credits);
        if (d.early || was === 'wait') { setRes(res, 'Zu früh geklickt – Runde verloren.', 'lose'); S().err(); D('react_early'); }
        else if (d.suspicious) { setRes(res, 'Unplausibel schnell – nicht gewertet.', 'lose'); S().err(); }
        else { setRes(res, `${d.ms} ms – ${d.prize > 0 ? `Gewinn ${d.prize} Credits!${d.capped ? ' (Tageslimit für Preise erreicht)' : ''}` : 'kein Preis. Zu langsam!'}`, d.prize > 0 ? 'win' : 'lose'); d.prize > 0 ? S().win() : S().lose(); D(d.prize > 0 ? 'react_win' : 'react_slow'); }
        refreshStats();
      } catch (e) { field.className = 'sp-react'; field.textContent = 'Start'; setRes(res, errTxt(e), 'lose'); }
      state = 'idle';
    }
    const panel = el('section', { class: 'sp-panel' }, el('h2', {}, 'Reaktionstest'), el('p', { class: 'muted' }, 'Der Server misst die Zeit – das Ergebnis lässt sich nicht fälschen.'), field, res);
    panel._cleanup = () => clearTimeout(timer);
    return panel;
  }

  // ---------- Memory ----------
  function memory() {
    const res = result(`Eintritt ${info.fee} Credits. Finde alle 8 Paare: höchstens 12 Züge = ${info.prizes.memory[0]} Credits, höchstens 18 = ${info.prizes.memory[1]}.`);
    const grid = el('div', { class: 'sp-mem', role: 'group', 'aria-label': 'Memory-Karten' });
    const start = el('button', { class: 'sbtn', type: 'button', onclick: begin }, `Neues Spiel (${info.fee} Credits)`);
    const mov = el('p', { class: 'muted' }, 'Züge: 0');
    let id = null, busy = false, first = null, cells = [];
    function reset() { cells = Array.from({ length: 16 }, (_, i) => el('button', { type: 'button', 'aria-label': `Karte ${i + 1}, verdeckt`, onclick: () => flip(i) }, '❓')); grid.replaceChildren(...cells); }
    reset(); cells.forEach((c) => { c.disabled = true; });
    async function begin() {
      try { const d = await api('POST', '/api/games/memory/start'); id = d.id; setCredits(d.credits); } catch (e) { return setRes(res, errTxt(e), 'lose'); }
      reset(); first = null; mov.textContent = 'Züge: 0'; start.disabled = true; setRes(res, 'Los geht’s!'); D('mem_start');
    }
    async function flip(i) {
      if (busy || !id || cells[i].classList.contains('ok') || first === i) return; busy = true;
      try {
        const d = await api('POST', `/api/games/memory/${id}/flip`, { i });
        const show = (idx, sym) => { cells[idx].textContent = sym; cells[idx].classList.add('up'); cells[idx].setAttribute('aria-label', `Karte ${idx + 1}: ${sym}`); };
        show(i, d.symbol); S().card();
        if (d.first == null) first = i;
        else {
          mov.textContent = 'Züge: ' + d.moves; first = null;
          if (d.match) { [d.first, i].forEach((x) => { cells[x].classList.remove('up'); cells[x].classList.add('ok'); cells[x].disabled = true; }); S().ok(); }
          else { await wait(750); [d.first, i].forEach((x) => { cells[x].textContent = '❓'; cells[x].classList.remove('up'); cells[x].setAttribute('aria-label', `Karte ${x + 1}, verdeckt`); }); }
          if (d.done) {
            id = null; start.disabled = false; setCredits(d.credits);
            setRes(res, `Geschafft in ${d.moves} Zügen (${d.seconds} s) – ${d.prize > 0 ? `Gewinn ${d.prize} Credits!${d.capped ? ' (Tageslimit für Preise erreicht)' : ''}` : 'kein Preis, aber gut gespielt.'}`, d.prize > 0 ? 'win' : ''); d.prize > 0 ? S().win() : S().ok(); D(d.prize > 0 ? 'mem_win' : 'mem_nowin'); refreshStats();
          }
        }
      } catch (e) { setRes(res, errTxt(e), 'lose'); }
      busy = false;
    }
    return el('section', { class: 'sp-panel' }, el('h2', {}, 'Memory'), el('p', { class: 'muted' }, 'Die Kartenlage liegt auf dem Server – du siehst nur, was du aufdeckst.'), el('div', { class: 'btn-row' }, start), mov, grid, res);
  }

  // ---------- Snake ----------
  function snake() {
    const res = result(`Eintritt ${info.fee} Credits. Ab 8 Äpfeln: ${info.prizes.snake[1]} Credits, ab 15: ${info.prizes.snake[0]}. Steuerung: Pfeiltasten/WASD oder Pfeil-Knöpfe.`);
    const SIZE = 28, N = window.SnakeSim.N;
    const cv = el('canvas', { class: 'sp-snake', width: N * SIZE, height: N * SIZE, role: 'img', 'aria-label': 'Snake-Spielfeld' });
    const g = cv.getContext('2d');
    const start = el('button', { class: 'sbtn', type: 'button', onclick: begin }, `Start (${info.fee} Credits)`);
    const score = el('p', { class: 'muted', 'aria-live': 'polite' }, 'Äpfel: 0');
    let sim = null, id = null, turns = [], pending = null, loop = null, ticks = 0;
    function draw() {
      g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
      if (!sim) return;
      if (sim.food) { g.fillStyle = '#ff3355'; g.beginPath(); g.arc(sim.food[0] * SIZE + SIZE / 2, sim.food[1] * SIZE + SIZE / 2, SIZE / 2 - 2, 0, 7); g.fill(); }
      sim.body.forEach((p, i) => { g.fillStyle = i === 0 ? '#ffffff' : '#35e0a1'; g.fillRect(p[0] * SIZE + 1, p[1] * SIZE + 1, SIZE - 2, SIZE - 2); });
    }
    const KEYS = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', w: 'U', s: 'D', a: 'L', d: 'R', W: 'U', S: 'D', A: 'L', D: 'R' };
    const dir = (d) => { if (loop) pending = d; };
    const onKey = (e) => { if (loop && KEYS[e.key]) { e.preventDefault(); dir(KEYS[e.key]); } };
    document.addEventListener('keydown', onKey);
    let sx = 0, sy = 0;
    cv.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    cv.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.max(Math.abs(dx), Math.abs(dy)) > 20) dir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U')); }, { passive: true });
    async function begin() {
      let d; try { d = await api('POST', '/api/games/snake/start'); } catch (e) { return setRes(res, errTxt(e), 'lose'); }
      id = d.id; setCredits(d.credits); sim = window.SnakeSim.create(d.seed); turns = []; pending = null; ticks = 0; start.disabled = true; score.textContent = 'Äpfel: 0'; setRes(res, 'Los!'); D('snake_start');
      draw(); loop = setInterval(step, 110);
    }
    function step() {
      ticks++;
      if (pending) { turns.push([ticks, pending]); }
      const before = sim.score; window.SnakeSim.step(sim, pending); pending = null;
      if (sim.score > before) { S().eat(); score.textContent = 'Äpfel: ' + sim.score; }
      draw();
      if (sim.dead) { S().crash(); end(); }
    }
    async function end() {
      clearInterval(loop); loop = null;
      try {
        const d = await api('POST', `/api/games/snake/${id}/finish`, { turns, ticks }); setCredits(d.credits);
        setRes(res, d.suspicious ? 'Unplausibel – nicht gewertet.' : `${d.score} Äpfel – ${d.prize > 0 ? `Gewinn ${d.prize} Credits!${d.capped ? ' (Tageslimit für Preise erreicht)' : ''}` : 'kein Preis. Nochmal?'}`, d.prize > 0 ? 'win' : 'lose'); if (d.prize > 0) S().win(); D(d.prize > 0 ? 'snake_win' : 'snake_lose');
        refreshStats();
      } catch (e) { setRes(res, errTxt(e), 'lose'); }
      start.disabled = false;
    }
    const pad = (cls, label, d) => el('button', { type: 'button', class: cls, 'aria-label': label, onclick: () => dir(d) }, { U: '▲', D: '▼', L: '◀', R: '▶' }[d]);
    draw();
    const panel = el('section', { class: 'sp-panel' }, el('h2', {}, 'Snake'), el('p', { class: 'muted' }, 'Der Server spielt deinen Lauf nach und zählt die Äpfel selbst.'), el('div', { class: 'btn-row' }, start), score, cv,
      el('div', { class: 'sp-pad' }, pad('u', 'Hoch', 'U'), pad('l', 'Links', 'L'), pad('d', 'Runter', 'D'), pad('r', 'Rechts', 'R')), res);
    panel._cleanup = () => { document.removeEventListener('keydown', onKey); if (loop) { clearInterval(loop); loop = null; } };
    return panel;
  }

  // ---------- Bestenliste, Hall of Fame, Pause, Regeln ----------
  async function board() {
    const box = el('div'); let wk = 'cur', game = 'all';
    const sel = el('select', { id: 'spgame', 'aria-label': 'Spiel', onchange: () => { game = sel.value; load(); } }, el('option', { value: 'all' }, 'Gesamt (Platzpunkte)'), ...Object.entries(info.names).map(([k, v]) => el('option', { value: k }, v)));
    const sel2 = el('select', { id: 'spweek', 'aria-label': 'Woche', onchange: () => { wk = sel2.value; load(); } }, el('option', { value: 'cur' }, 'Diese Woche'), el('option', { value: 'prev' }, 'Letzte Woche'));
    async function load() {
      try {
        const d = await api('GET', `/api/games/leaderboard?week=${wk}&game=${game}`);
        const rows = d.rows.length ? d.rows.map((r) => el('tr', {}, el('td', {}, '#' + r.place), el('td', {}, r.username), el('td', { class: 'num' }, n(game === 'all' ? r.points : r.value) + ' ' + d.unit), el('td', { class: 'num' }, n(r.rounds)))) : [el('tr', {}, el('td', { colspan: 4, class: 'muted' }, 'Noch keine Einträge in dieser Woche.'))];
        box.replaceChildren(el('table', { class: 'sp-table' }, el('caption', { class: 'muted' }, `Woche ${d.week}${game === 'all' ? ` · gewertet wird ab ${d.min_rounds} gespielten Runden` : ''}`), el('thead', {}, el('tr', {}, el('th', {}, 'Platz'), el('th', {}, 'Name'), el('th', { class: 'num' }, 'Wertung'), el('th', { class: 'num' }, 'Runden'))), el('tbody', {}, rows)));
      } catch (e) { box.replaceChildren(el('p', { class: 'alert err' }, e.message)); }
    }
    await load();
    const hid = info.me && el('label', { style: 'display:flex;gap:10px;align-items:center;font-weight:600' }, el('input', { type: 'checkbox', checked: info.me.hidden, onchange: async (e) => { try { await api('POST', '/api/games/prefs', { hidden: e.target.checked }); info.me.hidden = e.target.checked; } catch (er) { alert(er.message); } } }), 'Mich in den Bestenlisten ausblenden');
    return el('section', { class: 'sp-panel' }, el('h2', {}, 'Bestenliste'), el('p', { class: 'muted' }, `Wöchentlich neu. Glücksspiele zählen den Wochengewinn, Geschicklichkeitsspiele die beste Leistung. Die Top 10 der Gesamtwertung bekommen den Rang „🏆 Top 10“ und einen kleinen Bonus (Platz 1: ${info.bonus[0]} Credits).`),
      el('div', { class: 'sp-row' }, el('label', { for: 'spgame' }, 'Spiel', sel), el('label', { for: 'spweek' }, 'Woche', sel2)), box, hid);
  }
  async function hof() {
    let d; try { d = await api('GET', '/api/games/halloffame'); } catch (e) { return el('p', { class: 'alert err' }, e.message); }
    return el('section', { class: 'sp-panel' }, el('h2', {}, 'Hall of Fame'), el('p', { class: 'muted' }, 'Die Wochensieger bleiben für immer hier stehen.'),
      el('h3', {}, 'Aktuelle Top 10' + (d.top10_week ? ` (Woche ${d.top10_week})` : '')),
      d.top10.length ? el('ol', {}, d.top10.map((r) => el('li', {}, `${r.username} – Platz ${r.place}`))) : el('p', { class: 'muted' }, 'Noch keine Wertung abgeschlossen.'),
      el('h3', {}, 'Wochensieger'), d.champions.length ? el('ul', {}, d.champions.map((c) => el('li', {}, `${c.week}: 👑 ${c.username}`))) : el('p', { class: 'muted' }, 'Noch keine Wochensieger.'));
  }
  async function pause() {
    let d; try { d = await api('GET', '/api/economy/inactivity'); } catch (e) { return el('p', { class: 'alert err' }, e.message); }
    const fmtD = (t) => new Date(t).toLocaleDateString('de-DE');
    const box = el('section', { class: 'sp-panel' }, el('h2', {}, 'Inaktivität & Pause'));
    const r = d.rule;
    box.append(el('p', { class: 'muted' }, `Wer ${r.days} Tage nicht online ist und nichts schreibt, zahlt ${r.pct} % seines Kontostands ans Staatskonto – nach ${r.days * 2} Tagen ${r.pct * 2} %, danach ${r.pct * 3} % und so weiter (höchstens ${r.cap} % je Stufe). Jede Anmeldung setzt die Zählung zurück. Teammitglieder sind ausgenommen.`));
    if (d.exempt) box.append(el('p', {}, 'Du bist Teammitglied: für dich gilt die Gebühr nicht.'));
    else {
      box.append(el('p', {}, d.on_vacation ? `🏖️ Pause aktiv bis ${fmtD(d.vacation_until)} – keine Gebühr.` : `Inaktiv seit ${d.inactive_days} Tag(en). Nächster Abzug in ${d.next_deduction_in_days} Tag(en): ${d.next_percent} %.`));
      if (d.grace_until) box.append(el('p', { class: 'muted' }, `Schonfrist bis ${fmtD(d.grace_until)}.`));
      if (d.on_vacation) box.append(el('div', { class: 'btn-row' }, el('button', { class: 'sbtn', type: 'button', onclick: async () => { await api('POST', '/api/economy/vacation', { action: 'end' }); pauseRender(); } }, 'Pause beenden')));
      else if (d.can_start_vacation) box.append(el('p', { class: 'muted' }, `Du kannst bis zu ${r.vac_days} Tage pausieren. Danach gibt es ${r.days} Tage Schonfrist, und die nächste Pause ist erst nach ${r.cooldown_days} Tagen möglich.`), el('div', { class: 'btn-row' }, el('button', { class: 'sbtn', type: 'button', onclick: async () => { if (!confirm(`Pause für ${r.vac_days} Tage starten?`)) return; try { await api('POST', '/api/economy/vacation', {}); pauseRender(); } catch (e) { alert(e.message); } } }, `Pause starten (${r.vac_days} Tage)`)));
      else box.append(el('p', { class: 'muted' }, `Die nächste Pause ist ab ${fmtD(d.vacation_available_at)} möglich.`));
    }
    return box;
  }
  function rules() {
    return el('section', { class: 'sp-panel sp-rules' }, el('h2', {}, 'Regeln & Hinweise'),
      el('div', { class: 'sp-warn' }, el('strong', {}, 'Wichtig: '), 'Credits sind reine Spielwährung. Sie haben keinen Geldwert, können nicht gekauft und nicht ausgezahlt werden. Einlösen kann man sie nur gegen Extras im Forum. Die Spiele sind ab 18.'),
      el('ul', {}, el('li', {}, `Geschicklichkeitsspiele (Reaktion, Memory, Snake): ${info.fee} Credits Eintritt ans Staatskonto, bei gutem Ergebnis ein Preis aus dem Staatskonto. Preise gibt es höchstens ${n(info.prize_cap)} Credits pro 24 Stunden.`),
        el('li', {}, `Blackjack: Einsatz ${info.bet_min}–${info.bet_max}, Gebühr ${info.bj_fee_pct} % (mindestens ${info.bj_fee_min}). Slots und Roulette: Einsatz ${info.bet_min}–${info.bet_max}, das Haus hat einen kleinen Vorteil (Slots ca. ${info.slots.rtp} %, Roulette ${info.roulette.rtp} % Auszahlquote).`),
        el('li', {}, `Verlustlimit: höchstens ${n(info.loss_cap)} Credits Netto-Verlust in 24 Stunden bei Glücksspielen.`),
        el('li', {}, 'Alles wird auf dem Server gewürfelt, gemischt und nachgerechnet. Cheaten bringt nichts.'),
        el('li', {}, `Top-10-Rang: gewertet wird ab ${info.min_rounds} Runden pro Woche. Wochenbonus nach Platz (insgesamt höchstens ${n(info.bonus_cap)} Credits pro Woche).`)),
      el('p', {}, 'Spielen soll Spaß machen. Wenn es dir nicht mehr guttut: Pause einlegen oder Hilfe holen – kostenlose, anonyme Beratung der BZgA zur Glücksspielsucht: 0800 1 37 27 00.'));
  }

  // ---------- Rahmen: Menü (Lobby) + eigene Spiel-Ansicht ----------
  const PANELS = { blackjack, slots, roulette, reaction, memory, snake, board, hof, pause, rules };
  const TITLES = Object.fromEntries(TABS);
  let panelHost = null, overlay = null, ovTitle = null, ovCredits = null, opener = null;
  function closeGame() {
    if (!overlay || overlay.hidden) return;
    if (panelHost && panelHost.firstChild && panelHost.firstChild._cleanup) panelHost.firstChild._cleanup();
    stopTimers.forEach(clearTimeout);
    panelHost.replaceChildren(); overlay.hidden = true; document.body.classList.remove('sp-open');
    history.replaceState(null, '', location.pathname);
    if (opener && opener.isConnected) opener.focus();
    if (window.TDealer) window.TDealer.stop();
  }
  async function showTab(t, from) {
    tab = t; if (from) opener = from;
    stopTimers.forEach(clearTimeout);
    if (panelHost.firstChild && panelHost.firstChild._cleanup) panelHost.firstChild._cleanup();
    ovTitle.textContent = TITLES[t]; overlay.setAttribute('aria-label', TITLES[t].replace(/^\S+\s/, ''));
    if (ovCredits && info.me) ovCredits.textContent = '💰 ' + showC(info.me.credits);
    overlay.hidden = false; document.body.classList.add('sp-open');
    panelHost.replaceChildren(el('p', { class: 'muted' }, 'Lade …'));
    const node = await PANELS[t]();
    panelHost.replaceChildren(node); panelHost.scrollTop = 0;
    history.replaceState(null, '', '#' + t);
    overlay.querySelector('.sp-back').focus();
  }
  const pauseRender = () => showTab('pause');
  function buildOverlay() {
    ovTitle = el('h2', { class: 'sp-ov-title' }, '');
    ovCredits = el('span', { class: 'sp-ov-cr', 'aria-hidden': 'true' }, '');
    panelHost = el('div', { class: 'sp-ov-body' });
    overlay = el('div', { class: 'sp-overlay', role: 'dialog', 'aria-modal': 'true', hidden: true },
      el('div', { class: 'sp-ov-bar' }, el('button', { type: 'button', class: 'sbtn sp-back', onclick: closeGame }, '← Zurück zum Menü'), ovTitle, ovCredits), panelHost);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay && !overlay.hidden) closeGame(); });
    (document.getElementById('main') || document.body).append(overlay);
  }
  function fitPage() {
    const h = document.getElementById('siteHeader'); document.documentElement.style.setProperty('--sp-hdr', (h ? h.offsetHeight : 64) + 'px');
  }
  window.addEventListener('resize', fitPage);

  function consentCard() {
    const a = el('input', { type: 'checkbox', id: 'c18' }), b = el('input', { type: 'checkbox', id: 'cv' });
    const msg = el('p', { role: 'alert' });
    return el('section', { class: 'sp-panel sp-warn' }, el('h2', {}, 'Bevor du spielst'),
      el('p', {}, 'Die Spiele nutzen Credits als reine Spielwährung. Bitte bestätige beides:'),
      el('label', { for: 'c18', style: 'display:flex;gap:10px;align-items:flex-start;font-weight:600' }, a, 'Ich bin mindestens 18 Jahre alt.'),
      el('label', { for: 'cv', style: 'display:flex;gap:10px;align-items:flex-start;font-weight:600' }, b, 'Ich weiß, dass Credits keinen Geldwert haben und nicht gekauft oder ausgezahlt werden können.'),
      msg, el('div', { class: 'btn-row' }, el('button', { class: 'sbtn', type: 'button', onclick: async () => {
        try { await api('POST', '/api/games/consent', { adult: a.checked, no_value: b.checked }); info.me.consent = true; render(); } catch (e) { msg.textContent = e.message; }
      } }, 'Bestätigen und loslegen')));
  }

  async function render() {
    document.body.classList.add('sp-page'); fitPage(); setTimeout(fitPage, 400);
    try { info = await api('GET', '/api/games/info'); } catch (e) { app.replaceChildren(el('p', { class: 'alert err' }, e.message)); return; }
    if (!overlay) buildOverlay(); else closeGame();
    const h1 = el('h1', { tabindex: -1 }, '🎮 Turkac Arcade');
    const guestTabs = ['board', 'hof', 'rules'];
    const tiles = (list) => el('div', { class: 'sp-menu', role: 'group', 'aria-label': 'Spiele und Bereiche' }, list.map((k) => { const [icon, ...rest] = TITLES[k].split(' '); return el('button', { type: 'button', class: 'sp-tile', 'data-tab': k, onclick: (e) => showTab(k, e.currentTarget) }, el('span', { class: 'sp-ti', 'aria-hidden': 'true' }, icon), el('span', { class: 'sp-tn' }, rest.join(' '))); }));
    if (!info.me) {
      app.replaceChildren(el('section', { class: 'sp-lobby' }, h1, el('p', { class: 'lead' }, 'Zum Spielen brauchst du ein (anonymes) Konto.'), el('div', { class: 'btn-row' }, el('a', { class: 'btn', href: '/auth/' }, 'Anmelden / Registrieren')), tiles(guestTabs)));
      const w = location.hash.slice(1); if (guestTabs.includes(w)) await showTab(w);
      return;
    }
    const m = info.me;
    const stat = (key, label, val) => { const b = el('b', {}, val); statEls[key] = b; return el('div', { class: 'sp-stat' }, b, el('span', {}, label)); };
    const top = el('div', { class: 'sp-top' }, stat('credits', m.unlimited ? 'Credits (Team: unbegrenzt)' : 'Deine Credits', showC(m.credits)), stat('loss', 'Verlust-Limit heute übrig', n(m.loss_left)), stat('prize', 'Preise heute noch möglich', n(m.prize_left)), stat('rounds', 'Runden diese Woche', n(m.rounds_week) + ' / ' + n(info.min_rounds)));
    const dealerBtn = window.TDealer ? window.TDealer.toggleBtn() : null;
    const broke = !m.unlimited && m.credits < info.bet_min ? el('div', { class: 'sp-warn', role: 'status' }, el('strong', {}, 'Du hast noch keine Credits zum Spielen. '), 'Credits verdienst du im Forum (Beiträge, Antworten, Aktivität). Ab ' + info.bet_min + ' kannst du hier loslegen. ', el('a', { href: '/forum' }, 'Zum Forum')) : null;
    app.replaceChildren(el('section', { class: 'sp-lobby' }, h1, top, dealerBtn && el('div', { class: 'btn-row' }, dealerBtn), broke, m.consent ? null : consentCard(), tiles(TABS.map((t) => t[0]))));
    const want = location.hash.slice(1);
    if (PANELS[want]) await showTab(want);
  }
  render();
})();
