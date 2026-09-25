# Wristband reactions: sound and light for the wearer (A and B)

Date: 25 Sep 2026. Decided with the owner section by section the same day,
after phase A's test on real bands (`2026-09-24-wrist-controls-design.md`,
Task 26) showed how little the wristband says back. A press changed small
words, and a face hold on an unpaired band went dark and did nothing, which
read as "only the phone controls the band".

The owner asked for more reactions on the band, sound and colour among them,
and chose three kinds: **A**, confirming what the wearer does; **B**, calling
them when something comes for them; **C**, flashing on the music's beat. This
spec is A and B. C is a second phase with its own spec.

The sound style was chosen by ear on the real StickS3. A throwaway test
played three styles: beep, chirp and chime. The owner picked the chirp,
short game-like notes on a triangle wave. The chime was too quiet.

After the approval, a reviewer read this spec against the code and found
where two rules meet in one moment. The fixes are in the text.

Decisions made while writing this down are marked **(new)** for the owner's
review. What the owner added afterwards is marked **owner's addition**.

## Goal

The wristband answers the person wearing it, in sound and in light:

- every press is heard as it happens;
- a card chosen on the wrist ends in SET, CHANGED or NOT SENT, each with its
  own sound and colour;
- pairing and a meeting number call the wearer, and a meeting keeps calling
  until they answer;
- a band that stops working for its person, or runs low, says so once.

Every result, call and warning also shows in light, so the sound can be
switched off on the phone.

**One principle decides open cases: the wristband is quiet unless its wearer
did something on it, or something came for them.** A change the wearer
makes to their card or NOT NOW on the phone makes no sound, and NOT NOW
makes none at all.

## Not in this spec

- **C, the beat.** A second phase, with its own spec.
- **A wave on the band.** The owner wants a wave sent from a phone to reach
  the other person's band, and to be answered there. That is the next spec,
  designed right after this one and built on its call. Here the meeting
  number stays the only thing about anyone else the band shows or reacts to
  (`relay/band.js`).
- **Sound on the phone, and a volume setting.** The switch is on or off.
- **Vibration.**
- **What does not change.** Who decides the cards, what the relay accepts
  or refuses, and every other phone screen.

## Where this departs from the canvas, on purpose

Revision 6 §8 rules out vibration or light patterns that pretend to carry a
message. The owner chose on 25 Sep 2026 that the band flashes and sounds.
None of it pretends:

- each reaction answers something the wearer just did, or says one fact
  about the band: out of reach, battery, waiting, away, or unpaired;
- the only reaction about another person is the meeting call, and the
  meeting number is already on the band.

README's "Where this differs from the canvas, on purpose" gains this.

## §1. The moments

| When | Sound | Light |
|---|---|---|
| a key goes down | tick | — |
| a SIDE hold sends the choice at once | double | — |
| a FACE hold puts the wearer in NOT NOW | down | dark, as today |
| SET, leaving NOT NOW included | up | the card's colour, twice; white for OFF |
| CHANGED | fall | red, three times |
| NOT SENT | low | orange, twice |
| the check number appears | ask | white, twice |
| paired, and TEST THE LIGHT | up | the white face both already show |
| the check ends without YES (NO, or time out) | fall | — |
| a meeting number appears | jingle | blinks until answered (§2 rule 4) |
| a warning | warn | orange, twice |

A SIDE hold that sends nothing, because the preview is what is already
armed, plays no *double*; the choice just closes, as today.

The warnings. Each plays once per change (§2 rule 7):

- **Out of reach.** No relay for STALE_MS (10 s), whatever the reason: the
  Wi-Fi, the relay or the tunnel. Only a paired band warns: an unpaired one
  is nobody's.
- **Battery.** At 15% or below, where the relay halves the light, and again
  at 5% or below.
- **Waiting.** After a relay restart, the band waits for its owner's phone.
  It warns once the wait has lasted STALE_MS **(new: not at once. On 25 Sep,
  after a relay restart, a band was back with its owner in the same second
  it said hello, because the phone had reconnected first. A warning at once
  would have been a false alarm)**.
- **Away.** Paired, but its person is not in a room.
- **Unpaired.** It was someone's and now shows letters, whoever unpaired it.

### The sounds

Every sound is a triangle wave at full volume (255). Notes are written as
frequency in Hz / length in ms; 0 is a rest. Where the throwaway test played
a sound, these are the notes heard there.

| Sound | Notes | From |
|---|---|---|
| tick | 1800/25 | the test's PRESS |
| double | 1800/25, 0/60, 1800/25 | new |
| down | 1047/90, 784/180 | new |
| up | 1047/70, 1319/70, 1568/70, 2093/140 | the test's SET |
| fall | 1568/100, 1047/200 | new |
| low | 784/120, 523/220 | the test's REFUSED |
| ask | 1319/80, 0/50, 1760/160 | new |
| jingle | 1319/80, 1568/80, 2637/80, 2093/80, 2349/80, 3136/200 | the test's MATCH |
| warn | 880/150, 698/150, 880/150, 698/150 | the test's WARNING |

*down* is gentle by its notes, not by its volume **(new: the chime was too
quiet at the same volume)**. The new notes are starting points, tuned by
ear on the band with the owner. Each twin keeps them in one table, so a
change is one line. The longest sounds, *jingle* and *warn*, last 0.6 s.

### The flashes

A flash runs in steps: *on* for *on* ms, then *off* for *off* ms, *count*
times. Then the face comes back.

- An *on* step is the colour at LIGHT_FULL, with no words, no code (so no
  QR) and no bar.
- An *off* step is the backlight off (LIGHT_OFF). What lies under it is
  never seen, so the band does not redraw for it (§3, painting).

| Moment | Colour | Count × on / off (ms) | From |
|---|---|---|---|
| SET | the card's: hi, song or dance; white for OFF | 2 × 150 / 100 | the test's SET |
| CHANGED | red, `#FF6B6B` | 3 × 120 / 90 | the test's REFUSED |
| NOT SENT, and a warning | orange, `#FF8A00` | 2 × 350 / 250 | the test's WARNING |
| the check number | white | 2 × 150 / 100 | as SET |
| a meeting call | the meeting face, then off | 500 / 500, until answered | once a second, as agreed |

The test's meeting blinked twice a second. Red is the phone's own `--stop`.
Orange is not the phone's `--warn` (`#FBBF24`) **(new: on this screen that
amber is too close to FIRST SONG's yellow, `#F2D65E`, and a song SET must
not read as a warning)**. The test used the screen's pure red and orange.

## §2. The rules

1. **NOT NOW is silent.** It starts at the FACE hold, or at a show about the
   wearer that says they are quiet. It ends at a show about them that says
   they are shown again, once no hold of the wrist's own is still waiting to
   be heard. In between:

   - no sound and no flash: not for presses, holds or warnings;
   - a press still wakes the face.

   Two exceptions, both the wearer's own deliberate act:

   - the FACE hold that goes into NOT NOW plays *down*;
   - the SET that brings them back from the wrist plays *up*, with its
     flash. It comes with the show that ends the silence.

   A try to come back that ends in CHANGED or NOT SENT leaves them in NOT
   NOW, so it keeps the silence: its word shows on the face, as today
   **(new: the agreed exceptions name only the SET)**.

   Shows that are not about the wearer do not end the silence: waiting,
   away and the test light. Letters do, since the band is then nobody's
   **(new: so a relay restart during NOT NOW stays silent)**. TEST THE
   LIGHT during NOT NOW shows its white, as it does today, and plays
   nothing.

   A warning that comes up during NOT NOW is owed. When NOT NOW ends, one
   *warn* plays if any owed warning still holds, after the reactions of the
   moment that ended NOT NOW (rule 6).

2. **Changes the wearer makes on the phone to their own card or NOT NOW are
   silent on the wrist.** The face changes as it does today; nothing plays
   and nothing flashes. Only a choice made on the wrist ends in SET,
   CHANGED or NOT SENT. Pairing and TEST THE LIGHT start on the phone but
   are about the band itself, so they play: the check, YES and NO all have
   their row in §1. Warnings play whoever caused them.

3. **The sound switch is on the phone,** in the wristband sheet, and on by
   default. Off, nothing plays and every flash stays. The switch is the
   person's own and the phone keeps it across nights **(new: a preference,
   not a night's state)**. The relay carries it to the band (§3).

4. **A meeting calls until it is answered.** A meeting number the wrist has
   not called for plays *jingle*, and the face blinks: the meeting face,
   then off, once a second. The call ends when:

   - a key goes down on the resting face while it calls, even during
     another reaction's flash;
   - the number goes (MEET_MS, 15 minutes);
   - NOT NOW starts;
   - the band stops believing its show, after STALE_MS out of reach.

   The key that answers only answers. It ticks and does nothing else: no
   wake, no look, no KEEP HOLDING, and holding it down never becomes a
   hold.

   The wrist remembers the last number it called for, so the same number
   shown again after a reconnect does not call again. It forgets the number
   at a show about the person that is not a meeting. The test light,
   waiting and away do not make it forget. So a later meeting calls even
   with the same number, and so does a meeting still running when the
   wearer comes back from NOT NOW, after that moment's SET (rule 6).

   The blinking and the answering press belong to the resting face
   **(new)**: no choice under way (a look, a choice or a send) and no
   SET, CHANGED or NOT SENT on the face. A number that arrives otherwise
   plays its jingle at once, and the choice's presses keep working. The
   blinking starts when the face is resting again.

5. **An unpaired band sleeps, wakes on a press, and says where to go.**

   - **The letters sleep (owner's addition, 25 Sep).** Today the letters
     and their QR stay lit for as long as the band is unpaired, which
     spends the battery and leaves the code up for anyone passing. New
     letters light for PAIR_AWAKE_MS (2 minutes), then the face goes dark.
     New letters arrive after a boot, after UNPAIR, after a check that
     ended without YES, and when the relay forgets the band. A press of
     either key lights them again for PAIR_AWAKE_MS, counted from the
     press.
   - **The waiting face sleeps the same way.** OPEN YOUR PHONE, after a
     relay restart, lights for PAIR_AWAKE_MS when it starts and again after
     a press. Today it stays lit for up to the band-alone hour.
   - **The check stays lit.** Someone is pairing at that moment, and the
     relay already ends the check if nobody answers.
   - **A press says where to go.** On the letters or the check, a press
     ticks and puts PAIR ON YOUR PHONE on the face for HINT_MS (3 s). On
     the letters the line goes under them; on the check it takes the place
     of ON YOUR PHONE?.
   - **Nothing else happens there:** no KEEP HOLDING, no NOT NOW, no look.
     Today a FACE hold there goes dark and sends `hold`, which the relay
     ignores. On the waiting face the band is still its owner's, so its
     keys work as they do today.

6. **One reaction at a time, in order.**

   - **Reactions come from changes:** a key, a result, or a show that says
     something different from the last one. A show that differs from the
     last only in `sound` causes none **(new)**.
   - **One moment, several reactions.** They play in this order: the
     wearer's own key or result, then a call, then a warning. Each waits
     for the one before to finish its sound and flash, and none cuts
     another **(new: so a warning owed through NOT NOW never cuts the SET
     that ends it)**.
   - **A later moment replaces.** A reaction from a later moment replaces
     the one playing: a new sound stops the old, and a new flash replaces
     the old. A key going down ends a flash; what is still queued behind it
     plays after.
   - **A warning waits for a choice.** One that comes up during a look, a
     choice or a send waits, sound and flash, until the face is resting
     **(new)**.
   - **The blink comes back.** When a flash ends, a meeting that is still
     calling blinks again.

7. **Each warning plays once per change.** It plays when its condition
   starts, and again only after the condition has ended and started again:

   - **Out of reach** starts STALE_MS after a paired band last had the
     relay, and ends when it has the relay again.
   - **Waiting** starts STALE_MS after the first `waiting` show, and ends at
     any other show.
   - **Away** starts at an `away` show, and ends at a show that is not away.
   - **Unpaired** plays when letters reach a band that was paired, that is,
     one that held a secret.
   - **Battery**: at or below 15% warns once, and again only after a
     reading of 20% or more. At or below 5% warns once, and again only after
     10% or more **(new: readings wobble by a point or two)**. The first
     reading after a boot counts as a change.

   Losing the relay does not end away or waiting **(new)**. A band that is
   shown away again when it comes back does not warn about it again.

## §3. Who does what

Who decides the cards stays as it is: the relay decides and the wrist asks.
This spec is only about what the band plays and shows.

### The wrist (`app/lib/wrist.js`, and the `Wrist` in `band_logic.h`)

The two twins decide every reaction, and the shared table holds them to it,
as in phase A.

- **A new output, `sounds()`.** It gives the names of the sounds due to
  start since the last call, as `take()` gives frames. A sound the rules
  silence is never in it. The wrist queues one moment's reactions itself
  (rule 6) and hands each sound out only when it is due, so the player just
  plays the newest name it is given.
- **`face(now)` draws the flashes and the meeting blink** (§1, the
  flashes). The blink's *on* step is the meeting face as it is. The face's
  fields gain `red` and `orange`. `main.cpp` and the stand-in keep drawing
  whatever `face(now)` returns.
- **The hint is the face's small line.** On the letters face that line is
  new, and both drawers show it under the letters.
- **Shows gain a field, `sound` (see the relay below).**
  - The wrist keeps the last one it was given. It is on at boot, and set by
    any show that carries it. It lives in RAM, as the secret does.
  - A show's own `sound` counts for the reactions that show causes, so the
    white flash that ends a pairing is silent when the switch is off.
  - Letters carry none. The reactions letters cause (unpaired, the check
    ending) use the switch as the band had it, and only then does it go
    back on, since the band is nobody's **(new)**.
  - A `sound` that is not true or false reads as absent: the frame readers
    must not turn it into a default.
- **What the wrist now remembers,** all in RAM:
  - the sound flag;
  - the flash showing and when it began, and the reactions queued behind
    it;
  - the meeting number it last called for, and whether it is still
    calling;
  - whether it is in NOT NOW for the sake of silence (rule 1);
  - which warnings it has played and which are owed;
  - which battery thresholds are armed;
  - when waiting began, and until when the letters or the waiting face are
    lit.
- **Holds do nothing on the letters or the check** (rule 5). The key that
  answers a meeting call does not count (rule 4).
- **The tables.** Each twin keeps the notes and the flash patterns as
  tables, like the timing constants. The new timings (HINT_MS,
  PAIR_AWAKE_MS, BLINK_MS and the flash steps) are named constants in both.
  A test holds each twin's tables and constants to the other's.

### The relay

- **The message.** A phone in a room may say
  `{ t: 'sound', on: true|false }`. Anything but a boolean `on` is dropped.
- **Where it is kept.** The switch is kept per person, in a map in the room
  record **(new: the approved design kept it on the band record. Kept per
  person, a band paired later, or claimed after a restart, gets it in its
  first show, and no sound slips out between the pairing and the phone's
  next message)**.
  - The `leave` message forgets it.
  - The grace does not, so a band showing `away` still carries it.
  - It goes with the room when the room is let go (`gcRoom()`).
- **What shows carry.** `bandShow()` takes the switch. Once the relay has
  heard it from the person's phone, `sound` goes on every show to that
  person's band:
  - their own shows;
  - the white flash that ends a pairing, and TEST THE LIGHT's;
  - `away`.

  Letters, the check and `waiting` carry none: those bands are nobody's yet,
  or the relay does not know whose. A show without `sound` leaves the band
  as it was, and a show made without a known switch is exactly today's
  show **(new: the approved design sent only `sound:false`. Saying it both
  ways lets a show that does not know leave the band's flag alone)**.
- **One show per flip.** `showBand()` already sends a show only when its
  text changes, so a flip of the switch sends one show. That show causes no
  reaction (rule 6).
- **Only the sender's band.** The switch reaches no one else's band, and
  `again` changes nothing for it. Like TEST THE LIGHT it needs no throttle:
  a flood can only keep the sender's own band's socket busy.

### The phone

- **A row in the wristband sheet:**
  - on: **SOUND: ON**, icon `volume_up`, "tap for light only.";
  - off: **SOUND: OFF**, icon `volume_off`, "light only. tap to hear it
    again."

  A tap flips the switch, closes the sheet, and says "your wristband will
  only light up." or "your wristband will chirp again."
- **The store** keeps it at the top level as `bandSound`, true unless set,
  beside the name. `load()` keeps only the keys it lists, so it gains this
  one.
- **The phone says it on every join,** as a standing fact: `net.keep` at
  connect, `say` on a flip. `SAID_ORDER` puts `sound` first, before the
  claim. It touches nothing in the room, so the claim still comes before
  every fact that does, and a band claimed after a restart gets the switch
  in its first show.
- **TEST THE LIGHT's line** becomes "it flashes white for two seconds, and
  chirps unless its sound is off or it is in NOT NOW."

### The firmware (`main.cpp`)

- **The speaker, as in the test.** `M5.Mic.end()`, then
  `M5.Speaker.begin()`, volume 255. The 5V boost stays off: the StickS3
  played through it that way. A band with no speaker (the first M5StickC)
  only flashes, and says so once on the console.
- **Playing.** When `sounds()` names a sound, the loop renders all its
  notes as one 8-bit triangle wave into a buffer and hands the buffer to
  `M5.Speaker.playRaw()`, on one fixed channel with `stop_current_sound`
  **(new: the test started each note from its loop. Here painting a face
  holds the loop for tens of milliseconds, which would bend a tune's
  rhythm. One buffer per sound leaves the timing to the speaker's own
  task.)**
  - There are two buffers, used in turn. `playRaw()` keeps reading the
    caller's buffer while it plays, and M5Unified's own notes ask for two
    or more.
  - Each buffer is sized from the longest sound in the table: 0.6 s at
    16 kHz, about 10 KB, so 20 KB for both. The Plus has no PSRAM, so the
    plan measures its free memory before relying on that.
  - Only the newest name from `sounds()` plays.
  - The renderer lives in `band_logic.h`, so the host tests hold it.
- **The console** prints each sound as it plays (`sound: up`), as it already
  prints what the band sends and hears.
- **Painting.**
  - `paint()` gains the `red` and `orange` fields. A flash's *on* step is a
    plain fill, not the per-pixel glow the card faces use.
  - `draw()` repaints only when the picture changes. A change of light
    alone, such as every *off* step and the blink, only turns the
    backlight. So a 15-minute blink never stalls the loop, and a quick tap
    is not missed.
  - The small lines on the check and the letters faces are fitted like
    `drawWords()`'s, in up to three fonts and wrapped. Today `drawMeet()`
    draws the check's ON YOUR PHONE? in FreeSansBold9pt7b with no fitting.
    By the font's widths that line is about 166 px on a 135 px face, so it
    may already be clipped; the owner looks on the band. PAIR ON YOUR PHONE
    is about 204 px and needs the fitting.
- **The StickC Plus** plays through its buzzer. M5Unified's buzzer mode
  takes the same samples as the speaker (`tone()` goes through the same
  path), so the buffer should play there too. It is tried first, on the
  band. If it does not play, the fallback drives the buzzer pin with LEDC
  tones directly.

### The stand-in (`/band`)

It plays `sounds()` with Web Audio, triangle oscillators on the same notes,
and draws the new fields and the hint. A browser lets a page make sound only
after it has been tapped, so the stand-in is silent until its first tap.

## §4. Tests and proof

- **The shared table** (`tests/fixtures/wrist-cases.json`, run against both
  twins). Every step now answers `sounds`, besides `sent` and `face`. It is
  checked like `sent`: an empty list unless the step says otherwise, so a
  stray sound anywhere fails.
- **Changes to the old cases:**
  - the `press` shortcut gains a way to state its key-down half's sounds,
    since the tick comes at key down (`tests/wrist-table.js`);
  - a face checked at the moment of a reaction is a flash step now, so
    those checks move past the flash or check the step;
  - the MEET case's first press becomes the answer to the call.
- **New cases,** at least one per row of §1 and per rule of §2:
  - each sound, and each flash with the face sampled in its on and off
    steps;
  - a SIDE hold that sends nothing plays no *double*;
  - NOT NOW:
    - silent, with its two exceptions;
    - a card show while the wrist's own hold waits does not end it;
    - a try to come back that ends NOT SENT, silent;
    - not ended by `waiting`;
    - ended by letters;
    - TEST THE LIGHT inside it, white and silent;
    - an owed warning played once on return, after the SET's sound and
      flash;
  - unpaired warns only on a band that held a secret, with the switch as
    it was. Letters after a check that ended without YES play *fall*
    instead;
  - a card changed on the phone, silent;
  - the switch:
    - off: flashes but no sounds;
    - kept through `waiting`;
    - back on at letters, after the letters' own reactions;
    - a show that differs only in `sound` causes nothing;
    - a `sound` that is not true or false reads as absent;
  - the meeting call:
    - answered by a press that does nothing else, even during a flash;
    - not repeated for the same number after a reconnect, or after the test
      light;
    - repeated after a show about the person that is not a meeting,
      including after NOT NOW and back;
    - ended by STALE_MS out of reach;
    - waiting for a choice, or a result on the face, to end;
  - the hint, and holds doing nothing on the letters and the check;
  - the letters and the waiting face:
    - lit for PAIR_AWAKE_MS, then dark;
    - lit again by a press of either key, for PAIR_AWAKE_MS from the press;
    - new letters lighting at once;
    - the check lit throughout;
  - one moment's reactions in order. A later moment replaces a flash, and
    the blink comes back after it;
  - a warning during a choice waits for the resting face;
  - each warning once:
    - out of reach and waiting, not before STALE_MS;
    - out of reach, never on an unpaired band;
    - battery's thresholds and their re-arming, and the first reading
      after a boot.
- **The tables equal.** `logic_test speak` prints the sound and flash
  tables, and `tests/firmware.test.js` holds them equal to `wrist.js`'s, as
  it does the constants.
- **The host tests:** the renderer (length from the notes, rests silent, the
  wave's range) and the new fields' colours.
- **The relay:**
  - `sound` sets the person's switch, and their band's next show carries
    it;
  - a show is sent on a flip, and not otherwise;
  - letters, the check and `waiting` carry none;
  - nothing is carried before the phone has said it;
  - one person's switch never reaches another's band;
  - a malformed `sound` is dropped;
  - a band paired with the switch off gets `sound:false` in its pairing
    flash;
  - after a restart, the phone's re-said facts put the switch on the
    claimed band's first show;
  - `leave` forgets it; the grace does not, and `away` carries it.
- **The phone:** the row flips the switch and says it; the store keeps it;
  `SAID_ORDER` puts `sound` before `pair` (`tests/net.test.js`).
- **Mutation checks, as in phase A.** Break one guard, and exactly its test
  goes red. The guards include:
  - a tick let through in NOT NOW;
  - the flag reset before the letters' own reactions;
  - an owed warning cutting the SET;
  - `sound` after `pair`;
  - `sound` missing from one kind of show;
  - a warning played twice.
- **In a browser.** The phone and `/band` side by side:
  - every row of §1 seen, and every sound asked of Web Audio (a spy on it);
  - the switch both ways;
  - a meeting between two stand-ins.
- **On the real bands, with the owner:**
  - every row heard and seen once;
  - the switch both ways;
  - a meeting between the StickS3 and the StickC Plus;
  - the Plus's buzzer, and its free memory with both buffers;
  - the check's words and the hint, whole on the screen.
- **README** gains the reactions under "The wristband", the switch, and the
  canvas departure above.

## A question for the owner

On 25 Sep he held the face button again to leave NOT NOW. That is not how
it works: leaving takes a SIDE hold, by his choice on 24 Sep, because being
shown needs a deliberate choice of card. Two ways to go:

- **Keep the SIDE hold, and say it on the band (recommended).** Woken in NOT
  NOW, the face's small line says HOLD SIDE TO COME BACK, where it shows the
  battery today. A FACE hold there shows the same line instead of going
  dark.
- **Let a FACE hold leave NOT NOW too,** back to what was armed. It is
  easier to find, but a squeeze in a pocket could show him. That goes
  against the principle that a change which shows a person must be fresh
  and deliberate.

## Risks

- **A club is loud.** Every result, call and warning also shows in light;
  sound is the extra.
- **Ticks can annoy in a quiet moment.** That is what the switch is for.
- **The notes and flash timings are guesses until heard and worn.** They
  are tables and constants for that reason.
- **The Plus's buzzer and memory are untried.** The fallback is LEDC tones.
- **A warning can still be a false alarm.** Waiting and out of reach wait
  STALE_MS first, but a phone slower than that still sets one off.
- **Anyone who can read an unpaired band's letters can make it chirp** by
  typing them (*ask*, then *fall*). The pairing-attempt limit throttles
  that, and the letters now sleep (rule 5).
- **Sound costs battery.** A tick is 25 ms, and *jingle* and *warn* 0.6 s.
  A night of it is untried, as is a night of the band itself.
