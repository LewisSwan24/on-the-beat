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
   a phone is, and it does not guess. The finer bands wait for the wristbands.
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
| a wave (SAY HI) | yes — a blue dot on a row that is still only a band, so they can wave back |
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
  - A dropped socket is not leaving: a person stays in the room for two
    minutes, so a locked screen does not cost them their place.
  - Clips are kept in memory, one on the floor per person, for an hour —
    the canvas says "it loops on the floor for an hour", and it does.
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
  two-digit meeting number for fifteen minutes after a match (the same number
  on both wrists), and nothing at all under NOT NOW. Never a name, never
  anyone else's pick, never a contact. At 15% battery it dims itself.
- **Its two buttons.** The face button (KEY1): a press wakes it for six
  seconds; held for 1.5 s it is NOT NOW — dark at once — and the phone
  follows to the invisible screen. The side button (KEY2): a press shows
  the card that is armed; each press after moves a preview — HI, SONG,
  DANCE, OFF — and 3 s after the last one the choice goes to the relay,
  which decides; the face says `SET`, `CHANGED` or `NOT SENT`.
  Coming back from NOT NOW takes holding the side button. The pair screen
  says to *press* its face button, not to hold it.
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
pio device monitor      # its console: ssid, pass, relay, show, forget

pio run -e m5sticks3 -t upload    # the same, for a StickS3
```

Tell it the venue's Wi-Fi and the relay at the console — `relay` takes the
address `npm run tunnel` prints — or copy `src/secrets.example.h` to
`src/secrets.h`, which git ignores, to build them in. What is typed is kept
across restarts, which matters: a quick tunnel's address changes every run.
Off the Wi-Fi, it asks the radio to join again every 15 s. The console says
what the band is doing: the Wi-Fi coming and going and the reason the radio
gave, each hello and whether it carries its secret (never the secret), each
choice sent from the wrist, each refusal, and each change in what the relay
shows.

- **Everything that decides anything is in `src/band_logic.h`**, plain C++ with
  no hardware in it; `src/main.cpp` is only the screen, the two buttons, the
  battery, Wi-Fi and the socket. `npm test` builds that logic with the
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
- **Its key is 128 random bits, made at every boot**, never the chip's MAC, and
  kept only in RAM with the pairing's secret.
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

## Abuse resistance

The relay is a standing public process (behind a tunnel), so the pairing surface
was red-teamed and hardened. A red/blue pass found and closed:

- **Guessing a wristband's four letters.** The code space is only 279,841, and
  one socket could once walk it in about fifteen seconds and take a stranger's
  wristband. Now every pairing attempt, right letters or wrong, and every
  unproven claim is throttled: five per socket and twenty per address
  a minute. Behind the tunnel the address is the real client (from
  `cf-connecting-ip`, trusted only because the socket is on loopback), so one
  attacker cannot spend the whole room's budget.
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

- **There is no fixed address.** `npm run tunnel` opens a Cloudflare quick
  tunnel, and every run gets a new `*.trycloudflare.com` name. Each new name
  means a new link for every phone, `relay <address>` typed again into every
  wristband, and every phone starting over: a browser keeps the app's storage
  per address, so the promises, the name, the venue and the pairing stay behind
  with the old one. A new name is also dead for half an hour to any resolver
  that asks before it has spread. Going live needs a name that stays: a named
  Cloudflare Tunnel on an owned domain, with the laptop still serving, or the
  relay on an always-on host under its own domain.
- **Proximity.** Wristbands pair and light, but nothing measures who is near
  whom: every person is still `in this room`. Nearness wants ESP-NOW between
  wristbands, which wants the hardware.
- **The firmware has run on two wristbands, for one afternoon.** On 25 Sep
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
  shows). A night's worth of battery, and the Plus's face button, are not
  tried. CI builds both envs with PlatformIO on every push — the ESP32 image
  is about 1.2 MB of its 3 MB app partition — and keeps each image to flash.
- **The scanner has read a code through Chrome's fake camera, not a phone's.**
  Headless Chrome played a picture of a wristband's code as its camera; the
  app's scanner read it through jsQR and paired, and a stranger's code was
  turned away. A real camera against a real screen, and Chrome on Android's own
  detector, are the next check.
- **Clip links are bearer links.** Anyone holding a clip's address can load
  it for its hour, including someone who has since been blocked. The address
  is 96 random bits and only ever shown inside a room.
- **Reports go to a log**, not to a person.
- **Answering someone from the wrist** (phase B) is not built: only waving back
  at a SAY HI could be, since a like needs the other person's pick, which the
  wrist never shows.
- **The timings are guesses until worn** — six seconds awake, 1.5 s holds,
  three to send, ten to wait. They are named constants for that reason.
- **Recording has run on Chrome's fake camera, not a phone's.** Headless
  Chrome with a fake camera recorded five seconds through the app's own
  MediaRecorder path and sent it; a second phone found it on the floor and
  loaded a valid WebM (148 KB). A real phone camera — and Safari's MP4
  recorder — is the next check.
