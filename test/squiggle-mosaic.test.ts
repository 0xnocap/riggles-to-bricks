import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { elementId } from '../src/core/lego';
import type { Piece } from '../src/core/parts';
import { readCurve, type Curve } from '../src/squiggle/curve';
import { buildMosaic, MOSAIC_GRID } from '../src/squiggle/mosaic';
import { BLACK, SPECTRUM } from '../src/squiggle/spectrum';

const DIR = 'test/fixtures/squiggles';
// every fixture: the brief's 11 and the ones added since (#442 Bold HyperRainbow...)
const IDS = readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => +f.slice(0, -5)).sort((a, b) => a - b);
const fixture = (id: number) => JSON.parse(readFileSync(`${DIR}/${id}.json`, 'utf8'));
const INITIAL: Record<number, string> = { 5: 'R', 4: 'O', 3: 'Y', 34: 'L', 36: 'G', 39: 'T', 153: 'A', 7: 'B', 89: 'P', 71: 'M', 47: 'K', 1: 'W', [BLACK]: '.' };

/** the top tile over each cell, index x + z·W */
function topGrid(pieces: Piece[], W: number, H: number) {
  const own = new Int32Array(W * H).fill(-1);
  let overlaps = 0;
  pieces.forEach((p, i) => { if (p.kind === 'tile') for (let a = 0; a < p.w; a++) for (let b = 0; b < p.d; b++) { const k = p.x + a + (p.z + b) * W; if (own[k] >= 0) overlaps++; own[k] = i; } });
  return { own, overlaps };
}
/** the seams between two base plates crossed by one tile along less than half their length */
function weakSeams(pieces: Piece[], own: Int32Array, W: number) {
  const plates = pieces.filter(p => p.kind === 'plate'), out: string[] = [];
  for (const a of plates) for (const b of plates) {
    if (b.x === a.x + a.w) {
      const z0 = Math.max(a.z, b.z), z1 = Math.min(a.z + a.d, b.z + b.d);
      let n = 0; for (let z = z0; z < z1; z++) if (own[b.x - 1 + z * W] === own[b.x + z * W]) n++;
      if (z1 > z0 && n * 2 < z1 - z0) out.push(`seam x=${b.x} z=${z0}..${z1}: ${n}/${z1 - z0}`);
    }
    if (b.z === a.z + a.d) {
      const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
      let n = 0; for (let x = x0; x < x1; x++) if (own[x + (b.z - 1) * W] === own[x + b.z * W]) n++;
      if (x1 > x0 && n * 2 < x1 - x0) out.push(`seam z=${b.z} x=${x0}..${x1}: ${n}/${x1 - x0}`);
    }
  }
  return out;
}

/** the brief's budget per builder (Node, laptop). Other jobs may share the machine: the best of up to 3 runs, within
 *  twice the budget (scripts/perf-squiggle.cjs times the builders on a throttled phone) */
const BUDGET = 1500;
function timed<T>(f: () => T) {
  let r: T | undefined, ms = Infinity;
  for (let i = 0; i < 3 && ms >= BUDGET; i++) { const t0 = performance.now(), x = f(), t = performance.now() - t0; r ??= x; ms = Math.min(ms, t); }
  return { r: r!, ms };
}
describe('mosaic', () => {
  for (const scale of ['small', 'large'] as const) for (const id of IDS) {
    it(`${scale}: #${id}`, () => {
      const f = fixture(id), curve = readCurve(f);
      const { r: m, ms } = timed(() => buildMosaic(curve, scale, { id: f.id, hash: f.hash }));
      expect(ms).toBeLessThan(2 * BUDGET);
      const [W, H] = MOSAIC_GRID[scale];
      expect(m).toMatchObject({ id, format: 'mosaic', display: null, scale, pose: 'table' });
      expect(m.checks.collisions).toBe(0);
      expect(m.checks.floating).toBe(0);
      for (const r of m.checks.rules) expect(r.ok, `${r.name}: ${r.detail}`).toBe(true);
      expect([...m.notes, ...Object.values(m.stepNotes), ...m.checks.rules.map(r => r.detail ?? '')].filter(w => /'|\d x \d|\s1 studs\b/.test(w))).toEqual([]);

      // black plates at y 0, one layer of tiles at y 1 over every cell, nothing else
      const plates = m.pieces.filter(p => p.kind === 'plate'), tiles = m.pieces.filter(p => p.kind === 'tile');
      expect(plates.length + tiles.length).toBe(m.pieces.length);
      expect(plates.every(p => p.y === 0 && p.h === 1 && p.c === BLACK && p.role === 'display')).toBe(true);
      expect(plates.reduce((n, p) => n + p.w * p.d, 0)).toBe(W * H);
      expect(plates.every(p => p.x >= 0 && p.z >= 0 && p.x + p.w <= W && p.z + p.d <= H)).toBe(true);
      expect(tiles.every(p => p.y === 1 && p.h === 1)).toBe(true);
      const { own, overlaps } = topGrid(m.pieces, W, H);
      expect(overlaps).toBe(0);
      expect(own.every(i => i >= 0)).toBe(true);
      // roles: coloured tiles are the Squiggle, the rest is the display
      expect(m.pieces.every(p => p.role === (p.kind === 'tile' && p.c !== BLACK ? 'squiggle' : 'display'))).toBe(true);
      expect(m.nameplate?.lines[0]).toBe(`Chromie Squiggle #${id}`);
      expect(m.pieces[m.nameplate!.piece]).toMatchObject({ kind: 'tile', w: 6, d: 2, c: BLACK, nameplate: true });

      // steps: every piece once, the plates first, then the tiles band by band from the front
      expect(m.steps.flat().sort((a, b) => a - b)).toEqual(m.pieces.map((_, i) => i));
      expect(m.steps.every(s => s.length > 0)).toBe(true);
      expect(m.steps[0].every(i => m.pieces[i].kind === 'plate')).toBe(true);
      expect(m.steps.slice(1).flat().every(i => m.pieces[i].kind === 'tile')).toBe(true);
      const firstRow = m.steps.slice(1, -1).map(s => Math.min(...s.map(i => m.pieces[i].z)));
      expect(firstRow).toEqual([...firstRow].sort((a, b) => a - b));

      // every seam between two base plates is crossed by one tile along at least half its length
      expect(weakSeams(m.pieces, own, W)).toEqual([]);
      // margins: 2 black studs all round
      for (let x = 0; x < W; x++) for (let z = 0; z < H; z++)
        if (x < 2 || z < 2 || x >= W - 2 || z >= H - 2) expect(m.pieces[own[x + z * W]].c).toBe(BLACK);

      // no 1×1 in line with a tile of its colour (a longer tile would fit there)
      for (const p of tiles) if (p.w * p.d === 1) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = p.x + dx, z = p.z + dz;
        if (x < 0 || z < 0 || x >= W || z >= H) continue;
        const q = m.pieces[own[x + z * W]];
        if (q.c === p.c && !q.nameplate) expect(dx ? q.d : q.w, `1×1 at ${p.x},${p.z}`).not.toBe(1);
      }
      // every part is sold by LEGO, or the notes say it is not
      for (const l of m.bom) if (!elementId(l.part, l.color)) expect(m.notes.join(' ')).toContain(`${l.name} ${l.colorName}`);
      expect(m.subtotals.squiggle.pieces + m.subtotals.display.pieces).toBe(m.pieces.length);
    });
  }

  // HyperRainbow Bold: 2-stud colour bands across seams that meet at a corner, where recolouring
  // a cell for one seam used to unbridge the other (they took turns and one stayed at 7/16)
  it('#442 mirrored and stretched: every seam bridged', () => {
    const f = fixture(442), c0 = readCurve(f);
    for (const [sx, sy] of [[1, 1], [-1, -1], [1, 1.35], [-1, 1.35]]) for (const scale of ['small', 'large'] as const) {
      const points = c0.points.map(p => ({ ...p, x: p.x * sx, y: p.y * sy })), xs = points.map(p => p.x), ys = points.map(p => p.y);
      const curve: Curve = { ...c0, points, box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } };
      const m = buildMosaic(curve, scale, { id: f.id, hash: f.hash }), [W] = MOSAIC_GRID[scale];
      expect(weakSeams(m.pieces, topGrid(m.pieces, W, MOSAIC_GRID[scale][1]).own, W), `x·${sx} y·${sy} ${scale}`).toEqual([]);
      expect(m.checks.rules.every(r => r.ok) && m.checks.collisions + m.checks.floating === 0).toBe(true);
    }
  });

  // the end cap the original draws over everything: Ribbed #10 ends on a black rib disc after a solid black
  // hook (no orange anywhere), Pipe #3784 on a filled Dark Turquoise dot (hue 164) the line colours lag behind
  it('end caps: #10 black tail, #3784 turquoise end dot', () => {
    for (const scale of ['small', 'large'] as const) for (const [id, want] of [[10, BLACK], [3784, 39]]) {
      const f = fixture(id), curve = readCurve(f), m = buildMosaic(curve, scale, { id: f.id, hash: f.hash });
      const [W, H] = MOSAIC_GRID[scale], { own } = topGrid(m.pieces, W, H), { box, stroke, points } = curve;
      const k = Math.min((W - 4) / (box.x1 - box.x0 + stroke), (H - 4) / (box.y1 - box.y0 + stroke));
      const at = (i: number) => m.pieces[own[Math.floor(W / 2 + (points[i].x - (box.x0 + box.x1) / 2) * k) + Math.floor(H / 2 + ((box.y0 + box.y1) / 2 - points[i].y) * k) * W]].c;
      const end = id === 3784 ? points.map(p => !!p.end).lastIndexOf(true) : points.length - 1;
      expect(at(end), `#${id} ${scale}`).toBe(want);
      if (id === 10) expect(m.colors[4], `#10 ${scale}: orange`).toBeUndefined();
    }
  });

  // Ribbed #10: rows of ribs across every horizontal seam; the plates are laid (columns shifted, rows
  // staggered) where the tiles bridge them with few ribs recoloured (it used to take 7 small, 20 large)
  it('#10 seams bridged with few ribs recoloured', () => {
    const f = fixture(10), curve = readCurve(f);
    for (const [scale, most] of [['small', 2], ['large', 12]] as const) {
      const m = buildMosaic(curve, scale, { id: f.id, hash: f.hash });
      const n = +(m.notes.join(' ').match(/(\d+) cells? along base plate seams recoloured/)?.[1] ?? 0);
      expect(n, scale).toBeLessThanOrEqual(most);
      expect(m.checks.rules.every(r => r.ok)).toBe(true);
    }
  });

  // 1×1 tiles a re-cut of the tiles of their colour around them avoids (1×1 allowed there, but fewer), seams still bridged
  it('re-cuts avoidable 1×1 tiles (#255, #442, #1012, #5449)', () => {
    const cases: [number, 'small' | 'large', [number, number][]][] = [[255, 'large', [[41, 11], [41, 13]]], [442, 'large', [[56, 6], [56, 8]]],
      [1012, 'small', [[32, 7], [34, 7], [42, 23], [27, 24], [29, 24]]], [5449, 'large', [[25, 12], [25, 14]]]];
    for (const [id, scale, cells] of cases) {
      const f = fixture(id), m = buildMosaic(readCurve(f), scale, { id: f.id, hash: f.hash }), [W, H] = MOSAIC_GRID[scale], { own } = topGrid(m.pieces, W, H);
      for (const [x, z] of cells) expect(m.pieces[own[x + z * W]].w * m.pieces[own[x + z * W]].d, `#${id} ${scale} ${x},${z}`).toBeGreaterThan(1);
      expect(weakSeams(m.pieces, own, W)).toEqual([]);
    }
  });

  it('#1234 large reads as the Squiggle', () => {
    const f = fixture(1234), curve = readCurve(f), m = buildMosaic(curve, 'large', { id: f.id, hash: f.hash });
    const [W, H] = MOSAIC_GRID.large, { own } = topGrid(m.pieces, W, H);
    const col = (x: number, z: number) => m.pieces[own[x + z * W]].c;
    // the centre line in studs, with the fit the mosaic uses (≥ 2 studs margin, centred)
    const { box, stroke } = curve;
    const k = Math.min((W - 4) / (box.x1 - box.x0 + stroke), (H - 4) / (box.y1 - box.y0 + stroke));
    const line = curve.points.map(p => [W / 2 + (p.x - (box.x0 + box.x1) / 2) * k, H / 2 + ((box.y0 + box.y1) / 2 - p.y) * k]);
    const onLine = new Set(line.map(([x, z]) => Math.floor(x) + Math.floor(z) * W));

    // preview: colour initials, top of the picture first; cells on the centre line in lower case
    const rows: string[] = [];
    for (let z = H - 1; z >= 0; z--) rows.push(Array.from({ length: W }, (_, x) => {
      const ch = INITIAL[col(x, z)];
      return onLine.has(x + z * W) ? ch.toLowerCase() : ch;
    }).join(''));
    console.log(`#1234 large, ${W}×${H} (lower case: the centre line)\n${rows.join('\n')}`);

    // every point of the centre line is on a coloured cell, every coloured cell is under the stroke
    expect(line.every(([x, z]) => col(Math.floor(x), Math.floor(z)) !== BLACK)).toBe(true);
    const r = stroke * k / 2;
    for (let x = 0; x < W; x++) for (let z = 0; z < H; z++) if (col(x, z) !== BLACK)
      expect(line.some(([px, pz]) => (px - x - 0.5) ** 2 + (pz - z - 0.5) ** 2 <= r * r), `${x},${z}`).toBe(true);
    // spectrum order along the curve: yellow at the start (left), then lime, green... blue at the end (right)
    const ids = SPECTRUM.map(s => s.id);
    const meanX = (c: number) => { let s = 0, n = 0; for (let x = 0; x < W; x++) for (let z = 0; z < H; z++) if (col(x, z) === c) { s += x; n++; } return s / n; };
    const used = ids.filter(c => m.colors[c]);
    expect(used.map(c => INITIAL[c]).join('')).toBe('YLGTAB');
    expect(used.map(meanX)).toEqual([...used.map(meanX)].sort((a, b) => a - b));
  });
});
