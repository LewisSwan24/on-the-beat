// ON THE BEAT — the way in: someone back the same night opens straight onto it; everyone else sees the splash.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstScreen } from '../app/lib/onboard.js';

const tonight = { show: { id: 'suncorp-stadium-bruno-mars' }, state: {}, left: false };
const s = { promisesSeen: true, name: 'Rae' };

test('back the same night, already in: straight to tonight, no splash', () => {
  assert.equal(firstScreen(s, tonight), 'home');
  assert.equal(firstScreen(s, { ...tonight, state: { invisible: true } }), 'quiet', 'NOT NOW comes back as it was');
});

test('anyone not yet in tonight sees the splash first', () => {
  assert.equal(firstScreen({}, null), 'splash', 'a first visit');
  assert.equal(firstScreen({ promisesSeen: true }, tonight), 'splash', 'no name yet');
  assert.equal(firstScreen({ name: 'Rae' }, tonight), 'splash', 'promises not seen');
  assert.equal(firstScreen(s, null), 'splash', 'no show tonight yet');
  assert.equal(firstScreen(s, { ...tonight, left: true }), 'splash', 'left tonight');
  assert.equal(firstScreen(s, { ...tonight, leaving: true }), 'splash', 'on the way out: the leaving screen comes after the splash');
});
