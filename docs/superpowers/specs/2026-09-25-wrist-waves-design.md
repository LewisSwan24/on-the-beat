# Waves on the wristband: told on the wrist, answered on the wrist

Date: 25 Sep 2026. Decided with the owner section by section the same day,
then reviewed against the code and settled with him again ("The owner's
decisions after review"). It builds on the reactions spec
(`2026-09-25-wrist-reactions-design.md`): its sounds, flashes, calls, sound
switch and NOT NOW silence. Build it after that one.

Approved by the owner on 25 Sep 2026.

The owner said that quick finding, matching and staying in step between two
or more wristbands matters a great deal. His flow: a WAVE sent on a phone
reaches the other person's wristband; once they answer, both wristbands
and both phones show the meeting.

## What is already true, and what is missing

Checked on 25 Sep 2026, in the code and on the two real bands:

- **Waves are real, not simulated.** A WAVE on the phone goes to the relay
  (`relay/room.js` `wave()`). The other phone's row turns into "… waved at
  you" with WAVE BACK (`app/screens/Hi.jsx`). A wave back makes a match
  (`matchIfMutual()`), both phones buzz and show it, and both bands show
  the same meeting number. The StickS3 and the StickC Plus both showed
  MEET 22 at 16:08:23, and did it again that evening through the always-on
  relay, with two real devices.
- **In the afternoon test the second person was a stand-in** ("Ben", a
  browser tab driven by hand), which is why it looked simulated.
- **The band takes no part in a wave:**
  - the receiver's band never hears of it;
  - no band can wave back;
  - the sender's band shows nothing;
  - the receiver's phone does not even buzz for a wave, only for a match
    (`app/App.jsx`).
- **Nobody's area is set.** The phone never says where in the room it is:
  `app/lib/net.js` joins without one, and nothing sends `band`. So every
  row reads *in this room* (README, "Proximity"), and an area on the band
  would say nothing.
- **A wave is kept for the night.** Only a block removes it (`room.js`
  `block()`). A waver who stops showing blue, goes NOT NOW or leaves drops
  out of the lists, and is back in them with the same wave on return.

Phase A deferred "waving back from the wrist", because the band showed
nothing about other people except the meeting number. This spec is that
phase.

Decisions made while writing this down are marked **(new)** for the owner's
review.

## Goal

- A wave reaches the receiver's wristband at once, as a short call.
- The receiver answers on the wristband or on the phone, whichever is to
  hand.
- A wave back makes the match, and both wristbands and both phones show it
  in the same moment.
- The band says that someone waved and how many are waiting: never who,
  never where.

## Not in this spec

- **Sending a wave from the band.** Waves are still sent from the phone's
  "Saying hi near you" list.
- **Likes and dances on the band.** A like is never shown to anyone, and a
  dance back is a camera clip.
- **Names, photos, picks or areas on the band.** Still never there.
- **Blocking from the band.** Blocking stays on the phone.
- **Areas.** Saying where in the room someone is waits for proximity
  (README, "Proximity").

## The owner's decisions after review

A review against the code on 25 Sep 2026 found three things the first draft
got wrong:

- the band could not read a show carrying many waves: a frame over 480 bytes
  is dropped whole (`firmware/src/main.cpp`);
- every area reads *in this room*;
- a call that blinked until a key would tell a waver watching the wrist that
  their wave had been seen.

The owner then chose:

1. **A short call that ends by itself.** *hello* and three blue flashes,
   whatever the keys do. How long it lasts never says whether it was seen.
2. **A count, not a list.** The band shows that someone waved and how many
   are waiting. A SIDE hold waves back to the newest, usually the one that
   just called. The others stay on the phone, where WAVE BACK answers each.
3. **The band may say yes without the phone.** A band answers for its
   person even when their phone is locked in a pocket or gone. So a lent or
   taken band can make a match for them (Risks).

Two more follow the phone, and are marked **(new)**:

4. **Waves only while showing SAY HI.** The band carries waves only while
   its person shows blue, as the phone lists them only on its SAY HI screen
   (`app/lib/follow.js`).
5. **FACE opens them.** With someone waiting, a FACE press on the lit face
   (HI, or a meeting number) opens the wave face. That press does nothing
   there today.

A second review against the code added one more, also marked **(new)**:

6. **Keys wait out the call.** During its three flashes a key only ticks,
   and only a FACE hold still acts: it goes NOT NOW. A meeting calling
   underneath is answered by the first key after the flashes. That is how
   decision 1 holds when someone does press.

## Where this departs from the canvas, on purpose

Revision 6 §8 keeps names, photos and other people's picks off the
wristband, and `relay/band.js` promises that the band shows nothing about
anyone else except the meeting number. The owner chose on 25 Sep 2026 that
a band also says that someone waved at its person, and how many are
waiting. It still shows no name, no photo, no pick and no area. The
`relay/band.js` promise and README's "Where this differs from the canvas,
on purpose" say so.

## §1. The receiver's band

1. **What counts as waiting.** The people the receiver's phone lists as
   "waved at you" and not yet waved back: people showing blue (SAY HI),
   visible to them, who waved at them.
   - A wave reaches only someone who shows SAY HI themselves (`wave()`).
   - The band carries the waiting ones only while its person still shows
     SAY HI (decision 4).
   - In NOT NOW there are none: an invisible person is in nobody's lists
     and sees nobody's.
2. **The call.**
   - A wave newer than any the band has called for plays *hello* and
     flashes the HI blue three times (§3, the wrist).
   - **Keys do not show during it (new, decision 6).** Reactions rule 6
     lets a key end a flash. This one always plays its whole length, and
     during it a key only ticks:
     - a press, a release, and a SIDE hold that comes due do nothing else,
       whenever the key went down: no look, no wave face, no chooser step;
     - a FACE hold still goes NOT NOW, dark at once as NOT NOW always is
       (reactions rule 1);
     - a meeting calling underneath is not answered: the first key after
       the flashes answers it (an exception to reactions rule 4, which
       lets a key answer during another reaction's flash).

     A later reaction may still replace the call, as rule 6 says. So how
     long the flashes last, and what follows them, says nothing about
     whether they were seen.
   - **Waves that arrive while it plays join it:** no second *hello*, no
     longer flash.
   - **A wave never calls twice.** A waver who drops out and comes back
     does not call again: their wave is not newer.
   - **While the wave face is open,** a new wave calls nothing: the count
     shows it **(new)**.
   - **During a look, a choice, a send or a wave back,** it plays *hello*
     at once and its flashes when the face rests, as a meeting does
     (reactions rule 4).
   - **A meeting call and a wave call replace each other,** whichever
     comes later, and a meeting still calling blinks again when the wave's
     flashes end (reactions rule 6, "The blink comes back").
   - **Both in the same show,** after a reconnect for instance, play in this
     order: the meeting's *jingle*, then *hello* and the wave's flashes,
     then the meeting's blink **(new)**.
   - **With the sound switch off,** the flashes play and the sound does not
     (reactions rule 3).
3. **The wave face** opens with a FACE press, on its release as a wake is,
   when:
   - its person shows SAY HI, and the face is resting, lit with HI or with
     a meeting number;
   - the link is up;
   - someone is waiting (decision 5).

   Otherwise a FACE press does what it does today. While a meeting calls,
   a FACE press only answers the meeting (reactions rule 4); the next one
   opens the wave face.

   The face:
   - black, at the chooser's light, with the HI blue for the words. It
     looks like the chooser's preview of HI but says its own words
     **(new)**;
   - the big line is SOMEONE WAVED;
   - the small line is HOLD SIDE: WAVE BACK, or 3 WAITING - HOLD SIDE when
     several are waiting (9+ past nine).
4. **In the wave face:**
   - **SIDE hold:** wave back to the newest waiting (§3). It plays
     *double*, as a SIDE hold that sends does.
   - **SIDE press, FACE press, or CHOOSE_MS (6 s) with no key:** close. A
     SIDE press here never starts the card chooser **(new)**.
   - **FACE hold:** NOT NOW, as always.
   - **The count follows the shows.** The face closes when:
     - nobody is left waiting;
     - its person stops showing SAY HI;
     - the link drops, or the band stops believing its show;
     - the show is not about its person: the letters, the check, waiting,
       away or the test light.
5. **The wave back, until it is answered.** The face shows WAVE BACK /
   SENDING, as a sent choice shows SENDING. Keys do what they do while a
   choice is sending: SIDE nothing, a FACE hold NOT NOW.
6. **The result.**
   - **It lands.** The relay says so, and the face rests. The meeting
     arrives as a show with the new number: both bands play the reactions
     spec's meeting call, and both phones show the match. The meeting is
     the confirmation.
   - **Already matched.** Two people already matched tonight make no new
     meeting. The relay says the wave landed, and the face just rests:
     `matchIfMutual()` returns the match they already have.
   - **It does not land.** The band shows:
     - NOT SENT, with *low* and the orange flash, when the waver is gone;
     - CHANGED, with *fall* and the red flash, when its own person's state
       moved since the show (§3);
     - NOT SENT when nothing comes back within CONFIRM_MS, and the socket
       is dropped, as for a choice.
   - **They count as a choice under way.** The wave face and the wave back
     do, for reactions rules 4 and 6: a meeting arriving then plays its
     jingle at once and blinks when the face rests, and a warning waits.

## §2. The sender, the phones and the meeting

1. **Sending stays on the phone,** in the "Saying hi near you" list.
   - The sender's band neither sounds nor flashes: a change made on the
     phone is silent on the wrist (reactions rule 2).
   - The row's line after waving changes from "Waved — they'll see a blue
     dot" to "Waved — they'll be told" **(new wording: it says nothing about
     whether they wear a band)**.
2. **The receiver's phone.**
   - Without a live wristband, it buzzes once for each new wave **(new)**.
     A band that is paired but not live (flat, off, out of reach) does not
     count: its call would never play.
   - With a live one, the band calls, and the phone does not buzz as well.
3. **The match,** whichever side answered and wherever.
   - Both phones buzz and show the match: the name, the meeting number and
     the spot, as today.
   - Both bands show the same MEET number at the same moment and play the
     meeting call until each wearer presses a key.
   - Two people raising their wrists to show the same number is how they
     find each other.
   - The number goes after fifteen minutes, or at once when both say they
     found each other (`2026-09-26-wrist-found-design.md`).
4. **A wave nobody answers** is never reported as declined (promise 4).
   - It stays for the night unless one of them blocks the other.
   - While the waver is not showing blue, not visible or not in the room,
     the wave is in nobody's list. It is back if they return, and it does
     not call again.
5. **Blocking stays on the phone.** A blocked person's wave leaves the
   band's count at once, as it leaves the phone's list.

## §3. The relay, the wrist and the phone

### The relay

- **The room numbers each person's waves by the clock.** `waves` becomes a
  map from `a>b` to a number: the time the wave was made, in ms, and at
  least one more than the last number person b received, so two waves in
  the same millisecond still differ. A second wave by the same person keeps
  its number **(new: a count from one would start again with the room, after
  a relay restart or a room reclaimed while nobody was in it. The band is
  claimed back without letters and keeps the number it called for, so the
  next waves would never call. A time only goes up)**. Rooms take the
  relay's clock (`createRoom({ now })`), so the tests' clock drives the
  numbers; today `relay/server.js` makes rooms without it.
- **Two new room functions.**
  - `room.wavesAt(id)` lists the rows the person's phone shows as "waved at
    you" and not waved back, each with its number, newest first.
  - `room.wavedAtYou(viewer, h)` says whether the person behind a handle
    has waved at the viewer.
  - `wavesAt()` and `viewFor()`'s near list come from one helper, so the
    band can never count someone the phone does not list **(new)**.
  - `wave()` keeps its contract: false when refused, null when taken, the
    match when it made one.
- **Shows carry the waiting waves.** A show about a paired person who shows
  SAY HI (`armed: 'hi'`, a meeting show included) gains
  `waves: { ref, n, seq }` when anyone is waiting:
  - `ref` is the newest waiter's handle, as the person's own phone knows
    them. Handles are per viewer and already reveal no one.
  - `n` is how many wait.
  - `seq` is the newest one's number.

  Every other show carries no `waves`, and the wrist reads that as nobody
  waiting.
  - The object is the same size however many wait, so no show outgrows the
    band's 480 bytes (`firmware/src/main.cpp`) **(new: the review measured
    nine waves at 527–668 bytes, which the band drops whole)**.
  - `wavesAt()` and the phone's rows come out of the same room, so the band
    and the phone are always told the same thing.
  - Shows are sent only when their text changes, so each change in the
    waiting sends one show.
- **The band answers.** A wave back from the band is
  `{ t: 'wave', ref, basis }`, where `basis` is the rev its show carried.
  The relay takes it in this order:
  1. **Anything but exactly that is dropped whole, unanswered,** as a
     malformed `set` is: `ref` must be 10 hex characters and `basis` an
     integer.
  2. **At most one wave a second per band.** Another is refused `too fast`
     before anything is looked up, and every wave that gets this far is
     stamped, refused or not **(new: a set is stamped only when it lands,
     but resolving a handle costs a pass over the room, so a flood of
     made-up refs must not buy one each)**. Waves keep their own stamp, so
     a set and a wave do not share a second.
  3. **`unpaired` and `no room`,** as for a set.
  4. **`changed`** when `basis` is not its person's rev, or they no longer
     show SAY HI. NOT NOW moves the rev too.
  5. **`gone`** when the handle is not someone who waved at its person, or
     `room.wave()` refuses: the waver left, stopped showing blue, went NOT
     NOW or blocked. A block must stay silent (promise 4), so the band
     cannot tell it from leaving. A band never starts a wave: with no wave
     to answer, it records nothing **(new)**.
  6. **Otherwise it lands.** `room.wave()` takes it as its person waving,
     as the phone's WAVE BACK does. The relay answers
     `{ t: 'wave', ok: true }` and pushes, as after any change.

  Refusals are `{ t: 'wave', ok: false, why }`. A refused wave changes
  nothing and sends nothing to anyone else.
- **As in phase A, the band only asks and the relay decides.** A band
  speaks for a person only with the secret of its pairing, so no other band
  can wave as them.

### The wrist (both twins)

- **It remembers, in RAM, the newest wave number it has called for,** so a
  reconnect does not call again. It forgets it at letters. A band that
  restarts calls once for whoever is already waiting. The numbers are times
  in ms, too big for 32 bits: both twins keep them as 64-bit integers
  **(new)**.
- **The call.** A show whose `waves.seq` is above that number calls (§1.2),
  unless a wave call is playing. Either way the number moves up to it. A
  show that differs from the last only in `waves` causes no other reaction.
- **Two new modes.**
  - The wave face (§1.3–4).
  - The wave back (§1.5), which is answered like a sent choice:
    `{ t: 'wave', ok: true }` rests; `ok: false` shows CHANGED for
    `changed` and NOT SENT otherwise; CONFIRM_MS shows NOT SENT and drops
    the socket.
- **New table entries,** held equal in both twins as the others are:
  - the moment "a wave newer than any called for": sound *hello*, light the
    HI blue, 3 × 500 / 500, not ended by a key;
  - the sound *hello*: 1568/60, 2093/120 **(new: a starting point, tuned by
    ear with the rest)**;
  - the words: SOMEONE WAVED, HOLD SIDE: WAVE BACK, N WAITING - HOLD SIDE,
    WAVE BACK and SENDING.

### The phone

- **The buzz.** A pure function in `app/lib` takes the view and the handles
  already seen, and returns the new "waved at you" rows.
  - The phone buzzes once when there are any and its wristband is not live
    (`view.me.wristband.live`).
  - The seen handles are kept in the night's record, as matches are, so a
    reload does not buzz again.
  - Rows are marked seen while the band is live too, so a band that later
    goes out of reach does not bring a buzz for waves it already called
    **(new)**.
- **No new venue behind the band's back.** A band that can say yes must not
  be left holding a person its owner has walked away from. Today that
  cannot happen: the venue list is reached only before joining, which
  needs a name (`app/App.jsx`), or after the relay has answered `left`,
  which unpairs the band. A way to change venue, if one is ever added,
  goes through leaving first (`leftVenue()`).
- **The row's new line** after waving (§2.1).
- **"How this works"** gains a line: someone waving shows on your
  wristband; press its face to see, and hold its side to wave back.

## §4. Tests and proof

- **The shared table** (both twins):
  - **the call:**
    - once per new number, and joined by waves during it;
    - keys during the flashes: presses, releases (a key already down when
      the call began included) and a SIDE hold only tick; a FACE hold goes
      NOT NOW; a meeting calling underneath is answered by the first key
      after the flashes, not before;
    - replaced by a meeting; replacing a meeting's blink, which comes back;
    - a meeting and a wave in one show: *jingle*, then *hello* and the
      flashes, then the blink;
    - nothing on a reconnect, nothing for a waver who returns;
    - forgotten at letters, so a new person's first wave calls;
    - a 13-digit number read whole, in both twins;
    - none in NOT NOW, and no sound with the switch off;
    - nothing while the wave face is open;
    - *hello* at once and the flashes at rest, during a look, a choice, a
      send or a wave back;
  - **the wave face:**
    - opened by a FACE press, on release, on the resting HI or meeting
      face with someone waiting and the link up, and by nothing else;
    - not while a meeting calls: that press answers the meeting;
    - the count, and 9+;
    - closing by a SIDE press (no chooser), a FACE press and CHOOSE_MS;
    - a FACE hold's NOT NOW;
    - closing when nobody waits, when SAY HI goes, at the letters, the
      check, waiting, away or the test light, when the link drops, and out
      of reach;
  - **the wave back:**
    - the SIDE hold's frame, with ref and basis, and *double*;
    - SENDING;
    - each answer: ok rests, `changed` shows CHANGED, the rest NOT SENT;
      CONFIRM_MS shows NOT SENT and drops the socket;
    - a meeting arriving meanwhile jingles at once and blinks at rest;
  - **a show differing only in `waves`** causes nothing but the call.
- **The relay:**
  - **`wavesAt()`:**
    - lists exactly the phone's waiting rows, newest first;
    - leaves out, as the phone does, a waver who is invisible, has left, is
      not on SAY HI, or is blocked either way; one already waved back to;
      and everyone while the receiver is in NOT NOW;
    - numbers are times that only go up: past leaving and coming back, a
      relay restart, and a room reclaimed while empty. After each, a new
      wave still calls a band that kept its old number. The restart test
      gives the second relay a later clock;
    - a second wave by the same person keeps its number;
    - a block removes the wave;
  - **which shows carry `waves`:**
    - only a paired person's who shows SAY HI, meeting shows included;
    - none in NOT NOW, on the other cards, on the letters, the check,
      waiting, away or the test light;
  - **size:** the longest show the relay can make fits the band's buffer,
    whose size the test reads from `firmware/src/main.cpp`. The longest is
    built from the worst escapes, not the widest letters: a pick of
    characters JSON writes as six bytes each, which `clip()` keeps;
  - **a band's wave makes the match:** it is answered ok, and both bands'
    next shows are the meeting;
  - **each refusal has its own `why`:**
    - `unpaired`, `no room` and `too fast`;
    - `changed`: the rev moved, the person is not on SAY HI, or they are in
      NOT NOW;
    - `gone`: not a waver, left, stopped showing blue, NOT NOW, blocked. A
      block reads exactly like leaving;
  - **`too fast` comes before any lookup.** Of two made-up refs in one
    second, the second is refused `too fast`. A malformed wave is dropped
    unanswered;
  - **a band never starts a wave.** Its wave at someone who never waved
    records nothing, and nothing appears on that person's phone;
  - **a refused wave sends nothing** to the waver's phones;
  - **a hello without the pairing secret** cannot wave for anyone.
- **The phone:**
  - the buzz function returns only new rows, once each;
  - no buzz with a live band, none again after a reload, and none for rows
    seen while the band was live once it goes out of reach;
  - the new line.
- **Mutation checks, as in phase A.** Break each guard, and exactly its
  test goes red.
- **In a browser:** two `/band` stand-ins and two phones. A waves, B's
  stand-in calls, B opens the wave face and waves back on it, and both show
  the meeting.
- **On the real bands, with the owner.** Two real people, no stand-in: his
  phone and his second phone or tablet, each paired to one of the StickS3
  and the StickC Plus.
  - A waves on the phone. B's band chirps and flashes blue three times.
  - B presses FACE, sees SOMEONE WAVED, and holds SIDE. Both bands show the
    same MEET at once, and both phones show the match.
  - Then a third person, a browser tab, waves at B too, to see the count.
  - At the end, every band is unpaired from any stand-in.

## Also to change when this is built

- **The reactions spec,** "Where this departs from the canvas": the meeting
  call is no longer the only reaction about another person.
- **README's table of what each yes shows** (the "blue dot" row), and the
  same words at the top of `relay/room.js`.
- **`relay/band.js`'s promise,** and README's "Where this differs from the
  canvas, on purpose" (above).
- **README "Abuse resistance":** the band's yes for its person (Risks).

## Risks

- **The wave back from the band is blind.** It answers the newest waiting,
  with no name, no photo, no pick and no area. The owner chose it so the
  phone can stay in the pocket. Names come only with the match, and
  blocking stays one tap away on the phone.
- **A band says yes for its person, with or without their phone**
  (decision 3). Until now a band could only arm or hide its person. A lent,
  taken or forgotten band can now make a match, which shows both names, and
  a band holds its person for up to an hour with no phone (README). Blocking
  undoes it.
- **The call says that a wave arrived.** Someone watching the wrist sees
  three blue flashes when their wave lands. Nothing on the band says whether
  it was seen: the flashes play their whole length, and keys do not show
  during them. NOT NOW is the exception: it always shows, and it hides the
  wearer from everyone anyway. Opening the wave face afterwards is seen as
  looking at a phone is.
- **A crowd of new people waving can call a band again and again.** Waves
  during a call join it, NOT NOW stops them all, and each waver can be
  blocked.
- **Timings are guesses until worn.** They are constants for that reason.
