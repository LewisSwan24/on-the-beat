// ON THE BEAT — the beat on the wristband (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §2):
// what the microphone's samples become, and how the band follows the beat in them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEAT_BLOCK, BEAT_LOSE_MS, BEAT_RATE, BEAT_SETTLE, createBlockClock, createLevels, createTracker, pulseLight } from '../app/lib/beat.js';
import { handed, music, twoStep } from './beat-music.js';

/** `blocks` blocks of a sine at `hz` and amplitude `a`, as whole 16-bit samples, from sample `from`. */
export function tone(hz, blocks, a = 8000, from = 0) {
  return Array.from({ length: blocks * BEAT_BLOCK }, (_, i) => Math.round(a * Math.sin((2 * Math.PI * hz * (from + i)) / BEAT_RATE)));
}

/** Each block's five levels. */
function levelsOf(samples) {
  const lv = createLevels();
  const out = [];
  for (let i = 0; i + BEAT_BLOCK <= samples.length; i += BEAT_BLOCK) out.push(lv.block(samples.slice(i, i + BEAT_BLOCK)));
  return out;
}

test('each of the five bands hears its own part of the spectrum', () => {
  // Second-order filters overlap: a tone in the middle of a band is its loudest, by twice or more.
  for (const [hz, band] of [[60, 0], [250, 1], [700, 2], [2000, 3], [6000, 4]]) {
    const last = levelsOf(tone(hz, 40)).at(-1);
    const others = last.filter((_, i) => i !== band);
    assert.ok(others.every((v) => last[band] >= 2 * v), `${hz} Hz: ${last.map((v) => v.toFixed(0)).join(' ')}`);
  }
});

test('a level is the root mean square of the band in its block', () => {
  // A sine's RMS is its amplitude over the square root of two; a band-pass passes most of its middle.
  const last = levelsOf(tone(700, 40, 8000)).at(-1);
  assert.ok(Math.abs(last[2] - 8000 / Math.SQRT2) < 0.15 * (8000 / Math.SQRT2), String(last[2]));
});

test('silence is nothing, and a steady offset from zero is taken out', () => {
  assert.deepEqual(levelsOf(new Array(10 * BEAT_BLOCK).fill(0)).at(-1), [0, 0, 0, 0, 0]);
  const offset = levelsOf(new Array(200 * BEAT_BLOCK).fill(3000)).at(-1);
  assert.ok(offset.every((v) => v < 1), offset.join(' '));
});

test('the filters carry from one block to the next: a steady tone reads steady, and rings on once it stops', () => {
  // 125 Hz is one whole period a block, so once the filters settle every block reads the same.
  const lv = levelsOf([...tone(125, 60), ...new Array(BEAT_BLOCK).fill(0)]);
  for (let b = 40; b < 60; b++) for (let k = 0; k < 2; k++) assert.ok(Math.abs(lv[b][k] - lv[40][k]) <= 0.01 * lv[40][k], `block ${b} band ${k}`);
  // Started afresh each block, the silent block after it would read nothing at all.
  assert.ok(lv[60][0] > 0.1 * lv[59][0], `the block after: ${lv[60][0]} against ${lv[59][0]}`);
  assert.throws(() => createLevels().block(new Array(BEAT_BLOCK - 1).fill(0)), /128/);
});

/** Made-up music through a tracker: every pulse it decides, with the kicks the music played. */
function follow(parts, { latency = 0, seed = 1, tracker = createTracker() } = {}) {
  const m = music(parts, { seed });
  tracker.setLatency(latency);
  const pulses = [];
  for (const b of m.blocks) {
    tracker.hear(b.levels, b.t);
    pulses.push(...tracker.take());
  }
  return { ...m, pulses, at: pulses.map((p) => p.at) };
}
const nearest = (list, t) => list.reduce((a, x) => (Math.abs(x - t) < Math.abs(a - t) ? x : a), Infinity);
const onKicks = (at, kicks, ms) => at.every((p) => Math.abs(nearest(kicks, p) - p) <= ms);

test('a steady kick at 90, 120 and 160 BPM pulses within 4 s, and then on every kick, a few ms after it', () => {
  for (const bpm of [90, 120, 160]) {
    const r = follow([{ ms: 12000, bpm, noise: 200 }]);
    assert.ok(r.at.length && r.at[0] - r.beats[0] <= 4000, `${bpm} BPM: first pulse at ${r.at[0]}`);
    for (const b of r.beats.filter((k) => k >= r.at[0] - 20)) {
      const e = nearest(r.at, b) - b;
      assert.ok(e >= 0 && e <= 10, `${bpm} BPM: the kick at ${b} pulsed ${e} ms after it`);
    }
    // Every pulse is on a kick, but the one carried past the music's end.
    assert.ok(onKicks(r.at.filter((p) => p < 12000), r.beats, 10), `${bpm} BPM: ${r.at.join(' ')}`);
  }
});

test('a pulse carries the period of the grid it was laid on', () => {
  for (const bpm of [90, 120, 160]) {
    const r = follow([{ ms: 12000, bpm, noise: 200 }]);
    assert.ok(r.pulses.every((p) => Math.abs(p.period - 60000 / bpm) <= 0.01 * (60000 / bpm)), `${bpm} BPM`);
  }
});

test('silence, steady noise and a held chord pulse nothing', () => {
  for (const part of [{ ms: 15000 }, { ms: 15000, noise: 2000 }, { ms: 15000, pad: 3000, noise: 300 }]) {
    assert.deepEqual(follow([part]).at, [], JSON.stringify(part));
  }
});

test('kicks at random and made-up speech seldom pulse: under one pulse a minute', () => {
  // Chance onsets can line up for a few beats; four of five beats heard, five deep, keeps it rare (README).
  let pulses = 0;
  for (const part of [{ clicks: 2, noise: 200 }, { clicks: 4, noise: 200 }, { talk: true, noise: 200 }, { talk: true, pad: 2000, noise: 300 }]) {
    for (let seed = 1; seed <= 5; seed++) pulses += follow([{ ms: 20000, ...part }], { seed }).at.length;
  }
  assert.ok(pulses < 400 / 60, `${pulses} pulses in 400 s`);
});

test('a missed kick is carried by the clock: its beat pulses anyway, and so does the next', () => {
  const r = follow([{ ms: 12000, bpm: 120, miss: [16], noise: 200 }]);
  const [gone] = r.missed;
  assert.ok(Math.abs(nearest(r.at, gone) - gone) <= 10, `nothing near the missing kick at ${gone}`);
  assert.ok(Math.abs(nearest(r.at, gone + 500) - (gone + 500)) <= 10, 'nothing on the kick after it');
});

test('a drum near a beat but well off it neither counts as the beat nor pulls the grid', () => {
  // The kick at 8000 comes 45 ms late: inside the beat's window, but not within BEAT_TIGHT_MS of it.
  const r = follow([{ ms: 12000, bpm: 120, miss: [16], extra: [8045], noise: 200 }]);
  const kicks = r.beats.filter((b) => b !== 8045);
  assert.ok(Math.abs(nearest(r.at, 8000) - 8000) <= 10, 'the beat is carried where it was');
  for (const b of kicks.filter((k) => k > 8000)) {
    const e = nearest(r.at, b) - b;
    assert.ok(e >= 0 && e <= 10, `the kick at ${b} pulsed ${e} ms after it`);
  }
});

test('a drum is timed from where its rise began, not from its peak', () => {
  // The click rises in one block and the drum's body, the bigger rise, in the next: the beat is the click's block.
  const { blocks, beats } = twoStep({ bpm: 125, ms: 12000 });
  const tracker = createTracker();
  const at = [];
  for (const b of blocks) {
    tracker.hear(b.levels, b.t);
    at.push(...tracker.take().map((p) => p.at));
  }
  assert.ok(at.length > 10, `${at.length} pulses`);
  for (const p of at.slice(4)) assert.ok(Math.abs(nearest(beats, p) - p) <= 2, `a pulse at ${p}`);
});

test('a song that stops dead is quiet within two beats', () => {
  const r = follow([{ ms: 10000, bpm: 120, noise: 200 }, { ms: 4000, noise: 200 }]);
  const after = r.at.filter((p) => p >= 10000 - 20);
  assert.ok(after.length <= 2 && after.every((p) => p < 11000), after.join(' '));
});

test('an off-beat hi-hat never moves the grid', () => {
  const r = follow([{ ms: 8000, bpm: 120, pad: 3000, noise: 800 }, { ms: 8000, bpm: 120, hat: true, pad: 3000, noise: 800 }]);
  const late = r.at.filter((p) => p > 8000 && p < 16000);
  assert.equal(late.length, 16);
  assert.ok(onKicks(late, r.beats, 10), late.join(' '));
});

test('a new song at another tempo takes over within 4 s, with at most two pulses off its beat', () => {
  const r = follow([{ ms: 10000, bpm: 120, noise: 200 }, { ms: 10000, bpm: 150, noise: 200 }]);
  const kicks = r.beats.filter((b) => b >= 10000);
  const after = r.at.filter((p) => p >= 10000 - 20);
  assert.ok(after.filter((p) => !onKicks([p], kicks, 40)).length <= 2, after.join(' '));
  const on = (b) => Math.abs(nearest(after, b) - b) <= 40;
  const back = kicks.findIndex((b, i) => i > 0 && on(b) && on(kicks[i + 1]) && on(kicks[i + 2]));
  assert.ok(back > 0 && kicks[back] - 10000 <= 4000, `back on the beat at ${kicks[back]}`);
});

test("a gap in listening for a reaction's sound does not stop the pulse", () => {
  // The kicks play on through 600 ms the microphone does not hear; the clock runs on.
  const r = follow([{ ms: 10000, bpm: 120, noise: 200 }, { ms: 600, bpm: 120, gap: true }, { ms: 6000, bpm: 120, first: 400, noise: 200 }]);
  for (const b of r.beats.filter((k) => k >= 10600)) assert.ok(Math.abs(nearest(r.at, b) - b) <= 10, `the kick at ${b}`);
});

test("the pulses come out the microphone's delay ahead of the beat", () => {
  const parts = [{ ms: 12000, bpm: 120, noise: 200 }];
  const early = follow(parts, { latency: 40 }).at;
  const plain = follow(parts).at;
  assert.equal(early.length, plain.length);
  early.forEach((p, i) => assert.ok(Math.abs(p - (plain[i] - 40)) < 1e-6, `pulse ${i}: ${p} against ${plain[i]}`));
});

test('reset forgets the beat: it must be found again from nothing', () => {
  const tracker = createTracker();
  const m = music([{ ms: 16000, bpm: 120, noise: 200 }]);
  const at = [];
  for (const b of m.blocks) {
    if (b.t === 8000) tracker.reset();
    tracker.hear(b.levels, b.t);
    at.push(...tracker.take().map((p) => p.at));
  }
  assert.ok(at.some((p) => p < 8000), 'it pulsed before');
  assert.ok(!at.some((p) => p >= 8000 && p < 10000), at.join(' '));
  assert.ok(at.some((p) => p >= 10000 && p < 12000), 'and found it again');
});

test('a grid with nothing heard for BEAT_LOSE_MS is dropped', () => {
  const tracker = createTracker();
  const m = music([{ ms: 10000, bpm: 120, noise: 200 }, { ms: 6000, noise: 200 }]);
  const last = m.beats.at(-1);
  for (const b of m.blocks) {
    tracker.hear(b.levels, b.t);
    if (b.t === 10000) assert.equal(tracker.state().locked, true, 'locked on the song');
    if (b.t === Math.floor((last + BEAT_LOSE_MS) / 8) * 8) assert.equal(tracker.state().locked, true, `at ${b.t}`);
    if (b.t === Math.ceil((last + BEAT_LOSE_MS) / 8) * 8 + 16) assert.equal(tracker.state().locked, false, `at ${b.t}`);
  }
  assert.deepEqual(tracker.state(), { locked: false, period: 0 });
});

test("a pulse is the card's full light on the beat, falling in a straight line to half over two thirds of it", () => {
  assert.equal(pulseLight(255, 0, 500), 255);
  assert.equal(pulseLight(255, 500 / 6, 500), 255 - Math.floor(127.5 / 4));
  assert.equal(pulseLight(255, 500 / 3, 500), 255 - Math.floor(127.5 / 2));
  assert.equal(pulseLight(255, 1000 / 3, 500), 128);
  assert.equal(pulseLight(255, 499, 500), 128);
  // Never lower, and from a dimmed card's half light, half of that.
  assert.equal(pulseLight(255, 5000, 500), 128);
  assert.equal(pulseLight(128, 0, 500), 128);
  assert.equal(pulseLight(128, 400, 500), 64);
});

test('blocks handed over two at a time are timed a block apart, and held to the band clock however the microphone runs', () => {
  for (const ppm of [-382, 0, 382]) {
    const clock = createBlockClock();
    const got = handed(75000, ppm).map((b) => ({ ...b, t: clock.at(b.arrival) })); // ten minutes
    assert.ok(got.slice(0, BEAT_SETTLE).every((b) => b.t === null), `${ppm} ppm: the first blocks settle`);
    const heard = got.slice(BEAT_SETTLE);
    heard.forEach((b, i) => {
      assert.ok(Math.abs(b.t - b.end) <= 1.5, `${ppm} ppm, block ${i}: ${b.t} against ${b.end}`);
      assert.ok(b.t <= b.arrival, `${ppm} ppm, block ${i}: timed after it was handed over`);
      if (i) assert.ok(Math.abs(b.t - heard[i - 1].t - 8) <= 1, `${ppm} ppm, block ${i}: ${heard[i - 1].t} then ${b.t}`);
    });
  }
});

test('blocks the band could not keep are counted over: the time steps across them', () => {
  const clock = createBlockClock();
  const got = [];
  handed(300, -382).forEach((b, k) => {
    if (k >= 100 && k < 110) return;
    got.push({ k, ...b, t: clock.at(b.arrival, k === 110 ? 10 : 0) });
  });
  const at = (k) => got.find((b) => b.k === k).t;
  assert.ok(Math.abs(at(110) - at(99) - 88) <= 1, `${at(99)} then ${at(110)}`);
  for (const b of got.slice(BEAT_SETTLE)) assert.ok(Math.abs(b.t - b.end) <= 1.5, `block ${b.k}: ${b.t} against ${b.end}`);
});

test('samples lost uncounted are caught up within about a second, and no block is timed after it was handed over', () => {
  const clock = createBlockClock();
  const got = [];
  handed(500, 0).forEach((b, k) => {
    if (k === 100 || k === 101) return; // 16 ms the microphone lost, and nobody counted
    got.push({ k, ...b, t: clock.at(b.arrival) });
  });
  for (const b of got.slice(BEAT_SETTLE)) assert.ok(b.t <= b.arrival, `block ${b.k}: ${b.t} after ${b.arrival}`);
  for (const b of got.filter((b) => b.k >= 102 + 136)) assert.ok(Math.abs(b.t - b.end) <= 1.5, `block ${b.k}: ${b.t} against ${b.end}`);
});

test('the first BEAT_SETTLE blocks after the microphone opens are not heard, and reset opens it afresh', () => {
  const clock = createBlockClock();
  const first = handed(40, 0, 5000).map((b) => clock.at(b.arrival));
  assert.equal(first.findIndex((t) => t !== null), BEAT_SETTLE);
  clock.reset();
  const later = handed(40, 0, 9000); // opened again four seconds on
  const again = later.map((b) => clock.at(b.arrival));
  assert.equal(again.findIndex((t) => t !== null), BEAT_SETTLE);
  assert.ok(Math.abs(again[BEAT_SETTLE] - later[BEAT_SETTLE].end) <= 1.5, `timed from the new count: ${again[BEAT_SETTLE]}`);
});
