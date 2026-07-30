/**
 * PWA icon generation.
 *
 * Writes the PNG icons the web app manifest needs, drawing the PrintNest mark
 * directly as raw PNG bytes. Doing it this way keeps the repository free of a
 * headless-browser or image-library dependency just to produce four small
 * files — and the mark is simple enough that a hand-rolled rasteriser is
 * clearer than pulling in a toolchain.
 *
 * Run with:  node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');

const PAPER = [251, 248, 242];
const WHITE = [255, 255, 255];
const ORANGE = [244, 163, 64];
const DARK = [74, 47, 8];

/** A tiny RGBA canvas with just enough drawing for the mark. */
function createCanvas(size) {
  const data = new Uint8Array(size * size * 4);
  return {
    size,
    data,
    set(x, y, [r, g, b], alpha = 255) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const index = (y * size + x) * 4;
      const a = alpha / 255;
      // Source-over compositing so overlapping shapes blend rather than clip.
      data[index] = Math.round(data[index] * (1 - a) + r * a);
      data[index + 1] = Math.round(data[index + 1] * (1 - a) + g * a);
      data[index + 2] = Math.round(data[index + 2] * (1 - a) + b * a);
      data[index + 3] = Math.max(data[index + 3], alpha);
    },
    fillRect(x0, y0, w, h, colour, alpha = 255) {
      for (let y = Math.round(y0); y < Math.round(y0 + h); y += 1) {
        for (let x = Math.round(x0); x < Math.round(x0 + w); x += 1) {
          this.set(x, y, colour, alpha);
        }
      }
    },
    fillRoundedRect(x0, y0, w, h, radius, colour) {
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          // Distance to the nearest corner centre decides whether we are inside.
          const cx = Math.min(Math.max(x, radius), w - radius);
          const cy = Math.min(Math.max(y, radius), h - radius);
          const distance = Math.hypot(x - cx, y - cy);
          if (distance <= radius) {
            // Antialias the last pixel of the curve.
            const alpha = distance > radius - 1 ? Math.round((radius - distance) * 255) : 255;
            this.set(Math.round(x0 + x), Math.round(y0 + y), colour, Math.max(0, Math.min(255, alpha)));
          }
        }
      }
    },
    fillEllipseBand(cx, cy, rx, ry, thickness, colour, fromAngle, toAngle) {
      const steps = Math.ceil(rx * 8);
      for (let i = 0; i <= steps; i += 1) {
        const angle = fromAngle + ((toAngle - fromAngle) * i) / steps;
        const x = cx + Math.cos(angle) * rx;
        const y = cy + Math.sin(angle) * ry;
        for (let t = -thickness / 2; t <= thickness / 2; t += 0.5) {
          this.set(Math.round(x), Math.round(y + t), colour);
        }
      }
    },
  };
}

function drawMark(canvas, { maskable }) {
  const size = canvas.size;
  const unit = size / 32;
  // Maskable icons must keep their content inside a safe circle, so the
  // artwork is drawn smaller with the background bleeding to the edges.
  const inset = maskable ? size * 0.12 : 0;
  const scale = (size - inset * 2) / size;

  const px = (value) => inset + value * unit * scale;
  const len = (value) => value * unit * scale;

  if (maskable) {
    canvas.fillRect(0, 0, size, size, ORANGE);
  } else {
    canvas.fillRoundedRect(px(1.5), px(1.5), len(29), len(29), len(8), ORANGE);
  }

  // The nest: a curve cradling the sheets.
  canvas.fillEllipseBand(
    px(16),
    px(19),
    len(10.5),
    len(7),
    Math.max(2, len(1.8)),
    DARK,
    0.15 * Math.PI,
    0.85 * Math.PI,
  );

  // Back sheet.
  canvas.fillRect(px(11), px(6), len(11), len(15), PAPER);
  // Folded front sheet.
  canvas.fillRect(px(9), px(10), len(9.5), len(12), WHITE);
  // The fold line.
  for (let y = 0; y < len(12); y += Math.max(1, len(0.55))) {
    canvas.fillRect(px(12.5), px(10) + y, Math.max(1, len(0.4)), Math.max(1, len(0.3)), DARK);
  }
  // Outline the front sheet so it reads at small sizes.
  const stroke = Math.max(1, Math.round(len(0.5)));
  canvas.fillRect(px(9), px(10), len(9.5), stroke, DARK);
  canvas.fillRect(px(9), px(22) - stroke, len(9.5), stroke, DARK);
  canvas.fillRect(px(9), px(10), stroke, len(12), DARK);
  canvas.fillRect(px(18.5) - stroke, px(10), stroke, len(12), DARK);
}

/** Minimal PNG encoder: one IHDR, one IDAT, one IEND. */
function encodePng(canvas) {
  const { size, data } = canvas;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    // Filter type 0 (none) at the start of each scanline.
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(data.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  const chunk = (type, payload) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length);
    const typeBuffer = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, payload])) >>> 0);
    return Buffer.concat([length, typeBuffer, payload, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc ^ -1;
}

function build(size, name, options = {}) {
  const canvas = createCanvas(size);
  drawMark(canvas, { maskable: options.maskable ?? false });
  const png = encodePng(canvas);
  writeFileSync(join(outDir, name), png);
  console.log(`wrote icons/${name} (${size}×${size}, ${(png.length / 1024).toFixed(1)} KB)`);
}

mkdirSync(outDir, { recursive: true });
build(192, 'icon-192.png');
build(512, 'icon-512.png');
build(512, 'maskable-512.png', { maskable: true });
build(180, 'apple-touch-icon.png');
