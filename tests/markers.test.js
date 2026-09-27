// Markers: the area a person is in comes from the markers their wristband hears
// (docs/superpowers/specs/2026-09-27-wrist-markers-design.md §3), and only from them.
// Everything here goes through the room: what a band heard, the tick, and the rows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, BANDS, HEARD_MS, MARK_FLOOR, MARK_HOLD } from '../relay/room.js';

/** Three people on SAY HI, each picked their own name, and a clock. */
function floor() {
  let t = Date.UTC(2026, 8, 27, 21, 0);
  const room = createRoom({ now: () => t, salt: 'marks' });
  for (const id of ['ana', 'ben', 'cai']) {
    room.join(id);
    room.arm(id, 'hi');
    room.pick(id, id);
  }
  return { room, later: (ms) => { t += ms; } };
}

/** The area `viewer` is shown `who` in, on their row. */
const areaOf = (room, viewer, who) => room.viewFor(viewer).near.find((p) => p.pick === who)?.band;

let channel = 100;
/** One report from `id`'s band: the markers it heard, as { area: rssi }. Each on a channel of its own, so no band here hides anyone. */
const hears = (room, id, marks) =>
  room.heard(id, { ch: channel++, marks: Object.entries(marks).map(([area, rssi]) => ({ area, rssi })) });

test('a band that hears a marker at MARK_FLOOR or louder puts its person there, on every row that shows them', () => {
  const { room } = floor();
  hears(room, 'ana', { bar: MARK_FLOOR });
  room.nearTick();
  assert.equal(areaOf(room, 'ben', 'ana'), 'near the bar');
  assert.equal(areaOf(room, 'cai', 'ana'), 'near the bar');
  assert.equal(room.viewFor('ana').me.band, 'near the bar');
  hears(room, 'ben', { stage: MARK_FLOOR - 1 });
  room.nearTick();
  assert.equal(areaOf(room, 'ana', 'ben'), 'in this room', 'a dB under the floor is not heard clearly');
  hears(room, 'cai', { back: -45 });
  room.nearTick();
  assert.equal(areaOf(room, 'ana', 'cai'), 'somewhere out the back');
});

test('the loudest marker names the area, by the median of what the band heard in HEARD_MS', () => {
  const { room, later } = floor();
  // The bar's median is -52 and the stage's -57, though the bar's mean (-57.3) is under the stage's (-57).
  for (const [bar, stage] of [[-45, -58], [-75, -56], [-52, -57]]) {
    hears(room, 'ana', { bar, stage });
    later(1000);
  }
  room.nearTick();
  assert.equal(areaOf(room, 'ben', 'ana'), 'near the bar');
});

test('an area holds while its marker is within MARK_HOLD of the loudest and MARK_FLOOR - MARK_HOLD or louder', () => {
  const { room, later } = floor();
  // Each report alone: the last one is older than HEARD_MS by then.
  const at = (marks) => {
    later(HEARD_MS + 1);
    hears(room, 'ana', marks);
    room.nearTick();
    return areaOf(room, 'ben', 'ana');
  };
  assert.equal(at({ bar: -55 }), 'near the bar');
  assert.equal(at({ bar: -55, stage: -55 + MARK_HOLD - 1 }), 'near the bar', 'the stage a dB short of MARK_HOLD louder');
  assert.equal(at({ bar: -55, stage: -55 + MARK_HOLD }), 'by the stage', 'MARK_HOLD louder moves it');
  assert.equal(at({ stage: MARK_FLOOR - MARK_HOLD }), 'by the stage', 'held down to the floor less the hold');
  assert.equal(at({ stage: MARK_FLOOR - MARK_HOLD - 1 }), 'in this room');
  assert.equal(at({ stage: MARK_FLOOR - 1 }), 'in this room', 'coming back needs the floor itself');
});

test('in this room without a band, with a band gone quiet for HEARD_MS, or with no marker heard any more', () => {
  const { room, later } = floor();
  hears(room, 'ana', { bar: -40 });
  room.nearTick();
  assert.equal(areaOf(room, 'ben', 'ana'), 'near the bar');
  assert.equal(areaOf(room, 'ana', 'cai'), 'in this room', 'no band');
  later(HEARD_MS + 1);
  room.nearTick();
  assert.equal(areaOf(room, 'ben', 'ana'), 'in this room', 'a band gone quiet');
  hears(room, 'ana', { bar: -40 });
  room.nearTick();
  later(HEARD_MS / 2);
  hears(room, 'ana', {});
  later(HEARD_MS / 2 + 1);
  room.nearTick();
  assert.equal(areaOf(room, 'ben', 'ana'), 'in this room', 'still reporting, and no marker heard in HEARD_MS');
});

test('nearTick says a view changed when an area did, and not when none did', () => {
  const { room } = floor();
  hears(room, 'ana', {});
  room.nearTick();
  hears(room, 'ana', {});
  assert.equal(room.nearTick(), false, 'nothing changed');
  hears(room, 'ana', { bar: -40 });
  assert.equal(room.nearTick(), true, "ana's area did");
  hears(room, 'ana', { bar: -41 });
  assert.equal(room.nearTick(), false, 'still near the bar');
});

test('no number reaches a view: a row says one of the four areas, and nothing about the marker', () => {
  const { room } = floor();
  hears(room, 'ana', { bar: -47, stage: -58 });
  hears(room, 'ben', { back: -51 });
  room.nearTick();
  for (const viewer of ['ana', 'ben', 'cai']) {
    const seen = JSON.stringify(room.viewFor(viewer));
    assert.equal(/-47|-58|-51|rssi|marks|"bar"|"stage"|"back"/.test(seen), false, seen);
    for (const p of room.viewFor(viewer).near) assert.ok(BANDS.includes(p.band));
  }
});

test('an area no marker has, and a report from someone not in the room, change nothing', () => {
  const { room } = floor();
  room.heard('ana', { ch: 900, marks: [{ area: 'kitchen', rssi: -30 }, { area: 'toString', rssi: -30 }, { area: '__proto__', rssi: -30 }] });
  room.heard('zed', { ch: 901, marks: [{ area: 'bar', rssi: -30 }] });
  room.nearTick();
  assert.equal(areaOf(room, 'ben', 'ana'), 'in this room');
  assert.equal(room.viewFor('ana').me.band, 'in this room');
  room.join('zed');
  room.arm('zed', 'hi');
  room.pick('zed', 'zed');
  room.nearTick();
  assert.equal(areaOf(room, 'ana', 'zed'), 'in this room', 'what was heard before joining does not count');
});

test('a match keeps the area it was made in, and a report the area it was sent from', () => {
  const { room, later } = floor();
  hears(room, 'ana', { bar: -40 });
  room.nearTick();
  const toAna = room.viewFor('ben').near.find((p) => p.pick === 'ana').handle;
  room.wave('ben', toAna);
  room.wave('ana', room.viewFor('ana').near.find((p) => p.pick === 'ben').handle);
  assert.equal(room.report('cai', room.viewFor('cai').near.find((p) => p.pick === 'ana').handle, 'x'), true);
  later(HEARD_MS + 1);
  hears(room, 'ana', { stage: -40 });
  room.nearTick();
  assert.equal(room.viewFor('ana').me.band, 'by the stage');
  assert.equal(room.viewFor('ben').matches[0].band, 'near the bar');
  assert.equal(room.reports()[0].band, 'near the bar');
});

test('only a marker names an area: a phone saying one when it joins is not taken, and nothing else sets it', () => {
  const { room } = floor();
  room.join('eve', { band: 'near the bar' });
  assert.equal(room.viewFor('eve').me.band, 'in this room');
  assert.equal(room.setBand, undefined);
});
