import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openerArrived, openerEvent, openerNews, sameTrack, trackKey } from '../app/lib/opener.js';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const store = await import('../app/lib/store.js');

test('a pick is the same song whatever its case, accents, punctuation or spacing', () => {
  assert.equal(sameTrack('Locked Out of Heaven', 'locked out of heaven!'), true);
  assert.equal(sameTrack('  24K   Magic ', '24k magic'), true);
  assert.equal(sameTrack("That's What I Like", 'Thats What I Like'), true, 'an apostrophe is often not typed');
  assert.equal(sameTrack('That' + String.fromCodePoint(0x2019) + 's What I Like', "that's what i like"), true, 'nor typed the same way');
  assert.equal(sameTrack('Beyoncé', 'beyonce'), true);
  assert.equal(sameTrack('Treasure', 'Grenade'), false);
  assert.equal(sameTrack('', ''), false, 'nothing is not a match');
  assert.equal(sameTrack(null, undefined), false);
  assert.equal(trackKey('Just-the-Way You Are'), 'just the way you are');
});

test('nothing is said until the opener is named', () => {
  assert.equal(openerNews(null, 'Treasure', []), null);
  assert.equal(openerNews({ track: '' }, 'Treasure', []), null);
});

test('the person who called it is told so, and the wall says how many did, never who', () => {
  const wall = [{ pick: 'treasure' }, { pick: 'Grenade' }, { pick: 'TREASURE!' }];
  assert.deepEqual(openerNews({ track: 'Treasure', at: 1 }, 'Treasure', wall),
    { track: 'Treasure', called: true, line: 'You called it.', crowd: '2 more here did too.' });
  assert.deepEqual(openerNews({ track: 'Treasure', at: 1 }, 'Grenade', wall),
    { track: 'Treasure', called: false, line: 'Not this time.', crowd: '2 here called it.' });
  assert.equal(openerNews({ track: 'Treasure' }, '', wall).line, '', 'no pick, no verdict');
  assert.equal(openerNews({ track: 'Treasure' }, 'Treasure', []).crowd, 'nobody else here did.');
  assert.equal(openerNews({ track: 'Treasure' }, 'Treasure', [{ pick: 'treasure' }]).crowd, '1 more here did too.');
  assert.equal(openerNews({ track: 'Treasure' }, 'Grenade', [{ pick: 'Treasure' }]).crowd, '1 here called it.');
  assert.equal(openerNews({ track: 'Treasure' }, 'Grenade', []).crowd, 'nobody here called it.');
});

test('Tonight keeps one line for it', () => {
  assert.equal(openerEvent(openerNews({ track: 'Treasure' }, 'treasure', [])), 'the opener was Treasure — you called it');
  assert.equal(openerEvent(openerNews({ track: 'Treasure' }, 'Grenade', [])), 'the opener was Treasure');
});

const view = (opener) => ({ me: { pick: null }, opener });

test('the answer is told once, with the pick held as it was when it came', () => {
  assert.equal(openerArrived({}, { me: null }, 'Treasure'), null, 'no view from the room yet');
  assert.equal(openerArrived({}, view(null), 'Treasure'), null, 'nothing named, nothing to do');
  const first = openerArrived({}, view({ track: 'Treasure', at: 10 }), 'treasure');
  assert.deepEqual(first, {
    patch: { openerSeen: 'Treasure', openerAt: 10, openerPick: 'treasure' },
    event: 'the opener was Treasure — you called it',
    say: 'The opener was Treasure. You called it!',
  });
  assert.equal(openerArrived(first.patch, view({ track: 'Treasure', at: 10 }), 'treasure'), null, 'told once');
  // Changed to the answer after it came: still not called.
  const late = openerArrived({}, view({ track: 'Treasure', at: 10 }), 'Grenade');
  assert.equal(late.say, 'The opener was Treasure.');
  assert.equal(openerArrived(late.patch, view({ track: 'Treasure', at: 10 }), 'Treasure'), null);
  // Staff put it right: told again, against the pick held from before.
  const fixed = openerArrived(late.patch, view({ track: 'Grenade', at: 20 }), 'Treasure');
  assert.equal(fixed.say, 'The opener was Grenade. You called it!');
  assert.equal(fixed.patch.openerPick, 'Grenade');
});

test('an answer taken back takes its line and its held pick with it', () => {
  const back = openerArrived({ openerSeen: 'Treasure', openerAt: 10, openerPick: 'x' }, view(null), 'x');
  assert.deepEqual(back, { patch: { openerSeen: null, openerAt: null, openerPick: null }, event: null, say: null });
});

test("Tonight keeps one line of a kind: made, replaced, and taken out", () => {
  mem.clear();
  let s = store.startNight(store.load(), { id: 'v', room: 'v', venue: 'Moth Club, Hackney', act: 'X' });
  const n = () => store.tonight(s).events.filter((e) => e.kind === 'opener');
  s = store.setEvent(s, 'opener', 'the opener was A', 5);
  assert.deepEqual(n(), [{ at: 5, kind: 'opener', text: 'the opener was A' }]);
  const same = store.setEvent(s, 'opener', 'the opener was A', 5);
  assert.equal(same, s, 'no change is the same record');
  s = store.setEvent(s, 'opener', 'the opener was B', 6);
  assert.deepEqual(n(), [{ at: 6, kind: 'opener', text: 'the opener was B' }]);
  s = store.setEvent(s, 'opener', null);
  assert.deepEqual(n(), []);
  assert.equal(store.setEvent(s, 'opener', null), s);
  assert.equal(store.tonight(s).events[0].kind, 'arrived', 'the other lines stay');
});
