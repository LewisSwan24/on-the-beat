// ON THE BEAT — the operator's check before doors (scripts/preflight.mjs): one read-only pass over a relay's public
// face. Each check has to be able to fail, so apart from the relay built from this repository, which must pass them
// all, these point it at a stand-in that gets exactly one thing wrong.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:tls';
import { X509Certificate, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { APP_POLICY, STAFF_POLICY, WS_PATH, createRelay } from '../relay/server.js';
import { checkCertificate, headersLack, pinnedRoots, preflight } from '../scripts/preflight.mjs';

const script = fileURLToPath(new URL('../scripts/preflight.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'otb-preflight-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const named = (result, name) => result.checks.find((c) => c.name === name);
const statuses = (result) => Object.fromEntries(result.checks.map((c) => [c.name, c.status]));

/** Runs `fn` with console.log quiet: the relay says which shows file it read. */
async function quiet(fn) {
  const was = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = was; }
}

/** A relay from this repository, on a free port, for the length of `fn`. */
async function withRelay(options, fn) {
  const relay = await quiet(() => createRelay({ port: 0, host: '127.0.0.1', ...options }));
  try { return await fn(relay, 'http://127.0.0.1:' + relay.port); } finally { await relay.close(); }
}

const showsFile = join(dir, 'shows.json');
writeFileSync(showsFile, JSON.stringify([{ id: 'rehearsal-room', act: 'REHEARSAL', venue: 'rehearsal-room', doors: '19:00' }]));

// A relay that gets one thing wrong: `routes` replace what a healthy one serves, `socket` is how its socket behaves
// ('good', 'error': refuses the join, 'silent': never answers, 'open': lets a page from any site in, 'broken': answers
// a page from another site with a 500 and not a 403).
const SAFE = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };
const page = (policy, more = {}) => ({
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8', ...SAFE, ...(policy ? { 'content-security-policy': policy } : {}), ...more },
  body: '<!doctype html><title>stand-in</title>',
});
const healthy = () => ({
  '/': page(APP_POLICY),
  '/staff': page(STAFF_POLICY),
  '/api/shows': { status: 200, headers: { 'content-type': 'application/json', ...SAFE }, body: JSON.stringify([{ id: 'somewhere-else' }]) },
});
const without = (headers, ...names) => Object.fromEntries(Object.entries(headers).filter(([k]) => !names.includes(k)));

async function standIn({ routes = {}, socket = 'good' } = {}) {
  const table = { ...healthy(), ...routes };
  const server = createServer((req, res) => {
    const r = table[req.url] ?? { status: 404, headers: {}, body: '' };
    res.writeHead(r.status, r.headers).end(r.body);
  });
  const sameSite = ({ origin, req }, done) => (!origin || origin === 'http://' + req.headers.host ? done(true) : done(false, socket === 'broken' ? 500 : 403, 'no'));
  const wss = new WebSocketServer({ server, path: WS_PATH, verifyClient: socket === 'open' ? undefined : sameSite });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (socket === 'silent') return;
      if (m.t === 'join') ws.send(JSON.stringify(socket === 'error' ? { t: 'error', why: 'too many venues' } : { t: 'view', view: { me: {} } }));
      if (m.t === 'leave') ws.send(JSON.stringify({ t: 'left' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((resolve) => { for (const c of wss.clients) c.terminate(); wss.close(() => server.close(resolve)); }),
  };
}

async function against(options, fn) {
  const s = await standIn(options);
  try { return await fn(s.url); } finally { await s.close(); }
}

// ---- the relay built from this repository ---------------------------------------------------------------------

test('a relay built from this repository passes every check, and says which ones it ran', async () => {
  await withRelay({ shows: showsFile }, async (relay, url) => {
    const result = await preflight(url);
    assert.deepEqual(statuses(result), {
      'app opens': 'ok', 'app headers': 'ok', 'app policy': 'ok', 'staff page': 'ok', shows: 'ok', socket: 'ok', 'origin guard': 'ok',
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.checks.map((c) => c.name), ['app opens', 'app headers', 'app policy', 'staff page', 'shows', 'socket', 'origin guard']);
    assert.ok(named(result, 'shows').detail.includes('rehearsal-room'), named(result, 'shows').detail);
  });
});

test('the shows check notes a list that is only the one that ships with the relay, and the run is still ready', async () => {
  await withRelay({}, async (relay, url) => {
    const result = await preflight(url);
    const shows = named(result, 'shows');
    assert.equal(shows.status, 'note');
    assert.ok(shows.detail.includes('ships with the relay') && shows.detail.includes('/data/shows.json'), shows.detail);
    assert.equal(result.ok, true, 'a note is not a failure');
  });
});

test('the socket check joins a throwaway venue and leaves it, so no room is left behind', async () => {
  await withRelay({ shows: showsFile }, async (relay, url) => {
    const result = await preflight(url);
    assert.equal(named(result, 'socket').status, 'ok');
    assert.equal(relay.roomCount(), 0, 'the throwaway venue is gone');
  });
});

test('a relay that is not there fails once, saying so, and nothing else is tried', async () => {
  const relay = await quiet(() => createRelay({ port: 0, host: '127.0.0.1' }));
  const url = 'http://127.0.0.1:' + relay.port;
  await relay.close();
  const result = await preflight(url, { timeoutMs: 1000 });
  assert.equal(result.ok, false);
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].name, 'app opens');
  assert.equal(result.checks[0].status, 'fail');
  assert.ok(result.checks[0].detail.includes('does not answer'), result.checks[0].detail);
});

// ---- the app and the staff page --------------------------------------------------------------------------------

test('an app the relay has not been built with fails "app opens", and says to build it', async () => {
  await against({ routes: { '/': { status: 503, headers: SAFE, body: 'build the app first: npm run build' } } }, async (url) => {
    const result = await preflight(url);
    assert.equal(named(result, 'app opens').status, 'fail');
    assert.ok(named(result, 'app opens').detail.includes('503') && named(result, 'app opens').detail.includes('npm run build'), named(result, 'app opens').detail);
    assert.equal(result.ok, false);
  });
});

test('a page that is not HTML is not the app', async () => {
  await against({ routes: { '/': { status: 200, headers: { ...SAFE, 'content-type': 'application/json' }, body: '{}' } } }, async (url) => {
    assert.equal(named(await preflight(url), 'app opens').status, 'fail');
  });
});

test('a missing safety header fails "app headers" and is named', async () => {
  for (const header of ['x-content-type-options', 'referrer-policy', 'x-frame-options']) {
    const root = page(APP_POLICY);
    root.headers = without(root.headers, header);
    await against({ routes: { '/': root } }, async (url) => {
      const result = await preflight(url);
      const check = named(result, 'app headers');
      assert.equal(check.status, 'fail', header);
      assert.ok(check.detail.includes(header), check.detail);
      assert.equal(result.ok, false);
    });
  }
});

test('the app under only the framing rule is a note, not a failure: the full policy waits on an iPhone', async () => {
  await against({ routes: { '/': page("frame-ancestors 'none'") } }, async (url) => {
    const result = await preflight(url);
    assert.equal(named(result, 'app policy').status, 'note');
    assert.ok(named(result, 'app policy').detail.includes('framing rule only'), named(result, 'app policy').detail);
    assert.equal(result.ok, true);
  });
});

test('an app with no policy at all fails "app policy"', async () => {
  await against({ routes: { '/': page(null) } }, async (url) => {
    const result = await preflight(url);
    const check = named(result, 'app policy');
    assert.equal(check.status, 'fail');
    assert.ok(check.detail.includes('no Content-Security-Policy'), check.detail);
    assert.equal(result.ok, false);
  });
});

test('an app under some other policy is a note that says so, since a deploy from another commit would look like this', async () => {
  await against({ routes: { '/': page("default-src 'none'") } }, async (url) => {
    const check = named(await preflight(url), 'app policy');
    assert.equal(check.status, 'note');
    assert.ok(check.detail.includes("not this repository's APP_POLICY"), check.detail);
  });
});

test('the staff page must be under the staff policy: the app page served in its place fails', async () => {
  await against({ routes: { '/staff': page(APP_POLICY) } }, async (url) => {
    const result = await preflight(url);
    assert.equal(named(result, 'staff page').status, 'fail');
    assert.equal(result.ok, false);
  });
  await against({ routes: { '/staff': page(null) } }, async (url) => {
    assert.ok(named(await preflight(url), 'staff page').detail.includes('no Content-Security-Policy'));
  });
  await against({ routes: { '/staff': { status: 404, headers: {}, body: '' } } }, async (url) => {
    assert.ok(named(await preflight(url), 'staff page').detail.includes('404'));
  });
});

test('a staff page that can be framed fails', async () => {
  const staff = page(STAFF_POLICY);
  staff.headers = without(staff.headers, 'x-frame-options');
  await against({ routes: { '/staff': staff } }, async (url) => {
    const check = named(await preflight(url), 'staff page');
    assert.equal(check.status, 'fail');
    assert.ok(check.detail.includes('framed'), check.detail);
  });
});

// ---- the shows -------------------------------------------------------------------------------------------------

test('a relay with no shows, or a list that is not one, or a show with no id, fails "shows"', async () => {
  const served = (body) => ({ '/api/shows': { status: 200, headers: { 'content-type': 'application/json', ...SAFE }, body } });
  const cases = [
    ['[]', 'lists no show'],
    ['not json', 'not JSON'],
    ['{"id": "x"}', 'lists no show'],
    ['[{"id": "fine"}, {"act": "no id"}]', 'show 2 has no id'],
    ['[{"id": ""}]', 'show 1 has no id'],
  ];
  for (const [body, said] of cases) {
    await against({ routes: served(body) }, async (url) => {
      const check = named(await preflight(url), 'shows');
      assert.equal(check.status, 'fail', body);
      assert.ok(check.detail.includes(said), body + ' -> ' + check.detail);
    });
  }
  await against({ routes: { '/api/shows': { status: 500, headers: SAFE, body: '' } } }, async (url) => {
    assert.ok(named(await preflight(url), 'shows').detail.includes('500'));
  });
});

// ---- the socket ------------------------------------------------------------------------------------------------

test('a relay that refuses the join fails "socket" in the relay\'s own words', async () => {
  await against({ socket: 'error' }, async (url) => {
    const check = named(await preflight(url), 'socket');
    assert.equal(check.status, 'fail');
    assert.ok(check.detail.includes('too many venues'), check.detail);
  });
});

test('a relay that never answers the join fails "socket" after its timeout', async () => {
  await against({ socket: 'silent' }, async (url) => {
    const check = named(await preflight(url, { timeoutMs: 400 }), 'socket');
    assert.equal(check.status, 'fail');
    assert.ok(check.detail.includes('no view'), check.detail);
  });
});

test('a socket that lets a page from another site in fails "origin guard"', async () => {
  await against({ socket: 'open' }, async (url) => {
    const result = await preflight(url);
    assert.equal(named(result, 'origin guard').status, 'fail');
    assert.ok(named(result, 'origin guard').detail.includes('can open the socket'), named(result, 'origin guard').detail);
    assert.equal(result.ok, false);
  });
});

test('a socket that turns a page from another site away with anything but a 403 fails "origin guard" too', async () => {
  await against({ socket: 'broken' }, async (url) => {
    const check = named(await preflight(url), 'origin guard');
    assert.equal(check.status, 'fail');
    assert.ok(check.detail.includes('500') && check.detail.includes('not 403'), check.detail);
  });
});

// ---- the safety headers, and HSTS where the relay is https ----------------------------------------------------

test('every safety header is asked for, and HSTS only of a relay that is https', () => {
  const safe = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };
  assert.deepEqual(headersLack(safe, false), []);
  assert.deepEqual(headersLack({}, false), ['x-content-type-options: nosniff', 'referrer-policy: no-referrer', 'x-frame-options: DENY']);
  assert.deepEqual(headersLack({ ...safe, 'x-frame-options': 'SAMEORIGIN' }, false), ['x-frame-options: DENY']);
  assert.deepEqual(headersLack(safe, true), ['strict-transport-security: max-age=31536000']);
  assert.deepEqual(headersLack({ ...safe, 'strict-transport-security': 'max-age=31536000' }, true), []);
  assert.deepEqual(headersLack({ ...safe, 'strict-transport-security': 'max-age=31536000; includeSubDomains' }, true), []);
  assert.deepEqual(headersLack({ ...safe, 'strict-transport-security': 'max-age=60' }, true), ['strict-transport-security: max-age=31536000'], 'a minute of HSTS is not HSTS');
  assert.deepEqual(headersLack({ ...safe, 'strict-transport-security': 'includeSubDomains' }, true), ['strict-transport-security: max-age=31536000']);
});

// ---- the certificate -------------------------------------------------------------------------------------------

// A self-signed certificate, made here with nothing but node:crypto (ASN.1 by hand), so the test needs neither openssl
// nor a key kept in the repository. It is its own root: handed to the check as the roots the bands trust it is one the
// bands trust, and against the real roots in relay_roots.h it is a stranger.
const der = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  const n = body.length;
  const length = n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
};
const oid = (hex) => der(0x06, Buffer.from(hex, 'hex'));
const ECDSA_SHA256 = der(0x30, oid('2a8648ce3d040302'));
const nameOf = (cn) => der(0x30, der(0x31, der(0x30, oid('550403'), der(0x0c, Buffer.from(cn)))));
const utc = (d) => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const extension = (id, critical, value) => der(0x30, oid(id), ...(critical ? [der(0x01, Buffer.from([0xff]))] : []), der(0x04, value));
const DAY = 86_400_000;

function selfSigned({ cn = 'otb-test-root', from = -1, to = 90 } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exts = der(0xa3, der(0x30,
    extension('551d13', true, der(0x30, der(0x01, Buffer.from([0xff])))),                                        // CA: yes
    extension('551d0f', true, der(0x03, Buffer.from([2, 0x84]))),                                                // digital signature, certificate signing
    extension('551d11', false, der(0x30, der(0x87, Buffer.from([127, 0, 0, 1])))),                               // for 127.0.0.1
  ));
  const tbs = der(0x30,
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.concat([Buffer.from([1]), randomBytes(7)])),
    ECDSA_SHA256, nameOf(cn),
    der(0x30, utc(new Date(Date.now() + from * DAY)), utc(new Date(Date.now() + to * DAY))),
    nameOf(cn), publicKey.export({ type: 'spki', format: 'der' }), exts);
  const signature = sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' });
  const cert = der(0x30, tbs, ECDSA_SHA256, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const b64 = cert.toString('base64').match(/.{1,64}/g).join('\n');
  return {
    cert: '-----BEGIN CERTIFICATE-----\n' + b64 + '\n-----END CERTIFICATE-----\n',
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

async function withTls(pair, fn) {
  const server = createTlsServer({ key: pair.key, cert: pair.cert }, (socket) => { socket.on('error', () => {}); socket.end(); });
  server.on('tlsClientError', () => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { return await fn('https://127.0.0.1:' + server.address().port); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('the generated certificate is a real one: OpenSSL parses it, as its own root', () => {
  const x = new X509Certificate(selfSigned().cert);
  assert.ok(x.ca && x.checkIssued(x));
});

test('a certificate the bands trust is ok, with the days it has left', async () => {
  const pair = selfSigned({ to: 60 });
  await withTls(pair, async (url) => {
    const check = await checkCertificate(url, { roots: [pair.cert] });
    assert.equal(check.name, 'certificate');
    assert.equal(check.status, 'ok', check.detail);
    assert.ok(/\((59|60) days\)/.test(check.detail), check.detail);
    assert.ok(check.detail.includes('bands trust'), check.detail);
  });
});

test('a certificate with under two weeks left is a note: the relay renews it by itself, so ask why it has not', async () => {
  const pair = selfSigned({ to: 5 });
  await withTls(pair, async (url) => {
    const check = await checkCertificate(url, { roots: [pair.cert] });
    assert.equal(check.status, 'note', check.detail);
    assert.ok(check.detail.includes('renewed'), check.detail);
  });
});

test('an expired certificate fails', async () => {
  const pair = selfSigned({ from: -10, to: -2 });
  await withTls(pair, async (url) => {
    const check = await checkCertificate(url, { roots: [pair.cert] });
    assert.equal(check.status, 'fail');
    assert.ok(check.detail.includes('has expired'), check.detail);
  });
});

test('a certificate that chains to none of the roots in the bands is a failure that names who signed it and what to do', async () => {
  const pair = selfSigned({ cn: 'some-other-authority' });
  await withTls(pair, async (url) => {
    const check = await checkCertificate(url, { roots: pinnedRoots() });
    assert.equal(check.status, 'fail');
    assert.ok(check.detail.includes('bands would refuse'), check.detail);
    assert.ok(check.detail.includes('some-other-authority'), check.detail);
    assert.ok(check.detail.includes('relay_roots.h'), check.detail);
  });
});

test('no roots to check against is a failure too, not a pass', async () => {
  const pair = selfSigned();
  await withTls(pair, async (url) => {
    const check = await checkCertificate(url, { roots: [] });
    assert.equal(check.status, 'fail');
    assert.ok(check.detail.includes('no roots were found') && check.detail.includes('relay_roots.h'), check.detail);
  });
});

test('a relay over plain http has no certificate to check, and the run does not list one', async () => {
  assert.equal(await checkCertificate('http://127.0.0.1:1'), null);
  await against({}, async (url) => {
    assert.equal(named(await preflight(url), 'certificate'), undefined);
  });
});

test('the roots are read out of relay_roots.h whole: all four, the last one too', () => {
  const names = pinnedRoots().map((pem) => /CN=([^\n]+)/.exec(new X509Certificate(pem).subject)[1]);
  assert.deepEqual(names, ['ISRG Root X1', 'ISRG Root X2', 'GTS Root R1', 'GTS Root R4']);
});

// ---- the command -----------------------------------------------------------------------------------------------

function cli(...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

test('the command prints each check and exits 0 for a relay that is ready, and lists what only a person can see', async () => {
  await withRelay({ shows: showsFile }, async (relay, url) => {
    const { code, out, err } = await cli(url);
    assert.equal(code, 0, out + err);
    for (const name of ['app opens', 'app headers', 'app policy', 'staff page', 'shows', 'socket', 'origin guard']) assert.ok(out.includes(name), name);
    assert.ok(out.includes('READY'), out);
    assert.ok(out.includes('flyctl machine list'), 'what no script can see is said: ' + out);
  });
});

test('the command exits 1 when a check fails, and says NOT READY', async () => {
  await against({ socket: 'open' }, async (url) => {
    const { code, out } = await cli(url);
    assert.equal(code, 1, out);
    assert.ok(out.includes('NOT READY'), out);
    assert.ok(out.includes('origin guard'), out);
  });
});

test('--json prints the result alone, for a script to read', async () => {
  await withRelay({ shows: showsFile }, async (relay, url) => {
    const { code, out } = await cli(url, '--json');
    assert.equal(code, 0);
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.base, url);
    assert.equal(parsed.checks.length, 7);
  });
});

test('an address that is not an http or https one is a usage error, exit 2, and nothing is tried', async () => {
  for (const bad of ['on-the-beat.fly.dev', 'ftp://example.com', '']) {
    const { code, err } = await cli(bad);
    assert.equal(code, 2, bad);
    assert.ok(err.includes('usage'), err);
  }
});
