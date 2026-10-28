/* Browser-Seite für Sicherheitsschlüssel (WebAuthn). Gibt JSON zurück, das der Server versteht. */
window.NXWebAuthn = (() => {
  const b2u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const u2b = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(s).length / 4) * 4, '=')), (c) => c.charCodeAt(0)).buffer;
  const supported = () => !!(window.PublicKeyCredential && navigator.credentials);
  const nice = (e) => (e && e.name === 'NotAllowedError' ? 'Abgebrochen oder Zeit abgelaufen' : e && e.name === 'InvalidStateError' ? 'Dieser Schlüssel ist schon registriert' : (e && e.message) || 'Sicherheitsschlüssel-Fehler');
  async function create(pk) {
    const opts = { ...pk, challenge: u2b(pk.challenge), user: { ...pk.user, id: u2b(pk.user.id) }, excludeCredentials: (pk.excludeCredentials || []).map((c) => ({ ...c, id: u2b(c.id) })) };
    try {
      const c = await navigator.credentials.create({ publicKey: opts });
      return { id: c.id, clientDataJSON: b2u(c.response.clientDataJSON), attestationObject: b2u(c.response.attestationObject) };
    } catch (e) { throw new Error(nice(e)); }
  }
  async function get(pk) {
    const opts = { ...pk, challenge: u2b(pk.challenge), allowCredentials: (pk.allowCredentials || []).map((c) => ({ ...c, id: u2b(c.id) })) };
    try {
      const c = await navigator.credentials.get({ publicKey: opts });
      return { id: c.id, clientDataJSON: b2u(c.response.clientDataJSON), authenticatorData: b2u(c.response.authenticatorData), signature: b2u(c.response.signature) };
    } catch (e) { throw new Error(nice(e)); }
  }
  return { supported, create, get };
})();
