// Genera los iconos PNG de la PWA sin dependencias (zlib + CRC32 a mano).
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, scale) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  const R = size * scale;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      let r = 4 + 10 * t, g = 6 + 30 * t, b = 12 + 110 * t;
      const d = Math.hypot(x - c, y - c);
      if (d < R) { const k = d / R; r = 41 + 4 * k; g = 216 - 93 * k; b = 255; }
      if (d < R * 0.78 && d > R * 0.62) { r = 4; g = 6; b = 12; }
      // flecha de "reset": punta arriba a la derecha dentro del anillo
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.writeFileSync(path.join(out, 'icon-192.png'), png(192, 0.38));
fs.writeFileSync(path.join(out, 'icon-512.png'), png(512, 0.38));
fs.writeFileSync(path.join(out, 'maskable-512.png'), png(512, 0.28));
console.log('iconos generados en', out);
