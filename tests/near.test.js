// Near: of the people wearing a wristband, the five heard most strongly
// (docs/superpowers/specs/2026-09-26-wrist-near-design.md §2). The room keeps
// what each band heard and works the five out on its own tick; a view only reads it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, HEARD_MS, NEAR_FIVE, NEAR_KEEP } from '../relay/room.js';

/** Everyone named is in the room on SAY HI, picking their own name, so a list says who is on it. */
function floor(names) {
  let t = Date.UTC(2026, 8, 26, 11, 0);
  const room = createRoom({ now: () => t, salt: 'test' });
  for (const id of names) {
    room.join(id);
    room.arm(id, 'hi');
    room.pick(id, id);
  }
  const listed = (viewer) => room.viewFor(viewer).near.map((p) => p.pick).sort();
  const handleOf = (viewer, target) => room.viewFor(viewer).near.find((p) => p.pick === target)?.handle;
  return { room, listed, handleOf, tick: (ms) => { t += ms; } };
}

/** `a`'s band reports on channel `ch` that it heard each of `heard` ({ id: rssi }). */
const report = (room, a, heard, ch = 6) =>
  room.heard(a, { ch, near: Object.entries(heard).map(([id, rssi]) => ({ id, rssi })) });

const others = (n) => Array.from({ length: n }, (_, i) => 'p' + i);

test('without a wristband, or before it has reported, the list is the whole room, as it was', () => {
  const { room, listed } = floor(['vi', ...others(8)]);
  assert.deepEqual(listed('vi'), others(8));
  // Everyone else's bands report hearing each other, but vi's has not said anything yet.
  for (const a of others(8)) report(room, a, Object.fromEntries(others(8).filter((b) => b !== a).map((b) => [b, -50])));
  room.nearTick();
  assert.deepEqual(listed('vi'), others(8));
});

test('with bands reporting, the list is the five heard most strongly, and nothing says how strongly', () => {
  const { room, listed } = floor(['vi', ...others(8)]);
  const db = { p0: -71, p1: -44, p2: -80, p3: -52, p4: -63, p5: -49, p6: -90, p7: -58 };
  report(room, 'vi', db);
  for (const a of others(8)) report(room, a, {});
  assert.equal(room.nearTick(), true);
  assert.deepEqual(listed('vi'), ['p1', 'p3', 'p4', 'p5', 'p7']);
  assert.equal(NEAR_FIVE, 5);
  // Never a number: no RSSI, score or rank in anything a phone is sent.
  const seen = JSON.stringify(room.viewFor('vi'));
  for (const n of Object.values(db)) assert.equal(seen.includes(String(n)), false, 'the view carries ' + n);
  assert.equal(/rssi|score|rank/i.test(seen), false);
  // Nothing changed, so nothing to push.
  assert.equal(room.nearTick(), false);
});

test('a pair is heard either way: what the other band heard counts as much as your own', () => {
  const { room, listed } = floor(['vi', ...others(7)]);
  // vi's band heard nobody. p6's heard vi loudly; the rest heard vi faintly.
  report(room, 'vi', {});
  for (const a of others(7)) report(room, a, { vi: a === 'p6' ? -40 : -85 });
  room.nearTick();
  assert.equal(listed('vi').includes('p6'), true);
  assert.equal(listed('vi').length, NEAR_FIVE);
});

test('people without a band are listed as they were, and take no place in the five', () => {
  const { room, listed } = floor(['vi', ...others(8), 'nb1', 'nb2']);
  report(room, 'vi', Object.fromEntries(others(8).map((b, i) => [b, -40 - i * 5])));
  for (const a of others(8)) report(room, a, {});
  room.nearTick();
  assert.deepEqual(listed('vi'), ['nb1', 'nb2', 'p0', 'p1', 'p2', 'p3', 'p4']);
});

test('a wave either way, or a match, keeps someone listed, and takes no place in the five', () => {
  const { room, listed, handleOf } = floor(['vi', ...others(8), 'far', 'met']);
  // Before any band reports, far waves at vi, and vi and met match.
  room.wave('far', handleOf('far', 'vi'));
  room.wave('vi', handleOf('vi', 'met'));
  room.wave('met', handleOf('met', 'vi'));
  assert.equal(room.viewFor('vi').matches.length, 1);
  report(room, 'vi', Object.fromEntries(others(8).map((b, i) => [b, -40 - i * 5])));
  for (const a of [...others(8), 'far', 'met']) report(room, a, {});
  room.nearTick();
  assert.deepEqual(listed('vi'), ['far', 'met', 'p0', 'p1', 'p2', 'p3', 'p4']);
  // So vi's band still counts far's wave, and vi can wave back.
  assert.equal(room.wavesAt('vi').length, 1);
});

test('one of the five stays while among the ten strongest, and goes once it is not', () => {
  const { room, listed, tick } = floor(['vi', ...others(12)]);
  const hear = (db) => {
    report(room, 'vi', db);
    for (const a of others(12)) report(room, a, {});
    room.nearTick();
  };
  // p0..p4 strongest, then p5..p11.
  hear(Object.fromEntries(others(12).map((b, i) => [b, -40 - i * 3])));
  assert.deepEqual(listed('vi'), ['p0', 'p1', 'p2', 'p3', 'p4']);
  // p4 falls to eighth: still among the ten, so it stays, and p5 does not come in.
  tick(HEARD_MS + 1);
  hear({ p0: -40, p1: -41, p2: -42, p3: -43, p5: -44, p6: -45, p7: -46, p4: -47, p8: -48, p9: -49, p10: -50, p11: -51 });
  assert.deepEqual(listed('vi'), ['p0', 'p1', 'p2', 'p3', 'p4']);
  assert.equal(NEAR_KEEP, 10);
  // p4 falls to twelfth: out of the ten, so the strongest not listed, p5, takes its place.
  tick(HEARD_MS + 1);
  hear({ p0: -40, p1: -41, p2: -42, p3: -43, p5: -44, p6: -45, p7: -46, p8: -47, p9: -48, p10: -49, p11: -50, p4: -51 });
  assert.deepEqual(listed('vi'), ['p0', 'p1', 'p2', 'p3', 'p5']);
});

test('what a band heard more than HEARD_MS ago no longer counts', () => {
  const { room, listed, tick } = floor(['vi', ...others(8)]);
  report(room, 'vi', { p0: -40 });
  for (const a of others(8)) report(room, a, {});
  room.nearTick();
  assert.deepEqual(listed('vi'), ['p0']);
  tick(HEARD_MS + 1);
  report(room, 'vi', { p1: -60 });
  for (const a of others(8)) report(room, a, {});
  room.nearTick();
  assert.deepEqual(listed('vi'), ['p1']);
});

test('nobody is hidden by, or from, a band that has not reported for HEARD_MS', () => {
  const { room, listed, tick } = floor(['vi', ...others(8)]);
  report(room, 'vi', { p0: -40 });
  for (const a of others(8)) report(room, a, {});
  room.nearTick();
  assert.deepEqual(listed('vi'), ['p0']);
  // The others' bands go quiet: they are no evidence of anything, so all of them are back.
  tick(HEARD_MS + 1);
  report(room, 'vi', { p0: -40 });
  assert.deepEqual(listed('vi'), others(8));
  // And a viewer whose own band goes quiet sees the room as it was.
  for (const a of others(8)) report(room, a, {});
  room.nearTick();
  assert.deepEqual(listed('vi'), ['p0']);
  tick(HEARD_MS + 1);
  for (const a of others(8)) report(room, a, {});
  assert.deepEqual(listed('vi'), others(8));
  room.nearTick();
  assert.deepEqual(listed('vi'), others(8));
});

test('a band on another channel hides nobody, and is hidden from nobody', () => {
  const { room, listed } = floor(['vi', ...others(8)]);
  report(room, 'vi', { p0: -40 }, 6);
  for (const a of others(8)) report(room, a, {}, a === 'p7' ? 11 : 6);
  room.nearTick();
  assert.deepEqual(listed('vi'), ['p0', 'p7']);
});

test('a viewer whose band has reported but not been worked out yet sees the room as it was', () => {
  const { room, listed } = floor(['vi', ...others(8)]);
  for (const a of others(8)) report(room, a, {});
  report(room, 'vi', { p0: -40 });
  assert.deepEqual(listed('vi'), others(8));
  room.nearTick();
  assert.deepEqual(listed('vi'), ['p0']);
});

test('nearness never shows anyone the room would not: blocked, NOT NOW or gone', () => {
  const { room, listed, handleOf } = floor(['vi', 'bl', 'nn', 'gone', 'ok']);
  room.block('vi', handleOf('vi', 'bl'));
  room.setInvisible('nn', true);
  room.leave('gone');
  report(room, 'vi', { bl: -30, nn: -30, gone: -30, ok: -60 });
  for (const a of ['bl', 'nn', 'ok']) report(room, a, { vi: -30 });
  report(room, 'gone', { vi: -30 });
  room.nearTick();
  assert.deepEqual(listed('vi'), ['ok']);
});

test('a report about nobody in the room, or about itself, changes nothing', () => {
  const { room, listed } = floor(['vi', ...others(6)]);
  room.heard('vi', { ch: 6, near: [{ id: 'vi', rssi: -20 }, { id: 'ghost', rssi: -20 }, { id: 'p0', rssi: -60 }] });
  room.heard('ghost', { ch: 6, near: [{ id: 'vi', rssi: -20 }] });
  for (const a of others(6)) report(room, a, {});
  room.nearTick();
  assert.deepEqual(listed('vi'), ['p0']);
});
