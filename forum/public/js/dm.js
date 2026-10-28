/* turkac.org – Direktnachrichten & „Als Nachricht teilen“ */
window.NXDmFactory = (NX) => {
  'use strict';
  const { el, api, toast, modal } = NX;
  const ago = (ts) => { const s = (Date.now() - ts) / 1000; return s < 60 ? 'gerade eben' : s < 3600 ? Math.floor(s / 60) + ' Min.' : s < 86400 ? Math.floor(s / 3600) + ' Std.' : new Date(ts).toLocaleDateString('de-DE'); };
  const ava = (u, n = 32) => (u.avatar ? el('img', { class: 'avatar av-img', src: u.avatar, alt: '', width: n, height: n }) : NX.avatar(u.username, n));
  const who = (u) => [ava(u), el('span', {}, u.rank ? u.rank.icon + ' ' : '', u.username)];
  const put = (node, ...kids) => node.replaceChildren(...kids.flat().filter(Boolean));
  let unread = 0, timer = null;

  function paintBadge() {
    const b = document.getElementById('dmBadge');
    if (b) { b.textContent = unread > 99 ? '99+' : String(unread); b.hidden = !unread; }
  }
  async function poll() {
    if (!NX.me()) return;
    try { const d = await api('/api/dm/unread'); if (d.unread > unread && document.hidden === false) NX.sfx && NX.sfx.ok(); unread = d.unread; paintBadge(); } catch { /* egal */ }
  }
  function start() { clearInterval(timer); if (NX.me()) { poll(); timer = setInterval(poll, 30000); } }

  // ---- Postfach ----
  async function open(withName) {
    if (!NX.me()) return NX.needLogin();
    const list = el('div', { class: 'dm-list' }), pane = el('div', { class: 'dm-pane' }, el('p', { class: 'hint' }, 'Wähle links ein Gespräch oder starte ein neues.'));
    const root = el('div', { class: 'dm' }, list, pane);
    const m = modal('✉️ Nachrichten', root);
    let cur = null, poller = null;
    const stop = () => clearInterval(poller);
    const orig = m.close; m.close = () => { stop(); orig(); poll(); };

    async function loadList() {
      let d; try { d = await api('/api/dm'); } catch (e) { put(list, el('p', { class: 'hint' }, e.message)); return; }
      const nu = el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => newChat() }, '＋ Neue Nachricht');
      put(list, nu, ...(d.conversations.length ? d.conversations.map((c) => el('button', { class: 'dm-item' + (cur === c.user.username ? ' on' : ''), type: 'button', onclick: () => c.user.deleted || openChat(c.user.username) },
        ava(c.user, 34), el('div', { class: 'dm-meta' }, el('b', {}, c.user.username, c.unread ? el('span', { class: 'badge-n' }, String(c.unread)) : null), el('span', { class: 'hint' }, (c.mine ? 'Du: ' : '') + c.preview)))) : [el('p', { class: 'hint' }, 'Noch keine Gespräche.')]),
      d.blocked.length ? el('details', { class: 'small' }, el('summary', {}, `Blockiert (${d.blocked.length})`), ...d.blocked.map((n) => el('div', {}, n, ' ', el('button', { class: 'linklike', type: 'button', onclick: async () => { await api('/api/dm/block/' + encodeURIComponent(n), { method: 'DELETE' }); loadList(); } }, 'aufheben')))) : null);
    }
    function newChat() {
      const q = el('input', { type: 'search', placeholder: 'Benutzernamen suchen …', maxlength: '20', autocomplete: 'off' }), res = el('div', { class: 'dm-results' });
      const draw = async () => {
        try {
          const d = await api('/api/dm/users?q=' + encodeURIComponent(q.value));
          const items = q.value.length >= 2 ? d.found : d.recent;
          put(res, el('div', { class: 'hint' }, q.value.length >= 2 ? 'Treffer' : 'Zuletzt'), ...items.map((u) => el('button', { class: 'dm-item', type: 'button', onclick: () => openChat(u.username) }, ...who(u))), items.length ? null : el('p', { class: 'hint' }, 'Nichts gefunden.'));
        } catch (e) { put(res, el('p', { class: 'hint' }, e.message)); }
      };
      let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 250); });
      put(pane, el('div', { class: 'field' }, el('label', {}, 'An'), q), res); draw(); q.focus();
    }
    async function openChat(name) {
      cur = name; stop();
      const thread = el('div', { class: 'dm-thread', 'aria-live': 'polite' });
      const input = el('textarea', { maxlength: '2000', placeholder: 'Nachricht schreiben …', rows: '2' });
      const send = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Senden');
      const head = el('div', { class: 'dm-head' });
      put(pane, head, thread, el('div', { class: 'dm-compose' }, input, send));
      let last = '';
      const load = async (force) => {
        let d; try { d = await api('/api/dm/' + encodeURIComponent(name)); } catch (e) { put(thread, el('p', { class: 'hint' }, e.message)); return; }
        const sig = d.messages.length + ':' + (d.messages.at(-1) || {}).id; if (sig === last && !force) return; last = sig;
        put(head, ...who(d.user), el('button', { class: 'linklike', type: 'button', style: 'margin-left:auto', onclick: async () => { if (d.blocked) await api('/api/dm/block/' + encodeURIComponent(name), { method: 'DELETE' }); else await api('/api/dm/block', { method: 'POST', json: { name } }); toast(d.blocked ? 'Block aufgehoben' : 'Blockiert'); load(true); } }, d.blocked ? 'Block aufheben' : '🚫 Blockieren'));
        put(thread, ...d.messages.map((x) => el('div', { class: 'dm-msg' + (x.mine ? ' mine' : '') },
          x.share ? (x.share.gone ? el('div', { class: 'dm-share gone' }, '🔗 Beitrag nicht mehr verfügbar') : el('a', { class: 'dm-share', href: '/forum#/t/' + x.share.thread_id, onclick: () => m.close() }, '🔗 ', x.share.type === 'thread' ? 'Thread: ' : 'Kommentar: ', x.share.title)) : null,
          x.text ? el('div', { class: 'dm-text' }, x.text) : null, el('span', { class: 'hint' }, ago(x.created_at)))));
        thread.scrollTop = thread.scrollHeight; loadList();
      };
      const doSend = async () => {
        const body = input.value.trim(); if (!body) return;
        send.disabled = true;
        try { await api('/api/dm/' + encodeURIComponent(name), { method: 'POST', json: { body } }); input.value = ''; await load(true); } catch (e) { toast(e.message, 'err'); }
        send.disabled = false;
      };
      send.onclick = doSend; input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doSend(); });
      await load(true); input.focus();
      poller = setInterval(() => load(false), 8000);
    }
    await loadList();
    if (withName) openChat(withName);
  }

  // ---- Teilen als Nachricht ----
  function share(type, id) {
    if (!NX.me()) return NX.needLogin('Zum Senden von Nachrichten brauchst du ein anonymes Konto.');
    const q = el('input', { type: 'search', placeholder: 'Benutzername suchen …', maxlength: '20', autocomplete: 'off' }), res = el('div', { class: 'dm-results' });
    const note = el('input', { type: 'text', maxlength: '300', placeholder: 'Nachricht dazu (optional)' });
    const m = modal('✉️ Als Nachricht senden', el('div', { class: 'field' }, el('label', {}, 'An'), q, res, el('label', {}, 'Notiz'), note));
    const draw = async () => {
      try {
        const d = await api('/api/dm/users?q=' + encodeURIComponent(q.value));
        const items = q.value.length >= 2 ? d.found : d.recent;
        put(res, el('div', { class: 'hint' }, q.value.length >= 2 ? 'Treffer' : 'Zuletzt geschrieben'), ...items.map((u) => el('button', { class: 'dm-item', type: 'button', onclick: async () => {
          try { await api('/api/dm/share', { method: 'POST', json: { to: u.username, type, id, note: note.value } }); toast(`Gesendet an ${u.username} ✉️`); m.close(); } catch (e) { toast(e.message, 'err'); }
        } }, ...who(u))), items.length ? null : el('p', { class: 'hint' }, q.value.length >= 2 ? 'Nichts gefunden.' : 'Tippe mindestens 2 Buchstaben.'));
      } catch (e) { put(res, el('p', { class: 'hint' }, e.message)); }
    };
    let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 250); });
    draw(); q.focus();
  }
  return { open, share, start, paintBadge };
};
