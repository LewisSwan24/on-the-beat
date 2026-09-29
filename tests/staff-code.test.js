// ON THE BEAT — a staff passcode becomes an entry the relay checks, and the script that makes one
// (docs/superpowers/specs/2026-09-28-staff-reports-design.md §2). Test passcodes only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkCode, entryPrint, isEntry, madeCode, makeEntry } from '../relay/staff.js';

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

test('an entry\'s print is 32 hex digits of the whole entry: the same for the same entry, another for a new salt', async () => {
  const entry = await makeEntry('test-passcode-1');
  const print = entryPrint(entry);
  assert.match(print, /^[a-f0-9]{32}$/);
  assert.equal(entryPrint(entry), print);
  assert.notEqual(entryPrint(await makeEntry('test-passcode-1')), print, 'the same passcode with a new salt is a new entry');
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
  const inputs = ['roundhouse-bruno-mars\ntest-passcode-1\ntest-passcode-2\n', 'roundhouse-bruno-mars\nshort\nshort\n', '\n', '', 'roundhouse-bruno-mars\n'];
  for (const input of inputs) {
    const { out, code } = await run(input);
    assert.equal(code, 1, JSON.stringify(input));
    assert.equal(out, '', 'nothing on stdout for ' + JSON.stringify(input));
  }
});

test('a made passcode is three groups of four from 31 characters with no i, l, o, 0 or 1, and every one of them turns up', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) {
    const code = madeCode();
    assert.match(code, /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
    for (const c of code.replaceAll('-', '')) seen.add(c);
  }
  assert.equal(seen.size, 31, 'all thirty-one characters are drawn');
});

test('a typed passcode needs twelve characters: eleven make nothing, twelve make an entry', async () => {
  const eleven = await run('roundhouse-bruno-mars\neleven-char\neleven-char\n');
  assert.deepEqual([eleven.code, eleven.out], [1, '']);
  assert.match(eleven.err, /at least 12 characters, or press Enter/);
  const twelve = await run('roundhouse-bruno-mars\ntwelve-chars\ntwelve-chars\n');
  assert.equal(twelve.code, 0, twelve.err);
});

test('Enter at the passcode makes one: shown once on stderr, never on stdout, and it opens the entry', async () => {
  const { out, err, code } = await run('roundhouse-bruno-mars\n\n');
  assert.equal(code, 0, err);
  const made = /kept nowhere\): (\S+)/.exec(err)?.[1];
  assert.match(made, /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
  assert.equal(out.split('\n').filter(Boolean).length, 1, 'one line on stdout');
  assert.equal(out.includes(made), false, 'not on stdout');
  assert.equal(err.split(made).length - 1, 1, 'shown once');
  assert.equal(err.includes('The same passcode again'), false, 'there is nothing to confirm');
  const [[, entry]] = Object.entries(JSON.parse('{' + out + '}'));
  assert.equal(await checkCode(entry, made), true);
  const again = await run('roundhouse-bruno-mars\n\n');
  assert.notEqual(/kept nowhere\): (\S+)/.exec(again.err)?.[1], made, 'a new one each time');
});

test('at a terminal, Enter at the passcode makes one too', async () => {
  const { out, err, code } = await typed(['roundhouse-bruno-mars', '']);
  assert.equal(code, 0, err);
  const made = /kept nowhere\): (\S+)/.exec(err)?.[1];
  const [[, entry]] = Object.entries(JSON.parse('{' + out + '}'));
  assert.equal(await checkCode(entry, made), true);
});
