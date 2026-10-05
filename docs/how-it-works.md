# How it works

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
   decline is Block — and "Not this one" on a match is a decline, which asks
   *Block them for tonight?* first, since it cannot be taken back. It is
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
    was typed, with case, accents, punctuation, `&` for `and` and a leading
    `the` let go (`app/lib/typed.js`), so "the Fortitude Music Hall" and
    "Fortitude Music Hall!" are one room and not two. `SHOWS` names a file to use instead (fly.toml sets
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
