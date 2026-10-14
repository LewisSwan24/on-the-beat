// The wristband's beat switch, as the phone shows and says it
// (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §1). It is the
// person's own and outlasts the night; on, a lit card pulses on the beat and
// the band opens its microphone only while it could; off, the card only stays
// lit. The relay carries it to their band, and to no one else's.

/** The wristband sheet's row for the switch, as it stands. */
export function beatRow(on) {
  return on
    ? { icon: 'graphic_eq', label: 'BEAT: ON', sub: 'your card pulses with the music. tap to keep it still.' }
    : { icon: 'music_off', label: 'BEAT: OFF', sub: 'your card stays still, its microphone off. tap to pulse again.' };
}

/** What the phone says once the switch is flipped, by where it now stands. */
export const BEAT_SAY = { on: 'your wristband will pulse with the music.', off: 'your wristband will stay still.' };

/** Its line in How this works: what the band does with the beat, and what it never does with the sound. */
export const BEAT_HOW = 'Your wristband pulses its colour on the beat. It hears loudness only, and records and sends nothing.';
