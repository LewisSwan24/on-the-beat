// ON THE BEAT — the stand-in's LISTEN (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §3): the laptop's
// microphone, taken as the band takes its own. A fake browser stands in for the real one's microphone and audio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEAT_BLOCK, BEAT_RATE, BEAT_SETTLE, createBlockClock, createLevels } from '../app/lib/beat.js';
import { createEars, openMicrophone, toSamples } from '../app/lib/listen.js';

test("a browser's samples become the band's: whole 16-bit numbers, held at the ends", () => {
  assert.deepEqual(toSamples([0, 0.5, -0.5, 1, -1, 1.5, -1.5, 0.00002]), [0, 16384, -16384, 32767, -32768, 32767, -32768, 1]);
});

test('the ears cut what comes into blocks, and hand each its five levels at the time the block clock gives it', () => {
  const floats = Array.from({ length: 40 * BEAT_BLOCK }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / BEAT_RATE));
  const sizes = [100, 156, 384, 50, 78, 640, 128, 256, 1];
  const chunks = [];
  for (let at = 0, k = 0, t = 7000; at < floats.length; k += 1, t += 8) {
    const n = sizes[k % sizes.length];
    chunks.push({ floats: floats.slice(at, at + n), arrival: t });
    at += n;
  }
  const got = [];
  const ears = createEars((levels, t) => got.push({ levels, t }));
  for (const c of chunks) ears.take(c.floats, c.arrival);

  // The same blocks through the band's own pieces, each timed at the arrival of the chunk it was completed in.
  const samples = toSamples(floats);
  const levels = createLevels();
  const clock = createBlockClock();
  const want = [];
  let end = 0;
  for (const c of chunks) {
    end += c.floats.length;
    while (want.length < Math.floor(end / BEAT_BLOCK)) {
      const b = want.length;
      want.push({ levels: levels.block(samples.slice(b * BEAT_BLOCK, (b + 1) * BEAT_BLOCK)), t: clock.at(c.arrival) });
    }
  }
  assert.equal(want.length, 40);
  assert.deepEqual(got, want.filter((w) => w.t !== null));
  assert.equal(got.length, 40 - BEAT_SETTLE);
});

/** A browser with a microphone and Web Audio that remembers what it was asked. `fail` rejects the microphone. */
function fakeBrowser({ fail = false } = {}) {
  const b = { asked: [], stopped: 0, made: [], nodes: [], modules: [] };
  const track = { stop: () => { b.stopped += 1; } };
  b.media = () => ({
    getUserMedia: (c) => {
      b.asked.push(c);
      return fail ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve({ getTracks: () => [track] });
    },
  });
  b.make = (options) => {
    const ctx = {
      options, state: 'suspended', closed: false, destination: { name: 'destination' },
      audioWorklet: { addModule: (url) => { b.modules.push(url); return Promise.resolve(); } },
      resume() { ctx.state = 'running'; return Promise.resolve(); },
      close() { ctx.closed = true; return Promise.resolve(); },
      createMediaStreamSource: (stream) => ({ stream, to: [], connect(n) { this.to.push(n); }, disconnect() { this.to = []; } }),
    };
    ctx.source = null;
    const make = ctx.createMediaStreamSource;
    ctx.createMediaStreamSource = (s) => (ctx.source = make(s));
    b.made.push(ctx);
    return ctx;
  };
  b.worklet = (ctx, name) => {
    const node = { ctx, name, to: [], port: { onmessage: null }, connect(n) { this.to.push(n); }, disconnect() { this.to = []; } };
    b.nodes.push(node);
    return node;
  };
  return b;
}

test('LISTEN opens the microphone at the band rate, with nothing of the browser shaping it, and every block goes on', async () => {
  const b = fakeBrowser();
  const heard = [];
  let now = 5000;
  const close = await openMicrophone((floats, at) => heard.push([floats, at]), { media: b.media, make: b.make, worklet: b.worklet, now: () => now });
  assert.deepEqual(b.asked, [{ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false }]);
  const [ctx] = b.made;
  assert.deepEqual(ctx.options, { sampleRate: BEAT_RATE });
  assert.equal(ctx.state, 'running');
  assert.equal(b.modules.length, 1);
  const [node] = b.nodes;
  assert.equal(ctx.source.to[0], node, 'the microphone into the node');
  assert.equal(node.to[0], ctx.destination, 'the node pulled by the output, which it leaves silent');
  const block = new Float32Array(BEAT_BLOCK).fill(0.25);
  node.port.onmessage({ data: block });
  now = 5008;
  node.port.onmessage({ data: block });
  assert.deepEqual(heard.map(([f, at]) => [f.length, at]), [[BEAT_BLOCK, 5000], [BEAT_BLOCK, 5008]]);

  close();
  assert.equal(b.stopped, 1, 'the browser stops using the microphone');
  assert.equal(ctx.closed, true);
  node.port.onmessage?.({ data: block });
  assert.equal(heard.length, 2, 'nothing after it is closed');
});

test('LISTEN that the browser is refused the microphone for leaves nothing open', async () => {
  const b = fakeBrowser({ fail: true });
  await assert.rejects(openMicrophone(() => {}, { media: b.media, make: b.make, worklet: b.worklet }), /NotAllowedError/);
  assert.equal(b.made[0].closed, true);
  assert.equal(b.nodes.length, 0);
});
