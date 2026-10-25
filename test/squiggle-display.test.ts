import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { checkModel, connections, studsBelow } from '../src/core/check';
import { elementId } from '../src/core/lego';
import { TRANS_CLEAR } from '../src/core/palette';
import type { Piece } from '../src/core/parts';
import { kx, kz } from '../src/core/tile';
import { readCurve } from '../src/squiggle/curve';
import { buildRelief, SOCLE_D, SOCLE_W } from '../src/squiggle/display';
import type { Display, SqModel } from '../src/squiggle/model';
import { buildRibbon, RIBBON_PANEL, type Ribbon } from '../src/squiggle/ribbon';
import { BLACK, WHITE } from '../src/squiggle/spectrum';

const DIR = 'test/fixtures/squiggles';
const IDS = [0, 1, 1234, 3784, 7583, 9999, 102, 1000, 1004, 10, 1047];
const DISPLAYS: Display[] = ['frame', 'floating', 'backdrop'];
const fixture = (id: number) => JSON.parse(readFileSync(`${DIR}/${id}.json`, 'utf8'));
const cells = (p: Piece) => { const o: string[] = []; for (let a = 0; a < p.w; a++) for (let b = 0; b < p.d; b++) o.push(`${p.x + a},${p.z + b}`); return o; };

/** the ribbon's pieces in the model, in order: the same pieces moved by one offset */
function ribbonOffset(m: SqModel, rb: Ribbon) {
  const sq = m.pieces.filter(p => p.role === 'squiggle'), a = rb.pieces[0], b = sq[0];
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  expect(sq.map(p => ({ ...p, x: p.x - d.x, y: p.y - d.y, z: p.z - d.z }))).toEqual(rb.pieces);
  return d;
}

/** where a support at (x, z) stands along the line: its nearest point on every pass within `reach` of its centre */
function stands(line: Ribbon['line'], x: number, z: number, reach: number) {
  const out: number[] = [], cx = x + 0.5, cz = z + 0.5;
  let best = -1, bestD = Infinity, prev = -Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz;
    const t = l2 ? Math.max(0, Math.min(1, ((cx - a.x) * vx + (cz - a.z) * vz) / l2)) : 0, d = Math.hypot(a.x + t * vx - cx, a.z + t * vz - cz);
    if (d > reach) continue;
    const s = a.s + t * (b.s - a.s);
    if (best >= 0 && s - prev > 1) { out.push(best); bestD = Infinity; }
    if (d < bestD) { bestD = d; best = s; }
    prev = s;
  }
  if (bestD < Infinity) out.push(best);
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
const summary: string[] = [];
afterAll(() => { if (summary.length) console.log(`relief displays: pieces (squiggle + display), lots, size cm, grams, EUR, ms\n${summary.join('\n')}`); });

describe('relief displays', () => {
  for (const scale of ['small', 'large'] as const) for (const id of IDS) for (const display of DISPLAYS) {
    it(`${scale} ${display}: #${id}`, () => {
      const f = fixture(id), curve = readCurve(f);
      // a fresh curve each run: the ribbon is cached per curve
      const { r: m, ms } = timed(() => buildRelief(readCurve(f), display, scale, { id: f.id, hash: f.hash }));
      expect(ms).toBeLessThan(2 * BUDGET);
      const frame = display === 'frame';
      expect(m).toMatchObject({ id, format: 'relief', display, scale, pose: frame ? 'wall' : 'table' });

      // structure: nothing overlaps, everything holds to the backing (Frame) or the socle plates
      expect(m.checks.collisions).toBe(0);
      expect(m.checks.floating).toBe(0);
      for (const r of m.checks.rules) expect(r.ok, `${r.name}: ${r.detail}`).toBe(true);
      // the builder's words: typographic apostrophes, part sizes written 1×1 like the booklet
      const words = [...m.notes, ...Object.values(m.stepNotes), ...m.checks.rules.map(r => r.detail ?? '')];
      expect(words.filter(w => /'|\d x \d|\s1 studs\b/.test(w))).toEqual([]);
      const isRoot = (p: Piece) => p.y === 0 && p.kind === 'plate' && p.c === BLACK && p.role === 'display';
      const own = checkModel(m.pieces, { root: isRoot });
      expect(own.collisions).toBe(0);
      expect(own.floating).toBe(0);

      // the ribbon: the same pieces as buildRibbon, moved; everything else is the display
      const rb = buildRibbon(curve, scale), d = ribbonOffset(m, rb);
      expect(m.pieces.every(p => p.role === 'squiggle' || p.role === 'display')).toBe(true);
      expect(m.subtotals.squiggle.pieces).toBe(rb.pieces.length);
      expect(m.subtotals.squiggle.pieces + m.subtotals.display.pieces).toBe(m.pieces.length);

      // steps: every piece once, in an order that can be built (what a piece sits on comes first)
      expect(m.steps.flat().sort((a, b) => a - b)).toEqual(m.pieces.map((_, i) => i));
      expect(m.steps.every(s => s.length > 0)).toBe(true);
      const stepOf = new Map(m.steps.flatMap((s, k) => s.map(i => [i, k] as [number, number])));
      const { adj } = connections(m.pieces);
      const late = m.pieces.map((p, i) => i).filter(i => {
        if (isRoot(m.pieces[i])) return false;
        const under = [...adj[i].keys()].filter(j => m.pieces[j].y + m.pieces[j].h === m.pieces[i].y);
        return under.length > 0 && !under.some(j => stepOf.get(j)! <= stepOf.get(i)!);
      });
      expect(late).toEqual([]);

      // parts sold by LEGO, or the notes say so
      for (const l of m.bom) if (!elementId(l.part, l.color)) expect(m.notes.join(' ')).toContain(`${l.name} ${l.colorName}`);
      // nameplate: the 2×6 black tile with the Squiggle's name
      expect(m.nameplate?.lines[0]).toBe(`Riggle #${id}`);
      expect(m.nameplate?.lines[1]).toContain(`0x${f.hash.slice(2, 10)}`);
      const np = m.pieces[m.nameplate!.piece];
      expect(np).toMatchObject({ kind: 'tile', w: 6, d: 2, c: BLACK, nameplate: true, role: 'display' });
      // the Frame's cap step says the gap left in it is the nameplate's
      if (frame) expect(m.stepNotes[m.steps.findIndex(s => s.some(i => m.pieces[i].kind === 'tile' && m.pieces[i].y === 4))]).toMatch(/2×6 gap.*nameplate/);
      expect(m.pieces.filter(p => p.nameplate)).toHaveLength(1);

      const { w: W, h: H } = RIBBON_PANEL[scale];
      if (frame) {
        // ribbon on the white panel inside a 2-stud frame, every ribbon piece on ≥ 2 studs
        expect(d).toEqual({ x: 2, y: 2, z: 2 });
        expect(m.checks.twoStud).toBe(0);
        const below = studsBelow(m.pieces);
        expect(m.pieces.filter((p, i) => p.role === 'squiggle' && below[i] < 2)).toEqual([]);
        expect(m.checks.comInside).toBeNull();
        const white = m.pieces.filter(p => p.c === WHITE);
        expect(white.every(p => p.kind === 'plate' && p.y === 1 && p.x >= 2 && p.z >= 2 && p.x + p.w <= W + 2 && p.z + p.d <= H + 2)).toBe(true);
        expect(white.reduce((n, p) => n + p.w * p.d, 0)).toBe(W * H);
        expect(m.pieces.filter(isRoot).reduce((n, p) => n + p.w * p.d, 0)).toBe((W + 4) * (H + 4));
        expect(np).toMatchObject({ x: W - 4, z: 0, y: 4 });
        // hanging: 4 Technic 1×2 under the backing, holes along x; the 2 top ones are the points
        const back = m.pieces.filter(p => p.y < 0);
        expect(back).toHaveLength(4);
        expect(back.every(p => p.kind === 'technic' && p.w === 1 && p.d === 2 && p.y === -3 && p.part === '3700')).toBe(true);
        expect(m.hanging?.points).toHaveLength(2);
        for (const i of m.hanging!.points) expect(m.pieces[i].z).toBeGreaterThan((H + 4) / 2);
        expect(m.hanging!.advice).toMatch(/kg/);
        expect(m.dims[0]).toBeCloseTo((W + 4) * 0.8, 5);
      } else {
        // socle: the smallest that leaves the margins; the ribbon 6 plates above its top; notes about this display only
        expect(m.hanging).toBeNull();
        expect(m.notes.join(' ')).not.toMatch(/panel|frame/i);
        expect(m.checks.twoStud).toBeNull();
        expect(m.checks.comInside).toBe(true);
        const base = m.pieces.filter(isRoot), SW = Math.max(...base.map(p => p.x + p.w)), SD = Math.max(...base.map(p => p.z + p.d));
        expect(SOCLE_W).toContain(SW);
        expect(SOCLE_D).toContain(SD);
        expect(base.reduce((n, p) => n + p.w * p.d, 0)).toBe(SW * SD);
        expect(d.y).toBe(8);
        const x0 = rb.bounds.x0 + d.x, x1 = rb.bounds.x1 + d.x, z0 = rb.bounds.z0 + d.z, z1 = rb.bounds.z1 + d.z;
        expect(Math.min(x0, SW - x1)).toBeGreaterThanOrEqual(4);
        expect(z0).toBeGreaterThanOrEqual(3);
        if (display === 'floating') expect(SD - z1).toBeGreaterThanOrEqual(3);
        // the socle top is closed: every cell carries one piece standing on the plates
        const top = new Map<string, number>();
        for (const p of m.pieces) if (p.y === 1) for (const c of cells(p)) top.set(c, (top.get(c) ?? 0) + 1);
        expect(top.size).toBe(SW * SD);
        expect(np.y).toBe(1);
        expect(np.x).toBe((SW - 6) / 2);
        expect(np.z + 2).toBeLessThanOrEqual(z0);
        // supports: Trans-Clear round plate + 2 round bricks, right under a ribbon piece, both ends among them
        const sup = m.pieces.map((p, i) => i).filter(i => m.pieces[i].support);
        expect(sup.length % 3).toBe(0);
        const cols = new Set(sup.map(i => `${m.pieces[i].x},${m.pieces[i].z}`));
        expect(sup.length).toBe(3 * cols.size);
        for (const i of sup) expect(m.pieces[i]).toMatchObject({ kind: 'round', w: 1, d: 1, c: TRANS_CLEAR, role: 'display' });
        const foot = new Set(m.pieces.filter(p => p.role === 'squiggle' && p.y === 8).flatMap(cells));
        for (const c of cols) {
          const [x, z] = c.split(',').map(Number), col = sup.map(i => m.pieces[i]).filter(p => p.x === x && p.z === z).sort((a, b) => a.y - b.y);
          expect(col.map(p => [p.y, p.h, p.part])).toEqual([[1, 1, '6141'], [2, 3, '3062b'], [5, 3, '3062b']]);
          expect(foot.has(c)).toBe(true);
        }
        for (const e of rb.ends) expect(cols.has(`${kx(e) + d.x},${kz(e) + d.z}`)).toBe(true);
        // they show from the front: a quarter or more at the ribbon's front edge (≤ 1 footprint cell right in front)
        const front = (c: string) => { const [x, z] = c.split(',').map(Number); let n = 0; while (foot.has(`${x},${z - n - 1}`)) n++; return n; };
        expect(4 * [...cols].filter(c => front(c) <= 1).length).toBeGreaterThanOrEqual(cols.size);
        // spacing where the supports stand along the centre line (every pass they are under): ≤ 8 studs, ≤ 2 from each tip
        const line = rb.line.map(p => ({ x: p.x + d.x, z: p.z + d.z, s: p.s })), total = line[line.length - 1].s;
        const at = [...cols].flatMap(c => { const [x, z] = c.split(',').map(Number); return stands(line, x, z, rb.width / 2 + 1); }).sort((a, b) => a - b);
        expect(Math.max(...at.slice(1).map((s, i) => s - at[i]))).toBeLessThanOrEqual(8);
        expect(at[0]).toBeLessThanOrEqual(2);
        expect(at[at.length - 1]).toBeGreaterThanOrEqual(total - 2);
        const k = m.steps.findIndex(s => s.includes(sup[0]));
        expect(m.steps[k].every(i => m.pieces[i].support)).toBe(true);
        expect(m.stepNotes[k]).toBe(`Hidden supports: ${cols.size} round 1×1 plates (6141) and ${2 * cols.size} round 1×1 bricks (3062b), Trans-Clear, stacked into ${cols.size} clear columns: the round plate in a hole of the tiles, two round bricks on it.`);
        if (display === 'backdrop') {
          // white wall, full width, 24 studs (60 plates) of bricks, 2 studs behind the ribbon; braces behind it
          const white = m.pieces.filter(p => p.c === WHITE), wall = white.filter(p => p.kind === 'brick'), cap = white.filter(p => p.kind === 'tile');
          const wz = Math.min(...white.map(p => p.z));
          expect(wz).toBe(z1 + 2);
          expect(wall.length + cap.length).toBe(white.length);
          expect(wall.every(p => p.z === wz && p.y >= 1)).toBe(true);
          expect(Math.max(...wall.map(p => p.y + p.h)) - 1).toBe(60);
          expect(wall.filter(p => p.y === 1).reduce((n, p) => n + p.w, 0)).toBe(SW);
          // capped with white 1×N tiles, no 1×1, joints off the top course's
          expect(cap.every(p => p.y === 61 && p.z === wz && p.d === 1 && p.w >= 2)).toBe(true);
          expect(cap.reduce((n, p) => n + p.w, 0)).toBe(SW);
          const topJ = new Set(wall.filter(p => p.y === 58).map(p => p.x));
          expect(cap.filter(p => p.x > 0 && topJ.has(p.x))).toEqual([]);
          for (const p of cap) expect(m.bom.some(l => l.part === p.part && l.color === WHITE)).toBe(true);
          const braces = m.pieces.filter(p => p.kind === 'brick' && p.c === BLACK);
          expect(braces.length).toBeGreaterThan(0);
          expect(braces.every(p => p.z > wz && p.z + p.d <= SD && p.y + p.h < 61)).toBe(true);
          expect(Object.values(m.stepNotes).some(n => n.startsWith('Lighting notes: '))).toBe(true);
        } else expect(m.pieces.some(p => p.kind === 'brick')).toBe(false);
      }

      const lots = m.bom.length, s = m.subtotals;
      summary.push(`${scale.padEnd(5)} ${display.padEnd(8)} #${String(id).padEnd(4)} ${String(m.pieces.length).padStart(4)} (${s.squiggle.pieces} + ${s.display.pieces}) ${String(lots).padStart(3)}  ${m.dims.join(' × ').padEnd(18)} ${String(m.grams).padStart(5)} g  ${String(m.cost).padStart(4)} €  ${ms.toFixed(0).padStart(4)}`);
    });
  }

  it('shares one ribbon between the three displays', () => {
    const f = fixture(1234), curve = readCurve(f), meta = { id: f.id, hash: f.hash };
    const rb = buildRibbon(curve, 'large');
    for (const display of DISPLAYS) ribbonOffset(buildRelief(curve, display, 'large', meta), rb);
    // the studded look goes through too
    const studs = buildRelief(curve, 'frame', 'small', meta, { studs: true });
    ribbonOffset(studs, buildRibbon(curve, 'small', { studs: true }));
    expect(studs.checks.twoStud).toBe(0);
  });

  // a jittery Fuzzy line: its arc runs ahead of the distance covered, the end supports stood 2.3 studs along it from a tip
  it('#1110 large: a support within 2 studs of each tip along the line', () => {
    const f = fixture(1110), curve = readCurve(f), rb = buildRibbon(curve, 'large');
    for (const display of ['floating', 'backdrop'] as const) {
      const m = buildRelief(curve, display, 'large', { id: f.id, hash: f.hash }), d = ribbonOffset(m, rb);
      expect(m.checks.rules.find(r => r.name === 'Both ends supported')?.ok).toBe(true);
      const line = rb.line.map(p => ({ x: p.x + d.x, z: p.z + d.z, s: p.s })), total = line[line.length - 1].s;
      const at = [...new Set(m.pieces.filter(p => p.support).map(p => `${p.x},${p.z}`))].flatMap(c => { const [x, z] = c.split(',').map(Number); return stands(line, x, z, rb.width / 2 + 1); }).sort((a, b) => a - b);
      expect(at[0]).toBeLessThanOrEqual(2);
      expect(at[at.length - 1]).toBeGreaterThanOrEqual(total - 2);
    }
  });

  it('#1234: pieces, size and weight of each display', () => {
    const f = fixture(1234), curve = readCurve(f), rows: string[] = [];
    for (const scale of ['small', 'large'] as const) for (const display of DISPLAYS) {
      const m = buildRelief(curve, display, scale, { id: f.id, hash: f.hash });
      rows.push(`${scale} ${display}: ${m.pieces.length} pieces (${m.subtotals.squiggle.pieces} Squiggle, ${m.subtotals.display.pieces} display), ${m.dims.join(' × ')} cm, ${m.grams} g, about ${m.cost} €`);
      if (m.hanging) rows.push(`  ${m.hanging.advice}`);
      expect(m.grams).toBeGreaterThan(0);
    }
    console.log(`#1234\n${rows.join('\n')}`);
  });
});
