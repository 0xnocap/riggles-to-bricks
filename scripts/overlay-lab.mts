// Lab: the art and the bricks on the SAME grid, so colour blocks can be compared
// stud for stud. Art on top, bricks below, one stud = one cell in both.
//   npx tsx scripts/overlay-lab.mts 13 [relief|mosaic]
import { writeFileSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { riggleCurve } from '../src/riggle/curve';
import { recordRiggle } from '../src/riggle/pixels';
import { mosaicPicture } from '../src/squiggle/mosaic';
import { buildRiggle, RIGGLE_GRID } from '../src/riggle/build';
import { renderHex } from '../src/core/palette';

const D = JSON.parse(readFileSync(new URL('../src/data/riggles.json', import.meta.url), 'utf8'));
const id = Number(process.argv[2] ?? 13);
const fmt = (process.argv[3] === 'relief' ? 'relief' : 'mosaic') as 'relief' | 'mosaic';
const CELL = 16;
const c = riggleCurve({ id, hash: D.riggles[id].h });
const pic = mosaicPicture(c, 'large', RIGGLE_GRID.large, { square: true, field: c.panel });
const { model } = buildRiggle(id, D.riggles[id].h, { format: fmt, display: 'frame', scale: 'large' });

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const hsl = (h: number, s: number, l: number) => {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return [f(0), f(8), f(4)];
};
const parse = (css: string) => {
  const m = /hsl\(\s*([-\d.]+)\s*,\s*([\d.]+)%\s*,\s*([-\d.]+)%\s*\)/.exec(css);
  if (m) return hsl(((+m[1] % 360) + 360) % 360, +m[2], +m[3]);
  if (css[0] === '#') return hex(css.length === 4 ? '#' + css[1] + css[1] + css[2] + css[2] + css[3] + css[3] : css);
  return null;
};

const W = pic.w, H = pic.h;
const png = new PNG({ width: W * CELL, height: H * CELL * 2 + 10 });
const put = (x: number, y: number, col: number[]) => { if (x < 0 || y < 0 || x >= png.width || y >= png.height) return; const i = (png.width * y + x) << 2; png.data[i] = col[0]; png.data[i + 1] = col[1]; png.data[i + 2] = col[2]; png.data[i + 3] = 255; };
const rect = (x: number, y: number, w: number, h: number, col: number[]) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, col); };
rect(0, 0, png.width, png.height, [20, 20, 22]);

// THE ART, mapped onto the same stud grid the mosaic uses
const { box, stroke } = c;
const pad = 3;
const k = Math.min((W - 2 * pad) / (box.x1 - box.x0 + stroke), (H - 2 * pad) / (box.y1 - box.y0 + stroke));
const pcx = (box.x0 + box.x1) / 2, pcy = (box.y0 + box.y1) / 2;
const toStud = (x: number, y: number) => [(x - pcx) * k + W / 2, (pcy - y) * k + H / 2];
for (const o of recordRiggle(c.traits, c.canvas.w, c.canvas.h)) {
  if (o.w === c.canvas.w && o.h === c.canvas.h) continue;
  const a = parse(o.css); if (!a) continue;
  const b = o.css2 ? parse(o.css2) ?? a : a;
  const [sx, sz] = toStud(o.x, o.y);
  const w = Math.max(1, o.w * k), h = Math.max(1, o.h * k);
  // sz counts up from the front, as the brick grid does, so the screen row is
  // measured from the top: drawing at sz directly puts the art upside down
  const X = Math.round(sx * CELL), Y = Math.round((H - sz) * CELL);
  const PW = Math.round(w * CELL), PH = Math.round(h * CELL);
  if (a === b || !o.css2) { rect(X, Y, PW, PH, a); continue; }
  // ramp across the rect along the gradient's own direction, as the engine does
  const [g0x, g0y] = toStud(o.gx0 ?? o.x, o.gy0 ?? o.y);
  const [g1x, g1y] = toStud(o.gx1 ?? o.x + o.w, o.gy1 ?? o.y);
  const dx = (g1x - g0x) * CELL, dy = ((H - g1y) - (H - g0y)) * CELL;
  const len2 = dx * dx + dy * dy || 1;
  for (let j = 0; j < PH; j++) for (let i = 0; i < PW; i++) {
    const t = Math.max(0, Math.min(1, ((X + i - g0x * CELL) * dx + (Y + j - (H - g0y) * CELL) * dy) / len2));
    put(X + i, Y + j, [0, 1, 2].map((n) => Math.round(a[n] + (b[n] - a[n]) * t)));
  }
}
// stud grid over the art, so blocks can be counted
for (let x = 0; x <= W; x++) for (let y = 0; y < H * CELL; y++) put(x * CELL, y, [255, 255, 255, ][0] ? [60, 60, 64] : [60, 60, 64]);
for (let z = 0; z <= H; z++) for (let x = 0; x < W * CELL; x++) put(x, z * CELL, [60, 60, 64]);

// THE BRICKS
const oy = H * CELL + 10;
// the relief is built on its own panel, so place it by its own extent
let bx = Infinity, bz = Infinity;
for (const p of model.pieces) { bx = Math.min(bx, p.x); bz = Math.min(bz, p.z); }
let tx = 0, tz = 0;
for (const p of model.pieces) { tx = Math.max(tx, p.x + p.w - bx); tz = Math.max(tz, p.z + p.d - bz); }
// the model is built on its own panel, which is not the engine's grid, so it
// is scaled to the same extent the art was fitted to. Drawing both at one stud
// per cell made the model look far smaller than the art and nothing lined up.
const artW = (box.x1 - box.x0 + stroke) * k, artH = (box.y1 - box.y0 + stroke) * k;
const bk = Math.min(artW / tx, artH / tz);
const bcx = W / 2 - (tx * bk) / 2, bcz = H / 2 - (tz * bk) / 2;
for (const p of [...model.pieces].sort((a, b) => a.y - b.y)) {
  if (p.role !== 'squiggle') continue;          // just the riggle, not its frame
  const col = hex(renderHex(p.c));
  const sx = (bcx + (p.x - bx) * bk) * CELL;
  const sy = oy + (H - (bcz + (p.z - bz) * bk) - p.d * bk) * CELL;
  const PW = Math.max(1, Math.round(p.w * bk * CELL)), PH = Math.max(1, Math.round(p.d * bk * CELL));
  rect(Math.round(sx), Math.round(sy), PW, PH, col);
  const e = col.map((v) => Math.max(0, v - 40));
  for (let i = 0; i < PW; i++) { put(Math.round(sx) + i, Math.round(sy), e); put(Math.round(sx) + i, Math.round(sy) + PH - 1, e); }
  for (let j = 0; j < PH; j++) { put(Math.round(sx), Math.round(sy) + j, e); put(Math.round(sx) + PW - 1, Math.round(sy) + j, e); }
}
writeFileSync(new URL(`../out/overlay-${id}-${fmt}.png`, import.meta.url), PNG.sync.write(png));
console.log(`out/overlay-${id}-${fmt}.png  art on top, bricks below, same stud grid (${W}x${H}), ${CELL}px a stud`);
