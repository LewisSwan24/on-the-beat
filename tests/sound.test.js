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

test('a slide ends within one step of its last pitch, down as well as up, and halves on a speaker', () => {
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

test('every segment is one the render can make the same on both sides', () => {
  // At 16 kHz a step is 2^32, where C++ wraps it and JS does not; over 32767 a volume wraps its byte;
  // a decay with no half-life divides by zero, which on the band is a reboot.
  for (const [name, segs] of Object.entries(SOUNDS)) {
    for (const [wave, hz0, hz1, ms, env, a, b] of segs) {
      assert.ok(hz0 < 16000 && hz1 < 16000 && ms > 0, name);
      if (wave === 'rest') continue;
      assert.ok(a <= 32767 && (env !== 'line' || b <= 32767), name + ' volume');
      assert.ok(env !== 'decay' || b > 0, name + ' half-life');
    }
  }
});

test('the longest sound fits one buffer of 9600 samples', () => {
  const longest = Math.max(...Object.keys(SOUNDS).map(soundMs));
  assert.equal(longest, 580);
  assert.ok(longest * PER_MS <= 9600);
});
