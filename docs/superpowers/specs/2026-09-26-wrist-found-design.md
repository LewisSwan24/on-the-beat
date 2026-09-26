# Found each other: a meeting ends when both say so

Date: 26 Sep 2026. Decided with the owner section by section the same day.
It builds on the waves spec (`2026-09-25-wrist-waves-design.md`) and the
reactions spec (`2026-09-25-wrist-reactions-design.md`): the meeting number,
its call, the side hold, and the sounds and flashes both twins keep.

The owner asked how the wristband carries on after `MEET`, once two people
have actually met. Of the ways offered he chose a side hold on the band,
counted only when both say so, and took bumping two bands together (the
band's motion sensor) as a separate change for later.

## What is true today

Checked on 26 Sep 2026, in the code:

- **After a mutual yes** both wristbands show the same two-digit number over
  `MEET`, in the card's colour, call it with the jingle and blink until a
  key answers, and then hold it. **Fifteen minutes after the match**
  (`MEET_MS`, `relay/band.js`) the number goes and the band shows its card
  again. Nothing else ends it.
- **On the phone**, the match screen (S8) says which number to look for, and
  offers `ON MY WAY` and `Not this one`. `ON MY WAY` only says so on this
  phone and opens the person's screen (S11); nobody else hears of it. S11
  offers `Keep after tonight`, counted only when both keep.
- **So nothing records that two people found each other.** The number
  cannot be put away early, S11 no longer shows it, and Tonight's
  `met at 21:04` is the time of the match, not of a meeting.

## Goal

**When two people have found each other, either can say so from the wrist
or the phone, and once both have, their numbers are put away together.**
Both wristbands play the same short *found* sound and flash, both phones
say *you found each other at 21:14*, and Tonight counts the meeting as met.

One principle decides open cases, as for `Keep after tonight`: **it counts
only if you both do.** Saying it alone changes nothing the other person
can see, and never puts away the number they may still be looking for.

## Not in this spec

- **Bumping two wristbands together** to say it (the motion sensor). A
  separate change, after a spike shows that a fist bump can be told apart
  from two people dancing to the same beat.
- **Declining from the wrist.** `Not this one` stays on the phone: it is a
  block, silent and for the night, and not a thing to press by accident.
- **Taking it back.** A found said by mistake costs nothing: the number
  stays until both have said it.
- **Anything about keeping.** `Keep after tonight` works as it does,
  before or after a meeting is found.

## Where this departs from the canvas, on purpose

Revision 6 shows `MEET` and the number for as long as the meeting lasts,
and S11 has no way to say a meeting happened. This adds a state to the
meeting face (`FOUND: WAITING`), a *found* reaction on both bands, and
`WE FOUND EACH OTHER` on S11. README's "Where this differs from the canvas,
on purpose" gains a line.

## §1. What people see and do

### On the wristband

- **The meeting face** is unchanged until someone says found: the number,
  `MEET`, the card's colour, the jingle and the blink until a key answers.
  The key that answers the call does nothing else, as today, so a side hold
  says found only once the call is answered.
- **Woken** by a face press, the meeting face says `HOLD SIDE: FOUND` in its
  small line for the wake time. On HI with waves waiting, the face press
  opens the wave face instead, as today: a wave comes first.
- **A side hold on the meeting face says found.** It ticks twice as it goes
  (the send-now double tick) and goes to the relay. A side press still opens
  the card chooser, as everywhere; only the hold changes, and only on the
  meeting face.
- **Said, and the other has not:** the number stays, and the small line
  reads `FOUND: WAITING` instead of `MEET`. Only its wearer knows why.
  Refused (the meeting is gone, or out of reach), the band shows `NOT SENT`,
  as for a choice.
- **Both have said it:** both bands play the *found* sound and flash the
  card's colour three times, and the number is gone: the band shows its card,
  or nothing if none is armed. A band that was out of reach at that moment
  plays it when it comes back within `FOUND_SHOW_MS`, and not after. Under
  NOT NOW it plays nothing, as with every call: that band is black and
  silent.
- **Never said by the other:** the number goes at fifteen minutes, as
  today. Nothing says that they did not.

### On the phone

- **S11 gains `WE FOUND EACH OTHER`**, the same thing as the side hold:
  either counts, from either person, whichever they reach first.
- **S11 shows the number to look for** while the meeting is on (fifteen
  minutes, not yet found by both), as S8 does. Today it goes as soon as
  `ON MY WAY` is pressed.
- **Said on your side:** `found on your side. they won't know unless they
  say so too.` — the words Keep uses for the same thing.
- **Both:** `you found each other at 21:14`. The phone buzzes then only when
  no live wristband of theirs plays it instead, as for a wave.
- **Tonight:** a meeting found by both reads `met <name>` at the time it was
  found, and the summary's `met` counts those; a match never found keeps
  its line (`said hi to`, `matched with`, `danced with`) at the match's
  time.
- Offline, it is queued like every action: *Saved. It'll sync when you're
  out.*

## §2. The relay

- **The match records it**, beside `keep`: `found: { [a]: 0, [b]: 0 }`, the
  time each said it (`room.found(id, matchId)`). Only the two people of the
  match can say it; saying it again keeps the first time; a match that is
  gone (a block) refuses it, reading exactly as any meeting that is over.
- **`viewFor()` gives each person** their own `found` (whether they said it)
  and, only once both have, `foundAt` (the later of the two times). **One
  person's found never appears in the other's view.** This is a promise
  test, in `tests/room.test.js`, beside keep's.
- **What the band is shown** (`relay/band.js` `bandShow()`):
  - the meeting face while the match is under `MEET_MS` old and has no
    `foundAt`, with `small: 'FOUND: WAITING'` once its person has said it,
    `'MEET'` before;
  - for `FOUND_SHOW_MS` after `foundAt`, every show about its person carries
    `found: <number>`. The wrist plays the *found* reaction for a number it
    has not played it for, and remembers it, as it does the wave it last
    called for: a reconnect or a relay push never plays it twice.
- **From the band:** `{ t: 'found', number }`, on the band's authenticated
  socket, as a wave back is. The relay takes its person's meeting with that
  number, under `MEET_MS` old and not yet found by both, and answers
  `{ t: 'found', ok: true }`, or `{ t: 'found', ok: false, why }` with
  `unpaired`, `no room` or `gone`. It is stamped before anything is looked
  up, and at most one per `FOUND_GAP_MS`, as waves are. Anything but exactly
  that shape is dropped unanswered.
- **From the phone:** `{ t: 'found', match }` in a room the phone has
  joined, as `keep` is. A phone may say it at any time tonight; the band
  only while its meeting face shows.
- **The phone keeps** `foundAt` in its own record of the night, with the
  match, for Tonight.

  | Constant | Start | |
  |---|---|---|
  | `FOUND_SHOW_MS` | 60 000 | how long after both said it a band still plays it |
  | `FOUND_GAP_MS` | 1000 | the least time between two founds from one band |

## §3. Who does what

- **The relay:** `room.found()` and the view (`relay/room.js`); the meeting
  face and `found` on the show (`relay/band.js`); the band's and the phone's
  `found` frames (`relay/server.js`).
- **The wrist (both twins):** the side hold on the meeting face; the woken
  hint; `NOT SENT` on a refusal; the *found* reaction for a new `found`
  number, once. `SOUNDS.found` and `FLASHES.found` (the card's colour, three
  times) join both tables, held equal by `tests/firmware.test.js`; the
  notes are a start, to be tuned by ear.
- **The phone:** S11's button, words and number (`app/screens/Met.jsx`),
  the action (`app/lib/net.js`), `foundAt` in `app/lib/store.js`, and
  Tonight's line and count.
- **The stand-in (`/band`):** plays it as the band does.

## §4. Tests and proof

1. **The relay's promises** (`tests/room.test.js`): one person's found never
   in the other's view; only the match's two can say it; a second time
   keeps the first; a blocked match refuses; `foundAt` is the later time.
2. **The band's show** (`tests/band.test.js`): `MEET` and `FOUND: WAITING`;
   the meeting face gone once found by both; `found: <number>` for
   `FOUND_SHOW_MS` and not after.
3. **The relay end to end** (`tests/server.test.js`): a band's found lands;
   a wrong or old number, and an unpaired band, are refused; a phone's found
   lands; both said, and both bands are shown it; a second found within
   `FOUND_GAP_MS` is refused.
4. **The table**, run on both twins (`tests/fixtures/wrist-cases.json`): a
   side hold on the meeting face sends found with the double tick; a side
   press there still opens the chooser; woken, the hint; the key that
   answers the call does not send; out of reach, `NOT SENT`; a new found
   number plays once, the same number again plays nothing.
5. **The phone**, in a browser with a seeded night: the button and its
   words, the number on S11, Tonight's line and count.
6. **Mutation checks, as in phase A.** Break each guard, and exactly its
   test goes red.
7. **On the real bands**, driven from the console: the two bands matched to
   each other, a side hold on one shows `FOUND: WAITING`, a side hold on the
   other plays the reaction on both and puts both numbers away. The owner's
   own presses and ears are owed afterwards, as for the waves.

## Also to change when this is built

- README: the wristband's meeting face and its side hold, S11's button,
  "Where this differs from the canvas, on purpose".
- The waves spec's meeting: its number now also ends when both say found.

## Risks

- **A hold on the wrong wrist.** Numbers are two digits, and two pairs can
  share one past ninety matches. A found said at the wrong person keeps the
  number up, so the right one can still find you; it completes only when
  your own match says it too.
- **The side hold means two things.** Elsewhere a side hold opens or sends
  a choice; on the meeting face it says found. The woken hint says so, and
  a side press still reaches the chooser.
