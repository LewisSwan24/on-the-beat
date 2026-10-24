# The wristband guide: practice after pairing, and a page to look things up

13 Oct 2026. Asked for the same day: a tutorial in the phone app, or instructions
for the wristband. Our picks: both a guided first run and a page to look things up;
the guided run has the person really press the band, with the phone checking; it
covers the two buttons, what the lights and sounds mean, how a meeting works, and
power and trouble; built on the phone (approach A), with no firmware change; and
the practice is not public: nobody sees a practising person on any list.

Revised the same evening after our review: the page was not detailed enough. It
now walks through the whole life of a band, step by step: turning it on and
setting its Wi-Fi from a phone, pairing, what every button does on every screen,
and what to do when something is wrong (§3). The Wi-Fi setup stays: it was
proven by hand on 13 Oct (hotspot off, SIDE hold, a second phone on the band's
own Wi-Fi, the hotspot's name typed, saved, hotspot on, joined), and a band now
keeps the last three networks set on it beside the one it was built with
(`7385216`), so a band handed between people no longer loses its owner's.

## What is there today

- *How this works* (`howSheet()` in `app/App.jsx`) is a sheet of one-line rows:
  the four promises, the cards, and four lines about the wristband.
- The wristband sheet (`bandSheet()`): PAIR AGAIN, TEST THE LIGHT, SOUND, UNPAIR.
- Pairing ends at `App.jsx` where the check's YES lands (`setScreen('home')`).
- `docs/wristband.md` (*On the wrist*) is the full account the guide draws on.

Nobody is shown the buttons in use. The four lines in *How this works* name
them, but a first-timer has never held a FACE button for 1.5 s and does not know
what a falling chirp means.

## 1. The practice (`guide` screen)

**When.** Once, after the first pairing a person ever confirms: the check's YES
goes to `guide` instead of `home` when `guideSeen` is not set. `guideSeen` is kept
on the phone for good (`store.js`, beside `bandSound`), and set when the guide
ends in any way. PRACTISE AGAIN on the reference page (§3) opens it again.

**Each step** is one card: the band drawn (an inline SVG of a StickC Plus held
landscape, the FACE button and the SIDE button labelled, the one to use lit in
the card's colour), one line saying what to do, and what the band will do back.
The phone checks the step from the relay's view and ticks it. Every step has
*skip this one*, and the screen has *later* (ends the guide, `guideSeen` set).

| # | Step | The person does | Done when |
|---|---|---|---|
| 1 | Wake it | press FACE: it lights for 6 s | they answer IT LIT UP (the relay never hears a wake). NOT YET says to check it is on and offers TEST THE LIGHT |
| 2 | Change your card | press SIDE (it shows your card), press again (the next), stop: 3 s later it is sent and says SET | a view where `me.armed` changed and `me.by === 'band'` |
| 3 | Go invisible | hold FACE 1.5 s: dark, the down sound | `me.invisible` turned true with `me.by === 'band'` |
| 4 | Come back | hold SIDE | `me.invisible` turned false with `me.by === 'band'`; with N3 it is back on the card it had |
| 5 | Meeting someone | nothing to press: the two faces drawn with the same MEET number, "any key answers the blinking; hold SIDE once you've found each other — it counts when you both have" | they tap GOT IT |

Then *That's it* and DONE, which goes home.

**Checking is one pure function**, `stepDone(step, before, view)` in a new
`app/lib/guide.js`: `before` is the person's `{ armed, invisible, rev }` when the
step began. A change made from the phone never ticks a step; only `by === 'band'`
does.

**The band out of reach.** When the band is not live (`view.me.wristband` absent,
off or away), steps 2-4 show their card and say *we'll check this once your
wristband is back*; GOT IT moves on without the check. The guide never waits on
something that cannot arrive.

**The phone stays on the guide.** `follow()` (`app/lib/follow.js`) sends a phone
home when the wrist lights a card and to the quiet screen when the wrist goes
dark. On `guide` it does neither: it keeps the screen, still follows the state and
still keeps its events, and its toasts are not shown there (the step's own tick
says it). `tests/follow.test.js` holds this.

**Ending puts things back.** The guide keeps the card and NOT NOW the person had
when it opened. On DONE, *later*, back, or leaving the screen any other way, the
phone first sets them back (an arm and an invisible, as from the phone), then
ends the practice (§2). So nobody is left visible on a card they only practised
with, and nothing about the practice is public at any moment.

## 2. Practice is private (relay)

A person may be practising. While they are:

- nobody else is shown them: `shows(a, b)` in `relay/room.js` is false when `b`
  is practising, exactly as when `b` is invisible. That one function already
  keeps an invisible person off every list (SAY HI, the wall, the floor) and
  stops anyone taking a yes from them (`take`), so practice inherits all of it;
- they are shown nobody (`seen()` returns none for them), as when invisible;
- their own view, their own band and every rule about their own card and NOT NOW
  are unchanged. The band lights, says SET, goes dark and comes back exactly as
  it will for real. That is the point of practising.

**Messages.** `{ t: 'practice', on: true|false }` from the person's phone. On
`true` the relay notes `practiceUntil = now + 5 min`; `false` clears it. Past
`practiceUntil` the person is no longer practising, so a phone that closed
mid-guide does not leave someone hidden all night. The phone says `true` when
the guide opens, again at each step and on every join while on `guide` (`net.js`
already re-says what the phone is on a join), and `false` when it ends, after
the card has been put back.

**Not kept.** Practice is not written to the night file and does not survive a
restart: a guide open across a restart says it again on the join.

**Not shown.** No view carries anyone's practice. The practising person's own
view has `me.practice` (so the phone can tell the relay took it); nobody else's
view changes except that the person is missing from it.

**Tests** (`tests/room.test.js`, and the server test for the message): a
practising person armed on SAY HI is on nobody's list and cannot be waved at,
liked or danced back to; they come back on lists when practice ends or
`practiceUntil` passes; their own view and band show their card throughout;
practice is not in the night dump; a malformed `practice` message is refused like
any other bad message. Each guard is mutation-checked: break it and exactly its
test goes red.

## 3. The reference page (`band-guide` screen)

Reached from the wristband sheet (a new first row, HOW TO USE IT), from *How this
works* (a row, *Your wristband, step by step*), and from the pair screen (a small
*new to the wristband?* link, since a person standing there may not yet know how
to get letters onto it). Open to anyone, paired or not, and it needs no relay: all
of it ships in the app, so it reads the same with the band on NO WI-FI.

One scrolling page in six parts, a row of chips at the top to jump to each
(START · PAIR · BUTTONS · LIGHTS & SOUNDS · MEETING · TROUBLE), and PRACTISE AGAIN
at the foot when paired. The band is drawn as in §1 wherever a step names a
button: FACE (the big button under the screen), SIDE (the long one on its edge)
and POWER (the small one on the opposite edge). The drawing is checked against a
real StickC Plus held landscape before it ships. Every word the
band itself shows is set in the band's own capitals and font, in a small dark
pill, so a person can match the page to the wrist.

### 3.1 Start: turning it on and giving it Wi-Fi

1. **Turn it on.** Press POWER once. It lights and looks for Wi-Fi. Charge it on any USB-C cable; it runs on the cable too.
2. **What it needs.** A Wi-Fi it can reach on its own: **2.4 GHz**, with a
   password or open, and **no sign-in page**. A phone's hotspot works (set it to
   2.4 GHz if the phone asks: *Wi-Fi hotspot → AP band*). A school's, hotel's or
   café's sign-in Wi-Fi does not.
3. **If it says `NO WI-FI` / `HOLD SIDE: SET UP`**, it knows no network that is
   near. Hold SIDE until it changes. It starts again as a Wi-Fi of its own and
   shows a code beside its name, `OTB-` and four letters, and its password in two
   halves of five.
4. **Join it from a phone.** Scan the code with the camera, or open Wi-Fi
   settings, pick `OTB-…` and type the password from its face. The band's page
   opens by itself; if it does not, open a browser at `192.168.4.1`.
   - **Use a different phone from the one that will be the hotspot, or turn the
     hotspot off first.** Most phones cannot be a hotspot and join another
     Wi-Fi at the same time.
5. **Pick the network**, or type its name if it is not in the list (a hotspot
   that is off is not there), type its password, and press SAVE AND RESTART.
   The band says `SAVED` / `JOINING …` and starts again. Your phone goes back to
   its own Wi-Fi by itself.
6. **Turn the hotspot back on** if you turned it off. Within about fifteen
   seconds the band is on it and shows four letters: it is ready to pair (§3.2).
7. **It remembers.** A band keeps the last three networks set on it, and the one
   it was built with. Wherever it is, it joins the newest one it can hear, so a
   band lent to a friend and set up on their hotspot still finds yours when it
   comes back. Setting up a fourth forgets the oldest.
8. **Leaving without changing anything:** press either button on the setup
   screen. Nobody using the page for ten minutes leaves it too.

### 3.2 Pair: making it yours

1. A band nobody has claimed shows **four letters** under a code. Letters only,
   never I, L or O.
2. On the phone: type the letters on the pair screen, or SCAN IT INSTEAD, or
   point the phone's camera at the band's code (that opens the app with the
   letters already in).
3. **The check.** The band shows a two-digit number over `ON YOUR PHONE?`, and
   the phone asks *Does your wristband show 27?* Look at **your** wrist, and press
   YES only if it shows that number. It flashes white once: paired.
4. NO, or no answer within a minute, and the band shows new letters.
5. **A number you did not ask for** means someone typed your letters. Hold FACE
   for 1.5 s on it: the check is turned away and the band shows new letters.
6. Paired for the first time ever, the phone opens the practice (§1).

### 3.3 Buttons: what each one does, screen by screen

A table, one row per screen the band can show, in its own words, and four columns:
FACE press, FACE hold (1.5 s), SIDE press, SIDE hold. An empty cell says *nothing*.

| the band shows | FACE press | FACE hold | SIDE press | SIDE hold |
|---|---|---|---|---|
| `NO WI-FI` / `HOLD SIDE: SET UP` | wakes it | nothing | nothing | Wi-Fi setup (§3.1) |
| the setup code, `OTB-…` | leaves setup, unchanged | same | same | same |
| `SAVED` / `JOINING …` | nothing: it starts again by itself | | | |
| four letters | `PAIR ON YOUR PHONE` | nothing | `PAIR ON YOUR PHONE` | nothing |
| a number, `ON YOUR PHONE?` | `PAIR ON YOUR PHONE` | turns the check away | `PAIR ON YOUR PHONE` | nothing |
| `READY` (no card) or your card (`HI :)`, `FIRST SONG?`, `LET'S DANCE!`) | wakes it for 6 s | NOT NOW: dark at once | shows your card; each press after steps HI → SONG → DANCE → OFF, and 3 s after the last it is sent | as a press; while stepping, sends the card on its face at once |
| after a choice: `SET`, `CHANGED`, `NOT SENT` | wakes it | NOT NOW | starts a new choice | |
| NOT NOW (dark) | shows `NOT NOW` and its battery | | first `NOT NOW` / `SIDE TO CHANGE`, then the card it comes back on, `HOLD SIDE TO SHOW`; more presses step | **comes back**, on the card you had before |
| a meeting number, `MEET` (blinking) | any key stops the blinking, and does nothing else | | | |
| a meeting number, woken: `HOLD SIDE: FOUND` | | NOT NOW | opens the chooser | **we found each other** |
| `FOUND: WAITING` | | NOT NOW | | |
| `SOMEONE WAVED` / `HOLD SIDE: WAVE BACK` (or `3 WAITING - HOLD SIDE`) | | NOT NOW | | **waves back** to the newest |
| `NO SIGNAL` or `NO RELAY` | wakes it | | | nothing: it is not the Wi-Fi, wait |
| `OPEN YOUR PHONE` / `OR SWITCH ME OFF` | | | | |
| `OPEN YOUR PHONE` / `TO COME BACK` | | | | |
| `POWER OFF` / `POWER BUTTON: ON` | it is turning off | | | |

And two that are not on one screen: **both FACE and SIDE held for 3 s turns it
off** on any screen; **POWER** turns it on. The words in the rows are the copy's,
written plainer than this table; the table is the shape.

### 3.4 Lights and sounds

One row per meaning, each with a colour swatch where it has one and a ▶ button
that plays the band's own sound on the phone (`app/lib/speaker.js`, the bytes
`/band` plays). The rows are a table, `GUIDE_SOUNDS` in `app/lib/guide.js`, one
per key of `SOUNDS` in `app/lib/wrist.js`:

| sound | what it means |
|---|---|
| tick | any key going down |
| double | a hold that sends: coming back, waving back, found |
| up | SET, a YES, TEST THE LIGHT |
| fall | CHANGED, or a check that ended without YES |
| low | NOT SENT |
| down | NOT NOW |
| ask | the pairing check: the number to look for |
| jingle | a meeting: the number blinks until a key answers |
| hello | someone waved at you |
| found | you both found each other |
| calledit | you called the first song |
| warn | orange: out of reach, battery at 15% and 5%, waiting after a restart, away, unpaired |

And one row per card in `CARDS` (`relay/cards.js`), its hue as the swatch:
*your colour while that card is armed*. Then: half bright means the battery is at
15% or less; white once means paired, or TEST THE LIGHT; red three times,
CHANGED; orange twice, NOT SENT.

### 3.5 Meeting someone

The same words as practice step 5: both bands show the same number and blink;
any key answers the blinking; find each other at the spot the phone shows; hold
SIDE once you have. It counts when you both have: until then yours reads
`FOUND: WAITING`. A meeting number lasts fifteen minutes.

### 3.6 Trouble: what you see, why, and what to do

A list of questions, each opening to its answer:

| you see | why | what to do |
|---|---|---|
| `NO WI-FI` | it can hear none of the networks it knows | turn your hotspot on and wait fifteen seconds; if it is a new place or a new phone, hold SIDE and set it up (§3.1) |
| `NO WI-FI` right after you saved | the name or password was not right, or the network is 5 GHz | hold SIDE and set it up again; type the name exactly; set the hotspot to 2.4 GHz |
| your hotspot is not in the setup list | it is off, or 5 GHz | type its name instead; set it to 2.4 GHz |
| the setup page does not open | the phone left the band's Wi-Fi, or no page popped up | join `OTB-…` again and open `192.168.4.1` |
| the hotspot turned itself off while you set it up | the phone cannot be a hotspot and join another Wi-Fi at once | set it up from another phone, then turn the hotspot on |
| `NO SIGNAL` or `NO RELAY`, orange | it is on Wi-Fi but cannot reach ON THE BEAT | nothing: it catches up by itself; check the hotspot has data |
| `OPEN YOUR PHONE` / `OR SWITCH ME OFF` | the service restarted and waits for its owner's phone | open the app; or turn the band off |
| `OPEN YOUR PHONE` / `TO COME BACK` | its person is not in a room, or was away a while | open the app; PAIR AGAIN on the wristband sheet if it asks |
| four letters on a band that was yours | it was unpaired, or set up again | pair again (§3.2) |
| it does not light | asleep, flat, or off | press FACE; charge it; press POWER; TEST THE LIGHT on the wristband sheet finds it |
| half bright | battery at 15% or less | charge it |
| a number you did not ask for | someone typed your letters | hold FACE 1.5 s on it |

**Held complete by a test** (`tests/guide.test.js`), as `tests/cards.test.js`
holds the cards: every key of `SOUNDS` has a `GUIDE_SOUNDS` row and no row names
a sound that is not there; every card in `CARDS` has its colour row; every face
the band can draw has its row in the button table (`GUIDE_SCREENS`), checked
against the face words in `app/lib/wrist.js` and the setup faces in
`firmware/src/main.cpp`, read from the source as `tests/band.test.js` already
reads `main.cpp`; every icon the page draws is in the subset font
(`tests/fonts.test.js` already fails on one that is not). A sound, card or screen
added later is either explained or red.

Words follow the app's voice: lower case for prose, upper case for what is on
the band or on a button. Every word of copy lives in `app/copy.js` (`GUIDE`).

**The same content in `docs/`.** The page's steps also go into the repository as
`docs/wristband-guide.md`, for anyone setting up bands without the app open (a
venue's staff with a box of them), and the README links it. It is written from
the same table, so a test holds the two to the same screens.

## 4. Out of scope

- The clink and the raised wave: they are on the `wrist-motion` branch, not on
  `main`. When that branch merges, its rows join the button table (§3.3) and `GUIDE_SOUNDS`.
- The band's own face during practice: it shows what it always shows. Prompts
  on the band itself (approach B) would need the firmware and a reflash.
- A practice meeting with a real MEET number: step 5 is drawn, not live.
- The StickS3: dropped on 6 Oct; the drawing is the Plus.
- People without a wristband: they get the reference page, not the practice.

## 5. Depends on

N3 (13 Oct, our pick): coming back from NOT NOW puts back the card a person had,
from the phone and from the wrist. Step 4 says so; without it, step 4 would come
back on SAY HI. N3 lands first.

## 6. Proving it

- Unit: `stepDone()` row by row (a wrist change ticks, a phone change never
  does, a change in the wrong direction does not); `follow()` on `guide`; the
  completeness tests above; the relay tests in §2.
- The whole suite green, the build included.
- In a browser: the headless rig from the 13 Oct end-to-end run, with a stand-in
  band. A person pairs for the first time and lands on the guide; steps 2-4 tick
  only from the band's buttons; a second phone in the room never sees the
  practising person on SAY HI while their band is blue; DONE puts the card back
  and ends practice; the reference page plays every sound. Screenshots kept, as
  in that run.
- The reference page at phone width (375 px): every part reached from its chip,
  the button table readable without a page-wide sideways scroll (it scrolls in
  its own box if it must), each trouble row opening.
- On a real band, with us: §3.1 followed word for word by someone who has not
  set a band up before, from power on to four letters, and every row of the
  button table pressed once on the band it describes. Where the band and the
  page disagree, the page is wrong.
