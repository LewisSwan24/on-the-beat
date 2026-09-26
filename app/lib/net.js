// The phone's line to its room.
//
// The relay forgets everything when it restarts, and a person who has been
// gone longer than its grace period is taken out of the room. So on every
// join the phone says again who it is and what it is doing, and the room is
// rebuilt from the phones — but only as facts marked `again`, which the relay
// applies only when they are news to it and only when they hide the person
// (relay/room.js fromPhone(), rule 3). A page load says nothing new: what it
// holds is kept here and re-said, never queued.
//
// A socket can die without closing: it reads open, takes every send and
// fires nothing. So the phone asks every two seconds, and six seconds of
// hearing nothing at all is taken as death.

const PING_EVERY = 2000;
const DEAF_MS = 6000;
const QUEUE_MAX = 40;

/**
 * The order facts are re-said in. The sound switch first: it touches nothing in the room, and a wristband
 * claimed after a restart gets it in its first show. Then the claim, so the wristband's kept hold lands
 * before anything that changes the room.
 */
export const SAID_ORDER = ['sound', 'pair', 'invisible', 'profile', 'pick', 'arm', 'leave'];

export function connect({ venue, me, onView, onStatus, onMessage }) {
  let ws = null;
  let heard = 0;
  let closed = false;
  let retry = null;
  let backoff = 500;
  const queue = [];
  // What this phone is, re-said on every join.
  const said = Object.fromEntries(SAID_ORDER.map((k) => [k, null]));

  const status = (s) => onStatus?.(s);
  const raw = (m) => ws?.send(JSON.stringify(m));
  const isOpen = () => ws && ws.readyState === 1;

  function open() {
    clearTimeout(retry);
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const sock = new WebSocket(proto + location.host + '/api/ws');
    ws = sock;
    status('connecting');
    sock.onopen = () => {
      if (ws !== sock) return;
      heard = Date.now();
      backoff = 500;
      // NOT NOW rides on the join: it counts only if the join makes the person anew.
      raw({ t: 'join', venue, me, ...(said.invisible?.on ? { quiet: true } : {}) });
      for (const k of SAID_ORDER) if (said[k]) raw({ ...said[k], again: true });
      for (const m of queue.splice(0)) raw(m);
      status('live');
    };
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      heard = Date.now();
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'view') onView?.(m.view);
      else if (m.t !== 'pong') onMessage?.(m);
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
    status('offline');
    retry = setTimeout(open, backoff);
    backoff = Math.min(backoff * 2, 5000);
  }

  const beat = setInterval(() => {
    if (!isOpen()) return;
    if (Date.now() - heard > DEAF_MS) { again(); return; }
    raw({ t: 'ping' });
  }, PING_EVERY);

  const onOnline = () => { if (!isOpen()) { clearTimeout(retry); backoff = 500; open(); } };
  window.addEventListener('online', onOnline);

  open();

  return {
    /** Is there a live socket right now? Showing changes are only sent on one. */
    live: () => !!isOpen(),
    /** An action. Sent now, or kept and sent when the signal comes back. */
    send(m) {
      if (isOpen()) raw(m);
      else if (queue.length < QUEUE_MAX) queue.push(m);
    },
    /** A standing fact about this phone, sent now and re-said after every reconnect. */
    say(kind, m) {
      said[kind] = m;
      this.send(m);
    },
    /** A standing fact this phone already holds: not sent now, only re-said after a reconnect. */
    keep(kind, m) {
      said[kind] = m;
    },
    /** Stop saying it on reconnect. */
    forget(kind) {
      said[kind] = null;
    },
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
