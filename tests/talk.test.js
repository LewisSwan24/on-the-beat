// ON THE BEAT — after MEET, before everyone has said FOUND: the people in a meeting can tell each other where they
// are, in a few words (a ready line or their own). Only they see it, it closes once they have found each other, and
// none of it is ever written to disk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, NOTE_MAX, NOTE_GAP_MS, NOTE_EACH } from '../relay/room.js';

function night(ids = ['ana', 'ben', 'cai', 'dee']) {
  let t = Date.UTC(2026, 9, 21, 9, 0);
  const room = createRoom({ now: () => t, salt: 'talk' });
  for (const id of ids) {
    room.join(id);
    room.setProfile(id, { name: id.toUpperCase(), contact: '@' + id });
    room.pick(id, 'Track ' + id);
  }
  const handleOf = (viewer, target) => room.viewFor(viewer).near.find((p) => p.pick === room.viewFor(target).me.pick)?.handle;
  const wave = (a, b) => room.wave(a, handleOf(a, b));
  const meet = (a, b) => { room.arm(a, 'hi'); room.arm(b, 'hi'); wave(a, b); return wave(b, a); };
  return { room, wave, meet, tick: (ms) => { t += ms; } };
}

const talkOf = (room, id) => Object.values(room.viewFor(id).talk ?? {});

test('two who met can tell each other where they are; only they see it', () => {
  const { room, meet } = night();
  const m = meet('ana', 'ben');
  assert.equal(room.note('ana', m.id, "I'm by the stage"), true);
  const [benTalk] = talkOf(room, 'ben');
  assert.deepEqual(benTalk.notes.map((n) => [n.name, n.text, n.mine]), [['ANA', "I'm by the stage", false]]);
  const [anaTalk] = talkOf(room, 'ana');
  assert.equal(anaTalk.notes[0].mine, true, 'Ana sees her own as hers');
  assert.equal(anaTalk.group, m.id);
  assert.deepEqual(talkOf(room, 'cai'), [], 'nobody else sees a word of it');
  assert.equal(room.note('cai', m.id, 'hello'), false, 'and nobody else can say one');
});

test('a note is a few words of plain text: cut to NOTE_MAX, control and direction marks dropped, never empty', () => {
  const { room, meet, tick } = night();
  const m = meet('ana', 'ben');
  assert.equal(room.note('ana', m.id, '   '), false, 'nothing to say');
  const odd = 'at the bar' + String.fromCharCode(0x202e) + 'rab' + String.fromCharCode(7);
  assert.equal(room.note('ana', m.id, odd), true);
  tick(NOTE_GAP_MS);
  assert.equal(room.note('ana', m.id, 'x'.repeat(NOTE_MAX + 40)), true);
  const texts = talkOf(room, 'ben')[0].notes.map((n) => n.text);
  assert.deepEqual(texts, ['at the barrab', 'x'.repeat(NOTE_MAX)]);
});

test('notes are rationed: one every NOTE_GAP_MS, and NOTE_EACH a person in a meeting', () => {
  const { room, meet, tick } = night();
  const m = meet('ana', 'ben');
  assert.equal(room.note('ana', m.id, 'one'), true);
  assert.equal(room.note('ana', m.id, 'two'), false, 'too soon');
  for (let i = 1; i < NOTE_EACH; i += 1) { tick(NOTE_GAP_MS); assert.equal(room.note('ana', m.id, 'n' + i), true); }
  tick(NOTE_GAP_MS);
  assert.equal(room.note('ana', m.id, 'one too many'), false);
  assert.equal(room.note('ben', m.id, 'mine still go'), true, "Ana's ration is not Ben's");
});

test('once everyone has said FOUND, the talk closes and is gone', () => {
  const { room, meet } = night();
  const m = meet('ana', 'ben');
  room.note('ana', m.id, 'here');
  room.found('ana', m.id);
  assert.equal(talkOf(room, 'ben').length, 1, 'one FOUND is not both');
  room.found('ben', m.id);
  assert.deepEqual(talkOf(room, 'ana'), [], 'found by both: nothing more to say');
  assert.equal(room.note('ben', m.id, 'still?'), false);
});

test('in a meeting of three, everyone in it reads every note; one who leaves reads no more', () => {
  const { room, meet, wave } = night();
  const ab = meet('ana', 'ben');
  room.arm('cai', 'hi');
  wave('cai', 'ana');
  wave('ana', 'cai');
  room.admit('ben', room.viewFor('ben').joinAsks[0].id, 'yes');
  const caiAna = room.viewFor('cai').matches.find((m) => m.name === 'ANA');
  assert.equal(room.note('cai', caiAna.id, 'by the merch'), true);
  for (const id of ['ana', 'ben']) {
    const talk = talkOf(room, id);
    assert.equal(talk.length, 1, id + ': one talk for the whole meeting');
    assert.deepEqual(talk[0].notes.map((n) => n.name + ': ' + n.text), ['CAI: by the merch']);
  }
  const anaMine = room.viewFor('ana').matches.find((m) => m.name === 'BEN');
  room.finish('ana', anaMine.id, 'ask');
  assert.deepEqual(talkOf(room, 'ana'), [], 'Ana left: the talk is not hers now');
  assert.equal(room.note('ana', ab.id, 'wait'), false);
  assert.equal(talkOf(room, 'ben').length, 1, 'Ben and Cai go on');
});

test('notes are never written down: the night file holds none of them', () => {
  const { room, meet } = night();
  const m = meet('ana', 'ben');
  room.note('ana', m.id, 'by the stage');
  assert.ok(!JSON.stringify(room.dump()).includes('by the stage'));
});

test("the phone keeps to the relay's limit, and every ready line fits in it", async () => {
  const app = await import('../app/lib/talk.js');
  const { TALK } = await import('../app/copy.js');
  assert.equal(app.NOTE_MAX, NOTE_MAX);
  for (const line of TALK.ready) assert.ok(line.length <= NOTE_MAX, line);
});

test("the phone finds a match's talk by its meeting, and none once it has closed", async () => {
  const { talkFor } = await import('../app/lib/talk.js');
  const { room, meet } = night();
  const m = meet('ana', 'ben');
  const [match] = room.viewFor('ben').matches;
  assert.deepEqual(talkFor(room.viewFor('ben'), match)?.notes, []);
  room.found('ana', m.id);
  room.found('ben', m.id);
  assert.equal(talkFor(room.viewFor('ben'), match), null);
});
