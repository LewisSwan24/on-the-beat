// ON THE BEAT — the wristband's firmware, in front of the real relay.
//
// Everything in the firmware that decides something is in
// firmware/src/band_logic.h, plain C++, so it is built here with this
// machine's own compiler: it runs its own checks, then the frames it sends
// go to a real relay, and every frame the relay sends back is read by it.
// None of this needs a wristband. The hardware round it — screen, buttons,
// speaker, Wi-Fi — is only built by PlatformIO. With no C++ compiler here
// these say so and skip.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { createRelay, WS_PATH } from '../relay/server.js';
import { HUE } from '../app/copy.js';
import { codeFrom, pairUrl } from '../app/lib/pairing.js';
import { CONSTS, FLASH_COLOURS, FLASHES, SOUNDS } from '../app/lib/wrist.js';
import { BEAT_BLOCK, BEAT_CONSTS, BEAT_RATE, createLevels, createTracker, pulseLight } from '../app/lib/beat.js';
import { music, twoStep } from './beat-music.js';
import { TABLE, lines, check } from './wrist-table.js';

const idOf = (key) => createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex').slice(0, 32);

const here = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'otb-fw-'));
after(() => rmSync(dir, { recursive: true, force: true }));

let cxxUsed = null;  // the compiler that built it

/** The logic, built by the first compiler this machine has, under the sanitizers where it can be. */
function build() {
  const out = join(dir, 'logic');
  const args = ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-O1', '-g', '-o', out, join(here, 'firmware', 'host', 'logic_test.cpp')];
  for (const cxx of [process.env.CXX, 'c++', 'g++', 'clang++'].filter(Boolean)) {
    for (const extra of [['-fsanitize=address,undefined', '-fno-sanitize-recover=all'], []]) {
      const r = spawnSync(cxx, [...extra, ...args], { encoding: 'utf8' });
      if (r.error) break;
      if (r.status === 0) {
        cxxUsed = cxx;
        return out;
      }
      if (!extra.length) throw new Error(cxx + ' could not build the firmware logic:\n' + r.stderr);
    }
  }
  return null;
}

let bin = null;
let broken = null;
try { bin = build(); } catch (e) { broken = e; }
const skip = !bin && !broken && 'no C++ compiler on this machine';
const env = { ...process.env, ASAN_OPTIONS: 'detect_leaks=0' };

/** Commands to the firmware logic, one a line, and its one-line answers. */
function speak(lines) {
  if (broken) throw broken;
  const r = spawnSync(bin, ['speak'], { input: lines.join('\n') + '\n', encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout.split(/\r?\n/).slice(0, -1);
  assert.equal(out.length, lines.length, r.stdout);
  return out;
}

/** A socket, every frame it was sent, and a way to wait until the latest of a type fits. */
function open(port, protocol) {
  const ws = new WebSocket('ws://127.0.0.1:' + port + WS_PATH, protocol ? [protocol] : undefined);
  const s = { ws, frames: [], last: {}, waiters: new Set() };
  ws.on('message', (data) => {
    const text = String(data);
    s.frames.push(text);
    const m = JSON.parse(text);
    s.last[m.t] = m;
    for (const w of [...s.waiters]) w();
  });
  s.send = (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  s.until = (t, fits = () => true, ms = 3000) => new Promise((resolve, reject) => {
    const check = () => {
      const m = s.last[t];
      if (!m || !fits(m)) return;
      clearTimeout(timer);
      s.waiters.delete(check);
      resolve(m);
    };
    const timer = setTimeout(() => { s.waiters.delete(check); reject(new Error('no ' + t + ' that fits; last ' + JSON.stringify(s.last[t]))); }, ms);
    s.waiters.add(check);
    check();
  });
  return new Promise((resolve, reject) => { ws.once('open', () => resolve(s)); ws.once('error', reject); });
}

async function phone(port, venue) {
  const p = await open(port);
  p.send({ t: 'join', venue, me: randomBytes(16).toString('hex') });
  await p.until('view');
  return p;
}

test('the wristband logic passes its own checks', { skip }, () => {
  if (broken) throw broken;
  const r = spawnSync(bin, [], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /^ok: \d+ checks/);
});

test("the wristband logic compiles as the band's compiler takes it: C++11, after Arduino's macros", { skip }, () => {
  if (broken) throw broken;
  const r = spawnSync(cxxUsed, ['-std=gnu++11', '-fsyntax-only', '-Wall', '-Wextra', '-Werror',
    join(here, 'firmware', 'host', 'as_band.cpp')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('the colours on the wrist are the colours on the phone', { skip }, () => {
  const [hues] = speak(['hues']);
  const phone = Object.fromEntries(Object.entries(HUE).map(([id, h]) => [id, { c: h.c.toUpperCase(), g: h.g.toUpperCase() }]));
  assert.deepEqual(JSON.parse(hues), phone);
});

test("the flashes' red and orange are the stand-in's, and red is the phone's own --stop", { skip }, () => {
  const [colours] = speak(['flashcolours']);
  assert.deepEqual(JSON.parse(colours), FLASH_COLOURS);
  const css = readFileSync(new URL('../app/styles.css', import.meta.url), 'utf8');
  assert.equal(FLASH_COLOURS.red, css.match(/--stop:\s*(#[0-9A-Fa-f]{6})/)[1].toUpperCase());
});

test('the firmware hears as the stand-in does: the same samples give the same five levels', { skip }, () => {
  // Three tones, an offset and seeded noise, 60 blocks, through both twins' filters.
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  const wave = (hz, a, i) => a * Math.sin((2 * Math.PI * hz * i) / BEAT_RATE);
  const samples = Array.from({ length: 60 * BEAT_BLOCK }, (_, i) =>
    Math.round(wave(90, 3000, i) + wave(900, 2000, i) + wave(5000, 1500, i) + 800 * noise() + 500));
  const js = createLevels();
  const want = [];
  for (let b = 0; b < 60; b++) want.push(js.block(samples.slice(b * BEAT_BLOCK, (b + 1) * BEAT_BLOCK)));
  const band = JSON.parse(speak(['levels ' + samples.join(',')])[0]);
  assert.equal(band.length, 60);
  // The band works in float and the stand-in in double: 0.003% apart at worst when measured, held to 0.05%.
  band.forEach((row, b) => row.forEach((v, k) =>
    assert.ok(Math.abs(v - want[b][k]) <= 0.0005 * want[b][k] + 0.002, `block ${b} band ${k}: ${v} against ${want[b][k]}`)));
});

test("the firmware draws a pulse's light as the stand-in does", { skip }, () => {
  const asked = [];
  for (const full of [255, 128]) for (const period of [336, 500, 752.4]) for (let since = 0; since <= period; since += period / 16) asked.push([full, since, period]);
  const band = speak(asked.map(([full, since, period]) => `pulselight ${full} ${since} ${period}`)).map(Number);
  assert.deepEqual(band, asked.map(([full, since, period]) => pulseLight(full, since, period)));
});

test('the firmware follows the beat by the same named values as the stand-in', { skip }, () => {
  const [consts] = speak(['beatconsts']);
  assert.deepEqual(JSON.parse(consts), BEAT_CONSTS);
});

test('the firmware follows the beat as the stand-in does: the same blocks give the same pulses', { skip }, () => {
  // Locks at two tempos, a hi-hat, another song, gaps of two and three beats, a late drum, a stop, and a chance
  // lock on random kicks: every decision.
  const cases = [
    [[{ ms: 12000, bpm: 90, noise: 200 }], 0, 1],
    [[{ ms: 12000, bpm: 160, noise: 200 }], 25, 1],
    [[{ ms: 8000, bpm: 120, pad: 3000, noise: 800 }, { ms: 8000, bpm: 120, hat: true, pad: 3000, noise: 800 }], 0, 1],
    [[{ ms: 10000, bpm: 120, noise: 200 }, { ms: 10000, bpm: 150, noise: 200 }], 0, 1],
    [[{ ms: 10000, bpm: 120, noise: 200 }, { ms: 600, bpm: 120, gap: true }, { ms: 6000, bpm: 120, first: 400, noise: 200 }], 0, 1],
    [[{ ms: 10000, bpm: 120, noise: 200 }, { ms: 1104, bpm: 120, gap: true }, { ms: 6000, bpm: 120, first: 396, noise: 200 }], 0, 1],
    [[{ ms: 12000, bpm: 120, miss: [16], extra: [8045], noise: 200 }], 0, 1],
    [[{ ms: 10000, bpm: 120, noise: 200 }, { ms: 6000, noise: 200 }], 0, 1],
    [[{ ms: 20000, clicks: 4, noise: 200 }], 0, 12],
    ['twoStep', 0, 0],
  ];
  for (const [parts, latency, seed] of cases) {
    const { blocks } = parts === 'twoStep' ? twoStep({ bpm: 125, ms: 12000 }) : music(parts, { seed });
    const tracker = createTracker();
    tracker.setLatency(latency);
    const want = [];
    for (const b of blocks) {
      tracker.hear(b.levels, b.t);
      want.push(...tracker.take());
    }
    assert.ok(want.length > 0, JSON.stringify(parts));
    const line = `track ${latency} ` + blocks.map((b) => [b.t, ...b.levels].join(',')).join(' ');
    const band = JSON.parse(speak([line])[0]);
    assert.equal(band.pulses.length, want.length, `${JSON.stringify(parts)}: ${band.pulses.map((p) => p[0]).join(' ')}`);
    band.pulses.forEach(([at, period], i) => {
      assert.ok(Math.abs(at - want[i].at) < 0.01 && Math.abs(period - want[i].period) < 0.01,
        `${JSON.stringify(parts)} pulse ${i}: ${at} ${period} against ${want[i].at} ${want[i].period}`);
    });
    const left = tracker.state();
    assert.ok(band.locked === left.locked && Math.abs(band.period - left.period) < 0.01, `${JSON.stringify(parts)}: left ${JSON.stringify(band)}`);
  }
});

test("the firmware hashes as node:crypto does, and its id is its key's hash", { skip }, () => {
  const inputs = ['', '616263', randomBytes(16).toString('hex'), randomBytes(55).toString('hex'), randomBytes(64).toString('hex'), randomBytes(200).toString('hex')];
  const got = speak(inputs.map((h) => 'sha256 ' + h));
  inputs.forEach((h, i) => assert.equal(got[i], createHash('sha256').update(Buffer.from(h, 'hex')).digest('hex'), h || 'nothing'));
  const [key] = speak(['key']);
  assert.match(key, /^[a-f0-9]{32}$/, 'a fresh key is 128 random bits');
  assert.deepEqual(speak(['idfor ' + key]), [idOf(key)]);
});

test('the code a wristband draws opens the app on its own four letters', { skip }, () => {
  const [tunnel, lan, wrong] = speak(['relay https://abc-def.trycloudflare.com/', 'relay ws://192.168.1.20:8790', 'relay ftp://x.example']).map((l) => JSON.parse(l));
  assert.deepEqual(tunnel, { ok: true, origin: 'https://abc-def.trycloudflare.com' }, 'the address npm run tunnel prints');
  assert.deepEqual(lan, { ok: true, origin: 'http://192.168.1.20:8790' });
  assert.equal(wrong.ok, false);
  const [a, b] = speak(['pairurl ' + tunnel.origin + ' KXRT', 'pairurl ' + lan.origin + ' HMNP']);
  assert.equal(a, pairUrl(tunnel.origin, 'KXRT'), 'the same address the stand-in draws');
  assert.equal(codeFrom(a), 'KXRT', 'and the app reads its letters out of it');
  assert.equal(codeFrom(b), 'HMNP');
});

// Accents, quotes, a backslash, a script the fonts cannot draw, and a guitar
// the relay's sixteen-character cut splits in half.
const PICK = 'Rós "Q" \\ 晴天 x🎸 Don’t';

test('what the firmware says, the relay takes; what the relay says, the firmware reads as it was meant', { skip }, async () => {
  const relay = await createRelay({ port: 0, host: '127.0.0.1', root: dir });
  const socks = [];
  try {
    const [key] = speak(['key']);
    const id = idOf(key);
    const [hello, ping, low, hold] = speak(['hello ' + key + ' 62', 'ping', 'battery 12', 'hold']);
    assert.deepEqual(JSON.parse(hello), { t: 'wristband', id, key, v: 2, battery: 62 }, "v2, and the id is the key's hash");

    // It opens the socket the way arduinoWebSockets does: asking for its "arduino" subprotocol.
    const band = await open(relay.port, 'arduino');
    socks.push(band);
    band.send(hello);
    const { show: { code } } = await band.until('show', (m) => m.show.kind === 'pairing');

    const ana = await phone(relay.port, 'firmware-room');
    const ben = await phone(relay.port, 'firmware-room');
    socks.push(ana, ben);
    ana.send({ t: 'pair', code });
    const { show: { big } } = await band.until('show', (m) => m.show.kind === 'check');
    assert.equal(Number(big), (await ana.until('view', (m) => m.view.me.check)).view.me.check, 'the number on the wrist is the one the phone asks about');
    ana.send({ t: 'confirm', yes: true });
    const { band: pairedId, secret } = await ana.until('paired');
    assert.equal(pairedId, id, 'paired to the id the firmware made from its key');
    await band.until('show', (m) => m.show.kind === 'test');
    await ana.until('view', (m) => m.view.me.wristband?.battery === 62 && m.view.me.wristband.live);

    ana.send({ t: 'arm', intent: 'hi' });
    relay.tickBands(Date.now() + 1000);
    await band.until('show', (m) => m.show.kind === 'hi');
    ana.send({ t: 'pick', track: PICK });
    ana.send({ t: 'arm', intent: 'song' });
    await band.until('show', (m) => m.show.kind === 'song');
    ana.send({ t: 'arm', intent: 'dance' });
    await band.until('show', (m) => m.show.kind === 'dance');

    band.send(ping);
    await band.until('pong');
    band.send(low);
    await ana.until('view', (m) => m.view.me.wristband?.battery === 12);
    await band.until('show', (m) => m.show.kind === 'dance' && m.show.dim);

    ana.send({ t: 'arm', intent: 'hi' });
    ben.send({ t: 'arm', intent: 'hi' });
    const toBen = (await ana.until('view', (m) => m.view.near.length === 1)).view.near[0].handle;
    const toAna = (await ben.until('view', (m) => m.view.near.length === 1)).view.near[0].handle;
    ana.send({ t: 'wave', handle: toBen });
    ben.send({ t: 'wave', handle: toAna });
    const meet = await band.until('show', (m) => m.show.kind === 'meet');
    const [match] = (await ana.until('view', (m) => m.view.matches.length === 1)).view.matches;
    assert.equal(meet.show.big, String(match.number), 'the meeting number on the wrist is the match');

    band.send(hold);
    await ana.until('view', (m) => m.view.me.invisible);
    await ben.until('view', (m) => m.view.near.length === 0);
    await band.until('show', (m) => m.show.kind === 'off' && m.show.quiet);

    // The same wristband again, as after a Wi-Fi blip: with its secret, still paired.
    const bare = await open(relay.port, 'arduino');
    socks.push(bare);
    bare.send(hello);
    assert.equal((await bare.until('error')).why, 'bad band', 'without the secret the id is not enough');
    const [again] = speak(['hello ' + key + ' 62 ' + secret]);
    assert.equal(JSON.parse(again).secret, secret);
    const back = await open(relay.port, 'arduino');
    socks.push(back);
    back.send(again);
    assert.equal((await back.until('show')).show.kind, 'off', 'still paired, still NOT NOW — not new letters');

    // A wristband with a secret this relay never gave, as after a relay restart: it waits for its owner.
    const [key2] = speak(['key']);
    const [lost] = speak(['hello ' + key2 + ' 62 ' + randomBytes(16).toString('hex')]);
    const waits = await open(relay.port, 'arduino');
    socks.push(waits);
    waits.send(lost);
    await waits.until('show', (m) => m.show.kind === 'waiting');

    // Every frame the relay sent the wristbands, read back by the firmware.
    const frames = [...band.frames, ...waits.frames];
    const read = speak(frames.map((f) => 'show ' + f)).map((l) => JSON.parse(l));
    const kinds = new Set();
    frames.forEach((text, i) => {
      const m = JSON.parse(text);
      if (m.t !== 'show') { assert.equal(read[i], null, text); return; }
      const s = m.show;
      kinds.add(s.kind);
      const { light, words, ...got } = read[i];
      assert.deepEqual(got, {
        kind: s.kind, intent: s.intent ?? '', big: s.big ?? '', small: (s.small ?? '').toWellFormed(), code: s.code ?? '',
        dim: !!s.dim, quiet: !!s.quiet, away: !!s.away, hasArmed: 'armed' in s, armed: s.armed ?? '', rev: s.rev ?? 0,
        lit: ['hi', 'song', 'dance', 'meet'].includes(s.kind) && !!HUE[s.intent],
      }, text);
      assert.equal(light > 0, s.kind !== 'off', 'dark only when the relay says off: ' + text);
      if (s.kind === 'pairing') assert.equal(words.big, s.code);
      if (s.kind === 'check') assert.deepEqual(words, { big: s.big, small: 'ON YOUR PHONE?' }, text);
      if (s.kind === 'waiting') assert.deepEqual(words, { big: 'OPEN YOUR PHONE', small: 'OR SWITCH ME OFF' }, text);
      if (['hi', 'dance', 'meet'].includes(s.kind)) assert.deepEqual(words, { big: s.big, small: s.small.toUpperCase() }, text);
      if (s.kind === 'song') assert.deepEqual(words, { big: 'FIRST SONG?', small: 'ROS "Q" \\ X...' }, "the pick, in the letters the screen's font has");
    });
    assert.deepEqual([...kinds].sort(), ['check', 'dance', 'hi', 'meet', 'off', 'pairing', 'song', 'test', 'waiting'], 'every kind of show was read');
  } finally {
    for (const s of socks) s.ws.terminate();
    await relay.close();
  }
});

/** Bands saying their address on the air, 02abcdef0001 on, each paired to a phone on SAY HI in one room that picked its name. */
async function pairedBands(port, venue, names, socks) {
  const all = [];
  for (const [i, name] of names.entries()) {
    const air = '02abcdef000' + (i + 1);
    const [key] = speak(['key']);
    const [hello] = speak([`hello ${key} 80 - - ${air}`]);
    assert.deepEqual(JSON.parse(hello), { t: 'wristband', id: idOf(key), key, v: 2, battery: 80, air });
    const band = await open(port, 'arduino');
    socks.push(band);
    band.send(hello);
    const { show: { code } } = await band.until('show', (m) => m.show.kind === 'pairing');
    const person = await phone(port, venue);
    socks.push(person);
    person.send({ t: 'pair', code });
    await person.until('view', (m) => m.view.me.check);
    person.send({ t: 'confirm', yes: true });
    await person.until('paired');
    person.send({ t: 'pick', track: name });
    person.send({ t: 'arm', intent: 'hi' });
    all.push({ band, person, air });
  }
  return all;
}

/** Each band's report, and then a ping, so that each report was taken once its pong is back. */
async function report(all, reports) {
  for (const [i, p] of all.entries()) {
    p.band.send(reports[i]);
    p.band.send(speak(['ping'])[0]);
    await p.band.until('pong');
  }
}

test('what the firmware reports it heard, the relay takes: each phone lists the bands its band heard', { skip }, async () => {
  const relay = await createRelay({ port: 0, host: '127.0.0.1', root: dir });
  const socks = [];
  try {
    const all = await pairedBands(relay.port, 'near-room', ['vi', 'x', 'y'], socks);
    const airs = all.map((p) => p.air);
    const listed = async (p, n) => (await p.person.until('view', (m) => m.view.near.length === n)).view.near.map((q) => q.pick).sort();
    const [vi, x, y] = all;
    assert.deepEqual(await listed(vi, 2), ['x', 'y'], 'before any band has reported, the whole room');

    // vi heard x, x heard vi, and y listened and heard nobody: as the firmware writes each report.
    const reports = speak([`heard 6 ${airs[1]}:-48`, `heard 6 ${airs[0]}:-52`, 'heard 6']);
    assert.deepEqual(JSON.parse(reports[0]), { t: 'heard', ch: 6, near: [[airs[1], -48]] });
    assert.deepEqual(JSON.parse(reports[2]), { t: 'heard', ch: 6, near: [] });
    await report(all, reports);
    relay.tickNear();
    assert.deepEqual(await listed(vi, 1), ['x']);
    assert.deepEqual(await listed(x, 1), ['vi']);
    assert.deepEqual(await listed(y, 0), [], 'a band that heard nobody, and nobody heard, lists no band');
  } finally {
    for (const s of socks) s.ws.terminate();
    await relay.close();
  }
});

test("what the firmware reports of the markers, the relay takes: others see each band's person in its area", { skip }, async () => {
  const relay = await createRelay({ port: 0, host: '127.0.0.1', root: dir });
  const socks = [];
  try {
    const all = await pairedBands(relay.port, 'mark-room', ['vi', 'x', 'y'], socks);
    const [vi, x, y] = all;
    // vi heard the bar's marker, x the stage's and y the back's, each clearly, and y a letter no marker has.
    const reports = speak([`heard 6 ${x.air}:-48 ${y.air}:-50 b=-45`, `heard 6 ${vi.air}:-49 s=-50`, `heard 6 ${vi.air}:-51 o=-52 x=-10`]);
    assert.deepEqual(JSON.parse(reports[0]), { t: 'heard', ch: 6, near: [[x.air, -48], [y.air, -50]], marks: [['bar', -45]] });
    assert.deepEqual(JSON.parse(reports[2]), { t: 'heard', ch: 6, near: [[vi.air, -51]], marks: [['back', -52]] });
    await report(all, reports);
    relay.tickNear();
    // The firmware's areas are the relay's: each report was taken, and each person shows in its area.
    const shows = (p, who, band) => p.person.until('view', (m) => m.view.near.some((r) => r.pick === who && r.band === band));
    await shows(vi, 'x', 'by the stage');
    await shows(vi, 'y', 'somewhere out the back');
    await shows(x, 'vi', 'near the bar');
  } finally {
    for (const s of socks) s.ws.terminate();
    await relay.close();
  }
});

test('the firmware and the stand-in keep the same constants, by name', { skip }, () => {
  const [consts] = speak(['consts']);
  assert.deepEqual(JSON.parse(consts), CONSTS);
});

test('the firmware and the stand-in play the same notes and the same flashes', { skip }, () => {
  const [sounds, flashes] = speak(['sounds', 'flashes']);
  assert.deepEqual(JSON.parse(sounds), SOUNDS);
  assert.deepEqual(JSON.parse(flashes), FLASHES);
});

// The stand-in's table of cases (tests/wrist.test.js), run through band_logic.h's Wrist.
for (const c of TABLE.cases) {
  test('band_logic.h: ' + c.name, { skip }, () => {
    if (broken) throw broken;
    const protocol = lines(c, CONSTS);
    const r = spawnSync(bin, ['wrist'], { input: protocol.map((p) => p.line).join('\n') + '\n', encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    check(c, protocol, r.stdout.split(/\r?\n/).slice(0, -1).map((l) => JSON.parse(l)), CONSTS);
  });
}
