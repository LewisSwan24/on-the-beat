// ON THE BEAT — a staff passcode becomes an entry the relay checks, and the script that makes one
// (docs/superpowers/specs/2026-09-28-staff-reports-design.md §2). Test passcodes only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkCode, isEntry, makeEntry } from '../relay/staff.js';

const script = fileURLToPath(new URL('../scripts/staff-code.mjs', import.meta.url));

/** The script, fed `input` on a pipe: what it printed, what it said, and how it ended. */
function run(input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ out, err, code }));
    child.stdin.end(input);
  });
}

/**
 * The script as a terminal runs it: stdin said to be a TTY, so it echoes what is typed, and each answer typed,
 * with a carriage return, only once its question has been asked.
 */
function typed(answers) {
  return new Promise((resolve) => {
    const tty = 'data:text/javascript,' + encodeURIComponent("Object.defineProperty(process.stdin, 'isTTY', { value: true });");
    const child = spawn(process.execPath, ['--import', tty, script], { stdio: ['pipe', 'pipe', 'pipe'] });
    const questions = ['Venue (', 'Passcode (', 'The same passcode again'];
    let out = '';
    let err = '';
    let asked = 0;
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => {
      err += d;
      while (asked < answers.length && err.includes(questions[asked])) child.stdin.write(answers[asked++] + '\r');
      if (asked === answers.length && !child.stdin.writableEnded) child.stdin.end();
    });
    child.on('close', (code) => resolve({ out, err, code }));
  });
}

test('typed at a terminal, the venue shows as it is typed and the passcode never does', async () => {
  const { out, err, code } = await typed(['roundhouse-bruno-mars', 'test-passcode-1', 'test-passcode-1']);
  assert.equal(code, 0, err);
  assert.match(err, /roundhouse-bruno-mars/, 'what is typed is echoed, so the hiding is what keeps the passcode off');
  assert.equal((out + err).includes('test-passcode-1'), false, 'the passcode is never shown');
  const [[, entry]] = Object.entries(JSON.parse('{' + out + '}'));
  assert.equal(await checkCode(entry, 'test-passcode-1'), true);
});

test('an entry opens with its own passcode and no other, and each has a salt of its own', async () => {
  const entry = await makeEntry('test-passcode-1');
  assert.equal(isEntry(entry), true);
  assert.match(entry, /^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  assert.equal(await checkCode(entry, 'test-passcode-1'), true);
  assert.equal(await checkCode(entry, 'test-passcode-2'), false);
  assert.equal(await checkCode(entry, 'test-passcode-1 '), false);
  assert.notEqual(await makeEntry('test-passcode-1'), entry);
  assert.equal(await checkCode('scrypt$1$1$1$ab$cd', 'test-passcode-1'), false, 'what is not an entry opens nothing');
  assert.equal(await checkCode(undefined, 'test-passcode-1'), false);
  assert.equal(isEntry(entry.slice(0, -1)), false);
});

test('a passcode is the same passcode however its accents were typed', async () => {
  const entry = await makeEntry('café-staff-code');
  assert.equal(await checkCode(entry, 'café-staff-code'), true);
});

test('npm run staff-code prints one entry for the venue, and never the passcode', async () => {
  const { out, err, code } = await run(' Roundhouse-Bruno-Mars \ntest-passcode-1\ntest-passcode-1\n');
  assert.equal(code, 0, err);
  assert.equal(out.split('\n').filter(Boolean).length, 1, 'one line on stdout');
  const [[venue, entry]] = Object.entries(JSON.parse('{' + out + '}'));
  assert.equal(venue, 'roundhouse-bruno-mars', 'the venue as its room is named');
  assert.equal(await checkCode(entry, 'test-passcode-1'), true);
  assert.equal((out + err).includes('test-passcode-1'), false, 'the passcode is never shown');
});

test('two passcodes that differ, one too short, or no venue make nothing', async () => {
  const inputs = ['roundhouse-bruno-mars\ntest-passcode-1\ntest-passcode-2\n', 'roundhouse-bruno-mars\nshort\nshort\n', '\n', ''];
  for (const input of inputs) {
    const { out, code } = await run(input);
    assert.equal(code, 1, JSON.stringify(input));
    assert.equal(out, '', 'nothing on stdout for ' + JSON.stringify(input));
  }
});
