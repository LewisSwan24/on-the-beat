# Where this differs from the canvas, on purpose

- **It asks for a first name**, once, after the venue. The canvas never asks,
  but someone has to be named when two people both say yes. A contact is
  asked for only the first time you keep someone, and only shared if they
  keep you too.
- **A contact both kept can be saved to the phone's own contacts.** The
  canvas shows it and stops there. The owner chose on 3 Oct 2026 a SAVE TO
  CONTACTS button wherever a contact both people kept is shown: on S11, in
  the AFTER list and under *kept from other nights*. The card (vCard 3.0,
  `app/lib/vcard.js`) is made on the phone from what it already holds and
  goes to the share sheet where the browser can share a file, or downloads
  otherwise; nothing is sent. A number goes in as a number, an email or a
  web address as itself, and a handle in the note with where they met.
- **FIRST SONG? gets its answer.** The canvas asks for a pick and never says
  what opened. The owner chose on 3 Oct 2026 that the venue's staff name it:
  the staff page has a *First song* panel with the night's setlist as chips,
  *NAME IT*, and *TAKE BACK* for a mistake. *NAME IT* asks once first —
  *SAY IT* or *NOT YET* — because a wristband that called it has sounded
  before a take back can reach it; changing the track asks again. Every phone at the venue then
  shows `THE OPENER WAS` above its own pick, *You called it.* or *Not this
  time.*, and how many here called it, never who; the wall marks a matching
  pick `CALLED IT`, which is no more than the pick on that row already says.
  A pick matches whatever its case, accents, punctuation or spacing
  (`app/lib/opener.js`), and is held as it was when the answer came, so
  changing it afterwards calls nothing. Tonight keeps one line for it. Only a
  signed-in staff page can name it; a restart keeps it, and 06:00 takes it
  back with the night.
- **The venue can tell everyone something, and move the times.** The canvas's
  times are the show's as listed, and nothing reaches every phone at once. The
  owner chose on 3 Oct 2026 that a signed-in staff page can send a notice to
  every phone at its venue and move the night's times (see "The staff page").
  A notice is the venue's own words, the same for everyone, and says nothing
  about anyone in the room.
- **Venue distances are gone.** The canvas shows "40 m" beside each show;
  that needs the phone's location, and promise 1 says nobody sees where you
  are. The list shows doors times instead.
- **A phone without a wristband is a whole way in.** The canvas draws every
  person with a band. The owner chose on 5 Oct 2026, after a walk through as
  a user, that a phone alone gets what a band would have given it: the
  meeting number on its match screens, with *no wristband? hold this screen
  up*, and *Look for a wristband or phone showing* on every phone, since
  nobody is told who wears one; the armed SAY HI reads *Find blue screens &
  wristbands*; a wave is a toast and a dot until it is seen. How this works
  also says what the three cards do and that a match needs both.
- **Real empty states** where the canvas always had a crowd: nobody saying
  hi, no picks on the wall, an empty floor.
- **A camera that is refused** says so and offers to try again; nothing is
  sent until you send it. "Just for me" saves the clip to the phone.
- **The wristband shows a QR code while it pairs**, not only the four letters
  revision 6 draws. `SCAN IT INSTEAD` needs something to scan, and the code
  also lets a phone's own camera open the app.
- **A second button, and other timings.** Revision 6 gives the wristband a
  single button — a 3 s wake, and a 1 s hold for NOT NOW — and no second
  action. The owner chose on 24 Sep 2026: the side button (KEY2,
  M5Unified's `BtnB` on every supported board, as a StickS3 and a StickC Plus
  bore out; on a StickC Plus the power button only turns the face over and,
  held, turns the band off — *Off and on*)
  changes the armed card, so the phone can stay in a pocket; a press wakes the
  face for six seconds, long enough to read a preview; NOT NOW is a hold of
  1.5 s, longer than a bump in a crowd. Every timing is a named constant, in
  `band_logic.h` and `app/lib/wrist.js`, because they are guesses until worn.
- **A connected wristband keeps its person in the room for up to an hour**
  without their phone, where the canvas has the phone as the only way in.
- **Pairing ends with a check** shown on the wrist and confirmed on the phone.
  Without it a decoy code would pair silently, and with `set` a wrongly paired
  wristband could make someone visible.
- **The check can be turned away on the wrist.** Revision 6 has no check,
  and its wristband takes no action while it pairs. The owner chose on 28 Sep
  2026 that holding the face button on the build's check number turns that
  check away, so someone who read the letters off a wrist and typed them
  first holds its check only until its person holds the button, not for a
  minute.
- **The wristband flashes and chirps.** Revision 6 §8 rules out vibration or
  light patterns that pretend to carry a message. The owner chose on 25 Sep
  2026 that the band flashes and sounds, and none of it pretends: each
  reaction answers something the wearer just did, or says one fact about the
  band. The two about another person are the meeting call, for a number the
  band already shows, and a wave's call.
- **The wristband says that someone waved.** Revision 6 §8 keeps names,
  photos and other people's picks off the wristband, and it showed nothing
  about anyone else but the meeting number. The owner chose on 25 Sep 2026
  that it also says that someone waved at its person and how many wait, and
  can wave back to the newest. Still no name, no photo, no pick and no area.
- **A meeting ends when both say they found each other.** Revision 6 shows
  `MEET` and the number for as long as the meeting lasts, and S11 has no way
  to say a meeting happened. The owner chose on 26 Sep 2026 a side hold on the
  band, or `WE FOUND EACH OTHER` on S11, counted only when both say it: the
  meeting face gains `FOUND: WAITING`, both bands a *found* reaction, and
  Tonight's `met` counts meetings found, not matches.
- **Near is the five heard most strongly, not everyone heard.** Revision 6
  lists the people whose wristband yours can hear. On a crowded floor that is
  nearly everyone, so the list is the five heard most strongly, which is also
  S5's own limit of five. People without a band cannot be heard, which says
  nothing about where they are, so they are listed as before; the owner chose
  that on 26 Sep 2026.
- **A marker names an area only when it is heard clearly.** Revision 6 takes
  the loudest marker. Far from every marker the loudest is still some marker,
  heard faintly across the room, so it names a band only at -56 dBm or
  louder, and otherwise the person stays `in this room`: the owner chose on
  27 Sep 2026 that it is better not to say than to say it wrong. A third
  marker, `somewhere out the back`, which the prompt's list of bands already
  has, is allowed; revision 6 names only the bar and the stage.
- **A staff page** at `/staff`, which the canvas does not have: someone has
  to read the reports the canvas says go to the venue team. The owner chose
  on 28 Sep 2026 a page per venue, signed in with a passcode only he sets.
- **Report asks for a few words**, optional and at most 200 characters. The
  canvas's Report is one tap. The owner chose on 28 Sep 2026 to ask, since
  "someone was reported near the bar" alone gives staff little to act on.
- **The band is landscape.** Revision 6 draws a portrait band with a strap
  stub above and below. The owner's watch clip holds a Stick across the
  forearm, long side along the arm, and he chose on 28 Sep 2026 that both
  bands go landscape: every face is laid out at 240 x 135, sized from the
  canvas's band turned, with the pairing code on the left and its letters
  beside it. Which side is up is held, not worked out (see the firmware
  section). The browser stand-in at `/band` stays portrait, as the canvas
  draws it.
