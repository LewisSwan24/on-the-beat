// relay/cards.js is the one place a card is named. These hold everything that
// is not a card's own protocol to it, so a card added there is either complete
// or red here: its words on the phone, its colours in the stylesheet, its icon
// in the font, its screens, and what the band shows for it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARDS, INTENTS, cardOf } from '../relay/cards.js';
import { INTENTS as ROOM_INTENTS } from '../relay/room.js';
import { bandShow } from '../relay/band.js';
import { HUE, cards } from '../app/copy.js';
import { INTENT_OF } from '../app/lib/follow.js';
import { CONSTS, lit } from '../app/lib/wrist.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the cards are the canvas three, in its order, and what the relay lets you arm', () => {
  assert.deepEqual(INTENTS, ['hi', 'song', 'dance']);
  assert.equal(ROOM_INTENTS, INTENTS);
  assert.equal(new Set(INTENTS).size, INTENTS.length, 'no id twice');
  for (const c of CARDS) assert.equal(cardOf(c.id), c);
  assert.equal(cardOf('off'), undefined);
  assert.equal(cardOf('constructor'), undefined);
});

test('every card has its words, its icon and its screens on the phone', () => {
  const icons = JSON.parse(read('../app/fonts/fonts.json')).icons.names;
  const home = cards('BRUNO MARS');
  assert.deepEqual(home.map((c) => c.id), INTENTS, 'the home screen lays them out in the table order');
  for (const c of home) {
    const card = cardOf(c.id);
    assert.ok(c.title && c.atitle && c.idle.length && c.armed.length, c.id + ': words idle and armed');
    assert.ok(c.icon === null || icons.includes(c.icon), c.id + ': its icon is in the subset font');
    assert.equal(c.to, card.open);
    assert.ok(card.screens.includes(card.open), c.id + ': its › opens one of its own screens');
    for (const s of card.screens) assert.equal(INTENT_OF[s], c.id, s + ' belongs to ' + c.id);
  }
  assert.equal(Object.keys(INTENT_OF).length, CARDS.reduce((n, c) => n + c.screens.length, 0), 'no screen in two cards');
  assert.deepEqual(INTENT_OF, { beacon: 'hi', near: 'hi', pick: 'song', wall: 'song', camera: 'dance', floor: 'dance' }, 'each of the canvas screens, in its card');
  assert.deepEqual(home.find((c) => c.id === 'dance').armed[1], 'your fav Bruno’s piece!');
});

test('every card has its hue on the phone and in the stylesheet', () => {
  const css = read('../app/styles.css');
  for (const c of CARDS) {
    assert.deepEqual(HUE[c.id], { c: c.c, g: c.g, label: c.label });
    assert.equal(css.match(new RegExp('--' + c.id + ':\\s*(#[0-9A-Fa-f]{6})'))?.[1], c.c, '--' + c.id);
    assert.equal(css.match(new RegExp('--' + c.id + '-g:\\s*(#[0-9A-Fa-f]{6})'))?.[1], c.g, '--' + c.id + '-g');
  }
});

test('every card shows on the band in its own colour, with its own words', () => {
  const view = (armed) => ({ me: { armed, pick: null, rev: 3 }, matches: [], opener: null });
  for (const c of CARDS) {
    const show = bandShow({ view: view(c.id), now: 1 });
    assert.equal(show.kind, c.id);
    assert.equal(show.intent, c.id);
    assert.equal(show.big, c.band);
    assert.equal(typeof show.small, 'string');
    assert.equal(CONSTS.CARD_WORDS[c.id], c.band, 'the stand-in band draws the same words');
  }
  assert.equal(bandShow({ view: view('nope'), now: 1 }).kind, 'off', 'a card nobody knows is nothing armed');
  for (const c of CARDS) {
    assert.equal(lit({ kind: c.id, intent: c.id }), true, c.id + ' is lit');
    assert.equal(lit({ kind: 'meet', intent: c.id }), true, 'a meeting over ' + c.id + ' is lit in its colour');
  }
  assert.equal(lit({ kind: 'meet', intent: 'nope' }), false);
  assert.equal(lit({ kind: 'off', intent: 'hi' }), false);
});
