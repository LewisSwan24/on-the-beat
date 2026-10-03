# On The Beat

Get talking to a stranger at a live gig, then get out of the way.

A phone app for one night at one venue. You arm one of three cards — **SAY HI**
(your screen turns blue: hello), **FIRST SONG?** (pick the opening track and
like other people's picks), **LET'S DANCE!** (five seconds of you dancing, on a
shared floor) — and when two people both say yes, and only then, each learns
the other's first name and where to meet. It is built from the Claude Design
canvas `On The Beat.dc.html`; the canvas is the design, this is the working
thing.

**This repository is one person's working build**, and deliberately separate
from the DECO3500 team repository (`cimi2232/DECO3500`). Nothing here is pushed
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
npm run staff-code   # one venue's staff passcode, as a line for STAFF_CODES (see The staff page)
npm run preflight    # is a relay ready for doors? read-only checks; takes another address too
npm run image-check  # before a deploy: will the Docker image build and its relay start? no Docker needed
npm run fonts        # after drawing a new icon: fetch the icon font again, cut to the icons the code draws
npm run mutate -- list.json   # break a guard and see its test go red; puts every file back and proves it byte for byte
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

Run `npm run image-check` first (about four seconds, no Docker, nothing on Fly
touched). It builds the image's two trees from the Dockerfile's own `COPY`
lines and `.dockerignore`'s own list, in a temporary folder, runs `vite build`
in the first, checks it makes the same files as the repository's own build,
starts the relay from the second (only the production dependencies, `fly.toml`'s
`[env]` and nothing else from your shell) and runs `npm run preflight`'s checks
against it. It catches what a deploy only tells you after it has started: a
folder `.dockerignore` stops letting through, a relay file that imports
something the runtime stage does not copy, a variable `fly.toml` sets that the
relay no longer reads, a `package.json` the lock file disagrees with. It cannot
see `npm ci` itself, the base image, `setpriv` or the volume's ownership.

- **Exactly one machine, and one volume.** Every room lives in the relay's
  memory, so a second machine would split phones from their wristbands.
  `--ha=false` keeps a deploy from starting two, and a machine with a volume
  is never given a second; `flyctl scale count 1` puts it back if it ever is.
- **A deploy carries the night on.** The relay writes the night to
  `/data/night.json` on the machine's volume within a second of any change,
  and once more when Fly stops it; the new process reads it back. People keep
  their rooms, cards, handles, blocks and matches; staff stay signed in with
  tonight's reports and tags; a wristband goes straight back to its person.
  The clips on the floor do not survive it, nor a pairing waiting for YES.
  The file never holds a phone's id, a wristband's secret or a staff token,
  only their SHA-256; a file from another night is removed unread, and the
  file goes once the night holds nothing. The log says `night: carried on
  from /data/night.json — …` in counts.
- **The volume.** One, made once:
  `flyctl volumes create night -r syd -s 1 --scheduled-snapshots=false`
  (1 GB, about US$0.15 a month). No snapshots: nothing of a night is kept
  past it on Fly's side. A volume is tied to one host: if that drive fails,
  the machine cannot start anywhere else — make a new volume the same way and
  deploy, and the night starts empty; staff devices turn their notifications
  on again at their next sign-in.
- **Only what the image is built from reaches the builder.** `.dockerignore`
  lets through `package.json`, `package-lock.json`, `vendor/`,
  `vite.config.js`, `app/` and `relay/`, and nothing else: never
  `firmware/src/secrets.h`. The first deploy sent 465 kB.
- `fly.toml` sets `NIGHT_TZ=Australia/Brisbane`,
  `CLIENT_IP_HEADER=fly-client-ip` (see Abuse resistance), and
  `PUSH_KEYS_FILE=/data/push-keys.json`: the keys staff devices'
  notifications are signed with, made at the first start and kept on the
  volume, so a deploy leaves every device's notifications on.
- **The phone app's policy has a switch.** `APP_CSP` is `full` (the default,
  also when unset or empty) or `framing-only`, the rule the live app has always
  run under. `fly.toml` says `framing-only`, so a deploy of main does not carry
  the app's Content-Security-Policy until an iPhone has tried it (*What is not
  done*); any other value stops the relay starting, and the first lines of its
  log say `app policy: …`. The staff page's policy is not in the switch.
- **The relay says its own load.** Its log (`flyctl logs -a on-the-beat`)
  carries `load:` lines: one at start, with the ceiling V8 puts on the
  process's heap and the memory the machine has, and one a minute while
  anyone is on it — phones, worn wristbands and staff devices counted and
  never named, then cpu, how late the event loop ran, rss and heap. An empty
  relay says nothing. `LOAD_EVERY_MS` sets the minute (0 turns it off);
  `docs/show-night.md` says how to read the lines, and `scripts/load.mjs`
  reads the same ones from the relay it starts.

**Showing it with one phone.** `node scripts/crowd.mjs [venue] [how many]`
puts a few demo people in a venue: they show blue, pick tracks, wave back at
anyone who waves, like every pick and keep every match. Every one of them has
`demo` in their name, so a match with one cannot pass for a real person. They
never dance — a clip from them would be made up. Nothing in the app starts
them.

**Running a real show night.** `docs/show-night.md` is the operator's
one-pager: what to carry, the relay health checks before doors, wristband
triage during the night, marker placement, and what a restart costs
mid-show. `npm run preflight` is the part of its *Before doors* that a
computer can see, in about two seconds and read-only: it opens the app and
the staff page, reads the shows, joins and leaves a throwaway venue, checks
that a page from another site is turned away from the socket, and reads the
relay's certificate the way a wristband does. It exits 1 if anything fails
(a note is not a failure), and never touches a pairing or a sign-in.
`docs/rehearsal-night.md` is the run-sheet for the first night with people:
every item in *What is not done* that waits on a hand, an ear, an eye or a
real phone, in the order the day runs, each with its pass line and the bullet
that records it. `node scripts/load.mjs` re-measures how many people one
machine holds — a local-only rig of simulated phones and paired bands on the
real protocols, never pointed at Fly (*What is not done* has the numbers).
`scripts/venue-walk.py` makes the venue walk data instead of impressions:
run with PlatformIO's python (the one that has pyserial), it types `near`
at the walking band's console every few seconds, records what each listen
heard — markers and other bands, in dBm — beside a line the walker types at
each spot, and draws every source's curve on one page against the two
loudnesses that name an area (-56 dBm) and hold a name (-60). `--fake` runs
the whole pipeline with generated listens and no band.

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
  The night is held in memory and, with `NIGHT_FILE` set (on Fly), written
  to that file so a restart carries it on (*Always on*, above); without it,
  stop the relay and the night is gone.
  - After a change the relay pushes each phone its own `viewFor()`, at
    most every 100 ms a room, so a burst of changes is one push. A room
    whose pushes cost more waits four times what they cost (never past 2 s),
    so pushing takes a quarter of the relay's time at most.
  - What each wristband heard of the others and of the markers is kept
    30 s, in memory, and never leaves the relay; every five seconds each
    room works out who is near whom and who is in which area, and pushes
    only the views that changed.
  - A dropped socket is not leaving: a person stays in the room for two
    minutes, so a locked screen does not cost them their place.
  - Clips are kept in memory, one on the floor per person, for an hour —
    the canvas says "it loops on the floor for an hour", and it does. Every
    room's clips together stay under 40 MB, about a hundred floor clips of
    five seconds, which is what the Fly machine's 207 MB leaves room for
    (*What is not done*, first bullet): past that the oldest go first, in
    whichever room they are.
    Each is served only to someone whose own view shows it (*Abuse
    resistance*, below).
  - Reports go to the venue's own staff page, `/staff`, live, and to its
    staff devices' notifications (The staff page, below). The log says only
    that one came.
  - `relay/push.js` is Web Push on `node:crypto` alone: the relay's own
    keys, kept in `PUSH_KEYS_FILE`; each payload sealed for one device
    (RFC 8291); and requests only to the push services' own hosts.
  - `relay/shows.json` is tonight's shows: times, quiet corners to meet at,
    and the set list. A venue nobody listed still gets a room, named by what
    was typed. `SHOWS` names a file to use instead (fly.toml sets
    `/data/shows.json`, on the volume), read at start, so the shows change
    with a restart and not a deploy (`docs/show-night.md`). A file that is
    missing or bad leaves this list, and the log says which; a bad entry is
    dropped and named, and never leaves the relay with no shows.
  - `relay/cards.js` is the cards, in order: each one's id, short name,
    hue, band words and screens. What the relay lets a person arm, the
    phone's carousel, hues and routes, and the wristband's words, colours
    and SIDE order all come from it; `firmware/src/band_logic.h` `CARDS` is
    the firmware's copy. What a card does once armed (a wave, a like, a
    dance back) is its play in `relay/room.js`: who may be sent its yes,
    what the room keeps of one, and the list a phone sees. A yes each way
    is a match, and a block takes every card's yes away, through the one
    table. `tests/cards.test.js` and `tests/firmware.test.js` hold
    everything to it, so a card added there is either complete or red:
    words idle and armed, an icon in the subset font, `--id` and `--id-g`
    in the stylesheet, its screens, its play and its own list, and the same
    table in the firmware.
- **`app/`** — React, built by Vite into `dist/`, installable as a PWA.
  - `lib/net.js`: on every join the phone says again what it is (name, armed
    card, NOT NOW, pick), because the relay may have restarted without its
    night.
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
  - `staff.html` and `staff/`: the staff page, a second page of the same
    build, served at `/staff`. It shares nothing with the app.
    `public/staff-sw.js`, its own service worker, only shows its
    notifications and opens the page from one; `public/staff.webmanifest`
    lets an iPhone add it to the Home Screen.
  - `public/sw.js`: keeps the shell so the app opens in a venue with no
    signal. It never keeps the socket, the shows, the clips or the staff
    page.
  - `fonts/`: Chewy and the icon font, files of the page's own (licences in
    `fonts/LICENSE.md`). Nothing is asked of Google, on a first visit or ever:
    a venue's network is the one thing nobody controls, and an icon is a word
    until its font is in. The icon font is cut to the icons the code draws,
    33 of them in 5.8 KB where the whole set was 324 KB. `npm run fonts`
    (`scripts/fonts.mjs`) fetches both again from Google Fonts after an icon is
    added, and `tests/fonts.test.js` fails the suite on an icon drawn that the
    font lacks, on a form of icon the scan cannot read, and on a font file that
    is not the one `fonts/fonts.json` lists. The build never inlines a font
    (`vite.config.js`: a `data:` URL is refused under `font-src 'self'`, and a
    subset of a handful of icons would be small enough to be inlined), which a
    test proves by building a tiny one with the real config.
- **`firmware/`** — the wristband itself, an M5StickC Plus or a StickS3 on a
  strap, built with PlatformIO. See The wristband's firmware, below.

## The staff page

Every report reaches the venue's own team at `/staff`
(https://on-the-beat.fly.dev/staff), within a second
(`docs/superpowers/specs/2026-09-28-staff-reports-design.md`).

- **Signing in.** Each venue has one passcode, shared by its team. The relay
  keeps only an entry made from it, scrypt with a salt of its own, in
  `STAFF_CODES`: a JSON object of venue id to entry. No passcode is in the
  repository, the shows, a log or the image. A venue with no entry has no
  staff page. A right passcode gives the tab a token until 06:00 at the
  venue, kept in that tab only, or on the device once its notifications are
  on (below), so a reconnect signs in again by itself; at 06:00 the page is
  signed out and asks for the passcode again. A token belongs to the
  passcode entry it was made under: change the venue's entry and every
  sign-in made under the old one ends at the restart that follows.
- **What staff see.** Each report's time; who it is about, as a staff-only tag
  such as `P-4F2A`, the same all night at that venue and nothing like the
  handles phones are shown, with how many times and by how many different
  people that person was reported tonight — or *Something else*; that
  person's band then and now, or that they left; the reporter's band then;
  and the reporter's own few words, if any. Never a name, a contact, a
  photo, a handle, or who reported. Open reports come first; *HANDLED* dims
  one on every screen at the venue, and *REOPEN* brings it back.
- **A new report** flashes the top of the page, counts in the tab's title,
  `(2) Staff · The Roundhouse, Camden · BRUNO MARS`, and plays two short
  notes once a tap on the page has let it make sound.
- **Notifications, with the page closed or the phone asleep**
  (`docs/superpowers/specs/2026-09-29-staff-push-design.md`). *NOTIFY THIS
  DEVICE* under the header turns them on. A notification says *New report ·
  The Roundhouse, Camden* and *2 open — tap to see them*, never who, where
  or what was said, and a tap on it opens the list. On Android it works in
  Chrome as it is; on an iPhone (iOS 16.4 or later), add the page to the
  Home Screen first (Share, then Add to Home Screen) and turn them on from
  there. A device with notifications on keeps its sign-in until 06:00, so
  the tap finds it signed in, and each sign-in after that turns them on
  again by itself. SIGN OUT reaches the relay: that sign-in, and its
  notifications, end on every tab that shared it.
- **Reports last the night.** A venue with a staff page keeps tonight's
  reports even once everyone has left, so a team that signs in later still
  sees them; at 06:00 they go. A restart or a deploy keeps them, and keeps
  every staff page signed in, unless its venue's passcode entry changed: the
  page signs back in with its token.
- **Telling everyone here.** *SEND TO EVERY PHONE* puts one line, at most
  140 characters, on every phone at the venue: a toast and a buzz, a
  `FROM THE VENUE` banner on the cards screen until that person puts it away,
  and a line on their Tonight. Only the latest stands; *TAKE DOWN* removes it.
  A new one goes at most every 20 seconds a venue, since each one reaches
  every phone there, and the page says how long to wait.
- **Moving the times.** *Show times* holds the night's five times. A row's
  −5 and +5 move it and every time after it, as a late start does; a time can
  also be typed. Nothing goes until *SAVE TIMES*, and the relay takes only five
  clock times in the night's order. Every phone's phase bar and countdown
  follow at once, with a toast saying what moved, and the venue list shows the
  moved times to anyone choosing a show. *BACK AS LISTED* undoes it. When
  two staff screens are open and one saves while the other is part way
  through a change, the other keeps its change and says so: *SAVE TIMES*
  puts it instead, *UNDO* shows what was saved.
- **Putting the first song's spelling right.** Naming the same song again,
  spelled better (`desire lines`, then `Desire Lines`), changes the words
  everywhere but not when it was named: no phone is told twice, Tonight's
  line is corrected in place, and no wristband plays it again. Another song
  is a new naming. Each panel also says aloud, for a screen reader, what
  the relay took.
- **What staff say lasts the night.** The first song, a notice and moved
  times stay with nobody in the venue yet, so times moved before doors are
  there when they open; a restart keeps them; 06:00 takes all of them back. A
  staff screen signed out at 06:00 cannot say anything more, even in the
  moment before its socket closes.

To give a venue its page, make its line and set it on the relay:

```
npm run staff-code
```

It asks for the venue's show id and a passcode of at least twelve
characters, twice, or Enter for one made for you: three groups of four
letters and digits, such as `k7m2-q9xr-4twd`, shown once in that terminal
and kept nowhere. It never shows a passcode you type, and prints one line
such as `"roundhouse-bruno-mars": "scrypt$16384$8$1$…"`. Put every venue's line
between braces, separated by commas, in a file outside the repository as
one line, `STAFF_CODES={"roundhouse-bruno-mars": "scrypt$…"}`, then:

```
flyctl secrets import --stage < staff-codes.env   # PowerShell: Get-Content staff-codes.env | flyctl secrets import --stage
flyctl deploy --ha=false --remote-only            # between nights: it restarts the one machine
```

and delete the file. A mistake in `STAFF_CODES` stops the relay starting,
with the venue named and the entry never printed. Locally,
`STAFF_CODES='{…}' npm start`; under `npm run dev` the page is
`http://localhost:5178/staff.html`.

**To sign everyone out at a venue**, or to close a passcode that has
leaked, make its line again (with the same passcode if it is to stay: the
salt is new, so the entry is), put it into `STAFF_CODES`, and set the secret
and deploy as above. The machine restarts, and every sign-in made under the
old entry ends with it: the page asks for the passcode again, and the
notifications those sign-ins held stop. The log says how many, and no venue.

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
pio device monitor      # its console: ssid, pass, relay, show, forget, press, hold, face, snap, turn, near, marker

pio run -e m5sticks3 -t upload    # the same, for a StickS3
```

Tell it the venue's Wi-Fi and the relay at the console — `relay` takes
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

## Where this differs from the canvas, on purpose

- **It asks for a first name**, once, after the venue. The canvas never asks,
  but someone has to be named when two people both say yes. A contact is
  asked for only the first time you keep someone, and only shared if they
  keep you too.
- **A contact both kept can be saved to the phone's own contacts.** The
  canvas shows it and stops there. The owner chose on 3 Oct 2026 a SAVE TO
  CONTACTS button wherever a contact both people kept is shown: on S11, in
  the AFTER list and under *kept from other nights*. The card (vCard 3.0,
  `app/lib/vcard.js`) is made on the phone from what it already holds and
  goes to the share sheet where the browser can share a file, or downloads
  otherwise; nothing is sent. A number goes in as a number, an email or a
  web address as itself, and a handle in the note with where they met.
- **FIRST SONG? gets its answer.** The canvas asks for a pick and never says
  what opened. The owner chose on 3 Oct 2026 that the venue's staff name it:
  the staff page has a *First song* panel with the night's setlist as chips,
  *NAME IT*, and *TAKE BACK* for a mistake. Every phone at the venue then
  shows `THE OPENER WAS` above its own pick, *You called it.* or *Not this
  time.*, and how many here called it, never who; the wall marks a matching
  pick `CALLED IT`, which is no more than the pick on that row already says.
  A pick matches whatever its case, accents, punctuation or spacing
  (`app/lib/opener.js`), and is held as it was when the answer came, so
  changing it afterwards calls nothing. Tonight keeps one line for it. Only a
  signed-in staff page can name it; a restart keeps it, and 06:00 takes it
  back with the night.
- **The venue can tell everyone something, and move the times.** The canvas's
  times are the show's as listed, and nothing reaches every phone at once. The
  owner chose on 3 Oct 2026 that a signed-in staff page can send a notice to
  every phone at its venue and move the night's times (see "The staff page").
  A notice is the venue's own words, the same for everyone, and says nothing
  about anyone in the room.
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
- **The check can be turned away on the wrist.** Revision 6 has no check,
  and its wristband takes no action while it pairs. The owner chose on 28 Sep
  2026 that holding the face button on the build's check number turns that
  check away, so someone who read the letters off a wrist and typed them
  first holds its check only until its person holds the button, not for a
  minute.
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
- **A marker names an area only when it is heard clearly.** Revision 6 takes
  the loudest marker. Far from every marker the loudest is still some marker,
  heard faintly across the room, so it names a band only at -56 dBm or
  louder, and otherwise the person stays `in this room`: the owner chose on
  27 Sep 2026 that it is better not to say than to say it wrong. A third
  marker, `somewhere out the back`, which the prompt's list of bands already
  has, is allowed; revision 6 names only the bar and the stage.
- **A staff page** at `/staff`, which the canvas does not have: someone has
  to read the reports the canvas says go to the venue team. The owner chose
  on 28 Sep 2026 a page per venue, signed in with a passcode only he sets.
- **Report asks for a few words**, optional and at most 200 characters. The
  canvas's Report is one tap. The owner chose on 28 Sep 2026 to ask, since
  "someone was reported near the bar" alone gives staff little to act on.
- **The band is landscape.** Revision 6 draws a portrait band with a strap
  stub above and below. The owner's watch clip holds a Stick across the
  forearm, long side along the arm, and he chose on 28 Sep 2026 that both
  bands go landscape: every face is laid out at 240 x 135, sized from the
  canvas's band turned, with the pairing code on the left and its letters
  beside it. Which side is up is held, not worked out (see the firmware
  section). The browser stand-in at `/band` stays portrait, as the canvas
  draws it.

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
  it; that the proxy also replaces one a client sends was measured on
  29 Sep 2026: six sockets that each sent a different `fly-client-ip` still
  shared one budget of twenty. Behind the tunnel it is `cf-connecting-ip`,
  trusted only because the socket is on loopback. An IPv6 client counts as
  its /64, since anyone on a network holds 2^64 addresses of it, and an
  IPv4-mapped one as the IPv4 address it wraps.
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
  twice, or from another room, counts for nobody. Each person's five comes
  from what their own band heard and nothing else, so a band that lies
  changes only its own person's list, and nearness only ever removes, so it
  can show nobody a phone could not see already. Until 28 Sep 2026 a pair was
  scored on what both bands said, so a lie moved the other person's five
  too: five made-up people on SAY HI, each with a scripted band saying it
  heard someone loudly, could fill that person's five and push everyone they
  were really near off their list. It took that person's address, which only
  a radio at the venue hears; the second review found it. A band beaconing under another's
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
- **A flood of reports.** One phone could send 1,100 reports in 71 s at
  the pace the frame budget allows, fill a venue's staff list at a thousand,
  push out a real one and make the relay send that list to staff 633 times
  (measured on 29 Sep 2026). Now a person may send ten reports an hour and
  a network sixty, counting every one sent, refused ones too; past either
  the report is refused, unlogged and unpushed, and the phone says to tell
  a member of staff. The log is still capped at a thousand a venue, but
  drops the reports the team has handled first, and a venue's reports go at
  06:00. The counts are in memory: a restart clears them
  (`tests/staff.test.js`, `tests/limits.test.js`).
- **The staff page.** A passcode is kept only as a scrypt entry, and every
  sign-in by passcode counts on the pairing counters, five a socket and
  twenty an address a minute, its scrypt run off the event loop. At most
  eight checks run at once: a ninth is refused unheard and counted against
  nobody, so a crowd of guessers cannot queue behind the four threads that
  also write the night. A passcode is at least twelve characters, or one
  the script makes. A token lasts until 06:00 at its own venue only, and
  only under the passcode entry it was made with, so a changed passcode
  ends its sign-ins at the restart. A socket is a phone, a wristband
  or staff, never two, including one that joins while its passcode is being
  checked; a staff socket can only mark reports. Staff see a person only as
  a tag of six hex digits made with a key drawn at start (kept in the night
  file, so it survives a restart), and never who reported; the relay's
  log says only which venue and which report, with anything a stranger could
  shape in a venue name replaced. What it cannot tell: someone
  with many phones can report one person from each, so `reported 5 times by
  5 people` is a lead for staff to look into, not proof.
- **A flood of venue joins.** `join` is unthrottled and each new venue is a room
  object; the room table now has a ceiling that reclaims empty venues under
  pressure and refuses a new one only when every venue is genuinely in use, and
  a socket switching venues has its orphaned rooms reclaimed as it goes.
- **A flood of messages.** Every change in a room used to push every phone
  in it a fresh view at once, and working out a view is a pass over the
  room, so one socket sending changes as fast as it could made the one
  machine do the square of the room for each, and stalled every venue on
  it. Now a room's views go out at most every 100 ms, carrying every change
  before them, and a socket has a budget of 40 frames at once, earned back
  at 20 a second. A phone or a wristband says about one every two seconds
  and a reconnect about a dozen at once; a socket past its budget is closed
  as `too fast` (4003) before its frame is read. The second review found it.
- **A venue with no ceiling.** Nothing limits how many people a venue holds:
  `join` is open, a venue's Wi-Fi puts a whole crowd behind one address (so a
  limit per address would turn real people away), and the only bound is Fly's
  2,500 connections. A room costs the square of its people, so one client
  holding a thousand sockets in one venue pins the CPU (a full round of views
  took about 4 s at 1000 people on a laptop core). **That is not fixed**, and
  the machine is not meant for it: about 100 people a venue is what the door
  is planned around (*What is not done*, first bullet). What the third review
  (1 Oct 2026, the code since 29 Sep) did fix is that the handle memo had made
  a room's memory square as well, at about 62 bytes a pair: 58 MB at 1000
  people and 151 MB at 1500, against the 207 MB the Fly machine gives its
  process, so a flood that used to stall the relay could now kill it. A
  relay's rooms now share one budget of 400,000 held pairs (about 25 MB), and a
  pair past it is worked out each time, as it was before any were held and to
  the same handle. `tests/room-handles.test.js` and
  `tests/relay-handles.test.js`.
- **A shows file typed wrong.** Tonight's shows can come from a file on the
  volume, and a show whose act is an object where text belongs would have
  blanked the app for every phone, since React cannot draw one. A show whose
  act, venue or times are not text, or whose set list or quiet corners are not
  a list of text, is dropped and named in the log, and the rest stand; only
  the `id` is required. A show with no `doors` no longer reads "doors
  undefined" on the picker.
- **Video that fills the machine.** Every room's clips together were held to
  96 MB, and nobody had measured that against the machine, because the
  capacity rig sent no clips. Once it did (1 Oct 2026, in a 207 MB Linux
  cgroup), a hundred phones posting a clip every 8-20 s took the relay to
  178 MB of memory, a store near its cap included. The store is now held to
  40 MB, and the same hundred phones read 158-161 MB with it full. The relay's
  load line says the video it holds (`clips 38.1 MB`), so a night's log shows
  the store. One socket could still send clips as fast as its frame budget
  let any message through (40 at once, 20 a second, each up to 1.2 MB: 24 MB
  a second to parse, decode and push), though the store itself could not pass
  its cap. Since 2 Oct 2026 a frame of 64 KB or more, which nothing but a
  clip comes near, is charged as it arrives, before it is parsed, to a
  budget of its own: three at once, then one more every 3 s. One
  over is answered `clip too fast` (the phone says so) and is neither read
  nor kept, and the socket stays open. A phone records five seconds a clip,
  so it never meets the limit; a clip under 64 KB, about a second of video,
  is outside it and costs what a pick does. The budget is per socket, as the
  frame budget is. `tests/server.test.js` holds the cap and the budget, with
  `tests/relay-load.test.js` for the figure in the load line.
- **A socket that changes who it is.** A socket that had joined could join
  again as someone else, or at another venue, and the person it had stood
  for stayed in the room with no phone, no grace and no wristband, for as
  long as anyone else was there: one socket could leave any number of people
  behind, each still on SAY HI if they had been. Now a new join leaves as
  whoever the socket stood for, at once, unless another phone or a live
  wristband of theirs still holds them. The app opens a new socket for each
  venue and each night, so it never did this; a client of one's own could.
- **MIME confusion.** Every served response — the app, a built asset, a clip,
  the shows feed — carries `X-Content-Type-Options: nosniff`, so a browser
  takes the declared type and never guesses one.
- **Framing, referrers, injected script.** Every response says
  `Referrer-Policy: no-referrer`, and over https `Strict-Transport-Security`
  for a year (Fly's proxy says which; not for subdomains, no preload).
  Every page says `X-Frame-Options: DENY` and `frame-ancestors 'none'`, so no
  other site can frame it and steal a tap. The staff page also carries a
  full Content-Security-Policy: its own scripts, styles, fonts, worker,
  manifest and socket, nothing inline, no plugin, no `<base>`, no form posted
  elsewhere. It has no inline script or style to allow, and
  headless Chrome signs in and lists under it with nothing in the console.
  The phone app carries one of the same shape (`APP_POLICY`,
  `docs/superpowers/specs/2026-09-30-app-csp-design.md`), written against
  what the built app actually loads and one line wider: `media-src 'self'
  blob:`, since a recorded five seconds plays from a blob URL the phone made
  itself and the floor's clips play from `/clip/`. The camera needs no
  allowance in any policy. Headless Chrome walked the app under it — join a
  show, a socket round trip, a blob in a `<video>` — with no refusal in the
  console, and headless WebKit, the engine family Safari reads
  `connect-src` with, opened it with an empty console and a socket join
  answered. The live machine still serves the framing rule only, and
  `fly.toml` holds it there (`APP_CSP = "framing-only"`) until Safari's
  reading of `connect-src` has been tried on a real iPhone
  (*What is not done*).
- **Other sites' pages driving the socket.** The socket used to open for
  any page's script, so a page a stranger made could send every visitor's
  browser to the relay, to report, join or try a passcode, from the
  visitors' own addresses and outside the per-address counters. Now a
  handshake with an `Origin` is refused (403, before a socket exists)
  unless it is this site's own host, `file://` (what the wristband's
  library sends) or the dev server on loopback. A tool that sets no
  `Origin` is let through, as it always was: the limits above are for it
  (`tests/origin.test.js`, `tests/server.test.js`).
- **A clip's address in the wrong hands.** A clip's address used to open it
  for anyone holding it, for its hour, a blocked person included. Now each
  viewer is sent an address of their own — the clip's 96-bit ref and a ticket
  the relay makes, from a key it draws when it starts, for that clip and that
  viewer — and the relay serves it only while that viewer's own view shows the
  clip: not once either of them has blocked the other, while its owner is NOT
  NOW, or after the viewer has left. A browser must ask again before it plays a
  clip again (`no-cache`, with an ETag), and a refusal is the same 404 as a
  clip that never was. A copy already on someone's phone stays theirs, as a
  screenshot would.
- **Something posing as the relay.** A wristband's `https` connection used to
  be encrypted without checking whose certificate it was shown, so on a hostile
  network something posing as the relay could drive what a wrist shows. Now
  the band checks the certificate against four roots built into its firmware
  (`firmware/src/relay_roots.h`): ISRG Root X1 and X2, which the Fly relay's
  RSA and ECDSA chains end in, and GTS Root R1 and R4, which a Cloudflare
  tunnel's do. A relay chaining to none of them is refused. On 28 Sep 2026
  each of those four chains, as the two addresses served them, verified
  against these roots, and `tests/relay-roots.test.js` holds each root's
  fingerprint and that the band never opens `https` unchecked. Both real
  bands, flashed with it that day, reached the Fly relay and refused every
  attempt at badssl.com's self-signed, untrusted-root and wrong-host servers —
  the last showing a Let's Encrypt certificate that chains to ISRG Root X1 but
  names another host — while badssl.com itself, the same chain under its own
  name, was not refused. The price: a
  relay that moves to another certificate authority needs the bands flashed
  again, and the roots last until 2035 (X1), 2036 (R1, R4) and 2040 (X2). A
  plain `ws://` relay on the laptop's own network is still unchecked, as any
  plain connection is; which relay a band uses is set only at its console or
  when it is built.
- **A check held open by someone watching.** A wristband's letters are on
  its screen for anyone near to read. Typed first, they used to hold its
  check for a minute at a time, the owner told only that someone was pairing
  it: every attempt counted and the letters changed after each, so this
  annoyed rather than paired, but the owner could do nothing about it. Now
  holding the face button on the check turns it away (`{t:"refuse"}` with the
  number the wrist shows): the relay drops it at once, the wristband shows new
  letters, the phone that typed is told the wristband said no, and the busy
  message tells the owner to hold the button. It lands only from that
  wristband's own socket and only on the number its check still shows, so a
  hold that arrives after `YES`, or names another check, unpairs nothing.
  On 28 Sep 2026 both real bands did this through the Fly relay: a stand-in
  phone typed each band's letters, the console's `hold face` held the face
  button on the check, and within a second the phone was told the band said
  no, and the band showed new letters and played fall.
- **Malformed and hostile frames.** Non-JSON, wrong-typed fields, forged
  handles and unknown message types are all inert: a fuzz barrage of them
  leaves the relay serving and still forming rooms (`tests/server.test.js`).
- **Reading the night's file.** Whoever reads `/data/night.json` finds no
  phone's id, no wristband's secret and no staff token, only their SHA-256
  (and, beside a sign-in, a print of the passcode entry it was made under,
  from which nothing can be worked back): it signs nobody in, takes no
  wristband and joins no room. It still holds
  names, contacts and reporters' words, as the relay's memory does; it is
  written readable by its owner only, is removed once the night holds
  nothing, is never read on another night, and Fly keeps no snapshot of it
  (`tests/restart.test.js`, `tests/deploy.test.js`).
- **Staff notifications.** The relay calls a push service only at an
  address on its own hosts: `fcm.googleapis.com`,
  `android.googleapis.com`, or a name under `push.apple.com`,
  `push.services.mozilla.com` or `notify.windows.com`. The address must be
  https on 443 with no user in it. It is checked when a device hands it
  over and again before every request, the relay never follows a redirect,
  and it gives up after 10 s, so a staff sign-in cannot aim it anywhere
  else. A subscription needs a real P-256 key and a 16-byte secret. A venue
  holds at most 50 and hears at most one push each 10 s. What is sent is
  sealed for the one device (RFC 8291) and says only the venue and how many
  are open. The log counts pushes; it never holds an address or a key
  (`tests/push.test.js`, `tests/staff-push.test.js`).

Each fix is a test in `tests/server.test.js`, `tests/wristband.test.js`,
`tests/rules.test.js`, `tests/relay-roots.test.js`, `tests/restart.test.js`,
`tests/push.test.js`, `tests/staff-push.test.js` or the wrist's table of
cases (`tests/fixtures/wrist-cases.json`), and each was mutation-checked — break the guard and
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

## What is not done

- **One machine and one volume.** The relay has a fixed address,
  https://on-the-beat.fly.dev, and a restart carries the night on through a
  file on the machine's own volume, but it is still one small machine: more
  people than it holds needs more than one, and one volume means a failed
  drive takes the relay down until a new volume is made (*Always on*). Clips
  are not carried across a restart. A phone left connected past 06:00 still
  keeps its venue's room, and so last night's matches, until it closes: only
  a wristband's hold on a room ends with the night. A phone that used a
  tunnel address starts over at the fixed one: a browser keeps the app's
  storage per address.
  **How many one machine holds** was measured with `scripts/load.mjs` — a
  local-only rig that fills a venue with simulated phones and paired
  wristbands speaking the real protocols (join, arm, pick, wave, like, keep,
  ping, and a band's heard report every 5 s), never touching Fly. The relay's
  cost grows with the square of a venue's population, since every push works
  out each person's own view of everyone. On a laptop core (Ryzen 7 5800H,
  1 Oct 2026) a keen room (a wave every 6-14 s a person) took 16% of the core
  at 100 people, 34% at 150 and 78% at 200, and pinned it at 250 (89%, the
  event loop 725 ms late at p99); a calm room (a wave a minute or two each)
  is about five times cheaper. Until that day about a third of the relay's
  time went on hashing the same handles again on every push; the room now
  remembers them (the same day before: 59% at 100, 94% at 150).
  On 3 Oct 2026 the gap between a room's pushes began to follow what they
  cost (above): the same rig at 250 keen people, 30 s measured, went from
  95% of the core, loop lag p99 352 ms and a wave seen again after ~203 ms
  to 30%, 154 ms and ~380 ms, and was no longer saturated. A room of 100
  pushes as often as before. One run each, on the laptop.
  **Memory is not the wall for the people alone**: in a real 256 MB Linux
  cgroup (WSL2) Node picked a 259 MB heap limit by itself and held 250 keen
  people at 127 MB rss and 500 calm ones at 182 MB, none killed. Video is
  another matter, and that run had none: in a 207 MB cgroup a hundred phones
  each posting a 375 KB clip every 8-20 s (`--clip-kb`) read 178 MB with the
  clip store at its old 96 MB cap and 158-161 MB with the 40 MB it has now,
  and two hundred and fifty of them (a saturated relay, not a plausible
  crowd) read 232 MB and 209 MB. The cgroup killed none of them, but a Fly VM
  shares its 207 MB with everything on it, so that margin is the thin one.
  `node scripts/load.mjs --cgroup-mem 207M` repeats it, in WSL.
  **The CPU is, and on Fly it is a
  quota**: a shared-cpu-1x machine runs at 6.25% of a core (5 ms of every 80)
  once its burst balance, 500 s at most, is spent. Held to that in the
  cgroup for a minute or two, the relay still paired every band and dropped
  nobody, but its event loop ran about 0.2 s late at p99 with 50 keen people,
  about a second late with 100 and two with 150. So **about 100 people a venue
  on the Fly machine** is still the number to plan the door around, with the
  quota as its caveat: a keen room of 100 would empty a full balance in about
  an hour on these figures. `docs/show-night.md` carries the numbers, the
  arithmetic, the health checks, band triage and what a restart costs
  mid-show.
  **Every one of those figures is a laptop's, or a laptop's Linux.** Fly's
  vCPU is not that core, the cgroup ran Node 22 where Fly runs 24, and the
  rig's people are not a crowd. The relay says its own load in its log
  (*Always on*). Its start line on Fly, 1 Oct 2026, read `heap limit 259 MB on
  a machine with 207 MB`: the VM gives the process 207 of its 256 MB, so 500
  calm people (182 MB in the cgroup) would be close to the wall there, and
  100 to 250 are not. Whether the quota bites is still unseen: no night with
  people has run on it, and the lines to watch are a `cpu` stuck near 6%
  beside seconds of loop lag.
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
  marker wants a wall charger. Since 30 Sep 2026 the walk has its tool:
  `scripts/venue-walk.py`, which types `near` at the walking band's console
  every few seconds and draws what it heard — every marker and band, in dBm,
  against the -56 and -60 lines — so the walk says whether the venue wants
  another floor, and where.
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
- **The band never turns itself, and the StickS3 turns only from a laptop.**
  Landscape faces run on both real bands (28 Sep 2026): the pairing face,
  the check, READY, a card and a marker's face were snapped on both or one
  and looked at, KEEP HOLDING on the Plus only; the same face snapped on
  either side was the same frame; and the side each was set to came back
  after a restart. A band moved
  to the right wrist needs `turn usb-right`, or on a Plus a press of the power
  button; the owner wears the StickS3 on his left, the default. A press of
  both buttons at once, or a button in the phone app, would turn a StickS3
  over at a venue, and both were offered and not taken up. The first check
  typed at the StickS3 that night ended as it was answered: the band had
  reconnected, with new letters, while the relay still held its old ones.
  The two after it paired, and why it reconnected is not known.
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
  someone there. Flashing on the music's beat is a later spec.
- **The scanner has read a code through Chrome's fake camera, not a phone's.**
  Headless Chrome played a picture of a wristband's code as its camera; the
  app's scanner read it through jsQR and paired, and a stranger's code was
  turned away. A real camera against a real screen, and Chrome on Android's own
  detector, are the next check.
- **The staff page has not met a venue.** It has run on a laptop, in two
  tabs beside a phone in the same browser, and on the owner's own Android
  phone. A notification has reached Chrome on that laptop through Google's
  push service: Chrome's own records show the push received and decrypted,
  and *New report · The Roundhouse, Camden* displayed. On 30 Sep 2026, with
  `roundhouse-bruno-mars`'s passcode live on Fly, that phone signed in,
  NOTIFY THIS DEVICE turned notifications on, and the relay's log counted
  the push `1 sent, 0 gone, 0 failed`. On the owner's home network the
  locked screen stayed dark, because Google's last hop to the phone is
  blocked there; with the phone's VPN on and the staff page closed, the next
  report's notification arrived as designed. A venue's own network with no
  VPN is the check that is left, and no iPhone ever has had one. On that
  laptop's Chrome a page cannot see the notifications it shows, so an open
  staff page does not clear them there; whether it does on Android was not
  looked at. One passcode a venue is shared by its whole team; changing it,
  or making it again, is a secret set and a restart, which ends every
  sign-in made under the old one.
- **The phone app's Content-Security-Policy is written and locally proven,
  not yet live.** The staff page has run under its policy since 29 Sep 2026.
  The app's (`APP_POLICY` in `relay/server.js`, spec
  `docs/superpowers/specs/2026-09-30-app-csp-design.md`) was drafted on
  30 Sep against the built app's real inventory — its own scripts, styles,
  fonts (Google's until 1 Oct 2026, its own files since), worker, manifest and
  socket, clips as `blob:` and `/clip/` media, and no camera allowance
  needed — and headless Chrome ran the whole first-run walk under it with
  nothing refused. Headless WebKit,
  the engine family Safari reads `connect-src` with, opened the same page
  under it too, console empty, a socket join answered one frame each way;
  that narrows the Safari risk but the real-phone gate stands. Pushing it
  does not redeploy Fly, and a deploy no longer waits on it: `fly.toml` holds
  the live phone app to the framing rule only (`APP_CSP = "framing-only"`,
  read by the relay at start) until Safari's reading of
  `connect-src 'self' ws: wss:` has been tried on a real phone, which no
  iPhone has ever run. That try needs no deploy (`npm start`, `npm run
  tunnel`), and turning the policy on is deleting that line and the test that
  pins it (`docs/rehearsal-night.md`, step 3).
  **Left as they are** (staff review, 29 Sep 2026):
  `no staff page` and `wrong code` tell a guesser which venues have one; and
  scrypt's cost stays at 16 MiB a check for a 256 MB machine. A third, that a
  passcode holder could push the 1,000 oldest sign-ins out of the table by
  signing in a thousand times, and with them other venues' staff and their
  notifications, was closed on 2 Oct 2026: a venue has a share of 100 of its
  own, and a flood of sign-ins there forgets that venue's oldest and no other
  venue's (`tests/staff.test.js`). A fourth, that the staff page asked Google for its font and
  so told Google a staff device's address and browser, was closed on 1 Oct
  2026: both pages carry their fonts themselves now (*How it is built*).
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
- **The timings are guesses until worn** — six seconds awake, 1.5 s holds,
  three to send, ten to wait. They are named constants for that reason.
- **Recording has run on Chrome's fake camera, not a phone's.** Headless
  Chrome with a fake camera recorded five seconds through the app's own
  MediaRecorder path and sent it; a second phone found it on the floor and
  loaded a valid WebM (148 KB). A real phone camera — and Safari's MP4
  recorder — is the next check.

## License

The code and documents in this repository are under the MIT License (`LICENSE`).
What came from elsewhere keeps its own: the two fonts in `app/fonts/` (notices
in `app/fonts/LICENSE.md`) and the `jsqr` tarball in `vendor/` (Apache-2.0, its
own `LICENSE` is inside the tarball). The design the app is built from, the
Claude Design canvas, is not in this repository.
