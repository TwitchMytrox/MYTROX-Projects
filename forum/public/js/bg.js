/* turkac.org – animierter Neon-Hintergrund für Landing-, Login- und Wartungsseite */
(() => {
  'use strict';
  const c = document.getElementById('bg');
  if (!c) return;
  const ctx = c.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cols = ['0,240,255', '255,43,214', '138,92,255', '182,255,59'];
  let w, h, dpr, parts = [];
  const mouse = { x: 0.5 };

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    c.width = w * dpr; c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    parts = Array.from({ length: Math.min(60, Math.floor((w * h) / 26000)) }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
      r: 1 + Math.random() * 1.8, c: cols[(Math.random() * cols.length) | 0],
    }));
  }

  function frame(t) {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w * 0.5, h * 0.05, 0, w * 0.5, h * 0.05, h * 0.9);
    g.addColorStop(0, 'rgba(110,60,255,.24)'); g.addColorStop(0.55, 'rgba(255,43,214,.05)'); g.addColorStop(1, 'rgba(7,7,15,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // Perspektiv-Raster
    const hor = h * 0.62;
    const vx = w * (0.5 + (mouse.x - 0.5) * 0.12);
    ctx.lineWidth = 1;
    for (let i = -16; i <= 16; i++) {
      ctx.strokeStyle = `rgba(0,240,255,${0.11 - Math.abs(i) * 0.004})`;
      ctx.beginPath(); ctx.moveTo(vx + i * 12, hor); ctx.lineTo(vx + i * w * 0.11, h); ctx.stroke();
    }
    const off = (t / 2600) % 1;
    for (let i = 0; i < 14; i++) {
      const k = (i + off) / 14;
      const y = hor + (h - hor) * k * k;
      ctx.strokeStyle = `rgba(255,43,214,${0.03 + k * 0.14})`;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
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
  addEventListener('mousemove', (e) => { mouse.x = e.clientX / w; }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !reduce) requestAnimationFrame(frame); });
  requestAnimationFrame(frame);
})();
