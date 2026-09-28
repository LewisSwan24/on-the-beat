# Staff: reports reach the venue team — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every report a phone makes reaches the venue's own team within a second, on a staff page at `/staff` signed in with the venue's passcode: when, which part of the room then and now, how often that person was reported tonight and by how many people, and the reporter's own few words — never a name, a contact, a handle or who reported.

**Architecture:** The room keeps each report with both sides' bands and the words, and says what staff may see (`staffReports(tagOf)`), marks one handled (`markHandled()`) and lets a night's go (`forgetReports()`) (`relay/room.js`). A passcode is kept only as a scrypt entry (`relay/staff.js`), made by `npm run staff-code` (`scripts/staff-code.mjs`) and given to the relay as `STAFF_CODES`. A socket can sign in as staff with the passcode or tonight's token; the relay then pushes the venue's list with every room push and takes marks, holds the room while staff are in it and the reports till 06:00, and signs staff out at 06:00 (`relay/server.js`). The page is a second Vite entry (`app/staff.html`, `app/staff/`), served at `/staff`, never kept by the offline shell (`app/public/sw.js`). The phone's Report opens a sheet with an optional few words (`app/App.jsx`).

**Tech Stack:** Node 22+ (`node --test`, `ws` 8.21, `node:crypto` scrypt/HMAC), React 19, Vite 8.3 (rolldown: `build.rolldownOptions`).

**Spec:** `docs/superpowers/specs/2026-09-28-staff-reports-design.md` (decided with the owner question by question on 28 Sep 2026, reviewed and approved the same day, commit `8b6c869`). Its section *Amended while planning* lists seven changes this plan makes to it and why; read the spec, then that section, before any task.

This plan was written before the build, from the code at `8b6c869`. Where the build finds a block here wrong, the block is corrected in this file in the same commit as the fix, so the plan stays what was built.

## Global Constraints

- Artefacts are English: code, comments, commit messages, README, test names, the staff page's words. Talk to the owner in Chinese.
- **Promise 2 holds for staff** (spec §6): nothing sent to a staff socket carries a name, a contact, a photo, a handle, a phone's internal id (`me`), or who reported. The person reported is only a staff tag, `P-` and four upper-case hex digits of HMAC-SHA-256 under a key the relay draws at start, over `venue + '|' + id`.
- **Promise 1 holds for staff**: a place is only ever a band, one of `BANDS` (`in this room`, `near the bar`, `by the stage`, `somewhere out the back`), or `left`.
- **Passcodes:** never in the repository, `relay/shows.json`, `/api/shows`, a log, the image, or any test but a test passcode (`test-passcode-1`, `test-passcode-2`, `browser-test-passcode`). The real one is the owner's: he makes it with `npm run staff-code` and sets `STAFF_CODES` on Fly himself. Never type, print or ask for his.
- **Entry format:** `scrypt$16384$8$1$<32 hex salt>$<64 hex hash>`, scrypt N 16384, r 8, p 1, 32-byte key, passcode `normalize('NFC')`d; compared with `timingSafeEqual`.
- **Constants** (`relay/room.js`): `REPORTS_MAX` 1000 (unchanged), `WHY_MAX` 200. (`relay/server.js`): `STAFF_TOKENS_MAX` 1000, `CODE_MAX` 200; the pairing counters (`SOCKET_TRIES` 5, `ADDRESS_TRIES` 20 per `TRIES_MS` 60 s) count every sign-in by passcode.
- **Frames:** in `{t:'staff', venue, code}` or `{t:'staff', venue, token}`; `{t:'handled', id, on}` with `on` a boolean. Out `{t:'staff', ok:true, venue, token}`, `{t:'staff', ok:false, why}` with `why` one of `no staff page`, `wrong code`, `too many tries`, `expired`, `bad staff`, `too many venues`; `{t:'reports', reports}`, each `{ id, at, about, times, people, bandNow, bandThen, fromThen, why, handledAt }`. A staff socket closed at 06:00 closes with 4004 `expired`.
- **Not in this plan** (spec): doing anything to the person reported; answering the reporter; push notifications; keeping reports past a restart; staff accounts.
- Repository `LewisSwan24/on-the-beat` (private). Commit after each task, and push to `main` when that task's `npm test` is green. Never the team repository `cimi2232/DECO3500`: `tools/hooks/pre-push` refuses it. Never `--no-verify`.
- `CLAUDE.md` is not in git and is not edited by this plan. Nothing from `../on-the-beat-research/` or `../on-the-beat-design/` enters the repository.
- `npm test` builds first (the relay serves `dist/`). A relay test file alone needs no build (its relays serve a temp `dist/`); `tests/staff-page.test.js` reads the real `dist/`, so build first and again after restoring a mutation there.
- Windows host: the Bash tool is Git Bash. Never write JavaScript holding backticks, quotes or `${}` through a Bash heredoc: write it with the editor. A command that holds `git commit` and another program's `-n` is refused by a hook as `--no-verify`: run them separately.
- Never more than ten background tasks at once. Work directly; this plan needs no fan-out.
- Deploy to Fly whenever ready unless the owner has said a demo is on. Commit messages end with the attribution trailer the session's system reminder gives (today: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## Four procedures used throughout

**P1 — Mutation check.** Every task that adds a guard lists mutations as JSON: break one guard, run one test file, and exactly the listed tests go red (a listed name is a prefix of the test's). Save this runner outside the repository (the session's scratchpad, as `mutate.mjs`) and run it from the repository root: `node <scratch>/mutate.mjs <scratch>/staff-task-N.json`. It applies each edit (the `from` text must occur exactly once; keep `$` out of `to`, which `String.replace` would read), runs the test file, restores the file byte for byte, runs it again, and prints `ALL MUTATIONS HELD` only if every red set was exactly the listed one and every restore came back green. The lists below are predictions; each is measured at its task, and a list that measures differently is corrected here with the reason (an extra red that is legitimate is kept in the list and said so in the commit).

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

**P2 — A local relay with a staff page.** Make a test entry and start the relay with it, in the background (Bash `run_in_background`), from the repository root:

```bash
export STAFF_CODES="$(node -e "import('./relay/staff.js').then(async (s) => console.log(JSON.stringify({ 'roundhouse-bruno-mars': await s.makeEntry('browser-test-passcode') })))")"
npm start
```

The app is then at `http://localhost:8790/` and the staff page at `http://localhost:8790/staff`. A phone in the browser pane is seeded as `CLAUDE.md` says (`localStorage['otb:v1']`, venue `roundhouse-bruno-mars`); the person it reports is a scripted phone (P2's `ben.mjs`, below) so the browser holds only one phone. The pane's tabs share `localStorage` but not `sessionStorage`, so two staff tabs are two staff pages. Stop the relay by port when done (`Get-NetTCPConnection -LocalPort 8790`, then `Stop-Process`).

`ben.mjs`, in the scratchpad: a person who shows blue at a venue and stays until killed. It uses Node's own `WebSocket` (Node 22 and later; 24.15 here), so it needs nothing from the repository's `node_modules`.

```js
// A stand-in person for the browser checks: joins, shows blue, and stays.
import { randomBytes } from 'node:crypto';
const [venue = 'roundhouse-bruno-mars', relay = 'ws://localhost:8790'] = process.argv.slice(2);
const ws = new WebSocket(relay + '/api/ws');
ws.onopen = () => {
  ws.send(JSON.stringify({ t: 'join', venue, me: randomBytes(16).toString('hex') }));
  ws.send(JSON.stringify({ t: 'profile', name: 'Ben stand-in' }));
  ws.send(JSON.stringify({ t: 'arm', intent: 'hi' }));
  setInterval(() => ws.send('{"t":"ping"}'), 2000);
  console.log('BEN READY');
};
```

Run it in the background with `node <scratch>/ben.mjs`, and stop it when the check ends.

**P4 — The offline shell in headless Chrome.** The browser pane will not register a service worker, so this runs Chrome headless with a throwaway profile, over its debugging protocol with Node's own `WebSocket`, against the P2 relay: `node <scratch>/cdp-sw.mjs`. It prints where the worker registered, whether `/staff` is controlled, what `otb-shell-v2` holds and the title of `/` and `/staff` offline.

```js
// Headless Chrome, throwaway profile: does the offline shell keep the app, and never the staff page?
// Opens /, waits until the service worker controls the page, opens /staff, then reads the shell's cache.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ORIGIN = process.argv[2] || 'http://localhost:8790';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = mkdtempSync(join(tmpdir(), 'otb-sw-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', '--user-data-dir=' + profile, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let target;
  for (let i = 0; i < 40 && !target; i += 1) {
    await pause(250);
    try { target = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  const call = (method, params = {}) => new Promise((r) => { id += 1; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const run = async (expression) => (await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await call('Page.enable');
  await call('Page.navigate', { url: ORIGIN + '/' });
  await pause(2500);
  console.log('registered:', await run("navigator.serviceWorker.ready.then((r) => r.active && r.active.scriptURL)"));
  await call('Page.reload');   // controlled from here on
  await pause(2000);
  console.log('controlled after reload:', await run('!!navigator.serviceWorker.controller'));
  await call('Page.navigate', { url: ORIGIN + '/staff' });
  await pause(2500);
  console.log('staff page title:', await run('document.title'));
  console.log('staff page controlled:', await run('!!navigator.serviceWorker.controller'));
  const cache = await run(`(async () => {
    const shell = await caches.open('otb-shell-v2');
    const root = await shell.match('/');
    const text = root ? await root.text() : '';
    return { caches: await caches.keys(), entries: (await shell.keys()).map((r) => new URL(r.url).pathname),
      rootTitle: (text.match(/<title>[^<]*<\\/title>/) || [null])[0] };
  })()`);
  console.log('shell cache:', JSON.stringify(cache));
  // Offline: the app still opens from the shell; the staff page does not pretend to.
  await call('Network.enable');
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await call('Page.navigate', { url: ORIGIN + '/' });
  await pause(2000);
  console.log('offline / title:', await run('document.title'));
  await call('Page.navigate', { url: ORIGIN + '/staff' });
  await pause(2000);
  console.log('offline /staff title:', await run('document.title'), '| url:', await run('location.href'));
  ws.close();
}

try { await main(); } finally {
  chrome.kill();
  await pause(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a file */ }
}
```

Measured at Task 5: `registered: …/sw.js`, `/staff` controlled, `otb-shell-v2` `/` is `<title>On The Beat</title>`, offline `/` is `On The Beat`, offline `/staff` is Chrome's error page.

**P3 — Deploy.** `flyctl deploy --ha=false --remote-only` from the repository root with the flyctl at `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Fly-io.flyctl_Microsoft.Winget.Source_8wekyb3d8bbwe\flyctl.exe`; then `flyctl machine list -a on-the-beat` shows one machine. A deploy restarts the relay and empties every room.

---

### Task 1: The room keeps reports for staff

**Files:**
- Modify: `relay/room.js` (the header comment; `REPORTS_MAX`; the report state; `report()`; three new functions after it; the returned object)
- Test: `tests/room.test.js` (import `HEARD_MS`; replace the test *a report is kept for the venue team…*; add four tests after *the venue report log has a ceiling*)
- Modify: `tests/markers.test.js:141` (`band` is now `aboutBand`)

**Interfaces:**
- Produces: `room.report(viewer, handleOrMatchId|null, why)` → boolean (unchanged signature); each kept report `{ id: 'r<n>', at, from, about, aboutBand, fromBand, why, handledAt }`. `room.staffReports(tagOf: (id) => string)` → `[{ id, at, about: string|null, times, people, bandNow: string|null, bandThen: string|null, fromThen: string, why, handledAt }]`, newest first. `room.markHandled(reportId: string, on: boolean)` → boolean. `room.forgetReports(old: (at) => boolean)` → boolean (true if any went). `room.hasReports()` → boolean.

- [ ] **Step 1: Write the failing tests**

In `tests/room.test.js`, the import becomes:

```js
import { createRoom, BANDS, MARKS, HEARD_MS } from '../relay/room.js';
```

Replace the whole test `'a report is kept for the venue team with the band, never a position — about someone, or something'` with:

```js
test('a report keeps the band of each side when it was made, and words only as a string, cut to 200', () => {
  const { room, handleOf } = night();
  room.arm('ben', 'hi');
  assert.equal(room.report('ana', handleOf('ana', 'ben'), 'followed me'), true);
  assert.equal(room.report('ana', null, 'x'.repeat(250)), true);
  assert.equal(room.report('ana', null, { toString: () => 'sneaky' }), true);
  assert.equal(room.report('ana', 'not-a-handle', 'x'), false, 'a handle nobody holds is refused');
  const [r1, r2, r3] = room.reports();
  assert.deepEqual([r1.id, r1.from, r1.about, r1.aboutBand, r1.fromBand, r1.why, r1.handledAt],
    ['r1', 'ana', 'ben', 'by the stage', 'near the bar', 'followed me', 0]);
  assert.deepEqual([r2.id, r2.about, r2.aboutBand, r2.fromBand, r2.why.length], ['r2', null, null, 'near the bar', 200]);
  assert.equal(r3.why, '', 'anything but a string is no words');
});
```

After the test `'the venue report log has a ceiling: its newest thousand'`, add:

```js
// ---------- what the venue's staff see (staff spec §1) ----------

test('staff see each report newest first, the person as a tag with how often and by how many — never who reported', () => {
  const { room, handleOf } = night();
  room.arm('ben', 'hi');
  room.report('ana', handleOf('ana', 'ben'), 'followed me');
  room.report('cai', handleOf('cai', 'ben'), '');
  room.report('ana', handleOf('ana', 'ben'), 'again');
  room.report('cai', null, 'spill by the stairs');
  // A tag that gives nothing away, as the relay's HMAC does.
  const tags = new Map();
  const tag = (id) => { if (!tags.has(id)) tags.set(id, 'P-' + (tags.size + 1)); return tags.get(id); };
  const list = room.staffReports(tag);
  assert.deepEqual(list.map((r) => r.id), ['r4', 'r3', 'r2', 'r1']);
  assert.deepEqual(list[1], {
    id: 'r3', at: list[1].at, about: 'P-1', times: 3, people: 2, bandNow: 'by the stage',
    bandThen: 'by the stage', fromThen: 'near the bar', why: 'again', handledAt: 0,
  });
  assert.deepEqual([list[0].about, list[0].times, list[0].people, list[0].bandNow, list[0].bandThen, list[0].fromThen],
    [null, 0, 0, null, null, 'in this room']);
  const text = JSON.stringify(list);
  for (const secret of ['ana', 'ben', 'cai', 'ANA', 'BEN', 'CAI', '@ana', '@ben', '@cai', handleOf('ana', 'ben'), handleOf('cai', 'ben')]) {
    assert.equal(text.includes(secret), false, secret + ' reached staff');
  }
});

test('staff see where a reported person is now, and that they left', () => {
  const { room, handleOf, tick } = night();
  room.arm('ben', 'hi');
  room.report('ana', handleOf('ana', 'ben'), '');
  tick(HEARD_MS + 1);
  place(room, [['ben', 'somewhere out the back']]);
  const [r] = room.staffReports(() => 'P-1');
  assert.deepEqual([r.bandThen, r.bandNow], ['by the stage', 'somewhere out the back']);
  room.leave('ben');
  assert.equal(room.staffReports(() => 'P-1')[0].bandNow, 'left');
});

test('a report is marked handled with the time, and opened again; one that is not there is false', () => {
  const { room, tick } = night();
  room.report('ana', null, 'spill');
  tick(60_000);
  assert.equal(room.markHandled('r1', true), true);
  const at = room.staffReports(() => '')[0].handledAt;
  assert.ok(at > 0);
  tick(1000);
  room.markHandled('r1', true);
  assert.equal(room.staffReports(() => '')[0].handledAt, at, 'marking it again keeps when it was first handled');
  assert.equal(room.markHandled('r1', false), true);
  assert.equal(room.staffReports(() => '')[0].handledAt, 0);
  assert.equal(room.markHandled('r9', true), false);
  assert.equal(room.hasReports(), true);
});

test('the reports of a night that is over can be let go, oldest first, and only those', () => {
  const { room, tick } = night();
  assert.equal(room.hasReports(), false);
  room.report('ana', null, 'old');
  const oldAt = room.reports()[0].at;
  tick(1000);
  room.report('ana', null, 'new');
  assert.equal(room.forgetReports((at) => at <= oldAt), true);
  assert.deepEqual(room.reports().map((r) => r.why), ['new']);
  assert.equal(room.forgetReports((at) => at <= oldAt), false);
  assert.equal(room.forgetReports(() => true), true);
  assert.equal(room.hasReports(), false);
});
```

In `tests/markers.test.js`, the last line of the test `'a match keeps the area it was made in, and a report the area it was sent from'` becomes:

```js
  assert.equal(room.reports()[0].aboutBand, 'near the bar');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/room.test.js tests/markers.test.js`
Expected: FAIL — the five new or rewritten room tests (`r1.id` undefined, `room.staffReports is not a function`, `room.markHandled is not a function`, `room.hasReports is not a function`, `room.forgetReports is not a function`) and the markers test (`aboutBand` undefined).

- [ ] **Step 3: Implement in `relay/room.js`**

In the header comment, before the paragraph that begins `// It holds nothing past the night:`, add:

```js
// A report goes to the venue's own team and to nobody in the room. staffReports() is all the team is shown: the
// person reported only as a tag the relay makes, their band then and now, and the reporter's own words — never
// a name, a contact, a handle, or who reported.
//
```

Replace:

```js
const REPORTS_MAX = 1000;      // the newest kept; a real venue forwards these to its own dashboard
```

with:

```js
const REPORTS_MAX = 1000;      // the newest kept a venue, for its staff page (relay/server.js reportsTo())
const WHY_MAX = 200;           // a reporter's few words for the venue team
```

Replace:

```js
  const reports = [];
  let nextMatch = 1;
```

with:

```js
  const reports = [];         // oldest first: { id, at, from, about, aboutBand, fromBand, why, handledAt }
  let nextReport = 1;
  let nextMatch = 1;
```

Replace the whole of `report()`:

```js
  /** To the venue team, with the time and the band. About someone, or about something. */
  function report(viewer, h, why = '') {
    if (!people.has(viewer)) return false;
    const t = h ? (resolve(viewer, h) ?? matchOther(viewer, h)) : null;
    if (h && !t) return false;
    reports.push({
      at: now(), from: viewer, about: t,
      band: t ? (people.get(t)?.band ?? null) : people.get(viewer).band, why: clip(why, 200),
    });
    if (reports.length > REPORTS_MAX) reports.splice(0, reports.length - REPORTS_MAX);
    return true;
  }
```

with:

```js
  /**
   * To the venue team: about someone, or about something. It keeps when, each side's band then, and the
   * reporter's own words — a string, or none.
   */
  function report(viewer, h, why = '') {
    if (!people.has(viewer)) return false;
    const t = h ? (resolve(viewer, h) ?? matchOther(viewer, h)) : null;
    if (h && !t) return false;
    reports.push({
      id: 'r' + nextReport++, at: now(), from: viewer, about: t,
      aboutBand: t ? (people.get(t)?.band ?? null) : null, fromBand: people.get(viewer).band,
      why: typeof why === 'string' ? clip(why, WHY_MAX) : '', handledAt: 0,
    });
    if (reports.length > REPORTS_MAX) reports.splice(0, reports.length - REPORTS_MAX);
    return true;
  }

  /**
   * What the venue's staff may see, newest first: when; the person as `tagOf(id)`, with how many reports
   * tonight are about them and from how many people; their band then and now, or `left`; the reporter's band
   * then; the words; and when it was handled, or 0. Nothing names who reported.
   */
  function staffReports(tagOf) {
    const about = new Map();   // id -> { times, from: Set of reporters }
    for (const r of reports) {
      if (!r.about) continue;
      if (!about.has(r.about)) about.set(r.about, { times: 0, from: new Set() });
      about.get(r.about).times += 1;
      about.get(r.about).from.add(r.from);
    }
    return reports.map((r) => ({
      id: r.id, at: r.at, about: r.about ? tagOf(r.about) : null,
      times: r.about ? about.get(r.about).times : 0,
      people: r.about ? about.get(r.about).from.size : 0,
      bandNow: r.about ? (people.get(r.about)?.band ?? 'left') : null,
      bandThen: r.aboutBand, fromThen: r.fromBand, why: r.why, handledAt: r.handledAt,
    })).reverse();
  }

  /** Staff mark a report handled, or open it again. Marking it twice keeps the first time. False if it is not here. */
  function markHandled(reportId, on) {
    const r = reports.find((x) => x.id === reportId);
    if (!r) return false;
    r.handledAt = on ? (r.handledAt || now()) : 0;
    return true;
  }

  /** At 06:00: the reports `old(at)` says are a night that is over. Kept in order, so the oldest go until one is not. */
  function forgetReports(old) {
    let n = 0;
    while (n < reports.length && old(reports[n].at)) n += 1;
    reports.splice(0, n);
    return n > 0;
  }
```

In the returned object, replace:

```js
    reports: () => reports.slice(),
```

with:

```js
    reports: () => reports.slice(),
    staffReports, markHandled, forgetReports,
    /** For the relay: does this venue hold any reports tonight? */
    hasReports: () => reports.length > 0,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/room.test.js tests/markers.test.js`
Expected: PASS, every test.

- [ ] **Step 5: Mutation check (P1)** — `staff-task-1.json`, test file `tests/room.test.js`:

```json
[
  { "label": "words kept whatever they are", "file": "relay/room.js",
    "from": "why: typeof why === 'string' ? clip(why, WHY_MAX) : '',", "to": "why: clip(why, WHY_MAX),",
    "test": "tests/room.test.js", "expect": ["a report keeps the band of each side"] },
  { "label": "people counts reports, not reporters", "file": "relay/room.js",
    "from": "people: r.about ? about.get(r.about).from.size : 0,", "to": "people: r.about ? about.get(r.about).times : 0,",
    "test": "tests/room.test.js", "expect": ["staff see each report newest first"] },
  { "label": "a person who left reads as nowhere", "file": "relay/room.js",
    "from": "(people.get(r.about)?.band ?? 'left')", "to": "(people.get(r.about)?.band ?? null)",
    "test": "tests/room.test.js", "expect": ["staff see where a reported person is now"] },
  { "label": "marking again moves the time", "file": "relay/room.js",
    "from": "r.handledAt = on ? (r.handledAt || now()) : 0;", "to": "r.handledAt = on ? now() : 0;",
    "test": "tests/room.test.js", "expect": ["a report is marked handled"] },
  { "label": "a new night forgets everything", "file": "relay/room.js",
    "from": "while (n < reports.length && old(reports[n].at)) n += 1;", "to": "while (n < reports.length) n += 1;",
    "test": "tests/room.test.js", "expect": ["the reports of a night that is over"] },
  { "label": "oldest first", "file": "relay/room.js",
    "from": "    })).reverse();", "to": "    }));",
    "test": "tests/room.test.js", "expect": ["staff see each report newest first"] },
  { "label": "the reporter reaches staff", "file": "relay/room.js",
    "from": "id: r.id, at: r.at, about:", "to": "id: r.id, from: r.from, at: r.at, about:",
    "test": "tests/room.test.js", "expect": ["staff see each report newest first"] }
]
```

Expected: `ALL MUTATIONS HELD`.

- [ ] **Step 6: Whole suite, commit, push**

Run: `npm test` — expected: every test passes.

```bash
git add relay/room.js tests/room.test.js tests/markers.test.js
git commit -m "The room keeps each report for the venue's staff" -m "A report keeps its id, both sides' bands then, and the reporter's words only as a string, cut to 200. staffReports() gives staff each one newest first with the person as a tag, how often and by how many people they were reported tonight, their band now or that they left, and never who reported; markHandled() and forgetReports() mark one and let a night's go." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 2: A passcode kept only as an entry, and the script that makes one

**Files:**
- Create: `relay/staff.js`
- Create: `scripts/staff-code.mjs`
- Modify: `package.json` (`scripts`: `"staff-code"`)
- Test: `tests/staff-code.test.js`

**Interfaces:**
- Produces: `makeEntry(code: string, salt?: string)` → `Promise<string>`; `checkCode(entry: unknown, code: string)` → `Promise<boolean>`; `isEntry(entry: unknown)` → boolean. `npm run staff-code` prints one line `"<venue>": "<entry>"` on stdout.
- Consumes: `venueKey`, `loadShows` from `relay/server.js` (existing exports).

- [ ] **Step 1: Write the failing tests** — `tests/staff-code.test.js`:

```js
// ON THE BEAT — a staff passcode becomes an entry the relay checks, and the script that makes one
// (docs/superpowers/specs/2026-09-28-staff-reports-design.md §2). Test passcodes only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkCode, isEntry, makeEntry } from '../relay/staff.js';

const script = fileURLToPath(new URL('../scripts/staff-code.mjs', import.meta.url));

/** The script, fed `input` on a pipe: what it printed, what it said, and how it ended. */
function run(input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ out, err, code }));
    child.stdin.end(input);
  });
}

/**
 * The script as a terminal runs it: stdin said to be a TTY, so it echoes what is typed, and each answer typed,
 * with a carriage return, only once its question has been asked.
 */
function typed(answers) {
  return new Promise((resolve) => {
    const tty = 'data:text/javascript,' + encodeURIComponent("Object.defineProperty(process.stdin, 'isTTY', { value: true });");
    const child = spawn(process.execPath, ['--import', tty, script], { stdio: ['pipe', 'pipe', 'pipe'] });
    const questions = ['Venue (', 'Passcode (', 'The same passcode again'];
    let out = '';
    let err = '';
    let asked = 0;
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => {
      err += d;
      while (asked < answers.length && err.includes(questions[asked])) child.stdin.write(answers[asked++] + '\r');
      if (asked === answers.length && !child.stdin.writableEnded) child.stdin.end();
    });
    child.on('close', (code) => resolve({ out, err, code }));
  });
}

test('typed at a terminal, the venue shows as it is typed and the passcode never does', async () => {
  const { out, err, code } = await typed(['roundhouse-bruno-mars', 'test-passcode-1', 'test-passcode-1']);
  assert.equal(code, 0, err);
  assert.match(err, /roundhouse-bruno-mars/, 'what is typed is echoed, so the hiding is what keeps the passcode off');
  assert.equal((out + err).includes('test-passcode-1'), false, 'the passcode is never shown');
  const [[, entry]] = Object.entries(JSON.parse('{' + out + '}'));
  assert.equal(await checkCode(entry, 'test-passcode-1'), true);
});

test('an entry opens with its own passcode and no other, and each has a salt of its own', async () => {
  const entry = await makeEntry('test-passcode-1');
  assert.equal(isEntry(entry), true);
  assert.match(entry, /^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  assert.equal(await checkCode(entry, 'test-passcode-1'), true);
  assert.equal(await checkCode(entry, 'test-passcode-2'), false);
  assert.equal(await checkCode(entry, 'test-passcode-1 '), false);
  assert.notEqual(await makeEntry('test-passcode-1'), entry);
  assert.equal(await checkCode('scrypt$1$1$1$ab$cd', 'test-passcode-1'), false, 'what is not an entry opens nothing');
  assert.equal(await checkCode(undefined, 'test-passcode-1'), false);
  assert.equal(isEntry(entry.slice(0, -1)), false);
});

test('a passcode is the same passcode however its accents were typed', async () => {
  const entry = await makeEntry('café-staff-code');
  assert.equal(await checkCode(entry, 'café-staff-code'), true);
});

test('npm run staff-code prints one entry for the venue, and never the passcode', async () => {
  const { out, err, code } = await run(' Roundhouse-Bruno-Mars \ntest-passcode-1\ntest-passcode-1\n');
  assert.equal(code, 0, err);
  assert.equal(out.split('\n').filter(Boolean).length, 1, 'one line on stdout');
  const [[venue, entry]] = Object.entries(JSON.parse('{' + out + '}'));
  assert.equal(venue, 'roundhouse-bruno-mars', 'the venue as its room is named');
  assert.equal(await checkCode(entry, 'test-passcode-1'), true);
  assert.equal((out + err).includes('test-passcode-1'), false, 'the passcode is never shown');
});

test('two passcodes that differ, one too short, or no venue make nothing', async () => {
  const inputs = ['roundhouse-bruno-mars\ntest-passcode-1\ntest-passcode-2\n', 'roundhouse-bruno-mars\nshort\nshort\n', '\n', ''];
  for (const input of inputs) {
    const { out, code } = await run(input);
    assert.equal(code, 1, JSON.stringify(input));
    assert.equal(out, '', 'nothing on stdout for ' + JSON.stringify(input));
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/staff-code.test.js`
Expected: FAIL — `Cannot find module '…/relay/staff.js'`.

- [ ] **Step 3: Write `relay/staff.js`**

```js
// ON THE BEAT — a venue's staff passcode, kept only as an entry made from it
// (docs/superpowers/specs/2026-09-28-staff-reports-design.md §2).
//
// An entry is `scrypt$16384$8$1$<salt>$<hash>`, in hex: the passcode through scrypt with a salt of its own. The
// owner makes one with `npm run staff-code` (scripts/staff-code.mjs) and gives the relay a JSON object of venue
// id -> entry as STAFF_CODES. No passcode is kept anywhere.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// 16 MiB and tens of milliseconds a check: dear to guess at, cheap for a team signing in.
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const ENTRY = /^scrypt\$16384\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{64})$/;

/** The passcode through scrypt, on libuv's pool, off the event loop. */
const derive = (code, salt) => new Promise((resolve, reject) => {
  scrypt(String(code).normalize('NFC'), Buffer.from(salt, 'hex'), KEY_LEN, { N, r: R, p: P },
    (err, key) => (err ? reject(err) : resolve(key)));
});

/** Is this an entry makeEntry() makes? */
export const isEntry = (entry) => typeof entry === 'string' && ENTRY.test(entry);

/** An entry for a passcode, with a salt of its own. */
export async function makeEntry(code, salt = randomBytes(16).toString('hex')) {
  return ['scrypt', N, R, P, salt, (await derive(code, salt)).toString('hex')].join('$');
}

/** Does this passcode make this entry? Compared in constant time; false for anything that is not an entry. */
export async function checkCode(entry, code) {
  const m = typeof entry === 'string' ? ENTRY.exec(entry) : null;
  if (!m) return false;
  return timingSafeEqual(await derive(code, m[1]), Buffer.from(m[2], 'hex'));
}
```

- [ ] **Step 4: Write `scripts/staff-code.mjs`**

```js
// ON THE BEAT — one venue's staff passcode, as an entry for the relay's STAFF_CODES
// (docs/superpowers/specs/2026-09-28-staff-reports-design.md §2).
//
//   npm run staff-code
//
// Asks for the venue's show id and a passcode of at least eight characters, twice. The passcode is never shown:
// not as it is typed, and not in what is printed. stdout gets one line, `"<venue>": "scrypt$..."`; the questions
// go to stderr. Put each venue's line between STAFF_CODES's braces and set it on the relay (README, "The staff
// page").

import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { loadShows, venueKey } from '../relay/server.js';
import { makeEntry } from '../relay/staff.js';

const CODE_MIN = 8;

// What a terminal would echo goes to stderr, and none of it while a passcode is being typed.
let hidden = false;
const echo = new Writable({ write(chunk, encoding, done) { if (!hidden) process.stderr.write(chunk); done(); } });
const rl = createInterface({ input: process.stdin, output: echo, terminal: !!process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();

async function ask(question, secret = false) {
  process.stderr.write(question);
  hidden = secret;
  const { value = '' } = await lines.next();
  hidden = false;
  if (secret) process.stderr.write('\n');
  return value;
}

function fail(why) {
  rl.close();
  process.stderr.write(why + ' Nothing was made.\n');
  process.exitCode = 1;
}

async function main() {
  const venue = venueKey(await ask('Venue (its show id, as in relay/shows.json): '));
  if (!venue) return fail('No venue given.');
  const shows = loadShows(fileURLToPath(new URL('../relay/shows.json', import.meta.url)));
  if (!shows.some((s) => s.id === venue)) {
    process.stderr.write('Note: ' + venue + ' is not in relay/shows.json, so the staff page will not list it.\n');
  }
  const code = await ask('Passcode (at least ' + CODE_MIN + ' characters; not shown): ', true);
  if ([...code].length < CODE_MIN) return fail('A passcode needs at least ' + CODE_MIN + ' characters.');
  if ((await ask('The same passcode again: ', true)) !== code) return fail('The two passcodes differ.');
  rl.close();
  process.stdout.write(JSON.stringify(venue) + ': ' + JSON.stringify(await makeEntry(code)) + '\n');
}

await main();
```

In `package.json`, after `"icons": "node scripts/icons.mjs"`, the scripts gain:

```json
    "icons": "node scripts/icons.mjs",
    "staff-code": "node scripts/staff-code.mjs"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/staff-code.test.js`
Expected: PASS, five tests.

- [ ] **Step 6: Mutation check (P1)** — `staff-task-2.json`:

```json
[
  { "label": "any entry-shaped string opens", "file": "relay/staff.js",
    "from": "return timingSafeEqual(await derive(code, m[1]), Buffer.from(m[2], 'hex'));", "to": "return true;",
    "test": "tests/staff-code.test.js", "expect": ["an entry opens with its own passcode"] },
  { "label": "accents typed two ways differ", "file": "relay/staff.js",
    "from": "String(code).normalize('NFC')", "to": "String(code)",
    "test": "tests/staff-code.test.js", "expect": ["a passcode is the same passcode"] },
  { "label": "a short passcode is taken", "file": "scripts/staff-code.mjs",
    "from": "if ([...code].length < CODE_MIN) return fail", "to": "if (false) return fail",
    "test": "tests/staff-code.test.js", "expect": ["two passcodes that differ"] },
  { "label": "the passcode is echoed", "file": "scripts/staff-code.mjs",
    "from": "if (!hidden) process.stderr.write(chunk);", "to": "process.stderr.write(chunk);",
    "test": "tests/staff-code.test.js", "expect": ["typed at a terminal"] }
]
```

Measured: all four held. The last one survived the first build, whose tests only piped their answers in (readline echoes nothing without a terminal); the test *typed at a terminal* was added for it, and it goes red.

- [ ] **Step 7: Whole suite, commit, push**

Run: `npm test` — expected: every test passes.

```bash
git add relay/staff.js scripts/staff-code.mjs package.json tests/staff-code.test.js
git commit -m "A staff passcode is kept only as a scrypt entry" -m "relay/staff.js makes and checks entries: scrypt N 16384 r 8 p 1 with a salt of their own, the passcode NFC-normalised, compared in constant time. npm run staff-code asks for the venue and a passcode of at least eight characters twice, never shows it, and prints one line for STAFF_CODES." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: The relay signs staff in

**Files:**
- Modify: `relay/server.js` (imports; constants; `readStaffCodes()` export; `createRelay` option and doc; the room record; tokens and tags; `reportsTo()`; `staffIn()` and `signIn()`; `handle()`; the socket's `close`; `gcRoom()`)
- Test: `tests/staff.test.js` (new)

**Interfaces:**
- Consumes: `room.staffReports(tagOf)` (Task 1); `checkCode`, `isEntry` (Task 2).
- Produces: `createRelay({ …, staffCodes })` — `staffCodes` a JSON string, default `process.env.STAFF_CODES`; throws at start on a bad one. `readStaffCodes(text)` → `Map(venue -> entry)`. In the relay: `r.staff` (Set of signed-in staff sockets on each room record), `ws.staff = { key, night }`, `reportsTo(r, sockets = r.staff)`, `tagOf(key, id)`.

- [ ] **Step 1: Write the failing tests** — `tests/staff.test.js`:

```js
// ON THE BEAT — the staff page's side of the relay, over real sockets
// (docs/superpowers/specs/2026-09-28-staff-reports-design.md §2, §3): signing in, the live list, marking, the night.
// Test passcodes only.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { createRelay, WS_PATH, bandIdOf } from '../relay/server.js';
import { makeEntry } from '../relay/staff.js';
import { helpers, newKey, pause } from './relay-harness.js';

const TZ = 'Australia/Brisbane';                     // UTC+10, no daylight saving
const EIGHT_PM = Date.UTC(2026, 8, 28, 10, 0);      // 20:00 on 28 Sep there
const NEXT_MORNING = Date.UTC(2026, 8, 28, 20, 30); // 06:30 on 29 Sep there: the next night
let base;
let root;
let CODES;
const running = [];

before(async () => {
  base = mkdtempSync(join(tmpdir(), 'otb-staff-'));
  root = join(base, 'dist');
  mkdirSync(root);
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>On The Beat</title>');
  writeFileSync(join(root, 'staff.html'), '<!doctype html><title>Staff</title>');
  CODES = JSON.stringify({ 'staff-venue': await makeEntry('test-passcode-1'), 'staff-other': await makeEntry('test-passcode-2') });
});

after(async () => {
  for (const { relay, h } of running) {
    h.cleanup();
    await relay.close();
  }
  rmSync(base, { recursive: true, force: true });
});

let addresses = 0;
/** A relay of its own, on a clock the test moves, where two venues have a staff page. */
async function start() {
  const clock = { t: EIGHT_PM };
  const relay = await createRelay({ port: 0, host: '127.0.0.1', root, clock: () => clock.t, nightTz: TZ, staffCodes: CODES });
  const h = helpers(() => relay.port);
  running.push({ relay, h });

  /** A staff page's socket: each answer to a sign-in, each list it is sent, and how it closed. */
  async function staff({ ip = '203.0.113.' + (1 + (addresses++ % 199)) } = {}) {
    const ws = new WebSocket('ws://127.0.0.1:' + relay.port + WS_PATH, { headers: { 'cf-connecting-ip': ip } });
    const s = { ws, answers: [], lists: [], closed: null, waiters: [] };
    const wake = () => { s.waiters = s.waiters.filter((w) => !w()); };
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.t === 'staff') s.answers.push(m);
      if (m.t === 'reports') s.lists.push(m.reports);
      wake();
    });
    ws.on('close', (code) => { s.closed = code; wake(); });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    s.send = (m) => ws.send(JSON.stringify(m));
    s.list = () => s.lists.at(-1);
    /** Waits until `pred()` holds, or fails with what the socket has seen. */
    s.until = (pred, ms = 3000) => new Promise((resolve, reject) => {
      const check = () => { if (pred()) { clearTimeout(timer); resolve(s); return true; } return false; };
      const timer = setTimeout(() => reject(new Error('staff timed out: '
        + JSON.stringify({ answers: s.answers, lists: s.lists, closed: s.closed }))), ms);
      if (!check()) s.waiters.push(check);
    });
    /** Sends a sign-in and waits for its answer. */
    s.signIn = async (m) => {
      const n = s.answers.length;
      s.send({ t: 'staff', ...m });
      await s.until(() => s.answers.length > n);
      return s.answers.at(-1);
    };
    return s;
  }

  /** Signed in with the right passcode, its first list come. */
  async function signedIn(venue = 'staff-venue', code = 'test-passcode-1') {
    const s = await staff();
    const a = await s.signIn({ venue, code });
    assert.equal(a.ok, true, JSON.stringify(a));
    await s.until(() => s.lists.length > 0);
    return s;
  }

  return { relay, clock, staff, signedIn, ...h };
}

test('a venue with no staff page says so, whatever it is called', async () => {
  const { staff } = await start();
  const s = await staff();
  for (const venue of ['moth-club-kayo-lane', '__proto__', 'constructor', '', undefined]) {
    assert.deepEqual(await s.signIn({ venue, code: 'test-passcode-1' }), { t: 'staff', ok: false, why: 'no staff page' });
  }
  assert.equal(s.lists.length, 0, 'no list without a sign-in');
});

test('a wrong passcode is refused and counted: past five a socket and twenty an address, even the right one waits', async () => {
  const { staff } = await start();
  const s = await staff({ ip: '203.0.113.200' });
  for (let i = 0; i < 5; i += 1) assert.equal((await s.signIn({ venue: 'staff-venue', code: 'wrong ' + i })).why, 'wrong code');
  assert.deepEqual(await s.signIn({ venue: 'staff-venue', code: 'test-passcode-1' }), { t: 'staff', ok: false, why: 'too many tries' });
  for (let k = 0; k < 3; k += 1) {
    const more = await staff({ ip: '203.0.113.200' });
    for (let i = 0; i < 5; i += 1) await more.signIn({ venue: 'staff-venue', code: 'wrong' });
  }
  const last = await staff({ ip: '203.0.113.200' });
  assert.equal((await last.signIn({ venue: 'staff-venue', code: 'test-passcode-1' })).why, 'too many tries', 'twenty from one address');
  const elsewhere = await staff({ ip: '203.0.113.201' });
  assert.equal((await elsewhere.signIn({ venue: 'staff-venue', code: 'test-passcode-1' })).ok, true, 'another address is not held back');
});

test('the right passcode signs in with a token, and the list comes at once', async () => {
  const { staff } = await start();
  const s = await staff();
  const a = await s.signIn({ venue: ' Staff-Venue ', code: 'test-passcode-1' });
  assert.equal(a.ok, true);
  assert.equal(a.venue, 'staff-venue', 'the venue as its room is named');
  assert.match(a.token, /^[a-f0-9]{32}$/);
  await s.until(() => s.lists.length === 1);
  assert.deepEqual(s.list(), []);
});

test('a token signs in again after a reconnect, only at its own venue; a made-up one is expired', async () => {
  const { staff } = await start();
  const first = await staff();
  const { token } = await first.signIn({ venue: 'staff-venue', code: 'test-passcode-1' });
  first.ws.close();
  const again = await staff();
  assert.deepEqual(await again.signIn({ venue: 'staff-venue', token }), { t: 'staff', ok: true, venue: 'staff-venue', token });
  await again.until(() => again.lists.length === 1);
  const elsewhere = await staff();
  assert.equal((await elsewhere.signIn({ venue: 'staff-other', token })).why, 'expired');
  assert.equal((await elsewhere.signIn({ venue: 'staff-venue', token: randomBytes(16).toString('hex') })).why, 'expired');
  assert.equal((await elsewhere.signIn({ venue: 'staff-venue', token: 42 })).why, 'bad staff', 'neither a passcode nor a token');
});

test('a phone or a wristband cannot sign in as staff, and staff cannot act as either', async () => {
  const { relay, phone, wristband, reply, staff, signedIn } = await start();
  const s = await signedIn();
  const { token } = s.answers[0];
  const ana = await phone('staff-venue');
  for (const how of [{ token }, { code: 'test-passcode-1' }]) {
    const answer = reply(ana, 'staff');
    ana.send({ t: 'staff', venue: 'staff-venue', ...how });
    assert.deepEqual(await answer, { t: 'staff', ok: false, why: 'bad staff' });
  }
  const band = await wristband();
  const told = new Promise((resolve) => band.ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.t === 'staff') resolve(m);
  }));
  band.send({ t: 'staff', venue: 'staff-venue', token });
  assert.deepEqual(await told, { t: 'staff', ok: false, why: 'bad staff' });
  // A socket that joins while its passcode is being checked is a phone by the time the check ends.
  const racer = await staff();
  racer.send({ t: 'staff', venue: 'staff-venue', code: 'test-passcode-1' });
  racer.send({ t: 'join', venue: 'staff-venue', me: randomBytes(16).toString('hex') });
  await racer.until(() => racer.answers.length === 1);
  assert.deepEqual(racer.answers[0], { t: 'staff', ok: false, why: 'bad staff' });
  // Staff saying what a phone or a wristband says.
  const me = randomBytes(16).toString('hex');
  const key = newKey();
  s.send({ t: 'join', venue: 'staff-venue', me });
  s.send({ t: 'report', why: 'from staff' });
  s.send({ t: 'wristband', id: bandIdOf(key), key, v: 2, battery: 50 });
  await pause(300);
  assert.equal(relay.rooms.get('staff-venue').room.has(me), false, 'no person made');
  assert.equal(relay.bandCount(), 1, 'no wristband made but the real one');
  assert.equal(relay.rooms.get('staff-venue').room.hasReports(), false, 'no report made');
  assert.equal(s.closed, null, 'still signed in');
});

test('signing in makes the venue\'s room, and a room with staff signed in is not let go', async () => {
  const { relay, clock, phone, reply, signedIn } = await start();
  const s = await signedIn();
  assert.equal(relay.rooms.has('staff-venue'), true);
  const ana = await phone('staff-venue');
  const left = reply(ana, 'left');
  ana.send({ t: 'leave' });
  await left;
  relay.expire(clock.t);
  assert.equal(relay.rooms.has('staff-venue'), true, 'staff hold it');
  s.ws.close();
  await s.until(() => s.closed !== null);
  await pause(100);
  relay.expire(clock.t);
  assert.equal(relay.rooms.has('staff-venue'), false, 'and let it go when they leave');
});

test('STAFF_CODES is read whole, or the relay does not start — and a bad entry is never printed', async () => {
  const entry = await makeEntry('test-passcode-1');
  const bad = [
    ['not json', /STAFF_CODES is not JSON/],
    ['[]', /not an object/],
    ['"text"', /not an object/],
    ['null', /not an object/],
    [JSON.stringify({ 'Staff Venue': entry }), /"Staff Venue" is not a venue id/],
    [JSON.stringify({ 'staff-venue': 'scrypt$1$1$1$ab$cd' }), /the entry for staff-venue/],
    [JSON.stringify({ 'staff-venue': 42 }), /the entry for staff-venue/],
  ];
  for (const [text, message] of bad) {
    // A relay that starts anyway is closed, or it would hold the test run open.
    let started = null;
    try {
      assert.throws(() => { started = createRelay({ port: 0, host: '127.0.0.1', root, staffCodes: text }); },
        (e) => message.test(e.message) && !e.message.includes('scrypt$'), text);
    } finally {
      if (started) await (await started).close();
    }
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/staff.test.js`
Expected: FAIL — every test: the `staff` sign-ins get no answer (`staff timed out`), and `createRelay` starts with a bad `STAFF_CODES`.

- [ ] **Step 3: Implement in `relay/server.js`**

Imports — after `import { nightOf } from './night.js';` add:

```js
import { checkCode, isEntry } from './staff.js';
```

Constants — after `const FRAMES_A_SECOND = 20; …` add:

```js
const STAFF_TOKENS_MAX = 1000;        // staff sign-ins kept for tonight; past it the oldest is forgotten
const CODE_MAX = 200;                 // the longest passcode a staff sign-in may carry
```

After `loadShows()` add:

```js
/**
 * STAFF_CODES: a JSON object of venue id -> passcode entry (relay/staff.js), or nothing. Anything else throws
 * when the relay starts, naming the venue and never the entry.
 */
export function readStaffCodes(text) {
  const entries = new Map();
  if (!text) return entries;
  let all;
  try { all = JSON.parse(text); } catch { throw new Error('STAFF_CODES is not JSON'); }
  if (!all || typeof all !== 'object' || Array.isArray(all)) throw new Error('STAFF_CODES is not an object of venue -> entry');
  for (const [venue, entry] of Object.entries(all)) {
    if (!venue || venueKey(venue) !== venue) throw new Error('STAFF_CODES: ' + JSON.stringify(venue) + ' is not a venue id');
    if (!isEntry(entry)) throw new Error('STAFF_CODES: the entry for ' + venue + ' is not one npm run staff-code makes');
    entries.set(venue, entry);
  }
  return entries;
}
```

In `createRelay`'s doc comment, after the sentence ending `the machine's own by default.` add:

```js
 * `staffCodes` is STAFF_CODES (readStaffCodes()): the venues with a staff page, and their passcodes' entries.
```

Its options gain `staffCodes`:

```js
  clientIpHeader, allClipsMax = ALL_CLIPS_MAX, staffCodes = process.env.STAFF_CODES } = {}) {
```

After `nightOf(now(), nightTz);` add:

```js
  // The venues with a staff page (docs/superpowers/specs/2026-09-28-staff-reports-design.md §2). A mistake in
  // STAFF_CODES throws here too.
  const staffEntries = readStaffCodes(staffCodes);
```

The room record comment and `rooms.set(…)`: replace

```js
  // key -> { room, sockets:Set, clips:Map(ref -> {mime, buf, by, slot, at}), left:Map(id -> timer),
  //          heard:Map(id -> when a phone of theirs last spoke) }
```

with

```js
  // key -> { room, sockets:Set, clips:Map(ref -> {mime, buf, by, slot, at}), left:Map(id -> timer),
  //          heard:Map(id -> when a phone of theirs last spoke), staff:Set of signed-in staff sockets }
```

and in `roomFor()` replace

```js
      rooms.set(key, { key, room: createRoom({ spots, now }), sockets: new Set(), clips: new Map(), left: new Map(), heard: new Map(), sound: new Map() });
```

with

```js
      rooms.set(key, { key, room: createRoom({ spots, now }), sockets: new Set(), clips: new Map(), left: new Map(), heard: new Map(), sound: new Map(), staff: new Set() });
```

After `const tries = new Map();   // address -> [times of wrong codes]` add:

```js
  // Staff signed in with a right passcode tonight: token -> { key, night }. Good until the venue's 06:00.
  const tokens = new Map();
  // Staff see a reported person as a tag: the same at one venue all night, and nothing like any handle a phone
  // is shown. A restart draws a new key, so new tags.
  const staffKey = randomBytes(32);
  const tagOf = (key, id) => 'P-' + createHmac('sha256', staffKey).update(key + '|' + id).digest('hex').slice(0, 4).toUpperCase();
```

After `pushNow()` add:

```js
  /** The venue's reports, to its signed-in staff sockets that do not have this list yet. */
  function reportsTo(r, sockets = r.staff) {
    if (!sockets.size) return;
    const text = JSON.stringify({ t: 'reports', reports: r.room.staffReports((id) => tagOf(r.key, id)) });
    for (const ws of sockets) if (text !== ws.lastReports) { ws.lastReports = text; ws.send(text); }
  }
```

Before `function handle(ws, m) {` add:

```js
  // ---------- staff (docs/superpowers/specs/2026-09-28-staff-reports-design.md §3) ----------
  // A socket is a phone, a wristband or staff, and only one. Staff sign in with their venue's passcode, or the
  // token a right one got tonight, and are then sent the venue's reports; they can only mark them.

  async function staffIn(ws, m) {
    const answer = (x) => ws.send(JSON.stringify({ t: 'staff', ...x }));
    if (ws.staffing) return;   // one sign-in at a time: the page waits for its answer
    if (ws.me || ws.band) { answer({ ok: false, why: 'bad staff' }); return; }
    const key = venueKey(m.venue);
    if (typeof m.token === 'string') {
      const t = tokens.get(m.token);
      if (!t || t.key !== key || t.night !== nightOf(now(), nightTz)) { answer({ ok: false, why: 'expired' }); return; }
      signIn(ws, key, m.token, t.night);
      return;
    }
    if (typeof m.code !== 'string') { answer({ ok: false, why: 'bad staff' }); return; }
    if (tooMany(ws)) { answer({ ok: false, why: 'too many tries' }); return; }
    attempt(ws);   // every sign-in by passcode counts, right or wrong, on the pairing counters
    const entry = staffEntries.get(key);
    if (!entry) { answer({ ok: false, why: 'no staff page' }); return; }
    ws.staffing = true;
    const right = await checkCode(entry, m.code.slice(0, CODE_MAX));
    ws.staffing = false;
    if (closing || ws.readyState !== ws.OPEN) return;
    // It may have joined as a phone, or said hello as a wristband, while the check ran.
    if (ws.me || ws.band) { answer({ ok: false, why: 'bad staff' }); return; }
    if (!right) { answer({ ok: false, why: 'wrong code' }); return; }
    const token = randomBytes(16).toString('hex');
    const night = nightOf(now(), nightTz);
    tokens.set(token, { key, night });
    if (tokens.size > STAFF_TOKENS_MAX) tokens.delete(tokens.keys().next().value);
    signIn(ws, key, token, night);
  }

  function signIn(ws, key, token, night) {
    const r = roomFor(key);
    if (!r) { ws.send(JSON.stringify({ t: 'staff', ok: false, why: 'too many venues' })); return; }
    ws.staff = { key, night };
    r.staff.add(ws);
    ws.send(JSON.stringify({ t: 'staff', ok: true, venue: key, token }));
    reportsTo(r, new Set([ws]));
  }

```

In `handle()`, replace:

```js
    if (m.t === 'ping') { ws.send('{"t":"pong"}'); return; }
    if (m.t === 'wristband') { hello(ws, m); return; }
```

with:

```js
    if (m.t === 'ping') { ws.send('{"t":"pong"}'); return; }
    // A signed-in staff socket is only that: what a phone or a wristband would say is ignored.
    if (ws.staff) return;
    // Its check runs off the event loop; a failure there ends this socket, never the process.
    if (m.t === 'staff') { staffIn(ws, m).catch(() => ws.terminate()); return; }
    if (m.t === 'wristband') { hello(ws, m); return; }
```

In the socket's `close` handler, replace:

```js
    ws.on('close', () => {
      const b = ws.band && bands.get(ws.band);
```

with:

```js
    ws.on('close', () => {
      if (ws.staff) {
        const sr = rooms.get(ws.staff.key);
        if (sr) {
          sr.staff.delete(ws);
          if (!closing) gcRoom(sr);
        }
        return;
      }
      const b = ws.band && bands.get(ws.band);
```

In `gcRoom()`, replace:

```js
    if (r.sockets.size || r.left.size || r.clips.size) return;
```

with:

```js
    if (r.sockets.size || r.left.size || r.clips.size || r.staff.size) return;
```

and its comment's first line `// A venue with nobody in it, nobody in its grace window, no clip still loading` becomes `// A venue with nobody in it, nobody in its grace window, no staff signed in, no clip still loading`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/staff.test.js tests/server.test.js`
Expected: PASS, every test.

- [ ] **Step 5: Mutation check (P1)** — `staff-task-3.json`, test file `tests/staff.test.js`:

```json
[
  { "label": "a phone may sign in as staff", "file": "relay/server.js",
    "from": "    if (ws.me || ws.band) { answer({ ok: false, why: 'bad staff' }); return; }\n    const key = venueKey(m.venue);",
    "to": "    const key = venueKey(m.venue);",
    "test": "tests/staff.test.js", "expect": ["a phone or a wristband cannot sign in as staff"] },
  { "label": "a join during the check is not seen", "file": "relay/server.js",
    "from": "    // It may have joined as a phone, or said hello as a wristband, while the check ran.\n    if (ws.me || ws.band) { answer({ ok: false, why: 'bad staff' }); return; }",
    "to": "",
    "test": "tests/staff.test.js", "expect": ["a phone or a wristband cannot sign in as staff"] },
  { "label": "staff may act as a phone", "file": "relay/server.js",
    "from": "    if (ws.staff) return;", "to": "",
    "test": "tests/staff.test.js", "expect": ["a phone or a wristband cannot sign in as staff"] },
  { "label": "sign-ins are not counted", "file": "relay/server.js",
    "from": "    attempt(ws);   // every sign-in by passcode counts", "to": "    // every sign-in by passcode counts",
    "test": "tests/staff.test.js", "expect": ["a wrong passcode is refused and counted"] },
  { "label": "a token works at any venue", "file": "relay/server.js",
    "from": "if (!t || t.key !== key || t.night", "to": "if (!t || t.night",
    "test": "tests/staff.test.js", "expect": ["a token signs in again"] },
  { "label": "staff do not hold the room", "file": "relay/server.js",
    "from": "r.clips.size || r.staff.size) return;", "to": "r.clips.size) return;",
    "test": "tests/staff.test.js", "expect": ["signing in makes the venue's room"] },
  { "label": "a closed staff socket holds the room", "file": "relay/server.js",
    "from": "          sr.staff.delete(ws);\n", "to": "",
    "test": "tests/staff.test.js", "expect": ["signing in makes the venue's room"] },
  { "label": "a bad entry is taken", "file": "relay/server.js",
    "from": "    if (!isEntry(entry)) throw", "to": "    if (false) throw",
    "test": "tests/staff.test.js", "expect": ["STAFF_CODES is read whole"] }
]
```

Expected: `ALL MUTATIONS HELD`.

- [ ] **Step 6: Whole suite, commit, push**

Run: `npm test` — expected: every test passes.

```bash
git add relay/server.js tests/staff.test.js
git commit -m "Staff sign in to their venue with its passcode" -m "STAFF_CODES is read when the relay starts, or it does not start. A socket is a phone, a wristband or staff: {t:'staff', venue, code} is checked by scrypt off the event loop and counted with pairing attempts; a right one gets a token until 06:00 that signs in again after a reconnect, only at its venue. Signed in, a socket is sent the venue's reports at once, the reported person only as an HMAC tag, and ignores everything a phone or a wristband says; its room is not let go while it is there." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 4: Reports reach staff live, staff mark them, and the night ends at 06:00

**Files:**
- Modify: `relay/server.js` (`pushNow()`; `handledBy()`; `handle()`; the `report` case; `gcRoom()`; `expire()`)
- Test: `tests/staff.test.js` (six tests appended)

**Interfaces:**
- Consumes: `room.markHandled`, `room.forgetReports`, `room.hasReports` (Task 1); `reportsTo`, `tokens`, `ws.staff`, `r.staff`, `staffEntries` (Task 3).
- Produces: `{t:'handled', id, on}` from staff; `{t:'reports', …}` on every change; a staff socket closed 4004 at 06:00.

- [ ] **Step 1: Write the failing tests** — append to `tests/staff.test.js`:

```js
test('a report made after sign-in reaches staff within a second: a tag, how often, both bands, the words — never who', async () => {
  const { phone, signedIn } = await start();
  const s = await signedIn();
  const ana = await phone('staff-venue');
  const ben = await phone('staff-venue');
  ana.send({ t: 'profile', name: 'Ana', contact: '@ana-contact' });
  ben.send({ t: 'profile', name: 'Ben', contact: '@ben-contact' });
  ben.send({ t: 'arm', intent: 'hi' });
  const { near: [row] } = await ana.until((v) => v.near.length === 1);
  const sent = Date.now();
  ana.send({ t: 'report', handle: row.handle, why: 'followed me to the bar' });
  await s.until(() => s.list().length === 1);
  assert.ok(Date.now() - sent < 1000, 'within a second');
  const [r] = s.list();
  assert.match(r.about, /^P-[0-9A-F]{4}$/);
  assert.deepEqual({ ...r, about: 'tag' }, {
    id: 'r1', at: EIGHT_PM, about: 'tag', times: 1, people: 1, bandNow: 'in this room', bandThen: 'in this room',
    fromThen: 'in this room', why: 'followed me to the bar', handledAt: 0,
  });
  ana.send({ t: 'report', handle: null, why: 'a spill by the stairs' });
  await s.until(() => s.list().length === 2);
  assert.deepEqual([s.list()[0].about, s.list()[0].why], [null, 'a spill by the stairs'], 'something else, newest first');
  const text = JSON.stringify(s.lists);
  for (const secret of [ana.me, ben.me, row.handle, 'Ana', 'Ben', '@ana-contact', '@ben-contact']) {
    assert.equal(text.includes(secret), false, secret + ' reached staff');
  }
});

test('words from a phone are kept only as a string, and cut to 200 characters', async () => {
  const { phone, signedIn } = await start();
  const s = await signedIn();
  const ana = await phone('staff-venue');
  for (const why of [{ toString: 'x' }, ['a list'], 42, 'x'.repeat(250)]) ana.send({ t: 'report', why });
  await s.until(() => s.list().length === 4);
  assert.deepEqual(s.list().map((r) => r.why.length), [200, 0, 0, 0]);
});

test('two staff screens see one mark; a mark is for its own venue only, and only a yes or a no', async () => {
  const { phone, signedIn } = await start();
  const one = await signedIn();
  const two = await signedIn();
  const other = await signedIn('staff-other', 'test-passcode-2');
  const ana = await phone('staff-venue');
  ana.send({ t: 'report', why: 'spill' });
  await two.until(() => two.list().length === 1);
  other.send({ t: 'handled', id: 'r1', on: true });   // its own venue has no r1
  one.send({ t: 'handled', id: 'r1', on: 'yes' });
  one.send({ t: 'handled', id: 1, on: true });
  await pause(300);
  assert.equal(two.list()[0].handledAt, 0);
  one.send({ t: 'handled', id: 'r1', on: true });
  await two.until(() => two.list()[0].handledAt === EIGHT_PM);
  one.send({ t: 'handled', id: 'r1', on: false });
  await two.until(() => two.list()[0].handledAt === 0);
  assert.deepEqual(other.list(), [], 'the other venue saw nothing');
});

test('a venue with a staff page keeps tonight\'s reports with nobody in it, till 06:00; another venue does not', async () => {
  const { relay, clock, phone, reply, signedIn } = await start();
  const ana = await phone('staff-venue');
  ana.send({ t: 'report', why: 'spill' });
  const left = reply(ana, 'left');
  ana.send({ t: 'leave' });
  await left;
  relay.expire(clock.t);
  assert.equal(relay.rooms.has('staff-venue'), true, 'its reports hold it');
  const later = await signedIn();
  assert.equal(later.list().length, 1, 'staff who sign in later still see it');
  later.ws.close();
  await later.until(() => later.closed !== null);
  const eve = await phone('moth-club-kayo-lane');
  eve.send({ t: 'report', why: 'x' });
  const gone = reply(eve, 'left');
  eve.send({ t: 'leave' });
  await gone;
  assert.equal(relay.rooms.has('moth-club-kayo-lane'), false, 'a venue with no staff page lets go as before');
  await pause(100);
  clock.t = NEXT_MORNING;
  relay.expire(clock.t);
  assert.equal(relay.rooms.has('staff-venue'), false, '06:00 clears them, and the room goes');
});

test('at 06:00 the night\'s reports go, staff are signed out as expired, and the token no longer signs in', async () => {
  const { relay, clock, phone, staff, signedIn } = await start();
  const s = await staff();
  const { token } = await s.signIn({ venue: 'staff-venue', code: 'test-passcode-1' });
  const ana = await phone('staff-venue');
  ana.send({ t: 'report', why: 'late one' });
  await s.until(() => s.list()?.length === 1);
  clock.t = NEXT_MORNING;
  const early = await staff();
  assert.equal((await early.signIn({ venue: 'staff-venue', token })).why, 'expired', 'before the sweep has run');
  relay.expire(clock.t);
  await s.until(() => s.closed === 4004);
  assert.deepEqual(s.answers.at(-1), { t: 'staff', ok: false, why: 'expired' });
  const back = await staff();
  assert.equal((await back.signIn({ venue: 'staff-venue', token })).why, 'expired');
  const fresh = await signedIn();
  assert.deepEqual(fresh.list(), [], 'a new night starts with none');
});

test('the relay\'s log says a report came, and never what it says or who made it', async () => {
  const { phone } = await start();
  const ana = await phone('staff-venue');
  const logged = [];
  const was = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  try {
    ana.send({ t: 'report', why: 'secret words' });
    await pause(300);
  } finally {
    console.log = was;
  }
  assert.deepEqual(logged.filter((l) => l.startsWith('REPORT')), ['REPORT staff-venue r1']);
  assert.equal(logged.some((l) => l.includes('secret words') || l.includes(ana.me)), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/staff.test.js`
Expected: FAIL — the six new tests (no list after a report, no mark, the room let go with its reports, no sign-out at 06:00, the log line carries the report); the Task 3 tests still pass.

- [ ] **Step 3: Implement in `relay/server.js`**

At the end of `pushNow()`, after the `for (const b of bands.values()) …` line, add:

```js
    reportsTo(r);
```

After `signIn()` add:

```js
  /** A staff socket marks a report of its own venue handled, or opens it again: every staff screen there sees it. */
  function handledBy(ws, m) {
    if (typeof m.id !== 'string' || typeof m.on !== 'boolean') return;
    const r = rooms.get(ws.staff.key);
    // Only while signed in there: a socket signed out at 06:00 may still be closing.
    if (r?.staff.has(ws) && r.room.markHandled(m.id, m.on)) push(r);
  }
```

In `handle()`, replace:

```js
    // A signed-in staff socket is only that: what a phone or a wristband would say is ignored.
    if (ws.staff) return;
```

with:

```js
    // A signed-in staff socket only marks reports: what a phone or a wristband would say is ignored.
    if (ws.staff) { if (m.t === 'handled') handledBy(ws, m); return; }
```

Replace the `report` case:

```js
      case 'report':
        // The venue team's copy. A real deployment sends this to their radio or dashboard.
        if (room.report(me, m.handle || null, m.why)) console.log('REPORT', JSON.stringify(room.reports().at(-1)));
        break;
```

with:

```js
      case 'report':
        // To the venue's staff page, with the push below. The log says one came and nothing it says: logs are kept.
        if (room.report(me, m.handle || null, m.why)) console.log('REPORT', r.key, room.reports().at(-1).id);
        break;
```

In `gcRoom()`, after the line `if (r.sockets.size || r.left.size || r.clips.size || r.staff.size) return;` add:

```js
    // A venue with a staff page keeps tonight's reports for its team once everyone has gone; 06:00 clears them.
    if (staffEntries.has(r.key) && r.room.hasReports()) return;
```

In `expire()`, before the last line `for (const r of [...rooms.values()]) gcRoom(r);` add:

```js
    // 06:00: a night's reports go, and staff signed in for it are signed out; the page asks for the passcode again.
    const tonight = night(at);
    for (const [token, t] of tokens) if (t.night !== tonight) tokens.delete(token);
    for (const r of rooms.values()) {
      for (const ws of [...r.staff]) {
        if (ws.staff.night === tonight) continue;
        r.staff.delete(ws);
        ws.send(JSON.stringify({ t: 'staff', ok: false, why: 'expired' }));
        ws.close(4004, 'expired');
      }
      if (r.room.forgetReports((t) => night(t) !== tonight)) push(r);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/staff.test.js tests/server.test.js tests/room.test.js`
Expected: PASS, every test.

- [ ] **Step 5: Mutation check (P1)** — `staff-task-4.json`, test file `tests/staff.test.js`:

```json
[
  { "label": "no list after a change", "file": "relay/server.js",
    "from": "    reportsTo(r);\n", "to": "",
    "test": "tests/staff.test.js",
    "expect": ["a report made after sign-in reaches staff", "words from a phone are kept only as a string", "two staff screens see one mark", "at 06:00 the night's reports go"] },
  { "label": "a mark takes anything", "file": "relay/server.js",
    "from": "if (typeof m.id !== 'string' || typeof m.on !== 'boolean') return;", "to": "if (typeof m.id !== 'string') return;",
    "test": "tests/staff.test.js", "expect": ["two staff screens see one mark"] },
  { "label": "reports do not hold a staff venue", "file": "relay/server.js",
    "from": "    if (staffEntries.has(r.key) && r.room.hasReports()) return;\n", "to": "",
    "test": "tests/staff.test.js", "expect": ["a venue with a staff page keeps tonight's reports"] },
  { "label": "the log carries the report", "file": "relay/server.js",
    "from": "console.log('REPORT', r.key, room.reports().at(-1).id);", "to": "console.log('REPORT', JSON.stringify(room.reports().at(-1)));",
    "test": "tests/staff.test.js", "expect": ["the relay's log says a report came"] },
  { "label": "staff stay signed in past 06:00", "file": "relay/server.js",
    "from": "        if (ws.staff.night === tonight) continue;", "to": "        continue;",
    "test": "tests/staff.test.js", "expect": ["at 06:00 the night's reports go"] },
  { "label": "reports outlive the night", "file": "relay/server.js",
    "from": "      if (r.room.forgetReports((t) => night(t) !== tonight)) push(r);", "to": "",
    "test": "tests/staff.test.js", "expect": ["a venue with a staff page keeps tonight's reports", "at 06:00 the night's reports go"] },
  { "label": "a token outlives its night until the sweep", "file": "relay/server.js",
    "from": "t.key !== key || t.night !== nightOf(now(), nightTz))", "to": "t.key !== key)",
    "test": "tests/staff.test.js", "expect": ["at 06:00 the night's reports go"] }
]
```

Expected: `ALL MUTATIONS HELD`.

- [ ] **Step 6: Whole suite, commit, push**

Run: `npm test` — expected: every test passes.

```bash
git add relay/server.js tests/staff.test.js
git commit -m "Reports reach a venue's staff live, and the night ends at 06:00" -m "Every room push sends the venue's staff the reports list when it changed: a report made, one marked, someone reported arriving, moving area or leaving. {t:'handled', id, on} marks one for every staff screen at the venue. A venue with a staff page keeps tonight's reports once everyone has gone; at 06:00 they go, staff signed in for the night are told expired and closed (4004), and old tokens stop. The log line says only which venue and which report." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 5: The staff page

**Files:**
- Create: `app/staff.html`, `app/staff/main.jsx`, `app/staff/Staff.jsx`, `app/staff/line.js`, `app/staff/list.js`, `app/staff/staff.css`
- Modify: `vite.config.js` (two inputs), `relay/server.js` (`serveStatic()`: `/staff`), `app/public/sw.js` (never the staff page; `otb-shell-v2`)
- Test: `tests/staff-page.test.js` (new), `tests/staff.test.js` (one test appended)

**Interfaces:**
- Consumes: the frames of Tasks 3 and 4; `/api/shows`.
- Produces: `app/staff/list.js` exports `REFUSED`, `ordered(reports)`, `openCount(reports)`, `whoLine(r)`, `whereLine(r)`, `freshIds(seen: Set|null, reports)`, `titleFor(label, open)`, `timeOf(at)`; `connectStaff({ onOpen, onMessage, onStatus })` → `{ send(m): boolean, close() }`.

- [ ] **Step 1: Write the failing tests**

`tests/staff-page.test.js`:

```js
// ON THE BEAT — the staff page's words and order (app/staff/list.js), that the build made the page, and that the
// offline shell never keeps it (docs/superpowers/specs/2026-09-28-staff-reports-design.md §4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { REFUSED, freshIds, openCount, ordered, timeOf, titleFor, whereLine, whoLine } from '../app/staff/list.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const report = (x) => ({
  id: 'r1', at: 0, about: 'P-4F2A', times: 1, people: 1, bandNow: 'near the bar', bandThen: 'near the bar',
  fromThen: 'by the stage', why: '', handledAt: 0, ...x,
});

test('open reports come first, newest first, then handled ones, newest first', () => {
  const list = [report({ id: 'r4', handledAt: 9 }), report({ id: 'r3' }), report({ id: 'r2', handledAt: 5 }), report({ id: 'r1' })];
  assert.deepEqual(ordered(list).map((r) => r.id), ['r3', 'r1', 'r4', 'r2']);
  assert.equal(openCount(list), 2);
});

test('who a report is about: a tag, how often and by how many — or something else', () => {
  assert.equal(whoLine(report({ times: 3, people: 2 })), 'About someone · P-4F2A · reported 3 times by 2 people');
  assert.equal(whoLine(report()), 'About someone · P-4F2A · reported once by 1 person');
  assert.equal(whoLine(report({ about: null, times: 0, people: 0 })), 'Something else');
});

test('where: now, then, and the reporter — and a person who left', () => {
  assert.equal(whereLine(report()), 'now near the bar · then near the bar · reporter was by the stage');
  assert.equal(whereLine(report({ bandNow: 'left' })), 'now: left · then near the bar · reporter was by the stage');
  assert.equal(whereLine(report({ about: null, bandNow: null, bandThen: null })), 'reporter was by the stage');
});

test('a new report is one the last list did not have; the first list has none', () => {
  assert.deepEqual(freshIds(null, [report()]), []);
  assert.deepEqual(freshIds(new Set(['r1']), [report({ id: 'r2' }), report()]), ['r2']);
});

test('the tab counts the open ones, and a time reads as the venue\'s clock', () => {
  assert.equal(titleFor('The Roundhouse, Camden · BRUNO MARS', 2), '(2) Staff · The Roundhouse, Camden · BRUNO MARS');
  assert.equal(titleFor('The Roundhouse, Camden · BRUNO MARS', 0), 'Staff · The Roundhouse, Camden · BRUNO MARS');
  assert.match(timeOf(Date.UTC(2026, 8, 28, 10, 5)), /^\d{2}:\d{2}$/);
});

test('every refusal the relay can give has words of its own', () => {
  for (const why of ['no staff page', 'wrong code', 'too many tries', 'expired', 'bad staff', 'too many venues']) assert.ok(REFUSED[why], why);
  assert.equal(new Set(Object.values(REFUSED)).size, Object.keys(REFUSED).length);
});

test('the build made the staff page', () => {
  const page = readFileSync(root + 'dist/staff.html', 'utf8');
  assert.match(page, /<title>Staff · On The Beat<\/title>/);
  assert.match(page, /src="\/assets\/[^"]+\.js"/);
});

test('the offline shell never keeps the staff page, nor answers for it', () => {
  const listeners = {};
  const context = {
    self: { addEventListener: (type, f) => { listeners[type] = f; } },
    location: { origin: 'https://otb.test' },
    URL,
    caches: {},
    fetch: () => new Promise(() => {}),
  };
  vm.runInNewContext(readFileSync(root + 'app/public/sw.js', 'utf8'), context);
  const answered = (path) => {
    let took = false;
    listeners.fetch({ request: { url: 'https://otb.test' + path, method: 'GET', mode: 'navigate' }, respondWith: () => { took = true; } });
    return took;
  };
  assert.equal(answered('/staff'), false);
  assert.equal(answered('/staff/'), false);
  assert.equal(answered('/staff.html'), false);
  assert.equal(answered('/'), true, 'the app itself is still kept');
  assert.equal(answered('/tonight'), true);
});
```

Append to `tests/staff.test.js`:

```js
test('the relay serves the staff page at /staff, and the app everywhere else', async () => {
  const { relay } = await start();
  const get = async (path) => (await fetch('http://127.0.0.1:' + relay.port + path)).text();
  for (const path of ['/staff', '/staff/', '/staff?venue=x']) assert.match(await get(path), /<title>Staff<\/title>/, path);
  for (const path of ['/', '/tonight', '/staffroom', '/staff/x']) assert.match(await get(path), /<title>On The Beat<\/title>/, path);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/staff-page.test.js tests/staff.test.js`
Expected: FAIL — `Cannot find module '…/app/staff/list.js'`, and `/staff` served the app's `index.html`.

- [ ] **Step 3: Write `app/staff/list.js`**

```js
// ON THE BEAT — the staff page's words for a report, and their order
// (docs/superpowers/specs/2026-09-28-staff-reports-design.md §4). Pure, so they are tested without a browser.

/** What the page says for each way the relay can refuse a sign-in. */
export const REFUSED = {
  'no staff page': 'This venue has no staff page yet.',
  'wrong code': 'That passcode is not right.',
  'too many tries': 'Too many tries. Wait a minute, then try again.',
  expired: 'Signed out: it is a new night, or the relay restarted. Enter the passcode again.',
  'bad staff': 'This page could not sign in. Reload it and try again.',
  'too many venues': 'The relay is full right now. Try again in a minute.',
};

/** Open reports first, then handled ones; each newest first, as the relay sends them. */
export const ordered = (reports) => [...reports].sort((a, b) => (a.handledAt ? 1 : 0) - (b.handledAt ? 1 : 0));

export const openCount = (reports) => reports.filter((r) => !r.handledAt).length;

/** About someone · P-4F2A · reported 3 times by 2 people, or Something else. */
export function whoLine(r) {
  if (!r.about) return 'Something else';
  const times = r.times === 1 ? 'reported once' : 'reported ' + r.times + ' times';
  const by = r.people === 1 ? 'by 1 person' : 'by ' + r.people + ' people';
  return 'About someone · ' + r.about + ' · ' + times + ' ' + by;
}

/** now near the bar · then near the bar · reporter was by the stage; now: left once they have gone. */
export function whereLine(r) {
  const parts = [];
  if (r.about) {
    parts.push(r.bandNow === 'left' ? 'now: left' : 'now ' + r.bandNow);
    if (r.bandThen) parts.push('then ' + r.bandThen);
  }
  parts.push('reporter was ' + r.fromThen);
  return parts.join(' · ');
}

/** The ids in this list the last one did not have. The first list, after a sign-in, has none new. */
export const freshIds = (seen, reports) => (seen ? reports.filter((r) => !seen.has(r.id)).map((r) => r.id) : []);

/** The tab's title: how many are open, and where. */
export const titleFor = (label, open) => (open ? '(' + open + ') ' : '') + 'Staff · ' + label;

/** When a report was made, on a 24-hour clock: 20:05. */
export const timeOf = (at) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
```

- [ ] **Step 4: Write `app/staff/line.js`**

```js
// ON THE BEAT — the staff page's line to the relay (docs/superpowers/specs/2026-09-28-staff-reports-design.md §3).
//
// As the phone's (app/lib/net.js), a socket can die without closing: the page asks every two seconds and takes
// six of silence as a dead socket. Every time a socket opens, `onOpen` signs in again with tonight's token.

const PING_EVERY = 2000;
const DEAF_MS = 6000;

export function connectStaff({ onOpen, onMessage, onStatus }) {
  let ws = null;
  let heard = 0;
  let closed = false;
  let retry = null;
  let backoff = 500;
  const isOpen = () => ws && ws.readyState === 1;
  const send = (m) => {
    if (!isOpen()) return false;
    ws.send(JSON.stringify(m));
    return true;
  };

  function open() {
    clearTimeout(retry);
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const sock = new WebSocket(proto + location.host + '/api/ws');
    ws = sock;
    onStatus?.('connecting');
    sock.onopen = () => {
      if (ws !== sock) return;
      heard = Date.now();
      backoff = 500;
      onStatus?.('live');
      onOpen?.();
    };
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      heard = Date.now();
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t !== 'pong') onMessage?.(m);
    };
    sock.onclose = () => { if (ws === sock) again(); };
    sock.onerror = () => {};
  }

  function again() {
    if (closed) return;
    const old = ws;
    ws = null;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try { old.close(); } catch { /* already gone */ }
    }
    onStatus?.('offline');
    retry = setTimeout(open, backoff);
    backoff = Math.min(backoff * 2, 5000);
  }

  const beat = setInterval(() => {
    if (!isOpen()) return;
    if (Date.now() - heard > DEAF_MS) { again(); return; }
    send({ t: 'ping' });
  }, PING_EVERY);
  const onOnline = () => { if (!isOpen()) { clearTimeout(retry); backoff = 500; open(); } };
  window.addEventListener('online', onOnline);
  open();

  return {
    /** Sent now, or false with no live socket: a sign-in or a mark is never queued. */
    send,
    close() {
      closed = true;
      clearInterval(beat);
      clearTimeout(retry);
      window.removeEventListener('online', onOnline);
      const old = ws;
      ws = null;
      if (old) { old.onclose = null; try { old.close(); } catch { /* gone */ } }
    },
  };
}
```

- [ ] **Step 5: Write `app/staff/Staff.jsx`**

```jsx
// ON THE BEAT — the staff page (docs/superpowers/specs/2026-09-28-staff-reports-design.md §4): a venue's team
// signs in with its passcode, sees reports as they come, marks them handled, and hears a new one after a tap.
// It shares nothing with the app: all it keeps is tonight's token, in this tab.

import { useCallback, useEffect, useRef, useState } from 'react';
import { connectStaff } from './line.js';
import { REFUSED, freshIds, openCount, ordered, timeOf, titleFor, whereLine, whoLine } from './list.js';

const SESSION = 'otb:staff';   // { venue, token } in sessionStorage
const readSession = () => { try { return JSON.parse(sessionStorage.getItem(SESSION)) || null; } catch { return null; } };
const writeSession = (s) => {
  try {
    if (s) sessionStorage.setItem(SESSION, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION);
  } catch { /* no storage: signed in until this page closes */ }
};

/** Two short notes, to be heard across a bar. */
function chime(ctx) {
  const t = ctx.currentTime;
  [880, 1320].forEach((f, i) => {
    const at = t + i * 0.18;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + 0.18);
  });
}

export default function Staff() {
  const [shows, setShows] = useState([]);
  const [session, setSession] = useState(readSession);
  const [venue, setVenue] = useState(() => readSession()?.venue || '');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('connecting');
  const [reports, setReports] = useState(null);
  const [flash, setFlash] = useState(0);
  const [hearing, setHearing] = useState(false);
  const line = useRef(null);
  const sessionRef = useRef(session);
  const seen = useRef(null);    // the ids of the last list, or null before the first
  const audio = useRef(null);

  useEffect(() => {
    fetch('/api/shows').then((r) => r.json()).then((list) => {
      const all = Array.isArray(list) ? list : [];
      setShows(all);
      setVenue((v) => v || all[0]?.id || '');
    }).catch(() => {});
  }, []);

  const onMessage = useCallback((m) => {
    if (m.t === 'staff') {
      setPending(false);
      if (m.ok) {
        const s = { venue: m.venue, token: m.token };
        writeSession(s);
        sessionRef.current = s;
        setSession(s);
        setError('');
        setCode('');
        return;
      }
      writeSession(null);
      sessionRef.current = null;
      seen.current = null;
      setSession(null);
      setReports(null);
      setCode('');
      setError(REFUSED[m.why] || REFUSED['bad staff']);
      return;
    }
    if (m.t === 'reports' && Array.isArray(m.reports)) {
      const fresh = freshIds(seen.current, m.reports);
      seen.current = new Set(m.reports.map((r) => r.id));
      setReports(m.reports);
      if (fresh.length) {
        setFlash((n) => n + 1);
        if (audio.current?.state === 'running') chime(audio.current);
      }
    }
  }, []);

  useEffect(() => {
    const l = connectStaff({
      onOpen: () => {
        const s = sessionRef.current;
        if (s) l.send({ t: 'staff', venue: s.venue, token: s.token });
      },
      onMessage,
      onStatus: (s) => {
        setStatus(s);
        if (s !== 'live') setPending(false);
      },
    });
    line.current = l;
    return () => l.close();
  }, [onMessage]);

  // A browser plays sound only after a tap on the page: the first one opens it.
  useEffect(() => {
    const unlock = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audio.current ??= new Ctx();
        audio.current.resume().then(() => setHearing(audio.current.state === 'running')).catch(() => {});
      } catch { /* no sound here */ }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const label = (id) => {
    const s = shows.find((x) => x.id === id);
    return s ? s.venue + ' · ' + s.act : id;
  };
  const open = reports ? openCount(reports) : 0;
  useEffect(() => {
    document.title = session ? titleFor(label(session.venue), open) : 'Staff · On The Beat';
  });

  const signIn = (e) => {
    e.preventDefault();
    if (!venue || !code || pending) return;
    setError('');
    if (!line.current?.send({ t: 'staff', venue, code })) { setError('Not connected yet. Try again in a moment.'); return; }
    setPending(true);
  };
  const signOut = () => {
    writeSession(null);
    location.reload();
  };
  const mark = (r) => line.current?.send({ t: 'handled', id: r.id, on: !r.handledAt });

  if (session) {
    return (
      <main className="staff">
        <header key={flash} className={'staff-top' + (flash ? ' flash' : '')}>
          <div style={{ minWidth: 0 }}>
            <div className="h2">{label(session.venue)}</div>
            <div className="small">
              {reports ? open + ' open' : 'signing in…'} · {status === 'live' ? 'live' : 'reconnecting…'}
            </div>
          </div>
          <button type="button" className="btn-s" onClick={signOut}>SIGN OUT</button>
        </header>
        {!hearing ? <p className="staff-note small">Tap anywhere to hear new reports.</p> : null}
        {reports && !reports.length ? <p className="staff-note small">No reports tonight.</p> : null}
        {reports ? ordered(reports).map((r) => (
          <article key={r.id} className={'staff-report' + (r.handledAt ? ' done' : '')}>
            <div className="staff-line">
              <span className="staff-time">{timeOf(r.at)}</span>
              <span className="body">{whoLine(r)}</span>
            </div>
            <div className="small">{whereLine(r)}</div>
            {r.why ? <p className="staff-why body">{r.why}</p> : null}
            <button type="button" className="btn-s" onClick={() => mark(r)}>{r.handledAt ? 'REOPEN' : 'HANDLED'}</button>
          </article>
        )) : null}
      </main>
    );
  }

  return (
    <main className="staff staff-in">
      <h1 className="h1">Staff</h1>
      <p className="small">Reports from people at your venue, as they come in. Names, contacts and who reported are never shown.</p>
      <form className="staff-form" onSubmit={signIn}>
        <label className="label" htmlFor="venue">Venue</label>
        {shows.length ? (
          <select id="venue" className="staff-input" value={venue} onChange={(e) => setVenue(e.target.value)}>
            {shows.map((s) => <option key={s.id} value={s.id}>{s.venue + ' · ' + s.act}</option>)}
          </select>
        ) : (
          <input id="venue" className="staff-input" value={venue} onChange={(e) => setVenue(e.target.value)}
            placeholder="the venue's show id" autoComplete="off" />
        )}
        <label className="label" htmlFor="code">Passcode</label>
        <input id="code" className="staff-input" type="password" value={code} autoComplete="current-password"
          onChange={(e) => setCode(e.target.value.slice(0, 200))} />
        {error ? <p className="staff-error small" role="alert">{error}</p> : null}
        <button type="submit" className="cta" style={{ '--c': 'var(--hi)', '--g': 'transparent' }}
          disabled={!venue || !code || pending || status !== 'live'}>
          {pending ? 'SIGNING IN…' : 'SIGN IN'}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 6: Write the page's shell and styles**

`app/staff.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<meta name="robots" content="noindex">
<title>Staff · On The Beat</title>
<link rel="icon" href="/icon-192.png" sizes="192x192">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Chewy&display=swap" rel="stylesheet">
</head>
<body>
<div id="root"></div>
<script type="module" src="/staff/main.jsx"></script>
</body>
</html>
```

`app/staff/main.jsx`:

```jsx
import { createRoot } from 'react-dom/client';
import Staff from './Staff.jsx';
import '../styles.css';
import './staff.css';

// The venue team's page, at /staff. It registers no service worker: it is live or nothing.
createRoot(document.getElementById('root')).render(<Staff />);
```

`app/staff/staff.css`:

```css
/* ON THE BEAT — the staff page, in the app's colours and type (../styles.css). */

html, body { background: var(--ink-0); }
.staff { max-width: 720px; margin: 0 auto; padding: 16px 16px 48px; display: flex; flex-direction: column; gap: 12px; }
.staff-in { max-width: 440px; padding-top: 48px; }
.staff-form { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.staff-form .cta { margin-top: 12px; }
.staff-input { width: 100%; height: 52px; border-radius: 16px; background: var(--ink-2); border: 1px solid var(--line); padding: 0 16px; font: var(--body); color: #fff; }
.staff-input:focus-visible { outline: 2px solid var(--hi); outline-offset: 2px; }
.staff-error { color: var(--stop); margin: 4px 2px 0; }
.staff-top { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 20px; background: var(--ink-1); }
.staff-top.flash { animation: staff-flash 1.4s var(--ease); }
@keyframes staff-flash { 0%, 35% { background: #3a0f12; border-color: var(--stop); } 100% { background: var(--ink-1); border-color: var(--line); } }
.staff-note { margin: 4px 2px; }
.staff-report { border: 1.5px solid var(--stop); border-radius: 20px; background: var(--ink-2); padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.staff-report.done { border-color: var(--line-2); opacity: .55; }
.staff-report .btn-s { align-self: flex-start; }
.staff-line { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.staff-time { font: var(--num); color: var(--text-2); }
.staff-why { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
```

- [ ] **Step 7: Build it, serve it, keep it out of the shell**

`vite.config.js` becomes:

```js
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app lives in app/ and builds to dist/, which the relay serves. For
// `npm run dev`, Vite serves the app and hands the socket and the clips to a
// relay running beside it (`npm run relay`).
const RELAY = 'http://localhost:' + (process.env.RELAY_PORT || 8790);
// Two pages: the phone's app, and the venue team's staff page (served at /staff; /staff.html under Vite).
const page = (name) => fileURLToPath(new URL('./app/' + name, import.meta.url));

export default defineConfig({
  root: 'app',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, rolldownOptions: { input: { main: page('index.html'), staff: page('staff.html') } } },
  server: {
    port: 5178,
    proxy: {
      '/api': { target: RELAY, ws: true },
      '/clip': RELAY,
    },
  },
});
```

In `relay/server.js`, `serveStatic()`: replace

```js
  /** A file from dist/, or the app itself for any route it owns. Never anything outside dist/. */
  function serveStatic(res, url) {
    let file = join(dist, 'index.html');
```

with

```js
  /** A file from dist/, the staff page at /staff, or the app itself for any route it owns. Never anything outside dist/. */
  function serveStatic(res, url) {
    let file = join(dist, /^\/staff\/?$/.test(url.split('?')[0]) ? 'staff.html' : 'index.html');
```

In `app/public/sw.js`, replace

```js
const SHELL = 'otb-shell-v1';
```

with

```js
// v2: v1 could have kept the staff page as the shell ('/'), since it keeps every page it fetched there.
const SHELL = 'otb-shell-v2';
```

and replace

```js
  if (url.origin === location.origin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/clip/'))) return;
```

with

```js
  if (url.origin === location.origin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/clip/'))) return;
  // The staff page is live or nothing, and never the app's shell.
  if (url.origin === location.origin && ['/staff', '/staff/', '/staff.html'].includes(url.pathname)) return;
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run build` and check it prints no warning about `rolldownOptions`; `dist/staff.html` exists. Then `node --test tests/staff-page.test.js tests/staff.test.js`.
Expected: PASS, every test.

- [ ] **Step 9: Mutation check (P1)** — `staff-task-5.json` (build before the runner for the `sw.js` item: the test reads the source, not `dist/`, so no rebuild is needed after it):

```json
[
  { "label": "the shell keeps the staff page", "file": "app/public/sw.js",
    "from": "['/staff', '/staff/', '/staff.html'].includes(url.pathname)", "to": "false",
    "test": "tests/staff-page.test.js", "expect": ["the offline shell never keeps the staff page"] },
  { "label": "/staff is the app", "file": "relay/server.js",
    "from": "/^\\/staff\\/?$/.test(url.split('?')[0])", "to": "false",
    "test": "tests/staff.test.js", "expect": ["the relay serves the staff page at /staff"] },
  { "label": "handled first", "file": "app/staff/list.js",
    "from": "(a.handledAt ? 1 : 0) - (b.handledAt ? 1 : 0)", "to": "(b.handledAt ? 1 : 0) - (a.handledAt ? 1 : 0)",
    "test": "tests/staff-page.test.js", "expect": ["open reports come first"] },
  { "label": "the first list chimes", "file": "app/staff/list.js",
    "from": "(seen ? reports.filter((r) => !seen.has(r.id)).map((r) => r.id) : [])", "to": "reports.filter((r) => !seen?.has(r.id)).map((r) => r.id)",
    "test": "tests/staff-page.test.js", "expect": ["a new report is one the last list did not have"] }
]
```

Expected: `ALL MUTATIONS HELD`.

- [ ] **Step 10: Look at it (P2)** — start the local relay with a test entry (P2), open `http://localhost:8790/staff` in the browser pane at 390×844 and at 1280×800:
  - the sign-in lists tonight's shows; a wrong passcode says *That passcode is not right.*; `browser-test-passcode` signs in and shows *No reports tonight.* and *Tap anywhere to hear new reports.*;
  - with `ben.mjs` running and a phone seeded in another tab, *Report* on Ben's row (it sends at once until Task 6) appears within a second, the header flashes, the tab title reads `(1) Staff · The Roundhouse, Camden · BRUNO MARS`; after a click on the page `window` has a running `AudioContext` (the chime's precondition);
  - a second tab signed in shows the same list, and *HANDLED* in one dims the report in both; *REOPEN* brings it back;
  - reload: still signed in (the token), no chime for the old report;
  - the offline shell (P4, in headless Chrome: the pane refuses to register any service worker, *An unknown error occurred when fetching the script*, while the relay serves `sw.js` with 200): after `/` then `/staff`, `otb-shell-v2`'s `/` is the app's page, offline `/` opens the app, and offline `/staff` fails rather than showing the app.
  Screenshot each layout once, at reduced scale, and read it; the pane draws an emulated viewport shrunk into a corner, so measure `main`'s box before calling a layout wrong.

  Measured at the build: sign-in, the wrong-passcode words, the list, the flash and `(n)` in the title, the tag kept across two reports (`reported 2 times by 1 person`), 3 ms from the phone's tap to the staff tab on localhost, *HANDLED* and *REOPEN* shared by two tabs, a reload signed in again by token with no flash, the sound hint gone after one real click, a centred 720 px column at 1280×800, and all three shell results above. It found one change, made here: a refused passcode now empties the field.

- [ ] **Step 11: Whole suite, commit, push**

Run: `npm test` — expected: every test passes.

```bash
git add app/staff.html app/staff vite.config.js relay/server.js app/public/sw.js tests/staff-page.test.js tests/staff.test.js
git commit -m "The staff page at /staff" -m "A second Vite entry, served by the relay at /staff: the venue from tonight's shows and the passcode; then the venue's reports, open first, each with its time, the person as a tag with how often and by how many, now/then/reporter bands and the words, and HANDLED or REOPEN for every screen there. A new report flashes the top, counts in the tab's title and plays two notes once a tap has opened sound. The token lives in this tab's sessionStorage only. The offline shell never keeps the staff page, and its cache is renamed in case v1 took it for the app." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 6: The phone asks for a few words

**Files:**
- Modify: `app/App.jsx` (a `ReportForm`; `report()` opens a sheet)
- Modify: `app/ui.jsx` (`Sheet`: the focus trap takes a textarea; it is not focused on open)
- Modify: `app/styles.css` (`textarea` base; `.words`)

**Interfaces:**
- Consumes: `{t:'report', handle, why}` (unchanged frame; the relay keeps `why` since Task 1).

- [ ] **Step 1: Write the form** — in `app/App.jsx`, after `ContactForm`, add:

```jsx
const WORDS_MAX = 200;   // relay/room.js keeps no more

/** A report's few words for the venue team, if any. Its own state, so typing never reaches the app. */
function ReportForm({ onSend }) {
  const [v, setV] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSend(v.trim()); }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <textarea className="words" rows={3} value={v} onChange={(e) => setV(e.target.value.slice(0, WORDS_MAX))}
        placeholder="a few words for the venue team (optional)" aria-label="A few words for the venue team, optional" />
      <div className="small" style={{ textAlign: 'right' }} aria-hidden="true">{v.length}/{WORDS_MAX}</div>
      <button type="submit" className="cta" style={{ '--c': 'var(--stop)', '--g': 'transparent' }}>SEND REPORT</button>
    </form>
  );
}
```

Replace `report()`:

```jsx
  const report = (handle) => {
    net.current?.send({ t: 'report', handle: handle || null, why: '' });
    setSheet(null);
    say('reported. the venue team has it.');
  };
```

with:

```jsx
  // A few words first, which the venue team sees with the report; none is fine.
  const report = (handle) => setSheet({
    title: handle ? 'Report' : 'Report something else', sub: 'goes to the venue team, with the time and the room.', close: 'Cancel',
    body: <ReportForm onSend={(why) => {
      net.current?.send({ t: 'report', handle: handle || null, why });
      setSheet(null);
      say('reported. the venue team has it.');
    }} />,
  });
```

In `app/ui.jsx`'s `Sheet`, replace:

```jsx
    const focusables = () => [...(ref.current?.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])') || [])]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    (ref.current?.querySelector('input') || focusables()[0])?.focus();
```

with:

```jsx
    const focusables = () => [...(ref.current?.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])') || [])]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    // An input is typed into at once; a textarea is optional words, so it waits for a tap and the keyboard stays down.
    (ref.current?.querySelector('input') || focusables().find((el) => el.tagName !== 'TEXTAREA'))?.focus();
```

In `app/styles.css`, after `input { font: inherit; color: inherit; }` add:

```css
textarea { font: inherit; color: inherit; }
```

and after the `.field input:focus-visible` rule add:

```css
.words { display: block; width: 100%; min-height: 96px; resize: none; border-radius: 16px; background: var(--ink-2); border: 1px solid var(--line); padding: 14px 16px; font: var(--body); color: #fff; outline: none; }
.words::placeholder { color: var(--text-3); }
.words:focus-visible { border-color: var(--stop); }
```

- [ ] **Step 2: Build and run the suite**

Run: `npm test` — expected: every test passes (no test covers `App.jsx`; the browser is its check).

- [ ] **Step 3: In the browser (P2)** — relay with a test entry, `ben.mjs` running, the pane at 390×844, a phone seeded at `roundhouse-bruno-mars` (named `Rae`) on SAY HI; a staff tab signed in with `browser-test-passcode`:
  - on the phone, Ben's row → more → *Report*: the sheet says *Report*, shows the field with its placeholder and `0/200`, and focus is on *SEND REPORT*, not the field;
  - type `followed me to the bar` and press *SEND REPORT*: the toast *reported. the venue team has it.*; the staff tab shows `About someone · P-…· reported once by 1 person`, `now in this room · then in this room · reporter was in this room`, and the words, within a second;
  - *Report* again with nothing typed: the staff tab shows `reported 2 times by 1 person` and no words;
  - NOT NOW, then *Report something* → *Something else* → words `spill by the stairs`: the staff tab shows *Something else* with them;
  - 250 characters pasted into the field keep 200 (`200/200`).
  Kill `ben.mjs` and stop the relay afterwards.

  Measured at the build, all as listed: focus on *SEND REPORT* with the field empty and `0/200`; the words reached the staff tab 17 ms after the tap on localhost, under the tag the earlier reports had; an empty report arrived with no words; *Report something else* carried `spill by the stairs`; 250 typed characters kept 200.

- [ ] **Step 4: Commit, push**

```bash
git add app/App.jsx app/ui.jsx app/styles.css
git commit -m "Report asks for a few words for the venue team" -m "Report, from a person's sheet or from Report something, opens a sheet with an optional field of up to 200 characters and SEND REPORT; what the phone says after is unchanged. A sheet's focus trap now takes a textarea, and does not focus it on open, so the keyboard stays down until someone chooses to type." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 7: README, deploy, and the owner's passcode

**Files:**
- Modify: `README.md` (*Run it*; *How it is built*; a new section *The staff page* after *How it is built*; *Where this differs from the canvas*; *Abuse resistance*; *What is not done*)

- [ ] **Step 1: README**

*Run it*, in the code block, after the `npm run tunnel` line:

```
npm run staff-code   # one venue's staff passcode, as a line for STAFF_CODES (see The staff page)
```

*How it is built*, replace the item

```
  - Reports are written to the relay's log. A venue would send them to its
    own team's radio or dashboard.
```

with

```
  - Reports go to the venue's own staff page, `/staff`, live (The staff
    page, below). The log says only that one came.
```

and in the `app/` list, after the `lib/phase.js` item, add

```
  - `staff.html` and `staff/`: the staff page, a second page of the same
    build, served at `/staff`. It shares nothing with the app.
```

After *How it is built*, add the section:

````
## The staff page

Every report reaches the venue's own team at `/staff`
(https://on-the-beat.fly.dev/staff), within a second
(`docs/superpowers/specs/2026-09-28-staff-reports-design.md`).

- **Signing in.** Each venue has one passcode, shared by its team. The relay
  keeps only an entry made from it, scrypt with a salt of its own, in
  `STAFF_CODES`: a JSON object of venue id to entry. No passcode is in the
  repository, the shows, a log or the image. A venue with no entry has no
  staff page. A right passcode gives the tab a token until 06:00 at the
  venue, kept in that tab only, so a reconnect signs in again by itself; at
  06:00 the page is signed out and asks for the passcode again.
- **What staff see.** Each report's time; who it is about, as a staff-only tag
  such as `P-4F2A`, the same all night at that venue and nothing like the
  handles phones are shown, with how many times and by how many different
  people that person was reported tonight — or *Something else*; that
  person's band then and now, or that they left; the reporter's band then;
  and the reporter's own few words, if any. Never a name, a contact, a
  photo, a handle, or who reported. Open reports come first; *HANDLED* dims
  one on every screen at the venue, and *REOPEN* brings it back.
- **A new report** flashes the top of the page, counts in the tab's title,
  `(2) Staff · The Roundhouse, Camden · BRUNO MARS`, and plays two short
  notes once a tap on the page has let it make sound. Nothing reaches a
  device whose page is closed or asleep: keep it open on a screen that
  stays awake.
- **Reports last the night.** A venue with a staff page keeps tonight's
  reports even once everyone has left, so a team that signs in later still
  sees them; at 06:00 they go. A restart or a deploy empties them, as it
  empties rooms, and signs every staff page out.

To give a venue its page, make its line and set it on the relay:

```
npm run staff-code
```

It asks for the venue's show id and a passcode of at least eight characters,
twice, never shows the passcode, and prints one line such as
`"roundhouse-bruno-mars": "scrypt$16384$8$1$…"`. Put every venue's line
between braces, separated by commas, in a file outside the repository as
one line, `STAFF_CODES={"roundhouse-bruno-mars": "scrypt$…"}`, then:

```
flyctl secrets import --stage < staff-codes.env   # PowerShell: Get-Content staff-codes.env | flyctl secrets import --stage
flyctl deploy --ha=false --remote-only            # between nights: it restarts the one machine
```

and delete the file. A mistake in `STAFF_CODES` stops the relay starting,
with the venue named and the entry never printed. Locally,
`STAFF_CODES='{…}' npm start`; under `npm run dev` the page is
`http://localhost:5178/staff.html`.
````

*Where this differs from the canvas, on purpose*, at the end of the list:

```
- **A staff page** at `/staff`, which the canvas does not have: someone has
  to read the reports the canvas says go to the venue team.
- **Report asks for a few words**, optional and at most 200 characters. The
  canvas's Report is one tap; "someone was reported near the bar" alone
  gives staff little to act on.
```

*Abuse resistance*, replace the item `- **A report log without end** is capped at its most recent thousand.` with:

```
- **A report log without end** is capped at its most recent thousand a
  venue, and a venue's reports go at 06:00.
- **The staff page.** A passcode is kept only as a scrypt entry, and every
  sign-in by passcode counts on the pairing counters, five a socket and
  twenty an address a minute, its scrypt run off the event loop. A token
  lasts until 06:00 at its own venue only. A socket is a phone, a wristband
  or staff, never two, including one that joins while its passcode is being
  checked; a staff socket can only mark reports. Staff see a person only as
  a tag made with a key drawn at start, and never who reported; the relay's
  log says only which venue and which report. What it cannot tell: someone
  with many phones can report one person from each, so `reported 5 times by
  5 people` is a lead for staff to look into, not proof.
```

*What is not done*, replace `- **Reports go to a log**, not to a person.` with:

```
- **The staff page has not met a venue.** It has run on a laptop, in two
  tabs beside a phone in the same browser. Nothing reaches a staff device
  whose page is closed or asleep, and one passcode a venue is shared by its
  whole team; changing it is a secret set and a restart.
```

- [ ] **Step 2: Run the suite; commit; push**

Run: `npm test` — expected: every test passes (`tests/copy.test.js` reads the README).

```bash
git add README.md
git commit -m "README: the staff page" -m "How reports reach the venue team, what staff see and never see, how the owner gives a venue its passcode (npm run staff-code, STAFF_CODES on Fly), what the staff page guards against and what it cannot tell." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 3: Deploy (P3) and check live** — after CI is green for the push: deploy, then
  - `https://on-the-beat.fly.dev/staff` returns the staff page (its `<title>` is `Staff · On The Beat`);
  - one sign-in from a throwaway socket, `{t:'staff', venue:'roundhouse-bruno-mars', code:'x'}`, is answered `no staff page` (no `STAFF_CODES` is set yet), which proves the live relay has the staff code and is counting nothing it should not;
  - `flyctl machine list -a on-the-beat` shows one machine; both wristbands reconnect.

  Measured on 28 Sep 2026 after `0003854` (CI green, test and firmware): the live `/staff` title is `Staff · On The Beat`, the live phone bundle carries `SEND REPORT` and the field's placeholder, a throwaway sign-in was answered `no staff page`, one machine, and both bands' consoles said `relay https://on-the-beat.fly.dev (on it)`, unpaired.

- [ ] **Step 4: Hand over to the owner** — in Chinese: the page is live; to give a venue its page he runs `npm run staff-code` in his own terminal, checks the passcode does not show as he types it, and sets `STAFF_CODES` with the commands in README *The staff page* (`--stage`, then a deploy between nights). Never ask for or read his passcode or the line it prints.
