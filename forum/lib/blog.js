/* Blog / News / Werbung – getrennt vom Forum. Nur Nutzer mit dem Recht blog.manage schreiben.
   Öffentliche Seiten: /blog und /blog/<zufälliger-slug> (serverseitig gerendert, ohne Skripte). Werbung wird immer als „Anzeige“ gekennzeichnet. */
const crypto = require('node:crypto');
const chrome = require('./chrome');
module.exports = function init(ctx, acc) {
  const { db, now, getSetting, GET, POST, PATCH, DEL, send, fail, jsonBody, audit, clean } = ctx;
  const perm = acc.requirePerm('blog.manage');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const KINDS = { blog: 'Blog', news: 'Neuigkeit', werbung: 'Anzeige' };

  db.exec(`CREATE TABLE IF NOT EXISTS blog_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'blog', cta_url TEXT NOT NULL DEFAULT '', cta_text TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
    author_id INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, published_at INTEGER);
    CREATE INDEX IF NOT EXISTS idx_blog_pub ON blog_posts(published, pinned, published_at);`);

  const newSlug = () => crypto.randomBytes(5).toString('hex');
  const safeUrl = (u) => { u = String(u || '').trim().slice(0, 300); return /^(https:\/\/|\/)/.test(u) && !u.startsWith('//') ? u : ''; };

  // Mini-Markdown: ## Überschrift, - Liste, **fett**, [Text](https://…)
  function md(src) {
    const out = []; let list = false;
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(((?:https:\/\/|\/)[^\s)"<]+)\)/g, '<a href="$2" rel="noopener noreferrer nofollow ugc">$1</a>');
    for (const line of String(src).split('\n')) {
      if (/^- /.test(line)) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(line.slice(2))}</li>`); continue; }
      if (list) { out.push('</ul>'); list = false; }
      if (/^## /.test(line)) out.push(`<h2>${inline(line.slice(3))}</h2>`);
      else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
    if (list) out.push('</ul>');
    return out.join('\n');
  }
  const date = (t) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });

  function shell(title, inner, desc) {
    const site = esc(getSetting('site_name', 'turkac.org'));
    return `<!doctype html><html lang="de" data-site="${site}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} – ${site}</title>${desc ? `<meta name="description" content="${esc(desc)}">` : ''}<meta name="theme-color" content="#07070f"><link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/css/pages.css"><link rel="stylesheet" href="/css/chrome.css"><link rel="stylesheet" href="/css/legal.css"><link rel="stylesheet" href="/css/blog.css"></head><body><a class="skip-link" href="#main">Zum Inhalt springen</a><canvas id="bg" aria-hidden="true"></canvas>${chrome.header(getSetting('site_name', 'turkac.org'), 'blog')}<main id="main" class="wrap legal blog">${inner}</main>${chrome.footer(getSetting('site_name', 'turkac.org'), '')}<script src="/js/chrome.js"></script><script src="/js/bg.js"></script><script src="/js/sfx.js"></script><script src="/js/fx.js"></script></body></html>`;
  }
  const html = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(body); };
  const badge = (k) => `<span class="kind kind-${k}">${KINDS[k]}</span>`;

  GET('/blog', (req, res) => {
    const rows = db.prepare('SELECT p.*, u.username FROM blog_posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.published = 1 ORDER BY p.pinned DESC, p.published_at DESC LIMIT 60').all();
    const cards = rows.map((p) => `<article class="card post-card${p.pinned ? ' pinned' : ''}${p.kind === 'werbung' ? ' ad' : ''}"><div class="meta">${badge(p.kind)}${p.pinned ? '<span class="kind kind-pin">Angepinnt</span>' : ''}<time datetime="${new Date(p.published_at).toISOString()}">${date(p.published_at)}</time></div><h2><a href="/blog/${p.slug}">${esc(p.title)}</a></h2>${p.summary ? `<p>${esc(p.summary)}</p>` : ''}<a class="more" href="/blog/${p.slug}">Weiterlesen<span class="sr"> – ${esc(p.title)}</span></a></article>`).join('');
    html(res, 200, shell('Blog & News', `<h1>Blog &amp; News</h1><p class="lead">Neuigkeiten vom Team – getrennt vom Forum.</p><div class="post-list">${cards || '<p class="empty">Noch keine Beiträge.</p>'}</div>`, 'Neuigkeiten und Beiträge vom Team'));
  });

  GET('/blog/:slug', (req, res) => {
    const p = db.prepare('SELECT p.*, u.username FROM blog_posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.slug = ? AND p.published = 1').get(String(req.params.slug));
    if (!p) return html(res, 404, shell('Nicht gefunden', '<h1>Beitrag nicht gefunden</h1><p><a href="/blog">Zurück zum Blog</a></p>'));
    const cta = p.cta_url ? `<p class="cta"><a class="btn" href="${esc(p.cta_url)}" rel="noopener noreferrer nofollow sponsored">${esc(p.cta_text || 'Mehr erfahren')}</a></p>` : '';
    html(res, 200, shell(p.title, `<article class="card post${p.kind === 'werbung' ? ' ad' : ''}"><p class="meta">${badge(p.kind)}<time datetime="${new Date(p.published_at).toISOString()}">${date(p.published_at)}</time></p>${p.kind === 'werbung' ? '<p class="ad-note">Dies ist eine Anzeige des Betreibers.</p>' : ''}<h1>${esc(p.title)}</h1>${md(p.body)}${cta}<p><a href="/blog">← Alle Beiträge</a></p></article>`, p.summary));
  });
  GET('/api/blog', (req, res) => send(res, 200, { posts: db.prepare('SELECT slug, title, summary, kind, pinned, published_at FROM blog_posts WHERE published = 1 ORDER BY pinned DESC, published_at DESC LIMIT 20').all() }));

  // ---- Team ----
  const row = (p) => ({ id: p.id, slug: p.slug, title: p.title, summary: p.summary, body: p.body, kind: p.kind, cta_url: p.cta_url, cta_text: p.cta_text, published: !!p.published, pinned: !!p.pinned, created_at: p.created_at, updated_at: p.updated_at, published_at: p.published_at, author: p.username || null });
  GET('/api/admin/blog', perm, (req, res) => send(res, 200, { kinds: KINDS, posts: db.prepare('SELECT p.*, u.username FROM blog_posts p LEFT JOIN users u ON u.id = p.author_id ORDER BY p.updated_at DESC LIMIT 200').all().map(row) }));

  function fields(b, p = {}) {
    const o = {};
    if ('title' in b) o.title = clean(b.title, 140).replace(/\n/g, ' ');
    if ('summary' in b) o.summary = clean(b.summary, 300).replace(/\n/g, ' ');
    if ('body' in b) o.body = String(b.body || '').replace(/\r/g, '').slice(0, 30000);
    if ('kind' in b) o.kind = KINDS[b.kind] ? b.kind : 'blog';
    if ('cta_url' in b) o.cta_url = safeUrl(b.cta_url);
    if ('cta_text' in b) o.cta_text = clean(b.cta_text, 60).replace(/\n/g, ' ');
    if ('pinned' in b) o.pinned = b.pinned ? 1 : 0;
    if ('published' in b) o.published = b.published ? 1 : 0;
    return o;
  }
  POST('/api/admin/blog', perm, jsonBody, (req, res) => {
    const o = fields(req.body);
    if (!o.title || o.title.length < 3) return fail(res, 400, 'Titel fehlt (mindestens 3 Zeichen)');
    if (req.body.cta_url && !o.cta_url) return fail(res, 400, 'Link muss mit https:// beginnen');
    const t = now(), pub = o.published ? 1 : 0;
    const id = Number(db.prepare('INSERT INTO blog_posts(slug,title,summary,body,kind,cta_url,cta_text,published,pinned,author_id,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(newSlug(), o.title, o.summary || '', o.body || '', o.kind || 'blog', o.cta_url || '', o.cta_text || '', pub, o.pinned || 0, req.user.id, t, t, pub ? t : null).lastInsertRowid);
    audit(req.admin.username, 'blog_create', o.title);
    send(res, 201, { id });
  });
  PATCH('/api/admin/blog/:id', perm, jsonBody, (req, res) => {
    const p = db.prepare('SELECT * FROM blog_posts WHERE id = ?').get(Number(req.params.id));
    if (!p) return fail(res, 404, 'Beitrag nicht gefunden');
    const o = fields(req.body, p);
    if ('title' in o && o.title.length < 3) return fail(res, 400, 'Titel fehlt (mindestens 3 Zeichen)');
    if (req.body.cta_url && !o.cta_url) return fail(res, 400, 'Link muss mit https:// beginnen');
    const keys = Object.keys(o);
    if (!keys.length) return fail(res, 400, 'Nichts zu ändern');
    const sets = keys.map((k) => `${k} = ?`); const args = keys.map((k) => o[k]);
    if (o.published === 1 && !p.published_at) { sets.push('published_at = ?'); args.push(now()); }
    sets.push('updated_at = ?'); args.push(now());
    db.prepare(`UPDATE blog_posts SET ${sets.join(', ')} WHERE id = ?`).run(...args, p.id);
    audit(req.admin.username, 'blog_update', p.title + (o.published !== undefined ? (o.published ? ' (veröffentlicht)' : ' (zurückgezogen)') : ''));
    send(res, 200, { ok: true });
  });
  DEL('/api/admin/blog/:id', perm, (req, res) => {
    const p = db.prepare('SELECT * FROM blog_posts WHERE id = ?').get(Number(req.params.id));
    if (!p) return fail(res, 404, 'Beitrag nicht gefunden');
    db.prepare('DELETE FROM blog_posts WHERE id = ?').run(p.id);
    audit(req.admin.username, 'blog_delete', p.title);
    send(res, 200, { ok: true });
  });
  return {};
};
