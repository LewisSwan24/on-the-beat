// ON THE BEAT — Web Push on node:crypto (relay/push.js; docs/superpowers/specs/2026-09-29-staff-push-design.md
// §2-§4): RFC 8291's own example, the host and key checks, the keys file, the JWT, and the request itself.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTACT, createPusher, encrypt, isPushService, loadKeys, makeKeys, subscriptionOf } from '../relay/push.js';
import { pushService, subscriber } from './push-helpers.js';

const u = (s) => Buffer.from(s.replace(/\s+/g, ''), 'base64url');
const dir = mkdtempSync(join(tmpdir(), 'otb-push-'));
after(() => rmSync(dir, { recursive: true, force: true }));
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
