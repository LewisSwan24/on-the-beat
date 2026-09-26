# Markers: near the bar, by the stage

Date: 27 Sep 2026. Decided with the owner section by section the same day,
after a model of three kinds of floor and a spike on both real bands. It is
the second part of revision 6 §3 ("Nearness comes from the wristbands"); the
first, who is near you, is `2026-09-26-wrist-near-design.md`, landed and run
on both bands the night before. This builds on its beacons, its listen and
its report.

Revision 6 says `near the bar` and `by the stage` come from a few wristbands
the venue leaves at the bar and by the stage as markers, and that yours hears
which marker is loudest: still a band, never a number, never a map. The owner
chose markers that stand alone (no Wi-Fi, no relay, no key), `in this room`
for anyone who cannot hear a marker clearly, and the relay deciding the area
from what the bands report.

## What is true today

Checked on 27 Sep 2026, in the code:

- **Every row already says an area.** `someone(band)` in `app/copy.js` makes
  `Someone near the bar` on S5, FIRST SONG?, LET'S DANCE! and a match not yet
  named; the relay keeps one per person (`BANDS` in `relay/room.js`: `in this
  room`, `near the bar`, `by the stage`, `somewhere out the back`), puts it on
  every row, keeps it on a match as it was when the match was made, and on a
  report for the venue.
- **Nothing sets it.** The relay takes an area from a phone in `join` and in
  `{t:'band'}`, but no phone sends either: everyone is `in this room`.
- **Bands hear only bands.** A band listens for `OTB1` beacons one second in
  ten and reports `{t:'heard', ch, near}`; its outgoing frame holds 320
  bytes, and a full report is 294.

## What the model and the spike found

- **The loudest marker is almost never the wrong one.** On the crowd model of
  the near spec (log-distance loss, a few dB for each body in the way, slow
  and fast fading), with a bar marker at one end of the floor and a stage
  marker at the other, a person's loudest marker, by the median of three
  listens and heard at -60 dBm or more, named a marker other than their
  nearest for nobody on a 40 x 25 m floor, whether with 750 people, 1,500, a
  third marker, or markers held above heads, and for 0.3% of people in a
  20 x 15 m bar where the two markers are 18 m apart.
- **How loud is loud enough depends on the crowd.** The risk is saying `near
  the bar` of someone who is not. Of the people a floor names near a marker,
  with the floor at -60 dBm, nine in ten are within 11 m of it in every crowd
  modelled (6.5 to 11.0 m), and the furthest 9 to 22 m; at -70 dBm the nine
  in ten reach 16 m where markers are above heads. At -55 dBm nine in ten are
  within 9 m. The price is people left unnamed: in a packed room, of those
  truly within 8 m of a marker, about half go unnamed at -60 dBm and nearly
  two thirds at -55. -60 is the floor, as the owner chose: better unnamed
  than named wrong.
- **Holding an area 4 dB longer nearly halves the flips** (at -60 dBm, from
  2-9% of listens to 1-5%) and changes the rest by a point or two.
- **A marker can hop channels.** Throwaway firmware on the Plus, joined to no
  Wi-Fi, beaconed on channels 1 to 13 in turn every 500 ms: every send
  succeeded, a sweep of 13 took 30 ms (42 at most), and the StickS3, on the
  Y70 hotspot's channel 1 and the Fly relay, heard it in every one of about
  30 listens at -17 to -19 dBm, the same as with the marker on channel 1
  alone. The release firmware went back on the Plus afterwards.

## Goal

A person whose wristband hears a marker clearly is `near the bar`, `by the
stage` or `somewhere out the back` on everyone's rows; everyone else is `in
this room`, as now. Nothing else changes on a phone.

## Not in this spec

- **Telling a real marker from a fake one.** Anyone can beacon as a marker
  (§4). Keys would only stop someone inventing one; copying a real one is as
  easy.
- **Per-venue tuning.** One floor for every venue, set in the relay.
- **A marker on the relay.** Markers are not listed, counted or shown to the
  venue anywhere.
- **Telling models apart**, as in the near spec: a StickS3 heard a Plus 7 dB
  weaker than the Plus heard it, which moves the floor for a mixed set.

## Where this departs from the canvas, on purpose

- Revision 6 names the loudest marker. Far from every marker, the loudest is
  still some marker, heard faintly across the room, so it takes the loudest
  only when it is heard at -60 dBm or more; otherwise the person stays `in
  this room` (the owner's choice: better not to say than to say it wrong).
- A third marker, `somewhere out the back`, which the prompt's list of bands
  already has, is allowed; revision 6 names only the bar and the stage.

## §1. The marker

All numbers are named constants in `firmware/src/band_logic.h`.

- **Any wristband can be one.** `marker bar`, `marker stage` or `marker back`
  on its USB console makes it a marker, kept across restarts as the Wi-Fi is;
  `marker off` makes it a wristband again. A marker joins no Wi-Fi, reaches
  no relay, pairs with nobody and shows no letters: plugged into a charger
  behind the bar, it just beacons.
- **What it says.** Every `BEACON_MS` (500 ms) it sends five bytes, `OTBM`
  and one letter (`b`, `s` or `o`), once on each channel from 1 to
  `MARK_CHANNELS` (13) in turn, by ESP-NOW broadcast at 6 Mbps, under an
  address made at every boot as a band's is. So every band hears it, on
  whatever channel the venue's Wi-Fi is, two beacons a second.
- **Its face** is dark. A press shows `MARKER` and `NEAR THE BAR` (or `BY THE
  STAGE`, `OUT THE BACK`) for `WAKE_MS`, so whoever places it can see what it
  is; a hold does nothing. The console's `show` says it is a marker, which
  area, and how many beacons it has sent.
- **Where it lives.** The beacon's bytes, the letters and the channel order
  are in `band_logic.h`, held by the host tests; `main.cpp` holds the radio
  and the console verb.

## §2. The band's listen and report

- **A listen keeps markers too.** Beside the bands it heard, a listen keeps
  the strongest reading of each marker area it heard (`OTBM` and a known
  letter; any other letter is ignored), brought into -100..0 as for bands.
- **The report says them** as `marks: [["bar", -52], ["stage", -80]]`, the
  strongest first, only when it heard any; a report without `marks` heard no
  marker. `FRAME_MAX` becomes 384 bytes, so a full report with three marks
  (346) fits; the host tests hold the longest.
- **Markers are never people.** A marker's beacon is `OTBM`, not `OTB1`, so it
  is never among the bands heard, and never on anyone's list.
- **The stand-in** (`/band`) has no radio and sends no `marks`.

## §3. The relay: the area

- **What is taken.** `marks` is optional; if present it is an array of at
  most three `[area, rssi]` pairs, each area `bar`, `stage` or `back`, none
  twice, each RSSI a whole number from -100 to 0. Anything else drops the
  whole report, as a malformed report is dropped now.
- **What is kept.** For each person, the readings of each marker area from
  their band's reports in the last `HEARD_MS` (30 s), in memory only.
- **The area.** At every near tick (`NEAR_TICK_MS`, 5 s), for each person:
  the median of each area's readings; the loudest names the area if it is
  `MARK_FLOOR` (-60 dBm) or more. A person already in an area stays in it
  while that area's median is `MARK_FLOOR - MARK_HOLD` (-64) or more and no
  other area's is `MARK_HOLD` (4 dB) or more above it. Anyone else is `in
  this room`: no band, a band that has not reported in `HEARD_MS`, or no
  marker heard clearly enough. `nearTick()` says a view changed when anyone's
  area did.
- **Only markers set an area.** The relay no longer takes an area from a
  phone: not in `join`, and `{t:'band'}` is gone. No phone sends either today.
- **What a phone sees** is one of the four phrases on a row, as now. No
  RSSI, no marker, no order by nearness. A match keeps the area as it was
  when it was made, and a report the area as it was when it was sent, as now.

## §4. Privacy and abuse

- **Still a band, never a number, never a map** (promise 1). The phrases are
  the four the product always had; readings live 30 s in the relay.
- **Anyone can beacon as a marker.** An ESP32 sending `OTBM` and a letter, or
  copying a real marker's beacon anywhere, makes the people near it read
  `near the bar` or the like on others' rows. It can only choose among the
  three phrases, cannot show anyone who was hidden, and learns nothing. The
  README says so.
- **A band that lies about marks** changes only its own person's area.

## §5. Who does what

- `firmware/src/band_logic.h`: the marker constants and letters, the channel
  order, the marker's beacon bytes and face words; `Hearing` keeping marks
  and writing them; `FRAME_MAX` 384.
- `firmware/src/main.cpp`: marker mode at boot (no Wi-Fi join, no socket),
  its beacon on each channel in turn, its face on a press; the listen taking
  `OTBM`; the console's `marker` verb and `show` line.
- `relay/room.js`: marker readings, the area at `nearTick()`, no area from
  `join`.
- `relay/server.js`: `marks` checked and handed to the room; `{t:'band'}` and
  `join`'s area gone.
- `app/`: nothing.

## §6. Tests and proof

- **Host (C++)**: a listen keeps each marker area's strongest reading and
  ignores an unknown letter; the report carries `marks` only when there are
  any, strongest first; the longest report fits `FRAME_MAX`; the marker's
  beacon bytes for each area, and its channels in order.
- **Room**: the area from the loudest over the floor; the hold; `in this
  room` for no band, a band gone quiet and a marker too faint; only the four
  phrases; no number in any view.
- **Server**: every way a `marks` can be wrong drops the report; a phone's
  area is taken neither in `join` nor as `{t:'band'}`. Every guard
  mutation-checked.
- **The model through the real room**: a test like the near crowd test, with
  markers at each end of the floor: the wrong marker named for under 1% of
  people, and nine in ten of those named within 11 m.
- **The real bands**: the Plus as `marker bar`, the StickS3 paired to a
  stand-in on SAY HI, a stand-in with no band sees `Someone near the bar`;
  `marker off`, and within `HEARD_MS` and a tick it reads `in this room`. If
  the owner walks the StickS3 away from the marker, where it turns back into
  `in this room` is the floor's check in a real room.

## Also to change when this is built

- README: the wristband section gains the markers; the firmware section the
  marker mode and its console verb; abuse resistance the fake marker; *What
  is not done* loses the markers and keeps the crowd walk.

## Risks

- **The floor is modelled.** -60 dBm rests on the crowd model's loss and
  body figures, calibrated to two bands on a desk. A walk away from a real
  marker is the check, and the floor is one constant in the relay.
- **Channels 12 and 13** are allowed in Australia, where the owner is, and
  not everywhere; a marker sold elsewhere would hop 1 to 11.
- **A marker on a laptop's USB** may be switched off with it: markers want
  a wall charger.
