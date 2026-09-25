// The wristband's speaker, in a browser (/band). The band renders a sound's
// notes into one triangle wave (band_logic.h render()); here each note is a
// triangle oscillator, started and stopped on the audio clock, so the page's
// own drawing cannot bend the rhythm either. A browser lets a page make sound
// only after it has been tapped, so it is silent until then. A new sound cuts
// off the one playing, as the band's does.

import { SOUNDS } from './wrist.js';

// Softer than the band, which plays at its full volume: a browser at full volume can be a headphone's.
const LEVEL = 0.5;

/** When each sounding note of a sound starts and stops, in seconds from `at`. A rest only takes its time. */
export function notesAt(name, at) {
  const out = [];
  let t = at;
  for (const [hz, ms] of SOUNDS[name] || []) {
    if (hz) out.push({ hz, start: t, stop: t + ms / 1000 });
    t += ms / 1000;
  }
  return out;
}

/** A speaker whose AudioContext is made at the first tap. `make` is for the tests. */
export function createSpeaker(make = () => new AudioContext()) {
  let ctx = null;
  let out = null;
  let playing = [];
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
      if (ctx?.state !== 'running' || !SOUNDS[name]) return false;
      for (const o of playing) {
        try { o.stop(); } catch { /* over already */ }
      }
      playing = notesAt(name, ctx.currentTime).map(({ hz, start, stop }) => {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = hz;
        o.connect(out);
        o.start(start);
        o.stop(stop);
        return o;
      });
      return true;
    },
  };
}
