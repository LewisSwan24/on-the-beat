# Wrist Controls, Phase A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the wrist alone a person can change which card is armed, come back from NOT NOW, and see whether the relay took it; the phone follows the relay, and pairing ends with a two-digit check.

**Architecture:** The relay (`relay/server.js`, `relay/room.js`) stays the one place a person's state lives; it gains a per-boot band identity (key → id), a per-pairing secret, a pairing check, `rev`/`seq`/`by` per person, the wrist's `set`, and one grace. The phone gets a pure `follow()` (`app/lib/follow.js`) and never asserts state on load. The wrist is one state machine written twice — `app/lib/wrist.js` for `/band` and a `Wrist` class in `firmware/src/band_logic.h` — held to one fixture table (`tests/fixtures/wrist-cases.json`) through a line protocol both read.

**Tech Stack:** Node 22+ (`node --test`, `ws`), React 19 + Vite 8, C++17 (WinLibs g++ here, GCC in CI, Arduino-ESP32 via PlatformIO for M5StickC Plus/Plus2 and M5StickS3).

**Spec:** `docs/superpowers/specs/2026-09-24-wrist-controls-design.md` (approved; §0–§4 and the timings table are quoted by name below). Read it before any task.

## Global Constraints

- Artefacts are English: code, comments, commit messages, README, test names. Talk to the owner in Chinese.
- Timings are named constants, never literals in tests or fixtures: `WAKE_MS = 6000`, `HOLD_MS = 1500`, `CHOOSE_MS = 6000`, `COMMIT_MS = 3000`, `CONFIRM_MS = 10000`, `RESULT_MS = 3000`, `PAIR_CHECK_MS = 60000`, `BAND_ALONE_MS = 3600000` (60 min). This plan adds `BAR_MS = 300` for the spec's "from 0.3 s".
- Band identity: a random 128-bit key made at every boot, RAM only, never told to a phone; id = first 32 hex of SHA-256 over the key's 16 raw bytes. Secret: 32 hex, made by the relay on YES, RAM only on the wrist, stored with the night on the phone.
- Hello: `{"t":"wristband","id":…,"key":…,"v":2[,"secret":…][,"quiet":true][,"battery":N]}`.
- KEY1 is M5Unified `BtnA`, KEY2 is `BtnB`; `BtnPWR` is never used.
- The owner's principle: a change that hides a person may arrive late; a change that shows them may not.
- Repository `LewisSwan24/on-the-beat` (private). Commit after each task; push to `main` when the stage's `npm test` is green. Never the team repository `cimi2232/DECO3500` — `tools/hooks/pre-push` refuses it; check it is installed with `ls .git/hooks/pre-push` before the first push.
- `CLAUDE.md` is not in git and is not edited by this plan. Nothing from `../on-the-beat-research/` or `../on-the-beat-design/` enters the repository.
- `npm test` builds first (the relay serves `dist/`). Running one test file alone: `npm run build` first, and again after restoring a mutation.
- Windows host: the Bash tool is Git Bash; PowerShell is also available. The host binary's output is split on `/\r?\n/`. MinGW has no sanitizers: `tests/firmware.test.js` already falls back to a plain build; CI keeps the sanitizers.
- The device is an M5StickS3 on `COM8`, flashed with `C:\Users\LewisDong\.platformio\penv\Scripts\pio.exe run -d firmware -e m5sticks3 -t upload --upload-port COM8`. The owner's serial monitor may hold COM8: ask him to close it first.
- Never more than ten background tasks at once (global instructions). Work directly; this plan needs no fan-out.
- Commit messages end with the attribution trailer the session's system reminder gives (today: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## Two procedures used throughout

**P1 — Mutation check.** Every relay guard gets one, and rule 4 on the phone gets one. Each task names the exact edit and the exact test.

1. Make the named edit (one guard broken, nothing else).
2. Run `npm run build >/dev/null && node --test <the named test file> 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`.
3. Expected: `ℹ fail 1`, and the only name after `✖` is the named test (node prints it twice: inline and under "failing tests").
4. Restore the edit exactly, run `npm run build`, rerun the file: `ℹ fail 0`.
5. Put `Mutation-checked: <guard> -> <test>` in the task's commit body.

If the wrong test goes red, or none does, stop: the test does not hold the guard. Fix the test, not the guard.

A few guards are what other tests stand on (a live wristband holding its person, the hour, 06:00, noting the seq). Breaking one of those reddens its own test *and* the tests built on it; for those the task names the whole expected set, marked **Expected red (exactly)**, and the check passes only if exactly that set goes red. Every relay mutation in this plan was run against a finished copy of the relay while the plan was written, not against each intermediate step: 37 of 42 isolate to one test, and the other five are listed with their sets. At an intermediate task a set can be smaller (a test that is not written yet cannot go red); it is never larger.

**P2 — Close a stage.** `npm test` (expect `ℹ fail 0`; the firmware tests must run, not skip, from Task 1 on), then `git push origin main`. A push that cannot reach github.com:443 while `gh` works is the network: check with `curl -sI https://github.com`, retry, leave git config alone.

## Files

Created:

| File | Responsibility |
|---|---|
| `app/lib/sha256.js` | Synchronous SHA-256 and `bandIdOf(keyHex)` for the stand-in |
| `app/lib/wrist.js` | The wrist machine in JS: constants, `createWrist({ key })` |
| `app/lib/follow.js` | Pure `follow(phone, view)`: what the phone adopts, keeps, shows and says |
| `relay/night.js` | `nightOf(ms, tz)`: 06:00 in the venue's time zone |
| `tests/relay-harness.js` | Phones, wristbands, raw sockets and pairing helpers shared by the relay tests (not a test file) |
| `tests/wristband.test.js` | §0 identity and the check; rule 1 `set` |
| `tests/rules.test.js` | Rule 2 (grace, hour, 06:00), join `quiet`, NOT NOW remembered, rules 3–5, leaving |
| `tests/sha256.test.js` | `app/lib/sha256.js` against `node:crypto` |
| `tests/wrist-table.js` | The fixture's line protocol, the JS runner, the checker (not a test file) |
| `tests/fixtures/wrist-cases.json` | One table of wrist cases for both wrists |
| `tests/wrist.test.js` | The table against `app/lib/wrist.js`; card words equal `bandShow`'s |
| `tests/follow.test.js` | Every row of §3's table |
| `tests/net.test.js` | Re-send order; a page load queues nothing |
| `tests/copy.test.js` | Greps the old one-button phrases out of `app/`, `relay/`, `firmware/src/`, `README.md` |

Modified: `relay/server.js`, `relay/room.js`, `relay/band.js`, `app/App.jsx`, `app/lib/net.js`, `app/lib/pairing.js`, `app/lib/store.js`, `app/screens/Band.jsx`, `app/screens/Home.jsx`, `app/screens/Met.jsx`, `app/styles.css`, `firmware/src/band_logic.h`, `firmware/src/main.cpp`, `firmware/host/logic_test.cpp`, `tests/server.test.js`, `tests/firmware.test.js`, `tests/band.test.js`, `tests/room.test.js`, `tests/pairing.test.js`, `.github/workflows/ci.yml`, `README.md`.

## Stages

| Stage | Tasks | Leaves |
|---|---|---|
| A. Tooling | 1–2 | a local C++ compiler; CI building both envs |
| B. §0 Identity and the check | 3–9 | key → id, v2 hello, the check, secrets, waiting for the owner; phone and both wrists speak it |
| C. §2 The relay decides | 10–14 | rev/seq/by/fresh, one grace + hour + 06:00, `set`, rules 3–5, durable leave |
| D. §3 The phone follows | 15–17 | `follow.js`, `net.js` order, App wiring |
| E. §1/§4 One Wrist, twice | 18–20 | `wrist.js` + table; C++ reader; C++ `Wrist` on the same table |
| F. Wiring | 21–23 | `main.cpp` and `/band` over the Wrist; copy with the constants + grep test |
| G. Docs and proof | 24–26 | README; browser; the real band |

Every task ends green and is committed on its own; each stage ends with P2.

---

## Stage A — Tooling

### Task 1: A C++ compiler on this laptop, and host output split on CRLF

**Files:**
- Modify: `tests/firmware.test.js` (the `speak()` split)

**Interfaces:**
- Consumes: nothing.
- Produces: `g++` on PATH (or `CXX` set for the session); `speak()` that tolerates `\r\n`.

MSVC is already here (Visual Studio 2022 BuildTools, `cl` 19.44, found while this plan was written and used to compile its C++), but `tests/firmware.test.js` drives GCC-style flags (`-std=c++17 -Wall -Wextra -Werror`, the sanitizers), which `cl` does not take; the spec asks for WinLibs g++, and CI is GCC.

- [ ] **Step 1: Ask the owner, in Chinese, to approve the install command.** The main session recorded his approval of WinLibs g++ on 24 Sep, but the command accepts package agreements, which needs his explicit yes for this exact line:

```powershell
winget install --id BrechtSanders.WinLibs.POSIX.UCRT --exact --accept-package-agreements --accept-source-agreements
```

- [ ] **Step 2: Install, then check from a fresh shell**

Run (PowerShell): `g++ --version`
Expected: a first line naming MinGW-W64 / WinLibs and GCC 14 or later. If `g++` is not found, locate it and set it for this session only (never edit PATH or other persistent settings):

```powershell
$gpp = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter g++.exe | Select-Object -First 1
$env:CXX = $gpp.FullName
```

- [ ] **Step 3: Run the firmware tests and watch them fail on CRLF**

Run: `npm run build >/dev/null && node --test tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail|skipped)"`
Expected: the tests run (not skipped) and at least `the code a wristband draws opens the app on its own four letters` and `what the firmware says, the relay takes…` fail, because MinGW writes `\r\n` and every answer ends in `\r`. If instead the build itself fails under `-Werror` with a MinGW-only warning, fix that warning in `firmware/host/logic_test.cpp` or `band_logic.h` with the smallest change and note it in the commit.

- [ ] **Step 4: Split on either line ending** — in `tests/firmware.test.js`, `speak()`:

```js
  const out = r.stdout.split(/\r?\n/).slice(0, -1);
```

- [ ] **Step 5: Run the firmware tests again**

Run: `node --test tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail|skipped)"`
Expected: `ℹ pass 4`, `ℹ fail 0`, `ℹ skipped 0`.

- [ ] **Step 6: Full suite**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"`
Expected: `ℹ fail 0`, `ℹ skipped 0`.

- [ ] **Step 7: Commit**

```bash
git add tests/firmware.test.js
git commit -m "Read the host binary's answers on either line ending

MinGW writes CRLF. With WinLibs g++ on this laptop the firmware
logic now builds and runs here instead of skipping (no sanitizers
under MinGW; CI keeps them)."
```

### Task 2: CI builds both firmware envs and keeps both images

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md` (the one sentence in "What is not done" that says CI does not build the StickS3 env)

**Interfaces:**
- Consumes: `firmware/platformio.ini` envs `m5stickc`, `m5sticks3`.
- Produces: CI artifact `otb-wristband-<sha>` with four files.

- [ ] **Step 1: Prove both envs build here**

Run (PowerShell):
```powershell
& C:\Users\LewisDong\.platformio\penv\Scripts\pio.exe run -d firmware -e m5stickc -e m5sticks3 2>&1 | Select-String -Pattern "SUCCESS|FAILED|Error"
```
Expected: two `[SUCCESS]` lines.

- [ ] **Step 2: Build both in CI.** In `.github/workflows/ci.yml`, replace the `Build`, `One image to flash whole` and `upload-artifact` steps with:

```yaml
      - name: Build both wristbands
        run: pio run -d firmware -e m5stickc -e m5sticks3
      - name: One image each, to flash whole at 0x0
        run: |
          esptool=~/.platformio/packages/tool-esptoolpy/esptool.py
          app0=~/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin
          c=firmware/.pio/build/m5stickc
          python $esptool --chip esp32 merge_bin \
            -o "$c/otb-wristband-full.bin" --flash_mode dio --flash_freq 40m --flash_size 4MB \
            0x1000 "$c/bootloader.bin" 0x8000 "$c/partitions.bin" 0xe000 $app0 0x10000 "$c/firmware.bin"
          s=firmware/.pio/build/m5sticks3
          python $esptool --chip esp32s3 merge_bin \
            -o "$s/otb-wristband-s3-full.bin" --flash_mode keep --flash_freq keep --flash_size keep \
            0x0 "$s/bootloader.bin" 0x8000 "$s/partitions.bin" 0xe000 $app0 0x10000 "$s/firmware.bin"
          ls -l "$c"/*.bin "$s"/*.bin
      - uses: actions/upload-artifact@v4
        with:
          name: otb-wristband-${{ github.sha }}
          path: |
            firmware/.pio/build/m5stickc/otb-wristband-full.bin
            firmware/.pio/build/m5stickc/firmware.bin
            firmware/.pio/build/m5sticks3/otb-wristband-s3-full.bin
            firmware/.pio/build/m5sticks3/firmware.bin
          if-no-files-found: error
```

Also update the header comment's `firmware` paragraph: "built by PlatformIO for both envs, the ESP32 (`m5stickc`) and the StickS3 (`m5sticks3`), and kept as downloads: each app on its own, and one image each that flashes whole at 0x0 (the ESP32's bootloader sits at 0x1000 inside it, the S3's at 0x0)."

- [ ] **Step 3: README** — the **CI.** paragraph under "Run it" becomes: "**CI.** Every push to `main` and every pull request runs `npm test` and builds the wristband's firmware for both envs with PlatformIO (`.github/workflows/ci.yml`). Each run keeps the firmware as a download: each env's `firmware.bin`, and one image each that flashes whole at `0x0`, bootloader and partition table included — `otb-wristband-full.bin` for the M5StickC Plus, `otb-wristband-s3-full.bin` for the StickS3." And in "What is not done", replace "CI builds the ESP32 firmware with PlatformIO on every push — about 1.2 MB of the 3 MB app partition — and keeps the image to flash; it does not build the StickS3 env." with "CI builds both envs with PlatformIO on every push — the ESP32 image is about 1.2 MB of its 3 MB app partition — and keeps each image to flash."

- [ ] **Step 4: Full suite, commit, push (closes Stage A with P2)**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add .github/workflows/ci.yml README.md
git commit -m "Build the StickS3 in CI too, and keep both images"
git push origin main
```

- [ ] **Step 5: Watch CI**

Run: `gh run list --workflow CI --limit 1` then `gh run watch <id> --exit-status`
Expected: both jobs green; `gh api repos/LewisSwan24/on-the-beat/actions/runs/<id>/artifacts --jq '.artifacts[].name'` prints one `otb-wristband-<sha>`. If the S3 merge fails on `keep`, replace `--flash_mode keep --flash_freq keep --flash_size keep` with `--flash_mode dio --flash_freq 80m --flash_size 8MB`, push, and watch again.

---

## Stage B — §0 Who a wristband is, and pairing with a check

This stage must ship before `set` exists (spec §0, "Why first"). Order inside it: both wrists learn the v2 hello first (the relay still takes v1 then, so every commit stays green), then the relay enforces it, then the check, the secret and the restart rules, then the phone, then the wrists' new faces.

### Task 3: SHA-256 and the v2 hello, in both wrists

**Files:**
- Create: `app/lib/sha256.js`, `tests/sha256.test.js`
- Modify: `firmware/src/band_logic.h` (replace `makeId` and `helloFrame`; add `sha256Hex`, `hexBytes`, `idFor`, `makeKey`)
- Modify: `firmware/host/logic_test.cpp` (`said()`; `speak` verbs `key`, `idfor`, `sha256`, `hello`)
- Modify: `tests/firmware.test.js`
- Modify: `firmware/src/main.cpp` (a key per boot; the stored `id` pref is dropped)
- Modify: `app/screens/Band.jsx` (the stand-in: a key per page load)

**Interfaces:**
- Produces (JS): `sha256(bytes: Uint8Array): Uint8Array`, `toHex(bytes): string`, `fromHex(hex): Uint8Array`, `bandIdOf(keyHex: string): string`.
- Produces (C++): `std::string sha256Hex(const uint8_t*, size_t)`, `std::vector<uint8_t> hexBytes(const std::string&)`, `std::string makeKey(const std::function<uint32_t()>&)`, `std::string idFor(const std::string& keyHex)`, `std::string helloFrame(const std::string& id, const std::string& key, int battery, const std::string& secret = "", bool quiet = false)`.
- Produces (host): `speak` verbs `key` → 32 hex; `idfor <key>` → id; `sha256 <hex>` → 64 hex; `hello <key> <battery> [secret|-] [quiet]` → the hello frame.

- [ ] **Step 1: Write the failing JS test** — `tests/sha256.test.js`:

```js
// ON THE BEAT — the stand-in's SHA-256, held to node:crypto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { bandIdOf, fromHex, sha256, toHex } from '../app/lib/sha256.js';

const node = (b) => createHash('sha256').update(b).digest('hex');

test('the stand-in hashes as node:crypto does, at every padding edge', () => {
  for (const n of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000]) {
    const b = randomBytes(n);
    assert.equal(toHex(sha256(new Uint8Array(b))), node(b), n + ' bytes');
  }
  assert.equal(toHex(sha256(new TextEncoder().encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test("a wristband's id is the first 32 hex of its key's hash", () => {
  const key = randomBytes(16).toString('hex');
  assert.deepEqual(fromHex(key), new Uint8Array(Buffer.from(key, 'hex')));
  assert.equal(bandIdOf(key), node(Buffer.from(key, 'hex')).slice(0, 32));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/sha256.test.js 2>&1 | grep -E "^ℹ (pass|fail)|Cannot find"`
Expected: fails with `Cannot find module …/app/lib/sha256.js`.

- [ ] **Step 3: Write `app/lib/sha256.js`**

```js
// SHA-256, small and synchronous, for the stand-in's band key.
//
// A wristband's id is the first 32 hex of SHA-256 over its 16-byte key, and
// the relay checks every hello against it (relay/server.js, with node:crypto).
// The browser's own crypto.subtle is asynchronous and is missing altogether on
// a page served over plain http, which is how a second phone on the LAN opens
// /band, so the stand-in carries its own. The firmware carries the same thing
// in C++ (firmware/src/band_logic.h); tests/sha256.test.js holds this one to
// node:crypto, and tests/firmware.test.js holds that one.

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rotr = (x, k) => (x >>> k) | (x << (32 - k));

/** SHA-256 of some bytes, as 32 bytes. */
export function sha256(bytes) {
  const n = bytes.length;
  const m = new Uint8Array(Math.ceil((n + 9) / 64) * 64);
  m.set(bytes);
  m[n] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(m.length - 8, Math.floor(n / 0x20000000));
  dv.setUint32(m.length - 4, (n * 8) >>> 0);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  for (let off = 0; off < m.length; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, k].forEach((x, i) => { h[i] = (h[i] + x) >>> 0; });
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  h.forEach((x, i) => ov.setUint32(i * 4, x));
  return out;
}

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (hex) => Uint8Array.from(String(hex).match(/[0-9a-f]{2}/g) || [], (x) => parseInt(x, 16));

/** A wristband's id: the first 32 hex of SHA-256 over its 16-byte key, as the relay recomputes it. */
export const bandIdOf = (keyHex) => toHex(sha256(fromHex(keyHex))).slice(0, 32);
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test tests/sha256.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ pass 2`, `ℹ fail 0`. (This module was run against `node:crypto` while this plan was written.)

- [ ] **Step 5: Write the failing firmware tests** — in `tests/firmware.test.js`, import `createHash` beside `randomBytes`, add after the imports:

```js
const idOf = (key) => createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex').slice(0, 32);
```

add this test after `the colours on the wrist are the colours on the phone`:

```js
test("the firmware hashes as node:crypto does, and its id is its key's hash", { skip }, () => {
  const inputs = ['', '616263', randomBytes(16).toString('hex'), randomBytes(55).toString('hex'), randomBytes(64).toString('hex'), randomBytes(200).toString('hex')];
  const got = speak(inputs.map((h) => 'sha256 ' + h));
  inputs.forEach((h, i) => assert.equal(got[i], createHash('sha256').update(Buffer.from(h, 'hex')).digest('hex'), h || 'nothing'));
  const [key] = speak(['key']);
  assert.match(key, /^[a-f0-9]{32}$/, 'a fresh key is 128 random bits');
  assert.deepEqual(speak(['idfor ' + key]), [idOf(key)]);
});
```

and in `what the firmware says, the relay takes…` replace the first three lines of the `try` with:

```js
    const [key] = speak(['key']);
    const id = idOf(key);
    const [hello, ping, low, hold] = speak(['hello ' + key + ' 62', 'ping', 'battery 12', 'hold']);
    assert.deepEqual(JSON.parse(hello), { t: 'wristband', id, key, v: 2, battery: 62 }, "v2, and the id is the key's hash");
```

(the later `assert.equal((await ana.until('paired')).band, id, …)` keeps working on this `id`).

- [ ] **Step 6: Run to see them fail**

Run: `npm run build >/dev/null && node --test tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: the new test and the round-trip test fail (`?` answers: the host has no `sha256`, `key`, `idfor` verbs yet).

- [ ] **Step 7: Add the hash and the key to `band_logic.h`.** Replace the whole "`/** A wristband's id: 128 random bits, made once and kept …`" function `makeId` and the old `helloFrame` with:

```cpp
// ---------- who it is ----------
//
// A key made at every boot and kept only in RAM, and an id that is its hash.
// The relay recomputes the id from the key in every hello, so knowing an id —
// every phone that ever paired it was told it — is not enough to speak as it.
// Switching it off and on makes it a new wristband.

namespace detail {
constexpr uint32_t SHA_K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};
inline uint32_t rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }
}  // namespace detail

/** SHA-256 of `n` bytes, as 64 lower-case hex digits. */
inline std::string sha256Hex(const uint8_t* data, size_t n) {
  uint32_t h[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  std::vector<uint8_t> m;
  if (n) m.assign(data, data + n);
  m.push_back(0x80);
  while (m.size() % 64 != 56) m.push_back(0);
  const uint64_t bits = static_cast<uint64_t>(n) * 8;
  for (int i = 7; i >= 0; --i) m.push_back(static_cast<uint8_t>(bits >> (8 * i)));
  for (size_t off = 0; off < m.size(); off += 64) {
    uint32_t w[64];
    for (int i = 0; i < 16; ++i)
      w[i] = (static_cast<uint32_t>(m[off + 4 * i]) << 24) | (static_cast<uint32_t>(m[off + 4 * i + 1]) << 16) |
             (static_cast<uint32_t>(m[off + 4 * i + 2]) << 8) | static_cast<uint32_t>(m[off + 4 * i + 3]);
    for (int i = 16; i < 64; ++i) {
      const uint32_t s0 = detail::rotr(w[i - 15], 7) ^ detail::rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
      const uint32_t s1 = detail::rotr(w[i - 2], 17) ^ detail::rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (int i = 0; i < 64; ++i) {
      const uint32_t t1 = k + (detail::rotr(e, 6) ^ detail::rotr(e, 11) ^ detail::rotr(e, 25)) + ((e & f) ^ (~e & g)) +
                          detail::SHA_K[i] + w[i];
      const uint32_t t2 = (detail::rotr(a, 2) ^ detail::rotr(a, 13) ^ detail::rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      k = g;
      g = f;
      f = e;
      e = d + t1;
      d = c;
      c = b;
      b = a;
      a = t1 + t2;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += k;
  }
  static const char DIGITS[] = "0123456789abcdef";
  std::string out;
  for (uint32_t x : h)
    for (int s = 28; s >= 0; s -= 4) out += DIGITS[(x >> s) & 0xF];
  return out;
}

/** Lower-case hex to bytes, two digits a byte; anything else, and nothing comes back. */
inline std::vector<uint8_t> hexBytes(const std::string& hex) {
  auto nibble = [](char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1; };
  std::vector<uint8_t> out;
  if (hex.size() % 2) return out;
  for (size_t i = 0; i < hex.size(); i += 2) {
    const int hi = nibble(hex[i]), lo = nibble(hex[i + 1]);
    if (hi < 0 || lo < 0) return {};
    out.push_back(static_cast<uint8_t>((hi << 4) | lo));
  }
  return out;
}

/** A band key: 128 random bits as 32 hex, made at every boot and kept only in RAM. Never the chip's MAC. */
inline std::string makeKey(const std::function<uint32_t()>& random32) {
  static const char DIGITS[] = "0123456789abcdef";
  std::string key;
  for (int w = 0; w < 4; ++w) {
    const uint32_t v = random32();
    for (int k = 28; k >= 0; k -= 4) key += DIGITS[(v >> k) & 0xF];
  }
  return key;
}

/** A wristband's id: the first 32 hex of SHA-256 over its key's 16 bytes, as the relay recomputes it. */
inline std::string idFor(const std::string& keyHex) {
  const std::vector<uint8_t> bytes = hexBytes(keyHex);
  const uint8_t none[1] = {0};
  return sha256Hex(bytes.empty() ? none : bytes.data(), bytes.size()).substr(0, 32);
}

/**
 * The first thing a wristband says on every connection: who it is, the key
 * that proves it, the protocol, and — when it has them — the secret its
 * pairing gave it, a NOT NOW still waiting to be sent, and its battery.
 */
inline std::string helloFrame(const std::string& id, const std::string& key, int battery,
                              const std::string& secret = "", bool quiet = false) {
  std::string f = "{\"t\":\"wristband\",\"id\":\"" + id + "\",\"key\":\"" + key + "\",\"v\":2";
  if (!secret.empty()) f += ",\"secret\":\"" + secret + "\"";
  if (quiet) f += ",\"quiet\":true";
  if (battery >= 0) f += ",\"battery\":" + std::to_string(battery);
  return f + "}";
}
```

- [ ] **Step 8: Update `logic_test.cpp`.** Add `#include <sstream>`. In `said()`, replace the `makeId` and `helloFrame` checks with:

```cpp
  // SHA-256 of "abc", and of nothing: the standard's own examples.
  const std::string abc = "abc";
  CHECK(sha256Hex(reinterpret_cast<const uint8_t*>(abc.data()), abc.size()) ==
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const uint8_t none[1] = {0};
  CHECK(sha256Hex(none, 0) == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  CHECK((hexBytes("00ff10") == std::vector<uint8_t>{0x00, 0xff, 0x10}) && hexBytes("0g").empty() && hexBytes("abc").empty());
  uint32_t n = 0;
  const std::string key = makeKey([&n] { return 0x01234567u + 0x11111111u * n++; });
  CHECK(key == "0123456712345678234567893456789a" && validId(key));
  const std::string id = idFor(key);
  CHECK(id.size() == 32 && validId(id) && id != key);
  CHECK(helloFrame(id, key, 62) == "{\"t\":\"wristband\",\"id\":\"" + id + "\",\"key\":\"" + key + "\",\"v\":2,\"battery\":62}");
  CHECK(helloFrame(id, key, -1, "5ec2", true) ==
        "{\"t\":\"wristband\",\"id\":\"" + id + "\",\"key\":\"" + key + "\",\"v\":2,\"secret\":\"5ec2\",\"quiet\":true}");
```

In `answer()`, replace the `id` and `hello` verbs with:

```cpp
  if (c.verb == "key") {
    std::random_device rd;
    return makeKey([&rd] { return static_cast<uint32_t>(rd()); });
  }
  if (c.verb == "idfor") return idFor(c.arg);
  if (c.verb == "sha256") {
    const std::vector<uint8_t> bytes = hexBytes(c.arg);
    const uint8_t none[1] = {0};
    return sha256Hex(bytes.empty() ? none : bytes.data(), bytes.size());
  }
  if (c.verb == "hello") {
    // hello <key> <battery> [secret|-] [quiet]
    std::istringstream in(c.arg);
    std::string key, secret, quiet;
    int battery = -1;
    in >> key >> battery >> secret >> quiet;
    return helloFrame(idFor(key), key, battery, secret == "-" ? "" : secret, quiet == "quiet");
  }
```

and update the file's header comment: `logic_test speak` "answers each with one line".

- [ ] **Step 9: Run the firmware tests**

Run: `npm run build >/dev/null && node --test tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ pass 5`, `ℹ fail 0` (the relay still takes the v2 hello: it ignores fields it does not know).

- [ ] **Step 10: The firmware makes a key at every boot.** In `firmware/src/main.cpp`: change `std::string bandId, ssid, pass, relayText;` to `std::string bandKey, bandId, ssid, pass, relayText;`; delete the id lines from `loadSettings()` (it keeps only `ssid`, `pass`, `relayText`); in `setup()`, right after `WiFi.mode(WIFI_STA);`, write:

```cpp
  // A new wristband at every boot: the key lives in RAM only, and the id is its hash.
  bandKey = makeKey([] { return static_cast<uint32_t>(esp_random()); });
  bandId = idFor(bandKey);
  prefs.begin("otb", false);
  prefs.remove("id");  // the id an older build kept for good is not kept any more
  loadSettings();
```

(delete the old `prefs.begin` / `loadSettings()` pair there), and in `onSocket()` send `helloFrame(bandId, bandKey, level)`. Update the comment above `setup()`'s radio line accordingly ("The radio on before the key is made").

- [ ] **Step 11: The stand-in makes a key at every load.** In `app/screens/Band.jsx`, import `{ bandIdOf, toHex } from '../lib/sha256.js'`, delete the `hex` helper, and replace the `id` state with:

```jsx
  // A new wristband every load, as the firmware is every boot: the key stays in this page, and the id is its hash.
  const [band] = useState(() => {
    try { localStorage.removeItem('otb:band-id'); } catch { /* a private window */ }
    const key = toHex(crypto.getRandomValues(new Uint8Array(16)));
    return { key, id: bandIdOf(key) };
  });
```

The hello becomes `sock.send(JSON.stringify({ t: 'wristband', id: band.id, key: band.key, v: 2, battery: batteryNow.current }))` and the socket effect's dependency list is `[band]`.

- [ ] **Step 12: Both firmware envs still build**

Run (PowerShell): `& C:\Users\LewisDong\.platformio\penv\Scripts\pio.exe run -d firmware -e m5stickc -e m5sticks3 2>&1 | Select-String "SUCCESS|FAILED|error:"`
Expected: two `[SUCCESS]`.

- [ ] **Step 13: Full suite, commit**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add app/lib/sha256.js tests/sha256.test.js firmware/src/band_logic.h firmware/host/logic_test.cpp firmware/src/main.cpp app/screens/Band.jsx tests/firmware.test.js
git commit -m "Make a band key at every boot; the id is its hash, and the hello says v2"
```

### Task 4: The relay — the key proves the id

**Files:**
- Create: `tests/relay-harness.js` (the helpers move here out of `tests/server.test.js`), `tests/wristband.test.js`
- Modify: `relay/server.js`, `tests/server.test.js`

**Interfaces:**
- Consumes: `bandIdOf` semantics from Task 3.
- Produces (relay): `export const bandIdOf = (keyHex) => string` from `relay/server.js`; band records gain `old: boolean`; a refused hello answers `{t:'error',why:'bad band'}` and closes with code 4001; a replaced band socket is closed with 4000.
- Produces (tests): `helpers(port: () => number)` → `{ phone, wristband, hello, reply, pairBand, rawSocket, close, cleanup }`; `newKey()`, `pause(ms)`.
  - `phone(venue, { band, ip, quiet, me })` — every phone gets its own `cf-connecting-ip` unless `ip` is given, so the per-address limit trips only where a test means it to.
  - `wristband(battery = 62, { key, secret, quiet, v1 })` → `{ ws, id, key, secret, show, replies, send, until(pred(show, band), ms) }`; records the `paired` secret and every `set`/`error` reply.
  - `hello(frame)` → `{ ws, reply, closed }` (`closed` is the close code, or null within 300 ms).
  - `pairBand(phone, band)` → the `paired` message (this task: by the letters alone; Task 5 puts the check in).
  - `rawSocket()` → `{ send(obj), end() }`, a socket that never reads what comes back.

- [ ] **Step 1: Move the helpers.** Create `tests/relay-harness.js`:

```js
// ON THE BEAT — phones and wristbands on real sockets, for the relay's tests.
//
// Not a test file itself (node --test runs *.test.js): server.test.js,
// wristband.test.js and rules.test.js share it.

import { randomBytes } from 'node:crypto';
import { connect as tcp } from 'node:net';
import WebSocket from 'ws';
import { WS_PATH, bandIdOf } from '../relay/server.js';

export const newKey = () => randomBytes(16).toString('hex');
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Everything a test file needs, against the relay whose port `port()` gives. */
export function helpers(port) {
  // Every socket a test opens, so a failing test cannot leave one holding the run open.
  const clients = new Set();
  // Each phone its own address behind the tunnel, so the per-address limit only trips where a test means it to.
  let phones = 0;
  const address = () => 'ws://127.0.0.1:' + port() + WS_PATH;

  /** A phone: a socket, the last view it was pushed, and a way to wait for the next one that fits. */
  async function phone(venue, { band, ip = '198.51.100.' + (1 + (phones++ % 250)), quiet, me = randomBytes(16).toString('hex') } = {}) {
    const ws = new WebSocket(address(), ip ? { headers: { 'cf-connecting-ip': ip } } : undefined);
    clients.add(ws);
    const p = { ws, me, view: null, errors: [], sent: [], waiters: [] };
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.t === 'view') p.view = m.view;
      if (m.t === 'error') p.errors.push(m.why);
      if (m.t === 'sent') p.sent.push(m);
      p.waiters = p.waiters.filter((w) => !w());
    });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    p.send = (m) => ws.send(JSON.stringify(m));
    p.until = (pred, ms = 3000) => new Promise((resolve, reject) => {
      const check = () => { if (p.view && pred(p.view, p)) { clearTimeout(timer); resolve(p.view); return true; } return false; };
      const timer = setTimeout(() => reject(new Error('timed out; last view ' + JSON.stringify(p.view))), ms);
      if (!check()) p.waiters.push(check);
    });
    p.send({ t: 'join', venue, me, band, ...(quiet ? { quiet: true } : {}) });
    await p.until(() => true);
    return p;
  }

  /**
   * A wristband: a socket that says hello as the firmware does — its id, the
   * key that proves it, v2, and a secret when it has one — and remembers the
   * last show and the secret it is given.
   */
  async function wristband(battery = 62, { key = newKey(), secret = null, quiet = false, v1 = false } = {}) {
    const ws = new WebSocket(address());
    clients.add(ws);
    const id = v1 ? randomBytes(16).toString('hex') : bandIdOf(key);
    const b = { ws, id, key, secret, show: null, replies: [], waiters: [] };
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.t === 'show') b.show = m.show;
      if (m.t === 'paired') b.secret = m.secret;
      if (m.t === 'set' || m.t === 'error') b.replies.push(m);
      b.waiters = b.waiters.filter((w) => !w());
    });
    await new Promise((resolve) => ws.once('open', resolve));
    b.send = (m) => ws.send(JSON.stringify(m));
    b.until = (pred, ms = 3000) => new Promise((resolve, reject) => {
      const check = () => { if (b.show && pred(b.show, b)) { clearTimeout(timer); resolve(b.show); return true; } return false; };
      const timer = setTimeout(() => reject(new Error('band timed out; last show ' + JSON.stringify(b.show))), ms);
      if (!check()) b.waiters.push(check);
    });
    b.send(v1 ? { t: 'wristband', id, battery } : { t: 'wristband', id, key, v: 2, battery, ...(secret ? { secret } : {}), ...(quiet ? { quiet: true } : {}) });
    await b.until(() => true);
    return b;
  }

  /** A hello that may be refused: the first reply, and the close code if the relay closed the socket. */
  async function hello(m) {
    const ws = new WebSocket(address());
    clients.add(ws);
    await new Promise((resolve) => ws.once('open', resolve));
    const first = new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(String(d)))));
    const closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
    ws.send(JSON.stringify(m));
    return { ws, reply: await first, closed: await Promise.race([closed, pause(300).then(() => null)]) };
  }

  /** The next reply of a kind on a phone's socket. */
  const reply = (p, t, ms = 3000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { p.ws.off('message', on); reject(new Error('no ' + t + ' reply')); }, ms);
    const on = (data) => { const m = JSON.parse(String(data)); if (m.t === t) { clearTimeout(timer); p.ws.off('message', on); resolve(m); } };
    p.ws.on('message', on);
  });

  /** Pair a phone and a wristband by its letters. */
  async function pairBand(p, band) {
    const paired = reply(p, 'paired');
    p.send({ t: 'pair', code: band.show.code });
    return paired;
  }

  /**
   * A socket that speaks WebSocket frames by hand and never reads what comes
   * back, so it never learns it was closed: a replaced wristband that is
   * still sending.
   */
  function rawSocket() {
    return new Promise((resolve, reject) => {
      const s = tcp(port(), '127.0.0.1');
      s.once('error', reject);
      let head = '';
      const onData = (d) => {
        head += d.toString('latin1');
        if (!head.includes('\r\n\r\n')) return;
        s.off('data', onData);
        s.on('data', () => {});   // everything after the handshake is ignored, the close frame too
        resolve({
          send(m) {
            const payload = Buffer.from(JSON.stringify(m));
            const mask = randomBytes(4);
            const len = payload.length < 126 ? [0x80 | payload.length] : [0x80 | 126, payload.length >> 8, payload.length & 255];
            s.write(Buffer.concat([Buffer.from([0x81, ...len]), mask, payload.map((x, i) => x ^ mask[i % 4])]));
          },
          end: () => s.destroy(),
        });
      };
      s.on('data', onData);
      s.write('GET ' + WS_PATH + ' HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
        + 'Sec-WebSocket-Key: ' + randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
  }

  const close = (...socks) => socks.forEach((x) => x.ws.close());
  const cleanup = () => { for (const ws of clients) ws.terminate(); };

  return { phone, wristband, hello, reply, pairBand, rawSocket, close, cleanup };
}
```

In `tests/server.test.js`: import `bandIdOf` from the relay and `{ helpers, newKey }` from `./relay-harness.js`; replace the `clients` comment with "Sockets a test opens by hand…", add `const { phone, wristband, reply, pairBand, close, cleanup } = helpers(() => relay.port);`, call `cleanup()` first in `after()`, and delete the file's own `phone`, `close`, `wristband` and `reply` definitions. Two tests change their hellos, because a v1 hello will no longer pair:
- `a phone back before its wristband holds the claim…`: `const key = newKey(); const id = bandIdOf(key);` replaces the random id, and the band is `await wristband(40, { key })`.
- `the band table has a ceiling…`: `const key = newKey(); band.send(JSON.stringify({ t: 'wristband', id: bandIdOf(key), key, v: 2, battery: 88 }));`.

`bandIdOf` is not exported by the relay yet, so the suite fails to load — that is this task's first red.

- [ ] **Step 2: Write the failing tests** — `tests/wristband.test.js`:

```js
// ON THE BEAT — who a wristband is, pairing with a check, and the wrist's own `set`.
// One test per guard; each was mutation-checked (README, Abuse resistance).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRelay, bandIdOf } from '../relay/server.js';
import { helpers, newKey, pause } from './relay-harness.js';

let relay;
let dir;
const { phone, wristband, hello, reply, pairBand, rawSocket, close, cleanup } = helpers(() => relay.port);

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'otb-band-'));
  relay = await createRelay({ port: 0, host: '127.0.0.1', root: dir });
});
after(async () => {
  cleanup();
  await relay.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------- §0: the key proves the id ----------

test('a hello whose key does not hash to its id is refused: a new id, an unpaired record, a paired one', async () => {
  const stranger = await hello({ t: 'wristband', id: bandIdOf(newKey()), key: newKey(), v: 2 });
  assert.deepEqual([stranger.reply, stranger.closed], [{ t: 'error', why: 'bad band' }, 4001], 'a new id with the wrong key');
  const band = await wristband();
  assert.equal((await hello({ t: 'wristband', id: band.id, key: newKey(), v: 2 })).reply.why, 'bad band', 'an unpaired record');
  const ana = await phone('key-room');
  await pairBand(ana, band);
  const taken = await hello({ t: 'wristband', id: band.id, key: newKey(), v: 2, secret: band.secret ?? undefined });
  assert.equal(taken.reply.why, 'bad band', 'a paired record, even with its secret');
  ana.send({ t: 'arm', intent: 'hi' });
  await band.until((s) => s.kind === 'hi');   // and the live wristband was left alone
  close(ana, band);
});

test('a hello with no protocol version gets letters but is never paired', async () => {
  const old = await wristband(62, { v1: true });
  assert.equal(old.show.kind, 'pairing');
  const ana = await phone('old-room');
  const no = reply(ana, 'error');
  ana.send({ t: 'pair', code: old.show.code });
  assert.equal((await no).why, 'old firmware');
  close(ana, old);
});

test('a socket says hello once', async () => {
  const band = await wristband();
  const other = newKey();
  band.send({ t: 'wristband', id: bandIdOf(other), key: other, v: 2 });
  await band.until((s, b) => b.replies.some((m) => m.why === 'bad band'));
  await new Promise((r) => (band.ws.readyState === 3 ? r() : band.ws.once('close', r)));
});

test('frames on a replaced wristband socket are dropped', async () => {
  const band = await wristband();
  const ana = await phone('replaced-room');
  const ben = await phone('replaced-room');
  const { secret } = await pairBand(ana, band);
  ana.send({ t: 'arm', intent: 'hi' });
  await ben.until((v) => v.near.length === 1);
  const raw = await rawSocket();
  raw.send({ t: 'wristband', id: band.id, key: band.key, v: 2, secret });   // the raw socket takes over...
  await pause(100);
  const next = await wristband(62, { key: band.key, secret });              // ...and is replaced, but never reads that
  raw.send({ t: 'hold' });
  await pause(300);
  assert.equal(ben.view.near.length, 1, 'a hold from the replaced socket did not land');
  next.send({ t: 'hold' });
  await ben.until((v) => v.near.length === 0);
  raw.end();
  close(ana, ben, next);
});
```

(`secret` is `undefined` until Task 5 gives one; `JSON.stringify` drops it, and from Task 6 on the same lines carry the real secret.)

- [ ] **Step 3: Run to see them fail**

Run: `npm run build >/dev/null && node --test tests/wristband.test.js tests/server.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)|SyntaxError"`
Expected: both files fail to load (`bandIdOf` is not exported).

- [ ] **Step 4: Implement.** In `relay/server.js`:
  1. `import { createHash, randomBytes } from 'node:crypto';` and add after `venueKey`:
     ```js
     /** A wristband's id: the first 32 hex of SHA-256 over its 16-byte key. Only the wristband knows the key. */
     export const bandIdOf = (key) => createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex').slice(0, 32);
     ```
     and `const HEX32 = /^[a-f0-9]{32}$/;` beside the other constants.
  2. `makeBand` gains `old: false`.
  3. Replace the `if (m.t === 'wristband') { … }` block in `handle()` with `if (m.t === 'wristband') { hello(ws, m); return; }` and add, after `handleBand`:
     ```js
       function refuseBand(ws) {
         ws.send(JSON.stringify({ t: 'error', why: 'bad band' }));
         ws.close(4001, 'bad band');
       }

       function hello(ws, m) {
         if (ws.r) { ws.send(JSON.stringify({ t: 'error', why: 'bad band' })); return; }
         const id = String(m.id || '');
         const v2 = m.v === 2;
         const key = String(m.key || '');
         // The key proves the id; a socket says hello once.
         const proven = v2 ? HEX32.test(id) && HEX32.test(key) && bandIdOf(key) === id : /^[a-f0-9]{16,64}$/.test(id);
         if (ws.band || !proven) { refuseBand(ws); return; }
         let b = bands.get(id);
         // A hello with no version never reaches a record made by one with, nor the other way round.
         if (b && b.old === v2) { refuseBand(ws); return; }
         if (!b) {
           if (bands.size >= maxBands && !evictBand(Date.now())) { ws.send(JSON.stringify({ t: 'error', why: 'too many wristbands' })); return; }
           b = makeBand(id, ws);
           b.old = !v2;
           bands.set(id, b);
         }
         // Replaced, not cut off: it may still be closing, and its frames are dropped from here on.
         if (b.ws && b.ws !== ws) b.ws.close(4000, 'replaced');
         b.ws = ws;
         b.everWs = true;
         b.lastShow = null;
         ws.band = id;
         if (!b.person && !b.code) unpairBand(b);
         if (m.battery !== undefined) handleBand(ws, { t: 'battery', level: m.battery });
         else showBand(b);
       }
     ```
  4. In `handleBand`, the first line becomes:
     ```js
         // Only from the wristband's current socket: a set stuck in a replaced one must not land.
         if (!b || b.ws !== ws) return;
     ```
  5. In the `pair` case, refuse a v1 band by its letters, right after `const mine = …`:
     ```js
             if (b?.old) { ws.send(JSON.stringify({ t: 'error', why: 'old firmware' })); return; }
     ```

- [ ] **Step 5: Run to see them pass**

Run: `npm run build >/dev/null && node --test tests/wristband.test.js tests/server.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 6: Mutation checks (P1)**, file `tests/wristband.test.js`:
  - `HEX32.test(key) && bandIdOf(key) === id` → `HEX32.test(key)` ⇒ `a hello whose key does not hash to its id is refused…`
  - delete the `if (b?.old) …'old firmware'…` line ⇒ `a hello with no protocol version gets letters but is never paired`
  - `if (ws.band || !proven)` → `if (!proven)` ⇒ `a socket says hello once`
  - `if (!b || b.ws !== ws) return;` → `if (!b) return;` ⇒ `frames on a replaced wristband socket are dropped` (if this stays green, check the replaced socket is closed with `close(4000…)`, not `terminate()`: only a closing socket can still deliver the frame this guard drops)

- [ ] **Step 7: Full suite, commit**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add relay/server.js tests/relay-harness.js tests/wristband.test.js tests/server.test.js
git commit -m "Refuse a hello whose key does not hash to its id, and frames from a replaced wristband socket"
```

### Task 5: The relay — pairing ends with a check

**Files:**
- Modify: `relay/server.js`, `relay/band.js`, `tests/relay-harness.js` (`pairBand`), `tests/wristband.test.js`, `tests/server.test.js`, `tests/band.test.js`, `tests/firmware.test.js`
- Modify: `firmware/src/band_logic.h`, `firmware/host/logic_test.cpp` (the check's face, so the round trip reads it)

**Interfaces:**
- Produces (relay): options `clock = Date.now`, `pairCheckMs = PAIR_CHECK_MS`; `export const PAIR_CHECK_MS = 60_000`; phone → relay `{t:'pair', code}` starts a check and `{t:'confirm', yes: boolean}` answers it; relay → phone `view.me.check: number|null`, `{t:'paired', band, secret}`, `{t:'check', ok:false, why:'timeout'}`, `{t:'error', why:'busy'|'old firmware'|'no such wristband'|'too many tries'}`; relay → band `{t:'show', show:{kind:'check', big:'27'}}` and on YES `{t:'paired', secret}`; `tickBands(at)` also times checks out.
- Produces (relay/band.js): `bandShow({ …, check })`.
- Produces (C++): `wordsFor`/`lightFor` know `kind == "check"`.
- Produces (tests): `pairBand(phone, band)` goes through the check and waits for the band's secret.

- [ ] **Step 1: Write the failing relay tests** — append to `tests/wristband.test.js` (and add `PAIR_CHECK_MS` to its relay import):

```js
// ---------- §0: the check ----------

test('a hello with the wrong key is refused for a record being paired too', async () => {
  const band = await wristband();
  const ana = await phone('pending-key');
  ana.send({ t: 'pair', code: band.show.code });
  await band.until((s) => s.kind === 'check');
  assert.equal((await hello({ t: 'wristband', id: band.id, key: newKey(), v: 2 })).reply.why, 'bad band');
  close(ana, band);
});

test('pairing waits for the check: the wrist shows a number, the phone is asked, YES pairs and gives both a secret', async () => {
  const band = await wristband();
  const ana = await phone('check-room');
  const early = [];
  ana.ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'paired') early.push(m); });
  ana.send({ t: 'pair', code: band.show.code });
  const { me: { check } } = await ana.until((v) => v.me.check);
  assert.ok(check >= 10 && check <= 99);
  assert.deepEqual(await band.until((s) => s.kind === 'check'), { kind: 'check', big: String(check) });
  await pause(100);
  assert.deepEqual(early, [], 'nothing is paired before YES');
  assert.equal(ana.view.me.wristband, null);
  const paired = reply(ana, 'paired');
  ana.send({ t: 'confirm', yes: true });
  const m = await paired;
  assert.equal(m.band, band.id);
  assert.match(m.secret, /^[a-f0-9]{32}$/);
  await band.until((s, b) => b.secret === m.secret);
  await ana.until((v) => v.me.check === null && v.me.wristband?.live);
  close(ana, band);
});

test('NO drops the pairing, and the wristband shows fresh letters', async () => {
  const band = await wristband();
  const { code } = band.show;
  const ana = await phone('no-room');
  ana.send({ t: 'pair', code });
  await ana.until((v) => v.me.check);
  ana.send({ t: 'confirm', yes: false });
  const fresh = await band.until((s) => s.kind === 'pairing');
  assert.notEqual(fresh.code, code);
  await ana.until((v) => v.me.check === null && v.me.wristband === null);
  const gone = reply(ana, 'error');
  ana.send({ t: 'pair', code });
  assert.equal((await gone).why, 'no such wristband', 'the old letters are gone');
  close(ana, band);
});

test('no answer within PAIR_CHECK_MS: dropped, fresh letters, and the phone is told', async () => {
  const band = await wristband();
  const { code } = band.show;
  const ana = await phone('timeout-room');
  ana.send({ t: 'pair', code });
  await ana.until((v) => v.me.check);
  const told = reply(ana, 'check');
  relay.tickBands(Date.now() + PAIR_CHECK_MS - 1_000);
  await pause(100);
  assert.equal(band.show.kind, 'check', 'not yet');
  relay.tickBands(Date.now() + PAIR_CHECK_MS + 1_000);
  assert.deepEqual(await told, { t: 'check', ok: false, why: 'timeout' });
  assert.notEqual((await band.until((s) => s.kind === 'pairing')).code, code);
  close(ana, band);
});

test('a second pair for a wristband being paired is refused busy', async () => {
  const band = await wristband();
  const { code } = band.show;
  const ana = await phone('busy-room');
  const ben = await phone('busy-room');
  ana.send({ t: 'pair', code });
  await ana.until((v) => v.me.check);
  const busy = reply(ben, 'error');
  ben.send({ t: 'pair', code });
  assert.equal((await busy).why, 'busy');
  close(ana, ben, band);
});

test('check numbers are unique among the pairings in progress', async () => {
  const bands = [];
  for (let i = 0; i < 40; i += 1) bands.push(await wristband());
  const numbers = [];
  for (const b of bands) {
    const p = await phone('unique-room');
    p.send({ t: 'pair', code: b.show.code });
    numbers.push((await p.until((v) => v.me.check)).me.check);
  }
  // Forty from ninety: with nothing keeping them apart, two would share a number all but always.
  assert.equal(new Set(numbers).size, numbers.length, 'every pending number differs: ' + numbers.join(','));
  cleanup();
});

test('every pair attempt counts toward the socket limit, right letters or wrong', async () => {
  relay.expire(Date.now() + 61_000);
  const ana = await phone('count-room', { ip: '203.0.113.20' });
  for (let i = 0; i < 5; i += 1) {
    const band = await wristband();
    ana.send({ t: 'pair', code: band.show.code });
    await ana.until((v) => v.me.check);
    ana.send({ t: 'confirm', yes: false });
    await ana.until((v) => v.me.check === null);
  }
  const band = await wristband();
  const blocked = reply(ana, 'error');
  ana.send({ t: 'pair', code: band.show.code });
  assert.equal((await blocked).why, 'too many tries', 'the sixth, though its letters are right');
  close(ana);
});
```

In `tests/band.test.js` add:

```js
test('while a pairing waits for YES the wrist shows the check number, before anything else', () => {
  assert.deepEqual(bandShow({ view: view({ armed: 'hi' }), code: 'KXRT', check: 27, testUntil: T + 1, now: T }), { kind: 'check', big: '27' });
});
```

- [ ] **Step 2: Put the check into `pairBand`** (`tests/relay-harness.js`):

```js
  /** Pair a phone and a wristband all the way: the letters, the number on the wrist, YES. */
  async function pairBand(p, band) {
    p.send({ t: 'pair', code: band.show.code });
    const { me: { check } } = await p.until((v) => v.me.check);
    await band.until((s) => s.kind === 'check' && s.big === String(check));
    const paired = reply(p, 'paired');
    p.send({ t: 'confirm', yes: true });
    const m = await paired;
    await band.until((s, bb) => bb.secret === m.secret);
    return m;
  }
```

and update the existing pairing tests in `tests/server.test.js`:
- `a wristband pairs by its four letters…`: replace the lines from `const paired = reply(ana, 'paired');` to `assert.equal((await paired).band, band.id);` with
  ```js
  ana.send({ t: 'pair', code: code.toLowerCase() });
  const { me: { check } } = await ana.until((v) => v.me.check);
  await band.until((s) => s.kind === 'check' && s.big === String(check));
  const paired = reply(ana, 'paired');
  ana.send({ t: 'confirm', yes: true });
  assert.equal((await paired).band, band.id);
  ```
  and make its wrong-code line `ana.send({ t: 'pair', code: 'ZZZZ' === code ? 'YYYY' : 'ZZZZ' });`.
- `holding the wristband's button…` and `after a mutual yes…`: `ana.send({ t: 'pair', code: … })` / `ben.send(…)` become `await pairBand(ana, band)` / `await pairBand(ana, b1); await pairBand(ben, b2);`.
- `a phone re-pairs by the id it was given…` and `a new pairing flashes the wristband white once…`: the `reply(ana,'paired')` + `ana.send({t:'pair', code})` pair becomes `const { band: id } = await pairBand(ana, band);`.
- `a dropped wristband keeps its letters through a blip`: the letters now reach a pending check, not a pairing:
  ```js
  ana.send({ t: 'pair', code });
  assert.ok((await ana.until((v) => v.me.check)).me.check, 'the letters still reach it inside the grace window');
  ```
- `the band table has a ceiling…`: the late phone is asked, not paired —
  ```js
    let checked = null, refused = null;
    late.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'view' && m.view.me.check) checked = m.view.me.check; if (m.t === 'error') refused = m.why; });
  ```
  and `assert.ok(checked && !refused, 'the connected wristband survived the flood (refused: ' + refused + ')');`
- In `malformed and hostile messages…` add `{ t: 'confirm' }, { t: 'confirm', yes: 'yes' },` to `bad`.

In `tests/firmware.test.js`, the round trip pairs through the check: replace `ana.send({ t: 'pair', code }); assert.equal((await ana.until('paired')).band, id, …);` with

```js
    ana.send({ t: 'pair', code });
    const { show: { big } } = await band.until('show', (m) => m.show.kind === 'check');
    assert.equal(Number(big), (await ana.until('view', (m) => m.view.me.check)).view.me.check, 'the number on the wrist is the one the phone asks about');
    ana.send({ t: 'confirm', yes: true });
    const { band: pairedId, secret } = await ana.until('paired');
    assert.equal(pairedId, id, 'paired to the id the firmware made from its key');
```

(`secret` is used from Task 6), add `if (s.kind === 'check') assert.deepEqual(words, { big: s.big, small: 'ON YOUR PHONE?' }, text);` inside the `forEach`, and make the kinds list `['check', 'dance', 'hi', 'meet', 'off', 'pairing', 'song', 'test']`.

- [ ] **Step 3: Run to see them fail**

Run: `npm run build >/dev/null && node --test tests/wristband.test.js tests/server.test.js tests/band.test.js tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: the new check tests and every test that pairs fail (no `view.me.check`; `confirm` unknown).

- [ ] **Step 4: `bandShow` shows the check.** In `relay/band.js`, document `@param {number|null} p.check   set while a pairing waits for YES: the number the phone asks about`, add `check = null` to the parameters, and make the first line `if (check) return { kind: 'check', big: String(check) };`.

- [ ] **Step 5: Implement the check in `relay/server.js`.**
  1. Options: `clock = Date.now, pairCheckMs = PAIR_CHECK_MS` in `createRelay`'s parameter list, and `const now = () => clock();` as its first line. Replace every `Date.now()` inside `createRelay` with `now()` (`makeBand`'s `claimedAt`, `showBand`'s default, `keepClip`'s `at`, both `evictBand(…)` calls, both `testUntil`s, `tooMany`/`wrongCode` defaults, the close handler's `goneAt`, the sweep interval). Export beside `WS_PATH`: `export const PAIR_CHECK_MS = 60_000;          // a pending pairing waits this long for YES`. Import `randomInt` from `node:crypto`.
  2. Rename `wrongCode` to `attempt` (both uses), and the two constants' comments to "pairing attempts".
  3. `makeBand` gains `secret: null` and `pending: null` (`{ key, person, number, until }` while a pairing waits for YES).
  4. Helpers, beside `bandOf`:
     ```js
       const pendingOf = (key, person) => [...bands.values()].find((b) => b.pending?.key === key && b.pending.person === person) || null;
     ```
     and beside `push`:
     ```js
       const toPerson = (r, me, m) => { for (const s of r.sockets) if (s.me === me) s.send(JSON.stringify(m)); };
     ```
  5. `push()`: after the `wristband` line add
     ```js
           // A pairing waiting for YES belongs to the person, not the socket: every phone of theirs is asked.
           view.me.check = pendingOf(r.key, ws.me)?.pending.number ?? null;
     ```
     and redraw pending bands too: `for (const b of bands.values()) if (b.key === r.key || b.pending?.key === r.key) showBand(b);`.
  6. `showBand()` passes `check: b.pending?.number ?? null` to `bandShow`.
  7. Replace `unpairBand` with `freshLetters` + `unpairBand` + `dropPending`:
     ```js
       /** Nobody's, and nobody is pairing it: fresh letters while it is worn; forgotten when it is not. */
       function freshLetters(b) {
         codes.delete(b.code);
         Object.assign(b, { code: null, key: null, person: null, secret: null, pending: null });
         if (b.ws) {
           b.code = newCode(new Set(codes.keys()));
           codes.set(b.code, b.id);
         } else {
           // Nobody is wearing it. If it comes back, it comes back new.
           bands.delete(b.id);
         }
       }

       function unpairBand(b) {
         const r = b.key ? rooms.get(b.key) : null;
         freshLetters(b);
         if (r) push(r);
         showBand(b);
       }

       /** A pairing that did not end in YES. `why` is told to the person's phones: 'timeout', or null when they said NO themselves. */
       function dropPending(b, why) {
         const r = rooms.get(b.pending.key);
         const person = b.pending.person;
         freshLetters(b);
         if (r && why) toPerson(r, person, { t: 'check', ok: false, why });
         if (r) push(r);
         showBand(b);
       }
     ```
  8. The pairing itself, after `handleBand`:
     ```js
       function checkNumber() {
         // Two digits, like a meeting number, and not one another pairing is showing.
         const taken = new Set([...bands.values()].filter((b) => b.pending).map((b) => b.pending.number));
         let n = 10 + randomInt(90);
         for (let i = 0; i < 90 && taken.has(n); i += 1) n = n === 99 ? 10 : n + 1;
         return n;
       }

       /** By the four letters. Nothing pairs yet: the wristband that was reached shows a number, and the phone is asked. */
       function pairByCode(ws, r, me, m) {
         const error = (why) => ws.send(JSON.stringify({ t: 'error', why }));
         if (tooMany(ws)) { error('too many tries'); return; }
         attempt(ws);   // every attempt counts, right or wrong
         const b = bands.get(codes.get(cleanCode(m.code)));
         if (!b) { error('no such wristband'); return; }
         if (b.old) { error('old firmware'); return; }
         if (b.pending) { error('busy'); return; }
         const mine = pendingOf(r.key, me);
         if (mine) dropPending(mine, null);   // one pending per person: the newest letters win
         b.pending = { key: r.key, person: me, number: checkNumber(), until: now() + pairCheckMs };
         showBand(b);
       }

       function confirm(r, me, m) {
         const b = pendingOf(r.key, me);
         if (!b) return;
         if (m.yes !== true) { dropPending(b, null); return; }
         if (!b.ws) { dropPending(b, 'timeout'); return; }   // nothing on the wrist to give a secret to
         const old = bandOf(r.key, me);
         if (old) unpairBand(old);
         codes.delete(b.code);
         Object.assign(b, { pending: null, code: null, key: r.key, person: me, secret: randomBytes(16).toString('hex') });
         // Paired: it flashes white once, so the right wrist knows it was the one.
         b.testUntil = now() + 900;
         b.ws.send(JSON.stringify({ t: 'paired', secret: b.secret }));
         toPerson(r, me, { t: 'paired', band: b.id, secret: b.secret });
       }

       /** After a reconnect, by the id only this phone was told when it paired. */
       function claim(ws, r, me, m) {
         const id = String(m.band || '');
         let b = id ? bands.get(id) : null;
         // A relay that restarted has forgotten every wristband, and the phone can
         // be back before its wristband is: a bare id claims the band, and the
         // wristband comes back already paired. Until one does, the claim is only
         // a placeholder the sweep forgets. Unproven, so counted.
         const wouldClaim = !b && /^[a-f0-9]{16,64}$/.test(id);
         if (wouldClaim && tooMany(ws)) { ws.send(JSON.stringify({ t: 'error', why: 'too many tries' })); return; }
         if (wouldClaim) {
           attempt(ws);
           if (bands.size >= maxBands && !evictBand(now())) { ws.send(JSON.stringify({ t: 'error', why: 'too many wristbands' })); return; }
           b = makeBand(id, null);
           bands.set(id, b);
         }
         const mine = b && b.key === r.key && b.person === me;
         if (!b || (!mine && !wouldClaim)) { ws.send(JSON.stringify({ t: 'error', why: 'no such wristband' })); return; }
         if (!mine) { b.key = r.key; b.person = me; }
         ws.send(JSON.stringify({ t: 'paired', band: b.id }));
       }
     ```
  9. In `handle()`, the `pair` case becomes
     ```js
           case 'pair':
             if (m.code !== undefined && m.code !== null) pairByCode(ws, r, me, m);
             else claim(ws, r, me, m);
             break;
           case 'confirm': confirm(r, me, m); break;
     ```
     (the old combined code, its comments and the `b?.old` line from Task 4 go; `pairByCode` now holds the old-firmware refusal).
  10. `tickBands` becomes a named function the lights interval calls, and times checks out:
     ```js
       // A pairing check that timed out, and every wristband's face, once a second.
       function tickBands(at = now()) {
         for (const b of [...bands.values()]) if (b.pending && at >= b.pending.until) dropPending(b, 'timeout');
         for (const b of bands.values()) showBand(b, at);
       }
     ```
     with `const lights = setInterval(() => tickBands(), 1000);` and `tickBands,` in the returned object (keep its comment: "time out pairing checks and redraw every wristband as if the clock read `at`").

- [ ] **Step 6: The firmware reads the check.** In `band_logic.h`'s `wordsFor`, after the pairing line: `if (s.kind == "check") return {s.big, "ON YOUR PHONE?"};`. In `lightFor`: `if (s.kind == "pairing" || s.kind == "check") return LIGHT_PAIR;` (replacing the pairing-only line). In `logic_test.cpp`'s `face()`, add:

```cpp
  Show check;
  check.kind = "check";
  check.big = "27";
  f = faceFor(&check, false, false);
  w = wordsFor(f, false, 62, Signal::LIVE);
  CHECK(w.big == "27" && w.small == "ON YOUR PHONE?" && lightFor(f, false) == LIGHT_PAIR);
```

- [ ] **Step 7: Run to see them pass**

Run: `npm run build >/dev/null && node --test tests/wristband.test.js tests/server.test.js tests/band.test.js tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 8: Mutation checks (P1)**, file `tests/wristband.test.js`:
  - after `b.pending = { … };` add `toPerson(r, me, { t: 'paired', band: b.id });` ⇒ `pairing waits for the check…`
  - delete `if (m.yes !== true) { dropPending(b, null); return; }` ⇒ `NO drops the pairing…`
  - delete the `dropPending(b, 'timeout')` line in `tickBands` ⇒ `no answer within PAIR_CHECK_MS…`
  - delete `if (b.pending) { error('busy'); return; }` ⇒ `a second pair … is refused busy`
  - `i < 90 && taken.has(n)` → `i < 0 && taken.has(n)` ⇒ `check numbers are unique…`
  - move `attempt(ws);` from before the lookup to inside `if (!b) { attempt(ws); error('no such wristband'); return; }` ⇒ `every pair attempt counts…`

- [ ] **Step 9: Full suite, commit**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add relay/server.js relay/band.js tests/relay-harness.js tests/wristband.test.js tests/server.test.js tests/band.test.js tests/firmware.test.js firmware/src/band_logic.h firmware/host/logic_test.cpp
git commit -m "End every pairing with a check number the phone confirms"
```


### Task 6: The relay — a secret per pairing

**Files:**
- Modify: `relay/server.js` (`hello`, `claim`), `tests/wristband.test.js`, `tests/server.test.js`, `tests/firmware.test.js`

**Interfaces:**
- Consumes: `b.secret` made on YES (Task 5); the harness's `wristband(…, { secret })`.
- Produces: a hello for a paired id is refused (`bad band`, 4001) unless it carries that record's `secret`; the phone's claim is `{t:'pair', band, secret}` and is answered `{t:'claim', ok:true, band}` or `{t:'claim', ok:false, why:'waiting'|'gone'}` — never `paired`, never `no such wristband`. A claim for an id the relay does not hold, with a well-formed id and secret, keeps a placeholder with that secret and answers `waiting`.

- [ ] **Step 1: Write the failing tests** — append to `tests/wristband.test.js`:

```js
// ---------- §0: the secret ----------

test("a paired wristband's hello needs its secret; without it the new socket is refused and the live one survives", async () => {
  const band = await wristband();
  const ana = await phone('secret-room');
  const { secret } = await pairBand(ana, band);
  const bare = await hello({ t: 'wristband', id: band.id, key: band.key, v: 2 });
  assert.deepEqual([bare.reply.why, bare.closed], ['bad band', 4001], 'the id and even the key are not enough');
  const wrong = await hello({ t: 'wristband', id: band.id, key: band.key, v: 2, secret: newKey() });
  assert.equal(wrong.reply.why, 'bad band');
  ana.send({ t: 'arm', intent: 'dance' });
  await band.until((s) => s.kind === 'dance');
  const back = await wristband(62, { key: band.key, secret });
  assert.equal(back.show.kind, 'dance', 'with it, the same wristband, still paired');
  close(ana, back);
});

test('a claim needs the secret', async () => {
  const band = await wristband();
  const ana = await phone('claim-room');
  const { band: id } = await pairBand(ana, band);
  const bare = reply(ana, 'claim');
  ana.send({ t: 'pair', band: id });
  assert.deepEqual(await bare, { t: 'claim', ok: false, why: 'gone' });
  close(ana, band);
});
```

Update `tests/server.test.js` to the claim answers:
- Rename `a phone re-pairs by the id it was given; nobody else can use it` to `a phone re-claims by the id and the secret it was given; nobody else can use them`, and make its body:
  ```js
  const band = await wristband();
  const ana = await phone('band-room-4');
  const { band: id, secret } = await pairBand(ana, band);
  const again = reply(ana, 'claim');
  ana.send({ t: 'pair', band: id, secret });
  assert.deepEqual(await again, { t: 'claim', ok: true, band: id }, 'the phone that paired it can say so again');
  const ben = await phone('band-room-4');
  const no = reply(ben, 'claim');
  ben.send({ t: 'pair', band: id, secret });
  assert.equal((await no).why, 'gone', 'a paired wristband is not taken by another phone, secret or not');
  close(ana, ben);
  band.ws.close();
  ```
- `a phone back before its wristband holds the claim…`: the claim carries a secret and is answered `waiting`, and the wristband comes back with that secret:
  ```js
  const ana = await phone('band-room-5');
  const key = newKey();
  const id = bandIdOf(key);
  const secret = newKey();
  const held = reply(ana, 'claim');
  ana.send({ t: 'pair', band: id, secret, again: true });
  assert.deepEqual(await held, { t: 'claim', ok: false, why: 'waiting' });
  await ana.until((v) => v.me.wristband?.live === false);
  ana.send({ t: 'arm', intent: 'hi' });
  const band = await wristband(40, { key, secret });
  ```
  (the rest of the test is unchanged).
- In `one socket may make only a few unproven pair attempts…`, `a missed code is throttled…` and `id-claims with no wristband behind them are swept…`: every `reply(x, 'paired')` for a claim becomes `reply(x, 'claim')`, every claim `{ t: 'pair', band: randomBytes(16).toString('hex') }` gains `, secret: newKey()`, and the first test's `assert.ok((await ok).band, …)` becomes `assert.equal((await ok).why, 'waiting', 'attempt ' + i + ' should be answered');`.
- In `the band table has a ceiling…`, the phones' claims gain `, secret: newKey()` (without one they are answered `gone` and never make a placeholder, and the ceiling is never reached).
- `a new pairing flashes the wristband white once; claiming it again by id does not`: `const { band: id, secret } = await pairBand(ana, band);`, and the re-claim is `const again = reply(ana, 'claim'); ana.send({ t: 'pair', band: id, secret }); assert.equal((await again).ok, true);`.
- In `malformed and hostile messages…` add `{ t: 'pair', band: 'x', secret: {} },` to `bad`.

In `tests/firmware.test.js`, the Wi-Fi blip re-hello carries the secret, and a bare one is refused. Replace the `// The same id again…` block with:

```js
    // The same wristband again, as after a Wi-Fi blip: with its secret, still paired.
    const bare = await open(relay.port, 'arduino');
    socks.push(bare);
    bare.send(hello);
    assert.equal((await bare.until('error')).why, 'bad band', 'without the secret the id is not enough');
    const [again] = speak(['hello ' + key + ' 62 ' + secret]);
    assert.equal(JSON.parse(again).secret, secret);
    const back = await open(relay.port, 'arduino');
    socks.push(back);
    back.send(again);
    assert.equal((await back.until('show')).show.kind, 'off', 'still paired, still NOT NOW — not new letters');
```

- [ ] **Step 2: Run to see them fail**

Run: `npm run build >/dev/null && node --test tests/wristband.test.js tests/server.test.js tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: the two new tests, the updated claim tests and the firmware round trip fail (claims are still answered `paired`; a bare hello still takes over).

- [ ] **Step 3: Implement.** In `relay/server.js`:
  1. In `hello()`, after `const proven = …; if (ws.band || !proven) …`:
     ```js
         const secret = HEX32.test(String(m.secret || '')) ? String(m.secret) : null;
     ```
     and after the `b.old === v2` refusal:
     ```js
         // A paired record is only reached with its secret. The live socket is left alone.
         if (b?.person && secret !== b.secret) { refuseBand(ws); return; }
     ```
  2. Replace `claim()` with:
     ```js
       /** After a reconnect, by the id and the secret this phone was given. */
       function claim(ws, r, me, m) {
         const id = String(m.band || '');
         const secret = String(m.secret || '');
         const answer = (x) => ws.send(JSON.stringify({ t: 'claim', ...x }));
         const b = bands.get(id);
         const proven = HEX32.test(secret) && b?.secret === secret;
         if (proven && b.key === r.key && b.person === me) {
           // Its own wristband — or its own placeholder, still waiting for the wristband.
           answer(b.everWs ? { ok: true, band: id } : { ok: false, why: 'waiting' });
           return;
         }
         // Unproven from here, and counted: a claim is how the ids would be walked.
         if (tooMany(ws)) { ws.send(JSON.stringify({ t: 'error', why: 'too many tries' })); return; }
         attempt(ws);
         if (b || !HEX32.test(id) || !HEX32.test(secret)) { answer({ ok: false, why: 'gone' }); return; }
         // The phone is back before its wristband: a placeholder with that secret.
         if (bands.size >= maxBands && !evictBand(now())) { ws.send(JSON.stringify({ t: 'error', why: 'too many wristbands' })); return; }
         bands.set(id, Object.assign(makeBand(id, null), { key: r.key, person: me, secret }));
         answer({ ok: false, why: 'waiting' });
       }
     ```
  3. Update the wristband section's header comment to say what now holds: "A wristband makes a key at every boot, and its id is the key's hash; every hello proves the id with the key. It is not in a room until a phone pairs it: it shows four letters, the phone types them, the wristband shows a number and the phone confirms it. Then the relay gives both a secret, and a paired wristband is only ever reached with it."

- [ ] **Step 4: Run to see them pass**

Run: `npm run build >/dev/null && node --test tests/wristband.test.js tests/server.test.js tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 5: Mutation checks (P1)**, file `tests/wristband.test.js`:
  - delete the line `if (b?.person && secret !== b.secret) { refuseBand(ws); return; }` ⇒ `a paired wristband's hello needs its secret…`
  - `const proven = HEX32.test(secret) && b?.secret === secret;` → `const proven = !!b;` ⇒ `a claim needs the secret`

- [ ] **Step 6: Full suite, commit**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add relay/server.js tests/wristband.test.js tests/server.test.js tests/firmware.test.js
git commit -m "Reach a paired wristband only with its pairing secret, and answer claims as claims"
```

Between this task and Task 9 a real wristband that drops its Wi-Fi is refused on its way back (its firmware has no secret yet). Do not flash the band until Task 9.

### Task 7: The relay — after a restart, the wristband waits for its owner

**Files:**
- Modify: `relay/server.js`, `relay/band.js`, `tests/wristband.test.js`, `tests/server.test.js`, `tests/band.test.js`

**Interfaces:**
- Consumes: Task 6's `claim` and `hello`.
- Produces: option `bandAloneMs = BAND_ALONE_MS`; `export const BAND_ALONE_MS = 60 * 60_000`; band records gain `waiting`, `waitingAt`, `quiet`; a `gone` map of forgotten ids; `holdOn(b)`; `forget(id, at)`; `bandShow({ …, waiting })` → `{ kind: 'waiting' }`; a no-view show is `{ kind: 'off', battery, away: true }`.
- Removes: `CLAIM_GRACE_MS` (a placeholder is kept for `BAND_ALONE_MS`).

- [ ] **Step 1: Write the failing tests** — append to `tests/wristband.test.js` (add `BAND_ALONE_MS` to its relay import and `import { randomBytes } from 'node:crypto';`):

```js
// ---------- §0: after a relay restart ----------

test('a restarted relay keeps a paired wristband waiting for its owner, and the claim pairs it', async () => {
  const secret = newKey();
  const band = await wristband(62, { secret });
  assert.deepEqual(band.show, { kind: 'waiting' }, 'no letters, no code to scan');
  const ana = await phone('restart-room');
  const ok = reply(ana, 'claim');
  ana.send({ t: 'pair', band: band.id, secret, again: true });
  assert.deepEqual(await ok, { t: 'claim', ok: true, band: band.id });
  await band.until((s) => s.kind === 'off' && !s.away);
  close(ana, band);
});

test('a hold while it waits, or in the hello, is applied at the claim', async () => {
  for (const how of ['hold', 'hello']) {
    const secret = newKey();
    const band = await wristband(62, { secret, quiet: how === 'hello' });
    if (how === 'hold') band.send({ t: 'hold' });
    await pause(50);
    const ana = await phone('restart-quiet-' + how);
    ana.send({ t: 'pair', band: band.id, secret });
    await ana.until((v) => v.me.invisible);
    close(ana, band);
  }
});

test('nobody claims it for BAND_ALONE_MS: it shows fresh letters', async () => {
  const band = await wristband(62, { secret: newKey() });
  relay.expire(Date.now() + BAND_ALONE_MS - 60_000);
  await pause(50);
  assert.equal(band.show.kind, 'waiting', 'not yet');
  relay.expire(Date.now() + BAND_ALONE_MS + 1_000);
  await band.until((s) => s.kind === 'pairing');
  close(band);
});

test('the phone back first: a placeholder is kept, and the wristband\'s secret decides', async () => {
  const key = newKey();
  const secret = newKey();
  const ana = await phone('first-room');
  const waiting = reply(ana, 'claim');
  ana.send({ t: 'pair', band: bandIdOf(key), secret, again: true });
  assert.deepEqual(await waiting, { t: 'claim', ok: false, why: 'waiting' });
  const band = await wristband(62, { key, secret });
  assert.equal(band.show.kind, 'off', 'the same secret: paired');
  await ana.until((v) => v.me.wristband?.live);

  const key2 = newKey();
  const ben = await phone('first-room');
  ben.send({ t: 'pair', band: bandIdOf(key2), secret: newKey() });
  await ben.until((v) => v.me.wristband?.live === false);
  const told = reply(ben, 'claim');
  const other = await wristband(62, { key: key2, secret: newKey() });
  assert.deepEqual(await told, { t: 'claim', ok: false, why: 'gone' }, 'a different secret: its claimer is told');
  assert.equal(other.show.kind, 'waiting', 'and the wristband waits for its own owner');
  close(ana, ben, band, other);
});

test('one placeholder per person', async () => {
  const ana = await phone('one-room');
  const count = relay.bandCount();
  for (let i = 0; i < 3; i += 1) {
    const w = reply(ana, 'claim');
    ana.send({ t: 'pair', band: randomBytes(16).toString('hex'), secret: newKey() });
    await w;
  }
  assert.equal(relay.bandCount(), count + 1);
  close(ana);
});

test('a paired wristband away for BAND_ALONE_MS is forgotten, and the next claim is told gone', async () => {
  const band = await wristband();
  const ana = await phone('away-room');
  const { band: id, secret } = await pairBand(ana, band);
  band.ws.close();
  await ana.until((v) => v.me.wristband?.live === false);
  relay.expire(Date.now() + BAND_ALONE_MS + 1_000);
  const told = reply(ana, 'claim');
  ana.send({ t: 'pair', band: id, secret, again: true });
  assert.deepEqual(await told, { t: 'claim', ok: false, why: 'gone' });
  close(ana);
});
```

In `tests/band.test.js` add:

```js
test('waiting for its owner, and a person not in a room, are shows of their own', () => {
  assert.deepEqual(bandShow({ view: null, waiting: true, now: T }), { kind: 'waiting' });
  assert.deepEqual(bandShow({ view: null, battery: 40, now: T }), { kind: 'off', battery: 40, away: true });
  assert.equal(bandShow({ view: null, code: 'KXRT', waiting: true, now: T }).kind, 'pairing', 'letters come first');
});
```

In `tests/server.test.js`, `id-claims with no wristband behind them are swept…`: import `BAND_ALONE_MS` and make the sweep `relay.expire(Date.now() + BAND_ALONE_MS + 1_000);   // a placeholder is kept for the hour`.

- [ ] **Step 2: Run to see them fail**

Run: `npm run build >/dev/null && node --test tests/wristband.test.js tests/band.test.js tests/server.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: the six new relay tests and the band test fail (`BAND_ALONE_MS` is not exported; there is no waiting show).

- [ ] **Step 3: `bandShow` learns waiting and away.** In `relay/band.js`: document `@param {boolean} p.waiting     after a relay restart, until its owner's phone claims it`; add `waiting = false` to the parameters; after the `code` line add `if (waiting) return { kind: 'waiting' };`; and make the no-view line `if (!view) return { kind: 'off', battery, away: true };`.

- [ ] **Step 4: Implement in `relay/server.js`.**
  1. Export `export const BAND_ALONE_MS = 60 * 60_000;     // a wristband alone holds its person, or waits for its owner, this long` beside `PAIR_CHECK_MS`; delete `CLAIM_GRACE_MS`; add `bandAloneMs = BAND_ALONE_MS` to `createRelay`'s options (document it in the JSDoc).
  2. `makeBand` gains, after `pending: null,`:
     ```js
         waiting: false,     // after a relay restart: said hello with a secret, and waits for its owner
         waitingAt: 0,
         quiet: false,       // a hold with nobody in a room to hide, kept until they are
     ```
  3. Beside `codes`: `const gone = new Map();    // id -> when: paired records and placeholders forgotten tonight`, and after `dropPending`:
     ```js
       function forget(id, at) {
         gone.set(id, at);
         if (gone.size > maxBands) gone.delete(gone.keys().next().value);
       }

       /** NOT NOW from the wrist. With nobody in a room to hide, it is kept until they are. */
       function holdOn(b) {
         const room = b.key ? rooms.get(b.key)?.room : null;
         if (b.person && room?.has(b.person)) room.setInvisible(b.person, true);
         else if (b.waiting) b.quiet = true;
       }
     ```
  4. `freshLetters` also clears `waiting: false, quiet: false` in its `Object.assign`.
  5. `showBand` passes `waiting: b.waiting` to `bandShow`.
  6. In `hello()`, replace the Task 6 secret line and everything down to `bands.set(id, b); }` with:
     ```js
         // A paired record is only reached with its secret. The live socket is left alone.
         if (b?.person && b.everWs && secret !== b.secret) { refuseBand(ws); return; }
         if (b?.person && !b.everWs && secret !== b.secret) {
           // A phone was back first and holds a placeholder, but not with this wristband's secret.
           const r = rooms.get(b.key);
           if (r) toPerson(r, b.person, { t: 'claim', ok: false, why: 'gone' });
           bands.delete(id);
           b = null;
           if (r) push(r);
         }
         if (!b) {
           if (bands.size >= maxBands && !evictBand(now())) { ws.send(JSON.stringify({ t: 'error', why: 'too many wristbands' })); return; }
           b = makeBand(id, ws);
           b.old = !v2;
           // A secret the relay does not know: it restarted, and this wristband waits for its owner.
           if (secret) Object.assign(b, { waiting: true, secret, waitingAt: now() });
           bands.set(id, b);
         }
     ```
     and replace its tail (from `if (!b.person && !b.code) unpairBand(b);` to the end of the function) with:
     ```js
         if (m.battery !== undefined) b.battery = clampBattery(m.battery);
         if (!b.person && !b.code && !b.pending && !b.waiting) freshLetters(b);
         if (m.quiet === true) holdOn(b);
         const r = b.key ? rooms.get(b.key) : null;
         if (r) push(r); else showBand(b);
     ```
     with `const clampBattery = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));` beside `bandOf`, and `handleBand`'s battery line using it.
  7. `handleBand`: `// Held: NOT NOW, from the wrist. The phone follows.` then `if (m.t === 'hold') holdOn(b);`.
  8. `claim()`: after the "its own" branch, add the owner of a waiting wristband, and remember forgotten ids and one placeholder per person:
     ```js
         if (proven && b.waiting) {
           // After a relay restart the wristband was back first, and this is its owner.
           const old = bandOf(r.key, me);
           if (old) unpairBand(old);
           Object.assign(b, { waiting: false, key: r.key, person: me });
           if (b.quiet) r.room.setInvisible(me, true);
           b.quiet = false;
           answer({ ok: true, band: id });
           return;
         }
     ```
     the `gone` line becomes `if (b || gone.has(id) || !HEX32.test(id) || !HEX32.test(secret)) { answer({ ok: false, why: 'gone' }); return; }`, and before the size check:
     ```js
         // The phone is back before its wristband: a placeholder with that secret, one per person.
         for (const p of [...bands.values()]) if (!p.everWs && p.key === r.key && p.person === me) bands.delete(p.id);
     ```
     A claim that pairs changes the room, so the `pair` case's `break` falls through to `push(r)` as every case does.
  9. `expire(at)`: replace the band loop with
     ```js
         for (const b of [...bands.values()]) {
           // Nobody came for a wristband waiting after a restart: it is new to the relay again.
           if (b.waiting && at - b.waitingAt >= bandAloneMs) { freshLetters(b); showBand(b, at); continue; }
           if (b.ws) continue;
           const idle = at - (b.goneAt || b.claimedAt || at);
           const dead = b.person ? idle >= bandAloneMs : idle >= BAND_GRACE_MS;
           if (!dead) continue;
           if (b.person) forget(b.id, at);   // a paired wristband away for the hour, or a placeholder nobody answered
           codes.delete(b.code);
           bands.delete(b.id);
         }
     ```

- [ ] **Step 5: Run to see them pass**

Run: `npm run build >/dev/null && node --test tests/wristband.test.js tests/band.test.js tests/server.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 6: Mutation checks (P1)**, file `tests/wristband.test.js`:
  - delete `if (b.quiet) r.room.setInvisible(me, true);` ⇒ `a hold while it waits, or in the hello, is applied at the claim`
  - delete the `if (b.waiting && at - b.waitingAt >= bandAloneMs) { … continue; }` line ⇒ `nobody claims it for BAND_ALONE_MS: it shows fresh letters`
  - delete `if (r) toPerson(r, b.person, { t: 'claim', ok: false, why: 'gone' });` ⇒ `the phone back first…`
  - delete the `for (const p of [...bands.values()]) if (!p.everWs …) bands.delete(p.id);` line ⇒ `one placeholder per person`
  - delete `if (b.person) forget(b.id, at);` ⇒ `a paired wristband away for BAND_ALONE_MS is forgotten…`

- [ ] **Step 7: Full suite, commit**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add relay/server.js relay/band.js tests/wristband.test.js tests/band.test.js tests/server.test.js
git commit -m "After a relay restart, keep a paired wristband waiting for its owner; forget one away for the hour"
```

### Task 8: The phone — the check sheet, the secret, and claims

**Files:**
- Modify: `app/lib/pairing.js`, `tests/pairing.test.js`, `app/App.jsx`, `app/screens/Band.jsx` (`Pair`, `bandLine`), `app/screens/Home.jsx` (the band chip)

**Interfaces:**
- Consumes: relay → phone `view.me.check`, `{t:'paired', band, secret}`, `{t:'check', ok:false, why:'timeout'}`, `{t:'claim', ok, band?, why?}`, errors `busy`, `old firmware`, `no such wristband`, `too many tries`.
- Produces: `PAIR_SAY` in `app/lib/pairing.js` (every relay answer the phone words, by name); night state `wristband` (id) and `bandSecret`; the phone's claim `{t:'pair', band, secret}`; `{t:'confirm', yes}`; `band.offline` (away two minutes) on the chip, with `PAIR AGAIN` in the wristband sheet.
- Removes: the `/pair/` link's one-tap confirm (`pairConfirm`, `Pair`'s `confirm` prop).

- [ ] **Step 1: Write the failing test** — `tests/pairing.test.js`, add `PAIR_SAY` to the import and:

```js
test('every answer the relay gives a pairing phone has words, and the check asks about the number', () => {
  for (const k of ['no', 'timeout', 'busy', 'old firmware', 'no such wristband', 'too many tries', 'gone', 'paired']) {
    assert.equal(typeof PAIR_SAY[k], 'string', k);
  }
  assert.equal(PAIR_SAY.check(27), 'Does your wristband show 27?');
  assert.equal(PAIR_SAY.timeout, 'No answer in time. Try again.');
  assert.equal(PAIR_SAY.busy, 'Someone is pairing that wristband right now. Try again in a minute.');
  assert.equal(PAIR_SAY.gone, 'Your wristband restarted or went away. Pair it again.');
  assert.equal(PAIR_SAY['old firmware'], 'Update this wristband’s firmware.');
  assert.equal(PAIR_SAY.no, 'That’s not this wristband.');
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/pairing.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: fails (`PAIR_SAY` is not exported).

- [ ] **Step 3: Add the words** to `app/lib/pairing.js`, and update its header comment ("…the app pairs once it is in a room" becomes "…every way in ends with the same check: the wristband that was reached shows a number, and the phone asks whether it is the one on this wrist"):

```js
/** What the phone says for each answer the relay gives while pairing (spec §0). */
export const PAIR_SAY = {
  check: (n) => 'Does your wristband show ' + n + '?',
  checkSub: 'Only say yes if it’s on the wristband you’re holding.',
  paired: 'Paired. It’s your light tonight.',
  no: 'That’s not this wristband.',
  timeout: 'No answer in time. Try again.',
  busy: 'Someone is pairing that wristband right now. Try again in a minute.',
  'old firmware': 'Update this wristband’s firmware.',
  'no such wristband': 'That’s not a wristband here. Check the letters.',
  'too many tries': 'Too many tries. Wait a moment, then scan it instead.',
  gone: 'Your wristband restarted or went away. Pair it again.',
};
```

Run: `node --test tests/pairing.test.js 2>&1 | grep -E "^ℹ (pass|fail)"` — Expected: `ℹ fail 0`.

- [ ] **Step 4: The check sheet, and the answers, in `app/App.jsx`.**
  1. Import `PAIR_SAY` beside `codeFrom`. Delete the `pairConfirm` state and its comment, and the `linked` effect's `setPairConfirm(linked)` becomes `setPairCode(linked)`; the effect's comment becomes: "A code from the address lands on the pair screen pre-filled. It pairs nothing on its own: like typed or scanned letters, it only starts the check, and the person must see the number on their own wrist and say yes."
  2. After `const paired = !!band;`:
     ```jsx
       // A pairing waiting for YES (§0). It belongs to the person, so every view carries it until it is answered.
       const check = view.me?.check ?? null;
       // Away for two minutes, the chip says so and offers to pair again.
       const [bandAwaySince, setBandAwaySince] = useState(null);
       useEffect(() => {
         if (!band || band.live) setBandAwaySince(null);
         else setBandAwaySince((t) => t ?? Date.now());
       }, [band?.live, !!band]);
       const bandShown = band ? { ...band, offline: !band.live && bandAwaySince !== null && now - bandAwaySince >= 120_000 } : null;
     ```
     and pass `band={bandShown}` to `Home`, and `bandLine(bandShown)` in `bandSheet`.
  3. On load the claim is kept, never queued: replace `if (night.state?.wristband) n.say('pair', …)` with
     ```jsx
         if (night.state?.wristband) n.keep('pair', { t: 'pair', band: night.state.wristband, secret: night.state.bandSecret || '' });
     ```
  4. Replace `onRelay.current`'s pairing branches (from `if (m.t === 'paired')` to the end of the `too many tries` branch) with:
     ```jsx
         const pairFailed = (words) => {
           setPairPending(false);
           setPairCode(null);
           if (screen === 'pair') setPairError(words); else say(words);
         };
         if (m.t === 'paired') {
           setPairPending(false);
           setPairCode(null);
           setNightState({ wristband: m.band, bandSecret: m.secret });
           // Kept, not said: re-said as a claim only after a reconnect.
           net.current?.keep('pair', { t: 'pair', band: m.band, secret: m.secret });
           setPairError(null);
           say(PAIR_SAY.paired);
           if (screen === 'pair') { setStack([]); setScreen('home'); }
         }
         if (m.t === 'check' && m.ok === false) pairFailed(PAIR_SAY.timeout);
         if (m.t === 'error' && PAIR_SAY[m.why] && m.why !== 'gone') pairFailed(PAIR_SAY[m.why]);
         // The only way this phone decides its wristband is gone: the relay says so to its claim.
         if (m.t === 'claim' && m.ok === false && m.why === 'gone' && bandId) {
           net.current?.forget('pair');
           setNightState({ wristband: null, bandSecret: null });
           say(PAIR_SAY.gone);
         }
     ```
  5. The answer to the check, beside `pairWith`:
     ```jsx
       const answerCheck = useCallback((yes) => {
         net.current?.send({ t: 'confirm', yes });
         if (!yes) {
           setPairPending(false);
           setPairCode(null);
           if (screen === 'pair') setPairError(PAIR_SAY.no); else say(PAIR_SAY.no);
         }
       }, [screen, say]);
     ```
  6. `unpair` also clears the secret: `setNightState({ wristband: null, bandSecret: null });` (and so does `leftVenue`'s night reset, which already empties `state`).
  7. The wristband sheet gains PAIR AGAIN while the band is offline, as its first row:
     ```jsx
           ...(bandShown?.offline ? [{ icon: 'link', label: 'PAIR AGAIN', sub: 'it has been away a while. show its letters and pair it again.', fg: '#fff',
             onTap: () => { unpair(); go('pair'); } }] : []),
     ```
  8. The sheet on screen is the check while there is one, over any screen:
     ```jsx
       const checkSheet = check ? {
         title: PAIR_SAY.check(check), sub: PAIR_SAY.checkSub, close: 'NO',
         rows: [
           { icon: 'check_circle', label: 'YES', sub: 'my wristband shows ' + check + '.', fg: 'var(--ok)', onTap: () => answerCheck(true) },
           { icon: 'cancel', label: 'NO', sub: 'it shows something else, or nothing.', fg: 'var(--stop)', onTap: () => answerCheck(false) },
         ],
       } : null;
     ```
     and the render line becomes
     ```jsx
           {checkSheet || sheet ? <Sheet sheet={checkSheet || sheet} onClose={checkSheet ? () => answerCheck(false) : closeSheet} screenRef={stageRef} /> : null}
     ```
  9. The `pair` screen: `<Pair error={pairError} initial={pairCode} pending={pairPending} onCode={(code) => { dropLink(); pairWith(code); }} onScan={() => go('scan')} onSkip={() => { dropLink(); setStack([]); setScreen('home'); }} onBack={stack.length ? back : null} />`.

- [ ] **Step 5: `Pair`, `bandLine` and the chip.** In `app/screens/Band.jsx`, `Pair` loses its `confirm` prop, its confirm heading and body, its `PAIR THIS WRISTBAND` button and the confirm note; the body text becomes `'Press its face button. Scan what it shows, or type the four letters. It will show a number to check.'`, and the pending note `'check your wrist…'`. `bandLine`:

```jsx
export const bandLine = (band) => (band
  ? (band.offline ? 'OFFLINE — away for a while' : [band.battery != null ? band.battery + '% battery' : null, band.live ? null : 'not connected right now'].filter(Boolean).join(' · '))
  : '');
```

In `app/screens/Home.jsx`, the chip shows `OFFLINE` instead of the battery when `band.offline`:

```jsx
            {band ? <><Icon name="watch" size={18} color={band.live ? '#fff' : 'var(--text-3)'} />
              {band.offline ? <span className="tnum" style={{ color: 'var(--warn)' }}>OFFLINE</span>
                : band.battery != null ? <span className="tnum">{band.battery}%</span> : null}</>
```

- [ ] **Step 6: Build and check in a browser.** `npm start` (Bash, `run_in_background`), then open `http://localhost:8790/band` in one tab and the app (seeded as in `CLAUDE.md`'s "Verifying the phone in a browser") in another. The stand-in still has one button and no secret (Task 9), which is enough here:
  - type its letters: the sheet asks *Does your wristband show NN?* and the stand-in shows NN; YES → toast *Paired…*, the chip shows its battery.
  - pair again and press NO → *That's not this wristband.*, the stand-in shows new letters.
  - `ZZZZ` → *That's not a wristband here. Check the letters.*
  Stop the relay by its port afterwards (`Get-NetTCPConnection -LocalPort 8790` → `Stop-Process`).

- [ ] **Step 7: Full suite, commit**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add app/lib/pairing.js tests/pairing.test.js app/App.jsx app/screens/Band.jsx app/screens/Home.jsx
git commit -m "Ask on the phone whether the wrist shows the check number; keep the pairing secret with the night"
```

### Task 9: Both wrists keep the secret, and show the check, waiting and away

**Files:**
- Modify: `firmware/src/band_logic.h` (`Show.away`, `Frame.secret`, `readFrame`, `wordsFor`, `lightFor`)
- Modify: `firmware/host/logic_test.cpp` (`frames()`, `face()`, the `show` verb)
- Modify: `firmware/src/main.cpp` (the secret; the hello sent by the loop; `Out.text[256]`)
- Modify: `app/screens/Band.jsx` (the stand-in keeps its secret; `BandFace` draws check, waiting, NOT NOW and away)
- Modify: `tests/firmware.test.js`

**Interfaces:**
- Consumes: relay → band `{t:'paired', secret}`, shows `check`, `waiting`, `off`+`away`.
- Produces (C++): `Show::away`; `Frame::secret`; `wordsFor`: check → `{big, "ON YOUR PHONE?"}` (Task 5), waiting → `{"OPEN YOUR PHONE", "OR SWITCH ME OFF"}`, awake and off → NO SIGNAL (offline) / `{"NOT NOW", pct}` (quiet) / `{"OPEN YOUR PHONE", "TO COME BACK"}` (away) / `{"READY", pct}`; `lightFor`: waiting → `LIGHT_AWAKE` always.
- Produces (host): the `show` verb's JSON gains `"away"`.

- [ ] **Step 1: Write the failing C++ checks** — in `logic_test.cpp`, `frames()`:

```cpp
  Frame p;
  CHECK(readFrame("{\"t\":\"paired\",\"secret\":\"00112233445566778899aabbccddeeff\"}", p) && p.t == "paired" &&
        p.secret == "00112233445566778899aabbccddeeff" && !p.hasShow);
  Frame a;
  CHECK(readFrame("{\"t\":\"show\",\"show\":{\"kind\":\"off\",\"battery\":40,\"away\":true}}", a) && a.show.away);
```

and `face()`:

```cpp
  Show waiting;
  waiting.kind = "waiting";
  f = faceFor(&waiting, false, false);
  w = wordsFor(f, false, 62, Signal::LIVE);
  CHECK(w.big == "OPEN YOUR PHONE" && w.small == "OR SWITCH ME OFF" && lightFor(f, false) == LIGHT_AWAKE);
  Show away;
  away.away = true;
  f = faceFor(&away, false, false);
  CHECK(wordsFor(f, false, 62, Signal::LIVE).big.empty() && lightFor(f, false) == LIGHT_OFF);
  w = wordsFor(f, true, 62, Signal::LIVE);
  CHECK(w.big == "OPEN YOUR PHONE" && w.small == "TO COME BACK" && lightFor(f, true) == LIGHT_AWAKE);
  Show dark;
  dark.quiet = true;
  f = faceFor(&dark, false, false);
  w = wordsFor(f, true, 62, Signal::LIVE);
  CHECK(w.big == "NOT NOW" && w.small == "62%");
```

and one existing check in `face()` changes on purpose — a press under NOT NOW from the wrist now says so: `CHECK(wordsFor(f, true, 62, Signal::LIVE).big == "READY");` (just after `f = faceFor(&song, false, true);`) becomes `… .big == "NOT NOW");`.

In `tests/firmware.test.js` (the round trip): the `got` expectation gains `away: !!s.away,` after `quiet`; add `if (s.kind === 'waiting') assert.deepEqual(words, { big: 'OPEN YOUR PHONE', small: 'OR SWITCH ME OFF' }, text);`; and before the "Every frame the relay sent" block, a wristband the relay does not know comes back with a secret:

```js
    // A wristband with a secret this relay never gave, as after a relay restart: it waits for its owner.
    const [key2] = speak(['key']);
    const [lost] = speak(['hello ' + key2 + ' 62 ' + randomBytes(16).toString('hex')]);
    const waits = await open(relay.port, 'arduino');
    socks.push(waits);
    waits.send(lost);
    await waits.until('show', (m) => m.show.kind === 'waiting');
```

then read `const frames = [...band.frames, ...waits.frames];` and use `frames` in place of `band.frames` in the read-back (`speak(frames.map(…))`, `frames.forEach(…)`), and make the kinds list `['check', 'dance', 'hi', 'meet', 'off', 'pairing', 'song', 'test', 'waiting']`.

- [ ] **Step 2: Run to see them fail**

Run: `npm run build >/dev/null && node --test tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: the host build fails (`Frame` has no `secret`, `Show` no `away`).

- [ ] **Step 3: Implement in `band_logic.h`.**
  1. `Show`: `std::string kind = "off";  // pairing | check | waiting | test | hi | song | dance | meet | off`; add `bool away = false;  // paired, but its person is not in a room`; `operator==` compares `away` too.
  2. `Frame`: add `std::string secret;  // {t:'paired'}: the pairing's secret, kept in RAM only`.
  3. `readFrame`: at the top level `if (key == "secret") return text_(f.secret, 32);`; inside the show `if (k == "away") return flag(s.away);`.
  4. `wordsFor`:
     ```cpp
     inline Words wordsFor(const Face& f, bool awake, int battery, Signal signal) {
       const Show& s = f.show;
       const std::string pct = battery >= 0 ? std::to_string(battery) + "%" : "";
       if (s.kind == "pairing") return {s.code, ""};
       if (s.kind == "check") return {s.big, "ON YOUR PHONE?"};
       if (s.kind == "waiting") return {"OPEN YOUR PHONE", "OR SWITCH ME OFF"};
       if (lit(s)) return {fold(s.big), upper(fold(s.small))};
       if (s.kind != "off" || !awake) return {};
       if (f.offline) {
         const std::string why = signal == Signal::NO_WIFI ? "NO WI-FI" : "NO RELAY";
         return {"NO SIGNAL", pct.empty() ? why : why + " - " + pct};
       }
       if (s.quiet) return {"NOT NOW", pct};
       if (s.away) return {"OPEN YOUR PHONE", "TO COME BACK"};
       return {"READY", pct};
     }
     ```
  5. `lightFor`: the last line becomes `return s.kind == "waiting" || awake ? LIGHT_AWAKE : LIGHT_OFF;`.

  And in `logic_test.cpp`'s `show` verb, after the `quiet` field: `",\"away\":" + (s.away ? "true" : "false") +`.

- [ ] **Step 4: Run to see them pass**

Run: `npm run build >/dev/null && node --test tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 5: `main.cpp` keeps the secret and sends the hello from the loop.** The hello now depends on the secret and on a hold still waiting, which live on the loop, so the loop sends it:
  1. `std::string bandKey, bandId, secret, ssid, pass, relayText;` — `secret` with the comment `// given on YES; RAM only, so a reboot is a new wristband`.
  2. `Out::text` becomes `char text[256];  // a hello with its key, secret and quiet is about 190 bytes`.
  3. `onSocket`'s `WStype_CONNECTED` becomes:
     ```cpp
         case WStype_CONNECTED:
           // Nothing queued for the last socket goes to this one. The loop sends the hello first.
           xQueueReset(outbox);
           post(EV_OPENED);
           break;
     ```
  4. A small send queue on the loop, so a frame the outbox could not take is sent next time round, in order:
     ```cpp
     std::vector<std::string> waitingOut;  // frames the outbox could not take yet, oldest first

     void sendFrame(const std::string& text) {
       waitingOut.push_back(text);
       while (!waitingOut.empty() && toSocket(OUT_SEND, waitingOut.front())) waitingOut.erase(waitingOut.begin());
     }
     ```
  5. In `drain()`, `EV_OPENED`:
     ```cpp
           case EV_OPENED: {
             // Back after long enough that what it said was no longer shown: wait for it to say it again.
             if (net.stale(now)) haveShow = false;
             net.opened(now);
             waitingOut.clear();
             // A hold not yet heard rides on the hello: the relay applies it before anything else.
             const bool holding = quiet.due(true);
             sendFrame(helloFrame(bandId, bandKey, battery, secret, holding));
             if (holding) quiet.sent(now);
             batteryReport.reset();
             if (battery >= 0) batteryReport.sent(battery, now);
             Serial.printf("on the relay: %s\n", relay.origin.c_str());
             break;
           }
     ```
     `EV_CLOSED` adds `waitingOut.clear();`. `EV_TEXT` keeps the secret and forgets it with fresh letters:
     ```cpp
             if (f.t == "paired" && !f.secret.empty()) {
               secret = f.secret;
             } else if (f.t == "show" && f.hasShow) {
               last = f.show;
               haveShow = true;
               quiet.shown(last);
               if (last.kind == "pairing") secret.clear();  // unpaired, or nobody came for it: a new pairing
             } else if (f.t == "error") { …as before… }
     ```
  6. Every other `toSocket(OUT_SEND, …)` in `loop()` becomes `sendFrame(…)` (the ping, the hold, the battery report); `if (quiet.due(net.up())) { sendFrame(HOLD_FRAME); quiet.sent(now); }`.
  7. The socket task no longer reads the battery: delete `batteryNow` and its store in `readBattery()`, `Event::battery`, and `post()`'s `level` parameter (only the old `CONNECTED` case passed one).
  8. `draw()`'s key adds the away and quiet flags: `… + '|' + (f.show.away ? "a" : "") + (f.show.quiet ? "q" : "") + '|' + …`, and `paint()` draws the check's number like the meeting number: `else if (s.kind == "check") drawMeet(w, WHITE, k);` before the `!w.big.empty()` line. (`drawMeet` draws `w.small` above a large `w.big`; for the check that reads *ON YOUR PHONE?* over *27*.)

- [ ] **Step 6: Both firmware envs build**

Run (PowerShell): `& C:\Users\LewisDong\.platformio\penv\Scripts\pio.exe run -d firmware -e m5stickc -e m5sticks3 2>&1 | Select-String "SUCCESS|FAILED|error:"`
Expected: two `[SUCCESS]`.

- [ ] **Step 7: The stand-in keeps its secret too.** In `app/screens/Band.jsx`, `BandStandIn`:

```jsx
  const secret = useRef('');   // given on YES; this page only, as the firmware keeps it in RAM
  const quietWaiting = useRef(false);
```

`sock.onopen` sends `{ t: 'wristband', id: band.id, key: band.key, v: 2, battery: batteryNow.current, ...(secret.current ? { secret: secret.current } : {}) }`; `sock.onmessage`:

```jsx
      sock.onmessage = (e) => {
        heard = Date.now();
        const m = JSON.parse(e.data);
        if (m.t === 'paired' && m.secret) secret.current = m.secret;
        if (m.t === 'show') { if (m.show.kind === 'pairing') secret.current = ''; setShow(m.show); }
      };
```

and `BandFace` draws the new shows (Task 22 replaces this with the Wrist's own face):

```jsx
      {s.kind === 'check' ? (
        <span className="words meet"><span className="small-w">ON YOUR PHONE?</span><span className="num">{s.big}</span></span>
      ) : null}
      {s.kind === 'waiting' ? (
        <span className="words ready"><span className="big">OPEN YOUR PHONE</span><span className="small-w">OR SWITCH ME OFF</span></span>
      ) : null}
      {s.kind === 'off' && awake ? (
        <span className="words ready">
          <span className="big">{s.quiet ? 'NOT NOW' : s.away ? 'OPEN YOUR PHONE' : 'READY'}</span>
          {s.away ? <span className="small-w">TO COME BACK</span>
            : battery !== null && battery !== undefined ? <span className="small-w">{battery}%</span> : null}
        </span>
      ) : null}
```

(replacing the old `s.kind === 'off' && awake` block), with `faceLabel` gaining `if (s.kind === 'check') return 'Wristband showing check number ' + s.big;` and `if (s.kind === 'waiting') return 'Wristband waiting: open your phone, or switch it off';`.

- [ ] **Step 8: Browser check.** `npm start` in the background; the app and `/band` side by side:
  - pair through the check (YES): the stand-in flashes, then shows the card the phone arms.
  - stop the relay and start it again (the phone tab closed): the stand-in shows *OPEN YOUR PHONE / OR SWITCH ME OFF*; open the phone tab: the stand-in is paired again with no letters.
  - reload `/band`: it is a new wristband with new letters; the phone's next claim says *Your wristband restarted or went away. Pair it again.*
  Stop the relay by its port.

- [ ] **Step 9: Full suite, commit, close the stage (P2)**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add firmware/src/band_logic.h firmware/host/logic_test.cpp firmware/src/main.cpp app/screens/Band.jsx tests/firmware.test.js
git commit -m "Keep the pairing secret on both wrists, and show the check, waiting and away"
git push origin main
```

Then flash the band (Global Constraints; ask the owner to close his serial monitor first) and pair it once through the check, to prove the real hello is not cut short: the serial console must print `on the relay:` and no `the relay says: bad band`.


## Stage C — §2 The relay decides

### Task 10: rev, seq and by on every person; shows name armed and rev

**Files:**
- Modify: `relay/room.js`, `relay/band.js`, `relay/server.js` (`holdOn`, `claim`), `tests/room.test.js`, `tests/band.test.js`, `tests/wristband.test.js`

**Interfaces:**
- Produces (room): each person has `rev` (from one counter per room, so a person made again never reuses one), `seq` (0), `by` (`'relay'` when made); `arm(id, intent, by = 'phone')` and `setInvisible(id, on, by = 'phone')` move `rev` and set `by` only on a real change; `revOf(id)` → the rev, or `null`; `viewFor(id).me` gains `rev`, `seq`, `by`, `fresh` (`by === 'relay'`).
- Produces (band): a show made from a view carries `armed` (`null` for none) and `rev`; pairing, check, test, waiting and away shows carry neither.
- Produces (relay): a hold from the wrist, and a hold applied at a claim, are `by: 'band'`.

- [ ] **Step 1: Write the failing tests** — append to `tests/room.test.js`:

```js
// ---------- who changed it, and when (spec §2) ----------

test('every change to armed or invisible moves rev and says who made it; nothing else does', () => {
  const room = createRoom({ salt: 'test' });
  room.join('ana');
  const first = room.viewFor('ana').me;
  assert.deepEqual([first.seq, first.by, first.fresh], [0, 'relay', true], 'made by the relay, and fresh');
  room.arm('ana', 'hi', 'band');
  const armed = room.viewFor('ana').me;
  assert.ok(armed.rev > first.rev);
  assert.deepEqual([armed.by, armed.fresh], ['band', false]);
  room.arm('ana', 'hi', 'phone');
  assert.deepEqual([room.viewFor('ana').me.rev, room.viewFor('ana').me.by], [armed.rev, 'band'], 'no change: no new rev, and by stays');
  room.setProfile('ana', { name: 'Ana' });
  room.pick('ana', 'Treasure');
  assert.equal(room.viewFor('ana').me.rev, armed.rev, 'a name or a pick is not what a choice is made from');
  room.setInvisible('ana', true);
  const quiet = room.viewFor('ana').me;
  assert.deepEqual([quiet.rev > armed.rev, quiet.by, quiet.armed, quiet.invisible], [true, 'phone', null, true]);
  assert.equal(room.revOf('ana'), quiet.rev);
  assert.equal(room.revOf('nobody'), null);
});

test('a person made again never reuses a rev', () => {
  const room = createRoom({ salt: 'test' });
  room.join('ana');
  room.arm('ana', 'hi');
  const before = room.viewFor('ana').me.rev;
  room.leave('ana');
  room.join('ana');
  assert.ok(room.viewFor('ana').me.rev > before);
});
```

In `tests/band.test.js`, the first test's expected show gains the two fields — `{ kind: 'hi', intent: 'hi', big: 'HI :)', small: 'blue means hello', dim: false, armed: 'hi', rev: 0 }` — and add:

```js
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
```

In `tests/wristband.test.js`, `a hold while it waits, or in the hello, is applied at the claim` waits for `v.me.invisible && v.me.by === 'band'`.

- [ ] **Step 2: Run to see them fail**

Run: `npm run build >/dev/null && node --test tests/room.test.js tests/band.test.js tests/wristband.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: the two room tests, the two band tests and the hold-at-claim test fail.

- [ ] **Step 3: Implement in `relay/room.js`.**
  1. Beside `let nextMatch = 1;`: `let nextRev = 0;            // one counter for the room, so a person made again never reuses a rev`.
  2. In `join`, the new person gains `rev: ++nextRev, seq: 0, by: 'relay',`.
  3. After `leave`:
     ```js
       /** Every change to armed or invisible, from anywhere, moves rev; `by` says who. */
       function changed(p, armed, invisible, by) {
         if (armed === p.armed && invisible === p.invisible) return;
         p.armed = armed;
         p.invisible = invisible;
         p.rev = ++nextRev;
         p.by = by;
       }
     ```
  4. `arm` and `setInvisible`:
     ```js
       /** Arming one intent disarms the others: a card that arms is a switch, not a checkbox. */
       function arm(id, intent, by = 'phone') {
         const p = people.get(id);
         if (!p) return;
         const armed = INTENTS.includes(intent) ? intent : null;
         changed(p, armed, armed ? false : p.invisible, by);
       }

       /** NOT NOW. Disarms everything and stays off until the person turns it back on. */
       function setInvisible(id, on, by = 'phone') {
         const p = people.get(id);
         if (!p) return;
         changed(p, on ? null : p.armed, !!on, by);
       }
     ```
  5. `viewFor`'s `me` becomes
     ```js
           me: {
             armed: me.armed, invisible: me.invisible, pick: me.pick, band: me.band, name: me.name, clip: me.clip?.ref ?? null,
             rev: me.rev, seq: me.seq, by: me.by, fresh: me.by === 'relay',
           },
     ```
  6. The returned object gains `/** The rev a wristband's \`set\` must name (rule 1), or null for someone not here. */ revOf: (id) => people.get(id)?.rev ?? null,`.

- [ ] **Step 4: Implement in `relay/band.js`.** Extend the JSDoc: "A show made from the person's view carries `armed` (null for none) and the view's `rev`; that is how the wrist tells a show about its person from one that is not, and names the state a choice was made from. The others — pairing, the check, the test light, waiting, and not in a room — carry neither." Then, after `if (!view) …`: `const about = { armed: view.me.armed ?? null, rev: view.me.rev ?? 0 };`, and append `...about` to the quiet `off`, `meet`, `hi`, `song`, `dance` and default `off` returns.

- [ ] **Step 5: The wrist's holds are by the band.** In `relay/server.js`, `holdOn`: `room.setInvisible(b.person, true, 'band')`; in `claim`'s waiting branch: `if (b.quiet) r.room.setInvisible(me, true, 'band');`.

- [ ] **Step 6: Run to see them pass**

Run: `npm run build >/dev/null && node --test tests/room.test.js tests/band.test.js tests/wristband.test.js tests/server.test.js tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ fail 0` (the firmware round trip ignores the new show fields until Task 19).

- [ ] **Step 7: Mutation check (P1)**, file `tests/room.test.js`: delete `if (armed === p.armed && invisible === p.invisible) return;` ⇒ `every change to armed or invisible moves rev…`

- [ ] **Step 8: Full suite, commit**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add relay/room.js relay/band.js relay/server.js tests/room.test.js tests/band.test.js tests/wristband.test.js
git commit -m "Give every person rev, seq and by, and name armed and rev on the wrist's shows"
```

### Task 11: Rule 2 — one grace, the band-alone hour, 06:00

**Files:**
- Create: `relay/night.js`, `tests/rules.test.js`
- Modify: `relay/server.js`

**Interfaces:**
- Produces: `export const GRACE_MS = 120_000`; `createRelay({ …, graceMs = GRACE_MS, nightTz })` (`nightTz` an IANA name; the machine's own zone when absent; `NIGHT_TZ` in the environment for `node relay/server.js`); `nightOf(ms, tz)` → `'YYYY-MM-DD'` of `ms − 6 h` in `tz`; rooms gain `heard: Map(id → when a phone of theirs last spoke)`; `startGrace(r, me)`, `stopGrace(r, me)`, `leaveRoom(r, me)`.

- [ ] **Step 1: Write the failing tests** — `tests/rules.test.js`:

```js
// ON THE BEAT — the relay decides: who is in the room, and which re-said fact counts.
// One test per guard; each was mutation-checked (README, Abuse resistance).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createRelay, WS_PATH, BAND_ALONE_MS } from '../relay/server.js';
import { helpers, newKey, pause } from './relay-harness.js';

const dir = mkdtempSync(join(tmpdir(), 'otb-rules-'));
const relays = [];
let current = null;
const { phone, wristband, reply, pairBand, close, cleanup } = helpers(() => current.port);

/** A relay of the test's own, so its grace and its clock are the test's. */
async function relayWith(options = {}) {
  current = await createRelay({ port: 0, host: '127.0.0.1', root: dir, ...options });
  relays.push(current);
  return current;
}
after(async () => {
  cleanup();
  for (const r of relays) await r.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Someone in a room with a wristband paired, and a second phone that sees them. */
async function pairedWithWatcher(venue) {
  const band = await wristband();
  const ana = await phone(venue);
  const ben = await phone(venue);
  const { secret } = await pairBand(ana, band);
  ana.send({ t: 'arm', intent: 'hi' });
  await ben.until((v) => v.near.length === 1);
  return { band, ana, ben, secret };
}

// ---------- rule 2: the grace, the band-alone hour, 06:00 ----------

test('a live wristband holds its person: no grace when their phone drops', async () => {
  await relayWith({ graceMs: 100 });
  const { band, ana, ben } = await pairedWithWatcher('hold-room');
  ana.ws.close();
  await pause(400);
  assert.equal(ben.view.near.length, 1, 'still in the room, past the grace');
  close(ben, band);
});

test('a wristband that closes with no phone open starts the grace, and they leave when it runs out', async () => {
  await relayWith({ graceMs: 150 });
  const { band, ana, ben } = await pairedWithWatcher('band-grace');
  ana.ws.close();
  await pause(100);
  band.ws.close();
  await pause(60);
  assert.equal(ben.view.near.length, 1, 'not yet');
  await ben.until((v) => v.near.length === 0, 1000);
  close(ben);
});

test('a wristband coming back stops the grace', async () => {
  await relayWith({ graceMs: 200 });
  const { band, ana, ben, secret } = await pairedWithWatcher('band-back');
  band.ws.close();
  await pause(50);
  ana.ws.close();                          // no phone, no wristband: the grace starts
  await pause(50);
  const back = await wristband(62, { key: band.key, secret });
  await pause(400);
  assert.equal(ben.view.near.length, 1, 'the wristband came back in time');
  close(ben, back);
});

test('one grace timer per person: phone drops, band drops twice, and close() leaves none', async () => {
  const timers = () => process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length;
  await pause(300);   // the graces the tests before this one left running have all run out
  const before = timers();
  const relay = await relayWith({ graceMs: 400 });
  const { band, ana, ben, secret } = await pairedWithWatcher('one-timer');
  band.ws.close();                          // their phone is open: no grace
  await pause(30);
  ana.ws.close();                           // and now no wristband either: a grace
  await pause(200);
  const back = await wristband(62, { key: band.key, secret });   // the wristband stops it
  back.ws.close();                          // and drops again: a new grace, from now
  await pause(300);                         // the first would have run out by now
  assert.equal(ben.view.near.length, 1, 'only the newest grace counts');
  await ben.until((v) => v.near.length === 0, 1500);
  const cai = await phone('one-timer');
  cai.ws.close();                           // a grace still running when the relay closes
  const dan = await phone('one-timer');
  const worn = await wristband();
  await pairBand(dan, worn);
  dan.ws.close();                           // held by a live wristband when the relay closes
  await pause(50);
  close(ben);
  await relay.close();
  await pause(50);
  assert.ok(timers() <= before, 'close() left a timer behind');
});

test('held only by a wristband, a person leaves BAND_ALONE_MS after a phone of theirs was last heard', async () => {
  let t = Date.now();
  const relay = await relayWith({ clock: () => t });
  const { ana, ben } = await pairedWithWatcher('alone-hour');
  ana.send({ t: 'ping' });
  await pause(50);
  ana.ws.close();
  await pause(50);
  relay.expire(t + BAND_ALONE_MS - 60_000);
  await pause(50);
  assert.equal(ben.view.near.length, 1, 'not yet');
  t += BAND_ALONE_MS;
  ben.send({ t: 'ping' });   // ben is heard now; ana was not
  relay.expire(t + 1_000);
  await ben.until((v) => v.near.length === 0);
  close(ben);
});

test("held only by a wristband, a person leaves at 06:00 on the relay's clock", async () => {
  let t = new Date(2026, 8, 25, 5, 45).getTime();
  const relay = await relayWith({ clock: () => t });
  const { ana, ben } = await pairedWithWatcher('six-local');
  ana.ws.close();
  await pause(50);
  relay.expire(new Date(2026, 8, 25, 5, 59).getTime());
  await pause(50);
  assert.equal(ben.view.near.length, 1, 'not before six');
  t = new Date(2026, 8, 25, 6, 1).getTime();
  ben.send({ t: 'ping' });
  relay.expire(t);
  await ben.until((v) => v.near.length === 0);
  close(ben);
});

test('06:00 is in nightTz, the venue\'s time zone', async () => {
  // 19:45 UTC is 05:45 in Brisbane; 20:35 UTC is 06:35 there. Fifty minutes, not the hour.
  let t = Date.UTC(2026, 8, 24, 19, 45);
  for (const [tz, leaves] of [['Australia/Brisbane', true], ['UTC', false]]) {
    t = Date.UTC(2026, 8, 24, 19, 45);
    const relay = await relayWith({ clock: () => t, nightTz: tz });
    const { ana, ben } = await pairedWithWatcher('six-' + tz);
    ana.ws.close();
    await pause(50);
    t = Date.UTC(2026, 8, 24, 20, 35);
    ben.send({ t: 'ping' });
    relay.expire(t);
    await pause(100);
    assert.equal(ben.view.near.length === 0, leaves, tz);
    close(ben);
  }
});

test('a wristband waiting for its owner gets fresh letters at 06:00', async () => {
  let t = new Date(2026, 8, 25, 5, 50).getTime();
  const relay = await relayWith({ clock: () => t });
  const band = await wristband(62, { secret: newKey() });
  assert.equal(band.show.kind, 'waiting');
  relay.expire(new Date(2026, 8, 25, 5, 59).getTime());
  await pause(50);
  assert.equal(band.show.kind, 'waiting', 'not before six');
  t = new Date(2026, 8, 25, 6, 1).getTime();
  relay.expire(t);
  await band.until((s) => s.kind === 'pairing');
  close(band);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npm run build >/dev/null && node --test tests/rules.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: six fail (no `graceMs`, nothing starts a grace when a wristband closes, no hour, no 06:00). `a live wristband holds its person…` and `a wristband coming back stops the grace` pass already, only because today's grace ignores `graceMs` and never runs out inside a test; their mutation checks below hold them once it does.

- [ ] **Step 3: Write `relay/night.js`**

```js
// ON THE BEAT — which night a moment belongs to, at the venue.
//
// A night runs to 06:00: a gig that ends at one in the morning is still that
// evening's night. The relay ends a night at 06:00 in the venue's time zone
// (`nightTz`, an IANA name), which defaults to the relay machine's own.

const SIX_HOURS = 6 * 3_600_000;

/** The night `ms` belongs to, as YYYY-MM-DD in `tz`: before 06:00 it is still the night before. */
export function nightOf(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms - SIX_HOURS));
  const get = (type) => parts.find((p) => p.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}
```

- [ ] **Step 4: Implement rule 2 in `relay/server.js`.**
  1. `import { nightOf } from './night.js';`; `export const GRACE_MS = 120_000;              // a locked screen is not leaving`; options `graceMs = GRACE_MS, … nightTz` with JSDoc lines `@param {number} [o.graceMs]  a person with no phone and no live wristband stays this long` and `@param {string} [o.nightTz]  the venue's time zone, whose 06:00 ends the night; the machine's own by default`.
  2. Rooms: `heard: new Map()` in `roomFor`, and the `rooms` comment gains `heard:Map(id -> when a phone of theirs last spoke)`.
  3. After `push()`:
     ```js
       // ---------- the grace, and leaving (rule 2) ----------
       // One grace for every trigger: a person whose last phone socket closed with
       // no live wristband, or whose wristband closed with no phone. A live
       // wristband holds its person without a phone — for BAND_ALONE_MS since a
       // phone of theirs was last heard, or until 06:00 (expire()).

       function startGrace(r, me) {
         stopGrace(r, me);
         // A relay that is shutting down starts no grace period: close() has
         // already cleared them, and a new one would hold the process open.
         if (closing || !r.room.has(me)) return;
         r.left.set(me, setTimeout(() => { r.left.delete(me); leaveRoom(r, me); }, graceMs));
       }

       function stopGrace(r, me) {
         clearTimeout(r.left.get(me));
         r.left.delete(me);
       }

       function leaveRoom(r, me) {
         r.room.leave(me);
         push(r);
         gcRoom(r);
       }
     ```
     and `const phoneOf = (r, me) => [...r.sockets].some((s) => s.me === me);` beside `toPerson`.
  4. `hello()`: just before `if (m.quiet === true) holdOn(b);`, `if (r) stopGrace(r, b.person);` (move the `const r = b.key ? rooms.get(b.key) : null;` line up above it).
  5. `handle()`'s first line: `// A phone of theirs was heard: any message, pings included (rule 2).` / `if (ws.r && ws.me) ws.r.heard.set(ws.me, now());`
  6. `join`: replace `clearTimeout(ws.r.left.get(me)); ws.r.left.delete(me);` with `stopGrace(ws.r, me); ws.r.heard.set(me, now());`. `leave`: replace the same two lines with `stopGrace(r, me);`.
  7. The socket `close` handler:
     ```js
         ws.on('close', () => {
           const b = ws.band && bands.get(ws.band);
           if (b && b.ws === ws) {
             b.ws = null;
             b.goneAt = now();
             // A wristband nobody has claimed keeps its letters for a minute, so a
             // dropped connection does not change the code someone is typing. The
             // sweep forgets it after that.
             const br = b.key ? rooms.get(b.key) : null;
             if (br) {
               if (b.person && !phoneOf(br, b.person)) startGrace(br, b.person);
               push(br);
             }
           }
           const r = ws.r;
           if (!r || closing) return;
           r.sockets.delete(ws);
           if (phoneOf(r, ws.me) || bandOf(r.key, ws.me)?.ws) return;
           startGrace(r, ws.me);
         });
     ```
  8. `expire(at)`: first line `const night = (t) => nightOf(t, nightTz);`; the waiting line becomes `if (b.waiting && (at - b.waitingAt >= bandAloneMs || night(b.waitingAt) !== night(at))) { freshLetters(b); showBand(b, at); continue; }`; after the band loop:
     ```js
         // Someone held only by their wristband leaves an hour after a phone of theirs
         // was last heard, or when the night ends at 06:00, whichever is first.
         for (const r of [...rooms.values()]) {
           for (const me of r.room.ids()) {
             if (phoneOf(r, me) || r.left.has(me) || !bandOf(r.key, me)?.ws) continue;
             const heard = r.heard.get(me) ?? 0;
             if (at - heard >= bandAloneMs || night(heard) !== night(at)) leaveRoom(r, me);
           }
         }
     ```
     and update the JSDoc of the returned `expire`: "run the sweep — clips, wristbands, the band-alone hour, 06:00, old attempts — as if the clock read `at`".
  9. The bottom: `const relay = await createRelay({ port: Number(process.env.PORT) || 8790, nightTz: process.env.NIGHT_TZ || undefined });`.

- [ ] **Step 5: Run to see them pass**

Run: `npm run build >/dev/null && node --test tests/rules.test.js tests/server.test.js tests/wristband.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 6: Mutation checks (P1)**, file `tests/rules.test.js`:
  - `if (phoneOf(r, ws.me) || bandOf(r.key, ws.me)?.ws) return;` → `if (phoneOf(r, ws.me)) return;` ⇒ **Expected red (exactly)**: `a live wristband holds its person…`, `held only by a wristband, … BAND_ALONE_MS…`, `held only by a wristband, … 06:00…`, `06:00 is in nightTz…` (every hour and 06:00 test stands on a person being held). From Task 12 on add `a set for a person who is not in a room is refused no room` (in `tests/wristband.test.js`), and from Task 14 `a hold on a paired wristband whose person left…`.
  - delete `if (b.person && !phoneOf(br, b.person)) startGrace(br, b.person);` ⇒ **Expected red (exactly)**: `a wristband that closes with no phone open starts the grace…`, `one grace timer per person…`.
  - delete `if (r) stopGrace(r, b.person);` in `hello()` ⇒ `a wristband coming back stops the grace`.
  - delete `for (const r of rooms.values()) for (const t of r.left.values()) clearTimeout(t);` in `close()` ⇒ `one grace timer per person…`.
  - `if (closing || !r.room.has(me)) return;` → `if (!r.room.has(me)) return;` ⇒ `one grace timer per person…`.
  - `if (at - heard >= bandAloneMs || night(heard) !== night(at))` → `if (night(heard) !== night(at))` ⇒ `held only by a wristband, … BAND_ALONE_MS…` (from Task 12 also `…refused no room`, from Task 14 also `a hold on a paired wristband whose person left…`).
  - same line → `if (at - heard >= bandAloneMs)` ⇒ **Expected red (exactly)**: `held only by a wristband, … 06:00…`, `06:00 is in nightTz…`.
  - `const night = (t) => nightOf(t, nightTz);` → `const night = (t) => nightOf(t);` ⇒ `06:00 is in nightTz…`.
  - `night(b.waitingAt) !== night(at)` removed from the waiting line ⇒ `a wristband waiting for its owner gets fresh letters at 06:00`.
  - `startGrace`'s own `stopGrace(r, me)` cannot be observed: every path that restarts a grace passes through `hello` or `join`, which stop it first. It stays, as the spec's "clears any timer the person already has"; say so in the commit body rather than claim a check.

- [ ] **Step 7: Full suite, commit**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add relay/night.js relay/server.js tests/rules.test.js
git commit -m "Hold a person in the room by a live wristband, for the hour or until 06:00, with one grace"
```

### Task 12: Rule 1 — the wristband may say `set`

**Files:**
- Modify: `relay/server.js` (`setFromBand`, `handleBand`, `makeBand.setAt`), `tests/wristband.test.js`, `tests/server.test.js`

**Interfaces:**
- Consumes: `room.revOf`, `arm(…, 'band')`, `setInvisible(…, 'band')` (Task 10); the hour (Task 11) for "no room".
- Produces: band → relay `{"t":"set","intent":"hi"|"song"|"dance"|null,"basis":<int>}`; relay → band `{"t":"set","ok":false,"why":"unpaired"|"no room"|"changed"|"too fast"}` for a refusal; a frame that is not exactly a set is dropped with no answer; `SET_GAP_MS = 1000`.

- [ ] **Step 1: Write the failing tests** — append to `tests/wristband.test.js`:

```js
// ---------- rule 1: the wrist's set ----------

/** A person in a room with a paired wristband, and the rev its last show named. */
async function wearing(venue) {
  const band = await wristband();
  const ana = await phone(venue);
  await pairBand(ana, band);
  const show = await band.until((s) => s.kind === 'off' && Number.isInteger(s.rev));
  return { band, ana, rev: show.rev };
}

test('a set is taken: visible, armed, by the band', async () => {
  const { band, ana, rev } = await wearing('set-room');
  band.send({ t: 'set', intent: 'song', basis: rev });
  await ana.until((v) => v.me.armed === 'song' && v.me.by === 'band');
  const show = await band.until((s) => s.kind === 'song');
  assert.ok(show.rev > rev);
  close(ana, band);
});

test('malformed sets are dropped whole, and NOT NOW survives them', async () => {
  const { band, ana } = await wearing('set-junk');
  band.send({ t: 'hold' });
  const { rev } = await band.until((s) => s.quiet);
  for (const m of [
    { t: 'set', basis: rev }, { t: 'set', intent: 'nonsense', basis: rev }, { t: 'set', intent: 7, basis: rev },
    { t: 'set', intent: 'hi' }, { t: 'set', intent: 'hi', basis: String(rev) }, { t: 'set', intent: 'hi', basis: rev + 0.5 },
    { t: 'set', intent: {}, basis: rev }, { t: 'set', intent: ['hi'], basis: rev },
  ]) band.send(m);
  await pause(200);
  assert.equal(ana.view.me.invisible, true, 'still NOT NOW');
  assert.deepEqual(band.replies, [], 'and no answer at all');
  close(ana, band);
});

test('a set from a wristband nobody paired is refused unpaired', async () => {
  const band = await wristband();
  band.send({ t: 'set', intent: 'hi', basis: 1 });
  await band.until((s, b) => b.replies.length === 1);
  assert.deepEqual(band.replies, [{ t: 'set', ok: false, why: 'unpaired' }]);
  close(band);
});

test('a set for a person who is not in a room is refused no room', async () => {
  const { band, ana, rev } = await wearing('set-noroom');
  ana.ws.close();
  await pause(100);
  relay.expire(Date.now() + BAND_ALONE_MS + 1_000);   // held only by the wristband, for the hour
  await band.until((s) => s.away);
  band.send({ t: 'set', intent: 'hi', basis: rev });
  await band.until((s, b) => b.replies.length === 1);
  assert.deepEqual(band.replies, [{ t: 'set', ok: false, why: 'no room' }]);
  close(band);
});

test('a set naming a rev that has moved is refused changed, and changes nothing', async () => {
  const { band, ana, rev } = await wearing('set-changed');
  ana.send({ t: 'invisible', on: true });
  await band.until((s) => s.quiet);
  band.send({ t: 'set', intent: 'hi', basis: rev });
  await band.until((s, b) => b.replies.length === 1);
  assert.deepEqual(band.replies, [{ t: 'set', ok: false, why: 'changed' }]);
  assert.equal(ana.view.me.invisible, true);
  close(ana, band);
});

test('more than one set a second is refused too fast', async () => {
  const { band, ana, rev } = await wearing('set-fast');
  band.send({ t: 'set', intent: 'hi', basis: rev });
  const { rev: next } = await band.until((s) => s.kind === 'hi');
  band.send({ t: 'set', intent: 'song', basis: next });
  await band.until((s, b) => b.replies.length === 1);
  assert.deepEqual(band.replies, [{ t: 'set', ok: false, why: 'too fast' }]);
  assert.equal(ana.view.me.armed, 'hi');
  close(ana, band);
});
```

In `tests/server.test.js`, `malformed and hostile messages…`: add `{ t: 'set', intent: 'hi', basis: 1 },` to `bad` (a phone saying `set` is ignored).

- [ ] **Step 2: Run to see them fail**

Run: `npm run build >/dev/null && node --test tests/wristband.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: the set tests fail (no answer, nothing changes). `malformed sets are dropped whole…` passes already — nothing takes `set` yet — and its mutation check below holds it.

- [ ] **Step 3: Implement in `relay/server.js`.** Add `INTENTS` to the `./room.js` import; `const SET_GAP_MS = 1000;              // a wristband may change its person at most once a second`; `makeBand` gains `setAt: 0,`. Before `handleBand`:

```js
  /** Rule 1: the wristband may say `set`. Returns whether anything changed. */
  function setFromBand(ws, b, m) {
    // Dropped whole, before anything is touched, unless it is exactly a set.
    if (!('intent' in m) || !(m.intent === null || INTENTS.includes(m.intent)) || !Number.isInteger(m.basis)) return false;
    const refuse = (why) => { ws.send(JSON.stringify({ t: 'set', ok: false, why })); return false; };
    if (!b.person) return refuse('unpaired');
    const room = rooms.get(b.key)?.room;
    if (!room?.has(b.person)) return refuse('no room');
    if (m.basis !== room.revOf(b.person)) return refuse('changed');
    if (now() - b.setAt < SET_GAP_MS) return refuse('too fast');
    b.setAt = now();
    room.setInvisible(b.person, false, 'band');
    room.arm(b.person, m.intent, 'band');
    return true;
  }
```

and in `handleBand`, after the hold line: `if (m.t === 'set' && !setFromBand(ws, b, m)) return;`.

- [ ] **Step 4: Run to see them pass**

Run: `npm run build >/dev/null && node --test tests/wristband.test.js tests/server.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 5: Mutation checks (P1)**, file `tests/wristband.test.js`:
  - delete the `if (!('intent' in m) || … ) return false;` line ⇒ `malformed sets are dropped whole, and NOT NOW survives them`
  - delete `if (!b.person) return refuse('unpaired');` ⇒ `a set from a wristband nobody paired is refused unpaired`
  - delete `if (!room?.has(b.person)) return refuse('no room');` ⇒ `a set for a person who is not in a room is refused no room`
  - delete `if (m.basis !== room.revOf(b.person)) return refuse('changed');` ⇒ `a set naming a rev that has moved is refused changed…`
  - delete `if (now() - b.setAt < SET_GAP_MS) return refuse('too fast');` ⇒ `more than one set a second is refused too fast`

- [ ] **Step 6: Full suite, commit**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add relay/server.js tests/wristband.test.js tests/server.test.js
git commit -m "Let a paired wristband set its person's card, naming the rev it chose from"
```

### Task 13: Rules 3 to 5 — re-said facts, seq, basis; join quiet; NOT NOW remembered

**Files:**
- Modify: `relay/room.js` (`join`, `leave`, `fromPhone`), `relay/server.js` (`join`, the `arm`/`invisible` cases), `tests/rules.test.js`

**Interfaces:**
- Produces (room): `join(id, { band, quiet })` — a person made here starts invisible if they left invisible tonight or `quiet` is true; `quiet` is ignored for someone already here. `fromPhone(id, m)` → `'changed'` or `null`: notes `seq` (the max, whether or not applied); an `again` copy is applied only if it is news (`seq > p.seq`) and it hides; a showing change with an integer `basis` other than `rev` is refused; one with no basis is taken.
- Produces (relay): a phone's `arm`/`invisible` with a `seq` present but not finite is dropped; a refusal answers `{t:'refused', why:'changed', seq}`; a join may carry `quiet: true`.
- Replaces: today's "a re-said fact never undoes NOT NOW" special case in the `arm`/`invisible` cases (its test in `tests/server.test.js` stays as it is).

- [ ] **Step 1: Write the failing tests** — append to `tests/rules.test.js`:

```js
// ---------- joining: quiet, and NOT NOW remembered ----------

test('a join with quiet makes a new person invisible; for someone already here it is ignored', async () => {
  await relayWith();
  const ben = await phone('quiet-join');
  const ana = await phone('quiet-join', { quiet: true });
  assert.equal(ana.view.me.invisible, true);
  assert.equal(ana.view.me.by, 'relay');
  ana.send({ t: 'arm', intent: 'hi' });
  await ben.until((v) => v.near.length === 1);
  const again = new WebSocket('ws://127.0.0.1:' + current.port + WS_PATH);
  await new Promise((r) => again.once('open', r));
  again.send(JSON.stringify({ t: 'join', venue: 'quiet-join', me: ana.me, quiet: true }));
  await pause(200);
  assert.equal(ben.view.near.length, 1, 'an old NOT NOW on a second join does not hide them');
  again.close();
  close(ana, ben);
});

test('someone who left under NOT NOW and is made again by a join without quiet is still invisible', async () => {
  await relayWith({ graceMs: 50 });
  const ben = await phone('tomb-room');   // keeps the room from being let go
  const ana = await phone('tomb-room');
  ana.send({ t: 'invisible', on: true });
  await ana.until((v) => v.me.invisible);
  ana.ws.close();
  await pause(200);                       // past the grace: out of the room
  const back = await phone('tomb-room', { me: ana.me });
  assert.equal(back.view.me.invisible, true);
  assert.equal(back.view.me.fresh, true);
  close(ben, back);
});

// ---------- rules 3 to 5: phones re-saying facts ----------

test('an unseen again NOT NOW is applied', async () => {
  await relayWith();
  const ana = await phone('again-quiet');
  const ben = await phone('again-quiet');
  ana.send({ t: 'arm', intent: 'hi', seq: 10 });
  await ben.until((v) => v.near.length === 1);
  ana.send({ t: 'invisible', on: true, seq: 11, again: true });
  await ben.until((v) => v.near.length === 0);
  close(ana, ben);
});

test('an again card is never applied, however new', async () => {
  await relayWith();
  const ana = await phone('again-card');
  ana.send({ t: 'arm', intent: 'hi', seq: 50, again: true });
  ana.send({ t: 'invisible', on: false, seq: 51, again: true });
  await pause(200);
  assert.equal(ana.view.me.armed, null);
  close(ana);
});

test('an again fact the relay already saw is not applied: the wrist chose SAY HI while the phone was in a pocket', async () => {
  await relayWith();
  const band = await wristband();
  const ana = await phone('pocket');
  await pairBand(ana, band);
  ana.send({ t: 'arm', intent: null, seq: 100 });
  const { rev } = await band.until((s) => s.kind === 'off' && Number.isInteger(s.rev));
  band.send({ t: 'set', intent: 'hi', basis: rev });
  await ana.until((v) => v.me.armed === 'hi');
  // The phone wakes and re-says what it last knew, NOT NOW included, at its old seq.
  ana.send({ t: 'invisible', on: true, seq: 100, again: true });
  ana.send({ t: 'arm', intent: null, seq: 100, again: true });
  await pause(200);
  assert.equal(ana.view.me.armed, 'hi', 'SAY HI stays');
  assert.equal(ana.view.me.invisible, false);
  close(ana, band);
});

test('the seq is acknowledged even when the message is not applied', async () => {
  await relayWith();
  const ana = await phone('seq-ack');
  const { rev } = ana.view.me;
  ana.send({ t: 'invisible', on: false, seq: 777, again: true });   // an again copy that shows: never applied
  const v = await ana.until((x) => x.me.seq === 777);
  assert.equal(v.me.rev, rev, 'nothing changed');
  close(ana);
});

test('a seq that is not a number drops the frame', async () => {
  await relayWith();
  const ana = await phone('seq-bad');
  ana.send({ t: 'arm', intent: 'hi' });
  await ana.until((v) => v.me.armed === 'hi');
  ana.send({ t: 'invisible', on: true, seq: 'soon' });
  await pause(200);
  assert.equal(ana.view.me.invisible, false);
  close(ana);
});

test('a phone card named from an old rev, arriving after a wrist NOT NOW, is refused changed', async () => {
  await relayWith();
  const band = await wristband();
  const ana = await phone('basis-room');
  await pairBand(ana, band);
  const { me: { rev } } = await ana.until((v) => Number.isInteger(v.me.rev));
  band.send({ t: 'hold' });
  await ana.until((v) => v.me.invisible);
  const refused = reply(ana, 'refused');
  ana.send({ t: 'arm', intent: 'hi', seq: 200, basis: rev });
  assert.deepEqual(await refused, { t: 'refused', why: 'changed', seq: 200 });
  await pause(100);
  assert.equal(ana.view.me.invisible, true, 'still NOT NOW');
  close(ana, band);
});

test('a phone message with no basis is taken as it always was', async () => {
  await relayWith();
  const ana = await phone('no-basis');
  ana.send({ t: 'invisible', on: true });
  await ana.until((v) => v.me.invisible);
  ana.send({ t: 'arm', intent: 'dance' });
  await ana.until((v) => v.me.armed === 'dance' && !v.me.invisible && v.me.by === 'phone');
  close(ana);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npm run build >/dev/null && node --test tests/rules.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: seven fail. `an unseen again NOT NOW is applied` passes already (today's special case lets an again NOT NOW through), and so does `a phone message with no basis is taken…`; they are here to stay green through the rewrite.

- [ ] **Step 3: Implement in `relay/room.js`.**
  1. Beside `matches`: `const tombs = new Map();    // id -> invisible when they last left; outlives leave(), as blocks do`.
  2. `join`:
     ```js
       /**
        * In the room. A person made here starts invisible if they left invisible
        * tonight, or if their phone joined holding NOT NOW (`quiet`); for someone
        * already here, `quiet` is ignored, so an old NOT NOW cannot undo a newer
        * change from the wrist.
        */
       function join(id, { band = BANDS[0], quiet = false } = {}) {
         if (!people.has(id)) {
           people.set(id, {
             id, name: '', contact: '', band: BANDS.includes(band) ? band : BANDS[0],
             armed: null, invisible: !!quiet || !!tombs.get(id), pick: null, clip: null, joinedAt: now(),
             rev: ++nextRev, seq: 0, by: 'relay',
           });
         }
         return people.get(id);
       }
     ```
  3. `leave`: `/** Leaving the room ends broadcasting. Matches, yeses, blocks and NOT NOW stay for the night. */` and `const p = people.get(id); if (p) tombs.set(id, p.invisible);` before the delete.
  4. After `setInvisible`:
     ```js
       /**
        * An arm or an invisible from a phone. Its seq is noted whether or not it is
        * applied (rule 4). A copy said `again` after a reconnect is applied only if
        * the relay never saw it and it hides the person (rule 3). A change that
        * shows the person and names the rev it was chosen from is refused if that
        * rev has moved (rule 5). Returns 'changed' for that refusal, else null.
        */
       function fromPhone(id, m) {
         const p = people.get(id);
         if (!p) return null;
         const seq = Number.isFinite(m.seq) ? m.seq : 0;
         const news = seq > p.seq;
         p.seq = Math.max(p.seq, seq);
         const hides = m.t === 'invisible' ? !!m.on : !INTENTS.includes(m.intent);
         if (m.again) {
           if (!news || !hides) return null;
         } else if (!hides && Number.isInteger(m.basis) && m.basis !== p.rev) {
           return 'changed';
         }
         if (m.t === 'invisible') setInvisible(id, m.on, 'phone');
         else arm(id, m.intent, 'phone');
         return null;
       }
     ```
     and export it (`join, leave, setBand, setProfile, arm, setInvisible, fromPhone, pick, …`).
- [ ] **Step 4: Implement in `relay/server.js`.** The join: `// \`quiet\` counts only if this join makes the person.` / `ws.r.room.join(me, { band: m.band, quiet: m.quiet === true });`. The two cases become one:

```js
      case 'arm':
      case 'invisible':
        // Rules 3 to 5 are in room.fromPhone(). A seq that is there but not a number drops the frame.
        if ('seq' in m && !Number.isFinite(m.seq)) return;
        if (room.fromPhone(me, m) === 'changed') ws.send(JSON.stringify({ t: 'refused', why: 'changed', seq: Number.isFinite(m.seq) ? m.seq : 0 }));
        break;
```

In `tests/server.test.js`, `malformed and hostile messages…` gains `{ t: 'arm', intent: 'hi', seq: 'x' }, { t: 'invisible', on: true, seq: null }, { t: 'arm', intent: 'hi', basis: 'x' },` in `bad`.

- [ ] **Step 5: Run to see them pass**

Run: `npm run build >/dev/null && node --test tests/rules.test.js tests/server.test.js tests/room.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ fail 0` — including `holding the wristband's button is NOT NOW, and a phone coming back does not undo it`, unchanged.

- [ ] **Step 6: Mutation checks (P1)**, file `tests/rules.test.js`:
  - `ws.r.room.join(me, { band: m.band, quiet: m.quiet === true });` → `ws.r.room.join(me, { band: m.band });` ⇒ `a join with quiet makes a new person invisible…`
  - delete `    if (p) tombs.set(id, p.invisible);` ⇒ `someone who left under NOT NOW…`
  - `if (!news || !hides) return null;` → `return null;` ⇒ `an unseen again NOT NOW is applied`
  - `if (!news || !hides) return null;` → `if (!hides) return null;` ⇒ `an again fact the relay already saw is not applied…`
  - `if (!news || !hides) return null;` → `if (!news) return null;` ⇒ `an again card is never applied, however new`
  - delete `    p.seq = Math.max(p.seq, seq);` ⇒ **Expected red (exactly)**: `the seq is acknowledged even when the message is not applied`, `an again fact the relay already saw is not applied…` (news is only news against a noted seq).
  - delete `if ('seq' in m && !Number.isFinite(m.seq)) return;` ⇒ `a seq that is not a number drops the frame`
  - `} else if (!hides && Number.isInteger(m.basis) && m.basis !== p.rev) {` → `} else if (false) {` ⇒ `a phone card named from an old rev…`
  - "A message with no basis is taken" is the fallthrough, not a guard: breaking it (`Number.isInteger(m.basis)` → `true`) reddens most tests that arm from a phone. That is expected; note it and restore.

- [ ] **Step 7: Full suite, commit**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add relay/room.js relay/server.js tests/rules.test.js tests/server.test.js
git commit -m "Apply a re-said fact only when it is news and hides; refuse a showing change named from an old rev"
```

### Task 14: Leaving is carried until it is heard; a hold waits for its person

**Files:**
- Modify: `relay/server.js` (the `leave` case, `holdOn`, `join`), `tests/rules.test.js`

**Interfaces:**
- Produces: relay → phone `{t:'left'}` answering a `leave`; a leave unpairs the person's wristband; a hold on a paired wristband whose person is not in a room is kept as `b.quiet` and applied (`by: 'band'`) when a phone of theirs joins.

- [ ] **Step 1: Write the failing tests** — append to `tests/rules.test.js`:

```js
// ---------- leaving ----------

test('a leave sent into a dead socket still removes the person once it is re-sent, and unpairs the wristband', async () => {
  await relayWith();
  const { band, ana, ben } = await pairedWithWatcher('leave-room');
  ana.ws.terminate();                      // the first leave went nowhere
  const again = await phone('leave-room', { me: ana.me });
  const left = reply(again, 'left');
  again.send({ t: 'leave' });
  await left;
  await ben.until((v) => v.near.length === 0);
  await band.until((s) => s.kind === 'pairing');
  close(ben, again, band);
});

test('a hold on a paired wristband whose person left is applied when they come back', async () => {
  let t = Date.now();
  const relay = await relayWith({ clock: () => t });
  const { band, ana, ben } = await pairedWithWatcher('hold-later');
  ana.ws.close();
  await pause(50);
  t += BAND_ALONE_MS + 1_000;
  ben.send({ t: 'ping' });
  relay.expire(t);                         // held only by the wristband, for the hour: out
  await band.until((s) => s.away);
  band.send({ t: 'hold' });
  await pause(100);
  const back = await phone('hold-later', { me: ana.me });
  await back.until((v) => v.me.invisible && v.me.by === 'band');
  close(ben, back, band);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npm run build >/dev/null && node --test tests/rules.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: both fail (no `left` answer; the hold is lost).

- [ ] **Step 3: Implement in `relay/server.js`.**
  1. The `leave` case:
     ```js
           case 'leave': {
             // Carried until it is heard: the phone re-sends it until this answer comes.
             const b = bandOf(r.key, me);
             if (b) unpairBand(b);
             stopGrace(r, me);
             room.leave(me);
             r.sockets.delete(ws);
             ws.r = null;
             ws.send(JSON.stringify({ t: 'left' }));
             gcRoom(r);
             break;
           }
     ```
  2. `holdOn`'s last line: `else if (b.person || b.waiting) b.quiet = true;`
  3. `join`, after `ws.r.room.join(…)`:
     ```js
           // A hold on their wristband while they were out of the room.
           const b = bandOf(key, me);
           if (b?.quiet) { ws.r.room.setInvisible(me, true, 'band'); b.quiet = false; }
     ```

- [ ] **Step 4: Run to see them pass**

Run: `npm run build >/dev/null && node --test tests/rules.test.js tests/server.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 5: Mutation checks (P1)**, file `tests/rules.test.js`:
  - in the `leave` case, delete `const b = bandOf(r.key, me);` and `if (b) unpairBand(b);` ⇒ `a leave sent into a dead socket…`
  - delete `if (b?.quiet) { ws.r.room.setInvisible(me, true, 'band'); b.quiet = false; }` ⇒ `a hold on a paired wristband whose person left…`

- [ ] **Step 6: Full suite, commit, close the stage (P2)**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add relay/server.js tests/rules.test.js
git commit -m "Answer a leave so the phone can carry it, and keep a wrist hold until its person is back"
git push origin main
```


## Stage D — §3 The phone follows the relay

### Task 15: `follow()` — what the phone adopts, keeps, shows and says

**Files:**
- Create: `app/lib/follow.js`, `tests/follow.test.js`

**Interfaces:**
- Produces: `INTENT_OF` (moved here from `App.jsx`); `FOLLOW_SAY`; `follow(phone, view)` with `phone = { armed, invisible, seq, asked, refused, screen }` → `null` (rule 4: `view.me.seq < phone.seq`) or `{ armed, invisible, seq, said: { arm, invisible }, screen, clearStack, toast: { text, unpair } | null, events: ['hi']? }`; `nextSeq(last, now)`; `tapMessage(t, value, seq, rev)`.
- `phone.seq` is the last seq this phone sent or followed; `phone.asked` the seq of its own last tap; `phone.refused` the seq of its last showing tap refused `changed`.

- [ ] **Step 1: Write the failing tests** — `tests/follow.test.js`:

```js
// ON THE BEAT — the phone following the relay: every row of the table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLLOW_SAY, follow, nextSeq, tapMessage } from '../app/lib/follow.js';

const phone = (p = {}) => ({ armed: null, invisible: false, seq: 100, asked: -1, refused: -1, screen: 'home', ...p });
const view = (me = {}) => ({ me: { armed: null, invisible: false, rev: 1, seq: 100, by: 'phone', fresh: false, ...me }, near: [], wall: [], floor: [], matches: [] });

test('a view older than what this phone last said is not followed (rule 4)', () => {
  assert.equal(follow(phone({ seq: 200 }), view({ seq: 199, armed: 'hi', by: 'band' })), null);
  assert.notEqual(follow(phone({ seq: 200 }), view({ seq: 200 })), null, 'the same seq is followed');
});

test('nothing moved: kept as it is, and said carries the view seq', () => {
  const f = follow(phone({ armed: 'hi', screen: 'beacon' }), view({ armed: 'hi', seq: 150 }));
  assert.deepEqual([f.screen, f.clearStack, f.toast, f.events], ['beacon', false, null, []]);
  assert.deepEqual(f.said, { arm: { t: 'arm', intent: 'hi', seq: 150 }, invisible: { t: 'invisible', on: false, seq: 150 } });
  assert.equal(f.seq, 150);
});

test('a different card from the wrist: adopted, stack cleared, off a screen of the old card, told with UNPAIR', () => {
  const f = follow(phone({ armed: 'hi', screen: 'near' }), view({ armed: 'song', by: 'band' }));
  assert.deepEqual([f.armed, f.screen, f.clearStack], ['song', 'home', true]);
  assert.deepEqual(f.toast, { text: FOLLOW_SAY.armed('song'), unpair: true });
  assert.equal(f.toast.text, 'Armed from your wristband: FIRST SONG');
  const same = follow(phone({ armed: 'hi', screen: 'tonight' }), view({ armed: 'song', by: 'band' }));
  assert.equal(same.screen, 'tonight', 'a screen of no card stays');
});

test('the wrist turned the card off', () => {
  const f = follow(phone({ armed: 'dance', screen: 'floor' }), view({ armed: null, by: 'band' }));
  assert.deepEqual([f.armed, f.screen], [null, 'home']);
  assert.deepEqual(f.toast, { text: FOLLOW_SAY.off, unpair: true });
});

test('the first SAY HI from the wrist is the phone\'s event too', () => {
  assert.deepEqual(follow(phone(), view({ armed: 'hi', by: 'band' })).events, ['hi']);
  assert.deepEqual(follow(phone({ armed: 'hi' }), view({ armed: 'hi', by: 'band' })).events, []);
});

test('invisible: the quiet screen, stack cleared, no toast', () => {
  const f = follow(phone({ armed: 'hi', screen: 'beacon' }), view({ invisible: true, by: 'band' }));
  assert.deepEqual([f.invisible, f.armed, f.screen, f.clearStack, f.toast], [true, null, 'quiet', true, null]);
});

test('visible again, no card, from the wrist: off the quiet screen to home', () => {
  const f = follow(phone({ invisible: true, screen: 'quiet' }), view({ by: 'band' }));
  assert.deepEqual([f.invisible, f.screen], [false, 'home']);
  assert.deepEqual(f.toast, { text: FOLLOW_SAY.visible, unpair: true });
});

test('visible with a card in one view: home, and one toast that says both', () => {
  const f = follow(phone({ invisible: true, screen: 'quiet' }), view({ armed: 'hi', by: 'band' }));
  assert.deepEqual([f.invisible, f.armed, f.screen], [false, 'hi', 'home']);
  assert.deepEqual(f.toast, { text: 'Back on, from your wristband: SAY HI', unpair: true });
});

test('a re-created person, while this phone held a card: the card went off, and says why', () => {
  const f = follow(phone({ armed: 'hi', screen: 'beacon' }), view({ fresh: true, by: 'relay' }));
  assert.deepEqual([f.armed, f.screen], [null, 'home']);
  assert.deepEqual(f.toast, { text: FOLLOW_SAY.away, unpair: false });
});

test('the phone\'s own tap did not land: tap again', () => {
  const f = follow(phone({ armed: 'hi', asked: 100, screen: 'beacon' }), view({ armed: null, by: 'phone' }));
  assert.deepEqual([f.armed, f.screen], [null, 'home']);
  assert.deepEqual(f.toast, { text: FOLLOW_SAY.lost, unpair: false });
  const back = follow(phone({ invisible: false, asked: 100, screen: 'home' }), view({ invisible: true, by: 'phone' }));
  assert.deepEqual([back.screen, back.toast?.text], ['quiet', FOLLOW_SAY.lost], 'a TURN BACK ON that did not land');
});

test('a showing tap refused as changed: check and tap again', () => {
  const f = follow(phone({ armed: 'song', asked: 100, refused: 100 }), view({ armed: 'hi', by: 'phone' }));
  assert.deepEqual(f.toast, { text: FOLLOW_SAY.changed, unpair: false });
});

test('a change this phone learned, not asked for, is not blamed on a tap', () => {
  const f = follow(phone({ armed: 'hi', asked: 50 }), view({ armed: null, by: 'phone' }));
  assert.equal(f.toast, null);
});

test('the first view after a relay restart: no wristband in it, nothing said about one', () => {
  const f = follow(phone({ seq: 0 }), view({ seq: 0, by: 'relay', fresh: true, wristband: null }));
  assert.equal(f.toast, null);
  assert.equal(JSON.stringify(f).includes('gone'), false);
});

test('following sends nothing: it only returns what to keep', () => {
  const f = follow(phone({ armed: 'hi' }), view({ armed: 'song', by: 'band' }));
  assert.deepEqual(Object.keys(f).sort(), ['armed', 'clearStack', 'events', 'invisible', 'said', 'screen', 'seq', 'toast']);
});

test('every tap that shows the person names the rev it was chosen from; a tap that hides names none', () => {
  assert.deepEqual(tapMessage('arm', 'hi', 500, 9), { t: 'arm', intent: 'hi', seq: 500, basis: 9 });
  assert.deepEqual(tapMessage('invisible', false, 501, 9), { t: 'invisible', on: false, seq: 501, basis: 9 });
  assert.deepEqual(tapMessage('arm', null, 502, 9), { t: 'arm', intent: null, seq: 502 });
  assert.deepEqual(tapMessage('invisible', true, 503, 9), { t: 'invisible', on: true, seq: 503 });
});

test("a tap's seq is above the last one and never behind the clock", () => {
  assert.equal(nextSeq(100, 50), 101);
  assert.equal(nextSeq(100, 5000), 5000);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/follow.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)|Cannot find"`
Expected: `Cannot find module …/app/lib/follow.js`.

- [ ] **Step 3: Write `app/lib/follow.js`**

```js
// ON THE BEAT — the phone following the relay.
//
// The relay is the one place a person's state lives; the wrist and the phone
// both change it there. So the phone never asserts a card or NOT NOW it has
// not just been asked for: it draws what it last knew, and each view from the
// relay decides. This is that decision, pure, so every row of it is tested
// (tests/follow.test.js) without React, a socket or a clock.
//
// It never sends anything. What it returns for `said` is only kept, to be
// re-said after a reconnect, and carries the view's own seq, so a re-said fact
// the phone learned from the relay is never news to it (relay rule 3).

import { HUE } from '../copy.js';

/** Arriving on one of these arms its card, as the canvas does. */
export const INTENT_OF = { beacon: 'hi', near: 'hi', pick: 'song', wall: 'song', camera: 'dance', floor: 'dance' };

export const FOLLOW_SAY = {
  armed: (intent) => 'Armed from your wristband: ' + HUE[intent].label,
  off: 'Your wristband turned your card off',
  visible: 'Visible again, from your wristband',
  backOn: (intent) => 'Back on, from your wristband: ' + HUE[intent].label,
  away: 'You were away a while, so your card went off.',
  lost: 'That didn’t go through — tap again',
  changed: 'Something changed — check and tap again.',
};

/**
 * @param {object} phone  what this phone holds: { armed, invisible, seq, asked, refused, screen }
 *                        seq: the last seq it sent or followed; asked: the seq of its own last tap;
 *                        refused: the seq of its last showing tap the relay refused as `changed`
 * @param {object} view   the relay's view
 * @returns {null | { armed, invisible, seq, said, screen, clearStack, toast, events }}
 *          null when the view is older than what this phone last said (rule 4) and is not followed
 */
export function follow(phone, view) {
  const me = view?.me;
  if (!me || !Number.isFinite(me.seq) || me.seq < phone.seq) return null;
  const armed = me.armed ?? null;
  const invisible = !!me.invisible;
  const out = {
    armed,
    invisible,
    seq: me.seq,
    said: { arm: { t: 'arm', intent: armed, seq: me.seq }, invisible: { t: 'invisible', on: invisible, seq: me.seq } },
    screen: phone.screen,
    clearStack: false,
    toast: null,
    events: [],
  };
  const cardMoved = armed !== (phone.armed ?? null);
  const quietMoved = invisible !== !!phone.invisible;
  if (!cardMoved && !quietMoved) return out;

  out.clearStack = true;
  if (armed === 'hi' && cardMoved) out.events.push('hi');
  if (invisible) out.screen = 'quiet';
  else if (phone.screen === 'quiet' || (INTENT_OF[phone.screen] && INTENT_OF[phone.screen] !== armed)) out.screen = 'home';

  const toast = (text, unpair = false) => { out.toast = { text, unpair }; };
  if (me.fresh && phone.armed && !armed) {
    toast(FOLLOW_SAY.away);
  } else if (me.by === 'band') {
    // Going dark from the wrist says itself: the quiet screen, as before.
    if (!invisible && quietMoved) toast(armed ? FOLLOW_SAY.backOn(armed) : FOLLOW_SAY.visible, true);
    else if (!invisible) toast(armed ? FOLLOW_SAY.armed(armed) : FOLLOW_SAY.off, true);
  } else if (phone.asked === phone.seq) {
    // This phone's own tap was the last thing it said, and the relay shows otherwise.
    toast(phone.refused === phone.seq ? FOLLOW_SAY.changed : FOLLOW_SAY.lost);
  }
  return out;
}

/** A tap's seq: above the last one this phone sent or followed, and at least the clock (rule 4). */
export const nextSeq = (last, now) => Math.max(last + 1, now);

/**
 * What a tap on this phone sends. A change that shows the person names the
 * rev of the view it was chosen from (rule 5); a change that hides never does,
 * and is always taken.
 */
export function tapMessage(t, value, seq, rev) {
  if (t === 'arm') return value ? { t, intent: value, seq, basis: rev } : { t, intent: null, seq };
  return value ? { t, on: true, seq } : { t, on: false, seq, basis: rev };
}
```

- [ ] **Step 4: Run to see it pass**

Run: `node --test tests/follow.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ pass 16`, `ℹ fail 0`.

- [ ] **Step 5: Rule 4's mutation check (P1)**, file `tests/follow.test.js`: `if (!me || !Number.isFinite(me.seq) || me.seq < phone.seq) return null;` → `if (!me || !Number.isFinite(me.seq)) return null;` ⇒ `a view older than what this phone last said is not followed (rule 4)`. (No build needed: this file does not touch `dist/`.)

- [ ] **Step 6: Commit**

```bash
git add app/lib/follow.js tests/follow.test.js
git commit -m "Decide in one pure function how the phone follows the relay's view"
```

### Task 16: `net.js` — kept facts, in order; a page load queues nothing

**Files:**
- Create: `tests/net.test.js`
- Modify: `app/lib/net.js`

**Interfaces:**
- Produces: `export const SAID_ORDER = ['pair', 'invisible', 'profile', 'pick', 'arm', 'leave']`; the join carries `quiet: true` while the kept `invisible` is on; `live()` → whether a socket is open now. `say`, `keep`, `forget`, `send` keep their meaning.

- [ ] **Step 1: Write the failing tests** — `tests/net.test.js`:

```js
// ON THE BEAT — the phone's line: what it re-says, in what order, and what a page load sends.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/** A socket that records what is sent on it, opened by hand. */
class FakeSocket {
  static all = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeSocket.all.push(this); }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  drop() { this.readyState = 3; this.onclose?.(); }
}

let connect;
beforeEach(async () => {
  FakeSocket.all = [];
  globalThis.WebSocket = FakeSocket;
  globalThis.location = { protocol: 'http:', host: 'relay.test' };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  ({ connect } = await import('../app/lib/net.js'));
});
const lines = [];
afterEach(() => { for (const n of lines.splice(0)) n.close(); });
const open = (opts = {}) => { const n = connect({ venue: 'v', me: 'a'.repeat(32), ...opts }); lines.push(n); return n; };

test('a page load queues nothing: what it holds goes out only as again copies, in order, claim first', () => {
  const n = open();
  n.keep('arm', { t: 'arm', intent: null, seq: 7 });
  n.keep('pick', { t: 'pick', track: 'Treasure' });
  n.keep('profile', { t: 'profile', name: 'Rae', contact: '' });
  n.keep('invisible', { t: 'invisible', on: false, seq: 7 });
  n.keep('pair', { t: 'pair', band: 'b'.repeat(32), secret: 'c'.repeat(32) });
  const [sock] = FakeSocket.all;
  assert.deepEqual(sock.sent, [], 'nothing before the socket opens');
  sock.open();
  assert.deepEqual(sock.sent.map((m) => m.t), ['join', 'pair', 'invisible', 'profile', 'pick', 'arm']);
  assert.ok(sock.sent.slice(1).every((m) => m.again === true), 'every fact is marked again');
  assert.equal(sock.sent[0].quiet, undefined, 'a visible phone joins without quiet');
});

test('a phone holding NOT NOW joins with quiet', () => {
  const n = open();
  n.keep('invisible', { t: 'invisible', on: true, seq: 9 });
  FakeSocket.all[0].open();
  assert.equal(FakeSocket.all[0].sent[0].quiet, true);
});

test('offline, NOT NOW is queued and also re-said; after the again copies, the queue', () => {
  const n = open();
  n.say('invisible', { t: 'invisible', on: true, seq: 11 });
  assert.equal(n.live(), false);
  FakeSocket.all[0].open();
  assert.deepEqual(FakeSocket.all[0].sent.map((m) => [m.t, !!m.again]), [['join', false], ['invisible', true], ['invisible', false]]);
});

test('a leave is re-said on every connection until it is forgotten', () => {
  const n = open();
  n.keep('leave', { t: 'leave' });
  FakeSocket.all[0].open();
  assert.equal(FakeSocket.all[0].sent.at(-1).t, 'leave');
  n.forget('leave');
  n.close();
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/net.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: the order, quiet, `live()` and leave tests fail.

- [ ] **Step 3: Implement in `app/lib/net.js`.**
  1. The header's second paragraph becomes: "The relay forgets everything when it restarts, and a person who has been gone longer than its grace period is taken out of the room. So on every join the phone says again who it is and what it is doing, and the room is rebuilt from the phones — but only as facts marked `again`, which the relay applies only when they are news to it and only when they hide the person (relay/room.js fromPhone(), rule 3). A page load says nothing new: what it holds is kept here and re-said, never queued."
  2. After `QUEUE_MAX`:
     ```js
     /** The order facts are re-said in: the claim first, so a wristband's kept hold lands before anything else. */
     export const SAID_ORDER = ['pair', 'invisible', 'profile', 'pick', 'arm', 'leave'];
     ```
  3. `const said = Object.fromEntries(SAID_ORDER.map((k) => [k, null]));`
  4. In `sock.onopen`:
     ```js
           // NOT NOW rides on the join: it counts only if the join makes the person anew.
           raw({ t: 'join', venue, me, ...(said.invisible?.on ? { quiet: true } : {}) });
           for (const k of SAID_ORDER) if (said[k]) raw({ ...said[k], again: true });
           for (const m of queue.splice(0)) raw(m);
     ```
  5. The returned object gains, first: `/** Is there a live socket right now? Showing changes are only sent on one. */ live: () => !!isOpen(),`; `say`'s comment becomes "A standing fact about this phone, sent now and re-said after every reconnect."; `keep`'s "A standing fact this phone already holds: not sent now, only re-said after a reconnect."

- [ ] **Step 4: Run to see them pass**

Run: `node --test tests/net.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ pass 4`, `ℹ fail 0`.

- [ ] **Step 5: Mutation checks (P1)**, file `tests/net.test.js`:
  - `SAID_ORDER = ['pair', 'invisible', 'profile', 'pick', 'arm', 'leave']` → `['profile', 'arm', 'invisible', 'pick', 'pair', 'leave']` ⇒ `a page load queues nothing: … claim first`
  - `raw({ t: 'join', venue, me, ...(said.invisible?.on ? { quiet: true } : {}) });` → `raw({ t: 'join', venue, me });` ⇒ `a phone holding NOT NOW joins with quiet`

- [ ] **Step 6: Full suite, commit**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add app/lib/net.js tests/net.test.js
git commit -m "Re-say kept facts claim first, carry NOT NOW on the join, and say whether the line is live"
```

### Task 17: The phone follows — App wiring, toasts, the Leaving screen

**Files:**
- Modify: `app/App.jsx`, `app/lib/store.js` (`startNight`), `app/screens/Met.jsx` (`Leaving`), `app/styles.css` (`.toast .act`)

**Interfaces:**
- Consumes: `follow`, `INTENT_OF`, `nextSeq`, `tapMessage` (Task 15); `live()`, `keep`, `SAID_ORDER` (Task 16); relay `{t:'refused', why:'changed', seq}`, `{t:'left'}`, `view.me.{rev, seq, by, fresh}`.
- Produces: night state `armed`, `invisible`, `seq`; night `leaving`; `say(text, action?)` where `action = { label, onTap }`; screen `'leaving'`.

- [ ] **Step 1: Take the old assertions out of the load.** In `app/App.jsx`, import `{ INTENT_OF, follow, nextSeq, tapMessage } from './lib/follow.js'` and delete the local `INTENT_OF`. Delete `const [armed, setArmed] = useState(null);` and every `setArmed(…)` call; add after `const invisible = …`:

```jsx
  // What this phone last knew, kept with the night and drawn at once; the relay's next view decides (§3).
  const armed = night?.state?.armed ?? null;
  const seqRef = useRef(night?.state?.seq ?? 0);   // the last seq this phone sent or followed
  const asked = useRef(-1);                         // the seq of this phone's own last tap
  const refused = useRef(-1);                       // the seq of its last showing tap refused `changed`
  useEffect(() => { seqRef.current = night?.state?.seq ?? 0; }, [night?.me]);
```

In the connect effect, replace the five `n.say(…)` lines with:

```jsx
    // A page load says nothing new (§3): what this phone holds is kept, and re-said only as again copies.
    const st = night.state || {};
    const seq = st.seq ?? 0;
    n.keep('profile', { t: 'profile', name: s.name, contact: s.contact });
    n.keep('invisible', { t: 'invisible', on: !!st.invisible, seq });
    n.keep('arm', { t: 'arm', intent: st.armed ?? null, seq });
    if (st.pick) n.keep('pick', { t: 'pick', track: st.pick });
    if (st.wristband) n.keep('pair', { t: 'pair', band: st.wristband, secret: st.bandSecret || '' });
    if (night.leaving) n.keep('leave', { t: 'leave' });
```

Delete the effect headed `// The wristband's button made them invisible…` (its job is `follow`'s now).

- [ ] **Step 2: Toasts can carry an action.**

```jsx
  const say = useCallback((text, action = null) => {
    clearTimeout(toastTimer.current);
    setToast({ text, action });
    toastTimer.current = setTimeout(() => setToast(null), action ? 5000 : 2600);
  }, []);
```

and the toast render:

```jsx
      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          {toast.text}
          {toast.action ? <button type="button" className="act" onClick={() => { setToast(null); toast.action.onTap(); }}>{toast.action.label}</button> : null}
        </div>
      ) : null}
```

with, in `app/styles.css` after `.toast`: `.toast .act { display: block; margin-top: 8px; padding: 0; border: 0; background: none; color: var(--stop); font: 700 13px/1.2 var(--sans); letter-spacing: .06em; cursor: pointer; }`.

- [ ] **Step 3: Taps carry seq and basis; offline only NOT NOW goes.** Replace `arm`, `notNow` and `backOn`:

```jsx
  // A tap (§2 rules 4 and 5): a new seq, and the rev it was chosen from when it shows the person.
  const tap = useCallback((t, value) => {
    const seq = nextSeq(seqRef.current, Date.now());
    seqRef.current = seq;
    asked.current = seq;
    net.current?.say(t, tapMessage(t, value, seq, view.me?.rev));
    return seq;
  }, [view.me?.rev]);
  // Showing someone needs the relay now: offline, only NOT NOW is queued.
  const cannotShow = useCallback(() => {
    if (net.current?.live() && Number.isInteger(view.me?.rev)) return false;
    say('Not connected — try again');
    return true;
  }, [view.me?.rev, say]);

  const arm = useCallback((intent) => {
    if (cannotShow()) return false;
    const seq = tap('arm', intent);
    // Arming makes them visible on the relay; the kept NOT NOW follows without being sent.
    if (intent) net.current?.keep('invisible', { t: 'invisible', on: false, seq });
    setNightState({ armed: intent, ...(intent ? { invisible: false } : {}), seq });
    if (intent === 'hi' && !store.hasEvent(s, 'hi')) update((prev) => store.addEvent(prev, 'hi', 'started saying hi'));
    return true;
  }, [s, setNightState, update, tap, cannotShow]);
```

`go()`: `if (intent && armed !== intent && !arm(intent)) return;` (nothing moves when the card could not be armed).

```jsx
  const notNow = () => {
    const seq = tap('invisible', true);   // queued when offline, and re-said
    net.current?.keep('arm', { t: 'arm', intent: null, seq });
    setNightState({ armed: null, invisible: true, seq });
    setStack([]);
    setSheet(null);
    setScreen('quiet');
  };

  const backOn = () => {
    if (cannotShow()) return;
    const seq = tap('invisible', false);
    setNightState({ invisible: false, seq });
    setStack([]);
    setScreen('home');
  };
```

- [ ] **Step 4: Follow every view.** After the match effect:

```jsx
  // The relay decides (§3): a view that passes rule 4 sets the cards, the screen and what is re-said.
  useEffect(() => {
    if (!view.me) return;
    const f = follow({ armed, invisible, seq: seqRef.current, asked: asked.current, refused: refused.current, screen }, view);
    if (!f) return;
    seqRef.current = f.seq;
    net.current?.keep('arm', f.said.arm);
    net.current?.keep('invisible', f.said.invisible);
    if (f.armed !== armed || f.invisible !== invisible || f.seq !== (night?.state?.seq ?? 0)) {
      setNightState({ armed: f.armed, invisible: f.invisible, seq: f.seq });
    }
    if (f.events.includes('hi') && !store.hasEvent(s, 'hi')) update((prev) => store.addEvent(prev, 'hi', 'started saying hi'));
    if (f.clearStack) { setStack([]); setSheet(null); }
    if (f.screen !== screen && !ONBOARDING.has(screen) && screen !== 'leaving') setScreen(f.screen);
    if (f.toast) say(f.toast.text, f.toast.unpair ? { label: 'NOT YOU? UNPAIR', onTap: unpair } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
```

and in `onRelay.current`: `if (m.t === 'refused' && m.why === 'changed') refused.current = m.seq;`.

- [ ] **Step 5: Leaving is carried until it is heard.** `leftVenue`:

```jsx
  // "I've left" is carried until the relay answers (§2): the room line stays open, and the leave is re-said.
  const leftVenue = () => {
    const key = store.tonightKey();
    update((prev) => (prev.nights[key] ? { ...prev, nights: { ...prev.nights, [key]: { ...prev.nights[key], leaving: true } } } : prev));
    net.current?.say('leave', { t: 'leave' });
    setStack([]);
    setSheet(null);
    setScreen('leaving');
  };
```

(the relay's leave unpairs the wristband, so the separate `unpair` goes). In `onRelay.current`:

```jsx
    if (m.t === 'left') {
      net.current?.forget('leave');
      const key = store.tonightKey();
      update((prev) => (prev.nights[key] ? { ...prev, nights: { ...prev.nights, [key]: { ...prev.nights[key], left: true, leaving: false, state: {} } } } : prev));
      setStack([]);
      setScreen('venue');
    }
```

`afterSplash` gains `else if (night.leaving) setScreen('leaving');` right after the venue line; the screen switch gains `case 'leaving': body = <Leaving offline={status !== 'live'} />; break;` (import `Leaving` from `./screens/Met.jsx`). In `app/screens/Met.jsx`:

```jsx
/** "I've left", carried until the relay has heard it (spec §2). */
export function Leaving({ offline }) {
  return (
    <div className="scr tall">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
        <Icon name="logout" size={40} color="#6E6D77" style={{ marginBottom: 8 }} />
        <span className="h1">Leaving…</span>
        <span className="lede muted">{offline ? 'You’ll be taken out as soon as there’s signal.' : 'Taking you out of the room.'}</span>
      </div>
    </div>
  );
}
```

In `app/lib/store.js`, `startNight`'s last line keeps a new night clear of an old leave: `{ ...night, left: false, leaving: false }`.

- [ ] **Step 6: The battery prompt belongs to the wristband, not the beacon screen.** In the effect headed `// The beacon costs the screen. Ask once a night, when it is low.`, three edits and nothing else:
  1. the comment becomes `// Ask once a night, when the battery that matters is low: once paired, the wristband's, wherever the phone is (a card can be armed from the wrist); otherwise the phone's, on the beacon.`
  2. its first line `if (screen !== 'beacon' || night?.state?.batteryAsked) return;` becomes `if (night?.state?.batteryAsked) return;`
  3. `if (screen !== 'beacon') return;` is inserted just before `battery().then((b) => {`.

- [ ] **Step 7: Build, and check in a browser.** `npm start` in the background; the app seeded as `Rae` (`CLAUDE.md`), a second seeded browser tab as another person at the same venue, and `/band`:
  - Arm SAY HI; reload the page: the card is still SAY HI at once, and the relay log / the second tab shows no `arm null` (the second tab keeps seeing Rae in WHO'S NEAR).
  - Pair `/band` through the check. With the Task 9 stand-in there is no SIDE button yet, so use its hold: hold → the phone goes to the quiet screen; tap TURN BACK ON → home.
  - Offline: stop the relay; tap a card → *Not connected — try again*; tap NOT NOW → quiet screen; start the relay → the second tab never sees Rae.
  - I've left the venue: *Leaving…*; the stand-in shows new letters; the app lands on the venue list.
  Stop the relay by its port.

- [ ] **Step 8: Full suite, commit, close the stage (P2)**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add app/App.jsx app/lib/store.js app/screens/Met.jsx app/styles.css
git commit -m "Follow the relay on the phone: keep what it knew, tap with seq and basis, carry the leave"
git push origin main
```


## Stage E — §1 and §4: one Wrist, twice

The machine is written once in JavaScript against the table, then ported to C++ against the same table. Both were run against all 21 cases while this plan was written: `app/lib/wrist.js` under `node --test`, and the C++ below compiled with MSVC 19.44 (`/std:c++17 /W4`, no warnings) and driven through `logic_test wrist` — every case passed, all 201 host checks passed, and a deliberate break (dropping the NOT SENT re-hold) was caught by exactly its case. GCC's `-Wall -Wextra -Werror` has not seen it yet: if it flags something, fix the warning, not the flag.

### Task 18: `wrist.js` and the table of cases

**Files:**
- Create: `app/lib/wrist.js`, `tests/wrist-table.js`, `tests/fixtures/wrist-cases.json`, `tests/wrist.test.js`

**Interfaces:**
- Consumes: `bandIdOf` (`app/lib/sha256.js`, Task 3); relay shows with `armed`/`rev` (Task 10), `check`/`waiting`/`away` (Tasks 5, 7); `{t:'set', ok:false, why}` (Task 12); `{t:'paired', secret}` (Task 5).
- Produces: `WAKE_MS, HOLD_MS, BAR_MS, CHOOSE_MS, COMMIT_MS, CONFIRM_MS, RESULT_MS, PING_EVERY_MS, DEAF_MS, STALE_MS, QUIET_CONFIRM_MS, LIGHT_*`, `CARD_WORDS`, `CONSTS`; `createWrist({ key })` → `{ id, key, secret(), keyDown(k, now), keyUp(k, now), linkUp(now), linkDown(now), heard(now), frame(text, now), tick(now), setBattery(n), setWifi(on), take() → string[] (frame text or 'DROP'), face(now) → { big, small, field, ink, light, bar, code } }`.
- Produces (tests): the line protocol — `key <hex>`, then `<t> tick|heard|up|down|key1 down|key1 up|key2 down|key2 up|frame <json>|battery <n>|wifi 0|1` — and `lines(case, consts)`, `runJs(protocol)`, `check(case, protocol, answers, consts)`, `TABLE`. Every line after the first answers one line `{"sent":[…],"face":{…}}` (`{}` for `heard`).

- [ ] **Step 1: Write the table** — `tests/fixtures/wrist-cases.json`. Times are written in the constants' names and start from `T0 = 1000`; `"press": 2` is a KEY2 press held 100 ms; `"$ID"`/`"$KEY"` are the key's id and the key; `sent` lists every frame but pings, exactly; `face` lists only the fields that matter; a `LIGHT_*` name is its value.

```json
{
  "key": "000102030405060708090a0b0c0d0e0f",
  "shows": {
    "OFF": { "kind": "off", "battery": 62, "armed": null },
    "HI": { "kind": "hi", "intent": "hi", "big": "HI :)", "small": "blue means hello", "dim": false, "armed": "hi" },
    "SONG": { "kind": "song", "intent": "song", "big": "FIRST SONG?", "small": "Treasure", "dim": false, "armed": "song" },
    "QUIET": { "kind": "off", "battery": 62, "quiet": true, "armed": null },
    "MEET": { "kind": "meet", "intent": "song", "big": "27", "small": "MEET", "dim": false, "armed": "hi" },
    "PAIRING": { "kind": "pairing", "code": "KXRT" },
    "CHECK": { "kind": "check", "big": "27" },
    "WAITING": { "kind": "waiting" },
    "AWAY": { "kind": "off", "battery": 62, "away": true },
    "TEST": { "kind": "test" }
  },
  "cases": [
    {
      "name": "the hello says v2 and carries the key, and the id is the key's hash",
      "steps": [
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }], "face": { "light": "LIGHT_OFF" } }
      ]
    },
    {
      "name": "a paired wristband says its secret in every hello, and forgets it when it is shown letters",
      "steps": [
        { "at": "0", "battery": 62 },
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
        { "at": "10", "frame": { "t": "paired", "secret": "5ec2e75ec2e75ec2e75ec2e75ec2e75e" } },
        { "at": "20", "link": "down" },
        { "at": "30", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "secret": "5ec2e75ec2e75ec2e75ec2e75ec2e75e", "battery": 62 }] },
        { "at": "40", "show": "PAIRING", "face": { "big": "KXRT", "code": "KXRT", "light": "LIGHT_PAIR" } },
        { "at": "50", "link": "down" },
        { "at": "60", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] }
      ]
    },
    {
      "name": "KEY1 let go at 1.0 s and 1.4 s is a press; at HOLD_MS it is NOT NOW, dark at once",
      "steps": [
        { "at": "0", "battery": 62 },
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
        { "at": "0", "show": "OFF", "rev": 1, "face": { "light": "LIGHT_OFF" } },
        { "at": "1000", "key1": "down" },
        { "at": "1000+HOLD_MS-500", "key1": "up", "face": { "big": "READY", "small": "62%", "light": "LIGHT_AWAKE" } },
        { "at": "10000", "key1": "down" },
        { "at": "10000+HOLD_MS-100", "key1": "up", "face": { "big": "READY", "light": "LIGHT_AWAKE" } },
        { "at": "20000", "key1": "down" },
        { "at": "20000+HOLD_MS", "key1": "up", "sent": [{ "t": "hold" }], "face": { "big": "", "light": "LIGHT_OFF" } }
      ]
    },
    {
      "name": "held from BAR_MS, KEEP HOLDING and a bar; a dark face lights only to LIGHT_AWAKE, a card keeps its light",
      "steps": [
        { "at": "0", "battery": 62 },
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
        { "at": "0", "show": "OFF", "rev": 1 },
        { "at": "1000", "key1": "down", "face": { "small": "", "bar": -1, "light": "LIGHT_OFF" } },
        { "at": "1000+BAR_MS-1", "face": { "small": "", "bar": -1, "light": "LIGHT_OFF" } },
        { "at": "1000+BAR_MS", "face": { "big": "", "small": "KEEP HOLDING", "bar": 20, "light": "LIGHT_AWAKE" } },
        { "at": "1000+HOLD_MS-1", "face": { "small": "KEEP HOLDING", "bar": 99 } },
        { "at": "1000+HOLD_MS-1", "key1": "up", "face": { "big": "READY", "small": "62%", "bar": -1, "light": "LIGHT_AWAKE" } },
        { "at": "5000", "show": "HI", "rev": 2 },
        { "at": "6000", "key1": "down" },
        { "at": "6000+BAR_MS", "face": { "big": "HI :)", "small": "KEEP HOLDING", "field": "hi", "light": "LIGHT_FULL" } },
        { "at": "6000+BAR_MS", "key1": "up", "face": { "small": "BLUE MEANS HELLO", "bar": -1 } }
      ]
    },
    {
      "name": "NOT NOW with no relay is dark, rides in the next hello, and a press then says NOT NOW",
      "steps": [
        { "at": "0", "battery": 62 },
        { "at": "0", "key1": "down" },
        { "at": "HOLD_MS", "face": { "light": "LIGHT_OFF" } },
        { "at": "HOLD_MS", "key1": "up", "face": { "light": "LIGHT_OFF" } },
        { "at": "5000", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "quiet": true, "battery": 62 }] },
        { "at": "5100", "show": "QUIET", "rev": 2 },
        { "at": "6000", "press": 1, "face": { "big": "NOT NOW", "small": "62%", "field": "black", "light": "LIGHT_AWAKE" } }
      ]
    },
    {
      "name": "the first KEY2 press only looks; no second press within CHOOSE_MS and the look is dropped",
      "steps": [
        { "at": "0", "battery": 62 },
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
        { "at": "0", "show": "HI", "rev": 3 },
        { "at": "1000", "press": 2, "face": { "big": "HI :)", "small": "SIDE TO CHANGE", "field": "hi", "light": "LIGHT_FULL" } },
        { "at": "1100+CHOOSE_MS-1", "face": { "small": "SIDE TO CHANGE" } },
        { "at": "1100+CHOOSE_MS", "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "field": "hi" } }
      ]
    },
    {
      "name": "each press moves the preview after what is armed; COMMIT_MS later it is sent; a newer show saying so is SET",
      "steps": [
        { "at": "0", "battery": 62 },
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
        { "at": "0", "show": "HI", "rev": 3 },
        { "at": "1000", "press": 2, "face": { "small": "SIDE TO CHANGE" } },
        { "at": "2000", "press": 2, "face": { "big": "FIRST SONG?", "small": "SIDE: NEXT", "field": "black", "ink": "song", "light": "LIGHT_AWAKE" } },
        { "at": "3000", "press": 2, "face": { "big": "LET'S DANCE!", "ink": "dance" } },
        { "at": "4000", "press": 2, "face": { "big": "OFF", "small": "SIDE: NEXT", "ink": "text2" } },
        { "at": "4100+COMMIT_MS-1", "face": { "big": "OFF", "small": "SIDE: NEXT" } },
        { "at": "4100+COMMIT_MS", "sent": [{ "t": "set", "intent": null, "basis": 3 }], "face": { "big": "OFF", "small": "SENDING" } },
        { "at": "7500", "show": "OFF", "rev": 4, "face": { "big": "READY", "small": "SET", "light": "LIGHT_AWAKE" } },
        { "at": "7500+RESULT_MS", "face": { "big": "", "light": "LIGHT_OFF" } }
      ]
    },
    {
      "name": "a KEY2 hold at rest only looks; in a choice it sends at once; presses while sending are ignored",
      "steps": [
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
        { "at": "0", "show": "HI", "rev": 3 },
        { "at": "1000", "key2": "down" },
        { "at": "1000+HOLD_MS", "face": { "big": "HI :)", "small": "SIDE TO CHANGE" } },
        { "at": "1000+HOLD_MS", "key2": "up" },
        { "at": "3000", "press": 2, "face": { "big": "FIRST SONG?" } },
        { "at": "4000", "key2": "down" },
        { "at": "4000+HOLD_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }], "face": { "big": "FIRST SONG?", "small": "SENDING" } },
        { "at": "4000+HOLD_MS", "key2": "up" },
        { "at": "4000+HOLD_MS+100", "press": 2, "face": { "small": "SENDING" } }
      ]
    },
    {
      "name": "a preview equal to what is armed sends nothing",
      "steps": [
        { "at": "0", "battery": 62 },
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
        { "at": "0", "show": "OFF", "rev": 5 },
        { "at": "1000", "press": 2, "face": { "big": "READY", "small": "SIDE TO CHANGE" } },
        { "at": "2000", "press": 2, "face": { "big": "HI :)" } },
        { "at": "2500", "press": 2, "face": { "big": "FIRST SONG?" } },
        { "at": "3000", "press": 2, "face": { "big": "LET'S DANCE!" } },
        { "at": "3500", "press": 2, "face": { "big": "OFF" } },
        { "at": "3600+COMMIT_MS", "face": { "big": "READY", "small": "62%" } }
      ]
    },
    {
      "name": "from NOT NOW the first step is HI, only a KEY2 hold sends it, and two stray presses send nothing",
      "steps": [
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
        { "at": "0", "show": "QUIET", "rev": 6 },
        { "at": "1000", "press": 2, "face": { "big": "NOT NOW", "small": "SIDE TO CHANGE", "light": "LIGHT_AWAKE" } },
        { "at": "2000", "press": 2, "face": { "big": "HI :)", "small": "HOLD SIDE TO SHOW", "field": "black", "ink": "hi" } },
        { "at": "2100+COMMIT_MS", "face": { "small": "HOLD SIDE TO SHOW" } },
        { "at": "2100+CHOOSE_MS", "face": { "light": "LIGHT_OFF" } },
        { "at": "10000", "press": 2, "face": { "big": "NOT NOW" } },
        { "at": "11000", "press": 2, "face": { "big": "HI :)", "small": "HOLD SIDE TO SHOW" } },
        { "at": "12000", "key2": "down" },
        { "at": "12000+HOLD_MS", "sent": [{ "t": "set", "intent": "hi", "basis": 6 }], "face": { "big": "HI :)", "small": "SENDING" } },
        { "at": "12000+HOLD_MS", "key2": "up" },
        { "at": "14000", "show": "HI", "rev": 7, "face": { "big": "HI :)", "small": "SET", "field": "hi" } }
      ]
    },
    {
      "name": "KEY1 down two seconds into a choice freezes it: nothing is sent but the hold",
      "steps": [
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
        { "at": "0", "show": "HI", "rev": 3 },
        { "at": "1000", "press": 2 },
        { "at": "2000", "press": 2, "face": { "big": "FIRST SONG?" } },
        { "at": "4100", "key1": "down" },
        { "at": "2100+COMMIT_MS", "face": { "big": "FIRST SONG?" } },
        { "at": "4100+HOLD_MS", "sent": [{ "t": "hold" }], "face": { "light": "LIGHT_OFF" } },
        { "at": "4100+HOLD_MS", "key1": "up", "face": { "light": "LIGHT_OFF" } }
      ]
    },
    {
      "name": "a KEY1 press during a choice cancels it",
      "steps": [
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
        { "at": "0", "show": "HI", "rev": 3 },
        { "at": "1000", "press": 2 },
        { "at": "2000", "press": 2 },
        { "at": "2500", "press": 1, "face": { "big": "HI :)", "small": "BLUE MEANS HELLO", "field": "hi" } },
        { "at": "2100+COMMIT_MS", "face": { "small": "BLUE MEANS HELLO" } }
      ]
    },
    {
      "name": "a show with a new rev, or one not about the person, cancels a choice",
      "steps": [
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
        { "at": "0", "show": "HI", "rev": 3 },
        { "at": "1000", "press": 2 },
        { "at": "2000", "press": 2, "face": { "big": "FIRST SONG?" } },
        { "at": "2500", "show": "HI", "rev": 4, "face": { "small": "BLUE MEANS HELLO" } },
        { "at": "2100+COMMIT_MS" },
        { "at": "6000", "press": 2 },
        { "at": "7000", "press": 2, "face": { "big": "FIRST SONG?" } },
        { "at": "7500", "show": "PAIRING", "face": { "big": "KXRT", "light": "LIGHT_PAIR" } },
        { "at": "7100+COMMIT_MS", "face": { "big": "KXRT" } }
      ]
    },
    {
      "name": "offline, LOOK says NO SIGNAL and presses change nothing",
      "steps": [
        { "at": "0", "battery": 62 },
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
        { "at": "0", "show": "HI", "rev": 3 },
        { "at": "1000", "link": "down" },
        { "at": "2000", "press": 2, "face": { "big": "NO SIGNAL", "small": "NO RELAY - 62%" } },
        { "at": "3000", "press": 2, "face": { "big": "NO SIGNAL" } },
        { "at": "3100+COMMIT_MS", "face": { "big": "NO SIGNAL" } },
        { "at": "2100+CHOOSE_MS", "face": { "big": "HI :)" } },
        { "at": "9000", "wifi": false },
        { "at": "9500", "press": 2, "face": { "big": "NO SIGNAL", "small": "NO WI-FI - 62%" } }
      ]
    },
    {
      "name": "the relay refusing a stale basis is CHANGED; any other refusal is NOT SENT at once",
      "steps": [
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
        { "at": "0", "show": "HI", "rev": 3 },
        { "at": "1000", "press": 2 },
        { "at": "2000", "press": 2 },
        { "at": "2100+COMMIT_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }] },
        { "at": "5500", "frame": { "t": "set", "ok": false, "why": "changed" }, "face": { "big": "HI :)", "small": "CHANGED", "field": "hi" } },
        { "at": "5500+RESULT_MS", "face": { "small": "BLUE MEANS HELLO" } },
        { "at": "10000", "press": 2 },
        { "at": "11000", "press": 2 },
        { "at": "11100+COMMIT_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }] },
        { "at": "14500", "frame": { "t": "set", "ok": false, "why": "too fast" }, "face": { "small": "NOT SENT" } }
      ]
    },
    {
      "name": "nothing back in CONFIRM_MS is NOT SENT: the socket is dropped, and the next connection's show is the truth",
      "steps": [
        { "at": "0", "battery": 62 },
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
        { "at": "0", "show": "HI", "rev": 3 },
        { "at": "1000", "press": 2 },
        { "at": "2000", "press": 2 },
        { "at": "2100+COMMIT_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }] },
        { "at": "2100+COMMIT_MS+CONFIRM_MS-1", "face": { "small": "SENDING" } },
        { "at": "2100+COMMIT_MS+CONFIRM_MS", "sent": ["DROP"], "face": { "big": "HI :)", "small": "NOT SENT" } },
        { "at": "16000", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
        { "at": "16100", "show": "SONG", "rev": 4, "face": { "big": "FIRST SONG?", "small": "NOT SENT", "field": "song" } },
        { "at": "15100+RESULT_MS", "face": { "small": "TREASURE" } }
      ]
    },
    {
      "name": "NOT SENT leaving NOT NOW holds NOT NOW again, in the next hello",
      "steps": [
        { "at": "0", "battery": 62 },
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
        { "at": "0", "show": "QUIET", "rev": 6 },
        { "at": "1000", "press": 2 },
        { "at": "2000", "press": 2 },
        { "at": "3000", "key2": "down" },
        { "at": "3000+HOLD_MS", "sent": [{ "t": "set", "intent": "hi", "basis": 6 }] },
        { "at": "3000+HOLD_MS", "key2": "up" },
        { "at": "4500+CONFIRM_MS", "sent": ["DROP"], "face": { "big": "NOT NOW", "small": "NOT SENT", "light": "LIGHT_AWAKE" } },
        { "at": "15000", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "quiet": true, "battery": 62 }] }
      ]
    },
    {
      "name": "a KEY1 hold while sending is NOT NOW and drops the wait: no SET",
      "steps": [
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
        { "at": "0", "show": "HI", "rev": 3 },
        { "at": "1000", "press": 2 },
        { "at": "2000", "press": 2 },
        { "at": "2100+COMMIT_MS", "sent": [{ "t": "set", "intent": "song", "basis": 3 }] },
        { "at": "5200", "key1": "down" },
        { "at": "5200+HOLD_MS", "sent": [{ "t": "hold" }], "face": { "light": "LIGHT_OFF" } },
        { "at": "5200+HOLD_MS", "key1": "up" },
        { "at": "7000", "show": "SONG", "rev": 4, "face": { "small": "", "light": "LIGHT_OFF" } }
      ]
    },
    {
      "name": "the check, waiting for its owner, and not in a room; KEY2 on them only wakes",
      "steps": [
        { "at": "0", "battery": 62 },
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
        { "at": "0", "show": "CHECK", "face": { "big": "27", "small": "ON YOUR PHONE?", "field": "black", "ink": "white", "light": "LIGHT_PAIR" } },
        { "at": "1000", "press": 2, "face": { "big": "27", "small": "ON YOUR PHONE?" } },
        { "at": "2000", "show": "WAITING", "face": { "big": "OPEN YOUR PHONE", "small": "OR SWITCH ME OFF", "light": "LIGHT_AWAKE" } },
        { "at": "3000", "show": "AWAY", "face": { "big": "OPEN YOUR PHONE", "small": "TO COME BACK", "light": "LIGHT_AWAKE" } },
        { "at": "10000", "face": { "big": "", "light": "LIGHT_OFF" } },
        { "at": "11000", "press": 1, "face": { "big": "OPEN YOUR PHONE", "small": "TO COME BACK", "light": "LIGHT_AWAKE" } },
        { "at": "12000", "press": 2, "face": { "small": "TO COME BACK" } },
        { "at": "13000", "show": "PAIRING", "face": { "big": "KXRT", "code": "KXRT", "light": "LIGHT_PAIR" } },
        { "at": "14000", "show": "TEST", "face": { "field": "white", "light": "LIGHT_FULL" } }
      ]
    },
    {
      "name": "six seconds unheard drops the socket; ten more and the last show is not believed",
      "keepAlive": false,
      "steps": [
        { "at": "0", "battery": 62 },
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2, "battery": 62 }] },
        { "at": "0", "show": "HI", "rev": 3 },
        { "at": "DEAF_MS", "face": { "big": "HI :)" } },
        { "at": "DEAF_MS+1", "sent": ["DROP"], "face": { "big": "HI :)" } },
        { "at": "DEAF_MS+1+STALE_MS", "face": { "big": "", "light": "LIGHT_OFF" } },
        { "at": "DEAF_MS+1+STALE_MS", "press": 1, "face": { "big": "NO SIGNAL", "small": "NO RELAY - 62%" } },
        { "at": "20000", "wifi": false },
        { "at": "20100", "press": 1, "face": { "small": "NO WI-FI - 62%" } }
      ]
    },
    {
      "name": "LOOK replaces the meeting number while it lasts",
      "steps": [
        { "at": "0", "link": "up", "sent": [{ "t": "wristband", "id": "$ID", "key": "$KEY", "v": 2 }] },
        { "at": "0", "show": "MEET", "rev": 3, "face": { "big": "27", "small": "MEET", "field": "song" } },
        { "at": "1000", "press": 2, "face": { "big": "HI :)", "small": "SIDE TO CHANGE", "field": "hi" } },
        { "at": "1100+CHOOSE_MS", "face": { "big": "27", "small": "MEET" } }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write the runner** — `tests/wrist-table.js`:

```js
// ON THE BEAT — the wrist's table of cases, and how to run it.
//
// tests/fixtures/wrist-cases.json is one list of cases for both wrists: the
// stand-in's app/lib/wrist.js (tests/wrist.test.js) and the firmware's
// band_logic.h (tests/firmware.test.js, through `logic_test wrist`). A case
// becomes lines of a small text protocol that both read:
//
//   key <hex>             first: a wrist with this band key
//   <t> tick              let the time pass to t
//   <t> heard             the relay was heard at t (a pong); no time passes
//   <t> up | <t> down     the link to the relay
//   <t> key1 down | <t> key1 up | <t> key2 down | <t> key2 up
//   <t> frame <json>      a frame from the relay
//   <t> battery <n> | <t> wifi <0|1>
//
// Every line after the first lets the time pass to t, does the one thing, and
// answers one line: {"sent":[...frames, or "DROP"],"face":{...}}. `heard`
// lines are the keep-alive a case gets unless it says "keepAlive": false; they
// let no time pass and their answers are not checked.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createWrist } from '../app/lib/wrist.js';

export const TABLE = JSON.parse(readFileSync(new URL('./fixtures/wrist-cases.json', import.meta.url), 'utf8'));
const T0 = 1000;       // every case starts here, not at 0
const PRESS = 100;     // how long a "press" is held

/** A time written with the constants' names: "HOLD_MS+1", "2000+COMMIT_MS", "2*WAKE_MS". */
export function at(expr, consts) {
  let total = 0;
  for (const [, sign, term] of String(expr).replace(/\s+/g, '').matchAll(/([+-]?)([^+-]+)/g)) {
    const value = term.split('*').reduce((acc, part) => {
      const v = /^\d+$/.test(part) ? Number(part) : consts[part];
      if (typeof v !== 'number') throw new Error('unknown time ' + part + ' in ' + expr);
      return acc * v;
    }, 1);
    total += sign === '-' ? -value : value;
  }
  return T0 + total;
}

/** A case as protocol lines, each with what it must answer (null: not checked). */
export function lines(c, consts) {
  const out = [{ line: 'key ' + TABLE.key, expect: null }];
  const showOf = (s) => ({ t: 'show', show: { ...TABLE.shows[s.show], ...(s.rev !== undefined ? { rev: s.rev } : {}) } });
  let last = -Infinity;
  for (const s of c.steps) {
    const t = at(s.at ?? '0', consts);
    if (t < last) throw new Error(c.name + ': step at ' + s.at + ' goes back in time');
    last = t;
    const expect = { sent: s.sent ?? [], face: s.face ?? null };
    const keep = () => { if (c.keepAlive !== false) out.push({ line: t + ' heard', expect: null }); };
    keep();
    if (s.press) {
      out.push({ line: t + ' key' + s.press + ' down', expect: { sent: [], face: null } });
      last = t + PRESS;
      if (c.keepAlive !== false) out.push({ line: last + ' heard', expect: null });
      out.push({ line: last + ' key' + s.press + ' up', expect });
    } else if (s.link) out.push({ line: t + ' ' + s.link, expect });
    else if (s.key1) out.push({ line: t + ' key1 ' + s.key1, expect });
    else if (s.key2) out.push({ line: t + ' key2 ' + s.key2, expect });
    else if (s.show) out.push({ line: t + ' frame ' + JSON.stringify(showOf(s)), expect });
    else if (s.frame) out.push({ line: t + ' frame ' + JSON.stringify(s.frame), expect });
    else if (s.battery !== undefined) out.push({ line: t + ' battery ' + s.battery, expect });
    else if (s.wifi !== undefined) out.push({ line: t + ' wifi ' + (s.wifi ? 1 : 0), expect });
    else out.push({ line: t + ' tick', expect });
  }
  return out;
}

/** The same protocol, read by the stand-in's wrist. */
export function runJs(protocol) {
  let wrist = null;
  const answers = [];
  for (const { line } of protocol) {
    const [first, verb, ...rest] = line.split(' ');
    if (first === 'key') { wrist = createWrist({ key: verb }); continue; }
    const t = Number(first);
    if (verb === 'heard') { wrist.heard(t); answers.push(null); continue; }
    wrist.tick(t);
    if (verb === 'up') wrist.linkUp(t);
    else if (verb === 'down') wrist.linkDown(t);
    else if (verb === 'key1' || verb === 'key2') (rest[0] === 'down' ? wrist.keyDown : wrist.keyUp)(verb === 'key1' ? 1 : 2, t);
    else if (verb === 'frame') wrist.frame(rest.join(' '), t);
    else if (verb === 'battery') wrist.setBattery(Number(rest[0]));
    else if (verb === 'wifi') wrist.setWifi(rest[0] === '1');
    answers.push({ sent: wrist.take().map((o) => (o === 'DROP' ? o : JSON.parse(o))), face: wrist.face(t) });
  }
  return answers;
}

/** Holds one case's answers to what the table says; pings are the link's own business and left out. */
export function check(c, protocol, answers, consts) {
  const key = TABLE.key;
  const id = createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex').slice(0, 32);
  const fill = (v) => (v === '$ID' ? id : v === '$KEY' ? key : v);
  const deep = (v) => (Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : fill(v));
  const answered = protocol.slice(1);
  assert.equal(answers.length, answered.length, c.name + ': one answer a line');
  answered.forEach(({ line, expect }, i) => {
    if (!expect) return;
    const got = answers[i];
    const where = c.name + ' / ' + line;
    assert.deepEqual(got.sent.filter((f) => !(f && f.t === 'ping')), deep(expect.sent), where + ': sent');
    if (!expect.face) return;
    for (const [k, v] of Object.entries(expect.face)) {
      const want = typeof v === 'string' && /^LIGHT_/.test(v) ? consts[v] : v;
      assert.equal(got.face[k], want, where + ': face.' + k + ' ' + JSON.stringify(got.face));
    }
  });
}
```

and `tests/wrist.test.js`:

```js
// ON THE BEAT — the stand-in's wrist, held to the table of cases both wrists share.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_WORDS, CONSTS } from '../app/lib/wrist.js';
import { bandShow } from '../relay/band.js';
import { TABLE, lines, runJs, check } from './wrist-table.js';

for (const c of TABLE.cases) {
  test('wrist.js: ' + c.name, () => {
    const protocol = lines(c, CONSTS);
    check(c, protocol, runJs(protocol), CONSTS);
  });
}

test("the card words a preview draws are bandShow's own", () => {
  for (const intent of ['hi', 'song', 'dance']) {
    const s = bandShow({ view: { me: { armed: intent, invisible: false, pick: null, rev: 1 }, matches: [] }, now: 0 });
    assert.equal(CARD_WORDS[intent], s.big, intent);
  }
});
```

- [ ] **Step 3: Run to see it fail**

Run: `node --test tests/wrist.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)|Cannot find"`
Expected: `Cannot find module …/app/lib/wrist.js`.

- [ ] **Step 4: Write `app/lib/wrist.js`**

```js
// ON THE BEAT — the wristband's own logic, for the stand-in at /band.
//
// The same machine as the `Wrist` class in firmware/src/band_logic.h, line
// for line: it takes key downs and ups, the link coming and going, the
// relay's frames and the time, and gives back the frames to send and the
// face to draw. tests/fixtures/wrist-cases.json is run against both, so the
// stand-in and the real wristband cannot drift apart.
//
// KEY1 is the face button: a press wakes the face for WAKE_MS, a hold of
// HOLD_MS is NOT NOW. KEY2 is the side button: the first press shows what is
// armed, each press after moves a preview, and the choice is sent COMMIT_MS
// after the last press, or at once on a KEY2 hold. Leaving NOT NOW takes a
// KEY2 hold. The relay decides; the wrist only says what was chosen, and from
// which state (`basis`), and shows SET, CHANGED or NOT SENT by what comes back.

import { bandIdOf } from './sha256.js';

export const WAKE_MS = 6000;           // a KEY1 press shows the face this long
export const HOLD_MS = 1500;           // held this long: NOT NOW on KEY1, "send now" on KEY2
export const BAR_MS = 300;             // a KEY1 hold shows KEEP HOLDING from here
export const CHOOSE_MS = 6000;         // longest wait for the next KEY2 press before a choice is dropped
export const COMMIT_MS = 3000;         // after the last KEY2 step, the choice is sent (not from NOT NOW)
export const CONFIRM_MS = 10000;       // longest wait for the relay to show a sent choice
export const RESULT_MS = 3000;         // SET / NOT SENT / CHANGED stays on the face this long
export const PING_EVERY_MS = 2000;     // ask the relay this often...
export const DEAF_MS = 6000;           // ...and take this much silence as a dead socket
export const STALE_MS = 10000;         // out of reach this long, what the relay last said is not shown
export const QUIET_CONFIRM_MS = 3000;  // NOT NOW stays dark at least until the relay answers, or this long

export const LIGHT_FULL = 255;
export const LIGHT_DIM = 128;
export const LIGHT_PAIR = 160;
export const LIGHT_AWAKE = 110;
export const LIGHT_OFF = 0;

/** The words each card shows, as relay/band.js bandShow() sends them. */
export const CARD_WORDS = { hi: 'HI :)', song: 'FIRST SONG?', dance: "LET'S DANCE!" };
const ORDER = ['hi', 'song', 'dance', 'off'];
const LIT = ['hi', 'song', 'dance', 'meet'];

/** Every constant above, by name: the fixtures' times are written in these. */
export const CONSTS = {
  WAKE_MS, HOLD_MS, BAR_MS, CHOOSE_MS, COMMIT_MS, CONFIRM_MS, RESULT_MS, PING_EVERY_MS, DEAF_MS,
  STALE_MS, QUIET_CONFIRM_MS, LIGHT_FULL, LIGHT_DIM, LIGHT_PAIR, LIGHT_AWAKE, LIGHT_OFF, CARD_WORDS,
};

/** A relay show, read the way band_logic.h readFrame() reads it: wrong types fall back to defaults. */
function readShow(s) {
  const str = (v) => (typeof v === 'string' ? v : '');
  return {
    kind: str(s.kind) || 'off', intent: str(s.intent), big: str(s.big), small: str(s.small), code: str(s.code),
    dim: s.dim === true, quiet: s.quiet === true, away: s.away === true,
    hasArmed: 'armed' in s && (s.armed === null || typeof s.armed === 'string'),
    armed: typeof s.armed === 'string' ? s.armed : '',
    rev: Number.isInteger(s.rev) ? s.rev : 0,
  };
}

const lit = (s) => LIT.includes(s.kind) && !!CARD_WORDS[s.intent];
const words = (big, small, field, ink, light) => ({ big, small, field, ink, light, bar: -1, code: '' });

export function createWrist({ key }) {
  const id = bandIdOf(key);
  let secret = '';
  let battery = -1;
  let wifi = true;
  const link = { up: false, ever: false, heard: 0, asked: 0, lost: 0 };
  let show = null;
  const quiet = { pending: false, sent: false, at: 0 };
  let wakeUntil = 0;
  const k1 = { down: false, since: 0, fired: false };
  const k2 = { down: false, since: 0, fired: false };
  let mode = 'rest';          // rest | look | choosing | sending | result
  let preview = '';           // hi | song | dance | off
  let fromQuiet = false;
  let frozen = false;
  let stepAt = 0, basis = 0, sentAt = 0, resultUntil = 0;
  let choice = '';            // what was sent: a card, or '' for off
  let word = '';
  let out = [];

  const send = (m) => out.push(JSON.stringify(m));
  const stale = (now) => !link.up && (!link.ever || now - link.lost >= STALE_MS);
  const personal = () => !!show && show.hasArmed;
  const current = () => (quiet.pending || show?.quiet ? 'notnow' : show?.armed || 'off');
  const pct = () => (battery >= 0 ? battery + '%' : '');

  function noSignal() {
    const why = wifi ? 'NO RELAY' : 'NO WI-FI';
    return words('NO SIGNAL', pct() ? why + ' - ' + pct() : why, 'black', 'text2', LIGHT_AWAKE);
  }

  function rest() {
    mode = 'rest';
    frozen = false;
    preview = '';
    word = '';
  }

  function closed(now) {
    if (link.up) link.lost = now;
    link.up = false;
    quiet.sent = false;
  }

  function hold(now) {
    quiet.pending = true;
    quiet.sent = false;
    rest();
    wakeUntil = now;
  }

  function result(now, w) {
    mode = 'result';
    word = w;
    resultUntil = now + RESULT_MS;
    preview = '';
    frozen = false;
  }

  function commit(now) {
    if (frozen) return;
    if (preview === current() || !link.up) { rest(); return; }
    choice = preview === 'off' ? '' : preview;
    send({ t: 'set', intent: choice || null, basis });
    mode = 'sending';
    sentAt = now;
  }

  function step(now) {
    if (k1.down || frozen || mode === 'sending') return;
    if (mode === 'result') rest();
    if (mode === 'rest') {
      wakeUntil = now + WAKE_MS;
      if (!personal()) return;
      mode = 'look';
      stepAt = now;
      basis = show.rev;
      return;
    }
    if (!link.up) return;
    if (mode === 'look') {
      const cur = current();
      fromQuiet = cur === 'notnow';
      preview = fromQuiet ? 'hi' : ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
      mode = 'choosing';
      stepAt = now;
      return;
    }
    preview = ORDER[(ORDER.indexOf(preview) + 1) % ORDER.length];
    stepAt = now;
  }

  function sideHeld(now) {
    if (k1.down || frozen) return;
    if (mode === 'choosing') commit(now);
    else if (mode === 'look') stepAt = now;
    else if (mode === 'rest' || mode === 'result') step(now);
  }

  function tick(now) {
    if (link.up) {
      if (now - link.heard > DEAF_MS) { out.push('DROP'); closed(now); }
      else if (now - link.asked >= PING_EVERY_MS) { link.asked = now; send({ t: 'ping' }); }
    }
    if (k1.down && !k1.fired && now - k1.since >= HOLD_MS) { k1.fired = true; hold(now); }
    if (k2.down && !k2.fired && now - k2.since >= HOLD_MS) { k2.fired = true; sideHeld(now); }
    if (quiet.pending && !quiet.sent && link.up) { send({ t: 'hold' }); quiet.sent = true; quiet.at = now; }
    if (quiet.pending && quiet.sent && now - quiet.at >= QUIET_CONFIRM_MS) quiet.pending = false;
    if (mode === 'look' && now - stepAt >= CHOOSE_MS) rest();
    else if (mode === 'choosing' && !frozen) {
      if (!fromQuiet && now - stepAt >= COMMIT_MS) commit(now);
      else if (fromQuiet && now - stepAt >= CHOOSE_MS) rest();
    } else if (mode === 'sending' && now - sentAt >= CONFIRM_MS) {
      result(now, 'NOT SENT');
      if (link.up) { out.push('DROP'); closed(now); }
      if (fromQuiet) { quiet.pending = true; quiet.sent = false; }
    } else if (mode === 'result' && now >= resultUntil) rest();
  }

  function keyDown(k, now) {
    const s = k === 1 ? k1 : k2;
    if (s.down) return;
    s.down = true;
    s.since = now;
    s.fired = false;
    if (k === 1 && (mode === 'look' || mode === 'choosing')) frozen = true;
  }

  function keyUp(k, now) {
    const s = k === 1 ? k1 : k2;
    if (!s.down) return;
    s.down = false;
    if (s.fired) return;
    if (k === 2) { step(now); return; }
    if (frozen) rest();
    wakeUntil = now + WAKE_MS;
  }

  function linkUp(now) {
    if (stale(now)) show = null;
    link.up = true;
    link.ever = true;
    link.heard = now;
    link.asked = now;
    const hello = { t: 'wristband', id, key, v: 2 };
    if (secret) hello.secret = secret;
    if (quiet.pending) { hello.quiet = true; quiet.sent = true; quiet.at = now; }
    if (battery >= 0) hello.battery = battery;
    send(hello);
  }

  function frame(text, now) {
    link.heard = now;
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'paired' && typeof m.secret === 'string') { secret = m.secret; return; }
    if (m.t === 'set' && m.ok === false) {
      if (mode === 'sending') result(now, m.why === 'changed' ? 'CHANGED' : 'NOT SENT');
      return;
    }
    if (m.t !== 'show' || !m.show || typeof m.show !== 'object') return;
    show = readShow(m.show);
    if (show.kind === 'pairing') secret = '';
    if (quiet.pending && quiet.sent && !lit(show)) quiet.pending = false;
    if (mode === 'look' || mode === 'choosing') {
      if (!personal() || show.rev !== basis) rest();
    } else if (mode === 'sending' && personal() && show.rev > basis && show.armed === choice && !show.quiet) {
      result(now, 'SET');
    }
  }

  /** The face at rest: band_logic.h faceFor(), wordsFor() and lightFor(), in that order. */
  function restFace(now, awake) {
    const offline = stale(now);
    // NOT NOW from the wrist is dark before the relay has heard it; a relay out of reach is not believed.
    const s = quiet.pending ? { ...readShow({}), quiet: true } : offline || !show ? readShow({}) : show;
    let big = '';
    let small = '';
    if (s.kind === 'pairing') big = s.code;
    else if (s.kind === 'check') { big = s.big; small = 'ON YOUR PHONE?'; }
    else if (s.kind === 'waiting') { big = 'OPEN YOUR PHONE'; small = 'OR SWITCH ME OFF'; }
    else if (lit(s)) { big = s.big; small = s.small.toUpperCase(); }
    else if (s.kind === 'off' && awake) {
      if (offline) ({ big, small } = noSignal());
      else if (s.quiet) { big = 'NOT NOW'; small = pct(); }
      else if (s.away) { big = 'OPEN YOUR PHONE'; small = 'TO COME BACK'; }
      else { big = 'READY'; small = pct(); }
    }
    const light = s.kind === 'test' ? LIGHT_FULL
      : lit(s) ? (s.dim ? LIGHT_DIM : LIGHT_FULL)
      : s.kind === 'pairing' || s.kind === 'check' ? LIGHT_PAIR
      : s.kind === 'waiting' || awake ? LIGHT_AWAKE : LIGHT_OFF;
    return {
      big, small, light, bar: -1,
      field: s.kind === 'test' ? 'white' : lit(s) ? s.intent : 'black',
      ink: s.kind === 'test' || lit(s) ? 'ink' : s.kind === 'pairing' || s.kind === 'check' ? 'white' : 'text2',
      code: s.kind === 'pairing' ? s.code : '',
    };
  }

  function face(now) {
    let f;
    if (mode === 'look') {
      const cur = current();
      if (!link.up) f = noSignal();
      else if (cur === 'notnow') f = words('NOT NOW', 'SIDE TO CHANGE', 'black', 'text2', LIGHT_AWAKE);
      else if (cur === 'off') f = words('READY', 'SIDE TO CHANGE', 'black', 'text2', LIGHT_AWAKE);
      else f = words(CARD_WORDS[cur], 'SIDE TO CHANGE', cur, 'ink', LIGHT_FULL);
    } else if (mode === 'choosing' || mode === 'sending') {
      const small = mode === 'sending' ? 'SENDING' : fromQuiet ? 'HOLD SIDE TO SHOW' : 'SIDE: NEXT';
      f = preview === 'off'
        ? words('OFF', small, 'black', 'text2', LIGHT_AWAKE)
        : words(CARD_WORDS[preview], small, 'black', preview, LIGHT_AWAKE);
    } else {
      f = restFace(now, wakeUntil > now || mode === 'result');
      if (mode === 'result') f = { ...f, small: word };
    }
    if (k1.down && !k1.fired && now - k1.since >= BAR_MS) {
      f = { ...f, small: 'KEEP HOLDING', bar: Math.min(99, Math.floor(((now - k1.since) * 100) / HOLD_MS)), light: Math.max(f.light, LIGHT_AWAKE) };
    }
    return f;
  }

  return {
    id,
    key,
    secret: () => secret,
    keyDown,
    keyUp,
    linkUp,
    linkDown: (now) => closed(now),
    heard: (now) => { link.heard = now; },
    frame,
    tick,
    setBattery: (level) => { battery = Number.isInteger(level) && level >= 0 && level <= 100 ? level : -1; },
    setWifi: (on) => { wifi = !!on; },
    /** Everything to send since the last take: frame text, or 'DROP' to drop the socket. */
    take: () => { const o = out; out = []; return o; },
    face,
  };
}
```

- [ ] **Step 5: Run to see it pass**

Run: `node --test tests/wrist.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ pass 22`, `ℹ fail 0`.

- [ ] **Step 6: Check the table holds the machine.** Not a relay guard, so not P1, but the same move, run once each and restored: delete `if (fromQuiet) { quiet.pending = true; quiet.sent = false; }` ⇒ `NOT SENT leaving NOT NOW holds NOT NOW again…` goes red; `if (k1.down || frozen || mode === 'sending') return;` → `if (k1.down || mode === 'sending') return;` ⇒ `KEY1 down two seconds into a choice freezes it…` goes red; `if (!personal() || show.rev !== basis) rest();` → `if (!personal()) rest();` ⇒ `a show with a new rev, or one not about the person, cancels a choice` goes red.

- [ ] **Step 7: Full suite, commit**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add app/lib/wrist.js tests/wrist-table.js tests/fixtures/wrist-cases.json tests/wrist.test.js
git commit -m "Write the wrist's two-button machine once in JavaScript, held to one table of cases"
```

### Task 19: The firmware reads armed, rev, null, integers, and set refusals

**Files:**
- Modify: `firmware/src/band_logic.h` (`Show`, `json::Reader`, `Frame`, `readFrame`), `firmware/host/logic_test.cpp` (`frames()`, the `show` verb), `tests/firmware.test.js`

**Interfaces:**
- Produces (C++): `Show::{away, hasArmed, armed, rev}` (`rev` is `int64_t`); `json::Reader::null()`, `json::Reader::integer(int64_t& out, bool& whole)`; `Frame::{hasOk, ok, hasSecret, secret}`.
- Produces (host): the `show` verb's JSON gains `"hasArmed"`, `"armed"`, `"rev"`.

- [ ] **Step 1: Write the failing checks.** In `logic_test.cpp`'s `frames()`, before `// Not one whole object: refused.`:

```cpp
  // What the wrist chooses from: what is armed (null is not the same as nothing said) and the rev.
  s = parsed(R"j({"t":"show","show":{"kind":"off","battery":62,"armed":null,"rev":41}})j");
  CHECK(s.hasArmed && s.armed.empty() && s.rev == 41);
  s = parsed(R"j({"t":"show","show":{"kind":"hi","intent":"hi","armed":"hi","rev":9007199254740991}})j");
  CHECK(s.hasArmed && s.armed == "hi" && s.rev == 9007199254740991LL);
  s = parsed(R"j({"t":"show","show":{"kind":"pairing","code":"KXRT"}})j");
  CHECK(!s.hasArmed && s.rev == 0);
  s = parsed(R"j({"t":"show","show":{"armed":7,"rev":"3","kind":""}})j");
  CHECK(!s.hasArmed && s.rev == 0 && s.kind == "off");
  s = parsed(R"j({"t":"show","show":{"armed":"hi","rev":2.5}})j");
  CHECK(s.rev == 0);
  Frame no;
  CHECK(readFrame(R"j({"t":"set","ok":false,"why":"changed"})j", no) && no.hasOk && !no.ok && no.why == "changed");
```

In `tests/firmware.test.js`'s round trip, the `got` expectation becomes:

```js
      assert.deepEqual(got, {
        kind: s.kind, intent: s.intent ?? '', big: s.big ?? '', small: (s.small ?? '').toWellFormed(), code: s.code ?? '',
        dim: !!s.dim, quiet: !!s.quiet, away: !!s.away, hasArmed: 'armed' in s, armed: s.armed ?? '', rev: s.rev ?? 0,
        lit: ['hi', 'song', 'dance', 'meet'].includes(s.kind) && !!HUE[s.intent],
      }, text);
```

- [ ] **Step 2: Run to see them fail**

Run: `npm run build >/dev/null && node --test tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: the host build fails (`Show` has no `hasArmed`), so every firmware test fails.

- [ ] **Step 3: Implement in `band_logic.h`.** `Show` becomes:

```cpp
struct Show {
  std::string kind = "off";  // pairing | check | waiting | test | hi | song | dance | meet | off
  std::string intent, big, small, code;
  bool dim = false;
  bool quiet = false;
  bool away = false;      // paired, but its person is not in a room
  bool hasArmed = false;  // a show about the person says what is armed, even when that is nothing
  std::string armed;      // hi | song | dance, or empty for none
  int64_t rev = 0;        // the state it was made from: a choice names it back as its basis
  bool operator==(const Show& o) const {
    return kind == o.kind && intent == o.intent && big == o.big && small == o.small && code == o.code &&
           dim == o.dim && quiet == o.quiet && away == o.away && hasArmed == o.hasArmed && armed == o.armed &&
           rev == o.rev;
  }
  bool operator!=(const Show& o) const { return !(*this == o); }
};
```

`json::Reader` gains, just before `/** true or false; anything else is not a boolean. */`:

```cpp
  /** null. */
  bool null() { return literal("null"); }

  /**
   * A number, read. `whole` says whether it was a whole number small enough
   * to keep, and only then is `out` set.
   */
  bool integer(int64_t& out, bool& whole) {
    space();
    const size_t from = i_;
    if (!number()) return false;
    const std::string text = s_.substr(from, i_ - from);
    whole = text.find_first_of(".eE") == std::string::npos && text.size() <= 16;
    if (whole) out = std::strtoll(text.c_str(), nullptr, 10);
    return true;
  }
```

and `Frame` and `readFrame` (everything from `/** A frame from the relay…` to the end of `readFrame`) become:

```cpp
/** A frame from the relay: its type, and the show, the reason, the answer or the secret it carries. */
struct Frame {
  std::string t;
  bool hasShow = false;
  Show show;
  std::string why;
  bool hasOk = false;      // {t:'set', ok:false, why}: the relay refused a choice
  bool ok = true;
  bool hasSecret = false;  // {t:'paired', secret}: given on YES, kept in RAM only
  std::string secret;
};

/**
 * Reads one frame. A field of the wrong type is left at its default rather
 * than refusing the frame; text that is not one whole JSON object is refused.
 */
inline bool readFrame(const std::string& text, Frame& f) {
  json::Reader r(text);
  auto text_ = [&r](std::string& out, size_t cap) {
    if (!r.peek('"')) return r.skip();
    std::string v;
    if (!r.string(&v, cap)) return false;
    out = v;
    return true;
  };
  auto flag = [&r](bool& out) { return (r.peek('t') || r.peek('f')) ? r.boolean(out) : r.skip(); };
  const bool ok = r.object([&](const std::string& key) {
    if (key == "t") return text_(f.t, 32);
    if (key == "why") return text_(f.why, 64);
    if (key == "ok") {
      if (!r.peek('t') && !r.peek('f')) return r.skip();
      f.hasOk = true;
      return r.boolean(f.ok);
    }
    if (key == "secret") {
      if (!r.peek('"')) return r.skip();
      f.hasSecret = true;
      return text_(f.secret, 32);
    }
    if (key != "show") return r.skip();
    if (!r.peek('{')) return r.skip();
    f.hasShow = true;
    Show s;
    const bool read = r.object([&](const std::string& k) {
      if (k == "kind") return text_(s.kind, 16);
      if (k == "intent") return text_(s.intent, 16);
      if (k == "big") return text_(s.big, 64);
      if (k == "small") return text_(s.small, 128);
      if (k == "code") return text_(s.code, 8);
      if (k == "dim") return flag(s.dim);
      if (k == "quiet") return flag(s.quiet);
      if (k == "away") return flag(s.away);
      if (k == "armed") {
        // null says "nothing armed", which is not the same as not saying.
        if (r.peek('n')) {
          s.hasArmed = true;
          s.armed.clear();
          return r.null();
        }
        if (!r.peek('"')) return r.skip();
        s.hasArmed = true;
        return text_(s.armed, 16);
      }
      if (k == "rev") {
        int64_t v = 0;
        bool whole = false;
        if (!r.integer(v, whole)) return r.skip();
        s.rev = whole ? v : 0;
        return true;
      }
      return r.skip();
    });
    if (s.kind.empty()) s.kind = "off";
    f.show = s;
    return read;
  });
  r.space();
  return ok && r.at() == text.size();
}
```

(`main.cpp` from Task 9 reads `!f.secret.empty()`, which still holds.) In `logic_test.cpp`'s `show` verb, the part from `",\"quiet\":"` to `",\"lit\":"` becomes:

```cpp
           ",\"quiet\":" + (s.quiet ? "true" : "false") + ",\"away\":" + (s.away ? "true" : "false") +
           ",\"hasArmed\":" + (s.hasArmed ? "true" : "false") + ",\"armed\":" + quote(s.armed) +
           ",\"rev\":" + std::to_string(s.rev) + ",\"lit\":"
```

- [ ] **Step 4: Run to see them pass**

Run: `npm run build >/dev/null && node --test tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ fail 0` — the round trip now holds every show the relay sent against what the firmware read, `armed` and `rev` included.

- [ ] **Step 5: Both firmware envs build, then commit**

```bash
"C:/Users/LewisDong/.platformio/penv/Scripts/pio.exe" run -d firmware -e m5stickc -e m5sticks3 2>&1 | grep -E "SUCCESS|FAILED|error:"
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add firmware/src/band_logic.h firmware/host/logic_test.cpp tests/firmware.test.js
git commit -m "Read what is armed, the rev, null and whole numbers, and a refused set, on the wrist"
```

### Task 20: The `Wrist` in C++, on the same table

**Files:**
- Modify: `firmware/src/band_logic.h` (the timings; `cardWords`, `Screen`, `Wrist`), `firmware/host/logic_test.cpp` (`button()` on named constants, `wrist()`, `runWrist()`, the `consts` verb), `tests/firmware.test.js`

**Interfaces:**
- Consumes: `Link`, `Quiet`, `faceFor`, `wordsFor`, `lightFor`, `idFor`, `helloFrame`, `readFrame`, `HOLD_FRAME`, `PING_FRAME`.
- Produces (C++): `WAKE_MS = 6000`, `HOLD_MS = 1500`, `BAR_MS = 300`, `CHOOSE_MS = 6000`, `COMMIT_MS = 3000`, `CONFIRM_MS = 10000`, `RESULT_MS = 3000`; `cardWords(intent)`; `struct Screen { big, small, field, ink, light, bar, code }`; `class Wrist { Wrist(key); id(); secret(); up(); setBattery(int); setWifi(bool); heard(now); take(); keyDown(k, now); keyUp(k, now); linkUp(now); linkDown(now); frame(text, now); tick(now); face(now) const; }`.
- Produces (host): `logic_test wrist` (the table's line protocol on stdin); the `consts` speak verb.
- Keeps: `Button` stays until `main.cpp` moves onto the `Wrist` (Task 21), so every commit still builds for both wristbands; its check is rewritten on the named constants.

- [ ] **Step 1: Write the failing tests** — in `tests/firmware.test.js`, import `{ CONSTS } from '../app/lib/wrist.js'` and `{ TABLE, lines, check } from './wrist-table.js'`, and add:

```js
test('the firmware and the stand-in keep the same constants, by name', { skip }, () => {
  const [consts] = speak(['consts']);
  assert.deepEqual(JSON.parse(consts), CONSTS);
});

// The stand-in's table of cases (tests/wrist.test.js), run through band_logic.h's Wrist.
for (const c of TABLE.cases) {
  test('band_logic.h: ' + c.name, { skip }, () => {
    if (broken) throw broken;
    const protocol = lines(c, CONSTS);
    const r = spawnSync(bin, ['wrist'], { input: protocol.map((p) => p.line).join('\n') + '\n', encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    check(c, protocol, r.stdout.split(/\r?\n/).slice(0, -1).map((l) => JSON.parse(l)), CONSTS);
  });
}
```

In `logic_test.cpp`, `button()` is rewritten on the named constants (its timings are the spec's now):

```cpp
void button() {
  Button b;
  CHECK(b.update(false, 0) == Button::NONE);
  CHECK(b.update(true, 100) == Button::NONE);
  CHECK(b.update(true, 100 + HOLD_MS - 1) == Button::NONE);
  CHECK(b.update(false, 100 + HOLD_MS - 1) == Button::WAKE);  // let go before HOLD_MS: a press
  CHECK(b.update(true, 5000) == Button::NONE);
  CHECK(b.update(true, 5000 + HOLD_MS) == Button::HOLD);  // held: NOT NOW, while still held
  CHECK(b.update(true, 9000) == Button::NONE);            // once
  CHECK(b.update(false, 9001) == Button::NONE);           // and letting go is not also a wake
  // Across the millisecond counter wrapping, after 49 days on.
  CHECK(b.update(true, 0xFFFFFE00u) == Button::NONE);
  CHECK(b.update(true, 0xFFFFFE00u + HOLD_MS) == Button::HOLD);
}
```

and a `wrist()` check, called from `main()` after `button()`:

```cpp
void wrist() {
  // The table of cases (tests/fixtures/wrist-cases.json) runs through `logic_test wrist`.
  // Here, only what a table in milliseconds cannot reach: the counter wrapping after 49 days.
  Wrist w("000102030405060708090a0b0c0d0e0f");
  CHECK(w.id() == idFor("000102030405060708090a0b0c0d0e0f"));
  const uint32_t t0 = 0xFFFFFE00u;
  w.linkUp(t0);
  w.frame("{\"t\":\"show\",\"show\":{\"kind\":\"off\",\"armed\":null,\"rev\":1}}", t0);
  w.take();
  w.keyDown(1, t0);
  w.tick(t0 + HOLD_MS - 1);
  CHECK(w.take().empty() && w.face(t0 + HOLD_MS - 1).small == "KEEP HOLDING");
  w.tick(t0 + HOLD_MS);  // past zero
  const std::vector<std::string> sent = w.take();
  CHECK(sent.size() == 1 && sent[0] == HOLD_FRAME);
}
```

- [ ] **Step 2: Run to see them fail**

Run: `npm run build >/dev/null && node --test tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: the host build fails (`Wrist` is not declared).

- [ ] **Step 3: The timings.** In `band_logic.h`, replace the `HOLD_MS` and `WAKE_MS` lines with:

```cpp
constexpr uint32_t WAKE_MS = 6000;            // a KEY1 press shows the face this long
constexpr uint32_t HOLD_MS = 1500;            // held this long: NOT NOW on KEY1, "send now" on KEY2
constexpr uint32_t BAR_MS = 300;              // a KEY1 hold shows KEEP HOLDING from here
constexpr uint32_t CHOOSE_MS = 6000;          // longest wait for the next KEY2 press before a choice is dropped
constexpr uint32_t COMMIT_MS = 3000;          // after the last KEY2 step, the choice is sent (not from NOT NOW)
constexpr uint32_t CONFIRM_MS = 10000;        // longest wait for the relay to show a sent choice
constexpr uint32_t RESULT_MS = 3000;          // SET / NOT SENT / CHANGED stays on the face this long
```

- [ ] **Step 4: The `Wrist`.** Add `#include <algorithm>` to `band_logic.h`'s includes, and insert, just before `// ---------- the serial console ----------`:

```cpp
// ---------- the wrist: both buttons, the chooser, and the line to the relay ----------
//
// The same machine as app/lib/wrist.js, line for line, and held to the same
// table of cases (tests/fixtures/wrist-cases.json). It takes key downs and
// ups, the link coming and going, the relay's frames and the time, and gives
// back the frames to send and the screen to draw. main.cpp only feeds it.

/** The words each card shows, as relay/band.js bandShow() sends them. A preview draws these. */
inline const char* cardWords(const std::string& intent) {
  if (intent == "hi") return "HI :)";
  if (intent == "song") return "FIRST SONG?";
  if (intent == "dance") return "LET'S DANCE!";
  return "";
}

/** What the screen shows: two lines on one field, the backlight, the KEEP HOLDING bar, and letters to draw with their QR. */
struct Screen {
  std::string big, small;
  std::string field = "black";  // black | white | hi | song | dance
  std::string ink = "text2";    // ink | text2 | white | hi | song | dance
  uint8_t light = LIGHT_OFF;
  int bar = -1;                 // 0..99 while KEY1 is held past BAR_MS; -1 otherwise
  std::string code;             // the pairing letters
};

class Wrist {
 public:
  explicit Wrist(const std::string& key) : key_(key), id_(idFor(key)) {}

  const std::string& id() const { return id_; }
  const std::string& secret() const { return secret_; }
  bool up() const { return link_.up(); }

  void setBattery(int level) { battery_ = level >= 0 && level <= 100 ? level : -1; }
  void setWifi(bool on) { wifi_ = on; }
  /** The relay answered a ping, or anything else was heard. */
  void heard(uint32_t now) { link_.heard(now); }

  /** Everything to send since the last take: frame text, or "DROP" to drop the socket. */
  std::vector<std::string> take() {
    std::vector<std::string> o;
    o.swap(out_);
    return o;
  }

  void keyDown(int k, uint32_t now) {
    Key& s = k == 1 ? k1_ : k2_;
    if (s.down) return;
    s.down = true;
    s.since = now;
    s.fired = false;
    // Any KEY1 press-down freezes a choice at once: no commit can fire.
    if (k == 1 && (mode_ == LOOK || mode_ == CHOOSING)) frozen_ = true;
  }

  void keyUp(int k, uint32_t now) {
    Key& s = k == 1 ? k1_ : k2_;
    if (!s.down) return;
    s.down = false;
    if (s.fired) return;
    if (k == 2) {
      step(now);
      return;
    }
    if (frozen_) rest();
    wakeUntil_ = now + WAKE_MS;
  }

  void linkUp(uint32_t now) {
    if (link_.stale(now)) haveShow_ = false;
    link_.opened(now);
    // A hold not yet heard rides on the hello: the relay applies it before anything else.
    const bool quiet = quiet_.dark();
    if (quiet) quiet_.sent(now);
    out_.push_back(helloFrame(id_, key_, battery_, secret_, quiet));
  }

  void linkDown(uint32_t now) { closed(now); }

  void frame(const std::string& text, uint32_t now) {
    link_.heard(now);
    Frame f;
    if (!readFrame(text, f)) return;
    if (f.t == "paired" && f.hasSecret) {
      secret_ = f.secret;
      return;
    }
    if (f.t == "set" && f.hasOk && !f.ok) {
      if (mode_ == SENDING) result(now, f.why == "changed" ? "CHANGED" : "NOT SENT");
      return;
    }
    if (f.t != "show" || !f.hasShow) return;
    show_ = f.show;
    haveShow_ = true;
    if (show_.kind == "pairing") secret_.clear();  // unpaired, or nobody came for it: a new pairing
    quiet_.shown(show_);
    if (mode_ == LOOK || mode_ == CHOOSING) {
      // A show not about the person, or one whose rev moved, cancels the choice.
      if (!personal() || show_.rev != basis_) rest();
    } else if (mode_ == SENDING && personal() && show_.rev > basis_ && show_.armed == choice_ && !show_.quiet) {
      result(now, "SET");
    }
  }

  void tick(uint32_t now) {
    switch (link_.tick(now)) {
      case Link::DROP:
        out_.push_back("DROP");
        closed(now);
        break;
      case Link::PING:
        out_.push_back(PING_FRAME);
        break;
      default:
        break;
    }
    if (k1_.down && !k1_.fired && now - k1_.since >= HOLD_MS) {
      k1_.fired = true;
      hold(now);
    }
    if (k2_.down && !k2_.fired && now - k2_.since >= HOLD_MS) {
      k2_.fired = true;
      sideHeld(now);
    }
    if (quiet_.due(link_.up())) {
      out_.push_back(HOLD_FRAME);
      quiet_.sent(now);
    }
    quiet_.tick(now);
    if (mode_ == LOOK && now - stepAt_ >= CHOOSE_MS) {
      rest();
    } else if (mode_ == CHOOSING && !frozen_) {
      if (!fromQuiet_ && now - stepAt_ >= COMMIT_MS) commit(now);
      else if (fromQuiet_ && now - stepAt_ >= CHOOSE_MS) rest();
    } else if (mode_ == SENDING && now - sentAt_ >= CONFIRM_MS) {
      result(now, "NOT SENT");
      // Drop the socket: a set stuck in it can no longer land, and the next hello's show is the truth.
      if (link_.up()) {
        out_.push_back("DROP");
        closed(now);
      }
      // Hiding may arrive late; showing may not. Leaving NOT NOW failed, so hold it again.
      if (fromQuiet_) quiet_.held();
    } else if (mode_ == RESULT && static_cast<int32_t>(now - resultUntil_) >= 0) {
      rest();
    }
  }

  Screen face(uint32_t now) const {
    Screen f;
    if (mode_ == LOOK) {
      const std::string cur = current();
      if (!link_.up()) f = noSignal();
      else if (cur == "notnow") f = words("NOT NOW", "SIDE TO CHANGE", "black", "text2", LIGHT_AWAKE);
      else if (cur == "off") f = words("READY", "SIDE TO CHANGE", "black", "text2", LIGHT_AWAKE);
      else f = words(cardWords(cur), "SIDE TO CHANGE", cur, "ink", LIGHT_FULL);
    } else if (mode_ == CHOOSING || mode_ == SENDING) {
      const char* small = mode_ == SENDING ? "SENDING" : fromQuiet_ ? "HOLD SIDE TO SHOW" : "SIDE: NEXT";
      f = preview_ == "off" ? words("OFF", small, "black", "text2", LIGHT_AWAKE)
                            : words(cardWords(preview_), small, "black", preview_, LIGHT_AWAKE);
    } else {
      f = restFace(now, static_cast<int32_t>(wakeUntil_ - now) > 0 || mode_ == RESULT);
      if (mode_ == RESULT) f.small = word_;
    }
    if (k1_.down && !k1_.fired && now - k1_.since >= BAR_MS) {
      f.small = "KEEP HOLDING";
      f.bar = std::min<int>(99, static_cast<int>((now - k1_.since) * 100 / HOLD_MS));
      if (f.light < LIGHT_AWAKE) f.light = LIGHT_AWAKE;
    }
    return f;
  }

 private:
  enum Mode { REST, LOOK, CHOOSING, SENDING, RESULT };
  struct Key {
    bool down = false;
    bool fired = false;
    uint32_t since = 0;
  };

  static Screen words(const std::string& big, const std::string& small, const std::string& field, const std::string& ink,
                      uint8_t light) {
    Screen s;
    s.big = big;
    s.small = small;
    s.field = field;
    s.ink = ink;
    s.light = light;
    return s;
  }

  bool personal() const { return haveShow_ && show_.hasArmed; }

  /** NOT NOW (a hold not yet shown, or the relay's quiet), else what is armed, else "off". */
  std::string current() const {
    if (quiet_.dark() || (haveShow_ && show_.quiet)) return "notnow";
    return haveShow_ && !show_.armed.empty() ? show_.armed : "off";
  }

  std::string pct() const { return battery_ >= 0 ? std::to_string(battery_) + "%" : ""; }

  Screen noSignal() const {
    const std::string why = wifi_ ? "NO RELAY" : "NO WI-FI";
    return words("NO SIGNAL", pct().empty() ? why : why + " - " + pct(), "black", "text2", LIGHT_AWAKE);
  }

  /** The face at rest: faceFor(), wordsFor() and lightFor(), as the relay's show has it. */
  Screen restFace(uint32_t now, bool awake) const {
    const Face f = faceFor(haveShow_ ? &show_ : nullptr, link_.stale(now), quiet_.dark());
    const Signal signal = !wifi_ ? Signal::NO_WIFI : link_.up() ? Signal::LIVE : Signal::NO_RELAY;
    const Words w = wordsFor(f, awake, battery_, signal);
    const Show& s = f.show;
    Screen out;
    out.big = w.big;
    out.small = w.small;
    out.light = lightFor(f, awake);
    out.field = s.kind == "test" ? "white" : lit(s) ? s.intent : "black";
    out.ink = s.kind == "test" || lit(s) ? "ink" : s.kind == "pairing" || s.kind == "check" ? "white" : "text2";
    if (s.kind == "pairing") out.code = s.code;
    return out;
  }

  void rest() {
    mode_ = REST;
    frozen_ = false;
    preview_.clear();
    word_.clear();
  }

  void closed(uint32_t now) {
    link_.closed(now);
    quiet_.closed();
  }

  void hold(uint32_t now) {
    quiet_.held();
    rest();
    wakeUntil_ = now;
  }

  void result(uint32_t now, const char* w) {
    mode_ = RESULT;
    word_ = w;
    resultUntil_ = now + RESULT_MS;
    preview_.clear();
    frozen_ = false;
  }

  void commit(uint32_t now) {
    if (frozen_) return;
    // "In force" is checked again: a preview equal to what is armed sends nothing.
    if (preview_ == current() || !link_.up()) {
      rest();
      return;
    }
    choice_ = preview_ == "off" ? "" : preview_;
    out_.push_back("{\"t\":\"set\",\"intent\":" + (choice_.empty() ? std::string("null") : "\"" + choice_ + "\"") +
                   ",\"basis\":" + std::to_string(basis_) + "}");
    mode_ = SENDING;
    sentAt_ = now;
  }

  static std::string after(const std::string& card) {
    if (card == "hi") return "song";
    if (card == "song") return "dance";
    if (card == "dance") return "off";
    return "hi";
  }

  /** A KEY2 press let go before HOLD_MS. */
  void step(uint32_t now) {
    if (k1_.down || frozen_ || mode_ == SENDING) return;
    if (mode_ == RESULT) rest();
    if (mode_ == REST) {
      wakeUntil_ = now + WAKE_MS;
      if (!personal()) return;  // not about the person: KEY2 only wakes
      mode_ = LOOK;
      stepAt_ = now;
      basis_ = show_.rev;
      return;
    }
    if (!link_.up()) return;  // offline, KEY2 changes nothing
    if (mode_ == LOOK) {
      const std::string cur = current();
      fromQuiet_ = cur == "notnow";
      preview_ = fromQuiet_ ? "hi" : after(cur);
      mode_ = CHOOSING;
      stepAt_ = now;
      return;
    }
    preview_ = after(preview_);
    stepAt_ = now;
  }

  /** KEY2 held for HOLD_MS: send now in a choice; with no preview yet, only wake. */
  void sideHeld(uint32_t now) {
    if (k1_.down || frozen_) return;
    if (mode_ == CHOOSING) commit(now);
    else if (mode_ == LOOK) stepAt_ = now;
    else if (mode_ == REST || mode_ == RESULT) step(now);
  }

  std::string key_, id_, secret_;
  int battery_ = -1;
  bool wifi_ = true;
  Link link_;
  Quiet quiet_;
  Show show_;
  bool haveShow_ = false;
  Key k1_, k2_;
  Mode mode_ = REST;
  std::string preview_, choice_, word_;
  bool fromQuiet_ = false, frozen_ = false;
  uint32_t wakeUntil_ = 0, stepAt_ = 0, sentAt_ = 0, resultUntil_ = 0;
  int64_t basis_ = 0;
  std::vector<std::string> out_;
};
```

- [ ] **Step 5: The host binary speaks the table.** In `logic_test.cpp`: `#include <memory>` and `#include <sstream>`; the `consts` verb in `answer()`, before `hues`:

```cpp
  if (c.verb == "consts") {
    // Every constant the table's times are written in, by name, as app/lib/wrist.js CONSTS has them.
    return "{\"WAKE_MS\":" + std::to_string(WAKE_MS) + ",\"HOLD_MS\":" + std::to_string(HOLD_MS) +
           ",\"BAR_MS\":" + std::to_string(BAR_MS) + ",\"CHOOSE_MS\":" + std::to_string(CHOOSE_MS) +
           ",\"COMMIT_MS\":" + std::to_string(COMMIT_MS) + ",\"CONFIRM_MS\":" + std::to_string(CONFIRM_MS) +
           ",\"RESULT_MS\":" + std::to_string(RESULT_MS) + ",\"PING_EVERY_MS\":" + std::to_string(PING_EVERY_MS) +
           ",\"DEAF_MS\":" + std::to_string(DEAF_MS) + ",\"STALE_MS\":" + std::to_string(STALE_MS) +
           ",\"QUIET_CONFIRM_MS\":" + std::to_string(QUIET_CONFIRM_MS) + ",\"LIGHT_FULL\":" + std::to_string(LIGHT_FULL) +
           ",\"LIGHT_DIM\":" + std::to_string(LIGHT_DIM) + ",\"LIGHT_PAIR\":" + std::to_string(LIGHT_PAIR) +
           ",\"LIGHT_AWAKE\":" + std::to_string(LIGHT_AWAKE) + ",\"LIGHT_OFF\":" + std::to_string(LIGHT_OFF) +
           ",\"CARD_WORDS\":{\"hi\":" + quote(cardWords("hi")) + ",\"song\":" + quote(cardWords("song")) +
           ",\"dance\":" + quote(cardWords("dance")) + "}}";
  }
```

`runWrist()` at the end of the anonymous namespace:

```cpp
/**
 * `logic_test wrist`: the table's line protocol (tests/wrist-table.js). The
 * first line is `key <hex>`; every other line is `<t> <what>` and is answered
 * with one line: `{}` for `heard`, else what was sent and the screen.
 */
int runWrist() {
  std::unique_ptr<Wrist> w;
  std::string line;
  while (std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    std::istringstream in(line);
    std::string first, verb, arg;
    in >> first;
    if (first == "key") {
      in >> arg;
      w.reset(new Wrist(arg));
      continue;
    }
    if (!w) return 2;
    const uint32_t t = static_cast<uint32_t>(std::stoul(first));
    in >> verb;
    std::getline(in, arg);
    if (!arg.empty() && arg[0] == ' ') arg.erase(0, 1);
    if (verb == "heard") {
      w->heard(t);
      std::cout << "{}\n";
      continue;
    }
    w->tick(t);
    if (verb == "up") w->linkUp(t);
    else if (verb == "down") w->linkDown(t);
    else if (verb == "key1" || verb == "key2") {
      const int k = verb == "key1" ? 1 : 2;
      if (arg == "down") w->keyDown(k, t);
      else w->keyUp(k, t);
    }
    else if (verb == "frame") w->frame(arg, t);
    else if (verb == "battery") w->setBattery(std::atoi(arg.c_str()));
    else if (verb == "wifi") w->setWifi(arg == "1");
    std::string sent;
    for (const std::string& f : w->take()) sent += (sent.empty() ? "" : ",") + (f == "DROP" ? std::string("\"DROP\"") : f);
    const Screen s = w->face(t);
    std::cout << "{\"sent\":[" << sent << "],\"face\":{\"big\":" << quote(s.big) << ",\"small\":" << quote(s.small)
              << ",\"field\":" << quote(s.field) << ",\"ink\":" << quote(s.ink) << ",\"light\":" << int(s.light)
              << ",\"bar\":" << s.bar << ",\"code\":" << quote(s.code) << "}}\n";
  }
  return 0;
}
```

and, first in `main()`: `if (argc > 1 && std::string(argv[1]) == "wrist") return runWrist();`. The header comment gains `//   logic_test wrist      the wrist's table of cases (tests/wrist-table.js), one answer a line`.

- [ ] **Step 6: Run to see them pass**

Run: `npm run build >/dev/null && node --test tests/firmware.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `ℹ fail 0` — the constants test and one `band_logic.h: …` test per case.

- [ ] **Step 7: Check the table holds the port** (run once, restored, rebuilt): in `Wrist::tick`, delete `if (fromQuiet_) quiet_.held();` ⇒ exactly `band_logic.h: NOT SENT leaving NOT NOW holds NOT NOW again, in the next hello` goes red.

- [ ] **Step 8: Both envs build, full suite, commit, close the stage (P2)**

```bash
"C:/Users/LewisDong/.platformio/penv/Scripts/pio.exe" run -d firmware -e m5stickc -e m5sticks3 2>&1 | grep -E "SUCCESS|FAILED|error:"
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add firmware/src/band_logic.h firmware/host/logic_test.cpp tests/firmware.test.js
git commit -m "Port the wrist's machine to band_logic.h and run the same table against it"
git push origin main
```

The device still runs the one-button loop at this commit (with the new 1.5 s hold and 6 s wake); Task 21 moves it onto the `Wrist`.


## Stage F — Wiring: the real wristband and `/band` over the Wrist; the words

### Task 21: `main.cpp` only feeds the `Wrist` and draws

**Files:**
- Modify: `firmware/src/main.cpp`, `firmware/src/band_logic.h` (delete `Button`), `firmware/host/logic_test.cpp` (delete `button()`)

**Interfaces:**
- Consumes: `Wrist`, `Screen`, `makeKey`, `BatteryReport`, `batteryFrame`, `readFrame` (for logging only).
- Produces: KEY1 = `M5.BtnA` (the face button), KEY2 = `M5.BtnB` (the side button); `BtnPWR` is never read.

There is no host test for the hardware round; the proof is both envs building here and Task 26 on the band. Keep every decision in the `Wrist`: if something below starts to decide, it belongs in `band_logic.h` and the table.

- [ ] **Step 1: Delete `Button`.** In `band_logic.h`, the section from `// ---------- the one button ----------` to just before `// ---------- the line to the relay ----------`; in `logic_test.cpp`, `button()` and its call in `main()`.

- [ ] **Step 2: The globals.** Replace `Button button; Link net; Quiet quiet;`, `Show last;`, `bool haveShow = false;` and `uint32_t wakeUntil = 0;` with:

```cpp
Wrist* wrist = nullptr;  // made in setup(), once the radio is on and the key is truly random
bool keyA = false, keyB = false;  // KEY1 (BtnA, the face) and KEY2 (BtnB, the side), as last read
```

(`bandKey`, `bandId` and `secret` from Tasks 3 and 9 go too: the `Wrist` holds the key, the id and the secret.)

- [ ] **Step 3: The send queue carries drops too.** `sendFrame` from Task 9 becomes:

```cpp
std::vector<std::string> waitingOut;  // what the Wrist said to send, and the outbox could not take yet, oldest first

/** A frame to send, or "DROP" to drop the socket, in the order the Wrist said them. */
void sendFrame(const std::string& text) {
  waitingOut.push_back(text);
  while (!waitingOut.empty()) {
    const std::string& next = waitingOut.front();
    const bool taken = next == "DROP" ? toSocket(OUT_DROP) : toSocket(OUT_SEND, next);
    if (!taken) return;
    if (next == "DROP") Serial.println("the relay went quiet; trying again");
    else if (next == HOLD_FRAME) Serial.println("NOT NOW, from the wrist");
    waitingOut.erase(waitingOut.begin());
  }
}
```

- [ ] **Step 4: `drain()` feeds the Wrist.**

```cpp
void drain(uint32_t now) {
  Event e;
  while (xQueueReceive(events, &e, 0) == pdTRUE) {
    switch (e.kind) {
      case EV_OPENED:
        waitingOut.clear();
        wrist->linkUp(now);  // the hello is first in what the Wrist says next
        batteryReport.reset();
        if (battery >= 0) batteryReport.sent(battery, now);  // the hello carried it
        Serial.printf("on the relay: %s\n", relay.origin.c_str());
        break;
      case EV_CLOSED:
        if (wrist->up()) Serial.println("lost the relay");
        waitingOut.clear();
        wrist->linkDown(now);
        break;
      case EV_TEXT: {
        if (e.length > sizeof e.text) { wrist->heard(now); break; }  // too long to read, but heard
        const std::string text(e.text, e.length);
        wrist->frame(text, now);
        Frame f;
        if (readFrame(text, f) && f.t == "error") Serial.printf("the relay says: %s\n", f.why.c_str());
        break;
      }
      case EV_HEARD:
        wrist->heard(now);
        break;
      default:
        break;
    }
  }
}
```

`startRelay()`: `net.closed(millis()); quiet.closed();` becomes `if (wrist) wrist->linkDown(millis());`. `report()`: `net.up()` becomes `wrist->up()`.

- [ ] **Step 5: The screen draws a `Screen`.**

```cpp
uint16_t inkOf(const std::string& ink) {
  if (ink == "ink") return rgb565(INK);
  if (ink == "white") return WHITE;
  if (const Hue* h = hueFor(ink)) return rgb565(h->c);  // a preview: the card's words in its colour, on black
  return rgb565(TEXT_2);
}

void paint(const Screen& s) {
  const int W = face.width(), H = face.height();
  const float k = std::min(W / 135.0f, H / 240.0f);  // the canvas draws the wristband 135 x 240
  if (s.field == "white") {
    face.fillScreen(WHITE);
  } else if (const Hue* hue = hueFor(s.field)) {
    for (int y = 0; y < H; ++y)
      for (int x = 0; x < W; ++x) face.drawPixel(x, y, rgb565(glow(*hue, x, y, W, H)));
  } else {
    face.fillScreen(BLACK);
  }
  const uint16_t ink = inkOf(s.ink);
  const Words w{s.big, s.small};
  // A number — the meeting number, or the pairing check — stands large under its word.
  const bool number = !s.big.empty() && s.big.find_first_not_of("0123456789") == std::string::npos;
  if (!s.code.empty()) drawPairing(s.code, k);
  else if (number) drawMeet(w, ink, k);
  else if (!s.big.empty() || !s.small.empty()) drawWords(w, ink, k);
  if (s.bar >= 0) {  // KEEP HOLDING: how far to NOT NOW
    const int x = px(12, k), width = W - 2 * x, y = H - px(22, k), h = px(6, k);
    face.drawRect(x, y, width, h, ink);
    face.fillRect(x, y, width * s.bar / 99, h, ink);
  }
}

void draw(uint32_t now) {
  const Screen s = wrist->face(now);
  const std::string key = s.big + '|' + s.small + '|' + s.field + '|' + s.ink + '|' + std::to_string(s.light) + '|' +
                          std::to_string(s.bar) + '|' + s.code + '|' + relay.origin;
  if (key == drawn) return;
  drawn = key;
  paint(s);
  face.pushSprite(0, 0);
  M5.Display.setBrightness(s.light);
}
```

- [ ] **Step 6: `setup()` and `loop()`.** In `setup()`, replace the key lines from Task 3 with `wrist = new Wrist(makeKey([] { return static_cast<uint32_t>(esp_random()); }));` (keep `prefs.remove("id")`), and after `readBattery(millis());` add `wrist->setBattery(battery);`. `readBattery()` ends with `if (wrist) wrist->setBattery(battery);`. `loop()`:

```cpp
void loop() {
  M5.update();
  const uint32_t now = millis();
  console();
  readBattery(now);
  drain(now);
  // KEY1 is the face button, KEY2 the side one. The Wrist times the holds.
  const bool a = M5.BtnA.isPressed(), b = M5.BtnB.isPressed();
  if (a != keyA) { keyA = a; a ? wrist->keyDown(1, now) : wrist->keyUp(1, now); }
  if (b != keyB) { keyB = b; b ? wrist->keyDown(2, now) : wrist->keyUp(2, now); }
  wrist->setWifi(WiFi.status() == WL_CONNECTED);
  wrist->tick(now);
  for (const std::string& f : wrist->take()) sendFrame(f);
  if (wrist->up() && batteryReport.due(battery, now)) {
    sendFrame(batteryFrame(battery));
    batteryReport.sent(battery, now);
  }
  draw(now);
  delay(10);
}
```

- [ ] **Step 7: The header says what it is now.** `main.cpp`'s first paragraph:

```cpp
// ON THE BEAT — the wristband: an M5StickC Plus, Plus2 or StickS3 on a strap.
//
// A light first and words second. It joins the relay exactly as /band does,
// shows whatever the relay tells it to, and has two buttons. The face button
// (KEY1): a press wakes it, a hold is NOT NOW. The side button (KEY2): a press
// shows the card that is armed, more presses choose another, and the relay
// decides. What it shows is decided by the relay (relay/band.js), from the
// same view its person's phone is sent, so it can never show more than the
// phone could.
```

and the second paragraph's "the screen, the button, the battery" becomes "the screen, the two buttons, the battery".

- [ ] **Step 8: Both envs build**

Run: `"C:/Users/LewisDong/.platformio/penv/Scripts/pio.exe" run -d firmware -e m5stickc -e m5sticks3 2>&1 | grep -E "SUCCESS|FAILED|error:"`
Expected: two `SUCCESS`. Also `grep -n "net\.\|quiet\.\|button\.\|haveShow\|last\b" firmware/src/main.cpp` finds nothing left of the old loop.

- [ ] **Step 9: Full suite, commit**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add firmware/src/main.cpp firmware/src/band_logic.h firmware/host/logic_test.cpp
git commit -m "Run the wristband on the Wrist: face and side buttons, the bar, previews in their colour"
```

### Task 22: `/band` is a thin shell over `wrist.js`, with a SIDE button

**Files:**
- Modify: `app/screens/Band.jsx` (`WristFace`, `BandStandIn`), `app/styles.css`

**Interfaces:**
- Consumes: `createWrist`, `HOLD_MS`, `WAKE_MS` (Task 18); `toHex` (Task 3).
- Produces: `WristFace({ screen, scale = 2, pairAt })` draws a `face()` result; `BandFace` stays for the beacon screen's picture of a lit wristband (`Hi.jsx`).

- [ ] **Step 1: `WristFace`.** Add to `app/screens/Band.jsx`:

```jsx
const INK = { ink: '#041418', white: '#FFFFFF', text2: 'var(--text-2)' };

/** What the Wrist says to draw (app/lib/wrist.js face()): one field, two lines, the bar, and letters with their code. */
export function WristFace({ screen: s, scale = 2, pairAt = null }) {
  const hue = HUE[s.field];
  const bg = s.field === 'white' ? '#FFFFFF'
    : hue ? `radial-gradient(120% 90% at 50% 38%, ${hue.c} 0%, ${hue.g} 100%)` : '#000000';
  const ink = INK[s.ink] ?? HUE[s.ink]?.c ?? INK.text2;
  // The backlight: dark is off, not a black picture lit from behind.
  const glow = s.light ? Math.max(0.35, s.light / 255) : 0;
  const number = /^\d+$/.test(s.big);
  return (
    <div className="bandface" style={{ width: 135 * scale, height: 240 * scale, '--u': scale + 'px', background: bg, filter: `brightness(${glow})` }}
      role="img" aria-label={s.code ? 'Wristband showing its pairing letters ' + s.code.split('').join(' ') : s.light ? 'Wristband: ' + [s.big, s.small].filter(Boolean).join(', ') : 'Wristband dark'}>
      {s.code ? <Pairing code={s.code} at={pairAt} />
        : number ? <span className="words meet" style={{ color: ink }}><span className="small-w">{s.small}</span><span className="num">{s.big}</span></span>
        : s.big || s.small ? (
          <span className="words" style={{ color: ink }}>
            {s.big ? <span className="big">{s.big}</span> : null}
            {s.small ? <span className="small-w">{s.small}</span> : null}
          </span>
        ) : null}
      {s.bar >= 0 ? <span className="bandbar" style={{ '--p': s.bar / 99, color: ink }} aria-hidden="true" /> : null}
    </div>
  );
}
```

- [ ] **Step 2: `BandStandIn` over the Wrist.** Replace it (and the Task 3/9 socket code) with:

```jsx
/**
 * /band — a stand-in for the wristband, until one is in hand. The machine is
 * app/lib/wrist.js, the same one band_logic.h runs on the real band and held
 * to the same table; this page only feeds it the socket, the two buttons and
 * the time, and draws its face at 2x.
 */
export function BandStandIn() {
  // A new wristband every load, as the firmware is every boot: the key stays in this page, and the id is its hash.
  const wrist = useMemo(() => {
    try { localStorage.removeItem('otb:band-id'); } catch { /* a private window */ }
    return createWrist({ key: toHex(crypto.getRandomValues(new Uint8Array(16))) });
  }, []);
  const [battery, setBattery] = useState(62);
  const [screen, setScreen] = useState(() => wrist.face(Date.now()));
  const [live, setLive] = useState(false);
  const [down, setDown] = useState({ 1: false, 2: false });
  const ws = useRef(null);

  useEffect(() => {
    let closed = false, retry = null;
    // What the Wrist says to send goes out, a drop drops the socket, and the face is drawn again.
    const flush = () => {
      for (const f of wrist.take()) {
        if (f === 'DROP') ws.current?.close();
        else if (ws.current?.readyState === 1) ws.current.send(f);
      }
      setScreen(wrist.face(Date.now()));
    };
    const open = () => {
      const sock = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/ws');
      ws.current = sock;
      sock.onopen = () => { if (ws.current === sock) { setLive(true); wrist.linkUp(Date.now()); flush(); } };
      sock.onmessage = (e) => { if (ws.current === sock) { wrist.frame(String(e.data), Date.now()); flush(); } };
      sock.onclose = () => {
        if (ws.current !== sock) return;
        ws.current = null;
        setLive(false);
        wrist.linkDown(Date.now());
        flush();
        if (!closed) retry = setTimeout(open, 1500);
      };
    };
    open();
    const beat = setInterval(() => { wrist.tick(Date.now()); flush(); }, 50);
    return () => { closed = true; clearTimeout(retry); clearInterval(beat); const s = ws.current; ws.current = null; s?.close(); };
  }, [wrist]);

  useEffect(() => {
    wrist.setBattery(battery);
    if (ws.current?.readyState === 1) ws.current.send(JSON.stringify({ t: 'battery', level: battery }));
  }, [wrist, battery]);

  const key = (k, isDown) => {
    (isDown ? wrist.keyDown : wrist.keyUp)(k, Date.now());
    setDown((d) => ({ ...d, [k]: isDown }));
  };
  const handlers = (k) => ({
    onPointerDown: (e) => { e.currentTarget.setPointerCapture?.(e.pointerId); key(k, true); },
    onPointerUp: () => key(k, false),
    onPointerCancel: () => key(k, false),
    onKeyDown: (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); key(k, true); } },
    onKeyUp: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); key(k, false); } },
  });
  const hold = HOLD_MS / 1000 + ' s';
  const wake = WAKE_MS / 1000 + ' s';

  return (
    <div className="standin">
      <div className="strap" aria-hidden="true" />
      <div className="bandbody">
        <div className="bandrow">
          <WristFace screen={screen} pairAt={screen.code ? pairUrl(location.origin, screen.code) : null} />
          <button type="button" className={'bandside' + (down[2] ? ' down' : '')} {...handlers(2)}
            aria-label={'Side button. Press to see your card, press again to change it; hold ' + hold + ' to send it now, or to come back from NOT NOW.'}>SIDE</button>
        </div>
        <button type="button" className={'bandbtn' + (down[1] ? ' down' : '')} {...handlers(1)}
          aria-label={'Face button. Press to wake it for ' + wake + '; hold ' + hold + ' for NOT NOW.'} />
      </div>
      <div className="strap" aria-hidden="true" />
      <div className="operator">
        <span className="label" style={{ color: live ? 'var(--ok)' : 'var(--warn)' }}>{live ? 'on the relay' : 'looking for the relay…'}</span>
        <span className="small">
          A stand-in for the wristband — the real one is an M5StickC Plus or a StickS3 on a strap. The face button wakes
          it for {wake}; hold it {hold} for NOT NOW. SIDE shows your card, and more presses change it.
          Letters: {CODE_LETTERS.length} of them, none that look alike.
        </span>
        <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          battery <input type="range" min="1" max="100" value={battery} onChange={(e) => setBattery(Number(e.target.value))} aria-label="Stand-in battery" />
          <span className="tnum" style={{ color: '#fff', minWidth: 36 }}>{battery}%</span>
        </label>
      </div>
    </div>
  );
}
```

with imports `import { HOLD_MS, WAKE_MS, createWrist } from '../lib/wrist.js';` and `toHex` from `../lib/sha256.js` (drop `bandIdOf` if nothing else uses it). The Task 9 additions to `BandFace` stay: the beacon screen's picture still uses it.

- [ ] **Step 3: The styles.** In `app/styles.css`, after `.bandbtn:focus-visible`:

```css
.bandrow { display: flex; align-items: center; gap: 8px; }
.bandside { writing-mode: vertical-rl; width: 22px; height: 72px; border-radius: 11px; background: var(--ink-2); border: 1px solid var(--line); box-shadow: 3px 0 0 rgba(0,0,0,.7); color: var(--text-3); font: 700 9px/1 var(--sans); letter-spacing: .12em; touch-action: none; transition: transform var(--fast) var(--ease), box-shadow var(--fast) var(--ease); }
.bandside.down { transform: translateX(2px); box-shadow: 1px 0 0 rgba(0,0,0,.7); }
.bandside:focus-visible { outline: 2px solid var(--hi); outline-offset: 3px; }
.bandface .bandbar { position: absolute; left: calc(var(--u) * 12); right: calc(var(--u) * 12); bottom: calc(var(--u) * 16); height: calc(var(--u) * 6); border: 1px solid currentColor; border-radius: calc(var(--u) * 3); background: linear-gradient(90deg, currentColor calc(var(--p) * 100%), transparent 0); }
```

- [ ] **Step 4: Build and check in a browser.** `npm start` in the background; the seeded app and `/band` side by side. Resize the pane to 1280×800 first and reset it afterwards (`CLAUDE.md`). Browser-pane clicks can land off target, and a hold needs a real press duration, so drive the buttons from `javascript_tool` with pointer events, e.g. `const s = document.querySelector('.bandside'); s.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})); setTimeout(() => s.dispatchEvent(new PointerEvent('pointerup', {bubbles:true})), 100);`:
  - pair through the check (YES);
  - SIDE once: the face shows `READY` / `SIDE TO CHANGE`; SIDE again: `HI :)` in blue on black, `SIDE: NEXT`; wait 3 s: `SENDING`, then the blue field with `SET`; the phone toasts *Armed from your wristband: SAY HI* with NOT YOU? UNPAIR;
  - face button held 1.5 s: `KEEP HOLDING` and the bar, then dark; the phone is on the quiet screen;
  - SIDE, SIDE, then SIDE held 1.5 s: visible again with SAY HI; the phone toasts *Back on, from your wristband: SAY HI*;
  - `read_page` on `/band`: both buttons' labels say 1.5 s and 6 s.
  Stop the relay by its port.

- [ ] **Step 5: Full suite, commit**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add app/screens/Band.jsx app/styles.css
git commit -m "Run /band on wrist.js with a side button, and draw the Wrist's own face"
```

### Task 23: The words keep up with the wrist

**Files:**
- Create: `tests/copy.test.js`
- Modify: `app/App.jsx` (the house rules sheet), `app/screens/Met.jsx` (`Quiet`), `relay/server.js` (the wristband section's comment), `firmware/src/band_logic.h` (header, `LIGHT_AWAKE`), `README.md` (the wristband's phrases)

- [ ] **Step 1: Write the failing test** — `tests/copy.test.js`:

```js
// ON THE BEAT — the words about the wristband keep up with it.
//
// It had one button: a press woke it for three seconds, and a one-second hold
// was NOT NOW. It has two now, and other timings (app/lib/wrist.js). No copy,
// comment or document may still describe the old one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const OLD = [/one[- ]button/i, /\bits button\b/i, /for a second\b/i, /one-second/i, /three seconds/i, /only lights up while/i, /made once and keeps/i];

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? files(p) : [p];
});

test('nothing still describes the one-button wristband', () => {
  const found = [];
  const where = [...files(join(root, 'app')), ...files(join(root, 'relay')), ...files(join(root, 'firmware', 'src')), join(root, 'README.md')];
  for (const f of where.filter((p) => /\.(js|jsx|css|h|cpp|md)$/.test(p))) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (OLD.some((re) => re.test(line))) found.push(relative(root, f) + ':' + (i + 1) + ': ' + line.trim());
    });
  }
  assert.deepEqual(found, []);
});
```

- [ ] **Step 2: Run it to see what is left**

Run: `node --test tests/copy.test.js 2>&1 | grep -E "^\s+'|^ℹ (pass|fail)"`
Expected: fails, listing (after Tasks 8, 21 and 22) the house rules rows in `App.jsx`, `band_logic.h`'s header and `LIGHT_AWAKE` comment, and README's wristband lines.

- [ ] **Step 3: Change each site.**
  1. `app/App.jsx`, `howSheet` (S1 House rules), the two wristband rows:
     ```jsx
           { icon: 'watch', label: 'Hold the face button on your wristband to go invisible. Hold its side button to come back.', fg: '#fff', onTap: () => {} },
           { icon: 'touch_app', label: 'Press the side button to see your card, and again to change it. Your phone follows.', fg: '#fff', onTap: () => {} },
     ```
  2. `app/screens/Met.jsx`, `Quiet`: `{paired ? <span className="lede muted">Your wristband is dark too. Hold its side button to come back.</span> : null}`
  3. `relay/server.js`, the wristband section's comment ends: "…and a paired wristband is only ever reached with it. From then on it shows what its person is doing; its face button can make them invisible, and its side button can change their card (setFromBand)."
  4. `firmware/src/band_logic.h`, the header's first two paragraphs:
     ```cpp
     // ON THE BEAT — the wristband's own logic, with no hardware in it.
     //
     // main.cpp is only the hardware round this file: the screen, the two
     // buttons, Wi-Fi and the socket. Everything that decides something is here,
     // in plain C++17, so it builds on a laptop as well as on the wristband.
     // tests/firmware.test.js compiles it with the host's own compiler and holds it
     // against the real relay: the frames it sends are frames the relay takes, and
     // every frame the relay sends is read back the way the relay meant it.
     //
     // Its Wrist is the same machine as the stand-in at /band (app/lib/wrist.js),
     // on the same named timings, and both are run against one table of cases
     // (tests/fixtures/wrist-cases.json).
     ```
     and `LIGHT_AWAKE`'s comment: `// a woken face, and every face read up close`.
  5. `README.md`, "The wristband" section: the bullet **Its one button.** becomes
     ```markdown
     - **Its two buttons.** The face button (KEY1): a press wakes it for six
       seconds; held for 1.5 s it is NOT NOW — dark at once — and the phone
       follows to the invisible screen. The side button (KEY2): a press shows
       the card that is armed; each press after moves a preview — HI, SONG,
       DANCE, OFF — and 3 s after the last one the choice goes to the relay,
       which decides; the face says `SET`, `CHANGED` or `NOT SENT`.
       Coming back from NOT NOW takes holding the side button. The pair screen
       says to *press* its face button, not to hold it.
     ```
     and "The wristband's firmware": "it says it is a wristband with an id it made once and keeps" becomes "it says it is a wristband with an id that is the hash of a key it makes at every boot"; "A press wakes it for three seconds; a one-second hold is NOT NOW." becomes "Its two buttons work as above."

- [ ] **Step 4: Run to see it pass**

Run: `node --test tests/copy.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ pass 1`. Then put one old phrase back (`Held for a second` in a comment in `relay/server.js`): it fails and names that line; take it out again.

- [ ] **Step 5: Full suite, commit, close the stage (P2)**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add tests/copy.test.js app/App.jsx app/screens/Met.jsx relay/server.js firmware/src/band_logic.h README.md
git commit -m "Say what the wristband's two buttons do, everywhere, and test that the old words are gone"
git push origin main
```


## Stage G — The README, then proof in a browser and on the band

### Task 24: README says what was built

**Files:**
- Modify: `README.md`

Each edit below names the passage it replaces. Keep the file's voice: short declarative sentences, no marketing, a reason for every choice. `tests/copy.test.js` must stay green — so the old wristband is described as "a single button", "a 3 s wake", "a 1 s hold", never in the phrases it greps for.

- [ ] **Step 1: Run it.** After the code block add:

```markdown
**The night ends at 06:00 at the venue.** `NIGHT_TZ=Australia/Brisbane npm start`
names the venue's time zone (an IANA name); without it the relay uses its own
machine's.
```

- [ ] **Step 2: The wristband — the opening paragraph.** "an M5StickC on a strap" becomes "an M5StickC Plus or a StickS3 on a strap", and the paragraph ends: "It has two buttons, so from the wrist alone, with the phone in a pocket, a person can change which card is armed, come back from NOT NOW, and see whether that was taken."

- [ ] **Step 3: Pairing.** In the pairing bullet, the third way in ends "…with the letters already in — after onboarding, for someone new." (drop "and one tap pairs it" and "It never pairs on its own; see Abuse resistance for why."). Replace the paragraph from "The relay then tells the phone the wristband's id" to "…flashes the wristband white once, so the right wrist knows." with:

```markdown
  **All three end with a check.** The relay does not pair on the letters: the
  wristband that was reached shows a two-digit number with `ON YOUR PHONE?`
  under it, and the phone asks *Does your wristband show 27?* in a sheet that
  stays over any screen and comes back after a reconnect. `YES` pairs, and the
  wristband flashes white once. `NO`, or no answer within a minute, drops it and
  the wristband shows new letters; a second phone trying the same wristband
  meanwhile is told someone is pairing it. A decoy code stuck on someone's
  wristband fails here: the number lights the decoy, not the wrist the person
  is looking at.

  On `YES` the relay makes a secret and gives it to that phone and that
  wristband, and after every reconnect each proves itself with it.
```

- [ ] **Step 4: The rest of the wristband bullets.** Replace the bullets **A phone coming back does not undo the wrist.** and **After a relay restart** with:

```markdown
- **Who a wristband is.** It makes a random key at every boot and keeps it
  only in RAM; its id is the first half of the key's SHA-256, and every hello
  proves the id with the key. Knowing an id — every phone that ever paired it
  was told it — is not enough to speak as it, and switching it off and on makes
  a new wristband with new letters.
- **The relay decides, and a late message can only hide.** Every change to the
  armed card or to NOT NOW, from a phone or a wrist, moves a revision. A choice
  on the wrist, and a tap on the phone that would show the person, name the
  revision they were chosen from and are refused if it has moved. A phone
  re-says its facts after every reconnect, marked `again`, and the relay
  applies one only if it never saw it and it hides the person. So a phone
  waking in a pocket cannot undo a card chosen on the wrist, and a tap stuck in
  a dead socket cannot show someone who has since gone NOT NOW. The phone
  follows every view (`app/lib/follow.js`) and says when the wrist changed
  something — *Armed from your wristband: SAY HI*, with `NOT YOU? UNPAIR` — or
  when its own tap did not land. Offline it queues only NOT NOW.
- **A wristband keeps its person in the room** for up to an hour after a phone
  of theirs was last heard, or until 06:00 at the venue, whichever is first,
  so the phone can stay locked. With no phone and no live wristband, the
  two-minute grace applies as before. Once they are out, the wrist says
  `OPEN YOUR PHONE` / `TO COME BACK` on a press, and a hold is kept until they
  are back.
- **After a relay restart** the wristband comes back with its secret and waits
  for its owner — `OPEN YOUR PHONE` / `OR SWITCH ME OFF`, no letters — until
  the phone's claim with the same secret pairs it again; a hold meanwhile is
  applied then. Whichever is back first, the secret decides. Nobody by the hour
  or by 06:00, and it shows new letters. A paired wristband away for an hour is
  forgotten, and only then, told so by the relay, does the phone say *Your
  wristband restarted or went away. Pair it again.* Before that, away for two
  minutes, its chip says `OFFLINE` and offers `PAIR AGAIN`.
- **"I've left" is carried until it is heard.** The phone says *Leaving…* and
  re-sends it across reconnects until the relay answers; the relay's leave
  unpairs the wristband.
```

- [ ] **Step 5: The firmware section.** In **Everything that decides anything is in `src/band_logic.h`**, "the screen, the button," becomes "the screen, the two buttons,", and the bullet ends: "Its `Wrist` is the same machine as `/band`'s `app/lib/wrist.js`, and one table, `tests/fixtures/wrist-cases.json`, is run against both: the JavaScript by `tests/wrist.test.js`, the C++ through `logic_test wrist` by `tests/firmware.test.js`, which also holds every named timing equal on both." Replace **Its id is 128 random bits, not the chip's MAC.** and its sentences with "**Its key is 128 random bits, made at every boot**, never the chip's MAC, and kept only in RAM with the pairing's secret." (The CI lines were rewritten in Task 2.)

- [ ] **Step 6: Where this differs from the canvas.** Add:

```markdown
- **A second button, and other timings.** Revision 6 gives the wristband a
  single button — a 3 s wake, and a 1 s hold for NOT NOW — and no second
  action. The owner chose on 24 Sep 2026: the side button (KEY2,
  M5Unified's `BtnB` on every supported board; the power button is never used)
  changes the armed card, so the phone can stay in a pocket; a press wakes the
  face for six seconds, long enough to read a preview; NOT NOW is a hold of
  1.5 s, longer than a bump in a crowd. Every timing is a named constant, in
  `band_logic.h` and `app/lib/wrist.js`, because they are guesses until worn.
- **A connected wristband keeps its person in the room for up to an hour**
  without their phone, where the canvas has the phone as the only way in.
- **Pairing ends with a check** shown on the wrist and confirmed on the phone.
  Without it a decoy code would pair silently, and with `set` a wrongly paired
  wristband could make someone visible.
```

- [ ] **Step 7: Abuse resistance.** In **Guessing a wristband's four letters**, "each unproven attempt — a missed code, or a bare id-claim with no wristband behind it — is throttled" becomes "every pairing attempt, right letters or wrong, and every unproven claim is throttled". Replace **Piling up placeholder claims.** with "A phone claims a wristband by id and secret, which a restarted relay must accept before the wristband is back. A claim nothing answers is a placeholder, one per person, forgotten after the hour; the band table has a hard ceiling that evicts the deadest record first and never a live wristband." Add, after it:

```markdown
- **Speaking as someone else's wristband.** Every hello carries the key its id
  is the hash of; a hello whose key does not hash to its id is refused, for a
  paired, a pending and an unpaired record alike, and a paired record also
  needs its secret, without which the new socket is closed and the live one is
  left alone. A socket says hello once, a replaced wristband socket is closed
  and nothing more is taken from it, and a hello with no protocol version gets
  letters but is never paired.
- **A decoy wristband.** The check above: the number appears on the wristband
  that was reached, so a decoy has to be believed, not just scanned. Numbers
  are unique among the pairings in progress, a second pairing of the same
  wristband is refused `busy`, and the letters change after every NO or
  timeout.
- **Showing someone late.** A wristband's `set` is dropped whole unless it is
  exactly a set, and refused `unpaired`, `no room`, `changed` or `too fast`
  (one a second). A phone's re-said facts only ever hide, and only when they are
  news; a showing change names the revision it was chosen from. A person who
  left under NOT NOW and comes back is still invisible, and a join made while
  holding NOT NOW makes them invisible from the first moment.
```

and the closing sentence of the section's first part: "Each fix is a test in `tests/server.test.js`, `tests/wristband.test.js` or `tests/rules.test.js`, and each was mutation-checked — break the guard and exactly its test goes red; where other tests stand on a guard, exactly that known set does." Replace the paragraph "One further guard is on the phone, not the relay…" with: "The `/pair/` link used to wait for a tap on the phone, because a hostile code anywhere could bind an attacker's wristband to whoever opened it. The check replaces that tap for every way in — the in-app scanner and typed letters too, which the old guard never covered." In "Still open here", replace "the fact that the pairing code is a bearer token visible on the wristband's screen — first to type it pairs, so a paired wristband flashes white and can be unpaired;" with "the letters on a wristband's screen, which let someone watching hold its check open a minute at a time — every attempt counts and the letters change after each, so this annoys rather than pairs;".

- [ ] **Step 8: What is not done.** Add:

```markdown
- **Answering someone from the wrist** (phase B) is not built: only waving back
  at a SAY HI could be, since a like needs the other person's pick, which the
  wrist never shows.
- **The timings are guesses until worn** — six seconds awake, 1.5 s holds,
  three to send, ten to wait. They are named constants for that reason.
```

- [ ] **Step 9: Check and commit**

```bash
node --test tests/copy.test.js 2>&1 | grep -E "^ℹ (pass|fail)"
git add README.md
git commit -m "Describe the wrist's controls, the pairing check, and who decides, in the README"
```

### Task 25: Proof in a browser

**Files:** none unless a defect is found; then a failing test first, the fix, and its own commit.

Follow `CLAUDE.md`'s "Verifying the phone in a browser" for seeding. Start the relay with Bash `run_in_background` (`npm start`); keep `/band` and two seeded phones (`Rae`, and a second person at the same venue) in separate tabs; set the pane to 1280×800 before reading pages and reset it at the end. Press stand-in buttons from `javascript_tool` with pointer events (Task 22, Step 4) so press lengths are exact. Record each outcome as seen, not as expected.

- [ ] **Step 1: Pairing.** Type the stand-in's letters on Rae's phone: the sheet asks about the number the stand-in shows; press NO → *That's not this wristband.*, new letters. Pair again and wait 60 s → *No answer in time. Try again.*, new letters. Pair again, YES → the stand-in flashes white. From the second phone, type the letters of a wristband mid-check → *Someone is pairing that wristband right now…*
- [ ] **Step 2: Choosing from the wrist.** SIDE, SIDE (preview `HI :)` in blue on black), wait → `SENDING`, then `SET` on a blue field; Rae's phone toasts *Armed from your wristband: SAY HI* with `NOT YOU? UNPAIR`; the second phone sees Rae in WHO'S NEAR.
- [ ] **Step 3: NOT NOW and back.** Face button held 1.5 s → `KEEP HOLDING` and the bar, then dark; Rae's phone is on the quiet screen and the second phone no longer sees her. SIDE, SIDE (`HOLD SIDE TO SHOW`), SIDE held → Rae is back with SAY HI and the phone toasts *Back on, from your wristband: SAY HI*.
- [ ] **Step 4: The toast's UNPAIR.** Choose from the wrist again and tap `NOT YOU? UNPAIR` on the toast: the stand-in shows new letters, Rae's chip says `pair`.
- [ ] **Step 5: Reload after a wrist change.** Pair again; choose FIRST SONG? on the wrist; reload Rae's page: the card is FIRST SONG? at once, and the second phone never sees her card go off.
- [ ] **Step 6: A reconnect.** Close the stand-in's socket from `javascript_tool` (not the page): its face keeps the card for ten seconds, then goes dark; it reconnects with its secret and shows the card again, still paired.
- [ ] **Step 7: A relay restart with the phone closed.** Close Rae's tab; stop the relay by its port and start it again: the stand-in shows `OPEN YOUR PHONE` / `OR SWITCH ME OFF`. Hold its face button 1.5 s. Open Rae's tab: she lands on the quiet screen — the hold survived — and the stand-in is paired, dark.
- [ ] **Step 8: Offline and leaving.** Stop the relay; on Rae's phone tap a card → *Not connected — try again*; tap NOT NOW → the quiet screen. Start the relay: the second phone never sees her. Tap *I've left the venue* → *Leaving…*, then the venue list; the stand-in shows new letters.
- [ ] **Step 9: Stop everything.** Stop the relay by its port (`Get-NetTCPConnection -LocalPort 8790` → `Stop-Process`); reset the pane (`resize_window` preset `desktop`).

### Task 26: Proof on the real band

**Files:**
- Modify: `README.md` ("What is not done": what was tried on the band, as it went)

The owner's hands are needed: only he can press the band and lock his phone. Ask him in Chinese, one step at a time, and read the band's serial console for evidence rather than taking a step as done.

- [ ] **Step 1: Ask him to close his serial monitor** (it holds COM8), then flash:

```powershell
& C:\Users\LewisDong\.platformio\penv\Scripts\pio.exe run -d firmware -e m5sticks3 -t upload --upload-port COM8
```

Expected: `SUCCESS`. The Wi-Fi and relay it was given before are kept across the flash (Preferences); the old stored `id` is removed at first boot (Task 3).

- [ ] **Step 2: A relay his phone can reach.** `npm start` and `npm run tunnel` (both Bash `run_in_background`). Wait for cloudflared's `Registered tunnel connection` and confirm the name over DoH before using it (`CLAUDE.md`: an address looked up too early is dead here for thirty minutes). Give the band the address at its console (`relay https://…`); `show` must say `on it`.
- [ ] **Step 3: Every flow once**, his phone on the tunnel address: pair through the check (and one NO); SIDE to choose each card and OFF; face-button hold for NOT NOW; SIDE hold to come back; the phone's toasts and `NOT YOU? UNPAIR`; stop and start the relay with his phone closed (the band says `OPEN YOUR PHONE` / `OR SWITCH ME OFF`, and his phone pairs it again on opening). Watch the console for `the relay says:` lines; there should be none but the ones a step expects.
- [ ] **Step 4: The pocket test.** A second browser, on the laptop, joins his venue as another person. He locks his phone and puts it in a pocket for more than two minutes; then chooses SAY HI on the band. The second browser must show him in WHO'S NEAR. Then he unlocks the phone: the card must still be SAY HI, and no toast may say his tap failed.
- [ ] **Step 5: Write down what happened.** In README "What is not done", **The firmware has run on one wristband** gains a sentence stating what was tried on the band with the wrist controls, the date, and anything that did not work; anything that did not work also gets a failing test and a fix, each its own commit.
- [ ] **Step 6: Commit, push, and stop what was started**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail|skipped)"
git add README.md
git commit -m "Record the wrist controls on a real band and phone"
git push origin main
```

Stop the relay and the tunnel by port/process, and tell him in Chinese what passed and what did not.

