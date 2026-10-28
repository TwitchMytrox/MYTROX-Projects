/* Gemeinsame Kopf- und Fußzeile für serverseitig gerenderte Seiten (Blog, Rechtstexte).
   Das Gegenstück für statische Seiten ist public/js/chrome.js – beide erzeugen dasselbe Markup. */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NAV = [['forum', '/forum', 'Forum'], ['blog', '/blog', 'Blog'], ['turniere', '/turniere/', 'Turniere']];
const GAMES = [['/spiele/#blackjack', '🃏 Blackjack'], ['/spiele/#slots', '🎰 Slots'], ['/spiele/#roulette', '🎡 Roulette'], ['/spiele/#reaction', '⚡ Reaktionstest'], ['/spiele/#memory', '🧠 Memory'], ['/spiele/#snake', '🐍 Snake'], ['/spiele/#board', '🏆 Bestenliste']];
const FOOT = NAV.concat([['spiele', '/spiele/', 'Spiele'], ['support', '/support/', 'Support']]);
const LEGAL = [['/impressum', 'Impressum'], ['/datenschutz', 'Datenschutz'], ['/agb', 'Nutzungsbedingungen (AGB)'], ['/regeln', 'Regeln'], ['/cookies', 'Cookies'], ['/barrierefreiheit', 'Barrierefreiheit']];

function header(site, active) {
  return `<header class="site-head"><div class="sh-in"><a class="sh-logo" href="/"><span class="sh-mark" aria-hidden="true">◢◣</span><span>${esc(site)}</span></a>`
    + `<button class="sh-burger" type="button" aria-expanded="false" aria-controls="shNav" aria-label="Menü öffnen"><span aria-hidden="true">☰</span></button>`
    + `<nav id="shNav" class="sh-nav" aria-label="Hauptnavigation">${NAV.map(([k, h, l]) => `<a href="${h}"${k === active ? ' aria-current="page"' : ''}>${l}</a>`).join('')}`
    + `<div class="sh-dd"><button class="sh-dd-btn" type="button" aria-expanded="false" aria-controls="shGames"${active === 'spiele' ? ' aria-current="page"' : ''}>🎮 Spiele <span aria-hidden="true">▾</span></button>`
    + `<ul id="shGames" class="sh-menu" hidden><li><a href="/spiele/">Alle Spiele</a></li>${GAMES.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ul></div></nav>`
    + `<div class="sh-acc"><a class="sh-btn" href="/auth/" data-acc>Anmelden</a></div></div></header>`;
}
function footer(site, active) {
  const year = new Date().getFullYear();
  return `<footer class="site-foot"><div class="sf-in"><div class="sf-brand"><a class="sh-logo" href="/"><span class="sh-mark" aria-hidden="true">◢◣</span><span>${esc(site)}</span></a><p>Anonym diskutieren, zocken, aufsteigen – nur mit deinem Benutzernamen.</p></div>`
    + `<nav aria-label="Entdecken"><h2>Entdecken</h2><ul>${FOOT.map(([k, h, l]) => `<li><a href="${h}">${l}</a></li>`).join('')}<li><a href="/auth/">Anmelden / Registrieren</a></li></ul></nav>`
    + `<nav aria-label="Rechtliches"><h2>Rechtliches</h2><ul>${LEGAL.map(([h, l]) => `<li><a href="${h}"${h === active ? ' aria-current="page"' : ''}>${l}</a></li>`).join('')}</ul></nav>`
    + `<p class="sf-bottom">© ${year} ${esc(site)} · Eine Community von Gamern für Gamer</p></div></footer>`;
}
module.exports = { header, footer, NAV, GAMES, LEGAL };
