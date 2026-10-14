// ON THE BEAT — made-up music for the beat's tests, as the band's microphone hears it.
//
// A kick on the beat, a hi-hat between the beats, noise, talk and silence are
// made as 16 kHz samples, turned into five levels a block by the stand-in's own
// createLevels, and rounded to hundredths, so both twins can be handed exactly
// the same numbers (tests/firmware.test.js, tests/wrist-table.js).

import { BEAT_BLOCK, BEAT_RATE, createLevels } from '../app/lib/beat.js';

const PER_MS = BEAT_RATE / 1000;
const BLOCK_MS = BEAT_BLOCK / PER_MS;
const KICK = 0.3 * BEAT_RATE; // samples a kick sounds for
const HAT = 0.06 * BEAT_RATE;
// A held A major chord and its octaves, each note's share of the pad.
const PAD = [[220, 0.2], [277.18, 0.15], [329.63, 0.15], [440, 0.15], [554.37, 0.1], [659.26, 0.1], [880, 0.1], [1318.5, 0.05]];

/**
 * Levels made by hand, block by block: a quiet room, and on every beat at `bpm` (whole blocks apart) a drum whose rise
 * takes two blocks,
 * a click in the top band on the beat and its body in the two lowest one block later, as a kick's beater and skin.
 * `beats` are the blocks each click rises in.
 */
export function twoStep({ bpm, ms, from = 0 }) {
  const period = 60000 / bpm;
  if (period % BLOCK_MS) throw new Error(`${bpm} BPM is not whole blocks`);
  const blocks = [];
  const beats = [];
  let next = period;
  for (let t = BLOCK_MS; t <= ms; t += BLOCK_MS) {
    const levels = [20, 20, 20, 20, 20];
    const since = t - next;
    if (since >= 0 && since < BLOCK_MS) {
      levels[4] = 200;
      beats.push(from + t);
    } else if (since >= BLOCK_MS && since < 12 * BLOCK_MS) {
      const body = 2000 * Math.exp(-(since - BLOCK_MS) / 60);
      levels[0] = 20 + body;
      levels[1] = 20 + body / 2;
      levels[4] = 20 + 180 * Math.exp(-since / 20);
    }
    if (since >= 12 * BLOCK_MS) next += period;
    blocks.push({ t: from + t, levels: levels.map((v) => Math.round(v * 100) / 100) });
  }
  return { blocks, beats };
}

/**
 * Parts played one after another, each for `ms` (whole blocks):
 * - `bpm`: a kick on every beat, the first `first` ms into the part (0 by default); `miss` lists beats left out, by
 *   their number in the part;
 * - `hat`: a hi-hat halfway between the kicks;
 * - `extra`: kicks at these times, in ms into the part, beside any on the beat;
 * - `clicks`: kicks at random, this many a second on average, never two within 100 ms;
 * - `level`: the kick's and the hat's loudness, 1 by default;
 * - `pad`: a held chord throughout, at this amplitude, as a song's bed;
 * - `noise`: white noise throughout, at this amplitude;
 * - `talk`: speech: syllables at uneven times, in phrases with pauses between;
 * - `gap`: the microphone is closed: no blocks at all, while the clock runs on.
 * A block's time is when it ends, from `from`. `beats` are when each kick played starts; `missed`, when each beat
 * left out would have.
 */
export function music(parts, { from = 0, seed = 1 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  const levels = createLevels();
  const blocks = [];
  const beats = [];
  const missed = [];
  const block = new Array(BEAT_BLOCK);
  const kicks = []; // [first sample, loudness], in order
  const hats = [];
  let k0 = 0;
  let h0 = 0;
  let n = 0; // samples made so far
  let before = 0; // the last sample's white noise, for the hat's high-pass
  for (const p of parts) {
    if (p.ms % BLOCK_MS) throw new Error(`a part is whole blocks: ${p.ms} ms`);
    const start = n;
    const end = n + p.ms * PER_MS;
    for (const ms of p.extra ?? []) kicks.push([start + Math.round(ms * PER_MS), p.level ?? 1]);
    if (p.clicks) {
      for (let at = start - Math.log((rnd() + 1) / 2 || 1e-9) / p.clicks * BEAT_RATE; at < end; ) {
        kicks.push([Math.round(at), p.level ?? 1]);
        at += 0.1 * BEAT_RATE - Math.log((rnd() + 1) / 2 || 1e-9) / p.clicks * BEAT_RATE;
      }
    }
    if (p.bpm) {
      const period = 60000 / p.bpm;
      for (let k = 0; (p.first ?? 0) + k * period < p.ms; k++) {
        const at = start + Math.round(((p.first ?? 0) + k * period) * PER_MS);
        if (p.miss?.includes(k)) { missed.push(from + at / PER_MS); continue; }
        kicks.push([at, p.level ?? 1]);
        beats.push(from + at / PER_MS);
        if (p.hat) hats.push([at + Math.round((period / 2) * PER_MS), p.level ?? 1]);
      }
    }
    kicks.sort((a, b) => a[0] - b[0]);
    let syllable = null; // { start, end, hz, a }
    let nextSyllable = start;
    let left = 0; // syllables left in the phrase
    for (; n < end; n++) {
      let x = 0;
      while (k0 < kicks.length && n - kicks[k0][0] > KICK) k0++;
      for (let i = k0; i < kicks.length && kicks[i][0] <= n; i++) {
        const dt = (n - kicks[i][0]) / BEAT_RATE;
        x += 12000 * kicks[i][1] * Math.exp(-dt / 0.08) * Math.sin(2 * Math.PI * (50 * dt + 2 * (1 - Math.exp(-dt / 0.02))));
      }
      const white = rnd();
      while (h0 < hats.length && n - hats[h0][0] > HAT) h0++;
      for (let i = h0; i < hats.length && hats[i][0] <= n; i++) {
        const dt = (n - hats[i][0]) / BEAT_RATE;
        x += 3000 * hats[i][1] * Math.exp(-dt / 0.012) * (white - before);
      }
      before = white;
      if (p.noise) x += p.noise * rnd();
      if (p.pad) {
        for (const [hz, a] of PAD) x += p.pad * a * Math.sin((2 * Math.PI * hz * n) / BEAT_RATE);
      }
      if (p.talk) {
        if (n >= nextSyllable) {
          if (left <= 0) left = 3 + Math.floor(3.5 * (rnd() + 1));
          const len = Math.round((70 + 65 * (rnd() + 1)) * PER_MS);
          syllable = { start: n, end: n + len, hz: 110 + 55 * (rnd() + 1), a: 5000 + 2000 * rnd() };
          left -= 1;
          const after = left > 0 ? 20 + 50 * (rnd() + 1) : 300 + 350 * (rnd() + 1);
          nextSyllable = n + len + Math.round(after * PER_MS);
        }
        if (n < syllable.end) {
          const u = (n - syllable.start) / (syllable.end - syllable.start);
          const w = (2 * Math.PI * syllable.hz * (n - syllable.start)) / BEAT_RATE;
          x += syllable.a * Math.sin(Math.PI * u) * (Math.sin(w) + 0.5 * Math.sin(2 * w) + 0.25 * Math.sin(3 * w));
        }
      }
      if (p.gap) continue;
      block[n % BEAT_BLOCK] = Math.max(-32768, Math.min(32767, Math.round(x)));
      if (n % BEAT_BLOCK === BEAT_BLOCK - 1) {
        blocks.push({ t: from + (n + 1) / PER_MS, levels: levels.block(block).map((v) => Math.round(v * 100) / 100) });
      }
    }
  }
  return { blocks, beats, missed };
}

/**
 * A microphone handing its blocks over two at a time, as both bands' do, its samples running `ppm` from the band's
 * clock (-382 on both, measured 27 Sep 2026): when each block truly ended, and the whole millisecond it was handed
 * over, which is when the second of its pair ended.
 */
export function handed(blocks, ppm, from = 5000) {
  const end = (k) => from + (k + 1) * BLOCK_MS * (1 + ppm / 1e6);
  return Array.from({ length: blocks }, (_, k) => ({ end: end(k), arrival: Math.floor(end(k | 1)) }));
}
