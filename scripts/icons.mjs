// Draws the app's icons: three lights on black — hello, first song, dance —
// as PNGs, with nothing but node's own zlib. Run it when the mark changes:
//
//   node scripts/icons.mjs
//
// The maskable icon keeps its lights inside the middle 60%, so a launcher that
// crops to a circle or a squircle never cuts one off.

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../app/public/', import.meta.url));

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, paint) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = paint((x + 0.5) / size, (y + 0.5) / size);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const LIGHTS = [
  { x: 0.36, y: 0.40, c: [0x4e, 0xd7, 0xf1] },   // hello
  { x: 0.64, y: 0.40, c: [0xf2, 0xd6, 0x5e] },   // first song
  { x: 0.50, y: 0.64, c: [0xda, 0x8c, 0xf2] },   // dance
];

/** Three lights, each a hard dot inside its own glow, scaled about the centre. */
const mark = (scale) => (u, v) => {
  let r = 0, g = 0, b = 0;
  for (const l of LIGHTS) {
    const lx = 0.5 + (l.x - 0.5) * scale, ly = 0.5 + (l.y - 0.5) * scale;
    const d = Math.hypot(u - lx, v - ly) / scale;
    const dot = d < 0.085 ? 1 : d < 0.095 ? (0.095 - d) / 0.01 : 0;
    const glow = Math.max(0, 1 - d / 0.26) ** 2 * 0.55;
    const k = Math.min(1, dot + glow);
    r += l.c[0] * k; g += l.c[1] * k; b += l.c[2] * k;
  }
  return [Math.min(255, r), Math.min(255, g), Math.min(255, b)].map(Math.round);
};

mkdirSync(OUT, { recursive: true });
writeFileSync(OUT + 'icon-192.png', png(192, mark(1)));
writeFileSync(OUT + 'icon-512.png', png(512, mark(1)));
writeFileSync(OUT + 'maskable-512.png', png(512, mark(0.72)));
console.log('icons written to', OUT);
