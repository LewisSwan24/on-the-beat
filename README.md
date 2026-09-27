# On The Beat

Get talking to a stranger at a live gig, then get out of the way.

A phone app for one night at one venue. You arm one of three cards — **SAY HI**
(your screen turns blue: hello), **FIRST SONG?** (pick the opening track and
like other people's picks), **LET'S DANCE!** (five seconds of you dancing, on a
shared floor) — and when two people both say yes, and only then, each learns
the other's first name and where to meet. It is built from the Claude Design
canvas `On The Beat.dc.html`; the canvas is the design, this is the working
thing.

**This repository is personal**, and deliberately separate from the DECO3500
team repository (`cimi2232/DECO3500`, which is public). Nothing here is pushed
there: a `pre-push` hook refuses any remote under the team account. Git does not
clone hooks, so the copy that matters is tracked at `tools/hooks/pre-push`;
after a fresh clone, reinstall it with `cp tools/hooks/pre-push .git/hooks/pre-push`.
It replaces `on-the-beat-prototype` (the Crew Pact direction), which is retired.

## Run it

```
npm install
npm start            # build, then the relay and the app on http://localhost:8790/
npm test             # build, then every test
npm run dev          # Vite on :5178 for working on the app (run `npm run relay` beside it)
npm run tunnel       # an https address for real phones (cloudflared must be installed)
```

**The night ends at 06:00 at the venue.** `NIGHT_TZ=Australia/Brisbane npm start`
names the venue's time zone (an IANA name); without it the relay uses its own
machine's.

**CI.** Every push to `main` and every pull request runs `npm test` and builds
the wristband's firmware for both envs with PlatformIO
(`.github/workflows/ci.yml`). Each run keeps the firmware as a download: each
env's `firmware.bin`, and one image each that flashes whole at `0x0`,
bootloader and partition table included — `otb-wristband-full.bin` for the
M5StickC Plus, `otb-wristband-s3-full.bin` for the StickS3.

**Phones need https.** The camera, the screen wake lock and the offline shell
are all refused on plain http, so a phone on the LAN gets an app with no
camera. `npm start` and then `npm run tunnel` gives every phone the same https
address and the same room.

**Always on, at https://on-the-beat.fly.dev.** The relay runs on one Fly.io
machine in Sydney (`fly.toml`, `Dockerfile`), so phones and wristbands need no
laptop: a phone opens the address, and a wristband is told it once with
`relay https://on-the-beat.fly.dev`. To ship a change:

```
flyctl auth login                        # once, in your own terminal
flyctl deploy --ha=false --remote-only   # built on Fly's builder; the one machine restarts on it
```

- **Exactly one machine.** Every room lives in the relay's memory, so a second
  machine would split phones from their wristbands. `--ha=false` keeps a
  deploy from starting two; `flyctl scale count 1` puts it back if it ever does.
- **A deploy is a restart.** Rooms, pairings and clips go with the old
  process, and phones and wristbands come back as after any restart: a
  wristband waits with `OPEN YOUR PHONE` until its phone claims it back.
  Deploy between nights.
- **Only what the image is built from reaches the builder.** `.dockerignore`
  lets through `package.json`, `package-lock.json`, `vendor/`,
  `vite.config.js`, `app/` and `relay/`, and nothing else: never
  `firmware/src/secrets.h`. The first deploy sent 465 kB.
- `fly.toml` sets `NIGHT_TZ=Australia/Brisbane` and
  `CLIENT_IP_HEADER=fly-client-ip` (see Abuse resistance).

**Showing it with one phone.** `node scripts/crowd.mjs [venue] [how many]`
puts a few demo people in a venue: they show blue, pick tracks, wave back at
anyone who waves, like every pick and keep every match. Every one of them has
`demo` in their name, so a match with one cannot pass for a real person. They
never dance — a clip from them would be made up. Nothing in the app starts
them.

## The four promises, and where each one is kept

Everything a phone is shown comes out of `viewFor()` in `relay/room.js`. That
function is the product's promises as code, and `tests/room.test.js` holds
each one.

1. **Nobody sees where you are.** A person carries a band — `in this room`,
   `near the bar`, `by the stage`, `somewhere out the back` — and nothing
   finer. There is no position anywhere in the system to leak. On phones
   alone, everyone is `in this room`: a web page cannot tell where in a venue
   a phone is, and it does not guess. Only a marker the venue puts up, heard
   clearly by a person's own wristband, names a finer band (*Markers*,
   below). What wristbands hear of each other only takes people off SAY HI's
   list (*Who is near*, below), and no phone or wristband is ever told how
   near anyone is.
2. **No name and no photo until you both say yes.** Before a mutual yes a
   person is a handle, a band and at most a track. Handles are per viewer —
   the same person has a different handle on every phone — so two phones
   cannot compare notes about who is who.
3. **One tap makes you invisible.** NOT NOW takes you off every list and
   shows you nobody's. It is kept on the phone, so a reload or a flat signal
   does not turn you back on; only TURN BACK ON (or arming a card) does.
4. **If someone declines, you never see each other again tonight.** The
   decline is Block — and "Not this one" on a match is a decline. It is
   silent, both ways, and it outlives leaving the room, so a phone that slept
   in a pocket for ten minutes does not come back unblocked.

What each kind of yes shows the other side before it is returned:

| | seen by the other person? |
|---|---|
| a wave (SAY HI) | yes — a blue dot on a row that is still only a band, so they can wave back; and on their wristband, a short call and a count of who waits, never who |
| a like (FIRST SONG?) | never — it was for an answer, not a face |
| a dance back (LET'S DANCE!) | yes — the clip goes straight to them, with no name on it |

None of them is ever reported as declined. A yes that is not returned just
never becomes a match.

## How it is built

- **`relay/`** — one Node process: the pages, and one room per venue over a
  WebSocket at `/api/ws`. One process on purpose: a host that scales out can
  put two phones at the same gig into two different rooms that share a name.
  The night is held in memory only; stop the relay and it is gone.
  - After every change the relay pushes each phone its own `viewFor()`.
  - What each wristband heard of the others and of the markers is kept
    30 s, in memory, and never leaves the relay; every five seconds each
    room works out who is near whom and who is in which area, and pushes
    only the views that changed.
  - A dropped socket is not leaving: a person stays in the room for two
    minutes, so a locked screen does not cost them their place.
  - Clips are kept in memory, one on the floor per person, for an hour —
    the canvas says "it loops on the floor for an hour", and it does. Every
    room's clips together stay under 96 MB, what a small always-on machine
    can hold: past that the oldest go first, in whichever room they are.
  - Reports are written to the relay's log. A venue would send them to its
    own team's radio or dashboard.
  - `relay/shows.json` is tonight's shows: times, quiet corners to meet at,
    and the set list. A venue nobody listed still gets a room, named by what
    was typed.
- **`app/`** — React, built by Vite into `dist/`, installable as a PWA.
  - `lib/net.js`: on every join the phone says again what it is (name, armed
    card, NOT NOW, pick), because the relay may have restarted and forgotten.
    It asks every two seconds and takes six of silence as a dead socket,
    since a socket can die without ever closing. Actions taken with no signal
    are queued: "Saved. It'll sync when you're out."
  - `lib/store.js`: the phone keeps its own record of the night in
    `localStorage` — where it was, what it did, who it met — and, for good,
    any contact both sides kept. A night gets its own random id, so a person
    is not the same stranger to the relay two nights running.
  - `lib/phase.js`: DOORS · SUPPORT · BREAK · HEADLINE · AFTER, from the show's
    own times and the phone's clock. A time before six in the morning belongs
    to the night before.
  - `public/sw.js`: keeps the shell so the app opens in a venue with no
    signal. It never keeps the socket, the shows or the clips.
- **`firmware/`** — the wristband itself, an M5StickC Plus or a StickS3 on a
  strap, built with PlatformIO. See The wristband's firmware, below.

## The wristband

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
  the wristband shows new letters; a second phone trying the same wristband
  meanwhile is told someone is pairing it. A decoy code stuck on someone's
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
  follows to the invisible screen. The side button (KEY2): a press shows
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
  phone buzzes for a wave only when no live wristband calls instead.
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
- **Who is near comes from the wristbands.** While a band is on the relay,
  paired and not in NOT NOW, it beacons four bytes by ESP-NOW twice a second,
  under an address it makes up at every boot, and for one second in every ten
  it listens for the others and tells the relay whom it heard and how
  strongly. The relay scores each pair of bands in a room by the median of
  what each heard of the other in the last 30 s, and every five seconds works
  out each band's five heard most strongly; one of the five stays while it is
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
  heard (`tests/near-crowd.test.js`).
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
- **A lit card pulses on the beat.** While a card is lit at rest — `HI :)`,
  `FIRST SONG?` or `LET'S DANCE!`, never a meeting number, the letters, the
  check, the test light or NOT NOW — the band listens to the room, and once
  it has the beat the card's light is full on each beat and falls in a
  straight line to half over the first two thirds of it. The colour never
  goes dark, and every reaction goes first. It finds the beat in whatever
  part of the sound carries it, since laptop speakers and a venue's echo
  both lose the kick: each block's five levels, how far each rose, a tempo
  read every 128 ms by autocorrelation between 80 and 178 BPM, weighted
  towards 120, and a grid that pulses once four of its last five beats were
  heard. In doubt the card stays steady: a song that stops goes quiet within
  two beats, another song takes over the grid, and a missed kick or a
  reaction's gap does not stop it. The phone's wristband sheet has
  `BEAT: ON` under `SOUND: ON`, the person's own in the same way; off, the
  band never opens its microphone. It is on by default.
- **It hears loudness only.** Each 8 ms of sound becomes five levels on the
  band, one for each band of pitch, and it keeps only how far they rose, one
  number a block, for six seconds. Nothing of the sound is recorded, and
  nothing it hears is sent: the relay only carries the switch. The
  microphone is open only while a lit card could pulse and the switch is on.
  `/band`'s `LISTEN` does the same with the laptop's microphone, for a demo;
  it is off until turned on, and only then asks the browser for it.
- **Letters go dark after two minutes.** An unclaimed band's letters and QR,
  and the face of one waiting for its owner after a restart, light for two
  minutes and then only the backlight goes off; a press lights them again.
  A press on the letters or on the check puts `PAIR ON YOUR PHONE` on the
  face for 3 s, and does nothing else there.
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
  are back.
- **After a relay restart** the wristband comes back with its secret and waits
  for its owner — `OPEN YOUR PHONE` / `OR SWITCH ME OFF`, no letters — until
  the phone's claim with the same secret pairs it again; a hold meanwhile is
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
pio device monitor      # its console: ssid, pass, relay, show, forget, press, hold, face, near, marker

pio run -e m5sticks3 -t upload    # the same, for a StickS3
```

Tell it the venue's Wi-Fi and the relay at the console — `relay` takes
`https://on-the-beat.fly.dev`, or the address `npm run tunnel` prints — or
copy `src/secrets.example.h` to `src/secrets.h`, which git ignores, to build
them in. What is typed is kept across restarts, which matters: a quick
tunnel's address changes every run.
Off the Wi-Fi, it asks the radio to join again every 15 s. The console says
what the band is doing: the Wi-Fi coming and going and the reason the radio
gave, each hello and whether it carries its secret (never the secret), each
choice sent from the wrist, each refusal, and each change in what the relay
shows.
The console can also press the buttons, so a real band is tested without a
hand on it: `press face` or `press side` is a press, let go after 120 ms;
`hold face` or `hold side` is let go 200 ms after the hold counts. Either is
down through the same edges as the button itself, so the band cannot tell
them apart. `face` says what the screen shows: its words, field and light,
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
- **The microphone and the speaker take turns.** `main.cpp` opens the
  microphone only while the wrist says it is listening, and each full block
  goes straight back to M5Unified from the microphone's own task, with a
  copy for the loop, so the loop's pace never loses a sample. A sound
  closes it for the sound's length, and it opens again after; the spike
  measured the turn at about 25 ms besides the sound. Both bands hand their
  blocks over two at a time, and their samples run 382 ppm fast of
  `millis()`, which counting alone would carry into the pulses at 23 ms a
  minute. So a block clock counts them, held to `millis()` (`BlockClock`,
  in `beat_logic.h`): a block is never timed after it was handed over, the
  count creeps later by at most 0.125 ms a block, blocks lost are counted
  over, and the first 16 after it opens are not heard while its filters
  settle. The levels, the tracker and the clock are twins of
  `app/lib/beat.js`, held equal to the bit by `tests/firmware.test.js`.
  `beat` on the console says whether the microphone is open, what it has
  heard and whether it has the beat; `face` shows the light moving.
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

## Where this differs from the canvas, on purpose

- **It asks for a first name**, once, after the venue. The canvas never asks,
  but someone has to be named when two people both say yes. A contact is
  asked for only the first time you keep someone, and only shared if they
  keep you too.
- **Venue distances are gone.** The canvas shows "40 m" beside each show;
  that needs the phone's location, and promise 1 says nobody sees where you
  are. The list shows doors times instead.
- **Real empty states** where the canvas always had a crowd: nobody saying
  hi, no picks on the wall, an empty floor.
- **A camera that is refused** says so and offers to try again; nothing is
  sent until you send it. "Just for me" saves the clip to the phone.
- **The wristband shows a QR code while it pairs**, not only the four letters
  revision 6 draws. `SCAN IT INSTEAD` needs something to scan, and the code
  also lets a phone's own camera open the app.
- **A second button, and other timings.** Revision 6 gives the wristband a
  single button — a 3 s wake, and a 1 s hold for NOT NOW — and no second
  action. The owner chose on 24 Sep 2026: the side button (KEY2,
  M5Unified's `BtnB` on every supported board, as a StickS3 and a StickC Plus
  bore out; the power button is never used)
  changes the armed card, so the phone can stay in a pocket; a press wakes the
  face for six seconds, long enough to read a preview; NOT NOW is a hold of
  1.5 s, longer than a bump in a crowd. Every timing is a named constant, in
  `band_logic.h` and `app/lib/wrist.js`, because they are guesses until worn.
- **A connected wristband keeps its person in the room for up to an hour**
  without their phone, where the canvas has the phone as the only way in.
- **Pairing ends with a check** shown on the wrist and confirmed on the phone.
  Without it a decoy code would pair silently, and with `set` a wrongly paired
  wristband could make someone visible.
- **The wristband flashes and chirps.** Revision 6 §8 rules out vibration or
  light patterns that pretend to carry a message. The owner chose on 25 Sep
  2026 that the band flashes and sounds, and none of it pretends: each
  reaction answers something the wearer just did, or says one fact about the
  band. The two about another person are the meeting call, for a number the
  band already shows, and a wave's call.
- **The wristband says that someone waved.** Revision 6 §8 keeps names,
  photos and other people's picks off the wristband, and it showed nothing
  about anyone else but the meeting number. The owner chose on 25 Sep 2026
  that it also says that someone waved at its person and how many wait, and
  can wave back to the newest. Still no name, no photo, no pick and no area.
- **A meeting ends when both say they found each other.** Revision 6 shows
  `MEET` and the number for as long as the meeting lasts, and S11 has no way
  to say a meeting happened. The owner chose on 26 Sep 2026 a side hold on the
  band, or `WE FOUND EACH OTHER` on S11, counted only when both say it: the
  meeting face gains `FOUND: WAITING`, both bands a *found* reaction, and
  Tonight's `met` counts meetings found, not matches.
- **Near is the five heard most strongly, not everyone heard.** Revision 6
  lists the people whose wristband yours can hear. On a crowded floor that is
  nearly everyone, so the list is the five heard most strongly, which is also
  S5's own limit of five. People without a band cannot be heard, which says
  nothing about where they are, so they are listed as before; the owner chose
  that on 26 Sep 2026.
- **A lit card pulses on the beat.** Revision 6 §8 rules out light patterns
  that pretend to carry a message, and says nothing about music. The owner
  chose on 25 Sep 2026 that a lit card pulses with what everyone in the room
  can hear, and on 27 Sep that it is on by default, with `BEAT: ON` on the
  phone to keep it still. The pulse carries no message: it says nothing
  about the wearer or anyone else, and is off whenever the card is.
- **A marker names an area only when it is heard clearly.** Revision 6 takes
  the loudest marker. Far from every marker the loudest is still some marker,
  heard faintly across the room, so it names a band only at -56 dBm or
  louder, and otherwise the person stays `in this room`: the owner chose on
  27 Sep 2026 that it is better not to say than to say it wrong. A third
  marker, `somewhere out the back`, which the prompt's list of bands already
  has, is allowed; revision 6 names only the bar and the stage.

## Abuse resistance

The relay is a standing public process (on Fly.io, or behind a tunnel), so the pairing surface
was red-teamed and hardened. A red/blue pass found and closed:

- **Guessing a wristband's four letters.** The code space is only 279,841, and
  one socket could once walk it in about fifteen seconds and take a stranger's
  wristband. Now every pairing attempt, right letters or wrong, and every
  unproven claim is throttled: five per socket and twenty per address
  a minute. The address is the real client, so one attacker cannot spend the
  whole room's budget. On Fly.io it is `fly-client-ip`, which Fly's proxy sets
  from the connection it accepted, read only because `CLIENT_IP_HEADER` names
  it; that the proxy also replaces one a client sends is reported by others,
  not measured here. Behind the tunnel it is `cf-connecting-ip`, trusted only
  because the socket is on loopback.
- **Piling up placeholder claims.** A phone claims a wristband by id and
  secret, which a restarted relay must accept before the wristband is back. A
  claim nothing answers is a placeholder, one per person, forgotten after the
  hour; the band table has a hard ceiling that evicts the deadest record first
  and never a live wristband.
- **Speaking as someone else's wristband.** Every hello carries the key its id
  is the hash of; a hello whose key does not hash to its id is refused, for a
  paired, a pending and an unpaired record alike, and a paired record also
  needs its secret, without which the new socket is closed and the live one is
  left alone. A socket says hello once, a replaced wristband socket is closed
  and nothing more is taken from it, and a hello with no protocol version gets
  letters but is never paired.
- **A decoy wristband.** The check above: the number appears on the wristband
  that was reached, so a decoy has to be believed, not just scanned. Numbers
  are unique among the pairings in progress, a second pairing of the same
  wristband is refused `busy`, and the letters change after every NO or
  timeout.
- **Showing someone late.** A wristband's `set` is dropped whole unless it is
  exactly a set, and refused `unpaired`, `no room`, `changed` or `too fast`
  (one a second). A phone's re-said facts only ever hide, and only when they are
  news; a showing change names the revision it was chosen from. A person who
  left under NOT NOW and comes back is still invisible, and a join made while
  holding NOT NOW makes them invisible from the first moment.
- **A wristband's yes for its person.** A band can wave back, which makes a
  match and shows both names. It speaks for its person only with the secret of
  its pairing, so no other band can wave as them. Its wave is dropped whole
  unless it is exactly one, then refused `too fast` (one a second, counted
  before any handle is looked up and whether or not it lands, so a flood of
  made-up handles buys nothing), `unpaired`, `no room`, `changed` (its
  person's revision moved, or they are not on SAY HI) and `gone` when the
  handle is not someone waiting on its person, which a block reads exactly
  like. A band never starts a wave: with none to answer, nothing is recorded.
  A lent, taken or forgotten band can still make a match for its person, with
  or without their phone; blocking undoes it.
- **What a wristband says it heard.** A report is dropped whole unless it
  comes from a paired band's current socket, five seconds or more after its
  last, on a channel from 1 to 14, with at most sixteen entries, each a
  twelve-hex address and a whole signal strength from -100 to 0; a hello whose
  `air` is not twelve lower-case hex digits is refused. An address counts only
  as the address of exactly one band paired in the same room, so one claimed
  twice, or from another room, counts for nobody. A band that lies changes
  only its own person's list, and nearness only ever removes, so it can show
  nobody a phone could not see already. A band beaconing under another's
  address moves that band's nearness to where the liar stands, among
  strangers in the same room, and no further. A report's `marks`, when it
  has any, are at most three, each area `bar`, `stage` or `back` once and each
  strength a whole number from -100 to 0, or the whole report is dropped; a
  band that lies about them changes only its own person's area.
- **A marker anyone can make.** A marker has no key: any ESP32 beaconing
  `OTBM` and a letter, or repeating a real marker's beacon somewhere else,
  makes the people whose bands hear it clearly read `near the bar` or the
  like on others' rows. It chooses only among the three phrases, cannot show
  anyone who was hidden, and learns nothing. A key would stop only inventing
  a marker, not copying one, so there is none.
- **Rooms that never emptied.** A venue with nobody in it, nobody in its grace
  window, no clip still loading and no wristband still worn is now reclaimed, so
  a long-lived relay does not keep a room object for every venue anyone typed.
- **A report log without end** is capped at its most recent thousand.
- **A flood of venue joins.** `join` is unthrottled and each new venue is a room
  object; the room table now has a ceiling that reclaims empty venues under
  pressure and refuses a new one only when every venue is genuinely in use, and
  a socket switching venues has its orphaned rooms reclaimed as it goes.
- **MIME confusion.** Every served response — the app, a built asset, a clip,
  the shows feed — carries `X-Content-Type-Options: nosniff`, so a browser
  takes the declared type and never guesses one.
- **Malformed and hostile frames.** Non-JSON, wrong-typed fields, forged
  handles and unknown message types are all inert: a fuzz barrage of them
  leaves the relay serving and still forming rooms (`tests/server.test.js`).

Each fix is a test in `tests/server.test.js`, `tests/wristband.test.js` or
`tests/rules.test.js`, and each was mutation-checked — break the guard and
exactly its test goes red; where other tests stand on a guard, exactly that
known set does. A dropped wristband keeps its
letters through a wifi blip on purpose (so the code under a typing finger does
not change), which is the one deliberate change to a wristband's own lifetime.

The `/pair/` link used to wait for a tap on the phone, because a hostile code
anywhere could bind an attacker's wristband to whoever opened it. The check
replaces that tap for every way in — the in-app scanner and typed letters too,
which the old guard never covered.

The room model itself — who appears in another person's view — was read end to
end: before a mutual yes a person is only a per-viewer handle and a coarse band,
name and contact arrive only when both keep, an invisible person is absent from
everyone's lists, and a block cuts both directions and outlives leaving.

Still open here: the clip bearer links below; the letters on a wristband's
screen, which let someone watching hold its check open a minute at a time —
every attempt counts and the letters change after each, so this annoys rather
than pairs; and the firmware's https
connection, which is encrypted but does not check the relay's certificate unless
`OTB_RELAY_CA` is built in, so on a hostile network something posing as the
relay could drive what a wrist shows.

## What is not done

- **One machine, and its memory is everything.** The relay has a fixed
  address now, https://on-the-beat.fly.dev, but every room, pairing and clip
  lives in one machine's memory: a deploy or any restart empties it, and
  everyone finds their way back as after any restart. More people than one
  small machine holds, or a restart nobody notices, needs the rooms kept
  outside the process first. A phone that used a tunnel address starts over
  at the fixed one: a browser keeps the app's storage per address.
- **Who is near has not met a crowd.** On 27 Sep 2026 it ran on both real
  bands through the Fly relay, each paired to a stand-in phone on SAY HI with
  a third phone that had no band. Each band joined the Wi-Fi under an address
  new at that boot, not its chip's, and heard the other on channel 1 (the Plus
  heard the StickS3 at -23 dBm, the StickS3 the Plus at -30), beaconing about
  twice a second with none refused. Told to listen without beaconing, both
  reported hearing nobody, and 25 s later each phone had dropped the other
  while the phone with no band kept both; one band beaconing again brought
  both back in 9 s. A band gone quiet hid nobody. The Plus, face dark, drew
  59.2 mA beaconing and listening and 61.2 mA with neither, the mean of a
  minute each: no cost the reading can show. A crowd is still only modelled.
  Bodies and reflections on a real floor may differ from the model; ranking
  the strongest was chosen because it leans on them least, and a walk
  through a venue is the check.
  Not built: a correction between models, though a StickS3 heard a Plus 7 dB
  weaker than the Plus heard it; and more than one Wi-Fi channel, since a
  band hears only bands on its own channel, so a venue whose access points
  use several splits its bands into groups, each of which keeps the others
  listed. Markers do not have this problem: they beacon on every channel.
- **Markers have met two bands, not a room.** On 27 Sep 2026 the StickC
  Plus, made `marker bar` at its console, sent 338 beacons in 13 s on
  channels 1 to 13, none lost or refused, each sweep about 30 ms. The
  StickS3, on the hotspot's channel 11 and paired to a stand-in phone on SAY
  HI, heard it across the desk at -45 and -44 dBm. 11.5 s after the marker
  started, a second phone with no band showed that person `near the bar`, as
  did their own view, and nothing changed in the next 45 s; 30.5 s after
  `marker off`, both said `in this room` again. Then, with no hand on either
  band: the marker's face, read back over its console, was dark, then
  `MARKER / NEAR THE BAR` 1.5 s after a press of either key (backlight 255,
  1,833 of 32,400 pixels lit), and dark again 7.5 s after; and the real app,
  in a browser as a third person with no band, listed `Someone near the bar`
  beside `Someone in this room`. With the bands a few metres apart, the band
  heard the marker at -55 and -56 dBm at full power, and the person was
  `near the bar`. Capped lower, it heard -57 and -58 and the person stayed
  `near the bar`, as the hold keeps them; at -65 and -64 they turned `in this
  room`, and stayed so while it heard -60 to -69. Raised again, at -52 they
  were `near the bar` once more. Readings at one setting spread by up to 8 dB.
  The way back up never landed between -60 and -56, so that a person coming
  back must reach the floor itself is held only by the relay's tests. The
  -56 dBm floor rests on the crowd
  model's losses for distance and bodies, calibrated on two bands on a desk;
  a real venue's walls may want another floor, and it is one constant in
  the relay (`MARK_FLOOR`). There is one floor for every venue, and a marker
  is not listed or shown to the venue anywhere. Channels 12 and 13 are
  allowed in Australia and not everywhere: a marker used elsewhere would
  hop 1 to 11. A marker on a laptop's USB may be switched off with it; a
  marker wants a wall charger.
- **The firmware has run on two wristbands, for one day.** On 25 Sep
  2026 a StickS3 and an M5StickC Plus joined an Android phone's hotspot and
  reached the relay through a quick tunnel, with that phone and a laptop
  browser as two people. From the wrist alone, the side button chose each
  card and OFF and the phone followed, saying *Armed from your wristband*; a
  face hold went NOT NOW and a side hold came back. With the phone locked for
  over two minutes, SAY HI chosen on the band reached the other person's
  WHO'S NEAR, and the phone woke with it still armed and no toast saying a tap
  failed — but its socket stayed open all the while, so a band holding its
  person with the phone truly gone is still untried. After a relay restart
  the band waited with `OPEN YOUR PHONE` until the phone claimed it back
  without letters, and when the laptop's own internet dropped for 80 s both
  bands found the relay again by themselves. Two wrists met: both showed
  `MEET 22` in the same second. Two things did not work, and are fixed: a
  band that booted before the hotspot was on never joined it (it now begins
  again every 15 s, and joined by itself once the hotspot was back), and the
  console said too little to tell an UNPAIR tapped on the phone from a lost
  secret (it now says what the wrist sends and each change in what the relay
  shows). That evening both moved to the always-on relay with one `relay`
  line each and no reflash; then, with no relay or tunnel on the laptop and
  both bands off its USB, the phone paired with a band through
  https://on-the-beat.fly.dev and the band responded; a second device paired
  the other, and a wave and a wave back between the two put `MEET` on both
  bands. A night's worth of battery, and the Plus's face button, are not
  tried. CI builds both envs with PlatformIO on every push — the ESP32 image
  is about 1.2 MB of its 3 MB app partition — and keeps each image to flash.
- **The reactions have run on both real bands, but nobody has listened yet.**
  On 26 Sep 2026, driven from their USB consoles through the Fly relay, both
  bands played each reaction where it belongs: `ask` at the check, `up` on
  YES, `hello`, `double`, `jingle`, a `tick` per press, and a warning as a
  band lost its pairing. TEST THE LIGHT with the phone's switch off showed its
  white and played nothing. A meeting blinked, the light 0 and 255 in turn as
  `face` read it, until a press that only ticked. The Plus keeps 72,728 bytes
  free with both sound buffers, 63,880 at the least. The Plus's buzzer was
  silent at first: it runs off the 5V output the firmware had switched off
  for the StickS3's sake. With that output back on, a laptop microphone
  beside it heard the band play every one of its eleven sounds from the
  console, three times each, measured note by note at one fixed delay, with
  the same measure 0.7 s either way as the control. Played at the S3's
  pitches, `ask`, `down`, `low` and `warn` did not rise over the room at
  all; a sweep a semitone at a time found the buzzer loud only from about
  2.8 to 4.7 kHz. Raised by octaves (above), every one of them came through,
  most notes 10 to 34 dB over the room, and the ticks as well; still faint
  are `up`'s first two notes, at 2.1 and 2.6 kHz. With the 5V output on and
  USB in, the Plus held 100% for 50 minutes, most of them on the Wi-Fi,
  where the StickS3 in the same state ran down. How each sound lands on a
  wrist, and each colour, and the words whole on a real screen, still need
  someone there. A lit card pulsing on the music's beat has its own entry
  below.
- **The scanner has read a code through Chrome's fake camera, not a phone's.**
  Headless Chrome played a picture of a wristband's code as its camera; the
  app's scanner read it through jsQR and paired, and a stranger's code was
  turned away. A real camera against a real screen, and Chrome on Android's own
  detector, are the next check.
- **Clip links are bearer links.** Anyone holding a clip's address can load
  it for its hour, including someone who has since been blocked. The address
  is 96 random bits and only ever shown inside a room.
- **Reports go to a log**, not to a person.
- **Waves have run on the real bands from their consoles, not yet by hand.**
  On 26 Sep 2026, through the Fly relay, a stand-in phone paired the StickC
  Plus and a scripted one the StickS3, each saying YES only once the band's
  own console showed the same number, and a third person without a band
  joined them. Each wave called the Plus, with `hello` and a count of
  `1 waiting`, then `2 waiting`. `press face` opened `SOMEONE WAVED` /
  `2 WAITING - HOLD SIDE` at light 110, and `hold side` played `double` and
  waved back to the newest. The relay took it: both bands showed `MEET 63`
  and played the jingle in the same second, and both phones showed the
  match. The physical buttons, and the three blue flashes seen by eye, are
  left for a person. Answering from the wrist is only waving back: a like
  needs the other person's pick, which the wrist never shows.
- **Found each other has run on the real bands from their consoles, not yet
  by hand.** On 26 Sep 2026, through the Fly relay, two stand-in phones with
  SOUND off paired the StickS3 and the StickC Plus (each YES only once the
  band's own console showed the number), and a wave and a wave back made
  MEET 65 on both. A side hold on the S3 said found: its console showed
  `meet 65 (found: waiting)` and its face `FOUND: WAITING`, and the Plus's
  console said nothing at all. A side hold on the Plus then gave both
  `hi (found 65)`, both faces lost the number, and both phones had the same
  found time. With SOUND off nothing could show that the `found` sound and
  flash played on the hardware; they, and the buttons pressed by hand, still
  need someone there. Saying it by bumping two wristbands together, with the
  motion sensor, is a later change, after a spike shows a fist bump can be
  told apart from two people dancing to the same beat.
- **The beat has not been heard on the real bands.** The tests hold the
  tracker and its block clock equal to the bit between the twins, and to
  made-up music: kicks at 90, 120 and 160 BPM, a hi-hat, a held chord,
  noise, made-up speech, random kicks, missed kicks and gaps. The stand-in's
  `LISTEN` pulsed on a made-up 120 BPM kick in a browser, 500 ms apart, and
  was steady within a beat of being turned off. On the bands it has only
  been built, for both boards. Its gate is owed (the spec's §4.1): round 3 of
  the spike on both bands beside the laptop at round 2's volume, and each
  model's microphone delay, 0 until then, measured there from presses of
  the face button. It reaches `main` only once that passes. What the made-up
  music already shows: made-up speech and random kicks still pulse, in short
  bursts, 4 to 24 pulses in each 800 s of them; a held chord flickers by
  about ±3 dB a block, which can count as a rise; and a hi-hat over a quiet
  room never locks. On the Plus the backlight has only eleven levels, set through its
  power chip, so a pulse falls in a few visible steps; and each turn to the
  microphone ends and begins the speaker, which may be heard as a click.
  Both are for eyes and ears on the bands.
- **The timings are guesses until worn** — six seconds awake, 1.5 s holds,
  three to send, ten to wait. They are named constants for that reason.
- **Recording has run on Chrome's fake camera, not a phone's.** Headless
  Chrome with a fake camera recorded five seconds through the app's own
  MediaRecorder path and sent it; a second phone found it on the floor and
  loaded a valid WebM (148 KB). A real phone camera — and Safari's MP4
  recorder — is the next check.
