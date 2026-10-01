// ON THE BEAT — is a relay ready for doors?
//
//   npm run preflight                            # https://on-the-beat.fly.dev
//   npm run preflight -- http://localhost:8790   # any other relay, with its scheme
//   npm run preflight -- --json                  # the same result, for a script to read
//
// One read-only pass over a relay's public face: the part of docs/show-night.md's "Before doors" that a computer can
// see. The app and the staff page open under their policies, the shows are the ones meant, a person can join and
// leave, a page from another site is turned away, and the certificate is one the wristbands trust. It sends what a
// phone's browser sends: three page requests, one join and leave under a throwaway venue that is gone as it leaves,
// and one socket from a foreign Origin that must be refused. It never touches a pairing code, a staff sign-in or a
// wristband. Exit 0 when nothing failed (notes are not failures), 1 when something did, 2 for an address it cannot use.

import http from 'node:http';
import https from 'node:https';
import { connect as tlsConnect } from 'node:tls';
import { isIP } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { APP_POLICY, FRAMING_ONLY, STAFF_POLICY, WS_PATH, loadShows } from '../relay/server.js';

export const DEFAULT_RELAY = 'https://on-the-beat.fly.dev';

/** A certificate with fewer days than this left is a note: the host renews long before, so it is worth asking why not. */
const CERT_NOTE_DAYS = 14;
/** Nothing here is bigger than a few KB; a page that goes on past this is not the relay's. */
const MAX_BODY = 1_000_000;

/** The certificates the wristbands trust for an https relay: the PEMs in relay_roots.h's C string literals. */
export function pinnedRoots(text = readFileSync(new URL('../firmware/src/relay_roots.h', import.meta.url), 'utf8')) {
  // RELAY_ROOTS's own initializer: from its name to the semicolon that ends it (none is in base64).
  const start = text.indexOf('RELAY_ROOTS[] =');
  const body = text.slice(start, text.indexOf(';', start));
  const joined = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\n/g, '\n')).join('');
  return joined.match(/-----BEGIN CERTIFICATE-----\n[\s\S]+?-----END CERTIFICATE-----\n/g) ?? [];
}

const shippedShowIds = () => loadShows(fileURLToPath(new URL('../relay/shows.json', import.meta.url))).map((s) => s.id);

/** A failure in words: the code the system gave, then what it said, or that nothing was said in time. */
function why(e) {
  if (e?.code === 'ETIMEDOUT' || e?.name === 'TimeoutError') return 'no answer in time';
  const c = e?.cause ?? e;
  return [c?.code, c?.message].filter(Boolean).join(': ') || String(e);
}

/** One GET, with its headers and body, within `timeoutMs`. A connection is not kept, so the command can end at once. */
function get(origin, path, timeoutMs) {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = (url.protocol === 'https:' ? https : http).request(url, { agent: false, timeout: timeoutMs, headers: { accept: '*/*', connection: 'close' } }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) req.destroy(new Error('the page goes on past 1 MB'));
        else chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), ms: Date.now() - t0 }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('no answer in time'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

/** The socket's address: the page's own host and the relay's path, over ws or wss as the page was. */
const socketUrl = (origin) => origin.replace(/^http/, 'ws') + WS_PATH;

/** Opens a socket the way the app's page does, joins a throwaway venue, takes its view and leaves. */
function joinAndLeave(origin, timeoutMs) {
  return new Promise((resolve, reject) => {
    const venue = 'preflight-' + randomBytes(4).toString('hex');
    const me = randomBytes(16).toString('hex');
    const ws = new WebSocket(socketUrl(origin), { origin, handshakeTimeout: timeoutMs });
    const t0 = Date.now();
    let viewAfter = null;
    const done = (settle, value) => { clearTimeout(timer); ws.terminate(); settle(value); };
    const timer = setTimeout(() => done(reject, new Error(viewAfter === null ? 'no view came back after the join' : 'it did not say it had left')), timeoutMs);
    ws.on('error', (e) => done(reject, e));
    ws.on('unexpected-response', (req, res) => done(reject, new Error('the socket handshake was answered ' + res.statusCode)));
    ws.on('close', (code) => done(reject, new Error('the relay closed the socket (' + code + ')')));
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', venue, me })));
    ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (m.t === 'error') done(reject, new Error('the relay refused the join: ' + m.why));
      else if (m.t === 'view' && viewAfter === null) {
        viewAfter = Date.now() - t0;
        ws.send(JSON.stringify({ t: 'leave' }));
      } else if (m.t === 'left') done(resolve, ['ok', 'joined a throwaway venue, was sent its view in ' + viewAfter + ' ms, and left']);
    });
  });
}

/** A socket from another site's page: the relay must turn it away before a socket exists. */
function foreignOrigin(origin, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl(origin), { origin: 'https://not-this-site.example', handshakeTimeout: timeoutMs });
    const done = (settle, value) => { clearTimeout(timer); ws.terminate(); settle(value); };
    const timer = setTimeout(() => done(reject, new Error('no answer in time')), timeoutMs);
    ws.on('unexpected-response', (req, res) => done(resolve, res.statusCode === 403
      ? ['ok', 'a page from another site is turned away with 403']
      : ['fail', 'a page from another site got ' + res.statusCode + ', not 403']));
    ws.on('open', () => done(resolve, ['fail', 'a page from another site can open the socket']));
    ws.on('error', (e) => done(reject, e));
  });
}

/**
 * A TLS handshake with `ca` as the only roots. With none given it checks nothing and sends nothing: it is only for
 * reading what a relay offers after the checked handshake has already failed, to name who signed it in the report.
 */
function handshake({ host, port, ca, timeoutMs }) {
  return new Promise((resolve) => {
    const socket = tlsConnect({ host, port, ...(ca ? { ca } : { rejectUnauthorized: false }), ...(isIP(host) ? {} : { servername: host }) });
    const finish = (result) => { clearTimeout(timer); socket.destroy(); resolve(result); };
    const timer = setTimeout(() => finish({ error: { code: 'ETIMEDOUT', message: 'no handshake in time' } }), timeoutMs);
    socket.once('secureConnect', () => finish({ cert: socket.getPeerCertificate(true), authorized: socket.authorized }));
    socket.once('error', (error) => finish({ error }));
  });
}

/** The last certificate of a chain as Node reports it: the one nothing above it vouches for. */
function topOf(cert) {
  let c = cert;
  for (let i = 0; i < 10 && c.issuerCertificate && c.issuerCertificate !== c; i += 1) c = c.issuerCertificate;
  return c;
}

/**
 * Whether the wristbands would accept the relay's certificate. Node is given the roots in relay_roots.h as the only
 * ones it may trust, which is what the band's own handshake does, so a relay that moved to another authority, or whose
 * chain no longer reaches them, fails here before doors and not as every band saying NO SIGNAL at them. null for a relay
 * over plain http, which has no certificate to speak of.
 */
export async function checkCertificate(origin, { roots, timeoutMs = 8000 } = {}) {
  const url = new URL(origin);
  if (url.protocol !== 'https:') return null;
  const t0 = Date.now();
  const done = (status, detail) => ({ name: 'certificate', status, detail, ms: Date.now() - t0 });
  const trust = roots ?? pinnedRoots();
  if (!trust.length) return done('fail', 'no roots were found in firmware/src/relay_roots.h, so what the bands trust is unknown');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port) || 443;
  const ours = await handshake({ host, port, ca: trust, timeoutMs });
  if (ours.cert) {
    const to = new Date(ours.cert.valid_to);
    const days = Math.floor((to - Date.now()) / 86_400_000);
    const said = 'valid to ' + to.toISOString().slice(0, 10) + ' (' + days + ' days), and it chains to a root the bands trust';
    return days < CERT_NOTE_DAYS ? done('note', said + ': under ' + CERT_NOTE_DAYS + ' days, so ask why it has not been renewed') : done('ok', said);
  }
  const code = ours.error?.code;
  if (code === 'CERT_HAS_EXPIRED') return done('fail', 'its certificate has expired, and the host has not renewed it');
  // Refused by the bands' roots. Who signed it, and would a browser take it? That is what a reflash has to start from.
  const seen = await handshake({ host, port, timeoutMs });
  if (!seen.cert) return done('fail', 'the TLS handshake failed: ' + why(ours.error));
  const top = topOf(seen.cert);
  const signer = top.issuer?.CN ?? top.issuer?.O ?? 'an unnamed authority';
  return done('fail', 'the bands would refuse this certificate (' + (code ?? why(ours.error)) + '): its chain ends at ' + signer
    + ', which is not a root in firmware/src/relay_roots.h; ' + (seen.authorized ? 'a browser takes it' : 'a browser refuses it too')
    + '. If the authority changed, add its root there and flash the bands again.');
}

/** Runs one check, timed; an exception is a failure with its reason, never a crash. */
async function run(name, fn) {
  const t0 = Date.now();
  try {
    const [status, detail] = await fn();
    return { name, status, detail, ms: Date.now() - t0 };
  } catch (e) {
    return { name, status: 'fail', detail: why(e), ms: Date.now() - t0 };
  }
}

/**
 * The safety headers the relay puts on every page (relay/server.js) that a response lacks, by name. HSTS is the
 * relay's to send only when the request came in over https, as Fly's proxy says, so it is asked of an https relay alone.
 */
export function headersLack(headers, secure) {
  const lacks = [];
  if (headers['x-content-type-options'] !== 'nosniff') lacks.push('x-content-type-options: nosniff');
  if (headers['referrer-policy'] !== 'no-referrer') lacks.push('referrer-policy: no-referrer');
  if (headers['x-frame-options'] !== 'DENY') lacks.push('x-frame-options: DENY');
  const maxAge = Number(/max-age=(\d+)/.exec(headers['strict-transport-security'] ?? '')?.[1]);
  if (secure && !(maxAge >= 31_536_000)) lacks.push('strict-transport-security: max-age=31536000');
  return lacks;
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const finish = (base, checks) => ({ base, ok: !checks.some((c) => c.status === 'fail'), checks });

/** Every check against the relay at `base`, in the order an operator would try them. */
export async function preflight(base = DEFAULT_RELAY, { timeoutMs = 8000, roots } = {}) {
  const origin = new URL(base).origin;
  const secure = new URL(origin).protocol === 'https:';
  let app = null;
  const opens = await run('app opens', async () => {
    app = await get(origin, '/', timeoutMs);
    if (app.status !== 200) return ['fail', 'GET / answered ' + app.status + (app.status === 503 ? ': the relay has no built app (npm run build)' : '')];
    const type = app.headers['content-type'] ?? '';
    if (!/^text\/html/i.test(type)) return ['fail', 'GET / is ' + (type || 'untyped') + ', not the app\'s page'];
    return ['ok', '200 ' + type.split(';')[0] + ', ' + kb(app.body.length) + ' in ' + app.ms + ' ms'];
  });
  // Nothing answered: the rest would only say the same thing nine ways.
  if (!app) return finish(origin, [{ ...opens, detail: origin + ' does not answer: ' + opens.detail }]);

  const checks = [opens];
  checks.push(await run('app headers', async () => {
    const lacks = headersLack(app.headers, secure);
    return lacks.length ? ['fail', 'missing ' + lacks.join(', ')] : ['ok', 'nosniff, no-referrer, DENY' + (secure ? ', HSTS' : '')];
  }));
  checks.push(await run('app policy', async () => {
    const csp = app.headers['content-security-policy'];
    if (csp === APP_POLICY) return ['ok', 'the full app policy is live'];
    if (csp === FRAMING_ONLY) return ['note', 'the framing rule only: held there on purpose (fly.toml, APP_CSP=framing-only) until an iPhone Safari try has passed (README, "What is not done")'];
    if (!csp) return ['fail', 'no Content-Security-Policy on the app'];
    return ['note', 'a policy that is not this repository\'s APP_POLICY (a deploy from another commit?): ' + csp.slice(0, 60) + '...'];
  }));
  checks.push(await run('staff page', async () => {
    const r = await get(origin, '/staff', timeoutMs);
    if (r.status !== 200) return ['fail', 'GET /staff answered ' + r.status];
    const csp = r.headers['content-security-policy'];
    if (!csp) return ['fail', '/staff has no Content-Security-Policy'];
    if (csp !== STAFF_POLICY) return ['fail', '/staff is under a policy that is not the staff page\'s: ' + csp.slice(0, 60) + '...'];
    if (r.headers['x-frame-options'] !== 'DENY') return ['fail', '/staff can be framed'];
    return ['ok', '200, under the staff policy, in ' + r.ms + ' ms'];
  }));
  checks.push(await run('shows', async () => {
    const r = await get(origin, '/api/shows', timeoutMs);
    if (r.status !== 200) return ['fail', 'GET /api/shows answered ' + r.status];
    let list;
    try { list = JSON.parse(r.body.toString('utf8')); } catch { return ['fail', '/api/shows is not JSON']; }
    if (!Array.isArray(list) || !list.length) return ['fail', '/api/shows lists no show, so nobody can pick a venue'];
    const bad = list.findIndex((s) => typeof s?.id !== 'string' || !s.id);
    if (bad >= 0) return ['fail', 'show ' + (bad + 1) + ' has no id'];
    const ids = list.map((s) => s.id);
    const said = ids.length + ' listed: ' + ids.slice(0, 5).join(', ') + (ids.length > 5 ? ', ...' : '');
    const same = JSON.stringify([...ids].sort()) === JSON.stringify(shippedShowIds().sort());
    return same
      ? ['note', said + ' - the same as the list that ships with the relay, so no /data/shows.json of its own is in effect (docs/show-night.md, "Changing tonight\'s shows")']
      : ['ok', said];
  }));
  checks.push(await run('socket', () => joinAndLeave(origin, timeoutMs)));
  checks.push(await run('origin guard', () => foreignOrigin(origin, timeoutMs)));
  const cert = await checkCertificate(origin, { roots, timeoutMs });
  if (cert) checks.push(cert);
  return finish(origin, checks);
}

/** The result as lines a person reads. */
export function report({ base, ok, checks }) {
  const width = Math.max(...checks.map((c) => c.name.length));
  const lines = ['Preflight for ' + base, ''];
  for (const c of checks) lines.push('  ' + c.status.padEnd(4) + '  ' + c.name.padEnd(width) + '  ' + c.detail);
  const fails = checks.filter((c) => c.status === 'fail').length;
  const notes = checks.filter((c) => c.status === 'note').length;
  lines.push('', ok
    ? 'READY' + (notes ? ' (' + notes + ' note' + (notes === 1 ? '' : 's') + ' above)' : '')
    : 'NOT READY: ' + fails + ' check' + (fails === 1 ? '' : 's') + ' failed');
  return lines.join('\n');
}

const STILL_YOURS = `
Still yours, since nothing here can see them (docs/show-night.md, "Before doors"):
  - flyctl machine list -a on-the-beat shows exactly one machine, started.
  - A band on USB says (on it) at its console "show", on the venue's Wi-Fi.
  - The venue's passcode line is in STAFF_CODES, and each team phone has signed in at /staff and tapped NOTIFY THIS DEVICE.`;

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const target = args.find((a) => !a.startsWith('--')) ?? DEFAULT_RELAY;
  let url = null;
  try { url = new URL(target); } catch { /* said below */ }
  if (!url || !/^https?:$/.test(url.protocol)) {
    console.error('usage: npm run preflight [-- <relay address with its scheme, e.g. ' + DEFAULT_RELAY + ' or http://localhost:8790>] [--json]');
    process.exit(2);
  }
  const result = await preflight(url.href);
  console.log(json ? JSON.stringify(result, null, 2) : report(result) + '\n' + STILL_YOURS);
  process.exitCode = result.ok ? 0 : 1;
}
