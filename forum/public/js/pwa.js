/* Service Worker anmelden + „App installieren“-Angebot (nur wenn der Browser es anbietet) */
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
let deferred = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferred = e;
  const host = document.getElementById('userArea') || document.querySelector('.foot, .footer');
  if (!host || document.getElementById('installBtn')) return;
  const b = document.createElement('button'); b.id = 'installBtn'; b.type = 'button'; b.className = 'btn btn-ghost btn-sm'; b.textContent = '📲 App installieren';
  b.onclick = async () => { b.hidden = true; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; };
  host.prepend(b);
});
