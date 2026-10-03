// ON THE BEAT — the cards.
//
// Every card a person can arm, in the order the phone lays them out and the
// wristband steps through them. This is the one place a card is named: the
// relay's list of what can be armed, the phone's hues and screens and the
// wristband's words all come from here. firmware/src/band_logic.h CARDS is the
// firmware's copy, and tests/cards.test.js and tests/firmware.test.js hold the
// two to each other, to the phone's copy (app/copy.js) and to its colours
// (app/styles.css).
//
// What a card does once it is armed (a wave, a like, a dance back) is its own
// code, and stays there. A card added here gets everything else.
//
// It lives in relay/ because the relay's image carries relay/ and dist/ only:
// the phone reaches it through Vite, as it already reaches relay/band.js.

export const CARDS = [
  // id: what is armed. label: the card's short name. band: the wristband's big line.
  // c, g: the canvas's hue, light and deep. open: the screen its › opens. screens: every screen that belongs to it.
  { id: 'hi', label: 'SAY HI', band: 'HI :)', c: '#4ED7F1', g: '#0C9DE2', open: 'beacon', screens: ['beacon', 'near'] },
  { id: 'song', label: 'FIRST SONG', band: 'FIRST SONG?', c: '#F2D65E', g: '#C79A1E', open: 'pick', screens: ['pick', 'wall'] },
  { id: 'dance', label: "LET'S DANCE", band: "LET'S DANCE!", c: '#DA8CF2', g: '#A93FD9', open: 'camera', screens: ['camera', 'floor'] },
];

export const INTENTS = CARDS.map((c) => c.id);

/** The card armed as `id`, or undefined. */
export const cardOf = (id) => CARDS.find((c) => c.id === id);
