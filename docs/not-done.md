# What is not done

- **One machine and one volume.** The relay has a fixed address,
  https://on-the-beat.fly.dev, and a restart carries the night on through a
  file on the machine's own volume, but it is still one small machine: more
  people than it holds needs more than one, and one volume means a failed
  drive takes the relay down until a new volume is made (*Always on*). Clips
  are carried across a restart as files beside the night's
  (`/data/night-clips/`, one a clip, gone with the clip at its hour, 40 MB
  at most together); a clip still being written when the machine stops is
  lost, and anything left in the folder that no clip uses is cleared at the
  next start. A phone that used a
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
  minute each: no cost the reading can show. On 4 Oct 2026 the same run on two
  StickC Plus bands, with stand-ins and a third phone with no band, gave the
  same: each heard the other on channel 11 at -35 to -37 dBm, both told to
  listen without beaconing hid each other 25 s later while the phone with no
  band kept both, both beaconing again brought them back in 8 s, and one band
  with near off for 50 s, its beacon count standing still, hid nobody. A crowd
  is still only modelled.
  Bodies and reflections on a real floor may differ from the model; ranking
  the strongest was chosen because it leans on them least, and a walk
  through a venue is the check.
  Not built: a correction between models, though a StickS3 heard a Plus 7 dB
  weaker than the Plus heard it; and more than one Wi-Fi channel, since a
  band hears only bands on its own channel, so a venue whose access points
  use several splits its bands into groups, each of which keeps the others
  listed. Markers do not have this problem: they beacon on every channel.
  Three ways round it are drafted in
  `docs/superpowers/specs/2026-10-04-near-channels-design.md`: the runbook
  asks the venue for one channel for the bands, and since 4 Oct 2026 a band
  can be held to one with `channel <n>` at its console (built, and
  run on the StickC Plus against its hotspot: off the Wi-Fi when held to a
  channel the hotspot is not on, joined when held to its own; two access
  points of one name on two channels still untried).
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
  failed — but its socket stayed open all the while. On 4 Oct 2026 the
  phone was truly gone: the StickC Plus, paired through the Fly relay to a
  stand-in on SAY HI, had that phone's tab closed outright, and a second
  person with no band, watching from the same venue, still saw them on SAY
  HI three minutes later, past the two-minute grace. From the wrist alone,
  FIRST SONG? took them off that list and SAY HI put them back under the same
  handle; a face hold hid them and a press onto a card then a side hold
  showed them again. The band-alone hour itself was not waited out. The
  phone, opened again, found the card the wrist had chosen. After a relay restart
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
  needs the other person's pick, which the wrist never shows. On 4 Oct 2026
  two StickC Plus bands did it again from their consoles with SOUND on: a
  phone's wave gave the other band `hello` and `1 waiting`, `press face` and
  `hold side` waved back, and `MEET 96` came to both bands and both phones in
  the same second, with the jingle on both.
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
  need someone there. On 4 Oct 2026 two StickC Plus bands, SOUND on, said it
  from their consoles after `MEET 96`: the first `hold side` on each did
  nothing but answer the meeting's call (a fresh MEET calls until a key is
  pressed, and that key only answers), so found took a second hold on each.
  One said found and showed `FOUND: WAITING` while the other's phone showed
  nothing; the other's gave both bands `hi (found 96)` and the `found` sound
  in their logs, and both phones one found time. Whether a wearer will hold
  twice, or think the first hold said it, is for someone wearing one to
  tell. Saying it by bumping two wristbands together, with the
  motion sensor, is a later change, after a spike shows a fist bump can be
  told apart from two people dancing to the same beat.
- **The timings are guesses until worn** — six seconds awake, 1.5 s holds,
  three to send, ten to wait. They are named constants for that reason.
- **Recording has run on Chrome's fake camera, not a phone's.** Headless
  Chrome with a fake camera recorded five seconds through the app's own
  MediaRecorder path and sent it; a second phone found it on the floor and
  loaded a valid WebM (148 KB). A real phone camera — and Safari's MP4
  recorder — is the next check.
