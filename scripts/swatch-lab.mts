// Lab: every colour the collection's art actually paints, next to the brick it
// is built in. Top half of each cell is the art, bottom half the brick; one
// band per Intensity, hue rising left to right.
//   npx tsx scripts/swatch-lab.mts
import { writeFileSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { riggleCurve } from '../src/riggle/curve';
import { brickFor, hslRgb, type Tone } from '../src/squiggle/spectrum';
import { COLOR_BY_ID, renderHex } from '../src/core/palette';

const D = JSON.parse(readFileSync(new URL('../src/data/riggles.json', import.meta.url), 'utf8'));
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// what the collection paints, by tone: hue, and the saturation and lightness
// the engine gives that tone
type Band = { tone: Tone; name: string; by: Map<number, { h: number; s: number; l: number }> };
const bands: Band[] = [
  { tone: null, name: 'Neon', by: new Map() },
  { tone: 'pastel', name: 'Pastel', by: new Map() },
  { tone: 'deep', name: 'Deep', by: new Map() },
];
for (const id of Object.keys(D.riggles).map(Number)) {
  const c = riggleCurve({ id, hash: D.riggles[id].h });
  if (c.greyscale || !c.light) continue;
  const band = bands.find(b => b.tone === (c.tone ?? null))!;
  for (let i = 0; i < c.points.length; i += 53) {
    const h = Math.round(c.points[i].hue / 6) * 6;
    if (!band.by.has(h)) band.by.set(h, { h, s: c.sat ?? 100, l: c.light[i] });
  }
}

const CELL = 26, GAP = 2, LABEL = 70, ROW = CELL + GAP;
const COLS = Math.max(...bands.map(b => b.by.size));
const W = LABEL + COLS * ROW, H = bands.length * (ROW + 10) + 6;
const png = new PNG({ width: W, height: H });
const put = (x: number, y: number, c: number[]) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (W * y + x) << 2; png.data[i] = c[0]; png.data[i+1] = c[1]; png.data[i+2] = c[2]; png.data[i+3] = 255; };
const rect = (x: number, y: number, w: number, h: number, c: number[]) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c); };
rect(0, 0, W, H, [18, 18, 20]);

bands.forEach((band, bi) => {
  const y = 6 + bi * (ROW + 10);
  const cols = [...band.by.values()].sort((a, b) => a.h - b.h);
  cols.forEach((c, i) => {
    const x = LABEL + i * ROW;
    rect(x, y, CELL, CELL / 2, hslRgb(c.h, c.s, c.l));
    rect(x, y + CELL / 2, CELL, CELL / 2, hex(renderHex(brickFor(c.h, band.tone))));
  });
  console.log(`${band.name.padEnd(7)} ${cols.length} hues: ` +
    [...new Set(cols.map(c => COLOR_BY_ID.get(brickFor(c.h, band.tone))?.name))].join(', '));
});
writeFileSync(new URL('../out/swatches.png', import.meta.url), PNG.sync.write(png));
console.log('\nart above brick, one band per Intensity -> out/swatches.png');
