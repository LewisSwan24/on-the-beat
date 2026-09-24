# Wrist controls, phase A: changing your own state from the wristband

Date: 24 Sep 2026. Decided with the owner section by section the same day,
after the first StickS3 was paired end to end. Checked three times before any
code:

- **Round 1.** Five reviewers read the spec against the code, a skeptic tried
  to refute each finding, and a critic looked for gaps. 23 of 38 findings and
  6 gaps held. Three answers were the owner's: the pairing check (§0), a hold
  to leave NOT NOW (§1), and the one-hour limit (§2 rule 2).
- **Round 2.** Two checkers tested whether the revision closed round 1's
  items, and a reviewer read the mechanisms it added. 15 of 29 items were
  closed. Of the 16 still open, the high one was that a wristband's permanent
  id let any earlier pairer impersonate it. §0's identity model and §2 rule 3
  below answer that one and the rest.
- **Round 3.** A checker tested round 2's items and a walker traced twelve
  cross-device timelines. 10 of 16 closed and nothing high was left; the six
  medium and five low items are answered here — the band key whose hash is the
  id, rule 5's basis for every showing change, invisibility remembered past
  leaving, the phone-first order after a restart, a leave carried until it is
  heard, and `gone` said only by the relay.

## Goal

The wristband stops being a display that only follows the phone. From the
wrist alone, with the phone locked in a pocket, a person can:

- change which card is armed (SAY HI, FIRST SONG?, LET'S DANCE!, or none);
- come back from NOT NOW;
- see, on the wrist, that the change was taken, or that it was not.

Whatever the wrist changes, the phone follows; whatever the phone changes, the
wrist follows. Both go through the relay, which decides.

**One principle runs through all of it, the owner's:** a change that hides a
person may arrive late; a change that shows them may not. Anything that makes
a person more visible is taken only when it is fresh and deliberate.

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

## §0. Who a wristband is, and pairing with a check — before anything else ships

**Why first.** Today a wristband paired to the wrong phone — a decoy QR on
someone's band, which the in-app scanner pairs without question, or a band
someone else holds — can only make its person invisible. With `set` it could
make them visible and arm SAY HI. And today a wristband is only its id: the id
is kept in flash for good (`main.cpp`), every phone that ever paired it was
told it (`{t:'paired', band}`), and a hello with that id takes over the live
record (`server.js` ~184). Both holes close before `set` exists.

### Identity: an id per boot, a secret per pairing

- **A key is made at every boot, and the id is its hash.** The wristband makes
  a random 128-bit key at boot, in RAM only, and its id is the first 32 hex of
  SHA-256 of that key. Every hello carries the key; the relay recomputes the id
  and refuses a hello whose key does not hash to it. The key never leaves the
  hello and is never told to a phone, so knowing an id — every pairer does —
  is not enough to speak as the band, for a paired, pending or unpaired record
  alike. Switching the band off and on makes it a new wristband, with new
  letters. (README's "an id it made once and keeps" changes.)
- **A secret is made at every pairing.** On `YES` (below) the relay makes a
  random secret and gives it to that phone (stored with the night) and to that
  wristband (RAM only). An unpair, a timeout of the waiting state (below), or a
  reboot ends it.
- **A paired record is only ever reached with its secret.** A hello
  `{t:'wristband', id, key, v:2}` for an id the relay holds as paired must also
  carry the current `secret`; without it, or with the wrong one, the new
  socket is refused and closed, and the live socket is left alone. A phone's
  claim by id needs the secret too. Frames from a wristband are taken only
  from its current socket (`b.ws`); anything still arriving on a replaced one
  is dropped.
- **The hello carries a protocol version** (`v:2`). The relay does not pair a
  wristband without it; the phone says *Update this wristband's firmware.*

### After a relay restart: waiting for its owner

The wristband says hello with its id, key, secret and, if a KEY1 hold is still
waiting to be sent, `quiet:true`. The relay records it as *waiting for its
owner*: no letters, no public QR; the face says `OPEN YOUR PHONE` / `OR SWITCH
ME OFF`. A KEY1 hold while it waits sets that record's `quiet` too. Only a
claim with the same secret pairs it, and the record's `quiet` is applied at
that moment. If no claim comes within `BAND_ALONE_MS` or by the relay's 06:00,
the relay sends it a pairing show; it forgets its secret and shows fresh
letters.

**Either may be back first.** A phone's claim (id and secret) for an id the
relay does not hold keeps a placeholder with that secret — one per person —
for `BAND_ALONE_MS`; the phone is told it is waiting, not that there is no such
wristband. When the wristband's hello comes, proven by its key, its own secret
decides: if the placeholder's matches, they pair; if not, the placeholder is
dropped and its claimer told `gone`.

**A wristband that is gone.** The relay forgets a paired record whose
wristband has been away for `BAND_ALONE_MS`. Until then the phone's wristband
chip says `OFFLINE` once the band has been away for two minutes, with `PAIR
AGAIN`; after it, the phone's next claim is answered `{t:'claim', ok:false,
why:'gone'}` and the phone says *Your wristband restarted or went away. Pair
it again.* The phone decides a band is gone only from that answer, never from
a view without a wristband — which is what every first view after a relay
restart looks like, before the claim is heard. A wristband that reboots while
the relay stays up is new, and its old record goes this way.

### The check

All three ways in — typed letters, the in-app scanner, the phone's camera
opening a `/pair/` link — end the same way:

1. The phone sends the letters. The relay does not pair yet: it marks the
   wristband *pending* for that person and draws a check number, 10–99, unique
   among all pendings in progress (as match numbers are). One pending per
   wristband and one per person: another `pair` for a pending wristband is
   refused `busy`, and that phone says *Someone is pairing that wristband right
   now. Try again in a minute.* and leaves its waiting state. Every `pair`
   attempt, right or wrong, counts toward the per-socket attempt limit.
2. The wristband that was actually reached shows the number, large, with
   `ON YOUR PHONE?` under it. The phone shows a sheet — *Does your wristband
   show 27?* with `YES` and `NO` — that stays over any screen and comes back
   if the phone reconnects; the pending belongs to the person, not the socket.
3. `YES` pairs: the wristband flashes white, as today. `NO` says *That's not
   this wristband*; no answer within `PAIR_CHECK_MS` says *No answer in time.
   Try again.* Either way the pending is dropped and that wristband gets fresh
   letters.

A decoy fails at step 2: the number appears on the attacker's band, not on the
wrist the person is looking at. The `/pair/` link's one-tap confirm is replaced
by this check. This also settles the open question of the in-app scanner
pairing any code it reads.

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
| `BAND_ALONE_MS` | 60 min | (relay) a wristband alone holds its person, or waits for its owner |

### KEY1, the face button

- **Press** (released before `HOLD_MS`): wakes the face for `WAKE_MS`. Under
  NOT NOW the face says `NOT NOW` and the battery — the same word KEY2 uses.
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
          The wrist drops its socket and connects again, and the relay takes
          frames only from a wristband's current socket, so a set stuck in the
          old one can no longer land. If it had already landed, the new
          connection's first show says so, and the face shows the truth.
          If the choice was leaving NOT NOW, the wrist also holds NOT NOW again
          (as a KEY1 hold does): hiding may arrive late, showing may not.
```

- **OFF** is visible with nothing armed — tapping an armed card on the phone.
  It does not touch the pick or the floor clip.
- **Offline, KEY2 changes nothing.** With no relay, or none heard for
  `STALE_MS`, LOOK shows `NO SIGNAL` and steps do nothing. A change is never
  queued. NOT NOW on KEY1 still queues.
- **A show that is not about the person** — pairing, the check number, the
  test light, waiting for its owner, no room — carries no `armed`. On such a
  show KEY2 only wakes, and one arriving mid-choice cancels the choice.
- **A show whose `rev` changed mid-choice** (the phone moved the state)
  cancels the choice; the face shows the new state.
- **The meeting number** outranks the card, as today. LOOK and the preview
  replace it while they last; SET is decided from `armed`, not the face.
- **SONG and DANCE** can be chosen with no pick or clip, as on the phone.

### Faces

The firmware draws two lines on one field (`wordsFor`, `lightFor`); these fit.

| Face | Big | Small | Field | Light |
|---|---|---|---|---|
| LOOK, a card | the card's words | `SIDE TO CHANGE` | the card's hue | full |
| LOOK, none | `READY` | `SIDE TO CHANGE` | black | `LIGHT_AWAKE` |
| LOOK, NOT NOW | `NOT NOW` | `SIDE TO CHANGE` | black | `LIGHT_AWAKE` |
| KEY1 press, NOT NOW | `NOT NOW` | the battery | black | `LIGHT_AWAKE` |
| preview, a card | the card's words, in its hue | `SIDE: NEXT` | black | `LIGHT_AWAKE` |
| preview, OFF | `OFF` | `SIDE: NEXT` | black | `LIGHT_AWAKE` |
| preview from NOT NOW | as above | `HOLD SIDE TO SHOW` | black | `LIGHT_AWAKE` |
| SENDING | as the preview | `SENDING` | black | `LIGHT_AWAKE` |
| SET / CHANGED / NOT SENT | the relay's show | the word, replacing the card's own small line | as the show | as the show |
| KEY1 held | unchanged | `KEEP HOLDING` + bar | unchanged | at least `LIGHT_AWAKE` |
| check | the number | `ON YOUR PHONE?` | black | `LIGHT_PAIR` |
| waiting for its owner | `OPEN YOUR PHONE` | `OR SWITCH ME OFF` | black | `LIGHT_AWAKE` |
| paired, person not in a room | `OPEN YOUR PHONE` | `TO COME BACK` | black | `LIGHT_AWAKE`, on a press |

A paired wristband whose person has left the room (the hour, 06:00, a grace)
stays paired. A KEY1 hold on it is kept on the record as `quiet` and applied
when the person comes back; KEY2 only wakes.

A preview is never a colour field, so nobody across the room reads a card the
wearer is only passing through. The card words the firmware draws for a
preview (`HI :)`, `FIRST SONG?`, `LET'S DANCE!`) are tested equal to
`bandShow`'s.

**Reading the relay.** `Show` gains `hasArmed` (a show can say `armed: null`,
which is not the same as saying nothing), `armed`, and an integer `rev`; the
JSON reader learns to read integers (today `number()` only validates) and
`null`. The round-trip test in `tests/firmware.test.js` covers them.

## §2. The relay decides

The relay is the one place a person's state lives. Per person it keeps
`armed`, `invisible`, and three new fields: `rev` (bumped on every change to
`armed` or `invisible`, from anywhere), `seq` (the largest phone seq received;
0 for a new person; a message without one counts as 0), and `by` (`'phone'`,
`'band'`, or `'relay'` for a person the relay has just created or re-created).
A view carries `me.rev`, `me.seq`, `me.by`, and `me.fresh` on the first view
after the relay created the person; a wristband show made from a view carries
`armed` and `rev`.

1. **The wristband may say `set`.** `{"t":"set","intent":"hi"|"song"|"dance"|null,"basis":<rev>}`.
   The whole frame is dropped, before anything is touched, unless `intent` is
   present and is null or one of `INTENTS`, and `basis` is an integer. The
   relay answers every refusal `{"t":"set","ok":false,"why":...}` and changes
   nothing: `unpaired` (not a paired wristband, §0), `no room` (its person is
   not in a room), `changed` (`basis` is not the person's current `rev` — a
   stale choice, or one racing a NOT NOW from the phone), `too fast` (more
   than one a second from this wristband). Otherwise: `setInvisible(false)`,
   `arm(intent)`, `by = 'band'`.
2. **A live wristband keeps its person in the room — for an hour.** One grace
   function serves every trigger: it clears any timer the person already has,
   never starts while the relay is closing, and is cleared by a phone or a
   wristband of that person connecting. It starts when a person's last phone
   socket closes and their wristband is not connected, or their wristband
   closes and no phone socket of theirs is open. Separately, a person held
   only by a wristband leaves when `BAND_ALONE_MS` has passed since any of
   their phones was last heard (any message, pings included), or at the
   relay's 06:00, whichever is first. The grace, `BAND_ALONE_MS` and the clock
   are options of the relay, so tests drive them.
3. **A re-said fact may hide a person, never show them, and only if it is
   news.** A phone re-says its facts, marked `again`, on every connection. An
   `again` copy is applied only when both hold:
   - *it is news*: its `seq` is above the person's `seq`, so the relay never
     saw it — a tap lost in a socket that died without closing. A fact the
     phone only learned from a view carries that view's `me.seq` (§3), so it
     is never news, and a phone waking from a pocket cannot re-say its old
     state over a change made on the wrist meanwhile;
   - *it hides*: `invisible: true` or `arm: null`. An `again` copy of
     `invisible: false` or of arming a card is never applied: a late arrival
     is exactly what may not show a person. The phone learns from the next
     view and says so (§3).

   Today's rule — a re-said fact never undoes NOT NOW — is a special case, and
   its test stays as it is. Profile, pick and pair have one writer and are
   applied as today.
4. **An old view cannot pull the phone back.** Each `arm` and `invisible` from
   a phone carries `seq`, `max(last + 1, Date.now())`. The relay's `seq`
   becomes the larger of the two whether or not it applied the message. The
   phone ignores `armed` and `invisible` in any view whose `me.seq` is below
   the last seq it sent. A `seq` that is present but not a finite number drops
   the frame.
5. **A change that shows a person names the state it was chosen from.** The
   wrist's `set`, and the phone's own arming of a card and `invisible: false`,
   carry `basis`, the `rev` of the view or show they were chosen from. If `rev`
   has moved since, they are refused `changed` and nothing changes: a tap that
   sat in a dead-but-open socket while the wrist went NOT NOW cannot land
   afterwards and show the person. Changes that hide — NOT NOW, a card off —
   carry no basis and are always taken. The wrist's `set` without an integer
   `basis` is dropped (rule 1). A phone message without `basis` is taken as
   today, so the existing tests and `scripts/crowd.mjs` keep working; the app
   always sends one, and a test holds it to that.

**Remembered past leaving.** For the night, the relay keeps each person's last
`invisible` after they leave the room, as it keeps blocks. A person re-created
by a join starts invisible if either that record or the join's `quiet` says
so.

**The night's end** is 06:00 in the relay's `nightTz` option, the venue's time
zone, defaulting to the relay machine's own.

**Order on a new connection.** A phone's join carries `quiet: true` when it
holds NOT NOW. It counts only when the join creates the person — after a
restart or an expired grace — who is then created invisible, with no moment
in anyone's lists; for a person already in the room it is ignored, so a
phone's old NOT NOW cannot undo a wrist that came back meanwhile. Its re-said facts go out
claim first — `pair`, then `invisible`, `profile`, `pick`, `arm` — so a
wristband's kept hold lands before anything else about the person.

**Leaving is carried until it is heard.** The phone's "I've left" keeps the
room connection open, and re-sends the leave across reconnects, until the
relay answers `{t:'left'}`; only then does the night become `left`. Meanwhile
the phone shows *Leaving…*, and with no signal *You'll be taken out as soon as
there's signal*. The relay's leave also unpairs the person's wristband. If the
page is closed before the answer, the grace or the band-alone hour still ends
it.

## §3. The phone follows the relay

**It never asserts state it has not just been asked for.** Today every page
load says `arm: null` unmarked and re-says a stored NOT NOW; both would undo a
card chosen on the wrist. Instead the phone stores `armed`, `invisible` and its
last `seq` with the night, draws them at once, and puts them in net.js's `said`
as kept facts — sent only as `again` copies, in the order of §2 — never in the
queue. The first view that passes rule 4 then sets the cards.

**Offline, it queues only NOT NOW.** Arming a card or coming back visible
while offline says *Not connected — try again*, as the wrist does; NOT NOW is
queued and re-said.

**Following.** `app/lib/follow.js` is pure: given the phone's `armed`,
`invisible`, last `seq`, the current `screen` and `stack`, and a view, it
returns what to adopt, what to keep in `said` (the view's values, with the
view's `me.seq`), the screen, whether to clear the stack, a toast, and the
events the phone's own `arm()` would have added. Following never calls `say()`.

| The relay's state moved to | The phone |
|---|---|
| a different card, or none | Adopts it, and clears the stack. If the open screen belongs to a card no longer armed (from `INTENT_OF`: beacon, near, pick, wall, camera, floor), home. If `me.by` is `'band'`: `Armed from your wristband: SAY HI` / `Your wristband turned your card off`. |
| invisible | The quiet screen, stack cleared, as today — the special case at `App.jsx` ~229 becomes this row. |
| visible, no card | Off the quiet screen to home; if `by` is `'band'`, `Visible again, from your wristband`. |
| visible with a card, in one view | Home; if `by` is `'band'`, `Back on, from your wristband: SAY HI`. |
| the first view of a re-created person (`me.fresh`), while this phone held a card | `You were away a while, so your card went off.` |
| not what this phone last asked for, and `by` is not `'band'` | The phone's own tap did not land (rule 3): `That didn't go through — tap again`. |
| a showing change of this phone refused `changed` (rule 5) | `Something changed — check and tap again.` |

- Every toast that says *from your wristband* carries `NOT YOU? UNPAIR`, which
  unpairs in one tap.
- A wrist change has the phone's side effects too: the first SAY HI adds the
  "started saying hi" event, and the battery prompt, now tied to the beacon
  screen, is tied instead to "paired, battery at or below 15%, not asked yet".
- The pairing check is a sheet (§0) with its own copy for NO and for a timeout.

**Copy.** Every site that says one button, one second, three seconds, "only
lights up while you're saying something", or that the wristband cannot bring
a person back, changes with the constants: S1 House rules, the pair screen,
the quiet screen (`Met.jsx` "Your wristband is dark too." gains how to come
back from the wrist), the stand-in's labels and `aria-label`, `main.cpp`'s
header, `band_logic.h`'s comments, `relay/server.js`'s comments ("its one
button", "Held for a second"), and README's wristband sections. The stand-in's
labels are built from its constants. A test greps `app/`, `relay/`,
`firmware/src/` and `README.md` for the old phrases.

## §4. The stand-in, tests and proof

- **One Wrist, twice.** `band_logic.h` gets one `Wrist` class that owns both
  buttons, the chooser, Quiet, staleness, the per-boot id and the pairing
  secret: it takes key states, link up/down, relay frames and the time, and
  returns frames to send and the face. `main.cpp` only feeds it and draws.
  `app/lib/wrist.js` is the same machine in JavaScript, and `/band` becomes a
  thin shell over it with a second button, SIDE.
- **One table of cases.** `tests/fixtures/wrist-cases.json` lists key downs
  and ups, link changes, relay frames and ticks, with times written as named
  constants (`"HOLD_MS+1"`), and what must be sent and shown. `tests/wrist.test.js`
  runs it against `wrist.js`; a new mode of the host binary reads the same
  events on stdin and `tests/firmware.test.js` runs the table against
  `band_logic.h`. It includes: two stray presses from NOT NOW send nothing;
  KEY1 down at +2 s of a choice sends only `hold`; releases at 1.0, 1.4 and
  1.5 s; a rev change mid-choice; a pairing show mid-choice; offline LOOK;
  NOT SENT drops the socket, and from a NOT NOW exit also sends `hold`; the
  check, waiting and not-in-a-room faces; the hello carries a key whose hash
  is the id.
- **The relay, one test per guard**, each mutation-checked so exactly its
  test goes red; every refusal has its own `why`, so each guard is visible:
  `set` validation (with malformed frames in the fuzz test, NOT NOW surviving
  them), `unpaired`, `no room`, `changed`, `too fast`; an unseen `again` NOT NOW is
  applied (sent only as `again`, within the grace); an `again` card is not;
  an `again` fact already seen is not (the pocket flow: wrist chooses SAY HI,
  the phone reconnects re-saying its old `arm: null` and NOT NOW, and SAY HI
  stays); seq acknowledged when a message is ignored; join with `quiet`
  creates a new person invisible and is ignored for one already in the room; the grace skipped while the band is live; a band closing
  with no phone starts the grace and the person leaves when it runs out; one
  timer per person (phone drops, band drops twice, `close()` leaves no timer);
  no grace while closing; the band-alone hour; 06:00 on the relay's clock;
  a hello whose key does not hash to its id is refused, for a paired, pending
  and unpaired record; a hello without the secret for a paired id is refused
  and the live socket survives; frames on a replaced wristband socket are
  dropped; claim needs the secret; a restarted relay keeps a paired band
  waiting, applies its `quiet` (from the hello or a hold while waiting) at the
  claim, and sends it letters after the hour; phone first after a restart
  (placeholder kept, the band's secret decides, a mismatch is told `gone`);
  a paired record away for the hour is forgotten and the next claim is told
  `gone`; the check — pending until YES, dropped on NO and on timeout with
  fresh letters, `busy` for a second pair, numbers unique, attempts counted;
  a v1 hello is not paired; rule 5 — a phone's card tap with an old `basis`,
  arriving after a wrist NOT NOW, is refused `changed`; a phone message with
  no `basis` is taken; a person who left NOT NOW'd and is re-created by a join
  without `quiet` is still invisible; 06:00 in `nightTz`; a leave sent into a
  dead socket still removes the person once it is re-sent, and unpairs the
  band; a hold on a paired band whose person left is applied when they return.
- **The phone**: `tests/follow.test.js` covers every row of the table, the
  combined row, the tap that did not land, a `changed` refusal, the first view
  after a restart (no wristband in it, and no *gone* message), `me.fresh`,
  and that following sends nothing; rule 4's
  mutation check lives there. `tests/net.test.js` covers the re-send order and
  that a page load queues nothing.
- **Tests that change on purpose**: `logic_test.cpp`'s button checks
  (`HOLD_MS`); the stand-in's timers; `band.test.js` (shows carry `armed` and
  `rev`); grace tests (now on the option); pairing tests, which now pass the
  check; `firmware.test.js`'s id-only hello that stays paired (now refused
  without the secret) and its list of every show kind (adds check and
  waiting); the tests and `scripts/crowd.mjs` that send `arm`/`invisible`
  without a seq keep working, since a missing seq counts as 0.
- **A C++ compiler on this laptop** (WinLibs g++, by winget), installed before
  `HOLD_MS` changes. The host binary's output is split on `/\r?\n/`. MinGW has
  no sanitizers, so here the build runs without them; CI keeps them.
- **CI builds both envs**, `m5stickc` and `m5sticks3`, and keeps both images.
- **In a browser**: the app and `/band` side by side — pair through the check
  (and say NO once, and let one time out), choose from the wrist, leave NOT NOW
  by holding, the toasts and their UNPAIR, reload the phone after a wrist
  change, a reconnect, a relay restart with the phone closed (the band waits;
  hold KEY1 while it waits, and the hold survives the phone's return).
- **On the real band and phone**: every flow once; then the phone locked in a
  pocket for more than two minutes, SAY HI chosen on the wrist, a second
  browser in the room seeing the person in SAY HI; then unlock the phone and
  check the card is still SAY HI.

## Risks

- **A card or "back on" tapped on the phone into a dead socket is lost**, by
  rule 3, and the phone says to tap again. That is the price of never showing
  a person late.
- **Someone watching the letters can hold a stranger's pending check open.**
  Each attempt counts toward the socket's limit and the letters change after
  every NO or timeout; a determined watcher with many sockets can still
  annoy, not pair.
- **The check number is only as good as the glance at the wrist.** It turns a
  silent decoy into a question the person has to answer wrongly.
- **Timings are guesses until worn.** They are constants for that reason.
