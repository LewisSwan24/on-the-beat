# The beat on the wristband: a lit card pulses in time with the music

Date: 26 Sep 2026. Decided with the owner section by section the same day,
after a throwaway spike on both real bands. It is **C** of the three kinds of
reaction the owner chose on 25 Sep 2026 (A and B are the reactions spec,
`2026-09-25-wrist-reactions-design.md`), and it builds on that spec's
reactions, sound switch and NOT NOW silence, and on the waves spec's call.

The owner reviewed this spec on 27 Sep 2026 and approved §1 and §2 as
written, `BEAT: ON` by default included. He chose to have it planned and
built now, on a branch of its own, and merged only once round 3 (§4.1) has
passed on the real bands; and to give the stand-in its `LISTEN` (§3).

**Amended 27 Sep 2026, from the build** (its plan is
`docs/superpowers/plans/2026-09-27-wrist-beat.md`). Made-up music and the
spike's offline set of 30 runs showed four of §2's rules had to change, and
the bands' own recordings showed the microphone's count needed holding to
the band's clock. None of it moves what §1 promises. Each is marked
*(amended)* below, and here is why:

1. **A new grid pulses once four of its last five beats were heard**, not
   three of three. Three of three counted beats the grid had just been
   fitted through, so random kicks and made-up speech locked it: over 80
   minutes of them, 152 pulses, and 80 now. Every offline run locked as fast
   or faster (the crowd on a laptop 6.1 s to 4.6, the drift 3.6 to 2.6, the
   medley in a hall 10.3 to 8.4), for 2 to 6 points of the hall's beats
   pulsed. Five of five would pulse almost never on them, but locks later,
   and in the hall's breakdown not at all; the owner kept four of five on
   28 Sep 2026.
2. **The fold carries a grid only while something near its last beat rose
   as far as a heard beat must.** A song that stopped into quiet pulsed a
   third beat after it, and a tempo change pulsed three beats off the grid;
   now the first pulses no third beat, and the second two.
3. **A beat the microphone was closed for is neither heard nor missed.** A
   reaction's 600 ms gap stopped the pulse.
4. **Each pulse is decided in the last block before it is due**, so it is
   never a block late.
5. **The count of samples is held to the band's clock.** Both bands'
   samples run 382 ppm fast of `millis()`, which counting alone carries into
   the pulses at 23 ms a minute.

## Goal

**A lit card is easier to find in a dark, crowded room when it pulses on the
beat.** While a card shows on the wristband — SAY HI's blue, FIRST SONG?, LET'S
DANCE! — and the band hears a steady beat, the card's light jumps to full on
each beat and eases down to half before the next. The colour never goes dark.
Without a steady beat the card stays lit as it does today.

The beat comes from the band's own microphone. The owner ruled out a signal
from the venue (a sound desk, a DJ) because none can be counted on, and the
phone is in a pocket.

**One principle decides open cases: the pulse only ever makes a lit card
easier to see.** It never lights a face that is not lit, never says anything
about anyone, and gives way to every reaction.

## Not in this spec

- **A signal from the venue**, and syncing bands to each other through the
  relay. Each band follows what it hears.
- **The phone listening.** It is in a pocket, muffled, and a phone in the
  background may not have its microphone at all.
- **Pulsing to the loudness instead of the beat.** It is the fallback if the
  gate in §4 fails, and would then be its own change.
- **Recording, storing or sending sound.** The band keeps five numbers per
  8 ms and forgets them; nothing about sound leaves it but its own light.
- **The meeting number, the letters, the check, the test light, NOT NOW and
  every black face.** None of them pulses.

## Where this departs from the canvas, on purpose

Revision 6 §8 rules out light patterns that pretend to carry a message. The
pulse carries none: it follows the music everyone in the room can hear, says
nothing about the wearer or anyone else, and is off whenever the card is.
README's "Where this differs from the canvas, on purpose" gains this.

## What the spike found (26 Sep 2026)

A throwaway firmware on both bands streamed the microphone's energy every
8 ms while the laptop played test tracks; the tracker ran on the laptop over
what the bands streamed. Round 1 had the laptop at 30%, round 2 at 60%, with
the bands beside its speaker.

- **Both microphones work** through M5Unified: the StickS3's through its
  codec on I2S1, the StickC Plus's PDM microphone on I2S0. No block was lost.
- **Handing the audio channel to the speaker and back is quick:** microphone
  off 12–15 ms, speaker on 1–5 ms, microphone back 7–8 ms. A reaction's sound
  interrupts listening for its own length plus about 25 ms.
- **Listening costs about 6 KB of heap.** The Plus keeps about 72 KB free with
  Wi-Fi and both sound buffers, so it has room.
- **The bands hear any drum a speaker can play** — folded over the beats, a
  click or a kick with harmonics stood 6–24× above the rest — **but not a
  kick at 70 Hz alone**: laptop speakers make no bass. A tracker has to find
  the beat in whatever part of the spectrum carries it.
- **Round 2, two bands (below 150 Hz and above 2 kHz):** a click track and a
  rich kick were locked in 2–2.5 s and 91–100% of their beats pulsed within
  40 ms, spread about ±12 ms. But a grid kept from one track pulsed off the
  beat into the next, and on the track whose kick it could not hear it held
  a tempo of 3:2. Timing blocks by `millis()` alone drifted: the microphone
  hands blocks over in pairs that share one, so blocks are timed by samples
  counted.
- **Offline, on harder audio:** a pop mix with bass line, chords and a voice;
  a medley going from 118 to 128 to a half-time 92 BPM with no gap; a
  breakdown with the drums out for 8 s; the pop mix under crowd babble and
  cheers; a band drifting from 116 to 124 BPM — each through three rooms
  (full range, laptop speakers, a hall with 1.5 s of reverb) with noise.
  Two bands are not enough for a mix: laptop speakers take the kick away and
  chords fill the high band, and the round-2 tracker locked almost none of
  it. The tracker of §2, with five bands, in the full-range and laptop
  rooms: locks the pop mix in 2 s and pulses all of its beats; relocks the
  medley's change to 128 BPM in about 2 s with two pulses of the old grid
  after the change; pulses every beat under the crowd (locked in 2–6 s) and
  through the drift (about 18 ms late while the tempo climbs); and goes
  quiet within two or three beats of the breakdown. In the hall it pulses
  72–100% of beats and takes up to 10 s to lock. The half-time groove it
  never locks: one to four pulses of the old grid slip into it, then
  nothing. Over round 2's real recordings it pulses 88–100% of the click
  and kick beats and nothing in 30 s of speech or in silence.
- **Round 3 is the gate (§4.1):** the five bands from the real microphones,
  the microphone's own delay, and a song of the owner's choice.

## §1. What the wearer sees

- **Which faces pulse:** only a lit card face — `hi`, `song` or `dance`, at
  rest. Not the meeting face (its number blinks when it calls, and must be
  read), not the letters, the check, the test light, waiting, away, offline or
  NOT NOW, not a black face (the chooser, the wave face, a result), and not
  while a reaction's flash is on the face.
- **The shape of a beat:** on the beat the light is the card's light (full, or
  half on a low battery). It falls in a straight line to half of that over
  the first two thirds of the beat, holds there until the next, and never goes
  lower. The colour and the words stay as they are; only the
  backlight moves.
- **When:** only once the band has locked onto a steady beat. Speech, a quiet
  song or silence leave the card steady. When the beat stops, or the song
  changes, the card is steady again within two beats.
- **The switch:** the phone's wristband sheet gains `BEAT: ON` under `SOUND`.
  Off, the band does not open its microphone and the card only stays lit.
  It is the person's own, kept across nights, on by default, and carried by
  the relay to their band and no one else's, as the sound switch is.

## §2. How the band follows the beat

The same logic runs in both twins, as every rule on the wrist does: the
`Wrist` in `firmware/src/band_logic.h` and `app/lib/wrist.js`, held to one
table.

- **Listening:** the band listens only while a card face could pulse (§1),
  its beat switch is on, and it is not in NOT NOW. The wrist says so
  (`listening()`); the firmware opens and closes the microphone to match.
- **What it hears:** 16 kHz samples in blocks of 128 (8 ms), timed by the
  samples counted rather than by when a block arrives, since both bands
  hand blocks over two at a time. *(amended)* The count is held to the
  band's clock: a block is never timed after it was handed over, the count
  creeps later by at most `BEAT_CREEP` a block while blocks come later than
  it says, and blocks the band could not keep are counted over. The first
  `BEAT_SETTLE` blocks after the microphone opens are not heard while its
  filters settle. For each block, the
  energy in five bands — below 150 Hz, 150–400, 400–1200, 1200–3500 and
  above 3500 Hz — from second-order filters (a middle band is a high-pass
  into a low-pass). A pure function in both twins turns samples into these
  five numbers, and a test holds the twins equal on the same samples. The
  levels, the onset strength and the tempo's sums are single precision in
  both, so the twins agree to the bit.
- **How strongly each block starts something:** each band's level in dB,
  and how far it rose above the higher of its two blocks before; the sum over
  the five bands is the block's onset strength (spectral flux, in dB).
  Summing bands lets a kick count that is heard only through its harmonics
  (laptop speakers, a small PA), and a held chord cannot hide a drum.
- **Tempo:** every `BEAT_LOOK_MS`, the autocorrelation of the last
  `BEAT_WINDOW_MS` of onset strength over periods from 336 to 752 ms (178 to
  80 BPM), each helped by its double, and weighted towards `BEAT_PRIOR_MS`
  with a spread of `BEAT_PRIOR_OCT` octaves: of two readings of the same
  music, a listener tapping along takes 120 BPM before 80, and the
  weighting settles the 3:2 of round 2. How far the best period stands out
  of the rest, in standard deviations, is the confidence; a parabola through
  the peak gives the period between blocks.
- **Laying the grid:** once the confidence is at least `BEAT_LOCK_CONF`,
  the same period has come out `BEAT_LOCK_LOOKS` looks in a row (within 2%),
  and the last `BEAT_PHASE_MS` folded at that period has one place standing
  out of the rest by `BEAT_LOCK_CONTRAST`: the grid goes through it. Speech
  has a rhythm, but not one that keeps a period for a second and stands out
  of it.
- **Keeping it:** a beat's window is `BEAT_NEAR` of a period either side of
  it. Once it has closed, its strongest rise is traced back to where that
  rise began — where the drum started — and the beat was **heard** if that
  drum started within `BEAT_TIGHT_MS` of the beat, its rise is at least as
  strong as any in the half beat before and after, and at least
  `BEAT_ONSET` times the window's mean onset strength (never under
  `BEAT_ONSET_MIN`). A heard beat pulls the grid a part of the way to it:
  `BEAT_PULL_PHASE` of the error on the next beat, `BEAT_PULL_PERIOD` of it
  on the period, which stays within `BEAT_CHANGE` of the tempo locked (a
  phase-locked loop). A noise just before a beat cannot take its place, and
  an off-beat hi-hat never moves the grid. *(amended)* A beat the microphone
  was closed for — blocks more than a block and a half apart — is neither
  heard nor missed.
- **Pulsing:** *(amended)* a new grid pulses once `BEAT_START` of its last
  `BEAT_START_OF` beats were heard, looking back from where it was laid,
  and keeps pulsing while at least `BEAT_CONFIRM` of the last three were —
  or while one of them was, something within `BEAT_NEAR` of the last
  counted beat rose at least as far as a heard beat must, and the last
  `BEAT_PHASE_MS`, folded on the grid, peaks within `BEAT_NEAR` of its beat
  at `BEAT_HOLD` times the fold's mean. The fold is what carries it
  through reverb, where the
  strongest rise of a single beat is often a reflection. So a song that
  stops, or a grid left over from the last song, goes quiet within two
  beats, and a missed kick or a reaction's gap does not stop it. The pulse
  is drawn at each beat minus `MIC_LATENCY_MS`, the model's measured delay
  from sound to block, so the light and the sound arrive together; each is
  decided in the last block before it is due *(amended)*.
- **Another song:** a confident, steady reading at another tempo (off by
  more than `BEAT_CHANGE`) or on another phase replaces a grid that is not
  being heard at once, and one that is after `BEAT_OTHER_LOOKS` looks in a
  row. A grid with no beat heard for `BEAT_LOSE_MS` is dropped.
- **Not pulsing is always better than pulsing off the beat**: in doubt, the
  card stays steady. Every value is a named constant and a guess until worn.
  They start at what the spike settled on:

  | Constant | Start | |
  |---|---|---|
  | `BEAT_BANDS_HZ` | 150, 400, 1200, 3500 | the edges of the five bands |
  | `BEAT_ONSET` | 2.5 | a heard beat's rise, against the window's mean onset strength… |
  | `BEAT_ONSET_MIN` | 6 dB | …and never below this (a quiet room's own rises stay under it) |
  | `BEAT_WINDOW_MS` | 6000 | the onset strength the tempo is read from |
  | `BEAT_LOOK_MS` | 128 | how often the tempo is read |
  | `BEAT_PRIOR_MS`, `BEAT_PRIOR_OCT` | 500, 0.7 | the tempo a listener would tap, and how firmly |
  | `BEAT_LOCK_CONF` | 4.0 | how far the best period must stand out |
  | `BEAT_LOCK_CONTRAST` | 4.5 | how far the beat must stand out of its own period |
  | `BEAT_LOCK_LOOKS` | 6 | looks in a row with the same period |
  | `BEAT_PHASE_MS` | 2000 | the stretch folded to place the grid |
  | `BEAT_NEAR` | 12% | of a period, either side of a beat |
  | `BEAT_RISE` | 0.25 | a rise is traced back while it is at least this much of its peak |
  | `BEAT_TIGHT_MS` | 30 | how near its beat a drum must start for the beat to be heard |
  | `BEAT_PULL_PHASE`, `BEAT_PULL_PERIOD` | 0.3, 0.05 | how far a heard beat pulls the grid |
  | `BEAT_CHANGE` | 5% | the most the period moves from its lock; more is another song |
  | `BEAT_START`, `BEAT_START_OF` | 4 of 5 | heard beats that start a new grid pulsing *(amended)* |
  | `BEAT_CONFIRM` | 2 of 3 | heard beats that keep a grid pulsing |
  | `BEAT_HOLD` | 4 | or one heard, with the fold on the grid peaking this far above its mean |
  | `BEAT_OTHER_LOOKS` | 8 | looks before a heard grid gives way |
  | `BEAT_LOSE_MS` | 4000 | nothing heard this long, and the grid is dropped |
  | `MIC_LATENCY_MS` | measured | per model, at the gate (§4.1) |
  | `BEAT_CREEP` | 0.125 ms | how far the count may creep later a block *(amended)* |
  | `BEAT_SETTLE` | 16 blocks | not heard once the microphone opens; the lowest band settled by the twelfth on the bands' recordings *(amended)* |
- **What it costs:** eight biquads per sample at 16 kHz, and every 128 ms
  an autocorrelation of 750 values over 53 periods and their doubles —
  about 0.6 million multiply-adds a second — and 6 KB for the onset
  strength and its times, and 4 KB for copies of blocks the loop has not
  reached yet. Measured on the Plus with Wi-Fi and TLS on in
  §4.6.
- **Reactions come first.** A reaction's sound takes the audio channel: the
  firmware closes the microphone, plays, and opens it again, and the clock
  keeps running through the gap. A reaction's flash replaces the pulse while
  it is on.

## §3. Who does what

- **The wrist (both twins):** `hear(levels, now)` per block, with the five
  band energies; the tracker; `listening()`; the pulse applied to the light
  of a pulsing face in `face(now)`. The table gains a step that feeds a
  generated block sequence — a tempo, a level, noise, a gap — expanded
  identically for both twins, so the cases say when a band locks, where it
  pulses and when it lets go.
- **The relay:** the beat switch per person, `{ t: 'beat', on }` from the
  phone, and `beat` on every show to their band once said, as `sound` is
  (`relay/band.js`, `relay/server.js`).
- **The phone:** the `BEAT` row and its words (`app/lib/bandbeat.js`, beside
  `bandsound.js`), the switch kept in `store.js` across nights and said to the
  relay on every join, and a line in "How this works": the wristband pulses
  its colour on the beat; it hears loudness only, and records and sends
  nothing.
- **The firmware (`main.cpp`):** opens the microphone while `listening()`,
  turns each block into the five energies and hands them to the wrist, hands
  the channel to the speaker for each sound and takes it back, and draws the
  light `face(now)` gives on every loop. The console's `face` shows the light
  moving, so a real band can be checked without eyes on it.
- **The stand-in (`/band`):** an optional `LISTEN` that feeds the laptop's
  microphone through the same energy function, for a demo; off by default,
  it asks the browser for the microphone only when turned on, and off, it
  pulses nothing.

## §4. Tests and proof

1. **The gate, before anything is merged.** It may be built first, on a
   branch; it reaches `main` only once this passes. Round 3 of the spike on both real
   bands, streaming the five bands, with the laptop at round 2's volume and
   the bands beside it: the pop mix, the medley, the breakdown, the crowd and
   the drift of the offline tests, then a song of the owner's choosing played
   from a phone. The tracker runs on the laptop over what the bands
   streamed. It passes if, on both bands:
   - the pop mix, the crowd and the drift are locked within 4 s of the drums
     starting, and once locked at least 90% of beats are pulsed within 40 ms
     of the drum reaching the band (people notice sound and light apart from
     about 45 ms);
   - the medley's change to 128 BPM is relocked within 4 s, with no more
     than two pulses off the beat at the change;
   - speech and silence pulse nothing;
   - in the owner's song, once both are locked, at least 90% of one band's
     pulses fall within 40 ms of the other's.
   The half-time section and the breakdown are recorded, not judged. If it
   fails, the owner decides between the loudness fallback and stopping.
   `MIC_LATENCY_MS` for each model is measured here: the owner presses each
   band's face button a few times, and the delay is from the press to the
   block that hears its click.
2. **The table**, on both twins: lock at 90, 120 and 160 BPM; noise between
   the beats; an off-beat hi-hat that does not move the grid; a missed beat
   carried by the clock; a song that stops (quiet within two beats); a tempo
   change; a gap for a reaction's sound; silence and irregular onsets
   locking nothing; the pulse's shape; every face that must not pulse; the
   switch off; NOT NOW.
3. **The energy function** in both twins, equal on the same samples.
4. **The relay and the phone,** as the sound switch's tests are: said once,
   carried only to the person's own band, kept across nights, the row's words.
5. **Mutation checks, as in phase A.** Break each guard, and exactly its test
   goes red.
6. **On the real bands,** driven from the console: music played, `face` read
   every 25 ms, the light at its peak within 40 ms of each beat; the switch off
   and nothing pulses; a reaction during the music; the Plus's free heap with
   Wi-Fi, TLS and the microphone all on.

## Also to change when this is built

- README: what the wristband shows (the pulse), "Where this differs from the
  canvas, on purpose", the privacy of the microphone, and "What is not done".
- The reactions spec's "Not in this spec" line for C points here.

## Risks

- **A venue is not a laptop.** Crowd noise, reverb, a band's wrist moving and
  songs without a steady kick may keep it from locking. Then the card stays
  steady, which is today's behaviour; it never flashes wrongly for long.
  Reverb is the known weak point: in the offline hall up to a quarter of
  the beats went unpulsed, and a lock took up to 10 s. A half-time groove
  is not locked at all.
- **A microphone on a wrist worries people.** It opens only while a card is
  lit and the switch is on, keeps five numbers per 8 ms and forgets them, and
  nothing about sound leaves the band. README and "How this works" say so.
- **Battery.** The microphone and the sums cost a few milliamps while a card
  is lit; the pulse's lower average light gives some of it back. Measured on
  the real bands in §4.6.
- **The Plus shares one audio channel** between microphone and buzzer. The
  spike showed the hand-over is quick; a sound always wins it.
