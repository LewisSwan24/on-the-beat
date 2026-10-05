// ON THE BEAT — the relay's own load line: said once at start, and once a minute while anyone is connected.
// Counts and sizes only. docs/not-done.md has every capacity number from a laptop; this is what the
// real machine says about itself, and the rig (scripts/load.mjs) reads the same line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createRelay, WS_PATH } from '../relay/server.js';
import { makeEntry } from '../relay/staff.js';
import { LOOP_RESOLUTION_MS, createMeter, formatLoad, parseLoad, startLine } from '../relay/load.js';
import { helpers, pause } from './relay-harness.js';

const MB = 1048576;
const SERVER = fileURLToPath(new URL('../relay/server.js', import.meta.url));
const SHAPE = /^load: \d+ phones?, \d+ bands?, \d+ staff in \d+ venues? \| cpu \d+% \| loop lag p99 \d+ ms, max \d+ ms \| rss \d+ MB, heap \d+ of \d+ MB, buffers \d+ MB, clips \d+\.\d MB$/;
const PASSCODE = 'test-passcode-1';

test('the load line is one line of counts, cpu, event-loop lag and memory, with the plurals a person reads', () => {
  const line = formatLoad({ phones: 12, bands: 2, staff: 1, venues: 1, cpu: 3.2, lagP99: 4.1, lagMax: 11.7, rss: 91 * MB, heapUsed: 38 * MB, heapLimit: 129 * MB, buffers: 12 * MB, clips: 4.5 * MB });
  assert.equal(line, 'load: 12 phones, 2 bands, 1 staff in 1 venue | cpu 3% | loop lag p99 4 ms, max 12 ms | rss 91 MB, heap 38 of 129 MB, buffers 12 MB, clips 4.5 MB');
  assert.equal(formatLoad({ phones: 1, bands: 1, staff: 0, venues: 2, cpu: 0, lagP99: 0, lagMax: 0, rss: 60 * MB, heapUsed: 20 * MB, heapLimit: 120 * MB, buffers: 3 * MB, clips: 0 }),
    'load: 1 phone, 1 band, 0 staff in 2 venues | cpu 0% | loop lag p99 0 ms, max 0 ms | rss 60 MB, heap 20 of 120 MB, buffers 3 MB, clips 0.0 MB');
});

test('a load line reads back as numbers, memory in MB as said, singulars too, and no other line reads as one', () => {
  const said = formatLoad({ phones: 12, bands: 2, staff: 1, venues: 1, cpu: 3.2, lagP99: 4.1, lagMax: 11.7, rss: 91 * MB, heapUsed: 38 * MB, heapLimit: 129 * MB, buffers: 12 * MB, clips: 4.5 * MB });
  assert.deepEqual(parseLoad(said), { phones: 12, bands: 2, staff: 1, venues: 1, cpu: 3, lagP99: 4, lagMax: 12, rssMB: 91, heapUsedMB: 38, heapLimitMB: 129, buffersMB: 12, clipsMB: 4.5 });
  assert.deepEqual(parseLoad('load: 1 phone, 1 band, 0 staff in 2 venues | cpu 120% | loop lag p99 0 ms, max 7 ms | rss 60 MB, heap 20 of 4144 MB, buffers 0 MB, clips 0.0 MB'),
    { phones: 1, bands: 1, staff: 0, venues: 2, cpu: 120, lagP99: 0, lagMax: 7, rssMB: 60, heapUsedMB: 20, heapLimitMB: 4144, buffersMB: 0, clipsMB: 0 });
  const withoutMedia = 'load: 1 phone, 1 band, 0 staff in 2 venues | cpu 120% | loop lag p99 0 ms, max 7 ms | rss 60 MB, heap 20 of 4144 MB';
  for (const other of [withoutMedia, startLine(), 'night: carried on from /data/night.json', 'ON THE BEAT relay on http://localhost:8790/', '', said + ' extra', 'x' + said]) {
    assert.equal(parseLoad(other), null, JSON.stringify(other));
  }
});

test('the start line says what the machine lets this process have: the heap limit and the memory it sees', () => {
  assert.equal(startLine({ heapLimit: 129 * MB, total: 235 * MB, node: 'v24.0.0' }), 'load: node v24.0.0, heap limit 129 MB on a machine with 235 MB');
  assert.match(startLine(), /^load: node v\d+\.\d+\.\d+, heap limit \d+ MB on a machine with \d+ MB$/);
});

/** Everything the meter reads, as numbers a test moves. */
function fakes() {
  const f = { t: 0, cpu: { user: 0, system: 0 }, rss: 0, buffers: 0, used: 0, limit: 0, p99: 0, max: 0, resets: 0, enabled: 0, disabled: 0 };
  f.histogram = { enable() { f.enabled += 1; }, disable() { f.disabled += 1; }, percentile: (p) => (p === 99 ? f.p99 : -1), get max() { return f.max; }, reset() { f.resets += 1; } };
  f.meter = () => createMeter({
    clock: () => f.t, cpuUsage: () => ({ ...f.cpu }), memoryUsage: () => ({ rss: f.rss, arrayBuffers: f.buffers }),
    heapStats: () => ({ used_heap_size: f.used, heap_size_limit: f.limit }), histogram: f.histogram,
  });
  return f;
}

test('the meter reports cpu as a share of one core over its own interval, and the event loop beyond its own tick', () => {
  const f = fakes();
  const meter = f.meter();
  assert.equal(f.enabled, 1, 'the loop is watched from the start');
  f.t = 60_000; f.cpu = { user: 4_000_000, system: 2_000_000 };     // 6 s of cpu in 60 s
  f.p99 = (LOOP_RESOLUTION_MS + 7) * 1e6; f.max = (LOOP_RESOLUTION_MS + 30) * 1e6;
  f.rss = 91 * MB; f.buffers = 12 * MB; f.used = 38 * MB; f.limit = 129 * MB;
  assert.deepEqual(meter.sample(), { cpu: 10, lagP99: 7, lagMax: 30, rss: 91 * MB, heapUsed: 38 * MB, heapLimit: 129 * MB, buffers: 12 * MB });
  assert.equal(f.resets, 1, 'each sample starts the histogram afresh');
  // The next sample covers only the thirty seconds since the first: 3 s of cpu more is 10% again, not 15%.
  f.t = 90_000; f.cpu = { user: 6_000_000, system: 3_000_000 };
  f.p99 = (LOOP_RESOLUTION_MS - 8) * 1e6; f.max = 0;                // a quiet loop reads under its own tick
  const second = meter.sample();
  assert.equal(second.cpu, 10);
  assert.equal(second.lagP99, 0, 'lag never reads below nothing');
  assert.equal(second.lagMax, 0);
  meter.stop();
  assert.equal(f.disabled, 1);
});

test('the real meter reads in the right units: a loop held for 200 ms shows as lag in milliseconds, memory as bytes', async () => {
  const meter = createMeter();
  try {
    await pause(120);
    const quiet = meter.sample();
    assert.ok(quiet.lagMax < 150, 'a quiet loop reads ' + quiet.lagMax + ' ms late');
    // Node's histogram records the gap between two looks, so the first after a reset only starts its clock: let one land.
    await pause(30);
    for (const end = performance.now() + 200; performance.now() < end;);   // hold the loop, and burn the core
    await pause(30);
    const held = meter.sample();
    assert.ok(held.lagMax >= 100 && held.lagMax < 5000, 'a loop held 200 ms reads ' + held.lagMax + ' ms late');
    assert.ok(held.lagP99 >= 0 && held.lagP99 <= held.lagMax);
    assert.ok(held.cpu > 1 && held.cpu < 800, 'a burnt core reads ' + held.cpu + '%');
    assert.ok(held.rss > 20 * MB && held.rss < 8192 * MB, 'rss ' + held.rss);
    assert.ok(held.heapUsed > 1 * MB && held.heapUsed < held.heapLimit, 'heap ' + held.heapUsed + ' of ' + held.heapLimit);
    assert.ok(held.heapLimit >= 50 * MB, 'the heap limit is ' + held.heapLimit);
    assert.ok(held.buffers >= 0 && held.buffers < held.rss, 'buffers ' + held.buffers + ' of rss ' + held.rss);
  } finally {
    meter.stop();
  }
});

/** A meter that says what it is told and counts how it was used. */
function cannedMeter() {
  const m = { samples: 0, stopped: 0, said: { cpu: 7, lagP99: 5, lagMax: 21, rss: 91 * MB, heapUsed: 38 * MB, heapLimit: 129 * MB, buffers: 12 * MB } };
  m.sample = () => { m.samples += 1; return m.said; };
  m.stop = () => { m.stopped += 1; };
  return m;
}
const CANNED_TAIL = ' | cpu 7% | loop lag p99 5 ms, max 21 ms | rss 91 MB, heap 38 of 129 MB, buffers 12 MB, clips 0.0 MB';

/** A relay that says its load every 30 ms into `said`, with a staff page at the venues named. */
async function talkative(venues = []) {
  const said = [];
  const meter = cannedMeter();
  const staffCodes = JSON.stringify(Object.fromEntries(await Promise.all(venues.map(async (v) => [v, await makeEntry(PASSCODE)]))));
  const relay = await createRelay({ port: 0, host: '127.0.0.1', loadEveryMs: 30, loadSay: (l) => said.push(l), loadMeter: meter, staffCodes });
  return { relay, said, meter, t: helpers(() => relay.port) };
}

/** A staff device signed in at a venue. */
async function staffAt(relay, venue) {
  const ws = new WebSocket('ws://127.0.0.1:' + relay.port + WS_PATH);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const answer = new Promise((resolve) => ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'staff') resolve(m); }));
  ws.send(JSON.stringify({ t: 'staff', venue, code: PASSCODE }));
  assert.equal((await answer).ok, true);
  return ws;
}

/** Waits, up to `ms`, for a condition. */
async function until(pred, ms = 3000) {
  for (const from = Date.now(); !pred() && Date.now() - from < ms;) await pause(20);
}

test('a relay with nobody on it says nothing, but still samples, so the first busy line is its own minute', async () => {
  const { relay, said, meter, t } = await talkative();
  try {
    await pause(250);
    assert.deepEqual(said, []);
    assert.ok(meter.samples >= 3, 'sampled ' + meter.samples + ' times while idle');
    await t.phone('roundhouse-bruno-mars');
    await until(() => said.length > 0);
    assert.equal(said.at(-1), 'load: 1 phone, 0 bands, 0 staff in 1 venue' + CANNED_TAIL);
  } finally {
    t.cleanup();
    await relay.close();
  }
});

test('the load line says how much video the relay holds, and the figure is the clip store itself, falling as a clip is replaced', async () => {
  const { relay, said, t } = await talkative();
  try {
    const ana = await t.phone('roundhouse-bruno-mars');
    assert.equal(relay.clipBytes(), 0, 'a relay that has been sent nothing holds no video');
    ana.send({ t: 'clip', mime: 'video/webm', data: randomBytes(MB).toString('base64') });   // one mebibyte of video
    await until(() => relay.clipBytes() === MB);
    assert.equal(relay.clipBytes(), MB);
    await until(() => said.at(-1)?.endsWith(', clips 1.0 MB'));
    assert.match(said.at(-1), /, buffers 12 MB, clips 1\.0 MB$/);
    // Her next clip takes the first one's place: the figure is what is held, not what was ever sent.
    ana.send({ t: 'clip', mime: 'video/webm', data: randomBytes(MB / 2).toString('base64') });
    await until(() => relay.clipBytes() === MB / 2);
    assert.equal(relay.clipBytes(), MB / 2);
    await until(() => said.at(-1)?.endsWith(', clips 0.5 MB'));
    assert.match(said.at(-1), /, clips 0\.5 MB$/);
  } finally {
    t.cleanup();
    await relay.close();
  }
});

test('a relay with only a wristband on it, or only a staff device, still says its load', async () => {
  for (const [who, want] of [['a wristband', 'load: 0 phones, 1 band, 0 staff in 0 venues'], ['a staff device', 'load: 0 phones, 0 bands, 1 staff in 1 venue']]) {
    const { relay, said, t } = await talkative(['moth-club-kayo-lane']);
    let staff = null;
    try {
      if (who === 'a wristband') await t.wristband(); else staff = await staffAt(relay, 'moth-club-kayo-lane');
      await until(() => said.length > 0);
      assert.equal(said.at(-1), want + CANNED_TAIL, 'only ' + who);
    } finally {
      staff?.terminate();
      t.cleanup();
      await relay.close();
    }
  }
});

test('the load line counts phones, live wristbands, staff and venues, and names none of them', async () => {
  const { relay, said, t } = await talkative(['moth-club-kayo-lane']);
  let staff = null;
  try {
    // The roundhouse has two phones on it; the moth club only a staff device; the hall only a worn wristband, its phone
    // gone. Not on it: a wristband nobody has claimed and one that dropped (its record is kept for a minute), and
    // a quiet corner whose phone left (its room is kept for the grace).
    const rae = await t.phone('roundhouse-bruno-mars');
    await t.phone('roundhouse-bruno-mars');
    staff = await staffAt(relay, 'moth-club-kayo-lane');
    const phone = await t.phone('the-hall-kayo-lane');
    const worn = await t.wristband();
    await t.pairBand(phone, worn);
    phone.ws.terminate();
    await t.wristband();
    (await t.wristband()).ws.terminate();
    (await t.phone('quiet-corner-bar')).ws.terminate();
    const want = 'load: 2 phones, 2 bands, 1 staff in 3 venues' + CANNED_TAIL;
    // A line said before the last of that was done is stale, and could match by luck: read one said after it.
    const mark = said.length;
    await until(() => said.length >= mark + 3);
    await until(() => said.at(-1) === want);
    assert.equal(said.at(-1), want);
    assert.equal(relay.bandCount(), 3, 'the dropped wristband is still a record');
    assert.equal(relay.roomCount(), 4, 'the quiet corner is still a room');
    for (const line of said) {
      assert.match(line, SHAPE);
      assert.ok(!/roundhouse|moth-club|hall|quiet-corner/.test(line), 'a venue is named: ' + line);
      assert.ok(!line.includes(rae.me) && !/[0-9a-f]{16}/.test(line), 'an id is named: ' + line);
      assert.ok(!line.includes('127.0.0.1'), 'an address is named: ' + line);
    }
  } finally {
    staff?.terminate();
    t.cleanup();
    await relay.close();
  }
});

test('the library says nothing of its load unless asked: 0 is off, and a meter is never started for it', async () => {
  const said = [];
  const meter = cannedMeter();
  const relay = await createRelay({ port: 0, host: '127.0.0.1', loadSay: (l) => said.push(l), loadMeter: meter });
  const t = helpers(() => relay.port);
  try {
    await t.phone('roundhouse-bruno-mars');
    await pause(200);
    assert.deepEqual(said, []);
    assert.equal(meter.samples, 0);
  } finally {
    t.cleanup();
    await relay.close();
  }
  assert.equal(meter.stopped, 0, 'nothing was started, so nothing is stopped');
});

test('closing the relay stops the meter and the minute timer: nothing is said or sampled afterwards', async () => {
  const { relay, said, meter, t } = await talkative();
  await t.phone('roundhouse-bruno-mars');
  await pause(120);
  t.cleanup();
  await relay.close();
  assert.equal(meter.stopped, 1);
  const [lines, samples] = [said.length, meter.samples];
  await pause(200);
  assert.equal(said.length, lines);
  assert.equal(meter.samples, samples);
});

/** The relay as `node relay/server.js` starts it, its lines as they come, and a way to stop it. */
async function started(env) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: '0', NIGHT_FILE: '', PUSH_KEYS_FILE: '', STAFF_CODES: '', SHOWS: '', LOAD_EVERY_MS: undefined, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const lines = [];
  const waiters = [];
  createInterface({ input: child.stdout }).on('line', (line) => { lines.push(line); for (const w of [...waiters]) w(); });
  const until = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out; the relay said ' + JSON.stringify(lines))), ms);
    const check = () => { const hit = lines.find(pred); if (hit === undefined) return; clearTimeout(timer); waiters.splice(waiters.indexOf(check), 1); resolve(hit); };
    waiters.push(check);
    check();
  });
  const listening = await until((l) => /^ON THE BEAT relay on http:\/\/localhost:\d+\/$/.test(l));
  const port = Number(/:(\d+)\/$/.exec(listening)[1]);
  const stop = () => new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
  return { lines, until, port, stop };
}

test('started on its own, the relay says its machine at start and its load once a minute: LOAD_EVERY_MS sets the minute', async () => {
  const relay = await started({ LOAD_EVERY_MS: '150' });
  const t = helpers(() => relay.port);
  try {
    assert.match(relay.lines.find((l) => l.startsWith('load: node ')), /^load: node v\d+\.\d+\.\d+, heap limit \d+ MB on a machine with \d+ MB$/);
    await t.phone('roundhouse-bruno-mars');
    const busy = await relay.until((l) => l.startsWith('load: 1 phone'));
    assert.match(busy, SHAPE);
  } finally {
    t.cleanup();
    await relay.stop();
  }
});

test('LOAD_EVERY_MS=0 turns the load lines off', async () => {
  const off = await started({ LOAD_EVERY_MS: '0' });
  const t = helpers(() => off.port);
  try {
    await t.phone('roundhouse-bruno-mars');
    await pause(500);
    assert.deepEqual(off.lines.filter((l) => l.startsWith('load:')), []);
  } finally {
    t.cleanup();
    await off.stop();
  }
});

for (const [what, value] of [
  ['is not set', undefined], ['is empty', ''], ['is not a number', 'often'],
  ['is more than a timer can count (Node would run it every millisecond)', String(2 ** 31)],
]) {
  test('a LOAD_EVERY_MS that ' + what + ' leaves the minute as it was', async () => {
    // A minute is far longer than this test, so a relay that kept its default says its machine and nothing else.
    const relay = await started({ LOAD_EVERY_MS: value });
    const t = helpers(() => relay.port);
    try {
      await t.phone('roundhouse-bruno-mars');
      await pause(500);
      assert.equal(relay.lines.filter((l) => l.startsWith('load:')).length, 1);
      assert.match(relay.lines.find((l) => l.startsWith('load:')), /^load: node /);
    } finally {
      t.cleanup();
      await relay.stop();
    }
  });
}
