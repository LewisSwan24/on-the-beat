# Markers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person whose wristband hears a marker clearly is `near the bar`, `by the stage` or `somewhere out the back` on everyone's rows; everyone else is `in this room`, as now. Nothing else changes on a phone.

**Architecture:** Any wristband can be a marker: `marker bar`, `marker stage` or `marker back` on its console, kept across restarts. A marker joins no Wi-Fi and reaches no relay; every `BEACON_MS` it beacons five bytes, `OTBM` and its area's letter, by ESP-NOW broadcast on each channel from 1 to 13 in turn, and its face is dark until a key lights it (`firmware/src/main.cpp`; the beacon, letters, sweep and face are in `firmware/src/band_logic.h`). A band's listen keeps the strongest reading of each marker area beside the bands it heard, and its report gains `marks: [[area, rssi], ...]` (`band_logic.h`'s `Hearing`). The relay checks `marks` and hands them to the room with the rest of the report (`relay/server.js`). The room keeps each person's marker readings for `HEARD_MS`, and at every near tick names their band from the loudest median, if it is `MARK_FLOOR` or louder, held `MARK_HOLD` longer (`relay/room.js`). No phone names an area any more. The app does not change: its rows already say `Someone near the bar`.

**Tech Stack:** Node 22+ (`node --test`, `ws`), C++17 on the laptop (MinGW-W64 g++ here, GCC in CI), C++11 on the band (Arduino-ESP32 2.0.17 through PlatformIO `espressif32@^6.9.0`, ESP-IDF 4.4's `esp_now.h` and `esp_wifi.h`), M5Unified 0.2.22 or later.

**Spec:** `docs/superpowers/specs/2026-09-27-wrist-markers-design.md` (decided with the owner section by section on 27 Sep 2026, after a model of three kinds of floor and a spike on both real bands: §1 the marker, §2 the band's listen and report, §3 the relay's area, §4 privacy and abuse, §5 who does what, §6 tests and proof). Its floor was first -60 dBm and is -56: this build measured the hold through the real room, and the owner chose again the same day (commit `d0f50f0`, "The hold moves the floor"). It builds on the beacons, the listen and the report of `docs/superpowers/specs/2026-09-26-wrist-near-design.md`, whose plan is done. Read the markers spec before any task.

This plan was written from a finished build: every task below was built in a scratch worktree (branch `markers-build`), test first, and committed on its own with `npm test` green at every commit. The code blocks are those commits' diffs, so applying a task's blocks in order reproduces it. Each Step 2 was measured by running the task's tests on its parent's code, and each mutation list was measured at its task's commit.

## Global Constraints

- Artefacts are English: code, comments, commit messages, README, test names. Talk to the owner in Chinese.
- **Still a band, never a number, never a map** (promise 1, spec §4). No reading, marker or order reaches a phone or a band: a row says one of the four phrases the product always had. Readings live `HEARD_MS` (30 s) in the relay's memory and nowhere else.
- **Only markers name an area.** `join`'s `band` and `{t:'band'}` are gone; nothing a phone says sets an area. No phone sends either today.
- **Better unnamed than named wrong** (the owner's choice). A person is `in this room` unless their band's loudest marker, by the median over `HEARD_MS`, is `MARK_FLOOR` or louder, or the area they are in still holds.
- **Constants** (`relay/room.js`): `MARKS = { bar: 'near the bar', stage: 'by the stage', back: 'somewhere out the back' }`, `MARK_FLOOR = -56` (dBm), `MARK_HOLD = 4` (dB); near's `HEARD_MS` and `NEAR_TICK_MS` (5 s) unchanged. (`firmware/src/band_logic.h`): `MARK_BEACON = "OTBM"` (four bytes, then the letter, no ending 0), `MARK_CHANNELS = 13`, `MARK_AREA` = `bar`/`b`/`NEAR THE BAR`, `stage`/`s`/`BY THE STAGE`, `back`/`o`/`OUT THE BACK`; `FRAME_MAX` 320 → 384; near's `BEACON_MS` (500) and the face's `WAKE_MS` (6000) reused.
- **The area** at each tick, per person: each area's median over `HEARD_MS`; the area they are in holds while its median is `MARK_FLOOR - MARK_HOLD` (-60) or louder and no other area's is `MARK_HOLD` or more above it; otherwise the loudest, if `MARK_FLOOR` or louder; otherwise `in this room`. `nearTick()` says a view changed when anyone's area did.
- **Frames:** a report may end `,"marks":[["bar",-52],...]`, strongest first, only when the listen heard a marker. The relay takes `marks` only as an array of at most three `[area, rssi]` pairs, each area a key of `MARKS` and none twice, each `rssi` a whole number from -100 to 0; anything else drops the whole report, as a malformed report is dropped.
- **On the air:** a marker sends ESP-NOW broadcasts at 6 Mbps under an address made at every boot (`makeAir`), one on each channel set by `esp_wifi_set_channel`, waiting up to 20 ms for each send to leave before changing channel. A band's listen takes an ESP-NOW action frame carrying `OTBM` and one byte more as a marker's beacon, and a letter no marker has as nothing.
- **Not in this plan** (spec): telling a real marker from a fake one; per-venue tuning; markers listed, counted or shown to the venue; a correction between models; and anything on the phone: `app/` does not change.
- **The band's compiler takes C++11** and sees `Arduino.h`'s macros first; `firmware/host/as_band.cpp` holds `band_logic.h` to that on every run. A variable left unused is an error there (`-Werror`). On Windows `near` and `far` are macros in some headers: no name in this plan uses either.
- **The stand-in** (`/band`, `app/lib/wrist.js`) has no radio and does not change: it sends no reports and no `marks`.
- Repository `LewisSwan24/on-the-beat` (private). Commit after each task; push to `main` when a stage's `npm test` is green. Never the team repository `cimi2232/DECO3500`: `tools/hooks/pre-push` refuses it (after a fresh clone, `cp tools/hooks/pre-push .git/hooks/pre-push`).
- `CLAUDE.md` is not in git and is not edited by this plan. Nothing from `../on-the-beat-research/` or `../on-the-beat-design/` enters the repository.
- `npm test` builds first (the relay serves `dist/`). Running one test file alone: `npm run build` first, and again after restoring a mutation.
- Windows host: the Bash tool is Git Bash, and the plan's scripts are Node. Never write JavaScript or Python holding backticks, quotes or `${}` through a Bash heredoc: write it with the editor. A command that holds `git commit` and another program's `-n` (such as `grep -n`) is refused by a hook as `--no-verify`: run them separately.
- Flashing a band needs the owner's yes first, every time. The StickS3 is on `COM8`, the StickC Plus on `COM9`. Stand-in personas paired to his bands are unpaired when a test ends, and each band's state is said. A band made a marker is made a wristband again (`marker off`) before the test ends, unless he says otherwise.
- Never more than ten background tasks at once. Work directly; this plan needs no fan-out.
- Commit messages end with the attribution trailer the session's system reminder gives (today: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## Three procedures used throughout

**P1 — Mutation check.** Every task that adds a guard lists mutations as JSON: break one guard, run one test file, and exactly the listed tests go red (a listed name is a prefix of the test's). The lists were measured at each task's own commit; run later, a list may find more red as later tests join, and a mutation whose line a later task rewrote no longer applies.

Save this runner outside the repository (for example in your scratch directory as `mutate.mjs`) and run it from the repository root: `node <scratch>/mutate.mjs <scratch>/task-N.json`. It applies each edit (the `from` text must occur exactly once), runs the test file, restores the file byte for byte, runs the file again, and prints `ALL MUTATIONS HELD` only if every red set was exactly the listed one and every restore came back green. A C++ mutation runs `tests/firmware.test.js`, which compiles the host tests, about 40 s a run, twice: Task 4's thirteen take about twenty minutes, so run them in the background. Never run two lists at once when one mutates a file the other's tests use: `tests/firmware.test.js` runs the real relay, so no relay list runs beside Task 4's, and no PlatformIO build runs while `band_logic.h` holds a mutant.

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

**P2 — Close a stage.** `npm test` (expect `ℹ fail 0`, `ℹ skipped 0`), then `git push origin main`. A push that cannot reach github.com:443 while `gh` works is the network: check with `curl -sI https://github.com`, retry, leave git config alone. `npm test` here sometimes loses a whole file to a Node fatal error (exit `0xC0000409`, the file's tests missing from the count rather than failed): run it again.

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
| `tests/markers.test.js` | The room's areas: the floor, the median, the hold, `in this room`, the tick, no number in any view, and only markers naming an area |
| `tests/markers-crowd.test.js` | The near test's crowd model with a marker at each end of the floor, through the real room: how often the wrong marker is named, how far those named are, and how often areas change |

Modified: `relay/room.js`, `relay/server.js`, `tests/room.test.js`, `tests/wristband.test.js`, `firmware/src/band_logic.h`, `firmware/host/logic_test.cpp`, `tests/firmware.test.js`, `firmware/src/main.cpp`, `README.md`.

Not modified, on purpose: everything in `app/` (a row already says `someone(band)`, `app/copy.js`), `relay/band.js` (a band is shown no area), `app/lib/wrist.js` and `tests/fixtures/wrist-cases.json` (the stand-in has no radio).

## Stages

| Stage | Tasks | Leaves |
|---|---|---|
| A. The relay | 1–3 | the area from the markers, held, and no area from a phone; `marks` checked and handed to the room; the crowd model through the real room |
| B. The band | 4–5 | the marker's beacon and face and the listen's marks in `band_logic.h`, held on the laptop and against the relay; marker mode, the sweep and the console in `main.cpp` |
| C. Docs and proof | 6–7 | README; the real bands, with the owner |

Every task ends green and is committed on its own; each stage ends with P2.

---

## Stage A — The relay

Run the relay's tests with `npm run build >/dev/null && node --test tests/markers.test.js tests/room.test.js tests/wristband.test.js tests/markers-crowd.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`.

### Task 1: Rooms name a person's band from the markers their wristband hears

**Files:**
- Modify: `relay/room.js`, `relay/server.js` (two lines)
- Create: `tests/markers.test.js`
- Test: `tests/room.test.js`

**Interfaces:**
- Consumes: near's `room.heard(id, { ch, near })`, `room.nearTick()` (its `fresh()` pruning of samples older than `HEARD_MS`), `viewFor()`, `wave`, `report`, `reports()`, and `BANDS` in `relay/room.js`; `join` and `{t:'band'}` in `relay/server.js`.
- Produces: `export const MARKS`, `MARK_FLOOR = -56`, `MARK_HOLD = 4`. `room.heard(id, { ch, near, marks })`, `marks` being `[{ area, rssi }]`, `area` a key of `MARKS` (any other is ignored, `__proto__` and `toString` included). `room.nearTick()` also names each person's band (`areaOf()`) and returns `true` when any band changed. `room.join(id, { quiet })` takes no band; `room.setBand` is gone, and so are the relay's `band` in `join` and its `{t:'band'}`.

- [ ] **Step 1: Write the failing tests.** Nine in `tests/markers.test.js`, one per rule of spec §3: a marker at `MARK_FLOOR` naming its area on every row, and a dB under it not; the loudest by the median, not the mean; the hold, both ways; `in this room` with no band, a band gone quiet and no marker heard any more; the tick saying a view changed only when an area did; no number, marker or reading in any view; an area no marker has, or a report from someone not in the room, changing nothing; a match and a report keeping the area they were made in; and a phone's `band` at `join` not taken, with `setBand` gone. In `tests/room.test.js`, the rooms that placed people with `join(id, { band })` now place them as the relay will, each band hearing its area's marker at -40 dBm on a channel of its own, so hearing hides nobody.

Create `tests/markers.test.js`:

````diff
new file mode 100644
--- /dev/null
+++ b/tests/markers.test.js
@@ -0,0 +1,149 @@
+// Markers: the area a person is in comes from the markers their wristband hears
+// (docs/superpowers/specs/2026-09-27-wrist-markers-design.md §3), and only from them.
+// Everything here goes through the room: what a band heard, the tick, and the rows.
+
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import { createRoom, BANDS, HEARD_MS, MARK_FLOOR, MARK_HOLD } from '../relay/room.js';
+
+/** Three people on SAY HI, each picked their own name, and a clock. */
+function floor() {
+  let t = Date.UTC(2026, 8, 27, 21, 0);
+  const room = createRoom({ now: () => t, salt: 'marks' });
+  for (const id of ['ana', 'ben', 'cai']) {
+    room.join(id);
+    room.arm(id, 'hi');
+    room.pick(id, id);
+  }
+  return { room, later: (ms) => { t += ms; } };
+}
+
+/** The area `viewer` is shown `who` in, on their row. */
+const areaOf = (room, viewer, who) => room.viewFor(viewer).near.find((p) => p.pick === who)?.band;
+
+let channel = 100;
+/** One report from `id`'s band: the markers it heard, as { area: rssi }. Each on a channel of its own, so no band here hides anyone. */
+const hears = (room, id, marks) =>
+  room.heard(id, { ch: channel++, marks: Object.entries(marks).map(([area, rssi]) => ({ area, rssi })) });
+
+test('a band that hears a marker at MARK_FLOOR or louder puts its person there, on every row that shows them', () => {
+  const { room } = floor();
+  hears(room, 'ana', { bar: MARK_FLOOR });
+  room.nearTick();
+  assert.equal(areaOf(room, 'ben', 'ana'), 'near the bar');
+  assert.equal(areaOf(room, 'cai', 'ana'), 'near the bar');
+  assert.equal(room.viewFor('ana').me.band, 'near the bar');
+  hears(room, 'ben', { stage: MARK_FLOOR - 1 });
+  room.nearTick();
+  assert.equal(areaOf(room, 'ana', 'ben'), 'in this room', 'a dB under the floor is not heard clearly');
+  hears(room, 'cai', { back: -45 });
+  room.nearTick();
+  assert.equal(areaOf(room, 'ana', 'cai'), 'somewhere out the back');
+});
+
+test('the loudest marker names the area, by the median of what the band heard in HEARD_MS', () => {
+  const { room, later } = floor();
+  // The bar's median is -52 and the stage's -57, though the bar's mean (-57.3) is under the stage's (-57).
+  for (const [bar, stage] of [[-45, -58], [-75, -56], [-52, -57]]) {
+    hears(room, 'ana', { bar, stage });
+    later(1000);
+  }
+  room.nearTick();
+  assert.equal(areaOf(room, 'ben', 'ana'), 'near the bar');
+});
+
+test('an area holds while its marker is within MARK_HOLD of the loudest and MARK_FLOOR - MARK_HOLD or louder', () => {
+  const { room, later } = floor();
+  // Each report alone: the last one is older than HEARD_MS by then.
+  const at = (marks) => {
+    later(HEARD_MS + 1);
+    hears(room, 'ana', marks);
+    room.nearTick();
+    return areaOf(room, 'ben', 'ana');
+  };
+  assert.equal(at({ bar: -55 }), 'near the bar');
+  assert.equal(at({ bar: -55, stage: -55 + MARK_HOLD - 1 }), 'near the bar', 'the stage a dB short of MARK_HOLD louder');
+  assert.equal(at({ bar: -55, stage: -55 + MARK_HOLD }), 'by the stage', 'MARK_HOLD louder moves it');
+  assert.equal(at({ stage: MARK_FLOOR - MARK_HOLD }), 'by the stage', 'held down to the floor less the hold');
+  assert.equal(at({ stage: MARK_FLOOR - MARK_HOLD - 1 }), 'in this room');
+  assert.equal(at({ stage: MARK_FLOOR - 1 }), 'in this room', 'coming back needs the floor itself');
+});
+
+test('in this room without a band, with a band gone quiet for HEARD_MS, or with no marker heard any more', () => {
+  const { room, later } = floor();
+  hears(room, 'ana', { bar: -40 });
+  room.nearTick();
+  assert.equal(areaOf(room, 'ben', 'ana'), 'near the bar');
+  assert.equal(areaOf(room, 'ana', 'cai'), 'in this room', 'no band');
+  later(HEARD_MS + 1);
+  room.nearTick();
+  assert.equal(areaOf(room, 'ben', 'ana'), 'in this room', 'a band gone quiet');
+  hears(room, 'ana', { bar: -40 });
+  room.nearTick();
+  later(HEARD_MS / 2);
+  hears(room, 'ana', {});
+  later(HEARD_MS / 2 + 1);
+  room.nearTick();
+  assert.equal(areaOf(room, 'ben', 'ana'), 'in this room', 'still reporting, and no marker heard in HEARD_MS');
+});
+
+test('nearTick says a view changed when an area did, and not when none did', () => {
+  const { room } = floor();
+  hears(room, 'ana', {});
+  room.nearTick();
+  hears(room, 'ana', {});
+  assert.equal(room.nearTick(), false, 'nothing changed');
+  hears(room, 'ana', { bar: -40 });
+  assert.equal(room.nearTick(), true, "ana's area did");
+  hears(room, 'ana', { bar: -41 });
+  assert.equal(room.nearTick(), false, 'still near the bar');
+});
+
+test('no number reaches a view: a row says one of the four areas, and nothing about the marker', () => {
+  const { room } = floor();
+  hears(room, 'ana', { bar: -47, stage: -58 });
+  hears(room, 'ben', { back: -51 });
+  room.nearTick();
+  for (const viewer of ['ana', 'ben', 'cai']) {
+    const seen = JSON.stringify(room.viewFor(viewer));
+    assert.equal(/-47|-58|-51|rssi|marks|"bar"|"stage"|"back"/.test(seen), false, seen);
+    for (const p of room.viewFor(viewer).near) assert.ok(BANDS.includes(p.band));
+  }
+});
+
+test('an area no marker has, and a report from someone not in the room, change nothing', () => {
+  const { room } = floor();
+  room.heard('ana', { ch: 900, marks: [{ area: 'kitchen', rssi: -30 }, { area: 'toString', rssi: -30 }, { area: '__proto__', rssi: -30 }] });
+  room.heard('zed', { ch: 901, marks: [{ area: 'bar', rssi: -30 }] });
+  room.nearTick();
+  assert.equal(areaOf(room, 'ben', 'ana'), 'in this room');
+  assert.equal(room.viewFor('ana').me.band, 'in this room');
+  room.join('zed');
+  room.arm('zed', 'hi');
+  room.pick('zed', 'zed');
+  room.nearTick();
+  assert.equal(areaOf(room, 'ana', 'zed'), 'in this room', 'what was heard before joining does not count');
+});
+
+test('a match keeps the area it was made in, and a report the area it was sent from', () => {
+  const { room, later } = floor();
+  hears(room, 'ana', { bar: -40 });
+  room.nearTick();
+  const toAna = room.viewFor('ben').near.find((p) => p.pick === 'ana').handle;
+  room.wave('ben', toAna);
+  room.wave('ana', room.viewFor('ana').near.find((p) => p.pick === 'ben').handle);
+  assert.equal(room.report('cai', room.viewFor('cai').near.find((p) => p.pick === 'ana').handle, 'x'), true);
+  later(HEARD_MS + 1);
+  hears(room, 'ana', { stage: -40 });
+  room.nearTick();
+  assert.equal(room.viewFor('ana').me.band, 'by the stage');
+  assert.equal(room.viewFor('ben').matches[0].band, 'near the bar');
+  assert.equal(room.reports()[0].band, 'near the bar');
+});
+
+test('only a marker names an area: a phone saying one when it joins is not taken, and nothing else sets it', () => {
+  const { room } = floor();
+  room.join('eve', { band: 'near the bar' });
+  assert.equal(room.viewFor('eve').me.band, 'in this room');
+  assert.equal(room.setBand, undefined);
+});
````

In `tests/room.test.js`:

````diff
--- a/tests/room.test.js
+++ b/tests/room.test.js
@@ -2,15 +2,30 @@
 
 import { test } from 'node:test';
 import assert from 'node:assert/strict';
-import { createRoom, BANDS } from '../relay/room.js';
+import { createRoom, BANDS, MARKS } from '../relay/room.js';
+
+let channel = 1;
+/**
+ * Puts people in areas as the relay does: each one's band hears the marker of
+ * that area loud and clear, then the room ticks. Each band is on a channel of
+ * its own, so hearing a marker hides nobody (near spec §2).
+ */
+function place(room, where) {
+  for (const [id, band] of where) {
+    const area = Object.keys(MARKS).find((a) => MARKS[a] === band);
+    room.heard(id, { ch: channel++, marks: area ? [{ area, rssi: -40 }] : [] });
+  }
+  room.nearTick();
+}
 
 function night() {
   let t = Date.UTC(2026, 8, 23, 11, 4);
   const room = createRoom({ now: () => t, salt: 'test' });
-  for (const [id, band] of [['ana', 'near the bar'], ['ben', 'by the stage'], ['cai', 'in this room']]) {
-    room.join(id, { band });
+  for (const id of ['ana', 'ben', 'cai']) {
+    room.join(id);
     room.setProfile(id, { name: id.toUpperCase(), contact: '@' + id });
   }
+  place(room, [['ana', 'near the bar'], ['ben', 'by the stage'], ['cai', 'in this room']]);
   const handleOf = (viewer, target, list = 'near') =>
     room.viewFor(viewer)[list].find((p) => p.band === room.viewFor(target).me.band)?.handle;
   return { room, handleOf, tick: (ms) => { t += ms; } };
@@ -42,7 +57,8 @@ test('the same person has a different handle on every phone', () => {
 
 test('distance is only ever a band from the fixed four', () => {
   const { room } = night();
-  room.setBand('ana', '12 m from the stage');
+  room.heard('ana', { ch: 0, marks: [{ area: '12 m from the stage', rssi: -30 }] });
+  room.nearTick();
   assert.equal(room.viewFor('ana').me.band, 'near the bar', 'a made-up band is refused');
   room.arm('ana', 'hi');
   for (const p of room.viewFor('ben').near) assert.ok(BANDS.includes(p.band));
@@ -139,10 +155,11 @@ test('wave numbers only go up: two in one millisecond differ, a second wave keep
   tick(-1000);
   // Ben leaves and comes back within the millisecond; the next wave he is sent is still the newest.
   room.leave('ben');
-  room.join('ben', { band: 'by the stage' });
+  room.join('ben');
   room.arm('ben', 'hi');
-  room.join('dee', { band: 'near the bar' });
+  room.join('dee');
   room.arm('dee', 'hi');
+  place(room, [['ben', 'by the stage'], ['dee', 'near the bar']]);
   room.wave('dee', room.viewFor('dee').near.find((p) => p.band === 'by the stage').handle);
   assert.equal(room.wavesAt('ben')[0].n, first + 2);
 });
@@ -263,8 +280,9 @@ test('a block outlives leaving the room — a phone that slept does not come bac
   room.block('ana', handleOf('ana', 'ben'));
   room.leave('ana');
   room.leave('ben');
-  room.join('ana', { band: 'near the bar' });
-  room.join('ben', { band: 'by the stage' });
+  room.join('ana');
+  room.join('ben');
+  place(room, [['ana', 'near the bar'], ['ben', 'by the stage']]);
   room.arm('ana', 'hi');
   room.arm('ben', 'hi');
   assert.deepEqual(room.viewFor('ana').near, []);
````

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/markers.test.js tests/room.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)|SyntaxError"`

Expected: neither file loads: `SyntaxError: The requested module '../relay/room.js' does not provide an export named 'MARK_FLOOR'` (markers) and `... named 'MARKS'` (room), and `ℹ fail 2`.

- [ ] **Step 3: Implement.**

In `relay/room.js`:

````diff
--- a/relay/room.js
+++ b/relay/room.js
@@ -5,9 +5,10 @@
 //
 //   1. Nobody sees where you are. A person carries a BAND — `in this room`,
 //      `near the bar`, `by the stage`, `somewhere out the back` — and nothing
-//      finer, ever. There is no position here to leak. What wristbands hear
-//      of each other only takes people off SAY HI's list, and what they heard
-//      never leaves the room.
+//      finer, ever. There is no position here to leak. Only a marker the
+//      venue put up, heard clearly by the person's own wristband, names a
+//      band other than `in this room`. What wristbands hear of each other only
+//      takes people off SAY HI's list, and what they heard never leaves the room.
 //   2. No name and no photo until you both say yes. Before a mutual yes a
 //      person is a handle, a band and at most the track they picked. Handles
 //      are per viewer: the same person has a different handle on every phone,
@@ -51,6 +52,17 @@ export const HEARD_MS = 30_000;   // what a band heard, and that it listened at
 export const NEAR_FIVE = 5;       // of the people wearing a band, the most a list shows
 export const NEAR_KEEP = 10;      // one of the five stays while still among this many heard most strongly
 
+// Markers (docs/superpowers/specs/2026-09-27-wrist-markers-design.md §3): the band each area names.
+export const MARKS = { bar: 'near the bar', stage: 'by the stage', back: 'somewhere out the back' };
+export const MARK_FLOOR = -56;    // dBm: the loudest marker names a person's band if heard this loud or louder
+export const MARK_HOLD = 4;       // dB: a band holds this far under the floor, and until another is this much louder
+
+/** The middle of some readings, or null for none. */
+const median = (list) => {
+  const s = list.map((x) => x.rssi).sort((x, y) => x - y);
+  return s.length ? s[Math.floor(s.length / 2)] : null;
+};
+
 /** A pair's key, the same whichever way round it is asked. */
 const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
 const clip = (s, n) => String(s ?? '').trim().slice(0, n);
@@ -83,10 +95,12 @@ export function createRoom({
   let nextMatch = 1;
   // Near: what each person's wristband heard, never shown to anyone. pairKey -> [{ at, rssi }], from
   // either band hearing the other; id -> { at, ch }, when their band last reported and on which Wi-Fi
-  // channel; id -> the five nearTick() last worked out for them.
+  // channel; id -> the five nearTick() last worked out for them; id -> area -> [{ at, rssi }], the
+  // markers their band heard.
   const samples = new Map();
   const listening = new Map();
   const fives = new Map();
+  const marked = new Map();
 
   const handle = (viewer, target) =>
     createHash('sha256').update(salt + '|' + viewer + '|' + target).digest('hex').slice(0, 10);
@@ -109,10 +123,11 @@ export function createRoom({
    * already here, `quiet` is ignored, so an old NOT NOW cannot undo a newer
    * change from the wrist.
    */
-  function join(id, { band = BANDS[0], quiet = false } = {}) {
+  function join(id, { quiet = false } = {}) {
     if (!people.has(id)) {
+      // In this room until a marker says otherwise (nearTick()).
       people.set(id, {
-        id, name: '', contact: '', band: BANDS.includes(band) ? band : BANDS[0],
+        id, name: '', contact: '', band: BANDS[0],
         armed: null, invisible: !!quiet || !!tombs.get(id)?.invisible, pick: null, clip: null, joinedAt: now(),
         rev: tombs.has(id) ? tombs.get(id).rev + 1 : firstRev(), seq: 0, by: 'relay',
       });
@@ -140,11 +155,6 @@ export function createRoom({
     p.by = by;
   }
 
-  function setBand(id, band) {
-    const p = people.get(id);
-    if (p && BANDS.includes(band)) p.band = band;
-  }
-
   function setProfile(id, { name, contact } = {}) {
     const p = people.get(id);
     if (!p) return;
@@ -375,8 +385,11 @@ export function createRoom({
     return listening.get(viewer).ch === listening.get(t).ch && !fives.get(viewer).has(t);
   }
 
-  /** What one person's band heard: `near` is [{ id, rssi }] of other people in the room. */
-  function heard(id, { ch, near = [] } = {}) {
+  /**
+   * What one person's band heard: `near` is [{ id, rssi }] of other people in
+   * the room, `marks` [{ area, rssi }] of the markers, each area a key of MARKS.
+   */
+  function heard(id, { ch, near = [], marks = [] } = {}) {
     if (!people.has(id)) return;
     const at = now();
     listening.set(id, { at, ch });
@@ -386,26 +399,55 @@ export function createRoom({
       if (!samples.has(k)) samples.set(k, []);
       samples.get(k).push({ at, rssi });
     }
+    for (const { area, rssi } of marks) {
+      if (!Object.hasOwn(MARKS, area)) continue;
+      if (!marked.has(id)) marked.set(id, new Map());
+      const m = marked.get(id);
+      if (!m.has(area)) m.set(area, []);
+      m.get(area).push({ at, rssi });
+    }
   }
 
   /** A pair's score: the median of what either band heard of the other, or null. nearTick() drops the old first. */
-  function score(a, b) {
-    const s = (samples.get(pairKey(a, b)) ?? []).map((x) => x.rssi);
-    return s.length ? s.sort((x, y) => x - y)[Math.floor(s.length / 2)] : null;
+  const score = (a, b) => median(samples.get(pairKey(a, b)) ?? []);
+
+  /**
+   * A person's band, from the markers their band heard in HEARD_MS: the one
+   * they are in while it is MARK_FLOOR - MARK_HOLD or louder and no other is
+   * MARK_HOLD louder; else the loudest, if MARK_FLOOR or louder; else in this room.
+   */
+  function areaOf(p) {
+    // Its readings go with its last report: a band gone quiet HEARD_MS has none.
+    const loud = [...(marked.get(p.id) ?? [])]
+      .map(([area, list]) => ({ band: MARKS[area], s: median(list) }))
+      .sort((x, y) => y.s - x.s);
+    const here = loud.find((x) => x.band === p.band);
+    if (here && here.s >= MARK_FLOOR - MARK_HOLD && loud[0].s < here.s + MARK_HOLD) return p.band;
+    return loud.length && loud[0].s >= MARK_FLOOR ? loud[0].band : BANDS[0];
   }
 
   /**
    * Works out each listening person's five: of the people on SAY HI whose
    * bands have a score with theirs, last time's five stay while among the
    * NEAR_KEEP strongest, and the free places go to the strongest others.
-   * People bound to them take no place. True if anyone's five changed.
+   * People bound to them take no place. Then each person's band, from the
+   * markers (areaOf()). True if anyone's five or band changed.
    */
   function nearTick() {
+    const fresh = (list) => list.filter((x) => now() - x.at <= HEARD_MS);
     for (const [k, list] of samples) {
-      const kept = list.filter((x) => now() - x.at <= HEARD_MS);
+      const kept = fresh(list);
       if (kept.length) samples.set(k, kept);
       else samples.delete(k);
     }
+    for (const [id, m] of marked) {
+      for (const [area, list] of m) {
+        const kept = fresh(list);
+        if (kept.length) m.set(area, kept);
+        else m.delete(area);
+      }
+      if (!m.size) marked.delete(id);
+    }
     for (const id of [...listening.keys()]) if (!people.has(id) || !listens(id)) listening.delete(id);
     let changed = false;
     for (const id of [...fives.keys()]) {
@@ -427,6 +469,13 @@ export function createRoom({
       if (!fives.has(id) || five.length !== last.size || five.some((x) => !last.has(x))) changed = true;
       fives.set(id, new Set(five));
     }
+    for (const p of people.values()) {
+      const band = areaOf(p);
+      if (band !== p.band) {
+        p.band = band;
+        changed = true;
+      }
+    }
     return changed;
   }
 
@@ -484,7 +533,7 @@ export function createRoom({
   }
 
   return {
-    join, leave, setBand, setProfile, arm, setInvisible, fromPhone, pick, postClip,
+    join, leave, setProfile, arm, setInvisible, fromPhone, pick, postClip,
     wave, wavedAtYou, wavesAt, like, unlike, danceBack, block, report, keep, found, heard, nearTick, viewFor,
     /** For the relay: who is here, so it knows whose view to push. */
     ids: () => [...people.keys()],
````

In `relay/server.js`:

````diff
--- a/relay/server.js
+++ b/relay/server.js
@@ -530,7 +530,7 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
       stopGrace(ws.r, me);
       ws.r.heard.set(me, now());
       // `quiet` counts only if this join makes the person.
-      ws.r.room.join(me, { band: m.band, quiet: m.quiet === true });
+      ws.r.room.join(me, { quiet: m.quiet === true });
       // A hold on their wristband while they were out of the room.
       const b = bandOf(key, me);
       if (b?.quiet) { ws.r.room.setInvisible(me, true, 'band'); b.quiet = false; }
@@ -543,7 +543,6 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
     const room = r.room, me = ws.me;
     switch (m.t) {
       case 'profile': room.setProfile(me, { name: m.name, contact: m.contact }); break;
-      case 'band': room.setBand(me, m.band); break;
       case 'arm':
       case 'invisible':
         // Rules 3 to 5 are in room.fromPhone(). A seq that is there but not a number drops the frame.
````

- [ ] **Step 4: Run** — the two files, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 410`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`. One condition is not in the list, on purpose: a band's readings go with its last report, so a first draft's check that the band had reported in `HEARD_MS` could not be told apart from none, since its readings are just as old; it was taken out.

````json
[
 {
  "label": "the floor itself is not enough",
  "file": "relay/room.js",
  "from": "return loud.length && loud[0].s >= MARK_FLOOR ? loud[0].band : BANDS[0];",
  "to": "return loud.length && loud[0].s > MARK_FLOOR ? loud[0].band : BANDS[0];",
  "test": "tests/markers.test.js",
  "expect": [
   "a band that hears a marker at MARK_FLOOR or louder puts its person there, on every row that shows them"
  ]
 },
 {
  "label": "any marker heard names an area",
  "file": "relay/room.js",
  "from": "return loud.length && loud[0].s >= MARK_FLOOR ? loud[0].band : BANDS[0];",
  "to": "return loud.length ? loud[0].band : BANDS[0];",
  "test": "tests/markers.test.js",
  "expect": [
   "a band that hears a marker at MARK_FLOOR or louder puts its person there, on every row that shows them",
   "an area holds while its marker is within MARK_HOLD of the loudest and MARK_FLOOR - MARK_HOLD or louder"
  ]
 },
 {
  "label": "no hold",
  "file": "relay/room.js",
  "from": "    if (here && here.s >= MARK_FLOOR - MARK_HOLD && loud[0].s < here.s + MARK_HOLD) return p.band;\n",
  "to": "",
  "test": "tests/markers.test.js",
  "expect": [
   "an area holds while its marker is within MARK_HOLD of the loudest and MARK_FLOOR - MARK_HOLD or louder"
  ]
 },
 {
  "label": "held however faint",
  "file": "relay/room.js",
  "from": "if (here && here.s >= MARK_FLOOR - MARK_HOLD && ",
  "to": "if (here && ",
  "test": "tests/markers.test.js",
  "expect": [
   "an area holds while its marker is within MARK_HOLD of the loudest and MARK_FLOOR - MARK_HOLD or louder"
  ]
 },
 {
  "label": "held however loud another is",
  "file": "relay/room.js",
  "from": " && loud[0].s < here.s + MARK_HOLD) return p.band;",
  "to": ") return p.band;",
  "test": "tests/markers.test.js",
  "expect": [
   "an area holds while its marker is within MARK_HOLD of the loudest and MARK_FLOOR - MARK_HOLD or louder"
  ]
 },
 {
  "label": "held a dB too long",
  "file": "relay/room.js",
  "from": "loud[0].s < here.s + MARK_HOLD",
  "to": "loud[0].s <= here.s + MARK_HOLD",
  "test": "tests/markers.test.js",
  "expect": [
   "an area holds while its marker is within MARK_HOLD of the loudest and MARK_FLOOR - MARK_HOLD or louder"
  ]
 },
 {
  "label": "the mean, not the median",
  "file": "relay/room.js",
  "from": "  return s.length ? s[Math.floor(s.length / 2)] : null;",
  "to": "  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;",
  "test": "tests/markers.test.js",
  "expect": [
   "the loudest marker names the area, by the median of what the band heard in HEARD_MS"
  ]
 },
 {
  "label": "the first heard, not the loudest",
  "file": "relay/room.js",
  "from": "      .map(([area, list]) => ({ band: MARKS[area], s: median(list) }))\n      .sort((x, y) => y.s - x.s);",
  "to": "      .map(([area, list]) => ({ band: MARKS[area], s: median(list) }));",
  "test": "tests/markers.test.js",
  "expect": [
   "an area holds while its marker is within MARK_HOLD of the loudest and MARK_FLOOR - MARK_HOLD or louder"
  ]
 },
 {
  "label": "old readings are never dropped",
  "file": "relay/room.js",
  "from": "        const kept = fresh(list);\n        if (kept.length) m.set(area, kept);",
  "to": "        const kept = list;\n        if (kept.length) m.set(area, kept);",
  "test": "tests/markers.test.js",
  "expect": [
   "an area holds while its marker is within MARK_HOLD of the loudest and MARK_FLOOR - MARK_HOLD or louder",
   "in this room without a band, with a band gone quiet for HEARD_MS, or with no marker heard any more",
   "a match keeps the area it was made in, and a report the area it was sent from"
  ]
 },
 {
  "label": "any area is taken",
  "file": "relay/room.js",
  "from": "      if (!Object.hasOwn(MARKS, area)) continue;\n",
  "to": "",
  "test": "tests/markers.test.js",
  "expect": [
   "an area no marker has, and a report from someone not in the room, change nothing"
  ]
 },
 {
  "label": "an area on the prototype is taken",
  "file": "relay/room.js",
  "from": "if (!Object.hasOwn(MARKS, area)) continue;",
  "to": "if (!(area in MARKS)) continue;",
  "test": "tests/markers.test.js",
  "expect": [
   "an area no marker has, and a report from someone not in the room, change nothing"
  ]
 },
 {
  "label": "a changed area pushes nothing",
  "file": "relay/room.js",
  "from": "        p.band = band;\n        changed = true;",
  "to": "        p.band = band;",
  "test": "tests/markers.test.js",
  "expect": [
   "nearTick says a view changed when an area did, and not when none did"
  ]
 },
 {
  "label": "a phone's join names an area",
  "file": "relay/room.js",
  "from": "        id, name: '', contact: '', band: BANDS[0],",
  "to": "        id, name: '', contact: '', band: BANDS.includes(arguments[1]?.band) ? arguments[1].band : BANDS[0],",
  "test": "tests/markers.test.js",
  "expect": [
   "only a marker names an area: a phone saying one when it joins is not taken, and nothing else sets it"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add relay/room.js relay/server.js tests/markers.test.js tests/room.test.js
```

````bash
git commit -F - <<'EOF'
Rooms name a person's band from the markers their wristband hears

A report may carry marks, [{ area, rssi }] of the markers a band heard. At
each near tick, the loudest marker heard in HEARD_MS names the person's band
if its median is MARK_FLOOR (-56 dBm) or louder; the band they are in holds
MARK_HOLD (4 dB) under the floor and until another is MARK_HOLD louder.
Anyone else is in this room: no band, a band gone quiet, or no marker heard
clearly. Only markers name a band now: join takes none, and setBand is gone,
with the relay's two lines that called them. The room tests place people as
the relay does, each band on a channel of its own so hearing hides nobody.

Mutation-checked: 13 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 2: A band's report may say the markers it heard, each area once

**Files:**
- Modify: `relay/server.js`
- Test: `tests/wristband.test.js`

**Interfaces:**
- Consumes: Task 1's `MARKS` and `room.heard(id, { ch, near, marks })`; near's `heardFromBand()` in `relay/server.js`, which already drops a malformed report whole; `heldRelay()`, `nearFloor()`, `heardOf()`, `listed()` and `pause()` in `tests/wristband.test.js`.
- Produces: `{ t: 'heard', ch, near, marks }` from a band, `marks` optional, handed to the room as `[{ area, rssi }]`.

- [ ] **Step 1: Write the failing tests.** Three in `tests/wristband.test.js`: a band's marks naming its person's area on others' rows at the tick and not before, and never a number in a view; a report whose `marks` are wrong in any of thirteen ways (not an array, a pair too short or too long, an area no marker has, `toString`, a number for an area, a reading over 0, under -100, not whole or a string, an area twice, four pairs) dropped whole, then three distinct areas taken; and a phone that says an area when it joins, or as `{t:'band'}`, naming none. The last passes before this task's code, since Task 1 already removed both: it holds that nothing brings them back.

````diff
--- a/tests/wristband.test.js
+++ b/tests/wristband.test.js
@@ -1010,3 +1010,56 @@ test('an air counts only as the air of exactly one band paired in the same room'
     assert.deepEqual(listed(people.vi.p), ['nb', 'p0', 'p2']);
   });
 });
+
+// ---------- markers: the area a band hears it is in (docs/superpowers/specs/2026-09-27-wrist-markers-design.md §3) ----------
+
+/** The area `p`'s phone shows `who` in. */
+const areaOn = (p, who) => p.view.near.find((r) => r.pick === who)?.band;
+
+test("the markers a band reports name its person's area on others' rows, at the tick", async () => {
+  await heldRelay(async (on, clock, own) => {
+    const { people, nb } = await nearFloor(on, 'marks-area', ['vi', 'p0']);
+    people.vi.band.send({ t: 'heard', ch: 6, near: [[people.p0.air, -40]], marks: [['bar', -45], ['stage', -70]] });
+    people.p0.band.send({ t: 'heard', ch: 6, near: [[people.vi.air, -41]], marks: [['back', -50]] });
+    await pause(60);
+    assert.equal(areaOn(nb, 'vi'), 'in this room', 'nothing before the tick');
+    own.tickNear();
+    await nb.until(() => areaOn(nb, 'vi') === 'near the bar' && areaOn(nb, 'p0') === 'somewhere out the back');
+    await people.p0.p.until(() => areaOn(people.p0.p, 'vi') === 'near the bar');
+    assert.equal(/-45|-70|-50|marks|rssi/.test(JSON.stringify(nb.view)), false, 'never a number');
+  });
+});
+
+test('a report whose marks are wrong in any way is dropped whole', async () => {
+  await heldRelay(async (on, clock, own) => {
+    const { people, nb } = await nearFloor(on, 'marks-drop', ['vi', 'p0']);
+    heardOf(people.p0.band, 6, []);
+    const vi = people.vi;
+    // Taken, vi's report would narrow vi's list to nb (vi heard nobody) and name vi's area.
+    const after = async () => { await pause(40); own.tickNear(); await pause(60); return [listed(vi.p), areaOn(nb, 'vi')]; };
+    for (const marks of [
+      'bar', {}, [['bar']], [['bar', -40, 1]], [['kitchen', -40]], [['toString', -40]], [[1, -40]],
+      [['bar', 1]], [['bar', -101]], [['bar', -40.5]], [['bar', '-40']],
+      [['bar', -40], ['bar', -41]], [['bar', -40], ['stage', -41], ['back', -42], ['bar', -43]],
+    ]) {
+      vi.band.send({ t: 'heard', ch: 6, near: [], marks });
+      assert.deepEqual(await after(), [['nb', 'p0'], 'in this room'], JSON.stringify(marks));
+    }
+    vi.band.send({ t: 'heard', ch: 6, near: [], marks: [['bar', -40], ['stage', -41], ['back', -42]] });
+    assert.deepEqual(await after(), [['nb'], 'near the bar'], 'three areas, each once, after all those, are taken');
+  });
+});
+
+test('a phone never names an area: not when it joins, not as {t:"band"}', async () => {
+  await heldRelay(async (on, clock, own) => {
+    const { nb } = await nearFloor(on, 'marks-phone', ['vi']);
+    const eve = await on.phone('marks-phone', { band: 'near the bar' });
+    eve.send({ t: 'pick', track: 'eve' });
+    eve.send({ t: 'arm', intent: 'hi' });
+    eve.send({ t: 'band', band: 'by the stage' });
+    await nb.until(() => areaOn(nb, 'eve') !== undefined);
+    own.tickNear();
+    await pause(60);
+    assert.deepEqual([eve.view.me.band, areaOn(nb, 'eve')], ['in this room', 'in this room']);
+  });
+});
````

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/wristband.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: `ℹ tests 51`, `ℹ pass 49`, `ℹ fail 2`: the area test times out waiting for `near the bar` (the relay drops `marks`, so no area is ever named), and the drop test fails at its first case, `'bar'`, with `[['nb'], 'in this room']` for `[['nb','p0'], 'in this room']` (the report was taken, and its `marks` ignored).

- [ ] **Step 3: Implement.**

````diff
--- a/relay/server.js
+++ b/relay/server.js
@@ -14,7 +14,7 @@ import { extname, isAbsolute, join, normalize, relative } from 'node:path';
 import { fileURLToPath } from 'node:url';
 import { createHash, randomBytes, randomInt } from 'node:crypto';
 import { WebSocketServer } from 'ws';
-import { createRoom, INTENTS, SPOTS } from './room.js';
+import { createRoom, INTENTS, MARKS, SPOTS } from './room.js';
 import { MEET_MS, bandShow, cleanCode, newCode } from './band.js';
 import { nightOf } from './night.js';
 
@@ -334,7 +334,9 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
    * Wi-Fi channel, and `near`, [air, rssi] pairs. From a band paired in a room,
    * at most every HEARD_GAP_MS, whole or not at all. An air counts only as the
    * air of exactly one band paired in the same room; the room itself ignores the
-   * band's own person and anyone no longer in it.
+   * band's own person and anyone no longer in it. `marks`, when there, is the
+   * markers it heard: [area, rssi] pairs, each area a key of MARKS and none twice
+   * (markers spec §3).
    */
   function heardFromBand(b, m) {
     const r = b.person && b.key ? rooms.get(b.key) : null;
@@ -343,6 +345,11 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
     const fits = (e) => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && AIR.test(e[0])
       && Number.isInteger(e[1]) && e[1] >= -100 && e[1] <= 0;
     if (!m.near.every(fits)) return;
+    // Each area once: a fourth pair is always one too many, so every() stops by then.
+    const areas = new Set();
+    const marks = (e) => Array.isArray(e) && e.length === 2 && Object.hasOwn(MARKS, e[0]) && !areas.has(e[0])
+      && areas.add(e[0]) && Number.isInteger(e[1]) && e[1] >= -100 && e[1] <= 0;
+    if (m.marks !== undefined && !(Array.isArray(m.marks) && m.marks.every(marks))) return;
     b.heardAt = now();
     // A band has its room's key only while it is paired there.
     const here = [...bands.values()].filter((o) => o.key === b.key);
@@ -351,7 +358,7 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
       const who = here.filter((o) => o.air === air);
       if (who.length === 1) near.push({ id: who[0].person, rssi });
     }
-    r.room.heard(b.person, { ch: m.ch, near });
+    r.room.heard(b.person, { ch: m.ch, near, marks: (m.marks ?? []).map(([area, rssi]) => ({ area, rssi })) });
   }
 
   function refuseBand(ws) {
````

- [ ] **Step 4: Run** — the file (`ℹ pass 51`), then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 413`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "any area is taken",
  "file": "relay/server.js",
  "from": "e.length === 2 && Object.hasOwn(MARKS, e[0]) && ",
  "to": "e.length === 2 && ",
  "test": "tests/wristband.test.js",
  "expect": [
   "a report whose marks are wrong in any way is dropped whole"
  ]
 },
 {
  "label": "an area the prototype has is taken",
  "file": "relay/server.js",
  "from": "Object.hasOwn(MARKS, e[0])",
  "to": "e[0] in MARKS",
  "test": "tests/wristband.test.js",
  "expect": [
   "a report whose marks are wrong in any way is dropped whole"
  ]
 },
 {
  "label": "an area twice is taken",
  "file": "relay/server.js",
  "from": "!areas.has(e[0])\n      && areas.add(e[0]) && ",
  "to": "",
  "test": "tests/wristband.test.js",
  "expect": [
   "a report whose marks are wrong in any way is dropped whole"
  ]
 },
 {
  "label": "a pair of any length",
  "file": "relay/server.js",
  "from": "const marks = (e) => Array.isArray(e) && e.length === 2 && ",
  "to": "const marks = (e) => Array.isArray(e) && ",
  "test": "tests/wristband.test.js",
  "expect": [
   "a report whose marks are wrong in any way is dropped whole"
  ]
 },
 {
  "label": "an rssi that is not whole",
  "file": "relay/server.js",
  "from": "areas.add(e[0]) && Number.isInteger(e[1]) && ",
  "to": "areas.add(e[0]) && ",
  "test": "tests/wristband.test.js",
  "expect": [
   "a report whose marks are wrong in any way is dropped whole"
  ]
 },
 {
  "label": "an rssi under -100",
  "file": "relay/server.js",
  "from": "Number.isInteger(e[1]) && e[1] >= -100 && e[1] <= 0;\n    if (m.marks",
  "to": "Number.isInteger(e[1]) && e[1] <= 0;\n    if (m.marks",
  "test": "tests/wristband.test.js",
  "expect": [
   "a report whose marks are wrong in any way is dropped whole"
  ]
 },
 {
  "label": "an rssi over 0",
  "file": "relay/server.js",
  "from": "&& e[1] >= -100 && e[1] <= 0;\n    if (m.marks",
  "to": "&& e[1] >= -100;\n    if (m.marks",
  "test": "tests/wristband.test.js",
  "expect": [
   "a report whose marks are wrong in any way is dropped whole"
  ]
 },
 {
  "label": "the marks are not handed on",
  "file": "relay/server.js",
  "from": "r.room.heard(b.person, { ch: m.ch, near, marks: (m.marks ?? []).map(([area, rssi]) => ({ area, rssi })) });",
  "to": "r.room.heard(b.person, { ch: m.ch, near });",
  "test": "tests/wristband.test.js",
  "expect": [
   "the markers a band reports name its person's area on others' rows, at the tick",
   "a report whose marks are wrong in any way is dropped whole"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add relay/server.js tests/wristband.test.js
```

````bash
git commit -F - <<'EOF'
A band's report may say the markers it heard, each area once

A heard frame may carry marks: [area, rssi] pairs, each area bar, stage or
back and none twice, each RSSI a whole number from -100 to 0. Anything else
drops the whole report, as a malformed report is dropped. The marks go to
the room with the rest of the report, so a person's area on others' rows
changes at the next tick, and never by a number. A phone still names no
area, whether it says one when it joins or as {t:'band'}.

Mutation-checked: 8 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 3: On a modelled crowd, a marker named is the nearest, and areas hold

**Files:**
- Create: `tests/markers-crowd.test.js`

**Interfaces:**
- Consumes: Task 1's `createRoom`, `heard(id, { ch, marks })`, `nearTick`, `viewFor` and `MARKS`.
- Produces: nothing new; a proof of spec §6's line, "the wrong marker named for under 1% of those named, nine in ten of them within 11 m, and an area changing at no more than 4% of listens".

- [ ] **Step 1: Write the test.** The near crowd test's model, seeded so it is the same every run: on 40 × 25 m, a bar marker at (1, 12.5) and a stage marker at (39, 12.5); each band's mean reading of each marker from log-distance loss (-30 dBm at a metre, exponent 2.7) less a few dB for each other body within 25 cm of the line (at most 12); each listen the strongest of two beacons with slow (4 dB) and fast (6 dB) fading, unheard below -95 dBm. Three crowds: 750 people with 150 banded and 4 dB a body; 1,500 with 300 (packed); and 750 with markers above heads (2 dB a body). Twelve listens ten seconds apart go through the real room; from the fourth it counts, of each band's area, whether it names a marker, whether that marker is the nearer one, how far it is, and whether the area changed since the last listen, and reports all four with `ctx.diagnostic()`.

Create `tests/markers-crowd.test.js`:

````diff
new file mode 100644
--- /dev/null
+++ b/tests/markers-crowd.test.js
@@ -0,0 +1,90 @@
+// Markers, on a modelled crowd: reports shaped as the bands send them, through the
+// real room, and whether the area each person is given is true (markers spec §6).
+// The crowd is the model of tests/near-crowd.test.js — 2.4 GHz log-distance loss, a
+// few dB for each body between band and marker, slow and fast fading — with a
+// marker at each end of the floor. A model, not a measurement: the spec says which
+// choices rest on it.
+
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import { createRoom, MARKS } from '../relay/room.js';
+
+const RSSI_1M = -30;    // dBm a metre away, line of sight
+const LOSS_N = 2.7;     // path-loss exponent indoors
+const SLOW_DB = 4;      // shadowing that drifts from one listen to the next
+const FAST_DB = 6;      // fading from one beacon to the next
+const FLOOR_DB = -95;   // below this a beacon is not heard
+const LISTEN_EVERY_MS = 10_000;
+const MARKERS = [{ area: 'bar', x: 1, y: 12.5 }, { area: 'stage', x: 39, y: 12.5 }];
+
+/** A seeded 40 x 25 m floor: `people` in all, the first `bands` of them banded; `bodyDb` for each body between a band and a marker. */
+function crowd({ people, bands, bodyDb, seed = 7 }) {
+  let s = seed;
+  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
+  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
+  const at = Array.from({ length: people }, () => ({ x: rnd() * 40, y: rnd() * 25 }));
+  const bodies = (a, b) => {
+    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
+    let k = 0;
+    for (const p of at) {
+      if (p === a) continue;
+      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
+      if (t <= 0 || t >= 1) continue;
+      const qx = a.x + t * dx - p.x, qy = a.y + t * dy - p.y;
+      if (qx * qx + qy * qy < 0.0625) k += 1;
+    }
+    return Math.min(k, 12);
+  };
+  return Array.from({ length: bands }, (_, i) => {
+    const d = MARKERS.map((m) => Math.max(0.5, Math.hypot(at[i].x - m.x, at[i].y - m.y)));
+    const mean = MARKERS.map((m, k) => RSSI_1M - 10 * LOSS_N * Math.log10(d[k]) - bodyDb * bodies(at[i], m));
+    /** One listen: the strongest of two beacons from each marker, as the band keeps it. */
+    const listen = () => MARKERS.flatMap((m, k) => {
+      const r = mean[k] + SLOW_DB * gauss() + Math.max(FAST_DB * gauss(), FAST_DB * gauss());
+      return r >= FLOOR_DB ? [{ area: m.area, rssi: Math.max(-100, Math.min(0, Math.round(r))) }] : [];
+    });
+    return { id: 'b' + i, d, listen };
+  });
+}
+
+for (const [what, shape] of [
+  ['750 people, 150 banded', { people: 750, bands: 150, bodyDb: 4 }],
+  ['1,500 people, 300 banded (packed)', { people: 1500, bands: 300, bodyDb: 4 }],
+  ['750 people, 150 banded, markers above heads', { people: 750, bands: 150, bodyDb: 2 }],
+]) {
+  test(`on a modelled floor of ${what}, a marker named is the nearest, nine in ten named are within 11 m, and areas hold`, (ctx) => {
+    const bands = crowd(shape);
+    let t = Date.UTC(2026, 8, 27, 21, 0);
+    const room = createRoom({ now: () => t, salt: 'marks-crowd' });
+    for (const b of bands) room.join(b.id);
+    let named = 0, wrong = 0, shown = 0, flips = 0;
+    const was = new Map();
+    const far = [];
+    // Two minutes of listens; the areas after every round from the fourth.
+    for (let round = 0; round < 12; round += 1) {
+      for (const b of bands) room.heard(b.id, { ch: 6, marks: b.listen() });
+      t += LISTEN_EVERY_MS;
+      room.nearTick();
+      if (round < 3) continue;
+      for (const b of bands) {
+        shown += 1;
+        const band = room.viewFor(b.id).me.band;
+        if (was.has(b.id) && was.get(b.id) !== band) flips += 1;
+        was.set(b.id, band);
+        const k = MARKERS.findIndex((m) => MARKS[m.area] === band);
+        if (k < 0) continue;
+        named += 1;
+        far.push(b.d[k]);
+        if (b.d[k] > Math.min(...b.d)) wrong += 1;
+      }
+    }
+    far.sort((x, y) => x - y);
+    const p90 = far[Math.floor(0.9 * far.length)];
+    ctx.diagnostic(`named ${(100 * named / shown).toFixed(1)}%, the wrong marker ${(100 * wrong / named).toFixed(2)}% of those, nine in ten within ${p90.toFixed(1)} m; ${(100 * flips / shown).toFixed(1)}% of areas changed a listen`);
+    assert.ok(named / shown >= 0.1, 'someone is named: the floor is not so high that nobody ever is');
+    assert.ok(wrong / named < 0.01, `the wrong marker for ${(100 * wrong / named).toFixed(2)}%`);
+    assert.ok(p90 <= 11, `nine in ten named within ${p90.toFixed(1)} m`);
+    // Held MARK_HOLD, an area changed 0.9 to 3.6% a listen when measured; not held, 1.3 to 6.0%.
+    assert.ok(flips / shown <= 0.04, `${(100 * flips / shown).toFixed(1)}% of areas changed a listen`);
+  });
+}
````

- [ ] **Step 2: Run it.** `node --test tests/markers-crowd.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)|named"`

Expected: it passes on Tasks 1–2 as they are, in under a second: named 23.2, 12.4 and 35.4%; the wrong marker 0, 0 and 0.21% of those; nine in ten within 8.7, 6.1 and 9.8 m; areas changed 2.2, 0.9 and 3.6% a listen. It is a proof, not a new rule: its mutations below are what show it can fail. Measured while choosing the floor: at -60 dBm, markers above heads gave 1.26% wrong and 12.2 m; with no hold, areas changed 4.5, 1.3 and 6.0%.

- [ ] **Step 3: Run** `npm test`. Expected: `ℹ fail 0`, `ℹ tests 416`.

- [ ] **Step 4: Mutation check (P1)** — expected `ALL MUTATIONS HELD`. Naming the first marker heard rather than the loudest is not in this list: with only two markers at opposite ends, it leaves the people near the stage unnamed, which this test allows; Task 1's hold test catches it.

````json
[
 {
  "label": "the first floor, -60 dBm",
  "file": "relay/room.js",
  "from": "export const MARK_FLOOR = -56;",
  "to": "export const MARK_FLOOR = -60;",
  "test": "tests/markers-crowd.test.js",
  "expect": [
   "on a modelled floor of 750 people, 150 banded, markers above heads, a marker named is the nearest, nine in ten named are within 11 m, and areas hold"
  ]
 },
 {
  "label": "no hold",
  "file": "relay/room.js",
  "from": "    if (here && here.s >= MARK_FLOOR - MARK_HOLD && loud[0].s < here.s + MARK_HOLD) return p.band;\n",
  "to": "",
  "test": "tests/markers-crowd.test.js",
  "expect": [
   "on a modelled floor of 750 people, 150 banded, a marker named is the nearest, nine in ten named are within 11 m, and areas hold",
   "on a modelled floor of 750 people, 150 banded, markers above heads, a marker named is the nearest, nine in ten named are within 11 m, and areas hold"
  ]
 },
 {
  "label": "any marker heard names an area",
  "file": "relay/room.js",
  "from": "return loud.length && loud[0].s >= MARK_FLOOR ? loud[0].band : BANDS[0];",
  "to": "return loud.length ? loud[0].band : BANDS[0];",
  "test": "tests/markers-crowd.test.js",
  "expect": [
   "on a modelled floor of 750 people, 150 banded, a marker named is the nearest, nine in ten named are within 11 m, and areas hold",
   "on a modelled floor of 1,500 people, 300 banded (packed), a marker named is the nearest, nine in ten named are within 11 m, and areas hold",
   "on a modelled floor of 750 people, 150 banded, markers above heads, a marker named is the nearest, nine in ten named are within 11 m, and areas hold"
  ]
 }
]
````

- [ ] **Step 5: Commit, and close Stage A with P2**

```bash
git add tests/markers-crowd.test.js
```

````bash
git commit -F - <<'EOF'
On a modelled crowd, a marker named is the nearest, and areas hold

The crowd model of the near test, with a bar marker at one end of a 40 x 25
m floor and a stage marker at the other, through the real room: 750 people
with 150 banded, 1,500 with 300, and markers above heads. The wrong marker
was named for 0 to 0.21% of those named, nine in ten were within 8.7, 6.1
and 9.8 m, and an area changed 0.9 to 3.6% a listen. At the spec's first
floor of -60 dBm, above heads gave 1.26% and 12.2 m, since the hold keeps a
band named 4 dB under the floor: the owner chose -56.

Mutation-checked: 3 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---

## Stage B — The band

### Task 4: A band keeps the markers it heard and says them; a marker has its beacon and its face

**Files:**
- Modify: `firmware/src/band_logic.h`
- Test: `firmware/host/logic_test.cpp`, `tests/firmware.test.js`

**Interfaces:**
- Consumes: near's `Hearing` (`heard`, `size`, `clear`, `strongest`, `frame`), `BEACON`, `BEACON_MS`, `FRAME_MAX`; `Words`, `fold()` and `WAKE_MS` in `firmware/src/band_logic.h`; the host tests' `CHECK`, `hear()`, `answer()` and `speak`; `speak()`, `open()` and `phone()` in `tests/firmware.test.js`; Tasks 1–2's relay.
- Produces: `MARK_BEACON[4]`, `MARK_CHANNELS` (13), `struct MarkArea { area, letter, words }`, `MARK_AREA[]`, `MARK_AREAS` (3); `markNamed(const std::string&)` and `markLettered(uint8_t)` → the area's index, or -1; `markSweep()` → `std::vector<int>` of channels 1..13. `Hearing::heardMark(uint8_t letter, int rssi)`, `Hearing::marks()` → `std::vector<Hearing::Marked>` (`const char* area`, `int rssi`), strongest first; `frame(ch)` ends with `marks` only when there are any; `clear()` clears them. `class Marker(int area)` with `area()`, `beacon()` → the five bytes, `press(now)`, `lit(now)` and `words()` → `{"MARKER", "NEAR THE BAR"}` and the like. `FRAME_MAX` 384. The host binary's `heard` verb gains `<letter>=<rssi>`. In `tests/firmware.test.js`, `pairedBands()` and `report()` come out of near's round-trip test for the new one to share.

- [ ] **Step 1: Write the failing tests.** In `logic_test.cpp`, `markers()`: the three areas by word and by letter, and a word or letter no marker has; each marker's beacon bytes, never a band's `OTB1`, and the sweep of channels 1 to 13; a marker's face dark, lit `WAKE_MS` by a key, again by another, with its words in the screen's alphabet; a listen keeping each area once at its strongest, never among the bands, brought into -100..0, strongest first, saying nothing of markers when it heard none, and cleared with the rest; and the longest report, twelve bands and three markers on channel 14, 346 bytes and inside `FRAME_MAX`. In `tests/firmware.test.js`, three bands paired in one room report as the firmware writes them, one marker each (and a letter no marker has), and each phone shows the others in the area its band heard.

In `firmware/host/logic_test.cpp`:

````diff
--- a/firmware/host/logic_test.cpp
+++ b/firmware/host/logic_test.cpp
@@ -711,6 +711,67 @@ void hearing() {
   CHECK(!w.nearOn());  // unpaired
 }
 
+void markers() {
+  // Three areas, each a word on the console and in a report (relay/room.js MARKS has the same), and a letter on the air.
+  CHECK(MARK_AREAS == 3);
+  CHECK(markNamed("bar") == 0 && markNamed("stage") == 1 && markNamed("back") == 2);
+  CHECK(markNamed("off") == -1 && markNamed("") == -1 && markNamed("BAR") == -1 && markNamed("bar ") == -1);
+  CHECK(markLettered('b') == 0 && markLettered('s') == 1 && markLettered('o') == 2);
+  CHECK(markLettered('x') == -1 && markLettered('B') == -1 && markLettered(0) == -1 && markLettered('1') == -1);
+
+  // A marker beacons OTBM and its letter, never a band's OTB1, on every channel from 1 to 13 in turn.
+  CHECK(Marker(0).beacon() == std::vector<uint8_t>({'O', 'T', 'B', 'M', 'b'}));
+  CHECK(Marker(1).beacon() == std::vector<uint8_t>({'O', 'T', 'B', 'M', 's'}));
+  CHECK(Marker(2).beacon() == std::vector<uint8_t>({'O', 'T', 'B', 'M', 'o'}));
+  CHECK(!std::equal(BEACON, BEACON + 4, MARK_BEACON));
+  CHECK(markSweep() == std::vector<int>({1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13}));
+  CHECK(std::string(Marker(1).area()) == "stage");
+
+  // Its face is dark; a key lights it for WAKE_MS with what it is, in the screen's alphabet.
+  Marker m(1);
+  CHECK(!m.lit(0) && !m.lit(WAKE_MS));
+  m.press(1000);
+  CHECK(m.lit(1000) && m.lit(1000 + WAKE_MS - 1) && !m.lit(1000 + WAKE_MS));
+  m.press(1000 + WAKE_MS + 5);
+  CHECK(m.lit(1000 + 2 * WAKE_MS));
+  CHECK(m.words().big == "MARKER" && m.words().small == "BY THE STAGE");
+  CHECK(Marker(0).words().small == "NEAR THE BAR" && Marker(2).words().small == "OUT THE BACK");
+  for (int i = 0; i < 3; ++i) CHECK(fold(Marker(i).words().small) == Marker(i).words().small);
+
+  // A listen keeps each marker area once, at the strongest of its beacons, and a letter no marker has is nothing.
+  Hearing h;
+  h.heardMark('s', -80);
+  h.heardMark('b', -60);
+  h.heardMark('b', -52);
+  h.heardMark('b', -70);
+  h.heardMark('x', -10);
+  h.heardMark('B', -10);
+  CHECK(h.size() == 0);  // a marker is never a band
+  CHECK(h.frame(6) == "{\"t\":\"heard\",\"ch\":6,\"near\":[],\"marks\":[[\"bar\",-52],[\"stage\",-80]]}");
+  // Brought into -100..0, the range the relay takes, as a band's reading is; the strongest first.
+  h.heardMark('o', -130);
+  h.heardMark('s', 4);
+  CHECK(h.frame(6) == "{\"t\":\"heard\",\"ch\":6,\"near\":[],\"marks\":[[\"stage\",0],[\"bar\",-52],[\"back\",-100]]}");
+  CHECK(h.marks().size() == 3 && std::string(h.marks()[0].area) == "stage" && h.marks()[0].rssi == 0);
+  // Heard no marker, a report says nothing of markers; cleared, a listen has heard none.
+  h.clear();
+  CHECK(h.marks().empty());
+  hear(h, 1, -40);
+  CHECK(h.frame(6) == "{\"t\":\"heard\",\"ch\":6,\"near\":[[\"020000000001\",-40]]}");
+  hear(h, 2, -45);
+  h.heardMark('b', -50);
+  CHECK(h.frame(6) == "{\"t\":\"heard\",\"ch\":6,\"near\":[[\"020000000001\",-40],[\"020000000002\",-45]],\"marks\":[[\"bar\",-50]]}");
+
+  // The longest report fits the outbox: HEARD_MAX bands and all three markers, on channel 14.
+  Hearing full;
+  for (int i = 0; i < 16; ++i) {
+    const uint8_t weak[6] = {0xfe, 0xff, 0xff, 0xff, 0xff, static_cast<uint8_t>(i)};
+    full.heard(weak, -100);
+  }
+  for (const char c : {'s', 'o', 'b'}) full.heardMark(c, -100);
+  CHECK(full.frame(14).size() == 346 && full.frame(14).size() < FRAME_MAX);
+}
+
 // ---------- speak: this code, in front of the real relay ----------
 
 std::string quote(const std::string& s) {
@@ -749,13 +810,17 @@ std::string answer(const Command& c) {
     return helloFrame(idFor(key), key, battery, secret == "-" ? "" : secret, quiet == "quiet", air);
   }
   if (c.verb == "heard") {
-    // heard <ch> [<air>:<rssi> ...]: one listen, reported as the band reports it
+    // heard <ch> [<air>:<rssi> ...] [<letter>=<rssi> ...]: one listen, bands and markers, reported as the band reports it
     std::istringstream in(c.arg);
     int ch = 0;
     in >> ch;
     Hearing h;
     std::string one;
     while (in >> one) {
+      if (one.size() > 2 && one[1] == '=') {
+        h.heardMark(static_cast<uint8_t>(one[0]), std::atoi(one.c_str() + 2));
+        continue;
+      }
       const size_t colon = one.find(':');
       const std::vector<uint8_t> mac = hexBytes(one.substr(0, colon));
       if (colon == std::string::npos || mac.size() != 6) return "bad " + one;
@@ -909,6 +974,7 @@ int main(int argc, char** argv) {
   console();
   said();
   hearing();
+  markers();
   std::printf("ok: %d checks\n", checks);
   return 0;
 }
````

In `tests/firmware.test.js`:

````diff
--- a/tests/firmware.test.js
+++ b/tests/firmware.test.js
@@ -256,32 +256,46 @@ test('what the firmware says, the relay takes; what the relay says, the firmware
   }
 });
 
+/** Bands saying their address on the air, 02abcdef0001 on, each paired to a phone on SAY HI in one room that picked its name. */
+async function pairedBands(port, venue, names, socks) {
+  const all = [];
+  for (const [i, name] of names.entries()) {
+    const air = '02abcdef000' + (i + 1);
+    const [key] = speak(['key']);
+    const [hello] = speak([`hello ${key} 80 - - ${air}`]);
+    assert.deepEqual(JSON.parse(hello), { t: 'wristband', id: idOf(key), key, v: 2, battery: 80, air });
+    const band = await open(port, 'arduino');
+    socks.push(band);
+    band.send(hello);
+    const { show: { code } } = await band.until('show', (m) => m.show.kind === 'pairing');
+    const person = await phone(port, venue);
+    socks.push(person);
+    person.send({ t: 'pair', code });
+    await person.until('view', (m) => m.view.me.check);
+    person.send({ t: 'confirm', yes: true });
+    await person.until('paired');
+    person.send({ t: 'pick', track: name });
+    person.send({ t: 'arm', intent: 'hi' });
+    all.push({ band, person, air });
+  }
+  return all;
+}
+
+/** Each band's report, and then a ping, so that each report was taken once its pong is back. */
+async function report(all, reports) {
+  for (const [i, p] of all.entries()) {
+    p.band.send(reports[i]);
+    p.band.send(speak(['ping'])[0]);
+    await p.band.until('pong');
+  }
+}
+
 test('what the firmware reports it heard, the relay takes: each phone lists the bands its band heard', { skip }, async () => {
   const relay = await createRelay({ port: 0, host: '127.0.0.1', root: dir });
   const socks = [];
   try {
-    // Three bands, each saying its address on the air, each paired to a phone in one room.
-    const names = ['vi', 'x', 'y'];
-    const airs = ['02abcdef0001', '02abcdef0002', '02abcdef0003'];
-    const all = [];
-    for (const [i, air] of airs.entries()) {
-      const [key] = speak(['key']);
-      const [hello] = speak([`hello ${key} 80 - - ${air}`]);
-      assert.deepEqual(JSON.parse(hello), { t: 'wristband', id: idOf(key), key, v: 2, battery: 80, air });
-      const band = await open(relay.port, 'arduino');
-      socks.push(band);
-      band.send(hello);
-      const { show: { code } } = await band.until('show', (m) => m.show.kind === 'pairing');
-      const person = await phone(relay.port, 'near-room');
-      socks.push(person);
-      person.send({ t: 'pair', code });
-      await person.until('view', (m) => m.view.me.check);
-      person.send({ t: 'confirm', yes: true });
-      await person.until('paired');
-      person.send({ t: 'pick', track: names[i] });
-      person.send({ t: 'arm', intent: 'hi' });
-      all.push({ band, person });
-    }
+    const all = await pairedBands(relay.port, 'near-room', ['vi', 'x', 'y'], socks);
+    const airs = all.map((p) => p.air);
     const listed = async (p, n) => (await p.person.until('view', (m) => m.view.near.length === n)).view.near.map((q) => q.pick).sort();
     const [vi, x, y] = all;
     assert.deepEqual(await listed(vi, 2), ['x', 'y'], 'before any band has reported, the whole room');
@@ -290,11 +304,7 @@ test('what the firmware reports it heard, the relay takes: each phone lists the
     const reports = speak([`heard 6 ${airs[1]}:-48`, `heard 6 ${airs[0]}:-52`, 'heard 6']);
     assert.deepEqual(JSON.parse(reports[0]), { t: 'heard', ch: 6, near: [[airs[1], -48]] });
     assert.deepEqual(JSON.parse(reports[2]), { t: 'heard', ch: 6, near: [] });
-    for (const [i, p] of all.entries()) {
-      p.band.send(reports[i]);
-      p.band.send(speak(['ping'])[0]);
-      await p.band.until('pong');  // the report before it was taken
-    }
+    await report(all, reports);
     relay.tickNear();
     assert.deepEqual(await listed(vi, 1), ['x']);
     assert.deepEqual(await listed(x, 1), ['vi']);
@@ -305,6 +315,29 @@ test('what the firmware reports it heard, the relay takes: each phone lists the
   }
 });
 
+test("what the firmware reports of the markers, the relay takes: others see each band's person in its area", { skip }, async () => {
+  const relay = await createRelay({ port: 0, host: '127.0.0.1', root: dir });
+  const socks = [];
+  try {
+    const all = await pairedBands(relay.port, 'mark-room', ['vi', 'x', 'y'], socks);
+    const [vi, x, y] = all;
+    // vi heard the bar's marker, x the stage's and y the back's, each clearly, and y a letter no marker has.
+    const reports = speak([`heard 6 ${x.air}:-48 ${y.air}:-50 b=-45`, `heard 6 ${vi.air}:-49 s=-50`, `heard 6 ${vi.air}:-51 o=-52 x=-10`]);
+    assert.deepEqual(JSON.parse(reports[0]), { t: 'heard', ch: 6, near: [[x.air, -48], [y.air, -50]], marks: [['bar', -45]] });
+    assert.deepEqual(JSON.parse(reports[2]), { t: 'heard', ch: 6, near: [[vi.air, -51]], marks: [['back', -52]] });
+    await report(all, reports);
+    relay.tickNear();
+    // The firmware's areas are the relay's: each report was taken, and each person shows in its area.
+    const shows = (p, who, band) => p.person.until('view', (m) => m.view.near.some((r) => r.pick === who && r.band === band));
+    await shows(vi, 'x', 'by the stage');
+    await shows(vi, 'y', 'somewhere out the back');
+    await shows(x, 'vi', 'near the bar');
+  } finally {
+    for (const s of socks) s.ws.terminate();
+    await relay.close();
+  }
+});
+
 test('the firmware and the stand-in keep the same constants, by name', { skip }, () => {
   const [consts] = speak(['consts']);
   assert.deepEqual(JSON.parse(consts), CONSTS);
````

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/firmware.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)|error: " | head -5`

Expected: the host tests do not compile, so every test in the file fails (`ℹ tests 107`, `ℹ fail 107`), first at `logic_test.cpp:716:9: error: 'MARK_AREAS' was not declared in this scope`, then `'markNamed'` and `'markLettered'`.

- [ ] **Step 3: Implement.**

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -1168,9 +1168,54 @@ constexpr uint32_t BEACON_MS = 500;        // a beacon this often
 constexpr uint32_t LISTEN_MS = 1000;       // a listen lasts this long...
 constexpr uint32_t HEAR_EVERY_MS = 10000;  // ...once in this long, and is reported as soon as it ends
 constexpr size_t HEARD_MAX = 12;           // a report names the strongest this many bands
-constexpr size_t FRAME_MAX = 320;          // the longest frame a band sends, its ending 0 counted: a full report is 294
+constexpr size_t FRAME_MAX = 384;          // the longest frame a band sends, its ending 0 counted: a full report is 346
 constexpr uint8_t BEACON[4] = {'O', 'T', 'B', '1'};  // all a beacon says; the address it comes from says whose
 
+// ---------- markers: a band the venue leaves at the bar or by the stage ----------
+//
+// A marker joins no Wi-Fi and reaches no relay: it beacons MARK_BEACON and
+// its area's letter on every channel in turn, so a band hears it whatever
+// channel the venue's Wi-Fi is on. A band's listen keeps the markers it heard
+// beside the bands, and the relay names each person's area from them
+// (docs/superpowers/specs/2026-09-27-wrist-markers-design.md).
+
+constexpr uint8_t MARK_BEACON[4] = {'O', 'T', 'B', 'M'};  // a marker's beacon, then its area's letter
+constexpr int MARK_CHANNELS = 13;                         // a marker beacons on channels 1 to this, in turn
+
+/** An area a marker can name: its word on the console and in a report, as relay/room.js MARKS has it; its letter on the air; its face. */
+struct MarkArea {
+  const char* area;
+  char letter;
+  const char* words;
+};
+constexpr MarkArea MARK_AREA[] = {
+    {"bar", 'b', "NEAR THE BAR"},
+    {"stage", 's', "BY THE STAGE"},
+    {"back", 'o', "OUT THE BACK"},
+};
+constexpr size_t MARK_AREAS = sizeof MARK_AREA / sizeof MARK_AREA[0];
+
+/** The area a word names, as `marker bar` on the console says it, or -1. */
+inline int markNamed(const std::string& area) {
+  for (size_t i = 0; i < MARK_AREAS; ++i)
+    if (area == MARK_AREA[i].area) return static_cast<int>(i);
+  return -1;
+}
+
+/** The area a beacon's letter names, or -1: a letter no marker has is nothing. */
+inline int markLettered(uint8_t letter) {
+  for (size_t i = 0; i < MARK_AREAS; ++i)
+    if (letter == static_cast<uint8_t>(MARK_AREA[i].letter)) return static_cast<int>(i);
+  return -1;
+}
+
+/** One sweep of a marker's beacon, every BEACON_MS: channel 1 to MARK_CHANNELS, in turn. */
+inline std::vector<int> markSweep() {
+  std::vector<int> s;
+  for (int ch = 1; ch <= MARK_CHANNELS; ++ch) s.push_back(ch);
+  return s;
+}
+
 /** Six address bytes as twelve lower-case hex digits, as the hello's air and a report write them. */
 inline std::string airHex(const uint8_t* mac) {
   static const char DIGITS[] = "0123456789abcdef";
@@ -1193,13 +1238,17 @@ inline void makeAir(uint8_t* out, const std::function<uint32_t()>& random32) {
   out[5] = static_cast<uint8_t>(b >> 8);
 }
 
-/** One listen: each band heard, at the strongest of its beacons, and only the strongest HEARD_MAX bands. */
+/** One listen: each band heard, at the strongest of its beacons, and only the strongest HEARD_MAX bands; and each marker area heard. */
 class Hearing {
  public:
   struct Heard {
     uint8_t mac[6];
     int rssi;
   };
+  struct Marked {
+    const char* area;
+    int rssi;
+  };
 
   /** A beacon from `mac` at `rssi` dBm, brought into -100..0, the range the relay takes. */
   void heard(const uint8_t* mac, int rssi) {
@@ -1222,8 +1271,21 @@ class Hearing {
     if (rssi > weakest->rssi) *weakest = h;
   }
 
+  /** A marker's beacon with `letter` at `rssi` dBm: each area once, at its strongest, brought into -100..0 as a band's is. */
+  void heardMark(uint8_t letter, int rssi) {
+    const int i = markLettered(letter);
+    if (i < 0) return;
+    rssi = rssi < -100 ? -100 : rssi > 0 ? 0 : rssi;
+    if (!marked_[i] || rssi > marks_[i]) marks_[i] = rssi;
+    marked_[i] = true;
+  }
+
+  /** How many bands were heard; markers are never among them. */
   size_t size() const { return heard_.size(); }
-  void clear() { heard_.clear(); }
+  void clear() {
+    heard_.clear();
+    for (bool& m : marked_) m = false;
+  }
 
   /** Everyone heard, the strongest first. */
   std::vector<Heard> strongest() const {
@@ -1232,7 +1294,19 @@ class Hearing {
     return s;
   }
 
-  /** The report the relay reads: {"t":"heard","ch":6,"near":[["02abcdef0123",-48],...]}. Heard nobody, near is []. */
+  /** Each marker area heard, the strongest first. */
+  std::vector<Marked> marks() const {
+    std::vector<Marked> s;
+    for (size_t i = 0; i < MARK_AREAS; ++i)
+      if (marked_[i]) s.push_back({MARK_AREA[i].area, marks_[i]});
+    std::stable_sort(s.begin(), s.end(), [](const Marked& x, const Marked& y) { return x.rssi > y.rssi; });
+    return s;
+  }
+
+  /**
+   * The report the relay reads: {"t":"heard","ch":6,"near":[["02abcdef0123",-48],...]}. Heard nobody, near is [].
+   * Heard a marker, it ends ,"marks":[["bar",-52],...]; heard none, it says nothing of markers.
+   */
   std::string frame(int ch) const {
     std::string f = "{\"t\":\"heard\",\"ch\":" + std::to_string(ch) + ",\"near\":[";
     bool first = true;
@@ -1240,11 +1314,44 @@ class Hearing {
       f += std::string(first ? "" : ",") + "[\"" + airHex(h.mac) + "\"," + std::to_string(h.rssi) + "]";
       first = false;
     }
-    return f + "]}";
+    f += "]";
+    const std::vector<Marked> m = marks();
+    if (!m.empty()) {
+      f += ",\"marks\":[";
+      for (size_t i = 0; i < m.size(); ++i) f += std::string(i ? "," : "") + "[\"" + m[i].area + "\"," + std::to_string(m[i].rssi) + "]";
+      f += "]";
+    }
+    return f + "}";
   }
 
  private:
   std::vector<Heard> heard_;
+  bool marked_[MARK_AREAS] = {};
+  int marks_[MARK_AREAS] = {};
+};
+
+/** A marker: the area it names, the beacon it sends, and its face, dark until a key lights it for WAKE_MS. */
+class Marker {
+ public:
+  explicit Marker(int area) : area_(area) {}
+
+  const char* area() const { return MARK_AREA[area_].area; }
+  std::vector<uint8_t> beacon() const {
+    return {MARK_BEACON[0], MARK_BEACON[1], MARK_BEACON[2], MARK_BEACON[3], static_cast<uint8_t>(MARK_AREA[area_].letter)};
+  }
+
+  /** Either key, pressed or held: there is nothing else for a key to do on a marker. */
+  void press(uint32_t now) {
+    pressed_ = true;
+    pressedAt_ = now;
+  }
+  bool lit(uint32_t now) const { return pressed_ && now - pressedAt_ < WAKE_MS; }
+  Words words() const { return {"MARKER", MARK_AREA[area_].words}; }
+
+ private:
+  int area_;
+  bool pressed_ = false;
+  uint32_t pressedAt_ = 0;
 };
 
 /**
````

- [ ] **Step 4: Run** — the file (`ℹ pass 107` of 107; the host binary says `ok: 552 checks`), then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 417`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`. Run it in the background: thirteen C++ mutations take about twenty minutes, and nothing else may run the relay or build the band meanwhile (P1).

````json
[
 {
  "label": "the outbox as it was",
  "file": "firmware/src/band_logic.h",
  "from": "constexpr size_t FRAME_MAX = 384;",
  "to": "constexpr size_t FRAME_MAX = 320;",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "a letter no marker has is the bar",
  "file": "firmware/src/band_logic.h",
  "from": "    if (letter == static_cast<uint8_t>(MARK_AREA[i].letter)) return static_cast<int>(i);\n  return -1;",
  "to": "    if (letter == static_cast<uint8_t>(MARK_AREA[i].letter)) return static_cast<int>(i);\n  return 0;",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks",
   "what the firmware reports of the markers, the relay takes: others see each band's person in its area"
  ]
 },
 {
  "label": "any word names the bar",
  "file": "firmware/src/band_logic.h",
  "from": "    if (area == MARK_AREA[i].area) return static_cast<int>(i);\n  return -1;",
  "to": "    if (area == MARK_AREA[i].area) return static_cast<int>(i);\n  return 0;",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "an area the relay does not have",
  "file": "firmware/src/band_logic.h",
  "from": "    {\"back\", 'o', \"OUT THE BACK\"},",
  "to": "    {\"out\", 'o', \"OUT THE BACK\"},",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks",
   "what the firmware reports of the markers, the relay takes: others see each band's person in its area"
  ]
 },
 {
  "label": "the latest beacon, not the strongest",
  "file": "firmware/src/band_logic.h",
  "from": "    if (!marked_[i] || rssi > marks_[i]) marks_[i] = rssi;",
  "to": "    marks_[i] = rssi;",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "a marker's reading out of range",
  "file": "firmware/src/band_logic.h",
  "from": "    if (i < 0) return;\n    rssi = rssi < -100 ? -100 : rssi > 0 ? 0 : rssi;\n",
  "to": "    if (i < 0) return;\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "a cleared listen keeps its markers",
  "file": "firmware/src/band_logic.h",
  "from": "    heard_.clear();\n    for (bool& m : marked_) m = false;\n",
  "to": "    heard_.clear();\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "marks said though none was heard",
  "file": "firmware/src/band_logic.h",
  "from": "    if (!m.empty()) {\n      f += \",\\\"marks\\\":[\";",
  "to": "    if (true) {\n      f += \",\\\"marks\\\":[\";",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks",
   "what the firmware reports it heard, the relay takes: each phone lists the bands its band heard"
  ]
 },
 {
  "label": "marks in area order, not strongest first",
  "file": "firmware/src/band_logic.h",
  "from": "    std::stable_sort(s.begin(), s.end(), [](const Marked& x, const Marked& y) { return x.rssi > y.rssi; });\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "a marker beacons as a band",
  "file": "firmware/src/band_logic.h",
  "from": "constexpr uint8_t MARK_BEACON[4] = {'O', 'T', 'B', 'M'};",
  "to": "constexpr uint8_t MARK_BEACON[4] = {'O', 'T', 'B', '1'};",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "a sweep short of channel 13",
  "file": "firmware/src/band_logic.h",
  "from": "  for (int ch = 1; ch <= MARK_CHANNELS; ++ch) s.push_back(ch);",
  "to": "  for (int ch = 1; ch < MARK_CHANNELS; ++ch) s.push_back(ch);",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "a marker's face lit for good",
  "file": "firmware/src/band_logic.h",
  "from": "  bool lit(uint32_t now) const { return pressed_ && now - pressedAt_ < WAKE_MS; }",
  "to": "  bool lit(uint32_t now) const { return pressed_ && now - pressedAt_ < UINT32_MAX; }",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "a marker's face lit before any key",
  "file": "firmware/src/band_logic.h",
  "from": "  bool lit(uint32_t now) const { return pressed_ && now - pressedAt_ < WAKE_MS; }",
  "to": "  bool lit(uint32_t now) const { return now - pressedAt_ < WAKE_MS; }",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add firmware/host/logic_test.cpp firmware/src/band_logic.h tests/firmware.test.js
```

````bash
git commit -F - <<'EOF'
A band keeps the markers it heard and says them; a marker has its beacon and face

A listen keeps each marker area it heard once, at the strongest of its
beacons, brought into -100..0 as a band's reading is; a letter no marker has
is nothing, and a marker is never among the bands. The report ends with
marks, strongest first, only when it heard a marker; the longest, twelve
bands and three markers on channel 14, is 346 bytes, so FRAME_MAX grows to
384. A marker beacons OTBM and its area's letter on channels 1 to 13 in
turn; its face is dark until a key lights MARKER over its area for WAKE_MS.
Three bands paired in one room report as the firmware writes them, and each
phone shows the others in the area its band heard.

Mutation-checked: 13 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 5: A band can be a marker: it beacons its area on every channel, and its console says so

**Files:**
- Modify: `firmware/src/main.cpp`

**Interfaces:**
- Consumes: Task 4's `MARK_BEACON`, `MARK_CHANNELS`, `MARK_AREA`, `markNamed`, `markSweep`, `Marker`, `Hearing::heardMark` and `Hearing::marks`; near's `onAir()`, `Caught`, `hearTick()`, `reportNear()`, `BROADCAST` and `air`; `setting()`, `prefs`, `drawWords()`, `face`, `drawn`, `lit`, `readBattery()`, `run()`, `help()`, `setup()` and `loop()` in `main.cpp`; ESP-IDF 4.4's `esp_now_register_send_cb` and `esp_wifi_set_channel`.
- Produces: on a band set so, a marker from its next start; the console's `marker bar|stage|back|off`, which keeps the choice and restarts; a marker's own console (`show`, `press`, `marker`); on a wristband, `near` listing the markers its last listen heard.

There is no automated test for this task: `main.cpp` is only the hardware, and nothing in it decides anything. The build (P3) holds it to both boards' compilers, and Task 7 holds it to the air.

- [ ] **Step 1: Write marker mode.** At boot, after the random address and before the key, a band whose kept `marker` names an area makes a `Marker` and does nothing else: no Wi-Fi join, no relay, no socket task, no key. ESP-NOW starts with the broadcast peer on whichever channel is set (`channel = 0`), 6 Mbps and a send callback that counts each beacon sent or lost. Every `BEACON_MS` the loop sets each channel of `markSweep()` in turn, sends the beacon, and waits up to 20 ms for the callback before the next, as the spike did (a sweep of thirteen took 30 ms, 42 at most, and every send got out). Either key lights the face, `MARKER` over the area's words, for `WAKE_MS`; otherwise the backlight is off. On a marker the console takes only `show`, `press`, `hold`, `marker` and `marker off`; on a wristband `marker bar|stage|back` keeps the area and restarts, and `marker off` on a wristband says it is one already. A wristband's promiscuous callback also takes `OTBM` and the byte after it into the ring, marked as a marker's, and the loop hands those to `heardMark()`; `near` lists the markers under the bands.

````diff
--- a/firmware/src/main.cpp
+++ b/firmware/src/main.cpp
@@ -14,6 +14,9 @@
 // and the listen that tell the relay which bands are near, and a serial
 // console to say which Wi-Fi and which relay. The socket has a task of its
 // own, so nothing the network does can hold up the button or the screen.
+//
+// Or, set so on the console, it is a marker the venue leaves at the bar or by
+// the stage, and does nothing else: it beacons its area on every channel.
 
 #include <M5Unified.h>
 #include <Preferences.h>
@@ -345,13 +348,18 @@ uint32_t lastHeardAt = 0;             // 0 until a listen has ended
 struct Caught {
   uint8_t mac[6];
   int rssi;
+  bool mark;       // a marker's beacon, not a band's
+  uint8_t letter;  // a marker's: its letter, whatever it is (Hearing ignores one no marker has)
 };
 constexpr size_t CAUGHT_MAX = 32;
 Caught caught[CAUGHT_MAX];
 size_t caughtCount = 0;
 portMUX_TYPE caughtLock = portMUX_INITIALIZER_UNLOCKED;
 
-/** On the Wi-Fi task: an ESP-NOW frame (a vendor-specific action frame) that carries BEACON. Its sender is address 2. */
+/**
+ * On the Wi-Fi task: an ESP-NOW frame (a vendor-specific action frame) that
+ * carries BEACON, or MARK_BEACON and a letter. Its sender is address 2.
+ */
 void onAir(void* buf, wifi_promiscuous_pkt_type_t type) {
   if (type != WIFI_PKT_MGMT) return;
   const auto* p = static_cast<const wifi_promiscuous_pkt_t*>(buf);
@@ -359,11 +367,14 @@ void onAir(void* buf, wifi_promiscuous_pkt_type_t type) {
   const int len = static_cast<int>(p->rx_ctrl.sig_len);
   if (len < 29 || d[0] != 0xD0 || d[24] != 127) return;
   for (int i = 25; i + static_cast<int>(sizeof BEACON) <= len; ++i) {
-    if (memcmp(d + i, BEACON, sizeof BEACON) != 0) continue;
+    const bool mark = i + static_cast<int>(sizeof MARK_BEACON) < len && memcmp(d + i, MARK_BEACON, sizeof MARK_BEACON) == 0;
+    if (!mark && memcmp(d + i, BEACON, sizeof BEACON) != 0) continue;
     portENTER_CRITICAL_ISR(&caughtLock);
     if (caughtCount < CAUGHT_MAX) {
       memcpy(caught[caughtCount].mac, d + 10, 6);
       caught[caughtCount].rssi = p->rx_ctrl.rssi;
+      caught[caughtCount].mark = mark;
+      caught[caughtCount].letter = mark ? d[i + sizeof MARK_BEACON] : 0;
       ++caughtCount;
     }
     portEXIT_CRITICAL_ISR(&caughtLock);
@@ -412,7 +423,10 @@ void hearTick(uint32_t now) {
     hearing.clear();
     return;
   }
-  for (size_t i = 0; i < n; ++i) hearing.heard(got[i].mac, got[i].rssi);
+  for (size_t i = 0; i < n; ++i) {
+    if (got[i].mark) hearing.heardMark(got[i].letter, got[i].rssi);
+    else hearing.heard(got[i].mac, got[i].rssi);
+  }
   if (beaconWanted && now - beaconAt >= BEACON_MS) {
     beaconAt = now;
     if (esp_now_send(BROADCAST, BEACON, sizeof BEACON) == ESP_OK) ++beacons;
@@ -453,9 +467,100 @@ void reportNear(uint32_t now) {
     Serial.println("        no listen yet");
     return;
   }
+  const std::vector<Hearing::Marked> marks = lastHeard.marks();
   Serial.printf("        last listen %u s ago, channel %d: %s\n", static_cast<unsigned>((now - lastHeardAt) / 1000), lastChannel,
-                lastHeard.size() ? "heard" : "heard nobody");
+                lastHeard.size() || !marks.empty() ? "heard" : "heard nobody");
   for (const Hearing::Heard& h : lastHeard.strongest()) Serial.printf("        %s  %d dBm\n", airHex(h.mac).c_str(), h.rssi);
+  for (const Hearing::Marked& m : marks) Serial.printf("        marker %s  %d dBm\n", m.area, m.rssi);
+}
+
+// ---------- a marker ----------
+//
+// `marker bar`, `marker stage` or `marker back` on the console makes the band
+// a marker, kept as the Wi-Fi is, and restarts it as one; `marker off` makes
+// it a wristband again. A marker joins no Wi-Fi, reaches no relay, has no key
+// and no letters. Every BEACON_MS it sends Marker::beacon() once on each
+// channel of markSweep(), waiting for each send to leave before it changes
+// channel: on the spike, a sweep of thirteen took 30 ms, 42 at most, and every
+// send got out. Its face is dark until a key lights it (band_logic.h).
+
+Marker* marker = nullptr;             // made in setup() when the band is one: then nothing else runs
+bool markerReady = false;             // ESP-NOW is up
+std::atomic<bool> markSending{false};
+std::atomic<uint32_t> markSent{0}, markLost{0};
+uint32_t markAt = 0, markRefused = 0, markSweepMs = 0;
+
+/** On the Wi-Fi task: a beacon has left, or could not. */
+void onMarkSent(const uint8_t*, esp_now_send_status_t status) {
+  if (status == ESP_NOW_SEND_SUCCESS) ++markSent;
+  else ++markLost;
+  markSending = false;
+}
+
+void startMarker() {
+  WiFi.disconnect();
+  if (esp_now_init() != ESP_OK) {
+    Serial.println("marker: ESP-NOW would not start");
+    return;
+  }
+  esp_now_register_send_cb(onMarkSent);
+  esp_now_peer_info_t peer = {};
+  memcpy(peer.peer_addr, BROADCAST, 6);
+  peer.channel = 0;  // whichever channel the sweep has set
+  peer.ifidx = WIFI_IF_STA;
+  peer.encrypt = false;
+  esp_now_add_peer(&peer);
+  if (esp_wifi_config_espnow_rate(WIFI_IF_STA, WIFI_PHY_RATE_6M) != ESP_OK) Serial.println("marker: 6 Mbps refused");
+  markerReady = true;
+}
+
+/** Every BEACON_MS, one sweep: the beacon on each channel in turn. */
+void markerTick(uint32_t now) {
+  if (!markerReady || now - markAt < BEACON_MS) return;
+  markAt = now;
+  const std::vector<uint8_t> beacon = marker->beacon();
+  for (const int ch : markSweep()) {
+    if (esp_wifi_set_channel(static_cast<uint8_t>(ch), WIFI_SECOND_CHAN_NONE) != ESP_OK) {
+      ++markRefused;
+      continue;
+    }
+    markSending = true;
+    if (esp_now_send(BROADCAST, beacon.data(), beacon.size()) != ESP_OK) {
+      markSending = false;
+      ++markRefused;
+      continue;
+    }
+    const uint32_t sentAt = millis();
+    while (markSending && millis() - sentAt < 20) delay(1);
+  }
+  markSweepMs = millis() - now;
+}
+
+void reportMarker() {
+  Serial.printf("marker  %s, as %s, on channels 1 to %d every %u ms%s\n", marker->area(), airHex(air).c_str(), MARK_CHANNELS,
+                static_cast<unsigned>(BEACON_MS), markerReady ? "" : ": not beaconing, ESP-NOW would not start");
+  Serial.printf("        %u beacons sent, %u lost, %u refused; the last sweep took %u ms\n", static_cast<unsigned>(markSent),
+                static_cast<unsigned>(markLost), static_cast<unsigned>(markRefused), static_cast<unsigned>(markSweepMs));
+  Serial.printf("battery %d%%\n", battery);
+}
+
+/** `marker bar|stage|back|off`: kept, and a restart to be it. */
+void setMarker(const std::string& a) {
+  const int area = markNamed(a);
+  if (area < 0 && a != "off") {
+    Serial.println("marker bar, marker stage, marker back, or marker off");
+    return;
+  }
+  if (area < 0 && !marker) {
+    Serial.println("a wristband already");
+    return;
+  }
+  if (area >= 0) prefs.putString("marker", a.c_str());
+  else prefs.remove("marker");
+  Serial.printf("%s%s: restarting\n", area >= 0 ? "a marker, " : "a wristband", area >= 0 ? MARK_AREA[area].area : "");
+  Serial.flush();
+  delay(200);
+  ESP.restart();
 }
 
 // ---------- the screen ----------
@@ -632,6 +737,23 @@ void draw(uint32_t now) {
   }
 }
 
+/** A marker's face: dark, and what it is while a key has lit it. */
+void drawMarker(uint32_t now) {
+  const bool on = marker->lit(now);
+  if (on && drawn != "marker") {
+    drawn = "marker";
+    const float k = std::min(face.width() / 135.0f, face.height() / 240.0f);
+    face.fillScreen(BLACK);
+    drawWords(marker->words(), WHITE, k);
+    face.pushSprite(0, 0);
+  }
+  const int light = on ? LIGHT_FULL : LIGHT_OFF;
+  if (light != lit) {
+    lit = light;
+    M5.Display.setBrightness(light);
+  }
+}
+
 // ---------- sound ----------
 
 /** The speaker has finished reading a buffer, so it may be written again. Runs on the speaker's own task. */
@@ -683,7 +805,16 @@ void help() {
       "  face                    what the screen shows now\n"
       "  sound <name>            play one of the band's sounds, e.g. sound found\n"
       "  near                    what it last heard of other bands, and whether it beacons\n"
-      "  near off|listen|on      stop both, stop only beaconing, or do both again");
+      "  near off|listen|on      stop both, stop only beaconing, or do both again\n"
+      "  marker bar|stage|back   make it a marker at the bar, by the stage or out the back (it restarts)");
+}
+
+void helpMarker() {
+  Serial.println(
+      "  show                    which marker, and its beacons\n"
+      "  press face|side         light its face, as a finger does\n"
+      "  marker bar|stage|back   another area (it restarts)\n"
+      "  marker off              a wristband again (it restarts)");
 }
 
 void report() {
@@ -710,6 +841,13 @@ void report() {
 }
 
 void run(const Command& c) {
+  if (marker) {  // a marker takes nothing that would join a Wi-Fi or a relay
+    if (c.verb == "marker") setMarker(trim(c.arg));
+    else if (c.verb == "show") reportMarker();
+    else if (c.verb == "press" || c.verb == "hold") marker->press(millis());
+    else helpMarker();
+    return;
+  }
   if (c.verb == "ssid") {
     ssid = trim(c.arg);
     prefs.putString("ssid", ssid.c_str());
@@ -759,6 +897,8 @@ void run(const Command& c) {
       beaconWanted = a == "on";
     }
     reportNear(millis());
+  } else if (c.verb == "marker") {
+    setMarker(trim(c.arg));
   } else if (c.verb == "forget") {
     prefs.remove("ssid");
     prefs.remove("pass");
@@ -852,11 +992,22 @@ void setup() {
   // before, and it is never the chip's own.
   makeAir(air, [] { return static_cast<uint32_t>(esp_random()); });
   airSet = esp_wifi_set_mac(WIFI_IF_STA, air) == ESP_OK;
+  prefs.begin("otb", false);
+  if (prefs.isKey("id")) prefs.remove("id");  // the id an older build kept for good is not kept any more
+  // A marker is nothing else: no Wi-Fi, no relay, no key; the loop only beacons.
+  const int area = markNamed(setting("marker", ""));
+  if (area >= 0) {
+    marker = new Marker(area);
+    startMarker();
+    readBattery(millis());
+    Serial.printf("\nON THE BEAT marker: %s\n", MARK_AREA[area].area);
+    helpMarker();
+    reportMarker();
+    return;
+  }
   // A new wristband at every boot: the key lives in RAM only, and the id is its hash.
   wrist = new Wrist(makeKey([] { return static_cast<uint32_t>(esp_random()); }));
   if (airSet) wrist->setAir(airHex(air));
-  prefs.begin("otb", false);
-  if (prefs.isKey("id")) prefs.remove("id");  // the id an older build kept for good is not kept any more
   loadSettings();
   readBattery(millis());
   wrist->setBattery(battery, millis());
@@ -885,6 +1036,13 @@ void loop() {
   const uint32_t now = millis();
   console();
   readBattery(now);
+  if (marker) {
+    if (M5.BtnA.isPressed() || M5.BtnB.isPressed()) marker->press(now);
+    markerTick(now);
+    drawMarker(now);
+    delay(10);
+    return;
+  }
   readUsb(now);
   drain(now);
   // KEY1 is the face button, KEY2 the side one. The Wrist times the holds. A key
````

- [ ] **Step 2: Build (P3).** Expected: two `[SUCCESS]` lines, no `src/` warning; `m5stickc` RAM 21.7%, flash 39.5%; `m5sticks3` RAM 21.5%, flash 37.0%.

- [ ] **Step 3: Run** `npm test`, which compiles `band_logic.h` and reads `main.cpp` only for its `struct Event` and for old words. Expected: `ℹ fail 0`, `ℹ tests 417`.

- [ ] **Step 4: Commit, and close Stage B with P2**

```bash
git add firmware/src/main.cpp
```

````bash
git commit -F - <<'EOF'
A band can be a marker: it beacons its area on every channel

marker bar, marker stage or marker back on the console keeps the area and
restarts the band as a marker, which joins no Wi-Fi, reaches no relay and
has no key. Every BEACON_MS it sends its beacon once on each channel from 1
to 13, waiting for each send to leave before changing channel, as the spike
on both bands did. Either key lights its face for WAKE_MS. Its console takes
only show, press, another marker, and marker off, which restarts it as a
wristband. A wristband's listen takes a marker's beacon into its report,
and near lists the markers under the bands.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---

## Stage C — Docs and proof

### Task 6: The README says markers name the areas

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the README.** Promise 1 says only a marker names a finer band; *Who is near* no longer says every row is `in this room`, and the wristband section gains *Markers say near the bar and by the stage*, with the crowd model's figures from Task 3; the console paragraph gains the marks under `near`, and `marker`; the canvas section says why a marker names an area only when heard clearly, and why there is a third; abuse resistance gains `marks` under *What a wristband says it heard*, and *A marker anyone can make*; *What is not done* loses the markers from near's list and gains *Markers are modelled, not walked*.

````diff
--- a/README.md
+++ b/README.md
@@ -84,10 +84,11 @@ each one.
    `near the bar`, `by the stage`, `somewhere out the back` — and nothing
    finer. There is no position anywhere in the system to leak. On phones
    alone, everyone is `in this room`: a web page cannot tell where in a venue
-   a phone is, and it does not guess. The finer bands wait for markers a
-   venue would put up, which are not built. What wristbands hear of each
-   other only takes people off SAY HI's list (*Who is near*, below), and no
-   phone or wristband is ever told how near anyone is.
+   a phone is, and it does not guess. Only a marker the venue puts up, heard
+   clearly by a person's own wristband, names a finer band (*Markers*,
+   below). What wristbands hear of each other only takes people off SAY HI's
+   list (*Who is near*, below), and no phone or wristband is ever told how
+   near anyone is.
 2. **No name and no photo until you both say yes.** Before a mutual yes a
    person is a handle, a band and at most a track. Handles are per viewer —
    the same person has a different handle on every phone — so two phones
@@ -118,9 +119,10 @@ never becomes a match.
   put two phones at the same gig into two different rooms that share a name.
   The night is held in memory only; stop the relay and it is gone.
   - After every change the relay pushes each phone its own `viewFor()`.
-  - What each wristband heard of the others is kept 30 s, in memory, and
-    never leaves the relay; every five seconds each room works out who is
-    near whom and pushes only the views that changed.
+  - What each wristband heard of the others and of the markers is kept
+    30 s, in memory, and never leaves the relay; every five seconds each
+    room works out who is near whom and who is in which area, and pushes
+    only the views that changed.
   - A dropped socket is not leaving: a person stays in the room for two
     minutes, so a locked screen does not cost them their place.
   - Clips are kept in memory, one on the floor per person, for an hour —
@@ -271,11 +273,30 @@ that was taken.
   Wi-Fi channel — so a band just switched on or gone quiet, a band on another
   channel, and the stand-in at `/band`, which has no radio, hide nobody and
   are hidden from nobody. No strength, score or order reaches a phone or a
-  band: the list is only shorter, the rows are in the same order, and every
-  one still says `in this room`. On a modelled floor of 750 people, 150 of
-  them banded, with bodies in the way, 99.8% of each five are truly within
-  10 m, against 33% for five picked at random from what the band heard
-  (`tests/near-crowd.test.js`).
+  band: the list is only shorter, the rows are in the same order, and a row's
+  area comes only from the markers (below). On a modelled floor of 750
+  people, 150 of them banded, with bodies in the way, 99.8% of each five are
+  truly within 10 m, against 33% for five picked at random from what the band
+  heard (`tests/near-crowd.test.js`).
+- **Markers say near the bar and by the stage.** Any wristband can be a
+  marker: `marker bar`, `marker stage` or `marker back` on its console, kept
+  across restarts. A marker joins no Wi-Fi, reaches no relay and has no key:
+  plugged into a charger behind the bar, it beacons five bytes, `OTBM` and
+  its area's letter, twice a second on every Wi-Fi channel from 1 to 13 in
+  turn, so a band hears it whatever channel the venue's Wi-Fi is on. Its face
+  is dark; a press shows `MARKER` over `NEAR THE BAR`, `BY THE STAGE` or `OUT
+  THE BACK`. A band's listen keeps the markers it heard beside the bands, the
+  strongest reading of each, and its report says them. For each person the
+  relay takes the median of each marker's readings in the last 30 s; the
+  loudest names the person's area on every row that shows them if it is -56
+  dBm or louder, and an area holds while its marker is -60 or louder and no
+  other is 4 dB louder. Anyone else is `in this room`: no band, a band gone
+  quiet, or no marker heard clearly. No phone names an area. On the modelled
+  floor with a marker at each end, the wrong marker was named for at most
+  0.21% of the people named, nine in ten of them were within 10 m of their
+  marker, and an area changed at no more than 3.6% of listens
+  (`tests/markers-crowd.test.js`); the price is that most people stay `in
+  this room`, 12 to 35% named, since unnamed is better than named wrong.
 - **The sound can be switched off, on the phone.** The wristband sheet has
   `SOUND: ON` under TEST THE LIGHT; off, the band only lights up. The switch is
   the person's own: the phone keeps it across nights and re-says it after
@@ -336,7 +357,7 @@ a dead socket. Its two buttons work as above.
 ```
 cd firmware
 pio run -t upload       # build it and flash it over USB
-pio device monitor      # its console: ssid, pass, relay, show, forget, press, hold, face
+pio device monitor      # its console: ssid, pass, relay, show, forget, press, hold, face, near, marker
 
 pio run -e m5sticks3 -t upload    # the same, for a StickS3
 ```
@@ -361,7 +382,13 @@ name, plays it, to hear the speaker without a room around the band. `near`
 says whether it is beaconing and listening, the address it is on the air
 under, and what its last listen heard; `near off` stops both, to test a band
 gone quiet, `near listen` stops only the beacon, so two bands both told it
-hear nobody and say so, and `near on` starts both again. On the Plus, `show` also says
+hear nobody and say so, and `near on` starts both again; the markers the last
+listen heard are listed under the bands. `marker bar`, `marker stage` or
+`marker back` makes the band a marker and restarts it as one. A marker's
+console takes only `show` (its area, its address on the air this boot, the
+beacons sent, lost and refused, and how long the last sweep of the thirteen
+channels took), `press` to light its face, another `marker`, and `marker
+off`, which restarts it as a wristband. On the Plus, `show` also says
 what the band draws from USB, the mean since the last `show`. Only the
 USB cable reaches the console, and
 whoever holds the cable holds the band and its buttons anyway; no frame from
@@ -516,6 +543,13 @@ the relay reaches it.
   S5's own limit of five. People without a band cannot be heard, which says
   nothing about where they are, so they are listed as before; the owner chose
   that on 26 Sep 2026.
+- **A marker names an area only when it is heard clearly.** Revision 6 takes
+  the loudest marker. Far from every marker the loudest is still some marker,
+  heard faintly across the room, so it names a band only at -56 dBm or
+  louder, and otherwise the person stays `in this room`: the owner chose on
+  27 Sep 2026 that it is better not to say than to say it wrong. A third
+  marker, `somewhere out the back`, which the prompt's list of bands already
+  has, is allowed; revision 6 names only the bar and the stage.
 
 ## Abuse resistance
 
@@ -576,7 +610,16 @@ was red-teamed and hardened. A red/blue pass found and closed:
   only its own person's list, and nearness only ever removes, so it can show
   nobody a phone could not see already. A band beaconing under another's
   address moves that band's nearness to where the liar stands, among
-  strangers in the same room, and no further.
+  strangers in the same room, and no further. A report's `marks`, when it
+  has any, are at most three, each area `bar`, `stage` or `back` once and each
+  strength a whole number from -100 to 0, or the whole report is dropped; a
+  band that lies about them changes only its own person's area.
+- **A marker anyone can make.** A marker has no key: any ESP32 beaconing
+  `OTBM` and a letter, or repeating a real marker's beacon somewhere else,
+  makes the people whose bands hear it clearly read `near the bar` or the
+  like on others' rows. It chooses only among the three phrases, cannot show
+  anyone who was hidden, and learns nothing. A key would stop only inventing
+  a marker, not copying one, so there is none.
 - **Rooms that never emptied.** A venue with nobody in it, nobody in its grace
   window, no clip still loading and no wristband still worn is now reclaimed, so
   a long-lived relay does not keep a room object for every venue anyone typed.
@@ -640,11 +683,19 @@ relay could drive what a wrist shows.
   Bodies and reflections on a real floor may differ from the model; ranking
   the strongest was chosen because it leans on them least, and a walk
   through a venue is the check.
-  Not built: markers a venue puts up (`near the bar`, `by the stage`); a
-  correction between models, though a StickS3 heard a Plus 7 dB weaker than
-  the Plus heard it; and more than one Wi-Fi channel, since a band hears only
-  bands on its own channel, so a venue whose access points use several splits
-  its bands into groups, each of which keeps the others listed.
+  Not built: a correction between models, though a StickS3 heard a Plus 7 dB
+  weaker than the Plus heard it; and more than one Wi-Fi channel, since a
+  band hears only bands on its own channel, so a venue whose access points
+  use several splits its bands into groups, each of which keeps the others
+  listed. Markers do not have this problem: they beacon on every channel.
+- **Markers are modelled, not walked.** The -56 dBm floor rests on the crowd
+  model's losses for distance and bodies, calibrated on two bands on a desk;
+  a real venue's walls may want another floor, and it is one constant in
+  the relay (`MARK_FLOOR`). There is one floor for every venue, and a marker
+  is not listed or shown to the venue anywhere. Channels 12 and 13 are
+  allowed in Australia and not everywhere: a marker used elsewhere would
+  hop 1 to 11. A marker on a laptop's USB may be switched off with it; a
+  marker wants a wall charger.
 - **The firmware has run on two wristbands, for one day.** On 25 Sep
   2026 a StickS3 and an M5StickC Plus joined an Android phone's hotspot and
   reached the relay through a quick tunnel, with that phone and a laptop
````

- [ ] **Step 2: Run** `npm test` (`tests/copy.test.js` reads the README for the one-button wristband's words). Expected: `ℹ fail 0`, `ℹ tests 417`.

- [ ] **Step 3: Commit**

```bash
git add README.md
```

````bash
git commit -F - <<'EOF'
README: markers name the areas

Promise 1 says only a marker names a finer band. The wristband section
gains the markers, with the crowd model's figures; the console paragraph
the marks under near, and marker; the canvas section why a marker names an
area only when heard clearly, and the third marker; abuse resistance the
checks on marks and the marker anyone can make; What is not done drops the
markers from near's list and says they are modelled, not walked.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 7: The real bands, with the owner

Nothing here is automated, and every step needs the owner: flashing needs his yes first, and a band he wears is his. The relay must be the one with Tasks 1–2: deploy it to Fly first if the band is to use `https://on-the-beat.fly.dev` (he logs in himself; deploy any time except while he has said a demo is on), or run `npm start` and `npm run tunnel` and give the band the tunnel's address with `relay`.

- [ ] **Step 1: Flash both** (P3's directories, `-t upload`, `--upload-port COM8` for the StickS3 and `COM9` for the Plus), after asking. On each console, `show` must say what it said before: a wristband, `near    not now: not paired`.
- [ ] **Step 2: Make the Plus a marker.** `marker bar` on its console: it says `a marker, bar: restarting`, and comes back as `ON THE BEAT marker: bar`. Ten seconds later `show` says about 260 beacons sent (thirteen channels, twice a second), none lost or refused, and a last sweep of about 30 ms. A press lights `MARKER` over `NEAR THE BAR` for six seconds; then the face is dark.
- [ ] **Step 3: A band hears it, and a phone says so.** Pair the StickS3 to a stand-in phone in the built-in browser, on SAY HI with a pick, and put a second stand-in with no band in the same room. Within one listen (10 s), `near` on the StickS3 lists `marker bar` at some dBm; at the next tick, the second stand-in's row for the first says `near the bar`, and the first stand-in's own view says it too. With the marker on the desk beside the band, the reading is far above -56 dBm (the spike heard it at -17 to -19).
- [ ] **Step 4: Gone, and back to `in this room`.** `marker off` on the Plus: it restarts as a wristband. Within `HEARD_MS` and a tick (about 35 s), the second stand-in's row says `in this room` again.
- [ ] **Step 5 (if the owner will walk):** the Plus a marker again, and the StickS3 carried away from it while `near` is read every listen. Where the reading falls under -56, and where the row turns back to `in this room`, is the floor's first check in a real room; note both distances.
- [ ] **Step 6: Leave the bands as found** (test personas memory): the Plus a wristband (`marker off`), both unpaired from the stand-ins, and say what state each band is left in. Add a paragraph to README's *What is not done* saying what ran and what did not, then commit and push.
