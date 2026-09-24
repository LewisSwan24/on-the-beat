// The wristband's pairing code, read back by the decoder the phone scans with.
//
// A QR encoder that is wrong still draws a convincing square, so nothing here
// looks at the square: every code is drawn the way a screen draws it and read
// back through jsQR, which shares nothing with app/lib/qr.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { qrMatrix, qrPath } from '../app/lib/qr.js';
import { pairUrl } from '../app/lib/pairing.js';

/** Dark modules on a light ground, four modules of quiet round them, `scale` pixels a module. */
function draw(code, scale = 4, quiet = 4) {
  const side = (code.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let r = 0; r < code.size; r++) {
    for (let c = 0; c < code.size; c++) {
      if (!code.rows[r][c]) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const i = (((r + quiet) * scale + y) * side + (c + quiet) * scale + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { data, side };
}

const read = (code) => {
  const { data, side } = draw(code);
  return jsQR(data, side, side)?.data ?? null;
};

test('every length from 1 to 213 bytes reads back through jsQR, at every version from 1 to 10', () => {
  const tail = 'abcdefghijklmnopqrstuvwxyz0123456789-._~'.repeat(6);
  const versions = new Set();
  const masks = new Set();
  for (let n = 1; n <= 213; n++) {
    const text = ('https://otb.example/pair/NQJA?' + tail).slice(0, n);
    const code = qrMatrix(text);
    assert.ok(code, n + ' bytes made no code');
    assert.equal(read(code), text, n + ' bytes read back wrong (version ' + code.version + ', mask ' + code.mask + ')');
    versions.add(code.version);
    masks.add(code.mask);
  }
  assert.deepEqual([...versions].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(masks.size >= 6, 'only masks ' + [...masks].join(',') + ' were ever chosen');
});

test('a pairing address is version 3 to 5, and past version 10 there is no code at all', () => {
  assert.equal(qrMatrix(pairUrl('http://localhost:8790', 'NQJA')).version, 3);
  const tunnel = pairUrl('https://partition-accepted-evaluate-screen.trycloudflare.com', 'NQJA');
  assert.equal(qrMatrix(tunnel).version, 5);
  assert.equal(read(qrMatrix(tunnel)), tunnel);
  assert.equal(qrMatrix('x'.repeat(214)), null);
});

test('the path draws exactly the dark modules, and nothing in the quiet zone', () => {
  const code = qrMatrix(pairUrl('http://localhost:8790', 'WXYZ'));
  const quiet = 4;
  const side = code.size + quiet * 2;
  const d = qrPath(code, quiet);
  assert.equal(d.replace(/M\d+ \d+h\d+v1h-\d+z/g, ''), '', 'the path is only rectangles one module high');
  const grid = Array.from({ length: side }, () => new Uint8Array(side));
  for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    for (let i = 0; i < Number(w); i++) grid[Number(y)][Number(x) + i] += 1;
  }
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      const inside = r >= quiet && c >= quiet && r < quiet + code.size && c < quiet + code.size;
      assert.equal(grid[r][c], inside ? code.rows[r - quiet][c - quiet] : 0, 'module ' + r + ',' + c);
    }
  }
});
