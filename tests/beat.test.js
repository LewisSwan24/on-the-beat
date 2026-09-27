// ON THE BEAT — the beat on the wristband (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §2):
// what the microphone's samples become, and how the band follows the beat in them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEAT_BLOCK, BEAT_RATE, createLevels } from '../app/lib/beat.js';

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
