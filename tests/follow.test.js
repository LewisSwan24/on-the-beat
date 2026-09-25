// ON THE BEAT — the phone following the relay: every row of the table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLLOW_SAY, follow, nextSeq, tapMessage } from '../app/lib/follow.js';

const phone = (p = {}) => ({ armed: null, invisible: false, seq: 100, asked: -1, refused: -1, screen: 'home', ...p });
const view = (me = {}) => ({ me: { armed: null, invisible: false, rev: 1, seq: 100, by: 'phone', fresh: false, ...me }, near: [], wall: [], floor: [], matches: [] });

test('a view older than what this phone last said is not followed (rule 4)', () => {
  assert.equal(follow(phone({ seq: 200 }), view({ seq: 199, armed: 'hi', by: 'band' })), null);
  assert.notEqual(follow(phone({ seq: 200 }), view({ seq: 200 })), null, 'the same seq is followed');
});

test('nothing moved: kept as it is, and said carries the view seq', () => {
  const f = follow(phone({ armed: 'hi', screen: 'beacon' }), view({ armed: 'hi', seq: 150 }));
  assert.deepEqual([f.screen, f.clearStack, f.toast, f.events], ['beacon', false, null, []]);
  assert.deepEqual(f.said, { arm: { t: 'arm', intent: 'hi', seq: 150 }, invisible: { t: 'invisible', on: false, seq: 150 } });
  assert.equal(f.seq, 150);
});

test('a different card from the wrist: adopted, stack cleared, off a screen of the old card, told with UNPAIR', () => {
  const f = follow(phone({ armed: 'hi', screen: 'near' }), view({ armed: 'song', by: 'band' }));
  assert.deepEqual([f.armed, f.screen, f.clearStack], ['song', 'home', true]);
  assert.deepEqual(f.toast, { text: FOLLOW_SAY.armed('song'), unpair: true });
  assert.equal(f.toast.text, 'Armed from your wristband: FIRST SONG');
  const same = follow(phone({ armed: 'hi', screen: 'tonight' }), view({ armed: 'song', by: 'band' }));
  assert.equal(same.screen, 'tonight', 'a screen of no card stays');
});

test('the wrist turned the card off', () => {
  const f = follow(phone({ armed: 'dance', screen: 'floor' }), view({ armed: null, by: 'band' }));
  assert.deepEqual([f.armed, f.screen], [null, 'home']);
  assert.deepEqual(f.toast, { text: FOLLOW_SAY.off, unpair: true });
});

test('the first SAY HI from the wrist is the phone\'s event too', () => {
  assert.deepEqual(follow(phone(), view({ armed: 'hi', by: 'band' })).events, ['hi']);
  assert.deepEqual(follow(phone({ armed: 'hi' }), view({ armed: 'hi', by: 'band' })).events, []);
});

test('invisible: the quiet screen, stack cleared, no toast', () => {
  const f = follow(phone({ armed: 'hi', screen: 'beacon' }), view({ invisible: true, by: 'band' }));
  assert.deepEqual([f.invisible, f.armed, f.screen, f.clearStack, f.toast], [true, null, 'quiet', true, null]);
});

test('visible again, no card, from the wrist: off the quiet screen to home', () => {
  const f = follow(phone({ invisible: true, screen: 'quiet' }), view({ by: 'band' }));
  assert.deepEqual([f.invisible, f.screen], [false, 'home']);
  assert.deepEqual(f.toast, { text: FOLLOW_SAY.visible, unpair: true });
});

test('visible with a card in one view: home, and one toast that says both', () => {
  const f = follow(phone({ invisible: true, screen: 'quiet' }), view({ armed: 'hi', by: 'band' }));
  assert.deepEqual([f.invisible, f.armed, f.screen], [false, 'hi', 'home']);
  assert.deepEqual(f.toast, { text: 'Back on, from your wristband: SAY HI', unpair: true });
});

test('a re-created person, while this phone held a card: the card went off, and says why', () => {
  const f = follow(phone({ armed: 'hi', screen: 'beacon' }), view({ fresh: true, by: 'relay' }));
  assert.deepEqual([f.armed, f.screen], [null, 'home']);
  assert.deepEqual(f.toast, { text: FOLLOW_SAY.away, unpair: false });
});

test('the phone\'s own tap did not land: tap again', () => {
  const f = follow(phone({ armed: 'hi', asked: 100, screen: 'beacon' }), view({ armed: null, by: 'phone' }));
  assert.deepEqual([f.armed, f.screen], [null, 'home']);
  assert.deepEqual(f.toast, { text: FOLLOW_SAY.lost, unpair: false });
  const back = follow(phone({ invisible: false, asked: 100, screen: 'home' }), view({ invisible: true, by: 'phone' }));
  assert.deepEqual([back.screen, back.toast?.text], ['quiet', FOLLOW_SAY.lost], 'a TURN BACK ON that did not land');
});

test('a showing tap refused as changed: check and tap again', () => {
  const f = follow(phone({ armed: 'song', asked: 100, refused: 100 }), view({ armed: 'hi', by: 'phone' }));
  assert.deepEqual(f.toast, { text: FOLLOW_SAY.changed, unpair: false });
});

test('a change this phone learned, not asked for, is not blamed on a tap', () => {
  const f = follow(phone({ armed: 'hi', asked: 50 }), view({ armed: null, by: 'phone' }));
  assert.equal(f.toast, null);
});

test('the first view after a relay restart: no wristband in it, nothing said about one', () => {
  const f = follow(phone({ seq: 0 }), view({ seq: 0, by: 'relay', fresh: true, wristband: null }));
  assert.equal(f.toast, null);
  assert.equal(JSON.stringify(f).includes('gone'), false);
});

test('following sends nothing: it only returns what to keep', () => {
  const f = follow(phone({ armed: 'hi' }), view({ armed: 'song', by: 'band' }));
  assert.deepEqual(Object.keys(f).sort(), ['armed', 'clearStack', 'events', 'invisible', 'said', 'screen', 'seq', 'toast']);
});

test('every tap that shows the person names the rev it was chosen from; a tap that hides names none', () => {
  assert.deepEqual(tapMessage('arm', 'hi', 500, 9), { t: 'arm', intent: 'hi', seq: 500, basis: 9 });
  assert.deepEqual(tapMessage('invisible', false, 501, 9), { t: 'invisible', on: false, seq: 501, basis: 9 });
  assert.deepEqual(tapMessage('arm', null, 502, 9), { t: 'arm', intent: null, seq: 502 });
  assert.deepEqual(tapMessage('invisible', true, 503, 9), { t: 'invisible', on: true, seq: 503 });
});

test("a tap's seq is above the last one and never behind the clock", () => {
  assert.equal(nextSeq(100, 50), 101);
  assert.equal(nextSeq(100, 5000), 5000);
});
