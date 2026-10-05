# On The Beat

Get talking to a stranger at a live gig, then get out of the way.

https://github.com/user-attachments/assets/82580c25-2037-49e7-baf4-133858eb822b

<details>
<summary>On a phone? The vertical cut (9:16)</summary>

https://github.com/user-attachments/assets/87d6690f-96b9-4829-8848-19cd1f69d0fc

</details>

A phone app for one night at one venue. You arm one of three cards — **SAY HI**
(your screen turns blue: hello), **FIRST SONG?** (pick the opening track and
like other people's picks), **LET'S DANCE!** (five seconds of you dancing, on a
shared floor) — and when two people both say yes, and only then, each learns
the other's first name and where to meet. It is built from the Claude Design
canvas `On The Beat.dc.html`; the canvas is the design, this is the working
thing.

**This repository is one person's working build**, and deliberately separate
from the DECO3500 team repository (`cimi2232/DECO3500`). Nothing here is pushed
there: a `pre-push` hook refuses any remote under the team account. Git does not
clone hooks, so the copy that matters is tracked at `tools/hooks/pre-push`;
after a fresh clone, reinstall it with `cp tools/hooks/pre-push .git/hooks/pre-push`.
It replaces `on-the-beat-prototype` (the Crew Pact direction), which is retired.

## Run it

```
npm install
npm start            # build, then the relay and the app on http://localhost:8790/
npm test             # build, then every test
npm run dev          # Vite on :5178 for working on the app (run `npm run relay` beside it)
npm run tunnel       # an https address for real phones (cloudflared must be installed)
```

Phones need https: the camera, the screen wake lock and the offline shell are
refused on plain http, so use `npm run tunnel` for real phones. The relay is
also always on at **https://on-the-beat.fly.dev** (one Fly.io machine in
Sydney). The night ends at 06:00 venue time; set it with
`NIGHT_TZ=Australia/Brisbane`. Every other command, CI, deploying and the
staff passcodes are in [docs/running.md](docs/running.md).

## How it works, in short

**Four promises**, kept by the relay rather than by the screens:

1. Nobody sees where you are, never closer than an area like "near the bar".
2. No name and no photo until you both say yes.
3. One tap makes you invisible, and it stays that way until you turn it back on.
4. If someone declines, you never see each other again tonight, and neither
   side is told.

**The wristband** (an M5StickC Plus or a StickS3) is optional. It pairs to a
phone by four letters and a number checked on the wrist, then shows the armed
card's colour, calls when someone waves, and shows the same two-digit number
as your match's band or phone when you meet. Both buttons held for 3 seconds
turn it off; its power button turns it on. A phone alone gets the same night.

**The staff page** (`/staff`) is for a venue's own team: reports from the
floor, a notice to every phone, moved set times, and naming the opening song.

## Documentation

| Read | For |
|---|---|
| [docs/running.md](docs/running.md) | every command, CI, deploying to Fly, passcodes (was "Run it") |
| [docs/how-it-works.md](docs/how-it-works.md) | the four promises and where each is kept, how the relay and app are built |
| [docs/staff-page.md](docs/staff-page.md) | the staff page, sign-in and notifications |
| [docs/wristband.md](docs/wristband.md) | the wristband and its firmware: pairing, waves, meeting, markers, power |
| [docs/canvas.md](docs/canvas.md) | where this build differs from the design canvas, on purpose |
| [docs/abuse-resistance.md](docs/abuse-resistance.md) | every guard against misuse, each with its test |
| [docs/not-done.md](docs/not-done.md) | known limits and capacity numbers |
| [docs/show-night.md](docs/show-night.md), [docs/rehearsal-night.md](docs/rehearsal-night.md) | running a real night |

## License

The code and documents in this repository are under the MIT License (`LICENSE`).
What came from elsewhere keeps its own: the two fonts in `app/fonts/` (notices
in `app/fonts/LICENSE.md`) and the `jsqr` tarball in `vendor/` (Apache-2.0, its
own `LICENSE` is inside the tarball). The design the app is built from, the
Claude Design canvas, is not in this repository.
