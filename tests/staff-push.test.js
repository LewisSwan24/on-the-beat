// ON THE BEAT — a new report reaches a closed or sleeping staff device (relay/server.js with relay/push.js;
// docs/superpowers/specs/2026-09-29-staff-push-design.md §2-§6), against a push service on 127.0.0.1 that opens
// what it is sent. Test passcodes only.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createRelay, WS_PATH } from '../relay/server.js';
import { makeEntry } from '../relay/staff.js';
import { helpers, pause } from './relay-harness.js';
import { pushService, subscriber } from './push-helpers.js';

const TZ = 'Australia/Brisbane';                     // UTC+10, no daylight saving
const EIGHT_PM = Date.UTC(2026, 8, 29, 10, 0);      // 20:00 on 29 Sep there
const NEXT_MORNING = Date.UTC(2026, 8, 29, 20, 30); // 06:30 on 30 Sep there: the next night
const WINDOW = 600;                                 // a venue's push window, shortened for tests
const VENUE = 'roundhouse-bruno-mars';              // in relay/shows.json: The Roundhouse, Camden
let base;
let root;
let CODES;
let service;
let files = 0;
let addresses = 0;
const running = [];

before(async () => {
  base = mkdtempSync(join(tmpdir(), 'otb-staff-push-'));
  root = join(base, 'dist');
  mkdirSync(root);
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>On The Beat</title>');
  writeFileSync(join(root, 'staff.html'), '<!doctype html><title>Staff</title>');
  CODES = JSON.stringify({ [VENUE]: await makeEntry('test-passcode-1'), 'push-other': await makeEntry('test-passcode-2') });
  service = await pushService();
});

after(async () => {
  for (const x of running) if (x.open) await x.stop();
  await service.close();
  rmSync(base, { recursive: true, force: true });
});

/** Polls until `pred()` holds, or fails after `ms`. */
async function until(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out');
    await pause(20);
  }
}

/**
 * A relay on a clock the test moves, sending only to the test's push service, with a night file and a keys file
 * when asked. `restart()` stops it, moves the clock half a minute and starts a new relay on the same files.
 */
async function start({ nightFile, pushKeysFile, codes } = {}) {
  const x = { clock: { t: EIGHT_PM }, open: false, codes: codes ?? CODES };
  x.start = async () => {
    x.relay = await createRelay({
      port: 0, host: '127.0.0.1', root, clock: () => x.clock.t, nightTz: TZ, staffCodes: x.codes,
      nightFile, pushKeysFile, saveEveryMs: 3_600_000, pushEveryMs: WINDOW,
      pushAllowed: (e) => typeof e === 'string' && e.startsWith(service.origin + '/'),
    });
    x.h = helpers(() => x.relay.port);
    x.open = true;
    return x;
  };
  x.stop = async () => { x.h.cleanup(); await x.relay.close(); x.open = false; };
  x.restart = async () => { await x.stop(); x.clock.t += 30_000; return x.start(); };
  running.push(x);
  return x.start();
}

/** A staff page's socket: its sign-in answers, lists and push answers, and how it closed. */
async function staffOn(x) {
  const ws = new WebSocket('ws://127.0.0.1:' + x.relay.port + WS_PATH, { headers: { 'cf-connecting-ip': '203.0.113.' + (1 + (addresses++ % 199)) } });
  const s = { ws, answers: [], lists: [], pushes: [], closed: null };
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.t === 'staff') s.answers.push(m);
    if (m.t === 'reports') s.lists.push(m.reports);
    if (m.t === 'push') s.pushes.push(m);
  });
  ws.on('close', (code) => { s.closed = code; });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  s.send = (m) => ws.send(JSON.stringify(m));
  s.signIn = async (m) => { const n = s.answers.length; s.send({ t: 'staff', ...m }); await until(() => s.answers.length > n); return s.answers.at(-1); };
  s.subscribe = async (sub) => { const n = s.pushes.length; s.send({ t: 'push', sub }); await until(() => s.pushes.length > n); return s.pushes.at(-1); };
  return s;
}

/** A staff device signed in at `venue` with notifications on: its socket, its subscriber and its token. */
async function notified(x, venue = VENUE, code = 'test-passcode-1') {
  const s = await staffOn(x);
  const a = await s.signIn({ venue, code });
  assert.equal(a.ok, true, JSON.stringify(a));
  const who = subscriber(service.endpoint());
  assert.deepEqual(await s.subscribe(who.sub), { t: 'push', ok: true });
  return { s, who, token: a.token };
}

/** What reached one subscriber's endpoint. */
const to = (who) => service.got.filter((g) => g.url === new URL(who.sub.endpoint).pathname);

// ---------- §3: taking a subscription ----------

test('a subscription is taken only from signed-in staff, only for a push service, only with real keys', async () => {
  const x = await start();
  const who = subscriber(service.endpoint());
  const ana = await x.h.phone(VENUE);
  ana.send({ t: 'push', sub: who.sub });
  const band = await x.h.wristband();
  band.send({ t: 'push', sub: who.sub });
  const early = await staffOn(x);
  early.send({ t: 'push', sub: who.sub });
  await pause(300);
  assert.equal(early.pushes.length, 0, 'not signed in: nothing taken, nothing said');
  assert.deepEqual(x.relay.pushedTo(VENUE), []);
  const s = await staffOn(x);
  assert.equal((await s.signIn({ venue: VENUE, code: 'test-passcode-1' })).ok, true);
  for (const sub of [
    { ...who.sub, endpoint: 'https://evil.example/push' },
    { ...who.sub, keys: { ...who.sub.keys, auth: 'AAAA' } },
    { ...who.sub, keys: { ...who.sub.keys, p256dh: who.sub.keys.p256dh.slice(0, 40) } },
    { endpoint: who.sub.endpoint },
    'not a subscription',
  ]) assert.deepEqual(await s.subscribe(sub), { t: 'push', ok: false, why: 'bad push' }, JSON.stringify(sub));
  assert.deepEqual(x.relay.pushedTo(VENUE), []);
  assert.deepEqual(await s.subscribe(who.sub), { t: 'push', ok: true });
  assert.deepEqual(x.relay.pushedTo(VENUE), [who.sub.endpoint]);
});

test('a sign-in holds one subscription, and an endpoint is held once', async () => {
  const x = await start();
  const { s } = await notified(x);
  const newer = subscriber(service.endpoint());
  x.clock.t += 1;
  assert.deepEqual(await s.subscribe(newer.sub), { t: 'push', ok: true });
  assert.deepEqual(x.relay.pushedTo(VENUE), [newer.sub.endpoint], 'the newer replaces it');
  const other = await staffOn(x);
  assert.equal((await other.signIn({ venue: VENUE, code: 'test-passcode-1' })).ok, true);
  x.clock.t += 1;
  assert.deepEqual(await other.subscribe(newer.sub), { t: 'push', ok: true });
  assert.deepEqual(x.relay.pushedTo(VENUE), [newer.sub.endpoint], 'held once, by the sign-in that sent it last');
});

test('a venue holds at most 50 subscriptions: the 51st forgets the oldest', async () => {
  const x = await start();
  const devices = [];
  for (let i = 0; i < 51; i += 1) {
    devices.push(await notified(x));
    x.clock.t += 1;
  }
  assert.deepEqual(x.relay.pushedTo(VENUE), devices.slice(1).map((d) => d.who.sub.endpoint));
});

test('SIGN OUT reaches the relay: that sign-in ends on every tab that shared it, with its subscription', async () => {
  const x = await start();
  const { s, token } = await notified(x);
  const tab = await staffOn(x);                     // the same device's other tab, on the same token
  assert.equal((await tab.signIn({ venue: VENUE, token })).ok, true);
  s.send({ t: 'signout' });
  await until(() => s.closed !== null && tab.closed !== null);
  assert.deepEqual(tab.answers.at(-1), { t: 'staff', ok: false, why: 'signed out' });
  assert.equal(tab.closed, 4004);
  assert.deepEqual(x.relay.pushedTo(VENUE), []);
  const again = await staffOn(x);
  assert.equal((await again.signIn({ venue: VENUE, token })).why, 'expired');
});

test('06:00 ends the night\'s subscriptions with its sign-ins', async () => {
  const x = await start();
  await notified(x);
  x.clock.t = NEXT_MORNING;
  x.relay.expire(NEXT_MORNING);
  assert.deepEqual(x.relay.pushedTo(VENUE), []);
});

// ---------- §4: sending ----------

/** A phone at `venue` reports something, with no one named. */
async function report(x, venue = VENUE) {
  const p = await x.h.phone(venue);
  p.send({ t: 'report', why: 'a spill by the stairs' });
  return p;
}

test('a report reaches each device that turned notifications on, once, sealed: the venue and how many are open', async () => {
  const x = await start();
  const a = await notified(x);
  const b = await notified(x);
  const other = await notified(x, 'push-other', 'test-passcode-2');
  await report(x);
  await until(() => to(a.who).length === 1 && to(b.who).length === 1);
  for (const who of [a.who, b.who]) {
    const [req] = to(who);
    assert.deepEqual(JSON.parse(who.open(req.body)), { venue: 'The Roundhouse, Camden', open: 1 });
    assert.equal(req.headers.ttl, '600');
    assert.equal(req.headers.urgency, 'high');
    assert.equal(req.headers.topic, 'reports');
    assert.equal(req.headers['content-encoding'], 'aes128gcm');
    assert.match(req.headers.authorization, new RegExp(', k=' + x.relay.pushKey + '$'));
  }
  await pause(WINDOW + 200);
  assert.equal(to(a.who).length, 1, 'once');
  assert.equal(to(other.who).length, 0, 'another venue hears nothing');
});

test('a venue is sent at most one push a window: later reports wait for its end, which carries the count then', async () => {
  const x = await start();
  const { who } = await notified(x);
  const p = await report(x);
  await until(() => to(who).length === 1);
  p.send({ t: 'report', why: 'another' });
  p.send({ t: 'report', why: 'and another' });
  await pause(WINDOW / 3);
  assert.equal(to(who).length, 1, 'held to the window');
  await until(() => to(who).length === 2);
  assert.deepEqual(JSON.parse(who.open(to(who)[1].body)), { venue: 'The Roundhouse, Camden', open: 3 });
  await pause(WINDOW + 200);
  assert.equal(to(who).length, 2, 'that push opened a window of its own, and nothing came in it');
});

test('a window that closes with nothing open sends nothing more', async () => {
  const x = await start();
  const { s, who } = await notified(x);
  const p = await report(x);
  await until(() => to(who).length === 1);
  p.send({ t: 'report', why: 'another' });
  await until(() => s.lists.at(-1)?.length === 2);
  for (const r of s.lists.at(-1)) s.send({ t: 'handled', id: r.id, on: true });
  await until(() => s.lists.at(-1).every((r) => r.handledAt > 0));
  await pause(WINDOW + 200);
  assert.equal(to(who).length, 1);
});

test('404, 410 and 403 forget that device and a 500 does not; the log says counts, never an address or a key', async () => {
  const x = await start();
  const devices = [];
  for (const status of [404, 410, 403, 500]) {
    const d = await notified(x);
    service.statusFor.set(new URL(d.who.sub.endpoint).pathname, status);
    devices.push(d);
    x.clock.t += 1;
  }
  const said = [];
  const log = console.log;
  console.log = (...a) => { said.push(a.join(' ')); };
  try {
    await report(x);
    await until(() => said.some((l) => l.startsWith('push: ')));
  } finally {
    console.log = log;
  }
  assert.ok(said.includes('push: ' + VENUE + ' 0 sent, 3 gone, 1 failed'), said.join('\n'));
  for (const l of said) {
    for (const d of devices) {
      for (const secret of [d.who.sub.endpoint, d.who.sub.keys.p256dh, d.who.sub.keys.auth]) assert.ok(!l.includes(secret), l);
    }
  }
  assert.deepEqual(x.relay.pushedTo(VENUE), [devices[3].who.sub.endpoint]);
});

// ---------- §3: the night file ----------

test('a subscription and the keys carry across a restart: the device is still sent to, under the same key', async () => {
  files += 1;
  const x = await start({ nightFile: join(base, 'night-' + files + '.json'), pushKeysFile: join(base, 'keys-' + files + '.json') });
  const { who } = await notified(x);
  const key = x.relay.pushKey;
  await x.restart();
  assert.equal(x.relay.pushKey, key, 'the same keys');
  await report(x);
  await until(() => to(who).length === 1);
  assert.match(to(who)[0].headers.authorization, new RegExp(', k=' + key + '$'));
});

test('a sign-in that ends at a restart because its venue\'s passcode changed takes its subscription with it', async () => {
  files += 1;
  const x = await start({ nightFile: join(base, 'night-' + files + '.json'), pushKeysFile: join(base, 'keys-' + files + '.json') });
  const { who } = await notified(x);
  assert.deepEqual(x.relay.pushedTo(VENUE), [who.sub.endpoint]);
  await x.stop();
  x.codes = JSON.stringify({ [VENUE]: await makeEntry('test-passcode-1'), 'push-other': await makeEntry('test-passcode-2') });
  x.clock.t += 30_000;
  await x.start();
  assert.deepEqual(x.relay.pushedTo(VENUE), [], 'no device is held for the old sign-in');
  await report(x);
  await pause(WINDOW + 300);
  assert.equal(to(who).length, 0, 'and nothing is sent to it');
});

test('a subscription in the night file that fails the checks is left behind at a restart; its sign-in is kept', async () => {
  files += 1;
  const nightFile = join(base, 'night-' + files + '.json');
  const x = await start({ nightFile });
  const { token } = await notified(x);
  await x.stop();
  const saved = JSON.parse(readFileSync(nightFile, 'utf8'));
  saved.tokens[0][1].push.endpoint = 'https://evil.example/push';
  writeFileSync(nightFile, JSON.stringify(saved));
  await x.start();
  assert.deepEqual(x.relay.pushedTo(VENUE), [], 'left behind');
  const s = await staffOn(x);
  assert.equal((await s.signIn({ venue: VENUE, token })).ok, true, 'the sign-in is kept');
});
