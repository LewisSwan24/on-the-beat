# Wrist controls, phase A: changing your own state from the wristband

Date: 24 Sep 2026. Decided with the owner, section by section, the same day,
after the first StickS3 was paired end to end.

## Goal

The wristband stops being a display that only follows the phone. From the
wrist alone, with the phone locked in a pocket, a person can:

- change which card is armed (SAY HI, FIRST SONG?, LET'S DANCE!, or none);
- come back from NOT NOW;
- see, on the wrist, that the change was taken.

Whatever the wrist changes, the phone follows; whatever the phone changes, the
wrist follows. Both directions go through the relay, which decides.

## Not in this phase

- **Phase B: answering someone from the wrist.** Only waving back to a SAY HI
  is possible there at all: a like needs the other person's pick, which the
  wrist may never show (canvas §8), and a dance back is a camera clip. Phase B
  gets its own design once this one is on a real band.
- Proximity, a `scan` console command, and line editing on the console.

## Where this departs from the canvas, on purpose

Revision 6 §6 gives the wristband one button — a press wakes it for three
seconds, a one-second hold is NOT NOW — and §8 says "no second button action
beyond §6". The owner chose to depart from both on 24 Sep 2026:

- a second button, KEY2 on the StickS3's side, changes the armed card;
- a press wakes the face for six seconds, not three;
- NOT NOW is a hold of one and a half seconds, not one;
- a paired wristband that is connected keeps its person in the room.

README "Where this differs from the canvas, on purpose" records each of these
with its reason.

## 1. What the wearer does and sees

### KEY1, the face button: as now, slower

- **Press:** wakes the face for `WAKE_MS` = 6 s: the armed card, or `READY`
  and the battery, or `NO SIGNAL` and why.
- **Hold for `HOLD_MS` = 1.5 s:** NOT NOW. Dark at once and sent when there is
  a relay to send it to, exactly as today.

### KEY2, the side button: choosing a card

```
LOOK      first press: wakes the face, shows the current state, and a small
          line saying the side button chooses. Changes nothing.
          No second press within CHOOSE_MS = 6 s: back to how it was.
CHOOSING  each press inside the window moves the preview one step:
          HI -> SONG -> DANCE -> OFF -> HI ...
          starting from the one after the current card.
          From NOT NOW, LOOK shows NOT NOW and the first step is HI.
COMMIT    COMMIT_MS = 3 s after the last press. If the preview is the state
          already in force, nothing is sent and the face goes back.
SENDING   the face shows the chosen card with a small SENDING.
SET       the relay's next show has armed == the choice and is not quiet:
          the card as the relay shows it, with a small SET, for RESULT_MS = 3 s.
NOT SENT  no such show within CONFIRM_MS = 10 s: a small NOT SENT for
          RESULT_MS, then whatever the relay last said.
```

- **OFF** is visible with nothing armed — the same as tapping an armed card
  on the phone. From NOT NOW, committing OFF brings the person back visible
  with nothing armed.
- **A preview sends nothing.** It is drawn as the card's words in its hue on
  black, never as a full colour field, so nobody across the room reads a card
  the wearer is only passing through.
- **Offline, KEY2 changes nothing.** With no relay (or a relay not heard from
  for `STALE_MS`), LOOK shows `NO SIGNAL` and further presses do nothing. A
  change is never queued: coming back visible later than meant is worse than
  not at all. NOT NOW on KEY1 still queues, as today.
- **Pairing:** while the face shows the four letters, KEY2 does nothing but
  wake, like KEY1.
- **Meeting number:** while a match's number is showing, it keeps showing —
  it outranks the card, as today. KEY2 still works; LOOK and the preview
  replace the number for as long as they last, and SET is confirmed from
  `armed`, not from the face.
- **KEY1 during CHOOSING** cancels the choice. A KEY1 hold is still NOT NOW.

Every timing is one named constant, in `band_logic.h` for the firmware and in
one place for the `/band` stand-in, so a value tuned on a real wrist is a
one-line change.

## 2. The relay decides

The relay is the one place the state lives. Four rules:

1. **The wristband may say `set`.** `{"t":"set","intent":"hi"|"song"|"dance"|null}`
   means "visible, with this card armed" (`null`: none). It is taken only from
   a wristband that is paired to a person who is in a room; anything else is
   ignored. Its effect is `setInvisible(person, false)` then
   `arm(person, intent)` — what the phone does when a card is tapped.
2. **A live wristband keeps its person in the room.** A phone's socket closing
   starts the two-minute grace (`GRACE_MS`) only if that person's wristband is
   not connected; when the grace runs out with the wristband connected, the
   person stays. A wristband closing, with no phone socket for its person,
   starts the same grace. The phone's explicit leave still leaves at once.
3. **Said again is not said new.** On every join the relay notes whether the
   person was already in the room. The `arm` and `invisible` a phone re-says
   after reconnecting (marked `again`) are applied only when the person was
   not: after a relay restart, or once the grace has run out. Otherwise the
   room already knows better, and the phone follows it. This generalises
   today's rule that a re-said fact never undoes NOT NOW; that rule's test
   stays.
4. **An old view cannot pull the phone back.** Each `arm` and `invisible` the
   phone sends carries `seq`, larger than any it sent before
   (`max(last + 1, Date.now())`, so a reload does not start below a view the
   relay still holds). The relay keeps the largest seq it has received from
   that person — whether it applied the message or not — and puts it in the
   view as `me.seq`. A phone ignores `armed` and `invisible` in any view whose
   `me.seq` is below the last seq it sent.

What the relay sends a wristband gains one field: `armed`, the person's own
armed card (or null), on every show made from a view. It says nothing about
anyone else; it lets the wrist know where to start choosing while a meeting
number is up, and confirm SET.

## 3. The phone follows the relay

When a view passes rule 4:

| The relay's state moved to | The phone |
|---|---|
| a different card, or none | Updates its cards. If this phone did not ask for it, a toast such as `Armed from your wristband: SAY HI`. If the open screen belongs to a card that is no longer armed (beacon, near, pick, wall, camera, floor), back to home; otherwise it stays. |
| invisible | The quiet screen, as today — the special case in `App.jsx` becomes this general rule. |
| visible again | Off the quiet screen to home, with `Visible again, from your wristband`. |

- The phone's stored NOT NOW follows too, so a reload does not bring back an
  old state.
- The decision is a pure function (`app/lib/follow.js`): given what the phone
  holds, what it last sent and the view, what to adopt and what to say. It is
  tested without a browser.
- Copy: S1 House rules gets the new hold, "Hold the button on your wristband
  for a second and a half to go invisible", and one line for KEY2, worded at
  implementation. The stand-in's labels follow.

## 4. The stand-in, tests and proof

- **`/band`** gets a second button, SIDE, with the same gestures and timings,
  sending the same `set`. Its chooser is a pure module (`app/lib/wrist.js`).
- **One table of cases, two implementations.** `tests/fixtures/wrist-cases.json`
  lists presses, releases and relay shows on a clock, and what must be sent
  and shown. `tests/wrist.test.js` runs it against `wrist.js`; the firmware's
  host binary gets a mode that reads the same events on stdin, as `speak`
  does, and `tests/firmware.test.js` runs the same table against
  `band_logic.h`. Either side drifting fails a test.
- **Relay:** each of rules 1–4 is a test in `tests/server.test.js`, and each
  is mutation-checked: break the guard and exactly its test goes red.
- **A C++ compiler on this laptop** (WinLibs g++, by winget), so the firmware
  tests stop skipping here and run on every `npm test`, not only in CI.
- **In a browser:** the app and `/band` side by side — choose from the wrist,
  come back from NOT NOW, the toasts, a reconnect, a relay restart.
- **On the real band and phone:** every flow once, then the one that matters:
  phone locked in a pocket for more than two minutes, SAY HI chosen on the
  wrist, and a second browser in the room seeing the person in its SAY HI list.

## Risks

- **A person whose phone died is still in the room while the band is on.**
  That is the point of rule 2, and NOT NOW is always one hold away. Out of
  Wi-Fi range the band drops and the grace runs as for a phone.
- **After a relay restart with both away,** the room is rebuilt from what the
  phone last knew, which can be older than a change made on the wrist before
  everything dropped. Rare, and the wrist shows the truth the moment it is
  back.
- **Timings are guesses until worn.** They are constants for that reason.
