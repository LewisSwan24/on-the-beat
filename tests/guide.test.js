// ON THE BEAT — the wristband guide: its practice checks, and its page held to what the band really does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARDS } from '../relay/cards.js';
import { SOUNDS } from '../app/lib/wrist.js';
import { GUIDE } from '../app/copy.js';
import { GUIDE_SOUNDS, PRACTICE_STEPS, bandLive, snapshot, stepDone, usualKeys } from '../app/lib/guide.js';

const view = (me) => ({ me: { armed: null, invisible: false, rev: 5, by: 'phone', ...me } });
const before = { armed: 'hi', invisible: false, rev: 5 };

test('a step is done only by the wrist, and only in its own direction', () => {
  assert.deepEqual(PRACTICE_STEPS, ['wake', 'card', 'dark', 'back', 'meet']);
  assert.equal(stepDone('card', before, view({ armed: 'song', rev: 6, by: 'band' })), true);
  assert.equal(stepDone('card', before, view({ armed: 'song', rev: 6, by: 'phone' })), false, 'the phone never ticks one');
  assert.equal(stepDone('card', before, view({ armed: 'hi', rev: 6, by: 'band' })), false, 'the same card is no change');
  assert.equal(stepDone('card', before, view({ armed: 'song', rev: 5, by: 'band' })), false, 'nothing moved since the step began');
  assert.equal(stepDone('card', before, view({ armed: null, invisible: true, rev: 6, by: 'band' })), false, 'dark is not a card');
  assert.equal(stepDone('dark', before, view({ invisible: true, rev: 6, by: 'band' })), true);
  assert.equal(stepDone('dark', before, view({ invisible: true, rev: 6, by: 'phone' })), false);
  const dark = { armed: null, invisible: true, rev: 6 };
  assert.equal(stepDone('dark', dark, view({ invisible: true, rev: 7, by: 'band' })), false, 'dark already is no step');
  assert.equal(stepDone('back', dark, view({ armed: 'hi', invisible: false, rev: 7, by: 'band' })), true);
  assert.equal(stepDone('back', dark, view({ invisible: true, rev: 7, by: 'band' })), false);
  assert.equal(stepDone('back', before, view({ armed: 'song', rev: 6, by: 'band' })), false, 'back needs NOT NOW first');
  assert.equal(stepDone('wake', before, view({ by: 'band', rev: 9 })), false, 'a wake is never heard: the person says it');
  assert.equal(stepDone('meet', before, view({ by: 'band', rev: 9 })), false, 'drawn, not live');
  assert.equal(stepDone('card', before, { me: null }), false);
});

test('snapshot keeps what a step is measured from, and bandLive reads the band', () => {
  assert.deepEqual(snapshot(view({ armed: 'dance', invisible: false, rev: 8 })), { armed: 'dance', invisible: false, rev: 8 });
  assert.deepEqual(snapshot({ me: null }), { armed: null, invisible: false, rev: 0 });
  assert.equal(bandLive(view({ wristband: { live: true } })), true);
  assert.equal(bandLive(view({ wristband: { live: true, off: true } })), false);
  assert.equal(bandLive(view({ wristband: { live: false } })), false);
  assert.equal(bandLive(view({})), false);
});

test('every sound the band makes is explained, once, and nothing else is', () => {
  assert.deepEqual(GUIDE_SOUNDS.map((r) => r.sound), Object.keys(SOUNDS));
  assert.deepEqual(Object.keys(GUIDE.sounds).sort(), Object.keys(SOUNDS).sort());
  for (const r of GUIDE_SOUNDS) assert.ok(r.says && r.says === r.says.trim(), r.sound);
});

test('every card has its colour row', () => {
  assert.deepEqual(Object.keys(GUIDE.lights.cards).sort(), CARDS.map((c) => c.id).sort());
});

/** Every word the band can put on its face, read from the source of the wrist logic, the relay's shows and the firmware. */
function faceWords() {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const wrist = read('../app/lib/wrist.js');
  const band = read('../relay/band.js');
  const fw = read('../firmware/src/band_logic.h');
  const main = read('../firmware/src/main.cpp');
  const words = new Set();
  const add = (w) => { if (w && /[A-Z]{2}/.test(w)) words.add(w.trim()); };
  // The second line is often worked out (NO SIGNAL's battery, say): it is read when it is a plain string, and skipped when not.
  for (const [, a, b] of wrist.matchAll(/words\('([^']*)'(?:, '([^']*)')?/g)) { add(a); add(b); }
  for (const [, w] of wrist.matchAll(/\b(?:big|small) = '([^']+)'/g)) add(w);
  for (const [, w] of wrist.matchAll(/\b(?:big|small): '([^']+)'/g)) add(w);
  for (const [, w] of band.matchAll(/small: [^,}]*?'([A-Z][A-Z :]+)'/g)) add(w);
  for (const [, a, b] of fw.matchAll(/return \{"([A-Z][^"]*)"(?:, "([^"]*)")?/g)) { add(a); add(b); }
  for (const [, w] of fw.matchAll(/\b[a-z]\.(?:big|small) = "([A-Z][^"]*)"/g)) add(w);
  for (const [, w] of main.matchAll(/s\.(?:big|small) = "([A-Z][^"]*)"/g)) add(w);
  return [...words];
}

test('the face words are read from the source at all', () => {
  const words = faceWords();
  for (const w of ['NO WI-FI', 'NOT NOW', 'READY', 'SAVED', 'FOUND: WAITING', 'NO SIGNAL']) assert.ok(words.includes(w), w);
});

test('every word the band can show has its row in the button table', () => {
  const table = GUIDE.screens.map((r) => r.face.join(' / ')).join('\n');
  const missing = faceWords().filter((w) => !table.includes(w));
  assert.deepEqual(missing, [], 'add a row to GUIDE.screens for each');
});

test('docs/wristband-guide.md names every screen the page does', () => {
  const doc = readFileSync(new URL('../docs/wristband-guide.md', import.meta.url), 'utf8');
  for (const r of GUIDE.screens) for (const w of r.face) assert.ok(doc.includes(w), w);
});

test('guideSeen is kept for good once set, and only a true sets it', async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const store = await import('../app/lib/store.js');
  assert.equal(store.load().guideSeen, false, 'a new phone has not seen it');
  store.save({ ...store.load(), guideSeen: true });
  assert.equal(store.load().guideSeen, true);
  mem.set('otb:v1', JSON.stringify({ guideSeen: 'yes' }));
  assert.equal(store.load().guideSeen, false, 'nothing but true counts');
});

test('ending the practice puts back what it opened on, in taps the relay takes, never showing a practised card', async () => {
  const { restoreTaps } = await import('../app/lib/guide.js');
  const me = (armed, invisible = false) => ({ armed, invisible });
  const all = ['hi', 'song', 'dance'];
  // Opened on HI, visible.
  assert.deepEqual(restoreTaps({ armed: 'hi', invisible: false }, me('song'), all), [['arm', 'hi']]);
  assert.deepEqual(restoreTaps({ armed: 'hi', invisible: false }, me(null, true), all), [['arm', 'hi']],
    'from dark one arm: it clears NOT NOW itself, and a second showing tap would be refused');
  assert.deepEqual(restoreTaps({ armed: 'hi', invisible: false }, me('hi'), all), []);
  // Opened on no card, visible.
  assert.deepEqual(restoreTaps({ armed: null, invisible: false }, me('song'), all), [['arm', null]]);
  assert.deepEqual(restoreTaps({ armed: null, invisible: false }, me(null, true), all), [['arm', null], ['invisible', false]],
    'NOT NOW\'s kept card is let go first, so coming back brings nothing practised');
  assert.deepEqual(restoreTaps({ armed: null, invisible: false }, me(null), all), []);
  // Opened in NOT NOW.
  assert.deepEqual(restoreTaps({ armed: null, invisible: true }, me('song'), all), [['arm', null], ['invisible', true]]);
  assert.deepEqual(restoreTaps({ armed: null, invisible: true }, me(null, true), all), []);
  // A card the venue closed meanwhile is not asked for.
  assert.deepEqual(restoreTaps({ armed: 'dance', invisible: false }, me('song'), ['hi', 'song']), [['arm', null]]);
  assert.deepEqual(restoreTaps({ armed: 'dance', invisible: false }, me(null, true), ['hi', 'song']), [['arm', null], ['invisible', false]]);
  assert.deepEqual(restoreTaps(null, me('song'), all), []);
});

test('the button table comes in short groups, by what is going on, and every screen is in one', () => {
  const ids = GUIDE.groups.map(([id]) => id);
  assert.deepEqual(ids, ['card', 'meet', 'setup', 'other'], 'what is pressed most comes first');
  assert.deepEqual(GUIDE.groups.map(([, , open]) => !!open), [true, true, false, false], 'the two used most are open; the rest fold');
  for (const r of GUIDE.screens) assert.ok(ids.includes(r.group), r.face.join(' / ') + ' has no group');
  for (const id of ids) {
    const n = GUIDE.screens.filter((r) => r.group === id).length;
    assert.ok(n >= 1 && n <= 7, id + ' holds ' + n + ' rows');
  }
});

test('the two things FACE does almost everywhere are said once, above the groups, not on every row', () => {
  assert.match(GUIDE.usual, /FACE wakes it/);
  assert.match(GUIDE.usual, /FACE held is NOT NOW/);
  const rest = GUIDE.screens.flatMap((r) => usualKeys(r).filter(([, d]) => /^(wakes it|NOT NOW)/.test(d)));
  assert.deepEqual(rest, [], 'no row repeats them');
  const ready = usualKeys(GUIDE.screens.find((r) => r.face[0] === 'READY')).map(([k]) => k);
  assert.deepEqual(ready, ['SIDE', 'SIDE held'], 'READY keeps only what is its own');
});

test('buttons that do the same thing on a screen share one line', () => {
  const meet = usualKeys(GUIDE.screens.find((r) => r.face[1] === 'MEET'));
  assert.deepEqual(meet, [['FACE / SIDE', 'stops the blinking, and nothing else']]);
  const pair = usualKeys(GUIDE.screens.find((r) => r.face[1] === 'PAIR ON YOUR PHONE'));
  assert.deepEqual(pair, [['FACE / SIDE', 'says PAIR ON YOUR PHONE']]);
});

test('the page opens on the few things done all night, and every part below is one folded line', () => {
  const { groups } = GUIDE.essentials;
  assert.deepEqual(groups.map((g) => g.title), ['Your card', 'Going quiet', 'Meeting someone', 'Any time']);
  const rows = groups.flatMap((g) => g.rows);
  assert.ok(rows.length >= 8 && rows.length <= 12, rows.length + ' lines: enough to use it all night, not the whole table');
  for (const r of rows) {
    assert.ok(r.says, 'each says what it does');
    for (const k of r.keys) assert.ok(GUIDE.columns.includes(k), 'a button the table knows: ' + k);
    assert.ok(r.keys.length || r.on, 'a line names a button, a screen, or both');
  }
  // Every screen a line points at is one the band really shows.
  const faces = GUIDE.screens.map((s) => s.face.join(' / '));
  for (const r of rows.filter((x) => x.on)) assert.ok(faces.some((f) => f.includes(r.on.join(' / '))), r.on.join(' / '));
  assert.deepEqual(GUIDE.parts.map(([id]) => id), ['start', 'pair', 'buttons', 'lights', 'meeting', 'trouble']);
  for (const [, label] of GUIDE.parts) assert.match(label, /^[A-Z][a-z]/, 'a folded part reads as a line, not a shout: ' + label);
});
