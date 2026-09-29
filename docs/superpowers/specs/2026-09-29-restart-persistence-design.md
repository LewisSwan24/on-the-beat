# The night survives a restart

Date: 29 Sep 2026. Item 2 of the owner's queue of 28 Sep (「2134」), decided
with him question by question the same day: keep everything but the clips
(「除视频外全部」), in one file on a Fly volume written within a second of a
change (「A · volume + 一秒内写盘」), then the design in two rounds, both
approved as presented.

## What is true today

Checked on 29 Sep 2026, in the code:

- **The night lives in one process.** `createRelay()` holds every room, every
  wristband record and every staff sign-in in Maps. A deploy is a restart,
  and a restart empties all of it (README, *Always on*).
- **A restart undoes every block.** The phone sends `{t:'block'}` and keeps
  nothing itself (`app/App.jsx`); the block lives only in `room.js`. After a
  restart the blocked person is back in the blocker's lists, under a new
  handle, while the phone once said *they can't see you for the rest of
  tonight*. Promise 4 does not survive a deploy.
- **A restart empties the staff page.** Tonight's reports and their handled
  marks go; so do the sign-ins, so the page's token (re-sent from
  `sessionStorage` on every socket open) is answered `expired` and staff must
  type the passcode again. Every `P-` tag changes, since `staffKey` is drawn
  at start.
- **A restart forgets every match.** The relay no longer has the number, the
  spot, either side's keep or found; a keep after it reaches nobody. The phone
  still lists who it met, from its own `localStorage`.
- **Everyone comes back unarmed.** On every join the phone re-says what it is
  (`app/lib/net.js`, `SAID_ORDER`), but only as facts marked `again`, which
  `fromPhone()` applies only when they are news and they hide the person
  (rule 3). A card that was on is off after a restart. Waves, likes and dance
  backs not yet returned are gone, and every handle changes (a room's `salt`
  is drawn when the room is made).
- **What already comes back.** A paired wristband says hello with its secret,
  waits (`OPEN YOUR PHONE`) and is claimed again by its phone's secret; the
  name, NOT NOW and pick are re-said by the phone.
- **The image.** `fly.toml` has no `[mounts]`; the Dockerfile's last stage
  runs `USER node`; `relay/server.js` handles no signal, so Fly's SIGINT on a
  deploy ends Node at once.

## Goal

A deploy or a restart in the middle of a night changes nothing anyone can
see, except the clips on the floor: people stay in their rooms with the same
card, handles, blocks, matches and yeses; staff stay signed in with tonight's
reports and the same tags; a wristband goes straight back to its person.
Nothing is kept past the night that memory would not hold, and nothing kept
lets anyone act as someone else.

## Not in this spec

- **Clips.** Up to 96 MB of video, an hour each; re-recording is five seconds.
- **What bands hear.** Near and marker readings live 30 s and never leave
  memory (README, *How it is built*). They are heard again within seconds.
- **A second machine, or any store off the machine** (object storage was
  offered and not taken).
- **Old nights.** Nothing here is for looking back: a file from another night
  is deleted unread.
- **The phone, the staff page and the firmware.** None of them changes.

## §1. What the file holds

One JSON file, `NIGHT_FILE` (on Fly `/data/night.json`), version 1:

```
{ v: 1, at, staffKey,
  rooms:  [{ key, room: <room.dump()>, heard: [[id, ms]], sound: [[id, bool]] }],
  bands:  [{ id, old, key, person, secretHash, everWs, live, goneAt, claimedAt,
             waiting, waitingAt, quiet, battery }],
  gone:   [[bandId, ms]],
  tokens: [[tokenHash, { key, night }]] }
```

- `at` is when it was written, which is when the night last changed (§2), on
  the relay's clock. `staffKey` (hex) keeps every `P-` tag the same all night.
- **A room's dump** (`relay/room.js`): `salt` (so every handle stays the
  same), `people` (each person as held, with `clip: null`), `blocks`,
  `waves`, `latest`, `likes`, `dances` (the keys only: the yes stays, its clip
  does not), `matches`, `tombs`, `reports`, `nextReport`, `nextMatch`. Plain
  arrays and objects; no Map or Set is written.
- **Not written:** clips and every clip ref, what bands heard (`samples`,
  `listening`, `fives`, `marked`), sockets, grace timers, pairing attempt
  counters (`tries`), `clipKey`, and any wristband record with neither a
  person nor `waiting` — so no letters and no pairing waiting for YES.
- `live` marks a wristband whose socket was open when the file was written;
  it is written as a flag, not a time, so a worn band does not change the file
  every second.

## §2. Writing, stopping, reading

- **Every second** the relay works out the night's text, everything but
  `at`; if it differs from the text it last wrote, it writes the file with
  `at` set to now: to `NIGHT_FILE.tmp` (mode 0600), fsynced, then renamed over
  `NIGHT_FILE`. So `at` is when the night last changed, an idle relay writes
  nothing, and a write cut short leaves the last whole file.
- **When the night holds nothing** — no room, no wristband record §1 would
  write, no staff sign-in — the file is removed instead of written. `gone`
  alone keeps no file: with no room there is nobody to claim a forgotten band.
- **A write that fails** (`EACCES`, `ENOSPC`, …) is logged once, by its code,
  and tried again the next second; the relay runs on in memory. Success after
  a failure is logged once.
- **On SIGINT or SIGTERM** (Fly sends SIGINT on a deploy or a restart, and
  allows 5 s) the relay writes the night before it closes any socket, logs
  `night: written on stop`, closes, and exits within 3 s whatever the sockets
  do.
- **At start**, before the server listens, the relay reads the file:
  - none: `night: none at <path>`;
  - `v` is not 1, or it does not parse, or restoring it throws:
    `night: unreadable (<error name>), discarded`;
  - `nightOf(at)` is not `nightOf(now)` at the venue: `night: from another
    night, discarded`;
  - otherwise it is restored: `night: carried on from <path> — N rooms,
    N people, N wristbands, N staff sign-ins`.
  A discarded file is removed, and the relay starts empty, as today. It never
  refuses to start over the file. Restoring builds everything first and only
  then takes it, so a file that fails half way leaves nothing behind. Logs
  carry counts only, never a name, a handle or an id.
- **After restoring**, no socket is open: every person in every room starts
  the usual grace (`graceMs`, two minutes) from the moment the relay started.
  A phone reconnects in seconds and stops it, as does a wristband's hello; a
  person nobody comes back for leaves when it runs out, as after any drop. A
  wristband written `live` counts as gone from the moment the relay started;
  the rest keep their `goneAt`. The band-alone hour keeps counting from
  `heard`, which is carried.
- **Without `NIGHT_FILE`** (local `npm start`, the tests that do not ask for
  it) nothing is read or written: `night: in memory only`.
- **Format.** A build that changes the file so version 1 cannot be read bumps
  `v`; its first start discards the old file, and that one night starts over,
  as every deploy does today. A new field read with a default needs no bump.

## §3. What people see across a restart

- **The phone.** Its person is still in the room with the same card, rev,
  handles, matches and blocks. What it re-says on joining is not news to the
  relay and changes nothing (rule 3); what it queued while out lands as usual.
- **The wristband.** Its hello with its secret reaches its own record: no
  `OPEN YOUR PHONE`, no claim needed. The `waiting` path stays for a relay
  that lost its file.
- **The staff page.** Its token signs it back in; tonight's reports, their
  handled marks and every tag are as they were.
- **Still lost:** clips on the floor (a dance back already sent still counts
  as a yes), a pairing waiting for YES (the band shows new letters; type them
  again), letters on an unpaired band, and whatever changed in the last second
  before a process that is killed without warning.
- **The first deploy of this** still empties the relay: the process it
  replaces writes no file.

## §4. Nothing kept lets anyone act as someone else

Three things the relay holds are enough, as they are held today, to act as
someone: a phone's id (a `join` with it is that person), a wristband's secret
(a claim with it takes the band), a staff token (a sign-in with it opens a
venue's reports). From this spec on, the relay holds each only as its SHA-256,
in memory as in the file:

- **Person ids.** `join` validates `me` as now, then uses
  `personOf(me)` — the first 32 hex digits of its SHA-256 — as the person
  everywhere inside the relay: the room, the band's `person`, `heard`,
  `sound`, tickets and tags. The phone's own id never leaves the phone except
  in its `join`. Handles and tags are worked out from the new ids, so they
  change once, at the deploy that brings this in.
- **Wristband secrets.** `secretHash` replaces `secret` on the band record.
  The secret is drawn at YES and sent once, in `paired`, to the band and the
  phone; every hello and every claim is compared by its hash. A `waiting`
  record and a placeholder keep the hash of the secret they were given.
- **Staff tokens.** `tokens` is keyed by the token's hash; the page keeps the
  token itself, as now.

So the file, read by anyone, signs nobody in, takes no band and joins no
room. It still holds names, contacts and a reporter's words: it is as private
as the relay's memory, and anyone who can read the volume can read the
process too. Two rules keep it from outliving the night: a file from another
night is deleted unread, and the file is removed once the night holds
nothing. Fly's daily volume snapshots are turned off, so no copy is kept on
Fly's side; the volume is encrypted at rest, Fly's default.

## §5. The code

- **`relay/room.js`.** `dump()` returns §1's room data. `createRoom({ restore })`
  fills the room from it, `salt` included; `spots` still come from the
  show. A restored person keeps their rev, and a restored tomb its rev, so a
  person made again never reuses one.
- **`relay/store.js`, new.** The file and nothing else: `openNight(path)`
  returns `{ read(), write(text), remove() }`. `read()` is the text or null;
  `write()` is §2's tmp, fsync and rename; `remove()` ignores a file already
  gone. It knows nothing of rooms.
- **`relay/server.js`.**
  - `createRelay({ nightFile })`, `process.env.NIGHT_FILE` by default.
  - `dumpNight()` and `restoreNight(saved)` inside it, over its own Maps.
  - A one-second timer that writes when the text changed; `close()` writes
    before it closes a socket.
  - `save()` exposed for tests: true if it wrote or removed the file.
  - `personOf()` exported, for the relay and the tests.
  - The command line handles SIGINT and SIGTERM (§2).
- **`fly.toml`.** `[env] NIGHT_FILE = "/data/night.json"`, and
  `[mounts] source = "night"`, `destination = "/data"`,
  `scheduled_snapshots = false`.
- **`Dockerfile`.** Fly mounts the volume owned by root, and the relay runs as
  `node`. The last stage starts as root only to give `/data` to `node`, then
  runs the relay as `node` through `setpriv`, with `exec` so Fly's signal
  reaches Node itself. A build step runs the same `setpriv` call, so a missing
  or refused `setpriv` fails the build, never the machine.

## §6. Fly: the volume and the switch

With his OK, once, between nights and not during a demo:

1. `flyctl volumes create night -r syd -s 1 --scheduled-snapshots=false`
   (1 GB, US$0.15 a month; the flag's syntax checked with `--help` first).
2. `flyctl deploy --ha=false --remote-only`. Read in flyctl's source on
   29 Sep: when fly.toml gains `[mounts]`, deploy destroys the machine that has
   no volume and launches its replacement on the unattached volume named
   `night` in its region — no error, and a group with mounts is never given a
   second machine. With no such volume it stops before touching anything.
3. `flyctl machine list` shows one machine, `flyctl volumes list` one volume
   attached to it, `flyctl volumes show` no scheduled snapshots, and the log
   `night: none at /data/night.json`.

From then on a deploy restarts the one machine on the same volume. A second
machine would need a second volume, which makes "exactly one" harder to break
by accident. If the host's drive fails, the machine cannot start elsewhere:
create a new volume in `syd` and deploy, and the night starts empty
(README, *Always on*).

## §7. Tests and proof

Test first, as every round here.

- **`tests/room.test.js`.** A room with every kind of state — cards and NOT
  NOW, a profile and a pick, a block, waves, likes, a match kept and found by
  both, a report handled, someone who left — through `dump()`, `JSON`, and
  `createRoom({ restore })`: every person's `viewFor()` and `wavesAt()` are
  equal, and so are `staffReports()` with one `tagOf`; the next match and the
  next report take the next ids; a returning person's rev goes on from their
  tomb. A room with a floor clip and a dance back: after restoring, neither
  clip is shown, and a dance back from the other side still makes the match.
- **`tests/store.test.js`, new.** A write replaces the file whole and leaves
  no `.tmp`; a stale `.tmp` is written over; reading a missing file is null;
  removing a missing file does not throw.
- **`tests/server.test.js`**, a restart being `close()` and a new relay on
  the same file:
  - a block still hides both from each other after both rejoin;
  - a match keeps its id and number, and a keep by both after the restart
    shares the contacts;
  - a card on SAY HI is still on for the others, with no arm re-sent;
  - a paired wristband's hello with its secret is shown its person at once,
    with no `OPEN YOUR PHONE`, and a wrong secret is still refused;
  - a staff token from before signs in after, and the reports, handled marks
    and tags are the same;
  - a file from another night, a file that does not parse and a file of
    another version are each removed, and the relay starts empty;
  - a second `save()` with nothing changed does not write;
  - once everyone has left and the grace has run, the file is gone;
  - a person nobody comes back for leaves when the grace runs out;
  - the file's text holds no phone id, no wristband secret and no staff token
    as sent over the socket;
  - a join with the same `me` lands on the same person, and the room holds
    `personOf(me)`, never `me` (the three tests that ask the room for `me`
    ask for `personOf(me)`).
- **Mutations**, as the project checks its guards: drop the night check, the
  hash in a claim, or the blocks from `dump()`, and exactly its test goes red.
- **SIGINT** cannot be sent to a child process on Windows: the stop path is
  proved on Fly, by `night: written on stop` in the deploy's log and by the
  next start's `night: carried on`.
- **Live**, after the switch, in a throwaway venue: a Node script as two
  phones and a stand-in wristband (its own key, never a real band) blocks,
  matches and pairs; `flyctl machine restart`; then the block holds, the match
  is there and the stand-in's hello is paired at once. Nothing touches his
  bands.

## Also to change when this is built

- README: *Always on* (a deploy no longer empties the night; the volume; one
  machine and one volume; a failed drive), *How it is built* (memory and the
  file), *The staff page* (reports and sign-ins carry across a restart), *The
  wristband* (after a restart it goes straight back; the waiting path is for a
  lost file), *What is not done* (its first bullet).
- The header of `relay/room.js` ("when the relay stops it is gone"), the
  header of `app/lib/net.js` ("The relay forgets everything when it
  restarts"), and the comment at the top of `fly.toml`.

## Amended while planning

Seven changes, made while writing
`docs/superpowers/plans/2026-09-29-restart-persistence.md`:

1. **Test files.** The restart tests are a file of their own,
   `tests/restart.test.js`, not part of `tests/server.test.js`. A new
   `tests/deploy.test.js` reads `fly.toml` and the `Dockerfile` for §5's
   settings, which no other test can see and which fail quietly on the machine.
2. **No default from the environment.** `createRelay({ nightFile })` has none:
   the command line passes `NIGHT_FILE`, as it passes `NIGHT_TZ`, so a
   `NIGHT_FILE` left in a developer's shell never reaches a test's relay.
   `saveEveryMs` (1000) lets a test slow the timer, so its own `save()` calls
   are the only writes.
3. **`save()` answers a word**, not true or false: `'off'`, `'same'`,
   `'written'`, `'removed'` or `'failed'`, so the stop path can say which.
4. **Command-line logs.** `night: in memory only` when `NIGHT_FILE` is unset;
   on a stop, `night: written on stop`, `night: nothing to keep on stop` or
   `night: not written on stop`.
5. **`PORT=0` means any free port**, as it does to Node, instead of the default
   8790, so a test can start the command line beside a relay on 8790. That
   test sends SIGINT, which Windows cannot send a child process: it runs on
   Linux, in CI, as well as the proof on Fly (§7).
6. **A damaged room dump is refused.** `createRoom({ restore })` throws when
   `nextReport` or `nextMatch` is not an integer, so such a file is discarded
   rather than restored into a room that would number its next match `mNaN`.
7. **`setpriv` by name.** `--reuid=node --regid=node --init-groups`, and the
   build proves it with `id -un`. Checked on 29 Sep 2026: `setpriv` is
   `/usr/bin/setpriv` in Debian's `util-linux`, and `node:24`'s slim image is
   `debian:trixie-slim`, where `node` is uid 1000.

## Amended after the deploy

One change, from the live log on 29 Sep 2026:

8. **`'removed'` also answers an empty night whose file is already gone.** With
   nobody in it, a relay's first save removed a file that was not there and
   answered `'removed'`, but every later one answered `'same'`, so a stop logged
   `night: written on stop` where no file existed, and the next start logged
   `night: none at …`. `'same'` now means the file holds the night as it
   stands; an empty night has no file, so it is `'removed'` however often it is
   asked. `tests/restart.test.js` holds it for the relay object, and on Linux
   for the command line's stop.

## Risks

- **A drive failure takes the relay down** until a new volume is made and a
  deploy lands on it; before the volume, a deploy alone would have placed the
  machine anywhere.
- **A wristband worn past 06:00 keeps its venue's room**, in memory and so in
  the file, until it is switched off: `gcRoom()` keeps a room while a worn band
  is paired there. That is the relay's behaviour today, and this spec does not
  change it; it only means "the file is removed once the night holds nothing"
  can wait for that band.
- **A removed file's blocks stay on the disk** until they are written over.
  The volume is encrypted, so only Fly's side could read them.
- **Windows may hold a file a moment** (a scanner), so a rename in the local
  tests could fail with `EPERM`. Fly and CI are Linux. `write()` gets a short
  retry only if that is seen, not before.
- **A busy night writes every second.** Each phone's ping moves `heard`, so a
  full room rewrites the file every second; the text is bounded by the same
  caps as memory, a few hundred kB for a full venue.
