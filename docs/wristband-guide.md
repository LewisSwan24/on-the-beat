# The wristband, step by step

Everything a person needs to use an ON THE BEAT wristband (an M5StickC Plus), in the order they meet it. The same words are the phone's **Your wristband** page (`app/copy.js` `GUIDE`, drawn by `app/screens/Guide.jsx`); `tests/guide.test.js` holds both to every word the band can put on its face. How the band works inside is [wristband.md](wristband.md).

Held landscape: the screen, **FACE** (the big button beside it), **SIDE** (on the edge), **POWER** (opposite).

## 1. Start: turning it on, and Wi-Fi

1. **Turn it on.** press POWER once. it lights and looks for Wi-Fi. charge it on any USB-C cable; it runs on the cable too.
2. **What it needs.** a Wi-Fi it can reach on its own: 2.4 GHz, with a password or open, and no sign-in page. a phone hotspot works (set it to 2.4 GHz if the phone asks: hotspot → AP band). a school, hotel or café sign-in Wi-Fi does not.
3. **If it says NO WI-FI.** it knows no network that is near. hold SIDE until it changes. it becomes a Wi-Fi of its own and shows a code, its name (OTB- and four letters) and its password in two halves of five.
4. **Join it from a phone.** scan the code with the camera, or pick OTB-… in Wi-Fi settings and type the password from its face. its page opens by itself; if not, open 192.168.4.1. use a different phone from the hotspot, or turn the hotspot off first: most phones cannot be a hotspot and join another Wi-Fi at once.
5. **Pick the network.** or type its name if it is not in the list (a hotspot that is off is not there), type its password, and press SAVE AND RESTART. it says SAVED and starts again. your phone goes back to its own Wi-Fi.
6. **Turn the hotspot back on.** within about fifteen seconds it is on it and shows four letters: ready to pair.
7. **It remembers.** it keeps the last three networks set on it, and the one it was built with, and joins the newest one it can hear. lent to a friend and set up on their hotspot, it still finds yours when it comes back. a fourth forgets the oldest.
8. **Leaving setup.** press either button: nothing changes. ten minutes with nobody on its page leaves it too.

## 2. Pair it with your phone

1. **Four letters.** a wristband nobody has claimed shows four letters under a code. never I, L or O.
2. **Put them in.** type them on the pair screen, or SCAN IT INSTEAD, or point the phone camera at its code.
3. **Check the number.** it shows a two-digit number over ON YOUR PHONE?, and the phone asks if your wristband shows it. look at your own wrist, and press YES only if it does. it flashes white once: paired.
4. **Not yours?** NO, or no answer within a minute, and it shows new letters.
5. **A number you did not ask for.** someone typed your letters. hold FACE for a second and a half on it: it is turned away and new letters come up.

After the first pairing on a phone, the phone offers a one-minute practice with the real buttons. Nobody can see you while you practise; when it ends, your card and NOT NOW are put back as they were.

## 3. Every screen, and what each button does there

Almost everywhere: FACE wakes it, and FACE held is NOT NOW. The tables are grouped by what is going on; "—" means that button does nothing there.

### Your card

| the wristband shows | FACE | FACE held | SIDE | SIDE held |
|---|---|---|---|---|
| `READY` / `SIDE TO CHANGE` | wakes it for six seconds | NOT NOW: dark at once | shows your card; each press after steps HI, SONG, DANCE, GUESS, OFF, FINISH, UNPAIR (FINISH only while a meeting is yours to finish); three seconds after the last it sends | as a press |
| `your card` / `SIDE: NEXT` | wakes it | NOT NOW | the next card | sends this one now |
| `your card` / `SENDING` | — | NOT NOW | — | — |
| `SET` / `CHANGED` / `NOT SENT` / `ASKED` | wakes it | NOT NOW | starts a new choice | — |
| `NOT NOW` / `SIDE TO CHANGE` | shows NOT NOW and its battery | — | shows the card it comes back on, then steps | comes back, on the card you had |
| `your score` / `RIGHT` | wakes it | NOT NOW | as on READY: shows your card, then steps | — |
| `your card` / `HOLD SIDE TO SHOW` | — | — | the next card | comes back on this card |

### Meeting someone

| the wristband shows | FACE | FACE held | SIDE | SIDE held |
|---|---|---|---|---|
| `a number` / `MEET` | stops the blinking, and nothing else | NOT NOW | stops the blinking, and nothing else | — |
| `a number` / `HOLD SIDE: FOUND` | — | NOT NOW | opens the chooser | we found each other |
| `a number` / `FOUND: WAITING` | — | NOT NOW | — | — |
| `SOMEONE WAVED` / `HOLD SIDE: WAVE BACK` / `WAITING - HOLD SIDE` | — | NOT NOW | — | waves back to the newest; so does raising your wrist and waving |
| `WAVE BACK` / `SENDING` | — | NOT NOW | — | — |
| `FINISH` / `FINISH?` / `HOLD SIDE: YES` | calls it off | NOT NOW | FINISH: UNPAIR next. FINISH?: calls it off | FINISH: asks FINISH? at once. FINISH?: asks your match to finish the meeting: SENDING, then ASKED |
| `FINISH?` / `SIDE: YES FACE: NO` | wakes it | not yet: your match is told, and it does not go NOT NOW | only wakes it | yes: the meeting is finished for you both, and the card you met on goes off (back to `READY`) |

### Setting up and pairing

| the wristband shows | FACE | FACE held | SIDE | SIDE held |
|---|---|---|---|---|
| `NO WI-FI` / `HOLD SIDE: SET UP` | wakes it | — | — | Wi-Fi setup |
| `OTB-` / `its setup code` | leaves setup, nothing changed | the same | the same | the same |
| `SAVED` / `JOINING` | nothing: it starts again by itself | — | — | — |
| `four letters` / `PAIR ON YOUR PHONE` | says PAIR ON YOUR PHONE | — | says PAIR ON YOUR PHONE | — |
| `a number` / `ON YOUR PHONE?` | says PAIR ON YOUR PHONE | turns the check away | says PAIR ON YOUR PHONE | — |
| `UNPAIR` / `SIDE: NEXT` | wakes it | NOT NOW | the first card again | asks UNPAIR? |
| `UNPAIR?` / `HOLD SIDE: YES` | calls it off | NOT NOW | calls it off | unpairs: new letters on the band, and your phone is told |

### Off, and when something is wrong

| the wristband shows | FACE | FACE held | SIDE | SIDE held |
|---|---|---|---|---|
| `NO SIGNAL` / `NO RELAY` | wakes it | — | — | nothing: it is not the Wi-Fi. wait. |
| `OPEN YOUR PHONE` / `OR SWITCH ME OFF` | — | — | — | — |
| `OPEN YOUR PHONE` / `TO COME BACK` | — | — | — | — |
| `KEEP HOLDING` | — | a hold under way: at the end of the bar FACE alone goes NOT NOW, FACE and SIDE together turn it off. let go early and nothing happens | — | — |
| `POWER OFF` / `POWER BUTTON: ON` | it is turning off | — | — | — |
| `UNPLUG` / `TO TURN IT OFF` | — | on its cable it charges and stays on: unplug it, then hold FACE and SIDE again | — | — |
| `MARKER` / `its area` | lights it. a marker is left in the room, not worn | the same | the same | the same |

On any screen, FACE and SIDE held together for three seconds turns it off. POWER turns it on.

## 4. Lights and sounds

| light | means |
|---|---|
| SAY HI (#4ED7F1) | your colour while SAY HI is armed |
| FIRST SONG (#F2D65E) | your colour while FIRST SONG? is armed |
| LET'S DANCE (#DA8CF2) | your colour while LET'S DANCE! is armed |
| LET'S GUESS (#FF9F4A) | your colour while LET'S GUESS! is armed |
| half bright | battery at 15% or less |
| white once | paired, TEST THE LIGHT, or a wrong LET'S GUESS answer |
| red three times | CHANGED: something moved first |
| orange twice | NOT SENT: it could not reach ON THE BEAT |
| LET'S GUESS's colour twice | a LET'S GUESS answer you got right |
| green twice | your match asks to finish, or a meeting finished |

| sound | means |
|---|---|
| `tick` | any key going down |
| `double` | a hold that sends: coming back, waving back, found, a finish |
| `down` | NOT NOW |
| `up` | SET, a YES, TEST THE LIGHT, ASKED, a meeting finished |
| `fall` | CHANGED, a check that ended without YES, or not yet to your FINISH |
| `low` | NOT SENT |
| `ask` | the pairing check: the number to look for; or your match asks to finish |
| `jingle` | a meeting: the number blinks until a key answers |
| `warn` | orange: out of reach, battery at 15% and 5%, waiting after a restart, away, unpaired |
| `hello` | someone waved at you |
| `found` | you both found each other |
| `calledit` | you called the first song |
| `waving` | your raised wave: waving back from SOMEONE WAVED |
| `clink` | your two wristbands knocked together on the meeting number |
| `right` | a LET'S GUESS answer you got right |
| `wrong` | a LET'S GUESS answer you got wrong |

## 5. Meeting someone

- when you both say yes, both wristbands show the same number and blink.
- any key answers the blink.
- find each other at the spot your phone shows.
- hold SIDE once you have. it counts when you both have; until then yours says FOUND: WAITING.
- or knock your two wristbands together on the number: that counts as found for both of you.
- in a meeting of three or four, one hold counts for all of it; found plays once everyone has.
- a meeting number lasts fifteen minutes.

## 6. Trouble

| you see | why | do this |
|---|---|---|
| NO WI-FI | it can hear none of the networks it knows. | turn your hotspot on and wait fifteen seconds. new place or new phone: hold SIDE and set it up. |
| NO WI-FI right after you saved | the name or password was not right, or the network is 5 GHz. | hold SIDE and set it up again. type the name exactly. set the hotspot to 2.4 GHz. |
| your hotspot is not in the setup list | it is off, or 5 GHz. | type its name instead. set it to 2.4 GHz. |
| the setup page does not open | the phone left its Wi-Fi, or no page popped up. | join OTB-… again and open 192.168.4.1. |
| the hotspot turned itself off during setup | the phone cannot be a hotspot and join another Wi-Fi at once. | set it up from another phone, then turn the hotspot on. |
| NO SIGNAL or NO RELAY, orange | it is on Wi-Fi but cannot reach ON THE BEAT. | nothing: it catches up by itself. check the hotspot has data. |
| OPEN YOUR PHONE / OR SWITCH ME OFF | the service restarted and waits for its owner. | open the app, or turn it off. |
| OPEN YOUR PHONE / TO COME BACK | you are not in a room, or it was away a while. | open the app. PAIR AGAIN under your wristband if it asks. |
| four letters on a wristband that was yours | it was unpaired, or set up again. | pair it again. |
| it does not light | asleep, flat or off. | press FACE. charge it. press POWER. TEST THE LIGHT under your wristband finds it. |
| half bright | battery at 15% or less. | charge it. |
| a number you did not ask for | someone typed your letters. | hold FACE for a second and a half on it. |
