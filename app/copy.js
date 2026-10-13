// The words and hues, as the canvas has them.

import { CARDS } from '../relay/cards.js';

export const HUE = Object.fromEntries(CARDS.map((c) => [c.id, { c: c.c, g: c.g, label: c.label }]));

export const hueVars = (id) => (HUE[id] ? { '--c': HUE[id].c, '--g': HUE[id].g } : {});

/** The act as a fan says it: "BRUNO MARS" -> "Bruno", "THE LONG WEEKEND" -> "The Long Weekend". */
export function actShort(act) {
  const words = String(act || '').toLowerCase().split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1));
  if (!words.length) return 'the band';
  return words.length === 2 && words[0] !== 'The' ? words[0] : words.join(' ');
}

/** Each card's words on the phone, idle and armed, by its id in relay/cards.js. */
const WORDS = {
  // Armed, a phone with no wristband is a blue screen, and so is everyone else's: "wristbands" alone told it to look
  // for something it does not have and others may not either.
  hi: (act, banded = true) => ({ icon: 'waving_hand', title: 'SAY HI :)', atitle: 'SAY HI:)',
    idle: ['Ready?', 'Tap to meet', 'new mates'], armed: banded ? ['Find blue wristbands', 'to meet new mates'] : ['Find blue screens', '& wristbands to meet'] }),
  song: () => ({ icon: 'queue_music', title: 'FIRST SONG?', atitle: 'FIRST SONG?',
    idle: ['Ready?', 'Tap to break', 'the ice'], armed: ['Icebreaker: what would', 'be the opening track?'] }),
  dance: (act) => ({ icon: null, title: "LET'S DANCE!", atitle: "LET'S DANCE!",
    idle: ['Ready?', 'Tap to find', 'the floor'], armed: ['Turn on the camera &', 'your fav ' + actShort(act) + '’s piece!'] }),
  guess: () => ({ icon: 'quiz', title: "LET'S GUESS!", atitle: "LET'S GUESS!",
    idle: ['Ready?', 'Tap to test', 'what you know'], armed: ['Answer, then find', 'a teammate'] }),
};

/** The home screen's cards, in relay/cards.js's order. */
export const cards = (act, banded = true) => CARDS.map((c) => ({ id: c.id, to: c.open, ...WORDS[c.id](act, banded) }));

export const PROMISES = [
  { dot: '#4ED7F1', icon: 'location_off', main: 'Nobody sees where you are.', sub: 'only that you’re near — and never closer than an area, like "near the bar". Your wristband shows a colour, never your name.' },
  { dot: '#F2D65E', icon: 'visibility_lock', main: 'No name and no photo until you both say yes.', sub: 'until then you’re just someone near the bar.' },
  { dot: '#DA8CF2', icon: 'visibility_off', main: 'One tap makes you invisible.', sub: 'and it stays off until you turn it back on.' },
  { dot: '#4ADE80', icon: 'do_not_disturb_on', main: 'If someone declines, you never see each other again tonight.', sub: 'no notification either way. deniable, both sides.' },
];

/** "How this works", after the promises: the cards, and what makes a match. */
export const HOW = {
  cards: 'Four cards. SAY HI waves at someone near. FIRST SONG? guesses the opener. LET’S DANCE! puts a clip on the floor. LET’S GUESS! is tonight’s quiz.',
  both: 'A match needs you both: a wave waved back, a pick liked both ways, a dance danced back, a team-up both ways. Only then a name, and where to meet.',
};

/** "Someone near the bar" */
export const someone = (band) => 'Someone ' + (band || 'in this room');

/** What a match is called on this phone: their name once you both said yes. */
export const matchName = (m) => m?.name || (m?.intent === 'dance' ? 'Someone from the floor' : someone(m?.band));

/**
 * Whether a report from this phone reaches anyone: only at a venue with a staff page (view.team). Before the
 * relay has said, it is taken as yes, so a report made offline is queued, not refused.
 */
/**
 * The meeting number, said on the match screens. Either of you may be on a phone alone, and nobody is told who wears a
 * band, so it is "a wristband or phone"; a phone with no band of its own is the thing to hold up.
 */
export const MEET = {
  look: 'Look for a wristband or phone showing',
  held: 'no wristband? hold this screen up: theirs shows the same number.',
};

/** Turning the band off and on, said where the band is talked about: the sheet, and How this works. */
export const BAND_OFF = {
  line: 'turned off. its power button turns it on.',
  how: 'Hold both buttons on your wristband for 3 seconds to turn it off, so it does not drain in a bag. Its power button turns it on.',
};

export const teamHere = (view) => view?.team !== false;

/** The words around a report, by whether the venue has a team to read it. Never "the team has it" where there is none. */
/** Leaving asks first (F13): one stray tap on the NOT NOW screen should not end the night here. */
/** Finding the venue, and making one nobody listed (docs/superpowers/specs/2026-10-13-venue-cards-design.md). */
export const WHERE = {
  find: 'FIND ME',
  finding: 'finding where you are…',
  cant: "Can't find you — pick from the list.",
  notHere: 'NOT HERE? ADD IT',
  oneOfThese: 'Is it one of these?',
  make: 'MAKE IT',
  made: 'made here tonight',
  taken: 'someone here already said that.',
  limit: "that's three venues from here tonight — join one.",
  full: 'too many venues tonight — pick one from the list.',
  listed: 'that venue is listed already.',
  bad: "that didn't read right — try fewer words.",
  addAct: 'add the act',
  addTimes: 'add the times',
  wrongHere: "something's wrong here",
  wrongSaid: 'thanks — if someone else says so too, it clears.',
  seeNearby: 'SEE NEARBY',
  imHere: "I'M HERE",
};

export const LEAVE = {
  title: 'Left the venue?',
  sub: 'your wristband lets go and nobody here sees you. you can come back in tonight.',
  row: 'I’ve left',
};

export const REPORT = {
  goes: 'goes to the venue team, with the time and the room.',
  sent: 'reported. the venue team has it.',
  noTeam: 'No venue team on the app here',
  noTeamSub: 'nobody at this venue reads reports tonight. for anything urgent, find staff or security in person. blocking still works.',
};

/** "by the merch stand — it's the quietest corner" -> "by the merch stand" */
export const spotShort = (spot) => String(spot || '').split(' — ')[0];

/**
 * The wristband guide (docs/superpowers/specs/2026-10-13-wristband-guide-design.md): every word of the practice and
 * of the page. `screens` is one row per face the band can show, in its own words (tests/guide.test.js reads them from
 * the band's source and fails on one with no row), and what FACE and SIDE do there; '' is nothing.
 */
export const GUIDE = {
  parts: [['start', 'START'], ['pair', 'PAIR'], ['buttons', 'BUTTONS'], ['lights', 'LIGHTS & SOUNDS'], ['meeting', 'MEETING'], ['trouble', 'TROUBLE']],
  practice: {
    sub: 'a minute with the real buttons. nobody can see you while you practise.',
    later: 'later', skip: 'skip this one', gotIt: 'GOT IT', done: 'DONE', away: "we'll check this once your wristband is back.",
    steps: {
      wake: { title: 'Wake it', do: 'press FACE.', back: 'it lights for six seconds.', yes: 'IT LIT UP', no: 'NOT YET', notYet: 'check it is on: press POWER. or find it with' },
      card: { title: 'Change your card', do: 'press SIDE: it shows your card. press again for the next. then stop.', back: 'three seconds later it sends, and says SET.' },
      dark: { title: 'Go invisible', do: 'hold FACE for a second and a half.', back: 'it goes dark, with a low sound. you are NOT NOW.' },
      back: { title: 'Come back', do: 'hold SIDE.', back: 'it comes back on the card you had.' },
      meet: { title: 'Meeting someone', do: 'nothing to press yet.', back: 'when you both say yes, both wristbands show the same number and blink. any key answers the blink. find each other, then hold SIDE. it counts when you both have.' },
    },
    end: { title: "That's it", sub: 'how to use it is under your wristband, any time.' },
  },
  page: { title: 'Your wristband', sub: 'step by step, from turning it on.', again: 'PRACTISE AGAIN', open: 'HOW TO USE IT', how: 'Your wristband, step by step', newTo: 'new to the wristband?' },
  start: [
    ['Turn it on', 'press POWER once. it lights and looks for Wi-Fi. charge it on any USB-C cable; it runs on the cable too.'],
    ['What it needs', 'a Wi-Fi it can reach on its own: 2.4 GHz, with a password or open, and no sign-in page. a phone hotspot works (set it to 2.4 GHz if the phone asks: hotspot → AP band). a school, hotel or café sign-in Wi-Fi does not.'],
    ['If it says NO WI-FI', 'it knows no network that is near. hold SIDE until it changes. it becomes a Wi-Fi of its own and shows a code, its name (OTB- and four letters) and its password in two halves of five.'],
    ['Join it from a phone', 'scan the code with the camera, or pick OTB-… in Wi-Fi settings and type the password from its face. its page opens by itself; if not, open 192.168.4.1. use a different phone from the hotspot, or turn the hotspot off first: most phones cannot be a hotspot and join another Wi-Fi at once.'],
    ['Pick the network', 'or type its name if it is not in the list (a hotspot that is off is not there), type its password, and press SAVE AND RESTART. it says SAVED and starts again. your phone goes back to its own Wi-Fi.'],
    ['Turn the hotspot back on', 'within about fifteen seconds it is on it and shows four letters: ready to pair.'],
    ['It remembers', 'it keeps the last three networks set on it, and the one it was built with, and joins the newest one it can hear. lent to a friend and set up on their hotspot, it still finds yours when it comes back. a fourth forgets the oldest.'],
    ['Leaving setup', 'press either button: nothing changes. ten minutes with nobody on its page leaves it too.'],
  ],
  pair: [
    ['Four letters', 'a wristband nobody has claimed shows four letters under a code. never I, L or O.'],
    ['Put them in', 'type them on the pair screen, or SCAN IT INSTEAD, or point the phone camera at its code.'],
    ['Check the number', 'it shows a two-digit number over ON YOUR PHONE?, and the phone asks if your wristband shows it. look at your own wrist, and press YES only if it does. it flashes white once: paired.'],
    ['Not yours?', 'NO, or no answer within a minute, and it shows new letters.'],
    ['A number you did not ask for', 'someone typed your letters. hold FACE for a second and a half on it: it is turned away and new letters come up.'],
  ],
  columns: ['FACE', 'FACE held', 'SIDE', 'SIDE held'],
  screens: [
    { face: ['NO WI-FI', 'HOLD SIDE: SET UP'], facePress: 'wakes it', faceHold: '', sidePress: '', sideHold: 'Wi-Fi setup' },
    { face: ['OTB-', 'its setup code'], facePress: 'leaves setup, nothing changed', faceHold: 'the same', sidePress: 'the same', sideHold: 'the same' },
    { face: ['SAVED', 'JOINING'], facePress: 'nothing: it starts again by itself', faceHold: '', sidePress: '', sideHold: '' },
    { face: ['four letters', 'PAIR ON YOUR PHONE'], facePress: 'says PAIR ON YOUR PHONE', faceHold: '', sidePress: 'says PAIR ON YOUR PHONE', sideHold: '' },
    { face: ['a number', 'ON YOUR PHONE?'], facePress: 'says PAIR ON YOUR PHONE', faceHold: 'turns the check away', sidePress: 'says PAIR ON YOUR PHONE', sideHold: '' },
    { face: ['READY', 'SIDE TO CHANGE'], facePress: 'wakes it for six seconds', faceHold: 'NOT NOW: dark at once', sidePress: 'shows your card; each press after steps HI, SONG, DANCE, GUESS, OFF; three seconds after the last it sends', sideHold: 'as a press' },
    { face: ['your card', 'SIDE: NEXT'], facePress: 'wakes it', faceHold: 'NOT NOW', sidePress: 'the next card', sideHold: 'sends this one now' },
    { face: ['your card', 'SENDING'], facePress: '', faceHold: 'NOT NOW', sidePress: '', sideHold: '' },
    { face: ['SET', 'CHANGED', 'NOT SENT'], facePress: 'wakes it', faceHold: 'NOT NOW', sidePress: 'starts a new choice', sideHold: '' },
    { face: ['NOT NOW', 'SIDE TO CHANGE'], facePress: 'shows NOT NOW and its battery', faceHold: '', sidePress: 'shows the card it comes back on, then steps', sideHold: 'comes back, on the card you had' },
    { face: ['your card', 'HOLD SIDE TO SHOW'], facePress: '', faceHold: '', sidePress: 'the next card', sideHold: 'comes back on this card' },
    { face: ['a number', 'MEET'], facePress: 'stops the blinking, and nothing else', faceHold: 'NOT NOW', sidePress: 'stops the blinking, and nothing else', sideHold: '' },
    { face: ['a number', 'HOLD SIDE: FOUND'], facePress: '', faceHold: 'NOT NOW', sidePress: 'opens the chooser', sideHold: 'we found each other' },
    { face: ['a number', 'FOUND: WAITING'], facePress: '', faceHold: 'NOT NOW', sidePress: '', sideHold: '' },
    { face: ['SOMEONE WAVED', 'HOLD SIDE: WAVE BACK', 'WAITING - HOLD SIDE'], facePress: '', faceHold: 'NOT NOW', sidePress: '', sideHold: 'waves back to the newest' },
    { face: ['WAVE BACK', 'SENDING'], facePress: '', faceHold: 'NOT NOW', sidePress: '', sideHold: '' },
    { face: ['NO SIGNAL', 'NO RELAY'], facePress: 'wakes it', faceHold: '', sidePress: '', sideHold: 'nothing: it is not the Wi-Fi. wait.' },
    { face: ['OPEN YOUR PHONE', 'OR SWITCH ME OFF'], facePress: '', faceHold: '', sidePress: '', sideHold: '' },
    { face: ['OPEN YOUR PHONE', 'TO COME BACK'], facePress: '', faceHold: '', sidePress: '', sideHold: '' },
    { face: ['KEEP HOLDING'], facePress: '', faceHold: 'a hold under way: at the end of the bar FACE alone goes NOT NOW, FACE and SIDE together turn it off. let go early and nothing happens', sidePress: '', sideHold: '' },
    { face: ['POWER OFF', 'POWER BUTTON: ON'], facePress: 'it is turning off', faceHold: '', sidePress: '', sideHold: '' },
    { face: ['UNPLUG', 'TO TURN IT OFF'], facePress: '', faceHold: 'on its cable it charges and stays on: unplug it, then hold FACE and SIDE again', sidePress: '', sideHold: '' },
    { face: ['MARKER', 'its area'], facePress: 'lights it. a marker is left in the room, not worn', faceHold: 'the same', sidePress: 'the same', sideHold: 'the same' },
  ],
  anyScreen: 'on any screen, FACE and SIDE held together for three seconds turns it off. POWER turns it on.',
  sounds: {
    tick: 'any key going down',
    double: 'a hold that sends: coming back, waving back, found',
    down: 'NOT NOW',
    up: 'SET, a YES, TEST THE LIGHT',
    fall: 'CHANGED, or a check that ended without YES',
    low: 'NOT SENT',
    ask: 'the pairing check: the number to look for',
    jingle: 'a meeting: the number blinks until a key answers',
    warn: 'orange: out of reach, battery at 15% and 5%, waiting after a restart, away, unpaired',
    hello: 'someone waved at you',
    found: 'you both found each other',
    calledit: 'you called the first song',
  },
  lights: {
    cards: { hi: 'your colour while SAY HI is armed', song: 'your colour while FIRST SONG? is armed', dance: "your colour while LET'S DANCE! is armed", guess: "your colour while LET'S GUESS! is armed" },
    rows: [
      ['half bright', 'battery at 15% or less'],
      ['white once', 'paired, or TEST THE LIGHT'],
      ['red three times', 'CHANGED: something moved first'],
      ['orange twice', 'NOT SENT: it could not reach ON THE BEAT'],
    ],
  },
  meeting: [
    'when you both say yes, both wristbands show the same number and blink.',
    'any key answers the blink.',
    'find each other at the spot your phone shows.',
    'hold SIDE once you have. it counts when you both have; until then yours says FOUND: WAITING.',
    'a meeting number lasts fifteen minutes.',
  ],
  trouble: [
    ['NO WI-FI', 'it can hear none of the networks it knows.', 'turn your hotspot on and wait fifteen seconds. new place or new phone: hold SIDE and set it up.'],
    ['NO WI-FI right after you saved', 'the name or password was not right, or the network is 5 GHz.', 'hold SIDE and set it up again. type the name exactly. set the hotspot to 2.4 GHz.'],
    ['your hotspot is not in the setup list', 'it is off, or 5 GHz.', 'type its name instead. set it to 2.4 GHz.'],
    ['the setup page does not open', 'the phone left its Wi-Fi, or no page popped up.', 'join OTB-… again and open 192.168.4.1.'],
    ['the hotspot turned itself off during setup', 'the phone cannot be a hotspot and join another Wi-Fi at once.', 'set it up from another phone, then turn the hotspot on.'],
    ['NO SIGNAL or NO RELAY, orange', 'it is on Wi-Fi but cannot reach ON THE BEAT.', 'nothing: it catches up by itself. check the hotspot has data.'],
    ['OPEN YOUR PHONE / OR SWITCH ME OFF', 'the service restarted and waits for its owner.', 'open the app, or turn it off.'],
    ['OPEN YOUR PHONE / TO COME BACK', 'you are not in a room, or it was away a while.', 'open the app. PAIR AGAIN under your wristband if it asks.'],
    ['four letters on a wristband that was yours', 'it was unpaired, or set up again.', 'pair it again.'],
    ['it does not light', 'asleep, flat or off.', 'press FACE. charge it. press POWER. TEST THE LIGHT under your wristband finds it.'],
    ['half bright', 'battery at 15% or less.', 'charge it.'],
    ['a number you did not ask for', 'someone typed your letters.', 'hold FACE for a second and a half on it.'],
  ],
};
