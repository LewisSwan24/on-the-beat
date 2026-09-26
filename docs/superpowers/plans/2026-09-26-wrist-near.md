# Who Is Near — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With wristbands on, SAY HI's list is the people who are near, not the whole room: of the people wearing a wristband, the five whose bands are heard most strongly, and never anyone the viewer could not already see. Without a band, nothing changes.

**Architecture:** Each band beacons four bytes (`OTB1`) by ESP-NOW broadcast under an address it makes up at every boot, listens one second in ten in promiscuous mode, and reports `{t:'heard', ch, near:[[air, rssi], ...]}` after every listen (`firmware/src/band_logic.h` keeps the listen and writes the frame; `firmware/src/main.cpp` holds the radio). The relay checks each report, maps each address to the person whose band says it in the hello, and hands the room the samples (`relay/server.js`). The room scores each pair by the median of both directions over 30 s, and every five seconds works out each band's five, sticky while among the ten strongest; `blue()` hides someone only on evidence (`relay/room.js`). Nothing new reaches a phone or a band: the list is shorter, and nothing says why.

**Tech Stack:** Node 22+ (`node --test`, `ws`), C++17 on the laptop (MinGW-W64 g++ here, GCC in CI), C++11 on the band (Arduino-ESP32 2.0.17 through PlatformIO `espressif32@^6.9.0`, ESP-IDF 4.4's `esp_now.h` and `esp_wifi.h`), M5Unified 0.2.22 or later.

**Spec:** `docs/superpowers/specs/2026-09-26-wrist-near-design.md` (decided with the owner section by section on 26 Sep 2026, after a spike on both real bands and a model of a crowd: §1 on the air, §2 the relay's five, §3 privacy and abuse, §4 who does what, §5 tests and proof). It narrows the SAY HI list of `docs/superpowers/specs/2026-09-25-wrist-waves-design.md`, whose plan is done. Read the near spec before any task.

This plan was written from a finished build: every task below was built in a scratch worktree (branch `near-build`), test first, and committed on its own with `npm test` green at every commit. The code blocks are those commits' diffs, so applying a task's blocks in order reproduces it. Each Step 2 was measured by running the task's tests on its parent's code, and each mutation list was measured at its task's commit.

## Global Constraints

- Artefacts are English: code, comments, commit messages, README, test names. Talk to the owner in Chinese.
- **Never a number, never a map** (promise 1, spec §3). No RSSI, score or rank ever reaches a phone or a band; what bands heard lives 30 s in the relay's memory and nowhere else. The list is not sorted by nearness, and every row still says `in this room`.
- **Nearness only removes.** It can never show anyone a phone could not see already (another room, blocked, NOT NOW). People with no band, anyone waved with either way, and anyone matched tonight are always listed and take no place in the five.
- **Hidden only on evidence.** From a viewer whose band reported in the last `HEARD_MS`, a person is hidden only if their band also reported in the last `HEARD_MS`, on the same channel, the viewer's five has been worked out, and they are not in it. A band just switched on, gone quiet or on another channel hides nobody and is hidden from nobody.
- **Constants** (`relay/room.js`): `HEARD_MS = 30_000`, `NEAR_FIVE = 5`, `NEAR_KEEP = 10`. (`relay/server.js`): `HEARD_GAP_MS = 5000` (exported), `HEARD_MAX = 16`, `NEAR_TICK_MS = 5000`, `AIR = /^[a-f0-9]{12}$/`. (`firmware/src/band_logic.h`): `BEACON_MS = 500`, `LISTEN_MS = 1000`, `HEAR_EVERY_MS = 10000`, `HEARD_MAX = 12`, `FRAME_MAX = 320`, `BEACON = "OTB1"` (four bytes, no ending 0).
- **On the air:** an ESP-NOW broadcast at 6 Mbps (`esp_wifi_config_espnow_rate(WIFI_IF_STA, WIFI_PHY_RATE_6M)`); a listen in promiscuous mode, management frames only, taking an ESP-NOW action frame (`d[0] == 0xD0`, category `d[24] == 127`) that carries `OTB1`, its sender address 2 (`d + 10`). The station address is random at every boot, locally administered and unicast (`(r & 0xFC) | 0x02`), set with `esp_wifi_set_mac` after `WiFi.mode(WIFI_STA)` and before the join; if the radio refuses it, the band neither beacons nor listens.
- **Frames:** the hello gains `"air":"<12 lower hex>"`, only when the band has one; a report is `{"t":"heard","ch":<1..14>,"near":[["<12 hex>",<-100..0>],...]}`, strongest first, at most 12 from the band, and `near: []` when it heard nobody. The relay refuses a hello whose `air` is not twelve lower-case hex (close 4001), and drops a report whole unless it is exactly that shape, from a paired band's current socket, no sooner than `HEARD_GAP_MS` after its last.
- **Not in this plan** (spec): the markers (`near the bar`, `by the stage`), a per-model correction, hopping channels, and anything on the phone: `app/` does not change.
- **The band's compiler takes C++11** and sees `Arduino.h`'s macros first; `firmware/host/as_band.cpp` holds `band_logic.h` to that on every run. A variable left unused is an error there (`-Werror`): a mutation that stops using one must still use it. On Windows `near` and `far` are macros in some headers: no name in this plan uses either.
- **The stand-in** (`/band`, `app/lib/wrist.js`) has no radio and does not change: it sends no `air` and no reports, and the shared table (`tests/fixtures/wrist-cases.json`) never calls `setAir`, so its hellos stay equal on both twins.
- Repository `LewisSwan24/on-the-beat` (private). Commit after each task; push to `main` when a stage's `npm test` is green. Never the team repository `cimi2232/DECO3500`: `tools/hooks/pre-push` refuses it (after a fresh clone, `cp tools/hooks/pre-push .git/hooks/pre-push`).
- `CLAUDE.md` is not in git and is not edited by this plan. Nothing from `../on-the-beat-research/` or `../on-the-beat-design/` enters the repository.
- `npm test` builds first (the relay serves `dist/`). Running one test file alone: `npm run build` first, and again after restoring a mutation.
- Windows host: the Bash tool is Git Bash, and the plan's scripts are Node. Never write JavaScript holding backticks or `${}` through a Bash heredoc: write it with the editor. A command that holds `git commit` and another program's `-n` (such as `grep -n`) is refused by a hook as `--no-verify`: run them separately.
- Flashing a band needs the owner's yes first, every time. The StickS3 is on `COM8`, the StickC Plus on `COM9`. Stand-in personas paired to his bands are unpaired when a test ends, and each band's state is said.
- Never more than ten background tasks at once. Work directly; this plan needs no fan-out.
- Commit messages end with the attribution trailer the session's system reminder gives (today: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## Three procedures used throughout

**P1 — Mutation check.** Every task that adds a guard lists mutations as JSON: break one guard, run one test file, and exactly the listed tests go red (a listed name is a prefix of the test's). The lists were measured at each task's own commit; run later, a list may find more red as later tests join, and a mutation whose line a later task rewrote no longer applies.

Save this runner outside the repository (for example in your scratch directory as `mutate.mjs`) and run it from the repository root: `node <scratch>/mutate.mjs <scratch>/task-N.json`. It applies each edit (the `from` text must occur exactly once), runs the test file, restores the file byte for byte, runs the file again, and prints `ALL MUTATIONS HELD` only if every red set was exactly the listed one and every restore came back green. A C++ mutation runs `tests/firmware.test.js`, which compiles the host tests, about 35 s a run, twice: Task 4's fifteen take about twenty minutes, so run them in the background. Never run two lists at once when one mutates a file the other's tests use: Task 3's mutate `relay/room.js`, which Task 4's relay tests run through.

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

Expected: two `[SUCCESS]` lines and no `src/` warning. While a mutation run is going, add `-j 2` so the build does not starve its timed tests.

## Files

Created:

| File | Responsibility |
|---|---|
| `tests/near.test.js` | The room's five: scores, stickiness, who is always listed, who is never hidden, and that no number reaches a view |
| `tests/near-crowd.test.js` | The spike's crowd model, through the real room: how many of each five are truly near, and how much the five churn |

Modified: `relay/room.js`, `relay/server.js`, `tests/relay-harness.js`, `tests/wristband.test.js`, `firmware/src/band_logic.h`, `firmware/host/logic_test.cpp`, `tests/firmware.test.js`, `firmware/src/main.cpp`, `README.md`, `docs/superpowers/specs/2026-09-26-wrist-near-design.md` (one line of §5).

Not modified, on purpose: everything in `app/`, `relay/band.js`, `app/lib/wrist.js` and `tests/fixtures/wrist-cases.json`. A phone's list is shorter and nothing else about it changes; a band is shown nothing new; the stand-in has no radio.

## Stages

| Stage | Tasks | Leaves |
|---|---|---|
| A. The relay | 1–3 | the room's five and its hiding rule; the hello's `air`, the `heard` frame and the tick; the crowd model through the real room |
| B. The band | 4–5 | the listen and the report in `band_logic.h`, held on the laptop and against the relay; the radio, the random address and the console in `main.cpp` |
| C. Docs and proof | 6–7 | README and the spec's corrected line; the real bands, with the owner |

Every task ends green and is committed on its own; each stage ends with P2.

---

## Stage A — The relay

Run the relay's tests with `npm run build >/dev/null && node --test tests/near.test.js tests/wristband.test.js tests/near-crowd.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`.

### Task 1: Rooms work out the five heard most strongly, and hide no one else on a guess

**Files:**
- Modify: `relay/room.js`
- Create: `tests/near.test.js`

**Interfaces:**
- Consumes: `createRoom({ now, salt })`, `join`, `arm`, `pick`, `wave`, `block`, `invisible`, `viewFor()` and the internal `seen(id)` and `blue(id)` in `relay/room.js`.
- Produces: `export const HEARD_MS = 30_000`, `NEAR_FIVE = 5`, `NEAR_KEEP = 10`. `room.heard(id, { ch, near })`, `near` being `[{ id, rssi }]` of other people: records a sample for each pair, both directions under one key, and that `id` listened on `ch` now; a report from or about someone not in the room, or about itself, is ignored. `room.nearTick()` (on the room's own clock, as every rule in it is; the spec writes `nearTick(now)`) drops samples older than `HEARD_MS` and listeners gone quiet, works out each listening person's five, and returns `true` when any five was made, changed or dropped. `viewFor(id).near` leaves out whoever the hiding rule hides; nothing else in any view changes, and no view carries a number.

- [ ] **Step 1: Write the failing tests.** Twelve, one per rule of spec §2: the whole room before any report; the five heard most strongly, with nothing saying how strongly; either direction of a pair counting; people with no band always listed and taking no place; a wave either way or a match always listed and taking no place; stickiness among the ten strongest; samples older than `HEARD_MS` gone; nobody hidden by or from a band quiet for `HEARD_MS`; another channel hiding nobody; a viewer not yet worked out seeing the room as it was; nearness never showing anyone blocked, in NOT NOW or gone; and a report about nobody or about itself changing nothing.

Create `tests/near.test.js`:

````diff
new file mode 100644
--- /dev/null
+++ b/tests/near.test.js
@@ -0,0 +1,178 @@
+// Near: of the people wearing a wristband, the five heard most strongly
+// (docs/superpowers/specs/2026-09-26-wrist-near-design.md §2). The room keeps
+// what each band heard and works the five out on its own tick; a view only reads it.
+
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import { createRoom, HEARD_MS, NEAR_FIVE, NEAR_KEEP } from '../relay/room.js';
+
+/** Everyone named is in the room on SAY HI, picking their own name, so a list says who is on it. */
+function floor(names) {
+  let t = Date.UTC(2026, 8, 26, 11, 0);
+  const room = createRoom({ now: () => t, salt: 'test' });
+  for (const id of names) {
+    room.join(id);
+    room.arm(id, 'hi');
+    room.pick(id, id);
+  }
+  const listed = (viewer) => room.viewFor(viewer).near.map((p) => p.pick).sort();
+  const handleOf = (viewer, target) => room.viewFor(viewer).near.find((p) => p.pick === target)?.handle;
+  return { room, listed, handleOf, tick: (ms) => { t += ms; } };
+}
+
+/** `a`'s band reports on channel `ch` that it heard each of `heard` ({ id: rssi }). */
+const report = (room, a, heard, ch = 6) =>
+  room.heard(a, { ch, near: Object.entries(heard).map(([id, rssi]) => ({ id, rssi })) });
+
+const others = (n) => Array.from({ length: n }, (_, i) => 'p' + i);
+
+test('without a wristband, or before it has reported, the list is the whole room, as it was', () => {
+  const { room, listed } = floor(['vi', ...others(8)]);
+  assert.deepEqual(listed('vi'), others(8));
+  // Everyone else's bands report hearing each other, but vi's has not said anything yet.
+  for (const a of others(8)) report(room, a, Object.fromEntries(others(8).filter((b) => b !== a).map((b) => [b, -50])));
+  room.nearTick();
+  assert.deepEqual(listed('vi'), others(8));
+});
+
+test('with bands reporting, the list is the five heard most strongly, and nothing says how strongly', () => {
+  const { room, listed } = floor(['vi', ...others(8)]);
+  const db = { p0: -71, p1: -44, p2: -80, p3: -52, p4: -63, p5: -49, p6: -90, p7: -58 };
+  report(room, 'vi', db);
+  for (const a of others(8)) report(room, a, {});
+  assert.equal(room.nearTick(), true);
+  assert.deepEqual(listed('vi'), ['p1', 'p3', 'p4', 'p5', 'p7']);
+  assert.equal(NEAR_FIVE, 5);
+  // Never a number: no RSSI, score or rank in anything a phone is sent.
+  const seen = JSON.stringify(room.viewFor('vi'));
+  for (const n of Object.values(db)) assert.equal(seen.includes(String(n)), false, 'the view carries ' + n);
+  assert.equal(/rssi|score|rank/i.test(seen), false);
+  // Nothing changed, so nothing to push.
+  assert.equal(room.nearTick(), false);
+});
+
+test('a pair is heard either way: what the other band heard counts as much as your own', () => {
+  const { room, listed } = floor(['vi', ...others(7)]);
+  // vi's band heard nobody. p6's heard vi loudly; the rest heard vi faintly.
+  report(room, 'vi', {});
+  for (const a of others(7)) report(room, a, { vi: a === 'p6' ? -40 : -85 });
+  room.nearTick();
+  assert.equal(listed('vi').includes('p6'), true);
+  assert.equal(listed('vi').length, NEAR_FIVE);
+});
+
+test('people without a band are listed as they were, and take no place in the five', () => {
+  const { room, listed } = floor(['vi', ...others(8), 'nb1', 'nb2']);
+  report(room, 'vi', Object.fromEntries(others(8).map((b, i) => [b, -40 - i * 5])));
+  for (const a of others(8)) report(room, a, {});
+  room.nearTick();
+  assert.deepEqual(listed('vi'), ['nb1', 'nb2', 'p0', 'p1', 'p2', 'p3', 'p4']);
+});
+
+test('a wave either way, or a match, keeps someone listed, and takes no place in the five', () => {
+  const { room, listed, handleOf } = floor(['vi', ...others(8), 'far', 'met']);
+  // Before any band reports, far waves at vi, and vi and met match.
+  room.wave('far', handleOf('far', 'vi'));
+  room.wave('vi', handleOf('vi', 'met'));
+  room.wave('met', handleOf('met', 'vi'));
+  assert.equal(room.viewFor('vi').matches.length, 1);
+  report(room, 'vi', Object.fromEntries(others(8).map((b, i) => [b, -40 - i * 5])));
+  for (const a of [...others(8), 'far', 'met']) report(room, a, {});
+  room.nearTick();
+  assert.deepEqual(listed('vi'), ['far', 'met', 'p0', 'p1', 'p2', 'p3', 'p4']);
+  // So vi's band still counts far's wave, and vi can wave back.
+  assert.equal(room.wavesAt('vi').length, 1);
+});
+
+test('one of the five stays while among the ten strongest, and goes once it is not', () => {
+  const { room, listed, tick } = floor(['vi', ...others(12)]);
+  const hear = (db) => {
+    report(room, 'vi', db);
+    for (const a of others(12)) report(room, a, {});
+    room.nearTick();
+  };
+  // p0..p4 strongest, then p5..p11.
+  hear(Object.fromEntries(others(12).map((b, i) => [b, -40 - i * 3])));
+  assert.deepEqual(listed('vi'), ['p0', 'p1', 'p2', 'p3', 'p4']);
+  // p4 falls to eighth: still among the ten, so it stays, and p5 does not come in.
+  tick(HEARD_MS + 1);
+  hear({ p0: -40, p1: -41, p2: -42, p3: -43, p5: -44, p6: -45, p7: -46, p4: -47, p8: -48, p9: -49, p10: -50, p11: -51 });
+  assert.deepEqual(listed('vi'), ['p0', 'p1', 'p2', 'p3', 'p4']);
+  assert.equal(NEAR_KEEP, 10);
+  // p4 falls to twelfth: out of the ten, so the strongest not listed, p5, takes its place.
+  tick(HEARD_MS + 1);
+  hear({ p0: -40, p1: -41, p2: -42, p3: -43, p5: -44, p6: -45, p7: -46, p8: -47, p9: -48, p10: -49, p11: -50, p4: -51 });
+  assert.deepEqual(listed('vi'), ['p0', 'p1', 'p2', 'p3', 'p5']);
+});
+
+test('what a band heard more than HEARD_MS ago no longer counts', () => {
+  const { room, listed, tick } = floor(['vi', ...others(8)]);
+  report(room, 'vi', { p0: -40 });
+  for (const a of others(8)) report(room, a, {});
+  room.nearTick();
+  assert.deepEqual(listed('vi'), ['p0']);
+  tick(HEARD_MS + 1);
+  report(room, 'vi', { p1: -60 });
+  for (const a of others(8)) report(room, a, {});
+  room.nearTick();
+  assert.deepEqual(listed('vi'), ['p1']);
+});
+
+test('nobody is hidden by, or from, a band that has not reported for HEARD_MS', () => {
+  const { room, listed, tick } = floor(['vi', ...others(8)]);
+  report(room, 'vi', { p0: -40 });
+  for (const a of others(8)) report(room, a, {});
+  room.nearTick();
+  assert.deepEqual(listed('vi'), ['p0']);
+  // The others' bands go quiet: they are no evidence of anything, so all of them are back.
+  tick(HEARD_MS + 1);
+  report(room, 'vi', { p0: -40 });
+  assert.deepEqual(listed('vi'), others(8));
+  // And a viewer whose own band goes quiet sees the room as it was.
+  for (const a of others(8)) report(room, a, {});
+  room.nearTick();
+  assert.deepEqual(listed('vi'), ['p0']);
+  tick(HEARD_MS + 1);
+  for (const a of others(8)) report(room, a, {});
+  assert.deepEqual(listed('vi'), others(8));
+  room.nearTick();
+  assert.deepEqual(listed('vi'), others(8));
+});
+
+test('a band on another channel hides nobody, and is hidden from nobody', () => {
+  const { room, listed } = floor(['vi', ...others(8)]);
+  report(room, 'vi', { p0: -40 }, 6);
+  for (const a of others(8)) report(room, a, {}, a === 'p7' ? 11 : 6);
+  room.nearTick();
+  assert.deepEqual(listed('vi'), ['p0', 'p7']);
+});
+
+test('a viewer whose band has reported but not been worked out yet sees the room as it was', () => {
+  const { room, listed } = floor(['vi', ...others(8)]);
+  for (const a of others(8)) report(room, a, {});
+  report(room, 'vi', { p0: -40 });
+  assert.deepEqual(listed('vi'), others(8));
+  room.nearTick();
+  assert.deepEqual(listed('vi'), ['p0']);
+});
+
+test('nearness never shows anyone the room would not: blocked, NOT NOW or gone', () => {
+  const { room, listed, handleOf } = floor(['vi', 'bl', 'nn', 'gone', 'ok']);
+  room.block('vi', handleOf('vi', 'bl'));
+  room.setInvisible('nn', true);
+  room.leave('gone');
+  report(room, 'vi', { bl: -30, nn: -30, gone: -30, ok: -60 });
+  for (const a of ['bl', 'nn', 'ok']) report(room, a, { vi: -30 });
+  report(room, 'gone', { vi: -30 });
+  room.nearTick();
+  assert.deepEqual(listed('vi'), ['ok']);
+});
+
+test('a report about nobody in the room, or about itself, changes nothing', () => {
+  const { room, listed } = floor(['vi', ...others(6)]);
+  room.heard('vi', { ch: 6, near: [{ id: 'vi', rssi: -20 }, { id: 'ghost', rssi: -20 }, { id: 'p0', rssi: -60 }] });
+  room.heard('ghost', { ch: 6, near: [{ id: 'vi', rssi: -20 }] });
+  for (const a of others(6)) report(room, a, {});
+  room.nearTick();
+  assert.deepEqual(listed('vi'), ['p0']);
+});
````

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/near.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)|SyntaxError"`

Expected: the file does not load, `SyntaxError: The requested module '../relay/room.js' does not provide an export named 'HEARD_MS'`, and `ℹ fail 1` for the file.

- [ ] **Step 3: Implement.**

In `relay/room.js`:

````diff
--- a/relay/room.js
+++ b/relay/room.js
@@ -5,7 +5,9 @@
 //
 //   1. Nobody sees where you are. A person carries a BAND — `in this room`,
 //      `near the bar`, `by the stage`, `somewhere out the back` — and nothing
-//      finer, ever. There is no position here to leak.
+//      finer, ever. There is no position here to leak. What wristbands hear
+//      of each other only takes people off SAY HI's list, and what they heard
+//      never leaves the room.
 //   2. No name and no photo until you both say yes. Before a mutual yes a
 //      person is a handle, a band and at most the track they picked. Handles
 //      are per viewer: the same person has a different handle on every phone,
@@ -44,6 +46,11 @@ const CONTACT_MAX = 60;
 const TRACK_MAX = 60;
 const REPORTS_MAX = 1000;      // the newest kept; a real venue forwards these to its own dashboard
 
+// Near (docs/superpowers/specs/2026-09-26-wrist-near-design.md §2).
+export const HEARD_MS = 30_000;   // what a band heard, and that it listened at all, counts this long
+export const NEAR_FIVE = 5;       // of the people wearing a band, the most a list shows
+export const NEAR_KEEP = 10;      // one of the five stays while still among this many heard most strongly
+
 /** A pair's key, the same whichever way round it is asked. */
 const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
 const clip = (s, n) => String(s ?? '').trim().slice(0, n);
@@ -74,6 +81,12 @@ export function createRoom({
   const tombs = new Map();
   const reports = [];
   let nextMatch = 1;
+  // Near: what each person's wristband heard, never shown to anyone. pairKey -> [{ at, rssi }], from
+  // either band hearing the other; id -> { at, ch }, when their band last reported and on which Wi-Fi
+  // channel; id -> the five nearTick() last worked out for them.
+  const samples = new Map();
+  const listening = new Map();
+  const fives = new Map();
 
   const handle = (viewer, target) =>
     createHash('sha256').update(salt + '|' + viewer + '|' + target).digest('hex').slice(0, 10);
@@ -339,8 +352,83 @@ export function createRoom({
 
   /** Everyone a person may see right now: nobody while they are NOT NOW. */
   const seen = (id) => (people.get(id)?.invisible ? [] : [...people.values()].filter((p) => shows(id, p.id)));
-  /** SAY HI's list: who is showing blue to this person. The phone's list and wavesAt() both come from here. */
-  const blue = (id) => seen(id).filter((p) => p.armed === 'hi');
+  /**
+   * SAY HI's list: who is showing blue to this person, less anyone near hides
+   * (below). The phone's list and wavesAt() both come from here.
+   */
+  const blue = (id) => seen(id).filter((p) => p.armed === 'hi' && !hidden(id, p.id));
+
+  // ---------- near ----------
+
+  /** Has this person's band reported in the last HEARD_MS? */
+  const listens = (id) => listening.has(id) && now() - listening.get(id).at <= HEARD_MS;
+  /** Listed whatever the bands say: a wave either way, or a match tonight. */
+  const bound = (a, b) => waves.has(a + '>' + b) || waves.has(b + '>' + a) || matches.has(pairKey(a, b));
+
+  /**
+   * Hidden from a viewer only on evidence: both bands listening, on one
+   * channel, the viewer's five worked out, and the other not in it nor bound
+   * to them. A band just on, gone quiet or on another channel hides nobody.
+   */
+  function hidden(viewer, t) {
+    if (!fives.has(viewer) || !listens(viewer) || !listens(t) || bound(viewer, t)) return false;
+    return listening.get(viewer).ch === listening.get(t).ch && !fives.get(viewer).has(t);
+  }
+
+  /** What one person's band heard: `near` is [{ id, rssi }] of other people in the room. */
+  function heard(id, { ch, near = [] } = {}) {
+    if (!people.has(id)) return;
+    const at = now();
+    listening.set(id, { at, ch });
+    for (const { id: other, rssi } of near) {
+      if (other === id || !people.has(other)) continue;
+      const k = pairKey(id, other);
+      if (!samples.has(k)) samples.set(k, []);
+      samples.get(k).push({ at, rssi });
+    }
+  }
+
+  /** A pair's score: the median of what either band heard of the other, or null. nearTick() drops the old first. */
+  function score(a, b) {
+    const s = (samples.get(pairKey(a, b)) ?? []).map((x) => x.rssi);
+    return s.length ? s.sort((x, y) => x - y)[Math.floor(s.length / 2)] : null;
+  }
+
+  /**
+   * Works out each listening person's five: of the people on SAY HI whose
+   * bands have a score with theirs, last time's five stay while among the
+   * NEAR_KEEP strongest, and the free places go to the strongest others.
+   * People bound to them take no place. True if anyone's five changed.
+   */
+  function nearTick() {
+    for (const [k, list] of samples) {
+      const kept = list.filter((x) => now() - x.at <= HEARD_MS);
+      if (kept.length) samples.set(k, kept);
+      else samples.delete(k);
+    }
+    for (const id of [...listening.keys()]) if (!people.has(id) || !listens(id)) listening.delete(id);
+    let changed = false;
+    for (const id of [...fives.keys()]) {
+      if (!listening.has(id)) {
+        fives.delete(id);
+        changed = true;
+      }
+    }
+    for (const id of listening.keys()) {
+      const ranked = seen(id)
+        .filter((p) => p.armed === 'hi' && listening.has(p.id) && !bound(id, p.id))
+        .map((p) => ({ id: p.id, s: score(id, p.id) }))
+        .filter((x) => x.s !== null)
+        .sort((x, y) => y.s - x.s);
+      const strongest = new Set(ranked.slice(0, NEAR_KEEP).map((x) => x.id));
+      const last = fives.get(id) ?? new Set();
+      const five = [...last].filter((x) => strongest.has(x));
+      for (const x of ranked) if (five.length < NEAR_FIVE && !five.includes(x.id)) five.push(x.id);
+      if (!fives.has(id) || five.length !== last.size || five.some((x) => !last.has(x))) changed = true;
+      fives.set(id, new Set(five));
+    }
+    return changed;
+  }
 
   /**
    * The waves a person's phone lists as waved at them and not yet waved back,
@@ -397,7 +485,7 @@ export function createRoom({
 
   return {
     join, leave, setBand, setProfile, arm, setInvisible, fromPhone, pick, postClip,
-    wave, wavedAtYou, wavesAt, like, unlike, danceBack, block, report, keep, found, viewFor,
+    wave, wavedAtYou, wavesAt, like, unlike, danceBack, block, report, keep, found, heard, nearTick, viewFor,
     /** For the relay: who is here, so it knows whose view to push. */
     ids: () => [...people.keys()],
     has: (id) => people.has(id),
````

- [ ] **Step 4: Run** — the file (`ℹ pass 12`), then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 395`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "a five not worked out yet hides everyone",
  "file": "relay/room.js",
  "from": "if (!fives.has(viewer) || !listens(viewer)",
  "to": "if (!listens(viewer)",
  "test": "tests/near.test.js",
  "expect": [
   "a viewer whose band has reported but not been worked out yet sees the room as it was"
  ]
 },
 {
  "label": "a viewer whose band went quiet still hides",
  "file": "relay/room.js",
  "from": "if (!fives.has(viewer) || !listens(viewer) || ",
  "to": "if (!fives.has(viewer) || ",
  "test": "tests/near.test.js",
  "expect": [
   "nobody is hidden by, or from, a band that has not reported for HEARD_MS"
  ]
 },
 {
  "label": "someone whose band went quiet is hidden",
  "file": "relay/room.js",
  "from": " || !listens(t) || ",
  "to": " || ",
  "test": "tests/near.test.js",
  "expect": [
   "people without a band are listed as they were, and take no place in the five",
   "nobody is hidden by, or from, a band that has not reported for HEARD_MS"
  ]
 },
 {
  "label": "a wave or a match does not keep someone listed",
  "file": "relay/room.js",
  "from": " || bound(viewer, t)) return false;",
  "to": ") return false;",
  "test": "tests/near.test.js",
  "expect": [
   "a wave either way, or a match, keeps someone listed, and takes no place in the five"
  ]
 },
 {
  "label": "another channel hides",
  "file": "relay/room.js",
  "from": "return listening.get(viewer).ch === listening.get(t).ch && !fives",
  "to": "return !fives",
  "test": "tests/near.test.js",
  "expect": [
   "a band on another channel hides nobody, and is hidden from nobody"
  ]
 },
 {
  "label": "the five is not sticky",
  "file": "relay/room.js",
  "from": "const five = [...last].filter((x) => strongest.has(x));",
  "to": "const five = [];",
  "test": "tests/near.test.js",
  "expect": [
   "one of the five stays while among the ten strongest, and goes once it is not"
  ]
 },
 {
  "label": "the five sticks for ever",
  "file": "relay/room.js",
  "from": "const five = [...last].filter((x) => strongest.has(x));",
  "to": "const five = [...last];",
  "test": "tests/near.test.js",
  "expect": [
   "one of the five stays while among the ten strongest, and goes once it is not",
   "what a band heard more than HEARD_MS ago no longer counts"
  ]
 },
 {
  "label": "only one direction of a pair counts",
  "file": "relay/room.js",
  "from": "      samples.get(k).push({ at, rssi });",
  "to": "      if (id > other) samples.get(k).push({ at, rssi });",
  "test": "tests/near.test.js",
  "expect": [
   "a pair is heard either way: what the other band heard counts as much as your own"
  ]
 },
 {
  "label": "the five are the first heard, not the strongest",
  "file": "relay/room.js",
  "from": "        .filter((x) => x.s !== null)\n        .sort((x, y) => y.s - x.s);",
  "to": "        .filter((x) => x.s !== null);",
  "test": "tests/near.test.js",
  "expect": [
   "with bands reporting, the list is the five heard most strongly, and nothing says how strongly",
   "a pair is heard either way: what the other band heard counts as much as your own",
   "one of the five stays while among the ten strongest, and goes once it is not"
  ]
 },
 {
  "label": "old samples are never dropped",
  "file": "relay/room.js",
  "from": "const kept = list.filter((x) => now() - x.at <= HEARD_MS);",
  "to": "const kept = list;",
  "test": "tests/near.test.js",
  "expect": [
   "what a band heard more than HEARD_MS ago no longer counts"
  ]
 },
 {
  "label": "nearTick never says a five changed",
  "file": "relay/room.js",
  "from": "    return changed;\n  }\n",
  "to": "    return false;\n  }\n",
  "test": "tests/near.test.js",
  "expect": [
   "with bands reporting, the list is the five heard most strongly, and nothing says how strongly"
  ]
 },
 {
  "label": "nearTick always says a five changed",
  "file": "relay/room.js",
  "from": "    return changed;\n  }\n",
  "to": "    return true;\n  }\n",
  "test": "tests/near.test.js",
  "expect": [
   "with bands reporting, the list is the five heard most strongly, and nothing says how strongly"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add relay/room.js tests/near.test.js
```

````bash
git commit -F - <<'EOF'
Rooms work out the five heard most strongly, and hide no one else on a guess

The room keeps what each person's wristband heard of the others, both
directions of a pair together, for HEARD_MS, and on its own tick works out
each listening person's five: of the people on SAY HI whose bands scored
with theirs, last time's five stay while among the NEAR_KEEP strongest and
the free places go to the strongest others. SAY HI's list hides someone
only on evidence: both bands listening on one channel, the viewer's five
worked out, and them not in it, not waved with and not matched. A view
only reads the five, and nothing about signal reaches it.

Mutation-checked: 12 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 2: A band says its air and what it heard; the relay works out who is near each tick

**Files:**
- Modify: `relay/server.js`, `tests/relay-harness.js`
- Test: `tests/wristband.test.js`

**Interfaces:**
- Consumes: Task 1's `room.heard()` and `room.nearTick()`; `handleBand()`, the hello's checks, `push(r)` (which sends a view only when its text changed) and `refuseBand(ws)` in `relay/server.js`; `wristband()` and `pairBand()` in `tests/relay-harness.js`.
- Produces: `export const HEARD_GAP_MS = 5000`. The hello's `air` kept as `b.air` (`null` without one), a malformed one refused as `bad band`. `{ t: 'heard', ch, near }` from a band, handed to the room as people. `tickNear()` every `NEAR_TICK_MS`, pushing a room only when `nearTick()` says a five changed, and returned from `createRelay()` beside `tickBands` so tests can drive it. The harness's `wristband(battery, { air })` says `air` in its hello.

- [ ] **Step 1: Write the failing tests.** Four in `tests/wristband.test.js`, on a floor of banded people (`nearFloor()`: each band with its own `air`, paired, on SAY HI with a pick): the hello's `air` (upper case, eleven or thirteen digits, not hex, a number, empty — each refused); a report narrowing SAY HI to five only at the tick, pushing nothing by itself and nothing to a phone whose list did not change, and never a number in a view; a report dropped whole for every way of being wrong, then one taken, one too soon refused, and sixteen taken exactly `HEARD_GAP_MS` after; and an air on a band in another room, on a band paired to nobody, or on two bands, counting for nobody.

In `tests/relay-harness.js`:

````diff
--- a/tests/relay-harness.js
+++ b/tests/relay-harness.js
@@ -45,14 +45,14 @@ export function helpers(port) {
 
   /**
    * A wristband: a socket that says hello as the firmware does — its id, the
-   * key that proves it, v2, and a secret when it has one — and remembers the
-   * last show and the secret it is given.
+   * key that proves it, v2, a secret when it has one and its radio's `air`
+   * when given — and remembers the last show and the secret it is given.
    */
-  async function wristband(battery = 62, { key = newKey(), secret = null, quiet = false, v1 = false } = {}) {
+  async function wristband(battery = 62, { key = newKey(), secret = null, quiet = false, v1 = false, air = null } = {}) {
     const ws = new WebSocket(address());
     clients.add(ws);
     const id = v1 ? randomBytes(16).toString('hex') : bandIdOf(key);
-    const b = { ws, id, key, secret, show: null, replies: [], waiters: [] };
+    const b = { ws, id, key, secret, air, show: null, replies: [], waiters: [] };
     ws.on('message', (data) => {
       const m = JSON.parse(String(data));
       if (m.t === 'show') b.show = m.show;
@@ -67,7 +67,9 @@ export function helpers(port) {
       const timer = setTimeout(() => reject(new Error('band timed out; last show ' + JSON.stringify(b.show))), ms);
       if (!check()) b.waiters.push(check);
     });
-    b.send(v1 ? { t: 'wristband', id, battery } : { t: 'wristband', id, key, v: 2, battery, ...(secret ? { secret } : {}), ...(quiet ? { quiet: true } : {}) });
+    b.send(v1 ? { t: 'wristband', id, battery } : {
+      t: 'wristband', id, key, v: 2, battery, ...(secret ? { secret } : {}), ...(quiet ? { quiet: true } : {}), ...(air ? { air } : {}),
+    });
     await b.until(() => true);
     return b;
   }
````

In `tests/wristband.test.js`:

````diff
--- a/tests/wristband.test.js
+++ b/tests/wristband.test.js
@@ -7,7 +7,7 @@ import { randomBytes } from 'node:crypto';
 import { mkdtempSync, rmSync } from 'node:fs';
 import { tmpdir } from 'node:os';
 import { join } from 'node:path';
-import { createRelay, bandIdOf, BAND_ALONE_MS, PAIR_CHECK_MS } from '../relay/server.js';
+import { createRelay, bandIdOf, BAND_ALONE_MS, PAIR_CHECK_MS, HEARD_GAP_MS } from '../relay/server.js';
 import { MEET_MS } from '../relay/band.js';
 import { helpers, newKey, pause } from './relay-harness.js';
 
@@ -895,3 +895,118 @@ test('a block reads exactly as a meeting that is over, and tells the one blocked
   assert.equal(heard, 0, "nothing reached ben's phone");
   close(ana, ben, aBand, bBand);
 });
+
+// ---------- near: what the bands heard (docs/superpowers/specs/2026-09-26-wrist-near-design.md §2) ----------
+
+const airOf = (i) => '02abcdef' + String(i).padStart(4, '0');
+
+/** People on SAY HI, each with a band that says its air and each picking their own name; and `nb`, a phone with no band. */
+async function nearFloor(on, venue, names) {
+  const people = {};
+  for (const [i, name] of names.entries()) {
+    const band = await on.wristband(62, { air: airOf(i) });
+    const p = await on.phone(venue);
+    await on.pairBand(p, band);
+    p.send({ t: 'pick', track: name });
+    p.send({ t: 'arm', intent: 'hi' });
+    people[name] = { band, p, air: airOf(i) };
+  }
+  const nb = await on.phone(venue);
+  nb.send({ t: 'pick', track: 'nb' });
+  nb.send({ t: 'arm', intent: 'hi' });
+  for (const x of [...Object.values(people).map((q) => q.p), nb]) {
+    await x.until((v) => v.near.length === names.length && v.me.armed === 'hi' && v.me.pick);
+  }
+  await pause(100);
+  return { people, nb };
+}
+const listed = (p) => p.view.near.map((r) => r.pick).sort();
+const heardOf = (band, ch, near) => band.send({ t: 'heard', ch, near });
+
+test("a band's hello may say its radio's air, twelve lower-case hex digits; any other is refused", async () => {
+  for (const air of ['02ABCDEF0123', '02abcdef012', '02abcdef01234', 'zzzzzzzzzzzz', 12, '']) {
+    const key = newKey();
+    const r = await hello({ t: 'wristband', id: bandIdOf(key), key, v: 2, air });
+    assert.deepEqual([r.reply, r.closed], [{ t: 'error', why: 'bad band' }, 4001], JSON.stringify(air));
+  }
+  const key = newKey();
+  const ok = await hello({ t: 'wristband', id: bandIdOf(key), key, v: 2, air: '02abcdef0123' });
+  assert.equal(ok.reply.t, 'show');
+  ok.ws.close();
+});
+
+test('what the bands heard narrows SAY HI to the five heard most strongly, at the tick, pushed only where a list changed', async () => {
+  await heldRelay(async (on, clock, own) => {
+    const names = ['vi', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
+    const { people, nb } = await nearFloor(on, 'near-five', names);
+    const views = new Map([[people.vi.p, 0], [nb, 0]]);
+    for (const x of views.keys()) x.ws.on('message', (d) => { if (JSON.parse(String(d)).t === 'view') views.set(x, views.get(x) + 1); });
+    heardOf(people.vi.band, 6, names.slice(1).map((n, i) => [people[n].air, -40 - i * 5]));
+    for (const n of names.slice(1)) heardOf(people[n].band, 6, []);
+    await pause(150);
+    assert.deepEqual([views.get(people.vi.p), views.get(nb)], [0, 0], 'a report alone pushes nothing');
+    own.tickNear();
+    await people.vi.p.until((v) => v.near.length === 6);
+    assert.deepEqual(listed(people.vi.p), ['nb', 'p0', 'p1', 'p2', 'p3', 'p4']);
+    assert.equal(/rssi|score|rank|-4\d|-5\d|-6\d|-70/.test(JSON.stringify(people.vi.p.view)), false, 'never a number');
+    await pause(100);
+    assert.equal(views.get(nb), 0, "nb has no band and nb's list did not change: nothing pushed");
+    const before = views.get(people.vi.p);
+    own.tickNear();
+    await pause(150);
+    assert.equal(views.get(people.vi.p), before, 'nothing changed, nothing pushed');
+  });
+});
+
+test('a heard frame is dropped whole: from a band paired to nobody, malformed, too long, or sooner than HEARD_GAP_MS after the last', async () => {
+  await heldRelay(async (on, clock, own) => {
+    const names = ['vi', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
+    const { people } = await nearFloor(on, 'near-drop', names);
+    for (const n of names.slice(1)) heardOf(people[n].band, 6, []);
+    const vi = people.vi;
+    const a = (n) => people[n].air;
+    const whole = ['nb', ...names.slice(1)];
+    const after = async () => { await pause(40); own.tickNear(); await pause(60); return listed(vi.p); };
+    const loose = await on.wristband(62, { air: '02ffffffffff' });
+    heardOf(loose, 6, [[a('p0'), -30]]);
+    assert.deepEqual(await after(), whole, 'a band paired to nobody');
+    for (const bad of [
+      { ch: 0, near: [[a('p0'), -40]] }, { ch: 15, near: [[a('p0'), -40]] }, { ch: '6', near: [[a('p0'), -40]] },
+      { ch: 6, near: 'p0' }, { ch: 6, near: [[a('p0')]] }, { ch: 6, near: [[a('p0'), -40, 1]] },
+      { ch: 6, near: [[a('p0').toUpperCase(), -40]] }, { ch: 6, near: [[a('p0').slice(1), -40]] },
+      { ch: 6, near: [[a('p0'), 1]] }, { ch: 6, near: [[a('p0'), -101]] }, { ch: 6, near: [[a('p0'), -40.5]] },
+      { ch: 6, near: [[a('p0'), '-40']] }, { ch: 6, near: [[123456789012, -40]] },
+      { ch: 6, near: [...Array(17)].map(() => [a('p0'), -40]) },
+    ]) {
+      vi.band.send({ t: 'heard', ...bad });
+      assert.deepEqual(await after(), whole, JSON.stringify(bad).slice(0, 80));
+    }
+    heardOf(vi.band, 6, [[a('p0'), -40]]);
+    assert.deepEqual(await after(), ['nb', 'p0'], 'a good one, after all those, is taken');
+    clock.t += HEARD_GAP_MS - 1;
+    heardOf(vi.band, 6, [[a('p1'), -40]]);
+    assert.deepEqual(await after(), ['nb', 'p0'], 'too soon');
+    clock.t += 1;
+    heardOf(vi.band, 6, [...Array(16)].map(() => [a('p1'), -45]));
+    assert.deepEqual(await after(), ['nb', 'p0', 'p1'], 'sixteen, HEARD_GAP_MS after the last');
+  });
+});
+
+test('an air counts only as the air of exactly one band paired in the same room', async () => {
+  await heldRelay(async (on, clock, own) => {
+    const names = ['vi', 'p0', 'p1', 'p2'];
+    const { people } = await nearFloor(on, 'near-air', names);
+    // p2's air on a band in another room; p0's on a band paired to nobody; p1's on a second band in this room.
+    const elsewhere = await on.wristband(62, { air: people.p2.air });
+    await on.pairBand(await on.phone('near-air-elsewhere'), elsewhere);
+    await on.wristband(62, { air: people.p0.air });
+    const twin = await on.wristband(62, { air: people.p1.air });
+    await on.pairBand(await on.phone('near-air'), twin);
+    for (const n of ['p0', 'p1', 'p2']) heardOf(people[n].band, 6, []);
+    heardOf(people.vi.band, 6, [[people.p0.air, -50], [people.p1.air, -30], [people.p2.air, -80]]);
+    await pause(60);
+    own.tickNear();
+    await people.vi.p.until((v) => v.near.length === 3);
+    assert.deepEqual(listed(people.vi.p), ['nb', 'p0', 'p2']);
+  });
+});
````

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/wristband.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)|SyntaxError"`

Expected: the file does not load, `SyntaxError: The requested module '../relay/server.js' does not provide an export named 'HEARD_GAP_MS'`, and `ℹ fail 1` for the file.

- [ ] **Step 3: Implement.**

In `relay/server.js`:

````diff
--- a/relay/server.js
+++ b/relay/server.js
@@ -22,6 +22,7 @@ export const WS_PATH = '/api/ws';
 export const PAIR_CHECK_MS = 60_000;          // a pending pairing waits this long for YES
 export const BAND_ALONE_MS = 60 * 60_000;     // a wristband alone holds its person, or waits for its owner, this long
 export const GRACE_MS = 120_000;              // a locked screen is not leaving
+export const HEARD_GAP_MS = 5000;             // a wristband may say what it heard at most this often (near spec §2)
 const MAX_FRAME = 1_600_000;          // a five-second clip, base64, with room to spare
 const CLIP_MAX = 1_200_000;           // bytes of video per clip
 const ROOM_CLIPS_MAX = 60_000_000;    // all clips in one room; the oldest go first
@@ -36,6 +37,9 @@ const TRIES_MS = 60_000;              // the window pairing attempts are counted
 const SOCKET_TRIES = 5;               // pairing attempts one socket may make in it
 const ADDRESS_TRIES = 20;             // pairing attempts one address may make in it, over every socket
 const HEX32 = /^[a-f0-9]{32}$/;
+const AIR = /^[a-f0-9]{12}$/;         // a wristband's radio: its Wi-Fi MAC, new every boot
+const HEARD_MAX = 16;                 // the most bands one report may name
+const NEAR_TICK_MS = 5000;            // how often each room works out who is near whom
 
 const TYPES = {
   '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
@@ -313,6 +317,8 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
     const b = bands.get(ws.band);
     // Only from the wristband's current socket: a set stuck in a replaced one must not land.
     if (!b || b.ws !== ws) return;
+    // What it heard is for the room's next tick, which pushes what changed: nothing to push now.
+    if (m.t === 'heard') { heardFromBand(b, m); return; }
     if (m.t === 'battery') b.battery = clampBattery(m.level);
     // Held: NOT NOW, from the wrist. The phone follows.
     if (m.t === 'hold') holdOn(b);
@@ -323,6 +329,31 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
     if (r) push(r); else showBand(b);
   }
 
+  /**
+   * What a wristband heard of the others by radio (near spec §2): `ch`, its
+   * Wi-Fi channel, and `near`, [air, rssi] pairs. From a band paired in a room,
+   * at most every HEARD_GAP_MS, whole or not at all. An air counts only as the
+   * air of exactly one band paired in the same room; the room itself ignores the
+   * band's own person and anyone no longer in it.
+   */
+  function heardFromBand(b, m) {
+    const r = b.person && b.key ? rooms.get(b.key) : null;
+    if (!r?.room.has(b.person) || (b.heardAt !== undefined && now() - b.heardAt < HEARD_GAP_MS)) return;
+    if (!Number.isInteger(m.ch) || m.ch < 1 || m.ch > 14 || !Array.isArray(m.near) || m.near.length > HEARD_MAX) return;
+    const fits = (e) => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && AIR.test(e[0])
+      && Number.isInteger(e[1]) && e[1] >= -100 && e[1] <= 0;
+    if (!m.near.every(fits)) return;
+    b.heardAt = now();
+    // A band has its room's key only while it is paired there.
+    const here = [...bands.values()].filter((o) => o.key === b.key);
+    const near = [];
+    for (const [air, rssi] of m.near) {
+      const who = here.filter((o) => o.air === air);
+      if (who.length === 1) near.push({ id: who[0].person, rssi });
+    }
+    r.room.heard(b.person, { ch: m.ch, near });
+  }
+
   function refuseBand(ws) {
     ws.send(JSON.stringify({ t: 'error', why: 'bad band' }));
     ws.close(4001, 'bad band');
@@ -336,6 +367,8 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
     // The key proves the id; a socket says hello once.
     const proven = v2 ? HEX32.test(id) && HEX32.test(key) && bandIdOf(key) === id : /^[a-f0-9]{16,64}$/.test(id);
     if (ws.band || !proven) { refuseBand(ws); return; }
+    // Its radio, if it has one: twelve hex digits, or no hello at all.
+    if (m.air !== undefined && !AIR.test(String(m.air))) { refuseBand(ws); return; }
     const secret = HEX32.test(String(m.secret || '')) ? String(m.secret) : null;
     let b = bands.get(id);
     // A hello with no version never reaches a record made by one with, nor the other way round.
@@ -363,6 +396,7 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
     b.ws = ws;
     b.everWs = true;
     b.lastShow = null;
+    b.air = m.air === undefined ? null : String(m.air);
     ws.band = id;
     if (m.battery !== undefined) b.battery = clampBattery(m.battery);
     if (!b.person && !b.code && !b.pending && !b.waiting) freshLetters(b);
@@ -683,6 +717,11 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
     for (const b of bands.values()) showBand(b, at);
   }
   const lights = setInterval(() => tickBands(), 1000);
+  // Who is near whom, worked out in each room; only the views that changed are sent (push).
+  function tickNear() {
+    for (const r of rooms.values()) if (r.room.nearTick()) push(r);
+  }
+  const nearly = setInterval(() => tickNear(), NEAR_TICK_MS);
   // A venue with nobody in it, nobody in its grace window, no clip still loading
   // and no wristband still worn holds nothing — so it is let go, or a long-lived
   // relay would keep a room object for every venue anyone ever typed.
@@ -739,6 +778,8 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
       expire,
       /** For tests: time out pairing checks and redraw every wristband as if the clock read `at`. */
       tickBands,
+      /** For tests: work out who is near whom now, as the relay does every NEAR_TICK_MS. */
+      tickNear,
       /** For tests: how many wristband records the relay is holding. */
       bandCount: () => bands.size,
       /** For tests: how many venue rooms the relay is holding. */
@@ -748,6 +789,7 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
         clearInterval(beat);
         clearInterval(sweep);
         clearInterval(lights);
+        clearInterval(nearly);
         for (const r of rooms.values()) for (const t of r.left.values()) clearTimeout(t);
         for (const ws of wss.clients) ws.terminate();
         wss.close(() => server.close(() => done()));
````

- [ ] **Step 4: Run** — the file (`ℹ pass 48`), then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 399`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`. Two things are not in the list, on purpose. The `return` after `heardFromBand()` only saves work: without it the frame falls through to `push(r)`, which sends nothing, because no view changed. And the air filter is one condition, `o.key === b.key`: a band has its room's key only while it is paired there, and the room already ignores its own person and anyone not in it, so the extra conditions a first draft had (`o !== b`, `o.air`, `o.person`, `r.room.has(o.person)`) could not be told apart by any test.

````json
[
 {
  "label": "any air is taken",
  "file": "relay/server.js",
  "from": "    if (m.air !== undefined && !AIR.test(String(m.air))) { refuseBand(ws); return; }\n",
  "to": "",
  "test": "tests/wristband.test.js",
  "expect": [
   "a band's hello may say its radio's air, twelve lower-case hex digits; any other is refused"
  ]
 },
 {
  "label": "the air is not kept",
  "file": "relay/server.js",
  "from": "    b.air = m.air === undefined ? null : String(m.air);\n",
  "to": "",
  "test": "tests/wristband.test.js",
  "expect": [
   "what the bands heard narrows SAY HI to the five heard most strongly, at the tick, pushed only where a list changed",
   "a heard frame is dropped whole: from a band paired to nobody, malformed, too long, or sooner than HEARD_GAP_MS after the last",
   "an air counts only as the air of exactly one band paired in the same room"
  ]
 },
 {
  "label": "no gap between reports",
  "file": "relay/server.js",
  "from": "(b.heardAt !== undefined && now() - b.heardAt < HEARD_GAP_MS)",
  "to": "false",
  "test": "tests/wristband.test.js",
  "expect": [
   "a heard frame is dropped whole: from a band paired to nobody, malformed, too long, or sooner than HEARD_GAP_MS after the last"
  ]
 },
 {
  "label": "the gap is one ms too long",
  "file": "relay/server.js",
  "from": "now() - b.heardAt < HEARD_GAP_MS",
  "to": "now() - b.heardAt <= HEARD_GAP_MS",
  "test": "tests/wristband.test.js",
  "expect": [
   "a heard frame is dropped whole: from a band paired to nobody, malformed, too long, or sooner than HEARD_GAP_MS after the last"
  ]
 },
 {
  "label": "any channel",
  "file": "relay/server.js",
  "from": "!Number.isInteger(m.ch) || m.ch < 1 || m.ch > 14 || ",
  "to": "",
  "test": "tests/wristband.test.js",
  "expect": [
   "a heard frame is dropped whole: from a band paired to nobody, malformed, too long, or sooner than HEARD_GAP_MS after the last"
  ]
 },
 {
  "label": "channel zero",
  "file": "relay/server.js",
  "from": "m.ch < 1 || ",
  "to": "",
  "test": "tests/wristband.test.js",
  "expect": [
   "a heard frame is dropped whole: from a band paired to nobody, malformed, too long, or sooner than HEARD_GAP_MS after the last"
  ]
 },
 {
  "label": "seventeen names",
  "file": "relay/server.js",
  "from": "m.near.length > HEARD_MAX",
  "to": "m.near.length > HEARD_MAX + 1",
  "test": "tests/wristband.test.js",
  "expect": [
   "a heard frame is dropped whole: from a band paired to nobody, malformed, too long, or sooner than HEARD_GAP_MS after the last"
  ]
 },
 {
  "label": "entries not checked",
  "file": "relay/server.js",
  "from": "    if (!m.near.every(fits)) return;\n",
  "to": "",
  "test": "tests/wristband.test.js",
  "expect": [
   "a heard frame is dropped whole: from a band paired to nobody, malformed, too long, or sooner than HEARD_GAP_MS after the last"
  ]
 },
 {
  "label": "an air that is not a string",
  "file": "relay/server.js",
  "from": "typeof e[0] === 'string' && ",
  "to": "",
  "test": "tests/wristband.test.js",
  "expect": [
   "a heard frame is dropped whole: from a band paired to nobody, malformed, too long, or sooner than HEARD_GAP_MS after the last"
  ]
 },
 {
  "label": "an rssi under -100",
  "file": "relay/server.js",
  "from": "e[1] >= -100 && ",
  "to": "",
  "test": "tests/wristband.test.js",
  "expect": [
   "a heard frame is dropped whole: from a band paired to nobody, malformed, too long, or sooner than HEARD_GAP_MS after the last"
  ]
 },
 {
  "label": "an air two bands say counts",
  "file": "relay/server.js",
  "from": "if (who.length === 1) near.push",
  "to": "if (who.length >= 1) near.push",
  "test": "tests/wristband.test.js",
  "expect": [
   "an air counts only as the air of exactly one band paired in the same room"
  ]
 },
 {
  "label": "an air on any band counts, in any room or none",
  "file": "relay/server.js",
  "from": "filter((o) => o.key === b.key)",
  "to": "filter(() => true)",
  "test": "tests/wristband.test.js",
  "expect": [
   "an air counts only as the air of exactly one band paired in the same room"
  ]
 },
 {
  "label": "a report is worked out at once, not at the tick",
  "file": "relay/server.js",
  "from": "    r.room.heard(b.person, { ch: m.ch, near });\n",
  "to": "    r.room.heard(b.person, { ch: m.ch, near });\n    r.room.nearTick();\n    push(r);\n",
  "test": "tests/wristband.test.js",
  "expect": [
   "what the bands heard narrows SAY HI to the five heard most strongly, at the tick, pushed only where a list changed"
  ]
 },
 {
  "label": "the tick pushes nothing",
  "file": "relay/server.js",
  "from": "if (r.room.nearTick()) push(r);",
  "to": "r.room.nearTick();",
  "test": "tests/wristband.test.js",
  "expect": [
   "what the bands heard narrows SAY HI to the five heard most strongly, at the tick, pushed only where a list changed",
   "a heard frame is dropped whole: from a band paired to nobody, malformed, too long, or sooner than HEARD_GAP_MS after the last",
   "an air counts only as the air of exactly one band paired in the same room"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add relay/server.js tests/relay-harness.js tests/wristband.test.js
```

````bash
git commit -F - <<'EOF'
A band says its air and what it heard; the relay works out who is near each tick

A wristband's hello may say its radio's air, twelve lower-case hex digits,
and anything else there refuses the hello. A paired band may then say what
it heard, at most every HEARD_GAP_MS: its Wi-Fi channel and up to sixteen
[air, rssi] pairs, whole or not at all. Each air counts only as the air of
exactly one band paired in the same room: a band has its room's key only
while it is paired there, and the room ignores its own person and anyone
no longer in it. A report pushes nothing by itself: every NEAR_TICK_MS each
room works out its fives, and only the views that changed are sent.

Mutation-checked: 14 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 3: On a modelled crowd, the five are nearly all truly near

**Files:**
- Create: `tests/near-crowd.test.js`

**Interfaces:**
- Consumes: Task 1's `createRoom`, `heard`, `nearTick`, `viewFor`, `HEARD_MS` and `NEAR_FIVE`.
- Produces: nothing new; a proof of spec §5's line, "of each band's five, the share within 10 m, as in the model (97% or more)".

- [ ] **Step 1: Write the test.** The spike's model, seeded so it is the same every run: 750 people on 40 × 25 m, the first 150 banded; each pair's mean RSSI from log-distance loss (−30 dBm at a metre, exponent 2.7) less 4 dB for each other body within 25 cm of the line (at most 12); each listen the strongest of two beacons, each with slow (4 dB) and fast (6 dB) fading, unheard below −95 dBm. Eighteen rounds of reports ten seconds apart go through the real room; from the fourth, it counts how many of each five are within 10 m, the same for five picked at random from what the band heard, and how many of each five are new since the last round. It reports all three with `ctx.diagnostic()`.

Create `tests/near-crowd.test.js`:

````diff
new file mode 100644
--- /dev/null
+++ b/tests/near-crowd.test.js
@@ -0,0 +1,100 @@
+// Near, on a modelled crowd: reports shaped as the bands send them, through the
+// real room, and how many of each five are truly near (near spec §5). The crowd
+// is a model, not a measurement: 2.4 GHz log-distance loss, a few dB for each
+// body between two bands, slow and fast fading, calibrated to the real bands'
+// RSSI. Its constants are the spike's; the spec says which the choice rests on.
+
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import { createRoom, HEARD_MS, NEAR_FIVE } from '../relay/room.js';
+
+const RSSI_1M = -30;    // dBm a metre away, line of sight, as the bands read each other at 20 dBm
+const LOSS_N = 2.7;     // path-loss exponent indoors
+const BODY_DB = 4;      // for each body within 25 cm of the line between two bands, at most 12
+const SLOW_DB = 4;      // shadowing that drifts from one listen to the next
+const FAST_DB = 6;      // fading from one beacon to the next: a dancing arm
+const FLOOR_DB = -95;   // below this a beacon is not heard
+const NEAR_M = 10;      // what near means: close enough to find by looking round
+const LISTEN_EVERY_MS = 10_000;
+
+/** A seeded crowd: `people` on a w x h floor, the first `bands` of them wearing a band. */
+function crowd({ w = 40, h = 25, people = 750, bands = 150, seed = 7 } = {}) {
+  let s = seed;
+  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
+  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
+  const at = Array.from({ length: people }, () => ({ x: rnd() * w, y: rnd() * h }));
+  const bodies = (a, b) => {
+    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
+    let k = 0;
+    for (const p of at) {
+      if (p === a || p === b) continue;
+      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
+      if (t <= 0 || t >= 1) continue;
+      const qx = a.x + t * dx - p.x, qy = a.y + t * dy - p.y;
+      if (qx * qx + qy * qy < 0.0625) k += 1;
+    }
+    return Math.min(k, 12);
+  };
+  const ids = Array.from({ length: bands }, (_, i) => 'b' + i);
+  const pair = new Map();
+  for (let i = 0; i < bands; i += 1) {
+    for (let j = i + 1; j < bands; j += 1) {
+      const d = Math.max(0.3, Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y));
+      const p = { d, mean: RSSI_1M - 10 * LOSS_N * Math.log10(d) - BODY_DB * bodies(at[i], at[j]) };
+      pair.set(ids[i] + '|' + ids[j], p);
+      pair.set(ids[j] + '|' + ids[i], p);
+    }
+  }
+  const of = (a, b) => pair.get(a + '|' + b);
+  /** One listen by band `a`: the strongest of two beacons from each band it heard, as the firmware keeps it. */
+  const listen = (a) => ids.filter((b) => b !== a).flatMap((b) => {
+    const r = of(a, b).mean + SLOW_DB * gauss() + Math.max(FAST_DB * gauss(), FAST_DB * gauss());
+    return r >= FLOOR_DB ? [{ id: b, rssi: Math.max(-100, Math.min(0, Math.round(r))) }] : [];
+  });
+  return { ids, of, listen, rnd };
+}
+
+test('on a modelled crowd of 750, 150 banded, nearly every one of each five is truly within 10 m', (ctx) => {
+  const { ids, of, listen, rnd } = crowd();
+  let t = Date.UTC(2026, 8, 26, 21, 0);
+  const room = createRoom({ now: () => t, salt: 'crowd' });
+  for (const id of ids) {
+    room.join(id);
+    room.arm(id, 'hi');
+    room.pick(id, id);
+  }
+  const listed = (v) => room.viewFor(v).near.map((p) => p.pick);
+  let near = 0, shown = 0, randomNear = 0, changed = 0, kept = 0;
+  let last = null;
+  // Three minutes of listens, each band once every LISTEN_EVERY_MS at its own moment; the five after every listen round.
+  for (let round = 0; round < 18; round += 1) {
+    for (const id of ids) room.heard(id, { ch: 6, near: listen(id) });
+    t += LISTEN_EVERY_MS;
+    room.nearTick();
+    const now = new Map(ids.map((v) => [v, listed(v)]));
+    if (round >= 3) {
+      for (const v of ids) {
+        const five = now.get(v);
+        shown += five.length;
+        near += five.filter((b) => of(v, b).d <= NEAR_M).length;
+        // Five picked at random from what the band heard, for comparison.
+        const heard = listen(v).map((x) => x.id);
+        for (let k = 0; k < Math.min(NEAR_FIVE, heard.length); k += 1) randomNear += of(v, heard[Math.floor(rnd() * heard.length)]).d <= NEAR_M ? 1 : 0;
+        if (last) {
+          changed += five.filter((b) => !last.get(v).includes(b)).length;
+          kept += five.length;
+        }
+      }
+    }
+    last = now;
+  }
+  assert.ok(HEARD_MS >= 3 * LISTEN_EVERY_MS, 'a pair is scored on three listens or more');
+  assert.equal(shown, 15 * ids.length * NEAR_FIVE, 'everyone has a full five');
+  const share = near / shown, random = randomNear / shown, churn = changed / kept;
+  ctx.diagnostic(`within ${NEAR_M} m: the five ${(share * 100).toFixed(1)}%, five at random ${(random * 100).toFixed(1)}%; churn ${(churn * 100).toFixed(1)}% a listen`);
+  assert.ok(share >= 0.97, `the five are ${(share * 100).toFixed(1)}% within ${NEAR_M} m`);
+  // A floor, not a bar: five picked at random from what a band heard are mostly not near (33% when measured).
+  assert.ok(random <= 0.5, `five at random from what was heard are ${(random * 100).toFixed(1)}% within ${NEAR_M} m`);
+  // Sticky, a five changed 2% a listen when measured; replaced whole each tick instead, 15%.
+  assert.ok(churn <= 0.08, `${(churn * 100).toFixed(1)}% of each five changes each listen`);
+});
````

- [ ] **Step 2: Run it.** `node --test tests/near-crowd.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)|within"`

Expected: it passes on Tasks 1–2 as they are, about 3 s: `within 10 m: the five 99.8%, five at random 33.3%; churn 2.1% a listen`. It is a proof, not a new rule: its mutations below are what show it can fail. Measured before the thresholds were set: sorted not at all, the five were 31.6% within 10 m; replaced whole each tick, they churned 14.8%.

- [ ] **Step 3: Run** `npm test`. Expected: `ℹ fail 0`, `ℹ tests 400`.

- [ ] **Step 4: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "the five are the first heard, not the strongest",
  "file": "relay/room.js",
  "from": "        .filter((x) => x.s !== null)\n        .sort((x, y) => y.s - x.s);",
  "to": "        .filter((x) => x.s !== null);",
  "test": "tests/near-crowd.test.js",
  "expect": [
   "on a modelled crowd of 750, 150 banded, nearly every one of each five is truly within 10 m"
  ]
 },
 {
  "label": "the five is worked out afresh each tick",
  "file": "relay/room.js",
  "from": "const five = [...last].filter((x) => strongest.has(x));",
  "to": "const five = [];",
  "test": "tests/near-crowd.test.js",
  "expect": [
   "on a modelled crowd of 750, 150 banded, nearly every one of each five is truly within 10 m"
  ]
 },
 {
  "label": "a pair is scored on two listens",
  "file": "relay/room.js",
  "from": "export const HEARD_MS = 30_000;",
  "to": "export const HEARD_MS = 20_000;",
  "test": "tests/near-crowd.test.js",
  "expect": [
   "on a modelled crowd of 750, 150 banded, nearly every one of each five is truly within 10 m"
  ]
 }
]
````

- [ ] **Step 5: Commit, and close Stage A with P2**

```bash
git add tests/near-crowd.test.js
```

````bash
git commit -F - <<'EOF'
On a modelled crowd, the five are nearly all truly near

The spike's crowd model, as a test: 750 people on a 40 x 25 m floor, 150 of
them banded, with log-distance loss, a few dB for each body in the way, and
slow and fast fading. Three minutes of reports, shaped as the bands send
them, go through the real room. Of each band's five, 99.8% are within
10 m, against 33% for five picked at random from what the band heard; the
five change 2% a listen, where replaced whole each tick they changed 15%.
It holds the spec's line of 97%, and 8% for churn.

Mutation-checked: 3 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---

## Stage B — The band

### Task 4: A band keeps what one listen heard and reports it; its hello says its air

**Files:**
- Modify: `firmware/src/band_logic.h`
- Test: `firmware/host/logic_test.cpp`, `tests/firmware.test.js`

**Interfaces:**
- Consumes: `helloFrame()`, `saidLine()`, `Wrist` (its `link_`, `secret_` and `current()`) in `firmware/src/band_logic.h`; the host tests' `CHECK`, `answer()` and `speak`; `speak()`, `open()` and `phone()` in `tests/firmware.test.js`; Task 2's relay.
- Produces: `BEACON_MS`, `LISTEN_MS`, `HEAR_EVERY_MS`, `HEARD_MAX` (12), `FRAME_MAX` (320), `BEACON[4]`; `airHex(const uint8_t* mac)` → twelve lower-case hex; `makeAir(uint8_t* out, random32)`; `class Hearing` with `heard(const uint8_t* mac, int rssi)`, `size()`, `clear()`, `strongest()` → `std::vector<Hearing::Heard>` (`mac[6]`, `rssi`), and `frame(int ch)` → the report. `helloFrame(..., const std::string& air = "")`. `Wrist::setAir(air)`, and `Wrist::nearOn()`: on the relay, paired, and not in NOT NOW. The host binary's `speak` gains `hello <key> <battery> <secret|-> <quiet|-> <air>` and `heard <ch> [<air>:<rssi> ...]`.

- [ ] **Step 1: Write the failing tests.** In `logic_test.cpp`, `hearing()`: the address written and made (locally administered and unicast for any noise); an empty listen reporting `near: []`; each band once at its strongest, strongest first; a reading brought into −100..0; twenty bands in either order leaving the strongest twelve, and one pushed out coming back when heard stronger; the longest report (294 bytes) and the longest hello fitting `FRAME_MAX`; the hello saying `air` only when there is one; and `nearOn()` through pairing, the relay's NOT NOW, a hold's NOT NOW, the socket dropping and new letters. In `tests/firmware.test.js`, three bands paired in one room say their air as the firmware writes it, report as it writes them, and each phone lists exactly the bands its band heard.

In `firmware/host/logic_test.cpp`:

````diff
--- a/firmware/host/logic_test.cpp
+++ b/firmware/host/logic_test.cpp
@@ -608,6 +608,109 @@ void said() {
   CHECK(readCommand("   ").verb.empty());
 }
 
+/** A band's address as a report writes it: 02 00 00 00 00 <i>. */
+std::string airOf(int i) {
+  const uint8_t mac[6] = {0x02, 0, 0, 0, 0, static_cast<uint8_t>(i)};
+  return airHex(mac);
+}
+
+void hear(Hearing& h, int i, int rssi) {
+  const uint8_t mac[6] = {0x02, 0, 0, 0, 0, static_cast<uint8_t>(i)};
+  h.heard(mac, rssi);
+}
+
+void hearing() {
+  const uint8_t written[6] = {0x02, 0xab, 0xcd, 0xef, 0x01, 0x23};
+  CHECK(airHex(written) == "02abcdef0123");
+
+  // A new address every boot, from the band's own noise: locally administered and unicast, never the chip's.
+  uint8_t mac[6];
+  uint32_t n = 0;
+  makeAir(mac, [&n] { return n++ ? 0x00006655u : 0x44332211u; });
+  CHECK(airHex(mac) == "122233445566");
+  for (const uint32_t noise : {0x00000000u, 0xFFFFFFFFu, 0x000000FDu}) {
+    makeAir(mac, [noise] { return noise; });
+    CHECK((mac[0] & 0x01) == 0 && (mac[0] & 0x02) == 0x02);
+  }
+
+  // A listen that heard nobody still reports: a band that listened and heard nobody is evidence too.
+  Hearing h;
+  CHECK(h.size() == 0 && h.frame(6) == "{\"t\":\"heard\",\"ch\":6,\"near\":[]}");
+
+  // Each band once, at the strongest of its beacons; the strongest band first.
+  hear(h, 0x0a, -70);
+  hear(h, 0x0b, -50);
+  hear(h, 0x0a, -60);
+  hear(h, 0x0a, -80);
+  CHECK(h.size() == 2);
+  CHECK(h.frame(11) == "{\"t\":\"heard\",\"ch\":11,\"near\":[[\"02000000000b\",-50],[\"02000000000a\",-60]]}");
+  h.clear();
+  CHECK(h.size() == 0 && h.frame(11) == "{\"t\":\"heard\",\"ch\":11,\"near\":[]}");
+
+  // A reading the relay would not take is brought into its range, not dropped.
+  hear(h, 1, -120);
+  hear(h, 2, 3);
+  CHECK(h.frame(1) == "{\"t\":\"heard\",\"ch\":1,\"near\":[[\"020000000002\",0],[\"020000000001\",-100]]}");
+  CHECK(saidLine(h.frame(1)).empty());  // a report every ten seconds is not said on the console; `near` says it
+
+  // More than HEARD_MAX: the strongest HEARD_MAX, in whatever order they were heard.
+  auto strongest = [](int from, int to) {  // bands from..to, heard at -80 + i, strongest first
+    std::string f = "{\"t\":\"heard\",\"ch\":6,\"near\":[";
+    for (int i = to; i >= from; --i) f += std::string(i == to ? "" : ",") + "[\"" + airOf(i) + "\"," + std::to_string(-80 + i) + "]";
+    return f + "]}";
+  };
+  Hearing up, down;
+  for (int i = 0; i < 20; ++i) hear(up, i, -80 + i);
+  for (int i = 19; i >= 0; --i) hear(down, i, -80 + i);
+  CHECK(up.size() == HEARD_MAX && down.size() == HEARD_MAX);
+  CHECK(up.frame(6) == strongest(8, 19) && down.frame(6) == strongest(8, 19));
+  // One pushed out comes back when it is heard stronger, and the weakest goes.
+  hear(down, 0, -10);
+  CHECK(down.frame(6).rfind("{\"t\":\"heard\",\"ch\":6,\"near\":[[\"" + airOf(0) + "\",-10],[\"" + airOf(19) + "\",-61]", 0) == 0);
+  CHECK(down.frame(6).find(airOf(8)) == std::string::npos && down.frame(6).find(airOf(9)) != std::string::npos);
+
+  // The longest frames a band sends fit its outbox: a full report on channel 14, and the longest hello.
+  Hearing full;
+  for (int i = 0; i < 16; ++i) {
+    const uint8_t weak[6] = {0xfe, 0xff, 0xff, 0xff, 0xff, static_cast<uint8_t>(i)};
+    full.heard(weak, -100);
+  }
+  CHECK(full.frame(14).size() == 294 && full.frame(14).size() < FRAME_MAX);
+  const std::string f32(32, 'f');
+  CHECK(helloFrame(f32, f32, 100, f32, true, "feffffffffff").size() < FRAME_MAX);
+
+  // The hello says the band's address only when it has one.
+  const std::string key = "000102030405060708090a0b0c0d0e0f", id = idFor(key);
+  CHECK(helloFrame(id, key, 62, "", false, "02abcdef0123") ==
+        "{\"t\":\"wristband\",\"id\":\"" + id + "\",\"key\":\"" + key + "\",\"v\":2,\"battery\":62,\"air\":\"02abcdef0123\"}");
+  Wrist w(key);
+  w.setBattery(62, 1000);
+  w.setAir("02abcdef0123");
+  w.linkUp(1000);
+  CHECK(w.take() == std::vector<std::string>{helloFrame(id, key, 62, "", false, "02abcdef0123")});
+
+  // It beacons and listens only on the Wi-Fi, paired, and not in NOT NOW.
+  CHECK(!w.nearOn());  // not paired
+  w.frame("{\"t\":\"paired\",\"secret\":\"" + f32 + "\"}", 1000);
+  CHECK(w.nearOn());
+  w.frame("{\"t\":\"show\",\"show\":{\"kind\":\"off\",\"quiet\":true}}", 1000);
+  CHECK(!w.nearOn());  // NOT NOW from the relay
+  w.frame("{\"t\":\"show\",\"show\":{\"kind\":\"off\"}}", 1000);
+  CHECK(w.nearOn());
+  w.keyDown(1, 2000);
+  w.tick(2000 + HOLD_MS);
+  CHECK(!w.nearOn());  // NOT NOW from the wrist, before the relay has shown it
+  w.keyUp(1, 2000 + HOLD_MS);
+  w.frame("{\"t\":\"show\",\"show\":{\"kind\":\"off\"}}", 4000);
+  CHECK(w.nearOn());
+  w.linkDown(5000);
+  CHECK(!w.nearOn());  // off the relay
+  w.linkUp(6000);
+  CHECK(w.nearOn());
+  w.frame("{\"t\":\"show\",\"show\":{\"kind\":\"pairing\",\"code\":\"UDXE\"}}", 6000);
+  CHECK(!w.nearOn());  // unpaired
+}
+
 // ---------- speak: this code, in front of the real relay ----------
 
 std::string quote(const std::string& s) {
@@ -638,12 +741,27 @@ std::string answer(const Command& c) {
     return sha256Hex(bytes.empty() ? none : bytes.data(), bytes.size());
   }
   if (c.verb == "hello") {
-    // hello <key> <battery> [secret|-] [quiet]
+    // hello <key> <battery> [secret|-] [quiet|-] [air]
     std::istringstream in(c.arg);
-    std::string key, secret, quiet;
+    std::string key, secret, quiet, air;
     int battery = -1;
-    in >> key >> battery >> secret >> quiet;
-    return helloFrame(idFor(key), key, battery, secret == "-" ? "" : secret, quiet == "quiet");
+    in >> key >> battery >> secret >> quiet >> air;
+    return helloFrame(idFor(key), key, battery, secret == "-" ? "" : secret, quiet == "quiet", air);
+  }
+  if (c.verb == "heard") {
+    // heard <ch> [<air>:<rssi> ...]: one listen, reported as the band reports it
+    std::istringstream in(c.arg);
+    int ch = 0;
+    in >> ch;
+    Hearing h;
+    std::string one;
+    while (in >> one) {
+      const size_t colon = one.find(':');
+      const std::vector<uint8_t> mac = hexBytes(one.substr(0, colon));
+      if (colon == std::string::npos || mac.size() != 6) return "bad " + one;
+      h.heard(mac.data(), std::atoi(one.c_str() + colon + 1));
+    }
+    return h.frame(ch);
   }
   if (c.verb == "battery") return batteryFrame(std::atoi(c.arg.c_str()));
   if (c.verb == "hold") return HOLD_FRAME;
@@ -790,6 +908,7 @@ int main(int argc, char** argv) {
   rejoin();
   console();
   said();
+  hearing();
   std::printf("ok: %d checks\n", checks);
   return 0;
 }
````

In `tests/firmware.test.js`:

````diff
--- a/tests/firmware.test.js
+++ b/tests/firmware.test.js
@@ -256,6 +256,55 @@ test('what the firmware says, the relay takes; what the relay says, the firmware
   }
 });
 
+test('what the firmware reports it heard, the relay takes: each phone lists the bands its band heard', { skip }, async () => {
+  const relay = await createRelay({ port: 0, host: '127.0.0.1', root: dir });
+  const socks = [];
+  try {
+    // Three bands, each saying its address on the air, each paired to a phone in one room.
+    const names = ['vi', 'x', 'y'];
+    const airs = ['02abcdef0001', '02abcdef0002', '02abcdef0003'];
+    const all = [];
+    for (const [i, air] of airs.entries()) {
+      const [key] = speak(['key']);
+      const [hello] = speak([`hello ${key} 80 - - ${air}`]);
+      assert.deepEqual(JSON.parse(hello), { t: 'wristband', id: idOf(key), key, v: 2, battery: 80, air });
+      const band = await open(relay.port, 'arduino');
+      socks.push(band);
+      band.send(hello);
+      const { show: { code } } = await band.until('show', (m) => m.show.kind === 'pairing');
+      const person = await phone(relay.port, 'near-room');
+      socks.push(person);
+      person.send({ t: 'pair', code });
+      await person.until('view', (m) => m.view.me.check);
+      person.send({ t: 'confirm', yes: true });
+      await person.until('paired');
+      person.send({ t: 'pick', track: names[i] });
+      person.send({ t: 'arm', intent: 'hi' });
+      all.push({ band, person });
+    }
+    const listed = async (p, n) => (await p.person.until('view', (m) => m.view.near.length === n)).view.near.map((q) => q.pick).sort();
+    const [vi, x, y] = all;
+    assert.deepEqual(await listed(vi, 2), ['x', 'y'], 'before any band has reported, the whole room');
+
+    // vi heard x, x heard vi, and y listened and heard nobody: as the firmware writes each report.
+    const reports = speak([`heard 6 ${airs[1]}:-48`, `heard 6 ${airs[0]}:-52`, 'heard 6']);
+    assert.deepEqual(JSON.parse(reports[0]), { t: 'heard', ch: 6, near: [[airs[1], -48]] });
+    assert.deepEqual(JSON.parse(reports[2]), { t: 'heard', ch: 6, near: [] });
+    for (const [i, p] of all.entries()) {
+      p.band.send(reports[i]);
+      p.band.send(speak(['ping'])[0]);
+      await p.band.until('pong');  // the report before it was taken
+    }
+    relay.tickNear();
+    assert.deepEqual(await listed(vi, 1), ['x']);
+    assert.deepEqual(await listed(x, 1), ['vi']);
+    assert.deepEqual(await listed(y, 0), [], 'a band that heard nobody, and nobody heard, lists no band');
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

Expected: the host tests do not compile, so every test in the file fails (`ℹ tests 106`, `ℹ fail 106`), first at `logic_test.cpp:614:10: error: 'airHex' was not declared in this scope` and `'Hearing' was not declared in this scope`.

- [ ] **Step 3: Implement.**

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -1155,17 +1155,111 @@ inline std::string idFor(const std::string& keyHex) {
   return sha256Hex(bytes.empty() ? none : bytes.data(), bytes.size()).substr(0, 32);
 }
 
+// ---------- near: what a band hears of the others ----------
+//
+// While it is on the relay, paired and not in NOT NOW, a band beacons four
+// bytes over ESP-NOW under an address new at every boot, and now and then
+// listens for the others' beacons. What it heard goes to the relay, which
+// alone decides who is near (relay/room.js): the band shows none of it, and
+// no phone is ever sent a number. main.cpp holds the radio; this holds what
+// a listen keeps and the report it becomes.
+
+constexpr uint32_t BEACON_MS = 500;        // a beacon this often
+constexpr uint32_t LISTEN_MS = 1000;       // a listen lasts this long...
+constexpr uint32_t HEAR_EVERY_MS = 10000;  // ...once in this long, and is reported as soon as it ends
+constexpr size_t HEARD_MAX = 12;           // a report names the strongest this many bands
+constexpr size_t FRAME_MAX = 320;          // the longest frame a band sends, its ending 0 counted: a full report is 294
+constexpr uint8_t BEACON[4] = {'O', 'T', 'B', '1'};  // all a beacon says; the address it comes from says whose
+
+/** Six address bytes as twelve lower-case hex digits, as the hello's air and a report write them. */
+inline std::string airHex(const uint8_t* mac) {
+  static const char DIGITS[] = "0123456789abcdef";
+  std::string s;
+  for (int i = 0; i < 6; ++i) {
+    s += DIGITS[mac[i] >> 4];
+    s += DIGITS[mac[i] & 0xF];
+  }
+  return s;
+}
+
+/** This boot's address on the air, from the band's own noise: locally administered and unicast, so never the chip's. */
+inline void makeAir(uint8_t* out, const std::function<uint32_t()>& random32) {
+  const uint32_t a = random32(), b = random32();
+  out[0] = static_cast<uint8_t>((a & 0xFC) | 0x02);
+  out[1] = static_cast<uint8_t>(a >> 8);
+  out[2] = static_cast<uint8_t>(a >> 16);
+  out[3] = static_cast<uint8_t>(a >> 24);
+  out[4] = static_cast<uint8_t>(b);
+  out[5] = static_cast<uint8_t>(b >> 8);
+}
+
+/** One listen: each band heard, at the strongest of its beacons, and only the strongest HEARD_MAX bands. */
+class Hearing {
+ public:
+  struct Heard {
+    uint8_t mac[6];
+    int rssi;
+  };
+
+  /** A beacon from `mac` at `rssi` dBm, brought into -100..0, the range the relay takes. */
+  void heard(const uint8_t* mac, int rssi) {
+    rssi = rssi < -100 ? -100 : rssi > 0 ? 0 : rssi;
+    for (Heard& h : heard_) {
+      if (std::equal(h.mac, h.mac + 6, mac)) {
+        if (rssi > h.rssi) h.rssi = rssi;
+        return;
+      }
+    }
+    Heard h;
+    std::copy(mac, mac + 6, h.mac);
+    h.rssi = rssi;
+    if (heard_.size() < HEARD_MAX) {
+      heard_.push_back(h);
+      return;
+    }
+    // Full: a stronger band takes the place of the weakest.
+    auto weakest = std::min_element(heard_.begin(), heard_.end(), [](const Heard& x, const Heard& y) { return x.rssi < y.rssi; });
+    if (rssi > weakest->rssi) *weakest = h;
+  }
+
+  size_t size() const { return heard_.size(); }
+  void clear() { heard_.clear(); }
+
+  /** Everyone heard, the strongest first. */
+  std::vector<Heard> strongest() const {
+    std::vector<Heard> s = heard_;
+    std::stable_sort(s.begin(), s.end(), [](const Heard& x, const Heard& y) { return x.rssi > y.rssi; });
+    return s;
+  }
+
+  /** The report the relay reads: {"t":"heard","ch":6,"near":[["02abcdef0123",-48],...]}. Heard nobody, near is []. */
+  std::string frame(int ch) const {
+    std::string f = "{\"t\":\"heard\",\"ch\":" + std::to_string(ch) + ",\"near\":[";
+    bool first = true;
+    for (const Heard& h : strongest()) {
+      f += std::string(first ? "" : ",") + "[\"" + airHex(h.mac) + "\"," + std::to_string(h.rssi) + "]";
+      first = false;
+    }
+    return f + "]}";
+  }
+
+ private:
+  std::vector<Heard> heard_;
+};
+
 /**
  * The first thing a wristband says on every connection: who it is, the key
  * that proves it, the protocol, and — when it has them — the secret its
- * pairing gave it, a NOT NOW still waiting to be sent, and its battery.
+ * pairing gave it, a NOT NOW still waiting to be sent, its battery, and the
+ * address it beacons under this boot.
  */
 inline std::string helloFrame(const std::string& id, const std::string& key, int battery,
-                              const std::string& secret = "", bool quiet = false) {
+                              const std::string& secret = "", bool quiet = false, const std::string& air = "") {
   std::string f = "{\"t\":\"wristband\",\"id\":\"" + id + "\",\"key\":\"" + key + "\",\"v\":2";
   if (!secret.empty()) f += ",\"secret\":\"" + secret + "\"";
   if (quiet) f += ",\"quiet\":true";
   if (battery >= 0) f += ",\"battery\":" + std::to_string(battery);
+  if (!air.empty()) f += ",\"air\":\"" + air + "\"";
   return f + "}";
 }
 
@@ -1207,6 +1301,11 @@ class Wrist {
   const std::string& secret() const { return secret_; }
   bool up() const { return link_.up(); }
 
+  /** This boot's address on the air: the hello says it, so the relay knows whose beacons they are. */
+  void setAir(const std::string& air) { air_ = air; }
+  /** Whether to beacon and listen: on the relay, paired, and not in NOT NOW. */
+  bool nearOn() const { return link_.up() && !secret_.empty() && current() != "notnow"; }
+
   /** A battery reading. Low at 15% or below, again only after 20%; very low at 5% or below, again only after 10%. */
   void setBattery(int level, uint32_t now) {
     advance(now);
@@ -1304,7 +1403,7 @@ class Wrist {
     // A hold not yet heard rides on the hello: the relay applies it before anything else.
     const bool quiet = quiet_.dark();
     if (quiet) quiet_.sent(now);
-    out_.push_back(helloFrame(id_, key_, battery_, secret_, quiet));
+    out_.push_back(helloFrame(id_, key_, battery_, secret_, quiet, air_));
     settle(now);
   }
 
@@ -1879,7 +1978,7 @@ class Wrist {
     else if (mode_ == REST || mode_ == RESULT) step(now);
   }
 
-  std::string key_, id_, secret_;
+  std::string key_, id_, secret_, air_;
   int battery_ = -1;
   bool wifi_ = true;
   Link link_;
````

- [ ] **Step 4: Run** — the file (`ℹ pass 106` of 106; the host binary says `ok: 525 checks`), then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 401`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`. Run it in the background: fifteen C++ mutations take about twenty minutes. One guard is held but not listed: saying `"air":""` whenever the band has none turns 96 of the file's 106 tests red, since every hello then carries an air the relay refuses and the stand-in's hellos do not; its first failure is the host check that `helloFrame(id, key, 62)` is exactly the old hello. And a mutation must still use `air`: deleting the line that writes it leaves the parameter unused, which `-Werror` makes a compile error, and all 106 go red for the wrong reason.

````json
[
 {
  "label": "a band heard twice keeps its first reading",
  "file": "firmware/src/band_logic.h",
  "from": "        if (rssi > h.rssi) h.rssi = rssi;",
  "to": "        if (false) h.rssi = rssi;",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "a reading over 0 is kept",
  "file": "firmware/src/band_logic.h",
  "from": "rssi = rssi < -100 ? -100 : rssi > 0 ? 0 : rssi;",
  "to": "rssi = rssi < -100 ? -100 : rssi;",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "a reading under -100 is kept",
  "file": "firmware/src/band_logic.h",
  "from": "rssi = rssi < -100 ? -100 : rssi > 0 ? 0 : rssi;",
  "to": "rssi = rssi > 0 ? 0 : rssi;",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "a full listen keeps growing",
  "file": "firmware/src/band_logic.h",
  "from": "    if (heard_.size() < HEARD_MAX) {",
  "to": "    if (true) {",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "a full listen takes whoever comes next",
  "file": "firmware/src/band_logic.h",
  "from": "    if (rssi > weakest->rssi) *weakest = h;",
  "to": "    *weakest = h;",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "a full listen takes nobody new",
  "file": "firmware/src/band_logic.h",
  "from": "    if (rssi > weakest->rssi) *weakest = h;",
  "to": "    if (false) *weakest = h;",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "the weakest first",
  "file": "firmware/src/band_logic.h",
  "from": "[](const Heard& x, const Heard& y) { return x.rssi > y.rssi; }",
  "to": "[](const Heard& x, const Heard& y) { return x.rssi < y.rssi; }",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "the outbox is as it was",
  "file": "firmware/src/band_logic.h",
  "from": "constexpr size_t FRAME_MAX = 320;",
  "to": "constexpr size_t FRAME_MAX = 256;",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "an address that may be the chip's kind",
  "file": "firmware/src/band_logic.h",
  "from": "  out[0] = static_cast<uint8_t>((a & 0xFC) | 0x02);",
  "to": "  out[0] = static_cast<uint8_t>(a);",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "the nibbles the wrong way round",
  "file": "firmware/src/band_logic.h",
  "from": "    s += DIGITS[mac[i] >> 4];\n    s += DIGITS[mac[i] & 0xF];",
  "to": "    s += DIGITS[mac[i] & 0xF];\n    s += DIGITS[mac[i] >> 4];",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks",
   "what the firmware reports it heard, the relay takes: each phone lists the bands its band heard"
  ]
 },
 {
  "label": "the hello never says the air",
  "file": "firmware/src/band_logic.h",
  "from": "  if (!air.empty()) f += \",\\\"air\\\":\\\"\"",
  "to": "  if (false && !air.empty()) f += \",\\\"air\\\":\\\"\"",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks",
   "what the firmware reports it heard, the relay takes: each phone lists the bands its band heard"
  ]
 },
 {
  "label": "the wrist forgets its air",
  "file": "firmware/src/band_logic.h",
  "from": "helloFrame(id_, key_, battery_, secret_, quiet, air_)",
  "to": "helloFrame(id_, key_, battery_, secret_, quiet)",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "near off the relay",
  "file": "firmware/src/band_logic.h",
  "from": "bool nearOn() const { return link_.up() && ",
  "to": "bool nearOn() const { return ",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "near unpaired",
  "file": "firmware/src/band_logic.h",
  "from": "link_.up() && !secret_.empty() && current()",
  "to": "link_.up() && current()",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "near in NOT NOW",
  "file": "firmware/src/band_logic.h",
  "from": " && current() != \"notnow\"; }",
  "to": "; }",
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
A band keeps what one listen heard and reports it; its hello says its air

Hearing holds one listen: each band heard once, at the strongest of its
beacons, brought into the relay's -100..0, and never more than the
strongest HEARD_MAX. Its frame is the report the relay reads, strongest
first, and a listen that heard nobody still reports, with near: []. A
band's address on the air is made at every boot, locally administered and
unicast, and the hello says it as air only when there is one, so the
stand-in's hellos do not change. nearOn() is when to beacon and listen: on
the relay, paired, and not in NOT NOW. FRAME_MAX is the outbox's size, 320
bytes: a full report is 294, where the old 256 would have cut it short
without a word. Against the real relay, three bands' reports, as the
firmware writes them, leave each phone listing the bands its band heard.

Mutation-checked: 15 mutations, all held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 5: The band beacons, listens and reports; its console says what it heard

**Files:**
- Modify: `firmware/src/main.cpp`

**Interfaces:**
- Consumes: Task 4's constants, `airHex`, `makeAir`, `Hearing`, `Wrist::setAir` and `Wrist::nearOn`; `sendFrame()`, `report()`, `run()`, `help()`, `setup()` and `loop()` in `main.cpp`; ESP-IDF 4.4's `esp_now_init`, `esp_now_add_peer`, `esp_now_send`, `esp_wifi_config_espnow_rate`, `esp_wifi_set_mac`, `esp_wifi_get_mac`, `esp_wifi_set_promiscuous_filter`, `esp_wifi_set_promiscuous_rx_cb` and `esp_wifi_set_promiscuous`.
- Produces: on the band, a report every `HEAR_EVERY_MS` while `nearOn()`; the console's `near`, `near off`, `near listen` and `near on`; on the Plus, `show`'s `power` line, the mean USB draw since the last `show`.

There is no automated test for this task: `main.cpp` is only the hardware, and nothing in it decides anything. The build (P3) holds it to both boards' compilers, and Task 7 holds it to the air.

- [ ] **Step 1: Write the radio.** At boot, after `WiFi.mode(WIFI_STA)`, a random address from `makeAir()` goes to `esp_wifi_set_mac(WIFI_IF_STA, ...)`, and only if the radio takes it does the `Wrist` get it as its air. On the first join, ESP-NOW starts with the broadcast peer on the Wi-Fi's own channel (`channel = 0`), 6 Mbps, and a promiscuous filter of management frames. The promiscuous callback runs on the Wi-Fi task: it takes an ESP-NOW frame (`d[0] == 0xD0`, `d[24] == 127`) that carries `OTB1`, copies its sender (`d + 10`) and RSSI into a ring of 32 under a spinlock, and does nothing else. The loop takes the ring into the `Hearing`, beacons every `BEACON_MS`, switches promiscuous mode on for `LISTEN_MS` every `HEAR_EVERY_MS`, and when a listen ends sends `frame(WiFi.channel())` through `sendFrame()`. Whenever `nearOn()` is false it stops listening and forgets the listen. The outbox's text grows to `FRAME_MAX`. The AXP192 exists only in ESP32 builds of M5Unified, not in the StickS3's ESP32-S3 build, so its two calls sit under `#if defined(CONFIG_IDF_TARGET_ESP32)`.

In `firmware/src/main.cpp`:

````diff
--- a/firmware/src/main.cpp
+++ b/firmware/src/main.cpp
@@ -10,7 +10,8 @@
 //
 // Everything that decides anything is in band_logic.h, which the tests build
 // and run on a laptop. This file is only the hardware round it: the screen,
-// the speaker, the two buttons, the battery, Wi-Fi, the socket, and a serial
+// the speaker, the two buttons, the battery, Wi-Fi, the socket, the beacon
+// and the listen that tell the relay which bands are near, and a serial
 // console to say which Wi-Fi and which relay. The socket has a task of its
 // own, so nothing the network does can hold up the button or the screen.
 
@@ -18,6 +19,8 @@
 #include <Preferences.h>
 #include <WebSocketsClient.h>
 #include <WiFi.h>
+#include <esp_now.h>
+#include <esp_wifi.h>
 
 #include <algorithm>
 #include <atomic>
@@ -65,6 +68,9 @@ std::string shown;                // what the console last said about a show
 
 int battery = -1;       // percent, or -1 while it will not say
 uint32_t batteryAt = 0;
+bool axp = false;       // a StickC Plus: its power chip says what the band draws from USB
+float usbSum = 0;       // mA, a reading a second, since the console last said it
+uint32_t usbCount = 0, usbAt = 0;
 std::string drawn;      // what is on the screen now, so it is drawn again only when that changes
 int lit = -1;           // the backlight as last set
 std::string typed;      // the console line so far
@@ -122,7 +128,7 @@ struct Event {
 enum : uint8_t { OUT_SEND, OUT_DROP };
 struct Out {
   uint8_t kind;
-  char text[256];  // a hello with its key, secret and quiet is about 190 bytes
+  char text[FRAME_MAX];  // the longest a band sends: a report of HEARD_MAX bands (see band_logic.h)
 };
 
 QueueHandle_t events = nullptr;  // socket task -> loop
@@ -312,6 +318,146 @@ void watchWifi(uint32_t now) {
   }
 }
 
+// ---------- near: the beacon and the listen ----------
+//
+// The radio half of Hearing (band_logic.h). While wrist->nearOn(), the band
+// broadcasts BEACON by ESP-NOW every BEACON_MS, and every HEAR_EVERY_MS
+// listens for LISTEN_MS in promiscuous mode, because Arduino-ESP32 2.0's
+// ESP-NOW receive callback carries no RSSI; then it reports what it heard.
+// Measured on both bands before it was built: beside the Wi-Fi and a TLS
+// socket to the relay, no beacon lost.
+
+const uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
+uint8_t air[6] = {0, 0, 0, 0, 0, 0};  // this boot's address on the air (makeAir)
+bool airSet = false;                  // the radio took it; if not, the band neither beacons nor listens
+bool nearReady = false;               // ESP-NOW is up: once, on the first join
+bool nearWanted = true;               // `near off` on the console stops both, to test a band gone quiet
+bool beaconWanted = true;             // `near listen` stops only the beacon: two bands so hear nobody, and say so
+bool listening = false;
+uint32_t beaconAt = 0, listenAt = 0;
+uint32_t beacons = 0, beaconsRefused = 0;
+Hearing hearing;                      // the listen now
+Hearing lastHeard;                    // the last listen, for the console
+int lastChannel = 0;
+uint32_t lastHeardAt = 0;             // 0 until a listen has ended
+
+// Beacons caught on the Wi-Fi task, taken into `hearing` every time round the loop.
+struct Caught {
+  uint8_t mac[6];
+  int rssi;
+};
+constexpr size_t CAUGHT_MAX = 32;
+Caught caught[CAUGHT_MAX];
+size_t caughtCount = 0;
+portMUX_TYPE caughtLock = portMUX_INITIALIZER_UNLOCKED;
+
+/** On the Wi-Fi task: an ESP-NOW frame (a vendor-specific action frame) that carries BEACON. Its sender is address 2. */
+void onAir(void* buf, wifi_promiscuous_pkt_type_t type) {
+  if (type != WIFI_PKT_MGMT) return;
+  const auto* p = static_cast<const wifi_promiscuous_pkt_t*>(buf);
+  const uint8_t* d = p->payload;
+  const int len = static_cast<int>(p->rx_ctrl.sig_len);
+  if (len < 29 || d[0] != 0xD0 || d[24] != 127) return;
+  for (int i = 25; i + static_cast<int>(sizeof BEACON) <= len; ++i) {
+    if (memcmp(d + i, BEACON, sizeof BEACON) != 0) continue;
+    portENTER_CRITICAL_ISR(&caughtLock);
+    if (caughtCount < CAUGHT_MAX) {
+      memcpy(caught[caughtCount].mac, d + 10, 6);
+      caught[caughtCount].rssi = p->rx_ctrl.rssi;
+      ++caughtCount;
+    }
+    portEXIT_CRITICAL_ISR(&caughtLock);
+    return;
+  }
+}
+
+/** ESP-NOW, on the first join: the broadcast peer, the beacon's rate, and what the listen lets through. */
+void startNear() {
+  if (esp_now_init() != ESP_OK) {
+    Serial.println("near: ESP-NOW would not start");
+    return;
+  }
+  esp_now_peer_info_t peer = {};
+  memcpy(peer.peer_addr, BROADCAST, 6);
+  peer.channel = 0;  // the channel the Wi-Fi is on
+  peer.ifidx = WIFI_IF_STA;
+  peer.encrypt = false;
+  esp_now_add_peer(&peer);
+  // 6 Mbps, not the default 1: a room of bands takes a sixth of the airtime.
+  if (esp_wifi_config_espnow_rate(WIFI_IF_STA, WIFI_PHY_RATE_6M) != ESP_OK) Serial.println("near: 6 Mbps refused");
+  wifi_promiscuous_filter_t f = {};
+  f.filter_mask = WIFI_PROMIS_FILTER_MASK_MGMT;
+  esp_wifi_set_promiscuous_filter(&f);
+  esp_wifi_set_promiscuous_rx_cb(onAir);
+  nearReady = true;
+}
+
+void stopListening() {
+  if (!listening) return;
+  esp_wifi_set_promiscuous(false);
+  listening = false;
+}
+
+/** Every time round the loop: take in what was caught, beacon, listen, and after each listen, report. */
+void hearTick(uint32_t now) {
+  if (!nearReady && airSet && WiFi.status() == WL_CONNECTED) startNear();
+  Caught got[CAUGHT_MAX];
+  portENTER_CRITICAL(&caughtLock);
+  const size_t n = caughtCount;
+  memcpy(got, caught, n * sizeof(Caught));
+  caughtCount = 0;
+  portEXIT_CRITICAL(&caughtLock);
+  if (!nearReady || !nearWanted || !wrist->nearOn()) {
+    stopListening();
+    hearing.clear();
+    return;
+  }
+  for (size_t i = 0; i < n; ++i) hearing.heard(got[i].mac, got[i].rssi);
+  if (beaconWanted && now - beaconAt >= BEACON_MS) {
+    beaconAt = now;
+    if (esp_now_send(BROADCAST, BEACON, sizeof BEACON) == ESP_OK) ++beacons;
+    else ++beaconsRefused;
+  }
+  if (!listening && now - listenAt >= HEAR_EVERY_MS) {
+    listenAt = now;
+    hearing.clear();
+    listening = esp_wifi_set_promiscuous(true) == ESP_OK;
+  } else if (listening && now - listenAt >= LISTEN_MS) {
+    stopListening();
+    lastChannel = WiFi.channel();
+    sendFrame(hearing.frame(lastChannel));  // heard nobody is a report too
+    lastHeard = hearing;
+    lastHeardAt = now;
+    hearing.clear();
+  }
+}
+
+/** Whether it beacons and listens now, and if not, why. */
+const char* nearState() {
+  if (!airSet) return "off: the radio would not take an address of its own";
+  if (!nearReady) return "not yet: waiting for the wi-fi";
+  if (!nearWanted) return "off, from the console (near on)";
+  if (!wrist->up()) return "not now: not on the relay";
+  if (wrist->secret().empty()) return "not now: not paired";
+  if (!wrist->nearOn()) return "not now: NOT NOW";
+  if (!beaconWanted) return "listening, not beaconing, from the console (near on)";
+  return "beaconing and listening";
+}
+
+void reportNear(uint32_t now) {
+  uint8_t mac[6] = {0, 0, 0, 0, 0, 0};
+  esp_wifi_get_mac(WIFI_IF_STA, mac);
+  Serial.printf("near    %s; on the air as %s; %u beacons sent, %u refused\n", nearState(), airHex(mac).c_str(),
+                static_cast<unsigned>(beacons), static_cast<unsigned>(beaconsRefused));
+  if (!lastHeardAt) {
+    Serial.println("        no listen yet");
+    return;
+  }
+  Serial.printf("        last listen %u s ago, channel %d: %s\n", static_cast<unsigned>((now - lastHeardAt) / 1000), lastChannel,
+                lastHeard.size() ? "heard" : "heard nobody");
+  for (const Hearing::Heard& h : lastHeard.strongest()) Serial.printf("        %s  %d dBm\n", airHex(h.mac).c_str(), h.rssi);
+}
+
 // ---------- the screen ----------
 
 int px(float v, float k) { return static_cast<int>(v * k + 0.5f); }
@@ -535,7 +681,9 @@ void help() {
       "  press face|side         a press, as a finger makes it\n"
       "  hold face|side          a hold, let go just after it counts\n"
       "  face                    what the screen shows now\n"
-      "  sound <name>            play one of the band's sounds, e.g. sound found");
+      "  sound <name>            play one of the band's sounds, e.g. sound found\n"
+      "  near                    what it last heard of other bands, and whether it beacons\n"
+      "  near off|listen|on      stop both, stop only beaconing, or do both again");
 }
 
 void report() {
@@ -551,6 +699,14 @@ void report() {
   Serial.printf("memory  %u bytes free, %u at the least; sound %s\n", static_cast<unsigned>(ESP.getFreeHeap()),
                 static_cast<unsigned>(ESP.getMinFreeHeap()),
                 !speaker ? "none: light only" : buzzer ? "on the buzzer, octaves up" : "on the speaker");
+  // Plugged in with the battery full, what it draws is what the band uses: near on against near off.
+  if (axp) {
+    Serial.printf("power   %.1f mA from USB, the mean of %u readings since the last show\n", usbCount ? usbSum / usbCount : 0.0f,
+                  static_cast<unsigned>(usbCount));
+    usbSum = 0;
+    usbCount = 0;
+  }
+  reportNear(millis());
 }
 
 void run(const Command& c) {
@@ -596,6 +752,13 @@ void run(const Command& c) {
     }
     if (!speaker) Serial.println("no speaker on this band");
     soundDue = name;
+  } else if (c.verb == "near") {
+    const std::string a = trim(c.arg);
+    if (a == "off" || a == "listen" || a == "on") {
+      nearWanted = a != "off";
+      beaconWanted = a == "on";
+    }
+    reportNear(millis());
   } else if (c.verb == "forget") {
     prefs.remove("ssid");
     prefs.remove("pass");
@@ -629,6 +792,26 @@ void readBattery(uint32_t now) {
   if (wrist) wrist->setBattery(battery, now);
 }
 
+// The Plus's power chip, an AXP192, says what the band draws from USB, a
+// reading a second; the StickS3's build has no AXP192 in it at all.
+void startUsb() {
+#if defined(CONFIG_IDF_TARGET_ESP32)
+  axp = M5.getBoard() == m5::board_t::board_M5StickCPlus;
+  if (axp) M5.Power.Axp192.setAdcState(true);
+#endif
+}
+
+void readUsb(uint32_t now) {
+#if defined(CONFIG_IDF_TARGET_ESP32)
+  if (!axp || (usbAt && now - usbAt < 1000)) return;
+  usbAt = now;
+  usbSum += M5.Power.Axp192.getVBUSCurrent();
+  ++usbCount;
+#else
+  (void)now;
+#endif
+}
+
 }  // namespace
 
 void setup() {
@@ -647,6 +830,7 @@ void setup() {
   // no tone with it off, from M5Unified's output or a plain square wave; about
   // 18 dB over the room with it on, either way.
   if (M5.getBoard() == m5::board_t::board_M5StickCPlus) M5.Power.setExtOutput(true);
+  startUsb();
   M5.Display.setRotation(0);
   if (M5.Display.width() > M5.Display.height()) M5.Display.setRotation(1);
   M5.Display.setBrightness(LIGHT_OFF);
@@ -663,8 +847,14 @@ void setup() {
 
   // The radio on before the key is made: with it on, esp_random() is true noise.
   WiFi.mode(WIFI_STA);
+  // A new address on the air at every boot, from the same noise, before the
+  // Wi-Fi joins: nothing the band sends ties it to the band it was the night
+  // before, and it is never the chip's own.
+  makeAir(air, [] { return static_cast<uint32_t>(esp_random()); });
+  airSet = esp_wifi_set_mac(WIFI_IF_STA, air) == ESP_OK;
   // A new wristband at every boot: the key lives in RAM only, and the id is its hash.
   wrist = new Wrist(makeKey([] { return static_cast<uint32_t>(esp_random()); }));
+  if (airSet) wrist->setAir(airHex(air));
   prefs.begin("otb", false);
   if (prefs.isKey("id")) prefs.remove("id");  // the id an older build kept for good is not kept any more
   loadSettings();
@@ -695,6 +885,7 @@ void loop() {
   const uint32_t now = millis();
   console();
   readBattery(now);
+  readUsb(now);
   drain(now);
   // KEY1 is the face button, KEY2 the side one. The Wrist times the holds. A key
   // pressed from the console is down with the button, so it is the same press.
@@ -709,6 +900,7 @@ void loop() {
   wrist->tick(now);
   playSounds();  // before the frames and the face: a press's tick is heard as soon as it can be
   for (const std::string& f : wrist->take()) sendFrame(f);
+  hearTick(now);
   if (wrist->up() && batteryReport.due(battery, now)) {
     sendFrame(batteryFrame(battery));
     batteryReport.sent(battery, now);
````

- [ ] **Step 2: Build (P3).** Expected: two `[SUCCESS]` lines, no `src/` warning; `m5stickc` RAM 21.6%, flash 39.3%; `m5sticks3` RAM 21.5%, flash 36.8%. The first build of this code failed on the StickS3 alone with `'class m5::Power_Class' has no member named 'Axp192'`: that is what the `#if` is for.

- [ ] **Step 3: Run** `npm test`, which compiles `band_logic.h` and nothing of `main.cpp`. Expected: `ℹ fail 0`, `ℹ tests 401`.

- [ ] **Step 4: Commit, and close Stage B with P2**

```bash
git add firmware/src/main.cpp
```

````bash
git commit -F - <<'EOF'
The band beacons, listens and reports; its console says what it heard

At boot the band takes a random, locally administered address before it
joins the Wi-Fi, and only if the radio takes it does it beacon at all. On
the first join ESP-NOW starts, broadcasting at 6 Mbps on the Wi-Fi's own
channel. While nearOn(), it beacons OTB1 every BEACON_MS and, for LISTEN_MS
in every HEAR_EVERY_MS, listens in promiscuous mode, since Arduino-ESP32
2.0's ESP-NOW receive callback gives no RSSI; the callback only copies an
ESP-NOW frame's sender and RSSI into a ring, and the loop does the rest.
After each listen it sends the report. The console's near says what the
last listen heard and whether it is beaconing; near off, near listen and
near on stop both, stop the beacon, or start both. On the Plus, show says
the mean USB draw since the last show; the AXP192 is only in ESP32 builds,
so the StickS3's build leaves it out.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---

## Stage C — Docs and proof

### Task 6: The README says who is near, and the spec's real-band test is one that can pass

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-09-26-wrist-near-design.md`

- [ ] **Step 1: Write the README.** Promise 1 says what nearness is allowed to do; the relay's list says what it keeps and for how long; the wristband section gains *Who is near comes from the wristbands*, with the crowd model's figures from Task 3; the console paragraph gains `near`; the firmware section gains the address and *The beacon and the listen*; the canvas section says why the list is five, not everyone heard; abuse resistance gains *What a wristband says it heard*; and *Proximity* under *What is not done* becomes *Who is near has not met a crowd*.

- [ ] **Step 2: Correct the spec's §5.** It said to stop one band's beacon and watch the other's phone stop listing it. That cannot happen: a pair is scored from either side, and the silent band still hears the other; and a band that stops reporting altogether hides nobody (§2). The test that can pass tells both bands to listen without beaconing.

````diff
--- a/README.md
+++ b/README.md
@@ -84,7 +84,10 @@ each one.
    `near the bar`, `by the stage`, `somewhere out the back` — and nothing
    finer. There is no position anywhere in the system to leak. On phones
    alone, everyone is `in this room`: a web page cannot tell where in a venue
-   a phone is, and it does not guess. The finer bands wait for the wristbands.
+   a phone is, and it does not guess. The finer bands wait for markers a
+   venue would put up, which are not built. What wristbands hear of each
+   other only takes people off SAY HI's list (*Who is near*, below), and no
+   phone or wristband is ever told how near anyone is.
 2. **No name and no photo until you both say yes.** Before a mutual yes a
    person is a handle, a band and at most a track. Handles are per viewer —
    the same person has a different handle on every phone — so two phones
@@ -115,6 +118,9 @@ never becomes a match.
   put two phones at the same gig into two different rooms that share a name.
   The night is held in memory only; stop the relay and it is gone.
   - After every change the relay pushes each phone its own `viewFor()`.
+  - What each wristband heard of the others is kept 30 s, in memory, and
+    never leaves the relay; every five seconds each room works out who is
+    near whom and pushes only the views that changed.
   - A dropped socket is not leaving: a person stays in the room for two
     minutes, so a locked screen does not cost them their place.
   - Clips are kept in memory, one on the floor per person, for an hour —
@@ -251,6 +257,25 @@ that was taken.
   minute; the phone buzzes only when no live wristband plays it. Refused or
   out of reach, the band says `NOT SENT`. Never said by both, the number goes
   at fifteen minutes, and nothing says why.
+- **Who is near comes from the wristbands.** While a band is on the relay,
+  paired and not in NOT NOW, it beacons four bytes by ESP-NOW twice a second,
+  under an address it makes up at every boot, and for one second in every ten
+  it listens for the others and tells the relay whom it heard and how
+  strongly. The relay scores each pair of bands in a room by the median of
+  what each heard of the other in the last 30 s, and every five seconds works
+  out each band's five heard most strongly; one of the five stays while it is
+  among the ten strongest, so the list does not churn as people turn round.
+  With a band, SAY HI then lists those five, everyone without a band as
+  before, and anyone waved with either way or matched. Nobody else is taken
+  off without evidence — both bands heard from in the last 30 s, on the same
+  Wi-Fi channel — so a band just switched on or gone quiet, a band on another
+  channel, and the stand-in at `/band`, which has no radio, hide nobody and
+  are hidden from nobody. No strength, score or order reaches a phone or a
+  band: the list is only shorter, the rows are in the same order, and every
+  one still says `in this room`. On a modelled floor of 750 people, 150 of
+  them banded, with bodies in the way, 99.8% of each five are truly within
+  10 m, against 33% for five picked at random from what the band heard
+  (`tests/near-crowd.test.js`).
 - **The sound can be switched off, on the phone.** The wristband sheet has
   `SOUND: ON` under TEST THE LIGHT; off, the band only lights up. The switch is
   the person's own: the phone keeps it across nights and re-says it after
@@ -332,7 +357,12 @@ hand on it: `press face` or `press side` is a press, let go after 120 ms;
 down through the same edges as the button itself, so the band cannot tell
 them apart. `face` says what the screen shows: its words, field and light,
 the pairing letters included. `sound found`, or any of the band's sounds by
-name, plays it, to hear the speaker without a room around the band. Only the
+name, plays it, to hear the speaker without a room around the band. `near`
+says whether it is beaconing and listening, the address it is on the air
+under, and what its last listen heard; `near off` stops both, to test a band
+gone quiet, `near listen` stops only the beacon, so two bands both told it
+hear nobody and say so, and `near on` starts both again. On the Plus, `show` also says
+what the band draws from USB, the mean since the last `show`. Only the
 USB cable reaches the console, and
 whoever holds the cable holds the band and its buttons anyway; no frame from
 the relay reaches it.
@@ -389,7 +419,22 @@ the relay reaches it.
   called `LOW` and a `constexpr` loop once passed every test and broke only
   in PlatformIO.
 - **Its key is 128 random bits, made at every boot**, never the chip's MAC, and
-  kept only in RAM with the pairing's secret.
+  kept only in RAM with the pairing's secret. So is its address on the air:
+  before it joins the Wi-Fi it takes a random, locally administered one, and
+  says it in the hello as `air`. If the radio would not take it, the band
+  neither beacons nor listens.
+- **The beacon and the listen** are the only radio work beside the Wi-Fi. The
+  beacon is an ESP-NOW broadcast at 6 Mbps, so a room of bands takes a sixth
+  of the airtime it would at the default 1 Mbps. The listen is promiscuous
+  mode, because Arduino-ESP32 2.0's ESP-NOW receive callback gives no signal
+  strength; it takes only an ESP-NOW frame that carries `OTB1`, keeps the
+  strongest reading of each band in that second (`Hearing` in
+  `band_logic.h`), and reports the strongest twelve, or that it heard nobody.
+  Tried on both bands before it was built: beside the Wi-Fi and a TLS socket
+  to the relay, no beacon was lost, and the Plus drew about 101 mA while
+  listening against 55 to 75 mA without. A band's outgoing frame is 320
+  bytes now, which a full report (294) fits; it was 256, and a longer frame
+  would have been cut short without a word.
 - **The pairing code is as wide as the screen allows**, with four light modules
   round it. A tunnel address is a version 4 code, and the canvas's 115 pixels
   would make each module two pixels — too small to read off a screen this size.
@@ -465,6 +510,12 @@ the relay reaches it.
   band, or `WE FOUND EACH OTHER` on S11, counted only when both say it: the
   meeting face gains `FOUND: WAITING`, both bands a *found* reaction, and
   Tonight's `met` counts meetings found, not matches.
+- **Near is the five heard most strongly, not everyone heard.** Revision 6
+  lists the people whose wristband yours can hear. On a crowded floor that is
+  nearly everyone, so the list is the five heard most strongly, which is also
+  S5's own limit of five. People without a band cannot be heard, which says
+  nothing about where they are, so they are listed as before; the owner chose
+  that on 26 Sep 2026.
 
 ## Abuse resistance
 
@@ -515,6 +566,17 @@ was red-teamed and hardened. A red/blue pass found and closed:
   like. A band never starts a wave: with none to answer, nothing is recorded.
   A lent, taken or forgotten band can still make a match for its person, with
   or without their phone; blocking undoes it.
+- **What a wristband says it heard.** A report is dropped whole unless it
+  comes from a paired band's current socket, five seconds or more after its
+  last, on a channel from 1 to 14, with at most sixteen entries, each a
+  twelve-hex address and a whole signal strength from -100 to 0; a hello whose
+  `air` is not twelve lower-case hex digits is refused. An address counts only
+  as the address of exactly one band paired in the same room, so one claimed
+  twice, or from another room, counts for nobody. A band that lies changes
+  only its own person's list, and nearness only ever removes, so it can show
+  nobody a phone could not see already. A band beaconing under another's
+  address moves that band's nearness to where the liar stands, among
+  strangers in the same room, and no further.
 - **Rooms that never emptied.** A venue with nobody in it, nobody in its grace
   window, no clip still loading and no wristband still worn is now reclaimed, so
   a long-lived relay does not keep a room object for every venue anyone typed.
@@ -564,9 +626,15 @@ relay could drive what a wrist shows.
   small machine holds, or a restart nobody notices, needs the rooms kept
   outside the process first. A phone that used a tunnel address starts over
   at the fixed one: a browser keeps the app's storage per address.
-- **Proximity.** Wristbands pair and light, but nothing measures who is near
-  whom: every person is still `in this room`. Nearness wants ESP-NOW between
-  wristbands, which wants the hardware.
+- **Who is near has not met a crowd.** It has run through the real room on
+  a modelled floor, and not yet on the real bands. Bodies and reflections on
+  a real floor may differ from the model; ranking the strongest was chosen
+  because it leans on them least, and a walk through a venue is the check.
+  Not built: markers a venue puts up (`near the bar`, `by the stage`); a
+  correction between models, though a StickS3 heard a Plus 7 dB weaker than
+  the Plus heard it; and more than one Wi-Fi channel, since a band hears only
+  bands on its own channel, so a venue whose access points use several splits
+  its bands into groups, each of which keeps the others listed.
 - **The firmware has run on two wristbands, for one day.** On 25 Sep
   2026 a StickS3 and an M5StickC Plus joined an Android phone's hotspot and
   reached the relay through a quick tunnel, with that phone and a laptop
````

````diff
--- a/docs/superpowers/specs/2026-09-26-wrist-near-design.md
+++ b/docs/superpowers/specs/2026-09-26-wrist-near-design.md
@@ -206,10 +206,13 @@ All numbers are named constants in `firmware/src/band_logic.h`.
   within 10 m, as in the model (97% or more).
 - **The real bands**: each paired to a stand-in phone, both on SAY HI;
   `near` on each console shows the other heard; both phones list each
-  other. One band told to stop beaconing: after `HEARD_MS` the other's
-  phone no longer lists it, and the moment it beacons again it is back.
-  Then the Plus's USB draw with this firmware against today's, face dark,
-  battery full: no more than 10 mA more.
+  other. Both bands told to listen without beaconing: each reports
+  hearing nobody, and after `HEARD_MS` neither phone lists the other; the
+  moment one beacons again, both are back. (One band going silent alone
+  cannot show it: a pair is scored from either side, so the other band
+  still hears it; and a band that stops reporting hides nobody.) Then the
+  Plus's USB draw, face dark, battery full, beaconing and listening against
+  neither: no more than 10 mA more.
 
 ## Also to change when this is built
````

- [ ] **Step 3: Run** `npm test`. Expected: `ℹ fail 0`, `ℹ tests 401`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-26-wrist-near-design.md
```

````bash
git commit -F - <<'EOF'
README: who is near comes from the wristbands

Promise 1 says nearness only takes people off a list; the relay's notes say
what it keeps and for how long; the wristband section says how the five
are worked out and what the crowd model found; the console, the address on
the air and the radio join the firmware's section; the canvas section says
why the list is five; abuse resistance says what a lying band can and
cannot do; and Proximity under What is not done says what has not run.

The spec's real-band test asked for one band to stop beaconing and the
other's phone to stop listing it. A pair is scored from either side, so the
other band would still hear it, and a band that stops reporting hides
nobody: the test now tells both bands to listen without beaconing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 7: The real bands, with the owner

Nothing here is automated, and every step needs the owner: flashing needs his yes first, and a band he wears is his. Deploy the relay first if the bands are to use `https://on-the-beat.fly.dev` (Fly memory: he logs in himself; deploy any time except while he has said a demo is on), or run `npm start` and `npm run tunnel` and give both bands the tunnel's address with `relay`.

- [ ] **Step 1: Flash both** (P3's directories, `-t upload`, `--upload-port COM8` for the StickS3 and `COM9` for the Plus), after asking. On each console, `show` must say `near    not now: not paired`, and `on the air as <12 hex>` — not the chip's own address, and a new one after a reset.
- [ ] **Step 2: Pair each to a stand-in phone** in the built-in browser, both on SAY HI in one room. Within twenty seconds `near` on each console says `beaconing and listening`, and its last listen names the other band's address at some dBm; the relay's log shows no refused hello.
- [ ] **Step 3: Both lists.** Each stand-in lists the other person. Then `near listen` on both consoles; within `HEARD_MS` plus one tick (about 35 s), neither lists the other. `near on` on one: within one listen and one tick (about 15 s), both list each other again.
- [ ] **Step 4: Gone quiet hides nobody.** `near off` on one band; 35 s later both lists still show both people.
- [ ] **Step 5: What it costs.** The Plus on USB, battery full, face dark: `show`, then `near off`, 60 s, `show` (the mean with neither), `near on`, 60 s, `show` (the mean with both). Expected: no more than 10 mA between them; the spike's figures predict about 5.
- [ ] **Step 6: Leave the bands as found** (test personas memory): unpair both from the stand-ins, say what state each band is left in, and add a paragraph to README's *What is not done* saying what ran and what did not, then commit and push.
