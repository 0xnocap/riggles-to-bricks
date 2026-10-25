// A contact sheet for eyeballing a build: the riggle as the engine draws it,
// next to the same riggle in bricks, straight off the piece list.
// Pure Node, no browser and no WebGL.
//
//   npm run sheet -- 1 2 3 17 19
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { buildRiggle } from '../src/riggle/build.ts';
import { riggleCurve } from '../src/riggle/curve.ts';
import { rigglePixels } from '../src/riggle/pixels.ts';
import { curveColors } from '../src/squiggle/spectrum.ts';
import { renderHex } from '../src/core/palette.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const D = JSON.parse(readFileSync(join(HERE, '..', 'src', 'data', 'riggles.json'), 'utf8'));
const OUT = join(HERE, '..', 'out', 'sheet');

const CELL = 14;                 // pixels per stud
const hexRGB = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const hslRGB = (h, s, l) => {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return [f(0), f(8), f(4)];
};

function px(png, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) << 2;
  png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
}
const rect = (png, x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(png, x + i, y + j, c); };

/** the art: the engine's own cells for a Pixelated riggle, else the centre line */
function drawArt(png, ox, oy, w, h, curve) {
  rect(png, ox, oy, w, h, hexRGB(curve.background === 1 ? '#CCFF00' : '#000000'));
  const k = Math.min(w / curve.canvas.w, h / curve.canvas.h);
  const cells = rigglePixels(curve.traits, curve.canvas.w, curve.canvas.h);
  if (cells.length) {
    for (const q of cells) {
      const c = q.grey ? hslRGB(0, 0, q.light) : hslRGB(q.hue, curve.traits.satPct, q.light);
      const side = Math.max(1, Math.round(q.size * k));
      rect(png, Math.round(ox + (q.x * k) - side / 2), Math.round(oy + (q.y * k) - side / 2), side, side, c);
    }
    return;
  }
  const r = Math.max(1, (curve.stroke * k) / 2);
  curve.points.forEach((p, i) => {
    const cx = ox + p.x * k, cy = oy + p.y * k;
    const c = curve.traits.spectrum === 'grey' ? hslRGB(0, 0, curve.light[i]) : hslRGB(p.hue, curve.traits.satPct, curve.light[i]);
    // square stamp, as the engine draws it: flat ends, mitred corners
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) px(png, Math.round(cx + dx), Math.round(cy + dy), c);
  });
}

/** the model, drawn from its pieces, seen from the front */
function drawBricks(png, ox, oy, model) {
  let x1 = 0, z1 = 0;
  for (const p of model.pieces) { x1 = Math.max(x1, p.x + p.w); z1 = Math.max(z1, p.z + p.d); }
  const order = [...model.pieces].sort((a, b) => a.y - b.y);
  for (const p of order) {
    const sx = ox + p.x * CELL, sy = oy + (z1 - p.z - p.d) * CELL;
    const c = hexRGB(renderHex(p.c));
    rect(png, sx, sy, p.w * CELL, p.d * CELL, c);
    // a thin darker edge so the individual bricks read
    const edge = c.map((v) => Math.max(0, v - 38));
    for (let i = 0; i < p.w * CELL; i++) { px(png, sx + i, sy, edge); px(png, sx + i, sy + p.d * CELL - 1, edge); }
    for (let j = 0; j < p.d * CELL; j++) { px(png, sx, sy + j, edge); px(png, sx + p.w * CELL - 1, sy + j, edge); }
  }
  return { w: x1 * CELL, h: z1 * CELL };
}

const ids = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (!ids.length) { console.error('give some token ids: npm run sheet -- 1 2 3'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

for (const id of ids) {
  const hash = D.riggles[id]?.h;
  if (!hash) { console.error(`#${id} is not in the collection`); continue; }
  for (const format of ['relief', 'mosaic']) {
    const { curve, model, width } = buildRiggle(id, hash, { format, display: 'frame', scale: 'large' });
    let x1 = 0, z1 = 0;
    for (const p of model.pieces) { x1 = Math.max(x1, p.x + p.w); z1 = Math.max(z1, p.z + p.d); }
    const bw = x1 * CELL, bh = z1 * CELL;
    const aw = Math.round(bh * (curve.canvas.w / curve.canvas.h)), gap = 24;
    const png = new PNG({ width: aw + gap + bw, height: Math.max(bh, Math.round(aw * curve.canvas.h / curve.canvas.w)) });
    rect(png, 0, 0, png.width, png.height, [24, 24, 26]);
    drawArt(png, 0, 0, aw, Math.round(aw * curve.canvas.h / curve.canvas.w), curve);
    drawBricks(png, aw + gap, 0, model);
    const file = join(OUT, `riggle-${id}-${format}.png`);
    writeFileSync(file, PNG.sync.write(png));
    console.log(`#${id} ${format.padEnd(6)} ${curve.type.padEnd(7)} ribbon ${String(width).padStart(2)}  ${model.pieces.length} pieces  ${x1}x${z1} studs  ${file}`);
  }
}
