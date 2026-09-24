// ON THE BEAT — who a wristband is, pairing with a check, and the wrist's own `set`.
// One test per guard; each was mutation-checked (README, Abuse resistance).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRelay, bandIdOf, PAIR_CHECK_MS } from '../relay/server.js';
import { helpers, newKey, pause } from './relay-harness.js';

let relay;
let dir;
const { phone, wristband, hello, reply, pairBand, rawSocket, close, cleanup } = helpers(() => relay.port);

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'otb-band-'));
  relay = await createRelay({ port: 0, host: '127.0.0.1', root: dir });
});
after(async () => {
  cleanup();
  await relay.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------- §0: the key proves the id ----------

test('a hello whose key does not hash to its id is refused: a new id, an unpaired record, a paired one', async () => {
  const stranger = await hello({ t: 'wristband', id: bandIdOf(newKey()), key: newKey(), v: 2 });
  assert.deepEqual([stranger.reply, stranger.closed], [{ t: 'error', why: 'bad band' }, 4001], 'a new id with the wrong key');
  const band = await wristband();
  assert.equal((await hello({ t: 'wristband', id: band.id, key: newKey(), v: 2 })).reply.why, 'bad band', 'an unpaired record');
  const ana = await phone('key-room');
  await pairBand(ana, band);
  const taken = await hello({ t: 'wristband', id: band.id, key: newKey(), v: 2, secret: band.secret ?? undefined });
  assert.equal(taken.reply.why, 'bad band', 'a paired record, even with its secret');
  ana.send({ t: 'arm', intent: 'hi' });
  await band.until((s) => s.kind === 'hi');   // and the live wristband was left alone
  close(ana, band);
});

test('a hello with no protocol version gets letters but is never paired', async () => {
  const old = await wristband(62, { v1: true });
  assert.equal(old.show.kind, 'pairing');
  const ana = await phone('old-room');
  const no = reply(ana, 'error');
  ana.send({ t: 'pair', code: old.show.code });
  assert.equal((await no).why, 'old firmware');
  close(ana, old);
});

test('a socket says hello once', async () => {
  const band = await wristband();
  const other = newKey();
  band.send({ t: 'wristband', id: bandIdOf(other), key: other, v: 2 });
  await band.until((s, b) => b.replies.some((m) => m.why === 'bad band'));
  await new Promise((r) => (band.ws.readyState === 3 ? r() : band.ws.once('close', r)));
});

test('frames on a replaced wristband socket are dropped', async () => {
  const band = await wristband();
  const ana = await phone('replaced-room');
  const ben = await phone('replaced-room');
  const { secret } = await pairBand(ana, band);
  ana.send({ t: 'arm', intent: 'hi' });
  await ben.until((v) => v.near.length === 1);
  const raw = await rawSocket();
  raw.send({ t: 'wristband', id: band.id, key: band.key, v: 2, secret });   // the raw socket takes over...
  await pause(100);
  const next = await wristband(62, { key: band.key, secret });              // ...and is replaced, but never reads that
  raw.send({ t: 'hold' });
  await pause(300);
  assert.equal(ben.view.near.length, 1, 'a hold from the replaced socket did not land');
  next.send({ t: 'hold' });
  await ben.until((v) => v.near.length === 0);
  raw.end();
  close(ana, ben, next);
});

// ---------- §0: the check ----------

test('a hello with the wrong key is refused for a record being paired too', async () => {
  const band = await wristband();
  const ana = await phone('pending-key');
  ana.send({ t: 'pair', code: band.show.code });
  await band.until((s) => s.kind === 'check');
  assert.equal((await hello({ t: 'wristband', id: band.id, key: newKey(), v: 2 })).reply.why, 'bad band');
  close(ana, band);
});

test('pairing waits for the check: the wrist shows a number, the phone is asked, YES pairs and gives both a secret', async () => {
  const band = await wristband();
  const ana = await phone('check-room');
  const early = [];
  ana.ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'paired') early.push(m); });
  ana.send({ t: 'pair', code: band.show.code });
  const { me: { check } } = await ana.until((v) => v.me.check);
  assert.ok(check >= 10 && check <= 99);
  assert.deepEqual(await band.until((s) => s.kind === 'check'), { kind: 'check', big: String(check) });
  await pause(100);
  assert.deepEqual(early, [], 'nothing is paired before YES');
  assert.equal(ana.view.me.wristband, null);
  const paired = reply(ana, 'paired');
  ana.send({ t: 'confirm', yes: true });
  const m = await paired;
  assert.equal(m.band, band.id);
  assert.match(m.secret, /^[a-f0-9]{32}$/);
  await band.until((s, b) => b.secret === m.secret);
  await ana.until((v) => v.me.check === null && v.me.wristband?.live);
  close(ana, band);
});

test('NO drops the pairing, and the wristband shows fresh letters', async () => {
  const band = await wristband();
  const { code } = band.show;
  const ana = await phone('no-room');
  ana.send({ t: 'pair', code });
  await ana.until((v) => v.me.check);
  await band.until((s) => s.kind === 'check');   // or the old letters would pass for fresh ones
  ana.send({ t: 'confirm', yes: false });
  const fresh = await band.until((s) => s.kind === 'pairing');
  assert.notEqual(fresh.code, code);
  await ana.until((v) => v.me.check === null && v.me.wristband === null);
  const gone = reply(ana, 'error');
  ana.send({ t: 'pair', code });
  assert.equal((await gone).why, 'no such wristband', 'the old letters are gone');
  close(ana, band);
});

test('no answer within PAIR_CHECK_MS: dropped, fresh letters, and the phone is told', async () => {
  const band = await wristband();
  const { code } = band.show;
  const ana = await phone('timeout-room');
  ana.send({ t: 'pair', code });
  await ana.until((v) => v.me.check);
  const told = reply(ana, 'check');
  relay.tickBands(Date.now() + PAIR_CHECK_MS - 1_000);
  await pause(100);
  assert.equal(band.show.kind, 'check', 'not yet');
  relay.tickBands(Date.now() + PAIR_CHECK_MS + 1_000);
  assert.deepEqual(await told, { t: 'check', ok: false, why: 'timeout' });
  assert.notEqual((await band.until((s) => s.kind === 'pairing')).code, code);
  close(ana, band);
});

test('a second pair for a wristband being paired is refused busy', async () => {
  const band = await wristband();
  const { code } = band.show;
  const ana = await phone('busy-room');
  const ben = await phone('busy-room');
  ana.send({ t: 'pair', code });
  await ana.until((v) => v.me.check);
  const busy = reply(ben, 'error');
  ben.send({ t: 'pair', code });
  assert.equal((await busy).why, 'busy');
  close(ana, ben, band);
});

test('check numbers are unique among the pairings in progress', async () => {
  const bands = [];
  for (let i = 0; i < 40; i += 1) bands.push(await wristband());
  const numbers = [];
  for (const b of bands) {
    const p = await phone('unique-room');
    p.send({ t: 'pair', code: b.show.code });
    numbers.push((await p.until((v) => v.me.check)).me.check);
  }
  // Forty from ninety: with nothing keeping them apart, two would share a number all but always.
  assert.equal(new Set(numbers).size, numbers.length, 'every pending number differs: ' + numbers.join(','));
  cleanup();
});

test('every pair attempt counts toward the socket limit, right letters or wrong', async () => {
  relay.expire(Date.now() + 61_000);
  const ana = await phone('count-room', { ip: '203.0.113.20' });
  for (let i = 0; i < 5; i += 1) {
    const band = await wristband();
    ana.send({ t: 'pair', code: band.show.code });
    await ana.until((v) => v.me.check);
    ana.send({ t: 'confirm', yes: false });
    await ana.until((v) => v.me.check === null);
  }
  const band = await wristband();
  const blocked = reply(ana, 'error');
  ana.send({ t: 'pair', code: band.show.code });
  assert.equal((await blocked).why, 'too many tries', 'the sixth, though its letters are right');
  close(ana);
});
