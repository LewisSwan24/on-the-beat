/* ============================================================================
   qr.js - a QR code, computed here: byte mode, error correction level M,
   versions 1 to 10 (up to 213 bytes). A pairing address is 30 to 70
   characters, which is version 3 to 5.

   The algorithm is the SAY HELLO prototype's encoder, where a decoder written
   from ISO/IEC 18004 reads it back. Here tests/qr.test.js reads every length
   from 1 to 213 bytes back through jsQR - the decoder the phone itself scans
   with - so a code this file draws is one that decoder has already read.

   A quiet zone of four light modules round the code is not decoration. A code
   drawn hard against a dark screen is a code that does not read.
   ========================================================================== */

/* ---- GF(256), the field Reed-Solomon is done in ---------------------------

   Every QR implementation uses the same primitive polynomial, x^8+x^4+x^3+x^2+1
   = 0x11D. The two tables are the logarithm and its inverse, which turn
   multiplication into addition of exponents. */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/* The generator polynomial for `n` error-correction codewords:
   (x - 2^0)(x - 2^1)...(x - 2^(n-1)), built up one root at a time. */
function generator(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/* Polynomial long division; the remainder IS the error-correction block. */
function ecBytes(data, n) {
  const gen = generator(n);
  const rem = new Array(n).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < n; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

/* ---- the tables ----------------------------------------------------------

   Per version at error-correction level M:
     [ total codewords, ec codewords per block, blocks in group 1,
       blocks in group 2 ]
   Group 2's blocks each hold one more data codeword than group 1's. These are
   transcribed from the standard's table 9 and the test re-derives the split
   arithmetically rather than trusting the transcription. */
const VERSIONS = Object.freeze({
  1:  [26,   10, 1, 0],
  2:  [44,   16, 1, 0],
  3:  [70,   26, 1, 0],
  4:  [100,  18, 2, 0],
  5:  [134,  24, 2, 0],
  6:  [172,  16, 4, 0],
  7:  [196,  18, 4, 0],
  8:  [242,  22, 2, 2],
  9:  [292,  22, 3, 2],
  10: [346,  26, 4, 1]
});

/* Where the alignment patterns sit. Every pair of these coordinates is a
   centre, except the three that would land on a finder. */
const ALIGN = Object.freeze({
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
});

export const QR_MAX_VERSION = 10;
export const QR_EC_LEVEL = 'M';

const sizeOf = (version) => version * 4 + 17;

/* How many data codewords a version holds, and how the blocks divide. */
function layout(version) {
  const [total, ecPerBlock, g1, g2] = VERSIONS[version];
  const blocks = g1 + g2;
  const dataTotal = total - ecPerBlock * blocks;
  const g1Data = Math.floor(dataTotal / blocks);
  return { total, ecPerBlock, blocks, g1, g2, dataTotal, g1Data, g2Data: g1Data + 1 };
}

/* The smallest version that fits. The character count is 8 bits up to version
   9 and 16 bits from 10, which is why this is a loop and not a division. */
function fitVersion(byteLength) {
  for (let v = 1; v <= QR_MAX_VERSION; v++) {
    const { dataTotal } = layout(v);
    const countBits = v < 10 ? 8 : 16;
    const needed = Math.ceil((4 + countBits + byteLength * 8) / 8);
    if (needed <= dataTotal) return v;
  }
  return 0;
}

/* ---- the bit stream ------------------------------------------------------ */

function codewords(bytes, version) {
  const { dataTotal } = layout(version);
  const countBits = version < 10 ? 8 : 16;

  const bits = [];
  const push = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1); };

  push(0b0100, 4);                    // byte mode
  push(bytes.length, countBits);
  for (const b of bytes) push(b, 8);

  /* Terminator: up to four zero bits, fewer if the capacity is nearly used. */
  const capacity = dataTotal * 8;
  for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    out.push(byte);
  }
  /* The two pad bytes, alternating, until the version is full. They are
     specified values rather than zeroes so an unfinished stream cannot be
     mistaken for data. */
  const PAD = [0xec, 0x11];
  let padAt = 0;
  while (out.length < dataTotal) out.push(PAD[padAt++ % 2]);
  return out;
}

/* Blocks are interleaved: the first codeword of every block, then the second
   of every block, and so on - so a scratch across the symbol damages a little
   of each block rather than destroying one. */
function interleave(data, version) {
  const { ecPerBlock, blocks, g1, g1Data, g2Data } = layout(version);

  const dataBlocks = [];
  const ecBlocks = [];
  let at = 0;
  for (let b = 0; b < blocks; b++) {
    const n = b < g1 ? g1Data : g2Data;
    const block = data.slice(at, at + n);
    at += n;
    dataBlocks.push(block);
    ecBlocks.push(ecBytes(block, ecPerBlock));
  }

  const out = [];
  const longest = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) {
    for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const b of ecBlocks) out.push(b[i]);
  }
  return out;
}

/* ---- the matrix ---------------------------------------------------------- */

const FINDER = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1]
];

/* `fixed` marks every module that belongs to a function pattern, so the data
   walk knows what to step over and the mask knows what to leave alone. */
function frame(version) {
  const n = sizeOf(version);
  const m = Array.from({ length: n }, () => new Uint8Array(n));
  const fixed = Array.from({ length: n }, () => new Uint8Array(n));

  const put = (r, c, v) => { m[r][c] = v; fixed[r][c] = 1; };

  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) put(r0 + r, c0 + c, FINDER[r][c]);
    /* The separator: one blank module all the way round each finder. */
    for (let i = -1; i <= 7; i++) {
      for (const [r, c] of [[r0 - 1, c0 + i], [r0 + 7, c0 + i], [r0 + i, c0 - 1], [r0 + i, c0 + 7]]) {
        if (r >= 0 && r < n && c >= 0 && c < n) put(r, c, 0);
      }
    }
  }

  for (let i = 8; i < n - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    put(6, i, v);
    put(i, 6, v);
  }

  for (const r of ALIGN[version]) {
    for (const c of ALIGN[version]) {
      /* The three that would sit on a finder are not drawn. */
      if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          put(r + dr, c + dc, on ? 1 : 0);
        }
      }
    }
  }

  put(n - 8, 8, 1);                   // the dark module, always set

  /* The format areas are reserved now and written after masking. */
  for (let i = 0; i < 9; i++) {
    if (!fixed[8][i]) put(8, i, 0);
    if (!fixed[i][8]) put(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (!fixed[8][n - 1 - i]) put(8, n - 1 - i, 0);
    if (!fixed[n - 1 - i][8]) put(n - 1 - i, 8, 0);
  }

  /* Version information, for 7 and up: 18 bits in two 3x6 blocks. */
  if (version >= 7) {
    let d = version << 12;
    for (let i = 0; i < 12; i++) {
      const shift = 17 - i;
      if ((d >> shift) & 1) d ^= 0x1f25 << (shift - 12);
    }
    const bitsV = (version << 12) | (d & 0xfff);
    for (let i = 0; i < 18; i++) {
      const bit = (bitsV >> i) & 1;
      put(Math.floor(i / 3), n - 11 + (i % 3), bit);
      put(n - 11 + (i % 3), Math.floor(i / 3), bit);
    }
  }

  return { m, fixed, n };
}

/* The data walk: two columns at a time, right to left, alternating up and
   down, stepping over column 6 because the vertical timing pattern is there. */
function place(m, fixed, n, bytes) {
  let bit = 0;
  const total = bytes.length * 8;
  const next = () => (bit < total ? (bytes[bit >> 3] >> (7 - (bit & 7))) & 1 : 0);

  let up = true;
  for (let right = n - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < n; step++) {
      const r = up ? n - 1 - step : step;
      for (const c of [right, right - 1]) {
        if (fixed[r][c]) continue;
        m[r][c] = next();
        bit++;
      }
    }
    up = !up;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

/* The four penalties from the standard. A mask is chosen by score because the
   point of masking is to break up runs and large blocks of one colour, which
   is what a scanner loses its place in. */
function penalty(m, n) {
  let score = 0;

  const run = (get) => {
    for (let a = 0; a < n; a++) {
      let last = -1, len = 0;
      for (let b = 0; b < n; b++) {
        const v = get(a, b);
        if (v === last) { len++; if (len === 5) score += 3; else if (len > 5) score += 1; }
        else { last = v; len = 1; }
      }
    }
  };
  run((r, c) => m[r][c]);
  run((c, r) => m[r][c]);

  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }

  const PAT = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const hit = (get, a, b) => {
    for (let i = 0; i < 11; i++) if (get(a, b + i) !== PAT[i]) return false;
    return true;
  };
  for (let a = 0; a < n; a++) {
    for (let b = 0; b + 11 <= n; b++) {
      if (hit((x, y) => m[x][y], a, b)) score += 40;
      if (hit((x, y) => m[y][x], a, b)) score += 40;
    }
  }

  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dark += m[r][c];
  const pct = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;

  return score;
}

/* Format information: two bits of EC level, three of mask, a BCH(15,5)
   remainder, and a fixed XOR so an all-zero format is not a valid one. */
function formatBits(maskIndex) {
  const EC_M = 0b00;
  const data = (EC_M << 3) | maskIndex;
  let d = data << 10;
  for (let i = 0; i < 5; i++) {
    const shift = 14 - i;
    if ((d >> shift) & 1) d ^= 0x537 << (shift - 10);
  }
  return ((data << 10) | (d & 0x3ff)) ^ 0x5412;
}

function writeFormat(m, n, maskIndex) {
  const bits = formatBits(maskIndex);
  for (let i = 0; i < 15; i++) {
    /* MOST significant bit first. The standard numbers the format string from
       the top: (8,0) and (n-1,8) take bit 14, and (0,8) and (8,n-1) take bit
       0. Walking `bits >> i` instead wrote the fifteen bits backwards into the
       right thirty squares, which is a code no scanner on earth will read -
       the BCH check fails before the data is ever looked at, so the payload,
       the mask and every pattern being perfect buys nothing.
       Measured: every code this file produced, at every version from 1 to 10,
       was unreadable. Against a known-good encoder at the same version and
       mask, 1081 of 1089 modules agreed and the eight that differed were
       these. Nothing in the rendered page can show this; it looks like a QR
       code, and it is the shape of one. */
    const bit = (bits >> (14 - i)) & 1;
    /* The copy beside the top-left finder, and the copy split between the
       other two - every scanner reads whichever it can see. */
    if (i < 6) m[8][i] = bit;
    else if (i === 6) m[8][7] = bit;
    else if (i === 7) m[8][8] = bit;
    else if (i === 8) m[7][8] = bit;
    else m[14 - i][8] = bit;

    /* SEVEN bits down the column, not eight. The eighth position, (n-8, 8),
       is the dark module - it is always set and is not part of the format.
       Writing eight here overwrote it, and the two copies of the format then
       still agreed with each other, so only a check written from the standard
       rather than from this file noticed. */
    if (i < 7) m[n - 1 - i][8] = bit;
    else m[8][n - 15 + i] = bit;
  }
}

/* ---- the one thing this file is for -------------------------------------- */

/**
 * qrMatrix(text) -> { size, version, rows, mask } | null
 *
 * `rows` is an array of Uint8Array, one per row, 1 for a dark module. Returns
 * null when the text does not fit in version 10 (213 bytes). A caller that
 * gets null shows the four letters alone, which pair just as well.
 */
export function qrMatrix(text) {
  const bytes = [];
  for (const ch of String(text)) {
    const p = ch.codePointAt(0);
    /* UTF-8, by hand, so this module needs nothing from where it runs. A
       pairing address is ASCII; the rest is here so a non-ASCII origin makes a
       correct code rather than a silently wrong one. */
    if (p < 0x80) bytes.push(p);
    else if (p < 0x800) bytes.push(0xc0 | (p >> 6), 0x80 | (p & 63));
    else if (p < 0x10000) bytes.push(0xe0 | (p >> 12), 0x80 | ((p >> 6) & 63), 0x80 | (p & 63));
    else bytes.push(0xf0 | (p >> 18), 0x80 | ((p >> 12) & 63), 0x80 | ((p >> 6) & 63), 0x80 | (p & 63));
  }

  const version = fitVersion(bytes.length);
  if (!version) return null;

  const stream = interleave(codewords(bytes, version), version);
  const { m, fixed, n } = frame(version);
  place(m, fixed, n, stream);

  let best = null;
  for (let k = 0; k < 8; k++) {
    const candidate = m.map((row) => Uint8Array.from(row));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!fixed[r][c] && MASKS[k](r, c)) candidate[r][c] ^= 1;
      }
    }
    writeFormat(candidate, n, k);
    const score = penalty(candidate, n);
    if (!best || score < best.score) best = { score, k, rows: candidate };
  }

  return { size: n, version, rows: best.rows, mask: best.k };
}

/**
 * qrPath(code, quiet) -> string
 *
 * The dark modules as one SVG path in module units, `quiet` modules in from
 * the edge. A run of dark modules along a row is one rectangle, so a version 4
 * code is a few hundred short commands rather than a thousand.
 */
export function qrPath(code, quiet = 4) {
  let d = '';
  for (let r = 0; r < code.size; r++) {
    for (let c = 0; c < code.size; c++) {
      if (!code.rows[r][c]) continue;
      let end = c;
      while (end + 1 < code.size && code.rows[r][end + 1]) end++;
      const w = end - c + 1;
      d += `M${c + quiet} ${r + quiet}h${w}v1h-${w}z`;
      c = end;
    }
  }
  return d;
}
