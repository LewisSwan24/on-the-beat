# Venues people make, and finding the right one: design

13 Oct 2026. From `main` 175dab6.

## Why

The venue list is four London shows in `relay/shows.json`. A phone at any other
gig can only type a name (USE WHAT I TYPED, `app/screens/Onboard.jsx`). That
makes a room with no act, no times and no place, and nobody else sees it in a
list. To reach the same room, they have to type a name that folds to the same key
(`app/lib/typed.js` `roomOf`).

We asked for four things after the four-user test:

1. A venue that is not listed still works.
2. Finding the venue without scrolling or typing (automatic location).
3. Knowing where you are after joining (finding F4; the act and venue line
   landed in 175dab6).
4. A warning when you are in the wrong room.

We chose the data source from three options: **A**, the people on site make the
room. The other two were OpenStreetMap names (B) and a ticketing API (C). This is
not a new card or new product state between people, so it is not held for the
team: our 「直接做」.

## Decisions (his picks, 13 Oct 2026)

| Question | Pick |
|---|---|
| What making a room asks for | The venue's name. The act is optional, and so are the times. Anyone in the room can add missing ones later. |
| Who may add or change a field | The first one in wins. A filled field cannot be changed. Two phones saying it is wrong clear it. |
| Where location is worked out | On the phone. The relay sends every room tonight with its rough place, and the phone sorts by distance. A phone's place leaves it only once: rounded, as the place of a room it makes. |
| What says "wrong room" | Location, on the phone. More than 500 m from the room's place, on joining and each time the app comes back. |

## 1. Data and rules

**A venue card** belongs to one room, keyed by its room key. Its fields:

| Field | Rule |
|---|---|
| `venue` | Required, plain text, at most 80 characters. |
| `act` | Optional, plain text, at most 60 characters. |
| `doors`, `support`, `break`, `headline`, `end` | Optional. `HH:MM`, read as the night reads times (before 06:00 is after midnight). |
| `lat`, `lon` | Optional. Rounded by the relay to 0.001° (about 110 m), whatever the phone sends. |
| `made` | Always `true` on a card, so a phone can tell it from a listed show. |

- **First in wins.** Each field takes its first value. A fill for a field that is
  already set is refused, and so is a fill that would change it.
- **"Wrong" reports.** When two different people in the room report the same
  field, it is cleared and can be filled again. Two reports on `venue` hide the
  card from every list instead. The room stays for whoever is already in it, and
  the key is never listed again tonight.
- **Listed shows are fixed.** A card whose key is a listed show's id is refused.
  Listed shows change only through the shows file (`SHOWS`). That file gains
  optional `lat`/`lon` numbers. The four bundled shows get their venues' places.
- **Limits.**
  - One address (an IPv6 address counts as its /64, `relay/address.js`) may make
    at most 3 cards a night.
  - The relay holds at most 200 cards a night. Past that, a card is refused and
    the phone says so.
- **Lifetime.** Cards are in the night file (`NIGHT_FILE`), so a restart carries
  them. 06:00 clears them with the rest of the night.
- **No staff.** A made room has no staff page and no passcode. A report there
  meets today's "No venue team on the app here" sheet (`REPORT.noTeam`).

## 2. On the phone

1. **Choosing a venue.**
   - **Locating.** A FIND ME button sits at the top. If location was granted
     before (`navigator.permissions`), the phone locates at once, with no tap.
   - **The list.** Rooms tonight within 2 km come first, nearest first, each
     showing its distance ("300 m"). The nearest is chosen already, so one tap
     on THAT'S THE ONE joins. Further rooms and rooms with no place follow. A
     made room's row says it was made here tonight.
   - **Fallbacks.** Search works as today. Without a location, the screen is
     today's screen.
2. **Not in the list: NOT HERE? ADD IT.**
   - The form asks for the venue's name, filled with what was searched, and the
     act if known.
   - **Before making it,** rooms within 2 km show first under "Is it one of
     these?", so a near-duplicate is joined rather than made.
   - Making it joins the room at once. The card carries the phone's rounded
     place if location was granted.
3. **After joining.**
   - The home line reads act · venue (F4).
   - For a made room with an empty field, the line ends in "add the act" or
     "add the times". This opens a sheet that fills only empty fields.
   - The same sheet has "something's wrong here", which reports one field.
4. **Wrong room.**
   - **When it checks:** on joining, and whenever the app comes back to the
     front (`visibilitychange`).
   - **The warning:** with a location and a room place more than 500 m apart,
     a banner tops the deck: "You're 3 km from Moth Club. Wrong place?"
   - **The answers:** SEE NEARBY goes back to choosing. I'M HERE stops the
     warning for that room tonight; that is kept in the night's state.
   - **No warning** when the room has no place or there is no location.
5. **The phone's place** is held in memory only. It is never written to
   storage, and the only place it is ever sent is the rounded place of a room
   being made.

## 3. Relay, errors, tests

**Messages** go on the existing socket. No new HTTP endpoint writes anything.

- **Making a room** = joining a new key (today's path), then
  `{t:'fill', venue, act?, lat?, lon?}` as the first fill. The relay checks the
  address limit and the night cap there.
- **Adding later:** `{t:'fill', <field>: value, …}`. Success is the room's
  next view carrying the field. A refusal is the relay's usual
  `{t:'error', why}`, with `why` one of `fill taken`, `fill limit`,
  `fill full`, `fill listed` or `fill bad`.
- **The per-address count** is in memory. A restart starts it again; the
  200 cap is counted from the rooms, so it holds across a restart.
- **Saying it is wrong:** `{t:'wrong', field}`. Each person counts once per
  field.
- **`/api/shows`** returns the listed shows (with `lat`/`lon` when the file has
  them), then tonight's visible cards, each with `made: true` and its key as
  `id`. Moved times (staff) still lay over listed shows as today.
- **Views:** the room's view carries its card (`card`), so the people inside
  see a fill at once.

**Errors.**

- **Location** denied, or no fix in 8 s: one line ("Can't find you — pick from
  the list"), then the plain list.
- **A refused fill:** a toast naming why (taken, limit, full).
- **Offline:** a fill waits in the socket's queue, as other sayings do today.
- **Bad input:** the relay drops a field that is not plain text, is not
  `HH:MM`, or has `lat`/`lon` that are not finite numbers in range. It never
  throws.

**Tests.**

- **Relay** (`tests/room.test.js` or a new `tests/cards.test.js` for the
  relay-level map, `tests/server.test.js` for the wire):
  - first in wins;
  - the refused change;
  - two wrongs clear a field, two on `venue` hide the card;
  - the 3-per-address limit and the 200 cap;
  - a listed id refused;
  - rounding;
  - `/api/shows` merge order;
  - restart from the night file;
  - 06:00 clears.
  - Each guard is mutation-checked: break it and exactly its test goes red.
- **Phone, pure** (a new `app/lib/where.js`):
  - distance;
  - sort with the 2 km band;
  - the nearest chosen;
  - the 500 m check;
  - the banner's words;
  - the distance label ("300 m", "3 km").
- **In a browser:** headless Chrome over CDP with
  `Emulation.setGeolocationOverride`.
  - At the Moth Club door: one tap joins.
  - 3 km away: the banner shows, and SEE NEARBY and I'M HERE both work.
  - Making a room: a second phone near it sees it listed first and joins it.
    The first fill wins, and two wrongs clear it.
  - Denying location: today's list.

## Not in this

- **Voice prompts.** The next design.
- **Polish items** F5-F7, F9, F10 and F15.
- **A wrong-room check from the wristband's beacons** (option 乙). It was
  offered and not picked.
- **OpenStreetMap or ticketing data** (B, C).
- **Staff for a made room.**
