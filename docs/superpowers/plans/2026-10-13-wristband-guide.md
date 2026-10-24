# Wristband Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A practice run on the phone after a person's first pairing, private on the relay while it runs, and a reference page that walks through the band from power-on to trouble.

**Architecture:** The relay gains a per-person practice flag kept in a Map beside the people (never in the night dump) that `shows()` and `seen()` honour, set by a `{t:'practice'}` message and swept after five minutes. The phone gains pure logic in `app/lib/guide.js` (step checks, band liveness) and all words in `GUIDE` in `app/copy.js`; two screens in `app/screens/Guide.jsx` (`Practice`, `BandGuide`) wired into `App.jsx`; `follow()` keeps the phone on the practice screen. Completeness tests hold the page to the band's sounds, cards and face words.

**Tech Stack:** Node 24 `node:test`, React (Vite), the relay's `ws` harness (`tests/relay-harness.js`), Web Audio through `app/lib/speaker.js`.

**Spec:** `docs/superpowers/specs/2026-10-13-wristband-guide-design.md` (648726b).

## Global Constraints

- Every word of copy lives in `app/copy.js` (`GUIDE`); lower case for prose, upper case for what is on the band or a button.
- Icons only from the subset already in `app/fonts/fonts.json` (`watch`, `touch_app`, `wifi_off`, `link`, `volume_up`, `check_circle`, `chevron_right`, `flashlight_on`, `waving_hand`, `visibility_off`, `qr_code_scanner`, `smartphone`, …); a new one fails `tests/fonts.test.js`.
- Practice is never written to the night file and never shown in anyone else's view; `PRACTICE_MS = 5 * 60_000`.
- A change made from the phone never ticks a practice step; only `me.by === 'band'` does.
- Repo is public: nothing secret, no passcodes, no interview material. Artefacts in English.
- `npm test` green before each commit; commit and push to `main`.

## Review Focus

1. A phone that closes mid-practice: the person must reappear on lists within `PRACTICE_MS` plus one sweep. Pinned in Task 2 by a clock test through `relay.expire()`.
2. A stale handle: someone shown the person before practice began waves or likes with the old handle: refused, no match. Pinned in Task 1.
3. Practice across a relay restart: not in the dump, and a phone still on the practice screen says it again on join (`net.say`). Pinned in Task 1 (dump) and Task 5 (`net.say`, browser).
4. The band out of reach during practice: steps 2-4 must not wait for ever; they offer GOT IT. Pinned in Task 3 (`bandLive`) and Task 6 (browser).
5. A person who leaves practice by the back gesture or by pairing again: the card and NOT NOW they had are put back and practice is ended. Pinned in Task 5 (one `endPractice` path for every exit) and Task 6 (browser).

---

### Task 1: Practice on the room

**Files:**
- Modify: `relay/room.js` (`shows` ~273, `seen` ~752, `viewFor` ~883, the returned API ~952)
- Test: `tests/room.test.js`

**Interfaces:**
- Produces: `room.setPractice(id, on)`; `room.sweepPractice(at) → boolean` (true when someone's practice ended); `view.me.practice` (boolean, own view only); exported `PRACTICE_MS`.

- [ ] **Step 1: Write the failing tests** (after the N3 tests in `tests/room.test.js`)

```js
test('practice: a practising person is on nobody\'s list and sees nobody, and their own view and card are unchanged', () => {
  const { room, handleOf } = night();
  room.arm('ana', 'hi');
  room.pick('ana', 'Grenade');
  room.arm('ben', 'hi');
  const old = handleOf('ben', 'ana');
  room.setPractice('ana', true);
  assert.equal(room.viewFor('ana').me.armed, 'hi', 'her card stays');
  assert.equal(room.viewFor('ana').me.practice, true, 'her own view says she is practising');
  assert.equal(room.viewFor('ben').me.practice, false, 'nobody else is');
  assert.deepEqual(room.viewFor('ben').near, []);
  assert.deepEqual(room.viewFor('ben').wall, []);
  assert.deepEqual(room.viewFor('ana').near, [], 'she sees nobody');
  room.wave('ben', old);
  room.wave('ana', handleOf('ana', 'ben'));
  assert.deepEqual(room.viewFor('ben').matches, [], 'a handle from before practice reaches nobody');
  room.setPractice('ana', false);
  assert.equal(room.viewFor('ben').near.length, 1, 'back on lists once practice ends');
});

test('practice ends by itself PRACTICE_MS after it was last said, and is never in the dump', () => {
  const { room, tick } = night();
  room.arm('ana', 'hi');
  room.arm('ben', 'hi');
  room.setPractice('ana', true);
  assert.ok(!JSON.stringify(room.dump()).includes('practi'), 'not kept');
  tick(PRACTICE_MS - 1);
  assert.equal(room.sweepPractice(), false);
  assert.deepEqual(room.viewFor('ben').near, []);
  tick(2);
  assert.equal(room.viewFor('ben').near.length, 1, 'past its time she shows again, even before a sweep');
  assert.equal(room.sweepPractice(), true, 'and the sweep says someone ended, so views are pushed');
  assert.equal(room.sweepPractice(), false);
});

test('practice is said again to stay on: each true moves its end', () => {
  const { room, tick } = night();
  room.arm('ana', 'hi');
  room.setPractice('ana', true);
  tick(PRACTICE_MS - 1000);
  room.setPractice('ana', true);
  tick(2000);
  assert.deepEqual(room.viewFor('ben').near, []);
  room.setPractice('nobody', true);   // not here: nothing
  assert.equal(room.viewFor('ana').me.practice, true);
});
```

Add `PRACTICE_MS` to the test file's import from `../relay/room.js`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/room.test.js 2>&1 | grep -E "^✖|ℹ (pass|fail)"`
Expected: FAIL (`room.setPractice is not a function` / `PRACTICE_MS` undefined).

- [ ] **Step 3: Implement**

In `relay/room.js`, beside the other exported constants:

```js
/** How long a practice lasts once it was last said: a phone closed mid-practice does not hide anyone all night. */
export const PRACTICE_MS = 5 * 60_000;
```

Inside `createRoom`, before `shows`:

```js
  // Practising (the wristband guide): until when, by person. Never in dump(): a restart ends it, and a phone still on
  // its practice screen says it again when it joins.
  const practising = new Map();
  const practises = (id) => (practising.get(id) ?? 0) > now();
```

Change `shows` and `seen`:

```js
  const shows = (a, b) => canSee(a, b) && !people.get(b).invisible && !practises(b);
```

```js
  const seen = (id) => (people.get(id)?.invisible || practises(id) ? [] : [...people.values()].filter((p) => shows(id, p.id)));
```

In `viewFor`'s `me`, after `was: …,`:

```js
        practice: practises(id),
```

Add the functions near `setInvisible`:

```js
  /** Practice on (again, for PRACTICE_MS) or off. Only for someone here. */
  function setPractice(id, on) {
    if (!people.has(id)) return;
    if (on) practising.set(id, now() + PRACTICE_MS);
    else practising.delete(id);
  }

  /** Lets go of practices past their time. True when one ended, so the relay pushes views. */
  function sweepPractice(at = now()) {
    let ended = false;
    for (const [id, until] of practising) if (until <= at || !people.has(id)) { practising.delete(id); ended = true; }
    return ended;
  }
```

Add `setPractice, sweepPractice,` to the returned object after `setInvisible`. In `leave(id)` add `practising.delete(id);`.

- [ ] **Step 4: Run them to see them pass, and the whole room file**

Run: `node --test tests/room.test.js 2>&1 | grep -E "^✖|ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 5: Mutation-check.** One at a time, each must turn exactly its test red, then restore: drop `&& !practises(b)` from `shows`; drop `|| practises(id)` from `seen`; make `practises` return `practising.has(id)`; make `sweepPractice` return `false`.

- [ ] **Step 6: Commit.** `git add relay/room.js tests/room.test.js` then `git commit` ("Relay: a practising person is on nobody's list, for five minutes from when it was last said").

### Task 2: The `practice` message and its sweep

**Files:**
- Modify: `relay/server.js` (the phone `switch (m.t)` ~1104; `expire(at)` ~1434)
- Create: `tests/practice.test.js`

**Interfaces:**
- Consumes: `room.setPractice`, `room.sweepPractice`, `PRACTICE_MS` (Task 1).
- Produces: phone message `{ t: 'practice', on: boolean }`; a non-boolean `on` is dropped.

- [ ] **Step 1: Write the failing tests** in `tests/practice.test.js`:

```js
// ON THE BEAT — the wristband guide's practice on the relay: private while it runs, and over by itself.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRelay } from '../relay/server.js';
import { PRACTICE_MS } from '../relay/room.js';
import { helpers } from './relay-harness.js';

let relay;
let dir;
let t = Date.UTC(2026, 9, 13, 9, 0);
const { phone, cleanup } = helpers(() => relay.port);
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'otb-practice-'));
  relay = await createRelay({ port: 0, host: '127.0.0.1', root: dir, clock: () => t });
});
after(async () => { cleanup(); await relay.close(); rmSync(dir, { recursive: true, force: true }); });

test('practice hides its person from every other phone until it is said off', async () => {
  const ana = await phone('roundhouse-bruno-mars');
  const ben = await phone('roundhouse-bruno-mars');
  ana.send({ t: 'arm', intent: 'hi', seq: 1 });
  ben.send({ t: 'arm', intent: 'hi', seq: 1 });
  await ben.until((v) => v.near.length === 1);
  ana.send({ t: 'practice', on: true });
  await ben.until((v) => v.near.length === 0);
  await ana.until((v) => v.me.practice === true && v.me.armed === 'hi');
  ana.send({ t: 'practice', on: false });
  await ben.until((v) => v.near.length === 1);
});

test('a phone that never says off: the sweep after PRACTICE_MS shows its person again', async () => {
  const ana = await phone('roundhouse-bruno-mars');
  const ben = await phone('roundhouse-bruno-mars');
  ana.send({ t: 'arm', intent: 'hi', seq: 1 });
  ben.send({ t: 'arm', intent: 'hi', seq: 1 });
  ana.send({ t: 'practice', on: true });
  await ben.until((v) => !v.near.length);
  t += PRACTICE_MS + 1;
  relay.expire(t);
  await ben.until((v) => v.near.length >= 1);
});

test('a malformed practice is dropped', async () => {
  const ana = await phone('roundhouse-bruno-mars');
  ana.send({ t: 'practice', on: 'yes' });
  ana.send({ t: 'practice' });
  ana.send({ t: 'ping' });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(ana.view.me.practice, false);
});
```

If `cleanup` or `relay.expire` differ in name in the harness, use the ones `tests/wristband.test.js` uses (it calls `relay.expire(...)` and gets `cleanup` from `helpers`).

- [ ] **Step 2: Run to see it fail.** `npm run build >/dev/null && node --test tests/practice.test.js 2>&1 | grep -E "^✖|ℹ (pass|fail)"`. Expected: the first two time out (`timed out; last view`).

- [ ] **Step 3: Implement.** In the phone `switch` of `relay/server.js`, beside `case 'sound':`

```js
      case 'practice':
        // The wristband guide: while it runs its person is on nobody's list (room.setPractice). Only true or false.
        if (typeof m.on !== 'boolean') return;
        room.setPractice(me, m.on);
        break;
```

and in `expire(at)`, inside the `for (const r of [...rooms.values()])` loop, first line:

```js
      if (r.room.sweepPractice(at)) push(r);
```

- [ ] **Step 4: Run to see it pass.** Same command; `ℹ fail 0`.
- [ ] **Step 5: Mutation-check.** Remove the `typeof` guard (malformed test red); remove the sweep line (second test red). Restore.
- [ ] **Step 6: Commit** (`relay/server.js tests/practice.test.js`): "Relay: the practice message, and practice swept after five minutes".

### Task 3: Guide logic and words

**Files:**
- Create: `app/lib/guide.js`
- Modify: `app/copy.js` (add `GUIDE`)
- Create: `tests/guide.test.js`

**Interfaces:**
- Produces:
  - `PRACTICE_STEPS = ['wake', 'card', 'dark', 'back', 'meet']`
  - `stepDone(step, before, view) → boolean`; `before = { armed, invisible, rev }`
  - `bandLive(view) → boolean` (`view.me.wristband.live && !off`)
  - `snapshot(view) → { armed, invisible, rev }`
  - `GUIDE_SOUNDS`: `[{ sound, says }]`, one per key of `SOUNDS`, in `SOUNDS` order
  - `GUIDE.practice`, `GUIDE.start`, `GUIDE.pair`, `GUIDE.screens`, `GUIDE.sounds`, `GUIDE.lights`, `GUIDE.meeting`, `GUIDE.trouble`, `GUIDE.parts` in `app/copy.js`

- [ ] **Step 1: Write the failing tests** in `tests/guide.test.js`:

```js
// ON THE BEAT — the wristband guide: its practice checks, and its page held to what the band really does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARDS } from '../relay/cards.js';
import { SOUNDS } from '../app/lib/wrist.js';
import { GUIDE } from '../app/copy.js';
import { GUIDE_SOUNDS, PRACTICE_STEPS, bandLive, snapshot, stepDone } from '../app/lib/guide.js';

const view = (me) => ({ me: { armed: null, invisible: false, rev: 5, by: 'phone', ...me } });
const before = { armed: 'hi', invisible: false, rev: 5 };

test('a step is done only by the wrist, and only in its own direction', () => {
  assert.deepEqual(PRACTICE_STEPS, ['wake', 'card', 'dark', 'back', 'meet']);
  assert.equal(stepDone('card', before, view({ armed: 'song', rev: 6, by: 'band' })), true);
  assert.equal(stepDone('card', before, view({ armed: 'song', rev: 6, by: 'phone' })), false, 'the phone never ticks one');
  assert.equal(stepDone('card', before, view({ armed: 'hi', rev: 6, by: 'band' })), false, 'the same card is no change');
  assert.equal(stepDone('card', before, view({ armed: null, invisible: true, rev: 6, by: 'band' })), false, 'dark is not a card');
  assert.equal(stepDone('dark', before, view({ invisible: true, rev: 6, by: 'band' })), true);
  assert.equal(stepDone('dark', before, view({ invisible: true, rev: 6, by: 'phone' })), false);
  const dark = { armed: null, invisible: true, rev: 6 };
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
  for (const r of GUIDE_SOUNDS) assert.ok(r.says && r.says === r.says.trim(), r.sound);
});

test('every card has its colour row', () => {
  for (const c of CARDS) assert.ok(GUIDE.lights.cards[c.id], c.id);
  assert.deepEqual(Object.keys(GUIDE.lights.cards).sort(), CARDS.map((c) => c.id).sort());
});

/** Every word the band can put on its face, read from both twins' source. */
function faceWords() {
  const wrist = readFileSync(new URL('../app/lib/wrist.js', import.meta.url), 'utf8');
  const band = readFileSync(new URL('../relay/band.js', import.meta.url), 'utf8');
  const fw = readFileSync(new URL('../firmware/src/band_logic.h', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../firmware/src/main.cpp', import.meta.url), 'utf8');
  const words = new Set();
  const add = (w) => { if (/[A-Z]{2}/.test(w)) words.add(w.trim()); };
  for (const [, a, b] of wrist.matchAll(/words\('([^']*)', '([^']*)'/g)) { add(a); add(b); }
  for (const [, w] of wrist.matchAll(/(?:big|small) = '([^']+)'/g)) add(w);
  for (const [, w] of wrist.matchAll(/(?:big|small): '([^']+)'/g)) add(w);
  for (const [, w] of band.matchAll(/small: [^']*'([A-Z][A-Z :]+)'/g)) add(w);
  for (const [, w] of fw.matchAll(/return \{"([A-Z][^"]*)", "([^"]*)"\}/g)) add(w);
  for (const [, w] of main.matchAll(/s\.(?:big|small) = "([A-Z][^"]*)"/g)) add(w);
  return [...words];
}

test('every word the band can show has its row in the button table', () => {
  const table = GUIDE.screens.map((r) => r.face.join(' / ')).join('\n');
  const missing = faceWords().filter((w) => !table.includes(w.replace(/ $/, '')));
  assert.deepEqual(missing, [], 'add a row to GUIDE.screens for each');
});

test('the words in docs/wristband-guide.md name every screen the page does', () => {
  const doc = readFileSync(new URL('../docs/wristband-guide.md', import.meta.url), 'utf8');
  for (const r of GUIDE.screens) for (const w of r.face) assert.ok(doc.includes(w), w);
});
```

- [ ] **Step 2: Run to see it fail.** `node --test tests/guide.test.js 2>&1 | grep -E "^✖|ℹ (pass|fail)"`. Expected: cannot find `app/lib/guide.js`.

- [ ] **Step 3: Implement `app/lib/guide.js`**

```js
// ON THE BEAT — the wristband guide's logic: whether a practice step is done, and the page's sound rows. Pure.

import { GUIDE } from '../copy.js';
import { SOUNDS } from './wrist.js';

export const PRACTICE_STEPS = ['wake', 'card', 'dark', 'back', 'meet'];

/** What a step is measured from: the person's card, NOT NOW and rev when it began. */
export const snapshot = (view) => ({ armed: view?.me?.armed ?? null, invisible: !!view?.me?.invisible, rev: view?.me?.rev ?? 0 });

/** Is the person's wristband on the relay now, and not turned off? */
export const bandLive = (view) => !!(view?.me?.wristband?.live && !view.me.wristband.off);

/**
 * Has the wrist done this step since `before`? Only a change the band made counts (`by === 'band'`), and only in the
 * step's own direction. A wake is never heard by the relay, and the meeting is drawn: both are the person's to say.
 */
export function stepDone(step, before, view) {
  const me = view?.me;
  if (!me || me.by !== 'band' || !(me.rev > before.rev)) return false;
  if (step === 'card') return !me.invisible && (me.armed ?? null) !== before.armed;
  if (step === 'dark') return !!me.invisible && !before.invisible;
  if (step === 'back') return !me.invisible && !!before.invisible;
  return false;
}

/** One row per sound the band makes, in its own order, with what it means. */
export const GUIDE_SOUNDS = Object.keys(SOUNDS).map((sound) => ({ sound, says: GUIDE.sounds[sound] }));
```

- [ ] **Step 4: Add `GUIDE` to `app/copy.js`** (end of file). Rows are data the screens draw; `face` holds the band's own words, exactly as it shows them.

```js
/** The wristband guide (docs/superpowers/specs/2026-10-13-wristband-guide-design.md): every word on both screens. */
export const GUIDE = {
  parts: [['start', 'START'], ['pair', 'PAIR'], ['buttons', 'BUTTONS'], ['lights', 'LIGHTS & SOUNDS'], ['meeting', 'MEETING'], ['trouble', 'TROUBLE']],
  practice: {
    title: 'Try your wristband',
    sub: 'a minute with the real buttons. nobody can see you while you practise.',
    later: 'later', skip: 'skip this one', gotIt: 'GOT IT', done: 'DONE', away: "we'll check this once your wristband is back.",
    steps: {
      wake: { title: 'Wake it', do: 'press FACE.', back: 'it lights for six seconds.', yes: 'IT LIT UP', no: 'NOT YET', notYet: 'check it is on: press POWER. TEST THE LIGHT finds it.' },
      card: { title: 'Change your card', do: 'press SIDE: it shows your card. press again for the next. then stop.', back: 'three seconds later it sends, and says SET.' },
      dark: { title: 'Go invisible', do: 'hold FACE for a second and a half.', back: 'it goes dark, with a low sound. you are NOT NOW.' },
      back: { title: 'Come back', do: 'hold SIDE.', back: 'it comes back on the card you had.' },
      meet: { title: 'Meeting someone', do: 'nothing to press yet.', back: 'when you both say yes, both wristbands show the same number and blink. any key answers the blink. find each other, then hold SIDE. it counts when you both have.' },
    },
    end: { title: "That's it", sub: 'how to use it is under your wristband, any time.' },
  },
  page: { title: 'Your wristband', sub: 'step by step, from turning it on.', again: 'PRACTISE AGAIN', open: 'HOW TO USE IT', how: 'Your wristband, step by step', newTo: 'new to the wristband?' },
  start: [
    ['Turn it on', 'press POWER once. it lights and looks for Wi-Fi. charge it on any USB-C cable; it runs on the cable too.'],
    ['What it needs', 'a Wi-Fi it can reach on its own: 2.4 GHz, with a password or open, and no sign-in page. a phone hotspot works (set it to 2.4 GHz if the phone asks: Wi-Fi hotspot → AP band). a school, hotel or café sign-in Wi-Fi does not.'],
    ['If it says NO WI-FI', 'it knows no network that is near. hold SIDE until it changes. it becomes a Wi-Fi of its own and shows a code, its name (OTB- and four letters) and its password in two halves of five.'],
    ['Join it from a phone', 'scan the code with the camera, or pick OTB-… in Wi-Fi settings and type the password from its face. its page opens by itself; if not, open 192.168.4.1. use a different phone from the hotspot, or turn the hotspot off first: most phones cannot be a hotspot and join another Wi-Fi at once.'],
    ['Pick the network', 'or type its name if it is not in the list (a hotspot that is off is not there), type its password, and press SAVE AND RESTART. it says SAVED and starts again. your phone goes back to its own Wi-Fi.'],
    ['Turn the hotspot back on', 'within about fifteen seconds it is on it and shows four letters: ready to pair.'],
    ['It remembers', 'it keeps the last three networks set on it, and the one it was built with, and joins the newest one it can hear. lent to a friend and set up on their hotspot, it still finds yours when it comes back. a fourth forgets the oldest.'],
    ['Leaving setup', 'press either button: nothing changes. ten minutes with nobody on its page leaves it too.'],
  ],
  pair: [
    ['Four letters', 'a wristband nobody has claimed shows four letters under a code. never I, L or O.'],
    ['Put them in', 'type them on the pair screen, or SCAN IT INSTEAD, or point the phone camera at its code.'],
    ['Check the number', 'it shows a two-digit number over ON YOUR PHONE?, and the phone asks if your wristband shows it. look at your own wrist, and press YES only if it does. it flashes white once: paired.'],
    ['Not yours?', 'NO, or no answer within a minute, and it shows new letters.'],
    ['A number you did not ask for', 'someone typed your letters. hold FACE for a second and a half on it: it is turned away and new letters come up.'],
  ],
  // One row per screen the band can show: what FACE and SIDE do there, pressed and held. '' is nothing.
  screens: [
    { face: ['NO WI-FI', 'HOLD SIDE: SET UP'], facePress: 'wakes it', faceHold: '', sidePress: '', sideHold: 'Wi-Fi setup' },
    { face: ['OTB-', 'its setup code'], facePress: 'leaves setup, nothing changed', faceHold: 'the same', sidePress: 'the same', sideHold: 'the same' },
    { face: ['SAVED', 'JOINING'], facePress: 'nothing: it starts again by itself', faceHold: '', sidePress: '', sideHold: '' },
    { face: ['four letters', 'PAIR ON YOUR PHONE'], facePress: 'says PAIR ON YOUR PHONE', faceHold: '', sidePress: 'says PAIR ON YOUR PHONE', sideHold: '' },
    { face: ['a number', 'ON YOUR PHONE?'], facePress: 'says PAIR ON YOUR PHONE', faceHold: 'turns the check away', sidePress: 'says PAIR ON YOUR PHONE', sideHold: '' },
    { face: ['READY', 'SIDE TO CHANGE'], facePress: 'wakes it for six seconds', faceHold: 'NOT NOW: dark at once', sidePress: 'shows your card; each press after steps HI, SONG, DANCE, OFF; three seconds after the last it sends', sideHold: 'as a press; while stepping, sends at once' },
    { face: ['your card', 'SIDE: NEXT'], facePress: 'wakes it', faceHold: 'NOT NOW', sidePress: 'the next card', sideHold: 'sends this one now' },
    { face: ['your card', 'SENDING'], facePress: '', faceHold: 'NOT NOW', sidePress: '', sideHold: '' },
    { face: ['SET', 'CHANGED', 'NOT SENT'], facePress: 'wakes it', faceHold: 'NOT NOW', sidePress: 'starts a new choice', sideHold: '' },
    { face: ['NOT NOW', 'SIDE TO CHANGE'], facePress: 'shows NOT NOW and its battery', faceHold: '', sidePress: 'shows the card it comes back on, then steps', sideHold: 'comes back, on the card you had' },
    { face: ['your card', 'HOLD SIDE TO SHOW'], facePress: '', faceHold: '', sidePress: 'the next card', sideHold: 'comes back on this card' },
    { face: ['a number', 'MEET'], facePress: 'stops the blinking, and nothing else', faceHold: 'NOT NOW', sidePress: 'stops the blinking, and nothing else', sideHold: '' },
    { face: ['a number', 'HOLD SIDE: FOUND'], facePress: '', faceHold: 'NOT NOW', sidePress: 'opens the chooser', sideHold: 'we found each other' },
    { face: ['a number', 'FOUND: WAITING'], facePress: '', faceHold: 'NOT NOW', sidePress: '', sideHold: '' },
    { face: ['SOMEONE WAVED', 'HOLD SIDE: WAVE BACK', 'WAITING - HOLD SIDE'], facePress: '', faceHold: 'NOT NOW', sidePress: '', sideHold: 'waves back to the newest' },
    { face: ['WAVE BACK', 'SENDING'], facePress: '', faceHold: 'NOT NOW', sidePress: '', sideHold: '' },
    { face: ['NO SIGNAL', 'NO RELAY'], facePress: 'wakes it', faceHold: '', sidePress: '', sideHold: 'nothing: it is not the Wi-Fi. wait.' },
    { face: ['OPEN YOUR PHONE', 'OR SWITCH ME OFF'], facePress: '', faceHold: '', sidePress: '', sideHold: '' },
    { face: ['OPEN YOUR PHONE', 'TO COME BACK'], facePress: '', faceHold: '', sidePress: '', sideHold: '' },
    { face: ['POWER OFF', 'POWER BUTTON: ON'], facePress: 'it is turning off', faceHold: '', sidePress: '', sideHold: '' },
  ],
  anyScreen: 'on any screen, FACE and SIDE held together for three seconds turns it off. POWER turns it on.',
  columns: ['FACE', 'FACE held', 'SIDE', 'SIDE held'],
  sounds: {
    tick: 'any key going down',
    double: 'a hold that sends: coming back, waving back, found',
    down: 'NOT NOW',
    up: 'SET, a YES, TEST THE LIGHT',
    fall: 'CHANGED, or a check that ended without YES',
    low: 'NOT SENT',
    ask: 'the pairing check: the number to look for',
    jingle: 'a meeting: the number blinks until a key answers',
    warn: 'orange: out of reach, battery at 15% and 5%, waiting after a restart, away, unpaired',
    hello: 'someone waved at you',
    found: 'you both found each other',
    calledit: 'you called the first song',
  },
  lights: {
    cards: { hi: 'your colour while SAY HI is armed', song: 'your colour while FIRST SONG? is armed', dance: "your colour while LET'S DANCE! is armed" },
    rows: [
      ['half bright', 'battery at 15% or less'],
      ['white once', 'paired, or TEST THE LIGHT'],
      ['red three times', 'CHANGED: something moved first'],
      ['orange twice', 'NOT SENT: it could not reach ON THE BEAT'],
    ],
  },
  meeting: [
    'when you both say yes, both wristbands show the same number and blink.',
    'any key answers the blink.',
    'find each other at the spot your phone shows.',
    'hold SIDE once you have. it counts when you both have; until then yours says FOUND: WAITING.',
    'a meeting number lasts fifteen minutes.',
  ],
  trouble: [
    ['NO WI-FI', 'it can hear none of the networks it knows.', 'turn your hotspot on and wait fifteen seconds. new place or new phone: hold SIDE and set it up.'],
    ['NO WI-FI right after you saved', 'the name or password was not right, or the network is 5 GHz.', 'hold SIDE and set it up again. type the name exactly. set the hotspot to 2.4 GHz.'],
    ['your hotspot is not in the setup list', 'it is off, or 5 GHz.', 'type its name instead. set it to 2.4 GHz.'],
    ['the setup page does not open', 'the phone left its Wi-Fi, or no page popped up.', 'join OTB-… again and open 192.168.4.1.'],
    ['the hotspot turned itself off during setup', 'the phone cannot be a hotspot and join another Wi-Fi at once.', 'set it up from another phone, then turn the hotspot on.'],
    ['NO SIGNAL or NO RELAY, orange', 'it is on Wi-Fi but cannot reach ON THE BEAT.', 'nothing: it catches up by itself. check the hotspot has data.'],
    ['OPEN YOUR PHONE / OR SWITCH ME OFF', 'the service restarted and waits for its owner.', 'open the app, or turn it off.'],
    ['OPEN YOUR PHONE / TO COME BACK', 'you are not in a room, or it was away a while.', 'open the app. PAIR AGAIN under your wristband if it asks.'],
    ['four letters on a wristband that was yours', 'it was unpaired, or set up again.', 'pair it again.'],
    ['it does not light', 'asleep, flat or off.', 'press FACE. charge it. press POWER. TEST THE LIGHT under your wristband finds it.'],
    ['half bright', 'battery at 15% or less.', 'charge it.'],
    ['a number you did not ask for', 'someone typed your letters.', 'hold FACE for a second and a half on it.'],
  ],
};
```

- [ ] **Step 5: Run the tests; fill the button table from what the test names.** `node --test tests/guide.test.js 2>&1 | grep -E "^✖|missing|ℹ (pass|fail)"`. If `every word the band can show` names words, open `app/lib/wrist.js` at each word's line, read what FACE and SIDE do on that face, and add a row (or the word into an existing row's `face`). Repeat until it passes. The docs test fails until Task 7; run with `--test-name-pattern` excluding it meanwhile: `node --test --test-name-pattern="^(?!the words in docs)" tests/guide.test.js`.

- [ ] **Step 6: Mutation-check.** Drop one key from `GUIDE.sounds` (sound test red); drop the `me.by !== 'band'` check (step test red); drop a `screens` row (table test red). Restore.

- [ ] **Step 7: Commit** (`app/lib/guide.js app/copy.js tests/guide.test.js`): "Wristband guide: the step checks, and every word the page says".

### Task 4: `follow()` keeps the phone on the practice screen

**Files:**
- Modify: `app/lib/follow.js` (`follow`, ~line 66-92)
- Test: `tests/follow.test.js`

**Interfaces:**
- Consumes: `phone.screen === 'guide'`.
- Produces: on `guide`, `out.screen === 'guide'`, `out.toast === null`, `out.card === null`, `out.clearStack === false`; `armed`, `invisible`, `seq`, `events` followed as usual.

- [ ] **Step 1: Write the failing test** (end of `tests/follow.test.js`)

```js
test('practice: on the guide the phone follows the state but stays put, and says nothing over it', () => {
  const phone = { armed: 'hi', invisible: false, seq: 10, asked: 10, screen: 'guide' };
  const lit = follow(phone, { me: { armed: 'song', invisible: false, seq: 11, by: 'band' } });
  assert.equal(lit.armed, 'song');
  assert.equal(lit.screen, 'guide', 'a card lit from the wrist does not send it home');
  assert.equal(lit.card, null);
  assert.equal(lit.toast, null);
  assert.equal(lit.clearStack, false);
  const dark = follow(phone, { me: { armed: null, invisible: true, seq: 11, by: 'band' } });
  assert.equal(dark.screen, 'guide', 'nor does going dark send it to the quiet screen');
  assert.equal(dark.invisible, true);
  const lost = follow(phone, { me: { armed: null, invisible: false, seq: 11, by: 'phone' } });
  assert.equal(lost.toast, null, 'its own taps are not toasted there either');
});
```

- [ ] **Step 2: Run to see it fail.** `node --test tests/follow.test.js 2>&1 | grep -E "^✖|ℹ (pass|fail)"`.
- [ ] **Step 3: Implement.** In `follow()`, just before `return out;` at the end:

```js
  // Practising (the wristband guide): the state is followed, but the phone stays on the guide, which says each step
  // itself; nothing is toasted over it.
  if (phone.screen === 'guide') Object.assign(out, { screen: 'guide', card: null, toast: null, clearStack: false });
```

- [ ] **Step 4: Run to see it pass**; then `node --test tests/follow.test.js` whole file green.
- [ ] **Step 5: Commit** (`app/lib/follow.js tests/follow.test.js`): "follow(): the practice screen keeps its place".

### Task 5: The two screens and their wiring

**Files:**
- Create: `app/screens/Guide.jsx` (`BandDrawing`, `Practice`, `BandGuide`)
- Modify: `app/lib/store.js` (~line 23: `guideSeen`), `app/App.jsx` (routes ~846; `'paired'` ~312; `howSheet` ~610; `bandSheet` ~636; pair screen ~858), `app/styles.css` (guide classes)

**Interfaces:**
- Consumes: `GUIDE`, `GUIDE_SOUNDS`, `PRACTICE_STEPS`, `stepDone`, `snapshot`, `bandLive` (Task 3); `follow()` on `guide` (Task 4); `{t:'practice'}` (Task 2); `createSpeaker()` from `app/lib/speaker.js`; `HUE` from `app/copy.js`; `Back`, `Cta`, `Ghost`, `Icon` from `app/ui.jsx`.
- Produces: screens `'guide'` and `'band-guide'`; `store` field `guideSeen: boolean`.

- [ ] **Step 1: `store.js`.** Beside `bandSound`:

```js
    guideSeen: s.guideSeen === true,   // the wristband guide's practice, once run or put off: kept for good
```

- [ ] **Step 2: `app/screens/Guide.jsx`**

```jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { GUIDE, HUE } from '../copy.js';
import { GUIDE_SOUNDS, PRACTICE_STEPS, bandLive, snapshot, stepDone } from '../lib/guide.js';
import { createSpeaker } from '../lib/speaker.js';
import { Back, Cta, Ghost, Icon } from '../ui.jsx';

/** A StickC Plus held landscape: the screen, FACE under it, SIDE on its edge, POWER opposite. `lit` names a button. */
export function BandDrawing({ lit = null, hue = 'hi', face = '' }) {
  const glow = HUE[hue]?.c || '#fff';
  const on = (k) => (lit === k ? glow : 'rgba(255,255,255,.28)');
  return (
    <svg viewBox="0 0 240 120" className="guide-band" role="img" aria-label={'wristband' + (lit ? ', ' + lit + ' button' : '')}>
      <rect x="20" y="16" width="200" height="88" rx="18" fill="#1b1b1f" stroke="rgba(255,255,255,.18)" />
      <rect x="40" y="30" width="118" height="60" rx="6" fill="#000" />
      <text x="99" y="65" textAnchor="middle" fontSize="14" fill="#fff" fontFamily="inherit">{face}</text>
      <rect x="172" y="44" width="34" height="32" rx="8" fill={on('FACE')} />
      <text x="189" y="96" textAnchor="middle" fontSize="9" fill="rgba(255,255,255,.7)">FACE</text>
      <rect x="70" y="8" width="70" height="7" rx="3" fill={on('SIDE')} />
      <text x="105" y="5" textAnchor="middle" fontSize="8" fill="rgba(255,255,255,.7)">SIDE</text>
      <rect x="96" y="105" width="22" height="6" rx="3" fill={on('POWER')} />
      <text x="107" y="119" textAnchor="middle" fontSize="8" fill="rgba(255,255,255,.7)">POWER</text>
    </svg>
  );
}

const BUTTON_OF = { wake: 'FACE', card: 'SIDE', dark: 'FACE', back: 'SIDE', meet: null };
const FACE_OF = { wake: 'READY', card: 'SIDE: NEXT', dark: 'NOT NOW', back: 'HOLD SIDE', meet: '27' };

/**
 * The practice: five steps with the real buttons. Steps 2–4 tick from the relay's view, only from the wrist. Every way
 * out goes through onEnd, which puts the card and NOT NOW back and ends the practice (App.jsx endPractice).
 */
export function Practice({ view, onEnd, onTest }) {
  const [i, setI] = useState(0);
  const [notYet, setNotYet] = useState(false);
  const step = PRACTICE_STEPS[i];
  const start = useRef(snapshot(view));
  useEffect(() => { start.current = snapshot(view); setNotYet(false); }, [i]);   // each step measured from its own start
  const live = bandLive(view);
  const done = step && stepDone(step, start.current, view);
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => setI((n) => n + 1), 900);
    return () => clearTimeout(t);
  }, [done]);
  const next = () => setI((n) => n + 1);
  const words = GUIDE.practice;
  if (!step) {
    return (
      <div className="scr guide">
        <Icon name="check_circle" size={40} />
        <h1>{words.end.title}</h1>
        <p className="small">{words.end.sub}</p>
        <Cta hue="hi" onClick={() => onEnd('done')}>{words.done}</Cta>
      </div>
    );
  }
  const s = words.steps[step];
  const checked = step === 'card' || step === 'dark' || step === 'back';
  return (
    <div className="scr guide">
      <Back onClick={() => onEnd('back')} />
      <p className="small">{words.sub}</p>
      <h1>{(i + 1) + '. ' + s.title}</h1>
      <BandDrawing lit={BUTTON_OF[step]} hue={view?.me?.armed || 'hi'} face={FACE_OF[step]} />
      <p>{s.do}</p>
      <p className="small">{s.back}</p>
      {done && <p className="guide-tick"><Icon name="check_circle" /> {s.title}</p>}
      {step === 'wake' && (
        <>
          <Cta hue="hi" onClick={next}>{s.yes}</Cta>
          <Ghost onClick={() => setNotYet(true)}>{s.no}</Ghost>
          {notYet && <p className="small">{s.notYet} <button className="link" onClick={onTest}>TEST THE LIGHT</button></p>}
        </>
      )}
      {checked && !live && <><p className="small">{words.away}</p><Cta hue="hi" onClick={next}>{words.gotIt}</Cta></>}
      {step === 'meet' && <Cta hue="hi" onClick={next}>{words.gotIt}</Cta>}
      <div className="guide-foot">
        {step !== 'meet' && <button className="link" onClick={next}>{words.skip}</button>}
        <button className="link" onClick={() => onEnd('later')}>{words.later}</button>
      </div>
    </div>
  );
}

/** The page to look things up: six parts, a chip to jump to each, and PRACTISE AGAIN when paired. */
export function BandGuide({ onBack, onPractise }) {
  const speaker = useMemo(() => createSpeaker(), []);
  const play = (name) => { speaker.unlock(); setTimeout(() => speaker.play(name), 30); };
  const jump = (id) => document.getElementById('guide-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const Pill = ({ children }) => <span className="band-words">{children}</span>;
  const cell = (s) => s || '—';
  return (
    <div className="scr guide guide-page">
      <Back onClick={onBack} />
      <h1>{GUIDE.page.title}</h1>
      <p className="small">{GUIDE.page.sub}</p>
      <nav className="guide-chips">{GUIDE.parts.map(([id, label]) => <button key={id} onClick={() => jump(id)}>{label}</button>)}</nav>
      <BandDrawing />
      <section id="guide-start"><h2>START</h2><ol>{GUIDE.start.map(([t, d]) => <li key={t}><b>{t}.</b> {d}</li>)}</ol></section>
      <section id="guide-pair"><h2>PAIR</h2><ol>{GUIDE.pair.map(([t, d]) => <li key={t}><b>{t}.</b> {d}</li>)}</ol></section>
      <section id="guide-buttons">
        <h2>BUTTONS</h2>
        <div className="guide-table-wrap">
          <table className="guide-table">
            <thead><tr><th>the wristband shows</th>{GUIDE.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{GUIDE.screens.map((r) => (
              <tr key={r.face.join('|')}>
                <td>{r.face.map((w) => <Pill key={w}>{w}</Pill>)}</td>
                <td>{cell(r.facePress)}</td><td>{cell(r.faceHold)}</td><td>{cell(r.sidePress)}</td><td>{cell(r.sideHold)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="small">{GUIDE.anyScreen}</p>
      </section>
      <section id="guide-lights">
        <h2>LIGHTS &amp; SOUNDS</h2>
        <ul className="guide-rows">
          {Object.entries(GUIDE.lights.cards).map(([id, says]) => (
            <li key={id}><span className="swatch" style={{ background: HUE[id].c }} />{says}</li>
          ))}
          {GUIDE.lights.rows.map(([what, says]) => <li key={what}><b>{what}</b> — {says}</li>)}
          {GUIDE_SOUNDS.map((r) => (
            <li key={r.sound}>
              <button className="guide-play" aria-label={'play ' + r.sound} onClick={() => play(r.sound)}><Icon name="volume_up" /></button>
              {r.says}
            </li>
          ))}
        </ul>
      </section>
      <section id="guide-meeting"><h2>MEETING</h2><ul>{GUIDE.meeting.map((l) => <li key={l}>{l}</li>)}</ul></section>
      <section id="guide-trouble">
        <h2>TROUBLE</h2>
        {GUIDE.trouble.map(([see, why, todo]) => (
          <details key={see}><summary>{see}</summary><p className="small">{why}</p><p>{todo}</p></details>
        ))}
      </section>
      {onPractise && <Cta hue="hi" onClick={onPractise}>{GUIDE.page.again}</Cta>}
    </div>
  );
}
```

- [ ] **Step 3: Styles.** Append to `app/styles.css`:

```css
/* The wristband guide */
.guide { padding: 0 20px 40px; gap: 12px; overflow-y: auto; }
.guide h2 { margin: 24px 0 8px; letter-spacing: .08em; font-size: 14px; }
.guide-band { width: 100%; max-width: 320px; margin: 8px auto; display: block; }
.guide-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.guide-chips button { border: 1px solid var(--line-2); border-radius: 999px; padding: 6px 10px; background: none; color: inherit; font-size: 12px; }
.guide-table-wrap { overflow-x: auto; max-width: 100%; }
.guide-table { border-collapse: collapse; font-size: 12px; min-width: 560px; }
.guide-table th, .guide-table td { border-top: 1px solid var(--line-2); padding: 6px; text-align: left; vertical-align: top; }
.band-words { display: inline-block; background: #000; color: #fff; border-radius: 6px; padding: 1px 6px; margin: 1px 2px; font-size: 11px; letter-spacing: .04em; }
.guide-rows { list-style: none; padding: 0; display: grid; gap: 8px; }
.guide-rows li { display: flex; align-items: center; gap: 8px; }
.swatch { width: 18px; height: 18px; border-radius: 50%; flex: none; }
.guide-play { background: none; border: 1px solid var(--line-2); border-radius: 50%; width: 32px; height: 32px; color: inherit; flex: none; }
.guide-tick { color: var(--go, #6f6); }
.guide-foot { display: flex; justify-content: space-between; margin-top: 16px; }
.guide details { border-top: 1px solid var(--line-2); padding: 8px 0; }
.link { background: none; border: none; color: inherit; text-decoration: underline; padding: 0; }
```

(If `.link` already exists in `styles.css`, keep the existing one and drop this line.)

- [ ] **Step 4: Wire `App.jsx`**

Import: `import { BandGuide, Practice } from './screens/Guide.jsx';`

Ending the practice, beside `backOn`, one path for every exit:

```js
  // The wristband guide's practice (spec §1): what it opened on, put back on every way out, then practice ended.
  const practiceFrom = useRef(null);
  const startPractice = () => {
    practiceFrom.current = { armed: view.me?.armed ?? null, invisible: !!view.me?.invisible };
    net.current?.say('practice', { t: 'practice', on: true });
    setStack([]);
    setScreen('guide');
  };
  const endPractice = () => {
    const was = practiceFrom.current;
    practiceFrom.current = null;
    if (was && view.me) {
      if (!!view.me.invisible !== was.invisible) {
        const seq = tap('invisible', was.invisible);
        setNightState({ invisible: was.invisible, seq });
      }
      if (!was.invisible && (view.me.armed ?? null) !== was.armed) arm(was.armed);
    }
    net.current?.forget('practice');
    net.current?.send({ t: 'practice', on: false });
    update((prev) => ({ ...prev, guideSeen: true }));
    setStack([]);
    setScreen(was?.invisible ? 'quiet' : 'home');
  };
  // While on the guide, practice is said again each minute, so it never lapses mid-step.
  useEffect(() => {
    if (screen !== 'guide') return undefined;
    const iv = setInterval(() => net.current?.send({ t: 'practice', on: true }), 60_000);
    return () => clearInterval(iv);
  }, [screen]);
```

In `if (m.t === 'paired')`, replace `if (screen === 'pair') { setStack([]); setScreen('home'); }` with:

```js
      if (!s.guideSeen) startPractice();
      else if (screen === 'pair') { setStack([]); setScreen('home'); }
```

Routes, beside `case 'quiet':`:

```js
    case 'guide': body = <Practice view={view} onEnd={endPractice} onTest={() => net.current?.send({ t: 'testLight' })} />; break;
    case 'band-guide': body = <BandGuide onBack={back} onPractise={bandId ? startPractice : null} />; break;
```

`bandSheet` rows, first row:

```js
      { icon: 'watch', label: GUIDE.page.open, sub: GUIDE.page.sub, fg: '#fff', onTap: () => { setSheet(null); go('band-guide'); } },
```

`howSheet` rows, after the `BAND_OFF.how` row:

```js
      { icon: 'touch_app', label: GUIDE.page.how, fg: '#fff', onTap: () => { setSheet(null); go('band-guide'); } },
```

Import `GUIDE` from `./copy.js`. On the pair screen (`case 'pair'`), pass `onGuide={() => go('band-guide')}` and in `Band.jsx`'s pair component render, under its input, `<button className="link" onClick={onGuide}>{GUIDE.page.newTo}</button>` (import `GUIDE`). If the pair component lives elsewhere, find it with `grep -n "export function Pair" app/screens/*.jsx`.

A system back gesture: `back()` from `guide` must go through `endPractice`. In `back`, first line: `if (screen === 'guide') { endPractice(); return; }`.

- [ ] **Step 5: Build.** `npm run build 2>&1 | tail -3`. Expected: built, no errors.
- [ ] **Step 6: Run the whole suite.** `npm test > /tmp/full.log 2>&1; grep -E "^ℹ (tests|pass|fail)" /tmp/full.log`. Expected: `fail 0` (the docs test of Task 3 is still red until Task 7; if so, do Task 7 before committing this one, and commit both together).
- [ ] **Step 7: Commit** (`app/screens/Guide.jsx app/App.jsx app/lib/store.js app/styles.css app/screens/Band.jsx`): "Wristband guide: the practice after a first pairing, and the page to look things up".

### Task 6: Proven in a browser

**Files:** none in the repository. Evidence in `Documents/on-the-beat-proposals/guide-2026-10-13/` (outside every repository).

- [ ] **Step 1:** `npm start` in the background (Bash `run_in_background`), then a headless Edge rig as in `on-the-beat-proposals/e2e-2026-10-13/tools/` (hub.mjs, t.mjs), two phones (Rae, Ben) and one `/band` stand-in, at 375×812.
- [ ] **Step 2:** Rae onboards and pairs the stand-in for the first time → lands on `guide` (screenshot). Ben arms SAY HI.
- [ ] **Step 3:** Step 1 IT LIT UP. Step 2: a card change from Rae's phone carousel does **not** tick (screenshot); SIDE presses on the stand-in do (screenshot). During it Ben's WHO'S NEAR is empty while Rae's stand-in is blue (screenshot of both).
- [ ] **Step 4:** Steps 3-4 from the stand-in (FACE hold, SIDE hold); step 4 comes back on the card Rae had (N3). Step 5 GOT IT. DONE: Rae home on the card she opened on; Ben sees Rae again (screenshot).
- [ ] **Step 5:** Stand-in closed mid-step 2: GOT IT offered (screenshot). *later* puts the card back.
- [ ] **Step 6:** Reference page from the wristband sheet: each chip jumps; the button table scrolls in its own box at 375 px with no page-wide sideways scroll (`document.documentElement.scrollWidth <= innerWidth`); each ▶ plays (`speaker.play` returns true after a tap; check with a `javascript_tool` probe on the AudioContext state); each trouble row opens.
- [ ] **Step 7:** Stop the relay by port; note the screenshots in a short `findings.md` there.

### Task 7: The guide in `docs/`

**Files:**
- Create: `docs/wristband-guide.md`
- Modify: `README.md` (one link line where the docs are listed)

- [ ] **Step 1:** Write `docs/wristband-guide.md` from `GUIDE`: the six parts in order, the button table as a Markdown table with each `face` word in backticks, the sounds table, the trouble table. Every word in every `GUIDE.screens[].face` must appear verbatim.
- [ ] **Step 2:** `node --test tests/guide.test.js 2>&1 | grep -E "^✖|ℹ (pass|fail)"` → `fail 0`.
- [ ] **Step 3:** README: in its list of docs, `- [The wristband, step by step](docs/wristband-guide.md) — turning it on, Wi-Fi, pairing, every button, trouble.`
- [ ] **Step 4:** Full suite green; commit (`docs/wristband-guide.md README.md`) "Docs: the wristband, step by step, for anyone setting bands up"; push `main`.

### Task 8: On a real band, with him (owed, not done in this session without him)

- [ ] §3.1 followed word for word by someone new to it, from POWER to four letters.
- [ ] Every row of the button table pressed once on the band it describes; where band and page disagree, the page is changed.
- [ ] The practice run on the Plus: steps 2-4 tick from its real buttons.
