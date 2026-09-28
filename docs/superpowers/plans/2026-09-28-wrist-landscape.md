# The wristband sideways — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both wristbands draw every face landscape, 240 × 135, and each turns itself between its two landscape sides from its accelerometer, so the face reads the right way up on either wrist, worn either way round.

**Architecture:** The decision is a pure class in `firmware/src/band_logic.h`, `Turning`, fed gravity across the band's short side ten times a second: it turns after `TURN_HOLD_MS` of `TURN_TILT` or more one way, and holds otherwise; `turn` on the console holds a side, kept in `Preferences`. `firmware/src/main.cpp` sets the display to one of its two landscape rotations, sizes every face from the canvas's band turned (`k = min(W / 240, H / 135)`), lays the pairing QR beside its letters, and answers `snap` with the frame in base64 (`toBase64()` in `band_logic.h`) so each face can be looked at from the laptop.

**Tech Stack:** C++17 on the laptop (MinGW-W64 g++ here, GCC in CI), C++11 on the band (Arduino-ESP32 2.0.17 through PlatformIO `espressif32@^6.9.0`), M5Unified (`M5.Imu`, `M5.Display`), M5GFX (`M5Canvas`); Python 3 with pyserial (PlatformIO's own) and Node's jsQR for the checks.

**Spec:** `docs/superpowers/specs/2026-09-28-wrist-landscape-design.md` (decided with the owner question by question on 28 Sep 2026, reviewed and approved the same day, commit `bc78387`). Read it before any task.

This plan was written before the build, from the code at `bc78387`. Where the build finds a block here wrong, the block is corrected in this file in the same commit as the fix.

## Global Constraints

- Artefacts are English: code, comments, commit messages, README, test names. Talk to the owner in Chinese.
- **Constants** (`band_logic.h`): `TURN_READ_MS` 100, `TURN_TILT` 0.35 (g), `TURN_HOLD_MS` 500. The display's two landscape rotations are 1 and 3; which is USB-left, and which accelerometer axis and sign run across the short side, are measured on each board in Task 4 before they are trusted.
- **Console:** `turn auto|usb-left|usb-right`, kept as `turn` in `Preferences`, default `auto`, removed by `forget`; `show` (and a marker's `show`) gains `face    landscape, USB left (auto), tilt +0.62 g  (accel x … y … z …)`; `snap` answers one line `snap <W> <H> <base64>`, RGB565 little-endian, row by row. A marker takes `turn` and `snap` too.
- **No portrait** anywhere on a band; the browser stand-in (`/band`) is not touched.
- **The band's compiler takes C++11** after `Arduino.h`'s macros; `firmware/host/as_band.cpp` holds `band_logic.h` to that on every run, and a variable left unused is an error (`-Werror`). The ESP32 core also defines a class `base64`: the encoder is `toBase64`.
- **Flashing a band needs the owner's yes, every time.** The StickS3 is on `COM8`, the StickC Plus on `COM9`. A stand-in phone paired to one of his bands is unpaired before the check ends, and each band's state is said. A band made a marker is made a wristband again (`marker off`) before the check ends.
- Never print `firmware/src/secrets.h`, and never grep `firmware/src/*.h` broadly.
- Repository `LewisSwan24/on-the-beat` (private). Commit after each task and push to `main` when `npm test` is green. Never the team repository `cimi2232/DECO3500`. Never `--no-verify`. `CLAUDE.md` is not edited.
- Windows host: the Bash tool is Git Bash. Never write JavaScript, Python or C++ holding backticks, quotes or `${}` through a Bash heredoc: write it with the editor.
- Never more than ten background tasks at once. Work directly.
- Commit messages end with the attribution trailer the session's system reminder gives (today: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## Procedures used throughout

**P1 — Mutation check.** As in `docs/superpowers/plans/2026-09-28-staff-reports.md` P1: the runner `mutate.mjs` in the scratchpad, a JSON list of `{label, file, from, to, test, expect}`, run from the repository root. Every mutation here breaks `band_logic.h` and runs `tests/firmware.test.js`, which compiles the host tests: about 40 s a run, twice. The logic binary stops at its first failed check, so a mutation's red set is the one test *the wristband logic passes its own checks*. Run the list in the background; no PlatformIO build runs while `band_logic.h` holds a mutant.

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

**P2 — Build both bands.** From `firmware/`, with PlatformIO's own `pio` at `C:\Users\LewisDong\.platformio\penv\Scripts\pio.exe`: `pio run -e m5sticks3` and `pio run -e m5stickc`, each ending `[SUCCESS]`. Flashing adds `-t upload --upload-port COM8` (StickS3) or `COM9` (StickC Plus), and only after the owner's yes.

**P3 — Look at a face.** `snap.py` asks a band for `snap` over its console without resetting it, and writes the frame as a PNG three times the size, for Read, and as raw RGBA beside it, for `qr.mjs`. Both live in the scratchpad; run `snap.py` with PlatformIO's Python (`C:/Users/LewisDong/.platformio/penv/Scripts/python.exe`, which has pyserial), and `qr.mjs` from the repository root so `jsqr` resolves.

```python
"""Ask a band for `snap` over its console and save the frame: <out>.png three times the size, <out>.rgba as is.

usage: snap.py <port> <out.png>
"""
import base64
import struct
import sys
import time
import zlib

import serial

SCALE = 3
port_name, out = sys.argv[1], sys.argv[2]
port = serial.Serial()
port.port = port_name
port.baudrate = 115200
port.timeout = 0.1
port.dtr = False  # released before open, so opening does not reset the chip
port.rts = False
port.open()
line = None
try:
    time.sleep(0.3)
    port.reset_input_buffer()
    port.write(b"snap\n")
    buf = b""
    end = time.time() + 40
    while time.time() < end and line is None:
        buf += port.read(65536)
        for raw in buf.split(b"\n")[:-1]:
            if raw.startswith(b"snap "):
                line = raw.decode().strip()
                break
finally:
    port.close()
if line is None:
    sys.exit("no snap came back")
_, w, h, data = line.split(" ", 3)
w, h = int(w), int(h)
px = base64.b64decode(data)
if len(px) != w * h * 2:
    sys.exit("snap was %d bytes, not %d" % (len(px), w * h * 2))
rgb = []
for i in range(w * h):
    v = px[2 * i] | (px[2 * i + 1] << 8)
    rgb.append((((v >> 11) & 31) * 255 // 31, ((v >> 5) & 63) * 255 // 63, (v & 31) * 255 // 31))
rows = bytearray()
for y in range(h * SCALE):
    rows.append(0)
    for x in range(w * SCALE):
        rows.extend(rgb[(y // SCALE) * w + x // SCALE])


def chunk(kind, body):
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)


png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w * SCALE, h * SCALE, 8, 2, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(bytes(rows))) + chunk(b"IEND", b""))
with open(out, "wb") as f:
    f.write(png)
with open(out[:-4] + ".rgba", "wb") as f:
    f.write(struct.pack("<II", w, h) + bytes(c for p in rgb for c in (*p, 255)))
print("saved", out, w, "x", h)
```

```js
// Decode the QR code in a band's snapped frame with jsQR, the scanner the app itself uses.
// usage: node qr.mjs <frame.rgba>   (from the repository root, so jsqr resolves)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(process.cwd() + '/package.json');
const found = require('jsqr');
const jsQR = found.default || found;
const buf = readFileSync(process.argv[2]);
const w = buf.readUInt32LE(0);
const h = buf.readUInt32LE(4);
const code = jsQR(new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, w * h * 4), w, h);
console.log(code ? 'QR: ' + code.data : 'no QR found');
```

**P4 — A stand-in phone for a band.** `pairphone.mjs`, in the scratchpad, joins a throwaway venue on the relay the bands use, types a band's letters once the relay has sent its first view, says YES once the relay shows the check (after `CONFIRM_AFTER_MS`, to snap the check number first), stays for `<seconds>` answering nothing else, then unpairs and leaves, so the band shows fresh letters again. It prints the check number (compare it with the band's own `face`) and never a secret. Node's own `WebSocket`, so it needs nothing from `node_modules`.

```js
// A stand-in phone for the band checks. usage: node pairphone.mjs <relay origin> <venue> <LETTERS> [seconds] [arm]
// Types the band's letters once it has joined, says YES to the check, arms `arm` (hi, song or dance) if given,
// stays, then unpairs and leaves, so the band shows fresh letters again. Prints the check number, never a secret.
import { randomBytes } from 'node:crypto';

const [origin, venue, code, secs = '300', arm = ''] = process.argv.slice(2);
const ws = new WebSocket(origin.replace(/^http/, 'ws').replace(/\/+$/, '') + '/api/ws');
const send = (m) => ws.send(JSON.stringify(m));
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let typed = false;
let asked = false;
let paired = false;
ws.onopen = () => {
  send({ t: 'join', venue, me: randomBytes(16).toString('hex') });
  send({ t: 'profile', name: 'Band check stand-in' });
  setInterval(() => send({ t: 'ping' }), 2000);
  setTimeout(() => {
    send({ t: 'unpair' });
    send({ t: 'leave' });
    say('UNPAIRED AND LEFT');
    setTimeout(() => process.exit(0), 500);
  }, Number(secs) * 1000);
};
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.t === 'view' && !typed) {
    typed = true;
    say('joined; typing', code);
    send({ t: 'pair', code });
  }
  if (m.t === 'view' && m.view?.me?.check && !asked) {
    asked = true;
    say('CHECK', m.view.me.check);
    // Long enough to snap the check on the band before YES ends it.
    setTimeout(() => send({ t: 'confirm', yes: true }), Number(process.env.CONFIRM_AFTER_MS || 0));
  }
  if (m.t === 'paired' && !paired) {
    paired = true;
    say('PAIRED');
    if (arm) send({ t: 'arm', intent: arm, seq: 1 });
  }
  if (m.t === 'error') say('RELAY SAID', m.why);
  if (m.t === 'check') say('check ends', m.ok === undefined ? '' : m.ok);
};
ws.onclose = () => say('closed');
```

---

### Task 1: Which way up, and a frame in base64 (`band_logic.h`)

**Files:**
- Modify: `firmware/src/band_logic.h` (a section before `// ---------- the serial console ----------`)
- Test: `firmware/host/logic_test.cpp` (a `turning()` function, called from `main()`)

**Interfaces:**
- Produces: `constexpr uint32_t TURN_READ_MS = 100; constexpr float TURN_TILT = 0.35f; constexpr uint32_t TURN_HOLD_MS = 500;` `enum TurnMode { TURN_AUTO = 0, TURN_USB_LEFT = 1, TURN_USB_RIGHT = 2 };` `int turnNamed(const std::string&)` (the mode, or -1); `const char* turnName(int mode)`; `class Turning { void set(TurnMode); TurnMode mode() const; bool usbRight() const; bool read(float down, uint32_t now); }` where `down` is gravity across the short side in g, positive when the USB-left face is the right way up, and `read()` is true when the side changed; `std::string toBase64(const uint8_t* bytes, size_t n)`.

- [ ] **Step 1: Write the failing checks** — in `firmware/host/logic_test.cpp`, inside the anonymous namespace that holds the checks (after `markers()`, before the line `}  // namespace` that closes it), add:

```cpp
void turning() {
  Turning t;
  CHECK(t.mode() == TURN_AUTO && !t.usbRight());  // USB left until the first turn
  // Leaning to the other side: it turns once the lean has held TURN_HOLD_MS, and not before.
  CHECK(!t.read(-0.6f, 0));
  CHECK(!t.read(-0.6f, TURN_HOLD_MS - 1));
  CHECK(t.read(-0.6f, TURN_HOLD_MS) && t.usbRight());
  CHECK(!t.read(-0.6f, TURN_HOLD_MS + 100) && t.usbRight());  // already there
  // Flat on a table, or on an arm hanging down: under the tilt, however long, it keeps its side.
  CHECK(!t.read(0.2f, 2000) && !t.read(-0.1f, 9000) && !t.read(0.34f, 20000) && t.usbRight());
  // A lean that dips under the tilt starts the hold again.
  CHECK(!t.read(0.5f, 30000));
  CHECK(!t.read(0.3f, 30300));
  CHECK(!t.read(0.5f, 30400));
  CHECK(!t.read(0.5f, 30400 + TURN_HOLD_MS - 1) && t.usbRight());
  CHECK(t.read(0.5f, 30400 + TURN_HOLD_MS) && !t.usbRight());
  // So does a lean that crosses to the side it is already on.
  CHECK(!t.read(-0.5f, 40000));
  CHECK(!t.read(0.5f, 40300));
  CHECK(!t.read(-0.5f, 40400));
  CHECK(!t.read(-0.5f, 40400 + TURN_HOLD_MS - 1) && !t.usbRight());
  CHECK(t.read(-0.5f, 40400 + TURN_HOLD_MS) && t.usbRight());
  // Exactly the tilt counts.
  CHECK(!t.read(TURN_TILT, 50000) && t.read(TURN_TILT, 50000 + TURN_HOLD_MS) && !t.usbRight());
  // Held to a side: every reading is ignored.
  t.set(TURN_USB_RIGHT);
  CHECK(t.mode() == TURN_USB_RIGHT && t.usbRight());
  CHECK(!t.read(0.9f, 60000) && !t.read(0.9f, 70000) && t.usbRight());
  t.set(TURN_USB_LEFT);
  CHECK(!t.usbRight() && !t.read(-0.9f, 80000) && !t.read(-0.9f, 90000) && !t.usbRight());
  // Auto again picks up from the side it is on, which is not always USB left.
  t.set(TURN_USB_RIGHT);
  t.set(TURN_AUTO);
  CHECK(t.usbRight() && !t.read(0.9f, 100000) && t.read(0.9f, 100000 + TURN_HOLD_MS) && !t.usbRight());
  // Its names, as the console takes them and says them.
  CHECK(turnNamed("auto") == TURN_AUTO && turnNamed("usb-left") == TURN_USB_LEFT && turnNamed("usb-right") == TURN_USB_RIGHT);
  CHECK(turnNamed("") == -1 && turnNamed("left") == -1 && turnNamed("AUTO") == -1);
  CHECK(std::string(turnName(TURN_AUTO)) == "auto" && std::string(turnName(TURN_USB_RIGHT)) == "usb-right");
  // A frame goes over the console in base64, padded as the standard says.
  const uint8_t man[] = {'M', 'a', 'n'};
  CHECK(toBase64(man, 3) == "TWFu" && toBase64(man, 2) == "TWE=" && toBase64(man, 1) == "TQ==" && toBase64(man, 0).empty());
  const uint8_t edge[] = {0xff, 0x00, 0x10, 0xfb, 0xef};
  CHECK(toBase64(edge, 5) == "/wAQ++8=");
}
```

and in `main()`, after `markers();`, add `turning();`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/firmware.test.js`
Expected: FAIL — *the wristband logic passes its own checks* does not compile: `'Turning' was not declared in this scope`. (`as_band.cpp` still compiles: nothing in `band_logic.h` changed yet.)

- [ ] **Step 3: Write the section in `band_logic.h`** — before the line `// ---------- the serial console ----------`, add:

```cpp
// ---------- which way up (docs/superpowers/specs/2026-09-28-wrist-landscape-design.md §2) ----------

constexpr uint32_t TURN_READ_MS = 100;  // how often the band reads its accelerometer
constexpr float TURN_TILT = 0.35f;      // g across the short side, about 20 degrees, before a lean counts
constexpr uint32_t TURN_HOLD_MS = 500;  // a lean held this long, unbroken, turns the face

/** `turn` on the console: which way the face reads, worked out or held. */
enum TurnMode { TURN_AUTO = 0, TURN_USB_LEFT = 1, TURN_USB_RIGHT = 2 };

/** The mode a console word names, or -1. (Not `word`: Arduino.h defines that as a macro.) */
inline int turnNamed(const std::string& name) {
  if (name == "auto") return TURN_AUTO;
  if (name == "usb-left") return TURN_USB_LEFT;
  if (name == "usb-right") return TURN_USB_RIGHT;
  return -1;
}

inline const char* turnName(int mode) {
  return mode == TURN_USB_LEFT ? "usb-left" : mode == TURN_USB_RIGHT ? "usb-right" : "auto";
}

/**
 * Which of its two landscape sides a band's face reads from: the USB-C socket
 * to the left of the words, or to their right. Worn in a watch clip the band
 * lies across the forearm, and raising the wrist to look tips gravity across
 * its short side toward the bottom of the words, so a lean of TURN_TILT or
 * more, held TURN_HOLD_MS, turns the face to it. Anything less, a band flat on
 * a table or on an arm hanging down, keeps the side it has: the face never
 * flickers between the two.
 */
class Turning {
 public:
  /** Held to a side, or worked out (the default). Auto starts from the side it is on. */
  void set(TurnMode mode) {
    mode_ = mode;
    if (mode == TURN_USB_LEFT) usbRight_ = false;
    else if (mode == TURN_USB_RIGHT) usbRight_ = true;
    leaning_ = 0;
  }

  TurnMode mode() const { return mode_; }
  bool usbRight() const { return usbRight_; }

  /**
   * A reading: `down`, gravity across the short side in g, positive when the
   * USB-left face is the right way up. True if the face turned.
   */
  bool read(float down, uint32_t now) {
    if (mode_ != TURN_AUTO) return false;
    const int lean = down >= TURN_TILT ? 1 : down <= -TURN_TILT ? -1 : 0;
    if (lean == 0 || (lean < 0) == usbRight_) {  // no lean, or one toward the side it is on
      leaning_ = 0;
      return false;
    }
    if (lean != leaning_) {
      leaning_ = lean;
      since_ = now;
      return false;
    }
    if (now - since_ < TURN_HOLD_MS) return false;
    usbRight_ = lean < 0;
    leaning_ = 0;
    return true;
  }

 private:
  TurnMode mode_ = TURN_AUTO;
  bool usbRight_ = false;
  int leaning_ = 0;    // the lean being timed: 1 toward USB-left, -1 toward USB-right, 0 none
  uint32_t since_ = 0;
};

/** Standard base64, padded: how `snap` sends a frame over the console. */
inline std::string toBase64(const uint8_t* bytes, size_t n) {
  static const char ALPHABET[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve((n + 2) / 3 * 4);
  for (size_t i = 0; i < n; i += 3) {
    const uint32_t v = (static_cast<uint32_t>(bytes[i]) << 16) | (i + 1 < n ? static_cast<uint32_t>(bytes[i + 1]) << 8 : 0) |
                       (i + 2 < n ? static_cast<uint32_t>(bytes[i + 2]) : 0);
    out += ALPHABET[(v >> 18) & 63];
    out += ALPHABET[(v >> 12) & 63];
    out += i + 1 < n ? ALPHABET[(v >> 6) & 63] : '=';
    out += i + 2 < n ? ALPHABET[v & 63] : '=';
  }
  return out;
}

```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/firmware.test.js`
Expected: PASS, every test (the logic binary prints `ok: <n> checks`).

- [ ] **Step 5: Mutation check (P1)** — `landscape-task-1.json`, every item with `"file": "firmware/src/band_logic.h"`, `"test": "tests/firmware.test.js"`, `"expect": ["the wristband logic passes its own checks"]`:

| label | from | to |
|---|---|---|
| a dip under the tilt keeps the hold | `if (lean == 0 \|\| (lean < 0) == usbRight_) {  // no lean, or one toward the side it is on\n      leaning_ = 0;` | `if (lean == 0 \|\| (lean < 0) == usbRight_) {  // no lean, or one toward the side it is on` |
| no hold at all | `if (now - since_ < TURN_HOLD_MS) return false;` | (empty) |
| exactly the tilt does not count | `down >= TURN_TILT ? 1 : down <= -TURN_TILT ? -1 : 0` | `down > TURN_TILT ? 1 : down < -TURN_TILT ? -1 : 0` |
| a held side still turns | `if (mode_ != TURN_AUTO) return false;` | (empty) |
| auto starts from USB left | `else if (mode == TURN_USB_RIGHT) usbRight_ = true;` | `else usbRight_ = mode == TURN_USB_RIGHT;` |
| no padding | `out += i + 2 < n ? ALPHABET[v & 63] : '=';` | `out += ALPHABET[v & 63];` |

(In the JSON, `\n` is a newline in `from`; an empty `to` is `""`.) Expected: `ALL MUTATIONS HELD`, about eight minutes.

- [ ] **Step 6: Whole suite, commit, push**

Run: `npm test` — expected: every test passes.

```bash
git add firmware/src/band_logic.h firmware/host/logic_test.cpp
git commit -m "The band works out which way up its face reads" -m "Turning, in band_logic.h: fed gravity across the short side ten times a second, it turns the face to the side a lean of 0.35 g or more has held for 500 ms, and holds its side through anything less, flat or hanging; turn on the console can hold a side. toBase64 is how snap will send a frame." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 2: The faces at 240 × 135, and `snap` (`main.cpp`)

**Files:**
- Modify: `firmware/src/main.cpp` (`drawLines()`, `drawMeet()`, `drawPairing()`, `paint()`, `drawMarker()`, a `scaleOf()` and a `snap()`; `help()`, `helpMarker()`, `run()`; `setup()`'s rotation)

**Interfaces:**
- Consumes: `toBase64()` (Task 1).
- Produces: `float scaleOf(int W, int H)`; `ROTATION[2]` (USB left, USB right; `{3, 1}` as measured in Task 4); `void snap()`, answering `snap` for a wristband and a marker.

- [ ] **Step 1: Scale from the canvas's band turned** — add after `int px(float v, float k) { … }`:

```cpp
/** How the canvas's band, 135 x 240 drawn portrait, scales to this face: turned, 240 x 135. */
float scaleOf(int W, int H) { return std::min(W / 240.0f, H / 135.0f); }
```

In `paint()`, replace `const float k = std::min(W / 135.0f, H / 240.0f);  // the canvas draws the wristband 135 x 240` with `const float k = scaleOf(W, H);`. In `drawMarker()`, replace `const float k = std::min(face.width() / 135.0f, face.height() / 240.0f);` with `const float k = scaleOf(face.width(), face.height());`.

- [ ] **Step 2: Lines centred where they are asked** — replace `drawLines()`:

```cpp
void drawLines(const std::vector<std::string>& lines, const lgfx::IFont* font, int step, int& y) {
  face.setFont(font);
  face.setTextSize(1);
  for (const std::string& l : lines) {
    face.drawString(l.c_str(), face.width() / 2, y);
    y += step;
  }
}
```

with:

```cpp
/** Lines one under another from `y`, each centred on `x` (the middle of the face if -1). */
void drawLines(const std::vector<std::string>& lines, const lgfx::IFont* font, int step, int& y, int x = -1) {
  face.setFont(font);
  face.setTextSize(1);
  for (const std::string& l : lines) {
    face.drawString(l.c_str(), x < 0 ? face.width() / 2 : x, y);
    y += step;
  }
}
```

- [ ] **Step 3: The number as large as the height left allows** — in `drawMeet()`, replace

```cpp
  const float size = std::min(2.0f * k, static_cast<float>(maxW) / std::max(1, widthIn(NUMBER, w.big)));
  const Fit small = fitSmall(w.small, maxW, H / 4);
```

with

```cpp
  const Fit small = fitSmall(w.small, maxW, H / 4);
  // As wide as the face allows, and as tall as what is left under the word: at 240 x 135 the portrait size.
  const float tall = static_cast<float>(H - linesHeight(small) - px(6, k) - 2 * px(4, k)) / std::max(1, heightOf(NUMBER) * 3 / 4);
  const float size = std::min({2.0f * k, static_cast<float>(maxW) / std::max(1, widthIn(NUMBER, w.big)), tall});
```

- [ ] **Step 4: Pairing, the code beside its letters** — replace the whole of `drawPairing()` and its comment:

```cpp
/**
 * Pairing: a code to scan beside the four letters to type. The code is as
 * tall as the face allows, with four light modules round it — a tunnel
 * address is a version 4 code, and the canvas's 115 pixels would make each
 * module two pixels, too small for a phone to read off a screen this size. The
 * letters stand in the middle of the width left beside it, and a press puts
 * the hint, PAIR ON YOUR PHONE, under them.
 */
void drawPairing(const std::string& code, const std::string& hint, float k) {
  const int W = face.width(), H = face.height();
  const std::string url = relay.ok ? pairUrl(relay.origin, code) : "";
  const int version = url.empty() ? 0 : qrVersion(url.size());
  const int module = qrModule(version, H - px(8, k));
  const int box = module * (qrSize(version) + 8);
  const int edge = box ? (H - box) / 2 : 0;           // the code's margin, above, below and to its left
  // The letters' column: beside the code, or with no code the whole face less its margins.
  const int left = box ? edge + box + px(4, k) : px(10, k);
  const int colW = box ? W - left - px(6, k) : W - 2 * px(10, k);
  if (box) {
    face.fillRect(edge, edge, box, box, WHITE);
    face.qrcode(url.c_str(), edge + 4 * module, edge + 4 * module, module * qrSize(version), version);
  }
  int font = 0;
  while (font < 2 && 4 * widthIn(CODE[font], "W") * 112 / 100 > colW) ++font;
  const int advance = widthIn(CODE[font], "W");
  const int track = advance * 12 / 100;  // the canvas spaces the letters .12em apart
  const int codeH = heightOf(CODE[font]);
  const int hintGap = hint.empty() ? 0 : px(6, k);
  const Fit words = fitSmall(hint, colW, H - (codeH + hintGap) - 2 * px(4, k));
  const int middle = left + colW / 2;
  int y = (H - (codeH + hintGap + linesHeight(words))) / 2;
  face.setTextColor(WHITE);
  face.setTextDatum(lgfx::textdatum_t::top_center);
  face.setFont(CODE[font]);
  face.setTextSize(1);
  const int n = static_cast<int>(code.size());
  int x = middle - (n * advance + (n - 1) * track) / 2 + advance / 2;
  for (char c : code) {
    const char one[2] = {c, 0};
    face.drawString(one, x, y);
    x += advance + track;
  }
  y += codeH + hintGap;
  drawLines(words.lines, SMALL[words.font], smallStep(words.font), y, middle);
}
```

- [ ] **Step 5: `snap`** — after `markerFace()`, add:

```cpp
/**
 * `snap`: the frame last pushed, as one line, `snap <W> <H> <base64>`, its
 * pixels RGB565, little-endian, row by row, for a script to make an image
 * (landscape spec §3). A row of 240 is 480 bytes, a whole number of base64's
 * three-byte groups, so the rows' base64 run on as one. It changes nothing.
 */
void snap() {
  const int W = face.width(), H = face.height();
  Serial.printf("snap %d %d ", W, H);
  std::vector<uint8_t> row(static_cast<size_t>(W) * 2);
  for (int y = 0; y < H; ++y) {
    for (int x = 0; x < W; ++x) {
      const uint16_t c = face.readPixel(x, y);
      row[2 * x] = static_cast<uint8_t>(c & 0xff);
      row[2 * x + 1] = static_cast<uint8_t>(c >> 8);
    }
    Serial.print(toBase64(row.data(), row.size()).c_str());
  }
  Serial.println();
}
```

In `run()`, the marker branch gains `else if (c.verb == "snap") snap();` before `else helpMarker();`, and the wristband's chain gains, before `} else if (c.verb == "sound") {`:

```cpp
  } else if (c.verb == "snap") {
    snap();
```

`help()` gains the line `"  snap                    the screen, as one line of base64 for a script\n"` after the `face` line, and `helpMarker()` the same after its `face` line.

- [ ] **Step 6: Landscape from boot** — at the top of the anonymous namespace's screen section (after `constexpr uint16_t WHITE = 0xFFFF;`), add:

```cpp
// The display's two landscape rotations: the USB-C socket to the left of the words, and to their right.
// The same on both boards, measured on 28 Sep 2026 (Task 4): at rotation 1 the socket is to the right.
constexpr uint8_t ROTATION[2] = {3, 1};
```

In `setup()`, replace

```cpp
  M5.Display.setRotation(0);
  if (M5.Display.width() > M5.Display.height()) M5.Display.setRotation(1);
```

with

```cpp
  // Landscape: worn in a watch clip, the band lies across the forearm (landscape spec).
  M5.Display.setRotation(ROTATION[0]);
```

- [ ] **Step 7: Build both (P2), run the suite**

Run P2's two builds — expected `[SUCCESS]` for each, no warnings from `main.cpp`. Run `npm test` — expected: every test passes.

- [ ] **Step 8: Commit, push**

```bash
git add firmware/src/main.cpp
git commit -m "The band's faces at 240 x 135, and snap" -m "Every face is sized from the canvas's band turned (k = min(W / 240, H / 135)), so words and the meeting number keep their size; the number is also held to the height left under its word; the pairing QR stands on the left at the size it had and the letters, with the hint, beside it. snap sends the frame last pushed as one line of base64, for a script to look at. The display is landscape from boot." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: Turning on the band (`main.cpp`)

**Files:**
- Modify: `firmware/src/main.cpp` (the accelerometer's axis and sign per board; `turning`, `imuOk`, readings; `applyTurn()`, `readTurn()`, `reportTurn()`, `setTurn()`; `report()`, `reportMarker()`, `run()`, `help()`, `helpMarker()`, `forget`; `setup()`, `loop()`)

**Interfaces:**
- Consumes: `Turning`, `turnNamed`, `turnName`, `TURN_READ_MS` (Task 1); `ROTATION` (Task 2).

- [ ] **Step 1: Readings and the turn** — after the `ROTATION` constant, add:

```cpp
// Which accelerometer axis runs across the band's short side, and the sign that makes gravity along it positive
// when the USB-left face reads the right way up. M5Unified gives both boards one axis order; each is measured on
// its board (the wristband landscape plan, Task 4) before it is trusted.
// On both boards +y, measured on 28 Sep 2026 (Task 4).
constexpr bool ACROSS_IS_Y = true;
constexpr float ACROSS_SIGN = 1.0f;

Turning turning;         // which way up the face reads
bool imuOk = false;      // the accelerometer started
uint32_t turnReadAt = 0;
float accel[3] = {0, 0, 0};  // the last reading, in g
float across = 0;            // gravity across the short side, as Turning takes it
```

After `drawMarker()`, add:

```cpp
/** The display turned to the side `turning` says; the next draw paints the face again, that way up. */
void applyTurn() {
  M5.Display.setRotation(ROTATION[turning.usbRight() ? 1 : 0]);
  drawn.clear();
}

/** Every TURN_READ_MS: gravity across the short side, and a turn if it has held (landscape spec §2). */
void readTurn(uint32_t now) {
  if (!imuOk || now - turnReadAt < TURN_READ_MS) return;
  turnReadAt = now;
  if (!M5.Imu.getAccel(&accel[0], &accel[1], &accel[2])) return;
  across = ACROSS_SIGN * (ACROSS_IS_Y ? accel[1] : accel[0]);
  if (turning.read(across, now)) applyTurn();
}

void reportTurn() {
  const char* side = turning.usbRight() ? "right" : "left";
  const char* how = turning.mode() == TURN_AUTO ? "auto" : "held";
  if (!imuOk) {
    Serial.printf("face    landscape, USB %s (%s), no motion sensor\n", side, how);
    return;
  }
  Serial.printf("face    landscape, USB %s (%s), tilt %+.2f g  (accel x %+.2f y %+.2f z %+.2f)\n", side, how, across, accel[0],
                accel[1], accel[2]);
}

/** `turn auto|usb-left|usb-right`: kept, and at once. */
void setTurn(const std::string& name) {
  const int mode = turnNamed(name);
  if (mode < 0) {
    Serial.println("turn auto, turn usb-left or turn usb-right");
    return;
  }
  prefs.putString("turn", name.c_str());
  turning.set(static_cast<TurnMode>(mode));
  applyTurn();
  reportTurn();
}
```

- [ ] **Step 2: The console** — `report()` gains `reportTurn();` before `reportNear(millis());`; a marker's `show` in `run()` becomes `{ reportMarker(); reportTurn(); }`, and `setup()`'s marker branch calls `reportTurn();` after `reportMarker();` (`reportMarker()` stands above the screen section, so it cannot call `reportTurn()` itself without a forward declaration, which this file has none of). In `run()`, the marker branch gains `else if (c.verb == "turn") setTurn(trim(c.arg));` before `else helpMarker();`; the wristband chain gains, before `} else if (c.verb == "snap") {`:

```cpp
  } else if (c.verb == "turn") {
    setTurn(trim(c.arg));
```

and `forget` gains, after `prefs.remove("relay");`:

```cpp
    prefs.remove("turn");
    turning.set(TURN_AUTO);
```

`help()` gains `"  turn auto|usb-left|usb-right  which way up: worked out, or held (kept)\n"` after the `snap` line, and `helpMarker()` the same after its `snap` line.

- [ ] **Step 3: Boot and loop** — in `setup()`, after `prefs.begin("otb", false);` and the line after it, add:

```cpp
  // Which way up: worked out from the accelerometer, or held to the side `turn` kept.
  imuOk = M5.Imu.isEnabled();
  const int turnMode = turnNamed(setting("turn", "auto"));
  turning.set(static_cast<TurnMode>(turnMode < 0 ? TURN_AUTO : turnMode));
  applyTurn();
```

In `loop()`, after `readBattery(now);`, add `readTurn(now);` — once, before the marker branch, so a marker turns too.

- [ ] **Step 4: Build both (P2), run the suite**

Expected: both `[SUCCESS]`; `npm test` green.

- [ ] **Step 5: Commit, push**

```bash
git add firmware/src/main.cpp
git commit -m "The band turns its face from its accelerometer" -m "Ten times a second the band reads gravity across its short side and gives it to Turning, and a turn repaints the face the other way up. turn auto|usb-left|usb-right holds or frees the side, kept like relay and taken back by forget; show says the side, how it was chosen and the tilt, with the raw axes, and a marker does all of it too. Which axis and which sign are measured on each board next." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 4: On both real bands

Needs the owner: ask in Chinese, with AskUserQuestion, before flashing; and ask whether he is at the desk to hold and wear the bands.

- [ ] **Step 1: Flash both (P2, `-t upload`)** after his yes. Then `show` on each (ask.py): `face    landscape, USB left (auto), tilt …` with numbers, and the relay `on it`.

- [ ] **Step 2: Measure which rotation is which, with him.** `turn usb-left` on a band; ask him whether the USB-C socket is to the left of the words. If not, swap `ROTATION`'s two values. Then, still held, ask him to hold the band as he reads a watch; read `show`'s raw axes: the axis of x and y with the larger size is the one across the short side (`ACROSS_IS_Y`), and its sign must make `tilt` positive (`ACROSS_SIGN`). Both bands, each its own constants. `turn auto` on both after.

  *Measured 28 Sep 2026:* at `turn usb-left` with rotation 1 the owner saw the socket to the right of the words on both bands, so `ROTATION` is `{3, 1}` on both. Held upright facing him, socket to his left: StickC Plus x +0.16, **y +0.94**, z +0.35; StickS3 x -0.02, **y +0.70**, z +0.72 (tipped back as a raised wrist is). Both boards: `ACROSS_IS_Y` true, `ACROSS_SIGN` +1, so the per-board `#if` went. Before this, on the provisional x axis, he reported that the Plus did not turn as it should on auto.

- [ ] **Step 3: If a constant changed**, correct it (Task 2 or 3's block here too), P2 builds, `npm test`, commit (`The band's turn, as measured on both boards`), push, and ask him again before flashing again.

- [ ] **Step 4: Look at every face (P3), on both bands, on both sides** (`turn usb-left`, then `turn usb-right`; back to `turn usb-left` after). A face is lit by `press face` (ask.py) before its snap. Faces:
  1. unpaired letters and QR, and the same after a press (the hint);
  2. the pairing check number: P4's stand-in phone at `https://on-the-beat.fly.dev`, venue `band-check-landscape`, with the band's letters, `300` s and `CONFIRM_AFTER_MS=15000` — snap once `CHECK` prints, before the YES, and the band's `face` shows the same number;
  3. paired and idle; a card after `press side`; KEEP HOLDING part way (`hold face`, snap at once); NOT NOW after the hold;
  4. a marker's face: `marker bar`, `press face`, snap, `marker off`.
  Read every PNG. Decode each pairing frame's QR with `qr.mjs`: the address must be the relay's pairing link for the letters shown. Unpair the stand-in when done (it does so itself at the end of its time), and say each band's state.

- [x] **Step 5: On the wrist, with him.** Worn in the clip: raising the wrist reads the right way up; turning the arm the other way round turns the face within about half a second; flat on the table and hanging at his side, it does not flicker. Each wrist once. `show` on the Plus before and after five minutes of wear for the power line.

  *Worn 28 Sep 2026, and it failed:* on both bands, raising the wrist read the right way up and flat or hanging never flickered, but moving to the other wrist never turned the face. `tiltlog.py` (below) recorded why: looking at the StickS3 on his left wrist as at a watch, socket toward the elbow, the face lay nearly flat (z +0.75 to +0.95 g), gravity in its plane ran along the arm (x -0.5 to -0.7 g), and across the short side read only -0.1 to -0.3 g, the opposite way to a face held upright. A face seen from above has no down that gravity can find, and across the short side is the only reading in which the two wrists differ. He asked whether it was too hard, and chose to hold the side and turn it over by hand. The spec's §2 and §3 were amended; Task 4b builds that.

  ```python
  """Log a band's turn line (side, tilt, raw axes) four times a second, without resetting it.

  usage: tiltlog.py <port> <seconds> <out.tsv>
  Sends `show` every 0.25 s on one open port and keeps only the `face    landscape, ...` lines.
  """
  import re
  import sys
  import time

  import serial

  port_name, secs, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
  LINE = re.compile(r"face +landscape, USB (\w+) \((\w+)\), tilt ([+-][\d.]+) g +\(accel x ([+-][\d.]+) y ([+-][\d.]+) z ([+-][\d.]+)\)")
  port = serial.Serial()
  port.port = port_name
  port.baudrate = 115200
  port.timeout = 0.02
  port.dtr = False  # released before open, so opening does not reset the chip
  port.rts = False
  port.open()
  start = time.time()
  rows = []
  try:
      time.sleep(0.3)
      port.reset_input_buffer()
      buf = b""
      next_ask = 0.0
      while time.time() - start < secs:
          now = time.time()
          if now >= next_ask:
              port.write(b"show\n")
              next_ask = now + 0.25
          buf += port.read(8192)
          while b"\n" in buf:
              raw, buf = buf.split(b"\n", 1)
              m = LINE.search(raw.decode("utf-8", "replace"))
              if m:
                  rows.append((time.time() - start,) + m.groups())
  finally:
      port.close()
  with open(out, "w") as f:
      f.write("t\tside\thow\ttilt\tx\ty\tz\n")
      for r in rows:
          f.write("%.2f\t%s\n" % (r[0], "\t".join(r[1:])))
  print("rows", len(rows), "->", out)
  ```

- [ ] **Step 6: Commit what was measured** in this plan (a line under each step), push.

---

### Task 4b: The side held, and the power button turns it over

**Files:**
- Modify: `firmware/src/band_logic.h` (the turning section: `Turning`, `TURN_*` and `TurnMode` go; `turnNamed()` and `turnName()` stay, for two sides)
- Modify: `firmware/src/main.cpp` (the accelerometer constants and reads go; `usbRight`, `turnTo()`, the power button in `loop()`)
- Test: `firmware/host/logic_test.cpp` (`turning()`)

**Interfaces:**
- Produces: `int turnNamed(const std::string&)`: 0 for `usb-left`, 1 for `usb-right`, -1 for anything else, `auto` included; `const char* turnName(bool usbRight)`; in `main.cpp`, `bool usbRight` and `void turnTo(bool right)`, which keeps the side as `turn`, turns the display and says so.

- [x] **Step 1: The checks** — `turning()` in `logic_test.cpp` checks `turnNamed("usb-left") == 0`, `turnNamed("usb-right") == 1`, `-1` for `auto`, `""`, `left` and `USB-LEFT`, both names from `turnName()`, and the base64 checks as before. Red against Task 1's code: `turnNamed("usb-left")` was 1.
- [x] **Step 2: `band_logic.h`** — the turning section is a comment on why the side is held, `turnNamed()` and `turnName(bool)`. Green: 111 of 111.
- [x] **Step 3: `main.cpp`** — `bool usbRight` replaces `Turning` and the accelerometer; `applyTurn()` turns the display to `ROTATION[usbRight]`; `turnTo(right)` keeps `turn`, applies and reports; `setTurn()` takes the two names; `setup()` reads `turn` with `usb-left` as the fallback, so a kept `auto` reads as USB left; `loop()`, before the marker branch, has `if (M5.BtnPWR.wasClicked()) turnTo(!usbRight);`; `forget` sets USB left; `show` says `face    landscape, USB left; the power button turns it over`; `help()` and `helpMarker()` say `turn usb-left|usb-right  which side is up (kept); the power button turns it over`.
- [x] **Step 4: Build both, the suite, two mutations** — both `[SUCCESS]`; `npm test` 470 of 470; *the two sides swapped* and *an old auto taken as a side* each turn *the wristband logic passes its own checks* red, restored byte for byte.
- [ ] **Step 5: Commit, push, and flash both** (he said yes, 28 Sep 2026).
- [ ] **Step 6: On both bands, with him** — `show` says USB left; a short press of the power button turns the face over and `show` says USB right; a second press turns it back; left on USB right, a restart (`pio device monitor`'s reset, or power) comes back USB right; then back to USB left. If `M5.BtnPWR` never clicks on a board, say so and stop: the gesture is his to choose again.
- [ ] **Step 7:** Task 4's Step 4 (every face snapped, both sides) and Task 5 go on from here.

---

### Task 5: README and memory

**Files:**
- Modify: `README.md` (*Where this differs from the canvas*; *The wristband's firmware*; *What is not done*)

- [ ] **Step 1: README** — *Where this differs from the canvas*, at the end of the list:

```
- **The band is landscape, and turns itself.** Revision 6 draws a portrait
  band with a strap stub above and below. The owner's watch clip holds a
  Stick across the forearm, and he chose on 28 Sep 2026 that both bands go
  landscape and turn themselves: every face is laid out at 240 x 135, the
  pairing code beside its letters, and a band turns to whichever of its two
  landscape sides its accelerometer says is the right way up.
```

*The wristband's firmware*: the comment on its `pio device monitor` line lists `turn, snap` after `face`; and after the paragraphs on what the console can press, play and hear, this paragraph:

```
**Which way up.** Ten times a second the band reads gravity across its
short side. A lean of 0.35 g or more, about 20 degrees, held for half a
second, turns the face to it; anything less, flat on a table or on an arm
hanging down, keeps the side it has, so the face never flickers. `turn
usb-left` or `turn usb-right` holds a side instead, kept on the band like
`relay`; `turn auto` frees it, and `forget` does too. `show` says the side,
how it was chosen and the tilt. `snap` sends the screen as one line of
base64, which is how every landscape face was looked at from a laptop.
```

*What is not done*: add, with what Task 4 measured:

```
- **The band turns only between its two landscape sides.** It never goes
  portrait, and the half-second hold and the 0.35 g tilt are guesses until
  worn for a night; each is one constant in `band_logic.h`.
```

- [ ] **Step 2: Suite, commit, push** — `npm test` green (`tests/copy.test.js` reads the README).

```bash
git add README.md
git commit -m "README: the band sideways" -m "Why the band is landscape, how it turns itself, turn and snap on the console, and what is still a guess until worn." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 3: Memory** — update `watch-kit` (done, with the measured constants and his wear test) and its line in `MEMORY.md`.
