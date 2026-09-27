// ON THE BEAT — the four promises, held by the room itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, BANDS, MARKS } from '../relay/room.js';

let channel = 1;
/**
 * Puts people in areas as the relay does: each one's band hears the marker of
 * that area loud and clear, then the room ticks. Each band is on a channel of
 * its own, so hearing a marker hides nobody (near spec §2).
 */
function place(room, where) {
  for (const [id, band] of where) {
    const area = Object.keys(MARKS).find((a) => MARKS[a] === band);
    room.heard(id, { ch: channel++, marks: area ? [{ area, rssi: -40 }] : [] });
  }
  room.nearTick();
}

function night() {
  let t = Date.UTC(2026, 8, 23, 11, 4);
  const room = createRoom({ now: () => t, salt: 'test' });
  for (const id of ['ana', 'ben', 'cai']) {
    room.join(id);
    room.setProfile(id, { name: id.toUpperCase(), contact: '@' + id });
  }
  place(room, [['ana', 'near the bar'], ['ben', 'by the stage'], ['cai', 'in this room']]);
  const handleOf = (viewer, target, list = 'near') =>
    room.viewFor(viewer)[list].find((p) => p.band === room.viewFor(target).me.band)?.handle;
  return { room, handleOf, tick: (ms) => { t += ms; } };
}

/** Both wave: the shortest way to a match. */
function meet(room, handleOf, a, b) {
  room.arm(a, 'hi');
  room.arm(b, 'hi');
  room.wave(a, handleOf(a, b));
  room.wave(b, handleOf(b, a));
  return room.viewFor(a).matches[0];
}

test('before a mutual yes, a person is a band and a pick — no id, no name, no contact', () => {
  const { room } = night();
  room.arm('ben', 'hi');
  room.pick('ben', 'Treasure');
  const seen = JSON.stringify(room.viewFor('ana'));
  for (const secret of ['ben', 'BEN', '@ben']) assert.equal(seen.includes(secret), false, 'ana was shown ' + secret);
  assert.deepEqual(room.viewFor('ana').near.map((p) => [p.band, p.pick]), [['by the stage', 'Treasure']]);
});

test('the same person has a different handle on every phone', () => {
  const { room, handleOf } = night();
  room.arm('cai', 'hi');
  assert.notEqual(handleOf('ana', 'cai'), handleOf('ben', 'cai'));
});

test('distance is only ever a band from the fixed four', () => {
  const { room } = night();
  room.heard('ana', { ch: 0, marks: [{ area: '12 m from the stage', rssi: -30 }] });
  room.nearTick();
  assert.equal(room.viewFor('ana').me.band, 'near the bar', 'a made-up band is refused');
  room.arm('ana', 'hi');
  for (const p of room.viewFor('ben').near) assert.ok(BANDS.includes(p.band));
});

test('a wave shows its recipient a blue dot on a band, and tells the sender nothing back', () => {
  const { room, handleOf } = night();
  room.arm('ana', 'hi');
  room.arm('ben', 'hi');
  assert.equal(room.wave('ana', handleOf('ana', 'ben')), null, 'one wave is not a match');
  const toBen = room.viewFor('ben').near.find((p) => p.band === 'near the bar');
  assert.equal(toBen.wavedAtYou, true, 'ben can see that someone near the bar waved');
  assert.equal(JSON.stringify(room.viewFor('ben')).includes('ANA'), false, 'but not who');
  const toAna = room.viewFor('ana').near.find((p) => p.band === 'by the stage');
  assert.deepEqual([toAna.waved, toAna.wavedAtYou], [true, false], 'ana sees her own wave and nothing else');
  assert.deepEqual(room.viewFor('ana').matches, []);
});

test('you can only wave at someone showing blue, and never while invisible', () => {
  const { room, handleOf } = night();
  room.arm('ben', 'song');
  room.pick('ben', 'Treasure');
  assert.equal(room.wave('ana', handleOf('ana', 'ben', 'wall')), false, 'ben is not saying hi');
  room.arm('ben', 'hi');
  const h = handleOf('ana', 'ben');
  room.setInvisible('ana', true);
  assert.equal(room.wave('ana', h), false, 'a handle kept from before does not work while invisible');
  room.arm('ana', 'hi');
  assert.equal(room.viewFor('ben').near[0].wavedAtYou, false, 'neither wave landed');
});

/** The rows a phone shows as waved at its person and not waved back: what the wristband is told about. */
const waiting = (room, id) => room.viewFor(id).near.filter((p) => p.wavedAtYou && !p.waved).map((p) => p.handle);

test("wavesAt() is the phone's waiting rows, newest first, each numbered by the clock", () => {
  const { room, handleOf, tick } = night();
  const t0 = Date.UTC(2026, 8, 23, 11, 4);
  for (const id of ['ana', 'ben', 'cai']) room.arm(id, 'hi');
  room.wave('ana', handleOf('ana', 'ben'));
  tick(5);
  room.wave('cai', handleOf('cai', 'ben'));
  assert.deepEqual(room.wavesAt('ben'), [
    { handle: handleOf('ben', 'cai'), n: t0 + 5 },
    { handle: handleOf('ben', 'ana'), n: t0 },
  ]);
  assert.deepEqual(room.wavesAt('ben').map((w) => w.handle).sort(), waiting(room, 'ben').sort(), 'exactly the rows the phone lists');
  room.wave('ben', handleOf('ben', 'cai'));
  assert.deepEqual(room.wavesAt('ben').map((w) => w.handle), [handleOf('ben', 'ana')], 'one waved back to is not waiting');
  assert.deepEqual(room.wavesAt('ana'), [], 'a wave tells its sender nothing');
});

test('wavesAt() leaves out whoever the phone leaves out, and everyone while its person is NOT NOW', () => {
  const { room, handleOf } = night();
  for (const id of ['ana', 'ben', 'cai']) room.arm(id, 'hi');
  const [ana, cai] = [handleOf('ben', 'ana'), handleOf('ben', 'cai')];
  room.wave('ana', handleOf('ana', 'ben'));
  room.wave('cai', handleOf('cai', 'ben'));
  const only = (list, why) => {
    assert.deepEqual(room.wavesAt('ben').map((w) => w.handle), list, why);
    assert.deepEqual(waiting(room, 'ben').sort(), [...list].sort(), why + ', as the phone lists');
  };
  only([cai, ana], 'both wait');
  room.setInvisible('ana', true);
  only([cai], 'a waver in NOT NOW');
  room.arm('ana', 'song');
  only([cai], 'a waver not on SAY HI');
  room.arm('ana', 'hi');
  only([cai, ana], 'back, with the same wave');
  room.leave('ana');
  only([cai], 'a waver who left');
  room.join('ana');
  room.arm('ana', 'hi');
  room.setInvisible('ben', true);
  only([], 'nobody while ben is NOT NOW');
  room.arm('ben', 'hi');
  only([cai, ana], 'and both again when he is back');
  room.block('ben', cai);
  only([ana], 'a waver ben blocked');
  room.block('ana', handleOf('ana', 'ben'));
  only([], 'a waver who blocked ben');
});

test('wave numbers only go up: two in one millisecond differ, a second wave keeps its number, and they outlast leaving', () => {
  const { room, handleOf, tick } = night();
  for (const id of ['ana', 'ben', 'cai']) room.arm(id, 'hi');
  room.wave('ana', handleOf('ana', 'ben'));
  room.wave('cai', handleOf('cai', 'ben'));
  const numberOf = (who) => room.wavesAt('ben').find((w) => w.handle === handleOf('ben', who)).n;
  const first = numberOf('ana');
  assert.equal(numberOf('cai'), first + 1, 'two waves in one millisecond still differ');
  tick(1000);
  room.wave('ana', handleOf('ana', 'ben'));
  assert.equal(numberOf('ana'), first, 'a second wave by the same person keeps its number');
  tick(-1000);
  // Ben leaves and comes back within the millisecond; the next wave he is sent is still the newest.
  room.leave('ben');
  room.join('ben');
  room.arm('ben', 'hi');
  room.join('dee');
  room.arm('dee', 'hi');
  place(room, [['ben', 'by the stage'], ['dee', 'near the bar']]);
  room.wave('dee', room.viewFor('dee').near.find((p) => p.band === 'by the stage').handle);
  assert.equal(room.wavesAt('ben')[0].n, first + 2);
});

test('wavedAtYou() says whether the person behind a handle waved at the viewer, and nothing else', () => {
  const { room, handleOf } = night();
  for (const id of ['ana', 'ben', 'cai']) room.arm(id, 'hi');
  room.wave('ana', handleOf('ana', 'ben'));
  assert.equal(room.wavedAtYou('ben', handleOf('ben', 'ana')), true);
  assert.equal(room.wavedAtYou('ana', handleOf('ana', 'ben')), false, 'a wave is not a wave back');
  assert.equal(room.wavedAtYou('ben', handleOf('ben', 'cai')), false, 'someone who never waved');
  assert.equal(room.wavedAtYou('ben', 'ffffffffff'), false, 'a made-up handle');
  room.wave('ben', handleOf('ben', 'ana'));
  assert.equal(room.wavedAtYou('ben', handleOf('ben', 'ana')), true, 'still true once they match');
  room.block('ben', room.viewFor('ben').matches[0].id);
  assert.equal(room.wavedAtYou('ben', handleOf('ben', 'ana')), false, 'a block takes the wave away');
});

test('two waves make a match, and only then a name, a meeting spot and one shared number', () => {
  const { room, handleOf } = night();
  meet(room, handleOf, 'ana', 'ben');
  const [a] = room.viewFor('ana').matches;
  const [b] = room.viewFor('ben').matches;
  assert.equal(a.name, 'BEN');
  assert.equal(b.name, 'ANA');
  assert.equal(a.number, b.number, 'both wristbands show the same number');
  assert.ok(a.number >= 10 && a.number <= 99);
  assert.equal(a.spot, b.spot);
  assert.equal(a.contact, '', 'a contact is not part of a match');
});

test('meeting numbers are never shared by two matches at once', () => {
  const room = createRoom({ salt: 'n' });
  const ids = Array.from({ length: 24 }, (_, i) => 'p' + i);
  // Each person's pick is their own id, which is how this test finds a handle.
  for (const id of ids) { room.join(id); room.arm(id, 'hi'); room.pick(id, id); }
  const handle = (viewer, target) => room.viewFor(viewer).near.find((p) => p.pick === target).handle;
  for (let i = 0; i < ids.length; i += 2) {
    room.wave(ids[i], handle(ids[i], ids[i + 1]));
    room.wave(ids[i + 1], handle(ids[i + 1], ids[i]));
  }
  const numbers = new Map();
  for (const id of ids) for (const m of room.viewFor(id).matches) numbers.set(m.id, m.number);
  assert.equal(numbers.size, 12);
  assert.equal(new Set(numbers.values()).size, 12, 'two matches share a number');
});

test('past ninety matches at once the room still answers, with two-digit numbers', () => {
  const room = createRoom({ salt: 'x' });
  const ids = Array.from({ length: 15 }, (_, i) => 'q' + i);   // 105 pairs
  for (const id of ids) { room.join(id); room.arm(id, 'hi'); }
  for (const id of ids) for (const p of room.viewFor(id).near) room.wave(id, p.handle);
  const all = ids.flatMap((id) => room.viewFor(id).matches);
  assert.equal(new Set(all.map((m) => m.id)).size, 105);
  assert.ok(all.every((m) => m.number >= 10 && m.number <= 99));
});

test('likes are for an answer: never shown, mutual likes make a match, a changed pick drops its likes', () => {
  const { room, handleOf } = night();
  room.pick('ana', 'Grenade');
  room.pick('ben', 'Treasure');
  room.like('ana', handleOf('ana', 'ben', 'wall'));
  assert.equal(JSON.stringify(room.viewFor('ben')).includes('liked":true'), false, 'ben is not told');
  room.pick('ben', '24K Magic');
  assert.equal(room.viewFor('ana').wall.find((p) => p.pick === '24K Magic').liked, false);
  room.like('ana', handleOf('ana', 'ben', 'wall'));
  room.like('ben', handleOf('ben', 'ana', 'wall'));
  const [m] = room.viewFor('ana').matches;
  assert.equal(m.intent, 'song');
  assert.equal(m.pick, '24K Magic');
  assert.equal(m.yourPick, 'Grenade');
});

test('dance back: a clip sent straight to one person, who sees it first, and a match when it goes both ways', () => {
  const { room, handleOf } = night();
  room.postClip('ana', 'clip-ana');
  assert.equal(room.danceBack('ben', handleOf('ben', 'cai', 'floor'), 'x'), false, 'cai has not danced anywhere');
  room.danceBack('ben', handleOf('ben', 'ana', 'floor'), 'clip-ben-for-ana');
  const floor = room.viewFor('ana').floor;
  assert.deepEqual(floor.map((c) => [c.ref, c.toYou]), [['clip-ben-for-ana', true]], 'ana sees the clip ben sent her');
  assert.equal(room.viewFor('cai').floor.some((c) => c.ref === 'clip-ben-for-ana'), false, 'and nobody else does');
  assert.deepEqual(room.viewFor('ana').matches, []);
  room.danceBack('ana', floor[0].handle, 'clip-ana-for-ben');
  const [m] = room.viewFor('ben').matches;
  assert.equal(m.intent, 'dance');
  assert.equal(m.name, 'ANA');
});

test('NOT NOW: an invisible person is in nobody\'s lists and sees nobody', () => {
  const { room } = night();
  room.arm('ana', 'hi');
  room.pick('ana', 'Grenade');
  room.postClip('ana', 'c');
  room.arm('ben', 'hi');
  room.setInvisible('ana', true);
  assert.equal(room.viewFor('ana').me.armed, null, 'going invisible disarms');
  assert.deepEqual(room.viewFor('ben').near, []);
  assert.deepEqual(room.viewFor('ben').wall, []);
  assert.deepEqual(room.viewFor('ben').floor, []);
  assert.deepEqual(room.viewFor('ana').near, []);
  room.setInvisible('ana', false);
  assert.equal(room.viewFor('ben').wall.length, 1, 'and it comes back only when she turns it on');
});

test('block is silent and both ways, and ends a match', () => {
  const { room, handleOf } = night();
  const m = meet(room, handleOf, 'ana', 'ben');
  assert.equal(room.block('ben', m.id), true, 'a match can be blocked by its id');
  assert.deepEqual(room.viewFor('ana').matches, []);
  assert.deepEqual(room.viewFor('ana').near, [], 'ben is gone from ana');
  assert.deepEqual(room.viewFor('ben').near, [], 'and ana from ben');
  assert.equal(JSON.stringify(room.viewFor('ana')).includes('block'), false, 'nothing tells ana why');
});

test('a block outlives leaving the room — a phone that slept does not come back unblocked', () => {
  const { room, handleOf } = night();
  room.arm('ben', 'hi');
  room.block('ana', handleOf('ana', 'ben'));
  room.leave('ana');
  room.leave('ben');
  room.join('ana');
  room.join('ben');
  place(room, [['ana', 'near the bar'], ['ben', 'by the stage']]);
  room.arm('ana', 'hi');
  room.arm('ben', 'hi');
  assert.deepEqual(room.viewFor('ana').near, []);
  assert.deepEqual(room.viewFor('ben').near, []);
});

test('keep: a contact is shared only when both keep, and still arrives after a phone has left', () => {
  const { room, handleOf } = night();
  const { id } = meet(room, handleOf, 'ana', 'ben');
  room.keep('ana', id, true);
  assert.equal(room.viewFor('ana').matches[0].contact, '');
  assert.equal(room.viewFor('ben').matches[0].contact, '', 'keeping alone shows nobody anything — either way');
  room.leave('ana');
  room.keep('ben', id, true);
  assert.equal(room.viewFor('ben').matches[0].contact, '@ana');
  room.join('ana');
  assert.equal(room.viewFor('ana').matches[0].contact, '@ben');
  room.keep('ben', id, false);
  assert.equal(room.viewFor('ana').matches[0].contact, '', 'taking it back takes the contact back');
});

// ---------- found each other (docs/superpowers/specs/2026-09-26-wrist-found-design.md §2) ----------

test("found: counted only once both say so, and one side's is never shown to the other", () => {
  const { room, handleOf, tick } = night();
  const { id } = meet(room, handleOf, 'ana', 'ben');
  const bens = JSON.stringify(room.viewFor('ben'));
  tick(60_000);
  assert.equal(room.found('ana', id), true);
  assert.deepEqual([room.viewFor('ana').matches[0].found, room.viewFor('ana').matches[0].foundAt], [true, null], 'said, alone');
  assert.equal(JSON.stringify(room.viewFor('ben')), bens, "ben's view is exactly as it was");
  tick(30_000);
  const t = Date.UTC(2026, 8, 23, 11, 4) + 90_000;
  assert.equal(room.found('ben', id), true);
  for (const who of ['ana', 'ben']) {
    const m = room.viewFor(who).matches[0];
    assert.deepEqual([m.found, m.foundAt], [true, t], who + ': the later of the two');
  }
});

test('found: only the two of a match say it, the first time is kept, and a match that is gone refuses it', () => {
  const { room, handleOf, tick } = night();
  const { id } = meet(room, handleOf, 'ana', 'ben');
  const t0 = Date.UTC(2026, 8, 23, 11, 4);
  assert.equal(room.found('cai', id), false, 'not his match');
  assert.equal(room.found('ana', 'm999'), false, 'no such match');
  assert.equal(room.viewFor('ana').matches[0].found, false, 'nothing changed');
  room.found('ana', id);
  tick(5_000);
  room.found('ben', id);
  tick(5_000);
  room.found('ana', id);
  assert.equal(room.viewFor('ana').matches[0].foundAt, t0 + 5_000, "ben's is the later; ana's second changed nothing");
  meet(room, handleOf, 'ana', 'cai');
  const other = room.viewFor('cai').matches[0];
  room.block('cai', other.id);
  assert.equal(room.found('ana', other.id), false, 'a blocked match is gone');
});

test('a report is kept for the venue team with the band, never a position — about someone, or something', () => {
  const { room, handleOf } = night();
  room.arm('ben', 'hi');
  assert.equal(room.report('ana', handleOf('ana', 'ben'), 'followed me'), true);
  assert.equal(room.report('ana', null, 'someone is being sick by the stairs'), true);
  assert.equal(room.report('ana', 'not-a-handle', 'x'), false, 'a handle nobody holds is refused');
  const [r1, r2] = room.reports();
  assert.deepEqual([r1.from, r1.about, r1.band, r1.why], ['ana', 'ben', 'by the stage', 'followed me']);
  assert.deepEqual([r2.about, r2.band], [null, 'near the bar']);
});

// ---------- who changed it, and when (spec §2) ----------

test('every change to armed or invisible moves rev and says who made it; nothing else does', () => {
  const room = createRoom({ salt: 'test' });
  room.join('ana');
  const first = room.viewFor('ana').me;
  assert.deepEqual([first.seq, first.by, first.fresh], [0, 'relay', true], 'made by the relay, and fresh');
  room.arm('ana', 'hi', 'band');
  const armed = room.viewFor('ana').me;
  assert.ok(armed.rev > first.rev);
  assert.deepEqual([armed.by, armed.fresh], ['band', false]);
  room.arm('ana', 'hi', 'phone');
  assert.deepEqual([room.viewFor('ana').me.rev, room.viewFor('ana').me.by], [armed.rev, 'band'], 'no change: no new rev, and by stays');
  room.setProfile('ana', { name: 'Ana' });
  room.pick('ana', 'Treasure');
  assert.equal(room.viewFor('ana').me.rev, armed.rev, 'a name or a pick is not what a choice is made from');
  room.setInvisible('ana', true);
  const quiet = room.viewFor('ana').me;
  assert.deepEqual([quiet.rev > armed.rev, quiet.by, quiet.armed, quiet.invisible], [true, 'phone', null, true]);
  assert.equal(room.revOf('ana'), quiet.rev);
  assert.equal(room.revOf('nobody'), null);
});

test('a person made again never reuses a rev', () => {
  const room = createRoom({ salt: 'test', firstRev: () => 1 });   // not left to chance: the room keeps their count
  room.join('ana');
  room.arm('ana', 'hi');
  const before = room.viewFor('ana').me.rev;
  room.leave('ana');
  room.join('ana');
  assert.ok(room.viewFor('ana').me.rev > before);
});

test("a person's rev counts their own changes only: it says nothing about anyone else", () => {
  const room = createRoom({ salt: 'test' });
  room.join('ana');
  const before = room.viewFor('ana').me.rev;
  room.join('ben');
  room.arm('ben', 'hi');
  room.setInvisible('ben', true);
  room.leave('ben');
  room.join('cai');
  room.arm('ana', 'song');
  assert.equal(room.viewFor('ana').me.rev, before + 1, 'one change of her own is one step, whoever else came, went or changed');
});

test("two people's revs start far apart, so a rev chosen from one never names the other", () => {
  const room = createRoom({ salt: 'test' });
  room.join('ana');
  room.join('ben');
  const [a, b] = [room.viewFor('ana').me.rev, room.viewFor('ben').me.rev];
  assert.ok(Number.isSafeInteger(a) && Number.isSafeInteger(b));
  assert.notEqual(a, b);
});
