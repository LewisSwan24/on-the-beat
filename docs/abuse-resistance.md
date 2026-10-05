# Abuse resistance

The relay is a standing public process (on Fly.io, or behind a tunnel), so the pairing surface
was red-teamed and hardened. A red/blue pass found and closed:

- **Guessing a wristband's four letters.** The code space is only 279,841, and
  one socket could once walk it in about fifteen seconds and take a stranger's
  wristband. Now every pairing attempt, right letters or wrong, and every
  unproven claim is throttled: five per socket and twenty per address
  a minute. The address is the real client, so one attacker cannot spend the
  whole room's budget. On Fly.io it is `fly-client-ip`, which Fly's proxy sets
  from the connection it accepted, read only because `CLIENT_IP_HEADER` names
  it; that the proxy also replaces one a client sends was measured on
  29 Sep 2026: six sockets that each sent a different `fly-client-ip` still
  shared one budget of twenty. Behind the tunnel it is `cf-connecting-ip`,
  trusted only because the socket is on loopback. An IPv6 client counts as
  its /64, since anyone on a network holds 2^64 addresses of it, and an
  IPv4-mapped one as the IPv4 address it wraps.
- **Piling up placeholder claims.** A phone claims a wristband by id and
  secret, which a restarted relay must accept before the wristband is back. A
  claim nothing answers is a placeholder, one per person, forgotten after the
  hour; the band table has a hard ceiling that evicts the deadest record first
  and never a live wristband.
- **Speaking as someone else's wristband.** Every hello carries the key its id
  is the hash of; a hello whose key does not hash to its id is refused, for a
  paired, a pending and an unpaired record alike, and a paired record also
  needs its secret, without which the new socket is closed and the live one is
  left alone. A socket says hello once, a replaced wristband socket is closed
  and nothing more is taken from it, and a hello with no protocol version gets
  letters but is never paired.
- **A decoy wristband.** The check above: the number appears on the wristband
  that was reached, so a decoy has to be believed, not just scanned. Numbers
  are unique among the pairings in progress, a second pairing of the same
  wristband is refused `busy`, and the letters change after every NO or
  timeout.
- **Showing someone late.** A wristband's `set` is dropped whole unless it is
  exactly a set, and refused `unpaired`, `no room`, `changed` or `too fast`
  (one a second). A phone's re-said facts only ever hide, and only when they are
  news; a showing change names the revision it was chosen from. A person who
  left under NOT NOW and comes back is still invisible, and a join made while
  holding NOT NOW makes them invisible from the first moment.
- **A wristband's yes for its person.** A band can wave back, which makes a
  match and shows both names. It speaks for its person only with the secret of
  its pairing, so no other band can wave as them. Its wave is dropped whole
  unless it is exactly one, then refused `too fast` (one a second, counted
  before any handle is looked up and whether or not it lands, so a flood of
  made-up handles buys nothing), `unpaired`, `no room`, `changed` (its
  person's revision moved, or they are not on SAY HI) and `gone` when the
  handle is not someone waiting on its person, which a block reads exactly
  like. A band never starts a wave: with none to answer, nothing is recorded.
  A lent, taken or forgotten band can still make a match for its person, with
  or without their phone; blocking undoes it.
- **What a wristband says it heard.** A report is dropped whole unless it
  comes from a paired band's current socket, five seconds or more after its
  last, on a channel from 1 to 14, with at most sixteen entries, each a
  twelve-hex address and a whole signal strength from -100 to 0; a hello whose
  `air` is not twelve lower-case hex digits is refused. An address counts only
  as the address of exactly one band paired in the same room, so one claimed
  twice, or from another room, counts for nobody. Each person's five comes
  from what their own band heard and nothing else, so a band that lies
  changes only its own person's list, and nearness only ever removes, so it
  can show nobody a phone could not see already. Until 28 Sep 2026 a pair was
  scored on what both bands said, so a lie moved the other person's five
  too: five made-up people on SAY HI, each with a scripted band saying it
  heard someone loudly, could fill that person's five and push everyone they
  were really near off their list. It took that person's address, which only
  a radio at the venue hears; the second review found it. A band beaconing under another's
  address moves that band's nearness to where the liar stands, among
  strangers in the same room, and no further. A report's `marks`, when it
  has any, are at most three, each area `bar`, `stage` or `back` once and each
  strength a whole number from -100 to 0, or the whole report is dropped; a
  band that lies about them changes only its own person's area.
- **A marker anyone can make.** A marker has no key: any ESP32 beaconing
  `OTBM` and a letter, or repeating a real marker's beacon somewhere else,
  makes the people whose bands hear it clearly read `near the bar` or the
  like on others' rows. It chooses only among the three phrases, cannot show
  anyone who was hidden, and learns nothing. A key would stop only inventing
  a marker, not copying one, so there is none.
- **Rooms that never emptied.** A venue with nobody in it, nobody in its grace
  window, no clip still loading and no wristband still worn is now reclaimed, so
  a long-lived relay does not keep a room object for every venue anyone typed.
- **A flood of reports.** One phone could send 1,100 reports in 71 s at
  the pace the frame budget allows, fill a venue's staff list at a thousand,
  push out a real one and make the relay send that list to staff 633 times
  (measured on 29 Sep 2026). Now a person may send ten reports an hour and
  a network sixty, counting every one sent, refused ones too; past either
  the report is refused, unlogged and unpushed, and the phone says to tell
  a member of staff. The log is still capped at a thousand a venue, but
  drops the reports the team has handled first, and a venue's reports go at
  06:00. The counts are in memory: a restart clears them
  (`tests/staff.test.js`, `tests/limits.test.js`).
- **The staff page.** A passcode is kept only as a scrypt entry, and every
  sign-in by passcode counts on the pairing counters, five a socket and
  twenty an address a minute, its scrypt run off the event loop. At most
  eight checks run at once: a ninth is refused unheard and counted against
  nobody, so a crowd of guessers cannot queue behind the four threads that
  also write the night. A passcode is at least twelve characters, or one
  the script makes. A token lasts until 06:00 at its own venue only, and
  only under the passcode entry it was made with, so a changed passcode
  ends its sign-ins at the restart. A socket is a phone, a wristband
  or staff, never two, including one that joins while its passcode is being
  checked; a staff socket can only mark reports. Staff see a person only as
  a tag of six hex digits made with a key drawn at start (kept in the night
  file, so it survives a restart), and never who reported; the relay's
  log says only which venue and which report, with anything a stranger could
  shape in a venue name replaced. What it cannot tell: someone
  with many phones can report one person from each, so `reported 5 times by
  5 people` is a lead for staff to look into, not proof.
- **A flood of venue joins.** `join` is unthrottled and each new venue is a room
  object; the room table now has a ceiling that reclaims empty venues under
  pressure and refuses a new one only when every venue is genuinely in use, and
  a socket switching venues has its orphaned rooms reclaimed as it goes.
- **A flood of messages.** Every change in a room used to push every phone
  in it a fresh view at once, and working out a view is a pass over the
  room, so one socket sending changes as fast as it could made the one
  machine do the square of the room for each, and stalled every venue on
  it. Now a room's views go out at most every 100 ms, carrying every change
  before them, and a socket has a budget of 40 frames at once, earned back
  at 20 a second. A phone or a wristband says about one every two seconds
  and a reconnect about a dozen at once; a socket past its budget is closed
  as `too fast` (4003) before its frame is read. The second review found it.
- **A venue with no ceiling.** Nothing limits how many people a venue holds:
  `join` is open, a venue's Wi-Fi puts a whole crowd behind one address (so a
  limit per address would turn real people away), and the only bound is Fly's
  2,500 connections. A room costs the square of its people, so one client
  holding a thousand sockets in one venue pins the CPU (a full round of views
  took about 4 s at 1000 people on a laptop core). **That is not fixed**, and
  the machine is not meant for it: about 100 people a venue is what the door
  is planned around (*What is not done*, first bullet). What the third review
  (1 Oct 2026, the code since 29 Sep) did fix is that the handle memo had made
  a room's memory square as well, at about 62 bytes a pair: 58 MB at 1000
  people and 151 MB at 1500, against the 207 MB the Fly machine gives its
  process, so a flood that used to stall the relay could now kill it. A
  relay's rooms now share one budget of 400,000 held pairs (about 25 MB), and a
  pair past it is worked out each time, as it was before any were held and to
  the same handle. `tests/room-handles.test.js` and
  `tests/relay-handles.test.js`.
- **A shows file typed wrong.** Tonight's shows can come from a file on the
  volume, and a show whose act is an object where text belongs would have
  blanked the app for every phone, since React cannot draw one. A show whose
  act, venue or times are not text, or whose set list or quiet corners are not
  a list of text, is dropped and named in the log, and the rest stand; only
  the `id` is required. A show with no `doors` no longer reads "doors
  undefined" on the picker.
- **Video that fills the machine.** Every room's clips together were held to
  96 MB, and nobody had measured that against the machine, because the
  capacity rig sent no clips. Once it did (1 Oct 2026, in a 207 MB Linux
  cgroup), a hundred phones posting a clip every 8-20 s took the relay to
  178 MB of memory, a store near its cap included. The store is now held to
  40 MB, and the same hundred phones read 158-161 MB with it full. The relay's
  load line says the video it holds (`clips 38.1 MB`), so a night's log shows
  the store. One socket could still send clips as fast as its frame budget
  let any message through (40 at once, 20 a second, each up to 1.2 MB: 24 MB
  a second to parse, decode and push), though the store itself could not pass
  its cap. Since 2 Oct 2026 a frame of 64 KB or more, which nothing but a
  clip comes near, is charged as it arrives, before it is parsed, to a
  budget of its own: three at once, then one more every 3 s. One
  over is answered `clip too fast` (the phone says so) and is neither read
  nor kept, and the socket stays open. A phone records five seconds a clip,
  so it never meets the limit; a clip under 64 KB, about a second of video,
  is outside it and costs what a pick does. The budget is per socket, as the
  frame budget is. `tests/server.test.js` holds the cap and the budget, with
  `tests/relay-load.test.js` for the figure in the load line.
- **A socket that changes who it is.** A socket that had joined could join
  again as someone else, or at another venue, and the person it had stood
  for stayed in the room with no phone, no grace and no wristband, for as
  long as anyone else was there: one socket could leave any number of people
  behind, each still on SAY HI if they had been. Now a new join leaves as
  whoever the socket stood for, at once, unless another phone or a live
  wristband of theirs still holds them. The app opens a new socket for each
  venue and each night, so it never did this; a client of one's own could.
- **MIME confusion.** Every served response — the app, a built asset, a clip,
  the shows feed — carries `X-Content-Type-Options: nosniff`, so a browser
  takes the declared type and never guesses one.
- **A clip's type as a header** (4 Oct 2026). A clip was kept with whatever
  type its phone sent, so long as it began `video/webm` or `video/mp4`, and
  that type was served as its `Content-Type`. A type with a line break in it
  made Node throw while writing the header, outside any handler, and one
  phone could stop the relay by posting such a clip and fetching it. Now a
  clip is kept only as `video/webm` or `video/mp4` exactly (a `;` and its
  codecs may follow, and are dropped), and anything else is refused.
  Behind that, a request or a socket message that throws for any reason
  now costs only itself: the request is answered 500 (or cut off if its
  answer had begun), the socket is closed as one that dropped, the log
  says what was thrown and never the address asked for, and the relay goes
  on. The tests make Node itself throw once to hold both.
- **Framing, referrers, injected script.** Every response says
  `Referrer-Policy: no-referrer`, and over https `Strict-Transport-Security`
  for a year (Fly's proxy says which; not for subdomains, no preload).
  Every page says `X-Frame-Options: DENY` and `frame-ancestors 'none'`, so no
  other site can frame it and steal a tap. The staff page also carries a
  full Content-Security-Policy: its own scripts, styles, fonts, worker,
  manifest and socket, nothing inline, no plugin, no `<base>`, no form posted
  elsewhere. It has no inline script or style to allow, and
  headless Chrome signs in and lists under it with nothing in the console.
  The phone app carries one of the same shape (`APP_POLICY`,
  `docs/superpowers/specs/2026-09-30-app-csp-design.md`), written against
  what the built app actually loads and one line wider: `media-src 'self'
  blob:`, since a recorded five seconds plays from a blob URL the phone made
  itself and the floor's clips play from `/clip/`. The camera needs no
  allowance in any policy. Headless Chrome walked the app under it — join a
  show, a socket round trip, a blob in a `<video>` — with no refusal in the
  console, and headless WebKit, the engine family Safari reads
  `connect-src` with, opened it with an empty console and a socket join
  answered. The live machine still serves the framing rule only, and
  `fly.toml` holds it there (`APP_CSP = "framing-only"`) until Safari's
  reading of `connect-src` has been tried on a real iPhone
  (*What is not done*).
- **Other sites' pages driving the socket.** The socket used to open for
  any page's script, so a page a stranger made could send every visitor's
  browser to the relay, to report, join or try a passcode, from the
  visitors' own addresses and outside the per-address counters. Now a
  handshake with an `Origin` is refused (403, before a socket exists)
  unless it is this site's own host, `file://` (what the wristband's
  library sends) or the dev server on loopback. A tool that sets no
  `Origin` is let through, as it always was: the limits above are for it
  (`tests/origin.test.js`, `tests/server.test.js`).
- **A clip's address in the wrong hands.** A clip's address used to open it
  for anyone holding it, for its hour, a blocked person included. Now each
  viewer is sent an address of their own — the clip's 96-bit ref and a ticket
  the relay makes, from a key it draws when it starts, for that clip and that
  viewer — and the relay serves it only while that viewer's own view shows the
  clip: not once either of them has blocked the other, while its owner is NOT
  NOW, or after the viewer has left. A browser must ask again before it plays a
  clip again (`no-cache`, with an ETag), and a refusal is the same 404 as a
  clip that never was. A copy already on someone's phone stays theirs, as a
  screenshot would.
- **Something posing as the relay.** A wristband's `https` connection used to
  be encrypted without checking whose certificate it was shown, so on a hostile
  network something posing as the relay could drive what a wrist shows. Now
  the band checks the certificate against four roots built into its firmware
  (`firmware/src/relay_roots.h`): ISRG Root X1 and X2, which the Fly relay's
  RSA and ECDSA chains end in, and GTS Root R1 and R4, which a Cloudflare
  tunnel's do. A relay chaining to none of them is refused. On 28 Sep 2026
  each of those four chains, as the two addresses served them, verified
  against these roots, and `tests/relay-roots.test.js` holds each root's
  fingerprint and that the band never opens `https` unchecked. Both real
  bands, flashed with it that day, reached the Fly relay and refused every
  attempt at badssl.com's self-signed, untrusted-root and wrong-host servers —
  the last showing a Let's Encrypt certificate that chains to ISRG Root X1 but
  names another host — while badssl.com itself, the same chain under its own
  name, was not refused. The price: a
  relay that moves to another certificate authority needs the bands flashed
  again, and the roots last until 2035 (X1), 2036 (R1, R4) and 2040 (X2). A
  plain `ws://` relay on the laptop's own network is still unchecked, as any
  plain connection is; which relay a band uses is set only at its console or
  when it is built.
- **A check held open by someone watching.** A wristband's letters are on
  its screen for anyone near to read. Typed first, they used to hold its
  check for a minute at a time, the owner told only that someone was pairing
  it: every attempt counted and the letters changed after each, so this
  annoyed rather than paired, but the owner could do nothing about it. Now
  holding the face button on the check turns it away (`{t:"refuse"}` with the
  number the wrist shows): the relay drops it at once, the wristband shows new
  letters, the phone that typed is told the wristband said no, and the busy
  message tells the owner to hold the button. It lands only from that
  wristband's own socket and only on the number its check still shows, so a
  hold that arrives after `YES`, or names another check, unpairs nothing.
  On 28 Sep 2026 both real bands did this through the Fly relay: a stand-in
  phone typed each band's letters, the console's `hold face` held the face
  button on the check, and within a second the phone was told the band said
  no, and the band showed new letters and played fall.
- **Malformed and hostile frames.** Non-JSON, wrong-typed fields, forged
  handles and unknown message types are all inert: a fuzz barrage of them
  leaves the relay serving and still forming rooms (`tests/server.test.js`).
- **Reading the night's file.** Whoever reads `/data/night.json` finds no
  phone's id, no wristband's secret and no staff token, only their SHA-256
  (and, beside a sign-in, a print of the passcode entry it was made under,
  from which nothing can be worked back): it signs nobody in, takes no
  wristband and joins no room. It still holds
  names, contacts and reporters' words, as the relay's memory does; it is
  written readable by its owner only, is removed once the night holds
  nothing, is never read on another night, and Fly keeps no snapshot of it
  (`tests/restart.test.js`, `tests/deploy.test.js`).
- **Staff notifications.** The relay calls a push service only at an
  address on its own hosts: `fcm.googleapis.com`,
  `android.googleapis.com`, or a name under `push.apple.com`,
  `push.services.mozilla.com` or `notify.windows.com`. The address must be
  https on 443 with no user in it. It is checked when a device hands it
  over and again before every request, the relay never follows a redirect,
  and it gives up after 10 s, so a staff sign-in cannot aim it anywhere
  else. A subscription needs a real P-256 key and a 16-byte secret. A venue
  holds at most 50 and hears at most one push each 10 s. What is sent is
  sealed for the one device (RFC 8291) and says only the venue and how many
  are open. The log counts pushes; it never holds an address or a key
  (`tests/push.test.js`, `tests/staff-push.test.js`).

Each fix is a test in `tests/server.test.js`, `tests/wristband.test.js`,
`tests/rules.test.js`, `tests/relay-roots.test.js`, `tests/restart.test.js`,
`tests/push.test.js`, `tests/staff-push.test.js` or the wrist's table of
cases (`tests/fixtures/wrist-cases.json`), and each was mutation-checked — break the guard and
exactly its test goes red; where other tests stand on a guard, exactly that
known set does. A dropped wristband keeps its
letters through a wifi blip on purpose (so the code under a typing finger does
not change), which is the one deliberate change to a wristband's own lifetime.

The `/pair/` link used to wait for a tap on the phone, because a hostile code
anywhere could bind an attacker's wristband to whoever opened it. The check
replaces that tap for every way in — the in-app scanner and typed letters too,
which the old guard never covered.

The room model itself — who appears in another person's view — was read end to
end: before a mutual yes a person is only a per-viewer handle and a coarse band,
name and contact arrive only when both keep, an invisible person is absent from
everyone's lists, and a block cuts both directions and outlives leaving.
