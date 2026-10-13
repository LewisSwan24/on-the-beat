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
// The old hold was "for a second" and the old wake "three seconds". Today's hold is a second and a half, and three
// seconds is now the wait before a choice sends and the power-off hold: those are not the old band.
const OLD = [/one[- ]button/i, /\bits button\b/i, /for a second\b(?! and a half)/i, /one-second/i, /\b(?:wakes?|lights?|lit)\b[^.;:]*\bthree seconds/i,
  /only lights up while/i, /made once and keeps/i];

test('the old-band words are still caught, and today\'s timings are not taken for them', () => {
  const old = (line) => OLD.some((re) => re.test(line));
  for (const line of ['a press wakes it for three seconds', 'it lights for three seconds', 'hold it for a second to go dark', 'a one-second hold'])
    assert.ok(old(line), line);
  for (const line of ['hold FACE for a second and a half.', 'three seconds later it sends, and says SET.',
    'FACE and SIDE held together for three seconds turns it off.', 'it lights for six seconds.'])
    assert.ok(!old(line), line);
});

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? files(p) : [p];
});

test('nothing still describes the one-button wristband', () => {
  const found = [];
  const where = [...files(join(root, 'app')), ...files(join(root, 'relay')), ...files(join(root, 'firmware', 'src')), join(root, 'README.md'),
    // The README's long sections live in docs/ since 5 Oct 2026; the plans under docs/superpowers are history, as written.
    ...readdirSync(join(root, 'docs')).filter((n) => n.endsWith('.md')).map((n) => join(root, 'docs', n))];
  for (const f of where.filter((p) => /\.(js|jsx|css|h|cpp|md)$/.test(p))) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (OLD.some((re) => re.test(line))) found.push(relative(root, f) + ':' + (i + 1) + ': ' + line.trim());
    });
  }
  assert.deepEqual(found, []);
});

test('F13: leaving asks first, and says what it ends: the wristband lets go and the night here stops', async () => {
  const { LEAVE } = await import('../app/copy.js');
  assert.match(LEAVE.title, /\?$/, 'it is a question');
  assert.match(LEAVE.sub, /wristband/);
  assert.ok(LEAVE.row && LEAVE.row !== LEAVE.title);
});

test('venue cards: every refusal of a fill has its own words, and none blames the person', async () => {
  const { WHERE } = await import('../app/copy.js');
  for (const k of ['taken', 'limit', 'full', 'listed', 'bad']) assert.ok(WHERE[k] && !/you did|your fault/i.test(WHERE[k]), k);
  assert.match(WHERE.cant, /list/);
});

test('venue cards: the after-joining words exist and the banner asks a question', async () => {
  const { WHERE } = await import('../app/copy.js');
  for (const k of ['addAct', 'addTimes', 'wrongHere', 'seeNearby', 'imHere']) assert.ok(WHERE[k], k);
  const { wrongLine } = await import('../app/lib/where.js');
  assert.match(wrongLine(3000, { venue: 'Moth Club, Hackney' }), /\?$/);
});
