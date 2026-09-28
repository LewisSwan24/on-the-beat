# The wristband, sideways: landscape faces that turn themselves

Date: 28 Sep 2026. Decided with the owner question by question the same day,
first of the four he lined up after the staff page. It follows the watch
clip he bought: M5Stack's Stick Watch Accessory Kit (A173), which holds a
Stick across the forearm with its long side along the arm.

## What is true today

Checked on 28 Sep 2026, in the code:

- **The face is portrait.** `setup()` sets `M5.Display.setRotation(0)`, and
  the sprite `face` is made at the display's 135 × 240.
- **Everything is sized from the screen, save two things.** `paint()` and
  `drawMarker()` scale margins and the meeting number by
  `k = min(W / 135, H / 240)`, the canvas's portrait band; on a 240 × 135
  screen that is 0.56, and everything shrinks. `drawPairing()` stacks the QR
  code over the four letters, which a 135-pixel height cannot hold. The
  words (`drawWords()`) and the number (`drawMeet()`) are already fitted to
  whatever width and height they are given.
- **Neither band reads its motion sensor.** The StickS3 has a BMI270 and the
  StickC Plus an MPU6886; M5Unified starts both (`M5.Imu`), and for the
  StickS3 turns the BMI270's axes into the same order as other Sticks'.
- **Settings a band keeps** live in `Preferences` (`ssid`, `pass`, `relay`,
  `marker`), each set over the USB console.

## Goal

Worn in the clip on either wrist, either way round, each band's face reads
the right way up when its wearer raises the wrist to look, and never turns
on its own while the arm moves, is still or hangs. As first written the goal
said "with no setting": that part was measured and dropped (§2).

## Not in this spec

- **Portrait.** Neither band draws portrait any more; there is no setting to
  go back.
- **Turning to portrait**, as a phone does when held upright. The owner chose
  on 28 Sep 2026 to turn only between the two landscape directions: the clip
  holds the band landscape.
- **The browser stand-in** (`/band`, `app/screens/Band.jsx`) stays portrait,
  as the canvas draws it.
- **Wake by raising the wrist.** The sensor could; it is another feature.

## Where this departs from the canvas, on purpose

- **The band is landscape.** Revision 6 draws a portrait band, 135 × 240, with
  a strap stub above and below. The owner's clip holds it the other way, and
  he chose on 28 Sep 2026 that both bands, the StickS3 and the StickC Plus,
  go landscape and turn themselves.

## §1. The faces at 240 × 135 (`firmware/src/main.cpp`)

- **Scale.** `k = min(W / 240, H / 135)`: the canvas's band, turned. At 240 ×
  135 it is 1, so every margin and the number keep their portrait size.
- **Words** (card names, NOT NOW, OPEN YOUR PHONE, SOMEONE WAVED, a marker's
  area, …): large over small, centred, as now, fitted by `fit()` to the
  wider face, so the same words take a larger font and fewer lines.
- **A number** (MEET and its number, the pairing check): the small word over
  the large number, centred, as now. The number is as large as fits the
  width and what height is left under the word; at 240 × 135 that is the
  portrait size, about 85 px.
- **Pairing**: the QR code on the left, as large as the height allows with
  its four light modules (the same size as in portrait, whose width was the
  same 135), and to its right the four letters, centred in what width is
  left, in the largest code font they fit, with the hint under them after a
  press.
- **KEEP HOLDING** keeps its bar along the bottom; **a glow** is drawn over
  the whole face, as now; **a marker's face** is words.

## §2. Which way up: held, and the power button turns it over (`main.cpp`)

**Amended 28 Sep 2026, after the bands were worn.** As first approved, this
section turned the face from the accelerometer: gravity across the short
side, 0.35 g held 500 ms. That was built (commits `1c99510` to `31543b0`) and
worn, and it cannot work for a watch:

- Read with the owner wearing the StickS3 in the clip on his left wrist,
  socket toward the elbow, looking at it as he looks at a watch, the face
  lay nearly flat (z +0.75 to +0.95 g); gravity in the face's plane ran
  mostly along the arm (x -0.5 to -0.7 g), and across the short side only
  -0.1 to -0.3 g, the opposite way to a face held upright in front of him.
- A face seen from above has no "down" that gravity can find: which edge is
  nearer the eyes is not in the reading. The left and right wrists are
  mirror images, and the one reading that tells them apart is that small
  roll across the short side. So switching wrists never turned the face,
  and a lower tilt would have turned it the wrong way.

The owner then chose (28 Sep 2026) to hold the side and turn it by hand:

- **The side is held.** Two sides: the USB-C socket to the left of the
  words, or to their right. The default is USB-left: his left wrist, socket
  toward the elbow. It is kept in `Preferences` as `turn`.
- **A short press of the power button** (on the side; M5Unified reads it
  from the power chip, the M5PM1 on the StickS3 and the AXP192 on the Plus,
  as `M5.BtnPWR`) turns the face over and keeps the new side. A long hold
  still powers the band off, as the chip does on its own. A marker turns
  over the same way.
- A face that turns is drawn again at once.
- **The accelerometer is not read.**

## §3. The console

- **`turn usb-left|usb-right`**: kept in `Preferences` as `turn`, like
  `relay`, and removed by `forget`. Anything else, and a kept `turn` from
  before this amendment (`auto`), is answered with, or read as, USB-left.
- **`show`** gains a line: `face    landscape, USB left; the power button
  turns it over`.
- **`snap`**: the frame last pushed, sent over the console as one line,
  `snap <W> <H> <base64 of RGB565, row by row, little-endian>`, for a script
  that makes it an image. It changes nothing on the band. A marker answers
  it too.

## §4. Tests and proof

- **Host** (`firmware/host/logic_test.cpp`, run by `tests/firmware.test.js`):
  the console's names for the two sides, anything else refused, and the
  base64 `snap` sends. `as_band.cpp` keeps `band_logic.h` C++11.
- **CI** builds both envs.
- **Every face, looked at.** Over `snap`, on both bands, in both directions:
  the idle face, a card, NOT NOW, KEEP HOLDING part way, the pairing face
  with its hint, the check number, and a marker's face; each made an image
  and looked at, and the pairing QR decoded from its image by jsQR, the
  scanner the app itself uses.
- **On the wrist**, after the owner says yes to flashing both: worn in the
  clip on the left wrist it reads the right way up; a press of the power
  button turns it over, and again turns it back; the side it was left on
  holds through a restart; moved about, laid flat or hanging, it never
  turns on its own. On each band.

## Also to change when this is built

- README: *Where this differs from the canvas* gains the landscape band; *The
  wristband's firmware* says how it is turned over and gives `turn` and
  `snap`; *What is not done* notes that it never turns itself, and why.
- Memory `watch-kit` records it as done.

## Risks

- **A knock on the power button** turns the face over; another press turns
  it back. The owner chose a single press over a double one.
- **The power button is read through the power chip**, which neither band's
  firmware had read before; it is proved on both boards before it is relied
  on.
