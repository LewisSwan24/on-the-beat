# LET'S DANCE!, or strike a pose: design

14 Oct 2026. From `main` c2d1e23.

## Why

The team's v3 flow has a selfie activity: two people strike a pose for the
camera. We chose to fold it into LET'S DANCE! instead of adding a
fifth card (「并进 DANCE 卡」): on the floor, a person may put either five
seconds of dancing or one posed photo, and a dance back may be either. Many
people will not dance on camera at a gig; a pose is a smaller ask. A photo is
also about a tenth of a clip's bytes, so the 40 MB clip store holds more
people.

The rest of the card is unchanged: one thing on the floor per person, a dance
back straight to one person, a dance back each way is a match.

## Decisions (his picks, 14 Oct 2026)

| Question | Pick |
|---|---|
| A fifth card, or LET'S DANCE! | LET'S DANCE! takes a photo as well as a clip. |
| The card's name | Stays LET'S DANCE!. The band's words do not change, so no reflash. |
| Pose prompts | One at random on the camera screen, a tap for another. |
| How a photo is kept | Approach A: the same one slot per person as a clip. A new photo replaces the person's clip and the other way round. |

## 1. The camera screen (`app/screens/Dance.jsx`, `Camera`)

- A two-way switch at the top: **VIDEO | PHOTO**. VIDEO is the default, and
  it is today's screen unchanged.
- **PHOTO**:
  - Under the live picture: one pose prompt, drawn at random from a fixed
    list. Tapping it shows another, never the same one twice in a row.
  - The shutter starts a 3-second count, shown on the button (3, 2, 1). Then
    one frame of the live stream is drawn to a canvas and saved as JPEG at
    quality 0.8.
    - The frame is the stream's own size, scaled down if needed so the long
      side is at most 640 px.
    - It is not mirrored, the same as a recorded clip: only the live preview
      is shown mirrored. Writing on a shirt reads the right way round.
  - The preview, SEND, NOT THIS ONE and "just for me" work as for a clip.
    "Just for me" saves `on-the-beat-<time>.jpg`.
- A dance back (`backTo`) offers the same switch.
- The prompts are solo poses that do not need the whole face:
  - Air guitar, as loud as it looks.
  - Phone torch up, like the encore.
  - Make a heart with your hands.
  - Point at the stage like it owes you money.
  - Side on, eyes on the stage.
  - Your best album-cover stare.
  - Both arms up for the chorus.
  - Sunglasses on. Indoors. At night.
- They live in `app/lib/pose.js`, with `nextPose(previous, random)`, a pure
  function, so the "never the same twice" rule is unit-tested.

## 2. The relay

- **`keepClip`** (`relay/server.js`) accepts `image/jpeg` beside
  `video/webm` and `video/mp4`, with two extra rules for a photo:
  - The bytes must begin with the JPEG start-of-image marker
    `FF D8 FF`. Anything else with that type is refused (`clip refused`).
    Since the relay serves what it keeps as `content-type: image/jpeg` with
    `nosniff`, this keeps a phone from parking arbitrary bytes under an
    image type.
  - At most `PHOTO_MAX = 300_000` bytes.
  - Everything else is shared with clips: the per-person slot, the 40 MB
    store across every room, the one-hour floor life, the per-socket
    sending gap (`CLIP_EVERY_MS`), keeping across a restart in the night's
    clip folder, and the `/clip/<ref>` route with its headers.
- **The room** never sees bytes. It learns each ref's kind from a new
  `createRoom` option, `clipKind(ref) -> 'photo' | 'clip'`. The server
  answers it from the mime it kept. The default is `'clip'`, so every room
  and every test that does not pass one behaves as today.
- **The view** says the kind wherever it gives a ref:
  - each `floor` row gains `kind`;
  - `me.clip` stays the ref, and `me.clipKind` is added beside it.
  A ref the store no longer holds reads as `'clip'`, and its row goes as
  today when the store drops it.
- **The app's CSP** (`APP_CSP` in `relay/server.js`, the phone policy only)
  becomes `img-src 'self' data: blob:`, for the photo's preview before it is
  sent. The staff page's policy is unchanged.

## 3. The phone

- **The floor** (`Floor`, the "your own" tile, and the dance-back tiles):
  `kind === 'photo'` draws an `<img>` with the same size and frame as the
  clip tile; anything else draws today's looping `<video>`. Its text says
  "five seconds each, or a pose" where it says "five seconds each" today.
- **The card's words** (`app/copy.js` `WORDS.dance`): the armed lines become
  "Dance or strike a pose / to your fav <act>'s piece!", keeping the act as
  today. The idle lines and the title are unchanged.
- **The tile sheet** (`App.jsx` `tileSheet`) and "how this works"
  (`HOW.cards`) say "a clip or a photo" where they say "a clip".
- **Out of scope here:** the wristband, its words and its firmware. The card
  is the same card.

## 4. Tests

- **Relay** (`tests/server.test.js`, or a new `tests/pose-relay.test.js`):
  - a real JPEG is kept, served back byte for byte as `image/jpeg` with
    `nosniff`, and listed on the floor as `kind: 'photo'`;
  - `image/jpeg` without the marker is refused;
  - a photo over `PHOTO_MAX` is refused;
  - a photo replaces the same person's clip on the floor, and a clip
    replaces a photo;
  - a dance back may be a photo, and its row says so;
  - after a restart with a night file, the photo and its kind are back.
- **Room** (`tests/room.test.js`): `clipKind` reaches the floor rows and
  `me.clipKind`; with no `clipKind`, every row says `'clip'`.
- **Pose prompts** (`tests/pose.test.js`): `nextPose` never repeats the
  previous one and covers the whole list.
- **CSP**: the existing CSP test is updated to the new `img-src`.
- **Mutation-checked:** removing the marker check turns its test red;
  dropping `kind` from the floor rows turns its test red.
- **Browser walk** on two phones' worth of tabs: one posts a photo, the other
  sees it on the floor and dances back with a clip; the first dances back
  with a photo; they match. Read `scrollWidth` at 375 px wide.

## Not in this

- A photo of the two of you after a match (the v3 "together" selfie).
- Picking a photo from the camera roll, filters, stickers, retouching.
- Stripping metadata from uploaded files: a photo taken here is drawn from
  the camera onto a canvas and carries none; a hand-made upload is the
  sender's own bytes, kept an hour.
- Deploying to Fly: waits for our yes, as always.
