// Stage 3 bis — the three displays of the Relief ribbon. Frame (default): a white
// panel in a 2-stud black Technic frame, hung on a wall. Floating: the ribbon on
// clear supports 6 plates above a black socle. Backdrop: Floating with a white
// brick wall behind it. The ribbon is the same in all three, only moved.
import { checkModel, connections, studsBelow } from '../core/check';
import { availableAtLego, elementId } from '../core/lego';
import { TRANS_CLEAR } from '../core/palette';
import { PARTS, partId, type Kind, type Piece } from '../core/parts';
import { key, kx, kz } from '../core/tile';
import type { Curve } from './curve';
import { PLATE_CM, STUD_CM, summarize, type Display, type Scale, type SqChecks, type SqModel } from './model';
import { nameplateLines } from './nameplate';
import { buildRibbon, RIBBON_PANEL, type Ribbon } from './ribbon';
import { BLACK, WHITE } from './spectrum';

export const SOCLE_W = [48, 64, 80], SOCLE_D = [24, 32, 40, 48];
/** frame width, lift of the ribbon (plates), socle margins, wall gap, brace depth, wall courses, pieces per step */
const RING = 2, LIFT = 6, SIDE = 4, FRONT = 3, GAP = 2, BRACE = 3, COURSES = 20, STEP_MAX = 60;

interface Rect { x: number; z: number; w: number; d: number }
/** a layer's joints: 1 where cells (x−1, z) | (x, z) (v) or (x, z−1) | (x, z) (h) belong to two pieces */
interface Lines { v: (x: number, z: number) => number; h: (x: number, z: number) => number }
type Rule = SqChecks['rules'][number];

const owners = (rs: Rect[]) => {
  const m = new Map<number, number>();
  rs.forEach((r, i) => { for (let a = 0; a < r.w; a++) for (let b = 0; b < r.d; b++) m.set(key(r.x + a, r.z + b), i); });
  return m;
};
function linesOf(rs: Rect[]): Lines {
  const o = owners(rs), two = (p: number, q: number) => { const a = o.get(p), b = o.get(q); return a !== undefined && b !== undefined && a !== b ? 1 : 0; };
  return { v: (x, z) => two(key(x - 1, z), key(x, z)), h: (x, z) => two(key(x, z - 1), key(x, z)) };
}
const joints = (lens: number[], at = 0) => { const s = new Set<number>(); for (const l of lens.slice(0, -1)) s.add(at += l); return s; };

/** [0, n) cut into lengths from `lens` at the least cost: 1 per piece plus `extra`, plus `pen(j)` for a joint at j */
function cut(n: number, lens: number[], pen: (j: number) => number = () => 0, extra: (l: number) => number = () => 0) {
  const best = new Float64Array(n + 1).fill(Infinity), from = new Int32Array(n + 1);
  best[0] = 0;
  for (let i = 1; i <= n; i++) {
    const p = i < n ? pen(i) : 0;
    for (const l of lens) {
      if (l > i || best[i - l] === Infinity) continue;
      const c = best[i - l] + 1 + extra(l) + p;
      if (c < best[i] - 1e-9) { best[i] = c; from[i] = l; }
    }
  }
  if (best[n] === Infinity) return null;
  const out: number[] = [];
  for (let i = n; i > 0; i -= from[i]) out.unshift(from[i]);
  return { cost: best[n], lens: out };
}

const lenCache = new Map<string, number[]>();
/** lengths of the `kind` pieces `d` studs deep sold in colour c, largest first */
function lengths(kind: Kind, d: number, c: number): number[] {
  const k = `${kind}${d}/${c}`;
  let out = lenCache.get(k);
  if (!out) {
    const s = new Set<number>();
    for (const n of Object.keys(PARTS[kind])) {
      const m = n.match(/^(\d+)x(\d+)$/);
      if (!m) continue;
      const a = +m[1], b = +m[2];
      if (a === d && availableAtLego(kind, b, a, c)) s.add(b);
      if (b === d && availableAtLego(kind, a, b, c)) s.add(a);
    }
    lenCache.set(k, out = [...s].sort((p, q) => q - p));
  }
  return out;
}

/** a rectangle of large plates in strips along x (strips of their own depths), the joints kept off `avoid` */
function plates(x0: number, z0: number, W: number, D: number, c: number, avoid: Lines): Rect[] {
  const depths = [...new Set(Object.keys(PARTS.plate).flatMap(s => s.split('x').map(Number)))]
    .filter(d => d >= 2 && lengths('plate', d, c).some(l => l >= 2)).sort((a, b) => b - a);
  const memo = new Map<number, ReturnType<typeof cut>>();
  const strip = (z: number, d: number) => {
    const k = z * 64 + d;
    if (!memo.has(k)) memo.set(k, cut(W, lengths('plate', d, c).filter(l => l >= 2), j => { let n = 0; for (let t = 0; t < d; t++) n += avoid.v(x0 + j, z0 + z + t); return n; }));
    return memo.get(k)!;
  };
  const best = new Float64Array(D + 1).fill(Infinity), from = new Int32Array(D + 1);
  best[0] = 0;
  for (let j = 1; j <= D; j++) for (const d of depths) {
    const s = d <= j && best[j - d] < Infinity ? strip(j - d, d) : null;
    if (!s) continue;
    let pen = 0;
    if (j > d) for (let x = 0; x < W; x++) pen += avoid.h(x0 + x, z0 + j - d);
    if (best[j - d] + s.cost + pen < best[j] - 1e-9) { best[j] = best[j - d] + s.cost + pen; from[j] = d; }
  }
  const out: Rect[] = [];
  for (let j = D; j > 0; j -= from[j]) {
    let x = x0;
    for (const l of strip(j - from[j], from[j])!.lens) { out.push({ x, z: z0 + j - from[j], w: l, d: from[j] }); x += l; }
  }
  return out;
}

/**
 * The socle's tiles: rows of 2×N tiles one stud off the plates' strips (so they cross every
 * seam along z), joints off the plates' joints along x, 1×N tiles around the holes.
 */
function socleTiles(W: number, D: number, hole: (x: number, z: number) => boolean, pl: Lines): Rect[] {
  const T1 = lengths('tile', 1, BLACK), T2 = lengths('tile', 2, BLACK), out: Rect[] = [];
  const row = (z: number, a: number, e: number) => {
    let cost = 0;
    const rs: Rect[] = [];
    for (let x = a; x < e;) {
      if (hole(x, z)) { x++; continue; }
      let f = x;
      while (f < e && !hole(f, z)) f++;
      const x0 = x, r = cut(f - x, T1, j => 2 * pl.v(x0 + j, z), l => (l === 1 ? 6 : 0))!;
      cost += r.cost;
      for (const l of r.lens) { rs.push({ x, z, w: l, d: 1 }); x += l; }
    }
    return { cost, rs };
  };
  for (let z = 0; z < D;) {
    if (z === 0 || z === D - 1) { out.push(...row(z, 0, W).rs); z++; continue; }
    const free = (x: number) => !hole(x, z) && !hole(x, z + 1);
    const jp = (x: number) => x >= W ? 0 : [z, z + 1].reduce((n, r) => n + (!hole(x - 1, r) && !hole(x, r) ? 2 * pl.v(x, r) : 0), 0);
    const best = new Float64Array(W + 1).fill(Infinity), from = new Int32Array(W + 1), how: Rect[][] = [];
    best[0] = 0;
    for (let x = 0; x < W; x++) {
      if (best[x] === Infinity) continue;
      const go = (e: number, c: number, rs: Rect[]) => { c += best[x] + jp(e); if (c < best[e] - 1e-9) { best[e] = c; from[e] = x; how[e] = rs; } };
      for (const L of T2) {
        let ok = x + L <= W;
        for (let i = 0; ok && i < L; i++) ok = free(x + i);
        if (ok) go(x + L, L === 1 ? 1.5 : 1, [{ x, z, w: L, d: 2 }]);
      }
      // the two rows apart, where a hole is in the way
      for (let L = 1; L <= 8 && x + L <= W; L++) {
        const a = row(z, x, x + L), b = row(z + 1, x, x + L);
        let miss = 0;
        for (let i = x; i < x + L; i++) if (free(i)) miss += 2 * pl.h(i, z + 1);
        go(x + L, a.cost + b.cost + 0.5 + miss, [...a.rs, ...b.rs]);
      }
    }
    for (let e = W; e > 0; e = from[e]) out.push(...how[e]);
    z += 2;
  }
  return out;
}

const pc = (kind: Kind, x: number, z: number, y: number, w: number, d: number, c: number, more: Partial<Piece> = {}): Piece => {
  const h = kind === 'plate' || kind === 'tile' ? 1 : more.h ?? 3;
  return { x, z, y, h, w, d, c, kind, part: partId(kind, w, d, h), role: 'display', ...more };
};

/** pieces, steps and step notes being put together */
function kit() {
  const pieces: Piece[] = [], steps: number[][] = [], stepNotes: Record<number, string> = {};
  const add = (p: Piece) => pieces.push(p) - 1;
  const put = (rs: Rect[], kind: Kind, y: number, c: number, more: Partial<Piece> = {}) => rs.map(r => add(pc(kind, r.x, r.z, y, r.w, r.d, c, more)));
  const step = (ids: number[], note?: string) => { if (!ids.length) return; if (note) stepNotes[steps.length] = note; steps.push(ids); };
  /** the ribbon moved by (dx, dy, dz), layer by layer, long layers cut into bands from left to right */
  const ribbon = (rb: Ribbon, dx: number, dy: number, dz: number, note?: string) => {
    const layers = new Map<number, number[]>();
    for (const p of rb.pieces) {
      const i = add({ ...p, x: p.x + dx, y: p.y + dy, z: p.z + dz });
      if (!layers.has(p.y)) layers.set(p.y, []);
      layers.get(p.y)!.push(i);
    }
    let first = true;
    for (const y of [...layers.keys()].sort((a, b) => a - b)) {
      const ids = layers.get(y)!.sort((a, b) => pieces[a].x * 2 + pieces[a].w - pieces[b].x * 2 - pieces[b].w || pieces[a].z - pieces[b].z);
      // bands of at most STEP_MAX pieces and, while a band keeps 12 pieces or more, 20 kinds of piece (the booklet's parts box)
      const band = (n: number, j: number) => ids.slice(Math.round((j * ids.length) / n), Math.round(((j + 1) * ids.length) / n));
      const lots = (q: number[]) => new Set(q.map(i => `${pieces[i].part}|${pieces[i].c}`)).size;
      let n = Math.ceil(ids.length / STEP_MAX);
      while (ids.length / (n + 1) >= 12 && [...Array(n).keys()].some(j => lots(band(n, j)) > 20)) n++;
      for (let j = 0; j < n; j++, first = false) step(band(n, j), first ? note : undefined);
    }
    return [...layers.values()].flat();
  };
  return { pieces, steps, stepNotes, add, put, step, ribbon };
}

/** seams between the `base` pieces, and how many studs of each one a single `top` piece spans */
function bridging(base: Piece[], top: Piece[]) {
  const bo = owners(base), to = owners(top), seams = new Map<string, [number, number]>();
  for (const [c, i] of bo) for (const o of [1024, 1]) {
    const j = bo.get(c + o);
    if (j === undefined || j === i) continue;
    const id = `${i}:${j}:${o}`, s = seams.get(id) ?? [0, 0];
    s[0]++;
    if (to.has(c) && to.get(c) === to.get(c + o)) s[1]++;
    seams.set(id, s);
  }
  const short = [...seams.values()].filter(([n, b]) => 2 * b < n).length;
  return { ok: !short, short };
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** the margins too narrow, in words: "only 3 studs on the left and 2 at the front" */
const tight = (ms: [string, number, number][]) => {
  const bad = ms.filter(([, v, min]) => v < min).map(([side, v]) => `${plural(v, 'stud')} ${side}`);
  return bad.length ? `Too close to the edge: only ${bad.join(' and ')}` : '';
};

// ---- Frame ----

function frame(rb: Ribbon, scale: Scale) {
  const { w: W, h: H } = rb.panel, OW = W + 2 * RING, OH = H + 2 * RING, K = kit();
  const TECH = lengths('technic', 1, BLACK), CAP = lengths('tile', 2, BLACK).filter(l => l >= 2);
  // backing, its joints off the frame's rows and the panel's edge; the white panel's off the backing's
  const edgeX = new Set([1, 2, W + 2, W + 3]), edgeZ = new Set([1, 2, H + 2, H + 3]);
  const backRects = plates(0, 0, OW, OH, BLACK, { v: x => +edgeX.has(x), h: (_, z) => +edgeZ.has(z) });
  const bl = linesOf(backRects), panelRects = plates(RING, RING, W, H, WHITE, bl);
  const back = K.put(backRects, 'plate', 0, BLACK);
  K.step(back, `Lay the ${back.length} black backing plates edge to edge, studs up: the white panel and the frame on top join them.`);
  const panel = K.put(panelRects, 'plate', 1, WHITE);
  K.step(panel);

  // hanging points near the top corners, spacers near the bottom ones: Technic 1×2 along z, holes along x
  const hang = [[1, H + 1], [W + 2, H + 1], [1, 1], [W + 2, 1]].map(([x, z]) => K.add(pc('technic', x, z, -3, 1, 2, BLACK)));
  K.step(hang, 'Turn the backing over and press the 4 Technic bricks 1×2 onto its back, holes running left to right: the two at the top take the picture cord, the two at the bottom keep the frame flat against the wall. Turn it back.');

  // the frame: two rows of Technic bricks all round, joints off the backing's, each other's and the cap's ends
  const ring: number[] = [], rowJ = new Map<string, Set<number>>();
  const along = (outer: number, inner: number, fixed: Set<number>) => {
    let other = new Set<number>();
    for (const z of [outer, inner]) {
      const lens = cut(OW, TECH, j => 2 * bl.v(j, z) + (fixed.has(j) ? 4 : 0) + (other.has(j) ? 4 : 0))!.lens;
      let x = 0;
      for (const l of lens) { ring.push(K.add(pc('technic', x, z, 1, l, 1, BLACK))); x += l; }
      other = joints(lens);
      rowJ.set(`z${z}`, other);
    }
  };
  const side = (outer: number, inner: number) => {
    let other = new Set<number>();
    for (const x of [outer, inner]) {
      const lens = cut(H, TECH, j => 2 * bl.h(x, RING + j) + (other.has(j) ? 4 : 0))!.lens;
      let z = RING;
      for (const l of lens) { ring.push(K.add(pc('technic', x, z, 1, 1, l, BLACK))); z += l; }
      other = joints(lens);
      rowJ.set(`x${x}`, new Set([...other].map(j => j + RING)));
    }
  };
  along(0, 1, new Set([RING, W - 4, W + RING]));
  along(OH - 1, OH - 2, new Set([RING, W + RING]));
  side(0, 1);
  side(OW - 1, OW - 2);
  K.step(ring);

  // cap: 2×N tiles over both rows; the side ones run over the corners and tie the frame together
  const cap: number[] = [], under = (a: string, b: string) => new Set([...rowJ.get(a)!, ...rowJ.get(b)!]);
  const capAlong = (z: number, from: number, n: number, below: Set<number>) => {
    let x = from;
    for (const l of cut(n, CAP, j => (below.has(from + j) ? 4 : 0))!.lens) { cap.push(K.add(pc('tile', x, z, 4, l, 2, BLACK))); x += l; }
  };
  const capSide = (x: number, below: Set<number>) => {
    let z = 0;
    for (const l of cut(OH, CAP, j => (below.has(j) || j === RING || j === H + RING ? 4 : 0))!.lens) { cap.push(K.add(pc('tile', x, z, 4, 2, l, BLACK))); z += l; }
  };
  capAlong(0, RING, W - 6, under('z0', 'z1'));
  capAlong(OH - 2, RING, W, under(`z${OH - 1}`, `z${OH - 2}`));
  capSide(0, under('x0', 'x1'));
  capSide(OW - 2, under(`x${OW - 1}`, `x${OW - 2}`));
  K.step(cap, 'Leave the 2×6 gap at the bottom right: the nameplate tile goes there last.');

  const rib = K.ribbon(rb, RING, 2, RING);
  const np = K.add(pc('tile', W - 4, 0, 4, 6, 2, BLACK, { nameplate: true }));
  K.step([np]);

  // rules, read back from the pieces
  const P = K.pieces, of = (ids: number[]) => ids.map(i => P[i]);
  const inRing = (x: number, z: number) => x < RING || z < RING || x >= W + RING || z >= H + RING;
  const cover = (ps: Piece[]) => { const m = new Map<number, number>(); for (const p of ps) for (let a = 0; a < p.w; a++) for (let b = 0; b < p.d; b++) m.set(key(p.x + a, p.z + b), (m.get(key(p.x + a, p.z + b)) ?? 0) + 1); return m; };
  const techCover = cover(of(ring).filter(p => p.y === 1 && p.h === 3)), capCover = cover(of([...cap, np]).filter(p => p.y === 4));
  let ringCells = 0, gaps = 0;
  for (let x = 0; x < OW; x++) for (let z = 0; z < OH; z++) if (inRing(x, z)) { ringCells++; if (techCover.get(key(x, z)) !== 1 || capCover.get(key(x, z)) !== 1) gaps++; }
  const body = of([...ring, ...cap, np]), { adj } = connections(body), seen = new Set([0]), st = [0];
  while (st.length) for (const n of adj[st.pop()!].keys()) if (!seen.has(n)) { seen.add(n); st.push(n); }
  const panelArea = of(panel).reduce((n, p) => n + p.w * p.d, 0), backArea = of(back).reduce((n, p) => n + p.w * p.d, 0);
  const b1 = bridging(of(back), of([...panel, ...ring])), b2 = bridging(of(panel), of(back));
  const { x0, z0, x1, z1 } = rb.bounds, hp = of(hang);
  const holesAlongX = hp.every(p => p.kind === 'technic' && p.w === 1 && p.d === 2 && p.y === -3);
  const panelOk = W === RIBBON_PANEL[scale].w && H === RIBBON_PANEL[scale].h && panelArea === W * H && backArea === OW * OH;
  const roomy = x0 >= 4 && W - x1 >= 4 && z0 >= 1 && H - z1 >= 1, closed = !gaps && seen.size === body.length;
  const hangOk = holesAlongX && hp[0].z > OH / 2 && hp[1].z > OH / 2 && hp[2].z < OH / 2 && hp[3].z < OH / 2;
  const rules: Rule[] = [
    { name: 'Panel size', ok: panelOk, detail: panelOk ? `A ${W}×${H} white panel, ${OW}×${OH} studs with its frame` : `The plates don’t fill the ${W}×${H} panel and its ${OW}×${OH} backing` },
    {
      name: 'Room around the Squiggle', ok: roomy,
      detail: roomy ? 'At least 4 studs of white left and right of the Squiggle, and 1 above and below'
        : tight([['on the left', x0, 4], ['on the right', W - x1, 4], ['below', z0, 1], ['above', H - z1, 1]]),
    },
    {
      name: 'Plates held together', ok: b1.ok && b2.ok,
      detail: b1.ok && b2.ok ? 'Every joint between the back plates is covered by the plates above, and every joint in the white panel by the back plates below'
        : `${plural(b1.short + b2.short, 'joint')} between the plates covered along less than half ${b1.short + b2.short === 1 ? 'its' : 'their'} length`,
    },
    {
      name: 'Frame all the way round', ok: closed,
      detail: closed ? 'The frame goes all the way round in one piece: two rows of Technic bricks under a cap of tiles'
        : gaps ? `The frame has ${plural(gaps, 'gap')}` : 'The frame is in separate parts',
    },
    {
      name: 'Ready to hang', ok: hangOk,
      detail: hangOk ? 'Two Technic bricks near the top corners take the picture cord; two near the bottom keep it flat against the wall'
        : 'The four Technic bricks on the back are not where the cord and the wall need them',
    },
  ];
  const below = studsBelow(P);
  return {
    K, root: back, pose: 'wall' as const, np, hanging: hang.slice(0, 2), rules, com: false,
    twoStud: rib.filter(i => below[i] < 2).length,
    notes: [`Frame ${OW}×${OH} studs (${(OW * STUD_CM).toFixed(1)} × ${(OH * STUD_CM).toFixed(1)} cm): a ${W}×${H} white panel in a black Technic frame 2 studs wide.`],
  };
}

// ---- Floating and Backdrop ----

/**
 * Where the supports go (panel coordinates): under both ends, then along the line so that no two are
 * more than 8 studs apart. A support stands, on every pass of the line within width/2 + 1 of its cell,
 * at that pass's nearest point: the spacing is measured there, and holds too counting only the passes
 * whose stroke the cell touches (width/2 + ½). Cells of the ribbon's bottom layer only, near its front
 * edge where they can be (few footprint cells right in front of them): from the default camera a support
 * more than about 3 studs behind the edge is hidden and the ribbon seems to sit on the socle. `cost`
 * steers the choice too.
 */
function supportCells(rb: Ribbon, cost: (c: number) => number) {
  const L = rb.line, total = L[L.length - 1].s, reach = rb.width / 2 + 1, bottom = new Set(rb.bottom), foot = new Set(rb.cells);
  const front = (c: number) => { let n = 0; while (foot.has(c - n - 1)) n++; return n; };
  const stands = new Map<number, { s: number; d: number }[]>(), run = new Map<number, { s: number; d: number; prev: number }>();
  const push = (c: number, s: number, d: number) => { const t = stands.get(c); if (t) t.push({ s, d }); else stands.set(c, [{ s, d }]); };
  for (let i = 0; i + 1 < L.length; i++) {
    const a = L[i], b = L[i + 1], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz;
    for (let x = Math.ceil(Math.min(a.x, b.x) - reach - 0.5); x <= Math.floor(Math.max(a.x, b.x) + reach - 0.5); x++)
      for (let z = Math.ceil(Math.min(a.z, b.z) - reach - 0.5); z <= Math.floor(Math.max(a.z, b.z) + reach - 0.5); z++) {
        const c = key(x, z), cx = x + 0.5, cz = z + 0.5;
        if (!bottom.has(c)) continue;
        const t = l2 ? Math.max(0, Math.min(1, ((cx - a.x) * vx + (cz - a.z) * vz) / l2)) : 0, d = Math.hypot(a.x + t * vx - cx, a.z + t * vz - cz);
        if (d > reach) continue;
        const s = a.s + t * (b.s - a.s), r = run.get(c);
        if (!r) run.set(c, { s, d, prev: s });
        else {
          if (s - r.prev > 1) { push(c, r.s, r.d); r.s = s; r.d = d; } else if (d < r.d) { r.s = s; r.d = d; }
          r.prev = s;
        }
      }
  }
  for (const [c, r] of run) push(c, r.s, r.d);

  // no gap over 8 studs counting each support on the passes within reach, nor on the passes whose stroke it touches
  const MAX = 7.95, on = rb.width / 2 + 0.5, cells = [...new Set(rb.ends)], sts = (c: number) => stands.get(c) ?? [];
  const at = (cs: number[], r = reach) => cs.flatMap(c => sts(c).filter(t => t.d <= r).map(t => t.s)).sort((p, q) => p - q);
  const spaced = (cs: number[]) => [reach, on].every(r => at(cs, r).every((s, i, a) => !i || s - a[i - 1] <= MAX));
  const off = (c: number) => Math.min(...sts(c).map(t => t.d)), worth = (c: number, d: number) => cost(c) + 0.3 * d + 1.2 * front(c);
  const near = (cs: number[], c: number) => cs.some(q => Math.abs(kx(q) - kx(c)) <= 1 && Math.abs(kz(q) - kz(c)) <= 1);
  // between the ends, the cheapest chain of supports on the stroke along the line: each one costs 3, plus its cost,
  // its distance off the line and the cells in front of it
  const fixed = at(cells, on), cand = [...stands].flatMap(([c, ts]) => (cells.includes(c) ? [] : ts.filter(t => t.d <= on).map(t => ({ c, s: t.s, w: 3 + worth(c, t.d) })))).sort((p, q) => p.s - q.s);
  for (let k = 0; k + 1 < fixed.length; k++) {
    const a = fixed[k], b = fixed[k + 1], ns = cand.filter(n => n.s > a && n.s < b);
    if (b - a <= MAX) continue;
    const best = ns.map(n => (n.s - a <= MAX ? n.w : Infinity)), from = ns.map(() => -1);
    for (let i = 0; i < ns.length; i++) for (let j = i - 1; j >= 0 && ns[i].s - ns[j].s <= MAX; j--) if (best[j] + ns[i].w < best[i]) { best[i] = best[j] + ns[i].w; from[i] = j; }
    let e = -1;
    for (let i = 0; i < ns.length; i++) if (b - ns[i].s <= MAX && (e < 0 || best[i] < best[e])) e = i;
    for (let i = e; i >= 0; i = from[i]) if (!cells.includes(ns[i].c)) cells.push(ns[i].c);
  }
  // then, deepest first: move each support nearer the front edge where the spacing still holds, or drop it where
  // the others make up for it and it would stay hidden or next to another
  for (let pass = 0; pass < 2; pass++) for (const c of [...cells].sort((p, q) => front(q) - front(p))) {
    const i = cells.indexOf(c), rest = cells.filter(q => q !== c), score = (q: number) => worth(q, off(q)) + 4 * +near(rest, q);
    if (rb.ends.includes(c) || (front(c) <= 1 && !near(rest, c))) continue;
    let best = c, low = score(c);
    for (const q of stands.keys()) if (front(q) < front(c) && !cells.includes(q) && score(q) < low && spaced([...rest, q])) { best = q; low = score(q); }
    if ((front(best) > 1 || near(rest, best)) && spaced(rest)) cells.splice(i, 1);
    else cells[i] = best;
  }
  return { at: at(cells), cells, off: Math.max(...cells.map(off)), total };
}

function standing(rb: Ribbon, backdrop: boolean) {
  const K = kit(), { x0, z0, x1, z1 } = rb.bounds, bw = x1 - x0, bd = z1 - z0;
  const Ws = SOCLE_W.find(w => w >= bw + 2 * SIDE), need = backdrop ? bd + FRONT + GAP + 1 + BRACE : bd + 2 * FRONT, Ds = SOCLE_D.find(d => d >= need);
  const SW = Ws ?? SOCLE_W[SOCLE_W.length - 1], SD = Ds ?? SOCLE_D[SOCLE_D.length - 1];
  const fx = Math.floor((SW - bw) / 2), wz = backdrop ? SD - BRACE - 1 : -1, fz = backdrop ? wz - GAP - bd : Math.floor((SD - bd) / 2);
  const dx = fx - x0, dz = fz - z0, np = { x: Math.floor((SW - 6) / 2), z: Math.max(0, Math.floor((fz - 2) / 2)) };
  const bxs = backdrop ? [Math.round(SW / 4) - 2, Math.round((3 * SW) / 4) - 2] : [];
  const inBrace = (x: number) => bxs.some(b => x >= b && x < b + 4);
  const avoid: Lines = {
    v: (x, z) => +(z > wz && z <= wz + BRACE && bxs.some(b => x === b || x === b + 4)) + +(z >= np.z && z < np.z + 2 && (x === np.x || x === np.x + 6)),
    h: (x, z) => +(backdrop && (z === wz || z === wz + 1)) + +(x >= np.x && x < np.x + 6 && (z === np.z || z === np.z + 2)) + +(inBrace(x) && z === wz + 3),
  };
  const baseRects = plates(0, 0, SW, SD, BLACK, avoid), bl = linesOf(baseRects);
  const base = K.put(baseRects, 'plate', 0, BLACK);
  K.step(base, `Lay the ${base.length} black base plates edge to edge, studs up: the tiles on top join them.`);

  // supports off the plates' seams where they can be (no tile crosses a seam through a support's hole)
  const seamBy = (x: number, z: number) => bl.v(x, z) + bl.v(x + 1, z) + bl.h(x, z) + bl.h(x, z + 1);
  const sup = supportCells(rb, c => 2 * seamBy(kx(c) + dx, kz(c) + dz)), cols = sup.cells.map(c => [kx(c) + dx, kz(c) + dz]);
  // what stands on the plates directly: supports, the nameplate, the wall and the braces
  const holes = new Set(cols.map(([x, z]) => key(x, z)));
  for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) holes.add(key(np.x + i, np.z + j));
  if (backdrop) for (let x = 0; x < SW; x++) holes.add(key(x, wz));
  for (const b of bxs) for (let i = 0; i < 4; i++) for (let r = 1; r <= BRACE; r++) holes.add(key(b + i, wz + r));
  const tileRects = socleTiles(SW, SD, (x, z) => x < 0 || z < 0 || x >= SW || z >= SD || holes.has(key(x, z)), bl);
  const tiles = K.put(tileRects, 'tile', 1, BLACK);
  K.step(tiles, `Cover the base with ${tiles.length} black tiles. Leave the ${cols.length} single holes open for the supports${backdrop ? ', and the back row and two patches behind it for the wall and its braces' : ''}; the nameplate goes in last.`);

  // Backdrop: the white wall in running bond, and two braces behind it tied into its lower courses
  const wall: number[][] = [], braces: number[] = [], cap: number[] = [];
  let bond = 0;
  if (backdrop) {
    const WB = lengths('brick', 1, WHITE), ties = (c: number) => (c % 2 && c <= 5 ? bxs : []);
    let prev = new Set<number>();
    for (let c = 0; c < COURSES; c++) {
      const y = 1 + 3 * c, ids: number[] = [], next = new Set(ties(c + 1).flatMap(b => [b, b + 4])), js = new Set<number>();
      let x = 0;
      for (const b of [...ties(c), SW]) {
        const from = x, r = cut(b - from, WB, j => 4 * +prev.has(from + j) + 4 * +next.has(from + j) + (c ? 0 : 2 * bl.v(from + j, wz)), l => (l === 1 ? 4 : 0))!;
        for (const l of r.lens) { ids.push(K.add(pc('brick', x, wz, y, l, 1, WHITE))); x += l; js.add(x); }
        if (b < SW) { ids.push(K.add(pc('brick', b, wz, y, 4, 2, WHITE))); x = b + 4; js.add(b); js.add(x); }
      }
      js.delete(SW);
      bond += [...js].filter(j => prev.has(j)).length;
      prev = js;
      wall.push(ids);
    }
    // cap: white 1×8 and 1×6 tiles over the top course (a 1×2 or 1×4 at an end if needed), joints off the bricks'
    const caps = [0, 2, 4].flatMap(a => [0, 2, 4].map(b => {
      const r = cut(SW - a - b, [8, 6], j => 4 * +prev.has(a + j)), edge = [a, SW - b].filter(j => j % SW && prev.has(j)).length;
      return r ? { lens: [a, ...r.lens, b].filter(l => l), cost: r.cost + +!!a + +!!b + 4 * edge } : null;
    })).filter(r => r !== null).reduce((p, q) => (q.cost < p.cost - 1e-9 ? q : p));
    let x = 0;
    for (const l of caps.lens) { cap.push(K.add(pc('tile', x, wz, 1 + 3 * COURSES, l, 1, WHITE))); x += l; }
    // each brace 4 studs wide, 3 deep at the bottom stepping to 1: [row behind the wall, course, depth];
    // the white 2×4 ties of the odd courses span the wall row and the first brace row
    for (const b of bxs) for (const [r, c, d] of [[1, 0, 2], [3, 0, 1], [2, 1, 2], [1, 2, 2], [2, 3, 1], [1, 4, 1]])
      braces.push(K.add(pc('brick', b, wz + r, 1 + 3 * c, 4, d, BLACK)));
    K.step([...wall.slice(0, 6).flat(), ...braces], 'The two braces behind the wall are black bricks, stepped: the white 2×4 bricks in every other course reach back into them and tie them to the wall.');
    K.step(wall.slice(6, 13).flat());
    K.step([...wall.slice(13).flat(), ...cap], 'Lighting notes: an LED strip can run under the front edge of the base, or along the back of the wall just below its top course, to wash the wall with light. No electrical part is in the parts list.');
  }

  // Trans-Clear supports: a round plate in the tile hole and two round bricks, 6 plates up to the ribbon
  const supports: number[] = [];
  for (const [x, z] of cols) supports.push(
    K.add(pc('round', x, z, 1, 1, 1, TRANS_CLEAR, { h: 1, support: true })),
    K.add(pc('round', x, z, 2, 1, 1, TRANS_CLEAR, { support: true })),
    K.add(pc('round', x, z, 5, 1, 1, TRANS_CLEAR, { support: true })));
  const n = cols.length, name = (k: number, h: number) => `${k} round 1×1 ${h === 1 ? 'plate' : 'brick'}${k > 1 ? 's' : ''} (${partId('round', 1, 1, h)})`;
  K.step(supports, `Hidden supports: ${name(n, 1)} and ${name(2 * n, 3)}, Trans-Clear, stacked into ${n} clear column${n > 1 ? 's' : ''}: the round plate in a hole of the tiles, two round bricks on it.`);
  K.ribbon(rb, dx, 2 + LIFT, dz, 'Build the ribbon flat on the table, layer by layer: it holds together as one piece. Then press it onto the clear supports.');
  const npi = K.add(pc('tile', np.x, np.z, 1, 6, 2, BLACK, { nameplate: true }));
  K.step([npi]);

  // rules
  const P = K.pieces, of = (ids: number[]) => ids.map(i => P[i]);
  const { at, off, total } = sup, far = Math.max(0, ...at.slice(1).map((s, i) => s - at[i]));
  const reach = rb.width / 2 + 1, cellsAt = new Set(cols.map(([x, z]) => key(x, z)));
  // each tip: a support within 2 studs of it along the line, or in space (a jittery line's arc runs ahead of the distance covered)
  const tipNear = (p: { x: number; z: number }) => cols.some(([x, z]) => Math.hypot(x - dx + 0.5 - p.x, z - dz + 0.5 - p.z) <= 2);
  const L = rb.line, endsOk = rb.ends.every(c => cellsAt.has(key(kx(c) + dx, kz(c) + dz))) && (at[0] <= 2 || tipNear(L[0])) && (at[at.length - 1] >= total - 2 || tipNear(L[L.length - 1]));
  const fz1 = fz + bd, br = bridging(of(base), P.filter(p => p.y === 1));
  const sized = Ws !== undefined && Ds !== undefined, spaced = far <= 8 && off <= reach;
  const roomy = fx >= SIDE && SW - fx - bw >= SIDE && fz >= FRONT && (backdrop ? wz - fz1 === GAP && wz + BRACE < SD : SD - fz1 >= FRONT);
  const room: [string, number, number][] = [['on the left', fx, SIDE], ['on the right', SW - fx - bw, SIDE], ['at the front', fz, FRONT]];
  if (!backdrop) room.push(['at the back', SD - fz1, FRONT]);
  const rules: Rule[] = [
    {
      name: 'Base size', ok: sized,
      detail: sized ? `${SW}×${SD} studs, the smallest base that leaves room all round the Squiggle`
        : `Even the largest base, ${SW}×${SD} studs, leaves too little room around the Squiggle`,
    },
    {
      name: 'Room around the Squiggle', ok: roomy,
      detail: roomy ? `At least ${SIDE} studs of base left and right of the Squiggle and ${FRONT} in front${backdrop ? `; the wall stands ${GAP} studs behind it, its braces behind the wall` : ` and behind`}`
        : tight(room) || `The wall is not ${GAP} studs behind the Squiggle, or its braces don’t fit on the base`,
    },
    {
      name: 'Supported all along', ok: spaced,
      detail: spaced ? `${cols.length} clear supports right under the line, never more than 8 studs apart along it`
        : far > 8 ? `Two supports are ${far.toFixed(1)} studs apart along the line (8 at most)` : `A support stands ${off.toFixed(1)} studs off the line`,
    },
    {
      name: 'Both ends supported', ok: endsOk,
      detail: endsOk ? 'A support under each end of the ribbon, within 2 studs of its tip' : 'An end of the ribbon has no support within 2 studs of its tip',
    },
    {
      name: 'Base plates held together', ok: br.ok,
      detail: br.ok ? `Tiles cross every joint between the ${base.length} base plates, along at least half its length`
        : `${plural(br.short, 'joint')} between the base plates crossed by tiles along less than half ${br.short === 1 ? 'its' : 'their'} length`,
    },
  ];
  if (backdrop) {
    const ws = of(wall.flat()), top = Math.max(...ws.map(p => p.y + p.h)), bs = of(braces), cs = of(cap);
    const topJ = new Set(ws.filter(p => p.y + p.h === top).map(p => p.x).filter(x => x > 0)), capOver = cs.filter(p => topJ.has(p.x)).length;
    const tall = wall.length === COURSES && top - 1 === 60 && ws.every(p => p.z === wz && p.c === WHITE && p.x >= 0 && p.x + p.w <= SW) && ws.filter(p => p.y === 1).reduce((n, p) => n + p.w, 0) === SW;
    const hidden = bxs.length === 2 && bs.every(p => p.z > wz && p.z + p.d <= SD && p.y + p.h < top);
    const capped = cs.every(p => p.kind === 'tile' && p.c === WHITE && p.y === top && p.z === wz && p.d === 1 && p.w >= 2) && cs.reduce((n, p) => n + p.w, 0) === SW;
    const high = Math.round(((top - 1) * PLATE_CM) / STUD_CM);
    rules.push(
      {
        name: 'White wall', ok: tall,
        detail: tall ? `${SW} studs wide and ${high} high (${COURSES} rows of bricks), ${wz - fz1} studs behind the ribbon` : `The wall is not the full ${SW} studs wide and 24 high`,
      },
      {
        name: 'Bricks overlap', ok: bond === 0,
        detail: bond === 0 ? 'Every row of bricks overlaps the joints of the row below, like a real brick wall' : `${plural(bond, 'joint')} of the wall right over a joint of the row below`,
      },
      {
        name: 'Hidden braces', ok: hidden,
        detail: hidden ? 'Two black braces behind the wall hold it up, out of sight from the front' : 'The braces behind the wall are missing or show from the front',
      },
      {
        name: 'Wall capped', ok: capped && !capOver,
        detail: capped && !capOver ? 'Smooth white tiles along the top of the wall, their joints clear of the bricks’ joints'
          : capped ? `${plural(capOver, 'joint')} of the top tiles right over a joint of the bricks` : 'The white tiles don’t cover the whole top of the wall',
      },
    );
  }
  const notes = [`Black base ${SW}×${SD} studs (${(SW * STUD_CM).toFixed(1)} × ${(SD * STUD_CM).toFixed(1)} cm): the ribbon floats ${LIFT} plates (${(LIFT * PLATE_CM).toFixed(1)} cm) above it on ${cols.length} clear supports.`];
  if (backdrop) notes.push(`White wall ${SW} studs wide and 24 high (${(SW * STUD_CM).toFixed(1)} × ${(24 * STUD_CM).toFixed(1)} cm), ${GAP} studs behind the ribbon, held by two braces hidden behind it.`);
  return { K, root: base, pose: 'table' as const, np: npi, hanging: null, rules, com: true, twoStud: null, notes };
}

// ---- the model ----

function advice(grams: number): string {
  const kg = `About ${(grams / 1000).toFixed(1)} kg`, flat = 'The two bottom bricks keep it flat against the wall.';
  if (grams < 1000) return `${kg}: tie a picture cord through the holes of the two top Technic bricks and hang it on one picture hook. ${flat}`;
  if (grams < 3000) return `${kg}: tie a picture cord through the holes of the two top Technic bricks and hang it on two picture hooks, or on a screw with a wall plug. ${flat}`;
  return `${kg}: tie a picture cord through the holes of the two top Technic bricks and hang it on two screws with wall plugs. ${flat}`;
}

const ribbons = new WeakMap<Curve, Map<string, Ribbon>>();
/** the ribbon, built once per curve, scale and look: the three displays share it */
function ribbonOf(curve: Curve, scale: Scale, studs: boolean): Ribbon {
  let m = ribbons.get(curve);
  if (!m) ribbons.set(curve, m = new Map());
  const k = `${scale}${studs}`;
  if (!m.has(k)) m.set(k, buildRibbon(curve, scale, { studs }));
  return m.get(k)!;
}

export function buildRelief(curve: Curve, display: Display, scale: Scale, meta: { id: number; hash: string }, opts: { studs?: boolean } = {}): SqModel {
  const rb = ribbonOf(curve, scale, !!opts.studs);
  const b = display === 'frame' ? frame(rb, scale) : standing(rb, display === 'backdrop');
  const { pieces, steps, stepNotes } = b.K, root = new Set(b.root);
  const ck = checkModel(pieces, { root: (_, i) => root.has(i), base: (_, i) => root.has(i) });
  const comInside = b.com ? ck.com.inside : null;
  const inBy = Math.round(ck.com.margin), steady = { name: 'Won’t tip over', ok: ck.com.inside, detail: !ck.com.inside ? 'Its centre of mass is outside the base: it would tip over'
    : inBy < 1 ? 'Balanced, just: its weight sits right by the edge of the base'
    : `Balanced: its weight sits ${inBy >= 3 ? 'well ' : ''}inside the base, ${plural(inBy, 'stud')} from the nearest edge` };
  const rules = !b.com ? b.rules : [...b.rules, steady];
  const s = summarize(pieces, b.pose);
  const notes = [...b.notes, ...rb.notes];
  const missing = s.bom.filter(l => !elementId(l.part, l.color));
  if (missing.length) notes.push(`Not sold by LEGO Pick a Brick: ${missing.map(l => `${l.name} ${l.colorName}`).join(', ')}.`);
  const hanging = b.hanging ? { points: b.hanging, advice: advice(s.grams) } : null;
  if (hanging) notes.push(hanging.advice);
  return {
    id: meta.id, format: 'relief', display, scale, pieces, steps, stepNotes,
    bom: s.bom, subtotals: s.subtotals, colors: s.colors,
    checks: { ...ck, twoStud: b.twoStud, comInside, rules },
    notes, dims: s.dims, grams: s.grams, cost: s.cost, pose: b.pose,
    nameplate: { lines: nameplateLines(meta.id, meta.hash), piece: b.np }, hanging,
  };
}
