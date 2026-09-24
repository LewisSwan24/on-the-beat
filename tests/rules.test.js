// ON THE BEAT — the relay decides: who is in the room, and which re-said fact counts.
// One test per guard; each was mutation-checked (README, Abuse resistance).

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
  ben.send({ t: 'ping' });
  relay.expire(t);
  await ben.until((v) => v.near.length === 0);
  close(ben);
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
    assert.equal(ben.view.near.length === 0, leaves, tz);
    close(ben);
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
