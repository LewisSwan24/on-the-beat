# The beat on the wristband — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a card is lit at rest on the wristband and the band hears a steady beat, the card's light is full on each beat and falls in a straight line to half over the first two thirds of it; in doubt the card stays steady. `BEAT: ON` on the phone switches it, on by default, and off, the band never opens its microphone. The stand-in `/band` can do the same from the laptop's microphone.

**Architecture:** The band's microphone is read in blocks of 128 samples at 16 kHz (8 ms). Each block becomes five band levels (`Levels` in `firmware/src/beat_logic.h`, `createLevels` in `app/lib/beat.js`) and is timed by a block clock that counts blocks and holds the count to `millis()` (`BlockClock`, `createBlockClock`). A tracker (`BeatTracker`, `createTracker`) turns the levels into onset strength, reads the tempo by autocorrelation every 128 ms, lays a grid where a steady reading stands out, keeps it with a phase-locked loop, and decides each pulse in the last block before it is due. Both files are pure twins, held equal to the bit by the host tests. The `Wrist` (`firmware/src/band_logic.h`, `app/lib/wrist.js`) says when to listen (`listening()`), takes each block (`hear()`), and in `face()` pulses the light of a lit card at rest. The relay carries each person's beat switch to their own band on its shows (`relay/band.js`, `relay/server.js`); the phone keeps it and shows `BEAT: ON` (`app/lib/bandbeat.js`, `app/lib/store.js`, `app/lib/net.js`, `app/App.jsx`). `main.cpp` opens the microphone while the wrist listens, hands the audio channel to the speaker for each sound, and feeds each block in; `/band`'s `LISTEN` does the same through Web Audio (`app/lib/listen.js`).

**Tech Stack:** Node 22+ (`node --test`, `ws`), React and Vite for the app, Web Audio (`AudioWorklet`) for the stand-in's microphone, C++17 on the laptop (MinGW-W64 g++ here, GCC in CI), C++11 on the band (Arduino-ESP32 2.0.17 through PlatformIO `espressif32@^6.9.0`), M5Unified 0.2.22 or later: its microphone's buffer release callback, and `record()` called from inside it, are both in 0.2.22 (built here against 0.2.23).

**Spec:** `docs/superpowers/specs/2026-09-26-wrist-beat-design.md` (decided with the owner section by section on 26 Sep 2026 after a throwaway spike on both real bands; §1 to §6 reviewed and approved by him on 27 Sep 2026, `BEAT: ON` by default included). It was amended on 27 Sep 2026 from this build: four of §2's rules changed on the evidence of made-up music and the spike's offline set, and the microphone's count is held to the band's clock. The spec's opening says each change and why, and marks each *(amended)*. It builds on the reactions spec (`2026-09-25-wrist-reactions-design.md`: the sound switch, NOT NOW's silence, the flashes) and the waves spec's call. Read the beat spec before any task.

This plan was written from a finished build: every task below was built in a scratch worktree on branch `beat-build`, test first, and committed on its own with `npm test` green at every commit. The code blocks are those commits' diffs, so applying a task's blocks in order reproduces it. Each Step 2 was measured by running the task's tests on its parent's code, and each mutation list was measured at its task's commit. **The owner chose that the build reaches `main` only once the gate passes (spec §4.1, Task 9).** Until then it lives on `beat-build`.

## Global Constraints

- Artefacts are English: code, comments, commit messages, README, test names. Talk to the owner in Chinese.
- **It hears loudness only** (spec §1, *Not in this spec*). Each 8 ms block becomes five levels on the band, and the band keeps only how far they rose, one number a block, for `BEAT_WINDOW_MS`. Nothing of the sound is recorded or sent; no frame carries a level, a tempo or a pulse. The relay carries only the switch, and only to its person's own band.
- **The pulse only ever makes a lit card easier to see** (spec, *Goal*). It never lights a face that is not lit, says nothing about anyone, and gives way to every reaction. Only a card lit at rest pulses: `hi`, `song` or `dance`, never the meeting number, the letters, the check, the test light, NOT NOW, a black face, a card shown by SIDE, or while a flash is on the face.
- **Not pulsing is better than pulsing off the beat.** In doubt the card stays steady.
- **The shape of a beat:** `pulseLight(full, since, period) = full − floor((full / 2) · min(1, since / (2·period/3)))`. A pulse lasts one period; after it the card is its steady light.
- **Constants**, the same in both twins (`BEAT_CONSTS` and the host binary's `beatconsts`): `BEAT_RATE` 16000, `BEAT_BLOCK` 128, `BEAT_BANDS_HZ` 150, 400, 1200, 3500 (second-order RBJ filters, Q 0.7071; the offset from zero taken out with `dc += 0.001 · (x − dc)`); `BEAT_ONSET` 2.5, `BEAT_ONSET_MIN` 6 dB, `BEAT_WINDOW_MS` 6000, `BEAT_LOOK_MS` 128, `BEAT_SHORTEST_MS` 336, `BEAT_LONGEST_MS` 752, `BEAT_PRIOR_MS` 500, `BEAT_PRIOR_OCT` 0.7, `BEAT_LOCK_CONF` 4, `BEAT_LOCK_CONTRAST` 4.5, `BEAT_LOCK_LOOKS` 6, `BEAT_STEADY` 0.02, `BEAT_PHASE_MS` 2000, `BEAT_NEAR` 0.12, `BEAT_RISE` 0.25, `BEAT_TIGHT_MS` 30, `BEAT_PULL_PHASE` 0.3, `BEAT_PULL_PERIOD` 0.05, `BEAT_CHANGE` 0.05, `BEAT_START` 4 of `BEAT_START_OF` 5, `BEAT_CONFIRM` 2 of `BEAT_OF` 3, `BEAT_HOLD` 4, `BEAT_OTHER_LOOKS` 8, `BEAT_LOSE_MS` 4000, `BEAT_CREEP` 0.125 ms a block, `BEAT_SETTLE` 16 blocks. `MIC_LATENCY_S3_MS` and `MIC_LATENCY_PDM_MS` (`main.cpp`) are 0 until the gate measures them.
- **Single precision where it counts:** the levels, the onset strength and the tempo's sums are `float` on the band and `Math.fround` in the stand-in; everything else is `double` and a JavaScript number. So the twins agree to the bit, and `tests/firmware.test.js` compares them exactly.
- **Frames:** the phone says `{ t: 'beat', on }`, `on` true or false, and anything else is dropped; the relay keeps it per person beside `sound`, forgets it on `leave` (not in the grace), and puts `beat` on the same shows as `sound` — the band's own card, the test light and away — never on the letters, the check or waiting. The band reads `beat` from a show when it is there, and the letters turn it back on. `SAID_ORDER` is `['sound', 'beat', 'pair', 'invisible', 'profile', 'pick', 'arm', 'leave']`.
- **Not in this plan** (spec): a signal from the venue, syncing bands through the relay, the phone listening, pulsing to loudness (the gate's fallback, its own change), and anything that records, stores or sends sound.
- **The band's compiler takes C++11** and sees `Arduino.h`'s macros first; `firmware/host/as_band.cpp` holds `band_logic.h` (and so `beat_logic.h`) to that on every run. A variable or parameter left unused is an error there (`-Werror`). Array sizes in a class are `enum` constants, not `static constexpr` members, which C++11 would need defined out of line.
- Repository `LewisSwan24/on-the-beat` (private). Commit after each task on `beat-build`; push the branch, never `main`, until Task 9. Never the team repository `cimi2232/DECO3500`: `tools/hooks/pre-push` refuses it (after a fresh clone, `cp tools/hooks/pre-push .git/hooks/pre-push`).
- `CLAUDE.md` is not in git and is not edited by this plan. Nothing from `../on-the-beat-research/` or `../on-the-beat-design/` enters the repository.
- `npm test` builds first (the relay serves `dist/`). Running one test file alone: `npm run build` first, and again after restoring a mutation.
- Windows host: the Bash tool is Git Bash, and the plan's scripts are Node. Never write JavaScript or Python holding backticks, quotes or `${}` through a Bash heredoc: write it with the editor. A command that holds `git commit` and another program's `-n` (such as `grep -n`) is refused by a hook as `--no-verify`: run them separately. A file the editor refuses to write because it was not read first already exists: read it, and never commit with a message file you have not just written.
- Flashing a band needs the owner's yes first, every time, and so does playing sound through the laptop. The StickS3 is on `COM8`, the StickC Plus on `COM9`. Stand-in personas paired to his bands are unpaired when a test ends, and each band's state is said.
- Never more than ten background tasks at once. Work directly; this plan needs no fan-out.
- Commit messages end with the attribution trailer the session's system reminder gives (today: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## Three procedures used throughout

**P1 — Mutation check.** Every task that adds a guard lists mutations as JSON: break one guard, run one test file, and exactly the listed tests go red (a listed name is a prefix of the test's). The lists were measured at each task's own commit; run later, a list may find more red as later tests join, and a mutation whose line a later task rewrote no longer applies.

Save this runner outside the repository (for example in your scratch directory as `mutate.mjs`) and run it from the repository root: `node <scratch>/mutate.mjs <scratch>/task-N.json`. It applies each edit (the `from` text must occur exactly once), runs the test file, restores the file byte for byte, runs the file again, and prints `ALL MUTATIONS HELD` only if every red set was exactly the listed one and every restore came back green. A C++ mutation runs `tests/firmware.test.js`, which compiles the host tests, about 40 s a run, twice: run long lists in the background. Never run two lists at once when one mutates a file the other's tests use, and no PlatformIO build runs while `beat_logic.h` or `band_logic.h` holds a mutant. A C++ mutation must keep every parameter in use: one left unused is a compile error under `-Werror`, and every test in the file goes red for the wrong reason.

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

If the wrong test goes red, or none does, stop: the test does not hold the guard. Fix the test, not the guard. If more tests go red than listed, read them: when each is a real consequence of the broken guard, the list was too narrow, and it is the list that changes. Put `Mutation-checked: <n> mutations, all held` in the task's commit body.

**P2 — Close a stage.** `npm test` (expect `ℹ fail 0`, `ℹ skipped 0`), then `git push origin beat-build`. Never push `main` from this plan before Task 9. A push that cannot reach github.com:443 while `gh` works is the network: check with `curl -sI https://github.com`, retry, leave git config alone. `npm test` here sometimes loses a whole file to a Node fatal error (exit `0xC0000409`, the file's tests missing from the count rather than failed): run it again.

**P3 — Build the band.** Windows' path limit breaks PlatformIO in a deep directory, so build with short output directories:

```bash
T=/c/Users/LEWISD~1/AppData/Local/Temp/otbpio
mkdir -p $T && [ -d $T/libdeps ] || cp -r firmware/.pio/libdeps $T/libdeps
PLATFORMIO_BUILD_DIR=$T/beatbuild PLATFORMIO_LIBDEPS_DIR=$T/libdeps \
  /c/Users/LewisDong/.platformio/penv/Scripts/pio.exe run -d firmware -e m5stickc -e m5sticks3 2>&1 \
  | grep -E "error|src/.*warning|RAM:|Flash:|SUCCESS|FAILED"
```

Expected: two `[SUCCESS]` lines and no `src/` warning.

## Files

Created:

| File | Responsibility |
|---|---|
| `firmware/src/beat_logic.h` | The band's half of the twins: `Levels`, `BeatTracker`, `pulseLight`, `BlockClock` and the named values |
| `app/lib/beat.js` | The stand-in's half: `createLevels`, `createTracker`, `pulseLight`, `createBlockClock`, `BEAT_CONSTS` |
| `app/lib/bandbeat.js` | The phone's words for the switch: `beatRow`, `BEAT_SAY`, `BEAT_HOW` |
| `app/lib/listen.js` | The stand-in's `LISTEN`: `toSamples`, `createEars`, `openMicrophone` |
| `tests/beat.test.js` | The levels, the tracker on made-up music, the pulse's shape and the block clock |
| `tests/beat-music.js` | Made-up music as five levels a block (`music`, `twoStep`), and a microphone's hand-overs (`handed`) |
| `tests/listen.test.js` | `LISTEN` against a fake browser |

Modified: `firmware/src/band_logic.h`, `firmware/src/main.cpp`, `firmware/host/logic_test.cpp`, `app/lib/wrist.js`, `app/lib/store.js`, `app/lib/net.js`, `app/App.jsx`, `app/screens/Band.jsx`, `relay/band.js`, `relay/server.js`, `tests/firmware.test.js`, `tests/wrist-table.js`, `tests/fixtures/wrist-cases.json`, `tests/band.test.js`, `tests/wristband.test.js`, `tests/store.test.js`, `tests/net.test.js`, `README.md`, `docs/superpowers/specs/2026-09-25-wrist-reactions-design.md`.

Not modified, on purpose: `relay/room.js` (no view carries anything of the beat, so the promises' code does not move), `firmware/platformio.ini` (M5Unified `^0.2.22` already has the microphone's callback).

## Stages

| Stage | Tasks | Leaves |
|---|---|---|
| A. The beat, in both twins | 1–3 | five levels a block; the tracker; a lit card at rest pulsing in `face()`, listening only when it could pulse; all on the laptop and held to the bit |
| B. The switch | 4–5 | the relay carrying each person's switch to their own band; the phone's `BEAT: ON` |
| C. The microphones | 6–7 | the block clock; `main.cpp` opening the microphone, taking turns with the speaker; the stand-in's `LISTEN` |
| D. Docs and the gate | 8–9 | README; round 3 on the real bands with the owner, and only then `main` |

Every task ends green and is committed on its own; each stage ends with P2.

---

## Stage A — The beat, in both twins

Run the stage's tests with `npm run build >/dev/null && node --test tests/beat.test.js tests/firmware.test.js tests/wrist.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`.

### Task 1: The microphone's samples become five levels a block, the same on the band and the stand-in

**Files:**
- Create: `firmware/src/beat_logic.h`, `app/lib/beat.js`, `tests/beat.test.js`
- Modify: `firmware/src/band_logic.h` (one include), `firmware/host/logic_test.cpp`
- Test: `tests/firmware.test.js`

**Interfaces:**
- Consumes: the host binary's verb table and `answer()` in `firmware/host/logic_test.cpp`; `speak()` and `skip` in `tests/firmware.test.js`.
- Produces: `BEAT_RATE` (16000), `BEAT_BLOCK` (128), `BEAT_BANDS_HZ` and `createLevels()` → `{ block(samples) }`, 128 whole 16-bit samples in, five levels out (the root mean square of each band in its block), throwing on any other length. In C++: `BEAT_RATE`, `BEAT_BLOCK`, `BEAT_BANDS` (5), `BEAT_EDGE_1..4`, `struct BandLevels { float v[BEAT_BANDS]; }`, `class BeatFilter`, `class Levels { BandLevels block(const int16_t*); }`. The host binary's `levels <s,s,...>` runs whole blocks through one `Levels` and prints each block's five.

- [ ] **Step 1: Write the failing tests.** Four in `tests/beat.test.js`: each band hears its own part of the spectrum (a tone in each band's middle reads loudest there); a level is the root mean square of its band in its block; silence is nothing, and a steady offset from zero is taken out; and the filters carry from one block to the next, so a steady tone reads steady and rings on once it stops. In `tests/firmware.test.js`, the firmware hears as the stand-in does: three tones, an offset and seeded noise, 60 blocks through both `Levels`, each level within 0.05% (the band's single precision against the stand-in's double; Task 2 makes the stand-in single precision too).

Create `tests/beat.test.js`:

````diff
new file mode 100644
--- /dev/null
+++ b/tests/beat.test.js
@@ -0,0 +1,49 @@
+// ON THE BEAT — the beat on the wristband (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §2):
+// what the microphone's samples become, and how the band follows the beat in them.
+
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import { BEAT_BLOCK, BEAT_RATE, createLevels } from '../app/lib/beat.js';
+
+/** `blocks` blocks of a sine at `hz` and amplitude `a`, as whole 16-bit samples, from sample `from`. */
+export function tone(hz, blocks, a = 8000, from = 0) {
+  return Array.from({ length: blocks * BEAT_BLOCK }, (_, i) => Math.round(a * Math.sin((2 * Math.PI * hz * (from + i)) / BEAT_RATE)));
+}
+
+/** Each block's five levels. */
+function levelsOf(samples) {
+  const lv = createLevels();
+  const out = [];
+  for (let i = 0; i + BEAT_BLOCK <= samples.length; i += BEAT_BLOCK) out.push(lv.block(samples.slice(i, i + BEAT_BLOCK)));
+  return out;
+}
+
+test('each of the five bands hears its own part of the spectrum', () => {
+  // Second-order filters overlap: a tone in the middle of a band is its loudest, by twice or more.
+  for (const [hz, band] of [[60, 0], [250, 1], [700, 2], [2000, 3], [6000, 4]]) {
+    const last = levelsOf(tone(hz, 40)).at(-1);
+    const others = last.filter((_, i) => i !== band);
+    assert.ok(others.every((v) => last[band] >= 2 * v), `${hz} Hz: ${last.map((v) => v.toFixed(0)).join(' ')}`);
+  }
+});
+
+test('a level is the root mean square of the band in its block', () => {
+  // A sine's RMS is its amplitude over the square root of two; a band-pass passes most of its middle.
+  const last = levelsOf(tone(700, 40, 8000)).at(-1);
+  assert.ok(Math.abs(last[2] - 8000 / Math.SQRT2) < 0.15 * (8000 / Math.SQRT2), String(last[2]));
+});
+
+test('silence is nothing, and a steady offset from zero is taken out', () => {
+  assert.deepEqual(levelsOf(new Array(10 * BEAT_BLOCK).fill(0)).at(-1), [0, 0, 0, 0, 0]);
+  const offset = levelsOf(new Array(200 * BEAT_BLOCK).fill(3000)).at(-1);
+  assert.ok(offset.every((v) => v < 1), offset.join(' '));
+});
+
+test('the filters carry from one block to the next: a steady tone reads steady, and rings on once it stops', () => {
+  // 125 Hz is one whole period a block, so once the filters settle every block reads the same.
+  const lv = levelsOf([...tone(125, 60), ...new Array(BEAT_BLOCK).fill(0)]);
+  for (let b = 40; b < 60; b++) for (let k = 0; k < 2; k++) assert.ok(Math.abs(lv[b][k] - lv[40][k]) <= 0.01 * lv[40][k], `block ${b} band ${k}`);
+  // Started afresh each block, the silent block after it would read nothing at all.
+  assert.ok(lv[60][0] > 0.1 * lv[59][0], `the block after: ${lv[60][0]} against ${lv[59][0]}`);
+  assert.throws(() => createLevels().block(new Array(BEAT_BLOCK - 1).fill(0)), /128/);
+});
````

In `firmware/host/logic_test.cpp`:

````diff
--- a/firmware/host/logic_test.cpp
+++ b/firmware/host/logic_test.cpp
@@ -832,6 +832,26 @@ std::string answer(const Command& c) {
     }
     return h.frame(ch);
   }
+  if (c.verb == "levels") {
+    // levels <s,s,...>: whole blocks of samples through one Levels, and each block's five levels
+    std::vector<int16_t> s;
+    std::istringstream in(c.arg);
+    std::string one;
+    while (std::getline(in, one, ',')) s.push_back(static_cast<int16_t>(std::atoi(one.c_str())));
+    Levels lv;
+    std::string out = "[";
+    for (size_t b = 0; b + BEAT_BLOCK <= s.size(); b += BEAT_BLOCK) {
+      const BandLevels l = lv.block(s.data() + b);
+      out += b ? ",[" : "[";
+      for (size_t k = 0; k < BEAT_BANDS; ++k) {
+        char n[32];
+        std::snprintf(n, sizeof n, "%s%.3f", k ? "," : "", static_cast<double>(l.v[k]));
+        out += n;
+      }
+      out += "]";
+    }
+    return out + "]";
+  }
   if (c.verb == "battery") return batteryFrame(std::atoi(c.arg.c_str()));
   if (c.verb == "hold") return HOLD_FRAME;
   if (c.verb == "ping") return PING_FRAME;
````

In `tests/firmware.test.js`:

````diff
--- a/tests/firmware.test.js
+++ b/tests/firmware.test.js
@@ -21,6 +21,7 @@ import { createRelay, WS_PATH } from '../relay/server.js';
 import { HUE } from '../app/copy.js';
 import { codeFrom, pairUrl } from '../app/lib/pairing.js';
 import { CONSTS, FLASH_COLOURS, FLASHES, SOUNDS } from '../app/lib/wrist.js';
+import { BEAT_BLOCK, BEAT_RATE, createLevels } from '../app/lib/beat.js';
 import { TABLE, lines, check } from './wrist-table.js';
 
 const idOf = (key) => createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex').slice(0, 32);
@@ -126,6 +127,23 @@ test("the flashes' red and orange are the stand-in's, and red is the phone's own
   assert.equal(FLASH_COLOURS.red, css.match(/--stop:\s*(#[0-9A-Fa-f]{6})/)[1].toUpperCase());
 });
 
+test('the firmware hears as the stand-in does: the same samples give the same five levels', { skip }, () => {
+  // Three tones, an offset and seeded noise, 60 blocks, through both twins' filters.
+  let seed = 7;
+  const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
+  const wave = (hz, a, i) => a * Math.sin((2 * Math.PI * hz * i) / BEAT_RATE);
+  const samples = Array.from({ length: 60 * BEAT_BLOCK }, (_, i) =>
+    Math.round(wave(90, 3000, i) + wave(900, 2000, i) + wave(5000, 1500, i) + 800 * noise() + 500));
+  const js = createLevels();
+  const want = [];
+  for (let b = 0; b < 60; b++) want.push(js.block(samples.slice(b * BEAT_BLOCK, (b + 1) * BEAT_BLOCK)));
+  const band = JSON.parse(speak(['levels ' + samples.join(',')])[0]);
+  assert.equal(band.length, 60);
+  // The band works in float and the stand-in in double: 0.003% apart at worst when measured, held to 0.05%.
+  band.forEach((row, b) => row.forEach((v, k) =>
+    assert.ok(Math.abs(v - want[b][k]) <= 0.0005 * want[b][k] + 0.002, `block ${b} band ${k}: ${v} against ${want[b][k]}`)));
+});
+
 test("the firmware hashes as node:crypto does, and its id is its key's hash", { skip }, () => {
   const inputs = ['', '616263', randomBytes(16).toString('hex'), randomBytes(55).toString('hex'), randomBytes(64).toString('hex'), randomBytes(200).toString('hex')];
   const got = speak(inputs.map((h) => 'sha256 ' + h));
````

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/beat.test.js 2>&1 | grep -E "^ℹ (tests|fail)|ERR_"` and `npm run build >/dev/null && node --test tests/firmware.test.js 2>&1 | grep -E "^ℹ (tests|fail)|error: " | head -5`

Expected: `tests/beat.test.js` does not load (`ERR_MODULE_NOT_FOUND` for `app/lib/beat.js`; `ℹ tests 1`, `ℹ fail 1`). With `app/lib/beat.js` in place and `beat_logic.h` not, the host tests do not compile, so every firmware test fails (`ℹ tests 108`, `ℹ fail 108`), first at `logic_test.cpp:841:5: error: 'Levels' was not declared in this scope`, then `'BEAT_BLOCK' was not declared` and `'BandLevels' does not name a type`.

- [ ] **Step 3: Implement.**

Create `app/lib/beat.js`:

````diff
new file mode 100644
--- /dev/null
+++ b/app/lib/beat.js
@@ -0,0 +1,61 @@
+// ON THE BEAT — the beat on the wristband (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §2).
+// What the microphone's samples become: five levels a block, which the band's
+// tracker follows. The band's twin is Levels in firmware/src/beat_logic.h, held
+// to this one on the same samples by tests/firmware.test.js.
+
+/** The microphone's rate, and the samples in one block: 8 ms of sound. */
+export const BEAT_RATE = 16000;
+export const BEAT_BLOCK = 128;
+
+/** Where the five bands meet: below 150 Hz, up to 400, 1200, 3500, and above. */
+export const BEAT_BANDS_HZ = [150, 400, 1200, 3500];
+
+/** A second-order low or high pass at `fc`, Q 0.7071 (the RBJ cookbook), carried from call to call. */
+function biquad(kind, fc) {
+  const w = (2 * Math.PI * fc) / BEAT_RATE;
+  const cw = Math.cos(w);
+  const al = Math.sin(w) / (2 * 0.7071);
+  const a0 = 1 + al;
+  const b = kind === 'low' ? [(1 - cw) / 2, 1 - cw, (1 - cw) / 2] : [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
+  const [b0, b1, b2, a1, a2] = [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * cw) / a0, (1 - al) / a0];
+  let z1 = 0;
+  let z2 = 0;
+  return (x) => {
+    const y = b0 * x + z1;
+    z1 = b1 * x - a1 * y + z2;
+    z2 = b2 * x - a2 * y;
+    return y;
+  };
+}
+
+/**
+ * Five levels a block: the root mean square of each band over its 128 samples,
+ * after a slow tracker has taken out any offset from zero. The filters carry
+ * from one block to the next, so a steady sound reads steady.
+ */
+export function createLevels() {
+  const [f150, f400, f1200, f3500] = BEAT_BANDS_HZ;
+  const lo150 = biquad('low', f150);
+  const hi150 = biquad('high', f150);
+  const lo400 = biquad('low', f400);
+  const hi400 = biquad('high', f400);
+  const lo1200 = biquad('low', f1200);
+  const hi1200 = biquad('high', f1200);
+  const lo3500 = biquad('low', f3500);
+  const hi3500 = biquad('high', f3500);
+  let dc = 0;
+  return {
+    /** One block of whole 16-bit samples in, its five levels out. */
+    block(samples) {
+      if (samples.length !== BEAT_BLOCK) throw new Error(`a block is ${BEAT_BLOCK} samples, not ${samples.length}`);
+      const sum = [0, 0, 0, 0, 0];
+      for (const x of samples) {
+        dc += 0.001 * (x - dc);
+        const y = x - dc;
+        const v = [lo150(y), lo400(hi150(y)), lo1200(hi400(y)), lo3500(hi1200(y)), hi3500(y)];
+        for (let k = 0; k < 5; k++) sum[k] += v[k] * v[k];
+      }
+      return sum.map((s) => Math.sqrt(s / BEAT_BLOCK));
+    },
+  };
+}
````

Create `firmware/src/beat_logic.h`:

````diff
new file mode 100644
--- /dev/null
+++ b/firmware/src/beat_logic.h
@@ -0,0 +1,91 @@
+// ON THE BEAT — the beat on the wristband, with no hardware in it
+// (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §2).
+//
+// What the microphone's samples become: five levels a block, which the band's
+// tracker follows. Its twin is app/lib/beat.js, which the stand-in at /band
+// runs; tests/firmware.test.js holds the two to each other on the same
+// samples. This side works in float, as the band's FPU does; the stand-in in
+// double, so they are held to within a small tolerance, not to the bit.
+//
+// band_logic.h includes this, so it builds as the band's compiler takes it
+// (C++11, after Arduino's macros) as well as on a laptop.
+
+#pragma once
+
+#include <cmath>
+#include <cstddef>
+#include <cstdint>
+
+namespace otb {
+
+constexpr uint32_t BEAT_RATE = 16000;         // the microphone's samples a second
+constexpr size_t BEAT_BLOCK = 128;            // samples in one block: 8 ms of sound
+constexpr size_t BEAT_BANDS = 5;              // below 150 Hz, up to 400, 1200, 3500, and above
+
+// Where the five bands meet, in Hz.
+constexpr float BEAT_EDGE_1 = 150;
+constexpr float BEAT_EDGE_2 = 400;
+constexpr float BEAT_EDGE_3 = 1200;
+constexpr float BEAT_EDGE_4 = 3500;
+
+// One block's five levels: the root mean square of each band.
+struct BandLevels {
+  float v[BEAT_BANDS];
+};
+
+// A second-order low or high pass, Q 0.7071 (the RBJ cookbook), carried from
+// sample to sample and so from block to block.
+class BeatFilter {
+ public:
+  BeatFilter(bool low, float fc) {
+    const float w = 6.28318530718f * fc / static_cast<float>(BEAT_RATE);
+    const float cw = std::cos(w);
+    const float al = std::sin(w) / (2 * 0.7071f);
+    const float a0 = 1 + al;
+    const float edge = low ? (1 - cw) / 2 : (1 + cw) / 2;
+    b0_ = edge / a0;
+    b1_ = (low ? 1 - cw : -(1 + cw)) / a0;
+    b2_ = edge / a0;
+    a1_ = -2 * cw / a0;
+    a2_ = (1 - al) / a0;
+  }
+  float step(float x) {
+    const float y = b0_ * x + z1_;
+    z1_ = b1_ * x - a1_ * y + z2_;
+    z2_ = b2_ * x - a2_ * y;
+    return y;
+  }
+
+ private:
+  float b0_ = 0, b1_ = 0, b2_ = 0, a1_ = 0, a2_ = 0;
+  float z1_ = 0, z2_ = 0;
+};
+
+// Five levels a block, after a slow tracker has taken out any offset from zero.
+class Levels {
+ public:
+  // One block of BEAT_BLOCK samples in, its five levels out.
+  BandLevels block(const int16_t* samples) {
+    float sum[BEAT_BANDS] = {0, 0, 0, 0, 0};
+    for (size_t i = 0; i < BEAT_BLOCK; ++i) {
+      const float x = samples[i];
+      dc_ += 0.001f * (x - dc_);
+      const float y = x - dc_;
+      const float v[BEAT_BANDS] = {lo150_.step(y), lo400_.step(hi150_.step(y)), lo1200_.step(hi400_.step(y)),
+                                   lo3500_.step(hi1200_.step(y)), hi3500_.step(y)};
+      for (size_t k = 0; k < BEAT_BANDS; ++k) sum[k] += v[k] * v[k];
+    }
+    BandLevels out;
+    for (size_t k = 0; k < BEAT_BANDS; ++k) out.v[k] = std::sqrt(sum[k] / BEAT_BLOCK);
+    return out;
+  }
+
+ private:
+  float dc_ = 0;
+  BeatFilter lo150_{true, BEAT_EDGE_1}, hi150_{false, BEAT_EDGE_1};
+  BeatFilter lo400_{true, BEAT_EDGE_2}, hi400_{false, BEAT_EDGE_2};
+  BeatFilter lo1200_{true, BEAT_EDGE_3}, hi1200_{false, BEAT_EDGE_3};
+  BeatFilter lo3500_{true, BEAT_EDGE_4}, hi3500_{false, BEAT_EDGE_4};
+};
+
+}  // namespace otb
````

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -26,6 +26,8 @@
 #include <string>
 #include <vector>
 
+#include "beat_logic.h"
+
 namespace otb {
 
 constexpr uint32_t WAKE_MS = 6000;            // a KEY1 press shows the face this long
````

- [ ] **Step 4: Run** — `tests/beat.test.js` (`ℹ pass 4`) and `tests/firmware.test.js` (`ℹ pass 108`), then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 422`. Single precision on the band against the stand-in's: the worst level measured 0.0032% apart.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "the offset from zero is left in",
  "file": "app/lib/beat.js",
  "from": "        dc += 0.001 * (x - dc);",
  "to": "        dc += 0 * (x - dc);",
  "test": "tests/beat.test.js",
  "expect": [
   "silence is nothing, and a steady offset from zero is taken out"
  ]
 },
 {
  "label": "a level is the band's power, not its root mean square",
  "file": "app/lib/beat.js",
  "from": "return sum.map((s) => Math.sqrt(s / BEAT_BLOCK));",
  "to": "return sum.map((s) => s / BEAT_BLOCK);",
  "test": "tests/beat.test.js",
  "expect": [
   "a level is the root mean square of the band in its block"
  ]
 },
 {
  "label": "a band hears past its own edge",
  "file": "app/lib/beat.js",
  "from": "const v = [lo150(y), lo400(hi150(y)),",
  "to": "const v = [lo150(y), lo1200(hi150(y)),",
  "test": "tests/beat.test.js",
  "expect": [
   "each of the five bands hears its own part of the spectrum"
  ]
 },
 {
  "label": "the filters start afresh every block",
  "file": "app/lib/beat.js",
  "from": "    /** One block of whole 16-bit samples in, its five levels out. */\n    block(samples) {",
  "to": "    block: (samples) => createLevels().once(samples),\n    once(samples) {",
  "test": "tests/beat.test.js",
  "expect": [
   "silence is nothing, and a steady offset from zero is taken out",
   "the filters carry from one block to the next"
  ]
 },
 {
  "label": "a short block is taken",
  "file": "app/lib/beat.js",
  "from": "if (samples.length !== BEAT_BLOCK) throw",
  "to": "if (samples.length > BEAT_BLOCK) throw",
  "test": "tests/beat.test.js",
  "expect": [
   "the filters carry from one block to the next"
  ]
 },
 {
  "label": "the band takes the offset out at another speed",
  "file": "firmware/src/beat_logic.h",
  "from": "      dc_ += 0.001f * (x - dc_);",
  "to": "      dc_ += 0.01f * (x - dc_);",
  "test": "tests/firmware.test.js",
  "expect": [
   "the firmware hears as the stand-in does"
  ]
 },
 {
  "label": "the band's second edge is not the stand-in's",
  "file": "firmware/src/beat_logic.h",
  "from": "constexpr float BEAT_EDGE_2 = 400;",
  "to": "constexpr float BEAT_EDGE_2 = 410;",
  "test": "tests/firmware.test.js",
  "expect": [
   "the firmware hears as the stand-in does"
  ]
 },
 {
  "label": "the band's filters are not Q 0.7071",
  "file": "firmware/src/beat_logic.h",
  "from": "const float al = std::sin(w) / (2 * 0.7071f);",
  "to": "const float al = std::sin(w) / (2 * 0.75f);",
  "test": "tests/firmware.test.js",
  "expect": [
   "the firmware hears as the stand-in does"
  ]
 },
 {
  "label": "the band's filters start afresh every block",
  "file": "firmware/src/beat_logic.h",
  "from": "    float sum[BEAT_BANDS] = {0, 0, 0, 0, 0};",
  "to": "    *this = Levels();\n    float sum[BEAT_BANDS] = {0, 0, 0, 0, 0};",
  "test": "tests/firmware.test.js",
  "expect": [
   "the firmware hears as the stand-in does"
  ]
 },
 {
  "label": "the band divides by one sample fewer",
  "file": "firmware/src/beat_logic.h",
  "from": "out.v[k] = std::sqrt(sum[k] / BEAT_BLOCK);",
  "to": "out.v[k] = std::sqrt(sum[k] / (BEAT_BLOCK - 1));",
  "test": "tests/firmware.test.js",
  "expect": [
   "the firmware hears as the stand-in does"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add app/lib/beat.js firmware/host/logic_test.cpp firmware/src/band_logic.h firmware/src/beat_logic.h tests/beat.test.js tests/firmware.test.js
```

````bash
git commit -F - <<'EOF'
The microphone's samples become five levels a block, the same on the band and the stand-in

A block is 128 samples at 16 kHz, 8 ms of sound. A slow tracker takes out
any offset from zero; second-order filters (Q 0.7071) split what is left at
150, 400, 1200 and 3500 Hz, a middle band a high-pass into a low-pass, and
each band's level is its root mean square over the block. The filters carry
from block to block, so a steady tone reads steady and rings on once it
stops. app/lib/beat.js works in double for the stand-in; beat_logic.h in
float, as the band's FPU does, included by band_logic.h so it builds as the
band's compiler takes it. On the same samples the two were 0.003% apart at
worst, and the twin test holds them to 0.05%.

Mutation-checked: 10 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 2: The band follows the beat in its five levels, and says where to pulse

**Files:**
- Modify: `app/lib/beat.js`, `firmware/src/beat_logic.h`, `firmware/host/logic_test.cpp`
- Create: `tests/beat-music.js`
- Test: `tests/beat.test.js`, `tests/firmware.test.js`

**Interfaces:**
- Consumes: Task 1's `BEAT_BLOCK`, `BEAT_RATE`, `createLevels`, `BandLevels` and `Levels`.
- Produces: every constant in Global Constraints but `BEAT_CREEP` and `BEAT_SETTLE`, and `BEAT_CONSTS` holding them by name. `createTracker()` → `{ hear(levels, now), reset(), setLatency(ms), take(), state() }`: `hear` takes one block's five levels and the time the block ended; `take()` drains the pulses decided since it was last asked, each `{ at, period }` in ms; `state()` → `{ locked, period }` (period 0 when not locked). In C++: `BEAT_BLOCK_MS`, `struct BeatPulse { double at, period; }`, `class BeatTracker { void hear(const BandLevels&, uint32_t); void reset(); void setLatency(double); std::vector<BeatPulse> take(); bool locked() const; double period() const; }`. The host binary's `beatconsts` prints every constant as JSON (`%.10g`); `track <latency> <t,b0,b1,b2,b3,b4> ...` runs the blocks through one `BeatTracker` and prints `{"pulses":[[at,period],...],"locked":..,"period":..}`. `tests/beat-music.js`: `music(parts, { from, seed })` → `{ blocks: [{ t, levels }], beats, missed }`, each part `{ ms, bpm, first, miss, extra, hat, level, pad, noise, talk, clicks, gap }`, levels rounded to hundredths so both twins get the same numbers; `twoStep({ bpm, ms, from })`, levels made by hand, a drum whose rise takes two blocks, its period whole blocks.

- [ ] **Step 1: Write the failing tests.** Fourteen in `tests/beat.test.js`, on made-up music: a steady kick at 90, 120 and 160 BPM pulses within 4 s, then on every kick within 0 to 10 ms after it; each pulse carries its grid's period; silence, steady noise and a held chord pulse nothing; random kicks and made-up speech seldom pulse (under one pulse a minute over 400 s of them: two densities of kicks, speech, and speech over a chord, five seeds each); a missed kick is carried by the clock; a drum near a beat but well off it neither counts nor pulls the grid; a drum is timed from where its rise began (`twoStep` at 125 BPM, within 2 ms); a song that stops dead is quiet within two beats; an off-beat hi-hat never moves the grid; a new song at another tempo takes over within 4 s with at most two pulses off its beat; a 600 ms gap for a reaction's sound does not stop the pulse; the microphone's delay puts the pulses that far ahead; `reset` forgets the beat; and a grid with nothing heard for `BEAT_LOSE_MS` is dropped. In `tests/firmware.test.js`, the two twins have the same named values, and the same blocks give the same pulses and the same end state, over ten cases: locks at two tempos, a hi-hat over a chord, another song, gaps of two and three beats (600 ms and 1104 ms), a late drum, a stop, a chance lock on random kicks, and `twoStep`.

Create `tests/beat-music.js`:

````diff
new file mode 100644
--- /dev/null
+++ b/tests/beat-music.js
@@ -0,0 +1,142 @@
+// ON THE BEAT — made-up music for the beat's tests, as the band's microphone hears it.
+//
+// A kick on the beat, a hi-hat between the beats, noise, talk and silence are
+// made as 16 kHz samples, turned into five levels a block by the stand-in's own
+// createLevels, and rounded to hundredths, so both twins can be handed exactly
+// the same numbers (tests/firmware.test.js, tests/wrist-table.js).
+
+import { BEAT_BLOCK, BEAT_RATE, createLevels } from '../app/lib/beat.js';
+
+const PER_MS = BEAT_RATE / 1000;
+const BLOCK_MS = BEAT_BLOCK / PER_MS;
+const KICK = 0.3 * BEAT_RATE; // samples a kick sounds for
+const HAT = 0.06 * BEAT_RATE;
+// A held A major chord and its octaves, each note's share of the pad.
+const PAD = [[220, 0.2], [277.18, 0.15], [329.63, 0.15], [440, 0.15], [554.37, 0.1], [659.26, 0.1], [880, 0.1], [1318.5, 0.05]];
+
+/**
+ * Levels made by hand, block by block: a quiet room, and on every beat at `bpm` (whole blocks apart) a drum whose rise
+ * takes two blocks,
+ * a click in the top band on the beat and its body in the two lowest one block later, as a kick's beater and skin.
+ * `beats` are the blocks each click rises in.
+ */
+export function twoStep({ bpm, ms, from = 0 }) {
+  const period = 60000 / bpm;
+  if (period % BLOCK_MS) throw new Error(`${bpm} BPM is not whole blocks`);
+  const blocks = [];
+  const beats = [];
+  let next = period;
+  for (let t = BLOCK_MS; t <= ms; t += BLOCK_MS) {
+    const levels = [20, 20, 20, 20, 20];
+    const since = t - next;
+    if (since >= 0 && since < BLOCK_MS) {
+      levels[4] = 200;
+      beats.push(from + t);
+    } else if (since >= BLOCK_MS && since < 12 * BLOCK_MS) {
+      const body = 2000 * Math.exp(-(since - BLOCK_MS) / 60);
+      levels[0] = 20 + body;
+      levels[1] = 20 + body / 2;
+      levels[4] = 20 + 180 * Math.exp(-since / 20);
+    }
+    if (since >= 12 * BLOCK_MS) next += period;
+    blocks.push({ t: from + t, levels: levels.map((v) => Math.round(v * 100) / 100) });
+  }
+  return { blocks, beats };
+}
+
+/**
+ * Parts played one after another, each for `ms` (whole blocks):
+ * - `bpm`: a kick on every beat, the first `first` ms into the part (0 by default); `miss` lists beats left out, by
+ *   their number in the part;
+ * - `hat`: a hi-hat halfway between the kicks;
+ * - `extra`: kicks at these times, in ms into the part, beside any on the beat;
+ * - `clicks`: kicks at random, this many a second on average, never two within 100 ms;
+ * - `level`: the kick's and the hat's loudness, 1 by default;
+ * - `pad`: a held chord throughout, at this amplitude, as a song's bed;
+ * - `noise`: white noise throughout, at this amplitude;
+ * - `talk`: speech: syllables at uneven times, in phrases with pauses between;
+ * - `gap`: the microphone is closed: no blocks at all, while the clock runs on.
+ * A block's time is when it ends, from `from`. `beats` are when each kick played starts; `missed`, when each beat
+ * left out would have.
+ */
+export function music(parts, { from = 0, seed = 1 } = {}) {
+  let s = seed;
+  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
+  const levels = createLevels();
+  const blocks = [];
+  const beats = [];
+  const missed = [];
+  const block = new Array(BEAT_BLOCK);
+  const kicks = []; // [first sample, loudness], in order
+  const hats = [];
+  let k0 = 0;
+  let h0 = 0;
+  let n = 0; // samples made so far
+  let before = 0; // the last sample's white noise, for the hat's high-pass
+  for (const p of parts) {
+    if (p.ms % BLOCK_MS) throw new Error(`a part is whole blocks: ${p.ms} ms`);
+    const start = n;
+    const end = n + p.ms * PER_MS;
+    for (const ms of p.extra ?? []) kicks.push([start + Math.round(ms * PER_MS), p.level ?? 1]);
+    if (p.clicks) {
+      for (let at = start - Math.log((rnd() + 1) / 2 || 1e-9) / p.clicks * BEAT_RATE; at < end; ) {
+        kicks.push([Math.round(at), p.level ?? 1]);
+        at += 0.1 * BEAT_RATE - Math.log((rnd() + 1) / 2 || 1e-9) / p.clicks * BEAT_RATE;
+      }
+    }
+    if (p.bpm) {
+      const period = 60000 / p.bpm;
+      for (let k = 0; (p.first ?? 0) + k * period < p.ms; k++) {
+        const at = start + Math.round(((p.first ?? 0) + k * period) * PER_MS);
+        if (p.miss?.includes(k)) { missed.push(from + at / PER_MS); continue; }
+        kicks.push([at, p.level ?? 1]);
+        beats.push(from + at / PER_MS);
+        if (p.hat) hats.push([at + Math.round((period / 2) * PER_MS), p.level ?? 1]);
+      }
+    }
+    kicks.sort((a, b) => a[0] - b[0]);
+    let syllable = null; // { start, end, hz, a }
+    let nextSyllable = start;
+    let left = 0; // syllables left in the phrase
+    for (; n < end; n++) {
+      let x = 0;
+      while (k0 < kicks.length && n - kicks[k0][0] > KICK) k0++;
+      for (let i = k0; i < kicks.length && kicks[i][0] <= n; i++) {
+        const dt = (n - kicks[i][0]) / BEAT_RATE;
+        x += 12000 * kicks[i][1] * Math.exp(-dt / 0.08) * Math.sin(2 * Math.PI * (50 * dt + 2 * (1 - Math.exp(-dt / 0.02))));
+      }
+      const white = rnd();
+      while (h0 < hats.length && n - hats[h0][0] > HAT) h0++;
+      for (let i = h0; i < hats.length && hats[i][0] <= n; i++) {
+        const dt = (n - hats[i][0]) / BEAT_RATE;
+        x += 3000 * hats[i][1] * Math.exp(-dt / 0.012) * (white - before);
+      }
+      before = white;
+      if (p.noise) x += p.noise * rnd();
+      if (p.pad) {
+        for (const [hz, a] of PAD) x += p.pad * a * Math.sin((2 * Math.PI * hz * n) / BEAT_RATE);
+      }
+      if (p.talk) {
+        if (n >= nextSyllable) {
+          if (left <= 0) left = 3 + Math.floor(3.5 * (rnd() + 1));
+          const len = Math.round((70 + 65 * (rnd() + 1)) * PER_MS);
+          syllable = { start: n, end: n + len, hz: 110 + 55 * (rnd() + 1), a: 5000 + 2000 * rnd() };
+          left -= 1;
+          const after = left > 0 ? 20 + 50 * (rnd() + 1) : 300 + 350 * (rnd() + 1);
+          nextSyllable = n + len + Math.round(after * PER_MS);
+        }
+        if (n < syllable.end) {
+          const u = (n - syllable.start) / (syllable.end - syllable.start);
+          const w = (2 * Math.PI * syllable.hz * (n - syllable.start)) / BEAT_RATE;
+          x += syllable.a * Math.sin(Math.PI * u) * (Math.sin(w) + 0.5 * Math.sin(2 * w) + 0.25 * Math.sin(3 * w));
+        }
+      }
+      if (p.gap) continue;
+      block[n % BEAT_BLOCK] = Math.max(-32768, Math.min(32767, Math.round(x)));
+      if (n % BEAT_BLOCK === BEAT_BLOCK - 1) {
+        blocks.push({ t: from + (n + 1) / PER_MS, levels: levels.block(block).map((v) => Math.round(v * 100) / 100) });
+      }
+    }
+  }
+  return { blocks, beats, missed };
+}
````

In `tests/beat.test.js`:

````diff
--- a/tests/beat.test.js
+++ b/tests/beat.test.js
@@ -3,7 +3,8 @@
 
 import { test } from 'node:test';
 import assert from 'node:assert/strict';
-import { BEAT_BLOCK, BEAT_RATE, createLevels } from '../app/lib/beat.js';
+import { BEAT_BLOCK, BEAT_LOSE_MS, BEAT_RATE, createLevels, createTracker } from '../app/lib/beat.js';
+import { music, twoStep } from './beat-music.js';
 
 /** `blocks` blocks of a sine at `hz` and amplitude `a`, as whole 16-bit samples, from sample `from`. */
 export function tone(hz, blocks, a = 8000, from = 0) {
@@ -47,3 +48,147 @@ test('the filters carry from one block to the next: a steady tone reads steady,
   assert.ok(lv[60][0] > 0.1 * lv[59][0], `the block after: ${lv[60][0]} against ${lv[59][0]}`);
   assert.throws(() => createLevels().block(new Array(BEAT_BLOCK - 1).fill(0)), /128/);
 });
+
+/** Made-up music through a tracker: every pulse it decides, with the kicks the music played. */
+function follow(parts, { latency = 0, seed = 1, tracker = createTracker() } = {}) {
+  const m = music(parts, { seed });
+  tracker.setLatency(latency);
+  const pulses = [];
+  for (const b of m.blocks) {
+    tracker.hear(b.levels, b.t);
+    pulses.push(...tracker.take());
+  }
+  return { ...m, pulses, at: pulses.map((p) => p.at) };
+}
+const nearest = (list, t) => list.reduce((a, x) => (Math.abs(x - t) < Math.abs(a - t) ? x : a), Infinity);
+const onKicks = (at, kicks, ms) => at.every((p) => Math.abs(nearest(kicks, p) - p) <= ms);
+
+test('a steady kick at 90, 120 and 160 BPM pulses within 4 s, and then on every kick, a few ms after it', () => {
+  for (const bpm of [90, 120, 160]) {
+    const r = follow([{ ms: 12000, bpm, noise: 200 }]);
+    assert.ok(r.at.length && r.at[0] - r.beats[0] <= 4000, `${bpm} BPM: first pulse at ${r.at[0]}`);
+    for (const b of r.beats.filter((k) => k >= r.at[0] - 20)) {
+      const e = nearest(r.at, b) - b;
+      assert.ok(e >= 0 && e <= 10, `${bpm} BPM: the kick at ${b} pulsed ${e} ms after it`);
+    }
+    // Every pulse is on a kick, but the one carried past the music's end.
+    assert.ok(onKicks(r.at.filter((p) => p < 12000), r.beats, 10), `${bpm} BPM: ${r.at.join(' ')}`);
+  }
+});
+
+test('a pulse carries the period of the grid it was laid on', () => {
+  for (const bpm of [90, 120, 160]) {
+    const r = follow([{ ms: 12000, bpm, noise: 200 }]);
+    assert.ok(r.pulses.every((p) => Math.abs(p.period - 60000 / bpm) <= 0.01 * (60000 / bpm)), `${bpm} BPM`);
+  }
+});
+
+test('silence, steady noise and a held chord pulse nothing', () => {
+  for (const part of [{ ms: 15000 }, { ms: 15000, noise: 2000 }, { ms: 15000, pad: 3000, noise: 300 }]) {
+    assert.deepEqual(follow([part]).at, [], JSON.stringify(part));
+  }
+});
+
+test('kicks at random and made-up speech seldom pulse: under one pulse a minute', () => {
+  // Chance onsets can line up for a few beats; four of five beats heard, five deep, keeps it rare (README).
+  let pulses = 0;
+  for (const part of [{ clicks: 2, noise: 200 }, { clicks: 4, noise: 200 }, { talk: true, noise: 200 }, { talk: true, pad: 2000, noise: 300 }]) {
+    for (let seed = 1; seed <= 5; seed++) pulses += follow([{ ms: 20000, ...part }], { seed }).at.length;
+  }
+  assert.ok(pulses < 400 / 60, `${pulses} pulses in 400 s`);
+});
+
+test('a missed kick is carried by the clock: its beat pulses anyway, and so does the next', () => {
+  const r = follow([{ ms: 12000, bpm: 120, miss: [16], noise: 200 }]);
+  const [gone] = r.missed;
+  assert.ok(Math.abs(nearest(r.at, gone) - gone) <= 10, `nothing near the missing kick at ${gone}`);
+  assert.ok(Math.abs(nearest(r.at, gone + 500) - (gone + 500)) <= 10, 'nothing on the kick after it');
+});
+
+test('a drum near a beat but well off it neither counts as the beat nor pulls the grid', () => {
+  // The kick at 8000 comes 45 ms late: inside the beat's window, but not within BEAT_TIGHT_MS of it.
+  const r = follow([{ ms: 12000, bpm: 120, miss: [16], extra: [8045], noise: 200 }]);
+  const kicks = r.beats.filter((b) => b !== 8045);
+  assert.ok(Math.abs(nearest(r.at, 8000) - 8000) <= 10, 'the beat is carried where it was');
+  for (const b of kicks.filter((k) => k > 8000)) {
+    const e = nearest(r.at, b) - b;
+    assert.ok(e >= 0 && e <= 10, `the kick at ${b} pulsed ${e} ms after it`);
+  }
+});
+
+test('a drum is timed from where its rise began, not from its peak', () => {
+  // The click rises in one block and the drum's body, the bigger rise, in the next: the beat is the click's block.
+  const { blocks, beats } = twoStep({ bpm: 125, ms: 12000 });
+  const tracker = createTracker();
+  const at = [];
+  for (const b of blocks) {
+    tracker.hear(b.levels, b.t);
+    at.push(...tracker.take().map((p) => p.at));
+  }
+  assert.ok(at.length > 10, `${at.length} pulses`);
+  for (const p of at.slice(4)) assert.ok(Math.abs(nearest(beats, p) - p) <= 2, `a pulse at ${p}`);
+});
+
+test('a song that stops dead is quiet within two beats', () => {
+  const r = follow([{ ms: 10000, bpm: 120, noise: 200 }, { ms: 4000, noise: 200 }]);
+  const after = r.at.filter((p) => p >= 10000 - 20);
+  assert.ok(after.length <= 2 && after.every((p) => p < 11000), after.join(' '));
+});
+
+test('an off-beat hi-hat never moves the grid', () => {
+  const r = follow([{ ms: 8000, bpm: 120, pad: 3000, noise: 800 }, { ms: 8000, bpm: 120, hat: true, pad: 3000, noise: 800 }]);
+  const late = r.at.filter((p) => p > 8000 && p < 16000);
+  assert.equal(late.length, 16);
+  assert.ok(onKicks(late, r.beats, 10), late.join(' '));
+});
+
+test('a new song at another tempo takes over within 4 s, with at most two pulses off its beat', () => {
+  const r = follow([{ ms: 10000, bpm: 120, noise: 200 }, { ms: 10000, bpm: 150, noise: 200 }]);
+  const kicks = r.beats.filter((b) => b >= 10000);
+  const after = r.at.filter((p) => p >= 10000 - 20);
+  assert.ok(after.filter((p) => !onKicks([p], kicks, 40)).length <= 2, after.join(' '));
+  const on = (b) => Math.abs(nearest(after, b) - b) <= 40;
+  const back = kicks.findIndex((b, i) => i > 0 && on(b) && on(kicks[i + 1]) && on(kicks[i + 2]));
+  assert.ok(back > 0 && kicks[back] - 10000 <= 4000, `back on the beat at ${kicks[back]}`);
+});
+
+test("a gap in listening for a reaction's sound does not stop the pulse", () => {
+  // The kicks play on through 600 ms the microphone does not hear; the clock runs on.
+  const r = follow([{ ms: 10000, bpm: 120, noise: 200 }, { ms: 600, bpm: 120, gap: true }, { ms: 6000, bpm: 120, first: 400, noise: 200 }]);
+  for (const b of r.beats.filter((k) => k >= 10600)) assert.ok(Math.abs(nearest(r.at, b) - b) <= 10, `the kick at ${b}`);
+});
+
+test("the pulses come out the microphone's delay ahead of the beat", () => {
+  const parts = [{ ms: 12000, bpm: 120, noise: 200 }];
+  const early = follow(parts, { latency: 40 }).at;
+  const plain = follow(parts).at;
+  assert.equal(early.length, plain.length);
+  early.forEach((p, i) => assert.ok(Math.abs(p - (plain[i] - 40)) < 1e-6, `pulse ${i}: ${p} against ${plain[i]}`));
+});
+
+test('reset forgets the beat: it must be found again from nothing', () => {
+  const tracker = createTracker();
+  const m = music([{ ms: 16000, bpm: 120, noise: 200 }]);
+  const at = [];
+  for (const b of m.blocks) {
+    if (b.t === 8000) tracker.reset();
+    tracker.hear(b.levels, b.t);
+    at.push(...tracker.take().map((p) => p.at));
+  }
+  assert.ok(at.some((p) => p < 8000), 'it pulsed before');
+  assert.ok(!at.some((p) => p >= 8000 && p < 10000), at.join(' '));
+  assert.ok(at.some((p) => p >= 10000 && p < 12000), 'and found it again');
+});
+
+test('a grid with nothing heard for BEAT_LOSE_MS is dropped', () => {
+  const tracker = createTracker();
+  const m = music([{ ms: 10000, bpm: 120, noise: 200 }, { ms: 6000, noise: 200 }]);
+  const last = m.beats.at(-1);
+  for (const b of m.blocks) {
+    tracker.hear(b.levels, b.t);
+    if (b.t === 10000) assert.equal(tracker.state().locked, true, 'locked on the song');
+    if (b.t === Math.floor((last + BEAT_LOSE_MS) / 8) * 8) assert.equal(tracker.state().locked, true, `at ${b.t}`);
+    if (b.t === Math.ceil((last + BEAT_LOSE_MS) / 8) * 8 + 16) assert.equal(tracker.state().locked, false, `at ${b.t}`);
+  }
+  assert.deepEqual(tracker.state(), { locked: false, period: 0 });
+});
````

In `firmware/host/logic_test.cpp`:

````diff
--- a/firmware/host/logic_test.cpp
+++ b/firmware/host/logic_test.cpp
@@ -852,6 +852,56 @@ std::string answer(const Command& c) {
     }
     return out + "]";
   }
+  if (c.verb == "beatconsts") {
+    // Every named value of the tracker, as app/lib/beat.js BEAT_CONSTS has them.
+    const std::pair<const char*, double> all[] = {
+        {"BEAT_ONSET", BEAT_ONSET}, {"BEAT_ONSET_MIN", BEAT_ONSET_MIN}, {"BEAT_WINDOW_MS", BEAT_WINDOW_MS},
+        {"BEAT_LOOK_MS", BEAT_LOOK_MS}, {"BEAT_SHORTEST_MS", BEAT_SHORTEST_MS}, {"BEAT_LONGEST_MS", BEAT_LONGEST_MS},
+        {"BEAT_PRIOR_MS", BEAT_PRIOR_MS}, {"BEAT_PRIOR_OCT", BEAT_PRIOR_OCT}, {"BEAT_LOCK_CONF", BEAT_LOCK_CONF},
+        {"BEAT_LOCK_CONTRAST", BEAT_LOCK_CONTRAST}, {"BEAT_LOCK_LOOKS", BEAT_LOCK_LOOKS}, {"BEAT_STEADY", BEAT_STEADY},
+        {"BEAT_PHASE_MS", BEAT_PHASE_MS}, {"BEAT_NEAR", BEAT_NEAR}, {"BEAT_RISE", BEAT_RISE},
+        {"BEAT_TIGHT_MS", BEAT_TIGHT_MS}, {"BEAT_PULL_PHASE", BEAT_PULL_PHASE}, {"BEAT_PULL_PERIOD", BEAT_PULL_PERIOD},
+        {"BEAT_CHANGE", BEAT_CHANGE}, {"BEAT_START", BEAT_START}, {"BEAT_START_OF", BEAT_START_OF},
+        {"BEAT_CONFIRM", BEAT_CONFIRM}, {"BEAT_OF", BEAT_OF}, {"BEAT_HOLD", BEAT_HOLD},
+        {"BEAT_OTHER_LOOKS", BEAT_OTHER_LOOKS}, {"BEAT_LOSE_MS", BEAT_LOSE_MS}};
+    std::string out = "{";
+    for (const auto& kv : all) {
+      char n[64];
+      std::snprintf(n, sizeof n, "%s\"%s\":%.10g", out.size() > 1 ? "," : "", kv.first, kv.second);
+      out += n;
+    }
+    return out + "}";
+  }
+  if (c.verb == "track") {
+    // track <latency> <t,b0,b1,b2,b3,b4> ...: the blocks through one BeatTracker, every pulse it decided, and
+    // where it was left: {"pulses":[[at,period],...],"locked":..,"period":..}
+    std::istringstream in(c.arg);
+    double latency = 0;
+    in >> latency;
+    BeatTracker tracker;
+    tracker.setLatency(latency);
+    std::string block, out = "{\"pulses\":[";
+    while (in >> block) {
+      std::istringstream fields(block);
+      std::string one;
+      std::getline(fields, one, ',');
+      const uint32_t t = static_cast<uint32_t>(std::strtoul(one.c_str(), nullptr, 10));
+      BandLevels levels;
+      for (size_t k = 0; k < BEAT_BANDS; ++k) {
+        std::getline(fields, one, ',');
+        levels.v[k] = static_cast<float>(std::strtod(one.c_str(), nullptr));
+      }
+      tracker.hear(levels, t);
+      for (const BeatPulse& p : tracker.take()) {
+        char n[64];
+        std::snprintf(n, sizeof n, "%s[%.3f,%.3f]", out.back() == '[' ? "" : ",", p.at, p.period);
+        out += n;
+      }
+    }
+    char end[64];
+    std::snprintf(end, sizeof end, "],\"locked\":%s,\"period\":%.3f}", tracker.locked() ? "true" : "false", tracker.period());
+    return out + end;
+  }
   if (c.verb == "battery") return batteryFrame(std::atoi(c.arg.c_str()));
   if (c.verb == "hold") return HOLD_FRAME;
   if (c.verb == "ping") return PING_FRAME;
````

In `tests/firmware.test.js`:

````diff
--- a/tests/firmware.test.js
+++ b/tests/firmware.test.js
@@ -21,7 +21,8 @@ import { createRelay, WS_PATH } from '../relay/server.js';
 import { HUE } from '../app/copy.js';
 import { codeFrom, pairUrl } from '../app/lib/pairing.js';
 import { CONSTS, FLASH_COLOURS, FLASHES, SOUNDS } from '../app/lib/wrist.js';
-import { BEAT_BLOCK, BEAT_RATE, createLevels } from '../app/lib/beat.js';
+import { BEAT_BLOCK, BEAT_CONSTS, BEAT_RATE, createLevels, createTracker } from '../app/lib/beat.js';
+import { music, twoStep } from './beat-music.js';
 import { TABLE, lines, check } from './wrist-table.js';
 
 const idOf = (key) => createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex').slice(0, 32);
@@ -144,6 +145,48 @@ test('the firmware hears as the stand-in does: the same samples give the same fi
     assert.ok(Math.abs(v - want[b][k]) <= 0.0005 * want[b][k] + 0.002, `block ${b} band ${k}: ${v} against ${want[b][k]}`)));
 });
 
+test('the firmware follows the beat by the same named values as the stand-in', { skip }, () => {
+  const [consts] = speak(['beatconsts']);
+  assert.deepEqual(JSON.parse(consts), BEAT_CONSTS);
+});
+
+test('the firmware follows the beat as the stand-in does: the same blocks give the same pulses', { skip }, () => {
+  // Locks at two tempos, a hi-hat, another song, gaps of two and three beats, a late drum, a stop, and a chance
+  // lock on random kicks: every decision.
+  const cases = [
+    [[{ ms: 12000, bpm: 90, noise: 200 }], 0, 1],
+    [[{ ms: 12000, bpm: 160, noise: 200 }], 25, 1],
+    [[{ ms: 8000, bpm: 120, pad: 3000, noise: 800 }, { ms: 8000, bpm: 120, hat: true, pad: 3000, noise: 800 }], 0, 1],
+    [[{ ms: 10000, bpm: 120, noise: 200 }, { ms: 10000, bpm: 150, noise: 200 }], 0, 1],
+    [[{ ms: 10000, bpm: 120, noise: 200 }, { ms: 600, bpm: 120, gap: true }, { ms: 6000, bpm: 120, first: 400, noise: 200 }], 0, 1],
+    [[{ ms: 10000, bpm: 120, noise: 200 }, { ms: 1104, bpm: 120, gap: true }, { ms: 6000, bpm: 120, first: 396, noise: 200 }], 0, 1],
+    [[{ ms: 12000, bpm: 120, miss: [16], extra: [8045], noise: 200 }], 0, 1],
+    [[{ ms: 10000, bpm: 120, noise: 200 }, { ms: 6000, noise: 200 }], 0, 1],
+    [[{ ms: 20000, clicks: 4, noise: 200 }], 0, 12],
+    ['twoStep', 0, 0],
+  ];
+  for (const [parts, latency, seed] of cases) {
+    const { blocks } = parts === 'twoStep' ? twoStep({ bpm: 125, ms: 12000 }) : music(parts, { seed });
+    const tracker = createTracker();
+    tracker.setLatency(latency);
+    const want = [];
+    for (const b of blocks) {
+      tracker.hear(b.levels, b.t);
+      want.push(...tracker.take());
+    }
+    assert.ok(want.length > 0, JSON.stringify(parts));
+    const line = `track ${latency} ` + blocks.map((b) => [b.t, ...b.levels].join(',')).join(' ');
+    const band = JSON.parse(speak([line])[0]);
+    assert.equal(band.pulses.length, want.length, `${JSON.stringify(parts)}: ${band.pulses.map((p) => p[0]).join(' ')}`);
+    band.pulses.forEach(([at, period], i) => {
+      assert.ok(Math.abs(at - want[i].at) < 0.01 && Math.abs(period - want[i].period) < 0.01,
+        `${JSON.stringify(parts)} pulse ${i}: ${at} ${period} against ${want[i].at} ${want[i].period}`);
+    });
+    const left = tracker.state();
+    assert.ok(band.locked === left.locked && Math.abs(band.period - left.period) < 0.01, `${JSON.stringify(parts)}: left ${JSON.stringify(band)}`);
+  }
+});
+
 test("the firmware hashes as node:crypto does, and its id is its key's hash", { skip }, () => {
   const inputs = ['', '616263', randomBytes(16).toString('hex'), randomBytes(55).toString('hex'), randomBytes(64).toString('hex'), randomBytes(200).toString('hex')];
   const got = speak(inputs.map((h) => 'sha256 ' + h));
````

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/beat.test.js 2>&1 | grep -E "^ℹ (tests|fail)|SyntaxError"` and `node --test tests/firmware.test.js 2>&1 | grep -E "^ℹ (tests|fail)|SyntaxError"`

Expected: neither file loads: `SyntaxError: The requested module '../app/lib/beat.js' does not provide an export named 'BEAT_LOSE_MS'` (beat) and `... named 'BEAT_CONSTS'` (firmware), each `ℹ tests 1`, `ℹ fail 1`.

- [ ] **Step 3: Implement.** The spike's tracker (its sixth version), under the spec's named values, and four changes the spec's amendment gives the reasons for: a new grid pulses once four of its last five beats were heard, looking back five from where it was laid; the fold carries a grid only while something within `BEAT_NEAR` of its last counted beat rose as far as a heard beat must; blocks more than a block and a half apart make the beats they span deaf, neither heard nor missed; and each pulse is decided once `next − latency <= now + BLOCK_MS`, once per beat. The levels, the onset strength and the autocorrelation's sums are single precision in both.

In `app/lib/beat.js`:

````diff
--- a/app/lib/beat.js
+++ b/app/lib/beat.js
@@ -1,7 +1,8 @@
 // ON THE BEAT — the beat on the wristband (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §2).
-// What the microphone's samples become: five levels a block, which the band's
-// tracker follows. The band's twin is Levels in firmware/src/beat_logic.h, held
-// to this one on the same samples by tests/firmware.test.js.
+// What the microphone's samples become, five levels a block, and the tracker
+// that follows the beat in them and says where to pulse. The band's twins are
+// Levels and BeatTracker in firmware/src/beat_logic.h, held to these by
+// tests/firmware.test.js on the same samples and the same blocks.
 
 /** The microphone's rate, and the samples in one block: 8 ms of sound. */
 export const BEAT_RATE = 16000;
@@ -59,3 +60,299 @@ export function createLevels() {
     },
   };
 }
+
+// The tracker's named values (§2's table), all a guess until worn. beat_logic.h has the same, held equal.
+export const BEAT_ONSET = 2.5;            // a heard beat's rise, against the window's mean onset strength...
+export const BEAT_ONSET_MIN = 6;          // ...and never below this, in dB
+export const BEAT_WINDOW_MS = 6000;       // the onset strength the tempo is read from
+export const BEAT_LOOK_MS = 128;          // how often the tempo is read
+export const BEAT_SHORTEST_MS = 336;      // the periods read: 178 BPM...
+export const BEAT_LONGEST_MS = 752;       // ...to 80
+export const BEAT_PRIOR_MS = 500;         // the tempo a listener would tap...
+export const BEAT_PRIOR_OCT = 0.7;        // ...and how firmly, in octaves
+export const BEAT_LOCK_CONF = 4;          // how far the best period must stand out, in standard deviations
+export const BEAT_LOCK_CONTRAST = 4.5;    // how far the beat must stand out of its own period
+export const BEAT_LOCK_LOOKS = 6;         // looks in a row with the same period...
+export const BEAT_STEADY = 0.02;          // ...within this much of it
+export const BEAT_PHASE_MS = 2000;        // the stretch folded to place the grid
+export const BEAT_NEAR = 0.12;            // of a period, either side of a beat
+export const BEAT_RISE = 0.25;            // a rise is traced back while it is at least this much of its peak
+export const BEAT_TIGHT_MS = 30;          // how near its beat a drum must start for the beat to be heard
+export const BEAT_PULL_PHASE = 0.3;       // how far a heard beat pulls the next beat...
+export const BEAT_PULL_PERIOD = 0.05;     // ...and the period
+export const BEAT_CHANGE = 0.05;          // the most the period moves from its lock; more is another song
+export const BEAT_START = 4;              // a new grid pulses once this many...
+export const BEAT_START_OF = 5;           // ...of the last this many were heard, looking back from where it was laid...
+export const BEAT_CONFIRM = 2;            // ...and keeps pulsing while this many...
+export const BEAT_OF = 3;                 // ...of the last this many were
+export const BEAT_HOLD = 4;               // or one was, with the fold on the grid peaking this far above its mean
+export const BEAT_OTHER_LOOKS = 8;        // looks before a heard grid gives way
+export const BEAT_LOSE_MS = 4000;         // nothing heard this long, and the grid is dropped
+
+/** Every value above, by name. */
+export const BEAT_CONSTS = {
+  BEAT_ONSET, BEAT_ONSET_MIN, BEAT_WINDOW_MS, BEAT_LOOK_MS, BEAT_SHORTEST_MS, BEAT_LONGEST_MS, BEAT_PRIOR_MS,
+  BEAT_PRIOR_OCT, BEAT_LOCK_CONF, BEAT_LOCK_CONTRAST, BEAT_LOCK_LOOKS, BEAT_STEADY, BEAT_PHASE_MS, BEAT_NEAR,
+  BEAT_RISE, BEAT_TIGHT_MS, BEAT_PULL_PHASE, BEAT_PULL_PERIOD, BEAT_CHANGE, BEAT_START, BEAT_START_OF, BEAT_CONFIRM, BEAT_OF,
+  BEAT_HOLD, BEAT_OTHER_LOOKS, BEAT_LOSE_MS,
+};
+
+const BLOCK_MS = (BEAT_BLOCK * 1000) / BEAT_RATE;
+const WINDOW = BEAT_WINDOW_MS / BLOCK_MS;
+const LOOK = BEAT_LOOK_MS / BLOCK_MS;
+const SHORTEST = BEAT_SHORTEST_MS / BLOCK_MS;
+const LONGEST = BEAT_LONGEST_MS / BLOCK_MS;
+
+/**
+ * Follows the beat in the five levels, block by block, and says where to pulse. Each block is handed in with the
+ * time it ends, counted in samples; the pulses come out a block ahead, at each beat less the microphone's delay,
+ * with the period they were laid on. In doubt it does not pulse.
+ *
+ * The levels, the onset strength and the tempo's sums are single precision (Math.fround), as the band's FPU keeps
+ * them, and the rest double, as the band's BeatTracker does: so the twins agree to the bit.
+ */
+export function createTracker() {
+  let latency = 0;
+  let hist; // per band, its last three levels in dB
+  let odf; // onset strength, one a block, single precision...
+  let times; // ...and when
+  let sum; // of odf
+  let n; // blocks heard
+  let lags; // the best period of the last looks, in blocks
+  let locked;
+  let period;
+  let base; // the period locked
+  let next; // the next beat
+  let beat; // its number
+  let decided; // the number of the last beat whose pulse was decided
+  let other; // looks in a row at another grid
+  let lastHeard;
+  let beats; // the grid's recent beats: { t, h }, h once its window has closed; deaf, if it was not listened to
+  let started;
+  let held;
+  let pulses;
+
+  function reset() {
+    hist = [[], [], [], [], []];
+    odf = [];
+    times = [];
+    sum = 0;
+    n = 0;
+    lags = [];
+    locked = false;
+    period = 0;
+    base = 0;
+    next = 0;
+    beat = 0;
+    decided = -1;
+    other = 0;
+    lastHeard = -Infinity;
+    beats = [];
+    started = false;
+    held = 0;
+    pulses = [];
+  }
+  reset();
+
+  const floor = () => Math.max(BEAT_ONSET_MIN, BEAT_ONSET * (odf.length ? sum / odf.length : 0));
+  // The strongest rise in [a, b): its index, or -1.
+  const argPeak = (a, b) => {
+    let k = -1;
+    for (let i = odf.length - 1; i >= 0 && times[i] >= a; i--) if (times[i] < b && (k < 0 || odf[i] > odf[k])) k = i;
+    return k;
+  };
+  const val = (k) => (k < 0 ? 0 : odf[k]);
+
+  // A beat whose window has closed: was it heard, and where did its drum start?
+  function close(b) {
+    const w = BEAT_NEAR * period;
+    const k = argPeak(b.t - w, b.t + w);
+    const off = Math.max(val(argPeak(b.t - period / 2, b.t - w)), val(argPeak(b.t + w, b.t + period / 2)));
+    b.h = val(k) >= floor() && val(k) >= off;
+    if (!b.h) return;
+    let s = k;
+    while (s > 0 && times[s - 1] >= b.t - w && odf[s - 1] >= BEAT_RISE * odf[k]) s--;
+    const e = times[s] - b.t;
+    // A drum that started well off the beat is another grid's, not this one's.
+    if (Math.abs(e) > BEAT_TIGHT_MS) {
+      b.h = false;
+      return;
+    }
+    lastHeard = Math.max(lastHeard, b.t);
+    // The loop: phase and period pulled a part of the way to the drum.
+    next += BEAT_PULL_PHASE * e;
+    period = Math.min(base * (1 + BEAT_CHANGE), Math.max(base * (1 - BEAT_CHANGE), period + BEAT_PULL_PERIOD * e));
+  }
+
+  // A beat the microphone was closed for is neither heard nor missed: it is not counted.
+  const counted = () => beats.filter((b) => !b.deaf);
+
+  // A new grid pulses once BEAT_START of its last BEAT_START_OF beats were heard; then BEAT_CONFIRM of the last
+  // BEAT_OF keep it, or one, while something rose near the last beat and the fold on the grid stands out by BEAT_HOLD.
+  function confirmed() {
+    const heard = (n) => counted().slice(-n).filter((b) => b.h).length;
+    if (!started && heard(BEAT_START_OF) >= BEAT_START) started = true;
+    const h = heard(BEAT_OF);
+    return started && (h >= BEAT_CONFIRM || (h >= 1 && rose() && held >= BEAT_HOLD));
+  }
+
+  // Something near the last beat rose as far as a heard beat must: the room has not gone quiet, nor the song moved.
+  function rose() {
+    const b = counted().at(-1);
+    const w = BEAT_NEAR * period;
+    return b !== undefined && val(argPeak(b.t - w, b.t + w)) >= floor();
+  }
+
+  // The last BEAT_PHASE_MS folded on the grid: its beat (BEAT_NEAR either side) against the fold's mean.
+  function holding(now) {
+    const P = period;
+    const bins = Math.round(P / BLOCK_MS);
+    const fold = new Array(bins).fill(0);
+    for (let i = odf.length - 1; i >= 0 && now - times[i] <= BEAT_PHASE_MS; i--) {
+      fold[Math.floor(((((times[i] - next) % P) + P) % P) / BLOCK_MS) % bins] += odf[i];
+    }
+    const fm = fold.reduce((s, v) => s + v, 0) / bins;
+    const w = Math.round((BEAT_NEAR * P) / BLOCK_MS);
+    let best = 0;
+    for (let j = -w; j <= w; j++) best = Math.max(best, fold[(j + bins) % bins]);
+    return fm > 0 ? best / fm : 0;
+  }
+
+  // The tempo read from the window, and where its grid would go.
+  function candidate(now) {
+    const N = odf.length;
+    if (N < 3 * LONGEST) return null;
+    const m = Math.fround(sum / N);
+    const x = odf.map((v) => Math.fround(v - m));
+    const r = (L) => {
+      let s = 0;
+      for (let i = L; i < N; i++) s = Math.fround(s + Math.fround(x[i] * x[i - L]));
+      return Math.fround(s / (N - L));
+    };
+    const r0 = r(0) || 1;
+    const prior = (L) => {
+      const q = Math.log2((L * BLOCK_MS) / BEAT_PRIOR_MS) / BEAT_PRIOR_OCT;
+      return Math.exp(-0.5 * q * q);
+    };
+    const score = [];
+    for (let L = SHORTEST; L <= LONGEST; L++) score.push(prior(L) * (r(L) / r0 + (2 * L < N ? (0.5 * r(2 * L)) / r0 : 0)));
+    let bi = 0;
+    for (let i = 1; i < score.length; i++) if (score[i] > score[bi]) bi = i;
+    const bestL = SHORTEST + bi;
+    const rest = score.filter((_, i) => Math.abs(i - bi) > 4);
+    const mu = rest.reduce((s, v) => s + v, 0) / rest.length;
+    const sd = Math.sqrt(rest.reduce((s, v) => s + (v - mu) * (v - mu), 0) / rest.length) || 1e-9;
+    const conf = (score[bi] - mu) / sd;
+    lags.push(bestL);
+    if (lags.length > BEAT_LOCK_LOOKS) lags.shift();
+    const steady = lags.length === BEAT_LOCK_LOOKS && Math.max(...lags) - Math.min(...lags) <= Math.max(1, BEAT_STEADY * bestL);
+    // A parabola through the peak: the period between blocks.
+    const a = bi > 0 ? score[bi - 1] : score[bi];
+    const b = score[bi];
+    const d = bi < score.length - 1 ? score[bi + 1] : score[bi];
+    const shift = a - 2 * b + d !== 0 ? (0.5 * (a - d)) / (a - 2 * b + d) : 0;
+    const P = (bestL + Math.max(-0.5, Math.min(0.5, shift))) * BLOCK_MS;
+    const bins = Math.round(P / BLOCK_MS);
+    const fold = new Array(bins).fill(0);
+    for (let i = N - 1; i >= 0 && now - times[i] <= BEAT_PHASE_MS; i--) fold[Math.floor((((times[i] % P) + P) % P) / BLOCK_MS) % bins] += odf[i];
+    let ph = 0;
+    for (let i = 1; i < bins; i++) if (fold[i] > fold[ph]) ph = i;
+    const fm = fold.reduce((s, v) => s + v, 0) / bins;
+    const contrast = fm > 0 ? (fold[ph] + (fold[(ph + 1) % bins] + fold[(ph + bins - 1) % bins]) / 2) / (2 * fm) : 0;
+    return { ok: conf >= BEAT_LOCK_CONF && contrast >= BEAT_LOCK_CONTRAST && steady, P, phase: (ph + 0.5) * BLOCK_MS };
+  }
+
+  function grid(P, phase, now) {
+    locked = true;
+    period = P;
+    base = P;
+    other = 0;
+    lastHeard = now;
+    started = false;
+    held = 0;
+    next = Math.ceil((now - phase) / P) * P + phase;
+    beat += 1;
+    beats = [];
+    // The beats just gone, heard or not by what is already in the window.
+    for (let j = BEAT_START_OF; j >= 1; j--) {
+      const b = { t: next - j * P };
+      if (b.t + BEAT_NEAR * P <= now && b.t + P / 2 <= now) close(b);
+      beats.push(b);
+    }
+  }
+
+  function evaluate(now) {
+    const cand = candidate(now);
+    if (!cand) return;
+    if (!locked) {
+      if (cand.ok) grid(cand.P, cand.phase, now);
+      return;
+    }
+    held = holding(now);
+    if (!cand.ok) {
+      other = 0;
+      return;
+    }
+    const d = (((cand.phase - next) % cand.P) + cand.P) % cand.P;
+    const differs = Math.abs(cand.P - period) > BEAT_CHANGE * period || Math.min(d, cand.P - d) > BEAT_NEAR * period;
+    if (differs && !confirmed()) return grid(cand.P, cand.phase, now);
+    other = differs ? other + 1 : 0;
+    if (other >= BEAT_OTHER_LOOKS) grid(cand.P, cand.phase, now);
+  }
+
+  return {
+    /** One block's five levels, and the time it ends. */
+    hear(levels, now) {
+      // Blocks not heard since the one before: the microphone was closed, and the clock ran on.
+      const deaf = times.length && now - times.at(-1) > 1.5 * BLOCK_MS ? [times.at(-1), now - BLOCK_MS] : null;
+      let f = 0;
+      levels.forEach((v, i) => {
+        const h = hist[i];
+        h.push(20 * Math.log10(Math.fround(v) + 1));
+        if (h.length > 3) h.shift();
+        if (h.length === 3) f += Math.max(0, h[2] - Math.max(h[1], h[0]));
+      });
+      odf.push(Math.fround(f));
+      sum += odf.at(-1);
+      times.push(now);
+      if (odf.length > WINDOW) {
+        sum -= odf.shift();
+        times.shift();
+      }
+      if (++n % LOOK === 0) evaluate(now);
+      if (locked) {
+        while (next <= now) {
+          beats.push({ t: next });
+          if (beats.length > 8) beats.shift();
+          next += period;
+          beat += 1;
+        }
+        if (deaf) for (const b of beats) if (Math.abs(b.t - (deaf[0] + deaf[1]) / 2) < (deaf[1] - deaf[0]) / 2 + BEAT_NEAR * period) b.deaf = true;
+        // Beats whose windows, and the half beat after, have closed.
+        for (const b of beats) if (b.h === undefined && !b.deaf && now >= b.t + period / 2) close(b);
+        if (now - lastHeard > BEAT_LOSE_MS) {
+          locked = false;
+          period = 0;
+        } else if (decided !== beat && next - latency <= now + BLOCK_MS) {
+          // The next beat's pulse, decided in the last block before it is due.
+          decided = beat;
+          if (confirmed()) pulses.push({ at: next - latency, period });
+        }
+      }
+    },
+    /** Forget everything heard: the microphone has closed. */
+    reset,
+    /** The microphone's delay from a sound to the block that hears it, in ms. */
+    setLatency(ms) {
+      latency = ms;
+    },
+    /** The pulses decided since last asked: when each is due, and the beat's period. */
+    take() {
+      const out = pulses;
+      pulses = [];
+      return out;
+    },
+    /** Locked on a grid, and its period in ms (0 when not). */
+    state: () => ({ locked, period }),
+  };
+}
````

In `firmware/src/beat_logic.h`:

````diff
--- a/firmware/src/beat_logic.h
+++ b/firmware/src/beat_logic.h
@@ -1,20 +1,28 @@
 // ON THE BEAT — the beat on the wristband, with no hardware in it
 // (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §2).
 //
-// What the microphone's samples become: five levels a block, which the band's
-// tracker follows. Its twin is app/lib/beat.js, which the stand-in at /band
-// runs; tests/firmware.test.js holds the two to each other on the same
-// samples. This side works in float, as the band's FPU does; the stand-in in
-// double, so they are held to within a small tolerance, not to the bit.
+// What the microphone's samples become, five levels a block, and the tracker
+// that follows the beat in them and says where to pulse. Their twins are in
+// app/lib/beat.js, which the stand-in at /band runs; tests/firmware.test.js
+// holds them to each other on the same samples and the same blocks.
+//
+// Levels works in float, as the band's FPU does, and the stand-in in double,
+// so the two are held to within a small tolerance. BeatTracker keeps the
+// levels, the onset strength and the tempo's sums in float and the rest in
+// double, and the stand-in rounds the same values the same way, so the two
+// trackers agree to the bit and no threshold can tip differently.
 //
 // band_logic.h includes this, so it builds as the band's compiler takes it
 // (C++11, after Arduino's macros) as well as on a laptop.
 
 #pragma once
 
+#include <algorithm>
 #include <cmath>
 #include <cstddef>
 #include <cstdint>
+#include <limits>
+#include <vector>
 
 namespace otb {
 
@@ -88,4 +96,391 @@ class Levels {
   BeatFilter lo3500_{true, BEAT_EDGE_4}, hi3500_{false, BEAT_EDGE_4};
 };
 
+
+// The tracker's named values (§2's table), all a guess until worn. app/lib/beat.js BEAT_CONSTS has the same.
+constexpr double BEAT_ONSET = 2.5;            // a heard beat's rise, against the window's mean onset strength...
+constexpr double BEAT_ONSET_MIN = 6;          // ...and never below this, in dB
+constexpr uint32_t BEAT_WINDOW_MS = 6000;     // the onset strength the tempo is read from
+constexpr uint32_t BEAT_LOOK_MS = 128;        // how often the tempo is read
+constexpr uint32_t BEAT_SHORTEST_MS = 336;    // the periods read: 178 BPM...
+constexpr uint32_t BEAT_LONGEST_MS = 752;     // ...to 80
+constexpr double BEAT_PRIOR_MS = 500;         // the tempo a listener would tap...
+constexpr double BEAT_PRIOR_OCT = 0.7;        // ...and how firmly, in octaves
+constexpr double BEAT_LOCK_CONF = 4;          // how far the best period must stand out, in standard deviations
+constexpr double BEAT_LOCK_CONTRAST = 4.5;    // how far the beat must stand out of its own period
+constexpr size_t BEAT_LOCK_LOOKS = 6;         // looks in a row with the same period...
+constexpr double BEAT_STEADY = 0.02;          // ...within this much of it
+constexpr uint32_t BEAT_PHASE_MS = 2000;      // the stretch folded to place the grid
+constexpr double BEAT_NEAR = 0.12;            // of a period, either side of a beat
+constexpr float BEAT_RISE = 0.25f;            // a rise is traced back while it is at least this much of its peak
+constexpr double BEAT_TIGHT_MS = 30;          // how near its beat a drum must start for the beat to be heard
+constexpr double BEAT_PULL_PHASE = 0.3;       // how far a heard beat pulls the next beat...
+constexpr double BEAT_PULL_PERIOD = 0.05;     // ...and the period
+constexpr double BEAT_CHANGE = 0.05;          // the most the period moves from its lock; more is another song
+constexpr size_t BEAT_START = 4;              // a new grid pulses once this many...
+constexpr size_t BEAT_START_OF = 5;           // ...of the last this many were heard, looking back from where it was laid...
+constexpr size_t BEAT_CONFIRM = 2;            // ...and keeps pulsing while this many...
+constexpr size_t BEAT_OF = 3;                 // ...of the last this many were
+constexpr double BEAT_HOLD = 4;               // or one was, with the fold on the grid peaking this far above its mean
+constexpr int BEAT_OTHER_LOOKS = 8;           // looks before a heard grid gives way
+constexpr uint32_t BEAT_LOSE_MS = 4000;       // nothing heard this long, and the grid is dropped
+
+constexpr double BEAT_BLOCK_MS = BEAT_BLOCK * 1000.0 / BEAT_RATE;  // one block, in ms
+
+// A pulse the tracker decided: when it is due, and the period of the grid it was laid on, in ms.
+struct BeatPulse {
+  double at;
+  double period;
+};
+
+// Follows the beat in the five levels, block by block, and says where to pulse (app/lib/beat.js createTracker).
+// Each block is handed in with the time it ends, counted in samples; the pulses come out a block ahead, at each
+// beat less the microphone's delay. In doubt it does not pulse.
+class BeatTracker {
+ public:
+  BeatTracker() {
+    for (size_t L = SHORTEST; L <= LONGEST; ++L) {
+      const double q = std::log2((static_cast<double>(L) * BEAT_BLOCK_MS) / BEAT_PRIOR_MS) / BEAT_PRIOR_OCT;
+      prior_[L - SHORTEST] = std::exp(-0.5 * q * q);
+    }
+    reset();
+  }
+
+  // One block's five levels, and the time it ends.
+  void hear(const BandLevels& levels, uint32_t now) {
+    // Blocks not heard since the one before: the microphone was closed, and the clock ran on.
+    const bool deaf = n_ > 0 && now - times_[n_ - 1] > 1.5 * BEAT_BLOCK_MS;
+    const double deafFrom = deaf ? times_[n_ - 1] : 0;
+    const double deafTo = deaf ? static_cast<double>(now) - BEAT_BLOCK_MS : 0;
+    double f = 0;
+    const size_t have = std::min<size_t>(histN_ + 1, 3);
+    for (size_t k = 0; k < BEAT_BANDS; ++k) {
+      double* h = hist_[k];
+      const double db = 20 * std::log10(static_cast<double>(levels.v[k]) + 1);
+      if (histN_ == 3) {
+        h[0] = h[1];
+        h[1] = h[2];
+        h[2] = db;
+      } else {
+        h[histN_] = db;
+      }
+      if (have == 3) f += std::max(0.0, h[2] - std::max(h[1], h[0]));
+    }
+    histN_ = have;
+    const float v = static_cast<float>(f);
+    sum_ += v;
+    if (n_ == WINDOW) {
+      sum_ -= odf_[0];
+      std::copy(odf_ + 1, odf_ + n_, odf_);
+      std::copy(times_ + 1, times_ + n_, times_);
+      --n_;
+    }
+    odf_[n_] = v;
+    times_[n_] = now;
+    ++n_;
+    if (++blocks_ % LOOK == 0) evaluate(now);
+    if (!locked_) return;
+    while (next_ <= now) {
+      push({next_, UNHEARD, false});
+      next_ += period_;
+      ++beat_;
+    }
+    if (deaf) {
+      for (size_t i = 0; i < beatsN_; ++i) {
+        if (std::fabs(beats_[i].t - (deafFrom + deafTo) / 2) < (deafTo - deafFrom) / 2 + BEAT_NEAR * period_) beats_[i].deaf = true;
+      }
+    }
+    // Beats whose windows, and the half beat after, have closed.
+    for (size_t i = 0; i < beatsN_; ++i) {
+      if (beats_[i].h == UNHEARD && !beats_[i].deaf && now >= beats_[i].t + period_ / 2) close(beats_[i]);
+    }
+    if (now - lastHeard_ > BEAT_LOSE_MS) {
+      locked_ = false;
+      period_ = 0;
+    } else if (decided_ != beat_ && next_ - latency_ <= now + BEAT_BLOCK_MS) {
+      // The next beat's pulse, decided in the last block before it is due.
+      decided_ = beat_;
+      if (confirmed()) pulses_.push_back({next_ - latency_, period_});
+    }
+  }
+
+  // Forget everything heard: the microphone has closed.
+  void reset() {
+    histN_ = 0;
+    n_ = 0;
+    sum_ = 0;
+    blocks_ = 0;
+    lagsN_ = 0;
+    locked_ = false;
+    period_ = 0;
+    base_ = 0;
+    next_ = 0;
+    beat_ = 0;
+    decided_ = 0;
+    other_ = 0;
+    lastHeard_ = -std::numeric_limits<double>::infinity();
+    beatsN_ = 0;
+    started_ = false;
+    held_ = 0;
+    pulses_.clear();
+  }
+
+  // The microphone's delay from a sound to the block that hears it, in ms.
+  void setLatency(double ms) { latency_ = ms; }
+
+  // The pulses decided since last asked.
+  std::vector<BeatPulse> take() {
+    std::vector<BeatPulse> out;
+    out.swap(pulses_);
+    return out;
+  }
+
+  bool locked() const { return locked_; }
+  double period() const { return period_; }
+
+ private:
+  // The named values in blocks: the window kept, how often it is read, and the periods read.
+  enum : size_t {
+    WINDOW = BEAT_WINDOW_MS * BEAT_RATE / 1000 / BEAT_BLOCK,
+    LOOK = BEAT_LOOK_MS * BEAT_RATE / 1000 / BEAT_BLOCK,
+    SHORTEST = BEAT_SHORTEST_MS * BEAT_RATE / 1000 / BEAT_BLOCK,
+    LONGEST = BEAT_LONGEST_MS * BEAT_RATE / 1000 / BEAT_BLOCK,
+    PERIODS = LONGEST - SHORTEST + 1,
+  };
+  enum : int8_t { UNHEARD = -1 };  // a beat whose window has not closed
+
+  struct Beat {
+    double t;
+    int8_t h;   // UNHEARD, 0 or 1
+    bool deaf;  // the microphone was closed for it: neither heard nor missed
+  };
+
+  double floorOf() const { return std::max(BEAT_ONSET_MIN, BEAT_ONSET * (n_ ? sum_ / n_ : 0)); }
+  // The strongest rise in [a, b): its index, or -1.
+  long argPeak(double a, double b) const {
+    long k = -1;
+    for (long i = static_cast<long>(n_) - 1; i >= 0 && times_[i] >= a; --i) {
+      if (times_[i] < b && (k < 0 || odf_[i] > odf_[k])) k = i;
+    }
+    return k;
+  }
+  double val(long k) const { return k < 0 ? 0 : odf_[k]; }
+
+  void push(const Beat& b) {
+    beats_[beatsN_++] = b;
+    if (beatsN_ > 8) {
+      std::copy(beats_ + 1, beats_ + beatsN_, beats_);
+      --beatsN_;
+    }
+  }
+
+  // A beat whose window has closed: was it heard, and where did its drum start?
+  void close(Beat& b) {
+    const double w = BEAT_NEAR * period_;
+    const long k = argPeak(b.t - w, b.t + w);
+    const double off = std::max(val(argPeak(b.t - period_ / 2, b.t - w)), val(argPeak(b.t + w, b.t + period_ / 2)));
+    b.h = val(k) >= floorOf() && val(k) >= off;
+    if (!b.h) return;
+    long s = k;
+    while (s > 0 && times_[s - 1] >= b.t - w && odf_[s - 1] >= BEAT_RISE * odf_[k]) --s;
+    const double e = times_[s] - b.t;
+    // A drum that started well off the beat is another grid's, not this one's.
+    if (std::fabs(e) > BEAT_TIGHT_MS) {
+      b.h = 0;
+      return;
+    }
+    lastHeard_ = std::max(lastHeard_, b.t);
+    // The loop: phase and period pulled a part of the way to the drum.
+    next_ += BEAT_PULL_PHASE * e;
+    period_ = std::min(base_ * (1 + BEAT_CHANGE), std::max(base_ * (1 - BEAT_CHANGE), period_ + BEAT_PULL_PERIOD * e));
+  }
+
+  // Of the last n beats the microphone was open for, how many were heard.
+  size_t heard(size_t n) const {
+    size_t seen = 0, h = 0;
+    for (size_t i = beatsN_; i-- > 0 && seen < n;) {
+      if (beats_[i].deaf) continue;
+      ++seen;
+      if (beats_[i].h == 1) ++h;
+    }
+    return h;
+  }
+
+  // A new grid pulses once BEAT_START of its last BEAT_START_OF beats were heard; then BEAT_CONFIRM of the last
+  // BEAT_OF keep it, or one, while something rose near the last beat and the fold on the grid stands out by BEAT_HOLD.
+  bool confirmed() {
+    if (!started_ && heard(BEAT_START_OF) >= BEAT_START) started_ = true;
+    const size_t h = heard(BEAT_OF);
+    return started_ && (h >= BEAT_CONFIRM || (h >= 1 && rose() && held_ >= BEAT_HOLD));
+  }
+
+  // Something near the last beat rose as far as a heard beat must: the room has not gone quiet, nor the song moved.
+  bool rose() const {
+    for (size_t i = beatsN_; i-- > 0;) {
+      if (beats_[i].deaf) continue;
+      const double w = BEAT_NEAR * period_;
+      return val(argPeak(beats_[i].t - w, beats_[i].t + w)) >= floorOf();
+    }
+    return false;
+  }
+
+  // The fold's bin for a time, at period P.
+  static size_t bin(double t, double P, size_t bins) {
+    return static_cast<size_t>(std::floor(std::fmod(std::fmod(t, P) + P, P) / BEAT_BLOCK_MS)) % bins;
+  }
+
+  // The last BEAT_PHASE_MS folded on the grid: its beat (BEAT_NEAR either side) against the fold's mean.
+  double holding(uint32_t now) const {
+    const double P = period_;
+    const size_t bins = static_cast<size_t>(std::round(P / BEAT_BLOCK_MS));
+    double fold[LONGEST + 2] = {};
+    for (long i = static_cast<long>(n_) - 1; i >= 0 && now - times_[i] <= BEAT_PHASE_MS; --i) {
+      fold[bin(times_[i] - next_, P, bins)] += odf_[i];
+    }
+    double total = 0;
+    for (size_t i = 0; i < bins; ++i) total += fold[i];
+    const double fm = total / bins;
+    const long w = std::lround((BEAT_NEAR * P) / BEAT_BLOCK_MS);
+    const long n = static_cast<long>(bins);
+    double best = 0;
+    for (long j = -w; j <= w; ++j) best = std::max(best, fold[(j + n) % n]);
+    return fm > 0 ? best / fm : 0;
+  }
+
+  struct Candidate {
+    bool ok;
+    double P;
+    double phase;
+  };
+
+  // The tempo read from the window, and where its grid would go.
+  bool candidate(uint32_t now, Candidate& out) {
+    const size_t N = n_;
+    if (N < 3 * LONGEST) return false;
+    const float m = static_cast<float>(sum_ / N);
+    auto r = [&](size_t L) {
+      float s = 0;
+      for (size_t i = L; i < N; ++i) s += (odf_[i] - m) * (odf_[i - L] - m);
+      return s / static_cast<float>(N - L);
+    };
+    const float first = r(0);
+    const double r0 = first != 0 ? first : 1;
+    double score[PERIODS];
+    for (size_t L = SHORTEST; L <= LONGEST; ++L) {
+      score[L - SHORTEST] = prior_[L - SHORTEST] * (r(L) / r0 + (2 * L < N ? (0.5 * r(2 * L)) / r0 : 0));
+    }
+    size_t bi = 0;
+    for (size_t i = 1; i < PERIODS; ++i) {
+      if (score[i] > score[bi]) bi = i;
+    }
+    const size_t bestL = SHORTEST + bi;
+    const auto rest = [bi](size_t i) { return i + 4 < bi || i > bi + 4; };
+    double mu = 0;
+    size_t count = 0;
+    for (size_t i = 0; i < PERIODS; ++i) {
+      if (rest(i)) mu += score[i], ++count;
+    }
+    mu /= count;
+    double dev = 0;
+    for (size_t i = 0; i < PERIODS; ++i) {
+      if (rest(i)) dev += (score[i] - mu) * (score[i] - mu);
+    }
+    double sd = std::sqrt(dev / count);
+    if (sd == 0) sd = 1e-9;
+    const double conf = (score[bi] - mu) / sd;
+    if (lagsN_ == BEAT_LOCK_LOOKS) {
+      std::copy(lags_ + 1, lags_ + lagsN_, lags_);
+      --lagsN_;
+    }
+    lags_[lagsN_++] = bestL;
+    const size_t lo = *std::min_element(lags_, lags_ + lagsN_);
+    const size_t hi = *std::max_element(lags_, lags_ + lagsN_);
+    const bool steady = lagsN_ == BEAT_LOCK_LOOKS && hi - lo <= std::max(1.0, BEAT_STEADY * bestL);
+    // A parabola through the peak: the period between blocks.
+    const double a = bi > 0 ? score[bi - 1] : score[bi];
+    const double b = score[bi];
+    const double d = bi < PERIODS - 1 ? score[bi + 1] : score[bi];
+    const double shift = a - 2 * b + d != 0 ? (0.5 * (a - d)) / (a - 2 * b + d) : 0;
+    const double P = (bestL + std::max(-0.5, std::min(0.5, shift))) * BEAT_BLOCK_MS;
+    const size_t bins = static_cast<size_t>(std::round(P / BEAT_BLOCK_MS));
+    double fold[LONGEST + 2] = {};
+    for (long i = static_cast<long>(N) - 1; i >= 0 && now - times_[i] <= BEAT_PHASE_MS; --i) fold[bin(times_[i], P, bins)] += odf_[i];
+    size_t ph = 0;
+    for (size_t i = 1; i < bins; ++i) {
+      if (fold[i] > fold[ph]) ph = i;
+    }
+    double total = 0;
+    for (size_t i = 0; i < bins; ++i) total += fold[i];
+    const double fm = total / bins;
+    const double contrast = fm > 0 ? (fold[ph] + (fold[(ph + 1) % bins] + fold[(ph + bins - 1) % bins]) / 2) / (2 * fm) : 0;
+    out.ok = conf >= BEAT_LOCK_CONF && contrast >= BEAT_LOCK_CONTRAST && steady;
+    out.P = P;
+    out.phase = (ph + 0.5) * BEAT_BLOCK_MS;
+    return true;
+  }
+
+  void grid(double P, double phase, uint32_t now) {
+    locked_ = true;
+    period_ = P;
+    base_ = P;
+    other_ = 0;
+    lastHeard_ = now;
+    started_ = false;
+    held_ = 0;
+    next_ = std::ceil((now - phase) / P) * P + phase;
+    ++beat_;
+    beatsN_ = 0;
+    // The beats just gone, heard or not by what is already in the window.
+    for (size_t j = BEAT_START_OF; j >= 1; --j) {
+      Beat b = {next_ - j * P, UNHEARD, false};
+      if (b.t + BEAT_NEAR * P <= now && b.t + P / 2 <= now) close(b);
+      push(b);
+    }
+  }
+
+  void evaluate(uint32_t now) {
+    Candidate cand;
+    if (!candidate(now, cand)) return;
+    if (!locked_) {
+      if (cand.ok) grid(cand.P, cand.phase, now);
+      return;
+    }
+    held_ = holding(now);
+    if (!cand.ok) {
+      other_ = 0;
+      return;
+    }
+    const double d = std::fmod(std::fmod(cand.phase - next_, cand.P) + cand.P, cand.P);
+    const bool differs = std::fabs(cand.P - period_) > BEAT_CHANGE * period_ || std::min(d, cand.P - d) > BEAT_NEAR * period_;
+    if (differs && !confirmed()) return grid(cand.P, cand.phase, now);
+    other_ = differs ? other_ + 1 : 0;
+    if (other_ >= BEAT_OTHER_LOOKS) grid(cand.P, cand.phase, now);
+  }
+
+  double prior_[PERIODS];         // the tempo a listener would tap, as a weight for each period
+  double latency_ = 0;
+  double hist_[BEAT_BANDS][3];    // per band, its last three levels in dB
+  size_t histN_ = 0;
+  float odf_[WINDOW];             // onset strength, one a block...
+  uint32_t times_[WINDOW];        // ...and when
+  size_t n_ = 0;
+  double sum_ = 0;                // of odf_
+  uint32_t blocks_ = 0;
+  size_t lags_[BEAT_LOCK_LOOKS];  // the best period of the last looks, in blocks
+  size_t lagsN_ = 0;
+  bool locked_ = false;
+  double period_ = 0;
+  double base_ = 0;               // the period locked
+  double next_ = 0;               // the next beat...
+  uint32_t beat_ = 0;             // ...and its number
+  uint32_t decided_ = 0;          // the number of the last beat whose pulse was decided
+  int other_ = 0;                 // looks in a row at another grid
+  double lastHeard_ = 0;
+  Beat beats_[9];                 // the grid's recent beats
+  size_t beatsN_ = 0;
+  bool started_ = false;
+  double held_ = 0;
+  std::vector<BeatPulse> pulses_;
+};
+
 }  // namespace otb
````

- [ ] **Step 4: Run** — `tests/beat.test.js` (`ℹ pass 18`) and `tests/firmware.test.js` (`ℹ pass 110`), then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 438`. The twins' pulses agree to the bit: printed at `%.17g`, 129 of 129.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`. Run it in the background: several are C++.

````json
[
 {
  "label": "a new grid pulses on three heard beats of five",
  "file": "app/lib/beat.js",
  "from": "export const BEAT_START = 4; ",
  "to": "export const BEAT_START = 3; ",
  "test": "tests/beat.test.js",
  "expect": [
   "kicks at random and made-up speech seldom pulse"
  ]
 },
 {
  "label": "a new grid looks back only three beats",
  "file": "app/lib/beat.js",
  "from": "    for (let j = BEAT_START_OF; j >= 1; j--) {",
  "to": "    for (let j = 3; j >= 1; j--) {",
  "test": "tests/beat.test.js",
  "expect": [
   "a steady kick at 90, 120 and 160 BPM pulses within 4 s"
  ]
 },
 {
  "label": "the fold carries a grid with nothing rising near its last beat",
  "file": "app/lib/beat.js",
  "from": "    return b !== undefined && val(argPeak(b.t - w, b.t + w)) >= floor();",
  "to": "    return true;",
  "test": "tests/beat.test.js",
  "expect": [
   "a song that stops dead is quiet within two beats",
   "a new song at another tempo takes over within 4 s"
  ]
 },
 {
  "label": "a beat the microphone was closed for counts as missed",
  "file": "app/lib/beat.js",
  "from": "  const counted = () => beats.filter((b) => !b.deaf);",
  "to": "  const counted = () => beats;",
  "test": "tests/beat.test.js",
  "expect": [
   "a gap in listening for a reaction's sound does not stop the pulse"
  ]
 },
 {
  "label": "the pulse is drawn on the beat, not the microphone's delay ahead of it",
  "file": "app/lib/beat.js",
  "from": "          if (confirmed()) pulses.push({ at: next - latency, period });",
  "to": "          if (confirmed()) pulses.push({ at: next, period });",
  "test": "tests/beat.test.js",
  "expect": [
   "the pulses come out the microphone's delay ahead of the beat"
  ]
 },
 {
  "label": "a heard beat does not pull the period",
  "file": "app/lib/beat.js",
  "from": "period + BEAT_PULL_PERIOD * e));",
  "to": "period + 0 * e));",
  "test": "tests/beat.test.js",
  "expect": [
   "a new song at another tempo takes over within 4 s"
  ]
 },
 {
  "label": "a heard beat does not pull the phase",
  "file": "app/lib/beat.js",
  "from": "    next += BEAT_PULL_PHASE * e;",
  "to": "    next += 0 * e;",
  "test": "tests/beat.test.js",
  "expect": [
   "a steady kick at 90, 120 and 160 BPM pulses within 4 s",
   "a drum is timed from where its rise began",
   "an off-beat hi-hat never moves the grid"
  ]
 },
 {
  "label": "a drum that started well off the beat still counts",
  "file": "app/lib/beat.js",
  "from": "    if (Math.abs(e) > BEAT_TIGHT_MS) {",
  "to": "    if (Math.abs(e) > 1e9) {",
  "test": "tests/beat.test.js",
  "expect": [
   "a drum near a beat but well off it neither counts as the beat nor pulls the grid"
  ]
 },
 {
  "label": "a grid is never dropped",
  "file": "app/lib/beat.js",
  "from": "        if (now - lastHeard > BEAT_LOSE_MS) {",
  "to": "        if (false) {",
  "test": "tests/beat.test.js",
  "expect": [
   "a grid with nothing heard for BEAT_LOSE_MS is dropped"
  ]
 },
 {
  "label": "any rise is loud enough to hear a beat",
  "file": "app/lib/beat.js",
  "from": "  const floor = () => Math.max(BEAT_ONSET_MIN, BEAT_ONSET * (odf.length ? sum / odf.length : 0));",
  "to": "  const floor = () => 0;",
  "test": "tests/beat.test.js",
  "expect": [
   "kicks at random and made-up speech seldom pulse",
   "a song that stops dead is quiet within two beats",
   "a new song at another tempo takes over within 4 s",
   "a grid with nothing heard for BEAT_LOSE_MS is dropped"
  ]
 },
 {
  "label": "a grid is laid without standing out of its own period",
  "file": "app/lib/beat.js",
  "from": "    return { ok: conf >= BEAT_LOCK_CONF && contrast >= BEAT_LOCK_CONTRAST && steady, P, phase: (ph + 0.5) * BLOCK_MS };",
  "to": "    return { ok: conf >= BEAT_LOCK_CONF && steady, P, phase: (ph + 0.5) * BLOCK_MS };",
  "test": "tests/beat.test.js",
  "expect": [
   "kicks at random and made-up speech seldom pulse",
   "a grid with nothing heard for BEAT_LOSE_MS is dropped"
  ]
 },
 {
  "label": "reset keeps what was heard",
  "file": "app/lib/beat.js",
  "from": "    /** Forget everything heard: the microphone has closed. */\n    reset,",
  "to": "    /** Forget everything heard: the microphone has closed. */\n    reset() {},",
  "test": "tests/beat.test.js",
  "expect": [
   "reset forgets the beat"
  ]
 },
 {
  "label": "a rise is not traced back to where it began",
  "file": "app/lib/beat.js",
  "from": "    while (s > 0 && times[s - 1] >= b.t - w && odf[s - 1] >= BEAT_RISE * odf[k]) s--;\n",
  "to": "",
  "test": "tests/beat.test.js",
  "expect": [
   "a drum is timed from where its rise began"
  ]
 },
 {
  "label": "the band pulses on three heard beats of five",
  "file": "firmware/src/beat_logic.h",
  "from": "constexpr size_t BEAT_START = 4; ",
  "to": "constexpr size_t BEAT_START = 3; ",
  "test": "tests/firmware.test.js",
  "expect": [
   "the firmware follows the beat by the same named values"
  ]
 },
 {
  "label": "the band counts a beat it was deaf for as missed",
  "file": "firmware/src/beat_logic.h",
  "from": "    for (size_t i = beatsN_; i-- > 0 && seen < n;) {\n      if (beats_[i].deaf) continue;",
  "to": "    for (size_t i = beatsN_; i-- > 0 && seen < n;) {",
  "test": "tests/firmware.test.js",
  "expect": [
   "the firmware follows the beat as the stand-in does"
  ]
 },
 {
  "label": "the band draws the pulse on the beat",
  "file": "firmware/src/beat_logic.h",
  "from": "      if (confirmed()) pulses_.push_back({next_ - latency_, period_});",
  "to": "      if (confirmed()) pulses_.push_back({next_, period_});",
  "test": "tests/firmware.test.js",
  "expect": [
   "the firmware follows the beat as the stand-in does"
  ]
 },
 {
  "label": "the band never drops a grid",
  "file": "firmware/src/beat_logic.h",
  "from": "    if (now - lastHeard_ > BEAT_LOSE_MS) {",
  "to": "    if (false) {",
  "test": "tests/firmware.test.js",
  "expect": [
   "the firmware follows the beat as the stand-in does"
  ]
 },
 {
  "label": "the band's rise is not traced back to where it began",
  "file": "firmware/src/beat_logic.h",
  "from": "    while (s > 0 && times_[s - 1] >= b.t - w && odf_[s - 1] >= BEAT_RISE * odf_[k]) --s;",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "the firmware follows the beat as the stand-in does"
  ]
 },
 {
  "label": "the band's fold holds without a rise near the last beat",
  "file": "firmware/src/beat_logic.h",
  "from": "      return val(argPeak(beats_[i].t - w, beats_[i].t + w)) >= floorOf();",
  "to": "      return w > 0;",
  "test": "tests/firmware.test.js",
  "expect": [
   "the firmware follows the beat as the stand-in does"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add app/lib/beat.js firmware/host/logic_test.cpp firmware/src/beat_logic.h tests/beat-music.js tests/beat.test.js tests/firmware.test.js
```

````bash
git commit -F - <<'EOF'
The band follows the beat in its five levels, and says where to pulse

The spike's tracker (v6), in both twins under the spec's named values: the
onset strength is the rise in dB of each band over the higher of its two
blocks before; every 128 ms the tempo is read by autocorrelation over 336
to 752 ms, weighted towards 500 ms; a grid is laid where a steady reading
stands out of its own period, pulled towards each heard beat, and dropped
after 4 s of nothing. Each pulse is decided in the last block before it is
due, at the beat less the microphone's delay, with the period it was laid
on.

Four things differ from the spike, each measured on made-up music and on
the spike's offline set (30 runs):
- A new grid pulses once four of its last five beats were heard, looking
  back five from where it was laid. The spike's three of three counted
  beats the grid had just been fitted through, and locked on random kicks
  and made-up speech: over 80 minutes of them, 152 pulses before and 80
  now. It locked as fast or faster in every offline run.
- The fold carries a grid only while something near its last beat rose as
  far as a heard beat must: a song that stops into quiet, or changes tempo,
  no longer pulses a third beat after.
- A beat the microphone was closed for is neither heard nor missed, so a
  reaction's sound does not stop the pulse.
- The levels, the onset strength and the tempo's sums are single precision
  on both sides, so the twins agree to the bit (129 of 129 pulses).

tests/beat-music.js makes the music: kicks, a hi-hat, a held chord, noise,
speech, random kicks and gaps, through the stand-in's own energy function.

Mutation-checked: 19 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 3: A lit card pulses on the beat: full on it, half from two thirds of the way on

**Files:**
- Modify: `app/lib/beat.js`, `firmware/src/beat_logic.h`, `app/lib/wrist.js`, `firmware/src/band_logic.h`, `firmware/host/logic_test.cpp`, `tests/wrist-table.js`, `tests/fixtures/wrist-cases.json`
- Test: `tests/beat.test.js`, `tests/firmware.test.js`, `tests/wrist.test.js` (unchanged: it runs the table)

**Interfaces:**
- Consumes: Task 2's `createTracker` and `BeatTracker`; the wrist's `lit()`, `current()`, `stale()`/`link_.stale()`, `face(now)`, the show frame reader, the letters' reset, and the flashes; the table's steps, `lines()`, `check()` and the host binary's `wrist` runner.
- Produces: `pulseLight(full, since, period)` in both. On the wrist (both twins): `listening(now)` — the beat switch on, a show that is `lit()` and not `meet`, the link not stale, and not NOT NOW; `hear(levels, now)`, which forgets the beat (the tracker reset, the pulses dropped) whenever the wrist is not listening; `setMicLatency(ms)`; a show's `beat` (true or false) read when present, and the letters turning it back on; `face(now)` pulsing the light of a lit card at rest from the newest pulse due, for one period, before any flash is drawn over it. C++: `Frame::beat` (-1 absent, 0, 1). The host binary's `pulselight <full> <since> <period>`; the `wrist` runner's `<t> hear b0 .. b4` and `<t> latency <ms>`, and `"listening"` in every answer. The table: a step's `listening`, exact when given; a `music` step (`tests/beat-music.js`'s parts) heard block by block from its time, with a keep-alive every second, and its `during` steps put in among the blocks by time.

- [ ] **Step 1: Write the failing tests.** In `tests/beat.test.js`, the pulse's shape. In `tests/firmware.test.js`, the firmware draws a pulse's light as the stand-in does. Ten cases in the table, each run on both twins: a lit card pulses once locked, half from two thirds of the way on, full again once the music stops; on a low battery it pulses from its half light to a quarter; `BEAT: OFF` does not listen and the card stays lit, and on again it finds the beat afresh; NOT NOW does not listen and forgets the beat; only a lit card listens (not the meeting face, a dark face, away, the test light, waiting, the check or the letters); a card no longer believed does not listen, `STALE_MS` after the relay was lost; a flash is drawn over the pulse, which comes back after it; a card shown by SIDE is not at rest and does not pulse, and back at rest it does; the microphone's delay puts each pulse that far ahead; and the letters turn the beat back on.

In `tests/beat.test.js`:

````diff
--- a/tests/beat.test.js
+++ b/tests/beat.test.js
@@ -3,7 +3,7 @@
 
 import { test } from 'node:test';
 import assert from 'node:assert/strict';
-import { BEAT_BLOCK, BEAT_LOSE_MS, BEAT_RATE, createLevels, createTracker } from '../app/lib/beat.js';
+import { BEAT_BLOCK, BEAT_LOSE_MS, BEAT_RATE, createLevels, createTracker, pulseLight } from '../app/lib/beat.js';
 import { music, twoStep } from './beat-music.js';
 
 /** `blocks` blocks of a sine at `hz` and amplitude `a`, as whole 16-bit samples, from sample `from`. */
@@ -192,3 +192,15 @@ test('a grid with nothing heard for BEAT_LOSE_MS is dropped', () => {
   }
   assert.deepEqual(tracker.state(), { locked: false, period: 0 });
 });
+
+test("a pulse is the card's full light on the beat, falling in a straight line to half over two thirds of it", () => {
+  assert.equal(pulseLight(255, 0, 500), 255);
+  assert.equal(pulseLight(255, 500 / 6, 500), 255 - Math.floor(127.5 / 4));
+  assert.equal(pulseLight(255, 500 / 3, 500), 255 - Math.floor(127.5 / 2));
+  assert.equal(pulseLight(255, 1000 / 3, 500), 128);
+  assert.equal(pulseLight(255, 499, 500), 128);
+  // Never lower, and from a dimmed card's half light, half of that.
+  assert.equal(pulseLight(255, 5000, 500), 128);
+  assert.equal(pulseLight(128, 0, 500), 128);
+  assert.equal(pulseLight(128, 400, 500), 64);
+});
````

In `tests/wrist-table.js`:

````diff
--- a/tests/wrist-table.js
+++ b/tests/wrist-table.js
@@ -12,23 +12,31 @@
 //   <t> key1 down | <t> key1 up | <t> key2 down | <t> key2 up
 //   <t> frame <json>      a frame from the relay
 //   <t> battery <n> | <t> wifi <0|1>
+//   <t> latency <ms>      the microphone's delay, as the firmware sets it for its model
+//   <t> hear b0 .. b4     one block of the microphone's five levels, ending at t
 //
 // Every line after the first lets the time pass to t, does the one thing, and
-// answers one line: {"sent":[...frames, or "DROP"],"sounds":[...names],"face":{...}}.
+// answers one line: {"sent":[...frames, or "DROP"],"sounds":[...names],"face":{...},"listening":bool}.
 // `heard` lines are the keep-alive a case gets unless it says "keepAlive":
-// false; they let no time pass and their answers are not checked.
+// false; they let no time pass and their answers are not checked. Nor are
+// `hear` lines': what they send and sound is answered by the next line that is.
 //
 // A step's `sent` and `sounds` are exact, and empty unless the step says
 // otherwise, so a stray frame or sound anywhere fails. A `press` is a key down
 // and, PRESS ms later, its key up: the step's `sent`, `sounds` and `face` are
 // the key up's, and `downSounds` (["tick"] unless said) the key down's. A
 // `show` step sends one of the table's shows, with its `rev` and any fields in
-// `with` laid over it.
+// `with` laid over it. A step's `listening`, when it says one, is exact.
+//
+// A `music` step is made-up music (tests/beat-music.js) from its time on, heard
+// block by block, with a keep-alive every second; the steps in its `during`
+// happen between its blocks, at their own times.
 
 import assert from 'node:assert/strict';
 import { readFileSync } from 'node:fs';
 import { createHash } from 'node:crypto';
 import { createWrist } from '../app/lib/wrist.js';
+import { music } from './beat-music.js';
 
 export const TABLE = JSON.parse(readFileSync(new URL('./fixtures/wrist-cases.json', import.meta.url), 'utf8'));
 const T0 = 1000;       // every case starts here, not at 0
@@ -53,14 +61,28 @@ export function lines(c, consts) {
   const out = [{ line: 'key ' + TABLE.key, expect: null }];
   const showOf = (s) => ({ t: 'show', show: { ...TABLE.shows[s.show], ...(s.rev !== undefined ? { rev: s.rev } : {}), ...s.with } });
   let last = -Infinity;
-  for (const s of c.steps) {
+  const when = (l) => Number(l.line.split(' ')[0]);
+  const step = (s, out) => {
     const t = at(s.at ?? '0', consts);
     if (t < last) throw new Error(c.name + ': step at ' + s.at + ' goes back in time');
     last = t;
-    const expect = { sent: s.sent ?? [], sounds: s.sounds ?? [], face: s.face ?? null };
+    const expect = { sent: s.sent ?? [], sounds: s.sounds ?? [], face: s.face ?? null, listening: s.listening };
     const keep = () => { if (c.keepAlive !== false) out.push({ line: t + ' heard', expect: null }); };
     keep();
-    if (s.press) {
+    if (s.music) {
+      // Its blocks, with the lines of the steps during it put in among them by time; a line at a block's time
+      // comes after the block.
+      const steps = [];
+      for (const d of s.during ?? []) step(d, steps);
+      let alive = t;
+      for (const b of music(s.music, { from: t, seed: s.seed ?? 1 }).blocks) {
+        while (steps.length && when(steps[0]) < b.t) out.push(steps.shift());
+        if (c.keepAlive !== false && b.t - alive >= 1000) { out.push({ line: b.t + ' heard', expect: null }); alive = b.t; }
+        out.push({ line: b.t + ' hear ' + b.levels.join(' '), expect: null });
+        last = Math.max(last, b.t);
+      }
+      out.push(...steps);
+    } else if (s.press) {
       out.push({ line: t + ' key' + s.press + ' down', expect: { sent: [], sounds: s.downSounds ?? ['tick'], face: null } });
       last = t + PRESS;
       if (c.keepAlive !== false) out.push({ line: last + ' heard', expect: null });
@@ -72,8 +94,10 @@ export function lines(c, consts) {
     else if (s.frame) out.push({ line: t + ' frame ' + JSON.stringify(s.frame), expect });
     else if (s.battery !== undefined) out.push({ line: t + ' battery ' + s.battery, expect });
     else if (s.wifi !== undefined) out.push({ line: t + ' wifi ' + (s.wifi ? 1 : 0), expect });
+    else if (s.latency !== undefined) out.push({ line: t + ' latency ' + s.latency, expect });
     else out.push({ line: t + ' tick', expect });
-  }
+  };
+  for (const s of c.steps) step(s, out);
   return out;
 }
 
@@ -87,13 +111,17 @@ export function runJs(protocol) {
     const t = Number(first);
     if (verb === 'heard') { wrist.heard(t); answers.push(null); continue; }
     wrist.tick(t);
+    if (verb === 'hear') { wrist.hear(rest.map(Number), t); answers.push(null); continue; }
     if (verb === 'up') wrist.linkUp(t);
     else if (verb === 'down') wrist.linkDown(t);
     else if (verb === 'key1' || verb === 'key2') (rest[0] === 'down' ? wrist.keyDown : wrist.keyUp)(verb === 'key1' ? 1 : 2, t);
     else if (verb === 'frame') wrist.frame(rest.join(' '), t);
     else if (verb === 'battery') wrist.setBattery(Number(rest[0]), t);
     else if (verb === 'wifi') wrist.setWifi(rest[0] === '1');
-    answers.push({ sent: wrist.take().map((o) => (o === 'DROP' ? o : JSON.parse(o))), sounds: wrist.sounds(), face: wrist.face(t) });
+    else if (verb === 'latency') wrist.setMicLatency(Number(rest[0]));
+    answers.push({
+      sent: wrist.take().map((o) => (o === 'DROP' ? o : JSON.parse(o))), sounds: wrist.sounds(), face: wrist.face(t), listening: wrist.listening(t),
+    });
   }
   return answers;
 }
@@ -112,6 +140,7 @@ export function check(c, protocol, answers, consts) {
     const where = c.name + ' / ' + line;
     assert.deepEqual(got.sent.filter((f) => !(f && f.t === 'ping')), deep(expect.sent), where + ': sent');
     assert.deepEqual(got.sounds, expect.sounds, where + ': sounds');
+    if (expect.listening !== undefined) assert.equal(got.listening, expect.listening, where + ': listening');
     if (!expect.face) return;
     for (const [k, v] of Object.entries(expect.face)) {
       const want = typeof v === 'string' && /^LIGHT_/.test(v) ? consts[v] : v;
````

In `tests/fixtures/wrist-cases.json`:

````diff
--- a/tests/fixtures/wrist-cases.json
+++ b/tests/fixtures/wrist-cases.json
@@ -1375,6 +1375,142 @@
         { "at": "2000", "show": "HI", "rev": 3, "with": { "found": 27 } },
         { "at": "3000", "show": "HI", "rev": 3, "with": { "found": { "n": 27, "intent": "red" } }, "sounds": ["found"], "face": { "big": "", "field": "white", "light": "LIGHT_FULL" } }
       ]
+    },
+    {
+      "name": "a lit card pulses on the beat once it has locked: half from two thirds of the way on, full again once the music stops",
+      "steps": [
+        { "at": "0", "battery": 62 },
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
+        { "at": "0", "show": "HI", "rev": 1, "listening": true },
+        { "at": "0", "music": [{ "ms": 12000, "bpm": 120, "noise": 200 }, { "ms": 3000, "noise": 200 }], "during": [
+          { "at": "500", "face": { "light": "LIGHT_FULL" }, "listening": true },
+          { "at": "9400", "face": { "big": "HI :)", "field": "hi", "light": 128 } },
+          { "at": "9495", "face": { "light": 128 } },
+          { "at": "9504", "face": { "light": 128 } },
+          { "at": "12900", "face": { "light": 128 } },
+          { "at": "13010", "face": { "light": "LIGHT_FULL" } },
+          { "at": "14500", "face": { "light": "LIGHT_FULL" } }
+        ] }
+      ]
+    },
+    {
+      "name": "on a low battery the card pulses from its half light to a quarter",
+      "steps": [
+        { "at": "0", "battery": 62 },
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
+        { "at": "0", "show": "HI", "rev": 1, "with": { "dim": true } },
+        { "at": "0", "music": [{ "ms": 10000, "bpm": 120, "noise": 200 }], "during": [
+          { "at": "500", "face": { "light": "LIGHT_DIM" } },
+          { "at": "9400", "face": { "light": 64 } }
+        ] }
+      ]
+    },
+    {
+      "name": "BEAT: OFF, the band does not listen and the card stays lit; on again, it finds the beat afresh",
+      "steps": [
+        { "at": "0", "battery": 62 },
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
+        { "at": "0", "show": "HI", "rev": 1, "with": { "beat": false }, "listening": false },
+        { "at": "0", "music": [{ "ms": 16000, "bpm": 120, "noise": 200 }], "during": [
+          { "at": "9400", "face": { "light": "LIGHT_FULL" }, "listening": false },
+          { "at": "10000", "show": "HI", "rev": 1, "with": { "beat": true }, "listening": true },
+          { "at": "11400", "face": { "light": "LIGHT_FULL" } },
+          { "at": "15400", "face": { "light": 128 } }
+        ] }
+      ]
+    },
+    {
+      "name": "NOT NOW: the band does not listen, and forgets the beat it had",
+      "steps": [
+        { "at": "0", "battery": 62 },
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
+        { "at": "0", "show": "HI", "rev": 1 },
+        { "at": "0", "music": [{ "ms": 16000, "bpm": 120, "noise": 200 }], "during": [
+          { "at": "9400", "face": { "light": 128 }, "listening": true },
+          { "at": "9600", "key1": "down", "sounds": ["tick"] },
+          { "at": "9600+HOLD_MS", "key1": "up", "sent": [{ "t": "hold" }], "sounds": ["down"], "face": { "light": "LIGHT_OFF" }, "listening": false },
+          { "at": "11200", "show": "QUIET", "rev": 2, "listening": false },
+          { "at": "12000", "show": "HI", "rev": 3, "listening": true },
+          { "at": "13400", "face": { "light": "LIGHT_FULL" } }
+        ] }
+      ]
+    },
+    {
+      "name": "only a lit card listens: not the meeting face, a dark face, away, the test light, waiting, the check or the letters",
+      "steps": [
+        { "at": "0", "battery": 62 },
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
+        { "at": "0", "show": "HI", "rev": 1, "listening": true },
+        { "at": "1000", "show": "MEET", "rev": 2, "sounds": ["jingle"], "listening": false },
+        { "at": "2000", "show": "OFF", "rev": 3, "listening": false },
+        { "at": "3000", "show": "SONG", "rev": 4, "listening": true },
+        { "at": "4000", "show": "AWAY", "rev": 5, "sounds": ["warn"], "listening": false },
+        { "at": "5000", "show": "TEST", "sounds": ["up"], "listening": false },
+        { "at": "6000", "show": "WAITING", "listening": false },
+        { "at": "7000", "show": "CHECK", "sounds": ["ask"], "listening": false },
+        { "at": "8000", "show": "PAIRING", "sounds": ["fall"], "listening": false }
+      ]
+    },
+    {
+      "name": "a card no longer believed does not listen: STALE_MS after the relay was lost",
+      "steps": [
+        { "at": "0", "battery": 62 },
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
+        { "at": "0", "show": "HI", "rev": 1, "listening": true },
+        { "at": "1000", "link": "down", "listening": true },
+        { "at": "1000+STALE_MS-1", "listening": true },
+        { "at": "1000+STALE_MS", "listening": false }
+      ]
+    },
+    {
+      "name": "a flash is drawn over the pulse, and the pulse comes back after it",
+      "steps": [
+        { "at": "0", "battery": 62 },
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
+        { "at": "0", "show": "HI", "rev": 1 },
+        { "at": "0", "music": [{ "ms": 16000, "bpm": 120, "noise": 200 }], "during": [
+          { "at": "9400", "face": { "light": 128 } },
+          { "at": "10000", "show": "HI", "rev": 1, "with": { "waves": { "ref": "0123456789", "n": 1, "seq": 1 } }, "sounds": ["hello"] },
+          { "at": "10400", "face": { "field": "hi", "big": "", "light": "LIGHT_FULL" }, "listening": true },
+          { "at": "10900", "face": { "light": "LIGHT_OFF" } },
+          { "at": "14400", "face": { "big": "HI :)", "light": 128 } }
+        ] }
+      ]
+    },
+    {
+      "name": "a card shown by SIDE is not at rest and does not pulse; back at rest, it does",
+      "steps": [
+        { "at": "0", "battery": 62 },
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
+        { "at": "0", "show": "HI", "rev": 1 },
+        { "at": "0", "music": [{ "ms": 18000, "bpm": 120, "noise": 200 }], "during": [
+          { "at": "9100", "press": 2, "face": { "small": "SIDE TO CHANGE" } },
+          { "at": "9400", "face": { "small": "SIDE TO CHANGE", "light": "LIGHT_FULL" }, "listening": true },
+          { "at": "15400", "face": { "small": "BLUE MEANS HELLO", "light": 128 } }
+        ] }
+      ]
+    },
+    {
+      "name": "the microphone's delay puts each pulse that far ahead of the beat it heard",
+      "steps": [
+        { "at": "0", "battery": 62 },
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
+        { "at": "0", "show": "HI", "rev": 1 },
+        { "at": "0", "latency": 100 },
+        { "at": "0", "music": [{ "ms": 10000, "bpm": 120, "noise": 200 }], "during": [
+          { "at": "9300", "face": { "light": 128 } }
+        ] }
+      ]
+    },
+    {
+      "name": "the letters turn the beat back on: the next person's card listens until their phone says otherwise",
+      "steps": [
+        { "at": "0", "battery": 62 },
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
+        { "at": "0", "show": "HI", "rev": 1, "with": { "beat": false }, "listening": false },
+        { "at": "1000", "show": "PAIRING", "listening": false },
+        { "at": "2000", "show": "HI", "rev": 1, "listening": true }
+      ]
     }
   ]
 }
````

In `firmware/host/logic_test.cpp`:

````diff
--- a/firmware/host/logic_test.cpp
+++ b/firmware/host/logic_test.cpp
@@ -852,6 +852,14 @@ std::string answer(const Command& c) {
     }
     return out + "]";
   }
+  if (c.verb == "pulselight") {
+    // pulselight <full> <since> <period>: a lit card's light that far into a pulse.
+    std::istringstream in(c.arg);
+    int full = 0;
+    double since = 0, period = 0;
+    in >> full >> since >> period;
+    return std::to_string(pulseLight(full, since, period));
+  }
   if (c.verb == "beatconsts") {
     // Every named value of the tracker, as app/lib/beat.js BEAT_CONSTS has them.
     const std::pair<const char*, double> all[] = {
@@ -1003,6 +1011,18 @@ int runWrist() {
       continue;
     }
     w->tick(t);
+    if (verb == "hear") {
+      std::istringstream levels(arg);
+      BandLevels l;
+      for (size_t k = 0; k < BEAT_BANDS; ++k) {
+        std::string one;
+        levels >> one;
+        l.v[k] = static_cast<float>(std::strtod(one.c_str(), nullptr));
+      }
+      w->hear(l, t);
+      std::cout << "{}\n";
+      continue;
+    }
     if (verb == "up") w->linkUp(t);
     else if (verb == "down") w->linkDown(t);
     else if (verb == "key1" || verb == "key2") {
@@ -1013,13 +1033,15 @@ int runWrist() {
     else if (verb == "frame") w->frame(arg, t);
     else if (verb == "battery") w->setBattery(std::atoi(arg.c_str()), t);
     else if (verb == "wifi") w->setWifi(arg == "1");
+    else if (verb == "latency") w->setMicLatency(std::strtod(arg.c_str(), nullptr));
     std::string sent, sounds;
     for (const std::string& f : w->take()) sent += (sent.empty() ? "" : ",") + (f == "DROP" ? std::string("\"DROP\"") : f);
     for (const std::string& n : w->sounds()) sounds += (sounds.empty() ? "" : ",") + quote(n);
     const Screen s = w->face(t);
     std::cout << "{\"sent\":[" << sent << "],\"sounds\":[" << sounds << "],\"face\":{\"big\":" << quote(s.big) << ",\"small\":" << quote(s.small)
               << ",\"field\":" << quote(s.field) << ",\"ink\":" << quote(s.ink) << ",\"light\":" << int(s.light)
-              << ",\"bar\":" << s.bar << ",\"code\":" << quote(s.code) << "}}\n";
+              << ",\"bar\":" << s.bar << ",\"code\":" << quote(s.code) << "},\"listening\":" << (w->listening(t) ? "true" : "false")
+              << "}\n";
   }
   return 0;
 }
````

In `tests/firmware.test.js`:

````diff
--- a/tests/firmware.test.js
+++ b/tests/firmware.test.js
@@ -21,7 +21,7 @@ import { createRelay, WS_PATH } from '../relay/server.js';
 import { HUE } from '../app/copy.js';
 import { codeFrom, pairUrl } from '../app/lib/pairing.js';
 import { CONSTS, FLASH_COLOURS, FLASHES, SOUNDS } from '../app/lib/wrist.js';
-import { BEAT_BLOCK, BEAT_CONSTS, BEAT_RATE, createLevels, createTracker } from '../app/lib/beat.js';
+import { BEAT_BLOCK, BEAT_CONSTS, BEAT_RATE, createLevels, createTracker, pulseLight } from '../app/lib/beat.js';
 import { music, twoStep } from './beat-music.js';
 import { TABLE, lines, check } from './wrist-table.js';
 
@@ -145,6 +145,13 @@ test('the firmware hears as the stand-in does: the same samples give the same fi
     assert.ok(Math.abs(v - want[b][k]) <= 0.0005 * want[b][k] + 0.002, `block ${b} band ${k}: ${v} against ${want[b][k]}`)));
 });
 
+test("the firmware draws a pulse's light as the stand-in does", { skip }, () => {
+  const asked = [];
+  for (const full of [255, 128]) for (const period of [336, 500, 752.4]) for (let since = 0; since <= period; since += period / 16) asked.push([full, since, period]);
+  const band = speak(asked.map(([full, since, period]) => `pulselight ${full} ${since} ${period}`)).map(Number);
+  assert.deepEqual(band, asked.map(([full, since, period]) => pulseLight(full, since, period)));
+});
+
 test('the firmware follows the beat by the same named values as the stand-in', { skip }, () => {
   const [consts] = speak(['beatconsts']);
   assert.deepEqual(JSON.parse(consts), BEAT_CONSTS);
````

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/beat.test.js tests/firmware.test.js 2>&1 | grep -E "^ℹ (tests|fail)|SyntaxError"` and `node --test tests/wrist.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)|TypeError" | head -4`

Expected: `tests/beat.test.js` and `tests/firmware.test.js` do not load, `... does not provide an export named 'pulseLight'`; `tests/wrist.test.js` runs 107 cases and fails 106 of them (`ℹ pass 1`), each with `TypeError: wrist.listening is not a function`, since every case's check now asks it.

- [ ] **Step 3: Implement.**

In `app/lib/beat.js`:

````diff
--- a/app/lib/beat.js
+++ b/app/lib/beat.js
@@ -11,6 +11,14 @@ export const BEAT_BLOCK = 128;
 /** Where the five bands meet: below 150 Hz, up to 400, 1200, 3500, and above. */
 export const BEAT_BANDS_HZ = [150, 400, 1200, 3500];
 
+/**
+ * A lit card's light on the beat (§1): its full light on the beat, falling in a straight line to half of that over
+ * the first two thirds of the beat, and half until the next. `since` is the time from the pulse, in ms.
+ */
+export function pulseLight(full, since, period) {
+  return full - Math.floor((full / 2) * Math.min(1, since / ((2 * period) / 3)));
+}
+
 /** A second-order low or high pass at `fc`, Q 0.7071 (the RBJ cookbook), carried from call to call. */
 function biquad(kind, fc) {
   const w = (2 * Math.PI * fc) / BEAT_RATE;
````

In `firmware/src/beat_logic.h`:

````diff
--- a/firmware/src/beat_logic.h
+++ b/firmware/src/beat_logic.h
@@ -36,6 +36,12 @@ constexpr float BEAT_EDGE_2 = 400;
 constexpr float BEAT_EDGE_3 = 1200;
 constexpr float BEAT_EDGE_4 = 3500;
 
+// A lit card's light on the beat (§1): its full light on the beat, falling in a straight line to half of that over
+// the first two thirds of the beat, and half until the next. `since` is the time from the pulse, in ms.
+inline int pulseLight(int full, double since, double period) {
+  return full - static_cast<int>(std::floor((full / 2.0) * std::min(1.0, since / ((2 * period) / 3))));
+}
+
 // One block's five levels: the root mean square of each band.
 struct BandLevels {
   float v[BEAT_BANDS];
````

In `app/lib/wrist.js`:

````diff
--- a/app/lib/wrist.js
+++ b/app/lib/wrist.js
@@ -27,7 +27,12 @@
 // it only once both have said it; until then the face says FOUND: WAITING.
 // Found by both, both bands play the found chirp and flash the meeting's card
 // three times, once for each number.
+//
+// A lit card at rest pulses on the beat (docs/superpowers/specs/2026-09-26-
+// wrist-beat-design.md): while listening() the band hears its microphone's
+// five levels a block, and its tracker says where each beat's pulse falls.
 
+import { createTracker, pulseLight } from './beat.js';
 import { bandIdOf } from './sha256.js';
 
 export const WAKE_MS = 6000;           // a KEY1 press shows the face this long
@@ -156,6 +161,11 @@ export function createWrist({ key }) {
   let due = [];               // sounds started since sounds() was last asked
   let soundOn = true;         // the person's switch, as the last show that said it had it (rule 3)
   let silent = false;         // NOT NOW, for the sake of silence (rule 1)
+  let beatOn = true;          // the person's beat switch, as the last show that said it had it (beat §1)
+  // The beat (beat §2): the tracker, whether it has been listening, and its last two pulses, the newer perhaps due.
+  const tracker = createTracker();
+  let tracking = false;
+  let pulses = [];
   // The meeting call (rule 4): the number last called for, whether it still calls, and since when.
   let called = '';
   let calling = false;
@@ -190,6 +200,18 @@ export function createWrist({ key }) {
   const meetingFace = (now) => show?.kind === 'meet' && /^[1-9][0-9]$/.test(show.big) && !stale(now) && !quiet.pending;
   const current = () => (quiet.pending || show?.quiet ? 'notnow' : show?.armed || 'off');
   const pct = () => (battery >= 0 ? battery + '%' : '');
+  /** The band listens for the beat: a lit card could pulse, the switch is on, and it is not NOT NOW (beat §2). */
+  const listening = (now) => beatOn && !!show && lit(show) && show.kind !== 'meet' && !stale(now) && current() !== 'notnow';
+
+  /** Not listening, the band forgets the beat it had: its microphone is closed. */
+  function listen(now) {
+    if (listening(now)) tracking = true;
+    else if (tracking) {
+      tracker.reset();
+      pulses = [];
+      tracking = false;
+    }
+  }
 
   /**
    * A reaction of this moment. cls: 0 a key or a result, 1 a call, 2 a warning. `card`: the colour a `set` or
@@ -410,9 +432,18 @@ export function createWrist({ key }) {
       result(now, 'NOT SENT');
       if (link.up) { out.push('DROP'); closed(now); }
     } else if (mode === 'result' && now >= resultUntil) rest();
+    listen(now);
     settle(now);
   }
 
+  /** One block of the microphone's five levels, and the time it ends. Not listening, it is not heard (beat §2). */
+  function hear(levels, now) {
+    listen(now);
+    if (!tracking) return;
+    tracker.hear(levels, now);
+    for (const p of tracker.take()) pulses = [...pulses, p].slice(-2);
+  }
+
   function keyDown(k, now) {
     advance(now);
     const s = k === 1 ? k1 : k2;
@@ -533,6 +564,7 @@ export function createWrist({ key }) {
     const same = !!was && JSON.stringify(was) === JSON.stringify(show);
     // A show's own switch counts for what it causes. One that is not true or false is not said.
     if (typeof m.show.sound === 'boolean') soundOn = m.show.sound;
+    if (typeof m.show.beat === 'boolean') beatOn = m.show.beat;
     if (show.kind === 'pairing') {
       // The band is nobody's: NOT NOW is over, and no meeting is anyone's.
       const wasPaired = !!secret;
@@ -545,6 +577,7 @@ export function createWrist({ key }) {
       if (was?.kind === 'check') react('fall', null, 1);  // the check ended without YES
       if (wasPaired) playWarn();                          // unpaired; the letters end any choice, so at once
       soundOn = true;                                     // after the letters' own reactions
+      beatOn = true;
       // New letters light for PAIR_AWAKE_MS; the same letters again (a reconnect) do not.
       if (show.code !== pairCode) { pairCode = show.code; litUntil = now + PAIR_AWAKE_MS; }
     } else pairCode = '';
@@ -658,6 +691,7 @@ export function createWrist({ key }) {
     } else {
       f = restFace(now, wakeUntil > now || mode === 'result');
       if (mode === 'result') f = { ...f, small: word };
+      else if (listening(now)) f = pulsed(f, now);
     }
     if (k1.down && !k1.fired && now - k1.since >= BAR_MS) {
       f = { ...f, small: 'KEEP HOLDING', bar: Math.min(99, Math.floor(((now - k1.since) * 100) / HOLD_MS)), light: Math.max(f.light, LIGHT_AWAKE) };
@@ -667,6 +701,12 @@ export function createWrist({ key }) {
     return flashOver(f, now);
   }
 
+  /** A lit card at rest, on the beat: its light falls from full to half over each pulse, for a beat (beat §1). */
+  function pulsed(f, now) {
+    const p = pulses.filter((q) => q.at <= now).at(-1);
+    return p && now - p.at < p.period ? { ...f, light: pulseLight(f.light, now - p.at, p.period) } : f;
+  }
+
   /** A flash, step by step: on is its colour at full light and nothing else; off is the backlight off. */
   function flashOver(f, now) {
     if (!playing || !playing.flash) return f;
@@ -696,5 +736,10 @@ export function createWrist({ key }) {
     /** The names of the sounds due to start since the last ask: the player plays the newest. */
     sounds: () => { const d = due; due = []; return d; },
     face,
+    hear,
+    /** Whether to have the microphone open: the band listens for the beat (beat §2). */
+    listening,
+    /** The microphone's delay from a sound to the block that hears it, in ms: the firmware's, for its model. */
+    setMicLatency: (ms) => tracker.setLatency(ms),
   };
 }
````

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -554,6 +554,7 @@ struct Frame {
   bool hasShow = false;
   Show show;
   int sound = -1;          // the show's sound switch: 1 on, 0 off, -1 not said (so not part of the Show)
+  int beat = -1;           // the show's beat switch, the same way
   Waves waves;             // the show's waves, nobody unless said (so not part of the Show either)
   Found found;             // the show's found, none unless said (nor this)
   std::string why;
@@ -629,6 +630,13 @@ inline bool readFrame(const std::string& text, Frame& f) {
         f.sound = on ? 1 : 0;
         return true;
       }
+      if (k == "beat") {
+        if (!r.peek('t') && !r.peek('f')) return r.skip();
+        bool on = false;
+        if (!r.boolean(on)) return false;
+        f.beat = on ? 1 : 0;
+        return true;
+      }
       if (k == "waves") {
         if (!r.peek('{')) return r.skip();
         return r.object([&](const std::string& w) {
@@ -1545,9 +1553,32 @@ class Wrist {
   void tick(uint32_t now) {
     advance(now);
     ticked(now);
+    listen(now);
     settle(now);
   }
 
+  /** Whether to have the microphone open: a lit card could pulse, the switch is on, and it is not NOT NOW (beat §2). */
+  bool listening(uint32_t now) const {
+    return beatOn_ && haveShow_ && lit(show_) && show_.kind != "meet" && !link_.stale(now) && current() != "notnow";
+  }
+
+  /** One block of the microphone's five levels, and the time it ends. Not listening, it is not heard (beat §2). */
+  void hear(const BandLevels& levels, uint32_t now) {
+    listen(now);
+    if (!tracking_) return;
+    tracker_.hear(levels, now);
+    for (const BeatPulse& p : tracker_.take()) {
+      if (pulsesN_ == 2) {
+        pulses_[0] = pulses_[1];
+        pulsesN_ = 1;
+      }
+      pulses_[pulsesN_++] = p;
+    }
+  }
+
+  /** The microphone's delay from a sound to the block that hears it, in ms: this model's. */
+  void setMicLatency(double ms) { tracker_.setLatency(ms); }
+
  private:
   void heardFrame(const std::string& text, uint32_t now) {
     link_.heard(now);
@@ -1587,6 +1618,7 @@ class Wrist {
     waves_ = f.waves;
     // A show's own switch counts for what it causes.
     if (f.sound >= 0) soundOn_ = f.sound == 1;
+    if (f.beat >= 0) beatOn_ = f.beat == 1;
     if (show_.kind == "pairing") {
       // Unpaired, or nobody came for it: the band is nobody's, so NOT NOW is over and no meeting is anyone's.
       const bool wasPaired = !secret_.empty();
@@ -1599,6 +1631,7 @@ class Wrist {
       if (wasCheck) react("fall", nullptr, 1);    // the check ended without YES
       if (wasPaired) playWarn();                  // unpaired; the letters end any choice, so at once
       soundOn_ = true;                            // after the letters' own reactions
+      beatOn_ = true;
       // New letters light for PAIR_AWAKE_MS; the same letters again (a reconnect) do not.
       if (show_.code != pairCode_) {
         pairCode_ = show_.code;
@@ -1762,6 +1795,7 @@ class Wrist {
     } else {
       f = restFace(now, static_cast<int32_t>(wakeUntil_ - now) > 0 || mode_ == RESULT);
       if (mode_ == RESULT) f.small = word_;
+      else if (listening(now)) f = pulsed(f, now);
     }
     if (k1_.down && !k1_.fired && now - k1_.since >= BAR_MS) {
       f.small = "KEEP HOLDING";
@@ -1774,6 +1808,27 @@ class Wrist {
   }
 
  private:
+  /** Not listening, the band forgets the beat it had: its microphone is closed. */
+  void listen(uint32_t now) {
+    if (listening(now)) {
+      tracking_ = true;
+    } else if (tracking_) {
+      tracker_.reset();
+      pulsesN_ = 0;
+      tracking_ = false;
+    }
+  }
+
+  /** A lit card at rest, on the beat: its light falls from full to half over each pulse, for a beat (beat §1). */
+  Screen pulsed(Screen f, uint32_t now) const {
+    const BeatPulse* p = nullptr;
+    for (size_t i = 0; i < pulsesN_; ++i) {
+      if (pulses_[i].at <= now) p = &pulses_[i];
+    }
+    if (p && now - p->at < p->period) f.light = static_cast<uint8_t>(pulseLight(f.light, now - p->at, p->period));
+    return f;
+  }
+
   /** A flash, step by step: on is its colour at full light and nothing else; off is the backlight off. */
   Screen flashOver(Screen f, uint32_t now) const {
     if (!playingOn_ || !playing_.flash) return f;
@@ -2122,6 +2177,12 @@ class Wrist {
   std::vector<std::string> due_;
   bool soundOn_ = true;  // the person's switch, as the last show that said it had it (rule 3)
   bool silent_ = false;  // NOT NOW, for the sake of silence (rule 1)
+  bool beatOn_ = true;   // the person's beat switch, as the last show that said it had it (beat §1)
+  // The beat (beat §2): the tracker, whether it has been listening, and its last two pulses, the newer perhaps due.
+  BeatTracker tracker_;
+  bool tracking_ = false;
+  BeatPulse pulses_[2] = {};
+  size_t pulsesN_ = 0;
   // The meeting call (rule 4): the number last called for, whether it still calls, and since when.
   std::string called_;
   bool calling_ = false;
````

- [ ] **Step 4: Run** — `tests/beat.test.js` (`ℹ pass 19`), `tests/wrist.test.js` (`ℹ pass 107`) and `tests/firmware.test.js` (`ℹ pass 121`), then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 460`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`. Run it in the background.

````json
[
 {
  "label": "the band listens with its beat switch off",
  "file": "app/lib/wrist.js",
  "from": "  const listening = (now) => beatOn && !!show && lit(show)",
  "to": "  const listening = (now) => !!show && lit(show)",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: BEAT: OFF, the band does not listen",
   "wrist.js: the letters turn the beat back on"
  ]
 },
 {
  "label": "the meeting face listens",
  "file": "app/lib/wrist.js",
  "from": "lit(show) && show.kind !== 'meet' && !stale(now)",
  "to": "lit(show) && !stale(now)",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: only a lit card listens"
  ]
 },
 {
  "label": "a card no longer believed listens",
  "file": "app/lib/wrist.js",
  "from": "show.kind !== 'meet' && !stale(now) && current() !== 'notnow';",
  "to": "show.kind !== 'meet' && current() !== 'notnow';",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a card no longer believed does not listen"
  ]
 },
 {
  "label": "NOT NOW listens",
  "file": "app/lib/wrist.js",
  "from": "!stale(now) && current() !== 'notnow';",
  "to": "!stale(now);",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: NOT NOW: the band does not listen"
  ]
 },
 {
  "label": "not listening, the band keeps the beat it had",
  "file": "app/lib/wrist.js",
  "from": "      tracker.reset();\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: NOT NOW: the band does not listen"
  ]
 },
 {
  "label": "a reaction closes the microphone and forgets the beat",
  "file": "app/lib/wrist.js",
  "from": "!stale(now) && current() !== 'notnow';",
  "to": "!stale(now) && current() !== 'notnow' && !playing;",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a flash is drawn over the pulse"
  ]
 },
 {
  "label": "a pulse lasts until the next",
  "file": "app/lib/wrist.js",
  "from": "    return p && now - p.at < p.period ? {",
  "to": "    return p ? {",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a lit card pulses on the beat once it has locked"
  ]
 },
 {
  "label": "a card shown by SIDE pulses",
  "file": "app/lib/wrist.js",
  "from": "      else f = words(CARD_WORDS[cur], 'SIDE TO CHANGE', cur, 'ink', LIGHT_FULL);",
  "to": "      else f = pulsed(words(CARD_WORDS[cur], 'SIDE TO CHANGE', cur, 'ink', LIGHT_FULL), now);",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a card shown by SIDE is not at rest"
  ]
 },
 {
  "label": "a show's beat switch is not read",
  "file": "app/lib/wrist.js",
  "from": "    if (typeof m.show.beat === 'boolean') beatOn = m.show.beat;\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: BEAT: OFF, the band does not listen",
   "wrist.js: the letters turn the beat back on"
  ]
 },
 {
  "label": "the letters leave the switch as it was",
  "file": "app/lib/wrist.js",
  "from": "      beatOn = true;\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the letters turn the beat back on"
  ]
 },
 {
  "label": "the microphone's delay is not heeded",
  "file": "app/lib/wrist.js",
  "from": "    setMicLatency: (ms) => tracker.setLatency(ms),",
  "to": "    setMicLatency: () => {},",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the microphone's delay puts each pulse"
  ]
 },
 {
  "label": "a dimmed card pulses from full light",
  "file": "app/lib/wrist.js",
  "from": "light: pulseLight(f.light, now - p.at, p.period)",
  "to": "light: pulseLight(LIGHT_FULL, now - p.at, p.period)",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: on a low battery the card pulses"
  ]
 },
 {
  "label": "the band listens with its beat switch off",
  "file": "firmware/src/band_logic.h",
  "from": "    return beatOn_ && haveShow_ && lit(show_)",
  "to": "    return haveShow_ && lit(show_)",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: BEAT: OFF, the band does not listen",
   "band_logic.h: the letters turn the beat back on"
  ]
 },
 {
  "label": "the band's meeting face listens",
  "file": "firmware/src/band_logic.h",
  "from": "lit(show_) && show_.kind != \"meet\" && !link_.stale(now)",
  "to": "lit(show_) && !link_.stale(now)",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: only a lit card listens"
  ]
 },
 {
  "label": "not listening, the band keeps its beat",
  "file": "firmware/src/band_logic.h",
  "from": "      tracker_.reset();\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: NOT NOW: the band does not listen"
  ]
 },
 {
  "label": "the band's pulse lasts until the next",
  "file": "firmware/src/band_logic.h",
  "from": "    if (p && now - p->at < p->period) f.light",
  "to": "    if (p) f.light",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a lit card pulses on the beat once it has locked"
  ]
 },
 {
  "label": "the band does not read a show's beat switch",
  "file": "firmware/src/band_logic.h",
  "from": "    if (f.beat >= 0) beatOn_ = f.beat == 1;\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: BEAT: OFF, the band does not listen",
   "band_logic.h: the letters turn the beat back on"
  ]
 },
 {
  "label": "the band keeps its first pulse in place of the one before the newest",
  "file": "firmware/src/band_logic.h",
  "from": "        pulses_[0] = pulses_[1];\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a lit card pulses on the beat once it has locked"
  ]
 }
]
````

- [ ] **Step 6: Commit, and close Stage A with P2**

```bash
git add app/lib/beat.js app/lib/wrist.js firmware/host/logic_test.cpp firmware/src/band_logic.h firmware/src/beat_logic.h tests/beat.test.js tests/firmware.test.js tests/fixtures/wrist-cases.json tests/wrist-table.js
```

````bash
git commit -F - <<'EOF'
A lit card pulses on the beat: full on it, half from two thirds of the way on

The wrist listens while a lit card could pulse (HI, FIRST SONG? or LET'S
DANCE!, believed, and not NOT NOW) and its person's beat switch is on,
which a show carries as `beat` the way it carries `sound`, on by default;
listening() is what the firmware opens its microphone by. Each block of
five levels goes to the tracker, and not listening, the tracker forgets
the beat. At rest, the card's light falls from its full light on each
pulse to half of it over two thirds of the beat and holds there until the
next; a pulse lasts a beat, so the card is steady again once they stop. A
look or a choice, a flash, the meeting face and every dark face do not
pulse. setMicLatency() moves each pulse ahead by the model's delay.

The table gains music: a step of made-up music heard block by block, with
steps during it at their own times, and every answer says whether the
band listens. Ten cases hold both twins to it: the lock and the shape,
a low battery, the switch, NOT NOW, the faces that do not listen, a relay
no longer believed, a flash over the pulse, SIDE, the delay, and the
letters, which turn the switch back on for the next person.

Mutation-checked: 18 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---

## Stage B — The switch

### Task 4: The relay carries each person's beat switch to their own band

**Files:**
- Modify: `relay/band.js`, `relay/server.js`
- Test: `tests/band.test.js`, `tests/wristband.test.js`

**Interfaces:**
- Consumes: the sound switch's path: `bandShow({ ..., sound, ... })` in `relay/band.js`; the room's `sound` map, `showBand()`, `case 'sound'` and `leave` in `relay/server.js`; `heldRelay()`, `pairedBand()` and the wristband tests' helpers.
- Produces: `bandShow({ ..., beat = null, ... })`, putting `beat` beside `sound` on the band's own card, the test light and away, and on nothing else; the room's `beat` map; `{ t: 'beat', on }` kept per person when `on` is a boolean, dropped otherwise; `leave` forgetting it.

- [ ] **Step 1: Write the failing tests.** In `tests/band.test.js`, the switch rides beside the sound switch on the same shows and on no others. Five in `tests/wristband.test.js`: a phone's switch rides on its band's shows as the sound switch does, one show a flip and none when unchanged; a malformed `beat` is dropped; one person's switch never reaches another's band; a band paired with the beat off gets it in its pairing flash, and the letters and the check carry none; and `leave` forgets it, the grace does not, and away carries it.

In `tests/band.test.js`:

````diff
--- a/tests/band.test.js
+++ b/tests/band.test.js
@@ -78,6 +78,25 @@ test('a show made from the view names what is armed and its rev; the others name
   }
 });
 
+test("the beat switch rides beside the sound switch, on the same shows and on no others", () => {
+  const m = { id: 'm1', intent: 'song', number: 27, at: T };
+  for (const beat of [true, false]) {
+    for (const s of [bandShow({ view: view({ armed: 'hi' }), beat, now: T }), bandShow({ view: view(), beat, now: T }),
+      bandShow({ view: view({ invisible: true }), beat, now: T }), bandShow({ view: view({ armed: 'hi' }, [m]), beat, now: T }),
+      bandShow({ view: view(), testUntil: T + 1, beat, now: T }), bandShow({ view: null, beat, now: T })]) {
+      assert.equal(s.beat, beat, JSON.stringify(s));
+      assert.equal('sound' in s, false, 'each switch only once its phone has said it');
+    }
+    for (const s of [bandShow({ view: view(), code: 'KXRT', beat, now: T }), bandShow({ view: view(), check: 12, beat, now: T }),
+      bandShow({ view: null, waiting: true, beat, now: T })]) {
+      assert.equal('beat' in s, false, JSON.stringify(s));
+    }
+  }
+  assert.deepEqual(bandShow({ view: view({ armed: 'song' }), sound: false, beat: false, now: T }),
+    { ...bandShow({ view: view({ armed: 'song' }), now: T }), sound: false, beat: false });
+  for (const v of [view({ armed: 'hi' }), null]) assert.equal('beat' in bandShow({ view: v, beat: null, now: T }), false);
+});
+
 test("the sound switch rides on every show to its person's band, and on none that is nobody's yet", () => {
   const m = { id: 'm1', intent: 'song', number: 27, at: T };
   for (const sound of [true, false]) {
````

In `tests/wristband.test.js`:

````diff
--- a/tests/wristband.test.js
+++ b/tests/wristband.test.js
@@ -511,6 +511,86 @@ test('leave forgets the switch; the grace does not, and away carries it', async
   close(again, ben, band, next);
 });
 
+// ---------- the beat switch (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §3) ----------
+
+test("a phone's beat switch rides on its band's shows as the sound switch does: one show a flip, none when unchanged", async () => {
+  const { band, ana } = await wearing('beat-flip');
+  assert.equal('beat' in band.show, false, 'before the phone says it, the show is as it was');
+  let shows = 0;
+  band.ws.on('message', (d) => { if (JSON.parse(String(d)).t === 'show') shows++; });
+  ana.send({ t: 'beat', on: false });
+  await band.until((s) => s.beat === false);
+  ana.send({ t: 'beat', on: false });
+  ana.send({ t: 'profile', name: 'Ana' });
+  await pause(150);
+  assert.equal(shows, 1, 'the same again sends nothing');
+  ana.send({ t: 'sound', on: false });
+  await band.until((s) => s.sound === false && s.beat === false);
+  ana.send({ t: 'beat', on: true });
+  await band.until((s) => s.beat === true && s.sound === false);
+  close(ana, band);
+});
+
+test('a malformed beat is dropped', async () => {
+  const { band, ana } = await wearing('beat-bad');
+  for (const m of [{ t: 'beat' }, { t: 'beat', on: 'no' }, { t: 'beat', on: 0 }, { t: 'beat', on: 1 }, { t: 'beat', on: null }]) {
+    ana.send(m);
+    await pause(80);
+    assert.equal('beat' in band.show, false, JSON.stringify(m));
+  }
+  ana.send({ t: 'beat', on: false });
+  await band.until((s) => s.beat === false);
+  close(ana, band);
+});
+
+test("one person's beat switch never reaches another's band", async () => {
+  const { band, ana } = await wearing('beat-two');
+  const other = await wristband();
+  const ben = await phone('beat-two');
+  await pairBand(ben, other);
+  await other.until((s) => s.kind === 'off');
+  ana.send({ t: 'beat', on: false });
+  await band.until((s) => s.beat === false);
+  await pause(100);
+  assert.equal('beat' in other.show, false);
+  close(ana, ben, band, other);
+});
+
+test('a band paired with the beat off gets it in its pairing flash; letters and the check carry none', async () => {
+  const band = await wristband();
+  const ana = await phone('beat-pair');
+  ana.send({ t: 'beat', on: false });
+  await pause(50);
+  assert.equal('beat' in band.show, false, 'letters are nobody\'s');
+  ana.send({ t: 'pair', code: band.show.code });
+  await ana.until((v) => v.me.check);
+  assert.equal('beat' in (await band.until((s) => s.kind === 'check')), false);
+  ana.send({ t: 'confirm', yes: true });
+  assert.deepEqual(await band.until((s) => s.kind === 'test'), { kind: 'test', beat: false });
+  close(ana, band);
+});
+
+test('leave forgets the beat switch; the grace does not, and away carries it', async () => {
+  const { band, ana } = await wearing('beat-away');
+  const ben = await phone('beat-away');   // someone stays, so the room itself is never let go
+  ana.send({ t: 'beat', on: false });
+  await band.until((s) => s.beat === false);
+  ana.ws.close();
+  await pause(100);
+  relay.expire(Date.now() + BAND_ALONE_MS + 1_000);
+  assert.equal((await band.until((s) => s.away)).beat, false);
+  const back = await phone('beat-away', { me: ana.me });
+  back.send({ t: 'leave' });
+  await reply(back, 'left');
+  const again = await phone('beat-away', { me: ana.me });
+  const next = await wristband();
+  again.send({ t: 'pair', code: next.show.code });
+  await again.until((v) => v.me.check);
+  again.send({ t: 'confirm', yes: true });
+  assert.deepEqual(await next.until((s) => s.kind === 'test'), { kind: 'test' });
+  close(again, ben, band, next);
+});
+
 // ---------- waves (docs/superpowers/specs/2026-09-25-wrist-waves-design.md §3) ----------
 
 /**
````

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build >/dev/null && node --test tests/band.test.js tests/wristband.test.js 2>&1 | grep -E "^✖|^ℹ (tests|pass|fail)"`

Expected: `tests/band.test.js` 15 tests, 1 failing (the switch rides beside the sound switch); `tests/wristband.test.js` 56 tests, the 5 new ones failing, each waiting for a `beat` the relay never sends.

- [ ] **Step 3: Implement.**

In `relay/band.js`:

````diff
--- a/relay/band.js
+++ b/relay/band.js
@@ -29,6 +29,7 @@ const short = (s, n) => {
  * @param {boolean} p.waiting     after a relay restart, until its owner's phone claims it
  * @param {number} p.testUntil    TEST THE LIGHT runs until this time
  * @param {boolean|null} p.sound  the person's sound switch, once their phone has said it; null before
+ * @param {boolean|null} p.beat   the person's beat switch, the same way
  * @param {Array} p.waves         room.wavesAt(): who waved at the person and waits, newest first, as { handle, n }
  * @param {number} p.now
  *
@@ -42,7 +43,9 @@ const short = (s, n) => {
  * carries it: their own, the test light (the white face that ends a pairing,
  * and TEST THE LIGHT) and not in a room. Letters, the check and waiting carry
  * none: those bands are nobody's yet, or not known to be whose. A show made
- * without a known switch is exactly the show made before there was one.
+ * without a known switch is exactly the show made before there was one. The
+ * beat switch rides beside it, on the same shows, the same way
+ * (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §3).
  *
  * A show about a person on SAY HI, a meeting's included, carries the waves
  * waiting for them as one small object: the newest one's handle (as the
@@ -56,11 +59,11 @@ const short = (s, n) => {
  * but NOT NOW names it (`found`), so the band plays it once, even one that was
  * out of reach at the moment.
  */
-export function bandShow({ view = null, battery = null, code = null, check = null, waiting = false, testUntil = 0, sound = null, waves = [], now = Date.now() }) {
+export function bandShow({ view = null, battery = null, code = null, check = null, waiting = false, testUntil = 0, sound = null, beat = null, waves = [], now = Date.now() }) {
   if (check) return { kind: 'check', big: String(check) };
   if (code) return { kind: 'pairing', code };
   if (waiting) return { kind: 'waiting' };
-  const said = sound === null ? {} : { sound };
+  const said = { ...(sound === null ? {} : { sound }), ...(beat === null ? {} : { beat }) };
   if (testUntil > now) return { kind: 'test', ...said };
   const dim = battery !== null && battery <= DIM_AT;
   if (!view) return { kind: 'off', battery, away: true, ...said };
````

In `relay/server.js`:

````diff
--- a/relay/server.js
+++ b/relay/server.js
@@ -99,9 +99,9 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
       }
       const show = shows.find((s) => s.id === key);
       const spots = Array.isArray(show?.spots) && show.spots.length ? show.spots.map(String) : SPOTS;
-      // sound: each person's sound switch, as their phone last said it. Leaving forgets it; the grace does not.
+      // sound, beat: each person's switches, as their phone last said them. Leaving forgets them; the grace does not.
       // The room reads the relay's clock: a wave's number is the time it was made, so it only goes up.
-      rooms.set(key, { key, room: createRoom({ spots, now }), sockets: new Set(), clips: new Map(), left: new Map(), heard: new Map(), sound: new Map() });
+      rooms.set(key, { key, room: createRoom({ spots, now }), sockets: new Set(), clips: new Map(), left: new Map(), heard: new Map(), sound: new Map(), beat: new Map() });
     }
     return rooms.get(key);
   }
@@ -202,8 +202,9 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
     const r = b.key ? rooms.get(b.key) : null;
     const view = r?.room.viewFor(b.person) ?? null;
     const sound = r?.sound.get(b.person) ?? null;
+    const beat = r?.beat.get(b.person) ?? null;
     const waves = view ? r.room.wavesAt(b.person) : [];
-    const text = JSON.stringify({ t: 'show', show: bandShow({ view, battery: b.battery, code: b.code, check: b.pending?.number ?? null, waiting: b.waiting, testUntil: b.testUntil, sound, waves, now }) });
+    const text = JSON.stringify({ t: 'show', show: bandShow({ view, battery: b.battery, code: b.code, check: b.pending?.number ?? null, waiting: b.waiting, testUntil: b.testUntil, sound, beat, waves, now }) });
     if (text !== b.lastShow) { b.lastShow = text; b.ws.send(text); }
   }
 
@@ -572,6 +573,11 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
         if (typeof m.on !== 'boolean') return;
         r.sound.set(me, m.on);
         break;
+      case 'beat':
+        // The same, for whether their band's card pulses on the beat.
+        if (typeof m.on !== 'boolean') return;
+        r.beat.set(me, m.on);
+        break;
       case 'pick': room.pick(me, m.track); break;
       case 'wave': room.wave(me, m.handle); break;
       case 'like': room.like(me, m.handle); break;
@@ -603,6 +609,7 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
         if (b) unpairBand(b);
         stopGrace(r, me);
         r.sound.delete(me);
+        r.beat.delete(me);
         room.leave(me);
         r.sockets.delete(ws);
         ws.r = null;
````

- [ ] **Step 4: Run** — the two files (`ℹ pass 15`, `ℹ pass 56`), then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 466`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "the beat switch is not carried",
  "file": "relay/band.js",
  "from": "  const said = { ...(sound === null ? {} : { sound }), ...(beat === null ? {} : { beat }) };",
  "to": "  const said = { ...(sound === null ? {} : { sound }) };",
  "test": "tests/band.test.js",
  "expect": [
   "the beat switch rides beside the sound switch"
  ]
 },
 {
  "label": "the letters carry the beat switch",
  "file": "relay/band.js",
  "from": "  if (code) return { kind: 'pairing', code };",
  "to": "  if (code) return { kind: 'pairing', code, ...(beat === null ? {} : { beat }) };",
  "test": "tests/band.test.js",
  "expect": [
   "the beat switch rides beside the sound switch"
  ]
 },
 {
  "label": "a malformed beat is kept",
  "file": "relay/server.js",
  "from": "        // The same, for whether their band's card pulses on the beat.\n        if (typeof m.on !== 'boolean') return;\n",
  "to": "        // The same, for whether their band's card pulses on the beat.\n",
  "test": "tests/wristband.test.js",
  "expect": [
   "a malformed beat is dropped"
  ]
 },
 {
  "label": "the band's show is made without the beat switch",
  "file": "relay/server.js",
  "from": "testUntil: b.testUntil, sound, beat, waves, now }) });",
  "to": "testUntil: b.testUntil, sound, waves, now }) });",
  "test": "tests/wristband.test.js",
  "expect": [
   "a phone's beat switch rides on its band's shows",
   "a malformed beat is dropped",
   "one person's beat switch never reaches another's band",
   "a band paired with the beat off gets it in its pairing flash",
   "leave forgets the beat switch"
  ]
 },
 {
  "label": "leave keeps the beat switch",
  "file": "relay/server.js",
  "from": "        r.beat.delete(me);\n",
  "to": "",
  "test": "tests/wristband.test.js",
  "expect": [
   "leave forgets the beat switch"
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
The relay carries each person's beat switch to their own band

{ t: 'beat', on } from a phone is kept per person beside the sound
switch, dropped unless `on` is true or false, and rides on the same shows
to their band: their own, the test light and away, never the letters, the
check or waiting. Leaving forgets it and the grace does not; nobody else's
band ever hears it. A show made without it is the show made before.

Mutation-checked: 5 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 5: The phone's wristband sheet gains BEAT: ON under SOUND

**Files:**
- Create: `app/lib/bandbeat.js`
- Modify: `app/lib/store.js`, `app/lib/net.js`, `app/App.jsx`
- Test: `tests/store.test.js`, `tests/net.test.js`

**Interfaces:**
- Consumes: the sound switch's `bandSound`, `soundRow`, `SOUND_SAY`, `flipSound` and `n.keep('sound', ...)`; `SAID_ORDER` in `app/lib/net.js`; the wristband sheet's rows and How this works.
- Produces: `beatRow(on)` → `{ icon, label, sub }` (`graphic_eq`, `BEAT: ON`, `your card pulses with the music. tap to keep it still.`; `music_off`, `BEAT: OFF`, `your card stays still, its microphone off. tap to pulse again.`), `BEAT_SAY` (`your wristband will pulse with the music.` / `your wristband will stay still.`), `BEAT_HOW` (`Your wristband pulses its colour on the beat. It hears loudness only, and records and sends nothing.`); the store's `bandBeat`, on unless kept `false`; `SAID_ORDER` with `beat` after `sound`; `n.keep('beat', { t: 'beat', on })` at every load; `flipBeat` in `App.jsx`, the row under `SOUND` and the line in How this works.

- [ ] **Step 1: Write the failing tests.** In `tests/store.test.js`: the switch is on unless the phone kept it off, beside the sound switch and apart from it; and the row, what a tap says, and the line in How this works. In `tests/net.test.js`, a page load's again copies go out in order with `beat` after `sound`.

In `tests/store.test.js`:

````diff
--- a/tests/store.test.js
+++ b/tests/store.test.js
@@ -1,7 +1,8 @@
-// ON THE BEAT — what the phone keeps across nights, and the wristband's sound switch as the phone says it.
+// ON THE BEAT — what the phone keeps across nights, and the wristband's sound and beat switches as the phone says them.
 
 import { test, beforeEach } from 'node:test';
 import assert from 'node:assert/strict';
+import { BEAT_HOW, BEAT_SAY, beatRow } from '../app/lib/bandbeat.js';
 import { SOUND_SAY, soundRow } from '../app/lib/bandsound.js';
 
 const mem = new Map();
@@ -23,3 +24,19 @@ test("the wristband sheet's row says the switch as it stands, and the phone says
   assert.deepEqual(soundRow(false), { icon: 'volume_off', label: 'SOUND: OFF', sub: 'light only. tap to hear it again.' });
   assert.deepEqual(SOUND_SAY, { on: 'your wristband will chirp again.', off: 'your wristband will only light up.' });
 });
+
+test('the beat switch is on unless the phone has kept it off, beside the sound switch and apart from it', () => {
+  assert.equal(load().bandBeat, true, 'on by default');
+  save({ ...load(), bandBeat: false });
+  assert.equal(JSON.parse(mem.get('otb:v1')).bandBeat, false);
+  assert.deepEqual([load().bandBeat, load().bandSound], [false, true]);
+  mem.set('otb:v1', JSON.stringify({ bandBeat: 0 }));
+  assert.equal(load().bandBeat, true, 'anything but false is on');
+});
+
+test("the beat switch's row, what a tap says, and the line in How this works", () => {
+  assert.deepEqual(beatRow(true), { icon: 'graphic_eq', label: 'BEAT: ON', sub: 'your card pulses with the music. tap to keep it still.' });
+  assert.deepEqual(beatRow(false), { icon: 'music_off', label: 'BEAT: OFF', sub: 'your card stays still, its microphone off. tap to pulse again.' });
+  assert.deepEqual(BEAT_SAY, { on: 'your wristband will pulse with the music.', off: 'your wristband will stay still.' });
+  assert.equal(BEAT_HOW, 'Your wristband pulses its colour on the beat. It hears loudness only, and records and sends nothing.');
+});
````

In `tests/net.test.js`:

````diff
--- a/tests/net.test.js
+++ b/tests/net.test.js
@@ -25,7 +25,7 @@ const lines = [];
 afterEach(() => { for (const n of lines.splice(0)) n.close(); });
 const open = (opts = {}) => { const n = connect({ venue: 'v', me: 'a'.repeat(32), ...opts }); lines.push(n); return n; };
 
-test('a page load queues nothing: what it holds goes out only as again copies, in order, the sound switch and then the claim first', () => {
+test('a page load queues nothing: what it holds goes out only as again copies, in order, the switches and then the claim first', () => {
   const n = open();
   n.keep('arm', { t: 'arm', intent: null, seq: 7 });
   n.keep('pick', { t: 'pick', track: 'Treasure' });
@@ -34,10 +34,11 @@ test('a page load queues nothing: what it holds goes out only as again copies, i
   n.keep('pair', { t: 'pair', band: 'b'.repeat(32), secret: 'c'.repeat(32) });
   // It touches nothing in the room, and a band claimed after a restart gets it in its first show.
   n.keep('sound', { t: 'sound', on: false });
+  n.keep('beat', { t: 'beat', on: false });
   const [sock] = FakeSocket.all;
   assert.deepEqual(sock.sent, [], 'nothing before the socket opens');
   sock.open();
-  assert.deepEqual(sock.sent.map((m) => m.t), ['join', 'sound', 'pair', 'invisible', 'profile', 'pick', 'arm']);
+  assert.deepEqual(sock.sent.map((m) => m.t), ['join', 'sound', 'beat', 'pair', 'invisible', 'profile', 'pick', 'arm']);
   assert.ok(sock.sent.slice(1).every((m) => m.again === true), 'every fact is marked again');
   assert.equal(sock.sent[0].quiet, undefined, 'a visible phone joins without quiet');
 });
````

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/store.test.js tests/net.test.js 2>&1 | grep -E "^✖|^ℹ (tests|fail)|ERR_"`

Expected: `tests/store.test.js` does not load (`ERR_MODULE_NOT_FOUND` for `app/lib/bandbeat.js`); `tests/net.test.js` 4 tests, 1 failing: a page load queues nothing, the switches and then the claim first.

- [ ] **Step 3: Implement.**

Create `app/lib/bandbeat.js`:

````diff
new file mode 100644
--- /dev/null
+++ b/app/lib/bandbeat.js
@@ -0,0 +1,18 @@
+// The wristband's beat switch, as the phone shows and says it
+// (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §1). It is the
+// person's own and outlasts the night; on, a lit card pulses on the beat and
+// the band opens its microphone only while it could; off, the card only stays
+// lit. The relay carries it to their band, and to no one else's.
+
+/** The wristband sheet's row for the switch, as it stands. */
+export function beatRow(on) {
+  return on
+    ? { icon: 'graphic_eq', label: 'BEAT: ON', sub: 'your card pulses with the music. tap to keep it still.' }
+    : { icon: 'music_off', label: 'BEAT: OFF', sub: 'your card stays still, its microphone off. tap to pulse again.' };
+}
+
+/** What the phone says once the switch is flipped, by where it now stands. */
+export const BEAT_SAY = { on: 'your wristband will pulse with the music.', off: 'your wristband will stay still.' };
+
+/** Its line in How this works: what the band does with the beat, and what it never does with the sound. */
+export const BEAT_HOW = 'Your wristband pulses its colour on the beat. It hears loudness only, and records and sends nothing.';
````

In `app/lib/store.js`:

````diff
--- a/app/lib/store.js
+++ b/app/lib/store.js
@@ -21,6 +21,7 @@ export function load() {
     contact: typeof s.contact === 'string' ? s.contact : '',
     promisesSeen: !!s.promisesSeen,
     bandSound: s.bandSound !== false,   // the wristband's sound switch: the person's own, on unless kept off
+    bandBeat: s.bandBeat !== false,     // its beat switch, the same way
     nights: s.nights && typeof s.nights === 'object' ? s.nights : {},
     kept: Array.isArray(s.kept) ? s.kept : [],
   };
````

In `app/lib/net.js`:

````diff
--- a/app/lib/net.js
+++ b/app/lib/net.js
@@ -17,11 +17,11 @@ const DEAF_MS = 6000;
 const QUEUE_MAX = 40;
 
 /**
- * The order facts are re-said in. The sound switch first: it touches nothing in the room, and a wristband
- * claimed after a restart gets it in its first show. Then the claim, so the wristband's kept hold lands
- * before anything that changes the room.
+ * The order facts are re-said in. The wristband's switches first: they touch nothing in the room, and a
+ * wristband claimed after a restart gets them in its first show. Then the claim, so the wristband's kept
+ * hold lands before anything that changes the room.
  */
-export const SAID_ORDER = ['sound', 'pair', 'invisible', 'profile', 'pick', 'arm', 'leave'];
+export const SAID_ORDER = ['sound', 'beat', 'pair', 'invisible', 'profile', 'pick', 'arm', 'leave'];
 
 export function connect({ venue, me, onView, onStatus, onMessage }) {
   let ws = null;
````

In `app/App.jsx`:

````diff
--- a/app/App.jsx
+++ b/app/App.jsx
@@ -1,5 +1,6 @@
 import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
 import { HUE, PROMISES, matchName, someone } from './copy.js';
+import { BEAT_HOW, BEAT_SAY, beatRow } from './lib/bandbeat.js';
 import { SOUND_SAY, soundRow } from './lib/bandsound.js';
 import { battery, buzz, toBase64 } from './lib/device.js';
 import { INTENT_OF, follow, nextSeq, tapMessage } from './lib/follow.js';
@@ -150,6 +151,7 @@ export default function App() {
     const st = night.state || {};
     const seq = st.seq ?? 0;
     n.keep('sound', { t: 'sound', on: s.bandSound });
+    n.keep('beat', { t: 'beat', on: s.bandBeat });
     n.keep('profile', { t: 'profile', name: s.name, contact: s.contact });
     n.keep('invisible', { t: 'invisible', on: !!st.invisible, seq });
     n.keep('arm', { t: 'arm', intent: st.armed ?? null, seq });
@@ -428,6 +430,7 @@ export default function App() {
       { icon: 'watch', label: 'Hold the face button on your wristband to go invisible. Hold its side button to come back.', fg: '#fff', onTap: () => {} },
       { icon: 'touch_app', label: 'Press the side button to see your card, and again to change it. Your phone follows.', fg: '#fff', onTap: () => {} },
       { icon: 'waving_hand', label: WAVES_HOW, fg: '#fff', onTap: () => {} },
+      { icon: 'graphic_eq', label: BEAT_HOW, fg: '#fff', onTap: () => {} },
     ],
   });
 
@@ -448,6 +451,15 @@ export default function App() {
     say(on ? SOUND_SAY.on : SOUND_SAY.off);
   };
 
+  // Its beat, the same way: whether a lit card pulses on the beat, and so whether the band may listen.
+  const flipBeat = () => {
+    const on = !s.bandBeat;
+    update((prev) => ({ ...prev, bandBeat: on }));
+    net.current?.say('beat', { t: 'beat', on });
+    setSheet(null);
+    say(on ? BEAT_SAY.on : BEAT_SAY.off);
+  };
+
   const bandSheet = () => setSheet({
     title: 'Your wristband', sub: bandLine(bandShown), close: 'Done',
     rows: [
@@ -456,6 +468,7 @@ export default function App() {
       { icon: 'flashlight_on', label: 'TEST THE LIGHT', sub: 'it flashes white for two seconds, and chirps unless its sound is off or it is in NOT NOW.', fg: '#fff',
         onTap: () => { net.current?.send({ t: 'testLight' }); setSheet(null); say('watch your wrist.'); } },
       { ...soundRow(s.bandSound), fg: '#fff', onTap: flipSound },
+      { ...beatRow(s.bandBeat), fg: '#fff', onTap: flipBeat },
       { icon: 'link_off', label: 'UNPAIR', sub: 'it forgets you, and shows new letters.', fg: 'var(--stop)', onTap: unpair },
     ],
   });
````

- [ ] **Step 4: Run** — the two files (`ℹ pass 4`, `ℹ pass 4`), then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 468`. In the built-in browser (`npm start`, CLAUDE.md's seeding): pair the stand-in `/band`, and the wristband sheet reads TEST THE LIGHT, `SOUND: ON`, `BEAT: ON`, UNPAIR; a tap says `your wristband will stay still.`, sends `{t:'beat',on:false}` and keeps `bandBeat` false in `otb:v1`; How this works has `BEAT_HOW`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "the beat switch is off unless kept on",
  "file": "app/lib/store.js",
  "from": "    bandBeat: s.bandBeat !== false,",
  "to": "    bandBeat: s.bandBeat === true,",
  "test": "tests/store.test.js",
  "expect": [
   "the beat switch is on unless the phone has kept it off"
  ]
 },
 {
  "label": "a join does not say the beat switch again",
  "file": "app/lib/net.js",
  "from": "export const SAID_ORDER = ['sound', 'beat', 'pair',",
  "to": "export const SAID_ORDER = ['sound', 'pair',",
  "test": "tests/net.test.js",
  "expect": [
   "a page load queues nothing"
  ]
 },
 {
  "label": "the beat switch is said after the claim",
  "file": "app/lib/net.js",
  "from": "export const SAID_ORDER = ['sound', 'beat', 'pair', 'invisible',",
  "to": "export const SAID_ORDER = ['sound', 'pair', 'beat', 'invisible',",
  "test": "tests/net.test.js",
  "expect": [
   "a page load queues nothing"
  ]
 }
]
````

- [ ] **Step 6: Commit, and close Stage B with P2**

```bash
git add app/App.jsx app/lib/bandbeat.js app/lib/net.js app/lib/store.js tests/net.test.js tests/store.test.js
```

````bash
git commit -F - <<'EOF'
The phone's wristband sheet gains BEAT: ON under SOUND

BEAT is the person's own switch, kept across nights beside SOUND and on
unless kept off. A tap flips it, says what the band will now do, and tells
the relay; every join says it again, after the sound switch and before the
claim, so a band claimed after a restart has it in its first show. How
this works gains a line: the wristband pulses its colour on the beat, and
it hears loudness only, and records and sends nothing.

Seen in a browser against the relay: the row under SOUND, the tap sending
{ t: 'beat', on: false } and keeping it off, and the new line.

Mutation-checked: 3 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---

## Stage C — The microphones

### Task 6: The band opens its microphone while a lit card could pulse on the beat

**Files:**
- Modify: `app/lib/beat.js`, `firmware/src/beat_logic.h`, `firmware/host/logic_test.cpp`, `firmware/src/band_logic.h` (a console accessor), `firmware/src/main.cpp`
- Test: `tests/beat-music.js`, `tests/beat.test.js`, `tests/firmware.test.js`

**Interfaces:**
- Consumes: Tasks 1–3's `Levels`, `BEAT_BLOCK_MS`, `BeatTracker`, and the wrist's `listening(now)`, `hear()` and `setMicLatency()`; in `main.cpp`, `playSounds()`, `soundDue`, `SOUND_CHANNEL`, `speaker`, `report()`, `help()`, `run()`, `setup()` and `loop()`; M5Unified's `M5.Mic` (`begin`, `end`, `record`, `isEnabled`, `setBufferReleaseCallback`) and `M5.Speaker` (`begin`, `end`, `isPlaying`).
- Produces: `BEAT_CREEP` (0.125), `BEAT_SETTLE` (16), both in `BEAT_CONSTS`; `createBlockClock()` → `{ reset(), at(arrival, lost = 0) }`, `at` returning when the block ended or null while it settles; C++ `class BlockClock { void reset(); bool at(uint32_t arrival, uint32_t lost, uint32_t& t); }`; the host binary's `clock <arrival,lost | reset> ...` → a JSON array of times and nulls; `Wrist::beatPeriod()` (0 before a lock). `tests/beat-music.js`'s `handed(blocks, ppm, from)` → `[{ end, arrival }]`, a microphone handing blocks over two at a time. On the band: the console's `beat`, and a `beat` line in `show`.

- [ ] **Step 1: Write the failing tests.** Four in `tests/beat.test.js`: blocks handed over two at a time are timed a block apart and held to the band's clock at -382, 0 and +382 ppm over ten minutes (each within 1.5 ms of when it truly ended, never after it was handed over, a block apart within 1 ms); blocks the band could not keep are counted over; 16 ms lost uncounted are caught up within 136 blocks, and no block is timed after it was handed over; and the first `BEAT_SETTLE` blocks after the microphone opens are not heard, and `reset` opens it afresh. In `tests/firmware.test.js`, the firmware times the blocks as the stand-in does, over a fast microphone, ten blocks lost and counted, two lost uncounted, and a reopening on a slow one.

In `tests/beat-music.js`:

````diff
--- a/tests/beat-music.js
+++ b/tests/beat-music.js
@@ -140,3 +140,13 @@ export function music(parts, { from = 0, seed = 1 } = {}) {
   }
   return { blocks, beats, missed };
 }
+
+/**
+ * A microphone handing its blocks over two at a time, as both bands' do, its samples running `ppm` from the band's
+ * clock (-382 on both, measured 27 Sep 2026): when each block truly ended, and the whole millisecond it was handed
+ * over, which is when the second of its pair ended.
+ */
+export function handed(blocks, ppm, from = 5000) {
+  const end = (k) => from + (k + 1) * BLOCK_MS * (1 + ppm / 1e6);
+  return Array.from({ length: blocks }, (_, k) => ({ end: end(k), arrival: Math.floor(end(k | 1)) }));
+}
````

In `tests/beat.test.js`:

````diff
--- a/tests/beat.test.js
+++ b/tests/beat.test.js
@@ -3,8 +3,8 @@
 
 import { test } from 'node:test';
 import assert from 'node:assert/strict';
-import { BEAT_BLOCK, BEAT_LOSE_MS, BEAT_RATE, createLevels, createTracker, pulseLight } from '../app/lib/beat.js';
-import { music, twoStep } from './beat-music.js';
+import { BEAT_BLOCK, BEAT_LOSE_MS, BEAT_RATE, BEAT_SETTLE, createBlockClock, createLevels, createTracker, pulseLight } from '../app/lib/beat.js';
+import { handed, music, twoStep } from './beat-music.js';
 
 /** `blocks` blocks of a sine at `hz` and amplitude `a`, as whole 16-bit samples, from sample `from`. */
 export function tone(hz, blocks, a = 8000, from = 0) {
@@ -204,3 +204,51 @@ test("a pulse is the card's full light on the beat, falling in a straight line t
   assert.equal(pulseLight(128, 0, 500), 128);
   assert.equal(pulseLight(128, 400, 500), 64);
 });
+
+test('blocks handed over two at a time are timed a block apart, and held to the band clock however the microphone runs', () => {
+  for (const ppm of [-382, 0, 382]) {
+    const clock = createBlockClock();
+    const got = handed(75000, ppm).map((b) => ({ ...b, t: clock.at(b.arrival) })); // ten minutes
+    assert.ok(got.slice(0, BEAT_SETTLE).every((b) => b.t === null), `${ppm} ppm: the first blocks settle`);
+    const heard = got.slice(BEAT_SETTLE);
+    heard.forEach((b, i) => {
+      assert.ok(Math.abs(b.t - b.end) <= 1.5, `${ppm} ppm, block ${i}: ${b.t} against ${b.end}`);
+      assert.ok(b.t <= b.arrival, `${ppm} ppm, block ${i}: timed after it was handed over`);
+      if (i) assert.ok(Math.abs(b.t - heard[i - 1].t - 8) <= 1, `${ppm} ppm, block ${i}: ${heard[i - 1].t} then ${b.t}`);
+    });
+  }
+});
+
+test('blocks the band could not keep are counted over: the time steps across them', () => {
+  const clock = createBlockClock();
+  const got = [];
+  handed(300, -382).forEach((b, k) => {
+    if (k >= 100 && k < 110) return;
+    got.push({ k, ...b, t: clock.at(b.arrival, k === 110 ? 10 : 0) });
+  });
+  const at = (k) => got.find((b) => b.k === k).t;
+  assert.ok(Math.abs(at(110) - at(99) - 88) <= 1, `${at(99)} then ${at(110)}`);
+  for (const b of got.slice(BEAT_SETTLE)) assert.ok(Math.abs(b.t - b.end) <= 1.5, `block ${b.k}: ${b.t} against ${b.end}`);
+});
+
+test('samples lost uncounted are caught up within about a second, and no block is timed after it was handed over', () => {
+  const clock = createBlockClock();
+  const got = [];
+  handed(500, 0).forEach((b, k) => {
+    if (k === 100 || k === 101) return; // 16 ms the microphone lost, and nobody counted
+    got.push({ k, ...b, t: clock.at(b.arrival) });
+  });
+  for (const b of got.slice(BEAT_SETTLE)) assert.ok(b.t <= b.arrival, `block ${b.k}: ${b.t} after ${b.arrival}`);
+  for (const b of got.filter((b) => b.k >= 102 + 136)) assert.ok(Math.abs(b.t - b.end) <= 1.5, `block ${b.k}: ${b.t} against ${b.end}`);
+});
+
+test('the first BEAT_SETTLE blocks after the microphone opens are not heard, and reset opens it afresh', () => {
+  const clock = createBlockClock();
+  const first = handed(40, 0, 5000).map((b) => clock.at(b.arrival));
+  assert.equal(first.findIndex((t) => t !== null), BEAT_SETTLE);
+  clock.reset();
+  const later = handed(40, 0, 9000); // opened again four seconds on
+  const again = later.map((b) => clock.at(b.arrival));
+  assert.equal(again.findIndex((t) => t !== null), BEAT_SETTLE);
+  assert.ok(Math.abs(again[BEAT_SETTLE] - later[BEAT_SETTLE].end) <= 1.5, `timed from the new count: ${again[BEAT_SETTLE]}`);
+});
````

In `firmware/host/logic_test.cpp`:

````diff
--- a/firmware/host/logic_test.cpp
+++ b/firmware/host/logic_test.cpp
@@ -871,7 +871,8 @@ std::string answer(const Command& c) {
         {"BEAT_TIGHT_MS", BEAT_TIGHT_MS}, {"BEAT_PULL_PHASE", BEAT_PULL_PHASE}, {"BEAT_PULL_PERIOD", BEAT_PULL_PERIOD},
         {"BEAT_CHANGE", BEAT_CHANGE}, {"BEAT_START", BEAT_START}, {"BEAT_START_OF", BEAT_START_OF},
         {"BEAT_CONFIRM", BEAT_CONFIRM}, {"BEAT_OF", BEAT_OF}, {"BEAT_HOLD", BEAT_HOLD},
-        {"BEAT_OTHER_LOOKS", BEAT_OTHER_LOOKS}, {"BEAT_LOSE_MS", BEAT_LOSE_MS}};
+        {"BEAT_OTHER_LOOKS", BEAT_OTHER_LOOKS}, {"BEAT_LOSE_MS", BEAT_LOSE_MS}, {"BEAT_CREEP", BEAT_CREEP},
+        {"BEAT_SETTLE", BEAT_SETTLE}};
     std::string out = "{";
     for (const auto& kv : all) {
       char n[64];
@@ -910,6 +911,25 @@ std::string answer(const Command& c) {
     std::snprintf(end, sizeof end, "],\"locked\":%s,\"period\":%.3f}", tracker.locked() ? "true" : "false", tracker.period());
     return out + end;
   }
+  if (c.verb == "clock") {
+    // clock <arrival,lost | reset> ...: the blocks through one BlockClock, when each ended or null while it settled.
+    std::istringstream in(c.arg);
+    BlockClock clock;
+    std::string step, out = "[";
+    while (in >> step) {
+      if (step == "reset") {
+        clock.reset();
+        continue;
+      }
+      const size_t comma = step.find(',');
+      const uint32_t arrival = static_cast<uint32_t>(std::strtoul(step.substr(0, comma).c_str(), nullptr, 10));
+      const uint32_t lost = static_cast<uint32_t>(std::strtoul(step.substr(comma + 1).c_str(), nullptr, 10));
+      uint32_t t = 0;
+      if (out.size() > 1) out += ',';
+      out += clock.at(arrival, lost, t) ? std::to_string(t) : "null";
+    }
+    return out + "]";
+  }
   if (c.verb == "battery") return batteryFrame(std::atoi(c.arg.c_str()));
   if (c.verb == "hold") return HOLD_FRAME;
   if (c.verb == "ping") return PING_FRAME;
````

In `tests/firmware.test.js`:

````diff
--- a/tests/firmware.test.js
+++ b/tests/firmware.test.js
@@ -21,8 +21,8 @@ import { createRelay, WS_PATH } from '../relay/server.js';
 import { HUE } from '../app/copy.js';
 import { codeFrom, pairUrl } from '../app/lib/pairing.js';
 import { CONSTS, FLASH_COLOURS, FLASHES, SOUNDS } from '../app/lib/wrist.js';
-import { BEAT_BLOCK, BEAT_CONSTS, BEAT_RATE, createLevels, createTracker, pulseLight } from '../app/lib/beat.js';
-import { music, twoStep } from './beat-music.js';
+import { BEAT_BLOCK, BEAT_CONSTS, BEAT_RATE, createBlockClock, createLevels, createTracker, pulseLight } from '../app/lib/beat.js';
+import { handed, music, twoStep } from './beat-music.js';
 import { TABLE, lines, check } from './wrist-table.js';
 
 const idOf = (key) => createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex').slice(0, 32);
@@ -194,6 +194,25 @@ test('the firmware follows the beat as the stand-in does: the same blocks give t
   }
 });
 
+test("the firmware times the microphone's blocks as the stand-in does", { skip }, () => {
+  // A fast microphone, ten blocks lost and counted, two lost uncounted, then opened again on a slow one.
+  const steps = [];
+  handed(6000, -382).forEach((b, k) => {
+    if ((k >= 3000 && k < 3010) || k === 4000 || k === 4001) return;
+    steps.push([b.arrival, k === 3010 ? 10 : 0]);
+  });
+  steps.push('reset');
+  for (const b of handed(3000, 382, 60000)) steps.push([b.arrival, 0]);
+  const clock = createBlockClock();
+  const want = [];
+  for (const s of steps) {
+    if (s === 'reset') clock.reset();
+    else want.push(clock.at(s[0], s[1]));
+  }
+  const band = JSON.parse(speak(['clock ' + steps.map((s) => (s === 'reset' ? s : s.join(','))).join(' ')])[0]);
+  assert.deepEqual(band, want);
+});
+
 test("the firmware hashes as node:crypto does, and its id is its key's hash", { skip }, () => {
   const inputs = ['', '616263', randomBytes(16).toString('hex'), randomBytes(55).toString('hex'), randomBytes(64).toString('hex'), randomBytes(200).toString('hex')];
   const got = speak(inputs.map((h) => 'sha256 ' + h));
````

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/beat.test.js tests/firmware.test.js 2>&1 | grep -E "^ℹ (tests|fail)|SyntaxError"`

Expected: neither file loads: `... does not provide an export named 'BEAT_SETTLE'` (beat) and `... named 'createBlockClock'` (firmware).

- [ ] **Step 3: Implement the clock.** Both bands' microphones hand blocks over two at a time, so when a block arrives is no clock; and their samples run 382 ppm fast of `millis()` (measured on the spike's recordings over the longest unbroken stretch on each band: 7.99695 ms a block, over 2,620 blocks on the StickS3), which counting alone would carry into the pulses at 23 ms a minute. So the count is snapped down to a block's arrival whenever it runs past it, and creeps later by at most `BEAT_CREEP` a block otherwise. The first `BEAT_SETTLE` blocks after opening are timed but not heard: on the spike's recordings the lowest band settled by the twelfth block, and the first also takes the snap from a pair's first block.

In `app/lib/beat.js`:

````diff
--- a/app/lib/beat.js
+++ b/app/lib/beat.js
@@ -96,13 +96,15 @@ export const BEAT_OF = 3;                 // ...of the last this many were
 export const BEAT_HOLD = 4;               // or one was, with the fold on the grid peaking this far above its mean
 export const BEAT_OTHER_LOOKS = 8;        // looks before a heard grid gives way
 export const BEAT_LOSE_MS = 4000;         // nothing heard this long, and the grid is dropped
+export const BEAT_CREEP = 0.125;          // ms a block the microphone's count may creep later, following the band's clock
+export const BEAT_SETTLE = 16;            // blocks timed but not heard once the microphone opens, while its filters settle
 
 /** Every value above, by name. */
 export const BEAT_CONSTS = {
   BEAT_ONSET, BEAT_ONSET_MIN, BEAT_WINDOW_MS, BEAT_LOOK_MS, BEAT_SHORTEST_MS, BEAT_LONGEST_MS, BEAT_PRIOR_MS,
   BEAT_PRIOR_OCT, BEAT_LOCK_CONF, BEAT_LOCK_CONTRAST, BEAT_LOCK_LOOKS, BEAT_STEADY, BEAT_PHASE_MS, BEAT_NEAR,
   BEAT_RISE, BEAT_TIGHT_MS, BEAT_PULL_PHASE, BEAT_PULL_PERIOD, BEAT_CHANGE, BEAT_START, BEAT_START_OF, BEAT_CONFIRM, BEAT_OF,
-  BEAT_HOLD, BEAT_OTHER_LOOKS, BEAT_LOSE_MS,
+  BEAT_HOLD, BEAT_OTHER_LOOKS, BEAT_LOSE_MS, BEAT_CREEP, BEAT_SETTLE,
 };
 
 const BLOCK_MS = (BEAT_BLOCK * 1000) / BEAT_RATE;
@@ -364,3 +366,40 @@ export function createTracker() {
     state: () => ({ locked, period }),
   };
 }
+
+/**
+ * When each of the microphone's blocks ended, by the band's clock (§2). The blocks are counted, a block apart, as
+ * the microphone hands them over two at a time. Its samples run 382 ppm fast of the band's clock on both bands
+ * (measured 27 Sep 2026), which counting alone would carry into the pulses at 23 ms a minute, so the count is held
+ * to the clock: a block is never timed after it was handed over, and the count creeps later by at most BEAT_CREEP
+ * a block while blocks come later than it says. Blocks the band could not keep are counted over. The first
+ * BEAT_SETTLE blocks after the microphone opens are timed but not heard: its filters are settling.
+ */
+export function createBlockClock() {
+  let base = null; // when the first block since the microphone opened was handed over
+  let off = 0; // when the last block ended, from base, in ms
+  let settle = BEAT_SETTLE;
+  return {
+    /** The microphone has opened: count afresh, and let it settle. */
+    reset() {
+      base = null;
+      settle = BEAT_SETTLE;
+    },
+    /** A block handed over at `arrival`, `lost` blocks after the last: when it ended, or null while it settles. */
+    at(arrival, lost = 0) {
+      if (base === null) {
+        base = arrival;
+        off = 0;
+      } else {
+        off += BLOCK_MS * (1 + lost);
+        const late = arrival - base - off;
+        off += late < 0 ? late : Math.min(late, BEAT_CREEP);
+      }
+      if (settle > 0) {
+        settle -= 1;
+        return null;
+      }
+      return base + Math.floor(off + 0.5);
+    },
+  };
+}
````

In `firmware/src/beat_logic.h`:

````diff
--- a/firmware/src/beat_logic.h
+++ b/firmware/src/beat_logic.h
@@ -130,6 +130,8 @@ constexpr size_t BEAT_OF = 3;                 // ...of the last this many were
 constexpr double BEAT_HOLD = 4;               // or one was, with the fold on the grid peaking this far above its mean
 constexpr int BEAT_OTHER_LOOKS = 8;           // looks before a heard grid gives way
 constexpr uint32_t BEAT_LOSE_MS = 4000;       // nothing heard this long, and the grid is dropped
+constexpr double BEAT_CREEP = 0.125;          // ms a block the microphone's count may creep later, following millis()
+constexpr uint32_t BEAT_SETTLE = 16;          // blocks timed but not heard once the microphone opens, while its filters settle
 
 constexpr double BEAT_BLOCK_MS = BEAT_BLOCK * 1000.0 / BEAT_RATE;  // one block, in ms
 
@@ -489,4 +491,44 @@ class BeatTracker {
   std::vector<BeatPulse> pulses_;
 };
 
+// When each of the microphone's blocks ended, by millis() (app/lib/beat.js createBlockClock). The blocks are
+// counted, a block apart, as the microphone hands them over two at a time. Its samples run 382 ppm fast of
+// millis() on both bands (measured 27 Sep 2026), which counting alone would carry into the pulses at 23 ms a
+// minute, so the count is held to millis(): a block is never timed after it was handed over, and the count creeps
+// later by at most BEAT_CREEP a block while blocks come later than it says. Blocks the band could not keep are
+// counted over. The first BEAT_SETTLE blocks after the microphone opens are timed but not heard.
+class BlockClock {
+ public:
+  // The microphone has opened: count afresh, and let it settle.
+  void reset() {
+    started_ = false;
+    settle_ = BEAT_SETTLE;
+  }
+
+  // A block handed over at `arrival`, `lost` blocks after the last. False while it settles; else `t` is when it ended.
+  bool at(uint32_t arrival, uint32_t lost, uint32_t& t) {
+    if (!started_) {
+      started_ = true;
+      base_ = arrival;
+      off_ = 0;
+    } else {
+      off_ += BEAT_BLOCK_MS * (1 + static_cast<double>(lost));
+      const double late = static_cast<double>(arrival - base_) - off_;
+      off_ += late < 0 ? late : std::min(late, BEAT_CREEP);
+    }
+    if (settle_ > 0) {
+      --settle_;
+      return false;
+    }
+    t = base_ + static_cast<uint32_t>(std::floor(off_ + 0.5));
+    return true;
+  }
+
+ private:
+  bool started_ = false;
+  uint32_t base_ = 0;  // when the first block since the microphone opened was handed over
+  double off_ = 0;     // when the last block ended, from base_, in ms
+  uint32_t settle_ = BEAT_SETTLE;
+};
+
 }  // namespace otb
````

- [ ] **Step 4: Run** — `tests/beat.test.js` (`ℹ pass 23`) and `tests/firmware.test.js` (`ℹ pass 122`).

- [ ] **Step 5: Write the microphone into `main.cpp`.** Each block's release callback (on the microphone's own task) copies the block into a queue of `HEARD_KEPT` (16) with its `millis()` and how many copies before it the queue could not hold, and hands the buffer straight back with `record()`; a buffer it could not hand back is handed back by the loop. `micTick()`, after `playSounds()` in the loop, opens the microphone while the wrist is listening and no sound has the channel (the speaker ended first), shuts it otherwise (the speaker begun again), and runs every queued block through `Levels` and `BlockClock` into `wrist->hear()`. `playSounds()` shuts the microphone before a sound. `setup()` sets the callback while the microphone is shut, makes the queue and sets each model's delay. The console's `beat` and `show` say whether the microphone is open, how many blocks it heard and lost, and the beat's period. In `band_logic.h`, `beatPeriod()` for the console.

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -1579,6 +1579,9 @@ class Wrist {
   /** The microphone's delay from a sound to the block that hears it, in ms: this model's. */
   void setMicLatency(double ms) { tracker_.setLatency(ms); }
 
+  /** The beat's period in ms once the band has it, and 0 before: for the console. */
+  double beatPeriod() const { return tracker_.locked() ? tracker_.period() : 0; }
+
  private:
   void heardFrame(const std::string& text, uint32_t now) {
     link_.heard(now);
````

In `firmware/src/main.cpp`:

````diff
--- a/firmware/src/main.cpp
+++ b/firmware/src/main.cpp
@@ -10,10 +10,11 @@
 //
 // Everything that decides anything is in band_logic.h, which the tests build
 // and run on a laptop. This file is only the hardware round it: the screen,
-// the speaker, the two buttons, the battery, Wi-Fi, the socket, the beacon
-// and the listen that tell the relay which bands are near, and a serial
-// console to say which Wi-Fi and which relay. The socket has a task of its
-// own, so nothing the network does can hold up the button or the screen.
+// the speaker, the microphone a lit card pulses on the beat from, the two
+// buttons, the battery, Wi-Fi, the socket, the beacon and the listen that
+// tell the relay which bands are near, and a serial console to say which
+// Wi-Fi and which relay. The socket has a task of its own, so nothing the
+// network does can hold up the button or the screen.
 //
 // Or, set so on the console, it is a marker the venue leaves at the bar or by
 // the stage, and does nothing else: it beacons its area on every channel.
@@ -88,6 +89,29 @@ uint8_t soundBuf[2][SOUND_SAMPLES];
 std::atomic<bool> soundHeld[2];         // a sound on this buffer the speaker has not let go of yet
 int soundNext = 0;                      // the buffer the next sound goes in
 std::string soundDue;                   // the newest sound not started yet
+bool speakerOn = false;                 // the speaker has the audio channel; the microphone takes it in turn
+
+// The microphone's blocks, each handed back to it from its own task the moment it is full, with a copy for the
+// loop: so the loop's pace never loses a sample, and blocks the copies could not hold are counted.
+struct Heard {
+  int16_t samples[BEAT_BLOCK];
+  uint32_t at;    // millis() when the microphone handed it over
+  uint32_t lost;  // blocks before it that the copies could not hold
+};
+constexpr size_t HEARD_KEPT = 16;         // 128 ms of blocks the loop may fall behind by
+// The microphone's delay from a sound to the block that hears it, in ms, by model (beat §2): measured at the
+// gate, from a press of the face button to the block that hears its click (§4.1). Not measured yet, so 0.
+constexpr double MIC_LATENCY_S3_MS = 0;   // the StickS3's, through its codec
+constexpr double MIC_LATENCY_PDM_MS = 0;  // the StickC Plus's and Plus2's PDM microphone
+int16_t micBuf[2][BEAT_BLOCK];
+QueueHandle_t heardBlocks = nullptr;
+volatile uint32_t micLost = 0;            // written by the microphone's task, and by the loop only while it is shut
+std::atomic<int16_t*> micStuck{nullptr};  // a buffer the microphone's task could not hand back
+bool micWorks = false;                    // this band has a microphone, and it opened whenever asked
+bool micOpen = false;
+Levels levels;                            // kept from one opening to the next: the offset it took out is still there
+BlockClock blockClock;
+uint32_t micBlocks = 0, micDropped = 0;   // since it last opened, for the console
 
 constexpr uint16_t BLACK = 0x0000;
 constexpr uint16_t WHITE = 0xFFFF;
@@ -793,6 +817,83 @@ void drawMarker(uint32_t now) {
   }
 }
 
+// ---------- the microphone ----------
+//
+// Open only while the wrist is listening (beat §2): a lit card that could
+// pulse, the beat switch on, not NOT NOW. It hears loudness only: each block
+// becomes five levels here, and nothing of the sound is kept or sent. The
+// microphone and the speaker take turns with the audio channel, as they share
+// one I2S on some bands: a sound closes the microphone for its length, and it
+// opens again once the sound is done, the beat carried across the gap. The
+// spike measured the turn at about 25 ms besides the sound.
+
+/** The speaker has the channel again, if this band has one. */
+void giveSpeaker() {
+  if (speaker && !speakerOn) speakerOn = M5.Speaker.begin();
+}
+
+/** A block is full. Runs on the microphone's own task: a copy for the loop, and the buffer straight back. */
+void micReleased(void*, void* data, size_t) {
+  static Heard h;  // not on the microphone task's own small stack
+  std::memcpy(h.samples, data, sizeof h.samples);
+  h.at = millis();
+  h.lost = micLost;
+  if (xQueueSend(heardBlocks, &h, 0) == pdTRUE) micLost = 0;
+  else micLost = micLost + 1;
+  if (!M5.Mic.record(static_cast<int16_t*>(data), BEAT_BLOCK)) micStuck = static_cast<int16_t*>(data);
+}
+
+/** Hands the channel to the microphone: the speaker off first, then two blocks' buffers queued, counted afresh. */
+void openMic() {
+  if (speakerOn) {
+    M5.Speaker.end();
+    speakerOn = false;
+  }
+  xQueueReset(heardBlocks);
+  micLost = 0;
+  micStuck = nullptr;
+  micBlocks = micDropped = 0;
+  blockClock.reset();
+  if (M5.Mic.begin() && M5.Mic.record(micBuf[0], BEAT_BLOCK, BEAT_RATE) && M5.Mic.record(micBuf[1], BEAT_BLOCK, BEAT_RATE)) {
+    micOpen = true;
+    return;
+  }
+  M5.Mic.end();
+  micWorks = false;
+  Serial.println("the microphone did not open: this band's card stays still");
+  giveSpeaker();
+}
+
+/** Takes the channel back from the microphone, for the speaker. */
+void closeMic() {
+  M5.Mic.end();
+  micOpen = false;
+  xQueueReset(heardBlocks);
+  giveSpeaker();
+}
+
+/**
+ * The microphone open while the wrist is listening and no sound has the
+ * channel, and shut otherwise; and each block it handed over, as five levels,
+ * to the wrist at the time the block ended.
+ */
+void micTick(uint32_t now) {
+  const bool want = micWorks && wrist->listening(now);
+  const bool sounding = speakerOn && (!soundDue.empty() || M5.Speaker.isPlaying(SOUND_CHANNEL));
+  if (micOpen && !want) closeMic();
+  else if (!micOpen && want && !sounding) openMic();
+  if (!micOpen) return;
+  if (int16_t* b = micStuck.exchange(nullptr)) M5.Mic.record(b, BEAT_BLOCK, BEAT_RATE);
+  static Heard h;
+  while (xQueueReceive(heardBlocks, &h, 0) == pdTRUE) {
+    const BandLevels lv = levels.block(h.samples);
+    ++micBlocks;
+    micDropped += h.lost;
+    uint32_t t = 0;
+    if (blockClock.at(h.at, h.lost, t)) wrist->hear(lv, t);
+  }
+}
+
 // ---------- sound ----------
 
 /** The speaker has finished reading a buffer, so it may be written again. Runs on the speaker's own task. */
@@ -810,7 +911,8 @@ void soundReleased(void*, const void* data, uint8_t) {
 void playSounds() {
   for (std::string& name : wrist->sounds()) soundDue = std::move(name);
   if (soundDue.empty()) return;
-  if (!speaker) {
+  if (micOpen) closeMic();  // the channel to the speaker for the sound; the microphone opens again after it
+  if (!speakerOn) {
     soundDue.clear();
     return;
   }
@@ -843,6 +945,7 @@ void help() {
       "  hold face|side          a hold, let go just after it counts\n"
       "  face                    what the screen shows now\n"
       "  sound <name>            play one of the band's sounds, e.g. sound found\n"
+      "  beat                    whether its microphone is open, what it has heard, and whether it has the beat\n"
       "  near                    what it last heard of other bands, and whether it beacons\n"
       "  near off|listen|on      stop both, stop only beaconing, or do both again\n"
       "  marker bar|stage|back   make it a marker at the bar, by the stage or out the back (it restarts)");
@@ -858,6 +961,20 @@ void helpMarker() {
       "  marker off              a wristband again (it restarts)");
 }
 
+/** The microphone and the beat, as the console says them. */
+void reportBeat() {
+  if (!micWorks) {
+    Serial.println("beat    no microphone: the card stays still");
+    return;
+  }
+  const double period = wrist->beatPeriod();
+  if (!micOpen) Serial.printf("beat    microphone shut (%s)\n", wrist->listening(millis()) ? "a sound has the speaker" : "not listening");
+  else if (period > 0) Serial.printf("beat    microphone open, %u blocks, %u lost; the beat every %.1f ms (%.1f BPM)\n",
+                                     static_cast<unsigned>(micBlocks), static_cast<unsigned>(micDropped), period, 60000 / period);
+  else Serial.printf("beat    microphone open, %u blocks, %u lost; no beat yet\n", static_cast<unsigned>(micBlocks),
+                     static_cast<unsigned>(micDropped));
+}
+
 void report() {
   Serial.printf("wi-fi   %s%s  (%s)\n", ssid.empty() ? "(none)" : ssid.c_str(), pass.empty() ? "" : ", with a password",
                 WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "not connected");
@@ -871,6 +988,7 @@ void report() {
   Serial.printf("memory  %u bytes free, %u at the least; sound %s\n", static_cast<unsigned>(ESP.getFreeHeap()),
                 static_cast<unsigned>(ESP.getMinFreeHeap()),
                 !speaker ? "none: light only" : buzzer ? "on the buzzer, octaves up" : "on the speaker");
+  reportBeat();
   // Plugged in with the battery full, what it draws is what the band uses: near on against near off.
   if (axp) {
     Serial.printf("power   %.1f mA from USB, the mean of %u readings since the last show\n", usbCount ? usbSum / usbCount : 0.0f,
@@ -933,6 +1051,8 @@ void run(const Command& c) {
     }
     if (!speaker) Serial.println("no speaker on this band");
     soundDue = name;
+  } else if (c.verb == "beat") {
+    reportBeat();
   } else if (c.verb == "near") {
     const std::string a = trim(c.arg);
     if (a == "off" || a == "listen" || a == "on") {
@@ -1023,8 +1143,10 @@ void setup() {
   // bands the two share one I2S), then full volume. The StickC Plus plays the
   // same sounds through its buzzer, powered as above, whole octaves higher.
   M5.Mic.end();
+  M5.Mic.setBufferReleaseCallback(nullptr, micReleased);  // set while it is shut, as M5Unified asks
   M5.Speaker.setBufferReleaseCallback(nullptr, soundReleased);
   speaker = M5.Speaker.begin();
+  speakerOn = speaker;
   M5.Speaker.setVolume(255);
   buzzer = speaker && M5.Speaker.config().buzzer;
 
@@ -1051,6 +1173,9 @@ void setup() {
   // A new wristband at every boot: the key lives in RAM only, and the id is its hash.
   wrist = new Wrist(makeKey([] { return static_cast<uint32_t>(esp_random()); }));
   if (airSet) wrist->setAir(airHex(air));
+  heardBlocks = xQueueCreate(HEARD_KEPT, sizeof(Heard));
+  micWorks = heardBlocks && M5.Mic.isEnabled();
+  wrist->setMicLatency(M5.getBoard() == m5::board_t::board_M5StickS3 ? MIC_LATENCY_S3_MS : MIC_LATENCY_PDM_MS);
   loadSettings();
   readBattery(millis());
   wrist->setBattery(battery, millis());
@@ -1100,6 +1225,7 @@ void loop() {
   wrist->setWifi(WiFi.status() == WL_CONNECTED);
   wrist->tick(now);
   playSounds();  // before the frames and the face: a press's tick is heard as soon as it can be
+  micTick(now);  // after the sounds, which take the channel, and before the face, which pulses on what it heard
   for (const std::string& f : wrist->take()) sendFrame(f);
   hearTick(now);
   if (wrist->up() && batteryReport.due(battery, now)) {
````

- [ ] **Step 6: Build (P3).** Expected: two `[SUCCESS]` lines, no `src/` warning; `m5stickc` RAM 22.1%, flash 40.1%; `m5sticks3` RAM 21.9%, flash 37.6%.

- [ ] **Step 7: Run** `npm test`. Expected: `ℹ fail 0`, `ℹ tests 473`.

- [ ] **Step 8: Mutation check (P1)** — expected `ALL MUTATIONS HELD`. Four of the stand-in's go red in more tests than their own, each a real consequence: without the snap, without settling or with a whole block's creep, the first block heard is timed from a pair's first arrival, eight milliseconds late.

````json
[
 {
  "label": "the count is never pulled back to the clock",
  "file": "app/lib/beat.js",
  "from": "        off += late < 0 ? late : Math.min(late, BEAT_CREEP);",
  "to": "        off += late < 0 ? 0 : Math.min(late, BEAT_CREEP);",
  "test": "tests/beat.test.js",
  "expect": [
   "blocks handed over two at a time",
   "blocks the band could not keep",
   "samples lost uncounted",
   "the first BEAT_SETTLE blocks after the microphone opens"
  ]
 },
 {
  "label": "the count never creeps later",
  "file": "app/lib/beat.js",
  "from": "        off += late < 0 ? late : Math.min(late, BEAT_CREEP);",
  "to": "        off += late < 0 ? late : 0;",
  "test": "tests/beat.test.js",
  "expect": [
   "blocks handed over two at a time",
   "samples lost uncounted"
  ]
 },
 {
  "label": "blocks lost are not counted over",
  "file": "app/lib/beat.js",
  "from": "        off += BLOCK_MS * (1 + lost);",
  "to": "        off += BLOCK_MS;",
  "test": "tests/beat.test.js",
  "expect": [
   "blocks the band could not keep"
  ]
 },
 {
  "label": "reset does not let the microphone settle again",
  "file": "app/lib/beat.js",
  "from": "      base = null;\n      settle = BEAT_SETTLE;\n",
  "to": "      base = null;\n",
  "test": "tests/beat.test.js",
  "expect": [
   "the first BEAT_SETTLE blocks after the microphone opens"
  ]
 },
 {
  "label": "reset carries the old count on",
  "file": "app/lib/beat.js",
  "from": "      base = null;\n      settle = BEAT_SETTLE;\n",
  "to": "      settle = BEAT_SETTLE;\n",
  "test": "tests/beat.test.js",
  "expect": [
   "the first BEAT_SETTLE blocks after the microphone opens"
  ]
 },
 {
  "label": "nothing settles",
  "file": "app/lib/beat.js",
  "from": "export const BEAT_SETTLE = 16; ",
  "to": "export const BEAT_SETTLE = 0; ",
  "test": "tests/beat.test.js",
  "expect": [
   "blocks handed over two at a time",
   "blocks the band could not keep",
   "the first BEAT_SETTLE blocks after the microphone opens"
  ]
 },
 {
  "label": "the count creeps a whole block",
  "file": "app/lib/beat.js",
  "from": "export const BEAT_CREEP = 0.125; ",
  "to": "export const BEAT_CREEP = 8; ",
  "test": "tests/beat.test.js",
  "expect": [
   "blocks handed over two at a time",
   "blocks the band could not keep",
   "samples lost uncounted",
   "the first BEAT_SETTLE blocks after the microphone opens"
  ]
 },
 {
  "label": "the count creeps too slowly to catch a loss up",
  "file": "app/lib/beat.js",
  "from": "export const BEAT_CREEP = 0.125; ",
  "to": "export const BEAT_CREEP = 0.01; ",
  "test": "tests/beat.test.js",
  "expect": [
   "samples lost uncounted"
  ]
 },
 {
  "label": "the firmware's count is never pulled back",
  "file": "firmware/src/beat_logic.h",
  "from": "      off_ += late < 0 ? late : std::min(late, BEAT_CREEP);",
  "to": "      off_ += late < 0 ? 0 : std::min(late, BEAT_CREEP);",
  "test": "tests/firmware.test.js",
  "expect": [
   "the firmware times the microphone's blocks as the stand-in does"
  ]
 },
 {
  "label": "the firmware does not count lost blocks over",
  "file": "firmware/src/beat_logic.h",
  "from": "      off_ += BEAT_BLOCK_MS * (1 + static_cast<double>(lost));",
  "to": "      off_ += BEAT_BLOCK_MS * (1 + 0 * static_cast<double>(lost));",
  "test": "tests/firmware.test.js",
  "expect": [
   "the firmware times the microphone's blocks as the stand-in does"
  ]
 },
 {
  "label": "the firmware's reset carries the old count on",
  "file": "firmware/src/beat_logic.h",
  "from": "    started_ = false;\n    settle_ = BEAT_SETTLE;\n",
  "to": "    settle_ = BEAT_SETTLE;\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "the firmware times the microphone's blocks as the stand-in does"
  ]
 }
]
````

- [ ] **Step 9: Commit**

```bash
git add app/lib/beat.js firmware/host/logic_test.cpp firmware/src/band_logic.h firmware/src/beat_logic.h firmware/src/main.cpp tests/beat-music.js tests/beat.test.js tests/firmware.test.js
```

````bash
git commit -F - <<'EOF'
The band opens its microphone while a lit card could pulse on the beat

main.cpp opens the microphone while the wrist is listening, turns each
block into the five levels and hands them to the wrist at the time the
block ended, and gives the audio channel to the speaker for each sound,
taking it back once the sound is done. Each block goes back to the
microphone from its own task the moment it is full, with a copy for the
loop, so the loop's pace never loses a sample; copies the loop could not
keep up with are counted. The console's `beat` (and `show`) says whether
the microphone is open, what it has heard and whether it has the beat.
Each model's microphone delay is 0 until the gate measures it.

The blocks are timed by a block clock in both twins. Both bands'
microphones hand blocks over two at a time, so the time they arrive is no
clock, and their samples run 382 ppm fast of millis() (measured on the
spike's recordings), which counting alone would carry into the pulses at
23 ms a minute. So the count is held to millis(): a block is never timed
after it was handed over, and the count creeps later by at most 0.125 ms a
block while blocks come later than it says. Blocks lost are counted over.
The first 16 blocks after the microphone opens are timed but not heard:
on the spike's recordings the lowest band settled by the twelfth.

Built for both boards: m5stickc RAM 22.1%, flash 40.1%; m5sticks3 RAM
21.9%, flash 37.6%.

Mutation-checked: 11 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 7: The stand-in gains LISTEN: the laptop's microphone as the band's own

**Files:**
- Create: `app/lib/listen.js`, `tests/listen.test.js`
- Modify: `app/screens/Band.jsx`

**Interfaces:**
- Consumes: Task 6's `createBlockClock`, Task 1's `createLevels`, `BEAT_BLOCK` and `BEAT_RATE`; the stand-in's `wrist` (`hear`, `face`), `setScreen` and the operator panel in `app/screens/Band.jsx`.
- Produces: `toSamples(floats)` → whole 16-bit numbers, held at the ends; `createEars(hear)` → `{ take(floats, arrival) }`, cutting what comes into blocks, five levels each, timed by the block clock and handed to `hear(levels, t)`; `openMicrophone(take, { media, make, worklet, now })` → a promise of a function that shuts it: a context at `BEAT_RATE`, the microphone with echo cancelling, noise suppression and gain control off, an `AudioWorklet` sending each 128 samples to `take(floats, now())`, nothing left open if any of it fails. In `Band.jsx`: `LISTEN_SAY` (`off`, `asking`, `on`, `failed`) and a `LISTEN` button beside it, off by default; the browser is asked only on the tap that turns it on; while on, the face is drawn every frame.

- [ ] **Step 1: Write the failing tests.** Four in `tests/listen.test.js`: a browser's samples become the band's; the ears cut what comes in odd handfuls into blocks, and hand each its five levels at the block clock's time; `LISTEN` opens the microphone at the band's rate with nothing of the browser shaping it, every block goes on, and shutting it stops the browser's use of the microphone and every block after; and a refused microphone leaves nothing open.

Create `tests/listen.test.js`:

````diff
new file mode 100644
--- /dev/null
+++ b/tests/listen.test.js
@@ -0,0 +1,107 @@
+// ON THE BEAT — the stand-in's LISTEN (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §3): the laptop's
+// microphone, taken as the band takes its own. A fake browser stands in for the real one's microphone and audio.
+
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import { BEAT_BLOCK, BEAT_RATE, BEAT_SETTLE, createBlockClock, createLevels } from '../app/lib/beat.js';
+import { createEars, openMicrophone, toSamples } from '../app/lib/listen.js';
+
+test("a browser's samples become the band's: whole 16-bit numbers, held at the ends", () => {
+  assert.deepEqual(toSamples([0, 0.5, -0.5, 1, -1, 1.5, -1.5, 0.00002]), [0, 16384, -16384, 32767, -32768, 32767, -32768, 1]);
+});
+
+test('the ears cut what comes into blocks, and hand each its five levels at the time the block clock gives it', () => {
+  const floats = Array.from({ length: 40 * BEAT_BLOCK }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / BEAT_RATE));
+  const sizes = [100, 156, 384, 50, 78, 640, 128, 256, 1];
+  const chunks = [];
+  for (let at = 0, k = 0, t = 7000; at < floats.length; k += 1, t += 8) {
+    const n = sizes[k % sizes.length];
+    chunks.push({ floats: floats.slice(at, at + n), arrival: t });
+    at += n;
+  }
+  const got = [];
+  const ears = createEars((levels, t) => got.push({ levels, t }));
+  for (const c of chunks) ears.take(c.floats, c.arrival);
+
+  // The same blocks through the band's own pieces, each timed at the arrival of the chunk it was completed in.
+  const samples = toSamples(floats);
+  const levels = createLevels();
+  const clock = createBlockClock();
+  const want = [];
+  let end = 0;
+  for (const c of chunks) {
+    end += c.floats.length;
+    while (want.length < Math.floor(end / BEAT_BLOCK)) {
+      const b = want.length;
+      want.push({ levels: levels.block(samples.slice(b * BEAT_BLOCK, (b + 1) * BEAT_BLOCK)), t: clock.at(c.arrival) });
+    }
+  }
+  assert.equal(want.length, 40);
+  assert.deepEqual(got, want.filter((w) => w.t !== null));
+  assert.equal(got.length, 40 - BEAT_SETTLE);
+});
+
+/** A browser with a microphone and Web Audio that remembers what it was asked. `fail` rejects the microphone. */
+function fakeBrowser({ fail = false } = {}) {
+  const b = { asked: [], stopped: 0, made: [], nodes: [], modules: [] };
+  const track = { stop: () => { b.stopped += 1; } };
+  b.media = () => ({
+    getUserMedia: (c) => {
+      b.asked.push(c);
+      return fail ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve({ getTracks: () => [track] });
+    },
+  });
+  b.make = (options) => {
+    const ctx = {
+      options, state: 'suspended', closed: false, destination: { name: 'destination' },
+      audioWorklet: { addModule: (url) => { b.modules.push(url); return Promise.resolve(); } },
+      resume() { ctx.state = 'running'; return Promise.resolve(); },
+      close() { ctx.closed = true; return Promise.resolve(); },
+      createMediaStreamSource: (stream) => ({ stream, to: [], connect(n) { this.to.push(n); }, disconnect() { this.to = []; } }),
+    };
+    ctx.source = null;
+    const make = ctx.createMediaStreamSource;
+    ctx.createMediaStreamSource = (s) => (ctx.source = make(s));
+    b.made.push(ctx);
+    return ctx;
+  };
+  b.worklet = (ctx, name) => {
+    const node = { ctx, name, to: [], port: { onmessage: null }, connect(n) { this.to.push(n); }, disconnect() { this.to = []; } };
+    b.nodes.push(node);
+    return node;
+  };
+  return b;
+}
+
+test('LISTEN opens the microphone at the band rate, with nothing of the browser shaping it, and every block goes on', async () => {
+  const b = fakeBrowser();
+  const heard = [];
+  let now = 5000;
+  const close = await openMicrophone((floats, at) => heard.push([floats, at]), { media: b.media, make: b.make, worklet: b.worklet, now: () => now });
+  assert.deepEqual(b.asked, [{ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false }]);
+  const [ctx] = b.made;
+  assert.deepEqual(ctx.options, { sampleRate: BEAT_RATE });
+  assert.equal(ctx.state, 'running');
+  assert.equal(b.modules.length, 1);
+  const [node] = b.nodes;
+  assert.equal(ctx.source.to[0], node, 'the microphone into the node');
+  assert.equal(node.to[0], ctx.destination, 'the node pulled by the output, which it leaves silent');
+  const block = new Float32Array(BEAT_BLOCK).fill(0.25);
+  node.port.onmessage({ data: block });
+  now = 5008;
+  node.port.onmessage({ data: block });
+  assert.deepEqual(heard.map(([f, at]) => [f.length, at]), [[BEAT_BLOCK, 5000], [BEAT_BLOCK, 5008]]);
+
+  close();
+  assert.equal(b.stopped, 1, 'the browser stops using the microphone');
+  assert.equal(ctx.closed, true);
+  node.port.onmessage?.({ data: block });
+  assert.equal(heard.length, 2, 'nothing after it is closed');
+});
+
+test('LISTEN that the browser is refused the microphone for leaves nothing open', async () => {
+  const b = fakeBrowser({ fail: true });
+  await assert.rejects(openMicrophone(() => {}, { media: b.media, make: b.make, worklet: b.worklet }), /NotAllowedError/);
+  assert.equal(b.made[0].closed, true);
+  assert.equal(b.nodes.length, 0);
+});
````

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/listen.test.js 2>&1 | grep -E "^ℹ (tests|fail)|ERR_"`

Expected: the file does not load: `ERR_MODULE_NOT_FOUND` for `app/lib/listen.js`.

- [ ] **Step 3: Implement.**

Create `app/lib/listen.js`:

````diff
new file mode 100644
--- /dev/null
+++ b/app/lib/listen.js
@@ -0,0 +1,92 @@
+// The stand-in's LISTEN (/band): the laptop's microphone, taken as the band
+// takes its own (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §3),
+// for a demo. Off by default, and the browser is asked for the microphone
+// only when it is turned on. What it hears becomes the band's five levels
+// here, block by block, and goes to the wrist: nothing of the sound is kept
+// or sent.
+//
+// The audio runs at the band's own rate, where the browser hands over 128
+// samples at a time: one block. They come to the page when it gets round to
+// them, so the block clock times them, as the band's does.
+
+import { BEAT_BLOCK, BEAT_RATE, createBlockClock, createLevels } from './beat.js';
+
+const NODE = 'otb-blocks';
+
+// Runs on the browser's audio thread: each 128 samples heard, sent on to the page as they are.
+const WORKLET = `registerProcessor('${NODE}', class extends AudioWorkletProcessor {
+  process(inputs) {
+    const heard = inputs[0] && inputs[0][0];
+    if (heard) this.port.postMessage(heard.slice(0));
+    return true;
+  }
+});`;
+
+/** Samples as a browser has them, -1 to 1, as the band's microphone gives them: whole 16-bit numbers. */
+export function toSamples(floats) {
+  return Array.from(floats, (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32768))));
+}
+
+/**
+ * The band's ears, for the stand-in: samples in as they come, cut into blocks, and each block's five levels handed
+ * to `hear(levels, t)` at the time the block clock gives it. Blocks that come together are timed a block apart.
+ */
+export function createEars(hear) {
+  const levels = createLevels();
+  const clock = createBlockClock();
+  let carry = [];
+  return {
+    /** Samples as the browser has them, come to the page at `arrival`. */
+    take(floats, arrival) {
+      carry = carry.concat(toSamples(floats));
+      while (carry.length >= BEAT_BLOCK) {
+        const lv = levels.block(carry.slice(0, BEAT_BLOCK));
+        carry = carry.slice(BEAT_BLOCK);
+        const t = clock.at(arrival);
+        if (t !== null) hear(lv, t);
+      }
+    },
+  };
+}
+
+/**
+ * Opens the laptop's microphone at the band's rate, with nothing of the browser's shaping (no echo cancelling, no
+ * noise suppression, no gain control: they would flatten the very rises the band listens for), and hands every
+ * block to `take(floats, arrival)`. Resolves to a function that shuts it; if anything fails, nothing is left open.
+ * Call it from a tap, which lets its audio run. `media`, `make`, `worklet` and `now` are for the tests.
+ */
+export async function openMicrophone(take, {
+  media = () => navigator.mediaDevices,
+  make = (options) => new AudioContext(options),
+  worklet = (ctx, name) => new AudioWorkletNode(ctx, name),
+  now = () => Date.now(),
+} = {}) {
+  const ctx = make({ sampleRate: BEAT_RATE });
+  let stream = null;
+  try {
+    stream = await media().getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
+    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
+    try {
+      await ctx.audioWorklet.addModule(url);
+    } finally {
+      URL.revokeObjectURL(url);
+    }
+    const source = ctx.createMediaStreamSource(stream);
+    const node = worklet(ctx, NODE);
+    node.port.onmessage = (e) => take(e.data, now());
+    source.connect(node);
+    node.connect(ctx.destination); // pulled by the output, which it leaves silent
+    await ctx.resume();
+    return () => {
+      node.port.onmessage = null;
+      source.disconnect();
+      node.disconnect();
+      for (const t of stream.getTracks()) t.stop();
+      ctx.close();
+    };
+  } catch (e) {
+    for (const t of stream?.getTracks() || []) t.stop();
+    ctx.close();
+    throw e;
+  }
+}
````

In `app/screens/Band.jsx`:

````diff
--- a/app/screens/Band.jsx
+++ b/app/screens/Band.jsx
@@ -6,6 +6,7 @@ import { qrMatrix, qrPath } from '../lib/qr.js';
 import { toHex } from '../lib/sha256.js';
 import { createSpeaker } from '../lib/speaker.js';
 import { FLASH_COLOURS, HOLD_MS, WAKE_MS, createWrist } from '../lib/wrist.js';
+import { createEars, openMicrophone } from '../lib/listen.js';
 import { Back, Ghost, Icon } from '../ui.jsx';
 
 /**
@@ -155,11 +156,21 @@ export const bandLine = (band) => (band
   ? (band.offline ? 'OFFLINE — away for a while' : [band.battery != null ? band.battery + '% battery' : null, band.live ? null : 'not connected right now'].filter(Boolean).join(' · '))
   : '');
 
+/** What the stand-in says beside LISTEN, by where it stands. */
+export const LISTEN_SAY = {
+  off: "For a demo: this computer's microphone as the band's, so a lit card pulses on the beat. Off, it pulses nothing.",
+  asking: 'Asking this browser for the microphone…',
+  on: 'Listening: a lit card pulses on the beat. It hears loudness only, and keeps and sends nothing.',
+  failed: "The microphone did not open: this browser refused it, or cannot listen at the band's 16 kHz.",
+};
+
 /**
  * /band — a stand-in for the wristband, until one is in hand. The machine is
  * app/lib/wrist.js, the same one band_logic.h runs on the real band and held
  * to the same table; this page only feeds it the socket, the two buttons and
  * the time, draws its face at 2x, and plays its sounds (app/lib/speaker.js).
+ * LISTEN, off until turned on, feeds it this computer's microphone as the
+ * band's own (app/lib/listen.js), so a lit card pulses on the beat.
  */
 export function BandStandIn() {
   // A new wristband every load, as the firmware is every boot: the key stays in this page, and the id is its hash.
@@ -173,8 +184,11 @@ export function BandStandIn() {
   const [live, setLive] = useState(false);
   const [heard, setHeard] = useState(false);
   const [down, setDown] = useState({ 1: false, 2: false });
+  const [listen, setListen] = useState('off'); // off, asking, on, or failed
   const ws = useRef(null);
   const flushRef = useRef(() => {});
+  const mic = useRef(null); // shuts the microphone
+  const asking = useRef(null); // the ask in flight: a newer tap makes it stale
 
   // A browser lets a page sound only after a tap: the first one anywhere on it lets the band chirp.
   useEffect(() => {
@@ -226,6 +240,42 @@ export function BandStandIn() {
     if (ws.current?.readyState === 1) ws.current.send(JSON.stringify({ t: 'battery', level: battery }));
   }, [wrist, battery]);
 
+  // LISTEN: the browser is asked for the microphone only on the tap that turns it on, and a second tap shuts it,
+  // or forgets an ask still in flight.
+  const flipListen = async () => {
+    if (mic.current || asking.current) {
+      mic.current?.();
+      mic.current = null;
+      asking.current = null;
+      setListen('off');
+      return;
+    }
+    const ask = {};
+    asking.current = ask;
+    setListen('asking');
+    const ears = createEars((levels, t) => wrist.hear(levels, t));
+    try {
+      const shut = await openMicrophone((floats, at) => ears.take(floats, at));
+      if (asking.current !== ask) { shut(); return; }
+      mic.current = shut;
+      setListen('on');
+    } catch {
+      if (asking.current === ask) setListen('failed');
+    } finally {
+      if (asking.current === ask) asking.current = null;
+    }
+  };
+  useEffect(() => () => { mic.current?.(); mic.current = null; asking.current = null; }, []);
+  // Listening, the face is drawn every frame, so a pulse falls smoothly rather than in the beat's 50 ms steps.
+  useEffect(() => {
+    if (listen !== 'on') return undefined;
+    let frame = requestAnimationFrame(function draw() {
+      setScreen(wrist.face(Date.now()));
+      frame = requestAnimationFrame(draw);
+    });
+    return () => cancelAnimationFrame(frame);
+  }, [listen, wrist]);
+
   const key = (k, isDown) => {
     (isDown ? wrist.keyDown : wrist.keyUp)(k, Date.now());
     setDown((d) => ({ ...d, [k]: isDown }));
@@ -269,6 +319,12 @@ export function BandStandIn() {
           {heard ? 'It chirps as the band does, unless its sound is off or it is in NOT NOW.'
             : 'Silent until this page is tapped: a browser lets a page make sound only after a tap.'}
         </span>
+        <span className="small" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
+          <button type="button" className="btn-s" onClick={flipListen} aria-pressed={listen === 'on'}>
+            {listen === 'on' ? 'LISTEN: ON' : listen === 'asking' ? 'LISTEN: ASKING…' : 'LISTEN: OFF'}
+          </button>
+          <span role="status">{LISTEN_SAY[listen]}</span>
+        </span>
         <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
           battery <input type="range" min="1" max="100" value={battery} onChange={(e) => setBattery(Number(e.target.value))} aria-label="Stand-in battery" />
           <span className="tnum" style={{ color: '#fff', minWidth: 36 }}>{battery}%</span>
````

- [ ] **Step 4: Run** — the file (`ℹ pass 4`), then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 477`. `tests/copy.test.js` reads the new comments for the one-button wristband's words: a comment saying "its button" fails it.

- [ ] **Step 5: See it in the browser.** `npm start`; seed a phone as CLAUDE.md says, with `bandSound: false` so the stand-in makes no sound; pair `/band` by its letters and the check; arm SAY HI; press SIDE and wait for `HI :)` over `BLUE MEANS HELLO`. In `/band`, before pressing `LISTEN`, replace `navigator.mediaDevices.getUserMedia` with one that returns a `MediaStreamDestination` fed by a looped 500 ms buffer of a made-up kick (an 80 Hz sine and a burst of noise, both decaying) and connected to nothing audible. Press `LISTEN` and read the face's `filter: brightness(...)` every 25 ms. Measured: asked with the three shapers off; `LISTEN: ON`; pulses from 4.4 s on, 500 ms apart, 1 falling in a straight line to 0.502 by about 333 ms and held there; `LISTEN` off, and the light is steady at 1 within a beat.

- [ ] **Step 6: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "a browser's samples are not held at the ends",
  "file": "app/lib/listen.js",
  "from": "Math.max(-32768, Math.min(32767, Math.round(x * 32768)))",
  "to": "Math.round(x * 32768)",
  "test": "tests/listen.test.js",
  "expect": [
   "a browser's samples become the band's"
  ]
 },
 {
  "label": "the ears time blocks by when they came, not by the block clock",
  "file": "app/lib/listen.js",
  "from": "        if (t !== null) hear(lv, t);",
  "to": "        if (t !== null) hear(lv, arrival);",
  "test": "tests/listen.test.js",
  "expect": [
   "the ears cut what comes into blocks"
  ]
 },
 {
  "label": "the ears drop what is left over from each handful",
  "file": "app/lib/listen.js",
  "from": "      carry = carry.concat(toSamples(floats));",
  "to": "      carry = toSamples(floats);",
  "test": "tests/listen.test.js",
  "expect": [
   "the ears cut what comes into blocks"
  ]
 },
 {
  "label": "the browser cancels echoes in what the band hears",
  "file": "app/lib/listen.js",
  "from": "audio: { echoCancellation: false, noiseSuppression: false",
  "to": "audio: { echoCancellation: true, noiseSuppression: false",
  "test": "tests/listen.test.js",
  "expect": [
   "LISTEN opens the microphone at the band rate"
  ]
 },
 {
  "label": "the audio runs at the browser's own rate",
  "file": "app/lib/listen.js",
  "from": "  const ctx = make({ sampleRate: BEAT_RATE });",
  "to": "  const ctx = make({});",
  "test": "tests/listen.test.js",
  "expect": [
   "LISTEN opens the microphone at the band rate"
  ]
 },
 {
  "label": "shutting LISTEN leaves the browser using the microphone",
  "file": "app/lib/listen.js",
  "from": "      for (const t of stream.getTracks()) t.stop();\n      ctx.close();\n    };",
  "to": "      ctx.close();\n    };",
  "test": "tests/listen.test.js",
  "expect": [
   "LISTEN opens the microphone at the band rate"
  ]
 },
 {
  "label": "blocks still go on after LISTEN is shut",
  "file": "app/lib/listen.js",
  "from": "      node.port.onmessage = null;\n",
  "to": "",
  "test": "tests/listen.test.js",
  "expect": [
   "LISTEN opens the microphone at the band rate"
  ]
 },
 {
  "label": "a refused microphone leaves the audio open",
  "file": "app/lib/listen.js",
  "from": "    for (const t of stream?.getTracks() || []) t.stop();\n    ctx.close();\n    throw e;",
  "to": "    for (const t of stream?.getTracks() || []) t.stop();\n    throw e;",
  "test": "tests/listen.test.js",
  "expect": [
   "LISTEN that the browser is refused the microphone for"
  ]
 }
]
````

- [ ] **Step 7: Commit, and close Stage C with P2**

```bash
git add app/lib/listen.js app/screens/Band.jsx tests/listen.test.js
```

````bash
git commit -F - <<'EOF'
The stand-in gains LISTEN: the laptop's microphone as the band's own

/band has a LISTEN switch, off by default. Turned on, it asks the browser
for the microphone, at the band's 16 kHz and with none of the browser's
echo cancelling, noise suppression or gain control, which would flatten
the rises the band listens for. What it hears goes through the band's own
pieces (app/lib/listen.js): cut into 128-sample blocks, five levels each,
timed by the block clock and handed to the wrist. So a lit card on the
stand-in pulses on the beat, and the face is drawn every frame while it
listens. Turned off, the browser stops using the microphone and the card
pulses nothing more. Nothing of the sound is kept or sent.

Checked in the browser with a made-up 120 BPM kick in place of the
microphone: the card pulsed from 4.4 s on, 500 ms apart, full to half over
the first two thirds of each beat, and was steady within a beat of LISTEN
going off.

Mutation-checked: 8 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---

## Stage D — Docs and the gate

### Task 8: The README says a lit card pulses on the beat, hearing loudness only

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-09-25-wrist-reactions-design.md`

- [ ] **Step 1: Write the README.** The wristband section gains *A lit card pulses on the beat* and *It hears loudness only*; the firmware section *The microphone and the speaker take turns*, with the block clock; *Where this differs from the canvas* gains the pulse; *What is not done* loses "Flashing on the music's beat is a later spec" and gains *The beat has not been heard on the real bands*, with what the made-up music shows. The reactions spec's line for C points at the beat's spec.

````diff
--- a/README.md
+++ b/README.md
@@ -303,6 +303,28 @@ that was taken.
   every reconnect, and the relay carries it on the shows to that person's
   band and to no other. A band nobody has claimed chirps as it is, and a
   claimed band has the switch in its first show.
+- **A lit card pulses on the beat.** While a card is lit at rest — `HI :)`,
+  `FIRST SONG?` or `LET'S DANCE!`, never a meeting number, the letters, the
+  check, the test light or NOT NOW — the band listens to the room, and once
+  it has the beat the card's light is full on each beat and falls in a
+  straight line to half over the first two thirds of it. The colour never
+  goes dark, and every reaction goes first. It finds the beat in whatever
+  part of the sound carries it, since laptop speakers and a venue's echo
+  both lose the kick: each block's five levels, how far each rose, a tempo
+  read every 128 ms by autocorrelation between 80 and 178 BPM, weighted
+  towards 120, and a grid that pulses once four of its last five beats were
+  heard. In doubt the card stays steady: a song that stops goes quiet within
+  two beats, another song takes over the grid, and a missed kick or a
+  reaction's gap does not stop it. The phone's wristband sheet has
+  `BEAT: ON` under `SOUND: ON`, the person's own in the same way; off, the
+  band never opens its microphone. It is on by default.
+- **It hears loudness only.** Each 8 ms of sound becomes five levels on the
+  band, one for each band of pitch, and it keeps only how far they rose, one
+  number a block, for six seconds. Nothing of the sound is recorded, and
+  nothing it hears is sent: the relay only carries the switch. The
+  microphone is open only while a lit card could pulse and the switch is on.
+  `/band`'s `LISTEN` does the same with the laptop's microphone, for a demo;
+  it is off until turned on, and only then asks the browser for it.
 - **Letters go dark after two minutes.** An unclaimed band's letters and QR,
   and the face of one waiting for its owner after a restart, light for two
   minutes and then only the backlight goes off; a press lights them again.
@@ -442,6 +464,22 @@ the relay reaches it.
   M5StickC has no speaker; it says so once on the console and only lights up.
   The Plus has no PSRAM, and the buffers take its static RAM from 51 KB to
   70 KB of 320 KB; `show` prints the free heap.
+- **The microphone and the speaker take turns.** `main.cpp` opens the
+  microphone only while the wrist says it is listening, and each full block
+  goes straight back to M5Unified from the microphone's own task, with a
+  copy for the loop, so the loop's pace never loses a sample. A sound
+  closes it for the sound's length, and it opens again after; the spike
+  measured the turn at about 25 ms besides the sound. Both bands hand their
+  blocks over two at a time, and their samples run 382 ppm fast of
+  `millis()`, which counting alone would carry into the pulses at 23 ms a
+  minute. So a block clock counts them, held to `millis()` (`BlockClock`,
+  in `beat_logic.h`): a block is never timed after it was handed over, the
+  count creeps later by at most 0.125 ms a block, blocks lost are counted
+  over, and the first 16 after it opens are not heard while its filters
+  settle. The levels, the tracker and the clock are twins of
+  `app/lib/beat.js`, held equal to the bit by `tests/firmware.test.js`.
+  `beat` on the console says whether the microphone is open, what it has
+  heard and whether it has the beat; `face` shows the light moving.
 - **A change of light alone only turns the backlight.** A flash's dark steps
   and the meeting's blink never repaint the face, so a call that blinks for
   fifteen minutes never holds up the loop or misses a tap.
@@ -549,6 +587,12 @@ the relay reaches it.
   S5's own limit of five. People without a band cannot be heard, which says
   nothing about where they are, so they are listed as before; the owner chose
   that on 26 Sep 2026.
+- **A lit card pulses on the beat.** Revision 6 §8 rules out light patterns
+  that pretend to carry a message, and says nothing about music. The owner
+  chose on 25 Sep 2026 that a lit card pulses with what everyone in the room
+  can hear, and on 27 Sep that it is on by default, with `BEAT: ON` on the
+  phone to keep it still. The pulse carries no message: it says nothing
+  about the wearer or anyone else, and is off whenever the card is.
 - **A marker names an area only when it is heard clearly.** Revision 6 takes
   the loudest marker. Far from every marker the loudest is still some marker,
   heard faintly across the room, so it names a band only at -56 dBm or
@@ -769,7 +813,8 @@ relay could drive what a wrist shows.
   USB in, the Plus held 100% for 50 minutes, most of them on the Wi-Fi,
   where the StickS3 in the same state ran down. How each sound lands on a
   wrist, and each colour, and the words whole on a real screen, still need
-  someone there. Flashing on the music's beat is a later spec.
+  someone there. A lit card pulsing on the music's beat has its own entry
+  below.
 - **The scanner has read a code through Chrome's fake camera, not a phone's.**
   Headless Chrome played a picture of a wristband's code as its camera; the
   app's scanner read it through jsQR and paired, and a stranger's code was
@@ -804,6 +849,23 @@ relay could drive what a wrist shows.
   need someone there. Saying it by bumping two wristbands together, with the
   motion sensor, is a later change, after a spike shows a fist bump can be
   told apart from two people dancing to the same beat.
+- **The beat has not been heard on the real bands.** The tests hold the
+  tracker and its block clock equal to the bit between the twins, and to
+  made-up music: kicks at 90, 120 and 160 BPM, a hi-hat, a held chord,
+  noise, made-up speech, random kicks, missed kicks and gaps. The stand-in's
+  `LISTEN` pulsed on a made-up 120 BPM kick in a browser, 500 ms apart, and
+  was steady within a beat of being turned off. On the bands it has only
+  been built, for both boards. Its gate is owed (the spec's §4.1): round 3 of
+  the spike on both bands beside the laptop at round 2's volume, and each
+  model's microphone delay, 0 until then, measured there from presses of
+  the face button. It reaches `main` only once that passes. What the made-up
+  music already shows: made-up speech and random kicks still pulse, in short
+  bursts, 4 to 24 pulses in each 800 s of them; a held chord flickers by
+  about ±3 dB a block, which can count as a rise; and a hi-hat over a quiet
+  room never locks. On the Plus the backlight has only eleven levels, set through its
+  power chip, so a pulse falls in a few visible steps; and each turn to the
+  microphone ends and begins the speaker, which may be heard as a click.
+  Both are for eyes and ears on the bands.
 - **The timings are guesses until worn** — six seconds awake, 1.5 s holds,
   three to send, ten to wait. They are named constants for that reason.
 - **Recording has run on Chrome's fake camera, not a phone's.** Headless
````

````diff
--- a/docs/superpowers/specs/2026-09-25-wrist-reactions-design.md
+++ b/docs/superpowers/specs/2026-09-25-wrist-reactions-design.md
@@ -44,7 +44,8 @@ makes none at all.
 
 ## Not in this spec
 
-- **C, the beat.** A second phase, with its own spec.
+- **C, the beat.** A second phase, with its own spec:
+  `2026-09-26-wrist-beat-design.md`.
 - **A wave on the band.** The owner wants a wave sent from a phone to reach
   the other person's band, and to be answered there. That is the next spec,
   designed right after this one and built on its call. Here the meeting
````

- [ ] **Step 2: Run** `npm test` (`tests/copy.test.js` reads the README). Expected: `ℹ fail 0`, `ℹ tests 477`.

- [ ] **Step 3: Commit, and close Stage D's first half with P2**

```bash
git add README.md docs/superpowers/specs/2026-09-25-wrist-reactions-design.md
```

````bash
git commit -F - <<'EOF'
README: a lit card pulses on the beat, hearing loudness only

The wristband section gains the pulse and the BEAT switch, and what the
microphone keeps: one number a block, how far the sound rose, for six
seconds, and nothing sent. The firmware section gains the microphone's
turns with the speaker and the block clock. "Where this differs from the
canvas" gains the pulse, and "What is not done" says the beat has not been
heard on the real bands: its gate is owed, and what the made-up music
already shows. The reactions spec's line for C points at the beat's spec.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 9: The gate on the real bands, with the owner; then `main`

Nothing here is automated, and every step needs the owner: flashing needs his yes first, the test tracks play through the laptop's speaker, and the bands are his. The gate is the spec's §4.1; if it fails, nothing is merged, and the owner decides between the loudness fallback and stopping.

The round-3 kit is the spike's, outside every repository: its firmware and scripts in `C:\Users\LewisDong\Documents\on-the-beat-spike` (moved out of Temp on the owner's word, 28 Sep 2026): `spike_run3.py` plays the tracks and records both bands' streams, `gate3.mjs` scores them, and `tracker-build.mjs` gives it this build's tracker from the `beat-build` worktree's `app/lib/beat.js`.

**Expect a close result.** Scored on the made-up round 3 (`fake3.jsonl`: both bands hearing the files through the spike's model of a laptop speaker), the spike's tracker and this build's both miss two of the gate's lines: the crowd on the StickS3 locks after 6.1 s (the gate asks 4), and the medley's change to 128 BPM leaves three pulses off the beat on the Plus (the gate allows two). Everything else passes there: silence, speech and the presses pulse nothing; the pop mix, the crowd and the drift pulse 100% of their beats once locked; the own song's pulses fall 58 of 58 within 40 ms across the bands. It is a model of a speaker, not a room: only round 3 decides.

- [ ] **Step 1: Flash the spike to both bands**, after asking: its own `platformio.ini`, a short build directory (`PLATFORMIO_BUILD_DIR=/c/Users/LEWISD~1/AppData/Local/Temp/spikebuild`), `-t upload --upload-port COM8` for the StickS3 and `COM9` for the Plus.
- [ ] **Step 2: Round 3.** The owner sets the laptop's volume to 60% (round 2's) and puts both bands beside its speaker. `python spike_run3.py run3.jsonl --own 60`; he presses each band's face five times in the first 20 s, and at about +267 s plays a song of his choosing from his phone for 60 s.
- [ ] **Step 3: Score it.** `TRACKER=tracker-build.mjs node gate3.mjs run3.jsonl`. It passes if, on both bands, the pop mix, the crowd and the drift lock within 4 s and then pulse at least 90% of their beats within 40 ms; the medley's change to 128 BPM relocks within 4 s with at most two pulses off the beat; silence and speech pulse nothing; and in the owner's song, once both are locked, at least 90% of one band's pulses fall within 40 ms of the other's. The half-time section and the breakdown are recorded, not judged. Each band's press delays (`click heard 5/5, delays ..., median N`) are its model's `MIC_LATENCY_*_MS`.
- [ ] **Step 4: If it fails,** stop: flash the release firmware back (P3 on `main`, `-t upload`), tell the owner which lines failed and by how much, and let him choose between the loudness fallback and stopping. Nothing is merged.
- [ ] **Step 5: If it passes,** set `MIC_LATENCY_S3_MS` and `MIC_LATENCY_PDM_MS` in `main.cpp` to the measured medians, rewrite README's *The beat has not been heard on the real bands* with what round 3 showed, and commit both on `beat-build` (`npm test` green).
- [ ] **Step 6: The build on the bands** (spec §4.6), after asking: flash `beat-build` to both (P3, `-t upload`). Pair each to a stand-in phone with a card armed and SOUND off unless the owner is listening. With music playing, read `face` on each console every 25 ms: the light at its peak within 40 ms of each beat. `BEAT: OFF` on the phone and nothing pulses, and `beat` says the microphone is shut. A reaction during the music (TEST THE LIGHT, a wave) plays, and the pulse comes back after it. `show` on the Plus with Wi-Fi, TLS and the microphone on: its free heap and the least it has been; and, plugged in with the battery full, its `power` line with a card lit and the switch on, against the same with it off (the spec's *Battery* risk). Listen for a click at each turn from the speaker to the microphone, and watch the Plus's pulse, which its backlight's eleven levels make fall in steps. Record each in README.
- [ ] **Step 7: Bring the build onto `main`** task by task: `git cherry-pick` each `beat-build` commit in order onto `main`, `npm test` after each, then P2 on `main` (`git push origin main`), which CI builds for both boards. Deploy the relay to Fly (the owner logs in himself; not while he has said a demo is on).
- [ ] **Step 8: Leave the bands as found** (test personas memory): on the release firmware from `main`, unpaired from every stand-in, and say what state each band is left in.
