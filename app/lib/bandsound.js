// The wristband's sound switch, as the phone shows and says it
// (docs/superpowers/specs/2026-09-25-wrist-reactions-design.md §3). It is the
// person's own and outlasts the night; off, the band only lights up. The relay
// carries it to their band, and to no one else's.

/** The wristband sheet's row for the switch, as it stands. */
export function soundRow(on) {
  return on
    ? { icon: 'volume_up', label: 'SOUND: ON', sub: 'tap for light only.' }
    : { icon: 'volume_off', label: 'SOUND: OFF', sub: 'light only. tap to hear it again.' };
}

/** What the phone says once the switch is flipped, by where it now stands. */
export const SOUND_SAY = { on: 'your wristband will chirp again.', off: 'your wristband will only light up.' };
