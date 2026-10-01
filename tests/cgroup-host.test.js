// ON THE BEAT — the capacity probe's cgroup host (scripts/cgroup-host.mjs): what it takes to hold the relay to a small
// machine's memory in WSL. The settings it writes, the script it runs and the readings it takes back are plain text, so they
// are tested as text; one test (opt-in, because it starts the WSL distro and whatever that distro starts with it) runs the
// real thing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hostScript, parseCpu, parseMemory, readStats, startCgroupRelay, stopScript, wslPath } from '../scripts/cgroup-host.mjs';

const MB = 2 ** 20;

test('a memory size is megabytes, gigabytes or bytes, and anything else, or too small to start node in, is refused', () => {
  assert.equal(parseMemory('207M'), 207 * MB);
  assert.equal(parseMemory('207m'), 207 * MB);
  assert.equal(parseMemory('1G'), 1024 * MB);
  assert.equal(parseMemory(' 256M '), 256 * MB);
  assert.equal(parseMemory('216006656'), 216006656);
  for (const bad of ['', undefined, null, 'M', '207', '15M', '0M', '-5M', '2.5G', '207MB', '207 M', 'lots', '1T']) {
    assert.equal(parseMemory(bad), null, JSON.stringify(bad));
  }
});

test('the cpu share is Fly\'s baseline or none at all, as the line cgroup v2 takes', () => {
  assert.equal(parseCpu('baseline'), '5000 80000', 'a 6.25% share: 5 ms of every 80');
  assert.equal(parseCpu('Free'), 'max 80000');
  for (const bad of ['', undefined, null, 'half', '100', 'max']) assert.equal(parseCpu(bad), null, JSON.stringify(bad));
});

test('a Windows path is the path WSL sees it by, and a path on no drive is nobody\'s', () => {
  assert.equal(wslPath('C:\\Users\\LewisDong\\Documents\\on-the-beat'), '/mnt/c/Users/LewisDong/Documents/on-the-beat');
  assert.equal(wslPath('d:/work/otb'), '/mnt/d/work/otb');
  for (const bad of ['relative\\path', '\\\\server\\share\\x', '/mnt/c/x', '', 'C:']) assert.equal(wslPath(bad), null, JSON.stringify(bad));
});

const WAS = {
  name: 'run-1', memBytes: 207 * MB, cpu: '5000 80000', repo: '/mnt/c/repo', outDir: '/mnt/c/out',
  nightFile: '/tmp/otb-night-run-1.json', flags: [], loadEveryMs: 5000, limitSecs: 300,
};

test('the host script makes the cgroup, limits it, steps into it, runs the relay under a time limit, and leaves the readings', () => {
  const lines = hostScript(WAS).split('\n');
  const at = (re) => { const i = lines.findIndex((l) => re.test(l)); assert.ok(i >= 0, 'no line matches ' + re + ' in\n' + lines.join('\n')); return i; };
  const order = [
    at(/^home=\$\(cut -d: -f3 \/proc\/self\/cgroup\)$/), at(/^mkdir "\$cg" \|\| exit 97$/), at(/^echo 217055232 > "\$cg\/memory\.max" \|\| exit 98$/), at(/^echo 0 > "\$cg\/memory\.swap\.max"$/),
    at(/^echo '5000 80000' > "\$cg\/cpu\.max" \|\| exit 98$/), at(/^echo \$\$ > "\$cg\/cgroup\.procs" \|\| exit 98$/), at(/^cd '\/mnt\/c\/repo' \|\| exit 99$/),
    at(/^PORT=0 NIGHT_FILE='\/tmp\/otb-night-run-1\.json' LOAD_EVERY_MS=5000 timeout -s INT 300 \/usr\/bin\/node relay\/server\.js &$/),
    at(/^echo \$! > '\/mnt\/c\/out\/pid'$/), at(/^wait \$!$/), at(/^echo \$\? > '\/mnt\/c\/out\/code'$/),
    at(/^cat "\$cg\/memory\.peak" > '\/mnt\/c\/out\/peak'$/), at(/^cat "\$cg\/memory\.events" > '\/mnt\/c\/out\/events'$/), at(/^cat "\$cg\/cpu\.stat" > '\/mnt\/c\/out\/cpu\.stat'$/),
    at(/^echo \$\$ > "\/sys\/fs\/cgroup\$home\/cgroup\.procs"$/), at(/^rmdir "\$cg"$/), at(/^rm -f '\/tmp\/otb-night-run-1\.json'$/),
  ];
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'in this order: the shell is in the cgroup before the relay starts, and out of it before the cgroup goes');
  assert.ok(lines.includes('cg=/sys/fs/cgroup/otb-run-1'), 'the cgroup is named for the run');
});

test('the host script passes the node flags it is given to the relay, each one quoted, and to nothing else', () => {
  const script = hostScript({ ...WAS, flags: ['--max-old-space-size=96', '--expose-gc'] });
  assert.match(script, /timeout -s INT 300 \/usr\/bin\/node '--max-old-space-size=96' '--expose-gc' relay\/server\.js &$/m);
  assert.equal(script.split('--max-old-space-size').length, 2, 'the flag is on the one line that runs node');
});

test('the host script refuses anything a shell could read as more: a name, a flag, a path or a number', () => {
  const refused = [
    { name: 'x; rm -rf /' }, { name: '' }, { name: 'Run' }, { name: '../x' },
    { flags: ['--max-old-space-size=96 --inspect'] }, { flags: ["--x='; reboot; '"] }, { flags: ['relay.js'] }, { flags: ['$(id)'] },
    { repo: "/mnt/c/it's" }, { outDir: '/mnt/c/out\nrm' }, { nightFile: "/tmp/x'y" },
    { memBytes: 0 }, { memBytes: 1.5 }, { memBytes: '207' }, { cpu: 'max 1; reboot' }, { limitSecs: 0 }, { limitSecs: 1.5 }, { loadEveryMs: 0 },
  ];
  for (const change of refused) assert.throws(() => hostScript({ ...WAS, ...change }), Error, JSON.stringify(change));
  assert.doesNotThrow(() => hostScript(WAS));
});

test('the stop script reads the relay\'s pid back and signals it: INT to let it write the night, KILL for one that will not', () => {
  assert.equal(stopScript({ outDir: '/mnt/c/out' }), [
    '#!/bin/sh',
    "pid=$(cat '/mnt/c/out/pid' 2>/dev/null) || exit 0",
    'if [ "$1" = KILL ]; then pkill -KILL -P "$pid"; fi',
    'kill -s "$1" "$pid" 2>/dev/null',
    '',
  ].join('\n'));
  assert.throws(() => stopScript({ outDir: "/mnt/c/o'ut" }), Error);
});

test('the kernel\'s three files are read as a peak in MB, kills by the memory limit, and the share of periods the cpu quota held the relay', () => {
  const events = 'low 0\nhigh 0\nmax 12\noom 2\noom_kill 1\noom_group_kill 0\n';
  const cpuStat = 'usage_usec 4000000\nuser_usec 3000000\nsystem_usec 1000000\nnr_periods 400\nnr_throttled 100\nthrottled_usec 7000000\n';
  assert.deepEqual(readStats({ peak: String(134 * MB + 100) + '\n', events, cpuStat, code: '137\n' }),
    { peakMB: 134, oomKills: 1, atLimit: 12, throttledPct: 25, exitCode: 137 });
  // A script that never got as far as the readings leaves nothing: that is zeros and no exit code, not a crash.
  assert.deepEqual(readStats({}), { peakMB: 0, oomKills: 0, atLimit: 0, throttledPct: 0, exitCode: null });
  assert.equal(readStats({ events: 'oom_kill 0\nmax 0\n' }).oomKills, 0);
  assert.equal(readStats({ events: 'oom 3\n' }).oomKills, 0, 'oom is not oom_kill: only a kill is a kill');
});

test('a relay run in a cgroup in WSL answers from Windows, stops on request with its night written, and leaves no cgroup behind', {
  timeout: 180_000,
  skip: process.env.OTB_WSL ? false : 'set OTB_WSL=1: this starts the WSL distro, and whatever that distro starts with it',
}, async () => {
  const host = await startCgroupRelay({ memBytes: 207 * MB, cpu: parseCpu('free'), repo: fileURLToPath(new URL('..', import.meta.url)), limitSecs: 120 });
  try {
    const res = await fetch('http://127.0.0.1:' + host.port + '/');
    assert.equal(res.status, 200, 'the app is served through WSL\'s localhost');
    assert.match(host.out.join(''), /ON THE BEAT relay on http:\/\/localhost:\d+\//);
  } finally {
    await host.stop();
  }
  const kernel = host.stats();
  host.cleanup();
  assert.equal(kernel.exitCode, 0, 'the relay went on the stop it was asked for');
  assert.ok(kernel.peakMB > 5 && kernel.peakMB < 207, 'the cgroup counted its memory: ' + kernel.peakMB + ' MB');
  assert.equal(kernel.oomKills, 0);
  const left = spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '-e', 'ls', '/sys/fs/cgroup'], { encoding: 'utf8' }).stdout;
  assert.ok(!/^otb-run-/m.test(left), 'the cgroup was taken away: ' + left);
});
