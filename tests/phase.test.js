// ON THE BEAT — where the night is, from the show's times and the clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nightOf, phaseLine, phaseOf, timesLine } from '../app/lib/phase.js';

const ROUNDHOUSE = { act: 'BRUNO MARS', doors: '19:00', support: '20:00', break: '20:45', headline: '21:30', end: '23:00' };
const at = (hh, mm, day = 23) => new Date(2026, 8, day, hh, mm);

test('each phase begins at its own time, as the venue wrote it', () => {
  assert.deepEqual(
    [at(18, 0), at(19, 10), at(20, 0), at(20, 45), at(21, 30), at(23, 0)].map((d) => phaseOf(ROUNDHOUSE, d)),
    ['DOORS', 'DOORS', 'SUPPORT', 'BREAK', 'HEADLINE', 'AFTER'],
  );
});

test('the line under the bar counts down to what comes next', () => {
  assert.equal(phaseLine(ROUNDHOUSE, at(18, 0)), 'DOORS · open at 19:00', 'before doors says when, not how long');
  assert.equal(phaseLine(ROUNDHOUSE, at(19, 20)), 'DOORS OPEN · support in 40 min');
  assert.equal(phaseLine(ROUNDHOUSE, at(20, 27)), 'SUPPORT ACT · break in 18 min');
  assert.equal(phaseLine(ROUNDHOUSE, at(21, 18)), 'BREAK · headline in 12 min');
  assert.equal(phaseLine(ROUNDHOUSE, at(21, 40)), 'HEADLINE · bruno mars, on now');
  assert.equal(phaseLine(ROUNDHOUSE, at(23, 5)), 'AFTER · lights up, last calls');
  assert.equal(phaseLine(ROUNDHOUSE, at(14, 0)), 'DOORS · open at 19:00', 'an afternoon demo sits before doors');
  assert.equal(phaseLine({ ...ROUNDHOUSE, support: '21:30' }, at(19, 5)), 'DOORS OPEN · support in 2 h 25 min');
});

test('a show that runs past midnight is still tonight, and so is the walk home', () => {
  const late = { act: 'SABLE COURT', doors: '22:00', support: '23:00', break: '23:40', headline: '00:10', end: '01:30' };
  assert.equal(phaseOf(late, at(23, 50)), 'BREAK');
  assert.equal(phaseOf(late, at(0, 20, 24)), 'HEADLINE');
  assert.equal(phaseOf(late, at(2, 0, 24)), 'AFTER');
  assert.equal(nightOf(at(2, 0, 24)), '2026-09-23', 'two in the morning belongs to the night before');
  assert.equal(nightOf(at(6, 0, 24)), '2026-09-24', 'six is a new day');
});

test('a venue nobody listed gets an ordinary evening', () => {
  assert.equal(phaseOf({ act: 'THE LANTERN' }, at(21, 45)), 'HEADLINE');
  assert.equal(timesLine({}), 'Doors 19:00 · Support 20:00 · Headline 21:30');
});
