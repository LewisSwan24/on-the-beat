// ON THE BEAT — who a wristband is, pairing with a check, and the wrist's own `set`.
// One test per guard; each was mutation-checked (README, Abuse resistance).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRelay, bandIdOf, BAND_ALONE_MS, PAIR_CHECK_MS } from '../relay/server.js';
import { helpers, newKey, pause } from './relay-harness.js';

let relay;
let dir;
const { phone, wristband, hello, reply, pairBand, rawSocket, close, cleanup } = helpers(() => relay.port);

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'otb-band-'));
  relay = await createRelay({ port: 0, host: '127.0.0.1', root: dir });
});
after(async () => {
  cleanup();
  await relay.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------- §0: the key proves the id ----------

test('a hello whose key does not hash to its id is refused: a new id, an unpaired record, a paired one', async () => {
  const stranger = await hello({ t: 'wristband', id: bandIdOf(newKey()), key: newKey(), v: 2 });
  assert.deepEqual([stranger.reply, stranger.closed], [{ t: 'error', why: 'bad band' }, 4001], 'a new id with the wrong key');
  const band = await wristband();
  assert.equal((await hello({ t: 'wristband', id: band.id, key: newKey(), v: 2 })).reply.why, 'bad band', 'an unpaired record');
  const ana = await phone('key-room');
  await pairBand(ana, band);
  const taken = await hello({ t: 'wristband', id: band.id, key: newKey(), v: 2, secret: band.secret ?? undefined });
  assert.equal(taken.reply.why, 'bad band', 'a paired record, even with its secret');
  ana.send({ t: 'arm', intent: 'hi' });
  await band.until((s) => s.kind === 'hi');   // and the live wristband was left alone
  close(ana, band);
});

test('a hello with no protocol version gets letters but is never paired', async () => {
  const old = await wristband(62, { v1: true });
  assert.equal(old.show.kind, 'pairing');
  const ana = await phone('old-room');
  const no = reply(ana, 'error');
  ana.send({ t: 'pair', code: old.show.code });
  assert.equal((await no).why, 'old firmware');
  close(ana, old);
});

test('a socket says hello once', async () => {
  const band = await wristband();
  const other = newKey();
  band.send({ t: 'wristband', id: bandIdOf(other), key: other, v: 2 });
  await band.until((s, b) => b.replies.some((m) => m.why === 'bad band'));
  await new Promise((r) => (band.ws.readyState === 3 ? r() : band.ws.once('close', r)));
});

test('frames on a replaced wristband socket are dropped', async () => {
  const band = await wristband();
  const ana = await phone('replaced-room');
  const ben = await phone('replaced-room');
  const { secret } = await pairBand(ana, band);
  ana.send({ t: 'arm', intent: 'hi' });
  await ben.until((v) => v.near.length === 1);
  const raw = await rawSocket();
  raw.send({ t: 'wristband', id: band.id, key: band.key, v: 2, secret });   // the raw socket takes over...
  await pause(100);
  const next = await wristband(62, { key: band.key, secret });              // ...and is replaced, but never reads that
  raw.send({ t: 'hold' });
  await pause(300);
  assert.equal(ben.view.near.length, 1, 'a hold from the replaced socket did not land');
  next.send({ t: 'hold' });
  await ben.until((v) => v.near.length === 0);
  raw.end();
  close(ana, ben, next);
});

// ---------- §0: the check ----------

test('a hello with the wrong key is refused for a record being paired too', async () => {
  const band = await wristband();
  const ana = await phone('pending-key');
  ana.send({ t: 'pair', code: band.show.code });
  await band.until((s) => s.kind === 'check');
  assert.equal((await hello({ t: 'wristband', id: band.id, key: newKey(), v: 2 })).reply.why, 'bad band');
  close(ana, band);
});

test('pairing waits for the check: the wrist shows a number, the phone is asked, YES pairs and gives both a secret', async () => {
  const band = await wristband();
  const ana = await phone('check-room');
  const early = [];
  ana.ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'paired') early.push(m); });
  ana.send({ t: 'pair', code: band.show.code });
  const { me: { check } } = await ana.until((v) => v.me.check);
  assert.ok(check >= 10 && check <= 99);
  assert.deepEqual(await band.until((s) => s.kind === 'check'), { kind: 'check', big: String(check) });
  await pause(100);
  assert.deepEqual(early, [], 'nothing is paired before YES');
  assert.equal(ana.view.me.wristband, null);
  const paired = reply(ana, 'paired');
  ana.send({ t: 'confirm', yes: true });
  const m = await paired;
  assert.equal(m.band, band.id);
  assert.match(m.secret, /^[a-f0-9]{32}$/);
  await band.until((s, b) => b.secret === m.secret);
  await ana.until((v) => v.me.check === null && v.me.wristband?.live);
  close(ana, band);
});

test('NO drops the pairing, and the wristband shows fresh letters', async () => {
  const band = await wristband();
  const { code } = band.show;
  const ana = await phone('no-room');
  ana.send({ t: 'pair', code });
  await ana.until((v) => v.me.check);
  await band.until((s) => s.kind === 'check');   // or the old letters would pass for fresh ones
  ana.send({ t: 'confirm', yes: false });
  const fresh = await band.until((s) => s.kind === 'pairing');
  assert.notEqual(fresh.code, code);
  await ana.until((v) => v.me.check === null && v.me.wristband === null);
  const gone = reply(ana, 'error');
  ana.send({ t: 'pair', code });
  assert.equal((await gone).why, 'no such wristband', 'the old letters are gone');
  close(ana, band);
});

test('no answer within PAIR_CHECK_MS: dropped, fresh letters, and the phone is told', async () => {
  const band = await wristband();
  const { code } = band.show;
  const ana = await phone('timeout-room');
  ana.send({ t: 'pair', code });
  await ana.until((v) => v.me.check);
  const told = reply(ana, 'check');
  relay.tickBands(Date.now() + PAIR_CHECK_MS - 1_000);
  await pause(100);
  assert.equal(band.show.kind, 'check', 'not yet');
  relay.tickBands(Date.now() + PAIR_CHECK_MS + 1_000);
  assert.deepEqual(await told, { t: 'check', ok: false, why: 'timeout' });
  assert.notEqual((await band.until((s) => s.kind === 'pairing')).code, code);
  close(ana, band);
});

test('a second pair for a wristband being paired is refused busy', async () => {
  const band = await wristband();
  const { code } = band.show;
  const ana = await phone('busy-room');
  const ben = await phone('busy-room');
  ana.send({ t: 'pair', code });
  await ana.until((v) => v.me.check);
  const busy = reply(ben, 'error');
  ben.send({ t: 'pair', code });
  assert.equal((await busy).why, 'busy');
  close(ana, ben, band);
});

test('check numbers are unique among the pairings in progress', async () => {
  const bands = [];
  for (let i = 0; i < 40; i += 1) bands.push(await wristband());
  const numbers = [];
  for (const b of bands) {
    const p = await phone('unique-room');
    p.send({ t: 'pair', code: b.show.code });
    numbers.push((await p.until((v) => v.me.check)).me.check);
  }
  // Forty from ninety: with nothing keeping them apart, two would share a number all but always.
  assert.equal(new Set(numbers).size, numbers.length, 'every pending number differs: ' + numbers.join(','));
  cleanup();
});

test('every pair attempt counts toward the socket limit, right letters or wrong', async () => {
  relay.expire(Date.now() + 61_000);
  const ana = await phone('count-room', { ip: '203.0.113.20' });
  for (let i = 0; i < 5; i += 1) {
    const band = await wristband();
    ana.send({ t: 'pair', code: band.show.code });
    await ana.until((v) => v.me.check);
    ana.send({ t: 'confirm', yes: false });
    await ana.until((v) => v.me.check === null);
  }
  const band = await wristband();
  const blocked = reply(ana, 'error');
  ana.send({ t: 'pair', code: band.show.code });
  assert.equal((await blocked).why, 'too many tries', 'the sixth, though its letters are right');
  close(ana);
});

// ---------- §0: the secret ----------

test("a paired wristband's hello needs its secret; without it the new socket is refused and the live one survives", async () => {
  const band = await wristband();
  const ana = await phone('secret-room');
  const { secret } = await pairBand(ana, band);
  const bare = await hello({ t: 'wristband', id: band.id, key: band.key, v: 2 });
  assert.deepEqual([bare.reply.why, bare.closed], ['bad band', 4001], 'the id and even the key are not enough');
  const wrong = await hello({ t: 'wristband', id: band.id, key: band.key, v: 2, secret: newKey() });
  assert.equal(wrong.reply.why, 'bad band');
  ana.send({ t: 'arm', intent: 'dance' });
  await band.until((s) => s.kind === 'dance');
  const back = await wristband(62, { key: band.key, secret });
  assert.equal(back.show.kind, 'dance', 'with it, the same wristband, still paired');
  close(ana, back);
});

test('a claim needs the secret', async () => {
  const band = await wristband();
  const ana = await phone('claim-room');
  const { band: id } = await pairBand(ana, band);
  const bare = reply(ana, 'claim');
  ana.send({ t: 'pair', band: id });
  assert.deepEqual(await bare, { t: 'claim', ok: false, why: 'gone' });
  close(ana, band);
});

// ---------- §0: after a relay restart ----------

test('a restarted relay keeps a paired wristband waiting for its owner, and the claim pairs it', async () => {
  const secret = newKey();
  const band = await wristband(62, { secret });
  assert.deepEqual(band.show, { kind: 'waiting' }, 'no letters, no code to scan');
  const ana = await phone('restart-room');
  const ok = reply(ana, 'claim');
  ana.send({ t: 'pair', band: band.id, secret, again: true });
  assert.deepEqual(await ok, { t: 'claim', ok: true, band: band.id });
  await band.until((s) => s.kind === 'off' && !s.away);
  close(ana, band);
});

test('a hold while it waits, or in the hello, is applied at the claim', async () => {
  for (const how of ['hold', 'hello']) {
    const secret = newKey();
    const band = await wristband(62, { secret, quiet: how === 'hello' });
    if (how === 'hold') band.send({ t: 'hold' });
    await pause(50);
    const ana = await phone('restart-quiet-' + how);
    ana.send({ t: 'pair', band: band.id, secret });
    await ana.until((v) => v.me.invisible && v.me.by === 'band');
    close(ana, band);
  }
});

test('nobody claims it for BAND_ALONE_MS: it shows fresh letters', async () => {
  // A relay of its own at 21:00, well clear of 06:00, which would end the wait
  // first (tests/rules.test.js). On the wall clock this failed from 05:01 to 06:00.
  const t = new Date(2026, 8, 24, 21, 0).getTime();
  const own = await createRelay({ port: 0, host: '127.0.0.1', root: dir, clock: () => t });
  const on = helpers(() => own.port);
  try {
    const band = await on.wristband(62, { secret: newKey() });
    own.expire(t + BAND_ALONE_MS - 60_000);
    await pause(50);
    assert.equal(band.show.kind, 'waiting', 'not yet');
    own.expire(t + BAND_ALONE_MS + 1_000);
    await band.until((s) => s.kind === 'pairing');
  } finally {
    on.cleanup();
    await own.close();
  }
});

test('the phone back first: a placeholder is kept, and the wristband\'s secret decides', async () => {
  const key = newKey();
  const secret = newKey();
  const ana = await phone('first-room');
  const waiting = reply(ana, 'claim');
  ana.send({ t: 'pair', band: bandIdOf(key), secret, again: true });
  assert.deepEqual(await waiting, { t: 'claim', ok: false, why: 'waiting' });
  const band = await wristband(62, { key, secret });
  assert.equal(band.show.kind, 'off', 'the same secret: paired');
  await ana.until((v) => v.me.wristband?.live);

  const key2 = newKey();
  const ben = await phone('first-room');
  ben.send({ t: 'pair', band: bandIdOf(key2), secret: newKey() });
  await ben.until((v) => v.me.wristband?.live === false);
  const told = reply(ben, 'claim');
  const other = await wristband(62, { key: key2, secret: newKey() });
  assert.deepEqual(await told, { t: 'claim', ok: false, why: 'gone' }, 'a different secret: its claimer is told');
  assert.equal(other.show.kind, 'waiting', 'and the wristband waits for its own owner');
  close(ana, ben, band, other);
});

test('one placeholder per person', async () => {
  const ana = await phone('one-room');
  const count = relay.bandCount();
  for (let i = 0; i < 3; i += 1) {
    const w = reply(ana, 'claim');
    ana.send({ t: 'pair', band: randomBytes(16).toString('hex'), secret: newKey() });
    await w;
  }
  assert.equal(relay.bandCount(), count + 1);
  close(ana);
});

test('a paired wristband away for BAND_ALONE_MS is forgotten, and the next claim is told gone', async () => {
  const band = await wristband();
  const ana = await phone('away-room');
  const { band: id, secret } = await pairBand(ana, band);
  band.ws.close();
  await ana.until((v) => v.me.wristband?.live === false);
  relay.expire(Date.now() + BAND_ALONE_MS + 1_000);
  const told = reply(ana, 'claim');
  ana.send({ t: 'pair', band: id, secret, again: true });
  assert.deepEqual(await told, { t: 'claim', ok: false, why: 'gone' });
  close(ana);
});

// ---------- rule 1: the wrist's set ----------

/** A person in a room with a paired wristband, and the rev its last show named. */
async function wearing(venue) {
  const band = await wristband();
  const ana = await phone(venue);
  await pairBand(ana, band);
  const show = await band.until((s) => s.kind === 'off' && Number.isInteger(s.rev));
  return { band, ana, rev: show.rev };
}

test('a set is taken: visible, armed, by the band', async () => {
  const { band, ana, rev } = await wearing('set-room');
  band.send({ t: 'set', intent: 'song', basis: rev });
  await ana.until((v) => v.me.armed === 'song' && v.me.by === 'band');
  const show = await band.until((s) => s.kind === 'song');
  assert.ok(show.rev > rev);
  close(ana, band);
});

test('malformed sets are dropped whole, and NOT NOW survives them', async () => {
  const { band, ana } = await wearing('set-junk');
  band.send({ t: 'hold' });
  const { rev } = await band.until((s) => s.quiet);
  for (const m of [
    { t: 'set', basis: rev }, { t: 'set', intent: 'nonsense', basis: rev }, { t: 'set', intent: 7, basis: rev },
    { t: 'set', intent: 'hi' }, { t: 'set', intent: 'hi', basis: String(rev) }, { t: 'set', intent: 'hi', basis: rev + 0.5 },
    { t: 'set', intent: {}, basis: rev }, { t: 'set', intent: ['hi'], basis: rev },
  ]) band.send(m);
  await pause(200);
  assert.equal(ana.view.me.invisible, true, 'still NOT NOW');
  assert.deepEqual(band.replies, [], 'and no answer at all');
  close(ana, band);
});

test('a set from a wristband nobody paired is refused unpaired', async () => {
  const band = await wristband();
  band.send({ t: 'set', intent: 'hi', basis: 1 });
  await band.until((s, b) => b.replies.length === 1);
  assert.deepEqual(band.replies, [{ t: 'set', ok: false, why: 'unpaired' }]);
  close(band);
});

test('a set for a person who is not in a room is refused no room', async () => {
  const { band, ana, rev } = await wearing('set-noroom');
  ana.ws.close();
  await pause(100);
  relay.expire(Date.now() + BAND_ALONE_MS + 1_000);   // held only by the wristband, for the hour
  await band.until((s) => s.away);
  band.send({ t: 'set', intent: 'hi', basis: rev });
  await band.until((s, b) => b.replies.length === 1);
  assert.deepEqual(band.replies, [{ t: 'set', ok: false, why: 'no room' }]);
  close(band);
});

test('a set naming a rev that has moved is refused changed, and changes nothing', async () => {
  const { band, ana, rev } = await wearing('set-changed');
  ana.send({ t: 'invisible', on: true });
  await band.until((s) => s.quiet);
  band.send({ t: 'set', intent: 'hi', basis: rev });
  await band.until((s, b) => b.replies.length === 1);
  assert.deepEqual(band.replies, [{ t: 'set', ok: false, why: 'changed' }]);
  assert.equal(ana.view.me.invisible, true);
  close(ana, band);
});

test('a set chosen while the wristband was someone else\'s is refused changed', async () => {
  // Chosen on ana's wrist and held up on the way, it lands after the band was paired to ben.
  const { band, ana, rev } = await wearing('set-repaired');
  ana.send({ t: 'unpair' });
  await band.until((s) => s.kind === 'pairing');
  const ben = await phone('set-repaired');
  await pairBand(ben, band);
  await band.until((s) => s.kind === 'off' && Number.isInteger(s.rev));
  band.send({ t: 'set', intent: 'hi', basis: rev });
  await band.until((s, b) => b.replies.length === 1);
  assert.deepEqual(band.replies, [{ t: 'set', ok: false, why: 'changed' }]);
  assert.equal(ben.view.me.armed, null, 'ben was not shown with a card he never chose');
  close(ana, ben, band);
});

test('more than one set a second is refused too fast; a second on, the wrist may set again', async () => {
  // A relay of its own with its clock held, so the second is the relay's and not the machine's.
  let t = new Date(2026, 8, 24, 21, 0).getTime();
  const own = await createRelay({ port: 0, host: '127.0.0.1', root: dir, clock: () => t });
  const on = helpers(() => own.port);
  try {
    const band = await on.wristband();
    const ana = await on.phone('set-fast');
    await on.pairBand(ana, band);
    t += 3_000;                                    // past the white flash a new pairing gives
    const { rev } = await band.until((s) => s.kind === 'off' && Number.isInteger(s.rev));
    band.send({ t: 'set', intent: 'hi', basis: rev });
    const { rev: next } = await band.until((s) => s.kind === 'hi');
    band.send({ t: 'set', intent: 'song', basis: next });
    await band.until((s, b) => b.replies.length === 1);
    assert.deepEqual(band.replies, [{ t: 'set', ok: false, why: 'too fast' }]);
    assert.equal(ana.view.me.armed, 'hi');
    t += 1_000;
    band.send({ t: 'set', intent: 'song', basis: next });
    await ana.until((v) => v.me.armed === 'song');
  } finally {
    on.cleanup();
    await own.close();
  }
});

// ---------- the sound switch (docs/superpowers/specs/2026-09-25-wrist-reactions-design.md §3) ----------

test("a phone's sound switch rides on its band's shows: one show a flip, and none when nothing changed", async () => {
  const { band, ana } = await wearing('sound-flip');
  assert.equal('sound' in band.show, false, 'before the phone says it, the show is as it was');
  let shows = 0;
  band.ws.on('message', (d) => { if (JSON.parse(String(d)).t === 'show') shows++; });
  ana.send({ t: 'sound', on: false });
  await band.until((s) => s.sound === false);
  ana.send({ t: 'sound', on: false });
  ana.send({ t: 'profile', name: 'Ana' });
  await pause(150);
  assert.equal(shows, 1, 'the same again sends nothing');
  ana.send({ t: 'sound', on: true });
  await band.until((s) => s.sound === true);
  await pause(50);
  assert.equal(shows, 2);
  close(ana, band);
});

test('a malformed sound is dropped', async () => {
  const { band, ana } = await wearing('sound-bad');
  for (const m of [{ t: 'sound' }, { t: 'sound', on: 'no' }, { t: 'sound', on: 0 }, { t: 'sound', on: 1 }, { t: 'sound', on: null }]) {
    ana.send(m);
    await pause(80);
    assert.equal('sound' in band.show, false, JSON.stringify(m));
  }
  ana.send({ t: 'sound', on: false });
  await band.until((s) => s.sound === false);
  close(ana, band);
});

test("one person's switch never reaches another's band", async () => {
  const { band, ana } = await wearing('sound-two');
  const other = await wristband();
  const ben = await phone('sound-two');
  await pairBand(ben, other);
  await other.until((s) => s.kind === 'off');
  ana.send({ t: 'sound', on: false });
  await band.until((s) => s.sound === false);
  await pause(100);
  assert.equal('sound' in other.show, false);
  close(ana, ben, band, other);
});

test('a band paired with the switch off gets it in its pairing flash; letters and the check carry none', async () => {
  const band = await wristband();
  const ana = await phone('sound-pair');
  ana.send({ t: 'sound', on: false });
  await pause(50);
  assert.equal('sound' in band.show, false, 'letters are nobody\'s');
  ana.send({ t: 'pair', code: band.show.code });
  await ana.until((v) => v.me.check);
  assert.equal('sound' in (await band.until((s) => s.kind === 'check')), false);
  ana.send({ t: 'confirm', yes: true });
  assert.deepEqual(await band.until((s) => s.kind === 'test'), { kind: 'test', sound: false });
  close(ana, band);
});

test("after a restart, a switch said before the claim is on the claimed band's first show; waiting carries none", async () => {
  const secret = newKey();
  const band = await wristband(62, { secret });
  assert.deepEqual(band.show, { kind: 'waiting' });
  const shows = [];
  band.ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'show') shows.push(m.show); });
  const ana = await phone('sound-claim');
  ana.send({ t: 'sound', on: false });
  ana.send({ t: 'pair', band: band.id, secret, again: true });
  await band.until((s) => s.kind === 'off');
  assert.equal(shows[0].sound, false, JSON.stringify(shows));
  close(ana, band);
});

test('leave forgets the switch; the grace does not, and away carries it', async () => {
  const { band, ana } = await wearing('sound-away');
  const ben = await phone('sound-away');   // someone stays, so the room itself is never let go
  ana.send({ t: 'sound', on: false });
  await band.until((s) => s.sound === false);
  ana.ws.close();
  await pause(100);
  relay.expire(Date.now() + BAND_ALONE_MS + 1_000);   // held only by the wristband, for the hour: out
  assert.equal((await band.until((s) => s.away)).sound, false);
  // Back, and gone for good: a band paired after leave hears nothing of the old switch.
  const back = await phone('sound-away', { me: ana.me });
  back.send({ t: 'leave' });
  await reply(back, 'left');
  const again = await phone('sound-away', { me: ana.me });
  const next = await wristband();
  again.send({ t: 'pair', code: next.show.code });
  await again.until((v) => v.me.check);
  again.send({ t: 'confirm', yes: true });
  assert.deepEqual(await next.until((s) => s.kind === 'test'), { kind: 'test' });
  close(again, ben, band, next);
});

// ---------- waves (docs/superpowers/specs/2026-09-25-wrist-waves-design.md §3) ----------

/**
 * Ana wears a band, and ben and cai are in her room; all three on SAY HI. Each
 * picks their own name: that is how a row is found. `on` and `clock` are for
 * a relay of a test's own, whose held clock is moved past the pairing flash.
 */
async function waving(venue, on = { phone, wristband, pairBand }, clock = null) {
  const band = await on.wristband();
  const ana = await on.phone(venue);
  await on.pairBand(ana, band);
  if (clock) clock.t += 3_000;                    // past the white flash a new pairing gives
  const ben = await on.phone(venue);
  const cai = await on.phone(venue);
  for (const [p, who] of [[ana, 'ana'], [ben, 'ben'], [cai, 'cai']]) {
    p.send({ t: 'pick', track: who });
    p.send({ t: 'arm', intent: 'hi' });
  }
  for (const p of [ana, ben, cai]) await p.until((v) => v.near.length === 2 && v.near.every((r) => r.pick));
  await band.until((s) => s.kind === 'hi', 5000);
  const row = (p, who) => p.view.near.find((r) => r.pick === who);
  return { band, ana, ben, cai, row };
}

/** A relay of a test's own, with its clock held: a second is the relay's, not the machine's. */
async function heldRelay(fn) {
  const clock = { t: new Date(2026, 8, 25, 23, 0).getTime() };
  const own = await createRelay({ port: 0, host: '127.0.0.1', root: dir, clock: () => clock.t });
  const on = helpers(() => own.port);
  try {
    await fn(on, clock, own);
  } finally {
    on.cleanup();
    await own.close();
  }
}

/** A band's own wave back, and the relay's answer. */
async function waveBack(band, ref, basis) {
  const before = band.replies.length;
  band.send({ t: 'wave', ref, basis });
  await band.until((s, b) => b.replies.length > before);
  return band.replies.at(-1);
}
const refused = (why) => ({ t: 'wave', ok: false, why });

test('a band on SAY HI is told who waits as its phone lists them: the newest, how many, its number; one show a change', async () => {
  const { band, ana, ben, cai, row } = await waving('waves-show');
  let shows = 0;
  band.ws.on('message', (d) => { if (JSON.parse(String(d)).t === 'show') shows++; });
  ben.send({ t: 'wave', handle: row(ben, 'ana').handle });
  const one = await band.until((s) => s.waves?.n === 1);
  await ana.until(() => row(ana, 'ben').wavedAtYou);
  assert.equal(one.waves.ref, row(ana, 'ben').handle, "the newest, by the handle ana's own phone knows");
  cai.send({ t: 'wave', handle: row(cai, 'ana').handle });
  const two = await band.until((s) => s.waves?.n === 2);
  await ana.until(() => row(ana, 'cai').wavedAtYou);
  assert.equal(two.waves.ref, row(ana, 'cai').handle);
  assert.ok(two.waves.seq > one.waves.seq, 'a later wave has a larger number');
  await pause(50);
  assert.equal(shows, 2, 'one show for each change in who waits');
  ana.send({ t: 'arm', intent: 'song' });
  assert.equal('waves' in (await band.until((s) => s.kind === 'song')), false, 'off SAY HI, none');
  ana.send({ t: 'arm', intent: 'hi' });
  assert.deepEqual((await band.until((s) => s.kind === 'hi')).waves, two.waves, 'back on it, the same');
  ana.send({ t: 'wave', handle: row(ana, 'cai').handle });
  const meet = await band.until((s) => s.kind === 'meet');
  assert.deepEqual(meet.waves, { ...one.waves }, 'a meeting show carries who still waits');
  close(ana, ben, cai, band);
});

test("a wave's number is the relay's own clock: the next is newer past a room let go while empty, and past a restart", async () => {
  let t = new Date(2026, 8, 25, 22, 0).getTime();
  const relays = [];
  const start = async () => {
    const own = await createRelay({ port: 0, host: '127.0.0.1', root: dir, clock: () => t, graceMs: 50 });
    relays.push({ own, on: helpers(() => own.port), open: true });
    return relays.at(-1).on;
  };
  /** Ana on SAY HI, and someone new in the room who waves at her. */
  const waveAt = async (on, ana) => {
    const ben = await on.phone('waves-clock');
    for (const p of [ana, ben]) p.send({ t: 'arm', intent: 'hi' });
    const { near } = await ben.until((v) => v.near.length === 1);
    ben.send({ t: 'wave', handle: near[0].handle });
    return ben;
  };
  try {
    let on = await start();
    const band = await on.wristband();
    const ana = await on.phone('waves-clock');
    await on.pairBand(ana, band);
    t += 3_000;                                    // past the white flash a new pairing gives
    const ben = await waveAt(on, ana);
    const first = (await band.until((s) => s.waves)).waves.seq;
    assert.equal(first, t, "the relay's clock");

    // Everyone goes, and the room is let go. The band comes back paired, with no letters.
    band.ws.close();
    ana.ws.close();
    ben.send({ t: 'leave' });
    await pause(200);
    assert.equal(relays[0].own.rooms.has('waves-clock'), false, 'the room was let go');
    t += 60_000;
    const back = await on.wristband(62, { key: band.key, secret: band.secret });
    assert.equal(back.show.away, true, 'paired still: away, not letters');
    const anaBack = await on.phone('waves-clock', { me: ana.me });
    await waveAt(on, anaBack);
    const second = (await back.until((s) => s.waves)).waves.seq;
    assert.equal(second, t);
    assert.ok(second > first);

    // A restart: a new relay, a later clock. The band waits for its owner, and her phone claims it.
    relays[0].on.cleanup();
    await relays[0].own.close();
    relays[0].open = false;
    t += 60_000;
    on = await start();
    const again = await on.wristband(62, { key: band.key, secret: band.secret });
    assert.deepEqual(again.show, { kind: 'waiting' });
    const anaAgain = await on.phone('waves-clock', { me: ana.me });
    anaAgain.send({ t: 'pair', band: again.id, secret: band.secret, again: true });
    await again.until((s) => s.kind === 'off' && !s.away);
    await waveAt(on, anaAgain);
    const third = (await again.until((s) => s.waves)).waves.seq;
    assert.equal(third, t);
    assert.ok(third > second);
  } finally {
    for (const r of relays) {
      r.on.cleanup();
      if (r.open) await r.own.close();
    }
  }
});

test("a band's wave back makes the match: it is answered ok, and both bands and both phones show the meeting", async () => {
  const { band, ana, ben, cai, row } = await waving('waves-back');
  const his = await wristband();
  await pairBand(ben, his);
  await his.until((s) => s.kind === 'hi', 5000);
  ben.send({ t: 'wave', handle: row(ben, 'ana').handle });
  const s = await band.until((x) => x.waves);
  assert.deepEqual(await waveBack(band, s.waves.ref, s.rev), { t: 'wave', ok: true });
  const [a, b] = await Promise.all([band.until((x) => x.kind === 'meet'), his.until((x) => x.kind === 'meet')]);
  assert.equal(a.big, b.big, 'one number on both wrists');
  const [m] = (await ana.until((v) => v.matches.length === 1)).matches;
  assert.equal(String(m.number), a.big, "and on ana's phone");
  assert.equal(String((await ben.until((v) => v.matches.length === 1)).matches[0].number), a.big, "and on ben's");
  close(ana, ben, cai, band, his);
});

test('a malformed wave from a band is dropped unanswered; the rest are refused unpaired, no room, and too fast before anything is looked up', async () => {
  await heldRelay(async (on, clock, own) => {
    const loose = await on.wristband();
    for (const m of [{ t: 'wave' }, { t: 'wave', ref: 'a1b2c3d4e5' }, { t: 'wave', ref: 'a1b2c3d4e5', basis: '1' },
      { t: 'wave', ref: 'a1b2c3d4e5', basis: 1.5 }, { t: 'wave', ref: 'A1B2C3D4E5', basis: 1 }, { t: 'wave', ref: 'a1b2c3d4e', basis: 1 },
      { t: 'wave', ref: 'a1b2c3d4e5f', basis: 1 }, { t: 'wave', ref: 'g1b2c3d4e5', basis: 1 }, { t: 'wave', ref: 1234567890, basis: 1 }]) {
      loose.send(m);
      await pause(40);
      assert.deepEqual(loose.replies, [], JSON.stringify(m));
    }
    // None of those was stamped: this one, in the same second, is looked at.
    assert.deepEqual(await waveBack(loose, 'a1b2c3d4e5', 1), refused('unpaired'));
    assert.deepEqual(await waveBack(loose, 'b1b2c3d4e5', 1), refused('too fast'), 'the last was refused, and still stamped');
    clock.t += 1_000;
    assert.deepEqual(await waveBack(loose, 'b1b2c3d4e5', 1), refused('unpaired'), 'a second on');

    const band = await on.wristband();
    const ana = await on.phone('waves-noroom');
    await on.pairBand(ana, band);
    clock.t += 3_000;                              // past the white flash a new pairing gives
    ana.ws.close();
    await pause(100);
    own.expire(clock.t + BAND_ALONE_MS + 1_000);   // held only by the wristband, for the hour
    await band.until((s) => s.away);
    assert.deepEqual(await waveBack(band, 'a1b2c3d4e5', 1), refused('no room'));
  });
});

test("a band's wave is refused changed when its person's rev moved, or they left SAY HI or went NOT NOW", async () => {
  await heldRelay(async (on, clock) => {
    const { band, ana, ben, row } = await waving('waves-changed', on, clock);
    ben.send({ t: 'wave', handle: row(ben, 'ana').handle });
    const s = await band.until((x) => x.waves);
    ana.send({ t: 'arm', intent: 'song' });
    ana.send({ t: 'arm', intent: 'hi' });
    await band.until((x) => x.kind === 'hi' && x.rev === s.rev + 2);
    assert.deepEqual(await waveBack(band, s.waves.ref, s.rev), refused('changed'), 'a rev that moved');
    clock.t += 1_000;
    ana.send({ t: 'arm', intent: 'song' });
    const song = await band.until((x) => x.kind === 'song');
    assert.deepEqual(await waveBack(band, s.waves.ref, song.rev), refused('changed'), 'not on SAY HI');
    clock.t += 1_000;
    ana.send({ t: 'invisible', on: true });
    const quiet = await band.until((x) => x.quiet);
    assert.deepEqual(await waveBack(band, s.waves.ref, quiet.rev), refused('changed'), 'NOT NOW');
    await pause(50);
    assert.deepEqual([ana.view.matches, ben.view.matches], [[], []]);
  });
});

test("a band's wave is refused gone for anyone not waiting on its person, a block reading exactly as leaving; a refused one tells nobody", async () => {
  await heldRelay(async (on, clock) => {
    const { band, ana, ben, cai, row } = await waving('waves-gone', on, clock);
    const hi = band.show;
    // A band never starts a wave: cai never waved, so nothing is recorded and nothing reaches his phone.
    assert.deepEqual(await waveBack(band, row(ana, 'cai').handle, hi.rev), refused('gone'), 'not a waver');
    await pause(50);
    assert.equal(row(cai, 'ana').wavedAtYou, false, 'nothing reached cai');
    clock.t += 1_000;
    assert.deepEqual(await waveBack(band, 'a1b2c3d4e5', hi.rev), refused('gone'), 'a made-up ref');
    assert.deepEqual(await waveBack(band, 'b1b2c3d4e5', hi.rev), refused('too fast'), 'a second made-up ref in the same second');

    /** Ben back on SAY HI, and the ref ana's band is given for his wave. */
    const ref = async () => { ben.send({ t: 'arm', intent: 'hi' }); return (await band.until((x) => x.waves)).waves.ref; };
    ben.send({ t: 'wave', handle: row(ben, 'ana').handle });
    let r = await ref();
    ben.send({ t: 'arm', intent: 'song' });
    await band.until((x) => !x.waves);
    await pause(50);
    let heard = 0;
    const count = () => { heard += 1; };
    ben.ws.on('message', count);
    clock.t += 1_000;
    assert.deepEqual(await waveBack(band, r, hi.rev), refused('gone'), 'the waver stopped showing blue');
    await pause(50);
    ben.ws.off('message', count);
    assert.equal(heard, 0, "a refused wave sends nothing to the waver's phone");
    r = await ref();
    ben.send({ t: 'invisible', on: true });
    await band.until((x) => !x.waves);
    clock.t += 1_000;
    assert.deepEqual(await waveBack(band, r, hi.rev), refused('gone'), 'the waver went NOT NOW');
    r = await ref();
    ben.send({ t: 'leave' });
    await band.until((x) => !x.waves);
    clock.t += 1_000;
    const left = await waveBack(band, r, hi.rev);
    assert.deepEqual(left, refused('gone'), 'the waver left');
    cai.send({ t: 'wave', handle: row(cai, 'ana').handle });
    r = (await band.until((x) => x.waves)).waves.ref;
    cai.send({ t: 'block', handle: row(cai, 'ana').handle });
    await band.until((x) => !x.waves);
    clock.t += 1_000;
    assert.deepEqual(await waveBack(band, r, hi.rev), left, 'blocked reads exactly as left');
    assert.deepEqual(ana.view.matches, []);
  });
});

test('a hello without the pairing secret cannot wave for anyone', async () => {
  const { band, ana, ben, cai, row } = await waving('waves-secret');
  ben.send({ t: 'wave', handle: row(ben, 'ana').handle });
  const s = await band.until((x) => x.waves);
  const fake = await hello({ t: 'wristband', id: band.id, key: band.key, v: 2 });
  assert.deepEqual([fake.reply.why, fake.closed], ['bad band', 4001], "ana's band without its secret");
  const stranger = await wristband();
  assert.deepEqual(await waveBack(stranger, s.waves.ref, s.rev), refused('unpaired'), "another band, with ana's ref and rev");
  await pause(50);
  assert.deepEqual([ana.view.matches, ben.view.matches, band.show.waves.n], [[], [], 1]);
  close(ana, ben, cai, band, stranger);
});

test("two people already matched tonight: a band's wave back is answered ok, and makes no second meeting", async () => {
  const { band, ana, ben, cai, row } = await waving('waves-matched');
  const wall = (p, who) => p.view.wall.find((r) => r.pick === who).handle;
  ana.send({ t: 'like', handle: wall(ana, 'ben') });
  ben.send({ t: 'like', handle: wall(ben, 'ana') });
  const [m] = (await ana.until((v) => v.matches.length === 1)).matches;
  await band.until((x) => x.kind === 'meet');
  ben.send({ t: 'wave', handle: row(ben, 'ana').handle });
  const s = await band.until((x) => x.waves);
  assert.deepEqual(await waveBack(band, s.waves.ref, s.rev), { t: 'wave', ok: true });
  await pause(100);
  assert.deepEqual(ana.view.matches.map((x) => [x.id, x.number]), [[m.id, m.number]], 'the match they had, and no other');
  close(ana, ben, cai, band);
});
