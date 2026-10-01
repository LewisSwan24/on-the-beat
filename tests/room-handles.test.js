// ON THE BEAT — a handle is worked out once per pair and held, and what a phone is shown is what a direct hash gives.
//
// A handle is ten hex characters of sha256(salt | viewer | target): a function of the salt and two ids and nothing else.
// A push works out every person's view of everyone, so hashing each pair every time was P*P hashes a push and most of what a
// full room cost (docs/show-night.md). The room holds each pair's handle after the first time (relay/room.js, `handle`).
// This file is the guard that doing so changed nothing a phone can see, and that the pairs held go with the person who
// leaves, so a night of people coming and going does not grow the memory of a venue without end.
//
// The oracle below does not look inside the room: it takes the dump() of what the room kept, works out who may see whom from
// that alone, and hashes every handle itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRoom, handleLedger } from '../relay/room.js';

const SALT = 'a-salt-this-test-knows';
const H = (viewer, target) => createHash('sha256').update(SALT + '|' + viewer + '|' + target).digest('hex').slice(0, 10);
const ID = (n) => createHash('sha256').update('person-' + n).digest('hex').slice(0, 32);

/** A small seeded generator (mulberry32): the same walk every run, so a failure can be run again. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The handle lists a viewer must be shown, worked out from the room's dump alone: the wall, SAY HI's rows, the floor
 * (clips sent to you first, then the rest, each in the order people joined), and the set of rows waiting for a wave back.
 * `clips` is who has a clip up, which dump() leaves out by design.
 */
function expected(room, clips, viewer) {
  const d = room.dump();
  const me = d.people.find((p) => p.id === viewer);
  const blocks = new Map(d.blocks.map(([id, ids]) => [id, new Set(ids)]));
  const waves = new Set(d.waves.map(([k]) => k));
  const dances = new Set(d.dances);
  const blocked = (a, b) => !!(blocks.get(a)?.has(b) || blocks.get(b)?.has(a));
  const shown = !me || me.invisible ? [] : d.people.filter((p) => p.id !== viewer && !p.invisible && !blocked(viewer, p.id));
  const toYou = (p) => dances.has(p.id + '>' + viewer);
  return {
    wall: shown.filter((p) => p.pick).map((p) => H(viewer, p.id)),
    near: shown.filter((p) => p.armed === 'hi').map((p) => H(viewer, p.id)),
    floor: shown.filter((p) => toYou(p) || clips.has(p.id)).sort((x, y) => toYou(y) - toYou(x)).map((p) => H(viewer, p.id)),
    waiting: new Set(shown.filter((p) => p.armed === 'hi' && waves.has(p.id + '>' + viewer) && !waves.has(viewer + '>' + p.id)).map((p) => H(viewer, p.id))),
    here: new Set(d.people.map((p) => p.id)),
    waves,
  };
}

test('over a night of joining, leaving, arming, waving, liking, dancing and blocking, every handle a phone is shown is the direct hash', () => {
  const room = createRoom({ salt: SALT, now: () => 1_000_000, firstRev: () => 1 });
  const ids = Array.from({ length: 12 }, (_, n) => ID(n));
  const clips = new Set();
  const next = rng(20261001);
  const pickOf = () => ids[Math.floor(next() * ids.length)];
  const seenRows = { wall: 0, near: 0, floor: 0, waiting: 0 };
  let leaves = 0;
  let rejoins = 0;
  const gone = new Set();

  for (let step = 0; step < 900; step += 1) {
    const x = next();
    const v = pickOf();
    const t = pickOf();
    const here = new Set(room.dump().people.map((p) => p.id));
    if (x < 0.20) {
      if (!here.has(v)) { if (gone.has(v)) rejoins += 1; room.join(v); }
    } else if (x < 0.29) {
      if (here.has(v)) { room.leave(v); clips.delete(v); gone.add(v); leaves += 1; }
    } else if (x < 0.46) {
      room.arm(v, ['hi', 'song', 'dance', null][Math.floor(next() * 4)]);
    } else if (x < 0.52) {
      room.setInvisible(v, next() < 0.5);
    } else if (x < 0.63) {
      room.pick(v, next() < 0.8 ? 'track ' + Math.floor(next() * 5) : '');
    } else if (x < 0.69) {
      if (here.has(v)) { const on = next() < 0.6; room.postClip(v, on ? 'clip-' + step : null); if (on) clips.add(v); else clips.delete(v); }
    } else if (x < 0.82) {
      if (here.has(v)) room.wave(v, H(v, t));
    } else if (x < 0.88) {
      if (here.has(v)) room.like(v, H(v, t));
    } else if (x < 0.93) {
      if (here.has(v)) room.danceBack(v, H(v, t), 'back-' + step);
    } else if (x < 0.94) {
      if (here.has(v)) room.block(v, H(v, t));
    }

    const n = room.dump().people.length;
    for (const viewer of ids) {
      const want = expected(room, clips, viewer);
      if (!want.here.has(viewer)) { assert.equal(room.viewFor(viewer), null, 'nobody is shown a view of a room they are not in'); continue; }
      const view = room.viewFor(viewer);
      assert.deepEqual(view.wall.map((r) => r.handle), want.wall, 'wall, step ' + step);
      assert.deepEqual(view.near.map((r) => r.handle), want.near, 'near, step ' + step);
      assert.deepEqual(view.floor.map((r) => r.handle), want.floor, 'floor, step ' + step);
      assert.deepEqual(new Set(room.wavesAt(viewer).map((w) => w.handle)), want.waiting, 'waves waiting, step ' + step);
      seenRows.wall += want.wall.length;
      seenRows.near += want.near.length;
      seenRows.floor += want.floor.length;
      seenRows.waiting += want.waiting.size;
    }
    assert.ok(room.handlesHeld() <= n * (n - 1), 'only people in the room hold handles: ' + room.handlesHeld() + ' pairs held for ' + n + ' people, step ' + step);

    // A handle names the one person it was made for, and nobody who is not in the room.
    for (let k = 0; k < 3; k += 1) {
      const a = pickOf();
      const b = pickOf();
      const want = expected(room, clips, a);
      if (!want.here.has(a)) continue;
      assert.equal(room.wavedAtYou(a, H(a, b)), want.here.has(b) && a !== b && want.waves.has(b + '>' + a), 'a handle resolves to the person it was made for, step ' + step);
    }
  }

  // The walk was a real one: it showed rows in every list, people left and came back, and some of them matched.
  assert.ok(seenRows.wall > 300 && seenRows.near > 150 && seenRows.floor > 30 && seenRows.waiting > 30, 'rows were shown in every list: ' + JSON.stringify(seenRows));
  assert.ok(leaves > 30 && rejoins > 15, 'people left and came back: ' + leaves + ' left, ' + rejoins + ' came back');
  assert.ok(room.dump().matches.length > 0, 'and some made a match, whose number comes from a handle too');
});

test('a person made again is the same handle to everyone who sees them', () => {
  const room = createRoom({ salt: SALT });
  const [a, b] = [ID('a'), ID('b')];
  for (const id of [a, b]) { room.join(id); room.pick(id, 'a song'); }
  const before = room.viewFor(a).wall.map((r) => r.handle);
  room.leave(b);
  assert.deepEqual(room.viewFor(a).wall, [], 'gone from the wall while away');
  room.join(b);
  room.pick(b, 'a song');
  assert.deepEqual(room.viewFor(a).wall.map((r) => r.handle), before, 'the handle came back as it was');
  assert.deepEqual(before, [H(a, b)]);
});

test('the pairs a room holds go with the person who leaves, both the ones they looked at and the ones looking at them', () => {
  const room = createRoom({ salt: SALT });
  const [a, b, c] = [ID('a'), ID('b'), ID('c')];
  assert.equal(room.handlesHeld(), 0, 'a new room holds none');
  for (const id of [a, b, c]) { room.join(id); room.pick(id, 'a song'); }
  assert.equal(room.handlesHeld(), 0, 'and none are held before anyone is shown anything');
  for (const id of [a, b, c]) room.viewFor(id);
  assert.equal(room.handlesHeld(), 6, 'three people each shown the other two');
  room.leave(b);
  assert.equal(room.handlesHeld(), 2, 'what is left is a and c, each as the other sees them');
  room.leave(a);
  room.leave(c);
  assert.equal(room.handlesHeld(), 0, 'an empty room holds nothing');
});

test('a room carried across a restart shows the handles it showed before, and holds none until it shows them', () => {
  const room = createRoom({ salt: SALT });
  const [a, b] = [ID('a'), ID('b')];
  for (const id of [a, b]) { room.join(id); room.pick(id, 'a song'); }
  const before = room.viewFor(a).wall.map((r) => r.handle);
  assert.equal(room.handlesHeld(), 1, 'a was shown b, and b was shown nothing yet');
  assert.ok(!JSON.stringify(room.dump()).includes(before[0]), 'no handle is written into the night file');
  const carried = createRoom({ restore: JSON.parse(JSON.stringify(room.dump())) });
  assert.equal(carried.handlesHeld(), 0, 'what is held is a convenience, not part of the night');
  assert.deepEqual(carried.viewFor(a).wall.map((r) => r.handle), before);
  assert.equal(carried.handlesHeld(), 1);
});

// What the held pairs cost was measured on 1 Oct 2026: about 62 bytes a pair, so 500 people held 15 MB, 1000 held 58 MB and 1500
// held 151 MB, with nothing to stop a room reaching them. The Fly machine gives its process 207 MB. The pairs a relay's rooms may hold
// between them are a ledger (handleLedger), and a pair past it is worked out each time, as it was before anything was held.

/** Fourteen people, all showing blue with a pick, so every view lists every other person. */
function crowd(ledger) {
  const ids = Array.from({ length: 14 }, (_, n) => ID(n));
  const room = createRoom({ salt: SALT, now: () => 1_000_000, firstRev: () => 1, ledger });
  for (const id of ids) { room.join(id); room.arm(id, 'hi'); room.pick(id, 'a song'); }
  return { room, ids };
}

test('a room holds no more pairs than its ledger allows, and shows exactly what it shows with room to hold them all', () => {
  const roomy = crowd(handleLedger(1_000_000));
  const tight = crowd(handleLedger(40));
  const none = crowd(handleLedger(0));
  for (const round of [1, 2]) {
    for (const id of roomy.ids) {
      const want = JSON.stringify(roomy.room.viewFor(id));
      assert.equal(JSON.stringify(tight.room.viewFor(id)), want, 'a ledger of 40, round ' + round);
      assert.equal(JSON.stringify(none.room.viewFor(id)), want, 'a ledger of none, round ' + round);
    }
  }
  const a = roomy.ids[0];
  assert.deepEqual(none.room.viewFor(a).wall.map((r) => r.handle).sort(), roomy.ids.slice(1).map((b) => H(a, b)).sort(), 'every handle is still the direct hash');
  assert.equal(roomy.room.handlesHeld(), 14 * 13, 'with room, every pair is held');
  assert.equal(tight.room.handlesHeld(), 40, 'held up to the ceiling, and not one more');
  assert.equal(none.room.handlesHeld(), 0, 'a ledger of none holds none');
});

test('the ledger counts exactly the pairs its rooms hold, through a night of people joining, leaving and being shown each other', () => {
  const ledger = handleLedger(1_000_000);
  const rooms = [0, 1].map(() => createRoom({ salt: SALT, now: () => 1_000_000, firstRev: () => 1, ledger }));
  const ids = Array.from({ length: 9 }, (_, n) => ID(n));
  const next = rng(20261002);
  const here = [new Set(), new Set()];
  const held = () => rooms[0].handlesHeld() + rooms[1].handlesHeld();
  let peak = 0;
  for (let step = 0; step < 400; step += 1) {
    const k = next() < 0.5 ? 0 : 1;
    const v = ids[Math.floor(next() * ids.length)];
    if (next() < 0.55) {
      if (!here[k].has(v)) { rooms[k].join(v); rooms[k].arm(v, 'hi'); rooms[k].pick(v, 'a song'); here[k].add(v); }
    } else if (here[k].has(v)) {
      rooms[k].leave(v);
      here[k].delete(v);
    }
    for (const id of here[k]) rooms[k].viewFor(id);
    assert.equal(ledger.held, held(), 'the ledger and the rooms agree, step ' + step);
    peak = Math.max(peak, ledger.held);
  }
  assert.ok(peak > 40, 'the walk held a real number of pairs: ' + peak);
  for (const k of [0, 1]) for (const id of [...here[k]]) rooms[k].leave(id);
  assert.equal(ledger.held, 0, 'when everyone has left, the ledger has everything back');
});

test('rooms spend one budget between them, and a room that empties gives its share to the next', () => {
  const ledger = handleLedger(6);
  const mk = () => createRoom({ salt: SALT, now: () => 1_000_000, firstRev: () => 1, ledger });
  const [first, second] = [mk(), mk()];
  const ids = [ID('a'), ID('b'), ID('c')];
  for (const room of [first, second]) for (const id of ids) { room.join(id); room.arm(id, 'hi'); room.pick(id, 'a song'); }
  for (const id of ids) first.viewFor(id);
  for (const id of ids) second.viewFor(id);
  assert.equal(first.handlesHeld(), 6, 'the first room took the whole budget');
  assert.equal(second.handlesHeld(), 0, 'the second finds none left, and still shows its people');
  assert.equal(second.viewFor(ids[0]).wall.length, 2);
  for (const id of ids) first.leave(id);
  assert.equal(ledger.held, 0);
  for (const id of ids) second.viewFor(id);
  assert.equal(second.handlesHeld(), 6, 'and when the first is empty the second can hold its own');
  assert.equal(ledger.held, 6);
});

test('a room with no ledger of its own to be given still holds pairs, within the same default ceiling', () => {
  const room = createRoom({ salt: SALT });
  const [a, b] = [ID('a'), ID('b')];
  for (const id of [a, b]) { room.join(id); room.pick(id, 'a song'); }
  room.viewFor(a);
  assert.equal(room.handlesHeld(), 1);
  assert.ok(handleLedger().max >= 100_000 && handleLedger().max <= 1_000_000, 'the default ceiling is a few tens of MB of pairs at the most: ' + handleLedger().max);
});
