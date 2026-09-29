// ON THE BEAT — the night's file on disk, written whole or not at all
// (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §2, §5).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNight } from '../relay/store.js';

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'otb-store-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

test('a missing file reads as null, and removing it again does not throw', () => {
  const night = openNight(join(dir, 'none.json'));
  assert.equal(night.read(), null);
  night.remove();
  night.remove();
});

test('a write replaces the file whole and leaves no .tmp beside it', () => {
  const night = openNight(join(dir, 'whole.json'));
  night.write('{"v":1,"n":1}');
  night.write('{"v":1,"n":2}');
  assert.equal(night.read(), '{"v":1,"n":2}');
  assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith('whole')), ['whole.json']);
});

test('a .tmp left by a write cut short is written over, and the last whole file is what is read', () => {
  const path = join(dir, 'cut.json');
  writeFileSync(path, '{"v":1,"last":"whole"}');
  writeFileSync(path + '.tmp', '{"v":1,"half');   // a write the process died in
  const night = openNight(path);
  assert.equal(night.read(), '{"v":1,"last":"whole"}');
  night.write('{"v":1,"next":true}');
  assert.equal(readFileSync(path, 'utf8'), '{"v":1,"next":true}');
  assert.equal(existsSync(path + '.tmp'), false);
});

test('remove() takes the file and any .tmp with it', () => {
  const path = join(dir, 'gone.json');
  const night = openNight(path);
  night.write('{}');
  writeFileSync(path + '.tmp', 'x');
  night.remove();
  assert.equal(existsSync(path), false);
  assert.equal(existsSync(path + '.tmp'), false);
});

test('the file is readable by its owner only', { skip: process.platform === 'win32' && 'Windows has no Unix modes' }, () => {
  const path = join(dir, 'mode.json');
  openNight(path).write('{}');
  assert.equal(statSync(path).mode & 0o777, 0o600);
});
