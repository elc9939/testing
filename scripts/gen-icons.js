/* Generates the PWA / app icons as real PNGs — no external image libraries.
   Draws a dark arcade tile with four neon "controller buttons" (cyan/gold/
   magenta/green) on a radial-glow background. Run: node scripts/gen-icons.js */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// ---- tiny PNG encoder (24-bit RGB, no alpha) ----
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(size, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // bit depth 8, color type 2 (RGB)
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      raw[p++] = rgb[i]; raw[p++] = rgb[i + 1]; raw[p++] = rgb[i + 2];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- drawing helpers ----
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

function render(size) {
  const rgb = new Uint8Array(size * size * 3);
  const cx = size / 2, cy = size / 2;
  const R = size * 0.27;   // ring radius the buttons sit on
  const br = size * 0.115; // button radius
  const buttons = [
    { ang: -Math.PI / 2, c: [255, 212, 94] },  // top    – gold
    { ang: 0,            c: [255, 94, 196] },  // right  – magenta
    { ang: Math.PI / 2,  c: [156, 255, 94] },  // bottom – green
    { ang: Math.PI,      c: [94, 242, 255] },  // left   – cyan
  ].map(b => ({ x: cx + Math.cos(b.ang) * R, y: cy + Math.sin(b.ang) * R, c: b.c }));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.hypot(dx, dy) / (size * 0.5); // 0 center -> ~1 edge
      // background radial gradient: glowy navy center to near-black edge
      let r = mix(26, 5, smooth(0, 1, dist));
      let g = mix(35, 6, smooth(0, 1, dist));
      let b = mix(80, 15, smooth(0, 1, dist));
      // faint inner glow ring
      const glow = (1 - smooth(R - br, R + br * 1.6, Math.hypot(dx, dy))) * 0.25;
      r += 40 * glow; g += 70 * glow; b += 90 * glow;
      // buttons (with soft core highlight + antialiased edge)
      for (const bt of buttons) {
        const d = Math.hypot(x - bt.x, y - bt.y);
        const cov = 1 - smooth(br - 1.5, br + 1.5, d);
        if (cov > 0) {
          const core = mix(0.78, 1.25, 1 - clamp(d / br, 0, 1)); // brighter center
          r = mix(r, clamp(bt.c[0] * core, 0, 255), cov);
          g = mix(g, clamp(bt.c[1] * core, 0, 255), cov);
          b = mix(b, clamp(bt.c[2] * core, 0, 255), cov);
        }
      }
      const i = (y * size + x) * 3;
      rgb[i] = clamp(Math.round(r), 0, 255);
      rgb[i + 1] = clamp(Math.round(g), 0, 255);
      rgb[i + 2] = clamp(Math.round(b), 0, 255);
    }
  }
  return rgb;
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [180, 192, 512]) {
  const png = encodePNG(size, render(size));
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
  console.log(`wrote icons/icon-${size}.png (${png.length} bytes)`);
}
