// ON THE BEAT — the phone app's Content-Security-Policy, and the switch that holds it back
// (docs/superpowers/specs/2026-09-30-app-csp-design.md, "Rollout switch"). The policy is written and was walked in
// headless Chrome and WebKit; no iPhone has read its `connect-src` yet, so Fly serves the app the framing rule it always
// had until one has. APP_CSP says which of the two a relay serves, and a relay never serves a third by mistake. The staff
// page is not in the switch: it has run under its full policy since 29 Sep 2026.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { APP_POLICY, FRAMING_ONLY, STAFF_POLICY, createRelay } from '../relay/server.js';

const SERVER = fileURLToPath(new URL('../relay/server.js', import.meta.url));
const APP_PAGES = ['/', '/tonight', '/index.html'];
let base;
let root;

before(() => {
  base = mkdtempSync(join(tmpdir(), 'otb-appcsp-'));
  root = join(base, 'dist');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>On The Beat</title>');
  writeFileSync(join(root, 'staff.html'), '<!doctype html><title>Staff</title>');
  writeFileSync(join(root, 'assets', 'app-abc123.js'), 'export {};');
});

after(() => rmSync(base, { recursive: true, force: true }));

/** What a page or file is served under: its policy and its framing header, the body read to the end. */
async function headersOf(port, path) {
  const res = await fetch('http://127.0.0.1:' + port + path);
  await res.arrayBuffer();
  return { policy: res.headers.get('content-security-policy'), frame: res.headers.get('x-frame-options') };
}

/** A relay of its own on the temporary build, closed when `use` is done with it. */
async function withRelay(options, use) {
  const relay = await createRelay({ port: 0, host: '127.0.0.1', root, ...options });
  try {
    await use(relay.port);
  } finally {
    await relay.close();
  }
}

test('the framing rule is the one directive, and the full policy is not it', () => {
  assert.equal(FRAMING_ONLY, "frame-ancestors 'none'");
  assert.notEqual(APP_POLICY, FRAMING_ONLY);
  assert.ok(APP_POLICY.split('; ').includes(FRAMING_ONLY), 'the full policy holds the framing rule too');
});

test('the phone app carries its full policy unless told otherwise, and the staff page its own', async () => {
  for (const options of [{}, { appCsp: 'full' }]) {
    await withRelay(options, async (port) => {
      for (const path of APP_PAGES) {
        assert.deepEqual(await headersOf(port, path), { policy: APP_POLICY, frame: 'DENY' }, path + ' under ' + JSON.stringify(options));
      }
      for (const path of ['/staff', '/staff.html']) assert.deepEqual(await headersOf(port, path), { policy: STAFF_POLICY, frame: 'DENY' }, path);
    });
  }
});

test("'framing-only' gives the phone app the framing rule it had before its policy, and nothing else of the policy", async () => {
  await withRelay({ appCsp: 'framing-only' }, async (port) => {
    for (const path of APP_PAGES) assert.deepEqual(await headersOf(port, path), { policy: FRAMING_ONLY, frame: 'DENY' }, path);
    // The staff page is not in the switch, and a file that is not a page carries neither header, as ever.
    for (const path of ['/staff', '/staff.html']) assert.deepEqual(await headersOf(port, path), { policy: STAFF_POLICY, frame: 'DENY' }, path);
    for (const path of ['/assets/app-abc123.js', '/api/shows']) assert.deepEqual(await headersOf(port, path), { policy: null, frame: null }, path);
  });
});

test('any other value is refused when the relay is made, and the refusal names the two it takes', () => {
  for (const bad of ['loose', 'FULL', 'framing_only', '', ' full', null, 0, true]) {
    assert.throws(() => createRelay({ port: 0, host: '127.0.0.1', root, appCsp: bad }), /appCsp.*'full'.*'framing-only'/, String(bad));
  }
});

/** The relay as `node relay/server.js` starts it: its lines, its port once it listens, a way to stop it, and how it ended. */
function started(env) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: '0', NIGHT_FILE: '', PUSH_KEYS_FILE: '', STAFF_CODES: '', SHOWS: '', LOAD_EVERY_MS: '0', APP_CSP: undefined, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const ended = new Promise((resolve) => child.once('close', (code) => resolve({ code, lines, err })));
  const listening = new Promise((resolve) => {
    createInterface({ input: child.stdout }).on('line', (line) => {
      lines.push(line);
      const up = /^ON THE BEAT relay on http:\/\/localhost:(\d+)\/$/.exec(line);
      if (up) resolve(Number(up[1]));
    });
  });
  const up = Promise.race([listening, ended.then(() => null)]);
  const stop = () => { child.kill(); return ended; };
  return { lines, up, ended, stop };
}

test('started on its own the relay reads APP_CSP: unset, empty or full serve the full policy, framing-only the framing rule, and the log says which', async () => {
  for (const [value, line, policy] of [
    [undefined, 'app policy: full', APP_POLICY],
    ['', 'app policy: full', APP_POLICY],
    ['full', 'app policy: full', APP_POLICY],
    ['framing-only', 'app policy: the framing rule only (APP_CSP=framing-only)', FRAMING_ONLY],
  ]) {
    const relay = started({ APP_CSP: value });
    try {
      const port = await relay.up;
      assert.ok(port, 'the relay came up with APP_CSP=' + JSON.stringify(value) + '; it said ' + JSON.stringify(relay.lines));
      assert.ok(relay.lines.includes(line), JSON.stringify(line) + ' is not among ' + JSON.stringify(relay.lines));
      assert.equal((await headersOf(port, '/')).policy, policy, 'APP_CSP=' + JSON.stringify(value));
    } finally {
      await relay.stop();
    }
  }
});

test('a value of APP_CSP that is neither stops the relay before it listens, and the log says what it may be', async () => {
  for (const value of ['loose', 'Full', 'framing_only']) {
    const relay = started({ APP_CSP: value });
    try {
      // `up` is the port once it listens, or null when it ended first: a relay that listens is the failure, and it
      // must fail here, not wait for an end that never comes.
      assert.equal(await relay.up, null, 'APP_CSP=' + value + ' let the relay listen; it said ' + JSON.stringify(relay.lines));
      const end = await relay.ended;
      assert.notEqual(end.code, 0, 'APP_CSP=' + value + ' stopped it');
      assert.match(end.err, /appCsp.*'full'.*'framing-only'/, 'the refusal names what it takes');
      assert.ok(!end.lines.some((l) => l.startsWith('ON THE BEAT relay on')), 'it never said it was up');
      assert.ok(!end.lines.some((l) => l.startsWith('app policy:')), 'and said nothing of a policy it did not take');
    } finally {
      await relay.stop();
    }
  }
});
