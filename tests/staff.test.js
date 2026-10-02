// ON THE BEAT — the staff page's side of the relay, over real sockets
// (docs/superpowers/specs/2026-09-28-staff-reports-design.md §2, §3): signing in, the live list, marking, the night.
// Test passcodes only.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { createRelay, WS_PATH, bandIdOf, personOf } from '../relay/server.js';
import { checkCode, makeEntry } from '../relay/staff.js';
import { helpers, newKey, pause } from './relay-harness.js';

const TZ = 'Australia/Brisbane';                     // UTC+10, no daylight saving
const EIGHT_PM = Date.UTC(2026, 8, 28, 10, 0);      // 20:00 on 28 Sep there
const NEXT_MORNING = Date.UTC(2026, 8, 28, 20, 30); // 06:30 on 29 Sep there: the next night
let base;
let root;
let CODES;
const running = [];

/** Polls until `pred()` holds, or fails after `ms`. */
async function until(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out');
    await pause(20);
  }
}

before(async () => {
  base = mkdtempSync(join(tmpdir(), 'otb-staff-'));
  root = join(base, 'dist');
  mkdirSync(root);
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>On The Beat</title>');
  writeFileSync(join(root, 'staff.html'), '<!doctype html><title>Staff</title>');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'app-abc123.js'), 'export {};');
  CODES = JSON.stringify({ 'staff-venue': await makeEntry('test-passcode-1'), 'staff-other': await makeEntry('test-passcode-2') });
});

after(async () => {
  for (const { relay, h } of running) {
    h.cleanup();
    await relay.close();
  }
  rmSync(base, { recursive: true, force: true });
});

let addresses = 0;
/**
 * A relay of its own, on a clock the test moves, where two venues have a staff page. `staffCheck` replaces the passcode check;
 * anything else in `more` goes to createRelay.
 */
async function start({ staffCheck, ...more } = {}) {
  const clock = { t: EIGHT_PM };
  const relay = await createRelay({ port: 0, host: '127.0.0.1', root, clock: () => clock.t, nightTz: TZ, staffCodes: CODES, ...(staffCheck ? { staffCheck } : {}), ...more });
  const h = helpers(() => relay.port);
  running.push({ relay, h });

  /** A staff page's socket: each answer to a sign-in, each list it is sent, and how it closed. */
  async function staff({ ip = '203.0.113.' + (1 + (addresses++ % 199)) } = {}) {
    const ws = new WebSocket('ws://127.0.0.1:' + relay.port + WS_PATH, { headers: { 'cf-connecting-ip': ip } });
    const s = { ws, answers: [], lists: [], closed: null, waiters: [] };
    const wake = () => { s.waiters = s.waiters.filter((w) => !w()); };
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.t === 'staff') s.answers.push(m);
      if (m.t === 'reports') s.lists.push(m.reports);
      wake();
    });
    ws.on('close', (code) => { s.closed = code; wake(); });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    s.send = (m) => ws.send(JSON.stringify(m));
    s.list = () => s.lists.at(-1);
    /** Waits until `pred()` holds, or fails with what the socket has seen. */
    s.until = (pred, ms = 3000) => new Promise((resolve, reject) => {
      const check = () => { if (pred()) { clearTimeout(timer); resolve(s); return true; } return false; };
      const timer = setTimeout(() => reject(new Error('staff timed out: '
        + JSON.stringify({ answers: s.answers, lists: s.lists, closed: s.closed }))), ms);
      if (!check()) s.waiters.push(check);
    });
    /** Sends a sign-in and waits for its answer. */
    s.signIn = async (m) => {
      const n = s.answers.length;
      s.send({ t: 'staff', ...m });
      await s.until(() => s.answers.length > n);
      return s.answers.at(-1);
    };
    return s;
  }

  /** Signed in with the right passcode, its first list come. */
  async function signedIn(venue = 'staff-venue', code = 'test-passcode-1') {
    const s = await staff();
    const a = await s.signIn({ venue, code });
    assert.equal(a.ok, true, JSON.stringify(a));
    await s.until(() => s.lists.length > 0);
    return s;
  }

  return { relay, clock, staff, signedIn, ...h };
}

test('a venue with no staff page says so, whatever it is called', async () => {
  const { staff } = await start();
  const s = await staff();
  for (const venue of ['moth-club-kayo-lane', '__proto__', 'constructor', '', undefined]) {
    assert.deepEqual(await s.signIn({ venue, code: 'test-passcode-1' }), { t: 'staff', ok: false, why: 'no staff page' });
  }
  assert.equal(s.lists.length, 0, 'no list without a sign-in');
});

test('a wrong passcode is refused and counted: past five a socket and twenty an address, even the right one waits', async () => {
  const { staff } = await start();
  const s = await staff({ ip: '203.0.113.200' });
  for (let i = 0; i < 5; i += 1) assert.equal((await s.signIn({ venue: 'staff-venue', code: 'wrong ' + i })).why, 'wrong code');
  assert.deepEqual(await s.signIn({ venue: 'staff-venue', code: 'test-passcode-1' }), { t: 'staff', ok: false, why: 'too many tries' });
  for (let k = 0; k < 3; k += 1) {
    const more = await staff({ ip: '203.0.113.200' });
    for (let i = 0; i < 5; i += 1) await more.signIn({ venue: 'staff-venue', code: 'wrong' });
  }
  const last = await staff({ ip: '203.0.113.200' });
  assert.equal((await last.signIn({ venue: 'staff-venue', code: 'test-passcode-1' })).why, 'too many tries', 'twenty from one address');
  const elsewhere = await staff({ ip: '203.0.113.201' });
  assert.equal((await elsewhere.signIn({ venue: 'staff-venue', code: 'test-passcode-1' })).ok, true, 'another address is not held back');
});

test('an IPv6 attacker has one allowance for a whole /64, not one an address', async () => {
  const { staff } = await start();
  for (const ip of ['2001:db8:1:2::1', '2001:db8:1:2:a::2', '2001:db8:1:2:b::3', '2001:db8:1:2:c::4']) {
    const s = await staff({ ip });
    for (let i = 0; i < 5; i += 1) assert.equal((await s.signIn({ venue: 'staff-venue', code: 'wrong ' + i })).why, 'wrong code');
  }
  const same = await staff({ ip: '2001:db8:1:2:dead:beef::5' });
  assert.equal((await same.signIn({ venue: 'staff-venue', code: 'test-passcode-1' })).why, 'too many tries', 'the fifth address in the /64 has none of its own');
  const apart = await staff({ ip: '2001:db8:1:3::1' });
  assert.equal((await apart.signIn({ venue: 'staff-venue', code: 'test-passcode-1' })).ok, true, 'another /64 is not held back');
});

test('at most eight passcode checks run at once: a ninth is refused unheard and does not spend its tries', async () => {
  const held = [];
  let open = true;
  const staffCheck = (entry, code) => (open ? new Promise((resolve) => held.push(() => resolve(checkCode(entry, code)))) : checkCode(entry, code));
  const { staff } = await start({ staffCheck });
  const busy = [];
  for (let i = 0; i < 8; i += 1) {
    const s = await staff();
    s.send({ t: 'staff', venue: 'staff-venue', code: 'test-passcode-1' });
    busy.push(s);
  }
  await until(() => held.length === 8);
  const ninth = await staff();
  assert.deepEqual(await ninth.signIn({ venue: 'staff-venue', code: 'test-passcode-1' }), { t: 'staff', ok: false, why: 'too many tries' });
  open = false;
  held.splice(0).forEach((go) => go());
  for (const s of busy) await s.until(() => s.answers.length === 1);
  assert.equal(busy.every((s) => s.answers[0].ok), true, 'the eight were checked as usual');
  for (let i = 0; i < 5; i += 1) assert.equal((await ninth.signIn({ venue: 'staff-venue', code: 'wrong ' + i })).why, 'wrong code', 'its own five tries are all still there: ' + i);
  assert.equal((await ninth.signIn({ venue: 'staff-venue', code: 'test-passcode-1' })).why, 'too many tries', 'the sixth is over its own five');
});

test('the right passcode signs in with a token, and the list comes at once', async () => {
  const { relay, staff } = await start();
  const s = await staff();
  const a = await s.signIn({ venue: ' Staff-Venue ', code: 'test-passcode-1' });
  assert.equal(a.ok, true);
  assert.equal(a.venue, 'staff-venue', 'the venue as its room is named');
  assert.match(a.token, /^[a-f0-9]{32}$/);
  assert.equal(a.push, relay.pushKey, 'the key its notifications are signed with');
  assert.match(relay.pushKey, /^B[A-Za-z0-9_-]{86}$/);
  await s.until(() => s.lists.length === 1);
  assert.deepEqual(s.list(), []);
});

test('a token signs in again after a reconnect, only at its own venue; a made-up one is expired', async () => {
  const { relay, staff } = await start();
  const first = await staff();
  const { token } = await first.signIn({ venue: 'staff-venue', code: 'test-passcode-1' });
  first.ws.close();
  const again = await staff();
  assert.deepEqual(await again.signIn({ venue: 'staff-venue', token }), { t: 'staff', ok: true, venue: 'staff-venue', token, push: relay.pushKey });
  await again.until(() => again.lists.length === 1);
  const elsewhere = await staff();
  assert.equal((await elsewhere.signIn({ venue: 'staff-other', token })).why, 'expired');
  assert.equal((await elsewhere.signIn({ venue: 'staff-venue', token: randomBytes(16).toString('hex') })).why, 'expired');
  assert.equal((await elsewhere.signIn({ venue: 'staff-venue', token: 42 })).why, 'bad staff', 'neither a passcode nor a token');
});

// The table of sign-ins is one for the whole relay, 1,000 of them. A passcode holder who signed in a thousand times
// used to push every other venue's staff out of it, and their notifications with them (staff review, 29 Sep 2026).
// A venue now has a share of its own, so it can only ever forget its own.
test("signing in over and over at one venue forgets that venue's oldest sign-ins and no other venue's", async () => {
  const { staff } = await start({ staffCheck: async () => true, staffTokensPerVenue: 3, staffTokensMax: 4 });
  const signIn = async (venue) => {
    const a = await (await staff()).signIn({ venue, code: 'whatever the check says' });
    assert.equal(a.ok, true, JSON.stringify(a));
    return a.token;
  };
  const valid = async (venue, token) => (await (await staff()).signIn({ venue, token })).ok === true;
  const other = await signIn('staff-other');
  const mine = [];
  for (let i = 0; i < 5; i += 1) mine.push(await signIn('staff-venue'));
  assert.equal(await valid('staff-other', other), true, "the other venue's sign-in is still good");
  assert.deepEqual(await Promise.all(mine.map((t) => valid('staff-venue', t))), [false, false, true, true, true],
    'the two oldest of its own went, the newest three stay');
});

test('the table as a whole still holds only so many sign-ins, the oldest of all going first', async () => {
  const { staff } = await start({ staffCheck: async () => true, staffTokensMax: 3, staffTokensPerVenue: 100 });
  const tokens = [];
  for (const venue of ['staff-venue', 'staff-other', 'staff-venue', 'staff-other']) {
    const a = await (await staff()).signIn({ venue, code: 'whatever the check says' });
    tokens.push([venue, a.token]);
  }
  const results = [];
  for (const [venue, token] of tokens) results.push((await (await staff()).signIn({ venue, token })).ok === true);
  assert.deepEqual(results, [false, true, true, true]);
});

test('a phone or a wristband cannot sign in as staff, and staff cannot act as either', async () => {
  const { relay, phone, wristband, reply, staff, signedIn } = await start();
  const s = await signedIn();
  const { token } = s.answers[0];
  const ana = await phone('staff-venue');
  for (const how of [{ token }, { code: 'test-passcode-1' }]) {
    const answer = reply(ana, 'staff');
    ana.send({ t: 'staff', venue: 'staff-venue', ...how });
    assert.deepEqual(await answer, { t: 'staff', ok: false, why: 'bad staff' });
  }
  const band = await wristband();
  const told = new Promise((resolve) => band.ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.t === 'staff') resolve(m);
  }));
  band.send({ t: 'staff', venue: 'staff-venue', token });
  assert.deepEqual(await told, { t: 'staff', ok: false, why: 'bad staff' });
  // A socket that joins while its passcode is being checked is a phone by the time the check ends.
  const racer = await staff();
  racer.send({ t: 'staff', venue: 'staff-venue', code: 'test-passcode-1' });
  racer.send({ t: 'join', venue: 'staff-venue', me: randomBytes(16).toString('hex') });
  await racer.until(() => racer.answers.length === 1);
  assert.deepEqual(racer.answers[0], { t: 'staff', ok: false, why: 'bad staff' });
  // Staff saying what a phone or a wristband says.
  const me = randomBytes(16).toString('hex');
  const key = newKey();
  s.send({ t: 'join', venue: 'staff-venue', me });
  s.send({ t: 'report', why: 'from staff' });
  s.send({ t: 'wristband', id: bandIdOf(key), key, v: 2, battery: 50 });
  await pause(300);
  assert.equal(relay.rooms.get('staff-venue').room.has(personOf(me)), false, 'no person made');
  assert.equal(relay.bandCount(), 1, 'no wristband made but the real one');
  assert.equal(relay.rooms.get('staff-venue').room.hasReports(), false, 'no report made');
  assert.equal(s.closed, null, 'still signed in');
});

test('signing in makes the venue\'s room, and a room with staff signed in is not let go', async () => {
  const { relay, clock, phone, reply, signedIn } = await start();
  const s = await signedIn();
  assert.equal(relay.rooms.has('staff-venue'), true);
  const ana = await phone('staff-venue');
  const left = reply(ana, 'left');
  ana.send({ t: 'leave' });
  await left;
  relay.expire(clock.t);
  assert.equal(relay.rooms.has('staff-venue'), true, 'staff hold it');
  s.ws.close();
  await s.until(() => s.closed !== null);
  await pause(100);
  relay.expire(clock.t);
  assert.equal(relay.rooms.has('staff-venue'), false, 'and let it go when they leave');
});

test('STAFF_CODES is read whole, or the relay does not start — and a bad entry is never printed', async () => {
  const entry = await makeEntry('test-passcode-1');
  const bad = [
    ['not json', /STAFF_CODES is not JSON/],
    ['[]', /not an object/],
    ['"text"', /not an object/],
    ['null', /not an object/],
    [JSON.stringify({ 'Staff Venue': entry }), /"Staff Venue" is not a venue id/],
    [JSON.stringify({ 'staff-venue': 'scrypt$1$1$1$ab$cd' }), /the entry for staff-venue/],
    [JSON.stringify({ 'staff-venue': 42 }), /the entry for staff-venue/],
  ];
  for (const [text, message] of bad) {
    // A relay that starts anyway is closed, or it would hold the test run open.
    let started = null;
    try {
      assert.throws(() => { started = createRelay({ port: 0, host: '127.0.0.1', root, staffCodes: text }); },
        (e) => message.test(e.message) && !e.message.includes('scrypt$'), text);
    } finally {
      if (started) await (await started).close();
    }
  }
});

test('a report made after sign-in reaches staff within a second: a tag, how often, both bands, the words — never who', async () => {
  const { phone, signedIn } = await start();
  const s = await signedIn();
  const ana = await phone('staff-venue');
  const ben = await phone('staff-venue');
  ana.send({ t: 'profile', name: 'Ana', contact: '@ana-contact' });
  ben.send({ t: 'profile', name: 'Ben', contact: '@ben-contact' });
  ben.send({ t: 'arm', intent: 'hi' });
  const { near: [row] } = await ana.until((v) => v.near.length === 1);
  const sent = Date.now();
  ana.send({ t: 'report', handle: row.handle, why: 'followed me to the bar' });
  await s.until(() => s.list().length === 1);
  assert.ok(Date.now() - sent < 1000, 'within a second');
  const [r] = s.list();
  assert.match(r.about, /^P-[0-9A-F]{6}$/);
  assert.deepEqual({ ...r, about: 'tag' }, {
    id: 'r1', at: EIGHT_PM, about: 'tag', times: 1, people: 1, bandNow: 'in this room', bandThen: 'in this room',
    fromThen: 'in this room', why: 'followed me to the bar', handledAt: 0,
  });
  ana.send({ t: 'report', handle: null, why: 'a spill by the stairs' });
  await s.until(() => s.list().length === 2);
  assert.deepEqual([s.list()[0].about, s.list()[0].why], [null, 'a spill by the stairs'], 'something else, newest first');
  const text = JSON.stringify(s.lists);
  for (const secret of [ana.me, ben.me, row.handle, 'Ana', 'Ben', '@ana-contact', '@ben-contact']) {
    assert.equal(text.includes(secret), false, secret + ' reached staff');
  }
});

test('words from a phone are kept only as a string, and cut to 200 characters', async () => {
  const { phone, signedIn } = await start();
  const s = await signedIn();
  const ana = await phone('staff-venue');
  for (const why of [{ toString: 'x' }, ['a list'], 42, 'x'.repeat(250)]) ana.send({ t: 'report', why });
  await s.until(() => s.list().length === 4);
  assert.deepEqual(s.list().map((r) => r.why.length), [200, 0, 0, 0]);
});

test('two staff screens see one mark; a mark is for its own venue only, and only a yes or a no', async () => {
  const { phone, signedIn } = await start();
  const one = await signedIn();
  const two = await signedIn();
  const other = await signedIn('staff-other', 'test-passcode-2');
  const ana = await phone('staff-venue');
  ana.send({ t: 'report', why: 'spill' });
  await two.until(() => two.list().length === 1);
  other.send({ t: 'handled', id: 'r1', on: true });   // its own venue has no r1
  one.send({ t: 'handled', id: 'r1', on: 'yes' });
  one.send({ t: 'handled', id: 1, on: true });
  await pause(300);
  assert.equal(two.list()[0].handledAt, 0);
  one.send({ t: 'handled', id: 'r1', on: true });
  await two.until(() => two.list()[0].handledAt === EIGHT_PM);
  one.send({ t: 'handled', id: 'r1', on: false });
  await two.until(() => two.list()[0].handledAt === 0);
  assert.deepEqual(other.list(), [], 'the other venue saw nothing');
});

test('a venue with a staff page keeps tonight\'s reports with nobody in it, till 06:00; another venue does not', async () => {
  const { relay, clock, phone, reply, signedIn } = await start();
  const ana = await phone('staff-venue');
  ana.send({ t: 'report', why: 'spill' });
  const left = reply(ana, 'left');
  ana.send({ t: 'leave' });
  await left;
  relay.expire(clock.t);
  assert.equal(relay.rooms.has('staff-venue'), true, 'its reports hold it');
  const later = await signedIn();
  assert.equal(later.list().length, 1, 'staff who sign in later still see it');
  later.ws.close();
  await later.until(() => later.closed !== null);
  const eve = await phone('moth-club-kayo-lane');
  eve.send({ t: 'report', why: 'x' });
  const gone = reply(eve, 'left');
  eve.send({ t: 'leave' });
  await gone;
  assert.equal(relay.rooms.has('moth-club-kayo-lane'), false, 'a venue with no staff page lets go as before');
  await pause(100);
  clock.t = NEXT_MORNING;
  relay.expire(clock.t);
  assert.equal(relay.rooms.has('staff-venue'), false, '06:00 clears them, and the room goes');
});

test('at 06:00 the night\'s reports go, staff are signed out as expired, and the token no longer signs in', async () => {
  const { relay, clock, phone, staff, signedIn } = await start();
  const s = await staff();
  const { token } = await s.signIn({ venue: 'staff-venue', code: 'test-passcode-1' });
  const ana = await phone('staff-venue');
  ana.send({ t: 'report', why: 'late one' });
  await s.until(() => s.list()?.length === 1);
  clock.t = NEXT_MORNING;
  const early = await staff();
  assert.equal((await early.signIn({ venue: 'staff-venue', token })).why, 'expired', 'before the sweep has run');
  relay.expire(clock.t);
  await s.until(() => s.closed === 4004);
  assert.deepEqual(s.answers.at(-1), { t: 'staff', ok: false, why: 'expired' });
  const back = await staff();
  assert.equal((await back.signIn({ venue: 'staff-venue', token })).why, 'expired');
  const fresh = await signedIn();
  assert.deepEqual(fresh.list(), [], 'a new night starts with none');
});

test('the relay\'s log says a report came, and never what it says or who made it', async () => {
  const { phone } = await start();
  const ana = await phone('staff-venue');
  const logged = [];
  const was = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  try {
    ana.send({ t: 'report', why: 'secret words' });
    await pause(300);
  } finally {
    console.log = was;
  }
  assert.deepEqual(logged.filter((l) => l.startsWith('REPORT')), ['REPORT staff-venue r1']);
  assert.equal(logged.some((l) => l.includes('secret words') || l.includes(ana.me)), false);
});

test('the log line for a report replaces control, format and separator characters in the venue name, which a stranger typed', async () => {
  const { phone } = await start();
  // An escape, a right-to-left override, a line separator (which venueKey folds to a space) and a NUL.
  const ana = await phone('evil' + String.fromCodePoint(0x1b) + '[31m venue' + String.fromCodePoint(0x202e, 0x2028) + 'x' + String.fromCodePoint(0));
  const logged = [];
  const was = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  try {
    ana.send({ t: 'report', why: 'words' });
    await pause(300);
  } finally {
    console.log = was;
  }
  assert.deepEqual(logged.filter((l) => l.startsWith('REPORT')), ['REPORT evil?[31m venue? x? r1']);
});

test('a person may send ten reports an hour: the eleventh is refused, unlogged and unpushed, and an hour later they may again', async () => {
  const { relay, clock, phone, signedIn } = await start();
  const s = await signedIn();
  const ana = await phone('staff-venue');
  for (let i = 0; i < 10; i += 1) ana.send({ t: 'report', why: 'report ' + i });
  await s.until(() => s.list().length === 10);
  const lists = s.lists.length;
  const logged = [];
  const was = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  try {
    ana.send({ t: 'report', why: 'the eleventh' });
    await ana.until((v, p) => p.errors.includes('report refused'));
    await pause(300);   // a list would have been pushed by now
  } finally {
    console.log = was;
  }
  assert.equal(logged.some((l) => l.startsWith('REPORT')), false, 'nothing logged for it');
  assert.equal(s.lists.length, lists, 'no list pushed for it');
  assert.equal(relay.rooms.get('staff-venue').room.reports().length, 10);
  clock.t += 3_600_001;
  ana.send({ t: 'report', why: 'an hour later' });
  await s.until(() => s.list().length === 11);
});

test('a network may send sixty reports an hour over everyone on it: the sixty-first is refused, from whoever sends it', async () => {
  const { relay, phone } = await start();
  const reports = () => relay.rooms.get('staff-venue').room.reports().length;
  const people = [];
  for (let i = 0; i < 7; i += 1) people.push(await phone('staff-venue', { ip: '198.51.100.91' }));
  for (const p of people.slice(0, 6)) for (let i = 0; i < 10; i += 1) p.send({ t: 'report', why: 'x' });
  await until(() => reports() === 60);
  people[6].send({ t: 'report', why: 'the sixty-first' });
  await people[6].until((v, p) => p.errors.includes('report refused'));
  assert.equal(reports(), 60);
  const elsewhere = await phone('staff-venue', { ip: '198.51.100.92' });
  elsewhere.send({ t: 'report', why: 'another network' });
  await until(() => reports() === 61);
});

test('a refused report still counts against its network', async () => {
  const { relay, phone } = await start();
  const reports = () => relay.rooms.get('staff-venue').room.reports().length;
  const ip = '198.51.100.93';
  const flooder = await phone('staff-venue', { ip });
  for (let i = 0; i < 15; i += 1) flooder.send({ t: 'report', why: 'x' });   // ten taken, five refused
  await flooder.until((v, p) => p.errors.length === 5);
  for (let k = 0; k < 5; k += 1) {
    const other = await phone('staff-venue', { ip });
    for (let i = 0; i < 9; i += 1) other.send({ t: 'report', why: 'x' });   // forty-five more: sixty sent in all
  }
  await until(() => reports() === 55);
  const last = await phone('staff-venue', { ip });
  last.send({ t: 'report', why: 'the sixty-first sent' });
  await last.until((v, p) => p.errors.includes('report refused'));
  assert.equal(reports(), 55, 'fifty-five were taken, and sixty were sent');
});

test('the relay serves the staff page at /staff, and the app everywhere else', async () => {
  const { relay } = await start();
  const get = async (path) => (await fetch('http://127.0.0.1:' + relay.port + path)).text();
  for (const path of ['/staff', '/staff/', '/staff?venue=x']) assert.match(await get(path), /<title>Staff<\/title>/, path);
  for (const path of ['/', '/tonight', '/staffroom', '/staff/x']) assert.match(await get(path), /<title>On The Beat<\/title>/, path);
});

test('every response carries the security headers, every page is unframeable, and each page carries its own full policy', async () => {
  const { relay } = await start();
  const h = async (path, headers) => (await fetch('http://127.0.0.1:' + relay.port + path, { headers })).headers;
  for (const path of ['/', '/staff', '/tonight', '/assets/app-abc123.js', '/api/shows', '/clip/nobody/nothing']) {
    const headers = await h(path);
    assert.equal(headers.get('referrer-policy'), 'no-referrer', path);
    assert.equal(headers.get('x-content-type-options'), 'nosniff', path);
    assert.equal(headers.get('strict-transport-security'), null, path + ' over plain http');
  }
  // The phone app's policy is the staff page's plus `media-src` for the clips: the recorded five seconds play
  // from a blob URL the phone made itself, and the floor's from /clip/ (docs/superpowers/specs/2026-09-30-app-csp-design.md).
  for (const path of ['/', '/tonight', '/index.html']) {
    const headers = await h(path);
    const policy = headers.get('content-security-policy');
    assert.equal(headers.get('x-frame-options'), 'DENY', path);
    for (const directive of [
      "default-src 'self'", "script-src 'self'", "style-src 'self'",
      "font-src 'self'", "img-src 'self' data:", "media-src 'self' blob:",
      "connect-src 'self' ws: wss:", "worker-src 'self'", "manifest-src 'self'",
      "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
    ]) {
      assert.ok(policy.split('; ').includes(directive), path + ' lacks ' + directive + ' in ' + policy);
    }
    assert.doesNotMatch(policy, /unsafe-/, 'no inline script or eval is allowed');
  }
  for (const path of ['/staff', '/staff/', '/staff?venue=x', '/staff.html']) {
    const headers = await h(path);
    const policy = headers.get('content-security-policy');
    assert.equal(headers.get('x-frame-options'), 'DENY', path);
    for (const directive of ["default-src 'self'", "script-src 'self'", "connect-src 'self' ws: wss:", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
      assert.ok(policy.split('; ').includes(directive), path + ' lacks ' + directive + ' in ' + policy);
    }
    assert.doesNotMatch(policy, /unsafe-/, 'no inline script or eval is allowed');
  }
  for (const path of ['/assets/app-abc123.js', '/api/shows']) {
    const headers = await h(path);
    assert.deepEqual([headers.get('x-frame-options'), headers.get('content-security-policy')], [null, null], path + ' is not a page');
  }
  assert.equal((await h('/', { 'x-forwarded-proto': 'https' })).get('strict-transport-security'), 'max-age=31536000');
  assert.equal((await h('/', { 'x-forwarded-proto': 'https,http' })).get('strict-transport-security'), 'max-age=31536000');
  assert.equal((await h('/', { 'x-forwarded-proto': 'http' })).get('strict-transport-security'), null);
});

test('a 503 carries them too, when there is no build to serve', async () => {
  const bare = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'nowhere'), nightTz: TZ });
  try {
    const res = await fetch('http://127.0.0.1:' + bare.port + '/');
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    await bare.close();
  }
});
