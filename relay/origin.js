// ON THE BEAT — which pages may open the relay's socket
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §5).

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether a WebSocket handshake may go on, from its Origin header and the Host it was made to. A browser sets
 * Origin and a page cannot change it, so this keeps another site's page from sending its visitors' browsers to the
 * relay, from their own addresses. What sets no Origin (a script, a test, a tool) is let through: it was never
 * stopped by this, and the limits are for it. The wristband's WebSocket library sends `file://`; the dev server
 * talks to the relay from loopback.
 */
export function originAllowed(origin, host) {
  if (origin === undefined || origin === 'file://') return true;
  let url;
  try { url = new URL(origin); } catch { return false; }   // 'null', and anything else that is not an origin
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.host === String(host ?? '').toLowerCase() || LOOPBACK.has(url.hostname);
}
