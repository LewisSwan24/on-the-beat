// ON THE BEAT — the relay: the pages, and one room per venue.
//
// One process holds every room, so two phones at one gig are always in the
// same room (a function host that scales out can put them in two). It keeps
// the night in memory and nothing on disk: stop it and the night is gone.
//
// What a phone may know is decided in room.js and nowhere else. This file only
// carries messages in and pushes each person's own view out, whenever anything
// in their room changes.

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createRoom, SPOTS } from './room.js';
import { bandShow, cleanCode, newCode } from './band.js';

export const WS_PATH = '/api/ws';
export const PAIR_CHECK_MS = 60_000;          // a pending pairing waits this long for YES
const MAX_FRAME = 1_600_000;          // a five-second clip, base64, with room to spare
const CLIP_MAX = 1_200_000;           // bytes of video per clip
const ROOM_CLIPS_MAX = 60_000_000;    // all clips in one room; the oldest go first
const GRACE_MS = 120_000;             // a locked screen is not leaving
const CLIP_TTL_MS = 3_600_000;        // "it loops on the floor for an hour"
const PING_MS = 15_000;
const BAND_GRACE_MS = 60_000;         // a wristband that drops keeps its letters this long
const TRIES_MS = 60_000;              // the window pairing attempts are counted in
const SOCKET_TRIES = 5;               // pairing attempts one socket may make in it
const ADDRESS_TRIES = 20;             // pairing attempts one address may make in it, over every socket
const CLAIM_GRACE_MS = 45_000;        // an id-claim no wristband ever answers is swept after this
const HEX32 = /^[a-f0-9]{32}$/;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

/** A venue's room key: its name, folded, so "The Roundhouse " and "the roundhouse" meet. */
export const venueKey = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);

/** A wristband's id: the first 32 hex of SHA-256 over its 16-byte key. Only the wristband knows the key. */
export const bandIdOf = (key) => createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex').slice(0, 32);

/** Tonight's shows, as the venue team wrote them. A venue nobody listed still gets a room. */
export function loadShows(file) {
  try {
    const shows = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(shows) ? shows.filter((s) => s && typeof s.id === 'string' && venueKey(s.id) === s.id) : [];
  } catch {
    return [];
  }
}

export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile, maxBands = 5_000, maxRooms = 5_000,
  clock = Date.now, pairCheckMs = PAIR_CHECK_MS } = {}) {
  const now = () => clock();
  const here = fileURLToPath(new URL('..', import.meta.url));
  const dist = root ?? join(here, 'dist');
  const shows = loadShows(showsFile ?? process.env.SHOWS ?? join(here, 'relay', 'shows.json'));
  const showsJson = JSON.stringify(shows);
  const rooms = new Map();   // key -> { room, sockets:Set, clips:Map(ref -> {mime, buf, by, slot, at}), left:Map(id -> timer) }
  let closing = false;
  // Wrong pairing codes by address, so four letters cannot be walked: 23^4 is
  // 279,841 codes, and one unthrottled socket walked them in fifteen seconds.
  const tries = new Map();   // address -> [times of wrong codes]

  function roomFor(key) {
    if (!rooms.has(key)) {
      if (rooms.size >= maxRooms) {
        for (const r of [...rooms.values()]) gcRoom(r);   // reclaim venues nobody is in
        if (rooms.size >= maxRooms) return null;          // every venue is genuinely in use
      }
      const show = shows.find((s) => s.id === key);
      const spots = Array.isArray(show?.spots) && show.spots.length ? show.spots.map(String) : SPOTS;
      rooms.set(key, { key, room: createRoom({ spots }), sockets: new Set(), clips: new Map(), left: new Map() });
    }
    return rooms.get(key);
  }

  function push(r) {
    for (const ws of r.sockets) {
      const view = r.room.viewFor(ws.me);
      if (!view) continue;
      const b = bandOf(r.key, ws.me);
      // Its own field: me.band is where in the room they are.
      view.me.wristband = b ? { battery: b.battery, live: !!b.ws } : null;
      // A pairing waiting for YES belongs to the person, not the socket: every phone of theirs is asked.
      view.me.check = pendingOf(r.key, ws.me)?.pending.number ?? null;
      const text = JSON.stringify({ t: 'view', view });
      if (text !== ws.lastView) { ws.lastView = text; ws.send(text); }
    }
    for (const b of bands.values()) if (b.key === r.key || b.pending?.key === r.key) showBand(b);
  }

  const toPerson = (r, me, m) => { for (const s of r.sockets) if (s.me === me) s.send(JSON.stringify(m)); };

  // ---------- wristbands ----------
  // A wristband is not in a room until a phone pairs it. It gets four letters
  // to show; the phone types them; from then on it shows what its person is
  // doing, and its one button can make them invisible.

  const bands = new Map();   // id -> { id, ws, battery, code, key, person, testUntil, lastShow }
  const codes = new Map();   // code -> band id, while it waits to be typed

  const bandOf = (key, person) => [...bands.values()].find((b) => b.key === key && b.person === person) || null;
  const pendingOf = (key, person) => [...bands.values()].find((b) => b.pending?.key === key && b.pending.person === person) || null;

  const makeBand = (id, ws) => ({ id, ws, battery: null, code: null, key: null, person: null,
    testUntil: 0, lastShow: null, everWs: !!ws, goneAt: 0, claimedAt: now(), old: false,
    secret: null, pending: null });   // pending: { key, person, number, until } while a pairing waits for YES

  // How long a record has been dead weight: a live wristband is never that, a
  // real paired band whose wristband has connected at least once is kept, and
  // everything else — an unclaimed band that dropped, a claim no wristband ever
  // answered — is measured from when it went quiet.
  function bandIdle(b, now) {
    if (b.ws) return -1;
    if (!b.person) return now - (b.goneAt || b.claimedAt || now);
    if (!b.everWs) return now - (b.claimedAt || now);
    return -1;
  }
  // Make room for one more band by dropping the deadest one; never a live one.
  function evictBand(now) {
    let worst = null, worstIdle = -1;
    for (const b of bands.values()) { const idle = bandIdle(b, now); if (idle > worstIdle) { worst = b; worstIdle = idle; } }
    if (!worst || worstIdle < 0) return false;
    codes.delete(worst.code);
    bands.delete(worst.id);
    return true;
  }

  function showBand(b, now = clock()) {
    if (!b.ws) return;
    const view = b.key ? rooms.get(b.key)?.room.viewFor(b.person) ?? null : null;
    const text = JSON.stringify({ t: 'show', show: bandShow({ view, battery: b.battery, code: b.code, check: b.pending?.number ?? null, testUntil: b.testUntil, now }) });
    if (text !== b.lastShow) { b.lastShow = text; b.ws.send(text); }
  }

  /** Nobody's, and nobody is pairing it: fresh letters while it is worn; forgotten when it is not. */
  function freshLetters(b) {
    codes.delete(b.code);
    Object.assign(b, { code: null, key: null, person: null, secret: null, pending: null });
    if (b.ws) {
      b.code = newCode(new Set(codes.keys()));
      codes.set(b.code, b.id);
    } else {
      // Nobody is wearing it. If it comes back, it comes back new.
      bands.delete(b.id);
    }
  }

  function unpairBand(b) {
    const r = b.key ? rooms.get(b.key) : null;
    freshLetters(b);
    if (r) push(r);
    showBand(b);
  }

  /** A pairing that did not end in YES. `why` is told to the person's phones: 'timeout', or null when they said NO themselves. */
  function dropPending(b, why) {
    const r = rooms.get(b.pending.key);
    const person = b.pending.person;
    freshLetters(b);
    if (r && why) toPerson(r, person, { t: 'check', ok: false, why });
    if (r) push(r);
    showBand(b);
  }

  function handleBand(ws, m) {
    const b = bands.get(ws.band);
    // Only from the wristband's current socket: a set stuck in a replaced one must not land.
    if (!b || b.ws !== ws) return;
    if (m.t === 'battery') b.battery = Math.max(0, Math.min(100, Math.round(Number(m.level) || 0)));
    // Held for a second: NOT NOW, from the wrist. The phone follows.
    if (m.t === 'hold' && b.person) rooms.get(b.key)?.room.setInvisible(b.person, true);
    const r = b.key ? rooms.get(b.key) : null;
    if (r) push(r); else showBand(b);
  }

  function refuseBand(ws) {
    ws.send(JSON.stringify({ t: 'error', why: 'bad band' }));
    ws.close(4001, 'bad band');
  }

  function hello(ws, m) {
    if (ws.r) { ws.send(JSON.stringify({ t: 'error', why: 'bad band' })); return; }
    const id = String(m.id || '');
    const v2 = m.v === 2;
    const key = String(m.key || '');
    // The key proves the id; a socket says hello once.
    const proven = v2 ? HEX32.test(id) && HEX32.test(key) && bandIdOf(key) === id : /^[a-f0-9]{16,64}$/.test(id);
    if (ws.band || !proven) { refuseBand(ws); return; }
    let b = bands.get(id);
    // A hello with no version never reaches a record made by one with, nor the other way round.
    if (b && b.old === v2) { refuseBand(ws); return; }
    if (!b) {
      if (bands.size >= maxBands && !evictBand(now())) { ws.send(JSON.stringify({ t: 'error', why: 'too many wristbands' })); return; }
      b = makeBand(id, ws);
      b.old = !v2;
      bands.set(id, b);
    }
    // Replaced, not cut off: it may still be closing, and its frames are dropped from here on.
    if (b.ws && b.ws !== ws) b.ws.close(4000, 'replaced');
    b.ws = ws;
    b.everWs = true;
    b.lastShow = null;
    ws.band = id;
    if (!b.person && !b.code) unpairBand(b);
    if (m.battery !== undefined) handleBand(ws, { t: 'battery', level: m.battery });
    else showBand(b);
  }

  function checkNumber() {
    // Two digits, like a meeting number, and not one another pairing is showing.
    const taken = new Set([...bands.values()].filter((b) => b.pending).map((b) => b.pending.number));
    let n = 10 + randomInt(90);
    for (let i = 0; i < 90 && taken.has(n); i += 1) n = n === 99 ? 10 : n + 1;
    return n;
  }

  /** By the four letters. Nothing pairs yet: the wristband that was reached shows a number, and the phone is asked. */
  function pairByCode(ws, r, me, m) {
    const error = (why) => ws.send(JSON.stringify({ t: 'error', why }));
    if (tooMany(ws)) { error('too many tries'); return; }
    attempt(ws);   // every attempt counts, right or wrong
    const b = bands.get(codes.get(cleanCode(m.code)));
    if (!b) { error('no such wristband'); return; }
    if (b.old) { error('old firmware'); return; }
    if (b.pending) { error('busy'); return; }
    const mine = pendingOf(r.key, me);
    if (mine) dropPending(mine, null);   // one pending per person: the newest letters win
    b.pending = { key: r.key, person: me, number: checkNumber(), until: now() + pairCheckMs };
    showBand(b);
  }

  function confirm(r, me, m) {
    const b = pendingOf(r.key, me);
    if (!b) return;
    if (m.yes !== true) { dropPending(b, null); return; }
    if (!b.ws) { dropPending(b, 'timeout'); return; }   // nothing on the wrist to give a secret to
    const old = bandOf(r.key, me);
    if (old) unpairBand(old);
    codes.delete(b.code);
    Object.assign(b, { pending: null, code: null, key: r.key, person: me, secret: randomBytes(16).toString('hex') });
    // Paired: it flashes white once, so the right wrist knows it was the one.
    b.testUntil = now() + 900;
    b.ws.send(JSON.stringify({ t: 'paired', secret: b.secret }));
    toPerson(r, me, { t: 'paired', band: b.id, secret: b.secret });
  }

  /** After a reconnect, by the id only this phone was told when it paired. */
  function claim(ws, r, me, m) {
    const id = String(m.band || '');
    let b = id ? bands.get(id) : null;
    // A relay that restarted has forgotten every wristband, and the phone can
    // be back before its wristband is: a bare id claims the band, and the
    // wristband comes back already paired. Until one does, the claim is only
    // a placeholder the sweep forgets. Unproven, so counted.
    const wouldClaim = !b && /^[a-f0-9]{16,64}$/.test(id);
    if (wouldClaim && tooMany(ws)) { ws.send(JSON.stringify({ t: 'error', why: 'too many tries' })); return; }
    if (wouldClaim) {
      attempt(ws);
      if (bands.size >= maxBands && !evictBand(now())) { ws.send(JSON.stringify({ t: 'error', why: 'too many wristbands' })); return; }
      b = makeBand(id, null);
      bands.set(id, b);
    }
    const mine = b && b.key === r.key && b.person === me;
    if (!b || (!mine && !wouldClaim)) { ws.send(JSON.stringify({ t: 'error', why: 'no such wristband' })); return; }
    if (!mine) { b.key = r.key; b.person = me; }
    ws.send(JSON.stringify({ t: 'paired', band: b.id }));
  }

  /**
   * One clip per person per slot: 'floor' for everyone, or 'to:<handle>' for a
   * dance back. A new one replaces the old; past the room's cap the oldest go,
   * and a floor clip that goes is taken off the floor rather than left to 404.
   */
  function keepClip(r, id, mime, data, slot) {
    const buf = Buffer.from(String(data || ''), 'base64');
    if (!buf.length || buf.length > CLIP_MAX || !/^video\/(webm|mp4)/.test(String(mime))) return null;
    const drop = (ref, c) => {
      r.clips.delete(ref);
      if (c.slot === 'floor' && r.room.has(c.by)) r.room.postClip(c.by, null);
    };
    for (const [ref, c] of r.clips) if (c.by === id && c.slot === slot) r.clips.delete(ref);
    let total = [...r.clips.values()].reduce((n, c) => n + c.buf.length, 0) + buf.length;
    for (const [ref, c] of [...r.clips].sort((a, b) => a[1].at - b[1].at)) {
      if (total <= ROOM_CLIPS_MAX) break;
      drop(ref, c);
      total -= c.buf.length;
    }
    const ref = randomBytes(12).toString('hex');
    r.clips.set(ref, { mime: String(mime).split(';')[0], buf, by: id, slot, at: now() });
    return ref;
  }

  function handle(ws, m) {
    if (m.t === 'ping') { ws.send('{"t":"pong"}'); return; }
    if (m.t === 'wristband') { hello(ws, m); return; }
    if (ws.band) { handleBand(ws, m); return; }
    if (m.t === 'join') {
      const key = venueKey(m.venue);
      const me = String(m.me || '');
      if (!key || !/^[a-f0-9]{16,64}$/.test(me)) { ws.send(JSON.stringify({ t: 'error', why: 'bad join' })); return; }
      const nextRoom = roomFor(key);
      if (!nextRoom) { ws.send(JSON.stringify({ t: 'error', why: 'too many venues' })); return; }
      if (ws.r && ws.r !== nextRoom) ws.r.sockets.delete(ws);
      ws.r = nextRoom;
      ws.me = me;
      clearTimeout(ws.r.left.get(me));
      ws.r.left.delete(me);
      ws.r.room.join(me, { band: m.band });
      ws.r.sockets.add(ws);
      push(ws.r);
      return;
    }
    const r = ws.r;
    if (!r) return;
    const room = r.room, me = ws.me;
    switch (m.t) {
      case 'profile': room.setProfile(me, { name: m.name, contact: m.contact }); break;
      case 'band': room.setBand(me, m.band); break;
      // A fact the phone says again after reconnecting never undoes NOT NOW:
      // the wristband may have made them invisible while the phone was away.
      case 'arm':
        if (!(m.again && m.intent && room.viewFor(me)?.me.invisible)) room.arm(me, m.intent);
        break;
      case 'invisible':
        if (!(m.again && !m.on && room.viewFor(me)?.me.invisible)) room.setInvisible(me, m.on);
        break;
      case 'pair':
        if (m.code !== undefined && m.code !== null) pairByCode(ws, r, me, m);
        else claim(ws, r, me, m);
        break;
      case 'confirm': confirm(r, me, m); break;
      case 'unpair': { const b = bandOf(r.key, me); if (b) unpairBand(b); break; }
      case 'testLight': {
        const b = bandOf(r.key, me);
        if (b) { b.testUntil = now() + 2000; showBand(b); }
        break;
      }
      case 'pick': room.pick(me, m.track); break;
      case 'wave': room.wave(me, m.handle); break;
      case 'like': room.like(me, m.handle); break;
      case 'unlike': room.unlike(me, m.handle); break;
      case 'block': room.block(me, m.handle); break;
      case 'report':
        // The venue team's copy. A real deployment sends this to their radio or dashboard.
        if (room.report(me, m.handle || null, m.why)) console.log('REPORT', JSON.stringify(room.reports().at(-1)));
        break;
      case 'keep': room.keep(me, m.match, m.on); break;
      case 'clip': {
        const to = m.to ? String(m.to) : null;
        const ref = keepClip(r, me, m.mime, m.data, to ? 'to:' + to : 'floor');
        if (!ref) { ws.send(JSON.stringify({ t: 'error', why: 'clip refused' })); return; }
        if (!to) room.postClip(me, ref);
        else if (room.danceBack(me, to, ref) === false) {
          // They are gone, blocked or invisible. Keep nothing for nobody.
          r.clips.delete(ref);
          ws.send(JSON.stringify({ t: 'error', why: 'clip refused' }));
          return;
        }
        ws.send(JSON.stringify({ t: 'sent', to }));
        break;
      }
      case 'leave':
        clearTimeout(r.left.get(me));
        r.left.delete(me);
        room.leave(me);
        r.sockets.delete(ws);
        ws.r = null;
        gcRoom(r);
        break;
      default: return;
    }
    push(r);
  }

  function serveClip(res, url) {
    const [, , key, ref] = url.split('?')[0].split('/');   // /clip/<venue>/<ref>
    let c = null;
    try { c = rooms.get(venueKey(decodeURIComponent(key || '')))?.clips.get(ref || ''); } catch { /* malformed */ }
    if (!c) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': c.mime, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' }).end(c.buf);
  }

  /** A file from dist/, or the app itself for any route it owns. Never anything outside dist/. */
  function serveStatic(res, url) {
    let file = join(dist, 'index.html');
    try {
      const want = join(dist, normalize(decodeURIComponent(url.split('?')[0])).replace(/^([/\\])+/, ''));
      const inside = relative(dist, want);
      if (inside && !inside.startsWith('..') && !isAbsolute(inside) && extname(want) && existsSync(want)) file = want;
    } catch { /* a malformed escape is just a route the app does not have */ }
    if (!existsSync(file)) { res.writeHead(503).end('build the app first: npm run build'); return; }
    const hashed = /[/\\]assets[/\\]/.test(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    }).end(readFileSync(file));
  }

  const server = createServer((req, res) => {
    const url = req.url || '/';
    if (url === '/api/shows') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' }).end(showsJson);
    } else if (url.startsWith('/clip/')) serveClip(res, url);
    else serveStatic(res, url);
  });

  /**
   * Who is guessing. Behind the tunnel every socket comes from this machine and
   * cloudflared names the real address; a header from anywhere else is a claim
   * anyone can make, so there the socket's own address stands.
   */
  function addressOf(req) {
    const a = req.socket.remoteAddress || '';
    const cf = req.headers['cf-connecting-ip'];
    return cf && (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1') ? String(cf).slice(0, 64) : a;
  }
  const recent = (list, now) => list.filter((t) => now - t < TRIES_MS);
  function tooMany(ws, now = clock()) {
    ws.fails = recent(ws.fails, now);
    return ws.fails.length >= SOCKET_TRIES || recent(tries.get(ws.addr) || [], now).length >= ADDRESS_TRIES;
  }
  function attempt(ws, now = clock()) {
    ws.fails.push(now);
    tries.set(ws.addr, [...recent(tries.get(ws.addr) || [], now), now]);
  }

  const wss = new WebSocketServer({ server, path: WS_PATH, maxPayload: MAX_FRAME });
  wss.on('connection', (ws, req) => {
    ws.addr = addressOf(req);
    ws.fails = [];
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    // An oversized or broken frame ends this socket, never the process.
    ws.on('error', () => ws.terminate());
    ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (m && typeof m.t === 'string') handle(ws, m);
    });
    ws.on('close', () => {
      const band = ws.band && bands.get(ws.band);
      if (band && band.ws === ws) {
        band.ws = null;
        band.goneAt = now();
        // A wristband nobody has claimed keeps its letters for a minute, so a
        // dropped connection does not change the code someone is typing. The
        // sweep forgets it after that.
        if (band.person && rooms.get(band.key)) push(rooms.get(band.key));
      }
      const r = ws.r;
      // A relay that is shutting down starts no grace period: close() has
      // already cleared them, and a new one would hold the process open.
      if (!r || closing) return;
      r.sockets.delete(ws);
      if ([...r.sockets].some((s) => s.me === ws.me)) return;
      r.left.set(ws.me, setTimeout(() => {
        r.left.delete(ws.me);
        r.room.leave(ws.me);
        push(r);
        gcRoom(r);
      }, GRACE_MS));
    });
  });

  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, PING_MS);

  // An hour on the floor, then gone — from the floor and from memory.
  const sweep = setInterval(() => expire(now()), 60_000);
  // A pairing check that timed out, and every wristband's face, once a second.
  function tickBands(at = now()) {
    for (const b of [...bands.values()]) if (b.pending && at >= b.pending.until) dropPending(b, 'timeout');
    for (const b of bands.values()) showBand(b, at);
  }
  const lights = setInterval(() => tickBands(), 1000);
  // A venue with nobody in it, nobody in its grace window, no clip still loading
  // and no wristband still worn holds nothing — so it is let go, or a long-lived
  // relay would keep a room object for every venue anyone ever typed.
  function gcRoom(r) {
    if (r.sockets.size || r.left.size || r.clips.size) return;
    for (const b of bands.values()) if (b.key === r.key && b.ws) return;
    rooms.delete(r.key);
  }

  function expire(at) {
    for (const b of [...bands.values()]) {
      if (b.ws) continue;
      const idle = at - (b.goneAt || b.claimedAt || at);
      const dead = (!b.person && idle >= BAND_GRACE_MS) || (b.person && !b.everWs && idle >= CLAIM_GRACE_MS);
      if (!dead) continue;
      codes.delete(b.code);
      bands.delete(b.id);
    }
    for (const [addr, list] of tries) {
      const left = recent(list, at);
      if (left.length) tries.set(addr, left); else tries.delete(addr);
    }
    for (const r of rooms.values()) {
      let changed = false;
      for (const [ref, c] of r.clips) {
        if (at - c.at < CLIP_TTL_MS) continue;
        r.clips.delete(ref);
        if (c.slot === 'floor' && r.room.has(c.by)) r.room.postClip(c.by, null);
        changed = true;
      }
      if (changed) push(r);
    }
    for (const r of [...rooms.values()]) gcRoom(r);
  }

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({
      port: server.address().port,
      rooms,
      /** For tests: run the sweep — clips, dropped wristbands, old wrong codes — as if the clock read `at`. */
      expire,
      /** For tests: time out pairing checks and redraw every wristband as if the clock read `at`. */
      tickBands,
      /** For tests: how many wristband records the relay is holding. */
      bandCount: () => bands.size,
      /** For tests: how many venue rooms the relay is holding. */
      roomCount: () => rooms.size,
      close: () => new Promise((done) => {
        closing = true;
        clearInterval(beat);
        clearInterval(sweep);
        clearInterval(lights);
        for (const r of rooms.values()) for (const t of r.left.values()) clearTimeout(t);
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => server.close(() => done()));
      }),
    }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const relay = await createRelay({ port: Number(process.env.PORT) || 8790 });
  console.log('ON THE BEAT relay on http://localhost:' + relay.port + '/');
}
