// ON THE BEAT — the capacity probe's way of holding the relay to a small machine's limits.
//
// Fly gives the relay 207 MB and a CPU quota. A laptop can only say what the relay does with a whole machine, so
// scripts/load.mjs --cgroup-mem 207M runs the relay in a real Linux cgroup, in the WSL distro on this machine, while its
// phones run on Windows as always. The kernel then does what Fly's does: it counts the memory (page cache and all), kills
// the process that goes past it, and throttles one that spends more CPU than its quota.
//
// This module is the part that does not need WSL: what the cgroup's settings and its readings look like, the shell script
// that makes one, and the launcher that runs the script. Nothing here touches Fly, and nothing but the distro it is told to.
//
// Starting a stopped WSL distro starts whatever that distro starts with it. On this machine that is the owner's own
// gateway: stop the distro when the probe is done (wsl.exe --terminate <distro>), and say so before the first run.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MB = 2 ** 20;

/** Fly's shared-cpu-1x: a 6.25% share of a core, which is 5000 µs of every 80000. `free` lifts the quota and keeps the memory. */
const CPU = { baseline: '5000 80000', free: 'max 80000' };

/** "207M", "1G" or a plain byte count, as bytes; null for anything else, and for nothing. */
export function parseMemory(text) {
  const m = /^(\d+)([MG]?)$/i.exec(String(text ?? '').trim());
  if (!m) return null;
  const bytes = Number(m[1]) * (m[2].toUpperCase() === 'G' ? 1024 * MB : m[2] ? MB : 1);
  return bytes >= 16 * MB ? bytes : null;   // under 16 MB node cannot start, and the number is a typo
}

/** `baseline` or `free`, as the line cgroup v2 takes for cpu.max; null for anything else. */
export function parseCpu(text) {
  const key = String(text ?? '').trim().toLowerCase();
  return Object.hasOwn(CPU, key) ? CPU[key] : null;
}

/** A Windows path as the path WSL sees it, or null for one on no drive. */
export function wslPath(winPath) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(String(winPath));
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/') : null;
}

/** A word safe to put inside single quotes in a shell script; anything with a quote or a line break in it is refused. */
const quoted = (s) => {
  if (/['\n\r\0]/.test(String(s))) throw new Error('refusing to put ' + JSON.stringify(String(s)) + ' in a shell script');
  return "'" + s + "'";
};

/** A cgroup's own name: letters, digits and hyphens, nothing a path or a shell could read as more. */
const NAME = /^[a-z0-9-]{1,40}$/;

/** A node flag, written --name=value: no spaces and no characters a shell reads. */
const FLAG = /^--?[A-Za-z0-9_.=:,/-]+$/;

/**
 * The script that makes the cgroup, runs the relay in it, and leaves what the kernel counted in `outDir`, as files:
 * `pid` (the relay's, for the stop script), `code` (its exit status; 137 when the kernel killed it), `peak`, `events`
 * and `cpu.stat`. The shell moves itself into the cgroup, so the relay starts in it and nothing else does; it moves
 * back to the cgroup it came from before it takes this one away, which a cgroup with a process in it will not allow. Not
 * to the root: WSL answers a write of a pid to the root's cgroup.procs with an I/O error, and the cgroup stays behind.
 */
export function hostScript({ name, memBytes, cpu, repo, outDir, nightFile, flags = [], loadEveryMs = 5000, limitSecs }) {
  if (!NAME.test(name)) throw new Error('a cgroup name is letters, digits and hyphens: ' + JSON.stringify(name));
  if (!Number.isInteger(memBytes) || memBytes <= 0) throw new Error('memBytes must be a whole number of bytes');
  if (!Object.values(CPU).includes(cpu)) throw new Error('cpu must be a line from parseCpu');
  if (!Number.isInteger(limitSecs) || limitSecs <= 0) throw new Error('limitSecs must be a whole number of seconds');
  if (!Number.isInteger(loadEveryMs) || loadEveryMs <= 0) throw new Error('loadEveryMs must be a whole number of milliseconds');
  for (const f of flags) if (!FLAG.test(f)) throw new Error('a node flag is written --name=value with no space or quote in it: ' + JSON.stringify(f));
  return [
    '#!/bin/sh',
    '# Written by scripts/cgroup-host.mjs: the relay in a cgroup, and what the kernel counted of it left beside it.',
    'cg=/sys/fs/cgroup/otb-' + name,
    'home=$(cut -d: -f3 /proc/self/cgroup)',
    'mkdir "$cg" || exit 97',
    'echo ' + memBytes + ' > "$cg/memory.max" || exit 98',
    'echo 0 > "$cg/memory.swap.max"',
    'echo ' + quoted(cpu) + ' > "$cg/cpu.max" || exit 98',
    'echo $$ > "$cg/cgroup.procs" || exit 98',
    'cd ' + quoted(repo) + ' || exit 99',
    'PORT=0 NIGHT_FILE=' + quoted(nightFile) + ' LOAD_EVERY_MS=' + loadEveryMs
      + ' timeout -s INT ' + limitSecs + ' /usr/bin/node ' + flags.map(quoted).join(' ') + (flags.length ? ' ' : '') + 'relay/server.js &',
    'echo $! > ' + quoted(outDir + '/pid'),
    'wait $!',
    'echo $? > ' + quoted(outDir + '/code'),
    'cat "$cg/memory.peak" > ' + quoted(outDir + '/peak'),
    'cat "$cg/memory.events" > ' + quoted(outDir + '/events'),
    'cat "$cg/cpu.stat" > ' + quoted(outDir + '/cpu.stat'),
    'echo $$ > "/sys/fs/cgroup$home/cgroup.procs"',
    'rmdir "$cg"',
    'rm -f ' + quoted(nightFile),
    '',
  ].join('\n');
}

/** The script that ends the relay: `sh stop.sh INT` asks it to write the night and go, `sh stop.sh KILL` is for one that will not. */
export function stopScript({ outDir }) {
  const pid = quoted(outDir + '/pid');
  return [
    '#!/bin/sh',
    'pid=$(cat ' + pid + ' 2>/dev/null) || exit 0',
    'if [ "$1" = KILL ]; then pkill -KILL -P "$pid"; fi',
    'kill -s "$1" "$pid" 2>/dev/null',
    '',
  ].join('\n');
}

const num = (text, key) => {
  const m = new RegExp('^' + key + ' (\\d+)$', 'm').exec(text);
  return m ? Number(m[1]) : 0;
};

/** What the kernel counted, from the three files the script leaves: peak memory, kills by the memory limit, and how often the CPU quota held it. */
export function readStats({ peak = '', events = '', cpuStat = '', code = '' }) {
  const periods = num(cpuStat, 'nr_periods');
  const throttled = num(cpuStat, 'nr_throttled');
  return {
    peakMB: Math.round(Number(String(peak).trim() || 0) / MB),
    oomKills: num(events, 'oom_kill'),
    atLimit: num(events, 'max'),      // times the cgroup reached its limit and had to reclaim: page cache goes first
    throttledPct: periods ? Math.round((throttled / periods) * 100) : 0,
    exitCode: String(code).trim() === '' ? null : Number(String(code).trim()),
  };
}

/** The path as WSL must be told it: the long form, which `wsl.exe` can find, and not the 8.3 short one a temp dir may come in. */
const longPath = (p) => realpathSync.native(p);

/**
 * Starts the relay in a fresh cgroup in `distro` and gives back what scripts/load.mjs needs from a relay it started: its
 * port and what it said, once Windows can reach it (WSL's localhost forwarding lags the relay's "listening" line by about a
 * second, and a rig band connects once and does not retry), plus `stop()` and `stats()`.
 */
export async function startCgroupRelay({ distro = 'Ubuntu', memBytes, cpu, flags = [], repo, loadEveryMs = 5000, limitSecs }) {
  const dir = mkdtempSync(join(tmpdir(), 'otb-cg-'));
  const winDir = longPath(dir);
  const outDir = wslPath(winDir);
  const name = 'run-' + process.pid + '-' + Date.now().toString(36);
  const script = join(winDir, 'host.sh');
  const stop = join(winDir, 'stop.sh');
  try {
    writeFileSync(script, hostScript({ name, memBytes, cpu, repo: wslPath(longPath(repo)), outDir, nightFile: '/tmp/otb-night-' + name + '.json', flags, loadEveryMs, limitSecs }));
    writeFileSync(stop, stopScript({ outDir }));
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });   // a setting the script refuses must not leave its directory behind
    throw e;
  }
  const wsl = (...argv) => spawn('wsl.exe', ['-d', distro, '-u', 'root', '-e', ...argv], { stdio: ['ignore', 'pipe', 'pipe'] });
  const relay = wsl('sh', wslPath(script));
  const out = [];
  let port = null;
  const onData = (d) => {
    const s = String(d);
    out.push(s);
    const m = s.match(/localhost:(\d+)/);
    if (m && port === null) port = Number(m[1]);
  };
  relay.stdout.on('data', onData);
  relay.stderr.on('data', onData);
  let exited = false;
  relay.on('exit', () => { exited = true; });
  relay.on('error', (e) => { out.push('could not run wsl.exe: ' + e.message); exited = true; });

  const read = (file) => { try { return readFileSync(join(winDir, file), 'utf8'); } catch { return ''; } };
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  const fail = (why) => { cleanup(); throw new Error(why + '\n' + out.join('')); };

  // A stopped distro takes a few seconds to start, and the relay a few more to say its port.
  const give = Date.now() + 60_000;
  while (port === null && !exited && Date.now() < give) await new Promise((r) => setTimeout(r, 100));
  if (port === null) { relay.kill(); fail(exited ? 'the relay did not start in the cgroup' : 'the relay never said its port'); }
  // Said is not reachable: wait until Windows can reach it.
  let reached = false;
  for (const end = Date.now() + 15_000; !reached && !exited && Date.now() < end;) {
    try { await fetch('http://127.0.0.1:' + port + '/', { signal: AbortSignal.timeout(1000) }); reached = true; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  if (!reached) { relay.kill(); fail('the relay said port ' + port + ' but Windows could not reach it'); }

  return {
    relay, port, out,
    /** Ask the relay to write the night and go; after six seconds, make it. Resolves when the script has left its readings. */
    async stop() {
      const done = new Promise((r) => { if (exited) r(); else relay.on('exit', r); });
      for (const how of ['INT', 'KILL']) {
        if (exited) break;
        await new Promise((r) => { const c = wsl('sh', wslPath(stop), how); c.on('exit', r); c.on('error', r); });
        await Promise.race([done, new Promise((r) => setTimeout(r, 6000))]);
      }
      if (!exited) relay.kill();   // the script is out of reach: leave it to its own time limit rather than wait for ever
    },
    /** What the kernel counted; read after stop(). */
    stats: () => readStats({ peak: read('peak'), events: read('events'), cpuStat: read('cpu.stat'), code: read('code') }),
    cleanup,
  };
}
