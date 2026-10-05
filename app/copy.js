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
  cards: 'Three cards. SAY HI waves at someone near. FIRST SONG? guesses the opener. LET’S DANCE! puts a clip on the floor.',
  both: 'A match needs you both: a wave waved back, a pick liked both ways, a dance danced back. Only then a name, and where to meet.',
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
export const REPORT = {
  goes: 'goes to the venue team, with the time and the room.',
  sent: 'reported. the venue team has it.',
  noTeam: 'No venue team on the app here',
  noTeamSub: 'nobody at this venue reads reports tonight. for anything urgent, find staff or security in person. blocking still works.',
};

/** "by the merch stand — it's the quietest corner" -> "by the merch stand" */
export const spotShort = (spot) => String(spot || '').split(' — ')[0];
