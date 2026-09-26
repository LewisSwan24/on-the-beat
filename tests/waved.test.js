// ON THE BEAT — a wave at you, on the phone: a buzz only when no live wristband
// calls instead, once for each wave, and never again after a reload.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WAVED_LINE, WAVES_HOW, buzzes, newWaves } from '../app/lib/waved.js';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const store = await import('../app/lib/store.js');
beforeEach(() => mem.clear());

const row = (handle, more = {}) => ({ handle, band: 'in this room', pick: null, waved: false, wavedAtYou: false, ...more });
const view = (near, wristband = null) => ({ me: { armed: 'hi', wristband }, near });

test('newWaves() gives the rows that waved at you and wait, and only those not seen before', () => {
  const v = view([row('a', { wavedAtYou: true }), row('b'), row('c', { wavedAtYou: true, waved: true }), row('d', { waved: true })]);
  assert.deepEqual(newWaves(v, []).map((r) => r.handle), ['a'], 'not one you waved back to, nor one who never waved');
  assert.deepEqual(newWaves(v, ['a']), [], 'seen once is seen');
  assert.deepEqual(newWaves({ me: null, near: [] }, []), []);
});

test('new waves buzz the phone only when no live wristband calls instead', () => {
  const fresh = [row('a', { wavedAtYou: true })];
  assert.equal(buzzes(fresh, view([], null)), true, 'no wristband');
  assert.equal(buzzes(fresh, view([], { battery: 40, live: false })), true, 'a wristband that is flat, off or out of reach');
  assert.equal(buzzes(fresh, view([], { battery: 40, live: true })), false, 'a live wristband calls, and the phone stays still');
  assert.equal(buzzes([], view([], null)), false, 'nothing new');
});

test("a wave once seen is kept in the night's record: no buzz after a reload, or when the band later goes out of reach", () => {
  let s = store.startNight(store.load(), { id: 'x', room: 'x', venue: 'The Roundhouse', act: 'Kayo' });
  s = store.noteWaves(s, ['a']);
  store.save(s);
  const back = store.load();
  const v = view([row('a', { wavedAtYou: true }), row('b', { wavedAtYou: true })], { battery: 40, live: false });
  assert.deepEqual(newWaves(v, store.tonight(back).waves).map((r) => r.handle), ['b']);
  assert.equal(store.noteWaves(back, ['a']), back, 'seen again changes nothing');
  assert.deepEqual(store.tonight(store.noteWaves(back, ['b', 'a'])).waves, ['a', 'b']);
  assert.equal(store.noteWaves({ ...back, nights: {} }, ['a']).nights[store.tonightKey()], undefined, 'no night, no record');
});

test('the words: a row you waved at says they will be told, and How this works says what the wristband does', () => {
  assert.equal(WAVED_LINE, "Waved — they'll be told");
  assert.equal(WAVES_HOW, 'Someone waving shows on your wristband: press its face to see, and hold its side to wave back.');
});
