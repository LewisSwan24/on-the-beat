// ON THE BEAT — the beat on the wristband (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §2).
// What the microphone's samples become, five levels a block, and the tracker
// that follows the beat in them and says where to pulse. The band's twins are
// Levels and BeatTracker in firmware/src/beat_logic.h, held to these by
// tests/firmware.test.js on the same samples and the same blocks.

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

// The tracker's named values (§2's table), all a guess until worn. beat_logic.h has the same, held equal.
export const BEAT_ONSET = 2.5;            // a heard beat's rise, against the window's mean onset strength...
export const BEAT_ONSET_MIN = 6;          // ...and never below this, in dB
export const BEAT_WINDOW_MS = 6000;       // the onset strength the tempo is read from
export const BEAT_LOOK_MS = 128;          // how often the tempo is read
export const BEAT_SHORTEST_MS = 336;      // the periods read: 178 BPM...
export const BEAT_LONGEST_MS = 752;       // ...to 80
export const BEAT_PRIOR_MS = 500;         // the tempo a listener would tap...
export const BEAT_PRIOR_OCT = 0.7;        // ...and how firmly, in octaves
export const BEAT_LOCK_CONF = 4;          // how far the best period must stand out, in standard deviations
export const BEAT_LOCK_CONTRAST = 4.5;    // how far the beat must stand out of its own period
export const BEAT_LOCK_LOOKS = 6;         // looks in a row with the same period...
export const BEAT_STEADY = 0.02;          // ...within this much of it
export const BEAT_PHASE_MS = 2000;        // the stretch folded to place the grid
export const BEAT_NEAR = 0.12;            // of a period, either side of a beat
export const BEAT_RISE = 0.25;            // a rise is traced back while it is at least this much of its peak
export const BEAT_TIGHT_MS = 30;          // how near its beat a drum must start for the beat to be heard
export const BEAT_PULL_PHASE = 0.3;       // how far a heard beat pulls the next beat...
export const BEAT_PULL_PERIOD = 0.05;     // ...and the period
export const BEAT_CHANGE = 0.05;          // the most the period moves from its lock; more is another song
export const BEAT_START = 4;              // a new grid pulses once this many...
export const BEAT_START_OF = 5;           // ...of the last this many were heard, looking back from where it was laid...
export const BEAT_CONFIRM = 2;            // ...and keeps pulsing while this many...
export const BEAT_OF = 3;                 // ...of the last this many were
export const BEAT_HOLD = 4;               // or one was, with the fold on the grid peaking this far above its mean
export const BEAT_OTHER_LOOKS = 8;        // looks before a heard grid gives way
export const BEAT_LOSE_MS = 4000;         // nothing heard this long, and the grid is dropped

/** Every value above, by name. */
export const BEAT_CONSTS = {
  BEAT_ONSET, BEAT_ONSET_MIN, BEAT_WINDOW_MS, BEAT_LOOK_MS, BEAT_SHORTEST_MS, BEAT_LONGEST_MS, BEAT_PRIOR_MS,
  BEAT_PRIOR_OCT, BEAT_LOCK_CONF, BEAT_LOCK_CONTRAST, BEAT_LOCK_LOOKS, BEAT_STEADY, BEAT_PHASE_MS, BEAT_NEAR,
  BEAT_RISE, BEAT_TIGHT_MS, BEAT_PULL_PHASE, BEAT_PULL_PERIOD, BEAT_CHANGE, BEAT_START, BEAT_START_OF, BEAT_CONFIRM, BEAT_OF,
  BEAT_HOLD, BEAT_OTHER_LOOKS, BEAT_LOSE_MS,
};

const BLOCK_MS = (BEAT_BLOCK * 1000) / BEAT_RATE;
const WINDOW = BEAT_WINDOW_MS / BLOCK_MS;
const LOOK = BEAT_LOOK_MS / BLOCK_MS;
const SHORTEST = BEAT_SHORTEST_MS / BLOCK_MS;
const LONGEST = BEAT_LONGEST_MS / BLOCK_MS;

/**
 * Follows the beat in the five levels, block by block, and says where to pulse. Each block is handed in with the
 * time it ends, counted in samples; the pulses come out a block ahead, at each beat less the microphone's delay,
 * with the period they were laid on. In doubt it does not pulse.
 *
 * The levels, the onset strength and the tempo's sums are single precision (Math.fround), as the band's FPU keeps
 * them, and the rest double, as the band's BeatTracker does: so the twins agree to the bit.
 */
export function createTracker() {
  let latency = 0;
  let hist; // per band, its last three levels in dB
  let odf; // onset strength, one a block, single precision...
  let times; // ...and when
  let sum; // of odf
  let n; // blocks heard
  let lags; // the best period of the last looks, in blocks
  let locked;
  let period;
  let base; // the period locked
  let next; // the next beat
  let beat; // its number
  let decided; // the number of the last beat whose pulse was decided
  let other; // looks in a row at another grid
  let lastHeard;
  let beats; // the grid's recent beats: { t, h }, h once its window has closed; deaf, if it was not listened to
  let started;
  let held;
  let pulses;

  function reset() {
    hist = [[], [], [], [], []];
    odf = [];
    times = [];
    sum = 0;
    n = 0;
    lags = [];
    locked = false;
    period = 0;
    base = 0;
    next = 0;
    beat = 0;
    decided = -1;
    other = 0;
    lastHeard = -Infinity;
    beats = [];
    started = false;
    held = 0;
    pulses = [];
  }
  reset();

  const floor = () => Math.max(BEAT_ONSET_MIN, BEAT_ONSET * (odf.length ? sum / odf.length : 0));
  // The strongest rise in [a, b): its index, or -1.
  const argPeak = (a, b) => {
    let k = -1;
    for (let i = odf.length - 1; i >= 0 && times[i] >= a; i--) if (times[i] < b && (k < 0 || odf[i] > odf[k])) k = i;
    return k;
  };
  const val = (k) => (k < 0 ? 0 : odf[k]);

  // A beat whose window has closed: was it heard, and where did its drum start?
  function close(b) {
    const w = BEAT_NEAR * period;
    const k = argPeak(b.t - w, b.t + w);
    const off = Math.max(val(argPeak(b.t - period / 2, b.t - w)), val(argPeak(b.t + w, b.t + period / 2)));
    b.h = val(k) >= floor() && val(k) >= off;
    if (!b.h) return;
    let s = k;
    while (s > 0 && times[s - 1] >= b.t - w && odf[s - 1] >= BEAT_RISE * odf[k]) s--;
    const e = times[s] - b.t;
    // A drum that started well off the beat is another grid's, not this one's.
    if (Math.abs(e) > BEAT_TIGHT_MS) {
      b.h = false;
      return;
    }
    lastHeard = Math.max(lastHeard, b.t);
    // The loop: phase and period pulled a part of the way to the drum.
    next += BEAT_PULL_PHASE * e;
    period = Math.min(base * (1 + BEAT_CHANGE), Math.max(base * (1 - BEAT_CHANGE), period + BEAT_PULL_PERIOD * e));
  }

  // A beat the microphone was closed for is neither heard nor missed: it is not counted.
  const counted = () => beats.filter((b) => !b.deaf);

  // A new grid pulses once BEAT_START of its last BEAT_START_OF beats were heard; then BEAT_CONFIRM of the last
  // BEAT_OF keep it, or one, while something rose near the last beat and the fold on the grid stands out by BEAT_HOLD.
  function confirmed() {
    const heard = (n) => counted().slice(-n).filter((b) => b.h).length;
    if (!started && heard(BEAT_START_OF) >= BEAT_START) started = true;
    const h = heard(BEAT_OF);
    return started && (h >= BEAT_CONFIRM || (h >= 1 && rose() && held >= BEAT_HOLD));
  }

  // Something near the last beat rose as far as a heard beat must: the room has not gone quiet, nor the song moved.
  function rose() {
    const b = counted().at(-1);
    const w = BEAT_NEAR * period;
    return b !== undefined && val(argPeak(b.t - w, b.t + w)) >= floor();
  }

  // The last BEAT_PHASE_MS folded on the grid: its beat (BEAT_NEAR either side) against the fold's mean.
  function holding(now) {
    const P = period;
    const bins = Math.round(P / BLOCK_MS);
    const fold = new Array(bins).fill(0);
    for (let i = odf.length - 1; i >= 0 && now - times[i] <= BEAT_PHASE_MS; i--) {
      fold[Math.floor(((((times[i] - next) % P) + P) % P) / BLOCK_MS) % bins] += odf[i];
    }
    const fm = fold.reduce((s, v) => s + v, 0) / bins;
    const w = Math.round((BEAT_NEAR * P) / BLOCK_MS);
    let best = 0;
    for (let j = -w; j <= w; j++) best = Math.max(best, fold[(j + bins) % bins]);
    return fm > 0 ? best / fm : 0;
  }

  // The tempo read from the window, and where its grid would go.
  function candidate(now) {
    const N = odf.length;
    if (N < 3 * LONGEST) return null;
    const m = Math.fround(sum / N);
    const x = odf.map((v) => Math.fround(v - m));
    const r = (L) => {
      let s = 0;
      for (let i = L; i < N; i++) s = Math.fround(s + Math.fround(x[i] * x[i - L]));
      return Math.fround(s / (N - L));
    };
    const r0 = r(0) || 1;
    const prior = (L) => {
      const q = Math.log2((L * BLOCK_MS) / BEAT_PRIOR_MS) / BEAT_PRIOR_OCT;
      return Math.exp(-0.5 * q * q);
    };
    const score = [];
    for (let L = SHORTEST; L <= LONGEST; L++) score.push(prior(L) * (r(L) / r0 + (2 * L < N ? (0.5 * r(2 * L)) / r0 : 0)));
    let bi = 0;
    for (let i = 1; i < score.length; i++) if (score[i] > score[bi]) bi = i;
    const bestL = SHORTEST + bi;
    const rest = score.filter((_, i) => Math.abs(i - bi) > 4);
    const mu = rest.reduce((s, v) => s + v, 0) / rest.length;
    const sd = Math.sqrt(rest.reduce((s, v) => s + (v - mu) * (v - mu), 0) / rest.length) || 1e-9;
    const conf = (score[bi] - mu) / sd;
    lags.push(bestL);
    if (lags.length > BEAT_LOCK_LOOKS) lags.shift();
    const steady = lags.length === BEAT_LOCK_LOOKS && Math.max(...lags) - Math.min(...lags) <= Math.max(1, BEAT_STEADY * bestL);
    // A parabola through the peak: the period between blocks.
    const a = bi > 0 ? score[bi - 1] : score[bi];
    const b = score[bi];
    const d = bi < score.length - 1 ? score[bi + 1] : score[bi];
    const shift = a - 2 * b + d !== 0 ? (0.5 * (a - d)) / (a - 2 * b + d) : 0;
    const P = (bestL + Math.max(-0.5, Math.min(0.5, shift))) * BLOCK_MS;
    const bins = Math.round(P / BLOCK_MS);
    const fold = new Array(bins).fill(0);
    for (let i = N - 1; i >= 0 && now - times[i] <= BEAT_PHASE_MS; i--) fold[Math.floor((((times[i] % P) + P) % P) / BLOCK_MS) % bins] += odf[i];
    let ph = 0;
    for (let i = 1; i < bins; i++) if (fold[i] > fold[ph]) ph = i;
    const fm = fold.reduce((s, v) => s + v, 0) / bins;
    const contrast = fm > 0 ? (fold[ph] + (fold[(ph + 1) % bins] + fold[(ph + bins - 1) % bins]) / 2) / (2 * fm) : 0;
    return { ok: conf >= BEAT_LOCK_CONF && contrast >= BEAT_LOCK_CONTRAST && steady, P, phase: (ph + 0.5) * BLOCK_MS };
  }

  function grid(P, phase, now) {
    locked = true;
    period = P;
    base = P;
    other = 0;
    lastHeard = now;
    started = false;
    held = 0;
    next = Math.ceil((now - phase) / P) * P + phase;
    beat += 1;
    beats = [];
    // The beats just gone, heard or not by what is already in the window.
    for (let j = BEAT_START_OF; j >= 1; j--) {
      const b = { t: next - j * P };
      if (b.t + BEAT_NEAR * P <= now && b.t + P / 2 <= now) close(b);
      beats.push(b);
    }
  }

  function evaluate(now) {
    const cand = candidate(now);
    if (!cand) return;
    if (!locked) {
      if (cand.ok) grid(cand.P, cand.phase, now);
      return;
    }
    held = holding(now);
    if (!cand.ok) {
      other = 0;
      return;
    }
    const d = (((cand.phase - next) % cand.P) + cand.P) % cand.P;
    const differs = Math.abs(cand.P - period) > BEAT_CHANGE * period || Math.min(d, cand.P - d) > BEAT_NEAR * period;
    if (differs && !confirmed()) return grid(cand.P, cand.phase, now);
    other = differs ? other + 1 : 0;
    if (other >= BEAT_OTHER_LOOKS) grid(cand.P, cand.phase, now);
  }

  return {
    /** One block's five levels, and the time it ends. */
    hear(levels, now) {
      // Blocks not heard since the one before: the microphone was closed, and the clock ran on.
      const deaf = times.length && now - times.at(-1) > 1.5 * BLOCK_MS ? [times.at(-1), now - BLOCK_MS] : null;
      let f = 0;
      levels.forEach((v, i) => {
        const h = hist[i];
        h.push(20 * Math.log10(Math.fround(v) + 1));
        if (h.length > 3) h.shift();
        if (h.length === 3) f += Math.max(0, h[2] - Math.max(h[1], h[0]));
      });
      odf.push(Math.fround(f));
      sum += odf.at(-1);
      times.push(now);
      if (odf.length > WINDOW) {
        sum -= odf.shift();
        times.shift();
      }
      if (++n % LOOK === 0) evaluate(now);
      if (locked) {
        while (next <= now) {
          beats.push({ t: next });
          if (beats.length > 8) beats.shift();
          next += period;
          beat += 1;
        }
        if (deaf) for (const b of beats) if (Math.abs(b.t - (deaf[0] + deaf[1]) / 2) < (deaf[1] - deaf[0]) / 2 + BEAT_NEAR * period) b.deaf = true;
        // Beats whose windows, and the half beat after, have closed.
        for (const b of beats) if (b.h === undefined && !b.deaf && now >= b.t + period / 2) close(b);
        if (now - lastHeard > BEAT_LOSE_MS) {
          locked = false;
          period = 0;
        } else if (decided !== beat && next - latency <= now + BLOCK_MS) {
          // The next beat's pulse, decided in the last block before it is due.
          decided = beat;
          if (confirmed()) pulses.push({ at: next - latency, period });
        }
      }
    },
    /** Forget everything heard: the microphone has closed. */
    reset,
    /** The microphone's delay from a sound to the block that hears it, in ms. */
    setLatency(ms) {
      latency = ms;
    },
    /** The pulses decided since last asked: when each is due, and the beat's period. */
    take() {
      const out = pulses;
      pulses = [];
      return out;
    },
    /** Locked on a grid, and its period in ms (0 when not). */
    state: () => ({ locked, period }),
  };
}
