// ON THE BEAT — what a phone says aloud when the relay refuses something it asked for
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { refusalWords } from '../app/lib/refusals.js';

test('the phone has words for the refusals it speaks, and none for the rest', () => {
  assert.equal(refusalWords({ t: 'error', why: 'clip refused' }), "that didn't go. they may have left, or gone quiet.");
  assert.equal(refusalWords({ t: 'error', why: 'report refused' }), 'too many reports just now. please tell a member of staff.');
  for (const m of [{ t: 'error', why: 'bad join' }, { t: 'error', why: 'constructor' }, { t: 'error', why: '__proto__' },
    { t: 'view' }, { t: 'refused', why: 'report refused' }, null, undefined]) {
    assert.equal(refusalWords(m), null, JSON.stringify(m));
  }
});

test('the app speaks its refusals through that lookup, not one by one', () => {
  const app = readFileSync(new URL('../app/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /refusalWords\(m\)/);
  assert.doesNotMatch(app, /why === 'clip refused'/);
});
