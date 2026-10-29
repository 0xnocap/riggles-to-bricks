// The QA sheet's brick panels: each build cropped to what it occupies, on the
// riggle's own background, so it frames the riggle the way the art's own crop
// does and the three can be read side by side.
//   npx tsx scripts/qa-sheet.mts 13,33,606 [out-dir]
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { riggleCurve } from '../src/riggle/curve';
import { buildRiggle } from '../src/riggle/build';
import { renderHex, COLOR_BY_ID } from '../src/core/palette';
import { typeLabel, parseHash } from '../src/riggle/engine.js';

const D = JSON.parse(readFileSync(new URL('../src/data/riggles.json', import.meta.url), 'utf8'));
const ids = (process.argv[2] ?? '13').split(',').map(Number);
const dir = process.argv[3] ?? new URL('../out/qa', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const CELL = 9, PAD = 2;
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

type Model = ReturnType<typeof buildRiggle>['model'];
const extentOf = (m: Model) => {
  let bx = Infinity, bz = Infinity, tx = 0, tz = 0;
  for (const p of m.pieces) if (p.role === 'squiggle') { bx = Math.min(bx, p.x); bz = Math.min(bz, p.z); }
  for (const p of m.pieces) if (p.role === 'squiggle') { tx = Math.max(tx, p.x + p.w - bx); tz = Math.max(tz, p.z + p.d - bz); }
  return { bx, bz, tx, tz };
};

const manifest: any[] = [];
for (const id of ids) {
  const hash = D.riggles[id].h;
  const c = riggleCurve({ id, hash });
  const field = hex(renderHex(c.panel));
  const models: [string, Model][] = [
    ['relief', buildRiggle(id, hash, { format: 'relief', display: 'frame', scale: 'large' }).model],
    ['mosaic', buildRiggle(id, hash, { format: 'mosaic', display: 'frame', scale: 'large' }).model],
  ];
  // the site's own rule, from where the format is chosen in src/main.ts
  const mosaicOnly = !!parseHash(hash).fuzzy || !!parseHash(hash).slinky || parseHash(hash).legendary === 'outline';
  // one frame for both, so the two builds are at one scale as well as the art
  const es = models.map(([, m]) => extentOf(m));
  const EW = Math.max(...es.map(e => e.tx)), EH = Math.max(...es.map(e => e.tz));

  for (const [name, m] of models) {
    const e = extentOf(m);
    const png = new PNG({ width: (EW + 2 * PAD) * CELL, height: (EH + 2 * PAD) * CELL });
    const put = (x: number, y: number, col: number[]) => { if (x < 0 || y < 0 || x >= png.width || y >= png.height) return; const i = (png.width * y + x) << 2; png.data[i] = col[0]; png.data[i+1] = col[1]; png.data[i+2] = col[2]; png.data[i+3] = 255; };
    const rect = (x: number, y: number, w: number, h: number, col: number[]) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, col); };
    rect(0, 0, png.width, png.height, field);
    const left = (PAD + (EW - e.tx) / 2) * CELL, top = (PAD + (EH - e.tz) / 2) * CELL;
    for (const p of [...m.pieces].sort((a, b) => a.y - b.y)) {
      if (p.role !== 'squiggle') continue;
      const col = hex(renderHex(p.c));
      const sx = Math.round(left + (p.x - e.bx) * CELL);
      const sy = Math.round(top + (e.tz - (p.z - e.bz) - p.d) * CELL);
      const PW = p.w * CELL, PH = p.d * CELL;
      rect(sx, sy, PW, PH, col);
      const edge = col.map(v => Math.max(0, v - 38));
      for (let i = 0; i < PW; i++) { put(sx + i, sy, edge); put(sx + i, sy + PH - 1, edge); }
      for (let j = 0; j < PH; j++) { put(sx, sy + j, edge); put(sx + PW - 1, sy + j, edge); }
    }
    if (name === 'relief' && mosaicOnly) continue;
    writeFileSync(`${dir}/${name}-${id}.png`, PNG.sync.write(png));
  }

  const t = parseHash(hash);
  manifest.push({
    id,
    type: typeLabel(t),
    intensity: t.intensity,
    legendary: t.legendary && t.legendary !== 'none' ? t.legendary : null,
    greyscale: !!c.greyscale,
    mosaicOnly,
    background: COLOR_BY_ID.get(c.panel)?.name,
    reliefPieces: mosaicOnly ? null : models[0][1].pieces.filter(p => p.role === 'squiggle').length,
    mosaicPieces: models[1][1].pieces.filter(p => p.role === 'squiggle').length,
  });
  console.log(`#${id}  ${typeLabel(t)} / ${t.intensity}${t.legendary && t.legendary !== 'none' ? ' / ' + t.legendary : ''}`);
}
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`\n${manifest.length} riggles -> ${dir}`);
