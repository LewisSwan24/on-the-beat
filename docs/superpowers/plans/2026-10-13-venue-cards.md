# Venue cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People at an unlisted gig can make its room with a name, the phone finds tonight's rooms nearest first with one tap, and it warns when the room chosen is more than 500 m away.

**Architecture:** A room holds an optional *venue card* (relay/room.js), filled first-in-wins over the existing socket and kept in the night file with the room. The relay lists visible cards after the listed shows on `/api/shows`. The phone works out distance itself (app/lib/where.js); its own place stays in memory and leaves it only rounded, as the place of a room it makes.

**Tech Stack:** Node 24 (`node:test`), React 18 + Vite, plain WebSocket relay, headless Chrome over CDP for the browser check.

**Spec:** `docs/superpowers/specs/2026-10-13-venue-cards-design.md`

## Global Constraints

- Card fields: `venue` required, at most 80 characters; `act` at most 60; `doors`, `support`, `break`, `headline`, `end` each `HH:MM`; `lat`/`lon` rounded by the relay to 0.001°.
- First in wins: a field that is set is never changed by a fill. Two different people reporting the same field clear it; two on `venue` hide the card from lists.
- A card whose key is a listed show's id is refused.
- At most 3 cards per address a night (IPv6 by its /64, `relay/address.js`), counted in memory. At most 200 cards a night, counted from the rooms.
- Refusals are `{t:'error', why}` with `why` one of `fill taken`, `fill limit`, `fill full`, `fill listed`, `fill bad`.
- Nearby means within 2 km. Wrong room means more than 500 m from the room's place.
- The phone's place is never written to storage and never sent, except rounded as the place of a room being made.
- Artefacts in English; the README is not touched beyond what a doc already says about venues. Nothing from `../on-the-beat-research/` or `../on-the-beat-design/` comes in.
- `npm test` builds first; run a single file only after `npm run build`.

## Review Focus

1. A fill that mixes a set field with an empty one (for example `act` set, `doors` new). Expected: refused whole as `fill taken`, nothing written. Pinned in Task 1.
2. A card with no place, or a phone with no location. Expected: listed after the near ones, no distance label, no wrong-room banner. Pinned in Tasks 3 and 5.
3. Venue names that fold to one key ("The Moth Club" and "moth club!"). Expected: one room, one card, the second maker joins it instead of making one. Pinned in Task 2 (server) and Task 4 (phone suggests it).
4. A relay restart between making a room and someone else joining it. Expected: the card is still listed and still first-in-wins. Pinned in Task 2.
5. 06:00 with a card on a room nobody is in. Expected: the card goes, the room is collected, the key is no longer listed. Pinned in Task 2.

---

### Task 1: The venue card in the room

**Files:**
- Modify: `relay/room.js` (state next to `opener`/`notice`; `fillCard`, `wrongCard`, `card`; `letGo`; `viewFor`; `dump`/restore)
- Test: `tests/venue-card.test.js` (new)

**Interfaces:**
- Produces, on the object `createRoom()` returns:
  - `fillCard(viewer: string, fields: object) => 'ok' | 'taken' | 'bad'`. Creating needs `venue`. `lat`/`lon` are taken only in the fill that creates the card.
  - `wrongCard(viewer: string, field: string) => boolean`: true when that report cleared the field or hid the card.
  - `card() => null | { venue, act?, doors?, support?, break?, headline?, end?, lat?, lon?, made: true, hidden: boolean }`
  - `viewFor(id).card`: `card()` without `hidden`, or `null`.
  - `dump().card`: the whole card state (including `at` and the wrong reports), restored by `createRoom({ restore })`.
  - `letGo(isOld)` also clears the card when `isOld(card.at)`, so the relay's existing 06:00 call clears it with no new code there.

- [ ] **Step 1: Write the failing tests**

```js
// ON THE BEAT — a room's venue card: made by the people there, first in wins, two "wrong"s clear a field.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom } from '../relay/room.js';

const T = Date.UTC(2026, 9, 13, 11, 0);
function room() {
  const r = createRoom({ now: () => T, salt: 'test' });
  for (const id of ['ana', 'ben', 'cai']) r.join(id);
  return r;
}

test('making a card needs a venue; it is shown to everyone in the room with made: true', () => {
  const r = room();
  assert.equal(r.fillCard('ana', { act: 'KAYO LANE' }), 'bad', 'no venue, no card');
  assert.equal(r.card(), null);
  assert.equal(r.fillCard('ana', { venue: '  The Lexington ', act: 'KAYO LANE' }), 'ok');
  assert.deepEqual(r.viewFor('ben').card, { venue: 'The Lexington', act: 'KAYO LANE', made: true });
});

test('first in wins: a set field is never changed, and a fill touching one is refused whole', () => {
  const r = room();
  r.fillCard('ana', { venue: 'The Lexington' });
  assert.equal(r.fillCard('ben', { act: 'KAYO LANE' }), 'ok');
  assert.equal(r.fillCard('cai', { act: 'SOMEONE ELSE' }), 'taken');
  assert.equal(r.fillCard('cai', { act: 'SOMEONE ELSE', doors: '19:30' }), 'taken', 'mixed with a new field: nothing is written');
  assert.equal(r.card().doors, undefined);
  assert.equal(r.fillCard('cai', { doors: '19:30' }), 'ok');
  assert.equal(r.card().act, 'KAYO LANE');
});

test('bad input is refused and never throws: long text, not HH:MM, a place after making, a place out of range', () => {
  const r = room();
  assert.equal(r.fillCard('ana', { venue: 'x'.repeat(81) }), 'bad');
  assert.equal(r.fillCard('ana', { venue: 'Ok', lat: 91, lon: 0 }), 'bad');
  assert.equal(r.fillCard('ana', { venue: 'Ok', lat: 51.5, lon: Number.NaN }), 'bad');
  assert.equal(r.fillCard('ana', { venue: { toString: () => 'sneaky' } }), 'bad');
  assert.equal(r.fillCard('ana', { venue: 'Ok' }), 'ok');
  assert.equal(r.fillCard('ana', { doors: '7pm' }), 'bad');
  assert.equal(r.fillCard('ana', { act: 'y'.repeat(61) }), 'bad');
  assert.equal(r.fillCard('ana', { lat: 51.5, lon: -0.1 }), 'bad', 'the place comes only with the making');
  assert.equal(r.fillCard('ana', null), 'bad');
});

test('the place is rounded to 0.001 degrees, whatever the phone sent', () => {
  const r = room();
  r.fillCard('ana', { venue: 'The Lexington', lat: 51.531863, lon: -0.110427 });
  assert.equal(r.card().lat, 51.532);
  assert.equal(r.card().lon, -0.11);
});

test('two different people saying a field is wrong clear it; one person twice does not', () => {
  const r = room();
  r.fillCard('ana', { venue: 'The Lexington', act: 'RUDE WORD' });
  assert.equal(r.wrongCard('ben', 'act'), false);
  assert.equal(r.wrongCard('ben', 'act'), false, 'the same person counts once');
  assert.equal(r.card().act, 'RUDE WORD');
  assert.equal(r.wrongCard('cai', 'act'), true);
  assert.equal(r.card().act, undefined);
  assert.equal(r.fillCard('ben', { act: 'KAYO LANE' }), 'ok', 'cleared: it can be filled again');
  assert.equal(r.wrongCard('ben', 'nonsense'), false);
});

test('two wrongs on the venue hide the card from lists; the people inside still see it', () => {
  const r = room();
  r.fillCard('ana', { venue: 'Not A Real Place' });
  r.wrongCard('ben', 'venue');
  r.wrongCard('cai', 'venue');
  assert.equal(r.card().hidden, true);
  assert.equal(r.viewFor('ana').card.venue, 'Not A Real Place');
  assert.equal('hidden' in r.viewFor('ana').card, false);
});

test('the card survives a restart, wrong reports included', () => {
  const r = room();
  r.fillCard('ana', { venue: 'The Lexington', act: 'X' });
  r.wrongCard('ben', 'act');
  const back = createRoom({ now: () => T, salt: 'test', restore: JSON.parse(JSON.stringify(r.dump())) });
  assert.equal(back.card().venue, 'The Lexington');
  assert.equal(back.wrongCard('cai', 'act'), true, 'ben\'s report came back with it');
});

test('letGo() takes last night\'s card with the rest of what was said for last night', () => {
  const r = room();
  r.fillCard('ana', { venue: 'The Lexington' });
  assert.equal(r.letGo((t) => t < T), false, 'made tonight: kept');
  assert.equal(r.letGo((t) => t <= T), true);
  assert.equal(r.card(), null);
});

test('a dump from before cards restores with no card', () => {
  const r = room();
  const d = JSON.parse(JSON.stringify(r.dump()));
  delete d.card;
  assert.equal(createRoom({ now: () => T, salt: 'test', restore: d }).card(), null);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/venue-card.test.js`
Expected: FAIL with `r.fillCard is not a function`.

- [ ] **Step 3: Implement**

In `relay/room.js`, next to the other module constants (after `TIME_KEYS`):

```js
// A venue card: what the people at an unlisted gig say it is (docs/superpowers/specs/2026-10-13-venue-cards-design.md).
export const CARD_TEXT = { venue: 80, act: 60 };
export const CARD_FIELDS = ['venue', 'act', ...TIME_KEYS];
const WRONG_TO_CLEAR = 2;
const place = (x, lim) => (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= lim ? Math.round(x * 1000) / 1000 : null);
const cardText = (v, max) => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\p{C}/gu, '').trim();
  return t && t.length <= max ? t : null;
};
```

Inside `createRoom`, with the other night state (next to `opener`):

```js
  // The venue card, for a room nobody listed: { fields, lat, lon, at, wrong: { field: [ids] }, hidden }, or null.
  let card = null;
```

In the restore block, after the line that restores `notice`:

```js
    // A file from before venue cards has none.
    const c = restore.card;
    if (c && typeof c === 'object' && c.fields && typeof c.fields.venue === 'string') {
      card = { fields: { ...c.fields }, lat: c.lat ?? null, lon: c.lon ?? null, at: Number(c.at) || 0, wrong: { ...(c.wrong || {}) }, hidden: !!c.hidden };
    }
```

The functions (anywhere among the room's functions, for example after `setNotice`):

```js
  /** Fill a venue card, first in wins (spec §1). Making one needs `venue`; its place comes only then. */
  function fillCard(viewer, fields) {
    if (!people.has(viewer) || !fields || typeof fields !== 'object') return 'bad';
    const set = {};
    for (const k of CARD_FIELDS) {
      if (!(k in fields)) continue;
      const v = k in CARD_TEXT ? cardText(fields[k], CARD_TEXT[k]) : (typeof fields[k] === 'string' && nightMinsOf(fields[k]) !== null ? fields[k] : null);
      if (v === null) return 'bad';
      set[k] = v;
    }
    const placed = 'lat' in fields || 'lon' in fields;
    if (!card) {
      if (!set.venue) return 'bad';
      const lat = placed ? place(fields.lat, 90) : null;
      const lon = placed ? place(fields.lon, 180) : null;
      if (placed && (lat === null || lon === null)) return 'bad';
      card = { fields: set, lat, lon, at: now(), wrong: {}, hidden: false };
      return 'ok';
    }
    if (placed || !Object.keys(set).length) return 'bad';
    if (Object.keys(set).some((k) => k in card.fields)) return 'taken';
    Object.assign(card.fields, set);
    return 'ok';
  }

  /** "Something's wrong here": two different people on one field clear it; on `venue`, the card leaves every list. */
  function wrongCard(viewer, field) {
    if (!card || !people.has(viewer) || !CARD_FIELDS.includes(field) || !(field in card.fields)) return false;
    const who = card.wrong[field] || (card.wrong[field] = []);
    if (who.includes(viewer)) return false;
    who.push(viewer);
    if (who.length < WRONG_TO_CLEAR) return false;
    delete card.wrong[field];
    if (field === 'venue') card.hidden = true;
    else delete card.fields[field];
    return true;
  }

  const cardOut = () => (card ? { ...card.fields, ...(card.lat !== null ? { lat: card.lat, lon: card.lon } : {}), made: true } : null);
  const cardOf = () => (card ? { ...cardOut(), hidden: card.hidden } : null);
```

In `viewFor`'s returned object, next to `notice`:

```js
      // What the people here said this venue is, when nobody listed it.
      card: cardOut(),
```

In `dump()`, next to `notice`:

```js
      card: card ? { fields: { ...card.fields }, lat: card.lat, lon: card.lon, at: card.at, wrong: { ...card.wrong }, hidden: card.hidden } : null,
```

In `letGo(isOld)`, before `return gone;`:

```js
    if (card && isOld(card.at)) { card = null; gone = true; }
```

(`now` is the room's clock option, already used by the room; if the room names it differently, use that name.)

In the returned API list, add `fillCard, wrongCard, card: cardOf`.

- [ ] **Step 4: Run them to see them pass, and the room's other tests**

Run: `node --test tests/venue-card.test.js tests/room.test.js tests/restart.test.js`
Expected: PASS, all.

- [ ] **Step 5: Mutation-check the guards** (each run once and restored)

- `if (Object.keys(set).some((k) => k in card.fields)) return 'taken';` deleted ⇒ exactly `first in wins…` goes red.
- `if (who.includes(viewer)) return false;` deleted ⇒ exactly `two different people…` goes red.
- `if (placed || …` → `if (!Object.keys(set).length)` ⇒ exactly `bad input…` goes red.

- [ ] **Step 6: Commit**

```bash
git add relay/room.js tests/venue-card.test.js
git commit -m "Venue cards: a room's card, first in wins, two wrongs clear it, kept across a restart"
```

---

### Task 2: The relay: fill and wrong on the socket, limits, listing, 06:00

**Files:**
- Modify: `relay/server.js` (`showFault`, `createRelay` options, the phone `switch (m.t)`, `gcRoom`, `showsNow`, `expire`)
- Modify: `relay/shows.json` (`lat`/`lon` on the four shows)
- Test: `tests/server.test.js`, `tests/restart.test.js`, `tests/shows.test.js`

**Interfaces:**
- Consumes: Task 1's `fillCard`, `wrongCard`, `card`, `letGo` (which now clears the card).
- Produces: phone messages `{t:'fill', venue?, act?, doors?…, lat?, lon?}` and `{t:'wrong', field}`; refusals `{t:'error', why:'fill taken'|'fill limit'|'fill full'|'fill listed'|'fill bad'}`; `/api/shows` entries for cards `{ id: <room key>, venue, act?, …times, lat?, lon?, made: true }` after the listed shows; listed shows may carry `lat`/`lon` numbers.
- `createRelay({ cardsMax })`, default `CARDS_MAX`; exported `CARDS_PER_ADDRESS = 3`, `CARDS_MAX = 200`.

- [ ] **Step 1: Write the failing tests**

At the end of `tests/server.test.js` (its `phone(venue, { ip })` comes from `tests/relay-harness.js`; each phone collects `errors`, and `p.until(pred)` waits on its view):

```js
// ---------- venue cards (docs/superpowers/specs/2026-10-13-venue-cards-design.md) ----------

const until = async (ok, ms = 3000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error('timed out'); await pause(20); }
};
const listedNow = async () => (await (await fetch(url('/api/shows'))).json());

test('venue cards: made on the socket, shown in the room, listed after the listed shows, first in wins', async () => {
  const a = await phone('the lexington');
  const b = await phone('the lexington');
  a.send({ t: 'fill', venue: 'The Lexington', lat: 51.531863, lon: -0.110427 });
  await b.until((v) => v.card?.venue === 'The Lexington');
  const listed = await listedNow();
  assert.deepEqual(listed.find((s) => s.id === 'the lexington'), { id: 'the lexington', venue: 'The Lexington', lat: 51.532, lon: -0.11, made: true });
  assert.ok(listed.findIndex((s) => s.made) > listed.findIndex((s) => !s.made), 'listed shows first');
  b.send({ t: 'fill', venue: 'Somewhere Else' });
  await until(() => b.errors.includes('fill taken'));
  b.send({ t: 'fill', act: 'KAYO LANE' });
  await a.until((v) => v.card?.act === 'KAYO LANE');
});

test('venue cards: refused on a listed show, and bad input is refused by name', async () => {
  const listedId = (await listedNow()).find((s) => !s.made).id;
  const l = await phone(listedId);
  l.send({ t: 'fill', venue: 'Mine Now' });
  await until(() => l.errors.includes('fill listed'));
  const x = await phone('card bad');
  x.send({ t: 'fill', venue: 'x'.repeat(81) });
  await until(() => x.errors.includes('fill bad'));
});

test('venue cards: past three from one address, the fourth is refused', async () => {
  const ip = '203.0.113.9';
  for (const name of ['one', 'two', 'three']) {
    const p = await phone('card ' + name, { ip });
    p.send({ t: 'fill', venue: 'Card ' + name });
    await p.until((v) => v.card?.venue === 'Card ' + name);
  }
  const fourth = await phone('card four', { ip });
  fourth.send({ t: 'fill', venue: 'Card four' });
  await until(() => fourth.errors.includes('fill limit'));
});

test('venue cards: two different people saying the venue is wrong take it off the list', async () => {
  const maker = await phone('card hide');
  maker.send({ t: 'fill', venue: 'Not Real' });
  await maker.until((v) => v.card?.venue === 'Not Real');
  const x = await phone('card hide');
  const y = await phone('card hide');
  x.send({ t: 'wrong', field: 'venue' });
  await pause(100);
  assert.ok((await listedNow()).some((s) => s.id === 'card hide'), 'one is not enough');
  y.send({ t: 'wrong', field: 'venue' });
  await until(async () => !(await listedNow()).some((s) => s.id === 'card hide'));
});

test('venue cards: the night holds at most cardsMax, counted from the rooms', async () => {
  const r2 = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'dist'), cardsMax: 1 });
  const h = helpers(() => r2.port);
  try {
    const p = await h.phone('first');
    p.send({ t: 'fill', venue: 'First' });
    await p.until((v) => v.card?.venue === 'First');
    const q = await h.phone('second');
    q.send({ t: 'fill', venue: 'Second' });
    await until(() => q.errors.includes('fill full'));
  } finally {
    h.cleanup();
    await r2.close();
  }
});

test('venue cards: a room with a card is kept when everyone has left it', async () => {
  const p = await phone('card kept');
  p.send({ t: 'fill', venue: 'Kept' });
  await p.until((v) => v.card?.venue === 'Kept');
  const left = reply(p, 'left');
  p.send({ t: 'leave' });
  await left;
  relay.expire(Date.now());
  assert.ok((await listedNow()).some((s) => s.id === 'card kept'));
});
```

In `tests/restart.test.js` (its `night()` helper starts a relay on a night file at 21:00 Brisbane, `n.restart()` stops and starts it on the same file, `until(pred)` polls, and `n.relay.expire(at)` runs the minute sweep):

```js
test('a venue card comes back with its room after a restart, still first in wins', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-card');
  ana.send({ t: 'fill', venue: 'The Lexington', act: 'KAYO LANE' });
  await ana.until((v) => v.card?.act === 'KAYO LANE');
  await n.restart();
  const shows = await (await fetch('http://127.0.0.1:' + n.relay.port + '/api/shows')).json();
  assert.equal(shows.find((s) => s.id === 'restart-card')?.venue, 'The Lexington');
  const ben = await n.on.phone('restart-card');
  ben.send({ t: 'fill', act: 'SOMEONE ELSE' });
  await until(() => ben.errors.includes('fill taken'));
});

test('06:00 takes last night\'s venue cards, and the room with nobody in it goes with them', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-card-six');
  ana.send({ t: 'fill', venue: 'Gone By Six' });
  await ana.until((v) => v.card?.venue === 'Gone By Six');
  const left = n.on.reply(ana, 'left');
  ana.send({ t: 'leave' });
  await left;
  n.clock.t = Date.UTC(2026, 8, 29, 20, 0, 30);   // 06:00:30 on 30 Sep at the venue
  n.relay.expire(n.clock.t);
  const shows = await (await fetch('http://127.0.0.1:' + n.relay.port + '/api/shows')).json();
  assert.equal(shows.some((s) => s.id === 'restart-card-six'), false);
});
```

In `tests/shows.test.js` (its `show(id)`, `fileWith(name, body)`, `choose(file)` and `shipped`):

```js
test('a listed show may carry lat/lon numbers; anything else there drops the entry', () => {
  const { shows, said } = choose(fileWith('placed.json', [{ ...show('a'), lat: 51.5, lon: -0.1 }, { ...show('b'), lat: '51.5' }]));
  assert.deepEqual(shows.map((s) => s.id), ['a']);
  assert.deepEqual([shows[0].lat, shows[0].lon], [51.5, -0.1]);
  assert.ok(said.some((l) => /entry 2 of .* dropped: "lat" must be a number/.test(l)), said.join('\n'));
});

test('the shipped shows each carry a place', () => {
  for (const s of shipped) assert.ok(Number.isFinite(s.lat) && Number.isFinite(s.lon), s.id);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run build && node --test tests/server.test.js tests/restart.test.js tests/shows.test.js`
Expected: the new tests FAIL (no `card` in views, `fill` ignored, `lat` accepted as text, shipped shows without places).

- [ ] **Step 3: Implement**

In `relay/server.js`, with the other exported limits:

```js
export const CARDS_PER_ADDRESS = 3;
export const CARDS_MAX = 200;
```

In `showFault`, before its final `return '';`:

```js
  for (const f of ['lat', 'lon']) if (s[f] != null && !(typeof s[f] === 'number' && Number.isFinite(s[f]))) return `"${f}" must be a number`;
```

`createRelay`'s options gain `cardsMax = CARDS_MAX`. Next to the `rooms` map:

```js
  // Venue cards made from each address tonight (spec §1). In memory: a restart starts the count again; the cap of
  // cardsMax is counted from the rooms, so it holds across one.
  const cardsFrom = new Map();
  let cardsNight = null;
  const listedIds = new Set(shows.map((s) => s.id));
  const cardsTonight = () => [...rooms.values()].filter((r) => r.room.card()).length;
```

(Use the name the relay already gives the chosen shows list; `shows` above stands for it.)

In the phone `switch (m.t)`, after `case 'report'`:

```js
      case 'fill': {
        const making = !room.card();
        const no = (why) => ws.send(JSON.stringify({ t: 'error', why: 'fill ' + why }));
        if (making && listedIds.has(r.key)) { no('listed'); break; }
        if (making && cardsTonight() >= cardsMax) { no('full'); break; }
        if (making && (cardsFrom.get(ws.addr) || 0) >= CARDS_PER_ADDRESS) { no('limit'); break; }
        const { t: _, ...fields } = m;
        const said = room.fillCard(me, fields);
        if (said !== 'ok') { no(said); break; }
        if (making) cardsFrom.set(ws.addr, (cardsFrom.get(ws.addr) || 0) + 1);
        push(r);
        break;
      }
      case 'wrong': if (room.wrongCard(me, String(m.field || ''))) push(r); break;
```

(The address is never passed into the room: the night file must not hold addresses.)

In `gcRoom`, the staff line becomes:

```js
    if (r.room.opener() || r.room.notice() || r.room.times() || r.room.closed() || r.room.card()) return;
```

In `showsNow`, after the existing `list`/`moved` computation, replace its returns with:

```js
    const cards = [...rooms.values()]
      .map((r) => [r.key, r.room.card()])
      .filter(([, c]) => c && !c.hidden)
      .map(([id, { hidden: _, ...c }]) => ({ id, ...c }));
    if (!moved && !cards.length) return showsJson;
    return JSON.stringify([...(moved ? list : shows), ...cards]);
```

In `expire`, after `const tonight = night(at);`:

```js
    if (cardsNight !== tonight) { cardsFrom.clear(); cardsNight = tonight; }
```

The card itself needs nothing more: the `letGo` call already in `expire` clears it (Task 1), and the `gcRoom` loop after it lets the empty room go.

In `relay/shows.json`, add to each show (approximate, the venue's front door):

| id | lat | lon |
|---|---|---|
| `roundhouse-bruno-mars` | 51.5432 | -0.1519 |
| `moth-club-kayo-lane` | 51.5453 | -0.0560 |
| `electric-ballroom-the-long-weekend` | 51.5390 | -0.1426 |
| `earth-sable-court` | 51.5491 | -0.0757 |

- [ ] **Step 4: Run them to see them pass, then the whole suite**

Run: `npm test`
Expected: PASS, every file.

- [ ] **Step 5: Mutation-check** (each once, restored, rebuilt)

- the `no('listed')` line deleted ⇒ exactly `refused on a listed show…` goes red;
- `>= CARDS_PER_ADDRESS` → `> CARDS_PER_ADDRESS` ⇒ exactly `past three from one address…` goes red;
- `|| r.room.card()` deleted from `gcRoom` ⇒ exactly `a room with a card is kept…` goes red;
- `if (card && isOld(card.at)) …` deleted from `letGo` ⇒ the `06:00 takes last night's venue cards…` test and Task 1's `letGo()` test go red.

- [ ] **Step 6: Commit**

```bash
git add relay/server.js relay/shows.json tests/server.test.js tests/restart.test.js tests/shows.test.js
git commit -m "Venue cards on the relay: fill and wrong, three an address, two hundred a night, listed after the shows"
```

---

### Task 3: Where you are, worked out on the phone

**Files:**
- Create: `app/lib/where.js`
- Test: `tests/where.test.js` (new)

**Interfaces:**
- Produces:
  - `NEAR_M = 2000`, `WRONG_M = 500`
  - `distanceM(a: {lat, lon}, b: {lat, lon}) => number` (metres, haversine)
  - `distanceLabel(m: number) => string`: under 1000 m, rounded to 50 m, `"300 m"`; under 10 km, one decimal, `"3.2 km"`; else whole, `"12 km"`
  - `byPlace(shows: object[], here: {lat, lon} | null) => { near: Array<show & { away: number }>, rest: object[] }`: near within `NEAR_M`, nearest first; rest in their order
  - `wrongRoom(here, show) => number | null`: metres when both have a place and they are more than `WRONG_M` apart, else null
  - `wrongLine(m: number, show) => string`: `"You're 3 km from Moth Club. Wrong place?"` (the venue's part before the first comma)
  - `roundPlace(here) => {lat, lon}`: to 0.001°
  - `cardOver(show, card) => show`: the card's fields laid over the night's show; `show` returned as is when either is null

- [ ] **Step 1: Write the failing tests**

```js
// ON THE BEAT — where you are, worked out on the phone (docs/superpowers/specs/2026-10-13-venue-cards-design.md §2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEAR_M, WRONG_M, byPlace, cardOver, distanceLabel, distanceM, roundPlace, wrongLine, wrongRoom } from '../app/lib/where.js';

const MOTH = { lat: 51.5453, lon: -0.056 };
const ROUNDHOUSE = { lat: 51.5432, lon: -0.1519 };

test('distanceM: Moth Club to the Roundhouse is about 6.6 km; a place to itself is 0', () => {
  assert.ok(Math.abs(distanceM(MOTH, ROUNDHOUSE) - 6650) < 150);
  assert.equal(distanceM(MOTH, MOTH), 0);
});

test('distanceLabel: metres to 50 under a kilometre, one decimal under ten, whole beyond', () => {
  assert.equal(distanceLabel(12), '0 m');
  assert.equal(distanceLabel(312), '300 m');
  assert.equal(distanceLabel(980), '1000 m');
  assert.equal(distanceLabel(3240), '3.2 km');
  assert.equal(distanceLabel(12_400), '12 km');
});

test('byPlace: within 2 km nearest first with its distance; the rest, and places unknown, after in their order', () => {
  const shows = [
    { id: 'roundhouse', ...ROUNDHOUSE },
    { id: 'nowhere' },
    { id: 'moth', ...MOTH },
    { id: 'next-door', lat: 51.5458, lon: -0.0565 },
  ];
  const { near, rest } = byPlace(shows, MOTH);
  assert.deepEqual(near.map((s) => s.id), ['moth', 'next-door']);
  assert.ok(near[1].away > 0 && near[1].away < NEAR_M);
  assert.deepEqual(rest.map((s) => s.id), ['roundhouse', 'nowhere']);
  assert.deepEqual(byPlace(shows, null), { near: [], rest: shows });
});

test('wrongRoom: more than 500 m from a room with a place; nothing without one or without a fix', () => {
  assert.equal(wrongRoom(MOTH, { ...MOTH }), null);
  assert.equal(wrongRoom({ lat: 51.5453, lon: -0.0632 }, MOTH), null, 'about 500 m: not yet');
  assert.ok(wrongRoom(ROUNDHOUSE, { venue: 'Moth Club, Hackney', ...MOTH }) > WRONG_M);
  assert.equal(wrongRoom(null, MOTH), null);
  assert.equal(wrongRoom(ROUNDHOUSE, { venue: 'Typed' }), null);
});

test('wrongLine names the venue before its comma', () => {
  assert.equal(wrongLine(3240, { venue: 'Moth Club, Hackney' }), "You're 3.2 km from Moth Club. Wrong place?");
});

test('roundPlace rounds to 0.001 degrees, as the relay does', () => {
  assert.deepEqual(roundPlace({ lat: 51.531863, lon: -0.110427 }), { lat: 51.532, lon: -0.11 });
});

test('cardOver lays what the people there said over the typed show', () => {
  const typed = { id: null, room: 'the lexington', act: 'THE LEXINGTON', venue: 'your word for it', typed: true };
  assert.deepEqual(cardOver(typed, { venue: 'The Lexington', doors: '19:30', made: true }),
    { id: null, room: 'the lexington', act: '', venue: 'The Lexington', doors: '19:30', typed: true, made: true });
  assert.equal(cardOver(typed, null), typed);
  assert.equal(cardOver(null, { venue: 'x' }), null);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/where.test.js`
Expected: FAIL with `Cannot find module '../app/lib/where.js'`.

- [ ] **Step 3: Implement `app/lib/where.js`**

```js
// ON THE BEAT — where you are, worked out on the phone. Its own place never leaves it: the relay sends every room's
// rough place and the phone sorts (docs/superpowers/specs/2026-10-13-venue-cards-design.md §2).

export const NEAR_M = 2000;
export const WRONG_M = 500;
const R = 6_371_000;
const rad = (d) => (d * Math.PI) / 180;
const placed = (p) => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon);

/** Metres between two places, along the ground. */
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "300 m", "3.2 km", "12 km". */
export function distanceLabel(m) {
  if (m < 1000) return Math.round(m / 50) * 50 + ' m';
  if (m < 10_000) return (Math.round(m / 100) / 10).toFixed(1) + ' km';
  return Math.round(m / 1000) + ' km';
}

/** Tonight's rooms within NEAR_M, nearest first with how far (`away`); then the rest as they came. */
export function byPlace(shows, here) {
  if (!placed(here)) return { near: [], rest: shows };
  const near = [];
  const rest = [];
  for (const s of shows) {
    const away = placed(s) ? distanceM(here, s) : Infinity;
    if (away <= NEAR_M) near.push({ ...s, away });
    else rest.push(s);
  }
  near.sort((a, b) => a.away - b.away);
  return { near, rest };
}

/** How far the room is when that is more than WRONG_M; null when it is not, or either place is unknown. */
export function wrongRoom(here, show) {
  if (!placed(here) || !placed(show)) return null;
  const m = distanceM(here, show);
  return m > WRONG_M ? m : null;
}

export const wrongLine = (m, show) =>
  "You're " + distanceLabel(m) + ' from ' + String(show?.venue || 'the venue').split(',')[0].trim() + '. Wrong place?';

export const roundPlace = (p) => ({ lat: Math.round(p.lat * 1000) / 1000, lon: Math.round(p.lon * 1000) / 1000 });

/** The night's show with what the people there said laid over it. A typed show's placeholder act goes. */
export function cardOver(show, card) {
  if (!show || !card) return show;
  return { ...show, act: card.act || (show.typed ? '' : show.act), ...card };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/where.test.js`
Expected: PASS. If `distanceLabel(980)` reads `'1000 m'`, that is intended: it rounds to 50 m before choosing the unit.

- [ ] **Step 5: Commit**

```bash
git add app/lib/where.js tests/where.test.js
git commit -m "Venue cards: distance, nearest first and the wrong-room check, on the phone"
```

---

### Task 4: Choosing a venue: FIND ME, nearest first, NOT HERE? ADD IT

**Files:**
- Modify: `app/lib/device.js` (`locate`, `locationGranted`)
- Modify: `app/screens/Onboard.jsx` (`Venue`)
- Modify: `app/App.jsx` (the place in memory, `chooseShow`, the first fill after joining, `fill` refusals)
- Modify: `app/copy.js` (`WHERE` words)
- Test: `tests/copy.test.js` (the words), browser check in Task 6

**Interfaces:**
- Consumes: Task 3's `byPlace`, `distanceLabel`, `roundPlace`, `cardOver`; Task 2's `fill` message and `fill …` refusals; `app/lib/typed.js` `roomOf`.
- Produces:
  - `locate({ timeout = 8000 } = {}) => Promise<{lat, lon} | null>`
  - `locationGranted() => Promise<boolean>`
  - `Venue` props: `here`, `finding`, `onFind`, `onMake(name, act)` (besides today's)
  - night state `makeCard: { venue, act?, lat?, lon? } | null`
  - `WHERE = { find, finding, cant, notHere, oneOfThese, make, made, taken, limit, full, listed, bad }` in `app/copy.js`

- [ ] **Step 1: The words, test first** (append to `tests/copy.test.js`)

```js
test('venue cards: every refusal of a fill has its own words, and none blames the person', async () => {
  const { WHERE } = await import('../app/copy.js');
  for (const k of ['taken', 'limit', 'full', 'listed', 'bad']) assert.ok(WHERE[k] && !/you did|your fault/i.test(WHERE[k]), k);
  assert.match(WHERE.cant, /list/);
});
```

Run: `node --test tests/copy.test.js` → FAIL. Then add to `app/copy.js`:

```js
/** Finding the venue, and making one nobody listed (docs/superpowers/specs/2026-10-13-venue-cards-design.md). */
export const WHERE = {
  find: 'FIND ME',
  finding: 'finding where you are…',
  cant: "Can't find you — pick from the list.",
  notHere: 'NOT HERE? ADD IT',
  oneOfThese: 'Is it one of these?',
  make: 'MAKE IT',
  made: 'made here tonight',
  taken: 'someone here already said that.',
  limit: "that's three venues from here tonight — join one.",
  full: 'too many venues tonight — pick one from the list.',
  listed: 'that venue is listed already.',
  bad: "that didn't read right — try fewer words.",
};
```

Run again → PASS.

- [ ] **Step 2: Location** in `app/lib/device.js`:

```js
/** Where the phone is, once, or null: denied, no fix in time, or no GPS. Kept by the caller in memory only. */
export const locate = ({ timeout = 8000 } = {}) => new Promise((resolve) => {
  try {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout, maximumAge: 60_000 },
    );
  } catch { resolve(null); }
});

/** Granted before, so the venue screen may locate without a tap. */
export async function locationGranted() {
  try { return (await navigator.permissions?.query({ name: 'geolocation' }))?.state === 'granted'; } catch { return false; }
}
```

- [ ] **Step 3: The venue screen.** In `Venue` (`app/screens/Onboard.jsx`):
  - New props `here`, `finding`, `onFind`, `onMake`.
  - `const { near, rest } = useMemo(() => byPlace(all, here), [all, here]);` then the rows are `[...near, ...rest]` filtered by the search as today.
  - When `near.length && !sel && !q`, set `sel` to `near[0]` once (a `useEffect` on `near[0]?.room`).
  - Above the search field: `<Cta plain onClick={onFind} disabled={finding}>{finding ? WHERE.finding : WHERE.find}</Cta>` when `!here`.
  - In each row, the right-hand label: `s.away != null ? distanceLabel(s.away) : s.typed ? 'here' : s.made ? WHERE.made : s.doors ? 'doors ' + s.doors : ''`.
  - Replace the `missing` card's USE WHAT I TYPED with `WHERE.notHere`, opening an in-screen form (`making` state): the venue name (prefilled `q`), the act (optional), then (when `near.length`) `WHERE.oneOfThese` and those rows as buttons that `setSel`, then `<Cta onClick={() => onMake(name, act)}>{WHERE.make}</Cta>`.
  - Show NOT HERE? ADD IT also at the end of the list when nothing is selected, not only when a search finds nothing.

- [ ] **Step 4: App wiring** (`app/App.jsx`):
  - State: `const [here, setHere] = useState(null); const [finding, setFinding] = useState(false);` (never stored).
  - `const find = async () => { setFinding(true); const p = await locate(); setFinding(false); if (p) setHere(p); else say(WHERE.cant); };`
  - On entering the `venue` screen: `locationGranted().then((ok) => ok && find())`.
  - `onMake={(name, act) => { const venue = name.trim(); chooseShow({ id: null, room: roomOf(venue), venue, act: act.trim(), setlist: [], typed: true }); setNightState({ makeCard: { venue, ...(act.trim() ? { act: act.trim() } : {}), ...(here ? roundPlace(here) : {}) } }); }}`
  - The first fill, once the room's first view is here: in an effect on `[view]`, `if (view.me && night?.state?.makeCard) { if (!view.card) net.current?.send({ t: 'fill', ...night.state.makeCard }); setNightState({ makeCard: null }); }`
  - The show the phone draws: `const show = showWith(cardOver(listed, view.card), view.times);`
  - Refusals: in the relay message handler, `if (m.t === 'error' && String(m.why).startsWith('fill ')) say(WHERE[m.why.slice(5)] || WHERE.bad);`

- [ ] **Step 5: Build and run the suite**

Run: `npm test`
Expected: PASS. (The screens have no unit tests; Task 6 drives them in a browser.)

- [ ] **Step 6: Commit**

```bash
git add app/lib/device.js app/screens/Onboard.jsx app/App.jsx app/copy.js tests/copy.test.js
git commit -m "Venue cards on the phone: FIND ME, nearest first, and NOT HERE? ADD IT"
```

---

### Task 5: After joining: fill the card, say it is wrong, and the wrong-room banner

**Files:**
- Modify: `app/screens/Home.jsx` (the where line's link; the banner)
- Modify: `app/App.jsx` (the fill sheet; `wrong`; the check on join and on `visibilitychange`; `hereOk`)
- Modify: `app/copy.js` (`WHERE.addAct`, `addTimes`, `wrongHere`, `seeNearby`, `imHere`)
- Test: `tests/copy.test.js`, and Task 6

**Interfaces:**
- Consumes: `wrongRoom`, `wrongLine`, `locate`, `locationGranted`; Task 2's `fill` and `wrong`.
- Produces: night state `hereOk: <room key> | null`; `Home` props `away: number | null`, `onNearby`, `onHere`, `onFill`.

- [ ] **Step 1: The words, test first**

```js
test('venue cards: the after-joining words exist and the banner asks a question', async () => {
  const { WHERE } = await import('../app/copy.js');
  for (const k of ['addAct', 'addTimes', 'wrongHere', 'seeNearby', 'imHere']) assert.ok(WHERE[k], k);
  const { wrongLine } = await import('../app/lib/where.js');
  assert.match(wrongLine(3000, { venue: 'Moth Club, Hackney' }), /\?$/);
});
```

Run → FAIL; add to `WHERE`:

```js
  addAct: 'add the act',
  addTimes: 'add the times',
  wrongHere: "something's wrong here",
  seeNearby: 'SEE NEARBY',
  imHere: "I'M HERE",
```

Run → PASS.

- [ ] **Step 2: The where line.** In `Home`, after `whereLine(show)`: when `show?.made` and `!show.act`, a text button `WHERE.addAct`; else when `show?.made` and none of the five times is set, `WHERE.addTimes`. Both call `onFill`.

- [ ] **Step 3: The fill sheet** (`App.jsx`): `onFill` opens a sheet titled with the venue, with an input for the act (when empty) and five `HH:MM` inputs for the empty times, and a SAVE that sends `{ t: 'fill', ...onlyTheFilledOnes }`. Its rows also hold `WHERE.wrongHere`, which opens a second sheet listing the card's set fields; each row sends `{ t: 'wrong', field }` and says `'thanks — if someone else says so too, it clears.'`.

- [ ] **Step 4: The banner.** In `App.jsx`:

```js
  const [away, setAway] = useState(null);
  const checkHere = useCallback(async () => {
    if (!show || night?.state?.hereOk === show.room || !(await locationGranted())) { setAway(null); return; }
    const p = await locate();
    if (p) setHere(p);
    setAway(p ? wrongRoom(p, show) : null);
  }, [show, night?.state?.hereOk]);
  useEffect(() => { if (night?.me) checkHere(); }, [night?.me, show?.room]);
  useEffect(() => {
    const on = () => document.visibilityState === 'visible' && checkHere();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [checkHere]);
```

Pass `away`, `onNearby={() => go('venue')}` and `onHere={() => { setNightState({ hereOk: show.room }); setAway(null); }}` to `Home`. In `Home`, above the notice: when `away`, a notice-styled block with `wrongLine(away, show)` and the two buttons `WHERE.seeNearby` and `WHERE.imHere`.

- [ ] **Step 5: Build and run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/screens/Home.jsx app/App.jsx app/copy.js tests/copy.test.js
git commit -m "Venue cards: add the act or times, say it is wrong, and the wrong-room banner"
```

---

### Task 6: In a browser, with a faked place; and the docs

**Files:**
- Modify: `docs/how-it-works.md` (the `relay/shows.json` paragraph: lat/lon, and cards)
- Modify: `docs/show-night.md` (a shows file may carry `lat`/`lon`)
- Modify: the scratch CDP driver (`drv.mjs`, outside the repository): a `geo <tab> <lat> <lon>|off` command

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: The driver gets a place.** In the scratch `drv.mjs`, a command that grants geolocation to the tab's origin and fakes it:

```js
else if (cmd === 'geo') {
  const origin = (await evaluate(p, 'location.origin'));
  const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const b = await connect(v.webSocketDebuggerUrl);
  await b.send('Browser.grantPermissions', { origin, permissions: ['geolocation'] });
  b.close();
  if (rest[0] === 'off') await p.send('Emulation.clearGeolocationOverride', {});
  else await p.send('Emulation.setGeolocationOverride', { latitude: Number(rest[0]), longitude: Number(rest[1]), accuracy: 30 });
  out = 'geo ' + rest.join(' ');
}
```

- [ ] **Step 2: Run the night.** `npm run build`, a relay on a spare port with `SHOWS` pointing at a copy of `relay/shows.json` with Moth Club's times moved to now, headless Chrome as in the 12 Oct test. Check, reading page text:
  1. Phone A at the Moth Club door (`geo pA 51.5453 -0.0560`): the venue screen lists Moth Club first with a distance, chosen already; THAT'S THE ONE joins.
  2. Phone B 3 km away (`geo pB 51.5300 -0.0960`), joins Moth Club: the home banner says `You're … from Moth Club. Wrong place?`; I'M HERE hides it and it stays hidden after `visibilitychange`; SEE NEARBY goes to the venue screen.
  3. Phone C at a new place (`geo pC 51.5319 -0.1104`): NOT HERE? ADD IT, "The Lexington", MAKE IT; its home line reads `The Lexington` with `add the act`.
  4. Phone D next door (`geo pD 51.5321 -0.1101`): the venue screen lists The Lexington first, `made here tonight` or its distance; joining it shows the same card. D adds the act; C sees it. C tries another act: `someone here already said that.`
  5. Two phones say the act is wrong: it clears, and `add the act` comes back.
  6. Phone E with location denied (no `geo` call, `Browser.resetPermissions`): today's list, no banner, no error.
  7. Restart the relay on its night file: The Lexington is still listed.

Every check above is read off the page, not assumed. Anything that fails is fixed test first in the task that owns it, then this run is repeated.

- [ ] **Step 3: The docs.** In `docs/how-it-works.md`, after "A venue nobody listed still gets a room, named by what was typed…", add: "The people in such a room can say what it is: the venue's name, the act and the times, first in wins, and two people saying a field is wrong clear it. A phone lists tonight's rooms nearest first, working out the distance itself; its own place leaves it only rounded to about 100 m, as the place of a room it makes. A shows file may give a show `lat` and `lon`." In `docs/show-night.md`, where the shows file's fields are described, add that `lat`/`lon` are optional numbers and put the show first for phones nearby.

- [ ] **Step 4: Full suite, commit, push**

Run: `npm test`
Expected: PASS.

```bash
git add docs/how-it-works.md docs/show-night.md
git commit -m "Docs: venue cards, and lat/lon in a shows file"
git push origin main
```
