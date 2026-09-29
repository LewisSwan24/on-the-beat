# Show night — the operator's runbook

One page for the night itself: what to carry, what to set before doors, how to
read the room while it runs, and what to do when something misbehaves. It
assumes the relay at **https://on-the-beat.fly.dev** (one Fly machine in
Sydney, one volume carrying the night) and wristbands flashed from this
repository's `firmware/`. The product's own manual is the README; this is the
short version for a dark room and a long night.

## Carry

- Every wristband going out, each with its USB-C cable, plus two spares.
- One band per marker area you want named (`near the bar`, `by the stage`,
  `out the back`) — markers are bands told `marker bar|stage|back` — and a
  **wall charger** for each: a marker on a laptop's USB switches off with the
  laptop.
- A laptop with this repository (the bands' console needs it: `pio device
  monitor` from `firmware/`), a power bank for the bands between sets, and
  the venue's Wi-Fi name and password written down.
- The staff passcode for the venue's page, on paper, given only to the team
  (see *Before doors*).

## Before doors

1. **Relay health, from the venue's network** (not a phone's data):
   - `https://on-the-beat.fly.dev/` opens, and `/staff` opens.
   - `flyctl machine list -a on-the-beat` shows exactly **one** machine,
     started. (flyctl may not be on PATH; on this laptop it lives under
     `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Fly-io.flyctl_*`.)
   - A band on USB says `relay https://on-the-beat.fly.dev (on it)` in its
     console `show`. If it says anything else, the Wi-Fi or the relay is the
     problem, and the console says which.
2. **Staff page**: the venue's passcode line must already be in the relay's
   `STAFF_CODES` secret and deployed — `npm run staff-code` makes the line,
   `flyctl secrets import --stage` + `flyctl deploy --ha=false --remote-only`
   sets it, between nights, never during one. A venue with no entry has no
   staff page. Each team member signs in at `/staff` and taps **NOTIFY THIS
   DEVICE** (on an iPhone: add to Home Screen first).
3. **Every band joins the venue's Wi-Fi** (console `ssid`/`pass`; kept across
   restarts) and shows `(on it)`. One caveat from the README: a band hears
   only bands on its own Wi-Fi channel, so access points spread over several
   channels split the WHO'S NEAR lists into groups. Markers beacon on every
   channel and are immune. If the venue's Wi-Fi is a phone hotspot, that is
   one channel and one group.
4. **No deploys after this point.** A deploy restarts the one machine
   (~5-60 s of downtime). It carries the night on, but nothing should ship
   mid-show: hold every `flyctl deploy` and `machine restart` until the room
   is empty or the operator says the show is over.

## How many people fit

The relay is one Node process on one small machine, and its cost grows with
the square of a venue's population: every push works out each person's own
view of everyone. Measured with `node scripts/load.mjs` — simulated phones
and paired bands speaking the real protocols (join, arm, pick, wave every
6-14 s, like, keep, ping; a band's heard report every 5 s), run locally,
never against Fly:

- **On one laptop core** (Ryzen 7 5800H, 29 Sep 2026), a keen room — every
  person waving every 6-14 s — cost ~10% of the core at 50 people, ~40% at
  100 and ~93% at 150, and pinned it at 200 and beyond: square in the
  population. A wave was seen again in under a quarter of a second up to
  150; past the pin it stretched (0.24 s at 200, 0.57 s at 300) but nobody
  was dropped and the relay refused nothing — it degrades slow, it does not
  fall over.
- **A calm room is about five times cheaper**: a wave every minute or two a
  person cost 18% of the core at 150 people and 55% at 300; at 500 it pinned
  the core too, and a wave took 3.6 s to come back.
- **Memory is the harder wall on the small machine.** The relay process was
  seen at 223 MB with 100 keen people, 278 MB at 150 and 441 MB at 500 calm
  ones — and the Fly machine holds 256 MB in total. Its shared vCPU is also
  weaker than the laptop core that pinned at 150 keen.

So: plan the door around **about 100 people a venue on the Fly machine**,
fewer if the room will be keen, and treat 150 as the laptop-relay ceiling for
one. Past a ceiling the night keeps running, only slower. The answer for a
bigger room today is a second venue id on a second relay, which nothing
automates yet (README, *What is not done*). Re-measure after any change to
`viewFor()` or the push path:
`node scripts/load.mjs --phones 50,100,150 --secs 45`, and the calm variant
with `--wave-min 60000 --wave-max 180000`.

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

## If the relay must restart mid-show

`flyctl machine restart -a on-the-beat` (or a deploy, which *Before doors*
ruled out): ~5-60 s down, then **the night carries on** — people keep their
rooms, cards, handles, blocks and matches; staff stay signed in with
tonight's reports; a wristband goes straight back to its person. Lost: the
clips on LET'S DANCE!, and any pairing still waiting for its YES. Bands
reconnect by themselves; phones reconnect on the next look. The log says
`night: carried on from /data/night.json — …` with the counts.

If the machine will not start at all and the log blames the volume, the
host's drive has failed: `flyctl volumes create night -r syd -s 1
--scheduled-snapshots=false -a on-the-beat --yes`, then deploy. The night
starts empty; staff devices turn their notifications on again at their next
sign-in.

## After

- The night ends by itself at **06:00 venue time**: reports go, staff pages
  sign out, and the night file is removed once it holds nothing.
- Collect bands and markers. `marker off` on a marker's console turns it back
  into a wristband (it restarts as one). Charge everything: nobody has run a
  band's battery to empty yet (README, *What is not done*), so treat a night
  on its own cell as unproven and keep USB handy.
- If the venue runs again tomorrow, nothing else is owed: the relay starts a
  new night on its own.
