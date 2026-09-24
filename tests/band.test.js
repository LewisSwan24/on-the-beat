// ON THE BEAT — what a wristband shows, from what its person is doing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_LETTERS, MEET_MS, bandShow, cleanCode, newCode } from '../relay/band.js';

const T = Date.UTC(2026, 8, 23, 11, 0);
const view = (me = {}, matches = []) => ({ me: { armed: null, invisible: false, pick: null, ...me }, matches });

test('each armed card is its own light, with words — colour is never the only signal', () => {
  assert.deepEqual(bandShow({ view: view({ armed: 'hi' }), now: T }), { kind: 'hi', intent: 'hi', big: 'HI :)', small: 'blue means hello', dim: false });
  const song = bandShow({ view: view({ armed: 'song', pick: 'Just the Way You Are' }), now: T });
  assert.deepEqual([song.big, song.small], ['FIRST SONG?', 'Just the Way Yo…'], 'your own pick, short enough to read');
  assert.equal(bandShow({ view: view({ armed: 'dance' }), now: T }).big, "LET'S DANCE!");
});

test('nothing armed, or NOT NOW, is black', () => {
  assert.equal(bandShow({ view: view(), battery: 62, now: T }).kind, 'off');
  const quiet = bandShow({ view: view({ armed: 'hi', invisible: true }), now: T });
  assert.deepEqual([quiet.kind, quiet.quiet], ['off', true]);
  assert.equal(bandShow({ view: null, now: T }).kind, 'off', 'a person not in a room lights nothing');
});

test('after a mutual yes: the meeting number, the same on both wrists, for a while — then back to what you armed', () => {
  const m = { id: 'm1', intent: 'song', number: 27, at: T };
  const a = bandShow({ view: view({ armed: 'hi' }, [m]), now: T + 60_000 });
  assert.deepEqual([a.kind, a.intent, a.big, a.small], ['meet', 'song', '27', 'MEET']);
  const b = bandShow({ view: view({}, [{ ...m }]), now: T + 60_000 });
  assert.equal(b.big, a.big, 'the other wristband shows the same number');
  assert.equal(bandShow({ view: view({ armed: 'hi' }, [m]), now: T + MEET_MS + 1 }).kind, 'hi');
  assert.equal(bandShow({ view: view({ invisible: true }, [m]), now: T + 1 }).kind, 'off', 'NOT NOW hides the number too');
});

test('it never shows anything about anyone else but that number', () => {
  const m = { id: 'm1', intent: 'hi', number: 41, at: T, name: 'Mia', pick: 'Treasure', contact: '@mia' };
  const seen = JSON.stringify(bandShow({ view: view({ armed: 'hi' }, [m]), now: T }));
  for (const secret of ['Mia', 'Treasure', '@mia']) assert.equal(seen.includes(secret), false, secret);
});

test('low battery halves the light; pairing and TEST THE LIGHT come first', () => {
  assert.equal(bandShow({ view: view({ armed: 'hi' }), battery: 15, now: T }).dim, true);
  assert.equal(bandShow({ view: view({ armed: 'hi' }), battery: 16, now: T }).dim, false);
  assert.deepEqual(bandShow({ view: view({ armed: 'hi' }), code: 'KXRT', now: T }), { kind: 'pairing', code: 'KXRT' });
  assert.equal(bandShow({ view: view({ armed: 'hi' }), testUntil: T + 1, now: T }).kind, 'test');
});

test('a pairing code is four letters nobody can misread, and never one already waiting', () => {
  for (const bad of 'ILO01') assert.equal(CODE_LETTERS.includes(bad), false, bad);
  let i = 0;
  const rolls = [0, 0, 0, 0, 0, 0, 0, 0.99];
  const rand = () => rolls[i++ % rolls.length];
  assert.equal(newCode(new Set(), rand), 'AAAA');
  i = 0;
  assert.notEqual(newCode(new Set(['AAAA']), rand), 'AAAA');
  assert.equal(cleanCode(' kx-r1t o'), 'KXRT', 'lower case is fine; anything else is dropped');
});

test('while a pairing waits for YES the wrist shows the check number, before anything else', () => {
  assert.deepEqual(bandShow({ view: view({ armed: 'hi' }), code: 'KXRT', check: 27, testUntil: T + 1, now: T }), { kind: 'check', big: '27' });
});
