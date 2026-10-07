// ON THE BEAT — will the image build and start? The part of `fly deploy` that can be tried without Docker.
//
//   npm run image-check
//
// Fly builds the Dockerfile on a remote builder, so a mistake in what the image is given only shows after a deploy has
// started: a folder .dockerignore does not let through, a relay file that imports something the runtime stage does not
// copy, a variable fly.toml sets that the relay no longer reads. This rebuilds the image's trees from the Dockerfile's own
// COPY lines and .dockerignore's own list, in a temporary folder:
//
//   build tree   what the build stage copies, with `vite build` run in it
//   run tree     what the runtime stage copies (and dist/ from the build tree), with only the production dependencies
//
// then starts the relay from the run tree under fly.toml's own [env] (the volume's paths moved into the tree, the port
// to any free one) and runs `npm run preflight`'s checks against it. The repository is only read: node_modules
// is joined into the trees, never copied or changed (vite's own transient config file in node_modules/.vite-temp aside).
//
// What it cannot see, and Fly's build still can fail on: `npm ci` itself (it checks the lock file against package.json
// and the registry), the base image, setpriv, and the volume's ownership. Exit 0 when nothing failed, 1 when something
// did, 2 for an argument it does not take.

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from './preflight.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The names .dockerignore lets through: its `!name` lines. Everything else is kept out by its leading `*`. */
export function parseDockerignore(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const rules = lines.filter((l) => l && !l.startsWith('#'));
  return { denyAll: rules[0] === '*', allow: rules.filter((l) => l.startsWith('!')).map((l) => l.slice(1)) };
}

/**
 * The stages of a Dockerfile, each with the COPY lines it runs: `{ from: 'build' | null, sources, dest }`. A COPY with
 * --from takes its sources out of an earlier stage; any other takes them out of the folder the build was sent.
 */
export function parseDockerfile(text) {
  const stages = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const stage = /^FROM\s+\S+(?:\s+AS\s+(\S+))?\s*$/i.exec(line);
    if (stage) { stages.push({ name: stage[1] ?? null, copies: [] }); continue; }
    const copy = /^COPY\s+(.*)$/i.exec(line);
    if (!copy || !stages.length) continue;
    const words = copy[1].trim().split(/\s+/);
    let from = null;
    while (words[0]?.startsWith('--')) {
      const flag = /^--from=(.+)$/.exec(words.shift());
      if (flag) from = flag[1];
    }
    const dest = words.pop();
    stages.at(-1).copies.push({ from, sources: words, dest });
  }
  return stages;
}

/**
 * What goes in each tree. `build`: the sent files the build stage copies. `run`: the sent files the last stage copies.
 * `fromBuild`: what the last stage takes out of the build stage. `problems`: a copy of anything .dockerignore does not
 * let through, or that is not in the repository: either is a build that fails on Fly at that line.
 */
export function imagePlan(dockerfile, dockerignore, { root = ROOT } = {}) {
  const stages = parseDockerfile(dockerfile);
  const ignore = parseDockerignore(dockerignore);
  const problems = [];
  if (stages.length < 2) problems.push('the Dockerfile has ' + stages.length + ' stage(s), not a build stage and a runtime stage');
  if (!ignore.denyAll) problems.push('.dockerignore does not start by keeping everything out (*), so what it lets through proves nothing');
  const sent = (copies) => {
    const names = [];
    for (const c of copies.filter((x) => x.from === null)) {
      for (const source of c.sources) {
        const name = source.replace(/^\.\//, '').replace(/\/+$/, '');
        if (!ignore.allow.includes(name)) problems.push('COPY ' + name + ': .dockerignore does not let it through');
        else if (!existsSync(join(root, name))) problems.push('COPY ' + name + ': there is no such file or folder in the repository');
        else names.push(name);
      }
    }
    return names;
  };
  const build = stages[0] ? sent(stages[0].copies) : [];
  const last = stages.at(-1);
  const run = last && stages.length > 1 ? sent(last.copies) : [];
  const fromBuild = (last?.copies ?? []).filter((c) => c.from !== null).flatMap((c) => c.sources.map((s) => ({
    stage: c.from, source: s.replace(/^\/app\//, '').replace(/\/+$/, ''), dest: c.dest.replace(/^\.\//, '').replace(/\/+$/, ''),
  })));
  return { build, run, fromBuild, problems };
}

/** fly.toml's [env] as an object: every `NAME = "value"` line between [env] and the next table. */
export function flyEnv(toml) {
  const block = (toml.split(/^\[env\]\s*$/m)[1] ?? '').split(/^\s*\[/m)[0];
  const env = {};
  for (const line of block.split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*"([^"]*)"\s*(?:#.*)?$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

/** What the lock file's root entry says against package.json, as the sentences npm ci would fail on. */
export function lockProblems(pkg, lock) {
  const root = lock?.packages?.[''];
  if (!root) return ['package-lock.json has no root entry'];
  const out = [];
  for (const kind of ['dependencies', 'devDependencies']) {
    const want = pkg[kind] ?? {};
    const have = root[kind] ?? {};
    for (const [name, spec] of Object.entries(want)) {
      if (!(name in have)) out.push(name + ' (' + kind + ') is in package.json and not in the lock file');
      else if (have[name] !== spec) out.push(name + ': package.json says ' + spec + ', the lock file says ' + have[name]);
    }
    for (const name of Object.keys(have)) if (!(name in want)) out.push(name + ' (' + kind + ') is in the lock file and not in package.json');
  }
  return out;
}

/** Each `file:` dependency's path, which the build stage must have been sent for npm ci to find it. */
export function localDependencies(pkg) {
  return Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('file:'))
    .map(([name, spec]) => ({ name, path: spec.slice(5) }));
}

/** Join a folder into a tree without copying it: a junction on Windows (no privilege needed), a symlink elsewhere. */
function joinFolder(target, link) {
  symlinkSync(target, link, 'junction');
}

/** Remove a joined folder, itself and never what it points at. */
function unjoin(link) {
  if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(link);
}

const listing = (dir) => readdirSync(dir, { recursive: true }).map((p) => String(p).replace(/\\/g, '/')).sort();
const tail = (text, n = 600) => String(text ?? '').trim().slice(-n);
/** What a relay that would not start said: its first error line (Node's stack comes after it), else the last of what it said. */
const why = (lines) => (lines.find((l) => /^(?:\w+)?Error\b/.test(l)) ?? tail(lines.join(' | '))).slice(0, 400);

/** `vite build` in `cwd`, as { status, output }; status is null when it did not finish in two minutes. */
function vite(cwd, extra = []) {
  const bin = join(cwd, 'node_modules', 'vite', 'bin', 'vite.js');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, 'build', ...extra], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const timer = setTimeout(() => child.kill(), 120_000);
    child.once('error', (e) => { clearTimeout(timer); resolve({ status: null, output: String(e) }); });
    child.once('close', (code) => { clearTimeout(timer); resolve({ status: code, output }); });
  });
}

/** Where fly.toml mounts its volume (/data), or null when it mounts none. */
export function flyVolume(toml) {
  const block = (toml.split(/^\[mounts\]\s*$/m)[1] ?? '').split(/^\s*\[/m)[0];
  return /^\s*destination\s*=\s*"([^"]+)"\s*$/m.exec(block)?.[1] ?? null;
}

/**
 * The environment the relay gets on Fly: only fly.toml's [env] (NODE_ENV from the image), and none of this shell's. The
 * volume is a folder of the run tree here, and so is any other absolute path a variable names, so that nothing the relay
 * writes can land outside the temporary folder whatever fly.toml says.
 */
function relayEnv(flyVars, volume, dataDir) {
  const env = { NODE_ENV: 'production' };
  for (const k of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP']) if (process.env[k]) env[k] = process.env[k];
  Object.assign(env, flyVars);
  env.PORT = '0';
  for (const [k, v] of Object.entries(flyVars)) {
    if (!v.startsWith('/')) continue;
    env[k] = volume && v.startsWith(volume + '/') ? join(dataDir, v.slice(volume.length + 1)) : join(dataDir, 'off-volume-' + basename(v));
  }
  env.LOAD_EVERY_MS = '0';
  return env;
}

/**
 * Every step, in the order Fly's would run. `root` is the repository (its Dockerfile, .dockerignore, fly.toml, app/,
 * relay/ ...). Returns { ok, steps: [{ name, status: 'ok' | 'fail' | 'note', detail }] }; the temporary folder is gone
 * when it returns, however it ended.
 */
export async function imageCheck({ root: given = ROOT } = {}) {
  const steps = [];
  const step = (name, status, detail) => { steps.push({ name, status, detail }); return status !== 'fail'; };
  // Long paths, both: a Windows temp folder can come as an 8.3 short name (C:\Users\ABCDEF~1\...), and
  // vite, which resolves some files to the long name, then failed to build with a "../../ABCDEF~1" asset name.
  // It came and went from run to run (7 Oct 2026).
  const root = realpathSync.native(given);
  const stage = realpathSync.native(mkdtempSync(join(tmpdir(), 'otb-image-')));
  const joined = [];
  let relay = null;
  try {
    const read = (f) => readFileSync(join(root, f), 'utf8');
    const plan = imagePlan(read('Dockerfile'), read('.dockerignore'), { root });
    if (plan.problems.length) { step('image files', 'fail', plan.problems.join('; ')); return finish(steps); }
    step('image files', 'ok', 'build stage ' + plan.build.join(', ') + '; runtime stage ' + plan.run.join(', ') + (plan.fromBuild.length ? ' and ' + plan.fromBuild.map((c) => c.source).join(', ') + ' from the build' : ''));

    // 1. The lock file npm ci reads, and the local tarballs it installs from.
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    const lockBad = lockProblems(pkg, lock);
    const missing = localDependencies(pkg).filter((d) => !plan.build.some((n) => d.path === n || d.path.startsWith(n + '/'))
      || !plan.run.some((n) => d.path === n || d.path.startsWith(n + '/')));
    if (lockBad.length) step('lock file', 'fail', lockBad.join('; '));
    else if (missing.length) step('lock file', 'fail', missing.map((d) => d.name + ' installs from ' + d.path + ', which a stage does not copy').join('; '));
    else step('lock file', 'ok', 'package-lock.json agrees with package.json; the local tarballs are copied');

    // 2. The build stage: its files, vite build, and the same build of the repository itself.
    const buildTree = join(stage, 'build');
    mkdirSync(buildTree);
    for (const name of plan.build) await cp(join(root, name), join(buildTree, name), { recursive: true });
    joinFolder(join(root, 'node_modules'), join(buildTree, 'node_modules'));
    joined.push(join(buildTree, 'node_modules'));
    const built = await vite(buildTree);
    if (built.status !== 0 || !existsSync(join(buildTree, 'dist', 'index.html'))) {
      step('build', 'fail', 'vite build in the build stage\'s files ' + (built.status === null ? 'did not finish' : 'exited ' + built.status) + ': ' + tail(built.output));
      return finish(steps);
    }
    const reference = join(stage, 'reference');
    const again = await vite(root, ['--outDir', reference, '--emptyOutDir']);
    if (again.status !== 0) { step('build', 'fail', 'vite build of the repository itself exited ' + again.status + ': ' + tail(again.output)); return finish(steps); }
    const a = listing(join(buildTree, 'dist')), b = listing(reference);
    const onlyImage = a.filter((x) => !b.includes(x)), onlyRepo = b.filter((x) => !a.includes(x));
    if (onlyImage.length || onlyRepo.length) {
      step('build', 'fail', 'the build stage\'s dist differs from the repository\'s own: only in the image ' + (onlyImage.join(', ') || 'none') + '; only in the repository ' + (onlyRepo.join(', ') || 'none'));
    } else step('build', 'ok', 'vite build in the build stage\'s files gives the same ' + a.length + ' files as the repository\'s own');

    // 3. The runtime stage: its files, dist from the build stage, and only the production dependencies joined in.
    const runTree = join(stage, 'run');
    mkdirSync(runTree);
    for (const name of plan.run) await cp(join(root, name), join(runTree, name), { recursive: true });
    for (const c of plan.fromBuild) await cp(join(buildTree, c.source), join(runTree, c.dest), { recursive: true });
    mkdirSync(join(runTree, 'node_modules'));
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      const link = join(runTree, 'node_modules', name);
      mkdirSync(join(link, '..'), { recursive: true });
      joinFolder(join(root, 'node_modules', name), link);
      joined.push(link);
    }

    // 4. fly.toml's variables: that the relay still reads each, and that the port is the one Fly sends to.
    const toml = read('fly.toml');
    const vars = flyEnv(toml);
    const source = readdirSync(join(root, 'relay')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(root, 'relay', f), 'utf8')).join('\n');
    const unread = Object.keys(vars).filter((k) => !new RegExp('process\\.env\\.' + k + '\\b').test(source));
    const internal = /^\s*internal_port\s*=\s*(\d+)\s*$/m.exec(toml)?.[1];
    if (unread.length) step('fly.toml', 'fail', 'sets ' + unread.join(', ') + ', which nothing in relay/ reads');
    else if (!vars.PORT || vars.PORT !== internal) step('fly.toml', 'fail', 'PORT is ' + (vars.PORT ?? 'not set') + ' but internal_port is ' + (internal ?? 'not set'));
    else step('fly.toml', 'ok', Object.keys(vars).join(', ') + ' are all read by the relay; PORT is the internal port, ' + internal);

    // 5. The relay, started from the run tree as Fly starts it.
    const volume = flyVolume(toml);
    const dataDir = join(runTree, 'data');
    mkdirSync(dataDir);
    const env = relayEnv(vars, volume, dataDir);
    const lines = [];
    let port = null;
    relay = spawn(process.execPath, ['relay/server.js'], { cwd: runTree, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (d) => {
      for (const l of String(d).split(/\r?\n/)) {
        if (!l) continue;
        lines.push(l);
        const m = /relay on http:\/\/localhost:(\d+)\//.exec(l);
        if (m) port = Number(m[1]);
      }
    };
    relay.stdout.on('data', onData);
    relay.stderr.on('data', onData);
    const t0 = Date.now();
    while (port === null && relay.exitCode === null && Date.now() - t0 < 15_000) await new Promise((r) => setTimeout(r, 50));
    if (port === null) { step('start', 'fail', 'the relay did not come up from the run tree' + (relay.exitCode === null ? ' in 15 s' : ' (exit ' + relay.exitCode + ')') + ': ' + why(lines)); return finish(steps); }
    step('start', 'ok', 'the relay came up from the run tree on port ' + port + ' in ' + (Date.now() - t0) + ' ms');

    // 6. Preflight's own checks against it, then the files on the "volume".
    const result = await preflight('http://localhost:' + port, { timeoutMs: 15_000 });
    const bad = result.checks.filter((c) => c.status === 'fail');
    if (bad.length) step('preflight', 'fail', bad.map((c) => c.name + ': ' + c.detail).join('; '));
    else step('preflight', 'ok', result.checks.length + ' checks, none failed');
    const off = ['NIGHT_FILE', 'PUSH_KEYS_FILE'].filter((k) => !vars[k]?.startsWith((volume ?? '/data') + '/'));
    if (!volume) step('volume files', 'fail', 'fly.toml mounts no volume');
    else if (off.length) step('volume files', 'fail', off.map((k) => k + ' is ' + (vars[k] ?? 'not set') + ', not on the volume at ' + volume).join('; '));
    else if (!existsSync(env.PUSH_KEYS_FILE)) step('volume files', 'fail', 'the relay did not write its push keys where PUSH_KEYS_FILE says');
    else step('volume files', 'ok', 'NIGHT_FILE and PUSH_KEYS_FILE are on the volume at ' + volume + ', and the push keys were written there');
    return finish(steps);
  } catch (e) {
    step('image check', 'fail', 'stopped by ' + (e?.stack ?? e));
    return finish(steps);
  } finally {
    if (relay && relay.exitCode === null) {
      relay.kill();
      await new Promise((r) => { relay.once('exit', r); setTimeout(r, 3000).unref(); });
    }
    // A joined folder goes first, itself, so removing the tree can never reach what it points at.
    for (const link of joined.reverse()) { try { unjoin(link); } catch { /* the removal below says if it matters */ } }
    // Windows can hold a folder a just-ended build or relay was in for a moment (EBUSY): rm retries those.
    await rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

const finish = (steps) => ({ ok: !steps.some((s) => s.status === 'fail'), steps });

/** The result as lines a person reads. */
export function report({ ok, steps }) {
  const width = Math.max(...steps.map((s) => s.name.length));
  const lines = ['Image check, without Docker', ''];
  for (const s of steps) lines.push('  ' + s.status.padEnd(4) + '  ' + s.name.padEnd(width) + '  ' + s.detail);
  const fails = steps.filter((s) => s.status === 'fail').length;
  lines.push('', ok ? 'IMAGE LOOKS RIGHT' : 'IMAGE WOULD FAIL: ' + fails + ' step' + (fails === 1 ? '' : 's') + ' failed');
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  if (process.argv.length > 2) {
    console.error('usage: npm run image-check   (it takes no arguments)');
    process.exit(2);
  }
  // IMAGE_CHECK_ROOT is for tests: the folder to check in place of this repository.
  const result = await imageCheck({ root: process.env.IMAGE_CHECK_ROOT || ROOT });
  console.log(report(result));
  process.exitCode = result.ok ? 0 : 1;
}
