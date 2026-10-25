// Lab: Accordion rib stand-ins, side by side. Not part of the site.
//   npx tsx scripts/ribs-lab.mts 33
import { writeFileSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { buildMosaic } from '../src/squiggle/mosaic';
import { riggleCurve } from '../src/riggle/curve';
import { RIGGLE_GRID } from '../src/riggle/build';
import { WHITE, GREYS } from '../src/squiggle/spectrum';
import { renderHex, COLOR_BY_ID } from '../src/core/palette';
import { elementId } from '../src/core/lego';

const D = JSON.parse(readFileSync(new URL('../src/data/riggles.json', import.meta.url), 'utf8'));
const CELL = 9;
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const id = Number(process.argv[2] ?? 33);
const curve = riggleCurve({ id, hash: D.riggles[id].h });

const OPTS: [string, any][] = [
  ['A  none', undefined],
  ['B  lighter shade, every 3', { pitch: 3, colour: 'light' }],
  ['C  lighter shade, every 4', { pitch: 4, colour: 'light' }],
  ['D  lighter shade, every 5', { pitch: 5, colour: 'light' }],
  ['E  white, every 4', { pitch: 4, colour: WHITE }],
  ['F  light grey, every 4', { pitch: 4, colour: GREYS[1] }],
];

const models = OPTS.map(([label, ribs]) => ({
  label,
  m: buildMosaic(curve, 'large', { id, hash: curve.hash }, RIGGLE_GRID.large, { square: true, ribs }),
}));

let X = 0, Z = 0;
for (const p of models[0].m.pieces) { X = Math.max(X, p.x + p.w); Z = Math.max(Z, p.z + p.d); }
const w = X * CELL, h = Z * CELL, gap = 14;
const cols = 2, rows = Math.ceil(models.length / cols);
const png = new PNG({ width: w * cols + gap * (cols - 1), height: h * rows + gap * (rows - 1) });
const put = (x: number, y: number, c: number[]) => { if (x < 0 || y < 0 || x >= png.width || y >= png.height) return; const i = (png.width * y + x) << 2; png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; png.data[i + 3] = 255; };
const rect = (x: number, y: number, ww: number, hh: number, c: number[]) => { for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) put(x + i, y + j, c); };
rect(0, 0, png.width, png.height, [16, 16, 18]);

models.forEach(({ label, m }, n) => {
  const ox = (n % cols) * (w + gap), oy = Math.floor(n / cols) * (h + gap);
  for (const p of [...m.pieces].sort((a, b) => a.y - b.y)) {
    const sx = ox + p.x * CELL, sy = oy + (Z - p.z - p.d) * CELL, c = hex(renderHex(p.c));
    rect(sx, sy, p.w * CELL, p.d * CELL, c);
    const e = c.map((v) => Math.max(0, v - 42));
    for (let i = 0; i < p.w * CELL; i++) { put(sx + i, sy, e); put(sx + i, sy + p.d * CELL - 1, e); }
    for (let j = 0; j < p.d * CELL; j++) { put(sx, sy + j, e); put(sx + p.w * CELL - 1, sy + j, e); }
  }
  const missing = m.bom.filter((l: any) => !elementId(l.part, l.color));
  const names = [...new Set(missing.map((l: any) => COLOR_BY_ID.get(l.color)?.name))];
  console.log(`${label.padEnd(28)} ${String(m.pieces.length).padStart(4)} pieces, ${String(m.bom.length).padStart(3)} lots, $${m.cost}${missing.length ? `  CANNOT ORDER ${missing.length} lots (${names.join(', ')})` : '  all lots orderable'}`);
});
const out = new URL(`../out/ribs-${id}.png`, import.meta.url);
writeFileSync(out, PNG.sync.write(png));
console.log(`\nout/ribs-${id}.png   layout: A B / C D / E F`);
