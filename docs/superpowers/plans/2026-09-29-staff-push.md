# Staff push notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A report made at a venue reaches every staff device there that turned notifications on, even with the page closed or the phone asleep, and a tap opens the list still signed in.

**Architecture:** A new `relay/push.js` does Web Push on `node:crypto` alone. It holds the relay's VAPID keys, checks a browser's subscription, seals a payload per RFC 8291 and sends the request. `relay/server.js` takes a signed-in staff device's subscription onto its token record, which rides the night file. It sends each venue's devices `{venue, open}` at most once a 10 s window, and forgets the devices a push service says are gone. The staff page gets its own manifest and a service worker that only shows notifications. The page turns them on with one tap, then again by itself at every sign-in, and keeps its sign-in on the device once they are on.

**Tech Stack:** Node 24 (`node:crypto`, global `fetch`, `node:test`), `ws`, React 19 + Vite 8, Web Push (VAPID RFC 8292, aes128gcm RFC 8188/8291).

**Spec:** `docs/superpowers/specs/2026-09-29-staff-push-design.md` (approved 9d2038c).

## Global Constraints

- Talk to him in Chinese; code, comments, commits, README and test names are English.
- **Dependencies.** No new one: the relay depends on `ws` alone, and push is `node:crypto` plus Node's global `fetch`.
- **Endpoints taken:**
  - the scheme `https:`, no port, no user name or password, at most 2,000 characters;
  - the host is `fcm.googleapis.com` or `android.googleapis.com`, or ends in `.push.apple.com`, `.push.services.mozilla.com` or `.notify.windows.com`.
- **Subscription keys.** `p256dh` is base64url for a valid 65-byte P-256 point; `auth` is base64url for 16 bytes. Anything else is `{t:'push', ok:false, why:'bad push'}`.
- **Payload** `{"venue":"<the show's venue>","open":<n>}` and nothing else, sealed `aes128gcm`, one record, rs 4096.
- **Headers:**
  - `TTL: 600`, `Urgency: high`, `Topic: reports`;
  - `Content-Encoding: aes128gcm`;
  - `Authorization: vapid t=<JWT>, k=<public key>`, where the JWT is ES256 with `aud` the endpoint's origin, `exp` 12 h on and `sub` `https://on-the-beat.fly.dev`, made again only once 11 h old.
- **Sending:**
  - at most one push a venue each 10 s, with a trailing push that is skipped when nothing is open;
  - at most 50 subscriptions a venue, the oldest forgotten;
  - 10 s timeout, no redirects, and no answer body read;
  - 2xx is sent; 404, 410, 403 and `refused` are forgotten; anything else is failed;
  - the log says `push: <venue id> <n> sent, <n> gone, <n> failed`.
- **Keys file.** `PUSH_KEYS_FILE`, on Fly `/data/push-keys.json`, holding `{ "v": 1, "jwk": {...} }`, mode 0600, written as the night file is. Logs are `push: keys from <path>`, `push: keys made at <path>`, `push: keys unreadable (<error name>), made new ones`, `push: keys not written (<code>), kept in memory` and, from the command line, `push: keys in memory only`.
- **The notification.**
  - Title: `New report · <venue>`, or `New report`.
  - Body: `<n> open — tap to see them`, `1 open — tap to see it`, or `Tap to see the list`.
  - Tag `otb-reports`, with `renotify` on.
  - Never a person, a tag, a place or the reporter's words.
- **Passcodes.** Tests use only `test-passcode-1` and `test-passcode-2`, and browser checks only `browser-test-passcode`. Never his passcode.
- **Git.** Commit and push to `main` when `npm test` is green. Never `cimi2232/DECO3500`.

## Procedures

`<scratch>` is `C:\Users\LEWISD~1\AppData\Local\Temp\claude\C--Users-LewisDong-Documents-on-the-beat\6ee04277-c2d5-4551-a80f-31cc5850fcad\scratchpad`.

**P1 — Mutation check.**
- Run `node <scratch>/mutate.mjs <scratch>/push-mutations.json`, a script that already exists.
- Each entry breaks one guard, runs one test file and checks that exactly the named tests go red. It then restores the file byte for byte and runs green again.
- Expected: `ALL MUTATIONS HELD`.

**P2 — The full suite, kept whole.** Run it through the Bash tool, then read the summary:

```bash
cd /c/Users/LewisDong/Documents/on-the-beat && npm test > "$SCRATCH/test-full.txt" 2>&1; echo "exit $?"; grep -E "^ℹ (tests|pass|fail|skipped|cancelled)" "$SCRATCH/test-full.txt"
```

- Set `SCRATCH` to `<scratch>` in the same command.
- Expected: `exit 0` and `fail 0`.
- A file can die with exit `0xC0000409`, a Node fatal error (memory `test-native-abort`). If one does, run that file alone. Count it only once it runs green.

**P3 — A local relay with a staff page.** Build, make a test entry, and start the relay in the background:

```bash
cd /c/Users/LewisDong/Documents/on-the-beat && npm run build >/dev/null && node -e "import('./relay/staff.js').then(async (m) => console.log(JSON.stringify({ 'roundhouse-bruno-mars': await m.makeEntry('browser-test-passcode') })))" > "$SCRATCH/codes.json"
STAFF_CODES="$(cat "$SCRATCH/codes.json")" PUSH_KEYS_FILE="$SCRATCH/push-keys.json" PORT=8790 node relay/server.js
```

- The second line runs with `run_in_background`.
- Its log must show `push: keys made at …` the first time, and `push: keys from …` after that.
- Stop it by port when the check ends: `Get-NetTCPConnection -LocalPort 8790`, then `Stop-Process`.

**P4 — A stand-in phone that reports.** Save this as `<scratch>/reporter.mjs` and run it with `node <scratch>/reporter.mjs`:

```js
// A stand-in phone at the Roundhouse: joins, makes one report with no one named, and leaves.
const ws = new WebSocket('ws://localhost:8790/api/ws');
ws.onopen = () => {
  ws.send(JSON.stringify({ t: 'join', venue: 'roundhouse-bruno-mars', me: crypto.randomUUID().replace(/-/g, '') }));
  setTimeout(() => ws.send(JSON.stringify({ t: 'report', why: 'browser check' })), 600);
  setTimeout(() => { ws.close(); process.exit(0); }, 1500);
};
```

**P5 — The staff page in Chrome over CDP.**
- The in-app browser pane cannot register a service worker, so this drives Chrome with a throwaway profile over its debugging protocol.
- `node <scratch>/cdp-push.mjs headless` checks the page. `node <scratch>/cdp-push.mjs headful` gets a real push through Google.
- **Headful puts a Chrome window and a Windows notification on his screen: tell him first.**

```js
// Chrome with a throwaway profile, driven over CDP: signs in to the local staff page, reads the notification
// line, grants notifications, taps NOTIFY THIS DEVICE and, headful, waits for a real push.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const MODE = process.argv[2] === 'headful' ? 'headful' : 'headless';
const ORIGIN = 'http://localhost:8790';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = mkdtempSync(join(tmpdir(), 'otb-push-'));
const args = ['--remote-debugging-port=9334', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', 'about:blank'];
const chrome = spawn(CHROME, MODE === 'headless' ? ['--headless=new', ...args] : args, { stdio: 'ignore' });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(url) {
  const ws = new WebSocket(url);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  const call = (method, params = {}) => new Promise((r) => { id += 1; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  return { ws, call };
}

async function main() {
  let target;
  for (let i = 0; i < 40 && !target; i += 1) {
    await pause(250);
    try { target = (await (await fetch('http://127.0.0.1:9334/json/list')).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  const browser = await session((await (await fetch('http://127.0.0.1:9334/json/version')).json()).webSocketDebuggerUrl);
  const page = await session(target.webSocketDebuggerUrl);
  const run = async (expression) => (await page.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const line = () => run("document.querySelector('.staff-notify')?.textContent || [...document.querySelectorAll('.staff-note')].map((p) => p.textContent).join(' | ')");

  await page.call('Page.enable');
  await page.call('Page.navigate', { url: ORIGIN + '/staff' });
  await pause(2500);
  console.log('manifest:', await run("document.querySelector('link[rel=manifest]')?.getAttribute('href')"));
  await run(`(() => {
    const set = (el, v) => { Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
    set(document.getElementById('venue'), 'roundhouse-bruno-mars');
    set(document.getElementById('code'), 'browser-test-passcode');
  })()`);
  await pause(300);
  await run("document.querySelector('form').requestSubmit()");
  await pause(2500);
  console.log('signed in:', await run("document.querySelector('.staff-top .h2')?.textContent"));
  console.log('worker scope:', await run("navigator.serviceWorker.getRegistration('/staff').then((r) => r && r.scope)"));
  console.log('line before:', await line());
  await browser.call('Browser.grantPermissions', { origin: ORIGIN, permissions: ['notifications'] });
  await run("document.querySelector('.staff-notify')?.click()");
  for (let i = 0; i < 40; i += 1) { await pause(500); if (!/Turning on/.test(await line() || '')) break; }
  console.log('line after tap:', await line());
  console.log('kept on the device:', await run("!!localStorage.getItem('otb:staff')"), '| in the tab:', await run("!!sessionStorage.getItem('otb:staff')"));
  if (MODE === 'headful' && /Notifications on/.test(await line() || '')) {
    console.log('endpoint host:', await run("navigator.serviceWorker.getRegistration('/staff').then((r) => r.pushManager.getSubscription()).then((s) => s && new URL(s.endpoint).host)"));
    spawnSync(process.execPath, [join(import.meta.dirname, 'reporter.mjs')], { stdio: 'inherit' });
    let shown = [];
    for (let i = 0; i < 30 && !shown.length; i += 1) {
      await pause(1000);
      shown = await run("navigator.serviceWorker.getRegistration('/staff').then((r) => r.getNotifications({ tag: 'otb-reports' })).then((all) => all.map((n) => n.title + ' / ' + n.body))") || [];
    }
    console.log('notifications shown:', JSON.stringify(shown));
  }
  await run("[...document.querySelectorAll('button')].find((b) => b.textContent === 'SIGN OUT')?.click()");
  await pause(3000);
  console.log('after SIGN OUT, subscription:', await run("navigator.serviceWorker.getRegistration('/staff').then((r) => r.pushManager.getSubscription()).then((s) => !!s)"),
    '| kept:', await run("!!localStorage.getItem('otb:staff')"), '| page:', await run("document.querySelector('h1')?.textContent"));
  page.ws.close();
  browser.ws.close();
}

try { await main(); } finally {
  chrome.kill();
  await pause(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a file */ }
}
```

## File structure

- **Create `relay/push.js`.** Web Push and nothing else: the host and key checks, sealing, the keys, the JWT and the request. It knows no rooms and no tokens.
- **Modify `relay/server.js`.** Keys at start and the public key in the sign-in answer. Taking subscriptions onto token records, and `signout`. The 10 s window and sending on a report. Restoring subscriptions from the night file. Two test hooks and `PUSH_KEYS_FILE` on the command line.
- **Create `app/public/staff-sw.js`.** It shows a notification for a push and opens `/staff` from a tap. It has no `fetch` handler.
- **Create `app/public/staff.webmanifest`,** and link it from `app/staff.html`.
- **Create `app/staff/notify.js`.** Pure: where a device starts, the words, and the key's bytes.
- **Modify `app/staff/Staff.jsx`, `list.js`, `staff.css` and `main.jsx`.** The notify line, the tap, turning on again by itself, keeping the sign-in on the device, SIGN OUT at the relay, and clearing notifications on screen.
- **Modify `fly.toml`.** Add `PUSH_KEYS_FILE`.
- **Tests.**
  - Create `tests/push-helpers.js` (a subscriber and a push service on 127.0.0.1), `tests/push.test.js`, `tests/staff-push.test.js`, `tests/staff-sw.test.js` and `tests/staff-notify.test.js`.
  - Modify `tests/staff.test.js`, `tests/restart.test.js`, `tests/staff-page.test.js` and `tests/deploy.test.js`.
- **Docs.** `README.md`; the spec's *Amended while planning*; `CLAUDE.md`'s test count (not in git); memory.

## Amended while planning

These are appended to the spec in Task 1's commit:

1. **The redirect and timeout checks are tested on `send()` in `tests/push.test.js`,** not through the relay: a 10-second wait has no place in the relay's tests.
2. **The relay object gains `pushKey`** (its public key), and for tests `pushedTo(key)`: every held subscription's endpoint at a venue, oldest first, whatever its night.
3. **A push with no readable data** shows *New report* with the body *Tap to see the list*.
4. **An endpoint that fails the check at send time** is `refused` and forgotten, like a 404.
5. **A permission prompt dismissed without an answer** puts the button back. It does not say the browser cannot be used.
6. **The 06:00 test passes at once:** subscriptions ride the token record, which the sweep already drops. It stays as a guard.

---

### Task 1: Sealing a payload, and what a subscription must be

**Files:**
- Create: `relay/push.js`
- Create: `tests/push-helpers.js`
- Create: `tests/push.test.js`
- Modify: `docs/superpowers/specs/2026-09-29-staff-push-design.md` (append *Amended while planning*)

**Interfaces:**
- Produces:
  - `isPushService(endpoint: unknown): boolean`
  - `subscriptionOf(sub: unknown, allowed = isPushService): { endpoint, p256dh, auth } | null`
  - `encrypt(payload: string, { p256dh, auth }, { salt?: Buffer, serverKey?: Buffer } = {}): Buffer`
  - `b64u(bytes): string`
- Test helpers produced:
  - `subscriber(endpoint)`, returning `{ sub: { endpoint, keys: { p256dh, auth } }, open(body: Buffer): string }`;
  - `pushService({ status = 201 } = {})`, resolving to `{ got: [{ method, url, headers, body }], status, statusFor: Map<path, status>, location, origin, endpoint(path?), close() }`. `status: 'hang'` never answers.

- [ ] **Step 1: Write the test helpers.**

`tests/push-helpers.js`:

```js
// ON THE BEAT — a browser's side of Web Push, for tests (docs/superpowers/specs/2026-09-29-staff-push-design.md):
// a subscriber that opens what it is sent (RFC 8291), and a push service on 127.0.0.1 that keeps what reaches it.

import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

/** A subscription to `endpoint` as a browser hands it over, with the private half kept to open what it is sent. */
export function subscriber(endpoint) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    sub: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } },
    /** The text a push body carries: salt, record size, the sender's key, then one sealed record. */
    open(body) {
      const salt = body.subarray(0, 16);
      const idlen = body[20];
      const as = body.subarray(21, 21 + idlen);
      const ua = ecdh.getPublicKey();
      const info = Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]);
      const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(as), auth, info, 32));
      const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const sealed = body.subarray(21 + idlen);
      const d = createDecipheriv('aes-128-gcm', cek, nonce);
      d.setAuthTag(sealed.subarray(-16));
      const plain = Buffer.concat([d.update(sealed.subarray(0, -16)), d.final()]);
      return plain.subarray(0, plain.lastIndexOf(2)).toString();
    },
  };
}

/**
 * A push service on 127.0.0.1. It keeps every request, with its headers and body, and answers `status`, or the
 * status `statusFor` holds for its path. With a `location` it sends that along, as a redirect would. 'hang' never
 * answers.
 */
export async function pushService({ status = 201 } = {}) {
  const s = { got: [], status, statusFor: new Map(), location: null };
  s.server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      s.got.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      const answer = s.statusFor.get(req.url) ?? s.status;
      if (answer === 'hang') return;
      res.writeHead(answer, s.location ? { location: s.location } : {}).end();
    });
  });
  await new Promise((r) => s.server.listen(0, '127.0.0.1', r));
  s.origin = 'http://127.0.0.1:' + s.server.address().port;
  s.endpoint = (path = '/push/' + randomBytes(8).toString('hex')) => s.origin + path;
  s.close = () => { s.server.closeAllConnections(); return new Promise((r) => s.server.close(r)); };
  return s;
}
```

- [ ] **Step 2: Write the failing tests.**

`tests/push.test.js`:

```js
// ON THE BEAT — Web Push on node:crypto (relay/push.js; docs/superpowers/specs/2026-09-29-staff-push-design.md
// §2-§4): RFC 8291's own example, the host and key checks, the keys file, the JWT, and the request itself.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encrypt, isPushService, subscriptionOf } from '../relay/push.js';
import { subscriber } from './push-helpers.js';

const u = (s) => Buffer.from(s.replace(/\s+/g, ''), 'base64url');
const dir = mkdtempSync(join(tmpdir(), 'otb-push-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('RFC 8291 §5: its keys and salt give its bytes', () => {
  const body = encrypt('When I grow up, I want to be a watermelon',
    { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    { salt: u('DGv6ra1nlYgDCS1FRnbzlw'), serverKey: u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw') });
  assert.equal(body.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml'
    + 'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT'
    + 'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('a payload sealed for a subscriber opens to itself, under a fresh key and salt each time', () => {
  const s = subscriber('https://fcm.googleapis.com/fcm/send/abc');
  const payload = '{"venue":"The Roundhouse, Camden","open":2}';
  const a = encrypt(payload, subscriptionOf(s.sub));
  const b = encrypt(payload, subscriptionOf(s.sub));
  assert.equal(s.open(a), payload);
  assert.equal(s.open(b), payload);
  assert.notDeepEqual(a.subarray(0, 86), b.subarray(0, 86), 'salt and key are new for every message');
});

test('only the push services\' own addresses are taken', () => {
  const fcm = 'https://fcm.googleapis.com/';
  for (const ok of [fcm + 'fcm/send/abc', 'https://android.googleapis.com/gcm/send/abc', 'https://web.push.apple.com/QGZ',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAA', 'https://wns2-by3p.notify.windows.com/w/?token=BQYAAAB',
    fcm + 'a'.repeat(2000 - fcm.length)]) assert.equal(isPushService(ok), true, ok.slice(0, 60));
  for (const bad of ['http://fcm.googleapis.com/fcm/send/abc', 'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user:pw@fcm.googleapis.com/fcm/send/abc', 'https://user@fcm.googleapis.com/fcm/send/abc',
    'https://142.250.66.10/fcm/send/abc', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x',
    'https://fcm.googleapis.com.evil.example/x', 'https://evilnotify.windows.com/w', 'https://push.apple.com/x',
    'https://notify.windows.com.evil.example/w', 'not a url', 42, undefined, null,
    fcm + 'a'.repeat(2001 - fcm.length)]) assert.equal(isPushService(bad), false, String(bad).slice(0, 60));
});

test('a subscription needs a point on P-256 and a 16-byte auth, both base64url', () => {
  const s = subscriber('https://fcm.googleapis.com/fcm/send/abc');
  const { p256dh, auth } = s.sub.keys;
  assert.deepEqual(subscriptionOf(s.sub), { endpoint: s.sub.endpoint, p256dh, auth });
  const off = Buffer.from(p256dh, 'base64url');
  off[64] ^= 1;                                   // one bit of y: no longer on the curve
  for (const keys of [
    { p256dh: Buffer.from(p256dh, 'base64url').subarray(0, 64).toString('base64url'), auth },
    { p256dh: off.toString('base64url'), auth },
    { p256dh, auth: Buffer.alloc(15, 7).toString('base64url') },
    { p256dh: p256dh + '!', auth },
    { p256dh },
    null,
  ]) assert.equal(subscriptionOf({ endpoint: s.sub.endpoint, keys }), null, JSON.stringify(keys));
  assert.equal(subscriptionOf({ endpoint: 'https://evil.example/x', keys: s.sub.keys }), null);
  assert.equal(subscriptionOf({ endpoint: 'http://127.0.0.1:9/x', keys: s.sub.keys }, () => true)?.endpoint, 'http://127.0.0.1:9/x', 'a test may widen the hosts');
  assert.equal(subscriptionOf(null), null);
  assert.equal(subscriptionOf('a string'), null);
});
```

- [ ] **Step 3: Run them and see them fail.**

Run: `node --test tests/push.test.js`
Expected: FAIL. Each test errors with `Cannot find module '…/relay/push.js'` (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 4: Write `relay/push.js`, part 1.**

```js
// ON THE BEAT — Web Push from the relay to staff devices (docs/superpowers/specs/2026-09-29-staff-push-design.md).
//
// All on node:crypto: the check that a subscription names a real push service and real keys (§3), and a payload
// sealed for one device (RFC 8291: aes128gcm, one record). It knows nothing of rooms or tokens.

import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

const ENDPOINT_MAX = 2000;
const HOSTS = ['fcm.googleapis.com', 'android.googleapis.com'];
const SUFFIXES = ['.push.apple.com', '.push.services.mozilla.com', '.notify.windows.com'];
const B64U = /^[A-Za-z0-9_-]+={0,2}$/;

export const b64u = (bytes) => Buffer.from(bytes).toString('base64url');

/** Is this a real push service's address: https, no port, no user, one of the five host families (§3)? */
export function isPushService(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > ENDPOINT_MAX) return false;
  let u;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '') return false;
  return HOSTS.includes(u.hostname) || SUFFIXES.some((s) => u.hostname.endsWith(s));
}

/**
 * A browser's subscription as the relay keeps it, `{ endpoint, p256dh, auth }`, or null. The endpoint must pass
 * `allowed`; p256dh must be a point on P-256, 65 bytes uncompressed, and auth 16 bytes, both base64url.
 */
export function subscriptionOf(sub, allowed = isPushService) {
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!allowed(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (!B64U.test(p256dh) || !B64U.test(auth)) return null;
  const point = Buffer.from(p256dh, 'base64url');
  if (point.length !== 65 || point[0] !== 4 || Buffer.from(auth, 'base64url').length !== 16) return null;
  try {
    const probe = createECDH('prime256v1');
    probe.generateKeys();
    probe.computeSecret(point);   // throws for a point that is not on the curve
  } catch {
    return null;
  }
  return { endpoint, p256dh, auth };
}

/** `payload` sealed for one subscription (RFC 8291). `salt` and `serverKey` are for RFC 8291's own example. */
export function encrypt(payload, { p256dh, auth }, { salt = randomBytes(16), serverKey = null } = {}) {
  const ua = Buffer.from(p256dh, 'base64url');
  const ecdh = createECDH('prime256v1');
  if (serverKey) ecdh.setPrivateKey(serverKey);
  else ecdh.generateKeys();
  const as = ecdh.getPublicKey();
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]);
  const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(ua), Buffer.from(auth, 'base64url'), info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(4096, 16);   // the record size
  head[20] = as.length;           // then the key id: the relay's key for this one message
  return Buffer.concat([head, as, sealed]);
}
```

- [ ] **Step 5: Run them and see them pass.**

Run: `node --test tests/push.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 6: Append *Amended while planning* to the spec.** Add the six items of this plan's *Amended while planning* at the end of `docs/superpowers/specs/2026-09-29-staff-push-design.md`, under a `## Amended while planning` heading, word for word.

- [ ] **Step 7: Run the full suite (P2), then commit and push.**

Expected: `fail 0`, with 500 tests in all.

```bash
git add relay/push.js tests/push-helpers.js tests/push.test.js docs/superpowers/specs/2026-09-29-staff-push-design.md
git commit -m "Web Push, part 1: a payload sealed per RFC 8291, and only real push services and real keys taken" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 2: The relay's keys, the JWT and the request

**Files:**
- Modify: `relay/push.js`
- Modify: `tests/push.test.js`

**Interfaces:**
- Consumes: `b64u`, `encrypt`, `isPushService` (Task 1); `openNight(path)` from `relay/store.js`.
- Produces:
  - `CONTACT = 'https://on-the-beat.fly.dev'` and `SEND_TIMEOUT_MS = 10_000`;
  - `keysFrom(jwk)`, returning `{ jwk, privateKey, publicKey }`, where `publicKey` is the 65-byte key in base64url;
  - `makeKeys()`;
  - `loadKeys(path?)`;
  - `createPusher({ keys, now, allowed = isPushService, timeoutMs = SEND_TIMEOUT_MS })`, returning `{ publicKey, jwtFor(aud): string, send(sub, payload): Promise<number | 'refused' | 'failed'> }`.

- [ ] **Step 1: Write the failing tests.** Change the imports at the top of `tests/push.test.js` to:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTACT, createPusher, encrypt, isPushService, loadKeys, makeKeys, subscriptionOf } from '../relay/push.js';
import { pushService, subscriber } from './push-helpers.js';
```

Add below `after(...)`:

```js
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** What `fn` logs while it runs, one string a line. */
function logged(fn) {
  const said = [];
  const log = console.log;
  console.log = (...a) => { said.push(a.join(' ')); };
  try {
    fn();
  } finally {
    console.log = log;
  }
  return said;
}
```

Append these tests:

```js
test('the keys are made once, kept 0600, and read back the same', () => {
  const path = join(dir, 'keys-1.json');
  let made;
  assert.deepEqual(logged(() => { made = loadKeys(path); }), ['push: keys made at ' + path]);
  assert.match(made.publicKey, /^B[A-Za-z0-9_-]{86}$/);
  let again;
  assert.deepEqual(logged(() => { again = loadKeys(path); }), ['push: keys from ' + path]);
  assert.equal(again.publicKey, made.publicKey);
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(saved.v, 1);
  assert.deepEqual(Object.keys(saved.jwk).sort(), ['crv', 'd', 'kty', 'x', 'y']);
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('keys that cannot be read are made again and said so; keys that cannot be written stay in memory', () => {
  const path = join(dir, 'keys-2.json');
  writeFileSync(path, '{"v":1,"jwk":{"kty":"EC"}}');
  let made;
  assert.deepEqual(logged(() => { made = loadKeys(path); }), ['push: keys unreadable (TypeError), made new ones']);
  assert.equal(loadKeys(path).publicKey, made.publicKey, 'and written');
  writeFileSync(path, 'not json');
  assert.deepEqual(logged(() => loadKeys(path)), ['push: keys unreadable (SyntaxError), made new ones']);
  const nowhere = join(dir, 'no-such-folder', 'keys.json');
  let kept;
  assert.deepEqual(logged(() => { kept = loadKeys(nowhere); }), ['push: keys not written (ENOENT), kept in memory']);
  assert.match(kept.publicKey, /^B[A-Za-z0-9_-]{86}$/);
  assert.deepEqual(logged(() => loadKeys()), [], 'no file: in memory, and the command line says so');
});

test('the JWT: ES256 under the relay\'s key, for the push service\'s origin, 12 hours, the contact; kept 11 hours', () => {
  const clock = { t: Date.UTC(2026, 8, 29, 10, 0) };
  const keys = makeKeys();
  const p = createPusher({ keys, now: () => clock.t });
  const jwt = p.jwtFor('https://fcm.googleapis.com');
  const [head, claims, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), { aud: 'https://fcm.googleapis.com', exp: clock.t / 1000 + 12 * 3600, sub: CONTACT });
  const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: keys.jwk.x, y: keys.jwk.y }, format: 'jwk' });
  assert.equal(verify('sha256', Buffer.from(head + '.' + claims), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), true);
  clock.t += 11 * 3600_000 - 1;
  assert.equal(p.jwtFor('https://fcm.googleapis.com'), jwt, 'the same within 11 hours');
  assert.notEqual(p.jwtFor('https://web.push.apple.com'), jwt, 'one for each push service');
  clock.t += 1;
  assert.notEqual(p.jwtFor('https://fcm.googleapis.com'), jwt, 'a new one after');
});

test('a push is a POST with TTL, urgency, topic, aes128gcm and vapid; its status comes back; its body opens', async () => {
  const service = await pushService();
  try {
    const keys = makeKeys();
    const p = createPusher({ keys, now: Date.now, allowed: (e) => typeof e === 'string' && e.startsWith(service.origin + '/') });
    const s = subscriber(service.endpoint());
    const sub = subscriptionOf(s.sub, () => true);
    assert.equal(await p.send(sub, { venue: 'The Roundhouse, Camden', open: 2 }), 201);
    const [req] = service.got;
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.ttl, '600');
    assert.equal(req.headers.urgency, 'high');
    assert.equal(req.headers.topic, 'reports');
    assert.equal(req.headers['content-encoding'], 'aes128gcm');
    assert.match(req.headers.authorization, new RegExp('^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=' + keys.publicKey + '$'));
    assert.deepEqual(JSON.parse(s.open(req.body)), { venue: 'The Roundhouse, Camden', open: 2 });
    service.status = 410;
    assert.equal(await p.send(sub, { venue: 'The Roundhouse, Camden', open: 1 }), 410);
  } finally {
    await service.close();
  }
});

test('an address turned away now is never called; a redirect is not followed; a silent service is given up', { timeout: 5000 }, async () => {
  const service = await pushService();
  const elsewhere = await pushService();
  try {
    const p = createPusher({ keys: makeKeys(), now: Date.now, allowed: (e) => typeof e === 'string' && e.startsWith(service.origin + '/'), timeoutMs: 300 });
    const away = subscriber(elsewhere.endpoint());
    assert.equal(await p.send(subscriptionOf(away.sub, () => true), { open: 1 }), 'refused');
    const s = subscriber(service.endpoint());
    const sub = subscriptionOf(s.sub, () => true);
    service.status = 302;
    service.location = elsewhere.endpoint();
    assert.equal(await p.send(sub, { open: 1 }), 302);
    await pause(200);
    assert.equal(elsewhere.got.length, 0, 'neither the refused address nor the redirect was called');
    service.status = 'hang';
    const t0 = Date.now();
    // Raced, so a send that never gives up fails this test at once instead of holding the run open.
    assert.equal(await Promise.race([p.send(sub, { open: 1 }), pause(3000).then(() => 'still waiting')]), 'failed');
    assert.ok(Date.now() - t0 < 2000, 'given up at the timeout');
  } finally {
    await service.close();
    await elsewhere.close();
  }
});
```

- [ ] **Step 2: Run them and see them fail.**

Run: `node --test tests/push.test.js`
Expected: FAIL. The file does not load: `SyntaxError: The requested module '../relay/push.js' does not provide an export named 'CONTACT'`.

- [ ] **Step 3: Write `relay/push.js`, part 2.**
  1. Replace its import line with the imports below.
  2. Replace the header's second paragraph with the one below.
  3. Add the constants under `const B64U`.
  4. Append the functions.

```js
import { createCipheriv, createECDH, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto';
import { openNight } from './store.js';
```

The new header paragraph:

```js
// All on node:crypto: the relay's key pair (VAPID, RFC 8292) and where it is kept (§2), the check that a
// subscription names a real push service and real keys (§3), a payload sealed for one device (RFC 8291: aes128gcm,
// one record), and the request (§4). It knows nothing of rooms or tokens.
```

The constants:

```js
export const CONTACT = 'https://on-the-beat.fly.dev';   // the JWT's `sub`: who a push service can reach about us
export const SEND_TIMEOUT_MS = 10_000;
const JWT_LIFE_S = 12 * 3600;          // Apple takes a JWT of at most a day
const JWT_REUSE_MS = 11 * 3600_000;    // and wants no new one within the hour
```

The functions:

```js
/** The relay's key pair: its private key, the JWK that keeps it, and the public key as a page needs it. */
export function keysFrom(jwk) {
  if (jwk?.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string') throw new TypeError('not a P-256 private key');
  const privateKey = createPrivateKey({ key: jwk, format: 'jwk' });
  const pub = createPublicKey(privateKey).export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
  return { jwk: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y, d: jwk.d }, privateKey, publicKey: b64u(raw) };
}

export const makeKeys = () => keysFrom(generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' }));

/**
 * The relay's keys: read from `path`, or made and written there (0600, as the night file is); with no path, made
 * and kept in memory. A file that cannot be read is replaced; one that cannot be written leaves the keys in memory.
 * The relay never refuses to start over this file (§2).
 */
export function loadKeys(path) {
  if (!path) return makeKeys();
  const file = openNight(path);
  let why = null;
  try {
    const text = file.read();
    if (text !== null) {
      const saved = JSON.parse(text);
      if (saved?.v !== 1) throw new TypeError('not a keys file of version 1');
      const keys = keysFrom(saved.jwk);
      console.log('push: keys from ' + path);
      return keys;
    }
  } catch (e) {
    why = e.name;
  }
  const keys = makeKeys();
  try {
    file.write(JSON.stringify({ v: 1, jwk: keys.jwk }));
    console.log(why ? 'push: keys unreadable (' + why + '), made new ones' : 'push: keys made at ' + path);
  } catch (e) {
    console.log('push: keys not written (' + (e.code || e.name) + '), kept in memory');
  }
  return keys;
}

/**
 * Sends with the relay's `keys` (§4). `send(sub, payload)` resolves to the push service's status. It resolves to
 * 'refused' for an endpoint `allowed` turns away now, and to 'failed' when no answer came. It never follows a
 * redirect, never reads an answer's body, and gives up after `timeoutMs`. One JWT is kept for each push service.
 */
export function createPusher({ keys, now, allowed = isPushService, timeoutMs = SEND_TIMEOUT_MS }) {
  const jwts = new Map();   // a push service's origin -> { jwt, at }
  function jwtFor(aud) {
    const had = jwts.get(aud);
    if (had && now() - had.at < JWT_REUSE_MS) return had.jwt;
    const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const claims = b64u(JSON.stringify({ aud, exp: Math.floor(now() / 1000) + JWT_LIFE_S, sub: CONTACT }));
    const sig = sign('sha256', Buffer.from(head + '.' + claims), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
    const jwt = head + '.' + claims + '.' + b64u(sig);
    jwts.set(aud, { jwt, at: now() });
    return jwt;
  }
  async function send(sub, payload) {
    if (!allowed(sub.endpoint)) return 'refused';
    try {
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          TTL: '600',
          Urgency: 'high',
          Topic: 'reports',
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          Authorization: 'vapid t=' + jwtFor(new URL(sub.endpoint).origin) + ', k=' + keys.publicKey,
        },
        body: encrypt(JSON.stringify(payload), sub),
      });
      await res.body?.cancel();
      return res.status;
    } catch {
      return 'failed';
    }
  }
  return { publicKey: keys.publicKey, jwtFor, send };
}
```

- [ ] **Step 4: Run them and see them pass.**

Run: `node --test tests/push.test.js`
Expected: PASS, 9 tests. Node 24's `fetch` gives the 302 itself with `redirect: 'manual'`, which was measured while planning; a timeout rejects with `TimeoutError`.

- [ ] **Step 5: Run the full suite (P2), then commit and push.**

Expected: `fail 0`, with 505 tests in all.

```bash
git add relay/push.js tests/push.test.js
git commit -m "Web Push, part 2: the relay's keys on file, a JWT per push service, and one request that follows nothing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: The relay holds its keys and gives the page the public one

**Files:**
- Modify: `relay/server.js` — the imports, `createRelay`'s doc and parameters, the pusher, `signIn()`, the relay object and the command line
- Modify: `tests/staff.test.js`
- Modify: `tests/restart.test.js`

**Interfaces:**
- Consumes: `createPusher`, `isPushService`, `loadKeys` (Task 2).
- Produces:
  - `createRelay({ …, pushKeysFile, pushAllowed = isPushService })`;
  - `relay.pushKey`, the base64url public key;
  - the sign-in answer `{ t:'staff', ok:true, venue, token, push }`;
  - `ws.staff = { key, night, hash }` on a signed-in staff socket;
  - the command line reads `PUSH_KEYS_FILE`.

- [ ] **Step 1: Write the failing tests.**

In `tests/staff.test.js`, test `the right passcode signs in with a token, and the list comes at once`:
- change its first line `const { staff } = await start();` to `const { relay, staff } = await start();`;
- after `assert.match(a.token, /^[a-f0-9]{32}$/);` add:

```js
  assert.equal(a.push, relay.pushKey, 'the key its notifications are signed with');
  assert.match(relay.pushKey, /^B[A-Za-z0-9_-]{86}$/);
```

In test `a token signs in again after a reconnect, only at its own venue; a made-up one is expired`:
- change `const { staff } = await start();` to `const { relay, staff } = await start();`;
- change the `deepEqual` to:

```js
  assert.deepEqual(await again.signIn({ venue: 'staff-venue', token }), { t: 'staff', ok: true, venue: 'staff-venue', token, push: relay.pushKey });
```

In `tests/restart.test.js`:
- change `function night({ saveEveryMs = 3_600_000, graceMs, file } = {}) {` to `function night({ saveEveryMs = 3_600_000, graceMs, file, keys = false } = {}) {`;
- in its `createRelay` call, change `nightFile: n.file, saveEveryMs, ...(graceMs ? { graceMs } : {}),` to:

```js
      nightFile: n.file, saveEveryMs, ...(graceMs ? { graceMs } : {}),
      ...(keys ? { pushKeysFile: n.file.replace(/\.json$/, '-keys.json') } : {}),
```

In test `a staff token from before a restart signs in after it, to the same reports, marks and tags`:
- change its `const n = night();` to `const n = night({ keys: true });`;
- change `const before = s.list();` to:

```js
  const before = s.list();
  const key = n.relay.pushKey;
```

- change its `deepEqual` on the sign-in answer to:

```js
  assert.deepEqual(await again.signIn({ venue: 'restart-staff', token }), { t: 'staff', ok: true, venue: 'restart-staff', token, push: key },
    'the same keys, so a device\'s subscription still works');
```

- [ ] **Step 2: Run them and see them fail.**

Run: `npm run build >/dev/null && node --test tests/staff.test.js tests/restart.test.js`
Expected: FAIL in 3 tests. `a.push` is `undefined`, and the two `deepEqual`s lack `push`.

- [ ] **Step 3: Implement in `relay/server.js`.**

Add after `import { openNight } from './store.js';`:

```js
import { createPusher, isPushService, loadKeys } from './push.js';
```

In `createRelay`'s doc comment, after the lines about `nightFile` and `saveEveryMs`, add:

```js
 * `pushKeysFile` is where the relay's Web Push keys are kept, or none: made at start and kept in memory
 * (docs/superpowers/specs/2026-09-29-staff-push-design.md §2). `pushAllowed` is for tests: the check a push
 * service's address must pass, in place of the push services' own hosts (§3).
```

Change the parameter line `clientIpHeader, allClipsMax = ALL_CLIPS_MAX, staffCodes = process.env.STAFF_CODES, nightFile, saveEveryMs = 1000 } = {}) {` to:

```js
  clientIpHeader, allClipsMax = ALL_CLIPS_MAX, staffCodes = process.env.STAFF_CODES, nightFile, saveEveryMs = 1000,
  pushKeysFile, pushAllowed = isPushService } = {}) {
```

After the `tagOf` line, add:

```js
  // Staff devices' notifications are signed with the relay's own keys, kept in pushKeysFile across restarts
  // (docs/superpowers/specs/2026-09-29-staff-push-design.md §2).
  const pusher = createPusher({ keys: loadKeys(pushKeysFile), now, allowed: pushAllowed });
```

In `signIn()`, change:

```js
    ws.staff = { key, night };
    r.staff.add(ws);
    ws.send(JSON.stringify({ t: 'staff', ok: true, venue: key, token }));
```

to:

```js
    // Its token's hash too: a subscription or a sign-out names the sign-in it came from (push spec §3).
    ws.staff = { key, night, hash: tokenHashOf(token) };
    r.staff.add(ws);
    ws.send(JSON.stringify({ t: 'staff', ok: true, venue: key, token, push: pusher.publicKey }));
```

In the object `server.listen` resolves with, after `rooms,` add:

```js
      /** The public key staff devices subscribe with (base64url): the page has it from its sign-in answer. */
      pushKey: pusher.publicKey,
```

On the command line, change:

```js
  const nightFile = process.env.NIGHT_FILE || undefined;
  if (!nightFile) console.log('night: in memory only');
```

to:

```js
  const nightFile = process.env.NIGHT_FILE || undefined;
  if (!nightFile) console.log('night: in memory only');
  // The keys staff devices' notifications are signed with: PUSH_KEYS_FILE, on Fly /data/push-keys.json.
  const pushKeysFile = process.env.PUSH_KEYS_FILE || undefined;
  if (!pushKeysFile) console.log('push: keys in memory only');
```

and change `    nightFile,\n  });` in the `createRelay` call to:

```js
    nightFile,
    pushKeysFile,
  });
```

- [ ] **Step 4: Run them and see them pass.**

Run: `node --test tests/staff.test.js tests/restart.test.js`
Expected: PASS. The restart test logs `push: keys made at …-keys.json` and then `push: keys from …`.

- [ ] **Step 5: Run the full suite (P2), then commit and push.**

Expected: `fail 0`, with 505 tests.

```bash
git add relay/server.js tests/staff.test.js tests/restart.test.js
git commit -m "The relay keeps its push keys across a restart and gives each staff sign-in the public one" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 4: Taking a subscription, and signing out at the relay

**Files:**
- Modify: `relay/server.js` — `PUSH_SUBS_MAX`, `subscribed()`, `pushFrom()`, `signOutFrom()`, the staff dispatch, and the `pushedTo` hook
- Create: `tests/staff-push.test.js`

**Interfaces:**
- Consumes: `subscriptionOf` (Task 1); `ws.staff.hash` and `pushAllowed` (Task 3).
- Produces:
  - `{t:'push', sub}` from a signed-in staff socket, answered `{t:'push', ok:true}` or `{t:'push', ok:false, why:'bad push'}`;
  - `{t:'signout'}`: every socket on that token gets `{t:'staff', ok:false, why:'signed out'}` and close 4004;
  - token records `{ key, night, push?: { endpoint, p256dh, auth, at } }`;
  - `subscribed(key)`: tonight's records at `key` with a push, oldest first;
  - `relay.pushedTo(key)`.

- [ ] **Step 1: Write the failing tests.**

`tests/staff-push.test.js`:

```js
// ON THE BEAT — a new report reaches a closed or sleeping staff device (relay/server.js with relay/push.js;
// docs/superpowers/specs/2026-09-29-staff-push-design.md §2-§6), against a push service on 127.0.0.1 that opens
// what it is sent. Test passcodes only.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createRelay, WS_PATH } from '../relay/server.js';
import { makeEntry } from '../relay/staff.js';
import { helpers, pause } from './relay-harness.js';
import { pushService, subscriber } from './push-helpers.js';

const TZ = 'Australia/Brisbane';                     // UTC+10, no daylight saving
const EIGHT_PM = Date.UTC(2026, 8, 29, 10, 0);      // 20:00 on 29 Sep there
const NEXT_MORNING = Date.UTC(2026, 8, 29, 20, 30); // 06:30 on 30 Sep there: the next night
const WINDOW = 600;                                 // a venue's push window, shortened for tests
const VENUE = 'roundhouse-bruno-mars';              // in relay/shows.json: The Roundhouse, Camden
let base;
let root;
let CODES;
let service;
let files = 0;
let addresses = 0;
const running = [];

before(async () => {
  base = mkdtempSync(join(tmpdir(), 'otb-staff-push-'));
  root = join(base, 'dist');
  mkdirSync(root);
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>On The Beat</title>');
  writeFileSync(join(root, 'staff.html'), '<!doctype html><title>Staff</title>');
  CODES = JSON.stringify({ [VENUE]: await makeEntry('test-passcode-1'), 'push-other': await makeEntry('test-passcode-2') });
  service = await pushService();
});

after(async () => {
  for (const x of running) if (x.open) await x.stop();
  await service.close();
  rmSync(base, { recursive: true, force: true });
});

/** Polls until `pred()` holds, or fails after `ms`. */
async function until(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out');
    await pause(20);
  }
}

/**
 * A relay on a clock the test moves, sending only to the test's push service, with a night file and a keys file
 * when asked. `restart()` stops it, moves the clock half a minute and starts a new relay on the same files.
 */
async function start({ nightFile, pushKeysFile } = {}) {
  const x = { clock: { t: EIGHT_PM }, open: false };
  x.start = async () => {
    x.relay = await createRelay({
      port: 0, host: '127.0.0.1', root, clock: () => x.clock.t, nightTz: TZ, staffCodes: CODES,
      nightFile, pushKeysFile, saveEveryMs: 3_600_000, pushEveryMs: WINDOW,
      pushAllowed: (e) => typeof e === 'string' && e.startsWith(service.origin + '/'),
    });
    x.h = helpers(() => x.relay.port);
    x.open = true;
    return x;
  };
  x.stop = async () => { x.h.cleanup(); await x.relay.close(); x.open = false; };
  x.restart = async () => { await x.stop(); x.clock.t += 30_000; return x.start(); };
  running.push(x);
  return x.start();
}

/** A staff page's socket: its sign-in answers, lists and push answers, and how it closed. */
async function staffOn(x) {
  const ws = new WebSocket('ws://127.0.0.1:' + x.relay.port + WS_PATH, { headers: { 'cf-connecting-ip': '203.0.113.' + (1 + (addresses++ % 199)) } });
  const s = { ws, answers: [], lists: [], pushes: [], closed: null };
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.t === 'staff') s.answers.push(m);
    if (m.t === 'reports') s.lists.push(m.reports);
    if (m.t === 'push') s.pushes.push(m);
  });
  ws.on('close', (code) => { s.closed = code; });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  s.send = (m) => ws.send(JSON.stringify(m));
  s.signIn = async (m) => { const n = s.answers.length; s.send({ t: 'staff', ...m }); await until(() => s.answers.length > n); return s.answers.at(-1); };
  s.subscribe = async (sub) => { const n = s.pushes.length; s.send({ t: 'push', sub }); await until(() => s.pushes.length > n); return s.pushes.at(-1); };
  return s;
}

/** A staff device signed in at `venue` with notifications on: its socket, its subscriber and its token. */
async function notified(x, venue = VENUE, code = 'test-passcode-1') {
  const s = await staffOn(x);
  const a = await s.signIn({ venue, code });
  assert.equal(a.ok, true, JSON.stringify(a));
  const who = subscriber(service.endpoint());
  assert.deepEqual(await s.subscribe(who.sub), { t: 'push', ok: true });
  return { s, who, token: a.token };
}

/** What reached one subscriber's endpoint. */
const to = (who) => service.got.filter((g) => g.url === new URL(who.sub.endpoint).pathname);

// ---------- §3: taking a subscription ----------

test('a subscription is taken only from signed-in staff, only for a push service, only with real keys', async () => {
  const x = await start();
  const who = subscriber(service.endpoint());
  const ana = await x.h.phone(VENUE);
  ana.send({ t: 'push', sub: who.sub });
  const band = await x.h.wristband();
  band.send({ t: 'push', sub: who.sub });
  const early = await staffOn(x);
  early.send({ t: 'push', sub: who.sub });
  await pause(300);
  assert.equal(early.pushes.length, 0, 'not signed in: nothing taken, nothing said');
  assert.deepEqual(x.relay.pushedTo(VENUE), []);
  const s = await staffOn(x);
  assert.equal((await s.signIn({ venue: VENUE, code: 'test-passcode-1' })).ok, true);
  for (const sub of [
    { ...who.sub, endpoint: 'https://evil.example/push' },
    { ...who.sub, keys: { ...who.sub.keys, auth: 'AAAA' } },
    { ...who.sub, keys: { ...who.sub.keys, p256dh: who.sub.keys.p256dh.slice(0, 40) } },
    { endpoint: who.sub.endpoint },
    'not a subscription',
  ]) assert.deepEqual(await s.subscribe(sub), { t: 'push', ok: false, why: 'bad push' }, JSON.stringify(sub));
  assert.deepEqual(x.relay.pushedTo(VENUE), []);
  assert.deepEqual(await s.subscribe(who.sub), { t: 'push', ok: true });
  assert.deepEqual(x.relay.pushedTo(VENUE), [who.sub.endpoint]);
});

test('a sign-in holds one subscription, and an endpoint is held once', async () => {
  const x = await start();
  const { s } = await notified(x);
  const newer = subscriber(service.endpoint());
  x.clock.t += 1;
  assert.deepEqual(await s.subscribe(newer.sub), { t: 'push', ok: true });
  assert.deepEqual(x.relay.pushedTo(VENUE), [newer.sub.endpoint], 'the newer replaces it');
  const other = await staffOn(x);
  assert.equal((await other.signIn({ venue: VENUE, code: 'test-passcode-1' })).ok, true);
  x.clock.t += 1;
  assert.deepEqual(await other.subscribe(newer.sub), { t: 'push', ok: true });
  assert.deepEqual(x.relay.pushedTo(VENUE), [newer.sub.endpoint], 'held once, by the sign-in that sent it last');
});

test('a venue holds at most 50 subscriptions: the 51st forgets the oldest', async () => {
  const x = await start();
  const devices = [];
  for (let i = 0; i < 51; i += 1) {
    devices.push(await notified(x));
    x.clock.t += 1;
  }
  assert.deepEqual(x.relay.pushedTo(VENUE), devices.slice(1).map((d) => d.who.sub.endpoint));
});

test('SIGN OUT reaches the relay: that sign-in ends on every tab that shared it, with its subscription', async () => {
  const x = await start();
  const { s, token } = await notified(x);
  const tab = await staffOn(x);                     // the same device's other tab, on the same token
  assert.equal((await tab.signIn({ venue: VENUE, token })).ok, true);
  s.send({ t: 'signout' });
  await until(() => s.closed !== null && tab.closed !== null);
  assert.deepEqual(tab.answers.at(-1), { t: 'staff', ok: false, why: 'signed out' });
  assert.equal(tab.closed, 4004);
  assert.deepEqual(x.relay.pushedTo(VENUE), []);
  const again = await staffOn(x);
  assert.equal((await again.signIn({ venue: VENUE, token })).why, 'expired');
});

test('06:00 ends the night\'s subscriptions with its sign-ins', async () => {
  const x = await start();
  await notified(x);
  x.clock.t = NEXT_MORNING;
  x.relay.expire(NEXT_MORNING);
  assert.deepEqual(x.relay.pushedTo(VENUE), []);
});
```

- [ ] **Step 2: Run them and see them fail.**

Run: `node --test tests/staff-push.test.js`
Expected: FAIL. The first test errors with `x.relay.pushedTo is not a function`. `notified()` times out waiting for a `push` answer: `timed out`.

- [ ] **Step 3: Implement in `relay/server.js`.**

After `const STAFF_TOKENS_MAX = 1000; …`, add:

```js
const PUSH_SUBS_MAX = 50;             // staff devices a venue sends notifications to; past it the oldest is forgotten
```

Change the import from `./push.js` to:

```js
import { createPusher, isPushService, loadKeys, subscriptionOf } from './push.js';
```

After `function handledBy(ws, m) { … }`, add:

```js
  // ---------- staff devices' notifications (docs/superpowers/specs/2026-09-29-staff-push-design.md §3) ----------

  /** Tonight's sign-ins at a venue that hold a subscription, the oldest subscription first. */
  function subscribed(key) {
    const tonight = nightOf(now(), nightTz);
    return [...tokens.values()].filter((t) => t.key === key && t.night === tonight && t.push).sort((a, b) => a.push.at - b.push.at);
  }

  /** A signed-in staff device's subscription, onto its sign-in: one a sign-in, an endpoint once, 50 a venue. */
  function pushFrom(ws, m) {
    const t = tokens.get(ws.staff.hash);
    const sub = subscriptionOf(m.sub, pushAllowed);
    if (!t || !sub) { ws.send(JSON.stringify({ t: 'push', ok: false, why: 'bad push' })); return; }
    for (const other of tokens.values()) if (other.push?.endpoint === sub.endpoint) delete other.push;
    const held = subscribed(t.key).filter((x) => x !== t);
    while (held.length >= PUSH_SUBS_MAX) delete held.shift().push;
    t.push = { ...sub, at: now() };
    ws.send(JSON.stringify({ t: 'push', ok: true }));
  }

  /** SIGN OUT: the sign-in goes, with its subscription, and every socket signed in with it is signed out. */
  function signOutFrom(ws) {
    const { key, hash } = ws.staff;
    tokens.delete(hash);
    const r = rooms.get(key);
    for (const s of [...(r?.staff ?? [])]) {
      if (s.staff.hash !== hash) continue;
      r.staff.delete(s);
      s.send(JSON.stringify({ t: 'staff', ok: false, why: 'signed out' }));
      s.close(4004, 'signed out');
    }
  }
```

Change the staff dispatch in `handle()`:

```js
    // A signed-in staff socket only marks reports: what a phone or a wristband would say is ignored.
    if (ws.staff) { if (m.t === 'handled') handledBy(ws, m); return; }
```

to:

```js
    // A signed-in staff socket only marks reports, hands over its device's subscription, or signs out: what a
    // phone or a wristband would say is ignored.
    if (ws.staff) {
      if (m.t === 'handled') handledBy(ws, m);
      if (m.t === 'push') pushFrom(ws, m);
      if (m.t === 'signout') signOutFrom(ws);
      return;
    }
```

In the relay object, after `roomCount: () => rooms.size,`, add:

```js
      /** For tests: the endpoints a venue's staff devices are held for, oldest first, whatever their night. */
      pushedTo: (key) => [...tokens.values()].filter((t) => t.key === key && t.push).sort((a, b) => a.push.at - b.push.at)
        .map((t) => t.push.endpoint),
```

- [ ] **Step 4: Run them and see them pass.**

Run: `node --test tests/staff-push.test.js`
Expected: PASS, 5 tests. The 06:00 test passes as soon as `pushedTo` exists: the sweep already drops the tokens, and the subscriptions go with them (amendment 6).

- [ ] **Step 5: Run the full suite (P2), then commit and push.**

Expected: `fail 0`, with 510 tests.

```bash
git add relay/server.js tests/staff-push.test.js
git commit -m "Staff devices hand the relay their subscriptions, and SIGN OUT reaches the relay" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 5: Sending on a report, at most once a window

**Files:**
- Modify: `relay/server.js` — `PUSH_EVERY_MS`, the `pushEveryMs` parameter, `alerts`, `alertStaff()`, `pushAll()`, `openAt()`, `case 'report'` and `close()`
- Modify: `tests/staff-push.test.js`

**Interfaces:**
- Consumes: `pusher.send` (Task 2); `subscribed()` (Task 4).
- Produces:
  - `export const PUSH_EVERY_MS = 10_000`;
  - `createRelay({ …, pushEveryMs = PUSH_EVERY_MS })`;
  - one log line per push round: `push: <key> <n> sent, <n> gone, <n> failed`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/staff-push.test.js`:

```js
// ---------- §4: sending ----------

/** A phone at `venue` reports something, with no one named. */
async function report(x, venue = VENUE) {
  const p = await x.h.phone(venue);
  p.send({ t: 'report', why: 'a spill by the stairs' });
  return p;
}

test('a report reaches each device that turned notifications on, once, sealed: the venue and how many are open', async () => {
  const x = await start();
  const a = await notified(x);
  const b = await notified(x);
  const other = await notified(x, 'push-other', 'test-passcode-2');
  await report(x);
  await until(() => to(a.who).length === 1 && to(b.who).length === 1);
  for (const who of [a.who, b.who]) {
    const [req] = to(who);
    assert.deepEqual(JSON.parse(who.open(req.body)), { venue: 'The Roundhouse, Camden', open: 1 });
    assert.equal(req.headers.ttl, '600');
    assert.equal(req.headers.urgency, 'high');
    assert.equal(req.headers.topic, 'reports');
    assert.equal(req.headers['content-encoding'], 'aes128gcm');
    assert.match(req.headers.authorization, new RegExp(', k=' + x.relay.pushKey + '$'));
  }
  await pause(WINDOW + 200);
  assert.equal(to(a.who).length, 1, 'once');
  assert.equal(to(other.who).length, 0, 'another venue hears nothing');
});

test('a venue is sent at most one push a window: later reports wait for its end, which carries the count then', async () => {
  const x = await start();
  const { who } = await notified(x);
  const p = await report(x);
  await until(() => to(who).length === 1);
  p.send({ t: 'report', why: 'another' });
  p.send({ t: 'report', why: 'and another' });
  await pause(WINDOW / 3);
  assert.equal(to(who).length, 1, 'held to the window');
  await until(() => to(who).length === 2);
  assert.deepEqual(JSON.parse(who.open(to(who)[1].body)), { venue: 'The Roundhouse, Camden', open: 3 });
  await pause(WINDOW + 200);
  assert.equal(to(who).length, 2, 'that push opened a window of its own, and nothing came in it');
});

test('a window that closes with nothing open sends nothing more', async () => {
  const x = await start();
  const { s, who } = await notified(x);
  const p = await report(x);
  await until(() => to(who).length === 1);
  p.send({ t: 'report', why: 'another' });
  await until(() => s.lists.at(-1)?.length === 2);
  for (const r of s.lists.at(-1)) s.send({ t: 'handled', id: r.id, on: true });
  await until(() => s.lists.at(-1).every((r) => r.handledAt > 0));
  await pause(WINDOW + 200);
  assert.equal(to(who).length, 1);
});

test('404, 410 and 403 forget that device and a 500 does not; the log says counts, never an address or a key', async () => {
  const x = await start();
  const devices = [];
  for (const status of [404, 410, 403, 500]) {
    const d = await notified(x);
    service.statusFor.set(new URL(d.who.sub.endpoint).pathname, status);
    devices.push(d);
    x.clock.t += 1;
  }
  const said = [];
  const log = console.log;
  console.log = (...a) => { said.push(a.join(' ')); };
  try {
    await report(x);
    await until(() => said.some((l) => l.startsWith('push: ')));
  } finally {
    console.log = log;
  }
  assert.ok(said.includes('push: ' + VENUE + ' 0 sent, 3 gone, 1 failed'), said.join('\n'));
  for (const l of said) {
    for (const d of devices) {
      for (const secret of [d.who.sub.endpoint, d.who.sub.keys.p256dh, d.who.sub.keys.auth]) assert.ok(!l.includes(secret), l);
    }
  }
  assert.deepEqual(x.relay.pushedTo(VENUE), [devices[3].who.sub.endpoint]);
});
```

- [ ] **Step 2: Run them and see them fail.**

Run: `node --test tests/staff-push.test.js`
Expected: FAIL in the 4 new tests. Nothing reaches the service (`timed out`), and the log has no `push: ` line.

- [ ] **Step 3: Implement in `relay/server.js`.**

After `export const HEARD_GAP_MS = 5000; …`, add:

```js
export const PUSH_EVERY_MS = 10_000;          // a venue's staff devices hear of new reports at most this often
```

In the doc comment, change `service's address must pass, in place of the push services' own hosts (§3).` to:

```js
 * service's address must pass, in place of the push services' own hosts (§3), and `pushEveryMs` the window (§4).
```

Change `pushKeysFile, pushAllowed = isPushService } = {}) {` to:

```js
  pushKeysFile, pushAllowed = isPushService, pushEveryMs = PUSH_EVERY_MS } = {}) {
```

After `function signOutFrom(ws) { … }`, add:

```js
  // ---------- sending (push spec §4) ----------

  // A venue's staff devices hear of new reports at most once a window: key -> { again, timer }.
  const alerts = new Map();
  const openAt = (key) => rooms.get(key)?.room.reports().filter((x) => !x.handledAt).length ?? 0;

  /** A report was taken at `key`: its devices are told now, or when the window ends. */
  function alertStaff(key) {
    const w = alerts.get(key);
    if (w) { w.again = true; return; }
    pushAll(key);
  }

  /**
   * Every device subscribed at `key` is sent the venue and how many are open, and a window opens. A report in it
   * brings one more push when it ends, unless nothing is open by then. A push service's 404, 410 or 403 forgets that
   * device. The log says how many, never to whom.
   */
  function pushAll(key) {
    const w = { again: false, timer: null };
    alerts.set(key, w);
    w.timer = setTimeout(() => {
      alerts.delete(key);
      if (w.again && openAt(key) > 0) pushAll(key);
    }, pushEveryMs);
    const held = subscribed(key);
    if (!held.length) return;
    const payload = { venue: shows.find((s) => s.id === key)?.venue ?? key, open: openAt(key) };
    Promise.all(held.map((t) => {
      const sub = t.push;
      return pusher.send(sub, payload).then((status) => ({ t, sub, status }));
    })).then((results) => {
      let sent = 0;
      let gone = 0;
      let failed = 0;
      for (const { t, sub, status } of results) {
        if (typeof status === 'number' && status >= 200 && status < 300) sent += 1;
        else if (status === 404 || status === 410 || status === 403 || status === 'refused') {
          gone += 1;
          if (t.push === sub) delete t.push;   // unless the device has sent a new one since
        } else failed += 1;
      }
      console.log('push: ' + key + ' ' + sent + ' sent, ' + gone + ' gone, ' + failed + ' failed');
    });
  }
```

Change `case 'report':` from:

```js
      case 'report':
        // To the venue's staff page, with the push below. The log says one came and nothing it says: logs are kept.
        if (room.report(me, m.handle || null, m.why)) console.log('REPORT', r.key, room.reports().at(-1).id);
        break;
```

to:

```js
      case 'report':
        // To the venue's staff page, with the push below, and to its staff devices' notifications. The log says
        // one came and nothing it says: logs are kept.
        if (room.report(me, m.handle || null, m.why)) {
          console.log('REPORT', r.key, room.reports().at(-1).id);
          alertStaff(r.key);
        }
        break;
```

In `close()`, after `clearInterval(keeper);`, add:

```js
        for (const w of alerts.values()) clearTimeout(w.timer);
```

- [ ] **Step 4: Run them and see them pass.**

Run: `node --test tests/staff-push.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full suite (P2), then commit and push.**

Expected: `fail 0`, with 514 tests.

```bash
git add relay/server.js tests/staff-push.test.js
git commit -m "A report reaches a venue's staff devices, sealed, at most once a window; gone devices are forgotten" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 6: Subscriptions across a restart

**Files:**
- Modify: `relay/server.js` — `tokenFrom()` in the night's restore
- Modify: `tests/staff-push.test.js`

**Interfaces:**
- Consumes: `subscriptionOf` (Task 1); token records (Task 4).
- Produces: sign-ins restored as `{ key, night }` or `{ key, night, push }`. A subscription that fails §3 now is left behind.

- [ ] **Step 1: Write the tests.** Append to `tests/staff-push.test.js`:

```js
// ---------- §3: the night file ----------

test('a subscription and the keys carry across a restart: the device is still sent to, under the same key', async () => {
  files += 1;
  const x = await start({ nightFile: join(base, 'night-' + files + '.json'), pushKeysFile: join(base, 'keys-' + files + '.json') });
  const { who } = await notified(x);
  const key = x.relay.pushKey;
  await x.restart();
  assert.equal(x.relay.pushKey, key, 'the same keys');
  await report(x);
  await until(() => to(who).length === 1);
  assert.match(to(who)[0].headers.authorization, new RegExp(', k=' + key + '$'));
});

test('a subscription in the night file that fails the checks is left behind at a restart; its sign-in is kept', async () => {
  files += 1;
  const nightFile = join(base, 'night-' + files + '.json');
  const x = await start({ nightFile });
  const { token } = await notified(x);
  await x.stop();
  const saved = JSON.parse(readFileSync(nightFile, 'utf8'));
  saved.tokens[0][1].push.endpoint = 'https://evil.example/push';
  writeFileSync(nightFile, JSON.stringify(saved));
  await x.start();
  assert.deepEqual(x.relay.pushedTo(VENUE), [], 'left behind');
  const s = await staffOn(x);
  assert.equal((await s.signIn({ venue: VENUE, token })).ok, true, 'the sign-in is kept');
});
```

- [ ] **Step 2: Run them.**

Run: `node --test tests/staff-push.test.js`
Expected:
- The first new test passes already, because token records are saved and restored whole. It stays as the guard for the keys and the record.
- The second fails: `pushedTo` gives `['https://evil.example/push']`.

- [ ] **Step 3: Implement in `relay/server.js`.** In `restoreNight()`, change `tokens: new Map(saved.tokens),` to:

```js
        tokens: new Map(saved.tokens.map(([hash, t]) => [hash, tokenFrom(t)])),
```

Before `function restoreNight(saved) {` and its doc comment, add:

```js
  /** A sign-in from the night file. A subscription that fails §3's checks now is left behind; the sign-in stays. */
  function tokenFrom({ key, night, push }) {
    const sub = push && subscriptionOf({ endpoint: push.endpoint, keys: { p256dh: push.p256dh, auth: push.auth } }, pushAllowed);
    return sub ? { key, night, push: { ...sub, at: Number(push.at) || 0 } } : { key, night };
  }
```

- [ ] **Step 4: Run them and see them pass.**

Run: `node --test tests/staff-push.test.js tests/restart.test.js`
Expected: PASS: `tests/staff-push.test.js`'s 11 tests and all of `tests/restart.test.js`.

- [ ] **Step 5: Run the full suite (P2), then commit and push.**

Expected: `fail 0`, with 516 tests.

```bash
git add relay/server.js tests/staff-push.test.js
git commit -m "Staff devices' subscriptions carry across a restart; one that fails the checks is left behind" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 7: The staff page's own worker and manifest

**Files:**
- Create: `app/public/staff-sw.js`
- Create: `app/public/staff.webmanifest`
- Modify: `app/staff.html`
- Create: `tests/staff-sw.test.js`
- Modify: `tests/staff-page.test.js`

**Interfaces:**
- Produces:
  - `/staff-sw.js`: a `push` listener that shows `{ title, body, tag: 'otb-reports', renotify: true, icon: '/icon-192.png', data: { url: '/staff' } }`; a `notificationclick` listener that focuses a `/staff` window or opens `/staff`; no `fetch` listener;
  - `/staff.webmanifest`, with `id`, `start_url` and `scope` all `/staff`.

- [ ] **Step 1: Write the failing tests.**

`tests/staff-sw.test.js`:

```js
// ON THE BEAT — the staff page's service worker (app/public/staff-sw.js;
// docs/superpowers/specs/2026-09-29-staff-push-design.md §1), run in a vm with a fake `self`: what a push shows,
// and where a tap on it goes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app/public/staff-sw.js', import.meta.url), 'utf8');

/** The worker, loaded fresh: its listeners, what it showed, the windows it can see and what it opened. */
function worker(windows = []) {
  const listeners = {};
  const w = { listeners, shown: [], opened: [], focused: [], closed: false };
  const waits = [];
  vm.runInNewContext(source, {
    URL,
    self: {
      addEventListener: (type, f) => { listeners[type] = f; },
      skipWaiting: () => Promise.resolve(),
      registration: {
        showNotification: (title, options) => { w.shown.push(JSON.parse(JSON.stringify({ title, ...options }))); return Promise.resolve(); },
      },
      clients: {
        matchAll: async () => windows.map((url) => ({ url, focus: async () => { w.focused.push(url); } })),
        openWindow: async (url) => { w.opened.push(url); },
      },
    },
  });
  w.push = async (data) => {
    const json = () => (typeof data === 'string' ? JSON.parse(data) : data);
    listeners.push({ data: data === undefined ? null : { json }, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  };
  w.click = async () => {
    listeners.notificationclick({ notification: { close: () => { w.closed = true; } }, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  };
  return w;
}

test('a push shows the venue and how many are open, tagged so a newer one replaces it and still alerts', async () => {
  const w = worker();
  await w.push({ venue: 'The Roundhouse, Camden', open: 2 });
  await w.push({ venue: 'The Roundhouse, Camden', open: 1 });
  assert.deepEqual(w.shown, [
    { title: 'New report · The Roundhouse, Camden', body: '2 open — tap to see them', tag: 'otb-reports', renotify: true, icon: '/icon-192.png', data: { url: '/staff' } },
    { title: 'New report · The Roundhouse, Camden', body: '1 open — tap to see it', tag: 'otb-reports', renotify: true, icon: '/icon-192.png', data: { url: '/staff' } },
  ]);
});

test('a push with no data, or data it cannot read, still shows New report: Safari takes the permission back otherwise', async () => {
  const w = worker();
  await w.push(undefined);
  await w.push('not json {');
  await w.push({ venue: 42, open: 'many' });
  assert.deepEqual(w.shown.map((n) => [n.title, n.body, n.tag]), [
    ['New report', 'Tap to see the list', 'otb-reports'],
    ['New report', 'Tap to see the list', 'otb-reports'],
    ['New report', 'Tap to see the list', 'otb-reports'],
  ]);
});

test('a tap on it focuses an open staff window, or opens /staff', async () => {
  const open = worker(['https://otb.test/tonight', 'https://otb.test/staff']);
  await open.click();
  assert.equal(open.closed, true);
  assert.deepEqual(open.focused, ['https://otb.test/staff']);
  assert.deepEqual(open.opened, []);
  const none = worker(['https://otb.test/tonight']);
  await none.click();
  assert.deepEqual(none.opened, ['/staff']);
});

test('it keeps nothing: the staff page stays live or nothing', () => {
  assert.equal(worker().listeners.fetch, undefined);
});
```

In `tests/staff-page.test.js`:
- change `import { readFileSync } from 'node:fs';` to `import { existsSync, readFileSync } from 'node:fs';`;
- after test `the build made the staff page`, add:

```js
test('the build gives the staff page its own manifest and its own worker', () => {
  const page = readFileSync(root + 'dist/staff.html', 'utf8');
  assert.match(page, /<link rel="manifest" href="\/staff\.webmanifest">/);
  assert.match(page, /<link rel="apple-touch-icon" href="\/icon-192\.png">/);
  const manifest = JSON.parse(readFileSync(root + 'dist/staff.webmanifest', 'utf8'));
  assert.equal(manifest.id, '/staff');
  assert.equal(manifest.start_url, '/staff');
  assert.equal(manifest.scope, '/staff');
  assert.equal(manifest.display, 'standalone', 'what iOS needs before it allows Web Push');
  assert.ok(existsSync(root + 'dist/staff-sw.js'));
});
```

- [ ] **Step 2: Run them and see them fail.**

Run: `npm run build >/dev/null && node --test tests/staff-sw.test.js tests/staff-page.test.js`
Expected: FAIL. `tests/staff-sw.test.js` does not load (`ENOENT … staff-sw.js`), and the manifest test fails on the `<link rel="manifest"` match.

- [ ] **Step 3: Write the worker, the manifest and the links.**

`app/public/staff-sw.js`:

```js
// ON THE BEAT — the staff page's service worker (docs/superpowers/specs/2026-09-29-staff-push-design.md §1). It
// shows a new report's notification and opens the page when one is tapped. It keeps nothing, so there is no fetch
// handler: the staff page is live or nothing.

const TAG = 'otb-reports';

self.addEventListener('install', () => { self.skipWaiting(); });

/** New report · <venue>, and how many are open. What cannot be read still says New report. */
function noticeOf(data) {
  const venue = data && typeof data.venue === 'string' ? data.venue.slice(0, 80) : '';
  const open = data && Number.isInteger(data.open) && data.open > 0 ? data.open : 0;
  return {
    title: venue ? 'New report · ' + venue : 'New report',
    body: open === 1 ? '1 open — tap to see it' : open > 1 ? open + ' open — tap to see them' : 'Tap to see the list',
  };
}

self.addEventListener('push', (e) => {
  let data = null;
  try {
    data = e.data ? e.data.json() : null;
  } catch {
    data = null;
  }
  const { title, body } = noticeOf(data);
  // Safari takes the permission back from a site whose push shows nothing: every push shows one.
  e.waitUntil(self.registration.showNotification(title, { body, tag: TAG, renotify: true, icon: '/icon-192.png', data: { url: '/staff' } }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
    const page = all.find((c) => new URL(c.url).pathname.startsWith('/staff'));
    return page ? page.focus() : self.clients.openWindow('/staff');
  }));
});
```

`app/public/staff.webmanifest`:

```json
{
  "id": "/staff",
  "name": "On The Beat staff",
  "short_name": "OTB Staff",
  "description": "Reports from people at your venue, as they come in.",
  "start_url": "/staff",
  "scope": "/staff",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#000000",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

In `app/staff.html`, after `<link rel="icon" href="/icon-192.png" sizes="192x192">`, add:

```html
<link rel="manifest" href="/staff.webmanifest">
<link rel="apple-touch-icon" href="/icon-192.png">
```

- [ ] **Step 4: Run them and see them pass.**

Run: `npm run build >/dev/null && node --test tests/staff-sw.test.js tests/staff-page.test.js`
Expected: PASS. `tests/staff-sw.test.js` has 4 tests, and `tests/staff-page.test.js` all of its tests plus the new one.

- [ ] **Step 5: Run the full suite (P2), then commit and push.**

Expected: `fail 0`, with 521 tests.

```bash
git add app/public/staff-sw.js app/public/staff.webmanifest app/staff.html tests/staff-sw.test.js tests/staff-page.test.js
git commit -m "The staff page gets its own manifest and a worker that only shows a report's notification" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 8: The page turns notifications on, keeps its sign-in, and signs out at the relay

**Files:**
- Create: `app/staff/notify.js`
- Create: `tests/staff-notify.test.js`
- Modify: `app/staff/list.js` — `REFUSED['signed out']`
- Modify: `tests/staff-page.test.js` — the list of refusals
- Modify: `app/staff/Staff.jsx` — the whole file below
- Modify: `app/staff/staff.css`
- Modify: `app/staff/main.jsx` — its comment

**Interfaces:**
- Consumes: the sign-in answer's `push` (Task 3); `{t:'push'}` answers and `{t:'signout'}` (Task 4); `/staff-sw.js` (Task 7).
- Produces:
  - `NOTICE_TAG`;
  - `NOTIFY_WORDS` for `off`, `asking`, `on`, `install`, `blocked`, `none` and `refused`;
  - `startState({ secure, sw, push, standalone, permission })`;
  - `fromB64u(s): Uint8Array`;
  - `sameKey(sub, key): boolean`.

- [ ] **Step 1: Write the failing tests.**

`tests/staff-notify.test.js`:

```js
// ON THE BEAT — a staff device's notifications, in words (app/staff/notify.js;
// docs/superpowers/specs/2026-09-29-staff-push-design.md §1). Pure, so no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTICE_TAG, NOTIFY_WORDS, fromB64u, sameKey, startState } from '../app/staff/notify.js';

const here = { secure: true, sw: true, push: true, standalone: undefined, permission: 'default' };

test('where a device starts: the button, blocked, no Web Push, or an iPhone to add to the Home Screen first', () => {
  assert.equal(startState(here), 'off');
  assert.equal(startState({ ...here, permission: 'granted' }), 'off', 'then on again after sign-in, by itself');
  assert.equal(startState({ ...here, permission: 'denied' }), 'blocked');
  assert.equal(startState({ ...here, push: false, standalone: false }), 'install', 'an iPhone, in Safari');
  assert.equal(startState({ ...here, standalone: true }), 'off', 'an iPhone, from the Home Screen');
  assert.equal(startState({ ...here, push: false, standalone: true }), 'none', 'an iPhone too old for Web Push');
  assert.equal(startState({ ...here, push: false }), 'none');
  assert.equal(startState({ ...here, sw: false }), 'none');
  assert.equal(startState({ ...here, secure: false }), 'none');
});

test('every state has words of its own, and the button says what it does', () => {
  for (const state of ['off', 'asking', 'on', 'install', 'blocked', 'none', 'refused']) assert.ok(NOTIFY_WORDS[state], state);
  assert.equal(new Set(Object.values(NOTIFY_WORDS)).size, Object.keys(NOTIFY_WORDS).length);
  assert.equal(NOTIFY_WORDS.off, 'NOTIFY THIS DEVICE');
  assert.equal(NOTICE_TAG, 'otb-reports', 'the tag staff-sw.js shows them with');
});

test('the relay\'s key as bytes, and whether a subscription was made with it', () => {
  const bytes = [4, ...Array.from({ length: 64 }, (_, i) => i)];
  const key = Buffer.from(bytes).toString('base64url');
  assert.deepEqual([...fromB64u(key)], bytes);
  const made = (b) => ({ options: { applicationServerKey: Uint8Array.from(b).buffer } });
  assert.equal(sameKey(made(bytes), key), true);
  assert.equal(sameKey(made([4, ...Array(64).fill(9)]), key), false);
  assert.equal(sameKey({ options: {} }, key), false);
  assert.equal(sameKey(null, key), false);
});
```

In `tests/staff-page.test.js`, change the line

```js
  for (const why of ['no staff page', 'wrong code', 'too many tries', 'expired', 'bad staff', 'too many venues']) assert.ok(REFUSED[why], why);
```

to

```js
  for (const why of ['no staff page', 'wrong code', 'too many tries', 'expired', 'bad staff', 'too many venues', 'signed out']) assert.ok(REFUSED[why], why);
```

- [ ] **Step 2: Run them and see them fail.**

Run: `node --test tests/staff-notify.test.js tests/staff-page.test.js`
Expected: FAIL. `tests/staff-notify.test.js` cannot find `app/staff/notify.js`, and the refusals test fails on `signed out`.

- [ ] **Step 3: Write `app/staff/notify.js` and the refusal.**

`app/staff/notify.js`:

```js
// ON THE BEAT — a staff device's notifications, in words (docs/superpowers/specs/2026-09-29-staff-push-design.md
// §1): where this browser starts, what the line under the header says, and the relay's key as bytes. Pure, so
// they are tested without a browser.

/** The tag every report notification carries (public/staff-sw.js): a newer one replaces the older. */
export const NOTICE_TAG = 'otb-reports';

/** The line under the header, for each state; 'off' is the button's. */
export const NOTIFY_WORDS = {
  off: 'NOTIFY THIS DEVICE',
  asking: 'Turning on…',
  on: 'Notifications on for this device.',
  install: 'To get notifications on iPhone: Share, then Add to Home Screen, and open Staff from there.',
  blocked: 'Notifications are blocked for this page. Allow them in the browser\'s settings to get them here.',
  none: 'This browser can\'t show notifications. Keep this page open to hear new reports.',
  refused: 'This browser\'s notifications can\'t be used here.',
};

/**
 * Where a signed-in device starts. 'install' is an iPhone in Safari, which has Web Push only from the Home Screen;
 * 'none' is a browser with no Web Push; 'blocked' is a device whose permission was refused. Anything else is 'off',
 * the button, and a device that turned them on before goes on by itself once signed in.
 */
export function startState({ secure, sw, push, standalone, permission }) {
  if (standalone === false && !push) return 'install';
  if (!secure || !sw || !push) return 'none';
  if (permission === 'denied') return 'blocked';
  return 'off';
}

/** base64url to bytes, as pushManager.subscribe() takes the relay's key. */
export function fromB64u(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Was this subscription made with the relay's key? One made under another key is made again. */
export function sameKey(sub, key) {
  const k = sub?.options?.applicationServerKey;
  if (!k || !key) return false;
  const a = new Uint8Array(k);
  const b = fromB64u(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
```

In `app/staff/list.js`, after `'too many venues': 'The relay is full right now. Try again in a minute.',`, add:

```js
  'signed out': 'Signed out. Enter the passcode again.',
```

- [ ] **Step 4: Run them and see them pass.**

Run: `node --test tests/staff-notify.test.js tests/staff-page.test.js`
Expected: PASS.

- [ ] **Step 5: Rewrite `app/staff/Staff.jsx`.** Replace the whole file with:

```jsx
// ON THE BEAT — the staff page (docs/superpowers/specs/2026-09-28-staff-reports-design.md §4): a venue's team
// signs in with its passcode, sees reports as they come, marks them handled, and hears a new one after a tap.
// A device can be told of one with the page closed or asleep too: a notification, by Web Push
// (docs/superpowers/specs/2026-09-29-staff-push-design.md §1). It shares nothing with the app: all it keeps is
// tonight's sign-in, in this tab, or on this device once its notifications are on.

import { useCallback, useEffect, useRef, useState } from 'react';
import { connectStaff } from './line.js';
import { REFUSED, freshIds, openCount, ordered, timeOf, titleFor, whereLine, whoLine } from './list.js';
import { NOTICE_TAG, NOTIFY_WORDS, fromB64u, sameKey, startState } from './notify.js';

const SESSION = 'otb:staff';   // { venue, token }: in sessionStorage, or in localStorage once notifications are on
const storage = (name) => { try { return window[name] ?? null; } catch { return null; } };
/** Tonight's sign-in: the one kept on this device first, then this tab's. */
const readSession = () => {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const s = JSON.parse(storage(name)?.getItem(SESSION) ?? 'null');
      if (s) return s;
    } catch { /* nothing readable here */ }
  }
  return null;
};
/** Is the sign-in kept on this device, not only in this tab? */
const isKept = () => { try { return !!storage('localStorage')?.getItem(SESSION); } catch { return false; } };
/** Keeps `s` on the device when `kept`, else in this tab, and nowhere else. Null forgets it in both. */
const writeSession = (s, kept = false) => {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      if (s && (name === 'localStorage') === kept) storage(name)?.setItem(SESSION, JSON.stringify(s));
      else storage(name)?.removeItem(SESSION);
    } catch { /* no storage: signed in until this page closes */ }
  }
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

/** The staff worker's registration once it is active. It only shows notifications (public/staff-sw.js). */
function registerWorker() {
  return navigator.serviceWorker.register('/staff-sw.js', { scope: '/staff' }).then((reg) => (reg.active ? reg : new Promise((resolve) => {
    const w = reg.installing || reg.waiting;
    w?.addEventListener('statechange', () => { if (reg.active) resolve(reg); });
  })));
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
  const [notify, setNotify] = useState(() => startState({
    secure: window.isSecureContext, sw: 'serviceWorker' in navigator, push: 'PushManager' in window,
    standalone: navigator.standalone, permission: window.Notification?.permission,
  }));
  const [reg, setReg] = useState(null);        // the staff worker's registration, once active
  const [pushKey, setPushKey] = useState('');   // the relay's public key, from its sign-in answer
  const line = useRef(null);
  const sessionRef = useRef(session);
  const regRef = useRef(null);
  const seen = useRef(null);    // the ids of the last list, or null before the first
  const audio = useRef(null);

  useEffect(() => {
    fetch('/api/shows').then((r) => r.json()).then((list) => {
      const all = Array.isArray(list) ? list : [];
      setShows(all);
      setVenue((v) => v || all[0]?.id || '');
    }).catch(() => {});
  }, []);

  // On screen, the list is in front of them: this device's report notifications go.
  const clearNotices = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    regRef.current?.getNotifications({ tag: NOTICE_TAG }).then((all) => all.forEach((n) => n.close())).catch(() => {});
  }, []);

  const onMessage = useCallback((m) => {
    if (m.t === 'staff') {
      setPending(false);
      if (m.ok) {
        const s = { venue: m.venue, token: m.token };
        writeSession(s, isKept());
        sessionRef.current = s;
        setSession(s);
        setPushKey(typeof m.push === 'string' ? m.push : '');
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
    if (m.t === 'push') {
      // Taken: the sign-in is kept on the device until 06:00, so a tap on a notification finds it signed in.
      if (m.ok && sessionRef.current) writeSession(sessionRef.current, true);
      setNotify(m.ok ? 'on' : 'refused');
      return;
    }
    if (m.t === 'reports' && Array.isArray(m.reports)) {
      const fresh = freshIds(seen.current, m.reports);
      seen.current = new Set(m.reports.map((r) => r.id));
      setReports(m.reports);
      clearNotices();
      if (fresh.length) {
        setFlash((n) => n + 1);
        if (audio.current?.state === 'running') chime(audio.current);
      }
    }
  }, [clearNotices]);

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

  // The staff worker, on every load where the browser has one.
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return undefined;
    let gone = false;
    registerWorker().then((r) => { if (!gone) { regRef.current = r; setReg(r); } }).catch(() => {});
    return () => { gone = true; };
  }, []);

  useEffect(() => {
    document.addEventListener('visibilitychange', clearNotices);
    return () => document.removeEventListener('visibilitychange', clearNotices);
  }, [clearNotices]);

  /** Hands this device's subscription to the relay; its answer says whether they are on. */
  const offer = useCallback((sub) => {
    if (line.current?.send({ t: 'push', sub: sub.toJSON() })) setNotify((n) => (n === 'on' ? n : 'asking'));
  }, []);

  // Every sign-in turns notifications on by itself where they were on before: the browser's subscription, made
  // again if it was made under another key, goes to the relay with no tap.
  useEffect(() => {
    if (!session || !pushKey || !reg || window.Notification?.permission !== 'granted') return undefined;
    let gone = false;
    (async () => {
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub, pushKey)) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(pushKey) });
      if (!gone) offer(sub);
    })().catch(() => { if (!gone) setNotify('off'); });
    return () => { gone = true; };
  }, [session, pushKey, reg, offer]);

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
  const notifyThis = () => {
    if (!reg || !pushKey) return;
    setNotify('asking');
    // iOS takes a permission request only from a tap: subscribe() comes before anything is awaited.
    reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(pushKey) }).then(offer).catch(() => {
      const p = window.Notification?.permission;
      setNotify(p === 'denied' ? 'blocked' : p === 'granted' ? 'refused' : 'off');
    });
  };
  const signOut = async () => {
    line.current?.send({ t: 'signout' });
    // The browser's subscription goes too, so a sign-out the relay never hears still stops the pushes.
    const sub = await reg?.pushManager.getSubscription().catch(() => null);
    await Promise.race([sub?.unsubscribe().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
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
        {notify === 'off' ? (
          <button type="button" className="btn-s staff-notify" onClick={notifyThis} disabled={!reg || !pushKey}>{NOTIFY_WORDS.off}</button>
        ) : <p className="staff-note small">{NOTIFY_WORDS[notify]}</p>}
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

In `app/staff/staff.css`, after the `.staff-note { … }` line, add:

```css
.staff-notify { align-self: flex-start; }
```

In `app/staff/main.jsx`, change `// The venue team's page, at /staff. It registers no service worker: it is live or nothing.` to:

```js
// The venue team's page, at /staff. Its own service worker (public/staff-sw.js) only shows notifications: the page
// itself is live or nothing.
```

- [ ] **Step 6: Check that it builds, then run the full suite (P2).**

Run: `npm run build 2>&1 | tail -5`
Expected: the build ends with `✓ built in …`, and `dist/staff.html`, `dist/staff-sw.js` and `dist/staff.webmanifest` are there. P2: `fail 0`, with 524 tests.

- [ ] **Step 7: Check it in headless Chrome (P3, then P5 headless).**

Expected output from P5:
- `manifest: /staff.webmanifest`;
- `signed in: The Roundhouse, Camden · BRUNO MARS`;
- `worker scope: http://localhost:8790/staff`;
- `line before: NOTIFY THIS DEVICE`.

Record `line after tap` as it comes. Headless Chrome may have no push service, and then it must read `This browser's notifications can't be used here.` If it reads `Notifications on for this device.`, then `kept on the device: true | in the tab: false`. After SIGN OUT: `subscription: false | kept: false | page: Staff`.

Stop the P3 relay when done.

- [ ] **Step 8: Commit and push.**

```bash
git add app/staff/notify.js app/staff/list.js app/staff/Staff.jsx app/staff/staff.css app/staff/main.jsx tests/staff-notify.test.js tests/staff-page.test.js
git commit -m "The staff page turns notifications on in one tap, again by itself each sign-in, and signs out at the relay" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 9: Fly keeps the keys on the volume

**Files:**
- Modify: `fly.toml`
- Modify: `tests/deploy.test.js`

- [ ] **Step 1: Write the failing test.** Append to `tests/deploy.test.js`:

```js
test('fly.toml keeps the push keys on the volume too, so a deploy keeps every device\'s notifications on', () => {
  assert.match(fly, /^\s*PUSH_KEYS_FILE = "\/data\/push-keys\.json"$/m);
});
```

- [ ] **Step 2: Run it and see it fail.**

Run: `node --test tests/deploy.test.js`
Expected: FAIL. `The input did not match the regular expression`.

- [ ] **Step 3: Add the line.** In `fly.toml`, under `[env]`, add a line after `NIGHT_FILE = "/data/night.json"`, indented the same way:

```toml
  PUSH_KEYS_FILE = "/data/push-keys.json"
```

- [ ] **Step 4: Run it and see it pass.**

Run: `node --test tests/deploy.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full suite (P2), then commit and push.**

Expected: `fail 0`, with 525 tests.

```bash
git add fly.toml tests/deploy.test.js
git commit -m "Fly keeps the push keys on the night's volume" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 10: Proof — mutations, and a real push on this laptop

**Files:**
- Create: `<scratch>/push-mutations.json`, not in the repository.

- [ ] **Step 1: Write the mutations.** `<scratch>/push-mutations.json`:

```json
[
  { "label": "https only", "file": "relay/push.js", "from": "u.protocol !== 'https:' || ", "to": "", "test": "tests/push.test.js", "expect": ["only the push services' own addresses are taken"] },
  { "label": "no port", "file": "relay/push.js", "from": "u.port !== '' || ", "to": "", "test": "tests/push.test.js", "expect": ["only the push services' own addresses are taken"] },
  { "label": "no user", "file": "relay/push.js", "from": "u.username !== '' || u.password !== ''", "to": "false", "test": "tests/push.test.js", "expect": ["only the push services' own addresses are taken"] },
  { "label": "a whole label at a time", "file": "relay/push.js", "from": "u.hostname.endsWith(s))", "to": "u.hostname.endsWith(s.slice(1)))", "test": "tests/push.test.js", "expect": ["only the push services' own addresses are taken"] },
  { "label": "2,000 characters", "file": "relay/push.js", "from": "endpoint.length > ENDPOINT_MAX)", "to": "endpoint.length > ENDPOINT_MAX + 1)", "test": "tests/push.test.js", "expect": ["only the push services' own addresses are taken"] },
  { "label": "a point on the curve", "file": "relay/push.js", "from": "    probe.computeSecret(point);   // throws for a point that is not on the curve\n", "to": "", "test": "tests/push.test.js", "expect": ["a subscription needs a point on P-256"] },
  { "label": "a 16-byte auth", "file": "relay/push.js", "from": "Buffer.from(auth, 'base64url').length !== 16", "to": "Buffer.from(auth, 'base64url').length < 1", "test": "tests/push.test.js", "expect": ["a subscription needs a point on P-256"] },
  { "label": "the JWT is kept 11 hours", "file": "relay/push.js", "from": "    if (had && now() - had.at < JWT_REUSE_MS) return had.jwt;\n", "to": "", "test": "tests/push.test.js", "expect": ["the JWT: ES256"] },
  { "label": "checked again before sending", "file": "relay/push.js", "from": "    if (!allowed(sub.endpoint)) return 'refused';\n", "to": "", "test": "tests/push.test.js", "expect": ["an address turned away now is never called"] },
  { "label": "no redirects", "file": "relay/push.js", "from": "redirect: 'manual',", "to": "redirect: 'follow',", "test": "tests/push.test.js", "expect": ["an address turned away now is never called"] },
  { "label": "a timeout", "file": "relay/push.js", "from": "        signal: AbortSignal.timeout(timeoutMs),\n", "to": "", "test": "tests/push.test.js", "expect": ["an address turned away now is never called"] },
  { "label": "an endpoint held once", "file": "relay/server.js", "from": "    for (const other of tokens.values()) if (other.push?.endpoint === sub.endpoint) delete other.push;\n", "to": "", "test": "tests/staff-push.test.js", "expect": ["a sign-in holds one subscription, and an endpoint is held once"] },
  { "label": "50 a venue", "file": "relay/server.js", "from": "    while (held.length >= PUSH_SUBS_MAX) delete held.shift().push;\n", "to": "", "test": "tests/staff-push.test.js", "expect": ["a venue holds at most 50 subscriptions"] },
  { "label": "sign-out forgets the token", "file": "relay/server.js", "from": "    tokens.delete(hash);\n", "to": "", "test": "tests/staff-push.test.js", "expect": ["SIGN OUT reaches the relay"] },
  { "label": "one push a window", "file": "relay/server.js", "from": "    if (w) { w.again = true; return; }", "to": "    if (w) w.again = true;", "test": "tests/staff-push.test.js", "expect": ["a venue is sent at most one push a window", "a window that closes with nothing open sends nothing more"] },
  { "label": "nothing open, nothing sent", "file": "relay/server.js", "from": "if (w.again && openAt(key) > 0) pushAll(key);", "to": "if (w.again) pushAll(key);", "test": "tests/staff-push.test.js", "expect": ["a window that closes with nothing open sends nothing more"] },
  { "label": "gone devices forgotten", "file": "relay/server.js", "from": "          if (t.push === sub) delete t.push;   // unless the device has sent a new one since\n", "to": "", "test": "tests/staff-push.test.js", "expect": ["404, 410 and 403 forget that device"] },
  { "label": "a restored subscription is checked", "file": "relay/server.js", "from": "    return sub ? { key, night, push: { ...sub, at: Number(push.at) || 0 } } : { key, night };", "to": "    return { key, night, push };", "test": "tests/staff-push.test.js", "expect": ["a subscription in the night file that fails the checks is left behind"] }
]
```

The `"from"` strings must match the code once, byte for byte. `relay/server.js` and `relay/push.js` are LF (`.gitattributes`), so `\n` is right.

- [ ] **Step 2: Run P1.**

Run: `node <scratch>/mutate.mjs <scratch>/push-mutations.json`
Expected: `ALL MUTATIONS HELD`, 18 lines of `OK   mutation: …`.

A mutation that turns more tests red than it names gets a look. Where a test genuinely stands on that guard, add that test to its `expect` and say so in the commit message of Task 11.

- [ ] **Step 3: Tell him, then run the real push (P3, then P5 headful).** First say in chat, in Chinese, that a Chrome window with a throwaway profile, and one Windows notification, are about to appear on his screen for about a minute.

Expected output from P5:
- `line after tap: Notifications on for this device.`;
- `kept on the device: true | in the tab: false`;
- `endpoint host: fcm.googleapis.com`;
- the reporter runs;
- `notifications shown: ["New report · The Roundhouse, Camden / 1 open — tap to see it"]`;
- after SIGN OUT: `subscription: false | kept: false | page: Staff`.

The P3 relay's log shows `push: roundhouse-bruno-mars 1 sent, 0 gone, 0 failed`.

Stop the relay by port. If Chrome's push never arrives, write down exactly what each line printed and the relay's `push:` line, then decide from that. Never claim a push that `getNotifications()` did not show.

- [ ] **Step 4: Write down the result.** Record it in this plan under Task 10, as the last plan did at its Task 9: the mutations' summary line, and P5's lines.

**Result, 29 Sep 2026.**

- **P1:** `ALL MUTATIONS HELD`, 18 of 18, each with exactly its named tests red. Every file was restored byte for byte and ran green again.
- **P5 headless** (Task 8, step 7) gave:
  - `manifest: /staff.webmanifest`
  - `signed in: The Roundhouse, Camden · BRUNO MARS`
  - `worker scope: http://localhost:8790/staff`
  - `line before: NOTIFY THIS DEVICE`, then `line after tap: Notifications on for this device.`
  - `kept on the device: true | in the tab: false`
  - after SIGN OUT: `subscription: false | kept: false | page: Staff`

  Headless Chrome subscribed too.
- **P5 headful** gave `endpoint host: fcm.googleapis.com`, and the relay logged `push: roundhouse-bruno-mars 1 sent, 0 gone, 0 failed` for each report. `notifications shown` stayed `[]`, even with the staff page closed. After a reload, `back on the page, signed in without the passcode: The Roundhouse, Camden · BRUNO MARS`.
- **Why the list stayed empty.** `<scratch>/cdp-push-diag.mjs` found it. Its probe, `showNotification('probe')` from the page itself, showed and was recorded as displayed, yet `getNotifications()` returned `[]`. On this laptop's Chrome, which uses Windows' own notifications, `getNotifications()` sees nothing. It cannot prove a push there.
- **The proof is Chrome's own record** (CDP `BackgroundService`, recording `pushMessaging` and `notifications`):
  - `Push message received`, with `Was Encrypted: Yes`, `Payload: {"venue":"The Roundhouse, Camden","open":5}` and `Success: Yes`;
  - `Push event dispatched`;
  - `Notification displayed`, with `Title: New report · The Roundhouse, Camden` and `Body: 5 open — tap to see them`;
  - `Push event completed`, `Status: Success`.

  `chrome://gcm-internals` logged `Data msg received` from the relay's key, and its decryption failure log was empty. A push handed to the worker over CDP was displayed the same way. "5 open" is five unhandled reports from these runs on one local relay.
- **What this means for the page.** On Windows Chrome the page's "clear this device's notifications when on screen" (§1) cannot see them, so it clears nothing there; a notification stays in the Action Center. It is untried on Android.

---

### Task 11: README

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md` (not in git)

- [ ] **Step 1: The staff page.**

Change:

```
  staff page. A right passcode gives the tab a token until 06:00 at the
  venue, kept in that tab only, so a reconnect signs in again by itself; at
  06:00 the page is signed out and asks for the passcode again.
```

to:

```
  staff page. A right passcode gives the tab a token until 06:00 at the
  venue, kept in that tab only, or on the device once its notifications are
  on (below), so a reconnect signs in again by itself; at 06:00 the page is
  signed out and asks for the passcode again.
```

Change:

```
  notes once a tap on the page has let it make sound. Nothing reaches a
  device whose page is closed or asleep: keep it open on a screen that
  stays awake.
```

to:

```
  notes once a tap on the page has let it make sound.
- **Notifications, with the page closed or the phone asleep**
  (`docs/superpowers/specs/2026-09-29-staff-push-design.md`). *NOTIFY THIS
  DEVICE* under the header turns them on. A notification says *New report ·
  The Roundhouse, Camden* and *2 open — tap to see them*, never who, where
  or what was said, and a tap on it opens the list. On Android it works in
  Chrome as it is; on an iPhone (iOS 16.4 or later), add the page to the
  Home Screen first (Share, then Add to Home Screen) and turn them on from
  there. A device with notifications on keeps its sign-in until 06:00, so
  the tap finds it signed in, and each sign-in after that turns them on
  again by itself. SIGN OUT reaches the relay: that sign-in, and its
  notifications, end on every tab that shared it.
```

- [ ] **Step 2: How it is built.**

Change:

```
  - Reports go to the venue's own staff page, `/staff`, live (The staff
    page, below). The log says only that one came.
```

to:

```
  - Reports go to the venue's own staff page, `/staff`, live, and to its
    staff devices' notifications (The staff page, below). The log says only
    that one came.
  - `relay/push.js` is Web Push on `node:crypto` alone: the relay's own
    keys, kept in `PUSH_KEYS_FILE`; each payload sealed for one device
    (RFC 8291); and requests only to the push services' own hosts.
```

Change:

```
  - `staff.html` and `staff/`: the staff page, a second page of the same
    build, served at `/staff`. It shares nothing with the app.
```

to:

```
  - `staff.html` and `staff/`: the staff page, a second page of the same
    build, served at `/staff`. It shares nothing with the app.
    `public/staff-sw.js`, its own service worker, only shows its
    notifications and opens the page from one; `public/staff.webmanifest`
    lets an iPhone add it to the Home Screen.
```

- [ ] **Step 3: Always on.**

Change:

```
  the machine cannot start anywhere else — make a new volume the same way and
  deploy, and the night starts empty.
```

to:

```
  the machine cannot start anywhere else — make a new volume the same way and
  deploy, and the night starts empty; staff devices turn their notifications
  on again at their next sign-in.
```

Change:

```
- `fly.toml` sets `NIGHT_TZ=Australia/Brisbane` and
  `CLIENT_IP_HEADER=fly-client-ip` (see Abuse resistance).
```

to:

```
- `fly.toml` sets `NIGHT_TZ=Australia/Brisbane`,
  `CLIENT_IP_HEADER=fly-client-ip` (see Abuse resistance), and
  `PUSH_KEYS_FILE=/data/push-keys.json`: the keys staff devices'
  notifications are signed with, made at the first start and kept on the
  volume, so a deploy leaves every device's notifications on.
```

- [ ] **Step 4: Abuse resistance.**

After the *Reading the night's file* bullet, which ends `(`tests/restart.test.js`, `tests/deploy.test.js`).`, add:

```
- **Staff notifications.** The relay calls a push service only at an
  address on its own hosts: `fcm.googleapis.com`,
  `android.googleapis.com`, or a name under `push.apple.com`,
  `push.services.mozilla.com` or `notify.windows.com`. The address must be
  https on 443 with no user in it. It is checked when a device hands it
  over and again before every request, the relay never follows a redirect,
  and it gives up after 10 s, so a staff sign-in cannot aim it anywhere
  else. A subscription needs a real P-256 key and a 16-byte secret. A venue
  holds at most 50 and hears at most one push each 10 s. What is sent is
  sealed for the one device (RFC 8291) and says only the venue and how many
  are open. The log counts pushes; it never holds an address or a key
  (`tests/push.test.js`, `tests/staff-push.test.js`).
```

Change:

```
Each fix is a test in `tests/server.test.js`, `tests/wristband.test.js`,
`tests/rules.test.js`, `tests/relay-roots.test.js`, `tests/restart.test.js` or the wrist's table of
```

to:

```
Each fix is a test in `tests/server.test.js`, `tests/wristband.test.js`,
`tests/rules.test.js`, `tests/relay-roots.test.js`, `tests/restart.test.js`,
`tests/push.test.js`, `tests/staff-push.test.js` or the wrist's table of
```

- [ ] **Step 5: What is not done.** Change:

```
- **The staff page has not met a venue.** It has run on a laptop, in two
  tabs beside a phone in the same browser. Nothing reaches a staff device
  whose page is closed or asleep, and one passcode a venue is shared by its
  whole team; changing it is a secret set and a restart.
```

to the words Task 10's result allows. If P5 showed the notification:

```
- **The staff page has not met a venue.** It has run on a laptop, in two
  tabs beside a phone in the same browser, and a notification has reached
  Chrome on that laptop through Google's push service. No phone has had one
  yet, and no iPhone ever has. One passcode a venue is shared by its whole team;
  changing it is a secret set and a restart, and because a restart keeps
  tonight's sign-ins, the old passcode's devices stay signed in until 06:00.
```

If it did not, say what P5 did show instead of the notification clause.

- [ ] **Step 6: CLAUDE.md.** Change the test count line `496 tests, about 75 s (29 Sep 2026)` to the count and time the last P2 printed, with the same date.

- [ ] **Step 7: Run the full suite (P2), then commit and push.**

```bash
git add README.md docs/superpowers/plans/2026-09-29-staff-push.md
git commit -m "README: staff notifications, and what they have and have not been proven on" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 12: Deploy to Fly, check it live, and record

- [ ] **Step 1: Check that no demo has been announced.** This conversation and memory `fly-relay` say none. If he has said one is on, stop and ask.

- [ ] **Step 2: Deploy.** Run in the background, with the flyctl path from memory `fly-relay`:

```bash
cd /c/Users/LewisDong/Documents/on-the-beat && "$LOCALAPPDATA/Microsoft/WinGet/Packages/Fly-io.flyctl_Microsoft.Winget.Source_8wekyb3d8bbwe/flyctl.exe" deploy --ha=false --remote-only 2>&1 | grep -E "transferring context|Machine .* (is now in a good state|reached)|Visit|rror" 
```

Expected: `is now in a good state` and `Visit your newly deployed app`. `flyctl machine list -a on-the-beat` shows exactly one machine.

- [ ] **Step 3: Check it live.**

```bash
curl -sI https://on-the-beat.fly.dev/staff.webmanifest | grep -i content-type
curl -sI https://on-the-beat.fly.dev/staff-sw.js | grep -i content-type
"$FLY" logs -a on-the-beat --no-tail | grep -E "push: keys|night: carried" | tail -3
"$FLY" ssh console -a on-the-beat -C "ls -l /data"
```

- `$FLY` is the flyctl path.
- The first two lines give `application/manifest+json` and `text/javascript`.
- The log shows `push: keys made at /data/push-keys.json`, beside the night's line.
- `/data` lists `push-keys.json` as `-rw-------` owned by `node`.

- [ ] **Step 4: Record.**
  - Memory `staff-reports`: the notifications, the spec and plan paths, the commits and the proof; still owed by him is his own phone, and `STAFF_CODES` before any of it can run on Fly.
  - Memory `work-queue`: item 3 done, item 4 next. Item 4's scope now includes a passcode change not ending sign-ins before 06:00, and the push keys file.
  - Memory `fly-relay`: the keys file on the volume, and the deploy.
  - `MEMORY.md`: update the three lines to match.
  - `<scratch>/progress.md`: replace it for item 4.
- [ ] **Step 5: Report to him in Chinese.** Say what landed and what was proven; the Chrome push on the laptop is proven, a phone is not. List what is owed by him: his Android phone and an iPhone, if there is one, and `npm run staff-code` with `STAFF_CODES` first.
