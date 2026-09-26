// Near, on a modelled crowd: reports shaped as the bands send them, through the
// real room, and how many of each five are truly near (near spec §5). The crowd
// is a model, not a measurement: 2.4 GHz log-distance loss, a few dB for each
// body between two bands, slow and fast fading, calibrated to the real bands'
// RSSI. Its constants are the spike's; the spec says which the choice rests on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, HEARD_MS, NEAR_FIVE } from '../relay/room.js';

const RSSI_1M = -30;    // dBm a metre away, line of sight, as the bands read each other at 20 dBm
const LOSS_N = 2.7;     // path-loss exponent indoors
const BODY_DB = 4;      // for each body within 25 cm of the line between two bands, at most 12
const SLOW_DB = 4;      // shadowing that drifts from one listen to the next
const FAST_DB = 6;      // fading from one beacon to the next: a dancing arm
const FLOOR_DB = -95;   // below this a beacon is not heard
const NEAR_M = 10;      // what near means: close enough to find by looking round
const LISTEN_EVERY_MS = 10_000;

/** A seeded crowd: `people` on a w x h floor, the first `bands` of them wearing a band. */
function crowd({ w = 40, h = 25, people = 750, bands = 150, seed = 7 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const at = Array.from({ length: people }, () => ({ x: rnd() * w, y: rnd() * h }));
  const bodies = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    let k = 0;
    for (const p of at) {
      if (p === a || p === b) continue;
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
      if (t <= 0 || t >= 1) continue;
      const qx = a.x + t * dx - p.x, qy = a.y + t * dy - p.y;
      if (qx * qx + qy * qy < 0.0625) k += 1;
    }
    return Math.min(k, 12);
  };
  const ids = Array.from({ length: bands }, (_, i) => 'b' + i);
  const pair = new Map();
  for (let i = 0; i < bands; i += 1) {
    for (let j = i + 1; j < bands; j += 1) {
      const d = Math.max(0.3, Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y));
      const p = { d, mean: RSSI_1M - 10 * LOSS_N * Math.log10(d) - BODY_DB * bodies(at[i], at[j]) };
      pair.set(ids[i] + '|' + ids[j], p);
      pair.set(ids[j] + '|' + ids[i], p);
    }
  }
  const of = (a, b) => pair.get(a + '|' + b);
  /** One listen by band `a`: the strongest of two beacons from each band it heard, as the firmware keeps it. */
  const listen = (a) => ids.filter((b) => b !== a).flatMap((b) => {
    const r = of(a, b).mean + SLOW_DB * gauss() + Math.max(FAST_DB * gauss(), FAST_DB * gauss());
    return r >= FLOOR_DB ? [{ id: b, rssi: Math.max(-100, Math.min(0, Math.round(r))) }] : [];
  });
  return { ids, of, listen, rnd };
}

test('on a modelled crowd of 750, 150 banded, nearly every one of each five is truly within 10 m', (ctx) => {
  const { ids, of, listen, rnd } = crowd();
  let t = Date.UTC(2026, 8, 26, 21, 0);
  const room = createRoom({ now: () => t, salt: 'crowd' });
  for (const id of ids) {
    room.join(id);
    room.arm(id, 'hi');
    room.pick(id, id);
  }
  const listed = (v) => room.viewFor(v).near.map((p) => p.pick);
  let near = 0, shown = 0, randomNear = 0, changed = 0, kept = 0;
  let last = null;
  // Three minutes of listens, each band once every LISTEN_EVERY_MS at its own moment; the five after every listen round.
  for (let round = 0; round < 18; round += 1) {
    for (const id of ids) room.heard(id, { ch: 6, near: listen(id) });
    t += LISTEN_EVERY_MS;
    room.nearTick();
    const now = new Map(ids.map((v) => [v, listed(v)]));
    if (round >= 3) {
      for (const v of ids) {
        const five = now.get(v);
        shown += five.length;
        near += five.filter((b) => of(v, b).d <= NEAR_M).length;
        // Five picked at random from what the band heard, for comparison.
        const heard = listen(v).map((x) => x.id);
        for (let k = 0; k < Math.min(NEAR_FIVE, heard.length); k += 1) randomNear += of(v, heard[Math.floor(rnd() * heard.length)]).d <= NEAR_M ? 1 : 0;
        if (last) {
          changed += five.filter((b) => !last.get(v).includes(b)).length;
          kept += five.length;
        }
      }
    }
    last = now;
  }
  assert.ok(HEARD_MS >= 3 * LISTEN_EVERY_MS, 'a pair is scored on three listens or more');
  assert.equal(shown, 15 * ids.length * NEAR_FIVE, 'everyone has a full five');
  const share = near / shown, random = randomNear / shown, churn = changed / kept;
  ctx.diagnostic(`within ${NEAR_M} m: the five ${(share * 100).toFixed(1)}%, five at random ${(random * 100).toFixed(1)}%; churn ${(churn * 100).toFixed(1)}% a listen`);
  assert.ok(share >= 0.97, `the five are ${(share * 100).toFixed(1)}% within ${NEAR_M} m`);
  // A floor, not a bar: five picked at random from what a band heard are mostly not near (33% when measured).
  assert.ok(random <= 0.5, `five at random from what was heard are ${(random * 100).toFixed(1)}% within ${NEAR_M} m`);
  // Sticky, a five changed 2% a listen when measured; replaced whole each tick instead, 15%.
  assert.ok(churn <= 0.08, `${(churn * 100).toFixed(1)}% of each five changes each listen`);
});
