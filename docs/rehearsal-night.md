# Rehearsal night — the run-sheet

Everything in *What is not done* (docs/not-done.md) that is waiting on a person: a
hand on a button, an ear, an eye, a phone that is not Chrome's fake camera, a
room that is not a desk. This sheet puts those checks in the order they happen
on the day, with what to do, what counts as a pass, and where the answer is
written. `docs/show-night.md` is the runbook for a real show — the carry list,
the health checks, what a restart costs; this is the one-off that comes before
the first of those.

**Who and what.** The owner and at least two helpers; phones of both kinds, an
iPhone and an Android, because most steps differ between them; the two real
bands (a StickS3 and a StickC Plus) with their cables and a wall charger; the
laptop with this repository. **Two bands is a limit.** A marker is a band told
`marker bar`, so the walk (step 6) and the two-wearer steps (11 to 17) take
turns, and step 16 cannot be settled with two at all.

**How a step ends.**
- *Pass*: replace the "not yet" claim in the bullet in docs/not-done.md named under *Then*
  with the date and what was seen, in the bullet's own style: numbers, not
  adjectives.
- *Fail*: write down exactly what happened — the console line, the face, the
  number, which phone — before touching anything. Fix it, then repeat the step.
- *Not tried*: leave the bullet as it is. A step that did not happen that night
  stays owed; it is not quietly dropped.

Step 4 is the only deploy here, and it is the owner's call, between nights.

## Before the day

### 1. Preflight the relay

`npm run preflight` — read-only, about two seconds. It opens the app and
`/staff`, reads the show list, joins a throwaway venue and leaves it, tries a
socket from another site's page, and reads the certificate the way a
wristband does. `npm run preflight -- http://localhost:8790` checks another
relay; `-- --json` prints the result alone.

- **Passes when** it says `READY`. Notes are not failures: until step 3's
  switch is turned it notes that the app is under its framing rule only, and
  until step 4 is done that the shows are the four that ship with the relay.
- A fail names what to look at first. A certificate no band trusts means the
  bands need a reflash (`firmware/src/relay_roots.h` holds the roots).
- It cannot see the machine count, a band, or a staff phone; it prints those
  as the part that is still a person's.
- **Then** run it again from the venue's network (step 5) and once more just
  before doors.

### 2. The StickS3 meets the relay's Origin check

Since 29 Sep 2026 the relay turns away a socket from another site's page; a
band's library sends `Origin: file://`, which it lets in. The StickC Plus has
been through that on the live relay. The StickS3 has not: it has not been on
the relay since.

- **Do**: plug it in and type `show` at its console, on a Wi-Fi it knows.
- **Passes when** it says `relay https://on-the-beat.fly.dev (on it)`.
- A silent console most likely means it is not running the band firmware:
  flash it from `firmware/` (docs/wristband.md, *The wristband's firmware*), then `show`
  again. If it runs the firmware and still will not reach the relay, read the
  console's reason before anything else; the Origin check is the first thing
  to rule out.
- **Then** nothing to record unless it fails.

### 3. The phone app's policy, on an iPhone

The app's Content-Security-Policy is on main and proven in headless Chrome and
headless WebKit, but the live app still runs under the framing rule alone, and
`fly.toml` holds it there (`APP_CSP = "framing-only"`), so a deploy does not
wait on this try; the try is what turns the policy on. The open question is
how Safari on a real iPhone reads `connect-src 'self' ws: wss:`. That can be
tried **without a deploy**: `npm start` serves the policy already (a relay with
no `APP_CSP` serves it in full), and `npm run tunnel` gives the iPhone an https
address for it. Wait for cloudflared's `Registered tunnel connection` line and
a minute or two before a phone looks the address up.

- **Do**: on the laptop, `npm run preflight -- http://localhost:8790` should
  show the app policy line as `ok`. Then, in Safari on an iPhone at the
  tunnel's address: finish the first-run walk, join a venue, open the pair
  screen and `SCAN IT INSTEAD` (it asks for the camera), record a LET'S DANCE!
  clip and play it, then open the app once more with the phone in airplane
  mode.
- **Passes when** all of that works and nothing is refused: the lettering is
  the designed face and not a plain fallback (the fonts, which are the page's own files), the app gets people
  into its lists (the socket), the scanner shows the camera, the clip plays
  (`blob:` media), and the shell opens offline. An iPhone has no console here,
  so what is refused shows only as one of those failing.
- If Safari refuses anything, write down which feature failed and amend
  `APP_POLICY` in `relay/server.js` with a test before any deploy.
- **Then** turn it on: delete the `APP_CSP` line in `fly.toml` (or write
  `"full"`), change the test in `tests/deploy.test.js` that pins it, run the
  suite, and deploy (step 4). Record the try in the docs/not-done.md bullet *The phone
  app's Content-Security-Policy is written and locally proven, not yet live*,
  in *Abuse resistance* (*Framing, referrers, injected script* ends on the
  policy waiting for an iPhone), and in
  `docs/superpowers/specs/2026-09-30-app-csp-design.md`.

### 4. Deploy main, then the venue's shows and passcode

The owner's call, between nights: `npm run image-check` first (it rehearses
the image build without Docker and fails on a mistake a deploy would only show
once it had started), then `flyctl deploy --ha=false --remote-only`
ships everything on main since the last deploy (docs/running.md): the shows
override, the relay's own load lines, the pages' own fonts, and the app's
policy only once `fly.toml` no longer holds it back (step 3). The override
changes nothing until a file is on the volume.

- **Do**, after the deploy: put the rehearsal venue's real list at
  `/data/shows.json` and restart (*Changing tonight's shows* in
  `docs/show-night.md`); make the venue's line with `npm run staff-code`, set
  `STAFF_CODES` and restart (docs/staff-page.md).
- **Passes when** `https://on-the-beat.fly.dev/api/shows` lists the venue, the
  log says `shows: N from /data/shows.json`, the start of the log says
  `app policy: the framing rule only (APP_CSP=framing-only)` (or `full`, once
  step 3 has turned it on), and `npm run preflight` reads `READY` with no
  notes beyond the app's policy.
- **Write down the start line.** `flyctl logs -a on-the-beat --no-tail` has
  `load: node v…, heap limit N MB on a machine with M MB`. On 1 Oct 2026 it
  read `node v24.21.0, heap limit 259 MB on a machine with 207 MB`; a line
  that differs means the machine or the image changed under you
  (`docs/show-night.md`, *Reading the relay's own load*).
- The passcode goes to the team on paper. It is never typed into a chat, a
  commit or this repository.

## At the venue, before doors

### 5. Preflight again, from the venue's network

Run `npm run preflight` on the venue's own Wi-Fi, not a phone's data, then the
rest of *Before doors* in `docs/show-night.md`: `flyctl machine list -a
on-the-beat` shows exactly one machine, started.

### 6. The venue walk

One band is a marker (`marker bar`, `marker stage` or `marker back` at its
console, on a wall charger where it will stand on the night); the other is
carried. This is the check docs/not-done.md asks for in *Markers have met two bands,
not a room*.

- **Do**: with PlatformIO's python (the one with pyserial), on the walking
  band's console port (`COM9` below is only an example):
  `C:\Users\<you>\.platformio\penv\Scripts\python.exe scripts\venue-walk.py COM9 10 --out walks`.
  Walk the room, and at each spot type its name (`at the bar`, `by the door`,
  `under the balcony`). `quit` ends it early.
- **Passes when**, on the page it writes, the marker's curve clears the -56
  dBm line where its crowd will stand, and is under the -60 line where it
  should not name anyone. If it does not, move the marker first; if the room
  still disagrees, the venue wants another floor (`MARK_FLOOR` in
  `relay/room.js`, a code change and a deploy).
- **Then** record the readings and the spots in *Markers have met two bands,
  not a room*. When the walk is done, `marker off` at the marker's console
  turns it back into a wristband.

### 7. Both bands on the venue's Wi-Fi

`ssid`, `pass`, then `show`: both say `(on it)`. Write down which Wi-Fi
channel the venue's access points use. A band hears only bands on its own
channel, so a venue with access points on several splits its WHO'S NEAR lists
into groups (markers beacon on every channel and are immune).

### 8. Staff devices, and a test report

At least one Android and, if there is one to hand, an iPhone. An iPhone needs
the page added to the Home Screen first (Share, then Add to Home Screen, iOS
16.4 or later) and the page opened from there.

- **Do**: each device signs in at `/staff` with the venue's passcode and taps
  NOTIFY THIS DEVICE. Close the page and lock the screen. From a guest phone,
  send a report about someone (it asks for a few words, optional).
- **Passes when** every staff device shows a notification, within a minute
  and on the venue's own network with no VPN, reading *New report · <venue>*
  and *N open — tap to see them* and naming nobody; a tap opens the list
  already signed in, and HANDLED on one device dims the report on the others.
  Write down how late each one was.
- Mark every test report HANDLED afterwards. They go at 06:00 on their own.
- **Then** *The staff page has not met a venue*: say which phones, which
  network, how late. The iPhone case has never run, so it needs its own line.

## Doors

### 9. Pairing, by every way in, on real phones

Each phone pairs a band the way its person would. The flow has to finish
inside the minute the letters live.

- **Do**, once each: type the four letters; `SCAN IT INSTEAD` on the iPhone in
  Safari; `SCAN IT INSTEAD` on the Android in Chrome (it uses the browser's own
  detector there); point the phone's own camera at the band's code with the app
  never opened.
- **Passes when** each way ends at the same check: the band shows a two-digit
  number, the phone asks *Does your wristband show N?*, the numbers match, and
  `YES` makes the band flash white once. The scans should read from about an
  arm's length in the room's light, on the first or second try. Note the
  phone, the light and the number of tries for each.
- **Watch** the first few people the helpers hand a band to: do they compare
  the number with their wrist before pressing `YES`? A decoy code stuck on a
  band is stopped only by that look, so a person who taps through it is the
  finding.
- **Then** *The scanner has read a code through Chrome's fake camera, not a
  phone's*.

### 10. Recording, on real phone cameras

- **Do**: on the iPhone (Safari) and on the Android (Chrome), arm LET'S DANCE!
  and record the five seconds. On the other phone of each pair, find the clip
  on the floor and play it.
- **Passes when** a clip recorded on each kind of phone plays on both kinds.
  Safari records MP4 and Chrome records WebM, so the cross-play is the point:
  write down the size of each clip and any phone that could not play the
  other's.
- **Then** *Recording has run on Chrome's fake camera, not a phone's*.

## The show

Two people each wear one of the two bands, paired to their own phones, the
bands' sound on, both on SAY HI. The venue's music plays at its show level for
steps 11 to 15: steps 13 and 14 are about whether a wrist can be heard and
read in it.

### 11. Waves, by hand

- **Do**: A waves at B from the phone. On B's wrist, press the face button,
  then hold the side button.
- **Passes when**, in order: B's band plays `hello` and shows blue three times
  (seen by eye, with no key touched); a face press opens `SOMEONE WAVED` over
  `HOLD SIDE: WAVE BACK`; the side hold waves back; both wrists show the same
  `MEET` number and play the jingle in the same second; both phones show the
  match. Repeat with the two roles swapped, and once with a helper's phone (no
  band) also waving at B so that two wait (`2 WAITING - HOLD SIDE`).
- **Then** *Waves have run on the real bands from their consoles, not yet by
  hand*.

### 12. Found each other, by hand

With a `MEET` number on both wrists:

- **Do**: A holds the side button on the meeting face (`HOLD SIDE: FOUND`).
  Then B does the same. On another meeting, say it on a phone with `WE FOUND
  EACH OTHER` instead.
- **Passes when** after A alone, A's wrist reads `FOUND: WAITING` and B sees
  nothing new, on the wrist or the phone; after both, both numbers go, both
  bands play the `found` chirp and flash the meeting's colour three times, and
  both phones say *you found each other at* the same time.
- **Then** *Found each other has run on the real bands from their consoles,
  not yet by hand*.

### 13. Reactions, by ear and eye

Run each with the music on. The buttons are the wearer's; a helper writes down
what was missed.

- **Do**: every key press (a tick each); a choice from the side button that
  lands (`SET`, a rising chirp and the card's colour twice); one that is
  refused or sent out of reach (`NOT SENT`, low, orange twice); one the phone
  overtakes by moving the card while the wrist is still choosing (`CHANGED`,
  falling, red three times); the pairing check (two notes, two white flashes);
  TEST THE LIGHT on the phone with SOUND on and off; a wave and a match as in
  step 11; a warning, such as a band carried out of reach for ten seconds.
- **Passes when** the wearer says which thing happened from the sound and the
  light alone, without looking at the phone, and every word on the faces
  is whole on the screen: the pairing letters, `ON YOUR PHONE?` under the
  check number, `SOMEONE WAVED` and `HOLD SIDE: WAVE BACK`, `3 WAITING - HOLD
  SIDE`, `HOLD SIDE: FOUND`, `FOUND: WAITING`, `MARKER` and its area words,
  `OPEN YOUR PHONE`.
- Write down every sound that was not heard over the room, and say which
  band: the StickC Plus's buzzer is loud only from about 2.8 to 4.7 kHz, and
  `up`'s first two notes were still faint. Whether the Plus is too shrill is
  an ear's call, and so is every colour.
- **Then** *The reactions have run on both real bands, but nobody has listened
  yet*.

### 14. The wrist: faces, buttons, timings

- **Do**: wear both bands for the length of the show, the StickS3 on the
  left, as the owner does, and the Plus on whichever wrist its wearer chooses
  (on a Plus, a press of the power button turns the face to the other side).
  Press the Plus's face button by hand.
- **Passes when** each face reads at a glance on the wrist with no twisting of
  the arm, and the Plus's face button does what *The wristband* says. For each
  of the timings, the wearer says whether it feels right: six seconds awake
  (`WAKE_MS`), a 1.5 s hold (`HOLD_MS`), 3 s before a chosen card is
  sent (`COMMIT_MS`), ten seconds waiting for the relay (`CONFIRM_MS`). All
  are named constants in `firmware/src/band_logic.h`.
- **Then** *The band never turns itself, and the StickS3 turns only from a
  laptop* and *The timings are guesses until worn*. A timing that feels wrong
  is a changed constant, a test, and a reflash.

### 15. A phone gone, a band holding its person

A band keeps its person in the room for up to an hour after a phone of theirs
was last heard. The only run so far kept the phone's socket open throughout.

- **Do**: B closes the app and puts the phone in airplane mode, and leaves
  the band on. Ten minutes later, A waves at B from the phone.
- **Passes when** B's wrist calls, B answers from the wrist, both wrists show
  `MEET` with the same number, and when B's phone comes back it shows the
  match.
- **Then** *The firmware has run on two wristbands, for one day*.

### 16. Who is near — what two bands can show

*Who is near has not met a crowd.* The list is the five heard most strongly,
and with one other band heard there is nothing to rank, so this step cannot be
settled with two bands: it needs enough people, several times as many bands as
there are in a five. What two can show is how strong each is to the other over
a real floor.

- **Do**: run the walk of step 6 again, with the second band worn by someone
  who stays put instead of standing as a marker. It records band-to-band
  strength against the same spots, as the first run recorded the marker's.
- **Then** add the readings to the bullet, and say plainly that the ranking of
  a crowd is still only modelled. Whether to borrow or buy more bands for a
  crowd test is the owner's call.

### 17. Battery for a night

- **Do**: start both bands from full on their own cells, with no cable; at the
  start and again at the end, type `show` and write down the battery and, on
  the Plus, the mA it says.
- **Passes when** both bands are still on and `(on it)` when the show ends,
  and neither has warned at 15%. A warning is a failure with an hour to write
  down, not a surprise.
- **Then** *The firmware has run on two wristbands, for one day* (the battery
  half).

## After

### 18. A restart with people in the room (optional, the owner's call)

`docs/show-night.md` says a restart takes about 5 to 60 s and the night
carries on: rooms, cards, matches and sign-ins stay, bands go back to their
people by themselves, phones reconnect on the next look, and the clips and any
pairing waiting for `YES` are lost. That has been shown with stand-ins and the
two bands, not with a room of people.

- **Do**: with the wearers mid-show, `flyctl machine restart -a on-the-beat`.
- **Passes when** nobody has to pair again, no match is lost, and the staff
  devices are still signed in.

### 19. Close the night

- Write each result into its bullet in docs/not-done.md, in the style the bullets already
  have.
- Read the night's `load:` lines (`flyctl logs -a on-the-beat --no-tail`) and
  write down the most people on at once, the worst loop lag, and the most heap
  and rss against their limits, and whether any line read `cpu` stuck near 6%
  beside a loop lag of seconds (the shared CPU's quota, `docs/show-night.md`,
  *The Fly machine's CPU is a quota*). They are the first figures from the
  machine itself, whatever the crowd was; the capacity bullet in docs/not-done.md says
  what they are next to.
- Collect the bands; `marker off` on any marker; charge everything.
- The night file goes by itself at 06:00 venue time. Run `npm run preflight`
  the next day to see the relay as it is when nobody is in the room.

## What this night cannot settle

- **How many people one machine holds.** A rehearsal's crowd is small. The
  number to plan a door around, about 100 a venue, still comes from the laptop
  rig (`docs/show-night.md`, *How many people fit*); the relay's own `load:`
  lines show what a small crowd costs on the real machine, and say how far the
  heap and memory limits are from the laptop's. Nor will a handful of people
  spend the CPU quota's burst balance: a keen room of 100 takes about an hour
  to.
- **A crowd's WHO'S NEAR** (step 16): two bands cannot rank anything.
- **The beat.** Flashing on the music's beat waits on its own gate with the
  real bands, outside any show: `docs/superpowers/plans/2026-09-27-wrist-beat.md`.
- **Turning the StickS3 over from the wrist**, offered and not taken up, **and
  saying *found* with a bump**, a later change after a spike.
