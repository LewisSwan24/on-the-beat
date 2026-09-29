// ON THE BEAT — one venue's staff passcode, as an entry for the relay's STAFF_CODES
// (docs/superpowers/specs/2026-09-28-staff-reports-design.md §2).
//
//   npm run staff-code
//
// Asks for the venue's show id and a passcode of at least twelve characters, twice; or Enter, for one made for
// you (docs/superpowers/specs/2026-09-29-staff-security-design.md §2): three groups of four, shown once on stderr
// and kept nowhere. A passcode typed is never shown, not as it is typed and not in what is printed. stdout gets
// one line, `"<venue>": "scrypt$..."`; the questions go to stderr. Put each venue's line between STAFF_CODES's
// braces and set it on the relay (README, "The staff page"). The relay restarts when the secret is set, and
// every sign-in made under a venue's old passcode ends with it.

import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { loadShows, venueKey } from '../relay/server.js';
import { madeCode, makeEntry } from '../relay/staff.js';

const CODE_MIN = 12;

// What a terminal would echo goes to stderr, and none of it while a passcode is being typed.
let hidden = false;
const echo = new Writable({ write(chunk, encoding, done) { if (!hidden) process.stderr.write(chunk); done(); } });
const rl = createInterface({ input: process.stdin, output: echo, terminal: !!process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();

async function ask(question, secret = false) {
  process.stderr.write(question);
  hidden = secret;
  const { value = '', done } = await lines.next();
  hidden = false;
  if (secret) process.stderr.write('\n');
  return done ? null : value;   // null: the input ended, nobody pressed Enter
}

function fail(why) {
  rl.close();
  process.stderr.write(why + ' Nothing was made.\n');
  process.exitCode = 1;
}

async function main() {
  const venue = venueKey((await ask('Venue (its show id, as in relay/shows.json): ')) ?? '');
  if (!venue) return fail('No venue given.');
  const shows = loadShows(fileURLToPath(new URL('../relay/shows.json', import.meta.url)));
  if (!shows.some((s) => s.id === venue)) {
    process.stderr.write('Note: ' + venue + ' is not in relay/shows.json, so the staff page will not list it.\n');
  }
  const typed = await ask('Passcode (at least ' + CODE_MIN + ' characters, not shown; Enter for one made for you): ', true);
  if (typed === null) return fail('No passcode given.');
  let code = typed;
  if (typed === '') {
    code = madeCode();
    process.stderr.write('Passcode (made for you, shown once, kept nowhere): ' + code + '\n');
  } else {
    if ([...code].length < CODE_MIN) return fail('A passcode needs at least ' + CODE_MIN + ' characters, or press Enter for one made for you.');
    if ((await ask('The same passcode again: ', true)) !== code) return fail('The two passcodes differ.');
  }
  rl.close();
  process.stdout.write(JSON.stringify(venue) + ': ' + JSON.stringify(await makeEntry(code)) + '\n');
}

await main();
