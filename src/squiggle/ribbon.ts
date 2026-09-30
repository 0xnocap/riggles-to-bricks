// The Relief ribbon, shared by the three displays: the Squiggle's stroke as a
// band of stud cells fitted in the Frame panel, laminated from slabs (plate,
// plate, top). Where the line comes back over or along itself the later stretch
// stands one slab higher than the earlier one over its whole width, on slabs of
// its own colour, so nothing overhangs. No 1×1 pieces: on a full panel every
// piece sits on at least 2 studs, and the pieces overlap so the ribbon holds as one body.
import { connections } from '../core/check';
import { availableAtLego } from '../core/lego';
import { partId, SIZES, TILE_SIZES, type Piece } from '../core/parts';
import { key, kx, kz } from '../core/tile';
import { arcLength, type Curve, type SquiggleType } from './curve';
import type { Scale } from './model';
import { BLACK, SPECTRUM, WHITE, curveColors, paletteCoord } from './spectrum';

export interface Ribbon {
  /** role 'squiggle'; y = 0 at the ribbon bottom; x, z in Frame panel studs (0 ≤ x < panel.w, 0 ≤ z < panel.h) */
  pieces: Piece[];
  /** the Frame panel the ribbon is fitted in: 48×24 (small) or 64×32 (large) */
  panel: { w: number; h: number };
  /** footprint cells, keys from core/tile `key(x, z)` (decode with kx/kz) */
  cells: number[];
  /** stack height per footprint cell, in slabs (1 slab = 3 plates) */
  stack: Map<number, number>;
  /** cells of the bottom layer (slab 0), where a support can go under the ribbon */
  bottom: number[];
  /** footprint cells about a stud in from the start and the end of the centre line, under the stroke (end supports go there) */
  ends: [number, number];
  /** centre line in studs, drawing order; s = arc length in studs */
  line: { x: number; z: number; s: number }[];
  /** palette colour of every line point (curveColors, 2-stud runs; the end cap in the end dot's colour and the colours
   *  running into it, see endCap) */
  colors: number[];
  /** ribbon width, studs */
  width: number;
  /** studs per canvas pixel */
  k: number;
  /** placement: x = offset.x + (px − box.x0)·k, z = offset.z + (box.y1 − py)·k */
  offset: { x: number; z: number };
  /** footprint bounding box, studs (x1, z1 exclusive) */
  bounds: { x0: number; z0: number; x1: number; z1: number };
  /** highest stack, slabs; total height = 3·maxStack plates */
  maxStack: number;
  /** cells recoloured to avoid single-stud pieces or to tie the ribbon together */
  recoloured: number;
  /** passes side by side closer than the ribbon is wide (median): they overlap, the loops show better on the Large size */
  dense: boolean;
  notes: string[];
}

export const RIBBON_PANEL: Record<Scale, { w: number; h: number }> = { small: { w: 48, h: 24 }, large: { w: 64, h: 32 } };
export const RIBBON_WIDTH: Record<SquiggleType, number> = { Normal: 3, Slinky: 3, Ribbed: 3, Fuzzy: 4, Bold: 7, Pipe: 5 };
/** margins (studs), sample spacing (studs), plates per slab, most slabs */
const MX = 4, MZ = 1, STEP = 0.25, SLAB = 3, TOP = 3;
const NB = [1024, -1024, 1, -1];   // key offsets of the 4 neighbours
const SPEC = new Map(SPECTRUM.map((s, i) => [s.id, i]));
/** spectrum steps between two colours (black or white against a colour: 1.5) */
const steps = (a: number, b: number) => {
  const p = SPEC.get(a), q = SPEC.get(b);
  if (a === b) return 0;
  if (p === undefined || q === undefined) return 1.5;
  const d = Math.abs(p - q);
  return Math.min(d, SPEC.size - d);
};

/**
 * Colours with the end cap the original draws over the last `len` px of the line: Ribbed ends on a rib
 * disc (black, or white for light ribs), Pipe on a filled disc of its last colour (matched to the spectrum).
 * On Ribbed the tail where the ribs follow each other closer than they reach past the stroke (h/24 − stroke/2)
 * is solid rib colour too, as in the original. `colors` are curveColors'; where they lag behind the hue
 * (HyperRainbow), the colours before a Pipe cap catch up with it one step every `run` px, the way the hue
 * runs, so the cap follows the spectrum instead of jumping to it.
 */
export function endCap(curve: Curve, colors: number[], len: number, run = len): number[] {
  const cap = capOf(curve, len), out = [...colors];
  if (!cap) return out;
  out.fill(cap.col, cap.from);
  const q = SPEC.get(cap.col);
  if (q === undefined || !cap.from) return out;
  // unwrapped palette coordinates: the hue's (as curveColors reads it) and the line colours' (one step at a
  // time from the rounded first hue); the cap's is the first of its colour the way the line colours lag
  const P = curve.points, s = arcLength(P), N = SPECTRUM.length, u = [paletteCoord(P[0].hue)], v = [Math.round(u[0])];
  const wrap = (d: number) => d - N * Math.round(d / N);
  for (let i = 1; i <= cap.at; i++) {
    u.push(u[i - 1] + wrap(paletteCoord(P[i].hue) - u[i - 1]));
    if (i < cap.from) v.push(v[i - 1] + wrap((SPEC.get(colors[i]) ?? 0) - (SPEC.get(colors[i - 1]) ?? 0)));
  }
  const V = v[cap.from - 1], dir = Math.sign(u[cap.at] - V) || 1, Q = V + dir * ((((q - V) * dir) % N + N) % N);
  // the line colours held within A steps of the cap's, A shrinking by one every `run` px, down to 0 from 2·len before
  // the end dot (its disc, a stroke wide, covers the line past there)
  for (let i = cap.from - 1; i >= 0; i--) {
    const A = Math.max(0, 1 + Math.floor((s[cap.at] - 2 * len - s[i]) / run)), w = Math.max(Q - A, Math.min(Q + A, v[i]));
    out[i] = SPECTRUM[((w % N) + N) % N].id;
  }
  return out;
}
/** the end dot (its point) and its colour, and the first point of the cap, or null */
function capOf(curve: Curve, len: number): { at: number; from: number; col: number } | null {
  const P = curve.points, n = P.length;
  let e = -1, col = -1;
  if (curve.type === 'Ribbed' && P[n - 1]?.rib) { e = n - 1; col = (curve.ribGray ?? 0) < 128 ? BLACK : WHITE; }
  if (curve.type === 'Pipe') for (let i = n - 1; i >= 0 && e < 0; i--) if (P[i].end) { e = i; col = SPECTRUM[Math.round(paletteCoord(P[i].hue)) % SPECTRUM.length].id; }
  if (e < 0) return null;
  const s = arcLength(P);
  let from = e;
  while (from > 0 && s[e] - s[from - 1] <= len) from--;
  if (curve.type === 'Ribbed') {
    const reach = curve.canvas.h / 24 - curve.stroke / 2;
    for (let i = e, rib = e; i > 0 && s[rib] - s[i - 1] < reach; i--) if (P[i - 1].rib) { rib = i - 1; from = Math.min(from, rib); }
  }
  return { at: e, from, col };
}

/** one slab of one cell: its colour, whether its top is a rib (Ribbed), its sides' colour if it differs,
 *  the sample of the pass it comes from, how far the line is and the colour the line has there */
interface Lv { col: number; rib: boolean; side?: number; j: number; d: number; want: number }
/** 'side' = the two plate layers of a slab, 'R' = studded top, 'T' = tiled top (nothing above), 'U' = plate top under the next slab */
type Part = 'side' | 'R' | 'T' | 'U';
/** a piece being placed: its cells (front-left corner first), size, colour, how good it is */
interface Pc { cells: number[]; w: number; d: number; c: number; score: number }
/** one region of one layer (one kind of piece) and the pieces filling it */
interface Region {
  y: number; L: number; part: Part; kind: 'plate' | 'tile'; prefX: boolean;
  cells: Set<number>; colour: (c: number) => number; vis: (c: number) => boolean;
  lower: Map<number, Pc> | null;         // pieces of the layer below, to stagger the joints
  own: Map<number, Pc>;                  // cell → piece
}

export function buildRibbon(curve: Curve, scale: Scale, opts: { studs?: boolean } = {}): Ribbon {
  const { w: W, h: H } = RIBBON_PANEL[scale], width = RIBBON_WIDTH[curve.type], r = width / 2, far = 2 * width;
  const { x0, y0, x1, y1 } = curve.box, bw = Math.max(x1 - x0, 1), bh = Math.max(y1 - y0, 1);
  // the largest scale that fits: every stud of margin given up shrinks the loops, and dense ones fuse
  const k = Math.min((W - 2 * MX - width) / bw, (H - 2 * MZ - width) / bh, scale === 'small' ? 3 / (curve.canvas.h / 13) : Infinity);
  const offset = { x: MX + r + (W - 2 * MX - width - k * bw) / 2, z: MZ + r + (H - 2 * MZ - width - k * bh) / 2 };
  const arc = arcLength(curve.points);
  const line = curve.points.map((p, i) => ({ x: offset.x + (p.x - x0) * k, z: offset.z + (y1 - p.y) * k, s: arc[i] * k }));
  // the end dot: a disc as wide as the stroke (Ribbed: its rib, a little wider), drawn over everything
  const cap = capOf(curve, 1.5 / k), colors = endCap(curve, curveColors(curve, 2 / k), 1.5 / k, 1 / k);
  const capR = (curve.type === 'Ribbed' ? 1.08 : 1) * 1.5;
  const ribC = (curve.ribGray ?? 0) < 128 ? BLACK : WHITE;

  // samples along the line (≤ STEP apart): position, arc length, L∞ arc length, point, direction
  const SX: number[] = [], SZ: number[] = [], SS: number[] = [], SU: number[] = [], SI: number[] = [], TX: number[] = [], TZ: number[] = [];
  let u = 0;
  for (let i = 0; i < line.length; i++) {
    const a = line[i], b = line[i + 1] ?? a, dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), du = Math.max(Math.abs(dx), Math.abs(dz));
    const tx = len ? dx / len : TX[TX.length - 1] ?? 1, tz = len ? dz / len : TZ[TZ.length - 1] ?? 0;
    const n = Math.max(1, Math.ceil(len / STEP));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      SX.push(a.x + dx * t); SZ.push(a.z + dz * t); SS.push(a.s + (b.s - a.s) * t); SU.push(u + du * t);
      SI.push(t < 0.5 ? i : i + 1); TX.push(tx); TZ.push(tz);
    }
    u += du;
  }
  /** the cells whose centre is within R of (X, Z), with that distance */
  const disc = (X: number, Z: number, R: number, f: (c: number, d: number) => void) => {
    for (let cx = Math.ceil(X - R - 0.5); cx <= Math.floor(X + R - 0.5); cx++) for (let cz = Math.ceil(Z - R - 0.5); cz <= Math.floor(Z + R - 0.5); cz++) {
      const d = Math.hypot(cx + 0.5 - X, cz + 0.5 - Z);
      if (d <= R) f(key(cx, cz), d);
    }
  };

  // the level of every sample, in slabs over the first. Earlier passes (> 2 widths back along the line) under
  // its disc: crossing one puts it a slab above; running over the edge of or along one, it takes the other of
  // levels 0 and 1, so every stroke keeps edges of its own. A level starts a width before it is needed and
  // holds a width after, so a raised run is at least 2 widths long.
  const lev: number[] = [], ban: number[] = [], low: number[] = [], seen = new Map<number, number[]>();
  let cur = 0, hold = -Infinity;
  for (let j = 0; j < SX.length; j++) {
    const s = SS[j];
    let base = 0, T = 0;
    disc(SX[j], SZ[j], r, c => {
      for (const i of seen.get(c) ?? []) {
        if (s - SS[i] <= far) break;
        T |= 1 << lev[i];
        if (Math.hypot(SX[i] - SX[j], SZ[i] - SZ[j]) <= r && Math.abs(TX[i] * TX[j] + TZ[i] * TZ[j]) < 0.87) base = Math.max(base, lev[i] + 1);
      }
    });
    const ok = (L: number) => L >= base && !((T >> L) & 1), lim = base ? TOP : 2;
    let best = Math.min(base, TOP - 1);
    while (best < lim - 1 && !ok(best)) best++;
    if (!ok(cur) || (best !== cur && s > hold)) {
      if (best > cur) {
        for (let i = j - 1; i >= 0 && s - SS[i] <= width && lev[i] < best && low[i] <= best && !((ban[i] >> best) & 1); i--) lev[i] = best;
        hold = s + width;
      }
      cur = best;
    }
    if (cur && best === cur) hold = Math.max(hold, s + width);
    lev.push(cur); ban.push(T); low.push(base);
    disc(SX[j], SZ[j], r, c => { const a = seen.get(c); if (a) a.push(j); else seen.set(c, [j]); });
  }

  // the passes over each cell (touches > 2 widths apart along the line): the sample nearest to the cell gives
  // the slab its colour, the latest one its level
  const touch = new Map<number, { last: number; j: number[]; d: number[]; l: number[] }>();
  for (let j = 0; j < SX.length; j++) disc(SX[j], SZ[j], r, (c, d) => {
    const e = touch.get(c), s = SS[j];
    if (!e) { touch.set(c, { last: s, j: [j], d: [d], l: [lev[j]] }); return; }
    const t = e.j.length - 1;
    if (s - e.last > far) { e.j.push(j); e.d.push(d); e.l.push(lev[j]); } else { if (d < e.d[t]) { e.j[t] = j; e.d[t] = d; } e.l[t] = lev[j]; }
    e.last = s;
  });
  // Ribbed: bands one stud of L∞ arc long, ribs and plain bands in turn, each in the colour at its middle.
  // Where a rib would hide a whole colour run (shown on neither plain band beside it) the band stays plain
  // and the ribs go on from the next one, so no colour of the spectrum hides under the ribs
  const sampleAt = (uc: number) => {
    let lo = 0, hi = SU.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (SU[m] <= uc) lo = m; else hi = m - 1; }
    return lo;
  };
  const band = new Map<number, number>(), ribs = new Set<number>(), b0 = Math.floor(SU[0]) - 1, b1 = Math.floor(SU[SU.length - 1]) + 1;
  let slips = 0;
  if (curve.type === 'Ribbed') {
    const colAt = (uc: number) => colors[SI[sampleAt(uc)]];
    for (let b = b0, rib = b0 % 2 === 0; b <= b1; b++, rib = !rib) {
      const col = colAt(b + 0.5);
      band.set(b, col);
      if (rib && SPEC.has(col) && band.get(b - 1) !== col && colAt(b + 1.5) !== col) { rib = false; slips++; }
      if (rib) ribs.add(b);
    }
  }
  /** how far a colour is from what a slab should show along the spectrum: its own colour; a rib also the line's there */
  const off = (v: Lv, col: number) => Math.min(steps(col, v.want), curve.type === 'Ribbed' && v.want === ribC ? steps(col, colors[SI[v.j]]) : Infinity);
  /** in each cell the line runs through: its colours there (every pass, and the nearest point of each pass over the
   *  cell), the latest one last. On top, no colour over a step from all of them: it would skip one along the line */
  const lineAt = new Map<number, number[]>();
  for (let j = 0; j < SX.length; j++) {
    const c = key(Math.floor(SX[j]), Math.floor(SZ[j])), cs = lineAt.get(c);
    if (cs) cs.push(colors[SI[j]]); else lineAt.set(c, [...touch.get(c)?.j.map(i => colors[SI[i]]) ?? [], colors[SI[j]]]);
  }
  const skips = (c: number, col: number) => SPEC.has(col) && !!lineAt.get(c)?.every(l => SPEC.has(l) && steps(col, l) > 1);
  /** a cell the line runs through, showing the line's latest colour there on top of a slab */
  const exact = (c: number, v: Lv) => !v.rib && lineAt.get(c)?.at(-1) === v.col;
  const isRib = (b: number) => b < b0 || b > b1 ? b % 2 === 0 : ribs.has(b);
  const endS = cap ? line[cap.at].s : 0;
  const slabOf = (j: number, d: number, c: number): Lv => {
    const tx = TX[j], tz = TZ[j];
    // Pipe: black outer ring, one cell thick in the 8-neighbour sense so it stays joined on diagonals
    if (curve.type === 'Pipe' && d > r - (Math.abs(tx) + Math.abs(tz))) return { col: BLACK, rib: false, j, d, want: BLACK };
    if (cap && endS - SS[j] <= far && Math.hypot(kx(c) + 0.5 - line[cap.at].x, kz(c) + 0.5 - line[cap.at].z) <= capR)
      return { col: cap.col, rib: curve.type === 'Ribbed', j, d, want: cap.col };
    if (curve.type !== 'Ribbed') return { col: colors[SI[j]], rib: false, j, d, want: colors[SI[j]] };
    if (cap && SI[j] >= cap.from) return { col: cap.col, rib: true, j, d, want: cap.col };
    // Ribbed: bands one row or column long (whichever the line runs along), every other one a rib
    const along = Math.abs(tx) >= Math.abs(tz);
    const uc = SU[j] + (along ? (kx(c) + 0.5 - SX[j]) * Math.sign(tx) : (kz(c) + 0.5 - SZ[j]) * Math.sign(tz));
    const b = Math.floor(uc), rib = isRib(b), col = band.get(b) ?? colors[SI[sampleAt(uc)]];
    return { col, rib, j, d, want: rib ? ribC : col };
  };
  // each pass at its level: a later one cuts back what stood higher (later on top, like the drawing)
  // and stands on slabs of its own colour where nothing was under it
  const lv = new Map<number, Lv[]>();
  for (const [c, e] of touch) {
    const a: Lv[] = [];
    e.j.forEach((j, t) => {
      const v = slabOf(j, e.d[t], c), L = e.l[t];
      a.length = Math.min(a.length, L);
      while (a.length < L) a.push({ ...v, rib: false, want: v.col });
      a.push(v);
    });
    lv.set(c, a);
  }

  const h = (c: number) => lv.get(c)?.length ?? 0;
  let ver = 0;   // bumped whenever a stack changes height
  /** down to L slabs, still showing the colour it had on top */
  const cut = (c: number, L: number) => {
    const a = lv.get(c);
    if (!a) return;
    ver++;
    if (L <= 0) lv.delete(c);
    else if (L < a.length) { a[L - 1] = { ...a[a.length - 1] }; a.length = L; }
  };
  /** a raised patch under 9 cells reads as a stray brick: back down, keeping its colour */
  const patches = () => {
    let n = 0;
    for (let L = TOP - 1; L >= 1; L--) {
      const done = new Set<number>();
      for (const c of lv.keys()) {
        if (h(c) <= L || done.has(c)) continue;
        const comp = [c];
        done.add(c);
        for (let q = 0; q < comp.length; q++) for (const o of NB) { const x = comp[q] + o; if (h(x) > L && !done.has(x)) { done.add(x); comp.push(x); } }
        if (comp.length < 9) for (const x of comp) { cut(x, L); n++; }
      }
    }
    return n;
  };
  patches();
  const noRaise = new Set<number>(), stepped = new Set<number>(), recoloured = new Set<string>(), tried = new Map<string, Set<number>>();
  const keep = new Set<number>(), spare = new Map<number, number>();

  /** no spurs: every cell of every level has ≥ 2 neighbours on that level; a top cell alone
   *  among higher neighbours steps up with them */
  function reshape() {
    for (let changed = true; changed;) {
      changed = false;
      const top = Math.max(0, ...[...lv.values()].map(a => a.length));
      for (let L = 0; L < top; L++) for (let again = true; again;) {
        again = false;
        for (const [c, a] of lv) if (a.length > L && !keep.has(c) && NB.filter(o => h(c + o) > L).length < 2) { cut(c, L); again = changed = true; }
      }
      for (const [c, a] of lv) {
        const L = a.length - 1, up = NB.map(o => c + o).filter(n => h(n) > L + 1);
        if (noRaise.has(c) || up.length < 2 || NB.some(o => h(c + o) === L + 1)) continue;
        const want = a[L].want, col = (n: number) => lv.get(n)![L + 1].col;
        a.push({ ...lv.get(up.sort((p, q) => steps(col(p), want) - steps(col(q), want))[0])![L + 1] }); changed = true; stepped.add(c); ver++;
      }
      if (patches()) changed = true;
    }
    holes();
  }

  /** empty cells the ribbon closes around (not reached from outside its box): filled like the latest pass
   *  beside them (Pipe: black only if all around is black); they stay in the footprint from then on */
  function holes() {
    const cs = [...lv.keys()];
    if (!cs.length) return;
    const xs = cs.map(kx), zs = cs.map(kz), bx0 = Math.min(...xs) - 1, bx1 = Math.max(...xs) + 1, bz0 = Math.min(...zs) - 1, bz1 = Math.max(...zs) + 1;
    const inBox = (c: number) => kx(c) >= bx0 && kx(c) <= bx1 && kz(c) >= bz0 && kz(c) <= bz1;
    const out = new Set<number>(), st: number[] = [];
    const go = (c: number) => { if (inBox(c) && !out.has(c) && !lv.has(c)) { out.add(c); st.push(c); } };
    for (let x = bx0; x <= bx1; x++) { go(key(x, bz0)); go(key(x, bz1)); }
    for (let z = bz0; z <= bz1; z++) { go(key(bx0, z)); go(key(bx1, z)); }
    while (st.length) { const c = st.pop()!; for (const o of NB) go(c + o); }
    let left: number[] = [];
    for (let x = bx0; x <= bx1; x++) for (let z = bz0; z <= bz1; z++) { const c = key(x, z); if (!lv.has(c) && !out.has(c)) left.push(c); }
    while (left.length) {
      const next: number[] = [], top = (n: number) => lv.get(n)!.at(-1)!;
      for (const c of left) {
        let nb = NB.map(o => c + o).filter(n => lv.has(n));
        if (curve.type === 'Pipe' && nb.some(n => top(n).col !== BLACK)) nb = nb.filter(n => top(n).col !== BLACK);
        const from = nb.sort((p, q) => top(q).j - top(p).j)[0];
        if (from === undefined) { next.push(c); continue; }
        lv.set(c, lv.get(from)!.map(v => ({ ...v }))); ver++;
        keep.add(c);
      }
      if (next.length === left.length) break;
      left = next;
    }
  }

  const inPart = (L: number, part: Part, c: number) => part === 'T' ? h(c) === L + 1 : part === 'U' ? h(c) > L + 1 : h(c) > L;
  const edge = (c: number, L: number) => NB.some(o => h(c + o) <= L);
  const region = (L: number, part: Part, y: number, lower: Map<number, Pc> | null): Region => {
    const seen = new Map<number, boolean>();   // vis, until a stack changes height
    let at = ver;
    return {
      y, L, part, kind: part === 'T' ? 'tile' : 'plate', prefX: y % 2 === 0, lower, own: new Map(),
      cells: new Set([...lv.keys()].filter(c => inPart(L, part, c))),
      vis: c => {
        if (at !== ver) { seen.clear(); at = ver; }
        let v = seen.get(c);
        if (v === undefined) seen.set(c, v = part === 'T' || edge(c, L) || (part === 'R' && h(c) === L + 1));
        return v;
      },
      // ribs show on the top layer only: the plate layers keep the spectrum so their pieces can run along the band
      colour: c => { const e = lv.get(c)![L]; return part === 'side' ? e.side ?? e.col : e.rib ? ribC : e.col; },
    };
  };

  function tileAll(studs: boolean) {
    const regs: Region[] = [], fails: { g: Region; c: number }[] = [];
    const top = Math.max(0, ...[...lv.values()].map(a => a.length));
    let lower: Map<number, Pc> | null = null;
    for (let L = 0; L < top; L++) for (let layer = 0; layer < SLAB; layer++) {
      const y = L * SLAB + layer, here = new Map<number, Pc>();
      for (const part of (layer < 2 ? ['side'] : studs ? ['R'] : ['T', 'U']) as Part[]) {
        const g = region(L, part, y, lower);
        for (const c of fill(g)) fails.push({ g, c });
        for (const [c, pc] of g.own) here.set(c, pc);
        regs.push(g);
      }
      lower = here;
    }
    return { regs, fails };
  }

  /** whether a cell around `at` (none of `not`, nor a cell left alone) shows `col` on top */
  const shows = (col: number, at: number, not: number[], lone: Set<number>) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const x = at + 1024 * i + j, v = lv.get(x)?.at(-1);
      if (v && !not.includes(x) && !lone.has(x) && (v.rib ? ribC : v.col) === col) return true;
    }
    return false;
  };

  /** a cell left alone: take a neighbour's colour, or step it up to its higher neighbours, or down */
  function fix(g: Region, c: number, fresh: Set<number>, lone: Set<number>) {
    if (!inPart(g.L, g.part, c)) return;
    // a cell nearby just changed: lay again first, it may pair now
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (fresh.has(c + 1024 * i + j)) return;
    fresh.add(c);
    const paint = (q: number, col: number) => {
      const e = lv.get(q)![g.L], tid = `${q}:${g.L}${g.part}`;
      if (g.part === 'side') e.side = col; else if (curve.type === 'Ribbed' && col === ribC) e.rib = true; else { e.col = col; e.rib = false; }
      tried.set(tid, (tried.get(tid) ?? new Set([g.colour(q)])).add(col));
      recoloured.add(`${q}:${g.L}`);
    };
    // up to a higher neighbour (the nearest colour along the spectrum, then the lowest), taking its slabs
    const top = (q: number) => lv.get(q)!.at(-1)!, e = lv.get(c)![g.L], far = (col: number) => off(e, col);
    const up = g.part === 'T' && (!noRaise.has(c) || keep.has(c))
      ? NB.map(o => c + o).filter(q => h(q) > g.L + 1).sort((p, q) => far(top(p).col) - far(top(q).col) || h(p) - h(q))[0] : undefined;
    // a top cell on the line never shows a colour over a step from the line's there: down a slab instead, where it can
    const bad = (q: number, col: number) => (g.part === 'T' || g.part === 'R') && skips(q, col);
    const rise = (q: number) => {
      const a = lv.get(c)!, b = lv.get(q)!;
      while (a.length < b.length) a.push({ ...b[a.length] });
      ver++;
      noRaise.add(c); stepped.add(c);
    };
    if (g.vis(c)) {
      const id = `${c}:${g.L}`, tid = id + g.part, mine = g.colour(c), was = tried.get(tid) ?? new Set([mine]), n = new Map<number, number>();
      // on the line, in its own colour: a neighbour off the line, one step away along the spectrum, takes it;
      // the last cell showing a colour of the spectrum on top here: a neighbour whose colour still shows
      // nearby takes it (the nearest to it along the spectrum where the line is, then the furthest off the line)
      const mayTake = (q: number) => inPart(g.L, g.part, q) && g.vis(q) && !fresh.has(q) && !tried.get(`${q}:${g.L}${g.part}`)?.has(mine)
        && !((g.part === 'T' || g.part === 'R') && exact(q, lv.get(q)![g.L]));
      if ((g.part === 'T' || g.part === 'R') && SPEC.has(mine)) {
        const d = (q: number) => lv.get(q)![g.L].d, o = (q: number) => off(lv.get(q)![g.L], mine), ns = NB.map(o => c + o).filter(mayTake);
        let q = e.d < 0.75 && mine === e.want ? ns.filter(q => d(q) >= 0.75 && steps(g.colour(q), mine) === 1 && !bad(q, mine)).sort((p, q) => d(q) - d(p))[0] : undefined;
        if (q === undefined && !shows(mine, c, [c], lone))
          q = ns.filter(q => g.colour(q) !== mine && shows(g.colour(q), q, [c, q], lone) && !bad(q, mine)).sort((p, q) => o(p) - o(q) || d(q) - d(p))[0];
        if (q !== undefined) { paint(q, mine); fresh.add(q); return; }
      }
      for (const o of NB) {
        const q = c + o;
        // never a colour it already had: no flip-flop between layers
        if (inPart(g.L, g.part, q) && g.vis(q) && !was.has(g.colour(q))) n.set(g.colour(q), (n.get(g.colour(q)) ?? 0) + 1);
      }
      // on top, the colour nearest along the spectrum to the line's there (no skipped colour), then the commonest;
      // where every colour about would skip one, a neighbour that can show this one takes it
      const near = (col: number) => (g.part === 'side' ? 0 : far(col) + 9 * +bad(c, col));
      const col = [...n].sort((a, b) => near(a[0]) - near(b[0]) || b[1] - a[1])[0]?.[0];
      if (up !== undefined && !bad(c, top(up).col) && (col === undefined || far(top(up).col) < near(col))) { rise(up); return; }
      if ((col === undefined || bad(c, col)) && lineAt.has(c)) {
        const q = SPEC.has(mine) && !bad(c, mine) ? NB.map(o => c + o).filter(q => mayTake(q) && g.colour(q) !== mine && !bad(q, mine))[0] : undefined;
        if (q !== undefined) { paint(q, mine); fresh.add(q); return; }
      }
      if (col !== undefined && (!bad(c, col) || !g.L)) {
        tried.set(tid, was);
        paint(c, col);
        return;
      }
    }
    if (up !== undefined && !(bad(c, top(up).col) && g.L)) { rise(up); return; }
    // a cell on the line (or filling a hole) is not trimmed off before it has had a few more tries at a
    // neighbour's colour, the nearest along the spectrum first
    const L = g.part === 'U' ? g.L + 1 : g.L, a = lv.get(c)!, n = spare.get(c) ?? 0;
    if (!L && n < 3 && g.vis(c) && (keep.has(c) || a.some(v => v.d < 0.75))) {
      const q = NB.map(o => c + o).filter(q => inPart(g.L, g.part, q) && g.colour(q) !== g.colour(c)).sort((p, q) => +bad(c, g.colour(p)) - +bad(c, g.colour(q)) || far(g.colour(p)) - far(g.colour(q)))[0];
      if (q !== undefined) { paint(c, g.colour(q)); spare.set(c, n + 1); return; }
    }
    noRaise.add(c); stepped.add(c);
    cut(c, L);
  }

  // one body: where a joint runs right across the ribbon through every layer, re-lay a few pieces
  // so one piece spans it (plates may take a neighbour's colour on their side for that)
  const flat = (regs: Region[]) => {
    const ps: Piece[] = [], of: Pc[] = [];
    for (const g of regs) for (const pc of new Set(g.own.values())) { ps.push(toPiece(g, pc)); of.push(pc); }
    return { ps, of };
  };
  const bodies = (regs: Region[]) => {
    const { ps, of } = flat(regs), { adj } = connections(ps), comp = new Map<Pc, number>();
    let n = 0;
    for (let i = 0; i < ps.length; i++) {
      if (comp.has(of[i])) continue;
      const st = [i];
      comp.set(of[i], n);
      while (st.length) for (const q of adj[st.pop()!].keys()) if (!comp.has(of[q])) { comp.set(of[q], n); st.push(q); }
      n++;
    }
    return { n, comp };
  };
  const failed = new WeakMap<Region[], Set<string>>();   // tries that did not tie these layers, not made again
  function join(regs: Region[]): boolean {
    const { n, comp } = bodies(regs), size = new Map<number, number>(), nope = failed.get(regs) ?? new Set<string>();
    if (n <= 1) return false;
    failed.set(regs, nope);
    for (const b of comp.values()) size.set(b, (size.get(b) ?? 0) + 1);
    let budget = 80;
    for (const recolour of [false, true]) for (const g of regs) for (const a of g.cells) for (const o of [1024, 1]) {
      const b = a + o, pa = g.own.get(a), pb = g.own.get(b);
      if (!pa || !pb || comp.get(pa) === comp.get(pb) || (!recolour && !compat(g, a, b)) || (recolour && g.part !== 'side')) continue;
      // plates may change the colour of their side: one of the two cells takes the other's colour, or the smaller
      // part (a few cells) takes the other's, or a plate next to the joint takes a neighbour's
      const tries: [number[], number][] = recolour ? [] : [[[], 0]];
      if (recolour) {
        const small = size.get(comp.get(pa)!)! <= size.get(comp.get(pb)!)! ? pa : pb;
        const part = [...g.cells].filter(c => comp.get(g.own.get(c)!) === comp.get(small));
        if (!compat(g, a, b)) tries.push([[b], g.colour(a)], [[a], g.colour(b)]);
        if (part.length <= 6) tries.push([part, g.colour(small === pa ? b : a)]);
        for (const c of new Set([a, b].flatMap(p => [p, p + 1024, p - 1024, p + 1, p - 1, p + 1025, p - 1025, p + 1023, p - 1023]))) {
          if (!g.cells.has(c) || !g.vis(c)) continue;
          for (const col of new Set(NB.map(q => c + q).filter(q => g.cells.has(q) && g.vis(q)).map(g.colour))) if (col !== g.colour(c)) tries.push([[c], col]);
        }
      }
      for (const [side, col] of tries) {
        const id = `${g.y}${g.part}:${a}:${b}:${side}:${col}`;
        if (nope.has(id)) continue;
        if (--budget < 0) return false;
        const was = side.map(c => lv.get(c)![g.L].side), saved = new Map(g.own);
        for (const c of side) lv.get(c)![g.L].side = col;
        if ((local(g, a, 1, b) || local(g, a, 2, b)) && bodies(regs).n < n) { for (const c of side) recoloured.add(`${c}:${g.L}`); return true; }
        g.own = saved; nope.add(id);
        side.forEach((c, i) => { lv.get(c)![g.L].side = was[i]; });
      }
    }
    return false;
  }

  /** lay every layer; fix lone cells and stubs until none is left */
  function run(studs: boolean) {
    reshape();
    let t = tileAll(studs);
    for (let round = 0; ; round++) {
      for (let it = 0; it < 40 && t.fails.length; it++) {
        const fresh = new Set<number>(), lone = new Set(t.fails.map(f => f.c));
        for (const f of t.fails) fix(f.g, f.c, fresh, lone);
        reshape();
        t = tileAll(studs);
      }
      for (let it = 0; it < 40 && join(t.regs); it++);
      // a few cells still apart (a stub the pieces can't tie in): drop them and lay again
      const { n, comp } = bodies(t.regs), foot = new Map<number, Set<number>>(), low = new Map<number, number>();
      if (n <= 1 || round === 3) break;
      for (const g of t.regs) for (const [c, pc] of g.own) { const b = comp.get(pc)!; if (!foot.has(b)) foot.set(b, new Set()); foot.get(b)!.add(c); }
      const main = [...foot].sort((a, b) => b[1].size - a[1].size)[0][0];
      for (const g of t.regs) for (const [c, pc] of g.own) {
        const b = comp.get(pc)!;
        if (b !== main && foot.get(b)!.size <= 8) low.set(c, Math.min(low.get(c) ?? g.L, g.L));
      }
      if (!low.size) break;
      for (const [c, L] of low) { cut(c, L); noRaise.add(c); stepped.add(c); }
      reshape();
      t = tileAll(studs);
    }
    return t;
  }
  // the studded look keeps the smooth look's shape and colours, only the tops change; where its plates can't
  // be laid so (a cell trimmed, the ribbon in two), the smooth look's pieces with plates for tiles
  let t = run(false);
  if (opts.studs) {
    const smooth = t, was = new Map([...lv].map(([c, a]) => [c, a.map(v => ({ ...v }))])), rec = [...recoloured], st = [...stepped];
    t = run(true);
    if (lv.size !== was.size || [...was].some(([c, a]) => h(c) !== a.length) || bodies(t.regs).n > bodies(smooth.regs).n) {
      lv.clear(); recoloured.clear(); stepped.clear(); ver++;
      for (const [c, a] of was) lv.set(c, a);
      rec.forEach(x => recoloured.add(x)); st.forEach(x => stepped.add(x));
      t = { regs: smooth.regs.map(asPlates), fails: [] };
    }
  }
  const loose = bodies(t.regs).n - 1;
  // the pieces nobody sees, laid black, take the ribbon's colour there, bottom to top
  const colourAt = new Map<number, Map<number, number>>();
  for (const g of t.regs) {
    const here = colourAt.get(g.y) ?? new Map<number, number>();
    colourAt.set(g.y, here);
    for (const pc of new Set(g.own.values())) {
      if (pc.c === BLACK && !pc.cells.some(g.vis)) pc.c = inside(g, pc, colourAt.get(g.y - 1));
      for (const c of pc.cells) here.set(c, pc.c);
    }
  }

  const pieces = flat(t.regs).ps;
  const cells = [...lv.keys()].sort((a, b) => a - b);
  const stack = new Map(cells.map(c => [c, h(c)]));
  const maxStack = Math.max(...stack.values());
  const near = (p: { x: number; z: number }) => {
    const c = key(Math.floor(p.x), Math.floor(p.z)), dist = (q: number) => Math.hypot(kx(q) + 0.5 - p.x, kz(q) + 0.5 - p.z);
    return lv.has(c) ? c : cells.reduce((b, q) => dist(q) < dist(b) ? q : b);
  };
  // the ends: about a stud in from each tip, under the stroke, not at the ribbon's very edge. Where a support stands
  // along the line is the nearest point of the stretch of line within width/2 + 1 of it (a jittery line's arc runs
  // ahead of the distance covered): that point, on the stretch from the tip, is at most 1.8 studs from the tip
  const total = line[line.length - 1].s, at = (s: number) => line.find(p => p.s >= s) ?? line[line.length - 1];
  const endOf = (last: boolean) => {
    const tip = last ? line[line.length - 1] : line[0], R = width / 2 + 1, fallback = near(at(last ? Math.max(total - 1, total / 2) : Math.min(1, total / 2)));
    let best = fallback, low = Infinity;
    for (const c of cells) {
      const cx = kx(c) + 0.5, cz = kz(c) + 0.5;
      if (Math.hypot(cx - tip.x, cz - tip.z) > 3) continue;
      // the stretch from the tip: points within R, until a gap of over a stud along the line
      let bs = 0, bd = Infinity, prev = NaN;
      for (let n = 0; n + 1 < line.length; n++) {
        const i = last ? line.length - 2 - n : n, a = line[i], b = line[i + 1], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz;
        const t = l2 ? Math.max(0, Math.min(1, ((cx - a.x) * vx + (cz - a.z) * vz) / l2)) : 0, d = Math.hypot(a.x + t * vx - cx, a.z + t * vz - cz);
        if (d > R) continue;
        const s = a.s + t * (b.s - a.s), from = last ? total - s : s;
        if (from - prev > 1) break;
        prev = from;
        if (d < bd) { bd = d; bs = from; }
      }
      const score = Math.abs(bs - 1) + (bs > 1.8 ? 100 : 0) + (bd > r - 0.5 ? 10 : 0) + 0.1 * bd;
      if (bd < Infinity && score < low) { low = score; best = c; }
    }
    return best;
  };
  const ends: [number, number] = [endOf(false), endOf(true)];
  const xs = cells.map(kx), zs = cells.map(kz);
  const bounds = { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs) + 1, z1: Math.max(...zs) + 1 };
  const singles = pieces.filter(p => p.w * p.d === 1).length, plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;

  // dense: passes side by side (near parallel, > 2 widths apart along the line) closer than the ribbon is wide (median)
  const side: number[] = [];
  for (let j = 0; j < SX.length; j += 4) {
    let m = Infinity;
    for (let i = 0; i < SX.length; i += 2) if (Math.abs(SS[i] - SS[j]) > far && Math.abs(TX[i] * TX[j] + TZ[i] * TZ[j]) >= 0.87) m = Math.min(m, Math.hypot(SX[i] - SX[j], SZ[i] - SZ[j]));
    if (m <= 2.5 * width) side.push(m);
  }
  side.sort((a, b) => a - b);
  const dense = side.length * 12 > SX.length && side[side.length >> 1] < width;

  const notes = [`The ribbon is ${width} studs wide and ${bounds.x1 - bounds.x0}×${bounds.z1 - bounds.z0} studs overall, in ${pieces.length} pieces.`];
  if (maxStack > 1) notes.push(`Where the line crosses or runs alongside itself, one stretch steps up 3 plates so both keep their edges; where they cross, the later stretch goes on top, as in the drawing. At its highest the ribbon is ${maxStack * SLAB} plates thick.`);
  if (dense && scale === 'small') notes.push('Dense Squiggle: its loops lie closer together than the ribbon is wide, so some run into each other; the Large size shows them better.');
  notes.push(opts.studs ? 'Studded look: plates on top, studs showing.' : 'Smooth look: tiles on top, with plates only where a raised stretch sits.');
  if (curve.type === 'Pipe') notes.push('Pipe: a black edge on each side of the colour core.');
  if (curve.type === 'Ribbed') notes.push(`Ribbed: ${ribC === BLACK ? 'black' : 'white'} ribs on top, 1 stud every 2 studs${slips ? ` (${plural(slips, 'rib')} left out where ${slips > 1 ? 'they' : 'it'} would hide a whole colour)` : ''}; the plates underneath keep the line’s colours.`);
  if (recoloured.size) notes.push(`${plural(recoloured.size, 'stud')} recoloured to a neighbour’s colour, so no piece is a single stud and the ribbon holds together.`);
  if (stepped.size) notes.push(`${plural(stepped.size, 'stud')} raised, lowered or trimmed off the edge for the same reason.`);
  if (singles) notes.push(singles > 1 ? `${singles} single-stud pieces remain.` : 'One single-stud piece remains.');
  if (loose) notes.push(loose > 1 ? `${loose} small parts of the ribbon are held only by what they sit on.` : 'One small part of the ribbon is held only by what it sits on.');

  return {
    pieces, panel: { w: W, h: H }, cells, stack, bottom: cells, ends, line, colors, width, k, offset, bounds,
    maxStack, recoloured: recoloured.size, dense, notes,
  };
}

const toPiece = (g: Region, pc: Pc): Piece =>
  ({ x: kx(pc.cells[0]), z: kz(pc.cells[0]), y: g.y, h: 1, w: pc.w, d: pc.d, c: pc.c, kind: g.kind, part: partId(g.kind, pc.w, pc.d), role: 'squiggle' });
const shapesOf = (sizes: [number, number][]) => sizes.filter(([a, b]) => a * b > 1).flatMap(([a, b]): [number, number][] => a === b ? [[a, b]] : [[a, b], [b, a]]);
const SHAPES = { plate: shapesOf(SIZES), tile: shapesOf(TILE_SIZES) };
const scan = (prefX: boolean) => prefX ? (a: number, b: number) => kz(a) - kz(b) || kx(a) - kx(b) : (a: number, b: number) => a - b;
const free = (g: Region, c: number) => g.cells.has(c) && !g.own.has(c);
const compat = (g: Region, p: number, q: number) => !(g.vis(p) && g.vis(q) && g.colour(p) !== g.colour(q));
const place = (g: Region, pc: Pc) => { for (const c of pc.cells) g.own.set(c, pc); };
/** a tiled region in plates of the same sizes (two halves where that plate is not sold in its colour) */
const asPlates = (g: Region): Region => {
  if (g.kind === 'plate') return g;
  const out: Region = { ...g, kind: 'plate', own: new Map() };
  for (const pc of new Set(g.own.values())) {
    const long = pc.w >= pc.d, n = long ? pc.w : pc.d, half = n >> 1, at = (c: number) => long ? kx(c) - kx(pc.cells[0]) : kz(c) - kz(pc.cells[0]);
    const sold = availableAtLego('plate', pc.w, pc.d, pc.c);
    for (const i of sold ? [-1] : [0, 1]) {
      const len = i ? n - half : half;
      place(out, i < 0 ? pc : { ...pc, cells: pc.cells.filter(c => (at(c) < half) === !i), w: long ? len : pc.w, d: long ? pc.d : len });
    }
  }
  return out;
};
const lift = (g: Region, pc: Pc) => { for (const c of pc.cells) g.own.delete(c); };

const SOLD = new Map<string, boolean>();
const sold = (kind: 'plate' | 'tile', w: number, d: number, c: number) => {
  const id = `${kind}${w}x${d}:${c}`;
  if (!SOLD.has(id)) SOLD.set(id, availableAtLego(kind, w, d, c));
  return SOLD.get(id)!;
};
/** colours by how often `f` gives them over `cells`, commonest first */
const commonest = (cells: number[], f: (c: number) => number | undefined) => {
  const n = new Map<number, number>();
  for (const c of cells) { const k = f(c); if (k !== undefined) n.set(k, (n.get(k) ?? 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1]).map(e => e[0]);
};
/**
 * The colour of a piece over hidden cells only (laid black: any colour would do): the ribbon's own there (the
 * commonest sold in that size), so it shows no black hole while the ribbon is built; else the nearest along the
 * spectrum, one beside it or under it (`under`: cell → colour of the layer below) first; black when none is sold.
 */
function inside(g: Region, pc: Pc, under: Map<number, number> | undefined): number {
  const ok = (k: number) => sold(g.kind, pc.w, pc.d, k), own = commonest(pc.cells, g.colour), mine = own.find(ok);
  if (mine !== undefined || !SPEC.has(own[0])) return mine ?? BLACK;
  const ring = pc.cells.flatMap(c => NB.map(o => c + o)).filter(q => !pc.cells.includes(q) && g.cells.has(q));
  const about = [...commonest(ring, g.colour), ...commonest(pc.cells, c => under?.get(c))], rank = (k: number) => { const i = about.indexOf(k); return i < 0 ? about.length : i; };
  return SPECTRUM.map(s => s.id).filter(ok).sort((a, b) => steps(a, own[0]) - steps(b, own[0]) || rank(a) - rank(b))[0] ?? BLACK;
}

/**
 * The piece w×d with its front-left corner at (x, z), or null: free cells, visible ones
 * all one colour (hidden ones take any), sold in that colour. Score: larger, crossing the
 * joints of the layer below, running the preferred way; `strict` refuses a piece that
 * takes the last partner of a neighbour.
 */
function rect(g: Region, x: number, z: number, w: number, d: number, strict: boolean): Pc | null {
  const cs: number[] = [];
  let col = -1;
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
    const c = key(x + i, z + j);
    if (!free(g, c)) return null;
    if (g.vis(c)) { const k = g.colour(c); if (col >= 0 && k !== col) return null; col = k; }
    cs.push(c);
  }
  const pc = col < 0 ? BLACK : col;
  if (!sold(g.kind, w, d, pc)) return null;
  const inP = (q: number) => { const qx = kx(q) - x, qz = kz(q) - z; return qx >= 0 && qx < w && qz >= 0 && qz < d; };
  let strand = 0, crossed = 0, aligned = 0;
  for (const c of cs) {
    const a = g.lower?.get(c);
    for (const o of NB) {
      const q = c + o, b = g.lower?.get(q), seam = a !== undefined && b !== undefined && a !== b;
      if (inP(q)) { if (o > 0 && seam) crossed++; continue; }
      if (seam && g.cells.has(q)) aligned++;
      if (!free(g, q)) continue;
      // a free neighbour left with no partner, where the piece took its last one
      let mine = false, other = false;
      for (const o2 of NB) {
        const p = q + o2;
        if (inP(p)) mine ||= compat(g, q, p); else other ||= free(g, p) && compat(g, q, p);
      }
      if (mine && !other) strand++;
    }
  }
  if (strict && strand) return null;
  return { cells: cs, w, d, c: pc, score: w * d + 4 * crossed - 2 * aligned + ((g.prefX ? w > d : d > w) ? 0.5 : 0) - 100 * strand };
}
const cands = (g: Region, c0: number, strict: boolean) =>
  SHAPES[g.kind].map(([w, d]) => rect(g, kx(c0), kz(c0), w, d, strict)).filter((p): p is Pc => !!p).sort((a, b) => b.score - a.score);

/** exact fill of the free cells among `cells`, depth-first, best piece first; with `alone`, a cell no
 *  neighbour can share a piece with stays alone (fix() recolours it) instead of stopping the rest */
function solve(g: Region, cells: number[], most: number, alone = false): boolean {
  const order = cells.filter(c => free(g, c)).sort(scan(g.prefX)), budget = Math.min(most, 40 * order.length);
  let nodes = 0;
  // what is left to fill depends only on which cells from p on are taken: a state that failed once fails
  // again, after as many tries (counted, so the budget runs out where it did and the result is the same)
  const dead = new Map<string, number>();
  const rec = (p: number): boolean => {
    while (p < order.length && !free(g, order[p])) p++;
    if (p === order.length) return true;
    let id = `${p}:`;
    for (let i = p + 1; i < order.length; i++) id += free(g, order[i]) ? '0' : '1';
    const was = dead.get(id);
    if (was !== undefined) { nodes += was; return false; }
    const n0 = nodes, c = order[p], cs = cands(g, c, true);
    if (alone && !cs.length && !NB.some(o => g.cells.has(c + o) && compat(g, c, c + o))) cs.push({ cells: [c], w: 1, d: 1, c: g.vis(c) ? g.colour(c) : BLACK, score: 0 });
    for (const pc of cs) {
      if (++nodes > budget) return false;
      place(g, pc);
      if (rec(p + 1)) return true;
      lift(g, pc);
    }
    dead.set(id, nodes - n0);
    return false;
  };
  return rec(0);
}

/** re-lay the pieces within r of `at` without 1×1 (but for hopeless cells, with `alone`); with `join`, one
 *  piece (smallest first) must hold both cells */
function local(g: Region, at: number, r: number, join?: number, alone = false): boolean {
  const gone = new Set<Pc>();
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) { const pc = g.own.get(key(kx(at) + i, kz(at) + j)); if (pc) gone.add(pc); }
  if (join !== undefined) gone.add(g.own.get(join)!);
  const cells = [...gone].flatMap(pc => pc.cells);
  for (const pc of gone) lift(g, pc);
  const firsts: (Pc | null)[] = [null];
  if (join !== undefined) {
    firsts.length = 0;
    for (const [w, d] of SHAPES[g.kind]) for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
      const X = kx(at) - i, Z = kz(at) - j, pc = kx(join) < X + w && kz(join) < Z + d && kx(join) >= X && kz(join) >= Z ? rect(g, X, Z, w, d, true) : null;
      if (pc) firsts.push(pc);
    }
    firsts.sort((a, b) => a!.cells.length - b!.cells.length || b!.score - a!.score).splice(4);
  }
  for (const first of firsts) {
    if (first) place(g, first);
    if (solve(g, cells, join === undefined ? 2500 : 800, alone)) return true;
    if (first) lift(g, first);
  }
  for (const pc of gone) place(g, pc);
  return false;
}

/** greedy fill in scan order, then local repairs of any 1×1; returns the cells still alone */
function fill(g: Region): number[] {
  for (const c of [...g.cells].sort(scan(g.prefX))) {
    if (!g.own.has(c)) place(g, cands(g, c, true)[0] ?? cands(g, c, false)[0] ?? { cells: [c], w: 1, d: 1, c: g.vis(c) ? g.colour(c) : BLACK, score: 0 });
  }
  const alone = () => [...g.own.values()].filter(pc => pc.cells.length === 1).map(pc => pc.cells[0]);
  for (const c of alone()) {
    if (!NB.some(o => g.cells.has(c + o) && compat(g, c, c + o))) continue;   // no neighbour can share a piece with it
    for (let r = 1; r <= 3 && g.own.get(c)?.cells.length === 1 && !local(g, c, r, undefined, true); r++);
    // still alone: one piece must hold it and a neighbour
    for (const o of NB) if (g.own.get(c)?.cells.length === 1 && g.cells.has(c + o) && compat(g, c, c + o) && (local(g, c, 1, c + o, true) || local(g, c, 2, c + o, true))) break;
  }
  return alone();
}
