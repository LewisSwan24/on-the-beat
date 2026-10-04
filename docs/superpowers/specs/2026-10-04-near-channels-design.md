# Near across Wi-Fi channels — design (proposed, not built)

Status: a draft for a decision, 4 Oct 2026. Nothing here is built. It
extends `2026-09-26-wrist-near-design.md`, whose "Not in this spec" left
several Wi-Fi channels out, and README *Who is near has not met a crowd*,
which lists it as not built.

## The problem

A band beacons and listens with ESP-NOW on the channel its Wi-Fi is on: the
ESP32 has one radio, and while it is joined to an access point it stays on
that point's channel. A venue whose access points share one SSID across
channels 1, 6 and 11 (the usual layout) splits its bands into three groups
that never hear each other.

Nobody is hidden by that: a person is hidden only on evidence, and a band on
another channel is no evidence (near spec §2, "Who is hidden"). The cost is
the other way. A viewer on channel 1 is given their five among the bands on
channel 1, and everyone on SAY HI on channels 6 and 11 as well, unfiltered.
With three channels evenly used, about two thirds of the banded room stays
listed, and near stops doing its job on the floors it was built for.

Markers have no such problem: they join no Wi-Fi and beacon on every
channel in turn (README, *Markers*).

## What the choice is

Three ways, cheapest first. They stack; each later one is only worth doing
if the one before it is not enough.

### A. One channel for the bands, set by the venue (no code)

The venue gives the bands a network on one channel: a separate SSID, or an
access point of its own for the night, or every point on one channel. Bands
need little bandwidth (a report every 10 s, a view on change), so a network
built for them alone is enough.

- Costs: nothing in the code; a line in `docs/show-night.md` "Before doors"
  and a check that the bands' network is on one channel.
- Limits: it depends on the venue's IT, and many venues will not change a
  production network for a night.

### B. A band joins only access points on a chosen channel (small firmware)

A console setting, `channel <1-13>`, kept across restarts as `ssid` and `pass`
are; `channel 0` (the default) is today's behaviour. With it set, the band
calls `WiFi.begin(ssid, pass, channel)`, so it joins the strongest access
point of that SSID on that channel and no other, and rejoins on that channel
after a drop. Every band of the night is set to the same channel, so all of
them hear each other while the venue's other channels carry its phones.

- Costs: one setting and the join call in `main.cpp`; the setting's parsing
  in `band_logic.h`, held by host tests; `near` on the console says the
  channel it was asked for beside the one it is on. The relay is unchanged:
  the same-channel rule already does the right thing.
- Limits: the bands lean on a third of the venue's access points. Where a
  part of the floor has no point on that channel, a band there joins nothing
  and is offline (its person keeps the phone, as with any band offline).
  Whether coverage holds is what a venue walk would show:
  `scripts/venue-walk.py` already records what a band hears as it walks;
  a walk with the band pinned would add whether it stayed joined.
- To prove: on two real bands, a network on channel X and another SSID or a
  second hotspot on channel Y. Pinned to X, a band ignores Y even when Y is
  stronger; pinned to a channel with no point, it joins nothing and says
  so on the console; set back to 0 it joins as today.

### C. Listen on the other channels while staying joined (firmware and relay, spike first)

The band keeps beaconing on its own channel, and spends part of each listen
on the venue's other channels. Hearing is enough: a band on 6 that listens
on 1 hears the bands on 1, and they hear it when they listen on 6, so no
band has to send on a channel it is not joined on.

How it might work, all of it unproven on these bands:

- The station tells its access point it is asleep, so frames for it are held,
  moves the radio to another channel for a dwell, listens there in
  promiscuous mode, and comes back. This is what a background scan does
  while joined; whether Arduino-ESP32 2.0 lets the radio sit off channel
  with promiscuous mode on, without dropping the access point or the relay's
  TLS socket, is the first thing a spike must answer.
- Which channels: the ones the band's own scan found its SSID on, usually
  two others. A beacon comes every 500 ms, so a dwell under that may miss a
  band; one foreign channel per listen, in turn, keeps each excursion to
  about 600 ms.
- The report gives a channel for each entry: `near: [[air, rssi, ch], ...]`,
  and says which channels the band listened on in that listen.
- The relay's evidence rule changes from "on the same channel" to "the
  viewer's band listened on the other band's channel in the last
  `HEARD_MS`". The score, the five and the hold are unchanged. With one
  foreign channel per listen and three channels, each is heard about every
  30 s, so `HEARD_MS` (30 s) would need to grow, or the score would rest on
  one reading; that trade is the second thing the spike must measure.

- Costs: the most of the three: radio code that is hard to test off the
  band, a new report shape (old bands keep the old one and the old rule), a
  relay rule change with its tests and mutations, and two real networks on
  different channels to prove it.
- Risks: dropped joins or sockets while off channel; more power while
  listening (listening is what costs, near spec "What the spike found");
  the relay socket stalls for each excursion.

## Recommendation

A first, written into the show-night runbook now, since it costs nothing.
B next, if a venue cannot give the bands one channel: it is small, the relay
does not change, and it is provable on the two bands with a second network.
C only if a venue walk shows the pinned channel leaves parts of the floor
without a point, and only after a spike on real bands answers whether the
radio can sit off channel and come back without dropping anything.

## Not in this draft

- A correction between band models (a StickS3 heard a Plus 7 dB weaker than
  the Plus heard it): a separate question, and channels do not change it.
- Choosing the channel for the venue automatically: the band cannot know
  which channel covers the floor best; the venue or a walk can.
