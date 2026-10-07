# Show night — the operator's runbook

One page for the night itself: what to carry, what to set before doors, how to
read the room while it runs, and what to do when something misbehaves. It
assumes the relay at **https://on-the-beat.fly.dev** (one Fly machine in
Sydney, one volume carrying the night) and wristbands flashed from this
repository's `firmware/`. The product's own manual is the README and the rest of docs/; this is the
short version for a dark room and a long night. The first night with people is
a rehearsal, and `docs/rehearsal-night.md` is its run-sheet.

## Carry

- Every wristband going out, each with its USB-C cable, plus two spares.
- One band per marker area you want named (`near the bar`, `by the stage`,
  `out the back`) — markers are bands told `marker bar|stage|back` — and a
  **wall charger** for each: a marker on a laptop's USB switches off with the
  laptop.
- A laptop with this repository (the bands' console needs it: `pio device
  monitor` from `firmware/`), a power bank for the bands between sets, and
  the name and password of the venue's network for the bands (one channel:
  *Before doors*, step 3) written down.
- The staff passcode for the venue's page, on paper, given only to the team
  (see *Before doors*).

## Before doors

1. **Relay health, from the venue's network** (not a phone's data):
   - `npm run preflight` reads `READY` (about two seconds, read-only). It
     opens the app and `/staff` and checks both are under their policies,
     reads the shows, joins and leaves a throwaway venue, checks that a page
     from another site is turned away from the socket, and reads the
     certificate the way a band does. A note is not a failure; a fail names
     its check. With no laptop to hand, open `https://on-the-beat.fly.dev/`
     and `/staff` by hand.
   - `flyctl machine list -a on-the-beat` shows exactly **one** machine,
     started. (flyctl may not be on PATH; on this laptop it lives under
     `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Fly-io.flyctl_*`.)
   - A band on USB says `relay https://on-the-beat.fly.dev (on it)` in its
     console `show`. If it says anything else, the Wi-Fi or the relay is the
     problem, and the console says which.
   - `flyctl logs -a on-the-beat --no-tail` holds the relay's `load: node …`
     line from its last start: the heap limit and the memory it has. Not a
     pass or a fail, a number to know (*Reading the relay's own load*).
2. **Staff page**: the venue's passcode line must already be in the relay's
   `STAFF_CODES` secret and deployed — `npm run staff-code` makes the line,
   `flyctl secrets import --stage` + `flyctl deploy --ha=false --remote-only`
   sets it, between nights, never during one. A venue with no entry has no
   staff page. Each team member signs in at `/staff` and taps **NOTIFY THIS
   DEVICE** (on an iPhone: add to Home Screen first).
3. **Every band joins the venue's Wi-Fi** (console `ssid`/`pass`, or from a
   phone: both buttons held as it starts, docs/wristband.md "Its Wi-Fi, from a
   phone"; kept across restarts) and shows `(on it)`. A save from a phone drops
   the band's `channel` pin, so pin the channel after it, not before. A band hears only bands on its own Wi-Fi
   channel, so access points spread over several channels split the bands
   into groups that never hear each other, and each keeps everyone in the
   other groups listed: on three channels WHO'S NEAR stops shortening the
   list for about two thirds of the room. Nobody is hidden by it; near just
   stops working. So:
   - **Ask the venue, days before, for a network for the bands on one
     channel**: an SSID of their own on one channel, an access point of
     their own for the night, or every point on one channel. The bands need
     little bandwidth (a report every 10 s, a view on change). A phone
     hotspot is one channel already.
   - **Check it at doors**: on each band's console, `near` says `last listen
     … channel N`. Every band should say the same N. Two numbers mean two
     groups: move the odd ones to the bands' network, or note it in the
     night's log.
   - Markers beacon on every channel and need nothing here. Three ways round
     a venue that cannot give one channel are drafted in
     `docs/superpowers/specs/2026-10-04-near-channels-design.md`.
4. **Tonight's cards**, on the staff page: close any card the night has no
   room for, before doors rather than during them. LET'S DANCE! wants floor
   space and a crowd that moves; a seated show or a packed floor is the
   reason to close it. FIRST SONG? wants a headliner whose opener staff can
   name when it starts; with nobody to name it, close it. SAY HI suits every
   room. At least one card stays open; the page will not close the last.
   What closing does is under *During the night — closing a card*.
5. **No deploys after this point.** A deploy restarts the one machine
   (~5-60 s of downtime). It carries the night on, but nothing should ship
   mid-show: hold every `flyctl deploy` and `machine restart` until the room
   is empty or the operator says the show is over.

## Changing tonight's shows

The shows — doors and set times, quiet corners to meet at, the set list — are
`relay/shows.json`, and they ship inside the image. To change them without a
deploy, put a file of the same shape at `/data/shows.json` on the volume:
fly.toml points the relay's `SHOWS` at it. The relay reads the shows only as it
starts, so a change is a restart, and a *Before doors* job like any other
(step 5 above): never mid-show.

1. On the laptop, edit a copy of `relay/shows.json` (or fetch the one on the
   volume: `flyctl ssh sftp get /data/shows.json -a on-the-beat`, which will
   not overwrite a local file of the same name). It is a JSON list, one entry
   per show, and each needs an `id`: the venue's room, lower case with single
   spaces, as in `roundhouse-bruno-mars`. The rest is optional, but what is
   there must be the right kind: `act`, `venue`, `doors`, `support`, `break`,
   `headline` and `end` are text (`"19:00"`, in quotes), `spots` and `setlist`
   are lists of text. An entry with anything else in one of them is dropped.
2. Upload it beside the old one, then move it into place. flyctl's `put` will
   not overwrite a file that is already there, so a straight `put` works only
   the first time; the move works every time and leaves no gap:
   `flyctl ssh sftp put shows.json /data/shows.json.new -a on-the-beat`, then
   `flyctl ssh console -a on-the-beat -C "mv /data/shows.json.new /data/shows.json"`.
   (If `put` says `shows.json.new` is already there, an earlier try left it:
   `-C "rm /data/shows.json.new"`, then put again.)
3. `flyctl machine restart -a on-the-beat`. The night carries on through it
   (see *If the relay must restart mid-show*).
4. Check, every time: `https://on-the-beat.fly.dev/api/shows` lists the shows
   you meant, and `flyctl logs -a on-the-beat --no-tail` has
   `shows: N from /data/shows.json`.

A bad file never leaves the relay with no shows. A file that is missing,
unreadable, not JSON, not a list, or without one usable show leaves the list
that ships with the relay, and the log says which, by file name: `shows: no
file at /data/shows.json, using the 4 that ship with the relay`. One bad entry
among good ones is dropped and named while the rest stand: `shows: entry 2 of
/data/shows.json dropped: the id "Moth Club" should read "moth club"`, or
`shows: entry 3 of /data/shows.json dropped: "doors" must be text` for a time
written as a number (`1900`) and not as text (`"19:00"`). So when
`/api/shows` still shows the old list, read the log before anything else. To go
back to the shipped list, remove the file (`-C "rm /data/shows.json"`) and
restart.

Two things to know. A show taken out of the list does not close its room: a
venue nobody listed still gets one, named as typed, with the relay's own quiet
corners. And `npm run staff-code` checks the venue against the repository's
`relay/shows.json` only, so for a venue that exists only in `/data/shows.json`
it prints its `is not in relay/shows.json` note even though the relay does list
it; the note is harmless.

## How many people fit

The relay is one Node process on one small machine, and its cost grows with
the square of a venue's population: every push works out each person's own
view of everyone. Measured with `node scripts/load.mjs` — simulated phones
and paired bands speaking the real protocols (join, arm, pick, wave every
6-14 s, like, keep, ping; a band's heard report every 5 s), run locally,
never against Fly. A *keen* room is everyone waving every 6-14 s, a *calm*
one every minute or two. **cpu** is a share of one core, averaged over the
measured minute once everyone was on, and **lag** the event loop's p99
lateness in the worst of its windows, the figure nearest to what a person
feels (*Reading the relay's own load*, next). Each figure is one run: several
points either way between runs of the same room is ordinary (100 keen people
in the cgroup read 21% and 26%).

### On one laptop core

Ryzen 7 5800H, Node 24, Windows, 1 Oct 2026. *Before* is the relay as it
stood that morning; *after* is the same relay with the room remembering each
person's handle for each other person (`relay/room.js`) in place of hashing
every one afresh on every push:

| room | before | after |
|---|---|---|
| 100 keen | 59%, lag 212 ms | 16%, lag 29 ms |
| 150 keen | 94%, lag 427 ms | 34%, lag 49 ms |
| 200 keen | pinned (29 Sep) | 78%, lag 250 ms |
| 250 keen | 91%, lag 1345 ms | 89%, lag 725 ms |
| 500 calm | 96%, lag 3043 ms, 69 people dropped | 97%, lag 898 ms, nobody dropped |

About a third of the relay's time at 150 keen people was that hashing (a
`node --prof` profile, 1 Oct). The cost is still the square of the
population, so the memo moved the laptop core's ceiling from about 150 keen
people to about 200 and not past it: at 250 both pin the core, only the new
one answers sooner (a wave seen again after 0.3 s, not 0.8 s). A calm room is
about five times cheaper than a keen one. Past a ceiling the night keeps
running, only slower: the one time anybody was dropped was the 69 at 500
calm, before the memo.

What the memo keeps is the square of the room too, about 62 bytes a pair
(measured: 15 MB at 500 people, 58 MB at 1000, 151 MB at 1500), so it is held
to a budget: a relay's rooms share 400,000 pairs, about 25 MB, and a pair past
it is worked out each time, as before the memo, to the same handle. Up to about
630 people in one room, or more rooms of fewer, the memo is whole; past it the
room costs more CPU, never more memory.

### In 256 MB of memory

This section used to say that memory was the harder wall — 223 MB at 100 keen
people, 441 MB at 500 calm ones. Those were the laptop's rss, where V8 on a
16 GB machine lets its young generation grow to 64 MB a half; with that capped
as a small machine's would be, 100 keen people held 82-86 MB and 150 held
about 100. For the real thing the relay ran inside a Linux cgroup holding 256
MB with no swap (WSL2 on this laptop, so Node 22 where Fly runs 24), its
people the rig's own, on Windows:

| room | cpu | lag | wave seen again | rss | the cgroup's own peak |
|---|---|---|---|---|---|
| 100 keen | 21% | 47 ms | 0.17 s | 100 MB | 53 MB |
| 150 keen | 58% | 142 ms | 0.11 s | 106 MB | 60 MB |
| 250 keen | 103% | 665 ms | 0.29 s | 127 MB | 84 MB |
| 100 calm | 8% | 37 ms | | 101 MB | 53 MB |
| 500 calm | 110% | 1495 ms | 0.47 s | 182 MB | 151 MB |

Node picked a heap limit of 259 MB there by itself, as large as the machine,
so on a full machine the kernel's out-of-memory killer would come before V8's
own limit; nothing was killed, up to 500 calm people, and nobody dropped. The
Fly machine itself has since said how much it really gives: its start line on
1 Oct 2026 read `heap limit 259 MB on a machine with 207 MB`, so a `256mb`
machine is 207 MB to the process, and V8's limit sits above it just as in the
cgroup. Against 207 MB, 100 or 150 keen people (100-106 MB rss) and 250 keen
(127 MB) leave plenty; 500 calm people, at 182 MB in the cgroup, would leave
about 25 MB and have not been tried on Fly. By these runs, **at the 100 or so
people a venue is planned for, memory is not what limits it; the CPU is** —
with one thing those runs left out, which is video.

**Clips are memory too.** The runs above sent none, and the relay keeps every
clip on the floor, up to an hour, in memory. The rig can post them
(`--clip-kb 375`, a real five seconds at 600 kbit/s; `--clip-min` and
`--clip-max` set the gap between a phone's clips in ms, 8 to 20 s by default):
each phone posts a floor clip of its own, or a dance back to someone on the
floor it has not yet danced back to. In a 207 MB cgroup with the CPU free, a
hundred phones doing that read:

| clip store's cap | relay rss | cgroup's own peak | the store itself |
|---|---|---|---|
| 96 MB (what it was) | 178 MB | 134 MB | not full |
| 40 MB (what it is) | 158-161 MB | 110-113 MB | 38.1 MB, full |

and two hundred and fifty (a saturated relay, cpu 111% and the loop 1.3 s
late, so not a crowd to plan for) read 232 MB against 209 MB, nobody killed
in either. Under the 40 MB cap a hundred floor clips fit, the venue the door is
planned for, and the oldest go first past that. A Fly VM shares its 207 MB with
everything else on it where the cgroup holds only the relay, so these margins
(46 MB at a hundred, thin at two hundred and fifty) are the ones to watch:
the load line says the video held (`clips`, below), and a relay that sits near
its cap with an rss past 170 MB wants the cap lowered or the machine made
bigger, not another look during the show. `ALL_CLIPS_MAX` in `relay/server.js`.

### The Fly machine's CPU is a quota

A `shared-cpu-1x` machine is not a core. Fly's documentation (docs.fly.io,
*CPU performance*, read 1 Oct 2026) gives it a baseline of 6.25% of one — 5
ms of every 80 — and lets it run above that while a *burst balance* lasts: 5
s on a new machine, 500 s at most, filled by time spent under the baseline
and spent by time over it. A machine whose balance is empty is held to the
baseline, and `fly_instance_cpu_throttle` is Fly's metric for that time. A
performance CPU gets the whole 80 ms of every 80.

The arithmetic, on the figures above (a laptop's, and Fly's vCPU is the
weaker, so read it as the optimistic case): a venue that takes a share *u* of
a core empties a full balance in 500 s ÷ (*u* − 0.0625). 100 keen people at
the 21% the Linux run read: about 56 minutes. 150 keen at 58%: about 16. 100
calm at 8%: about 8 hours. 50 keen, at about 5%: never. A relay with nobody
on it earns 6.25 s of balance every 100 s, so two idle hours nearly fill it.

What a held relay does was run, not guessed: the same relay in the cgroup
with its CPU cut to 5 ms of every 80 (`cpu.max`), a minute or two of each
room, two or three runs of each. Every band paired and nobody was dropped, in
every run, but the loop ran late:

| room, held to the baseline | cpu | lag, worst window | wave seen again |
|---|---|---|---|
| 50 keen | 5% | 0.15-0.18 s | 0.27-0.42 s |
| 75 keen | 6% | 0.5-0.95 s | 0.42-0.46 s |
| 100 keen | 6% | 0.9-1.8 s | 0.67-0.79 s |
| 150 keen | 6% | 2.0-2.6 s | 1.3-1.4 s |
| 100 calm | 6% | 1.1-1.35 s | 0.73-0.74 s |

Free of the cap a wave came back in 0.11-0.17 s. The lag of one window is
noisy (a held loop stalls for 75 ms at a time, and one big push spans many
stalls), hence the ranges. A held relay also takes its people in slowly: the
rig joins them in half a second, and 100 took about 30 s to be on, which a
real queue at the door would spread out. So a venue the quota holds is slow,
not broken, and slower the bigger and keener it is. In the relay's own lines
it reads as **`cpu` stuck at about 6% beside a loop lag of seconds**: a relay
that has run out of *core* reads 90-110% beside its lag, and one that has run
out of *quota* cannot spend more than the baseline, so it reads low and late
at once.

### So

Plan the door around **about 100 people a venue on the Fly machine**. At that
size nobody was dropped on any measure here, and a keen 100 stays quick until
the burst balance is gone — about an hour on the figures above — then runs
about a second late for as long as the room stays that keen. A calm 100 or a
keen 50 does not run out in a night. The answer for a bigger or keener room is
a machine with a performance CPU for that night (`[[vm]]` in `fly.toml`; a
cost and a deploy, so a decision first) or a second venue id on a second
relay, which nothing automates yet (docs/not-done.md). Fly's page
gives a new machine 5 s of balance and says nothing of what a restart does to
it, so leave a couple of hours between a deploy and doors until that is known.

Re-measure after any change to `viewFor()` or the push path:
`node scripts/load.mjs --phones 50,100,150 --secs 45`, and the calm variant
with `--wave-min 60000 --wave-max 180000`. `LOAD_RELAY_ARGS` hands node flags
to the relay the rig starts, never to its phones, to try a smaller machine's
limits (`LOAD_RELAY_ARGS="--max-old-space-size=96 --max-semi-space-size=8"`);
the stage's line says which flags it ran with.

The Linux figures came from a relay inside a Linux cgroup, and since 1 Oct 2026
the rig does that itself: `node scripts/load.mjs --cgroup-mem 207M --phones
100` runs the relay in a cgroup in the WSL distro (`--wsl-distro`, `Ubuntu` by
default) with that much memory, no swap, and `--cgroup-cpu baseline` (Fly's
share, 5 ms of every 80, the default) or `free` (no quota); the phones stay on
Windows, as before. The stage then also says what the kernel counted: the
cgroup's own peak, any kill for memory (a killed relay makes the stage
`SATURATED` and its exit code 137), how often the memory limit was reached and
in what share of periods the CPU quota held the relay. Its cpu and rss come
from the relay's own `load:` lines, since Windows cannot sample a process in
WSL. `scripts/cgroup-host.mjs` is the code, and `OTB_WSL=1 npm test` runs
the tests that need the real distro. **Starting a stopped WSL distro starts
whatever it starts with it** (on this laptop, the owner's own gateway), so
`wsl.exe --terminate Ubuntu` when the runs are done. Node in the cgroup reads
its limit: 207M gave `heap limit 259 MB`, as on Fly. The cgroup counts the
relay's own memory and the page cache it makes, where `rss` (the load line)
also counts file pages Node shares with others, so read both.

Every figure above is a laptop's, or a laptop's Linux; the relay now says its
own, in its log, so the Fly machine's can stand beside them — the next
section.

## Reading the relay's own load

The relay writes `load:` lines to its log (`flyctl logs -a on-the-beat
--no-tail`, or without `--no-tail` to watch). One at start:

    load: node v24.15.0, heap limit 4288 MB on a machine with 16236 MB

That is the ceiling V8 puts on the process's heap, and the memory the machine
has. The 4,288 MB above is the laptop's. Node 22 inside a 256 MB Linux cgroup
chose `heap limit 259 MB` (its `machine with` figure was the host's own, 7869
MB, which is not read from a cgroup). On Fly, the first deploy that carried
this line (1 Oct 2026, Node 24.21) printed
`load: node v24.21.0, heap limit 259 MB on a machine with 207 MB`: the same
heap limit as the cgroup, and a VM that gives the process 207 MB of its 256.
Then one a minute (five
seconds in the rig), but only while someone is on it (a phone, a worn
wristband or a staff device — an empty relay says nothing). A room of 100 keen
people in that cgroup, and the same room with its CPU held to Fly's baseline:

    load: 100 phones, 10 bands, 0 staff in 1 venue | cpu 26% | loop lag p99 35 ms, max 47 ms | rss 99 MB, heap 14 of 259 MB, buffers 4 MB, clips 0.0 MB
    load: 100 phones, 10 bands, 0 staff in 1 venue | cpu 6% | loop lag p99 871 ms, max 871 ms | rss 101 MB, heap 15 of 259 MB, buffers 4 MB, clips 0.0 MB

- **Who** is counts of what is connected now: phones, wristbands that are
  connected (a band that dropped is not on it), staff devices, and the venues
  they are in. No venue name, id or address is ever in a line.
- **cpu** is a share of one core over the minute since the last line. It can
  pass 100 when a second thread works too (the garbage collector, a passcode
  check).
- **loop lag** is how late the event loop kept its own 10 ms appointment, the
  p99 and the worst of that minute. It is the closest thing to what a person
  feels, since nothing reaches a phone sooner than the loop gets to it. A
  quiet Linux machine reads 0 to 2 ms (a Windows laptop reads about 6: its
  clock ticks every 15.6 ms). Tens of ms are pushes taking their turns (about
  35 ms at 100 keen people in the 256 MB cgroup, 140 ms at 150). A loop
  hundreds of ms late beside a `cpu` of 90% or more has run out of *core*; a
  loop a second late beside a `cpu` stuck near 6%, as in the second line
  above, has run out of *quota*, and is held rather than busy (*The Fly
  machine's CPU is a quota*).
- **rss** is what the machine holds for the process, and **heap** is the
  JavaScript heap in use against the limit from the start line. A heap near
  its limit goes slow in long collections, and at the limit V8 stops the
  process ("heap out of memory"); the night comes back from the volume, minus
  its last second. An rss near the machine's total, 207 MB on Fly, is the
  other wall: the kernel's out-of-memory killer ends the process the same way.
- **buffers** are the memory held outside the heap: every clip, and every
  frame still being read. **clips** is the part of that which is video, the
  clip store itself, against its 40 MB cap. A night with `clips 38.1 MB` has a
  full floor, the oldest clips going as new ones arrive; `buffers` well past
  `clips` is frames in flight, which grows when the relay falls behind.

What the relay's own lines read in the keen rooms above, in the 256 MB
cgroup: at 100 people cpu 21-26% on average, loop lag p99 40-47 ms at the worst
window, heap 12-21 MB, rss 90-100 MB; at 150, cpu 58%, p99 142 ms, heap 22 MB,
rss 106 MB. Under the laptop's 4 GB limit the same rooms read higher (200 keen
people: heap 114 MB, rss 258 MB): nothing makes V8 collect there and its young
generation has room to grow, so a limit near the machine's is the comparison
for Fly. The heap is what was in use at each look, garbage included. A relay
that sits well under both its limits at the real crowd has room; one that
does not wants the heap limit or the machine looked at *before* the next
show, not during it.

The lines cost a timer every 10 ms, which the laptop read as about half a
percent of a core when idle (Windows counts cpu in 15.6 ms steps; a Linux
machine is not measured). `LOAD_EVERY_MS` changes the minute and `0` turns the
lines and the timer off; the relay reads it at start, so it is a restart.

## Doors open

- **Markers first**: plug each into its wall charger at the middle of its
  area, press it, and check the face says `MARKER` over its area. A marker
  names an area only when a band hears it at -56 dBm or louder, so a marker
  behind a fridge names nobody; expect only 12-35% of people to carry an
  area at all, and that is by design — unnamed beats named wrong. The day
  before, make the placement a number: walk the room once with
  `scripts/venue-walk.py` (PlatformIO's python) on a carried band, typing
  each spot's name as you reach it; the page it writes draws every marker's
  curve against the -56 line that names an area and the -60 line that holds
  it, so a marker that stays under -56 where its crowd will stand is in the
  wrong place, or the venue wants a lower floor.
- **Hand out bands at the door** and pair each with its person's phone: the
  phone types the four letters the band shows; the band then shows a
  two-digit check; the phone says YES **only once its own screen shows the
  same number** (a FACE hold on the band refuses a check it does not show —
  that is the defence against a stolen code). The whole flow must finish
  within 60 s or the letters die and the band shows new ones. A pair that
  worked shows `MEET` on the band when the two people match later.
- **The crowd demo** (`node scripts/crowd.mjs [venue] [how many]`) is for
  showing the app before doors, with one phone: every one of them is named
  `demo`, they wave back and keep, and they never dance. Do not run it during
  a real show — a match with one cannot pass for a real person, but it still
  wastes the room's attention.

## During the night — reading a band

The console `show` is read-only and always safe. The face says the rest:

| The band says | What it means | What to do |
| --- | --- | --- |
| `NO SIGNAL` on a press | Wi-Fi or relay out of reach for 10 s; the console says which | Walk it toward the access point; it retries every 15 s and comes back by itself. A band out of reach for 10 s stops believing its old show, so after it returns, look again before trusting the face. |
| `OPEN YOUR PHONE` | The relay restarted, or the phone left and came back; the band waits for its person | The phone claims it back with no letters (the secret is kept) — open the app once, in range. |
| Four letters | Unpaired, waiting | Pair from the phone (above). A band alone — no phone — for an hour is forgotten and shows new letters; that is by design. |
| Dark face, blue light | NOT NOW: the person went invisible from the wrist | A side hold brings them back. Invisible is instant and stays until they undo it. |
| `MEET nn` | A match, and its number | Nothing to fix — this is the night working. |
| Low battery on `show` | Charge it on USB | It charges while worn; the Plus also says its mA draw. |

Phones: a locked screen is not a leaving — the relay keeps a phone for two
minutes of silence, and a paired band holds its person for an hour. If a
list looks stale, reopening the app reconnects it; usually it reconnects by
itself first.

## During the night — closing a card

Closing a card mid-show is allowed and quick, and it is felt: *Tonight's
cards* on the staff page, **CLOSE**, then **CLOSE IT**.

- Everyone showing that card goes off at once, and their phone says why:
  "The venue closed LET'S DANCE for tonight." A phone open on one of its
  screens goes home. The home screen lays out only the open cards.
- Nobody can arm it again from a phone or a band. It lists nobody and takes
  no new wave, like or dance back; with LET'S DANCE! closed, no clip goes on
  the floor. Matches already made stay, with their numbers.
- A band flashed with firmware from 4 Oct 2026 or later steps over closed
  cards on SIDE. An
  older band still steps onto one and shows `NOT SENT`, then goes back to
  what it showed; that is the refusal, not a fault.
- **OPEN** puts it back for everyone, and anyone can arm it again. Waves,
  likes and dance backs from before it closed are still there.
- Two staff screens see each other's changes as they happen. Closing waits
  for **CLOSE IT**, and a question left open on one screen goes away when the
  other changes a card.

Closed cards last the night, a restart included, and go at 06:00 with the
rest of what staff said.

## During the night — naming the first song

When the headliner's first song starts: *First song* on the staff page, tap
the track (or type it), **NAME IT**, then **SAY IT**.

- Wait until it is recognisable. The moment **SAY IT** goes, every phone
  shows the answer and every band whose person called it plays a sound and
  flashes for a minute. **TAKE BACK** clears the answer from phones and
  bands, but cannot unplay a sound that has already gone.
- **NOT YET**, or changing the track, drops the question; nothing is sent.
- A misspelling is fine: picks match whatever their case, accents and
  punctuation, and **NAME IT INSTEAD** with a better spelling does not tell
  anyone a second time.

The answer lasts the night, a restart included, and goes at 06:00.

## If the relay must restart mid-show

`flyctl machine restart -a on-the-beat` (or a deploy, which *Before doors*
ruled out): ~5-60 s down, then **the night carries on** — people keep their
rooms, cards, handles, blocks and matches; staff stay signed in with
tonight's reports; a wristband goes straight back to its person; the clips
on LET'S DANCE! come back from `/data/night-clips/`. Lost: a clip sent in
the last moment before the stop, and any pairing still waiting for its YES. Bands
reconnect by themselves; phones reconnect on the next look. The log says
`night: carried on from /data/night.json — …` with the counts.

If the machine will not start at all and the log blames the volume, the
host's drive has failed: `flyctl volumes create night -r syd -s 1
--scheduled-snapshots=false -a on-the-beat --yes`, then deploy. The night
starts empty; staff devices turn their notifications on again at their next
sign-in.

## After

- The night ends by itself at **06:00 venue time**: reports go, every card
  is open again, staff pages sign out, and the night file is removed once it holds nothing.
- Collect bands and markers. `marker off` on a marker's console turns it back
  into a wristband (it restarts as one). Charge everything: nobody has run a
  band's battery to empty yet (docs/not-done.md), so treat a night
  on its own cell as unproven and keep USB handy.
- If the venue runs again tomorrow, nothing else is owed: the relay starts a
  new night on its own.
