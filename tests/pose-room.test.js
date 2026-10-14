// LET'S DANCE!, or a pose: the room says what each thing on the floor is (docs/superpowers/specs/2026-10-14-dance-or-pose-design.md §2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom } from '../relay/room.js';

const KINDS = { p1: 'photo', c1: 'clip', p2: 'photo' };
const room = (opts = { clipKind: (ref) => KINDS[ref] ?? 'clip' }) => {
  const r = createRoom({ salt: 'p', ...opts });
  for (const p of ['ana', 'ben', 'cal']) { r.join(p); r.arm(p, 'dance'); }
  return r;
};
// With no wristbands every band reads the same, so rows are told apart by ref, or by being the only one.
const rowBy = (r, viewer, ref) => r.viewFor(viewer).floor.find((c) => c.ref === ref);
const only = (r, viewer) => { const f = r.viewFor(viewer).floor; assert.equal(f.length, 1, viewer + ' sees one'); return f[0]; };

test('each floor row and your own says photo or clip, as the relay told the room', () => {
  const r = room();
  r.postClip('ana', 'p1');
  r.postClip('ben', 'c1');
  assert.equal(rowBy(r, 'cal', 'p1').kind, 'photo');
  assert.equal(rowBy(r, 'cal', 'c1').kind, 'clip');
  assert.deepEqual([r.viewFor('ana').me.clip, r.viewFor('ana').me.clipKind], ['p1', 'photo']);
  assert.equal(r.viewFor('cal').me.clipKind, null, 'nothing on the floor, no kind');
});

test('a photo danced back to someone whose own is a clip: each tile says its own kind', () => {
  const r = room();
  r.postClip('ben', 'c1');
  assert.equal(r.danceBack('ana', only(r, 'ana').handle, 'p2'), null);
  const toBen = only(r, 'ben');
  assert.deepEqual([toBen.ref, toBen.toYou, toBen.kind], ['p2', true, 'photo']);
  assert.equal(only(r, 'ana').kind, 'clip');
});

test('a room not told kinds says clip for everything, as before photos', () => {
  const r = room({});
  r.postClip('ana', 'p1');
  assert.equal(rowBy(r, 'ben', 'p1').kind, 'clip');
  assert.equal(r.viewFor('ana').me.clipKind, 'clip');
});
