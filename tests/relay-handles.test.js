// ON THE BEAT — the pairs a relay's rooms hold are one budget, not one each.
//
// A room remembers each handle it shows (relay/room.js, `handle`), and what that costs grows with the square of the room: about
// 62 bytes a pair, so a room of 1000 holds 58 MB, and nothing stops a venue reaching that size (the only bound is Fly's 2,500
// connections). The pairs are a convenience, never the truth, so the relay gives every room the same ledger and a room past it
// works a handle out each time, as it did before any were held. tests/room-handles.test.js holds the ledger itself; this holds that
// the relay hands one ledger to all its rooms, the ones it makes and the ones it carries across a restart.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRelay } from '../relay/server.js';
import { helpers, pause } from './relay-harness.js';

/** A phone that shows blue with a pick, so everyone in its venue is on its lists. */
async function showing(t, venue) {
  const p = await t.phone(venue);
  p.send({ t: 'arm', intent: 'hi' });
  p.send({ t: 'pick', track: 'a song' });
  return p;
}

/** Waits, up to `ms`, for a condition. */
async function until(pred, ms = 4000) {
  for (const from = Date.now(); !pred() && Date.now() - from < ms;) await pause(20);
}

test('every room of a relay draws on one budget of held pairs, and gives it back as people leave', async () => {
  const relay = await createRelay({ port: 0, host: '127.0.0.1', handlesMax: 30, graceMs: 100 });
  const t = helpers(() => relay.port);
  try {
    assert.equal(relay.handlesHeld(), 0, 'a new relay holds none');
    // Five people in each of two venues: each is shown the four others, 20 pairs a venue and 40 in all, against a budget of 30.
    const crowd = [];
    for (const venue of ['quiet-corner-bar', 'the-hall-kayo-lane']) for (let n = 0; n < 5; n += 1) crowd.push(await showing(t, venue));
    await until(() => relay.handlesHeld() >= 30);
    await pause(300);
    assert.equal(relay.handlesHeld(), 30, 'the two rooms together hold the budget and no more');
    for (const p of crowd) {
      const view = await p.until((v) => v.near.length === 4);
      assert.equal(view.near.length, 4, 'and each person is still shown everyone: the budget changes what is kept, not what is shown');
    }
    // The first venue's five go, and so (after the grace) does the venue. What the ledger counts is then what the other venue holds.
    for (const p of crowd.slice(0, 5)) p.ws.close();
    await until(() => !relay.rooms.has('quiet-corner-bar'), 4000);
    assert.ok(!relay.rooms.has('quiet-corner-bar'), 'the empty venue was let go');
    const stillHere = relay.rooms.get('the-hall-kayo-lane').room;
    assert.equal(relay.handlesHeld(), stillHere.handlesHeld(), 'the ledger took back everything the first venue held');
    assert.ok(relay.handlesHeld() < 30, 'so there is budget again: ' + relay.handlesHeld());
  } finally {
    t.cleanup();
    await relay.close();
  }
});

test('rooms carried across a restart draw on the new relay\'s budget too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'otb-handles-'));
  const nightFile = join(dir, 'night.json');
  try {
    const first = await createRelay({ port: 0, host: '127.0.0.1', nightFile, saveEveryMs: 50 });
    const t1 = helpers(() => first.port);
    for (let n = 0; n < 4; n += 1) await showing(t1, 'quiet-corner-bar');
    await pause(300);
    t1.cleanup();
    await first.close();

    const second = await createRelay({ port: 0, host: '127.0.0.1', nightFile, saveEveryMs: 50, handlesMax: 5 });
    const t2 = helpers(() => second.port);
    try {
      assert.equal(second.handlesHeld(), 0, 'a restored room holds nothing until it shows something');
      // Four phones of their own join the carried room: each is shown the others, 12 pairs a room, and the budget is 5.
      for (let n = 0; n < 4; n += 1) await showing(t2, 'quiet-corner-bar');
      await until(() => second.handlesHeld() >= 5);
      await pause(300);
      assert.equal(second.handlesHeld(), 5, 'the carried room spends the same ledger as any other, and stops at it');
    } finally {
      t2.cleanup();
      await second.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
