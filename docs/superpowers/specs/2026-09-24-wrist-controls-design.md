# Wrist controls, phase A: changing your own state from the wristband

Date: 24 Sep 2026. Decided with the owner section by section the same day,
after the first StickS3 was paired end to end. Revised the same day after a
self-check: five reviewers read this spec against the code, a skeptic tried to
refute every finding, and a critic looked for gaps. 23 of 38 findings and 6
gaps held up; each is answered below, and three of them were the owner's to
decide (§0, §1 leaving NOT NOW, §2 rule 2).

## Goal

The wristband stops being a display that only follows the phone. From the
wrist alone, with the phone locked in a pocket, a person can:

- change which card is armed (SAY HI, FIRST SONG?, LET'S DANCE!, or none);
- come back from NOT NOW;
- see, on the wrist, that the change was taken, or that it was not.

Whatever the wrist changes, the phone follows; whatever the phone changes, the
wrist follows. Both go through the relay, which decides.

## Not in this phase

- **Phase B: answering someone from the wrist.** Only waving back to a SAY HI
  is possible at all: a like needs the other person's pick, which the wrist
  may never show (canvas §8), and a dance back is a camera clip.
- Proximity, a `scan` console command, line editing on the console.

## Where this departs from the canvas, on purpose

Revision 6 §6 gives the wristband one button — a press wakes it for three
seconds, a one-second hold is NOT NOW — and §8 says "no second button action
beyond §6". The owner chose on 24 Sep 2026:

- a second button, KEY2 (M5Unified's `BtnB` on every supported board; the
  power button, `BtnPWR`, is never used), changes the armed card;
- a press wakes the face for six seconds, not three;
- NOT NOW is a hold of one and a half seconds, not one;
- a connected, paired wristband keeps its person in the room for up to an hour
  without their phone;
- pairing ends with a two-digit check shown on the wrist and confirmed on the
  phone.

README "Where this differs from the canvas, on purpose" records each with its
reason.

## §0. Pairing ends with a check — before anything else ships

**Why first.** Today a wristband paired to the wrong phone — a decoy QR stuck
on someone's band, which the in-app scanner pairs without question, or a band
someone else is holding — can only make its person invisible. With `set` it
could make them visible, arm SAY HI, and keep them in the room. That hole is
closed before `set` exists.

**The check.** All three ways in (typed letters, the in-app scanner, the
phone's own camera opening a `/pair/` link) now end the same way:

1. The phone sends the letters, as today. The relay does not pair yet: it
   marks the wristband *pending* for that person and picks a check number,
   10–99.
2. The wristband that was actually reached shows the number, large, with
   `ON YOUR PHONE?` under it. The phone shows *Does your wristband show 27?*
   with `YES` and `NO`.
3. `YES` pairs: the wristband flashes white, as today. `NO`, or 60 s with no
   answer, drops the pending pairing; the wristband goes back to its letters,
   and the phone says the letters were not this wrist's.

A decoy fails at step 2: the number appears on the attacker's band, not on the
wrist the person is looking at. The `/pair/` link's existing one-tap confirm is
replaced by this check.

**A secret per pairing.** On `YES` the relay makes a random secret and gives
it to that phone (stored with the night) and to that wristband (kept in RAM
only). Claiming a wristband by id after a reconnect or a relay restart now
needs the id *and* the secret; a phone that paired this band on an earlier
pairing, and was since unpaired, cannot take it back.

**A band that was paired stays its owner's until it is switched off.** After a
relay restart the wristband says hello with its secret. The relay records it
as *waiting for its owner*: no letters, no public QR, face `OPEN YOUR PHONE`.
Only a claim with the same secret pairs it; a KEY1 hold on it is kept and sent
once it is claimed. Switching the band off and on (one press of the power
button) forgets the secret, and it comes back with letters. An unpair from the
phone sends the band a pairing show, and the band forgets its secret then.

## §1. What the wearer does and sees

### Timings

One named constant each, in `band_logic.h` and, for the stand-in, in
`app/lib/wrist.js`; tests and fixtures refer to them by name, never by value.

| Constant | Value | What |
|---|---|---|
| `WAKE_MS` | 6 s | a KEY1 press shows the face |
| `HOLD_MS` | 1.5 s | a hold: NOT NOW on KEY1; "send now" on KEY2 |
| `CHOOSE_MS` | 6 s | longest wait for the next KEY2 press before a choice is dropped |
| `COMMIT_MS` | 3 s | after the last KEY2 step, the choice is sent (not from NOT NOW) |
| `CONFIRM_MS` | 10 s | longest wait for the relay to show a sent choice |
| `RESULT_MS` | 3 s | SET / NOT SENT / CHANGED stays on the face |
| `PAIR_CHECK_MS` | 60 s | a pending pairing waits this long for YES |

### KEY1, the face button

- **Press** (released before `HOLD_MS`): wakes the face for `WAKE_MS`.
- **Held**: from 0.3 s the face shows `KEEP HOLDING` with a bar filling to
  `HOLD_MS`; released early it is a press, and an unlit face does not flash
  bright on the way. At `HOLD_MS`: NOT NOW — dark at once, sent when there is
  a relay to send it to, as today.
- **Any KEY1 press-down during LOOK or CHOOSING freezes the chooser at once**
  (no commit can fire), and the release cancels the choice. A KEY1 hold during
  SENDING is NOT NOW and drops the wait for confirmation: no SET, no NOT SENT.
- **NOT NOW's dark face outranks every chooser face.**

### KEY2, the side button: choosing a card

A *step* is a KEY2 press released before `HOLD_MS`. A *KEY2 hold* is one kept
down for `HOLD_MS`. A KEY2 hold with no preview yet (at rest, or in LOOK) only
wakes, like a step into LOOK; it never sends.

```
current   Quiet pending (a KEY1 hold not yet shown by the relay) ? NOT NOW
          : the last show's quiet ? NOT NOW : the last show's armed (a card, or none).

LOOK      first step: wakes the face, shows current, small SIDE TO CHANGE.
          Changes nothing. No step within CHOOSE_MS: the choice is dropped.
CHOOSING  each step moves the preview: HI -> SONG -> DANCE -> OFF -> HI ...,
          starting after current. From NOT NOW the first step is HI.
COMMIT    not from NOT NOW: COMMIT_MS after the last step, or at once on a KEY2 hold.
          From NOT NOW: only a KEY2 hold commits; the face says HOLD SIDE TO SHOW,
          and no hold within CHOOSE_MS of the last step drops the choice.
          At commit, "in force" is checked again: a preview equal to current sends nothing.
SENDING   {"t":"set","intent":...,"basis":rev}; the face shows the choice as a preview
          with small SENDING. Further KEY2 presses are ignored until SET or NOT SENT.
SET       a show with rev > basis, armed == the choice, not quiet:
          that show, with small SET for RESULT_MS.
CHANGED   the relay refused the set because the state moved since `basis`:
          small CHANGED for RESULT_MS, then the relay's show.
          Any other refusal (too fast, not paired, no room) is NOT SENT at once.
NOT SENT  nothing within CONFIRM_MS: small NOT SENT for RESULT_MS, then the relay's show.
```

- **OFF** is visible with nothing armed — tapping an armed card on the phone.
  It does not touch the pick or the floor clip.
- **Offline, KEY2 changes nothing.** With no relay, or none heard for
  `STALE_MS`, LOOK shows `NO SIGNAL` and steps do nothing. A change is never
  queued: coming back visible late is worse than not at all. NOT NOW on KEY1
  still queues.
- **A show that is not about the person** — pairing, the check number, the
  test light, waiting for its owner, no room — carries no `armed`. On such a
  show KEY2 only wakes, and one arriving mid-choice cancels the choice.
- **A show whose `rev` changed mid-choice** (the phone moved the state)
  cancels the choice; the face shows the new state.
- **The meeting number** outranks the card, as today. LOOK and the preview
  replace it while they last; SET is decided from `armed`, not the face.
- **SONG and DANCE** can be chosen with no pick or clip, as on the phone.

### The chooser's faces

The firmware draws two lines on one field (`wordsFor`, `lightFor`); these fit.

| Face | Big | Small | Field | Light |
|---|---|---|---|---|
| LOOK, a card | the card's words | `SIDE TO CHANGE` | the card's hue | full |
| LOOK, none | `READY` | `SIDE TO CHANGE` | black | `LIGHT_AWAKE` |
| LOOK, NOT NOW | `NOT NOW` | `SIDE TO CHANGE` | black | `LIGHT_AWAKE` |
| preview, a card | the card's words, in its hue | `SIDE: NEXT` | black | `LIGHT_AWAKE` |
| preview, OFF | `OFF` | `SIDE: NEXT` | black | `LIGHT_AWAKE` |
| preview from NOT NOW | as above | `HOLD SIDE TO SHOW` | black | `LIGHT_AWAKE` |
| SENDING | as the preview | `SENDING` | black | `LIGHT_AWAKE` |
| SET / CHANGED / NOT SENT | the relay's show | the word, replacing the card's own small line | as the show | as the show |
| KEY1 held | unchanged | `KEEP HOLDING` + bar | unchanged | at least `LIGHT_AWAKE` |

A preview is never a colour field, so nobody across the room reads a card the
wearer is only passing through. The card words the firmware draws for a
preview (`HI :)`, `FIRST SONG?`, `LET'S DANCE!`) are tested equal to
`bandShow`'s.

## §2. The relay decides

The relay is the one place a person's state lives. Per person it keeps
`armed`, `invisible`, and three new fields: `rev` (bumped on every change to
`armed` or `invisible`, from anywhere), `seq` (the largest phone seq received,
0 for a new person), and `by` (`'phone'` or `'band'`, who made the last
change). A view carries `me.seq` and `me.by`; a wristband show made from a view
carries `armed` and `rev`.

1. **The wristband may say `set`.** `{"t":"set","intent":"hi"|"song"|"dance"|null,"basis":<rev>}`.
   The whole frame is dropped, before anything is touched, unless `intent` is
   present and is null or one of `INTENTS`, and `basis` is an integer. It is
   taken only from a wristband paired (§0) to a person who is in a room. If
   `basis` is not the person's current `rev`, the relay answers
   `{"t":"set","ok":false,"why":"changed"}` and changes nothing — a stale
   choice, or one racing a NOT NOW from the phone, never lands. Otherwise:
   `setInvisible(false)`, `arm(intent)`, `by = 'band'`. At most one `set` a
   second per wristband; more are answered `ok:false` and dropped.
2. **A live wristband keeps its person in the room — for an hour.** One grace
   function serves every trigger: it clears any timer the person already has,
   never starts while the relay is closing, and is cleared by a phone or a
   wristband of that person connecting. It starts when a person's last phone
   socket closes and their wristband is not connected, or their wristband
   closes and no phone socket of theirs is open. Separately, a person held
   only by a wristband leaves when `BAND_ALONE_MS` = 60 min have passed since
   any of their phones was last heard (any message, pings included), or at
   the relay's 06:00, whichever is first. The phone's explicit leave still
   leaves at once. Grace and band-alone lengths are options of the relay, so
   tests run them in milliseconds.
3. **A re-said fact is judged by its seq.** Each `arm` and `invisible` from a
   phone carries `seq`. One marked `again` is applied only if its `seq` is
   above the person's `seq`: then the relay never saw it (a tap lost in a
   socket that died without closing). At or below, it was already seen and
   the room knows better. A relay restart or an expired grace starts the
   person at `seq` 0, so every re-said fact rebuilds them. Unmarked messages
   are applied as today. Either way the relay's `seq` becomes the larger of
   the two. A `seq` that is not a finite number drops the frame. Today's rule
   and its test — a re-said fact never undoes NOT NOW — hold under this.
4. **An old view cannot pull the phone back.** A phone's `seq` is
   `max(last + 1, Date.now())`, so a reload does not start below one the relay
   holds. The phone ignores `armed` and `invisible` in any view whose `me.seq`
   is below the last seq it sent.

## §3. The phone follows the relay

**It never asserts state it has not just been asked for.** Today every page
load says `arm: null` unmarked, and re-says a stored NOT NOW; both would undo
a card chosen on the wrist. Instead, the phone stores `armed`, `invisible` and
its last `seq` with the night, draws them at once, and puts them in net.js's
`said` as kept facts — sent only as `again` copies — never in the queue. The
first view that passes rule 4 then sets the cards.

**Offline, it queues only NOT NOW.** Arming a card or coming back visible
while offline shows *Not connected — try again*, as the wrist does; NOT NOW is
queued and re-said.

**Following.** `app/lib/follow.js` is pure: given the phone's `armed`,
`invisible`, last `seq`, the current `screen` and `stack`, and a view, it
returns what to adopt, what to keep in `said` (the view's values, with the
view's `me.seq`, so a later `again` copy is at or below the relay's), the
screen, whether to clear the stack, a toast, and the events the phone's own
`arm()` would have added. Following never calls `say()`.

| The relay's state moved to | The phone |
|---|---|
| a different card, or none | Adopts it. If the open screen belongs to a card no longer armed (from `INTENT_OF`: beacon, near, pick, wall, camera, floor), home with the stack cleared. If `me.by` is `'band'`: `Armed from your wristband: SAY HI` / `Your wristband turned your card off`. |
| invisible | The quiet screen, stack cleared, as today — the special case at `App.jsx` ~229 becomes this row. |
| visible, no card | Off the quiet screen to home; if `by` is `'band'`, `Visible again, from your wristband`. |
| visible with a card, in one view | Home; if `by` is `'band'`, `Back on, from your wristband: SAY HI`. |

A wrist change has the phone's side effects too: the first SAY HI adds the
"started saying hi" event, and the battery prompt, now tied to the beacon
screen, is tied instead to "paired, battery at or below 15%, not asked yet".

**Copy.** Every site that says one button, one second, three seconds, or
"only lights up while you're saying something" changes with the constants:
S1 House rules, the pair screen, the stand-in's labels and `aria-label`,
`band_logic.h`'s comments, and README's two wristband sections. The stand-in's
labels are built from its constants. A test greps for the old phrases.

## §4. The stand-in, tests and proof

- **One Wrist, twice.** `band_logic.h` gets one `Wrist` class that owns both
  buttons, the chooser, Quiet, staleness and the pairing secret: it takes key
  states, link up/down, relay frames and the time, and returns frames to send
  and the face. `main.cpp` only feeds it and draws. `app/lib/wrist.js` is the
  same machine in JavaScript, and `/band` becomes a thin shell over it with a
  second button, SIDE.
- **One table of cases.** `tests/fixtures/wrist-cases.json` lists key downs
  and ups, link changes, relay frames and ticks, with times written as named
  constants (`"HOLD_MS+1"`), and what must be sent and shown. `tests/wrist.test.js`
  runs it against `wrist.js`; a new mode of the host binary reads the same
  events on stdin and `tests/firmware.test.js` runs the table against
  `band_logic.h`. It includes: two stray presses from NOT NOW send nothing;
  KEY1 down at +2 s of a choice sends only `hold`; releases at 1.0, 1.4 and
  1.5 s; a rev change mid-choice; a pairing show mid-choice; offline LOOK.
- **The relay, one test per guard**, each mutation-checked so exactly its test
  goes red: `set` validation (with malformed frames in the fuzz test, NOT NOW
  surviving them), paired, in a room, basis, rate; again-by-seq (a NOT NOW
  sent only as `again` within the grace is applied); seq acknowledged when a
  message is ignored; grace skipped while the band is live; one timer per
  person (phone drops, band drops twice, `close()` leaves no timer); no grace
  while closing; the band-alone hour; 06:00; the pairing check (pending until
  YES, dropped on NO and on timeout); claim needs the secret; a restarted
  relay keeps a paired band waiting for its owner.
- **The phone**: `tests/follow.test.js` covers every row of the table, the
  combined row, the first view after a restart, and that following sends
  nothing; rule 4's mutation check lives there.
- **Tests that change on purpose**: `logic_test.cpp`'s button checks
  (`HOLD_MS`), the stand-in's timers, `band.test.js` (shows now carry `armed`
  and `rev`), grace tests (now on the option), the pairing tests (now through
  the check).
- **A C++ compiler on this laptop** (WinLibs g++, by winget), installed before
  `HOLD_MS` changes. The host binary's output is split on `/\r?\n/`. MinGW has
  no sanitizers, so here the build runs without them; CI keeps them.
- **CI builds both envs**, `m5stickc` and `m5sticks3`, and keeps both images.
- **In a browser**: the app and `/band` side by side — pair through the check
  (and say NO once), choose from the wrist, leave NOT NOW by holding, the
  toasts, reload the phone after a wrist change, a reconnect, a relay restart
  with the phone closed (the band waits for its owner).
- **On the real band and phone**: every flow once; then the phone locked in a
  pocket for more than two minutes, SAY HI chosen on the wrist, a second
  browser in the room seeing the person in SAY HI; then unlock the phone and
  check the card is still SAY HI.

## Risks

- **A lost phone tap that arrives late wins over a wrist change made in
  between** (rule 3 applies it because the relay never saw it). Both were the
  person's own choices, and NOT NOW winning when in doubt is the safe side.
- **After a relay restart with the phone away**, the room is rebuilt from what
  the phone last knew once it is back; until then the band waits for its owner.
- **The check number is only as good as the glance at the wrist.** It turns a
  silent decoy into a question the person has to answer wrongly.
- **Timings are guesses until worn.** They are constants for that reason.
