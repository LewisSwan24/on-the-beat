// ON THE BEAT — the venue-walk tool turns a band's listens into numbers
// (scripts/venue-walk.py). Here it runs against generated snapshots (--fake),
// with no band and no serial port, and the walk it writes is the thing under
// test: a CSV row per reading, a JSONL sample per listen, and an HTML page
// whose curves carry the two lines the relay names an area by. The fake
// prints the console's own text — every reading passes through the same
// parser a real band's bytes do — and, like a real band, repeats its last
// listen between two listens, so the walk's dedupe has duplicates to drop.
// The tool needs PlatformIO's python (the one with pyserial); a machine
// without it skips, as CI's test runner has none.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/venue-walk.py', import.meta.url));
const python = process.platform === 'win32'
  ? join(process.env.USERPROFILE || '', '.platformio', 'penv', 'Scripts', 'python.exe')
  : '/usr/bin/python3';

test('a venue walk records every listen and draws it against the naming lines', { timeout: 90_000 }, async (t) => {
  if (!existsSync(python)) { t.skip('no PlatformIO python on this machine'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'otb-walk-test-'));
  try {
    const child = spawn(python, [
      script, '--fake', '--every', '1', '--secs', '12', '--seed', '3', '--out', dir,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const code = await new Promise((done) => child.on('close', done));
    assert.equal(code, 0, 'the walk exited ' + code + '; output: ' + out);

    const stamp = readdirSync(dir).find((f) => f.endsWith('.jsonl'));
    assert.ok(stamp, 'the walk wrote its files: ' + readdirSync(dir).join(', '));
    const base = join(dir, stamp.replace(/\.jsonl$/, ''));

    // A sample per fresh listen — not per sample taken. The fake band hears
    // again every 3 s while it is asked every 1 s, so most samples repeat the
    // listen before them and the walk drops them; twelve seconds keep four.
    const dupes = out.match(/(\d+) listens kept, (\d+) duplicate samples dropped/);
    assert.ok(dupes, 'the walk counts what it kept and dropped: ' + out);
    assert.ok(Number(dupes[2]) > 0, 'repeated listens are dropped: ' + dupes[0]);

    const samples = readFileSync(base + '.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(samples.length >= 4, 'twelve seconds of fake listens, one per 3 s: ' + samples.length);
    assert.equal(samples.length, Number(dupes[1]), 'the kept samples are the ones written');
    for (const s of samples) {
      assert.equal(typeof s.t, 'number');
      assert.equal(s.air, 'ffffeeddcccc', 'the state line\'s own address, parsed from text');
      assert.equal(s.state, 'beaconing and listening');
      assert.equal(typeof s.channel, 'number');
      assert.ok(Array.isArray(s.heard) || Array.isArray(s.marks));
      for (const [who, rssi] of [...s.heard, ...s.marks]) {
        assert.equal(typeof who, 'string');
        assert.ok(rssi >= -100 && rssi <= 0, 'a reading in the range the relay takes');
      }
    }

    // One CSV row per reading, and the header says what each column is.
    const rows = readFileSync(base + '.csv', 'utf8').trim().split('\n');
    assert.equal(rows[0], 't_s,clock,label,kind,who,rssi_dbm,channel,state');
    assert.ok(rows.length > samples.length, 'several readings per listen');
    const kinds = new Set(rows.slice(1).map((r) => r.split(',')[3]));
    assert.ok(kinds.has('marker') && kinds.has('band'), 'markers and bands both recorded');

    // The page: curves for both markers, and the two lines a name rests on.
    const html = readFileSync(base + '.html', 'utf8');
    assert.match(html, /<polyline/, 'the page draws curves');
    assert.match(html, /marker bar/);
    assert.match(html, /marker stage/);
    assert.match(html, /names the area \(-56\)/);
    assert.match(html, /holds it \(-60\)/);
    assert.match(html, /at the bar \(fake\)/, 'the walk\'s annotation is drawn');
    assert.match(out, />=-56/, 'the stats table names what cleared the naming line');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
