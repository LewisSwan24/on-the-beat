// ON THE BEAT — the words about the wristband keep up with it.
//
// It had one button: a press woke it for three seconds, and a one-second hold
// was NOT NOW. It has two now, and other timings (app/lib/wrist.js). No copy,
// comment or document may still describe the old one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const OLD = [/one[- ]button/i, /\bits button\b/i, /for a second\b/i, /one-second/i, /three seconds/i, /only lights up while/i, /made once and keeps/i];

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? files(p) : [p];
});

test('nothing still describes the one-button wristband', () => {
  const found = [];
  const where = [...files(join(root, 'app')), ...files(join(root, 'relay')), ...files(join(root, 'firmware', 'src')), join(root, 'README.md')];
  for (const f of where.filter((p) => /\.(js|jsx|css|h|cpp|md)$/.test(p))) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (OLD.some((re) => re.test(line))) found.push(relative(root, f) + ':' + (i + 1) + ': ' + line.trim());
    });
  }
  assert.deepEqual(found, []);
});
