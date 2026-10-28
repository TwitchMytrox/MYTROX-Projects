/* turkac.org – Turniere & Lostopf */
(() => {
  'use strict';
  const app = document.getElementById('app');
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v === false || v == null) continue; if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat()) if (c !== false && c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  async function api(method, url, body) {
    let r; try { r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); } catch { throw new Error('Keine Verbindung zum Server.'); }
    let d = {}; try { d = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(d.error || 'Fehler ' + r.status); e.status = r.status; throw e; } return d;
  }
  const fmt = (t) => new Date(t).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  const n = (x) => Number(x).toLocaleString('de-DE');
  const alertBox = (m, k = 'err') => el('p', { class: 'alert ' + k, role: k === 'err' ? 'alert' : 'status' }, m);
  let timer = null, me = false;
  const mount = (...nodes) => { clearInterval(timer); app.replaceChildren(...nodes); const h = app.querySelector('h1'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } };
  const route = () => { const id = location.hash.slice(1); id.startsWith('TN-') ? detail(id) : home(); };
  window.addEventListener('hashchange', route);

  async function home() {
    let d, lot;
    try { [d, lot] = await Promise.all([api('GET', '/api/tournaments'), api('GET', '/api/lottery')]); } catch (e) { return mount(alertBox(e.message)); }
    me = d.credits != null; document.title = 'Turniere – turkac.org';
    const card = (t) => el('a', { class: 'tn-card', href: '#' + t.id }, el('h3', {}, t.title), el('span', { class: 'badge s-' + (t.status === 'open' ? 'open' : t.status === 'running' ? 'in_progress' : 'closed') }, t.status_label),
      el('span', { class: 'muted' }, `${t.game} · ${fmt(t.starts_at)}`), el('span', { class: 'muted' }, `${t.count}/${t.max_players} Teilnehmer · 🏆 ${n(t.prize.first)}`));
    const lotBtn = el('button', { class: 'sbtn', type: 'button', disabled: lot.mine || !me, onclick: async () => { try { await api('POST', '/api/lottery/ticket'); home(); } catch (e) { alert(e.message); } } }, lot.mine ? 'Du bist dabei ✓' : `Los kaufen (${n(lot.price)} Credits)`);
    mount(
      el('section', { class: 'sup-card' }, el('h1', {}, 'Turniere'), el('p', { class: 'lead' }, 'Spiele mit, steige auf – oder eröffne selbst ein Turnier.'),
        me ? el('p', {}, `Dein Guthaben: `, el('strong', {}, n(d.credits) + ' Credits')) : el('p', {}, el('a', { href: '/auth/?next=/turniere/' }, 'Anmelden'), ' zum Mitmachen.'),
        me && el('div', { class: 'btn-row' }, el('button', { class: 'sbtn', type: 'button', onclick: () => createForm(d.config) }, '＋ Turnier eröffnen'))),
      d.mine.length ? el('section', { class: 'sup-card' }, el('h2', {}, 'Meine Einreichungen'), el('div', { class: 'tn-grid' }, d.mine.map(card))) : false,
      el('section', { class: 'sup-card' }, el('h2', {}, 'Aktuelle Turniere'), d.rows.length ? el('div', { class: 'tn-grid' }, d.rows.map(card)) : el('p', { class: 'muted' }, 'Noch keine Turniere.')),
      el('section', { class: 'sup-card' }, el('h2', {}, '🎟️ Wochen-Lostopf'), el('p', {}, `Im Topf: `, el('strong', {}, n(lot.pot) + ' Credits'), ` · ${lot.tickets} Lose diese Woche`), el('p', { class: 'muted' }, lot.rule + (lot.last ? ` Zuletzt gewonnen: ${lot.last.winner} (${n(lot.last.amount)}).` : '')), lotBtn));
  }

  function createForm(cfg) {
    const err = el('div'), v = {};
    const f = (id, label, node) => { v[id] = node; node.id = 'c-' + id; return [el('label', { for: 'c-' + id }, label), node]; };
    const soon = new Date(Date.now() + 2 * 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const btn = el('button', { class: 'sbtn', type: 'submit' }, 'Zur Prüfung einreichen');
    const form = el('form', { novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault(); err.replaceChildren(); btn.disabled = true;
      try { const r = await api('POST', '/api/tournaments', { title: v.title.value, game: v.game.value, description: v.description.value, goals: v.goals.value, starts_at: new Date(v.starts.value).getTime(), max_players: Number(v.max.value) }); location.hash = ''; await home(); app.prepend(alertBox(`Eingereicht (${r.id}). Der Support prüft dein Turnier – Rückfragen kommen als Ticket ${r.ticket}.`, 'okk')); }
      catch (e) { err.replaceChildren(alertBox(e.message)); btn.disabled = false; }
    } }, err,
      f('title', 'Titel', el('input', { type: 'text', maxlength: '80' })), f('game', 'Spiel', el('input', { type: 'text', maxlength: '60' })),
      f('description', 'Beschreibung & Regeln', el('textarea', { maxlength: '2000' })), f('goals', 'Ziele / Wertung (z. B. „meiste Siege“)', el('textarea', { maxlength: '1000', style: 'min-height:80px' })),
      f('starts', 'Start', el('input', { type: 'datetime-local', value: soon })), f('max', 'Maximale Teilnehmer', el('input', { type: 'number', min: '2', max: '500', value: '32' })),
      el('p', { class: 'muted' }, `Einsatz: ${n(cfg.cost)} Credits, liegen bis zur Entscheidung in Treuhand. Davon ${n(cfg.fee)} Gebühr, Preise ${cfg.prizes.map(n).join(' / ')} und ${n(cfg.lottery)} für den Lostopf. Lehnt der Support ab oder ziehst du zurück, bekommst du alles zurück.`),
      el('div', { class: 'btn-row' }, btn, el('button', { class: 'sbtn', type: 'button', onclick: home }, 'Abbrechen')));
    mount(el('section', { class: 'sup-card' }, el('h1', {}, 'Turnier eröffnen'), form));
  }

  async function detail(id) {
    let d; try { d = (await api('GET', '/api/tournaments/' + id)).tournament; } catch (e) { return mount(alertBox(e.message), el('button', { class: 'sbtn', onclick: () => { location.hash = ''; } }, 'Zurück')); }
    document.title = d.title + ' – turkac.org';
    const err = el('div'); const act = (path, body, msg) => async () => { try { await api('POST', `/api/tournaments/${id}/${path}`, body); detail(id); } catch (e) { err.replaceChildren(alertBox(e.message)); } };
    const pts = new Map();
    const table = el('table', { class: 'tn-table' }, el('caption', { class: 'sr-only' }, 'Tabelle'),
      el('thead', {}, el('tr', {}, el('th', {}, 'Platz'), el('th', {}, 'Name'), el('th', { class: 'num' }, 'Punkte'))),
      el('tbody', {}, d.players.map((p) => { let cell = p.points; if (d.is_organizer && d.status === 'running') { const i = el('input', { type: 'number', min: '0', value: p.points, 'aria-label': 'Punkte ' + p.username }); pts.set(p.id, i); cell = [i, ' ', el('button', { class: 'sbtn', type: 'button', onclick: async () => { try { await api('PATCH', `/api/tournaments/${id}/points`, { user_id: p.id, points: Number(i.value) }); detail(id); } catch (e) { err.replaceChildren(alertBox(e.message)); } } }, 'OK')]; } return el('tr', {}, el('td', {}, '#' + p.rank), el('td', {}, p.username), el('td', { class: 'num' }, cell)); })));
    const btns = [];
    if (!d.is_organizer && me && d.status === 'open') btns.push(d.joined ? el('button', { class: 'sbtn', onclick: act('leave') }, 'Abmelden') : el('button', { class: 'sbtn', onclick: act('join') }, 'Jetzt mitmachen'));
    if (d.is_organizer) {
      if (d.status === 'open') btns.push(el('button', { class: 'sbtn', onclick: act('start') }, 'Turnier starten'));
      if (['review', 'open'].includes(d.status)) btns.push(el('button', { class: 'sbtn', onclick: () => { if (confirm('Zurückziehen? Du bekommst deinen Einsatz zurück.')) act('withdraw')(); } }, 'Zurückziehen'));
    }
    let finish = false;
    if (d.is_organizer && d.status === 'running') {
      const sel = (lab, req) => { const s = el('select', { 'aria-label': lab }, el('option', { value: '' }, req ? '– bitte wählen –' : '– keiner –'), d.players.map((p) => el('option', { value: p.id }, p.username))); return s; };
      const a = sel('1. Platz', true), b = sel('2. Platz'), c = sel('3. Platz'), url = el('input', { type: 'url', placeholder: 'https://… (Video/Screenshots)', 'aria-label': 'Beweis-Link' }), note = el('textarea', { 'aria-label': 'Beschreibung des Ergebnisses', placeholder: 'Kurz beschreiben, wie das Ergebnis zustande kam', style: 'min-height:80px' });
      finish = el('details', {}, el('summary', {}, 'Turnier beenden & Gewinner melden'), el('p', { class: 'muted' }, 'Ein Teammitglied prüft den Beweis und bestätigt die Auszahlung.'), a, b, c, url, note, el('div', { class: 'btn-row' }, el('button', { class: 'sbtn', onclick: act('finish', null) }, '')));
      finish.querySelector('button').replaceWith(el('button', { class: 'sbtn', type: 'button', onclick: async () => { try { await api('POST', `/api/tournaments/${id}/finish`, { first: a.value, second: b.value, third: c.value, proof_url: url.value, proof_note: note.value }); detail(id); } catch (e) { err.replaceChildren(alertBox(e.message)); } } }, 'Gewinner melden'));
    }
    mount(el('section', { class: 'sup-card' }, el('p', {}, el('button', { class: 'sbtn', type: 'button', onclick: () => { location.hash = ''; } }, '← Alle Turniere')), err,
      el('h1', {}, d.title), el('p', { class: 'muted' }, `${d.game} · Start ${fmt(d.starts_at)} · von ${d.organizer} · `, el('span', { class: 'badge s-open' }, d.status_label)),
      d.review_note && d.is_organizer ? alertBox('Hinweis vom Team: ' + d.review_note, 'warn') : false,
      el('div', { class: 'tn-prize', 'aria-label': 'Preise' }, el('span', {}, '🥇 ' + n(d.prize.first)), el('span', {}, '🥈 ' + n(d.prize.second)), el('span', {}, '🥉 ' + n(d.prize.third))),
      el('p', { style: 'white-space:pre-wrap' }, d.description), d.goals ? el('p', {}, el('strong', {}, 'Ziele: '), d.goals) : false,
      el('h2', {}, `Teilnehmer (${d.count}/${d.max_players})`, d.status === 'running' ? el('span', { class: 'tn-live' }, ' ● live') : ''), d.count ? table : el('p', { class: 'muted' }, 'Noch niemand angemeldet.'),
      d.winners ? el('p', {}, '🏆 ', d.winners.map((w) => `${w.place}. ${w.username}`).join(' · ')) : false,
      d.status === 'finished' && d.proof_url ? el('p', {}, el('a', { href: d.proof_url, rel: 'noopener noreferrer nofollow' }, 'Beweis ansehen')) : false,
      el('div', { class: 'btn-row' }, btns), finish));
    if (['open', 'running', 'proof'].includes(d.status) && !d.is_organizer) timer = setInterval(async () => { if (document.hidden) return; try { const x = (await api('GET', '/api/tournaments/' + id)).tournament; if (x.updated_at !== d.updated_at || x.count !== d.count) detail(id); } catch {} }, 10000);
  }
  api('GET', '/api/support/unread').then(() => { me = true; }, () => { me = false; }).finally(route);
})();
