// ON THE BEAT — the image check (scripts/image-check.mjs): `npm run image-check` builds the Docker image's two trees from
// the Dockerfile's own COPY lines and .dockerignore's own list, in a temporary folder, and starts the relay from the
// runtime tree. The parsing is tested as text; the whole check runs against this repository, and against copies of it with
// one mistake each, which is the proof that the check can fail: a Fly build that is wrong only says so after a deploy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flyEnv, flyVolume, imageCheck, imagePlan, localDependencies, lockProblems, parseDockerfile, parseDockerignore, report } from '../scripts/image-check.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const leftovers = () => readdirSync(tmpdir()).filter((n) => n.startsWith('otb-image-'));

test('.dockerignore is read as a list of what is let through, after keeping everything out', () => {
  const real = parseDockerignore(read('.dockerignore'));
  assert.equal(real.denyAll, true);
  assert.deepEqual(real.allow, ['package.json', 'package-lock.json', 'vendor', 'vite.config.js', 'app', 'relay']);
  assert.deepEqual(parseDockerignore('# only comments\n\n*\n!a\n# !b\n  !c  \n'), { denyAll: true, allow: ['a', 'c'] });
  assert.equal(parseDockerignore('!a\n*\n').denyAll, false, 'a leading allow-rule means nothing is kept out first');
  assert.equal(parseDockerignore('').denyAll, false);
});

test('a Dockerfile is read as stages, each with the copies it makes and where from', () => {
  const stages = parseDockerfile(read('Dockerfile'));
  assert.equal(stages.length, 2);
  assert.equal(stages[0].name, 'build');
  assert.equal(stages[1].name, null);
  assert.deepEqual(stages[0].copies.map((c) => c.sources), [['package.json', 'package-lock.json'], ['vendor'], ['vite.config.js'], ['app'], ['relay']]);
  assert.deepEqual(stages[1].copies.at(-1), { from: 'build', sources: ['/app/dist'], dest: './dist' });
  assert.ok(stages[1].copies.slice(0, -1).every((c) => c.from === null));

  const odd = parseDockerfile('from node:24 as one\n  copy --chown=a:b x y ./z\nRUN true\nFROM scratch\nCOPY --from=one /a/b/ /c/\n');
  assert.deepEqual(odd, [
    { name: 'one', copies: [{ from: null, sources: ['x', 'y'], dest: './z' }] },
    { name: null, copies: [{ from: 'one', sources: ['/a/b/'], dest: '/c/' }] },
  ]);
});

test('the image plan is each stage\'s copies, and a copy that .dockerignore or the repository cannot supply is a problem', () => {
  const plan = imagePlan(read('Dockerfile'), read('.dockerignore'));
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.build, ['package.json', 'package-lock.json', 'vendor', 'vite.config.js', 'app', 'relay']);
  assert.deepEqual(plan.run, ['package.json', 'package-lock.json', 'vendor', 'relay']);
  assert.deepEqual(plan.fromBuild, [{ stage: 'build', source: 'dist', dest: 'dist' }]);

  const dockerfile = 'FROM a AS build\nCOPY app ./app\nCOPY secrets ./secrets\nFROM b\nCOPY relay ./relay\nCOPY --from=build /app/dist ./dist\n';
  const only = imagePlan(dockerfile, '*\n!app\n!relay\n', { root: ROOT });
  assert.deepEqual(only.problems, ['COPY secrets: .dockerignore does not let it through']);
  assert.deepEqual(only.build, ['app'], 'the rest of the copies are still planned');
  const gone = imagePlan('FROM a\nCOPY nowhere ./n\nFROM b\nCOPY relay ./relay\n', '*\n!nowhere\n!relay\n', { root: ROOT });
  assert.deepEqual(gone.problems, ['COPY nowhere: there is no such file or folder in the repository']);
  assert.match(imagePlan('FROM a\nCOPY app ./app\n', '*\n!app\n').problems[0], /1 stage\(s\), not a build stage and a runtime stage/);
  assert.match(imagePlan(read('Dockerfile'), '!app\n').problems.join(';'), /does not start by keeping everything out/);
});

test('fly.toml\'s [env] is read as it stands, comments and other tables aside', () => {
  const real = flyEnv(read('fly.toml'));
  assert.equal(real.PORT, '8080');
  assert.equal(real.NIGHT_FILE, '/data/night.json');
  assert.equal(real.PUSH_KEYS_FILE, '/data/push-keys.json');
  assert.equal(real.CLIENT_IP_HEADER, 'fly-client-ip');
  assert.ok(!('source' in real) && !('destination' in real) && !('size' in real), 'nothing from the tables after it');
  const odd = flyEnv('app = "x"\nOUTSIDE = "no"\n[env]\n  A = "1"\n  # B = "2"\n  C = "has # hash"   # and a comment\n  d = "lower"\n[mounts]\n  E = "no"\n[[vm]]\n  F = "no"\n');
  assert.deepEqual(odd, { A: '1', C: 'has # hash' });
  assert.deepEqual(flyEnv('app = "x"\n'), {});
});

test('the volume is where fly.toml says it mounts it', () => {
  assert.equal(flyVolume(read('fly.toml')), '/data');
  const mounted = ['[env]', '  A = "1"', '[mounts]', '  source = "night"', '  destination = "/mnt/x"   ', '[[vm]]', '  destination = "no"', ''].join('\n');
  assert.equal(flyVolume(mounted), '/mnt/x', 'the mounts table\'s destination, and no other table\'s');
  assert.equal(flyVolume(['[env]', '  destination = "no"', ''].join('\n')), null);
  assert.equal(flyVolume(''), null);
});

test('the lock file is held to package.json the way npm ci holds it', () => {
  assert.deepEqual(lockProblems(JSON.parse(read('package.json')), JSON.parse(read('package-lock.json'))), []);
  const lock = { packages: { '': { dependencies: { a: '^1', b: '2', old: '1' }, devDependencies: { v: '^3' } } } };
  const pkg = { dependencies: { a: '^1', b: '3', c: '1' }, devDependencies: { v: '^3', w: '1' } };
  assert.deepEqual(lockProblems(pkg, lock), [
    'b: package.json says 3, the lock file says 2',
    'c (dependencies) is in package.json and not in the lock file',
    'old (dependencies) is in the lock file and not in package.json',
    'w (devDependencies) is in package.json and not in the lock file',
  ]);
  assert.deepEqual(lockProblems({}, {}), ['package-lock.json has no root entry']);
});

test('a local tarball is a dependency whose spec starts with file:', () => {
  assert.deepEqual(localDependencies(JSON.parse(read('package.json'))), [{ name: 'jsqr', path: 'vendor/jsqr-1.4.0.tgz' }]);
  assert.deepEqual(localDependencies({ dependencies: { a: '^1', b: 'file:vendor/b.tgz' }, devDependencies: { c: 'file:x/c' } }),
    [{ name: 'b', path: 'vendor/b.tgz' }, { name: 'c', path: 'x/c' }]);
  assert.deepEqual(localDependencies({}), []);
});

test('the report is one line a step and ends in a verdict', () => {
  const ok = report({ ok: true, steps: [{ name: 'one', status: 'ok', detail: 'fine' }, { name: 'second', status: 'note', detail: 'hm' }] });
  assert.match(ok, /^Image check, without Docker\n/);
  assert.match(ok, /\n {2}ok {4}one {5}fine\n {2}note {2}second {2}hm\n/);
  assert.match(ok, /\nIMAGE LOOKS RIGHT$/);
  const bad = report({ ok: false, steps: [{ name: 'a', status: 'fail', detail: 'x' }, { name: 'b', status: 'fail', detail: 'y' }] });
  assert.match(bad, /\nIMAGE WOULD FAIL: 2 steps failed$/);
  assert.match(report({ ok: false, steps: [{ name: 'a', status: 'fail', detail: 'x' }] }), /1 step failed$/);
});


const STEPS = ['image files', 'lock file', 'build', 'fly.toml', 'start', 'preflight', 'volume files'];

test('the image check passes on this repository, step by step, and leaves its node_modules alone', async () => {
  const modules = readdirSync(join(ROOT, 'node_modules')).length;
  const result = await REAL;
  assert.deepEqual(result.steps.map((s) => s.name), STEPS);
  assert.deepEqual(result.steps.filter((s) => s.status !== 'ok'), []);
  assert.equal(result.ok, true);
  assert.equal(readdirSync(join(ROOT, 'node_modules')).length, modules, 'the repository\'s node_modules was only joined in, never touched');
  for (const dep of ['ws', 'vite', 'react']) assert.ok(existsSync(join(ROOT, 'node_modules', dep, 'package.json')), dep + ' is still there');
});

/**
 * A copy of the files the image is made from, with node_modules joined in, and `edits` applied: { path: (text) => text },
 * to the text with LF line ends (the repository's own, whatever this checkout has). Returns the folder and a function that
 * removes it, the join first, so removing it can never reach the real node_modules.
 */
function copyOfRepo(edits = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'otb-copy-'));
  for (const name of ['Dockerfile', '.dockerignore', 'fly.toml', 'package.json', 'package-lock.json', 'vendor', 'vite.config.js', 'app', 'relay']) {
    cpSync(join(ROOT, name), join(dir, name), { recursive: true });
  }
  for (const [path, edit] of Object.entries(edits)) {
    const before = existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8').replace(/\r\n/g, '\n') : '';
    const after = edit(before);
    assert.notEqual(after, before, 'the edit to ' + path + ' changed nothing');
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), after);
  }
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'junction');
  return {
    dir,
    remove: () => {
      if (lstatSync(join(dir, 'node_modules'), { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(join(dir, 'node_modules'));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The steps that fail when the image check runs on a copy of the repository with `edits`, as { ok, failed: { name: detail } }. */
async function failures(edits) {
  const copy = copyOfRepo(edits);
  try {
    const result = await imageCheck({ root: copy.dir });
    return { ok: result.ok, failed: Object.fromEntries(result.steps.filter((s) => s.status === 'fail').map((s) => [s.name, s.detail])) };
  } finally { copy.remove(); }
}

// Each run builds twice and starts a relay, about four seconds: they are started together, three at a time, and each
// test below waits for its own.
const slots = { free: 3, waiting: [] };
async function slot(fn) {
  while (slots.free === 0) await new Promise((r) => slots.waiting.push(r));
  slots.free--;
  try { return await fn(); } finally { slots.free++; slots.waiting.shift()?.(); }
}
const started = [];
const run = (edits) => {
  const p = slot(() => failures(edits));
  p.catch(() => {}); // said by the test that awaits it, not as an unhandled rejection before it gets there
  started.push(p);
  return p;
};

const REAL = slot(() => imageCheck());
REAL.catch(() => {});
started.push(REAL);

const RUNS = {
  none: run({}),
  dockerignore: run({ '.dockerignore': (t) => t.replace('!relay\n', '') }),
  noApp: run({ Dockerfile: (t) => t.replace('COPY app ./app\n', '') }),
  stray: run({ 'relay/server.js': (t) => "import '../app/lib/net.js';\n" + t }),
  devDep: run({ 'relay/server.js': (t) => "import 'vite';\n" + t }),
  unread: run({ 'fly.toml': (t) => t.replace('NIGHT_TZ = ', 'NIGHT_TZONE = ') }),
  port: run({ 'fly.toml': (t) => t.replace('internal_port = 8080', 'internal_port = 8081') }),
  // After ws's line, whatever version it is at: Dependabot moves it, and a pinned string here would stop matching.
  lock: run({ 'package.json': (t) => t.replace(/"ws": "[^"]+"/, (ws) => ws + ',\n    "left-pad": "1.3.0"') }),
  vendorBuild: run({ Dockerfile: (t) => t.replace('COPY vendor ./vendor\n', '') }),
  vendorRun: run({ Dockerfile: (t) => t.slice(0, t.lastIndexOf('COPY vendor ./vendor\n')) + t.slice(t.lastIndexOf('COPY vendor ./vendor\n') + 'COPY vendor ./vendor\n'.length) }),
  noDist: run({ Dockerfile: (t) => t.replace('COPY --from=build /app/dist ./dist\n', '') }),
  publicDir: run({ 'vite.config.js': (t) => t.replace("root: 'app',", "root: 'app',\n  publicDir: '../public',"), 'public/robots.txt': () => 'User-agent: *\n' }),
  badJson: run({ 'package.json': (t) => t.slice(0, 40) }),
  keys: run({ 'fly.toml': (t) => t.replace('PUSH_KEYS_FILE = "/data/push-keys.json"', 'PUSH_KEYS_FILE = "/tmp/push-keys.json"') }),
};

test('a copy of the repository with no edits passes too, so each failure below is its edit and nothing else', async () => {
  assert.deepEqual(await RUNS.none, { ok: true, failed: {} });
});

test('a folder .dockerignore stops letting through fails the check at once, naming it', async () => {
  const r = await RUNS.dockerignore;
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.failed), ['image files']);
  assert.match(r.failed['image files'], /COPY relay: \.dockerignore does not let it through/);
});

test('a build stage that no longer copies app/ fails at the build, not at some later step', async () => {
  const r = await RUNS.noApp;
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.failed), ['build']);
  assert.match(r.failed.build, /vite build in the build stage's files exited 1/);
});

test('a relay file that imports a folder the runtime stage does not copy fails to start there', async () => {
  const r = await RUNS.stray;
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.failed), ['start']);
  assert.match(r.failed.start, /^the relay did not come up from the run tree \(exit 1\): .*ERR_MODULE_NOT_FOUND/);
});

test('a relay that imports a development dependency fails to start in the production install', async () => {
  const r = await RUNS.devDep;
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.failed), ['start']);
  assert.match(r.failed.start, /Cannot find package 'vite'/);
});

test('a variable fly.toml sets and the relay no longer reads fails the check', async () => {
  const r = await RUNS.unread;
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.failed), ['fly.toml']);
  assert.match(r.failed['fly.toml'], /sets NIGHT_TZONE, which nothing in relay\/ reads/);
});

test('a PORT that is not the internal port fails the check', async () => {
  const r = await RUNS.port;
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.failed), ['fly.toml']);
  assert.match(r.failed['fly.toml'], /PORT is 8080 but internal_port is 8081/);
});

test('a dependency added to package.json and not to the lock file fails the check', async () => {
  const r = await RUNS.lock;
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.failed), ['lock file']);
  assert.match(r.failed['lock file'], /left-pad \(dependencies\) is in package\.json and not in the lock file/);
});

test('a vendor folder the build stage does not copy is named at the lock step, where npm ci would have failed', async () => {
  const r = await RUNS.vendorBuild;
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.failed), ['lock file']);
  assert.match(r.failed['lock file'], /^jsqr installs from vendor\/jsqr-1\.4\.0\.tgz, which a stage does not copy$/);
});

test('a vendor folder the runtime stage does not copy is named too', async () => {
  const r = await RUNS.vendorRun;
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.failed), ['lock file']);
  assert.match(r.failed['lock file'], /^jsqr installs from vendor\/jsqr-1\.4\.0\.tgz, which a stage does not copy$/);
});

test('a runtime stage that forgets dist/ comes up with no app, and preflight says so', async () => {
  const r = await RUNS.noDist;
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.failed), ['preflight']);
  assert.match(r.failed.preflight, /app opens: GET \/ answered 503/);
});

test('a file the build reads from a folder the image is not given shows as a difference in dist', async () => {
  // A static folder outside app/ (vite's publicDir): .dockerignore keeps it out, so the repository's own build has a file the image's lacks,
  // and vite does not fail on a folder that is not there.
  const r = await RUNS.publicDir;
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.failed), ['build']);
  assert.match(r.failed.build, /only in the image none; only in the repository robots\.txt$/);
});

test('a file the check cannot read stops it with the reason, and still cleans up', async () => {
  const r = await RUNS.badJson;
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.failed), ['image check']);
  assert.match(r.failed['image check'], /^stopped by SyntaxError/);
});

test('a push-keys file that is not on the volume fails the check, and the relay still writes nowhere outside the folder', async () => {
  const r = await RUNS.keys;
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.failed), ['volume files']);
  assert.match(r.failed['volume files'], /^PUSH_KEYS_FILE is \/tmp\/push-keys\.json, not on the volume at \/data$/);
  assert.ok(!existsSync('/tmp/push-keys.json') && !existsSync('C:/tmp/push-keys.json'), 'what the relay wrote went into the temporary folder, not where fly.toml said');
});

test('npm run image-check takes no argument, says IMAGE LOOKS RIGHT and exits 0 here', () => {
  const refused = spawnSync(process.execPath, ['scripts/image-check.mjs', '--keep'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /usage: npm run image-check/);
  const ran = spawnSync(process.execPath, ['scripts/image-check.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /\nIMAGE LOOKS RIGHT\n$/);
});

test('the command exits 1 and says the image would fail when a step fails', () => {
  const copy = copyOfRepo({ '.dockerignore': (t) => t.replace('!relay\n', '') });
  try {
    const ran = spawnSync(process.execPath, ['scripts/image-check.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, IMAGE_CHECK_ROOT: copy.dir } });
    assert.equal(ran.status, 1, ran.stdout + ran.stderr);
    assert.match(ran.stdout, /\nIMAGE WOULD FAIL: 1 step failed\n$/);
  } finally { copy.remove(); }
});

test('it leaves no temporary folder behind, after a failure either', async () => {
  await Promise.allSettled(started);
  assert.deepEqual(leftovers(), []);
  assert.deepEqual(readdirSync(tmpdir()).filter((n) => n.startsWith('otb-copy-')), []);
});
