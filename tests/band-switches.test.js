// ON THE BEAT — what the phone keeps across nights: the wristband's sound and beat switches, as the phone says them.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BEAT_HOW, BEAT_SAY, beatRow } from '../app/lib/bandbeat.js';
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

test('the beat switch is on unless the phone has kept it off, beside the sound switch and apart from it', () => {
  assert.equal(load().bandBeat, true, 'on by default');
  save({ ...load(), bandBeat: false });
  assert.equal(JSON.parse(mem.get('otb:v1')).bandBeat, false);
  assert.deepEqual([load().bandBeat, load().bandSound], [false, true]);
  mem.set('otb:v1', JSON.stringify({ bandBeat: 0 }));
  assert.equal(load().bandBeat, true, 'anything but false is on');
});

test("the beat switch's row, what a tap says, and the line in How this works", () => {
  assert.deepEqual(beatRow(true), { icon: 'graphic_eq', label: 'BEAT: ON', sub: 'your card pulses with the music. tap to keep it still.' });
  assert.deepEqual(beatRow(false), { icon: 'music_off', label: 'BEAT: OFF', sub: 'your card stays still, its microphone off. tap to pulse again.' });
  assert.deepEqual(BEAT_SAY, { on: 'your wristband will pulse with the music.', off: 'your wristband will stay still.' });
  assert.equal(BEAT_HOW, 'Your wristband pulses its colour on the beat. It hears loudness only, and records and sends nothing.');
});
