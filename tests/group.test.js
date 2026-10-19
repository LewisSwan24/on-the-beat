// ON THE BEAT — a meeting of three or four: a newcomer joins only when everyone in it says yes, all of them under
// one number at one spot; LET'S FINISH in a group of three or more takes only yourself out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, GROUP_MAX, JOIN_MS } from '../relay/room.js';
import { bandShow } from '../relay/band.js';

function night(ids = ['ana', 'ben', 'cai', 'dee', 'eve']) {
  let t = Date.UTC(2026, 9, 19, 9, 0);
  const room = createRoom({ now: () => t, salt: 'group' });
  for (const id of ids) {
    room.join(id);
    room.setProfile(id, { name: id.toUpperCase(), contact: '@' + id });
    room.pick(id, 'Track ' + id);   // every band here reads "in this room": a pick tells them apart
  }
  const handleOf = (viewer, target, list = 'near') =>
    room.viewFor(viewer)[list].find((p) => p.pick === room.viewFor(target).me.pick)?.handle;
  const wave = (a, b) => room.wave(a, handleOf(a, b));
  const both = (a, b, card = 'hi') => {
    room.arm(a, card); room.arm(b, card);
    wave(a, b);
    return wave(b, a);
  };
  return { room, handleOf, wave, both, tick: (ms) => { t += ms; }, now: () => t };
}

const open = (room, id) => room.viewFor(id).matches.filter((m) => !m.finishedAt);
const groupOf = (room, id) => [...new Set(open(room, id).map((m) => m.name))].sort();

test('two people meet as before: a pair is a group of two, with no one else in it', () => {
  const { room, both } = night();
  const m = both('ana', 'ben');
  assert.ok(m && m.id, 'a match');
  const [seen] = room.viewFor('ana').matches;
  assert.equal(seen.group, m.id, "a pair's group is its own id");
  assert.deepEqual(seen.with, [], 'no one else');
  assert.deepEqual(room.viewFor('ana').joinAsks, []);
  assert.deepEqual(room.viewFor('ana').joining, []);
});

test('a third who says yes to one of a pair is asked of the other, and joins under the same number when they say yes', () => {
  const { room, both, wave } = night();
  const ab = both('ana', 'ben');
  room.arm('cai', 'hi');
  wave('cai', 'ana');
  assert.equal(wave('ana', 'cai'), null, 'Ana and Cai said yes both ways: not a pair of their own, an ask of Ben');
  assert.equal(open(room, 'ana').length, 1, 'still only Ana and Ben');
  const [asked] = room.viewFor('ben').joinAsks;
  assert.deepEqual([asked.pick, asked.via], ['Track cai', 'ANA'], 'Ben is asked about Cai, by her band and pick, who came by Ana');
  assert.ok(!JSON.stringify(room.viewFor('ben').joinAsks).includes('CAI'), 'never her name before his yes');
  assert.deepEqual(room.viewFor('ana').joinAsks, [], 'Ana already said yes to Cai');
  const [waiting] = room.viewFor('cai').joining;
  assert.deepEqual([waiting.waiting, waiting.refusedAt], [1, null], 'Cai waits on one more yes');
  assert.ok(!JSON.stringify(room.viewFor('cai').joining).includes('BEN'), 'never a name before the yes');

  assert.equal(room.admit('ben', asked.id, 'yes'), true);
  assert.deepEqual(groupOf(room, 'cai'), ['ANA', 'BEN'], 'Cai meets both');
  assert.deepEqual(groupOf(room, 'ana'), ['BEN', 'CAI']);
  assert.deepEqual(groupOf(room, 'ben'), ['ANA', 'CAI']);
  const all = ['ana', 'ben', 'cai'].flatMap((id) => open(room, id));
  assert.deepEqual([...new Set(all.map((m) => m.number))], [ab.number], 'one number for all three');
  assert.deepEqual([...new Set(all.map((m) => m.spot))], [ab.spot], 'one spot');
  assert.deepEqual([...new Set(all.map((m) => m.group))], [ab.id], 'one group');
  const caiAna = open(room, 'cai').find((m) => m.name === 'ANA');
  assert.deepEqual(caiAna.with, ['BEN'], 'each meeting names who else is in it');
  assert.deepEqual(room.viewFor('cai').joining, [], 'nothing left waiting');
  assert.deepEqual(room.viewFor('ben').joinAsks, []);
});

test('anyone in the group saying no keeps the newcomer out, and they are not asked about again', () => {
  const { room, both, wave } = night();
  both('ana', 'ben');
  room.arm('cai', 'hi');
  wave('cai', 'ana');
  wave('ana', 'cai');
  const [asked] = room.viewFor('ben').joinAsks;
  assert.equal(room.admit('ben', asked.id, 'no'), true);
  assert.deepEqual(groupOf(room, 'ana'), ['BEN'], 'still the two of them');
  assert.deepEqual(open(room, 'cai'), [], 'Cai meets nobody');
  assert.ok(room.viewFor('cai').joining[0].refusedAt, 'Cai is told it did not happen');
  assert.ok(!JSON.stringify(room.viewFor('cai')).includes('BEN'), 'and never who said no');
  assert.deepEqual(room.viewFor('ben').joinAsks, []);
  assert.equal(wave('ana', 'cai'), null, 'a yes again asks nobody again');
  assert.deepEqual(room.viewFor('ben').joinAsks, []);
  assert.equal(room.admit('ben', asked.id, 'yes'), false, 'an answered ask is over');
});

test('only those asked can answer, once each, and an ask nobody answers runs out', () => {
  const { room, both, wave, tick } = night();
  both('ana', 'ben');
  room.arm('cai', 'hi');
  wave('cai', 'ana');
  wave('ana', 'cai');
  const [asked] = room.viewFor('ben').joinAsks;
  assert.equal(room.admit('cai', asked.id, 'yes'), false, 'not the newcomer');
  assert.equal(room.admit('dee', asked.id, 'yes'), false, 'not someone outside');
  assert.equal(room.admit('ben', asked.id, 'maybe'), false);
  tick(JOIN_MS + 1);
  assert.deepEqual(room.viewFor('ben').joinAsks, [], 'gone when it runs out');
  assert.ok(room.viewFor('cai').joining[0].refusedAt, 'Cai is told');
  assert.equal(room.admit('ben', asked.id, 'yes'), false);
  assert.deepEqual(groupOf(room, 'ana'), ['BEN']);
});

test('a fourth needs all three; a fifth is never asked about: the group is full at four', () => {
  const { room, both, wave } = night();
  both('ana', 'ben');
  room.arm('cai', 'hi');
  wave('cai', 'ana'); wave('ana', 'cai');
  room.admit('ben', room.viewFor('ben').joinAsks[0].id, 'yes');
  room.arm('dee', 'hi');
  wave('dee', 'cai'); wave('cai', 'dee');
  const ask = room.viewFor('ana').joinAsks[0];
  assert.deepEqual([ask.pick, ask.via], ['Track dee', 'CAI']);
  assert.equal(room.admit('ana', ask.id, 'yes'), true);
  assert.deepEqual(open(room, 'dee'), [], 'Ben has not said yet');
  assert.equal(room.viewFor('dee').joining[0].waiting, 1);
  room.admit('ben', room.viewFor('ben').joinAsks[0].id, 'yes');
  assert.deepEqual(groupOf(room, 'dee'), ['ANA', 'BEN', 'CAI']);
  assert.equal(GROUP_MAX, 4);
  room.arm('eve', 'hi');
  wave('eve', 'dee');
  const full = wave('dee', 'eve');
  assert.ok(full && full.id, 'a full group: Dee and Eve meet as a pair of their own, as before groups');
  assert.notEqual(full.group, open(room, 'ana')[0].group);
  for (const id of ['ana', 'ben', 'cai']) assert.deepEqual(room.viewFor(id).joinAsks, [], id + ' is not asked');
});

test('only the same card groups: a yes on another card is a pair of its own, as before', () => {
  const { room, both } = night();
  const ab = both('ana', 'ben');
  room.arm('cai', 'song');
  const m = (() => {
    const h = (v, t) => room.viewFor(v).wall.find((p) => p.pick === room.viewFor(t).me.pick)?.handle;
    room.like('cai', h('cai', 'ana'));
    return room.like('ana', h('ana', 'cai'));
  })();
  assert.ok(m && m.id, 'a FIRST SONG? match');
  assert.notEqual(m.number, ab.number);
  assert.deepEqual(room.viewFor('ben').joinAsks, [], 'Ben is not asked: it is not the meeting he is in');
});

test("LET'S FINISH in a group of three takes only you out: no ask, the others go on, and only you hear it finish", () => {
  const { room, both, wave, tick, now } = night();
  both('ana', 'ben');
  room.arm('cai', 'hi');
  wave('cai', 'ana'); wave('ana', 'cai');
  room.admit('ben', room.viewFor('ben').joinAsks[0].id, 'yes');
  tick(60_000);
  const mine = open(room, 'cai')[0];
  assert.equal(room.finish('cai', mine.id, 'ask'), true, 'Cai leaves at once');
  assert.deepEqual(open(room, 'cai'), [], 'every meeting of Cai in the group is over');
  assert.ok(room.viewFor('cai').matches.every((m) => m.left === 'you'));
  assert.deepEqual(groupOf(room, 'ana'), ['BEN'], 'Ana and Ben go on');
  const anaCai = room.viewFor('ana').matches.find((m) => m.name === 'CAI');
  assert.equal(anaCai.left, 'them');
  assert.equal(room.viewFor('cai').me.armed, null, 'Cai is done with the card');
  assert.equal(room.viewFor('ana').me.armed, 'hi', 'Ana is not');
  const showOf = (id) => bandShow({ view: room.viewFor(id), now: now() });
  assert.ok(showOf('cai').finished, "Cai's band plays the meeting finished");
  assert.ok(!showOf('ana').finished, "Ana's does not: hers goes on");
  // Down to two, it is a pair again: finishing asks.
  const ab = open(room, 'ana')[0];
  assert.equal(room.finish('ana', ab.id, 'ask'), true);
  assert.equal(room.viewFor('ben').matches.find((m) => m.id === ab.id).finishAsked, 'them');
});

test('a group carries across a restart', () => {
  const { room, both, wave, now } = night();
  both('ana', 'ben');
  room.arm('cai', 'hi');
  wave('cai', 'ana'); wave('ana', 'cai');
  const before = room.viewFor('ben').joinAsks[0];
  const again = createRoom({ now, salt: 'group', restore: JSON.parse(JSON.stringify(room.dump())) });
  for (const id of ['ana', 'ben', 'cai']) again.join(id);
  const [ask] = again.viewFor('ben').joinAsks;
  assert.equal(ask?.id, before.id, 'the ask is still there');
  assert.equal(again.admit('ben', ask.id, 'yes'), true);
  assert.deepEqual(groupOf(again, 'cai'), ['ANA', 'BEN']);
});

// ---------- on the phone ----------

import { finishRows, alsoLine } from '../app/lib/group.js';
import { JOIN } from '../app/copy.js';

test('the FINISH list shows a meeting of three as one row with both names, and a pair as before', () => {
  const pair = { id: 'm1', group: 'm1', with: [], name: 'Mo', intent: 'song', at: 5, finishedAt: null };
  const ab = { id: 'm2', group: 'm2', with: ['Cai'], name: 'Ben', intent: 'hi', at: 1, finishedAt: null };
  const ac = { id: 'm3', group: 'm2', with: ['Ben'], name: 'Cai', intent: 'hi', at: 2, finishedAt: null };
  const rows = finishRows([pair, ab, ac]);
  assert.deepEqual(rows.map((r) => [r.key, r.names, r.many, r.match.id]), [
    ['m1', ['Mo'], false, 'm1'],
    ['m2', ['Ben', 'Cai'], true, 'm3'],
  ], 'newest first; a group asks by its newest meeting');
  const left = finishRows([{ ...ab, finishedAt: 9, left: 'you' }, { ...ac, finishedAt: 9, left: 'you', with: [] }]);
  assert.deepEqual([left[0].done, left[0].names], [true, ['Ben', 'Cai']], 'left: finished, and still says who with');
  const goneOn = finishRows([{ ...ab, with: [] }, { ...ac, finishedAt: 9, left: 'them', with: [] }]);
  assert.deepEqual([goneOn[0].names, goneOn[0].many, goneOn[0].done], [['Ben'], false, false], 'Cai left: a pair again');
});

test('who else is in a meeting, said once on its screen', () => {
  assert.equal(alsoLine({ with: [] }), '');
  assert.equal(alsoLine({ with: ['Ben'] }), 'Ben is in this meeting too.');
  assert.equal(alsoLine({ with: ['Ben', 'Cai'] }), 'Ben and Cai are in this meeting too.');
  assert.match(JOIN.sub('Ana', 'hi'), /Ana/);
  assert.ok(JOIN.title && JOIN.yes && JOIN.no && JOIN.waiting && JOIN.refused);
  assert.equal(JOIN.left('Cai'), 'Cai headed off. the rest of you go on.');
});

test('someone forgotten at the end of the night takes their asks to join with them', () => {
  const { room, both, wave } = night();
  both('ana', 'ben');
  room.arm('cai', 'hi');
  wave('cai', 'ana'); wave('ana', 'cai');
  assert.equal(room.dump().joins.length, 1);
  room.forgetPerson('cai');
  assert.deepEqual(room.dump().joins, [], "Cai's ask is gone with Cai");
  assert.deepEqual(room.viewFor('ben').joinAsks, []);
});

// ---------- what an ask must still be true of when it is answered (security review, 19 Oct 2026) ----------

/** Ana and Ben meet; Cai and Ana say yes both ways: Ben is asked. */
function asking(t) {
  t.both('ana', 'ben');
  t.room.arm('cai', 'hi');
  t.wave('cai', 'ana');
  t.wave('ana', 'cai');
  return t.room.viewFor('ben').joinAsks[0];
}

test('a block inside a meeting of three takes the one who blocked out of it: they never stay at a spot with the person', () => {
  const t = night();
  const ask = asking(t);
  t.room.admit('ben', ask.id, 'yes');
  const benCai = open(t.room, 'ben').find((m) => m.name === 'CAI');
  assert.equal(t.room.block('ben', benCai.id), true);
  assert.deepEqual(open(t.room, 'ben'), [], 'Ben is out of the meeting');
  assert.deepEqual(groupOf(t.room, 'ana'), ['CAI'], 'Ana and Cai go on');
  assert.ok(open(t.room, 'cai').every((m) => !m.with.includes('BEN')), 'Cai is not told Ben is there');
});

test('a block while an ask is open ends the ask', () => {
  const t = night();
  const ask = asking(t);
  t.room.block('ben', t.handleOf('ben', 'cai'));
  assert.deepEqual(t.room.viewFor('ben').joinAsks, []);
  assert.equal(t.room.admit('ben', ask.id, 'yes'), false);
  assert.deepEqual(open(t.room, 'cai'), [], 'Cai meets nobody');
});

test('a newcomer gone NOT NOW by the time everyone said yes does not join', () => {
  const t = night();
  const ask = asking(t);
  t.room.setInvisible('cai', true);
  t.room.admit('ben', ask.id, 'yes');
  assert.deepEqual(open(t.room, 'cai'), []);
  assert.deepEqual(groupOf(t.room, 'ana'), ['BEN']);
});

test('a newcomer asked about to two meetings joins one, and the other ask ends', () => {
  const t = night(['ana', 'ben', 'cai', 'dee', 'eve']);
  t.both('ana', 'ben');
  t.both('dee', 'eve');
  t.room.arm('cai', 'hi');
  t.wave('cai', 'ana'); t.wave('ana', 'cai');
  t.wave('cai', 'dee'); t.wave('dee', 'cai');
  const toBen = t.room.viewFor('ben').joinAsks[0];
  const toEve = t.room.viewFor('eve').joinAsks[0];
  assert.ok(toBen && toEve, 'both meetings are asked');
  t.room.admit('ben', toBen.id, 'yes');
  assert.deepEqual(groupOf(t.room, 'cai'), ['ANA', 'BEN']);
  assert.deepEqual(t.room.viewFor('eve').joinAsks, [], 'the other ask ended');
  assert.equal(t.room.admit('eve', toEve.id, 'yes'), false);
  assert.deepEqual(groupOf(t.room, 'cai'), ['ANA', 'BEN'], 'one meeting on the card, never two');
});

test('a newcomer who met someone else on that card while asked about does not join as well', () => {
  const t = night();
  const ask = asking(t);
  t.both('cai', 'dee');                     // Cai and Dee, a pair of their own: Dee is in no meeting
  assert.equal(open(t.room, 'cai').length, 1);
  t.room.admit('ben', ask.id, 'yes');
  assert.deepEqual(groupOf(t.room, 'cai'), ['DEE'], 'one meeting on the card, never two');
  assert.deepEqual(groupOf(t.room, 'ana'), ['BEN']);
});

test('everyone in a meeting says yes, here or not: one who stepped out is still asked, and is asked on coming back', () => {
  const t = night();
  t.room.admit('ben', asking(t).id, 'yes');          // Ana, Ben and Cai
  t.room.arm('dee', 'hi');
  t.wave('dee', 'ana'); t.wave('ana', 'dee');
  t.room.leave('cai');                                // Cai steps out of the room
  t.room.admit('ben', t.room.viewFor('ben').joinAsks[0].id, 'yes');
  assert.deepEqual(open(t.room, 'dee'), [], 'not without Cai');
  assert.equal(t.room.viewFor('dee').joining[0].waiting, 1);
  t.room.join('cai');
  t.room.setProfile('cai', { name: 'CAI' });   // a phone back in the room says its name again
  const [ask] = t.room.viewFor('cai').joinAsks;
  assert.ok(ask, 'Cai is asked when back');
  t.room.admit('cai', ask.id, 'yes');
  assert.deepEqual(groupOf(t.room, 'dee'), ['ANA', 'BEN', 'CAI']);
});

test('one who said yes and stepped out is met on coming back: the last yes waits for them, and nothing throws', () => {
  const t = night();
  t.room.admit('ben', asking(t).id, 'yes');          // Ana, Ben and Cai
  t.room.arm('dee', 'hi');
  t.wave('dee', 'ana'); t.wave('ana', 'dee');
  t.room.admit('cai', t.room.viewFor('cai').joinAsks[0].id, 'yes');
  t.room.leave('cai');
  assert.doesNotThrow(() => t.room.admit('ben', t.room.viewFor('ben').joinAsks[0].id, 'yes'));
  assert.deepEqual(open(t.room, 'dee'), [], 'not while Cai is out');
  t.room.join('cai');
  assert.deepEqual(groupOf(t.room, 'dee'), ['ANA', 'BEN', 'CAI'], 'back in the room, her yes from before lets Dee in');
});

// ---------- found, in a meeting of three (the wristband's SIDE hold, the phone's found) ----------

test('in a meeting of three, each saying found once finds them all; the band plays found only when all have', () => {
  const t = night();
  t.room.admit('ben', asking(t).id, 'yes');
  t.tick(1000);
  const show = (id) => bandShow({ view: t.room.viewFor(id), now: t.now() });
  // As the relay takes a SIDE hold: the newest meeting under that number not found by both.
  const hold = (id) => {
    const m = t.room.viewFor(id).matches.filter((x) => !x.foundAt).sort((a, b) => b.at - a.at)[0];
    return t.room.found(id, m.id);
  };
  hold('ana');
  hold('ben');
  assert.equal(show('ana').small, 'FOUND: WAITING', 'Ana said it, and waits for Cai');
  assert.ok(!show('ana').found, 'no found yet: Cai has not said it');
  hold('cai');
  for (const id of ['ana', 'ben', 'cai']) {
    assert.ok(t.room.viewFor(id).matches.every((m) => m.foundAt), id + ': every pair found');
    assert.notEqual(show(id).kind, 'meet', id + "'s band stops blinking the number");
    assert.ok(show(id).found, id + "'s band plays found");
  }
});

test('a newcomer who takes back their yes before everyone answers is not let in, and the ask ends', () => {
  const { room, handleOf } = night();
  for (const id of ['ana', 'ben', 'cai']) room.arm(id, 'song');
  room.like('ana', handleOf('ana', 'ben', 'wall'));
  assert.ok(room.like('ben', handleOf('ben', 'ana', 'wall')), 'Ana and Ben meet on FIRST SONG');
  room.like('cai', handleOf('cai', 'ana', 'wall'));
  room.like('ana', handleOf('ana', 'cai', 'wall'));
  const [asked] = room.viewFor('ben').joinAsks;
  assert.ok(asked, 'Ben is asked about Cai');
  room.unlike('cai', handleOf('cai', 'ana', 'wall'));
  assert.deepEqual(room.viewFor('ben').joinAsks, [], 'the ask is gone from Ben');
  assert.equal(room.admit('ben', asked.id, 'yes'), false, 'nothing left to say yes to');
  assert.deepEqual(open(room, 'cai'), [], 'Cai meets nobody');
  assert.deepEqual(groupOf(room, 'ana'), ['BEN'], 'still the two of them');
});

test('when the one a newcomer came by leaves the meeting, the ask ends: nobody is let in through someone gone', () => {
  const t = night();
  t.room.admit('ben', asking(t).id, 'yes');   // Ana, Ben and Cai
  t.room.arm('dee', 'hi');
  t.wave('dee', 'ana');
  t.wave('ana', 'dee');
  const [asked] = t.room.viewFor('ben').joinAsks;
  assert.ok(asked, 'Ben is asked about Dee, who came by Ana');
  const mine = t.room.viewFor('ana').matches.find((m) => !m.finishedAt);
  assert.equal(t.room.finish('ana', mine.id, 'ask'), true, 'Ana leaves');
  assert.deepEqual(t.room.viewFor('ben').joinAsks, [], 'the ask is gone from Ben');
  assert.deepEqual(t.room.viewFor('cai').joinAsks, [], 'and from Cai');
  assert.equal(t.room.admit('ben', asked.id, 'yes'), false);
  assert.deepEqual(open(t.room, 'dee'), [], 'Dee meets nobody');
});

test('when staff close the card a meeting is on, an open ask on it ends', () => {
  const t = night();
  const asked = asking(t);
  assert.equal(t.room.setClosed(['hi']), true, 'staff close SAY HI');
  assert.deepEqual(t.room.viewFor('ben').joinAsks, [], 'the ask is gone from Ben');
  assert.equal(t.room.admit('ben', asked.id, 'yes'), false);
  assert.deepEqual(open(t.room, 'cai'), [], 'Cai meets nobody on a closed card');
});

test('when the one a newcomer came by blocks someone and so leaves the meeting, the ask ends', () => {
  const t = night();
  t.room.admit('ben', asking(t).id, 'yes');   // Ana, Ben and Cai
  t.room.arm('dee', 'hi');
  t.wave('dee', 'ana');
  t.wave('ana', 'dee');
  const [asked] = t.room.viewFor('cai').joinAsks;
  assert.ok(asked, 'Cai is asked about Dee, who came by Ana');
  const anaBen = t.room.viewFor('ana').matches.find((m) => m.name === 'BEN');
  assert.equal(t.room.block('ana', anaBen.id), true, 'Ana blocks Ben, and leaves');
  assert.deepEqual(t.room.viewFor('cai').joinAsks, [], 'the ask is gone from Cai');
  assert.equal(t.room.admit('cai', asked.id, 'yes'), false);
  assert.deepEqual(open(t.room, 'dee'), [], 'Dee meets nobody');
});

test('a member who goes invisible ends an open ask: nobody is let in to meet someone who hid', () => {
  const t = night();
  const asked = asking(t);
  t.room.setInvisible('ana', true);
  assert.deepEqual(t.room.viewFor('ben').joinAsks, [], 'the ask is gone from Ben');
  assert.equal(t.room.admit('ben', asked.id, 'yes'), false);
  t.room.setInvisible('ana', false);
  assert.deepEqual(open(t.room, 'cai'), [], 'Cai meets nobody');
});

test('someone in the room is named in a meeting only by the name they give now, never an older one', () => {
  const t = night();
  t.room.admit('ben', asking(t).id, 'yes');   // Ana, Ben and Cai
  t.room.setProfile('ana', { name: '', contact: '@ana' });
  const benCai = t.room.viewFor('ben').matches.find((m) => m.name === 'CAI');
  assert.deepEqual(benCai.with, [''], 'Ana gives no name now, so none is shown');
});

test('someone out of the room is named by what they met under in this meeting, not in another', () => {
  const t = night();
  t.room.arm('ana', 'song'); t.room.arm('dee', 'song');
  t.room.like('ana', t.handleOf('ana', 'dee', 'wall'));
  assert.ok(t.room.like('dee', t.handleOf('dee', 'ana', 'wall')), 'Ana met Dee first, as ANA');
  t.room.setProfile('ana', { name: 'ANNA', contact: '@ana' });
  t.room.admit('ben', asking(t).id, 'yes');   // then Ana, Ben and Cai, as ANNA
  t.room.leave('ana');
  const benCai = t.room.viewFor('ben').matches.find((m) => m.name === 'CAI');
  assert.deepEqual(benCai.with, ['ANNA'], 'the name from this meeting');
});

test('a newcomer who turns the card off, or to another, ends their ask: nobody is let in on a card they left', () => {
  for (const next of [null, 'song']) {
    const t = night();
    const asked = asking(t);
    t.room.arm('cai', next);
    assert.deepEqual(t.room.viewFor('ben').joinAsks, [], 'the ask is gone from Ben (' + next + ')');
    assert.equal(t.room.admit('ben', asked.id, 'yes'), false);
    assert.deepEqual(open(t.room, 'cai'), [], 'Cai meets nobody');
  }
});
