// ON THE BEAT — the stand-in's wrist, held to the table of cases both wrists share.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_WORDS, CONSTS } from '../app/lib/wrist.js';
import { bandShow } from '../relay/band.js';
import { TABLE, lines, runJs, check } from './wrist-table.js';

for (const c of TABLE.cases) {
  test('wrist.js: ' + c.name, () => {
    const protocol = lines(c, CONSTS);
    check(c, protocol, runJs(protocol), CONSTS);
  });
}

test("the card words a preview draws are bandShow's own", () => {
  for (const intent of ['hi', 'song', 'dance']) {
    const s = bandShow({ view: { me: { armed: intent, invisible: false, pick: null, rev: 1 }, matches: [] }, now: 0 });
    assert.equal(CARD_WORDS[intent], s.big, intent);
  }
});
