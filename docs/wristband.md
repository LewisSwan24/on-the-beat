# The wristband

## On the wrist

Revision 6 of the canvas puts a wristband beside the phone: an M5StickC Plus
or a StickS3 on a strap that lights in the colour of the card you armed, so the
phone can go back in a pocket. Its firmware is in `firmware/` (below), and
**`/band` is a stand-in** that speaks exactly the same messages — open it in a
second browser, or on a second phone strapped to a wrist, when there is no
wristband to hand.
It has two buttons, so from the wrist alone, with the phone in a pocket, a
person can change which card is armed, come back from NOT NOW, and see whether
that was taken.

- **Pairing.** A wristband nobody has claimed shows four letters from
  `ABCDEFGHJKMNPQRSTUVWXYZ` — no I, L or O — under a QR code of an address:
  its own origin and `/pair/` and those letters. There are three ways in, and
  all three end in the same four letters:
  - type them, once, after the name, or later from the watch chip on the home
    screen;
  - `SCAN IT INSTEAD` on that screen: the app's own scanner reads the code;
  - someone who has not opened the app yet points the phone's own camera at
    the wristband. The address opens the app on the pair screen with the
    letters already in — after onboarding, for someone new.

  **All three end with a check.** The relay does not pair on the letters: the
  wristband that was reached shows a two-digit number with `ON YOUR PHONE?`
  over it, and the phone asks *Does your wristband show 27?* in a sheet that
  stays over any screen and comes back after a reconnect. `YES` pairs, and the
  wristband flashes white once. `NO`, or no answer within a minute, drops it and
  the wristband shows new letters. A check its person did not ask for —
  someone read the letters off the wrist and typed them first — is turned
  away on the wrist: holding the face button for 1.5 s on the number drops it
  at once, the wristband shows new letters, and the phone that typed is told
  the wristband said no. A second phone trying the same wristband meanwhile is
  told someone else is pairing it, and, if it is theirs, to hold its face
  button. A decoy code stuck on someone's
  wristband fails here: the number lights the decoy, not the wrist the person
  is looking at.

  On `YES` the relay makes a secret and gives it to that phone and that
  wristband, and after every reconnect each proves itself with it.
- **Reading and drawing the code.** The scanner uses the browser's own
  `BarcodeDetector` where it has one (Chrome on Android) and jsQR everywhere
  else, loaded only when the scanner opens. jsQR 1.4.0 (Apache-2.0) is kept in
  `vendor/` as a tarball, so installing needs no network. `app/lib/qr.js`
  draws the code; its algorithm is the SAY HELLO prototype's encoder, and
  `tests/qr.test.js` reads every length from 1 to 213 bytes back through
  jsQR.
- **What it shows** is decided by the relay, in `relay/band.js`, from the same
  `viewFor()` its person's phone is sent, so it can never show more than the
  phone could: its person's colour and card words while a card is armed, the
  two-digit meeting number for fifteen minutes after a match or until both say
  they found each other (the same number on both wrists), and nothing at all
  under NOT NOW. While its person shows
  SAY HI it is also told that someone waved and how many wait: the newest
  one's handle, a count and a number, the same size however many wait. Never a
  name, never anyone else's pick, never a contact. At 15% battery it dims
  itself.
- **Its two buttons.** The face button (KEY1): a press wakes it for six
  seconds; held for 1.5 s it is NOT NOW — dark at once — and the phone
  follows to the invisible screen, except on a check number, where the same
  hold turns the check away. The side button (KEY2): a press shows
  the card that is armed; each press after moves a preview — HI, SONG,
  DANCE, OFF — and 3 s after the last one the choice goes to the relay,
  which decides; the face says `SET`, `CHANGED` or `NOT SENT`.
  Coming back from NOT NOW takes holding the side button. The pair screen
  says to *press* its face button, not to hold it.
- **It answers in sound and light**, and is quiet unless its wearer did
  something on it or something came for them. Every key ticks as it goes
  down. A choice from the wrist ends in `SET` (a rising chirp, and the card's
  colour twice; white for OFF), `CHANGED` (a falling one, and red three times)
  or `NOT SENT` (a low one, and orange twice). The pairing check asks with two
  notes and two white flashes; `YES` and TEST THE LIGHT chirp up, and a check
  that ends without `YES` falls. A meeting number plays a jingle and blinks
  the face once a second until a key answers it, and that key does nothing
  else. Five facts about the band warn, in orange, once each time they begin:
  out of reach for ten seconds, the battery at 15% and again at 5%, waiting
  ten seconds for its owner after a relay restart, away, and unpaired. NOT NOW
  is silent, but for the hold that starts it and a `SET` from the wrist that
  ends it; a warning that came up meanwhile plays once, after. A change made
  on the phone to one's own card or NOT NOW is silent on the wrist. Each sound
  and flash is one line in a table both twins keep, `SOUNDS` and `FLASHES`,
  held equal by `tests/firmware.test.js`; the notes are starting points, to be
  tuned by ear on a band. `/band` plays the same notes through Web Audio once
  its page has been tapped, which is when a browser first lets a page sound.
- **A wave reaches the wrist, and is answered there.** A wave at someone on
  SAY HI calls their wristband: a short `hello` and the HI blue three times,
  whatever the keys do. During it a key only ticks, and only a face hold still
  goes NOT NOW, so how long it lasts says nothing about whether it was seen;
  waves that arrive meanwhile join it. A face press on the resting HI or
  meeting face then opens `SOMEONE WAVED` over `HOLD SIDE: WAVE BACK`, or
  `3 WAITING - HOLD SIDE` when more wait (`9+` past nine). A side hold there
  waves back to the newest, and the relay answers it as it answers a choice:
  one that lands makes the match, and both wristbands show the same `MEET`
  number and call it; one that does not shows `NOT SENT`, or `CHANGED` if its
  own person's card moved meanwhile. Anyone else waiting is answered on the
  phone. Waves are numbered by the relay's clock, so a band never calls twice
  for one wave, even past a relay restart, and never misses the next. The
  phone buzzes for a wave only when no live wristband calls instead, and then
  also says so in a toast (*Someone near you waved.*, with `SEE WHO'S NEAR`)
  and puts a blue dot on SAY HI and on the bar's button until WHO'S NEAR has shown it:
  a buzz alone is easy to miss in a loud room, and the sender's row says
  *they'll be told*.
- **Found each other, from the wrist or the phone.** Woken, the meeting face
  says `HOLD SIDE: FOUND`, and a side hold there says the two of you found
  each other (a side press still opens the chooser; the key that answers the
  call does nothing else). So does `WE FOUND EACH OTHER` on the person's
  screen (S11), which now also shows the number while the meeting is on. It
  counts only once both have said it, as keeping does. Said on one side, the
  number stays and reads `FOUND: WAITING` on that wrist only, and the phone
  says *found on your side. they won't know unless they say so too.* The
  other person sees nothing. Once both have, both numbers go at once, both
  bands play a `found` chirp and flash the meeting's card three times, both
  phones say *you found each other at 21:14*, and Tonight counts it as met,
  at that time. A band out of reach then plays it when it is back within a
  minute; the phone buzzes only when no live wristband plays it. Refused or
  out of reach, the band says `NOT SENT`. Never said by both, the number goes
  at fifteen minutes, and nothing says why.
- **The first song, called, on the wrist.** When the venue's staff name the
  opener, the band of everyone whose pick it was plays a `calledit` chirp and
  flashes FIRST SONG's yellow three times, once a naming, whatever its face
  shows but NOT NOW; a band out of reach then plays it when it is back within
  a minute. A band whose person missed is told nothing, so no band ever says
  what anyone else picked, nor that they missed. The relay matches a pick as
  the phone does, whatever its case, accents or punctuation. This has run in
  the band's logic, JS and C++ alike, and in both firmware builds, not yet on
  a real band.
- **Who is near comes from the wristbands.** While a band is on the relay,
  paired and not in NOT NOW, it beacons four bytes by ESP-NOW twice a second,
  under an address it makes up at every boot, and for one second in every ten
  it listens for the others and tells the relay whom it heard and how
  strongly. The relay scores how near each band is to each other band in the
  room by the median of what its own band heard in the last 30 s, and every
  five seconds works out each band's five heard most strongly; one of the five stays while it is
  among the ten strongest, so the list does not churn as people turn round.
  With a band, SAY HI then lists those five, everyone without a band as
  before, and anyone waved with either way or matched. Nobody else is taken
  off without evidence — both bands heard from in the last 30 s, on the same
  Wi-Fi channel — so a band just switched on or gone quiet, a band on another
  channel, and the stand-in at `/band`, which has no radio, hide nobody and
  are hidden from nobody. No strength, score or order reaches a phone or a
  band: the list is only shorter, the rows are in the same order, and a row's
  area comes only from the markers (below). On a modelled floor of 750
  people, 150 of them banded, with bodies in the way, 99.8% of each five are
  truly within 10 m, against 33% for five picked at random from what the band
  heard, and about 4% of a five changes at each listen (`tests/near-crowd.test.js`).
- **Markers say near the bar and by the stage.** Any wristband can be a
  marker: `marker bar`, `marker stage` or `marker back` on its console, kept
  across restarts. A marker joins no Wi-Fi, reaches no relay and has no key:
  plugged into a charger behind the bar, it beacons five bytes, `OTBM` and
  its area's letter, twice a second on every Wi-Fi channel from 1 to 13 in
  turn, so a band hears it whatever channel the venue's Wi-Fi is on. Its face
  is dark; a press shows `MARKER` over `NEAR THE BAR`, `BY THE STAGE` or `OUT
  THE BACK`. A band's listen keeps the markers it heard beside the bands, the
  strongest reading of each, and its report says them. For each person the
  relay takes the median of each marker's readings in the last 30 s; the
  loudest names the person's area on every row that shows them if it is -56
  dBm or louder, and an area holds while its marker is -60 or louder and no
  other is 4 dB louder. Anyone else is `in this room`: no band, a band gone
  quiet, or no marker heard clearly. No phone names an area. On the modelled
  floor with a marker at each end, the wrong marker was named for at most
  0.21% of the people named, nine in ten of them were within 10 m of their
  marker, and an area changed at no more than 3.6% of listens
  (`tests/markers-crowd.test.js`); the price is that most people stay `in
  this room`, 12 to 35% named, since unnamed is better than named wrong.
- **The sound can be switched off, on the phone.** The wristband sheet has
  `SOUND: ON` under TEST THE LIGHT; off, the band only lights up. The switch is
  the person's own: the phone keeps it across nights and re-says it after
  every reconnect, and the relay carries it on the shows to that person's
  band and to no other. A band nobody has claimed chirps as it is, and a
  claimed band has the switch in its first show.
- **Letters go dark after two minutes.** An unclaimed band's letters and QR,
  and the face of one waiting for its owner after a restart, light for two
  minutes and then only the backlight goes off; a press lights them again.
  A press on the letters or on the check puts `PAIR ON YOUR PHONE` on the
  face for 3 s, and does nothing else there; the one thing more is holding
  the face button on the check, which turns it away.
- **Who a wristband is.** It makes a random key at every boot and keeps it
  only in RAM; its id is the first half of the key's SHA-256, and every hello
  proves the id with the key. Knowing an id — every phone that ever paired it
  was told it — is not enough to speak as it, and switching it off and on makes
  a new wristband with new letters.
- **The relay decides, and a late message can only hide.** Every change to the
  armed card or to NOT NOW, from a phone or a wrist, moves a revision. A choice
  on the wrist, and a tap on the phone that would show the person, name the
  revision they were chosen from and are refused if it has moved. A phone
  re-says its facts after every reconnect, marked `again`, and the relay
  applies one only if it never saw it and it hides the person. So a phone
  waking in a pocket cannot undo a card chosen on the wrist, and a tap stuck in
  a dead socket cannot show someone who has since gone NOT NOW. The phone
  follows every view (`app/lib/follow.js`) and says when the wrist changed
  something — *Armed from your wristband: SAY HI*, with `NOT YOU? UNPAIR` — or
  when its own tap did not land. Offline it queues only what hides: NOT NOW,
  and a card turned off.
- **A wristband keeps its person in the room** for up to an hour after a phone
  of theirs was last heard, or until 06:00 at the venue, whichever is first,
  so the phone can stay locked. With no phone and no live wristband, the
  two-minute grace applies as before. Once they are out, the wrist says
  `OPEN YOUR PHONE` / `TO COME BACK` on a press, and a hold is kept until they
  are back. At 06:00 a wristband still worn, whose person's phone is not
  connected and was last heard before it, goes back to four letters, so it
  does not carry last night's person into the next night; the room it was
  keeping open can then go.
- **06:00 ends the night for everyone still in a room from it**, phone open
  or not. A page frozen in a pocket still answers the socket's pings, so an
  open phone used to keep last night's person in the room, with their
  matches and their wristband, for as long as it stayed open. Now the relay
  tells each such phone the night is over, forgets everything the room kept
  of that person (matches, yeses, blocks, waves), and their wristband goes
  back to four letters. The app goes back to choosing a venue and says so;
  its own record of the night stays on Tonight. Someone who joined after
  06:00 is not touched. Those who left before 06:00 are forgotten with them,
  so a room kept open past six, in memory and in the night's file, holds
  nothing of last night. A wristband out of reach at 06:00 is let go as well:
  back on, it waits for its owner's phone and then shows letters, as one the
  relay has no record of does; and one away when its room went, worn again
  before six, goes back to letters at six.
- **After a relay restart** the wristband comes back with its secret and goes
  straight back to its person: the relay carried its record across (*Always
  on*). A relay that comes back without its night — no file, or one another
  build cannot read — does not know the secret, and the wristband waits for
  its owner — `OPEN YOUR PHONE` / `OR SWITCH ME OFF`, no letters — until the
  phone's claim with the same secret pairs it again; a hold meanwhile is
  applied then. Whichever is back first, the secret decides. Nobody by the hour
  or by 06:00, and it shows new letters. A paired wristband away for an hour is
  forgotten, and only then, told so by the relay, does the phone say *Your
  wristband restarted or went away. Pair it again.* Before that, away for two
  minutes, its chip says `OFFLINE` and offers `PAIR AGAIN`.
- **"I've left" is carried until it is heard.** The phone says *Leaving…* and
  re-sends it across reconnects until the relay answers; the relay's leave
  unpairs the wristband.

## The wristband's firmware

`firmware/` is a PlatformIO project for the M5StickC Plus and Plus2 (M5Unified
tells them apart as it starts; the first M5StickC works too, drawn smaller),
and for the M5StickS3, an ESP32-S3 that no ESP32 image boots on, so it is an
env of its own: `pio run -e m5sticks3`. The code is the same for all of them. It
speaks exactly what `/band` speaks, on the same clock: it says it is a wristband
with an id that is the hash of a key it makes at every boot, shows whatever the
relay tells it to, asks the relay every two seconds and takes six of silence as
a dead socket. Its two buttons work as above.

```
cd firmware
pio run -t upload       # build it and flash it over USB
pio device monitor      # its console: ssid, pass, channel, relay, show, forget, setup, press, hold, face, snap, turn, near, marker

pio run -e m5sticks3 -t upload    # the same, for a StickS3
```

Tell it the venue's Wi-Fi from a phone ("Its Wi-Fi, from a phone", below), or the Wi-Fi and the relay at the console — `relay` takes
`https://on-the-beat.fly.dev`, or the address `npm run tunnel` prints — or
copy `src/secrets.example.h` to `src/secrets.h`, which git ignores, to build
them in. What is typed is kept across restarts, which matters: a quick
tunnel's address changes every run. A `https` relay's certificate is checked
against the roots in `src/relay_roots.h`, which cover both of those; a relay
of one's own needs its root built in as `OTB_RELAY_CA` in `secrets.h`.
Off the Wi-Fi, it asks the radio to join again every 15 s. The console says
what the band is doing: the Wi-Fi coming and going and the reason the radio
gave, each hello and whether it carries its secret (never the secret), each
choice sent from the wrist, each refusal, and each change in what the relay
shows.
The console can also press the buttons, so a real band is tested without a
hand on it: `press face` or `press side` is a press, let go after 120 ms;
`hold face` or `hold side` is let go 200 ms after the hold counts, and `hold
both` holds the two together for as long as turning the band off takes. Each is
down through the same edges as the button itself, so the band cannot tell
them apart; `off` turns the band off at once, as the hold would. `face` says what the screen shows: its words, field and light,
the pairing letters included. `sound found`, or any of the band's sounds by
name, plays it, to hear the speaker without a room around the band. `near`
says whether it is beaconing and listening, the address it is on the air
under, and what its last listen heard; `near off` stops both, to test a band
gone quiet, `near listen` stops only the beacon, so two bands both told it
hear nobody and say so, and `near on` starts both again; the markers the last
listen heard are listed under the bands. `marker bar`, `marker stage` or
`marker back` makes the band a marker and restarts it as one. A marker's
console takes only `show` (its area, its address on the air this boot, the
beacons sent, lost and refused, and how long the last sweep of the thirteen
channels took), `press` to light its face, `face` to read back what its
screen shows (the words, the backlight, and how many pixels are lit),
`snap` and `turn` as a wristband takes them,
`power <dBm>` to cap its radio from 2 to 20 dBm for a test (not kept
across a restart), another `marker`, and `marker off`, which restarts it
as a wristband. The cap is no smooth stand-in for distance: with the Plus
as the marker, the StickS3 read it 17 dB weaker at the lowest cap than at
the highest, but the caps between moved it in steps, and not always the
same way (at 6.75 dBm it read weaker than at 5.25). On the Plus, `show` also says
what the band draws from USB, the mean since the last `show`. Only the
USB cable reaches the console, and
whoever holds the cable holds the band and its buttons anyway; no frame from
the relay reaches it.

**Off and on.** A band left on in a bag drains all week: the Wi-Fi, the
beacon and the socket never rest. Holding the face and side buttons together
for 3 s (`OFF_HOLD_MS`) turns it off, a hold no bump in a crowd
makes: the face says `POWER OFF` over a bar while it is held, the band tells
the relay, lets its socket go, says `POWER OFF` / `POWER BUTTON: ON` and plays
`down`, and 2.5 s later the power chip cuts the power (`M5.Power.powerOff()`:
the AXP192 on a StickC Plus, the M5PM1 on a StickS3), so nothing runs and
nothing drains but the chip. On a StickC Plus a hold of the power button does
the same. The power button turns it on again, and it boots, joins and says
hello as after any restart. Neither key does anything of its own once both
are down, so the hold never sets off NOT NOW on the way. The phone shows the
band as `OFF` straight away, never as `OFFLINE`, and its sheet says the power
button turns it on; How this works says how to turn it off. Not while it is
plugged in: on a USB cable the power chip turns the band straight back on (a
StickC Plus told to power off on its cable was back on the relay, on a new
address, within twenty seconds, 5 Oct 2026), so a band reading more than
4 V on USB says `UNPLUG` / `TO TURN IT OFF` and stays on. Plugged in, it
charges and drains nothing.
It also turns itself off: a band nobody has paired (nor is pairing),
off its cable, with no key pressed and no console line for 30 minutes
(`IDLE_OFF_MS`), so one forgotten in a bag after the show drains half an hour,
not the night. A marker never does: it is nobody's by design.

**Its Wi-Fi, from a phone.** Until 7 Oct 2026 a band joined only what its
console was told, or what `secrets.h` built in: a laptop, a cable and
`ssid`/`pass` to put it on anyone else's Wi-Fi. Now both buttons held as it
starts (down within `SETUP_WINDOW_MS`, 4 s, of starting), or `setup` at the
console, start it again as a Wi-Fi of its own, `OTB-` and four letters, with a
password of ten letters made fresh each time (no I, L, O, 0 or 1). Its face
shows the code a phone's camera joins it from, beside the name and the
password in two halves of five. Every name looked up on that Wi-Fi is the band,
so the phone's own check for a sign-in page (Apple's `hotspot-detect.html`,
Android's `generate_204`) is sent to the one page there is: the networks the
band heard, strongest first, each once, a box to type one it did not, its
password, `SAVE AND RESTART` and `LOOK AGAIN`. Saved, the band keeps them,
drops any `channel` pin (one venue's channel would keep it off this Wi-Fi),
says `SAVED` / `JOINING …` and starts again as a wristband on it. A press on
either button leaves setup unchanged once both have been let go, and so do 10
minutes with nobody asking for the page (`SETUP_IDLE_MS`). Setup is a start of
its own, asked for once: no socket, relay or wristband runs beside it, and a
setup that goes wrong is a wristband again at the next start. Every name in the
page was heard over the air, so each is escaped; the password it has now is
never put in the page; its own Wi-Fi is on a made-up address, as the wristband
is. It joins 2.4 GHz with a password or open, never a sign-in page: a phone's
hotspot works, a school's or hotel's sign-in Wi-Fi does not, and the page says
so. Proven on a StickC Plus, 7 Oct 2026, from a laptop that joined its Wi-Fi:
the page, both sign-in checks sent to it, a short password refused, a save, and
the band back on its hotspot and the relay. Not yet tried: a phone, and both
buttons by hand.

**The battery in the corner.** Every lit face on black that does not already
say the battery (`READY`, `NOT NOW` and `NO SIGNAL` do) carries it small in
its top right corner: the letters, the check, the waiting face, a preview, a
wave. Never a card, whose colour is the point from across a room, and never a
flash. It is the band's own reading, once a second, so it moves on the face
before the relay hears it (`withCorner()`; the stand-in at `/band` draws it
too, and the shared table holds both to it).

**Which way up.** The face is landscape and reads from one of two sides: the
USB-C socket to the left of the words, or to their right. The side is held,
and kept across restarts: `turn usb-left`, the default (worn on the left
wrist with the socket toward the elbow), or `turn usb-right`; `forget` goes
back to USB left, and `show` says which. On a StickC Plus a short press of the
power button turns it over too, read from its AXP192. On a StickS3 only
`turn` does: its power chip powers the band off or restarts it on a short
press, before the firmware sees anything. The side is not worked out from
the accelerometer. That was built and worn on 28 Sep 2026: looking at the
band as at a watch, the face lay nearly flat, gravity in its plane ran along
the arm, and across the short side, the one reading in which the two wrists
differ, it read a tenth to three tenths of a g, and the wrong way, so moving
to the other wrist never turned it. `snap` sends what the screen shows as
one line, `snap <W> <H> <base64>`, its pixels RGB565 little-endian row by
row; every landscape face was looked at through it, and the pairing code
read back from the picture with jsQR, the scanner the app uses.

- **Everything that decides anything is in `src/band_logic.h`**, plain C++ with
  no hardware in it; `src/main.cpp` is only the screen, the speaker, the two
  buttons, the battery, Wi-Fi and the socket. `npm test` builds that logic with the
  machine's own compiler, under the address and undefined-behaviour sanitizers
  where it can, and `tests/firmware.test.js` puts it in front of the real
  relay: the frames it sends pair it, report its battery and make its person
  invisible, and every frame the relay sends it is read back as the relay meant
  it. With no C++ compiler those tests skip. Its `Wrist` is the same machine as
  `/band`'s `app/lib/wrist.js`, and one table, `tests/fixtures/wrist-cases.json`,
  is run against both: the JavaScript by `tests/wrist.test.js`, the C++ through
  `logic_test wrist` by `tests/firmware.test.js`, which also holds every named
  timing equal on both.
- **It goes dark rather than lie.** A hold is dark at once, before the relay
  has heard it, and is sent as soon as there is a relay to send it to. And a
  relay out of reach for ten seconds is no longer believed: the person may have
  gone invisible from their phone since, and a wrist left blue would say
  otherwise. A press then says NO SIGNAL, and whether it is the Wi-Fi or the
  relay. The socket runs on a task of its own, so a connection that hangs — a
  captive portal can hold a TLS handshake open for two minutes — never holds
  up the button or the screen.
- **A sound plays from a buffer of its own.** When the wrist names a sound,
  `main.cpp` renders all its notes as one 8-bit triangle wave at 16 kHz
  (`render()`, in `band_logic.h`, so the host tests hold it) and hands that
  to `M5.Speaker.playRaw()`, so painting the face cannot bend a tune's
  rhythm. There are two buffers of 9.6 KB, used in turn, and one is written
  again only once M5Unified says the speaker has let it go: its buffer
  release callback, which is why the firmware needs M5Unified 0.2.22 or
  later. The StickC Plus plays the same sounds through its buzzer, which
  runs off the 5V output the StickS3 keeps off so as to charge, so `setup()`
  switches that output back on for the Plus alone. A buzzer is loud only
  high up, from about 2.8 to 4.7 kHz on the Plus, so there each sound goes
  up whole octaves, as far as its highest note stays under 4.7 kHz: the same
  tune, every note as long, so the wrist's timings hold (`buzzerFactor()`).
  `down` and `warn` go up two octaves; `jingle` and `found`, already high,
  stay as they are. Octaves alone made `low`, NOT SENT, into `fall`,
  CHANGED: the same fifth down an octave apart, they landed on the same
  notes. So on a buzzer `low` falls that fifth from 4.7 kHz instead, above
  CHANGED (`BUZZER_OWN`), and a host test holds that no two sounds are
  alike on either. The first
  M5StickC has no speaker; it says so once on the console and only lights up.
  The Plus has no PSRAM, and the buffers take its static RAM from 51 KB to
  70 KB of 320 KB; `show` prints the free heap.
- **Checking the relay's certificate takes the older chip seconds.** From
  `relay` to on the Fly relay took 5.9 to 6.3 s on the StickC Plus, whose
  ESP32 checks each ECDSA signature of the chain in software, and 3.0 to 3.4 s
  on the StickS3. The socket task holds its core that long, and the task
  watchdog, which restarts a band whose idle task there has not run for 5 s,
  restarted the Plus mid-handshake every time; it now allows 20 s. Through a
  run of handshakes to Fly and to badssl.com's test servers the Plus kept at
  least 50 KB of its heap free.
- **A change of light alone only turns the backlight.** A flash's dark steps
  and the meeting's blink never repaint the face, so a call that blinks for
  fifteen minutes never holds up the loop or misses a tap.
- **`npm test` also compiles the logic as the band's compiler does.** The ESP32
  core builds C++ as gnu++11, after `Arduino.h` has made names like `LOW` and
  `HIGH` into macros; the laptop build is C++17 and has neither. So
  `firmware/host/as_band.cpp` compiles `band_logic.h` that way: a note table
  called `LOW` and a `constexpr` loop once passed every test and broke only
  in PlatformIO.
- **Its key is 128 random bits, made at every boot**, never the chip's MAC, and
  kept only in RAM with the pairing's secret. So is its address on the air:
  before it joins the Wi-Fi it takes a random, locally administered one, and
  says it in the hello as `air`. If the radio would not take it, the band
  neither beacons nor listens.
- **The beacon and the listen** are the only radio work beside the Wi-Fi. The
  beacon is an ESP-NOW broadcast at 6 Mbps, so a room of bands takes a sixth
  of the airtime it would at the default 1 Mbps. The listen is promiscuous
  mode, because Arduino-ESP32 2.0's ESP-NOW receive callback gives no signal
  strength; it takes only an ESP-NOW frame that carries `OTB1`, keeps the
  strongest reading of each band in that second (`Hearing` in
  `band_logic.h`), and reports the strongest twelve, or that it heard nobody.
  Tried on both bands before it was built: beside the Wi-Fi and a TLS socket
  to the relay, no beacon was lost, and the Plus drew about 101 mA while
  listening against 55 to 75 mA without. A band's outgoing frame is 320
  bytes now, which a full report (294) fits; it was 256, and a longer frame
  would have been cut short without a word.
- **The pairing code is as wide as the screen allows**, with four light modules
  round it. A tunnel address is a version 4 code, and the canvas's 115 pixels
  would make each module two pixels — too small to read off a screen this size.
- **The first flash of a StickS3, as it went.** It has no USB-serial chip: the
  S3's own USB is the port, so there is no driver to install and a C-to-C
  cable is fine. Its factory firmware will not be reset into the bootloader,
  so the first flash needs the side button held until the green LED inside
  flashes; the port comes back as `303A:1001`. After that flash the chip boots
  straight back into download mode (`boot:0x22`) until one short press of the
  side button, and every later flash resets itself with no button at all.
  Opening the port can reset it too, so the lines it prints as it starts are
  usually gone before a monitor is there: type `show`. The first flash also
  found that M5Unified 0.2.23 leaves `Serial` closed unless asked, which left
  the console deaf on every model; `setup()` now asks.
- **Wi-Fi is 2.4 GHz with a password, or open.** Networks behind a web login
  page, like a campus guest network, a university login, like eduroam, or
  OWE ("enhanced open") do not work: a phone's hotspot on 2.4 GHz does. On
  the Android phone it was tried with, "Extend compatibility" moved the hotspot
  to 2.4 GHz only once the hotspot was switched off and on, and "turn off
  hotspot automatically" would have switched it off before the band ever
  joined. The name must match exactly, spaces and all.
- **The console has no line editing.** Keys go to the band as they are typed,
  and a backspace or an arrow is kept as a character: a mistyped line is sent
  as it is and then typed again, which replaces it.
- **Its fonts are ASCII.** Curly quotes, dashes and Latin accents are folded to
  it; a pick in a script the fonts cannot draw shows no second line rather than
  boxes. The phone still shows it whole.
