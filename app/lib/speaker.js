// The wristband's speaker, in a browser (/band). It plays the bytes the band
// renders (app/lib/sound.js, as band_logic.h render()), an octave down as a
// speaker build plays them: 3 to 4.7 kHz squares are shrill on a laptop, and
// the tune survives the octave. One buffer, started on the audio clock, so the
// page's own drawing cannot bend the rhythm. A browser lets a page make sound
// only after it has been tapped, so it is silent until then. A new sound cuts
// off the one playing, as the band's does.

import { SOUND_RATE, renderSound } from './sound.js';

// Softer than the band, which plays at its full volume: a browser at full volume can be a headphone's.
const LEVEL = 0.5;

/** A sound's samples as Web Audio takes them, -1 to 1: the band's bytes, 128 the middle. */
export function samplesOf(name) {
  const bytes = renderSound(name);
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = (bytes[i] - 128) / 128;
  return out;
}

/** A speaker whose AudioContext is made at the first tap. `make` is for the tests. */
export function createSpeaker(make = () => new AudioContext()) {
  let ctx = null;
  let out = null;
  let playing = null;
  return {
    /** Call from a tap: from then on it may sound. */
    unlock() {
      try {
        if (!ctx) {
          ctx = make();
          out = ctx.createGain();
          out.gain.value = LEVEL;
          out.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
      } catch { /* no Web Audio here: it stays silent */ }
    },
    /** Can it sound now? */
    ready: () => ctx?.state === 'running',
    /** Plays one sound, cutting off the last. Before a tap, or for a name it does not know, nothing. */
    play(name) {
      if (ctx?.state !== 'running') return false;
      const samples = samplesOf(name);
      if (!samples.length) return false;
      try { playing?.stop(); } catch { /* over already */ }
      const buffer = ctx.createBuffer(1, samples.length, SOUND_RATE);
      buffer.copyToChannel(samples, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(out);
      source.start(ctx.currentTime);
      playing = source;
      return true;
    },
  };
}
