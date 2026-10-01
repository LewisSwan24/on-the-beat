# The staff page under review: what was found, and what closes it

Date: 29 Sep 2026. Item 4 of the owner's queue of 28 Sep (「2134」), a red/blue
review of the staff page, its sign-ins and passcodes, the night file, the push
keys and the push host allowlist. Two decisions were the owner's, and the design was
approved in three sections as presented:

- **Report limits: moderate** (「適度（推奨）」): 10 an hour a person, 60 an hour
  a network, and a phone told the truth when it is refused.
- **Passcodes: at least 12 characters, and Enter makes one** (「至少 12 个字符，
  回车可自动生成（推荐）」).

## What was reviewed

`relay/staff.js`, `scripts/staff-code.mjs`, `relay/server.js` (staff sign-in,
tokens, the attempt counters, static serving, the 06:00 sweep, the night file,
sending pushes), `relay/room.js` (reports), `relay/push.js`, `app/staff/`,
`app/public/staff-sw.js`, `fly.toml`, the `Dockerfile` and README *Abuse
resistance*.

**Read and held, no change:**

- A passcode is kept only as a scrypt entry with its own salt. It is checked in
  constant time, off the event loop, and `STAFF_CODES` errors name the venue and
  never the entry.
- A token is 128 random bits, kept only as its SHA-256, and ends at 06:00.
- A staff socket can only mark reports, hand over a subscription or sign out.
  What a phone or a wristband says on it is inert.
- The push allowlist, no redirects, the 10 s timeout, the JWT lifetime and the
  sealed payload (`tests/push.test.js`).
- The night file and `push-keys.json` are 0600, written whole, on an encrypted
  volume with no snapshots.
- `npm audit --omit=dev` reports 0 vulnerabilities. Nothing in `app/` writes
  HTML from text (no `innerHTML`, `dangerouslySetInnerHTML`, `eval` or
  `document.write`). The two built pages carry only external module scripts.
- Static serving cannot leave `dist/`.

## Measured on 29 Sep 2026

1. **Fly overwrites a `fly-client-ip` the client sends.** Against
   `on-the-beat.fly.dev`, for a venue with no staff page (so nothing is guessed
   and nothing is made), six sockets of five sign-in attempts each. From the
   real address the first four sockets were answered `no staff page` and the
   fifth and sixth `too many tries` for every attempt, the 20 a minute being
   spent. A minute later six sockets, each sending a different
   `fly-client-ip`, gave the identical answers. So the per-address counters
   cannot be walked around with a header. README said this was reported by
   others and not measured; it is measured now (twice, the same both times).
2. **One person can take over a venue's staff list.** On a local relay, one
   real report was made first. Then one other phone (one socket, one person)
   sent 1,100 reports at 16 a second, inside the frame budget the relay already
   allows. In 71 s the list was full at 1,000 rows, the real report had been
   pushed out of it, and the staff socket had been sent the list 633 times, up
   to about 148 KB each time with one-word reports.

## Findings

| # | Weight | Finding | Closed by |
|---|---|---|---|
| 1 | Medium-high | A token is not tied to the passcode it was made with. Staff spec §6 says changing a passcode means a restart, which signs everyone out; since the night survives a restart (restart spec, 29 Sep) that is no longer true, and the owner has no way to sign everyone out. The old sign-ins keep their push subscriptions too. | §1 |
| 2 | Medium | `report` has no limit by person, by network or by venue. | §3 |
| 3 | Medium | Guessing a passcode is bounded per socket and per address, but an IPv6 attacker changes address inside a /64 for free, nothing bounds how many checks run at once, and eight characters are allowed. | §2 |
| 4 | Low-medium | No security header at all beyond `nosniff`: no frame protection, no CSP, no HSTS, no referrer policy. A staff sign-in is now kept in `localStorage`, on the origin the phone app shares. | §4 |
| 5 | Low | The socket does not look at `Origin`, so any web page can drive its visitors' browsers to the relay, from their addresses, outside the per-address counters. | §5 |
| 6 | Low | A staff tag is 16 bits: at about 300 reported people a collision is more likely than not, and two people are counted as one. | §3 |
| 7 | Low | The `REPORT` log line prints the venue name a stranger typed, control characters included. | §3 |
| 8 | Information | Not changed, see *Not in this spec*. | |

## §1. A sign-in belongs to the passcode it was made with

- **`entryPrint(entry)`** in `relay/staff.js` is the first 32 hex digits of the
  SHA-256 of `'staff-entry|' + entry`, the whole entry: its 16-byte salt and its
  32-byte scrypt hash. It can be worked out only by someone who already holds
  the entry, which is a secret of the deployment, so keeping it in the night
  file tells nobody anything.
- **A token record** is `{ key, night, entry, push? }`. A sign-in by passcode
  writes `entry: entryPrint(<the venue's entry>)`. The night file carries it
  with the rest of the record.
- **A token signs in only while its `entry` is still the venue's.** A token
  whose venue has no staff entry, or another one, is answered `expired` and
  forgotten.
- **At a restart** a record whose `entry` is missing (the older format), or is
  not the venue's current one, is not restored, and its subscription goes with
  it. The relay logs `night: N staff sign-ins ended: their venue's passcode
  changed` when N is more than 0, a count and nothing else. The line for what
  was carried on counts only the sign-ins that were kept.
- **So "sign everyone out" at a venue is:** run `npm run staff-code` for it
  again (with the same passcode if that is to stay; the salt is new, so the
  entry is), put the new entry into the `STAFF_CODES` secret, and let the
  machine restart, which setting a secret does by itself. A leaked passcode is
  closed the same way.
- **The page.** `REFUSED.expired` says *Signed out: it is a new night, or the
  passcode was changed. Enter the passcode again.*, in place of *…or the relay
  restarted*, which has not been true since the night was kept across restarts.

## §2. Guessing a passcode

- **`addressKey(address)`** in `relay/address.js` names the network an
  address counts as, and `addressOf()` returns it:
  - an IPv6 address is its /64: the first four groups, each lower-case without
    leading zeros, then `::/64` (`2001:db8:1:2::/64`); a zone (`%eth0`) is
    dropped;
  - an IPv4-mapped address (`::ffff:203.0.113.5`) is the IPv4 address;
  - an IPv4 address, or anything that is not an address, is unchanged.

  Every per-address count uses it: pairing, staff sign-in and §3's reports.
- **At most 8 passcode checks run at once** (`CHECKS_AT_ONCE`). The thread pool
  has 4 threads, so 8 is a queue of about 100 ms at most. A ninth attempt is
  answered `too many tries` before anything is counted, so a refusal for a busy
  relay does not spend the person's own tries. Without the bound an attacker
  can make the queue as long as they like, and slow what else uses the pool.
- **No lockout of a whole venue.** It would let anyone who sends a few requests
  a minute keep the team from signing in.
- **`createRelay({ staffCheck })`**, for tests only, replaces `checkCode`, so a
  test can hold checks open.
- **`npm run staff-code`:**
  - `CODE_MIN` is 12. A shorter passcode is refused with *A passcode needs at
    least 12 characters, or press Enter for one made for you.*
  - Enter at the passcode prompt makes one: three groups of four from the 31
    characters `abcdefghjkmnpqrstuvwxyz23456789` (no `i`, `l`, `o`, `0`, `1`)
    joined by `-`, about 59 bits, drawn with `crypto.randomInt`. It is written
    once to stderr, in the terminal the script was run in, as *Passcode (made
    for you, shown once, kept nowhere): k7m2-q9xr-4twd*. The entry is written to
    stdout as before, and there is no second prompt to confirm it.
  - The team types it as it is written, dashes included.

## §3. The report channel

- **Limits.** Before `room.report()`, a `report` from a joined phone is counted
  against two rolling hours: **10 for the person** (the room and the person's
  id, so one person at one venue) and **60 for the network** (`addressKey`). Both
  count every report sent, accepted or not, so someone who keeps sending while
  refused is not let back in until an hour after they stop. Past either, the
  report is not taken and the socket is sent `{t:'error', why:'report refused'}`;
  nothing is logged.
- **`relay/limits.js`** holds the counting: `rolling({ ms, max })` returns
  `{ take(key, at), prune(at) }`. `take` records an attempt and says whether it
  was within the limit. A key keeps at most its newest `max` times, so a flood
  cannot grow it, and `prune` forgets a key once all its times are older than
  the window. The counts are in memory, are cleared by a restart and are pruned
  by the sweep with the pairing attempts.
- **The phone** answers `report refused` by saying *too many reports just now.
  please tell a member of staff.* straight after its own *reported. the venue
  team has it.*, so a person who is refused is not left thinking it went. Its
  words for the relay's refusals move out of `App.jsx` into
  `app/lib/refusals.js`, the one it has now (`clip refused`) and this one, so a
  test can hold them.
- **The log fills from the handled end.** When it passes 1,000, the oldest
  handled report goes, and the oldest report only when none is handled.
- **A staff tag is `P-` and six hex digits**, not four. The tag is worked out
  when a list is made and kept nowhere, so no file changes.
- **The `REPORT` log line** replaces control characters, line separators, byte
  order marks and bidirectional controls in the venue key with `?`. A key
  without any is printed as it is.
- **The measured flood** is now at most 10 lists sent to staff for one person
  and 60 for one network in an hour, where it was 633 in a minute. Pushes to
  closed devices were already one a venue every 10 s.

## §4. Headers (`relay/server.js`)

- **Every response** carries `X-Content-Type-Options: nosniff` (as now) and
  `Referrer-Policy: no-referrer`, and `Strict-Transport-Security:
  max-age=31536000` when the request came in over https (`x-forwarded-proto:
  https`, which Fly's proxy sets; the relay itself never speaks TLS). Not
  `includeSubDomains`, not `preload`. They are set once at the top of the
  request handler, so every response has them, a 404 and a 503 included.
- **Every HTML page** (the app, the staff page and the route fallback) carries
  `X-Frame-Options: DENY` and `frame-ancestors 'none'`, so no other site can
  frame it and steal a tap. The app has taps that matter, such as sharing a
  contact.
- **The staff page** carries a full policy. It is chosen by the file that ends
  up being served, `staff.html`, so `/staff`, `/staff/` and `/staff.html` all
  get it:

  ```
  default-src 'self'; script-src 'self'; style-src 'self';
  font-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:;
  worker-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none';
  form-action 'self'; frame-ancestors 'none'
  ```

  *Amended 1 Oct 2026:* `style-src` and `font-src` were `https://fonts.googleapis.com`
  and `https://fonts.gstatic.com` when this was written, for Chewy. The fonts are
  files of the page's own now (`app/fonts/`, `scripts/fonts.mjs`), so neither
  names a host, and a staff device's address and browser are no longer told to Google.

  It can be this tight because the page has no inline script or style. Its
  React styles are set through the DOM, which a policy does not block. `ws:`
  and `wss:` are named beside `'self'` because some browsers do not count a
  WebSocket to the page's own host as `'self'`. That lets a script that got in
  open a socket elsewhere, which `script-src 'self'` is there to stop from
  getting in at all.
- **The phone app gets no full policy yet.** Its camera scanner, its clips as
  `blob:` media and Safari's reading of `connect-src` need a real phone first;
  see README *What is not done*.

## §5. Only this site's pages, and the wristband, may open the socket

- **`originAllowed(origin, host)`** in `relay/origin.js`, used as the
  `verifyClient` of the `WebSocketServer`, allows:
  - no `Origin` header (scripts, tests, other tools);
  - `file://`. The wristband's WebSocket library sends it by default
    (`WebSocketsClient.cpp:32` in both `libdeps`, `_client.extraHeaders =
    "Origin: file://"`), and `firmware/src/main.cpp` never calls
    `setExtraHeaders`, so both bands send it;
  - an origin whose host is the request's own `Host` (the app and the staff
    page, on Fly, behind a tunnel or on the laptop);
  - a loopback origin (`localhost`, `127.0.0.1`, `[::1]`, any port), which is
    the Vite dev server on 5178 talking to the relay on 8790.

  Everything else, `null` included, is refused with 403 before a socket exists.
- **What it stops.** A web page cannot forge `Origin`, so another site can no
  longer send its visitors' browsers to the relay, from their own addresses,
  to report, to join, or to try a passcode. A script that sets its own header
  is not stopped, and was never going to be: §2 and §3 are for those.

## Tests and proof

- **Test first, then the change, then a mutation** for each guard: break it, and
  exactly its test goes red.
  - `tests/staff.test.js`, `tests/restart.test.js`: a token from before a
    restart under another passcode entry is `expired`, and the log says how
    many ended; the same passcode set again ends them too; a record without an
    `entry` is not restored, and its subscription goes with it; the same entry
    keeps everything as it was (the test that exists today).
  - `tests/address.test.js`: the /64, the mapped address, IPv4, zones, junk.
  - `tests/staff.test.js`: two IPv6 addresses in one /64 share the 20 a
    minute; with `staffCheck` held open, the eighth check runs and the ninth is
    refused `too many tries` without spending the person's own tries.
  - `tests/staff-code.test.js`: 11 characters refused, 12 taken, Enter makes a
    passcode that opens its own entry, the passcode never reaches stdout, and
    only the generated one is written to stderr.
  - `tests/limits.test.js` for `rolling`: within the limit, over it, lapsing
    after the window, a refused attempt still counted, a key never holding more
    than `max` times, `prune` forgetting a key.
  - `tests/server.test.js` for the report limits: the eleventh report from a
    person is refused with `report refused`; sixty from one /64 spread over
    people are taken and the sixty-first is refused; a refused report is not
    in the log, and the staff list is not pushed for it; the count lapses
    after an hour.
  - `tests/room.test.js`: a full log drops handled reports first.
  - `tests/staff.test.js`: the tag is `P-` and six hex digits.
  - `tests/origin.test.js` and `tests/server.test.js`: what is allowed, and
    that `https://evil.example`, `null` and a look-alike host get 403 on the
    upgrade.
  - `tests/server.test.js`: the headers on an HTML page, a built asset, the
    shows feed and a clip; the full policy only on the staff page.
  - `tests/refusals.test.js`: the phone's words for `clip refused`, as now,
    and for `report refused`; nothing for a refusal it does not speak.
- **In a browser.** Headless Chrome, as for the offline shell. The staff page
  under its policy must raise no violation in the console, and must still sign
  in (with a test passcode on a local relay), list and offer the notify
  button. The app must still load and join a venue with the new headers, and a
  phone refused a report must say so.
- **On Fly**, after a deploy: `curl -I` for the headers, and a WebSocket
  handshake with `Origin: https://evil.example` must be 403, with no `Origin`
  101. No staff passcode is involved.
- **On the real bands**, right after that deploy: both must come back to Fly on
  their own (`on it`, as on every earlier deploy). The Origin check is the
  first suspect if either does not, and it is taken out in a redeploy before
  anything else is looked at. A test here holds that `file://` is allowed;
  only the bands can show that they send it.
- **Owed by the owner, as before:** `STAFF_CODES`, and a real phone.

## Also to change when this is built

- **README:** *Abuse resistance* (the staff page bullet, the new ones for
  reports, headers and the socket's origin, and the measurement above in place of
  "not measured here"), *The staff page* (a signed-in device is tied to the
  passcode, and how to sign everyone out), `npm run staff-code`, *What is not
  done* (the phone app's policy; the information-only items).
- **`docs/superpowers/specs/2026-09-28-staff-reports-design.md`:** a note where
  it has gone out of date, pointing here. §1 says a restart gives new tags
  (the night file keeps the key now, and the tag is six digits); §2 says a
  token from before a restart is refused, and §6 that a new passcode means a
  restart that signs everyone out (a token now belongs to its passcode entry,
  §1 above).
- **CLAUDE.md:** the test count.
- **Memory:** `staff-reports`, `work-queue`, `fly-relay`.

## Not in this spec

- **A lockout of a whole venue's passcode sign-in.** See §2.
- **A full policy on the phone app**, self-hosted fonts (the staff page asks
  Google for a font, which tells Google the address and browser of a staff
  device), hiding which venues have a staff page (`no staff page` and `wrong
  code` differ), raising scrypt's cost (a check takes 16 MiB and the pool runs
  four at once, on a 256 MB machine), and a per-venue cap on tokens (a passcode
  holder can push out the 1,000 oldest sign-ins).
- **The night file's names, contacts and reporters' words.** It is the relay's
  memory on an encrypted volume, readable by its owner only, removed once the
  night holds nothing (README *Reading the night's file*).

## Risks

- **A network's 60 an hour can be spent by one person on it.** Someone on a
  venue's Wi-Fi, or on the same carrier address, can use it up and stop the
  others there from reporting for the hour. They are told to find staff, and
  what did get through is on the staff page, but this is a way to stop the
  channel. It costs the attacker a report a minute. A venue-wide count would be
  worse, and a per-person count alone is beaten by new identities.
- **A distributed flood still works** from enough networks; it costs each one
  its 60 an hour, and the log now drops handled reports first.
- **The 8 passcode checks can be held** by an attacker with many networks (a
  whole IPv6 allocation is enough), which keeps new passcode sign-ins out for as
  long as it lasts. Devices already signed in are unaffected, since a token is
  not checked with scrypt. The other way to run it, with no bound, leaves every
  sign-in queued behind the attacker's and slows the thread pool that also
  writes the night file and looks up addresses for pushes.
- **`Origin` is for browsers.** Nothing here stops a script that sends its own.
- **The wristband's `Origin: file://` is allowed** because its library sends
  it; a browser page cannot send it. A future firmware that changed the header
  would be refused by the relay, and the live check above is what would catch it.
- **HSTS is for a year** on `on-the-beat.fly.dev` only. The wristband already
  refuses an unverified certificate, and the phone has never used plain http
  there. What it adds is that a browser will not let a person click through a
  certificate error on that host in that year. Fly renews the certificate
  itself.

## Amended while planning

Where the plan departs from the design above, and why.

1. **§1, the sign-in-time check is dropped.** "A token signs in only while its `entry` is still the venue's" can never fire: `STAFF_CODES` is read once, at start, and a token in memory was made under the venue's entry or carried on only after the restore check. No test could hold it, and a guard no test holds is the kind this project does not keep. The guard is at restore (`tokenFrom`), where a test does hold it.
2. **§3, `rolling`** also returns `size()` and `held(key)`, for tests.
3. **§3, tests.** The report-limit tests are in `tests/staff.test.js` (its movable clock, its other report tests), not `tests/server.test.js`, with one more: a refused report still counts against its network. `tests/refusals.test.js` also reads `App.jsx` to hold that the app uses the lookup, since a JSX screen cannot be run under `node --test`.
4. **§4, nosniff.** `X-Content-Type-Options: nosniff` is set at the top of the request handler with the other two, so a 404, a 304 and a 503 carry it too. It was only on 200s.
5. **§5.** `originAllowed` allows only `http:` and `https:` origins besides `file://`.
6. **§2, the script.** The input ending at the passcode question is "No passcode given", not Enter. `madeCode()` lives in `relay/staff.js`, so a test can call it 2,000 times and see all 31 characters and no others.
7. **"In a browser".** The Chrome check ran after the Origin check was in, so the staff page signed in over the socket through it. Headless Chrome on the built app, against a local relay: the staff page signed in and listed with nothing in the console, so the two `<link rel="preconnect">` lines stayed and no directive was widened; the app loaded under its new headers. Its only console warning was the older `apple-mobile-web-app-capable` deprecation.
