/* turkac.org – Support: Tickets erstellen, ansehen, zurückziehen */
(() => {
  'use strict';
  const app = document.getElementById('app');
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
    let r;
    try { r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); }
    catch { throw new Error('Keine Verbindung zum Server.'); }
    let d = {}; try { d = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(d.error || 'Fehler ' + r.status); e.status = r.status; throw e; }
    return d;
  }
  const fmt = (t) => new Date(t).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  const alertBox = (msg, kind = 'err') => el('p', { class: 'alert ' + kind, role: kind === 'err' ? 'alert' : 'status' }, msg);
  let cats = [];

  function mount(...nodes) {
    app.replaceChildren(...nodes);
    const h = app.querySelector('h1'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }

  async function list() {
    let d;
    try { d = await api('GET', '/api/support/tickets'); }
    catch (e) {
      if (e.status === 401) return mount(el('section', { class: 'sup-card' }, el('h1', {}, 'Support'), el('p', { class: 'lead' }, 'Für Support-Anfragen brauchst du ein Konto.'), el('div', { class: 'btn-row' }, el('a', { class: 'btn', href: '/auth/?next=/support/' }, 'Anmelden oder registrieren'))));
      return mount(alertBox(e.message));
    }
    document.title = 'Support – turkac.org';
    mount(
      el('section', { class: 'sup-card' }, el('h1', {}, 'Support'), el('p', { class: 'lead' }, 'Wir helfen dir bei Fragen zu Konto, Profil, Technik oder Verwarnungen. Antworten findest du hier.'),
        el('div', { class: 'btn-row' }, el('button', { class: 'sbtn', type: 'button', onclick: () => form() }, '＋ Neues Ticket'))),
      el('section', { class: 'sup-card', 'aria-labelledby': 'mt' }, el('h2', { id: 'mt' }, 'Meine Tickets'),
        d.tickets.length ? el('ul', { class: 't-list' }, d.tickets.map((t) => el('li', {}, el('a', { class: 't-item', href: '#' + t.id, onclick: (ev) => { ev.preventDefault(); open(t.id); } },
          el('strong', {}, t.unread ? el('span', { class: 'dot', title: 'Neue Antwort' }) : false, t.subject, t.unread ? el('span', { class: 'sr-only' }, ' (neue Antwort)') : false),
          el('span', { class: 'badge s-' + t.status }, t.status_label),
          el('span', { class: 'sub' }, `${t.id} · ${catLabel(t.category)} · ${fmt(t.updated_at)}`))))) : el('p', { class: 'muted' }, 'Du hast noch keine Tickets.')));
  }
  const catLabel = (k) => (cats.find((c) => c.key === k) || {}).label || k;

  function form() {
    const err = el('div'); const sel = el('select', { id: 'f-cat', required: true }, el('option', { value: '' }, '– bitte wählen –'), cats.map((c) => el('option', { value: c.key }, c.label)));
    const sub = el('input', { type: 'text', id: 'f-sub', maxlength: '120', required: true, autocomplete: 'off' });
    const body = el('textarea', { id: 'f-body', maxlength: '4000', required: true });
    const cnt = el('div', { class: 'count', 'aria-hidden': 'true' }, '0 / 4000'); body.addEventListener('input', () => { cnt.textContent = body.value.length + ' / 4000'; });
    const btn = el('button', { class: 'sbtn', type: 'submit' }, 'Ticket absenden');
    const f = el('form', { novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault(); err.replaceChildren();
      btn.disabled = true;
      try { const r = await api('POST', '/api/support/tickets', { category: sel.value, subject: sub.value, body: body.value }); await open(r.id, 'Dein Ticket wurde gesendet. Wir melden uns hier.'); }
      catch (e) { err.replaceChildren(alertBox(e.message)); err.firstChild.focus?.(); btn.disabled = false; }
    } },
      err, el('label', { for: 'f-cat' }, 'Worum geht es?'), sel, el('label', { for: 'f-sub' }, 'Betreff'), sub, el('label', { for: 'f-body' }, 'Beschreibung'), body, cnt,
      el('p', { class: 'muted' }, 'Bitte keine Passwörter oder Wiederherstellungscodes angeben – wir fragen nie danach.'),
      el('div', { class: 'btn-row' }, btn, el('button', { class: 'sbtn', type: 'button', onclick: list }, 'Abbrechen')));
    mount(el('section', { class: 'sup-card' }, el('h1', {}, 'Neues Ticket'), f));
    document.title = 'Neues Ticket – turkac.org';
  }

  async function open(id, note) {
    let d;
    try { d = await api('GET', '/api/support/tickets/' + encodeURIComponent(id)); } catch (e) { return mount(alertBox(e.message), el('p', {}, el('button', { class: 'sbtn', onclick: list }, 'Zurück'))); }
    const t = d.ticket, err = el('div'), done = t.status === 'closed' || t.status === 'withdrawn';
    const act = async (path, okMsg) => { try { await api('POST', `/api/support/tickets/${id}/${path}`); await open(id, okMsg); } catch (e) { err.replaceChildren(alertBox(e.message)); } };
    const reply = el('textarea', { id: 'r-body', maxlength: '4000', 'aria-label': 'Deine Antwort' });
    const rf = el('form', { novalidate: true, onsubmit: async (ev) => { ev.preventDefault(); if (reply.value.trim().length < 2) return; try { await api('POST', `/api/support/tickets/${id}/reply`, { body: reply.value }); await open(id, 'Antwort gesendet.'); } catch (e) { err.replaceChildren(alertBox(e.message)); } } },
      el('label', { for: 'r-body' }, t.status === 'closed' ? 'Weiter nachfragen (öffnet das Ticket wieder)' : 'Antworten'), reply, el('div', { class: 'btn-row' }, el('button', { class: 'sbtn', type: 'submit' }, 'Senden')));
    mount(el('section', { class: 'sup-card' },
      el('p', {}, el('button', { class: 'sbtn', type: 'button', onclick: list }, '← Alle Tickets')),
      note ? alertBox(note, 'okk') : false, err,
      el('h1', {}, t.subject), el('p', { class: 'muted' }, `${t.id} · ${catLabel(t.category)} · erstellt ${fmt(t.created_at)} · `, el('span', { class: 'badge s-' + t.status }, t.status_label)),
      el('div', { class: 'msgs', role: 'log', 'aria-label': 'Verlauf' }, d.messages.map((m) => el('div', { class: 'msg' + (m.staff ? ' staff' : '') }, el('div', { class: 'who' }, `${m.staff ? 'Support-Team' : 'Du'} · ${fmt(m.created_at)}`), el('div', { class: 'txt' }, m.body)))),
      t.status === 'withdrawn' ? el('p', { class: 'muted' }, 'Du hast dieses Ticket zurückgezogen. Das Team bearbeitet es nicht weiter.') : rf,
      el('div', { class: 'btn-row' },
        t.status === 'withdrawn' ? el('button', { class: 'sbtn', type: 'button', onclick: () => act('reactivate', 'Ticket wieder aktiviert.') }, 'Wieder aktivieren') : false,
        !done ? el('button', { class: 'sbtn', type: 'button', onclick: () => act('close', 'Als erledigt geschlossen.') }, 'Ist erledigt – schließen') : false,
        !done ? el('button', { class: 'sbtn', type: 'button', onclick: () => { if (confirm('Ticket wirklich zurückziehen?')) act('withdraw', 'Ticket zurückgezogen.'); } }, 'Zurückziehen') : false)));
    document.title = t.id + ' – Support – turkac.org';
  }

  (async () => {
    try { cats = (await api('GET', '/api/support/categories')).categories; } catch {}
    list();
  })();
})();
