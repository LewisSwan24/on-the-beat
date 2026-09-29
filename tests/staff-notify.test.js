// ON THE BEAT — a staff device's notifications, in words (app/staff/notify.js;
// docs/superpowers/specs/2026-09-29-staff-push-design.md §1). Pure, so no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTICE_TAG, NOTIFY_WORDS, fromB64u, sameKey, startState } from '../app/staff/notify.js';

const here = { secure: true, sw: true, push: true, standalone: undefined, permission: 'default' };

test('where a device starts: the button, blocked, no Web Push, or an iPhone to add to the Home Screen first', () => {
  assert.equal(startState(here), 'off');
  assert.equal(startState({ ...here, permission: 'granted' }), 'off', 'then on again after sign-in, by itself');
  assert.equal(startState({ ...here, permission: 'denied' }), 'blocked');
  assert.equal(startState({ ...here, push: false, standalone: false }), 'install', 'an iPhone, in Safari');
  assert.equal(startState({ ...here, standalone: true }), 'off', 'an iPhone, from the Home Screen');
  assert.equal(startState({ ...here, push: false, standalone: true }), 'none', 'an iPhone too old for Web Push');
  assert.equal(startState({ ...here, push: false }), 'none');
  assert.equal(startState({ ...here, sw: false }), 'none');
  assert.equal(startState({ ...here, secure: false }), 'none');
});

test('every state has words of its own, and the button says what it does', () => {
  for (const state of ['off', 'asking', 'on', 'install', 'blocked', 'none', 'refused']) assert.ok(NOTIFY_WORDS[state], state);
  assert.equal(new Set(Object.values(NOTIFY_WORDS)).size, Object.keys(NOTIFY_WORDS).length);
  assert.equal(NOTIFY_WORDS.off, 'NOTIFY THIS DEVICE');
  assert.equal(NOTICE_TAG, 'otb-reports', 'the tag staff-sw.js shows them with');
});

test('the relay\'s key as bytes, and whether a subscription was made with it', () => {
  const bytes = [4, ...Array.from({ length: 64 }, (_, i) => i)];
  const key = Buffer.from(bytes).toString('base64url');
  assert.deepEqual([...fromB64u(key)], bytes);
  const made = (b) => ({ options: { applicationServerKey: Uint8Array.from(b).buffer } });
  assert.equal(sameKey(made(bytes), key), true);
  assert.equal(sameKey(made([4, ...Array(64).fill(9)]), key), false);
  assert.equal(sameKey({ options: {} }, key), false);
  assert.equal(sameKey(null, key), false);
});
