// ON THE BEAT — the relay decides: who is in the room, and which re-said fact counts.
// One test per guard; each was mutation-checked (docs/abuse-resistance.md).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createRelay, WS_PATH, BAND_ALONE_MS } from '../relay/server.js';
import { helpers, newKey, pause } from './relay-harness.js';

const dir = mkdtempSync(join(tmpdir(), 'otb-rules-'));
const relays = [];
let current = null;
const { phone, wristband, reply, pairBand, close, cleanup } = helpers(() => current.port);

/** A relay of the test's own, so its grace and its clock are the test's. */
async function relayWith(options = {}) {
  current = await createRelay({ port: 0, host: '127.0.0.1', root: dir, ...options });
  relays.push(current);
  return current;
}
after(async () => {
  cleanup();
  for (const r of relays) await r.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Someone in a room with a wristband paired, and a second phone that sees them. */
async function pairedWithWatcher(venue) {
  const band = await wristband();
  const ana = await phone(venue);
  const ben = await phone(venue);
  const { secret } = await pairBand(ana, band);
  ana.send({ t: 'arm', intent: 'hi' });
  await ben.until((v) => v.near.length === 1);
  return { band, ana, ben, secret };
}

// ---------- rule 2: the grace, the band-alone hour, 06:00 ----------

test('a live wristband holds its person: no grace when their phone drops', async () => {
  await relayWith({ graceMs: 100 });
  const { band, ana, ben } = await pairedWithWatcher('hold-room');
  ana.ws.close();
  await pause(400);
  assert.equal(ben.view.near.length, 1, 'still in the room, past the grace');
  close(ben, band);
});

test('a wristband that closes with no phone open starts the grace, and they leave when it runs out', async () => {
  await relayWith({ graceMs: 150 });
  const { band, ana, ben } = await pairedWithWatcher('band-grace');
  ana.ws.close();
  await pause(100);
  band.ws.close();
  await pause(60);
  assert.equal(ben.view.near.length, 1, 'not yet');
  await ben.until((v) => v.near.length === 0, 1000);
  close(ben);
});

test('a wristband coming back stops the grace', async () => {
  await relayWith({ graceMs: 200 });
  const { band, ana, ben, secret } = await pairedWithWatcher('band-back');
  band.ws.close();
  await pause(50);
  ana.ws.close();                          // no phone, no wristband: the grace starts
  await pause(50);
  const back = await wristband(62, { key: band.key, secret });
  await pause(400);
  assert.equal(ben.view.near.length, 1, 'the wristband came back in time');
  close(ben, back);
});

test('one grace timer per person: phone drops, band drops twice, and close() leaves none', async () => {
  const timers = () => process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length;
  await pause(300);   // the graces the tests before this one left running have all run out
  const before = timers();
  const relay = await relayWith({ graceMs: 400 });
  const { band, ana, ben, secret } = await pairedWithWatcher('one-timer');
  band.ws.close();                          // their phone is open: no grace
  await pause(30);
  ana.ws.close();                           // and now no wristband either: a grace
  await pause(200);
  const back = await wristband(62, { key: band.key, secret });   // the wristband stops it
  back.ws.close();                          // and drops again: a new grace, from now
  await pause(300);                         // the first would have run out by now
  assert.equal(ben.view.near.length, 1, 'only the newest grace counts');
  await ben.until((v) => v.near.length === 0, 1500);
  const cai = await phone('one-timer');
  cai.ws.close();                           // a grace still running when the relay closes
  const dan = await phone('one-timer');
  const worn = await wristband();
  await pairBand(dan, worn);
  dan.ws.close();                           // held by a live wristband when the relay closes
  await pause(50);
  close(ben);
  await relay.close();
  await pause(50);
  assert.ok(timers() <= before, 'close() left a timer behind');
});

test('held only by a wristband, a person leaves BAND_ALONE_MS after a phone of theirs was last heard', async () => {
  // 21:00, well clear of 06:00: only the hour can end it. On the wall clock this
  // test failed whenever it ran between 05:01 and 06:00.
  let t = new Date(2026, 8, 24, 21, 0).getTime();
  const relay = await relayWith({ clock: () => t });
  const { ana, ben } = await pairedWithWatcher('alone-hour');   // in the room at 21:00
  t += 30 * 60_000;
  ana.send({ t: 'ping' });   // heard at 21:30: a ping counts, as any message does
  await pause(50);
  ana.ws.close();
  await pause(50);
  relay.expire(t + BAND_ALONE_MS - 60_000);
  await pause(50);
  assert.equal(ben.view.near.length, 1, 'not yet: the hour runs from the ping, not from the join');
  t += BAND_ALONE_MS;
  ben.send({ t: 'ping' });   // ben is heard now; ana was not
  relay.expire(t + 1_000);
  await ben.until((v) => v.near.length === 0);
  close(ben);
});

test("held only by a wristband, a person leaves at 06:00 on the relay's clock", async () => {
  let t = new Date(2026, 8, 25, 5, 45).getTime();
  const relay = await relayWith({ clock: () => t });
  const { ana, ben } = await pairedWithWatcher('six-local');
  ana.ws.close();
  await pause(50);
  relay.expire(new Date(2026, 8, 25, 5, 59).getTime());
  await pause(50);
  assert.equal(ben.view.near.length, 1, 'not before six');
  t = new Date(2026, 8, 25, 6, 1).getTime();
  relay.expire(t);
  // Someone arriving now finds her gone. (ben, there since 05:45, has had his night ended too.)
  const cai = await phone('six-local');
  assert.equal(cai.view.near.length, 0);
  close(ben, cai);
});

test('06:00 is in nightTz, the venue\'s time zone', async () => {
  // 19:45 UTC is 05:45 in Brisbane; 20:35 UTC is 06:35 there. Fifty minutes, not the hour.
  let t = Date.UTC(2026, 8, 24, 19, 45);
  for (const [tz, leaves] of [['Australia/Brisbane', true], ['UTC', false]]) {
    t = Date.UTC(2026, 8, 24, 19, 45);
    const relay = await relayWith({ clock: () => t, nightTz: tz });
    const { ana, ben } = await pairedWithWatcher('six-' + tz);
    ana.ws.close();
    await pause(50);
    t = Date.UTC(2026, 8, 24, 20, 35);
    ben.send({ t: 'ping' });
    relay.expire(t);
    await pause(100);
    const cai = await phone('six-' + tz);
    assert.equal(cai.view.near.length === 0, leaves, tz);
    close(ben, cai);
  }
});

test('a misspelt nightTz stops the relay starting, not its first sweep in the night', async () => {
  let made = null;
  let error = null;
  try { made = createRelay({ port: 0, host: '127.0.0.1', root: dir, nightTz: 'Australia/Brisbnae' }); } catch (e) { error = e; }
  if (made) relays.push(await made);   // were it to start anyway, after() closes it
  assert.ok(error instanceof RangeError, 'a relay started with a zone that does not exist');
});

test('a wristband waiting for its owner gets fresh letters at 06:00', async () => {
  let t = new Date(2026, 8, 25, 5, 50).getTime();
  const relay = await relayWith({ clock: () => t });
  const band = await wristband(62, { secret: newKey() });
  assert.equal(band.show.kind, 'waiting');
  relay.expire(new Date(2026, 8, 25, 5, 59).getTime());
  await pause(50);
  assert.equal(band.show.kind, 'waiting', 'not before six');
  t = new Date(2026, 8, 25, 6, 1).getTime();
  relay.expire(t);
  await band.until((s) => s.kind === 'pairing');
  close(band);
});

// A wristband worn through 06:00 with its phone long gone used to stay paired to last night's person for as long as it was
// on, and so keep last night's room (its matches, blocks and NOT NOWs) open in memory and in the night file. At the end of
// the night it goes back to four letters, as a wristband waiting for its owner does, and the room can go.
test('a wristband still worn after 06:00 with its phone gone since the night goes back to four letters, and its room goes', async () => {
  let t = new Date(2026, 8, 25, 5, 45).getTime();
  const relay = await relayWith({ clock: () => t, graceMs: 100, lightsEveryMs: 600_000 });
  const { band, ana, ben } = await pairedWithWatcher('six-worn');
  close(ana, ben);
  await pause(300);   // ben has no band, so his grace is over; ana is held by the wristband alone
  relay.expire(new Date(2026, 8, 25, 5, 59).getTime());
  await pause(50);
  assert.notEqual(band.show.kind, 'pairing', 'not before six');
  assert.equal(relay.roomCount(), 1);
  t = new Date(2026, 8, 25, 6, 1).getTime();
  relay.expire(t);
  // Told at once, not by the next tick of the second-by-second redraw.
  await band.until((s) => s.kind === 'pairing', 250);
  assert.equal(relay.roomCount(), 0, 'nothing of last night is kept open by a wristband');
  // And it is anyone's again: a new person at the same venue pairs it with the new letters.
  const cai = await phone('six-worn');
  await pairBand(cai, band);
  close(cai, band);
});

// A phone still connected at 06:00 used to keep last night's person in the room for as long as it stayed open — and a
// page frozen in a pocket answers the socket's pings, so that could be all day: their matches, their wristband, and a
// stranger in tonight's room who was not there. 06:00 ends the night for them as it does for everyone else.
test('06:00 ends the night for someone whose phone is still connected: told, out, their match forgotten, their band freed', async () => {
  let t = new Date(2026, 8, 25, 5, 45).getTime();
  const relay = await relayWith({ clock: () => t });
  const { band, ana, ben } = await pairedWithWatcher('six-phone');
  ben.send({ t: 'arm', intent: 'hi' });
  const { near: [toBen] } = await ana.until((v) => v.near.length === 1);
  const { near: [toAna] } = await ben.until((v) => v.near.length === 1);
  ana.send({ t: 'wave', handle: toBen.handle });
  ben.send({ t: 'wave', handle: toAna.handle });
  await ana.until((v) => v.matches.length === 1);
  const told = [reply(ana, 'over'), reply(ben, 'over')];
  t = new Date(2026, 8, 25, 6, 0, 30).getTime();
  ana.send({ t: 'ping' });   // heard after six, so only the end of her night frees her band, not its own 06:00 rule
  await pause(50);
  t = new Date(2026, 8, 25, 6, 1).getTime();
  relay.expire(t);
  await Promise.all(told);
  await band.until((s) => s.kind === 'pairing', 250);
  assert.equal(relay.roomCount(), 0, 'nothing of last night is kept open by a phone');
  // The same phone joining again is someone new: nothing of last night comes back.
  ana.send({ t: 'join', venue: 'six-phone', me: ana.me });
  const back = await ana.until((v) => v.matches.length === 0);
  assert.equal(back.me.armed, null);
  close(ana, ben, band);
});

test('06:00 leaves alone someone who joined after it, and the room they keep open holds nothing of last night', async () => {
  let t = new Date(2026, 8, 25, 5, 50).getTime();
  const relay = await relayWith({ clock: () => t });
  const ana = await phone('six-early');
  const ben = await phone('six-early');
  for (const p of [ana, ben]) p.send({ t: 'arm', intent: 'hi' });
  const { near: [toBen] } = await ana.until((v) => v.near.length === 1);
  const { near: [toAna] } = await ben.until((v) => v.near.length === 1);
  ana.send({ t: 'wave', handle: toBen.handle });
  ben.send({ t: 'wave', handle: toAna.handle });
  await ana.until((v) => v.matches.length === 1);
  t = new Date(2026, 8, 25, 6, 0, 30).getTime();
  const cai = await phone('six-early');
  cai.send({ t: 'arm', intent: 'hi' });
  await cai.until((v) => v.me.armed === 'hi');
  let over = false;
  cai.ws.on('message', (d) => { if (JSON.parse(String(d)).t === 'over') over = true; });
  const told = [reply(ana, 'over'), reply(ben, 'over')];
  t = new Date(2026, 8, 25, 6, 1).getTime();
  relay.expire(t);
  await Promise.all(told);
  await pause(100);
  assert.equal(over, false, 'tonight has only just begun for them');
  assert.equal(relay.roomCount(), 1);
  cai.send({ t: 'arm', intent: 'song' });
  await cai.until((v) => v.me.armed === 'song');
  // The room stayed for cai; ana joining it again finds no match from last night.
  ana.view = null;   // her last view is from before six
  ana.send({ t: 'join', venue: 'six-early', me: ana.me });
  ana.send({ t: 'arm', intent: 'hi' });
  const back = await ana.until((v) => v.me.armed === 'hi');
  assert.deepEqual(back.matches, []);
  close(ana, ben, cai);
});

test('a wristband away at 06:00 does not come back to last night\'s person', async () => {
  let t = new Date(2026, 8, 25, 5, 45).getTime();
  const relay = await relayWith({ clock: () => t });
  const { band, ana, ben } = await pairedWithWatcher('six-dropped');
  close(ana, ben);
  await pause(100);
  t = new Date(2026, 8, 25, 5, 59).getTime();
  band.ws.close();
  await pause(100);
  t = new Date(2026, 8, 25, 6, 1).getTime();
  relay.expire(t);
  // Back with its secret, it waits for its owner's phone, as one the relay has no record of does.
  const back = await wristband(62, { key: band.key, secret: band.secret });
  assert.equal(back.show.kind, 'waiting');
  close(back);
});

test('a wristband away when its room went, back before 06:00, goes back to letters at 06:00', async () => {
  let t = new Date(2026, 8, 24, 23, 0).getTime();
  const relay = await relayWith({ clock: () => t, graceMs: 100 });
  const { band, ana, ben } = await pairedWithWatcher('six-roomless');
  close(ana, ben);
  await pause(100);
  t = new Date(2026, 8, 24, 23, 10).getTime();
  band.ws.close();
  await pause(400);   // the grace runs out for both: the room has nobody in it, and goes
  assert.equal(relay.roomCount(), 0);
  t = new Date(2026, 8, 24, 23, 30).getTime();
  const back = await wristband(62, { key: band.key, secret: band.secret });
  assert.equal(back.show.kind, 'off', 'still theirs tonight: they can come back to it');
  t = new Date(2026, 8, 25, 6, 1).getTime();
  relay.expire(t);
  await back.until((s) => s.kind === 'pairing');
  close(back);
});

test('a wristband worn on with its phone gone stays paired to its person for the rest of the same night', async () => {
  let t = new Date(2026, 8, 24, 21, 0).getTime();
  const relay = await relayWith({ clock: () => t, graceMs: 100 });
  const { band, ana, ben } = await pairedWithWatcher('same-night');
  close(ana, ben);
  await pause(300);
  t = new Date(2026, 8, 25, 3, 0).getTime();   // six hours on, and still the night of the 24th
  relay.expire(t);
  await pause(150);
  assert.notEqual(band.show.kind, 'pairing');
  assert.equal(relay.roomCount(), 1, 'its room stays: a person coming back the same night finds their matches');
  close(band);
});

// ---------- joining: quiet, and NOT NOW remembered ----------

test('a join with quiet makes a new person invisible; for someone already here it is ignored', async () => {
  await relayWith();
  const ben = await phone('quiet-join');
  const ana = await phone('quiet-join', { quiet: true });
  assert.equal(ana.view.me.invisible, true);
  assert.equal(ana.view.me.by, 'relay');
  ana.send({ t: 'arm', intent: 'hi' });
  await ben.until((v) => v.near.length === 1);
  const again = new WebSocket('ws://127.0.0.1:' + current.port + WS_PATH);
  await new Promise((r) => again.once('open', r));
  again.send(JSON.stringify({ t: 'join', venue: 'quiet-join', me: ana.me, quiet: true }));
  await pause(200);
  assert.equal(ben.view.near.length, 1, 'an old NOT NOW on a second join does not hide them');
  again.close();
  close(ana, ben);
});

test('someone who left under NOT NOW and is made again by a join without quiet is still invisible', async () => {
  await relayWith({ graceMs: 50 });
  const ben = await phone('tomb-room');   // keeps the room from being let go
  const ana = await phone('tomb-room');
  ana.send({ t: 'invisible', on: true });
  await ana.until((v) => v.me.invisible);
  ana.ws.close();
  await pause(200);                       // past the grace: out of the room
  const back = await phone('tomb-room', { me: ana.me });
  assert.equal(back.view.me.invisible, true);
  assert.equal(back.view.me.fresh, true);
  close(ben, back);
});

// ---------- rules 3 to 5: phones re-saying facts ----------

test('an unseen again NOT NOW is applied', async () => {
  await relayWith();
  const ana = await phone('again-quiet');
  const ben = await phone('again-quiet');
  ana.send({ t: 'arm', intent: 'hi', seq: 10 });
  await ben.until((v) => v.near.length === 1);
  ana.send({ t: 'invisible', on: true, seq: 11, again: true });
  await ben.until((v) => v.near.length === 0);
  close(ana, ben);
});

test('an again card is never applied, however new', async () => {
  await relayWith();
  const ana = await phone('again-card');
  ana.send({ t: 'arm', intent: 'hi', seq: 50, again: true });
  ana.send({ t: 'invisible', on: false, seq: 51, again: true });
  await pause(200);
  assert.equal(ana.view.me.armed, null);
  close(ana);
});

test('an again fact the relay already saw is not applied: the wrist chose SAY HI while the phone was in a pocket', async () => {
  await relayWith();
  const band = await wristband();
  const ana = await phone('pocket');
  await pairBand(ana, band);
  ana.send({ t: 'arm', intent: null, seq: 100 });
  const { rev } = await band.until((s) => s.kind === 'off' && Number.isInteger(s.rev));
  band.send({ t: 'set', intent: 'hi', basis: rev });
  await ana.until((v) => v.me.armed === 'hi');
  // The phone wakes and re-says what it last knew, NOT NOW included, at its old seq.
  ana.send({ t: 'invisible', on: true, seq: 100, again: true });
  ana.send({ t: 'arm', intent: null, seq: 100, again: true });
  await pause(200);
  assert.equal(ana.view.me.armed, 'hi', 'SAY HI stays');
  assert.equal(ana.view.me.invisible, false);
  close(ana, band);
});

test('the seq is acknowledged even when the message is not applied', async () => {
  await relayWith();
  const ana = await phone('seq-ack');
  const { rev } = ana.view.me;
  ana.send({ t: 'invisible', on: false, seq: 777, again: true });   // an again copy that shows: never applied
  const v = await ana.until((x) => x.me.seq === 777);
  assert.equal(v.me.rev, rev, 'nothing changed');
  close(ana);
});

test('a seq that is not a number drops the frame', async () => {
  await relayWith();
  const ana = await phone('seq-bad');
  ana.send({ t: 'arm', intent: 'hi' });
  await ana.until((v) => v.me.armed === 'hi');
  ana.send({ t: 'invisible', on: true, seq: 'soon' });
  await pause(200);
  assert.equal(ana.view.me.invisible, false);
  close(ana);
});

test('a phone card named from an old rev, arriving after a wrist NOT NOW, is refused changed', async () => {
  await relayWith();
  const band = await wristband();
  const ana = await phone('basis-room');
  await pairBand(ana, band);
  const { me: { rev } } = await ana.until((v) => Number.isInteger(v.me.rev));
  band.send({ t: 'hold' });
  await ana.until((v) => v.me.invisible);
  const refused = reply(ana, 'refused');
  ana.send({ t: 'arm', intent: 'hi', seq: 200, basis: rev });
  assert.deepEqual(await refused, { t: 'refused', why: 'changed', seq: 200 });
  await pause(100);
  assert.equal(ana.view.me.invisible, true, 'still NOT NOW');
  close(ana, band);
});

test('a phone message with no basis is taken as it always was', async () => {
  await relayWith();
  const ana = await phone('no-basis');
  ana.send({ t: 'invisible', on: true });
  await ana.until((v) => v.me.invisible);
  ana.send({ t: 'arm', intent: 'dance' });
  await ana.until((v) => v.me.armed === 'dance' && !v.me.invisible && v.me.by === 'phone');
  close(ana);
});

// ---------- leaving ----------

test('a leave sent into a dead socket still removes the person once it is re-sent, and unpairs the wristband', async () => {
  await relayWith();
  const { band, ana, ben } = await pairedWithWatcher('leave-room');
  ana.ws.terminate();                      // the first leave went nowhere
  const again = await phone('leave-room', { me: ana.me });
  const left = reply(again, 'left');
  again.send({ t: 'leave' });
  await left;
  await ben.until((v) => v.near.length === 0);
  await band.until((s) => s.kind === 'pairing');
  close(ben, again, band);
});

test('a hold on a paired wristband whose person left is applied when they come back', async () => {
  // 21:00, well clear of 06:00, so it is the hour that takes them out whenever this runs.
  let t = new Date(2026, 8, 24, 21, 0).getTime();
  const relay = await relayWith({ clock: () => t });
  const { band, ana, ben } = await pairedWithWatcher('hold-later');
  ana.ws.close();
  await pause(50);
  t += BAND_ALONE_MS + 1_000;
  ben.send({ t: 'ping' });
  relay.expire(t);                         // held only by the wristband, for the hour: out
  await band.until((s) => s.away);
  band.send({ t: 'hold' });
  await pause(100);
  const back = await phone('hold-later', { me: ana.me });
  await back.until((v) => v.me.invisible && v.me.by === 'band');
  close(ben, back, band);
});
