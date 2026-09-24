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

**CI.** Every push to `main` and every pull request runs `npm test` and builds
the wristband's firmware with PlatformIO (`.github/workflows/ci.yml`). Each
run keeps the firmware as a download: `firmware.bin`, and
`otb-wristband-full.bin`, which carries the bootloader and partition table too
and flashes whole at `0x0`.

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

Revision 6 of the canvas puts a wristband beside the phone: an M5StickC on a
strap that lights in the colour of the card you armed, so the phone can go
back in a pocket. Its firmware is in `firmware/` (below), and **`/band` is a
stand-in** that speaks exactly the same messages — open it in a second browser,
or on a second phone strapped to a wrist, when there is no wristband to hand.

- **Pairing.** A wristband nobody has claimed shows four letters from
  `ABCDEFGHJKMNPQRSTUVWXYZ` — no I, L or O — under a QR code of an address:
  its own origin and `/pair/` and those letters. There are three ways in, and
  all three end in the same four letters:
  - type them, once, after the name, or later from the watch chip on the home
    screen;
  - `SCAN IT INSTEAD` on that screen: the app's own scanner reads the code;
  - someone who has not opened the app yet points the phone's own camera at
    the wristband. The address opens the app on the pair screen with the
    letters already in, and one tap pairs it — after onboarding, for someone
    new. It never pairs on its own; see Abuse resistance for why.

  The relay then tells the phone the wristband's id, and the phone claims it
  by that id after every reconnect. A new pairing flashes the wristband white
  once, so the right wrist knows. A paired wristband cannot be taken by
  another phone; one nobody claimed is forgotten when it disconnects, letters
  and all.
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
- **Its one button.** A press wakes it for three seconds. Held for a second it
  is NOT NOW, and the phone follows to the invisible screen. That is also why
  the pair screen says *press* its button, not *hold* it.
- **A phone coming back does not undo the wrist.** On every reconnect the
  phone re-says its standing facts marked `again`, and the relay never lets
  those turn a person visible who went invisible from the wrist.
- **After a relay restart** everything is forgotten, and the phone can be back
  before its wristband. The phone's claim by id is held, and the wristband
  comes back already paired.

## The wristband's firmware

`firmware/` is a PlatformIO project for the M5StickC Plus and Plus2 (M5Unified
tells them apart as it starts; the first M5StickC works too, drawn smaller),
and for the M5StickS3, an ESP32-S3 that no ESP32 image boots on, so it is an
env of its own: `pio run -e m5sticks3`. The code is the same for all of them. It
speaks exactly what `/band` speaks, on the same clock: it says it is a wristband
with an id it made once and keeps, shows whatever the relay tells it to, asks
the relay every two seconds and takes six of silence as a dead socket. A press
wakes it for three seconds; a one-second hold is NOT NOW.

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

- **Everything that decides anything is in `src/band_logic.h`**, plain C++ with
  no hardware in it; `src/main.cpp` is only the screen, the button, the
  battery, Wi-Fi and the socket. `npm test` builds that logic with the
  machine's own compiler, under the address and undefined-behaviour sanitizers
  where it can, and `tests/firmware.test.js` puts it in front of the real
  relay: the frames it sends pair it, report its battery and make its person
  invisible, and every frame the relay sends it is read back as the relay meant
  it. With no C++ compiler those tests skip.
- **It goes dark rather than lie.** A hold is dark at once, before the relay
  has heard it, and is sent as soon as there is a relay to send it to. And a
  relay out of reach for ten seconds is no longer believed: the person may have
  gone invisible from their phone since, and a wrist left blue would say
  otherwise. A press then says NO SIGNAL, and whether it is the Wi-Fi or the
  relay. The socket runs on a task of its own, so a connection that hangs — a
  captive portal can hold a TLS handshake open for two minutes — never holds
  up the button or the screen.
- **Its id is 128 random bits, not the chip's MAC.** A phone can claim a
  wristband by id after a relay restart, so an id anyone could read off the air
  would let them.
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
  page, like a campus guest network, or a university login, like eduroam, do
  not work: a phone's hotspot on 2.4 GHz does.
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

## Abuse resistance

The relay is a standing public process (behind a tunnel), so the pairing surface
was red-teamed and hardened. A red/blue pass found and closed:

- **Guessing a wristband's four letters.** The code space is only 279,841, and
  one socket could once walk it in about fifteen seconds and take a stranger's
  wristband. Now each unproven attempt — a missed code, or a bare id-claim with
  no wristband behind it — is throttled: five per socket and twenty per address
  a minute. Behind the tunnel the address is the real client (from
  `cf-connecting-ip`, trusted only because the socket is on loopback), so one
  attacker cannot spend the whole room's budget.
- **Piling up placeholder claims.** A phone claims a wristband by an id, which a
  restarted relay must accept before the wristband is back. An id nothing ever
  answers is a placeholder; the sweep forgets it after forty-five seconds, and
  the band table has a hard ceiling that evicts the deadest record first and
  never a live wristband.
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

Each fix is a test in `tests/server.test.js`, and each was mutation-checked —
break the guard and exactly its test goes red. A dropped wristband keeps its
letters through a wifi blip on purpose (so the code under a typing finger does
not change), which is the one deliberate change to a wristband's own lifetime.

One further guard is on the phone, not the relay. A `/pair/<code>` link is a
bearer link: a hostile QR anywhere would otherwise bind an attacker's wristband
to whoever opened it, so their wrist would show the victim's coarse state and
meeting number. A code from the address no longer pairs on its own — it lands on
the pair screen pre-filled and waits for an explicit tap. The in-app scanner,
where the camera was deliberately pointed at a wristband, still pairs on sight.
This is client-side, so it is verified in a browser rather than by a relay test:
opening a `/pair/` link shows the confirm step and sends no pairing frame until
the button is pressed, and the button then pairs.

The room model itself — who appears in another person's view — was read end to
end: before a mutual yes a person is only a per-viewer handle and a coarse band,
name and contact arrive only when both keep, an invisible person is absent from
everyone's lists, and a block cuts both directions and outlives leaving.

Still open here: the clip bearer links below; the fact that the pairing code is a
bearer token visible on the wristband's screen — first to type it pairs, so
a paired wristband flashes white and can be unpaired; and the firmware's https
connection, which is encrypted but does not check the relay's certificate unless
`OTB_RELAY_CA` is built in, so on a hostile network something posing as the
relay could drive what a wrist shows.

## What is not done

- **Proximity.** Wristbands pair and light, but nothing measures who is near
  whom: every person is still `in this room`. Nearness wants ESP-NOW between
  wristbands, which wants the hardware.
- **The firmware has run on one wristband, not yet on Wi-Fi.** Its logic has
  run against the real relay (above), and CI builds the ESP32 firmware with
  PlatformIO on every push — about 1.2 MB of the 3 MB app partition — and
  keeps the image to flash. On a StickS3 the screen, the button, the battery
  and the console have been seen working. Joining Wi-Fi, reaching the relay
  and pairing from a real phone are the next check. CI does not build the
  StickS3 env.
- **The scanner has read a code through Chrome's fake camera, not a phone's.**
  Headless Chrome played a picture of a wristband's code as its camera; the
  app's scanner read it through jsQR and paired, and a stranger's code was
  turned away. A real camera against a real screen, and Chrome on Android's own
  detector, are the next check.
- **Clip links are bearer links.** Anyone holding a clip's address can load
  it for its hour, including someone who has since been blocked. The address
  is 96 random bits and only ever shown inside a room.
- **Reports go to a log**, not to a person.
- **Recording has run on Chrome's fake camera, not a phone's.** Headless
  Chrome with a fake camera recorded five seconds through the app's own
  MediaRecorder path and sent it; a second phone found it on the floor and
  loaded a valid WebM (148 KB). A real phone camera — and Safari's MP4
  recorder — is the next check.
