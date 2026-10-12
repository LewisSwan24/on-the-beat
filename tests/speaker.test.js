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
    refuse: false,  // set: createBuffer throws, as a browser that will not take 16 kHz might
    state: 'suspended',
    currentTime: 5,
    destination: {},
    sources: [],
    resume() { if (running) ctx.state = 'running'; return Promise.resolve(); },
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createBuffer(channels, length, sampleRate) {
      if (ctx.refuse) throw new Error('NotSupportedError: sampleRate');
      const data = new Float32Array(length);
      return { channels, length, sampleRate, data, getChannelData: (ch) => (ch === 0 ? data : null) };
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

test('a browser that cannot make the buffer leaves it silent, throws nothing, and does not cut the last', () => {
  const ctx = fakeContext();
  const speaker = createSpeaker(() => ctx);
  speaker.unlock();
  assert.equal(speaker.play('up'), true);
  const [up] = ctx.sources;
  ctx.refuse = true;
  assert.equal(speaker.play('tick'), false);
  assert.equal(ctx.sources.length, 1);
  assert.equal(up.stopped.length, 0, 'what was playing plays on');
});
