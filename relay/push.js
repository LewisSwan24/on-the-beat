// ON THE BEAT — Web Push from the relay to staff devices (docs/superpowers/specs/2026-09-29-staff-push-design.md).
//
// All on node:crypto: the relay's key pair (VAPID, RFC 8292) and where it is kept (§2), the check that a
// subscription names a real push service and real keys (§3), a payload sealed for one device (RFC 8291: aes128gcm,
// one record), and the request (§4). It knows nothing of rooms or tokens.

import { createCipheriv, createECDH, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto';
import { openNight } from './store.js';

const ENDPOINT_MAX = 2000;
const HOSTS = ['fcm.googleapis.com', 'android.googleapis.com'];
const SUFFIXES = ['.push.apple.com', '.push.services.mozilla.com', '.notify.windows.com'];
const B64U = /^[A-Za-z0-9_-]+={0,2}$/;
export const CONTACT = 'https://on-the-beat.fly.dev';   // the JWT's `sub`: who a push service can reach about us
export const SEND_TIMEOUT_MS = 10_000;
const JWT_LIFE_S = 12 * 3600;          // Apple takes a JWT of at most a day
const JWT_REUSE_MS = 11 * 3600_000;    // and wants no new one within the hour

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
