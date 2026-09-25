# Waves on the Wristband — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A wave sent on a phone reaches the other person's wristband at once, as a short call; they answer on the wristband or the phone, whichever is to hand; a wave back makes the match, and both wristbands and both phones show it in the same moment. The band says that someone waved and how many wait: never who, never where.

**Architecture:** The relay numbers each wave by its own clock and tells a band whose person shows SAY HI who waits, as one small object on the band's show (`waves: { ref, n, seq }`): the newest one's handle, a count, and the newest one's number. The band's wrist machine, written twice as for the reactions (`app/lib/wrist.js` for `/band`, the `Wrist` class in `firmware/src/band_logic.h` for the band) and held to the same table (`tests/fixtures/wrist-cases.json`), calls for a number newer than any it called for, opens a wave face on a FACE press, and waves back with a SIDE hold, which the relay takes as its person waving. The phone buzzes for a wave only when no live wristband calls instead. The players (`main.cpp`, `/band`) do not change: they already draw `face(now)` and play `sounds()`.

**Tech Stack:** Node 22+ (`node --test`, `ws`), React 19 + Vite 8, C++17 on the laptop (MinGW-W64 g++ here, GCC in CI), C++11 on the band (Arduino-ESP32 2.x through PlatformIO `espressif32@^6.9.0`), M5Unified 0.2.22 or later.

**Spec:** `docs/superpowers/specs/2026-09-25-wrist-waves-design.md` (approved by the owner on 25 Sep 2026: "The owner's decisions after review" 1–6, §1 the receiver's band, §2 the sender, the phones and the meeting, §3 the relay, the wrist and the phone, §4 tests and proof). It builds on `docs/superpowers/specs/2026-09-25-wrist-reactions-design.md` and on its plan, `docs/superpowers/plans/2026-09-25-wrist-reactions.md`, which must be done first: this plan uses its sounds, flashes, calls, reaction queue, sound switch and NOT NOW silence. Read both specs before any task.

This plan was written from a finished build: every task below was built in a scratch worktree, test first, and committed on its own with `npm test` green at every commit. The code blocks are those commits' diffs, so applying a task's blocks in order reproduces it. Each Step 2 was measured by running the task's tests on its parent's code, and each mutation list was measured at its task's commit.

## Global Constraints

- Artefacts are English: code, comments, commit messages, README, test names. Talk to the owner in Chinese.
- **The owner's decisions (spec):** (1) a short call that ends by itself: `hello` and three blue flashes, whatever the keys do; (2) a count, not a list: a SIDE hold waves back to the newest, and the phone answers the others; (3) the band may say yes without the phone; (4) waves only while its person shows SAY HI; (5) a FACE press opens them; (6) keys wait out the call: a key only ticks, a FACE hold still goes NOT NOW, and a meeting calling underneath is answered by the first key after the flashes.
- **Never who.** The band shows that someone waved and how many wait. No name, no photo, no pick, no area, and never a handle on its console.
- **The call (spec §3):** sound `hello` = 1568/60, 2093/120 · flash `wave` = the HI blue (`colour: 'hi'`), 3 × 500 / 500, not ended by a key. **The words:** `SOMEONE WAVED`, `HOLD SIDE: WAVE BACK`, `N WAITING - HOLD SIDE` (`9+` past nine), `WAVE BACK`, `SENDING`. The wave face is black, at `LIGHT_AWAKE`, with the HI blue for the words, as the chooser shows HI.
- **Timings:** no new wrist constant. The wave face closes after `CHOOSE_MS` (6 s) with no key; a wave back waits `CONFIRM_MS` (10 s); results stay `RESULT_MS`. The relay's `WAVE_GAP_MS = 1000`, a stamp of its own beside `SET_GAP_MS`.
- **Wave numbers** are the relay's clock in ms, at least one past the last number the receiver was sent, and a second wave by the same person keeps its number. They pass 32 bits: both twins keep them as 64-bit integers. A `ref` is ten lower-case hex characters; anything else is no one to answer.
- **The band drops a frame longer than 480 bytes whole** (`struct Event` in `firmware/src/main.cpp`): the `waves` object is the same size however many wait, and a test builds the longest show from the worst escapes and holds it to that buffer, read from `main.cpp`.
- **The band's compiler takes C++11** and sees `Arduino.h`'s macros first; `firmware/host/as_band.cpp` (from the reactions plan) holds `band_logic.h` to that on every run.
- The shared table decides behaviour: a rule is done when its cases pass on both twins. `tests/firmware.test.js` holds `SOUNDS` and `FLASHES` equal on both, so `hello` and `wave` join both tables together.
- Repository `LewisSwan24/on-the-beat` (private). Commit after each task; push to `main` when a stage's `npm test` is green. Never the team repository `cimi2232/DECO3500`: `tools/hooks/pre-push` refuses it (after a fresh clone, `cp tools/hooks/pre-push .git/hooks/pre-push`).
- `CLAUDE.md` is not in git and is not edited by this plan. Nothing from `../on-the-beat-research/` or `../on-the-beat-design/` enters the repository.
- `npm test` builds first (the relay serves `dist/`). Running one test file alone: `npm run build` first, and again after restoring a mutation.
- Windows host: the Bash tool is Git Bash; `python` there is the Store alias and hangs, so scripts are Node. A heredoc whose text holds a backslash before a backtick breaks the Bash tool: write such a script to a file first. A command that holds `git commit` and another program's `-n` (such as `grep -n`) is refused by a hook as `--no-verify`: run them separately.
- Flashing a band needs the owner's yes first, every time. The StickS3 is on `COM8`, the StickC Plus on `COM9`.
- Never more than ten background tasks at once. Work directly; this plan needs no fan-out.
- Commit messages end with the attribution trailer the session's system reminder gives (today: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## Three procedures used throughout

**P1 — Mutation check.** Every task that adds a guard lists mutations as JSON: break one guard, run one test file, and exactly the listed tests go red. The lists were measured at each task's own commit; run later, a list may find more red as later tests join, and a mutation whose line a later task rewrote no longer applies.

Save this runner outside the repository (for example in your scratch directory as `mutate.mjs`) and run it from the repository root: `node <scratch>/mutate.mjs <scratch>/task-N.json`. It applies each edit (the `from` text must occur exactly once), runs the test file, restores the file byte for byte, runs the file again, and prints `ALL MUTATIONS HELD` only if every red set was exactly the listed one and every restore came back green.

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
| `app/lib/waved.js` | A wave at you, on the phone: which rows are new, whether they buzz, and the two new lines |
| `tests/waved.test.js` | The buzz, the seen record, and the words |

Modified: `relay/room.js`, `relay/band.js`, `relay/server.js`, `app/lib/wrist.js`, `firmware/src/band_logic.h`, `firmware/host/logic_test.cpp`, `app/lib/store.js`, `app/App.jsx`, `app/screens/Hi.jsx`, `tests/room.test.js`, `tests/band.test.js`, `tests/wristband.test.js`, `tests/relay-harness.js`, `tests/fixtures/wrist-cases.json`, `README.md`, `docs/superpowers/specs/2026-09-25-wrist-reactions-design.md`.

Not modified, on purpose: `firmware/src/main.cpp` and `app/screens/Band.jsx`. Both draw whatever `face(now)` returns and play the newest of `sounds()`. The wave face is the chooser's layout (black field, `hi` ink); the wave's on step is the `hi` field with no words, drawn as a SET flash in the HI card's colour is; a wave back is about 50 bytes, well inside the band's 256-byte outgoing frame.

## Stages

| Stage | Tasks | Leaves |
|---|---|---|
| A. The relay | 1–3 | waves numbered by the clock; shows tell a band on SAY HI who waits; a band's wave back taken or refused with a reason |
| B. The wrist | 4–7 | the call, the wave face and the wave back in both twins, on one table; the band's console says waves |
| C. The phone | 8 | a buzz only without a live band; the new lines |
| D. Proof and docs | 9–11 | the browser proof; README and the promises; the real bands with the owner |

Every task ends green and is committed on its own; each stage ends with P2.

---

## Stage A — The relay

Run the relay's tests with `npm run build >/dev/null && node --test tests/room.test.js tests/band.test.js tests/wristband.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`.

### Task 1: Rooms number each wave by the clock, and list who waits as the phone does

**Files:**
- Modify: `relay/room.js`
- Test: `tests/room.test.js`

**Interfaces:**
- Consumes: `createRoom({ now })`, `resolve()`, `shows()`, `viewFor()` in `relay/room.js`.
- Produces: `waves` becomes a `Map` from `'a>b'` to a number: `Math.max(now(), latest(b) + 1)`, kept for a second wave by the same person; `latest` is a `Map` from a person to the last number they were sent, and outlives `leave()`. Two helpers, `seen(id)` (everyone a person may see; nobody in NOT NOW) and `blue(id)` (those of them on SAY HI); `viewFor()`'s `near` is `blue(id)`. `room.wavesAt(id)` → `[{ handle, n }]`, the rows the phone shows as waved at the person and not waved back, newest first. `room.wavedAtYou(viewer, handle)` → whether the person behind the handle waved at the viewer. `wave()` keeps its contract: `false` refused, `null` taken, the match when it made one.

- [ ] **Step 1: Write the failing tests.** Four: `wavesAt()` equals the phone's waiting rows, newest first, with the clock's numbers; it leaves out whoever the phone leaves out (a waver in NOT NOW, off SAY HI, gone, blocked either way) and everyone while the person is NOT NOW; numbers only go up (two in one millisecond, a second wave by the same person, past the receiver leaving and coming back in the same millisecond); `wavedAtYou()`.

In `tests/room.test.js`:

````diff
--- a/tests/room.test.js
+++ b/tests/room.test.js
@@ -74,6 +74,93 @@ test('you can only wave at someone showing blue, and never while invisible', ()
   assert.equal(room.viewFor('ben').near[0].wavedAtYou, false, 'neither wave landed');
 });
 
+/** The rows a phone shows as waved at its person and not waved back: what the wristband is told about. */
+const waiting = (room, id) => room.viewFor(id).near.filter((p) => p.wavedAtYou && !p.waved).map((p) => p.handle);
+
+test("wavesAt() is the phone's waiting rows, newest first, each numbered by the clock", () => {
+  const { room, handleOf, tick } = night();
+  const t0 = Date.UTC(2026, 8, 23, 11, 4);
+  for (const id of ['ana', 'ben', 'cai']) room.arm(id, 'hi');
+  room.wave('ana', handleOf('ana', 'ben'));
+  tick(5);
+  room.wave('cai', handleOf('cai', 'ben'));
+  assert.deepEqual(room.wavesAt('ben'), [
+    { handle: handleOf('ben', 'cai'), n: t0 + 5 },
+    { handle: handleOf('ben', 'ana'), n: t0 },
+  ]);
+  assert.deepEqual(room.wavesAt('ben').map((w) => w.handle).sort(), waiting(room, 'ben').sort(), 'exactly the rows the phone lists');
+  room.wave('ben', handleOf('ben', 'cai'));
+  assert.deepEqual(room.wavesAt('ben').map((w) => w.handle), [handleOf('ben', 'ana')], 'one waved back to is not waiting');
+  assert.deepEqual(room.wavesAt('ana'), [], 'a wave tells its sender nothing');
+});
+
+test('wavesAt() leaves out whoever the phone leaves out, and everyone while its person is NOT NOW', () => {
+  const { room, handleOf } = night();
+  for (const id of ['ana', 'ben', 'cai']) room.arm(id, 'hi');
+  const [ana, cai] = [handleOf('ben', 'ana'), handleOf('ben', 'cai')];
+  room.wave('ana', handleOf('ana', 'ben'));
+  room.wave('cai', handleOf('cai', 'ben'));
+  const only = (list, why) => {
+    assert.deepEqual(room.wavesAt('ben').map((w) => w.handle), list, why);
+    assert.deepEqual(waiting(room, 'ben').sort(), [...list].sort(), why + ', as the phone lists');
+  };
+  only([cai, ana], 'both wait');
+  room.setInvisible('ana', true);
+  only([cai], 'a waver in NOT NOW');
+  room.arm('ana', 'song');
+  only([cai], 'a waver not on SAY HI');
+  room.arm('ana', 'hi');
+  only([cai, ana], 'back, with the same wave');
+  room.leave('ana');
+  only([cai], 'a waver who left');
+  room.join('ana');
+  room.arm('ana', 'hi');
+  room.setInvisible('ben', true);
+  only([], 'nobody while ben is NOT NOW');
+  room.arm('ben', 'hi');
+  only([cai, ana], 'and both again when he is back');
+  room.block('ben', cai);
+  only([ana], 'a waver ben blocked');
+  room.block('ana', handleOf('ana', 'ben'));
+  only([], 'a waver who blocked ben');
+});
+
+test('wave numbers only go up: two in one millisecond differ, a second wave keeps its number, and they outlast leaving', () => {
+  const { room, handleOf, tick } = night();
+  for (const id of ['ana', 'ben', 'cai']) room.arm(id, 'hi');
+  room.wave('ana', handleOf('ana', 'ben'));
+  room.wave('cai', handleOf('cai', 'ben'));
+  const numberOf = (who) => room.wavesAt('ben').find((w) => w.handle === handleOf('ben', who)).n;
+  const first = numberOf('ana');
+  assert.equal(numberOf('cai'), first + 1, 'two waves in one millisecond still differ');
+  tick(1000);
+  room.wave('ana', handleOf('ana', 'ben'));
+  assert.equal(numberOf('ana'), first, 'a second wave by the same person keeps its number');
+  tick(-1000);
+  // Ben leaves and comes back within the millisecond; the next wave he is sent is still the newest.
+  room.leave('ben');
+  room.join('ben', { band: 'by the stage' });
+  room.arm('ben', 'hi');
+  room.join('dee', { band: 'near the bar' });
+  room.arm('dee', 'hi');
+  room.wave('dee', room.viewFor('dee').near.find((p) => p.band === 'by the stage').handle);
+  assert.equal(room.wavesAt('ben')[0].n, first + 2);
+});
+
+test('wavedAtYou() says whether the person behind a handle waved at the viewer, and nothing else', () => {
+  const { room, handleOf } = night();
+  for (const id of ['ana', 'ben', 'cai']) room.arm(id, 'hi');
+  room.wave('ana', handleOf('ana', 'ben'));
+  assert.equal(room.wavedAtYou('ben', handleOf('ben', 'ana')), true);
+  assert.equal(room.wavedAtYou('ana', handleOf('ana', 'ben')), false, 'a wave is not a wave back');
+  assert.equal(room.wavedAtYou('ben', handleOf('ben', 'cai')), false, 'someone who never waved');
+  assert.equal(room.wavedAtYou('ben', 'ffffffffff'), false, 'a made-up handle');
+  room.wave('ben', handleOf('ben', 'ana'));
+  assert.equal(room.wavedAtYou('ben', handleOf('ben', 'ana')), true, 'still true once they match');
+  room.block('ben', room.viewFor('ben').matches[0].id);
+  assert.equal(room.wavedAtYou('ben', handleOf('ben', 'ana')), false, 'a block takes the wave away');
+});
+
 test('two waves make a match, and only then a name, a meeting spot and one shared number', () => {
   const { room, handleOf } = night();
   meet(room, handleOf, 'ana', 'ben');
````

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/room.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: `ℹ pass 19`, `ℹ fail 4`. The first errors:

```text
TypeError: room.wavesAt is not a function
TypeError: room.wavedAtYou is not a function
```

Red (4):

- wavesAt() is the phone's waiting rows, newest first, each numbered by the clock
- wavesAt() leaves out whoever the phone leaves out, and everyone while its person is NOT NOW
- wave numbers only go up: two in one millisecond differ, a second wave keeps its number, and they outlast leaving
- wavedAtYou() says whether the person behind a handle waved at the viewer, and nothing else

- [ ] **Step 3: Implement.**

In `relay/room.js`:

````diff
--- a/relay/room.js
+++ b/relay/room.js
@@ -60,7 +60,10 @@ export function createRoom({
 } = {}) {
   const people = new Map();   // id -> person
   const blocks = new Map();   // id -> Set of ids they blocked; outlives leave()
-  const waves = new Set();    // 'a>b': a waved at b (SAY HI)
+  // 'a>b' -> its number: a waved at b (SAY HI). The number is the time it was made, and at least one past
+  // the last wave b was sent, so a wristband that kept the number it last called for is called by the next.
+  const waves = new Map();
+  const latest = new Map();   // id -> the number of the last wave they were sent; outlives leave()
   const likes = new Set();    // 'a>b': a liked b's pick (FIRST SONG?)
   const dances = new Map();   // 'a>b' -> clip ref: a danced back to b (LET'S DANCE!)
   const matches = new Map();  // pairKey -> match
@@ -233,8 +236,20 @@ export function createRoom({
   function wave(viewer, h) {
     const t = target(viewer, h);
     if (!t || people.get(t).armed !== 'hi') return false;
-    waves.add(viewer + '>' + t);
-    return matchIfMutual((k) => waves.has(k), viewer, t, 'hi');
+    const k = viewer + '>' + t;
+    // A second wave keeps the first one's number: it is not newer.
+    if (!waves.has(k)) {
+      const n = Math.max(now(), (latest.get(t) ?? 0) + 1);
+      latest.set(t, n);
+      waves.set(k, n);
+    }
+    return matchIfMutual((x) => waves.has(x), viewer, t, 'hi');
+  }
+
+  /** Has the person behind this handle waved at the viewer? */
+  function wavedAtYou(viewer, h) {
+    const t = resolve(viewer, h);
+    return !!t && waves.has(t + '>' + viewer);
   }
 
   function like(viewer, h) {
@@ -306,12 +321,27 @@ export function createRoom({
     }
   }
 
+  /** Everyone a person may see right now: nobody while they are NOT NOW. */
+  const seen = (id) => (people.get(id)?.invisible ? [] : [...people.values()].filter((p) => shows(id, p.id)));
+  /** SAY HI's list: who is showing blue to this person. The phone's list and wavesAt() both come from here. */
+  const blue = (id) => seen(id).filter((p) => p.armed === 'hi');
+
+  /**
+   * The waves a person's phone lists as waved at them and not yet waved back,
+   * newest first, each with its number: what their wristband is told.
+   */
+  function wavesAt(id) {
+    return blue(id)
+      .filter((p) => waves.has(p.id + '>' + id) && !waves.has(id + '>' + p.id))
+      .map((p) => ({ handle: handle(id, p.id), n: waves.get(p.id + '>' + id) }))
+      .sort((a, b) => b.n - a.n);
+  }
+
   /** Everything one phone may know, and nothing else. */
   function viewFor(id) {
     const me = people.get(id);
     if (!me) return null;
-    const quiet = me.invisible;
-    const others = quiet ? [] : [...people.values()].filter((p) => shows(id, p.id));
+    const others = seen(id);
     const row = (p) => ({ handle: handle(id, p.id), band: p.band });
     return {
       me: {
@@ -319,7 +349,7 @@ export function createRoom({
         rev: me.rev, seq: me.seq, by: me.by, fresh: me.by === 'relay',
       },
       // SAY HI: who is showing blue, as a band and at most a pick — and whether they waved at you.
-      near: others.filter((p) => p.armed === 'hi').map((p) => ({
+      near: blue(id).map((p) => ({
         ...row(p), pick: p.pick, waved: waves.has(id + '>' + p.id), wavedAtYou: waves.has(p.id + '>' + id),
       })),
       // FIRST SONG?: everyone's answer, liked as an answer, never as a face.
@@ -348,7 +378,7 @@ export function createRoom({
 
   return {
     join, leave, setBand, setProfile, arm, setInvisible, fromPhone, pick, postClip,
-    wave, like, unlike, danceBack, block, report, keep, viewFor,
+    wave, wavedAtYou, wavesAt, like, unlike, danceBack, block, report, keep, viewFor,
     /** For the relay: who is here, so it knows whose view to push. */
     ids: () => [...people.keys()],
     has: (id) => people.has(id),
````

- [ ] **Step 4: Run** — the file, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 278`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "two waves in one millisecond share a number",
  "file": "relay/room.js",
  "from": "const n = Math.max(now(), (latest.get(t) ?? 0) + 1);",
  "to": "const n = now();",
  "test": "tests/room.test.js",
  "expect": [
   "wavesAt() leaves out whoever the phone leaves out, and everyone while its person is NOT NOW",
   "wave numbers only go up: two in one millisecond differ, a second wave keeps its number, and they outlast leaving"
  ]
 },
 {
  "label": "a second wave takes a new number",
  "file": "relay/room.js",
  "from": "    if (!waves.has(k)) {",
  "to": "    if (true) {",
  "test": "tests/room.test.js",
  "expect": [
   "wave numbers only go up: two in one millisecond differ, a second wave keeps its number, and they outlast leaving"
  ]
 },
 {
  "label": "leaving forgets the last number sent",
  "file": "relay/room.js",
  "from": "    if (p) tombs.set(id, { rev: p.rev, invisible: p.invisible });",
  "to": "    if (p) tombs.set(id, { rev: p.rev, invisible: p.invisible });\n    latest.delete(id);",
  "test": "tests/room.test.js",
  "expect": [
   "wave numbers only go up: two in one millisecond differ, a second wave keeps its number, and they outlast leaving"
  ]
 },
 {
  "label": "a wave waved back to still waits",
  "file": "relay/room.js",
  "from": ".filter((p) => waves.has(p.id + '>' + id) && !waves.has(id + '>' + p.id))",
  "to": ".filter((p) => waves.has(p.id + '>' + id))",
  "test": "tests/room.test.js",
  "expect": [
   "wavesAt() is the phone's waiting rows, newest first, each numbered by the clock"
  ]
 },
 {
  "label": "the oldest wave comes first",
  "file": "relay/room.js",
  "from": "      .sort((a, b) => b.n - a.n);",
  "to": "      .sort((a, b) => a.n - b.n);",
  "test": "tests/room.test.js",
  "expect": [
   "wavesAt() is the phone's waiting rows, newest first, each numbered by the clock",
   "wavesAt() leaves out whoever the phone leaves out, and everyone while its person is NOT NOW",
   "wave numbers only go up: two in one millisecond differ, a second wave keeps its number, and they outlast leaving"
  ]
 },
 {
  "label": "waves from people not on SAY HI wait too",
  "file": "relay/room.js",
  "from": "  function wavesAt(id) {\n    return blue(id)",
  "to": "  function wavesAt(id) {\n    return seen(id)",
  "test": "tests/room.test.js",
  "expect": [
   "wavesAt() leaves out whoever the phone leaves out, and everyone while its person is NOT NOW"
  ]
 },
 {
  "label": "wavedAtYou reads the wave the other way",
  "file": "relay/room.js",
  "from": "return !!t && waves.has(t + '>' + viewer);",
  "to": "return !!t && waves.has(viewer + '>' + t);",
  "test": "tests/room.test.js",
  "expect": [
   "wavedAtYou() says whether the person behind a handle waved at the viewer, and nothing else"
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
Number each wave by the clock, and list who waits as the phone does

A wave in the room now has a number: the time it was made, and at least one
past the last wave its receiver was sent, so two in one millisecond differ
and a number only goes up, past leaving too. A second wave by the same person
keeps its number. room.wavesAt(id) gives the rows the person's phone shows as
"waved at you" and not waved back, newest first, each with its number; it and
viewFor()'s near list come from one helper, so a band can never count someone
the phone does not list. room.wavedAtYou(viewer, handle) says whether the
person behind a handle waved at the viewer.

Mutation-checked: 7 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 2: A band on SAY HI is told who waits, as one small object on its show

**Files:**
- Modify: `relay/band.js`, `relay/server.js`
- Test: `tests/band.test.js`, `tests/wristband.test.js`

**Interfaces:**
- Consumes: Task 1's `room.wavesAt(id)`.
- Produces: `bandShow({ ..., waves = [] })` adds `waves: { ref, n, seq }` (the newest one's handle, how many, the newest one's number) to the `hi` show and the `meet` show when the person's armed card is `hi` and anyone waits; every other show carries none. `showBand(b)` passes `r.room.wavesAt(b.person)` whenever there is a view. Rooms are made with `createRoom({ spots, now })`, the relay's own clock.

- [ ] **Step 1: Write the failing tests.** Two unit tests on `bandShow`: which shows carry `waves`, and the size check, which passes before the change on purpose: it is the guard that keeps the object small. It reads the buffer's size out of `main.cpp` and builds the longest shows the relay can make: a pick of characters JSON writes as six bytes each (which `clip()` keeps), the largest integers, and five thousand waiting. Two socket tests on the relay, with a `waving()` helper that the next task uses too: the band is told who waits as the phone lists them, one show a change, on SAY HI and on a meeting; and a wave's number is the relay's own clock, newer past a room let go while empty and past a restart (a relay of the test's own with a held clock, and `graceMs: 50`).

In `tests/band.test.js`:

````diff
--- a/tests/band.test.js
+++ b/tests/band.test.js
@@ -2,6 +2,7 @@
 
 import { test } from 'node:test';
 import assert from 'node:assert/strict';
+import { readFileSync } from 'node:fs';
 import { CODE_LETTERS, MEET_MS, bandShow, cleanCode, newCode } from '../relay/band.js';
 
 const T = Date.UTC(2026, 8, 23, 11, 0);
@@ -96,3 +97,48 @@ test("the sound switch rides on every show to its person's band, and on none tha
     assert.equal('sound' in bandShow({ view: v, sound: null, now: T }), false);
   }
 });
+
+// ---------- waves (docs/superpowers/specs/2026-09-25-wrist-waves-design.md §3) ----------
+
+test('the waves waiting ride on a show about a person on SAY HI, as the newest, a count and its number', () => {
+  const m = { id: 'm1', intent: 'song', number: 27, at: T };
+  const waves = [{ handle: 'a1b2c3d4e5', n: T + 9 }, { handle: 'f6a7b8c9d0', n: T + 2 }];
+  const want = { ref: 'a1b2c3d4e5', n: 2, seq: T + 9 };
+  assert.deepEqual(bandShow({ view: view({ armed: 'hi' }), waves, now: T }).waves, want);
+  assert.deepEqual(bandShow({ view: view({ armed: 'hi' }, [m]), waves, now: T }).waves, want, 'a meeting show too');
+  for (const s of [bandShow({ view: view({ armed: 'song' }), waves, now: T }), bandShow({ view: view({ armed: 'dance' }), waves, now: T }),
+    bandShow({ view: view(), waves, now: T }), bandShow({ view: view({ armed: 'song' }, [m]), waves, now: T }),
+    bandShow({ view: view({ armed: 'hi', invisible: true }), waves, now: T }), bandShow({ view: view({ armed: 'hi' }), testUntil: T + 1, waves, now: T }),
+    bandShow({ view: view({ armed: 'hi' }), code: 'KXRT', waves, now: T }), bandShow({ view: view({ armed: 'hi' }), check: 12, waves, now: T }),
+    bandShow({ view: null, waiting: true, waves, now: T }), bandShow({ view: null, waves, now: T })]) {
+    assert.equal('waves' in s, false, JSON.stringify(s));
+  }
+  assert.equal('waves' in bandShow({ view: view({ armed: 'hi' }), waves: [], now: T }), false, 'nobody waiting: no waves');
+  assert.equal('waves' in bandShow({ view: view({ armed: 'hi' }), now: T }), false);
+});
+
+test('the longest show the relay can make fits the band, however many wait', () => {
+  // The band drops a frame longer than its buffer whole: firmware/src/main.cpp, struct Event.
+  const cpp = readFileSync(new URL('../firmware/src/main.cpp', import.meta.url), 'utf8');
+  const size = Number(cpp.match(/struct Event \{[^}]*char text\[(\d+)\]/)[1]);
+  const worst = '\u0001'.repeat(60);   // clip() keeps it, and JSON writes each one as six bytes
+  const big = Number.MAX_SAFE_INTEGER;
+  const waves = Array.from({ length: 5000 }, (_, i) => ({ handle: 'ffffffffff', n: big - i }));
+  const m = { id: 'm1', intent: 'dance', number: 99, at: T };
+  const shows = [
+    bandShow({ view: view({ armed: 'hi', pick: worst, rev: big }, [m]), battery: 1, sound: false, waves, now: T }),
+    bandShow({ view: view({ armed: 'hi', pick: worst, rev: big }), battery: 1, sound: false, waves, now: T }),
+    bandShow({ view: view({ armed: 'song', pick: worst, rev: big }), battery: 1, sound: false, now: T }),
+    bandShow({ view: view({ armed: 'dance', rev: big }), battery: 1, sound: false, now: T }),
+    bandShow({ view: view({ invisible: true, rev: big }), battery: 100, sound: false, now: T }),
+    bandShow({ view: view({ rev: big }), battery: 100, sound: false, now: T }),
+    bandShow({ view: null, battery: 100, sound: false, now: T }),
+    bandShow({ view: null, testUntil: T + 1, sound: false, now: T }),
+    bandShow({ view: null, code: 'WWWW', now: T }),
+    bandShow({ view: null, check: 99, now: T }),
+  ];
+  for (const s of shows) {
+    const bytes = Buffer.byteLength(JSON.stringify({ t: 'show', show: s }));
+    assert.ok(bytes <= size, `${bytes} bytes over ${size}: ${JSON.stringify(s).slice(0, 60)}`);
+  }
+});
````

In `tests/wristband.test.js`:

````diff
--- a/tests/wristband.test.js
+++ b/tests/wristband.test.js
@@ -509,3 +509,109 @@ test('leave forgets the switch; the grace does not, and away carries it', async
   assert.deepEqual(await next.until((s) => s.kind === 'test'), { kind: 'test' });
   close(again, ben, band, next);
 });
+
+// ---------- waves (docs/superpowers/specs/2026-09-25-wrist-waves-design.md §3) ----------
+
+/** Ana wears a band, and ben and cai are in her room; all three on SAY HI. Each picks their own name: that is how a row is found. */
+async function waving(venue) {
+  const { band, ana } = await wearing(venue);
+  const ben = await phone(venue);
+  const cai = await phone(venue);
+  for (const [p, who] of [[ana, 'ana'], [ben, 'ben'], [cai, 'cai']]) {
+    p.send({ t: 'pick', track: who });
+    p.send({ t: 'arm', intent: 'hi' });
+  }
+  for (const p of [ana, ben, cai]) await p.until((v) => v.near.length === 2 && v.near.every((r) => r.pick));
+  await band.until((s) => s.kind === 'hi');
+  const row = (p, who) => p.view.near.find((r) => r.pick === who);
+  return { band, ana, ben, cai, row };
+}
+
+test('a band on SAY HI is told who waits as its phone lists them: the newest, how many, its number; one show a change', async () => {
+  const { band, ana, ben, cai, row } = await waving('waves-show');
+  let shows = 0;
+  band.ws.on('message', (d) => { if (JSON.parse(String(d)).t === 'show') shows++; });
+  ben.send({ t: 'wave', handle: row(ben, 'ana').handle });
+  const one = await band.until((s) => s.waves?.n === 1);
+  await ana.until(() => row(ana, 'ben').wavedAtYou);
+  assert.equal(one.waves.ref, row(ana, 'ben').handle, "the newest, by the handle ana's own phone knows");
+  cai.send({ t: 'wave', handle: row(cai, 'ana').handle });
+  const two = await band.until((s) => s.waves?.n === 2);
+  await ana.until(() => row(ana, 'cai').wavedAtYou);
+  assert.equal(two.waves.ref, row(ana, 'cai').handle);
+  assert.ok(two.waves.seq > one.waves.seq, 'a later wave has a larger number');
+  await pause(50);
+  assert.equal(shows, 2, 'one show for each change in who waits');
+  ana.send({ t: 'arm', intent: 'song' });
+  assert.equal('waves' in (await band.until((s) => s.kind === 'song')), false, 'off SAY HI, none');
+  ana.send({ t: 'arm', intent: 'hi' });
+  assert.deepEqual((await band.until((s) => s.kind === 'hi')).waves, two.waves, 'back on it, the same');
+  ana.send({ t: 'wave', handle: row(ana, 'cai').handle });
+  const meet = await band.until((s) => s.kind === 'meet');
+  assert.deepEqual(meet.waves, { ...one.waves }, 'a meeting show carries who still waits');
+  close(ana, ben, cai, band);
+});
+
+test("a wave's number is the relay's own clock: the next is newer past a room let go while empty, and past a restart", async () => {
+  let t = new Date(2026, 8, 25, 22, 0).getTime();
+  const relays = [];
+  const start = async () => {
+    const own = await createRelay({ port: 0, host: '127.0.0.1', root: dir, clock: () => t, graceMs: 50 });
+    relays.push({ own, on: helpers(() => own.port), open: true });
+    return relays.at(-1).on;
+  };
+  /** Ana on SAY HI, and someone new in the room who waves at her. */
+  const waveAt = async (on, ana) => {
+    const ben = await on.phone('waves-clock');
+    for (const p of [ana, ben]) p.send({ t: 'arm', intent: 'hi' });
+    const { near } = await ben.until((v) => v.near.length === 1);
+    ben.send({ t: 'wave', handle: near[0].handle });
+    return ben;
+  };
+  try {
+    let on = await start();
+    const band = await on.wristband();
+    const ana = await on.phone('waves-clock');
+    await on.pairBand(ana, band);
+    t += 3_000;                                    // past the white flash a new pairing gives
+    const ben = await waveAt(on, ana);
+    const first = (await band.until((s) => s.waves)).waves.seq;
+    assert.equal(first, t, "the relay's clock");
+
+    // Everyone goes, and the room is let go. The band comes back paired, with no letters.
+    band.ws.close();
+    ana.ws.close();
+    ben.send({ t: 'leave' });
+    await pause(200);
+    assert.equal(relays[0].own.rooms.has('waves-clock'), false, 'the room was let go');
+    t += 60_000;
+    const back = await on.wristband(62, { key: band.key, secret: band.secret });
+    assert.equal(back.show.away, true, 'paired still: away, not letters');
+    const anaBack = await on.phone('waves-clock', { me: ana.me });
+    await waveAt(on, anaBack);
+    const second = (await back.until((s) => s.waves)).waves.seq;
+    assert.equal(second, t);
+    assert.ok(second > first);
+
+    // A restart: a new relay, a later clock. The band waits for its owner, and her phone claims it.
+    relays[0].on.cleanup();
+    await relays[0].own.close();
+    relays[0].open = false;
+    t += 60_000;
+    on = await start();
+    const again = await on.wristband(62, { key: band.key, secret: band.secret });
+    assert.deepEqual(again.show, { kind: 'waiting' });
+    const anaAgain = await on.phone('waves-clock', { me: ana.me });
+    anaAgain.send({ t: 'pair', band: again.id, secret: band.secret, again: true });
+    await again.until((s) => s.kind === 'off' && !s.away);
+    await waveAt(on, anaAgain);
+    const third = (await again.until((s) => s.waves)).waves.seq;
+    assert.equal(third, t);
+    assert.ok(third > second);
+  } finally {
+    for (const r of relays) {
+      r.on.cleanup();
+      if (r.open) await r.own.close();
+    }
+  }
+});
````

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build >/dev/null && node --test tests/band.test.js tests/wristband.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: `ℹ pass 43`, `ℹ fail 3`.

Red (3):

- the waves waiting ride on a show about a person on SAY HI, as the newest, a count and its number
- a band on SAY HI is told who waits as its phone lists them: the newest, how many, its number; one show a change
- a wave's number is the relay's own clock: the next is newer past a room let go while empty, and past a restart

- [ ] **Step 3: Implement.**

In `relay/band.js`:

````diff
--- a/relay/band.js
+++ b/relay/band.js
@@ -27,6 +27,7 @@ const short = (s, n) => {
  * @param {boolean} p.waiting     after a relay restart, until its owner's phone claims it
  * @param {number} p.testUntil    TEST THE LIGHT runs until this time
  * @param {boolean|null} p.sound  the person's sound switch, once their phone has said it; null before
+ * @param {Array} p.waves         room.wavesAt(): who waved at the person and waits, newest first, as { handle, n }
  * @param {number} p.now
  *
  * A show made from the person's view carries `armed` (null for none) and the
@@ -40,8 +41,14 @@ const short = (s, n) => {
  * and TEST THE LIGHT) and not in a room. Letters, the check and waiting carry
  * none: those bands are nobody's yet, or not known to be whose. A show made
  * without a known switch is exactly the show made before there was one.
+ *
+ * A show about a person on SAY HI, a meeting's included, carries the waves
+ * waiting for them as one small object: the newest one's handle (as the
+ * person's own phone knows it), how many wait, and the newest one's number.
+ * It is the same size however many wait, so it never outgrows the band's
+ * buffer. Every other show carries none, which the wrist reads as nobody.
  */
-export function bandShow({ view = null, battery = null, code = null, check = null, waiting = false, testUntil = 0, sound = null, now = Date.now() }) {
+export function bandShow({ view = null, battery = null, code = null, check = null, waiting = false, testUntil = 0, sound = null, waves = [], now = Date.now() }) {
   if (check) return { kind: 'check', big: String(check) };
   if (code) return { kind: 'pairing', code };
   if (waiting) return { kind: 'waiting' };
@@ -52,12 +59,13 @@ export function bandShow({ view = null, battery = null, code = null, check = nul
   const about = { armed: view.me.armed ?? null, rev: view.me.rev ?? 0, ...said };
   // NOT NOW is black, completely. Nothing broadcasting, and nothing to read.
   if (view.me.invisible) return { kind: 'off', battery, quiet: true, ...about };
+  const waved = view.me.armed === 'hi' && waves.length ? { waves: { ref: waves[0].handle, n: waves.length, seq: waves[0].n } } : {};
   const meet = view.matches
     .filter((m) => now - m.at < MEET_MS)
     .sort((a, b) => b.at - a.at)[0];
-  if (meet) return { kind: 'meet', intent: meet.intent, big: String(meet.number), small: 'MEET', dim, ...about };
+  if (meet) return { kind: 'meet', intent: meet.intent, big: String(meet.number), small: 'MEET', dim, ...about, ...waved };
   switch (view.me.armed) {
-    case 'hi': return { kind: 'hi', intent: 'hi', big: 'HI :)', small: 'blue means hello', dim, ...about };
+    case 'hi': return { kind: 'hi', intent: 'hi', big: 'HI :)', small: 'blue means hello', dim, ...about, ...waved };
     case 'song': return { kind: 'song', intent: 'song', big: 'FIRST SONG?', small: short(view.me.pick, 16), dim, ...about };
     case 'dance': return { kind: 'dance', intent: 'dance', big: "LET'S DANCE!", small: '', dim, ...about };
     default: return { kind: 'off', battery, ...about };
````

In `relay/server.js`:

````diff
--- a/relay/server.js
+++ b/relay/server.js
@@ -94,7 +94,8 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
       const show = shows.find((s) => s.id === key);
       const spots = Array.isArray(show?.spots) && show.spots.length ? show.spots.map(String) : SPOTS;
       // sound: each person's sound switch, as their phone last said it. Leaving forgets it; the grace does not.
-      rooms.set(key, { key, room: createRoom({ spots }), sockets: new Set(), clips: new Map(), left: new Map(), heard: new Map(), sound: new Map() });
+      // The room reads the relay's clock: a wave's number is the time it was made, so it only goes up.
+      rooms.set(key, { key, room: createRoom({ spots, now }), sockets: new Set(), clips: new Map(), left: new Map(), heard: new Map(), sound: new Map() });
     }
     return rooms.get(key);
   }
@@ -193,7 +194,8 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
     const r = b.key ? rooms.get(b.key) : null;
     const view = r?.room.viewFor(b.person) ?? null;
     const sound = r?.sound.get(b.person) ?? null;
-    const text = JSON.stringify({ t: 'show', show: bandShow({ view, battery: b.battery, code: b.code, check: b.pending?.number ?? null, waiting: b.waiting, testUntil: b.testUntil, sound, now }) });
+    const waves = view ? r.room.wavesAt(b.person) : [];
+    const text = JSON.stringify({ t: 'show', show: bandShow({ view, battery: b.battery, code: b.code, check: b.pending?.number ?? null, waiting: b.waiting, testUntil: b.testUntil, sound, waves, now }) });
     if (text !== b.lastShow) { b.lastShow = text; b.ws.send(text); }
   }
 
````

- [ ] **Step 4: Run** — the files, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 282`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "waves ride on every card",
  "file": "relay/band.js",
  "from": "const waved = view.me.armed === 'hi' && waves.length ?",
  "to": "const waved = waves.length ?",
  "test": "tests/band.test.js",
  "expect": [
   "the waves waiting ride on a show about a person on SAY HI, as the newest, a count and its number"
  ]
 },
 {
  "label": "the whole list rides on the show",
  "file": "relay/band.js",
  "from": "{ waves: { ref: waves[0].handle, n: waves.length, seq: waves[0].n } }",
  "to": "{ waves: { ref: waves[0].handle, n: waves.length, seq: waves[0].n, all: waves } }",
  "test": "tests/band.test.js",
  "expect": [
   "the waves waiting ride on a show about a person on SAY HI, as the newest, a count and its number",
   "the longest show the relay can make fits the band, however many wait"
  ]
 },
 {
  "label": "a meeting show carries no waves",
  "file": "relay/band.js",
  "from": "small: 'MEET', dim, ...about, ...waved };",
  "to": "small: 'MEET', dim, ...about };",
  "test": "tests/band.test.js",
  "expect": [
   "the waves waiting ride on a show about a person on SAY HI, as the newest, a count and its number"
  ]
 },
 {
  "label": "the oldest waiter is the ref",
  "file": "relay/band.js",
  "from": "ref: waves[0].handle",
  "to": "ref: waves[waves.length - 1].handle",
  "test": "tests/band.test.js",
  "expect": [
   "the waves waiting ride on a show about a person on SAY HI, as the newest, a count and its number"
  ]
 },
 {
  "label": "rooms keep the machine's clock",
  "file": "relay/server.js",
  "from": "createRoom({ spots, now })",
  "to": "createRoom({ spots })",
  "test": "tests/wristband.test.js",
  "expect": [
   "a wave's number is the relay's own clock: the next is newer past a room let go while empty, and past a restart"
  ]
 },
 {
  "label": "the relay tells the band nobody waits",
  "file": "relay/server.js",
  "from": "const waves = view ? r.room.wavesAt(b.person) : [];",
  "to": "const waves = [];",
  "test": "tests/wristband.test.js",
  "expect": [
   "a band on SAY HI is told who waits as its phone lists them: the newest, how many, its number; one show a change",
   "a wave's number is the relay's own clock: the next is newer past a room let go while empty, and past a restart"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add relay/band.js relay/server.js tests/band.test.js tests/wristband.test.js
```

````bash
git commit -F - <<'EOF'
Tell a band on SAY HI who waits, as one small object on its show

A show about a paired person on SAY HI, a meeting show included, carries
waves: {ref, n, seq} while anyone waits: the newest one's handle as the
person's own phone knows it, how many wait, and the newest one's number.
It is the same size however many wait; a test builds the longest show the
relay can make from the worst escapes and holds it to the band's frame
buffer, read from main.cpp. Every other show carries none. Rooms now take the
relay's clock, so a wave's number is the relay's own time, newer past a room
let go while empty and past a restart.

Mutation-checked: 6 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 3: A band waves back for its person, or is refused with a reason

**Files:**
- Modify: `relay/server.js`, `relay/room.js`
- Test: `tests/wristband.test.js`, `tests/relay-harness.js`

**Interfaces:**
- Consumes: Task 1's `room.wavedAtYou()` and `room.wave()`; Task 2's `waving()` test helper; `room.revOf(id)`.
- Produces: the band message `{ t: 'wave', ref, basis }`, with `ref` ten lower-case hex and `basis` an integer; anything else is dropped whole, unanswered and unstamped. Answers `{ t: 'wave', ok: true }`, or `{ t: 'wave', ok: false, why }` with `why` one of `too fast`, `unpaired`, `no room`, `changed`, `gone`, in that order of checking. `WAVE_GAP_MS = 1000` and the band record's `waveAt`, stamped before anything is looked up, refused or not. `room.armedOf(id)`. A wave that lands is `room.wave(person, ref)`, and the relay pushes as after any change; a refused one pushes nothing. The harness keeps a band's `wave` replies in `band.replies`.

- [ ] **Step 1: Write the failing tests.** Six socket tests: a band's wave back makes the match, and both bands and both phones show the meeting; a malformed wave is dropped unanswered, then `unpaired`, `too fast` (a refused wave is still stamped) and `no room`; `changed` for a rev that moved, off SAY HI, and NOT NOW; `gone` for someone who never waved (nothing reaches them), a made-up ref, a waver who stopped showing blue (nothing reaches their phone), went NOT NOW, or left, and a block that reads exactly as leaving, with a second made-up ref in one second refused `too fast`; a hello without the pairing secret cannot wave for anyone; and two people already matched get `ok` and no second meeting. The refusal tests use a relay of their own with a held clock (`heldRelay`), which must be moved past the white flash a new pairing gives.

In `tests/wristband.test.js`:

````diff
--- a/tests/wristband.test.js
+++ b/tests/wristband.test.js
@@ -512,21 +512,50 @@ test('leave forgets the switch; the grace does not, and away carries it', async
 
 // ---------- waves (docs/superpowers/specs/2026-09-25-wrist-waves-design.md §3) ----------
 
-/** Ana wears a band, and ben and cai are in her room; all three on SAY HI. Each picks their own name: that is how a row is found. */
-async function waving(venue) {
-  const { band, ana } = await wearing(venue);
-  const ben = await phone(venue);
-  const cai = await phone(venue);
+/**
+ * Ana wears a band, and ben and cai are in her room; all three on SAY HI. Each
+ * picks their own name: that is how a row is found. `on` and `clock` are for
+ * a relay of a test's own, whose held clock is moved past the pairing flash.
+ */
+async function waving(venue, on = { phone, wristband, pairBand }, clock = null) {
+  const band = await on.wristband();
+  const ana = await on.phone(venue);
+  await on.pairBand(ana, band);
+  if (clock) clock.t += 3_000;                    // past the white flash a new pairing gives
+  const ben = await on.phone(venue);
+  const cai = await on.phone(venue);
   for (const [p, who] of [[ana, 'ana'], [ben, 'ben'], [cai, 'cai']]) {
     p.send({ t: 'pick', track: who });
     p.send({ t: 'arm', intent: 'hi' });
   }
   for (const p of [ana, ben, cai]) await p.until((v) => v.near.length === 2 && v.near.every((r) => r.pick));
-  await band.until((s) => s.kind === 'hi');
+  await band.until((s) => s.kind === 'hi', 5000);
   const row = (p, who) => p.view.near.find((r) => r.pick === who);
   return { band, ana, ben, cai, row };
 }
 
+/** A relay of a test's own, with its clock held: a second is the relay's, not the machine's. */
+async function heldRelay(fn) {
+  const clock = { t: new Date(2026, 8, 25, 23, 0).getTime() };
+  const own = await createRelay({ port: 0, host: '127.0.0.1', root: dir, clock: () => clock.t });
+  const on = helpers(() => own.port);
+  try {
+    await fn(on, clock, own);
+  } finally {
+    on.cleanup();
+    await own.close();
+  }
+}
+
+/** A band's own wave back, and the relay's answer. */
+async function waveBack(band, ref, basis) {
+  const before = band.replies.length;
+  band.send({ t: 'wave', ref, basis });
+  await band.until((s, b) => b.replies.length > before);
+  return band.replies.at(-1);
+}
+const refused = (why) => ({ t: 'wave', ok: false, why });
+
 test('a band on SAY HI is told who waits as its phone lists them: the newest, how many, its number; one show a change', async () => {
   const { band, ana, ben, cai, row } = await waving('waves-show');
   let shows = 0;
@@ -615,3 +644,145 @@ test("a wave's number is the relay's own clock: the next is newer past a room le
     }
   }
 });
+
+test("a band's wave back makes the match: it is answered ok, and both bands and both phones show the meeting", async () => {
+  const { band, ana, ben, cai, row } = await waving('waves-back');
+  const his = await wristband();
+  await pairBand(ben, his);
+  await his.until((s) => s.kind === 'hi', 5000);
+  ben.send({ t: 'wave', handle: row(ben, 'ana').handle });
+  const s = await band.until((x) => x.waves);
+  assert.deepEqual(await waveBack(band, s.waves.ref, s.rev), { t: 'wave', ok: true });
+  const [a, b] = await Promise.all([band.until((x) => x.kind === 'meet'), his.until((x) => x.kind === 'meet')]);
+  assert.equal(a.big, b.big, 'one number on both wrists');
+  const [m] = (await ana.until((v) => v.matches.length === 1)).matches;
+  assert.equal(String(m.number), a.big, "and on ana's phone");
+  assert.equal(String((await ben.until((v) => v.matches.length === 1)).matches[0].number), a.big, "and on ben's");
+  close(ana, ben, cai, band, his);
+});
+
+test('a malformed wave from a band is dropped unanswered; the rest are refused unpaired, no room, and too fast before anything is looked up', async () => {
+  await heldRelay(async (on, clock, own) => {
+    const loose = await on.wristband();
+    for (const m of [{ t: 'wave' }, { t: 'wave', ref: 'a1b2c3d4e5' }, { t: 'wave', ref: 'a1b2c3d4e5', basis: '1' },
+      { t: 'wave', ref: 'a1b2c3d4e5', basis: 1.5 }, { t: 'wave', ref: 'A1B2C3D4E5', basis: 1 }, { t: 'wave', ref: 'a1b2c3d4e', basis: 1 },
+      { t: 'wave', ref: 'a1b2c3d4e5f', basis: 1 }, { t: 'wave', ref: 'g1b2c3d4e5', basis: 1 }, { t: 'wave', ref: 1234567890, basis: 1 }]) {
+      loose.send(m);
+      await pause(40);
+      assert.deepEqual(loose.replies, [], JSON.stringify(m));
+    }
+    // None of those was stamped: this one, in the same second, is looked at.
+    assert.deepEqual(await waveBack(loose, 'a1b2c3d4e5', 1), refused('unpaired'));
+    assert.deepEqual(await waveBack(loose, 'b1b2c3d4e5', 1), refused('too fast'), 'the last was refused, and still stamped');
+    clock.t += 1_000;
+    assert.deepEqual(await waveBack(loose, 'b1b2c3d4e5', 1), refused('unpaired'), 'a second on');
+
+    const band = await on.wristband();
+    const ana = await on.phone('waves-noroom');
+    await on.pairBand(ana, band);
+    clock.t += 3_000;                              // past the white flash a new pairing gives
+    ana.ws.close();
+    await pause(100);
+    own.expire(clock.t + BAND_ALONE_MS + 1_000);   // held only by the wristband, for the hour
+    await band.until((s) => s.away);
+    assert.deepEqual(await waveBack(band, 'a1b2c3d4e5', 1), refused('no room'));
+  });
+});
+
+test("a band's wave is refused changed when its person's rev moved, or they left SAY HI or went NOT NOW", async () => {
+  await heldRelay(async (on, clock) => {
+    const { band, ana, ben, row } = await waving('waves-changed', on, clock);
+    ben.send({ t: 'wave', handle: row(ben, 'ana').handle });
+    const s = await band.until((x) => x.waves);
+    ana.send({ t: 'arm', intent: 'song' });
+    ana.send({ t: 'arm', intent: 'hi' });
+    await band.until((x) => x.kind === 'hi' && x.rev === s.rev + 2);
+    assert.deepEqual(await waveBack(band, s.waves.ref, s.rev), refused('changed'), 'a rev that moved');
+    clock.t += 1_000;
+    ana.send({ t: 'arm', intent: 'song' });
+    const song = await band.until((x) => x.kind === 'song');
+    assert.deepEqual(await waveBack(band, s.waves.ref, song.rev), refused('changed'), 'not on SAY HI');
+    clock.t += 1_000;
+    ana.send({ t: 'invisible', on: true });
+    const quiet = await band.until((x) => x.quiet);
+    assert.deepEqual(await waveBack(band, s.waves.ref, quiet.rev), refused('changed'), 'NOT NOW');
+    await pause(50);
+    assert.deepEqual([ana.view.matches, ben.view.matches], [[], []]);
+  });
+});
+
+test("a band's wave is refused gone for anyone not waiting on its person, a block reading exactly as leaving; a refused one tells nobody", async () => {
+  await heldRelay(async (on, clock) => {
+    const { band, ana, ben, cai, row } = await waving('waves-gone', on, clock);
+    const hi = band.show;
+    // A band never starts a wave: cai never waved, so nothing is recorded and nothing reaches his phone.
+    assert.deepEqual(await waveBack(band, row(ana, 'cai').handle, hi.rev), refused('gone'), 'not a waver');
+    await pause(50);
+    assert.equal(row(cai, 'ana').wavedAtYou, false, 'nothing reached cai');
+    clock.t += 1_000;
+    assert.deepEqual(await waveBack(band, 'a1b2c3d4e5', hi.rev), refused('gone'), 'a made-up ref');
+    assert.deepEqual(await waveBack(band, 'b1b2c3d4e5', hi.rev), refused('too fast'), 'a second made-up ref in the same second');
+
+    /** Ben back on SAY HI, and the ref ana's band is given for his wave. */
+    const ref = async () => { ben.send({ t: 'arm', intent: 'hi' }); return (await band.until((x) => x.waves)).waves.ref; };
+    ben.send({ t: 'wave', handle: row(ben, 'ana').handle });
+    let r = await ref();
+    ben.send({ t: 'arm', intent: 'song' });
+    await band.until((x) => !x.waves);
+    await pause(50);
+    let heard = 0;
+    const count = () => { heard += 1; };
+    ben.ws.on('message', count);
+    clock.t += 1_000;
+    assert.deepEqual(await waveBack(band, r, hi.rev), refused('gone'), 'the waver stopped showing blue');
+    await pause(50);
+    ben.ws.off('message', count);
+    assert.equal(heard, 0, "a refused wave sends nothing to the waver's phone");
+    r = await ref();
+    ben.send({ t: 'invisible', on: true });
+    await band.until((x) => !x.waves);
+    clock.t += 1_000;
+    assert.deepEqual(await waveBack(band, r, hi.rev), refused('gone'), 'the waver went NOT NOW');
+    r = await ref();
+    ben.send({ t: 'leave' });
+    await band.until((x) => !x.waves);
+    clock.t += 1_000;
+    const left = await waveBack(band, r, hi.rev);
+    assert.deepEqual(left, refused('gone'), 'the waver left');
+    cai.send({ t: 'wave', handle: row(cai, 'ana').handle });
+    r = (await band.until((x) => x.waves)).waves.ref;
+    cai.send({ t: 'block', handle: row(cai, 'ana').handle });
+    await band.until((x) => !x.waves);
+    clock.t += 1_000;
+    assert.deepEqual(await waveBack(band, r, hi.rev), left, 'blocked reads exactly as left');
+    assert.deepEqual(ana.view.matches, []);
+  });
+});
+
+test('a hello without the pairing secret cannot wave for anyone', async () => {
+  const { band, ana, ben, cai, row } = await waving('waves-secret');
+  ben.send({ t: 'wave', handle: row(ben, 'ana').handle });
+  const s = await band.until((x) => x.waves);
+  const fake = await hello({ t: 'wristband', id: band.id, key: band.key, v: 2 });
+  assert.deepEqual([fake.reply.why, fake.closed], ['bad band', 4001], "ana's band without its secret");
+  const stranger = await wristband();
+  assert.deepEqual(await waveBack(stranger, s.waves.ref, s.rev), refused('unpaired'), "another band, with ana's ref and rev");
+  await pause(50);
+  assert.deepEqual([ana.view.matches, ben.view.matches, band.show.waves.n], [[], [], 1]);
+  close(ana, ben, cai, band, stranger);
+});
+
+test("two people already matched tonight: a band's wave back is answered ok, and makes no second meeting", async () => {
+  const { band, ana, ben, cai, row } = await waving('waves-matched');
+  const wall = (p, who) => p.view.wall.find((r) => r.pick === who).handle;
+  ana.send({ t: 'like', handle: wall(ana, 'ben') });
+  ben.send({ t: 'like', handle: wall(ben, 'ana') });
+  const [m] = (await ana.until((v) => v.matches.length === 1)).matches;
+  await band.until((x) => x.kind === 'meet');
+  ben.send({ t: 'wave', handle: row(ben, 'ana').handle });
+  const s = await band.until((x) => x.waves);
+  assert.deepEqual(await waveBack(band, s.waves.ref, s.rev), { t: 'wave', ok: true });
+  await pause(100);
+  assert.deepEqual(ana.view.matches.map((x) => [x.id, x.number]), [[m.id, m.number]], 'the match they had, and no other');
+  close(ana, ben, cai, band);
+});
````

In `tests/relay-harness.js`:

````diff
--- a/tests/relay-harness.js
+++ b/tests/relay-harness.js
@@ -57,7 +57,7 @@ export function helpers(port) {
       const m = JSON.parse(String(data));
       if (m.t === 'show') b.show = m.show;
       if (m.t === 'paired') b.secret = m.secret;
-      if (m.t === 'set' || m.t === 'error') b.replies.push(m);
+      if (m.t === 'set' || m.t === 'wave' || m.t === 'error') b.replies.push(m);
       b.waiters = b.waiters.filter((w) => !w());
     });
     await new Promise((resolve) => ws.once('open', resolve));
````

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build >/dev/null && node --test tests/wristband.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: `ℹ pass 34`, `ℹ fail 6`.

Red (6):

- a band's wave back makes the match: it is answered ok, and both bands and both phones show the meeting
- a malformed wave from a band is dropped unanswered; the rest are refused unpaired, no room, and too fast before anything is looked up
- a band's wave is refused changed when its person's rev moved, or they left SAY HI or went NOT NOW
- a band's wave is refused gone for anyone not waiting on its person, a block reading exactly as leaving; a refused one tells nobody
- a hello without the pairing secret cannot wave for anyone
- two people already matched tonight: a band's wave back is answered ok, and makes no second meeting

- [ ] **Step 3: Implement.**

In `relay/server.js`:

````diff
--- a/relay/server.js
+++ b/relay/server.js
@@ -30,6 +30,7 @@ const CLIP_TTL_MS = 3_600_000;        // "it loops on the floor for an hour"
 const PING_MS = 15_000;
 const BAND_GRACE_MS = 60_000;         // a wristband that drops keeps its letters this long
 const SET_GAP_MS = 1000;              // a wristband may change its person at most once a second
+const WAVE_GAP_MS = 1000;             // and wave back at most once a second, on a stamp of its own
 const TRIES_MS = 60_000;              // the window pairing attempts are counted in
 const SOCKET_TRIES = 5;               // pairing attempts one socket may make in it
 const ADDRESS_TRIES = 20;             // pairing attempts one address may make in it, over every socket
@@ -167,6 +168,7 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
     waitingAt: 0,
     quiet: false,       // a hold with nobody in a room to hide, kept until they are
     setAt: 0,           // when this wristband last changed its person (rule 1)
+    waveAt: 0,          // when it last waved back, landed or not
   });
 
   // How long a record has been dead weight: a live wristband is never that, a
@@ -257,6 +259,29 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
     return true;
   }
 
+  /**
+   * A wave back from the wrist, to the newest who waved at its person
+   * (docs/superpowers/specs/2026-09-25-wrist-waves-design.md §3). The relay
+   * answers ok, or no and why; a refused wave changes nothing and tells
+   * nobody else. Returns whether it landed.
+   */
+  function waveFromBand(ws, b, m) {
+    // Dropped whole, unanswered and unstamped, unless it is exactly a wave.
+    if (typeof m.ref !== 'string' || !/^[a-f0-9]{10}$/.test(m.ref) || !Number.isInteger(m.basis)) return false;
+    const answer = (why) => { ws.send(JSON.stringify(why ? { t: 'wave', ok: false, why } : { t: 'wave', ok: true })); return !why; };
+    // Stamped before anything is looked up, refused or not: finding a handle is a pass over the room.
+    if (now() - b.waveAt < WAVE_GAP_MS) return answer('too fast');
+    b.waveAt = now();
+    if (!b.person) return answer('unpaired');
+    const room = rooms.get(b.key)?.room;
+    if (!room?.has(b.person)) return answer('no room');
+    if (m.basis !== room.revOf(b.person) || room.armedOf(b.person) !== 'hi') return answer('changed');
+    // Not someone who waved at its person, or no longer someone it may wave at. A block must read exactly as
+    // leaving (promise 4). A band never starts a wave: with none to answer, nothing is recorded.
+    if (!room.wavedAtYou(b.person, m.ref) || room.wave(b.person, m.ref) === false) return answer('gone');
+    return answer(null);
+  }
+
   function handleBand(ws, m) {
     const b = bands.get(ws.band);
     // Only from the wristband's current socket: a set stuck in a replaced one must not land.
@@ -265,6 +290,7 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
     // Held: NOT NOW, from the wrist. The phone follows.
     if (m.t === 'hold') holdOn(b);
     if (m.t === 'set' && !setFromBand(ws, b, m)) return;
+    if (m.t === 'wave' && !waveFromBand(ws, b, m)) return;
     const r = b.key ? rooms.get(b.key) : null;
     if (r) push(r); else showBand(b);
   }
````

In `relay/room.js`:

````diff
--- a/relay/room.js
+++ b/relay/room.js
@@ -384,6 +384,8 @@ export function createRoom({
     has: (id) => people.has(id),
     /** The rev a wristband's `set` must name (rule 1), or null for someone not here. */
     revOf: (id) => people.get(id)?.rev ?? null,
+    /** What a wristband's wave back needs its person to show: SAY HI. */
+    armedOf: (id) => people.get(id)?.armed ?? null,
     reports: () => reports.slice(),
     size: () => people.size,
   };
````

- [ ] **Step 4: Run** — the file, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 288`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`. A refused wave that pushed anyway would not be caught, and needs no guard: a push sends a view or a show only when its text changed, and a refusal changes nothing.

````json
[
 {
  "label": "a ref that is not ten hex is taken",
  "file": "relay/server.js",
  "from": "if (typeof m.ref !== 'string' || !/^[a-f0-9]{10}$/.test(m.ref) || !Number.isInteger(m.basis)) return false;",
  "to": "if (typeof m.ref !== 'string' || !Number.isInteger(m.basis)) return false;",
  "test": "tests/wristband.test.js",
  "expect": [
   "a malformed wave from a band is dropped unanswered; the rest are refused unpaired, no room, and too fast before anything is looked up"
  ]
 },
 {
  "label": "a basis that is not an integer is taken",
  "file": "relay/server.js",
  "from": "/^[a-f0-9]{10}$/.test(m.ref) || !Number.isInteger(m.basis)) return false;",
  "to": "/^[a-f0-9]{10}$/.test(m.ref)) return false;",
  "test": "tests/wristband.test.js",
  "expect": [
   "a malformed wave from a band is dropped unanswered; the rest are refused unpaired, no room, and too fast before anything is looked up"
  ]
 },
 {
  "label": "a wave is stamped only after the band and room are found",
  "file": "relay/server.js",
  "from": "    if (now() - b.waveAt < WAVE_GAP_MS) return answer('too fast');\n    b.waveAt = now();\n    if (!b.person) return answer('unpaired');\n    const room = rooms.get(b.key)?.room;\n    if (!room?.has(b.person)) return answer('no room');",
  "to": "    if (now() - b.waveAt < WAVE_GAP_MS) return answer('too fast');\n    if (!b.person) return answer('unpaired');\n    const room = rooms.get(b.key)?.room;\n    if (!room?.has(b.person)) return answer('no room');\n    b.waveAt = now();",
  "test": "tests/wristband.test.js",
  "expect": [
   "a malformed wave from a band is dropped unanswered; the rest are refused unpaired, no room, and too fast before anything is looked up"
  ]
 },
 {
  "label": "no gap between waves",
  "file": "relay/server.js",
  "from": "if (now() - b.waveAt < WAVE_GAP_MS) return answer('too fast');",
  "to": "if (false) return answer('too fast');",
  "test": "tests/wristband.test.js",
  "expect": [
   "a malformed wave from a band is dropped unanswered; the rest are refused unpaired, no room, and too fast before anything is looked up",
   "a band's wave is refused gone for anyone not waiting on its person, a block reading exactly as leaving; a refused one tells nobody"
  ]
 },
 {
  "label": "an unpaired band is not refused unpaired",
  "file": "relay/server.js",
  "from": "    if (!b.person) return answer('unpaired');\n",
  "to": "",
  "test": "tests/wristband.test.js",
  "expect": [
   "a malformed wave from a band is dropped unanswered; the rest are refused unpaired, no room, and too fast before anything is looked up",
   "a hello without the pairing secret cannot wave for anyone"
  ]
 },
 {
  "label": "changed ignores the rev",
  "file": "relay/server.js",
  "from": "if (m.basis !== room.revOf(b.person) || room.armedOf(b.person) !== 'hi') return answer('changed');",
  "to": "if (room.armedOf(b.person) !== 'hi') return answer('changed');",
  "test": "tests/wristband.test.js",
  "expect": [
   "a band's wave is refused changed when its person's rev moved, or they left SAY HI or went NOT NOW"
  ]
 },
 {
  "label": "changed ignores SAY HI",
  "file": "relay/server.js",
  "from": "if (m.basis !== room.revOf(b.person) || room.armedOf(b.person) !== 'hi') return answer('changed');",
  "to": "if (m.basis !== room.revOf(b.person)) return answer('changed');",
  "test": "tests/wristband.test.js",
  "expect": [
   "a band's wave is refused changed when its person's rev moved, or they left SAY HI or went NOT NOW"
  ]
 },
 {
  "label": "a band can start a wave",
  "file": "relay/server.js",
  "from": "if (!room.wavedAtYou(b.person, m.ref) || room.wave(b.person, m.ref) === false) return answer('gone');",
  "to": "if (room.wave(b.person, m.ref) === false) return answer('gone');",
  "test": "tests/wristband.test.js",
  "expect": [
   "a band's wave is refused gone for anyone not waiting on its person, a block reading exactly as leaving; a refused one tells nobody"
  ]
 }
]
````

- [ ] **Step 6: Commit, and close Stage A with P2**

```bash
git add relay/server.js relay/room.js tests/wristband.test.js tests/relay-harness.js
```

````bash
git commit -F - <<'EOF'
Let a band wave back for its person, and refuse it with a reason

A band's {t:'wave', ref, basis} is dropped whole, unanswered, unless it is
exactly that. Then, in order: too fast (one a second, on a stamp of its own,
taken before any lookup and whether or not it lands, so made-up handles buy
nothing), unpaired, no room, changed (the rev moved, or its person is not on
SAY HI), and gone when the handle is not someone who waved at its person or
the room refuses the wave; a block reads exactly as leaving. Otherwise the
room takes it as its person waving, answers ok and pushes. A band never
starts a wave, a refused one tells nobody else, and two people already
matched get ok and no second meeting.

Mutation-checked: 8 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---

## Stage B — The wrist

Every task in this stage changes both twins and the one table (Task 7 only the band's console). The table's step keys are the reactions plan's: `"sounds"` exact and `[]` unless said, `"press"` with `"downSounds"` (default `["tick"]`), and `"show"` with `"with"` laid over it, here `"with": { "waves": { "ref": ..., "n": ..., "seq": ... } }`. Run the table on both twins with `npm run build >/dev/null && node --test tests/wrist.test.js tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`. Each case runs as `wrist.js: <name>` and as `band_logic.h: <name>`.

The cases' numbers are the relay's clock: `S = 1790337603000`. On a `HI` show a wave is `{ "ref": "a1b2c3d4e5", "n": 1, "seq": S }`; later ones take a larger `seq`.

### Task 4: A wave calls: hello, and the HI blue three times

**Files:**
- Modify: `app/lib/wrist.js`, `firmware/src/band_logic.h`
- Test: `tests/fixtures/wrist-cases.json`

**Interfaces:**
- Consumes: the reactions plan's `react(sound, flash, cls)`, `settle()`, `advance()`, `playing`, `queue`, `moment`, `blinking(now)`, `silent`, `soundOn`, `due`.
- Produces: `SOUNDS.hello` and `FLASHES.wave` in both twins. A show's waves are read apart from the show (`readWaves(s)` in JS; `Frame::waves`, a `struct Waves { std::string ref; int64_t n, seq; }`, in C++), so a show that differs only in its waves is `same`. `waveSeq` (64-bit in C++), the newest number called for, forgotten at the letters; `waveOwed`, flashes waiting for the resting face. A reaction gains `whole`, true for the `wave` flash. `waveFlashing(now)`, `waveCalling()`, `callWave()`. In `heardFrame`: the number moves up for any newer `seq`; NOT NOW returns before any reaction; the old reactions run only when the show is not `same`; then a newer wave calls unless a wave call is playing, queued or owed. Keys: during the flashes a key down only ticks (straight into `due`, so it does not replace the call), a release does nothing, a SIDE hold that comes due does nothing, and the answer to a meeting waits for the first key after them.

- [ ] **Step 1: Write the failing cases.**

In `tests/fixtures/wrist-cases.json`:

````diff
--- a/tests/fixtures/wrist-cases.json
+++ b/tests/fixtures/wrist-cases.json
@@ -844,6 +844,151 @@
         { "at": "1000+1200", "face": { "big": "KXRT", "light": "LIGHT_PAIR" } },
         { "at": "5000" }
       ]
+    },
+    {
+      "name": "a wave newer than any called for plays hello and flashes the HI blue three times, 500 on and 500 off",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "face": { "big": "HI :)", "light": "LIGHT_FULL" } },
+        { "at": "1000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"], "face": { "big": "", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "1499", "face": { "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "1500", "face": { "big": "HI :)", "light": "LIGHT_OFF" } },
+        { "at": "3000", "face": { "big": "", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "3999", "face": { "big": "HI :)", "light": "LIGHT_OFF" } },
+        { "at": "4000", "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "field": "hi", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "during a wave's flashes a press, a release and a SIDE hold only tick, a key already down included; after them keys work again",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "500", "key2": "down", "sounds": ["tick"] },
+        { "at": "1000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "1200", "key2": "up", "face": { "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "1400", "press": 2, "face": { "small": "BLUE MEANS HELLO", "light": "LIGHT_OFF" } },
+        { "at": "1600", "key2": "down", "sounds": ["tick"], "face": { "light": "LIGHT_OFF" } },
+        { "at": "1600+HOLD_MS", "face": { "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "3200", "key2": "up", "face": { "field": "hi" } },
+        { "at": "4000", "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "light": "LIGHT_FULL" } },
+        { "at": "4100", "press": 2, "face": { "big": "HI :)", "small": "SIDE TO CHANGE" } }
+      ]
+    },
+    {
+      "name": "a FACE hold during a wave's flashes goes NOT NOW, dark at once",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "1200", "key1": "down", "sounds": ["tick"] },
+        { "at": "1200+HOLD_MS", "sounds": ["down"], "sent": [{ "t": "hold" }], "face": { "big": "", "light": "LIGHT_OFF" } },
+        { "at": "3000", "key1": "up", "face": { "big": "", "light": "LIGHT_OFF" } }
+      ]
+    },
+    {
+      "name": "a meeting calling under a wave's flashes is answered by the first key after them, not before",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "2000", "show": "MEET", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"], "face": { "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "2200", "press": 1, "face": { "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "5500", "face": { "big": "27", "light": "LIGHT_OFF" } },
+        { "at": "5600", "press": 1, "face": { "big": "27", "light": "LIGHT_FULL" } },
+        { "at": "6600", "face": { "big": "27", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "a meeting and a wave in one show: jingle, then hello and the flashes, then the meeting's blink",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "show": "MEET", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["jingle"], "face": { "big": "27", "light": "LIGHT_FULL" } },
+        { "at": "1500", "face": { "big": "27", "light": "LIGHT_OFF" } },
+        { "at": "1600", "sounds": ["hello"], "face": { "big": "", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "4599", "face": { "light": "LIGHT_OFF" } },
+        { "at": "4600", "face": { "big": "27", "light": "LIGHT_OFF" } },
+        { "at": "5000", "face": { "big": "27", "field": "song", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "waves during the call join it; a waver who comes back, and the same number after a reconnect, call nothing; a newer one calls",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "2000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "f6a7b8c9d0", "n": 2, "seq": 1790337603005 } }, "face": { "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "3999", "face": { "light": "LIGHT_OFF" } },
+        { "at": "4000", "face": { "big": "HI :)", "light": "LIGHT_FULL" } },
+        { "at": "5000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } } },
+        { "at": "6000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "f6a7b8c9d0", "n": 2, "seq": 1790337603005 } }, "face": { "big": "HI :)", "light": "LIGHT_FULL" } },
+        { "at": "7000", "link": "down" },
+        { "at": "8000", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "8100", "show": "HI", "rev": 3, "with": { "waves": { "ref": "f6a7b8c9d0", "n": 2, "seq": 1790337603005 } } },
+        { "at": "9000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "c1d2e3f4a5", "n": 3, "seq": 1790337603009 } }, "sounds": ["hello"] }
+      ]
+    },
+    {
+      "name": "a band forgets its wave number at the letters, so a new person's first wave calls; after a boot, whoever waits calls once",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "waves": { "ref": "c1d2e3f4a5", "n": 3, "seq": 1790337603009 } }, "sounds": ["hello"] },
+        { "at": "5000", "show": "PAIRING", "face": { "big": "KXRT" } },
+        { "at": "6000", "show": "HI", "rev": 4, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] }
+      ]
+    },
+    {
+      "name": "a wave number of thirteen digits is read whole: past 2^32 the next wave still calls",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1791001362431 } }, "sounds": ["hello"] },
+        { "at": "5000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "f6a7b8c9d0", "n": 2, "seq": 1791001362432 } }, "sounds": ["hello"] }
+      ]
+    },
+    {
+      "name": "no wave calls in NOT NOW, even before the relay has heard it",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "key1": "down", "sounds": ["tick"] },
+        { "at": "1000+HOLD_MS", "sounds": ["down"], "sent": [{ "t": "hold" }] },
+        { "at": "2600", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "face": { "light": "LIGHT_OFF" } },
+        { "at": "2700", "key1": "up", "face": { "light": "LIGHT_OFF" } }
+      ]
+    },
+    {
+      "name": "with the sound switch off, a wave's flashes play and nothing sounds, not even a key's tick",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "sound": false } },
+        { "at": "1000", "show": "HI", "rev": 3, "with": { "sound": false, "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "face": { "big": "", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "1200", "press": 2, "downSounds": [], "face": { "big": "", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "1500", "face": { "big": "HI :)", "light": "LIGHT_OFF" } },
+        { "at": "4000", "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "during a look, hello plays at once and the flashes wait for the resting face; a wave meanwhile joins them",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "press": 2, "face": { "small": "SIDE TO CHANGE" } },
+        { "at": "2000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"], "face": { "big": "HI :)", "small": "SIDE TO CHANGE", "light": "LIGHT_FULL" } },
+        { "at": "3000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "f6a7b8c9d0", "n": 2, "seq": 1790337603005 } }, "face": { "big": "HI :)", "small": "SIDE TO CHANGE" } },
+        { "at": "1100+CHOOSE_MS", "face": { "big": "", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "1600+CHOOSE_MS", "face": { "light": "LIGHT_OFF" } },
+        { "at": "4100+CHOOSE_MS", "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "a meeting that arrives during a wave's flashes replaces them with its own call",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "2000", "show": "MEET", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["jingle"], "face": { "big": "27", "light": "LIGHT_FULL" } },
+        { "at": "2600", "face": { "big": "27", "light": "LIGHT_OFF" } },
+        { "at": "3000", "face": { "big": "27", "field": "song", "light": "LIGHT_FULL" } }
+      ]
     }
   ]
 }
````

New cases (12):

  - a wave newer than any called for plays hello and flashes the HI blue three times, 500 on and 500 off
  - during a wave's flashes a press, a release and a SIDE hold only tick, a key already down included; after them keys work again
  - a FACE hold during a wave's flashes goes NOT NOW, dark at once
  - a meeting calling under a wave's flashes is answered by the first key after them, not before
  - a meeting and a wave in one show: jingle, then hello and the flashes, then the meeting's blink
  - waves during the call join it; a waver who comes back, and the same number after a reconnect, call nothing; a newer one calls
  - a band forgets its wave number at the letters, so a new person's first wave calls; after a boot, whoever waits calls once
  - a wave number of thirteen digits is read whole: past 2^32 the next wave still calls
  - no wave calls in NOT NOW, even before the relay has heard it
  - with the sound switch off, a wave's flashes play and nothing sounds, not even a key's tick
  - during a look, hello plays at once and the flashes wait for the resting face; a wave meanwhile joins them
  - a meeting that arrives during a wave's flashes replaces them with its own call

- [ ] **Step 2: Run the table and watch it fail**

Run: `npm run build >/dev/null && node --test tests/wrist.test.js tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: `ℹ pass 126`, `ℹ fail 22`. The first errors:

```text
AssertionError [ERR_ASSERTION]: a wave newer than any called for plays hello and flashes the HI blue three times, 500 on and 500 off / 2000 frame {"t":"show","show":{"kind":"hi","intent":"hi","big":"HI :)","small":"blue 
AssertionError [ERR_ASSERTION]: during a wave's flashes a press, a release and a SIDE hold only tick, a key already down included; after them keys work again / 2000 frame {"t":"show","show":{"kind":"hi","intent":"hi","bi
AssertionError [ERR_ASSERTION]: a FACE hold during a wave's flashes goes NOT NOW, dark at once / 2000 frame {"t":"show","show":{"kind":"hi","intent":"hi","big":"HI :)","small":"blue means hello","dim":false,"armed":"hi",
AssertionError [ERR_ASSERTION]: a meeting calling under a wave's flashes is answered by the first key after them, not before / 3000 frame {"t":"show","show":{"kind":"meet","intent":"song","big":"27","small":"MEET","dim":
AssertionError [ERR_ASSERTION]: a meeting and a wave in one show: jingle, then hello and the flashes, then the meeting's blink / 2600 tick: sounds
AssertionError [ERR_ASSERTION]: waves during the call join it; a waver who comes back, and the same number after a reconnect, call nothing; a newer one calls / 2000 frame {"t":"show","show":{"kind":"hi","intent":"hi","bi
```

Red (22):

- band_logic.h: a wave newer than any called for plays hello and flashes the HI blue three times, 500 on and 500 off
- band_logic.h: during a wave's flashes a press, a release and a SIDE hold only tick, a key already down included; after them keys work again
- band_logic.h: a FACE hold during a wave's flashes goes NOT NOW, dark at once
- band_logic.h: a meeting calling under a wave's flashes is answered by the first key after them, not before
- band_logic.h: a meeting and a wave in one show: jingle, then hello and the flashes, then the meeting's blink
- band_logic.h: waves during the call join it; a waver who comes back, and the same number after a reconnect, call nothing; a newer one calls
- band_logic.h: a band forgets its wave number at the letters, so a new person's first wave calls; after a boot, whoever waits calls once
- band_logic.h: a wave number of thirteen digits is read whole: past 2^32 the next wave still calls
- band_logic.h: with the sound switch off, a wave's flashes play and nothing sounds, not even a key's tick
- band_logic.h: during a look, hello plays at once and the flashes wait for the resting face; a wave meanwhile joins them
- band_logic.h: a meeting that arrives during a wave's flashes replaces them with its own call
- wrist.js: a wave newer than any called for plays hello and flashes the HI blue three times, 500 on and 500 off
- wrist.js: during a wave's flashes a press, a release and a SIDE hold only tick, a key already down included; after them keys work again
- wrist.js: a FACE hold during a wave's flashes goes NOT NOW, dark at once
- … and 8 more

One case passes before the change, on purpose: no wave calls in NOT NOW, even before the relay has heard it. It is a guard; a mutation in each twin below breaks it.

- [ ] **Step 3: Implement in both twins.**

In `app/lib/wrist.js`:

````diff
--- a/app/lib/wrist.js
+++ b/app/lib/wrist.js
@@ -18,6 +18,9 @@
 // reactions play in order (a key or a result, then a call, then a warning),
 // one after another, and a later moment's replace the one playing. sounds()
 // gives the names of the sounds due to start since it was last asked.
+//
+// A wave at its person calls (docs/superpowers/specs/2026-09-25-wrist-waves-
+// design.md): hello, and the HI blue three times, whatever the keys do.
 
 import { bandIdOf } from './sha256.js';
 
@@ -64,6 +67,7 @@ export const SOUNDS = {
   ask: [[1319, 80], [0, 50], [1760, 160]],
   jingle: [[1319, 80], [1568, 80], [2637, 80], [2093, 80], [2349, 80], [3136, 200]],
   warn: [[880, 150], [698, 150], [880, 150], [698, 150]],
+  hello: [[1568, 60], [2093, 120]],
 };
 
 /** Every flash: its colour, then count × on / off ms. `card` is the card chosen, white for OFF. band_logic.h FLASHES. */
@@ -73,6 +77,7 @@ export const FLASHES = {
   notsent: { colour: 'orange', count: 2, on: 350, off: 250 },
   warn: { colour: 'orange', count: 2, on: 350, off: 250 },
   check: { colour: 'white', count: 2, on: 150, off: 100 },
+  wave: { colour: 'hi', count: 3, on: 500, off: 500 },
 };
 
 /**
@@ -96,6 +101,12 @@ function readShow(s) {
   };
 }
 
+/** A show's waves, read apart from the show, as band_logic.h readFrame() reads them: nobody waiting unless said. */
+function readWaves(s) {
+  const w = s.waves && typeof s.waves === 'object' ? s.waves : {};
+  return { ref: typeof w.ref === 'string' ? w.ref : '', n: Number.isInteger(w.n) ? w.n : 0, seq: Number.isInteger(w.seq) ? w.seq : 0 };
+}
+
 const lit = (s) => LIT.includes(s.kind) && !!CARD_WORDS[s.intent];
 const words = (big, small, field, ink, light) => ({ big, small, field, ink, light, bar: -1, code: '' });
 
@@ -120,7 +131,7 @@ export function createWrist({ key }) {
   let out = [];
   // Reactions (rule 6): this input's, not yet in order; the one playing; those waiting their turn.
   let moment = [];
-  let playing = null;         // { sound, flash, colour, cls, audible, at, until }
+  let playing = null;         // { sound, flash, colour, cls, audible, whole, at, until }
   let queue = [];
   let due = [];               // sounds started since sounds() was last asked
   let soundOn = true;         // the person's switch, as the last show that said it had it (rule 3)
@@ -129,6 +140,11 @@ export function createWrist({ key }) {
   let called = '';
   let calling = false;
   let callAt = 0;
+  // Waves: who waits, as the last show said; the newest wave number called for; and a call's flashes, owed until
+  // the face rests.
+  let waves = readWaves({});
+  let waveSeq = 0;
+  let waveOwed = false;
   // Rule 5: the letters and the waiting face sleep. Until when they are lit, which letters lit them, when
   // waiting began, and until when a press says where to go.
   let litUntil = 0;
@@ -151,11 +167,28 @@ export function createWrist({ key }) {
   const current = () => (quiet.pending || show?.quiet ? 'notnow' : show?.armed || 'off');
   const pct = () => (battery >= 0 ? battery + '%' : '');
 
-  /** A reaction of this moment. cls: 0 a key or a result, 1 a call, 2 a warning. `card`: the colour a `set` flash takes. */
+  /**
+   * A reaction of this moment. cls: 0 a key or a result, 1 a call, 2 a warning. `card`: the colour a `set` flash
+   * takes. A wave's flashes play whole: a key does not end them.
+   */
   function react(sound, flash = null, cls = 0, card = '') {
     const f = flash ? FLASHES[flash] : null;
     const colour = f ? (f.colour === 'card' ? card || 'white' : f.colour) : '';
-    moment.push({ sound, flash: f, colour, cls, audible: soundOn });
+    moment.push({ sound, flash: f, colour, cls, audible: soundOn, whole: flash === 'wave' });
+  }
+
+  /** A wave's flashes are on the face: a key only ticks (waves decision 6). */
+  const waveFlashing = (now) => !!playing && playing.whole && now < playing.at + flashMs(playing.flash);
+  /** A wave call playing, waiting its turn, or owed: a new wave joins it. */
+  const waveCalling = () => !!playing?.whole || queue.some((r) => r.whole) || moment.some((r) => r.whole) || waveOwed;
+
+  /** A wave newer than any called for: hello, and its flashes now, or once the face rests (waves §1.2). */
+  function callWave() {
+    if (mode === 'rest') react('hello', 'wave', 1);
+    else {
+      react('hello', null, 1);
+      waveOwed = true;
+    }
   }
 
   function start(r, at) {
@@ -183,7 +216,11 @@ export function createWrist({ key }) {
 
   /** The end of a moment: its reactions go first, in order, and what was already waiting plays after them. */
   function settle(now) {
-    // A warning that waited for a choice plays once the face rests.
+    // A wave's flashes, or a warning, that waited for a choice play once the face rests.
+    if (waveOwed && !silent && mode === 'rest') {
+      waveOwed = false;
+      react(null, 'wave', 1);
+    }
     if (owed.size && !silent && mode === 'rest') payOwed();
     if (!moment.length) return;
     const mine = moment.sort((a, b) => a.cls - b.cls);
@@ -235,6 +272,7 @@ export function createWrist({ key }) {
     if (!silent) react('down');
     silent = true;
     calling = false;  // NOT NOW ends a call
+    waveOwed = false;
   }
 
   /** SET, CHANGED or NOT SENT on the face, with its sound and flash. In NOT NOW a failed try to come back is silent. */
@@ -303,7 +341,8 @@ export function createWrist({ key }) {
       else if (now - link.asked >= PING_EVERY_MS) { link.asked = now; send({ t: 'ping' }); }
     }
     if (k1.down && !k1.fired && now - k1.since >= HOLD_MS) { k1.fired = true; hold(now); }
-    if (k2.down && !k2.fired && now - k2.since >= HOLD_MS) { k2.fired = true; sideHeld(now); }
+    // A SIDE hold that comes due during a wave's flashes does nothing else.
+    if (k2.down && !k2.fired && now - k2.since >= HOLD_MS) { k2.fired = true; if (!waveFlashing(now)) sideHeld(now); }
     if (quiet.pending && !quiet.sent && link.up) { send({ t: 'hold' }); quiet.sent = true; quiet.at = now; }
     if (quiet.pending && quiet.sent && now - quiet.at >= QUIET_CONFIRM_MS) quiet.pending = false;
     if (mode === 'look' && now - stepAt >= CHOOSE_MS) rest();
@@ -326,16 +365,21 @@ export function createWrist({ key }) {
     s.since = now;
     s.fired = false;
     if (k === 1 && (mode === 'look' || mode === 'choosing')) frozen = true;
+    // During a wave's flashes a key only ticks: a meeting calling underneath is answered after them.
+    const whole = waveFlashing(now);
     // The key that answers a call only answers: letting it go, or holding it, does nothing more.
-    if (blinking(now)) { calling = false; s.fired = true; }
+    if (blinking(now) && !whole) { calling = false; s.fired = true; }
     // On the letters or the check a key says where to go, and lights the letters again; nothing more.
     else if (pairingFace(now)) {
       s.fired = true;
       hintUntil = now + HINT_MS;
       if (show.kind === 'pairing') litUntil = now + PAIR_AWAKE_MS;
     }
-    // Every press is heard as it goes down; NOT NOW is silent.
-    if (!silent) react('tick');
+    // Every press is heard as it goes down; NOT NOW is silent. A tick does not end a wave's flashes.
+    if (!silent) {
+      if (!whole) react('tick');
+      else if (soundOn) due.push('tick');
+    }
     settle(now);
   }
 
@@ -344,7 +388,7 @@ export function createWrist({ key }) {
     const s = k === 1 ? k1 : k2;
     if (!s.down) return;
     s.down = false;
-    if (!s.fired) {
+    if (!s.fired && !waveFlashing(now)) {
       if (k === 2) step(now);
       else {
         if (frozen) rest();
@@ -408,6 +452,7 @@ export function createWrist({ key }) {
     const was = show;
     const wasSilent = silent;
     show = readShow(m.show);
+    waves = readWaves(m.show);
     // Reactions come from changes; a show that differs only in `sound` is no change.
     const same = !!was && JSON.stringify(was) === JSON.stringify(show);
     // A show's own switch counts for what it causes. One that is not true or false is not said.
@@ -419,6 +464,8 @@ export function createWrist({ key }) {
       silent = false;
       called = '';
       calling = false;
+      waveSeq = 0;
+      waveOwed = false;
       if (was?.kind === 'check') react('fall', null, 1);  // the check ended without YES
       if (wasPaired) playWarn();                          // unpaired; the letters end any choice, so at once
       soundOn = true;                                     // after the letters' own reactions
@@ -446,16 +493,24 @@ export function createWrist({ key }) {
     else if (!warned.away) { warned.away = true; warn('away'); }
     // NOT NOW is over: what came up in it plays once, after this moment's own reactions (rule 1).
     if (wasSilent && !silent) payOwed();
-    if (same || silent) return;
-    if (show.kind === 'check') react('ask', 'check', 1);
-    else if (show.kind === 'test') react('up', null, 1);  // paired, or TEST THE LIGHT: the white face is its flash
-    else if (show.kind === 'meet' && show.big !== called) {
-      // A number not yet called for calls until it is answered (rule 4).
-      react('jingle', null, 1);
-      called = show.big;
-      calling = true;
-      callAt = now;
+    // A wave newer than any called for calls; either way the number moves up (waves §3).
+    const newer = waves.seq > waveSeq;
+    if (newer) waveSeq = waves.seq;
+    if (silent) return;
+    // A show that differs only in its sound or its waves is no change.
+    if (!same) {
+      if (show.kind === 'check') react('ask', 'check', 1);
+      else if (show.kind === 'test') react('up', null, 1);  // paired, or TEST THE LIGHT: the white face is its flash
+      else if (show.kind === 'meet' && show.big !== called) {
+        // A number not yet called for calls until it is answered (rule 4).
+        react('jingle', null, 1);
+        called = show.big;
+        calling = true;
+        callAt = now;
+      }
     }
+    // After a meeting's jingle. A wave call already under way takes the new wave in.
+    if (newer && !waveCalling()) callWave();
   }
 
   /** The face at rest: band_logic.h faceFor(), wordsFor() and lightFor(), in that order. */
````

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -78,6 +78,7 @@ constexpr Note LOW_TONE[] = {{784, 120}, {523, 220}};  // not LOW: Arduino.h mak
 constexpr Note ASK[] = {{1319, 80}, {0, 50}, {1760, 160}};
 constexpr Note JINGLE[] = {{1319, 80}, {1568, 80}, {2637, 80}, {2093, 80}, {2349, 80}, {3136, 200}};
 constexpr Note WARN[] = {{880, 150}, {698, 150}, {880, 150}, {698, 150}};
+constexpr Note HELLO[] = {{1568, 60}, {2093, 120}};
 template <size_t N>
 constexpr Sound sound(const char* name, const Note (&notes)[N]) { return {name, notes, N}; }
 }  // namespace detail
@@ -86,6 +87,7 @@ constexpr Sound SOUNDS[] = {
     detail::sound("tick", detail::TICK),     detail::sound("double", detail::DOUBLE), detail::sound("down", detail::DOWN),
     detail::sound("up", detail::UP),         detail::sound("fall", detail::FALL),     detail::sound("low", detail::LOW_TONE),
     detail::sound("ask", detail::ASK),       detail::sound("jingle", detail::JINGLE), detail::sound("warn", detail::WARN),
+    detail::sound("hello", detail::HELLO),
 };
 
 inline const Sound* soundFor(const std::string& name) {
@@ -159,7 +161,7 @@ struct Flash {
 
 constexpr Flash FLASHES[] = {
     {"set", "card", 2, 150, 100},       {"changed", "red", 3, 120, 90}, {"notsent", "orange", 2, 350, 250},
-    {"warn", "orange", 2, 350, 250},    {"check", "white", 2, 150, 100},
+    {"warn", "orange", 2, 350, 250},    {"check", "white", 2, 150, 100},   {"wave", "hi", 3, 500, 500},
 };
 
 inline const Flash* flashFor(const std::string& name) {
@@ -483,11 +485,19 @@ class Reader {
 }  // namespace json
 
 /** A frame from the relay: its type, and the show, the reason, the answer or the secret it carries. */
+/** Who waved at the person and waits: the newest one's handle, how many, and the newest one's number. */
+struct Waves {
+  std::string ref;
+  int64_t n = 0;
+  int64_t seq = 0;  // the relay's clock in ms when the wave was made: past 32 bits
+};
+
 struct Frame {
   std::string t;
   bool hasShow = false;
   Show show;
   int sound = -1;          // the show's sound switch: 1 on, 0 off, -1 not said (so not part of the Show)
+  Waves waves;             // the show's waves, nobody unless said (so not part of the Show either)
   std::string why;
   bool hasOk = false;      // {t:'set', ok:false, why}: the relay refused a choice
   bool ok = true;
@@ -561,6 +571,18 @@ inline bool readFrame(const std::string& text, Frame& f) {
         f.sound = on ? 1 : 0;
         return true;
       }
+      if (k == "waves") {
+        if (!r.peek('{')) return r.skip();
+        return r.object([&](const std::string& w) {
+          if (w == "ref") return text_(f.waves.ref, 16);
+          if (w != "n" && w != "seq") return r.skip();
+          int64_t v = 0;
+          bool whole = false;
+          if (!r.integer(v, whole)) return r.skip();
+          (w == "n" ? f.waves.n : f.waves.seq) = whole ? v : 0;
+          return true;
+        });
+      }
       return r.skip();
     });
     if (s.kind.empty()) s.kind = "off";
@@ -1153,8 +1175,10 @@ class Wrist {
     s.fired = false;
     // Any KEY1 press-down freezes a choice at once: no commit can fire.
     if (k == 1 && (mode_ == LOOK || mode_ == CHOOSING)) frozen_ = true;
+    // During a wave's flashes a key only ticks: a meeting calling underneath is answered after them.
+    const bool whole = waveFlashing(now);
     // The key that answers a call only answers: letting it go, or holding it, does nothing more.
-    if (blinking(now)) {
+    if (blinking(now) && !whole) {
       calling_ = false;
       s.fired = true;
     } else if (pairingFace(now)) {
@@ -1163,8 +1187,11 @@ class Wrist {
       hintUntil_ = now + HINT_MS;
       if (show_.kind == "pairing") litUntil_ = now + PAIR_AWAKE_MS;
     }
-    // Every press is heard as it goes down; NOT NOW is silent.
-    if (!silent_) react("tick");
+    // Every press is heard as it goes down; NOT NOW is silent. A tick does not end a wave's flashes.
+    if (!silent_) {
+      if (!whole) react("tick");
+      else if (soundOn_) due_.push_back("tick");
+    }
     settle(now);
   }
 
@@ -1173,7 +1200,7 @@ class Wrist {
     Key& s = k == 1 ? k1_ : k2_;
     if (!s.down) return;
     s.down = false;
-    if (!s.fired) {
+    if (!s.fired && !waveFlashing(now)) {
       if (k == 2) {
         step(now);
       } else {
@@ -1234,6 +1261,7 @@ class Wrist {
     const bool wasSilent = silent_;
     show_ = f.show;
     haveShow_ = true;
+    waves_ = f.waves;
     // A show's own switch counts for what it causes.
     if (f.sound >= 0) soundOn_ = f.sound == 1;
     if (show_.kind == "pairing") {
@@ -1243,6 +1271,8 @@ class Wrist {
       silent_ = false;
       called_.clear();
       calling_ = false;
+      waveSeq_ = 0;
+      waveOwed_ = false;
       if (wasCheck) react("fall", nullptr, 1);    // the check ended without YES
       if (wasPaired) playWarn();                  // unpaired; the letters end any choice, so at once
       soundOn_ = true;                            // after the letters' own reactions
@@ -1289,18 +1319,26 @@ class Wrist {
     }
     // NOT NOW is over: what came up in it plays once, after this moment's own reactions (rule 1).
     if (wasSilent && !silent_) payOwed();
-    if (same || silent_) return;
-    if (show_.kind == "check") {
-      react("ask", "check", 1);
-    } else if (show_.kind == "test") {
-      react("up", nullptr, 1);  // paired, or TEST THE LIGHT: the white face is its flash
-    } else if (show_.kind == "meet" && show_.big != called_) {
-      // A number not yet called for calls until it is answered (rule 4).
-      react("jingle", nullptr, 1);
-      called_ = show_.big;
-      calling_ = true;
-      callAt_ = now;
+    // A wave newer than any called for calls; either way the number moves up (waves §3).
+    const bool newer = waves_.seq > waveSeq_;
+    if (newer) waveSeq_ = waves_.seq;
+    if (silent_) return;
+    // A show that differs only in its sound or its waves is no change.
+    if (!same) {
+      if (show_.kind == "check") {
+        react("ask", "check", 1);
+      } else if (show_.kind == "test") {
+        react("up", nullptr, 1);  // paired, or TEST THE LIGHT: the white face is its flash
+      } else if (show_.kind == "meet" && show_.big != called_) {
+        // A number not yet called for calls until it is answered (rule 4).
+        react("jingle", nullptr, 1);
+        called_ = show_.big;
+        calling_ = true;
+        callAt_ = now;
+      }
     }
+    // After a meeting's jingle. A wave call already under way takes the new wave in.
+    if (newer && !waveCalling()) callWave();
   }
 
   void ticked(uint32_t now) {
@@ -1329,9 +1367,10 @@ class Wrist {
       k1_.fired = true;
       hold(now);
     }
+    // A SIDE hold that comes due during a wave's flashes does nothing else.
     if (k2_.down && !k2_.fired && now - k2_.since >= HOLD_MS) {
       k2_.fired = true;
-      sideHeld(now);
+      if (!waveFlashing(now)) sideHeld(now);
     }
     if (quiet_.due(link_.up())) {
       out_.push_back(HOLD_FRAME);
@@ -1409,13 +1448,14 @@ class Wrist {
     bool fired = false;
     uint32_t since = 0;
   };
-  /** One reaction. cls: 0 a key or a result, 1 a call, 2 a warning. */
+  /** One reaction. cls: 0 a key or a result, 1 a call, 2 a warning. `whole`: a wave's flashes, which no key ends. */
   struct Reaction {
     const char* sound = nullptr;
     const Flash* flash = nullptr;
     std::string colour;
     int cls = 0;
     bool audible = true;
+    bool whole = false;
     uint32_t at = 0, until = 0;
   };
 
@@ -1427,9 +1467,35 @@ class Wrist {
     if (r.flash) r.colour = std::string(r.flash->colour) == "card" ? (card.empty() ? "white" : card) : r.flash->colour;
     r.cls = cls;
     r.audible = soundOn_;
+    r.whole = flash && std::string(flash) == "wave";
     moment_.push_back(r);
   }
 
+  /** A wave's flashes are on the face: a key only ticks (waves decision 6). */
+  bool waveFlashing(uint32_t now) const {
+    return playingOn_ && playing_.whole && static_cast<int32_t>(now - (playing_.at + flashMs(playing_.flash))) < 0;
+  }
+
+  /** A wave call playing, waiting its turn, or owed: a new wave joins it. */
+  bool waveCalling() const {
+    if ((playingOn_ && playing_.whole) || waveOwed_) return true;
+    for (const Reaction& r : queue_)
+      if (r.whole) return true;
+    for (const Reaction& r : moment_)
+      if (r.whole) return true;
+    return false;
+  }
+
+  /** A wave newer than any called for: hello, and its flashes now, or once the face rests (waves §1.2). */
+  void callWave() {
+    if (mode_ == REST) {
+      react("hello", "wave", 1);
+    } else {
+      react("hello", nullptr, 1);
+      waveOwed_ = true;
+    }
+  }
+
   void start(Reaction r, uint32_t at) {
     r.at = at;
     r.until = at + std::max(soundMs(r.sound), flashMs(r.flash));
@@ -1461,7 +1527,11 @@ class Wrist {
 
   /** The end of a moment: its reactions go first, in order, and what was already waiting plays after them. */
   void settle(uint32_t now) {
-    // A warning that waited for a choice plays once the face rests.
+    // A wave's flashes, or a warning, that waited for a choice play once the face rests.
+    if (waveOwed_ && !silent_ && mode_ == REST) {
+      waveOwed_ = false;
+      react(nullptr, "wave", 1);
+    }
     if (owed_ && !silent_ && mode_ == REST) payOwed();
     if (moment_.empty()) return;
     std::stable_sort(moment_.begin(), moment_.end(), [](const Reaction& a, const Reaction& b) { return a.cls < b.cls; });
@@ -1570,6 +1640,7 @@ class Wrist {
     if (!silent_) react("down");
     silent_ = true;
     calling_ = false;  // NOT NOW ends a call
+    waveOwed_ = false;
   }
 
   /** SET, CHANGED or NOT SENT on the face, with its sound and flash. In NOT NOW a failed try to come back is silent. */
@@ -1667,6 +1738,11 @@ class Wrist {
   std::string called_;
   bool calling_ = false;
   uint32_t callAt_ = 0;
+  // Waves: who waits, as the last show said; the newest wave number called for (the relay's clock, past 32
+  // bits); and a call's flashes, owed until the face rests.
+  Waves waves_;
+  int64_t waveSeq_ = 0;
+  bool waveOwed_ = false;
   // Rule 5: the letters and the waiting face sleep. Until when they are lit, which letters lit them, when
   // waiting began, and until when a press says where to go.
   uint32_t litUntil_ = 0;
````

- [ ] **Step 4: Run** — the table, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 312`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "every wave calls again",
  "file": "app/lib/wrist.js",
  "from": "const newer = waves.seq > waveSeq;",
  "to": "const newer = waves.seq > 0;",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: waves during the call join it; a waver who comes back, and the same number after a reconnect, call nothing; a newer one calls"
  ]
 },
 {
  "label": "a wave during the call calls again",
  "file": "app/lib/wrist.js",
  "from": "if (newer && !waveCalling()) callWave();",
  "to": "if (newer) callWave();",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: waves during the call join it; a waver who comes back, and the same number after a reconnect, call nothing; a newer one calls",
   "wrist.js: during a look, hello plays at once and the flashes wait for the resting face; a wave meanwhile joins them"
  ]
 },
 {
  "label": "a key's tick ends the wave's flashes",
  "file": "app/lib/wrist.js",
  "from": "      if (!whole) react('tick');\n      else if (soundOn) due.push('tick');",
  "to": "      react('tick');",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: during a wave's flashes a press, a release and a SIDE hold only tick, a key already down included; after them keys work again",
   "wrist.js: a meeting calling under a wave's flashes is answered by the first key after them, not before",
   "wrist.js: with the sound switch off, a wave's flashes play and nothing sounds, not even a key's tick"
  ]
 },
 {
  "label": "a key during the flashes answers the meeting",
  "file": "app/lib/wrist.js",
  "from": "if (blinking(now) && !whole) {",
  "to": "if (blinking(now)) {",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a meeting calling under a wave's flashes is answered by the first key after them, not before"
  ]
 },
 {
  "label": "a release during the flashes acts",
  "file": "app/lib/wrist.js",
  "from": "if (!s.fired && !waveFlashing(now)) {",
  "to": "if (!s.fired) {",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: during a wave's flashes a press, a release and a SIDE hold only tick, a key already down included; after them keys work again",
   "wrist.js: with the sound switch off, a wave's flashes play and nothing sounds, not even a key's tick"
  ]
 },
 {
  "label": "a SIDE hold during the flashes acts",
  "file": "app/lib/wrist.js",
  "from": "if (!waveFlashing(now)) sideHeld(now); }",
  "to": "sideHeld(now); }",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: during a wave's flashes a press, a release and a SIDE hold only tick, a key already down included; after them keys work again"
  ]
 },
 {
  "label": "the letters keep the wave number",
  "file": "app/lib/wrist.js",
  "from": "      waveSeq = 0;\n      waveOwed = false;\n      if (was?.kind === 'check')",
  "to": "      waveOwed = false;\n      if (was?.kind === 'check')",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a band forgets its wave number at the letters, so a new person's first wave calls; after a boot, whoever waits calls once"
  ]
 },
 {
  "label": "a wave calls in NOT NOW",
  "file": "app/lib/wrist.js",
  "from": "    if (silent) return;\n    // A show that differs only",
  "to": "    // A show that differs only",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: TEST THE LIGHT plays up; in NOT NOW it shows its white and plays nothing, and NOT NOW stays silent after it, a FACE hold included",
   "wrist.js: no wave calls in NOT NOW, even before the relay has heard it"
  ]
 },
 {
  "label": "the flashes play during a choice",
  "file": "app/lib/wrist.js",
  "from": "    if (mode === 'rest') react('hello', 'wave', 1);",
  "to": "    if (true) react('hello', 'wave', 1);",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: during a look, hello plays at once and the flashes wait for the resting face; a wave meanwhile joins them"
  ]
 },
 {
  "label": "owed flashes never play",
  "file": "app/lib/wrist.js",
  "from": "    if (waveOwed && !silent && mode === 'rest') {",
  "to": "    if (false) {",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: during a look, hello plays at once and the flashes wait for the resting face; a wave meanwhile joins them"
  ]
 },
 {
  "label": "a wave's call sorts before a meeting's",
  "file": "app/lib/wrist.js",
  "from": "react('hello', 'wave', 1);",
  "to": "react('hello', 'wave', 0);",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a meeting and a wave in one show: jingle, then hello and the flashes, then the meeting's blink"
  ]
 },
 {
  "label": "a key may end a wave's flashes",
  "file": "app/lib/wrist.js",
  "from": "whole: flash === 'wave' });",
  "to": "whole: false });",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: during a wave's flashes a press, a release and a SIDE hold only tick, a key already down included; after them keys work again",
   "wrist.js: a meeting calling under a wave's flashes is answered by the first key after them, not before",
   "wrist.js: waves during the call join it; a waver who comes back, and the same number after a reconnect, call nothing; a newer one calls",
   "wrist.js: with the sound switch off, a wave's flashes play and nothing sounds, not even a key's tick"
  ]
 },
 {
  "label": "C++: every wave calls again",
  "file": "firmware/src/band_logic.h",
  "from": "const bool newer = waves_.seq > waveSeq_;",
  "to": "const bool newer = waves_.seq > 0;",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: waves during the call join it; a waver who comes back, and the same number after a reconnect, call nothing; a newer one calls"
  ]
 },
 {
  "label": "C++: a wave during the call calls again",
  "file": "firmware/src/band_logic.h",
  "from": "if (newer && !waveCalling()) callWave();",
  "to": "if (newer) callWave();",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: waves during the call join it; a waver who comes back, and the same number after a reconnect, call nothing; a newer one calls",
   "band_logic.h: during a look, hello plays at once and the flashes wait for the resting face; a wave meanwhile joins them"
  ]
 },
 {
  "label": "C++: a key's tick ends the wave's flashes",
  "file": "firmware/src/band_logic.h",
  "from": "      if (!whole) react(\"tick\");\n      else if (soundOn_) due_.push_back(\"tick\");",
  "to": "      react(\"tick\");",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: during a wave's flashes a press, a release and a SIDE hold only tick, a key already down included; after them keys work again",
   "band_logic.h: a meeting calling under a wave's flashes is answered by the first key after them, not before",
   "band_logic.h: with the sound switch off, a wave's flashes play and nothing sounds, not even a key's tick"
  ]
 },
 {
  "label": "C++: a key during the flashes answers the meeting",
  "file": "firmware/src/band_logic.h",
  "from": "if (blinking(now) && !whole) {",
  "to": "if (blinking(now)) {",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a meeting calling under a wave's flashes is answered by the first key after them, not before"
  ]
 },
 {
  "label": "C++: a release during the flashes acts",
  "file": "firmware/src/band_logic.h",
  "from": "if (!s.fired && !waveFlashing(now)) {",
  "to": "if (!s.fired) {",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: during a wave's flashes a press, a release and a SIDE hold only tick, a key already down included; after them keys work again",
   "band_logic.h: with the sound switch off, a wave's flashes play and nothing sounds, not even a key's tick"
  ]
 },
 {
  "label": "C++: a SIDE hold during the flashes acts",
  "file": "firmware/src/band_logic.h",
  "from": "      if (!waveFlashing(now)) sideHeld(now);",
  "to": "      sideHeld(now);",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: during a wave's flashes a press, a release and a SIDE hold only tick, a key already down included; after them keys work again"
  ]
 },
 {
  "label": "C++: the letters keep the wave number",
  "file": "firmware/src/band_logic.h",
  "from": "      waveSeq_ = 0;\n      waveOwed_ = false;\n      if (wasCheck)",
  "to": "      waveOwed_ = false;\n      if (wasCheck)",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a band forgets its wave number at the letters, so a new person's first wave calls; after a boot, whoever waits calls once"
  ]
 },
 {
  "label": "C++: a wave calls in NOT NOW",
  "file": "firmware/src/band_logic.h",
  "from": "    if (silent_) return;\n    // A show that differs only",
  "to": "    // A show that differs only",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: TEST THE LIGHT plays up; in NOT NOW it shows its white and plays nothing, and NOT NOW stays silent after it, a FACE hold included",
   "band_logic.h: no wave calls in NOT NOW, even before the relay has heard it"
  ]
 },
 {
  "label": "C++: owed flashes never play",
  "file": "firmware/src/band_logic.h",
  "from": "    if (waveOwed_ && !silent_ && mode_ == REST) {",
  "to": "    if (false) {",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: during a look, hello plays at once and the flashes wait for the resting face; a wave meanwhile joins them"
  ]
 },
 {
  "label": "C++: a key may end a wave's flashes",
  "file": "firmware/src/band_logic.h",
  "from": "r.whole = flash && std::string(flash) == \"wave\";",
  "to": "r.whole = false;",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: during a wave's flashes a press, a release and a SIDE hold only tick, a key already down included; after them keys work again",
   "band_logic.h: a meeting calling under a wave's flashes is answered by the first key after them, not before",
   "band_logic.h: waves during the call join it; a waver who comes back, and the same number after a reconnect, call nothing; a newer one calls",
   "band_logic.h: with the sound switch off, a wave's flashes play and nothing sounds, not even a key's tick"
  ]
 },
 {
  "label": "C++: a wave number is read as 32 bits",
  "file": "firmware/src/band_logic.h",
  "from": "(w == \"n\" ? f.waves.n : f.waves.seq) = whole ? v : 0;",
  "to": "(w == \"n\" ? f.waves.n : f.waves.seq) = whole ? static_cast<uint32_t>(v) : 0;",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a wave number of thirteen digits is read whole: past 2^32 the next wave still calls"
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
Call a wave on the wrist: hello, and the HI blue three times

A show whose waves number is above the one the wrist last called for plays
hello and flashes the HI blue three times, 500 on and 500 off, and the number
moves up either way; the number is 64-bit in both twins. The flashes play
whole: during them a key only ticks, a SIDE hold that comes due does
nothing, and only a FACE hold still goes NOT NOW; a meeting calling
underneath is answered by the first key after them. Waves during the call
join it, a waver who comes back calls nothing, and the letters forget the
number. With a meeting in the same show the jingle goes first. During a look,
a choice or a send, hello plays at once and the flashes wait for the resting
face. None in NOT NOW; with the switch off only the flashes. A show that
differs only in its waves causes nothing else.

Mutation-checked: 23 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 5: A FACE press opens the wave face: someone waved, and how many wait

**Files:**
- Modify: `app/lib/wrist.js`, `firmware/src/band_logic.h`
- Test: `tests/fixtures/wrist-cases.json`

**Interfaces:**
- Consumes: Task 4's `waves`, `callWave()`, `waveFlashing(now)`.
- Produces: a mode `waves` (`WAVES` in C++). `waiting()`: a show about the person, armed `hi`, not quiet, with `n > 0`. `opensWaves()`: resting, the link up, no hold pending, and `waiting()`. A FACE key up that is not spent opens it when `opensWaves()`; in it, a key up of either key closes it; so do `CHOOSE_MS` with no key, a show after which nobody waits, and `closed(now)` (the link dropping, including the wrist's own `DROP`). A newer wave while it is open calls nothing. `face(now)` in `waves` mode: `SOMEONE WAVED` over `HOLD SIDE: WAVE BACK` or `N WAITING - HOLD SIDE` (`9+` past nine), black, `hi` ink, `LIGHT_AWAKE`. Rules 4 and 6 already treat any mode but `rest` as a choice under way, so a meeting jingles at once and blinks when the face closes, and a warning waits.

- [ ] **Step 1: Write the failing cases.**

In `tests/fixtures/wrist-cases.json`:

````diff
--- a/tests/fixtures/wrist-cases.json
+++ b/tests/fixtures/wrist-cases.json
@@ -989,6 +989,133 @@
         { "at": "2600", "face": { "big": "27", "light": "LIGHT_OFF" } },
         { "at": "3000", "face": { "big": "27", "field": "song", "light": "LIGHT_FULL" } }
       ]
+    },
+    {
+      "name": "a FACE press on the resting HI face with someone waiting opens the wave face on its release: someone waved, and how many wait",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "4000", "key1": "down", "sounds": ["tick"], "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "4100", "key1": "up", "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "5000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "c1d2e3f4a5", "n": 3, "seq": 1790337603009 } }, "face": { "big": "SOMEONE WAVED", "small": "3 WAITING - HOLD SIDE", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "6000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "c1d2e3f4a5", "n": 12, "seq": 1790337603009 } }, "face": { "big": "SOMEONE WAVED", "small": "9+ WAITING - HOLD SIDE", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "7000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } }
+      ]
+    },
+    {
+      "name": "the wave face closes with a SIDE press, which never starts the chooser there, a FACE press, or CHOOSE_MS with no key",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "4000", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "5000", "press": 2, "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "6000", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "7000", "press": 1, "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "8000", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "8100+CHOOSE_MS-1", "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "8100+CHOOSE_MS", "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "field": "hi", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "a FACE press opens nothing with nobody waiting, with the link down, or out of a look",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "press": 1, "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "2000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "5000", "link": "down" },
+        { "at": "5100", "press": 1, "face": { "big": "HI :)", "small": "BLUE MEANS HELLO" } },
+        { "at": "5300", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "5400", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } } },
+        { "at": "6000", "press": 2, "face": { "small": "SIDE TO CHANGE" } },
+        { "at": "6500", "press": 1, "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "7000", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } }
+      ]
+    },
+    {
+      "name": "while a meeting calls, a FACE press only answers it; the next one opens the wave face over the meeting",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "show": "MEET", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["jingle"] },
+        { "at": "1600", "sounds": ["hello"] },
+        { "at": "5000", "press": 1, "face": { "big": "27", "small": "MEET", "light": "LIGHT_FULL" } },
+        { "at": "6000", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "7000", "press": 1, "face": { "big": "27", "small": "MEET", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "the wave face closes when nobody waits, when SAY HI goes, at the test light, and when the link drops",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "4000", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "5000", "show": "HI", "rev": 3, "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "6000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } } },
+        { "at": "6100", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "7000", "show": "SONG", "rev": 4, "face": { "big": "FIRST SONG?", "field": "song" } },
+        { "at": "8000", "show": "HI", "rev": 5, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } } },
+        { "at": "8100", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "9000", "show": "TEST", "sounds": ["up"], "face": { "field": "white", "light": "LIGHT_FULL" } },
+        { "at": "10000", "show": "HI", "rev": 5, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } } },
+        { "at": "10100", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "11000", "link": "down", "face": { "big": "HI :)", "small": "BLUE MEANS HELLO" } }
+      ]
+    },
+    {
+      "name": "the wave face closes at the letters, the check, waiting and away",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "4000", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "5000", "show": "PAIRING", "face": { "big": "KXRT", "light": "LIGHT_PAIR" } },
+        { "at": "6000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "9000", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "10000", "show": "CHECK", "sounds": ["ask"] },
+        { "at": "10600", "face": { "big": "27", "small": "ON YOUR PHONE?" } },
+        { "at": "11000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } } },
+        { "at": "11100", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "12000", "show": "WAITING", "face": { "big": "OPEN YOUR PHONE" } },
+        { "at": "13000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } } },
+        { "at": "13100", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "14000", "show": "AWAY", "sounds": ["warn"], "face": { "field": "orange" } },
+        { "at": "15300", "face": { "big": "", "light": "LIGHT_OFF" } }
+      ]
+    },
+    {
+      "name": "the wave face closes when the relay goes quiet and the socket is dropped",
+      "keepAlive": false,
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "4000", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "DEAF_MS+1", "sent": ["DROP"], "face": { "big": "HI :)", "small": "BLUE MEANS HELLO" } }
+      ]
+    },
+    {
+      "name": "the wave face is a choice under way: a meeting jingles at once and blinks once it closes, and a warning waits for that",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "4000", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "5000", "show": "MEET", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["jingle"], "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "5500", "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "6000", "battery": 10, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "7000", "press": 1, "sounds": ["warn"], "face": { "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "8500", "face": { "big": "27", "light": "LIGHT_OFF" } },
+        { "at": "9000", "face": { "big": "27", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "a FACE hold in the wave face goes NOT NOW",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "4000", "press": 1, "face": { "big": "SOMEONE WAVED", "small": "HOLD SIDE: WAVE BACK", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "5000", "key1": "down", "sounds": ["tick"] },
+        { "at": "5000+HOLD_MS", "sounds": ["down"], "sent": [{ "t": "hold" }], "face": { "big": "", "light": "LIGHT_OFF" } },
+        { "at": "7000", "key1": "up", "face": { "big": "", "light": "LIGHT_OFF" } }
+      ]
     }
   ]
 }
````

New cases (9):

  - a FACE press on the resting HI face with someone waiting opens the wave face on its release: someone waved, and how many wait
  - the wave face closes with a SIDE press, which never starts the chooser there, a FACE press, or CHOOSE_MS with no key
  - a FACE press opens nothing with nobody waiting, with the link down, or out of a look
  - while a meeting calls, a FACE press only answers it; the next one opens the wave face over the meeting
  - the wave face closes when nobody waits, when SAY HI goes, at the test light, and when the link drops
  - the wave face closes at the letters, the check, waiting and away
  - the wave face closes when the relay goes quiet and the socket is dropped
  - the wave face is a choice under way: a meeting jingles at once and blinks once it closes, and a warning waits for that
  - a FACE hold in the wave face goes NOT NOW

- [ ] **Step 2: Run the table and watch it fail**

Run: `npm run build >/dev/null && node --test tests/wrist.test.js tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: `ℹ pass 148`, `ℹ fail 18`. The first errors:

```text
AssertionError [ERR_ASSERTION]: a FACE press on the resting HI face with someone waiting opens the wave face on its release: someone waved, and how many wait / 5100 key1 up: face.big {"big":"HI :)","small":"BLUE MEANS HE
AssertionError [ERR_ASSERTION]: the wave face closes with a SIDE press, which never starts the chooser there, a FACE press, or CHOOSE_MS with no key / 5100 key1 up: face.big {"big":"HI :)","small":"BLUE MEANS HELLO","fie
AssertionError [ERR_ASSERTION]: a FACE press opens nothing with nobody waiting, with the link down, or out of a look / 8100 key1 up: face.big {"big":"HI :)","small":"BLUE MEANS HELLO","field":"hi","ink":"ink","light":255
AssertionError [ERR_ASSERTION]: while a meeting calls, a FACE press only answers it; the next one opens the wave face over the meeting / 7100 key1 up: face.big {"big":"27","small":"MEET","field":"song","ink":"ink","light
AssertionError [ERR_ASSERTION]: the wave face closes when nobody waits, when SAY HI goes, at the test light, and when the link drops / 5100 key1 up: face.big {"big":"HI :)","small":"BLUE MEANS HELLO","field":"hi","ink":"
AssertionError [ERR_ASSERTION]: the wave face closes at the letters, the check, waiting and away / 5100 key1 up: face.big {"big":"HI :)","small":"BLUE MEANS HELLO","field":"hi","ink":"ink","light":255,"bar":-1,"code":""}
```

Red (18):

- band_logic.h: a FACE press on the resting HI face with someone waiting opens the wave face on its release: someone waved, and how many wait
- band_logic.h: the wave face closes with a SIDE press, which never starts the chooser there, a FACE press, or CHOOSE_MS with no key
- band_logic.h: a FACE press opens nothing with nobody waiting, with the link down, or out of a look
- band_logic.h: while a meeting calls, a FACE press only answers it; the next one opens the wave face over the meeting
- band_logic.h: the wave face closes when nobody waits, when SAY HI goes, at the test light, and when the link drops
- band_logic.h: the wave face closes at the letters, the check, waiting and away
- band_logic.h: the wave face closes when the relay goes quiet and the socket is dropped
- band_logic.h: the wave face is a choice under way: a meeting jingles at once and blinks once it closes, and a warning waits for that
- band_logic.h: a FACE hold in the wave face goes NOT NOW
- wrist.js: a FACE press on the resting HI face with someone waiting opens the wave face on its release: someone waved, and how many wait
- wrist.js: the wave face closes with a SIDE press, which never starts the chooser there, a FACE press, or CHOOSE_MS with no key
- wrist.js: a FACE press opens nothing with nobody waiting, with the link down, or out of a look
- wrist.js: while a meeting calls, a FACE press only answers it; the next one opens the wave face over the meeting
- wrist.js: the wave face closes when nobody waits, when SAY HI goes, at the test light, and when the link drops
- … and 4 more

- [ ] **Step 3: Implement in both twins.**

In `app/lib/wrist.js`:

````diff
--- a/app/lib/wrist.js
+++ b/app/lib/wrist.js
@@ -121,7 +121,7 @@ export function createWrist({ key }) {
   let wakeUntil = 0;
   const k1 = { down: false, since: 0, fired: false };
   const k2 = { down: false, since: 0, fired: false };
-  let mode = 'rest';          // rest | look | choosing | sending | result
+  let mode = 'rest';          // rest | look | choosing | sending | result | waves
   let preview = '';           // hi | song | dance | off
   let fromQuiet = false;
   let frozen = false;
@@ -261,6 +261,15 @@ export function createWrist({ key }) {
     if (link.up) link.lost = now;
     link.up = false;
     quiet.sent = false;
+    if (mode === 'waves') rest();  // the wave face follows the link
+  }
+
+  /** Someone waits on the person showing SAY HI, as the show says. */
+  const waiting = () => personal() && show.armed === 'hi' && !show.quiet && waves.n > 0;
+
+  /** A FACE press on the resting HI or meeting face, with someone waiting and the link up, opens the wave face. */
+  function opensWaves() {
+    return mode === 'rest' && link.up && !quiet.pending && waiting();
   }
 
   function hold(now) {
@@ -345,7 +354,7 @@ export function createWrist({ key }) {
     if (k2.down && !k2.fired && now - k2.since >= HOLD_MS) { k2.fired = true; if (!waveFlashing(now)) sideHeld(now); }
     if (quiet.pending && !quiet.sent && link.up) { send({ t: 'hold' }); quiet.sent = true; quiet.at = now; }
     if (quiet.pending && quiet.sent && now - quiet.at >= QUIET_CONFIRM_MS) quiet.pending = false;
-    if (mode === 'look' && now - stepAt >= CHOOSE_MS) rest();
+    if ((mode === 'look' || mode === 'waves') && now - stepAt >= CHOOSE_MS) rest();
     else if (mode === 'choosing' && !frozen) {
       if (!fromQuiet && now - stepAt >= COMMIT_MS) commit(now);
       else if (fromQuiet && now - stepAt >= CHOOSE_MS) rest();
@@ -389,7 +398,10 @@ export function createWrist({ key }) {
     if (!s.down) return;
     s.down = false;
     if (!s.fired && !waveFlashing(now)) {
-      if (k === 2) step(now);
+      // In the wave face a press of either key closes it; SIDE never starts the chooser there.
+      if (mode === 'waves') rest();
+      else if (k === 2) step(now);
+      else if (opensWaves()) { mode = 'waves'; stepAt = now; }
       else {
         if (frozen) rest();
         wake(now);
@@ -487,6 +499,8 @@ export function createWrist({ key }) {
       if (!personal() || show.rev !== basis) rest();
     } else if (mode === 'sending' && personal() && show.rev > basis && show.armed === choice && !show.quiet) {
       result(now, 'SET');
+    } else if (mode === 'waves' && !waiting()) {
+      rest();  // the wave face follows the shows: nobody left waiting, off SAY HI, or not about the person
     }
     // Away starts at an away show and ends at one that is not; the same again after a reconnect is no change.
     if (!show.away) warned.away = false;
@@ -509,8 +523,8 @@ export function createWrist({ key }) {
         callAt = now;
       }
     }
-    // After a meeting's jingle. A wave call already under way takes the new wave in.
-    if (newer && !waveCalling()) callWave();
+    // After a meeting's jingle. A wave call already under way takes the new wave in; the open wave face counts it.
+    if (newer && !waveCalling() && mode !== 'waves') callWave();
   }
 
   /** The face at rest: band_logic.h faceFor(), wordsFor() and lightFor(), in that order. */
@@ -559,6 +573,10 @@ export function createWrist({ key }) {
       f = preview === 'off'
         ? words('OFF', small, 'black', 'text2', LIGHT_AWAKE)
         : words(CARD_WORDS[preview], small, 'black', preview, LIGHT_AWAKE);
+    } else if (mode === 'waves') {
+      // As the chooser shows HI, in its own words: that someone waved, and how many wait. Never who.
+      const count = waves.n > 9 ? '9+' : String(waves.n);
+      f = words('SOMEONE WAVED', waves.n > 1 ? count + ' WAITING - HOLD SIDE' : 'HOLD SIDE: WAVE BACK', 'black', 'hi', LIGHT_AWAKE);
     } else {
       f = restFace(now, wakeUntil > now || mode === 'result');
       if (mode === 'result') f = { ...f, small: word };
````

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -1201,8 +1201,13 @@ class Wrist {
     if (!s.down) return;
     s.down = false;
     if (!s.fired && !waveFlashing(now)) {
-      if (k == 2) {
+      if (mode_ == WAVES) {
+        rest();  // in the wave face a press of either key closes it; SIDE never starts the chooser there
+      } else if (k == 2) {
         step(now);
+      } else if (opensWaves()) {
+        mode_ = WAVES;
+        stepAt_ = now;
       } else {
         if (frozen_) rest();
         wake(now);
@@ -1309,6 +1314,8 @@ class Wrist {
       if (!personal() || show_.rev != basis_) rest();
     } else if (mode_ == SENDING && personal() && show_.rev > basis_ && show_.armed == choice_ && !show_.quiet) {
       result(now, "SET");
+    } else if (mode_ == WAVES && !waiting()) {
+      rest();  // the wave face follows the shows: nobody left waiting, off SAY HI, or not about the person
     }
     // Away starts at an away show and ends at one that is not; the same again after a reconnect is no change.
     if (!show_.away) {
@@ -1337,8 +1344,8 @@ class Wrist {
         callAt_ = now;
       }
     }
-    // After a meeting's jingle. A wave call already under way takes the new wave in.
-    if (newer && !waveCalling()) callWave();
+    // After a meeting's jingle. A wave call already under way takes the new wave in; the open wave face counts it.
+    if (newer && !waveCalling() && mode_ != WAVES) callWave();
   }
 
   void ticked(uint32_t now) {
@@ -1377,7 +1384,7 @@ class Wrist {
       quiet_.sent(now);
     }
     quiet_.tick(now);
-    if (mode_ == LOOK && now - stepAt_ >= CHOOSE_MS) {
+    if ((mode_ == LOOK || mode_ == WAVES) && now - stepAt_ >= CHOOSE_MS) {
       rest();
     } else if (mode_ == CHOOSING && !frozen_) {
       if (!fromQuiet_ && now - stepAt_ >= COMMIT_MS) commit(now);
@@ -1409,6 +1416,11 @@ class Wrist {
       const char* small = mode_ == SENDING ? "SENDING" : fromQuiet_ ? "HOLD SIDE TO SHOW" : "SIDE: NEXT";
       f = preview_ == "off" ? words("OFF", small, "black", "text2", LIGHT_AWAKE)
                             : words(cardWords(preview_), small, "black", preview_, LIGHT_AWAKE);
+    } else if (mode_ == WAVES) {
+      // As the chooser shows HI, in its own words: that someone waved, and how many wait. Never who.
+      const std::string count = waves_.n > 9 ? "9+" : std::to_string(waves_.n);
+      f = words("SOMEONE WAVED", waves_.n > 1 ? count + " WAITING - HOLD SIDE" : "HOLD SIDE: WAVE BACK", "black", "hi",
+                LIGHT_AWAKE);
     } else {
       f = restFace(now, static_cast<int32_t>(wakeUntil_ - now) > 0 || mode_ == RESULT);
       if (mode_ == RESULT) f.small = word_;
@@ -1442,7 +1454,7 @@ class Wrist {
   }
 
  private:
-  enum Mode { REST, LOOK, CHOOSING, SENDING, RESULT };
+  enum Mode { REST, LOOK, CHOOSING, SENDING, RESULT, WAVES };
   struct Key {
     bool down = false;
     bool fired = false;
@@ -1630,8 +1642,15 @@ class Wrist {
   void closed(uint32_t now) {
     link_.closed(now);
     quiet_.closed();
+    if (mode_ == WAVES) rest();  // the wave face follows the link
   }
 
+  /** Someone waits on the person showing SAY HI, as the show says. */
+  bool waiting() const { return personal() && show_.armed == "hi" && !show_.quiet && waves_.n > 0; }
+
+  /** A FACE press on the resting HI or meeting face, with someone waiting and the link up, opens the wave face. */
+  bool opensWaves() const { return mode_ == REST && link_.up() && !quiet_.dark() && waiting(); }
+
   void hold(uint32_t now) {
     quiet_.held();
     rest();
````

- [ ] **Step 4: Run** — the table, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 330`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "the wave face opens with the link down",
  "file": "app/lib/wrist.js",
  "from": "return mode === 'rest' && link.up && !quiet.pending && waiting();",
  "to": "return mode === 'rest' && !quiet.pending && waiting();",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a FACE press opens nothing with nobody waiting, with the link down, or out of a look"
  ]
 },
 {
  "label": "nobody waiting is someone",
  "file": "app/lib/wrist.js",
  "from": "const waiting = () => personal() && show.armed === 'hi' && !show.quiet && waves.n > 0;",
  "to": "const waiting = () => personal() && show.armed === 'hi' && !show.quiet;",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: held from BAR_MS, KEEP HOLDING and a bar; a dark face lights only to LIGHT_AWAKE, a card keeps its light",
   "wrist.js: a FACE press opens nothing with nobody waiting, with the link down, or out of a look",
   "wrist.js: the wave face closes when nobody waits, when SAY HI goes, at the test light, and when the link drops"
  ]
 },
 {
  "label": "the wave face never times out",
  "file": "app/lib/wrist.js",
  "from": "if ((mode === 'look' || mode === 'waves') && now - stepAt >= CHOOSE_MS) rest();",
  "to": "if (mode === 'look' && now - stepAt >= CHOOSE_MS) rest();",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the wave face closes with a SIDE press, which never starts the chooser there, a FACE press, or CHOOSE_MS with no key"
  ]
 },
 {
  "label": "SIDE in the wave face does not close it",
  "file": "app/lib/wrist.js",
  "from": "      if (mode === 'waves') rest();\n      else if (k === 2) step(now);",
  "to": "      if (mode === 'waves' && k === 1) rest();\n      else if (k === 2) step(now);",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the wave face closes with a SIDE press, which never starts the chooser there, a FACE press, or CHOOSE_MS with no key"
  ]
 },
 {
  "label": "the shows never close the wave face",
  "file": "app/lib/wrist.js",
  "from": "} else if (mode === 'waves' && !waiting()) {",
  "to": "} else if (false) {",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the wave face closes when nobody waits, when SAY HI goes, at the test light, and when the link drops",
   "wrist.js: the wave face closes at the letters, the check, waiting and away"
  ]
 },
 {
  "label": "the link does not close the wave face",
  "file": "app/lib/wrist.js",
  "from": "    if (mode === 'waves') rest();  // the wave face follows the link\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the wave face closes when nobody waits, when SAY HI goes, at the test light, and when the link drops",
   "wrist.js: the wave face closes when the relay goes quiet and the socket is dropped"
  ]
 },
 {
  "label": "a new wave calls over the wave face",
  "file": "app/lib/wrist.js",
  "from": "if (newer && !waveCalling() && mode !== 'waves') callWave();",
  "to": "if (newer && !waveCalling()) callWave();",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a FACE press on the resting HI face with someone waiting opens the wave face on its release: someone waved, and how many wait"
  ]
 },
 {
  "label": "the wave face gives no count",
  "file": "app/lib/wrist.js",
  "from": "waves.n > 1 ? count + ' WAITING - HOLD SIDE' : 'HOLD SIDE: WAVE BACK'",
  "to": "'HOLD SIDE: WAVE BACK'",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a FACE press on the resting HI face with someone waiting opens the wave face on its release: someone waved, and how many wait"
  ]
 },
 {
  "label": "no 9+",
  "file": "app/lib/wrist.js",
  "from": "const count = waves.n > 9 ? '9+' : String(waves.n);",
  "to": "const count = String(waves.n);",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a FACE press on the resting HI face with someone waiting opens the wave face on its release: someone waved, and how many wait"
  ]
 },
 {
  "label": "C++: the wave face opens with the link down",
  "file": "firmware/src/band_logic.h",
  "from": "bool opensWaves() const { return mode_ == REST && link_.up() && !quiet_.dark() && waiting(); }",
  "to": "bool opensWaves() const { return mode_ == REST && !quiet_.dark() && waiting(); }",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a FACE press opens nothing with nobody waiting, with the link down, or out of a look"
  ]
 },
 {
  "label": "C++: the wave face never times out",
  "file": "firmware/src/band_logic.h",
  "from": "if ((mode_ == LOOK || mode_ == WAVES) && now - stepAt_ >= CHOOSE_MS) {",
  "to": "if (mode_ == LOOK && now - stepAt_ >= CHOOSE_MS) {",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: the wave face closes with a SIDE press, which never starts the chooser there, a FACE press, or CHOOSE_MS with no key"
  ]
 },
 {
  "label": "C++: the shows never close the wave face",
  "file": "firmware/src/band_logic.h",
  "from": "} else if (mode_ == WAVES && !waiting()) {",
  "to": "} else if (false) {",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: the wave face closes when nobody waits, when SAY HI goes, at the test light, and when the link drops",
   "band_logic.h: the wave face closes at the letters, the check, waiting and away"
  ]
 },
 {
  "label": "C++: the link does not close the wave face",
  "file": "firmware/src/band_logic.h",
  "from": "    if (mode_ == WAVES) rest();  // the wave face follows the link\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: the wave face closes when nobody waits, when SAY HI goes, at the test light, and when the link drops",
   "band_logic.h: the wave face closes when the relay goes quiet and the socket is dropped"
  ]
 },
 {
  "label": "C++: a new wave calls over the wave face",
  "file": "firmware/src/band_logic.h",
  "from": "if (newer && !waveCalling() && mode_ != WAVES) callWave();",
  "to": "if (newer && !waveCalling()) callWave();",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a FACE press on the resting HI face with someone waiting opens the wave face on its release: someone waved, and how many wait"
  ]
 },
 {
  "label": "C++: no 9+",
  "file": "firmware/src/band_logic.h",
  "from": "const std::string count = waves_.n > 9 ? \"9+\" : std::to_string(waves_.n);",
  "to": "const std::string count = std::to_string(waves_.n);",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a FACE press on the resting HI face with someone waiting opens the wave face on its release: someone waved, and how many wait"
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
Open the wave face with a FACE press: someone waved, and how many wait

On the resting HI or meeting face, with the link up and someone waiting, a
FACE press opens SOMEONE WAVED on its release, black with the HI blue for the
words, over HOLD SIDE: WAVE BACK, or N WAITING - HOLD SIDE (9+ past nine).
While a meeting calls, the press only answers it. A SIDE press, a FACE press
or CHOOSE_MS closes it, and SIDE never starts the chooser there; it also
closes when nobody waits, off SAY HI, at any show not about the person, and
when the link drops. A new wave while it is open calls nothing: the count
shows it. It is a choice under way, so a meeting jingles at once and blinks
once it closes, and a warning waits.

Mutation-checked: 15 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 6: A SIDE hold in the wave face waves back

**Files:**
- Modify: `app/lib/wrist.js`, `firmware/src/band_logic.h`
- Test: `tests/fixtures/wrist-cases.json`

**Interfaces:**
- Consumes: Task 5's `waves` mode and `waiting()`; the reactions plan's `result(now, word)`; Task 3's answers.
- Produces: a mode `waveback` (`WAVEBACK`). `waveBack(now)` sends `{"t":"wave","ref":<waves.ref>,"basis":<show.rev>}` and plays `double`. In `waveback` a SIDE press does nothing (`step()` returns) and a FACE hold still goes NOT NOW. `{ t: 'wave', ok: true }` rests the face; `ok: false` shows `CHANGED` for `changed` and `NOT SENT` otherwise; `CONFIRM_MS` with no answer shows `NOT SENT` and drops the socket. An answer of any other shape is ignored. `readWaves` keeps a `ref` only if it is ten lower-case hex, and `waiting()` also needs a `ref`. `face(now)` in `waveback`: `WAVE BACK` over `SENDING`, as the wave face is drawn.

- [ ] **Step 1: Write the failing cases.**

In `tests/fixtures/wrist-cases.json`:

````diff
--- a/tests/fixtures/wrist-cases.json
+++ b/tests/fixtures/wrist-cases.json
@@ -1116,6 +1116,96 @@
         { "at": "5000+HOLD_MS", "sounds": ["down"], "sent": [{ "t": "hold" }], "face": { "big": "", "light": "LIGHT_OFF" } },
         { "at": "7000", "key1": "up", "face": { "big": "", "light": "LIGHT_OFF" } }
       ]
+    },
+    {
+      "name": "a SIDE hold in the wave face waves back to the newest, from its show's rev, with a double; SENDING until the relay says it landed, then the face rests and the meeting calls",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "waves": { "ref": "c1d2e3f4a5", "n": 3, "seq": 1790337603009 } }, "sounds": ["hello"] },
+        { "at": "4000", "press": 1, "face": { "big": "SOMEONE WAVED" } },
+        { "at": "5000", "key2": "down", "sounds": ["tick"] },
+        { "at": "5000+HOLD_MS", "sent": [{ "t": "wave", "ref": "c1d2e3f4a5", "basis": 3 }], "sounds": ["double"], "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "6600", "key2": "up", "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "7000", "frame": { "t": "wave", "ok": true }, "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "7100", "show": "MEET", "rev": 3, "sounds": ["jingle"], "face": { "big": "27", "small": "MEET", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "a wave back refused changed shows CHANGED with fall and red; any other refusal NOT SENT with low and orange",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "4000", "press": 1, "face": { "big": "SOMEONE WAVED" } },
+        { "at": "5000", "key2": "down", "sounds": ["tick"] },
+        { "at": "5000+HOLD_MS", "sent": [{ "t": "wave", "ref": "a1b2c3d4e5", "basis": 3 }], "sounds": ["double"], "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "6600", "key2": "up", "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "7000", "frame": { "t": "wave", "ok": false, "why": "changed" }, "sounds": ["fall"], "face": { "field": "red", "light": "LIGHT_FULL" } },
+        { "at": "7700", "face": { "big": "HI :)", "small": "CHANGED" } },
+        { "at": "7000+RESULT_MS", "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "11000", "press": 1, "face": { "big": "SOMEONE WAVED" } },
+        { "at": "12000", "key2": "down", "sounds": ["tick"] },
+        { "at": "12000+HOLD_MS", "sent": [{ "t": "wave", "ref": "a1b2c3d4e5", "basis": 3 }], "sounds": ["double"], "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "14000", "frame": { "t": "wave", "ok": false, "why": "gone" }, "sounds": ["low"], "face": { "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "15300", "face": { "big": "HI :)", "small": "NOT SENT" } }
+      ]
+    },
+    {
+      "name": "a wave back with no answer in CONFIRM_MS shows NOT SENT and drops the socket",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "4000", "press": 1, "face": { "big": "SOMEONE WAVED" } },
+        { "at": "5000", "key2": "down", "sounds": ["tick"] },
+        { "at": "5000+HOLD_MS", "sent": [{ "t": "wave", "ref": "a1b2c3d4e5", "basis": 3 }], "sounds": ["double"], "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "6600", "key2": "up", "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "6500+CONFIRM_MS-1", "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "6500+CONFIRM_MS", "sent": ["DROP"], "sounds": ["low"], "face": { "field": "orange" } },
+        { "at": "7700+CONFIRM_MS", "face": { "small": "NOT SENT" } }
+      ]
+    },
+    {
+      "name": "while waving back SIDE does nothing and answers of the wrong shape are ignored; a meeting jingles at once and blinks once the face rests",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "4000", "press": 1, "face": { "big": "SOMEONE WAVED" } },
+        { "at": "5000", "key2": "down", "sounds": ["tick"] },
+        { "at": "5000+HOLD_MS", "sent": [{ "t": "wave", "ref": "a1b2c3d4e5", "basis": 3 }], "sounds": ["double"], "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "6600", "key2": "up", "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "7000", "press": 2, "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "7200", "frame": { "t": "wave" }, "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "7300", "frame": { "t": "set", "ok": true }, "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "7500", "show": "MEET", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["jingle"], "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "8000", "frame": { "t": "wave", "ok": true }, "face": { "big": "27", "light": "LIGHT_OFF" } },
+        { "at": "8600", "face": { "big": "27", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "a FACE hold while waving back goes NOT NOW, and the answer that follows changes nothing",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "4000", "press": 1, "face": { "big": "SOMEONE WAVED" } },
+        { "at": "5000", "key2": "down", "sounds": ["tick"] },
+        { "at": "5000+HOLD_MS", "sent": [{ "t": "wave", "ref": "a1b2c3d4e5", "basis": 3 }], "sounds": ["double"], "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "6600", "key2": "up", "face": { "big": "WAVE BACK", "small": "SENDING", "field": "black", "ink": "hi", "light": "LIGHT_AWAKE" } },
+        { "at": "7000", "key1": "down", "sounds": ["tick"] },
+        { "at": "7000+HOLD_MS", "sounds": ["down"], "sent": [{ "t": "hold" }], "face": { "big": "", "light": "LIGHT_OFF" } },
+        { "at": "8600", "key1": "up" },
+        { "at": "9000", "frame": { "t": "wave", "ok": false, "why": "changed" }, "face": { "big": "", "light": "LIGHT_OFF" } }
+      ]
+    },
+    {
+      "name": "a ref that is not ten lower-case hex is no one to answer: the wave calls, but a FACE press opens nothing",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "waves": { "ref": "A1B2C3D4E5", "n": 1, "seq": 1790337603000 } }, "sounds": ["hello"] },
+        { "at": "4000", "press": 1, "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "5000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5\"", "n": 1, "seq": 1790337603000 } } },
+        { "at": "6000", "press": 1, "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "7000", "show": "HI", "rev": 3, "with": { "waves": { "ref": "a1b2c3d4e5", "n": 1, "seq": 1790337603000 } } },
+        { "at": "8000", "press": 1, "face": { "big": "SOMEONE WAVED" } }
+      ]
     }
   ]
 }
````

New cases (6):

  - a SIDE hold in the wave face waves back to the newest, from its show's rev, with a double; SENDING until the relay says it landed, then the face rests and the meeting calls
  - a wave back refused changed shows CHANGED with fall and red; any other refusal NOT SENT with low and orange
  - a wave back with no answer in CONFIRM_MS shows NOT SENT and drops the socket
  - while waving back SIDE does nothing and answers of the wrong shape are ignored; a meeting jingles at once and blinks once the face rests
  - a FACE hold while waving back goes NOT NOW, and the answer that follows changes nothing
  - a ref that is not ten lower-case hex is no one to answer: the wave calls, but a FACE press opens nothing

- [ ] **Step 2: Run the table and watch it fail**

Run: `npm run build >/dev/null && node --test tests/wrist.test.js tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: `ℹ pass 166`, `ℹ fail 12`. The first errors:

```text
AssertionError [ERR_ASSERTION]: a SIDE hold in the wave face waves back to the newest, from its show's rev, with a double; SENDING until the relay says it landed, then the face rests and the meeting calls / 7500 tick: se
AssertionError [ERR_ASSERTION]: a wave back refused changed shows CHANGED with fall and red; any other refusal NOT SENT with low and orange / 7500 tick: sent
AssertionError [ERR_ASSERTION]: a wave back with no answer in CONFIRM_MS shows NOT SENT and drops the socket / 7500 tick: sent
AssertionError [ERR_ASSERTION]: while waving back SIDE does nothing and answers of the wrong shape are ignored; a meeting jingles at once and blinks once the face rests / 7500 tick: sent
AssertionError [ERR_ASSERTION]: a FACE hold while waving back goes NOT NOW, and the answer that follows changes nothing / 7500 tick: sent
AssertionError [ERR_ASSERTION]: a ref that is not ten lower-case hex is no one to answer: the wave calls, but a FACE press opens nothing / 5100 key1 up: face.big {"big":"SOMEONE WAVED","small":"HOLD SIDE: WAVE BACK","fie
```

Red (12):

- band_logic.h: a SIDE hold in the wave face waves back to the newest, from its show's rev, with a double; SENDING until the relay says it landed, then the face rests and the meeting calls
- band_logic.h: a wave back refused changed shows CHANGED with fall and red; any other refusal NOT SENT with low and orange
- band_logic.h: a wave back with no answer in CONFIRM_MS shows NOT SENT and drops the socket
- band_logic.h: while waving back SIDE does nothing and answers of the wrong shape are ignored; a meeting jingles at once and blinks once the face rests
- band_logic.h: a FACE hold while waving back goes NOT NOW, and the answer that follows changes nothing
- band_logic.h: a ref that is not ten lower-case hex is no one to answer: the wave calls, but a FACE press opens nothing
- wrist.js: a SIDE hold in the wave face waves back to the newest, from its show's rev, with a double; SENDING until the relay says it landed, then the face rests and the meeting calls
- wrist.js: a wave back refused changed shows CHANGED with fall and red; any other refusal NOT SENT with low and orange
- wrist.js: a wave back with no answer in CONFIRM_MS shows NOT SENT and drops the socket
- wrist.js: while waving back SIDE does nothing and answers of the wrong shape are ignored; a meeting jingles at once and blinks once the face rests
- wrist.js: a FACE hold while waving back goes NOT NOW, and the answer that follows changes nothing
- wrist.js: a ref that is not ten lower-case hex is no one to answer: the wave calls, but a FACE press opens nothing

- [ ] **Step 3: Implement in both twins.**

In `app/lib/wrist.js`:

````diff
--- a/app/lib/wrist.js
+++ b/app/lib/wrist.js
@@ -104,7 +104,9 @@ function readShow(s) {
 /** A show's waves, read apart from the show, as band_logic.h readFrame() reads them: nobody waiting unless said. */
 function readWaves(s) {
   const w = s.waves && typeof s.waves === 'object' ? s.waves : {};
-  return { ref: typeof w.ref === 'string' ? w.ref : '', n: Number.isInteger(w.n) ? w.n : 0, seq: Number.isInteger(w.seq) ? w.seq : 0 };
+  // A handle is ten lower-case hex: anything else is no one the band can answer.
+  const ref = typeof w.ref === 'string' && /^[a-f0-9]{10}$/.test(w.ref) ? w.ref : '';
+  return { ref, n: Number.isInteger(w.n) ? w.n : 0, seq: Number.isInteger(w.seq) ? w.seq : 0 };
 }
 
 const lit = (s) => LIT.includes(s.kind) && !!CARD_WORDS[s.intent];
@@ -121,7 +123,7 @@ export function createWrist({ key }) {
   let wakeUntil = 0;
   const k1 = { down: false, since: 0, fired: false };
   const k2 = { down: false, since: 0, fired: false };
-  let mode = 'rest';          // rest | look | choosing | sending | result | waves
+  let mode = 'rest';          // rest | look | choosing | sending | result | waves | waveback
   let preview = '';           // hi | song | dance | off
   let fromQuiet = false;
   let frozen = false;
@@ -265,7 +267,7 @@ export function createWrist({ key }) {
   }
 
   /** Someone waits on the person showing SAY HI, as the show says. */
-  const waiting = () => personal() && show.armed === 'hi' && !show.quiet && waves.n > 0;
+  const waiting = () => personal() && show.armed === 'hi' && !show.quiet && waves.n > 0 && waves.ref !== '';
 
   /** A FACE press on the resting HI or meeting face, with someone waiting and the link up, opens the wave face. */
   function opensWaves() {
@@ -308,8 +310,16 @@ export function createWrist({ key }) {
     if (held && !silent) react('double');
   }
 
+  /** A SIDE hold in the wave face: wave back to the newest waiting, from the state its show carried. */
+  function waveBack(now) {
+    send({ t: 'wave', ref: waves.ref, basis: show.rev });
+    mode = 'waveback';
+    sentAt = now;
+    react('double');
+  }
+
   function step(now) {
-    if (k1.down || frozen || mode === 'sending') return;
+    if (k1.down || frozen || mode === 'sending' || mode === 'waveback') return;
     if (mode === 'result') rest();
     if (mode === 'rest') {
       wake(now);
@@ -335,6 +345,7 @@ export function createWrist({ key }) {
   function sideHeld(now) {
     if (k1.down || frozen) return;
     if (mode === 'choosing') commit(now, true);
+    else if (mode === 'waves') waveBack(now);
     else if (mode === 'look') stepAt = now;
     else if (mode === 'rest' || mode === 'result') step(now);
   }
@@ -362,6 +373,10 @@ export function createWrist({ key }) {
       result(now, 'NOT SENT');
       if (link.up) { out.push('DROP'); closed(now); }
       if (fromQuiet) { quiet.pending = true; quiet.sent = false; }
+    } else if (mode === 'waveback' && now - sentAt >= CONFIRM_MS) {
+      // As for a choice: NOT SENT, and the socket dropped, so a wave stuck in it can no longer land.
+      result(now, 'NOT SENT');
+      if (link.up) { out.push('DROP'); closed(now); }
     } else if (mode === 'result' && now >= resultUntil) rest();
     settle(now);
   }
@@ -460,6 +475,14 @@ export function createWrist({ key }) {
       if (mode === 'sending') result(now, m.why === 'changed' ? 'CHANGED' : 'NOT SENT');
       return;
     }
+    // The relay's answer to a wave back. Landed: the face rests, and the meeting, if it made one, comes as a show.
+    if (m.t === 'wave' && typeof m.ok === 'boolean') {
+      if (mode === 'waveback') {
+        if (m.ok) rest();
+        else result(now, m.why === 'changed' ? 'CHANGED' : 'NOT SENT');
+      }
+      return;
+    }
     if (m.t !== 'show' || !m.show || typeof m.show !== 'object') return;
     const was = show;
     const wasSilent = silent;
@@ -577,6 +600,8 @@ export function createWrist({ key }) {
       // As the chooser shows HI, in its own words: that someone waved, and how many wait. Never who.
       const count = waves.n > 9 ? '9+' : String(waves.n);
       f = words('SOMEONE WAVED', waves.n > 1 ? count + ' WAITING - HOLD SIDE' : 'HOLD SIDE: WAVE BACK', 'black', 'hi', LIGHT_AWAKE);
+    } else if (mode === 'waveback') {
+      f = words('WAVE BACK', 'SENDING', 'black', 'hi', LIGHT_AWAKE);
     } else {
       f = restFace(now, wakeUntil > now || mode === 'result');
       if (mode === 'result') f = { ...f, small: word };
````

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -574,7 +574,13 @@ inline bool readFrame(const std::string& text, Frame& f) {
       if (k == "waves") {
         if (!r.peek('{')) return r.skip();
         return r.object([&](const std::string& w) {
-          if (w == "ref") return text_(f.waves.ref, 16);
+          if (w == "ref") {
+            if (!text_(f.waves.ref, 16)) return false;
+            // A handle is ten lower-case hex: anything else is no one the band can answer.
+            if (f.waves.ref.size() != 10 || f.waves.ref.find_first_not_of("0123456789abcdef") != std::string::npos)
+              f.waves.ref.clear();
+            return true;
+          }
           if (w != "n" && w != "seq") return r.skip();
           int64_t v = 0;
           bool whole = false;
@@ -1259,6 +1265,14 @@ class Wrist {
       if (mode_ == SENDING) result(now, f.why == "changed" ? "CHANGED" : "NOT SENT");
       return;
     }
+    // The relay's answer to a wave back. Landed: the face rests, and the meeting, if it made one, comes as a show.
+    if (f.t == "wave" && f.hasOk) {
+      if (mode_ == WAVEBACK) {
+        if (f.ok) rest();
+        else result(now, f.why == "changed" ? "CHANGED" : "NOT SENT");
+      }
+      return;
+    }
     if (f.t != "show" || !f.hasShow) return;
     // Reactions come from changes; a show that differs only in its sound switch is no change.
     const bool same = haveShow_ && show_ == f.show;
@@ -1398,6 +1412,13 @@ class Wrist {
       }
       // Hiding may arrive late; showing may not. Leaving NOT NOW failed, so hold it again.
       if (fromQuiet_) quiet_.held();
+    } else if (mode_ == WAVEBACK && now - sentAt_ >= CONFIRM_MS) {
+      // As for a choice: NOT SENT, and the socket dropped, so a wave stuck in it can no longer land.
+      result(now, "NOT SENT");
+      if (link_.up()) {
+        out_.push_back("DROP");
+        closed(now);
+      }
     } else if (mode_ == RESULT && static_cast<int32_t>(now - resultUntil_) >= 0) {
       rest();
     }
@@ -1421,6 +1442,8 @@ class Wrist {
       const std::string count = waves_.n > 9 ? "9+" : std::to_string(waves_.n);
       f = words("SOMEONE WAVED", waves_.n > 1 ? count + " WAITING - HOLD SIDE" : "HOLD SIDE: WAVE BACK", "black", "hi",
                 LIGHT_AWAKE);
+    } else if (mode_ == WAVEBACK) {
+      f = words("WAVE BACK", "SENDING", "black", "hi", LIGHT_AWAKE);
     } else {
       f = restFace(now, static_cast<int32_t>(wakeUntil_ - now) > 0 || mode_ == RESULT);
       if (mode_ == RESULT) f.small = word_;
@@ -1454,7 +1477,7 @@ class Wrist {
   }
 
  private:
-  enum Mode { REST, LOOK, CHOOSING, SENDING, RESULT, WAVES };
+  enum Mode { REST, LOOK, CHOOSING, SENDING, RESULT, WAVES, WAVEBACK };
   struct Key {
     bool down = false;
     bool fired = false;
@@ -1646,7 +1669,9 @@ class Wrist {
   }
 
   /** Someone waits on the person showing SAY HI, as the show says. */
-  bool waiting() const { return personal() && show_.armed == "hi" && !show_.quiet && waves_.n > 0; }
+  bool waiting() const {
+    return personal() && show_.armed == "hi" && !show_.quiet && waves_.n > 0 && !waves_.ref.empty();
+  }
 
   /** A FACE press on the resting HI or meeting face, with someone waiting and the link up, opens the wave face. */
   bool opensWaves() const { return mode_ == REST && link_.up() && !quiet_.dark() && waiting(); }
@@ -1699,9 +1724,17 @@ class Wrist {
     return "hi";
   }
 
+  /** A SIDE hold in the wave face: wave back to the newest waiting, from the state its show carried. */
+  void waveBack(uint32_t now) {
+    out_.push_back("{\"t\":\"wave\",\"ref\":\"" + waves_.ref + "\",\"basis\":" + std::to_string(show_.rev) + "}");
+    mode_ = WAVEBACK;
+    sentAt_ = now;
+    react("double");
+  }
+
   /** A KEY2 press let go before HOLD_MS. */
   void step(uint32_t now) {
-    if (k1_.down || frozen_ || mode_ == SENDING) return;
+    if (k1_.down || frozen_ || mode_ == SENDING || mode_ == WAVEBACK) return;
     if (mode_ == RESULT) rest();
     if (mode_ == REST) {
       wake(now);
@@ -1728,6 +1761,7 @@ class Wrist {
   void sideHeld(uint32_t now) {
     if (k1_.down || frozen_) return;
     if (mode_ == CHOOSING) commit(now, true);
+    else if (mode_ == WAVES) waveBack(now);
     else if (mode_ == LOOK) stepAt_ = now;
     else if (mode_ == REST || mode_ == RESULT) step(now);
   }
````

- [ ] **Step 4: Run** — the table, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 342`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "the wave back names no basis",
  "file": "app/lib/wrist.js",
  "from": "send({ t: 'wave', ref: waves.ref, basis: show.rev });",
  "to": "send({ t: 'wave', ref: waves.ref, basis: 0 });",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a SIDE hold in the wave face waves back to the newest, from its show's rev, with a double; SENDING until the relay says it landed, then the face rests and the meeting calls",
   "wrist.js: a wave back refused changed shows CHANGED with fall and red; any other refusal NOT SENT with low and orange",
   "wrist.js: a wave back with no answer in CONFIRM_MS shows NOT SENT and drops the socket",
   "wrist.js: while waving back SIDE does nothing and answers of the wrong shape are ignored; a meeting jingles at once and blinks once the face rests",
   "wrist.js: a FACE hold while waving back goes NOT NOW, and the answer that follows changes nothing"
  ]
 },
 {
  "label": "the wave back plays no double",
  "file": "app/lib/wrist.js",
  "from": "    react('double');\n  }\n\n  function step",
  "to": "  }\n\n  function step",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a SIDE hold in the wave face waves back to the newest, from its show's rev, with a double; SENDING until the relay says it landed, then the face rests and the meeting calls",
   "wrist.js: a wave back refused changed shows CHANGED with fall and red; any other refusal NOT SENT with low and orange",
   "wrist.js: a wave back with no answer in CONFIRM_MS shows NOT SENT and drops the socket",
   "wrist.js: while waving back SIDE does nothing and answers of the wrong shape are ignored; a meeting jingles at once and blinks once the face rests",
   "wrist.js: a FACE hold while waving back goes NOT NOW, and the answer that follows changes nothing"
  ]
 },
 {
  "label": "a wave back that lands does not rest",
  "file": "app/lib/wrist.js",
  "from": "        if (m.ok) rest();",
  "to": "        if (false) rest();",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a SIDE hold in the wave face waves back to the newest, from its show's rev, with a double; SENDING until the relay says it landed, then the face rests and the meeting calls",
   "wrist.js: while waving back SIDE does nothing and answers of the wrong shape are ignored; a meeting jingles at once and blinks once the face rests"
  ]
 },
 {
  "label": "every refused wave back is CHANGED",
  "file": "app/lib/wrist.js",
  "from": "        else result(now, m.why === 'changed' ? 'CHANGED' : 'NOT SENT');",
  "to": "        else result(now, 'CHANGED');",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a wave back refused changed shows CHANGED with fall and red; any other refusal NOT SENT with low and orange"
  ]
 },
 {
  "label": "a wave back waits for ever",
  "file": "app/lib/wrist.js",
  "from": "} else if (mode === 'waveback' && now - sentAt >= CONFIRM_MS) {",
  "to": "} else if (false) {",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a wave back with no answer in CONFIRM_MS shows NOT SENT and drops the socket"
  ]
 },
 {
  "label": "a ref that is not ten hex is someone",
  "file": "app/lib/wrist.js",
  "from": "const ref = typeof w.ref === 'string' && /^[a-f0-9]{10}$/.test(w.ref) ? w.ref : '';",
  "to": "const ref = typeof w.ref === 'string' ? w.ref : '';",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a ref that is not ten lower-case hex is no one to answer: the wave calls, but a FACE press opens nothing"
  ]
 },
 {
  "label": "a refused wave back goes unheard",
  "file": "app/lib/wrist.js",
  "from": "if (m.t === 'wave' && typeof m.ok === 'boolean') {",
  "to": "if (m.t === 'wave' && m.ok === true) {",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a wave back refused changed shows CHANGED with fall and red; any other refusal NOT SENT with low and orange"
  ]
 },
 {
  "label": "C++: the wave back names no basis",
  "file": "firmware/src/band_logic.h",
  "from": "\",\\\"basis\\\":\" + std::to_string(show_.rev) + \"}\");",
  "to": "\",\\\"basis\\\":0}\");",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a SIDE hold in the wave face waves back to the newest, from its show's rev, with a double; SENDING until the relay says it landed, then the face rests and the meeting calls",
   "band_logic.h: a wave back refused changed shows CHANGED with fall and red; any other refusal NOT SENT with low and orange",
   "band_logic.h: a wave back with no answer in CONFIRM_MS shows NOT SENT and drops the socket",
   "band_logic.h: while waving back SIDE does nothing and answers of the wrong shape are ignored; a meeting jingles at once and blinks once the face rests",
   "band_logic.h: a FACE hold while waving back goes NOT NOW, and the answer that follows changes nothing"
  ]
 },
 {
  "label": "C++: the wave back plays no double",
  "file": "firmware/src/band_logic.h",
  "from": "    react(\"double\");\n  }\n\n  /** A KEY2 press let go",
  "to": "  }\n\n  /** A KEY2 press let go",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a SIDE hold in the wave face waves back to the newest, from its show's rev, with a double; SENDING until the relay says it landed, then the face rests and the meeting calls",
   "band_logic.h: a wave back refused changed shows CHANGED with fall and red; any other refusal NOT SENT with low and orange",
   "band_logic.h: a wave back with no answer in CONFIRM_MS shows NOT SENT and drops the socket",
   "band_logic.h: while waving back SIDE does nothing and answers of the wrong shape are ignored; a meeting jingles at once and blinks once the face rests",
   "band_logic.h: a FACE hold while waving back goes NOT NOW, and the answer that follows changes nothing"
  ]
 },
 {
  "label": "C++: a wave back that lands does not rest",
  "file": "firmware/src/band_logic.h",
  "from": "        if (f.ok) rest();",
  "to": "        if (false) rest();",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a SIDE hold in the wave face waves back to the newest, from its show's rev, with a double; SENDING until the relay says it landed, then the face rests and the meeting calls",
   "band_logic.h: while waving back SIDE does nothing and answers of the wrong shape are ignored; a meeting jingles at once and blinks once the face rests"
  ]
 },
 {
  "label": "C++: a wave back waits for ever",
  "file": "firmware/src/band_logic.h",
  "from": "} else if (mode_ == WAVEBACK && now - sentAt_ >= CONFIRM_MS) {",
  "to": "} else if (false) {",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a wave back with no answer in CONFIRM_MS shows NOT SENT and drops the socket"
  ]
 },
 {
  "label": "C++: an upper-case ref is someone",
  "file": "firmware/src/band_logic.h",
  "from": "if (f.waves.ref.size() != 10 || f.waves.ref.find_first_not_of(\"0123456789abcdef\") != std::string::npos)",
  "to": "if (f.waves.ref.size() != 10)",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a ref that is not ten lower-case hex is no one to answer: the wave calls, but a FACE press opens nothing"
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
Wave back from the wrist with a SIDE hold in the wave face

The hold sends {t:'wave', ref, basis} to the newest waiting, from the rev its
show carried, plays double, and shows WAVE BACK / SENDING, where SIDE does
nothing and a FACE hold still goes NOT NOW. ok rests the face, and the
meeting comes as a show; changed shows CHANGED, any other refusal NOT SENT,
and no answer in CONFIRM_MS shows NOT SENT and drops the socket, as for a
choice. A ref that is not ten lower-case hex is no one to answer.

Mutation-checked: 12 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 7: The band's console says waves, as a count and never who

**Files:**
- Modify: `firmware/src/band_logic.h`
- Test: `firmware/host/logic_test.cpp`

**Interfaces:**
- Consumes: `saidLine(frame)` and `heardLine(frame, shown)` in `band_logic.h`, which `main.cpp` already prints.
- Produces: `saidLine` says `a wave back from the wrist`; `heardLine` says `the relay took the wave back` or `the relay did not take the wave back: <why>`, and adds ` (N waiting)` to a show's line, so a change in the count is a line of its own.

- [ ] **Step 1: Write the failing checks.**

In `firmware/host/logic_test.cpp`:

````diff
--- a/firmware/host/logic_test.cpp
+++ b/firmware/host/logic_test.cpp
@@ -459,6 +459,7 @@ void console() {
   CHECK(saidLine(helloFrame(id, key, 62, secret, true)) == "hello to the relay, with its secret");
   CHECK(saidLine("{\"t\":\"set\",\"intent\":\"hi\",\"basis\":7}") == "a choice from the wrist: HI :)");
   CHECK(saidLine("{\"t\":\"set\",\"intent\":null,\"basis\":7}") == "a choice from the wrist: OFF");
+  CHECK(saidLine("{\"t\":\"wave\",\"ref\":\"a1b2c3d4e5\",\"basis\":7}") == "a wave back from the wrist");
 
   std::string shown;
   const auto heard = [&shown](const std::string& text) {
@@ -482,6 +483,14 @@ void console() {
   CHECK(heard("{\"t\":\"show\",\"show\":{\"kind\":\"meet\",\"intent\":\"hi\",\"big\":\"42\",\"small\":\"MEET\"}}") == "the relay shows: meet 42");
   CHECK(heard("{\"t\":\"show\",\"show\":{\"kind\":\"waiting\"}}") == "the relay shows: waiting");
   CHECK(heard("{\"t\":\"ping\"}").empty());
+  // Who waits is part of what it shows, as a count; never the handle.
+  const std::string hi = "{\"t\":\"show\",\"show\":{\"kind\":\"hi\",\"intent\":\"hi\",\"armed\":\"hi\",\"rev\":7";
+  CHECK(heard(hi + "}}") == "the relay shows: hi");
+  const std::string two = heard(hi + ",\"waves\":{\"ref\":\"a1b2c3d4e5\",\"n\":2,\"seq\":1790337603000}}}");
+  CHECK(two == "the relay shows: hi (2 waiting)" && two.find("a1b2") == std::string::npos);
+  CHECK(heard(hi + ",\"waves\":{\"ref\":\"f6a7b8c9d0\",\"n\":2,\"seq\":1790337603005}}}").empty());
+  CHECK(heard("{\"t\":\"wave\",\"ok\":true}") == "the relay took the wave back");
+  CHECK(heard("{\"t\":\"wave\",\"ok\":false,\"why\":\"gone\"}") == "the relay did not take the wave back: gone");
 }
 
 void said() {
````

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: `ℹ pass 92`, `ℹ fail 1`. The first errors:

```text
AssertionError [ERR_ASSERTION]: firmware/host\logic_test.cpp:462: failed: saidLine("{\"t\":\"wave\",\"ref\":\"a1b2c3d4e5\",\"basis\":7}") == "a wave back from the wrist"
```

Red (1):

- the wristband logic passes its own checks

- [ ] **Step 3: Implement.**

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -1834,12 +1834,13 @@ inline Command readCommand(const std::string& line) {
 
 /**
  * What the console says about a frame the wrist sends, or "" for nothing: a
- * hello says whether it carries a secret, never the secret itself, and a
- * choice says what was chosen.
+ * hello says whether it carries a secret, never the secret itself, a choice
+ * says what was chosen, and a wave back only that it was sent.
  */
 inline std::string saidLine(const std::string& frame) {
   if (frame == "DROP") return "the relay went quiet; trying again";
   if (frame == HOLD_FRAME) return "NOT NOW, from the wrist";
+  if (frame.rfind("{\"t\":\"wave\"", 0) == 0) return "a wave back from the wrist";
   if (frame.rfind("{\"t\":\"wristband\"", 0) == 0)
     return frame.find("\"secret\":") == std::string::npos ? "hello to the relay, as a new wristband"
                                                           : "hello to the relay, with its secret";
@@ -1855,12 +1856,14 @@ inline std::string saidLine(const std::string& frame) {
 
 /**
  * What the console says about a frame from the relay, or "" for nothing:
- * what it refuses, a pairing, and each change in what it shows. `shown` is
- * what was last said about a show, kept by the caller. Never a secret.
+ * what it refuses, a pairing, the answer to a wave back, and each change in
+ * what it shows, how many wait included. `shown` is what was last said about
+ * a show, kept by the caller. Never a secret, and never who waved.
  */
 inline std::string heardLine(const Frame& f, std::string& shown) {
   if (f.t == "error") return "the relay says: " + f.why;
   if (f.t == "set" && f.hasOk && !f.ok) return "the relay did not take the choice: " + f.why;
+  if (f.t == "wave" && f.hasOk) return f.ok ? "the relay took the wave back" : "the relay did not take the wave back: " + f.why;
   if (f.t == "paired" && f.hasSecret) return "paired: the relay gave it a secret";
   if (f.t != "show" || !f.hasShow) return "";
   const Show& s = f.show;
@@ -1869,6 +1872,7 @@ inline std::string heardLine(const Frame& f, std::string& shown) {
   else if (s.kind == "check" || s.kind == "meet") what += " " + s.big;
   else if (s.quiet) what += " (NOT NOW)";
   else if (s.away) what += " (away)";
+  if (f.waves.n > 0) what += " (" + std::to_string(f.waves.n) + " waiting)";
   if (what == shown) return "";
   shown = what;
   return "the relay shows: " + what;
````

- [ ] **Step 4: Run** — the file, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 342`. Then P3: both envs build.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "the console says nothing of a wave back",
  "file": "firmware/src/band_logic.h",
  "from": "  if (frame.rfind(\"{\\\"t\\\":\\\"wave\\\"\", 0) == 0) return \"a wave back from the wrist\";\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "the console names who waits",
  "file": "firmware/src/band_logic.h",
  "from": "what += \" (\" + std::to_string(f.waves.n) + \" waiting)\";",
  "to": "what += \" (\" + f.waves.ref + \")\";",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "the console says nothing of the relay's answer",
  "file": "firmware/src/band_logic.h",
  "from": "  if (f.t == \"wave\" && f.hasOk) return f.ok ? \"the relay took the wave back\" : \"the relay did not take the wave back: \" + f.why;\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 }
]
````

- [ ] **Step 6: Commit, and close Stage B with P2**

```bash
git add firmware/src/band_logic.h firmware/host/logic_test.cpp
```

````bash
git commit -F - <<'EOF'
Say waves on the band's console, as a count and never who

The console says "a wave back from the wrist" as it goes, the relay's answer
to it, and how many wait beside each change in what the relay shows, so a
change in the count is a line of its own. Never a handle.

Mutation-checked: 3 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---

## Stage C — The phone

### Task 8: The phone buzzes for a wave only without a live wristband

**Files:**
- Create: `app/lib/waved.js`, `tests/waved.test.js`
- Modify: `app/lib/store.js`, `app/App.jsx`, `app/screens/Hi.jsx`

**Interfaces:**
- Consumes: the view's `near` rows (`wavedAtYou`, `waved`, `handle`) and `me.wristband.live`; `store.tonight()`, `store.tonightKey()`; `buzz()` from `app/lib/device.js`.
- Produces: `newWaves(view, seen)` → the rows that waved at you, not waved back, and not in `seen`; `buzzes(fresh, view)` → `fresh.length > 0 && !view.me.wristband?.live`; `WAVED_LINE`; `WAVES_HOW`. `store.noteWaves(s, handles)` adds tonight's seen handles as `nights[key].waves`, and returns `s` itself when nothing is new or there is no night. In `App.jsx`, an effect beside the match buzz: new rows are marked seen (a ref and the night's record), and buzz `[90]` only when `buzzes()` says so. `Hi.jsx` shows `WAVED_LINE` on a row you waved at; "How this works" gains a `waving_hand` row with `WAVES_HOW`.

- [ ] **Step 1: Write the failing tests.**

Create `tests/waved.test.js`:

````js
// ON THE BEAT — a wave at you, on the phone: a buzz only when no live wristband
// calls instead, once for each wave, and never again after a reload.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WAVED_LINE, WAVES_HOW, buzzes, newWaves } from '../app/lib/waved.js';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const store = await import('../app/lib/store.js');
beforeEach(() => mem.clear());

const row = (handle, more = {}) => ({ handle, band: 'in this room', pick: null, waved: false, wavedAtYou: false, ...more });
const view = (near, wristband = null) => ({ me: { armed: 'hi', wristband }, near });

test('newWaves() gives the rows that waved at you and wait, and only those not seen before', () => {
  const v = view([row('a', { wavedAtYou: true }), row('b'), row('c', { wavedAtYou: true, waved: true }), row('d', { waved: true })]);
  assert.deepEqual(newWaves(v, []).map((r) => r.handle), ['a'], 'not one you waved back to, nor one who never waved');
  assert.deepEqual(newWaves(v, ['a']), [], 'seen once is seen');
  assert.deepEqual(newWaves({ me: null, near: [] }, []), []);
});

test('new waves buzz the phone only when no live wristband calls instead', () => {
  const fresh = [row('a', { wavedAtYou: true })];
  assert.equal(buzzes(fresh, view([], null)), true, 'no wristband');
  assert.equal(buzzes(fresh, view([], { battery: 40, live: false })), true, 'a wristband that is flat, off or out of reach');
  assert.equal(buzzes(fresh, view([], { battery: 40, live: true })), false, 'a live wristband calls, and the phone stays still');
  assert.equal(buzzes([], view([], null)), false, 'nothing new');
});

test("a wave once seen is kept in the night's record: no buzz after a reload, or when the band later goes out of reach", () => {
  let s = store.startNight(store.load(), { id: 'x', room: 'x', venue: 'The Roundhouse', act: 'Kayo' });
  s = store.noteWaves(s, ['a']);
  store.save(s);
  const back = store.load();
  const v = view([row('a', { wavedAtYou: true }), row('b', { wavedAtYou: true })], { battery: 40, live: false });
  assert.deepEqual(newWaves(v, store.tonight(back).waves).map((r) => r.handle), ['b']);
  assert.equal(store.noteWaves(back, ['a']), back, 'seen again changes nothing');
  assert.deepEqual(store.tonight(store.noteWaves(back, ['b', 'a'])).waves, ['a', 'b']);
  assert.equal(store.noteWaves({ ...back, nights: {} }, ['a']).nights[store.tonightKey()], undefined, 'no night, no record');
});

test('the words: a row you waved at says they will be told, and How this works says what the wristband does', () => {
  assert.equal(WAVED_LINE, "Waved — they'll be told");
  assert.equal(WAVES_HOW, 'Someone waving shows on your wristband: press its face to see, and hold its side to wave back.');
});
````

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/waved.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: `ℹ pass 0`, `ℹ fail 1`. The first errors:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'app/lib\waved.js' imported from tests/waved.test.js
```

Red (1):

- tests\waved.test.js

- [ ] **Step 3: Implement.**

Create `app/lib/waved.js`:

````js
// A wave at you, on the phone (docs/superpowers/specs/2026-09-25-wrist-waves-
// design.md §2 and §3). With a live wristband the band calls, and the phone
// does not buzz as well. Without one (none paired, or paired but flat, off or
// out of reach) the phone buzzes once for each new wave. A wave is marked seen
// either way, in the night's record, so neither a reload nor a band that later
// goes out of reach brings a buzz for a wave already called.

/** The SAY HI rows that waved at you and wait, which the phone has not seen before. */
export function newWaves(view, seen) {
  const known = new Set(seen);
  return (view?.near || []).filter((r) => r.wavedAtYou && !r.waved && !known.has(r.handle));
}

/** Whether new waves buzz the phone: only with no live wristband to call instead. */
export const buzzes = (fresh, view) => fresh.length > 0 && !view?.me?.wristband?.live;

/** A row's line once you waved: nothing about whether they wear a band. */
export const WAVED_LINE = "Waved — they'll be told";

/** "How this works": the wristband's part in a wave. */
export const WAVES_HOW = 'Someone waving shows on your wristband: press its face to see, and hold its side to wave back.';
````

In `app/lib/store.js`:

````diff
--- a/app/lib/store.js
+++ b/app/lib/store.js
@@ -70,6 +70,17 @@ export function hasEvent(s, kind) {
   return !!tonight(s)?.events.some((e) => e.kind === kind);
 }
 
+/** Waves at the person that the phone has seen tonight, by handle: each is buzzed for once at most. */
+export function noteWaves(s, handles) {
+  const key = tonightKey();
+  const n = s.nights[key];
+  if (!n) return s;
+  const had = n.waves || [];
+  const more = handles.filter((h) => !had.includes(h));
+  if (!more.length) return s;
+  return { ...s, nights: { ...s.nights, [key]: { ...n, waves: [...had, ...more] } } };
+}
+
 /** A match as the phone last saw it — kept even after the relay has forgotten it. */
 export function noteMatch(s, m) {
   const key = tonightKey();
````

In `app/App.jsx`:

````diff
--- a/app/App.jsx
+++ b/app/App.jsx
@@ -6,6 +6,7 @@ import { INTENT_OF, follow, nextSeq, tapMessage } from './lib/follow.js';
 import { connect } from './lib/net.js';
 import { phaseLine, phaseOf } from './lib/phase.js';
 import * as store from './lib/store.js';
+import { WAVES_HOW, buzzes, newWaves } from './lib/waved.js';
 import { Bar, Home } from './screens/Home.jsx';
 import { Beacon, Near, WristBeacon } from './screens/Hi.jsx';
 import { Pair, bandLine } from './screens/Band.jsx';
@@ -263,6 +264,21 @@ export default function App() {
   }, [view]);
   useEffect(() => { seen.current = null; }, [night?.me]);
 
+  // A wave at you the phone has not seen: one buzz, unless a live wristband calls instead. Seen either way.
+  const wavesSeen = useRef(null);
+  useEffect(() => {
+    if (!view.me) return;
+    const known = wavesSeen.current ?? new Set(night?.waves || []);
+    wavesSeen.current = known;
+    const fresh = newWaves(view, known);
+    if (!fresh.length) return;
+    for (const r of fresh) known.add(r.handle);
+    update((prev) => store.noteWaves(prev, fresh.map((r) => r.handle)));
+    if (buzzes(fresh, view)) buzz([90]);
+    // eslint-disable-next-line react-hooks/exhaustive-deps
+  }, [view]);
+  useEffect(() => { wavesSeen.current = null; }, [night?.me]);
+
   // The relay decides (§3): a view that passes rule 4 sets the cards, the screen and what is re-said.
   useEffect(() => {
     if (!view.me) return;
@@ -395,6 +411,7 @@ export default function App() {
       ...PROMISES.map((p) => ({ icon: p.icon, label: p.main, sub: p.sub, fg: '#fff', onTap: () => {} })),
       { icon: 'watch', label: 'Hold the face button on your wristband to go invisible. Hold its side button to come back.', fg: '#fff', onTap: () => {} },
       { icon: 'touch_app', label: 'Press the side button to see your card, and again to change it. Your phone follows.', fg: '#fff', onTap: () => {} },
+      { icon: 'waving_hand', label: WAVES_HOW, fg: '#fff', onTap: () => {} },
     ],
   });
 
````

In `app/screens/Hi.jsx`:

````diff
--- a/app/screens/Hi.jsx
+++ b/app/screens/Hi.jsx
@@ -1,6 +1,7 @@
 import { useEffect } from 'react';
 import { someone } from '../copy.js';
 import { holdScreen } from '../lib/device.js';
+import { WAVED_LINE } from '../lib/waved.js';
 import { Back, Icon, More, Pill } from '../ui.jsx';
 import { BandFace } from './Band.jsx';
 
@@ -91,7 +92,7 @@ export function Near({ near, offline, onBack, onWave, onMore }) {
           </div>
         ) : null}
         {near.map((p) => {
-          const label = p.waved ? "Waved — they'll see a blue dot" : p.wavedAtYou ? someone(p.band) + ' waved at you' : someone(p.band);
+          const label = p.waved ? WAVED_LINE : p.wavedAtYou ? someone(p.band) + ' waved at you' : someone(p.band);
           return (
             <div key={p.handle} className="row" style={p.wavedAtYou && !p.waved ? { borderColor: 'var(--hi)' } : undefined}>
               <div className="person">
````

- [ ] **Step 4: Run** — the file, `tests/copy.test.js`, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 346`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`. The effect in `App.jsx` is held by the browser proof (Task 9), not by a unit test.

````json
[
 {
  "label": "a live band does not stop the buzz",
  "file": "app/lib/waved.js",
  "from": "export const buzzes = (fresh, view) => fresh.length > 0 && !view?.me?.wristband?.live;",
  "to": "export const buzzes = (fresh, view) => fresh.length > 0;",
  "test": "tests/waved.test.js",
  "expect": [
   "new waves buzz the phone only when no live wristband calls instead"
  ]
 },
 {
  "label": "a row waved back to is new",
  "file": "app/lib/waved.js",
  "from": "r.wavedAtYou && !r.waved && !known.has(r.handle)",
  "to": "r.wavedAtYou && !known.has(r.handle)",
  "test": "tests/waved.test.js",
  "expect": [
   "newWaves() gives the rows that waved at you and wait, and only those not seen before"
  ]
 },
 {
  "label": "a row seen is new again",
  "file": "app/lib/waved.js",
  "from": "r.wavedAtYou && !r.waved && !known.has(r.handle)",
  "to": "r.wavedAtYou && !r.waved",
  "test": "tests/waved.test.js",
  "expect": [
   "newWaves() gives the rows that waved at you and wait, and only those not seen before",
   "a wave once seen is kept in the night's record: no buzz after a reload, or when the band later goes out of reach"
  ]
 },
 {
  "label": "a wave seen again is kept twice",
  "file": "app/lib/store.js",
  "from": "const more = handles.filter((h) => !had.includes(h));",
  "to": "const more = handles;",
  "test": "tests/waved.test.js",
  "expect": [
   "a wave once seen is kept in the night's record: no buzz after a reload, or when the band later goes out of reach"
  ]
 },
 {
  "label": "a wave with no night makes one",
  "file": "app/lib/store.js",
  "from": "  if (!n) return s;\n  const had = n.waves || [];",
  "to": "  const had = (n || {}).waves || [];",
  "test": "tests/waved.test.js",
  "expect": [
   "a wave once seen is kept in the night's record: no buzz after a reload, or when the band later goes out of reach"
  ]
 }
]
````

- [ ] **Step 6: Commit, and close Stage C with P2**

```bash
git add app/lib/waved.js app/lib/store.js app/App.jsx app/screens/Hi.jsx tests/waved.test.js
```

````bash
git commit -F - <<'EOF'
Buzz the phone for a wave only when no live wristband calls

app/lib/waved.js gives the new "waved at you" rows; the phone buzzes once for
them when its wristband is not live, and marks them seen in the night's
record either way, so neither a reload nor a band that later goes out of
reach buzzes again for a wave already called. A row you waved at now says
"Waved — they'll be told", and How this works says what the wristband does.

Mutation-checked: 5 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---

## Stage D — Proof and docs

### Task 9: The browser proof

Two people on one relay, each a phone and a `/band` stand-in, in the browser pane. Run it on `main` once Tasks 1–8 are pushed; it comes before the README because the README says what it saw. When this plan was written it was done on the finished build, and everything below was seen.

- **Two people need two origins:** tabs on one origin share `localStorage`. Use `http://localhost:<port>` for A (phone and band) and `http://127.0.0.1:<port>` for B.
- Seed each phone's `localStorage['otb:v1']` as CLAUDE.md shows (a night at a test room, the same `show.room` for both), then open `/pair/<letters>` and press YES with `element.click()`.
- **Each band's first press must be a real click** (the pane's `computer` click, by coordinates or by a `ref` from `find`), to unlock its audio; after that a `keydown`/`keyup` of Enter dispatched on `.bandbtn` (FACE) or `.bandside` (SIDE) presses it too, and holding means waiting 1.7 s between the two.
- Install the oscillator spy of the reactions plan's Task 11 Step 6 on each band before its first click, and a face sampler (the `.bandface` element's inline `background`, `filter` and text every 25 ms). **Keep the band being sampled in front:** a hidden tab runs its timers about once a second.
- **The wave face closes after `CHOOSE_MS`.** Open it and hold SIDE in one script; two separate tool calls can take longer than 6 s.
- Record `navigator.vibrate` on each phone by replacing it with a function that pushes its pattern.

- [ ] **Step 1: Both on SAY HI.** On each phone: the `SAY HI :)` card (`button.intent`), then the `cta`. A opens WHO'S NEAR.
- [ ] **Step 2: A waves.** Expected on B's band: `hello` (1568 Hz at 0, 2093 Hz at 0.06 s); three on steps with no words in the HI card's blue (its gradient) and three off steps at `brightness(0)`, about 500 ms each; then `HI :)` again at about 3 s. A's row says *Waved — they'll be told*. B's phone does not buzz (its band is live) and records the wave in `nights[<key>].waves`.
- [ ] **Step 3: B opens the wave face.** A FACE press: a tick, and on its release `SOMEONE WAVED` / `HOLD SIDE: WAVE BACK`, background `rgb(0, 0, 0)`, words `rgb(78, 215, 241)`, `brightness(0.431373)` (110 of 255).
- [ ] **Step 4: B waves back.** Hold SIDE: `double` when the hold comes due, then on both bands in the same moment `MEET` over the same number and `jingle` (1319, 1568, 2637, 2093, 2349, 3136 Hz), blinking; both phones *Look for the wristband showing <n>*, each with the other's name, and one `[70, 50, 70]` buzz each. On a local relay the answer is back within a few milliseconds, so `WAVE BACK` / `SENDING` is on the face for under 20 ms and is not sampled; the table holds it.
- [ ] **Step 5: No live band, a buzz.** Close A's band tab. On B's origin, replace the stored night's `me` and name with a new person, reload, go SAY HI and wave at every row. Expected: A's phone buzzes `[90]` once and records the wave; B's band, still live and still calling its meeting, plays `hello`.
- [ ] **Step 6: Reset the viewport** of the browser pane, close the tabs, and stop the relay.

### Task 10: The README and the promises

**Files:**
- Modify: `README.md`, `relay/band.js` (its header), `relay/room.js` (its header), `docs/superpowers/specs/2026-09-25-wrist-reactions-design.md` (its canvas note)

The spec's "Also to change when this is built": the wave row of README's table of what each yes shows, and the same words at the top of `relay/room.js`; `relay/band.js`'s promise and README's "Where this differs from the canvas, on purpose"; README "Abuse resistance", the band's yes for its person; and the reactions spec's canvas note. README also says what a band on SAY HI is told, how the call, the wave face and the wave back work, and what is not yet tried. The line "Waves on the wrist have been tried only in the tables and a browser" rests on Task 9: write it only once that proof has been done.

- [ ] **Step 1: Edit.**

In `README.md`:

````diff
--- a/README.md
+++ b/README.md
@@ -101,7 +101,7 @@ What each kind of yes shows the other side before it is returned:
 
 | | seen by the other person? |
 |---|---|
-| a wave (SAY HI) | yes — a blue dot on a row that is still only a band, so they can wave back |
+| a wave (SAY HI) | yes — a blue dot on a row that is still only a band, so they can wave back; and on their wristband, a short call and a count of who waits, never who |
 | a like (FIRST SONG?) | never — it was for an answer, not a face |
 | a dance back (LET'S DANCE!) | yes — the clip goes straight to them, with no name on it |
 
@@ -190,8 +190,11 @@ that was taken.
   `viewFor()` its person's phone is sent, so it can never show more than the
   phone could: its person's colour and card words while a card is armed, the
   two-digit meeting number for fifteen minutes after a match (the same number
-  on both wrists), and nothing at all under NOT NOW. Never a name, never
-  anyone else's pick, never a contact. At 15% battery it dims itself.
+  on both wrists), and nothing at all under NOT NOW. While its person shows
+  SAY HI it is also told that someone waved and how many wait: the newest
+  one's handle, a count and a number, the same size however many wait. Never a
+  name, never anyone else's pick, never a contact. At 15% battery it dims
+  itself.
 - **Its two buttons.** The face button (KEY1): a press wakes it for six
   seconds; held for 1.5 s it is NOT NOW — dark at once — and the phone
   follows to the invisible screen. The side button (KEY2): a press shows
@@ -218,6 +221,20 @@ that was taken.
   held equal by `tests/firmware.test.js`; the notes are starting points, to be
   tuned by ear on a band. `/band` plays the same notes through Web Audio once
   its page has been tapped, which is when a browser first lets a page sound.
+- **A wave reaches the wrist, and is answered there.** A wave at someone on
+  SAY HI calls their wristband: a short `hello` and the HI blue three times,
+  whatever the keys do. During it a key only ticks, and only a face hold still
+  goes NOT NOW, so how long it lasts says nothing about whether it was seen;
+  waves that arrive meanwhile join it. A face press on the resting HI or
+  meeting face then opens `SOMEONE WAVED` over `HOLD SIDE: WAVE BACK`, or
+  `3 WAITING - HOLD SIDE` when more wait (`9+` past nine). A side hold there
+  waves back to the newest, and the relay answers it as it answers a choice:
+  one that lands makes the match, and both wristbands show the same `MEET`
+  number and call it; one that does not shows `NOT SENT`, or `CHANGED` if its
+  own person's card moved meanwhile. Anyone else waiting is answered on the
+  phone. Waves are numbered by the relay's clock, so a band never calls twice
+  for one wave, even past a relay restart, and never misses the next. The
+  phone buzzes for a wave only when no live wristband calls instead.
 - **The sound can be switched off, on the phone.** The wristband sheet has
   `SOUND: ON` under TEST THE LIGHT; off, the band only lights up. The switch is
   the person's own: the phone keeps it across nights and re-says it after
@@ -398,8 +415,13 @@ shows.
   light patterns that pretend to carry a message. The owner chose on 25 Sep
   2026 that the band flashes and sounds, and none of it pretends: each
   reaction answers something the wearer just did, or says one fact about the
-  band, and the only one about another person is the meeting call, for a
-  number the band already shows.
+  band. The two about another person are the meeting call, for a number the
+  band already shows, and a wave's call.
+- **The wristband says that someone waved.** Revision 6 §8 keeps names,
+  photos and other people's picks off the wristband, and it showed nothing
+  about anyone else but the meeting number. The owner chose on 25 Sep 2026
+  that it also says that someone waved at its person and how many wait, and
+  can wave back to the newest. Still no name, no photo, no pick and no area.
 
 ## Abuse resistance
 
@@ -439,6 +461,17 @@ was red-teamed and hardened. A red/blue pass found and closed:
   news; a showing change names the revision it was chosen from. A person who
   left under NOT NOW and comes back is still invisible, and a join made while
   holding NOT NOW makes them invisible from the first moment.
+- **A wristband's yes for its person.** A band can wave back, which makes a
+  match and shows both names. It speaks for its person only with the secret of
+  its pairing, so no other band can wave as them. Its wave is dropped whole
+  unless it is exactly one, then refused `too fast` (one a second, counted
+  before any handle is looked up and whether or not it lands, so a flood of
+  made-up handles buys nothing), `unpaired`, `no room`, `changed` (its
+  person's revision moved, or they are not on SAY HI) and `gone` when the
+  handle is not someone waiting on its person, which a block reads exactly
+  like. A band never starts a wave: with none to answer, nothing is recorded.
+  A lent, taken or forgotten band can still make a match for its person, with
+  or without their phone; blocking undoes it.
 - **Rooms that never emptied.** A venue with nobody in it, nobody in its grace
   window, no clip still loading and no wristband still worn is now reclaimed, so
   a long-lived relay does not keep a room object for every venue anyone typed.
@@ -533,9 +566,12 @@ relay could drive what a wrist shows.
   it for its hour, including someone who has since been blocked. The address
   is 96 random bits and only ever shown inside a room.
 - **Reports go to a log**, not to a person.
-- **Answering someone from the wrist** (phase B) is not built: only waving back
-  at a SAY HI could be, since a like needs the other person's pick, which the
-  wrist never shows.
+- **Waves on the wrist have been tried only in the tables and a browser.**
+  Both twins pass the shared cases and the relay's tests hold every refusal,
+  but a wave, its call and a wave back from a band are not yet tried on the
+  two real bands with two real people. Answering from the wrist is only
+  waving back: a like needs the other person's pick, which the wrist never
+  shows.
 - **The timings are guesses until worn** — six seconds awake, 1.5 s holds,
   three to send, ten to wait. They are named constants for that reason.
 - **Recording has run on Chrome's fake camera, not a phone's.** Headless
````

In `relay/band.js`:

````diff
--- a/relay/band.js
+++ b/relay/band.js
@@ -2,8 +2,9 @@
 //
 // The wristband is a light first and words second: from across a dark room it
 // is a colour, and only up close two short lines. It shows nothing about
-// anyone else except the meeting number, and only once both of you said yes.
-// No names, no photos, no picks but your own.
+// anyone else except the meeting number, once both of you said yes, and while
+// you show SAY HI, that someone waved at you and how many wait. Never who: no
+// names, no photos, no picks but your own.
 //
 // Pure: everything it needs is passed in, so every state can be tested
 // without a socket or a clock.
````

In `relay/room.js`:

````diff
--- a/relay/room.js
+++ b/relay/room.js
@@ -20,7 +20,8 @@
 // What each kind of yes shows the other side, before it is returned:
 //
 //   - A wave (SAY HI) is seen by the person waved at, as a blue dot on a row
-//     that is still only a band. That is what makes waving back possible.
+//     that is still only a band, and on their wristband as a short call and a
+//     count of who waits. That is what makes waving back possible.
 //   - A like (FIRST SONG?) is never shown. It was for an answer, not a face.
 //   - A dance back (LET'S DANCE!) is a clip sent straight to one person, so
 //     they see it — five seconds of someone dancing, with no name on it.
````

In `docs/superpowers/specs/2026-09-25-wrist-reactions-design.md`:

````diff
--- a/docs/superpowers/specs/2026-09-25-wrist-reactions-design.md
+++ b/docs/superpowers/specs/2026-09-25-wrist-reactions-design.md
@@ -64,7 +64,9 @@ None of it pretends:
 - each reaction answers something the wearer just did, or says one fact
   about the band: out of reach, battery, waiting, away, or unpaired;
 - the only reaction about another person is the meeting call, and the
-  meeting number is already on the band.
+  meeting number is already on the band. The waves spec
+  (`2026-09-25-wrist-waves-design.md`) adds a second: a wave's call, which
+  says that someone waved and never who.
 
 README's "Where this differs from the canvas, on purpose" gains this.
 
````

- [ ] **Step 2: Run** `node --test tests/copy.test.js`, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 346`.

- [ ] **Step 3: Commit, and close Stage D's writing with P2**

```bash
git add README.md relay/band.js relay/room.js docs/superpowers/specs/2026-09-25-wrist-reactions-design.md
```

````bash
git commit -F - <<'EOF'
Describe waves on the wristband, and the band's yes for its person

README: the wave row of what each yes shows, what a band on SAY HI is told,
the call, the wave face and the wave back, the canvas departure (a band now
says that someone waved, never who), the band's yes for its person under
Abuse resistance, and what is still untried on real bands. relay/band.js's
promise and relay/room.js's header say the same, and the reactions spec's
canvas note names the wave's call.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 11: The real bands, with the owner

Nothing here starts without the owner's yes: ask in Chinese before each flash. Two real people, no stand-in: his phone and his second phone or tablet, each paired to one of the StickS3 (`COM8`) and the StickC Plus (`COM9`), through the always-on relay `https://on-the-beat.fly.dev`; deploy the relay first (the owner logs in to Fly himself), unless he has said a demo is on.

- [ ] **Step 1: Deploy the relay**, when the owner agrees, and check that https://on-the-beat.fly.dev/ loads the app.
- [ ] **Step 2: Flash both bands** (P3's directories; `pio run -e m5sticks3 -t upload --upload-port COM8`, `pio run -e m5stickc -t upload --upload-port COM9`).
- [ ] **Step 3: With the owner:** both on SAY HI. A waves on the phone: B's band chirps `hello` and flashes blue three times, and its console says `the relay shows: hi (1 waiting)`. B presses FACE and sees `SOMEONE WAVED` whole on the screen, then holds SIDE: both bands show the same `MEET` at once and both phones the match. Then a third person, a browser tab, waves at B too, to see the count (`2 WAITING - HOLD SIDE`).
- [ ] **Step 4: Tune by ear** only what the owner asks for: `hello` is one line in each twin's table.
- [ ] **Step 5: Unpair every stand-in** from his real bands, and tell him in which state each band is left.
- [ ] **Step 6: Record it.** Replace "Waves on the wrist have been tried only in the tables and a browser" in the README's "What is not done" with what was seen and heard. Commit, push (P2).
