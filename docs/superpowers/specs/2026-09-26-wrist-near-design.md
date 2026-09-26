# Near: who is near you comes from the wristbands

Date: 26 Sep 2026. Decided with the owner section by section the same day,
after a spike on both real bands and a model of a crowd. It builds on the
wristband revision of the canvas (revision 6, §3 "Nearness comes from the
wristbands") and on the waves spec (`2026-09-25-wrist-waves-design.md`),
whose SAY HI list and waves it narrows.

Revision 6 has two parts: wristbands hear each other, which says who is near
you; and wristbands the venue leaves at the bar and by the stage, which say
`near the bar` or `by the stage`. The owner chose the first alone for this
round, the markers for the next. Of three ways to say who is near, he chose
the relay deciding the five nearest from what the bands report.

## What is true today

Checked on 26 Sep 2026, in the code:

- **Everyone on SAY HI is on everyone's list.** `blue(id)` in
  `relay/room.js` is every person in the room showing blue whom the viewer
  may see (not blocked, not NOT NOW); the phone's S5 lists all of them, and
  the wristband's call counts the waves among them (`wavesAt()`).
- **Every person is `in this room`.** Each person has a band label, and the
  relay takes one from a phone (`{t:'band'}`), but no phone sends it: the
  label is always the default.
- **The wristbands never hear each other.** Their only radio is the Wi-Fi to
  the relay. A band's hello says `v`, `id`, `key` and, once paired,
  `secret`; its Wi-Fi MAC is the chip's own, the same every night.

## What the spike found

Throwaway firmware on both real bands (the release firmware plus ESP-NOW),
on the Y70 hotspot and the Fly relay, 26 Sep 2026:

- **ESP-NOW and the Wi-Fi get on.** Each band broadcast by ESP-NOW and read
  the other's broadcasts in promiscuous mode, which carries the RSSI that
  Arduino-ESP32 2.0's ESP-NOW receive callback does not. Both stayed on the
  Wi-Fi and on the relay throughout; of about 1,300 beacons two were lost,
  both as a setting changed, at one a second and at five, with the Wi-Fi's
  modem sleep on and off. The
  Plus's free heap never went under 62.7 KB, as without ESP-NOW.
- **RSSI follows path loss.** Stepping the S3 from 20 dBm down to 2, the
  Plus heard it fall from -9 to -33 dBm, a step at every step; the other
  direction, left at 20 dBm, did not move. Standing still, it varied under
  1 dB.
  The same pair read 7 dB apart by direction: the models differ in what
  they send and hear.
- **Listening is what costs.** The Plus's USB draw, full battery, face
  dark: 55 to 75 mA without listening, with modem sleep, beaconing or
  not; about 101 mA listening all the time, the same as with sleep off,
  since promiscuous mode keeps the radio awake. Beaconing at 6 and 24 Mbps both reached the other band.
- **A crowd, modelled** (not measured; `2.4 GHz` log-distance loss, a few
  dB for each body between two bands, fast and slow fading, calibrated to
  the bands' RSSI): in a 20 x 15 m bar everyone is within 10 m, and
  "heard at all" is the whole room, as it should be. On a 40 x 25 m floor of
  1,500 people, "heard at all" listed about 150 people to each band, 45% of
  them within 10 m; a fixed RSSI threshold did better, but how much better
  hung on the guess for body loss. **The five strongest heard were 97-100%
  within 10 m under every assumption tried.** Kept while still among the
  strongest ten, the five changed 2-16% each ten seconds instead of 21-49%.

## Goal

With wristbands on, "Saying hi near you" lists people who are near, not the
whole room: of the people wearing a wristband, the five whose bands are
heard most strongly, and never anyone the viewer could not already see.
Without one, nothing changes.

## Not in this spec

- **The markers** (`near the bar`, `by the stage`): next round, on the same
  beacons.
- **Telling models apart.** Bands of one model rank fairly; a mix ranks with
  an offset of up to several dB, as the spike showed. A per-model
  correction waits for more than one band of each model to measure.
- **Several Wi-Fi channels.** ESP-NOW works on the channel the band's Wi-Fi
  is on. Bands on different channels cannot hear each other; this spec only
  makes sure that never hides anyone, and does not hop channels to listen.
- **A night's battery.** Still not tried (README); this spec keeps the
  radio's own cost to a few mA and measures it.
- **Rooms bigger than one machine.** As today.

## Where this departs from the canvas, on purpose

- Revision 6 lists "the people whose wristband yours can hear". On a
  crowded floor that is about everyone (above). The list is the five heard
  most strongly, which is also the canvas's own limit for S5, "never more
  than five".
- The five hold only among people wearing a wristband. People without one
  cannot be heard, which says nothing about where they are, so they are
  listed as today (the owner's choice).

## §1. On the air: the wristband

All numbers are named constants in `firmware/src/band_logic.h`.

- **A new MAC at every boot.** Before the Wi-Fi starts, the band sets its
  station MAC to a random locally administered unicast address, from the
  same true noise as its key. The hello carries it: `air`, twelve hex
  digits. Nothing on the air then ties a band to the one it was the night
  before.
- **A beacon** every `BEACON_MS` (500 ms): an ESP-NOW broadcast of four
  bytes, `OTB1`, at 6 Mbps (`esp_wifi_config_espnow_rate`), so a crowd of
  bands takes a sixth of the airtime it would at 1 Mbps. It carries no
  identity: the sender's MAC is the identity. A band beacons only while it
  is on the Wi-Fi, paired, and not in NOT NOW.
- **Listening** for `LISTEN_MS` (1 s) in every `HEAR_EVERY_MS` (10 s),
  under the same conditions, in promiscuous mode, taking only frames that
  carry `OTB1`. For each sender it keeps the strongest RSSI of that second.
- **A report** after every listen: `{t:'heard', ch:<wifi channel>,
  near:[["<12 hex>", <rssi>], ...]}`, the strongest `HEARD_MAX` (12)
  first. A listen that heard nobody still reports, with `near: []`: a band
  that listened and heard nobody is evidence too.
- **Where it lives.** Keeping the samples, choosing the strongest and
  writing the frame is a small class in `band_logic.h`, so the host tests
  hold it. `main.cpp` holds only the radio: the MAC, ESP-NOW, the
  promiscuous callback and its switching on and off.
- **The console** gains `near`: what the last listen heard, and whether the
  band is beaconing and listening. Two real bands can then be tested as the
  others were.
- **The stand-in wristband** (`/band`) has no radio. It sends no `air` and
  no reports, which below means it hides nobody and is hidden from nobody.

## §2. The relay: the five nearest

- **Whose bands.** A report counts only from a paired wristband on its
  current socket. Each MAC in it counts only if it is the `air` of another
  wristband paired to a person in the same room; any other is dropped
  unread. At most one report per `HEARD_GAP_MS` (5 s) from a band, at most
  16 entries, each RSSI a whole number from -100 to 0; anything else drops
  the frame, as other malformed band frames are.
- **What is kept.** For each pair of people, the samples from either band
  hearing the other in the last `HEARD_MS` (30 s), in memory only; for each
  band, when it last reported and on which channel.
- **A pair's score** is the median of those samples, both directions
  together, so it is the same from either side.
- **The five.** Every `NEAR_TICK_MS` (5 s) the room works out, for each
  person whose band reported in the last `HEARD_MS`, their five among the
  people on SAY HI with a band and a score: last time's five stay while
  still among the ten highest scores, and the free places go to the highest
  others. People listed anyway (below: waves and matches) take no place in
  the five. `viewFor()` reads the result; it never recomputes it, so it stays
  pure. The relay pushes to a phone only when its list changed.
- **Who is hidden.** From a viewer whose band reported in the last
  `HEARD_MS`, a person on SAY HI is hidden only if all of these hold: their
  band also reported in the last `HEARD_MS`, on the same channel; they are
  not in the viewer's five; neither has waved at the other; and they have
  not matched tonight. So a band just switched on, gone quiet or on another
  channel hides nobody and is hidden from nobody, and waving back always
  works.
- **Without a band**, or with one that has not reported, the viewer's list
  is exactly as today.
- **Order and words are as today.** The list is not sorted by nearness, and
  every row still says `in this room`. No phone and no wristband is ever
  sent an RSSI, a score or a rank. The wristband's call counts waves as now,
  from the same list.

## §3. Privacy and abuse

- **Never a number, never a map** (promise 1): the RSSI stays in the relay.
  A phone learns only that someone is on its list.
- **Nearness only removes.** It can never show anyone a phone could not see
  already: someone in another room, blocked, or in NOT NOW.
- **On the air** a band says only that a band is there, as its Wi-Fi
  traffic already does, and under a MAC that is new every boot.
- **A band that lies** changes only its own person's list. Claiming to hear
  someone keeps them in its own five, someone it could see anyway without a
  band. Beaconing under another band's MAC moves that band's nearness to
  where the liar stands, into strangers' fives in the same room, and no
  further.
- **Nothing is kept**: samples live 30 s in memory, and the MAC dies with
  the boot.

## §4. Who does what

- `firmware/src/band_logic.h`: the constants; the hearing class (samples,
  strongest `HEARD_MAX`, the frame); the hello's `air`.
- `firmware/src/main.cpp`: the random MAC; ESP-NOW with its rate; the
  beacon and listen timers; the promiscuous callback; `near` on the console.
- `relay/room.js`: the pair samples, `nearTick(now)`, the five, the hiding
  rule in `blue()`; all pure, time passed in.
- `relay/server.js`: `air` from the hello; `heard` frames checked, mapped to
  people and handed to the room; the tick; pushing only changed views.
- `relay/band.js`: nothing new is shown to a band.
- `app/`: nothing. The list is shorter; the phone does not know why.

## §5. Tests and proof

- **Host (C++)**: the hearing class keeps the strongest RSSI per sender in a
  listen, orders and cuts at `HEARD_MAX`, reports an empty listen, and
  writes a frame the relay reads back; the hello carries `air` in the right
  form.
- **Room**: the five from scores; stickiness (a member stays while in the
  top ten, is replaced when not); band-less people always listed; waves
  and matches always listed; nobody hidden by or from a band that has not
  reported, has gone quiet past `HEARD_MS`, or is on another channel;
  nobody outside what `seen()` allows ever shown; no RSSI, score or rank in
  any view.
- **Server**: `heard` from an unpaired band, a stale socket, too soon, too
  long, with a bad RSSI or a bad MAC is dropped; a MAC from another room is
  not mapped; `air` in a malformed hello is refused; a view is pushed only
  when the list changed.
- **Every guard mutation-checked**: break it and exactly its test goes red.
- **The crowd model against the real room.** Synthetic reports from the
  spike's crowd model, fed through `room.js`: of each band's five, the share
  within 10 m, as in the model (97% or more).
- **The real bands**: each paired to a stand-in phone, both on SAY HI;
  `near` on each console shows the other heard; both phones list each
  other. One band told to stop beaconing: after `HEARD_MS` the other's
  phone no longer lists it, and the moment it beacons again it is back.
  Then the Plus's USB draw with this firmware against today's, face dark,
  battery full: no more than 10 mA more.

## Also to change when this is built

- README: "Proximity" under "What is not done" becomes what was built and
  what was not (markers, models, channels); the firmware and relay sections
  gain the beacon, the report and the five.

## Risks

- **Crowds are modelled, not measured.** Body loss and multipath on a real
  floor may differ; ranking is chosen because it leans on them least. A
  walk through a real venue is the check.
- **Promiscuous mode on Arduino-ESP32 2.0** is how RSSI is read at all.
  Arduino-ESP32 3 would give it in the ESP-NOW callback, but moving the
  platform is its own change.
- **Channels.** A venue with several access points on different channels
  splits its bands into groups that cannot hear each other; each group
  then keeps everyone else listed.
- **Airtime.** 300 bands at two beacons a second and 6 Mbps take a few per
  cent of the channel the venue's Wi-Fi also uses. The constants are there
  to turn down.
