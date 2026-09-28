// ON THE BEAT — the wristband checks the relay's certificate. Its https
// connection trusts only the roots the relay's addresses chain to: Let's
// Encrypt's for Fly (ISRG Root X1 and X2) and Google Trust Services' for a
// Cloudflare tunnel (GTS Root R1 and R4), each for its RSA and its ECDSA chain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

/** The certificates in relay_roots.h, from its C string literals. */
function roots() {
  const text = read('firmware/src/relay_roots.h');
  // RELAY_ROOTS's own initializer: from its name to the semicolon that ends it (none is in base64).
  const start = text.indexOf('RELAY_ROOTS[] =');
  const body = text.slice(start, text.indexOf(';', start));
  const joined = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\n/g, '\n')).join('');
  return joined.match(/-----BEGIN CERTIFICATE-----\n[\s\S]+?-----END CERTIFICATE-----\n/g) || [];
}

test('the band trusts exactly four roots, each one a self-signed root that outlasts 2035', () => {
  const certs = roots().map((p) => new X509Certificate(p));
  assert.deepEqual(certs.map((c) => /CN=([^\n]+)/.exec(c.subject)[1]), ['ISRG Root X1', 'ISRG Root X2', 'GTS Root R1', 'GTS Root R4']);
  // As in the Mozilla root store: a root pasted in wrong, or someone else's, fails here.
  assert.deepEqual(certs.map((c) => c.fingerprint256), [
    '96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6',
    '69:72:9B:8E:15:A8:6E:FC:17:7A:57:AF:B7:17:1D:FC:64:AD:D2:8C:2F:CA:8C:F1:50:7E:34:45:3C:CB:14:70',
    'D9:47:43:2A:BD:E7:B7:FA:90:FC:2E:6B:59:10:1B:12:80:E0:E1:C7:E4:E4:0F:A3:C6:88:7F:FF:57:A7:F4:CF',
    '34:9D:FA:40:58:C5:E2:63:12:3B:39:8A:E7:95:57:3C:4E:13:13:C8:3F:E6:8F:93:55:6C:D5:E8:03:1B:3C:7D',
  ]);
  for (const c of certs) {
    assert.ok(c.ca && c.checkIssued(c), c.subject + ' is a self-signed root');
    assert.ok(new Date(c.validTo) >= new Date('2035-06-01'), c.subject + ' until ' + c.validTo);
  }
});

test('the band never opens https to a relay without checking its certificate: the roots unless secrets.h names others', () => {
  const cpp = read('firmware/src/main.cpp');
  assert.match(cpp, /#include "relay_roots\.h"/);
  assert.match(cpp, /#ifndef OTB_RELAY_CA\s*\n#define OTB_RELAY_CA RELAY_ROOTS\s*\n#endif/);
  assert.match(cpp, /socket_\.beginSslWithCA\(mine\.host\.c_str\(\), mine\.port, WS_PATH, OTB_RELAY_CA\)/);
  assert.doesNotMatch(cpp, /beginSSL\(/, 'no https without a check');
});

test('a checked handshake does not trip the watchdog: it allows more than three times the slowest band\'s 6.3 s', () => {
  const cpp = read('firmware/src/main.cpp');
  const set = /esp_task_wdt_init\((\d+), true\);/.exec(cpp);
  assert.ok(set, 'the task watchdog is set, and still restarts a band that hangs');
  assert.ok(Number(set[1]) >= 19, 'allows ' + set[1] + ' s');
  assert.ok(set.index < cpp.indexOf('xTaskCreatePinnedToCore(socketTask'), 'before the socket task can start a handshake');
});
