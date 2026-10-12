# The wristband's sounds, 8-bit: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the band's twelve triangle-wave note lists with the 8-bit set he chose by ear: square waves, noise and rests in segments, rendered to identical bytes by C++ on the band and JS in the `/band` stand-in.

**Architecture:** A sound is a list of segments `[wave, hz0, hz1, ms, env, a, b]`. The same table lives in `app/lib/wrist.js` and `firmware/src/band_logic.h`. One integer-only render turns it into 8-bit samples at 16 kHz. It is written twice, in `app/lib/sound.js` and in `band_logic.h render()`, and a test holds the two to the same bytes through a hash of every sound. The Plus plays the table's pitches. The stand-in and a speaker build play them an octave down.

**Tech Stack:** C++11 (band, through PlatformIO/Arduino) and C++17 (host checks); Node `node:test`; Web Audio in the browser.

**Spec:** `docs/superpowers/specs/2026-10-12-band-sounds-8bit-design.md` (commit 2a7dacb, approved: 「可以，写实施计划吧」).

## Global Constraints

- Every voice is a 50% square, plus noise and rests. Steady notes sit in F7 2794 Hz, A7 3520, C8 4186 and D8 4699.
- Volumes are integers 0 to 32767 (Q15), so 1.0 is 32767. The levels used are 0.6 = 19660, 0.35 = 11468, 0.3 = 9830, 0.2 = 6553 and 0.1 = 3277.
- The render uses no floating point and no `pow` or `exp`. It starts with a 40 ms lead-in of 128s. A segment lasts `n = ms × 16` samples, and `hz = hz0 + trunc((hz1 − hz0) × i / n)`. The phase step is `floor(hz × 2³² / 16000)` on a wrapping u32. Noise comes from an LFSR with taps 0, 2, 3 and 5, seeded 0xACE1. A sample is `128 + trunc(level × vol × 127 / 32767)`, and a rest is 128.
- On the buzzer, pitches play as written. On a speaker (the stand-in, or the StickS3 build), every pitch is halved: `hz0 >> 1`, `hz1 >> 1`.
- `SOUND_SAMPLES` ≤ 9600. The longest sound, 540 ms plus the 40 ms lead-in, gives 9280.
- Which event plays which sound does not change. Nor do the reaction queue, the flashes, the phone's sound switch, NOT NOW's silence, or the rule that one sound cuts the last.
- `band_logic.h` builds as C++11 on the band. A `constexpr` function there is one `return` statement, so sums recurse.
- Arduino.h defines macros. New names in `band_logic.h` use `enum class` and `HZ_` prefixes, so `LOW`, `D8` and the like cannot collide.
- Artefacts are in English. The repository is public: no secrets and no interview material.
- Every new check is mutation-checked: break what it guards and watch it go red, then restore it and **rebuild** before going on.
- `npm test` builds first. To run one test file alone, run `npm run build` first if it touches the relay (firmware.test.js does).

## Review Focus

1. **The two renders drift.** A rounding difference (trunc against floor on a negative slide, or a float rounding in JS) changes one byte, and the stand-in no longer sounds like the band. This is pinned by the hash test in Task 2, which covers both octaves and a downward slide (`low`).
2. **A decay goes past 16 halvings, or `>>` reaches 32 in JS.** In JS, `a >> 32` is `a`, not 0, so a long decay would jump back to full volume. This is pinned by a `volumeAt` check far past the last halving in Task 1, and the same check in Task 2.
3. **A buffer cut short.** `render()` is handed `SOUND_SAMPLES` and the longest sound must fit. This is pinned by "every sound fits" and the cap check in Task 2.
4. **The stand-in plays a second sound over the first.** This is pinned by "a new sound stops the last" in Task 3.
5. **Reaction timing moves silently.** `until` follows `soundMs`, and sounds without a flash (tick, double, down, jingle, the `up`/`fall` without a flash) change length. This is pinned by the shared wrist table in Task 1, with every changed time listed old → new in the commit message.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `app/lib/wrist.js` | modify | `SOUNDS` in the new segment shape, `LEAD_IN_MS`, an exported `soundMs` |
| `app/lib/sound.js` | create | the JS render: `renderSound`, `volumeAt`, `pitchAt`, `fnv1a` |
| `tests/sound.test.js` | create | render details, pitch guard and lengths, on the JS side |
| `firmware/src/band_logic.h` | modify | the segment table, `render()`, `volumeAt()`, `pitchAt()`; the buzzer rules removed |
| `firmware/host/logic_test.cpp` | modify | `sound()` rewritten; `speak` verbs `sounds` (new shape) and `renders` (hashes) |
| `tests/firmware.test.js` | modify | byte-identical render test |
| `firmware/src/main.cpp` | modify | comments and the console's speaker line only |
| `app/lib/speaker.js` | modify | plays one rendered buffer instead of triangle oscillators |
| `tests/speaker.test.js` | modify | tests the buffer, not `notesAt` |
| `docs/wristband.md` | modify | the two sound paragraphs |

---

### Task 1: The table and the render, in JS

**Files:**
- Modify: `app/lib/wrist.js:88-103` (SOUNDS) and `:125` (soundMs)
- Create: `app/lib/sound.js`
- Create: `tests/sound.test.js`

**Interfaces:**
- Produces:
  - `wrist.js`: `SOUNDS` (`{ [name]: Segment[] }`, where a `Segment` is `[wave: 'square'|'noise'|'rest', hz0, hz1, ms, env: 'flat'|'line'|'decay', a, b]`);
  - `wrist.js`: `LEAD_IN_MS = 40` and `soundMs(name) → number` (ms, lead-in included, 0 for a falsy name);
  - `sound.js`: `SOUND_RATE = 16000` and `PER_MS = 16`;
  - `sound.js`: `renderSound(name, { buzzer = false } = {}) → Uint8Array` (empty for an unknown name);
  - `sound.js`: `volumeAt(seg, i, n) → int`, `pitchAt(seg, i, n, buzzer) → int` and `fnv1a(bytes) → uint32`.

- [ ] **Step 1: Write the failing tests**

Create `tests/sound.test.js`:

```js
// ON THE BEAT — the wristband's sounds as bytes (app/lib/sound.js). The band
// renders the same bytes in band_logic.h render(); tests/firmware.test.js holds
// the two equal. These are the render's own rules, checked on the JS side.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEAD_IN_MS, SOUNDS, soundMs } from '../app/lib/wrist.js';
import { PER_MS, pitchAt, renderSound, volumeAt } from '../app/lib/sound.js';

const LEAD = LEAD_IN_MS * PER_MS;  // 640 samples

/** How many times a stretch of samples crosses the middle going up. */
const ups = (b, from, to) => {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (b[i - 1] < 128 && b[i] >= 128) n++;
  return n;
};

test('every sound is its segments plus a 40 ms lead-in, on the buzzer and on a speaker', () => {
  assert.equal(LEAD, 640);
  for (const name of Object.keys(SOUNDS)) {
    const ms = LEAD_IN_MS + SOUNDS[name].reduce((t, s) => t + s[3], 0);
    assert.equal(soundMs(name), ms, name);
    assert.equal(renderSound(name, { buzzer: true }).length, ms * PER_MS, name);
    assert.equal(renderSound(name).length, ms * PER_MS, name);
  }
  assert.equal(soundMs(null), 0);
  assert.equal(renderSound('hum').length, 0);
});

test('the lead-in is silence, and so is a rest', () => {
  const d = renderSound('double', { buzzer: true });
  assert.ok(d.subarray(0, LEAD).every((b) => b === 128), 'lead-in');
  // double: struck F7 60 · rest 40 · struck A7 60
  const rest = d.subarray(LEAD + 60 * PER_MS, LEAD + 100 * PER_MS);
  assert.ok(rest.every((b) => b === 128), 'rest');
});

test('a square is two levels at full scale, starting high', () => {
  const up = renderSound('up', { buzzer: true });
  const first = up.subarray(LEAD, LEAD + 70 * PER_MS);  // F7 70, flat at 1.0
  assert.equal(first[0], 255);
  assert.deepEqual([...new Set(first)].sort((a, b) => a - b), [1, 255]);
});

test('on the buzzer a note is its own pitch; on a speaker an octave down', () => {
  // tick: F7 2794 Hz for 60 ms is 167.6 waves; an octave down, 83.8.
  const hi = renderSound('tick', { buzzer: true });
  const lo = renderSound('tick');
  const n = ups(hi, LEAD, hi.length);
  const m = ups(lo, LEAD, lo.length);
  assert.ok(n >= 166 && n <= 168, 'buzzer ' + n);
  assert.ok(m >= 82 && m <= 84, 'speaker ' + m);
});

test('a decay halves every h ms, in a straight line between halvings, and reaches nothing', () => {
  const seg = ['square', 2794, 2794, 60, 'decay', 32767, 14];
  const h = 14 * PER_MS;
  assert.equal(volumeAt(seg, 0, 960), 32767);
  assert.equal(volumeAt(seg, h, 960), 16383);
  assert.equal(volumeAt(seg, 2 * h, 960), 8191);
  assert.equal(volumeAt(seg, h / 2, 960), 32767 - Math.trunc((32767 - 16383) * (h / 2) / h));
  // Far past the sixteenth halving it stays at 0: in JS, x >> 32 is x, not 0.
  assert.equal(volumeAt(seg, 40 * h, 960), 0);
  assert.equal(volumeAt(seg, 33 * h, 960), 0);
});

test('a line runs from its first volume to its last', () => {
  const seg = ['square', 4186, 4186, 140, 'line', 32767, 9830];
  const n = 140 * PER_MS;
  assert.equal(volumeAt(seg, 0, n), 32767);
  assert.equal(volumeAt(seg, n - 1, n), 32767 + Math.trunc((9830 - 32767) * (n - 1) / n));
  assert.equal(volumeAt(['square', 2794, 2794, 70, 'flat', 32767, 0], 500, 1120), 32767);
});

test("a slide ends within one step of its last pitch, down as well as up, and halves on a speaker", () => {
  const down = SOUNDS.low[0];  // A7 sliding down to 1400 Hz
  const up = SOUNDS.hello[0];  // F7 sliding up to A7
  for (const seg of [down, up]) {
    const n = seg[3] * PER_MS;
    const step = Math.ceil(Math.abs(seg[2] - seg[1]) / n);
    assert.equal(pitchAt(seg, 0, n, true), seg[1]);
    assert.ok(Math.abs(pitchAt(seg, n - 1, n, true) - seg[2]) <= step, seg.join(' '));
    assert.equal(pitchAt(seg, 0, n, false), seg[1] >> 1);
  }
});

test('noise takes both levels and is not a square', () => {
  // low: A7~1400 250 · noise 3000 50
  const b = renderSound('low', { buzzer: true });
  const noise = b.subarray(LEAD + 250 * PER_MS, LEAD + 300 * PER_MS);
  const highs = [...noise].filter((x) => x > 128).length;
  const lows = [...noise].filter((x) => x < 128).length;
  assert.ok(highs > 100 && lows > 100, highs + ' / ' + lows);
  // A 3000 Hz square flips 300 times in 50 ms; noise stepping 3000 times a second flips at most 150, about 75.
  let flips = 0;
  for (let i = 1; i < noise.length; i++) if ((noise[i] > 128) !== (noise[i - 1] > 128)) flips++;
  assert.ok(flips < 3000 * 0.05, 'flips ' + flips);
});

test('every note the buzzer must sound starts where it is loud', () => {
  // The Plus buzzer is loud from about 2.8 to 4.7 kHz, weak under 2.6 kHz. A slide may end below (low).
  for (const [name, segs] of Object.entries(SOUNDS)) {
    for (const s of segs) {
      if (s[0] !== 'square') continue;
      assert.ok(s[1] >= 2600 && s[1] <= 4800, name + ' starts at ' + s[1]);
      assert.ok(s[2] <= 4800, name + ' ends at ' + s[2]);
    }
  }
});

test('the longest sound fits one buffer of 9600 samples', () => {
  const longest = Math.max(...Object.keys(SOUNDS).map(soundMs));
  assert.equal(longest, 580);
  assert.ok(longest * PER_MS <= 9600);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/sound.test.js`
Expected: FAIL. The import fails because `app/lib/sound.js` does not exist and `LEAD_IN_MS` is not exported.

- [ ] **Step 3: The table in `app/lib/wrist.js`**

Replace the `SOUNDS` block at lines 88–103 with:

```js
// The band's notes: F7 A7 C8 is the motif, "on-the-BEAT"; D8 tops it. The
// buzzer is loud from about 2.8 to 4.7 kHz, so every steady note sits there.
const F7 = 2794;
const A7 = 3520;
const C8 = 4186;
const D8 = 4699;
const FULL = 32767;  // volumes are Q15: 1.0 is 32767

// A segment: [wave, hz0, hz1, ms, env, a, b]. env 'flat' holds a; 'line' runs a to b;
// 'decay' starts at a and halves every b ms. For noise, hz is how often its level steps.
const sq = (hz, ms) => ['square', hz, hz, ms, 'flat', FULL, 0];
const slide = (hz0, hz1, ms) => ['square', hz0, hz1, ms, 'flat', FULL, 0];
const fade = (hz, ms, v0, v1) => ['square', hz, hz, ms, 'line', v0, v1];
const struck = (hz, ms, v0, h) => ['square', hz, hz, ms, 'decay', v0, h];
const noise = (rate, ms, v0, v1) => ['noise', rate, rate, ms, 'line', v0, v1];
const rest = (ms) => ['rest', 0, 0, ms, 'flat', 0, 0];

/**
 * Every sound the wrist makes, in segments, at the buzzer's pitch: a speaker plays them an octave down.
 * band_logic.h SOUNDS is the same table. Chosen by ear on the band, 12 Oct 2026
 * (docs/superpowers/specs/2026-10-12-band-sounds-8bit-design.md).
 */
export const SOUNDS = {
  tick: [struck(F7, 60, FULL, 14)],
  double: [struck(F7, 60, FULL, 14), rest(40), struck(A7, 60, FULL, 14)],
  down: [fade(C8, 90, FULL, 19660), fade(A7, 90, 19660, 11468), struck(F7, 240, 11468, 58)],
  up: [sq(F7, 70), fade(C8, 140, FULL, 9830)],
  fall: [sq(C8, 90), fade(A7, 180, FULL, 9830)],
  low: [slide(A7, 1400, 250), noise(3000, 50, FULL, 3277)],
  ask: [sq(F7, 80), rest(60), sq(C8, 110), slide(C8, D8, 60)],
  jingle: [sq(F7, 25), sq(A7, 25), sq(C8, 25), sq(F7, 25), sq(A7, 25), sq(C8, 25), sq(F7, 25), sq(A7, 25), sq(C8, 25),
    fade(C8, 200, FULL, 6553)],
  warn: [sq(A7, 50), rest(30), sq(A7, 50), rest(30), sq(A7, 50), rest(120), sq(A7, 50), rest(30), sq(A7, 50), rest(30),
    sq(A7, 50)],
  hello: [slide(F7, A7, 60), rest(30), sq(A7, 90)],
  found: [sq(F7, 50), sq(A7, 50), sq(C8, 50), fade(D8, 180, FULL, 9830)],
  calledit: [sq(F7, 45), sq(A7, 45), sq(C8, 45), rest(30), sq(F7, 45), sq(A7, 45), sq(C8, 45), fade(D8, 240, FULL, 9830)],
};

/** Silence before every sound: a short sound that starts the speaker cold loses its start. */
export const LEAD_IN_MS = 40;
```

Replace line 125 (`const soundMs = ...`) with:

```js
/** A sound's length in ms, its lead-in included; none, 0. band_logic.h soundMs(). */
export const soundMs = (name) => (name ? LEAD_IN_MS + SOUNDS[name].reduce((ms, s) => ms + s[3], 0) : 0);
```

- [ ] **Step 4: The render in `app/lib/sound.js`**

```js
// ON THE BEAT — the wristband's sounds as samples: 8 bits unsigned at 16 kHz,
// 128 the middle, as M5.Speaker.playRaw() takes them. band_logic.h render() is
// the same function, and tests/firmware.test.js holds the two to the same
// bytes, so the stand-in sounds like the band. Integers only, every division
// truncated toward zero as C++ does: no floating point reaches a sample.

import { LEAD_IN_MS, SOUNDS, soundMs } from './wrist.js';

export const SOUND_RATE = 16000;
export const PER_MS = SOUND_RATE / 1000;
const TWO32 = 2 ** 32;

/** The pitch `i` samples into a segment of `n`: the table's on the buzzer, an octave down on a speaker. */
export function pitchAt([, hz0, hz1], i, n, buzzer) {
  const from = buzzer ? hz0 : hz0 >> 1;
  const to = buzzer ? hz1 : hz1 >> 1;
  return from + Math.trunc(((to - from) * i) / n);
}

/** The volume, 0 to 32767, `i` samples into a segment of `n`. A decay halves every b ms, straight between halvings. */
export function volumeAt([, , , , env, a, b], i, n) {
  if (env === 'flat') return a;
  if (env === 'line') return a + Math.trunc(((b - a) * i) / n);
  const len = b * PER_MS;
  const q = Math.floor(i / len);
  const hi = q < 16 ? a >> q : 0;  // x >> 32 is x in JS: past 15 halvings a Q15 volume is 0
  const lo = q < 15 ? a >> (q + 1) : 0;
  return hi - Math.trunc(((hi - lo) * (i % len)) / len);
}

/** One step of the noise's 16-bit LFSR, taps 0, 2, 3 and 5. */
const lfsrStep = (l) => (l >> 1) | (((l ^ (l >> 2) ^ (l >> 3) ^ (l >> 5)) & 1) << 15);

/** A sound as samples, lead-in first. An unknown name is none. */
export function renderSound(name, { buzzer = false } = {}) {
  const segs = SOUNDS[name];
  if (!segs) return new Uint8Array(0);
  const out = new Uint8Array(soundMs(name) * PER_MS).fill(128);
  let k = LEAD_IN_MS * PER_MS;
  let phase = 0;     // the square's, carried across segments so a slide joins its next note without a click
  let noise = 0;     // the noise's own, stepping the LFSR each time it wraps
  let lfsr = 0xACE1;
  for (const seg of segs) {
    const n = seg[3] * PER_MS;
    for (let i = 0; i < n; i++, k++) {
      if (seg[0] === 'rest') continue;
      // hz × 2³² stays under 2⁵³, so this is exact.
      const step = Math.floor((pitchAt(seg, i, n, buzzer) * TWO32) / SOUND_RATE);
      let level;
      if (seg[0] === 'square') {
        level = phase < 2 ** 31 ? 1 : -1;
        phase = (phase + step) % TWO32;
      } else {
        noise += step;
        if (noise >= TWO32) {
          noise -= TWO32;
          lfsr = lfsrStep(lfsr);
        }
        level = lfsr & 1 ? 1 : -1;
      }
      out[k] = 128 + Math.trunc((level * volumeAt(seg, i, n) * 127) / 32767);
    }
  }
  return out;
}

/** FNV-1a, 32 bits: how tests/firmware.test.js compares a render with the band's. */
export function fnv1a(bytes) {
  let h = 2166136261;
  for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0;
  return h;
}
```

- [ ] **Step 5: Run the new tests**

Run: `node --test tests/sound.test.js`
Expected: PASS, 10/10.

- [ ] **Step 6: Mutation-check the new tests**

Make each mutation, run `node --test tests/sound.test.js`, see the named test go red, then restore:
- `const hi = q < 16 ? a >> q : 0` → `const hi = a >> q`: "a decay halves…" fails at `40 * h`.
- `LEAD_IN_MS = 40` → `0`: lengths and lead-in fail.
- `const from = buzzer ? hz0 : hz0 >> 1` → `const from = hz0` (and the same for `to`): "octave down" fails.
- `if (seg[0] === 'rest') continue;` deleted: the rest is no longer 128, so "a rest" fails.
- `level = phase < 2 ** 31 ? 1 : -1` → `-1 : 1`: "starting high" fails.

Ledger each as killed.

- [ ] **Step 7: The stand-in's twin, the shared wrist table**

Run: `node --test tests/wrist.test.js`
Expected: PASS, or failures only where a case's time follows a sound's new length. For each failure, read the case in `tests/wrist-table.js`. When the expected time is a sound length (old `soundMs`: tick 25, double 110, down 270, up 350, fall 300, jingle 600), change it to the new length: tick 100, double 200, down 460, up 250, fall 310, jingle 465, ask 350, hello 220, found 370, calledit 580, warn 580, low 340. Write each old → new change down for the commit message. A failure that is not a timing change is a bug: debug it, and do not edit the case.

- [ ] **Step 8: Commit**

```bash
git add app/lib/wrist.js app/lib/sound.js tests/sound.test.js tests/wrist-table.js
git commit -m "Sounds: the 8-bit table in segments and its integer render, in JS

<one line per wrist-table time changed, old -> new; or: no case's time changed>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Send the commit as its own command (the ECC hook reads `-n` elsewhere as `--no-verify`).

---

### Task 2: The table and the render, in C++, held to the JS bytes

**Files:**
- Modify: `firmware/src/band_logic.h:57-201`
- Modify: `firmware/host/logic_test.cpp:374-449` (`sound()`), `:877-886` (the `sounds` verb)
- Modify: `tests/firmware.test.js:24` (import), `:372-376` (table test), plus one new test
- Modify: `firmware/src/main.cpp:102`, `:998`, `:1356-1359` (wording only)

**Interfaces:**
- Consumes (from Task 1):
  - `SOUNDS` in the segment shape;
  - `renderSound(name, {buzzer})`;
  - `fnv1a(bytes)`.
- Produces:
  - `enum class Wave { SQUARE, NOISE, REST }` and `enum class Env { FLAT, LINE, DECAY }`;
  - `struct Segment { Wave wave; uint16_t hz0, hz1, ms; Env env; uint16_t a, b; }` and `struct Sound { const char* name; const Segment* segments; size_t count; }`;
  - `LEAD_IN_MS` and `PER_MS`;
  - `soundMs(const char*)`, `segmentsMs(const Segment*, size_t)` and `SOUND_SAMPLES`;
  - `pitchAt(const Segment&, int64_t i, int64_t n, bool buzzer)` and `volumeAt(const Segment&, int64_t i, int64_t n)`;
  - `render(name, out, cap, buzzer)`, with the same signature as today, so `main.cpp:934` is unchanged;
  - the `speak` verbs `sounds` and `renders`.

- [ ] **Step 1: Write the failing tests**

In `tests/firmware.test.js`, change line 24's import and add the `sound.js` import:

```js
import { CONSTS, FLASH_COLOURS, FLASHES, SOUNDS, cardAfter } from '../app/lib/wrist.js';
import { fnv1a, renderSound } from '../app/lib/sound.js';
```

After the test `'the firmware and the stand-in play the same notes and the same flashes'`, add:

```js
test('the firmware and the stand-in render every sound to the same bytes, on the buzzer and an octave down', { skip }, () => {
  const [renders] = speak(['renders']);
  const want = {};
  for (const name of Object.keys(SOUNDS)) {
    const hi = renderSound(name, { buzzer: true });
    const lo = renderSound(name);
    want[name] = [hi.length, fnv1a(hi), lo.length, fnv1a(lo)];
  }
  assert.deepEqual(JSON.parse(renders), want);
});
```

Rename the existing test from "same notes" to `'the firmware and the stand-in keep the same sounds and the same flashes'`. Its body stays `assert.deepEqual(JSON.parse(sounds), SOUNDS)`.

In `firmware/host/logic_test.cpp`, replace the whole `void sound() { … }` body (lines 374 to the line before `// The flash colours`) with:

```cpp
void sound() {
  static uint8_t buf[SOUND_SAMPLES];
  static uint8_t plain[SOUND_SAMPLES];
  const size_t lead = LEAD_IN_MS * PER_MS;  // 640 samples of silence before every sound
  // One buffer holds the longest sound, calledit and warn at 540 ms plus the lead-in, and so every sound;
  // and no more than the two 9.6 KB buffers the band had before, which TLS already shares the heap with.
  CHECK(SOUND_SAMPLES == 580 * PER_MS && SOUND_SAMPLES <= 9600);
  for (const Sound& s : SOUNDS) CHECK(soundMs(s.name) * PER_MS <= SOUND_SAMPLES);
  // A sound is its lead-in and its segments, on either octave.
  CHECK(soundMs("tick") == 100 && render("tick", buf, sizeof buf, true) == 100 * PER_MS);
  CHECK(render("tick", plain, sizeof plain) == 100 * PER_MS);
  CHECK(render("calledit", buf, sizeof buf, true) == SOUND_SAMPLES);
  // The lead-in and a rest are silence.
  render("double", buf, sizeof buf, true);
  bool quiet = true;
  for (size_t i = 0; i < lead; ++i) quiet = quiet && buf[i] == 128;
  for (size_t i = lead + 60 * PER_MS; i < lead + 100 * PER_MS; ++i) quiet = quiet && buf[i] == 128;
  CHECK(quiet);
  // A square is two levels at full scale, starting high.
  render("up", buf, sizeof buf, true);
  bool two = buf[lead] == 255;
  for (size_t i = lead; i < lead + 70 * PER_MS; ++i) two = two && (buf[i] == 255 || buf[i] == 1);
  CHECK(two);
  // On the buzzer F7 for 60 ms is 167.6 waves; on a speaker, an octave down, 83.8.
  const auto ups = [](const uint8_t* b, size_t from, size_t to) {
    int n = 0;
    for (size_t i = from + 1; i < to; ++i)
      if (b[i - 1] < 128 && b[i] >= 128) ++n;
    return n;
  };
  render("tick", buf, sizeof buf, true);
  render("tick", plain, sizeof plain);
  const int hi = ups(buf, lead, 100 * PER_MS), lo = ups(plain, lead, 100 * PER_MS);
  CHECK(hi >= 166 && hi <= 168 && lo >= 82 && lo <= 84);
  // A decay halves every h ms, straight between halvings, and stays at nothing far past the last.
  const Segment struck = SOUNDS[0].segments[0];  // tick: F7 60, decay from 1.0, h14
  CHECK(struck.env == Env::DECAY && struck.b == 14);
  CHECK(volumeAt(struck, 0, 960) == 32767 && volumeAt(struck, 14 * PER_MS, 960) == 16383);
  CHECK(volumeAt(struck, 28 * PER_MS, 960) == 8191 && volumeAt(struck, 40 * 14 * PER_MS, 960) == 0);
  // A slide ends within one step of its last pitch, down (low) as well as up (hello), and halves on a speaker.
  for (const char* name : {"low", "hello"}) {
    const Segment& g = soundFor(name)->segments[0];
    const int64_t n = int64_t(g.ms) * PER_MS, step = (std::abs(int64_t(g.hz1) - g.hz0) + n - 1) / n;
    CHECK(g.hz0 != g.hz1 && pitchAt(g, 0, n, true) == g.hz0 && pitchAt(g, 0, n, false) == g.hz0 >> 1);
    CHECK(std::abs(pitchAt(g, n - 1, n, true) - int64_t(g.hz1)) <= step);
  }
  // Every note the buzzer must sound starts where it is loud; a slide may end below.
  for (const Sound& s : SOUNDS)
    for (size_t k = 0; k < s.count; ++k)
      if (s.segments[k].wave == Wave::SQUARE) CHECK(s.segments[k].hz0 >= 2600 && s.segments[k].hz0 <= 4800 && s.segments[k].hz1 <= 4800);
  // No more than the room it is given, and nothing for a name it does not know.
  CHECK(render("jingle", buf, 100, true) == 100);
  CHECK(render("hum", buf, sizeof buf) == 0);
```

Keep the three `plainField` checks that close the old function, followed by its `}`.

Replace the `sounds` verb (lines 877–886) with the two verbs:

```cpp
  if (c.verb == "sounds") {
    // SOUNDS, as app/lib/wrist.js has it: {"tick":[["square",2794,2794,60,"decay",32767,14]],...}
    static const char* const WAVES[] = {"square", "noise", "rest"};
    static const char* const ENVS[] = {"flat", "line", "decay"};
    std::string out = "{";
    for (const Sound& s : SOUNDS) {
      out += std::string(out.size() > 1 ? "," : "") + quote(s.name) + ":[";
      for (size_t i = 0; i < s.count; ++i) {
        const Segment& g = s.segments[i];
        out += std::string(i ? "," : "") + "[" + quote(WAVES[int(g.wave)]) + "," + std::to_string(g.hz0) + "," +
               std::to_string(g.hz1) + "," + std::to_string(g.ms) + "," + quote(ENVS[int(g.env)]) + "," +
               std::to_string(g.a) + "," + std::to_string(g.b) + "]";
      }
      out += "]";
    }
    return out + "}";
  }
  if (c.verb == "renders") {
    // Every sound rendered, as [length, FNV-1a] on the buzzer and then on a speaker: app/lib/sound.js fnv1a().
    static uint8_t buf[SOUND_SAMPLES];
    std::string out = "{";
    for (const Sound& s : SOUNDS) {
      out += std::string(out.size() > 1 ? "," : "") + quote(s.name) + ":[";
      for (int buzzer = 1; buzzer >= 0; --buzzer) {
        const size_t n = render(s.name, buf, sizeof buf, buzzer == 1);
        uint32_t h = 2166136261u;
        for (size_t i = 0; i < n; ++i) h = (h ^ buf[i]) * 16777619u;
        out += std::to_string(n) + "," + std::to_string(h) + (buzzer ? "," : "");
      }
      out += "]";
    }
    return out + "}";
  }
```

Add `#include <cstdlib>` to logic_test.cpp's includes if `std::abs(int64_t)` is not already reachable (`<cstdlib>` declares the `long long` overload).

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run build && node --test tests/firmware.test.js 2>&1 | tail -30`
Expected: FAIL. The host build fails on `LEAD_IN_MS`, `Segment`, `Env`, `volumeAt` and `pitchAt`, which are not declared, so every firmware test reports the compile error.

- [ ] **Step 3: The table and render in `band_logic.h`**

Replace lines 57–201 (from `// ---------- what the wrist plays ----------` to the end of `render()`) with:

```cpp
// ---------- what the wrist plays ----------
//
// The same tables as app/lib/wrist.js SOUNDS and FLASHES; tests/firmware.test.js
// holds them equal. A sound is segments of a 50% square, noise or a rest, chosen
// by ear on the band (docs/superpowers/specs/2026-10-12-band-sounds-8bit-design.md),
// at the buzzer's pitch: a speaker plays them an octave down.

enum class Wave : uint8_t { SQUARE, NOISE, REST };
// FLAT holds a; LINE runs a to b; DECAY starts at a and halves every b ms. Volumes are Q15: 1.0 is 32767.
enum class Env : uint8_t { FLAT, LINE, DECAY };

struct Segment {
  Wave wave;
  uint16_t hz0, hz1, ms;  // a slide when hz0 and hz1 differ; for noise, how often its level steps
  Env env;
  uint16_t a, b;
};
struct Sound {
  const char* name;
  const Segment* segments;
  size_t count;
};

namespace detail {
// F7 A7 C8 is the motif, "on-the-BEAT"; D8 tops it. The buzzer is loud from about 2.8 to 4.7 kHz.
constexpr uint16_t HZ_F7 = 2794, HZ_A7 = 3520, HZ_C8 = 4186, HZ_D8 = 4699;
constexpr uint16_t FULL = 32767;
constexpr Segment sq(uint16_t hz, uint16_t ms) { return {Wave::SQUARE, hz, hz, ms, Env::FLAT, FULL, 0}; }
constexpr Segment slide(uint16_t hz0, uint16_t hz1, uint16_t ms) { return {Wave::SQUARE, hz0, hz1, ms, Env::FLAT, FULL, 0}; }
constexpr Segment fade(uint16_t hz, uint16_t ms, uint16_t v0, uint16_t v1) { return {Wave::SQUARE, hz, hz, ms, Env::LINE, v0, v1}; }
constexpr Segment struck(uint16_t hz, uint16_t ms, uint16_t v0, uint16_t h) { return {Wave::SQUARE, hz, hz, ms, Env::DECAY, v0, h}; }
constexpr Segment noise(uint16_t rate, uint16_t ms, uint16_t v0, uint16_t v1) { return {Wave::NOISE, rate, rate, ms, Env::LINE, v0, v1}; }
constexpr Segment rest(uint16_t ms) { return {Wave::REST, 0, 0, ms, Env::FLAT, 0, 0}; }

constexpr Segment TICK[] = {struck(HZ_F7, 60, FULL, 14)};
constexpr Segment DOUBLE[] = {struck(HZ_F7, 60, FULL, 14), rest(40), struck(HZ_A7, 60, FULL, 14)};
constexpr Segment DOWN[] = {fade(HZ_C8, 90, FULL, 19660), fade(HZ_A7, 90, 19660, 11468), struck(HZ_F7, 240, 11468, 58)};
constexpr Segment UP[] = {sq(HZ_F7, 70), fade(HZ_C8, 140, FULL, 9830)};
constexpr Segment FALL[] = {sq(HZ_C8, 90), fade(HZ_A7, 180, FULL, 9830)};
constexpr Segment LOW_TONE[] = {slide(HZ_A7, 1400, 250), noise(3000, 50, FULL, 3277)};  // not LOW: Arduino.h makes LOW a macro
constexpr Segment ASK[] = {sq(HZ_F7, 80), rest(60), sq(HZ_C8, 110), slide(HZ_C8, HZ_D8, 60)};
constexpr Segment JINGLE[] = {sq(HZ_F7, 25), sq(HZ_A7, 25), sq(HZ_C8, 25), sq(HZ_F7, 25), sq(HZ_A7, 25),
                              sq(HZ_C8, 25), sq(HZ_F7, 25), sq(HZ_A7, 25), sq(HZ_C8, 25), fade(HZ_C8, 200, FULL, 6553)};
constexpr Segment WARN[] = {sq(HZ_A7, 50), rest(30), sq(HZ_A7, 50), rest(30), sq(HZ_A7, 50), rest(120),
                            sq(HZ_A7, 50), rest(30), sq(HZ_A7, 50), rest(30), sq(HZ_A7, 50)};
constexpr Segment HELLO[] = {slide(HZ_F7, HZ_A7, 60), rest(30), sq(HZ_A7, 90)};
constexpr Segment FOUND[] = {sq(HZ_F7, 50), sq(HZ_A7, 50), sq(HZ_C8, 50), fade(HZ_D8, 180, FULL, 9830)};
constexpr Segment CALLEDIT[] = {sq(HZ_F7, 45), sq(HZ_A7, 45), sq(HZ_C8, 45), rest(30),
                                sq(HZ_F7, 45), sq(HZ_A7, 45), sq(HZ_C8, 45), fade(HZ_D8, 240, FULL, 9830)};
template <size_t N>
constexpr Sound sound(const char* name, const Segment (&segments)[N]) { return {name, segments, N}; }
}  // namespace detail

constexpr Sound SOUNDS[] = {
    detail::sound("tick", detail::TICK),     detail::sound("double", detail::DOUBLE), detail::sound("down", detail::DOWN),
    detail::sound("up", detail::UP),         detail::sound("fall", detail::FALL),     detail::sound("low", detail::LOW_TONE),
    detail::sound("ask", detail::ASK),       detail::sound("jingle", detail::JINGLE), detail::sound("warn", detail::WARN),
    detail::sound("hello", detail::HELLO),   detail::sound("found", detail::FOUND),   detail::sound("calledit", detail::CALLEDIT),
};

inline const Sound* soundFor(const std::string& name) {
  for (const Sound& s : SOUNDS)
    if (name == s.name) return &s;
  return nullptr;
}

// A sound is played as one buffer of samples, so painting the face, which holds
// the loop for tens of milliseconds, cannot bend a tune's rhythm.

constexpr uint32_t SOUND_RATE = 16000;            // samples a second
constexpr uint32_t PER_MS = SOUND_RATE / 1000;    // samples a millisecond
// Silence before every sound: a short sound that starts the speaker cold lost its start (heard on the band).
constexpr uint32_t LEAD_IN_MS = 40;

// The band's compiler takes C++11, where a constexpr function is one return
// statement: so these sums recurse rather than loop.

/** How long `count` segments last, in ms. */
constexpr uint32_t segmentsMs(const Segment* segments, size_t count) {
  return count ? segments->ms + segmentsMs(segments + 1, count - 1) : 0;
}

/** A sound's length in ms, its lead-in included; none, 0. app/lib/wrist.js soundMs(). */
inline uint32_t soundMs(const char* name) {
  const Sound* s = name ? soundFor(name) : nullptr;
  return s ? LEAD_IN_MS + segmentsMs(s->segments, s->count) : 0;
}

constexpr uint32_t longerOf(uint32_t a, uint32_t b) { return a > b ? a : b; }

/** The longest sound in the table from the i-th on, lead-in included, in ms: from 0, what one buffer must hold. */
constexpr uint32_t longestSoundMs(size_t i = 0) {
  return i == sizeof(SOUNDS) / sizeof(SOUNDS[0])
             ? 0
             : longerOf(LEAD_IN_MS + segmentsMs(SOUNDS[i].segments, SOUNDS[i].count), longestSoundMs(i + 1));
}

constexpr size_t SOUND_SAMPLES = longestSoundMs() * PER_MS;  // one buffer

/** The pitch `i` samples into a segment of `n`: the table's on a buzzer, an octave down on a speaker. */
inline int64_t pitchAt(const Segment& g, int64_t i, int64_t n, bool buzzer) {
  const int64_t from = buzzer ? g.hz0 : g.hz0 >> 1, to = buzzer ? g.hz1 : g.hz1 >> 1;
  return from + (to - from) * i / n;  // truncated toward zero, as Math.trunc: a downward slide agrees
}

/** The volume, 0 to 32767, `i` samples into a segment of `n`. A decay halves every b ms, straight between halvings. */
inline int64_t volumeAt(const Segment& g, int64_t i, int64_t n) {
  if (g.env == Env::FLAT) return g.a;
  if (g.env == Env::LINE) return g.a + (int64_t(g.b) - g.a) * i / n;
  const int64_t len = int64_t(g.b) * PER_MS, q = i / len;
  const int64_t hi = q < 16 ? g.a >> q : 0, lo = q < 15 ? g.a >> (q + 1) : 0;
  return hi - (hi - lo) * (i % len) / len;
}

/** One step of the noise's 16-bit LFSR, taps 0, 2, 3 and 5. */
inline uint16_t lfsrStep(uint16_t l) {
  return static_cast<uint16_t>((l >> 1) | (((l ^ (l >> 2) ^ (l >> 3) ^ (l >> 5)) & 1u) << 15));
}

/**
 * A sound as 8 bits unsigned at SOUND_RATE, as M5.Speaker.playRaw() takes it:
 * 128 is silence. The lead-in first, then each segment: a square's phase and
 * the noise's run on across segments, so a slide joins its next note without
 * a click. Integers only, so app/lib/sound.js renderSound() makes the same
 * bytes. On a `buzzer`, the table's pitches; otherwise an octave down. Writes
 * at most `cap` samples; returns how many.
 */
inline size_t render(const std::string& name, uint8_t* out, size_t cap, bool buzzer = false) {
  const Sound* s = soundFor(name);
  if (!s) return 0;
  size_t n = 0;
  for (size_t i = 0; i < LEAD_IN_MS * PER_MS && n < cap; ++i) out[n++] = 128;
  uint32_t phase = 0, noise = 0;
  uint16_t lfsr = 0xACE1;
  for (size_t k = 0; k < s->count; ++k) {
    const Segment& g = s->segments[k];
    const int64_t len = int64_t(g.ms) * PER_MS;
    for (int64_t i = 0; i < len && n < cap; ++i) {
      if (g.wave == Wave::REST) {
        out[n++] = 128;
        continue;
      }
      const uint32_t step = static_cast<uint32_t>((uint64_t(pitchAt(g, i, len, buzzer)) << 32) / SOUND_RATE);
      int64_t level;
      if (g.wave == Wave::SQUARE) {
        level = phase < 0x80000000u ? 1 : -1;
        phase += step;
      } else {
        const uint32_t was = noise;
        noise += step;
        if (noise < was) lfsr = lfsrStep(lfsr);
        level = (lfsr & 1) ? 1 : -1;
      }
      out[n++] = static_cast<uint8_t>(128 + level * volumeAt(g, i, len) * 127 / 32767);
    }
  }
  return n;
}
```

This removes `Note`, `notesMs`, `BUZZER_TOP_HZ`, `highestHz`, `buzzerFactor`, `BUZZER_OWN`, `buzzerOwn` and `buzzerNote`. Check that nothing else used them: `grep -rn "notesMs\|buzzerFactor\|buzzerOwn\|buzzerNote\|highestHz\|BUZZER_TOP_HZ\|struct Note\|Note " firmware/src firmware/host` should find nothing (`Note ` may match prose in comments; read each hit).

- [ ] **Step 4: `main.cpp` wording**

- Line 102: change `// a buzzer, as the StickC Plus has: sounds go octaves up` to `// a buzzer, as the StickC Plus has: sounds at the table's pitch; a speaker plays them an octave down`.
- Line 998: change `"on the buzzer, octaves up" : "on the speaker"` to `"on the buzzer" : "on the speaker, an octave down"`.
- Lines 1358–1359: change `same sounds through its buzzer, powered as above, whole octaves higher.` to `same sounds through its buzzer, powered as above, an octave above a speaker.`

- [ ] **Step 5: Run the firmware tests**

Run: `npm run build && node --test tests/firmware.test.js 2>&1 | tail -15`
Expected: PASS. Every firmware test passes, including the new byte-identical test and the case table run through `band_logic.h`. If the renders test fails, find the first sound whose hash differs. Dump both byte arrays (add a temporary `renderbytes <name>` verb, or print from JS) and find the first differing index. The usual cause is a trunc/floor mismatch on a negative value. Fix whichever side breaks the spec's rule, and do not change the rule.

- [ ] **Step 6: Mutation-check**

For each mutation, run `npm run build && node --test tests/firmware.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"` and see red, then restore:
- `sound.js`: `Math.trunc(((to - from) * i) / n)` → `Math.floor(...)`. The renders test fails on `low`, a downward slide.
- `band_logic.h`: `lfsrStep` taps `(l >> 5)` → `(l >> 4)`. The renders test fails on `low`; the host `sound()` does not catch it, which is expected, because the hash is what holds noise.
- `band_logic.h`: `LEAD_IN_MS = 40` → `48`. The host `sound()` fails, and so do the lengths in the renders test.
- `band_logic.h`: `const int64_t hi = q < 16 ? g.a >> q : 0` → `g.a >> q`. The host `sound()` fails (`volumeAt` far past the last halving). C++ shifting by 40 is undefined, and UBSan catches it if the build has it.
- `band_logic.h`: change one table volume, `9830` → `9831` in UP. The `sounds` table test and the renders test fail.

After restoring, run `npm run build` once more before going on.

- [ ] **Step 7: Both firmware builds**

Run from `firmware/`: `pio run -e m5stickc 2>&1 | tail -8` and then `pio run -e m5sticks3 2>&1 | tail -8`
Expected: `SUCCESS` for both. Compare the RAM line of `m5stickc` with the build before (`git stash`; `pio run -e m5stickc | grep RAM`; `git stash pop`). Static RAM should fall by about 640 bytes: two buffers, 9600 → 9280. Write both RAM lines into the ledger.

- [ ] **Step 8: Commit**

```bash
git add firmware/src/band_logic.h firmware/src/main.cpp firmware/host/logic_test.cpp tests/firmware.test.js
git commit -m "Sounds: the band renders the 8-bit table, byte for byte as the stand-in

The buzzer rules (buzzerFactor, buzzerOwn) go: the table is at the buzzer's
pitch, and a speaker plays it an octave down. Two sound buffers of 9280
bytes, from 9600.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The stand-in plays the rendered bytes

**Files:**
- Modify: `app/lib/speaker.js` (whole file)
- Modify: `tests/speaker.test.js` (whole file)

**Interfaces:**
- Consumes:
  - `renderSound(name)` and `SOUND_RATE` (Task 1);
  - `soundMs(name)` (Task 1).
- Produces:
  - `createSpeaker(make)`, with the same API as today (`unlock`, `ready`, `play(name) → boolean`), so `app/screens/Band.jsx` is unchanged;
  - `samplesOf(name) → Float32Array`.

- [ ] **Step 1: Write the failing tests**

Replace `tests/speaker.test.js` with:

```js
// ON THE BEAT — the stand-in's speaker: the band's own bytes, an octave down,
// and silent until the page has been tapped. A fake AudioContext stands in for
// the browser's, and records every buffer it is asked to play.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOUNDS, soundMs } from '../app/lib/wrist.js';
import { renderSound } from '../app/lib/sound.js';
import { createSpeaker, samplesOf } from '../app/lib/speaker.js';

/** An AudioContext that plays nothing and remembers everything. `running` is where resume() leaves it. */
function fakeContext({ running = true } = {}) {
  const ctx = {
    state: 'suspended',
    currentTime: 5,
    destination: {},
    sources: [],
    resume() { if (running) ctx.state = 'running'; return Promise.resolve(); },
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createBuffer(channels, length, sampleRate) {
      return { channels, length, sampleRate, data: null, copyToChannel(d, ch) { if (ch === 0) this.data = d; } };
    },
    createBufferSource() {
      const s = { buffer: null, started: null, stopped: [], connect() {} };
      s.start = (t) => { s.started = t; };
      s.stop = (t = 0) => { s.stopped.push(t); };
      ctx.sources.push(s);
      return s;
    },
  };
  return ctx;
}

test("a sound's samples are the band's bytes as -1 to 1, an octave down, lead-in and all", () => {
  for (const name of Object.keys(SOUNDS)) {
    const bytes = renderSound(name);
    const s = samplesOf(name);
    assert.equal(s.length, soundMs(name) * 16, name);
    assert.ok(s.every((v, i) => v === (bytes[i] - 128) / 128), name);
  }
  assert.ok(samplesOf('up').subarray(0, 640).every((v) => v === 0), 'lead-in is silence');
  assert.equal(samplesOf('no such sound').length, 0);
});

test('it is silent until the page has been tapped, and silent if the browser keeps it suspended', () => {
  const ctx = fakeContext();
  const speaker = createSpeaker(() => ctx);
  assert.equal(speaker.play('up'), false, 'before a tap');
  assert.equal(ctx.sources.length, 0);
  assert.equal(speaker.ready(), false);

  const held = fakeContext({ running: false });
  const quiet = createSpeaker(() => held);
  quiet.unlock();
  assert.equal(quiet.play('up'), false, 'suspended');
  assert.equal(held.sources.length, 0);
});

test('after a tap it plays one buffer at 16 kHz, now, and a new sound stops the last', () => {
  const ctx = fakeContext();
  const speaker = createSpeaker(() => ctx);
  speaker.unlock();
  assert.equal(speaker.ready(), true);
  assert.equal(speaker.play('up'), true);
  const [up] = ctx.sources;
  assert.equal(ctx.sources.length, 1);
  assert.equal(up.buffer.sampleRate, 16000);
  assert.equal(up.buffer.length, soundMs('up') * 16);
  assert.deepEqual([...up.buffer.data], [...samplesOf('up')]);
  assert.equal(up.started, 5);

  assert.equal(speaker.play('tick'), true);
  assert.equal(up.stopped.length, 1, 'cut off');
  assert.equal(ctx.sources.length, 2);
  assert.equal(speaker.play('no such sound'), false);
  assert.equal(ctx.sources.length, 2);
  assert.equal(ctx.sources[1].stopped.length, 0, 'an unknown name does not cut the last');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/speaker.test.js`
Expected: FAIL. `samplesOf` is not exported, and `play` calls `createOscillator`, which the fake no longer has.

- [ ] **Step 3: The speaker**

Replace `app/lib/speaker.js` with:

```js
// The wristband's speaker, in a browser (/band). It plays the bytes the band
// renders (app/lib/sound.js, as band_logic.h render()), an octave down as a
// speaker build plays them: 3 to 4.7 kHz squares are shrill on a laptop, and
// the tune survives the octave. One buffer, started on the audio clock, so the
// page's own drawing cannot bend the rhythm. A browser lets a page make sound
// only after it has been tapped, so it is silent until then. A new sound cuts
// off the one playing, as the band's does.

import { SOUND_RATE, renderSound } from './sound.js';

// Softer than the band, which plays at its full volume: a browser at full volume can be a headphone's.
const LEVEL = 0.5;

/** A sound's samples as Web Audio takes them, -1 to 1: the band's bytes, 128 the middle. */
export function samplesOf(name) {
  const bytes = renderSound(name);
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = (bytes[i] - 128) / 128;
  return out;
}

/** A speaker whose AudioContext is made at the first tap. `make` is for the tests. */
export function createSpeaker(make = () => new AudioContext()) {
  let ctx = null;
  let out = null;
  let playing = null;
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
      if (ctx?.state !== 'running') return false;
      const samples = samplesOf(name);
      if (!samples.length) return false;
      try { playing?.stop(); } catch { /* over already */ }
      const buffer = ctx.createBuffer(1, samples.length, SOUND_RATE);
      buffer.copyToChannel(samples, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(out);
      source.start(ctx.currentTime);
      playing = source;
      return true;
    },
  };
}
```

- [ ] **Step 4: Run them**

Run: `node --test tests/speaker.test.js`
Expected: PASS, 3/3.

- [ ] **Step 5: Mutation-check**

Make each mutation, see red, then restore:
- delete `try { playing?.stop(); } …`: "cut off" fails;
- `(bytes[i] - 128) / 128` → `bytes[i] / 128`: the first test fails;
- `renderSound(name)` → `renderSound(name, { buzzer: true })`: the first test fails (bytes differ from the speaker octave).

- [ ] **Step 6: Hear it in a browser**

Run `npm start` in the background, open `http://localhost:8790/band` in the built-in browser, and tap the page once. Then, from `javascript_tool`, check that Web Audio accepts a 16 kHz buffer:

```js
const c = new AudioContext(); const b = c.createBuffer(1, 1600, 16000); [b.sampleRate, b.length, c.state]
```

Expected: `[16000, 1600, …]` and no exception. Check `read_console_messages` with `onlyErrors: true` for errors from `speaker.js`. Then stop the server by port.

- [ ] **Step 7: Commit**

```bash
git add app/lib/speaker.js tests/speaker.test.js
git commit -m "Sounds: the stand-in plays the band's own bytes, an octave down

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Docs, the full suite

**Files:**
- Modify: `docs/wristband.md:82-86`, `:396-417`

- [ ] **Step 1: The reactions paragraph**

In `docs/wristband.md`, replace the sentence at lines 83–86:

> `held equal by tests/firmware.test.js; the notes are starting points, to be tuned by ear on a band. /band plays the same notes through Web Audio once its page has been tapped, which is when a browser first lets a page sound.`

with:

> held equal by `tests/firmware.test.js`. The sounds are 8-bit: square waves,
> noise and rests, chosen by ear on a band on 12 Oct 2026, and every piece of
> good news grows from one motif, F7 A7 C8
> (`docs/superpowers/specs/2026-10-12-band-sounds-8bit-design.md`). `/band`
> plays the band's own bytes, an octave down, through Web Audio once its page
> has been tapped, which is when a browser first lets a page sound.

- [ ] **Step 2: The buffer paragraph**

Replace the bullet at lines 396–417 (`- **A sound plays from a buffer of its own.**` through `…\`show\` prints the free heap.`) with:

```markdown
- **A sound plays from a buffer of its own.** When the wrist names a sound,
  `main.cpp` renders it as 8-bit samples at 16 kHz (`render()`, in
  `band_logic.h`, so the host tests hold it) and hands that to
  `M5.Speaker.playRaw()`, so painting the face cannot bend a tune's rhythm.
  The render is integers only, and `app/lib/sound.js` is the same function:
  a test holds the two to the same bytes. Every sound starts with 40 ms of
  silence, because a short sound that started the speaker cold lost its
  start. There are two buffers of 9.28 KB, used in turn, and one is written
  again only once M5Unified says the speaker has let it go: its buffer
  release callback, which is why the firmware needs M5Unified 0.2.22 or
  later. The StickC Plus plays the sounds through its buzzer, which runs
  off the 5V output the StickS3 keeps off so as to charge, so `setup()`
  switches that output back on for the Plus alone. A buzzer is loud only
  high up, from about 2.8 to 4.7 kHz on the Plus, so the table is written
  at the buzzer's pitch and a speaker plays it an octave down; a host test
  refuses a note that starts outside 2.6–4.8 kHz. The first M5StickC has no
  speaker; it says so once on the console and only lights up. The Plus has
  no PSRAM, and the buffers share its static RAM with everything else: a
  firmware that held a 24 KB buffer could no longer open TLS to the relay,
  so a host test keeps a buffer at 9600 samples or fewer. `show` prints the
  free heap.
```

- [ ] **Step 3: The full suite**

Run: `npm test > "$TMPDIR/otb-test.log" 2>&1; tail -25 "$TMPDIR/otb-test.log"`. Use the scratchpad path for the log.
Expected: `# fail 0`. The pass count is today's count plus the new tests (sound.test.js 10, firmware renders 1), minus the old `notesAt` test. A single file lost to exit `0xC0000409` is the known native-abort flake (memory `test-native-abort`): rerun that file alone, and record both runs.

- [ ] **Step 4: Commit**

```bash
git add docs/wristband.md
git commit -m "Docs: the wristband's sounds are 8-bit, rendered the same on band and stand-in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Acceptance on the band (needs him)

This task is not code. Each step that flashes a board or plays a sound waits for him.

- [ ] **Step 1: Ask before flashing.** Use AskUserQuestion to ask which test band to flash (COM9 or COM11, whichever is plugged in now). Flash it only with his yes. The other two Plus are not flashed.

Note: this flashes `sounds-8bit`, which is `main` plus sounds, and has no motion code. The band will not have the clink and wave from `wrist-motion` until Task 7. Say so when asking.

- [ ] **Step 2: Flash and check it reaches the relay.**

Run from `firmware/`: `pio run -e m5stickc -t upload --upload-port COM<n>`. Then run the scratchpad `ask.py` with `show`. Expected: the band is on Y70 and the relay is linked. Note the free-heap figure, which should be no lower than the wrist-motion build's ~110 KB. If the relay never links, stop: that is the TLS memory failure seen on 12 Oct, and the buffers are the first suspect.

Note that Fly runs `wrist-motion` (relay e5f14fc). This band's firmware is `main` plus sounds. The wire protocol between them is unchanged, but the band will not send clinks.

- [ ] **Step 3: Play the twelve for his ear.** Send `sound <name>` over the console, twice each, in the table's order: tick, double, up, fall, low, hello, jingle, found, calledit, ask, down, warn. Tell him that `warn`'s rests are now 30 ms and its gap 120 ms, and that the decays are now half-lives. Ask with AskUserQuestion whether each family sounds right. Any sound he rejects goes back to design, and nothing merges.

- [ ] **Step 4: Dropped ticks.** Ask him to press a key five times in a row, at about two presses a second. Expected: five ticks heard, and five `sound: tick` lines on the console.

- [ ] **Step 5: Record.** Write the outcome to `C:\Users\LewisDong\Documents\on-the-beat-proposals\wrist-motion\results.md` under a new heading "Sounds, 8-bit, on the band". This file is outside the repository. Record his answers, the heap figure and the tick count.

---

### Task 6: Merge and push (his 「合并并推送」)

- [ ] **Step 1:** `git checkout main && git merge --ff-only sounds-8bit`. If it is not a fast-forward, stop and ask.
- [ ] **Step 2:** `npm test` on `main` gives `# fail 0`.
- [ ] **Step 3:** `git push origin main`. A failure to connect to github.com:443 is the network: retry, and leave the git config alone. The remote is `LewisSwan24/on-the-beat`. The pre-push hook refuses any cimi2232 remote.
- [ ] **Step 4:** Do not redeploy Fly. The live relay serves `/band` from `wrist-motion`, so the stand-in's new sounds go live only with a deploy, and a deploy waits for his word.

---

### Task 7: Carry it onto the other branches (after the merge)

- [ ] **Step 1:** Rebase `beat-port` onto the new `main` and resolve any conflicts in `band_logic.h`. The beat code touches the wrist, not the sound table. `npm test` gives `# fail 0`. `beat-port` is pushed, so pushing the rebase is a force-push to a shared branch: ask him first.
- [ ] **Step 2:** Rebase `wrist-motion` onto the rebased `beat-port`. It is local only and stays unpushed. Then add its two sounds to both tables, plus the call sites that today play `hello`/`double` for a raised wave and a clink, and update the host and JS tests:
  - `waving`: `[slide(F7, D8, 80)]`, with an envelope from 1.0 to 0.6. Write it as a LINE slide: `['square', 2794, 4699, 80, 'line', 32767, 19660]`, and in C++ `{Wave::SQUARE, HZ_F7, HZ_D8, 80, Env::LINE, FULL, 19660}`.
  - `clink`: `[noise(9000, 6, FULL, 16384), struck(C8, 260, FULL, 51)]`.
  Both stay under 540 ms, so `SOUND_SAMPLES` does not change.
- [ ] **Step 3:** With his yes, flash the two test bands from `wrist-motion`. Ask before any Fly redeploy.

---

## Self-review against the spec

- **Sounds table:** Task 1, step 3 (JS) and Task 2, step 3 (C++). The values match the spec's table, with `warn` at 30/120 and decays as half-lives.
- **Integer render, its seven rules:** Task 1, step 4 and Task 2, step 3. The byte-identical hash is Task 2, step 1.
- **Pitch per device:** `pitchAt` (buzzer as written, speaker `>> 1`). The buzzer rules are removed in Task 2, step 3.
- **Memory bound:** host `CHECK(SOUND_SAMPLES <= 9600)` and JS "fits one buffer", with RAM compared in Task 2, step 7.
- **What does not change:** the call sites are untouched, and the wrist table is checked in Task 1, step 7.
- **soundMs with the lead-in:** both sides. The queue's `until` follows.
- **Stand-in:** Task 3.
- **Tests listed in the spec:**
  - byte-identical: Task 2;
  - tables equal: Task 2;
  - pitch guard: Tasks 1 and 2;
  - memory: Tasks 1 and 2;
  - lead-in, decay, slide and noise: Tasks 1 and 2;
  - reaction timing: Task 1, step 7;
  - stand-in: Task 3.
- **Acceptance:** Task 5. **Order and release:** Tasks 6 and 7.
- **Ruled here, not in the spec:**
  1. The square samples its level and then advances its phase, while noise advances, steps the LFSR on a wrap, and then samples. The spec does not fix this order, and both sides follow it.
  2. Noise pitch halves on a speaker like every other pitch, because the spec says "every pitch one octave down".
  3. The decay is clamped at 16 halvings, because a Q15 volume is 0 by then and JS `>>` wraps at 32.
