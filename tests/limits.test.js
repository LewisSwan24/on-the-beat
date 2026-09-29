// ON THE BEAT — counting how often something happened, over a sliding window
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rolling } from '../relay/limits.js';

const HOUR = 3_600_000;

test('a key is let through up to its limit in the window, then refused, and each key has its own count', () => {
  const r = rolling({ ms: HOUR, max: 3 });
  assert.deepEqual([0, 1, 2, 3, 4].map((t) => r.take('ana', t)), [true, true, true, false, false]);
  assert.equal(r.take('ben', 5), true);
});

test('the window slides: a time is forgotten an hour after it, not before', () => {
  const r = rolling({ ms: HOUR, max: 2 });
  r.take('ana', 0);
  r.take('ana', 1000);
  assert.equal(r.take('ana', HOUR - 1), false, 'the first is still inside the window');
  assert.equal(r.take('ana', HOUR + 1000), true, 'an hour after the second, only the refused attempt is left');
});

test('a refused attempt counts too: someone who keeps trying is not let back in, and someone who stops is', () => {
  const r = rolling({ ms: HOUR, max: 2 });
  for (const who of ['patient', 'flooder']) {
    r.take(who, 0);
    r.take(who, 1000);
    assert.equal(r.take(who, 2000), false, who + ' is refused');
  }
  for (const minutes of [20, 40, 59]) assert.equal(r.take('flooder', minutes * 60_000), false);
  assert.equal(r.take('patient', HOUR + 2000), true, 'an hour after the last attempt');
  assert.equal(r.take('flooder', HOUR + 2000), false, 'the flooder tried again 21 minutes ago');
});

test('a key never holds more than max times, however many attempts it makes', () => {
  const r = rolling({ ms: HOUR, max: 3 });
  for (let t = 0; t < 1000; t += 1) r.take('ana', t);
  assert.equal(r.held('ana'), 3);
});

test('prune forgets a key once all its times are older than the window, and keeps one that is not', () => {
  const r = rolling({ ms: HOUR, max: 3 });
  r.take('old', 0);
  r.take('recent', HOUR - 1);
  r.prune(HOUR);
  assert.equal(r.size(), 1);
  assert.deepEqual([r.held('old'), r.held('recent')], [0, 1]);
});
