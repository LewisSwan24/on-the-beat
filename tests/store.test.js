// ON THE BEAT — what the phone keeps across nights, and the wristband's sound switch as the phone says it.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SOUND_SAY, soundRow } from '../app/lib/bandsound.js';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { load, save } = await import('../app/lib/store.js');
beforeEach(() => mem.clear());

test('the sound switch is on unless the phone has kept it off, and it is kept beside the name, not in a night', () => {
  assert.equal(load().bandSound, true, 'on by default');
  save({ ...load(), bandSound: false });
  assert.equal(JSON.parse(mem.get('otb:v1')).bandSound, false);
  assert.equal(load().bandSound, false);
  mem.set('otb:v1', JSON.stringify({ bandSound: 'off' }));
  assert.equal(load().bandSound, true, 'anything but false is on');
});

test("the wristband sheet's row says the switch as it stands, and the phone says what a tap did", () => {
  assert.deepEqual(soundRow(true), { icon: 'volume_up', label: 'SOUND: ON', sub: 'tap for light only.' });
  assert.deepEqual(soundRow(false), { icon: 'volume_off', label: 'SOUND: OFF', sub: 'light only. tap to hear it again.' });
  assert.deepEqual(SOUND_SAY, { on: 'your wristband will chirp again.', off: 'your wristband will only light up.' });
});
