// ON THE BEAT — what a wristband shows, from what its person is doing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CALLED_SHOW_MS, CODE_LETTERS, FOUND_SHOW_MS, MEET_MS, bandShow, cleanCode, newCode, trackKey } from '../relay/band.js';
import { trackKey as phoneTrackKey } from '../app/lib/opener.js';

const T = Date.UTC(2026, 8, 23, 11, 0);
const view = (me = {}, matches = []) => ({ me: { armed: null, invisible: false, pick: null, ...me }, matches });

test('each armed card is its own light, with words — colour is never the only signal', () => {
  assert.deepEqual(bandShow({ view: view({ armed: 'hi' }), now: T }), { kind: 'hi', intent: 'hi', big: 'HI :)', small: 'blue means hello', dim: false, armed: 'hi', rev: 0 });
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

test('waiting for its owner, and a person not in a room, are shows of their own', () => {
  assert.deepEqual(bandShow({ view: null, waiting: true, now: T }), { kind: 'waiting' });
  assert.deepEqual(bandShow({ view: null, battery: 40, now: T }), { kind: 'off', battery: 40, away: true });
  assert.equal(bandShow({ view: null, code: 'KXRT', waiting: true, now: T }).kind, 'pairing', 'letters come first');
});

test('a show made from the view names what is armed and its rev; the others name neither', () => {
  const m = { id: 'm1', intent: 'song', number: 27, at: T };
  for (const [v, armed] of [[view({ armed: 'dance', rev: 7 }), 'dance'], [view({ rev: 7 }), null], [view({ invisible: true, rev: 7 }), null], [view({ armed: 'hi', rev: 7 }, [m]), 'hi']]) {
    const s = bandShow({ view: v, now: T });
    assert.deepEqual([s.armed, s.rev], [armed, 7], JSON.stringify(s));
  }
  for (const s of [bandShow({ view: null, now: T }), bandShow({ view: view(), code: 'KXRT', now: T }), bandShow({ view: view(), check: 12, now: T }),
    bandShow({ view: view(), testUntil: T + 1, now: T }), bandShow({ view: null, waiting: true, now: T })]) {
    assert.equal('armed' in s || 'rev' in s, false, JSON.stringify(s));
  }
});

test("the sound switch rides on every show to its person's band, and on none that is nobody's yet", () => {
  const m = { id: 'm1', intent: 'song', number: 27, at: T };
  for (const sound of [true, false]) {
    for (const s of [bandShow({ view: view({ armed: 'hi' }), sound, now: T }), bandShow({ view: view(), sound, now: T }),
      bandShow({ view: view({ invisible: true }), sound, now: T }), bandShow({ view: view({ armed: 'hi' }, [m]), sound, now: T }),
      bandShow({ view: view(), testUntil: T + 1, sound, now: T }), bandShow({ view: null, sound, now: T })]) {
      assert.equal(s.sound, sound, JSON.stringify(s));
    }
    for (const s of [bandShow({ view: view(), code: 'KXRT', sound, now: T }), bandShow({ view: view(), check: 12, sound, now: T }),
      bandShow({ view: null, waiting: true, sound, now: T })]) {
      assert.equal('sound' in s, false, JSON.stringify(s));
    }
  }
  // A switch the relay has not heard makes exactly the show it made before there was one.
  for (const v of [view({ armed: 'hi' }), null]) {
    assert.equal('sound' in bandShow({ view: v, now: T }), false);
    assert.equal('sound' in bandShow({ view: v, sound: null, now: T }), false);
  }
});

// ---------- waves (docs/superpowers/specs/2026-09-25-wrist-waves-design.md §3) ----------

test('the waves waiting ride on a show about a person on SAY HI, as the newest, a count and its number', () => {
  const m = { id: 'm1', intent: 'song', number: 27, at: T };
  const waves = [{ handle: 'a1b2c3d4e5', n: T + 9 }, { handle: 'f6a7b8c9d0', n: T + 2 }];
  const want = { ref: 'a1b2c3d4e5', n: 2, seq: T + 9 };
  assert.deepEqual(bandShow({ view: view({ armed: 'hi' }), waves, now: T }).waves, want);
  assert.deepEqual(bandShow({ view: view({ armed: 'hi' }, [m]), waves, now: T }).waves, want, 'a meeting show too');
  for (const s of [bandShow({ view: view({ armed: 'song' }), waves, now: T }), bandShow({ view: view({ armed: 'dance' }), waves, now: T }),
    bandShow({ view: view(), waves, now: T }), bandShow({ view: view({ armed: 'song' }, [m]), waves, now: T }),
    bandShow({ view: view({ armed: 'hi', invisible: true }), waves, now: T }), bandShow({ view: view({ armed: 'hi' }), testUntil: T + 1, waves, now: T }),
    bandShow({ view: view({ armed: 'hi' }), code: 'KXRT', waves, now: T }), bandShow({ view: view({ armed: 'hi' }), check: 12, waves, now: T }),
    bandShow({ view: null, waiting: true, waves, now: T }), bandShow({ view: null, waves, now: T })]) {
    assert.equal('waves' in s, false, JSON.stringify(s));
  }
  assert.equal('waves' in bandShow({ view: view({ armed: 'hi' }), waves: [], now: T }), false, 'nobody waiting: no waves');
  assert.equal('waves' in bandShow({ view: view({ armed: 'hi' }), now: T }), false);
});

// ---------- found each other (docs/superpowers/specs/2026-09-26-wrist-found-design.md §2) ----------

test('a meeting its person alone said found keeps its number, and says FOUND: WAITING', () => {
  const m = { id: 'm1', intent: 'song', number: 27, at: T, found: false, foundAt: null };
  const before = bandShow({ view: view({ armed: 'hi' }, [m]), now: T + 60_000 });
  assert.deepEqual([before.kind, before.big, before.small], ['meet', '27', 'MEET']);
  const said = bandShow({ view: view({ armed: 'hi' }, [{ ...m, found: true }]), now: T + 60_000 });
  assert.deepEqual([said.kind, said.big, said.small], ['meet', '27', 'FOUND: WAITING'], 'the number stays up');
  assert.equal('found' in said, false, 'nothing to play yet');
});

test('found by both: the number goes at once, and every show about its person names it for FOUND_SHOW_MS', () => {
  const at = T + 60_000;
  const m = { id: 'm1', intent: 'song', number: 27, at: T, found: true, foundAt: at };
  const hi = bandShow({ view: view({ armed: 'hi' }, [m]), now: at });
  assert.deepEqual([hi.kind, hi.found], ['hi', { n: 27, intent: 'song' }], 'its card again, well inside MEET_MS, and the flash is the meeting\'s own card');
  for (const v of [view({ armed: 'song' }, [m]), view({ armed: 'dance' }, [m]), view({}, [m])]) {
    assert.deepEqual(bandShow({ view: v, now: at + FOUND_SHOW_MS - 1 }).found, { n: 27, intent: 'song' }, JSON.stringify(v.me));
  }
  assert.equal('found' in bandShow({ view: view({ armed: 'hi' }, [m]), now: at + FOUND_SHOW_MS }), false, 'a minute on, no more');
  for (const s of [bandShow({ view: view({ armed: 'hi', invisible: true }, [m]), now: at }), bandShow({ view: view({ armed: 'hi' }, [m]), code: 'KXRT', now: at }),
    bandShow({ view: view({ armed: 'hi' }, [m]), check: 12, now: at }), bandShow({ view: view({ armed: 'hi' }, [m]), testUntil: at + 1, now: at }),
    bandShow({ view: null, waiting: true, now: at }), bandShow({ view: null, now: at })]) {
    assert.equal('found' in s, false, 'NOT NOW and the shows about nobody: ' + JSON.stringify(s));
  }
  const later = { id: 'm2', intent: 'dance', number: 41, at: T + 1_000, found: true, foundAt: at + 5_000 };
  assert.deepEqual(bandShow({ view: view({ armed: 'hi' }, [m, later]), now: at + 6_000 }).found, { n: 41, intent: 'dance' }, 'the newest found');
  const other = { id: 'm3', intent: 'hi', number: 55, at: T + 2_000, found: false, foundAt: null };
  const both = bandShow({ view: view({ armed: 'hi' }, [m, other]), now: at });
  assert.deepEqual([both.kind, both.big, both.found], ['meet', '55', { n: 27, intent: 'song' }], 'another meeting still on shows, and names the one found');
});

test('the longest show the relay can make fits the band, however many wait', () => {
  // The band drops a frame longer than its buffer whole: firmware/src/main.cpp, struct Event.
  const cpp = readFileSync(new URL('../firmware/src/main.cpp', import.meta.url), 'utf8');
  const size = Number(cpp.match(/struct Event \{[^}]*char text\[(\d+)\]/)[1]);
  const worst = '\u0001'.repeat(60);   // clip() keeps it, and JSON writes each one as six bytes
  const big = Number.MAX_SAFE_INTEGER;
  const waves = Array.from({ length: 5000 }, (_, i) => ({ handle: 'ffffffffff', n: big - i }));
  const m = { id: 'm1', intent: 'dance', number: 99, at: T, found: true, foundAt: null };
  const done = { id: 'm2', intent: 'dance', number: 98, at: T, found: true, foundAt: T };
  const shows = [
    bandShow({ view: view({ armed: 'hi', pick: worst, rev: big }, [m, done]), battery: 1, sound: false, waves, now: T }),
    bandShow({ view: view({ armed: 'hi', pick: worst, rev: big }, [done]), battery: 1, sound: false, waves, now: T }),
    bandShow({ view: view({ armed: 'hi', pick: worst, rev: big }), battery: 1, sound: false, waves, now: T }),
    bandShow({ view: view({ armed: 'song', pick: worst, rev: big }), battery: 1, sound: false, now: T }),
    bandShow({ view: view({ armed: 'dance', rev: big }), battery: 1, sound: false, now: T }),
    bandShow({ view: view({ invisible: true, rev: big }), battery: 100, sound: false, now: T }),
    bandShow({ view: view({ rev: big }), battery: 100, sound: false, now: T }),
    bandShow({ view: null, battery: 100, sound: false, now: T }),
    bandShow({ view: null, testUntil: T + 1, sound: false, now: T }),
    bandShow({ view: null, code: 'WWWW', now: T }),
    bandShow({ view: null, check: 99, now: T }),
  ];
  for (const s of shows) {
    const bytes = Buffer.byteLength(JSON.stringify({ t: 'show', show: s }));
    assert.ok(bytes <= size, `${bytes} bytes over ${size}: ${JSON.stringify(s).slice(0, 60)}`);
  }
});

// ---------- the opener its person called (FIRST SONG?'s answer) ----------

test('the opener named: for CALLED_SHOW_MS every show about a person who called it says so, and nobody else is told', () => {
  const opener = { track: 'Locked Out of Heaven', at: T };
  const at = (me, now, more = {}) => bandShow({ view: { ...view(me), opener, ...more }, now });
  for (const me of [{ armed: 'song', pick: 'locked out of heaven!' }, { armed: 'hi', pick: 'Locked  Out of Heaven' }, { pick: 'LOCKED OUT OF HEAVEN' }]) {
    assert.deepEqual(at(me, T).calledIt, { n: T }, JSON.stringify(me));
    assert.deepEqual(at(me, T + CALLED_SHOW_MS - 1).calledIt, { n: T });
    assert.equal('calledIt' in at(me, T + CALLED_SHOW_MS), false, 'a minute on, no more');
  }
  const meet = at({ armed: 'hi', pick: 'Locked Out of Heaven' }, T + 1000, { matches: [{ id: 'm1', intent: 'hi', number: 27, at: T }] });
  assert.deepEqual([meet.kind, meet.calledIt], ['meet', { n: T }], 'a meeting on the face still plays it');
  for (const me of [{ armed: 'song', pick: 'Grenade' }, { armed: 'song', pick: null }, { armed: 'song', pick: '' }]) {
    assert.equal('calledIt' in at(me, T), false, 'missed, or no pick: nothing, ' + JSON.stringify(me));
  }
  assert.equal('calledIt' in at({ armed: 'song', pick: 'Locked Out of Heaven', invisible: true }, T), false, 'NOT NOW is black');
  assert.equal('calledIt' in bandShow({ view: { ...view({ pick: 'x' }), opener: null }, now: T }), false, 'nothing named');
  assert.equal('calledIt' in bandShow({ view: { ...view({ pick: '' }), opener: { track: '', at: T } }, now: T }), false, 'nothing is not a match');
  assert.equal('calledIt' in bandShow({ view: { ...view({ pick: '???' }), opener: { track: '!!!', at: T } }, now: T }), false, 'nor are two picks with no words');
});

test("the relay matches a pick as the phone does, so the band and the phone never disagree on who called it", () => {
  const apostrophe = String.fromCodePoint(0x2019);
  for (const t of ['Beyonc' + String.fromCodePoint(0xe9), "That's What I Like", 'That' + apostrophe + 's What I Like', '  24K   Magic!! ', 'Just-the-Way You Are', '', null, 'Ünïcödé — Song']) {
    assert.equal(trackKey(t), phoneTrackKey(t), JSON.stringify(t));
  }
});
