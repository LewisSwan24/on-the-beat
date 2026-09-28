// ON THE BEAT — the staff page's line to the relay (docs/superpowers/specs/2026-09-28-staff-reports-design.md §3).
//
// As the phone's (app/lib/net.js), a socket can die without closing: the page asks every two seconds and takes
// six of silence as a dead socket. Every time a socket opens, `onOpen` signs in again with tonight's token.

const PING_EVERY = 2000;
const DEAF_MS = 6000;

export function connectStaff({ onOpen, onMessage, onStatus }) {
  let ws = null;
  let heard = 0;
  let closed = false;
  let retry = null;
  let backoff = 500;
  const isOpen = () => ws && ws.readyState === 1;
  const send = (m) => {
    if (!isOpen()) return false;
    ws.send(JSON.stringify(m));
    return true;
  };

  function open() {
    clearTimeout(retry);
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const sock = new WebSocket(proto + location.host + '/api/ws');
    ws = sock;
    onStatus?.('connecting');
    sock.onopen = () => {
      if (ws !== sock) return;
      heard = Date.now();
      backoff = 500;
      onStatus?.('live');
      onOpen?.();
    };
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      heard = Date.now();
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t !== 'pong') onMessage?.(m);
    };
    sock.onclose = () => { if (ws === sock) again(); };
    sock.onerror = () => {};
  }

  function again() {
    if (closed) return;
    const old = ws;
    ws = null;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try { old.close(); } catch { /* already gone */ }
    }
    onStatus?.('offline');
    retry = setTimeout(open, backoff);
    backoff = Math.min(backoff * 2, 5000);
  }

  const beat = setInterval(() => {
    if (!isOpen()) return;
    if (Date.now() - heard > DEAF_MS) { again(); return; }
    send({ t: 'ping' });
  }, PING_EVERY);
  const onOnline = () => { if (!isOpen()) { clearTimeout(retry); backoff = 500; open(); } };
  window.addEventListener('online', onOnline);
  open();

  return {
    /** Sent now, or false with no live socket: a sign-in or a mark is never queued. */
    send,
    close() {
      closed = true;
      clearInterval(beat);
      clearTimeout(retry);
      window.removeEventListener('online', onOnline);
      const old = ws;
      ws = null;
      if (old) { old.onclose = null; try { old.close(); } catch { /* gone */ } }
    },
  };
}
