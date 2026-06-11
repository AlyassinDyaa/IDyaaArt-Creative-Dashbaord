// Generates Entropy PWA icons (192 & 512) as valid PNGs with zero dependencies.
// A dark rounded square with a violet gradient glyph. Run: node scripts/gen-icons.js
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}
function png(size) {
  const w = size, h = size
  const px = Buffer.alloc(w * h * 4)
  const cx = w / 2, cy = h / 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      // rounded-square background
      const r = size * 0.18
      const inX = Math.min(x, w - 1 - x), inY = Math.min(y, h - 1 - y)
      let inside = true
      if (inX < r && inY < r) inside = (r - inX) ** 2 + (r - inY) ** 2 <= r * r
      // base dark
      px[i] = 14; px[i + 1] = 14; px[i + 2] = 18; px[i + 3] = inside ? 255 : 0
      if (!inside) continue
      // glyph: a tilted "E"-ish set of three bars forming entropy mark
      const t = y / h
      const gr = Math.round(124 + t * 40)   // violet gradient
      const gg = Math.round(58 + t * 20)
      const gb = Math.round(237 - t * 30)
      const bw = w * 0.12
      const inset = w * 0.26
      const bars = [0.28, 0.5, 0.72]
      let on = false
      for (const b of bars) {
        const yy = h * b
        const len = b === 0.5 ? w * 0.34 : w * 0.46
        if (Math.abs(y - yy) < bw / 2 && x > inset && x < inset + len) on = true
      }
      // vertical spine
      if (x > inset && x < inset + bw && y > h * 0.24 && y < h * 0.76) on = true
      if (on) { px[i] = gr; px[i + 1] = gg; px[i + 2] = gb; px[i + 3] = 255 }
    }
  }
  // add filter byte (0) per scanline
  const raw = Buffer.alloc(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), png(size))
  console.log(`wrote icon-${size}.png`)
}
