# The beat on the wristband: a lit card pulses in time with the music

Date: 26 Sep 2026. Decided with the owner section by section the same day,
after a throwaway spike on both real bands. It is **C** of the three kinds of
reaction the owner chose on 25 Sep 2026 (A and B are the reactions spec,
`2026-09-25-wrist-reactions-design.md`), and it builds on that spec's
reactions, sound switch and NOT NOW silence, and on the waves spec's call.

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
- **Recording, storing or sending sound.** The band keeps three numbers per
  8 ms and forgets them; nothing about sound leaves it but its own light.
- **The meeting number, the letters, the check, the test light, NOT NOW and
  every black face.** None of them pulses.

## Where this departs from the canvas, on purpose

Revision 6 §8 rules out light patterns that pretend to carry a message. The
pulse carries none: it follows the music everyone in the room can hear, says
nothing about the wearer or anyone else, and is off whenever the card is.
README's "Where this differs from the canvas, on purpose" gains this.

## What the spike found (26 Sep 2026)

A throwaway firmware on both bands streamed the microphone's energy in three
bands every 8 ms while the laptop played a click track and a drum track:

- **Both microphones work** through M5Unified: the StickS3's through its
  codec on I2S1, the StickC Plus's PDM microphone on I2S0. No block was lost.
- **Handing the audio channel to the speaker and back is quick:** microphone
  off 12–15 ms, speaker on 1–5 ms, microphone back 7–8 ms. A reaction's sound
  interrupts listening for its own length plus about 25 ms.
- **Listening costs about 6 KB of heap.** The Plus keeps about 72 KB free with
  Wi-Fi and both sound buffers, so it has room.
- **The bands heard the clicks** — the high band averaged over the beats stood
  2.6× (StickS3) and 1.7× (Plus) above its median at a fixed delay — **but not
  the kick**: laptop speakers at 30% make no bass. How well the low band finds
  a beat in music with real bass is still open, and is the gate in §4.

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
  song or silence leave the card steady. A lost beat returns the card to
  steady within `BEAT_LOSE_MS`.
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
- **What it hears:** 16 kHz samples in blocks of 128 (8 ms). For each block,
  the energy below 150 Hz (the kick) and above 2 kHz (hi-hats, clicks, the
  attack of a snare), from two second-order filters. A pure function in both
  twins turns samples into these two numbers, and a test holds the twins
  equal on the same samples.
- **Onsets:** a rise in log energy above what the last second held, in
  either band, at least 200 ms after the last one.
- **Tempo:** the period between 333 and 750 ms (180 and 80 BPM) that best
  explains the onsets of the last `BEAT_WINDOW_MS`, preferring the kick.
- **The beat clock:** a predicted next beat, pulled towards each onset that
  lands near it and left alone by those that do not. The pulse is drawn at
  the predicted beat minus `MIC_LATENCY_MS`, the model's measured delay from
  sound to block, so the light and the sound arrive together.
- **Locking and letting go:** locked once `BEAT_LOCK` predicted beats in a
  row were each confirmed by an onset within `BEAT_TOLERANCE_MS`; let go once
  no beat was confirmed for `BEAT_LOSE_MS`. Every one is a named constant and a
  guess until worn. They start at:

  | Constant | Start | |
  |---|---|---|
  | `BEAT_WINDOW_MS` | 6000 | the onsets the tempo is taken from |
  | `BEAT_LOCK` | 4 | confirmed beats in a row before the first pulse |
  | `BEAT_TOLERANCE_MS` | 60 | how near an onset must land to confirm a beat |
  | `BEAT_LOSE_MS` | 4000 | unconfirmed this long, and the card is steady again |
  | `MIC_LATENCY_MS` | measured | per model, at the gate (§4.1) |
- **Reactions come first.** A reaction's sound takes the audio channel: the
  firmware closes the microphone, plays, and opens it again, and the clock
  keeps running through the gap. A reaction's flash replaces the pulse while
  it is on.

## §3. Who does what

- **The wrist (both twins):** `hear(low, high, now)` per block; the tracker;
  `listening()`; the pulse applied to the light of a pulsing face in
  `face(now)`. The table gains a step that feeds a generated block sequence —
  a tempo, a level, noise, a gap — expanded identically for both twins, so the
  cases say when a band locks, where it pulses and when it lets go.
- **The relay:** the beat switch per person, `{ t: 'beat', on }` from the
  phone, and `beat` on every show to their band once said, as `sound` is
  (`relay/band.js`, `relay/server.js`).
- **The phone:** the `BEAT` row and its words (`app/lib/bandbeat.js`, beside
  `bandsound.js`), the switch kept in `store.js` across nights and said to the
  relay on every join, and a line in "How this works": the wristband pulses
  its colour on the beat; it hears loudness only, and records and sends
  nothing.
- **The firmware (`main.cpp`):** opens the microphone while `listening()`,
  turns each block into the two energies and hands them to the wrist, hands
  the channel to the speaker for each sound and takes it back, and draws the
  light `face(now)` gives on every loop. The console's `face` shows the light
  moving, so a real band can be checked without eyes on it.
- **The stand-in (`/band`):** an optional `LISTEN` that feeds the laptop's
  microphone through the same energy function, for a demo; off, it pulses
  nothing.

## §4. Tests and proof

1. **The gate, before anything is built.** A second round of the spike on
   both real bands, with music that has a real kick, loud and close (the
   owner turns the volume up, or a speaker with bass), the tracker run on
   the laptop over what the bands streamed. It passes if, on both bands:
   - a steady beat is locked within 4 s of the drums starting;
   - once locked, at least 90% of beats are pulsed within 40 ms of the kick
     reaching the band (people notice sound and light apart from about 45 ms);
   - speech and silence lock nothing.
   If it fails, the owner decides between the loudness fallback and stopping.
   `MIC_LATENCY_MS` for each model is measured here.
2. **The table**, on both twins: lock at 80, 120 and 180 BPM; noise between
   the beats; a missed beat carried by the clock; a tempo change; a gap for a
   reaction's sound; silence and irregular onsets locking nothing; the pulse's
   shape; every face that must not pulse; the switch off; NOT NOW.
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
- **A microphone on a wrist worries people.** It opens only while a card is
  lit and the switch is on, keeps three numbers per 8 ms and forgets them, and
  nothing about sound leaves the band. README and "How this works" say so.
- **Battery.** The microphone and the sums cost a few milliamps while a card
  is lit; the pulse's lower average light gives some of it back. Measured on
  the real bands in §4.6.
- **The Plus shares one audio channel** between microphone and buzzer. The
  spike showed the hand-over is quick; a sound always wins it.
