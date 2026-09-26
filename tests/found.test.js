// ON THE BEAT — found each other, on the phone: the number while the meeting is
// on, a buzz only when no live wristband plays it instead, Tonight's line and
// count, and the words.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MEET_MS } from '../relay/band.js';
import { buzzes } from '../app/lib/waved.js';
import { FOUND_MINE, foundBoth, meetingOn, metCount, metItem, newlyFound } from '../app/lib/found.js';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const store = await import('../app/lib/store.js');
beforeEach(() => mem.clear());

const T = new Date(2026, 8, 26, 21, 4).getTime();
const match = (id, more = {}) => ({ id, name: 'Ana', intent: 'hi', number: 27, at: T, found: false, foundAt: null, ...more });

test('S11 shows the number while the meeting is on: under MEET_MS, and not once found by both', () => {
  assert.equal(meetingOn(match('m1'), T + MEET_MS - 1), true);
  assert.equal(meetingOn(match('m1'), T + MEET_MS), false, 'fifteen minutes on, it is over');
  assert.equal(meetingOn(match('m1', { found: true }), T + 60_000), true, 'said on your side only, it is still on');
  assert.equal(meetingOn(match('m1', { found: true, foundAt: T + 60_000 }), T + 60_000), false, 'found by both, it is over');
});

test('newlyFound() gives the matches found by both that the phone has not seen found, and a buzz only without a live wristband', () => {
  const v = (wristband) => ({ me: { wristband }, matches: [match('m1', { found: true }), match('m2', { found: true, foundAt: T + 1 }), match('m3', { foundAt: T + 2 })] });
  assert.deepEqual(newlyFound(v(null), new Set()).map((m) => m.id), ['m2', 'm3'], 'said on one side only is not found');
  assert.deepEqual(newlyFound(v(null), new Set(['m2'])).map((m) => m.id), ['m3'], 'seen once is seen');
  assert.deepEqual(newlyFound({ me: null, matches: [] }, new Set()), []);
  const fresh = newlyFound(v(null), new Set());
  assert.equal(buzzes(fresh, v(null)), true, 'no wristband: the phone buzzes');
  assert.equal(buzzes(fresh, v({ battery: 40, live: false })), true, 'a wristband out of reach plays nothing, so the phone buzzes');
  assert.equal(buzzes(fresh, v({ battery: 40, live: true })), false, 'a live wristband plays it, and the phone stays still');
});

test("Tonight: a meeting found by both is `met <name>` at the time it was found, and only those count as met", () => {
  const found = match('m1', { foundAt: T + 10 * 60_000 });
  assert.deepEqual(metItem(found), { at: T + 10 * 60_000, text: 'met Ana' });
  assert.deepEqual(metItem(match('m1', { name: '', intent: 'dance', foundAt: T })), { at: T, text: 'met someone from the floor' });
  assert.equal(metItem(match('m2', { found: true })), null, 'said on one side keeps its own line');
  assert.equal(metCount([found, match('m2', { found: true }), match('m3')]), 1);
});

test("the phone keeps foundAt in its record of the night, so a reload knows the meeting was found", () => {
  let s = store.startNight(store.load(), { id: 'x', room: 'x', venue: 'The Roundhouse', act: 'Kayo' });
  s = store.noteMatch(s, match('m1', { found: true, foundAt: T + 60_000 }));
  store.save(s);
  const m = store.tonight(store.load()).matches.m1;
  assert.deepEqual([m.found, m.foundAt], [true, T + 60_000]);
  assert.deepEqual(newlyFound({ matches: [m] }, new Set(Object.values(store.tonight(store.load()).matches).filter((x) => x.foundAt).map((x) => x.id))), []);
});

test("the words: found on your side says the other won't know; found by both says when", () => {
  assert.equal(FOUND_MINE, "found on your side. they won't know unless they say so too.");
  assert.equal(foundBoth(T + 10 * 60_000), 'you found each other at 21:14');
});
