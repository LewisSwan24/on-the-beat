// ON THE BEAT — the stand-in's speaker: the band's notes in the band's rhythm,
// and silent until the page has been tapped. A fake AudioContext stands in for
// the browser's, and records every oscillator it is asked for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOUNDS } from '../app/lib/wrist.js';
import { createSpeaker, notesAt } from '../app/lib/speaker.js';

/** An AudioContext that plays nothing and remembers everything. `running` is where resume() leaves it. */
function fakeContext({ running = true } = {}) {
  const ctx = {
    state: 'suspended',
    currentTime: 5,
    destination: {},
    oscillators: [],
    resume() { if (running) ctx.state = 'running'; return Promise.resolve(); },
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createOscillator() {
      const o = { type: 'sine', frequency: { value: 440 }, started: null, stopped: [], connect() {} };
      o.start = (t) => { o.started = t; };
      o.stop = (t = 0) => { o.stopped.push(t); };
      ctx.oscillators.push(o);
      return o;
    },
  };
  return ctx;
}

const close = (a, b) => Math.abs(a - b) < 1e-9;

test("each sounding note starts where the one before it ended, and a rest only takes its time", () => {
  const ask = notesAt('ask', 10);
  assert.deepEqual(ask.map((n) => n.hz), [1319, 1760]);
  assert.ok(close(ask[0].start, 10) && close(ask[0].stop, 10.08));
  assert.ok(close(ask[1].start, 10.13) && close(ask[1].stop, 10.29), 'after the 50 ms rest');
  for (const [name, notes] of Object.entries(SOUNDS)) {
    const at = notesAt(name, 0);
    const total = notes.reduce((t, [, ms]) => t + ms, 0) / 1000;
    assert.equal(at.length, notes.filter(([hz]) => hz).length, name);
    assert.ok(close(at.at(-1).stop, total), name + ' ends when its notes do');
  }
  assert.deepEqual(notesAt('no such sound', 0), []);
});

test('it is silent until the page has been tapped, and silent if the browser keeps it suspended', () => {
  const ctx = fakeContext();
  const speaker = createSpeaker(() => ctx);
  assert.equal(speaker.play('up'), false, 'before a tap');
  assert.equal(ctx.oscillators.length, 0);
  assert.equal(speaker.ready(), false);

  const held = fakeContext({ running: false });
  const quiet = createSpeaker(() => held);
  quiet.unlock();
  assert.equal(quiet.play('up'), false, 'suspended');
  assert.equal(held.oscillators.length, 0);
});

test("after a tap it plays the band's notes as triangle waves, on the audio clock, and a new sound cuts off the last", () => {
  const ctx = fakeContext();
  const speaker = createSpeaker(() => ctx);
  speaker.unlock();
  assert.equal(speaker.ready(), true);
  assert.equal(speaker.play('up'), true);
  const up = ctx.oscillators.slice();
  assert.deepEqual(up.map((o) => [o.type, o.frequency.value]), SOUNDS.up.map(([hz]) => ['triangle', hz]));
  notesAt('up', 5).forEach((n, i) => {
    assert.ok(close(up[i].started, n.start) && close(up[i].stopped[0], n.stop), 'note ' + i);
  });

  assert.equal(speaker.play('tick'), true);
  for (const o of up) assert.equal(o.stopped.length, 2, 'cut off');
  assert.equal(ctx.oscillators.length, up.length + 1);
  assert.equal(speaker.play('no such sound'), false);
  assert.equal(ctx.oscillators.length, up.length + 1);
});
