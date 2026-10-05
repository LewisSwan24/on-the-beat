// ON THE BEAT — the capacity probe works end to end: its phones join and are
// pushed views, its bands pair through the real letters-check-YES flow and
// their heard reports flow, and the stage's numbers come out as JSON
// (scripts/load.mjs). A smoke test of the rig, not of the relay's limits:
// the sizes here are tiny, and the ceilings are measured by hand
// (docs/show-night.md, docs/not-done.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHeapStatistics } from 'node:v8';

const script = fileURLToPath(new URL('../scripts/load.mjs', import.meta.url));

/** Runs the probe with `args` (and `env` beside the process's own), and gives back its one stage's numbers and what it said on stderr. */
async function rig(args, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'otb-load-test-'));
  const out = join(dir, 'results.json');
  // The relay says its load every second here: a stage this small lasts about ten.
  const child = spawn(process.execPath, [script, ...args, '--json', out], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LOAD_EVERY_MS: '1000', ...env } });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((done) => child.on('close', done));
  try {
    assert.equal(code, 0, 'the probe exited ' + code + '; stderr: ' + err);
    const { results } = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(results.length, 1);
    return { r: results[0], err };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the load rig fills a venue, pairs its bands, and reports the stage', { timeout: 120_000 }, async () => {
  // Warm and ramp with room to spare: node --test runs files in parallel, so
  // this rig shares the machine, and the pairing handshake (letters, check,
  // YES, each step on a phone that parses at most twice a second) must not
  // lose a band to a busy CPU.
  // Waves come every second or so, not the keen room's 6-14 s: a phone's first wave falls anywhere in its first 8 s, so
  // in a 5 s window of 8 phones there were none about one run in twenty-five, and "waves were sent" failed on its own.
  const { r, err } = await rig(['--phones', '8', '--bands', '3', '--warm', '5', '--secs', '5', '--venue', 'rig', '--ramp', '2500',
    '--wave-min', '700', '--wave-max', '1400']);
  assert.equal(r.phones, 8);
  assert.equal(r.bands, 3);
  assert.equal(r.pairs, 3, 'every band paired with its phone through the real flow; the rig said:\n' + err);
  assert.equal(r.drops, 0, 'nobody was dropped');
  assert.equal(r.errors, 0, 'the relay refused nothing');
  assert.ok(r.viewsPerPhoneSec > 0, 'views reached the phones');
  assert.ok(r.waves > 0, 'waves were sent');
  assert.ok(r.heard > 0, 'the bands reported what they heard');
  assert.equal(r.saturated, false, 'eight people are nowhere near a ceiling');
  assert.deepEqual(r.relayFlags, [], 'the relay runs on node\'s own defaults unless the rig is told otherwise');
  // The relay's own load lines (relay/load.js), read by the rig: its count of who is on it must be the rig's own.
  assert.ok(r.relayLoad && r.relayLoad.lines >= 3, 'the relay said its load while the stage ran; the rig said:\n' + err);
  assert.equal(r.relayLoad.phones, 8, 'the relay counted every phone');
  assert.equal(r.relayLoad.bands, 3, 'and every paired wristband');
  assert.match(r.relayMachine, /^node v\d+\.\d+\.\d+, heap limit \d+ MB on a machine with \d+ MB$/);
  assert.ok(r.relayLoad.heapMaxMB > 0 && r.relayLoad.heapMaxMB < r.relayLoad.heapLimitMB, 'the heap is under its limit');
  assert.ok(r.relayLoad.rssMaxMB > 20 && r.relayLoad.lagMaxMs >= r.relayLoad.lagP99Ms, 'memory and lag came through as numbers');
});

test('the load rig pairs its bands in a calm room too, where nothing else sends a phone another view', { timeout: 120_000 }, async () => {
  // The relay sends a person a view only when it changed, and a rig phone reads at most two a second, so the view a
  // pairing step is waiting for can be the one the phone skips. In a room where nobody waves or likes for minutes,
  // nothing else comes along to stand in for it: the handshake must not depend on one.
  // A band with no phone view to wait for is the one that pairs, so every phone has a band: one stalled band is a
  // failure, and the more there are the less likely it is that all of them happen to be rescued by a late wave.
  const { r, err } = await rig([
    '--phones', '8', '--bands', '8', '--warm', '2', '--secs', '1', '--ramp', '2000', '--venue', 'calm',
    '--wave-min', '600000', '--wave-max', '900000', '--like-min', '600000', '--like-max', '900000',
  ]);
  assert.equal(r.pairs, 8, 'every band paired with its phone through the real flow; the rig said:\n' + err);
  assert.equal(r.drops, 0, 'nobody was dropped');
  assert.equal(r.errors, 0, 'the relay refused nothing');
});

test('LOAD_RELAY_ARGS gives the relay the rig starts the node flags it names', { timeout: 120_000 }, async (t) => {
  // The use is trying a smaller machine's limits on the relay (docs/show-night.md). A heap limit is a flag whose effect the
  // relay reports of itself, in its start line, so it is how this test sees the flag land.
  const defaultMB = Math.round(getHeapStatistics().heap_size_limit / 2 ** 20);
  if (defaultMB <= 300) { t.skip('this machine\'s own heap limit is ' + defaultMB + ' MB, too small to tell the flag from it'); return; }
  const { r, err } = await rig(['--phones', '4', '--bands', '2', '--warm', '2', '--secs', '2', '--ramp', '1500', '--venue', 'flags'],
    { LOAD_RELAY_ARGS: '--max-old-space-size=64' });
  assert.deepEqual(r.relayFlags, ['--max-old-space-size=64'], 'the stage says which flags the relay ran with');
  assert.ok(r.relayLoad, 'the relay said its load; the rig said:\n' + err);
  assert.ok(r.relayLoad.heapLimitMB < defaultMB, 'the relay ran under a heap limit below the ' + defaultMB + ' MB node picks here, not ' + r.relayLoad.heapLimitMB + ' MB');
  assert.equal(r.drops, 0, 'nobody was dropped');
});

test('LOAD_RELAY_ARGS takes node flags and nothing else: a word that is not one stops the rig before it starts a stage', async () => {
  // Read the other way, `my-script.js` would run that file in place of the relay and the numbers would be of nothing.
  const child = spawn(process.execPath, [script, '--phones', '4'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LOAD_RELAY_ARGS: '--max-old-space-size=64 my-script.js' } });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((done) => child.on('close', done));
  assert.equal(code, 2, 'it stopped with a usage error');
  assert.match(err, /LOAD_RELAY_ARGS takes node flags.*"my-script\.js"/, 'it names the word it will not take');
  assert.ok(!out.includes('stage 1'), 'no stage was begun');
});

test('the load rig posts clips when asked, and the relay says it holds them', { timeout: 120_000 }, async () => {
  // Clips are how a venue's memory grows past what its people alone need (relay/server.js ALL_CLIPS_MAX), so the rig
  // can post them: a floor clip, or a dance back to someone on the floor, every second or so from each phone here.
  const { r, err } = await rig(['--phones', '8', '--bands', '2', '--warm', '4', '--secs', '6', '--ramp', '2000', '--venue', 'clips',
    '--clip-kb', '30', '--clip-min', '1000', '--clip-max', '1500']);
  assert.equal(r.clipKb, 30);
  assert.ok(r.clips >= 8, 'the phones posted clips while it was measured: ' + r.clips + '; the rig said:\n' + err);
  assert.equal(r.errors, 0, 'the relay refused none of them');
  assert.equal(r.drops, 0, 'nobody was dropped');
  assert.ok(r.relayLoad && r.relayLoad.clipsMaxMB > 0, 'the relay said it held video: ' + JSON.stringify(r.relayLoad));
  assert.ok(r.relayLoad.clipsMaxMB < 4, 'a few clips of 30 KB are not megabytes: ' + r.relayLoad.clipsMaxMB);
  assert.ok(r.relayLoad.buffersMaxMB >= 0 && r.relayLoad.buffersMaxMB < r.relayLoad.rssMaxMB, 'buffers are a part of memory');
});

test('without --clip-kb the rig posts no clips, and the relay holds none', { timeout: 120_000 }, async () => {
  const { r } = await rig(['--phones', '4', '--bands', '2', '--warm', '2', '--secs', '3', '--ramp', '1500', '--venue', 'noclips']);
  assert.equal(r.clips, 0);
  assert.equal(r.relayLoad.clipsMaxMB, 0);
});

// The two stages below hold the relay to a small machine's memory in a Linux cgroup in WSL (scripts/cgroup-host.mjs). They are
// opt-in, because starting the WSL distro starts whatever else it starts with it: OTB_WSL=1 npm test, then wsl.exe --terminate Ubuntu.
const WSL = { skip: process.env.OTB_WSL ? false : 'set OTB_WSL=1: this starts the WSL distro, and whatever that distro starts with it' };

test('a stage run with --cgroup-mem holds the relay in a cgroup and reports what the kernel counted', { timeout: 180_000, ...WSL }, async () => {
  const { r, err } = await rig(['--phones', '6', '--bands', '2', '--warm', '4', '--secs', '6', '--ramp', '2000', '--venue', 'cg',
    '--cgroup-mem', '207M', '--cgroup-cpu', 'free', '--clip-kb', '30', '--clip-min', '1000', '--clip-max', '1500']);
  assert.equal(r.pairs, 2, 'the bands paired through WSL\'s localhost; the rig said:\n' + err);
  assert.equal(r.drops, 0);
  assert.equal(r.cgroup.memory, '207M');
  assert.equal(r.cgroup.cpu, 'free');
  assert.ok(r.cgroup.peakMB > 5 && r.cgroup.peakMB < 207, 'the cgroup counted its memory: ' + r.cgroup.peakMB + ' MB');
  assert.equal(r.cgroup.oomKills, 0);
  assert.equal(r.cgroup.exitCode, 0, 'the relay went on the stop it was asked for');
  assert.ok(r.relayLoad && r.relayLoad.phones === 6, 'the relay\'s own lines came back through the pipe: ' + JSON.stringify(r.relayLoad));
  assert.ok(r.relayLoad.heapLimitMB >= 200 && r.relayLoad.heapLimitMB <= 300, 'node read the cgroup and chose a heap limit like Fly\'s: ' + r.relayLoad.heapLimitMB);
  assert.equal(r.saturated, false);
});

test('a relay the kernel kills for its memory is reported as killed, and the stage as saturated', { timeout: 180_000, ...WSL }, async () => {
  // A cgroup of 48 MB holds node itself and little else: twenty phones sending a megabyte of video each every second or so
  // take it past that, and the kernel ends the relay.
  const { r } = await rig(['--phones', '20', '--bands', '2', '--warm', '5', '--secs', '15', '--ramp', '3000', '--venue', 'oom',
    '--cgroup-mem', '48M', '--cgroup-cpu', 'free', '--clip-kb', '1000', '--clip-min', '1000', '--clip-max', '1500']);
  assert.ok(r.cgroup.oomKills >= 1, 'the cgroup killed the relay: ' + JSON.stringify(r.cgroup));
  assert.equal(r.cgroup.exitCode, 137, 'a process the kernel killed leaves 137');
  assert.equal(r.saturated, true, 'a relay that was killed is not a healthy stage');
});
