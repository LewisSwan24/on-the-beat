// ON THE BEAT — mutation checks, with a restore that cannot fail quietly.
//
//   node scripts/mutate.mjs mutations.json
//
// The project's discipline is that every guard has a test that goes red when the guard is broken. This applies the
// breaks. mutations.json is a list of { name, file, from, to, tests: [test files], pattern? } — `from` must appear in
// `file` exactly once, `pattern` narrows node's --test-name-pattern. Each one is applied, the tests are run, and the
// file is put back: KILLED when a test failed, SURVIVED when none did.
//
// It exists because of 2 Oct 2026: a restore threw on Windows (the file was busy for a moment), the old script died
// with the mutant on disk, a later run took the mutant for the original, and the mutated line was committed and
// deployed. So: files are handled as bytes, not text; every restore is retried and then read back and compared to
// the file as it was before the run began; a file that cannot be put back stops the run at once, loudly, with the
// pristine copy's location; and a final pass checks every file again. Exit 0 when every file is back as it was, 2 when
// one is not, 1 for a bad list. A survivor is not a failure of the tool; the count is said at the end.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const RESTORE_TRIES = 10;
const RESTORE_WAIT_MS = 150;

const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Run one mutation's tests with node's runner: the number of failures, or NaN when node said nothing it could be read from. */
export function runTests(root, m) {
  const args = ['--test'];
  if (m.pattern) args.push('--test-name-pattern=' + m.pattern);
  args.push(...m.tests);
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 240_000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const failed = [...new Set([...out.matchAll(/^\s*✖ (.+?) \(/gm)].map((x) => x[1]))];
  return { fail: Number(/ℹ fail (\d+)/.exec(out)?.[1] ?? NaN), failed };
}

/**
 * Apply every mutation in `list` under `root`, one at a time. `run(m)` says how many tests failed; `write` and `read` are
 * the file system, so a test can make it fail. Returns { results, survivors, leftMutated } — leftMutated is empty
 * when every file is exactly as it was.
 */
export function mutate({ root, list, run = (m) => runTests(root, m), read = readFileSync, write = writeFileSync, say = console.log, retryWaitMs = RESTORE_WAIT_MS }) {
  const pristine = new Map();   // path -> { bytes, hash, copy }
  const keep = mkdtempSync(join(tmpdir(), 'otb-mutate-'));
  const results = [];
  let survivors = 0;

  const pristineOf = (path) => {
    if (!pristine.has(path)) {
      const bytes = read(path);
      const copy = join(keep, 'copy-' + pristine.size);
      writeFileSync(copy, bytes);
      pristine.set(path, { bytes, hash: sha(bytes), copy });
    }
    return pristine.get(path);
  };

  /** Put a file back, retrying, and read it back: true only when its bytes are the ones it began with. */
  const restore = (path) => {
    const p = pristine.get(path);
    for (let i = 0; i < RESTORE_TRIES; i += 1) {
      try {
        write(path, p.bytes);
        if (sha(read(path)) === p.hash) return true;
      } catch { /* busy for a moment: try again */ }
      wait(retryWaitMs);
    }
    return false;
  };

  const leftMutated = () => [...pristine].filter(([path, p]) => {
    try { return sha(read(path)) !== p.hash; } catch { return true; }
  }).map(([path, p]) => ({ path, copy: p.copy }));

  const onSignal = () => {
    for (const path of pristine.keys()) restore(path);
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    for (const m of list) {
      const path = resolve(root, m.file);
      const p = pristineOf(path);
      const text = p.bytes.toString('utf8');
      const parts = text.split(m.from);
      if (parts.length !== 2) {
        say(`SKIP     ${m.name}: "from" matches ${parts.length - 1} times, not once`);
        results.push({ name: m.name, verdict: 'skipped' });
        continue;
      }
      let outcome;
      try {
        write(path, Buffer.from(parts.join(m.to), 'utf8'));
        outcome = run(m);
      } finally {
        if (!restore(path)) {
          const stuck = leftMutated();
          say(`\nFILE LEFT MUTATED: ${path}\n  its pristine copy is ${p.copy}\n  copy it back before anything else.`);
          return { results, survivors, leftMutated: stuck };
        }
      }
      // Not killed is not proof of anything when node's report could not be read: it counts against the tests, and says so.
      const verdict = outcome.fail > 0 ? 'killed' : outcome.fail === 0 ? 'survived' : 'unread';
      if (verdict !== 'killed') survivors += 1;
      say(`${verdict.toUpperCase().padEnd(8)} ${m.name} (fail ${outcome.fail})${outcome.failed?.length ? ' :: ' + outcome.failed.slice(0, 4).join(' | ') : ''}`);
      results.push({ name: m.name, verdict, fail: outcome.fail });
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
  const stuck = leftMutated();
  if (stuck.length) say('\nFILES LEFT MUTATED: ' + stuck.map((s) => `${s.path} (pristine copy ${s.copy})`).join(', '));
  else say(`all ${pristine.size} file${pristine.size === 1 ? '' : 's'} read back byte for byte as they began`);
  say(`done: ${list.length} mutations, ${survivors} survivors`);
  return { results, survivors, leftMutated: stuck };
}

function main() {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/mutate.mjs mutations.json'); process.exit(1); }
  let list;
  try { list = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error('cannot read the list: ' + e.message); process.exit(1); }
  const bad = !Array.isArray(list) || list.some((m) => !m || typeof m.file !== 'string' || typeof m.from !== 'string' || typeof m.to !== 'string' || !Array.isArray(m.tests) || !m.tests.length);
  if (bad) { console.error('each mutation needs file, from, to and a non-empty tests list'); process.exit(1); }
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  process.exit(mutate({ root, list }).leftMutated.length ? 2 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
