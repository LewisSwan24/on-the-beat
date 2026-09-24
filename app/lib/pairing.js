// What a wristband's pairing code looks like once it has left the wristband.
//
// The wristband shows its four letters and, beside them, a QR code of an
// address: the app, carrying those letters. A phone's own camera opens that
// address and the app pairs once it is in a room; the app's own scanner reads
// the same code. Either way the letters are all that matter.

import { cleanCode } from '../../relay/band.js';

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
