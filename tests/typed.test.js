// ON THE BEAT — two people who type the same venue their own way end up in the same room.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomOf } from '../app/lib/typed.js';
import { venueKey } from '../relay/server.js';

test('spelling that is not the name does not split a room', () => {
  const one = roomOf('Fortitude Music Hall');
  for (const other of ['the Fortitude Music Hall', '  fortitude   music hall ', 'Fortitude Music Hall!', 'THE FORTITUDE MUSIC-HALL']) {
    assert.equal(roomOf(other), one, other);
  }
  assert.equal(roomOf('Rock & Roll Bar'), roomOf('rock and roll bar'));
  assert.equal(roomOf('Café Lounge'), roomOf('cafe lounge'));
  assert.equal(roomOf("O'Reilly's"), roomOf('O’Reilly’s'), 'either apostrophe');
});

test('different names stay different rooms, and a name of nothing but punctuation or "the" is kept as typed', () => {
  assert.notEqual(roomOf('The Tivoli'), roomOf('The Triffid'));
  assert.equal(roomOf('The'), 'the');
  assert.equal(roomOf('!!!'), '!!!');
  assert.equal(roomOf('東京ドーム'), '東京ドーム', 'letters of any script are letters');
  assert.equal(roomOf('x'.repeat(200)).length, 80);
});

test('the relay takes a typed room as it is: its own key for it changes nothing', () => {
  for (const t of ['the Fortitude Music Hall', 'Café Lounge', 'Rock & Roll Bar', '!!!']) assert.equal(venueKey(roomOf(t)), roomOf(t));
});
