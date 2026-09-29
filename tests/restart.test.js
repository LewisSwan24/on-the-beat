// ON THE BEAT — the night carried across a restart
// (docs/superpowers/specs/2026-09-29-restart-persistence-design.md): a relay closed, and a new one on the same
// file. Test passcodes only.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createRelay, personOf, WS_PATH, BAND_ALONE_MS } from '../relay/server.js';
import { makeEntry } from '../relay/staff.js';
import { helpers, newKey, pause } from './relay-harness.js';

const TZ = 'Australia/Brisbane';                     // UTC+10, no daylight saving
const NINE_PM = Date.UTC(2026, 8, 29, 11, 0);       // 21:00 on 29 Sep there
const NEXT_MORNING = Date.UTC(2026, 8, 29, 20, 30); // 06:30 on 30 Sep there: the next night
let dir;
let root;
let CODES;
let files = 0;
let addresses = 0;
const nights = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'otb-restart-'));
  root = join(dir, 'dist');                           // served, and empty: the night files sit beside it
  mkdirSync(root);
  CODES = JSON.stringify({ 'restart-staff': await makeEntry('test-passcode-1') });
});

after(async () => {
  for (const n of nights) if (n.open) await n.stop();
  rmSync(dir, { recursive: true, force: true });
});

/** Polls until `pred()` holds, or fails after `ms`. */
async function until(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out');
    await pause(20);
  }
}

/** What `fn` logs while it runs, one string a line. */
async function logged(fn) {
  const said = [];
  const log = console.log;
  console.log = (...a) => { said.push(a.join(' ')); };
  try {
    await fn();
  } finally {
    console.log = log;
  }
  return said;
}

/**
 * A night on a file of its own. `start()` opens a relay on it at the clock's time; `stop()` closes it, which writes
 * the night; `restart()` stops, moves the clock half a minute, as a deploy takes, and starts a new relay on the
 * same file. `on` has the harness's phones and wristbands, on whichever relay is open. Its timer writes once an hour
 * unless asked, so a test's own `save()` calls are the only writes. `codes` is STAFF_CODES, which a test may
 * change between a stop and a start.
 */
function night({ saveEveryMs = 3_600_000, graceMs, file, keys = false } = {}) {
  const n = { clock: { t: NINE_PM }, file: file ?? join(dir, 'night-' + (files += 1) + '.json'), relay: null, open: false, codes: CODES };
  n.on = helpers(() => n.relay.port);
  n.start = async () => {
    n.relay = await createRelay({
      port: 0, host: '127.0.0.1', root, clock: () => n.clock.t, nightTz: TZ, staffCodes: n.codes,
      nightFile: n.file, saveEveryMs, ...(graceMs ? { graceMs } : {}),
      ...(keys ? { pushKeysFile: n.file.replace(/\.json$/, '-keys.json') } : {}),
    });
    n.open = true;
    return n.relay;
  };
  n.stop = async () => {
    await n.relay.close();       // written here, before a socket closes
    n.on.cleanup();
    n.open = false;
  };
  n.restart = async () => {
    await n.stop();
    n.clock.t += 30_000;
    return n.start();
  };
  n.saved = () => JSON.parse(readFileSync(n.file, 'utf8'));
  nights.push(n);
  return n;
}

// ---------- §2: writing ----------

test('the night is written within a second of a change, by itself', async () => {
  const n = night({ saveEveryMs: 50 });
  await n.start();
  await n.on.phone('restart-write');
  await until(() => existsSync(n.file));
  const saved = n.saved();
  assert.deepEqual([saved.v, saved.at], [1, NINE_PM]);
  assert.match(saved.staffKey, /^[a-f0-9]{64}$/);
  assert.deepEqual(saved.rooms.map((r) => r.key), ['restart-write']);
  assert.equal(saved.rooms[0].room.people.length, 1);
});

test('the relay writes nothing while nothing changes', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-idle');
  assert.equal(n.relay.save(), 'written');
  assert.equal(n.relay.save(), 'same', 'nothing changed');
  ana.send({ t: 'pick', track: 'Treasure' });
  await ana.until((v) => v.me.pick === 'Treasure');
  assert.equal(n.relay.save(), 'written', 'a pick is a change');
});

test('once everyone has left, the file is gone', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-empty');
  assert.equal(n.relay.save(), 'written');
  assert.equal(existsSync(n.file), true);
  const left = n.on.reply(ana, 'left');
  ana.send({ t: 'leave' });
  await left;
  assert.equal(n.relay.save(), 'removed');
  assert.equal(existsSync(n.file), false);
});

test('an emptied night stays removed: a later save is never same, which the stop path would call written', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-emptied');
  assert.equal(n.relay.save(), 'written');
  const left = n.on.reply(ana, 'left');
  ana.send({ t: 'leave' });
  await left;
  assert.equal(n.relay.save(), 'removed');
  assert.equal(n.relay.save(), 'removed', 'nothing changed, and there is still no file that holds the night');
  assert.equal(existsSync(n.file), false);
  await n.on.phone('restart-emptied');
  assert.equal(n.relay.save(), 'written', 'the file is back with the next person');
  assert.equal(n.relay.save(), 'same', 'and unchanged is same again');
});

test('a relay that never held anyone answers removed however often it saves, never same', async () => {
  const n = night();
  await n.start();
  assert.equal(n.relay.save(), 'removed');
  assert.equal(n.relay.save(), 'removed', 'still no night, still no file');
  assert.equal(existsSync(n.file), false);
});

test('closing the relay writes the night', async () => {
  const n = night();
  await n.start();
  await n.on.phone('restart-close');
  await n.stop();
  assert.deepEqual(n.saved().rooms.map((r) => r.key), ['restart-close']);
});

test('a write that fails is said once, and the relay runs on', async () => {
  const n = night({ file: join(dir, 'no-such-folder', 'night.json') });
  await n.start();
  const ana = await n.on.phone('restart-fail');
  const said = await logged(() => {
    assert.equal(n.relay.save(), 'failed');
    assert.equal(n.relay.save(), 'failed');
  });
  assert.deepEqual(said, ['night: cannot write (ENOENT)']);
  ana.send({ t: 'pick', track: 'Treasure' });
  await ana.until((v) => v.me.pick === 'Treasure');
});

// ---------- §2, §3: reading it back ----------

test('a block made before a restart still hides both from each other after it', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-block');
  const ben = await n.on.phone('restart-block');
  ana.send({ t: 'pick', track: 'ana' });
  ben.send({ t: 'pick', track: 'ben' });
  ben.send({ t: 'arm', intent: 'hi' });
  const { near: [row] } = await ana.until((v) => v.near.length === 1);
  ana.send({ t: 'block', handle: row.handle });
  await ana.until((v) => v.near.length === 0);
  await n.restart();
  const anaBack = await n.on.phone('restart-block', { me: ana.me });
  const benBack = await n.on.phone('restart-block', { me: ben.me });
  anaBack.send({ t: 'arm', intent: 'hi' });
  const cai = await n.on.phone('restart-block');
  cai.send({ t: 'pick', track: 'cai' });
  cai.send({ t: 'arm', intent: 'hi' });
  await anaBack.until((v) => v.near.some((p) => p.pick === 'cai'));
  await benBack.until((v) => v.near.some((p) => p.pick === 'cai'));
  assert.deepEqual(anaBack.view.near.map((p) => p.pick), ['cai'], 'Ana sees Cai, and not Ben');
  assert.deepEqual(benBack.view.near.map((p) => p.pick), ['cai'], 'Ben sees Cai, and not Ana');
});

test('a match keeps its id, number and spot across a restart, and a keep after it still shares the contacts', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-match');
  const ben = await n.on.phone('restart-match');
  ana.send({ t: 'profile', name: 'Ana', contact: '@ana' });
  ben.send({ t: 'profile', name: 'Ben', contact: '@ben' });
  for (const p of [ana, ben]) p.send({ t: 'arm', intent: 'hi' });
  const { near: [toBen] } = await ana.until((v) => v.near.length === 1);
  const { near: [toAna] } = await ben.until((v) => v.near.length === 1);
  ana.send({ t: 'wave', handle: toBen.handle });
  ben.send({ t: 'wave', handle: toAna.handle });
  const { matches: [before] } = await ana.until((v) => v.matches.length === 1);
  ana.send({ t: 'keep', match: before.id, on: true });
  await ana.until((v) => v.matches[0].kept);
  await n.restart();
  const anaBack = await n.on.phone('restart-match', { me: ana.me });
  const benBack = await n.on.phone('restart-match', { me: ben.me });
  const [after] = benBack.view.matches;
  assert.deepEqual([after.id, after.number, after.spot, after.name], [before.id, before.number, before.spot, 'Ana']);
  benBack.send({ t: 'keep', match: after.id, on: true });
  await benBack.until((v) => v.matches[0].contact === '@ana');
  await anaBack.until((v) => v.matches[0].contact === '@ben');
});

test('a card on SAY HI is still on after a restart, with nothing sent again', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-card');
  ana.send({ t: 'pick', track: 'ana' });
  ana.send({ t: 'arm', intent: 'hi' });
  const ben = await n.on.phone('restart-card');
  await ben.until((v) => v.near.some((p) => p.pick === 'ana'));
  await n.restart();
  const benBack = await n.on.phone('restart-card', { me: ben.me });
  assert.ok(benBack.view.near.some((p) => p.pick === 'ana'), 'Ana, not back yet, is still on SAY HI');
  const anaBack = await n.on.phone('restart-card', { me: ana.me });
  assert.deepEqual([anaBack.view.me.armed, anaBack.view.me.fresh], ['hi', false], 'her own card, as she left it');
});

test('a file from another night is removed unread, and the relay starts empty', async () => {
  const n = night();
  await n.start();
  await n.on.phone('restart-old');
  await n.stop();
  assert.equal(existsSync(n.file), true, 'written at the close');
  n.clock.t = NEXT_MORNING;
  const said = await logged(() => n.start());
  assert.ok(said.includes('night: from another night, discarded'), said.join('\n'));
  assert.equal(existsSync(n.file), false, 'removed unread');
  assert.equal(n.relay.roomCount(), 0);
});

test('a file that does not parse, of another version, or that cannot be restored is removed, and the relay starts empty', async () => {
  const good = { v: 1, at: NINE_PM, staffKey: 'ab'.repeat(32), rooms: [], bands: [], gone: [], tokens: [] };
  // Every list a room dump has, and no counters.
  const room = { salt: 's', people: [], blocks: [], waves: [], latest: [], likes: [], dances: [], matches: [], tombs: [], reports: [] };
  for (const [text, why] of [
    ['{"v":1,"at":', 'SyntaxError'],
    [JSON.stringify({ ...good, v: 2 }), 'TypeError'],
    [JSON.stringify({ ...good, rooms: [{ key: 'restart-bad', room, heard: [], sound: [] }] }), 'TypeError'],
  ]) {
    const n = night();
    writeFileSync(n.file, text);
    const said = await logged(() => n.start());
    assert.ok(said.includes('night: unreadable (' + why + '), discarded'), text + '\n' + said.join('\n'));
    assert.equal(existsSync(n.file), false, 'removed');
    assert.equal(n.relay.roomCount(), 0, 'started empty');
    await n.stop();
  }
});

test('a person nobody comes back for leaves when the grace runs out', async () => {
  const n = night({ graceMs: 800 });
  await n.start();
  const ana = await n.on.phone('restart-grace');
  const ben = await n.on.phone('restart-grace');
  ana.send({ t: 'pick', track: 'ana' });
  await ben.until((v) => v.wall.some((p) => p.pick === 'ana'));
  await n.restart();
  const benBack = await n.on.phone('restart-grace', { me: ben.me });
  assert.ok(benBack.view.wall.some((p) => p.pick === 'ana'), 'Ana, not back, is in her grace');
  await benBack.until((v) => !v.wall.some((p) => p.pick === 'ana'), 3000);
  assert.equal(n.relay.rooms.get('restart-grace').room.size(), 1, 'Ben alone');
});

test('a restart is logged in counts, never a name, a contact or an id', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-log');
  ana.send({ t: 'profile', name: 'Ana', contact: '@ana' });
  await ana.until((v) => v.me.name === 'Ana');
  const said = await logged(() => n.restart());
  assert.ok(said.some((l) => /^night: carried on from .+ — 1 rooms, 1 people/.test(l)), said.join('\n'));
  for (const secret of [ana.me, 'Ana', '@ana', 'restart-log']) assert.equal(said.join('\n').includes(secret), false, secret + ' was logged');
});

// ---------- §3: wristbands and staff ----------

/** A staff page's socket on the night's relay: each answer to a sign-in, and each list it is sent. */
async function staffOn(n) {
  const ws = new WebSocket('ws://127.0.0.1:' + n.relay.port + WS_PATH, { headers: { 'cf-connecting-ip': '203.0.113.' + (1 + (addresses++ % 199)) } });
  const s = { ws, answers: [], lists: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.t === 'staff') s.answers.push(m);
    if (m.t === 'reports') s.lists.push(m.reports);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  s.list = () => s.lists.at(-1);
  s.signIn = async (m) => {
    const was = s.answers.length;
    ws.send(JSON.stringify({ t: 'staff', ...m }));
    await until(() => s.answers.length > was);
    return s.answers.at(-1);
  };
  return s;
}

test('a paired wristband goes straight back to its person after a restart, and a wrong secret is still refused', async () => {
  const n = night();
  await n.start();
  const band = await n.on.wristband(62);
  const ana = await n.on.phone('restart-band');
  const { secret } = await n.on.pairBand(ana, band);
  n.clock.t += 3_000;                                   // past the white flash a new pairing gives
  ana.send({ t: 'arm', intent: 'hi' });
  await band.until((s) => s.kind === 'hi');
  await n.restart();
  const wrong = await n.on.hello({ t: 'wristband', id: band.id, key: band.key, v: 2, battery: 50, secret: newKey() });
  assert.deepEqual([wrong.reply, wrong.closed], [{ t: 'error', why: 'bad band' }, 4001], 'a wrong secret');
  const back = await n.on.wristband(62, { key: band.key, secret });
  assert.equal(back.show.kind, 'hi', 'her card at once: no OPEN YOUR PHONE, no claim');
});

test('a staff token from before a restart signs in after it, to the same reports, marks and tags', async () => {
  const n = night({ keys: true });
  await n.start();
  const s = await staffOn(n);
  const { token } = await s.signIn({ venue: 'restart-staff', code: 'test-passcode-1' });
  const ana = await n.on.phone('restart-staff');
  const ben = await n.on.phone('restart-staff');
  ben.send({ t: 'arm', intent: 'hi' });
  const { near: [row] } = await ana.until((v) => v.near.length === 1);
  ana.send({ t: 'report', handle: row.handle, why: 'kept following me' });
  await until(() => s.list()?.length === 1);
  s.ws.send(JSON.stringify({ t: 'handled', id: s.list()[0].id, on: true }));
  await until(() => s.list()[0].handledAt > 0);
  const before = s.list();
  const key = n.relay.pushKey;
  await n.restart();
  const again = await staffOn(n);
  assert.deepEqual(await again.signIn({ venue: 'restart-staff', token }), { t: 'staff', ok: true, venue: 'restart-staff', token, push: key },
    'the same keys, so a device\'s subscription still works');
  await until(() => again.lists.length === 1);
  assert.deepEqual(again.list(), before, 'the same reports, the same mark, the same tag');
});

test('a staff sign-in ends at a restart when its venue\'s passcode entry changed, the same passcode set again included, and the log counts them', async () => {
  const n = night();
  await n.start();
  const s = await staffOn(n);
  const { token } = await s.signIn({ venue: 'restart-staff', code: 'test-passcode-1' });
  const same = await logged(() => n.restart());
  assert.ok(same.some((l) => /, 1 staff sign-ins$/.test(l)), same.join('\n'));
  assert.equal(same.some((l) => /ended/.test(l)), false, 'nothing ends under the same entry');
  assert.equal((await (await staffOn(n)).signIn({ venue: 'restart-staff', token })).ok, true, 'still signed in under the same entry');
  await n.stop();
  n.codes = JSON.stringify({ 'restart-staff': await makeEntry('test-passcode-1') });   // the same passcode, with a salt of its own
  n.clock.t += 30_000;
  const said = await logged(() => n.start());
  assert.ok(said.includes("night: 1 staff sign-ins ended: their venue's passcode changed"), said.join('\n'));
  assert.ok(said.some((l) => /, 0 staff sign-ins$/.test(l)), 'the line for what was carried on counts only what was kept');
  const again = await staffOn(n);
  assert.equal((await again.signIn({ venue: 'restart-staff', token })).why, 'expired');
  assert.equal((await again.signIn({ venue: 'restart-staff', code: 'test-passcode-1' })).ok, true, 'the passcode itself still opens');
});

test('a sign-in in the night file with no entry recorded, as an older build wrote it, is not carried on', async () => {
  const n = night();
  await n.start();
  const s = await staffOn(n);
  const { token } = await s.signIn({ venue: 'restart-staff', code: 'test-passcode-1' });
  await n.stop();
  const saved = n.saved();
  assert.match(saved.tokens[0][1].entry, /^[a-f0-9]{32}$/, 'a sign-in records its entry now');
  delete saved.tokens[0][1].entry;
  writeFileSync(n.file, JSON.stringify(saved));
  n.clock.t += 30_000;
  const said = await logged(() => n.start());
  assert.ok(said.includes("night: 1 staff sign-ins ended: their venue's passcode changed"), said.join('\n'));
  assert.equal((await (await staffOn(n)).signIn({ venue: 'restart-staff', token })).why, 'expired');
});

test('a venue whose staff page is gone from STAFF_CODES has its sign-ins ended at a restart', async () => {
  const n = night();
  await n.start();
  const { token } = await (await staffOn(n)).signIn({ venue: 'restart-staff', code: 'test-passcode-1' });
  await n.stop();
  n.codes = '{}';
  n.clock.t += 30_000;
  const said = await logged(() => n.start());
  assert.ok(said.includes("night: 1 staff sign-ins ended: their venue's passcode changed"), said.join('\n'));
  assert.equal((await (await staffOn(n)).signIn({ venue: 'restart-staff', token })).why, 'expired');
});

test('a wristband that was worn when the relay stopped is kept an hour from the restart', async () => {
  const n = night();
  await n.start();
  const band = await n.on.wristband(62);
  const ana = await n.on.phone('restart-worn');
  const { secret } = await n.on.pairBand(ana, band);
  n.clock.t += 50 * 60_000;                             // worn all along, fifty minutes on
  await n.restart();
  n.relay.expire(n.clock.t + BAND_ALONE_MS - 60_000);   // an hour less a minute after the restart
  const back = await n.on.wristband(62, { key: band.key, secret });
  assert.equal(back.show.kind, 'off', 'still paired to her: not forgotten, not waiting for its owner');
});

// ---------- §4: nothing kept lets anyone act as someone else ----------

test('the night file holds no wristband secret', async () => {
  const n = night();
  await n.start();
  const band = await n.on.wristband(62);
  const ana = await n.on.phone('restart-secret');
  const { secret } = await n.on.pairBand(ana, band);
  assert.equal(n.relay.save(), 'written');
  const text = readFileSync(n.file, 'utf8');
  assert.ok(text.includes(band.id), 'the wristband is in it');
  assert.equal(text.includes(secret), false, 'its secret is not');
});

test('the night file holds no staff token', async () => {
  const n = night();
  await n.start();
  const s = await staffOn(n);
  const { token } = await s.signIn({ venue: 'restart-staff', code: 'test-passcode-1' });
  assert.equal(n.relay.save(), 'written');
  const text = readFileSync(n.file, 'utf8');
  assert.equal(JSON.parse(text).tokens.length, 1, 'the sign-in is in it');
  assert.match(JSON.parse(text).tokens[0][1].entry, /^[a-f0-9]{32}$/, 'it records which passcode entry the sign-in was made under');
  assert.equal(text.includes('scrypt$'), false, 'a print of the entry, never the entry, its salt or its hash');
  assert.equal(text.includes(token), false, 'its token is not');
});

test('the night file holds no phone id as a phone says it: the room holds personOf(me) instead', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-ids');
  const room = () => n.relay.rooms.get('restart-ids').room;
  assert.equal(room().has(personOf(ana.me)), true, 'her person');
  assert.equal(room().has(ana.me), false, 'never her id');
  assert.equal(n.relay.save(), 'written');
  assert.equal(readFileSync(n.file, 'utf8').includes(ana.me), false, 'her id is not in the file');
  await n.restart();
  await n.on.phone('restart-ids', { me: ana.me });
  assert.equal(room().size(), 1, 'back with the same id, the same person');
});

// ---------- §2: the command line ----------

const NO_SIGINT = { skip: process.platform === 'win32' && 'Windows cannot send a child process SIGINT' };

/** The command line on `file`, on any free port: what it has printed so far, and when it exits. */
function cli(file) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../relay/server.js', import.meta.url))], {
    env: { ...process.env, PORT: '0', NIGHT_FILE: file }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const c = { child, out: '', exited: new Promise((resolve) => child.once('exit', (code) => resolve(code))) };
  child.stdout.on('data', (d) => { c.out += d; });
  child.stderr.on('data', (d) => { c.out += d; });
  return c;
}

test('the command line writes the night on SIGINT, and exits', NO_SIGINT, async () => {
  const file = join(dir, 'cli.json');
  const c = cli(file);
  try {
    await until(() => /relay on http:\/\/localhost:\d+\//.test(c.out), 10_000);
    assert.match(c.out, /night: none at /);
    const port = Number(c.out.match(/localhost:(\d+)\//)[1]);
    const ws = new WebSocket('ws://127.0.0.1:' + port + WS_PATH);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const viewed = new Promise((resolve) => ws.on('message', (d) => { if (JSON.parse(String(d)).t === 'view') resolve(); }));
    ws.send(JSON.stringify({ t: 'join', venue: 'cli-night', me: randomBytes(16).toString('hex') }));
    await viewed;
    c.child.kill('SIGINT');
    assert.equal(await c.exited, 0);
    assert.match(c.out, /night: written on stop/);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).rooms.map((r) => r.key), ['cli-night']);
  } finally {
    c.child.kill();
  }
});

test('the command line says there is nothing to keep when the night is empty at the stop, and leaves no file', NO_SIGINT, async () => {
  const file = join(dir, 'cli-empty.json');
  const c = cli(file);
  try {
    await until(() => /relay on http:\/\/localhost:\d+\//.test(c.out), 10_000);
    // Past two of its once-a-second saves: the stop's own save then finds the night as the last one left it.
    await pause(2200);
    c.child.kill('SIGINT');
    assert.equal(await c.exited, 0);
    assert.match(c.out, /night: nothing to keep on stop/);
    assert.doesNotMatch(c.out, /written on stop/);
    assert.equal(existsSync(file), false);
  } finally {
    c.child.kill();
  }
});
