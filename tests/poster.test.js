// The poster's own logic: which venue its address names, how many play there in words, and tonight's times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hereLine, posterTimes, venueFromPath } from '../app/poster/live.js';

test('the address names the venue: /poster/<id>, and nothing for /poster alone', () => {
  assert.equal(venueFromPath('/poster/moth-club-kayo-lane'), 'moth-club-kayo-lane');
  assert.equal(venueFromPath('/poster/moth-club-kayo-lane/'), 'moth-club-kayo-lane');
  assert.equal(venueFromPath('/poster.html'), null, 'Vite serves the page at /poster.html');
  assert.equal(venueFromPath('/poster'), null);
  assert.equal(venueFromPath('/poster/'), null);
  assert.equal(venueFromPath('/poster/%E0%A4%A'), null, 'a malformed escape names nothing');
});

test('how many play there tonight, in words: nobody is an invitation, one is one person', () => {
  assert.equal(hereLine(0), 'nobody yet. be the first.');
  assert.equal(hereLine(1), '1 person playing tonight');
  assert.equal(hereLine(37), '37 people playing tonight');
  assert.equal(hereLine(undefined), '', 'not heard yet: nothing, rather than a wrong zero');
});

test("tonight's times: only the ones the venue gave, in the night's order", () => {
  assert.deepEqual(posterTimes({ doors: '19:30', support: '20:15', break: '20:50', headline: '21:00', end: '22:45' }),
    [['DOORS', '19:30'], ['SUPPORT', '20:15'], ['BREAK', '20:50'], ['HEADLINE', '21:00'], ['ENDS', '22:45']]);
  assert.deepEqual(posterTimes({ doors: '19:00', headline: '21:30' }), [['DOORS', '19:00'], ['HEADLINE', '21:30']]);
  assert.deepEqual(posterTimes({}), []);
});
