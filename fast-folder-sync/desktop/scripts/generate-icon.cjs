const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
function crc(data) { let c = 0xffffffff; for (const b of data) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const label = Buffer.from(type), out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); label.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc(Buffer.concat([label, data])), data.length + 8); return out; }
const size = 256, raw = Buffer.alloc((size * 4 + 1) * size);
function line(x, y, x1, y1, x2, y2, width) { const dx = x2 - x1, dy = y2 - y1; const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - x1 - t * dx, y - y1 - t * dy) < width; }
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const i = y * (size * 4 + 1) + 1 + x * 4;
  const cornerX = Math.max(45 - x, x - 210, 0), cornerY = Math.max(45 - y, y - 210, 0);
  const inside = Math.hypot(cornerX, cornerY) < 45;
  const white = [[60, 85, 194, 85], [164, 55, 194, 85], [164, 115, 194, 85], [194, 170, 60, 170], [90, 140, 60, 170], [90, 200, 60, 170]].some(a => line(x, y, ...a, 10));
  raw[i] = white ? 255 : 23; raw[i + 1] = white ? 255 : 134; raw[i + 2] = white ? 255 : 110; raw[i + 3] = inside ? 255 : 0;
}
const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(__dirname, '..', 'icon.png'), png);
const ico = Buffer.alloc(22); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(__dirname, '..', 'icon.ico'), Buffer.concat([ico, png]));
