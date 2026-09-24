// ON THE BEAT — who a wristband is, pairing with a check, and the wrist's own `set`.
// One test per guard; each was mutation-checked (README, Abuse resistance).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRelay, bandIdOf, BAND_ALONE_MS, PAIR_CHECK_MS } from '../relay/server.js';
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

// ---------- §0: the secret ----------

test("a paired wristband's hello needs its secret; without it the new socket is refused and the live one survives", async () => {
  const band = await wristband();
  const ana = await phone('secret-room');
  const { secret } = await pairBand(ana, band);
  const bare = await hello({ t: 'wristband', id: band.id, key: band.key, v: 2 });
  assert.deepEqual([bare.reply.why, bare.closed], ['bad band', 4001], 'the id and even the key are not enough');
  const wrong = await hello({ t: 'wristband', id: band.id, key: band.key, v: 2, secret: newKey() });
  assert.equal(wrong.reply.why, 'bad band');
  ana.send({ t: 'arm', intent: 'dance' });
  await band.until((s) => s.kind === 'dance');
  const back = await wristband(62, { key: band.key, secret });
  assert.equal(back.show.kind, 'dance', 'with it, the same wristband, still paired');
  close(ana, back);
});

test('a claim needs the secret', async () => {
  const band = await wristband();
  const ana = await phone('claim-room');
  const { band: id } = await pairBand(ana, band);
  const bare = reply(ana, 'claim');
  ana.send({ t: 'pair', band: id });
  assert.deepEqual(await bare, { t: 'claim', ok: false, why: 'gone' });
  close(ana, band);
});

// ---------- §0: after a relay restart ----------

test('a restarted relay keeps a paired wristband waiting for its owner, and the claim pairs it', async () => {
  const secret = newKey();
  const band = await wristband(62, { secret });
  assert.deepEqual(band.show, { kind: 'waiting' }, 'no letters, no code to scan');
  const ana = await phone('restart-room');
  const ok = reply(ana, 'claim');
  ana.send({ t: 'pair', band: band.id, secret, again: true });
  assert.deepEqual(await ok, { t: 'claim', ok: true, band: band.id });
  await band.until((s) => s.kind === 'off' && !s.away);
  close(ana, band);
});

test('a hold while it waits, or in the hello, is applied at the claim', async () => {
  for (const how of ['hold', 'hello']) {
    const secret = newKey();
    const band = await wristband(62, { secret, quiet: how === 'hello' });
    if (how === 'hold') band.send({ t: 'hold' });
    await pause(50);
    const ana = await phone('restart-quiet-' + how);
    ana.send({ t: 'pair', band: band.id, secret });
    await ana.until((v) => v.me.invisible);
    close(ana, band);
  }
});

test('nobody claims it for BAND_ALONE_MS: it shows fresh letters', async () => {
  const band = await wristband(62, { secret: newKey() });
  relay.expire(Date.now() + BAND_ALONE_MS - 60_000);
  await pause(50);
  assert.equal(band.show.kind, 'waiting', 'not yet');
  relay.expire(Date.now() + BAND_ALONE_MS + 1_000);
  await band.until((s) => s.kind === 'pairing');
  close(band);
});

test('the phone back first: a placeholder is kept, and the wristband\'s secret decides', async () => {
  const key = newKey();
  const secret = newKey();
  const ana = await phone('first-room');
  const waiting = reply(ana, 'claim');
  ana.send({ t: 'pair', band: bandIdOf(key), secret, again: true });
  assert.deepEqual(await waiting, { t: 'claim', ok: false, why: 'waiting' });
  const band = await wristband(62, { key, secret });
  assert.equal(band.show.kind, 'off', 'the same secret: paired');
  await ana.until((v) => v.me.wristband?.live);

  const key2 = newKey();
  const ben = await phone('first-room');
  ben.send({ t: 'pair', band: bandIdOf(key2), secret: newKey() });
  await ben.until((v) => v.me.wristband?.live === false);
  const told = reply(ben, 'claim');
  const other = await wristband(62, { key: key2, secret: newKey() });
  assert.deepEqual(await told, { t: 'claim', ok: false, why: 'gone' }, 'a different secret: its claimer is told');
  assert.equal(other.show.kind, 'waiting', 'and the wristband waits for its own owner');
  close(ana, ben, band, other);
});

test('one placeholder per person', async () => {
  const ana = await phone('one-room');
  const count = relay.bandCount();
  for (let i = 0; i < 3; i += 1) {
    const w = reply(ana, 'claim');
    ana.send({ t: 'pair', band: randomBytes(16).toString('hex'), secret: newKey() });
    await w;
  }
  assert.equal(relay.bandCount(), count + 1);
  close(ana);
});

test('a paired wristband away for BAND_ALONE_MS is forgotten, and the next claim is told gone', async () => {
  const band = await wristband();
  const ana = await phone('away-room');
  const { band: id, secret } = await pairBand(ana, band);
  band.ws.close();
  await ana.until((v) => v.me.wristband?.live === false);
  relay.expire(Date.now() + BAND_ALONE_MS + 1_000);
  const told = reply(ana, 'claim');
  ana.send({ t: 'pair', band: id, secret, again: true });
  assert.deepEqual(await told, { t: 'claim', ok: false, why: 'gone' });
  close(ana);
});
