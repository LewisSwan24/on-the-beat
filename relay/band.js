// ON THE BEAT — what a wristband shows.
//
// The wristband is a light first and words second: from across a dark room it
// is a colour, and only up close two short lines. It shows nothing about
// anyone else except the meeting number, and only once both of you said yes.
// No names, no photos, no picks but your own.
//
// Pure: everything it needs is passed in, so every state can be tested
// without a socket or a clock.

/** Pairing codes: letters only, none that look like another (no I, L or O). */
export const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const MEET_MS = 15 * 60_000;   // the number shows while the two of you find each other
export const DIM_AT = 15;             // percent; at or below it the light drops to half

const short = (s, n) => {
  const t = String(s || '').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

/**
 * @param {object} p
 * @param {object|null} p.view    the paired person's viewFor(), or null when they are not in a room
 * @param {number|null} p.battery the wristband's own battery, percent
 * @param {string|null} p.code    set while the wristband is unpaired: the four letters to show
 * @param {number|null} p.check   set while a pairing waits for YES: the number the phone asks about
 * @param {boolean} p.waiting     after a relay restart, until its owner's phone claims it
 * @param {number} p.testUntil    TEST THE LIGHT runs until this time
 * @param {number} p.now
 */
export function bandShow({ view = null, battery = null, code = null, check = null, waiting = false, testUntil = 0, now = Date.now() }) {
  if (check) return { kind: 'check', big: String(check) };
  if (code) return { kind: 'pairing', code };
  if (waiting) return { kind: 'waiting' };
  if (testUntil > now) return { kind: 'test' };
  const dim = battery !== null && battery <= DIM_AT;
  if (!view) return { kind: 'off', battery, away: true };
  // NOT NOW is black, completely. Nothing broadcasting, and nothing to read.
  if (view.me.invisible) return { kind: 'off', battery, quiet: true };
  const meet = view.matches
    .filter((m) => now - m.at < MEET_MS)
    .sort((a, b) => b.at - a.at)[0];
  if (meet) return { kind: 'meet', intent: meet.intent, big: String(meet.number), small: 'MEET', dim };
  switch (view.me.armed) {
    case 'hi': return { kind: 'hi', intent: 'hi', big: 'HI :)', small: 'blue means hello', dim };
    case 'song': return { kind: 'song', intent: 'song', big: 'FIRST SONG?', small: short(view.me.pick, 16), dim };
    case 'dance': return { kind: 'dance', intent: 'dance', big: "LET'S DANCE!", small: '', dim };
    default: return { kind: 'off', battery };
  }
}

/** A fresh code, not one that is already waiting to be typed. */
export function newCode(taken, rand = Math.random) {
  for (let i = 0; i < 1000; i += 1) {
    let c = '';
    for (let k = 0; k < 4; k += 1) c += CODE_LETTERS[Math.floor(rand() * CODE_LETTERS.length)];
    if (!taken.has(c)) return c;
  }
  throw new Error('no free pairing code');
}

/** What the phone may type: its letters, upper-cased, and nothing else. */
export const cleanCode = (s) => String(s || '').toUpperCase().split('').filter((c) => CODE_LETTERS.includes(c)).join('').slice(0, 4);
