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
