// ON THE BEAT — which pages may open the relay's socket
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originAllowed } from '../relay/origin.js';

const HOST = 'on-the-beat.fly.dev';

test('no Origin (a script, a test, a tool) and the wristband\'s file:// are allowed', () => {
  assert.equal(originAllowed(undefined, HOST), true);
  assert.equal(originAllowed('file://', HOST), true);
});

test('a page of this site is allowed, over http or https, with the port its host names', () => {
  assert.equal(originAllowed('https://on-the-beat.fly.dev', HOST), true);
  assert.equal(originAllowed('http://192.168.1.5:8790', '192.168.1.5:8790'), true);
  assert.equal(originAllowed('https://abc.trycloudflare.com', 'ABC.trycloudflare.com'), true);
});

test('the dev server on loopback is allowed, on any port', () => {
  for (const origin of ['http://localhost:5178', 'http://127.0.0.1:5178', 'http://[::1]:5178', 'http://localhost']) {
    assert.equal(originAllowed(origin, '127.0.0.1:8790'), true, origin);
  }
});

test('another site, null, a look-alike host, another scheme and junk are refused', () => {
  for (const origin of ['https://evil.example', 'null', 'https://on-the-beat.fly.dev.evil.example', 'https://evil-on-the-beat.fly.dev',
    'http://localhost.evil.example', 'http://127.0.0.1.evil.example', 'ftp://on-the-beat.fly.dev', 'chrome-extension://abcdef', 'not a url', '']) {
    assert.equal(originAllowed(origin, HOST), false, JSON.stringify(origin));
  }
  assert.equal(originAllowed('https://on-the-beat.fly.dev', undefined), false, 'a request with no Host matches nothing');
});
