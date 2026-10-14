import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSES, PHOTO_MAX, PHOTO_QUALITY, PHOTO_SIDE, isJpeg, nextPose } from '../app/lib/pose.js';

test('eight solo poses, none of them needing two people', () => {
  assert.equal(POSES.length, 8);
  assert.equal(POSES[0], 'Air guitar, as loud as it looks.');
  for (const p of POSES) assert.doesNotMatch(p, /together|each|both of you/i, p);
  assert.deepEqual([PHOTO_SIDE, PHOTO_QUALITY, PHOTO_MAX], [640, 0.8, 300_000]);
});

test('another pose is never the one just shown, and every pose can come up', () => {
  const seen = new Set();
  for (let prev = -1, i = 0; i < 400; i += 1) {
    const next = nextPose(prev);
    assert.ok(next >= 0 && next < POSES.length);
    assert.notEqual(next, prev);
    seen.add(next);
    prev = next;
  }
  assert.equal(seen.size, POSES.length);
  assert.equal(nextPose(3, () => 3 / POSES.length), 4, 'the draw that would repeat steps on');
  assert.equal(nextPose(-1, () => 0), 0, 'the first draw may be any');
});

test('only a JPEG is a photo: a browser that cannot make one hands back a PNG, which the relay would refuse', () => {
  assert.equal(isJpeg(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })), true);
  assert.equal(isJpeg(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })), false);
  assert.equal(isJpeg(null), false, 'toBlob gave nothing');
});
