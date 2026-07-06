// Generates PWA icons using only Node.js built-ins (no npm packages needed).
// Creates a dark-background circle-ring icon at 192×192 and 512×512.
// Run: node scripts/gen-icons.mjs

import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'

// ─── PNG helpers ──────────────────────────────────────────────────────────────

function uint32BE(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0, 0)
  return b
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (const b of buf) crc = (CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0
  return (~crc) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const crc = crc32(Buffer.concat([typeBytes, data]))
  return Buffer.concat([uint32BE(data.length), typeBytes, data, uint32BE(crc)])
}

// ─── Icon rasteriser ─────────────────────────────────────────────────────────

// Background: #060607  Accent ring: #FF8C42
// The ring is sized so content stays within the maskable safe zone.
function createIconPng(size) {
  const cx = size / 2
  const cy = size / 2
  // Keep ring within the 80% safe circle for maskable use
  const outerR = size * 0.38
  const innerR = size * 0.22

  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3)  // filter=None + RGB
    row[0] = 0
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cy
      const d = Math.sqrt(dx * dx + dy * dy)
      let r, g, b
      if (d >= innerR && d <= outerR) {
        // Orange ring
        r = 0xff; g = 0x8c; b = 0x42
      } else {
        // Dark background
        r = 0x06; g = 0x06; b = 0x07
      }
      row[1 + x * 3]     = r
      row[1 + x * 3 + 1] = g
      row[1 + x * 3 + 2] = b
    }
    rows.push(row)
  }

  const raw = Buffer.concat(rows)
  const compressed = deflateSync(raw, { level: 9 })

  const sig  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.concat([uint32BE(size), uint32BE(size), Buffer.from([8, 2, 0, 0, 0])])

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ─── Write files ──────────────────────────────────────────────────────────────

writeFileSync('public/icon-192.png', createIconPng(192))
writeFileSync('public/icon-512.png', createIconPng(512))
console.log('✓ public/icon-192.png')
console.log('✓ public/icon-512.png')
