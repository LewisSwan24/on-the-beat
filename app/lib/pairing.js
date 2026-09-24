// What a wristband's pairing code looks like once it has left the wristband.
//
// The wristband shows its four letters and, beside them, a QR code of an
// address: the app, carrying those letters. A phone's own camera opens that
// address, the app's own scanner reads the same code, or the letters are
// typed; every way in ends with the same check: the wristband that was
// reached shows a number, and the phone asks whether it is the one on this
// wrist.

import { cleanCode } from '../../relay/band.js';

/** What the phone says for each answer the relay gives while pairing (spec §0). */
export const PAIR_SAY = {
  check: (n) => 'Does your wristband show ' + n + '?',
  checkSub: 'Only say yes if it’s on the wristband you’re holding.',
  paired: 'Paired. It’s your light tonight.',
  no: 'That’s not this wristband.',
  timeout: 'No answer in time. Try again.',
  busy: 'Someone is pairing that wristband right now. Try again in a minute.',
  'old firmware': 'Update this wristband’s firmware.',
  'no such wristband': 'That’s not a wristband here. Check the letters.',
  'too many tries': 'Too many tries. Wait a moment, then scan it instead.',
  gone: 'Your wristband restarted or went away. Pair it again.',
};

/** The address a pairing code opens: the app, with the four letters on it. */
export const pairUrl = (origin, code) => String(origin).replace(/\/+$/, '') + '/pair/' + code;

/**
 * The four letters in whatever a scan read — the pairing address, or the
 * letters on their own — or null. Only a whole code counts: a letter from
 * outside the alphabet means this is not a wristband's code, not a code to
 * trim until it looks like one.
 */
export function codeFrom(text) {
  const s = String(text ?? '').trim();
  let part = s;
  try {
    const url = new URL(s);
    const m = url.pathname.match(/^\/pair\/([^/]+)\/?$/);
    if (!m) return null;
    part = decodeURIComponent(m[1]);
  } catch { /* not an address: perhaps the letters alone */ }
  const code = part.toUpperCase();
  return code.length === 4 && cleanCode(code) === code ? code : null;
}
