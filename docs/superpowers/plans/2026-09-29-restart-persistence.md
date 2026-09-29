# The night survives a restart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deploy or a restart in the middle of a night changes nothing anyone can see but the clips on the floor, and nothing the relay keeps lets anyone act as someone else.

**Architecture:** A room can `dump()` itself as plain data and be made again from it (`relay/room.js`). A small module writes one file whole or not at all (`relay/store.js`). The relay writes the night to `NIGHT_FILE` within a second of any change and once more before it closes, reads it back at start when it is tonight's, and gives everyone the usual grace until their sockets are back (`relay/server.js`). Phone ids, wristband secrets and staff tokens are held only as SHA-256. On Fly the file lives on a 1 GB volume with no snapshots; the image hands `/data` to `node` and runs the relay as `node` (`fly.toml`, `Dockerfile`).

**Tech Stack:** Node 24 (`node --test`, `node:fs` sync I/O, `node:crypto` SHA-256), `ws` 8.21, Fly.io Machines and volumes, Debian `setpriv`.

**Spec:** `docs/superpowers/specs/2026-09-29-restart-persistence-design.md` (decided with the owner on 29 Sep 2026, commit `41bf4fa`). Its section *Amended while planning* lists seven changes this plan makes to it; read the spec, then that section, before any task.

This plan was written before the build, from the code at `41bf4fa`. Where the build finds a block here wrong, the block is corrected in this file in the same commit as the fix, so the plan stays what was built.

## Global Constraints

- Artefacts are English: code, comments, commit messages, README, test names, log lines. Talk to the owner in Chinese.
- **The file never holds a phone's id, a wristband's secret or a staff token as sent over the socket**, only their SHA-256 (spec §4). Logs about the night carry counts only: never a name, a contact, a handle, a venue or an id.
- **Nothing kept past the night:** a file whose `at` is another night (`nightOf()` at the venue, 06:00) is removed unread; the file is removed once the night holds nothing; Fly keeps no snapshot (`scheduled_snapshots = false`).
- **Not written:** clips and clip refs; what bands heard (`samples`, `listening`, `fives`, `marked`); sockets and timers; pairing attempt counters; `clipKey`; a wristband record with neither a person nor `waiting`.
- **Nothing changes for the phone, the staff page or the firmware.** `app/` changes only in a comment.
- The file's format is version `1`. `NIGHT_FILE` on Fly is `/data/night.json`; the volume is named `night`, 1 GB, in `syd`.
- Tests: `node --test`. `npm test` builds first (`vite build`) and runs every `tests/*.test.js`: about 470 tests before this plan. A relay test that uses no `dist/` file can run alone with `node --test tests/<file>`. Use test passcodes only (`test-passcode-1`).
- **Commit and push to `main` when a task's full suite is green** (the project's standing rule), each message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push anywhere but `origin` (`LewisSwan24/on-the-beat`); `tools/hooks/pre-push` refuses a `cimi2232` remote.
- **Fly:** exactly one machine. Creating the volume bills (about US$0.15 a month) and needs the owner's explicit yes, asked in Chinese with AskUserQuestion. No deploy or relay restart while he has said a demo is on. He runs `flyctl auth login` himself; flyctl is not on PATH: `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Fly-io.flyctl_Microsoft.Winget.Source_8wekyb3d8bbwe\flyctl.exe`.
- Git Bash on this machine eats backticks and `\$` inside inline `node -e` and heredocs: write scripts and code with the Write and Edit tools.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `relay/store.js` | create | The night's file on disk: read, write whole (tmp, fsync, rename, 0600), remove. Knows nothing of rooms. |
| `relay/room.js` | modify | `dump()`; `createRoom({ restore })`; header comment. |
| `relay/server.js` | modify | `nightFile`/`saveEveryMs` options; `dumpNight()`, `save()`, the timer, `close()` writing first; `readNight()`, `restoreNight()`, `spotsFor()`; `personOf()`, secret and token hashes; the command line's signals and logs. |
| `fly.toml` | modify | `NIGHT_FILE`, `[mounts]` with no snapshots, header comment. |
| `Dockerfile` | modify | Last stage: root only to hand `/data` to `node`, then `setpriv` to run as `node`; a build check. |
| `tests/store.test.js` | create | The file: whole or not at all. |
| `tests/room.test.js` | modify | A room carried across a restart. |
| `tests/restart.test.js` | create | A relay closed and a new one on the same file. |
| `tests/deploy.test.js` | create | What Fly is told: `fly.toml` and the `Dockerfile`. |
| `tests/server.test.js`, `tests/staff.test.js` | modify | The three lines that ask a room for a phone's id ask for `personOf(id)`. |
| `README.md`, `app/lib/net.js` | modify | Say what the relay does now. |

## Procedures

**P1 — Mutation check.** The runner below, saved as `mutate.mjs` in the session's scratchpad, takes a JSON list of `{label, file, from, to, test, expect}` and is run from the repository root: `node <scratchpad>/mutate.mjs <scratchpad>/mutations.json`. For each entry it replaces `from` (which must occur exactly once) with `to`, runs the one test file, restores the file byte for byte, runs it again, and says OK only if exactly the `expect` tests (by title prefix) went red and all is green after the restore. Run it in the background; it prints `ALL MUTATIONS HELD` or names the one that did not.

````js
// Mutation check (plan procedure P1): break one guard, run one test file,
// report which tests went red, restore byte for byte, and confirm green again.
// Usage: node mutate.mjs <mutations.json>
//   [{ "file": "relay/server.js", "from": "...", "to": "...", "test": "tests/x.test.js", "expect": ["name", ...] }]
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const list = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const run = (file) => {
  const r = spawnSync(process.execPath, ['--test', file], { encoding: 'utf8', timeout: 300_000 });
  const out = r.stdout + r.stderr;
  const red = [...new Set(out.split(/\r?\n/).filter((l) => l.startsWith('✖ ') && !l.startsWith('✖ failing tests'))
    .map((l) => l.slice(2).replace(/ \(\d+(\.\d+)?m?s\)$/, '')))];
  const fail = (out.match(/^ℹ fail (\d+)/m) || [])[1];
  return { red, fail: Number(fail) };
};

let allOk = true;
for (const m of list) {
  const original = readFileSync(m.file, 'utf8');
  const hits = original.split(m.from).length - 1;
  if (hits !== 1) { console.log(`SKIP ${m.from.slice(0, 60)}: found ${hits} times`); allOk = false; continue; }
  writeFileSync(m.file, original.replace(m.from, m.to));
  let broken;
  try { broken = run(m.test); } finally { writeFileSync(m.file, original); }
  const restored = readFileSync(m.file, 'utf8') === original;
  const again = run(m.test);
  const exact = broken.red.length === m.expect.length && m.expect.every((e) => broken.red.some((r) => r.startsWith(e)));
  const ok = exact && restored && again.fail === 0;
  allOk &&= ok;
  console.log(`${ok ? 'OK  ' : 'FAIL'} mutation: ${m.label}`);
  console.log(`     red (fail ${broken.fail}): ${broken.red.join(' | ') || '(none)'}`);
  console.log(`     restored byte for byte: ${restored}; after restore: fail ${again.fail}`);
}
console.log(allOk ? 'ALL MUTATIONS HELD' : 'SOME MUTATION DID NOT HOLD');
````

**P2 — The full suite.** From the repository root: `npm test > <scratchpad>/test-full.txt 2>&1; tail -8 <scratchpad>/test-full.txt`. Keep the whole file: never grep it down to summary lines. Green is `ℹ fail 0`. A file reported `not ok … exitCode: 3221226505` (0xC0000409) is a Node crash on this laptop, not a pass and not a failing test (memory `test-native-abort`): rerun that file with `NODE_OPTIONS="--report-on-fatalerror --report-uncaught-exception --report-directory=<scratchpad>"`, read its stderr and the report, and say it was a crash.

---

### Task 1: The night's file on disk

**Files:**
- Create: `relay/store.js`
- Test: `tests/store.test.js` (new)

**Interfaces:**
- Produces: `openNight(path)` → `{ path: string, read(): string | null, write(text: string): void, remove(): void }`. `read()` throws anything but `ENOENT`; `write()` and `remove()` throw what `node:fs` throws.

- [ ] **Step 1: Write the failing tests**

Create `tests/store.test.js`:

```js
// ON THE BEAT — the night's file on disk, written whole or not at all
// (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §2, §5).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNight } from '../relay/store.js';

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'otb-store-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

test('a missing file reads as null, and removing it again does not throw', () => {
  const night = openNight(join(dir, 'none.json'));
  assert.equal(night.read(), null);
  night.remove();
  night.remove();
});

test('a write replaces the file whole and leaves no .tmp beside it', () => {
  const night = openNight(join(dir, 'whole.json'));
  night.write('{"v":1,"n":1}');
  night.write('{"v":1,"n":2}');
  assert.equal(night.read(), '{"v":1,"n":2}');
  assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith('whole')), ['whole.json']);
});

test('a .tmp left by a write cut short is written over, and the last whole file is what is read', () => {
  const path = join(dir, 'cut.json');
  writeFileSync(path, '{"v":1,"last":"whole"}');
  writeFileSync(path + '.tmp', '{"v":1,"half');   // a write the process died in
  const night = openNight(path);
  assert.equal(night.read(), '{"v":1,"last":"whole"}');
  night.write('{"v":1,"next":true}');
  assert.equal(readFileSync(path, 'utf8'), '{"v":1,"next":true}');
  assert.equal(existsSync(path + '.tmp'), false);
});

test('remove() takes the file and any .tmp with it', () => {
  const path = join(dir, 'gone.json');
  const night = openNight(path);
  night.write('{}');
  writeFileSync(path + '.tmp', 'x');
  night.remove();
  assert.equal(existsSync(path), false);
  assert.equal(existsSync(path + '.tmp'), false);
});

test('the file is readable by its owner only', { skip: process.platform === 'win32' && 'Windows has no Unix modes' }, () => {
  const path = join(dir, 'mode.json');
  openNight(path).write('{}');
  assert.equal(statSync(path).mode & 0o777, 0o600);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/store.test.js`
Expected: FAIL — `Cannot find module '…/relay/store.js'`.

- [ ] **Step 3: Write `relay/store.js`**

```js
// ON THE BEAT — the night's file on disk
// (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §2, §5).
//
// One file and nothing else: read it, write it whole, remove it. A write goes
// to `<path>.tmp` first, readable by its owner only, is fsynced, and is renamed
// over the file, so a write cut short leaves the last whole file. It knows
// nothing of rooms.

import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/** The night's file at `path`: `read()` is its text or null, `write(text)` replaces it whole, `remove()` deletes it. */
export function openNight(path) {
  const tmp = path + '.tmp';
  return {
    path,
    read() {
      try {
        return readFileSync(path, 'utf8');
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    write(text) {
      const fd = openSync(tmp, 'w', 0o600);
      try {
        writeFileSync(fd, text);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, path);
    },
    remove() {
      rmSync(path, { force: true });
      rmSync(tmp, { force: true });
    },
  };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/store.test.js`
Expected: PASS, 5 tests (4 on Windows, where the mode test is skipped).

- [ ] **Step 5: Full suite (P2), then commit and push**

```bash
git add relay/store.js tests/store.test.js
git commit -m "The night's file: written whole or not at all" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 2: A room carried across a restart

**Files:**
- Modify: `relay/room.js` (the header comment; `createRoom`'s options; a restore block after `const marked = new Map();`; `dump()`; the returned object)
- Test: `tests/room.test.js` (append)

**Interfaces:**
- Produces: `room.dump()` → `{ salt, people, blocks, waves, latest, likes, dances, matches, tombs, reports, nextReport, nextMatch }`, plain arrays and objects, every person's `clip` null and `dances` keys only. `createRoom({ restore })` takes that object (after `JSON.parse`) and makes the room as it was, `salt` included; it throws a `TypeError` when `nextReport` or `nextMatch` is not an integer, and whatever `for…of` throws on a list that is not one.

- [ ] **Step 1: Write the failing tests**

Append to `tests/room.test.js`:

```js
// ---------- restart spec §1: a room carried across a restart ----------

/** A room as a restart brings it back: its dump, through JSON, made again on the same clock. */
const carried = (room, now) => createRoom({ now, restore: JSON.parse(JSON.stringify(room.dump())) });

test('a room carried across a restart shows everyone what it did, and goes on from where it was', () => {
  let t = Date.UTC(2026, 8, 29, 11, 0);
  const now = () => t;
  const room = createRoom({ now });
  const ids = ['ana', 'ben', 'cai', 'dan', 'eve'];
  for (const id of ids) {
    room.join(id);
    room.setProfile(id, { name: id.toUpperCase(), contact: '@' + id });
    room.pick(id, 'track of ' + id);
  }
  /** The handle `viewer` is shown for `target`, found by the answer only `target` gave. */
  const h = (r, viewer, target) => r.viewFor(viewer).wall.find((p) => p.pick === 'track of ' + target).handle;
  // Ana and Ben meet on SAY HI; both keep, and Ana has said she found him.
  room.arm('ana', 'hi');
  room.arm('ben', 'hi');
  room.wave('ana', h(room, 'ana', 'ben'));
  t += 1000;
  const match = room.wave('ben', h(room, 'ben', 'ana'));
  room.keep('ana', match.id, true);
  room.keep('ben', match.id, true);
  room.found('ana', match.id);
  // Cai waves at Ana, not returned; Dan likes Eve's answer; Eve blocks Cai.
  room.arm('cai', 'hi');
  t += 1000;
  room.wave('cai', h(room, 'cai', 'ana'));
  room.like('dan', h(room, 'dan', 'eve'));
  room.block('eve', h(room, 'eve', 'cai'));
  // Dan reports Ben in his own words, the venue marks it handled, and Dan goes NOT NOW.
  room.report('dan', h(room, 'dan', 'ben'), 'kept following me');
  room.markHandled('r1', true);
  room.setInvisible('dan', true);
  // Cai leaves: the room keeps his rev, and Eve's block.
  room.leave('cai');

  const again = carried(room, now);
  const tag = (id) => 'P-' + id;
  const same = (why) => {
    for (const id of ids) {
      assert.deepEqual(again.viewFor(id), room.viewFor(id), id + "'s view " + why);
      assert.deepEqual(again.wavesAt(id), room.wavesAt(id), id + "'s waves " + why);
    }
    assert.deepEqual(again.staffReports(tag), room.staffReports(tag), "the venue's list " + why);
  };
  same('after the restart');

  // From here the two go on alike: Dan back on SAY HI and a match with Ana, a report, Cai back.
  t += 1000;
  for (const r of [room, again]) {
    r.arm('dan', 'hi');
    r.wave('dan', h(r, 'dan', 'ana'));
    r.wave('ana', h(r, 'ana', 'dan'));
    r.report('ana', null, 'a spill by the stairs');
    r.join('cai');
  }
  same('as the night goes on');
  assert.equal(again.viewFor('dan').matches[0].id, 'm2', 'the next match takes the next id');
  assert.equal(again.staffReports(tag)[0].id, 'r2', 'the next report takes the next id');
  assert.equal(again.viewFor('cai').me.rev, room.viewFor('cai').me.rev, "Cai's rev goes on from his tomb");
});

test('a room carried across a restart drops every clip, and a dance back sent before it still makes the match', () => {
  const room = createRoom();
  for (const id of ['ana', 'ben']) room.join(id);
  room.pick('ben', 'Treasure');
  room.postClip('ana', 'clip-of-ana');
  const [onFloor] = room.viewFor('ben').floor;              // Ana dancing, on Ben's floor
  assert.equal(room.danceBack('ben', onFloor.handle, 'clip-of-ben'), null, 'a yes, not returned yet');
  assert.equal(JSON.stringify(room.dump()).includes('clip-of'), false, 'no clip ref is written');
  const again = carried(room, Date.now);
  assert.equal(again.viewFor('ana').me.clip, null, 'her own clip is gone');
  assert.deepEqual(again.viewFor('ana').floor, [], "Ben's dance to her went with its clip");
  const [ben] = again.viewFor('ana').wall;                   // Ben, by his answer
  const match = again.danceBack('ana', ben.handle, 'clip-of-ana-again');
  assert.equal(match?.intent, 'dance', "Ben's yes from before the restart still counts");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/room.test.js`
Expected: FAIL in the two new tests — `room.dump is not a function`; the other 30 pass.

- [ ] **Step 3: Implement in `relay/room.js`**

Replace the header's last paragraph:

```js
// It holds nothing past the night: a room is a Map in memory, and when the
// relay stops it is gone. Pure and synchronous — no sockets, no clock of its
// own — so the promises can be tested without a network.
```

with:

```js
// It holds nothing past the night: a room is a Map in memory. dump() is how
// the relay writes it to its night file so a restart carries the night on, and
// that file never outlives the night either
// (docs/superpowers/specs/2026-09-29-restart-persistence-design.md). Pure and
// synchronous — no sockets, no clock of its own — so the promises can be
// tested without a network.
```

In `createRoom`'s options, after `firstRev = () => randomInt(2 ** 31) + 1,` add the option, and as the first line of the body take the salt:

```js
  firstRev = () => randomInt(2 ** 31) + 1,
  // A room's dump() from before a restart: the room comes back as it was
  // (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §1).
  restore = null,
} = {}) {
  // Handles come from the salt, so a room carried across a restart keeps the one it had.
  if (restore) salt = restore.salt;
  const people = new Map();   // id -> person
```

After `const marked = new Map();` add:

```js

  if (restore) {
    if (!Number.isInteger(restore.nextReport) || !Number.isInteger(restore.nextMatch)) throw new TypeError('not a room dump');
    for (const p of restore.people) people.set(p.id, { ...p, clip: null });
    for (const [id, ids] of restore.blocks) blocks.set(id, new Set(ids));
    for (const [k, n] of restore.waves) waves.set(k, n);
    for (const [id, n] of restore.latest) latest.set(id, n);
    for (const k of restore.likes) likes.add(k);
    // A dance back comes back as the yes it was; its clip does not.
    for (const k of restore.dances) dances.set(k, null);
    for (const m of restore.matches) matches.set(pairKey(m.a, m.b), m);
    for (const [id, tomb] of restore.tombs) tombs.set(id, tomb);
    reports.push(...restore.reports);
    nextReport = restore.nextReport;
    nextMatch = restore.nextMatch;
  }
```

Before `return {` at the end of `createRoom` add:

```js
  /**
   * What a restart must carry (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §1), as plain data:
   * no clip ref, and nothing a band heard.
   */
  function dump() {
    return {
      salt,
      people: [...people.values()].map((p) => ({ ...p, clip: null })),
      blocks: [...blocks].map(([id, ids]) => [id, [...ids]]),
      waves: [...waves],
      latest: [...latest],
      likes: [...likes],
      dances: [...dances.keys()],
      matches: [...matches.values()],
      tombs: [...tombs],
      reports: reports.slice(),
      nextReport,
      nextMatch,
    };
  }

```

and add `dump` to the returned object's second line:

```js
    wave, wavedAtYou, wavesAt, like, unlike, danceBack, block, report, keep, found, heard, nearTick, viewFor, dump,
```

A dance back restored as `null` needs nothing else: `viewFor()` shows a floor entry only for a truthy ref or a clip, and `danceBack()` and `matchIfMutual()` ask `dances.has()`.

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/room.test.js`
Expected: PASS, 32 tests.

- [ ] **Step 5: Full suite (P2), then commit and push**

```bash
git add relay/room.js tests/room.test.js
git commit -m "A room carries across a restart: dump() and createRoom({ restore })" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: The relay writes the night

**Files:**
- Modify: `relay/server.js`
- Test: `tests/restart.test.js` (new)

**Interfaces:**
- Consumes: `openNight(path)` (Task 1); `room.dump()` (Task 2).
- Produces: `createRelay({ nightFile?: string, saveEveryMs = 1000 })`; the relay object's `save()` → `'off' | 'same' | 'written' | 'removed' | 'failed'`; the file `{ v: 1, at, staffKey, rooms: [{ key, room, heard, sound }], bands: [...], gone: [...], tokens: [...] }` (spec §1). In this task a band's secret is still written as `secret`; Task 6 makes it `secretHash`.

- [ ] **Step 1: Write the failing tests**

Create `tests/restart.test.js`:

```js
// ON THE BEAT — the night carried across a restart
// (docs/superpowers/specs/2026-09-29-restart-persistence-design.md): a relay closed, and a new one on the same
// file. Test passcodes only.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createRelay, WS_PATH, BAND_ALONE_MS } from '../relay/server.js';
import { makeEntry } from '../relay/staff.js';
import { helpers, newKey, pause } from './relay-harness.js';

const TZ = 'Australia/Brisbane';                     // UTC+10, no daylight saving
const NINE_PM = Date.UTC(2026, 8, 29, 11, 0);       // 21:00 on 29 Sep there
const NEXT_MORNING = Date.UTC(2026, 8, 29, 20, 30); // 06:30 on 30 Sep there: the next night
let dir;
let root;
let CODES;
let files = 0;
let addresses = 0;
const nights = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'otb-restart-'));
  root = join(dir, 'dist');                           // served, and empty: the night files sit beside it
  mkdirSync(root);
  CODES = JSON.stringify({ 'restart-staff': await makeEntry('test-passcode-1') });
});

after(async () => {
  for (const n of nights) if (n.open) await n.stop();
  rmSync(dir, { recursive: true, force: true });
});

/** Polls until `pred()` holds, or fails after `ms`. */
async function until(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out');
    await pause(20);
  }
}

/** What `fn` logs while it runs, one string a line. */
async function logged(fn) {
  const said = [];
  const log = console.log;
  console.log = (...a) => { said.push(a.join(' ')); };
  try {
    await fn();
  } finally {
    console.log = log;
  }
  return said;
}

/**
 * A night on a file of its own. `start()` opens a relay on it at the clock's time; `stop()` closes it, which writes
 * the night; `restart()` stops, moves the clock half a minute, as a deploy takes, and starts a new relay on the
 * same file. `on` has the harness's phones and wristbands, on whichever relay is open. Its timer writes once an hour
 * unless asked, so a test's own `save()` calls are the only writes.
 */
function night({ saveEveryMs = 3_600_000, graceMs, file } = {}) {
  const n = { clock: { t: NINE_PM }, file: file ?? join(dir, 'night-' + (files += 1) + '.json'), relay: null, open: false };
  n.on = helpers(() => n.relay.port);
  n.start = async () => {
    n.relay = await createRelay({
      port: 0, host: '127.0.0.1', root, clock: () => n.clock.t, nightTz: TZ, staffCodes: CODES,
      nightFile: n.file, saveEveryMs, ...(graceMs ? { graceMs } : {}),
    });
    n.open = true;
    return n.relay;
  };
  n.stop = async () => {
    await n.relay.close();       // written here, before a socket closes
    n.on.cleanup();
    n.open = false;
  };
  n.restart = async () => {
    await n.stop();
    n.clock.t += 30_000;
    return n.start();
  };
  n.saved = () => JSON.parse(readFileSync(n.file, 'utf8'));
  nights.push(n);
  return n;
}

// ---------- §2: writing ----------

test('the night is written within a second of a change, by itself', async () => {
  const n = night({ saveEveryMs: 50 });
  await n.start();
  await n.on.phone('restart-write');
  await until(() => existsSync(n.file));
  const saved = n.saved();
  assert.deepEqual([saved.v, saved.at], [1, NINE_PM]);
  assert.match(saved.staffKey, /^[a-f0-9]{64}$/);
  assert.deepEqual(saved.rooms.map((r) => r.key), ['restart-write']);
  assert.equal(saved.rooms[0].room.people.length, 1);
});

test('the relay writes nothing while nothing changes', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-idle');
  assert.equal(n.relay.save(), 'written');
  assert.equal(n.relay.save(), 'same', 'nothing changed');
  ana.send({ t: 'pick', track: 'Treasure' });
  await ana.until((v) => v.me.pick === 'Treasure');
  assert.equal(n.relay.save(), 'written', 'a pick is a change');
});

test('once everyone has left, the file is gone', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-empty');
  assert.equal(n.relay.save(), 'written');
  assert.equal(existsSync(n.file), true);
  const left = n.on.reply(ana, 'left');
  ana.send({ t: 'leave' });
  await left;
  assert.equal(n.relay.save(), 'removed');
  assert.equal(existsSync(n.file), false);
});

test('closing the relay writes the night', async () => {
  const n = night();
  await n.start();
  await n.on.phone('restart-close');
  await n.stop();
  assert.deepEqual(n.saved().rooms.map((r) => r.key), ['restart-close']);
});

test('a write that fails is said once, and the relay runs on', async () => {
  const n = night({ file: join(dir, 'no-such-folder', 'night.json') });
  await n.start();
  const ana = await n.on.phone('restart-fail');
  const said = await logged(() => {
    assert.equal(n.relay.save(), 'failed');
    assert.equal(n.relay.save(), 'failed');
  });
  assert.deepEqual(said, ['night: cannot write (ENOENT)']);
  ana.send({ t: 'pick', track: 'Treasure' });
  await ana.until((v) => v.me.pick === 'Treasure');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/restart.test.js`
Expected: FAIL — `n.relay.save is not a function` in three tests, no file after a close (`ENOENT`), and the timer test times out (`timed out`).

- [ ] **Step 3: Implement in `relay/server.js`**

After `import { checkCode, isEntry } from './staff.js';` add:

```js
import { openNight } from './store.js';
```

After `const CODE_MAX = 200;                 // the longest passcode a staff sign-in may carry` add:

```js
const NIGHT_V = 1;                    // the night file's format: a build that cannot read the last one bumps it
```

In `createRelay`'s doc comment, after the `staffCodes` line add:

```js
 * `nightFile` is where the night is kept across a restart, or none: in memory only
 * (docs/superpowers/specs/2026-09-29-restart-persistence-design.md). `saveEveryMs` is how often it is written,
 * when it changed.
```

Change the options' last line:

```js
  clientIpHeader, allClipsMax = ALL_CLIPS_MAX, staffCodes = process.env.STAFF_CODES } = {}) {
```

to:

```js
  clientIpHeader, allClipsMax = ALL_CLIPS_MAX, staffCodes = process.env.STAFF_CODES, nightFile, saveEveryMs = 1000 } = {}) {
```

After `const staffEntries = readStaffCodes(staffCodes);` add:

```js
  // The night's file, if it has one (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §2).
  const store = nightFile ? openNight(nightFile) : null;
```

After the closing `}` of `function expire(at) { … }` and before `return new Promise((resolve) => {`, add:

```js
  // ---------- the night across a restart (docs/superpowers/specs/2026-09-29-restart-persistence-design.md) ----------

  /** What a restart must carry (§1), as plain data: wristbands only with a person, or waiting for one. */
  function dumpNight() {
    return {
      staffKey: staffKey.toString('hex'),
      rooms: [...rooms.values()].map((r) => ({ key: r.key, room: r.room.dump(), heard: [...r.heard], sound: [...r.sound] })),
      bands: [...bands.values()].filter((b) => b.person || b.waiting).map((b) => ({
        id: b.id, old: b.old, key: b.key, person: b.person, secret: b.secret, everWs: b.everWs, live: !!b.ws,
        goneAt: b.goneAt, claimedAt: b.claimedAt, waiting: b.waiting, waitingAt: b.waitingAt, quiet: b.quiet, battery: b.battery,
      })),
      gone: [...gone],
      tokens: [...tokens],
    };
  }

  let lastText = null;   // the night as last written, less its `at`
  let failing = null;    // why the last write failed, said once

  /**
   * The night to its file if it changed since it was last written (§2): with `at` set to now, or removed when the
   * night holds nothing. 'off' with no file, 'same' when nothing changed, 'written', 'removed', or 'failed' —
   * said once, and tried again next time.
   */
  function save() {
    if (!store) return 'off';
    const night = dumpNight();
    const text = JSON.stringify(night);
    if (text === lastText) return 'same';
    const empty = !night.rooms.length && !night.bands.length && !night.tokens.length;
    try {
      if (empty) store.remove();
      else store.write(JSON.stringify({ v: NIGHT_V, at: now(), ...night }));
    } catch (e) {
      const why = e.code || e.name;
      if (failing !== why) console.log('night: cannot write (' + why + ')');
      failing = why;
      return 'failed';
    }
    if (failing) console.log('night: writing again');
    failing = null;
    lastText = text;
    return empty ? 'removed' : 'written';
  }

  // Every saveEveryMs, written if it changed: an idle relay writes nothing.
  const keeper = store ? setInterval(() => save(), saveEveryMs) : null;

```

In the object `server.listen` resolves with, after `roomCount: () => rooms.size,` add:

```js
      /** Writes the night now, as the relay does every saveEveryMs: 'off', 'same', 'written', 'removed' or 'failed'. */
      save,
```

In `close`, after `clearInterval(nearly);` add:

```js
        clearInterval(keeper);
        // Written before a socket closes, so a wristband still worn is written worn (§2).
        save();
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/restart.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Full suite (P2), then commit and push**

```bash
git add relay/server.js tests/restart.test.js
git commit -m "The relay writes the night within a second of a change" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 4: The relay reads the night back: rooms, people, their grace

**Files:**
- Modify: `relay/server.js`
- Test: `tests/restart.test.js` (append)

**Interfaces:**
- Consumes: `createRoom({ restore })` (Task 2); `store`, `save()`, the file (Task 3).
- Produces: at start, `readNight()` (the file if it is tonight's, version 1 and shaped; else removed) and `restoreNight(saved)` (rooms with their people in their grace). Log lines: `night: none at <path>`, `night: from another night, discarded`, `night: unreadable (<error name>), discarded`, `night: carried on from <path> — N rooms, N people`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/restart.test.js`:

```js
// ---------- §2, §3: reading it back ----------

test('a block made before a restart still hides both from each other after it', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-block');
  const ben = await n.on.phone('restart-block');
  ana.send({ t: 'pick', track: 'ana' });
  ben.send({ t: 'pick', track: 'ben' });
  ben.send({ t: 'arm', intent: 'hi' });
  const { near: [row] } = await ana.until((v) => v.near.length === 1);
  ana.send({ t: 'block', handle: row.handle });
  await ana.until((v) => v.near.length === 0);
  await n.restart();
  const anaBack = await n.on.phone('restart-block', { me: ana.me });
  const benBack = await n.on.phone('restart-block', { me: ben.me });
  anaBack.send({ t: 'arm', intent: 'hi' });
  const cai = await n.on.phone('restart-block');
  cai.send({ t: 'pick', track: 'cai' });
  cai.send({ t: 'arm', intent: 'hi' });
  await anaBack.until((v) => v.near.some((p) => p.pick === 'cai'));
  await benBack.until((v) => v.near.some((p) => p.pick === 'cai'));
  assert.deepEqual(anaBack.view.near.map((p) => p.pick), ['cai'], 'Ana sees Cai, and not Ben');
  assert.deepEqual(benBack.view.near.map((p) => p.pick), ['cai'], 'Ben sees Cai, and not Ana');
});

test('a match keeps its id, number and spot across a restart, and a keep after it still shares the contacts', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-match');
  const ben = await n.on.phone('restart-match');
  ana.send({ t: 'profile', name: 'Ana', contact: '@ana' });
  ben.send({ t: 'profile', name: 'Ben', contact: '@ben' });
  for (const p of [ana, ben]) p.send({ t: 'arm', intent: 'hi' });
  const { near: [toBen] } = await ana.until((v) => v.near.length === 1);
  const { near: [toAna] } = await ben.until((v) => v.near.length === 1);
  ana.send({ t: 'wave', handle: toBen.handle });
  ben.send({ t: 'wave', handle: toAna.handle });
  const { matches: [before] } = await ana.until((v) => v.matches.length === 1);
  ana.send({ t: 'keep', match: before.id, on: true });
  await ana.until((v) => v.matches[0].kept);
  await n.restart();
  const anaBack = await n.on.phone('restart-match', { me: ana.me });
  const benBack = await n.on.phone('restart-match', { me: ben.me });
  const [after] = benBack.view.matches;
  assert.deepEqual([after.id, after.number, after.spot, after.name], [before.id, before.number, before.spot, 'Ana']);
  benBack.send({ t: 'keep', match: after.id, on: true });
  await benBack.until((v) => v.matches[0].contact === '@ana');
  await anaBack.until((v) => v.matches[0].contact === '@ben');
});

test('a card on SAY HI is still on after a restart, with nothing sent again', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-card');
  ana.send({ t: 'pick', track: 'ana' });
  ana.send({ t: 'arm', intent: 'hi' });
  const ben = await n.on.phone('restart-card');
  await ben.until((v) => v.near.some((p) => p.pick === 'ana'));
  await n.restart();
  const benBack = await n.on.phone('restart-card', { me: ben.me });
  assert.ok(benBack.view.near.some((p) => p.pick === 'ana'), 'Ana, not back yet, is still on SAY HI');
  const anaBack = await n.on.phone('restart-card', { me: ana.me });
  assert.deepEqual([anaBack.view.me.armed, anaBack.view.me.fresh], ['hi', false], 'her own card, as she left it');
});

test('a file from another night is removed unread, and the relay starts empty', async () => {
  const n = night();
  await n.start();
  await n.on.phone('restart-old');
  await n.stop();
  assert.equal(existsSync(n.file), true, 'written at the close');
  n.clock.t = NEXT_MORNING;
  const said = await logged(() => n.start());
  assert.ok(said.includes('night: from another night, discarded'), said.join('\n'));
  assert.equal(existsSync(n.file), false, 'removed unread');
  assert.equal(n.relay.roomCount(), 0);
});

test('a file that does not parse, of another version, or that cannot be restored is removed, and the relay starts empty', async () => {
  const good = { v: 1, at: NINE_PM, staffKey: 'ab'.repeat(32), rooms: [], bands: [], gone: [], tokens: [] };
  // Every list a room dump has, and no counters.
  const room = { salt: 's', people: [], blocks: [], waves: [], latest: [], likes: [], dances: [], matches: [], tombs: [], reports: [] };
  for (const [text, why] of [
    ['{"v":1,"at":', 'SyntaxError'],
    [JSON.stringify({ ...good, v: 2 }), 'TypeError'],
    [JSON.stringify({ ...good, rooms: [{ key: 'restart-bad', room, heard: [], sound: [] }] }), 'TypeError'],
  ]) {
    const n = night();
    writeFileSync(n.file, text);
    const said = await logged(() => n.start());
    assert.ok(said.includes('night: unreadable (' + why + '), discarded'), text + '\n' + said.join('\n'));
    assert.equal(existsSync(n.file), false, 'removed');
    assert.equal(n.relay.roomCount(), 0, 'started empty');
    await n.stop();
  }
});

test('a person nobody comes back for leaves when the grace runs out', async () => {
  const n = night({ graceMs: 800 });
  await n.start();
  const ana = await n.on.phone('restart-grace');
  const ben = await n.on.phone('restart-grace');
  ana.send({ t: 'pick', track: 'ana' });
  await ben.until((v) => v.wall.some((p) => p.pick === 'ana'));
  await n.restart();
  const benBack = await n.on.phone('restart-grace', { me: ben.me });
  assert.ok(benBack.view.wall.some((p) => p.pick === 'ana'), 'Ana, not back, is in her grace');
  await benBack.until((v) => !v.wall.some((p) => p.pick === 'ana'), 3000);
  assert.equal(n.relay.rooms.get('restart-grace').room.size(), 1, 'Ben alone');
});

test('a restart is logged in counts, never a name, a contact or an id', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-log');
  ana.send({ t: 'profile', name: 'Ana', contact: '@ana' });
  await ana.until((v) => v.me.name === 'Ana');
  const said = await logged(() => n.restart());
  assert.ok(said.some((l) => /^night: carried on from .+ — 1 rooms, 1 people/.test(l)), said.join('\n'));
  for (const secret of [ana.me, 'Ana', '@ana', 'restart-log']) assert.equal(said.join('\n').includes(secret), false, secret + ' was logged');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/restart.test.js`
Expected: the five Task 3 tests pass; the seven new ones FAIL — a restarted relay starts empty: Ben sees Ana again, the match and Ana's card are gone, the old-night and unreadable files are still there, and nothing is logged.

- [ ] **Step 3: Implement in `relay/server.js`**

Take the spots out of `roomFor` into a helper, just above `function roomFor(key) {`:

```js
  /** The quiet corners a venue's show suggests, or the relay's own. */
  function spotsFor(key) {
    const show = shows.find((s) => s.id === key);
    return Array.isArray(show?.spots) && show.spots.length ? show.spots.map(String) : SPOTS;
  }

```

and in `roomFor` replace:

```js
      const show = shows.find((s) => s.id === key);
      const spots = Array.isArray(show?.spots) && show.spots.length ? show.spots.map(String) : SPOTS;
```

with nothing, and `createRoom({ spots, now })` in the `rooms.set(...)` line with `createRoom({ spots: spotsFor(key), now })`.

After the `const store = …` line (Task 3) add:

```js
  const saved = readNight();
```

In the night section (after `dumpNight()`), add:

```js
  /**
   * The night file, if it holds tonight in a form this build reads (§2). Anything else is removed and the relay
   * starts empty: it never refuses to start over the file. What is logged is counts, never a name or an id.
   */
  function readNight() {
    if (!store) return null;
    let saved = null;
    let why = null;
    try {
      const text = store.read();
      if (text === null) { console.log('night: none at ' + store.path); return null; }
      saved = JSON.parse(text);
      const shaped = saved?.v === NIGHT_V && Number.isFinite(saved.at) && /^[a-f0-9]{64}$/.test(saved.staffKey)
        && [saved.rooms, saved.bands, saved.gone, saved.tokens].every(Array.isArray);
      if (!shaped) throw new TypeError('not a night file of version ' + NIGHT_V);
    } catch (e) {
      why = e.name;
    }
    if (!why && nightOf(saved.at, nightTz) !== nightOf(now(), nightTz)) why = 'another night';
    if (!why) return saved;
    console.log(why === 'another night' ? 'night: from another night, discarded' : 'night: unreadable (' + why + '), discarded');
    try { store.remove(); } catch { /* the next write replaces it */ }
    return null;
  }

  /**
   * The night read at start (§2), built whole and only then taken: a file that fails half way leaves nothing
   * behind. No socket is open yet, so everyone starts the usual grace from now.
   */
  function restoreNight(saved) {
    let built;
    try {
      built = {
        rooms: saved.rooms.map((e) => ({
          key: String(e.key), room: createRoom({ spots: spotsFor(e.key), now, restore: e.room }),
          sockets: new Set(), clips: new Map(), left: new Map(), heard: new Map(e.heard), sound: new Map(e.sound), staff: new Set(),
        })),
      };
    } catch (e) {
      console.log('night: unreadable (' + e.name + '), discarded');
      try { store.remove(); } catch { /* the next write replaces it */ }
      return;
    }
    for (const r of built.rooms) rooms.set(r.key, r);
    for (const r of built.rooms) for (const me of r.room.ids()) startGrace(r, me);
    const people = built.rooms.reduce((n, r) => n + r.room.size(), 0);
    console.log('night: carried on from ' + store.path + ' — ' + built.rooms.length + ' rooms, ' + people + ' people');
  }

```

and immediately before `return new Promise((resolve) => {` add:

```js
  if (saved) restoreNight(saved);

```

`readNight` and `restoreNight` are function declarations, so the early call finds them; `restoreNight` runs last, when `bands`, `startGrace()` and everything it touches exist.

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/restart.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Full suite (P2), then commit and push**

```bash
git add relay/server.js tests/restart.test.js
git commit -m "The relay reads the night back at start: rooms, people, their grace" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 5: Wristbands and staff sign-ins across a restart

**Files:**
- Modify: `relay/server.js`
- Test: `tests/restart.test.js` (append)

**Interfaces:**
- Consumes: `readNight()`, `restoreNight()` (Task 4).
- Produces: `staffKey` carried in the file; `restoreNight()` also takes wristband records (a worn one gone from the start), `gone` and staff tokens; the start log `night: carried on from <path> — N rooms, N people, N wristbands, N staff sign-ins`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/restart.test.js`:

```js
// ---------- §3: wristbands and staff ----------

/** A staff page's socket on the night's relay: each answer to a sign-in, and each list it is sent. */
async function staffOn(n) {
  const ws = new WebSocket('ws://127.0.0.1:' + n.relay.port + WS_PATH, { headers: { 'cf-connecting-ip': '203.0.113.' + (1 + (addresses++ % 199)) } });
  const s = { ws, answers: [], lists: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.t === 'staff') s.answers.push(m);
    if (m.t === 'reports') s.lists.push(m.reports);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  s.list = () => s.lists.at(-1);
  s.signIn = async (m) => {
    const was = s.answers.length;
    ws.send(JSON.stringify({ t: 'staff', ...m }));
    await until(() => s.answers.length > was);
    return s.answers.at(-1);
  };
  return s;
}

test('a paired wristband goes straight back to its person after a restart, and a wrong secret is still refused', async () => {
  const n = night();
  await n.start();
  const band = await n.on.wristband(62);
  const ana = await n.on.phone('restart-band');
  const { secret } = await n.on.pairBand(ana, band);
  n.clock.t += 3_000;                                   // past the white flash a new pairing gives
  ana.send({ t: 'arm', intent: 'hi' });
  await band.until((s) => s.kind === 'hi');
  await n.restart();
  const wrong = await n.on.hello({ t: 'wristband', id: band.id, key: band.key, v: 2, battery: 50, secret: newKey() });
  assert.deepEqual([wrong.reply, wrong.closed], [{ t: 'error', why: 'bad band' }, 4001], 'a wrong secret');
  const back = await n.on.wristband(62, { key: band.key, secret });
  assert.equal(back.show.kind, 'hi', 'her card at once: no OPEN YOUR PHONE, no claim');
});

test('a staff token from before a restart signs in after it, to the same reports, marks and tags', async () => {
  const n = night();
  await n.start();
  const s = await staffOn(n);
  const { token } = await s.signIn({ venue: 'restart-staff', code: 'test-passcode-1' });
  const ana = await n.on.phone('restart-staff');
  const ben = await n.on.phone('restart-staff');
  ben.send({ t: 'arm', intent: 'hi' });
  const { near: [row] } = await ana.until((v) => v.near.length === 1);
  ana.send({ t: 'report', handle: row.handle, why: 'kept following me' });
  await until(() => s.list()?.length === 1);
  s.ws.send(JSON.stringify({ t: 'handled', id: s.list()[0].id, on: true }));
  await until(() => s.list()[0].handledAt > 0);
  const before = s.list();
  await n.restart();
  const again = await staffOn(n);
  assert.deepEqual(await again.signIn({ venue: 'restart-staff', token }), { t: 'staff', ok: true, venue: 'restart-staff', token });
  await until(() => again.lists.length === 1);
  assert.deepEqual(again.list(), before, 'the same reports, the same mark, the same tag');
});

test('a wristband that was worn when the relay stopped is kept an hour from the restart', async () => {
  const n = night();
  await n.start();
  const band = await n.on.wristband(62);
  const ana = await n.on.phone('restart-worn');
  const { secret } = await n.on.pairBand(ana, band);
  n.clock.t += 50 * 60_000;                             // worn all along, fifty minutes on
  await n.restart();
  n.relay.expire(n.clock.t + BAND_ALONE_MS - 60_000);   // an hour less a minute after the restart
  const back = await n.on.wristband(62, { key: band.key, secret });
  assert.equal(back.show.kind, 'off', 'still paired to her: not forgotten, not waiting for its owner');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/restart.test.js`
Expected: the twelve earlier tests pass; the three new ones FAIL — the wristband shows `waiting`, the token is answered `expired`.

- [ ] **Step 3: Implement in `relay/server.js`**

Replace:

```js
  // Staff see a reported person as a tag: the same at one venue all night, and nothing like any handle a phone
  // is shown. A restart draws a new key, so new tags.
  const staffKey = randomBytes(32);
```

with:

```js
  // Staff see a reported person as a tag: the same at one venue all night, and nothing like any handle a phone
  // is shown. A night carried across a restart keeps its key, and so its tags.
  const staffKey = saved ? Buffer.from(saved.staffKey, 'hex') : randomBytes(32);
```

Replace the whole of `restoreNight` (Task 4) with:

```js
  /**
   * The night read at start (§2), built whole and only then taken: a file that fails half way leaves nothing
   * behind. No socket is open yet, so everyone starts the usual grace from now, and a wristband that was worn
   * counts as gone from now: it could not reach a relay that was not there.
   */
  function restoreNight(saved) {
    let built;
    try {
      built = {
        rooms: saved.rooms.map((e) => ({
          key: String(e.key), room: createRoom({ spots: spotsFor(e.key), now, restore: e.room }),
          sockets: new Set(), clips: new Map(), left: new Map(), heard: new Map(e.heard), sound: new Map(e.sound), staff: new Set(),
        })),
        bands: saved.bands.map((e) => Object.assign(makeBand(String(e.id), null), {
          old: !!e.old, key: e.key, person: e.person, secret: e.secret, everWs: !!e.everWs,
          goneAt: e.live ? now() : e.goneAt, claimedAt: e.claimedAt, waiting: !!e.waiting, waitingAt: e.waitingAt,
          quiet: !!e.quiet, battery: e.battery,
        })),
        gone: new Map(saved.gone),
        tokens: new Map(saved.tokens),
      };
    } catch (e) {
      console.log('night: unreadable (' + e.name + '), discarded');
      try { store.remove(); } catch { /* the next write replaces it */ }
      return;
    }
    for (const r of built.rooms) rooms.set(r.key, r);
    for (const b of built.bands) bands.set(b.id, b);
    for (const [id, at] of built.gone) gone.set(id, at);
    for (const [hash, t] of built.tokens) tokens.set(hash, t);
    for (const r of built.rooms) for (const me of r.room.ids()) startGrace(r, me);
    const people = built.rooms.reduce((n, r) => n + r.room.size(), 0);
    console.log('night: carried on from ' + store.path + ' — ' + built.rooms.length + ' rooms, ' + people + ' people, '
      + built.bands.length + ' wristbands, ' + built.tokens.size + ' staff sign-ins');
  }
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/restart.test.js`
Expected: PASS, 15 tests.

- [ ] **Step 5: Full suite (P2), then commit and push**

```bash
git add relay/server.js tests/restart.test.js
git commit -m "Wristbands and staff sign-ins carry across a restart" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 6: Phone ids, wristband secrets and staff tokens held only as hashes

**Files:**
- Modify: `relay/server.js`
- Modify: `tests/server.test.js:727-728`, `tests/staff.test.js:172` and both files' import lines
- Test: `tests/restart.test.js` (append; its import line)

**Interfaces:**
- Produces: `export const personOf = (me) => …` — the first 32 hex digits of SHA-256 of the id a phone says, the person it stands for inside the relay. Band records carry `secretHash` instead of `secret`; `tokens` is keyed by a token's SHA-256; the file's bands carry `secretHash`.

- [ ] **Step 1: Write the failing tests for secrets and tokens**

Append to `tests/restart.test.js`:

```js
// ---------- §4: nothing kept lets anyone act as someone else ----------

test('the night file holds no wristband secret', async () => {
  const n = night();
  await n.start();
  const band = await n.on.wristband(62);
  const ana = await n.on.phone('restart-secret');
  const { secret } = await n.on.pairBand(ana, band);
  assert.equal(n.relay.save(), 'written');
  const text = readFileSync(n.file, 'utf8');
  assert.ok(text.includes(band.id), 'the wristband is in it');
  assert.equal(text.includes(secret), false, 'its secret is not');
});

test('the night file holds no staff token', async () => {
  const n = night();
  await n.start();
  const s = await staffOn(n);
  const { token } = await s.signIn({ venue: 'restart-staff', code: 'test-passcode-1' });
  assert.equal(n.relay.save(), 'written');
  const text = readFileSync(n.file, 'utf8');
  assert.equal(JSON.parse(text).tokens.length, 1, 'the sign-in is in it');
  assert.equal(text.includes(token), false, 'its token is not');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/restart.test.js`
Expected: the two new tests FAIL — `its secret is not`, `its token is not`; the other 15 pass.

- [ ] **Step 3: Hash wristband secrets and staff tokens in `relay/server.js`**

After `export const bandIdOf = (key) => …;` add:

```js
// Three things are enough to act as someone: a phone's id, a wristband's secret, a staff token. The relay holds
// each only as its SHA-256, in memory and in the night file
// (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §4).
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const secretHashOf = (secret) => sha256(secret);
const tokenHashOf = (token) => sha256(token);
```

In `makeBand`, replace `secret: null, pending: null,      // pending: …` with:

```js
    secretHash: null, pending: null,  // secretHash: of the secret given at YES; pending: { key, person, number, until } while a pairing waits for YES
```

In `freshLetters`, replace `secret: null` with `secretHash: null`.

In `hello`, after `const secret = HEX32.test(String(m.secret || '')) ? String(m.secret) : null;` add:

```js
    const proof = secret && secretHashOf(secret);
```

and replace `secret !== b.secret` with `proof !== b.secretHash` in both lines that test it (`if (b?.person && b.everWs && …)` and `if (b?.person && !b.everWs && …)`), and `Object.assign(b, { waiting: true, secret, waitingAt: now() })` with `Object.assign(b, { waiting: true, secretHash: proof, waitingAt: now() })`.

In `confirm`, replace:

```js
    Object.assign(b, { pending: null, code: null, key: r.key, person: me, secret: randomBytes(16).toString('hex') });
    // Paired: it flashes white once, so the right wrist knows it was the one.
    b.testUntil = now() + 900;
    b.ws.send(JSON.stringify({ t: 'paired', secret: b.secret }));
    toPerson(r, me, { t: 'paired', band: b.id, secret: b.secret });
```

with:

```js
    const secret = randomBytes(16).toString('hex');
    Object.assign(b, { pending: null, code: null, key: r.key, person: me, secretHash: secretHashOf(secret) });
    // Paired: it flashes white once, so the right wrist knows it was the one.
    b.testUntil = now() + 900;
    // The secret itself goes out once, to the wrist and to the phone; the relay keeps its hash.
    b.ws.send(JSON.stringify({ t: 'paired', secret }));
    toPerson(r, me, { t: 'paired', band: b.id, secret });
```

In `claim`, replace `const proven = HEX32.test(secret) && b?.secret === secret;` with:

```js
    const proven = HEX32.test(secret) && b?.secretHash === secretHashOf(secret);
```

and `bands.set(id, Object.assign(makeBand(id, null), { key: r.key, person: me, secret }));` with:

```js
    bands.set(id, Object.assign(makeBand(id, null), { key: r.key, person: me, secretHash: secretHashOf(secret) }));
```

Replace the tokens comment `// Staff signed in with a right passcode tonight: token -> { key, night }. Good until the venue's 06:00.` with:

```js
  // Staff signed in with a right passcode tonight: a token's hash -> { key, night }. Good until the venue's 06:00.
```

In `staffIn`, replace `const t = tokens.get(m.token);` with `const t = tokens.get(tokenHashOf(m.token));` and `tokens.set(token, { key, night });` with `tokens.set(tokenHashOf(token), { key, night });`.

In `dumpNight`, replace `secret: b.secret,` with `secretHash: b.secretHash,`; in `restoreNight`, replace `secret: e.secret,` with `secretHash: e.secretHash,`.

Check nothing else reads a band's secret: `grep -n "\.secret\b\|secret:" relay/server.js` shows only the `paired` messages, `m.secret` and the hashes.

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/restart.test.js tests/wristband.test.js tests/staff.test.js`
Expected: PASS — every pairing, claim, hello, waiting and token test still green; the two new ones pass.

- [ ] **Step 5: Write the failing test for phone ids**

Change the server import at the top of `tests/restart.test.js` to:

```js
import { createRelay, personOf, WS_PATH, BAND_ALONE_MS } from '../relay/server.js';
```

and append:

```js
test('the night file holds no phone id as a phone says it: the room holds personOf(me) instead', async () => {
  const n = night();
  await n.start();
  const ana = await n.on.phone('restart-ids');
  const room = () => n.relay.rooms.get('restart-ids').room;
  assert.equal(room().has(personOf(ana.me)), true, 'her person');
  assert.equal(room().has(ana.me), false, 'never her id');
  assert.equal(n.relay.save(), 'written');
  assert.equal(readFileSync(n.file, 'utf8').includes(ana.me), false, 'her id is not in the file');
  await n.restart();
  await n.on.phone('restart-ids', { me: ana.me });
  assert.equal(room().size(), 1, 'back with the same id, the same person');
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `node --test tests/restart.test.js`
Expected: FAIL for the whole file — `The requested module '../relay/server.js' does not provide an export named 'personOf'`.

- [ ] **Step 7: Hold person ids as hashes**

In `relay/server.js`, after `const sha256 = …` add:

```js
/** The person a phone's id stands for inside the relay: the id itself never goes further than the join. */
export const personOf = (me) => sha256(me).slice(0, 32);
```

In `handle`, replace:

```js
      const key = venueKey(m.venue);
      const me = String(m.me || '');
      if (!key || !/^[a-f0-9]{16,64}$/.test(me)) { ws.send(JSON.stringify({ t: 'error', why: 'bad join' })); return; }
```

with:

```js
      const key = venueKey(m.venue);
      const said = String(m.me || '');
      if (!key || !/^[a-f0-9]{16,64}$/.test(said)) { ws.send(JSON.stringify({ t: 'error', why: 'bad join' })); return; }
      // Its hash from here on: the id a phone says is what makes it that person (restart spec §4).
      const me = personOf(said);
```

In `tests/server.test.js`, add `personOf` to the server import and change lines 727–728 to:

```js
  assert.ok(!relay.rooms.get(venueKey('orphan-from')).room.has(personOf(ben.me)));
  assert.ok(relay.rooms.get(venueKey('orphan-to')).room.has(personOf(ben.me)), 'and is in the second');
```

In `tests/staff.test.js`, add `personOf` to the server import and change line 172 to:

```js
  assert.equal(relay.rooms.get('staff-venue').room.has(personOf(me)), false, 'no person made');
```

- [ ] **Step 8: Run them to see them pass**

Run: `node --test tests/restart.test.js tests/server.test.js tests/staff.test.js`
Expected: PASS.

- [ ] **Step 9: Full suite (P2), then commit and push**

```bash
git add relay/server.js tests/restart.test.js tests/server.test.js tests/staff.test.js
git commit -m "Phone ids, wristband secrets and staff tokens are held only as hashes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 7: Fly stops the relay with the night written: SIGINT, the volume, the image

**Files:**
- Modify: `relay/server.js` (the command-line block at the end)
- Modify: `fly.toml`, `Dockerfile`
- Test: `tests/restart.test.js` (append), `tests/deploy.test.js` (new)

**Interfaces:**
- Consumes: `save()` (Task 3).
- Produces: on SIGINT or SIGTERM the command line logs `night: written on stop` (or `nothing to keep on stop`, or `not written on stop`) and exits 0 within 3 s; `night: in memory only` when `NIGHT_FILE` is unset; `PORT=0` means any free port.

- [ ] **Step 1: Write the failing tests**

Append to `tests/restart.test.js`:

```js
// ---------- §2: the command line ----------

test('the command line writes the night on SIGINT, and exits', { skip: process.platform === 'win32' && 'Windows cannot send a child process SIGINT' }, async () => {
  const file = join(dir, 'cli.json');
  const child = spawn(process.execPath, [fileURLToPath(new URL('../relay/server.js', import.meta.url))], {
    env: { ...process.env, PORT: '0', NIGHT_FILE: file }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  try {
    await until(() => /relay on http:\/\/localhost:\d+\//.test(out), 10_000);
    assert.match(out, /night: none at /);
    const port = Number(out.match(/localhost:(\d+)\//)[1]);
    const ws = new WebSocket('ws://127.0.0.1:' + port + WS_PATH);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const viewed = new Promise((resolve) => ws.on('message', (d) => { if (JSON.parse(String(d)).t === 'view') resolve(); }));
    ws.send(JSON.stringify({ t: 'join', venue: 'cli-night', me: randomBytes(16).toString('hex') }));
    await viewed;
    child.kill('SIGINT');
    assert.equal(await exited, 0);
    assert.match(out, /night: written on stop/);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).rooms.map((r) => r.key), ['cli-night']);
  } finally {
    child.kill();
  }
});
```

Create `tests/deploy.test.js`:

```js
// ON THE BEAT — what Fly is told (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §5, §6): the
// night's file on the one volume, no snapshots, and an image that gives the volume to `node` before it runs the
// relay as `node`. Nothing else can see these: a mistake here fails quietly on the machine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fly = readFileSync(new URL('../fly.toml', import.meta.url), 'utf8');
const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

test('fly.toml keeps the night on a volume at /data, with no snapshots', () => {
  assert.match(fly, /^\s*NIGHT_FILE = "\/data\/night\.json"$/m);
  const mounts = fly.split(/^\[mounts\]$/m)[1]?.split(/^\[/m)[0] ?? '';
  assert.match(mounts, /^\s*source = "night"$/m);
  assert.match(mounts, /^\s*destination = "\/data"$/m);
  assert.match(mounts, /^\s*scheduled_snapshots = false$/m, 'nothing of a night kept past it on Fly');
});

test('the image hands /data to node, then runs the relay as node', () => {
  const last = docker.split(/^FROM /m).at(-1);
  assert.doesNotMatch(last, /^USER /m, 'it starts as root, only to give /data over');
  assert.match(last, /^RUN setpriv --reuid=node --regid=node --init-groups id -un \| grep -qx node$/m, 'the build proves setpriv');
  assert.match(last, /^CMD \["sh", "-c", "chown node:node \/data 2>\/dev\/null; exec setpriv --reuid=node --regid=node --init-groups node relay\/server\.js"\]$/m);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/deploy.test.js`
Expected: FAIL, both tests (no `NIGHT_FILE`, `USER node` present). The SIGINT test runs only on Linux: in CI it fails (no `night: none` without `NIGHT_FILE` passed by the command line, no stop handler); on Windows it is skipped.

- [ ] **Step 3: The command line**

Replace the block at the end of `relay/server.js`:

```js
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const relay = await createRelay({
    port: Number(process.env.PORT) || 8790,
    nightTz: process.env.NIGHT_TZ || undefined,
    clientIpHeader: process.env.CLIENT_IP_HEADER ? process.env.CLIENT_IP_HEADER.toLowerCase() : undefined,
  });
  console.log('ON THE BEAT relay on http://localhost:' + relay.port + '/');
}
```

with:

```js
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  // The night's file: NIGHT_FILE, on Fly /data/night.json (fly.toml); without it, the night is in memory only.
  const nightFile = process.env.NIGHT_FILE || undefined;
  if (!nightFile) console.log('night: in memory only');
  const relay = await createRelay({
    // A number, 0 included (any free port); 8790 when unset.
    port: /^\d+$/.test(process.env.PORT ?? '') ? Number(process.env.PORT) : 8790,
    nightTz: process.env.NIGHT_TZ || undefined,
    clientIpHeader: process.env.CLIENT_IP_HEADER ? process.env.CLIENT_IP_HEADER.toLowerCase() : undefined,
    nightFile,
  });
  console.log('ON THE BEAT relay on http://localhost:' + relay.port + '/');
  // Fly stops the machine with SIGINT on a deploy or a restart, and allows 5 s: the night is written before a
  // socket closes, and the process is gone within 3 s whatever the sockets do
  // (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §2).
  const stop = () => {
    const how = relay.save();
    if (how === 'written' || how === 'same') console.log('night: written on stop');
    if (how === 'removed') console.log('night: nothing to keep on stop');
    if (how === 'failed') console.log('night: not written on stop');
    setTimeout(() => process.exit(0), 3000).unref();
    relay.close().then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
```

- [ ] **Step 4: fly.toml**

Replace its header comment:

```toml
# ON THE BEAT — the relay on Fly.io: one machine, always on, in Sydney.
#
# Exactly one machine: every room lives in its memory, so a second machine
# would split the phones from their wristbands. Deploy with --ha=false.
```

with:

```toml
# ON THE BEAT — the relay on Fly.io: one machine, always on, in Sydney.
#
# Exactly one machine: every room lives in its memory, so a second machine
# would split the phones from their wristbands. Deploy with --ha=false. The
# night is also written to the machine's one volume, so a deploy or a restart
# carries it on (docs/superpowers/specs/2026-09-29-restart-persistence-design.md),
# and a machine with a volume is never given a second.
```

At the end of `[env]`, after `CLIENT_IP_HEADER = "fly-client-ip"`, add:

```toml
  # The night, written within a second of a change and read back at start.
  NIGHT_FILE = "/data/night.json"

# One 1 GB volume, made once: flyctl volumes create night -r syd -s 1 --scheduled-snapshots=false
# No snapshots: nothing of a night is kept past it, and last night's file is no use tonight.
[mounts]
  source = "night"
  destination = "/data"
  scheduled_snapshots = false
```

- [ ] **Step 5: Dockerfile**

In the last stage replace:

```dockerfile
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "relay/server.js"]
```

with:

```dockerfile
COPY --from=build /app/dist ./dist
# The night's file is on the volume at /data (fly.toml), which Fly mounts owned by root. So the machine starts as
# root only to give /data to `node`, then runs the relay as `node`, with exec so Fly's stop signal reaches Node.
# The build makes the same setpriv call: a missing or refused setpriv fails the build, never the machine.
RUN setpriv --reuid=node --regid=node --init-groups id -un | grep -qx node
EXPOSE 8080
CMD ["sh", "-c", "chown node:node /data 2>/dev/null; exec setpriv --reuid=node --regid=node --init-groups node relay/server.js"]
```

`setpriv` is `/usr/bin/setpriv` in Debian's `util-linux`, and `node:24-slim` is `debian:trixie-slim` with the user `node` as uid 1000 (checked 29 Sep 2026). With no volume (a local `docker run`), `chown` fails quietly and `NIGHT_FILE` is unset: the relay runs in memory only.

- [ ] **Step 6: Run them to see them pass**

Run: `node --test tests/deploy.test.js tests/restart.test.js`
Expected: PASS (on Windows the SIGINT test is reported skipped). Then run `PORT=0 node relay/server.js` with Bash `run_in_background`: its output starts `night: in memory only`, then `ON THE BEAT relay on http://localhost:<port>/`. Stop it with TaskStop.

- [ ] **Step 7: Full suite (P2), then commit and push**

```bash
git add relay/server.js fly.toml Dockerfile tests/restart.test.js tests/deploy.test.js
git commit -m "Fly stops the relay with the night written: SIGINT, the volume, the image" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

After the push, check CI ran the SIGINT test on Linux and it passed: `gh run list --limit 1`, then `gh run view <id> --log | grep -n "SIGINT"`.

---

### Task 8: README and comments say what the relay does now

**Files:**
- Modify: `README.md` (*Always on*, *How it is built*, *The staff page*, *The wristband*, *Abuse resistance*, *What is not done*)
- Modify: `app/lib/net.js` (header comment)

**Interfaces:** none (words only).

- [ ] **Step 1: README, *Always on***

Replace:

```markdown
- **Exactly one machine.** Every room lives in the relay's memory, so a second
  machine would split phones from their wristbands. `--ha=false` keeps a
  deploy from starting two; `flyctl scale count 1` puts it back if it ever does.
- **A deploy is a restart.** Rooms, pairings and clips go with the old
  process, and phones and wristbands come back as after any restart: a
  wristband waits with `OPEN YOUR PHONE` until its phone claims it back.
  Deploy between nights.
```

with:

```markdown
- **Exactly one machine, and one volume.** Every room lives in the relay's
  memory, so a second machine would split phones from their wristbands.
  `--ha=false` keeps a deploy from starting two, and a machine with a volume
  is never given a second; `flyctl scale count 1` puts it back if it ever is.
- **A deploy carries the night on.** The relay writes the night to
  `/data/night.json` on the machine's volume within a second of any change,
  and once more when Fly stops it; the new process reads it back. People keep
  their rooms, cards, handles, blocks and matches; staff stay signed in with
  tonight's reports and tags; a wristband goes straight back to its person.
  The clips on the floor do not survive it, nor a pairing waiting for YES.
  The file never holds a phone's id, a wristband's secret or a staff token,
  only their SHA-256; a file from another night is removed unread, and the
  file goes once the night holds nothing. The log says `night: carried on
  from /data/night.json — …` in counts.
- **The volume.** One, made once:
  `flyctl volumes create night -r syd -s 1 --scheduled-snapshots=false`
  (1 GB, about US$0.15 a month). No snapshots: nothing of a night is kept
  past it on Fly's side. A volume is tied to one host: if that drive fails,
  the machine cannot start anywhere else — make a new volume the same way and
  deploy, and the night starts empty.
```

- [ ] **Step 2: README, *How it is built***

Replace `  The night is held in memory only; stop the relay and it is gone.` with:

```markdown
  The night is held in memory and, with `NIGHT_FILE` set (on Fly), written
  to that file so a restart carries it on (*Always on*, above); without it,
  stop the relay and the night is gone.
```

and, in the `lib/net.js` bullet below it, the line

```markdown
    card, NOT NOW, pick), because the relay may have restarted and forgotten.
```

with:

```markdown
    card, NOT NOW, pick), because the relay may have restarted without its
    night.
```

- [ ] **Step 3: README, *The staff page***

Replace:

```markdown
  sees them; at 06:00 they go. A restart or a deploy empties them, as it
  empties rooms, and signs every staff page out.
```

with:

```markdown
  sees them; at 06:00 they go. A restart or a deploy keeps them, and keeps
  every staff page signed in: the page signs back in with its token.
```

- [ ] **Step 4: README, *The wristband***

Replace:

```markdown
- **After a relay restart** the wristband comes back with its secret and waits
  for its owner — `OPEN YOUR PHONE` / `OR SWITCH ME OFF`, no letters — until
  the phone's claim with the same secret pairs it again; a hold meanwhile is
  applied then.
```

with:

```markdown
- **After a relay restart** the wristband comes back with its secret and goes
  straight back to its person: the relay carried its record across (*Always
  on*). A relay that comes back without its night — no file, or one another
  build cannot read — does not know the secret, and the wristband waits for
  its owner — `OPEN YOUR PHONE` / `OR SWITCH ME OFF`, no letters — until the
  phone's claim with the same secret pairs it again; a hold meanwhile is
  applied then.
```

- [ ] **Step 5: README, *Abuse resistance***

After the bullet that begins `- **Malformed and hostile frames.**` and ends `leaves the relay serving and still forming rooms (\`tests/server.test.js\`).`, add:

```markdown
- **Reading the night's file.** Whoever reads `/data/night.json` finds no
  phone's id, no wristband's secret and no staff token, only their SHA-256:
  it signs nobody in, takes no wristband and joins no room. It still holds
  names, contacts and reporters' words, as the relay's memory does; it is
  written readable by its owner only, is removed once the night holds
  nothing, is never read on another night, and Fly keeps no snapshot of it
  (`tests/restart.test.js`, `tests/deploy.test.js`).
```

and in the paragraph after the list, change `` `tests/rules.test.js`, `tests/relay-roots.test.js` or the wrist's table of`` to `` `tests/rules.test.js`, `tests/relay-roots.test.js`, `tests/restart.test.js` or the wrist's table of`` (keep the line breaks as they fall).

- [ ] **Step 6: README, *What is not done***

Replace:

```markdown
- **One machine, and its memory is everything.** The relay has a fixed
  address now, https://on-the-beat.fly.dev, but every room, pairing and clip
  lives in one machine's memory: a deploy or any restart empties it, and
  everyone finds their way back as after any restart. More people than one
  small machine holds, or a restart nobody notices, needs the rooms kept
  outside the process first. A phone that used a tunnel address starts over
  at the fixed one: a browser keeps the app's storage per address.
```

with:

```markdown
- **One machine and one volume.** The relay has a fixed address,
  https://on-the-beat.fly.dev, and a restart carries the night on through a
  file on the machine's own volume, but it is still one small machine: more
  people than it holds needs more than one, and one volume means a failed
  drive takes the relay down until a new volume is made (*Always on*). Clips
  are not carried across a restart. A wristband still worn past 06:00 keeps
  its venue's room, and so last night's matches, in memory and in the file,
  until it is switched off. A phone that used a tunnel address starts over at
  the fixed one: a browser keeps the app's storage per address.
```

- [ ] **Step 7: `app/lib/net.js`**

Replace its first two comment lines after `// The phone's line to its room.` and the blank comment line:

```js
// The relay forgets everything when it restarts, and a person who has been
// gone longer than its grace period is taken out of the room. So on every
```

with (the next line, `// join the phone says again who it is …`, stays as it is):

```js
// The relay carries the night across a restart, but it can come back without
// it (its file lost, or one a new build cannot read), and a person who has
// been gone longer than its grace period is taken out of the room. So on every
```

- [ ] **Step 8: Check, full suite (P2), commit and push**

Run: `grep -n "memory only\|empties them\|forgets everything" README.md app/lib/net.js relay/room.js` — expected: nothing that says a restart empties the night, apart from the local `npm start` case (*How it is built*).

```bash
git add README.md app/lib/net.js
git commit -m "README: the night across a restart" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 9: Every guard holds a test (P1)

**Files:**
- Create (scratchpad only): `mutate.mjs` (P1), `mutations.json` (below)
- Modify: this plan (the result, below)

- [ ] **Step 1: Write `mutations.json` in the scratchpad**

```json
[
  { "label": "no night check at start", "file": "relay/server.js",
    "from": "    if (!why && nightOf(saved.at, nightTz) !== nightOf(now(), nightTz)) why = 'another night';",
    "to": "    if (false) why = 'another night';",
    "test": "tests/restart.test.js", "expect": ["a file from another night is removed unread"] },
  { "label": "no version check", "file": "relay/server.js",
    "from": "saved?.v === NIGHT_V && ", "to": "",
    "test": "tests/restart.test.js", "expect": ["a file that does not parse, of another version, or that cannot be restored"] },
  { "label": "a room dump without its counters is taken", "file": "relay/room.js",
    "from": "    if (!Number.isInteger(restore.nextReport) || !Number.isInteger(restore.nextMatch)) throw new TypeError('not a room dump');\n",
    "to": "",
    "test": "tests/restart.test.js", "expect": ["a file that does not parse, of another version, or that cannot be restored"] },
  { "label": "blocks left out of the dump (room)", "file": "relay/room.js",
    "from": "      blocks: [...blocks].map(([id, ids]) => [id, [...ids]]),", "to": "      blocks: [],",
    "test": "tests/room.test.js", "expect": ["a room carried across a restart shows everyone what it did"] },
  { "label": "blocks left out of the dump (relay)", "file": "relay/room.js",
    "from": "      blocks: [...blocks].map(([id, ids]) => [id, [...ids]]),", "to": "      blocks: [],",
    "test": "tests/restart.test.js", "expect": ["a block made before a restart still hides both from each other"] },
  { "label": "the salt not carried", "file": "relay/room.js",
    "from": "  if (restore) salt = restore.salt;\n", "to": "",
    "test": "tests/room.test.js", "expect": ["a room carried across a restart shows everyone what it did"] },
  { "label": "a dance back not carried as a yes", "file": "relay/room.js",
    "from": "    for (const k of restore.dances) dances.set(k, null);\n", "to": "",
    "test": "tests/room.test.js", "expect": ["a room carried across a restart drops every clip"] },
  { "label": "written even when nothing changed", "file": "relay/server.js",
    "from": "    if (text === lastText) return 'same';\n", "to": "",
    "test": "tests/restart.test.js", "expect": ["the relay writes nothing while nothing changes"] },
  { "label": "an empty night still written", "file": "relay/server.js",
    "from": "    const empty = !night.rooms.length && !night.bands.length && !night.tokens.length;",
    "to": "    const empty = false;",
    "test": "tests/restart.test.js", "expect": ["once everyone has left, the file is gone"] },
  { "label": "a failed write said every time", "file": "relay/server.js",
    "from": "      if (failing !== why) console.log('night: cannot write (' + why + ')');",
    "to": "      console.log('night: cannot write (' + why + ')');",
    "test": "tests/restart.test.js", "expect": ["a write that fails is said once"] },
  { "label": "no grace for the people carried", "file": "relay/server.js",
    "from": "    for (const r of built.rooms) for (const me of r.room.ids()) startGrace(r, me);\n", "to": "",
    "test": "tests/restart.test.js", "expect": ["a person nobody comes back for leaves when the grace runs out"] },
  { "label": "a worn band keeps its old goneAt", "file": "relay/server.js",
    "from": "goneAt: e.live ? now() : e.goneAt,", "to": "goneAt: e.goneAt,",
    "test": "tests/restart.test.js", "expect": ["a wristband that was worn when the relay stopped"] },
  { "label": "a new staff key at every start", "file": "relay/server.js",
    "from": "  const staffKey = saved ? Buffer.from(saved.staffKey, 'hex') : randomBytes(32);",
    "to": "  const staffKey = randomBytes(32);",
    "test": "tests/restart.test.js", "expect": ["a staff token from before a restart signs in after it"] },
  { "label": "phone ids held as said", "file": "relay/server.js",
    "from": "export const personOf = (me) => sha256(me).slice(0, 32);", "to": "export const personOf = (me) => me;",
    "test": "tests/restart.test.js", "expect": ["the night file holds no phone id"] },
  { "label": "band secrets held as given", "file": "relay/server.js",
    "from": "const secretHashOf = (secret) => sha256(secret);", "to": "const secretHashOf = (secret) => secret;",
    "test": "tests/restart.test.js", "expect": ["the night file holds no wristband secret"] },
  { "label": "staff tokens held as given", "file": "relay/server.js",
    "from": "const tokenHashOf = (token) => sha256(token);", "to": "const tokenHashOf = (token) => token;",
    "test": "tests/restart.test.js", "expect": ["the night file holds no staff token"] },
  { "label": "remove() leaves a .tmp", "file": "relay/store.js",
    "from": "      rmSync(tmp, { force: true });\n", "to": "",
    "test": "tests/store.test.js", "expect": ["remove() takes the file and any .tmp with it"] }
]
```

- [ ] **Step 2: Run P1 in the background**

Run: `node <scratchpad>/mutate.mjs <scratchpad>/mutations.json` (Bash, `run_in_background`).
Expected: seventeen `OK` lines and `ALL MUTATIONS HELD`. A mutation whose red set differs is investigated, never waved through: either the test does not guard what it says (fix the test), or another test also stands on the guard (name it in `expect` and say why here).

- [ ] **Step 3: Record the result here, commit and push**

Under this step, write the run's date, `ALL MUTATIONS HELD` and any `expect` that had to change, with why.

**Run on 29 Sep 2026, at `f52b11b`: `ALL MUTATIONS HELD`.** Seventeen of seventeen: each mutation turned exactly its one test red (`fail 1`), every file was restored byte for byte, and each file was green again after. No `expect` had to change.

```bash
git add docs/superpowers/plans/2026-09-29-restart-persistence.md
git commit -m "Plan: every guard of the night across a restart holds a test" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 10: The switch on Fly, with his yes

**Files:**
- Create (scratchpad only): `live-restart.mjs` (below)
- Modify: memory files `fly-relay.md`, `work-queue.md` and `MEMORY.md` (`C:\Users\LewisDong\.claude\projects\C--Users-LewisDong-Documents-on-the-beat\memory\`)

- [ ] **Step 1: Ask him**

With AskUserQuestion, in Chinese: create the volume `night` (1 GB in `syd`, about US$0.15 a month, no snapshots) and deploy now? Say that this deploy replaces the machine (flyctl destroys the volume-less one and starts a new one on the volume), so the relay is down for about a minute and starts empty this once, and that he must not have a demo on. Only a clear yes goes on. If `"$F" auth whoami` (with `F` the flyctl path in *Global Constraints*) says he is not logged in, he runs `flyctl auth login` in his own terminal first.

- [ ] **Step 2: Create the volume**

```bash
F="$LOCALAPPDATA/Microsoft/WinGet/Packages/Fly-io.flyctl_Microsoft.Winget.Source_8wekyb3d8bbwe/flyctl.exe"
"$F" volumes create --help | grep -i snapshot
"$F" volumes create night -r syd -s 1 --scheduled-snapshots=false -a on-the-beat --yes
"$F" volumes list -a on-the-beat
```

Expected: one volume `night`, 1 GB, `syd`, not attached. If the help shows another spelling for turning snapshots off, use that one and correct this step and the README in the same commit as the next change.

- [ ] **Step 3: Deploy**

From the repository root: `"$F" deploy --ha=false --remote-only` (Bash, `run_in_background`; it takes a few minutes). The build log must show the `setpriv` step passing; a failed build replaces nothing.

- [ ] **Step 4: Check what is running**

```bash
"$F" machine list -a on-the-beat
"$F" volumes list -a on-the-beat
"$F" volumes show <volume id from the list> -a on-the-beat
"$F" logs -a on-the-beat --no-tail | grep "night:"
```

Expected: exactly one machine (a new id), the volume attached to it, no scheduled snapshots, and `night: none at /data/night.json`.

- [ ] **Step 5: The live check**

Save as `live-restart.mjs` in the scratchpad:

```js
// Live check of the night across a restart (docs/superpowers/plans/2026-09-29-restart-persistence.md, Task 10),
// against the Fly relay, in a throwaway venue, with three stand-in phones and a stand-in wristband (its own key,
// never a real band). It pairs, matches and blocks, says READY, waits for the relay to restart, then checks the
// wristband is straight back, the match is there and the block holds, and tidies up. It never prints an id or a secret.
// Usage: node live-restart.mjs
import { createHash, randomBytes } from 'node:crypto';

const WS_URL = 'wss://on-the-beat.fly.dev/api/ws';
const hex = (n) => randomBytes(n).toString('hex');
const bandIdOf = (key) => createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex').slice(0, 32);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** A socket that keeps the last message of each kind, and waits for one that fits. */
function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const s = { ws, last: {}, waiters: [], closed: false };
    const wake = () => { s.waiters = s.waiters.filter((w) => !w()); };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); s.last[m.t] = m; wake(); };
    ws.onclose = () => { s.closed = true; wake(); };
    ws.onopen = () => resolve(s);
    ws.onerror = () => reject(new Error('no socket'));
    s.send = (m) => ws.send(JSON.stringify(m));
    s.until = (pred, ms = 10_000) => new Promise((ok, no) => {
      const check = () => { if (pred(s.last, s)) { clearTimeout(timer); ok(s.last); return true; } return false; };
      const timer = setTimeout(() => no(new Error('timed out')), ms);
      if (!check()) s.waiters.push(check);
    });
  });
}
const phone = async (venue, me) => { const p = await open(); p.send({ t: 'join', venue, me }); await p.until((l) => l.view); return p; };
const band = async (key, secret) => {
  const b = await open();
  b.send({ t: 'wristband', id: bandIdOf(key), key, v: 2, battery: 80, ...(secret ? { secret } : {}) });
  await b.until((l) => l.show);
  return b;
};
const near = (p, pick) => p.last.view?.view.near.find((x) => x.pick === pick);
const results = [];
const check = (ok, what) => { results.push(ok); console.log((ok ? 'OK   ' : 'FAIL ') + what); };

// Before: a stand-in wristband paired to Ana; Ana and Ben matched; Cai blocked by Ana.
const venue = 'restart-check-' + hex(3);
const me = { ana: hex(16), ben: hex(16), cai: hex(16) };
const key = hex(16);
const wrist = await band(key);
await wrist.until((l) => l.show.show.kind === 'pairing');
const p = {};
for (const name of Object.keys(me)) p[name] = await phone(venue, me[name]);
p.ana.send({ t: 'pair', code: wrist.last.show.show.code });
await p.ana.until((l) => l.view.view.me.check);
const paired = p.ana.until((l) => l.paired);
p.ana.send({ t: 'confirm', yes: true });
const { secret } = (await paired).paired;
for (const name of Object.keys(me)) {
  p[name].send({ t: 'pick', track: name });
  p[name].send({ t: 'arm', intent: 'hi' });
}
await p.ana.until(() => near(p.ana, 'ben') && near(p.ana, 'cai'));
await p.ben.until(() => near(p.ben, 'ana'));
p.ana.send({ t: 'block', handle: near(p.ana, 'cai').handle });
p.ana.send({ t: 'wave', handle: near(p.ana, 'ben').handle });
p.ben.send({ t: 'wave', handle: near(p.ben, 'ana').handle });
await p.ana.until((l) => l.view.view.matches.length === 1);
const match = p.ana.last.view.view.matches[0];
console.log('READY: paired, matched and blocked in a throwaway venue. Restart the machine now.');

// The restart closes every socket; then the relay comes back.
await wrist.until((l, s) => s.closed, 10 * 60_000);
console.log('sockets closed by the restart; waiting for the relay');
let anaBack = null;
for (let i = 0; i < 60 && !anaBack; i += 1) {
  try { anaBack = await phone(venue, me.ana); } catch { await pause(2000); }
}
if (!anaBack) { console.log('FAIL the relay did not come back in two minutes'); process.exit(1); }

const wristBack = await band(key, secret);
const kind = wristBack.last.show.show.kind;
check(kind !== 'waiting' && kind !== 'pairing', 'the wristband went straight back to its person (' + kind + ')');
const kept = anaBack.last.view.view.matches[0];
check(kept?.id === match.id && kept?.number === match.number, 'the match is there, with its id and number');
const benBack = await phone(venue, me.ben);
const caiBack = await phone(venue, me.cai);
await anaBack.until(() => near(anaBack, 'ben'));
check(!near(anaBack, 'cai'), 'the block holds: Ana does not see Cai');
check(anaBack.last.view.view.me.armed === 'hi', "Ana's card is still on");

// Tidy up: the stand-in wristband unpaired, and everyone gone.
anaBack.send({ t: 'unpair' });
for (const s of [anaBack, benBack, caiBack]) s.send({ t: 'leave' });
await pause(1000);
for (const s of [wristBack, anaBack, benBack, caiBack]) s.ws.close();
console.log(results.every(Boolean) ? 'ALL HELD' : 'SOMETHING DID NOT HOLD');
process.exit(results.every(Boolean) ? 0 : 1);
```

Run it with Bash `run_in_background`: `node <scratchpad>/live-restart.mjs`. When its output says `READY`, restart the one machine: `"$F" machine restart <machine id> -a on-the-beat`. Expected output: four `OK` lines and `ALL HELD`. Then `"$F" logs -a on-the-beat --no-tail | grep "night:"` shows `night: written on stop` and `night: carried on from /data/night.json — …` with counts only.

- [ ] **Step 6: Memory**

Update `fly-relay.md`: the volume (`night`, 1 GB, `syd`, no snapshots, made on the date), `NIGHT_FILE`, that a deploy now carries the night on and replaced the machine once, the host-failure recovery (new volume + deploy), and the live check's result. Update `work-queue.md`: item 2 done with the commits; next is item 3, staff push notifications. Keep their lines in `MEMORY.md` current.
