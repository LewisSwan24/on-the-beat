# Security

On The Beat is one person's working build, run for real nights at real
venues: a phone app, a relay on Fly.io (`https://on-the-beat.fly.dev`), a
staff page per venue, and wristband firmware. A hole in any of them can reach
people at a gig, so reports are welcome.

## Reporting a vulnerability

Report it privately through GitHub: the **Security** tab of this repository,
then **Report a vulnerability**. Please do not open a public issue, and please
do not test against the live relay in ways that could reach other people's
nights (floods, pairing-code guessing, other people's rooms); a local relay
(`npm start`) runs the same code.

Useful in a report: what you did, what you saw, and which part it touches —
`relay/`, `app/`, the staff page, or `firmware/`.

## What is covered

- The `main` branch, and whatever the live relay is running from it.
- Wristband firmware built from `main`.

## What is already known

README's [Abuse resistance](README.md#abuse-resistance) lists what has been
tried against the build and what each fix is, and
[What is not done](README.md#what-is-not-done) lists the limits that are known
and open. A report of something on either list is still welcome if it shows
the problem is worse than written there.
