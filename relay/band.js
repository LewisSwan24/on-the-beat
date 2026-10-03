// ON THE BEAT — what a wristband shows.
//
// The wristband is a light first and words second: from across a dark room it
// is a colour, and only up close two short lines. It shows nothing about
// anyone else except the meeting number, once both of you said yes, and while
// you show SAY HI, that someone waved at you and how many wait. Never who: no
// names, no photos, no picks but your own.
//
// Pure: everything it needs is passed in, so every state can be tested
// without a socket or a clock.

/** Pairing codes: letters only, none that look like another (no I, L or O). */
export const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const MEET_MS = 15 * 60_000;   // the number shows while the two of you find each other
export const FOUND_SHOW_MS = 60_000;  // found by both: a band still plays it this long, if it was out of reach
export const CALLED_SHOW_MS = 60_000; // the opener named: a band whose person called it still plays it this long
export const DIM_AT = 15;             // percent; at or below it the light drops to half

/** A track as the words that make it the song, as the phone matches it (app/lib/opener.js trackKey()). */
export const trackKey = (t) => String(t ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/['’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

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
 * @param {boolean|null} p.sound  the person's sound switch, once their phone has said it; null before
 * @param {Array} p.waves         room.wavesAt(): who waved at the person and waits, newest first, as { handle, n }
 * @param {number} p.now
 *
 * A show made from the person's view carries `armed` (null for none) and the
 * view's `rev`; that is how the wrist tells a show about its person from one
 * that is not, and names the state a choice was made from. The others —
 * pairing, the check, the test light, waiting, and not in a room — carry
 * neither.
 *
 * Once the relay has heard the person's sound switch, every show to their band
 * carries it: their own, the test light (the white face that ends a pairing,
 * and TEST THE LIGHT) and not in a room. Letters, the check and waiting carry
 * none: those bands are nobody's yet, or not known to be whose. A show made
 * without a known switch is exactly the show made before there was one.
 *
 * A show about a person on SAY HI, a meeting's included, carries the waves
 * waiting for them as one small object: the newest one's handle (as the
 * person's own phone knows it), how many wait, and the newest one's number.
 * It is the same size however many wait, so it never outgrows the band's
 * buffer. Every other show carries none, which the wrist reads as nobody.
 *
 * A meeting its person said found keeps its number up, `FOUND: WAITING`, until
 * the other says it too (docs/superpowers/specs/2026-09-26-wrist-found-design.md).
 * Found by both, it is gone, and for FOUND_SHOW_MS every show about its person
 * but NOT NOW names it (`found`), so the band plays it once, even one that was
 * out of reach at the moment.
 *
 * Once the venue's staff name the opener (FIRST SONG?'s answer), for CALLED_SHOW_MS every show about a person whose
 * pick it was, but NOT NOW, says so (`calledIt`, with when it was named), so their band plays it once. A person who did
 * not call it is shown nothing: the band never says what anyone else picked, nor that they missed.
 */
export function bandShow({ view = null, battery = null, code = null, check = null, waiting = false, testUntil = 0, sound = null, waves = [], now = Date.now() }) {
  if (check) return { kind: 'check', big: String(check) };
  if (code) return { kind: 'pairing', code };
  if (waiting) return { kind: 'waiting' };
  const said = sound === null ? {} : { sound };
  if (testUntil > now) return { kind: 'test', ...said };
  const dim = battery !== null && battery <= DIM_AT;
  if (!view) return { kind: 'off', battery, away: true, ...said };
  const about = { armed: view.me.armed ?? null, rev: view.me.rev ?? 0, ...said };
  // NOT NOW is black, completely. Nothing broadcasting, and nothing to read.
  if (view.me.invisible) return { kind: 'off', battery, quiet: true, ...about };
  const waved = view.me.armed === 'hi' && waves.length ? { waves: { ref: waves[0].handle, n: waves.length, seq: waves[0].n } } : {};
  const done = view.matches
    .filter((m) => m.foundAt && now - m.foundAt < FOUND_SHOW_MS)
    .sort((a, b) => b.foundAt - a.foundAt)[0];
  // What the band plays once, whatever it shows: found by both, and the opener its person called.
  const plays = done ? { found: { n: done.number, intent: done.intent } } : {};
  const op = view.opener;
  const mine = trackKey(view.me.pick);
  if (op?.track && now - op.at < CALLED_SHOW_MS && mine && mine === trackKey(op.track)) plays.calledIt = { n: op.at };
  const meet = view.matches
    .filter((m) => now - m.at < MEET_MS && !m.foundAt)
    .sort((a, b) => b.at - a.at)[0];
  if (meet) return { kind: 'meet', intent: meet.intent, big: String(meet.number), small: meet.found ? 'FOUND: WAITING' : 'MEET', dim, ...about, ...waved, ...plays };
  switch (view.me.armed) {
    case 'hi': return { kind: 'hi', intent: 'hi', big: 'HI :)', small: 'blue means hello', dim, ...about, ...waved, ...plays };
    case 'song': return { kind: 'song', intent: 'song', big: 'FIRST SONG?', small: short(view.me.pick, 16), dim, ...about, ...plays };
    case 'dance': return { kind: 'dance', intent: 'dance', big: "LET'S DANCE!", small: '', dim, ...about, ...plays };
    default: return { kind: 'off', battery, ...about, ...plays };
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
