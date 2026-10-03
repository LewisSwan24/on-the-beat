import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mutate } from '../scripts/mutate.mjs';

// scripts/mutate.mjs puts back what it breaks. It was written after a restore threw, the mutant stayed on disk, and
// the mutated line was committed and deployed (2 Oct 2026): what it must never do is leave a file changed and say nothing.

const dir = mkdtempSync(join(tmpdir(), 'otb-mutate-test-'));
const quiet = () => {};
const make = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };

test('a mutation the tests notice is killed, one they do not is a survivor, and the file is back either way', () => {
  const p = make('a.js', 'const a = 1;\r\nconst b = 2;\r\n');
  const seen = [];
  const out = mutate({
    root: dir, say: quiet,
    list: [{ name: 'a', file: 'a.js', from: 'a = 1', to: 'a = 9', tests: ['x'] }, { name: 'b', file: 'a.js', from: 'b = 2', to: 'b = 9', tests: ['x'] }],
    run: (m) => { seen.push(readFileSync(p, 'utf8')); return { fail: m.name === 'a' ? 1 : 0, failed: [] }; },
  });
  assert.deepEqual(out.results.map((r) => r.verdict), ['killed', 'survived']);
  assert.equal(out.survivors, 1);
  assert.deepEqual(out.leftMutated, []);
  assert.ok(seen[0].includes('a = 9') && seen[1].includes('b = 9'), 'the tests ran against the mutant');
  assert.equal(readFileSync(p, 'utf8'), 'const a = 1;\r\nconst b = 2;\r\n', 'line endings and all');
});

test('a "from" that is not in the file exactly once is skipped and the file is not touched', () => {
  const p = make('b.js', 'x x\n');
  let ran = 0;
  const out = mutate({ root: dir, say: quiet, list: [{ name: 'twice', file: 'b.js', from: 'x', to: 'y', tests: ['t'] }, { name: 'none', file: 'b.js', from: 'z', to: 'y', tests: ['t'] }], run: () => { ran += 1; return { fail: 1 }; } });
  assert.equal(ran, 0);
  assert.deepEqual(out.results.map((r) => r.verdict), ['skipped', 'skipped']);
  assert.equal(readFileSync(p, 'utf8'), 'x x\n');
});

test('a restore that fails a few times is retried until the file is read back as it began', () => {
  const p = make('c.js', 'const c = 1;\n');
  let failures = 3;
  let writes = 0;
  const write = (path, bytes) => {
    writes += 1;
    // Writes 2 to 4 are the restore's first tries: the file is busy.
    if (writes > 1 && failures > 0) { failures -= 1; throw new Error('EBUSY'); }
    writeFileSync(path, bytes);
  };
  const out = mutate({ root: dir, say: quiet, retryWaitMs: 1, write, list: [{ name: 'c', file: 'c.js', from: 'c = 1', to: 'c = 2', tests: ['t'] }], run: () => ({ fail: 1 }) });
  assert.deepEqual(out.leftMutated, []);
  assert.equal(readFileSync(p, 'utf8'), 'const c = 1;\n');
});

test('a file that cannot be put back stops the run at once and is named, with its pristine copy', () => {
  const p = make('d.js', 'const d = 1;\n');
  const q = make('e.js', 'const e = 1;\n');
  let writes = 0;
  const said = [];
  const write = (path, bytes) => {
    writes += 1;
    if (writes > 1) throw new Error('EBUSY');   // the mutant went in, nothing comes out
    writeFileSync(path, bytes);
  };
  let ran = 0;
  const out = mutate({
    root: dir, say: (s) => said.push(s), retryWaitMs: 1, write,
    list: [{ name: 'd', file: 'd.js', from: 'd = 1', to: 'd = 2', tests: ['t'] }, { name: 'e', file: 'e.js', from: 'e = 1', to: 'e = 2', tests: ['t'] }],
    run: () => { ran += 1; return { fail: 1 }; },
  });
  assert.equal(ran, 1, 'the second mutation never ran on top of the first');
  assert.equal(out.leftMutated.length, 1);
  assert.equal(out.leftMutated[0].path, p);
  assert.equal(readFileSync(out.leftMutated[0].copy, 'utf8'), 'const d = 1;\n', 'the pristine copy is the original');
  assert.ok(said.some((s) => s.includes('FILE LEFT MUTATED') && s.includes(p)));
  assert.equal(readFileSync(q, 'utf8'), 'const e = 1;\n');
});

test('a restore that "succeeds" but leaves different bytes is not believed', () => {
  const p = make('f.js', 'const f = 1;\n');
  // The write says nothing and does nothing after the mutant went in.
  let writes = 0;
  const write = (path, bytes) => { writes += 1; if (writes === 1) writeFileSync(path, bytes); };
  const out = mutate({ root: dir, say: quiet, retryWaitMs: 1, write, list: [{ name: 'f', file: 'f.js', from: 'f = 1', to: 'f = 2', tests: ['t'] }], run: () => ({ fail: 1 }) });
  assert.equal(out.leftMutated.length, 1);
  assert.equal(readFileSync(p, 'utf8'), 'const f = 2;\n', 'and it really is still the mutant, which the result says');
});

test('a test report that cannot be read is not counted as a kill', () => {
  make('g.js', 'const g = 1;\n');
  const out = mutate({ root: dir, say: quiet, list: [{ name: 'g', file: 'g.js', from: 'g = 1', to: 'g = 2', tests: ['t'] }], run: () => ({ fail: NaN, failed: [] }) });
  assert.equal(out.results[0].verdict, 'unread');
  assert.equal(out.survivors, 1);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
