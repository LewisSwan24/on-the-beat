// The stand-in's LISTEN (/band): the laptop's microphone, taken as the band
// takes its own (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §3),
// for a demo. Off by default, and the browser is asked for the microphone
// only when it is turned on. What it hears becomes the band's five levels
// here, block by block, and goes to the wrist: nothing of the sound is kept
// or sent.
//
// The audio runs at the band's own rate, where the browser hands over 128
// samples at a time: one block. They come to the page when it gets round to
// them, so the block clock times them, as the band's does.

import { BEAT_BLOCK, BEAT_RATE, createBlockClock, createLevels } from './beat.js';

const NODE = 'otb-blocks';

// Runs on the browser's audio thread: each 128 samples heard, sent on to the page as they are.
const WORKLET = `registerProcessor('${NODE}', class extends AudioWorkletProcessor {
  process(inputs) {
    const heard = inputs[0] && inputs[0][0];
    if (heard) this.port.postMessage(heard.slice(0));
    return true;
  }
});`;

/** Samples as a browser has them, -1 to 1, as the band's microphone gives them: whole 16-bit numbers. */
export function toSamples(floats) {
  return Array.from(floats, (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32768))));
}

/**
 * The band's ears, for the stand-in: samples in as they come, cut into blocks, and each block's five levels handed
 * to `hear(levels, t)` at the time the block clock gives it. Blocks that come together are timed a block apart.
 */
export function createEars(hear) {
  const levels = createLevels();
  const clock = createBlockClock();
  let carry = [];
  return {
    /** Samples as the browser has them, come to the page at `arrival`. */
    take(floats, arrival) {
      carry = carry.concat(toSamples(floats));
      while (carry.length >= BEAT_BLOCK) {
        const lv = levels.block(carry.slice(0, BEAT_BLOCK));
        carry = carry.slice(BEAT_BLOCK);
        const t = clock.at(arrival);
        if (t !== null) hear(lv, t);
      }
    },
  };
}

/**
 * Opens the laptop's microphone at the band's rate, with nothing of the browser's shaping (no echo cancelling, no
 * noise suppression, no gain control: they would flatten the very rises the band listens for), and hands every
 * block to `take(floats, arrival)`. Resolves to a function that shuts it; if anything fails, nothing is left open.
 * Call it from a tap, which lets its audio run. `media`, `make`, `worklet` and `now` are for the tests.
 */
export async function openMicrophone(take, {
  media = () => navigator.mediaDevices,
  make = (options) => new AudioContext(options),
  worklet = (ctx, name) => new AudioWorkletNode(ctx, name),
  now = () => Date.now(),
} = {}) {
  const ctx = make({ sampleRate: BEAT_RATE });
  let stream = null;
  try {
    stream = await media().getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = ctx.createMediaStreamSource(stream);
    const node = worklet(ctx, NODE);
    node.port.onmessage = (e) => take(e.data, now());
    source.connect(node);
    node.connect(ctx.destination); // pulled by the output, which it leaves silent
    await ctx.resume();
    return () => {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      for (const t of stream.getTracks()) t.stop();
      ctx.close();
    };
  } catch (e) {
    for (const t of stream?.getTracks() || []) t.stop();
    ctx.close();
    throw e;
  }
}
