// ON THE BEAT — the relay over real sockets: rooms per venue, a view pushed
// to every phone on every change, clips, and a frame that cannot take it down.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { createRelay, WS_PATH, BAND_ALONE_MS, bandIdOf, personOf, venueKey } from '../relay/server.js';
import { helpers, newKey, pause } from './relay-harness.js';

let relay;
let base;
// Sockets a test opens by hand, so a failing test cannot leave one holding the run open.
const clients = new Set();
const url = (path) => 'http://127.0.0.1:' + relay.port + path;
const { phone, wristband, reply, pairBand, close, cleanup } = helpers(() => relay.port);

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
  cleanup();
  for (const ws of clients) ws.terminate();
  await relay.close();
  rmSync(base, { recursive: true, force: true });
});

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

test("a clip loads only for someone whose own view shows it: a blocked viewer's address stops at once, either way", async () => {
  const venue = 'the-grove-clip-block';
  const ana = await phone(venue);
  const ben = await phone(venue);
  const cai = await phone(venue);
  const get = (ref) => fetch(url('/clip/' + venue + '/' + ref)).then((r) => r.status);
  ana.send({ t: 'clip', mime: 'video/webm', data: randomBytes(1024).toString('base64') });
  const [forBen] = (await ben.until((v) => v.floor.length === 1)).floor;
  const [forCai] = (await cai.until((v) => v.floor.length === 1)).floor;
  assert.notEqual(forBen.ref, forCai.ref, 'each viewer has an address of their own');
  assert.equal(await get(forBen.ref), 200);
  assert.equal(await get(forCai.ref), 200);
  const own = (await ana.until((v) => v.me.clip)).me.clip;
  assert.equal(await get(own), 200, 'its owner can watch it too');

  // An address with no ticket, a wrong one, or a ticket for another clip loads nothing.
  const [raw, ticket] = forBen.ref.split('.');
  assert.equal(await get(raw), 404);
  assert.equal(await get(raw + '.' + '0'.repeat(ticket.length)), 404);
  cai.send({ t: 'clip', mime: 'video/webm', data: randomBytes(512).toString('base64') });
  const other = (await ben.until((v) => v.floor.length === 2)).floor.find((c) => c.ref !== forBen.ref);
  assert.equal(await get(other.ref.split('.')[0] + '.' + ticket), 404, "ben's ticket for ana's clip does not open cai's");

  // Ben blocks ana: his address for her clip stops; cai's does not.
  ben.send({ t: 'block', handle: forBen.handle });
  await ben.until((v) => !v.floor.some((c) => c.handle === forBen.handle));
  assert.equal(await get(forBen.ref), 404);
  assert.equal(await get(forCai.ref), 200);
  // Ana blocks cai: the other way, and the same.
  const caiToAna = (await ana.until((v) => v.floor.length === 1)).floor[0].handle;
  ana.send({ t: 'block', handle: caiToAna });
  await cai.until((v) => !v.floor.some((c) => c.handle === forCai.handle));
  assert.equal(await get(forCai.ref), 404);
  assert.equal(await get(own), 200);
  close(ana, ben, cai);
});

test("a clip's address follows its viewer's view: not while its owner is NOT NOW or once its viewer has left, and a browser must ask each time", async () => {
  const venue = 'the-grove-clip-view';
  const ana = await phone(venue);
  const ben = await phone(venue);
  ana.send({ t: 'clip', mime: 'video/webm', data: randomBytes(1024).toString('base64') });
  const [tile] = (await ben.until((v) => v.floor.length === 1)).floor;
  const at = url('/clip/' + venue + '/' + tile.ref);
  const first = await fetch(at);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'private, no-cache', 'a browser asks again before it plays it again');
  const etag = first.headers.get('etag');
  assert.ok(etag);
  assert.equal((await fetch(at, { headers: { 'if-none-match': etag } })).status, 304, 'still allowed: nothing to send again');

  ana.send({ t: 'invisible', on: true });
  await ben.until((v) => v.floor.length === 0);
  assert.equal((await fetch(at)).status, 404, 'its owner is NOT NOW');
  assert.equal((await fetch(at, { headers: { 'if-none-match': etag } })).status, 404, 'and asking again is refused too');
  ana.send({ t: 'invisible', on: false });
  await ben.until((v) => v.floor.length === 1);
  assert.equal((await fetch(at)).status, 200, 'back on the floor, the same address loads again');

  const left = new Promise((resolve) => ben.ws.on('message', (d) => { if (JSON.parse(String(d)).t === 'left') resolve(); }));
  ben.send({ t: 'leave' });
  await left;
  assert.equal((await fetch(at)).status, 404, 'its viewer has left the room');
  close(ana, ben);
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

test("every room's clips together stay under the machine's cap: the oldest go first, wherever they are", async () => {
  // On a small always-on machine one room's cap is not the limit that
  // matters: clips posted across many venues would fill its memory and stop
  // the relay for everyone. The oldest anywhere goes, and its floor with it.
  const small = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'dist'), allClipsMax: 3 * 4096 });
  const h = helpers(() => small.port);
  const at = (venue, ref) => fetch('http://127.0.0.1:' + small.port + '/clip/' + venue + '/' + ref).then((r) => r.status);
  try {
    const ana = await h.phone('cap-a');
    const ben = await h.phone('cap-a');
    const cai = await h.phone('cap-b');
    const dee = await h.phone('cap-b');
    const eve = await h.phone('cap-b');
    const post = (p) => p.send({ t: 'clip', mime: 'video/webm', data: randomBytes(4096).toString('base64') });
    post(ana);
    const [a1] = (await ben.until((v) => v.floor.length === 1)).floor;
    post(cai);
    const [b1] = (await dee.until((v) => v.floor.length === 1)).floor;
    post(dee);
    const b2 = (await cai.until((v) => v.floor.length === 1)).floor[0];
    assert.equal(await at('cap-a', a1.ref), 200, 'three clips fit the cap exactly');
    // The fourth is posted in the other room: the oldest goes from a room
    // nothing was said in, and that room's phones are told.
    post(eve);
    await cai.until((v) => v.floor.length === 2);
    await ben.until((v) => v.floor.length === 0);
    assert.equal(await at('cap-a', a1.ref), 404, 'the oldest clip, in another room, went for the newest');
    assert.equal(await at('cap-b', b1.ref), 200);
    assert.equal(await at('cap-b', b2.ref), 200);
    h.close(ana, ben, cai, dee, eve);
  } finally {
    h.cleanup();
    await small.close();
  }
});

test('left to itself the relay holds 40 MB of video at most: the margin a 207 MB Fly machine needs, measured in a cgroup', async () => {
  // A hundred floor clips of five seconds at 600 kbit/s are 37.5 MB, so 40 MB is a venue of a hundred on the floor and no
  // more. In a real 207 MB cgroup (scripts/load.mjs --cgroup-mem 207M --clip-kb 375) a hundred phones posting clips reached
  // 178 MB of memory with a store held to 96 MB and 161 MB with 40: the cap is the margin. Here two venues of twenty phones
  // each send 1.1 MB, the way a phone with a busy camera might: 44 MB, so the oldest must go, in either room, and what is
  // held is whole clips under the cap.
  const relay = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'dist') });
  const h = helpers(() => relay.port);
  try {
    const clip = 1_100_000;
    const phones = [];
    for (let i = 0; i < 40; i += 1) phones.push(await h.phone(i % 2 ? 'cap-left' : 'cap-right'));
    for (const p of phones) {
      p.send({ t: 'clip', mime: 'video/webm', data: randomBytes(clip).toString('base64') });
      await p.until((v) => v.me.clip);
    }
    assert.equal(relay.clipBytes(), 36 * clip, 'the thirty-seventh clip made the oldest go, and the next ones the next');
    assert.ok(relay.clipBytes() <= 40_000_000);
    h.close(...phones);
  } finally {
    h.cleanup();
    await relay.close();
  }
});

// One socket used to be able to send a clip frame (up to 1.2 MB) as fast as its frame budget let any message through, 20 a
// second: 24 MB a second to parse, decode and push (README, abuse resistance, the video bullet). Nothing but a clip comes
// near 64 KB, so a frame that big is charged to a budget of its own as it arrives, before it is parsed: three at once,
// then one back every `clipEveryMs`. A phone records five seconds a clip, so it never meets the limit.
const bigClip = (n) => ({ t: 'clip', mime: 'video/webm', data: randomBytes(n).toString('base64') });

test('a socket may send three big clips at once, and the fourth is turned away unread and unkept', async () => {
  const slow = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'dist'), clipEveryMs: 600_000 });
  const h = helpers(() => slow.port);
  try {
    const ana = await h.phone('clip-pace');
    const ben = await h.phone('clip-pace');
    for (let i = 0; i < 3; i += 1) ana.send(bigClip(100_000));
    await ana.until((v, p) => p.sent.length === 3);
    assert.equal(slow.clipBytes(), 100_000, 'a person has one clip on the floor: the third replaced the first two');
    ana.send(bigClip(90_000));
    await ana.until((v, p) => p.errors.includes('clip too fast'));
    assert.equal(slow.clipBytes(), 100_000, 'the fourth was not kept, or it would have replaced the third');
    assert.equal(ana.sent.length, 3, 'and it was not answered as sent');
    assert.equal(ana.ws.readyState, WebSocket.OPEN, 'it is turned away, not cut off');
    // The room goes on, and so does the other phone, whose own budget is full.
    ben.send(bigClip(100_000));
    await ben.until((v, p) => p.sent.length === 1);
    h.close(ana, ben);
  } finally {
    h.cleanup();
    await slow.close();
  }
});

test('the clip budget earns one back every clipEveryMs', async () => {
  const quick = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'dist'), clipEveryMs: 400 });
  const h = helpers(() => quick.port);
  try {
    const ana = await h.phone('clip-refill');
    // A socket idle for longer than the pace is still only ever three ahead, not more for every moment it sat there.
    await pause(450);
    for (let i = 0; i < 4; i += 1) ana.send(bigClip(100_000));
    await ana.until((v, p) => p.errors.includes('clip too fast') && p.sent.length === 3);
    await pause(500);
    ana.send(bigClip(100_000));
    await ana.until((v, p) => p.sent.length === 4);
    assert.deepEqual(ana.errors, ['clip too fast'], 'one refusal in all');
    h.close(ana);
  } finally {
    h.cleanup();
    await quick.close();
  }
});

test('a small clip, and anything else a phone says, is outside the clip budget', async () => {
  const slow = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'dist'), clipEveryMs: 600_000 });
  const h = helpers(() => slow.port);
  try {
    const ana = await h.phone('clip-small');
    for (let i = 0; i < 10; i += 1) ana.send({ t: 'clip', mime: 'video/webm', data: randomBytes(2048).toString('base64') });
    await ana.until((v, p) => p.sent.length === 10);
    assert.deepEqual(ana.errors, []);
    h.close(ana);
  } finally {
    h.cleanup();
    await slow.close();
  }
});

test('a big frame is charged as it arrives, so one that is not even JSON spends the budget too', async () => {
  const slow = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'dist'), clipEveryMs: 600_000 });
  const h = helpers(() => slow.port);
  try {
    const eve = await h.phone('clip-junk');
    // Unparseable, so nothing is said back while the budget lasts; the fourth is answered, which only a charge made
    // before the parse can do.
    for (let i = 0; i < 3; i += 1) eve.ws.send('x'.repeat(100_000));
    await pause(100);
    assert.deepEqual(eve.errors, []);
    eve.ws.send('x'.repeat(100_000));
    await eve.until((v, p) => p.errors.includes('clip too fast'));
    h.close(eve);
  } finally {
    h.cleanup();
    await slow.close();
  }
});

test('a wristband pairs by its four letters, then shows what its person is doing', async () => {
  const band = await wristband();
  assert.equal(band.show.kind, 'pairing');
  const { code } = band.show;
  assert.match(code, /^[A-HJKMNP-Z]{4}$/);
  const ana = await phone('band-room-1');
  const wrong = reply(ana, 'error');
  ana.send({ t: 'pair', code: 'ZZZZ' === code ? 'YYYY' : 'ZZZZ' });
  assert.equal((await wrong).why, 'no such wristband');
  ana.send({ t: 'pair', code: code.toLowerCase() });
  const { me: { check } } = await ana.until((v) => v.me.check);
  await band.until((s) => s.kind === 'check' && s.big === String(check));
  const paired = reply(ana, 'paired');
  ana.send({ t: 'confirm', yes: true });
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

test('a wristband turns away a check it did not expect: new letters at once, the phone that typed is told, and its owner pairs', async () => {
  const band = await wristband();
  const { code } = band.show;
  const eve = await phone('band-room-away');
  const ana = await phone('band-room-away');
  // Someone who read the letters off the wrist types them first, and holds the check.
  eve.send({ t: 'pair', code });
  const { me: { check } } = await eve.until((v) => v.me.check);
  await band.until((s) => s.kind === 'check' && s.big === String(check));
  const busy = reply(ana, 'error');
  ana.send({ t: 'pair', code });
  assert.equal((await busy).why, 'busy');
  // Its owner holds the face button on the number they did not ask for.
  const told = reply(eve, 'check');
  band.send({ t: 'refuse', number: String(check) });
  assert.deepEqual(await told, { t: 'check', ok: false, why: 'refused' });
  const fresh = await band.until((s) => s.kind === 'pairing' && s.code !== code);
  await eve.until((v) => !v.me.check);
  const gone = reply(eve, 'error');
  eve.send({ t: 'pair', code });
  assert.equal((await gone).why, 'no such wristband', 'the letters that were read are gone');
  await pairBand(ana, band);
  assert.notEqual(fresh.code, code);
  close(ana, eve);
  band.ws.close();
});

test('a turn-away lands only on the check its wrist shows: not another number, not malformed, not another band, not after YES', async () => {
  const band = await wristband();
  const other = await wristband();
  const ana = await phone('band-room-away-2');
  ana.send({ t: 'pair', code: band.show.code });
  const { me: { check } } = await ana.until((v) => v.me.check);
  await band.until((s) => s.kind === 'check' && s.big === String(check));
  for (const m of [
    { t: 'refuse', number: String(check === 99 ? 98 : check + 1) },   // a check it no longer shows
    { t: 'refuse', number: check },                                    // not the two digits as said
    { t: 'refuse', number: '0' + String(check).slice(1) },
    { t: 'refuse' },
  ]) band.send(m);
  other.send({ t: 'refuse', number: String(check) });   // a band can turn away only its own
  ana.send({ t: 'refuse', number: String(check) });     // and a phone none at all
  await pause(300);
  assert.equal(band.show.kind, 'check');
  assert.equal(ana.view.me.check, check);
  // YES lands first; the hold that arrives after it unpairs nothing.
  const paired = reply(ana, 'paired');
  ana.send({ t: 'confirm', yes: true });
  await paired;
  await band.until((s, bb) => s.kind === 'off' && bb.secret);
  band.send({ t: 'refuse', number: String(check) });
  await pause(300);
  assert.equal(band.show.kind, 'off');
  await ana.until((v) => v.me.wristband?.live);
  close(ana);
  band.ws.close();
  other.ws.close();
});

test("holding the wristband's button is NOT NOW, and a phone coming back does not undo it", async () => {
  const band = await wristband();
  const ana = await phone('band-room-2');
  const ben = await phone('band-room-2');
  await pairBand(ana, band);
  ana.send({ t: 'arm', intent: 'hi' });
  await ben.until((v) => v.near.length === 1);
  band.send({ t: 'hold' });
  await ana.until((v) => v.me.invisible && v.me.by === 'band');
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
  await pairBand(ana, b1);
  await pairBand(ben, b2);
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

test('a phone re-claims by the id and the secret it was given; nobody else can use them', async () => {
  const band = await wristband();
  const ana = await phone('band-room-4');
  const { band: id, secret } = await pairBand(ana, band);
  const again = reply(ana, 'claim');
  ana.send({ t: 'pair', band: id, secret });
  assert.deepEqual(await again, { t: 'claim', ok: true, band: id }, 'the phone that paired it can say so again');
  const ben = await phone('band-room-4');
  const no = reply(ben, 'claim');
  ben.send({ t: 'pair', band: id, secret });
  assert.equal((await no).why, 'gone', 'a paired wristband is not taken by another phone, secret or not');
  close(ana, ben);
  band.ws.close();
});

test('a phone back before its wristband holds the claim, and the wristband comes back paired', async () => {
  // What a relay restart looks like from here: an id this relay has never seen.
  const ana = await phone('band-room-5');
  const key = newKey();
  const id = bandIdOf(key);
  const secret = newKey();
  const held = reply(ana, 'claim');
  ana.send({ t: 'pair', band: id, secret, again: true });
  assert.deepEqual(await held, { t: 'claim', ok: false, why: 'waiting' });
  await ana.until((v) => v.me.wristband?.live === false);
  ana.send({ t: 'arm', intent: 'hi' });
  const band = await wristband(40, { key, secret });
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
  ana.send({ t: 'pair', code });
  assert.ok((await ana.until((v) => v.me.check)).me.check, 'the letters still reach it inside the grace window');
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
    const ok = reply(ana, 'claim');
    ana.send({ t: 'pair', band: randomBytes(16).toString('hex'), secret: newKey() });
    assert.equal((await ok).why, 'waiting', 'attempt ' + i + ' should be answered');
  }
  const blocked = reply(ana, 'error');
  ana.send({ t: 'pair', band: randomBytes(16).toString('hex'), secret: newKey() });
  assert.equal((await blocked).why, 'too many tries', 'the sixth is refused');
  close(ana);
});

test('a missed code is throttled on the same counter as an id-claim', async () => {
  relay.expire(Date.now() + 61_000);
  const ana = await phone('band-guess-2', { ip: '203.0.113.8' });
  // Four id-claims, then a missed code, then one more claim: the sixth unproven
  // attempt is refused no matter which kind each one was.
  for (let i = 0; i < 4; i += 1) {
    const ok = reply(ana, 'claim');
    ana.send({ t: 'pair', band: randomBytes(16).toString('hex'), secret: newKey() });
    await ok;
  }
  const miss = reply(ana, 'error');
  ana.send({ t: 'pair', code: 'ZZZZ' });
  assert.equal((await miss).why, 'no such wristband', 'a wrong code still answers honestly under the cap');
  const blocked = reply(ana, 'error');
  ana.send({ t: 'pair', band: randomBytes(16).toString('hex'), secret: newKey() });
  assert.equal((await blocked).why, 'too many tries');
  close(ana);
});

/** A phone that only guesses: its own headers, joined to a venue, sending id-claims nothing answers. */
async function guesser(port, headers, venue) {
  const ws = new WebSocket('ws://127.0.0.1:' + port + WS_PATH, { headers });
  clients.add(ws);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ t: 'join', venue, me: randomBytes(16).toString('hex') }));
  return { ws, claim: () => ws.send(JSON.stringify({ t: 'pair', band: randomBytes(16).toString('hex'), secret: newKey() })) };
}

/** Twenty unproven attempts from one address, over four sockets: the address's whole allowance. */
async function spend(at, ip, venue) {
  for (let s = 0; s < 4; s += 1) {
    const g = await at(ip, venue + '-' + s);
    for (let i = 0; i < 5; i += 1) {
      const ok = reply(g, 'claim');
      g.claim();
      assert.equal((await ok).why, 'waiting', 'attempt ' + (s * 5 + i) + ' should be answered');
    }
    g.ws.close();
  }
}

test('behind a proxy that names each client, the named address is what the limit counts', async () => {
  // On Fly.io every socket comes from its proxy, which names the client in
  // Fly-Client-IP. Counted by the proxy's own address, one guesser would lock
  // every phone out of pairing; told the header, the relay counts each apart.
  const proxied = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'dist'), clientIpHeader: 'fly-client-ip' });
  const at = (ip, venue) => guesser(proxied.port, { 'fly-client-ip': ip }, venue);
  try {
    await spend(at, '203.0.113.50', 'proxied');
    const same = await at('203.0.113.50', 'proxied-4');
    const blocked = reply(same, 'error');
    same.claim();
    assert.equal((await blocked).why, 'too many tries', 'the named address has had its twenty');
    const other = await at('203.0.113.51', 'proxied-5');
    const ok = reply(other, 'claim');
    other.claim();
    assert.equal((await ok).why, 'waiting', 'another client behind the same proxy is counted apart');
  } finally {
    await proxied.close();
  }
});

test('without that setting, a client-address header is a claim anyone can make', async () => {
  relay.expire(Date.now() + 61_000);
  const at = (ip, venue) => guesser(relay.port, { 'fly-client-ip': ip }, venue);
  await spend(at, '203.0.113.60', 'unproxied');
  const other = await at('203.0.113.61', 'unproxied-4');
  const blocked = reply(other, 'error');
  other.claim();
  assert.equal((await blocked).why, 'too many tries', "the socket's own address stands, whatever the header says");
  relay.expire(Date.now() + 61_000);
});

test('id-claims with no wristband behind them are swept, so they cannot pile up', async () => {
  // One person holds one band, so a real pile-up needs many sockets: three
  // phones make three placeholders, and the sweep clears every one.
  relay.expire(Date.now() + 61_000);           // clear the tries and any old placeholders
  const before = relay.bandCount();
  const phones = [];
  for (let i = 0; i < 3; i += 1) {
    const ph = await phone('band-phantom-' + i);
    const ok = reply(ph, 'claim');
    ph.send({ t: 'pair', band: randomBytes(16).toString('hex'), secret: newKey() });
    await ok;
    phones.push(ph);
  }
  assert.ok(relay.bandCount() >= before + 3, 'three placeholders now exist, saw ' + relay.bandCount() + ' vs ' + before);
  relay.expire(Date.now() + BAND_ALONE_MS + 1_000);   // a placeholder is kept for the hour
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
    const key = newKey();
    band.send(JSON.stringify({ t: 'wristband', id: bandIdOf(key), key, v: 2, battery: 88 }));
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
      ph.send(JSON.stringify({ t: 'pair', band: randomBytes(16).toString('hex'), secret: newKey() }));
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.ok(small.bandCount() <= 3, 'the table never grew past its ceiling, saw ' + small.bandCount());

    // The live wristband was never the one evicted: a fresh phone can still pair
    // by the letters it is still showing.
    const late = await open();
    const lateMe = randomBytes(16).toString('hex');
    let checked = null, refused = null;
    late.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'view' && m.view.me.check) checked = m.view.me.check; if (m.t === 'error') refused = m.why; });
    late.send(JSON.stringify({ t: 'join', venue: 'cap-late', me: lateMe }));
    await new Promise((r) => setTimeout(r, 60));
    late.send(JSON.stringify({ t: 'pair', code }));
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(checked && !refused, 'the connected wristband survived the flood (refused: ' + refused + ')');
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
  const { band: id, secret } = await pairBand(ana, band);
  await band.until((s) => s.kind === 'test');
  await band.until((s) => s.kind === 'off');
  const kinds = [];
  band.ws.on('message', (data) => { const m = JSON.parse(String(data)); if (m.t === 'show') kinds.push(m.show.kind); });
  const again = reply(ana, 'claim');
  ana.send({ t: 'pair', band: id, secret });
  assert.equal((await again).ok, true);
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

test('a burst of changes in a room goes out as a view or two, not one each, and the last change always arrives', async () => {
  const ana = await phone('burst-room');
  const ben = await phone('burst-room');
  let views = 0;
  ben.ws.on('message', (d) => { if (JSON.parse(String(d)).t === 'view') views += 1; });
  for (let i = 0; i < 30; i += 1) ana.send({ t: 'pick', track: 'track ' + i });
  await ben.until((v) => v.wall.some((p) => p.pick === 'track 29'));
  await pause(250);
  assert.ok(views <= 3, 'thirty picks reached ben as ' + views + ' views');
  // Spread out, one every 20 ms for 400 ms: the room still pushes at most every PUSH_GAP_MS.
  views = 0;
  for (let i = 0; i < 20; i += 1) { ana.send({ t: 'pick', track: 'spread ' + i }); await pause(20); }
  await ben.until((v) => v.wall.some((p) => p.pick === 'spread 19'));
  await pause(250);
  assert.ok(views <= 8, 'twenty picks over 400 ms reached ben as ' + views + ' views');
  close(ana, ben);
});

test('a room whose views cost a lot to work out sends them less often, so the relay is never busy with nothing else', async () => {
  // Every reading of the clock moves it 60 ms: a push (one reading before it, one after) costs 60 ms. With a slack of 4
  // the room waits four times that, 240 ms, between pushes, where a cheap room waits PUSH_GAP_MS, 100.
  let tick = 0;
  const costly = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'dist'), pushClock: () => (tick += 60), pushSlack: 4 });
  const h = helpers(() => costly.port);
  try {
    const ana = await h.phone('costly-room');
    const ben = await h.phone('costly-room');
    const seen = new Map();
    ben.ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.t !== 'view') return;
      for (const p of m.view.wall) if (!seen.has(p.pick)) seen.set(p.pick, Date.now());
    });
    await pause(600);   // whatever the joins cost is paid off
    ana.send({ t: 'pick', track: 'first' });
    await ben.until((v) => v.wall.some((p) => p.pick === 'first'));
    ana.send({ t: 'pick', track: 'second' });
    await ben.until((v) => v.wall.some((p) => p.pick === 'second'));
    const apart = seen.get('second') - seen.get('first');
    assert.ok(apart >= 200, 'two pushes were ' + apart + ' ms apart, where a room that costs 60 ms to push waits 240');
    h.close(ana, ben);
  } finally {
    h.cleanup();
    await costly.close();
  }
});

test("however much a push costs, a room's views are held no longer than two seconds", async () => {
  // A push that costs a second would wait four, uncapped.
  let tick = 0;
  const choked = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'dist'), pushClock: () => (tick += 1000), pushSlack: 4 });
  const h = helpers(() => choked.port);
  try {
    const ana = await h.phone('choked-room');
    const ben = await h.phone('choked-room');
    const seen = new Map();
    ben.ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.t !== 'view') return;
      for (const p of m.view.wall) if (!seen.has(p.pick)) seen.set(p.pick, Date.now());
    });
    await pause(2300);
    ana.send({ t: 'pick', track: 'first' });
    await ben.until((v) => v.wall.some((p) => p.pick === 'first'));
    ana.send({ t: 'pick', track: 'second' });
    await ben.until((v) => v.wall.some((p) => p.pick === 'second'), 3500);
    const apart = seen.get('second') - seen.get('first');
    assert.ok(apart >= 1800 && apart < 3000, 'two pushes were ' + apart + ' ms apart, where the cap is 2000');
    h.close(ana, ben);
  } finally {
    h.cleanup();
    await choked.close();
  }
});

test('a socket sending far faster than any phone or wristband is closed as too fast, and the room goes on', async () => {
  const ana = await phone('fast-room');
  const eve = await phone('fast-room');
  const closed = new Promise((resolve) => eve.ws.once('close', (code) => resolve(code)));
  for (let i = 0; i < 100; i += 1) eve.ws.send('{"t":"ping"}');
  assert.equal(await Promise.race([closed, pause(3000).then(() => 'still open')]), 4003);
  ana.send({ t: 'arm', intent: 'hi' });
  const ben = await phone('fast-room');
  await ben.until((v) => v.near.length === 1);
  close(ana, ben);
});

test("a phone's own pace is nowhere near too fast: a reconnect's burst, then ten a second", async () => {
  const ana = await phone('pace-room');
  let pongs = 0;
  ana.ws.on('message', (d) => { if (JSON.parse(String(d)).t === 'pong') pongs += 1; });
  // More than a phone ever says at once after a reconnect: the join, every fact again, and what was queued.
  for (let i = 0; i < 30; i += 1) ana.ws.send('{"t":"ping"}');
  for (let i = 0; i < 20; i += 1) { await pause(100); ana.ws.send('{"t":"ping"}'); }
  await pause(200);
  assert.equal(ana.ws.readyState, WebSocket.OPEN);
  assert.equal(pongs, 50);
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

test("a socket that joins again as someone else leaves as who it was: its old self is on nobody's SAY HI", async () => {
  const ana = await phone('orphan-same');
  const ben = await phone('orphan-same');
  ben.send({ t: 'arm', intent: 'hi' });
  await ana.until((v) => v.near.length === 1);
  // The same socket, a new person. Whoever it stood for had no other phone and no wristband: gone, not left
  // standing with no socket and no grace, on SAY HI for as long as the venue is busy.
  ben.send({ t: 'join', venue: 'orphan-same', me: randomBytes(16).toString('hex') });
  await ana.until((v) => v.near.length === 0);
  assert.equal(relay.rooms.get(venueKey('orphan-same')).room.size(), 2, 'ana and whoever the socket is now');
  close(ana, ben);
});

test('a socket that moves to another venue leaves the first as it goes, though others are still there', async () => {
  const ana = await phone('orphan-from');
  const ben = await phone('orphan-from');
  ben.send({ t: 'arm', intent: 'hi' });
  await ana.until((v) => v.near.length === 1);
  ben.send({ t: 'join', venue: 'orphan-to', me: ben.me });
  await ana.until((v) => v.near.length === 0);
  assert.ok(!relay.rooms.get(venueKey('orphan-from')).room.has(personOf(ben.me)));
  assert.ok(relay.rooms.get(venueKey('orphan-to')).room.has(personOf(ben.me)), 'and is in the second');
  close(ana, ben);
});

test('a socket that moves on leaves its person in the room while another phone or a live wristband of theirs is there', async () => {
  const ana = await phone('orphan-held');
  const ben = await phone('orphan-held');
  const benToo = await phone('orphan-held', { me: ben.me });
  ben.send({ t: 'arm', intent: 'hi' });
  await ana.until((v) => v.near.length === 1);
  ben.send({ t: 'join', venue: 'orphan-elsewhere', me: ben.me });
  await pause(300);
  assert.equal(ana.view.near.length, 1, 'their other phone holds them');
  const cai = await phone('orphan-held');
  const band = await wristband();
  await pairBand(cai, band);
  cai.send({ t: 'arm', intent: 'hi' });
  await ana.until((v) => v.near.length === 2);
  cai.send({ t: 'join', venue: 'orphan-elsewhere', me: cai.me });
  await pause(300);
  assert.equal(ana.view.near.length, 2, 'a live wristband holds them, as it does a phone that closed');
  close(ana, ben, benToo, cai);
  band.ws.close();
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
    { t: 'confirm' }, { t: 'confirm', yes: 'yes' }, { t: 'pair', band: 'x', secret: {} },
    { t: 'wave' }, { t: 'wave', handle: null }, { t: 'wave', handle: 123 }, { t: 'wave', handle: 'zzzzzzzzzz' },
    { t: 'like', handle: {} }, { t: 'unlike', handle: [] },
    { t: 'clip', mime: 'text/html', data: 'PGgxPg==' }, { t: 'clip' }, { t: 'clip', data: null, mime: null },
    { t: 'clip', mime: 'video/webm', data: 'not base64 %%%', to: 42 },
    { t: 'report', why: {} }, { t: 'report', handle: [] }, { t: 'report' },
    { t: 'keep', match: 'nope', on: true }, { t: 'keep' }, { t: 'keep', match: {}, on: 'yes' },
    { t: 'profile', name: {}, contact: [] }, { t: 'pick', track: {} }, { t: 'pick' },
    { t: 'block', handle: '\u0000' }, { t: 'block' }, { t: 'setBand', band: 999 },
    { t: 'arm', intent: 'nonsense' }, { t: 'invisible', on: 'yes' }, { t: 'set', intent: 'hi', basis: 1 },
    { t: 'arm', intent: 'hi', seq: 'x' }, { t: 'invisible', on: true, seq: null }, { t: 'arm', intent: 'hi', basis: 'x' },
    { t: 'testLight' }, { t: 'unpair' }, { t: 'leave' }, { t: 'unknown-type', x: 1 },
  ];
  for (const m of bad) junk.send(m);
  // ...and raw non-JSON straight onto the wire.
  junk.ws.send('not json{');
  junk.ws.send('');
  junk.ws.send('{"t":');
  junk.ws.send('9'.repeat(5000));
  await new Promise((r) => setTimeout(r, 150));
  // The relay is still alive and forming rooms: two fresh phones meet — if the barrage had crashed the process,
  // neither view would come. (Fifty frames at once is also too fast, so the barrage's own socket may be closed.)
  const one = await phone('fuzz-alive');
  one.send({ t: 'arm', intent: 'hi' });
  const mate = await phone('fuzz-alive');
  mate.send({ t: 'arm', intent: 'hi' });
  await mate.until((v) => v.near.length >= 1);
  await one.until((v) => v.near.length >= 1);
  close(junk, one, mate);
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

/** The status a handshake with this Origin (none when undefined) is answered: 101 when it opens. */
function handshake(origin) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://127.0.0.1:' + relay.port + WS_PATH, origin === undefined ? undefined : { origin });
    ws.on('open', () => { resolve(101); ws.close(); });
    ws.on('unexpected-response', (req, res) => { resolve(res.statusCode); res.resume(); });
    ws.on('error', () => {});
  });
}

test('a page of another site cannot open the socket; this site\'s pages, the wristband and tools with no Origin can', async () => {
  const host = '127.0.0.1:' + relay.port;
  for (const origin of [undefined, 'file://', 'http://' + host, 'http://localhost:5178', 'http://127.0.0.1:1', 'http://[::1]:5178']) {
    assert.equal(await handshake(origin), 101, String(origin));
  }
  for (const origin of ['https://evil.example', 'null', 'http://' + host + '.evil.example', 'http://localhost.evil.example', 'ftp://' + host, 'not a url']) {
    assert.equal(await handshake(origin), 403, JSON.stringify(origin));
  }
});
