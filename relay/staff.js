// ON THE BEAT — a venue's staff passcode, kept only as an entry made from it
// (docs/superpowers/specs/2026-09-28-staff-reports-design.md §2).
//
// An entry is `scrypt$16384$8$1$<salt>$<hash>`, in hex: the passcode through scrypt with a salt of its own. The
// owner makes one with `npm run staff-code` (scripts/staff-code.mjs) and gives the relay a JSON object of venue
// id -> entry as STAFF_CODES. No passcode is kept anywhere.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// 16 MiB and tens of milliseconds a check: dear to guess at, cheap for a team signing in.
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const ENTRY = /^scrypt\$16384\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{64})$/;

/** The passcode through scrypt, on libuv's pool, off the event loop. */
const derive = (code, salt) => new Promise((resolve, reject) => {
  scrypt(String(code).normalize('NFC'), Buffer.from(salt, 'hex'), KEY_LEN, { N, r: R, p: P },
    (err, key) => (err ? reject(err) : resolve(key)));
});

/** Is this an entry makeEntry() makes? */
export const isEntry = (entry) => typeof entry === 'string' && ENTRY.test(entry);

/** An entry for a passcode, with a salt of its own. */
export async function makeEntry(code, salt = randomBytes(16).toString('hex')) {
  return ['scrypt', N, R, P, salt, (await derive(code, salt)).toString('hex')].join('$');
}

/** Does this passcode make this entry? Compared in constant time; false for anything that is not an entry. */
export async function checkCode(entry, code) {
  const m = typeof entry === 'string' ? ENTRY.exec(entry) : null;
  if (!m) return false;
  return timingSafeEqual(await derive(code, m[1]), Buffer.from(m[2], 'hex'));
}
