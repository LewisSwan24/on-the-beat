# Running it

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

**CI.** Every push to `main` and every pull request (`.github/workflows/ci.yml`):
actionlint over the workflows; `npm test` on Node 22 and on Node 24, the
Dockerfile's; `npm audit` over the relay's runtime dependencies, failing on
high or critical; `npm run image-check`, then the real Dockerfile built and
its relay started as Fly starts it — `/data` root-owned, the relay checked to
run as `node` with `/data` handed to it — and `npm run preflight` against it;
and the wristband's firmware for both envs with PlatformIO. Each run keeps the
firmware as a download: each env's `firmware.bin`, and one image each that
flashes whole at `0x0`, bootloader and partition table included —
`otb-wristband-full.bin` for the M5StickC Plus, `otb-wristband-s3-full.bin`
for the StickS3. Nothing in CI deploys; that is the Deploy workflow, below.

**A release.** Push a tag (`git tag v0.2.0 && git push origin v0.2.0`): the
same checks run, and only when every one passes, a GitHub Release is made with
the four firmware files (the apps renamed `otb-wristband-app.bin` and
`otb-wristband-s3-app.bin`) and their `SHA256SUMS`.

**Code scanning and updates.** CodeQL (`.github/workflows/codeql.yml`) reads
the JavaScript and the workflows on every push, pull request and weekly;
findings are under the Security tab. Dependabot (`.github/dependabot.yml`)
opens one grouped pull request a week for npm and one for the actions; CI runs
on each and none merges by itself.

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

**Or from GitHub** (`.github/workflows/deploy.yml`): Actions → Deploy → Run
workflow, on `main` or a `v*` tag. It never runs on a push — a deploy
restarts the one machine, so a person picks the moment. It refuses a commit CI
has not passed, waits for the `production` environment's reviewer to approve,
runs the same `flyctl deploy --ha=false --remote-only`, then checks there is
still exactly one machine and runs `npm run preflight` against the live
address. To go back, run it on the last good tag or commit. Set up once, by
hand: Settings → Environments → `production`, with yourself as required
reviewer, deployment limited to `main` and tags `v*`, and the environment
secret `FLY_API_TOKEN` from `flyctl tokens create deploy -a on-the-beat`. Until
the reviewer is set, the workflow refuses to deploy at all.

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
  The clips on the floor come back too, each kept as a file in
  `/data/night-clips/` while it is within its hour; a pairing waiting for YES
  does not. A match's id carries a mark of its room's own (`m3-1a2b3c4d`),
  carried with the night, so a relay that did lose its night — no file, a
  new volume — never hands out an id a phone already holds for someone else.
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
