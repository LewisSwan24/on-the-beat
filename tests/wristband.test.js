// ON THE BEAT — who a wristband is, pairing with a check, and the wrist's own `set`.
// One test per guard; each was mutation-checked (README, Abuse resistance).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRelay, bandIdOf } from '../relay/server.js';
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
