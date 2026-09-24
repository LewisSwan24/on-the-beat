// ON THE BEAT — the stand-in's SHA-256, held to node:crypto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { bandIdOf, fromHex, sha256, toHex } from '../app/lib/sha256.js';

const node = (b) => createHash('sha256').update(b).digest('hex');

test('the stand-in hashes as node:crypto does, at every padding edge', () => {
  for (const n of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000]) {
    const b = randomBytes(n);
    assert.equal(toHex(sha256(new Uint8Array(b))), node(b), n + ' bytes');
  }
  assert.equal(toHex(sha256(new TextEncoder().encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test("a wristband's id is the first 32 hex of its key's hash", () => {
  const key = randomBytes(16).toString('hex');
  assert.deepEqual(fromHex(key), new Uint8Array(Buffer.from(key, 'hex')));
  assert.equal(bandIdOf(key), node(Buffer.from(key, 'hex')).slice(0, 32));
});
