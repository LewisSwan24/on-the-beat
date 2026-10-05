// ON THE BEAT — a report is never said to reach a team that is not there.
//
// Only a venue with a staff page has anyone to read a report (relay/server.js sets view.team). Before
// 5 Oct 2026 every phone said "the venue team has it", at every venue, staff page or not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT, teamHere } from '../app/copy.js';

test('a report reaches a team only where the relay says there is one; before it says, a report is queued', () => {
  assert.equal(teamHere({ team: true }), true);
  assert.equal(teamHere({ team: false }), false);
  assert.equal(teamHere({ me: null, near: [] }), true, 'no word yet: queued, as any send is offline');
  assert.equal(teamHere(null), true);
});

test('the words for a venue with no team never say a team has it, and send the reader to people in the room', () => {
  for (const words of [REPORT.noTeam, REPORT.noTeamSub]) assert.doesNotMatch(words, /has it|goes to the venue team/i);
  assert.match(REPORT.noTeamSub, /staff or security in person/);
});

test('the words a phone with no wristband reads: blue screens to look for, a number to hold up, an area at the closest', async () => {
  const { HOW, MEET, PROMISES, cards } = await import('../app/copy.js');
  const hi = (banded) => cards('BRUNO MARS', banded).find((c) => c.id === 'hi').armed.join(' ');
  assert.match(hi(true), /wristbands/);
  assert.match(hi(false), /screens/, 'phone only: it is a screen that lights, not a band');
  assert.match(MEET.look, /wristband or phone/, 'nobody is told whether the other wears a band');
  assert.match(MEET.held, /hold this screen up/);
  assert.doesNotMatch(PROMISES[0].sub, /in this room/, 'markers name an area, so the promise says so');
  assert.match(PROMISES[0].sub, /near the bar/);
  assert.match(HOW.both, /both/);
  for (const card of ['SAY HI', 'FIRST SONG?', 'DANCE']) assert.ok(HOW.cards.includes(card), card);
});

test('the phone says how a wristband turns off and on, and a band turned off is said as off, never as away', async () => {
  const { BAND_OFF } = await import('../app/copy.js');
  assert.match(BAND_OFF.how, /both buttons/);
  assert.match(BAND_OFF.how, /3 seconds/, 'the hold the firmware times (OFF_HOLD_MS)');
  assert.match(BAND_OFF.how, /power button turns it on/);
  assert.match(BAND_OFF.line, /power button turns it on/);
  assert.doesNotMatch(BAND_OFF.line, /away|OFFLINE/);
});
