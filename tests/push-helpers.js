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
