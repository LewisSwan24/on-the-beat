// Markers, on a modelled crowd: reports shaped as the bands send them, through the
// real room, and whether the area each person is given is true (markers spec §6).
// The crowd is the model of tests/near-crowd.test.js — 2.4 GHz log-distance loss, a
// few dB for each body between band and marker, slow and fast fading — with a
// marker at each end of the floor. A model, not a measurement: the spec says which
// choices rest on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, MARKS } from '../relay/room.js';

const RSSI_1M = -30;    // dBm a metre away, line of sight
const LOSS_N = 2.7;     // path-loss exponent indoors
const SLOW_DB = 4;      // shadowing that drifts from one listen to the next
const FAST_DB = 6;      // fading from one beacon to the next
const FLOOR_DB = -95;   // below this a beacon is not heard
const LISTEN_EVERY_MS = 10_000;
const MARKERS = [{ area: 'bar', x: 1, y: 12.5 }, { area: 'stage', x: 39, y: 12.5 }];

/** A seeded 40 x 25 m floor: `people` in all, the first `bands` of them banded; `bodyDb` for each body between a band and a marker. */
function crowd({ people, bands, bodyDb, seed = 7 }) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const at = Array.from({ length: people }, () => ({ x: rnd() * 40, y: rnd() * 25 }));
  const bodies = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    let k = 0;
    for (const p of at) {
      if (p === a) continue;
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
      if (t <= 0 || t >= 1) continue;
      const qx = a.x + t * dx - p.x, qy = a.y + t * dy - p.y;
      if (qx * qx + qy * qy < 0.0625) k += 1;
    }
    return Math.min(k, 12);
  };
  return Array.from({ length: bands }, (_, i) => {
    const d = MARKERS.map((m) => Math.max(0.5, Math.hypot(at[i].x - m.x, at[i].y - m.y)));
    const mean = MARKERS.map((m, k) => RSSI_1M - 10 * LOSS_N * Math.log10(d[k]) - bodyDb * bodies(at[i], m));
    /** One listen: the strongest of two beacons from each marker, as the band keeps it. */
    const listen = () => MARKERS.flatMap((m, k) => {
      const r = mean[k] + SLOW_DB * gauss() + Math.max(FAST_DB * gauss(), FAST_DB * gauss());
      return r >= FLOOR_DB ? [{ area: m.area, rssi: Math.max(-100, Math.min(0, Math.round(r))) }] : [];
    });
    return { id: 'b' + i, d, listen };
  });
}

for (const [what, shape] of [
  ['750 people, 150 banded', { people: 750, bands: 150, bodyDb: 4 }],
  ['1,500 people, 300 banded (packed)', { people: 1500, bands: 300, bodyDb: 4 }],
  ['750 people, 150 banded, markers above heads', { people: 750, bands: 150, bodyDb: 2 }],
]) {
  test(`on a modelled floor of ${what}, a marker named is the nearest, nine in ten named are within 11 m, and areas hold`, (ctx) => {
    const bands = crowd(shape);
    let t = Date.UTC(2026, 8, 27, 21, 0);
    const room = createRoom({ now: () => t, salt: 'marks-crowd' });
    for (const b of bands) room.join(b.id);
    let named = 0, wrong = 0, shown = 0, flips = 0;
    const was = new Map();
    const far = [];
    // Two minutes of listens; the areas after every round from the fourth.
    for (let round = 0; round < 12; round += 1) {
      for (const b of bands) room.heard(b.id, { ch: 6, marks: b.listen() });
      t += LISTEN_EVERY_MS;
      room.nearTick();
      if (round < 3) continue;
      for (const b of bands) {
        shown += 1;
        const band = room.viewFor(b.id).me.band;
        if (was.has(b.id) && was.get(b.id) !== band) flips += 1;
        was.set(b.id, band);
        const k = MARKERS.findIndex((m) => MARKS[m.area] === band);
        if (k < 0) continue;
        named += 1;
        far.push(b.d[k]);
        if (b.d[k] > Math.min(...b.d)) wrong += 1;
      }
    }
    far.sort((x, y) => x - y);
    const p90 = far[Math.floor(0.9 * far.length)];
    ctx.diagnostic(`named ${(100 * named / shown).toFixed(1)}%, the wrong marker ${(100 * wrong / named).toFixed(2)}% of those, nine in ten within ${p90.toFixed(1)} m; ${(100 * flips / shown).toFixed(1)}% of areas changed a listen`);
    assert.ok(named / shown >= 0.1, 'someone is named: the floor is not so high that nobody ever is');
    assert.ok(wrong / named < 0.01, `the wrong marker for ${(100 * wrong / named).toFixed(2)}%`);
    assert.ok(p90 <= 11, `nine in ten named within ${p90.toFixed(1)} m`);
    // Held MARK_HOLD, an area changed 0.9 to 3.6% a listen when measured; not held, 1.3 to 6.0%.
    assert.ok(flips / shown <= 0.04, `${(100 * flips / shown).toFixed(1)}% of areas changed a listen`);
  });
}
