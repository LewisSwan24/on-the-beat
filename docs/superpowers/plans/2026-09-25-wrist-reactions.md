# Wristband Reactions (A and B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The wristband answers the person wearing it, in sound and in light: every press is heard, a choice made on the wrist ends in SET, CHANGED or NOT SENT with its own sound and colour, pairing and a meeting number call the wearer, and a band that stops working for its person says so once. The sound can be switched off on the phone.

**Architecture:** The reactions are decided in the wrist machine, which is written twice (`app/lib/wrist.js` for `/band`, the `Wrist` class in `firmware/src/band_logic.h` for the band) and held to one table of cases (`tests/fixtures/wrist-cases.json`). Each input is a moment; a moment's reactions play in a fixed order, and `sounds()` hands out the names of sounds due, as `take()` hands out frames. The relay only carries each person's sound switch to their own band on its shows. The players are thin: `main.cpp` renders a sound's notes into one buffer for M5Unified's speaker, and `/band` plays the same notes through Web Audio.

**Tech Stack:** Node 22+ (`node --test`, `ws`), React 19 + Vite 8, C++17 on the laptop (MinGW-W64 g++ here, GCC in CI), C++11 on the band (Arduino-ESP32 2.x through PlatformIO `espressif32@^6.9.0`), M5Unified 0.2.22 or later, Web Audio.

**Spec:** `docs/superpowers/specs/2026-09-25-wrist-reactions-design.md` (approved by the owner on 25 Sep 2026; §1 the moments, §2 the rules, §3 who does what, §4 tests and proof). Read it before any task. The rule numbers below are the spec's.

This plan was written from a finished build: every task below was built in a scratch worktree, test first, and committed on its own with `npm test` green. The code blocks are those commits' diffs, so applying a task's blocks in order reproduces it. Each Step 2 was measured by running the task's tests on its parent's code. Each mutation list was measured at its task's commit, and all of them again on the finished code, where every one is still caught.

## Global Constraints

- Artefacts are English: code, comments, commit messages, README, test names. Talk to the owner in Chinese.
- **The principle (spec, Goal):** the wristband is quiet unless its wearer did something on it, or something came for them. A change the wearer makes on the phone to their own card or NOT NOW makes no sound, and NOT NOW makes none at all.
- **Sounds (spec §1):** triangle waves at full volume; `[Hz, ms]`, 0 Hz a rest. `tick` 1800/25 · `double` 1800/25, 0/60, 1800/25 · `down` 1047/90, 784/180 · `up` 1047/70, 1319/70, 1568/70, 2093/140 · `fall` 1568/100, 1047/200 · `low` 784/120, 523/220 · `ask` 1319/80, 0/50, 1760/160 · `jingle` 1319/80, 1568/80, 2637/80, 2093/80, 2349/80, 3136/200 · `warn` 880/150, 698/150, 880/150, 698/150. The longest, `jingle` and `warn`, last 600 ms.
- **Flashes (spec §1):** count × on / off ms. SET: the card's colour (white for OFF), 2 × 150/100 · CHANGED: red `#FF6B6B`, 3 × 120/90 · NOT SENT and a warning: orange `#FF8A00`, 2 × 350/250 · the check number: white, 2 × 150/100 · a meeting call: the meeting face, then off, `BLINK_MS` each, until answered. An on step is the colour at `LIGHT_FULL` with no words, code or bar; an off step is `LIGHT_OFF`.
- **New timings, named constants in both twins and in `CONSTS`:** `BLINK_MS = 500`, `HINT_MS = 3000`, `PAIR_AWAKE_MS = 120000`. Existing ones used: `STALE_MS = 10000`, `MEET_MS` (relay, 15 min), `RESULT_MS = 3000`. Never a literal in a test or a fixture.
- **The band's sound buffer:** `SOUND_RATE = 16000`, 8-bit unsigned, 128 silence; `SOUND_SAMPLES` = the longest sound's ms × 16 = 9600.
- **The band's compiler takes C++11** (Arduino-ESP32 2.x builds C++ as `gnu++11`) and sees `Arduino.h`'s macros (`LOW`, `HIGH`, `INPUT`, `bit()`, …) before `band_logic.h`. A `constexpr` function is one `return`; no name in `band_logic.h` may be one of those macros. `firmware/host/as_band.cpp` holds this from Task 1 on.
- The shared table decides behaviour: a rule is done when its cases pass on both twins. `tests/firmware.test.js` holds `SOUNDS`, `FLASHES`, the colours and every named timing equal on both.
- Repository `LewisSwan24/on-the-beat` (private). Commit after each task; push to `main` when a stage's `npm test` is green. Never the team repository `cimi2232/DECO3500`: `tools/hooks/pre-push` refuses it (check `ls .git/hooks/pre-push` before the first push; after a fresh clone, `cp tools/hooks/pre-push .git/hooks/pre-push`).
- `CLAUDE.md` is not in git and is not edited by this plan. Nothing from `../on-the-beat-research/` or `../on-the-beat-design/` enters the repository.
- `npm test` builds first (the relay serves `dist/`). Running one test file alone: `npm run build` first, and again after restoring a mutation.
- Windows host: the Bash tool is Git Bash; `python` there is the Store alias and hangs, so scripts are Node. The host binary's output is split on `/\r?\n/`. MinGW has no sanitizers; CI keeps them.
- `tests/copy.test.js` refuses the old one-button wording anywhere in `app/`, `relay/`, `firmware/src/` and `README.md`, including the phrase "three seconds": write 3 s.
- Flashing a band needs the owner's yes first, every time. The StickS3 is on `COM8`, the StickC Plus on `COM9`.
- Never more than ten background tasks at once. Work directly; this plan needs no fan-out.
- Commit messages end with the attribution trailer the session's system reminder gives (today: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## Three procedures used throughout

**P1 — Mutation check.** Every task that adds a guard lists mutations as JSON: break one guard, run one test file, and exactly the listed tests go red. The lists were measured at each task's own commit. Run later, a list may find more red, as later tests join, and a mutation whose line a later task rewrote no longer applies; on the finished code every mutation that still applies is caught.

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

If the wrong test goes red, or none does, stop: the test does not hold the guard. Fix the test, not the guard. A C++ mutation that leaves a variable unused fails the build under `-Werror` instead of the behaviour; those are written in a compiling form (`(void)x;`, `(same && !same)`), and the list says so in the label.

Put `Mutation-checked: <n> mutations, all held` in the task's commit body.

**P2 — Close a stage.** `npm test` (expect `ℹ fail 0`, `ℹ skipped 0`), then `git push origin main`. A push that cannot reach github.com:443 while `gh` works is the network: check with `curl -sI https://github.com`, retry, leave git config alone.

**P3 — Build the band.** Windows' path limit breaks PlatformIO in a deep directory, so build with short output directories:

```bash
T=/c/Users/LEWISD~1/AppData/Local/Temp/otbpio
mkdir -p $T && [ -d $T/libdeps ] || cp -r firmware/.pio/libdeps $T/libdeps
PLATFORMIO_BUILD_DIR=$T/build PLATFORMIO_LIBDEPS_DIR=$T/libdeps \
  /c/Users/LewisDong/.platformio/penv/Scripts/pio.exe run -d firmware -e m5stickc -e m5sticks3 2>&1 \
  | grep -E "error|src/.*warning|RAM:|Flash:|SUCCESS|FAILED"
```

Expected: two `[SUCCESS]` lines and no `src/` warning. The first `RAM:` line is the StickC Plus.

## Files

Created:

| File | Responsibility |
|---|---|
| `firmware/host/arduino_macros.h` | The names Arduino-ESP32 makes macros, for the band-compiler check |
| `firmware/host/as_band.cpp` | `band_logic.h` compiled as the band's compiler takes it; never run |
| `app/lib/bandsound.js` | The sound switch as the phone shows and says it |
| `app/lib/speaker.js` | The band's speaker in a browser: Web Audio, silent until a tap |
| `tests/store.test.js` | The switch in the store, the sheet's row, what the phone says |
| `tests/speaker.test.js` | The stand-in's speaker against a fake AudioContext |

Modified: `app/lib/wrist.js`, `firmware/src/band_logic.h`, `firmware/host/logic_test.cpp`, `firmware/src/main.cpp`, `firmware/platformio.ini`, `relay/band.js`, `relay/server.js`, `app/App.jsx`, `app/lib/net.js`, `app/lib/store.js`, `app/screens/Band.jsx`, `app/styles.css`, `tests/fixtures/wrist-cases.json`, `tests/wrist-table.js`, `tests/firmware.test.js`, `tests/band.test.js`, `tests/wristband.test.js`, `tests/net.test.js`, `README.md`.

## Stages

| Stage | Tasks | Leaves |
|---|---|---|
| A. The wrist reacts | 1–6 | every rule of spec §2 in both twins, on one table |
| B. The sound, carried | 7–9 | the band's renderer and colours; the relay and the phone carry the switch |
| C. The players | 10–11 | `main.cpp` plays and paints; `/band` plays and paints |
| D. Docs and proof | 12–14 | README; the browser proof; the real bands with the owner |

Every task ends green and is committed on its own; each stage ends with P2.

---

## Stage A — The wrist reacts

Every task in this stage changes both twins and the one table. The table's step keys used here:

- `"sounds": [...]` — the names `sounds()` gives at that step: exact, and `[]` unless said, so a stray sound anywhere fails.
- `"press": k` — a key down and, `PRESS` ms later, its key up. The step's `sent`, `sounds` and `face` are the key up's; `"downSounds"` (default `["tick"]`) is the key down's.
- `"show": ..., "with": {...}` (from Task 3) — a named show with fields laid over it, such as `"with": {"sound": false}`.

Run the table on both twins with `npm run build >/dev/null && node --test tests/wrist.test.js tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`. Each case runs as `wrist.js: <name>` and as `band_logic.h: <name>`.

### Task 1: Every press ticks, and each hold says so

**Files:**
- Create: `firmware/host/arduino_macros.h`, `firmware/host/as_band.cpp`
- Modify: `app/lib/wrist.js`, `firmware/src/band_logic.h`
- Test: `tests/wrist-table.js`, `firmware/host/logic_test.cpp`, `tests/fixtures/wrist-cases.json`, `tests/firmware.test.js`

**Interfaces:**
- Consumes: the existing wrist machine in both twins (`createWrist({ key })`, `Wrist(key)`, `take()`, `face(now)`).
- Produces:
  - JS: `export const SOUNDS` (`{ name: [[hz, ms], ...] }`), `export const FLASHES` (`{ name: { colour, count, on, off } }`); `wrist.sounds(): string[]`, the sounds due since it was last asked. Inside the machine: `react(sound, flash = null, cls = 0)` (cls 0 a key or a result, 1 a call, 2 a warning: the order Task 6 plays a moment in); `start(r, at)`; `settle(now)` at the end of every input, which starts the moment's reaction in place of the one playing; `advance(now)` at the start of every input, which ends the one playing once its sound and flash are over; and `commit(now, held = false)`. Until Task 4 no moment has more than one reaction, so there is no queue yet, and until Task 6 no order.
  - C++: `struct Note { uint16_t hz, ms; }`, `struct Sound { const char* name; const Note* notes; size_t count; }`, `constexpr Sound SOUNDS[]`, `soundFor(name)`, `soundMs(name)`, `struct Flash`, `constexpr Flash FLASHES[]`, `flashFor(name)`, `flashMs(f)`, `Wrist::sounds() -> std::vector<std::string>`; the note table for `low` is `detail::LOW_TONE`.
  - Host: `logic_test speak` answers `sounds` and `flashes` with the tables as JSON; the `wrist` protocol's answer gains `"sounds":[...]`.

The ESP32 core compiles C++ as `gnu++11` after `Arduino.h` has made `LOW` a macro. That is why the `low` table is `LOW_TONE` and why this task adds the band-compiler check before anything else: when these reactions were first built, a table called `LOW` and a `constexpr` loop passed every test on the laptop and broke only in PlatformIO.

- [ ] **Step 1: Write the failing tests.** The harness learns `sounds` and `downSounds`, the host binary answers with its sounds and prints its tables, and the table gains its cases.

In `tests/wrist-table.js`:

````diff
--- a/tests/wrist-table.js
+++ b/tests/wrist-table.js
@@ -14,9 +14,14 @@
 //   <t> battery <n> | <t> wifi <0|1>
 //
 // Every line after the first lets the time pass to t, does the one thing, and
-// answers one line: {"sent":[...frames, or "DROP"],"face":{...}}. `heard`
-// lines are the keep-alive a case gets unless it says "keepAlive": false; they
-// let no time pass and their answers are not checked.
+// answers one line: {"sent":[...frames, or "DROP"],"sounds":[...names],"face":{...}}.
+// `heard` lines are the keep-alive a case gets unless it says "keepAlive":
+// false; they let no time pass and their answers are not checked.
+//
+// A step's `sent` and `sounds` are exact, and empty unless the step says
+// otherwise, so a stray frame or sound anywhere fails. A `press` is a key down
+// and, PRESS ms later, its key up: the step's `sent`, `sounds` and `face` are
+// the key up's, and `downSounds` (["tick"] unless said) the key down's.
 
 import assert from 'node:assert/strict';
 import { readFileSync } from 'node:fs';
@@ -50,11 +55,11 @@ export function lines(c, consts) {
     const t = at(s.at ?? '0', consts);
     if (t < last) throw new Error(c.name + ': step at ' + s.at + ' goes back in time');
     last = t;
-    const expect = { sent: s.sent ?? [], face: s.face ?? null };
+    const expect = { sent: s.sent ?? [], sounds: s.sounds ?? [], face: s.face ?? null };
     const keep = () => { if (c.keepAlive !== false) out.push({ line: t + ' heard', expect: null }); };
     keep();
     if (s.press) {
-      out.push({ line: t + ' key' + s.press + ' down', expect: { sent: [], face: null } });
+      out.push({ line: t + ' key' + s.press + ' down', expect: { sent: [], sounds: s.downSounds ?? ['tick'], face: null } });
       last = t + PRESS;
       if (c.keepAlive !== false) out.push({ line: last + ' heard', expect: null });
       out.push({ line: last + ' key' + s.press + ' up', expect });
@@ -86,7 +91,7 @@ export function runJs(protocol) {
     else if (verb === 'frame') wrist.frame(rest.join(' '), t);
     else if (verb === 'battery') wrist.setBattery(Number(rest[0]));
     else if (verb === 'wifi') wrist.setWifi(rest[0] === '1');
-    answers.push({ sent: wrist.take().map((o) => (o === 'DROP' ? o : JSON.parse(o))), face: wrist.face(t) });
+    answers.push({ sent: wrist.take().map((o) => (o === 'DROP' ? o : JSON.parse(o))), sounds: wrist.sounds(), face: wrist.face(t) });
   }
   return answers;
 }
@@ -104,6 +109,7 @@ export function check(c, protocol, answers, consts) {
     const got = answers[i];
     const where = c.name + ' / ' + line;
     assert.deepEqual(got.sent.filter((f) => !(f && f.t === 'ping')), deep(expect.sent), where + ': sent');
+    assert.deepEqual(got.sounds, expect.sounds, where + ': sounds');
     if (!expect.face) return;
     for (const [k, v] of Object.entries(expect.face)) {
       const want = typeof v === 'string' && /^LIGHT_/.test(v) ? consts[v] : v;
````

In `firmware/host/logic_test.cpp`:

````diff
--- a/firmware/host/logic_test.cpp
+++ b/firmware/host/logic_test.cpp
@@ -532,6 +532,25 @@ std::string answer(const Command& c) {
            ",\"CARD_WORDS\":{\"hi\":" + quote(cardWords("hi")) + ",\"song\":" + quote(cardWords("song")) +
            ",\"dance\":" + quote(cardWords("dance")) + "}}";
   }
+  if (c.verb == "sounds") {
+    // SOUNDS, as app/lib/wrist.js has it: {"tick":[[1800,25]],...}
+    std::string out = "{";
+    for (const Sound& s : SOUNDS) {
+      out += std::string(out.size() > 1 ? "," : "") + quote(s.name) + ":[";
+      for (size_t i = 0; i < s.count; ++i)
+        out += std::string(i ? "," : "") + "[" + std::to_string(s.notes[i].hz) + "," + std::to_string(s.notes[i].ms) + "]";
+      out += "]";
+    }
+    return out + "}";
+  }
+  if (c.verb == "flashes") {
+    // FLASHES, as app/lib/wrist.js has it: {"set":{"colour":"card","count":2,"on":150,"off":100},...}
+    std::string out = "{";
+    for (const Flash& f : FLASHES)
+      out += std::string(out.size() > 1 ? "," : "") + quote(f.name) + ":{\"colour\":" + quote(f.colour) +
+             ",\"count\":" + std::to_string(f.count) + ",\"on\":" + std::to_string(f.on) + ",\"off\":" + std::to_string(f.off) + "}";
+    return out + "}";
+  }
   if (c.verb == "hues") {
     std::string out = "{";
     for (const Hue& h : HUES)
@@ -602,10 +621,11 @@ int runWrist() {
     else if (verb == "frame") w->frame(arg, t);
     else if (verb == "battery") w->setBattery(std::atoi(arg.c_str()));
     else if (verb == "wifi") w->setWifi(arg == "1");
-    std::string sent;
+    std::string sent, sounds;
     for (const std::string& f : w->take()) sent += (sent.empty() ? "" : ",") + (f == "DROP" ? std::string("\"DROP\"") : f);
+    for (const std::string& n : w->sounds()) sounds += (sounds.empty() ? "" : ",") + quote(n);
     const Screen s = w->face(t);
-    std::cout << "{\"sent\":[" << sent << "],\"face\":{\"big\":" << quote(s.big) << ",\"small\":" << quote(s.small)
+    std::cout << "{\"sent\":[" << sent << "],\"sounds\":[" << sounds << "],\"face\":{\"big\":" << quote(s.big) << ",\"small\":" << quote(s.small)
               << ",\"field\":" << quote(s.field) << ",\"ink\":" << quote(s.ink) << ",\"light\":" << int(s.light)
               << ",\"bar\":" << s.bar << ",\"code\":" << quote(s.code) << "}}\n";
   }
````

In `tests/fixtures/wrist-cases.json`:

````diff
--- a/tests/fixtures/wrist-cases.json
+++ b/tests/fixtures/wrist-cases.json
@@ -38,12 +38,12 @@
         { "at": "0", "battery": 62 },
         { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
         { "at": "0", "show": "OFF", "rev": 1, "face": { "light": "LIGHT_OFF" } },
-        { "at": "1000", "key1": "down" },
+        { "at": "1000", "key1": "down", "sounds": ["tick"] },
         { "at": "1000+HOLD_MS-500", "key1": "up", "face": { "big": "READY", "small": "62%", "light": "LIGHT_AWAKE" } },
-        { "at": "10000", "key1": "down" },
+        { "at": "10000", "key1": "down", "sounds": ["tick"] },
         { "at": "10000+HOLD_MS-100", "key1": "up", "face": { "big": "READY", "light": "LIGHT_AWAKE" } },
-        { "at": "20000", "key1": "down" },
-        { "at": "20000+HOLD_MS", "key1": "up", "sent": [{ "t": "hold" }], "face": { "big": "", "light": "LIGHT_OFF" } }
+        { "at": "20000", "key1": "down", "sounds": ["tick"] },
+        { "at": "20000+HOLD_MS", "key1": "up", "sent": [{ "t": "hold" }], "face": { "big": "", "light": "LIGHT_OFF" }, "sounds": ["down"] }
       ]
     },
     {
@@ -52,13 +52,13 @@
         { "at": "0", "battery": 62 },
         { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
         { "at": "0", "show": "OFF", "rev": 1 },
-        { "at": "1000", "key1": "down", "face": { "small": "", "bar": -1, "light": "LIGHT_OFF" } },
+        { "at": "1000", "key1": "down", "face": { "small": "", "bar": -1, "light": "LIGHT_OFF" }, "sounds": ["tick"] },
         { "at": "1000+BAR_MS-1", "face": { "small": "", "bar": -1, "light": "LIGHT_OFF" } },
         { "at": "1000+BAR_MS", "face": { "big": "", "small": "KEEP HOLDING", "bar": 20, "light": "LIGHT_AWAKE" } },
         { "at": "1000+HOLD_MS-1", "face": { "small": "KEEP HOLDING", "bar": 99 } },
         { "at": "1000+HOLD_MS-1", "key1": "up", "face": { "big": "READY", "small": "62%", "bar": -1, "light": "LIGHT_AWAKE" } },
         { "at": "5000", "show": "HI", "rev": 2 },
-        { "at": "6000", "key1": "down" },
+        { "at": "6000", "key1": "down", "sounds": ["tick"] },
         { "at": "6000+BAR_MS", "face": { "big": "HI :)", "small": "KEEP HOLDING", "field": "hi", "light": "LIGHT_FULL" } },
         { "at": "6000+BAR_MS", "key1": "up", "face": { "small": "BLUE MEANS HELLO", "bar": -1 } }
       ]
@@ -67,12 +67,12 @@
       "name": "NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW",
       "steps": [
         { "at": "0", "battery": 62 },
-        { "at": "0", "key1": "down" },
-        { "at": "HOLD_MS", "face": { "light": "LIGHT_OFF" } },
+        { "at": "0", "key1": "down", "sounds": ["tick"] },
+        { "at": "HOLD_MS", "face": { "light": "LIGHT_OFF" }, "sounds": ["down"] },
         { "at": "HOLD_MS", "key1": "up", "face": { "light": "LIGHT_OFF" } },
         { "at": "5000", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "quiet": true, "battery": 62 }] },
         { "at": "5100", "show": "QUIET", "rev": 2 },
-        { "at": "6000", "press": 1, "face": { "big": "NOT NOW", "small": "62%", "field": "black", "light": "LIGHT_AWAKE" } }
+        { "at": "6000", "press": 1, "face": { "big": "NOT NOW", "small": "62%", "field": "black", "light": "LIGHT_AWAKE" }, "downSounds": [] }
       ]
     },
     {
@@ -107,12 +107,12 @@
       "steps": [
         { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
         { "at": "0", "show": "HI", "rev": 3 },
-        { "at": "1000", "key2": "down" },
+        { "at": "1000", "key2": "down", "sounds": ["tick"] },
         { "at": "1000+HOLD_MS", "face": { "big": "HI :)", "small": "SIDE TO CHANGE" } },
         { "at": "1000+HOLD_MS", "key2": "up" },
         { "at": "3000", "press": 2, "face": { "big": "FIRST SONG?" } },
-        { "at": "4000", "key2": "down" },
-        { "at": "4000+HOLD_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }], "face": { "big": "FIRST SONG?", "small": "SENDING" } },
+        { "at": "4000", "key2": "down", "sounds": ["tick"] },
+        { "at": "4000+HOLD_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }], "face": { "big": "FIRST SONG?", "small": "SENDING" }, "sounds": ["double"] },
         { "at": "4000+HOLD_MS", "key2": "up" },
         { "at": "4000+HOLD_MS+100", "press": 2, "face": { "small": "SENDING" } }
       ]
@@ -136,12 +136,12 @@
       "steps": [
         { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
         { "at": "0", "show": "QUIET", "rev": 6 },
-        { "at": "1000", "press": 2, "face": { "big": "NOT NOW", "small": "SIDE TO CHANGE", "light": "LIGHT_AWAKE" } },
-        { "at": "2000", "press": 2, "face": { "big": "HI :)", "small": "HOLD SIDE TO SHOW", "field": "black", "ink": "hi" } },
+        { "at": "1000", "press": 2, "face": { "big": "NOT NOW", "small": "SIDE TO CHANGE", "light": "LIGHT_AWAKE" }, "downSounds": [] },
+        { "at": "2000", "press": 2, "face": { "big": "HI :)", "small": "HOLD SIDE TO SHOW", "field": "black", "ink": "hi" }, "downSounds": [] },
         { "at": "2100+COMMIT_MS", "face": { "small": "HOLD SIDE TO SHOW" } },
         { "at": "2100+CHOOSE_MS", "face": { "light": "LIGHT_OFF" } },
-        { "at": "10000", "press": 2, "face": { "big": "NOT NOW" } },
-        { "at": "11000", "press": 2, "face": { "big": "HI :)", "small": "HOLD SIDE TO SHOW" } },
+        { "at": "10000", "press": 2, "face": { "big": "NOT NOW" }, "downSounds": [] },
+        { "at": "11000", "press": 2, "face": { "big": "HI :)", "small": "HOLD SIDE TO SHOW" }, "downSounds": [] },
         { "at": "12000", "key2": "down" },
         { "at": "12000+HOLD_MS", "sent": [{ "t": "set", "intent": "hi", "basis": 6 }], "face": { "big": "HI :)", "small": "SENDING" } },
         { "at": "12000+HOLD_MS", "key2": "up" },
@@ -155,9 +155,9 @@
         { "at": "0", "show": "HI", "rev": 3 },
         { "at": "1000", "press": 2 },
         { "at": "2000", "press": 2, "face": { "big": "FIRST SONG?" } },
-        { "at": "4100", "key1": "down" },
+        { "at": "4100", "key1": "down", "sounds": ["tick"] },
         { "at": "2100+COMMIT_MS", "face": { "big": "FIRST SONG?" } },
-        { "at": "4100+HOLD_MS", "sent": [{ "t": "hold" }], "face": { "light": "LIGHT_OFF" } },
+        { "at": "4100+HOLD_MS", "sent": [{ "t": "hold" }], "face": { "light": "LIGHT_OFF" }, "sounds": ["down"] },
         { "at": "4100+HOLD_MS", "key1": "up", "face": { "light": "LIGHT_OFF" } }
       ]
     },
@@ -240,8 +240,8 @@
         { "at": "0", "battery": 62 },
         { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
         { "at": "0", "show": "QUIET", "rev": 6 },
-        { "at": "1000", "press": 2 },
-        { "at": "2000", "press": 2 },
+        { "at": "1000", "press": 2, "downSounds": [] },
+        { "at": "2000", "press": 2, "downSounds": [] },
         { "at": "3000", "key2": "down" },
         { "at": "3000+HOLD_MS", "sent": [{ "t": "set", "intent": "hi", "basis": 6 }] },
         { "at": "3000+HOLD_MS", "key2": "up" },
@@ -257,8 +257,8 @@
         { "at": "1000", "press": 2 },
         { "at": "2000", "press": 2 },
         { "at": "2100+COMMIT_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }] },
-        { "at": "5200", "key1": "down" },
-        { "at": "5200+HOLD_MS", "sent": [{ "t": "hold" }], "face": { "light": "LIGHT_OFF" } },
+        { "at": "5200", "key1": "down", "sounds": ["tick"] },
+        { "at": "5200+HOLD_MS", "sent": [{ "t": "hold" }], "face": { "light": "LIGHT_OFF" }, "sounds": ["down"] },
         { "at": "5200+HOLD_MS", "key1": "up" },
         { "at": "7000", "show": "SONG", "rev": 4, "face": { "small": "", "light": "LIGHT_OFF" } }
       ]
````

In `tests/firmware.test.js`:

````diff
--- a/tests/firmware.test.js
+++ b/tests/firmware.test.js
@@ -20,7 +20,7 @@ import WebSocket from 'ws';
 import { createRelay, WS_PATH } from '../relay/server.js';
 import { HUE } from '../app/copy.js';
 import { codeFrom, pairUrl } from '../app/lib/pairing.js';
-import { CONSTS } from '../app/lib/wrist.js';
+import { CONSTS, FLASHES, SOUNDS } from '../app/lib/wrist.js';
 import { TABLE, lines, check } from './wrist-table.js';
 
 const idOf = (key) => createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex').slice(0, 32);
@@ -29,6 +29,8 @@ const here = fileURLToPath(new URL('..', import.meta.url));
 const dir = mkdtempSync(join(tmpdir(), 'otb-fw-'));
 after(() => rmSync(dir, { recursive: true, force: true }));
 
+let cxxUsed = null;  // the compiler that built it
+
 /** The logic, built by the first compiler this machine has, under the sanitizers where it can be. */
 function build() {
   const out = join(dir, 'logic');
@@ -37,7 +39,10 @@ function build() {
     for (const extra of [['-fsanitize=address,undefined', '-fno-sanitize-recover=all'], []]) {
       const r = spawnSync(cxx, [...extra, ...args], { encoding: 'utf8' });
       if (r.error) break;
-      if (r.status === 0) return out;
+      if (r.status === 0) {
+        cxxUsed = cxx;
+        return out;
+      }
       if (!extra.length) throw new Error(cxx + ' could not build the firmware logic:\n' + r.stderr);
     }
   }
@@ -101,6 +106,13 @@ test('the wristband logic passes its own checks', { skip }, () => {
   assert.match(r.stdout, /^ok: \d+ checks/);
 });
 
+test("the wristband logic compiles as the band's compiler takes it: C++11, after Arduino's macros", { skip }, () => {
+  if (broken) throw broken;
+  const r = spawnSync(cxxUsed, ['-std=gnu++11', '-fsyntax-only', '-Wall', '-Wextra', '-Werror',
+    join(here, 'firmware', 'host', 'as_band.cpp')], { encoding: 'utf8' });
+  assert.equal(r.status, 0, r.stderr);
+});
+
 test('the colours on the wrist are the colours on the phone', { skip }, () => {
   const [hues] = speak(['hues']);
   const phone = Object.fromEntries(Object.entries(HUE).map(([id, h]) => [id, { c: h.c.toUpperCase(), g: h.g.toUpperCase() }]));
@@ -242,6 +254,12 @@ test('the firmware and the stand-in keep the same constants, by name', { skip },
   assert.deepEqual(JSON.parse(consts), CONSTS);
 });
 
+test('the firmware and the stand-in play the same notes and the same flashes', { skip }, () => {
+  const [sounds, flashes] = speak(['sounds', 'flashes']);
+  assert.deepEqual(JSON.parse(sounds), SOUNDS);
+  assert.deepEqual(JSON.parse(flashes), FLASHES);
+});
+
 // The stand-in's table of cases (tests/wrist.test.js), run through band_logic.h's Wrist.
 for (const c of TABLE.cases) {
   test('band_logic.h: ' + c.name, { skip }, () => {
````

Create `firmware/host/arduino_macros.h`:

````cpp
// The names Arduino.h and the ESP32 core's esp32-hal.h and esp32-hal-gpio.h
// make macros before any firmware file is compiled (arduino-esp32 2.x). A name
// here, used in band_logic.h, is replaced before the band's compiler sees it:
// a note table called LOW became `constexpr Note 0x0[]`. Only the names
// matter, so the values are kept plain.

#pragma once

#define ANALOG 0xC0
#define CHANGE 0x03
#define DEFAULT 1
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define DISABLED 0x00
#define DISPLAY 0x1
#define EULER 2.718281828459045235360287471352
#define EXTERNAL 0
#define FALLING 0x02
#define HALF_PI 1.5707963267948966192313216916398
#define HIGH 0x1
#define INPUT 0x01
#define INPUT_PULLDOWN 0x09
#define INPUT_PULLUP 0x05
#define LOW 0x0
#define LSBFIRST 0
#define MSBFIRST 1
#define NOT_AN_INTERRUPT -1
#define NOT_A_PIN -1
#define NOT_A_PORT -1
#define NOT_ON_TIMER 0
#define ONHIGH 0x05
#define ONHIGH_WE 0x0D
#define ONLOW 0x04
#define ONLOW_WE 0x0C
#define OPEN_DRAIN 0x10
#define OUTPUT 0x03
#define OUTPUT_OPEN_DRAIN 0x13
#define PI 3.1415926535897932384626433832795
#define PULLDOWN 0x08
#define PULLUP 0x04
#define RAD_TO_DEG 57.295779513082320876798154814105
#define RISING 0x01
#define SERIAL 0x0
#define TWO_PI 6.283185307179586476925286766559

#define _BV(b) (1UL << (b))
#define _abs(x) ((x) > 0 ? (x) : -(x))
#define _max(a, b) ((a) > (b) ? (a) : (b))
#define _min(a, b) ((a) < (b) ? (a) : (b))
#define _round(x) ((x) >= 0 ? (long)((x) + 0.5) : (long)((x) - 0.5))
#define bit(b) (1UL << (b))
#define bitClear(value, b) ((value) &= ~(1UL << (b)))
#define bitRead(value, b) (((value) >> (b)) & 0x01)
#define bitSet(value, b) ((value) |= (1UL << (b)))
#define bitToggle(value, b) ((value) ^= (1UL << (b)))
#define bitWrite(value, b, v) ((v) ? bitSet(value, b) : bitClear(value, b))
#define cli() 0
#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))
#define degrees(rad) ((rad) * RAD_TO_DEG)
#define highByte(w) ((uint8_t)((w) >> 8))
#define interrupts() sei()
#define lowByte(w) ((uint8_t)((w) & 0xff))
#define noInterrupts() cli()
#define radians(deg) ((deg) * DEG_TO_RAD)
#define sei() 0
#define sq(x) ((x) * (x))
#define word(w) (w)
````

Create `firmware/host/as_band.cpp`:

````cpp
// band_logic.h as the band's own compiler takes it. The ESP32 Arduino core
// compiles C++ as gnu++11, and every firmware file sees Arduino.h's macros
// first; logic_test.cpp is C++17 and has neither. Without this, a constexpr
// loop and a note table named LOW passed npm test and broke only in pio.
// tests/firmware.test.js compiles it, and nothing runs it.

#include "arduino_macros.h"

#include "../src/band_logic.h"
````

Changed cases (8):

  - KEY1 let go at 1.0 s and 1.4 s is a press; at HOLD_MS it is NOT NOW, dark at once
  - held from BAR_MS, KEEP HOLDING and a bar; a dark face lights only to LIGHT_AWAKE, a card keeps its light
  - NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW
  - a KEY2 hold at rest only looks; in a choice it sends at once; presses while sending are ignored
  - from NOT NOW the first step is HI, only a KEY2 hold sends it, and two stray presses send nothing
  - KEY1 down two seconds into a choice freezes it: nothing is sent but the hold
  - NOT SENT leaving NOT NOW holds NOT NOW again, in the next hello
  - a KEY1 hold while sending is NOT NOW and drops the wait: no SET

- [ ] **Step 2: Run the table and watch it fail**

Run: `npm run build >/dev/null && node --test tests/wrist.test.js tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: `ℹ pass 1`, `ℹ fail 22`. The first errors:

```text
SyntaxError: The requested module '../app/lib/wrist.js' does not provide an export named 'FLASHES'
TypeError: wrist.sounds is not a function
```

Red (22):

- tests\firmware.test.js
- wrist.js: the hello says v2 and carries the key, and the id is the key's hash
- wrist.js: a paired wristband says its secret in every hello, and forgets it when it is shown letters
- wrist.js: KEY1 let go at 1.0 s and 1.4 s is a press; at HOLD_MS it is NOT NOW, dark at once
- wrist.js: held from BAR_MS, KEEP HOLDING and a bar; a dark face lights only to LIGHT_AWAKE, a card keeps its light
- wrist.js: NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW
- wrist.js: the first KEY2 press only looks; no second press within CHOOSE_MS and the look is dropped
- wrist.js: each press moves the preview after what is armed; COMMIT_MS later it is sent; a newer show saying so is SET
- wrist.js: a KEY2 hold at rest only looks; in a choice it sends at once; presses while sending are ignored
- wrist.js: a preview equal to what is armed sends nothing
- wrist.js: from NOT NOW the first step is HI, only a KEY2 hold sends it, and two stray presses send nothing
- wrist.js: KEY1 down two seconds into a choice freezes it: nothing is sent but the hold
- wrist.js: a KEY1 press during a choice cancels it
- wrist.js: a show with a new rev, or one not about the person, cancels a choice
- … and 8 more

- [ ] **Step 3: Write the reactions into both twins.**

In `app/lib/wrist.js`:

````diff
--- a/app/lib/wrist.js
+++ b/app/lib/wrist.js
@@ -12,6 +12,11 @@
 // after the last press, or at once on a KEY2 hold. Leaving NOT NOW takes a
 // KEY2 hold. The relay decides; the wrist only says what was chosen, and from
 // which state (`basis`), and shows SET, CHANGED or NOT SENT by what comes back.
+//
+// It also reacts, in sound and light (docs/superpowers/specs/
+// 2026-09-25-wrist-reactions-design.md). Each input is one moment, and its
+// reaction replaces the one playing. sounds() gives the names of the sounds
+// due to start since it was last asked.
 
 import { bandIdOf } from './sha256.js';
 
@@ -44,6 +49,31 @@ export const CONSTS = {
   STALE_MS, QUIET_CONFIRM_MS, LIGHT_FULL, LIGHT_DIM, LIGHT_PAIR, LIGHT_AWAKE, LIGHT_OFF, CARD_WORDS,
 };
 
+/** Every sound the wrist makes, as notes: [Hz, ms], 0 Hz a rest. band_logic.h SOUNDS is the same table. */
+export const SOUNDS = {
+  tick: [[1800, 25]],
+  double: [[1800, 25], [0, 60], [1800, 25]],
+  down: [[1047, 90], [784, 180]],
+  up: [[1047, 70], [1319, 70], [1568, 70], [2093, 140]],
+  fall: [[1568, 100], [1047, 200]],
+  low: [[784, 120], [523, 220]],
+  ask: [[1319, 80], [0, 50], [1760, 160]],
+  jingle: [[1319, 80], [1568, 80], [2637, 80], [2093, 80], [2349, 80], [3136, 200]],
+  warn: [[880, 150], [698, 150], [880, 150], [698, 150]],
+};
+
+/** Every flash: its colour, then count × on / off ms. `card` is the card chosen, white for OFF. band_logic.h FLASHES. */
+export const FLASHES = {
+  set: { colour: 'card', count: 2, on: 150, off: 100 },
+  changed: { colour: 'red', count: 3, on: 120, off: 90 },
+  notsent: { colour: 'orange', count: 2, on: 350, off: 250 },
+  warn: { colour: 'orange', count: 2, on: 350, off: 250 },
+  check: { colour: 'white', count: 2, on: 150, off: 100 },
+};
+
+const soundMs = (name) => (name ? SOUNDS[name].reduce((ms, [, len]) => ms + len, 0) : 0);
+const flashMs = (f) => (f ? f.count * (f.on + f.off) : 0);
+
 /** A relay show, read the way band_logic.h readFrame() reads it: wrong types fall back to defaults. */
 function readShow(s) {
   const str = (v) => (typeof v === 'string' ? v : '');
@@ -78,6 +108,10 @@ export function createWrist({ key }) {
   let choice = '';            // what was sent: a card, or '' for off
   let word = '';
   let out = [];
+  // Reactions (rule 6): this input's, and the one playing.
+  let moment = [];
+  let playing = null;         // { sound, flash, cls, audible, at, until }
+  let due = [];               // sounds started since sounds() was last asked
 
   const send = (m) => out.push(JSON.stringify(m));
   const stale = (now) => !link.up && (!link.ever || now - link.lost >= STALE_MS);
@@ -85,6 +119,29 @@ export function createWrist({ key }) {
   const current = () => (quiet.pending || show?.quiet ? 'notnow' : show?.armed || 'off');
   const pct = () => (battery >= 0 ? battery + '%' : '');
 
+  /** A reaction of this moment. cls: 0 a key or a result, 1 a call, 2 a warning. */
+  function react(sound, flash = null, cls = 0) {
+    moment.push({ sound, flash, cls, audible: true });
+  }
+
+  function start(r, at) {
+    playing = { ...r, at, until: at + Math.max(soundMs(r.sound), flashMs(r.flash)) };
+    if (r.sound && r.audible) due.push(r.sound);
+  }
+
+  /** The end of a moment: its reaction replaces the one playing. */
+  function settle(now) {
+    if (!moment.length) return;
+    const first = moment[0];
+    moment = [];
+    start(first, now);
+  }
+
+  /** A reaction is over once its sound and its flash are. */
+  function advance(now) {
+    if (playing && now >= playing.until) playing = null;
+  }
+
   function noSignal() {
     const why = wifi ? 'NO RELAY' : 'NO WI-FI';
     return words('NO SIGNAL', pct() ? why + ' - ' + pct() : why, 'black', 'text2', LIGHT_AWAKE);
@@ -108,6 +165,7 @@ export function createWrist({ key }) {
     quiet.sent = false;
     rest();
     wakeUntil = now;
+    react('down');
   }
 
   function result(now, w) {
@@ -118,13 +176,16 @@ export function createWrist({ key }) {
     frozen = false;
   }
 
-  function commit(now) {
+  /** `held`: a KEY2 hold sends it at once, and says so with a double tick, except from NOT NOW, which is silent. */
+  function commit(now, held = false) {
     if (frozen) return;
     if (preview === current() || !link.up) { rest(); return; }
+    const silent = current() === 'notnow';
     choice = preview === 'off' ? '' : preview;
     send({ t: 'set', intent: choice || null, basis });
     mode = 'sending';
     sentAt = now;
+    if (held && !silent) react('double');
   }
 
   function step(now) {
@@ -153,12 +214,13 @@ export function createWrist({ key }) {
 
   function sideHeld(now) {
     if (k1.down || frozen) return;
-    if (mode === 'choosing') commit(now);
+    if (mode === 'choosing') commit(now, true);
     else if (mode === 'look') stepAt = now;
     else if (mode === 'rest' || mode === 'result') step(now);
   }
 
   function tick(now) {
+    advance(now);
     if (link.up) {
       if (now - link.heard > DEAF_MS) { out.push('DROP'); closed(now); }
       else if (now - link.asked >= PING_EVERY_MS) { link.asked = now; send({ t: 'ping' }); }
@@ -176,28 +238,39 @@ export function createWrist({ key }) {
       if (link.up) { out.push('DROP'); closed(now); }
       if (fromQuiet) { quiet.pending = true; quiet.sent = false; }
     } else if (mode === 'result' && now >= resultUntil) rest();
+    settle(now);
   }
 
   function keyDown(k, now) {
+    advance(now);
     const s = k === 1 ? k1 : k2;
     if (s.down) return;
     s.down = true;
     s.since = now;
     s.fired = false;
     if (k === 1 && (mode === 'look' || mode === 'choosing')) frozen = true;
+    // Every press is heard as it goes down; NOT NOW is silent.
+    if (current() !== 'notnow') react('tick');
+    settle(now);
   }
 
   function keyUp(k, now) {
+    advance(now);
     const s = k === 1 ? k1 : k2;
     if (!s.down) return;
     s.down = false;
-    if (s.fired) return;
-    if (k === 2) { step(now); return; }
-    if (frozen) rest();
-    wakeUntil = now + WAKE_MS;
+    if (!s.fired) {
+      if (k === 2) step(now);
+      else {
+        if (frozen) rest();
+        wakeUntil = now + WAKE_MS;
+      }
+    }
+    settle(now);
   }
 
   function linkUp(now) {
+    advance(now);
     if (stale(now)) show = null;
     link.up = true;
     link.ever = true;
@@ -208,9 +281,22 @@ export function createWrist({ key }) {
     if (quiet.pending) { hello.quiet = true; quiet.sent = true; quiet.at = now; }
     if (battery >= 0) hello.battery = battery;
     send(hello);
+    settle(now);
+  }
+
+  function linkDown(now) {
+    advance(now);
+    closed(now);
+    settle(now);
   }
 
   function frame(text, now) {
+    advance(now);
+    heardFrame(text, now);
+    settle(now);
+  }
+
+  function heardFrame(text, now) {
     link.heard = now;
     let m;
     try { m = JSON.parse(text); } catch { return; }
@@ -290,7 +376,7 @@ export function createWrist({ key }) {
     keyDown,
     keyUp,
     linkUp,
-    linkDown: (now) => closed(now),
+    linkDown,
     heard: (now) => { link.heard = now; },
     frame,
     tick,
@@ -298,6 +384,8 @@ export function createWrist({ key }) {
     setWifi: (on) => { wifi = !!on; },
     /** Everything to send since the last take: frame text, or 'DROP' to drop the socket. */
     take: () => { const o = out; out = []; return o; },
+    /** The names of the sounds due to start since the last ask: the player plays the newest. */
+    sounds: () => { const d = due; due = []; return d; },
     face,
   };
 }
````

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -51,6 +51,75 @@ constexpr uint8_t LIGHT_PAIR = 160;   // bright enough to scan, not so bright th
 constexpr uint8_t LIGHT_AWAKE = 110;  // a woken face, and every face read up close
 constexpr uint8_t LIGHT_OFF = 0;
 
+// ---------- what the wrist plays ----------
+//
+// The same tables as app/lib/wrist.js SOUNDS and FLASHES; tests/firmware.test.js
+// holds them equal. A note is Hz and ms, 0 Hz a rest.
+
+struct Note {
+  uint16_t hz, ms;
+};
+struct Sound {
+  const char* name;
+  const Note* notes;
+  size_t count;
+};
+
+namespace detail {
+constexpr Note TICK[] = {{1800, 25}};
+constexpr Note DOUBLE[] = {{1800, 25}, {0, 60}, {1800, 25}};
+constexpr Note DOWN[] = {{1047, 90}, {784, 180}};
+constexpr Note UP[] = {{1047, 70}, {1319, 70}, {1568, 70}, {2093, 140}};
+constexpr Note FALL[] = {{1568, 100}, {1047, 200}};
+constexpr Note LOW_TONE[] = {{784, 120}, {523, 220}};  // not LOW: Arduino.h makes LOW a macro
+constexpr Note ASK[] = {{1319, 80}, {0, 50}, {1760, 160}};
+constexpr Note JINGLE[] = {{1319, 80}, {1568, 80}, {2637, 80}, {2093, 80}, {2349, 80}, {3136, 200}};
+constexpr Note WARN[] = {{880, 150}, {698, 150}, {880, 150}, {698, 150}};
+template <size_t N>
+constexpr Sound sound(const char* name, const Note (&notes)[N]) { return {name, notes, N}; }
+}  // namespace detail
+
+constexpr Sound SOUNDS[] = {
+    detail::sound("tick", detail::TICK),     detail::sound("double", detail::DOUBLE), detail::sound("down", detail::DOWN),
+    detail::sound("up", detail::UP),         detail::sound("fall", detail::FALL),     detail::sound("low", detail::LOW_TONE),
+    detail::sound("ask", detail::ASK),       detail::sound("jingle", detail::JINGLE), detail::sound("warn", detail::WARN),
+};
+
+inline const Sound* soundFor(const std::string& name) {
+  for (const Sound& s : SOUNDS)
+    if (name == s.name) return &s;
+  return nullptr;
+}
+
+inline uint32_t soundMs(const char* name) {
+  const Sound* s = name ? soundFor(name) : nullptr;
+  uint32_t ms = 0;
+  if (s)
+    for (size_t i = 0; i < s->count; ++i) ms += s->notes[i].ms;
+  return ms;
+}
+
+/** A flash: its colour, then count × on / off ms. "card" is the card chosen, white for OFF. */
+struct Flash {
+  const char* name;
+  const char* colour;
+  uint8_t count;
+  uint16_t on, off;
+};
+
+constexpr Flash FLASHES[] = {
+    {"set", "card", 2, 150, 100},       {"changed", "red", 3, 120, 90}, {"notsent", "orange", 2, 350, 250},
+    {"warn", "orange", 2, 350, 250},    {"check", "white", 2, 150, 100},
+};
+
+inline const Flash* flashFor(const std::string& name) {
+  for (const Flash& f : FLASHES)
+    if (name == f.name) return &f;
+  return nullptr;
+}
+
+inline uint32_t flashMs(const Flash* f) { return f ? uint32_t(f->count) * (f->on + f->off) : 0; }
+
 // ---------- colour ----------
 
 struct Rgb {
@@ -977,7 +1046,15 @@ class Wrist {
     return o;
   }
 
+  /** The names of the sounds due to start since the last ask: the player plays the newest. */
+  std::vector<std::string> sounds() {
+    std::vector<std::string> d;
+    d.swap(due_);
+    return d;
+  }
+
   void keyDown(int k, uint32_t now) {
+    advance(now);
     Key& s = k == 1 ? k1_ : k2_;
     if (s.down) return;
     s.down = true;
@@ -985,33 +1062,58 @@ class Wrist {
     s.fired = false;
     // Any KEY1 press-down freezes a choice at once: no commit can fire.
     if (k == 1 && (mode_ == LOOK || mode_ == CHOOSING)) frozen_ = true;
+    // Every press is heard as it goes down; NOT NOW is silent.
+    if (current() != "notnow") react("tick");
+    settle(now);
   }
 
   void keyUp(int k, uint32_t now) {
+    advance(now);
     Key& s = k == 1 ? k1_ : k2_;
     if (!s.down) return;
     s.down = false;
-    if (s.fired) return;
-    if (k == 2) {
-      step(now);
-      return;
+    if (!s.fired) {
+      if (k == 2) {
+        step(now);
+      } else {
+        if (frozen_) rest();
+        wakeUntil_ = now + WAKE_MS;
+      }
     }
-    if (frozen_) rest();
-    wakeUntil_ = now + WAKE_MS;
+    settle(now);
   }
 
   void linkUp(uint32_t now) {
+    advance(now);
     if (link_.stale(now)) haveShow_ = false;
     link_.opened(now);
     // A hold not yet heard rides on the hello: the relay applies it before anything else.
     const bool quiet = quiet_.dark();
     if (quiet) quiet_.sent(now);
     out_.push_back(helloFrame(id_, key_, battery_, secret_, quiet));
+    settle(now);
   }
 
-  void linkDown(uint32_t now) { closed(now); }
+  void linkDown(uint32_t now) {
+    advance(now);
+    closed(now);
+    settle(now);
+  }
 
   void frame(const std::string& text, uint32_t now) {
+    advance(now);
+    heardFrame(text, now);
+    settle(now);
+  }
+
+  void tick(uint32_t now) {
+    advance(now);
+    ticked(now);
+    settle(now);
+  }
+
+ private:
+  void heardFrame(const std::string& text, uint32_t now) {
     link_.heard(now);
     Frame f;
     if (!readFrame(text, f)) return;
@@ -1036,7 +1138,7 @@ class Wrist {
     }
   }
 
-  void tick(uint32_t now) {
+  void ticked(uint32_t now) {
     switch (link_.tick(now)) {
       case Link::DROP:
         out_.push_back("DROP");
@@ -1080,6 +1182,7 @@ class Wrist {
     }
   }
 
+ public:
   Screen face(uint32_t now) const {
     Screen f;
     if (mode_ == LOOK) {
@@ -1111,6 +1214,43 @@ class Wrist {
     bool fired = false;
     uint32_t since = 0;
   };
+  /** One reaction. cls: 0 a key or a result, 1 a call, 2 a warning. */
+  struct Reaction {
+    const char* sound = nullptr;
+    const Flash* flash = nullptr;
+    int cls = 0;
+    bool audible = true;
+    uint32_t at = 0, until = 0;
+  };
+
+  void react(const char* sound, const Flash* flash = nullptr, int cls = 0) {
+    Reaction r;
+    r.sound = sound;
+    r.flash = flash;
+    r.cls = cls;
+    moment_.push_back(r);
+  }
+
+  void start(Reaction r, uint32_t at) {
+    r.at = at;
+    r.until = at + std::max(soundMs(r.sound), flashMs(r.flash));
+    playing_ = r;
+    playingOn_ = true;
+    if (r.sound && r.audible) due_.push_back(r.sound);
+  }
+
+  /** The end of a moment: its reaction replaces the one playing. */
+  void settle(uint32_t now) {
+    if (moment_.empty()) return;
+    const Reaction first = moment_.front();
+    moment_.clear();
+    start(first, now);
+  }
+
+  /** A reaction is over once its sound and its flash are. */
+  void advance(uint32_t now) {
+    if (playingOn_ && static_cast<int32_t>(now - playing_.until) >= 0) playingOn_ = false;
+  }
 
   static Screen words(const std::string& big, const std::string& small, const std::string& field, const std::string& ink,
                       uint8_t light) {
@@ -1170,6 +1310,7 @@ class Wrist {
     quiet_.held();
     rest();
     wakeUntil_ = now;
+    react("down");
   }
 
   void result(uint32_t now, const char* w) {
@@ -1180,18 +1321,21 @@ class Wrist {
     frozen_ = false;
   }
 
-  void commit(uint32_t now) {
+  /** `held`: a KEY2 hold sends it at once, and says so with a double tick, except from NOT NOW, which is silent. */
+  void commit(uint32_t now, bool held = false) {
     if (frozen_) return;
     // "In force" is checked again: a preview equal to what is armed sends nothing.
     if (preview_ == current() || !link_.up()) {
       rest();
       return;
     }
+    const bool silent = current() == "notnow";
     choice_ = preview_ == "off" ? "" : preview_;
     out_.push_back("{\"t\":\"set\",\"intent\":" + (choice_.empty() ? std::string("null") : "\"" + choice_ + "\"") +
                    ",\"basis\":" + std::to_string(basis_) + "}");
     mode_ = SENDING;
     sentAt_ = now;
+    if (held && !silent) react("double");
   }
 
   static std::string after(const std::string& card) {
@@ -1229,7 +1373,7 @@ class Wrist {
   /** KEY2 held for HOLD_MS: send now in a choice; with no preview yet, only wake. */
   void sideHeld(uint32_t now) {
     if (k1_.down || frozen_) return;
-    if (mode_ == CHOOSING) commit(now);
+    if (mode_ == CHOOSING) commit(now, true);
     else if (mode_ == LOOK) stepAt_ = now;
     else if (mode_ == REST || mode_ == RESULT) step(now);
   }
@@ -1248,6 +1392,11 @@ class Wrist {
   uint32_t wakeUntil_ = 0, stepAt_ = 0, sentAt_ = 0, resultUntil_ = 0;
   int64_t basis_ = 0;
   std::vector<std::string> out_;
+  // Reactions (rule 6): this input's, and the one playing.
+  std::vector<Reaction> moment_;
+  Reaction playing_;
+  bool playingOn_ = false;
+  std::vector<std::string> due_;
 };
 
 // ---------- the serial console ----------
````

- [ ] **Step 4: Run the table and the suite**

Run: `node --test tests/wrist.test.js tests/firmware.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`, then `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail|skipped)"`.
Expected: `ℹ fail 0`; the suite is `ℹ tests 189`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "a key goes down silently",
  "file": "app/lib/wrist.js",
  "from": "    if (current() !== 'notnow') react('tick');\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: KEY1 let go at 1.0 s and 1.4 s is a press; at HOLD_MS it is NOT NOW, dark at once",
   "wrist.js: held from BAR_MS, KEEP HOLDING and a bar; a dark face lights only to LIGHT_AWAKE, a card keeps its light",
   "wrist.js: NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW",
   "wrist.js: the first KEY2 press only looks; no second press within CHOOSE_MS and the look is dropped",
   "wrist.js: each press moves the preview after what is armed; COMMIT_MS later it is sent; a newer show saying so is SET",
   "wrist.js: a KEY2 hold at rest only looks; in a choice it sends at once; presses while sending are ignored",
   "wrist.js: a preview equal to what is armed sends nothing",
   "wrist.js: KEY1 down two seconds into a choice freezes it: nothing is sent but the hold",
   "wrist.js: a KEY1 press during a choice cancels it",
   "wrist.js: a show with a new rev, or one not about the person, cancels a choice",
   "wrist.js: offline, LOOK says NO SIGNAL and presses change nothing",
   "wrist.js: the relay refusing a stale basis is CHANGED; any other refusal is NOT SENT at once",
   "wrist.js: nothing back in CONFIRM_MS is NOT SENT: the socket is dropped, and the next connection's show is the truth",
   "wrist.js: a KEY1 hold while sending is NOT NOW and drops the wait: no SET",
   "wrist.js: the check, waiting for its owner, and not in a room; KEY2 on them only wakes",
   "wrist.js: six seconds unheard drops the socket; ten more and the last show is not believed",
   "wrist.js: LOOK replaces the meeting number while it lasts"
  ]
 },
 {
  "label": "a FACE hold into NOT NOW is silent",
  "file": "app/lib/wrist.js",
  "from": "    react('down');\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: KEY1 let go at 1.0 s and 1.4 s is a press; at HOLD_MS it is NOT NOW, dark at once",
   "wrist.js: NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW",
   "wrist.js: KEY1 down two seconds into a choice freezes it: nothing is sent but the hold",
   "wrist.js: a KEY1 hold while sending is NOT NOW and drops the wait: no SET"
  ]
 },
 {
  "label": "a SIDE hold that sends plays no double",
  "file": "app/lib/wrist.js",
  "from": "    if (held && !silent) react('double');\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a KEY2 hold at rest only looks; in a choice it sends at once; presses while sending are ignored"
  ]
 },
 {
  "label": "sounds() gives the same sounds again",
  "file": "app/lib/wrist.js",
  "from": "    sounds: () => { const d = due; due = []; return d; },\n",
  "to": "    sounds: () => due.slice(),\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: KEY1 let go at 1.0 s and 1.4 s is a press; at HOLD_MS it is NOT NOW, dark at once",
   "wrist.js: held from BAR_MS, KEEP HOLDING and a bar; a dark face lights only to LIGHT_AWAKE, a card keeps its light",
   "wrist.js: NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW",
   "wrist.js: the first KEY2 press only looks; no second press within CHOOSE_MS and the look is dropped",
   "wrist.js: each press moves the preview after what is armed; COMMIT_MS later it is sent; a newer show saying so is SET",
   "wrist.js: a KEY2 hold at rest only looks; in a choice it sends at once; presses while sending are ignored",
   "wrist.js: a preview equal to what is armed sends nothing",
   "wrist.js: KEY1 down two seconds into a choice freezes it: nothing is sent but the hold",
   "wrist.js: a KEY1 press during a choice cancels it",
   "wrist.js: a show with a new rev, or one not about the person, cancels a choice",
   "wrist.js: offline, LOOK says NO SIGNAL and presses change nothing",
   "wrist.js: the relay refusing a stale basis is CHANGED; any other refusal is NOT SENT at once",
   "wrist.js: nothing back in CONFIRM_MS is NOT SENT: the socket is dropped, and the next connection's show is the truth",
   "wrist.js: a KEY1 hold while sending is NOT NOW and drops the wait: no SET",
   "wrist.js: the check, waiting for its owner, and not in a room; KEY2 on them only wakes",
   "wrist.js: six seconds unheard drops the socket; ten more and the last show is not believed",
   "wrist.js: LOOK replaces the meeting number while it lasts"
  ]
 },
 {
  "label": "a later moment waits behind the one playing",
  "file": "app/lib/wrist.js",
  "from": "    const first = moment[0];\n    moment = [];\n    start(first, now);\n",
  "to": "    const first = moment[0];\n    moment = [];\n    if (!playing) start(first, now);\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a KEY2 hold at rest only looks; in a choice it sends at once; presses while sending are ignored"
  ]
 },
 {
  "label": "C++: a key goes down silently",
  "file": "firmware/src/band_logic.h",
  "from": "    if (current() != \"notnow\") react(\"tick\");\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: KEY1 let go at 1.0 s and 1.4 s is a press; at HOLD_MS it is NOT NOW, dark at once",
   "band_logic.h: held from BAR_MS, KEEP HOLDING and a bar; a dark face lights only to LIGHT_AWAKE, a card keeps its light",
   "band_logic.h: NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW",
   "band_logic.h: the first KEY2 press only looks; no second press within CHOOSE_MS and the look is dropped",
   "band_logic.h: each press moves the preview after what is armed; COMMIT_MS later it is sent; a newer show saying so is SET",
   "band_logic.h: a KEY2 hold at rest only looks; in a choice it sends at once; presses while sending are ignored",
   "band_logic.h: a preview equal to what is armed sends nothing",
   "band_logic.h: KEY1 down two seconds into a choice freezes it: nothing is sent but the hold",
   "band_logic.h: a KEY1 press during a choice cancels it",
   "band_logic.h: a show with a new rev, or one not about the person, cancels a choice",
   "band_logic.h: offline, LOOK says NO SIGNAL and presses change nothing",
   "band_logic.h: the relay refusing a stale basis is CHANGED; any other refusal is NOT SENT at once",
   "band_logic.h: nothing back in CONFIRM_MS is NOT SENT: the socket is dropped, and the next connection's show is the truth",
   "band_logic.h: a KEY1 hold while sending is NOT NOW and drops the wait: no SET",
   "band_logic.h: the check, waiting for its owner, and not in a room; KEY2 on them only wakes",
   "band_logic.h: six seconds unheard drops the socket; ten more and the last show is not believed",
   "band_logic.h: LOOK replaces the meeting number while it lasts"
  ]
 },
 {
  "label": "C++: a FACE hold into NOT NOW is silent",
  "file": "firmware/src/band_logic.h",
  "from": "    react(\"down\");\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: KEY1 let go at 1.0 s and 1.4 s is a press; at HOLD_MS it is NOT NOW, dark at once",
   "band_logic.h: NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW",
   "band_logic.h: KEY1 down two seconds into a choice freezes it: nothing is sent but the hold",
   "band_logic.h: a KEY1 hold while sending is NOT NOW and drops the wait: no SET"
  ]
 },
 {
  "label": "C++: a SIDE hold that sends plays no double (compiling form)",
  "file": "firmware/src/band_logic.h",
  "from": "    if (held && !silent) react(\"double\");\n",
  "to": "    (void)held;\n    (void)silent;\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a KEY2 hold at rest only looks; in a choice it sends at once; presses while sending are ignored"
  ]
 },
 {
  "label": "C++: a later moment waits behind the one playing",
  "file": "firmware/src/band_logic.h",
  "from": "    const Reaction first = moment_.front();\n    moment_.clear();\n    start(first, now);\n",
  "to": "    const Reaction first = moment_.front();\n    moment_.clear();\n    if (!playingOn_) start(first, now);\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a KEY2 hold at rest only looks; in a choice it sends at once; presses while sending are ignored"
  ]
 },
 {
  "label": "C++: sounds() gives the same sounds again",
  "file": "firmware/src/band_logic.h",
  "from": "    d.swap(due_);\n",
  "to": "    d = due_;\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: KEY1 let go at 1.0 s and 1.4 s is a press; at HOLD_MS it is NOT NOW, dark at once",
   "band_logic.h: held from BAR_MS, KEEP HOLDING and a bar; a dark face lights only to LIGHT_AWAKE, a card keeps its light",
   "band_logic.h: NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW",
   "band_logic.h: the first KEY2 press only looks; no second press within CHOOSE_MS and the look is dropped",
   "band_logic.h: each press moves the preview after what is armed; COMMIT_MS later it is sent; a newer show saying so is SET",
   "band_logic.h: a KEY2 hold at rest only looks; in a choice it sends at once; presses while sending are ignored",
   "band_logic.h: a preview equal to what is armed sends nothing",
   "band_logic.h: KEY1 down two seconds into a choice freezes it: nothing is sent but the hold",
   "band_logic.h: a KEY1 press during a choice cancels it",
   "band_logic.h: a show with a new rev, or one not about the person, cancels a choice",
   "band_logic.h: offline, LOOK says NO SIGNAL and presses change nothing",
   "band_logic.h: the relay refusing a stale basis is CHANGED; any other refusal is NOT SENT at once",
   "band_logic.h: nothing back in CONFIRM_MS is NOT SENT: the socket is dropped, and the next connection's show is the truth",
   "band_logic.h: a KEY1 hold while sending is NOT NOW and drops the wait: no SET",
   "band_logic.h: the check, waiting for its owner, and not in a room; KEY2 on them only wakes",
   "band_logic.h: six seconds unheard drops the socket; ten more and the last show is not believed",
   "band_logic.h: LOOK replaces the meeting number while it lasts"
  ]
 },
 {
  "label": "a note table is named LOW again",
  "file": "firmware/src/band_logic.h",
  "from": "constexpr Note LOW_TONE[] = {{784, 120}, {523, 220}};",
  "to": "constexpr Note LOW[] = {{784, 120}, {523, 220}};\nconstexpr const Note (&LOW_TONE)[2] = LOW;",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic compiles as the band's compiler takes it: C++11, after Arduino's macros"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add app/lib/wrist.js firmware/src/band_logic.h firmware/host tests
```

````bash
git commit -F - <<'EOF'
Tick every press on the wrist, and give each hold its sound

Each input to the wrist is one moment, and its reaction replaces the one
playing. sounds() gives the names of the sounds due since it was last
asked, as take() gives frames. A key going down ticks, a FACE hold into NOT
NOW plays down, and a SIDE hold that sends plays double. SOUNDS and FLASHES
are one table in each twin, held equal.

The ESP32 core compiles C++ as gnu++11, after Arduino.h has made names like
LOW into macros; the laptop builds C++17 with neither. So the note table is
LOW_TONE, and a host test compiles band_logic.h as the band's compiler does.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 2: SET, CHANGED and NOT SENT, in sound and light

**Files:**
- Modify: `app/lib/wrist.js`, `firmware/src/band_logic.h`
- Test: `tests/fixtures/wrist-cases.json`

**Interfaces:**
- Consumes: Task 1's `react`, `settle`, `advance`, `FLASHES`.
- Produces: `react(sound, flash, cls, card)` records the flash's colour (`card || 'white'` for a `set` flash); `result(now, w)` reacts `up`/`set` with the choice's card, `fall`/`changed` or `low`/`notsent`; `face(now)` ends in `flashOver(f, now)`, which returns the colour at `LIGHT_FULL` on an on step and the face with `LIGHT_OFF` on an off step. A key going down ends a flash, because its tick replaces the reaction playing. Face fields gain the card's own colour, `red` and `orange`.

- [ ] **Step 1: Write the failing cases.**

In `tests/fixtures/wrist-cases.json`:

````diff
--- a/tests/fixtures/wrist-cases.json
+++ b/tests/fixtures/wrist-cases.json
@@ -98,7 +98,8 @@
         { "at": "4000", "press": 2, "face": { "big": "OFF", "small": "SIDE: NEXT", "ink": "text2" } },
         { "at": "4100+COMMIT_MS-1", "face": { "big": "OFF", "small": "SIDE: NEXT" } },
         { "at": "4100+COMMIT_MS", "sent": [{ "t": "set", "intent": null, "basis": 3 }], "face": { "big": "OFF", "small": "SENDING" } },
-        { "at": "7500", "show": "OFF", "rev": 4, "face": { "big": "READY", "small": "SET", "light": "LIGHT_AWAKE" } },
+        { "at": "7500", "show": "OFF", "rev": 4, "sounds": ["up"], "face": { "big": "", "field": "white", "light": "LIGHT_FULL" } },
+        { "at": "7500+500", "face": { "big": "READY", "small": "SET", "light": "LIGHT_AWAKE" } },
         { "at": "7500+RESULT_MS", "face": { "big": "", "light": "LIGHT_OFF" } }
       ]
     },
@@ -145,7 +146,8 @@
         { "at": "12000", "key2": "down" },
         { "at": "12000+HOLD_MS", "sent": [{ "t": "set", "intent": "hi", "basis": 6 }], "face": { "big": "HI :)", "small": "SENDING" } },
         { "at": "12000+HOLD_MS", "key2": "up" },
-        { "at": "14000", "show": "HI", "rev": 7, "face": { "big": "HI :)", "small": "SET", "field": "hi" } }
+        { "at": "14000", "show": "HI", "rev": 7, "sounds": ["up"], "face": { "big": "", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "14000+500", "face": { "big": "HI :)", "small": "SET", "field": "hi" } }
       ]
     },
     {
@@ -210,12 +212,14 @@
         { "at": "1000", "press": 2 },
         { "at": "2000", "press": 2 },
         { "at": "2100+COMMIT_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }] },
-        { "at": "5500", "frame": { "t": "set", "ok": false, "why": "changed" }, "face": { "big": "HI :)", "small": "CHANGED", "field": "hi" } },
+        { "at": "5500", "frame": { "t": "set", "ok": false, "why": "changed" }, "sounds": ["fall"], "face": { "big": "", "field": "red", "light": "LIGHT_FULL" } },
+        { "at": "5500+630", "face": { "big": "HI :)", "small": "CHANGED", "field": "hi" } },
         { "at": "5500+RESULT_MS", "face": { "small": "BLUE MEANS HELLO" } },
         { "at": "10000", "press": 2 },
         { "at": "11000", "press": 2 },
         { "at": "11100+COMMIT_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }] },
-        { "at": "14500", "frame": { "t": "set", "ok": false, "why": "too fast" }, "face": { "small": "NOT SENT" } }
+        { "at": "14500", "frame": { "t": "set", "ok": false, "why": "too fast" }, "sounds": ["low"], "face": { "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "14500+1200", "face": { "small": "NOT SENT" } }
       ]
     },
     {
@@ -228,9 +232,10 @@
         { "at": "2000", "press": 2 },
         { "at": "2100+COMMIT_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }] },
         { "at": "2100+COMMIT_MS+CONFIRM_MS-1", "face": { "small": "SENDING" } },
-        { "at": "2100+COMMIT_MS+CONFIRM_MS", "sent": ["DROP"], "face": { "big": "HI :)", "small": "NOT SENT" } },
+        { "at": "2100+COMMIT_MS+CONFIRM_MS", "sent": ["DROP"], "sounds": ["low"], "face": { "field": "orange", "light": "LIGHT_FULL" } },
         { "at": "16000", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
-        { "at": "16100", "show": "SONG", "rev": 4, "face": { "big": "FIRST SONG?", "small": "NOT SENT", "field": "song" } },
+        { "at": "16100", "show": "SONG", "rev": 4, "face": { "big": "FIRST SONG?", "small": "NOT SENT", "field": "song", "light": "LIGHT_OFF" } },
+        { "at": "16300", "face": { "big": "FIRST SONG?", "small": "NOT SENT", "field": "song", "light": "LIGHT_FULL" } },
         { "at": "15100+RESULT_MS", "face": { "small": "TREASURE" } }
       ]
     },
@@ -302,6 +307,74 @@
         { "at": "1000", "press": 2, "face": { "big": "HI :)", "small": "SIDE TO CHANGE", "field": "hi" } },
         { "at": "1100+CHOOSE_MS", "face": { "big": "27", "small": "MEET" } }
       ]
+    },
+    {
+      "name": "SET plays up and flashes the card's colour twice, 150 on and 100 off; then SET shows",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "press": 2 },
+        { "at": "2000", "press": 2, "face": { "big": "FIRST SONG?", "small": "SIDE: NEXT" } },
+        { "at": "2100+COMMIT_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }] },
+        { "at": "6000", "show": "SONG", "rev": 4, "sounds": ["up"], "face": { "big": "", "small": "", "field": "song", "light": "LIGHT_FULL", "code": "" } },
+        { "at": "6000+149", "face": { "field": "song", "light": "LIGHT_FULL" } },
+        { "at": "6000+150", "face": { "big": "FIRST SONG?", "small": "SET", "light": "LIGHT_OFF" } },
+        { "at": "6000+250", "face": { "big": "", "field": "song", "light": "LIGHT_FULL" } },
+        { "at": "6000+400", "face": { "light": "LIGHT_OFF" } },
+        { "at": "6000+500", "face": { "big": "FIRST SONG?", "small": "SET", "field": "song", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "CHANGED plays fall and flashes red three times, 120 on and 90 off; NOT SENT plays low and flashes orange twice, 350 on and 250 off",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "press": 2 },
+        { "at": "2000", "press": 2 },
+        { "at": "2100+COMMIT_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }] },
+        { "at": "6000", "frame": { "t": "set", "ok": false, "why": "changed" }, "sounds": ["fall"], "face": { "big": "", "field": "red", "light": "LIGHT_FULL" } },
+        { "at": "6000+120", "face": { "light": "LIGHT_OFF" } },
+        { "at": "6000+210", "face": { "field": "red", "light": "LIGHT_FULL" } },
+        { "at": "6000+420", "face": { "field": "red", "light": "LIGHT_FULL" } },
+        { "at": "6000+540", "face": { "light": "LIGHT_OFF" } },
+        { "at": "6000+630", "face": { "big": "HI :)", "small": "CHANGED", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "10000", "press": 2 },
+        { "at": "11000", "press": 2 },
+        { "at": "11100+COMMIT_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }] },
+        { "at": "15000", "frame": { "t": "set", "ok": false, "why": "no room" }, "sounds": ["low"], "face": { "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "15000+350", "face": { "light": "LIGHT_OFF" } },
+        { "at": "15000+600", "face": { "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "15000+950", "face": { "light": "LIGHT_OFF" } },
+        { "at": "15000+1200", "face": { "big": "HI :)", "small": "NOT SENT", "field": "hi" } }
+      ]
+    },
+    {
+      "name": "a key going down ends a flash: only its tick plays, and the face under the flash shows at once",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "press": 2 },
+        { "at": "2000", "press": 2 },
+        { "at": "2100+COMMIT_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }] },
+        { "at": "6000", "show": "SONG", "rev": 4, "sounds": ["up"], "face": { "big": "", "field": "song" } },
+        { "at": "6000+50", "key1": "down", "sounds": ["tick"], "face": { "big": "FIRST SONG?", "small": "SET", "light": "LIGHT_FULL" } },
+        { "at": "6000+150", "key1": "up", "face": { "big": "FIRST SONG?", "small": "SET", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "a SIDE hold on a preview of what is already armed sends nothing and plays no double",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "press": 2, "face": { "big": "HI :)", "small": "SIDE TO CHANGE" } },
+        { "at": "2000", "press": 2 },
+        { "at": "3000", "press": 2 },
+        { "at": "4000", "press": 2, "face": { "big": "OFF" } },
+        { "at": "5000", "press": 2, "face": { "big": "HI :)", "small": "SIDE: NEXT" } },
+        { "at": "6000", "key2": "down", "sounds": ["tick"] },
+        { "at": "6000+HOLD_MS", "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "light": "LIGHT_FULL" } },
+        { "at": "6000+HOLD_MS", "key2": "up" }
+      ]
     }
   ]
 }
````

New cases (4):

  - SET plays up and flashes the card's colour twice, 150 on and 100 off; then SET shows
  - CHANGED plays fall and flashes red three times, 120 on and 90 off; NOT SENT plays low and flashes orange twice, 350 on and 250 off
  - a key going down ends a flash: only its tick plays, and the face under the flash shows at once
  - a SIDE hold on a preview of what is already armed sends nothing and plays no double

Changed cases (4):

  - each press moves the preview after what is armed; COMMIT_MS later it is sent; a newer show saying so is SET
  - from NOT NOW the first step is HI, only a KEY2 hold sends it, and two stray presses send nothing
  - the relay refusing a stale basis is CHANGED; any other refusal is NOT SENT at once
  - nothing back in CONFIRM_MS is NOT SENT: the socket is dropped, and the next connection's show is the truth

- [ ] **Step 2: Run the table and watch it fail**

Run: `npm run build >/dev/null && node --test tests/wrist.test.js tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: `ℹ pass 45`, `ℹ fail 14`. The first errors:

```text
AssertionError [ERR_ASSERTION]: each press moves the preview after what is armed; COMMIT_MS later it is sent; a newer show saying so is SET / 8500 frame {"t":"show","show":{"kind":"off","battery":62,"armed":null,"rev":4}
AssertionError [ERR_ASSERTION]: from NOT NOW the first step is HI, only a KEY2 hold sends it, and two stray presses send nothing / 15000 frame {"t":"show","show":{"kind":"hi","intent":"hi","big":"HI :)","small":"blue mea
AssertionError [ERR_ASSERTION]: the relay refusing a stale basis is CHANGED; any other refusal is NOT SENT at once / 6500 frame {"t":"set","ok":false,"why":"changed"}: sounds
AssertionError [ERR_ASSERTION]: nothing back in CONFIRM_MS is NOT SENT: the socket is dropped, and the next connection's show is the truth / 16100 tick: sounds
AssertionError [ERR_ASSERTION]: SET plays up and flashes the card's colour twice, 150 on and 100 off; then SET shows / 7000 frame {"t":"show","show":{"kind":"song","intent":"song","big":"FIRST SONG?","small":"Treasure","
AssertionError [ERR_ASSERTION]: CHANGED plays fall and flashes red three times, 120 on and 90 off; NOT SENT plays low and flashes orange twice, 350 on and 250 off / 7000 frame {"t":"set","ok":false,"why":"changed"}: soun
```

Red (14):

- band_logic.h: each press moves the preview after what is armed; COMMIT_MS later it is sent; a newer show saying so is SET
- band_logic.h: from NOT NOW the first step is HI, only a KEY2 hold sends it, and two stray presses send nothing
- band_logic.h: the relay refusing a stale basis is CHANGED; any other refusal is NOT SENT at once
- band_logic.h: nothing back in CONFIRM_MS is NOT SENT: the socket is dropped, and the next connection's show is the truth
- band_logic.h: SET plays up and flashes the card's colour twice, 150 on and 100 off; then SET shows
- band_logic.h: CHANGED plays fall and flashes red three times, 120 on and 90 off; NOT SENT plays low and flashes orange twice, 350 on and 250 off
- band_logic.h: a key going down ends a flash: only its tick plays, and the face under the flash shows at once
- wrist.js: each press moves the preview after what is armed; COMMIT_MS later it is sent; a newer show saying so is SET
- wrist.js: from NOT NOW the first step is HI, only a KEY2 hold sends it, and two stray presses send nothing
- wrist.js: the relay refusing a stale basis is CHANGED; any other refusal is NOT SENT at once
- wrist.js: nothing back in CONFIRM_MS is NOT SENT: the socket is dropped, and the next connection's show is the truth
- wrist.js: SET plays up and flashes the card's colour twice, 150 on and 100 off; then SET shows
- wrist.js: CHANGED plays fall and flashes red three times, 120 on and 90 off; NOT SENT plays low and flashes orange twice, 350 on and 250 off
- wrist.js: a key going down ends a flash: only its tick plays, and the face under the flash shows at once

- [ ] **Step 3: Implement in both twins.**

In `app/lib/wrist.js`:

````diff
--- a/app/lib/wrist.js
+++ b/app/lib/wrist.js
@@ -119,9 +119,11 @@ export function createWrist({ key }) {
   const current = () => (quiet.pending || show?.quiet ? 'notnow' : show?.armed || 'off');
   const pct = () => (battery >= 0 ? battery + '%' : '');
 
-  /** A reaction of this moment. cls: 0 a key or a result, 1 a call, 2 a warning. */
-  function react(sound, flash = null, cls = 0) {
-    moment.push({ sound, flash, cls, audible: true });
+  /** A reaction of this moment. cls: 0 a key or a result, 1 a call, 2 a warning. `card`: the colour a `set` flash takes. */
+  function react(sound, flash = null, cls = 0, card = '') {
+    const f = flash ? FLASHES[flash] : null;
+    const colour = f ? (f.colour === 'card' ? card || 'white' : f.colour) : '';
+    moment.push({ sound, flash: f, colour, cls, audible: true });
   }
 
   function start(r, at) {
@@ -168,12 +170,17 @@ export function createWrist({ key }) {
     react('down');
   }
 
+  /** SET, CHANGED or NOT SENT on the face, with its sound and flash. In NOT NOW a failed try to come back is silent. */
   function result(now, w) {
     mode = 'result';
     word = w;
     resultUntil = now + RESULT_MS;
     preview = '';
     frozen = false;
+    if (current() === 'notnow') return;
+    if (w === 'SET') react('up', 'set', 0, choice);
+    else if (w === 'CHANGED') react('fall', 'changed');
+    else react('low', 'notsent');
   }
 
   /** `held`: a KEY2 hold sends it at once, and says so with a double tick, except from NOT NOW, which is silent. */
@@ -366,7 +373,18 @@ export function createWrist({ key }) {
     if (k1.down && !k1.fired && now - k1.since >= BAR_MS) {
       f = { ...f, small: 'KEEP HOLDING', bar: Math.min(99, Math.floor(((now - k1.since) * 100) / HOLD_MS)), light: Math.max(f.light, LIGHT_AWAKE) };
     }
-    return f;
+    return flashOver(f, now);
+  }
+
+  /** A flash, step by step: on is its colour at full light and nothing else; off is the backlight off. */
+  function flashOver(f, now) {
+    if (!playing || !playing.flash) return f;
+    const { count, on, off } = playing.flash;
+    const t = now - playing.at;
+    if (t < 0 || t >= count * (on + off)) return f;
+    return t % (on + off) < on
+      ? { big: '', small: '', field: playing.colour, ink: 'ink', light: LIGHT_FULL, bar: -1, code: '' }
+      : { ...f, light: LIGHT_OFF };
   }
 
   return {
````

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -1019,7 +1019,7 @@ inline const char* cardWords(const std::string& intent) {
 /** What the screen shows: two lines on one field, the backlight, the KEEP HOLDING bar, and letters to draw with their QR. */
 struct Screen {
   std::string big, small;
-  std::string field = "black";  // black | white | hi | song | dance
+  std::string field = "black";  // black | white | hi | song | dance | red | orange
   std::string ink = "text2";    // ink | text2 | white | hi | song | dance
   uint8_t light = LIGHT_OFF;
   int bar = -1;                 // 0..99 while KEY1 is held past BAR_MS; -1 otherwise
@@ -1204,6 +1204,24 @@ class Wrist {
       f.bar = std::min<int>(99, static_cast<int>((now - k1_.since) * 100 / HOLD_MS));
       if (f.light < LIGHT_AWAKE) f.light = LIGHT_AWAKE;
     }
+    return flashOver(f, now);
+  }
+
+ private:
+  /** A flash, step by step: on is its colour at full light and nothing else; off is the backlight off. */
+  Screen flashOver(Screen f, uint32_t now) const {
+    if (!playingOn_ || !playing_.flash) return f;
+    const Flash& fl = *playing_.flash;
+    const uint32_t t = now - playing_.at;
+    if (static_cast<int32_t>(t) < 0 || t >= flashMs(&fl)) return f;
+    if (t % (uint32_t(fl.on) + fl.off) < fl.on) {
+      Screen on;
+      on.field = playing_.colour;
+      on.ink = "ink";
+      on.light = LIGHT_FULL;
+      return on;
+    }
+    f.light = LIGHT_OFF;
     return f;
   }
 
@@ -1218,15 +1236,18 @@ class Wrist {
   struct Reaction {
     const char* sound = nullptr;
     const Flash* flash = nullptr;
+    std::string colour;
     int cls = 0;
     bool audible = true;
     uint32_t at = 0, until = 0;
   };
 
-  void react(const char* sound, const Flash* flash = nullptr, int cls = 0) {
+  /** A reaction of this moment. `card`: the colour a "set" flash takes. */
+  void react(const char* sound, const char* flash = nullptr, int cls = 0, const std::string& card = "") {
     Reaction r;
     r.sound = sound;
-    r.flash = flash;
+    r.flash = flash ? flashFor(flash) : nullptr;
+    if (r.flash) r.colour = std::string(r.flash->colour) == "card" ? (card.empty() ? "white" : card) : r.flash->colour;
     r.cls = cls;
     moment_.push_back(r);
   }
@@ -1313,12 +1334,18 @@ class Wrist {
     react("down");
   }
 
+  /** SET, CHANGED or NOT SENT on the face, with its sound and flash. In NOT NOW a failed try to come back is silent. */
   void result(uint32_t now, const char* w) {
     mode_ = RESULT;
     word_ = w;
     resultUntil_ = now + RESULT_MS;
     preview_.clear();
     frozen_ = false;
+    if (current() == "notnow") return;
+    const std::string word = w;
+    if (word == "SET") react("up", "set", 0, choice_);
+    else if (word == "CHANGED") react("fall", "changed");
+    else react("low", "notsent");
   }
 
   /** `held`: a KEY2 hold sends it at once, and says so with a double tick, except from NOT NOW, which is silent. */
````

- [ ] **Step 4: Run** — the table as above, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 197`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "CHANGED sounds and flashes as NOT SENT",
  "file": "app/lib/wrist.js",
  "from": "    else if (w === 'CHANGED') react('fall', 'changed');\n",
  "to": "    else if (w === 'CHANGED') react('low', 'notsent');\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the relay refusing a stale basis is CHANGED; any other refusal is NOT SENT at once",
   "wrist.js: CHANGED plays fall and flashes red three times, 120 on and 90 off; NOT SENT plays low and flashes orange twice, 350 on and 250 off"
  ]
 },
 {
  "label": "SET flashes white whatever the card",
  "file": "app/lib/wrist.js",
  "from": "    if (w === 'SET') react('up', 'set', 0, choice);\n",
  "to": "    if (w === 'SET') react('up', 'set', 0, '');\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: from NOT NOW the first step is HI, only a KEY2 hold sends it, and two stray presses send nothing",
   "wrist.js: SET plays up and flashes the card's colour twice, 150 on and 100 off; then SET shows",
   "wrist.js: a key going down ends a flash: only its tick plays, and the face under the flash shows at once"
  ]
 },
 {
  "label": "NOT SENT does not flash",
  "file": "app/lib/wrist.js",
  "from": "    else react('low', 'notsent');\n",
  "to": "    else react('low');\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the relay refusing a stale basis is CHANGED; any other refusal is NOT SENT at once",
   "wrist.js: nothing back in CONFIRM_MS is NOT SENT: the socket is dropped, and the next connection's show is the truth",
   "wrist.js: CHANGED plays fall and flashes red three times, 120 on and 90 off; NOT SENT plays low and flashes orange twice, 350 on and 250 off"
  ]
 },
 {
  "label": "a flash's off step stays lit",
  "file": "app/lib/wrist.js",
  "from": "      : { ...f, light: LIGHT_OFF };\n",
  "to": "      : f;\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: nothing back in CONFIRM_MS is NOT SENT: the socket is dropped, and the next connection's show is the truth",
   "wrist.js: SET plays up and flashes the card's colour twice, 150 on and 100 off; then SET shows",
   "wrist.js: CHANGED plays fall and flashes red three times, 120 on and 90 off; NOT SENT plays low and flashes orange twice, 350 on and 250 off"
  ]
 },
 {
  "label": "C++: CHANGED sounds and flashes as NOT SENT",
  "file": "firmware/src/band_logic.h",
  "from": "    else if (word == \"CHANGED\") react(\"fall\", \"changed\");\n",
  "to": "    else if (word == \"CHANGED\") react(\"low\", \"notsent\");\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: the relay refusing a stale basis is CHANGED; any other refusal is NOT SENT at once",
   "band_logic.h: CHANGED plays fall and flashes red three times, 120 on and 90 off; NOT SENT plays low and flashes orange twice, 350 on and 250 off"
  ]
 },
 {
  "label": "C++: SET flashes white whatever the card",
  "file": "firmware/src/band_logic.h",
  "from": "    if (word == \"SET\") react(\"up\", \"set\", 0, choice_);\n",
  "to": "    if (word == \"SET\") react(\"up\", \"set\", 0, \"\");\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: from NOT NOW the first step is HI, only a KEY2 hold sends it, and two stray presses send nothing",
   "band_logic.h: SET plays up and flashes the card's colour twice, 150 on and 100 off; then SET shows",
   "band_logic.h: a key going down ends a flash: only its tick plays, and the face under the flash shows at once"
  ]
 },
 {
  "label": "C++: a flash's off step stays lit",
  "file": "firmware/src/band_logic.h",
  "from": "    f.light = LIGHT_OFF;\n    return f;\n  }\n",
  "to": "    return f;\n  }\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: nothing back in CONFIRM_MS is NOT SENT: the socket is dropped, and the next connection's show is the truth",
   "band_logic.h: SET plays up and flashes the card's colour twice, 150 on and 100 off; then SET shows",
   "band_logic.h: CHANGED plays fall and flashes red three times, 120 on and 90 off; NOT SENT plays low and flashes orange twice, 350 on and 250 off"
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
Answer a choice from the wrist with SET, CHANGED or NOT SENT, in sound and light

SET plays up and flashes the card's colour twice (white for OFF), CHANGED
plays fall and flashes red three times, and NOT SENT plays low and flashes
orange twice. face() draws a flash over the face: its colour at full light,
then the backlight off. A key going down ends a flash.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 3: The sound switch, NOT NOW's silence, and the pairing moments (rules 1–3)

**Files:**
- Modify: `app/lib/wrist.js`, `firmware/src/band_logic.h`
- Test: `tests/wrist-table.js`, `tests/fixtures/wrist-cases.json`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: a show's `sound` (only `true` or `false` count; C++ `Frame::sound` is 1, 0 or -1 for not said) sets the wrist's `soundOn`, and each reaction records `audible = soundOn`; letters set it back on after their own reactions. `silent` holds NOT NOW's silence (rule 1): set by the FACE hold and by a quiet show about the person, ended by a show about them that shows them once no hold of the wrist's own is pending, and by letters. The check plays `ask` and flashes white; the test show plays `up`; a check that ends without YES plays `fall`. Two shows that differ only in `sound` are the same show. The harness's `with` overlay lays fields over a named show.

- [ ] **Step 1: Write the failing cases, and the harness's `with`.**

In `tests/wrist-table.js`:

````diff
--- a/tests/wrist-table.js
+++ b/tests/wrist-table.js
@@ -21,7 +21,9 @@
 // A step's `sent` and `sounds` are exact, and empty unless the step says
 // otherwise, so a stray frame or sound anywhere fails. A `press` is a key down
 // and, PRESS ms later, its key up: the step's `sent`, `sounds` and `face` are
-// the key up's, and `downSounds` (["tick"] unless said) the key down's.
+// the key up's, and `downSounds` (["tick"] unless said) the key down's. A
+// `show` step sends one of the table's shows, with its `rev` and any fields in
+// `with` laid over it.
 
 import assert from 'node:assert/strict';
 import { readFileSync } from 'node:fs';
@@ -49,7 +51,7 @@ export function at(expr, consts) {
 /** A case as protocol lines, each with what it must answer (null: not checked). */
 export function lines(c, consts) {
   const out = [{ line: 'key ' + TABLE.key, expect: null }];
-  const showOf = (s) => ({ t: 'show', show: { ...TABLE.shows[s.show], ...(s.rev !== undefined ? { rev: s.rev } : {}) } });
+  const showOf = (s) => ({ t: 'show', show: { ...TABLE.shows[s.show], ...(s.rev !== undefined ? { rev: s.rev } : {}), ...s.with } });
   let last = -Infinity;
   for (const s of c.steps) {
     const t = at(s.at ?? '0', consts);
````

In `tests/fixtures/wrist-cases.json`:

````diff
--- a/tests/fixtures/wrist-cases.json
+++ b/tests/fixtures/wrist-cases.json
@@ -273,7 +273,8 @@
       "steps": [
         { "at": "0", "battery": 62 },
         { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
-        { "at": "0", "show": "CHECK", "face": { "big": "27", "small": "ON YOUR PHONE?", "field": "black", "ink": "white", "light": "LIGHT_PAIR" } },
+        { "at": "0", "show": "CHECK", "sounds": ["ask"], "face": { "big": "", "field": "white", "light": "LIGHT_FULL" } },
+        { "at": "500", "face": { "big": "27", "small": "ON YOUR PHONE?", "field": "black", "ink": "white", "light": "LIGHT_PAIR" } },
         { "at": "1000", "press": 2, "face": { "big": "27", "small": "ON YOUR PHONE?" } },
         { "at": "2000", "show": "WAITING", "face": { "big": "OPEN YOUR PHONE", "small": "OR SWITCH ME OFF", "light": "LIGHT_AWAKE" } },
         { "at": "3000", "show": "AWAY", "face": { "big": "OPEN YOUR PHONE", "small": "TO COME BACK", "light": "LIGHT_AWAKE" } },
@@ -281,7 +282,7 @@
         { "at": "11000", "press": 1, "face": { "big": "OPEN YOUR PHONE", "small": "TO COME BACK", "light": "LIGHT_AWAKE" } },
         { "at": "12000", "press": 2, "face": { "small": "TO COME BACK" } },
         { "at": "13000", "show": "PAIRING", "face": { "big": "KXRT", "code": "KXRT", "light": "LIGHT_PAIR" } },
-        { "at": "14000", "show": "TEST", "face": { "field": "white", "light": "LIGHT_FULL" } }
+        { "at": "14000", "show": "TEST", "sounds": ["up"], "face": { "field": "white", "light": "LIGHT_FULL" } }
       ]
     },
     {
@@ -375,6 +376,154 @@
         { "at": "6000+HOLD_MS", "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "light": "LIGHT_FULL" } },
         { "at": "6000+HOLD_MS", "key2": "up" }
       ]
+    },
+    {
+      "name": "the sound switch off: presses and SET play nothing and SET still flashes; switched on, the next press ticks",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "sound": false } },
+        { "at": "1000", "press": 2, "downSounds": [], "face": { "big": "HI :)", "small": "SIDE TO CHANGE" } },
+        { "at": "2000", "press": 2, "downSounds": [], "face": { "big": "FIRST SONG?", "small": "SIDE: NEXT" } },
+        { "at": "2100+COMMIT_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }] },
+        { "at": "6000", "show": "SONG", "rev": 4, "with": { "sound": false }, "face": { "big": "", "field": "song", "light": "LIGHT_FULL" } },
+        { "at": "6000+500", "face": { "big": "FIRST SONG?", "small": "SET", "field": "song", "light": "LIGHT_FULL" } },
+        { "at": "7000", "show": "SONG", "rev": 4, "with": { "sound": true }, "face": { "big": "FIRST SONG?", "small": "SET", "light": "LIGHT_FULL" } },
+        { "at": "8000", "press": 1 }
+      ]
+    },
+    {
+      "name": "a show that differs from the last only in its sound causes nothing, but the switch still follows it",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "TEST", "with": { "sound": false }, "face": { "field": "white", "light": "LIGHT_FULL" } },
+        { "at": "500", "show": "TEST", "with": { "sound": true }, "face": { "field": "white", "light": "LIGHT_FULL" } },
+        { "at": "1000", "show": "HI", "rev": 1 },
+        { "at": "2000", "show": "TEST", "sounds": ["up"] }
+      ]
+    },
+    {
+      "name": "a sound that is not true or false is not said: the switch stays as it was",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 1, "with": { "sound": false } },
+        { "at": "1000", "show": "TEST", "with": { "sound": "on" } },
+        { "at": "2000", "show": "HI", "rev": 1, "with": { "sound": 1 } },
+        { "at": "3000", "show": "TEST", "with": { "sound": null } },
+        { "at": "4000", "show": "HI", "rev": 1, "with": { "sound": true } },
+        { "at": "5000", "show": "TEST", "with": { "sound": 0 }, "sounds": ["up"] },
+        { "at": "6000", "show": "HI", "rev": 1, "with": { "sound": "false" } },
+        { "at": "7000", "show": "TEST", "with": { "sound": [] }, "sounds": ["up"] }
+      ]
+    },
+    {
+      "name": "the check number plays ask and flashes white twice, 150 on and 100 off; YES plays up on the white face",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "PAIRING", "face": { "big": "KXRT", "code": "KXRT", "light": "LIGHT_PAIR" } },
+        { "at": "1000", "show": "CHECK", "sounds": ["ask"], "face": { "big": "", "small": "", "field": "white", "light": "LIGHT_FULL", "code": "" } },
+        { "at": "1000+149", "face": { "field": "white", "light": "LIGHT_FULL" } },
+        { "at": "1000+150", "face": { "big": "27", "small": "ON YOUR PHONE?", "light": "LIGHT_OFF" } },
+        { "at": "1000+250", "face": { "big": "", "field": "white", "light": "LIGHT_FULL" } },
+        { "at": "1000+400", "face": { "big": "27", "light": "LIGHT_OFF" } },
+        { "at": "1000+500", "face": { "big": "27", "small": "ON YOUR PHONE?", "field": "black", "light": "LIGHT_PAIR" } },
+        { "at": "3000", "frame": { "t": "paired", "secret": "5ec2e75ec2e75ec2e75ec2e75ec2e75e" } },
+        { "at": "3000", "show": "TEST", "sounds": ["up"], "face": { "big": "", "field": "white", "light": "LIGHT_FULL" } },
+        { "at": "4000", "show": "HI", "rev": 1, "face": { "big": "HI :)", "field": "hi", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "a check that ends without YES plays fall as the letters come back; letters said again play nothing",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "PAIRING" },
+        { "at": "1000", "show": "CHECK", "sounds": ["ask"] },
+        { "at": "5000", "show": "PAIRING", "with": { "code": "MQTV" }, "sounds": ["fall"], "face": { "big": "MQTV", "code": "MQTV", "light": "LIGHT_PAIR" } },
+        { "at": "6000", "show": "PAIRING", "with": { "code": "MQTV" } }
+      ]
+    },
+    {
+      "name": "TEST THE LIGHT plays up; in NOT NOW it shows its white and plays nothing, and NOT NOW stays silent after it, a FACE hold included",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "show": "TEST", "sounds": ["up"], "face": { "field": "white", "light": "LIGHT_FULL" } },
+        { "at": "3000", "show": "HI", "rev": 3 },
+        { "at": "4000", "show": "QUIET", "rev": 4, "face": { "big": "", "light": "LIGHT_OFF" } },
+        { "at": "5000", "show": "TEST", "face": { "field": "white", "light": "LIGHT_FULL" } },
+        { "at": "7000", "show": "QUIET", "rev": 4 },
+        { "at": "8000", "press": 1, "downSounds": [], "face": { "big": "NOT NOW" } },
+        { "at": "9000", "key1": "down" },
+        { "at": "9000+HOLD_MS", "sent": [{ "t": "hold" }], "face": { "light": "LIGHT_OFF" } },
+        { "at": "9000+HOLD_MS", "key1": "up" }
+      ]
+    },
+    {
+      "name": "a card shown while the wrist's own hold waits to be heard does not end NOT NOW's silence",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "key1": "down", "sounds": ["tick"] },
+        { "at": "1000+HOLD_MS", "sent": [{ "t": "hold" }], "sounds": ["down"], "face": { "light": "LIGHT_OFF" } },
+        { "at": "1000+HOLD_MS", "key1": "up" },
+        { "at": "3000", "show": "SONG", "rev": 4, "face": { "light": "LIGHT_OFF" } },
+        { "at": "3500", "press": 2, "downSounds": [], "face": { "big": "NOT NOW", "small": "SIDE TO CHANGE" } },
+        { "at": "4000", "show": "QUIET", "rev": 5, "face": { "big": "NOT NOW" } }
+      ]
+    },
+    {
+      "name": "a try to come back from NOT NOW that ends CHANGED or NOT SENT is silent; its word still shows",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "QUIET", "rev": 6 },
+        { "at": "1000", "press": 2, "downSounds": [] },
+        { "at": "2000", "press": 2, "downSounds": [], "face": { "big": "HI :)", "small": "HOLD SIDE TO SHOW" } },
+        { "at": "3000", "key2": "down" },
+        { "at": "3000+HOLD_MS", "sent": [{ "t": "set", "intent": "hi", "basis": 6 }] },
+        { "at": "3000+HOLD_MS", "key2": "up" },
+        { "at": "5000", "frame": { "t": "set", "ok": false, "why": "changed" }, "face": { "big": "NOT NOW", "small": "CHANGED", "field": "black", "light": "LIGHT_AWAKE" } },
+        { "at": "9000", "press": 2, "downSounds": [] },
+        { "at": "10000", "press": 2, "downSounds": [] },
+        { "at": "11000", "key2": "down" },
+        { "at": "11000+HOLD_MS", "sent": [{ "t": "set", "intent": "hi", "basis": 6 }] },
+        { "at": "11000+HOLD_MS", "key2": "up" },
+        { "at": "13000", "frame": { "t": "set", "ok": false, "why": "too fast" }, "face": { "big": "NOT NOW", "small": "NOT SENT", "light": "LIGHT_AWAKE" } }
+      ]
+    },
+    {
+      "name": "NOT NOW stays silent through waiting for the owner, and letters end it",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "QUIET", "rev": 2 },
+        { "at": "1000", "show": "WAITING", "face": { "big": "OPEN YOUR PHONE", "light": "LIGHT_AWAKE" } },
+        { "at": "2000", "press": 2, "downSounds": [] },
+        { "at": "3000", "show": "PAIRING", "face": { "big": "KXRT" } },
+        { "at": "4000", "press": 2 }
+      ]
+    },
+    {
+      "name": "the wearer's own changes on the phone are silent on the wrist: a card, NOT NOW and back",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "show": "SONG", "rev": 4, "face": { "big": "FIRST SONG?", "field": "song", "light": "LIGHT_FULL" } },
+        { "at": "2000", "show": "QUIET", "rev": 5, "face": { "big": "", "light": "LIGHT_OFF" } },
+        { "at": "3000", "show": "HI", "rev": 6, "face": { "big": "HI :)", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "4000", "press": 1 }
+      ]
+    },
+    {
+      "name": "the sound switch is kept through waiting and goes back on at letters, after what the letters play",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3, "with": { "sound": false } },
+        { "at": "1000", "show": "WAITING" },
+        { "at": "2000", "press": 2, "downSounds": [] },
+        { "at": "3000", "show": "PAIRING" },
+        { "at": "4000", "press": 2 },
+        { "at": "5000", "show": "CHECK", "with": { "sound": false }, "face": { "field": "white", "light": "LIGHT_FULL" } },
+        { "at": "6000", "show": "PAIRING", "face": { "big": "KXRT", "light": "LIGHT_PAIR" } },
+        { "at": "7000", "show": "CHECK", "sounds": ["ask"] }
+      ]
     }
   ]
 }
````

New cases (11):

  - the sound switch off: presses and SET play nothing and SET still flashes; switched on, the next press ticks
  - a show that differs from the last only in its sound causes nothing, but the switch still follows it
  - a sound that is not true or false is not said: the switch stays as it was
  - the check number plays ask and flashes white twice, 150 on and 100 off; YES plays up on the white face
  - a check that ends without YES plays fall as the letters come back; letters said again play nothing
  - TEST THE LIGHT plays up; in NOT NOW it shows its white and plays nothing, and NOT NOW stays silent after it, a FACE hold included
  - a card shown while the wrist's own hold waits to be heard does not end NOT NOW's silence
  - a try to come back from NOT NOW that ends CHANGED or NOT SENT is silent; its word still shows
  - NOT NOW stays silent through waiting for the owner, and letters end it
  - the wearer's own changes on the phone are silent on the wrist: a card, NOT NOW and back
  - the sound switch is kept through waiting and goes back on at letters, after what the letters play

Changed cases (1):

  - the check, waiting for its owner, and not in a room; KEY2 on them only wakes

- [ ] **Step 2: Run the table and watch it fail**

Expected: `ℹ pass 63`, `ℹ fail 18`. The first errors:

```text
AssertionError [ERR_ASSERTION]: the check, waiting for its owner, and not in a room; KEY2 on them only wakes / 1000 frame {"t":"show","show":{"kind":"check","big":"27"}}: sounds
AssertionError [ERR_ASSERTION]: the sound switch off: presses and SET play nothing and SET still flashes; switched on, the next press ticks / 2000 key2 down: sounds
AssertionError [ERR_ASSERTION]: a show that differs from the last only in its sound causes nothing, but the switch still follows it / 3000 frame {"t":"show","show":{"kind":"test"}}: sounds
AssertionError [ERR_ASSERTION]: a sound that is not true or false is not said: the switch stays as it was / 6000 frame {"t":"show","show":{"kind":"test","sound":0}}: sounds
AssertionError [ERR_ASSERTION]: the check number plays ask and flashes white twice, 150 on and 100 off; YES plays up on the white face / 2000 frame {"t":"show","show":{"kind":"check","big":"27"}}: sounds
AssertionError [ERR_ASSERTION]: a check that ends without YES plays fall as the letters come back; letters said again play nothing / 2000 frame {"t":"show","show":{"kind":"check","big":"27"}}: sounds
```

Red (18):

- band_logic.h: the check, waiting for its owner, and not in a room; KEY2 on them only wakes
- band_logic.h: the sound switch off: presses and SET play nothing and SET still flashes; switched on, the next press ticks
- band_logic.h: a show that differs from the last only in its sound causes nothing, but the switch still follows it
- band_logic.h: a sound that is not true or false is not said: the switch stays as it was
- band_logic.h: the check number plays ask and flashes white twice, 150 on and 100 off; YES plays up on the white face
- band_logic.h: a check that ends without YES plays fall as the letters come back; letters said again play nothing
- band_logic.h: TEST THE LIGHT plays up; in NOT NOW it shows its white and plays nothing, and NOT NOW stays silent after it, a FACE hold included
- band_logic.h: NOT NOW stays silent through waiting for the owner, and letters end it
- band_logic.h: the sound switch is kept through waiting and goes back on at letters, after what the letters play
- wrist.js: the check, waiting for its owner, and not in a room; KEY2 on them only wakes
- wrist.js: the sound switch off: presses and SET play nothing and SET still flashes; switched on, the next press ticks
- wrist.js: a show that differs from the last only in its sound causes nothing, but the switch still follows it
- wrist.js: a sound that is not true or false is not said: the switch stays as it was
- wrist.js: the check number plays ask and flashes white twice, 150 on and 100 off; YES plays up on the white face
- … and 4 more

- [ ] **Step 3: Implement in both twins.**

In `app/lib/wrist.js`:

````diff
--- a/app/lib/wrist.js
+++ b/app/lib/wrist.js
@@ -110,8 +110,10 @@ export function createWrist({ key }) {
   let out = [];
   // Reactions (rule 6): this input's, and the one playing.
   let moment = [];
-  let playing = null;         // { sound, flash, cls, audible, at, until }
+  let playing = null;         // { sound, flash, colour, cls, audible, at, until }
   let due = [];               // sounds started since sounds() was last asked
+  let soundOn = true;         // the person's switch, as the last show that said it had it (rule 3)
+  let silent = false;         // NOT NOW, for the sake of silence (rule 1)
 
   const send = (m) => out.push(JSON.stringify(m));
   const stale = (now) => !link.up && (!link.ever || now - link.lost >= STALE_MS);
@@ -123,7 +125,7 @@ export function createWrist({ key }) {
   function react(sound, flash = null, cls = 0, card = '') {
     const f = flash ? FLASHES[flash] : null;
     const colour = f ? (f.colour === 'card' ? card || 'white' : f.colour) : '';
-    moment.push({ sound, flash: f, colour, cls, audible: true });
+    moment.push({ sound, flash: f, colour, cls, audible: soundOn });
   }
 
   function start(r, at) {
@@ -167,7 +169,9 @@ export function createWrist({ key }) {
     quiet.sent = false;
     rest();
     wakeUntil = now;
-    react('down');
+    // Going into NOT NOW is the one sound it makes; a hold inside NOT NOW is silent.
+    if (!silent) react('down');
+    silent = true;
   }
 
   /** SET, CHANGED or NOT SENT on the face, with its sound and flash. In NOT NOW a failed try to come back is silent. */
@@ -177,7 +181,7 @@ export function createWrist({ key }) {
     resultUntil = now + RESULT_MS;
     preview = '';
     frozen = false;
-    if (current() === 'notnow') return;
+    if (silent) return;
     if (w === 'SET') react('up', 'set', 0, choice);
     else if (w === 'CHANGED') react('fall', 'changed');
     else react('low', 'notsent');
@@ -187,7 +191,6 @@ export function createWrist({ key }) {
   function commit(now, held = false) {
     if (frozen) return;
     if (preview === current() || !link.up) { rest(); return; }
-    const silent = current() === 'notnow';
     choice = preview === 'off' ? '' : preview;
     send({ t: 'set', intent: choice || null, basis });
     mode = 'sending';
@@ -257,7 +260,7 @@ export function createWrist({ key }) {
     s.fired = false;
     if (k === 1 && (mode === 'look' || mode === 'choosing')) frozen = true;
     // Every press is heard as it goes down; NOT NOW is silent.
-    if (current() !== 'notnow') react('tick');
+    if (!silent) react('tick');
     settle(now);
   }
 
@@ -314,14 +317,32 @@ export function createWrist({ key }) {
       return;
     }
     if (m.t !== 'show' || !m.show || typeof m.show !== 'object') return;
+    const was = show;
     show = readShow(m.show);
-    if (show.kind === 'pairing') secret = '';
+    // Reactions come from changes; a show that differs only in `sound` is no change.
+    const same = !!was && JSON.stringify(was) === JSON.stringify(show);
+    // A show's own switch counts for what it causes. One that is not true or false is not said.
+    if (typeof m.show.sound === 'boolean') soundOn = m.show.sound;
+    if (show.kind === 'pairing') {
+      secret = '';
+      silent = false;                                     // the band is nobody's: NOT NOW is over
+      if (was?.kind === 'check') react('fall', null, 1);  // the check ended without YES
+      soundOn = true;                                     // after the letters' own reactions
+    }
     if (quiet.pending && quiet.sent && !lit(show)) quiet.pending = false;
+    // NOT NOW's silence starts and ends only with a show about the person (rule 1).
+    if (personal()) {
+      if (show.quiet) silent = true;
+      else if (!quiet.pending) silent = false;
+    }
     if (mode === 'look' || mode === 'choosing') {
       if (!personal() || show.rev !== basis) rest();
     } else if (mode === 'sending' && personal() && show.rev > basis && show.armed === choice && !show.quiet) {
       result(now, 'SET');
     }
+    if (same || silent) return;
+    if (show.kind === 'check') react('ask', 'check', 1);
+    else if (show.kind === 'test') react('up', null, 1);  // paired, or TEST THE LIGHT: the white face is its flash
   }
 
   /** The face at rest: band_logic.h faceFor(), wordsFor() and lightFor(), in that order. */
````

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -425,6 +425,7 @@ struct Frame {
   std::string t;
   bool hasShow = false;
   Show show;
+  int sound = -1;          // the show's sound switch: 1 on, 0 off, -1 not said (so not part of the Show)
   std::string why;
   bool hasOk = false;      // {t:'set', ok:false, why}: the relay refused a choice
   bool ok = true;
@@ -490,6 +491,14 @@ inline bool readFrame(const std::string& text, Frame& f) {
         s.rev = whole ? v : 0;
         return true;
       }
+      if (k == "sound") {
+        // Only true or false says it; anything else leaves the band's switch as it was.
+        if (!r.peek('t') && !r.peek('f')) return r.skip();
+        bool on = false;
+        if (!r.boolean(on)) return false;
+        f.sound = on ? 1 : 0;
+        return true;
+      }
       return r.skip();
     });
     if (s.kind.empty()) s.kind = "off";
@@ -1063,7 +1072,7 @@ class Wrist {
     // Any KEY1 press-down freezes a choice at once: no commit can fire.
     if (k == 1 && (mode_ == LOOK || mode_ == CHOOSING)) frozen_ = true;
     // Every press is heard as it goes down; NOT NOW is silent.
-    if (current() != "notnow") react("tick");
+    if (!silent_) react("tick");
     settle(now);
   }
 
@@ -1126,16 +1135,34 @@ class Wrist {
       return;
     }
     if (f.t != "show" || !f.hasShow) return;
+    // Reactions come from changes; a show that differs only in its sound switch is no change.
+    const bool same = haveShow_ && show_ == f.show;
+    const bool wasCheck = haveShow_ && show_.kind == "check";
     show_ = f.show;
     haveShow_ = true;
-    if (show_.kind == "pairing") secret_.clear();  // unpaired, or nobody came for it: a new pairing
+    // A show's own switch counts for what it causes.
+    if (f.sound >= 0) soundOn_ = f.sound == 1;
+    if (show_.kind == "pairing") {
+      secret_.clear();                            // unpaired, or nobody came for it: a new pairing
+      silent_ = false;                            // the band is nobody's: NOT NOW is over
+      if (wasCheck) react("fall", nullptr, 1);    // the check ended without YES
+      soundOn_ = true;                            // after the letters' own reactions
+    }
     quiet_.shown(show_);
+    // NOT NOW's silence starts and ends only with a show about the person (rule 1).
+    if (personal()) {
+      if (show_.quiet) silent_ = true;
+      else if (!quiet_.dark()) silent_ = false;
+    }
     if (mode_ == LOOK || mode_ == CHOOSING) {
       // A show not about the person, or one whose rev moved, cancels the choice.
       if (!personal() || show_.rev != basis_) rest();
     } else if (mode_ == SENDING && personal() && show_.rev > basis_ && show_.armed == choice_ && !show_.quiet) {
       result(now, "SET");
     }
+    if (same || silent_) return;
+    if (show_.kind == "check") react("ask", "check", 1);
+    else if (show_.kind == "test") react("up", nullptr, 1);  // paired, or TEST THE LIGHT: the white face is its flash
   }
 
   void ticked(uint32_t now) {
@@ -1249,6 +1276,7 @@ class Wrist {
     r.flash = flash ? flashFor(flash) : nullptr;
     if (r.flash) r.colour = std::string(r.flash->colour) == "card" ? (card.empty() ? "white" : card) : r.flash->colour;
     r.cls = cls;
+    r.audible = soundOn_;
     moment_.push_back(r);
   }
 
@@ -1331,7 +1359,9 @@ class Wrist {
     quiet_.held();
     rest();
     wakeUntil_ = now;
-    react("down");
+    // Going into NOT NOW is the one sound it makes; a hold inside NOT NOW is silent.
+    if (!silent_) react("down");
+    silent_ = true;
   }
 
   /** SET, CHANGED or NOT SENT on the face, with its sound and flash. In NOT NOW a failed try to come back is silent. */
@@ -1341,7 +1371,7 @@ class Wrist {
     resultUntil_ = now + RESULT_MS;
     preview_.clear();
     frozen_ = false;
-    if (current() == "notnow") return;
+    if (silent_) return;
     const std::string word = w;
     if (word == "SET") react("up", "set", 0, choice_);
     else if (word == "CHANGED") react("fall", "changed");
@@ -1356,13 +1386,12 @@ class Wrist {
       rest();
       return;
     }
-    const bool silent = current() == "notnow";
     choice_ = preview_ == "off" ? "" : preview_;
     out_.push_back("{\"t\":\"set\",\"intent\":" + (choice_.empty() ? std::string("null") : "\"" + choice_ + "\"") +
                    ",\"basis\":" + std::to_string(basis_) + "}");
     mode_ = SENDING;
     sentAt_ = now;
-    if (held && !silent) react("double");
+    if (held && !silent_) react("double");
   }
 
   static std::string after(const std::string& card) {
@@ -1424,6 +1453,8 @@ class Wrist {
   Reaction playing_;
   bool playingOn_ = false;
   std::vector<std::string> due_;
+  bool soundOn_ = true;  // the person's switch, as the last show that said it had it (rule 3)
+  bool silent_ = false;  // NOT NOW, for the sake of silence (rule 1)
 };
 
 // ---------- the serial console ----------
````

- [ ] **Step 4: Run** — the table, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 219`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "a tick let through in NOT NOW",
  "file": "app/lib/wrist.js",
  "from": "    if (!silent) react('tick');\n",
  "to": "    react('tick');\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW",
   "wrist.js: from NOT NOW the first step is HI, only a KEY2 hold sends it, and two stray presses send nothing",
   "wrist.js: NOT SENT leaving NOT NOW holds NOT NOW again, in the next hello",
   "wrist.js: TEST THE LIGHT plays up; in NOT NOW it shows its white and plays nothing, and NOT NOW stays silent after it, a FACE hold included",
   "wrist.js: a card shown while the wrist's own hold waits to be heard does not end NOT NOW's silence",
   "wrist.js: a try to come back from NOT NOW that ends CHANGED or NOT SENT is silent; its word still shows",
   "wrist.js: NOT NOW stays silent through waiting for the owner, and letters end it"
  ]
 },
 {
  "label": "a card show ends the silence while the wrist's own hold waits",
  "file": "app/lib/wrist.js",
  "from": "      else if (!quiet.pending) silent = false;\n",
  "to": "      else silent = false;\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a card shown while the wrist's own hold waits to be heard does not end NOT NOW's silence"
  ]
 },
 {
  "label": "the switch reset before the letters' own reactions",
  "file": "app/lib/wrist.js",
  "from": "      if (was?.kind === 'check') react('fall', null, 1);  // the check ended without YES\n      soundOn = true;                                     // after the letters' own reactions\n",
  "to": "      soundOn = true;\n      if (was?.kind === 'check') react('fall', null, 1);\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the sound switch is kept through waiting and goes back on at letters, after what the letters play"
  ]
 },
 {
  "label": "a show that differs only in sound reacts",
  "file": "app/lib/wrist.js",
  "from": "    if (same || silent) return;\n",
  "to": "    if (silent) return;\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a show that differs from the last only in its sound causes nothing, but the switch still follows it"
  ]
 },
 {
  "label": "a sound that is not a boolean read as one",
  "file": "app/lib/wrist.js",
  "from": "    if (typeof m.show.sound === 'boolean') soundOn = m.show.sound;\n",
  "to": "    if (m.show.sound !== undefined) soundOn = !!m.show.sound;\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a sound that is not true or false is not said: the switch stays as it was"
  ]
 },
 {
  "label": "a FACE hold inside NOT NOW plays down",
  "file": "app/lib/wrist.js",
  "from": "    if (!silent) react('down');\n",
  "to": "    react('down');\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: TEST THE LIGHT plays up; in NOT NOW it shows its white and plays nothing, and NOT NOW stays silent after it, a FACE hold included"
  ]
 },
 {
  "label": "a failed try to come back from NOT NOW plays its result",
  "file": "app/lib/wrist.js",
  "from": "    frozen = false;\n    if (silent) return;\n",
  "to": "    frozen = false;\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: NOT SENT leaving NOT NOW holds NOT NOW again, in the next hello",
   "wrist.js: a try to come back from NOT NOW that ends CHANGED or NOT SENT is silent; its word still shows"
  ]
 },
 {
  "label": "TEST THE LIGHT plays in NOT NOW",
  "file": "app/lib/wrist.js",
  "from": "    if (same || silent) return;\n",
  "to": "    if (same) return;\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: TEST THE LIGHT plays up; in NOT NOW it shows its white and plays nothing, and NOT NOW stays silent after it, a FACE hold included"
  ]
 },
 {
  "label": "a SIDE hold from NOT NOW plays double",
  "file": "app/lib/wrist.js",
  "from": "    if (held && !silent) react('double');\n",
  "to": "    if (held) react('double');\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: from NOT NOW the first step is HI, only a KEY2 hold sends it, and two stray presses send nothing",
   "wrist.js: NOT SENT leaving NOT NOW holds NOT NOW again, in the next hello",
   "wrist.js: a try to come back from NOT NOW that ends CHANGED or NOT SENT is silent; its word still shows"
  ]
 },
 {
  "label": "letters do not end NOT NOW",
  "file": "app/lib/wrist.js",
  "from": "      silent = false;                                     // the band is nobody's: NOT NOW is over\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: NOT NOW stays silent through waiting for the owner, and letters end it"
  ]
 },
 {
  "label": "a show about the person that is not quiet does not end NOT NOW",
  "file": "app/lib/wrist.js",
  "from": "      else if (!quiet.pending) silent = false;\n",
  "to": "      else if (false) silent = false;\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: from NOT NOW the first step is HI, only a KEY2 hold sends it, and two stray presses send nothing",
   "wrist.js: the wearer's own changes on the phone are silent on the wrist: a card, NOT NOW and back"
  ]
 },
 {
  "label": "a quiet show does not start NOT NOW's silence",
  "file": "app/lib/wrist.js",
  "from": "      if (show.quiet) silent = true;\n",
  "to": "      if (false) silent = true;\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW",
   "wrist.js: from NOT NOW the first step is HI, only a KEY2 hold sends it, and two stray presses send nothing",
   "wrist.js: NOT SENT leaving NOT NOW holds NOT NOW again, in the next hello",
   "wrist.js: TEST THE LIGHT plays up; in NOT NOW it shows its white and plays nothing, and NOT NOW stays silent after it, a FACE hold included",
   "wrist.js: a try to come back from NOT NOW that ends CHANGED or NOT SENT is silent; its word still shows",
   "wrist.js: NOT NOW stays silent through waiting for the owner, and letters end it"
  ]
 },
 {
  "label": "C++: a tick let through in NOT NOW",
  "file": "firmware/src/band_logic.h",
  "from": "    if (!silent_) react(\"tick\");\n",
  "to": "    react(\"tick\");\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW",
   "band_logic.h: from NOT NOW the first step is HI, only a KEY2 hold sends it, and two stray presses send nothing",
   "band_logic.h: NOT SENT leaving NOT NOW holds NOT NOW again, in the next hello",
   "band_logic.h: TEST THE LIGHT plays up; in NOT NOW it shows its white and plays nothing, and NOT NOW stays silent after it, a FACE hold included",
   "band_logic.h: a card shown while the wrist's own hold waits to be heard does not end NOT NOW's silence",
   "band_logic.h: a try to come back from NOT NOW that ends CHANGED or NOT SENT is silent; its word still shows",
   "band_logic.h: NOT NOW stays silent through waiting for the owner, and letters end it"
  ]
 },
 {
  "label": "C++: a card show ends the silence while the wrist's own hold waits",
  "file": "firmware/src/band_logic.h",
  "from": "      else if (!quiet_.dark()) silent_ = false;\n",
  "to": "      else silent_ = false;\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a card shown while the wrist's own hold waits to be heard does not end NOT NOW's silence"
  ]
 },
 {
  "label": "C++: the switch reset before the letters' own reactions",
  "file": "firmware/src/band_logic.h",
  "from": "      if (wasCheck) react(\"fall\", nullptr, 1);    // the check ended without YES\n      soundOn_ = true;                            // after the letters' own reactions\n",
  "to": "      soundOn_ = true;\n      if (wasCheck) react(\"fall\", nullptr, 1);\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: the sound switch is kept through waiting and goes back on at letters, after what the letters play"
  ]
 },
 {
  "label": "C++: a show that differs only in sound reacts (compiling form)",
  "file": "firmware/src/band_logic.h",
  "from": "    if (same || silent_) return;\n",
  "to": "    if ((same && !same) || silent_) return;\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "tests\\firmware.test.js"
  ]
 },
 {
  "label": "C++: a sound that is not a boolean read as on",
  "file": "firmware/src/band_logic.h",
  "from": "        if (!r.peek('t') && !r.peek('f')) return r.skip();\n        bool on = false;\n",
  "to": "        if (!r.peek('t') && !r.peek('f')) { f.sound = 1; return r.skip(); }\n        bool on = false;\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a sound that is not true or false is not said: the switch stays as it was"
  ]
 },
 {
  "label": "C++: a FACE hold inside NOT NOW plays down",
  "file": "firmware/src/band_logic.h",
  "from": "    if (!silent_) react(\"down\");\n",
  "to": "    react(\"down\");\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: TEST THE LIGHT plays up; in NOT NOW it shows its white and plays nothing, and NOT NOW stays silent after it, a FACE hold included"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add app/lib/wrist.js firmware/src/band_logic.h tests/wrist-table.js tests/fixtures/wrist-cases.json
```

````bash
git commit -F - <<'EOF'
Let the wearer switch the band's sound off, keep NOT NOW silent, and call the pairing check

A show's sound (true or false only) sets the wrist's switch; off, nothing
plays and every flash stays. NOT NOW is silent from the FACE hold or a quiet
show until a show about the person says they are shown, with no hold of the
wrist's own still waiting; letters end it. The wearer's own changes on the
phone are silent. The check plays ask and flashes white, the white face that
ends a pairing (and TEST THE LIGHT) plays up, and a check ending without YES
plays fall. A show differing only in sound causes nothing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 4: A meeting number calls until it is answered (rule 4)

**Files:**
- Modify: `app/lib/wrist.js`, `firmware/src/band_logic.h`
- Test: `firmware/host/logic_test.cpp` (the constant), `tests/fixtures/wrist-cases.json`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `BLINK_MS = 500` (exported, in `CONSTS`, and in the host's `consts`); wrist state `called` (the last number called for), `calling`, `callAt`; `blinking(now)` = calling, resting, believed, and a meeting show. The first key down while it blinks sets `calling = false` and marks the key fired, so it only answers. A show about the person that is not a meeting forgets `called` and ends the call; letters forget it too (the spec forgets it at a non-meeting show about the person; letters reset everything else about the person, so they reset this as well). The moment gains a queue: `settle` starts its first reaction and puts the rest ahead of whatever was waiting, and `advance` starts each waiting reaction at the time the one before it ended. A meeting still running when the wearer comes back from NOT NOW is the first moment with two reactions: the SET, then the call.

- [ ] **Step 1: Write the failing cases, and the constant on the host.**

In `firmware/host/logic_test.cpp`:

````diff
--- a/firmware/host/logic_test.cpp
+++ b/firmware/host/logic_test.cpp
@@ -526,7 +526,8 @@ std::string answer(const Command& c) {
            ",\"COMMIT_MS\":" + std::to_string(COMMIT_MS) + ",\"CONFIRM_MS\":" + std::to_string(CONFIRM_MS) +
            ",\"RESULT_MS\":" + std::to_string(RESULT_MS) + ",\"PING_EVERY_MS\":" + std::to_string(PING_EVERY_MS) +
            ",\"DEAF_MS\":" + std::to_string(DEAF_MS) + ",\"STALE_MS\":" + std::to_string(STALE_MS) +
-           ",\"QUIET_CONFIRM_MS\":" + std::to_string(QUIET_CONFIRM_MS) + ",\"LIGHT_FULL\":" + std::to_string(LIGHT_FULL) +
+           ",\"QUIET_CONFIRM_MS\":" + std::to_string(QUIET_CONFIRM_MS) + ",\"BLINK_MS\":" + std::to_string(BLINK_MS) +
+           ",\"LIGHT_FULL\":" + std::to_string(LIGHT_FULL) +
            ",\"LIGHT_DIM\":" + std::to_string(LIGHT_DIM) + ",\"LIGHT_PAIR\":" + std::to_string(LIGHT_PAIR) +
            ",\"LIGHT_AWAKE\":" + std::to_string(LIGHT_AWAKE) + ",\"LIGHT_OFF\":" + std::to_string(LIGHT_OFF) +
            ",\"CARD_WORDS\":{\"hi\":" + quote(cardWords("hi")) + ",\"song\":" + quote(cardWords("song")) +
````

In `tests/fixtures/wrist-cases.json`:

````diff
--- a/tests/fixtures/wrist-cases.json
+++ b/tests/fixtures/wrist-cases.json
@@ -301,12 +301,14 @@
       ]
     },
     {
-      "name": "LOOK replaces the meeting number while it lasts",
+      "name": "a meeting number calls; the first press answers it, and LOOK then replaces the number while it lasts",
       "steps": [
         { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
-        { "at": "0", "show": "MEET", "rev": 3, "face": { "big": "27", "small": "MEET", "field": "song" } },
-        { "at": "1000", "press": 2, "face": { "big": "HI :)", "small": "SIDE TO CHANGE", "field": "hi" } },
-        { "at": "1100+CHOOSE_MS", "face": { "big": "27", "small": "MEET" } }
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"], "face": { "big": "27", "small": "MEET", "field": "song" } },
+        { "at": "1000", "press": 2, "face": { "big": "27", "small": "MEET", "field": "song", "light": "LIGHT_FULL" } },
+        { "at": "1600", "face": { "big": "27", "light": "LIGHT_FULL" } },
+        { "at": "2000", "press": 2, "face": { "big": "HI :)", "small": "SIDE TO CHANGE", "field": "hi" } },
+        { "at": "2100+CHOOSE_MS", "face": { "big": "27", "small": "MEET" } }
       ]
     },
     {
@@ -524,6 +526,115 @@
         { "at": "6000", "show": "PAIRING", "face": { "big": "KXRT", "light": "LIGHT_PAIR" } },
         { "at": "7000", "show": "CHECK", "sounds": ["ask"] }
       ]
+    },
+    {
+      "name": "a meeting number plays jingle and blinks its face, 500 on and 500 off, until a key answers; that key only ticks, and holding it is no hold",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"], "face": { "big": "27", "small": "MEET", "field": "song", "light": "LIGHT_FULL" } },
+        { "at": "BLINK_MS-1", "face": { "big": "27", "light": "LIGHT_FULL" } },
+        { "at": "BLINK_MS", "face": { "big": "27", "small": "MEET", "field": "song", "light": "LIGHT_OFF" } },
+        { "at": "2*BLINK_MS", "face": { "light": "LIGHT_FULL" } },
+        { "at": "60000+BLINK_MS", "face": { "light": "LIGHT_OFF" } },
+        { "at": "61000", "key1": "down", "sounds": ["tick"], "face": { "big": "27", "small": "MEET", "light": "LIGHT_FULL" } },
+        { "at": "61000+BAR_MS", "face": { "small": "MEET", "bar": -1, "light": "LIGHT_FULL" } },
+        { "at": "61000+HOLD_MS", "face": { "small": "MEET", "light": "LIGHT_FULL" } },
+        { "at": "64000", "key1": "up", "face": { "big": "27", "small": "MEET", "light": "LIGHT_FULL" } },
+        { "at": "65000", "press": 2, "face": { "big": "HI :)", "small": "SIDE TO CHANGE" } }
+      ]
+    },
+    {
+      "name": "the same number after a reconnect, or after the test light, does not call again; a show about the person that is not a meeting forgets it",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "1000", "press": 1 },
+        { "at": "2000", "link": "down" },
+        { "at": "2000+STALE_MS", "face": { "big": "", "light": "LIGHT_OFF" } },
+        { "at": "13000", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "13100", "show": "MEET", "rev": 3, "face": { "big": "27", "light": "LIGHT_FULL" } },
+        { "at": "14000", "show": "TEST", "sounds": ["up"] },
+        { "at": "16000", "show": "MEET", "rev": 3, "face": { "big": "27", "light": "LIGHT_FULL" } },
+        { "at": "16600", "face": { "light": "LIGHT_FULL" } },
+        { "at": "17000", "show": "HI", "rev": 3 },
+        { "at": "18000", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "18500", "face": { "big": "27", "light": "LIGHT_OFF" } }
+      ]
+    },
+    {
+      "name": "a call ends when the band stops believing its show, and the same number does not call again when it is back",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "1000", "link": "down" },
+        { "at": "1000+STALE_MS-500", "face": { "big": "27", "light": "LIGHT_OFF" } },
+        { "at": "1000+STALE_MS", "face": { "big": "", "light": "LIGHT_OFF" } },
+        { "at": "12000", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "12100", "show": "MEET", "rev": 3, "face": { "big": "27", "light": "LIGHT_FULL" } },
+        { "at": "12600", "face": { "big": "27", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "a call waits for a choice, and for the result on the face, to end; its jingle plays at once and the choice's presses keep working",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "press": 2, "face": { "small": "SIDE TO CHANGE" } },
+        { "at": "2000", "show": "MEET", "rev": 3, "sounds": ["jingle"], "face": { "big": "HI :)", "small": "SIDE TO CHANGE", "light": "LIGHT_FULL" } },
+        { "at": "2600", "face": { "small": "SIDE TO CHANGE", "light": "LIGHT_FULL" } },
+        { "at": "3000", "press": 2, "face": { "big": "FIRST SONG?", "small": "SIDE: NEXT" } },
+        { "at": "3100+COMMIT_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }] },
+        { "at": "7000", "show": "MEET", "rev": 4, "with": { "armed": "song" }, "sounds": ["up"], "face": { "big": "", "field": "song", "light": "LIGHT_FULL" } },
+        { "at": "7000+500", "face": { "big": "27", "small": "SET", "light": "LIGHT_FULL" } },
+        { "at": "7000+RESULT_MS", "face": { "big": "27", "small": "MEET", "light": "LIGHT_FULL" } },
+        { "at": "7000+RESULT_MS+BLINK_MS", "face": { "big": "27", "light": "LIGHT_OFF" } },
+        { "at": "11000", "press": 1, "face": { "big": "27", "light": "LIGHT_FULL" } },
+        { "at": "11600", "face": { "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "NOT NOW from the phone ends a call and forgets its number; back from the wrist, the meeting still running calls after the SET",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "1000", "show": "QUIET", "rev": 4, "face": { "big": "", "light": "LIGHT_OFF" } },
+        { "at": "2000", "press": 2, "downSounds": [], "face": { "big": "NOT NOW", "small": "SIDE TO CHANGE" } },
+        { "at": "3000", "press": 2, "downSounds": [], "face": { "big": "HI :)", "small": "HOLD SIDE TO SHOW" } },
+        { "at": "4000", "key2": "down" },
+        { "at": "4000+HOLD_MS", "sent": [{ "t": "set", "intent": "hi", "basis": 4 }] },
+        { "at": "4000+HOLD_MS", "key2": "up" },
+        { "at": "6000", "show": "MEET", "rev": 5, "sounds": ["up"], "face": { "big": "", "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "6000+500", "sounds": ["jingle"], "face": { "big": "27", "small": "SET", "light": "LIGHT_FULL" } },
+        { "at": "6000+RESULT_MS", "face": { "big": "27", "small": "MEET", "light": "LIGHT_FULL" } },
+        { "at": "6000+RESULT_MS+BLINK_MS", "face": { "big": "27", "light": "LIGHT_OFF" } }
+      ]
+    },
+    {
+      "name": "a FACE hold into NOT NOW ends a call, even while the relay has not yet said so",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "key1": "down", "sounds": ["tick"] },
+        { "at": "1200", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "1000+HOLD_MS", "sent": [{ "t": "hold" }], "sounds": ["down"], "face": { "big": "", "light": "LIGHT_OFF" } },
+        { "at": "1000+HOLD_MS", "key1": "up" },
+        { "at": "2500+QUIET_CONFIRM_MS", "face": { "big": "27", "small": "MEET", "light": "LIGHT_FULL" } },
+        { "at": "6000", "face": { "big": "27", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "letters forget the meeting: paired again, the same number calls again",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "1000", "press": 1 },
+        { "at": "2000", "show": "PAIRING" },
+        { "at": "3000", "show": "CHECK", "sounds": ["ask"] },
+        { "at": "4000", "frame": { "t": "paired", "secret": "5ec2e75ec2e75ec2e75ec2e75ec2e75e" } },
+        { "at": "4000", "show": "TEST", "sounds": ["up"] },
+        { "at": "5000", "show": "MEET", "rev": 1, "sounds": ["jingle"], "face": { "big": "27", "light": "LIGHT_FULL" } },
+        { "at": "5000+BLINK_MS", "face": { "big": "27", "light": "LIGHT_OFF" } }
+      ]
     }
   ]
 }
````

New cases (8):

  - a meeting number calls; the first press answers it, and LOOK then replaces the number while it lasts
  - a meeting number plays jingle and blinks its face, 500 on and 500 off, until a key answers; that key only ticks, and holding it is no hold
  - the same number after a reconnect, or after the test light, does not call again; a show about the person that is not a meeting forgets it
  - a call ends when the band stops believing its show, and the same number does not call again when it is back
  - a call waits for a choice, and for the result on the face, to end; its jingle plays at once and the choice's presses keep working
  - NOT NOW from the phone ends a call and forgets its number; back from the wrist, the meeting still running calls after the SET
  - a FACE hold into NOT NOW ends a call, even while the relay has not yet said so
  - letters forget the meeting: paired again, the same number calls again

Cases replaced (1), now under a new name above:

  - LOOK replaces the meeting number while it lasts

- [ ] **Step 2: Run the table and watch it fail**

Expected: `ℹ pass 36`, `ℹ fail 59`. The first errors:

```text
firmware/host\logic_test.cpp:529:108: error: 'BLINK_MS' was not declared in this scope
AssertionError [ERR_ASSERTION]: a meeting number calls; the first press answers it, and LOOK then replaces the number while it lasts / 1000 frame {"t":"show","show":{"kind":"meet","intent":"song","big":"27","small":"MEET
AssertionError [ERR_ASSERTION]: the same number after a reconnect, or after the test light, does not call again; a show about the person that is not a meeting forgets it / 1000 frame {"t":"show","show":{"kind":"meet","in
AssertionError [ERR_ASSERTION]: a call ends when the band stops believing its show, and the same number does not call again when it is back / 1000 frame {"t":"show","show":{"kind":"meet","intent":"song","big":"27","small
AssertionError [ERR_ASSERTION]: a FACE hold into NOT NOW ends a call, even while the relay has not yet said so / 2200 frame {"t":"show","show":{"kind":"meet","intent":"song","big":"27","small":"MEET","dim":false,"armed":
```

Red (59):

- the wristband logic passes its own checks
- the wristband logic compiles as the band's compiler takes it: C++11, after Arduino's macros
- the colours on the wrist are the colours on the phone
- the firmware hashes as node:crypto does, and its id is its key's hash
- the code a wristband draws opens the app on its own four letters
- what the firmware says, the relay takes; what the relay says, the firmware reads as it was meant
- the firmware and the stand-in keep the same constants, by name
- the firmware and the stand-in play the same notes and the same flashes
- band_logic.h: the hello says v2 and carries the key, and the id is the key's hash
- band_logic.h: a paired wristband says its secret in every hello, and forgets it when it is shown letters
- band_logic.h: KEY1 let go at 1.0 s and 1.4 s is a press; at HOLD_MS it is NOT NOW, dark at once
- band_logic.h: held from BAR_MS, KEEP HOLDING and a bar; a dark face lights only to LIGHT_AWAKE, a card keeps its light
- band_logic.h: NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW
- band_logic.h: the first KEY2 press only looks; no second press within CHOOSE_MS and the look is dropped
- … and 45 more

- [ ] **Step 3: Implement in both twins.**

In `app/lib/wrist.js`:

````diff
--- a/app/lib/wrist.js
+++ b/app/lib/wrist.js
@@ -14,9 +14,10 @@
 // which state (`basis`), and shows SET, CHANGED or NOT SENT by what comes back.
 //
 // It also reacts, in sound and light (docs/superpowers/specs/
-// 2026-09-25-wrist-reactions-design.md). Each input is one moment, and its
-// reaction replaces the one playing. sounds() gives the names of the sounds
-// due to start since it was last asked.
+// 2026-09-25-wrist-reactions-design.md). Each input is one moment; a moment's
+// reactions play one after another, and a later moment's replace the one
+// playing. sounds() gives the names of the sounds due to start since it was
+// last asked.
 
 import { bandIdOf } from './sha256.js';
 
@@ -31,6 +32,7 @@ export const PING_EVERY_MS = 2000;     // ask the relay this often...
 export const DEAF_MS = 6000;           // ...and take this much silence as a dead socket
 export const STALE_MS = 10000;         // out of reach this long, what the relay last said is not shown
 export const QUIET_CONFIRM_MS = 3000;  // NOT NOW stays dark at least until the relay answers, or this long
+export const BLINK_MS = 500;           // a meeting that calls blinks: its face this long, then off this long
 
 export const LIGHT_FULL = 255;
 export const LIGHT_DIM = 128;
@@ -46,7 +48,7 @@ const LIT = ['hi', 'song', 'dance', 'meet'];
 /** Every constant above, by name: the fixtures' times are written in these. */
 export const CONSTS = {
   WAKE_MS, HOLD_MS, BAR_MS, CHOOSE_MS, COMMIT_MS, CONFIRM_MS, RESULT_MS, PING_EVERY_MS, DEAF_MS,
-  STALE_MS, QUIET_CONFIRM_MS, LIGHT_FULL, LIGHT_DIM, LIGHT_PAIR, LIGHT_AWAKE, LIGHT_OFF, CARD_WORDS,
+  STALE_MS, QUIET_CONFIRM_MS, BLINK_MS, LIGHT_FULL, LIGHT_DIM, LIGHT_PAIR, LIGHT_AWAKE, LIGHT_OFF, CARD_WORDS,
 };
 
 /** Every sound the wrist makes, as notes: [Hz, ms], 0 Hz a rest. band_logic.h SOUNDS is the same table. */
@@ -108,16 +110,23 @@ export function createWrist({ key }) {
   let choice = '';            // what was sent: a card, or '' for off
   let word = '';
   let out = [];
-  // Reactions (rule 6): this input's, and the one playing.
+  // Reactions (rule 6): this input's; the one playing; those waiting their turn.
   let moment = [];
   let playing = null;         // { sound, flash, colour, cls, audible, at, until }
+  let queue = [];
   let due = [];               // sounds started since sounds() was last asked
   let soundOn = true;         // the person's switch, as the last show that said it had it (rule 3)
   let silent = false;         // NOT NOW, for the sake of silence (rule 1)
+  // The meeting call (rule 4): the number last called for, whether it still calls, and since when.
+  let called = '';
+  let calling = false;
+  let callAt = 0;
 
   const send = (m) => out.push(JSON.stringify(m));
   const stale = (now) => !link.up && (!link.ever || now - link.lost >= STALE_MS);
   const personal = () => !!show && show.hasArmed;
+  // A call blinks on the resting face only: no look, choice, send or result on it.
+  const blinking = (now) => calling && mode === 'rest' && !stale(now) && show?.kind === 'meet';
   const current = () => (quiet.pending || show?.quiet ? 'notnow' : show?.armed || 'off');
   const pct = () => (battery >= 0 ? battery + '%' : '');
 
@@ -133,17 +142,23 @@ export function createWrist({ key }) {
     if (r.sound && r.audible) due.push(r.sound);
   }
 
-  /** The end of a moment: its reaction replaces the one playing. */
+  /** The end of a moment: its reactions go first, one after another, and what was already waiting plays after them. */
   function settle(now) {
     if (!moment.length) return;
-    const first = moment[0];
+    const mine = moment;
     moment = [];
-    start(first, now);
+    queue = [...mine.slice(1), ...queue];
+    start(mine[0], now);
   }
 
-  /** A reaction is over once its sound and its flash are. */
+  /** Each reaction starts when the one before it ends. */
   function advance(now) {
-    if (playing && now >= playing.until) playing = null;
+    while (playing && now >= playing.until) {
+      const next = queue.shift();
+      const at = playing.until;
+      playing = null;
+      if (next) start(next, at);
+    }
   }
 
   function noSignal() {
@@ -172,6 +187,7 @@ export function createWrist({ key }) {
     // Going into NOT NOW is the one sound it makes; a hold inside NOT NOW is silent.
     if (!silent) react('down');
     silent = true;
+    calling = false;  // NOT NOW ends a call
   }
 
   /** SET, CHANGED or NOT SENT on the face, with its sound and flash. In NOT NOW a failed try to come back is silent. */
@@ -231,6 +247,7 @@ export function createWrist({ key }) {
 
   function tick(now) {
     advance(now);
+    if (calling && stale(now)) calling = false;  // a show no longer believed calls no more
     if (link.up) {
       if (now - link.heard > DEAF_MS) { out.push('DROP'); closed(now); }
       else if (now - link.asked >= PING_EVERY_MS) { link.asked = now; send({ t: 'ping' }); }
@@ -259,6 +276,8 @@ export function createWrist({ key }) {
     s.since = now;
     s.fired = false;
     if (k === 1 && (mode === 'look' || mode === 'choosing')) frozen = true;
+    // The key that answers a call only answers: letting it go, or holding it, does nothing more.
+    if (blinking(now)) { calling = false; s.fired = true; }
     // Every press is heard as it goes down; NOT NOW is silent.
     if (!silent) react('tick');
     settle(now);
@@ -324,8 +343,11 @@ export function createWrist({ key }) {
     // A show's own switch counts for what it causes. One that is not true or false is not said.
     if (typeof m.show.sound === 'boolean') soundOn = m.show.sound;
     if (show.kind === 'pairing') {
+      // The band is nobody's: NOT NOW is over, and no meeting is anyone's.
       secret = '';
-      silent = false;                                     // the band is nobody's: NOT NOW is over
+      silent = false;
+      called = '';
+      calling = false;
       if (was?.kind === 'check') react('fall', null, 1);  // the check ended without YES
       soundOn = true;                                     // after the letters' own reactions
     }
@@ -334,6 +356,8 @@ export function createWrist({ key }) {
     if (personal()) {
       if (show.quiet) silent = true;
       else if (!quiet.pending) silent = false;
+      // A show about the person that is not a meeting ends a call and forgets its number.
+      if (show.kind !== 'meet') { called = ''; calling = false; }
     }
     if (mode === 'look' || mode === 'choosing') {
       if (!personal() || show.rev !== basis) rest();
@@ -343,6 +367,13 @@ export function createWrist({ key }) {
     if (same || silent) return;
     if (show.kind === 'check') react('ask', 'check', 1);
     else if (show.kind === 'test') react('up', null, 1);  // paired, or TEST THE LIGHT: the white face is its flash
+    else if (show.kind === 'meet' && show.big !== called) {
+      // A number not yet called for calls until it is answered (rule 4).
+      react('jingle', null, 1);
+      called = show.big;
+      calling = true;
+      callAt = now;
+    }
   }
 
   /** The face at rest: band_logic.h faceFor(), wordsFor() and lightFor(), in that order. */
@@ -394,6 +425,8 @@ export function createWrist({ key }) {
     if (k1.down && !k1.fired && now - k1.since >= BAR_MS) {
       f = { ...f, small: 'KEEP HOLDING', bar: Math.min(99, Math.floor(((now - k1.since) * 100) / HOLD_MS)), light: Math.max(f.light, LIGHT_AWAKE) };
     }
+    // A call blinks: the meeting face as it is, then off. A flash, while it lasts, is drawn over it.
+    if (blinking(now) && (now - callAt) % (2 * BLINK_MS) >= BLINK_MS) f = { ...f, light: LIGHT_OFF };
     return flashOver(f, now);
   }
 
````

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -40,6 +40,7 @@ constexpr uint32_t DEAF_MS = 6000;            // ...and take this much silence a
 constexpr uint32_t RETRY_MS = 1500;           // between tries to reach the relay
 constexpr uint32_t STALE_MS = 10000;          // out of reach this long, what the relay last said is not shown
 constexpr uint32_t QUIET_CONFIRM_MS = 3000;   // NOT NOW from the wrist stays dark at least until the relay answers, or this long
+constexpr uint32_t BLINK_MS = 500;            // a meeting that calls blinks: its face this long, then off this long
 constexpr uint32_t BATTERY_EVERY_MS = 30000;  // at most one battery report this often
 constexpr uint32_t BATTERY_DRIFT_MS = 300000; // a one-point change is only worth a report after this long
 constexpr uint32_t REJOIN_MS = 15000;         // without Wi-Fi this long, the radio is asked to join again
@@ -1071,6 +1072,11 @@ class Wrist {
     s.fired = false;
     // Any KEY1 press-down freezes a choice at once: no commit can fire.
     if (k == 1 && (mode_ == LOOK || mode_ == CHOOSING)) frozen_ = true;
+    // The key that answers a call only answers: letting it go, or holding it, does nothing more.
+    if (blinking(now)) {
+      calling_ = false;
+      s.fired = true;
+    }
     // Every press is heard as it goes down; NOT NOW is silent.
     if (!silent_) react("tick");
     settle(now);
@@ -1143,8 +1149,11 @@ class Wrist {
     // A show's own switch counts for what it causes.
     if (f.sound >= 0) soundOn_ = f.sound == 1;
     if (show_.kind == "pairing") {
-      secret_.clear();                            // unpaired, or nobody came for it: a new pairing
-      silent_ = false;                            // the band is nobody's: NOT NOW is over
+      // Unpaired, or nobody came for it: the band is nobody's, so NOT NOW is over and no meeting is anyone's.
+      secret_.clear();
+      silent_ = false;
+      called_.clear();
+      calling_ = false;
       if (wasCheck) react("fall", nullptr, 1);    // the check ended without YES
       soundOn_ = true;                            // after the letters' own reactions
     }
@@ -1153,6 +1162,11 @@ class Wrist {
     if (personal()) {
       if (show_.quiet) silent_ = true;
       else if (!quiet_.dark()) silent_ = false;
+      // A show about the person that is not a meeting ends a call and forgets its number.
+      if (show_.kind != "meet") {
+        called_.clear();
+        calling_ = false;
+      }
     }
     if (mode_ == LOOK || mode_ == CHOOSING) {
       // A show not about the person, or one whose rev moved, cancels the choice.
@@ -1161,11 +1175,21 @@ class Wrist {
       result(now, "SET");
     }
     if (same || silent_) return;
-    if (show_.kind == "check") react("ask", "check", 1);
-    else if (show_.kind == "test") react("up", nullptr, 1);  // paired, or TEST THE LIGHT: the white face is its flash
+    if (show_.kind == "check") {
+      react("ask", "check", 1);
+    } else if (show_.kind == "test") {
+      react("up", nullptr, 1);  // paired, or TEST THE LIGHT: the white face is its flash
+    } else if (show_.kind == "meet" && show_.big != called_) {
+      // A number not yet called for calls until it is answered (rule 4).
+      react("jingle", nullptr, 1);
+      called_ = show_.big;
+      calling_ = true;
+      callAt_ = now;
+    }
   }
 
   void ticked(uint32_t now) {
+    if (calling_ && link_.stale(now)) calling_ = false;  // a show no longer believed calls no more
     switch (link_.tick(now)) {
       case Link::DROP:
         out_.push_back("DROP");
@@ -1231,6 +1255,8 @@ class Wrist {
       f.bar = std::min<int>(99, static_cast<int>((now - k1_.since) * 100 / HOLD_MS));
       if (f.light < LIGHT_AWAKE) f.light = LIGHT_AWAKE;
     }
+    // A call blinks: the meeting face as it is, then off. A flash, while it lasts, is drawn over it.
+    if (blinking(now) && (now - callAt_) % (2 * BLINK_MS) >= BLINK_MS) f.light = LIGHT_OFF;
     return flashOver(f, now);
   }
 
@@ -1288,17 +1314,28 @@ class Wrist {
     if (r.sound && r.audible) due_.push_back(r.sound);
   }
 
-  /** The end of a moment: its reaction replaces the one playing. */
+  /** The end of a moment: its reactions go first, one after another, and what was already waiting plays after them. */
   void settle(uint32_t now) {
     if (moment_.empty()) return;
+    std::vector<Reaction> next(moment_.begin() + 1, moment_.end());
+    next.insert(next.end(), queue_.begin(), queue_.end());
+    queue_.swap(next);
     const Reaction first = moment_.front();
     moment_.clear();
     start(first, now);
   }
 
-  /** A reaction is over once its sound and its flash are. */
+  /** Each reaction starts when the one before it ends. */
   void advance(uint32_t now) {
-    if (playingOn_ && static_cast<int32_t>(now - playing_.until) >= 0) playingOn_ = false;
+    while (playingOn_ && static_cast<int32_t>(now - playing_.until) >= 0) {
+      const uint32_t at = playing_.until;
+      playingOn_ = false;
+      if (!queue_.empty()) {
+        const Reaction next = queue_.front();
+        queue_.erase(queue_.begin());
+        start(next, at);
+      }
+    }
   }
 
   static Screen words(const std::string& big, const std::string& small, const std::string& field, const std::string& ink,
@@ -1314,6 +1351,11 @@ class Wrist {
 
   bool personal() const { return haveShow_ && show_.hasArmed; }
 
+  /** A call blinks on the resting face only: no look, choice, send or result on it. */
+  bool blinking(uint32_t now) const {
+    return calling_ && mode_ == REST && !link_.stale(now) && haveShow_ && show_.kind == "meet";
+  }
+
   /** NOT NOW (a hold not yet shown, or the relay's quiet), else what is armed, else "off". */
   std::string current() const {
     if (quiet_.dark() || (haveShow_ && show_.quiet)) return "notnow";
@@ -1362,6 +1404,7 @@ class Wrist {
     // Going into NOT NOW is the one sound it makes; a hold inside NOT NOW is silent.
     if (!silent_) react("down");
     silent_ = true;
+    calling_ = false;  // NOT NOW ends a call
   }
 
   /** SET, CHANGED or NOT SENT on the face, with its sound and flash. In NOT NOW a failed try to come back is silent. */
@@ -1448,13 +1491,17 @@ class Wrist {
   uint32_t wakeUntil_ = 0, stepAt_ = 0, sentAt_ = 0, resultUntil_ = 0;
   int64_t basis_ = 0;
   std::vector<std::string> out_;
-  // Reactions (rule 6): this input's, and the one playing.
-  std::vector<Reaction> moment_;
+  // Reactions (rule 6): this input's; the one playing; those waiting their turn.
+  std::vector<Reaction> moment_, queue_;
   Reaction playing_;
   bool playingOn_ = false;
   std::vector<std::string> due_;
   bool soundOn_ = true;  // the person's switch, as the last show that said it had it (rule 3)
   bool silent_ = false;  // NOT NOW, for the sake of silence (rule 1)
+  // The meeting call (rule 4): the number last called for, whether it still calls, and since when.
+  std::string called_;
+  bool calling_ = false;
+  uint32_t callAt_ = 0;
 };
 
 // ---------- the serial console ----------
````

- [ ] **Step 4: Run** — the table, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 233`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "the answering key does more than answer",
  "file": "app/lib/wrist.js",
  "from": "    if (blinking(now)) { calling = false; s.fired = true; }\n",
  "to": "    if (blinking(now)) { calling = false; }\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a meeting number calls; the first press answers it, and LOOK then replaces the number while it lasts",
   "wrist.js: a meeting number plays jingle and blinks its face, 500 on and 500 off, until a key answers; that key only ticks, and holding it is no hold"
  ]
 },
 {
  "label": "a key does not answer the call",
  "file": "app/lib/wrist.js",
  "from": "    if (blinking(now)) { calling = false; s.fired = true; }\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a meeting number calls; the first press answers it, and LOOK then replaces the number while it lasts",
   "wrist.js: a meeting number plays jingle and blinks its face, 500 on and 500 off, until a key answers; that key only ticks, and holding it is no hold",
   "wrist.js: a call waits for a choice, and for the result on the face, to end; its jingle plays at once and the choice's presses keep working"
  ]
 },
 {
  "label": "the same number calls again",
  "file": "app/lib/wrist.js",
  "from": "    else if (show.kind === 'meet' && show.big !== called) {\n",
  "to": "    else if (show.kind === 'meet') {\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the same number after a reconnect, or after the test light, does not call again; a show about the person that is not a meeting forgets it",
   "wrist.js: a call ends when the band stops believing its show, and the same number does not call again when it is back",
   "wrist.js: a call waits for a choice, and for the result on the face, to end; its jingle plays at once and the choice's presses keep working"
  ]
 },
 {
  "label": "a show about the person that is not a meeting forgets nothing",
  "file": "app/lib/wrist.js",
  "from": "      if (show.kind !== 'meet') { called = ''; calling = false; }\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the same number after a reconnect, or after the test light, does not call again; a show about the person that is not a meeting forgets it",
   "wrist.js: NOT NOW from the phone ends a call and forgets its number; back from the wrist, the meeting still running calls after the SET"
  ]
 },
 {
  "label": "a show no longer believed keeps calling",
  "file": "app/lib/wrist.js",
  "from": "    if (calling && stale(now)) calling = false;  // a show no longer believed calls no more\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a call ends when the band stops believing its show, and the same number does not call again when it is back"
  ]
 },
 {
  "label": "a FACE hold into NOT NOW leaves the call",
  "file": "app/lib/wrist.js",
  "from": "    calling = false;  // NOT NOW ends a call\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a FACE hold into NOT NOW ends a call, even while the relay has not yet said so"
  ]
 },
 {
  "label": "the blink does not wait for a choice or a result",
  "file": "app/lib/wrist.js",
  "from": "  const blinking = (now) => calling && mode === 'rest' && !stale(now) && show?.kind === 'meet';\n",
  "to": "  const blinking = (now) => calling && !stale(now) && show?.kind === 'meet';\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a call waits for a choice, and for the result on the face, to end; its jingle plays at once and the choice's presses keep working",
   "wrist.js: NOT NOW from the phone ends a call and forgets its number; back from the wrist, the meeting still running calls after the SET"
  ]
 },
 {
  "label": "letters keep the meeting's number",
  "file": "app/lib/wrist.js",
  "from": "      called = '';\n      calling = false;\n      if (was?.kind === 'check')",
  "to": "      if (was?.kind === 'check')",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: letters forget the meeting: paired again, the same number calls again"
  ]
 },
 {
  "label": "the blink never goes off",
  "file": "app/lib/wrist.js",
  "from": "    if (blinking(now) && (now - callAt) % (2 * BLINK_MS) >= BLINK_MS) f = { ...f, light: LIGHT_OFF };\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a meeting number plays jingle and blinks its face, 500 on and 500 off, until a key answers; that key only ticks, and holding it is no hold",
   "wrist.js: the same number after a reconnect, or after the test light, does not call again; a show about the person that is not a meeting forgets it",
   "wrist.js: a call ends when the band stops believing its show, and the same number does not call again when it is back",
   "wrist.js: a call waits for a choice, and for the result on the face, to end; its jingle plays at once and the choice's presses keep working",
   "wrist.js: NOT NOW from the phone ends a call and forgets its number; back from the wrist, the meeting still running calls after the SET",
   "wrist.js: letters forget the meeting: paired again, the same number calls again"
  ]
 },
 {
  "label": "C++: the answering key does more than answer",
  "file": "firmware/src/band_logic.h",
  "from": "      calling_ = false;\n      s.fired = true;\n",
  "to": "      calling_ = false;\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a meeting number calls; the first press answers it, and LOOK then replaces the number while it lasts",
   "band_logic.h: a meeting number plays jingle and blinks its face, 500 on and 500 off, until a key answers; that key only ticks, and holding it is no hold"
  ]
 },
 {
  "label": "C++: the same number calls again",
  "file": "firmware/src/band_logic.h",
  "from": "    } else if (show_.kind == \"meet\" && show_.big != called_) {\n",
  "to": "    } else if (show_.kind == \"meet\") {\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: the same number after a reconnect, or after the test light, does not call again; a show about the person that is not a meeting forgets it",
   "band_logic.h: a call ends when the band stops believing its show, and the same number does not call again when it is back",
   "band_logic.h: a call waits for a choice, and for the result on the face, to end; its jingle plays at once and the choice's presses keep working"
  ]
 },
 {
  "label": "C++: a show about the person that is not a meeting forgets nothing",
  "file": "firmware/src/band_logic.h",
  "from": "      if (show_.kind != \"meet\") {\n        called_.clear();\n        calling_ = false;\n      }\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: the same number after a reconnect, or after the test light, does not call again; a show about the person that is not a meeting forgets it",
   "band_logic.h: NOT NOW from the phone ends a call and forgets its number; back from the wrist, the meeting still running calls after the SET"
  ]
 },
 {
  "label": "C++: a show no longer believed keeps calling",
  "file": "firmware/src/band_logic.h",
  "from": "    if (calling_ && link_.stale(now)) calling_ = false;  // a show no longer believed calls no more\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a call ends when the band stops believing its show, and the same number does not call again when it is back"
  ]
 },
 {
  "label": "C++: a FACE hold into NOT NOW leaves the call",
  "file": "firmware/src/band_logic.h",
  "from": "    calling_ = false;  // NOT NOW ends a call\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a FACE hold into NOT NOW ends a call, even while the relay has not yet said so"
  ]
 },
 {
  "label": "C++: letters keep the meeting's number",
  "file": "firmware/src/band_logic.h",
  "from": "      called_.clear();\n      calling_ = false;\n      if (wasCheck)",
  "to": "      if (wasCheck)",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: letters forget the meeting: paired again, the same number calls again"
  ]
 },
 {
  "label": "a queued reaction never plays",
  "file": "app/lib/wrist.js",
  "from": "      if (next) start(next, at);\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: NOT NOW from the phone ends a call and forgets its number; back from the wrist, the meeting still running calls after the SET"
  ]
 },
 {
  "label": "C++: a queued reaction never plays (compiling form)",
  "file": "firmware/src/band_logic.h",
  "from": "        start(next, at);\n",
  "to": "        (void)next;\n        (void)at;\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: NOT NOW from the phone ends a call and forgets its number; back from the wrist, the meeting still running calls after the SET"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add app/lib/wrist.js firmware/src/band_logic.h firmware/host/logic_test.cpp tests/fixtures/wrist-cases.json
```

````bash
git commit -F - <<'EOF'
Call a meeting number on the wrist until it is answered

A number the wrist has not called for plays jingle, and the resting face
blinks: the meeting face, then off, BLINK_MS each. The first key down on the
blinking face answers: it ticks and does nothing more, and holding it is no
hold. The call ends at the answer, at NOT NOW, when the show is no longer
believed, and at a show about the person that is not a meeting, which also
forgets the number; letters forget it too. The same number after a reconnect
or the test light does not call again. A call that comes during a choice or a
result plays its jingle at once and blinks once the face rests.

A moment can now have more than one reaction: they queue, and each starts
when the one before it ends. So a meeting still running when the wearer
comes back from NOT NOW calls after that moment's SET.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 5: The letters and the waiting face sleep; a press says where to pair (rule 5)

**Files:**
- Modify: `app/lib/wrist.js`, `firmware/src/band_logic.h`
- Test: `firmware/host/logic_test.cpp` (the constants), `tests/fixtures/wrist-cases.json`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `HINT_MS = 3000`, `PAIR_AWAKE_MS = 120000` in both twins, `CONSTS` and the host; state `litUntil`, `pairCode`, `waitAt`, `hintUntil`; `pairingFace(now)` (believed, no hold pending, and a pairing or check show) and `wake(now)`, which also lights a waiting face. New letters (a code not seen before) and the start of waiting light the face until `litUntil`. On the letters or the check a key ticks, sets `hintUntil`, lights the letters again, and does nothing more. `restFace` lays the hint over the face's small line (`PAIR ON YOUR PHONE`) and turns the light off once `litUntil` has passed; the picture stays.

- [ ] **Step 1: Write the failing cases, and the constants on the host.**

In `firmware/host/logic_test.cpp`:

````diff
--- a/firmware/host/logic_test.cpp
+++ b/firmware/host/logic_test.cpp
@@ -527,6 +527,7 @@ std::string answer(const Command& c) {
            ",\"RESULT_MS\":" + std::to_string(RESULT_MS) + ",\"PING_EVERY_MS\":" + std::to_string(PING_EVERY_MS) +
            ",\"DEAF_MS\":" + std::to_string(DEAF_MS) + ",\"STALE_MS\":" + std::to_string(STALE_MS) +
            ",\"QUIET_CONFIRM_MS\":" + std::to_string(QUIET_CONFIRM_MS) + ",\"BLINK_MS\":" + std::to_string(BLINK_MS) +
+           ",\"HINT_MS\":" + std::to_string(HINT_MS) + ",\"PAIR_AWAKE_MS\":" + std::to_string(PAIR_AWAKE_MS) +
            ",\"LIGHT_FULL\":" + std::to_string(LIGHT_FULL) +
            ",\"LIGHT_DIM\":" + std::to_string(LIGHT_DIM) + ",\"LIGHT_PAIR\":" + std::to_string(LIGHT_PAIR) +
            ",\"LIGHT_AWAKE\":" + std::to_string(LIGHT_AWAKE) + ",\"LIGHT_OFF\":" + std::to_string(LIGHT_OFF) +
````

In `tests/fixtures/wrist-cases.json`:

````diff
--- a/tests/fixtures/wrist-cases.json
+++ b/tests/fixtures/wrist-cases.json
@@ -269,15 +269,15 @@
       ]
     },
     {
-      "name": "the check, waiting for its owner, and not in a room; KEY2 on them only wakes",
+      "name": "the check, waiting for its owner, and not in a room; KEY2 on the check says where to go, on the others only wakes",
       "steps": [
         { "at": "0", "battery": 62 },
         { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
         { "at": "0", "show": "CHECK", "sounds": ["ask"], "face": { "big": "", "field": "white", "light": "LIGHT_FULL" } },
         { "at": "500", "face": { "big": "27", "small": "ON YOUR PHONE?", "field": "black", "ink": "white", "light": "LIGHT_PAIR" } },
-        { "at": "1000", "press": 2, "face": { "big": "27", "small": "ON YOUR PHONE?" } },
+        { "at": "1000", "press": 2, "face": { "big": "27", "small": "PAIR ON YOUR PHONE" } },
         { "at": "2000", "show": "WAITING", "face": { "big": "OPEN YOUR PHONE", "small": "OR SWITCH ME OFF", "light": "LIGHT_AWAKE" } },
-        { "at": "3000", "show": "AWAY", "face": { "big": "OPEN YOUR PHONE", "small": "TO COME BACK", "light": "LIGHT_AWAKE" } },
+        { "at": "3000", "show": "AWAY", "face": { "big": "", "light": "LIGHT_OFF" } },
         { "at": "10000", "face": { "big": "", "light": "LIGHT_OFF" } },
         { "at": "11000", "press": 1, "face": { "big": "OPEN YOUR PHONE", "small": "TO COME BACK", "light": "LIGHT_AWAKE" } },
         { "at": "12000", "press": 2, "face": { "small": "TO COME BACK" } },
@@ -635,6 +635,58 @@
         { "at": "5000", "show": "MEET", "rev": 1, "sounds": ["jingle"], "face": { "big": "27", "light": "LIGHT_FULL" } },
         { "at": "5000+BLINK_MS", "face": { "big": "27", "light": "LIGHT_OFF" } }
       ]
+    },
+    {
+      "name": "new letters light for PAIR_AWAKE_MS, then go dark; a press of either key lights them again from the press and says PAIR ON YOUR PHONE for HINT_MS; a hold there is no hold",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "PAIRING", "face": { "big": "KXRT", "small": "", "code": "KXRT", "light": "LIGHT_PAIR" } },
+        { "at": "PAIR_AWAKE_MS-1", "face": { "light": "LIGHT_PAIR" } },
+        { "at": "PAIR_AWAKE_MS", "face": { "big": "KXRT", "code": "KXRT", "light": "LIGHT_OFF" } },
+        { "at": "200000", "key1": "down", "sounds": ["tick"], "face": { "big": "KXRT", "small": "PAIR ON YOUR PHONE", "light": "LIGHT_PAIR" } },
+        { "at": "200000+BAR_MS", "face": { "small": "PAIR ON YOUR PHONE", "bar": -1 } },
+        { "at": "200000+HOLD_MS", "face": { "small": "PAIR ON YOUR PHONE", "light": "LIGHT_PAIR" } },
+        { "at": "200000+HINT_MS", "key1": "up", "face": { "big": "KXRT", "small": "", "light": "LIGHT_PAIR" } },
+        { "at": "200000+PAIR_AWAKE_MS-1", "face": { "light": "LIGHT_PAIR" } },
+        { "at": "200000+PAIR_AWAKE_MS", "face": { "light": "LIGHT_OFF" } },
+        { "at": "330000", "link": "down" },
+        { "at": "330000+STALE_MS+5000", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "330000+STALE_MS+5100", "show": "PAIRING", "face": { "big": "KXRT", "light": "LIGHT_OFF" } },
+        { "at": "400000", "press": 2, "face": { "big": "KXRT", "small": "PAIR ON YOUR PHONE", "light": "LIGHT_PAIR" } },
+        { "at": "400000+HINT_MS", "face": { "small": "", "light": "LIGHT_PAIR" } }
+      ]
+    },
+    {
+      "name": "the check stays lit; a press there says PAIR ON YOUR PHONE in place of ON YOUR PHONE? and a hold does nothing; the letters after it light, even with the same code",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "PAIRING" },
+        { "at": "1000", "show": "CHECK", "sounds": ["ask"] },
+        { "at": "1000+PAIR_AWAKE_MS", "face": { "big": "27", "small": "ON YOUR PHONE?", "light": "LIGHT_PAIR" } },
+        { "at": "130000", "key2": "down", "sounds": ["tick"], "face": { "big": "27", "small": "PAIR ON YOUR PHONE", "light": "LIGHT_PAIR" } },
+        { "at": "130000+HOLD_MS", "face": { "big": "27", "small": "PAIR ON YOUR PHONE" } },
+        { "at": "130000+HOLD_MS", "key2": "up", "face": { "small": "PAIR ON YOUR PHONE" } },
+        { "at": "130000+HINT_MS", "face": { "big": "27", "small": "ON YOUR PHONE?" } },
+        { "at": "140000", "show": "PAIRING", "sounds": ["fall"], "face": { "big": "KXRT", "small": "", "light": "LIGHT_PAIR" } }
+      ]
+    },
+    {
+      "name": "the waiting face lights for PAIR_AWAKE_MS when it starts and again after a press; its keys work as today",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 1 },
+        { "at": "1000", "show": "WAITING", "face": { "big": "OPEN YOUR PHONE", "light": "LIGHT_AWAKE" } },
+        { "at": "1000+PAIR_AWAKE_MS-1", "face": { "light": "LIGHT_AWAKE" } },
+        { "at": "1000+PAIR_AWAKE_MS", "face": { "big": "OPEN YOUR PHONE", "light": "LIGHT_OFF" } },
+        { "at": "130000", "show": "WAITING", "face": { "light": "LIGHT_OFF" } },
+        { "at": "140000", "press": 2, "face": { "big": "OPEN YOUR PHONE", "small": "OR SWITCH ME OFF", "light": "LIGHT_AWAKE" } },
+        { "at": "140100+PAIR_AWAKE_MS-1", "face": { "light": "LIGHT_AWAKE" } },
+        { "at": "140100+PAIR_AWAKE_MS", "face": { "light": "LIGHT_OFF" } },
+        { "at": "270000", "key1": "down", "sounds": ["tick"] },
+        { "at": "270000+BAR_MS", "face": { "small": "KEEP HOLDING", "light": "LIGHT_AWAKE" } },
+        { "at": "270000+HOLD_MS", "sent": [{ "t": "hold" }], "sounds": ["down"], "face": { "light": "LIGHT_OFF" } },
+        { "at": "270000+HOLD_MS", "key1": "up" }
+      ]
     }
   ]
 }
````

New cases (4):

  - the check, waiting for its owner, and not in a room; KEY2 on the check says where to go, on the others only wakes
  - new letters light for PAIR_AWAKE_MS, then go dark; a press of either key lights them again from the press and says PAIR ON YOUR PHONE for HINT_MS; a hold there is no hold
  - the check stays lit; a press there says PAIR ON YOUR PHONE in place of ON YOUR PHONE? and a hold does nothing; the letters after it light, even with the same code
  - the waiting face lights for PAIR_AWAKE_MS when it starts and again after a press; its keys work as today

Cases replaced (1), now under a new name above:

  - the check, waiting for its owner, and not in a room; KEY2 on them only wakes

- [ ] **Step 2: Run the table and watch it fail**

Expected: `ℹ pass 43`, `ℹ fail 58`. The first errors:

```text
firmware/host\logic_test.cpp:530:45: error: 'HINT_MS' was not declared in this scope
firmware/host\logic_test.cpp:530:95: error: 'PAIR_AWAKE_MS' was not declared in this scope
AssertionError [ERR_ASSERTION]: the check, waiting for its owner, and not in a room; KEY2 on the check says where to go, on the others only wakes / 2100 key2 up: face.small {"big":"27","small":"ON YOUR PHONE?","light":16
```

Red (58):

- the wristband logic passes its own checks
- the wristband logic compiles as the band's compiler takes it: C++11, after Arduino's macros
- the colours on the wrist are the colours on the phone
- the firmware hashes as node:crypto does, and its id is its key's hash
- the code a wristband draws opens the app on its own four letters
- what the firmware says, the relay takes; what the relay says, the firmware reads as it was meant
- the firmware and the stand-in keep the same constants, by name
- the firmware and the stand-in play the same notes and the same flashes
- band_logic.h: the hello says v2 and carries the key, and the id is the key's hash
- band_logic.h: a paired wristband says its secret in every hello, and forgets it when it is shown letters
- band_logic.h: KEY1 let go at 1.0 s and 1.4 s is a press; at HOLD_MS it is NOT NOW, dark at once
- band_logic.h: held from BAR_MS, KEEP HOLDING and a bar; a dark face lights only to LIGHT_AWAKE, a card keeps its light
- band_logic.h: NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW
- band_logic.h: the first KEY2 press only looks; no second press within CHOOSE_MS and the look is dropped
- … and 44 more

- [ ] **Step 3: Implement in both twins.**

In `app/lib/wrist.js`:

````diff
--- a/app/lib/wrist.js
+++ b/app/lib/wrist.js
@@ -33,6 +33,8 @@ export const DEAF_MS = 6000;           // ...and take this much silence as a dea
 export const STALE_MS = 10000;         // out of reach this long, what the relay last said is not shown
 export const QUIET_CONFIRM_MS = 3000;  // NOT NOW stays dark at least until the relay answers, or this long
 export const BLINK_MS = 500;           // a meeting that calls blinks: its face this long, then off this long
+export const HINT_MS = 3000;           // a press on the letters or the check says PAIR ON YOUR PHONE this long
+export const PAIR_AWAKE_MS = 120000;   // new letters, or the waiting face, stay lit this long; so does a press on them
 
 export const LIGHT_FULL = 255;
 export const LIGHT_DIM = 128;
@@ -48,7 +50,7 @@ const LIT = ['hi', 'song', 'dance', 'meet'];
 /** Every constant above, by name: the fixtures' times are written in these. */
 export const CONSTS = {
   WAKE_MS, HOLD_MS, BAR_MS, CHOOSE_MS, COMMIT_MS, CONFIRM_MS, RESULT_MS, PING_EVERY_MS, DEAF_MS,
-  STALE_MS, QUIET_CONFIRM_MS, BLINK_MS, LIGHT_FULL, LIGHT_DIM, LIGHT_PAIR, LIGHT_AWAKE, LIGHT_OFF, CARD_WORDS,
+  STALE_MS, QUIET_CONFIRM_MS, BLINK_MS, HINT_MS, PAIR_AWAKE_MS, LIGHT_FULL, LIGHT_DIM, LIGHT_PAIR, LIGHT_AWAKE, LIGHT_OFF, CARD_WORDS,
 };
 
 /** Every sound the wrist makes, as notes: [Hz, ms], 0 Hz a rest. band_logic.h SOUNDS is the same table. */
@@ -121,12 +123,20 @@ export function createWrist({ key }) {
   let called = '';
   let calling = false;
   let callAt = 0;
+  // Rule 5: the letters and the waiting face sleep. Until when they are lit, which letters lit them, when
+  // waiting began, and until when a press says where to go.
+  let litUntil = 0;
+  let pairCode = '';
+  let waitAt = null;
+  let hintUntil = 0;
 
   const send = (m) => out.push(JSON.stringify(m));
   const stale = (now) => !link.up && (!link.ever || now - link.lost >= STALE_MS);
   const personal = () => !!show && show.hasArmed;
   // A call blinks on the resting face only: no look, choice, send or result on it.
   const blinking = (now) => calling && mode === 'rest' && !stale(now) && show?.kind === 'meet';
+  // The letters or the check on the face: the band is nobody's yet, and a key only says where to go.
+  const pairingFace = (now) => !stale(now) && !quiet.pending && (show?.kind === 'pairing' || show?.kind === 'check');
   const current = () => (quiet.pending || show?.quiet ? 'notnow' : show?.armed || 'off');
   const pct = () => (battery >= 0 ? battery + '%' : '');
 
@@ -166,6 +176,12 @@ export function createWrist({ key }) {
     return words('NO SIGNAL', pct() ? why + ' - ' + pct() : why, 'black', 'text2', LIGHT_AWAKE);
   }
 
+  /** A press shows the face for WAKE_MS; the waiting face, which sleeps, stays lit PAIR_AWAKE_MS from it. */
+  function wake(now) {
+    wakeUntil = now + WAKE_MS;
+    if (show?.kind === 'waiting') litUntil = now + PAIR_AWAKE_MS;
+  }
+
   function rest() {
     mode = 'rest';
     frozen = false;
@@ -218,7 +234,7 @@ export function createWrist({ key }) {
     if (k1.down || frozen || mode === 'sending') return;
     if (mode === 'result') rest();
     if (mode === 'rest') {
-      wakeUntil = now + WAKE_MS;
+      wake(now);
       if (!personal()) return;
       mode = 'look';
       stepAt = now;
@@ -278,6 +294,12 @@ export function createWrist({ key }) {
     if (k === 1 && (mode === 'look' || mode === 'choosing')) frozen = true;
     // The key that answers a call only answers: letting it go, or holding it, does nothing more.
     if (blinking(now)) { calling = false; s.fired = true; }
+    // On the letters or the check a key says where to go, and lights the letters again; nothing more.
+    else if (pairingFace(now)) {
+      s.fired = true;
+      hintUntil = now + HINT_MS;
+      if (show.kind === 'pairing') litUntil = now + PAIR_AWAKE_MS;
+    }
     // Every press is heard as it goes down; NOT NOW is silent.
     if (!silent) react('tick');
     settle(now);
@@ -292,7 +314,7 @@ export function createWrist({ key }) {
       if (k === 2) step(now);
       else {
         if (frozen) rest();
-        wakeUntil = now + WAKE_MS;
+        wake(now);
       }
     }
     settle(now);
@@ -350,7 +372,12 @@ export function createWrist({ key }) {
       calling = false;
       if (was?.kind === 'check') react('fall', null, 1);  // the check ended without YES
       soundOn = true;                                     // after the letters' own reactions
-    }
+      // New letters light for PAIR_AWAKE_MS; the same letters again (a reconnect) do not.
+      if (show.code !== pairCode) { pairCode = show.code; litUntil = now + PAIR_AWAKE_MS; }
+    } else pairCode = '';
+    // The waiting face lights when waiting starts. Losing the relay does not end it.
+    if (show.kind !== 'waiting') waitAt = null;
+    else if (waitAt === null) { waitAt = now; litUntil = now + PAIR_AWAKE_MS; }
     if (quiet.pending && quiet.sent && !lit(show)) quiet.pending = false;
     // NOT NOW's silence starts and ends only with a show about the person (rule 1).
     if (personal()) {
@@ -393,10 +420,14 @@ export function createWrist({ key }) {
       else if (s.away) { big = 'OPEN YOUR PHONE'; small = 'TO COME BACK'; }
       else { big = 'READY'; small = pct(); }
     }
-    const light = s.kind === 'test' ? LIGHT_FULL
+    let light = s.kind === 'test' ? LIGHT_FULL
       : lit(s) ? (s.dim ? LIGHT_DIM : LIGHT_FULL)
       : s.kind === 'pairing' || s.kind === 'check' ? LIGHT_PAIR
       : s.kind === 'waiting' || awake ? LIGHT_AWAKE : LIGHT_OFF;
+    // Rule 5, over what the relay says: a press on the letters or the check says where to go, and the
+    // letters and the waiting face sleep. Asleep, only the light goes: the picture stays for the next press.
+    if ((s.kind === 'pairing' || s.kind === 'check') && hintUntil > now) small = 'PAIR ON YOUR PHONE';
+    if ((s.kind === 'pairing' || s.kind === 'waiting') && now >= litUntil) light = LIGHT_OFF;
     return {
       big, small, light, bar: -1,
       field: s.kind === 'test' ? 'white' : lit(s) ? s.intent : 'black',
````

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -41,6 +41,8 @@ constexpr uint32_t RETRY_MS = 1500;           // between tries to reach the rela
 constexpr uint32_t STALE_MS = 10000;          // out of reach this long, what the relay last said is not shown
 constexpr uint32_t QUIET_CONFIRM_MS = 3000;   // NOT NOW from the wrist stays dark at least until the relay answers, or this long
 constexpr uint32_t BLINK_MS = 500;            // a meeting that calls blinks: its face this long, then off this long
+constexpr uint32_t HINT_MS = 3000;            // a press on the letters or the check says PAIR ON YOUR PHONE this long
+constexpr uint32_t PAIR_AWAKE_MS = 120000;    // new letters, or the waiting face, stay lit this long; so does a press on them
 constexpr uint32_t BATTERY_EVERY_MS = 30000;  // at most one battery report this often
 constexpr uint32_t BATTERY_DRIFT_MS = 300000; // a one-point change is only worth a report after this long
 constexpr uint32_t REJOIN_MS = 15000;         // without Wi-Fi this long, the radio is asked to join again
@@ -1076,6 +1078,11 @@ class Wrist {
     if (blinking(now)) {
       calling_ = false;
       s.fired = true;
+    } else if (pairingFace(now)) {
+      // On the letters or the check a key says where to go, and lights the letters again; nothing more.
+      s.fired = true;
+      hintUntil_ = now + HINT_MS;
+      if (show_.kind == "pairing") litUntil_ = now + PAIR_AWAKE_MS;
     }
     // Every press is heard as it goes down; NOT NOW is silent.
     if (!silent_) react("tick");
@@ -1092,7 +1099,7 @@ class Wrist {
         step(now);
       } else {
         if (frozen_) rest();
-        wakeUntil_ = now + WAKE_MS;
+        wake(now);
       }
     }
     settle(now);
@@ -1156,6 +1163,21 @@ class Wrist {
       calling_ = false;
       if (wasCheck) react("fall", nullptr, 1);    // the check ended without YES
       soundOn_ = true;                            // after the letters' own reactions
+      // New letters light for PAIR_AWAKE_MS; the same letters again (a reconnect) do not.
+      if (show_.code != pairCode_) {
+        pairCode_ = show_.code;
+        litUntil_ = now + PAIR_AWAKE_MS;
+      }
+    } else {
+      pairCode_.clear();
+    }
+    // The waiting face lights when waiting starts. Losing the relay does not end it.
+    if (show_.kind != "waiting") {
+      waiting_ = false;
+    } else if (!waiting_) {
+      waiting_ = true;
+      waitAt_ = now;
+      litUntil_ = now + PAIR_AWAKE_MS;
     }
     quiet_.shown(show_);
     // NOT NOW's silence starts and ends only with a show about the person (rule 1).
@@ -1356,6 +1378,17 @@ class Wrist {
     return calling_ && mode_ == REST && !link_.stale(now) && haveShow_ && show_.kind == "meet";
   }
 
+  /** The letters or the check on the face: the band is nobody's yet, and a key only says where to go. */
+  bool pairingFace(uint32_t now) const {
+    return !link_.stale(now) && !quiet_.dark() && haveShow_ && (show_.kind == "pairing" || show_.kind == "check");
+  }
+
+  /** A press shows the face for WAKE_MS; the waiting face, which sleeps, stays lit PAIR_AWAKE_MS from it. */
+  void wake(uint32_t now) {
+    wakeUntil_ = now + WAKE_MS;
+    if (haveShow_ && show_.kind == "waiting") litUntil_ = now + PAIR_AWAKE_MS;
+  }
+
   /** NOT NOW (a hold not yet shown, or the relay's quiet), else what is armed, else "off". */
   std::string current() const {
     if (quiet_.dark() || (haveShow_ && show_.quiet)) return "notnow";
@@ -1382,6 +1415,12 @@ class Wrist {
     out.field = s.kind == "test" ? "white" : lit(s) ? s.intent : "black";
     out.ink = s.kind == "test" || lit(s) ? "ink" : s.kind == "pairing" || s.kind == "check" ? "white" : "text2";
     if (s.kind == "pairing") out.code = s.code;
+    // Rule 5, over what the relay says: a press on the letters or the check says where to go, and the
+    // letters and the waiting face sleep. Asleep, only the light goes: the picture stays for the next press.
+    if ((s.kind == "pairing" || s.kind == "check") && static_cast<int32_t>(hintUntil_ - now) > 0)
+      out.small = "PAIR ON YOUR PHONE";
+    if ((s.kind == "pairing" || s.kind == "waiting") && static_cast<int32_t>(now - litUntil_) >= 0)
+      out.light = LIGHT_OFF;
     return out;
   }
 
@@ -1449,7 +1488,7 @@ class Wrist {
     if (k1_.down || frozen_ || mode_ == SENDING) return;
     if (mode_ == RESULT) rest();
     if (mode_ == REST) {
-      wakeUntil_ = now + WAKE_MS;
+      wake(now);
       if (!personal()) return;  // not about the person: KEY2 only wakes
       mode_ = LOOK;
       stepAt_ = now;
@@ -1502,6 +1541,13 @@ class Wrist {
   std::string called_;
   bool calling_ = false;
   uint32_t callAt_ = 0;
+  // Rule 5: the letters and the waiting face sleep. Until when they are lit, which letters lit them, when
+  // waiting began, and until when a press says where to go.
+  uint32_t litUntil_ = 0;
+  std::string pairCode_;
+  bool waiting_ = false;
+  uint32_t waitAt_ = 0;
+  uint32_t hintUntil_ = 0;
 };
 
 // ---------- the serial console ----------
````

- [ ] **Step 4: Run** — the table, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 239`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "a key on the letters or the check does more than say where to go",
  "file": "app/lib/wrist.js",
  "from": "      s.fired = true;\n      hintUntil = now + HINT_MS;\n",
  "to": "      hintUntil = now + HINT_MS;\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the check, waiting for its owner, and not in a room; KEY2 on the check says where to go, on the others only wakes",
   "wrist.js: new letters light for PAIR_AWAKE_MS, then go dark; a press of either key lights them again from the press and says PAIR ON YOUR PHONE for HINT_MS; a hold there is no hold"
  ]
 },
 {
  "label": "no hint",
  "file": "app/lib/wrist.js",
  "from": "      hintUntil = now + HINT_MS;\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the check, waiting for its owner, and not in a room; KEY2 on the check says where to go, on the others only wakes",
   "wrist.js: new letters light for PAIR_AWAKE_MS, then go dark; a press of either key lights them again from the press and says PAIR ON YOUR PHONE for HINT_MS; a hold there is no hold",
   "wrist.js: the check stays lit; a press there says PAIR ON YOUR PHONE in place of ON YOUR PHONE? and a hold does nothing; the letters after it light, even with the same code"
  ]
 },
 {
  "label": "a press does not light the letters again",
  "file": "app/lib/wrist.js",
  "from": "      if (show.kind === 'pairing') litUntil = now + PAIR_AWAKE_MS;\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: new letters light for PAIR_AWAKE_MS, then go dark; a press of either key lights them again from the press and says PAIR ON YOUR PHONE for HINT_MS; a hold there is no hold"
  ]
 },
 {
  "label": "the letters and the waiting face never sleep",
  "file": "app/lib/wrist.js",
  "from": "    if ((s.kind === 'pairing' || s.kind === 'waiting') && now >= litUntil) light = LIGHT_OFF;\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: new letters light for PAIR_AWAKE_MS, then go dark; a press of either key lights them again from the press and says PAIR ON YOUR PHONE for HINT_MS; a hold there is no hold",
   "wrist.js: the waiting face lights for PAIR_AWAKE_MS when it starts and again after a press; its keys work as today"
  ]
 },
 {
  "label": "the same letters again light up",
  "file": "app/lib/wrist.js",
  "from": "      if (show.code !== pairCode) { pairCode = show.code; litUntil = now + PAIR_AWAKE_MS; }\n",
  "to": "      { pairCode = show.code; litUntil = now + PAIR_AWAKE_MS; }\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: new letters light for PAIR_AWAKE_MS, then go dark; a press of either key lights them again from the press and says PAIR ON YOUR PHONE for HINT_MS; a hold there is no hold"
  ]
 },
 {
  "label": "letters after another show are not new unless the code is",
  "file": "app/lib/wrist.js",
  "from": "    } else pairCode = '';\n",
  "to": "    }\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the check stays lit; a press there says PAIR ON YOUR PHONE in place of ON YOUR PHONE? and a hold does nothing; the letters after it light, even with the same code"
  ]
 },
 {
  "label": "waiting lights again at every waiting show",
  "file": "app/lib/wrist.js",
  "from": "    else if (waitAt === null) { waitAt = now; litUntil = now + PAIR_AWAKE_MS; }\n",
  "to": "    else { waitAt = now; litUntil = now + PAIR_AWAKE_MS; }\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the waiting face lights for PAIR_AWAKE_MS when it starts and again after a press; its keys work as today"
  ]
 },
 {
  "label": "the waiting face starts dark",
  "file": "app/lib/wrist.js",
  "from": "    else if (waitAt === null) { waitAt = now; litUntil = now + PAIR_AWAKE_MS; }\n",
  "to": "    else if (waitAt === null) { waitAt = now; }\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the check, waiting for its owner, and not in a room; KEY2 on the check says where to go, on the others only wakes",
   "wrist.js: NOT NOW stays silent through waiting for the owner, and letters end it",
   "wrist.js: the waiting face lights for PAIR_AWAKE_MS when it starts and again after a press; its keys work as today"
  ]
 },
 {
  "label": "a press on the waiting face does not light it again",
  "file": "app/lib/wrist.js",
  "from": "    if (show?.kind === 'waiting') litUntil = now + PAIR_AWAKE_MS;\n",
  "to": "",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the waiting face lights for PAIR_AWAKE_MS when it starts and again after a press; its keys work as today"
  ]
 },
 {
  "label": "C++: a key on the letters or the check does more than say where to go",
  "file": "firmware/src/band_logic.h",
  "from": "      s.fired = true;\n      hintUntil_ = now + HINT_MS;\n",
  "to": "      hintUntil_ = now + HINT_MS;\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: the check, waiting for its owner, and not in a room; KEY2 on the check says where to go, on the others only wakes",
   "band_logic.h: new letters light for PAIR_AWAKE_MS, then go dark; a press of either key lights them again from the press and says PAIR ON YOUR PHONE for HINT_MS; a hold there is no hold"
  ]
 },
 {
  "label": "C++: a press does not light the letters again",
  "file": "firmware/src/band_logic.h",
  "from": "      if (show_.kind == \"pairing\") litUntil_ = now + PAIR_AWAKE_MS;\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: new letters light for PAIR_AWAKE_MS, then go dark; a press of either key lights them again from the press and says PAIR ON YOUR PHONE for HINT_MS; a hold there is no hold"
  ]
 },
 {
  "label": "C++: the same letters again light up",
  "file": "firmware/src/band_logic.h",
  "from": "      if (show_.code != pairCode_) {\n",
  "to": "      if (true) {\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: new letters light for PAIR_AWAKE_MS, then go dark; a press of either key lights them again from the press and says PAIR ON YOUR PHONE for HINT_MS; a hold there is no hold"
  ]
 },
 {
  "label": "C++: waiting lights again at every waiting show",
  "file": "firmware/src/band_logic.h",
  "from": "    } else if (!waiting_) {\n",
  "to": "    } else {\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: the waiting face lights for PAIR_AWAKE_MS when it starts and again after a press; its keys work as today"
  ]
 },
 {
  "label": "C++: the letters and the waiting face never sleep",
  "file": "firmware/src/band_logic.h",
  "from": "    if ((s.kind == \"pairing\" || s.kind == \"waiting\") && static_cast<int32_t>(now - litUntil_) >= 0)\n      out.light = LIGHT_OFF;\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: new letters light for PAIR_AWAKE_MS, then go dark; a press of either key lights them again from the press and says PAIR ON YOUR PHONE for HINT_MS; a hold there is no hold",
   "band_logic.h: the waiting face lights for PAIR_AWAKE_MS when it starts and again after a press; its keys work as today"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add app/lib/wrist.js firmware/src/band_logic.h firmware/host/logic_test.cpp tests/fixtures/wrist-cases.json
```

````bash
git commit -F - <<'EOF'
Let the letters and the waiting face sleep, and say on a press where to pair

New letters, and the waiting face when waiting starts, light for
PAIR_AWAKE_MS and then go dark; the same letters again after a reconnect do
not light them. A key on the letters or the check ticks, says PAIR ON YOUR
PHONE for HINT_MS (under the letters, in place of ON YOUR PHONE? on the
check), lights the letters again, and does nothing more: no KEEP HOLDING, no
NOT NOW, no look. The check stays lit. On the waiting face the keys work as
before, and a press lights it again for PAIR_AWAKE_MS.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 6: Warnings, each once per change (rules 6 and 7)

**Files:**
- Modify: `app/lib/wrist.js`, `firmware/src/band_logic.h`, `app/screens/Band.jsx` and `firmware/src/main.cpp` (the new `setBattery` signature only)
- Test: `tests/wrist-table.js`, `firmware/host/logic_test.cpp`, `tests/fixtures/wrist-cases.json`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: `setBattery(level, now)` in both twins (it was `setBattery(level)`); the harness's `battery` verb passes the step's time. State: `warned` (reach, wait, away), `armed` (low, empty), and `owed` (a JS `Set`; a C++ bitmask `REACH | WAIT | AWAY | BATTERY`). `warn(name)` owes the warning while silent or not resting, and otherwise calls `playWarn()`, which adds `warn`/`warn` at class 2 unless the moment already has one. `payOwed()` plays one warning if any owed one still holds (the battery holds at 15% or below), and runs when silence ends and at the top of `settle` when resting. Out of reach: a paired band, `STALE_MS` without the relay. Waiting: `STALE_MS` after it began. Away: an away show. Unpaired: letters reaching a band that held a secret, at once. Battery: at or below 15% once, re-armed at 20%; at or below 5% once, re-armed at 10%; the first reading counts. `settle` now puts the moment in order first, a stable sort by class: a warning owed through NOT NOW is added before the moment's call, and must still play after the SET and the call.

- [ ] **Step 1: Write the failing cases; the harness and the host pass the time to `setBattery`.**

In `tests/wrist-table.js`:

````diff
--- a/tests/wrist-table.js
+++ b/tests/wrist-table.js
@@ -91,7 +91,7 @@ export function runJs(protocol) {
     else if (verb === 'down') wrist.linkDown(t);
     else if (verb === 'key1' || verb === 'key2') (rest[0] === 'down' ? wrist.keyDown : wrist.keyUp)(verb === 'key1' ? 1 : 2, t);
     else if (verb === 'frame') wrist.frame(rest.join(' '), t);
-    else if (verb === 'battery') wrist.setBattery(Number(rest[0]));
+    else if (verb === 'battery') wrist.setBattery(Number(rest[0]), t);
     else if (verb === 'wifi') wrist.setWifi(rest[0] === '1');
     answers.push({ sent: wrist.take().map((o) => (o === 'DROP' ? o : JSON.parse(o))), sounds: wrist.sounds(), face: wrist.face(t) });
   }
````

In `firmware/host/logic_test.cpp`:

````diff
--- a/firmware/host/logic_test.cpp
+++ b/firmware/host/logic_test.cpp
@@ -621,7 +621,7 @@ int runWrist() {
       else w->keyUp(k, t);
     }
     else if (verb == "frame") w->frame(arg, t);
-    else if (verb == "battery") w->setBattery(std::atoi(arg.c_str()));
+    else if (verb == "battery") w->setBattery(std::atoi(arg.c_str()), t);
     else if (verb == "wifi") w->setWifi(arg == "1");
     std::string sent, sounds;
     for (const std::string& f : w->take()) sent += (sent.empty() ? "" : ",") + (f == "DROP" ? std::string("\"DROP\"") : f);
````

In `tests/fixtures/wrist-cases.json`:

````diff
--- a/tests/fixtures/wrist-cases.json
+++ b/tests/fixtures/wrist-cases.json
@@ -27,7 +27,7 @@
         { "at": "10", "frame": { "t": "paired", "secret": "5ec2e75ec2e75ec2e75ec2e75ec2e75e" } },
         { "at": "20", "link": "down" },
         { "at": "30", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "secret": "5ec2e75ec2e75ec2e75ec2e75ec2e75e", "battery": 62 }] },
-        { "at": "40", "show": "PAIRING", "face": { "big": "KXRT", "code": "KXRT", "light": "LIGHT_PAIR" } },
+        { "at": "40", "show": "PAIRING", "sounds": ["warn"], "face": { "field": "orange", "light": "LIGHT_FULL" } },
         { "at": "50", "link": "down" },
         { "at": "60", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] }
       ]
@@ -277,7 +277,7 @@
         { "at": "500", "face": { "big": "27", "small": "ON YOUR PHONE?", "field": "black", "ink": "white", "light": "LIGHT_PAIR" } },
         { "at": "1000", "press": 2, "face": { "big": "27", "small": "PAIR ON YOUR PHONE" } },
         { "at": "2000", "show": "WAITING", "face": { "big": "OPEN YOUR PHONE", "small": "OR SWITCH ME OFF", "light": "LIGHT_AWAKE" } },
-        { "at": "3000", "show": "AWAY", "face": { "big": "", "light": "LIGHT_OFF" } },
+        { "at": "3000", "show": "AWAY", "sounds": ["warn"], "face": { "big": "", "field": "orange", "light": "LIGHT_FULL" } },
         { "at": "10000", "face": { "big": "", "light": "LIGHT_OFF" } },
         { "at": "11000", "press": 1, "face": { "big": "OPEN YOUR PHONE", "small": "TO COME BACK", "light": "LIGHT_AWAKE" } },
         { "at": "12000", "press": 2, "face": { "small": "TO COME BACK" } },
@@ -676,6 +676,7 @@
         { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
         { "at": "0", "show": "HI", "rev": 1 },
         { "at": "1000", "show": "WAITING", "face": { "big": "OPEN YOUR PHONE", "light": "LIGHT_AWAKE" } },
+        { "at": "1000+STALE_MS", "sounds": ["warn"], "face": { "field": "orange", "light": "LIGHT_FULL" } },
         { "at": "1000+PAIR_AWAKE_MS-1", "face": { "light": "LIGHT_AWAKE" } },
         { "at": "1000+PAIR_AWAKE_MS", "face": { "big": "OPEN YOUR PHONE", "light": "LIGHT_OFF" } },
         { "at": "130000", "show": "WAITING", "face": { "light": "LIGHT_OFF" } },
@@ -687,6 +688,162 @@
         { "at": "270000+HOLD_MS", "sent": [{ "t": "hold" }], "sounds": ["down"], "face": { "light": "LIGHT_OFF" } },
         { "at": "270000+HOLD_MS", "key1": "up" }
       ]
+    },
+    {
+      "name": "out of reach warns once, STALE_MS after a paired band lost the relay, flashing orange twice, and again only after it has had the relay back",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "10", "frame": { "t": "paired", "secret": "5ec2e75ec2e75ec2e75ec2e75ec2e75e" } },
+        { "at": "20", "show": "HI", "rev": 1 },
+        { "at": "1000", "link": "down" },
+        { "at": "1000+STALE_MS-1", "face": { "big": "HI :)" } },
+        { "at": "1000+STALE_MS", "sounds": ["warn"], "face": { "big": "", "small": "", "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "1000+STALE_MS+350", "face": { "light": "LIGHT_OFF" } },
+        { "at": "1000+STALE_MS+600", "face": { "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "1000+STALE_MS+1200", "face": { "big": "", "light": "LIGHT_OFF" } },
+        { "at": "20000" },
+        { "at": "30000", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "secret": "5ec2e75ec2e75ec2e75ec2e75ec2e75e" }] },
+        { "at": "30100", "show": "HI", "rev": 1 },
+        { "at": "31000", "link": "down" },
+        { "at": "31000+STALE_MS", "sounds": ["warn"] }
+      ]
+    },
+    {
+      "name": "an unpaired band out of reach does not warn",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "PAIRING" },
+        { "at": "1000", "link": "down" },
+        { "at": "1000+STALE_MS" },
+        { "at": "30000" }
+      ]
+    },
+    {
+      "name": "waiting warns once, STALE_MS after the first waiting show; losing the relay does not end it, another show does",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "WAITING" },
+        { "at": "STALE_MS-1" },
+        { "at": "STALE_MS", "sounds": ["warn"], "face": { "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "15000", "link": "down" },
+        { "at": "15000+STALE_MS+1000", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "15000+STALE_MS+1100", "show": "WAITING" },
+        { "at": "15000+2*STALE_MS+2000" },
+        { "at": "50000", "show": "HI", "rev": 1 },
+        { "at": "51000", "show": "WAITING" },
+        { "at": "51000+STALE_MS", "sounds": ["warn"] }
+      ]
+    },
+    {
+      "name": "away warns once at an away show; the same after a reconnect does not warn again; a show that is not away ends it",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 1 },
+        { "at": "1000", "show": "AWAY", "sounds": ["warn"], "face": { "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "2000", "link": "down" },
+        { "at": "2000+STALE_MS+1000", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "2000+STALE_MS+1100", "show": "AWAY" },
+        { "at": "20000", "show": "HI", "rev": 1 },
+        { "at": "21000", "show": "AWAY", "sounds": ["warn"] }
+      ]
+    },
+    {
+      "name": "unpaired warns when letters reach a band that held a secret, with the switch as it was; after a check without YES, fall plays instead",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "10", "frame": { "t": "paired", "secret": "5ec2e75ec2e75ec2e75ec2e75ec2e75e" } },
+        { "at": "20", "show": "HI", "rev": 1, "with": { "sound": false } },
+        { "at": "1000", "show": "PAIRING", "face": { "big": "", "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "1000+1200", "face": { "big": "KXRT", "light": "LIGHT_PAIR" } },
+        { "at": "3000", "show": "CHECK", "sounds": ["ask"] },
+        { "at": "4000", "show": "PAIRING", "with": { "code": "MQTV" }, "sounds": ["fall"] }
+      ]
+    },
+    {
+      "name": "battery warns at 15% and again only after 20%, at 5% and again only after 10%; the first reading after a boot counts",
+      "steps": [
+        { "at": "0", "battery": 12, "sounds": ["warn"], "face": { "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "2000", "battery": 14 },
+        { "at": "3000", "battery": 19 },
+        { "at": "4000", "battery": 15 },
+        { "at": "5000", "battery": 20 },
+        { "at": "6000", "battery": 15, "sounds": ["warn"] },
+        { "at": "8000", "battery": 5, "sounds": ["warn"] },
+        { "at": "10000", "battery": 9 },
+        { "at": "11000", "battery": 5 },
+        { "at": "12000", "battery": 10 },
+        { "at": "13000", "battery": 4, "sounds": ["warn"] },
+        { "at": "15000", "battery": 3 }
+      ]
+    },
+    {
+      "name": "a first reading past both thresholds warns once",
+      "steps": [
+        { "at": "0", "battery": 3, "sounds": ["warn"] },
+        { "at": "1200", "battery": 4 },
+        { "at": "3000" }
+      ]
+    },
+    {
+      "name": "a warning in NOT NOW is owed: it plays once when NOT NOW ends, after that moment's SET and call, and not if it no longer holds",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "QUIET", "rev": 6 },
+        { "at": "500", "battery": 12, "face": { "light": "LIGHT_OFF" } },
+        { "at": "1000", "press": 2, "downSounds": [] },
+        { "at": "2000", "press": 2, "downSounds": [], "face": { "big": "HI :)", "small": "HOLD SIDE TO SHOW" } },
+        { "at": "3000", "key2": "down" },
+        { "at": "3000+HOLD_MS", "sent": [{ "t": "set", "intent": "hi", "basis": 6 }] },
+        { "at": "3000+HOLD_MS", "key2": "up" },
+        { "at": "6000", "show": "MEET", "rev": 7, "sounds": ["up"], "face": { "field": "hi", "light": "LIGHT_FULL" } },
+        { "at": "6000+500", "sounds": ["jingle"], "face": { "big": "27", "small": "SET" } },
+        { "at": "6000+1100", "sounds": ["warn"], "face": { "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "6000+2300", "face": { "big": "27", "small": "SET", "field": "song" } },
+        { "at": "20000", "show": "QUIET", "rev": 8 },
+        { "at": "21000", "battery": 25 },
+        { "at": "22000", "battery": 14 },
+        { "at": "23000", "battery": 18 },
+        { "at": "24000", "show": "HI", "rev": 9 },
+        { "at": "25000", "press": 1 }
+      ]
+    },
+    {
+      "name": "a warning that comes up during a choice waits, sound and flash, until the face rests",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "HI", "rev": 3 },
+        { "at": "1000", "press": 2 },
+        { "at": "2000", "battery": 12, "face": { "big": "HI :)", "small": "SIDE TO CHANGE", "light": "LIGHT_FULL" } },
+        { "at": "1100+CHOOSE_MS-1", "face": { "small": "SIDE TO CHANGE" } },
+        { "at": "1100+CHOOSE_MS", "sounds": ["warn"], "face": { "field": "orange", "light": "LIGHT_FULL" } }
+      ]
+    },
+    {
+      "name": "a warning's flash covers a call's blink and the blink comes back after it; a key during the flash answers the call",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "0", "show": "MEET", "rev": 3, "sounds": ["jingle"] },
+        { "at": "1000", "battery": 12, "sounds": ["warn"], "face": { "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "1000+1200", "face": { "big": "27", "light": "LIGHT_FULL" } },
+        { "at": "1000+1700", "face": { "big": "27", "light": "LIGHT_OFF" } },
+        { "at": "3000", "battery": 25 },
+        { "at": "4000", "battery": 13, "sounds": ["warn"] },
+        { "at": "4100", "key1": "down", "sounds": ["tick"], "face": { "big": "27", "small": "MEET", "light": "LIGHT_FULL" } },
+        { "at": "4600", "face": { "big": "27", "light": "LIGHT_FULL" } },
+        { "at": "4700", "key1": "up" }
+      ]
+    },
+    {
+      "name": "letters that end NOT NOW play one warning, however many are due",
+      "steps": [
+        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
+        { "at": "10", "frame": { "t": "paired", "secret": "5ec2e75ec2e75ec2e75ec2e75ec2e75e" } },
+        { "at": "20", "show": "QUIET", "rev": 1 },
+        { "at": "500", "battery": 12 },
+        { "at": "1000", "show": "PAIRING", "sounds": ["warn"], "face": { "field": "orange", "light": "LIGHT_FULL" } },
+        { "at": "1000+1200", "face": { "big": "KXRT", "light": "LIGHT_PAIR" } },
+        { "at": "5000" }
+      ]
     }
   ]
 }
````

New cases (11):

  - out of reach warns once, STALE_MS after a paired band lost the relay, flashing orange twice, and again only after it has had the relay back
  - an unpaired band out of reach does not warn
  - waiting warns once, STALE_MS after the first waiting show; losing the relay does not end it, another show does
  - away warns once at an away show; the same after a reconnect does not warn again; a show that is not away ends it
  - unpaired warns when letters reach a band that held a secret, with the switch as it was; after a check without YES, fall plays instead
  - battery warns at 15% and again only after 20%, at 5% and again only after 10%; the first reading after a boot counts
  - a first reading past both thresholds warns once
  - a warning in NOT NOW is owed: it plays once when NOT NOW ends, after that moment's SET and call, and not if it no longer holds
  - a warning that comes up during a choice waits, sound and flash, until the face rests
  - a warning's flash covers a call's blink and the blink comes back after it; a key during the flash answers the call
  - letters that end NOT NOW play one warning, however many are due

Changed cases (3):

  - a paired wristband says its secret in every hello, and forgets it when it is shown letters
  - the check, waiting for its owner, and not in a room; KEY2 on the check says where to go, on the others only wakes
  - the waiting face lights for PAIR_AWAKE_MS when it starts and again after a press; its keys work as today

- [ ] **Step 2: Run the table and watch it fail**

Expected: `ℹ pass 45`, `ℹ fail 78`. The first errors:

```text
firmware/host\logic_test.cpp:624:46: error: no matching function for call to 'otb::Wrist::setBattery(int, const uint32_t&)'
AssertionError [ERR_ASSERTION]: a paired wristband says its secret in every hello, and forgets it when it is shown letters / 1040 frame {"t":"show","show":{"kind":"pairing","code":"KXRT"}}: sounds
AssertionError [ERR_ASSERTION]: the check, waiting for its owner, and not in a room; KEY2 on the check says where to go, on the others only wakes / 4000 frame {"t":"show","show":{"kind":"off","battery":62,"away":true}}: 
AssertionError [ERR_ASSERTION]: the waiting face lights for PAIR_AWAKE_MS when it starts and again after a press; its keys work as today / 12000 tick: sounds
AssertionError [ERR_ASSERTION]: out of reach warns once, STALE_MS after a paired band lost the relay, flashing orange twice, and again only after it has had the relay back / 12000 tick: sounds
AssertionError [ERR_ASSERTION]: waiting warns once, STALE_MS after the first waiting show; losing the relay does not end it, another show does / 11000 tick: sounds
```

Red (78):

- the wristband logic passes its own checks
- the wristband logic compiles as the band's compiler takes it: C++11, after Arduino's macros
- the colours on the wrist are the colours on the phone
- the firmware hashes as node:crypto does, and its id is its key's hash
- the code a wristband draws opens the app on its own four letters
- what the firmware says, the relay takes; what the relay says, the firmware reads as it was meant
- the firmware and the stand-in keep the same constants, by name
- the firmware and the stand-in play the same notes and the same flashes
- band_logic.h: the hello says v2 and carries the key, and the id is the key's hash
- band_logic.h: a paired wristband says its secret in every hello, and forgets it when it is shown letters
- band_logic.h: KEY1 let go at 1.0 s and 1.4 s is a press; at HOLD_MS it is NOT NOW, dark at once
- band_logic.h: held from BAR_MS, KEEP HOLDING and a bar; a dark face lights only to LIGHT_AWAKE, a card keeps its light
- band_logic.h: NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW
- band_logic.h: the first KEY2 press only looks; no second press within CHOOSE_MS and the look is dropped
- … and 64 more

- [ ] **Step 3: Implement in both twins, and pass the time where the battery is read.** `main.cpp` is only checked by P3 until Task 10; run P3 now if a band may be flashed before then.

In `app/lib/wrist.js`:

````diff
--- a/app/lib/wrist.js
+++ b/app/lib/wrist.js
@@ -15,9 +15,9 @@
 //
 // It also reacts, in sound and light (docs/superpowers/specs/
 // 2026-09-25-wrist-reactions-design.md). Each input is one moment; a moment's
-// reactions play one after another, and a later moment's replace the one
-// playing. sounds() gives the names of the sounds due to start since it was
-// last asked.
+// reactions play in order (a key or a result, then a call, then a warning),
+// one after another, and a later moment's replace the one playing. sounds()
+// gives the names of the sounds due to start since it was last asked.
 
 import { bandIdOf } from './sha256.js';
 
@@ -112,7 +112,7 @@ export function createWrist({ key }) {
   let choice = '';            // what was sent: a card, or '' for off
   let word = '';
   let out = [];
-  // Reactions (rule 6): this input's; the one playing; those waiting their turn.
+  // Reactions (rule 6): this input's, not yet in order; the one playing; those waiting their turn.
   let moment = [];
   let playing = null;         // { sound, flash, colour, cls, audible, at, until }
   let queue = [];
@@ -129,6 +129,11 @@ export function createWrist({ key }) {
   let pairCode = '';
   let waitAt = null;
   let hintUntil = 0;
+  // Rule 7: each warning plays once per change. Which have played (true while their condition holds), which
+  // battery thresholds are armed, and which came up in NOT NOW or during a choice and are owed.
+  const warned = { reach: false, wait: false, away: false };
+  const armed = { low: true, empty: true };
+  const owed = new Set();
 
   const send = (m) => out.push(JSON.stringify(m));
   const stale = (now) => !link.up && (!link.ever || now - link.lost >= STALE_MS);
@@ -152,10 +157,30 @@ export function createWrist({ key }) {
     if (r.sound && r.audible) due.push(r.sound);
   }
 
-  /** The end of a moment: its reactions go first, one after another, and what was already waiting plays after them. */
+  /** A warning: orange twice with warn. One a moment, however many came up in it. */
+  function playWarn() {
+    if (!moment.some((r) => r.cls === 2)) react('warn', 'warn', 2);
+  }
+
+  /** A warning came up. In NOT NOW, or while the face is not resting, it is owed (rules 1 and 6). */
+  function warn(name) {
+    if (silent || mode !== 'rest') owed.add(name);
+    else playWarn();
+  }
+
+  /** What is owed plays once, if any of it still holds. */
+  function payOwed() {
+    const holds = (name) => (name === 'battery' ? battery >= 0 && battery <= 15 : warned[name]);
+    if ([...owed].some(holds)) playWarn();
+    owed.clear();
+  }
+
+  /** The end of a moment: its reactions go first, in order, and what was already waiting plays after them. */
   function settle(now) {
+    // A warning that waited for a choice plays once the face rests.
+    if (owed.size && !silent && mode === 'rest') payOwed();
     if (!moment.length) return;
-    const mine = moment;
+    const mine = moment.sort((a, b) => a.cls - b.cls);
     moment = [];
     queue = [...mine.slice(1), ...queue];
     start(mine[0], now);
@@ -264,6 +289,9 @@ export function createWrist({ key }) {
   function tick(now) {
     advance(now);
     if (calling && stale(now)) calling = false;  // a show no longer believed calls no more
+    // Out of reach: a paired band, STALE_MS without the relay. Waiting: STALE_MS after it began.
+    if (secret && stale(now) && !warned.reach) { warned.reach = true; warn('reach'); }
+    if (waitAt !== null && now - waitAt >= STALE_MS && !warned.wait) { warned.wait = true; warn('wait'); }
     if (link.up) {
       if (now - link.heard > DEAF_MS) { out.push('DROP'); closed(now); }
       else if (now - link.asked >= PING_EVERY_MS) { link.asked = now; send({ t: 'ping' }); }
@@ -325,6 +353,7 @@ export function createWrist({ key }) {
     if (stale(now)) show = null;
     link.up = true;
     link.ever = true;
+    warned.reach = false;  // it has the relay again
     link.heard = now;
     link.asked = now;
     const hello = { t: 'wristband', id, key, v: 2 };
@@ -335,6 +364,18 @@ export function createWrist({ key }) {
     settle(now);
   }
 
+  /** A battery reading. Low at 15% or below, again only after 20%; very low at 5% or below, again only after 10%. */
+  function setBattery(level, now) {
+    advance(now);
+    battery = Number.isInteger(level) && level >= 0 && level <= 100 ? level : -1;
+    // Past both at once is still one warning: a moment plays one.
+    if (battery >= 0) {
+      if (battery <= 15 && armed.low) { armed.low = false; warn('battery'); } else if (battery >= 20) armed.low = true;
+      if (battery <= 5 && armed.empty) { armed.empty = false; warn('battery'); } else if (battery >= 10) armed.empty = true;
+    }
+    settle(now);
+  }
+
   function linkDown(now) {
     advance(now);
     closed(now);
@@ -359,6 +400,7 @@ export function createWrist({ key }) {
     }
     if (m.t !== 'show' || !m.show || typeof m.show !== 'object') return;
     const was = show;
+    const wasSilent = silent;
     show = readShow(m.show);
     // Reactions come from changes; a show that differs only in `sound` is no change.
     const same = !!was && JSON.stringify(was) === JSON.stringify(show);
@@ -366,17 +408,19 @@ export function createWrist({ key }) {
     if (typeof m.show.sound === 'boolean') soundOn = m.show.sound;
     if (show.kind === 'pairing') {
       // The band is nobody's: NOT NOW is over, and no meeting is anyone's.
+      const wasPaired = !!secret;
       secret = '';
       silent = false;
       called = '';
       calling = false;
       if (was?.kind === 'check') react('fall', null, 1);  // the check ended without YES
+      if (wasPaired) playWarn();                          // unpaired; the letters end any choice, so at once
       soundOn = true;                                     // after the letters' own reactions
       // New letters light for PAIR_AWAKE_MS; the same letters again (a reconnect) do not.
       if (show.code !== pairCode) { pairCode = show.code; litUntil = now + PAIR_AWAKE_MS; }
     } else pairCode = '';
-    // The waiting face lights when waiting starts. Losing the relay does not end it.
-    if (show.kind !== 'waiting') waitAt = null;
+    // The waiting face lights when waiting starts. Losing the relay does not end it; any other show does.
+    if (show.kind !== 'waiting') { waitAt = null; warned.wait = false; }
     else if (waitAt === null) { waitAt = now; litUntil = now + PAIR_AWAKE_MS; }
     if (quiet.pending && quiet.sent && !lit(show)) quiet.pending = false;
     // NOT NOW's silence starts and ends only with a show about the person (rule 1).
@@ -391,6 +435,11 @@ export function createWrist({ key }) {
     } else if (mode === 'sending' && personal() && show.rev > basis && show.armed === choice && !show.quiet) {
       result(now, 'SET');
     }
+    // Away starts at an away show and ends at one that is not; the same again after a reconnect is no change.
+    if (!show.away) warned.away = false;
+    else if (!warned.away) { warned.away = true; warn('away'); }
+    // NOT NOW is over: what came up in it plays once, after this moment's own reactions (rule 1).
+    if (wasSilent && !silent) payOwed();
     if (same || silent) return;
     if (show.kind === 'check') react('ask', 'check', 1);
     else if (show.kind === 'test') react('up', null, 1);  // paired, or TEST THE LIGHT: the white face is its flash
@@ -483,7 +532,7 @@ export function createWrist({ key }) {
     heard: (now) => { link.heard = now; },
     frame,
     tick,
-    setBattery: (level) => { battery = Number.isInteger(level) && level >= 0 && level <= 100 ? level : -1; },
+    setBattery,
     setWifi: (on) => { wifi = !!on; },
     /** Everything to send since the last take: frame text, or 'DROP' to drop the socket. */
     take: () => { const o = out; out = []; return o; },
````

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -1046,7 +1046,27 @@ class Wrist {
   const std::string& secret() const { return secret_; }
   bool up() const { return link_.up(); }
 
-  void setBattery(int level) { battery_ = level >= 0 && level <= 100 ? level : -1; }
+  /** A battery reading. Low at 15% or below, again only after 20%; very low at 5% or below, again only after 10%. */
+  void setBattery(int level, uint32_t now) {
+    advance(now);
+    battery_ = level >= 0 && level <= 100 ? level : -1;
+    // Past both at once is still one warning: a moment plays one.
+    if (battery_ >= 0) {
+      if (battery_ <= 15 && armedLow_) {
+        armedLow_ = false;
+        warn(BATTERY);
+      } else if (battery_ >= 20) {
+        armedLow_ = true;
+      }
+      if (battery_ <= 5 && armedEmpty_) {
+        armedEmpty_ = false;
+        warn(BATTERY);
+      } else if (battery_ >= 10) {
+        armedEmpty_ = true;
+      }
+    }
+    settle(now);
+  }
   void setWifi(bool on) { wifi_ = on; }
   /** The relay answered a ping, or anything else was heard. */
   void heard(uint32_t now) { link_.heard(now); }
@@ -1109,6 +1129,7 @@ class Wrist {
     advance(now);
     if (link_.stale(now)) haveShow_ = false;
     link_.opened(now);
+    warnedReach_ = false;  // it has the relay again
     // A hold not yet heard rides on the hello: the relay applies it before anything else.
     const bool quiet = quiet_.dark();
     if (quiet) quiet_.sent(now);
@@ -1151,17 +1172,20 @@ class Wrist {
     // Reactions come from changes; a show that differs only in its sound switch is no change.
     const bool same = haveShow_ && show_ == f.show;
     const bool wasCheck = haveShow_ && show_.kind == "check";
+    const bool wasSilent = silent_;
     show_ = f.show;
     haveShow_ = true;
     // A show's own switch counts for what it causes.
     if (f.sound >= 0) soundOn_ = f.sound == 1;
     if (show_.kind == "pairing") {
       // Unpaired, or nobody came for it: the band is nobody's, so NOT NOW is over and no meeting is anyone's.
+      const bool wasPaired = !secret_.empty();
       secret_.clear();
       silent_ = false;
       called_.clear();
       calling_ = false;
       if (wasCheck) react("fall", nullptr, 1);    // the check ended without YES
+      if (wasPaired) playWarn();                  // unpaired; the letters end any choice, so at once
       soundOn_ = true;                            // after the letters' own reactions
       // New letters light for PAIR_AWAKE_MS; the same letters again (a reconnect) do not.
       if (show_.code != pairCode_) {
@@ -1171,9 +1195,10 @@ class Wrist {
     } else {
       pairCode_.clear();
     }
-    // The waiting face lights when waiting starts. Losing the relay does not end it.
+    // The waiting face lights when waiting starts. Losing the relay does not end it; any other show does.
     if (show_.kind != "waiting") {
       waiting_ = false;
+      warnedWait_ = false;
     } else if (!waiting_) {
       waiting_ = true;
       waitAt_ = now;
@@ -1196,6 +1221,15 @@ class Wrist {
     } else if (mode_ == SENDING && personal() && show_.rev > basis_ && show_.armed == choice_ && !show_.quiet) {
       result(now, "SET");
     }
+    // Away starts at an away show and ends at one that is not; the same again after a reconnect is no change.
+    if (!show_.away) {
+      warnedAway_ = false;
+    } else if (!warnedAway_) {
+      warnedAway_ = true;
+      warn(AWAY);
+    }
+    // NOT NOW is over: what came up in it plays once, after this moment's own reactions (rule 1).
+    if (wasSilent && !silent_) payOwed();
     if (same || silent_) return;
     if (show_.kind == "check") {
       react("ask", "check", 1);
@@ -1212,6 +1246,15 @@ class Wrist {
 
   void ticked(uint32_t now) {
     if (calling_ && link_.stale(now)) calling_ = false;  // a show no longer believed calls no more
+    // Out of reach: a paired band, STALE_MS without the relay. Waiting: STALE_MS after it began.
+    if (!secret_.empty() && link_.stale(now) && !warnedReach_) {
+      warnedReach_ = true;
+      warn(REACH);
+    }
+    if (waiting_ && now - waitAt_ >= STALE_MS && !warnedWait_) {
+      warnedWait_ = true;
+      warn(WAIT);
+    }
     switch (link_.tick(now)) {
       case Link::DROP:
         out_.push_back("DROP");
@@ -1336,9 +1379,33 @@ class Wrist {
     if (r.sound && r.audible) due_.push_back(r.sound);
   }
 
-  /** The end of a moment: its reactions go first, one after another, and what was already waiting plays after them. */
+  /** A warning: orange twice with warn. One a moment, however many came up in it. */
+  void playWarn() {
+    for (const Reaction& r : moment_)
+      if (r.cls == 2) return;
+    react("warn", "warn", 2);
+  }
+
+  /** A warning came up. In NOT NOW, or while the face is not resting, it is owed (rules 1 and 6). */
+  void warn(uint8_t w) {
+    if (silent_ || mode_ != REST) owed_ |= w;
+    else playWarn();
+  }
+
+  /** What is owed plays once, if any of it still holds. */
+  void payOwed() {
+    const bool holds = ((owed_ & REACH) && warnedReach_) || ((owed_ & WAIT) && warnedWait_) ||
+                       ((owed_ & AWAY) && warnedAway_) || ((owed_ & BATTERY) && battery_ >= 0 && battery_ <= 15);
+    if (holds) playWarn();
+    owed_ = 0;
+  }
+
+  /** The end of a moment: its reactions go first, in order, and what was already waiting plays after them. */
   void settle(uint32_t now) {
+    // A warning that waited for a choice plays once the face rests.
+    if (owed_ && !silent_ && mode_ == REST) payOwed();
     if (moment_.empty()) return;
+    std::stable_sort(moment_.begin(), moment_.end(), [](const Reaction& a, const Reaction& b) { return a.cls < b.cls; });
     std::vector<Reaction> next(moment_.begin() + 1, moment_.end());
     next.insert(next.end(), queue_.begin(), queue_.end());
     queue_.swap(next);
@@ -1530,7 +1597,7 @@ class Wrist {
   uint32_t wakeUntil_ = 0, stepAt_ = 0, sentAt_ = 0, resultUntil_ = 0;
   int64_t basis_ = 0;
   std::vector<std::string> out_;
-  // Reactions (rule 6): this input's; the one playing; those waiting their turn.
+  // Reactions (rule 6): this input's, not yet in order; the one playing; those waiting their turn.
   std::vector<Reaction> moment_, queue_;
   Reaction playing_;
   bool playingOn_ = false;
@@ -1548,6 +1615,12 @@ class Wrist {
   bool waiting_ = false;
   uint32_t waitAt_ = 0;
   uint32_t hintUntil_ = 0;
+  // Rule 7: each warning plays once per change. Which have played (true while their condition holds), which
+  // battery thresholds are armed, and which came up in NOT NOW or during a choice and are owed, by bit.
+  enum Warning : uint8_t { REACH = 1, WAIT = 2, AWAY = 4, BATTERY = 8 };
+  bool warnedReach_ = false, warnedWait_ = false, warnedAway_ = false;
+  bool armedLow_ = true, armedEmpty_ = true;
+  uint8_t owed_ = 0;
 };
 
 // ---------- the serial console ----------
````

In `app/screens/Band.jsx`:

````diff
--- a/app/screens/Band.jsx
+++ b/app/screens/Band.jsx
@@ -196,7 +196,7 @@ export function BandStandIn() {
   }, [wrist]);
 
   useEffect(() => {
-    wrist.setBattery(battery);
+    wrist.setBattery(battery, Date.now());
     if (ws.current?.readyState === 1) ws.current.send(JSON.stringify({ t: 'battery', level: battery }));
   }, [wrist, battery]);
 
````

In `firmware/src/main.cpp`:

````diff
--- a/firmware/src/main.cpp
+++ b/firmware/src/main.cpp
@@ -520,7 +520,7 @@ void readBattery(uint32_t now) {
   batteryAt = now;
   const int32_t level = M5.Power.getBatteryLevel();
   battery = level >= 0 && level <= 100 ? static_cast<int>(level) : -1;
-  if (wrist) wrist->setBattery(battery);
+  if (wrist) wrist->setBattery(battery, now);
 }
 
 }  // namespace
@@ -550,7 +550,7 @@ void setup() {
   if (prefs.isKey("id")) prefs.remove("id");  // the id an older build kept for good is not kept any more
   loadSettings();
   readBattery(millis());
-  wrist->setBattery(battery);
+  wrist->setBattery(battery, millis());
 
   Serial.println("\nON THE BEAT wristband");
   help();
````

- [ ] **Step 4: Run** — the table, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 261`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "out of reach warns again and again",
  "file": "app/lib/wrist.js",
  "from": "    if (secret && stale(now) && !warned.reach) { warned.reach = true; warn('reach'); }\n",
  "to": "    if (secret && stale(now)) { warned.reach = true; warn('reach'); }\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: out of reach warns once, STALE_MS after a paired band lost the relay, flashing orange twice, and again only after it has had the relay back"
  ]
 },
 {
  "label": "an unpaired band warns out of reach",
  "file": "app/lib/wrist.js",
  "from": "    if (secret && stale(now) && !warned.reach) { warned.reach = true; warn('reach'); }\n",
  "to": "    if (stale(now) && !warned.reach) { warned.reach = true; warn('reach'); }\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the hello says v2 and carries the key, and the id is the key's hash",
   "wrist.js: a paired wristband says its secret in every hello, and forgets it when it is shown letters",
   "wrist.js: KEY1 let go at 1.0 s and 1.4 s is a press; at HOLD_MS it is NOT NOW, dark at once",
   "wrist.js: held from BAR_MS, KEEP HOLDING and a bar; a dark face lights only to LIGHT_AWAKE, a card keeps its light",
   "wrist.js: NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW",
   "wrist.js: the first KEY2 press only looks; no second press within CHOOSE_MS and the look is dropped",
   "wrist.js: each press moves the preview after what is armed; COMMIT_MS later it is sent; a newer show saying so is SET",
   "wrist.js: a KEY2 hold at rest only looks; in a choice it sends at once; presses while sending are ignored",
   "wrist.js: a preview equal to what is armed sends nothing",
   "wrist.js: from NOT NOW the first step is HI, only a KEY2 hold sends it, and two stray presses send nothing",
   "wrist.js: KEY1 down two seconds into a choice freezes it: nothing is sent but the hold",
   "wrist.js: a KEY1 press during a choice cancels it",
   "wrist.js: a show with a new rev, or one not about the person, cancels a choice",
   "wrist.js: offline, LOOK says NO SIGNAL and presses change nothing",
   "wrist.js: the relay refusing a stale basis is CHANGED; any other refusal is NOT SENT at once",
   "wrist.js: nothing back in CONFIRM_MS is NOT SENT: the socket is dropped, and the next connection's show is the truth",
   "wrist.js: NOT SENT leaving NOT NOW holds NOT NOW again, in the next hello",
   "wrist.js: a KEY1 hold while sending is NOT NOW and drops the wait: no SET",
   "wrist.js: the check, waiting for its owner, and not in a room; KEY2 on the check says where to go, on the others only wakes",
   "wrist.js: six seconds unheard drops the socket; ten more and the last show is not believed",
   "wrist.js: a meeting number calls; the first press answers it, and LOOK then replaces the number while it lasts",
   "wrist.js: SET plays up and flashes the card's colour twice, 150 on and 100 off; then SET shows",
   "wrist.js: CHANGED plays fall and flashes red three times, 120 on and 90 off; NOT SENT plays low and flashes orange twice, 350 on and 250 off",
   "wrist.js: a key going down ends a flash: only its tick plays, and the face under the flash shows at once",
   "wrist.js: a SIDE hold on a preview of what is already armed sends nothing and plays no double",
   "wrist.js: the sound switch off: presses and SET play nothing and SET still flashes; switched on, the next press ticks",
   "wrist.js: a show that differs from the last only in its sound causes nothing, but the switch still follows it",
   "wrist.js: a sound that is not true or false is not said: the switch stays as it was",
   "wrist.js: the check number plays ask and flashes white twice, 150 on and 100 off; YES plays up on the white face",
   "wrist.js: a check that ends without YES plays fall as the letters come back; letters said again play nothing",
   "wrist.js: TEST THE LIGHT plays up; in NOT NOW it shows its white and plays nothing, and NOT NOW stays silent after it, a FACE hold included",
   "wrist.js: a card shown while the wrist's own hold waits to be heard does not end NOT NOW's silence",
   "wrist.js: a try to come back from NOT NOW that ends CHANGED or NOT SENT is silent; its word still shows",
   "wrist.js: NOT NOW stays silent through waiting for the owner, and letters end it",
   "wrist.js: the wearer's own changes on the phone are silent on the wrist: a card, NOT NOW and back",
   "wrist.js: the sound switch is kept through waiting and goes back on at letters, after what the letters play",
   "wrist.js: a meeting number plays jingle and blinks its face, 500 on and 500 off, until a key answers; that key only ticks, and holding it is no hold",
   "wrist.js: the same number after a reconnect, or after the test light, does not call again; a show about the person that is not a meeting forgets it",
   "wrist.js: a call ends when the band stops believing its show, and the same number does not call again when it is back",
   "wrist.js: a call waits for a choice, and for the result on the face, to end; its jingle plays at once and the choice's presses keep working",
   "wrist.js: NOT NOW from the phone ends a call and forgets its number; back from the wrist, the meeting still running calls after the SET",
   "wrist.js: a FACE hold into NOT NOW ends a call, even while the relay has not yet said so",
   "wrist.js: letters forget the meeting: paired again, the same number calls again",
   "wrist.js: new letters light for PAIR_AWAKE_MS, then go dark; a press of either key lights them again from the press and says PAIR ON YOUR PHONE for HINT_MS; a hold there is no hold",
   "wrist.js: the check stays lit; a press there says PAIR ON YOUR PHONE in place of ON YOUR PHONE? and a hold does nothing; the letters after it light, even with the same code",
   "wrist.js: the waiting face lights for PAIR_AWAKE_MS when it starts and again after a press; its keys work as today",
   "wrist.js: out of reach warns once, STALE_MS after a paired band lost the relay, flashing orange twice, and again only after it has had the relay back",
   "wrist.js: an unpaired band out of reach does not warn",
   "wrist.js: waiting warns once, STALE_MS after the first waiting show; losing the relay does not end it, another show does",
   "wrist.js: away warns once at an away show; the same after a reconnect does not warn again; a show that is not away ends it",
   "wrist.js: unpaired warns when letters reach a band that held a secret, with the switch as it was; after a check without YES, fall plays instead",
   "wrist.js: battery warns at 15% and again only after 20%, at 5% and again only after 10%; the first reading after a boot counts",
   "wrist.js: a first reading past both thresholds warns once",
   "wrist.js: a warning in NOT NOW is owed: it plays once when NOT NOW ends, after that moment's SET and call, and not if it no longer holds",
   "wrist.js: a warning that comes up during a choice waits, sound and flash, until the face rests",
   "wrist.js: a warning's flash covers a call's blink and the blink comes back after it; a key during the flash answers the call",
   "wrist.js: letters that end NOT NOW play one warning, however many are due"
  ]
 },
 {
  "label": "an owed warning plays before the call (cutting the order)",
  "file": "app/lib/wrist.js",
  "from": "    if (!moment.some((r) => r.cls === 2)) react('warn', 'warn', 2);\n",
  "to": "    if (!moment.some((r) => r.cls === 2)) react('warn', 'warn', 0);\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a first reading past both thresholds warns once",
   "wrist.js: a warning in NOT NOW is owed: it plays once when NOT NOW ends, after that moment's SET and call, and not if it no longer holds",
   "wrist.js: letters that end NOT NOW play one warning, however many are due"
  ]
 },
 {
  "label": "two warnings in one moment",
  "file": "app/lib/wrist.js",
  "from": "    if (!moment.some((r) => r.cls === 2)) react('warn', 'warn', 2);\n",
  "to": "    react('warn', 'warn', 2);\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a first reading past both thresholds warns once",
   "wrist.js: letters that end NOT NOW play one warning, however many are due"
  ]
 },
 {
  "label": "an owed warning plays though it no longer holds",
  "file": "app/lib/wrist.js",
  "from": "    if ([...owed].some(holds)) playWarn();\n",
  "to": "    if (owed.size) playWarn();\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a warning in NOT NOW is owed: it plays once when NOT NOW ends, after that moment's SET and call, and not if it no longer holds"
  ]
 },
 {
  "label": "a warning plays in NOT NOW",
  "file": "app/lib/wrist.js",
  "from": "    if (silent || mode !== 'rest') owed.add(name);\n",
  "to": "    if (mode !== 'rest') owed.add(name);\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a warning in NOT NOW is owed: it plays once when NOT NOW ends, after that moment's SET and call, and not if it no longer holds",
   "wrist.js: letters that end NOT NOW play one warning, however many are due"
  ]
 },
 {
  "label": "a warning does not wait for a choice",
  "file": "app/lib/wrist.js",
  "from": "    if (silent || mode !== 'rest') owed.add(name);\n",
  "to": "    if (silent) owed.add(name);\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a warning that comes up during a choice waits, sound and flash, until the face rests"
  ]
 },
 {
  "label": "the switch reset before the unpaired warning",
  "file": "app/lib/wrist.js",
  "from": "      if (wasPaired) playWarn();                          // unpaired; the letters end any choice, so at once\n      soundOn = true;                                     // after the letters' own reactions\n",
  "to": "      soundOn = true;\n      if (wasPaired) playWarn();\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: unpaired warns when letters reach a band that held a secret, with the switch as it was; after a check without YES, fall plays instead"
  ]
 },
 {
  "label": "away warns again after a reconnect",
  "file": "app/lib/wrist.js",
  "from": "    else if (!warned.away) { warned.away = true; warn('away'); }\n",
  "to": "    else { warned.away = true; warn('away'); }\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: away warns once at an away show; the same after a reconnect does not warn again; a show that is not away ends it"
  ]
 },
 {
  "label": "waiting warns again and again",
  "file": "app/lib/wrist.js",
  "from": "    if (waitAt !== null && now - waitAt >= STALE_MS && !warned.wait) { warned.wait = true; warn('wait'); }\n",
  "to": "    if (waitAt !== null && now - waitAt >= STALE_MS) { warned.wait = true; warn('wait'); }\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: the waiting face lights for PAIR_AWAKE_MS when it starts and again after a press; its keys work as today",
   "wrist.js: waiting warns once, STALE_MS after the first waiting show; losing the relay does not end it, another show does"
  ]
 },
 {
  "label": "the low battery warning re-arms below 20%",
  "file": "app/lib/wrist.js",
  "from": "} else if (battery >= 20) armed.low = true;\n",
  "to": "} else if (battery >= 16) armed.low = true;\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: battery warns at 15% and again only after 20%, at 5% and again only after 10%; the first reading after a boot counts"
  ]
 },
 {
  "label": "the very low battery warning re-arms below 10%",
  "file": "app/lib/wrist.js",
  "from": "} else if (battery >= 10) armed.empty = true;\n",
  "to": "} else if (battery >= 6) armed.empty = true;\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: battery warns at 15% and again only after 20%, at 5% and again only after 10%; the first reading after a boot counts"
  ]
 },
 {
  "label": "letters warn on a band that never held a secret",
  "file": "app/lib/wrist.js",
  "from": "      if (wasPaired) playWarn();                          // unpaired; the letters end any choice, so at once\n",
  "to": "      playWarn();\n",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a show with a new rev, or one not about the person, cancels a choice",
   "wrist.js: the check, waiting for its owner, and not in a room; KEY2 on the check says where to go, on the others only wakes",
   "wrist.js: the check number plays ask and flashes white twice, 150 on and 100 off; YES plays up on the white face",
   "wrist.js: a check that ends without YES plays fall as the letters come back; letters said again play nothing",
   "wrist.js: NOT NOW stays silent through waiting for the owner, and letters end it",
   "wrist.js: letters forget the meeting: paired again, the same number calls again",
   "wrist.js: new letters light for PAIR_AWAKE_MS, then go dark; a press of either key lights them again from the press and says PAIR ON YOUR PHONE for HINT_MS; a hold there is no hold",
   "wrist.js: the check stays lit; a press there says PAIR ON YOUR PHONE in place of ON YOUR PHONE? and a hold does nothing; the letters after it light, even with the same code",
   "wrist.js: an unpaired band out of reach does not warn"
  ]
 },
 {
  "label": "C++: out of reach warns again and again",
  "file": "firmware/src/band_logic.h",
  "from": "    if (!secret_.empty() && link_.stale(now) && !warnedReach_) {\n",
  "to": "    if (!secret_.empty() && link_.stale(now)) {\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: out of reach warns once, STALE_MS after a paired band lost the relay, flashing orange twice, and again only after it has had the relay back"
  ]
 },
 {
  "label": "C++: two warnings in one moment",
  "file": "firmware/src/band_logic.h",
  "from": "    for (const Reaction& r : moment_)\n      if (r.cls == 2) return;\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a first reading past both thresholds warns once",
   "band_logic.h: letters that end NOT NOW play one warning, however many are due"
  ]
 },
 {
  "label": "C++: an owed warning plays though it no longer holds",
  "file": "firmware/src/band_logic.h",
  "from": "    if (holds) playWarn();\n",
  "to": "    if (holds || owed_) playWarn();\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a warning in NOT NOW is owed: it plays once when NOT NOW ends, after that moment's SET and call, and not if it no longer holds"
  ]
 },
 {
  "label": "C++: a warning does not wait for a choice",
  "file": "firmware/src/band_logic.h",
  "from": "    if (silent_ || mode_ != REST) owed_ |= w;\n",
  "to": "    if (silent_) owed_ |= w;\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a warning that comes up during a choice waits, sound and flash, until the face rests"
  ]
 },
 {
  "label": "C++: the switch reset before the unpaired warning",
  "file": "firmware/src/band_logic.h",
  "from": "      if (wasPaired) playWarn();                  // unpaired; the letters end any choice, so at once\n      soundOn_ = true;                            // after the letters' own reactions\n",
  "to": "      soundOn_ = true;\n      if (wasPaired) playWarn();\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: unpaired warns when letters reach a band that held a secret, with the switch as it was; after a check without YES, fall plays instead"
  ]
 },
 {
  "label": "C++: the low battery warning re-arms below 20%",
  "file": "firmware/src/band_logic.h",
  "from": "      } else if (battery_ >= 20) {\n",
  "to": "      } else if (battery_ >= 16) {\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: battery warns at 15% and again only after 20%, at 5% and again only after 10%; the first reading after a boot counts"
  ]
 },
 {
  "label": "C++: away warns again after a reconnect",
  "file": "firmware/src/band_logic.h",
  "from": "    } else if (!warnedAway_) {\n",
  "to": "    } else {\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: away warns once at an away show; the same after a reconnect does not warn again; a show that is not away ends it"
  ]
 },
 {
  "label": "a moment's reactions play in the order they came",
  "file": "app/lib/wrist.js",
  "from": "const mine = moment.sort((a, b) => a.cls - b.cls);",
  "to": "const mine = moment;",
  "test": "tests/wrist.test.js",
  "expect": [
   "wrist.js: a warning in NOT NOW is owed: it plays once when NOT NOW ends, after that moment's SET and call, and not if it no longer holds"
  ]
 },
 {
  "label": "C++: a moment's reactions play in the order they came",
  "file": "firmware/src/band_logic.h",
  "from": "    std::stable_sort(moment_.begin(), moment_.end(), [](const Reaction& a, const Reaction& b) { return a.cls < b.cls; });\n",
  "to": "",
  "test": "tests/firmware.test.js",
  "expect": [
   "band_logic.h: a warning in NOT NOW is owed: it plays once when NOT NOW ends, after that moment's SET and call, and not if it no longer holds"
  ]
 }
]
````

- [ ] **Step 6: Commit, and close Stage A with P2**

```bash
git add app/lib/wrist.js firmware/src/band_logic.h app/screens/Band.jsx firmware/src/main.cpp firmware/host/logic_test.cpp tests/wrist-table.js tests/fixtures/wrist-cases.json
```

````bash
git commit -F - <<'EOF'
Warn once per change: out of reach, waiting, away, unpaired, the battery

Out of reach (a paired band, STALE_MS without the relay), waiting (STALE_MS
after it began), away, unpaired (letters reaching a band that held a
secret, with the switch as it was) and the battery (15% and 5%, re-armed at
20% and 10%; the first reading counts) each warn once when their condition
starts: warn, and orange twice. Losing the relay ends neither away nor
waiting. A warning that comes up in NOT NOW is owed and plays once when NOT
NOW ends, after that moment's result and call, if it still holds; one that
comes up during a choice waits for the face to rest. A moment plays one
warning. setBattery takes the time, as every other input does.

A moment's reactions are put in order before they play: a key or a
result, then a call, then a warning. So a warning owed through NOT NOW
plays after the SET and the call of the moment that ends it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---

## Stage B — The sound, carried

### Task 7: The band renders a sound as one buffer; red and orange

**Files:**
- Modify: `firmware/src/band_logic.h`, `app/lib/wrist.js`
- Test: `firmware/host/logic_test.cpp`, `firmware/host/as_band.cpp`, `tests/firmware.test.js`

**Interfaces:**
- Consumes: `SOUNDS` (Task 1).
- Produces:
  - C++: `SOUND_RATE = 16000`; `notesMs(notes, count)` and `longerOf(a, b)`, both `constexpr` and one `return` each; `longestSoundMs(i = 0)`; `SOUND_SAMPLES` (9600); `render(name, out, cap) -> size_t`, which writes an 8-bit unsigned triangle wave, 128 for a rest, each note starting at the middle of its wave (`phase = (i·hz + RATE/4) mod RATE`), at most `cap` samples, 0 for an unknown name; `RED {0xFF,0x6B,0x6B}`, `ORANGE {0xFF,0x8A,0x00}`; `plainField(field) -> const Rgb*` (red or orange, else `nullptr`). `soundMs` now sums with `notesMs`.
  - JS: `export const FLASH_COLOURS = { red: '#FF6B6B', orange: '#FF8A00' }`.
  - Host: `sound()` checks in `logic_test` (buffer size, lengths, a rest is 128, range and zero crossings, the cap, an unknown name, `plainField`); `speak flashcolours`.

- [ ] **Step 1: Write the failing tests.** The host checks the renderer; node holds the colours equal, and red equal to the phone's own `--stop`; `as_band.cpp` makes the band's compiler size the buffer.

In `firmware/host/logic_test.cpp`:

````diff
--- a/firmware/host/logic_test.cpp
+++ b/firmware/host/logic_test.cpp
@@ -367,6 +367,40 @@ void colour() {
   }
 }
 
+void sound() {
+  static uint8_t buf[SOUND_SAMPLES];
+  const size_t ms = SOUND_RATE / 1000;  // samples a millisecond
+  // One buffer holds the longest sound, jingle and warn at 0.6 s, and so every sound.
+  CHECK(SOUND_SAMPLES == 600 * ms);
+  for (const Sound& s : SOUNDS) CHECK(soundMs(s.name) * ms <= SOUND_SAMPLES);
+  // A sound is as long as its notes.
+  CHECK(render("tick", buf, sizeof buf) == 25 * ms);
+  CHECK(render("jingle", buf, sizeof buf) == SOUND_SAMPLES);
+  // A rest is silence, the middle of the range.
+  CHECK(render("double", buf, sizeof buf) == 110 * ms);
+  bool rest = true;
+  for (size_t i = 25 * ms; i < 85 * ms; ++i) rest = rest && buf[i] == 128;
+  CHECK(rest);
+  // A note is a triangle over the whole range, never 0, starting from the middle so it does not click in.
+  render("tick", buf, sizeof buf);
+  uint8_t lo = 255, hi = 0;
+  int ups = 0;
+  for (size_t i = 0; i < 25 * ms; ++i) {
+    lo = std::min(lo, buf[i]);
+    hi = std::max(hi, buf[i]);
+    if (i > 0 && buf[i - 1] < 128 && buf[i] >= 128) ++ups;
+  }
+  CHECK(buf[0] == 128 && lo >= 1 && lo <= 8 && hi >= 247);
+  CHECK(ups >= 44 && ups <= 45);  // 1800 Hz for 25 ms: 45 waves
+  // No more than the room it is given, and nothing for a name it does not know.
+  CHECK(render("jingle", buf, 100) == 100);
+  CHECK(render("hum", buf, sizeof buf) == 0);
+  // The flash colours: plain fills. Black, white and the cards are drawn another way.
+  CHECK(plainField("red") && *plainField("red") == (Rgb{0xFF, 0x6B, 0x6B}));
+  CHECK(plainField("orange") && *plainField("orange") == (Rgb{0xFF, 0x8A, 0x00}));
+  CHECK(!plainField("black") && !plainField("white") && !plainField("hi"));
+}
+
 void pairing() {
   CHECK(pairUrl("https://a.example//", "KXRT") == "https://a.example/pair/KXRT");
   CHECK(qrVersion(17) == 1 && qrVersion(18) == 2 && qrVersion(53) == 3 && qrVersion(78) == 4);
@@ -553,6 +587,10 @@ std::string answer(const Command& c) {
              ",\"count\":" + std::to_string(f.count) + ",\"on\":" + std::to_string(f.on) + ",\"off\":" + std::to_string(f.off) + "}";
     return out + "}";
   }
+  if (c.verb == "flashcolours") {
+    // The flash fields, as app/lib/wrist.js FLASH_COLOURS has them.
+    return "{\"red\":" + quote(hex(*plainField("red"))) + ",\"orange\":" + quote(hex(*plainField("orange"))) + "}";
+  }
   if (c.verb == "hues") {
     std::string out = "{";
     for (const Hue& h : HUES)
@@ -651,6 +689,7 @@ int main(int argc, char** argv) {
   text();
   face();
   colour();
+  sound();
   pairing();
   relay();
   rejoin();
````

In `tests/firmware.test.js`:

````diff
--- a/tests/firmware.test.js
+++ b/tests/firmware.test.js
@@ -11,7 +11,7 @@
 import { test, after } from 'node:test';
 import assert from 'node:assert/strict';
 import { spawnSync } from 'node:child_process';
-import { mkdtempSync, rmSync } from 'node:fs';
+import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
 import { tmpdir } from 'node:os';
 import { join } from 'node:path';
 import { fileURLToPath } from 'node:url';
@@ -20,7 +20,7 @@ import WebSocket from 'ws';
 import { createRelay, WS_PATH } from '../relay/server.js';
 import { HUE } from '../app/copy.js';
 import { codeFrom, pairUrl } from '../app/lib/pairing.js';
-import { CONSTS, FLASHES, SOUNDS } from '../app/lib/wrist.js';
+import { CONSTS, FLASH_COLOURS, FLASHES, SOUNDS } from '../app/lib/wrist.js';
 import { TABLE, lines, check } from './wrist-table.js';
 
 const idOf = (key) => createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex').slice(0, 32);
@@ -119,6 +119,13 @@ test('the colours on the wrist are the colours on the phone', { skip }, () => {
   assert.deepEqual(JSON.parse(hues), phone);
 });
 
+test("the flashes' red and orange are the stand-in's, and red is the phone's own --stop", { skip }, () => {
+  const [colours] = speak(['flashcolours']);
+  assert.deepEqual(JSON.parse(colours), FLASH_COLOURS);
+  const css = readFileSync(new URL('../app/styles.css', import.meta.url), 'utf8');
+  assert.equal(FLASH_COLOURS.red, css.match(/--stop:\s*(#[0-9A-Fa-f]{6})/)[1].toUpperCase());
+});
+
 test("the firmware hashes as node:crypto does, and its id is its key's hash", { skip }, () => {
   const inputs = ['', '616263', randomBytes(16).toString('hex'), randomBytes(55).toString('hex'), randomBytes(64).toString('hex'), randomBytes(200).toString('hex')];
   const got = speak(inputs.map((h) => 'sha256 ' + h));
````

In `firmware/host/as_band.cpp`:

````diff
--- a/firmware/host/as_band.cpp
+++ b/firmware/host/as_band.cpp
@@ -7,3 +7,5 @@
 #include "arduino_macros.h"
 
 #include "../src/band_logic.h"
+
+static_assert(otb::SOUND_SAMPLES > 0, "the sound buffers are sized when the band is built");
````

- [ ] **Step 2: Run and watch it fail**

Run: `npm run build >/dev/null && node --test tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: `ℹ pass 0`, `ℹ fail 1`. The first errors:

```text
SyntaxError: The requested module '../app/lib/wrist.js' does not provide an export named 'FLASH_COLOURS'
```

Red (1):

- tests\firmware.test.js

- [ ] **Step 3: Implement.**

In `firmware/src/band_logic.h`:

````diff
--- a/firmware/src/band_logic.h
+++ b/firmware/src/band_logic.h
@@ -94,12 +94,59 @@ inline const Sound* soundFor(const std::string& name) {
   return nullptr;
 }
 
+// The band's compiler takes C++11, where a constexpr function is one return
+// statement: so these sums recurse rather than loop.
+
+/** How long `count` notes last, in ms. */
+constexpr uint32_t notesMs(const Note* notes, size_t count) {
+  return count ? notes->ms + notesMs(notes + 1, count - 1) : 0;
+}
+
 inline uint32_t soundMs(const char* name) {
   const Sound* s = name ? soundFor(name) : nullptr;
-  uint32_t ms = 0;
-  if (s)
-    for (size_t i = 0; i < s->count; ++i) ms += s->notes[i].ms;
-  return ms;
+  return s ? notesMs(s->notes, s->count) : 0;
+}
+
+// A sound is played as one buffer of samples, so painting the face, which holds
+// the loop for tens of milliseconds, cannot bend a tune's rhythm.
+
+constexpr uint32_t SOUND_RATE = 16000;  // samples a second
+
+constexpr uint32_t longerOf(uint32_t a, uint32_t b) { return a > b ? a : b; }
+
+/** The longest sound in the table from the i-th on, in ms: from 0, what one buffer must hold. */
+constexpr uint32_t longestSoundMs(size_t i = 0) {
+  return i == sizeof(SOUNDS) / sizeof(SOUNDS[0]) ? 0
+                                                 : longerOf(notesMs(SOUNDS[i].notes, SOUNDS[i].count), longestSoundMs(i + 1));
+}
+
+constexpr size_t SOUND_SAMPLES = longestSoundMs() * (SOUND_RATE / 1000);  // one buffer
+
+/**
+ * A sound's notes as one triangle wave, 8 bits unsigned at SOUND_RATE, as
+ * M5.Speaker.playRaw() takes it: 128 is silence, and a rest is silence. Each
+ * note starts at the middle of its wave, so it does not click in. Writes at
+ * most `cap` samples; returns how many.
+ */
+inline size_t render(const std::string& name, uint8_t* out, size_t cap) {
+  const Sound* s = soundFor(name);
+  size_t n = 0;
+  if (!s) return 0;
+  for (size_t k = 0; k < s->count; ++k) {
+    const Note& note = s->notes[k];
+    const size_t samples = size_t(note.ms) * (SOUND_RATE / 1000);
+    for (size_t i = 0; i < samples && n < cap; ++i) {
+      if (!note.hz) {
+        out[n++] = 128;
+        continue;
+      }
+      // Where in its wave this sample is, from 0 to SOUND_RATE; a quarter in, the wave crosses the middle going up.
+      const int64_t phase = static_cast<int64_t>((uint64_t(i) * note.hz + SOUND_RATE / 4) % SOUND_RATE);
+      const int64_t v = phase < SOUND_RATE / 2 ? 4 * phase - SOUND_RATE : 3 * int64_t(SOUND_RATE) - 4 * phase;
+      out[n++] = static_cast<uint8_t>(128 + v * 127 / int64_t(SOUND_RATE));
+    }
+  }
+  return n;
 }
 
 /** A flash: its colour, then count × on / off ms. "card" is the card chosen, white for OFF. */
@@ -146,6 +193,18 @@ constexpr Hue HUES[] = {
 constexpr Rgb INK = {0x04, 0x14, 0x18};     // words on a lit face
 constexpr Rgb TEXT_2 = {0x9A, 0x99, 0xA4};  // words on a dark one
 
+// A flash's own colours (app/lib/wrist.js FLASH_COLOURS). Red is the phone's
+// --stop. Orange is not its --warn, which on this screen reads as FIRST SONG's yellow.
+constexpr Rgb RED = {0xFF, 0x6B, 0x6B};
+constexpr Rgb ORANGE = {0xFF, 0x8A, 0x00};
+
+/** A field that is one flat colour, or nullptr: black, white and the cards' glow are drawn another way. */
+inline const Rgb* plainField(const std::string& field) {
+  if (field == "red") return &RED;
+  if (field == "orange") return &ORANGE;
+  return nullptr;
+}
+
 inline const Hue* hueFor(const std::string& intent) {
   for (const Hue& h : HUES)
     if (intent == h.id) return &h;
````

In `app/lib/wrist.js`:

````diff
--- a/app/lib/wrist.js
+++ b/app/lib/wrist.js
@@ -75,6 +75,12 @@ export const FLASHES = {
   check: { colour: 'white', count: 2, on: 150, off: 100 },
 };
 
+/**
+ * The flash fields' colours. Red is the phone's own --stop. Orange is not its --warn, which on the band reads
+ * as FIRST SONG's yellow. band_logic.h plainField().
+ */
+export const FLASH_COLOURS = { red: '#FF6B6B', orange: '#FF8A00' };
+
 const soundMs = (name) => (name ? SOUNDS[name].reduce((ms, [, len]) => ms + len, 0) : 0);
 const flashMs = (f) => (f ? f.count * (f.on + f.off) : 0);
 
````

- [ ] **Step 4: Run** — the file, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 262`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "a rest is not silence",
  "file": "firmware/src/band_logic.h",
  "from": "        out[n++] = 128;\n",
  "to": "        out[n++] = 0;\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "a note clicks in at the bottom of its wave",
  "file": "firmware/src/band_logic.h",
  "from": "note.hz + SOUND_RATE / 4) % SOUND_RATE",
  "to": "note.hz) % SOUND_RATE",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "render ignores the room it is given (compiling form)",
  "file": "firmware/src/band_logic.h",
  "from": "i < samples && n < cap; ++i",
  "to": "i < samples && (n < cap || cap > 0); ++i",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic passes its own checks"
  ]
 },
 {
  "label": "the stand-in's orange drifts from the band's",
  "file": "app/lib/wrist.js",
  "from": "export const FLASH_COLOURS = { red: '#FF6B6B', orange: '#FF8A00' };",
  "to": "export const FLASH_COLOURS = { red: '#FF6B6B', orange: '#FBBF24' };",
  "test": "tests/firmware.test.js",
  "expect": [
   "the flashes' red and orange are the stand-in's, and red is the phone's own --stop"
  ]
 },
 {
  "label": "the buffer size is a C++14 constexpr loop again",
  "file": "firmware/src/band_logic.h",
  "from": "  return i == sizeof(SOUNDS) / sizeof(SOUNDS[0]) ? 0\n                                                 : longerOf(notesMs(SOUNDS[i].notes, SOUNDS[i].count), longestSoundMs(i + 1));\n",
  "to": "  uint32_t most = 0;\n  for (size_t k = i; k < sizeof(SOUNDS) / sizeof(SOUNDS[0]); ++k) most = longerOf(notesMs(SOUNDS[k].notes, SOUNDS[k].count), most);\n  return most;\n",
  "test": "tests/firmware.test.js",
  "expect": [
   "the wristband logic compiles as the band's compiler takes it: C++11, after Arduino's macros"
  ]
 }
]
````

- [ ] **Step 6: Commit**

```bash
git add firmware/src/band_logic.h app/lib/wrist.js firmware/host tests/firmware.test.js
```

````bash
git commit -F - <<'EOF'
Render a sound as one buffer on the band, and give its flashes red and orange

render() writes a sound's notes as one 8-bit triangle wave at 16 kHz, as
M5.Speaker.playRaw() takes it: rests are silence, each note starts at the
middle of its wave, and SOUND_SAMPLES, one buffer, is sized from the longest
sound in the table. That size is worked out when the band is built, by sums
that recurse: its C++11 takes a constexpr function only as one return. The
flash fields red (the phone's --stop) and orange are plain fills, held equal
to the stand-in's FLASH_COLOURS.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 8: The relay carries each person's switch to their own band

**Files:**
- Modify: `relay/band.js`, `relay/server.js`
- Test: `tests/band.test.js`, `tests/wristband.test.js`

**Interfaces:**
- Consumes: the room record and `showBand(b)` in `relay/server.js`; `bandShow(...)` in `relay/band.js`.
- Produces: phone message `{ t: 'sound', on: true | false }`, dropped unless `on` is a boolean; the room record's `sound: Map<person, boolean>`, deleted on `leave`, kept through the grace, gone with the room. `bandShow({ ..., sound = null })` adds `sound` to the test show, away and the person's own shows when it is not `null`, never to letters, the check or waiting. `showBand` passes `r?.sound.get(b.person) ?? null`.

- [ ] **Step 1: Write the failing tests.** A unit test on `bandShow`, and six socket tests: a flip reaches the band; malformed values, each on its own (a later valid one would mask a taken bad one); two people's switches stay apart; a band paired with the switch off gets it in its pairing flash; after a restart the claimed band's first show carries it; leave forgets it while away and the grace keep it (a second person keeps the room alive, or the room's own clean-up would mask the leave).

In `tests/band.test.js`:

````diff
--- a/tests/band.test.js
+++ b/tests/band.test.js
@@ -76,3 +76,23 @@ test('a show made from the view names what is armed and its rev; the others name
     assert.equal('armed' in s || 'rev' in s, false, JSON.stringify(s));
   }
 });
+
+test("the sound switch rides on every show to its person's band, and on none that is nobody's yet", () => {
+  const m = { id: 'm1', intent: 'song', number: 27, at: T };
+  for (const sound of [true, false]) {
+    for (const s of [bandShow({ view: view({ armed: 'hi' }), sound, now: T }), bandShow({ view: view(), sound, now: T }),
+      bandShow({ view: view({ invisible: true }), sound, now: T }), bandShow({ view: view({ armed: 'hi' }, [m]), sound, now: T }),
+      bandShow({ view: view(), testUntil: T + 1, sound, now: T }), bandShow({ view: null, sound, now: T })]) {
+      assert.equal(s.sound, sound, JSON.stringify(s));
+    }
+    for (const s of [bandShow({ view: view(), code: 'KXRT', sound, now: T }), bandShow({ view: view(), check: 12, sound, now: T }),
+      bandShow({ view: null, waiting: true, sound, now: T })]) {
+      assert.equal('sound' in s, false, JSON.stringify(s));
+    }
+  }
+  // A switch the relay has not heard makes exactly the show it made before there was one.
+  for (const v of [view({ armed: 'hi' }), null]) {
+    assert.equal('sound' in bandShow({ view: v, now: T }), false);
+    assert.equal('sound' in bandShow({ view: v, sound: null, now: T }), false);
+  }
+});
````

In `tests/wristband.test.js`:

````diff
--- a/tests/wristband.test.js
+++ b/tests/wristband.test.js
@@ -414,3 +414,98 @@ test('more than one set a second is refused too fast; a second on, the wrist may
     await own.close();
   }
 });
+
+// ---------- the sound switch (docs/superpowers/specs/2026-09-25-wrist-reactions-design.md §3) ----------
+
+test("a phone's sound switch rides on its band's shows: one show a flip, and none when nothing changed", async () => {
+  const { band, ana } = await wearing('sound-flip');
+  assert.equal('sound' in band.show, false, 'before the phone says it, the show is as it was');
+  let shows = 0;
+  band.ws.on('message', (d) => { if (JSON.parse(String(d)).t === 'show') shows++; });
+  ana.send({ t: 'sound', on: false });
+  await band.until((s) => s.sound === false);
+  ana.send({ t: 'sound', on: false });
+  ana.send({ t: 'profile', name: 'Ana' });
+  await pause(150);
+  assert.equal(shows, 1, 'the same again sends nothing');
+  ana.send({ t: 'sound', on: true });
+  await band.until((s) => s.sound === true);
+  await pause(50);
+  assert.equal(shows, 2);
+  close(ana, band);
+});
+
+test('a malformed sound is dropped', async () => {
+  const { band, ana } = await wearing('sound-bad');
+  for (const m of [{ t: 'sound' }, { t: 'sound', on: 'no' }, { t: 'sound', on: 0 }, { t: 'sound', on: 1 }, { t: 'sound', on: null }]) {
+    ana.send(m);
+    await pause(80);
+    assert.equal('sound' in band.show, false, JSON.stringify(m));
+  }
+  ana.send({ t: 'sound', on: false });
+  await band.until((s) => s.sound === false);
+  close(ana, band);
+});
+
+test("one person's switch never reaches another's band", async () => {
+  const { band, ana } = await wearing('sound-two');
+  const other = await wristband();
+  const ben = await phone('sound-two');
+  await pairBand(ben, other);
+  await other.until((s) => s.kind === 'off');
+  ana.send({ t: 'sound', on: false });
+  await band.until((s) => s.sound === false);
+  await pause(100);
+  assert.equal('sound' in other.show, false);
+  close(ana, ben, band, other);
+});
+
+test('a band paired with the switch off gets it in its pairing flash; letters and the check carry none', async () => {
+  const band = await wristband();
+  const ana = await phone('sound-pair');
+  ana.send({ t: 'sound', on: false });
+  await pause(50);
+  assert.equal('sound' in band.show, false, 'letters are nobody\'s');
+  ana.send({ t: 'pair', code: band.show.code });
+  await ana.until((v) => v.me.check);
+  assert.equal('sound' in (await band.until((s) => s.kind === 'check')), false);
+  ana.send({ t: 'confirm', yes: true });
+  assert.deepEqual(await band.until((s) => s.kind === 'test'), { kind: 'test', sound: false });
+  close(ana, band);
+});
+
+test("after a restart, a switch said before the claim is on the claimed band's first show; waiting carries none", async () => {
+  const secret = newKey();
+  const band = await wristband(62, { secret });
+  assert.deepEqual(band.show, { kind: 'waiting' });
+  const shows = [];
+  band.ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'show') shows.push(m.show); });
+  const ana = await phone('sound-claim');
+  ana.send({ t: 'sound', on: false });
+  ana.send({ t: 'pair', band: band.id, secret, again: true });
+  await band.until((s) => s.kind === 'off');
+  assert.equal(shows[0].sound, false, JSON.stringify(shows));
+  close(ana, band);
+});
+
+test('leave forgets the switch; the grace does not, and away carries it', async () => {
+  const { band, ana } = await wearing('sound-away');
+  const ben = await phone('sound-away');   // someone stays, so the room itself is never let go
+  ana.send({ t: 'sound', on: false });
+  await band.until((s) => s.sound === false);
+  ana.ws.close();
+  await pause(100);
+  relay.expire(Date.now() + BAND_ALONE_MS + 1_000);   // held only by the wristband, for the hour: out
+  assert.equal((await band.until((s) => s.away)).sound, false);
+  // Back, and gone for good: a band paired after leave hears nothing of the old switch.
+  const back = await phone('sound-away', { me: ana.me });
+  back.send({ t: 'leave' });
+  await reply(back, 'left');
+  const again = await phone('sound-away', { me: ana.me });
+  const next = await wristband();
+  again.send({ t: 'pair', code: next.show.code });
+  await again.until((v) => v.me.check);
+  again.send({ t: 'confirm', yes: true });
+  assert.deepEqual(await next.until((s) => s.kind === 'test'), { kind: 'test' });
+  close(again, ben, band, next);
+});
````

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build >/dev/null && node --test tests/band.test.js tests/wristband.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: `ℹ pass 35`, `ℹ fail 7`. The first errors:

```text
AssertionError [ERR_ASSERTION]: {"kind":"hi","intent":"hi","big":"HI :)","small":"blue means hello","dim":false,"armed":"hi","rev":0}
AssertionError [ERR_ASSERTION]: [{"kind":"off","battery":62,"armed":null,"rev":25776264}]
```

Red (7):

- the sound switch rides on every show to its person's band, and on none that is nobody's yet
- a phone's sound switch rides on its band's shows: one show a flip, and none when nothing changed
- a malformed sound is dropped
- one person's switch never reaches another's band
- a band paired with the switch off gets it in its pairing flash; letters and the check carry none
- after a restart, a switch said before the claim is on the claimed band's first show; waiting carries none
- leave forgets the switch; the grace does not, and away carries it

- [ ] **Step 3: Implement.**

In `relay/band.js`:

````diff
--- a/relay/band.js
+++ b/relay/band.js
@@ -26,6 +26,7 @@ const short = (s, n) => {
  * @param {number|null} p.check   set while a pairing waits for YES: the number the phone asks about
  * @param {boolean} p.waiting     after a relay restart, until its owner's phone claims it
  * @param {number} p.testUntil    TEST THE LIGHT runs until this time
+ * @param {boolean|null} p.sound  the person's sound switch, once their phone has said it; null before
  * @param {number} p.now
  *
  * A show made from the person's view carries `armed` (null for none) and the
@@ -33,15 +34,22 @@ const short = (s, n) => {
  * that is not, and names the state a choice was made from. The others —
  * pairing, the check, the test light, waiting, and not in a room — carry
  * neither.
+ *
+ * Once the relay has heard the person's sound switch, every show to their band
+ * carries it: their own, the test light (the white face that ends a pairing,
+ * and TEST THE LIGHT) and not in a room. Letters, the check and waiting carry
+ * none: those bands are nobody's yet, or not known to be whose. A show made
+ * without a known switch is exactly the show made before there was one.
  */
-export function bandShow({ view = null, battery = null, code = null, check = null, waiting = false, testUntil = 0, now = Date.now() }) {
+export function bandShow({ view = null, battery = null, code = null, check = null, waiting = false, testUntil = 0, sound = null, now = Date.now() }) {
   if (check) return { kind: 'check', big: String(check) };
   if (code) return { kind: 'pairing', code };
   if (waiting) return { kind: 'waiting' };
-  if (testUntil > now) return { kind: 'test' };
+  const said = sound === null ? {} : { sound };
+  if (testUntil > now) return { kind: 'test', ...said };
   const dim = battery !== null && battery <= DIM_AT;
-  if (!view) return { kind: 'off', battery, away: true };
-  const about = { armed: view.me.armed ?? null, rev: view.me.rev ?? 0 };
+  if (!view) return { kind: 'off', battery, away: true, ...said };
+  const about = { armed: view.me.armed ?? null, rev: view.me.rev ?? 0, ...said };
   // NOT NOW is black, completely. Nothing broadcasting, and nothing to read.
   if (view.me.invisible) return { kind: 'off', battery, quiet: true, ...about };
   const meet = view.matches
````

In `relay/server.js`:

````diff
--- a/relay/server.js
+++ b/relay/server.js
@@ -93,7 +93,8 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
       }
       const show = shows.find((s) => s.id === key);
       const spots = Array.isArray(show?.spots) && show.spots.length ? show.spots.map(String) : SPOTS;
-      rooms.set(key, { key, room: createRoom({ spots }), sockets: new Set(), clips: new Map(), left: new Map(), heard: new Map() });
+      // sound: each person's sound switch, as their phone last said it. Leaving forgets it; the grace does not.
+      rooms.set(key, { key, room: createRoom({ spots }), sockets: new Set(), clips: new Map(), left: new Map(), heard: new Map(), sound: new Map() });
     }
     return rooms.get(key);
   }
@@ -189,8 +190,10 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
 
   function showBand(b, now = clock()) {
     if (!b.ws) return;
-    const view = b.key ? rooms.get(b.key)?.room.viewFor(b.person) ?? null : null;
-    const text = JSON.stringify({ t: 'show', show: bandShow({ view, battery: b.battery, code: b.code, check: b.pending?.number ?? null, waiting: b.waiting, testUntil: b.testUntil, now }) });
+    const r = b.key ? rooms.get(b.key) : null;
+    const view = r?.room.viewFor(b.person) ?? null;
+    const sound = r?.sound.get(b.person) ?? null;
+    const text = JSON.stringify({ t: 'show', show: bandShow({ view, battery: b.battery, code: b.code, check: b.pending?.number ?? null, waiting: b.waiting, testUntil: b.testUntil, sound, now }) });
     if (text !== b.lastShow) { b.lastShow = text; b.ws.send(text); }
   }
 
@@ -468,6 +471,11 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
         if (b) { b.testUntil = now() + 2000; showBand(b); }
         break;
       }
+      case 'sound':
+        // The person's own switch, for their own band's shows. Like TEST THE LIGHT it reaches nobody else's.
+        if (typeof m.on !== 'boolean') return;
+        r.sound.set(me, m.on);
+        break;
       case 'pick': room.pick(me, m.track); break;
       case 'wave': room.wave(me, m.handle); break;
       case 'like': room.like(me, m.handle); break;
@@ -497,6 +505,7 @@ export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile
         const b = bandOf(r.key, me);
         if (b) unpairBand(b);
         stopGrace(r, me);
+        r.sound.delete(me);
         room.leave(me);
         r.sockets.delete(ws);
         ws.r = null;
````

- [ ] **Step 4: Run** — the files, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 269`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "sound missing from the test light",
  "file": "relay/band.js",
  "from": "  if (testUntil > now) return { kind: 'test', ...said };\n",
  "to": "  if (testUntil > now) return { kind: 'test' };\n",
  "test": "tests/wristband.test.js",
  "expect": [
   "a band paired with the switch off gets it in its pairing flash; letters and the check carry none"
  ]
 },
 {
  "label": "sound missing from away",
  "file": "relay/band.js",
  "from": "  if (!view) return { kind: 'off', battery, away: true, ...said };\n",
  "to": "  if (!view) return { kind: 'off', battery, away: true };\n",
  "test": "tests/wristband.test.js",
  "expect": [
   "leave forgets the switch; the grace does not, and away carries it"
  ]
 },
 {
  "label": "sound missing from the person's own shows",
  "file": "relay/band.js",
  "from": "  const about = { armed: view.me.armed ?? null, rev: view.me.rev ?? 0, ...said };\n",
  "to": "  const about = { armed: view.me.armed ?? null, rev: view.me.rev ?? 0 };\n",
  "test": "tests/wristband.test.js",
  "expect": [
   "a phone's sound switch rides on its band's shows: one show a flip, and none when nothing changed",
   "a malformed sound is dropped",
   "one person's switch never reaches another's band",
   "after a restart, a switch said before the claim is on the claimed band's first show; waiting carries none",
   "leave forgets the switch; the grace does not, and away carries it"
  ]
 },
 {
  "label": "letters carry the switch",
  "file": "relay/band.js",
  "from": "  if (code) return { kind: 'pairing', code };\n",
  "to": "  if (code) return { kind: 'pairing', code, ...(sound === null ? {} : { sound }) };\n",
  "test": "tests/band.test.js",
  "expect": [
   "the sound switch rides on every show to its person's band, and on none that is nobody's yet"
  ]
 },
 {
  "label": "a malformed sound is taken",
  "file": "relay/server.js",
  "from": "        if (typeof m.on !== 'boolean') return;\n",
  "to": "        if (!('on' in m)) return;\n",
  "test": "tests/wristband.test.js",
  "expect": [
   "a malformed sound is dropped"
  ]
 },
 {
  "label": "leave keeps the switch",
  "file": "relay/server.js",
  "from": "        r.sound.delete(me);\n",
  "to": "",
  "test": "tests/wristband.test.js",
  "expect": [
   "leave forgets the switch; the grace does not, and away carries it"
  ]
 },
 {
  "label": "the switch reaches another person's band",
  "file": "relay/server.js",
  "from": "    const sound = r?.sound.get(b.person) ?? null;\n",
  "to": "    const sound = [...(r?.sound.values() ?? [])][0] ?? null;\n",
  "test": "tests/wristband.test.js",
  "expect": [
   "one person's switch never reaches another's band"
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
Carry each person's sound switch to their own band, and to no other

A phone in a room may say {t:'sound', on:true|false}; anything but a boolean
on is dropped. The room keeps it per person: leave forgets it, the grace does
not, and it goes with the room. Once heard, it rides on every show to that
person's band (their own shows, the test light and away), never on letters,
the check or waiting, and never on anyone else's band. A flip sends one
show; a show made without a known switch is the show made before.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 9: The switch on the phone

**Files:**
- Create: `app/lib/bandsound.js`, `tests/store.test.js`
- Modify: `app/lib/store.js`, `app/lib/net.js`, `app/App.jsx`
- Test: `tests/net.test.js`, `tests/store.test.js`

**Interfaces:**
- Consumes: Task 8's `{ t: 'sound', on }`; `net.keep`, `net.say`, `SAID_ORDER` in `app/lib/net.js`.
- Produces: `soundRow(on) -> { icon, label, sub }` (`volume_up` / `SOUND: ON` / "tap for light only." and `volume_off` / `SOUND: OFF` / "light only. tap to hear it again."), `SOUND_SAY = { on: 'your wristband will chirp again.', off: 'your wristband will only light up.' }`; the store's top-level `bandSound` (on unless kept `false`); `SAID_ORDER = ['sound', 'pair', 'invisible', 'profile', 'pick', 'arm', 'leave']`. `App.jsx` keeps `{ t: 'sound', on }` at connect, and `flipSound` saves, says, closes the sheet and toasts. The row sits under TEST THE LIGHT, whose line becomes "it flashes white for two seconds, and chirps unless its sound is off or it is in NOT NOW."

- [ ] **Step 1: Write the failing tests.**

In `tests/net.test.js`:

````diff
--- a/tests/net.test.js
+++ b/tests/net.test.js
@@ -25,17 +25,19 @@ const lines = [];
 afterEach(() => { for (const n of lines.splice(0)) n.close(); });
 const open = (opts = {}) => { const n = connect({ venue: 'v', me: 'a'.repeat(32), ...opts }); lines.push(n); return n; };
 
-test('a page load queues nothing: what it holds goes out only as again copies, in order, claim first', () => {
+test('a page load queues nothing: what it holds goes out only as again copies, in order, the sound switch and then the claim first', () => {
   const n = open();
   n.keep('arm', { t: 'arm', intent: null, seq: 7 });
   n.keep('pick', { t: 'pick', track: 'Treasure' });
   n.keep('profile', { t: 'profile', name: 'Rae', contact: '' });
   n.keep('invisible', { t: 'invisible', on: false, seq: 7 });
   n.keep('pair', { t: 'pair', band: 'b'.repeat(32), secret: 'c'.repeat(32) });
+  // It touches nothing in the room, and a band claimed after a restart gets it in its first show.
+  n.keep('sound', { t: 'sound', on: false });
   const [sock] = FakeSocket.all;
   assert.deepEqual(sock.sent, [], 'nothing before the socket opens');
   sock.open();
-  assert.deepEqual(sock.sent.map((m) => m.t), ['join', 'pair', 'invisible', 'profile', 'pick', 'arm']);
+  assert.deepEqual(sock.sent.map((m) => m.t), ['join', 'sound', 'pair', 'invisible', 'profile', 'pick', 'arm']);
   assert.ok(sock.sent.slice(1).every((m) => m.again === true), 'every fact is marked again');
   assert.equal(sock.sent[0].quiet, undefined, 'a visible phone joins without quiet');
 });
````

Create `tests/store.test.js`:

````js
// ON THE BEAT — what the phone keeps across nights, and the wristband's sound switch as the phone says it.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SOUND_SAY, soundRow } from '../app/lib/bandsound.js';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { load, save } = await import('../app/lib/store.js');
beforeEach(() => mem.clear());

test('the sound switch is on unless the phone has kept it off, and it is kept beside the name, not in a night', () => {
  assert.equal(load().bandSound, true, 'on by default');
  save({ ...load(), bandSound: false });
  assert.equal(JSON.parse(mem.get('otb:v1')).bandSound, false);
  assert.equal(load().bandSound, false);
  mem.set('otb:v1', JSON.stringify({ bandSound: 'off' }));
  assert.equal(load().bandSound, true, 'anything but false is on');
});

test("the wristband sheet's row says the switch as it stands, and the phone says what a tap did", () => {
  assert.deepEqual(soundRow(true), { icon: 'volume_up', label: 'SOUND: ON', sub: 'tap for light only.' });
  assert.deepEqual(soundRow(false), { icon: 'volume_off', label: 'SOUND: OFF', sub: 'light only. tap to hear it again.' });
  assert.deepEqual(SOUND_SAY, { on: 'your wristband will chirp again.', off: 'your wristband will only light up.' });
});
````

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build >/dev/null && node --test tests/net.test.js tests/store.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`

Expected: `ℹ pass 3`, `ℹ fail 2`. The first errors:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'app/lib\bandsound.js' imported from tests/store.test.js
```

Red (2):

- a page load queues nothing: what it holds goes out only as again copies, in order, the sound switch and then the claim first
- tests\store.test.js

- [ ] **Step 3: Implement.**

Create `app/lib/bandsound.js`:

````js
// The wristband's sound switch, as the phone shows and says it
// (docs/superpowers/specs/2026-09-25-wrist-reactions-design.md §3). It is the
// person's own and outlasts the night; off, the band only lights up. The relay
// carries it to their band, and to no one else's.

/** The wristband sheet's row for the switch, as it stands. */
export function soundRow(on) {
  return on
    ? { icon: 'volume_up', label: 'SOUND: ON', sub: 'tap for light only.' }
    : { icon: 'volume_off', label: 'SOUND: OFF', sub: 'light only. tap to hear it again.' };
}

/** What the phone says once the switch is flipped, by where it now stands. */
export const SOUND_SAY = { on: 'your wristband will chirp again.', off: 'your wristband will only light up.' };
````

In `app/lib/store.js`:

````diff
--- a/app/lib/store.js
+++ b/app/lib/store.js
@@ -20,6 +20,7 @@ export function load() {
     name: typeof s.name === 'string' ? s.name : '',
     contact: typeof s.contact === 'string' ? s.contact : '',
     promisesSeen: !!s.promisesSeen,
+    bandSound: s.bandSound !== false,   // the wristband's sound switch: the person's own, on unless kept off
     nights: s.nights && typeof s.nights === 'object' ? s.nights : {},
     kept: Array.isArray(s.kept) ? s.kept : [],
   };
````

In `app/lib/net.js`:

````diff
--- a/app/lib/net.js
+++ b/app/lib/net.js
@@ -16,8 +16,12 @@ const PING_EVERY = 2000;
 const DEAF_MS = 6000;
 const QUEUE_MAX = 40;
 
-/** The order facts are re-said in: the claim first, so a wristband's kept hold lands before anything else. */
-export const SAID_ORDER = ['pair', 'invisible', 'profile', 'pick', 'arm', 'leave'];
+/**
+ * The order facts are re-said in. The sound switch first: it touches nothing in the room, and a wristband
+ * claimed after a restart gets it in its first show. Then the claim, so the wristband's kept hold lands
+ * before anything that changes the room.
+ */
+export const SAID_ORDER = ['sound', 'pair', 'invisible', 'profile', 'pick', 'arm', 'leave'];
 
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
+import { SOUND_SAY, soundRow } from './lib/bandsound.js';
 import { battery, buzz, toBase64 } from './lib/device.js';
 import { INTENT_OF, follow, nextSeq, tapMessage } from './lib/follow.js';
 import { connect } from './lib/net.js';
@@ -146,6 +147,7 @@ export default function App() {
     // A page load says nothing new (§3): what this phone holds is kept, and re-said only as again copies.
     const st = night.state || {};
     const seq = st.seq ?? 0;
+    n.keep('sound', { t: 'sound', on: s.bandSound });
     n.keep('profile', { t: 'profile', name: s.name, contact: s.contact });
     n.keep('invisible', { t: 'invisible', on: !!st.invisible, seq });
     n.keep('arm', { t: 'arm', intent: st.armed ?? null, seq });
@@ -404,13 +406,23 @@ export default function App() {
     say('unpaired. your phone is your light again.');
   };
 
+  // The wristband's sound: the person's own, kept across nights; the relay carries it to their band.
+  const flipSound = () => {
+    const on = !s.bandSound;
+    update((prev) => ({ ...prev, bandSound: on }));
+    net.current?.say('sound', { t: 'sound', on });
+    setSheet(null);
+    say(on ? SOUND_SAY.on : SOUND_SAY.off);
+  };
+
   const bandSheet = () => setSheet({
     title: 'Your wristband', sub: bandLine(bandShown), close: 'Done',
     rows: [
       ...(bandShown?.offline ? [{ icon: 'link', label: 'PAIR AGAIN', sub: 'it has been away a while. show its letters and pair it again.', fg: '#fff',
         onTap: () => { unpair(); go('pair'); } }] : []),
-      { icon: 'flashlight_on', label: 'TEST THE LIGHT', sub: 'it flashes white for two seconds.', fg: '#fff',
+      { icon: 'flashlight_on', label: 'TEST THE LIGHT', sub: 'it flashes white for two seconds, and chirps unless its sound is off or it is in NOT NOW.', fg: '#fff',
         onTap: () => { net.current?.send({ t: 'testLight' }); setSheet(null); say('watch your wrist.'); } },
+      { ...soundRow(s.bandSound), fg: '#fff', onTap: flipSound },
       { icon: 'link_off', label: 'UNPAIR', sub: 'it forgets you, and shows new letters.', fg: 'var(--stop)', onTap: unpair },
     ],
   });
````

- [ ] **Step 4: Run** — the files, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 271`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "sound after pair",
  "file": "app/lib/net.js",
  "from": "export const SAID_ORDER = ['sound', 'pair', 'invisible', 'profile', 'pick', 'arm', 'leave'];",
  "to": "export const SAID_ORDER = ['pair', 'sound', 'invisible', 'profile', 'pick', 'arm', 'leave'];",
  "test": "tests/net.test.js",
  "expect": [
   "a page load queues nothing: what it holds goes out only as again copies, in order, the sound switch and then the claim first"
  ]
 },
 {
  "label": "the switch off by default",
  "file": "app/lib/store.js",
  "from": "    bandSound: s.bandSound !== false,",
  "to": "    bandSound: s.bandSound === true,",
  "test": "tests/store.test.js",
  "expect": [
   "the sound switch is on unless the phone has kept it off, and it is kept beside the name, not in a night"
  ]
 }
]
````

- [ ] **Step 6: Commit, and close Stage B with P2**

```bash
git add app/lib/bandsound.js app/lib/store.js app/lib/net.js app/App.jsx tests/net.test.js tests/store.test.js
```

````bash
git commit -F - <<'EOF'
Put the band's sound switch in the wristband sheet, kept across nights

The wristband sheet gains SOUND: ON / SOUND: OFF. A tap flips it, closes the
sheet and says what the band will now do. The store keeps it at the top
level as bandSound, on unless kept off, so it outlasts the night. The phone
keeps it as a standing fact and says it first on every join, before the
claim, so a band claimed after a restart gets it in its first show. TEST THE
LIGHT's line says it chirps unless its sound is off or it is in NOT NOW.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---

## Stage C — The players

### Task 10: `main.cpp` plays and paints

**Files:**
- Modify: `firmware/src/main.cpp`, `firmware/platformio.ini`, `tests/firmware.test.js` (its header names the speaker)

**Interfaces:**
- Consumes: `Wrist::sounds()`, `render()`, `SOUND_SAMPLES`, `SOUND_RATE`, `plainField()`, `Screen` (with `LIGHT_OFF` on dark steps).
- Produces: the band plays and paints; `show` on the console reports free memory. Nothing here is on the laptop's tests: P3 builds it, and Task 14 proves it on the bands.

What M5Unified gives, read from its `Speaker_Class.hpp` and `.inl` (0.2.23):
- `playRaw(const uint8_t* data, size_t len, uint32_t rate, bool stereo, uint32_t repeat, int channel, bool stop_current_sound)` reads `data` for as long as the sound plays. Each channel has two slots: the one playing and one queued.
- `setBufferReleaseCallback(args, fn(args, data, channel))` (from 0.2.22) is called on the speaker's task once a request's buffer may be written again: after it finished, or when a newer request cut it. A request replaced while still only queued is discarded and **never** called back, but it was never read either. Set the callback before the first `play*()`.
- `isPlaying(channel)` counts the channel's occupied slots.
- On the StickC Plus, M5Unified drives the buzzer on GPIO 2 as the speaker, from the same samples. The first M5StickC has no speaker pin, so `begin()` returns false there (`_setup_i2s()` fails on `pin_data_out < 0`).

So: two buffers, used in turn; a buffer is written again only when its request has been released, or when the channel is quiet (which also frees a buffer whose request was discarded unread); the newest sound due plays, and a sound whose buffer is still held waits one time round the loop.

- [ ] **Step 1: The speaker, the player, the paint and the layout.**

In `firmware/src/main.cpp`:

````diff
--- a/firmware/src/main.cpp
+++ b/firmware/src/main.cpp
@@ -1,18 +1,18 @@
 // ON THE BEAT — the wristband: an M5StickC Plus, Plus2 or StickS3 on a strap.
 //
-// A light first and words second. It joins the relay exactly as /band does,
-// shows whatever the relay tells it to, and has two buttons. The face button
-// (KEY1): a press wakes it, a hold is NOT NOW. The side button (KEY2): a press
-// shows the card that is armed, more presses choose another, and the relay
-// decides. What it shows is decided by the relay (relay/band.js), from the
-// same view its person's phone is sent, so it can never show more than the
-// phone could.
+// A light first and words second, with a chirp unless its person has switched
+// that off. It joins the relay exactly as /band does, shows whatever the relay
+// tells it to, and has two buttons. The face button (KEY1): a press wakes it,
+// a hold is NOT NOW. The side button (KEY2): a press shows the card that is
+// armed, more presses choose another, and the relay decides. What it shows is
+// decided by the relay (relay/band.js), from the same view its person's phone
+// is sent, so it can never show more than the phone could.
 //
 // Everything that decides anything is in band_logic.h, which the tests build
 // and run on a laptop. This file is only the hardware round it: the screen,
-// the two buttons, the battery, Wi-Fi, the socket, and a serial console to say
-// which Wi-Fi and which relay. The socket has a task of its own, so nothing
-// the network does can hold up the button or the screen.
+// the speaker, the two buttons, the battery, Wi-Fi, the socket, and a serial
+// console to say which Wi-Fi and which relay. The socket has a task of its
+// own, so nothing the network does can hold up the button or the screen.
 
 #include <M5Unified.h>
 #include <Preferences.h>
@@ -65,8 +65,19 @@ std::string shown;                // what the console last said about a show
 int battery = -1;       // percent, or -1 while it will not say
 uint32_t batteryAt = 0;
 std::string drawn;      // what is on the screen now, so it is drawn again only when that changes
+int lit = -1;           // the backlight as last set
 std::string typed;      // the console line so far
 
+// Sounds play from buffers of their own, on the speaker's own task. playRaw()
+// reads a buffer for as long as it plays, so there are two, used in turn, and
+// one is written again only once the speaker has let it go.
+constexpr int SOUND_CHANNEL = 0;
+bool speaker = false;                   // the first M5StickC has none: it only lights up
+uint8_t soundBuf[2][SOUND_SAMPLES];
+std::atomic<bool> soundHeld[2];         // a sound on this buffer the speaker has not let go of yet
+int soundNext = 0;                      // the buffer the next sound goes in
+std::string soundDue;                   // the newest sound not started yet
+
 constexpr uint16_t BLACK = 0x0000;
 constexpr uint16_t WHITE = 0xFFFF;
 
@@ -328,17 +339,23 @@ void drawLines(const std::vector<std::string>& lines, const lgfx::IFont* font, i
   }
 }
 
+/** A small line wrapped to the width, in the largest of the small fonts it fits; none if it is empty. */
+Fit fitSmall(const std::string& text, int maxW, int maxH) {
+  if (text.empty()) return Fit{};
+  return fit(text, 3, maxW, maxH, [](int i, const std::string& s) { return widthIn(SMALL[i], s); }, smallStep);
+}
+
+/** How tall fitted small lines stand. */
+int linesHeight(const Fit& f) { return static_cast<int>(f.lines.size()) * smallStep(f.font); }
+
 /** One or two short lines, big over small, in the middle of the face. */
 void drawWords(const Words& w, uint16_t ink, float k) {
   const int W = face.width(), H = face.height();
   const int maxW = W - 2 * px(10, k);
   const Fit big = fit(w.big, 3, maxW, H * 3 / 5, [](int i, const std::string& s) { return widthIn(BIG[i], s); }, bigStep);
-  Fit small;
-  if (!w.small.empty())
-    small = fit(w.small, 3, maxW, H / 4, [](int i, const std::string& s) { return widthIn(SMALL[i], s); }, smallStep);
+  const Fit small = fitSmall(w.small, maxW, H / 4);
   const int gap = small.lines.empty() ? 0 : px(6, k);
-  int y = (H - (static_cast<int>(big.lines.size()) * bigStep(big.font) + gap +
-                static_cast<int>(small.lines.size()) * smallStep(small.font))) / 2;
+  int y = (H - (static_cast<int>(big.lines.size()) * bigStep(big.font) + gap + linesHeight(small))) / 2;
   face.setTextColor(ink);
   face.setTextDatum(lgfx::textdatum_t::top_center);
   drawLines(big.lines, BIG[big.font], bigStep(big.font), y);
@@ -346,21 +363,22 @@ void drawWords(const Words& w, uint16_t ink, float k) {
   drawLines(small.lines, SMALL[small.font], smallStep(small.font), y);
 }
 
-/** After a mutual yes: MEET, over the number both wrists show. */
+/**
+ * A number under its word: MEET after a mutual yes, or the pairing check's ON
+ * YOUR PHONE?, which is wider than the face and so is wrapped, as the hint is.
+ */
 void drawMeet(const Words& w, uint16_t ink, float k) {
   const int W = face.width(), H = face.height();
   const int maxW = W - 2 * px(10, k);
   const float size = std::min(2.0f * k, static_cast<float>(maxW) / std::max(1, widthIn(NUMBER, w.big)));
-  const int smallH = heightOf(SMALL[0]);
+  const Fit small = fitSmall(w.small, maxW, H / 4);
   const int numH = heightOf(NUMBER, size) * 3 / 4;
   const int gap = px(6, k);
-  int y = (H - (smallH + gap + numH)) / 2;
+  int y = (H - (linesHeight(small) + gap + numH)) / 2;
   face.setTextColor(ink);
   face.setTextDatum(lgfx::textdatum_t::top_center);
-  face.setFont(SMALL[0]);
-  face.setTextSize(1);
-  face.drawString(w.small.c_str(), W / 2, y);
-  y += smallH + gap;
+  drawLines(small.lines, SMALL[small.font], smallStep(small.font), y);
+  y += gap;
   face.setFont(NUMBER);
   face.setTextSize(size);
   face.drawString(w.big.c_str(), W / 2, y);
@@ -371,9 +389,10 @@ void drawMeet(const Words& w, uint16_t ink, float k) {
  * Pairing: a code to scan over the four letters to type. The code is as wide
  * as the screen allows, with four light modules round it — a tunnel address
  * is a version 4 code, and the canvas's 115 pixels would make each module two
- * pixels, too small for a phone to read off a screen this size.
+ * pixels, too small for a phone to read off a screen this size. A press puts
+ * the hint, PAIR ON YOUR PHONE, under the letters, in what height is left.
  */
-void drawPairing(const std::string& code, float k) {
+void drawPairing(const std::string& code, const std::string& hint, float k) {
   const int W = face.width(), H = face.height();
   const std::string url = relay.ok ? pairUrl(relay.origin, code) : "";
   const int version = url.empty() ? 0 : qrVersion(url.size());
@@ -385,7 +404,9 @@ void drawPairing(const std::string& code, float k) {
   const int track = advance * 12 / 100;  // the canvas spaces the letters .12em apart
   const int codeH = heightOf(CODE[font]);
   const int gap = box ? px(16, k) : 0;
-  int y = (H - (box + gap + codeH)) / 2;
+  const int hintGap = hint.empty() ? 0 : px(6, k);
+  const Fit words = fitSmall(hint, W - 2 * px(10, k), H - (box + gap + codeH + hintGap) - 2 * px(4, k));
+  int y = (H - (box + gap + codeH + hintGap + linesHeight(words))) / 2;
   if (box) {
     const int x = (W - box) / 2;
     face.fillRect(x, y, box, box, WHITE);
@@ -403,6 +424,8 @@ void drawPairing(const std::string& code, float k) {
     face.drawString(one, x, y);
     x += advance + track;
   }
+  y += codeH + hintGap;
+  drawLines(words.lines, SMALL[words.font], smallStep(words.font), y);
 }
 
 uint16_t inkOf(const std::string& ink) {
@@ -417,6 +440,8 @@ void paint(const Screen& s) {
   const float k = std::min(W / 135.0f, H / 240.0f);  // the canvas draws the wristband 135 x 240
   if (s.field == "white") {
     face.fillScreen(WHITE);
+  } else if (const Rgb* c = plainField(s.field)) {  // a flash's on step: one flat colour
+    face.fillScreen(rgb565(*c));
   } else if (const Hue* hue = hueFor(s.field)) {
     for (int y = 0; y < H; ++y)
       for (int x = 0; x < W; ++x) face.drawPixel(x, y, rgb565(glow(*hue, x, y, W, H)));
@@ -427,7 +452,7 @@ void paint(const Screen& s) {
   const Words w{s.big, s.small};
   // A number — the meeting number, or the pairing check — stands large under its word.
   const bool number = !s.big.empty() && s.big.find_first_not_of("0123456789") == std::string::npos;
-  if (!s.code.empty()) drawPairing(s.code, k);
+  if (!s.code.empty()) drawPairing(s.code, s.small, k);
   else if (number) drawMeet(w, ink, k);
   else if (!s.big.empty() || !s.small.empty()) drawWords(w, ink, k);
   if (s.bar >= 0) {  // KEEP HOLDING: how far to NOT NOW
@@ -439,13 +464,61 @@ void paint(const Screen& s) {
 
 void draw(uint32_t now) {
   const Screen s = wrist->face(now);
-  const std::string key = s.big + '|' + s.small + '|' + s.field + '|' + s.ink + '|' + std::to_string(s.light) + '|' +
-                          std::to_string(s.bar) + '|' + s.code + '|' + relay.origin;
-  if (key == drawn) return;
-  drawn = key;
-  paint(s);
-  face.pushSprite(0, 0);
-  M5.Display.setBrightness(s.light);
+  // The picture is drawn again only when it changes and can be seen. A change
+  // of light alone (a flash's off step, the meeting's blink, a face going to
+  // sleep) only turns the backlight, so a blink that goes on all night never
+  // holds up the loop and a quick tap is not missed. What lies under the dark
+  // is never seen, so it is not drawn.
+  if (s.light != LIGHT_OFF) {
+    const std::string key = s.big + '|' + s.small + '|' + s.field + '|' + s.ink + '|' + std::to_string(s.bar) + '|' +
+                            s.code + '|' + relay.origin;
+    if (key != drawn) {
+      drawn = key;
+      paint(s);
+      face.pushSprite(0, 0);
+    }
+  }
+  if (s.light != lit) {
+    lit = s.light;
+    M5.Display.setBrightness(s.light);
+  }
+}
+
+// ---------- sound ----------
+
+/** The speaker has finished reading a buffer, so it may be written again. Runs on the speaker's own task. */
+void soundReleased(void*, const void* data, uint8_t) {
+  for (int i = 0; i < 2; ++i)
+    if (data == soundBuf[i]) soundHeld[i] = false;
+}
+
+/**
+ * Starts the newest sound the wrist has due, cutting off the one playing. If
+ * the speaker still holds the buffer it goes in, it waits for the next time
+ * round. A sound cut off before it began is never let go, but never read
+ * either, so once the speaker is quiet its buffer is free.
+ */
+void playSounds() {
+  for (std::string& name : wrist->sounds()) soundDue = std::move(name);
+  if (soundDue.empty()) return;
+  if (!speaker) {
+    soundDue.clear();
+    return;
+  }
+  const int i = soundNext;
+  if (soundHeld[i]) {
+    if (M5.Speaker.isPlaying(SOUND_CHANNEL)) return;
+    soundHeld[i] = false;
+  }
+  const size_t n = render(soundDue, soundBuf[i], SOUND_SAMPLES);
+  soundHeld[i] = true;
+  if (n && M5.Speaker.playRaw(soundBuf[i], n, SOUND_RATE, false, 1, SOUND_CHANNEL, true)) {
+    Serial.printf("sound: %s\n", soundDue.c_str());
+    soundNext = 1 - i;
+  } else {
+    soundHeld[i] = false;
+  }
+  soundDue.clear();
 }
 
 // ---------- the serial console ----------
@@ -468,6 +541,9 @@ void report() {
                 charging == m5::Power_Class::is_charging      ? " (charging)"
                 : charging == m5::Power_Class::is_discharging ? " (not charging)"
                                                               : "");
+  // The Plus has no PSRAM: the sound buffers and the face leave this much for a TLS handshake.
+  Serial.printf("memory  %u bytes free, %u at the least; sound %s\n", static_cast<unsigned>(ESP.getFreeHeap()),
+                static_cast<unsigned>(ESP.getMinFreeHeap()), speaker ? "on the speaker" : "none: light only");
 }
 
 void run(const Command& c) {
@@ -541,6 +617,13 @@ void setup() {
   M5.Display.setBrightness(LIGHT_OFF);
   face.setColorDepth(16);
   face.createSprite(M5.Display.width(), M5.Display.height());
+  // The speaker, as the sound test had it: the microphone off first (on some
+  // bands the two share one I2S), then full volume. The StickC Plus plays the
+  // same samples through its buzzer.
+  M5.Mic.end();
+  M5.Speaker.setBufferReleaseCallback(nullptr, soundReleased);
+  speaker = M5.Speaker.begin();
+  M5.Speaker.setVolume(255);
 
   // The radio on before the key is made: with it on, esp_random() is true noise.
   WiFi.mode(WIFI_STA);
@@ -553,6 +636,7 @@ void setup() {
   wrist->setBattery(battery, millis());
 
   Serial.println("\nON THE BEAT wristband");
+  if (!speaker) Serial.println("no speaker on this band: it only lights up");
   help();
   events = xQueueCreate(12, sizeof(Event));
   outbox = xQueueCreate(8, sizeof(Out));
@@ -583,6 +667,7 @@ void loop() {
   watchWifi(now);
   wrist->setWifi(WiFi.status() == WL_CONNECTED);
   wrist->tick(now);
+  playSounds();  // before the frames and the face: a press's tick is heard as soon as it can be
   for (const std::string& f : wrist->take()) sendFrame(f);
   if (wrist->up() && batteryReport.due(battery, now)) {
     sendFrame(batteryFrame(battery));
````

In `firmware/platformio.ini`:

````diff
--- a/firmware/platformio.ini
+++ b/firmware/platformio.ini
@@ -24,14 +24,16 @@ framework = arduino
 board_build.partitions = huge_app.csv
 monitor_speed = 115200
 build_flags = -DCORE_DEBUG_LEVEL=1
+; M5Unified from 0.2.22 for the speaker's buffer release callback, which the
+; sounds wait on before writing a buffer again (main.cpp playSounds()).
 lib_deps =
-  m5stack/M5Unified@^0.2.2
+  m5stack/M5Unified@^0.2.22
   links2004/WebSockets@^2.6.1
 
 ; The M5StickS3: ESP32-S3-PICO-1-N8R8 (8 MB flash, 8 MB octal PSRAM), set up
 ; as M5Stack's StickS3 page sets it up. There is no USB-serial chip: the
 ; console is the S3's own USB, hence USB_CDC_ON_BOOT. M5Unified knows the
-; StickS3 from 0.2.14.
+; StickS3 from 0.2.14; the sounds need 0.2.22, as above.
 [env:m5sticks3]
 platform = espressif32@^6.9.0
 board = esp32-s3-devkitc-1
@@ -45,5 +47,5 @@ build_flags =
   -DARDUINO_USB_CDC_ON_BOOT=1
   -DARDUINO_USB_MODE=1
 lib_deps =
-  m5stack/M5Unified@^0.2.14
+  m5stack/M5Unified@^0.2.22
   links2004/WebSockets@^2.6.1
````

In `tests/firmware.test.js`:

````diff
--- a/tests/firmware.test.js
+++ b/tests/firmware.test.js
@@ -4,9 +4,9 @@
 // firmware/src/band_logic.h, plain C++, so it is built here with this
 // machine's own compiler: it runs its own checks, then the frames it sends
 // go to a real relay, and every frame the relay sends back is read by it.
-// None of this needs a wristband. The hardware round it — screen, button,
-// Wi-Fi — is only built by PlatformIO. With no C++ compiler here these say so
-// and skip.
+// None of this needs a wristband. The hardware round it — screen, buttons,
+// speaker, Wi-Fi — is only built by PlatformIO. With no C++ compiler here
+// these say so and skip.
 
 import { test, after } from 'node:test';
 import assert from 'node:assert/strict';
````

- [ ] **Step 2: Build both envs (P3).** Expected: two `[SUCCESS]`, no `src/` warning, and the StickC Plus at `RAM: 21.5% (used 70344 bytes from 327680 bytes)`. Before this task it was 51,088 bytes: the two buffers are 19,200 of the difference.

- [ ] **Step 3: Run** `npm test`. Expected: `ℹ fail 0`, `ℹ tests 271`.

- [ ] **Step 4: Commit**

```bash
git add firmware/src/main.cpp firmware/platformio.ini tests/firmware.test.js
```

````bash
git commit -F - <<'EOF'
Play the band's sounds on its speaker, and draw its flashes

main.cpp starts the speaker as the sound test did and plays the newest
sound the wrist has due from one of two buffers, written again only once
M5Unified's buffer release callback says the speaker has let it go, which
needs M5Unified 0.2.22. Red and orange are plain fills. A change of light
alone only turns the backlight, and nothing is drawn under the dark. The
check's line and the hint under the letters are fitted like drawWords'.
show reports free memory: the buffers take the Plus's static RAM from
51 KB to 70 KB.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 11: `/band` plays and paints

**Files:**
- Create: `app/lib/speaker.js`, `tests/speaker.test.js`
- Modify: `app/screens/Band.jsx`, `app/styles.css`

**Interfaces:**
- Consumes: `SOUNDS`, `FLASH_COLOURS`, `wrist.sounds()`.
- Produces: `notesAt(name, at) -> [{ hz, start, stop }]` (seconds; a rest only takes its time); `createSpeaker(make = () => new AudioContext()) -> { unlock(), ready(), play(name) }`: the context is made at the first tap, a note is a triangle oscillator started and stopped on the audio clock at `LEVEL = 0.5`, `play` cuts off the last sound, and before a tap, while suspended, or for an unknown name it plays nothing and returns `false`. `/band`: capture-phase `pointerdown`/`keydown` unlock the speaker; every flush plays the newest sound due; a key flushes at once through `flushRef`; the operator panel says whether it can sound yet; `WristFace` draws `FLASH_COLOURS` flat and has no transition (a 380 ms fade would blur a 150 ms flash); `Pairing` takes `hint` and draws it under the letters.

- [ ] **Step 1: Write the failing test** (a fake `AudioContext` that records every oscillator).

Create `tests/speaker.test.js`:

````js
// ON THE BEAT — the stand-in's speaker: the band's notes in the band's rhythm,
// and silent until the page has been tapped. A fake AudioContext stands in for
// the browser's, and records every oscillator it is asked for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOUNDS } from '../app/lib/wrist.js';
import { createSpeaker, notesAt } from '../app/lib/speaker.js';

/** An AudioContext that plays nothing and remembers everything. `running` is where resume() leaves it. */
function fakeContext({ running = true } = {}) {
  const ctx = {
    state: 'suspended',
    currentTime: 5,
    destination: {},
    oscillators: [],
    resume() { if (running) ctx.state = 'running'; return Promise.resolve(); },
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createOscillator() {
      const o = { type: 'sine', frequency: { value: 440 }, started: null, stopped: [], connect() {} };
      o.start = (t) => { o.started = t; };
      o.stop = (t = 0) => { o.stopped.push(t); };
      ctx.oscillators.push(o);
      return o;
    },
  };
  return ctx;
}

const close = (a, b) => Math.abs(a - b) < 1e-9;

test("each sounding note starts where the one before it ended, and a rest only takes its time", () => {
  const ask = notesAt('ask', 10);
  assert.deepEqual(ask.map((n) => n.hz), [1319, 1760]);
  assert.ok(close(ask[0].start, 10) && close(ask[0].stop, 10.08));
  assert.ok(close(ask[1].start, 10.13) && close(ask[1].stop, 10.29), 'after the 50 ms rest');
  for (const [name, notes] of Object.entries(SOUNDS)) {
    const at = notesAt(name, 0);
    const total = notes.reduce((t, [, ms]) => t + ms, 0) / 1000;
    assert.equal(at.length, notes.filter(([hz]) => hz).length, name);
    assert.ok(close(at.at(-1).stop, total), name + ' ends when its notes do');
  }
  assert.deepEqual(notesAt('no such sound', 0), []);
});

test('it is silent until the page has been tapped, and silent if the browser keeps it suspended', () => {
  const ctx = fakeContext();
  const speaker = createSpeaker(() => ctx);
  assert.equal(speaker.play('up'), false, 'before a tap');
  assert.equal(ctx.oscillators.length, 0);
  assert.equal(speaker.ready(), false);

  const held = fakeContext({ running: false });
  const quiet = createSpeaker(() => held);
  quiet.unlock();
  assert.equal(quiet.play('up'), false, 'suspended');
  assert.equal(held.oscillators.length, 0);
});

test("after a tap it plays the band's notes as triangle waves, on the audio clock, and a new sound cuts off the last", () => {
  const ctx = fakeContext();
  const speaker = createSpeaker(() => ctx);
  speaker.unlock();
  assert.equal(speaker.ready(), true);
  assert.equal(speaker.play('up'), true);
  const up = ctx.oscillators.slice();
  assert.deepEqual(up.map((o) => [o.type, o.frequency.value]), SOUNDS.up.map(([hz]) => ['triangle', hz]));
  notesAt('up', 5).forEach((n, i) => {
    assert.ok(close(up[i].started, n.start) && close(up[i].stopped[0], n.stop), 'note ' + i);
  });

  assert.equal(speaker.play('tick'), true);
  for (const o of up) assert.equal(o.stopped.length, 2, 'cut off');
  assert.equal(ctx.oscillators.length, up.length + 1);
  assert.equal(speaker.play('no such sound'), false);
  assert.equal(ctx.oscillators.length, up.length + 1);
});
````

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/speaker.test.js 2>&1 | grep -E "^✖|Cannot find|^ℹ (pass|fail)"`

Expected: `ℹ pass 0`, `ℹ fail 1`. The first errors:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'app/lib\speaker.js' imported from tests/speaker.test.js
```

Red (1):

- tests\speaker.test.js

- [ ] **Step 3: Implement.**

Create `app/lib/speaker.js`:

````js
// The wristband's speaker, in a browser (/band). The band renders a sound's
// notes into one triangle wave (band_logic.h render()); here each note is a
// triangle oscillator, started and stopped on the audio clock, so the page's
// own drawing cannot bend the rhythm either. A browser lets a page make sound
// only after it has been tapped, so it is silent until then. A new sound cuts
// off the one playing, as the band's does.

import { SOUNDS } from './wrist.js';

// Softer than the band, which plays at its full volume: a browser at full volume can be a headphone's.
const LEVEL = 0.5;

/** When each sounding note of a sound starts and stops, in seconds from `at`. A rest only takes its time. */
export function notesAt(name, at) {
  const out = [];
  let t = at;
  for (const [hz, ms] of SOUNDS[name] || []) {
    if (hz) out.push({ hz, start: t, stop: t + ms / 1000 });
    t += ms / 1000;
  }
  return out;
}

/** A speaker whose AudioContext is made at the first tap. `make` is for the tests. */
export function createSpeaker(make = () => new AudioContext()) {
  let ctx = null;
  let out = null;
  let playing = [];
  return {
    /** Call from a tap: from then on it may sound. */
    unlock() {
      try {
        if (!ctx) {
          ctx = make();
          out = ctx.createGain();
          out.gain.value = LEVEL;
          out.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
      } catch { /* no Web Audio here: it stays silent */ }
    },
    /** Can it sound now? */
    ready: () => ctx?.state === 'running',
    /** Plays one sound, cutting off the last. Before a tap, or for a name it does not know, nothing. */
    play(name) {
      if (ctx?.state !== 'running' || !SOUNDS[name]) return false;
      for (const o of playing) {
        try { o.stop(); } catch { /* over already */ }
      }
      playing = notesAt(name, ctx.currentTime).map(({ hz, start, stop }) => {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = hz;
        o.connect(out);
        o.start(start);
        o.stop(stop);
        return o;
      });
      return true;
    },
  };
}
````

In `app/screens/Band.jsx`:

````diff
--- a/app/screens/Band.jsx
+++ b/app/screens/Band.jsx
@@ -4,7 +4,8 @@ import { CODE_LETTERS, cleanCode } from '../../relay/band.js';
 import { pairUrl } from '../lib/pairing.js';
 import { qrMatrix, qrPath } from '../lib/qr.js';
 import { toHex } from '../lib/sha256.js';
-import { HOLD_MS, WAKE_MS, createWrist } from '../lib/wrist.js';
+import { createSpeaker } from '../lib/speaker.js';
+import { FLASH_COLOURS, HOLD_MS, WAKE_MS, createWrist } from '../lib/wrist.js';
 import { Back, Ghost, Icon } from '../ui.jsx';
 
 /**
@@ -52,19 +53,24 @@ export function BandFace({ show, awake, battery, scale = 2, pairAt = null }) {
 
 const INK = { ink: '#041418', white: '#FFFFFF', text2: 'var(--text-2)' };
 
-/** What the Wrist says to draw (app/lib/wrist.js face()): one field, two lines, the bar, and letters with their code. */
+/**
+ * What the Wrist says to draw (app/lib/wrist.js face()): one field, two lines,
+ * the bar, and letters with their code and the hint under them. A flash's red
+ * and orange are flat, as on the band.
+ */
 export function WristFace({ screen: s, scale = 2, pairAt = null }) {
   const hue = HUE[s.field];
   const bg = s.field === 'white' ? '#FFFFFF'
-    : hue ? `radial-gradient(120% 90% at 50% 38%, ${hue.c} 0%, ${hue.g} 100%)` : '#000000';
+    : FLASH_COLOURS[s.field] ?? (hue ? `radial-gradient(120% 90% at 50% 38%, ${hue.c} 0%, ${hue.g} 100%)` : '#000000');
   const ink = INK[s.ink] ?? HUE[s.ink]?.c ?? INK.text2;
   // The backlight: dark is off, not a black picture lit from behind.
   const glow = s.light ? Math.max(0.35, s.light / 255) : 0;
   const number = /^\d+$/.test(s.big);
   return (
-    <div className="bandface" style={{ width: 135 * scale, height: 240 * scale, '--u': scale + 'px', background: bg, filter: `brightness(${glow})` }}
-      role="img" aria-label={s.code ? 'Wristband showing its pairing letters ' + s.code.split('').join(' ') : s.light ? 'Wristband: ' + [s.big, s.small].filter(Boolean).join(', ') : 'Wristband dark'}>
-      {s.code ? <Pairing code={s.code} at={pairAt} />
+    // The band changes at once: a fade would blur a 150 ms flash and the meeting's blink.
+    <div className="bandface" style={{ width: 135 * scale, height: 240 * scale, '--u': scale + 'px', background: bg, filter: `brightness(${glow})`, transition: 'none' }}
+      role="img" aria-label={s.code ? 'Wristband showing its pairing letters ' + s.code.split('').join(' ') + (s.small ? ', ' + s.small : '') : s.light ? 'Wristband: ' + [s.big, s.small].filter(Boolean).join(', ') : 'Wristband dark'}>
+      {s.code ? <Pairing code={s.code} at={pairAt} hint={s.small} />
         : number ? <span className="words meet" style={{ color: ink }}><span className="small-w">{s.small}</span><span className="num">{s.big}</span></span>
         : s.big || s.small ? (
           <span className="words" style={{ color: ink }}>
@@ -77,8 +83,8 @@ export function WristFace({ screen: s, scale = 2, pairAt = null }) {
   );
 }
 
-/** Pairing: a code to scan over the four letters to type. Either one pairs. */
-function Pairing({ code, at }) {
+/** Pairing: a code to scan over the four letters to type. Either one pairs. A press puts the hint under them. */
+function Pairing({ code, at, hint = '' }) {
   const qr = useMemo(() => (at ? qrMatrix(at) : null), [at]);
   const box = qr ? qr.size + 8 : 0;
   return (
@@ -90,6 +96,7 @@ function Pairing({ code, at }) {
         </svg>
       ) : null}
       <span className="code">{code}</span>
+      {hint ? <span className="small-w hint">{hint}</span> : null}
     </span>
   );
 }
@@ -152,7 +159,7 @@ export const bandLine = (band) => (band
  * /band — a stand-in for the wristband, until one is in hand. The machine is
  * app/lib/wrist.js, the same one band_logic.h runs on the real band and held
  * to the same table; this page only feeds it the socket, the two buttons and
- * the time, and draws its face at 2x.
+ * the time, draws its face at 2x, and plays its sounds (app/lib/speaker.js).
  */
 export function BandStandIn() {
   // A new wristband every load, as the firmware is every boot: the key stays in this page, and the id is its hash.
@@ -160,22 +167,41 @@ export function BandStandIn() {
     try { localStorage.removeItem('otb:band-id'); } catch { /* a private window */ }
     return createWrist({ key: toHex(crypto.getRandomValues(new Uint8Array(16))) });
   }, []);
+  const speaker = useMemo(() => createSpeaker(), []);
   const [battery, setBattery] = useState(62);
   const [screen, setScreen] = useState(() => wrist.face(Date.now()));
   const [live, setLive] = useState(false);
+  const [heard, setHeard] = useState(false);
   const [down, setDown] = useState({ 1: false, 2: false });
   const ws = useRef(null);
+  const flushRef = useRef(() => {});
+
+  // A browser lets a page sound only after a tap: the first one anywhere on it lets the band chirp.
+  useEffect(() => {
+    const unlock = () => { speaker.unlock(); setHeard(speaker.ready()); };
+    window.addEventListener('pointerdown', unlock, true);
+    window.addEventListener('keydown', unlock, true);
+    return () => {
+      window.removeEventListener('pointerdown', unlock, true);
+      window.removeEventListener('keydown', unlock, true);
+    };
+  }, [speaker]);
 
   useEffect(() => {
     let closed = false, retry = null;
-    // What the Wrist says to send goes out, a drop drops the socket, and the face is drawn again.
+    // What the Wrist says to send goes out, a drop drops the socket, the newest sound due plays, as on the band,
+    // and the face is drawn again.
     const flush = () => {
       for (const f of wrist.take()) {
         if (f === 'DROP') ws.current?.close();
         else if (ws.current?.readyState === 1) ws.current.send(f);
       }
+      const due = wrist.sounds();
+      if (due.length) speaker.play(due[due.length - 1]);
+      setHeard(speaker.ready());
       setScreen(wrist.face(Date.now()));
     };
+    flushRef.current = flush;
     const open = () => {
       const sock = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/ws');
       ws.current = sock;
@@ -193,7 +219,7 @@ export function BandStandIn() {
     open();
     const beat = setInterval(() => { wrist.tick(Date.now()); flush(); }, 50);
     return () => { closed = true; clearTimeout(retry); clearInterval(beat); const s = ws.current; ws.current = null; s?.close(); };
-  }, [wrist]);
+  }, [wrist, speaker]);
 
   useEffect(() => {
     wrist.setBattery(battery, Date.now());
@@ -203,6 +229,7 @@ export function BandStandIn() {
   const key = (k, isDown) => {
     (isDown ? wrist.keyDown : wrist.keyUp)(k, Date.now());
     setDown((d) => ({ ...d, [k]: isDown }));
+    flushRef.current();  // a press's tick now, not at the next beat
   };
   const handlers = (k) => ({
     // The press counts first; capture only keeps the let-go on this button, and throws for a pointer that is not active.
@@ -238,6 +265,10 @@ export function BandStandIn() {
           it for {wake}; hold it {hold} for NOT NOW. SIDE shows your card, and more presses change it.
           Letters: {CODE_LETTERS.length} of them, none that look alike.
         </span>
+        <span className="small" role="status">
+          {heard ? 'It chirps as the band does, unless its sound is off or it is in NOT NOW.'
+            : 'Silent until this page is tapped: a browser lets a page make sound only after a tap.'}
+        </span>
         <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
           battery <input type="range" min="1" max="100" value={battery} onChange={(e) => setBattery(Number(e.target.value))} aria-label="Stand-in battery" />
           <span className="tnum" style={{ color: '#fff', minWidth: 36 }}>{battery}%</span>
````

In `app/styles.css`:

````diff
--- a/app/styles.css
+++ b/app/styles.css
@@ -297,6 +297,7 @@ h1 { margin: 0; font-weight: 400; }
 .bandface .pairing { display: flex; flex-direction: column; align-items: center; gap: calc(var(--u) * 16); }
 .bandface .qr { display: block; width: calc(var(--u) * 115); height: calc(var(--u) * 115); }
 .bandface .pairing .code { font-size: calc(var(--u) * 26); }
+.bandface .pairing .hint { color: #fff; margin-top: calc(var(--u) * -10); max-width: calc(var(--u) * 115); text-align: center; }
 .bandchip { display: flex; align-items: center; gap: 5px; height: 44px; padding: 0 8px; border-radius: 14px; color: var(--text-2); font: var(--label); letter-spacing: .04em; }
 .bandchip:hover { color: #fff; }
 
````

- [ ] **Step 4: Run** — the file, then `npm test`. Expected: `ℹ fail 0`, `ℹ tests 274`.

- [ ] **Step 5: Mutation check (P1)** — expected `ALL MUTATIONS HELD`:

````json
[
 {
  "label": "a rest takes no time",
  "file": "app/lib/speaker.js",
  "from": "    if (hz) out.push({ hz, start: t, stop: t + ms / 1000 });\n    t += ms / 1000;\n",
  "to": "    if (hz) { out.push({ hz, start: t, stop: t + ms / 1000 }); t += ms / 1000; }\n",
  "test": "tests/speaker.test.js",
  "expect": [
   "each sounding note starts where the one before it ended, and a rest only takes its time"
  ]
 },
 {
  "label": "the notes are sine waves",
  "file": "app/lib/speaker.js",
  "from": "o.type = 'triangle';",
  "to": "o.type = 'sine';",
  "test": "tests/speaker.test.js",
  "expect": [
   "after a tap it plays the band's notes as triangle waves, on the audio clock, and a new sound cuts off the last"
  ]
 },
 {
  "label": "a new sound plays over the last",
  "file": "app/lib/speaker.js",
  "from": "        try { o.stop(); } catch { /* over already */ }\n",
  "to": "",
  "test": "tests/speaker.test.js",
  "expect": [
   "after a tap it plays the band's notes as triangle waves, on the audio clock, and a new sound cuts off the last"
  ]
 },
 {
  "label": "a suspended context is asked to play",
  "file": "app/lib/speaker.js",
  "from": "if (ctx?.state !== 'running' || !SOUNDS[name]) return false;",
  "to": "if (!ctx || !SOUNDS[name]) return false;",
  "test": "tests/speaker.test.js",
  "expect": [
   "it is silent until the page has been tapped, and silent if the browser keeps it suspended"
  ]
 }
]
````

- [ ] **Step 6: Look at it in a browser.** `npm start` (or `PORT=<free port> node relay/server.js` after `npm run build`), open `/band` at 900 × 900, and before tapping install a spy: wrap `AudioContext.prototype.createOscillator` so each oscillator records its `type`, `frequency.value`, and `start`/`stop` times relative to `currentTime` in `window.__osc`. Then, with real clicks (the browser pane's `computer` click; `element.click()` is not a user gesture, so it cannot unlock audio):
  - the status line says it is silent until tapped; one click on the face button plays `tick` (1800 Hz, 0 → 0.025) and the status line changes;
  - on the letters, a click shows `PAIR ON YOUR PHONE` under them, wrapped.

- [ ] **Step 7: Commit, and close Stage C with P2**

```bash
git add app/lib/speaker.js app/screens/Band.jsx app/styles.css tests/speaker.test.js
```

````bash
git commit -F - <<'EOF'
Chirp and flash on the stand-in as the band does

app/lib/speaker.js plays a sound's notes as triangle oscillators on the
audio clock, cuts off the one playing, and stays silent until the page
has been tapped. /band plays the newest sound due, flushes at once on a
press, says whether it can sound yet, draws red and orange flat and
without the face's fade, and puts the hint under the letters.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

---

## Stage D — Docs and proof

### Task 12: The README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write it.** Under "The wristband": the reactions, the switch, the letters going dark. Under "The wristband's firmware": `main.cpp` has the speaker; a sound plays from a buffer of its own; a change of light alone only turns the backlight; `npm test` compiles the logic as the band does. Under "Where this differs from the canvas": the flashes and chirps (spec, "Where this departs from the canvas"). Under "What is not done": the reactions not yet heard on a wrist.

In `README.md`:

````diff
--- a/README.md
+++ b/README.md
@@ -200,6 +200,35 @@ that was taken.
   which decides; the face says `SET`, `CHANGED` or `NOT SENT`.
   Coming back from NOT NOW takes holding the side button. The pair screen
   says to *press* its face button, not to hold it.
+- **It answers in sound and light**, and is quiet unless its wearer did
+  something on it or something came for them. Every key ticks as it goes
+  down. A choice from the wrist ends in `SET` (a rising chirp, and the card's
+  colour twice; white for OFF), `CHANGED` (a falling one, and red three times)
+  or `NOT SENT` (a low one, and orange twice). The pairing check asks with two
+  notes and two white flashes; `YES` and TEST THE LIGHT chirp up, and a check
+  that ends without `YES` falls. A meeting number plays a jingle and blinks
+  the face once a second until a key answers it, and that key does nothing
+  else. Five facts about the band warn, in orange, once each time they begin:
+  out of reach for ten seconds, the battery at 15% and again at 5%, waiting
+  ten seconds for its owner after a relay restart, away, and unpaired. NOT NOW
+  is silent, but for the hold that starts it and a `SET` from the wrist that
+  ends it; a warning that came up meanwhile plays once, after. A change made
+  on the phone to one's own card or NOT NOW is silent on the wrist. Each sound
+  and flash is one line in a table both twins keep, `SOUNDS` and `FLASHES`,
+  held equal by `tests/firmware.test.js`; the notes are starting points, to be
+  tuned by ear on a band. `/band` plays the same notes through Web Audio once
+  its page has been tapped, which is when a browser first lets a page sound.
+- **The sound can be switched off, on the phone.** The wristband sheet has
+  `SOUND: ON` under TEST THE LIGHT; off, the band only lights up. The switch is
+  the person's own: the phone keeps it across nights and re-says it after
+  every reconnect, and the relay carries it on the shows to that person's
+  band and to no other. A band nobody has claimed chirps as it is, and a
+  claimed band has the switch in its first show.
+- **Letters go dark after two minutes.** An unclaimed band's letters and QR,
+  and the face of one waiting for its owner after a restart, light for two
+  minutes and then only the backlight goes off; a press lights them again.
+  A press on the letters or on the check puts `PAIR ON YOUR PHONE` on the
+  face for 3 s, and does nothing else there.
 - **Who a wristband is.** It makes a random key at every boot and keeps it
   only in RAM; its id is the first half of the key's SHA-256, and every hello
   proves the id with the key. Knowing an id — every phone that ever paired it
@@ -266,8 +295,8 @@ choice sent from the wrist, each refusal, and each change in what the relay
 shows.
 
 - **Everything that decides anything is in `src/band_logic.h`**, plain C++ with
-  no hardware in it; `src/main.cpp` is only the screen, the two buttons, the
-  battery, Wi-Fi and the socket. `npm test` builds that logic with the
+  no hardware in it; `src/main.cpp` is only the screen, the speaker, the two
+  buttons, the battery, Wi-Fi and the socket. `npm test` builds that logic with the
   machine's own compiler, under the address and undefined-behaviour sanitizers
   where it can, and `tests/firmware.test.js` puts it in front of the real
   relay: the frames it sends pair it, report its battery and make its person
@@ -285,6 +314,26 @@ shows.
   relay. The socket runs on a task of its own, so a connection that hangs — a
   captive portal can hold a TLS handshake open for two minutes — never holds
   up the button or the screen.
+- **A sound plays from a buffer of its own.** When the wrist names a sound,
+  `main.cpp` renders all its notes as one 8-bit triangle wave at 16 kHz
+  (`render()`, in `band_logic.h`, so the host tests hold it) and hands that
+  to `M5.Speaker.playRaw()`, so painting the face cannot bend a tune's
+  rhythm. There are two buffers of 9.6 KB, used in turn, and one is written
+  again only once M5Unified says the speaker has let it go: its buffer
+  release callback, which is why the firmware needs M5Unified 0.2.22 or
+  later. The StickC Plus plays the same samples through its buzzer. The first
+  M5StickC has no speaker; it says so once on the console and only lights up.
+  The Plus has no PSRAM, and the buffers take its static RAM from 51 KB to
+  70 KB of 320 KB; `show` prints the free heap.
+- **A change of light alone only turns the backlight.** A flash's dark steps
+  and the meeting's blink never repaint the face, so a call that blinks for
+  fifteen minutes never holds up the loop or misses a tap.
+- **`npm test` also compiles the logic as the band's compiler does.** The ESP32
+  core builds C++ as gnu++11, after `Arduino.h` has made names like `LOW` and
+  `HIGH` into macros; the laptop build is C++17 and has neither. So
+  `firmware/host/as_band.cpp` compiles `band_logic.h` that way: a note table
+  called `LOW` and a `constexpr` loop once passed every test and broke only
+  in PlatformIO.
 - **Its key is 128 random bits, made at every boot**, never the chip's MAC, and
   kept only in RAM with the pairing's secret.
 - **The pairing code is as wide as the screen allows**, with four light modules
@@ -345,6 +394,12 @@ shows.
 - **Pairing ends with a check** shown on the wrist and confirmed on the phone.
   Without it a decoy code would pair silently, and with `set` a wrongly paired
   wristband could make someone visible.
+- **The wristband flashes and chirps.** Revision 6 §8 rules out vibration or
+  light patterns that pretend to carry a message. The owner chose on 25 Sep
+  2026 that the band flashes and sounds, and none of it pretends: each
+  reaction answers something the wearer just did, or says one fact about the
+  band, and the only one about another person is the meeting call, for a
+  number the band already shows.
 
 ## Abuse resistance
 
@@ -462,6 +517,13 @@ relay could drive what a wrist shows.
   bands. A night's worth of battery, and the Plus's face button, are not
   tried. CI builds both envs with PlatformIO on every push — the ESP32 image
   is about 1.2 MB of its 3 MB app partition — and keeps each image to flash.
+- **The reactions have not been heard on a wrist yet.** The stand-in has
+  played them through Web Audio in a browser, with the phone's switch both
+  ways, and both firmware envs build with them. The Plus's buzzer playing the
+  same samples, its free memory with both buffers, and the check's words and
+  the hint whole on a real screen are the next check; if the buzzer stays
+  silent, the fallback drives its pin with LEDC tones. Flashing on the
+  music's beat is a later spec.
 - **The scanner has read a code through Chrome's fake camera, not a phone's.**
   Headless Chrome played a picture of a wristband's code as its camera; the
   app's scanner read it through jsQR and paired, and a stranger's code was
````

- [ ] **Step 2: Run the tests that read the README**

Run: `node --test tests/copy.test.js tests/rules.test.js tests/wristband.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ fail 0`. `tests/copy.test.js` fails on "three seconds" (the old one-button wake): write 3 s.

- [ ] **Step 3: Commit, and close Stage D's writing with P2**

```bash
git add README.md
```

````bash
git commit -F - <<'EOF'
Describe how the wristband answers, in the README

The reactions, the sound switch and the letters going dark under "The
wristband"; the speaker's buffers, backlight-only light changes and the
band-standard compile under the firmware; the flashes and chirps as a
departure from revision 6 §8; and what is still untried on a wrist.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
````

### Task 13: The browser proof

Run on `main` once Tasks 1–12 are pushed. Tabs of the browser pane at 900 × 900 on one relay: the phone (seed `localStorage['otb:v1']` as CLAUDE.md shows, a night at a test room) and `/band` with the oscillator spy from Task 11 Step 6. Press the phone's buttons with `element.click()`. The band's first press must be a real click, to unlock its audio; after that a `keydown`/`keyup` of Enter dispatched on `.bandbtn` presses it too.

- **Two phones need two origins:** tabs on one origin share `localStorage`. Use `http://localhost:<port>` for one person (phone and band) and `http://127.0.0.1:<port>` for the other.
- **Keep the pane on screen while sampling.** A hidden tab (`document.visibilityState === 'hidden'`) runs timers about once a second, so the stand-in's 50 ms beat stops and a sampled face freezes. The spy's oscillator records do not depend on it.
- **When the pane scales the 900 × 900 viewport down,** click by the coordinates of a fresh screenshot, not by a `ref` found before.

- [ ] **Step 1: Pairing.** Open `/pair/<letters>` on the phone. Expected on the band: the check face (`ON YOUR PHONE?` over the number), `ask` (1319 Hz at 0, 1760 Hz at 0.13). A click on the band's face button: the check's line becomes `PAIR ON YOUR PHONE`. `YES` on the phone: `up` (1047, 1319, 1568, 2093 Hz at 0.07 s steps).
- [ ] **Step 2: The switch.** Open the wristband sheet: `SOUND: ON` sits between TEST THE LIGHT and UNPAIR. Tap it: the toast says *your wristband will only light up.*, `bandSound` is `false` in the store, and the row reads `SOUND: OFF`. A click on the band and TEST THE LIGHT: no new oscillator, and the band is white for about two seconds (sample `getComputedStyle` every 25 ms). Tap it back: the toast says *your wristband will chirp again.*, and TEST THE LIGHT plays `up`.
- [ ] **Step 3: A warning.** Set the stand-in's battery slider to 10. Expected: `warn` (880, 698, 880, 698 Hz at 0.15 s steps), and the face `rgb(255, 138, 0)` for about 350 ms, dark (`brightness(0)`) for about 250 ms, twice.
- [ ] **Step 4: SET.** Arm SAY HI on the phone; two clicks on the band's SIDE: two ticks, then after `COMMIT_MS` `up` and the card's colour twice, then SET on the face. CHANGED needs the phone to move the rev between the band's look and its send, which the stand-in re-bases on too quickly to reach by hand; its red is the table's and takes the same `FLASH_COLOURS` path as orange.
- [ ] **Step 5: A meeting.** Two phones at the same test room, each paired with its own `/band`. Both arm SAY HI; one opens WHO'S NEAR and waves, the other waves back. Expected on both bands in the same moment: `jingle` (1319, 1568, 2637, 2093, 2349, 3136 Hz at 0.08 s steps), `MEET` over the phones' number, and `brightness(0)` every other 500 ms (sample `filter` every 25 ms). A press on one band: a tick and nothing else (no wake word, no look), and that band stops blinking while the other keeps on. When this plan was written the meeting, the jingle and the blink were seen on both bands, and the press gave only its tick with `MEET` still on the face; the blink stopping was not observed, because the pane was hidden by then. The table's rule 4 cases hold it.
- [ ] **Step 6: Reset the viewport** of the browser pane, close the tabs, and stop the relay.

### Task 14: The real bands, with the owner

Nothing here starts without the owner's yes: ask in Chinese before each flash. His bands: the StickS3 on `COM8`, the StickC Plus on `COM9` (`firmware/`: `pio run -e m5sticks3 -t upload --upload-port COM8`, `pio run -e m5stickc -t upload --upload-port COM9`, with P3's directories). Both use the always-on relay, `https://on-the-beat.fly.dev`; deploy the relay first (the owner logs in to Fly himself), unless he has said a demo is on.

- [ ] **Step 1: Deploy the relay**, when the owner agrees, and check that https://on-the-beat.fly.dev/ loads the app.
- [ ] **Step 2: Flash both bands.** In each console, `show`: the `memory` line gives the free heap (the Plus's is the one that matters) and `sound on the speaker`.
- [ ] **Step 3: With the owner, listen and look:** a press ticks; the check asks and flashes white; the check's words and `PAIR ON YOUR PHONE` stand whole on each screen; `YES` chirps up; SET, CHANGED (if it can be reached), NOT SENT (turn the Wi-Fi off during a send); the switch off and on from his phone; a meeting between the StickS3 and the Plus (jingle, blink, a press answers). The Plus's buzzer is the open question (spec, Risks): if it stays silent while the console prints `sound: <name>`, the fallback is LEDC tones on its pin, a change of its own.
- [ ] **Step 4: Tune by ear** only what the owner asks for: each sound is one line in each twin's table, and `tests/firmware.test.js` holds them equal.
- [ ] **Step 5: Unpair every test persona** from his real bands, and tell him in which state each band is left.
- [ ] **Step 6: Record it.** Replace "The reactions have not been heard on a wrist yet." in the README's "What is not done" with what was heard and seen, the Plus's free heap included. Commit, push (P2).
