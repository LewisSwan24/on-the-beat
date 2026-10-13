// ON THE BEAT — a room's venue card: made by the people there, first in wins, two "wrong"s clear a field.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom } from '../relay/room.js';

const T = Date.UTC(2026, 9, 13, 11, 0);
function room() {
  const r = createRoom({ now: () => T, salt: 'test' });
  for (const id of ['ana', 'ben', 'cai']) r.join(id);
  return r;
}

test('making a card needs a venue; it is shown to everyone in the room with made: true', () => {
  const r = room();
  assert.equal(r.fillCard('ana', { act: 'KAYO LANE' }), 'bad', 'no venue, no card');
  assert.equal(r.card(), null);
  assert.equal(r.fillCard('ana', { venue: '  The Lexington ', act: 'KAYO LANE' }), 'ok');
  assert.deepEqual(r.viewFor('ben').card, { venue: 'The Lexington', act: 'KAYO LANE', made: true });
});

test('first in wins: a set field is never changed, and a fill touching one is refused whole', () => {
  const r = room();
  r.fillCard('ana', { venue: 'The Lexington' });
  assert.equal(r.fillCard('ben', { act: 'KAYO LANE' }), 'ok');
  assert.equal(r.fillCard('cai', { act: 'SOMEONE ELSE' }), 'taken');
  assert.equal(r.fillCard('cai', { act: 'SOMEONE ELSE', doors: '19:30' }), 'taken', 'mixed with a new field: nothing is written');
  assert.equal(r.card().doors, undefined);
  assert.equal(r.fillCard('cai', { doors: '19:30' }), 'ok');
  assert.equal(r.card().act, 'KAYO LANE');
});

test('bad input is refused and never throws: long text, not HH:MM, a place after making, a place out of range', () => {
  const r = room();
  assert.equal(r.fillCard('ana', { venue: 'x'.repeat(81) }), 'bad');
  assert.equal(r.fillCard('ana', { venue: 'Ok', lat: 91, lon: 0 }), 'bad');
  assert.equal(r.fillCard('ana', { venue: 'Ok', lat: 51.5, lon: Number.NaN }), 'bad');
  assert.equal(r.fillCard('ana', { venue: { toString: () => 'sneaky' } }), 'bad');
  assert.equal(r.fillCard('ana', { venue: 'Ok' }), 'ok');
  assert.equal(r.fillCard('ana', { doors: '7pm' }), 'bad');
  assert.equal(r.fillCard('ana', { act: 'y'.repeat(61) }), 'bad');
  assert.equal(r.fillCard('ana', { lat: 51.5, lon: -0.1 }), 'bad', 'the place comes only with the making');
  assert.equal(r.fillCard('ana', { act: 'Fine', lat: 51.5, lon: -0.1 }), 'bad', 'not even beside a new field');
  assert.equal(r.card().act, undefined);
  assert.equal(r.card().lat, undefined);
  assert.equal(r.fillCard('ana', null), 'bad');
});

test('the place is rounded to 0.001 degrees, whatever the phone sent', () => {
  const r = room();
  r.fillCard('ana', { venue: 'The Lexington', lat: 51.531863, lon: -0.110427 });
  assert.equal(r.card().lat, 51.532);
  assert.equal(r.card().lon, -0.11);
});

test('two different people saying a field is wrong clear it; one person twice does not', () => {
  const r = room();
  r.fillCard('ana', { venue: 'The Lexington', act: 'RUDE WORD' });
  assert.equal(r.wrongCard('ben', 'act'), false);
  assert.equal(r.wrongCard('ben', 'act'), false, 'the same person counts once');
  assert.equal(r.card().act, 'RUDE WORD');
  assert.equal(r.wrongCard('cai', 'act'), true);
  assert.equal(r.card().act, undefined);
  assert.equal(r.fillCard('ben', { act: 'KAYO LANE' }), 'ok', 'cleared: it can be filled again');
  assert.equal(r.wrongCard('ben', 'nonsense'), false);
});

test('two wrongs on the venue hide the card from lists; the people inside still see it', () => {
  const r = room();
  r.fillCard('ana', { venue: 'Not A Real Place' });
  r.wrongCard('ben', 'venue');
  r.wrongCard('cai', 'venue');
  assert.equal(r.card().hidden, true);
  assert.equal(r.viewFor('ana').card.venue, 'Not A Real Place');
  assert.equal('hidden' in r.viewFor('ana').card, false);
});

test('the card survives a restart, wrong reports included', () => {
  const r = room();
  r.fillCard('ana', { venue: 'The Lexington', act: 'X' });
  r.wrongCard('ben', 'act');
  const back = createRoom({ now: () => T, salt: 'test', restore: JSON.parse(JSON.stringify(r.dump())) });
  assert.equal(back.card().venue, 'The Lexington');
  assert.equal(back.wrongCard('cai', 'act'), true, 'ben\'s report came back with it');
});

test('letGo() takes last night\'s card with the rest of what was said for last night', () => {
  const r = room();
  r.fillCard('ana', { venue: 'The Lexington' });
  assert.equal(r.letGo((t) => t < T), false, 'made tonight: kept');
  assert.equal(r.letGo((t) => t <= T), true);
  assert.equal(r.card(), null);
});

test('a dump from before cards restores with no card', () => {
  const r = room();
  const d = JSON.parse(JSON.stringify(r.dump()));
  delete d.card;
  assert.equal(createRoom({ now: () => T, salt: 'test', restore: d }).card(), null);
});
