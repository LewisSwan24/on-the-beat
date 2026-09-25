// ON THE BEAT — phones and wristbands on real sockets, for the relay's tests.
//
// Not a test file itself (node --test runs *.test.js): server.test.js,
// wristband.test.js and rules.test.js share it.

import { randomBytes } from 'node:crypto';
import { connect as tcp } from 'node:net';
import WebSocket from 'ws';
import { WS_PATH, bandIdOf } from '../relay/server.js';

export const newKey = () => randomBytes(16).toString('hex');
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Everything a test file needs, against the relay whose port `port()` gives. */
export function helpers(port) {
  // Every socket a test opens, so a failing test cannot leave one holding the run open.
  const clients = new Set();
  // Each phone its own address behind the tunnel, so the per-address limit only trips where a test means it to.
  let phones = 0;
  const address = () => 'ws://127.0.0.1:' + port() + WS_PATH;

  /** A phone: a socket, the last view it was pushed, and a way to wait for the next one that fits. */
  async function phone(venue, { band, ip = '198.51.100.' + (1 + (phones++ % 250)), quiet, me = randomBytes(16).toString('hex') } = {}) {
    const ws = new WebSocket(address(), ip ? { headers: { 'cf-connecting-ip': ip } } : undefined);
    clients.add(ws);
    const p = { ws, me, view: null, errors: [], sent: [], waiters: [] };
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.t === 'view') p.view = m.view;
      if (m.t === 'error') p.errors.push(m.why);
      if (m.t === 'sent') p.sent.push(m);
      p.waiters = p.waiters.filter((w) => !w());
    });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    p.send = (m) => ws.send(JSON.stringify(m));
    p.until = (pred, ms = 3000) => new Promise((resolve, reject) => {
      const check = () => { if (p.view && pred(p.view, p)) { clearTimeout(timer); resolve(p.view); return true; } return false; };
      const timer = setTimeout(() => reject(new Error('timed out; last view ' + JSON.stringify(p.view))), ms);
      if (!check()) p.waiters.push(check);
    });
    p.send({ t: 'join', venue, me, band, ...(quiet ? { quiet: true } : {}) });
    await p.until(() => true);
    return p;
  }

  /**
   * A wristband: a socket that says hello as the firmware does — its id, the
   * key that proves it, v2, and a secret when it has one — and remembers the
   * last show and the secret it is given.
   */
  async function wristband(battery = 62, { key = newKey(), secret = null, quiet = false, v1 = false } = {}) {
    const ws = new WebSocket(address());
    clients.add(ws);
    const id = v1 ? randomBytes(16).toString('hex') : bandIdOf(key);
    const b = { ws, id, key, secret, show: null, replies: [], waiters: [] };
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.t === 'show') b.show = m.show;
      if (m.t === 'paired') b.secret = m.secret;
      if (m.t === 'set' || m.t === 'wave' || m.t === 'error') b.replies.push(m);
      b.waiters = b.waiters.filter((w) => !w());
    });
    await new Promise((resolve) => ws.once('open', resolve));
    b.send = (m) => ws.send(JSON.stringify(m));
    b.until = (pred, ms = 3000) => new Promise((resolve, reject) => {
      const check = () => { if (b.show && pred(b.show, b)) { clearTimeout(timer); resolve(b.show); return true; } return false; };
      const timer = setTimeout(() => reject(new Error('band timed out; last show ' + JSON.stringify(b.show))), ms);
      if (!check()) b.waiters.push(check);
    });
    b.send(v1 ? { t: 'wristband', id, battery } : { t: 'wristband', id, key, v: 2, battery, ...(secret ? { secret } : {}), ...(quiet ? { quiet: true } : {}) });
    await b.until(() => true);
    return b;
  }

  /** A hello that may be refused: the first reply, and the close code if the relay closed the socket. */
  async function hello(m) {
    const ws = new WebSocket(address());
    clients.add(ws);
    await new Promise((resolve) => ws.once('open', resolve));
    const first = new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(String(d)))));
    const closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
    ws.send(JSON.stringify(m));
    return { ws, reply: await first, closed: await Promise.race([closed, pause(300).then(() => null)]) };
  }

  /** The next reply of a kind on a phone's socket. */
  const reply = (p, t, ms = 3000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { p.ws.off('message', on); reject(new Error('no ' + t + ' reply')); }, ms);
    const on = (data) => { const m = JSON.parse(String(data)); if (m.t === t) { clearTimeout(timer); p.ws.off('message', on); resolve(m); } };
    p.ws.on('message', on);
  });

  /** Pair a phone and a wristband all the way: the letters, the number on the wrist, YES. */
  async function pairBand(p, band) {
    p.send({ t: 'pair', code: band.show.code });
    const { me: { check } } = await p.until((v) => v.me.check);
    await band.until((s) => s.kind === 'check' && s.big === String(check));
    const paired = reply(p, 'paired');
    p.send({ t: 'confirm', yes: true });
    const m = await paired;
    await band.until((s, bb) => bb.secret === m.secret);
    return m;
  }

  /**
   * A socket that speaks WebSocket frames by hand and never reads what comes
   * back, so it never learns it was closed: a replaced wristband that is
   * still sending.
   */
  function rawSocket() {
    return new Promise((resolve, reject) => {
      const s = tcp(port(), '127.0.0.1');
      s.once('error', reject);
      let head = '';
      const onData = (d) => {
        head += d.toString('latin1');
        if (!head.includes('\r\n\r\n')) return;
        s.off('data', onData);
        s.on('data', () => {});   // everything after the handshake is ignored, the close frame too
        resolve({
          send(m) {
            const payload = Buffer.from(JSON.stringify(m));
            const mask = randomBytes(4);
            const len = payload.length < 126 ? [0x80 | payload.length] : [0x80 | 126, payload.length >> 8, payload.length & 255];
            s.write(Buffer.concat([Buffer.from([0x81, ...len]), mask, payload.map((x, i) => x ^ mask[i % 4])]));
          },
          end: () => s.destroy(),
        });
      };
      s.on('data', onData);
      s.write('GET ' + WS_PATH + ' HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
        + 'Sec-WebSocket-Key: ' + randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
  }

  const close = (...socks) => socks.forEach((x) => x.ws.close());
  const cleanup = () => { for (const ws of clients) ws.terminate(); };

  return { phone, wristband, hello, reply, pairBand, rawSocket, close, cleanup };
}
