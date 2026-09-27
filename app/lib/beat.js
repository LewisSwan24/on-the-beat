// ON THE BEAT — the beat on the wristband (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §2).
// What the microphone's samples become: five levels a block, which the band's
// tracker follows. The band's twin is Levels in firmware/src/beat_logic.h, held
// to this one on the same samples by tests/firmware.test.js.

/** The microphone's rate, and the samples in one block: 8 ms of sound. */
export const BEAT_RATE = 16000;
export const BEAT_BLOCK = 128;

/** Where the five bands meet: below 150 Hz, up to 400, 1200, 3500, and above. */
export const BEAT_BANDS_HZ = [150, 400, 1200, 3500];

/** A second-order low or high pass at `fc`, Q 0.7071 (the RBJ cookbook), carried from call to call. */
function biquad(kind, fc) {
  const w = (2 * Math.PI * fc) / BEAT_RATE;
  const cw = Math.cos(w);
  const al = Math.sin(w) / (2 * 0.7071);
  const a0 = 1 + al;
  const b = kind === 'low' ? [(1 - cw) / 2, 1 - cw, (1 - cw) / 2] : [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
  const [b0, b1, b2, a1, a2] = [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * cw) / a0, (1 - al) / a0];
  let z1 = 0;
  let z2 = 0;
  return (x) => {
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  };
}

/**
 * Five levels a block: the root mean square of each band over its 128 samples,
 * after a slow tracker has taken out any offset from zero. The filters carry
 * from one block to the next, so a steady sound reads steady.
 */
export function createLevels() {
  const [f150, f400, f1200, f3500] = BEAT_BANDS_HZ;
  const lo150 = biquad('low', f150);
  const hi150 = biquad('high', f150);
  const lo400 = biquad('low', f400);
  const hi400 = biquad('high', f400);
  const lo1200 = biquad('low', f1200);
  const hi1200 = biquad('high', f1200);
  const lo3500 = biquad('low', f3500);
  const hi3500 = biquad('high', f3500);
  let dc = 0;
  return {
    /** One block of whole 16-bit samples in, its five levels out. */
    block(samples) {
      if (samples.length !== BEAT_BLOCK) throw new Error(`a block is ${BEAT_BLOCK} samples, not ${samples.length}`);
      const sum = [0, 0, 0, 0, 0];
      for (const x of samples) {
        dc += 0.001 * (x - dc);
        const y = x - dc;
        const v = [lo150(y), lo400(hi150(y)), lo1200(hi400(y)), lo3500(hi1200(y)), hi3500(y)];
        for (let k = 0; k < 5; k++) sum[k] += v[k] * v[k];
      }
      return sum.map((s) => Math.sqrt(s / BEAT_BLOCK));
    },
  };
}
