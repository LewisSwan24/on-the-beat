# The staff page

Every report reaches the venue's own team at `/staff`
(https://on-the-beat.fly.dev/staff), within a second
(`docs/superpowers/specs/2026-09-28-staff-reports-design.md`).

- **Only where there is a team.** Each view tells the phone whether its
  venue has a staff page (`team`). Where it has none — a venue without a
  `STAFF_CODES` entry, or one somebody typed — REPORT does not pretend:
  it says nobody at this venue reads reports tonight, to find staff or
  security in person, and that blocking still works, and sends nothing.
  Until 5 Oct 2026 every phone said *the venue team has it* at every
  venue. Which venues have a staff page was already told to anyone who
  tries a sign-in (*What is not done*), so this tells nobody anything new.

- **Signing in.** Each venue has one passcode, shared by its team. The relay
  keeps only an entry made from it, scrypt with a salt of its own, in
  `STAFF_CODES`: a JSON object of venue id to entry. No passcode is in the
  repository, the shows, a log or the image. A venue with no entry has no
  staff page. A right passcode gives the tab a token until 06:00 at the
  venue, kept in that tab only, or on the device once its notifications are
  on (below), so a reconnect signs in again by itself; at 06:00 the page is
  signed out and asks for the passcode again. A token belongs to the
  passcode entry it was made under: change the venue's entry and every
  sign-in made under the old one ends at the restart that follows.
- **What staff see.** Each report's time; who it is about, as a staff-only tag
  such as `P-4F2A`, the same all night at that venue and nothing like the
  handles phones are shown, with how many times and by how many different
  people that person was reported tonight — or *Something else*; that
  person's band then and now, or that they left; the reporter's band then;
  and the reporter's own few words, if any. Never a name, a contact, a
  photo, a handle, or who reported. Open reports come first; *HANDLED* dims
  one on every screen at the venue, and *REOPEN* brings it back.
- **A new report** flashes the top of the page, counts in the tab's title,
  `(2) Staff · The Roundhouse, Camden · BRUNO MARS`, and plays two short
  notes once a tap on the page has let it make sound.
- **Notifications, with the page closed or the phone asleep**
  (`docs/superpowers/specs/2026-09-29-staff-push-design.md`). *NOTIFY THIS
  DEVICE* under the header turns them on. A notification says *New report ·
  The Roundhouse, Camden* and *2 open — tap to see them*, never who, where
  or what was said, and a tap on it opens the list. On Android it works in
  Chrome as it is; on an iPhone (iOS 16.4 or later), add the page to the
  Home Screen first (Share, then Add to Home Screen) and turn them on from
  there. A device with notifications on keeps its sign-in until 06:00, so
  the tap finds it signed in, and each sign-in after that turns them on
  again by itself. SIGN OUT reaches the relay: that sign-in, and its
  notifications, end on every tab that shared it.
- **Reports last the night.** A venue with a staff page keeps tonight's
  reports even once everyone has left, so a team that signs in later still
  sees them; at 06:00 they go. A restart or a deploy keeps them, and keeps
  every staff page signed in, unless its venue's passcode entry changed: the
  page signs back in with its token.
- **Telling everyone here.** *SEND TO EVERY PHONE* puts one line, at most
  140 characters, on every phone at the venue: a toast and a buzz, a
  `FROM THE VENUE` banner on the cards screen until that person puts it away,
  and a line on their Tonight. Only the latest stands; *TAKE DOWN* removes it.
  A new one goes at most every 20 seconds a venue, since each one reaches
  every phone there, and the page says how long to wait.
- **Moving the times.** *Show times* holds the night's five times. A row's
  −5 and +5 move it and every time after it, as a late start does; a time can
  also be typed. Nothing goes until *SAVE TIMES*, and the relay takes only five
  clock times in the night's order. Every phone's phase bar and countdown
  follow at once, with a toast saying what moved, and the venue list shows the
  moved times to anyone choosing a show. *BACK AS LISTED* undoes it. When
  two staff screens are open and one saves while the other is part way
  through a change, the other keeps its change and says so: *SAVE TIMES*
  puts it instead, *UNDO* shows what was saved.
- **Putting the first song's spelling right.** Naming the same song again,
  spelled better (`desire lines`, then `Desire Lines`), changes the words
  everywhere but not when it was named: no phone is told twice, Tonight's
  line is corrected in place, and no wristband plays it again. Another song
  is a new naming. Each panel also says aloud, for a screen reader, what
  the relay took.
- **Closing a card for tonight.** *Tonight's cards* lists the cards, each
  open or closed. *CLOSE* asks once, since whoever is showing that card goes
  off; the last open card cannot be closed, and *OPEN* puts one back. Phones
  lay out only the open cards, and a phone whose card closed says so: "The
  venue closed LET'S DANCE for tonight." A closed card cannot be armed from
  a phone or a wristband, lists nobody, and takes no wave, like or dance
  back; with LET'S DANCE! closed nothing goes on the floor. The wristband's
  show names the closed cards (`closed: "song,dance"`, only when there are
  some), and SIDE steps over them, out of NOT NOW too. A band flashed before
  that knew the field skips it, still steps through every card, and shows
  NOT SENT on a closed one, as it does for any refusal.
- **What staff say lasts the night.** The first song, a notice, moved
  times and closed cards stay with nobody in the venue yet, so times moved
  before doors are there when they open; a restart keeps them; 06:00 takes
  all of them back. A
  staff screen signed out at 06:00 cannot say anything more, even in the
  moment before its socket closes.

To give a venue its page, make its line and set it on the relay:

```
npm run staff-code
```

It asks for the venue's show id and a passcode of at least twelve
characters, twice, or Enter for one made for you: three groups of four
letters and digits, such as `k7m2-q9xr-4twd`, shown once in that terminal
and kept nowhere. It never shows a passcode you type, and prints one line
such as `"roundhouse-bruno-mars": "scrypt$16384$8$1$…"`. Put every venue's line
between braces, separated by commas, in a file outside the repository as
one line, `STAFF_CODES={"roundhouse-bruno-mars": "scrypt$…"}`, then:

```
flyctl secrets import --stage < staff-codes.env   # PowerShell: Get-Content staff-codes.env | flyctl secrets import --stage
flyctl deploy --ha=false --remote-only            # between nights: it restarts the one machine
```

and delete the file. A mistake in `STAFF_CODES` stops the relay starting,
with the venue named and the entry never printed. Locally,
`STAFF_CODES='{…}' npm start`; under `npm run dev` the page is
`http://localhost:5178/staff.html`.

**To sign everyone out at a venue**, or to close a passcode that has
leaked, make its line again (with the same passcode if it is to stay: the
salt is new, so the entry is), put it into `STAFF_CODES`, and set the secret
and deploy as above. The machine restarts, and every sign-in made under the
old entry ends with it: the page asks for the passcode again, and the
notifications those sign-ins held stop. The log says how many, and no venue.
