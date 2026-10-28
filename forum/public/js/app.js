/* turkac.org – Frontend (Vanilla JS, ohne Abhängigkeiten) */
(() => {
  'use strict';

  // ======================================================================
  // Helfer
  // ======================================================================
  const $ = (s, r = document) => r.querySelector(s);
  const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'hidden', 'textContent']);

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'vars') for (const [vk, vv] of Object.entries(v)) n.style.setProperty(vk, vv);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (PROP_KEYS.has(k)) n[k] = v;
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    append(n, kids);
    return n;
  }
  function append(parent, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      parent.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
  }

  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignorieren */ } },
  };

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {} };
    if (opts.json) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.json); }
    let res;
    try { res = await fetch(path, init); } catch { throw new Error('Keine Verbindung zum Server'); }
    let data = {};
    try { data = await res.json(); } catch { /* leer */ }
    if (!res.ok) {
      if (res.status === 503 && data.maintenance) { location.reload(); }
      throw Object.assign(new Error(data.error || `Fehler ${res.status}`), { code: data.code, status: res.status });
    }
    return data;
  }

  function upload(url, fd, onProgress, method) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open(method || 'POST', url);
      x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = () => {
        let d = {};
        try { d = JSON.parse(x.responseText); } catch { /* leer */ }
        x.status >= 200 && x.status < 300 ? resolve(d) : reject(Object.assign(new Error(d.error || `Fehler ${x.status}`), { code: d.code, status: x.status }));
      };
      x.onerror = () => reject(new Error('Netzwerkfehler beim Upload'));
      x.send(fd);
    });
  }

  function ago(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return 'gerade eben';
    const m = Math.floor(s / 60);
    if (m < 60) return `vor ${m} Min.`;
    const h = Math.floor(m / 60);
    if (h < 24) return `vor ${h} Std.`;
    const d = Math.floor(h / 24);
    if (d < 30) return `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
    return new Date(ts).toLocaleDateString('de-DE');
  }
  const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);
  const fileIcon = (n) => ({ zip: '🗜️', '7z': '🗜️', pdf: '📕', txt: '📄' }[n.split('.').pop().toLowerCase()] || '📦');
  const extOf = (n) => '.' + n.split('.').pop().toLowerCase();
  const plain = (s) => String(s).replace(/\*\*|`|\|\|/g, '').replace(/^>+\s?/gm, '');
  const countLabel = (n) => `${n} ${n === 1 ? 'Kommentar' : 'Kommentare'}`;

  // ======================================================================
  // Sound (WebAudio, optional)
  // ======================================================================
  let soundOn = store.get('nx_sound') !== '0';
  let audio = null;
  function beep(freq, dur = 0.08, type = 'square', vol = 0.035) {
    if (!soundOn) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = vol;
      o.connect(g); g.connect(audio.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
      o.stop(audio.currentTime + dur);
    } catch { /* Audio nicht verfügbar */ }
  }
  const setSound = (on) => { soundOn = !!on; store.set('nx_sound', on ? '1' : '0'); const b = document.getElementById('soundBtn'); if (b) b.textContent = soundOn ? '🔊' : '🔇'; };
  const sfx = {
    click: () => (window.TSFX ? TSFX.click() : beep(520, 0.05)),
    ok: () => (window.TSFX ? TSFX.ok() : (beep(660, 0.07), setTimeout(() => beep(990, 0.1), 70))),
    err: () => (window.TSFX ? TSFX.err() : beep(170, 0.22, 'sawtooth')),
    lvl: () => (window.TSFX ? TSFX.lvl() : [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => beep(f, 0.13), i * 85))),
  };

  // ======================================================================
  // Toasts, Modal, Lightbox
  // ======================================================================
  function toast(msg, kind = '') {
    const t = el('div', { class: 'toast ' + kind, role: 'status' }, msg);
    $('#toasts').append(t);
    if (kind === 'err') sfx.err();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'lvl' ? 4200 : 3400);
  }

  const modalStack = [];
  function modal(title, content) {
    const back = el('div', { class: 'modal-back', role: 'dialog', 'aria-modal': 'true' });
    const close = () => { back.remove(); modalStack.pop(); };
    const box = el('div', { class: 'modal' },
      el('button', { class: 'modal-close', type: 'button', 'aria-label': 'Schließen', onclick: close }, '✕'),
      el('h2', {}, title), content);
    back.append(box);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    $('#modalRoot').append(back);
    modalStack.push(close);
    setTimeout(() => { const f = box.querySelector('input,textarea,select'); if (f) f.focus(); }, 60);
    return { close };
  }

  function openLightbox(src, alt) {
    const lb = $('#lightbox');
    $('img', lb).src = src; $('img', lb).alt = alt || '';
    lb.hidden = false;
  }
  $('#lightbox').addEventListener('click', () => { $('#lightbox').hidden = true; });

  // ======================================================================
  // XP / Level (nur lokal, spielerisch)
  // ======================================================================
  let xp = Number(store.get('nx_xp')) || 0;
  const needFor = (lvl) => 20 * (lvl - 1) ** 2;
  const levelOf = (x) => { let l = 1; while (x >= needFor(l + 1)) l++; return l; };
  function renderXp() {
    if (A.me) return A.paintXp();
    const l = levelOf(xp);
    $('#lvl').textContent = l;
    $('#xpFill').style.width = `${((xp - needFor(l)) / (needFor(l + 1) - needFor(l))) * 100}%`;
  }
  function addXp(n) {
    if (A.me) return; // Konten: XP kommen vom Server
    const before = levelOf(xp);
    xp += n; store.set('nx_xp', xp); renderXp();
    if (levelOf(xp) > before) { toast(`LEVEL UP! Du bist jetzt Level ${levelOf(xp)} 🚀`, 'lvl'); sfx.lvl(); confetti(); }
  }

  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cols = ['#00f0ff', '#ff2bd6', '#b6ff3b', '#8a5cff', '#ffb800'];
    for (let i = 0; i < 36; i++) {
      const p = el('span', { class: 'react-burst' });
      p.style.cssText = `left:${innerWidth / 2}px;top:${innerHeight / 3}px;width:9px;height:9px;background:${cols[i % 5]};border-radius:2px`;
      document.body.append(p);
      const a = Math.random() * Math.PI * 2; const d = 120 + Math.random() * 260;
      p.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d + 160}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }],
        { duration: 1100 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => p.remove();
    }
  }

  // ======================================================================
  // Avatare (zufällige Pixel-Icons aus der Anon-ID) + Textformatierung
  // ======================================================================
  function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  const hueOf = (id) => hashStr(id) % 360;

  function avatar(id, size = 40) {
    const NS = 'http://www.w3.org/2000/svg';
    const hue = hueOf(id);
    const bits = hashStr(id + '#');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 5 5'); svg.setAttribute('width', size); svg.setAttribute('height', size);
    svg.setAttribute('class', 'avatar'); svg.setAttribute('aria-hidden', 'true');
    const rect = (x, y, fill) => { const r = document.createElementNS(NS, 'rect'); r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 1.02); r.setAttribute('height', 1.02); r.setAttribute('fill', fill); svg.append(r); };
    const fg = `hsl(${hue} 95% 62%)`;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if ((bits >> (y * 3 + x)) & 1) { rect(x, y, fg); if (x < 2) rect(4 - x, y, fg); }
    return svg;
  }

  // Autor eines Beitrags: Konto (Name, Profilbild, Rolle) oder alter anonymer Beitrag
  function whoOf(p) {
    const a = p.author;
    if (a) return { name: a.name, seed: a.name, img: a.avatar, role: a.role, rank: a.rank, deleted: !!a.deleted, tag: null };
    return { name: p.nickname || 'Anon', seed: p.anon_id, img: null, role: null, deleted: false, tag: '#' + p.anon_id };
  }
  function avatarOf(w, size) {
    if (w.img) return el('img', { class: 'avatar av-img', src: w.img, alt: '', width: size, height: size, loading: 'lazy' });
    return avatar(w.seed, size);
  }
  const rankTag = (w) => (w.rank ? el('span', { class: 'tag rank-tag', title: 'Rang: ' + w.rank.name }, w.rank.icon + ' ' + w.rank.name) : null);
  const roleTag = (w) => (w.role ? el('span', { class: 'tag role-tag', vars: { '--rc': w.role.color } }, w.role.name) : null);

  const TOKEN = /(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(\|\|[^|\n]+\|\|)|(>>\d+)|(https?:\/\/[^\s<>"']+)/g;
  function inline(parent, line) {
    let last = 0; let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(line))) {
      if (m.index > last) parent.append(line.slice(last, m.index));
      let s = m[0];
      if (m[1]) parent.append(el('strong', {}, s.slice(2, -2)));
      else if (m[2]) parent.append(el('code', {}, s.slice(1, -1)));
      else if (m[3]) { const sp = el('span', { class: 'spoiler', title: 'Klicken zum Aufdecken', onclick: () => sp.classList.toggle('revealed') }, s.slice(2, -2)); parent.append(sp); }
      else if (m[4]) {
        const id = s.slice(2);
        parent.append(el('a', { class: 'ref', href: '#', onclick: (e) => { e.preventDefault(); jumpTo(id); } }, s));
      } else if (m[5]) {
        const trail = /[.,!?;:)]+$/.exec(s);
        if (trail) { s = s.slice(0, -trail[0].length); TOKEN.lastIndex = m.index + s.length; }
        parent.append(el('a', { href: s, target: '_blank', rel: 'noopener noreferrer nofollow' }, s));
      }
      last = m.index + s.length;
    }
    if (last < line.length) parent.append(line.slice(last));
  }
  function renderText(text) {
    const box = el('div', { class: 'text' });
    for (const line of String(text).split('\n')) {
      const d = el('div', { class: 'line' + (line.startsWith('>') && !line.startsWith('>>') ? ' green' : '') });
      inline(d, line);
      box.append(d);
    }
    return box;
  }
  function jumpTo(id) {
    const t = document.getElementById('c' + id);
    if (!t) return toast(`Beitrag #${id} ist nicht in diesem Thread`, 'err');
    t.scrollIntoView({ behavior: 'smooth', block: 'center' });
    t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
  }

  // ======================================================================
  // Effekte: Reaktions-Burst, Hintergrund
  // ======================================================================
  function burst(btn, emoji) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = btn.getBoundingClientRect();
    for (let i = 0; i < 9; i++) {
      const p = el('span', { class: 'react-burst' }, emoji);
      p.style.left = `${r.left + r.width / 2}px`; p.style.top = `${r.top}px`;
      document.body.append(p);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2; const d = 40 + Math.random() * 70;
      p.animate([{ transform: 'translate(-50%,0) scale(.6)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), ${Math.sin(a) * d}px) scale(${1 + Math.random()})`, opacity: 0 }],
        { duration: 700 + Math.random() * 400, easing: 'ease-out' }).onfinish = () => p.remove();
    }
  }

  function initBackground() {
    const c = $('#bg'); const ctx = c.getContext('2d');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';
    let w, h, dpr; const mouse = { x: 0.5, y: 0.5 };
    const cols = ['0,240,255', '255,43,214', '138,92,255', '182,255,59'];
    let parts = [];
    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 2); w = innerWidth; h = innerHeight;
      c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      parts = Array.from({ length: Math.min(70, Math.floor((w * h) / 24000)) }, () => ({
        x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
        r: 1 + Math.random() * 1.8, c: cols[(Math.random() * cols.length) | 0],
      }));
    }
    function frame(t) {
      ctx.clearRect(0, 0, w, h);
      const g = ctx.createRadialGradient(w * 0.5, h * 0.05, 0, w * 0.5, h * 0.05, h * 0.9);
      g.addColorStop(0, 'rgba(110,60,255,.22)'); g.addColorStop(0.55, 'rgba(255,43,214,.05)'); g.addColorStop(1, 'rgba(7,7,15,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // Perspektiv-Grid
      const hor = h * 0.58; const vx = w * (0.5 + (mouse.x - 0.5) * 0.12);
      ctx.lineWidth = 1;
      for (let i = -16; i <= 16; i++) {
        ctx.strokeStyle = `rgba(0,240,255,${0.11 - Math.abs(i) * 0.004})`;
        ctx.beginPath(); ctx.moveTo(vx + i * 12, hor); ctx.lineTo(vx + i * w * 0.11, h); ctx.stroke();
      }
      const off = (t / 2600) % 1;
      for (let i = 0; i < 14; i++) {
        const k = (i + off) / 14; const y = hor + (h - hor) * k * k;
        ctx.strokeStyle = `rgba(255,43,214,${0.03 + k * 0.14})`;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      // Partikel + Verbindungen
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0; if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      }
      for (let i = 0; i < parts.length; i++) {
        const a = parts[i];
        ctx.fillStyle = `rgba(${a.c},.8)`; ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 6.283); ctx.fill();
        for (let j = i + 1; j < parts.length; j++) {
          const b = parts[j]; const dx = a.x - b.x; const dy = a.y - b.y; const d = dx * dx + dy * dy;
          if (d < 12000) { ctx.strokeStyle = `rgba(${a.c},${0.16 * (1 - d / 12000)})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        }
      }
      if (!reduce && !document.hidden) requestAnimationFrame(frame);
    }
    resize();
    addEventListener('resize', () => { resize(); if (reduce) frame(0); });
    addEventListener('mousemove', (e) => { mouse.x = e.clientX / w; mouse.y = e.clientY / h; }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !reduce) requestAnimationFrame(frame); });
    requestAnimationFrame(frame);
  }

  function countUp(node, to) {
    const start = performance.now(); const dur = 1100;
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur);
      node.textContent = Math.round(to * (1 - (1 - k) ** 3)).toLocaleString('de-DE');
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ======================================================================
  // Datei-Auswahl (Drag & Drop, Klick, Einfügen)
  // ======================================================================
  function fileDrop() {
    let files = [];
    const input = el('input', { type: 'file', multiple: true, hidden: true });
    const previews = el('div', { class: 'previews' });
    const zone = el('div', { class: 'dropzone', tabindex: '0', role: 'button' },
      el('span', {}, '📎 Dateien hierher ziehen oder '), el('b', {}, 'auswählen'),
      el('div', { class: 'hint' }, `Bilder, Videos (MP4/WebM), ZIP, PDF, TXT · max. ${cfg.max_upload_mb} MB · bis zu 4 Dateien`));

    function add(list) {
      for (const f of list) {
        if (files.length >= 4) { toast('Maximal 4 Dateien pro Beitrag', 'err'); break; }
        if (!cfg.allowed_ext.includes(extOf(f.name))) { toast(`Dateityp nicht erlaubt: ${extOf(f.name)}`, 'err'); continue; }
        if (f.size > cfg.max_upload_mb * 1048576) { toast(`„${f.name}“ ist zu groß (max. ${cfg.max_upload_mb} MB)`, 'err'); continue; }
        files.push(f);
      }
      draw();
    }
    function draw() {
      previews.replaceChildren(...files.map((f, i) => {
        const box = el('div', { class: 'preview' });
        if (f.type.startsWith('image/')) box.append(el('img', { src: URL.createObjectURL(f), alt: '' }));
        else if (f.type.startsWith('video/')) box.append(el('video', { src: URL.createObjectURL(f) + '#t=0.1', muted: true, preload: 'metadata' }));
        else box.append(el('span', { class: 'pico' }, fileIcon(f.name)));
        box.append(el('span', { class: 'pname' }, f.name), el('button', { class: 'rm', type: 'button', title: 'Entfernen', onclick: () => { files.splice(i, 1); draw(); } }, '✕'));
        return box;
      }));
    }
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { add([...input.files]); input.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
    zone.addEventListener('drop', (e) => add([...e.dataTransfer.files]));

    return {
      node: el('div', { class: 'field' }, zone, input, previews),
      files: () => files,
      add,
      clear: () => { files = []; draw(); },
    };
  }

  // Textarea: Bilder aus der Zwischenablage einfügen
  function enablePaste(textarea, drop) {
    textarea.addEventListener('paste', (e) => {
      const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (imgs.length) {
        const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
        drop.add(imgs.map((f, i) => new File([f], `einfuegung-${Date.now()}-${i}.${ext[f.type] || 'png'}`, { type: f.type })));
        toast('Bild aus der Zwischenablage angehängt 📋');
      }
    });
  }

  // ======================================================================
  // Zustand
  // ======================================================================
  let cfg = { site_name: 'turkac.org', tagline: '', max_upload_mb: 25, emojis: ['🔥'], allowed_ext: [], allow_new_threads: true, uploads_enabled: true };
  let cats = [];
  const S = { cat: '', sort: 'active', q: '', page: 1, pages: 1, token: 0 };
  let pollTimer = null;
  const mine = new Set(JSON.parse(store.get('nx_mine', '[]') || '[]'));
  const rememberMine = (key) => { mine.add(key); store.set('nx_mine', JSON.stringify([...mine].slice(-300))); };

  const NX = { el, $, api, upload, modal, toast, store, avatar, setSound, cfg: () => cfg };
  const A = window.NXAccountFactory(NX);
  NX.me = () => A.me; NX.needLogin = (w) => A.needLogin(w);
  const D = window.NXDmFactory(NX); NX.dm = D;
  NX.confetti = () => confetti(); NX.sfx = sfx;

  // ======================================================================
  // Startseite
  // ======================================================================
  function showHome() {
    clearInterval(pollTimer);
    const app = $('#app');
    let home = $('.home', app);
    if (!home) {
      app.replaceChildren();
      home = el('div', { class: 'wrap home' });
      app.append(home);
      buildHome(home);
    }
    syncChips();
    loadThreads(true);
    document.title = cfg.site_name + ' – Gaming-Forum';
  }

  function buildHome(home) {
    const tag = el('span', { class: 'typed' });
    const title = el('h1', { class: 'hero-title glitch', 'data-text': cfg.site_name }, cfg.site_name);
    const stats = el('div', { class: 'stats' });
    const defs = [['threads', 'Threads', '#00f0ff'], ['comments', 'Kommentare', '#ff2bd6'], ['files', 'Dateien', '#b6ff3b'], ['reactions', 'Reaktionen', '#8a5cff']];
    const nums = {};
    defs.forEach(([k, label, color], i) => {
      nums[k] = el('b', {}, '0');
      stats.append(el('div', { class: 'stat', vars: { '--c': color, '--i': i } }, nums[k], el('span', {}, label)));
    });
    api('/api/stats').then((s) => defs.forEach(([k]) => countUp(nums[k], s[k]))).catch(() => {});

    const chips = el('div', { class: 'chips', id: 'chips' });
    chips.append(el('button', { class: 'chip', type: 'button', 'data-slug': '', onclick: () => (location.hash = '#/') }, 'Alle'));
    for (const c of cats) {
      chips.append(el('button', { class: 'chip', type: 'button', 'data-slug': c.slug, vars: { '--c': c.color }, title: c.description, onclick: () => (location.hash = '#/c/' + c.slug) },
        `${c.icon} ${c.name}`, el('small', {}, c.threads)));
    }
    const sorts = el('div', { class: 'sorts', id: 'sorts' });
    [['active', '⚡ Aktiv'], ['new', '🆕 Neu'], ['hot', '🔥 Hot'], ['top', '🏆 Top']].forEach(([k, label]) =>
      sorts.append(el('button', { class: 'sort' + (S.sort === k ? ' active' : ''), type: 'button', 'data-sort': k, onclick: () => { sfx.click(); S.sort = k; syncChips(); loadThreads(true); } }, label)));

    home.append(
      el('section', { class: 'hero' }, title, el('p', { class: 'hero-tag' }, tag, el('span', { class: 'caret' })),
        el('div', { class: 'hero-cta' }, el('button', { class: 'btn btn-primary', type: 'button', onclick: openComposer }, '＋ Thread starten'),
          el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => $('#search').focus() }, '⌕ Suchen')), stats),
      el('div', { class: 'toolbar' }, chips, sorts),
      el('div', { class: 'threads', id: 'list' }),
      el('div', { class: 'more', id: 'more', hidden: true }, el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => loadThreads(false) }, 'Mehr laden ▾')));

    // Tagline tippen
    const text = cfg.tagline || '';
    let i = 0;
    const type = () => { tag.textContent = text.slice(0, ++i); if (i < text.length && $('.typed')) setTimeout(type, 28); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) tag.textContent = text; else type();

    // Karten-Tilt per Event-Delegation
    const list = $('#list', home);
    list.addEventListener('mousemove', (e) => {
      const c = e.target.closest('.card'); if (!c || matchMedia('(hover: none)').matches) return;
      const r = c.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height;
      c.style.setProperty('--ry', `${(x - 0.5) * 4}deg`); c.style.setProperty('--rx', `${(0.5 - y) * 3}deg`);
      c.style.setProperty('--mx', `${x * 100}%`); c.style.setProperty('--my', `${y * 100}%`);
    });
    list.addEventListener('mouseout', (e) => { const c = e.target.closest('.card'); if (c) { c.style.setProperty('--ry', '0deg'); c.style.setProperty('--rx', '0deg'); } });
  }

  function syncChips() {
    document.querySelectorAll('#chips .chip').forEach((c) => c.classList.toggle('active', c.dataset.slug === S.cat));
    document.querySelectorAll('#sorts .sort').forEach((c) => c.classList.toggle('active', c.dataset.sort === S.sort));
  }

  async function loadThreads(reset) {
    const list = $('#list'); if (!list) return;
    const token = ++S.token;
    if (reset) {
      S.page = 1;
      list.replaceChildren(...Array.from({ length: 4 }, () => el('div', { class: 'skeleton' })));
      $('#more').hidden = true;
    } else S.page++;
    try {
      const qs = new URLSearchParams({ sort: S.sort, page: S.page });
      if (S.cat) qs.set('cat', S.cat);
      if (S.q) qs.set('q', S.q);
      const d = await api('/api/threads?' + qs);
      if (token !== S.token) return;
      if (reset) list.replaceChildren();
      if (reset && !d.threads.length) {
        list.append(el('div', { class: 'empty' }, el('div', { class: 'big' }, '👾'),
          el('h3', {}, S.q ? 'Keine Treffer' : 'Hier ist noch nichts los'),
          el('p', {}, S.q ? `Für „${S.q}“ wurde nichts gefunden.` : 'Sei der Erste und starte einen Thread!')));
      }
      d.threads.forEach((t, i) => list.append(threadCard(t, i)));
      S.pages = d.pages;
      $('#more').hidden = S.page >= d.pages;
    } catch (e) {
      if (token === S.token) { list.replaceChildren(el('div', { class: 'empty' }, el('div', { class: 'big' }, '⚠️'), el('p', {}, e.message))); }
    }
  }

  function threadCard(t, i) {
    const a = el('a', { class: 'card' + (t.pinned ? ' pinned' : ''), href: '#/t/' + t.id, vars: { '--c': t.category.color, '--i': Math.min(i, 12) } });
    let thumb;
    if (t.thumb_kind === 'image') thumb = el('div', { class: 'thumb' }, el('img', { src: '/uploads/' + t.thumb, alt: '', loading: 'lazy' }));
    else if (t.thumb_kind === 'video') thumb = el('div', { class: 'thumb' }, el('video', { src: '/uploads/' + t.thumb + '#t=0.1', preload: 'metadata', muted: true }), el('span', { class: 'play' }, '▶'));
    else thumb = el('div', { class: 'thumb' }, el('span', { class: 'thumb-ico' }, t.category.icon));
    const hot = t.comment_count >= 10;
    a.append(thumb, el('div', { class: 'card-body' },
      el('div', { class: 'card-top' },
        t.pinned && el('span', { class: 'badge pin' }, '📌 Angepinnt'),
        el('span', { class: 'badge' }, `${t.category.icon} ${t.category.name}`),
        t.locked && el('span', { class: 'badge lock' }, '🔒 Gesperrt')),
      el('h3', { class: 'card-title' }, t.title),
      t.snippet && el('p', { class: 'card-snippet' }, plain(t.snippet)),
      el('div', { class: 'card-meta' },
        (() => { const w = whoOf(t); return el('span', { class: 'meta-item' }, avatarOf(w, 20), el('span', { class: 'anon', style: `color:hsl(${hueOf(w.seed)} 90% 68%)` }, w.name), roleTag(w), rankTag(w), w.tag && el('span', { class: 'muted' }, w.tag)); })(),
        el('span', { class: 'meta-item' }, '🕒 ' + ago(t.bumped_at)),
        el('span', { class: 'meta-item' + (hot ? ' hot' : '') }, '💬 ' + t.comment_count),
        el('span', { class: 'meta-item' }, '🔥 ' + t.reaction_count),
        el('span', { class: 'meta-item' }, '👁 ' + t.views),
        t.file_count > 0 && el('span', { class: 'meta-item' }, '📎 ' + t.file_count))));
    return a;
  }

  // ======================================================================
  // Thread-Ansicht
  // ======================================================================
  function attachments(list) {
    if (!list || !list.length) return null;
    const wrap = el('div', { class: 'atts' });
    for (const a of list) {
      const url = '/uploads/' + a.name;
      if (a.kind === 'image') wrap.append(el('button', { class: 'att att-img', type: 'button', title: a.original, onclick: () => openLightbox(url, a.original) }, el('img', { src: url, alt: a.original, loading: 'lazy' })));
      else if (a.kind === 'video') wrap.append(el('div', { class: 'att att-video' }, el('video', { src: url, controls: true, preload: 'metadata', playsinline: true })));
      else wrap.append(el('a', { class: 'att att-file', href: url, download: a.original }, el('span', { class: 'file-ico' }, fileIcon(a.original)), el('span', { class: 'file-name' }, a.original), el('span', { class: 'file-size' }, fmtSize(a.size))));
    }
    return wrap;
  }

  function reactBar(type, id, reactions) {
    const bar = el('div', { class: 'reacts' });
    const draw = (rx) => {
      bar.querySelectorAll('.react').forEach((b) => b.remove());
      const anchor = bar.querySelector('.bar-end');
      for (const e of cfg.emojis) {
        const r = rx[e] || { n: 0, mine: false };
        const b = el('button', { class: 'react' + (r.n ? ' has' : '') + (r.mine ? ' mine' : ''), type: 'button', title: 'Reagieren', onclick: async () => {
          try {
            const d = await api('/api/react', { method: 'POST', json: { type, id, emoji: e } });
            draw(d.reactions);
            if (d.added) { burst(bar.querySelector(`[data-e="${e}"]`) || b, e); sfx.ok(); addXp(1); }
          } catch (err) { if (err.code === 'LOGIN_REQUIRED') A.needLogin(); else toast(err.message, 'err'); }
        }, 'data-e': e }, e, el('span', { class: 'n' }, r.n || ''));
        bar.insertBefore(b, anchor);
      }
    };
    bar.append(el('span', { class: 'bar-end' }));
    draw(reactions || {});
    return bar;
  }

  const REPORT_CATS = [['spam', 'Spam / Werbung'], ['beleidigung', 'Beleidigung / Mobbing'], ['hass', 'Hass / Hetze'], ['illegal', 'Illegale Inhalte'], ['jugendschutz', 'Jugendschutz'], ['datenschutz', 'Private Daten / Doxxing'], ['sonstiges', 'Sonstiges']];
  function reportBtn(type, id) {
    return el('button', { class: 'link-btn', type: 'button', title: 'Beitrag melden', onclick: () => {
      if (!A.me) return A.needLogin('Zum Melden brauchst du ein anonymes Konto.');
      const cat = el('select', {}, REPORT_CATS.map(([v, l]) => el('option', { value: v }, l)));
      const reason = el('textarea', { maxlength: '300', placeholder: 'Details (optional)' });
      const send = el('button', { class: 'btn btn-danger', type: 'button' }, 'Melden');
      const m = modal('Beitrag melden', el('div', { class: 'field' }, el('label', {}, 'Kategorie'), cat, el('label', {}, 'Details'), reason,
        el('div', { class: 'modal-actions' }, el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Abbrechen'), send)));
      send.addEventListener('click', async () => {
        try { await api('/api/report', { method: 'POST', json: { type, id, reason: reason.value, category: cat.value } }); toast('Danke – die Moderation schaut es sich an 🛡️'); m.close(); }
        catch (e) { if (e.code === 'LOGIN_REQUIRED') { m.close(); A.needLogin(); } else toast(e.message, 'err'); }
      });
    } }, '⚑ Melden');
  }

  function postHead(p, key, extra) {
    const w = whoOf(p);
    const isMine = p.author ? !!(A.me && A.me.username === p.author.name) : mine.has(key);
    return el('div', { class: 'post-head' }, avatarOf(w, 40),
      el('div', { class: 'who' },
        el('span', {}, el('span', { class: 'anon', style: `color:hsl(${hueOf(w.seed)} 90% 68%)` }, w.name), ' ', w.tag && el('span', { class: 'nick' }, w.tag), ' ', roleTag(w), ' ', rankTag(w), ' ',
          p.is_op && el('span', { class: 'tag tag-op' }, 'OP'), ' ', isMine && el('span', { class: 'tag tag-you' }, 'Du')),
        el('span', { class: 'time', title: new Date(p.created_at).toLocaleString('de-DE') }, ago(p.created_at))), extra);
  }

  function commentEl(c, isNew) {
    const bar = reactBar('comment', c.id, c.reactions);
    bar.append(el('button', { class: 'link-btn', type: 'button', onclick: () => D.share('comment', c.id) }, '✉ Senden'), reportBtn('comment', c.id));
    return el('article', { class: 'post comment' + (isNew ? ' new' : ''), id: 'c' + c.id },
      postHead(c, 'c' + c.id, el('button', { class: 'no', type: 'button', title: 'Antworten', onclick: () => replyTo(c.id) }, '#' + c.id)),
      c.body && renderText(c.body), attachments(c.attachments), bar);
  }

  function replyTo(id) {
    const ta = $('#replyBody'); if (!ta) return;
    ta.value = (ta.value ? ta.value + '\n' : '') + '>>' + id + '\n';
    ta.focus(); ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); sfx.click();
  }

  async function showThread(id) {
    clearInterval(pollTimer);
    const app = $('#app');
    app.replaceChildren(el('div', { class: 'wrap page' }, el('div', { class: 'skeleton' })));
    let data;
    try { data = await api('/api/threads/' + id); }
    catch (e) {
      app.replaceChildren(el('div', { class: 'wrap page' }, el('div', { class: 'empty' }, el('div', { class: 'big' }, '💀'), el('h3', {}, 'Thread nicht gefunden'), el('p', {}, e.message), el('a', { href: '#/' }, '← Zur Übersicht'))));
      return;
    }
    const t = data.thread;
    document.title = `${t.title} – ${cfg.site_name}`;
    const seen = new Set(data.comments.map((c) => c.id));
    const list = el('div', { class: 'comment-list' });
    data.comments.forEach((c) => list.append(commentEl(c)));
    const countEl = el('span', {}, countLabel(data.comments.length));

    const op = el('article', { class: 'post op', vars: { '--c': t.category.color } },
      postHead({ ...t, is_op: false }, 't' + t.id, el('span', { class: 'no' }, '#' + t.id)),
      el('div', { class: 'card-top', style: 'margin-bottom:8px' }, t.pinned && el('span', { class: 'badge pin' }, '📌 Angepinnt'), el('span', { class: 'badge', style: `--c:${t.category.color}` }, `${t.category.icon} ${t.category.name}`), t.locked && el('span', { class: 'badge lock' }, '🔒 Gesperrt')),
      el('h1', { class: 'post-title' }, t.title),
      t.body && renderText(t.body), attachments(t.attachments),
      el('div', { class: 'thread-meta', style: 'margin-top:12px' }, el('span', {}, '👁 ' + t.views + ' Aufrufe')),
      (() => {
        const bar = reactBar('thread', t.id, t.reactions);
        bar.append(el('button', { class: 'link-btn share', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(location.href); toast('Link kopiert 🔗'); } catch { toast('Kopieren nicht möglich', 'err'); } } }, '🔗 Teilen'), el('button', { class: 'link-btn', type: 'button', onclick: () => D.share('thread', t.id) }, '✉ Senden'), reportBtn('thread', t.id));
        bar.querySelector('.link-btn.share').style.marginLeft = 'auto';
        bar.querySelectorAll('.link-btn').forEach((b, i) => { if (i) b.style.marginLeft = '0'; });
        return bar;
      })());

    const replyArea = el('div', { class: 'reply', id: 'replyArea' });
    const buildReply = (locked) => {
      replyArea.replaceChildren(locked ? el('div', { class: 'locked-note' }, '🔒 Dieser Thread wurde von der Moderation gesperrt.') : replyForm(t.id, async (newId) => { await refresh(newId); }));
    };
    buildReply(t.locked);

    app.replaceChildren(el('div', { class: 'wrap page' },
      el('button', { class: 'back', type: 'button', onclick: () => (history.length > 1 ? history.back() : (location.hash = '#/')) }, '← Zurück'),
      op, el('h2', { class: 'comments-head' }, countEl, el('span', { class: 'live' }, 'live')), list, replyArea));
    window.scrollTo({ top: 0 });

    async function refresh(focusId) {
      try {
        const d = await api(`/api/threads/${id}?v=0`);
        const fresh = d.comments.filter((c) => !seen.has(c.id));
        fresh.forEach((c) => { seen.add(c.id); list.append(commentEl(c, true)); });
        countEl.textContent = countLabel(d.comments.length);
        if (d.thread.locked !== t.locked) { t.locked = d.thread.locked; buildReply(t.locked); }
        if (focusId) setTimeout(() => jumpTo(focusId), 80);
        else if (fresh.length) sfx.click();
      } catch { /* Polling-Fehler ignorieren */ }
    }
    pollTimer = setInterval(() => { if (!document.hidden && !$('#replyBody')?.matches(':focus')) refresh(); }, 12000);
  }

  function replyForm(threadId, onDone) {
    const blocked = A.writeBlock('comment');
    if (blocked === 'login') {
      return el('div', { class: 'locked-note login-note' }, '💬 Zum Mitschreiben brauchst du ein anonymes Konto. ',
        el('a', { href: '/auth/#register' }, 'Registrieren'), ' oder ', el('a', { href: '/auth/?next=' + encodeURIComponent(location.pathname + location.hash) + '#login' }, 'anmelden'), '.');
    }
    if (blocked) return el('div', { class: 'locked-note' }, '⛔ ' + blocked);
    const body = el('textarea', { id: 'replyBody', maxlength: '2000', placeholder: 'Deine Antwort …   (**fett**, `Code`, ||Spoiler||, >Greentext, >>123 = Antwort)' });
    const drop = fileDrop();
    enablePaste(body, drop);
    const prog = el('div', { class: 'progress', hidden: true }, el('i'));
    const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Antworten');
    const form = el('form', { class: 'reply-box' },
      el('div', { class: 'field' }, el('label', {}, 'Antwort schreiben'), body),
      cfg.uploads_enabled && drop.node,
      el('div', { class: 'row' }, el('div', { class: 'post-as' }, 'Du schreibst als ', el('b', {}, A.me.username)), btn), prog);
    body.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') form.requestSubmit(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!body.value.trim() && !drop.files().length) return toast('Schreib etwas oder hänge eine Datei an', 'err');
      const fd = new FormData();
      fd.append('body', body.value);
      drop.files().forEach((f) => fd.append('files', f, f.name));
      btn.disabled = true; prog.hidden = !drop.files().length;
      try {
        const r = await upload(`/api/threads/${threadId}/comments`, fd, (p) => { prog.firstChild.style.width = p * 100 + '%'; });
        rememberMine('c' + r.id);
        body.value = ''; drop.clear(); prog.hidden = true; prog.firstChild.style.width = '0';
        sfx.ok(); addXp(5); toast('Antwort gepostet ✔'); A.reward(r.reward);
        await onDone(r.id);
      } catch (err) { if (err.code === 'LOGIN_REQUIRED') A.needLogin(); else toast(err.message, 'err'); prog.hidden = true; }
      btn.disabled = false;
    });
    return form;
  }

  // ======================================================================
  // Neuer Thread (Modal)
  // ======================================================================
  function openComposer() {
    if (!cfg.allow_new_threads) return toast('Neue Threads sind aktuell deaktiviert', 'err');
    const blocked = A.writeBlock('thread');
    if (blocked === 'login') return A.needLogin('Zum Schreiben brauchst du ein anonymes Konto – nur ein Benutzername, keine E-Mail nötig.');
    if (blocked) return toast(blocked, 'err');
    sfx.click();
    const sel = el('select', {}, ...cats.map((c) => el('option', { value: c.id }, `${c.icon} ${c.name}`)));
    const cur = cats.find((c) => c.slug === S.cat); if (cur) sel.value = cur.id;
    const title = el('input', { type: 'text', maxlength: '120', placeholder: 'Worum geht es?' });
    const body = el('textarea', { maxlength: '5000', placeholder: 'Schreib los …  (**fett**, `Code`, ||Spoiler||, >Greentext)' });
    const counter = el('span', { class: 'counter' }, '0 / 5000');
    body.addEventListener('input', () => { counter.textContent = `${body.value.length} / 5000`; });
    const drop = fileDrop(); enablePaste(body, drop);
    const prog = el('div', { class: 'progress', hidden: true }, el('i'));
    const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, '🚀 Posten');
    const form = el('form', { style: 'display:grid;gap:14px' },
      el('div', { class: 'row' }, el('div', { class: 'field' }, el('label', {}, 'Kategorie'), sel), el('div', { class: 'field', style: 'flex:2' }, el('label', {}, 'Titel'), title)),
      el('div', { class: 'field' }, el('label', {}, 'Beitrag', counter), body),
      cfg.uploads_enabled && drop.node,
      el('div', { class: 'row' }, el('div', { class: 'post-as' }, 'Du postest als ', el('b', {}, A.me.username)), btn), prog,
      el('div', { class: 'hint' }, '🕶 Dein Benutzername ist anonym – kein Klarname, keine E-Mail nötig.'));
    const m = modal('Neuen Thread starten', form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData();
      fd.append('category_id', sel.value); fd.append('title', title.value); fd.append('body', body.value);
      drop.files().forEach((f) => fd.append('files', f, f.name));
      btn.disabled = true; prog.hidden = !drop.files().length;
      try {
        const r = await upload('/api/threads', fd, (p) => { prog.firstChild.style.width = p * 100 + '%'; });
        rememberMine('t' + r.id);
        m.close(); sfx.ok(); addXp(10); toast('Thread erstellt 🎉'); A.reward(r.reward);
        location.hash = '#/t/' + r.id;
      } catch (err) { if (err.code === 'LOGIN_REQUIRED') { m.close(); A.needLogin(); } else toast(err.message, 'err'); btn.disabled = false; prog.hidden = true; }
    });
  }

  // ======================================================================
  // Router, Eingaben, Start
  // ======================================================================
  function route() {
    const h = location.hash.slice(1) || '/';
    let m;
    if ((m = /^\/t\/(\d+)/.exec(h))) return showThread(Number(m[1]));
    S.cat = (m = /^\/c\/([a-z0-9-]+)/.exec(h)) ? m[1] : '';
    return showHome();
  }

  function setupInput() {
    const search = $('#search'); let timer;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        S.q = search.value.trim();
        if (location.hash.startsWith('#/t/')) location.hash = '#/';
        else showHome();
      }, 300);
    });
    $('#newBtn').addEventListener('click', openComposer);
    const sb = $('#soundBtn');
    const paintSound = () => { sb.textContent = soundOn ? '🔊' : '🔇'; };
    paintSound();
    sb.addEventListener('click', () => { soundOn = !soundOn; store.set('nx_sound', soundOn ? '1' : '0'); paintSound(); sfx.ok(); });

    addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
      if (e.key === 'Escape') {
        if (!$('#lightbox').hidden) $('#lightbox').hidden = true;
        else if (modalStack.length) modalStack[modalStack.length - 1]();
        else if (typing) document.activeElement.blur();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); search.focus(); }
      else if (e.key.toLowerCase() === 'n') { e.preventDefault(); openComposer(); }
    });

    // Konami-Code → RGB-Modus
    const seq = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    let pos = 0;
    addEventListener('keydown', (e) => {
      pos = e.key.toLowerCase() === seq[pos].toLowerCase() ? pos + 1 : (e.key === seq[0] ? 1 : 0);
      if (pos === seq.length) {
        pos = 0; document.body.classList.toggle('rgb-mode');
        toast(document.body.classList.contains('rgb-mode') ? '🌈 RGB-MODUS FREIGESCHALTET' : 'RGB-Modus aus', 'lvl'); sfx.lvl(); confetti(); addXp(25);
      }
    });
    $('#logo, .logo').addEventListener('click', () => { S.q = ''; search.value = ''; });
  }

  async function boot() {
    initBackground();
    renderXp();
    setupInput();
    try {
      [cfg, { categories: cats }] = await Promise.all([api('/api/config'), api('/api/categories')]);
    } catch (e) {
      if (e.code === 'LOGIN_REQUIRED') { location.replace('/auth/?next=' + encodeURIComponent('/forum')); return; }
      $('#app').replaceChildren(el('div', { class: 'wrap' }, el('div', { class: 'empty' }, el('div', { class: 'big' }, '⚠️'), el('h3', {}, 'Server nicht erreichbar'), el('p', {}, e.message))));
      return;
    }
    await A.load(); A.renderUserArea(); D.start(); A.banner(); A.maybeRemind();
    if (A.me && A.me.settings) setSound(!!A.me.settings.sound && store.get('nx_sound') !== '0');
    const sn = $('#siteName'); sn.textContent = cfg.site_name; sn.dataset.text = cfg.site_name;
    if ($('#footName')) $('#footName').textContent = cfg.site_name;
    if (cfg.announcement) { $('#announceText').textContent = cfg.announcement; $('#announce').hidden = false; }
    addEventListener('hashchange', route);
    route();
  }
  boot();
})();
