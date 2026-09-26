# Found Each Other — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two people who have found each other after `MEET` can say so from the wrist (a side hold on the meeting face) or from the phone (`WE FOUND EACH OTHER` on S11). It counts only once both have said it: then both numbers are put away together, both bands play a short *found* chirp and flash the meeting's card, both phones say *you found each other at 21:14*, and Tonight counts the meeting as met. One side's found is never shown to the other.

**Architecture:** The room records, beside `keep`, when each of a match's two said found, and each view carries its own `found` and, only once both have, `foundAt` (`relay/room.js`). What a band is shown (`relay/band.js`) keeps the meeting face up with `FOUND: WAITING` while its person alone has said it, drops it at once when both have, and for `FOUND_SHOW_MS` names the found meeting on every show about its person, so the band plays it once. The relay takes `{ t: 'found', number }` from a band's authenticated socket, as it takes a wave back, and `{ t: 'found', match }` from a phone, as it takes `keep` (`relay/server.js`). The wrist machine, written twice (`app/lib/wrist.js` for `/band`, the `Wrist` class in `firmware/src/band_logic.h` for the band) and held to one table (`tests/fixtures/wrist-cases.json`), sends it on a side hold and plays the reaction. The phone gains S11's button, words and number, Tonight's line and count, and a buzz only without a live band.

**Tech Stack:** Node 22+ (`node --test`, `ws`), React 19 + Vite 8, C++17 on the laptop (MinGW-W64 g++ here, GCC in CI), C++11 on the band (Arduino-ESP32 2.x through PlatformIO `espressif32@^6.9.0`), M5Unified 0.2.22 or later.

**Spec:** `docs/superpowers/specs/2026-09-26-wrist-found-design.md` (decided with the owner section by section on 26 Sep 2026: §1 what people see and do, §2 the relay, §3 who does what, §4 tests and proof). It builds on `docs/superpowers/specs/2026-09-25-wrist-waves-design.md` and `docs/superpowers/specs/2026-09-25-wrist-reactions-design.md`, whose plans are done: this plan uses their meeting number and call, the side hold, `NOT SENT`, the reaction queue, the sound switch and NOT NOW's silence. Read the found spec before any task.

This plan was written from a finished build: every task below was built in a scratch worktree (branch `found-build`), test first, and committed on its own with `npm test` green at every commit. The code blocks are those commits' diffs, so applying a task's blocks in order reproduces it. Each Step 2 was measured by running the task's tests on its parent's code, and each mutation list was measured at its task's commit.

## Global Constraints

- Artefacts are English: code, comments, commit messages, README, test names. Talk to the owner in Chinese.
- **It counts only if you both do** (spec, as for `Keep after tonight`). Saying it alone changes nothing the other person can see — not their view, not their band, not their phone — and never puts away a number they may still be looking for.
- **The words:** on the band `HOLD SIDE: FOUND` (woken meeting face), `FOUND: WAITING` (said on this side), `SENDING`, `NOT SENT`; on S11 `WE FOUND EACH OTHER`, `found on your side. they won't know unless they say so too.`, `you found each other at HH:MM`; Tonight `met <name>`. Offline: *Saved. It'll sync when you're out.*
- **The reaction:** sound `found` = 1568/70, 2093/70, 2637/70, rest 40, 2637/70, 3136/220 (540 ms; the longest sound stays 600 ms, so `SOUND_SAMPLES` does not change) · flash `found` = the meeting's card (`colour: 'card'`), 3 × 200 / 150. Once per found number; under NOT NOW, nothing.
- **Constants:** `FOUND_SHOW_MS = 60_000` (`relay/band.js`: how long after both said it a band still plays it), `FOUND_GAP_MS = 1000` (`relay/server.js`: the least time between two founds from one band, a stamp of its own). No new wrist constant: a found waits `CONFIRM_MS`, a result stays `RESULT_MS`.
- **A meeting number is two digits**, `/^[1-9][0-9]$/`. The relay drops a band's found for anything else whole and unanswered; the wrist says found only on a meeting face whose number is two digits, so the band's hand-built frame can never carry anything but.
- **Not in this plan** (spec): bumping two bands together (the motion sensor), declining from the wrist, taking a found back, anything about keeping.
- **The band's compiler takes C++11** and sees `Arduino.h`'s macros first; `firmware/host/as_band.cpp` holds `band_logic.h` to that on every run. A variable left unused is an error there (`-Werror`): a mutation that stops using one must still use it.
- The shared table decides behaviour: a rule is done when its cases pass on both twins. `tests/firmware.test.js` holds `SOUNDS` and `FLASHES` equal on both, so `found` joins both tables together.
- Repository `LewisSwan24/on-the-beat` (private). Commit after each task; push to `main` when a stage's `npm test` is green. Never the team repository `cimi2232/DECO3500`: `tools/hooks/pre-push` refuses it (after a fresh clone, `cp tools/hooks/pre-push .git/hooks/pre-push`).
- `CLAUDE.md` is not in git and is not edited by this plan. Nothing from `../on-the-beat-research/` or `../on-the-beat-design/` enters the repository.
- `npm test` builds first (the relay serves `dist/`). Running one test file alone: `npm run build` first, and again after restoring a mutation.
- Windows host: the Bash tool is Git Bash; `python` there is the Store alias and hangs, so scripts are Node. Never write JavaScript holding backticks or `${}` through a Bash heredoc: write it with the editor. A command that holds `git commit` and another program's `-n` (such as `grep -n`) is refused by a hook as `--no-verify`: run them separately.
- Flashing a band needs the owner's yes first, every time. The StickS3 is on `COM8`, the StickC Plus on `COM9`. Playing sound on a band needs him free to hear it.
- Never more than ten background tasks at once. Work directly; this plan needs no fan-out.
- Commit messages end with the attribution trailer the session's system reminder gives (today: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## Three procedures used throughout

**P1 — Mutation check.** Every task that adds a guard lists mutations as JSON: break one guard, run one test file, and exactly the listed tests go red (a listed name is a prefix of the test's). The lists were measured at each task's own commit; run later, a list may find more red as later tests join, and a mutation whose line a later task rewrote no longer applies.

Save this runner outside the repository (for example in your scratch directory as `mutate.mjs`) and run it from the repository root: `node <scratch>/mutate.mjs <scratch>/task-N.json`. It applies each edit (the `from` text must occur exactly once), runs the test file, restores the file byte for byte, runs the file again, and prints `ALL MUTATIONS HELD` only if every red set was exactly the listed one and every restore came back green. A C++ mutation runs `tests/firmware.test.js`, which compiles the host tests, about 35 s a run: seven of them take eight minutes, so run them in the background.

````js
// Mutation check (plan procedure P1): break one guard, run one test file,
// report which tests went red, restore byte for byte, and confirm green again.
// Usage: node mutate.mjs <mutations.json>
//   [{ "file": "relay/server.js", "from": "...", "to": "...", "test": "tests/x.test.js", "expect": ["name", ...] }]
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const list = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const run = (file) => {
  const r = spawnSync(process.execPath, ['--test', file], { encoding: 'utf8', timeout: 300_000 });
  const out = r.stdout + r.stderr;
  const red = [...new Set(out.split(/\r?\n/).filter((l) => l.startsWith('✖ ') && !l.startsWith('✖ failing tests'))
    .map((l) => l.slice(2).replace(/ \(\d+(\.\d+)?m?s\)$/, '')))];
  const fail = (out.match(/^ℹ fail (\d+)/m) || [])[1];
  return { red, fail: Number(fail) };
};

let allOk = true;
for (const m of list) {
  const original = readFileSync(m.file, 'utf8');
  const hits = original.split(m.from).length - 1;
  if (hits !== 1) { console.log(`SKIP ${m.from.slice(0, 60)}: found ${hits} times`); allOk = false; continue; }
  writeFileSync(m.file, original.replace(m.from, m.to));
  let broken;
  try { broken = run(m.test); } finally { writeFileSync(m.file, original); }
  const restored = readFileSync(m.file, 'utf8') === original;
  const again = run(m.test);
  const exact = broken.red.length === m.expect.length && m.expect.every((e) => broken.red.some((r) => r.startsWith(e)));
  const ok = exact && restored && again.fail === 0;
  allOk &&= ok;
  console.log(`${ok ? 'OK  ' : 'FAIL'} mutation: ${m.label}`);
  console.log(`     red (fail ${broken.fail}): ${broken.red.join(' | ') || '(none)'}`);
  console.log(`     restored byte for byte: ${restored}; after restore: fail ${again.fail}`);
}
console.log(allOk ? 'ALL MUTATIONS HELD' : 'SOME MUTATION DID NOT HOLD');
````

If the wrong test goes red, or none does, stop: the test does not hold the guard. Fix the test, not the guard. Put `Mutation-checked: <n> mutations, all held` in the task's commit body.

**P2 — Close a stage.** `npm test` (expect `ℹ fail 0`, `ℹ skipped 0`), then `git push origin main`. A push that cannot reach github.com:443 while `gh` works is the network: check with `curl -sI https://github.com`, retry, leave git config alone.

**P3 — Build the band.** Windows' path limit breaks PlatformIO in a deep directory, so build with short output directories:

```bash
T=/c/Users/LEWISD~1/AppData/Local/Temp/otbpio
mkdir -p $T && [ -d $T/libdeps ] || cp -r firmware/.pio/libdeps $T/libdeps
PLATFORMIO_BUILD_DIR=$T/build PLATFORMIO_LIBDEPS_DIR=$T/libdeps \
  /c/Users/LewisDong/.platformio/penv/Scripts/pio.exe run -d firmware -e m5stickc -e m5sticks3 2>&1 \
  | grep -E "error|src/.*warning|RAM:|Flash:|SUCCESS|FAILED"
```

Expected: two `[SUCCESS]` lines and no `src/` warning.

## Files

Created:

| File | Responsibility |
|---|---|
| `app/lib/found.js` | Found each other, on the phone: whether the meeting is on, which founds are new, Tonight's line and count, and S11's words |
| `tests/found.test.js` | The number while the meeting is on, the buzz, Tonight, the record, the words |

Modified: `relay/room.js`, `relay/band.js`, `relay/server.js`, `app/lib/wrist.js`, `firmware/src/band_logic.h`, `firmware/host/logic_test.cpp`, `app/App.jsx`, `app/screens/Met.jsx`, `tests/room.test.js`, `tests/band.test.js`, `tests/wristband.test.js`, `tests/relay-harness.js`, `tests/fixtures/wrist-cases.json`, `README.md`, `docs/superpowers/specs/2026-09-25-wrist-waves-design.md`.

Not modified, on purpose: `firmware/src/main.cpp`, `app/screens/Band.jsx`, `app/lib/speaker.js`, `app/lib/net.js` and `app/lib/store.js`. The players draw whatever `face(now)` returns and play the newest of `sounds()` by name, and a flash in a card's colour is drawn as a SET flash already is; a found is about 30 bytes, well inside the band's 256-byte outgoing frame. `net.send()` already queues an action offline, and `store.noteMatch()` already keeps every field of a match the view carries, `found` and `foundAt` included (Task 7 holds that with a test).

## Stages

| Stage | Tasks | Leaves |
|---|---|---|
| A. The relay | 1–3 | the room records found and shows it only once both said it; the band's meeting face waits or goes; a band's and a phone's found taken or refused with a reason |
| B. The wrist | 4–6 | the side hold, the hint and `NOT SENT` in both twins; the found reaction once per number; the band's console says found |
| C. The phone | 7 | S11's button, words and number; Tonight's line and count; a buzz only without a live band |
| D. Proof and docs | 8–10 | the browser proof; README and the waves spec's line; the real bands with the owner |

Every task ends green and is committed on its own; each stage ends with P2.

---

## Stage A — The relay

Run the relay's tests with `npm run build >/dev/null && node --test tests/room.test.js tests/band.test.js tests/wristband.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`.

### Task 1: Rooms keep who found whom, and show it only once both said so

**Files:**
- Modify: `relay/room.js`
- Test: `tests/room.test.js`

**Interfaces:**
- Consumes: `createRoom({ now })`, a match's `a`, `b` and `keep` (made in `matchIfMutual()`), `viewFor()`'s `matches` in `relay/room.js`.
- Produces: a match's `found: { [a]: 0, [b]: 0 }`, the time each said it (0 not yet). `room.found(viewer, matchId)` → `true` when the viewer is one of that match's two (the first time is kept), `false` for a match that is not theirs or is gone (a block). Each `viewFor(id).matches[i]` gains `found` (whether `id` said it) and `foundAt` (the later of the two times, only once both said it; `null` before).

- [ ] **Step 1: Write the failing tests.** Two, beside keep's promise test: ben's whole view is byte for byte the same before and after ana says found, and `foundAt` is the later time once he says it too; only the two of a match can say it, a second found keeps the first time (ana, ben five seconds later, ana again), and a blocked match refuses it.

In `tests/room.test.js`:

````diff
--- a/tests/room.test.js
+++ b/tests/room.test.js
@@ -286,6 +286,44 @@ test('keep: a contact is shared only when both keep, and still arrives after a p
   assert.equal(room.viewFor('ana').matches[0].contact, '', 'taking it back takes the contact back');
 });
 
+// ---------- found each other (docs/superpowers/specs/2026-09-26-wrist-found-design.md §2) ----------
+
+test("found: counted only once both say so, and one side's is never shown to the other", () => {
+  const { room, handleOf, tick } = night();
+  const { id } = meet(room, handleOf, 'ana', 'ben');
+  const bens = JSON.stringify(room.viewFor('ben'));
+  tick(60_000);
+  assert.equal(room.found('ana', id), true);
+  assert.deepEqual([room.viewFor('ana').matches[0].found, room.viewFor('ana').matches[0].foundAt], [true, null], 'said, alone');
+  assert.equal(JSON.stringify(room.viewFor('ben')), bens, "ben's view is exactly as it was");
+  tick(30_000);
+  const t = Date.UTC(2026, 8, 23, 11, 4) + 90_000;
+  assert.equal(room.found('ben', id), true);
+  for (const who of ['ana', 'ben']) {
+    const m = room.viewFor(who).matches[0];
+    assert.deepEqual([m.found, m.foundAt], [true, t], who + ': the later of the two');
+  }
+});
+
+test('found: only the two of a match say it, the first time is kept, and a match that is gone refuses it', () => {
+  const { room, handleOf, tick } = night();
+  const { id } = meet(room, handleOf, 'ana', 'ben');
+  const t0 = Date.UTC(2026, 8, 23, 11, 4);
+  assert.equal(room.found('cai', id), false, 'not his match');
+  assert.equal(room.found('ana', 'm999'), false, 'no such match');
+  assert.equal(room.viewFor('ana').matches[0].found, false, 'nothing changed');
+  room.found('ana', id);
+  tick(5_000);
+  room.found('ben', id);
+  tick(5_000);
+  room.found('ana', id);
+  assert.equal(room.viewFor('ana').matches[0].foundAt, t0 + 5_000, "ben's is the later; ana's second changed nothing");
+  meet(room, handleOf, 'ana', 'cai');
+  const other = room.viewFor('cai').matches[0];
+  room.block('cai', other.id);
+  assert.equal(room.found('ana', other.id), false, 'a blocked match is gone');
+});
+
 test('a report is kept for the venue team with the band, never a position — about someone, or something', () => {
   const { room, handleOf } = night();
   room.arm('ben', 'hi');
````

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/room.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)|Error"`

Expected: `ℹ pass 23`, `ℹ fail 2`, each `TypeError: room.found is not a function`:

- found: counted only once both say so, and one side's is never shown to the other
- found: only the two of a match say it, the first time is kept, and a match that is gone refuses it

- [ ] **Step 3: Implement.**

In `relay/room.js`:

````diff
--- a/relay/room.js
+++ b/relay/room.js
@@ -219,6 +219,7 @@ export function createRoom({
       picks: { [a]: people.get(a).pick, [b]: people.get(b).pick },
       keep: { [a]: false, [b]: false },
       contacts: { [a]: '', [b]: '' },
+      found: { [a]: 0, [b]: 0 },   // when each said they found the other; 0 not yet
     };
     matches.set(key, m);
     return m;
@@ -322,6 +323,20 @@ export function createRoom({
     }
   }
 
+  /**
+   * We found each other: like keeping, it counts only once both say so, and
+   * one side's is never shown to the other. The first time each said it is
+   * kept. False for a match that is not theirs, or is gone.
+   */
+  function found(viewer, matchId) {
+    for (const m of matches.values()) {
+      if (m.id !== matchId || (m.a !== viewer && m.b !== viewer)) continue;
+      if (!m.found[viewer]) m.found[viewer] = now();
+      return true;
+    }
+    return false;
+  }
+
   /** Everyone a person may see right now: nobody while they are NOT NOW. */
   const seen = (id) => (people.get(id)?.invisible ? [] : [...people.values()].filter((p) => shows(id, p.id)));
   /** SAY HI's list: who is showing blue to this person. The phone's list and wavesAt() both come from here. */
@@ -372,6 +387,9 @@ export function createRoom({
           pick: m.picks[other], yourPick: m.picks[id],
           kept: m.keep[id], keptByBoth: both,
           contact: both ? m.contacts[other] : '',
+          // Your own found; the time only once both said it, the later of the two.
+          found: !!m.found[id],
+          foundAt: m.found[m.a] && m.found[m.b] ? Math.max(m.found[m.a], m.found[m.b]) : null,
         };
       }),
     };
@@ -379,7 +397,7 @@ export function createRoom({
 
   return {
     join, leave, setBand, setProfile, arm, setInvisible, fromPhone, pick, postClip,
-    wave, wavedAtYou, wavesAt, like, unlike, danceBack, block, report, keep, viewFor,
+    wave, wavedAtYou, wavesAt, like, unlike, danceBack, block, report, keep, found, viewFor,
     /** For the relay: who is here, so it knows whose view to push. */
     ids: () => [...people.keys()],
     has: (id) => people.has(id),
````

- [ ] **Step 4: Run** — the file, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 348`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "one side's found shows as both",
  "file": "relay/room.js",
  "from": "foundAt: m.found[m.a] && m.found[m.b] ?",
  "to": "foundAt: m.found[m.a] || m.found[m.b] ?",
  "test": "tests/room.test.js",
  "expect": [
   "found: counted only once both say so"
  ]
 },
 {
  "label": "anyone may say found for any match",
  "file": "relay/room.js",
  "from": "      if (m.id !== matchId || (m.a !== viewer && m.b !== viewer)) continue;\n      if (!m.found[viewer])",
  "to": "      if (m.id !== matchId) continue;\n      if (!m.found[viewer])",
  "test": "tests/room.test.js",
  "expect": [
   "found: only the two of a match say it"
  ]
 },
 {
  "label": "a second found moves the time",
  "file": "relay/room.js",
  "from": "if (!m.found[viewer]) m.found[viewer] = now();",
  "to": "m.found[viewer] = now();",
  "test": "tests/room.test.js",
  "expect": [
   "found: only the two of a match say it"
  ]
 },
 {
  "label": "your view shows the other's found as yours",
  "file": "relay/room.js",
  "from": "found: !!m.found[id],",
  "to": "found: !!m.found[other],",
  "test": "tests/room.test.js",
  "expect": [
   "found: counted only once both say so"
  ]
 },
 {
  "label": "the earlier time, not the later",
  "file": "relay/room.js",
  "from": "? Math.max(m.found[m.a], m.found[m.b])",
  "to": "? Math.min(m.found[m.a], m.found[m.b])",
  "test": "tests/room.test.js",
  "expect": [
   "found: counted only once both say so",
   "found: only the two of a match say it"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add relay/room.js tests/room.test.js
```

````bash
git commit -F - <<'EOF'
Rooms keep who found whom, and show it only once both said so

A match records when each of its two said they found the other; saying it
again keeps the first time, and a match that is gone refuses it. Each view
carries its own found, and the time only once both said it.

Mutation-checked: 5 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 2: A meeting said found alone waits; found by both, the number goes

**Files:**
- Modify: `relay/band.js`
- Test: `tests/band.test.js`

**Interfaces:**
- Consumes: Task 1's `found` and `foundAt` on each of `view.matches`; `MEET_MS`, `bandShow()` in `relay/band.js`.
- Produces: `export const FOUND_SHOW_MS = 60_000`. The meeting face is shown while a match is under `MEET_MS` old **and has no `foundAt`**, with `small: 'FOUND: WAITING'` once its person said found (`'MEET'` before). For `FOUND_SHOW_MS` after the newest `foundAt`, every show about its person — the meeting face, HI, FIRST SONG?, LET'S DANCE! and off — carries `found: { n: <number>, intent: <that meeting's card> }`; NOT NOW and the shows about nobody (letters, the check, the test light, waiting, not in a room) never do. The card is the meeting's, not the armed one: that is the colour the band flashes.

- [ ] **Step 1: Write the failing tests.** Two new, and the longest-show test widened: a meeting said found alone keeps its number and reads `FOUND: WAITING`, with nothing to play; found by both, the number goes at once and every show about the person names it, number and the meeting's card, for `FOUND_SHOW_MS` and not after, never under NOT NOW nor on a show about nobody, the newest found winning and another meeting still on still showing. The widened test puts a meeting said found and one found by both on the longest show the relay can make, and holds it to the band's buffer.

In `tests/band.test.js`:

````diff
--- a/tests/band.test.js
+++ b/tests/band.test.js
@@ -3,7 +3,7 @@
 import { test } from 'node:test';
 import assert from 'node:assert/strict';
 import { readFileSync } from 'node:fs';
-import { CODE_LETTERS, MEET_MS, bandShow, cleanCode, newCode } from '../relay/band.js';
+import { CODE_LETTERS, FOUND_SHOW_MS, MEET_MS, bandShow, cleanCode, newCode } from '../relay/band.js';
 
 const T = Date.UTC(2026, 8, 23, 11, 0);
 const view = (me = {}, matches = []) => ({ me: { armed: null, invisible: false, pick: null, ...me }, matches });
@@ -117,6 +117,38 @@ test('the waves waiting ride on a show about a person on SAY HI, as the newest,
   assert.equal('waves' in bandShow({ view: view({ armed: 'hi' }), now: T }), false);
 });
 
+// ---------- found each other (docs/superpowers/specs/2026-09-26-wrist-found-design.md §2) ----------
+
+test('a meeting its person alone said found keeps its number, and says FOUND: WAITING', () => {
+  const m = { id: 'm1', intent: 'song', number: 27, at: T, found: false, foundAt: null };
+  const before = bandShow({ view: view({ armed: 'hi' }, [m]), now: T + 60_000 });
+  assert.deepEqual([before.kind, before.big, before.small], ['meet', '27', 'MEET']);
+  const said = bandShow({ view: view({ armed: 'hi' }, [{ ...m, found: true }]), now: T + 60_000 });
+  assert.deepEqual([said.kind, said.big, said.small], ['meet', '27', 'FOUND: WAITING'], 'the number stays up');
+  assert.equal('found' in said, false, 'nothing to play yet');
+});
+
+test('found by both: the number goes at once, and every show about its person names it for FOUND_SHOW_MS', () => {
+  const at = T + 60_000;
+  const m = { id: 'm1', intent: 'song', number: 27, at: T, found: true, foundAt: at };
+  const hi = bandShow({ view: view({ armed: 'hi' }, [m]), now: at });
+  assert.deepEqual([hi.kind, hi.found], ['hi', { n: 27, intent: 'song' }], 'its card again, well inside MEET_MS, and the flash is the meeting\'s own card');
+  for (const v of [view({ armed: 'song' }, [m]), view({ armed: 'dance' }, [m]), view({}, [m])]) {
+    assert.deepEqual(bandShow({ view: v, now: at + FOUND_SHOW_MS - 1 }).found, { n: 27, intent: 'song' }, JSON.stringify(v.me));
+  }
+  assert.equal('found' in bandShow({ view: view({ armed: 'hi' }, [m]), now: at + FOUND_SHOW_MS }), false, 'a minute on, no more');
+  for (const s of [bandShow({ view: view({ armed: 'hi', invisible: true }, [m]), now: at }), bandShow({ view: view({ armed: 'hi' }, [m]), code: 'KXRT', now: at }),
+    bandShow({ view: view({ armed: 'hi' }, [m]), check: 12, now: at }), bandShow({ view: view({ armed: 'hi' }, [m]), testUntil: at + 1, now: at }),
+    bandShow({ view: null, waiting: true, now: at }), bandShow({ view: null, now: at })]) {
+    assert.equal('found' in s, false, 'NOT NOW and the shows about nobody: ' + JSON.stringify(s));
+  }
+  const later = { id: 'm2', intent: 'dance', number: 41, at: T + 1_000, found: true, foundAt: at + 5_000 };
+  assert.deepEqual(bandShow({ view: view({ armed: 'hi' }, [m, later]), now: at + 6_000 }).found, { n: 41, intent: 'dance' }, 'the newest found');
+  const other = { id: 'm3', intent: 'hi', number: 55, at: T + 2_000, found: false, foundAt: null };
+  const both = bandShow({ view: view({ armed: 'hi' }, [m, other]), now: at });
+  assert.deepEqual([both.kind, both.big, both.found], ['meet', '55', { n: 27, intent: 'song' }], 'another meeting still on shows, and names the one found');
+});
+
 test('the longest show the relay can make fits the band, however many wait', () => {
   // The band drops a frame longer than its buffer whole: firmware/src/main.cpp, struct Event.
   const cpp = readFileSync(new URL('../firmware/src/main.cpp', import.meta.url), 'utf8');
@@ -124,9 +156,11 @@ test('the longest show the relay can make fits the band, however many wait', ()
   const worst = '\u0001'.repeat(60);   // clip() keeps it, and JSON writes each one as six bytes
   const big = Number.MAX_SAFE_INTEGER;
   const waves = Array.from({ length: 5000 }, (_, i) => ({ handle: 'ffffffffff', n: big - i }));
-  const m = { id: 'm1', intent: 'dance', number: 99, at: T };
+  const m = { id: 'm1', intent: 'dance', number: 99, at: T, found: true, foundAt: null };
+  const done = { id: 'm2', intent: 'dance', number: 98, at: T, found: true, foundAt: T };
   const shows = [
-    bandShow({ view: view({ armed: 'hi', pick: worst, rev: big }, [m]), battery: 1, sound: false, waves, now: T }),
+    bandShow({ view: view({ armed: 'hi', pick: worst, rev: big }, [m, done]), battery: 1, sound: false, waves, now: T }),
+    bandShow({ view: view({ armed: 'hi', pick: worst, rev: big }, [done]), battery: 1, sound: false, waves, now: T }),
     bandShow({ view: view({ armed: 'hi', pick: worst, rev: big }), battery: 1, sound: false, waves, now: T }),
     bandShow({ view: view({ armed: 'song', pick: worst, rev: big }), battery: 1, sound: false, now: T }),
     bandShow({ view: view({ armed: 'dance', rev: big }), battery: 1, sound: false, now: T }),
````

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/band.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)|SyntaxError"`

Expected: the file does not load, `SyntaxError: The requested module '../relay/band.js' does not provide an export named 'FOUND_SHOW_MS'`, and `ℹ fail 1` for the file.

- [ ] **Step 3: Implement.**

In `relay/band.js`:

````diff
--- a/relay/band.js
+++ b/relay/band.js
@@ -12,6 +12,7 @@
 /** Pairing codes: letters only, none that look like another (no I, L or O). */
 export const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
 export const MEET_MS = 15 * 60_000;   // the number shows while the two of you find each other
+export const FOUND_SHOW_MS = 60_000;  // found by both: a band still plays it this long, if it was out of reach
 export const DIM_AT = 15;             // percent; at or below it the light drops to half
 
 const short = (s, n) => {
@@ -48,6 +49,12 @@ const short = (s, n) => {
  * person's own phone knows it), how many wait, and the newest one's number.
  * It is the same size however many wait, so it never outgrows the band's
  * buffer. Every other show carries none, which the wrist reads as nobody.
+ *
+ * A meeting its person said found keeps its number up, `FOUND: WAITING`, until
+ * the other says it too (docs/superpowers/specs/2026-09-26-wrist-found-design.md).
+ * Found by both, it is gone, and for FOUND_SHOW_MS every show about its person
+ * but NOT NOW names it (`found`), so the band plays it once, even one that was
+ * out of reach at the moment.
  */
 export function bandShow({ view = null, battery = null, code = null, check = null, waiting = false, testUntil = 0, sound = null, waves = [], now = Date.now() }) {
   if (check) return { kind: 'check', big: String(check) };
@@ -61,15 +68,19 @@ export function bandShow({ view = null, battery = null, code = null, check = nul
   // NOT NOW is black, completely. Nothing broadcasting, and nothing to read.
   if (view.me.invisible) return { kind: 'off', battery, quiet: true, ...about };
   const waved = view.me.armed === 'hi' && waves.length ? { waves: { ref: waves[0].handle, n: waves.length, seq: waves[0].n } } : {};
+  const done = view.matches
+    .filter((m) => m.foundAt && now - m.foundAt < FOUND_SHOW_MS)
+    .sort((a, b) => b.foundAt - a.foundAt)[0];
+  const found = done ? { found: { n: done.number, intent: done.intent } } : {};
   const meet = view.matches
-    .filter((m) => now - m.at < MEET_MS)
+    .filter((m) => now - m.at < MEET_MS && !m.foundAt)
     .sort((a, b) => b.at - a.at)[0];
-  if (meet) return { kind: 'meet', intent: meet.intent, big: String(meet.number), small: 'MEET', dim, ...about, ...waved };
+  if (meet) return { kind: 'meet', intent: meet.intent, big: String(meet.number), small: meet.found ? 'FOUND: WAITING' : 'MEET', dim, ...about, ...waved, ...found };
   switch (view.me.armed) {
-    case 'hi': return { kind: 'hi', intent: 'hi', big: 'HI :)', small: 'blue means hello', dim, ...about, ...waved };
-    case 'song': return { kind: 'song', intent: 'song', big: 'FIRST SONG?', small: short(view.me.pick, 16), dim, ...about };
-    case 'dance': return { kind: 'dance', intent: 'dance', big: "LET'S DANCE!", small: '', dim, ...about };
-    default: return { kind: 'off', battery, ...about };
+    case 'hi': return { kind: 'hi', intent: 'hi', big: 'HI :)', small: 'blue means hello', dim, ...about, ...waved, ...found };
+    case 'song': return { kind: 'song', intent: 'song', big: 'FIRST SONG?', small: short(view.me.pick, 16), dim, ...about, ...found };
+    case 'dance': return { kind: 'dance', intent: 'dance', big: "LET'S DANCE!", small: '', dim, ...about, ...found };
+    default: return { kind: 'off', battery, ...about, ...found };
   }
 }
````

- [ ] **Step 4: Run** — the file, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 350`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "a meeting found by both stays up",
  "file": "relay/band.js",
  "from": ".filter((m) => now - m.at < MEET_MS && !m.foundAt)",
  "to": ".filter((m) => now - m.at < MEET_MS)",
  "test": "tests/band.test.js",
  "expect": [
   "found by both: the number goes at once"
  ]
 },
 {
  "label": "said alone reads MEET",
  "file": "relay/band.js",
  "from": "small: meet.found ? 'FOUND: WAITING' : 'MEET'",
  "to": "small: 'MEET'",
  "test": "tests/band.test.js",
  "expect": [
   "a meeting its person alone said found"
  ]
 },
 {
  "label": "named a block past FOUND_SHOW_MS",
  "file": "relay/band.js",
  "from": "now - m.foundAt < FOUND_SHOW_MS",
  "to": "now - m.foundAt <= FOUND_SHOW_MS",
  "test": "tests/band.test.js",
  "expect": [
   "found by both: the number goes at once"
  ]
 },
 {
  "label": "FIRST SONG? does not name it",
  "file": "relay/band.js",
  "from": "small: short(view.me.pick, 16), dim, ...about, ...found };",
  "to": "small: short(view.me.pick, 16), dim, ...about };",
  "test": "tests/band.test.js",
  "expect": [
   "found by both: the number goes at once"
  ]
 },
 {
  "label": "NOT NOW names it",
  "file": "relay/band.js",
  "from": "return { kind: 'off', battery, quiet: true, ...about };",
  "to": "return { kind: 'off', battery, quiet: true, ...about, found: { n: view.matches[0]?.number, intent: view.matches[0]?.intent } };",
  "test": "tests/band.test.js",
  "expect": [
   "found by both: the number goes at once"
  ]
 },
 {
  "label": "the oldest found, not the newest",
  "file": "relay/band.js",
  "from": ".sort((a, b) => b.foundAt - a.foundAt)[0]",
  "to": ".sort((a, b) => a.foundAt - b.foundAt)[0]",
  "test": "tests/band.test.js",
  "expect": [
   "found by both: the number goes at once"
  ]
 },
 {
  "label": "the flash takes the armed card, not the meeting's",
  "file": "relay/band.js",
  "from": "intent: done.intent",
  "to": "intent: view.me.armed",
  "test": "tests/band.test.js",
  "expect": [
   "found by both: the number goes at once"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add relay/band.js tests/band.test.js
```

````bash
git commit -F - <<'EOF'
A meeting said found alone waits; found by both, the number goes

The meeting face stays up, FOUND: WAITING, while only its person has said
found, so their match can still find them. Found by both, it is gone at
once, and for FOUND_SHOW_MS every show about the person but NOT NOW names
it, the number and the meeting's own card, so the band can play it once in
that card's colour even after being out of reach.

Mutation-checked: 7 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 3: A band says found for its person, and a phone says it too

**Files:**
- Modify: `relay/server.js`
- Test: `tests/wristband.test.js`, `tests/relay-harness.js`

**Interfaces:**
- Consumes: Task 1's `room.found()` and `foundAt`; Task 2's meeting face; `MEET_MS`; the band record (`makeBand()`), `rooms`, `push()` and `handleBand()` in `relay/server.js`; the waves plan's `heldRelay()` test helper and the harness's `band.replies`.
- Produces: the band message `{ t: 'found', number }`, `number` a string of exactly two digits (`/^[1-9][0-9]$/`); anything else is dropped whole, unanswered and unstamped. Answers `{ t: 'found', ok: true }`, or `{ t: 'found', ok: false, why }` with `why` one of `too fast`, `unpaired`, `no room`, `gone`, in that order of checking. `FOUND_GAP_MS = 1000` and the band record's `foundTry`, stamped before anything is looked up, refused or not. The meeting found is the band's person's newest match with that number, under `MEET_MS` and without `foundAt`; none (a block, a meeting over, one found by both, a wrong number) is `gone`. The phone message `{ t: 'found', match }` is `room.found(me, match)`, as `keep` is. A found that lands pushes as after any change; a refused one changes nothing, so a push would send nothing. The harness keeps a band's `found` replies in `band.replies`.

- [ ] **Step 1: Write the failing tests.** Four socket tests: a band says found, its own band reads `FOUND: WAITING` with the number still up while the other band and phone are exactly as they were, then the other's phone says it and both numbers go and both bands are shown the found in the meeting's card, with one `foundAt` on both phones; a malformed found (missing, a number, `'7'`, `'100'`, `'07'`, `' 27'`, `'ab'`) is dropped unanswered, then `unpaired`, `too fast` (a refused one is still stamped) and `no room`; `gone` for a number that is not its meeting's, a meeting over, and one found by both, each changing nothing; and a block reads exactly as a meeting that is over, telling the one blocked nothing.

In `tests/relay-harness.js`:

````diff
--- a/tests/relay-harness.js
+++ b/tests/relay-harness.js
@@ -57,7 +57,7 @@ export function helpers(port) {
       const m = JSON.parse(String(data));
       if (m.t === 'show') b.show = m.show;
       if (m.t === 'paired') b.secret = m.secret;
-      if (m.t === 'set' || m.t === 'wave' || m.t === 'error') b.replies.push(m);
+      if (m.t === 'set' || m.t === 'wave' || m.t === 'found' || m.t === 'error') b.replies.push(m);
       b.waiters = b.waiters.filter((w) => !w());
     });
     await new Promise((resolve) => ws.once('open', resolve));
````

In `tests/wristband.test.js`:

````diff
--- a/tests/wristband.test.js
+++ b/tests/wristband.test.js
@@ -8,6 +8,7 @@ import { mkdtempSync, rmSync } from 'node:fs';
 import { tmpdir } from 'node:os';
 import { join } from 'node:path';
 import { createRelay, bandIdOf, BAND_ALONE_MS, PAIR_CHECK_MS } from '../relay/server.js';
+import { MEET_MS } from '../relay/band.js';
 import { helpers, newKey, pause } from './relay-harness.js';
 
 let relay;
@@ -786,3 +787,111 @@ test("two people already matched tonight: a band's wave back is answered ok, and
   assert.deepEqual(ana.view.matches.map((x) => [x.id, x.number]), [[m.id, m.number]], 'the match they had, and no other');
   close(ana, ben, cai, band);
 });
+
+// ---------- found each other (docs/superpowers/specs/2026-09-26-wrist-found-design.md §2) ----------
+
+/** Ana and ben each wear a band, and have just matched on SAY HI: both bands show the meeting. */
+async function meeting(venue, on = { phone, wristband, pairBand }, clock = null) {
+  const [aBand, bBand] = [await on.wristband(), await on.wristband()];
+  const ana = await on.phone(venue);
+  const ben = await on.phone(venue);
+  await on.pairBand(ana, aBand);
+  await on.pairBand(ben, bBand);
+  if (clock) clock.t += 3_000;                    // past the white flash a new pairing gives
+  for (const p of [ana, ben]) p.send({ t: 'arm', intent: 'hi' });
+  for (const p of [ana, ben]) await p.until((v) => v.near.length === 1);
+  ana.send({ t: 'wave', handle: ana.view.near[0].handle });
+  ben.send({ t: 'wave', handle: ben.view.near[0].handle });
+  const [a] = await Promise.all([aBand.until((s) => s.kind === 'meet', 5000), bBand.until((s) => s.kind === 'meet', 5000)]);
+  return { aBand, bBand, ana, ben, number: a.big };
+}
+
+/** A band's own found, and the relay's answer. */
+async function sayFound(band, number) {
+  const before = band.replies.length;
+  band.send({ t: 'found', number });
+  await band.until((s, b) => b.replies.length > before);
+  return band.replies.at(-1);
+}
+const notFound = (why) => ({ t: 'found', ok: false, why });
+
+test("a band says found: its own band waits and the other's is as it was; once the other's phone says it too, both numbers go and both bands are told", async () => {
+  const { aBand, bBand, ana, ben, number } = await meeting('found-both');
+  assert.deepEqual(await sayFound(aBand, number), { t: 'found', ok: true });
+  const waiting = await aBand.until((s) => s.small === 'FOUND: WAITING');
+  assert.equal(waiting.big, number, 'the number stays up');
+  await ana.until((v) => v.matches[0].found);
+  await pause(50);
+  assert.deepEqual([bBand.show.kind, bBand.show.small, 'found' in bBand.show], ['meet', 'MEET', false], "ben's band is as it was");
+  assert.deepEqual([ben.view.matches[0].found, ben.view.matches[0].foundAt], [false, null], "and ben's phone");
+  ben.send({ t: 'found', match: ben.view.matches[0].id });
+  const [a, b] = await Promise.all([aBand.until((s) => s.found?.n === Number(number)), bBand.until((s) => s.found?.n === Number(number))]);
+  assert.deepEqual([a.kind, b.kind], ['hi', 'hi'], 'both numbers gone, both cards back');
+  assert.deepEqual([a.found, b.found], [{ n: Number(number), intent: 'hi' }, { n: Number(number), intent: 'hi' }], "both play it in the meeting's card");
+  const [va, vb] = await Promise.all([ana.until((v) => v.matches[0].foundAt), ben.until((v) => v.matches[0].foundAt)]);
+  assert.equal(va.matches[0].foundAt, vb.matches[0].foundAt, 'one time on both phones');
+  close(ana, ben, aBand, bBand);
+});
+
+test('a malformed found from a band is dropped unanswered; the rest are refused unpaired, no room, and too fast before anything is looked up', async () => {
+  await heldRelay(async (on, clock, own) => {
+    const loose = await on.wristband();
+    for (const m of [{ t: 'found' }, { t: 'found', number: 27 }, { t: 'found', number: '7' }, { t: 'found', number: '100' },
+      { t: 'found', number: '07' }, { t: 'found', number: ' 27' }, { t: 'found', number: 'ab' }]) {
+      loose.send(m);
+      await pause(40);
+      assert.deepEqual(loose.replies, [], JSON.stringify(m));
+    }
+    // None of those was stamped: this one, in the same second, is looked at.
+    assert.deepEqual(await sayFound(loose, '27'), notFound('unpaired'));
+    assert.deepEqual(await sayFound(loose, '28'), notFound('too fast'), 'the last was refused, and still stamped');
+    clock.t += 1_000;
+    assert.deepEqual(await sayFound(loose, '28'), notFound('unpaired'), 'a second on');
+
+    const band = await on.wristband();
+    const ana = await on.phone('found-noroom');
+    await on.pairBand(ana, band);
+    clock.t += 3_000;
+    ana.ws.close();
+    await pause(100);
+    own.expire(clock.t + BAND_ALONE_MS + 1_000);   // held only by the wristband, for the hour
+    await band.until((s) => s.away);
+    assert.deepEqual(await sayFound(band, '27'), notFound('no room'));
+  });
+});
+
+test("a band's found is refused gone for a number that is not its meeting's, one found by both, or one over; a refused one changes nothing", async () => {
+  await heldRelay(async (on, clock) => {
+    const { aBand, bBand, ana, ben, number } = await meeting('found-gone', on, clock);
+    const wrong = number === '99' ? '98' : String(Number(number) + 1);
+    assert.deepEqual(await sayFound(aBand, wrong), notFound('gone'), 'not its meeting');
+    await pause(50);
+    assert.deepEqual([ana.view.matches[0].found, aBand.show.small], [false, 'MEET'], 'nothing said');
+    clock.t += MEET_MS;
+    assert.deepEqual(await sayFound(aBand, number), notFound('gone'), 'fifteen minutes on, the meeting is over');
+    await pause(50);
+    assert.equal(ana.view.matches[0].found, false);
+    close(ana, ben, aBand, bBand);
+  });
+  const { aBand, bBand, ana, ben, number } = await meeting('found-twice');
+  assert.deepEqual(await sayFound(aBand, number), { t: 'found', ok: true });
+  ben.send({ t: 'found', match: (await ben.until((v) => v.matches.length === 1)).matches[0].id });
+  await aBand.until((s) => s.found?.n === Number(number));
+  await pause(1_000);                             // past FOUND_GAP_MS
+  assert.deepEqual(await sayFound(aBand, number), notFound('gone'), 'found by both, it is over');
+  close(ana, ben, aBand, bBand);
+});
+
+test('a block reads exactly as a meeting that is over, and tells the one blocked nothing', async () => {
+  const { aBand, bBand, ana, ben, number } = await meeting('found-block');
+  ben.send({ t: 'block', handle: (await ben.until((v) => v.matches.length === 1)).matches[0].id });
+  await aBand.until((s) => s.kind === 'hi');
+  let heard = 0;
+  const count = () => { heard += 1; };
+  ben.ws.on('message', count);
+  assert.deepEqual(await sayFound(aBand, number), notFound('gone'));
+  await pause(50);
+  ben.ws.off('message', count);
+  assert.equal(heard, 0, "nothing reached ben's phone");
+  close(ana, ben, aBand, bBand);
+});
````

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build >/dev/null && node --test tests/wristband.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: `ℹ pass 40`, `ℹ fail 4`:

- a band says found: its own band waits and the other's is as it was; once the other's phone says it too, both numbers go and both bands are told
- a malformed found from a band is dropped unanswered; the rest are refused unpaired, no room, and too fast before anything is looked up
- a band's found is refused gone for a number that is not its meeting's, one found by both, or one over; a refused one changes nothing
- a block reads exactly as a meeting that is over, and tells the one blocked nothing

- [ ] **Step 3: Implement.**

In `relay/server.js`:

````diff
--- a/relay/server.js
+++ b/relay/server.js
@@ -15,7 +15,7 @@ import { fileURLToPath } from 'node:url';
 import { createHash, randomBytes, randomInt } from 'node:crypto';
 import { WebSocketServer } from 'ws';
 import { createRoom, INTENTS, SPOTS } from './room.js';
-import { bandShow, cleanCode, newCode } from './band.js';
+import { MEET_MS, bandShow, cleanCode, newCode } from './band.js';
 import { nightOf } from './night.js';
 
 export const WS_PATH = '/api/ws';
@@ -31,6 +31,7 @@ const PING_MS = 15_000;
 const BAND_GRACE_MS = 60_000;         // a wristband that drops keeps its letters this long
 const SET_GAP_MS = 1000;              // a wristband may change its person at most once a second
 const WAVE_GAP_MS = 1000;             // and wave back at most once a second, on a stamp of its own
+const FOUND_GAP_MS = 1000;            // and say found at most once a second, on a stamp of its own
 const TRIES_MS = 60_000;              // the window pairing attempts are counted in
 const SOCKET_TRIES = 5;               // pairing attempts one socket may make in it
 const ADDRESS_TRIES = 20;             // pairing attempts one address may make in it, over every socket
@@ -169,6 +170,7 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
     quiet: false,       // a hold with nobody in a room to hide, kept until they are
     setAt: 0,           // when this wristband last changed its person (rule 1)
     waveAt: 0,          // when it last waved back, landed or not
+    foundTry: 0,        // when it last said found, landed or not
   });
 
   // How long a record has been dead weight: a live wristband is never that, a
@@ -282,6 +284,31 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
     return answer(null);
   }
 
+  /**
+   * We found each other, said on the wrist's meeting face
+   * (docs/superpowers/specs/2026-09-26-wrist-found-design.md §2): for its
+   * person's meeting with that number, under MEET_MS old and not yet found by
+   * both. The relay answers ok, or no and why; a refused one changes nothing
+   * and tells nobody. Returns whether it landed.
+   */
+  function foundFromBand(ws, b, m) {
+    // Dropped whole, unanswered and unstamped, unless it is exactly a found: a meeting's number is two digits.
+    if (typeof m.number !== 'string' || !/^[1-9][0-9]$/.test(m.number)) return false;
+    const answer = (why) => { ws.send(JSON.stringify(why ? { t: 'found', ok: false, why } : { t: 'found', ok: true })); return !why; };
+    // Stamped before anything is looked up, refused or not: finding the meeting is a view of the person.
+    if (now() - b.foundTry < FOUND_GAP_MS) return answer('too fast');
+    b.foundTry = now();
+    if (!b.person) return answer('unpaired');
+    const room = rooms.get(b.key)?.room;
+    if (!room?.has(b.person)) return answer('no room');
+    // The meeting its face shows: the newest with that number. Over, found by both, or blocked, it is gone.
+    const meeting = room.viewFor(b.person).matches
+      .filter((x) => String(x.number) === m.number && now() - x.at < MEET_MS && !x.foundAt)
+      .sort((x, y) => y.at - x.at)[0];
+    if (!meeting || !room.found(b.person, meeting.id)) return answer('gone');
+    return answer(null);
+  }
+
   function handleBand(ws, m) {
     const b = bands.get(ws.band);
     // Only from the wristband's current socket: a set stuck in a replaced one must not land.
@@ -291,6 +318,7 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
     if (m.t === 'hold') holdOn(b);
     if (m.t === 'set' && !setFromBand(ws, b, m)) return;
     if (m.t === 'wave' && !waveFromBand(ws, b, m)) return;
+    if (m.t === 'found' && !foundFromBand(ws, b, m)) return;
     const r = b.key ? rooms.get(b.key) : null;
     if (r) push(r); else showBand(b);
   }
@@ -514,6 +542,7 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
         if (room.report(me, m.handle || null, m.why)) console.log('REPORT', JSON.stringify(room.reports().at(-1)));
         break;
       case 'keep': room.keep(me, m.match, m.on); break;
+      case 'found': room.found(me, m.match); break;
       case 'clip': {
         const to = m.to ? String(m.to) : null;
         const ref = keepClip(r, me, m.mime, m.data, to ? 'to:' + to : 'floor');
````

- [ ] **Step 4: Run** — the file, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 354`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`. A refused found that pushed anyway would not be caught, and needs no guard: `push()` sends a view or a show only when its text changed, and a refusal changes nothing.

````json
[
 {
  "label": "any digits pass for a number",
  "file": "relay/server.js",
  "from": "!/^[1-9][0-9]$/.test(m.number)",
  "to": "!/^[0-9]+$/.test(m.number)",
  "test": "tests/wristband.test.js",
  "expect": [
   "a malformed found from a band is dropped unanswered"
  ]
 },
 {
  "label": "stamped only once paired",
  "file": "relay/server.js",
  "from": "    b.foundTry = now();\n    if (!b.person) return answer('unpaired');",
  "to": "    if (!b.person) return answer('unpaired');\n    b.foundTry = now();",
  "test": "tests/wristband.test.js",
  "expect": [
   "a malformed found from a band is dropped unanswered"
  ]
 },
 {
  "label": "no gap between founds",
  "file": "relay/server.js",
  "from": "if (now() - b.foundTry < FOUND_GAP_MS)",
  "to": "if (false && now() - b.foundTry < FOUND_GAP_MS)",
  "test": "tests/wristband.test.js",
  "expect": [
   "a malformed found from a band is dropped unanswered"
  ]
 },
 {
  "label": "an unpaired band is looked up anyway",
  "file": "relay/server.js",
  "from": "    b.foundTry = now();\n    if (!b.person) return answer('unpaired');",
  "to": "    b.foundTry = now();",
  "test": "tests/wristband.test.js",
  "expect": [
   "a malformed found from a band is dropped unanswered"
  ]
 },
 {
  "label": "a meeting over is still found",
  "file": "relay/server.js",
  "from": ".filter((x) => String(x.number) === m.number && now() - x.at < MEET_MS && !x.foundAt)",
  "to": ".filter((x) => String(x.number) === m.number && !x.foundAt)",
  "test": "tests/wristband.test.js",
  "expect": [
   "a band's found is refused gone"
  ]
 },
 {
  "label": "a meeting found by both is answered ok",
  "file": "relay/server.js",
  "from": ".filter((x) => String(x.number) === m.number && now() - x.at < MEET_MS && !x.foundAt)",
  "to": ".filter((x) => String(x.number) === m.number && now() - x.at < MEET_MS)",
  "test": "tests/wristband.test.js",
  "expect": [
   "a band's found is refused gone"
  ]
 },
 {
  "label": "any number finds the meeting",
  "file": "relay/server.js",
  "from": ".filter((x) => String(x.number) === m.number && now() - x.at < MEET_MS && !x.foundAt)",
  "to": ".filter((x) => now() - x.at < MEET_MS && !x.foundAt)",
  "test": "tests/wristband.test.js",
  "expect": [
   "a band's found is refused gone"
  ]
 },
 {
  "label": "answered ok, never recorded",
  "file": "relay/server.js",
  "from": "if (!meeting || !room.found(b.person, meeting.id)) return answer('gone');",
  "to": "if (!meeting) return answer('gone');",
  "test": "tests/wristband.test.js",
  "expect": [
   "a band says found",
   "a band's found is refused gone"
  ]
 },
 {
  "label": "the phone cannot say found",
  "file": "relay/server.js",
  "from": "      case 'found': room.found(me, m.match); break;\n",
  "to": "",
  "test": "tests/wristband.test.js",
  "expect": [
   "a band says found",
   "a band's found is refused gone"
  ]
 }
]
````

- [ ] **Step 6: Commit, and close Stage A with P2**

```bash
git add relay/server.js tests/relay-harness.js tests/wristband.test.js
```

````bash
git commit -F - <<'EOF'
A band says found for its person, and a phone says it too

A band's {t:'found', number} is taken as its person's found for the
meeting its face shows: the newest with that number, under MEET_MS and
not yet found by both. It is answered ok, or refused unpaired, no room,
too fast or gone, stamped before anything is looked up and at most once
a FOUND_GAP_MS; anything but exactly a two-digit number is dropped
unanswered. A block reads as a meeting that is over. A phone's
{t:'found', match} is taken as keep is.

Mutation-checked: 9 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---
## Stage B — The wrist

Every task in this stage changes both twins and the one table (Task 6 only the band's console). The table's step keys are the reactions plan's: `"sounds"` exact and `[]` unless said, `"press"` with `"downSounds"` (default `["tick"]`), and `"show"` with `"with"` laid over it, here `"with": { "small": "FOUND: WAITING" }` or `"with": { "found": { "n": 27, "intent": "song" } }`. The table's `MEET` show is `{ "kind": "meet", "intent": "song", "big": "27", "small": "MEET", "dim": false, "armed": "hi" }`: a meeting on FIRST SONG? while its person shows SAY HI, so the meeting's card (song, yellow) and the armed card (hi, blue) differ and a case can tell them apart. Run the table on both twins with `npm run build >/dev/null && node --test tests/wrist.test.js tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`. Each case runs as `wrist.js: <name>` and as `band_logic.h: <name>`.

To add cases, append them to the end of the `"cases"` array one step to a line, as the file has them. A small Node script does it without disturbing the rest of the file:

````js
// Append cases to tests/fixtures/wrist-cases.json in the file's own layout: one step a line.
// Usage (from the repository root): node splice.mjs <cases.json>
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'tests/fixtures/wrist-cases.json';
const one = (v) => (Array.isArray(v) ? '[' + v.map(one).join(', ') + ']'
  : v && typeof v === 'object' ? '{ ' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ': ' + one(x)).join(', ') + ' }'
  : JSON.stringify(v));
const block = (c) => {
  const head = Object.entries(c).filter(([k]) => k !== 'steps').map(([k, v]) => '      ' + JSON.stringify(k) + ': ' + JSON.stringify(v) + ',');
  return ['    {', ...head, '      "steps": [', c.steps.map((s) => '        ' + one(s)).join(',\n'), '      ]', '    }'].join('\n');
};
const text = readFileSync(FILE, 'utf8');
const end = text.lastIndexOf('\n  ]\n}');
if (end < 0) throw new Error('no end of cases');
const added = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = text.slice(0, end) + ',\n' + added.map(block).join(',\n') + text.slice(end);
JSON.parse(out);
writeFileSync(FILE, out);
console.log('added', added.length, 'cases');
````

### Task 4: A side hold on the meeting face says found

**Files:**
- Modify: `app/lib/wrist.js`, `firmware/src/band_logic.h`
- Test: `tests/fixtures/wrist-cases.json`

**Interfaces:**
- Consumes: Task 3's band message and answers; the waves plan's `waveBack()` pattern (a mode that waits `CONFIRM_MS`, `NOT SENT` and a dropped socket on silence); `sideHeld()`, `result()`, `rest()`, `restFace()` / `wordsFor()` and `face()` in both twins.
- Produces: a new mode, `'found'` in JS and `FOUND` in C++. `meetingFace(now)`: the show is a meeting (`kind` `meet`) whose `big` is two digits, believed (not stale) and not under a NOT NOW the relay has yet to hear. On it, a SIDE hold from rest or over a result calls `sayFound(now)`: with the link down, `NOT SENT` at once and nothing sent; otherwise `{"t":"found","number":"NN"}` goes out, the mode is `found`, `sentAt` is stamped and `double` plays. The found face is the resting meeting face with `SENDING` as its small line. `{ t: 'found', ok }` with a boolean `ok` is heard only in that mode: `true` rests the face, `false` is `NOT SENT` (low, orange twice). `CONFIRM_MS` without an answer is `NOT SENT` and `DROP`, as for a wave back. Woken (a face press), a meeting face whose small line is exactly `MEET` reads `HOLD SIDE: FOUND`; `FOUND: WAITING` is never replaced. A SIDE press still opens the chooser; the key that answers a call still does nothing else, a hold included.

- [ ] **Step 1: Write the failing cases.** Eight: a side hold on the resting meeting face sends found with a double and shows `SENDING` over the number until the relay takes it, then the face rests and shows `FOUND: WAITING` when the show says so; woken, the hint for exactly the wake time, the key that answers the call sending nothing even held, and `FOUND: WAITING` kept; a side press still opens the chooser, and a side hold in it sends nothing; out of reach, `NOT SENT` at once with low and orange and nothing sent, and once the show is no longer believed a side hold is a look; no answer in `CONFIRM_MS`, `NOT SENT` and the socket dropped; a refusal is `NOT SENT`, a side hold over it says found again, and answers of the wrong shape, an answer with no found under way, a wave's answer and a side press while it sends all change nothing; a meeting number that is not two digits (`7"`) takes a side hold as anywhere else; and under a NOT NOW the relay has yet to hear, a side hold sends nothing.

Append to `tests/fixtures/wrist-cases.json`:

````diff
--- a/tests/fixtures/wrist-cases.json
+++ b/tests/fixtures/wrist-cases.json
@@ -1206,6 +1206,119 @@
         { "at": "7000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } } },
         { "at": "8000", "press": 1, "face": { "big": "SOMEONE WAVED" } }
       ]
+    },
+    {
+      "name": "a SIDE hold on the resting meeting face says found with a double; SENDING on the meeting face until the relay takes it, then the face rests",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "2000", "press": 1, "face": { "big": "27", "small": "MEET", "light": "LIGHT_FULL" } },
+        { "at": "4000", "key2": "down", "sounds": ["tick"] },
+        { "at": "4000+HOLD_MS", "sent": [{ "t": "found", "number": "27" }], "sounds": ["double"], "face": { "big": "27", "small": "SENDING", "field": "song", "light": "LIGHT_FULL" } },
+        { "at": "5600", "key2": "up", "face": { "big": "27", "small": "SENDING", "field": "song" } },
+        { "at": "6000", "frame": { "t": "found", "ok": true }, "face": { "big": "27", "small": "MEET", "field": "song", "light": "LIGHT_FULL" } },
+        { "at": "6100", "show": "MEET", "rev": 3, "with": { "small": "FOUND: WAITING" }, "face": { "big": "27", "small": "FOUND: WAITING", "field": "song", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "woken, the meeting face says HOLD SIDE: FOUND for the wake time; the key that answers the call sends nothing; FOUND: WAITING stays as it is",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "2000", "key2": "down", "sounds": ["tick"] },
+        { "at": "2000+HOLD_MS", "face": { "big": "27", "small": "MEET", "light": "LIGHT_FULL" } },
+        { "at": "4000", "key2": "up", "face": { "big": "27", "small": "MEET", "light": "LIGHT_FULL" } },
+        { "at": "5000", "press": 1, "face": { "big": "27", "small": "HOLD SIDE: FOUND", "field": "song", "ink": "ink", "light": "LIGHT_FULL" } },
+        { "at": "5099+WAKE_MS", "face": { "big": "27", "small": "HOLD SIDE: FOUND" } },
+        { "at": "5100+WAKE_MS", "face": { "big": "27", "small": "MEET" } },
+        { "at": "12000", "show": "MEET", "rev": 3, "with": { "small": "FOUND: WAITING" } },
+        { "at": "13000", "press": 1, "face": { "big": "27", "small": "FOUND: WAITING" } }
+      ]
+    },
+    {
+      "name": "a SIDE press on the meeting face still opens the chooser, and a SIDE hold in it says nothing found",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "2000", "press": 1, "face": { "big": "27", "small": "MEET" } },
+        { "at": "3000", "press": 2, "face": { "big": "HI :)", "small": "SIDE TO CHANGE", "field": "hi" } },
+        { "at": "4000", "key2": "down", "sounds": ["tick"] },
+        { "at": "4000+HOLD_MS", "face": { "big": "HI :)", "small": "SIDE TO CHANGE" } },
+        { "at": "6000", "key2": "up", "face": { "big": "HI :)", "small": "SIDE TO CHANGE" } }
+      ]
+    },
+    {
+      "name": "out of reach, a SIDE hold on the meeting face shows NOT SENT with low and orange and sends nothing; once the show is not believed, it is a look",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "2000", "press": 1 },
+        { "at": "3000", "link": "down", "face": { "big": "27", "small": "MEET" } },
+        { "at": "4000", "key2": "down", "sounds": ["tick"] },
+        { "at": "4000+HOLD_MS", "sounds": ["low"], "face": { "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "6000", "key2": "up" },
+        { "at": "6800", "face": { "big": "27", "small": "NOT SENT" } },
+        { "at": "3000+STALE_MS", "key2": "down", "sounds": ["tick"] },
+        { "at": "3000+STALE_MS+HOLD_MS", "face": { "big": "NO SIGNAL" } }
+      ]
+    },
+    {
+      "name": "a found with no answer in CONFIRM_MS shows NOT SENT and drops the socket",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "2000", "press": 1 },
+        { "at": "3000", "key2": "down", "sounds": ["tick"] },
+        { "at": "3000+HOLD_MS", "sent": [{ "t": "found", "number": "27" }], "sounds": ["double"], "face": { "big": "27", "small": "SENDING" } },
+        { "at": "5000", "key2": "up" },
+        { "at": "4500+CONFIRM_MS-1", "face": { "big": "27", "small": "SENDING" } },
+        { "at": "4500+CONFIRM_MS", "sent": ["DROP"], "sounds": ["low"], "face": { "field": "orange" } },
+        { "at": "5700+CONFIRM_MS", "face": { "big": "27", "small": "NOT SENT" } }
+      ]
+    },
+    {
+      "name": "a found refused shows NOT SENT, and a SIDE hold on it says found again; answers of the wrong shape, or with no found under way, change nothing, and SIDE does nothing while it sends",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "2000", "press": 1 },
+        { "at": "2500", "frame": { "t": "found", "ok": false, "why": "gone" }, "face": { "big": "27", "small": "MEET" } },
+        { "at": "3000", "key2": "down", "sounds": ["tick"] },
+        { "at": "3000+HOLD_MS", "sent": [{ "t": "found", "number": "27" }], "sounds": ["double"], "face": { "small": "SENDING" } },
+        { "at": "5000", "key2": "up", "face": { "small": "SENDING" } },
+        { "at": "5500", "press": 2, "face": { "big": "27", "small": "SENDING" } },
+        { "at": "6000", "frame": { "t": "found" }, "face": { "small": "SENDING" } },
+        { "at": "6100", "frame": { "t": "wave", "ok": false, "why": "gone" }, "face": { "small": "SENDING" } },
+        { "at": "7000", "frame": { "t": "found", "ok": false, "why": "gone" }, "sounds": ["low"], "face": { "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "8300", "face": { "big": "27", "small": "NOT SENT" } },
+        { "at": "8500", "key2": "down", "sounds": ["tick"] },
+        { "at": "8500+HOLD_MS", "sent": [{ "t": "found", "number": "27" }], "sounds": ["double"], "face": { "big": "27", "small": "SENDING" } },
+        { "at": "10500", "key2": "up" },
+        { "at": "11000", "frame": { "t": "found", "ok": true }, "face": { "big": "27", "small": "MEET" } }
+      ]
+    },
+    {
+      "name": "a meeting number that is not two digits takes a SIDE hold as anywhere else",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "with": { "big": "7\"" }, "sounds": ["jingle"] },
+        { "at": "2000", "press": 1 },
+        { "at": "3000", "key2": "down", "sounds": ["tick"] },
+        { "at": "3000+HOLD_MS", "face": { "big": "HI :)", "small": "SIDE TO CHANGE" } }
+      ]
+    },
+    {
+      "name": "in NOT NOW before the relay has heard it, a SIDE hold on what was the meeting says nothing found",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "2000", "press": 1 },
+        { "at": "3000", "key1": "down", "sounds": ["tick"] },
+        { "at": "3000+HOLD_MS", "sounds": ["down"], "sent": [{ "t": "hold" }], "face": { "big": "", "light": "LIGHT_OFF" } },
+        { "at": "5000", "key1": "up" },
+        { "at": "5100", "key2": "down" },
+        { "at": "5100+HOLD_MS", "face": { "big": "NOT NOW", "small": "SIDE TO CHANGE" } }
+      ]
     }
   ]
 }
````

- [ ] **Step 2: Run the table and watch it fail**

Run: `node --test tests/wrist.test.js tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: five of the eight cases red on each twin (`wrist.js: 88 pass, 5 fail`; `firmware.test.js: 96 pass, 5 fail`). The other three — the chooser, a number that is not two digits, and NOT NOW — are guards: they pass before the change and hold it after.

- a SIDE hold on the resting meeting face says found with a double; SENDING on the meeting face until the relay takes it, then the face rests (`6500 tick: sent`)
- woken, the meeting face says HOLD SIDE: FOUND for the wake time; the key that answers the call sends nothing; FOUND: WAITING stays as it is (`6100 key1 up: face.small`, `MEET`)
- out of reach, a SIDE hold on the meeting face shows NOT SENT with low and orange and sends nothing; once the show is not believed, it is a look (`6500 tick: sounds`)
- a found with no answer in CONFIRM_MS shows NOT SENT and drops the socket (`5500 tick: sent`)
- a found refused shows NOT SENT, and a SIDE hold on it says found again; answers of the wrong shape, or with no found under way, change nothing, and SIDE does nothing while it sends (`5500 tick: sent`)

- [ ] **Step 3: Implement in both twins.**

In `app/lib/wrist.js`:

````diff
--- a/app/lib/wrist.js
+++ b/app/lib/wrist.js
@@ -21,6 +21,10 @@
 //
 // A wave at its person calls (docs/superpowers/specs/2026-09-25-wrist-waves-
 // design.md): hello, and the HI blue three times, whatever the keys do.
+//
+// A SIDE hold on the meeting face says the two of you found each other
+// (docs/superpowers/specs/2026-09-26-wrist-found-design.md). The relay counts
+// it only once both have said it; until then the face says FOUND: WAITING.
 
 import { bandIdOf } from './sha256.js';
 
@@ -123,7 +127,7 @@ export function createWrist({ key }) {
   let wakeUntil = 0;
   const k1 = { down: false, since: 0, fired: false };
   const k2 = { down: false, since: 0, fired: false };
-  let mode = 'rest';          // rest | look | choosing | sending | result | waves | waveback
+  let mode = 'rest';          // rest | look | choosing | sending | result | waves | waveback | found
   let preview = '';           // hi | song | dance | off
   let fromQuiet = false;
   let frozen = false;
@@ -166,6 +170,8 @@ export function createWrist({ key }) {
   const blinking = (now) => calling && mode === 'rest' && !stale(now) && show?.kind === 'meet';
   // The letters or the check on the face: the band is nobody's yet, and a key only says where to go.
   const pairingFace = (now) => !stale(now) && !quiet.pending && (show?.kind === 'pairing' || show?.kind === 'check');
+  // A meeting's number on the face, believed and not under NOT NOW: a SIDE hold there says found. A number is two digits.
+  const meetingFace = (now) => show?.kind === 'meet' && /^[1-9][0-9]$/.test(show.big) && !stale(now) && !quiet.pending;
   const current = () => (quiet.pending || show?.quiet ? 'notnow' : show?.armed || 'off');
   const pct = () => (battery >= 0 ? battery + '%' : '');
 
@@ -318,6 +324,15 @@ export function createWrist({ key }) {
     react('double');
   }
 
+  /** A SIDE hold on the meeting face: the two of them found each other. Out of reach, NOT SENT at once. */
+  function sayFound(now) {
+    if (!link.up) { result(now, 'NOT SENT'); return; }
+    send({ t: 'found', number: show.big });
+    mode = 'found';
+    sentAt = now;
+    react('double');
+  }
+
   function step(now) {
     if (k1.down || frozen || mode === 'sending' || mode === 'waveback') return;
     if (mode === 'result') rest();
@@ -347,6 +362,7 @@ export function createWrist({ key }) {
     if (mode === 'choosing') commit(now, true);
     else if (mode === 'waves') waveBack(now);
     else if (mode === 'look') stepAt = now;
+    else if ((mode === 'rest' || mode === 'result') && meetingFace(now)) sayFound(now);
     else if (mode === 'rest' || mode === 'result') step(now);
   }
 
@@ -373,8 +389,8 @@ export function createWrist({ key }) {
       result(now, 'NOT SENT');
       if (link.up) { out.push('DROP'); closed(now); }
       if (fromQuiet) { quiet.pending = true; quiet.sent = false; }
-    } else if (mode === 'waveback' && now - sentAt >= CONFIRM_MS) {
-      // As for a choice: NOT SENT, and the socket dropped, so a wave stuck in it can no longer land.
+    } else if ((mode === 'waveback' || mode === 'found') && now - sentAt >= CONFIRM_MS) {
+      // As for a choice: NOT SENT, and the socket dropped, so a wave or a found stuck in it can no longer land.
       result(now, 'NOT SENT');
       if (link.up) { out.push('DROP'); closed(now); }
     } else if (mode === 'result' && now >= resultUntil) rest();
@@ -483,6 +499,14 @@ export function createWrist({ key }) {
       }
       return;
     }
+    // The relay's answer to a found. Taken: the face rests, and FOUND: WAITING, or the found itself, comes as a show.
+    if (m.t === 'found' && typeof m.ok === 'boolean') {
+      if (mode === 'found') {
+        if (m.ok) rest();
+        else result(now, 'NOT SENT');
+      }
+      return;
+    }
     if (m.t !== 'show' || !m.show || typeof m.show !== 'object') return;
     const was = show;
     const wasSilent = silent;
@@ -560,7 +584,11 @@ export function createWrist({ key }) {
     if (s.kind === 'pairing') big = s.code;
     else if (s.kind === 'check') { big = s.big; small = 'ON YOUR PHONE?'; }
     else if (s.kind === 'waiting') { big = 'OPEN YOUR PHONE'; small = 'OR SWITCH ME OFF'; }
-    else if (lit(s)) { big = s.big; small = s.small.toUpperCase(); }
+    else if (lit(s)) {
+      big = s.big;
+      // Woken, the meeting face says what a SIDE hold does there.
+      small = s.kind === 'meet' && awake && s.small === 'MEET' ? 'HOLD SIDE: FOUND' : s.small.toUpperCase();
+    }
     else if (s.kind === 'off' && awake) {
       if (offline) ({ big, small } = noSignal());
       else if (s.quiet) { big = 'NOT NOW'; small = pct(); }
@@ -602,6 +630,8 @@ export function createWrist({ key }) {
       f = words('SOMEONE WAVED', waves.n > 1 ? count + ' WAITING - HOLD SIDE' : 'HOLD SIDE: WAVE BACK', 'black', 'hi', LIGHT_AWAKE);
     } else if (mode === 'waveback') {
       f = words('WAVE BACK', 'SENDING', 'black', 'hi', LIGHT_AWAKE);
+    } else if (mode === 'found') {
+      f = { ...restFace(now, true), small: 'SENDING' };  // the meeting face, while its found is on the way
     } else {
       f = restFace(now, wakeUntil > now || mode === 'result');
       if (mode === 'result') f = { ...f, small: word };
````

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -743,7 +743,9 @@ inline Words wordsFor(const Face& f, bool awake, int battery, Signal signal) {
   if (s.kind == "pairing") return {s.code, ""};
   if (s.kind == "check") return {s.big, "ON YOUR PHONE?"};
   if (s.kind == "waiting") return {"OPEN YOUR PHONE", "OR SWITCH ME OFF"};
-  if (lit(s)) return {fold(s.big), upper(fold(s.small))};
+  // Woken, the meeting face says what a SIDE hold does there.
+  if (lit(s))
+    return {fold(s.big), s.kind == "meet" && awake && s.small == "MEET" ? "HOLD SIDE: FOUND" : upper(fold(s.small))};
   if (s.kind != "off" || !awake) return {};
   if (f.offline) {
     const std::string why = signal == Signal::NO_WIFI ? "NO WI-FI" : "NO RELAY";
@@ -1273,6 +1275,14 @@ class Wrist {
       }
       return;
     }
+    // The relay's answer to a found. Taken: the face rests, and FOUND: WAITING, or the found itself, comes as a show.
+    if (f.t == "found" && f.hasOk) {
+      if (mode_ == FOUND) {
+        if (f.ok) rest();
+        else result(now, "NOT SENT");
+      }
+      return;
+    }
     if (f.t != "show" || !f.hasShow) return;
     // Reactions come from changes; a show that differs only in its sound switch is no change.
     const bool same = haveShow_ && show_ == f.show;
@@ -1412,8 +1422,8 @@ class Wrist {
       }
       // Hiding may arrive late; showing may not. Leaving NOT NOW failed, so hold it again.
       if (fromQuiet_) quiet_.held();
-    } else if (mode_ == WAVEBACK && now - sentAt_ >= CONFIRM_MS) {
-      // As for a choice: NOT SENT, and the socket dropped, so a wave stuck in it can no longer land.
+    } else if ((mode_ == WAVEBACK || mode_ == FOUND) && now - sentAt_ >= CONFIRM_MS) {
+      // As for a choice: NOT SENT, and the socket dropped, so a wave or a found stuck in it can no longer land.
       result(now, "NOT SENT");
       if (link_.up()) {
         out_.push_back("DROP");
@@ -1444,6 +1454,9 @@ class Wrist {
                 LIGHT_AWAKE);
     } else if (mode_ == WAVEBACK) {
       f = words("WAVE BACK", "SENDING", "black", "hi", LIGHT_AWAKE);
+    } else if (mode_ == FOUND) {
+      f = restFace(now, true);  // the meeting face, while its found is on the way
+      f.small = "SENDING";
     } else {
       f = restFace(now, static_cast<int32_t>(wakeUntil_ - now) > 0 || mode_ == RESULT);
       if (mode_ == RESULT) f.small = word_;
@@ -1477,7 +1490,7 @@ class Wrist {
   }
 
  private:
-  enum Mode { REST, LOOK, CHOOSING, SENDING, RESULT, WAVES, WAVEBACK };
+  enum Mode { REST, LOOK, CHOOSING, SENDING, RESULT, WAVES, WAVEBACK, FOUND };
   struct Key {
     bool down = false;
     bool fired = false;
@@ -1614,6 +1627,13 @@ class Wrist {
     return !link_.stale(now) && !quiet_.dark() && haveShow_ && (show_.kind == "pairing" || show_.kind == "check");
   }
 
+  /** A meeting's number on the face, believed and not under NOT NOW: a SIDE hold there says found. A number is two digits. */
+  bool meetingFace(uint32_t now) const {
+    const std::string& n = show_.big;
+    const bool number = n.size() == 2 && n[0] >= '1' && n[0] <= '9' && n[1] >= '0' && n[1] <= '9';
+    return haveShow_ && show_.kind == "meet" && number && !link_.stale(now) && !quiet_.dark();
+  }
+
   /** A press shows the face for WAKE_MS; the waiting face, which sleeps, stays lit PAIR_AWAKE_MS from it. */
   void wake(uint32_t now) {
     wakeUntil_ = now + WAKE_MS;
@@ -1732,6 +1752,18 @@ class Wrist {
     react("double");
   }
 
+  /** A SIDE hold on the meeting face: the two of them found each other. Out of reach, NOT SENT at once. */
+  void sayFound(uint32_t now) {
+    if (!link_.up()) {
+      result(now, "NOT SENT");
+      return;
+    }
+    out_.push_back("{\"t\":\"found\",\"number\":\"" + show_.big + "\"}");
+    mode_ = FOUND;
+    sentAt_ = now;
+    react("double");
+  }
+
   /** A KEY2 press let go before HOLD_MS. */
   void step(uint32_t now) {
     if (k1_.down || frozen_ || mode_ == SENDING || mode_ == WAVEBACK) return;
@@ -1763,6 +1795,7 @@ class Wrist {
     if (mode_ == CHOOSING) commit(now, true);
     else if (mode_ == WAVES) waveBack(now);
     else if (mode_ == LOOK) stepAt_ = now;
+    else if ((mode_ == REST || mode_ == RESULT) && meetingFace(now)) sayFound(now);
     else if (mode_ == REST || mode_ == RESULT) step(now);
   }
````

- [ ] **Step 4: Run** — the table (`wrist.js` 93 pass; `firmware.test.js` 101 pass), then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 370`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`. Run the C++ half in the background. "The hint asleep too" turns thirteen cases red: every one that shows a meeting face not woken and expects `MEET`.

````json
[
 {
  "label": "a SIDE hold on the meeting face opens a look",
  "file": "app/lib/wrist.js",
  "from": "    else if ((mode === 'rest' || mode === 'result') && meetingFace(now)) sayFound(now);\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a SIDE hold on the resting meeting face says found",
   "wrist.js: out of reach, a SIDE hold on the meeting face",
   "wrist.js: a found with no answer in CONFIRM_MS",
   "wrist.js: a found refused shows NOT SENT"
  ]
 },
 {
  "label": "found only from rest, not over a result",
  "file": "app/lib/wrist.js",
  "from": "(mode === 'rest' || mode === 'result') && meetingFace(now)",
  "to": "mode === 'rest' && meetingFace(now)",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a found refused shows NOT SENT"
  ]
 },
 {
  "label": "found under NOT NOW not yet heard",
  "file": "app/lib/wrist.js",
  "from": "&& !stale(now) && !quiet.pending;\n",
  "to": "&& !stale(now);\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: in NOT NOW before the relay has heard it"
  ]
 },
 {
  "label": "found on a show no longer believed",
  "file": "app/lib/wrist.js",
  "from": "/.test(show.big) && !stale(now) && !quiet.pending",
  "to": "/.test(show.big) && !quiet.pending",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: out of reach, a SIDE hold on the meeting face"
  ]
 },
 {
  "label": "any big is a number",
  "file": "app/lib/wrist.js",
  "from": "show?.kind === 'meet' && /^[1-9][0-9]$/.test(show.big) && ",
  "to": "show?.kind === 'meet' && ",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a meeting number that is not two digits"
  ]
 },
 {
  "label": "sent with the link down",
  "file": "app/lib/wrist.js",
  "from": "    if (!link.up) { result(now, 'NOT SENT'); return; }\n    send({ t: 'found'",
  "to": "    send({ t: 'found'",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: out of reach, a SIDE hold on the meeting face"
  ]
 },
 {
  "label": "no double tick",
  "file": "app/lib/wrist.js",
  "from": "    mode = 'found';\n    sentAt = now;\n    react('double');",
  "to": "    mode = 'found';\n    sentAt = now;",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a SIDE hold on the resting meeting face says found",
   "wrist.js: a found with no answer in CONFIRM_MS",
   "wrist.js: a found refused shows NOT SENT"
  ]
 },
 {
  "label": "a found waits for ever",
  "file": "app/lib/wrist.js",
  "from": "(mode === 'waveback' || mode === 'found') && now - sentAt",
  "to": "mode === 'waveback' && now - sentAt",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a found with no answer in CONFIRM_MS"
  ]
 },
 {
  "label": "a refusal reads as taken",
  "file": "app/lib/wrist.js",
  "from": "if (m.ok) rest();\n        else result(now, 'NOT SENT');",
  "to": "rest();",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a found refused shows NOT SENT"
  ]
 },
 {
  "label": "an answer counts with no found under way",
  "file": "app/lib/wrist.js",
  "from": "      if (mode === 'found') {",
  "to": "      if (true) {",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a found refused shows NOT SENT"
  ]
 },
 {
  "label": "an answer of the wrong shape counts",
  "file": "app/lib/wrist.js",
  "from": "if (m.t === 'found' && typeof m.ok === 'boolean')",
  "to": "if (m.t === 'found')",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a found refused shows NOT SENT"
  ]
 },
 {
  "label": "no hint",
  "file": "app/lib/wrist.js",
  "from": "s.kind === 'meet' && awake && s.small === 'MEET' ? 'HOLD SIDE: FOUND'",
  "to": "false ? 'HOLD SIDE: FOUND'",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: woken, the meeting face says HOLD SIDE: FOUND"
  ]
 },
 {
  "label": "the hint asleep too",
  "file": "app/lib/wrist.js",
  "from": "s.kind === 'meet' && awake && s.small === 'MEET' ?",
  "to": "s.kind === 'meet' && s.small === 'MEET' ?",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a meeting number calls; the first press answers it",
   "wrist.js: a meeting number plays jingle and blinks its face",
   "wrist.js: a call waits for a choice, and for the result on the face",
   "wrist.js: NOT NOW from the phone ends a call and forgets its number",
   "wrist.js: a FACE hold into NOT NOW ends a call",
   "wrist.js: a warning's flash covers a call's blink",
   "wrist.js: while a meeting calls, a FACE press only answers it",
   "wrist.js: a SIDE hold in the wave face waves back to the newest",
   "wrist.js: a SIDE hold on the resting meeting face says found",
   "wrist.js: woken, the meeting face says HOLD SIDE: FOUND",
   "wrist.js: a SIDE press on the meeting face still opens the chooser",
   "wrist.js: out of reach, a SIDE hold on the meeting face",
   "wrist.js: a found refused shows NOT SENT"
  ]
 },
 {
  "label": "the hint over FOUND: WAITING",
  "file": "app/lib/wrist.js",
  "from": "s.kind === 'meet' && awake && s.small === 'MEET' ?",
  "to": "s.kind === 'meet' && awake ?",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: woken, the meeting face says HOLD SIDE: FOUND"
  ]
 },
 {
  "label": "no SENDING while it goes",
  "file": "app/lib/wrist.js",
  "from": "f = { ...restFace(now, true), small: 'SENDING' };",
  "to": "f = restFace(now, true);",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a SIDE hold on the resting meeting face says found",
   "wrist.js: a found with no answer in CONFIRM_MS",
   "wrist.js: a found refused shows NOT SENT"
  ]
 },
 {
  "label": "C++: a SIDE hold on the meeting face opens a look",
  "file": "firmware/src/band_logic.h",
  "from": "    else if ((mode_ == REST || mode_ == RESULT) && meetingFace(now)) sayFound(now);\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a SIDE hold on the resting meeting face says found",
   "band_logic.h: out of reach, a SIDE hold on the meeting face",
   "band_logic.h: a found with no answer in CONFIRM_MS",
   "band_logic.h: a found refused shows NOT SENT"
  ]
 },
 {
  "label": "C++: found under NOT NOW not yet heard",
  "file": "firmware/src/band_logic.h",
  "from": "number && !link_.stale(now) && !quiet_.dark();",
  "to": "number && !link_.stale(now);",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: in NOT NOW before the relay has heard it"
  ]
 },
 {
  "label": "C++: any big is a number",
  "file": "firmware/src/band_logic.h",
  "from": "show_.kind == \"meet\" && number && ",
  "to": "show_.kind == \"meet\" && (number || true) && ",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a meeting number that is not two digits"
  ]
 },
 {
  "label": "C++: sent with the link down",
  "file": "firmware/src/band_logic.h",
  "from": "    if (!link_.up()) {\n      result(now, \"NOT SENT\");\n      return;\n    }\n    out_.push_back(\"{\\\"t\\\":\\\"found\\\"",
  "to": "    out_.push_back(\"{\\\"t\\\":\\\"found\\\"",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: out of reach, a SIDE hold on the meeting face"
  ]
 },
 {
  "label": "C++: a found waits for ever",
  "file": "firmware/src/band_logic.h",
  "from": "(mode_ == WAVEBACK || mode_ == FOUND) && now",
  "to": "mode_ == WAVEBACK && now",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a found with no answer in CONFIRM_MS"
  ]
 },
 {
  "label": "C++: an answer counts with no found under way",
  "file": "firmware/src/band_logic.h",
  "from": "      if (mode_ == FOUND) {",
  "to": "      if (true) {",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a found refused shows NOT SENT"
  ]
 },
 {
  "label": "C++: no hint",
  "file": "firmware/src/band_logic.h",
  "from": "s.kind == \"meet\" && awake && s.small == \"MEET\" ? \"HOLD SIDE: FOUND\"",
  "to": "false ? \"HOLD SIDE: FOUND\"",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: woken, the meeting face says HOLD SIDE: FOUND"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add app/lib/wrist.js firmware/src/band_logic.h tests/fixtures/wrist-cases.json
```

````bash
git commit -F - <<'EOF'
A side hold on the meeting face says found

On the resting meeting face, a two-digit number believed and not under a
NOT NOW the relay has yet to hear, a SIDE hold sends {t:'found', number}
with the double tick and shows SENDING over the number until the relay
answers: taken, the face rests; refused, or nothing in CONFIRM_MS (the
socket dropped), NOT SENT with low and orange. With the link down it is
NOT SENT at once and nothing is sent. A SIDE press still opens the
chooser, and the key that answers a call does nothing else. Woken, the
meeting face says HOLD SIDE: FOUND; FOUND: WAITING stays as it is. Both
twins, on eight new cases of the shared table.

Mutation-checked: 22 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 5: Found by both, the band plays it once, in the meeting's card

**Files:**
- Modify: `app/lib/wrist.js`, `firmware/src/band_logic.h`
- Test: `tests/fixtures/wrist-cases.json`

**Interfaces:**
- Consumes: Task 2's `found: { n, intent }` on a show; `react()`, `personal()`, `SOUNDS`, `FLASHES`, `CARD_WORDS` (JS) and `hueFor()` (C++); `readFrame()` and `Frame` in `band_logic.h`.
- Produces: `SOUNDS.found` and `FLASHES.found` in both tables. JS `readFound(show)` → `{ n, intent }`: `n` a whole number or 0, `intent` one of the three cards or `''`. C++ `struct Found { int64_t n; std::string intent; }` and `Frame::found`, read the same way (an `intent` that is not a card is cleared), apart from the `Show` so that a show differing only in its found is no change. The wrist keeps `foundPlayed` (`foundPlayed_`): a show whose found number is not it plays `found` with the `found` flash in the found's card (white for none) as a call (class 1, after a meeting's jingle, before a wave's hello) and remembers it; a show about the person that names no found forgets it. NOT NOW plays nothing and forgets nothing: the check comes after the wrist's `if (silent) return`.

- [ ] **Step 1: Write the failing cases.** Four: found by both plays `found` and flashes the meeting's card (`song`, not the armed `hi`) three times, 200 on and 150 off, and the same number on the next show, or after a reconnect, plays nothing; a show about the person that names no found lets the same number play again, a new number plays at once, and the test light (not about the person) and NOT NOW let nothing play twice; in NOT NOW a found plays nothing, and out of it, while the relay still names it, it plays; and a found without a whole number plays nothing, while one whose card is not a card (`red`) flashes white.

Append to `tests/fixtures/wrist-cases.json`:

````diff
--- a/tests/fixtures/wrist-cases.json
+++ b/tests/fixtures/wrist-cases.json
@@ -1319,6 +1319,62 @@
         { "at": "5100", "key2": "down" },
         { "at": "5100+HOLD_MS", "face": { "big": "NOT NOW", "small": "SIDE TO CHANGE" } }
       ]
+    },
+    {
+      "name": "found by both plays found and flashes the meeting's card three times, 200 on and 150 off; the same number again, after a reconnect too, plays nothing",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "2000", "press": 1 },
+        { "at": "3000", "show": "HI", "rev": 3, "with": { "found": { "n": 27, "intent": "song" } }, "sounds": ["found"], "face": { "big": "", "field": "song", "light": "LIGHT_FULL" } },
+        { "at": "3199", "face": { "big": "", "field": "song", "light": "LIGHT_FULL" } },
+        { "at": "3200", "face": { "big": "HI :)", "light": "LIGHT_OFF" } },
+        { "at": "3350", "face": { "big": "", "field": "song", "light": "LIGHT_FULL" } },
+        { "at": "3800", "face": { "big": "", "field": "song", "light": "LIGHT_FULL" } },
+        { "at": "3900", "face": { "big": "HI :)", "light": "LIGHT_OFF" } },
+        { "at": "4050", "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "5000", "show": "HI", "rev": 4, "with": { "found": { "n": 27, "intent": "song" } } },
+        { "at": "6000", "link": "down" },
+        { "at": "7000", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "7100", "show": "HI", "rev": 4, "with": { "found": { "n": 27, "intent": "song" } }, "face": { "big": "HI :)", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "a show about the person that names no found lets the same number play again; a new number plays at once; the test light and NOT NOW let nothing play twice",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "found": { "n": 27, "intent": "song" } }, "sounds": ["found"] },
+        { "at": "2000", "show": "HI", "rev": 3 },
+        { "at": "3000", "show": "HI", "rev": 3, "with": { "found": { "n": 27, "intent": "dance" } }, "sounds": ["found"], "face": { "big": "", "field": "dance" } },
+        { "at": "5000", "show": "HI", "rev": 3, "with": { "found": { "n": 41, "intent": "hi" } }, "sounds": ["found"], "face": { "big": "", "field": "hi" } },
+        { "at": "7000", "show": "TEST", "sounds": ["up"] },
+        { "at": "8000", "show": "HI", "rev": 3, "with": { "found": { "n": 41, "intent": "hi" } } },
+        { "at": "9000", "show": "QUIET", "rev": 4 },
+        { "at": "10000", "show": "HI", "rev": 5, "with": { "found": { "n": 41, "intent": "hi" } }, "face": { "big": "HI :)", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "in NOT NOW a found plays nothing; out of it, while the relay still names it, it plays",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "key1": "down", "sounds": ["tick"] },
+        { "at": "1000+HOLD_MS", "sounds": ["down"], "sent": [{ "t": "hold" }], "face": { "big": "", "light": "LIGHT_OFF" } },
+        { "at": "3000", "key1": "up" },
+        { "at": "3100", "show": "HI", "rev": 3, "with": { "found": { "n": 27, "intent": "song" } }, "face": { "big": "", "light": "LIGHT_OFF" } },
+        { "at": "3200", "show": "QUIET", "rev": 4 },
+        { "at": "5000", "show": "HI", "rev": 5, "with": { "found": { "n": 27, "intent": "song" } }, "sounds": ["found"], "face": { "big": "", "field": "song", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "a found without a whole number plays nothing, and one whose card is not a card flashes white",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "found": { "intent": "song" } } },
+        { "at": "1000", "show": "HI", "rev": 3, "with": { "found": { "n": "27", "intent": "song" } } },
+        { "at": "2000", "show": "HI", "rev": 3, "with": { "found": 27 } },
+        { "at": "3000", "show": "HI", "rev": 3, "with": { "found": { "n": 27, "intent": "red" } }, "sounds": ["found"], "face": { "big": "", "field": "white", "light": "LIGHT_FULL" } }
+      ]
     }
   ]
 }
````

- [ ] **Step 2: Run the table and watch it fail**

Run: `node --test tests/wrist.test.js tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: all four cases red on each twin (`wrist.js: 93 pass, 4 fail`), each first at a show carrying a found (`sounds`); `firmware.test.js` also turns *the firmware and the stand-in play the same notes and the same flashes* red once the JS tables have `found` and the C++ ones do not yet (`100 pass, 5 fail`).

- [ ] **Step 3: Implement in both twins.**

In `app/lib/wrist.js`:

````diff
--- a/app/lib/wrist.js
+++ b/app/lib/wrist.js
@@ -25,6 +25,8 @@
 // A SIDE hold on the meeting face says the two of you found each other
 // (docs/superpowers/specs/2026-09-26-wrist-found-design.md). The relay counts
 // it only once both have said it; until then the face says FOUND: WAITING.
+// Found by both, both bands play the found chirp and flash the meeting's card
+// three times, once for each number.
 
 import { bandIdOf } from './sha256.js';
 
@@ -72,9 +74,13 @@ export const SOUNDS = {
   jingle: [[1319, 80], [1568, 80], [2637, 80], [2093, 80], [2349, 80], [3136, 200]],
   warn: [[880, 150], [698, 150], [880, 150], [698, 150]],
   hello: [[1568, 60], [2093, 120]],
+  found: [[1568, 70], [2093, 70], [2637, 70], [0, 40], [2637, 70], [3136, 220]],
 };
 
-/** Every flash: its colour, then count × on / off ms. `card` is the card chosen, white for OFF. band_logic.h FLASHES. */
+/**
+ * Every flash: its colour, then count × on / off ms. `card` is the card chosen, or the meeting's for found; white
+ * for OFF or none. band_logic.h FLASHES.
+ */
 export const FLASHES = {
   set: { colour: 'card', count: 2, on: 150, off: 100 },
   changed: { colour: 'red', count: 3, on: 120, off: 90 },
@@ -82,6 +88,7 @@ export const FLASHES = {
   warn: { colour: 'orange', count: 2, on: 350, off: 250 },
   check: { colour: 'white', count: 2, on: 150, off: 100 },
   wave: { colour: 'hi', count: 3, on: 500, off: 500 },
+  found: { colour: 'card', count: 3, on: 200, off: 150 },
 };
 
 /**
@@ -113,6 +120,13 @@ function readWaves(s) {
   return { ref, n: Number.isInteger(w.n) ? w.n : 0, seq: Number.isInteger(w.seq) ? w.seq : 0 };
 }
 
+/** A show's found, read apart from the show, as band_logic.h readFrame() reads it: a whole number, and a card or none. */
+function readFound(s) {
+  const f = s.found && typeof s.found === 'object' ? s.found : {};
+  const card = typeof f.intent === 'string' && Object.hasOwn(CARD_WORDS, f.intent) ? f.intent : '';
+  return { n: Number.isInteger(f.n) ? f.n : 0, intent: card };
+}
+
 const lit = (s) => LIT.includes(s.kind) && !!CARD_WORDS[s.intent];
 const words = (big, small, field, ink, light) => ({ big, small, field, ink, light, bar: -1, code: '' });
 
@@ -151,6 +165,8 @@ export function createWrist({ key }) {
   let waves = readWaves({});
   let waveSeq = 0;
   let waveOwed = false;
+  // Found by both (found §2): the number last played for, until a show about the person names none.
+  let foundPlayed = 0;
   // Rule 5: the letters and the waiting face sleep. Until when they are lit, which letters lit them, when
   // waiting began, and until when a press says where to go.
   let litUntil = 0;
@@ -176,8 +192,8 @@ export function createWrist({ key }) {
   const pct = () => (battery >= 0 ? battery + '%' : '');
 
   /**
-   * A reaction of this moment. cls: 0 a key or a result, 1 a call, 2 a warning. `card`: the colour a `set` flash
-   * takes. A wave's flashes play whole: a key does not end them.
+   * A reaction of this moment. cls: 0 a key or a result, 1 a call, 2 a warning. `card`: the colour a `set` or
+   * `found` flash takes. A wave's flashes play whole: a key does not end them.
    */
   function react(sound, flash = null, cls = 0, card = '') {
     const f = flash ? FLASHES[flash] : null;
@@ -512,6 +528,7 @@ export function createWrist({ key }) {
     const wasSilent = silent;
     show = readShow(m.show);
     waves = readWaves(m.show);
+    const found = readFound(m.show);
     // Reactions come from changes; a show that differs only in `sound` is no change.
     const same = !!was && JSON.stringify(was) === JSON.stringify(show);
     // A show's own switch counts for what it causes. One that is not true or false is not said.
@@ -570,6 +587,12 @@ export function createWrist({ key }) {
         callAt = now;
       }
     }
+    // Found by both (found §2): a number not yet played for plays once, in the meeting's card. A show about the
+    // person that names none is past FOUND_SHOW_MS, and the same number may then play for another meeting.
+    if (found.n && found.n !== foundPlayed) {
+      foundPlayed = found.n;
+      react('found', 'found', 1, found.intent);
+    } else if (!found.n && personal()) foundPlayed = 0;
     // After a meeting's jingle. A wave call already under way takes the new wave in; the open wave face counts it.
     if (newer && !waveCalling() && mode !== 'waves') callWave();
   }
````

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -79,6 +79,7 @@ constexpr Note ASK[] = {{1319, 80}, {0, 50}, {1760, 160}};
 constexpr Note JINGLE[] = {{1319, 80}, {1568, 80}, {2637, 80}, {2093, 80}, {2349, 80}, {3136, 200}};
 constexpr Note WARN[] = {{880, 150}, {698, 150}, {880, 150}, {698, 150}};
 constexpr Note HELLO[] = {{1568, 60}, {2093, 120}};
+constexpr Note FOUND[] = {{1568, 70}, {2093, 70}, {2637, 70}, {0, 40}, {2637, 70}, {3136, 220}};
 template <size_t N>
 constexpr Sound sound(const char* name, const Note (&notes)[N]) { return {name, notes, N}; }
 }  // namespace detail
@@ -87,7 +88,7 @@ constexpr Sound SOUNDS[] = {
     detail::sound("tick", detail::TICK),     detail::sound("double", detail::DOUBLE), detail::sound("down", detail::DOWN),
     detail::sound("up", detail::UP),         detail::sound("fall", detail::FALL),     detail::sound("low", detail::LOW_TONE),
     detail::sound("ask", detail::ASK),       detail::sound("jingle", detail::JINGLE), detail::sound("warn", detail::WARN),
-    detail::sound("hello", detail::HELLO),
+    detail::sound("hello", detail::HELLO),   detail::sound("found", detail::FOUND),
 };
 
 inline const Sound* soundFor(const std::string& name) {
@@ -151,7 +152,7 @@ inline size_t render(const std::string& name, uint8_t* out, size_t cap) {
   return n;
 }
 
-/** A flash: its colour, then count × on / off ms. "card" is the card chosen, white for OFF. */
+/** A flash: its colour, then count × on / off ms. "card" is the card chosen, or the meeting's for found; white for none. */
 struct Flash {
   const char* name;
   const char* colour;
@@ -162,6 +163,7 @@ struct Flash {
 constexpr Flash FLASHES[] = {
     {"set", "card", 2, 150, 100},       {"changed", "red", 3, 120, 90}, {"notsent", "orange", 2, 350, 250},
     {"warn", "orange", 2, 350, 250},    {"check", "white", 2, 150, 100},   {"wave", "hi", 3, 500, 500},
+    {"found", "card", 3, 200, 150},
 };
 
 inline const Flash* flashFor(const std::string& name) {
@@ -492,12 +494,19 @@ struct Waves {
   int64_t seq = 0;  // the relay's clock in ms when the wave was made: past 32 bits
 };
 
+/** A meeting its person and their match both said they found: its number, and its card or none. */
+struct Found {
+  int64_t n = 0;
+  std::string intent;
+};
+
 struct Frame {
   std::string t;
   bool hasShow = false;
   Show show;
   int sound = -1;          // the show's sound switch: 1 on, 0 off, -1 not said (so not part of the Show)
   Waves waves;             // the show's waves, nobody unless said (so not part of the Show either)
+  Found found;             // the show's found, none unless said (nor this)
   std::string why;
   bool hasOk = false;      // {t:'set', ok:false, why}: the relay refused a choice
   bool ok = true;
@@ -589,6 +598,22 @@ inline bool readFrame(const std::string& text, Frame& f) {
           return true;
         });
       }
+      if (k == "found") {
+        if (!r.peek('{')) return r.skip();
+        return r.object([&](const std::string& w) {
+          if (w == "intent") {
+            if (!text_(f.found.intent, 16)) return false;
+            if (!hueFor(f.found.intent)) f.found.intent.clear();  // a card, or none: the flash is white
+            return true;
+          }
+          if (w != "n") return r.skip();
+          int64_t v = 0;
+          bool whole = false;
+          if (!r.integer(v, whole)) return r.skip();
+          f.found.n = whole ? v : 0;
+          return true;
+        });
+      }
       return r.skip();
     });
     if (s.kind.empty()) s.kind = "off";
@@ -1368,6 +1393,14 @@ class Wrist {
         callAt_ = now;
       }
     }
+    // Found by both (found §2): a number not yet played for plays once, in the meeting's card. A show about the
+    // person that names none is past FOUND_SHOW_MS, and the same number may then play for another meeting.
+    if (f.found.n && f.found.n != foundPlayed_) {
+      foundPlayed_ = f.found.n;
+      react("found", "found", 1, f.found.intent);
+    } else if (!f.found.n && personal()) {
+      foundPlayed_ = 0;
+    }
     // After a meeting's jingle. A wave call already under way takes the new wave in; the open wave face counts it.
     if (newer && !waveCalling() && mode_ != WAVES) callWave();
   }
@@ -1507,7 +1540,7 @@ class Wrist {
     uint32_t at = 0, until = 0;
   };
 
-  /** A reaction of this moment. `card`: the colour a "set" flash takes. */
+  /** A reaction of this moment. `card`: the colour a "set" or "found" flash takes. */
   void react(const char* sound, const char* flash = nullptr, int cls = 0, const std::string& card = "") {
     Reaction r;
     r.sound = sound;
@@ -1829,6 +1862,8 @@ class Wrist {
   Waves waves_;
   int64_t waveSeq_ = 0;
   bool waveOwed_ = false;
+  // Found by both (found §2): the number last played for, until a show about the person names none.
+  int64_t foundPlayed_ = 0;
   // Rule 5: the letters and the waiting face sleep. Until when they are lit, which letters lit them, when
   // waiting began, and until when a press says where to go.
   uint32_t litUntil_ = 0;
````

- [ ] **Step 4: Run** — the table (`wrist.js` 97 pass; `firmware.test.js` 105 pass), then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 378`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "found plays nothing",
  "file": "app/lib/wrist.js",
  "from": "      foundPlayed = found.n;\n      react('found', 'found', 1, found.intent);",
  "to": "      foundPlayed = found.n;",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: found by both plays found",
   "wrist.js: a show about the person that names no found",
   "wrist.js: in NOT NOW a found plays nothing",
   "wrist.js: a found without a whole number"
  ]
 },
 {
  "label": "the same number plays again",
  "file": "app/lib/wrist.js",
  "from": "if (found.n && found.n !== foundPlayed)",
  "to": "if (found.n)",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: found by both plays found",
   "wrist.js: a show about the person that names no found"
  ]
 },
 {
  "label": "the number is never forgotten",
  "file": "app/lib/wrist.js",
  "from": "    } else if (!found.n && personal()) foundPlayed = 0;",
  "to": "    }",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a show about the person that names no found"
  ]
 },
 {
  "label": "any show forgets the number",
  "file": "app/lib/wrist.js",
  "from": "} else if (!found.n && personal()) foundPlayed = 0;",
  "to": "} else if (!found.n) foundPlayed = 0;",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a show about the person that names no found"
  ]
 },
 {
  "label": "the flash in the show's card, not the meeting's",
  "file": "app/lib/wrist.js",
  "from": "react('found', 'found', 1, found.intent);",
  "to": "react('found', 'found', 1, show.intent);",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: found by both plays found",
   "wrist.js: a show about the person that names no found",
   "wrist.js: in NOT NOW a found plays nothing",
   "wrist.js: a found without a whole number"
  ]
 },
 {
  "label": "any string is a card",
  "file": "app/lib/wrist.js",
  "from": "typeof f.intent === 'string' && Object.hasOwn(CARD_WORDS, f.intent) ? f.intent : ''",
  "to": "typeof f.intent === 'string' ? f.intent : ''",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a found without a whole number"
  ]
 },
 {
  "label": "a number need not be whole",
  "file": "app/lib/wrist.js",
  "from": "return { n: Number.isInteger(f.n) ? f.n : 0, intent: card };",
  "to": "return { n: f.n ? f.n : 0, intent: card };",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a found without a whole number"
  ]
 },
 {
  "label": "C++: found plays nothing",
  "file": "firmware/src/band_logic.h",
  "from": "      foundPlayed_ = f.found.n;\n      react(\"found\", \"found\", 1, f.found.intent);",
  "to": "      foundPlayed_ = f.found.n;",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: found by both plays found",
   "band_logic.h: a show about the person that names no found",
   "band_logic.h: in NOT NOW a found plays nothing",
   "band_logic.h: a found without a whole number"
  ]
 },
 {
  "label": "C++: the number is never forgotten",
  "file": "firmware/src/band_logic.h",
  "from": "    } else if (!f.found.n && personal()) {\n      foundPlayed_ = 0;\n    }",
  "to": "    }",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a show about the person that names no found"
  ]
 },
 {
  "label": "C++: any string is a card",
  "file": "firmware/src/band_logic.h",
  "from": "            if (!hueFor(f.found.intent)) f.found.intent.clear();  // a card, or none: the flash is white\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a found without a whole number"
  ]
 },
 {
  "label": "C++: the flash in the show's card, not the meeting's",
  "file": "firmware/src/band_logic.h",
  "from": "react(\"found\", \"found\", 1, f.found.intent);",
  "to": "react(\"found\", \"found\", 1, show_.intent);",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: found by both plays found",
   "band_logic.h: a show about the person that names no found",
   "band_logic.h: in NOT NOW a found plays nothing",
   "band_logic.h: a found without a whole number"
  ]
 },
 {
  "label": "C++: the found notes differ from the stand-in's",
  "file": "firmware/src/band_logic.h",
  "from": "{0, 40}, {2637, 70}, {3136, 220}};",
  "to": "{0, 40}, {2637, 70}, {3136, 200}};",
  "test": "tests/firmware.test.js",
  "expect": [
   "the firmware and the stand-in play the same notes and the same flashes"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add app/lib/wrist.js firmware/src/band_logic.h tests/fixtures/wrist-cases.json
```

````bash
git commit -F - <<'EOF'
Found by both, the band plays it once, in the meeting's card

A show that names a found (its number and the meeting's card) plays the
found chirp and flashes that card three times, 200 on and 150 off, once
for each number: the same number again, a reconnect's show included,
plays nothing, and a show about the person that names none lets the same
number play for a later meeting. NOT NOW plays nothing and forgets
nothing. A found without a whole number is none; a card that is not a
card flashes white. SOUNDS.found and FLASHES.found join both tables.

Mutation-checked: 12 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 6: The band's console says found

**Files:**
- Modify: `firmware/src/band_logic.h`
- Test: `firmware/host/logic_test.cpp`

**Interfaces:**
- Consumes: Task 4's found frame and answers; Task 5's `Frame::found`; `saidLine()` and `heardLine()` in `band_logic.h`, which `main.cpp` prints on the USB console.
- Produces: `saidLine()` says `found, from the wrist` for a frame that starts `{"t":"found"`. `heardLine()` says `the relay took the found`, or `the relay did not take the found: <why>`; a meeting show whose small line is `FOUND: WAITING` reads `meet 42 (found: waiting)`, and a show that names a found gains ` (found 42)`, before any waiting count. As before, a show is said only when what it says changed, and never a secret or who waved. Task 10 watches the real bands through these lines.

- [ ] **Step 1: Write the failing checks.** In `console()`: what the wrist says for a found; the meeting said on this side only; a show that names a found, said once; the relay taking a found, and refusing one.

In `firmware/host/logic_test.cpp`:

````diff
--- a/firmware/host/logic_test.cpp
+++ b/firmware/host/logic_test.cpp
@@ -460,6 +460,7 @@ void console() {
   CHECK(saidLine("{\"t\":\"set\",\"intent\":\"hi\",\"basis\":7}") == "a choice from the wrist: HI :)");
   CHECK(saidLine("{\"t\":\"set\",\"intent\":null,\"basis\":7}") == "a choice from the wrist: OFF");
   CHECK(saidLine("{\"t\":\"wave\",\"ref\":\"a1b2c3d4e5\",\"basis\":7}") == "a wave back from the wrist");
+  CHECK(saidLine("{\"t\":\"found\",\"number\":\"27\"}") == "found, from the wrist");
 
   std::string shown;
   const auto heard = [&shown](const std::string& text) {
@@ -489,6 +490,13 @@ void console() {
   const std::string two = heard(hi + ",\"waves\":{\"ref\":\"a1b2c3d4e5\",\"n\":2,\"seq\":1790337603000}}}");
   CHECK(two == "the relay shows: hi (2 waiting)" && two.find("a1b2") == std::string::npos);
   CHECK(heard(hi + ",\"waves\":{\"ref\":\"f6a7b8c9d0\",\"n\":2,\"seq\":1790337603005}}}").empty());
+  // Found each other: said on this side, the meeting waits; said by both, the show names the number it found.
+  CHECK(heard("{\"t\":\"show\",\"show\":{\"kind\":\"meet\",\"intent\":\"hi\",\"big\":\"42\",\"small\":\"FOUND: WAITING\"}}") ==
+        "the relay shows: meet 42 (found: waiting)");
+  CHECK(heard(hi + ",\"found\":{\"n\":42,\"intent\":\"song\"}}}") == "the relay shows: hi (found 42)");
+  CHECK(heard(hi + ",\"found\":{\"n\":42,\"intent\":\"song\"}}}").empty());
+  CHECK(heard("{\"t\":\"found\",\"ok\":true}") == "the relay took the found");
+  CHECK(heard("{\"t\":\"found\",\"ok\":false,\"why\":\"gone\"}") == "the relay did not take the found: gone");
   CHECK(heard("{\"t\":\"wave\",\"ok\":true}") == "the relay took the wave back");
   CHECK(heard("{\"t\":\"wave\",\"ok\":false,\"why\":\"gone\"}") == "the relay did not take the wave back: gone");
````

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)|failed:"`

Expected: `ℹ pass 104`, `ℹ fail 1`: *the wristband logic passes its own checks*, first at `logic_test.cpp:463: failed: saidLine("{\"t\":\"found\",\"number\":\"27\"}") == "found, from the wrist"`.

- [ ] **Step 3: Implement.**

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -1936,12 +1936,13 @@ inline std::string faceLine(const Screen& s) {
 /**
  * What the console says about a frame the wrist sends, or "" for nothing: a
  * hello says whether it carries a secret, never the secret itself, a choice
- * says what was chosen, and a wave back only that it was sent.
+ * says what was chosen, and a wave back or a found only that it was sent.
  */
 inline std::string saidLine(const std::string& frame) {
   if (frame == "DROP") return "the relay went quiet; trying again";
   if (frame == HOLD_FRAME) return "NOT NOW, from the wrist";
   if (frame.rfind("{\"t\":\"wave\"", 0) == 0) return "a wave back from the wrist";
+  if (frame.rfind("{\"t\":\"found\"", 0) == 0) return "found, from the wrist";
   if (frame.rfind("{\"t\":\"wristband\"", 0) == 0)
     return frame.find("\"secret\":") == std::string::npos ? "hello to the relay, as a new wristband"
                                                           : "hello to the relay, with its secret";
@@ -1957,14 +1958,16 @@ inline std::string saidLine(const std::string& frame) {
 
 /**
  * What the console says about a frame from the relay, or "" for nothing:
- * what it refuses, a pairing, the answer to a wave back, and each change in
- * what it shows, how many wait included. `shown` is what was last said about
- * a show, kept by the caller. Never a secret, and never who waved.
+ * what it refuses, a pairing, the answer to a wave back or a found, and each
+ * change in what it shows, how many wait and a meeting found included.
+ * `shown` is what was last said about a show, kept by the caller. Never a
+ * secret, and never who waved.
  */
 inline std::string heardLine(const Frame& f, std::string& shown) {
   if (f.t == "error") return "the relay says: " + f.why;
   if (f.t == "set" && f.hasOk && !f.ok) return "the relay did not take the choice: " + f.why;
   if (f.t == "wave" && f.hasOk) return f.ok ? "the relay took the wave back" : "the relay did not take the wave back: " + f.why;
+  if (f.t == "found" && f.hasOk) return f.ok ? "the relay took the found" : "the relay did not take the found: " + f.why;
   if (f.t == "paired" && f.hasSecret) return "paired: the relay gave it a secret";
   if (f.t != "show" || !f.hasShow) return "";
   const Show& s = f.show;
@@ -1973,6 +1976,8 @@ inline std::string heardLine(const Frame& f, std::string& shown) {
   else if (s.kind == "check" || s.kind == "meet") what += " " + s.big;
   else if (s.quiet) what += " (NOT NOW)";
   else if (s.away) what += " (away)";
+  if (s.kind == "meet" && s.small == "FOUND: WAITING") what += " (found: waiting)";
+  if (f.found.n > 0) what += " (found " + std::to_string(f.found.n) + ")";
   if (f.waves.n > 0) what += " (" + std::to_string(f.waves.n) + " waiting)";
   if (what == shown) return "";
   shown = what;
````

- [ ] **Step 4: Run** — the file (105 pass), then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 378`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "a found from the wrist says nothing",
  "file": "firmware/src/band_logic.h",
  "from": "  if (frame.rfind(\"{\\\"t\\\":\\\"found\\\"\", 0) == 0) return \"found, from the wrist\";\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "the relay's answer to a found says nothing",
  "file": "firmware/src/band_logic.h",
  "from": "  if (f.t == \"found\" && f.hasOk) return f.ok ? \"the relay took the found\" : \"the relay did not take the found: \" + f.why;\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "a meeting waiting on the other reads as any meeting",
  "file": "firmware/src/band_logic.h",
  "from": "  if (s.kind == \"meet\" && s.small == \"FOUND: WAITING\") what += \" (found: waiting)\";\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "a show that names a found reads as any show",
  "file": "firmware/src/band_logic.h",
  "from": "  if (f.found.n > 0) what += \" (found \" + std::to_string(f.found.n) + \")\";\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 }
]
````

- [ ] **Step 6: Build the band (P3).** Expected: two `[SUCCESS]` lines and no `src/` warning. At this commit the StickS3 image was 1,220,005 bytes of flash and 70,352 of RAM, the StickC Plus image 1,217,145 and 69,824.

- [ ] **Step 7: Commit, and close Stage B with P2**

```bash
git add firmware/host/logic_test.cpp firmware/src/band_logic.h
```

````bash
git commit -F - <<'EOF'
The band's console says found

What the wrist sends: "found, from the wrist". What the relay answers:
"the relay took the found", or that it did not and why. What it shows:
a meeting said on this side only reads "meet 42 (found: waiting)", and a
show that names a found "(found 42)", once per change as before. It is
how a band is watched from its USB cable in a test on the real bands.

Mutation-checked: 4 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---

## Stage C — The phone

### Task 7: S11 says we found each other; Tonight counts meetings found

**Files:**
- Create: `app/lib/found.js`, `tests/found.test.js`
- Modify: `app/screens/Met.jsx`, `app/App.jsx`

**Interfaces:**
- Consumes: Task 1's `found` and `foundAt` on each match of the view; Task 3's phone message `{ t: 'found', match }`; `MEET_MS` (`relay/band.js`); `buzzes(fresh, view)` (`app/lib/waved.js`: only with no live wristband); `store.noteMatch()`, which keeps every field of a match the view carries; `hhmm()` (`app/lib/phase.js`); `matchName()` (`app/copy.js`); `net.send()`, which queues offline; App's `now`, `paired`, `status`, `say()` and `buzz()`.
- Produces: `app/lib/found.js`: `meetingOn(m, now)` (under `MEET_MS` old and no `foundAt`); `newlyFound(view, seen)` (matches with `foundAt` whose id is not in the `Set` `seen`); `metItem(m)` (`{ at: foundAt, text: 'met <name>' }`, the name lower-cased when it is the stand-in *Someone …*; `null` without `foundAt`); `metCount(stored)`; `FOUND_MINE`; `foundBoth(at)`. `Mate` (S11) takes `number` (shown as S8 shows it) and `onFound`, and shows, in order of precedence, `foundBoth(foundAt)`, `FOUND_MINE` when this side said it, or the `WE FOUND EACH OTHER` button in the meeting's card. App passes `number` only when paired and `meetingOn()`, sends `{ t: 'found', match }` on the button and says *Saved. It'll sync when you're out.* when not live, and buzzes `[70, 50, 70, 50, 70]` once for each match newly found by both, unless a live wristband plays it; the matches the night's record already holds as found are not new, so a reload buzzes for none. Tonight's line for a match found by both is `metItem()`, at the time it was found; its count is `metCount()`.

- [ ] **Step 1: Write the failing tests.** Five: S11's number is shown under `MEET_MS`, still when only one side said it, and not once found by both nor at fifteen minutes; `newlyFound()` gives only matches found by both and not seen, and with `buzzes()` only without a live wristband; Tonight's line and count; the record keeps `found` and `foundAt` across a reload, so nothing already found is new again; and the words.

Create `tests/found.test.js`:

````js
// ON THE BEAT — found each other, on the phone: the number while the meeting is
// on, a buzz only when no live wristband plays it instead, Tonight's line and
// count, and the words.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MEET_MS } from '../relay/band.js';
import { buzzes } from '../app/lib/waved.js';
import { FOUND_MINE, foundBoth, meetingOn, metCount, metItem, newlyFound } from '../app/lib/found.js';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const store = await import('../app/lib/store.js');
beforeEach(() => mem.clear());

const T = new Date(2026, 8, 26, 21, 4).getTime();
const match = (id, more = {}) => ({ id, name: 'Ana', intent: 'hi', number: 27, at: T, found: false, foundAt: null, ...more });

test('S11 shows the number while the meeting is on: under MEET_MS, and not once found by both', () => {
  assert.equal(meetingOn(match('m1'), T + MEET_MS - 1), true);
  assert.equal(meetingOn(match('m1'), T + MEET_MS), false, 'fifteen minutes on, it is over');
  assert.equal(meetingOn(match('m1', { found: true }), T + 60_000), true, 'said on your side only, it is still on');
  assert.equal(meetingOn(match('m1', { found: true, foundAt: T + 60_000 }), T + 60_000), false, 'found by both, it is over');
});

test('newlyFound() gives the matches found by both that the phone has not seen found, and a buzz only without a live wristband', () => {
  const v = (wristband) => ({ me: { wristband }, matches: [match('m1', { found: true }), match('m2', { found: true, foundAt: T + 1 }), match('m3', { foundAt: T + 2 })] });
  assert.deepEqual(newlyFound(v(null), new Set()).map((m) => m.id), ['m2', 'm3'], 'said on one side only is not found');
  assert.deepEqual(newlyFound(v(null), new Set(['m2'])).map((m) => m.id), ['m3'], 'seen once is seen');
  assert.deepEqual(newlyFound({ me: null, matches: [] }, new Set()), []);
  const fresh = newlyFound(v(null), new Set());
  assert.equal(buzzes(fresh, v(null)), true, 'no wristband: the phone buzzes');
  assert.equal(buzzes(fresh, v({ battery: 40, live: false })), true, 'a wristband out of reach plays nothing, so the phone buzzes');
  assert.equal(buzzes(fresh, v({ battery: 40, live: true })), false, 'a live wristband plays it, and the phone stays still');
});

test("Tonight: a meeting found by both is `met <name>` at the time it was found, and only those count as met", () => {
  const found = match('m1', { foundAt: T + 10 * 60_000 });
  assert.deepEqual(metItem(found), { at: T + 10 * 60_000, text: 'met Ana' });
  assert.deepEqual(metItem(match('m1', { name: '', intent: 'dance', foundAt: T })), { at: T, text: 'met someone from the floor' });
  assert.equal(metItem(match('m2', { found: true })), null, 'said on one side keeps its own line');
  assert.equal(metCount([found, match('m2', { found: true }), match('m3')]), 1);
});

test("the phone keeps foundAt in its record of the night, so a reload knows the meeting was found", () => {
  let s = store.startNight(store.load(), { id: 'x', room: 'x', venue: 'The Roundhouse', act: 'Kayo' });
  s = store.noteMatch(s, match('m1', { found: true, foundAt: T + 60_000 }));
  store.save(s);
  const m = store.tonight(store.load()).matches.m1;
  assert.deepEqual([m.found, m.foundAt], [true, T + 60_000]);
  assert.deepEqual(newlyFound({ matches: [m] }, new Set(Object.values(store.tonight(store.load()).matches).filter((x) => x.foundAt).map((x) => x.id))), []);
});

test("the words: found on your side says the other won't know; found by both says when", () => {
  assert.equal(FOUND_MINE, "found on your side. they won't know unless they say so too.");
  assert.equal(foundBoth(T + 10 * 60_000), 'you found each other at 21:14');
});
````

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/found.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)|ERR_MODULE_NOT_FOUND"`

Expected: the file does not load, `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/app/lib/found.js'`, and `ℹ fail 1` for the file.

- [ ] **Step 3: Implement.**

Create `app/lib/found.js`:

````js
// Found each other, on the phone (docs/superpowers/specs/2026-09-26-wrist-found-
// design.md §1). Either person says it, from the wrist or from S11, and it
// counts only once both have. Then both phones say when, Tonight counts the
// meeting as met, and a phone buzzes only when no live wristband of its person
// plays it instead, as for a wave (app/lib/waved.js buzzes()).

import { MEET_MS } from '../../relay/band.js';
import { matchName } from '../copy.js';
import { hhmm } from './phase.js';

/** S11 shows the number to look for while the meeting is on: under MEET_MS old, and not yet found by both. */
export const meetingOn = (m, now = Date.now()) => !m.foundAt && now - m.at < MEET_MS;

/** The matches in a view found by both that the phone has not seen found before. */
export const newlyFound = (view, seen) => (view?.matches || []).filter((m) => m.foundAt && !seen.has(m.id));

/** Tonight's line for a meeting found by both: `met <name>`, at the time it was found. Null for one not found. */
export const metItem = (m) => (m.foundAt ? { at: m.foundAt, text: 'met ' + (m.name || matchName(m).toLowerCase()) } : null);

/** Tonight's count: the meetings found by both. A match never found is not a meeting. */
export const metCount = (stored) => stored.filter((m) => m.foundAt).length;

/** S11's words: said on your side, and said by both. */
export const FOUND_MINE = "found on your side. they won't know unless they say so too.";
export const foundBoth = (at) => 'you found each other at ' + hhmm(at);
````

In `app/screens/Met.jsx`:

````diff
--- a/app/screens/Met.jsx
+++ b/app/screens/Met.jsx
@@ -1,6 +1,7 @@
 import { useEffect, useState } from 'react';
 import { HUE, hueVars, matchName, spotShort } from '../copy.js';
 import { reducedMotion } from '../lib/device.js';
+import { FOUND_MINE, foundBoth, metCount, metItem } from '../lib/found.js';
 import { PHASES, hhmm, phaseOf, timesOf } from '../lib/phase.js';
 import { tonightKey } from '../lib/store.js';
 import { Back, Cta, Ghost, Icon, More, Pill } from '../ui.jsx';
@@ -62,8 +63,8 @@ export function Match({ match, number, onMyWay, onNotThis, onPick }) {
   );
 }
 
-/** S11 — the person you met, kept only if you both say so. */
-export function Mate({ match, onBack, onMore, onKeep, onTonight }) {
+/** S11 — the person you met: found, and kept, only if you both say so. */
+export function Mate({ match, number, onBack, onMore, onFound, onKeep, onTonight }) {
   const name = matchName(match);
   const hue = HUE[match.intent] || HUE.hi;
   return (
@@ -80,6 +81,18 @@ export function Mate({ match, onBack, onMore, onKeep, onTonight }) {
         {match.pick ? <div style={{ marginTop: 16 }}><Pill track={match.pick} /></div> : null}
         <div className="small tnum" style={{ marginTop: 16 }}>met at {hhmm(match.at)}, {spotShort(match.spot)}</div>
       </div>
+      {number ? (
+        <div className="lede" style={{ marginBottom: 14 }}>
+          Look for the wristband showing <span style={{ font: 'var(--display-l)', color: hue.c }}>{number}</span>
+        </div>
+      ) : null}
+      {match.foundAt ? (
+        <div className="small tnum" style={{ marginBottom: 14, color: 'var(--ok)' }}>{foundBoth(match.foundAt)}</div>
+      ) : match.found ? (
+        <div className="small" style={{ marginBottom: 14 }}>{FOUND_MINE}</div>
+      ) : (
+        <div style={{ marginBottom: 14 }}><Cta hue={match.intent} onClick={onFound}>WE FOUND EACH OTHER</Cta></div>
+      )}
       <div className="keep">
         <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
           <span className="h2">Keep after tonight</span>
@@ -120,7 +133,8 @@ export function Tonight({ show, phase, night, live, kept, name, onBack, onKeep,
   const stored = Object.values(night?.matches || {});
   const items = [
     ...(night?.events || []).map((e) => ({ at: e.at, text: e.text })),
-    ...stored.map((m) => ({ at: m.at, text: matchLine(m) })),
+    // A meeting found by both is met, when it was found; a match never found keeps its own line.
+    ...stored.map((m) => metItem(m) || { at: m.at, text: matchLine(m) }),
   ];
   if (phase === 'AFTER') {
     const end = new Date();
@@ -138,7 +152,7 @@ export function Tonight({ show, phase, night, live, kept, name, onBack, onKeep,
       <Back onClick={onBack} />
       <h1 className="h1" style={{ margin: '6px 0 3px' }}>Tonight</h1>
       <div className="tnum" aria-live="polite" style={{ font: 'var(--num)', color: 'var(--text-2)', marginBottom: 18 }}>
-        {stored.length} met · {keptCount} kept
+        {metCount(stored)} met · {keptCount} kept
       </div>
       <div className="scroll" style={{ gap: 0 }}>
         {PHASES.map((p, i) => {
````

In `app/App.jsx`:

````diff
--- a/app/App.jsx
+++ b/app/App.jsx
@@ -3,6 +3,7 @@ import { HUE, PROMISES, matchName, someone } from './copy.js';
 import { SOUND_SAY, soundRow } from './lib/bandsound.js';
 import { battery, buzz, toBase64 } from './lib/device.js';
 import { INTENT_OF, follow, nextSeq, tapMessage } from './lib/follow.js';
+import { meetingOn, newlyFound } from './lib/found.js';
 import { connect } from './lib/net.js';
 import { phaseLine, phaseOf } from './lib/phase.js';
 import * as store from './lib/store.js';
@@ -279,6 +280,21 @@ export default function App() {
   }, [view]);
   useEffect(() => { wavesSeen.current = null; }, [night?.me]);
 
+  // Found by both, news to this phone: a buzz, unless a live wristband plays it instead (found §1). The record
+  // keeps foundAt (noteMatch, above), so a reload buzzes for nothing already found.
+  const foundSeen = useRef(null);
+  useEffect(() => {
+    if (!view.me) return;
+    const known = foundSeen.current ?? new Set(Object.values(night?.matches || {}).filter((m) => m.foundAt).map((m) => m.id));
+    foundSeen.current = known;
+    const fresh = newlyFound(view, known);
+    if (!fresh.length) return;
+    for (const m of fresh) known.add(m.id);
+    if (buzzes(fresh, view)) buzz([70, 50, 70, 50, 70]);
+    // eslint-disable-next-line react-hooks/exhaustive-deps
+  }, [view]);
+  useEffect(() => { foundSeen.current = null; }, [night?.me]);
+
   // The relay decides (§3): a view that passes rule 4 sets the cards, the screen and what is re-said.
   useEffect(() => {
     if (!view.me) return;
@@ -461,6 +477,12 @@ export default function App() {
     net.current?.send({ t: 'keep', match: m.id, on });
   };
 
+  // WE FOUND EACH OTHER: the same as the side hold on the wrist, counted once both say it. Queued offline.
+  const sayFound = (m) => {
+    net.current?.send({ t: 'found', match: m.id });
+    if (status !== 'live') say("Saved. It'll sync when you're out.");
+  };
+
   const sendClip = async (blob, type) => {
     if (blob.size > 1_150_000) { say('that one is too big to send. try again, a little stiller.'); return; }
     const data = await toBase64(blob);
@@ -653,7 +675,8 @@ export default function App() {
     case 'floor': body = <Floor floor={view.floor} mine={view.me?.clip} room={room} onBack={back} onTile={tileSheet} />; break;
     case 'mate':
       body = match ? (
-        <Mate match={match} onBack={back} onKeep={(on) => keep(match, on)} onTonight={() => go('tonight')}
+        <Mate match={match} number={paired && meetingOn(match, now.getTime()) ? match.number : null}
+          onBack={back} onFound={() => sayFound(match)} onKeep={(on) => keep(match, on)} onTonight={() => go('tonight')}
           onMore={() => personSheet(match.id, matchName(match))} />
       ) : null;
       break;
````

- [ ] **Step 4: Run** — the file (5 pass), then `npm test`, which also builds the app. Expected: `ℹ fail 0`, `ℹ tests 383`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`. The screens and App's effect are held by Task 8's browser proof, not by a mutation list.

````json
[
 {
  "label": "the number stays once found by both",
  "file": "app/lib/found.js",
  "from": "(m, now = Date.now()) => !m.foundAt && now - m.at < MEET_MS;",
  "to": "(m, now = Date.now()) => now - m.at < MEET_MS;",
  "test": "tests/found.test.js",
  "expect": [
   "S11 shows the number while the meeting is on"
  ]
 },
 {
  "label": "the number stays at fifteen minutes",
  "file": "app/lib/found.js",
  "from": "!m.foundAt && now - m.at < MEET_MS;",
  "to": "!m.foundAt && now - m.at <= MEET_MS;",
  "test": "tests/found.test.js",
  "expect": [
   "S11 shows the number while the meeting is on"
  ]
 },
 {
  "label": "one side's found is news",
  "file": "app/lib/found.js",
  "from": ".filter((m) => m.foundAt && !seen.has(m.id));",
  "to": ".filter((m) => (m.foundAt || m.found) && !seen.has(m.id));",
  "test": "tests/found.test.js",
  "expect": [
   "newlyFound() gives the matches found by both"
  ]
 },
 {
  "label": "a found already seen is news again",
  "file": "app/lib/found.js",
  "from": ".filter((m) => m.foundAt && !seen.has(m.id));",
  "to": ".filter((m) => m.foundAt);",
  "test": "tests/found.test.js",
  "expect": [
   "newlyFound() gives the matches found by both",
   "the phone keeps foundAt in its record of the night"
  ]
 },
 {
  "label": "met at the match's time",
  "file": "app/lib/found.js",
  "from": "(m.foundAt ? { at: m.foundAt, text:",
  "to": "(m.foundAt ? { at: m.at, text:",
  "test": "tests/found.test.js",
  "expect": [
   "Tonight: a meeting found by both"
  ]
 },
 {
  "label": "every match counts as met",
  "file": "app/lib/found.js",
  "from": "(stored) => stored.filter((m) => m.foundAt).length;",
  "to": "(stored) => stored.length;",
  "test": "tests/found.test.js",
  "expect": [
   "Tonight: a meeting found by both"
  ]
 }
]
````

- [ ] **Step 6: Commit, and close Stage C with P2**

```bash
git add app/App.jsx app/lib/found.js app/screens/Met.jsx tests/found.test.js
```

````bash
git commit -F - <<'EOF'
S11 says we found each other; Tonight counts meetings found

S11 gains WE FOUND EACH OTHER, the same as the side hold on the wrist,
and shows the number to look for while the meeting is on (paired, under
MEET_MS, not yet found by both). Said on this side: found on your side.
they won't know unless they say so too. Said by both: you found each
other at HH:MM, and one buzz unless a live wristband plays it instead.
Offline it is queued, and says so. Tonight reads a meeting found by both
as met <name> at the time it was found, and counts only those as met.

Mutation-checked: 6 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---

## Stage D — Proof and docs

### Task 8: The browser proof

Three people on one relay in the browser pane: A and B each a phone and a `/band` stand-in, C a phone with no wristband. Run it on `main` once Tasks 1–7 are pushed; it comes before the README because the README says what it saw. When this plan was written it was done on the finished build, and everything below was seen.

- **People need origins of their own:** tabs on one origin share `localStorage`. Use `http://localhost:<port>` for A, `http://127.0.0.1:<port>` for B and `http://127.0.0.2:<port>` for C (any 127.x address reaches a relay listening on all addresses).
- Run the relay on a free port: `npm run build`, then `PORT=<port> node relay/server.js` with Bash `run_in_background`; stop it afterwards by port.
- Seed each phone's `localStorage['otb:v1']` as CLAUDE.md shows (a night at a test room, the same `show.room` for all three) and reload. Pair A and B: open `/band` on the person's origin, read its letters, open `/pair/<letters>` on the phone, and press YES with `element.click()` once the band shows the number the sheet asks about.
- **Each band's first press must be a real click** (the pane's `computer` click, by a `ref` from `find`), to unlock its audio; after that a `keydown`/`keyup` of Enter dispatched on `.bandbtn` (FACE) or `.bandside` (SIDE) presses it too, and holding means waiting 1.7 s between the two. A first press on a meeting that calls only answers it.
- Before the first click install the oscillator spy of the reactions plan's Task 11 Step 6 on each band (`AudioContext.prototype.createOscillator` wrapped to record each note's frequency) and a face sampler (the `.bandface` element's inline style and text every 25 ms). **Keep the band being sampled in front:** a hidden tab runs its timers about once a second. The oscillator records do not depend on it.
- Record `navigator.vibrate` on each phone by replacing it with a function that pushes its pattern — after the page's last load.

- [ ] **Step 1: A and B meet.** Both on SAY HI (`button.intent`, then `.cta`); A waves from WHO'S NEAR and B waves back. Expected: both bands `MEET` over the same number; both phones S8 with it.
- [ ] **Step 2: A wakes the meeting face.** A real click on A's FACE answers the call; a second press wakes it. Expected: `HOLD SIDE: FOUND` over the number.
- [ ] **Step 3: A says found from the wrist.** Hold SIDE on A's band. Expected: A's band plays `tick` then `double` (1800 Hz three times) and shows `FOUND: WAITING` over the number (on a local relay `SENDING` lasts under 25 ms and is not sampled; the table holds it); B's band still `MEET` over it. `ON MY WAY` on both phones: A's S11 shows *Look for the wristband showing <n>* and *found on your side. they won't know unless they say so too.*; B's shows the number and `WE FOUND EACH OTHER`.
- [ ] **Step 4: B says it on the phone.** A real click on B's FACE first (it answers B's call and unlocks its audio); keep A's band in front; then `WE FOUND EACH OTHER` on B's phone. Expected on both bands in the same moment: `found` (1568, 2093, 2637, 2637, 3136 Hz); on A's, three on steps with no words in the meeting's card and three off steps, then `HI :)` with the number gone; on B's the same notes and `HI :)`. Both phones: *you found each other at HH:MM*, no number, and no buzz (both bands live). B's Tonight: `1 met · 0 kept` and `HH:MM · met Ana`.
- [ ] **Step 5: Without a live band, a buzz.** Close A's band tab. C seeds a night, goes SAY HI and waves at every row; A reloads, goes SAY HI and waves back at C. Expected: C's S8 and S11 show no number (C wears none); A's S11 shows it. Both press `WE FOUND EACH OTHER`: A's S11 says `FOUND_MINE` until C's lands, then both say *you found each other at HH:MM* and each phone buzzes `[70, 50, 70, 50, 70]` once. A's Tonight: `2 met · 0 kept`, a `met` line for each.
- [ ] **Step 6: Tidy up.** Reset the viewport of the browser pane if one was set, close the tabs, and stop the relay by its port.

### Task 9: The README and the waves spec

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-09-25-wrist-waves-design.md`

The spec's "Also to change when this is built": README's wristband (what it shows, and a new paragraph for the side hold, S11, the reaction, the buzz and Tonight), "Where this differs from the canvas, on purpose", and what is not done; the waves spec's meeting. The line "Found each other has run in tests and a browser, not yet on the real bands" rests on Task 8: write it only once that proof has been done.

- [ ] **Step 1: Edit.**

In `README.md`:

````diff
--- a/README.md
+++ b/README.md
@@ -189,8 +189,9 @@ that was taken.
 - **What it shows** is decided by the relay, in `relay/band.js`, from the same
   `viewFor()` its person's phone is sent, so it can never show more than the
   phone could: its person's colour and card words while a card is armed, the
-  two-digit meeting number for fifteen minutes after a match (the same number
-  on both wrists), and nothing at all under NOT NOW. While its person shows
+  two-digit meeting number for fifteen minutes after a match or until both say
+  they found each other (the same number on both wrists), and nothing at all
+  under NOT NOW. While its person shows
   SAY HI it is also told that someone waved and how many wait: the newest
   one's handle, a count and a number, the same size however many wait. Never a
   name, never anyone else's pick, never a contact. At 15% battery it dims
@@ -235,6 +236,21 @@ that was taken.
   phone. Waves are numbered by the relay's clock, so a band never calls twice
   for one wave, even past a relay restart, and never misses the next. The
   phone buzzes for a wave only when no live wristband calls instead.
+- **Found each other, from the wrist or the phone.** Woken, the meeting face
+  says `HOLD SIDE: FOUND`, and a side hold there says the two of you found
+  each other (a side press still opens the chooser; the key that answers the
+  call does nothing else). So does `WE FOUND EACH OTHER` on the person's
+  screen (S11), which now also shows the number while the meeting is on. It
+  counts only once both have said it, as keeping does. Said on one side, the
+  number stays and reads `FOUND: WAITING` on that wrist only, and the phone
+  says *found on your side. they won't know unless they say so too.* The
+  other person sees nothing. Once both have, both numbers go at once, both
+  bands play a `found` chirp and flash the meeting's card three times, both
+  phones say *you found each other at 21:14*, and Tonight counts it as met,
+  at that time. A band out of reach then plays it when it is back within a
+  minute; the phone buzzes only when no live wristband plays it. Refused or
+  out of reach, the band says `NOT SENT`. Never said by both, the number goes
+  at fifteen minutes, and nothing says why.
 - **The sound can be switched off, on the phone.** The wristband sheet has
   `SOUND: ON` under TEST THE LIGHT; off, the band only lights up. The switch is
   the person's own: the phone keeps it across nights and re-says it after
@@ -430,6 +446,12 @@ the relay reaches it.
   about anyone else but the meeting number. The owner chose on 25 Sep 2026
   that it also says that someone waved at its person and how many wait, and
   can wave back to the newest. Still no name, no photo, no pick and no area.
+- **A meeting ends when both say they found each other.** Revision 6 shows
+  `MEET` and the number for as long as the meeting lasts, and S11 has no way
+  to say a meeting happened. The owner chose on 26 Sep 2026 a side hold on the
+  band, or `WE FOUND EACH OTHER` on S11, counted only when both say it: the
+  meeting face gains `FOUND: WAITING`, both bands a *found* reaction, and
+  Tonight's `met` counts meetings found, not matches.
 
 ## Abuse resistance
 
@@ -591,6 +613,10 @@ relay could drive what a wrist shows.
   match. The physical buttons, and the three blue flashes seen by eye, are
   left for a person. Answering from the wrist is only waving back: a like
   needs the other person's pick, which the wrist never shows.
+- **Found each other has run in tests and a browser, not yet on the real
+  bands.** Saying it by bumping two wristbands together, with the motion
+  sensor, is a later change, after a spike shows a fist bump can be told
+  apart from two people dancing to the same beat.
 - **The timings are guesses until worn** — six seconds awake, 1.5 s holds,
   three to send, ten to wait. They are named constants for that reason.
 - **Recording has run on Chrome's fake camera, not a phone's.** Headless
````

In `docs/superpowers/specs/2026-09-25-wrist-waves-design.md`:

````diff
--- a/docs/superpowers/specs/2026-09-25-wrist-waves-design.md
+++ b/docs/superpowers/specs/2026-09-25-wrist-waves-design.md
@@ -231,6 +231,8 @@ on purpose" say so.
      meeting call until each wearer presses a key.
    - Two people raising their wrists to show the same number is how they
      find each other.
+   - The number goes after fifteen minutes, or at once when both say they
+     found each other (`2026-09-26-wrist-found-design.md`).
 4. **A wave nobody answers** is never reported as declined (promise 4).
    - It stays for the night unless one of them blocks the other.
    - While the waver is not showing blue, not visible or not in the room,
````

- [ ] **Step 2: Run** `node --test tests/copy.test.js` (no old words about the band anywhere), then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 383`.

- [ ] **Step 3: Commit, and close Stage D's writing with P2**

```bash
git add README.md docs/superpowers/specs/2026-09-25-wrist-waves-design.md
```

````bash
git commit -F - <<'EOF'
Describe found each other, on the wrist and the phone

README: what the band shows now ends at fifteen minutes or once both say
they found each other; the side hold and its hint, S11's button and
words, the found reaction, the buzz, and Tonight's met; the canvas
departure the owner chose on 26 Sep 2026; and that it has run in tests
and a browser, not yet on the real bands, with bumping bands left for
later. The waves spec's meeting names the found spec for how its number
now also ends.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 10: The real bands, with the owner

Nothing here starts without the owner's yes: ask in Chinese before each flash, and before any sound he has not said he is free to hear. Use the console, as for the waves: his real bands, the StickS3 (`COM8`) and the StickC Plus (`COM9`), each paired to a stand-in phone through the always-on relay `https://on-the-beat.fly.dev`; deploy the relay first (the owner logs in to Fly himself), unless he has said a demo is on. The console takes `press face`, `press side`, `hold face` and `hold side`, and says each change in what the relay shows (Task 6).

- [ ] **Step 1: Deploy the relay**, when the owner agrees, and check that https://on-the-beat.fly.dev/ loads the app.
- [ ] **Step 2: Flash both bands** (P3's directories; `pio run -e m5sticks3 -t upload --upload-port COM8`, `pio run -e m5stickc -t upload --upload-port COM9`).
- [ ] **Step 3: Match the two bands to each other.** Pair each with a stand-in phone, saying YES only once the band's own console shows the number the phone asks about; both on SAY HI; a wave and a wave back. Expected on both consoles: `the relay shows: meet <n>`, and the jingle.
- [ ] **Step 4: Found, from both wrists.** `press face` to answer each call. `hold side` on one: its console says `found, from the wrist`, `the relay took the found`, `the relay shows: meet <n> (found: waiting)`, and its face line `FOUND: WAITING`; the other console says nothing new. `hold side` on the other: both consoles say `the relay shows: hi (found <n>)`, both bands play `found` and flash, and both faces lose the number.
- [ ] **Step 5: Ask the owner** to press the buttons by hand and listen, when he is free: whether `found` sounds right on each buzzer, and whether three flashes of the card read on a wrist. Tune only what he asks for: `found` is one line in each twin's table.
- [ ] **Step 6: Unpair every stand-in** from his real bands, and tell him in which state each band is left. Then say in README what was seen, in place of "not yet on the real bands".
