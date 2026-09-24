// ON THE BEAT — the relay over real sockets: rooms per venue, a view pushed
// to every phone on every change, clips, and a frame that cannot take it down.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { createRelay, WS_PATH, venueKey } from '../relay/server.js';

let relay;
let base;
// Every socket a test opens, so a failing test cannot leave one holding the run open.
const clients = new Set();
const url = (path) => 'http://127.0.0.1:' + relay.port + path;

before(async () => {
  // dist/ sits beside two things it must never serve: a secret, and a
  // sibling whose name starts with "dist".
  base = mkdtempSync(join(tmpdir(), 'otb-'));
  const root = join(base, 'dist');
  mkdirSync(root);
  mkdirSync(join(base, 'dist-evil'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>On The Beat</title>');
  writeFileSync(join(root, 'app.js'), 'export {};');
  writeFileSync(join(base, 'secret.txt'), 'SECRET');
  writeFileSync(join(base, 'dist-evil', 'x.js'), 'SECRET');
  relay = await createRelay({ port: 0, host: '127.0.0.1', root });
});

after(async () => {
  for (const ws of clients) ws.terminate();
  await relay.close();
  rmSync(base, { recursive: true, force: true });
});

/** A phone: a socket, the last view it was pushed, and a way to wait for the next one that fits. */
async function phone(venue, { band, ip } = {}) {
  const ws = new WebSocket('ws://127.0.0.1:' + relay.port + WS_PATH, ip ? { headers: { 'cf-connecting-ip': ip } } : undefined);
  clients.add(ws);
  const me = randomBytes(16).toString('hex');
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
  p.send({ t: 'join', venue, me, band });
  await p.until(() => true);
  return p;
}

const close = (...phones) => phones.forEach((p) => p.ws.close());

test('two phones at one venue meet: waves go both ways and both see one match, one number', async () => {
  const ana = await phone('roundhouse-bruno-mars');
  const ben = await phone('roundhouse-bruno-mars');
  const far = await phone('moth-club-kayo-lane');
  ana.send({ t: 'profile', name: 'Ana', contact: '@ana' });
  ben.send({ t: 'profile', name: 'Ben' });
  ana.send({ t: 'arm', intent: 'hi' });
  ben.send({ t: 'arm', intent: 'hi' });
  const seen = await ana.until((v) => v.near.length === 1);
  ana.send({ t: 'wave', handle: seen.near[0].handle });
  const toBen = await ben.until((v) => v.near[0]?.wavedAtYou);
  ben.send({ t: 'wave', handle: toBen.near[0].handle });
  const [a] = (await ana.until((v) => v.matches.length === 1)).matches;
  const [b] = (await ben.until((v) => v.matches.length === 1)).matches;
  assert.deepEqual([a.name, b.name], ['Ben', 'Ana']);
  assert.equal(a.number, b.number);
  assert.equal(a.spot, "by the merch stand — it's the quietest corner", 'the venue\'s own quiet corner');
  assert.deepEqual(far.view.near, [], 'another venue is another room');
  close(ana, ben, far);
});

test('NOT NOW takes a phone off every list at once', async () => {
  const ana = await phone('electric-ballroom-the-long-weekend');
  const ben = await phone('electric-ballroom-the-long-weekend');
  ana.send({ t: 'arm', intent: 'hi' });
  await ben.until((v) => v.near.length === 1);
  ana.send({ t: 'invisible', on: true });
  await ben.until((v) => v.near.length === 0);
  close(ana, ben);
});

test('leaving the venue takes you out of the room straight away; a dropped socket does not', async () => {
  const ana = await phone('earth-sable-court');
  const ben = await phone('earth-sable-court');
  const cai = await phone('earth-sable-court');
  ana.send({ t: 'arm', intent: 'hi' });
  cai.send({ t: 'arm', intent: 'hi' });
  await ben.until((v) => v.near.length === 2);
  cai.ws.close();
  ana.send({ t: 'leave' });
  await ben.until((v) => v.near.length === 1);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(ben.view.near.length, 1, 'a locked screen is not leaving: cai stays for the grace period');
  close(ana, ben);
});

test('a clip on the floor is served to the room, and a dance back reaches only its person', async () => {
  const ana = await phone('the lantern');
  const ben = await phone('the lantern');
  const cai = await phone('the lantern');
  const bytes = randomBytes(2048);
  ana.send({ t: 'clip', mime: 'video/webm;codecs=vp8', data: bytes.toString('base64') });
  const onFloor = await ben.until((v) => v.floor.length === 1);
  const res = await fetch(url('/clip/' + encodeURIComponent('the lantern') + '/' + onFloor.floor[0].ref));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'video/webm');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff', 'a clip is served with its mime, never guessed');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);

  ben.send({ t: 'clip', mime: 'video/webm', data: randomBytes(512).toString('base64'), to: onFloor.floor[0].handle });
  const got = await ana.until((v) => v.floor.some((c) => c.toYou));
  assert.equal(cai.view.floor.some((c) => c.toYou), false, 'cai was not sent it');
  assert.equal((await ben.until((v, p) => p.sent.length === 1)) && ben.sent[0].to, onFloor.floor[0].handle);

  ana.send({ t: 'clip', mime: 'video/webm', data: randomBytes(512).toString('base64'), to: got.floor.find((c) => c.toYou).handle });
  const [m] = (await ben.until((v) => v.matches.length === 1)).matches;
  assert.equal(m.intent, 'dance');

  ben.send({ t: 'clip', mime: 'video/webm', data: randomBytes(64).toString('base64'), to: 'nobody-here' });
  await ben.until((v, p) => p.errors.includes('clip refused'));
  ben.send({ t: 'clip', mime: 'image/png', data: randomBytes(64).toString('base64') });
  await ben.until((v, p) => p.errors.filter((e) => e === 'clip refused').length === 2);
  close(ana, ben, cai);
});

test('an hour on the floor, then the clip is gone — from the floor and from the server', async () => {
  const ana = await phone('electric-ballroom-the-long-weekend');
  const ben = await phone('electric-ballroom-the-long-weekend');
  ana.send({ t: 'clip', mime: 'video/webm', data: randomBytes(256).toString('base64') });
  const [tile] = (await ben.until((v) => v.floor.length === 1)).floor;
  relay.expire(Date.now() + 59 * 60_000);
  assert.equal((await fetch(url('/clip/electric-ballroom-the-long-weekend/' + tile.ref))).status, 200, 'not yet');
  relay.expire(Date.now() + 61 * 60_000);
  await ben.until((v) => v.floor.length === 0);
  assert.equal((await fetch(url('/clip/electric-ballroom-the-long-weekend/' + tile.ref))).status, 404);
  close(ana, ben);
});

/** A wristband: a socket that says it is one, and the last thing it was told to show. */
async function wristband(battery = 62, id = randomBytes(16).toString('hex')) {
  const ws = new WebSocket('ws://127.0.0.1:' + relay.port + WS_PATH);
  clients.add(ws);
  const b = { ws, id, show: null, waiters: [] };
  ws.on('message', (data) => {
    const m = JSON.parse(String(data));
    if (m.t === 'show') b.show = m.show;
    b.waiters = b.waiters.filter((w) => !w());
  });
  await new Promise((resolve) => ws.once('open', resolve));
  b.send = (m) => ws.send(JSON.stringify(m));
  b.until = (pred, ms = 3000) => new Promise((resolve, reject) => {
    const check = () => { if (b.show && pred(b.show)) { clearTimeout(timer); resolve(b.show); return true; } return false; };
    const timer = setTimeout(() => reject(new Error('band timed out; last show ' + JSON.stringify(b.show))), ms);
    if (!check()) b.waiters.push(check);
  });
  b.send({ t: 'wristband', id: b.id, battery });
  await b.until(() => true);
  return b;
}

/** The next reply of a kind on a phone's socket. */
const reply = (p, t, ms = 3000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { p.ws.off('message', on); reject(new Error('no ' + t + ' reply')); }, ms);
  const on = (data) => { const m = JSON.parse(String(data)); if (m.t === t) { clearTimeout(timer); p.ws.off('message', on); resolve(m); } };
  p.ws.on('message', on);
});

test('a wristband pairs by its four letters, then shows what its person is doing', async () => {
  const band = await wristband();
  assert.equal(band.show.kind, 'pairing');
  const { code } = band.show;
  assert.match(code, /^[A-HJKMNP-Z]{4}$/);
  const ana = await phone('band-room-1');
  const wrong = reply(ana, 'error');
  ana.send({ t: 'pair', code: 'ZZZZ' === band.show.code ? 'YYYY' : 'ZZZZ' });
  assert.equal((await wrong).why, 'no such wristband');
  const paired = reply(ana, 'paired');
  ana.send({ t: 'pair', code: band.show.code.toLowerCase() });
  assert.equal((await paired).band, band.id);
  await band.until((s) => s.kind === 'off');
  await ana.until((v) => v.me.wristband?.battery === 62 && v.me.wristband.live);
  ana.send({ t: 'arm', intent: 'hi' });
  await band.until((s) => s.kind === 'hi' && s.big === 'HI :)');
  const cai = await phone('band-room-1');
  const used = reply(cai, 'error');
  cai.send({ t: 'pair', code });
  assert.equal((await used).why, 'no such wristband', 'letters that were typed once are gone');
  close(ana, cai);
  band.ws.close();
});

test("holding the wristband's button is NOT NOW, and a phone coming back does not undo it", async () => {
  const band = await wristband();
  const ana = await phone('band-room-2');
  const ben = await phone('band-room-2');
  ana.send({ t: 'pair', code: band.show.code });
  ana.send({ t: 'arm', intent: 'hi' });
  await ben.until((v) => v.near.length === 1);
  band.send({ t: 'hold' });
  await ana.until((v) => v.me.invisible);
  await ben.until((v) => v.near.length === 0);
  await band.until((s) => s.kind === 'off' && s.quiet);
  // The phone says again what it was doing, as it does after any reconnect.
  ana.send({ t: 'arm', intent: 'hi', again: true });
  ana.send({ t: 'invisible', on: false, again: true });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(ben.view.near.length, 0, 'still invisible — only a person can turn it back on');
  ana.send({ t: 'arm', intent: 'hi' });
  await ben.until((v) => v.near.length === 1);
  close(ana, ben);
  band.ws.close();
});

test('after a mutual yes both wristbands show the same number; unpairing hands out new letters', async () => {
  const [b1, b2] = [await wristband(), await wristband()];
  const ana = await phone('band-room-3');
  const ben = await phone('band-room-3');
  ana.send({ t: 'pair', code: b1.show.code });
  ben.send({ t: 'pair', code: b2.show.code });
  ana.send({ t: 'arm', intent: 'hi' });
  ben.send({ t: 'arm', intent: 'hi' });
  const h1 = (await ana.until((v) => v.near.length === 1)).near[0].handle;
  const h2 = (await ben.until((v) => v.near.length === 1)).near[0].handle;
  ana.send({ t: 'wave', handle: h1 });
  ben.send({ t: 'wave', handle: h2 });
  const s1 = await b1.until((s) => s.kind === 'meet');
  const s2 = await b2.until((s) => s.kind === 'meet');
  assert.equal(s1.big, s2.big);
  assert.equal(s1.big, String((await ana.until((v) => v.matches.length === 1)).matches[0].number));
  const old = b1.show;
  ana.send({ t: 'testLight' });
  await b1.until((s) => s.kind === 'test');
  relay.tickBands(Date.now() + 2500);
  await b1.until((s) => s.kind === 'meet');
  ana.send({ t: 'unpair' });
  const fresh = await b1.until((s) => s.kind === 'pairing');
  assert.notDeepEqual(fresh, old);
  await ana.until((v) => v.me.wristband === null);
  close(ana, ben);
  b1.ws.close();
  b2.ws.close();
});

test('a phone re-pairs by the id it was given; nobody else can use it', async () => {
  const band = await wristband();
  const ana = await phone('band-room-4');
  const paired = reply(ana, 'paired');
  ana.send({ t: 'pair', code: band.show.code });
  const { band: id } = await paired;
  const again = reply(ana, 'paired');
  ana.send({ t: 'pair', band: id });
  assert.equal((await again).band, id, 'the phone that paired it can say so again');
  const ben = await phone('band-room-4');
  const no = reply(ben, 'error');
  ben.send({ t: 'pair', band: id });
  assert.equal((await no).why, 'no such wristband', 'a paired wristband is not taken by another phone');
  close(ana, ben);
  band.ws.close();
});

test('a phone back before its wristband holds the claim, and the wristband comes back paired', async () => {
  // What a relay restart looks like from here: an id this relay has never seen.
  const ana = await phone('band-room-5');
  const id = randomBytes(16).toString('hex');
  const held = reply(ana, 'paired');
  ana.send({ t: 'pair', band: id, again: true });
  assert.equal((await held).band, id);
  await ana.until((v) => v.me.wristband?.live === false);
  ana.send({ t: 'arm', intent: 'hi' });
  const band = await wristband(40, id);
  await band.until((s) => s.kind === 'hi');
  await ana.until((v) => v.me.wristband?.live === true && v.me.wristband.battery === 40);
  assert.equal(ana.view.me.band, 'in this room', "the wristband does not take the place of where they are");
  close(ana);
  band.ws.close();
});

test('a dropped wristband keeps its letters through a blip', async () => {
  // Wifi blips. If a reconnect handed out new letters, it would change the code
  // under the finger of someone half-way through typing it, so it does not.
  const band = await wristband();
  const { code } = band.show;
  band.ws.close();
  await new Promise((resolve) => band.ws.once('close', resolve));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const ana = await phone('band-room-6');
  const paired = reply(ana, 'paired');
  ana.send({ t: 'pair', code });
  assert.ok((await paired).band, 'the letters still pair inside the grace window');
  close(ana);
});

test('an unclaimed wristband that never comes back is swept, letters and all', async () => {
  const band = await wristband();
  const { code } = band.show;
  band.ws.close();
  await new Promise((resolve) => band.ws.once('close', resolve));
  await new Promise((resolve) => setTimeout(resolve, 100));
  relay.expire(Date.now() + 61_000);           // past BAND_GRACE_MS
  const ana = await phone('band-room-6b');
  const no = reply(ana, 'error');
  ana.send({ t: 'pair', code });
  assert.equal((await no).why, 'no such wristband');
  close(ana);
});

test('one socket may make only a few unproven pair attempts before it is refused', async () => {
  // The 279,841 four-letter codes cannot be walked: five tries a socket, and a
  // bare id-claim with no wristband behind it counts the same as a missed code.
  relay.expire(Date.now() + 61_000);           // clear any tries the suite left on this bucket
  const ana = await phone('band-guess', { ip: '203.0.113.7' });
  for (let i = 0; i < 5; i += 1) {
    const ok = reply(ana, 'paired');
    ana.send({ t: 'pair', band: randomBytes(16).toString('hex') });
    assert.ok((await ok).band, 'attempt ' + i + ' should be answered');
  }
  const blocked = reply(ana, 'error');
  ana.send({ t: 'pair', band: randomBytes(16).toString('hex') });
  assert.equal((await blocked).why, 'too many tries', 'the sixth is refused');
  close(ana);
});

test('a missed code is throttled on the same counter as an id-claim', async () => {
  relay.expire(Date.now() + 61_000);
  const ana = await phone('band-guess-2', { ip: '203.0.113.8' });
  // Four id-claims, then a missed code, then one more claim: the sixth unproven
  // attempt is refused no matter which kind each one was.
  for (let i = 0; i < 4; i += 1) {
    const ok = reply(ana, 'paired');
    ana.send({ t: 'pair', band: randomBytes(16).toString('hex') });
    await ok;
  }
  const miss = reply(ana, 'error');
  ana.send({ t: 'pair', code: 'ZZZZ' });
  assert.equal((await miss).why, 'no such wristband', 'a wrong code still answers honestly under the cap');
  const blocked = reply(ana, 'error');
  ana.send({ t: 'pair', band: randomBytes(16).toString('hex') });
  assert.equal((await blocked).why, 'too many tries');
  close(ana);
});

test('id-claims with no wristband behind them are swept, so they cannot pile up', async () => {
  // One person holds one band, so a real pile-up needs many sockets: three
  // phones make three placeholders, and the sweep clears every one.
  relay.expire(Date.now() + 61_000);           // clear the tries and any old placeholders
  const before = relay.bandCount();
  const phones = [];
  for (let i = 0; i < 3; i += 1) {
    const ph = await phone('band-phantom-' + i);
    const ok = reply(ph, 'paired');
    ph.send({ t: 'pair', band: randomBytes(16).toString('hex') });
    await ok;
    phones.push(ph);
  }
  assert.ok(relay.bandCount() >= before + 3, 'three placeholders now exist, saw ' + relay.bandCount() + ' vs ' + before);
  relay.expire(Date.now() + 46_000);           // past CLAIM_GRACE_MS
  assert.ok(relay.bandCount() <= before, 'and every unanswered placeholder is gone, saw ' + relay.bandCount());
  close(...phones);
});

test('the band table has a ceiling, and filling it never evicts a live wristband', async () => {
  // A relay of its own, capped small, so the ceiling can actually be reached.
  const small = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'dist'), maxBands: 3 });
  const url = 'ws://127.0.0.1:' + small.port + WS_PATH;
  const opened = [];
  const open = async () => { const ws = new WebSocket(url); clients.add(ws); opened.push(ws); await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); }); return ws; };
  try {
    // One real wristband, connected and showing its letters — hold on to its code.
    const band = await open();
    let show = null;
    band.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'show') show = m.show; });
    band.send(JSON.stringify({ t: 'wristband', id: randomBytes(16).toString('hex'), battery: 88 }));
    while (!show) await new Promise((r) => setTimeout(r, 20));
    assert.equal(show.kind, 'pairing');
    const code = show.code;

    // Six phones each claim a random id — with a ceiling of three, the table
    // must evict placeholders to make room, over and over.
    for (let i = 0; i < 6; i += 1) {
      const ph = await open();
      const me = randomBytes(16).toString('hex');
      ph.send(JSON.stringify({ t: 'join', venue: 'cap-room-' + i, me }));
      await new Promise((r) => setTimeout(r, 40));
      ph.send(JSON.stringify({ t: 'pair', band: randomBytes(16).toString('hex') }));
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.ok(small.bandCount() <= 3, 'the table never grew past its ceiling, saw ' + small.bandCount());

    // The live wristband was never the one evicted: a fresh phone can still pair
    // by the letters it is still showing.
    const late = await open();
    const lateMe = randomBytes(16).toString('hex');
    let paired = null, refused = null;
    late.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'paired') paired = m; if (m.t === 'error') refused = m.why; });
    late.send(JSON.stringify({ t: 'join', venue: 'cap-late', me: lateMe }));
    await new Promise((r) => setTimeout(r, 60));
    late.send(JSON.stringify({ t: 'pair', code }));
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(paired && !refused, 'the connected wristband survived the flood (refused: ' + refused + ')');
  } finally {
    for (const ws of opened) { try { ws.close(); } catch { /* already gone */ } }
    await small.close();
  }
});

test('a relay closed with a phone still in the room leaves no timer behind', async () => {
  // Every test that fails part-way leaves a phone connected; a two-minute
  // grace timer started after close() would hold the whole run open.
  const timers = () => process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length;
  const before = timers();
  const other = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'dist') });
  const ws = new WebSocket('ws://127.0.0.1:' + other.port + WS_PATH);
  await new Promise((resolve) => ws.once('open', resolve));
  ws.send(JSON.stringify({ t: 'join', venue: 'closing-room', me: randomBytes(16).toString('hex') }));
  await new Promise((resolve) => ws.once('message', resolve));
  await other.close();
  await new Promise((resolve) => (ws.readyState === 3 ? resolve() : ws.once('close', resolve)));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(timers(), before, 'a closed relay held the process open with a timer');
});

test('a new pairing flashes the wristband white once; claiming it again by id does not', async () => {
  const band = await wristband();
  const ana = await phone('band-room-7');
  const paired = reply(ana, 'paired');
  ana.send({ t: 'pair', code: band.show.code });
  const { band: id } = await paired;
  await band.until((s) => s.kind === 'test');
  await band.until((s) => s.kind === 'off');
  const kinds = [];
  band.ws.on('message', (data) => { const m = JSON.parse(String(data)); if (m.t === 'show') kinds.push(m.show.kind); });
  const again = reply(ana, 'paired');
  ana.send({ t: 'pair', band: id });
  await again;
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.ok(!kinds.includes('test'), 'a re-claim flashed it: ' + kinds.join(','));
  close(ana);
  band.ws.close();
});

test('a venue is reclaimed the moment its last person leaves', async () => {
  const key = venueKey('gc-empty-venue');
  const ana = await phone('gc-empty-venue');
  assert.ok(relay.rooms.has(key), 'the room exists while someone is in it');
  ana.send({ t: 'leave' });
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(!relay.rooms.has(key), 'and is gone the moment they leave');
  close(ana);
});

test('a venue with someone still in it is not reclaimed when another leaves', async () => {
  const key = venueKey('gc-shared-venue');
  const ana = await phone('gc-shared-venue');
  const ben = await phone('gc-shared-venue');
  ana.send({ t: 'leave' });
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(relay.rooms.has(key), 'ben is still here, so the room stays');
  close(ana, ben);
});

test('the venue report log has a ceiling', async () => {
  const key = venueKey('report-flood');
  const ana = await phone('report-flood');
  for (let i = 0; i < 1500; i += 1) ana.send({ t: 'report', why: 'x' });
  await new Promise((r) => setTimeout(r, 500));
  const n = relay.rooms.get(key).room.reports().length;
  assert.equal(n, 1000, 'the log is capped at exactly its ceiling, saw ' + n);
  close(ana);
});

test('a full venue table refuses a new venue, but never evicts one in use', async () => {
  const small = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'dist'), maxRooms: 2 });
  const wsUrl = 'ws://127.0.0.1:' + small.port + WS_PATH;
  const opened = [];
  const open = async () => { const ws = new WebSocket(wsUrl); clients.add(ws); opened.push(ws); await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); }); return ws; };
  const joinReply = (ws, venue) => new Promise((resolve) => {
    const on = (d) => { const m = JSON.parse(String(d)); if (m.t === 'view' || m.t === 'error') { ws.off('message', on); resolve(m); } };
    ws.on('message', on);
    ws.send(JSON.stringify({ t: 'join', venue, me: randomBytes(16).toString('hex') }));
  });
  try {
    const a = await open(); assert.equal((await joinReply(a, 'venue-a')).t, 'view');
    const b = await open(); assert.equal((await joinReply(b, 'venue-b')).t, 'view');
    assert.equal(small.roomCount(), 2, 'two venues in use');
    const c = await open();
    assert.equal((await joinReply(c, 'venue-c')).why, 'too many venues', 'a third, with both in use, is refused');
    a.send(JSON.stringify({ t: 'leave' }));
    await new Promise((r) => setTimeout(r, 60));
    assert.equal((await joinReply(c, 'venue-c')).t, 'view', 'once one empties, the third gets in');
  } finally {
    for (const ws of opened) { try { ws.close(); } catch { /* gone */ } }
    await small.close();
  }
});

test('one socket switching venues is reclaimed, so it never trips the ceiling', async () => {
  // push() dedups identical views, so a switch between two empty venues sends no
  // new view — the proof a switch landed is that a fresh phone can meet it, not
  // a message per hop. Without the reclaim pass, the third switch is refused.
  const small = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'dist'), maxRooms: 2 });
  const wsUrl = 'ws://127.0.0.1:' + small.port + WS_PATH;
  const ws = new WebSocket(wsUrl);
  clients.add(ws);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'error') errors.push(m.why); });
  const me = randomBytes(16).toString('hex');
  try {
    for (const v of ['sw-1', 'sw-2', 'sw-3', 'sw-4', 'sw-5']) {
      ws.send(JSON.stringify({ t: 'join', venue: v, me }));
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.deepEqual(errors, [], 'no switch was refused');
    assert.ok(small.roomCount() <= 2, 'the table stayed within its ceiling, saw ' + small.roomCount());
    const other = new WebSocket(wsUrl);
    clients.add(other);
    await new Promise((res, rej) => { other.once('open', res); other.once('error', rej); });
    let near = 0;
    other.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'view') near = m.view.near.length; });
    ws.send(JSON.stringify({ t: 'arm', intent: 'hi' }));
    other.send(JSON.stringify({ t: 'join', venue: 'sw-5', me: randomBytes(16).toString('hex') }));
    other.send(JSON.stringify({ t: 'arm', intent: 'hi' }));
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(near >= 1, 'the switching socket really landed in the last venue');
    other.close();
  } finally {
    ws.close();
    await small.close();
  }
});

test('every served response says nosniff', async () => {
  assert.equal((await fetch(url('/api/shows'))).headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(url('/'))).headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(url('/app.js'))).headers.get('x-content-type-options'), 'nosniff');
});

test('malformed and hostile messages never take the relay down', async () => {
  const junk = await phone('fuzz-room');
  const bad = [
    42, 'a string', null, [], true, 3.14,
    { t: 'pair', code: 12345 }, { t: 'pair', band: {} }, { t: 'pair' }, { t: 'pair', code: null },
    { t: 'wave' }, { t: 'wave', handle: null }, { t: 'wave', handle: 123 }, { t: 'wave', handle: 'zzzzzzzzzz' },
    { t: 'like', handle: {} }, { t: 'unlike', handle: [] },
    { t: 'clip', mime: 'text/html', data: 'PGgxPg==' }, { t: 'clip' }, { t: 'clip', data: null, mime: null },
    { t: 'clip', mime: 'video/webm', data: 'not base64 %%%', to: 42 },
    { t: 'report', why: {} }, { t: 'report', handle: [] }, { t: 'report' },
    { t: 'keep', match: 'nope', on: true }, { t: 'keep' }, { t: 'keep', match: {}, on: 'yes' },
    { t: 'profile', name: {}, contact: [] }, { t: 'pick', track: {} }, { t: 'pick' },
    { t: 'block', handle: '\u0000' }, { t: 'block' }, { t: 'setBand', band: 999 },
    { t: 'arm', intent: 'nonsense' }, { t: 'invisible', on: 'yes' },
    { t: 'testLight' }, { t: 'unpair' }, { t: 'leave' }, { t: 'unknown-type', x: 1 },
  ];
  for (const m of bad) junk.send(m);
  // ...and raw non-JSON straight onto the wire.
  junk.ws.send('not json{');
  junk.ws.send('');
  junk.ws.send('{"t":');
  junk.ws.send('9'.repeat(5000));
  await new Promise((r) => setTimeout(r, 150));
  // The relay is still alive and forming rooms: this socket rejoins and meets a
  // fresh one — if the barrage had crashed the process, neither view would come.
  junk.send({ t: 'join', venue: 'fuzz-alive', me: randomBytes(16).toString('hex') });
  junk.send({ t: 'arm', intent: 'hi' });
  const mate = await phone('fuzz-alive');
  mate.send({ t: 'arm', intent: 'hi' });
  await mate.until((v) => v.near.length >= 1);
  await junk.until((v) => v.near.length >= 1);
  close(junk, mate);
});

test('one oversized frame ends its own socket and nothing else', async () => {
  const ana = await phone('roundhouse-bruno-mars');
  const ben = await phone('roundhouse-bruno-mars');
  const closed = new Promise((resolve) => ana.ws.once('close', resolve));
  ana.ws.send('x'.repeat(2_000_000));
  await closed;
  ben.send({ t: 'arm', intent: 'hi' });
  await ben.until((v) => v.me.armed === 'hi');
  const res = await fetch(url('/'));
  assert.equal(res.status, 200, 'the relay is still up');
  close(ben);
});

test('a join that is not one is refused, and a ping is answered', async () => {
  const ws = new WebSocket('ws://127.0.0.1:' + relay.port + WS_PATH);
  await new Promise((resolve) => ws.once('open', resolve));
  const replies = [];
  ws.on('message', (d) => replies.push(JSON.parse(String(d))));
  ws.send(JSON.stringify({ t: 'join', venue: 'x', me: 'not hex' }));
  ws.send(JSON.stringify({ t: 'ping' }));
  ws.send('{not json');
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(replies, [{ t: 'error', why: 'bad join' }, { t: 'pong' }]);
  ws.close();
});

test('the pages: the app for every route, no way out of dist, and tonight\'s shows', async () => {
  assert.match(await (await fetch(url('/'))).text(), /On The Beat/);
  assert.match(await (await fetch(url('/tonight'))).text(), /On The Beat/, 'a client route gets the app');
  for (const out of ['/..%2Fsecret.txt', '/..%5Csecret.txt', '/..%2Fdist-evil%2Fx.js', '/%E0%A4%A']) {
    const res = await fetch(url(out));
    assert.equal((await res.text()).includes('SECRET'), false, out + ' reached outside dist');
  }
  assert.equal((await fetch(url('/app.js'))).headers.get('content-type'), 'text/javascript');
  const shows = await (await fetch(url('/api/shows'))).json();
  assert.equal(shows[0].id, 'roundhouse-bruno-mars');
  assert.equal(shows[0].setlist.length, 6);
  assert.equal((await fetch(url('/clip/roundhouse-bruno-mars/nothing'))).status, 404);
});
