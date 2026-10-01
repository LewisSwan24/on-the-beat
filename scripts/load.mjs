// ON THE BEAT — the capacity probe: how many people one machine holds.
//
// A local-only load rig. It starts its own relay child on a free port (with a
// night file in the temp dir, like Fly's volume), then fills a venue with
// simulated phones and paired wristbands that speak the real protocols — join,
// profile, arm, pick, wave, like, keep, ping, and a band's heard reports every
// 5 s. Nothing here is an attack: no pairing-code guessing, no frame storms.
// Clips only when asked (--clip-kb), as many as a venue's phones would really
// post. It never touches Fly.
//
//   node scripts/load.mjs                          # the stages below, 45 s each
//   node scripts/load.mjs --phones 300 --secs 90   # one stage
//   node scripts/load.mjs --phones 100,200,400 --bands 20 --warm 20
//   node scripts/load.mjs --json results.json      # also write the numbers out
//   LOAD_RELAY_ARGS="--max-old-space-size=96" node scripts/load.mjs --phones 100
//                                                  # node flags for the relay child alone, to try a smaller machine's limits
//   node scripts/load.mjs --phones 100 --clip-kb 375 --clip-min 8000 --clip-max 20000
//                                                  # every phone also posts a clip of that size every 8-20 s, to the
//                                                  # floor or back to someone on it: 375 KB is a real five seconds
//
// What it measures, per stage:
//   relay CPU % (one core = 100) and RSS, sampled once a second from outside;
//   views each phone receives per second, and the gaps between them (a healthy
//   relay pushes at most every 100 ms, so gaps stretch when it falls behind);
//   wave latency (send a wave, then see it in your own view; views are parsed
//   at most twice a second per phone, so this is ±0.5 s);
//   drops and server errors;
//   what the relay says of itself every 5 s (relay/load.js, the same lines it says on Fly): its event-loop lag,
//   heap and memory, and how many phones and bands it counts — which cross-checks this rig's own count.
// A stage counts as saturated when the relay holds ≥95% of a core, drops
// anyone, or the p95 view gap passes 250 ms.
//
// The simulator is honest about itself: phones parse at most ~2 views a second
// each, except while a wave or a pairing step waits for its view (the rest are
// counted by size, not read), and the workers run in their own processes, so a
// saturated stage is the relay's ceiling, not this rig's.

import { fork, spawn } from 'node:child_process';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { cpus, platform, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { parseLoad } from '../relay/load.js';
import { parseCpu, parseMemory, startCgroupRelay } from './cgroup-host.mjs';
import { bandIdOf } from '../relay/server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const STAGES = [100, 250, 500, 750, 1000];   // --phones overrides
const SLICE = 250;                            // phones per simulator worker
const WARM = 10;                              // s of settling, not measured
const SECS = 45;                              // s measured, per stage
const GAP_EDGES = [150, 250, 500, 1000, 2000];   // ms; the last bucket is ≥2000
const sha = (s) => createHash('sha256').update(s).digest('hex');

// Deterministic bands: every worker can work out every band's air, so a band's
// heard report can name real neighbours without the workers talking to each other.
const bandKey = (seed, j) => sha(seed + '|key|' + j).slice(0, 32);
const bandAir = (seed, j) => sha(seed + '|air|' + j).slice(0, 12);

function args(argv) {
  const a = { phones: null, bands: null, warm: WARM, secs: SECS, venue: 'load', json: null, worker: false, waveMin: 6_000, waveMax: 14_000, likeMin: 20_000, likeMax: 60_000, clipKb: 0, clipMin: 8_000, clipMax: 20_000 };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case '--phones': a.phones = v.split(',').map(Number); i += 1; break;
      case '--bands': a.bands = Number(v); i += 1; break;
      case '--warm': a.warm = Number(v); i += 1; break;
      case '--secs': a.secs = Number(v); i += 1; break;
      case '--venue': a.venue = v; i += 1; break;
      case '--json': a.json = v; i += 1; break;
      case '--worker': a.worker = true; break;
      case '--url': a.url = v; i += 1; break;
      case '--seed': a.seed = v; i += 1; break;
      case '--slice': a.slice = Number(v); i += 1; break;
      case '--bands-total': a.bandsTotal = Number(v); i += 1; break;
      case '--band-base': a.bandBase = Number(v); i += 1; break;
      case '--band-count': a.bandCount = Number(v); i += 1; break;
      case '--ramp': a.ramp = Number(v); i += 1; break;
      case '--wave-min': a.waveMin = Number(v); i += 1; break;
      case '--wave-max': a.waveMax = Number(v); i += 1; break;
      case '--like-min': a.likeMin = Number(v); i += 1; break;
      case '--like-max': a.likeMax = Number(v); i += 1; break;
      case '--clip-kb': a.clipKb = Number(v); i += 1; break;
      case '--clip-min': a.clipMin = Number(v); i += 1; break;
      case '--clip-max': a.clipMax = Number(v); i += 1; break;
      case '--cgroup-mem': a.cgroupMem = v; i += 1; break;
      case '--cgroup-cpu': a.cgroupCpu = v; i += 1; break;
      case '--wsl-distro': a.distro = v; i += 1; break;
      default: break;
    }
  }
  return a;
}

const A = args(process.argv.slice(2));

// ---------- the simulator worker (one process per 250 phones) ----------

if (A.worker) {
  const stats = {
    views: 0, bytes: 0, gaps: [0, 0, 0, 0, 0, 0], gapSum: 0,
    waves: 0, waveLatSum: 0, waveLatN: 0, likes: 0, pairs: 0,
    drops: 0, errors: 0, heard: 0, clips: 0,
  };
  // One clip's bytes, worked out once: the relay keeps whatever video/webm it is sent, and every phone sends this.
  const CLIP_DATA = A.clipKb > 0 ? randomBytes(A.clipKb * 1024).toString('base64') : '';
  let measuring = false;
  let stopping = false;
  const sockets = new Set();
  const tick = (type) => process.send({ type, stats, at: Date.now() });
  const bucket = (ms) => {
    let i = 0;
    while (i < GAP_EDGES.length && ms >= GAP_EDGES[i]) i += 1;
    return i;
  };

  function connect() {
    const ws = new WebSocket(A.url + '/api/ws');   // no Origin, like every non-browser tool
    sockets.add(ws);
    ws.on('error', () => { if (measuring) stats.errors += 1; });
    return ws;
  }

  // A phone: joins, shows blue (8 in 10), picks a track (9 in 10), pings every
  // 2 s like the app, waves at people every 6-14 s by default (--wave-min/--wave-max, in ms, widen that for a calm room), likes picks every 20-60 s,
  // waves back now and then and keeps every match. It reads at most ~2 views a
  // second; the rest it weighs but does not read, except while a wave waits for
  // its answer or a pairing step waits for its view: the relay sends a view only
  // when it changed, so one skipped then may be the only one that carries it.
  function phone(i) {
    const me = randomBytes(16).toString('hex');
    const p = { ws: null, view: null, lastParse: 0, lastViewAt: 0, retries: 0, pending: new Map(), timers: [], hookApi: null };
    const send = (m) => { if (p.ws?.readyState === 1) p.ws.send(JSON.stringify(m)); };
    const sendWave = (handle) => {
      send({ t: 'wave', handle });
      if (measuring) { stats.waves += 1; if (p.pending.size < 4) p.pending.set(handle, Date.now()); }
    };

    const read = (view) => {
      for (const n of view.near ?? []) {
        // A wave back now and then, so matches (and their keeps) happen like a real night.
        if (n.wavedAtYou && !n.waved && Math.random() < 0.02) sendWave(n.handle);
      }
      for (const x of view.matches ?? []) if (!x.kept) send({ t: 'keep', match: x.id, on: true });
      for (const [handle, at] of p.pending) {
        if ((view.near ?? []).some((n) => n.handle === handle && n.waved)) {
          p.pending.delete(handle);
          if (measuring) { stats.waveLatSum += Date.now() - at; stats.waveLatN += 1; }
        }
      }
    };

    const steady = () => {
      const wave = () => {
        if (stopping) return;
        const near = p.view?.near ?? [];
        if (near.length) sendWave(near[randomInt(near.length)].handle);
        p.timers.push(setTimeout(wave, randomInt(A.waveMin, A.waveMax)));
      };
      const like = () => {
        if (stopping) return;
        const fresh = (p.view?.wall ?? []).filter((x) => !x.liked);
        if (fresh.length) {
          send({ t: 'like', handle: fresh[randomInt(fresh.length)].handle });
          if (measuring) stats.likes += 1;
        }
        p.timers.push(setTimeout(like, randomInt(A.likeMin, A.likeMax)));
      };
      // A clip is either this phone's own five seconds for the floor or a dance back to someone on it who has not had one
      // from this phone yet, so the store grows the way a night's does: a floor clip each, and a back for every face.
      const clip = () => {
        if (stopping) return;
        const floor = (p.view?.floor ?? []).filter((f) => !f.dancedBack);
        const m = { t: 'clip', mime: 'video/webm', data: CLIP_DATA };
        if (floor.length && Math.random() < 0.5) m.to = floor[randomInt(floor.length)].handle;
        send(m);
        if (measuring) stats.clips += 1;
        p.timers.push(setTimeout(clip, randomInt(A.clipMin, A.clipMax)));
      };
      p.timers.push(setInterval(() => send({ t: 'ping' }), 2_000));
      p.timers.push(setTimeout(wave, randomInt(1_000, 8_000)));
      p.timers.push(setTimeout(like, randomInt(5_000, 25_000)));
      if (A.clipKb > 0) p.timers.push(setTimeout(clip, randomInt(Math.floor(A.clipMin / 2), A.clipMin + 1)));
    };

    const open = () => {
      p.ws = connect();
      p.ws.once('open', () => {
        send({ t: 'join', venue: A.venue, me });
        send({ t: 'profile', name: 'load ' + i, contact: 'load-' + i + '@example.test' });
        send({ t: 'arm', intent: Math.random() < 0.8 ? 'hi' : null });
        if (Math.random() < 0.9) send({ t: 'pick', track: 'Load Track ' + (i % 97) });
      });
      p.ws.on('message', (data) => {
        const at = Date.now();
        if (data.slice(0, 12).toString().startsWith('{"t":"view"')) {
          if (measuring) {
            stats.views += 1; stats.bytes += data.length;
            if (p.lastViewAt) { const g = at - p.lastViewAt; stats.gaps[bucket(g)] += 1; stats.gapSum += g; }
          }
          p.lastViewAt = at;
          if (p.view === null || at - p.lastParse >= 500 || p.pending.size || p.hookApi?.hungry()) {
            p.lastParse = at;
            const view = JSON.parse(String(data)).view;
            p.view = view;
            if (p.hookApi?.onView) p.hookApi.onView(view);   // the pairing handshake, while it runs
            read(view);
          }
          return;
        }
        const m = JSON.parse(String(data));   // everything else is small and rare
        if (m.t === 'error' && measuring) stats.errors += 1;
      });
      p.ws.on('close', (code) => {
        sockets.delete(p.ws);
        if (stopping) return;
        stats.drops += 1;
        if (p.retries < 3 && code !== 4003) { p.retries += 1; p.lastViewAt = 0; setTimeout(open, 2_000); }
      });
    };
    open();
    steady();
    return p;
  }

  // A wristband: hello exactly as the firmware does, pair with its phone
  // through the real letters, check number, YES flow, then report what it
  // hears every 5.2 s — up to 16 of the other bands' airs and a marker or two.
  function band(j, p) {
    const key = bandKey(A.seed, j);
    const air = bandAir(A.seed, j);
    const ch = randomInt(1, 15);
    const others = [];
    for (let x = 0; x < A.bandsTotal; x += 1) if (x !== j) others.push(bandAir(A.seed, x));
    const b = { j, ws: null, show: null, secret: null, waiters: [], timer: null, step: 'the relay to show its letters' };
    const send = (m) => { if (b.ws?.readyState === 1) b.ws.send(JSON.stringify(m)); };
    const settle = () => { b.waiters = b.waiters.filter((w) => !w()); };
    b.until = (pred, ms = 20_000) => new Promise((done, fail) => {
      const check = () => { if (b.show && pred(b.show)) { clearTimeout(timer); done(b.show); return true; } return false; };
      const timer = setTimeout(() => fail(new Error('band ' + j + ' timed out; last show ' + JSON.stringify(b.show))), ms);
      if (!check()) b.waiters.push(check);
    });
    let sawCheck = null;
    let sawSecret = null;
    const state = { needPair: false, needCheck: false, code: null };
    p.hookApi = {
      hungry: () => state.needCheck,   // from its letters until its check number is in hand, the phone reads every view
      onView(view) {
        if (state.needPair) { state.needPair = false; p.ws.send(JSON.stringify({ t: 'pair', code: state.code })); }
        if (state.needCheck && view?.me?.check) { state.needCheck = false; sawCheck(view.me.check); }
      },
    };
    b.ws = connect();
    b.ws.once('open', () => send({ t: 'wristband', id: bandIdOf(key), key, v: 2, air, battery: 80 }));
    b.ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.t === 'show') { b.show = m.show; settle(); }
      if (m.t === 'paired') { b.secret = m.secret; settle(); if (sawSecret) sawSecret(m.secret); }
      if (m.t === 'error' && measuring) stats.errors += 1;
    });
    b.ws.on('close', () => { sockets.delete(b.ws); if (!stopping) stats.drops += 1; });
    (async () => {
      try {
        const shown = await b.until((s) => s.code);
        state.code = shown.code;
        state.needPair = true;    // the phone sends `pair` with its next parsed view
        b.step = 'the phone to read its check number';
        const check = await new Promise((done) => { sawCheck = done; state.needCheck = true; });
        b.step = 'the band to show that number';
        await b.until((s) => s.kind === 'check' && s.big === String(check));
        p.ws.send(JSON.stringify({ t: 'confirm', yes: true }));
        b.step = 'the relay to say it paired';
        await new Promise((done) => { sawSecret = done; });
        stats.pairs += 1;   // counted when it happens: the handshakes all land in the warm-up
        b.timer = setInterval(() => {
          if (stopping) return;
          const near = [];
          for (const a of others) if (near.length < 16 && Math.random() < 0.4) near.push([a, -randomInt(45, 86)]);
          const areas = ['bar', 'stage', 'back'].sort(() => Math.random() - 0.5).slice(0, randomInt(1, 3));
          send({ t: 'heard', ch, near, marks: areas.map((area) => [area, -randomInt(47, 63)]) });
          if (measuring) stats.heard += 1;
        }, 5_200);
      } catch (e) {
        if (!stopping) { stats.errors += 1; console.error('band', j, e.message); }
      }
    })();
    return b;
  }

  // ---------- the worker's run ----------

  const phones = [];
  const bands = [];
  let opened = 0;
  const ramp = setInterval(() => {
    const upto = Math.min(A.slice, opened + 20);
    for (; opened < upto; opened += 1) {
      const ph = phone(opened);
      phones.push(ph);
      if (opened < A.bandCount) bands.push(band(A.bandBase + opened, ph));
    }
    if (opened >= A.slice) clearInterval(ramp);
  }, 100);

  // The ramp plus a margin for the handshakes. Every worker in a stage is
  // given the same figure, so their measured windows line up.
  const rampMs = A.ramp ?? (A.slice * 6 + 2_000);
  setTimeout(() => { measuring = true; tick('measure-start'); }, A.warm * 1000 + rampMs);
  const tickTimer = setInterval(() => { if (measuring) tick('tick'); }, 2_000);
  setTimeout(() => {
    stopping = true;
    clearInterval(tickTimer);
    clearInterval(ramp);
    for (const ph of phones) for (const t of ph.timers) { clearTimeout(t); clearInterval(t); }
    for (const bd of bands) {
      clearInterval(bd.timer);
      // A band that never paired is otherwise only a count one short: say where it stood.
      if (!bd.secret) console.error('band', bd.j, 'had not finished pairing when the run ended: still waiting for', bd.step);
    }
    for (const ws of sockets) ws.terminate();
    tick('final');
    setTimeout(() => process.exit(0), 200);
  }, (A.warm + A.secs) * 1000 + rampMs);

  process.on('disconnect', () => process.exit(0));
} else {
  // ---------- the orchestrator: one relay child per stage, workers around it ----------

  // Node flags for the relay child alone, never the simulators around it: LOAD_RELAY_ARGS="--max-old-space-size=96". Each is
  // written --name=value with no space inside it, and a word that is not a flag would run as a file in the relay's place.
  const relayFlags = (process.env.LOAD_RELAY_ARGS ?? '').split(/\s+/).filter(Boolean);
  const stray = relayFlags.find((f) => !f.startsWith('-'));
  if (stray) {
    console.error('LOAD_RELAY_ARGS takes node flags written as --name=value, with no space inside one, and ' + JSON.stringify(stray) + ' is not one');
    process.exit(2);
  }

  // The relay refuses a clip over 1.2 MB, so a bigger one measures nothing; a gap of whole milliseconds with room in it.
  if (!Number.isInteger(A.clipKb) || A.clipKb < 0 || A.clipKb > 1100
    || !Number.isInteger(A.clipMin) || !Number.isInteger(A.clipMax) || A.clipMin < 1000 || A.clipMax <= A.clipMin) {
    console.error('--clip-kb takes whole kilobytes from 0 (no clips) to 1100, and --clip-min and --clip-max whole milliseconds, 1000 or more, the second the larger');
    process.exit(2);
  }

  // --cgroup-mem runs the relay in a Linux cgroup in WSL, held to a small machine's memory (scripts/cgroup-host.mjs). The
  // phones stay on Windows. --cgroup-cpu and --wsl-distro only mean something beside it, so they alone are a mistake.
  let cgroup = null;
  if (A.cgroupMem !== undefined || A.cgroupCpu !== undefined || A.distro !== undefined) {
    const memBytes = parseMemory(A.cgroupMem);
    const cpu = parseCpu(A.cgroupCpu ?? 'baseline');
    if (!memBytes) { console.error('--cgroup-mem takes a size such as 207M or 1G, 16M at least, and the other cgroup flags need it'); process.exit(2); }
    if (!cpu) { console.error('--cgroup-cpu takes baseline (the share of a core a Fly machine gets) or free (no quota)'); process.exit(2); }
    if (platform() !== 'win32') { console.error('--cgroup-mem runs the relay in a WSL distro, so it needs Windows with WSL'); process.exit(2); }
    cgroup = { memBytes, cpu, memory: A.cgroupMem, cpuName: A.cgroupCpu ?? 'baseline', distro: A.distro ?? 'Ubuntu' };
  }

  const log = (...x) => console.log(...x);
  const stages = A.phones ?? STAGES;
  const results = [];
  log('ON THE BEAT capacity probe — local only, never Fly');
  log('host: ' + cpus()[0].model + ', ' + cpus().length + ' threads, ' + (totalmem() / 2 ** 30).toFixed(1) + ' GB, node ' + process.version);
  if (relayFlags.length) log('relay flags: ' + relayFlags.join(' '));
  if (cgroup) log('relay in a cgroup in WSL ' + cgroup.distro + ': memory ' + cgroup.memory + ', cpu ' + cgroup.cpuName + '; the kernel counts and kills');
  log('stages (phones): ' + stages.join(', ') + '; ' + A.warm + ' s warm + ' + A.secs + ' s measured each\n');

  // The seconds a stage lasts, and a margin for the relay's own start and stop: the time limit a cgroup relay is given to end by itself.
  const stageSecs = (P) => A.warm + A.secs + Math.ceil((A.ramp ?? (Math.min(SLICE, P) * 6 + 2_000)) / 1000) + 120;

  async function startRelay(nightFile, P) {
    if (!cgroup) return startLocalRelay(nightFile);
    const every = process.env.LOAD_EVERY_MS ?? '5000';
    const host = await startCgroupRelay({
      distro: cgroup.distro, memBytes: cgroup.memBytes, cpu: cgroup.cpu, flags: relayFlags, repo: ROOT,
      loadEveryMs: /^\d+$/.test(every) ? Number(every) : 5000, limitSecs: stageSecs(P),
    });
    return { relay: host.relay, port: host.port, out: host.out, host };
  }

  function startLocalRelay(nightFile) {
    return new Promise((done, fail) => {
      const relay = spawn(process.execPath, [...relayFlags, join(ROOT, 'relay', 'server.js')], {
        cwd: ROOT,
        // The relay says its load every 5 s here, not every minute: a stage lasts under one (LOAD_EVERY_MS, if set, wins).
        env: { ...process.env, PORT: '0', NIGHT_FILE: nightFile, LOAD_EVERY_MS: process.env.LOAD_EVERY_MS ?? '5000' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const out = [];
      let settled = false;
      const onData = (d) => {
        const s = String(d);
        out.push(s);
        const m = s.match(/localhost:(\d+)/);
        if (m && !settled) { settled = true; done({ relay, port: Number(m[1]), out }); }
      };
      relay.stdout.on('data', onData);
      relay.stderr.on('data', onData);
      relay.on('exit', (code) => { if (!settled) fail(new Error('relay exited ' + code + '\n' + out.join(''))); });
      setTimeout(() => { if (!settled) fail(new Error('relay never said its port\n' + out.join(''))); }, 15_000);
    });
  }

  // The relay's CPU and RSS, from outside it: Windows asks PowerShell once a
  // second; elsewhere the probe reports its client-side numbers alone.
  function startSampler(pid) {
    if (platform() !== 'win32') return { samples: [], stop: () => {} };
    const ps = [
      '$id = ' + pid,
      '$prev = $null',
      'while ($true) {',
      '  try { $p = Get-Process -Id $id -ErrorAction Stop } catch { break }',
      '  $cpu = $p.TotalProcessorTime.TotalMilliseconds',
      '  $rss = $p.WorkingSet64',
      '  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()',
      '  if ($prev -ne $null) {',
      '    $dt = $now - $prev[1]',
      '    if ($dt -gt 0) { Write-Output ("{0} {1} {2}" -f $now, [math]::Round(($cpu - $prev[0]) / $dt * 100), $rss) }',
      '  }',
      '  $prev = @($cpu, $now)',
      '  Start-Sleep -Milliseconds 1000',
      '}',
    ].join('\n');
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: ['ignore', 'pipe', 'ignore'] });
    const samples = [];
    child.stdout.on('data', (d) => {
      for (const line of String(d).split(/\r?\n/)) {
        const [ts, cpu, rss] = line.trim().split(' ');
        if (ts && cpu !== undefined && rss !== undefined) samples.push({ cpu: Number(cpu), rss: Number(rss) });
      }
    });
    return { samples, stop: () => child.kill() };
  }

  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  for (const [si, P] of stages.entries()) {
    const B = A.bands ?? Math.max(2, Math.round(P / 10));
    const venue = A.venue + '-' + (si + 1);
    const seed = 'otb-load-' + Date.now() + '-' + si;
    const nightFile = join(tmpdir(), 'otb-load-night-' + Date.now() + '-' + si + '.json');
    log('— stage ' + (si + 1) + ': ' + P + ' phones, ' + B + ' paired bands, venue ' + venue);
    let relayInfo;
    try {
      relayInfo = await startRelay(nightFile, P);
    } catch (e) {
      log('relay would not start: ' + e.message + '\n');
      results.push({ phones: P, bands: B, failed: 'relay start' });
      continue;
    }
    const { relay, port, host } = relayInfo;
    // In a cgroup the relay is a process inside WSL, so Windows has nothing to sample: its own load lines stand in.
    const sampler = host ? { samples: [], stop: () => {} } : startSampler(relay.pid);
    let relayExit = null;
    relay.on('exit', (code) => { relayExit = code; });

    const workers = [];
    const agg = { views: 0, bytes: 0, gaps: [0, 0, 0, 0, 0, 0], gapSum: 0, waves: 0, waveLatSum: 0, waveLatN: 0, likes: 0, pairs: 0, drops: 0, errors: 0, heard: 0, clips: 0 };
    // The ramp allowance, shared by every worker so their windows line up;
    // --ramp shortens it (a test's handful of people need no long ramp).
    const rampMsStage = A.ramp ?? (Math.min(SLICE, P) * 6 + 2_000);
    const started = Date.now();
    for (let base = 0; base < P; base += SLICE) {
      const slice = Math.min(SLICE, P - base);
      const bandBase = Math.round((B * base) / P);
      const bandCount = Math.round((B * (base + slice)) / P) - bandBase;
      const worker = fork(fileURLToPath(import.meta.url), [
        '--worker', '--url', 'ws://127.0.0.1:' + port, '--venue', venue, '--seed', seed,
        '--slice', String(slice), '--bands-total', String(B),
        '--band-base', String(bandBase), '--band-count', String(bandCount),
        '--warm', String(A.warm), '--secs', String(A.secs), '--ramp', String(rampMsStage),
        '--wave-min', String(A.waveMin), '--wave-max', String(A.waveMax),
        '--like-min', String(A.likeMin), '--like-max', String(A.likeMax),
        '--clip-kb', String(A.clipKb), '--clip-min', String(A.clipMin), '--clip-max', String(A.clipMax),
      ], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      // The worker's stats are cumulative, so only its final message counts;
      // the mid-run ticks are there to watch, not to add up.
      let sawFinal = false;
      worker.on('message', (m) => {
        if (m.type === 'tick') { process.stderr.write('.'); return; }
        if (m.type !== 'final') return;
        sawFinal = true;
        for (const k of Object.keys(agg)) {
          if (Array.isArray(agg[k])) for (let x = 0; x < agg[k].length; x += 1) agg[k][x] += m.stats[k][x];
          else agg[k] += m.stats[k];
        }
      });
      workers.push(new Promise((done) => worker.on('exit', (code, signal) => {
        // The code says whether it was node's own abort (3221226505 on Windows, 0xC0000409) or the rig's.
        if (!sawFinal) log('   warning: a worker died without reporting (exit code ' + code + (signal ? ', signal ' + signal : '') + ')');
        done();
      })));
    }
    await Promise.all(workers);
    const elapsed = (Date.now() - started) / 1000;
    const secs = Math.max(1, elapsed - A.warm - rampMsStage / 1000);
    sampler.stop();
    if (host) await host.stop();
    else {
      relay.kill('SIGINT');
      await new Promise((done) => { const t = setTimeout(() => { relay.kill('SIGKILL'); done(); }, 6_000); relay.on('exit', () => { clearTimeout(t); done(); }); });
    }
    try { unlinkSync(nightFile); } catch { /* already gone */ }

    // The last two thirds of the samples only: the ramp's connecting is not the steady state.
    const steady = sampler.samples.slice(Math.floor(sampler.samples.length / 3));
    // What the relay said of itself: its start line, and the load lines it said while the stage ran (relay/load.js).
    const said = relayInfo.out.join('').split(/\r?\n/);
    const machine = said.find((l) => l.startsWith('load: node ')) ?? null;
    const lines = said.map(parseLoad).filter(Boolean);
    const steadyLines = lines.slice(Math.floor(lines.length / 3));
    const kernel = host ? host.stats() : null;   // what the cgroup counted: its own peak, any kill by its limit, and how often its CPU quota held the relay
    if (host) host.cleanup();
    const most = (from, key) => Math.max(...from.map((l) => l[key]));
    const gapTotal = agg.gaps.reduce((a, b) => a + b, 0);
    let gapP95 = null;
    let n = 0;
    for (let i = 0; i < agg.gaps.length && gapP95 === null; i += 1) {
      n += agg.gaps[i];
      if (n >= gapTotal * 0.95) gapP95 = i < GAP_EDGES.length ? GAP_EDGES[i] : '>=2000';
    }
    const r = {
      phones: P, bands: B, secs: Math.round(secs), relayFlags,
      cpuAvg: Math.round(mean((host ? steadyLines : steady).map((s) => s.cpu)) ?? -1),
      cpuMax: (host ? steadyLines : steady).length ? Math.round(Math.max(...(host ? steadyLines : steady).map((s) => s.cpu))) : null,
      rssMaxMB: host ? (steadyLines.length ? most(steadyLines, 'rssMB') : null)
        : steady.length ? Math.round(Math.max(...steady.map((s) => s.rss)) / 2 ** 20) : null,
      viewsPerPhoneSec: +(agg.views / (P * secs)).toFixed(1),
      gapMeanMs: gapTotal ? Math.round(agg.gapSum / gapTotal) : null,
      gapP95Ms: gapP95,
      waveLatMeanMs: agg.waveLatN ? Math.round(agg.waveLatSum / agg.waveLatN) : null,
      waves: agg.waves, likes: agg.likes, pairs: agg.pairs, heard: agg.heard, clips: agg.clips, clipKb: A.clipKb,
      drops: agg.drops, errors: agg.errors, relayExit: kernel ? kernel.exitCode : relayExit,
      cgroup: kernel ? { memory: cgroup.memory, cpu: cgroup.cpuName, ...kernel } : null,
      kbpsPerPhone: +(agg.bytes * 8 / 1024 / (P * secs)).toFixed(1),
      // The relay's own figures, for the report: counts at their most over the stage, the rest over its steady part.
      relayMachine: machine && machine.slice('load: '.length),
      relayLoad: lines.length ? {
        lines: lines.length, phones: most(lines, 'phones'), bands: most(lines, 'bands'),
        cpuMax: most(steadyLines, 'cpu'), lagP99Ms: most(steadyLines, 'lagP99'), lagMaxMs: most(steadyLines, 'lagMax'),
        rssMaxMB: most(steadyLines, 'rssMB'), heapMaxMB: most(steadyLines, 'heapUsedMB'), heapLimitMB: lines.at(-1).heapLimitMB,
        buffersMaxMB: most(steadyLines, 'buffersMB'), clipsMaxMB: most(steadyLines, 'clipsMB'),
      } : null,
    };
    // A quiet room also has long gaps, so the gap only counts once views flow steadily.
    r.saturated = r.cpuAvg >= 95 || r.drops > 0 || (kernel?.oomKills ?? 0) > 0
      || (r.viewsPerPhoneSec >= 5 && typeof r.gapP95Ms === 'number' && r.gapP95Ms > 250);
    results.push(r);
    if (kernel) {
      log('   cgroup ' + cgroup.memory + ' / cpu ' + cgroup.cpuName + ': peak ' + kernel.peakMB + ' MB counted (page cache included), '
        + (kernel.oomKills ? 'OOM-KILLED x' + kernel.oomKills : 'no OOM kill') + ', at its limit ' + kernel.atLimit + ' times, cpu quota held it in '
        + kernel.throttledPct + '% of periods (the cpu and rss below come from the load lines the relay says)');
    }
    log('   relay: cpu avg ' + r.cpuAvg + '% max ' + r.cpuMax + '% (one core = 100%), rss max ' + r.rssMaxMB + ' MB');
    log(r.relayLoad
      ? '   relay says: ' + r.relayLoad.phones + ' phones and ' + r.relayLoad.bands + ' bands on it, loop lag p99 ' + r.relayLoad.lagP99Ms
        + ' ms (max ' + r.relayLoad.lagMaxMs + '), heap ' + r.relayLoad.heapMaxMB + ' of ' + r.relayLoad.heapLimitMB + ' MB, buffers ' + r.relayLoad.buffersMaxMB + ' MB of which clips ' + r.relayLoad.clipsMaxMB + ' MB, rss ' + r.relayLoad.rssMaxMB + ' MB (' + r.relayMachine + ')'
      : '   relay says: no load line was said');
    log('   phones: ' + r.viewsPerPhoneSec + ' views/s each (' + r.kbpsPerPhone + ' kbit/s each), gap mean ' + r.gapMeanMs + ' ms, p95 ' + r.gapP95Ms + ' ms');
    log('   traffic: ' + agg.waves + ' waves (seen again after ~' + r.waveLatMeanMs + ' ms), ' + agg.likes + ' likes, ' + agg.pairs + ' pairings, ' + agg.heard + ' heard reports'
      + (A.clipKb ? ', ' + agg.clips + ' clips of ' + A.clipKb + ' KB' : ''));
    log('   health: ' + agg.drops + ' drops, ' + agg.errors + ' errors -> ' + (r.saturated ? 'SATURATED' : 'healthy') + '\n');
  }

  log('— summary (this laptop: ' + cpus()[0].model + '; the relay is one process on one core)');
  for (const r of results) {
    log('  ' + String(r.phones).padStart(5) + ' phones, ' + String(r.bands).padStart(3) + ' bands: cpu '
      + String(r.cpuAvg).padStart(4) + '%, rss ' + String(r.rssMaxMB).padStart(4) + ' MB, '
      + String(r.viewsPerPhoneSec).padStart(5) + ' views/s each, gap p95 ' + String(r.gapP95Ms).padStart(5)
      + ' ms, ' + r.drops + ' drops -> ' + (r.saturated ? 'SATURATED' : 'healthy'));
  }
  if (A.json) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolve(A.json), JSON.stringify({
      host: cpus()[0].model, threads: cpus().length, node: process.version, at: new Date().toISOString(), results,
    }, null, 2));
    log('numbers written to ' + resolve(A.json));
  }
}
