// ON THE BEAT — the capacity probe works end to end: its phones join and are
// pushed views, its bands pair through the real letters-check-YES flow and
// their heard reports flow, and the stage's numbers come out as JSON
// (scripts/load.mjs). A smoke test of the rig, not of the relay's limits:
// the sizes here are tiny, and the ceilings are measured by hand
// (docs/show-night.md, README "What is not done").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/load.mjs', import.meta.url));

test('the load rig fills a venue, pairs its bands, and reports the stage', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'otb-load-test-'));
  const out = join(dir, 'results.json');
  // Warm and ramp with room to spare: node --test runs files in parallel, so
  // this rig shares the machine, and the pairing handshake (letters, check,
  // YES, each step on a phone that parses at most twice a second) must not
  // lose a band to a busy CPU.
  const child = spawn(process.execPath, [
    script, '--phones', '8', '--bands', '3', '--warm', '5', '--secs', '5',
    '--venue', 'rig', '--ramp', '2500', '--json', out,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((done) => child.on('close', done));
  try {
    assert.equal(code, 0, 'the probe exited ' + code + '; stderr: ' + err);
    const { results } = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(results.length, 1);
    const r = results[0];
    assert.equal(r.phones, 8);
    assert.equal(r.bands, 3);
    assert.equal(r.pairs, 3, 'every band paired with its phone through the real flow');
    assert.equal(r.drops, 0, 'nobody was dropped');
    assert.equal(r.errors, 0, 'the relay refused nothing');
    assert.ok(r.viewsPerPhoneSec > 0, 'views reached the phones');
    assert.ok(r.waves > 0, 'waves were sent');
    assert.ok(r.heard > 0, 'the bands reported what they heard');
    assert.equal(r.saturated, false, 'eight people are nowhere near a ceiling');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
