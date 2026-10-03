// ON THE BEAT — the four promises, held by the room itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, BANDS, MARKS, HEARD_MS } from '../relay/room.js';

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

test('a report keeps the band of each side when it was made, and words only as a string, cut to 200', () => {
  const { room, handleOf } = night();
  room.arm('ben', 'hi');
  assert.equal(room.report('ana', handleOf('ana', 'ben'), 'followed me'), true);
  assert.equal(room.report('ana', null, 'x'.repeat(250)), true);
  assert.equal(room.report('ana', null, { toString: () => 'sneaky' }), true);
  assert.equal(room.report('ana', 'not-a-handle', 'x'), false, 'a handle nobody holds is refused');
  const [r1, r2, r3] = room.reports();
  assert.deepEqual([r1.id, r1.from, r1.about, r1.aboutBand, r1.fromBand, r1.why, r1.handledAt],
    ['r1', 'ana', 'ben', 'by the stage', 'near the bar', 'followed me', 0]);
  assert.deepEqual([r2.id, r2.about, r2.aboutBand, r2.fromBand, r2.why.length], ['r2', null, null, 'near the bar', 200]);
  assert.equal(r3.why, '', 'anything but a string is no words');
});

test('the venue report log has a ceiling: its newest thousand', () => {
  const { room } = night();
  for (let i = 0; i < 1500; i += 1) room.report('ana', null, 'report ' + i);
  const kept = room.reports();
  assert.equal(kept.length, 1000);
  assert.deepEqual([kept[0].why, kept.at(-1).why], ['report 500', 'report 1499']);
});

test('a full report log drops handled reports first, oldest first, and the oldest of the rest only when none is handled', () => {
  const { room } = night();
  for (let i = 0; i < 1000; i += 1) room.report('ana', null, 'report ' + i);
  room.markHandled('r3', true);   // 'report 2'
  room.markHandled('r7', true);   // 'report 6'
  room.report('ana', null, 'one more');
  let kept = room.reports().map((r) => r.why);
  assert.equal(kept.length, 1000);
  assert.deepEqual([kept.includes('report 2'), kept.includes('report 0'), kept.includes('report 6')], [false, true, true], 'the oldest handled one went');
  room.report('ana', null, 'and another');
  kept = room.reports().map((r) => r.why);
  assert.deepEqual([kept.includes('report 6'), kept.includes('report 0')], [false, true], 'then the next handled one');
  room.report('ana', null, 'and one more');
  assert.equal(room.reports()[0].why, 'report 1', 'with none handled, the oldest');
});

// ---------- what the venue's staff see (staff spec §1) ----------

test('staff see each report newest first, the person as a tag with how often and by how many — never who reported', () => {
  const { room, handleOf } = night();
  room.arm('ben', 'hi');
  room.report('ana', handleOf('ana', 'ben'), 'followed me');
  room.report('cai', handleOf('cai', 'ben'), '');
  room.report('ana', handleOf('ana', 'ben'), 'again');
  room.report('cai', null, 'spill by the stairs');
  // A tag that gives nothing away, as the relay's HMAC does.
  const tags = new Map();
  const tag = (id) => { if (!tags.has(id)) tags.set(id, 'P-' + (tags.size + 1)); return tags.get(id); };
  const list = room.staffReports(tag);
  assert.deepEqual(list.map((r) => r.id), ['r4', 'r3', 'r2', 'r1']);
  assert.deepEqual(list[1], {
    id: 'r3', at: list[1].at, about: 'P-1', times: 3, people: 2, bandNow: 'by the stage',
    bandThen: 'by the stage', fromThen: 'near the bar', why: 'again', handledAt: 0,
  });
  assert.deepEqual([list[0].about, list[0].times, list[0].people, list[0].bandNow, list[0].bandThen, list[0].fromThen],
    [null, 0, 0, null, null, 'in this room']);
  const text = JSON.stringify(list);
  for (const secret of ['ana', 'ben', 'cai', 'ANA', 'BEN', 'CAI', '@ana', '@ben', '@cai', handleOf('ana', 'ben'), handleOf('cai', 'ben')]) {
    assert.equal(text.includes(secret), false, secret + ' reached staff');
  }
});

test('staff see where a reported person is now, and that they left', () => {
  const { room, handleOf, tick } = night();
  room.arm('ben', 'hi');
  room.report('ana', handleOf('ana', 'ben'), '');
  tick(HEARD_MS + 1);
  place(room, [['ben', 'somewhere out the back']]);
  const [r] = room.staffReports(() => 'P-1');
  assert.deepEqual([r.bandThen, r.bandNow], ['by the stage', 'somewhere out the back']);
  room.leave('ben');
  assert.equal(room.staffReports(() => 'P-1')[0].bandNow, 'left');
});

test('a report is marked handled with the time, and opened again; one that is not there is false', () => {
  const { room, tick } = night();
  room.report('ana', null, 'spill');
  tick(60_000);
  assert.equal(room.markHandled('r1', true), true);
  const at = room.staffReports(() => '')[0].handledAt;
  assert.ok(at > 0);
  tick(1000);
  room.markHandled('r1', true);
  assert.equal(room.staffReports(() => '')[0].handledAt, at, 'marking it again keeps when it was first handled');
  assert.equal(room.markHandled('r1', false), true);
  assert.equal(room.staffReports(() => '')[0].handledAt, 0);
  assert.equal(room.markHandled('r9', true), false);
  assert.equal(room.hasReports(), true);
});

test('the reports of a night that is over can be let go, oldest first, and only those', () => {
  const { room, tick } = night();
  assert.equal(room.hasReports(), false);
  room.report('ana', null, 'old');
  const oldAt = room.reports()[0].at;
  tick(1000);
  room.report('ana', null, 'new');
  assert.equal(room.forgetReports((at) => at <= oldAt), true);
  assert.deepEqual(room.reports().map((r) => r.why), ['new']);
  assert.equal(room.forgetReports((at) => at <= oldAt), false);
  assert.equal(room.forgetReports(() => true), true);
  assert.equal(room.hasReports(), false);
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

// ---------- the opener: FIRST SONG?'s answer, once the venue's staff name it ----------

test('the opener, once named, is in every view; cut to a track\'s length, and an empty one takes it back', () => {
  let t = 1000;
  const room = createRoom({ now: () => t, salt: 'o' });
  room.join('ana');
  room.join('ben');
  assert.equal(room.viewFor('ana').opener, null);
  assert.equal(room.setOpener('  Treasure  '), true);
  assert.deepEqual(room.viewFor('ana').opener, { track: 'Treasure', at: 1000 });
  assert.deepEqual(room.viewFor('ben').opener, { track: 'Treasure', at: 1000 });
  t = 2000;
  assert.equal(room.setOpener('Treasure'), false, 'the same again is no change');
  assert.equal(room.viewFor('ana').opener.at, 1000, 'and keeps when it was named');
  assert.equal(room.setOpener('x'.repeat(100)), true);
  assert.equal(room.viewFor('ana').opener.track.length, 60);
  assert.equal(room.setOpener(''), true);
  assert.equal(room.viewFor('ana').opener, null);
  assert.equal(room.setOpener(null), false, 'nothing to take back');
  assert.equal(room.opener(), null);
  room.setOpener('Grenade');
  assert.deepEqual(room.opener(), { track: 'Grenade', at: 2000 });
});

test('the same song spelled better keeps when it was named; another song is named anew', () => {
  let t = 1000;
  const room = createRoom({ now: () => t, salt: 'o' });
  room.join('ana');
  room.setOpener('desire lines');
  t = 5000;
  assert.equal(room.setOpener('Desire Lines'), true, 'the words change');
  assert.deepEqual(room.viewFor('ana').opener, { track: 'Desire Lines', at: 1000 }, 'the moment does not: no phone or band hears it twice');
  t = 9000;
  assert.equal(room.setOpener('Desire Line'), true);
  assert.deepEqual(room.opener(), { track: 'Desire Line', at: 9000 }, 'a different song is a new naming');
  room.setOpener('');
  t = 12000;
  room.setOpener('Desire Line');
  assert.equal(room.opener().at, 12000, 'taken back and named again is a new naming');
});

// ---------- what else the venue's staff say: a notice, and the show's times moved ----------

test('a notice from staff is in every view, one line of at most 140 characters, and an empty one takes it down', () => {
  let t = 1000;
  const room = createRoom({ now: () => t, salt: 'n' });
  room.join('ana');
  room.join('ben');
  assert.equal(room.viewFor('ana').notice, null);
  assert.equal(room.setNotice('  Headline is' + String.fromCharCode(10) + ' 20 minutes   late  '), true);
  assert.deepEqual(room.viewFor('ana').notice, { text: 'Headline is 20 minutes late', at: 1000 });
  assert.deepEqual(room.viewFor('ben').notice, room.viewFor('ana').notice);
  t = 2000;
  assert.equal(room.setNotice('Headline is 20 minutes late'), false, 'the same again is no change');
  assert.equal(room.setNotice('y'.repeat(300)), true);
  assert.equal(room.viewFor('ana').notice.text.length, 140);
  assert.equal(room.setNotice(''), true);
  assert.equal(room.viewFor('ana').notice, null);
  assert.equal(room.setNotice(null), false);
});

test("times are moved only as five clock times in the night's order, and null puts them back as listed", () => {
  let t = 1000;
  const room = createRoom({ now: () => t, salt: 'm' });
  room.join('ana');
  const five = { doors: '19:00', support: '20:10', break: '20:55', headline: '21:50', end: '00:30' };
  assert.equal(room.viewFor('ana').times, null);
  for (const bad of [
    null, 'x', [], {}, { ...five, end: undefined }, { ...five, headline: '9:50' }, { ...five, headline: '24:00' },
    { ...five, support: '18:59' }, { ...five, end: '06:00' }, { ...five, doors: 1900 },
  ]) assert.equal(room.setTimes(bad), false, JSON.stringify(bad));
  assert.equal(room.viewFor('ana').times, null);
  assert.equal(room.setTimes({ ...five, extra: 'no' }), true, 'past midnight is later, not earlier');
  assert.deepEqual(room.viewFor('ana').times, { ...five, at: 1000 });
  t = 2000;
  assert.equal(room.setTimes({ ...five }), false, 'the same again is no change');
  assert.equal(room.setTimes({ ...five, headline: '21:55' }), true);
  assert.equal(room.times().at, 2000);
  assert.equal(room.setTimes({ ...five, break: '20:10', headline: '20:10' }), true, 'two parts may start together');
  assert.equal(room.setTimes(null), true);
  assert.equal(room.viewFor('ana').times, null);
  assert.equal(room.setTimes(null), false);
});

test('the night ends: the opener, a notice and moved times said before it go, and what was said after stays', () => {
  let t = 100;
  const room = createRoom({ now: () => t, salt: 'g' });
  room.join('ana');
  room.setOpener('Treasure');
  t = 200;
  room.setNotice('Bar closes at 23:00');
  t = 300;
  room.setTimes({ doors: '19:00', support: '20:00', break: '20:45', headline: '21:30', end: '23:00' });
  assert.equal(room.letGo((at) => at < 100), false, 'nothing that old');
  assert.equal(room.letGo((at) => at < 250), true);
  const v = room.viewFor('ana');
  assert.deepEqual([v.opener, v.notice, v.times?.at], [null, null, 300]);
  assert.equal(room.letGo(() => true), true);
  assert.equal(room.viewFor('ana').times, null);
});

test('a notice and moved times are carried across a restart; a dump from before them, or a bad one, has none', () => {
  const now = () => 5000;
  const room = createRoom({ now });
  room.join('ana');
  room.setNotice('Cloakroom is full');
  room.setTimes({ doors: '19:00', support: '20:00', break: '20:45', headline: '21:40', end: '23:00' });
  const back = carried(room, now).viewFor('ana');
  assert.deepEqual(back.notice, { text: 'Cloakroom is full', at: 5000 });
  assert.equal(back.times.headline, '21:40');
  const old = JSON.parse(JSON.stringify(room.dump()));
  delete old.notice;
  old.times = { ...old.times, headline: '18:00' };
  const v = createRoom({ now, restore: old }).viewFor('ana');
  assert.deepEqual([v.notice, v.times], [null, null]);
});

// ---------- restart spec §1: a room carried across a restart ----------

/** A room as a restart brings it back: its dump, through JSON, made again on the same clock. */
const carried = (room, now) => createRoom({ now, restore: JSON.parse(JSON.stringify(room.dump())) });

test('the opener is carried across a restart, and a dump from before there was one has none', () => {
  const now = () => 5000;
  const room = createRoom({ now });
  room.join('ana');
  room.setOpener('24K Magic');
  assert.deepEqual(carried(room, now).viewFor('ana').opener, { track: '24K Magic', at: 5000 });
  const old = JSON.parse(JSON.stringify(room.dump()));
  delete old.opener;
  assert.equal(createRoom({ now, restore: old }).viewFor('ana').opener, null);
});

test('a room carried across a restart shows everyone what it did, and goes on from where it was', () => {
  let t = Date.UTC(2026, 8, 29, 11, 0);
  const now = () => t;
  const room = createRoom({ now });
  const ids = ['ana', 'ben', 'cai', 'dan', 'eve'];
  for (const id of ids) {
    room.join(id);
    room.setProfile(id, { name: id.toUpperCase(), contact: '@' + id });
    room.pick(id, 'track of ' + id);
  }
  /** The handle `viewer` is shown for `target`, found by the answer only `target` gave. */
  const h = (r, viewer, target) => r.viewFor(viewer).wall.find((p) => p.pick === 'track of ' + target).handle;
  // Ana and Ben meet on SAY HI; both keep, and Ana has said she found him.
  room.arm('ana', 'hi');
  room.arm('ben', 'hi');
  room.wave('ana', h(room, 'ana', 'ben'));
  t += 1000;
  const match = room.wave('ben', h(room, 'ben', 'ana'));
  room.keep('ana', match.id, true);
  room.keep('ben', match.id, true);
  room.found('ana', match.id);
  // Cai waves at Ana, not returned; Dan likes Eve's answer; Eve blocks Cai.
  room.arm('cai', 'hi');
  t += 1000;
  room.wave('cai', h(room, 'cai', 'ana'));
  room.like('dan', h(room, 'dan', 'eve'));
  room.block('eve', h(room, 'eve', 'cai'));
  // Dan reports Ben in his own words, the venue marks it handled, and Dan goes NOT NOW.
  room.report('dan', h(room, 'dan', 'ben'), 'kept following me');
  room.markHandled('r1', true);
  room.setInvisible('dan', true);
  // Cai leaves: the room keeps his rev, and Eve's block.
  room.leave('cai');

  const again = carried(room, now);
  const tag = (id) => 'P-' + id;
  const same = (why) => {
    for (const id of ids) {
      assert.deepEqual(again.viewFor(id), room.viewFor(id), id + "'s view " + why);
      assert.deepEqual(again.wavesAt(id), room.wavesAt(id), id + "'s waves " + why);
    }
    assert.deepEqual(again.staffReports(tag), room.staffReports(tag), "the venue's list " + why);
  };
  same('after the restart');

  // From here the two go on alike: Dan back on SAY HI and a match with Ana, a report, Cai back.
  t += 1000;
  for (const r of [room, again]) {
    r.arm('dan', 'hi');
    r.wave('dan', h(r, 'dan', 'ana'));
    r.wave('ana', h(r, 'ana', 'dan'));
    r.report('ana', null, 'a spill by the stairs');
    r.join('cai');
  }
  same('as the night goes on');
  assert.equal(again.viewFor('dan').matches[0].id, 'm2', 'the next match takes the next id');
  assert.equal(again.staffReports(tag)[0].id, 'r2', 'the next report takes the next id');
  assert.equal(again.viewFor('cai').me.rev, room.viewFor('cai').me.rev, "Cai's rev goes on from his tomb");
});

test('a room carried across a restart drops every clip, and a dance back sent before it still makes the match', () => {
  const room = createRoom();
  for (const id of ['ana', 'ben']) room.join(id);
  room.pick('ben', 'Treasure');
  room.postClip('ana', 'clip-of-ana');
  const [onFloor] = room.viewFor('ben').floor;              // Ana dancing, on Ben's floor
  assert.equal(room.danceBack('ben', onFloor.handle, 'clip-of-ben'), null, 'a yes, not returned yet');
  assert.equal(JSON.stringify(room.dump()).includes('clip-of'), false, 'no clip ref is written');
  const again = carried(room, Date.now);
  assert.equal(again.viewFor('ana').me.clip, null, 'her own clip is gone');
  assert.deepEqual(again.viewFor('ana').floor, [], "Ben's dance to her went with its clip");
  const [ben] = again.viewFor('ana').wall;                   // Ben, by his answer
  const match = again.danceBack('ana', ben.handle, 'clip-of-ana-again');
  assert.equal(match?.intent, 'dance', "Ben's yes from before the restart still counts");
});
