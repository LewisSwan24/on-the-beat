# Staff page security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the seven findings of the staff page review: a sign-in belongs to the passcode entry it was made under, an IPv6 attacker gets one allowance for a whole /64 and cannot queue passcode checks, one person or network cannot flood a venue's reports, every response carries security headers with a full policy on the staff page, and only this site's pages and the wristband may open the socket.

**Architecture:** Three small pure modules in `relay/` (`address.js`, `limits.js`, `origin.js`) and one in `app/lib/` (`refusals.js`), each with a test file of its own. `relay/staff.js` gains `entryPrint`; `relay/server.js` wires them in; `relay/room.js` changes what a full report log drops; `scripts/staff-code.mjs` asks for twelve characters, or makes a passcode on Enter. Nothing new at runtime: no dependency, no file, no setting.

**Tech Stack:** Node 24 (`node:crypto`, `node:net`, `node:test`), `ws`, React 19 + Vite 8.

**Spec:** `docs/superpowers/specs/2026-09-29-staff-security-design.md` (approved 29 Sep 2026, 03a2fc4). Where this plan departs from it, "Amended while planning" at the end of the plan says so, and Task 8 writes the same into the spec.

## Global Constraints

- Talk to the owner in Chinese; code, comments, commits, README and test names are English. No pronoun for the owner in an artefact: say "the owner".
- **Dependencies.** No new one.
- **Test passcodes only:** `test-passcode-1` and `test-passcode-2` in tests, `browser-test-passcode` in browser checks. Never the owner's passcode, and never ask for it.
- **A sign-in's entry.** A token record is `{ key, night, entry, push? }`. `entry` is `entryPrint(<the venue's entry>)`: the first 32 hex digits of the SHA-256 of `'staff-entry|' + entry`. At a restart a record whose `entry` is missing or is not its venue's current print is not carried on, and its subscription goes with it. The log line for them is exactly `night: N staff sign-ins ended: their venue's passcode changed`, printed only when N is more than 0.
- **Address.** `addressKey`: an IPv6 address is its /64 written `g1:g2:g3:g4::/64` (lower-case, no leading zeros, zone dropped); an IPv4-mapped IPv6 address is the IPv4 address; anything else is unchanged. Every per-address count uses it.
- **Passcode checks.** At most `CHECKS_AT_ONCE = 8` run at once. A ninth attempt is answered `{ok:false, why:'too many tries'}` before anything is counted.
- **Passcodes made by the script.** `CODE_MIN = 12`; Enter at the passcode prompt makes one: three groups of four from `abcdefghjkmnpqrstuvwxyz23456789`, joined by `-`, drawn with `crypto.randomInt`, written once to stderr as `Passcode (made for you, shown once, kept nowhere): <passcode>`. Never on stdout.
- **Reports.** 10 an hour a person (`<venue key>|<person id>`), 60 an hour a network (`ws.addr`); every report sent counts, refused ones too. Past either: `{t:'error', why:'report refused'}`, nothing logged, no list pushed. A full log (1,000) drops the oldest handled report, and the oldest of the rest only when none is handled. A staff tag is `P-` and six upper-case hex digits. The `REPORT` log line replaces every `\p{Cc}`, `\p{Cf}`, `\p{Zl}` and `\p{Zp}` character of the venue key with `?`.
- **Headers.** Every response: `Referrer-Policy: no-referrer`, and `Strict-Transport-Security: max-age=31536000` when the first value of `x-forwarded-proto` is `https`. Every HTML page: `X-Frame-Options: DENY` and a policy that at least holds `frame-ancestors 'none'`. The staff page (the served file is `staff.html`) carries the full policy of Task 6, verbatim.
- **Origin.** A handshake is allowed with no `Origin`, with `file://`, with an `http:` or `https:` origin whose host is the request's own `Host`, or with an `http:` or `https:` origin whose hostname is `localhost`, `127.0.0.1` or `[::1]` on any port. Anything else, `null` included, is 403 before a socket exists.
- **Git.** Commit at the end of each task; push to `main` only after the full `npm test` is green (Task 8). Never `cimi2232/DECO3500`. End every commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Running tests.** From the repo root, one file: `node --test tests/<file>`. `npm test` builds first and takes about 75 s. Edit calls on one file go one at a time, never in parallel; write code with backslashes with Write or Edit, never a shell heredoc.
- **Characters the invisible-character hook would drop or fold** (U+202E, U+2028, U+200B, NBSP and the like) are written in test code as `String.fromCodePoint(0x202e)`, never as a backslash-u escape in text sent to Write or Edit: it arrives as the character, and the hook removes some of them. Check a file that has any with `node -e` for non-ASCII characters.

## File Structure

| File | Change |
|---|---|
| `relay/staff.js` | `entryPrint`, `madeCode` |
| `relay/address.js` (new) | `addressKey` |
| `relay/limits.js` (new) | `rolling` |
| `relay/origin.js` (new) | `originAllowed` |
| `relay/server.js` | token record and restore; `addressOf`; the concurrent-check cap and `staffCheck`; report limits; the tag; the `REPORT` line; headers; `verifyClient` |
| `relay/room.js` | what a full report log drops |
| `scripts/staff-code.mjs` | twelve characters; Enter makes one |
| `app/lib/refusals.js` (new) | the words for the relay's refusals |
| `app/App.jsx` | uses it |
| `app/staff/list.js`, `app/staff.html` | reworded `expired`; a preconnect only if Chrome says so |
| `tests/` | `address`, `limits`, `origin`, `refusals` (new); `staff`, `restart`, `staff-push`, `staff-code`, `staff-page`, `room`, `server` (extended) |
| `README.md`, the staff reports spec, `CLAUDE.md`, memory | Task 8 and 9 |

---

### Task 1: A sign-in belongs to the passcode entry it was made under

**Files:**
- Modify: `relay/staff.js`, `relay/server.js`, `app/staff/list.js`
- Test: `tests/staff-code.test.js`, `tests/restart.test.js`, `tests/staff-push.test.js`, `tests/staff-page.test.js`

**Interfaces:**
- Produces: `entryPrint(entry: string): string` from `relay/staff.js`, 32 lower-case hex digits. Token records `{ key, night, entry, push? }` in the relay's `tokens` map and the night file.

- [ ] **Step 1: Write the failing tests**

`tests/staff-code.test.js`: change the import line to `import { checkCode, entryPrint, isEntry, makeEntry } from '../relay/staff.js';` and add after the `makeEntry` test:

```js
test('an entry\'s print is 32 hex digits of the whole entry: the same for the same entry, another for a new salt', async () => {
  const entry = await makeEntry('test-passcode-1');
  const print = entryPrint(entry);
  assert.match(print, /^[a-f0-9]{32}$/);
  assert.equal(entryPrint(entry), print);
  assert.notEqual(entryPrint(await makeEntry('test-passcode-1')), print, 'the same passcode with a new salt is a new entry');
});
```

`tests/restart.test.js`: in `night()`, add `codes: CODES` to the record and use it:

```js
  const n = { clock: { t: NINE_PM }, file: file ?? join(dir, 'night-' + (files += 1) + '.json'), relay: null, open: false, codes: CODES };
```
```js
      port: 0, host: '127.0.0.1', root, clock: () => n.clock.t, nightTz: TZ, staffCodes: n.codes,
```
and add `n.codes` to the doc comment above `night()`: "`n.codes` is STAFF_CODES, which a test may change between a stop and a start."

Add these three tests after `'a staff token from before a restart signs in after it, to the same reports, marks and tags'`:

```js
test('a staff sign-in ends at a restart when its venue\'s passcode entry changed, the same passcode set again included, and the log counts them', async () => {
  const n = night();
  await n.start();
  const s = await staffOn(n);
  const { token } = await s.signIn({ venue: 'restart-staff', code: 'test-passcode-1' });
  const same = await logged(() => n.restart());
  assert.ok(same.some((l) => /, 1 staff sign-ins$/.test(l)), same.join('\n'));
  assert.equal(same.some((l) => /ended/.test(l)), false, 'nothing ends under the same entry');
  assert.equal((await (await staffOn(n)).signIn({ venue: 'restart-staff', token })).ok, true, 'still signed in under the same entry');
  await n.stop();
  n.codes = JSON.stringify({ 'restart-staff': await makeEntry('test-passcode-1') });   // the same passcode, with a salt of its own
  n.clock.t += 30_000;
  const said = await logged(() => n.start());
  assert.ok(said.includes("night: 1 staff sign-ins ended: their venue's passcode changed"), said.join('\n'));
  assert.ok(said.some((l) => /, 0 staff sign-ins$/.test(l)), 'the line for what was carried on counts only what was kept');
  const again = await staffOn(n);
  assert.equal((await again.signIn({ venue: 'restart-staff', token })).why, 'expired');
  assert.equal((await again.signIn({ venue: 'restart-staff', code: 'test-passcode-1' })).ok, true, 'the passcode itself still opens');
});

test('a sign-in in the night file with no entry recorded, as an older build wrote it, is not carried on', async () => {
  const n = night();
  await n.start();
  const s = await staffOn(n);
  const { token } = await s.signIn({ venue: 'restart-staff', code: 'test-passcode-1' });
  await n.stop();
  const saved = n.saved();
  assert.match(saved.tokens[0][1].entry, /^[a-f0-9]{32}$/, 'a sign-in records its entry now');
  delete saved.tokens[0][1].entry;
  writeFileSync(n.file, JSON.stringify(saved));
  n.clock.t += 30_000;
  const said = await logged(() => n.start());
  assert.ok(said.includes("night: 1 staff sign-ins ended: their venue's passcode changed"), said.join('\n'));
  assert.equal((await (await staffOn(n)).signIn({ venue: 'restart-staff', token })).why, 'expired');
});

test('a venue whose staff page is gone from STAFF_CODES has its sign-ins ended at a restart', async () => {
  const n = night();
  await n.start();
  const { token } = await (await staffOn(n)).signIn({ venue: 'restart-staff', code: 'test-passcode-1' });
  await n.stop();
  n.codes = '{}';
  n.clock.t += 30_000;
  const said = await logged(() => n.start());
  assert.ok(said.includes("night: 1 staff sign-ins ended: their venue's passcode changed"), said.join('\n'));
  assert.equal((await (await staffOn(n)).signIn({ venue: 'restart-staff', token })).why, 'expired');
});
```

In the existing test `'the night file holds no staff token'` add, after the `tokens.length` assertion:

```js
  assert.match(JSON.parse(text).tokens[0][1].entry, /^[a-f0-9]{32}$/, 'it records which passcode entry the sign-in was made under');
  assert.equal(text.includes('scrypt$'), false, 'a print of the entry, never the entry, its salt or its hash');
```

`tests/staff-push.test.js`: let `start()` take `codes` and use it.

```js
async function start({ nightFile, pushKeysFile, codes } = {}) {
  const x = { clock: { t: EIGHT_PM }, open: false, codes: codes ?? CODES };
```
```js
      port: 0, host: '127.0.0.1', root, clock: () => x.clock.t, nightTz: TZ, staffCodes: x.codes,
```
Add after the `'a subscription and the keys carry across a restart...'` test:

```js
test('a sign-in that ends at a restart because its venue\'s passcode changed takes its subscription with it', async () => {
  files += 1;
  const x = await start({ nightFile: join(base, 'night-' + files + '.json'), pushKeysFile: join(base, 'keys-' + files + '.json') });
  const { who } = await notified(x);
  assert.deepEqual(x.relay.pushedTo(VENUE), [who.sub.endpoint]);
  await x.stop();
  x.codes = JSON.stringify({ [VENUE]: await makeEntry('test-passcode-1'), 'push-other': await makeEntry('test-passcode-2') });
  x.clock.t += 30_000;
  await x.start();
  assert.deepEqual(x.relay.pushedTo(VENUE), [], 'no device is held for the old sign-in');
  await report(x);
  await pause(WINDOW + 300);
  assert.equal(to(who).length, 0, 'and nothing is sent to it');
});
```

`tests/staff-page.test.js`, after the `REFUSED` assertions (line 47-48):

```js
  assert.match(REFUSED.expired, /new night, or the passcode was changed/);
  assert.doesNotMatch(REFUSED.expired, /restarted/, 'a restart no longer signs anyone out');
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/staff-code.test.js tests/restart.test.js tests/staff-push.test.js tests/staff-page.test.js`
Expected: FAIL. `entryPrint` is not exported (the whole `staff-code` file fails to import), the restart tests see sign-ins carried on, and the wording assertion fails.

- [ ] **Step 3: Implement**

`relay/staff.js`: change the import and add, after `isEntry`:

```js
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
```
```js
/**
 * A print of a whole entry, its salt and its hash, for the night file: a sign-in made under one entry does not
 * survive another, not even the same passcode set again (docs/superpowers/specs/2026-09-29-staff-security-design.md
 * §1). It can be worked out only by someone who already holds the entry, a secret of the deployment.
 */
export const entryPrint = (entry) => createHash('sha256').update('staff-entry|' + entry).digest('hex').slice(0, 32);
```

`relay/server.js`, one Edit at a time:

1. Import: `import { checkCode, entryPrint, isEntry } from './staff.js';`
2. After `const staffEntries = readStaffCodes(staffCodes);` add:

```js
  // A venue's passcode entry as a sign-in records it, or null when the venue has no staff page
  // (docs/superpowers/specs/2026-09-29-staff-security-design.md §1).
  const printOf = (key) => (staffEntries.has(key) ? entryPrint(staffEntries.get(key)) : null);
```
3. Replace the comment above `const tokens = new Map();` with:

```js
  // Staff signed in with a right passcode tonight: a token's hash -> { key, night, entry, push? }. Good until the
  // venue's 06:00, and only while the venue's passcode entry is the one it was made under: `entry` is its print
  // (§1), and STAFF_CODES is read once, at start, so nothing in memory is under another.
```
4. In `staffIn`: `tokens.set(tokenHashOf(token), { key, night });` becomes `tokens.set(tokenHashOf(token), { key, night, entry: printOf(key) });`
5. Replace `tokenFrom`:

```js
  /**
   * A sign-in from the night file, or null when it was not made under its venue's passcode entry as it is now, or
   * records none (§1). A subscription that fails §3's checks now is left behind; the sign-in stays.
   */
  function tokenFrom({ key, night, entry, push }) {
    if (typeof entry !== 'string' || entry !== printOf(key)) return null;
    const sub = push && subscriptionOf({ endpoint: push.endpoint, keys: { p256dh: push.p256dh, auth: push.auth } }, pushAllowed);
    return sub ? { key, night, entry, push: { ...sub, at: Number(push.at) || 0 } } : { key, night, entry };
  }
```
6. In `restoreNight`: declare the count and filter, and log it.

```js
    let built;
    let ended = 0;   // sign-ins made under another entry than their venue's now, or under none on record (§1)
```
```js
        tokens: new Map(saved.tokens.flatMap(([hash, t]) => {
          const kept = tokenFrom(t);
          if (!kept) ended += 1;
          return kept ? [[hash, kept]] : [];
        })),
```
and after the `carried on` log:

```js
    // Counts only, as the line above: which venue's passcode changed is for whoever changed it to know.
    if (ended) console.log('night: ' + ended + " staff sign-ins ended: their venue's passcode changed");
```

`app/staff/list.js` line 9:

```js
  expired: 'Signed out: it is a new night, or the passcode was changed. Enter the passcode again.',
```

- [ ] **Step 4: Run them and watch them pass**

Run: `node --test tests/staff-code.test.js tests/restart.test.js tests/staff-push.test.js tests/staff-page.test.js`
Expected: PASS, all of them (on Windows the two `NO_SIGINT` tests skip).

- [ ] **Step 5: Commit**

```bash
git add relay/staff.js relay/server.js app/staff/list.js tests/staff-code.test.js tests/restart.test.js tests/staff-push.test.js tests/staff-page.test.js
git commit -m "A staff sign-in belongs to the passcode entry it was made under

A token record carries a print of its venue's entry. At a restart a sign-in
whose entry changed, is missing, or whose venue has no staff page now, is not
carried on, and its subscription goes with it. The log counts them.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: An IPv6 network is one address, and passcode checks cannot queue

**Files:**
- Create: `relay/address.js`, `tests/address.test.js`
- Modify: `relay/server.js`
- Test: `tests/staff.test.js`

**Interfaces:**
- Produces: `addressKey(address): string` from `relay/address.js`. `createRelay({ staffCheck })`, for tests: replaces `checkCode`.

- [ ] **Step 1: Write the failing tests**

`tests/address.test.js`:

```js
// ON THE BEAT — the network an address counts as, for the per-address limits
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressKey } from '../relay/address.js';

test('an IPv6 address counts as its /64, however it is written', () => {
  for (const same of ['2001:db8:1:2:3:4:5:6', '2001:DB8:0001:0002::7', '2001:db8:1:2:ffff:ffff:ffff:ffff', '2001:db8:1:2::']) {
    assert.equal(addressKey(same), '2001:db8:1:2::/64', same);
  }
  assert.notEqual(addressKey('2001:db8:1:3::1'), addressKey('2001:db8:1:2::1'), 'another /64 is another network');
  assert.equal(addressKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(addressKey('::1'), '0:0:0:0::/64');
  assert.equal(addressKey('fe80::1%eth0'), 'fe80:0:0:0::/64', 'a zone is not part of the network');
});

test('an IPv4-mapped IPv6 address is the IPv4 address it wraps, and an IPv4 address is itself', () => {
  assert.equal(addressKey('::ffff:203.0.113.5'), '203.0.113.5');
  assert.equal(addressKey('::FFFF:cb00:7105'), '203.0.113.5');
  assert.equal(addressKey('203.0.113.5'), '203.0.113.5');
});

test('anything that is not an address is left as it is, and nothing throws', () => {
  for (const x of ['', 'not-an-address', '1.2.3', '2001:db8::zz', '[::1]', undefined, null]) assert.equal(addressKey(x), String(x ?? ''), String(x));
});
```

`tests/staff.test.js`: import `checkCode` too (`import { checkCode, makeEntry } from '../relay/staff.js';`), let `start()` take `staffCheck`:

```js
async function start({ staffCheck } = {}) {
  const clock = { t: EIGHT_PM };
  const relay = await createRelay({ port: 0, host: '127.0.0.1', root, clock: () => clock.t, nightTz: TZ, staffCodes: CODES, ...(staffCheck ? { staffCheck } : {}) });
```
add a file-level poll helper after `const running = [];`:

```js
/** Polls until `pred()` holds, or fails after `ms`. */
async function until(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out');
    await pause(20);
  }
}
```
and add after `'a wrong passcode is refused and counted...'`:

```js
test('an IPv6 attacker has one allowance for a whole /64, not one an address', async () => {
  const { staff } = await start();
  for (const ip of ['2001:db8:1:2::1', '2001:db8:1:2:a::2', '2001:db8:1:2:b::3', '2001:db8:1:2:c::4']) {
    const s = await staff({ ip });
    for (let i = 0; i < 5; i += 1) assert.equal((await s.signIn({ venue: 'staff-venue', code: 'wrong ' + i })).why, 'wrong code');
  }
  const same = await staff({ ip: '2001:db8:1:2:dead:beef::5' });
  assert.equal((await same.signIn({ venue: 'staff-venue', code: 'test-passcode-1' })).why, 'too many tries', 'the fifth address in the /64 has none of its own');
  const apart = await staff({ ip: '2001:db8:1:3::1' });
  assert.equal((await apart.signIn({ venue: 'staff-venue', code: 'test-passcode-1' })).ok, true, 'another /64 is not held back');
});

test('at most eight passcode checks run at once: a ninth is refused unheard and does not spend its tries', async () => {
  const held = [];
  let open = true;
  const staffCheck = (entry, code) => (open ? new Promise((resolve) => held.push(() => resolve(checkCode(entry, code)))) : checkCode(entry, code));
  const { staff } = await start({ staffCheck });
  const busy = [];
  for (let i = 0; i < 8; i += 1) {
    const s = await staff();
    s.send({ t: 'staff', venue: 'staff-venue', code: 'test-passcode-1' });
    busy.push(s);
  }
  await until(() => held.length === 8);
  const ninth = await staff();
  assert.deepEqual(await ninth.signIn({ venue: 'staff-venue', code: 'test-passcode-1' }), { t: 'staff', ok: false, why: 'too many tries' });
  open = false;
  held.splice(0).forEach((go) => go());
  for (const s of busy) await s.until(() => s.answers.length === 1);
  assert.equal(busy.every((s) => s.answers[0].ok), true, 'the eight were checked as usual');
  for (let i = 0; i < 5; i += 1) assert.equal((await ninth.signIn({ venue: 'staff-venue', code: 'wrong ' + i })).why, 'wrong code', 'its own five tries are all still there: ' + i);
  assert.equal((await ninth.signIn({ venue: 'staff-venue', code: 'test-passcode-1' })).why, 'too many tries', 'the sixth is over its own five');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/address.test.js tests/staff.test.js`
Expected: `address.test.js` FAILS to import; in `staff.test.js` the /64 test fails (the fifth address answers `ok`) and the cap test times out (`staffCheck` is ignored, so no check is held).

- [ ] **Step 3: Implement**

`relay/address.js`:

```js
// ON THE BEAT — the network an address counts as, for the per-address limits
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §2).
//
// An IPv6 network is handed out as a /64 at least, so whoever is on one holds 2^64 addresses and would get a fresh
// allowance for each. Its /64 is what is counted. An IPv4-mapped IPv6 address is the IPv4 address it wraps.

import { isIPv4, isIPv6 } from 'node:net';

/** The eight 16-bit groups of an IPv6 address in the compressed form a URL hostname has. */
function groupsOf(compressed) {
  const [head, tail] = compressed.split('::');
  const front = head ? head.split(':') : [];
  const back = tail ? tail.split(':') : [];
  return [...front, ...new Array(8 - front.length - back.length).fill('0'), ...back].map((g) => parseInt(g, 16));
}

/** What `address` counts as: its /64 (`2001:db8:1:2::/64`), the IPv4 address a mapped one wraps, or itself. */
export function addressKey(address) {
  const text = String(address ?? '');
  const bare = text.split('%')[0];   // a zone is not part of the network
  if (isIPv4(bare) || !isIPv6(bare)) return text;
  // A URL writes an address in one canonical form, the embedded IPv4 tail of a mapped address as two hex groups.
  const g = groupsOf(new URL('http://[' + bare + ']/').hostname.slice(1, -1));
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
  return g.slice(0, 4).map((x) => x.toString(16)).join(':') + '::/64';
}
```

`relay/server.js`:

1. Import `import { addressKey } from './address.js';` (after the `night.js` import).
2. Constant near `CODE_MAX`: `const CHECKS_AT_ONCE = 8;             // passcode checks running at once: libuv's pool has four threads, so a queue is only ever a guesser's`
3. Options: add `staffCheck = checkCode` to the `createRelay` destructure (after `pushEveryMs = PUSH_EVERY_MS`) and to its doc comment: "`staffCheck` is for tests: what checks a passcode against its entry, in place of relay/staff.js's checkCode."
4. `let checking = 0;   // passcode checks running now (§2)` after `const tokens = new Map();`.
5. `addressOf`:

```js
  function addressOf(req) {
    const a = req.socket.remoteAddress || '';
    const named = clientIpHeader ? req.headers[clientIpHeader] : undefined;
    if (named) return addressKey(String(named).slice(0, 64));
    const cf = req.headers['cf-connecting-ip'];
    return addressKey(cf && (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1') ? String(cf).slice(0, 64) : a);
  }
```
with `IPv6 as its /64 (relay/address.js)` added to its doc comment.
6. In `staffIn`, replace the passcode part from `if (tooMany(ws)) ...` to `ws.staffing = false;`:

```js
    if (tooMany(ws)) { answer({ ok: false, why: 'too many tries' }); return; }
    // Busy: four threads run the checks, and a queue behind them only helps whoever is guessing. It is the relay
    // that is full, so it is not counted against this socket or this address (§2).
    if (checking >= CHECKS_AT_ONCE) { answer({ ok: false, why: 'too many tries' }); return; }
    attempt(ws);   // every sign-in by passcode counts, right or wrong, on the pairing counters
    const entry = staffEntries.get(key);
    if (!entry) { answer({ ok: false, why: 'no staff page' }); return; }
    ws.staffing = true;
    checking += 1;
    let right;
    try {
      right = await staffCheck(entry, m.code.slice(0, CODE_MAX));
    } finally {
      checking -= 1;
      ws.staffing = false;
    }
```

- [ ] **Step 4: Run them and watch them pass**

Run: `node --test tests/address.test.js tests/staff.test.js tests/server.test.js`
Expected: PASS. (`server.test.js` holds the pairing-limit tests that now go through `addressKey`.)

- [ ] **Step 5: Commit**

```bash
git add relay/address.js relay/server.js tests/address.test.js tests/staff.test.js
git commit -m "An IPv6 network counts as its /64, and passcode checks are capped at eight at once

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A passcode is at least twelve characters, or made for you

**Files:**
- Modify: `relay/staff.js`, `scripts/staff-code.mjs`
- Test: `tests/staff-code.test.js`

**Interfaces:**
- Produces: `madeCode(): string` from `relay/staff.js`, three groups of four from the 31 characters, joined by `-`.

- [ ] **Step 1: Write the failing tests**

In `tests/staff-code.test.js` change the import to `import { checkCode, entryPrint, isEntry, madeCode, makeEntry } from '../relay/staff.js';`. Append the tests below, and add `'roundhouse-bruno-mars\n'` (the input ends at the passcode question) to the `inputs` array of the existing test `'two passcodes that differ, one too short, or no venue make nothing'`:

```js
test('a made passcode is three groups of four from 31 characters with no i, l, o, 0 or 1, and every one of them turns up', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) {
    const code = madeCode();
    assert.match(code, /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
    for (const c of code.replaceAll('-', '')) seen.add(c);
  }
  assert.equal(seen.size, 31, 'all thirty-one characters are drawn');
});

test('a typed passcode needs twelve characters: eleven make nothing, twelve make an entry', async () => {
  const eleven = await run('roundhouse-bruno-mars\neleven-char\neleven-char\n');
  assert.deepEqual([eleven.code, eleven.out], [1, '']);
  assert.match(eleven.err, /at least 12 characters, or press Enter/);
  const twelve = await run('roundhouse-bruno-mars\ntwelve-chars\ntwelve-chars\n');
  assert.equal(twelve.code, 0, twelve.err);
});

test('Enter at the passcode makes one: shown once on stderr, never on stdout, and it opens the entry', async () => {
  const { out, err, code } = await run('roundhouse-bruno-mars\n\n');
  assert.equal(code, 0, err);
  const made = /kept nowhere\): (\S+)/.exec(err)?.[1];
  assert.match(made, /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
  assert.equal(out.split('\n').filter(Boolean).length, 1, 'one line on stdout');
  assert.equal(out.includes(made), false, 'not on stdout');
  assert.equal(err.split(made).length - 1, 1, 'shown once');
  assert.equal(err.includes('The same passcode again'), false, 'there is nothing to confirm');
  const [[, entry]] = Object.entries(JSON.parse('{' + out + '}'));
  assert.equal(await checkCode(entry, made), true);
  const again = await run('roundhouse-bruno-mars\n\n');
  assert.notEqual(/kept nowhere\): (\S+)/.exec(again.err)?.[1], made, 'a new one each time');
});

test('at a terminal, Enter at the passcode makes one too', async () => {
  const { out, err, code } = await typed(['roundhouse-bruno-mars', '']);
  assert.equal(code, 0, err);
  const made = /kept nowhere\): (\S+)/.exec(err)?.[1];
  const [[, entry]] = Object.entries(JSON.parse('{' + out + '}'));
  assert.equal(await checkCode(entry, made), true);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/staff-code.test.js`
Expected: FAIL. Eleven characters are taken today (the minimum is 8) and Enter reads as a passcode too short.

- [ ] **Step 3: Implement**

`scripts/staff-code.mjs`, one Edit at a time. Header comment (replace lines 6-9):

```js
// Asks for the venue's show id and a passcode of at least twelve characters, twice; or Enter, for one made for
// you (docs/superpowers/specs/2026-09-29-staff-security-design.md §2): three groups of four, shown once on stderr
// and kept nowhere. A passcode typed is never shown, not as it is typed and not in what is printed. stdout gets
// one line, `"<venue>": "scrypt$..."`; the questions go to stderr. Put each venue's line between STAFF_CODES's
// braces and set it on the relay (README, "The staff page"). The relay restarts when the secret is set, and
// every sign-in made under a venue's old passcode ends with it.
```
`relay/staff.js` gets the passcode maker, so the alphabet is a thing a test can call, and the script imports it. Change its `node:crypto` import to `import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';` and add after `entryPrint`:

```js
// No i, l, o, 0 or 1: they read wrongly aloud and off a phone. 31 characters, twelve of them: about 59 bits.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A passcode made for you (npm run staff-code): three groups of four from ALPHABET, joined by dashes. */
export const madeCode = () => [0, 1, 2].map(() => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')).join('-');
```
In the script, `import { madeCode, makeEntry } from '../relay/staff.js';` replaces the `makeEntry` import, and:

```js
const CODE_MIN = 12;
```
`ask` returns `null` when the input has ended, so Enter (an empty line) and no input are told apart:

```js
async function ask(question, secret = false) {
  process.stderr.write(question);
  hidden = secret;
  const { value = '', done } = await lines.next();
  hidden = false;
  if (secret) process.stderr.write('\n');
  return done ? null : value;   // null: the input ended, nobody pressed Enter
}
```
and `main`:

```js
async function main() {
  const venue = venueKey((await ask('Venue (its show id, as in relay/shows.json): ')) ?? '');
  if (!venue) return fail('No venue given.');
  const shows = loadShows(fileURLToPath(new URL('../relay/shows.json', import.meta.url)));
  if (!shows.some((s) => s.id === venue)) {
    process.stderr.write('Note: ' + venue + ' is not in relay/shows.json, so the staff page will not list it.\n');
  }
  const typed = await ask('Passcode (at least ' + CODE_MIN + ' characters, not shown; Enter for one made for you): ', true);
  if (typed === null) return fail('No passcode given.');
  let code = typed;
  if (typed === '') {
    code = madeCode();
    process.stderr.write('Passcode (made for you, shown once, kept nowhere): ' + code + '\n');
  } else {
    if ([...code].length < CODE_MIN) return fail('A passcode needs at least ' + CODE_MIN + ' characters, or press Enter for one made for you.');
    if ((await ask('The same passcode again: ', true)) !== code) return fail('The two passcodes differ.');
  }
  rl.close();
  process.stdout.write(JSON.stringify(venue) + ': ' + JSON.stringify(await makeEntry(code)) + '\n');
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `node --test tests/staff-code.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add relay/staff.js scripts/staff-code.mjs tests/staff-code.test.js
git commit -m "npm run staff-code wants twelve characters, and Enter makes a passcode

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4: One person or network cannot flood a venue's reports

**Files:**
- Create: `relay/limits.js`, `tests/limits.test.js`, `app/lib/refusals.js`, `tests/refusals.test.js`
- Modify: `relay/server.js`, `relay/room.js`, `app/App.jsx`
- Test: `tests/staff.test.js`, `tests/room.test.js`

**Interfaces:**
- Produces: `rolling({ ms, max })` from `relay/limits.js`, returning `{ take(key, at): boolean, prune(at): void, size(): number, held(key): number }`; `refusalWords(m): string | null` from `app/lib/refusals.js`; the relay's `{t:'error', why:'report refused'}`.

- [ ] **Step 1: Write the failing tests**

`tests/limits.test.js`:

```js
// ON THE BEAT — counting how often something happened, over a sliding window
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rolling } from '../relay/limits.js';

const HOUR = 3_600_000;

test('a key is let through up to its limit in the window, then refused, and each key has its own count', () => {
  const r = rolling({ ms: HOUR, max: 3 });
  assert.deepEqual([0, 1, 2, 3, 4].map((t) => r.take('ana', t)), [true, true, true, false, false]);
  assert.equal(r.take('ben', 5), true);
});

test('the window slides: a time is forgotten an hour after it, not before', () => {
  const r = rolling({ ms: HOUR, max: 2 });
  r.take('ana', 0);
  r.take('ana', 1000);
  assert.equal(r.take('ana', HOUR - 1), false, 'the first is still inside the window');
  assert.equal(r.take('ana', HOUR + 1000), true, 'an hour after the second, only the refused attempt is left');
});

test('a refused attempt counts too: someone who keeps trying is not let back in, and someone who stops is', () => {
  const r = rolling({ ms: HOUR, max: 2 });
  for (const who of ['patient', 'flooder']) {
    r.take(who, 0);
    r.take(who, 1000);
    assert.equal(r.take(who, 2000), false, who + ' is refused');
  }
  for (const minutes of [20, 40, 59]) assert.equal(r.take('flooder', minutes * 60_000), false);
  assert.equal(r.take('patient', HOUR + 2000), true, 'an hour after the last attempt');
  assert.equal(r.take('flooder', HOUR + 2000), false, 'the flooder tried again 21 minutes ago');
});

test('a key never holds more than max times, however many attempts it makes', () => {
  const r = rolling({ ms: HOUR, max: 3 });
  for (let t = 0; t < 1000; t += 1) r.take('ana', t);
  assert.equal(r.held('ana'), 3);
});

test('prune forgets a key once all its times are older than the window, and keeps one that is not', () => {
  const r = rolling({ ms: HOUR, max: 3 });
  r.take('old', 0);
  r.take('recent', HOUR - 1);
  r.prune(HOUR);
  assert.equal(r.size(), 1);
  assert.deepEqual([r.held('old'), r.held('recent')], [0, 1]);
});
```

`tests/refusals.test.js`:

```js
// ON THE BEAT — what a phone says aloud when the relay refuses something it asked for
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { refusalWords } from '../app/lib/refusals.js';

test('the phone has words for the refusals it speaks, and none for the rest', () => {
  assert.equal(refusalWords({ t: 'error', why: 'clip refused' }), "that didn't go. they may have left, or gone quiet.");
  assert.equal(refusalWords({ t: 'error', why: 'report refused' }), 'too many reports just now. please tell a member of staff.');
  for (const m of [{ t: 'error', why: 'bad join' }, { t: 'error', why: 'constructor' }, { t: 'error', why: '__proto__' },
    { t: 'view' }, { t: 'refused', why: 'report refused' }, null, undefined]) {
    assert.equal(refusalWords(m), null, JSON.stringify(m));
  }
});

test('the app speaks its refusals through that lookup, not one by one', () => {
  const app = readFileSync(new URL('../app/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /refusalWords\(m\)/);
  assert.doesNotMatch(app, /why === 'clip refused'/);
});
```

`tests/room.test.js`, after `'the venue report log has a ceiling: its newest thousand'`:

```js
test('a full report log drops handled reports first, oldest first, and the oldest of the rest only when none is handled', () => {
  const { room } = night();
  for (let i = 0; i < 1000; i += 1) room.report('ana', null, 'report ' + i);
  room.markHandled('r3', true);   // 'report 2'
  room.markHandled('r7', true);   // 'report 6'
  room.report('ana', null, 'one more');
  let kept = room.reports().map((r) => r.why);
  assert.equal(kept.length, 1000);
  assert.deepEqual([kept.includes('report 2'), kept.includes('report 0'), kept.includes('report 6')], [false, true, true], 'the oldest handled one went');
  room.report('ana', null, 'and another');
  kept = room.reports().map((r) => r.why);
  assert.deepEqual([kept.includes('report 6'), kept.includes('report 0')], [false, true], 'then the next handled one');
  room.report('ana', null, 'and one more');
  assert.equal(room.reports()[0].why, 'report 1', 'with none handled, the oldest');
});
```

`tests/staff.test.js`, after the `'the relay\'s log says a report came...'` test:

```js
test('a person may send ten reports an hour: the eleventh is refused, unlogged and unpushed, and an hour later they may again', async () => {
  const { relay, clock, phone, signedIn } = await start();
  const s = await signedIn();
  const ana = await phone('staff-venue');
  for (let i = 0; i < 10; i += 1) ana.send({ t: 'report', why: 'report ' + i });
  await s.until(() => s.list().length === 10);
  const lists = s.lists.length;
  const logged = [];
  const was = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  try {
    ana.send({ t: 'report', why: 'the eleventh' });
    await ana.until((v, p) => p.errors.includes('report refused'));
    await pause(300);   // a list would have been pushed by now
  } finally {
    console.log = was;
  }
  assert.equal(logged.some((l) => l.startsWith('REPORT')), false, 'nothing logged for it');
  assert.equal(s.lists.length, lists, 'no list pushed for it');
  assert.equal(relay.rooms.get('staff-venue').room.reports().length, 10);
  clock.t += 3_600_001;
  ana.send({ t: 'report', why: 'an hour later' });
  await s.until(() => s.list().length === 11);
});

test('a network may send sixty reports an hour over everyone on it: the sixty-first is refused, from whoever sends it', async () => {
  const { relay, phone } = await start();
  const reports = () => relay.rooms.get('staff-venue').room.reports().length;
  const people = [];
  for (let i = 0; i < 7; i += 1) people.push(await phone('staff-venue', { ip: '198.51.100.91' }));
  for (const p of people.slice(0, 6)) for (let i = 0; i < 10; i += 1) p.send({ t: 'report', why: 'x' });
  await until(() => reports() === 60);
  people[6].send({ t: 'report', why: 'the sixty-first' });
  await people[6].until((v, p) => p.errors.includes('report refused'));
  assert.equal(reports(), 60);
  const elsewhere = await phone('staff-venue', { ip: '198.51.100.92' });
  elsewhere.send({ t: 'report', why: 'another network' });
  await until(() => reports() === 61);
});

test('a refused report still counts against its network', async () => {
  const { relay, phone } = await start();
  const reports = () => relay.rooms.get('staff-venue').room.reports().length;
  const ip = '198.51.100.93';
  const flooder = await phone('staff-venue', { ip });
  for (let i = 0; i < 15; i += 1) flooder.send({ t: 'report', why: 'x' });   // ten taken, five refused
  await flooder.until((v, p) => p.errors.length === 5);
  for (let k = 0; k < 5; k += 1) {
    const other = await phone('staff-venue', { ip });
    for (let i = 0; i < 9; i += 1) other.send({ t: 'report', why: 'x' });   // forty-five more: sixty sent in all
  }
  await until(() => reports() === 55);
  const last = await phone('staff-venue', { ip });
  last.send({ t: 'report', why: 'the sixty-first sent' });
  await last.until((v, p) => p.errors.includes('report refused'));
  assert.equal(reports(), 55, 'fifty-five were taken, and sixty were sent');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/limits.test.js tests/refusals.test.js tests/room.test.js tests/staff.test.js`
Expected: `limits` and `refusals` fail to import; the room test fails (`report 2` is still there: the log drops the oldest); the two staff tests time out waiting for `report refused`.

- [ ] **Step 3: Implement**

`relay/limits.js`:

```js
// ON THE BEAT — counting how often something happened, over a sliding window
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §3).

/**
 * How often each key may do something: `max` times in any `ms`. Every attempt is counted, a refused one too, so
 * someone who keeps trying while refused is not let back in until an hour after they stop. A key keeps only its
 * newest `max` times, so a flood cannot make it grow.
 */
export function rolling({ ms, max }) {
  const seen = new Map();   // key -> its newest times, oldest first
  return {
    /** Records an attempt at `at`, and says whether it is within the limit. */
    take(key, at) {
      const list = (seen.get(key) ?? []).filter((t) => at - t < ms);
      const within = list.length < max;
      list.push(at);
      if (list.length > max) list.shift();
      seen.set(key, list);
      return within;
    },
    /** Forgets every key whose times are all older than the window. */
    prune(at) {
      for (const [key, list] of seen) if (list.every((t) => at - t >= ms)) seen.delete(key);
    },
    /** For tests: how many keys are held, and how many times a key holds. */
    size: () => seen.size,
    held: (key) => (seen.get(key) ?? []).length,
  };
}
```

`app/lib/refusals.js`:

```js
// ON THE BEAT — what a phone says aloud when the relay refuses something it asked for
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §3). A refusal not listed is not spoken.

const SAY = {
  'clip refused': "that didn't go. they may have left, or gone quiet.",
  'report refused': 'too many reports just now. please tell a member of staff.',
};

/** The words for a relay refusal (`{t:'error', why}`), or null when the phone says nothing for it. */
export const refusalWords = (m) => (m?.t === 'error' && Object.hasOwn(SAY, m.why) ? SAY[m.why] : null);
```

`app/App.jsx`: add `import { refusalWords } from './lib/refusals.js';` after the `net.js` import, and replace the `clip refused` line in `onRelay.current`:

```js
    const refusal = refusalWords(m);
    if (refusal) say(refusal);
```
The report's own `say('reported. the venue team has it.')` stays: the refusal, when there is one, arrives a moment later and replaces it.

`relay/room.js`, replace `if (reports.length > REPORTS_MAX) reports.splice(0, reports.length - REPORTS_MAX);` in `report()`:

```js
    // Full: a report the team has handled goes first, the oldest of those, and only then the oldest of the rest.
    while (reports.length > REPORTS_MAX) {
      const handled = reports.findIndex((x) => x.handledAt);
      reports.splice(handled === -1 ? 0 : handled, 1);
    }
```
and change its comment on `REPORTS_MAX` to: `// the newest kept a venue, handled ones dropped first, for its staff page (relay/server.js reportsTo())`.

`relay/server.js`:

1. `import { rolling } from './limits.js';` after the `store.js` import.
2. Constants after `CHECKS_AT_ONCE`:

```js
const REPORT_WINDOW_MS = 3_600_000;   // the window reports are counted in
const PERSON_REPORTS = 10;            // reports one person may send in it
const ADDRESS_REPORTS = 60;           // and one network, over everyone on it
```
3. After the `tries` map:

```js
  // Reports sent, by person and by network, over the last hour: a flood must not fill a venue's staff list or keep
  // its devices buzzing (docs/superpowers/specs/2026-09-29-staff-security-design.md §3).
  const reportsBy = rolling({ ms: REPORT_WINDOW_MS, max: PERSON_REPORTS });
  const reportsFrom = rolling({ ms: REPORT_WINDOW_MS, max: ADDRESS_REPORTS });
```
4. In `expire()`, after the `tries` loop:

```js
    reportsBy.prune(at);
    reportsFrom.prune(at);
```
5. `case 'report':` becomes:

```js
      case 'report': {
        // Ten an hour a person and sixty a network. Both count every report sent, so one who keeps sending stays
        // refused; a refused report is neither kept, logged nor pushed.
        const at = now();
        const person = reportsBy.take(r.key + '|' + me, at);
        const network = reportsFrom.take(ws.addr, at);
        if (!person || !network) { ws.send(JSON.stringify({ t: 'error', why: 'report refused' })); break; }
        // To the venue's staff page, with the push below, and to its staff devices' notifications. The log says
        // one came and nothing it says: logs are kept.
        if (room.report(me, m.handle || null, m.why)) {
          console.log('REPORT', r.key, room.reports().at(-1).id);
          alertStaff(r.key);
        }
        break;
      }
```

- [ ] **Step 4: Run and watch them pass**

Run: `node --test tests/limits.test.js tests/refusals.test.js tests/room.test.js tests/staff.test.js tests/staff-push.test.js`
Expected: PASS. If a test elsewhere sends more than ten reports from one phone, it now sees `report refused`: give each report its own phone, as `report()` in `staff-push.test.js` does.

- [ ] **Step 5: Commit**

```bash
git add relay/limits.js relay/server.js relay/room.js app/lib/refusals.js app/App.jsx tests/limits.test.js tests/refusals.test.js tests/room.test.js tests/staff.test.js
git commit -m "Reports are limited to ten an hour a person and sixty a network

A full report log drops handled reports first, and a phone that is refused says
so, in words that live in one place now.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: A staff tag of six digits, and a log line a stranger cannot shape

**Files:**
- Modify: `relay/server.js`, `app/staff/list.js`, `tests/staff-page.test.js`
- Test: `tests/staff.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/staff.test.js`: in `'a report made after sign-in reaches staff within a second...'` change `assert.match(r.about, /^P-[0-9A-F]{4}$/);` to `assert.match(r.about, /^P-[0-9A-F]{6}$/);`, and add after `'the relay\'s log says a report came...'`:

```js
test('the log line for a report replaces control, format and separator characters in the venue name, which a stranger typed', async () => {
  const { phone } = await start();
  const ana = await phone('evil' + String.fromCodePoint(0x1b) + '[31m venue' + String.fromCodePoint(0x202e, 0x2028) + 'x' + String.fromCodePoint(0));
  const logged = [];
  const was = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  try {
    ana.send({ t: 'report', why: 'words' });
    await pause(300);
  } finally {
    console.log = was;
  }
  assert.deepEqual(logged.filter((l) => l.startsWith('REPORT')), ['REPORT evil?[31m venue? x? r1']);
});
```
(`venueKey` has already folded the `U+2028` to a space, so the name reaching the log holds an escape, a right-to-left override and a NUL.)

`tests/staff-page.test.js` and `app/staff/list.js`: the examples say `P-4F2A`; make them the six digits the relay makes now: `P-4F2A91` in `tests/staff-page.test.js` lines 13, 24 and 25 (both the fixture and the two expected strings) and in the doc comment at `app/staff/list.js:20`.

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/staff.test.js`
Expected: FAIL: the tag is four digits, and the log line carries the escape and the override as they are.

- [ ] **Step 3: Implement**

`relay/server.js`:

```js
  const tagOf = (key, id) => 'P-' + createHmac('sha256', staffKey).update(key + '|' + id).digest('hex').slice(0, 6).toUpperCase();
```
Add after `venueKey`:

```js
/** A venue key as a log line may carry it. A stranger typed it, so no control, format or separator character goes through. */
const plain = (text) => String(text).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '?');
```
and `console.log('REPORT', plain(r.key), room.reports().at(-1).id);`.

- [ ] **Step 4: Run and watch them pass**

Run: `node --test tests/staff.test.js tests/staff-page.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add relay/server.js app/staff/list.js tests/staff.test.js tests/staff-page.test.js
git commit -m "A staff tag is six hex digits, and a report's log line drops characters a stranger could shape

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 6: Security headers on every response, a full policy on the staff page

**Files:**
- Modify: `relay/server.js`
- Test: `tests/staff.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/staff.test.js`, in `before()` after the `staff.html` line:

```js
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'app-abc123.js'), 'export {};');
```
and after `'the relay serves the staff page at /staff, and the app everywhere else'`:

```js
test('every response carries the security headers, every page is unframeable, and only the staff page has a full policy', async () => {
  const { relay } = await start();
  const h = async (path, headers) => (await fetch('http://127.0.0.1:' + relay.port + path, { headers })).headers;
  for (const path of ['/', '/staff', '/tonight', '/assets/app-abc123.js', '/api/shows', '/clip/nobody/nothing']) {
    const headers = await h(path);
    assert.equal(headers.get('referrer-policy'), 'no-referrer', path);
    assert.equal(headers.get('x-content-type-options'), 'nosniff', path);
    assert.equal(headers.get('strict-transport-security'), null, path + ' over plain http');
  }
  for (const path of ['/', '/tonight', '/index.html']) {
    const headers = await h(path);
    assert.equal(headers.get('x-frame-options'), 'DENY', path);
    assert.equal(headers.get('content-security-policy'), "frame-ancestors 'none'", path);
  }
  for (const path of ['/staff', '/staff/', '/staff?venue=x', '/staff.html']) {
    const headers = await h(path);
    const policy = headers.get('content-security-policy');
    assert.equal(headers.get('x-frame-options'), 'DENY', path);
    for (const directive of ["default-src 'self'", "script-src 'self'", "connect-src 'self' ws: wss:", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
      assert.ok(policy.split('; ').includes(directive), path + ' lacks ' + directive + ' in ' + policy);
    }
    assert.doesNotMatch(policy, /unsafe-/, 'no inline script or eval is allowed');
  }
  for (const path of ['/assets/app-abc123.js', '/api/shows']) {
    const headers = await h(path);
    assert.deepEqual([headers.get('x-frame-options'), headers.get('content-security-policy')], [null, null], path + ' is not a page');
  }
  assert.equal((await h('/', { 'x-forwarded-proto': 'https' })).get('strict-transport-security'), 'max-age=31536000');
  assert.equal((await h('/', { 'x-forwarded-proto': 'https,http' })).get('strict-transport-security'), 'max-age=31536000');
  assert.equal((await h('/', { 'x-forwarded-proto': 'http' })).get('strict-transport-security'), null);
});

test('a 503 carries them too, when there is no build to serve', async () => {
  const bare = await createRelay({ port: 0, host: '127.0.0.1', root: join(base, 'nowhere'), nightTz: TZ });
  try {
    const res = await fetch('http://127.0.0.1:' + bare.port + '/');
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    await bare.close();
  }
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/staff.test.js`
Expected: FAIL. No response carries `referrer-policy`, and no page a policy.

- [ ] **Step 3: Implement**

`relay/server.js`, after `TYPES`:

```js
// The staff page's policy (docs/superpowers/specs/2026-09-29-staff-security-design.md §4): its own scripts, styles,
// worker, manifest and socket, fonts from Google and nothing else. It can be this tight because the page has no
// inline script or style. `ws:` and `wss:` are named beside 'self' because some browsers do not count a WebSocket
// to the page's own host as 'self'.
const STAFF_POLICY = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com', "img-src 'self' data:", "connect-src 'self' ws: wss:", "worker-src 'self'",
  "manifest-src 'self'", "base-uri 'none'", "object-src 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');
const NO_FRAMES = "frame-ancestors 'none'";
```
In `serveStatic`, replace the `res.writeHead(200, {...}).end(readFileSync(file));` block:

```js
    const hashed = /[/\\]assets[/\\]/.test(file);
    // A page nobody may frame, and the staff page under its full policy, chosen by the file that is served (§4).
    const page = extname(file) === '.html'
      ? { 'x-frame-options': 'DENY', 'content-security-policy': file === join(dist, 'staff.html') ? STAFF_POLICY : NO_FRAMES }
      : {};
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
      ...page,
    }).end(readFileSync(file));
```
and the top of the request handler:

```js
  const server = createServer((req, res) => {
    // On every response, a 404, a 304 and a 503 included (§4). HSTS only where the request came in over https, as
    // Fly's proxy says: the relay itself never speaks TLS.
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    if (String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https') res.setHeader('strict-transport-security', 'max-age=31536000');
    const url = req.url || '/';
```

- [ ] **Step 4: Run and watch them pass**

Run: `node --test tests/staff.test.js tests/server.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add relay/server.js tests/staff.test.js
git commit -m "Every response says no-referrer, every page refuses framing, and the staff page has a full policy

Strict-Transport-Security is sent for a year where the request came in over https.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Only this site's pages, the wristband and tools may open the socket

**Files:**
- Create: `relay/origin.js`, `tests/origin.test.js`
- Modify: `relay/server.js`
- Test: `tests/server.test.js`

**Interfaces:**
- Produces: `originAllowed(origin: string | undefined, host: string | undefined): boolean` from `relay/origin.js`.

- [ ] **Step 1: Write the failing tests**

`tests/origin.test.js`:

```js
// ON THE BEAT — which pages may open the relay's socket
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originAllowed } from '../relay/origin.js';

const HOST = 'on-the-beat.fly.dev';

test('no Origin (a script, a test, a tool) and the wristband\'s file:// are allowed', () => {
  assert.equal(originAllowed(undefined, HOST), true);
  assert.equal(originAllowed('file://', HOST), true);
});

test('a page of this site is allowed, over http or https, with the port its host names', () => {
  assert.equal(originAllowed('https://on-the-beat.fly.dev', HOST), true);
  assert.equal(originAllowed('http://192.168.1.5:8790', '192.168.1.5:8790'), true);
  assert.equal(originAllowed('https://abc.trycloudflare.com', 'ABC.trycloudflare.com'), true);
});

test('the dev server on loopback is allowed, on any port', () => {
  for (const origin of ['http://localhost:5178', 'http://127.0.0.1:5178', 'http://[::1]:5178', 'http://localhost']) {
    assert.equal(originAllowed(origin, '127.0.0.1:8790'), true, origin);
  }
});

test('another site, null, a look-alike host, another scheme and junk are refused', () => {
  for (const origin of ['https://evil.example', 'null', 'https://on-the-beat.fly.dev.evil.example', 'https://evil-on-the-beat.fly.dev',
    'http://localhost.evil.example', 'http://127.0.0.1.evil.example', 'ftp://on-the-beat.fly.dev', 'chrome-extension://abcdef', 'not a url', '']) {
    assert.equal(originAllowed(origin, HOST), false, JSON.stringify(origin));
  }
  assert.equal(originAllowed('https://on-the-beat.fly.dev', undefined), false, 'a request with no Host matches nothing');
});
```

`tests/server.test.js`, at the end:

```js
/** The status a handshake with this Origin (none when undefined) is answered: 101 when it opens. */
function handshake(origin) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://127.0.0.1:' + relay.port + WS_PATH, origin === undefined ? undefined : { origin });
    ws.on('open', () => { resolve(101); ws.close(); });
    ws.on('unexpected-response', (req, res) => { resolve(res.statusCode); res.resume(); });
    ws.on('error', () => {});
  });
}

test('a page of another site cannot open the socket; this site\'s pages, the wristband and tools with no Origin can', async () => {
  const host = '127.0.0.1:' + relay.port;
  for (const origin of [undefined, 'file://', 'http://' + host, 'http://localhost:5178', 'http://127.0.0.1:1', 'http://[::1]:5178']) {
    assert.equal(await handshake(origin), 101, String(origin));
  }
  for (const origin of ['https://evil.example', 'null', 'http://' + host + '.evil.example', 'http://localhost.evil.example', 'ftp://' + host, 'not a url']) {
    assert.equal(await handshake(origin), 403, JSON.stringify(origin));
  }
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/origin.test.js tests/server.test.js`
Expected: `origin.test.js` fails to import; the handshake test sees 101 for every refused origin.

- [ ] **Step 3: Implement**

`relay/origin.js`:

```js
// ON THE BEAT — which pages may open the relay's socket
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §5).

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether a WebSocket handshake may go on, from its Origin header and the Host it was made to. A browser sets
 * Origin and a page cannot change it, so this keeps another site's page from sending its visitors' browsers to the
 * relay, from their own addresses. What sets no Origin (a script, a test, a tool) is let through: it was never
 * stopped by this, and the limits are for it. The wristband's WebSocket library sends `file://`; the dev server
 * talks to the relay from loopback.
 */
export function originAllowed(origin, host) {
  if (origin === undefined || origin === 'file://') return true;
  let url;
  try { url = new URL(origin); } catch { return false; }   // 'null', and anything else that is not an origin
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.host === String(host ?? '').toLowerCase() || LOOPBACK.has(url.hostname);
}
```
`relay/server.js`: `import { originAllowed } from './origin.js';` after the `night.js` import, and replace the `WebSocketServer` line:

```js
  const wss = new WebSocketServer({
    server, path: WS_PATH, maxPayload: MAX_FRAME,
    // Only this site's pages, the wristband and tools that set no Origin (§5): anything else is 403 before a socket exists.
    verifyClient: ({ origin, req }, done) => (originAllowed(origin, req.headers.host) ? done(true) : done(false, 403, 'origin not allowed')),
  });
```

- [ ] **Step 4: Run and watch them pass**

Run: `node --test tests/origin.test.js tests/server.test.js tests/staff.test.js tests/wristband.test.js`
Expected: PASS. Every other test's client sets no Origin, so none is affected.

- [ ] **Step 5: Chrome: the staff page under its policy, and the app, behind the new checks**

The scratch script drives a throwaway headless Chrome over CDP against a local relay on 8791: the staff page must sign in over the socket (its `Origin` is its own host) and list, with no violation in the console; the app must still load under the new headers.

Write the script to the session's scratchpad as `cdp-csp.mjs`:

```js
// Chrome with a throwaway profile, driven over CDP: the staff page under its policy must sign in and list with no
// console violation, and the phone app must still load under the new headers.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ORIGIN = 'http://localhost:8791';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = mkdtempSync(join(tmpdir(), 'otb-csp-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9335', '--user-data-dir=' + profile, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(url) {
  const ws = new WebSocket(url);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const waiting = new Map();
  const events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } else if (m.method) events.push(m);
  };
  const call = (method, params = {}) => new Promise((r) => { id += 1; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  return { ws, call, events };
}

/** Console entries that are errors or warnings, as text. */
const problems = (events) => events.flatMap((m) => {
  if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) return [m.params.entry.source + ': ' + m.params.entry.text];
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) return ['console.' + m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description).join(' ')];
  if (m.method === 'Runtime.exceptionThrown') return ['exception: ' + m.params.exceptionDetails.text];
  return [];
});

async function main() {
  let target;
  for (let i = 0; i < 40 && !target; i += 1) {
    await pause(250);
    try { target = (await (await fetch('http://127.0.0.1:9335/json/list')).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  const page = await session(target.webSocketDebuggerUrl);
  const run = async (expression) => (await page.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await page.call('Page.enable');
  await page.call('Log.enable');
  await page.call('Runtime.enable');

  await page.call('Page.navigate', { url: ORIGIN + '/staff' });
  await pause(2500);
  console.log('staff page policy:', await run("fetch('/staff').then((r) => r.headers.get('content-security-policy'))"));
  await run(`(() => {
    const set = (el, v) => { Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
    set(document.getElementById('venue'), 'roundhouse-bruno-mars');
    set(document.getElementById('code'), 'browser-test-passcode');
  })()`);
  await pause(300);
  await run("document.querySelector('form').requestSubmit()");
  await pause(2500);
  console.log('signed in:', await run("document.querySelector('.staff-top .h2')?.textContent"));
  console.log('notify button:', await run("document.querySelector('.staff-notify')?.textContent"));
  console.log('staff page problems:', JSON.stringify(problems(page.events), null, 1));
  page.events.length = 0;

  await page.call('Page.navigate', { url: ORIGIN + '/' });
  await pause(3500);
  console.log('app title:', await run('document.title'), '| root children:', await run("document.getElementById('root')?.children.length"));
  console.log('app headers:', await run("fetch('/').then((r) => [r.headers.get('x-frame-options'), r.headers.get('content-security-policy'), r.headers.get('referrer-policy')].join(' | '))"));
  console.log('app problems:', JSON.stringify(problems(page.events), null, 1));
  page.ws.close();
}

try { await main(); } finally {
  chrome.kill();
  await pause(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a file */ }
}
```
Build, start a relay with a test passcode for a venue in `relay/shows.json`, on 8791, in the background:

```bash
npm run build
STAFF_CODES="$(node -e "import('./relay/staff.js').then(async (m) => console.log(JSON.stringify({ 'roundhouse-bruno-mars': await m.makeEntry('browser-test-passcode') })))")" PORT=8791 node relay/server.js
```
(run with `run_in_background`). Then, from the scratchpad, `node cdp-csp.mjs`.

Expected: `staff page policy:` is the full policy; `signed in:` shows the venue's heading; `notify button:` says NOTIFY THIS DEVICE (or its state); `staff page problems: []`; `app title: On The Beat`, a non-zero `root children`, `app headers: DENY | frame-ancestors 'none' | no-referrer`, and `app problems` free of anything about a Content Security Policy or a frame (a warning about something else, such as a missing font, is not this).

If the staff page reports `Refused to preconnect`, delete the two `<link rel="preconnect" ...>` lines from `app/staff.html` (a preconnect is only a hint), `npm run build` and run the check again. Any other violation is a directive the page really needs: name it, widen only that directive, and say so in the spec's amendments. Stop the relay when done: `Get-NetTCPConnection -LocalPort 8791`, then `Stop-Process -Id <pid>`.

- [ ] **Step 6: Commit**

```bash
git add relay/origin.js relay/server.js tests/origin.test.js tests/server.test.js app/staff.html
git commit -m "Only this site's pages, the wristband and tools with no Origin may open the socket

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
(`app/staff.html` is added only if the preconnect lines had to go.)

### Task 8: Docs, a mutation run, the whole suite, and the push

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-09-28-staff-reports-design.md`, `docs/superpowers/specs/2026-09-29-staff-security-design.md`, `CLAUDE.md` (the test count; not in git)
- Scratch: `security-mutations.json` in the session's scratchpad, with `mutate.mjs`

- [ ] **Step 1: README**

One Edit at a time, each old text exactly as it stands (a line break is a line break). Read the lines first if an Edit does not match.

1. *The staff page*, "Signing in": after `signed out and asks for the passcode again.` add, keeping the two-space indent and the wrap:

```
  signed out and asks for the passcode again. A token belongs to the
  passcode entry it was made under: change the venue's entry and every
  sign-in made under the old one ends at the restart that follows.
```
2. "Reports last the night": `A restart or a deploy keeps them, and keeps` / `every staff page signed in: the page signs back in with its token.` becomes `A restart or a deploy keeps them, and keeps every staff page signed in, unless its venue's passcode entry changed: the page signs back in with its token.` (re-wrapped).
3. The `npm run staff-code` paragraph: `It asks for the venue's show id and a passcode of at least eight characters,` / `twice, never shows the passcode, and prints one line such as` becomes:

```
It asks for the venue's show id and a passcode of at least twelve
characters, twice, or Enter for one made for you: three groups of four
letters and digits, such as `k7m2-q9xr-4twd`, shown once in that terminal
and kept nowhere. It never shows a passcode you type, and prints one line
such as
```
   and after the paragraph ending `` `http://localhost:5178/staff.html`. `` add:

```
**To sign everyone out at a venue**, or to close a passcode that has
leaked, make its line again (with the same passcode if it is to stay: the
salt is new, so the entry is), put it into `STAFF_CODES`, and set the secret
and deploy as above. The machine restarts, and every sign-in made under the
old entry ends with it: the page asks for the passcode again, and the
notifications those sign-ins held stop. The log says how many, and no venue.
```
4. *Abuse resistance*, the pairing bullet: `it; that the proxy also replaces one a client sends is reported by others,` / `not measured here. Behind the tunnel it is `cf-connecting-ip`, trusted only` / `because the socket is on loopback.` becomes:

```
  it; that the proxy also replaces one a client sends was measured on
  29 Sep 2026: six sockets that each sent a different `fly-client-ip` still
  shared one budget of twenty. Behind the tunnel it is `cf-connecting-ip`,
  trusted only because the socket is on loopback. An IPv6 client counts as
  its /64, since anyone on a network holds 2^64 addresses of it, and an
  IPv4-mapped one as the IPv4 address it wraps.
```
5. The bullet **A report log without end** (two lines) becomes:

```
- **A flood of reports.** One phone could send 1,100 reports in 71 s at
  the pace the frame budget allows, fill a venue's staff list at a thousand,
  push out a real one and make the relay send that list to staff 633 times
  (measured on 29 Sep 2026). Now a person may send ten reports an hour and
  a network sixty, counting every one sent, refused ones too; past either
  the report is refused, unlogged and unpushed, and the phone says to tell
  a member of staff. The log is still capped at a thousand a venue, but
  drops the reports the team has handled first, and a venue's reports go at
  06:00. The counts are in memory: a restart clears them
  (`tests/staff.test.js`, `tests/limits.test.js`).
```
6. The bullet **The staff page.** becomes:

```
- **The staff page.** A passcode is kept only as a scrypt entry, and every
  sign-in by passcode counts on the pairing counters, five a socket and
  twenty an address a minute, its scrypt run off the event loop. At most
  eight checks run at once: a ninth is refused unheard and counted against
  nobody, so a crowd of guessers cannot queue behind the four threads that
  also write the night. A passcode is at least twelve characters, or one
  the script makes. A token lasts until 06:00 at its own venue only, and
  only under the passcode entry it was made with, so a changed passcode
  ends its sign-ins at the restart. A socket is a phone, a wristband
  or staff, never two, including one that joins while its passcode is being
  checked; a staff socket can only mark reports. Staff see a person only as
  a tag of six hex digits made with a key drawn at start (kept in the night
  file, so it survives a restart), and never who reported; the relay's
  log says only which venue and which report, with anything a stranger could
  shape in a venue name replaced. What it cannot tell: someone
  with many phones can report one person from each, so `reported 5 times by
  5 people` is a lead for staff to look into, not proof.
```
7. After the **MIME confusion.** bullet add:

```
- **Framing, referrers, injected script.** Every response says
  `Referrer-Policy: no-referrer`, and over https `Strict-Transport-Security`
  for a year (Fly's proxy says which; not for subdomains, no preload).
  Every page says `X-Frame-Options: DENY` and `frame-ancestors 'none'`, so no
  other site can frame it and steal a tap. The staff page also carries a
  full Content-Security-Policy: its own scripts, styles, worker, manifest
  and socket, fonts from Google, nothing inline, no plugin, no `<base>`, no
  form posted elsewhere. It has no inline script or style to allow. The
  phone app has no such policy yet (*What is not done*).
- **Other sites' pages driving the socket.** The socket used to open for
  any page's script, so a page a stranger made could send every visitor's
  browser to the relay, to report, join or try a passcode, from the
  visitors' own addresses and outside the per-address counters. Now a
  handshake with an `Origin` is refused (403, before a socket exists)
  unless it is this site's own host, `file://` (what the wristband's
  library sends) or the dev server on loopback. A tool that sets no
  `Origin` is let through, as it always was: the limits above are for it
  (`tests/origin.test.js`, `tests/server.test.js`).
```
8. *Reading the night's file* and the *A deploy carries the night on* bullet: in the first, `no staff token, only their SHA-256:` becomes `no staff token, only their SHA-256 (and, beside a sign-in, a print of the passcode entry it was made under, from which nothing can be worked back):`; in the second nothing changes.
9. *What is not done*, the staff bullet: `passcode a venue is shared by its whole team; changing it is a secret set` / `and a restart, and because a restart keeps tonight's sign-ins, the old` / `passcode's devices stay signed in until 06:00.` becomes:

```
  passcode a venue is shared by its whole team; changing it, or making it
  again, is a secret set and a restart, which ends every sign-in made under
  the old one.
- **The phone app has no Content-Security-Policy.** The staff page has one;
  the phone app's needs the camera scanner, clips as `blob:` media and
  Safari's reading of `connect-src` tried on a real phone first, so it gets
  only the framing rule. **Left as they are** (staff review, 29 Sep 2026):
  the staff page asks Google for its font, which tells Google a staff
  device's address and browser; `no staff page` and `wrong code` tell a
  guesser which venues have one; scrypt's cost stays at 16 MiB a check for a
  256 MB machine; and a passcode holder can push the 1,000 oldest sign-ins
  out of the table by signing in a thousand times.
```

- [ ] **Step 2: The two specs**

`docs/superpowers/specs/2026-09-28-staff-reports-design.md`: append at the end:

```markdown
## Amended after the security review (29 Sep 2026)

Three things above are out of date; `2026-09-29-staff-security-design.md` has the current rules.

- **§1, the tag.** It is `P-` and six upper-case hex digits, and the key it is made under is kept in the night file, so a restart no longer gives new tags.
- **§2, staying signed in.** A token from before a restart is refused only when its venue's passcode entry changed since. Under the same entry it signs in again (restart spec, 29 Sep 2026).
- **§6, changing a passcode.** Setting a new entry is a restart, and a token now belongs to the entry it was made under, so every sign-in under the old one ends with it.
```
`docs/superpowers/specs/2026-09-29-staff-security-design.md`: append at the end:

```markdown
## Amended while planning

1. **§1, third bullet dropped.** "A token signs in only while its `entry` is still the venue's" can never fire: `STAFF_CODES` is read once, at start, and a token in memory was made under the venue's entry or carried on only after the restore check, so no test could hold it. The guard is at restore alone (`tokenFrom`).
2. **§3, `rolling`** also returns `size()` and `held(key)`, for tests.
3. **§3, tests.** The report-limit tests are in `tests/staff.test.js`, beside the other report tests and on its movable clock, not in `tests/server.test.js`, with one more: a refused report still counts against its network.
4. **§4, `X-Content-Type-Options: nosniff`** is set once at the top of the request handler with the other two, so a 404, a 304 and a 503 carry it as well; it was only on the 200s.
5. **§5, `originAllowed`** allows only `http:` and `https:` origins besides `file://`.
6. **§2, `npm run staff-code`:** the input ending at the passcode question is "No passcode given", not Enter; `madeCode()` is in `relay/staff.js`, so its alphabet is tested where it is.
7. **§4, the check in Chrome** removes the two `<link rel="preconnect">` lines from `app/staff.html` if Chrome counts them against `connect-src`, and widens nothing else. (Say here what the check found.)
```

- [ ] **Step 3: The mutation run**

Write `security-mutations.json` to the session's scratchpad. One guard broken at a time; exactly the tests named go red, the file is restored byte for byte, and its tests are green again. (`\\p` is the JSON way of writing `\p`.)

```json
[
  { "label": "restore: an entry that is not the venue's is carried on", "file": "relay/server.js",
    "from": "if (typeof entry !== 'string' || entry !== printOf(key)) return null;", "to": "if (typeof entry !== 'string') return null;",
    "test": "tests/restart.test.js", "expect": ["a staff sign-in ends at a restart", "a venue whose staff page is gone"] },
  { "label": "restore: a sign-in with no entry is carried on", "file": "relay/server.js",
    "from": "if (typeof entry !== 'string' || entry !== printOf(key)) return null;", "to": "if (entry !== undefined && entry !== printOf(key)) return null;",
    "test": "tests/restart.test.js", "expect": ["a sign-in in the night file with no entry"] },
  { "label": "restore: ended sign-ins are not logged", "file": "relay/server.js",
    "from": "if (ended) console.log(", "to": "if (false) console.log(",
    "test": "tests/restart.test.js", "expect": ["a staff sign-in ends at a restart", "a sign-in in the night file with no entry", "a venue whose staff page is gone"] },
  { "label": "restore: the subscription stays with an ended sign-in", "file": "relay/server.js",
    "from": "if (typeof entry !== 'string' || entry !== printOf(key)) return null;", "to": "if (typeof entry !== 'string') return null;",
    "test": "tests/staff-push.test.js", "expect": ["a sign-in that ends at a restart because"] },
  { "label": "a sign-in does not record its entry", "file": "relay/server.js",
    "from": "tokens.set(tokenHashOf(token), { key, night, entry: printOf(key) });", "to": "tokens.set(tokenHashOf(token), { key, night });",
    "test": "tests/restart.test.js", "expect": ["a staff token from before a restart signs in after it", "a staff sign-in ends at a restart", "a sign-in in the night file with no entry", "the night file holds no staff token"] },
  { "label": "the print is shortened", "file": "relay/staff.js",
    "from": ".digest('hex').slice(0, 32);", "to": ".digest('hex').slice(0, 16);",
    "test": "tests/staff-code.test.js", "expect": ["an entry's print is 32 hex digits"] },
  { "label": "an IPv6 address keeps its whole self (unit)", "file": "relay/address.js",
    "from": "return g.slice(0, 4).map((x) => x.toString(16)).join(':') + '::/64';", "to": "return g.map((x) => x.toString(16)).join(':');",
    "test": "tests/address.test.js", "expect": ["an IPv6 address counts as its /64"] },
  { "label": "an IPv6 address keeps its whole self (relay)", "file": "relay/address.js",
    "from": "return g.slice(0, 4).map((x) => x.toString(16)).join(':') + '::/64';", "to": "return g.map((x) => x.toString(16)).join(':');",
    "test": "tests/staff.test.js", "expect": ["an IPv6 attacker has one allowance"] },
  { "label": "a mapped address is not unwrapped", "file": "relay/address.js",
    "from": "g[5] === 0xffff", "to": "g[5] === 0xfffe",
    "test": "tests/address.test.js", "expect": ["an IPv4-mapped IPv6 address"] },
  { "label": "no cap on passcode checks", "file": "relay/server.js",
    "from": "if (checking >= CHECKS_AT_ONCE)", "to": "if (false)",
    "test": "tests/staff.test.js", "expect": ["at most eight passcode checks run at once"] },
  { "label": "the cap is nine", "file": "relay/server.js",
    "from": "const CHECKS_AT_ONCE = 8;", "to": "const CHECKS_AT_ONCE = 9;",
    "test": "tests/staff.test.js", "expect": ["at most eight passcode checks run at once"] },
  { "label": "a busy refusal is counted against the person", "file": "relay/server.js",
    "from": "    if (checking >= CHECKS_AT_ONCE) { answer({ ok: false, why: 'too many tries' }); return; }\n    attempt(ws);   // every sign-in by passcode counts, right or wrong, on the pairing counters\n",
    "to": "    attempt(ws);   // every sign-in by passcode counts, right or wrong, on the pairing counters\n    if (checking >= CHECKS_AT_ONCE) { answer({ ok: false, why: 'too many tries' }); return; }\n",
    "test": "tests/staff.test.js", "expect": ["at most eight passcode checks run at once"] },
  { "label": "a finished check is never taken off the count", "file": "relay/server.js",
    "from": "      checking -= 1;", "to": "      // checking -= 1;",
    "test": "tests/staff.test.js", "expect": ["a wrong passcode is refused and counted", "an IPv6 attacker has one allowance", "at most eight passcode checks run at once"] },
  { "label": "limits: a refused attempt is not recorded", "file": "relay/limits.js",
    "from": "      list.push(at);", "to": "      if (within) list.push(at);",
    "test": "tests/limits.test.js", "expect": ["a refused attempt counts too"] },
  { "label": "limits: a key grows without end", "file": "relay/limits.js",
    "from": "      if (list.length > max) list.shift();", "to": "      // no shift",
    "test": "tests/limits.test.js", "expect": ["a key never holds more than max"] },
  { "label": "limits: a time lives one millisecond too long", "file": "relay/limits.js",
    "from": ".filter((t) => at - t < ms)", "to": ".filter((t) => at - t <= ms)",
    "test": "tests/limits.test.js", "expect": ["the window slides"] },
  { "label": "limits: prune forgets nothing", "file": "relay/limits.js",
    "from": "if (list.every((t) => at - t >= ms)) seen.delete(key);", "to": "if (false) seen.delete(key);",
    "test": "tests/limits.test.js", "expect": ["prune forgets a key"] },
  { "label": "reports: everyone at a venue shares one person's count", "file": "relay/server.js",
    "from": "reportsBy.take(r.key + '|' + me, at)", "to": "reportsBy.take(r.key, at)",
    "test": "tests/staff.test.js", "expect": ["a network may send sixty reports", "a refused report still counts against its network"] },
  { "label": "reports: a network may send sixty-one", "file": "relay/server.js",
    "from": "const ADDRESS_REPORTS = 60;", "to": "const ADDRESS_REPORTS = 61;",
    "test": "tests/staff.test.js", "expect": ["a network may send sixty reports", "a refused report still counts against its network"] },
  { "label": "reports: a person may send eleven", "file": "relay/server.js",
    "from": "const PERSON_REPORTS = 10;", "to": "const PERSON_REPORTS = 11;",
    "test": "tests/staff.test.js", "expect": ["a person may send ten reports an hour", "a refused report still counts against its network"] },
  { "label": "reports: a network counts only what the person was let send", "file": "relay/server.js",
    "from": "const network = reportsFrom.take(ws.addr, at);", "to": "const network = person ? reportsFrom.take(ws.addr, at) : true;",
    "test": "tests/staff.test.js", "expect": ["a refused report still counts against its network"] },
  { "label": "a full log drops the oldest, handled or not", "file": "relay/room.js",
    "from": "const handled = reports.findIndex((x) => x.handledAt);", "to": "const handled = -1;",
    "test": "tests/room.test.js", "expect": ["a full report log drops handled reports first"] },
  { "label": "refusals: a name on the object's own prototype is spoken", "file": "app/lib/refusals.js",
    "from": "Object.hasOwn(SAY, m.why)", "to": "m.why in SAY",
    "test": "tests/refusals.test.js", "expect": ["the phone has words for the refusals it speaks"] },
  { "label": "refusals: the app does not use the lookup", "file": "app/App.jsx",
    "from": "const refusal = refusalWords(m);", "to": "const refusal = null;",
    "test": "tests/refusals.test.js", "expect": ["the app speaks its refusals through that lookup"] },
  { "label": "the tag is four digits again", "file": "relay/server.js",
    "from": ".digest('hex').slice(0, 6).toUpperCase();", "to": ".digest('hex').slice(0, 4).toUpperCase();",
    "test": "tests/staff.test.js", "expect": ["a report made after sign-in reaches staff within a second"] },
  { "label": "the log line lets a format character through", "file": "relay/server.js",
    "from": "/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/gu", "to": "/[\\p{Cc}\\p{Zl}\\p{Zp}]/gu",
    "test": "tests/staff.test.js", "expect": ["the log line for a report replaces control"] },
  { "label": "no referrer policy", "file": "relay/server.js",
    "from": "    res.setHeader('referrer-policy', 'no-referrer');\n", "to": "",
    "test": "tests/staff.test.js", "expect": ["every response carries the security headers", "a 503 carries them too"] },
  { "label": "no nosniff on a 404 or a 503", "file": "relay/server.js",
    "from": "    res.setHeader('x-content-type-options', 'nosniff');\n", "to": "",
    "test": "tests/staff.test.js", "expect": ["every response carries the security headers", "a 503 carries them too"] },
  { "label": "HSTS over plain http too", "file": "relay/server.js",
    "from": "if (String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https')", "to": "if (true)",
    "test": "tests/staff.test.js", "expect": ["every response carries the security headers"] },
  { "label": "every page gets the staff policy", "file": "relay/server.js",
    "from": "file === join(dist, 'staff.html') ? STAFF_POLICY : NO_FRAMES", "to": "true ? STAFF_POLICY : NO_FRAMES",
    "test": "tests/staff.test.js", "expect": ["every response carries the security headers"] },
  { "label": "a page may be framed", "file": "relay/server.js",
    "from": "{ 'x-frame-options': 'DENY', 'content-security-policy'", "to": "{ 'content-security-policy'",
    "test": "tests/staff.test.js", "expect": ["every response carries the security headers"] },
  { "label": "origin: loopback is refused (unit)", "file": "relay/origin.js",
    "from": "LOOPBACK.has(url.hostname)", "to": "false",
    "test": "tests/origin.test.js", "expect": ["the dev server on loopback is allowed"] },
  { "label": "origin: loopback is refused (relay)", "file": "relay/origin.js",
    "from": "LOOPBACK.has(url.hostname)", "to": "false",
    "test": "tests/server.test.js", "expect": ["a page of another site cannot open the socket"] },
  { "label": "origin: the wristband is refused (unit)", "file": "relay/origin.js",
    "from": "if (origin === undefined || origin === 'file://') return true;", "to": "if (origin === undefined) return true;",
    "test": "tests/origin.test.js", "expect": ["no Origin (a script, a test, a tool)"] },
  { "label": "origin: the wristband is refused (relay)", "file": "relay/origin.js",
    "from": "if (origin === undefined || origin === 'file://') return true;", "to": "if (origin === undefined) return true;",
    "test": "tests/server.test.js", "expect": ["a page of another site cannot open the socket"] },
  { "label": "origin: any origin is let through (unit)", "file": "relay/origin.js",
    "from": "return url.host === String(host ?? '').toLowerCase() || LOOPBACK.has(url.hostname);", "to": "return true;",
    "test": "tests/origin.test.js", "expect": ["another site, null, a look-alike host"] },
  { "label": "origin: any origin is let through (relay)", "file": "relay/origin.js",
    "from": "return url.host === String(host ?? '').toLowerCase() || LOOPBACK.has(url.hostname);", "to": "return true;",
    "test": "tests/server.test.js", "expect": ["a page of another site cannot open the socket"] },
  { "label": "origin: another scheme on this host is let through (unit)", "file": "relay/origin.js",
    "from": "  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;\n", "to": "",
    "test": "tests/origin.test.js", "expect": ["another site, null, a look-alike host"] },
  { "label": "the socket is not checked at all", "file": "relay/server.js",
    "from": "    verifyClient: ({ origin, req }, done) => (originAllowed(origin, req.headers.host) ? done(true) : done(false, 403, 'origin not allowed')),\n", "to": "",
    "test": "tests/server.test.js", "expect": ["a page of another site cannot open the socket"] },
  { "label": "passcodes: eight characters are enough again", "file": "scripts/staff-code.mjs",
    "from": "const CODE_MIN = 12;", "to": "const CODE_MIN = 8;",
    "test": "tests/staff-code.test.js", "expect": ["a typed passcode needs twelve characters"] },
  { "label": "passcodes: i is in the alphabet", "file": "relay/staff.js",
    "from": "const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';", "to": "const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';",
    "test": "tests/staff-code.test.js", "expect": ["a made passcode is three groups of four"] },
  { "label": "passcodes: a made one goes to stdout", "file": "scripts/staff-code.mjs",
    "from": "process.stderr.write('Passcode (made for you, shown once, kept nowhere): '", "to": "process.stdout.write('Passcode (made for you, shown once, kept nowhere): '",
    "test": "tests/staff-code.test.js", "expect": ["Enter at the passcode makes one", "at a terminal, Enter at the passcode makes one too"] },
  { "label": "passcodes: the end of the input is Enter", "file": "scripts/staff-code.mjs",
    "from": "return done ? null : value;", "to": "return value;",
    "test": "tests/staff-code.test.js", "expect": ["two passcodes that differ, one too short, or no venue make nothing"] }
]
```
Run it from the repo root, with nothing else touching the working tree, in the background (one background task, about a quarter of an hour):

```bash
node "$SCRATCH/mutate.mjs" "$SCRATCH/security-mutations.json" > "$SCRATCH/security-mutations.out" 2>&1
```
Expected: every line `OK`, then `ALL MUTATIONS HELD`. A `SKIP` means the `from` text differs from the code as written: fix the JSON, not the code. A `FAIL` means a guard has no test of its own, or the wrong one: fix the test and run that entry again. After the run, `git status` must show only the files this task meant to change.

- [ ] **Step 4: The whole suite**

Run: `npm test > "$SCRATCH/test-full.txt" 2>&1; tail -n 12 "$SCRATCH/test-full.txt"`
Expected: `ℹ fail 0`. Note the `ℹ tests` number. On a red file, read it, rerun that file alone, and say so plainly; a Node fatal error that loses a file to exit 0xC0000409 is the known one (memory `test-native-abort`): rerun the file and keep the report.

- [ ] **Step 5: Commit and push**

Set the count in `CLAUDE.md` (it is not in git). Then:

```bash
git add README.md docs/superpowers/specs/2026-09-28-staff-reports-design.md docs/superpowers/specs/2026-09-29-staff-security-design.md docs/superpowers/plans/2026-09-29-staff-security.md
git commit -m "README and specs say what the staff security review found and closed

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 9: Deploy, look at it live, and write it down

**Files:**
- Modify: memory `staff-reports.md`, `work-queue.md`, `fly-relay.md`, `MEMORY.md`; the scratchpad `progress.md`

No demo is announced (memory `fly-relay`: deploy any time, except while the owner has said one is on). If `flyctl` says it is not logged in, stop: the owner runs `flyctl auth login` in their own terminal, and no token is ever handled here.

- [ ] **Step 1: Deploy**

```powershell
& "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Fly-io.flyctl_Microsoft.Winget.Source_8wekyb3d8bbwe\flyctl.exe" deploy --ha=false --remote-only
& "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Fly-io.flyctl_Microsoft.Winget.Source_8wekyb3d8bbwe\flyctl.exe" machine list -a on-the-beat
```
Expected: one machine, started. Then `flyctl logs -a on-the-beat --no-tail` (last lines only): `night: carried on from /data/night.json …` or `night: none at /data/night.json`, and `push: keys from /data/push-keys.json`.

- [ ] **Step 2: Look at it from outside, harmlessly**

```bash
curl -sI https://on-the-beat.fly.dev/ | grep -iE "^(x-frame-options|content-security-policy|referrer-policy|strict-transport-security|x-content-type-options)"
curl -sI https://on-the-beat.fly.dev/staff | grep -i "^content-security-policy"
curl -sI https://on-the-beat.fly.dev/api/shows | grep -iE "^(referrer-policy|strict-transport-security|content-security-policy)"
```
Expected: the app has `DENY`, `frame-ancestors 'none'`, `no-referrer`, `max-age=31536000` and `nosniff`; `/staff` the full policy; the shows feed no policy but the other headers. Then, from the scratchpad, a handshake probe with the `ws` package: `Origin: https://evil.example` must be answered 403; no `Origin`, `file://` and `Origin: https://on-the-beat.fly.dev` must open (101) and be closed straight away. It joins nothing and guesses nothing.

- [ ] **Step 3: The real bands**

The one guard no test here can prove is that the bands send `file://` (the library's source says they do, `WebSocketsClient.cpp:32`, and `main.cpp` never overrides it). If both bands are on and on the Y70 hotspot, read each console for about 40 s the way memory `wristband-sticks3` says (pyserial in PlatformIO's Python, DTR and RTS low; StickS3 on `COM8`, StickC Plus on `COM9`), and look for the relay socket opening and the relay's show arriving, as after every earlier deploy. If either band does not reach the relay, take the Origin check out first: revert `verifyClient` in a commit, deploy, and only then look further. If the bands are off or away, say so: the check has not been made, and the owner turns them on and looks the next time they are on.

- [ ] **Step 4: Write it down**

Memory, read each file first and edit it, never a second file for the same fact:
- `staff-reports.md`: the review is done and deployed (date, the seven findings in a line each, the two measurements), what is still owed by the owner.
- `work-queue.md`: item 4 done; the queue 「2134」 is finished; what is left.
- `fly-relay.md`: the deploy line, and the last bullet ("Not measured: that Fly's proxy replaces a client-sent `fly-client-ip`") replaced by the measurement.
- `MEMORY.md`: the one-line hooks for those three.
Replace the scratchpad `progress.md` with what is left.

## Amended while planning

Where this plan departs from the spec, and why; Task 8 writes the same into the spec.

1. **Spec §1, the sign-in-time check is dropped.** "A token signs in only while its `entry` is still the venue's" can never fire: `STAFF_CODES` is read once at start, and a token in memory was made under the venue's entry or carried on only after the restore check. No test could hold it, and a guard no test holds is the kind this project does not keep. The guard is at restore (`tokenFrom`), where a test does hold it.
2. **Spec §3, `rolling`** also returns `size()` and `held(key)`, for tests.
3. **Spec §3, tests.** The report-limit tests are in `tests/staff.test.js` (its movable clock, its other report tests), not `tests/server.test.js`; one more is added, that a refused report still counts against its network. `tests/refusals.test.js` also reads `App.jsx` to hold that the app uses the lookup, since a JSX screen cannot be run under `node --test`.
4. **Spec §4, nosniff.** `X-Content-Type-Options: nosniff` is set at the top of the request handler with the other two, so a 404, a 304 and a 503 carry it too. It was only on 200s.
5. **Spec §5.** `originAllowed` allows only `http:` and `https:` origins besides `file://`.
6. **Spec §2, the script.** The input ending at the passcode question is "No passcode given", not Enter. `madeCode()` lives in `relay/staff.js`, so a test can call it 2,000 times and see all 31 characters and no others.
7. **Spec, "In a browser".** The Chrome check is the last step of Task 7, after the Origin check is in, so the staff page signs in over the socket through it.

## Self-review

- **Spec coverage.** §1 Task 1. §2: the /64 and the cap Task 2, the script Task 3. §3: limits, eviction and the phone's words Task 4, the tag and the log Task 5. §4 Task 6. §5 Task 7. Tests and proof: each task's tests, Task 7 Step 5 for Chrome, Task 8 for the mutations and the suite, Task 9 for Fly and the bands. Also to change: Task 8 (README, both specs, `CLAUDE.md`) and Task 9 (memory). Risks: nothing to build; the band check in Task 9 is the one the spec names.
- **Placeholders.** None: every step names its file and gives its code or its text. Task 8's README edits give both the old text and the new.
- **Names.** `entryPrint`, `madeCode`, `addressKey`, `rolling` (`take`, `prune`, `size`, `held`), `originAllowed`, `refusalWords`, `staffCheck`, `printOf`, `plain`, `STAFF_POLICY`, `NO_FRAMES`, `CHECKS_AT_ONCE`, `PERSON_REPORTS`, `ADDRESS_REPORTS` are spelt the same wherever they appear.
