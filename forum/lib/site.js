'use strict';
// ======================================================================
// Seiten-Steuerung: Wartungsmodus (mit Timer), Landingpage für Gäste,
// robots.txt / sitemap.xml.
// ======================================================================
const path = require('path');

module.exports = function initSite(ctx, acc) {
  const { db, now, getSetting, setSetting, GET, PUT, send, fail, jsonBody, audit, serveFile, PUBLIC_DIR } = ctx;
  const { requirePerm } = acc;

  // ------------------------------------------------------------------
  // Wartungsmodus
  //  - "on" = sofort aktiv (optional mit Ende "until")
  //  - "start" + "until" = geplantes Zeitfenster
  //  - nach "until" schaltet sich die Seite von selbst wieder ein
  // ------------------------------------------------------------------
  function maintenanceState() {
    const on = getSetting('maintenance_on', '0') === '1';
    const start = Number(getSetting('maintenance_start', '')) || 0;
    const until = Number(getSetting('maintenance_until', '')) || 0;
    const t = now();
    if (until && t >= until && (on || start)) {
      // Zeit ist abgelaufen → automatisch wieder online
      setSetting('maintenance_on', '0');
      setSetting('maintenance_start', '');
      setSetting('maintenance_until', '');
      audit('(system)', 'maintenance_auto_end', '');
      return { active: false, scheduled: false, start: 0, until: 0, message: '', redirect: '' };
    }
    let active = false;
    if (on) active = true;
    else if (start && t >= start) active = true;
    return {
      active,
      scheduled: !on && !!start && t < start,
      start,
      until,
      message: getSetting('maintenance_message', ''),
      redirect: getSetting('maintenance_redirect', ''),
    };
  }

  const OPEN_PREFIXES = ['/admin', '/api/admin', '/api/auth', '/api/maintenance', '/auth', '/css/', '/js/', '/img/', '/maintenance', '/avatars/', '/impressum', '/datenschutz', '/agb', '/regeln', '/cookies', '/barrierefreiheit', '/support', '/api/support', '/blog', '/api/blog', '/turniere', '/api/tournaments', '/api/lottery', '/manifest.webmanifest', '/sw.js', '/icons/'];

  // true = Anfrage wurde bereits beantwortet
  function maintenanceGate(req, res, pathname) {
    const m = maintenanceState();
    if (!m.active) return false;
    if (OPEN_PREFIXES.some((p) => pathname.startsWith(p))) return false;
    if (req.user && acc.isTeam(req.user)) return false; // Team darf weiterarbeiten
    if (pathname.startsWith('/api/')) {
      send(res, 503, { error: m.message || 'Wartungsarbeiten', maintenance: true, until: m.until || null });
      return true;
    }
    if (m.redirect && /^https?:\/\//i.test(m.redirect)) {
      res.writeHead(302, { Location: m.redirect, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
    serveFile(req, res, path.join(PUBLIC_DIR, 'maintenance.html'), { cache: 'no-store', status: 503, extra: { 'Retry-After': m.until ? String(Math.max(60, Math.ceil((m.until - now()) / 1000))) : '600' } });
    return true;
  }

  GET('/api/maintenance', (req, res) => {
    const m = maintenanceState();
    send(res, 200, { active: m.active, until: m.until || null, message: m.message, name: getSetting('site_name') });
  });

  GET('/api/admin/maintenance', requirePerm('maintenance.manage'), (req, res) => {
    const m = maintenanceState();
    send(res, 200, { ...m, on: getSetting('maintenance_on') === '1' });
  });

  PUT('/api/admin/maintenance', requirePerm('maintenance.manage'), jsonBody, (req, res) => {
    const b = req.body;
    const message = String(b.message == null ? getSetting('maintenance_message') : b.message).trim().slice(0, 300);
    let redirect = String(b.redirect == null ? getSetting('maintenance_redirect') : b.redirect).trim();
    if (redirect && !/^https?:\/\/[^\s]{3,300}$/i.test(redirect)) return fail(res, 400, 'Weiterleitung muss mit http:// oder https:// beginnen');
    const t = now();
    let until = 0;
    if (b.minutes) until = t + Math.min(60 * 24 * 30, Math.max(1, Math.round(Number(b.minutes)))) * 60_000;
    else if (b.until) until = Number(b.until) || 0;
    if (until && until <= t) return fail(res, 400, 'Das Ende muss in der Zukunft liegen');

    if (b.on) {
      setSetting('maintenance_on', '1');
      setSetting('maintenance_start', '');
      setSetting('maintenance_until', until ? String(until) : '');
    } else if (b.start) {
      const start = Number(b.start) || 0;
      if (start <= t) return fail(res, 400, 'Der Start muss in der Zukunft liegen');
      if (until && until <= start) return fail(res, 400, 'Das Ende muss nach dem Start liegen');
      setSetting('maintenance_on', '0');
      setSetting('maintenance_start', String(start));
      setSetting('maintenance_until', until ? String(until) : '');
    } else {
      setSetting('maintenance_on', '0');
      setSetting('maintenance_start', '');
      setSetting('maintenance_until', '');
    }
    setSetting('maintenance_message', message);
    setSetting('maintenance_redirect', redirect);
    const m = maintenanceState();
    audit(req.admin.username, 'maintenance', m.active ? `AN${m.until ? ' bis ' + new Date(m.until).toLocaleString('de-DE') : ' (unbefristet)'}` : m.scheduled ? `geplant ab ${new Date(m.start).toLocaleString('de-DE')}` : 'AUS');
    send(res, 200, { ...m, on: getSetting('maintenance_on') === '1' });
  });

  // ------------------------------------------------------------------
  // Seiten: Landingpage (Gäste) oder Forum (angemeldet)
  // ------------------------------------------------------------------
  const sendFile = (req, res, name, extra) => serveFile(req, res, path.join(PUBLIC_DIR, name), { cache: 'no-cache', ...extra });

  // true = beantwortet
  function servePage(req, res, pathname) {
    if (pathname === '/' || pathname === '/index.html') {
      sendFile(req, res, req.user ? 'index.html' : 'landing.html');
      return true;
    }
    if (pathname === '/forum' || pathname === '/forum/') {
      if (req.user || getSetting('guest_read', '1') === '1') sendFile(req, res, 'index.html');
      else { res.writeHead(302, { Location: '/auth/' }); res.end(); }
      return true;
    }
    if (pathname === '/turniere') { res.writeHead(301, { Location: '/turniere/' }); res.end(); return true; }
    if (pathname === '/spiele') { res.writeHead(301, { Location: '/spiele/' }); res.end(); return true; }
    if (pathname === '/support') { res.writeHead(301, { Location: '/support/' }); res.end(); return true; }
    if (pathname === '/auth') { res.writeHead(301, { Location: '/auth/' }); res.end(); return true; }
    return false;
  }

  const baseUrl = (req) => {
    const proto = req.headers['x-forwarded-proto'] || (ctx.SECURE_COOKIES ? 'https' : 'http');
    return `${proto}://${req.headers.host}`;
  };
  GET('/robots.txt', (req, res) => {
    const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /auth/\nSitemap: ${baseUrl(req)}/sitemap.xml\n`;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    res.end(body);
  });
  GET('/sitemap.xml', (req, res) => {
    const u = baseUrl(req);
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${u}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n`;
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    res.end(body);
  });

  return { maintenanceState, maintenanceGate, servePage };
};
