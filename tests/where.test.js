// ON THE BEAT — where you are, worked out on the phone (docs/superpowers/specs/2026-10-13-venue-cards-design.md §2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEAR_M, WRONG_M, byPlace, cardOver, distanceLabel, distanceM, roundPlace, wrongLine, wrongRoom } from '../app/lib/where.js';

const MOTH = { lat: 51.5453, lon: -0.056 };
const ROUNDHOUSE = { lat: 51.5432, lon: -0.1519 };

test('distanceM: Moth Club to the Roundhouse is about 6.6 km; a place to itself is 0', () => {
  assert.ok(Math.abs(distanceM(MOTH, ROUNDHOUSE) - 6650) < 150);
  assert.equal(distanceM(MOTH, MOTH), 0);
});

test('distanceLabel: metres to 50 under a kilometre, one decimal under ten, whole beyond', () => {
  assert.equal(distanceLabel(12), '0 m');
  assert.equal(distanceLabel(312), '300 m');
  assert.equal(distanceLabel(980), '1000 m');
  assert.equal(distanceLabel(3240), '3.2 km');
  assert.equal(distanceLabel(12_400), '12 km');
});

test('byPlace: within 2 km nearest first with its distance; the rest, and places unknown, after in their order', () => {
  const shows = [
    { id: 'roundhouse', ...ROUNDHOUSE },
    { id: 'nowhere' },
    { id: 'moth', ...MOTH },
    { id: 'next-door', lat: 51.5458, lon: -0.0565 },
  ];
  const { near, rest } = byPlace(shows, MOTH);
  assert.deepEqual(near.map((s) => s.id), ['moth', 'next-door']);
  assert.ok(near[1].away > 0 && near[1].away < NEAR_M);
  assert.deepEqual(rest.map((s) => s.id), ['roundhouse', 'nowhere']);
  assert.deepEqual(byPlace(shows, null), { near: [], rest: shows });
});

test('wrongRoom: more than 500 m from a room with a place; nothing without one or without a fix', () => {
  assert.equal(wrongRoom(MOTH, { ...MOTH }), null);
  assert.equal(wrongRoom({ lat: 51.5453, lon: -0.0632 }, MOTH), null, 'about 500 m: not yet');
  assert.ok(wrongRoom(ROUNDHOUSE, { venue: 'Moth Club, Hackney', ...MOTH }) > WRONG_M);
  assert.equal(wrongRoom(null, MOTH), null);
  assert.equal(wrongRoom(ROUNDHOUSE, { venue: 'Typed' }), null);
});

test('wrongLine names the venue before its comma', () => {
  assert.equal(wrongLine(3240, { venue: 'Moth Club, Hackney' }), "You're 3.2 km from Moth Club. Wrong place?");
});

test('roundPlace rounds to 0.001 degrees, as the relay does', () => {
  assert.deepEqual(roundPlace({ lat: 51.531863, lon: -0.110427 }), { lat: 51.532, lon: -0.11 });
});

test('cardOver lays what the people there said over the typed show', () => {
  const typed = { id: null, room: 'the lexington', act: 'THE LEXINGTON', venue: 'your word for it', typed: true };
  assert.deepEqual(cardOver(typed, { venue: 'The Lexington', doors: '19:30', made: true }),
    { id: null, room: 'the lexington', act: '', venue: 'The Lexington', doors: '19:30', typed: true, made: true });
  assert.equal(cardOver(typed, null), typed);
  assert.equal(cardOver(null, { venue: 'x' }), null);
});

test('cardOver: the card is the whole truth for its fields, so a field two people cleared clears for everyone (review I1)', () => {
  const joined = { id: 'lexington', room: 'lexington', venue: 'The Lexington', act: 'WRONG ACT', doors: '18:00', lat: 51.532, lon: -0.11, made: true };
  const over = cardOver(joined, { venue: 'The Lexington', lat: 51.532, lon: -0.11, made: true });
  assert.equal(over.act, '');
  assert.equal(over.doors, undefined);
  assert.equal(over.room, 'lexington');
});

test('freshPlace: a place found over two minutes ago is not where the phone is now (review I2)', async () => {
  const { freshPlace, PLACE_FRESH_MS } = await import('../app/lib/where.js');
  const at = 1_000_000;
  assert.deepEqual(freshPlace({ lat: 1, lon: 2, at }, at + PLACE_FRESH_MS - 1), { lat: 1, lon: 2 });
  assert.equal(freshPlace({ lat: 1, lon: 2, at }, at + PLACE_FRESH_MS + 1), null);
  assert.equal(freshPlace(null, at), null);
});

test('chosenRow: what is stored of a chosen row leaves out how far the phone was from it (review I3)', async () => {
  const { chosenRow } = await import('../app/lib/where.js');
  assert.deepEqual(chosenRow({ id: 'a', room: 'a', venue: 'V', lat: 1, lon: 2, away: 312 }), { id: 'a', room: 'a', venue: 'V', lat: 1, lon: 2 });
});
