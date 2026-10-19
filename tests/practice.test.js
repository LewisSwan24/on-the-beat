// ON THE BEAT — the wristband guide's practice on the relay: private while it runs, and over by itself.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRelay } from '../relay/server.js';
import { PRACTICE_MS } from '../relay/room.js';
import { helpers } from './relay-harness.js';
import { tapMessage } from '../app/lib/follow.js';
import { restoreTaps } from '../app/lib/guide.js';

let relay;
let dir;
let t = Date.now();
const { phone, cleanup } = helpers(() => relay.port);
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'otb-practice-'));
  relay = await createRelay({ port: 0, host: '127.0.0.1', root: dir, clock: () => t });
});
after(async () => {
  cleanup();
  await relay.close();
  rmSync(dir, { recursive: true, force: true });
});

test('practice hides its person from every other phone until it is said off', async () => {
  const ana = await phone('suncorp-stadium-bruno-mars');
  const ben = await phone('suncorp-stadium-bruno-mars');
  ana.send({ t: 'arm', intent: 'hi', seq: 1 });
  ben.send({ t: 'arm', intent: 'hi', seq: 1 });
  await ben.until((v) => v.near.length === 1);
  ana.send({ t: 'practice', on: true });
  await ben.until((v) => v.near.length === 0);
  await ana.until((v) => v.me.practice === true && v.me.armed === 'hi');
  ana.send({ t: 'practice', on: false });
  await ben.until((v) => v.near.length === 1);
  ana.send({ t: 'leave' });
  ben.send({ t: 'leave' });
});

test('a phone that never says off: the sweep after PRACTICE_MS shows its person again', async () => {
  const ana = await phone('moth-club-kayo-lane');
  const ben = await phone('moth-club-kayo-lane');
  ana.send({ t: 'arm', intent: 'hi', seq: 1 });
  ben.send({ t: 'arm', intent: 'hi', seq: 1 });
  await ben.until((v) => v.near.length === 1);
  ana.send({ t: 'practice', on: true });
  await ben.until((v) => v.near.length === 0);
  t += PRACTICE_MS + 1;
  relay.expire(t);
  await ben.until((v) => v.near.length === 1);
});

test('a malformed practice is dropped', async () => {
  const ana = await phone('suncorp-stadium-bruno-mars');
  ana.send({ t: 'practice', on: 'yes' });
  ana.send({ t: 'profile', name: 'Ana' });
  await ana.until((v) => v.me.name === 'Ana');
  assert.equal(ana.view.me.practice, false, 'a word is not true: it does not start one');
  ana.send({ t: 'practice', on: true });
  await ana.until((v) => v.me.practice === true);
  ana.send({ t: 'practice' });
  ana.send({ t: 'practice', on: 0 });
  ana.send({ t: 'profile', name: 'Ana B' });
  await ana.until((v) => v.me.name === 'Ana B');
  assert.equal(ana.view.me.practice, true, 'nothing, or a number, does not end one either');
});

/**
 * The phone's end of the practice, as App.jsx endPractice says it: every tap chosen from the one view it has, its
 * basis that view's rev, then practice off.
 */
async function endAs(p, was) {
  const { me } = p.view;
  let seq = 100;
  for (const [kind, v] of restoreTaps(was, me, p.view.cards)) p.send(tapMessage(kind, v, ++seq, me.rev));
  p.send({ t: 'practice', on: false });
}

test('ending the practice in the dark puts back the card it opened on, or none, and never the one practised with', async () => {
  for (const opened of ['hi', null]) {
    const ana = await phone('suncorp-stadium-bruno-mars');
    if (opened) { ana.send({ t: 'arm', intent: opened, seq: 1 }); await ana.until((v) => v.me.armed === opened); }
    const was = { armed: ana.view.me.armed ?? null, invisible: false };
    ana.send({ t: 'practice', on: true });
    // Step 2 changes the card, step 3 goes dark; then later, on step 4.
    ana.send({ t: 'arm', intent: 'song', seq: 2, basis: ana.view.me.rev });
    await ana.until((v) => v.me.armed === 'song');
    ana.send({ t: 'invisible', on: true, seq: 3 });
    await ana.until((v) => v.me.invisible === true);
    await endAs(ana, was);
    await ana.until((v) => v.me.practice === false);
    assert.equal(ana.view.me.invisible, false, String(opened));
    assert.equal(ana.view.me.armed ?? null, opened, 'opened on ' + opened + ', not the practised SONG');
    assert.deepEqual(ana.errors, [], 'no tap refused');
    ana.send({ t: 'leave' });
  }
});
