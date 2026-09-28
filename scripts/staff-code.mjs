// ON THE BEAT — one venue's staff passcode, as an entry for the relay's STAFF_CODES
// (docs/superpowers/specs/2026-09-28-staff-reports-design.md §2).
//
//   npm run staff-code
//
// Asks for the venue's show id and a passcode of at least eight characters, twice. The passcode is never shown:
// not as it is typed, and not in what is printed. stdout gets one line, `"<venue>": "scrypt$..."`; the questions
// go to stderr. Put each venue's line between STAFF_CODES's braces and set it on the relay (README, "The staff
// page").

import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { loadShows, venueKey } from '../relay/server.js';
import { makeEntry } from '../relay/staff.js';

const CODE_MIN = 8;

// What a terminal would echo goes to stderr, and none of it while a passcode is being typed.
let hidden = false;
const echo = new Writable({ write(chunk, encoding, done) { if (!hidden) process.stderr.write(chunk); done(); } });
const rl = createInterface({ input: process.stdin, output: echo, terminal: !!process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();

async function ask(question, secret = false) {
  process.stderr.write(question);
  hidden = secret;
  const { value = '' } = await lines.next();
  hidden = false;
  if (secret) process.stderr.write('\n');
  return value;
}

function fail(why) {
  rl.close();
  process.stderr.write(why + ' Nothing was made.\n');
  process.exitCode = 1;
}

async function main() {
  const venue = venueKey(await ask('Venue (its show id, as in relay/shows.json): '));
  if (!venue) return fail('No venue given.');
  const shows = loadShows(fileURLToPath(new URL('../relay/shows.json', import.meta.url)));
  if (!shows.some((s) => s.id === venue)) {
    process.stderr.write('Note: ' + venue + ' is not in relay/shows.json, so the staff page will not list it.\n');
  }
  const code = await ask('Passcode (at least ' + CODE_MIN + ' characters; not shown): ', true);
  if ([...code].length < CODE_MIN) return fail('A passcode needs at least ' + CODE_MIN + ' characters.');
  if ((await ask('The same passcode again: ', true)) !== code) return fail('The two passcodes differ.');
  rl.close();
  process.stdout.write(JSON.stringify(venue) + ': ' + JSON.stringify(await makeEntry(code)) + '\n');
}

await main();
