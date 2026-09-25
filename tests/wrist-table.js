// ON THE BEAT — the wrist's table of cases, and how to run it.
//
// tests/fixtures/wrist-cases.json is one list of cases for both wrists: the
// stand-in's app/lib/wrist.js (tests/wrist.test.js) and the firmware's
// band_logic.h (tests/firmware.test.js, through `logic_test wrist`). A case
// becomes lines of a small text protocol that both read:
//
//   key <hex>             first: a wrist with this band key
//   <t> tick              let the time pass to t
//   <t> heard             the relay was heard at t (a pong); no time passes
//   <t> up | <t> down     the link to the relay
//   <t> key1 down | <t> key1 up | <t> key2 down | <t> key2 up
//   <t> frame <json>      a frame from the relay
//   <t> battery <n> | <t> wifi <0|1>
//
// Every line after the first lets the time pass to t, does the one thing, and
// answers one line: {"sent":[...frames, or "DROP"],"sounds":[...names],"face":{...}}.
// `heard` lines are the keep-alive a case gets unless it says "keepAlive":
// false; they let no time pass and their answers are not checked.
//
// A step's `sent` and `sounds` are exact, and empty unless the step says
// otherwise, so a stray frame or sound anywhere fails. A `press` is a key down
// and, PRESS ms later, its key up: the step's `sent`, `sounds` and `face` are
// the key up's, and `downSounds` (["tick"] unless said) the key down's.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createWrist } from '../app/lib/wrist.js';

export const TABLE = JSON.parse(readFileSync(new URL('./fixtures/wrist-cases.json', import.meta.url), 'utf8'));
const T0 = 1000;       // every case starts here, not at 0
const PRESS = 100;     // how long a "press" is held

/** A time written with the constants' names: "HOLD_MS+1", "2000+COMMIT_MS", "2*WAKE_MS". */
export function at(expr, consts) {
  let total = 0;
  for (const [, sign, term] of String(expr).replace(/\s+/g, '').matchAll(/([+-]?)([^+-]+)/g)) {
    const value = term.split('*').reduce((acc, part) => {
      const v = /^\d+$/.test(part) ? Number(part) : consts[part];
      if (typeof v !== 'number') throw new Error('unknown time ' + part + ' in ' + expr);
      return acc * v;
    }, 1);
    total += sign === '-' ? -value : value;
  }
  return T0 + total;
}

/** A case as protocol lines, each with what it must answer (null: not checked). */
export function lines(c, consts) {
  const out = [{ line: 'key ' + TABLE.key, expect: null }];
  const showOf = (s) => ({ t: 'show', show: { ...TABLE.shows[s.show], ...(s.rev !== undefined ? { rev: s.rev } : {}) } });
  let last = -Infinity;
  for (const s of c.steps) {
    const t = at(s.at ?? '0', consts);
    if (t < last) throw new Error(c.name + ': step at ' + s.at + ' goes back in time');
    last = t;
    const expect = { sent: s.sent ?? [], sounds: s.sounds ?? [], face: s.face ?? null };
    const keep = () => { if (c.keepAlive !== false) out.push({ line: t + ' heard', expect: null }); };
    keep();
    if (s.press) {
      out.push({ line: t + ' key' + s.press + ' down', expect: { sent: [], sounds: s.downSounds ?? ['tick'], face: null } });
      last = t + PRESS;
      if (c.keepAlive !== false) out.push({ line: last + ' heard', expect: null });
      out.push({ line: last + ' key' + s.press + ' up', expect });
    } else if (s.link) out.push({ line: t + ' ' + s.link, expect });
    else if (s.key1) out.push({ line: t + ' key1 ' + s.key1, expect });
    else if (s.key2) out.push({ line: t + ' key2 ' + s.key2, expect });
    else if (s.show) out.push({ line: t + ' frame ' + JSON.stringify(showOf(s)), expect });
    else if (s.frame) out.push({ line: t + ' frame ' + JSON.stringify(s.frame), expect });
    else if (s.battery !== undefined) out.push({ line: t + ' battery ' + s.battery, expect });
    else if (s.wifi !== undefined) out.push({ line: t + ' wifi ' + (s.wifi ? 1 : 0), expect });
    else out.push({ line: t + ' tick', expect });
  }
  return out;
}

/** The same protocol, read by the stand-in's wrist. */
export function runJs(protocol) {
  let wrist = null;
  const answers = [];
  for (const { line } of protocol) {
    const [first, verb, ...rest] = line.split(' ');
    if (first === 'key') { wrist = createWrist({ key: verb }); continue; }
    const t = Number(first);
    if (verb === 'heard') { wrist.heard(t); answers.push(null); continue; }
    wrist.tick(t);
    if (verb === 'up') wrist.linkUp(t);
    else if (verb === 'down') wrist.linkDown(t);
    else if (verb === 'key1' || verb === 'key2') (rest[0] === 'down' ? wrist.keyDown : wrist.keyUp)(verb === 'key1' ? 1 : 2, t);
    else if (verb === 'frame') wrist.frame(rest.join(' '), t);
    else if (verb === 'battery') wrist.setBattery(Number(rest[0]));
    else if (verb === 'wifi') wrist.setWifi(rest[0] === '1');
    answers.push({ sent: wrist.take().map((o) => (o === 'DROP' ? o : JSON.parse(o))), sounds: wrist.sounds(), face: wrist.face(t) });
  }
  return answers;
}

/** Holds one case's answers to what the table says; pings are the link's own business and left out. */
export function check(c, protocol, answers, consts) {
  const key = TABLE.key;
  const id = createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex').slice(0, 32);
  const fill = (v) => (v === '$ID' ? id : v === '$KEY' ? key : v);
  const deep = (v) => (Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : fill(v));
  const answered = protocol.slice(1);
  assert.equal(answers.length, answered.length, c.name + ': one answer a line');
  answered.forEach(({ line, expect }, i) => {
    if (!expect) return;
    const got = answers[i];
    const where = c.name + ' / ' + line;
    assert.deepEqual(got.sent.filter((f) => !(f && f.t === 'ping')), deep(expect.sent), where + ': sent');
    assert.deepEqual(got.sounds, expect.sounds, where + ': sounds');
    if (!expect.face) return;
    for (const [k, v] of Object.entries(expect.face)) {
      const want = typeof v === 'string' && /^LIGHT_/.test(v) ? consts[v] : v;
      assert.equal(got.face[k], want, where + ': face.' + k + ' ' + JSON.stringify(got.face));
    }
  });
}
