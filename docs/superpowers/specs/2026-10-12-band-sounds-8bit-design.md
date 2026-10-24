# The wristband's sounds, 8-bit: design

12 Oct 2026. Branch `sounds-8bit` from `main` (8134f6d).

## Why

We asked for a set of sounds we can tell apart without looking, in one style,
that sound good: 「做一套更有辨识度的声音……分不清哪个是哪个，风格不统一、不好听」.
Today's twelve sounds are triangle-wave note lists. Several of them are rising
runs that sound alike, and nothing ties them together.

## How the direction was chosen (by ear, on the band)

A throwaway firmware (local branch `sound-probe`, never pushed) played
candidates on a StickC Plus buzzer from a console `play` command. We listened
to every candidate on the real band and decided each step by ear.

1. **Style.** Eight-bit beat four instrument imitations (wood block, bells,
   marimba, plucked string) on every event: someone waved, match, found, not
   sent. For the key press we chose a struck, decaying square wave ("tok") over
   a thin 8-bit pulse blip, today's tick, a click and a pop. A struck square
   wave is still an 8-bit voice: a square with a volume envelope.
2. **Structure.** We kept the families-and-motif structure proposed before the
   style was chosen. Each family of meaning has its own rhythm, and every piece
   of good news grows from one motif.
3. **Timbre.** 25% pulse waves sounded muffled on this buzzer, and switching
   them to 50% square fixed it 「不闷了，可以」. The likely reason: only the
   fundamental lands where the buzzer is loud. A 25% pulse carries about 70% of
   a square's fundamental, and its extra overtones fall above what the buzzer
   plays. Every voice is a 50% square, plus noise and rests.
4. **The full set below** was played to us on the band, twice each, and
   approved after the pulse-to-square change.

The buzzer's constraint is measured. Swept a semitone at a time beside a
microphone, it was loud from about 2.8 to 4.7 kHz, where the sweep ended, and
weak under 2.6 kHz (the comment above `buzzerFactor` in `band_logic.h`). So
every steady note sits in F7 (2794 Hz) to D8 (4699 Hz).

## The sounds

**Motif, "on-the-BEAT": F7 → A7 → C8** (2794, 3520, 4186 Hz), short-short-long.

Notation: `F7 70` is a square at F7 for 70 ms, at full volume.
`→0.3` means the volume falls linearly to 0.3 over the segment.
`decay h14` means a struck note: full volume, halving every 14 ms.
`A7~1400` is a slide. `noise 3000` is noise at a 3000 Hz step rate.
`·40` is 40 ms of silence.

| Family | Sound | Played for (unchanged) | Segments | ms |
|---|---|---|---|---|
| I pressed | `tick` | every key press | F7 60 decay h14 | 60 |
| | `double` | a choice, wave or found sent from the wrist | F7 60 decay h14 · ·40 · A7 60 decay h14 | 160 |
| My result | `up` | SET; paired; TEST THE LIGHT | F7 70 · C8 140 →0.3 | 210 |
| | `fall` | CHANGED; the check ended without YES | C8 90 · A7 180 →0.3 | 270 |
| | `low` | NOT SENT | A7~1400 250 · noise 3000 50 →0.1 | 300 |
| Good news (motif) | `hello` | someone waved | F7~A7 60 · ·30 · A7 90 | 180 |
| | `jingle` | a match | (F7 25 · A7 25 · C8 25) ×3 · C8 200 →0.2 | 425 |
| | `found` | both said found | F7 50 · A7 50 · C8 50 · D8 180 →0.3 | 330 |
| | `calledit` | the opener he named was played | F7 45 · A7 45 · C8 45 · ·30 · F7 45 · A7 45 · C8 45 · D8 240 →0.3 | 540 |
| Answer me | `ask` | the pairing check | F7 80 · ·60 · C8 110 · C8~D8 60 | 310 |
| State | `down` | into NOT NOW | C8 90 1→0.6 · A7 90 0.6→0.35 · F7 240 decay from 0.35, h58 | 420 |
| | `warn` | out of reach, low battery, away | (A7 50 · ·30) ×2 · A7 50 · ·120 · (A7 50 · ·30) ×2 · A7 50 | 540 |

Changed from what we heard, both to fit the memory bound below:

- `warn`'s rests are 30 ms (heard: 40) and its gap is 120 ms (heard: 160).
- Envelopes heard as "fall to x exponentially" are written as half-lives. The
  render must be integer-exact (below), and a half-life is.

Both changes are re-checked by ear at acceptance.

Two more sounds belong to the wrist-motion branch and are not added here.
`waving` (F7~D8 80 →0.6) plays when a raised wave is seen. `clink`
(noise 9000 6 →0.5 · C8 260 decay h51) plays when a clink is sent. They join
`wrist-motion` when it is rebased onto this.

## The engine

### The table

A sound is a list of segments. The same table lives in `band_logic.h`
(`SOUNDS`) and `app/lib/wrist.js` (`SOUNDS`), and `tests/firmware.test.js`
holds them equal, as it does today.

A segment has these fields:

- `wave`: `SQUARE`, `NOISE` or `REST`.
- `hz0`, `hz1`: start and end pitch. When they differ, the segment is a slide,
  linear in Hz. For noise they are the rate at which the noise level steps.
- `ms`: length.
- `env`: one of three envelopes, with its fields:
  - `FLAT v`: steady at volume v;
  - `LINE v0 v1`: linear from v0 to v1;
  - `DECAY v0 h`: starts at v0 and halves every h ms.

Volumes are integers 0 to 32767 (Q15), so 1.0 is 32767.

### The render, integer only

One function renders a sound to 8-bit unsigned samples at `SOUND_RATE`
(16 000). It is written once in C++ and once in JS, and the two produce
identical bytes. Nothing in it is floating point, and nothing calls `pow` or
`exp`.

1. **Lead-in.** 40 ms of silence first. A short sound that starts the speaker
   cold lost its start in the probe: we heard 18 and 40 ms ticks drop out.
2. **Segment length.** A segment of `ms` lasts `n = ms × 16` samples.
3. **Pitch.** At sample `i` the pitch is `hz = hz0 + trunc((hz1 − hz0) × i / n)`,
   truncated toward zero, which a downward slide needs to agree in C++ and JS. The phase step is
   `step = floor(hz × 2³² / 16000)`. Phase is a 32-bit unsigned accumulator,
   wrapping. The largest product, 4800 × 2³², stays below 2⁵³, so JS computes
   it exactly. The accumulator carries across segments, so a slide joins its
   next note without a click.
4. **Square.** +1 while `phase < 2³¹`, else −1.
5. **Noise.** A second accumulator advances by the same step. Each time it
   wraps, a 16-bit LFSR shifts once (taps 0, 2, 3, 5; seed 0xACE1), and the
   level is +1 if its low bit is 1, else −1.
6. **Volume.**
   - `FLAT`: v.
   - `LINE`: `v0 + trunc((v1 − v0) × i / n)`.
   - `DECAY`: with `q = floor(i / (h×16))` and `r = i mod (h×16)`,
     `a = v0 >> q` and `b = v0 >> (q+1)`, the volume is
     `a − trunc((a − b) × r / (h×16))`, a straight line between halvings.
7. **Sample.** `128 + trunc(level × vol × 127 / 32767)`. A rest is 128.

### Pitch on each device

The table holds the buzzer's pitches. The Plus plays them as written. The
`/band` stand-in in a browser, and a speaker build (the StickS3 environment,
which still compiles), play every pitch one octave down. On a laptop speaker,
3-4.7 kHz squares are shrill, and the tune survives the octave.

Today's two buzzer rules go: `buzzerFactor` (whole octaves up) and `buzzerOwn`
(the buzzer's own notes for `low`).

### Memory: no more than today

On 12 Oct the probe firmware held a 24 KB buffer, and the band could no longer
reach the relay (`SSL - Memory allocation failed`). The sound buffers are a
hard bound.

- Today: two buffers of `SOUND_SAMPLES`, sized by the longest sound (600 ms),
  so 2 × 9600 bytes.
- New: the longest is `calledit` and `warn` at 540 ms. With the 40 ms lead-in
  that is 580 ms, so 2 × 9280 bytes.
- A host check pins `SOUND_SAMPLES` ≤ 9600, so a longer sound cannot be added
  without someone deciding to.

### What does not change

- Which event plays which sound, the reaction queue, the flashes, the sound
  switch on the phone, and NOT NOW's silence.
- One sound cuts the last. The two alternating buffers stay.

`soundMs` and `notesMs` become a segment sum plus the 40 ms lead-in. The
queue's `until` (the longer of a reaction's sound and flash) follows from that.

## The stand-in (`/band`)

`app/lib/speaker.js` stops starting one triangle oscillator per note. It
renders the sound with the shared JS function, an octave down, into an
`AudioBuffer` at 16 kHz (bytes to floats), and plays one buffer source. The
existing behaviour stays: it is silent until the page is tapped, one sound cuts
the last, and the level is 0.5.

## Tests

Each new check is mutation-checked: break what it guards, watch it go red.

- **Byte-identical render.** The host test prints a hash of every sound's C++
  render, in both the buzzer and the speaker octave. `tests/firmware.test.js`
  compares these with the JS render. Changing one side's maths fails it.
- **Tables equal.** As today, with the new segment shape.
- **Pitch guard.** Every `SQUARE` segment starts between 2600 and 4800 Hz. A
  slide may end below (`low` falls to 1400 Hz on purpose). A note the buzzer
  cannot sound is refused at test time.
- **Memory bound.** `SOUND_SAMPLES` ≤ 9600.
- **Render details** (host and JS):
  - the lead-in is 640 bytes of 128;
  - a `DECAY` segment's volume at `i = h×16` is half its start;
  - a slide's last sample has the pitch of `hz1`, within one step;
  - noise is the same byte sequence on both sides.
- **Reaction timing.** The shared case table (`tests/wrist-table.js`) may hold
  times that follow sound lengths. Every case whose expected time changes is
  listed in the commit message, with old → new; none is changed silently.
- **Stand-in.** `tests/speaker.test.js` moves from `notesAt` to the render: the
  buffer length is the sound's ms × 16 (lead-in included), and a second play
  stops the first.

## Acceptance on the band

1. Flash one test band (COM9 or COM11 at the time, with our yes; the other two
   Plus are not flashed).
2. Play the twelve with `sound <name>`, twice each, for our ear. `warn` and the
   decays changed slightly from what we heard.
3. Press a key several times in a row, and watch for a dropped tick.
4. `show` reports free memory no lower than the wrist-motion build (about 110 KB
   free), and the band reaches the relay.

## Order of work and release

1. On `sounds-8bit`: engine + table (C++ and JS) + tests, `npm test` green,
   `pio run` for both environments.
2. The band acceptance above.
3. Merge to `main` and push (our 「合并并推送」).
4. Rebase `beat-port` and `wrist-motion` onto the new `main`. Add `waving` and
   `clink` on `wrist-motion`. Flash the two test bands from it.
5. The live relay serves `/band`, so the stand-in's new sounds go live only with
   a deploy. Fly runs `wrist-motion`; a redeploy waits for our word.

## Not in this

- The phone's own sounds. This is the band only.
- A volume setting. The phone's switch stays on/off.
- Streaming renders in chunks to cut the buffers further. Not needed while the
  bound holds.
