import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { checkModel, studsBelow } from '../src/core/check';
import { elementId } from '../src/core/lego';
import { partId, type Piece } from '../src/core/parts';
import { key, kx, kz } from '../src/core/tile';
import { readCurve } from '../src/squiggle/curve';
import { buildRibbon, endCap, RIBBON_PANEL, RIBBON_WIDTH, type Ribbon } from '../src/squiggle/ribbon';
import { BLACK, SPECTRUM, SQUIGGLE_COLORS, WHITE } from '../src/squiggle/spectrum';

const DIR = 'test/fixtures/squiggles';
// the 11 of the brief and the extra ones (Bold, Ribbed HyperRainbow, Pipe, Fuzzy with many segments)
const IDS = readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => +f.slice(0, -5)).sort((a, b) => a - b);
const fixture = (id: number) => JSON.parse(readFileSync(`${DIR}/${id}.json`, 'utf8'));
const SCALES = ['small', 'large'] as const;
const built = new Map<string, Ribbon>();
/** the smooth look, built once per fixture and scale for the shape tests (the studded look has the same cells) */
const ribbon = (id: number, scale: 'small' | 'large') => {
  if (!built.has(`${id}${scale}`)) built.set(`${id}${scale}`, buildRibbon(readCurve(fixture(id)), scale));
  return built.get(`${id}${scale}`)!;
};
const N4 = (c: number) => [c + 1024, c - 1024, c + 1, c - 1];

/** a full panel of white 8×8 plates under the ribbon (Frame), the ribbon one plate up */
function onPanel(pieces: Piece[], w: number, h: number) {
  const panel: Piece[] = [];
  for (let x = 0; x < w; x += 8) for (let z = 0; z < h; z += 8) panel.push({ x, z, y: 0, h: 1, w: 8, d: 8, c: WHITE, kind: 'plate', part: partId('plate', 8, 8), role: 'display' });
  return { panel, all: [...panel, ...pieces.map(p => ({ ...p, y: p.y + 1 }))] };
}

/** the brief's budget per builder (Node, laptop). Other jobs may share the machine: the best of up to 3 runs, within
 *  twice the budget (scripts/perf-squiggle.cjs times the builders on a throttled phone) */
const BUDGET = 1500;
function timed<T>(f: () => T) {
  let r: T | undefined, ms = Infinity;
  for (let i = 0; i < 3 && ms >= BUDGET; i++) { const t0 = performance.now(), x = f(), t = performance.now() - t0; r ??= x; ms = Math.min(ms, t); }
  return { r: r!, ms };
}
const summary: string[] = [];
afterAll(() => { if (summary.length) console.log(`ribbon: pieces, cells, max stack (slabs), recoloured, ms\n${summary.join('\n')}`); });

describe('ribbon', () => {
  for (const scale of ['small', 'large'] as const) for (const id of IDS) for (const studs of [false, true]) {
    it(`${scale}${studs ? ', studs' : ''}: #${id}`, () => {
      const curve = readCurve(fixture(id));
      const { r, ms } = timed(() => buildRibbon(curve, scale, { studs }));
      expect(ms).toBeLessThan(2 * BUDGET);
      const { w: W, h: H } = RIBBON_PANEL[scale];
      expect(r.panel).toEqual({ w: W, h: H });
      expect(r.width).toBe(RIBBON_WIDTH[curve.type]);

      // fit: ≥ 4 studs left and right, ≥ 1 top and bottom; on the small panel a Normal stroke is at most 3 studs
      expect(r.bounds.x0).toBeGreaterThanOrEqual(4);
      expect(r.bounds.x1).toBeLessThanOrEqual(W - 4);
      expect(r.bounds.z0).toBeGreaterThanOrEqual(1);
      expect(r.bounds.z1).toBeLessThanOrEqual(H - 1);
      if (scale === 'small') expect(r.k * curve.canvas.h / 13).toBeLessThanOrEqual(3 + 1e-9);
      expect(r.pieces.filter(p => p.x < r.bounds.x0 || p.z < r.bounds.z0 || p.x + p.w > r.bounds.x1 || p.z + p.d > r.bounds.z1)).toEqual([]);
      expect(Math.min(...r.pieces.map(p => p.y))).toBe(0);

      // parts: no 1×1, one plate thick, the Squiggle's colours, all sold by LEGO
      expect(r.pieces.filter(p => p.w * p.d < 2)).toEqual([]);
      expect(r.pieces.filter(p => p.h !== 1 || (p.kind !== 'plate' && p.kind !== 'tile'))).toEqual([]);
      expect(r.pieces.every(p => p.role === 'squiggle' && SQUIGGLE_COLORS.includes(p.c))).toBe(true);
      expect(r.pieces.filter(p => !elementId(p.part, p.c)).map(p => `${p.part}/${p.c}`)).toEqual([]);

      // slabs: every footprint cell is `stack` slabs of plate, plate, top; the top is a tile (or a plate
      // with studs), anything under something is a plate
      const at = new Map<string, Piece>();
      for (const p of r.pieces) for (let a = 0; a < p.w; a++) for (let b = 0; b < p.d; b++) at.set(`${p.x + a},${p.z + b},${p.y}`, p);
      expect(at.size).toBe(r.pieces.reduce((n, p) => n + p.w * p.d, 0));
      const bad: string[] = [];
      for (const c of r.cells) {
        const n = r.stack.get(c)!, x = kx(c), z = kz(c);
        for (let y = 0; y < 3 * n; y++) {
          const p = at.get(`${x},${z},${y}`);
          if (!p || p.kind !== (y === 3 * n - 1 && !studs ? 'tile' : 'plate')) bad.push(`${x},${z},${y}`);
        }
        if (at.has(`${x},${z},${3 * n}`)) bad.push(`${x},${z} above`);
      }
      expect(bad).toEqual([]);
      expect(at.size).toBe(r.cells.reduce((s, c) => s + 3 * r.stack.get(c)!, 0));
      expect(r.maxStack).toBe(Math.max(...r.stack.values()));
      expect(r.bottom).toEqual(r.cells);
      expect(r.cells).toContain(r.ends[0]);
      expect(r.cells).toContain(r.ends[1]);

      // on a full panel (Frame): no collision, nothing floating, every stud of every piece held from below
      const { panel, all } = onPanel(r.pieces, W, H);
      const ch = checkModel(all, { root: (_, i) => i < panel.length });
      expect(ch.collisions).toBe(0);
      expect(ch.floating).toBe(0);
      const below = studsBelow(all).slice(panel.length);
      expect(Math.min(...below)).toBeGreaterThanOrEqual(2);
      expect(r.pieces.filter((p, i) => below[i] !== p.w * p.d)).toEqual([]);
      // on its own (Floating, Backdrop): one body, no piece held by a single stud
      const alone = checkModel(r.pieces, { root: (_, i) => i === 0 });
      expect(alone.floating).toBe(0);
      expect(alone.weak).toBe(0);

      // centre line and colours, placed with k and the offsets
      expect(r.line.length).toBe(curve.points.length);
      expect(r.colors.length).toBe(curve.points.length);
      const i = curve.points.length >> 1;
      expect(r.line[i].x).toBeCloseTo(r.offset.x + (curve.points[i].x - curve.box.x0) * r.k, 9);
      expect(r.line[i].z).toBeCloseTo(r.offset.z + (curve.box.y1 - curve.points[i].y) * r.k, 9);
      expect(r.line.every((p, j) => j === 0 ? p.s === 0 : p.s >= r.line[j - 1].s)).toBe(true);
      // Pipe edges are black, Ribbed ribs black (white when the ribs are light grey)
      const edge = curve.type === 'Ribbed' && (curve.ribGray ?? 0) >= 128 ? WHITE : BLACK;
      if (curve.type === 'Pipe' || curve.type === 'Ribbed') expect(r.pieces.some(p => p.kind === (studs ? 'plate' : 'tile') && p.c === edge)).toBe(true);

      summary.push(`${scale.padEnd(5)} ${studs ? 'studs' : 'tiles'} #${String(id).padEnd(4)} ${curve.type.padEnd(6)} ${String(r.pieces.length).padStart(4)} ${String(r.cells.length).padStart(4)}  ${r.maxStack}  ${String(r.recoloured).padStart(3)}  ${ms.toFixed(0).padStart(4)}`);
    });
  }

  it('steps up where the line crosses itself, the later pass on top', () => {
    const r = buildRibbon(readCurve(fixture(0)), 'small');
    expect(r.maxStack).toBeGreaterThanOrEqual(2);
    expect(r.notes.join(' ')).toMatch(/steps up/);
  });

  it('is the same ribbon every time (the three displays share it)', () => {
    const c = readCurve(fixture(1234));
    expect(JSON.stringify(buildRibbon(c, 'large').pieces)).toBe(JSON.stringify(buildRibbon(c, 'large').pieces));
  });

  it('keeps the same shape with studs or tiles on top', () => {
    for (const id of IDS) for (const scale of SCALES) {
      const a = ribbon(id, scale), b = buildRibbon(readCurve(fixture(id)), scale, { studs: true });
      expect(b.cells, `#${id} ${scale}`).toEqual(a.cells);
      expect([...b.stack], `#${id} ${scale}`).toEqual([...a.stack]);
    }
  }, 60000);

  it('has no hole and never trims the centre line off', () => {
    for (const id of IDS) for (const scale of SCALES) {
      const r = ribbon(id, scale), fp = new Set(r.cells), { x0, z0, x1, z1 } = r.bounds;
      // empty cells of the box reached from outside it; any other empty cell is a hole through the ribbon
      const out = new Set<number>(), st: number[] = [];
      const go = (x: number, z: number) => {
        const c = key(x, z);
        if (x >= x0 - 1 && x <= x1 && z >= z0 - 1 && z <= z1 && !fp.has(c) && !out.has(c)) { out.add(c); st.push(c); }
      };
      for (let x = x0 - 1; x <= x1; x++) { go(x, z0 - 1); go(x, z1); }
      for (let z = z0 - 1; z <= z1; z++) { go(x0 - 1, z); go(x1, z); }
      while (st.length) { const c = st.pop()!; go(kx(c) + 1, kz(c)); go(kx(c) - 1, kz(c)); go(kx(c), kz(c) + 1); go(kx(c), kz(c) - 1); }
      const holes: string[] = [];
      for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) if (!fp.has(key(x, z)) && !out.has(key(x, z))) holes.push(`${x},${z}`);
      expect(holes, `#${id} ${scale}`).toEqual([]);
      const cut = [...new Set(r.line.map(p => key(Math.floor(p.x), Math.floor(p.z))))].filter(c => !fp.has(c)).map(c => `${kx(c)},${kz(c)}`);
      expect(cut, `#${id} ${scale}: centre line cells`).toEqual([]);
    }
  }, 60000);

  it('raises whole stretches of the stroke, never a patch of a few cells', () => {
    for (const id of IDS) for (const scale of SCALES) {
      const r = ribbon(id, scale), h = (c: number) => r.stack.get(c) ?? 0, patches: string[] = [];
      for (let L = 1; L < r.maxStack; L++) {
        const seen = new Set<number>();
        for (const c of r.cells) {
          if (h(c) <= L || seen.has(c)) continue;
          const comp = [c];
          seen.add(c);
          for (let i = 0; i < comp.length; i++) for (const n of N4(comp[i])) if (h(n) > L && !seen.has(n)) { seen.add(n); comp.push(n); }
          if (comp.length < 9) patches.push(`${kx(c)},${kz(c)}: ${comp.length} cells at slab ${L + 1}`);
        }
      }
      expect(patches, `#${id} ${scale}`).toEqual([]);
      expect(r.maxStack, `#${id} ${scale}`).toBeLessThanOrEqual(3);
    }
  }, 60000);

  it('draws the Squiggle as large as the margins allow (4 studs left and right, 1 top and bottom)', () => {
    for (const id of IDS) for (const scale of SCALES) {
      const r = ribbon(id, scale), c = readCurve(fixture(id)), { w: W, h: H } = r.panel, { x0, y0, x1, y1 } = c.box;
      const k = Math.min((W - 8 - r.width) / (x1 - x0), (H - 2 - r.width) / (y1 - y0), scale === 'small' ? 3 / (c.canvas.h / 13) : Infinity);
      expect(r.k, `#${id} ${scale}`).toBeCloseTo(k, 12);
    }
  });

  it('ends in the end dot colour: the black rib disc of Ribbed #10, the aqua cap of Pipe #3784', () => {
    for (const [id, col] of [[10, BLACK], [3784, 39]] as const) for (const scale of SCALES) {
      const r = ribbon(id, scale), end = r.line[r.line.length - 1], x = Math.floor(end.x), z = Math.floor(end.z);
      const top = r.pieces.filter(p => p.x <= x && x < p.x + p.w && p.z <= z && z < p.z + p.d).sort((a, b) => b.y - a.y)[0];
      expect(top.c, `#${id} ${scale}`).toBe(col);
      expect(r.colors[r.colors.length - 1]).toBe(col);
    }
    expect(endCap(readCurve(fixture(0)), [5, 5], 100)).toEqual([5, 5]);
  });

  it('steps along the spectrum one colour at a time, into the end cap too (HyperRainbow Pipe #3784)', () => {
    const at = new Map(SPECTRUM.map((s, i) => [s.id, i])), N = SPECTRUM.length;
    for (const id of IDS) for (const scale of SCALES) {
      const r = ribbon(id, scale), jumps: string[] = [];
      for (let i = 1; i < r.colors.length; i++) {
        const p = at.get(r.colors[i - 1]), q = at.get(r.colors[i]);
        if (p !== undefined && q !== undefined && Math.min(Math.abs(p - q), N - Math.abs(p - q)) > 1) jumps.push(`${r.line[i].s.toFixed(1)}: ${p} → ${q}`);
      }
      expect(jumps, `#${id} ${scale}`).toEqual([]);
    }
  });

  it('shows every colour run on top along its stretch of line, beside ribs and at tight turns', () => {
    // stretches where a colour used to vanish: under a rib (#255), recoloured away at a turn (#452), in the end cap (#3784)
    const cases: [number, 'small' | 'large', number, number][] = [[255, 'large', 12, 20], [255, 'large', 76, 84], [452, 'small', 8, 12], [452, 'small', 77, 82],
      [452, 'large', 13, 18], [3784, 'small', 36, 44], [3784, 'large', 58, 67]];
    for (const [id, scale, s0, s1] of cases) {
      const r = ribbon(id, scale), top = new Map<number, Piece>(), lost: string[] = [];
      for (const p of r.pieces) for (let a = 0; a < p.w; a++) for (let b = 0; b < p.d; b++) { const c = key(p.x + a, p.z + b); if ((top.get(c)?.y ?? -1) < p.y) top.set(c, p); }
      for (let m = 0; m < r.line.length;) {
        let e = m;
        while (e + 1 < r.line.length && r.colors[e + 1] === r.colors[m]) e++;
        const R = r.width / 2 + 1, col = r.colors[m], near = (p: { x: number; z: number }) => {
          for (let x = Math.floor(p.x - R); x <= p.x + R; x++) for (let z = Math.floor(p.z - R); z <= p.z + R; z++)
            if (Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z) <= R && top.get(key(x, z))?.c === col) return true;
          return false;
        };
        if (r.line[e].s >= s0 && r.line[m].s <= s1 && !r.line.slice(m, e + 1).some(near)) lost.push(`${col} at s ${r.line[m].s.toFixed(1)}–${r.line[e].s.toFixed(1)}`);
        m = e + 1;
      }
      expect(lost, `#${id} ${scale} s ${s0}–${s1}`).toEqual([]);
    }
  });

  it('never shows a colour on the centre line more than a step from the line\'s there (a recoloured cell would skip one)', () => {
    // #624 small: a lone cell used to take a neighbour's Dark Azure among Magenta and Dark Purple, another Dark Pink among Yellow
    const at = new Map(SPECTRUM.map((s, i) => [s.id, i])), N = SPECTRUM.length;
    const gap = (a: number, b: number) => { const d = Math.abs(at.get(a)! - at.get(b)!); return Math.min(d, N - d); };
    for (const id of IDS) for (const scale of SCALES) {
      const r = ribbon(id, scale), top = new Map<number, Piece>(), pts: { x: number; z: number; c: number }[] = [], bad: string[] = [];
      for (const p of r.pieces) for (let a = 0; a < p.w; a++) for (let b = 0; b < p.d; b++) { const c = key(p.x + a, p.z + b); if ((top.get(c)?.y ?? -1) < p.y) top.set(c, p); }
      r.line.forEach((a, i) => {
        const b = r.line[i + 1] ?? a, n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25));
        for (let j = 0; j < n; j++) pts.push({ x: a.x + ((b.x - a.x) * j) / n, z: a.z + ((b.z - a.z) * j) / n, c: r.colors[2 * j < n ? i : Math.min(i + 1, r.line.length - 1)] });
      });
      for (const c of new Set(pts.map(p => key(Math.floor(p.x), Math.floor(p.z))))) {
        const col = top.get(c)?.c;
        if (col === undefined || !at.has(col)) continue;
        const near = pts.filter(p => Math.hypot(p.x - kx(c) - 0.5, p.z - kz(c) - 0.5) <= r.width / 2).map(p => p.c);
        if (near.every(l => at.has(l) && gap(col, l) > 1)) bad.push(`${kx(c)},${kz(c)}`);
      }
      expect(bad, `#${id} ${scale}`).toEqual([]);
    }
  }, 60000);

  it('says when a Squiggle is too dense for the small Frame', () => {
    expect(ribbon(0, 'small').dense).toBe(true);
    expect(ribbon(0, 'small').notes.join(' ')).toMatch(/Dense Squiggle.*Large size/);
    expect(ribbon(0, 'large').notes.join(' ')).not.toMatch(/Dense/);
    // the notes go with every display: nothing about the Frame's panel
    for (const id of IDS) expect(ribbon(id, 'small').notes.join(' '), `#${id}`).not.toMatch(/panel|frame/i);
    // typographic apostrophes, like the page
    for (const id of IDS) for (const scale of ['small', 'large'] as const) expect(ribbon(id, scale).notes.join(' '), `#${id} ${scale}`).not.toMatch(/'/);
    expect(ribbon(1234, 'large').notes.join(' ')).toMatch(/recoloured to a neighbour’s colour/);
    expect(ribbon(3784, 'small').dense).toBe(false);
  });
});
