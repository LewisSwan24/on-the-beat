# Staff: reports reach the venue team

Date: 28 Sep 2026. Decided with the owner question by question the same
day, after the second security review. It adds a surface the Claude Design
canvas does not have: a page for a venue's own team.

## What is true today

Checked on 28 Sep 2026, in the code:

- **A report goes to a log.** The phone's Report — from a person's sheet
  (their handle), from *Report something* (a match, or *Something else*) —
  sends `{t:'report', handle, why:''}`. `room.report()` keeps `{ at, from,
  about, band, why }`, the newest 1,000 a venue, and the relay prints each
  one to its own log (`REPORT {...}`). Nobody reads that log during a night.
- **The phone says the team has it.** After a report it says *reported. the
  venue team has it.* and the sheet says *goes to the venue team, with the
  time and the room.* Neither is true yet.
- **A report carries no words.** The phone always sends `why: ''`.
- **A room's reports go with the room.** `gcRoom()` drops an empty venue,
  reports and all, and nothing clears reports at 06:00.

## Goal

Everyone a venue lets in can report someone, or something, and the venue's
own team sees it within a second, with when, which part of the room, how
often that person has been reported tonight, and the reporter's own words
if they gave any, without ever learning a name, a contact or who reported.

## Not in this spec

- **Doing anything to the person reported**: removing, blocking or
  flagging them. Staff find them by area and talk to them.
- **Answering the reporter.** The phone still only says the team has it.
- **Push notifications** to a staff device whose page is closed or asleep.
- **Keeping reports past a restart.** As with rooms, a deploy empties them.
- **Staff accounts.** One passcode a venue, shared by its team; no names.

## Where this departs from the canvas, on purpose

- **A staff page** at `/staff`, which the canvas does not have: someone has
  to read the reports the canvas promises go to the team.
- **Report asks for a few words.** The canvas's Report is one tap. The owner
  chose on 28 Sep 2026 an optional short field, since "someone was reported
  near the bar" alone gives staff little to act on.

## §1. What a report keeps, and what staff see (`relay/room.js`)

- **A report** is `{ id, at, from, about, aboutBand, fromBand, why,
  handledAt }`: `id` is `r1`, `r2`, … in the room; `about` the person
  reported or `null` for *Something else*; `aboutBand` and `fromBand` each
  person's band (`in this room`, `near the bar`, …) when it was made; `why`
  the reporter's words, a string cut to 200 characters, `''` for none or for
  anything that is not a string; `handledAt` 0, or when staff marked it
  handled. Still the newest 1,000 a venue, in memory only.
- **`staffReports(tagOf)`** returns what staff may see, newest first:
  `{ id, at, about, times, people, bandNow, bandThen, fromThen, why,
  handledAt }`. `about` is `null` or a staff tag, `tagOf(id)`; `times` is
  how many reports tonight are about that person and `people` how many
  different people made them; `bandNow` is the person's band now, or
  `'left'` once they are no longer in the room. There is no `from`, no
  internal id, no handle, no name and no contact anywhere in it.
- **`handle(reportId, on)`** sets or clears `handledAt`; `false` for a
  report that is not there.
- **The staff tag** is `P-` and four upper-case hex digits of an HMAC under a
  key the relay draws when it starts, over the venue and the person. It is
  the same person on every staff screen at that venue tonight, and nothing
  like the per-viewer handles phones are shown; a restart gives new tags.
- **At 06:00** a venue's reports from the night before are cleared, as
  everything else of a night is.

## §2. Passcodes and signing in

- **Making one.** `npm run staff-code` (`scripts/staff-code.mjs`) asks for
  the venue's show id and a passcode of at least 8 characters, twice, and
  never echoes it. It prints one entry, `"<venue>": "scrypt$16384$8$1$<salt
  hex>$<hash hex>"`, and nothing else. The owner runs it in his own
  terminal and puts the entries in the relay's environment as
  `STAFF_CODES`, a JSON object, with `flyctl secrets set`. No passcode is
  ever in the repository, in `relay/shows.json`, in `/api/shows`, in a log
  or in a test other than a test passcode.
- **Checking one.** The relay reads `STAFF_CODES` once when it starts. A
  sign-in names a venue and a code: a venue with no entry is `no staff
  page`; otherwise `crypto.scrypt` (asynchronous, off the event loop's
  critical path) and `timingSafeEqual` decide. Every sign-in by code counts
  as an attempt on the same counters as pairing — five a minute a socket,
  twenty a minute an address — and past them it is `too many tries`.
- **Staying signed in.** A right code gets a token: 32 random hex digits,
  kept in memory with its venue, good until the venue's night ends at 06:00
  (`nightTz`). The page keeps it in `sessionStorage` and signs in with it
  after a reconnect; a token for another venue, or from before a restart, is
  `expired`, and the page asks for the passcode again.

## §3. The relay: staff sockets (`relay/server.js`)

- A socket is a phone (`join`), a wristband (`wristband`) or staff
  (`staff`), and only one of them. `{t:'staff', venue, code}` or `{t:'staff',
  venue, token}` on a socket that is already a phone or a band is refused
  (`bad staff`); a staff socket's `join`, `wristband` and every phone or
  band message are ignored.
- **Answers**: `{t:'staff', ok:true, venue, token}`, or `{t:'staff',
  ok:false, why}` with `why` one of `no staff page`, `wrong code`, `too many
  tries`, `expired`, `bad staff`.
- **Reports** go to every staff socket of the venue as `{t:'reports',
  reports}` right after sign-in and whenever that list changes: a report
  made, one marked, someone reported arriving, moving area or leaving. They
  ride the room's push, at most one per 100 ms, and a socket is sent a list
  only if it differs from its last.
- **Marking**: `{t:'handled', id, on}` from a signed-in staff socket marks
  that report in its own venue, and every staff socket there sees it.
- **A report from a phone** takes `why` only if it is a string.
- **Rooms** are not reclaimed while a staff socket is signed in to them.
- **Limits** are the same as for any socket: the frame budget, the frame
  size and the room ceiling.

## §4. The staff page (`/staff`)

- A second entry in the same Vite build (`app/staff.html`, code under
  `app/staff/`), served by the relay at `/staff`. It uses the app's colours
  and type (`app/styles.css`), works on a phone or a tablet, and shares no
  state with the app: its only storage is the token in `sessionStorage`.
  Its words are English.
- **Signing in**: the venue, from tonight's shows (`/api/shows`), and the
  passcode (`type=password`). Each refusal has its own words.
- **The list**: the venue, how many are open, and whether the page is live
  or reconnecting at the top. Open reports first, newest first; handled ones
  below, dimmed. Each shows its time; *About someone · P-4F2 · reported 3
  times by 2 people* or *Something else*; *now near the bar · then near the
  bar · reporter was by the stage* (*now: left*); the words, if any; and a
  button, *Handled* or *Reopen*.
- **A new report** plays a short sound, flashes the top of the page, and the
  tab's title becomes `(n) Staff · <venue>`. A browser plays sound only after
  a tap, so until then the page says *Tap anywhere to hear new reports*.
- **Sign out** forgets the token in that tab.

## §5. The phone: a few words

Tapping Report on a person's sheet, or a row of *Report something*, opens a
sheet with an optional field, *a few words for the venue team*, at most 200
characters, and *SEND REPORT*. Sent with or without words; what the phone
says after it is unchanged.

## §6. Privacy and abuse

- **Promise 1**: staff see a person's band, the same words every phone sees
  on their row, never anything finer.
- **Promise 2**: no name, no contact, no photo, no handle reaches staff. The
  staff tag only groups; it cannot be matched with anything a phone shows.
- **The reporter** is never shown. `people` counts how many different
  people reported someone; it says nothing about which.
- **The words** are the reporter's own, up to 200 characters, to staff
  only. A reporter could write a name there; that is theirs to give.
- **A leaked passcode** shows that venue's reports, and nothing else, until
  a new one is set; setting it means a restart, which signs everyone out.
- **Guessing** is bounded by the pairing counters, and each guess costs a
  scrypt that runs off the event loop.
- **Nothing is kept** past the night or a restart.

## §7. Tests and proof

- **Room** (`tests/room.test.js`): a report keeps both bands, the words cut
  to 200 and non-strings as none; `staffReports()` groups by person with
  `times` and `people`, gives `bandNow` and `left`, is newest first, and a
  scan of its JSON finds no internal id, handle, name or contact; `handle()`
  sets and clears; reports of a past night go at 06:00.
- **Relay** (`tests/staff.test.js`): no entry, `no staff page`; a wrong code
  counted, and `too many tries` past the counters; a right code gets a token
  and the list; a report made after sign-in arrives; two staff sockets see
  one mark; a token signs in again after a reconnect, and not at another
  venue; a phone or a band cannot sign in as staff, and a staff socket
  cannot act as either; a room with staff signed in is not reclaimed;
  `why` from a phone is kept only as a string.
- **Script** (`tests/staff-code.test.js`): an entry made from a test
  passcode verifies with the relay's own check, and a wrong one does not.
- **Mutation-checked**, as every relay guard here is.
- **In a browser**, on a local relay with a test passcode: a phone reports
  someone with words; the staff page shows it within a second, with the
  sound after a tap; two staff tabs share *Handled*.
- **Live**: deployed to Fly; the owner makes the real passcode, sets the
  secret and signs in himself.

## Also to change when this is built

- README: *What is not done* loses *Reports go to a log*; *Abuse resistance*
  gains the staff page's guards; *Where this differs from the canvas* gains
  the two items above; *How it is built* says where reports go.
- The phone's sheet line *goes to the venue team, with the time and the
  room* is true from here on and stays.

## Amended while planning

Written into the plan (`docs/superpowers/plans/2026-09-28-staff-reports.md`)
on 28 Sep 2026, after reading the code the spec builds on:

1. **`handle(reportId, on)` is `markHandled(reportId, on)`.** `room.js`
   already has a `handle`: the per-viewer handle.
2. **A venue with a staff page keeps tonight's reports with nobody in it**,
   until 06:00, not only while staff are signed in (§3, *Rooms*). Otherwise
   a team that signs in after the room emptied, or whose page slept through
   a quiet spell, finds nothing. Only venues in `STAFF_CODES` do this, so it
   cannot be used to hold rooms open.
3. **At 06:00 a signed-in staff socket is told `expired` and closed (4004)**,
   not only its token refused: a token until 06:00 means the page too.
4. **A sign-in may also be answered `too many venues`**, as a phone's join
   is, when the relay's room ceiling is reached.
5. **The relay's log line for a report is `REPORT <venue> <id>`.** It printed
   the whole report, words and internal ids included, and §6 says nothing is
   kept past the night; a host keeps its logs.
6. **The offline shell never keeps the staff page** (`app/public/sw.js`), and
   its cache is renamed: it stores every page it fetches as `/`, so without
   this a phone that had opened `/staff` could open the staff page offline
   in place of the app.
7. **The words field is not focused when the sheet opens**, so the keyboard
   does not cover *SEND REPORT*; a sheet's focus trap now includes it.

## Risks

- **A restart** empties the reports and signs staff out, as it empties
  rooms. The page says so and asks for the passcode.
- **A staff device that sleeps** hears nothing; the page has to stay open on
  a screen that stays awake.
- **One passcode a venue** is shared by its whole team; changing it is a
  secret and a restart.
- **A four-digit tag** could give two people the same tag; with the handful
  of people reported at one venue in a night, 65,536 values make that rare.
