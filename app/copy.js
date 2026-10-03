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
  hi: () => ({ icon: 'waving_hand', title: 'SAY HI :)', atitle: 'SAY HI:)',
    idle: ['Ready?', 'Tap to meet', 'new mates'], armed: ['Find blue wristbands', 'to meet new mates'] }),
  song: () => ({ icon: 'queue_music', title: 'FIRST SONG?', atitle: 'FIRST SONG?',
    idle: ['Ready?', 'Tap to break', 'the ice'], armed: ['Icebreaker: what would', 'be the opening track?'] }),
  dance: (act) => ({ icon: null, title: "LET'S DANCE!", atitle: "LET'S DANCE!",
    idle: ['Ready?', 'Tap to find', 'the floor'], armed: ['Turn on the camera &', 'your fav ' + actShort(act) + '’s piece!'] }),
};

/** The home screen's cards, in relay/cards.js's order. */
export const cards = (act) => CARDS.map((c) => ({ id: c.id, to: c.open, ...WORDS[c.id](act) }));

export const PROMISES = [
  { dot: '#4ED7F1', icon: 'location_off', main: 'Nobody sees where you are.', sub: 'only that you’re near — and never closer than "in this room". Your wristband shows a colour, never your name.' },
  { dot: '#F2D65E', icon: 'visibility_lock', main: 'No name and no photo until you both say yes.', sub: 'until then you’re just someone near the bar.' },
  { dot: '#DA8CF2', icon: 'visibility_off', main: 'One tap makes you invisible.', sub: 'and it stays off until you turn it back on.' },
  { dot: '#4ADE80', icon: 'do_not_disturb_on', main: 'If someone declines, you never see each other again tonight.', sub: 'no notification either way. deniable, both sides.' },
];

/** "Someone near the bar" */
export const someone = (band) => 'Someone ' + (band || 'in this room');

/** What a match is called on this phone: their name once you both said yes. */
export const matchName = (m) => m?.name || (m?.intent === 'dance' ? 'Someone from the floor' : someone(m?.band));

/** "by the merch stand — it's the quietest corner" -> "by the merch stand" */
export const spotShort = (spot) => String(spot || '').split(' — ')[0];
