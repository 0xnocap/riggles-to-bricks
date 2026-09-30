// A Squiggle read back from a picture of it (Art Blocks' static image or an
// upload), when its script can't be run. The script's curve is known in form:
// x runs left to right at a constant speed, y is a Catmull-Rom spline through
// one random height per span, and the hue climbs at a constant rate along it.
// So we find the stroke (what differs from the background, read from the
// corners), its width (distance transform), the span count and width from its
// two ends, then fit the heights so the line stays inside the stroke, the
// stroke covers all of it, and the colours seen just behind each dot follow
// the hue ramp. A screenshot (the Squiggle's picture on a page) is cut down
// to that picture first. No DOM: runs in a worker and in Node.
import { hueOf, type Curve, type CurvePoint, type SquiggleType } from './curve';
import { hsbToRgb } from './port';
import { SourceError } from './source';

export interface RGBAImage { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

export interface ImageCurve {
  curve: Curve;
  features: Record<string, string | number>;
  /** how close the read is (not where it came from: the page says that) */
  notes: string[];
  /** how the fit went, for tests and the "More info" panel */
  fit: { spans: number; anchored: boolean; radius: number; cost: number; hueFit: number; stats: Record<string, number> };
  /** the Squiggle's own picture inside the one given (a screenshot, a picture on a page): x, y, w, h, source px */
  crop?: [number, number, number, number];
}

const CANVAS = { w: 1200, h: 800 };
/** stroke band radius (what differs from the background) as a fraction of the canvas height, by type */
const BAND: Record<SquiggleType, number> = { Normal: 1 / 26, Ribbed: 1 / 24, Slinky: 1 / 26, Bold: 1 / 10, Pipe: 1 / 14, Fuzzy: 0.0375 };
const STROKE: Record<SquiggleType, number> = { Normal: 1 / 13, Ribbed: 1 / 13, Slinky: 1 / 13, Bold: 1 / 5, Pipe: 1 / 13, Fuzzy: 4 / 39 };
const STEPS: Record<SquiggleType, number> = { Normal: 200, Ribbed: 200, Bold: 200, Slinky: 50, Pipe: 50, Fuzzy: 1000 };
/** Fuzzy: the dots fall below and right of the line; the band's centre sits this far off it (canvas heights) */
const FUZZ = 0.037;
const WORK = 480;          // working width, px
const NOT_FOUND = 'We couldn’t find a Squiggle in this picture.';

// ---- pixels ----

/** the background: the colour of the corner most others agree with, and how many corners do */
function corners(img: RGBAImage): { bg: [number, number, number]; agree: number } {
  const { width: W, height: H, data } = img, s = Math.max(2, Math.round(Math.min(W, H) * 0.03));
  const corner = (x0: number, y0: number) => {
    const ch: number[][] = [[], [], []];
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) for (let c = 0; c < 3; c++) ch[c].push(data[(y * W + x) * 4 + c]);
    return ch.map(v => v.sort((a, b) => a - b)[v.length >> 1]);
  };
  const cs = [corner(0, 0), corner(W - s, 0), corner(0, H - s), corner(W - s, H - s)];
  const near = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]))) < 24;
  const best = cs.map(a => cs.filter(b => near(a, b)).length), agree = Math.max(...best);
  return { bg: cs[best.indexOf(agree)] as [number, number, number], agree };
}
const background = (img: RGBAImage) => corners(img).bg;

const chroma = (d: RGBAImage['data'], i: number) => Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
const diff = (d: RGBAImage['data'], i: number, bg: number[]) => Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2]));

/** exact Euclidean distance from every cell to the nearest cell where `m` is 0 (Felzenszwalb) */
function edt(m: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20, n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const g = new Float64Array(w * h);
  const pass = (len: number) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = m[y * w + x] ? INF : 0; pass(h); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; pass(w); for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]); }
  return out;
}

/** keep the largest 8-connected region of `m` (in place), return its size */
function largest(m: Uint8Array, w: number, h: number): number {
  const lab = new Int32Array(w * h), q = new Int32Array(w * h);
  let best = 0, bestL = 0, L = 0;
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || lab[s]) continue;
    L++; let a = 0, b = 0; q[b++] = s; lab[s] = L;
    while (a < b) {
      const p = q[a++], x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const o = Y * w + X;
        if (m[o] && !lab[o]) { lab[o] = L; q[b++] = o; }
      }
    }
    if (b > best) { best = b; bestL = L; }
  }
  for (let i = 0; i < w * h; i++) m[i] = lab[i] === bestL ? 1 : 0;
  return best;
}

/** fill background pockets smaller than `area` cells that don't reach the border */
function fillHoles(m: Uint8Array, w: number, h: number, area: number) {
  const seen = new Uint8Array(w * h), q = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (m[s] || seen[s]) continue;
    let a = 0, b = 0, border = false; q[b++] = s; seen[s] = 1;
    while (a < b) {
      const p = q[a++], x = p % w, y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      for (const o of [p - 1, p + 1, p - w, p + w]) if (o >= 0 && o < w * h && !m[o] && !seen[o] && Math.abs((o % w) - x) <= 1) { seen[o] = 1; q[b++] = o; }
    }
    if (!border && b < area) for (let i = 0; i < b; i++) m[q[i]] = 1;
  }
}

// ---- the stroke ----

interface Mask { f: number; w: number; h: number; m: Uint8Array; din: Float32Array; dout: Float32Array; plain: number }

/**
 * The stroke on a working grid about 480 cells wide (`f` source pixels per cell): what differs from the
 * background (`colour`: only what has colour; `off`: how much it must differ), cleaned up, and its distance
 * transforms. `plain`: the share of cells that are plain background.
 */
export function strokeMask(img: RGBAImage, bg = background(img), colour = false, off = 6): Mask {
  const { width: W, height: H, data } = img;
  if (W < 60 || H < 40) throw new SourceError('This picture is too small to read a Squiggle from.');
  const f = Math.max(1, W / WORK), w = Math.max(1, Math.round(W / f)), h = Math.max(1, Math.round(H / f));
  const cov = new Float32Array(w * h), cnt = new Float32Array(w * h);
  const step = Math.max(1, Math.floor(f / 2.5));            // enough pixels per cell on big pictures
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
    const i = (y * W + x) * 4, c = Math.min(w - 1, Math.floor(x / f)) + Math.min(h - 1, Math.floor(y / f)) * w;
    const a = data[i + 3] < 128 ? 0 : Math.min(1, Math.max(0, ((colour ? chroma(data, i) : diff(data, i, bg)) - off) / 30));
    cov[c] += a; cnt[c]++;
  }
  let plain = 0;
  for (let i = 0; i < w * h; i++) { cov[i] = cnt[i] ? cov[i] / cnt[i] : 0; if (cov[i] < 0.1) plain++; }
  // 3×3 blur (fills the rings of Slinky and Pipe), threshold, keep the main part
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) { s += cov[Y * w + X]; k++; } }
    m[y * w + x] = s / k > 0.25 ? 1 : 0;
  }
  const area = largest(m, w, h);
  if (area < w * h * 0.004) throw new SourceError(NOT_FOUND);
  fillHoles(m, w, h, Math.max(9, (w / 60) ** 2));
  const din = edt(m, w, h), inv = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inv[i] = m[i] ? 0 : 1;
  return { f, w, h, m, din, dout: edt(inv, w, h), plain: plain / (w * h) };
}

/**
 * The Squiggle's own picture inside this one (a screenshot of it on a page, a picture of it on a grey
 * ground): then what differs from the corners is a plain rectangle, the Squiggle's background with the
 * stroke on it. Its edges, to the source pixel: where most lines cross from the corners' colour into it.
 */
function innerPicture(img: RGBAImage, F: Field, bg: number[]): [number, number, number, number] | null {
  const { width: W, height: H, data } = img, { f, m, w } = F, [x0, y0, x1, y1] = F.box;
  let a = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) a += m[y * w + x];
  if (a < 0.9 * (x1 - x0 + 1) * (y1 - y0 + 1)) return null;
  const X0 = x0 * f, X1 = (x1 + 1) * f, Y0 = y0 * f, Y1 = (y1 + 1) * f;
  const at = (x: number, y: number) => (Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))) * 4;
  // half-way from the corners' colour to the rectangle's own, seen just inside its corners
  const inner = [[X0, Y0], [X1, Y0], [X0, Y1], [X1, Y1]].map(([x, y]) => diff(data, at(x + Math.sign(X1 - 2 * x + X0) * 3 * f, y + Math.sign(Y1 - 2 * y + Y0) * 3 * f), bg)).sort((p, q) => p - q);
  const T = Math.max(12, (inner[1] + inner[2]) / 4);
  const ks = Array.from({ length: 25 }, (_, i) => 0.1 + (0.8 * i) / 24);
  const scan = (from: number, to: number, hit: (t: number, k: number) => boolean) => {
    const s = to > from ? 1 : -1, a = Math.round(from), b = Math.round(to);
    for (let t = a; t !== b + s; t += s) if (ks.filter(k => hit(t, k)).length > ks.length / 2) return t;
    return Math.round((from + to) / 2);
  };
  const col = (x: number, k: number) => diff(data, at(x, Y0 + k * (Y1 - Y0)), bg) >= T, row = (y: number, k: number) => diff(data, at(X0 + k * (X1 - X0), y), bg) >= T;
  const L = Math.max(0, scan(X0 - 2 * f, X0 + 2 * f, col)), R = Math.min(W, scan(X1 + 2 * f, X1 - 2 * f, col) + 1);
  const Tp = Math.max(0, scan(Y0 - 2 * f, Y0 + 2 * f, row)), B = Math.min(H, scan(Y1 + 2 * f, Y1 - 2 * f, row) + 1);
  if (R - L > 0.98 * W && B - Tp > 0.98 * H) return null;
  return [L, Tp, R - L, B - Tp];
}

function cropImage(img: RGBAImage, [x, y, w, h]: [number, number, number, number]): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) data.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  return { width: w, height: h, data };
}

interface Field extends Mask {
  bx: Float32Array; by: Float32Array; col: Int32Array;      // edge cells sorted by x, first index per column
  box: [number, number, number, number];                     // cells: x0, y0, x1, y1
  r: number;                                                 // band radius, cells
  hue: Float32Array | null;                                  // p5 hue (0..255) seen in each cell, NaN: no colour
}

/** the stroke's edge cells, extent, and a first band radius: the low end of the distance transform's ridge */
function field(M: Mask): Field {
  const { w, h, m, din } = M, bxs: number[] = [], bys: number[] = [], col = new Int32Array(w + 1);
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let x = 0; x < w; x++) {
    col[x] = bxs.length;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (!m[i]) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]) { bxs.push(x + 0.5); bys.push(y + 0.5); }
    }
  }
  col[w] = bxs.length;
  const ridge: number[] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, d = din[i];
    if (d < 2) continue;
    const n = +(d >= din[i - 1] && d >= din[i + 1]) + +(d >= din[i - w] && d >= din[i + w]) + +(d >= din[i - w - 1] && d >= din[i + w + 1]) + +(d >= din[i - w + 1] && d >= din[i + w - 1]);
    if (n >= 2) ridge.push(d);
  }
  if (ridge.length < 10) throw new SourceError(NOT_FOUND);
  ridge.sort((a, b) => a - b);
  // fused loops only add to the ridge; the plain stroke is its low end
  const r = Math.max(1.5, ridge[Math.floor(ridge.length * 0.08)] - 1);
  return { ...M, bx: Float32Array.from(bxs), by: Float32Array.from(bys), col, box: [x0, y0, x1, y1], r, hue: null };
}

/** the hue (p5, 0..255) of the pixel at the centre of every cell, when it is coloured enough */
function hueGrid(img: RGBAImage, M: Mask, minChroma: number): Float32Array {
  const { width: W, height: H, data } = img, { f, w, h } = M, out = new Float32Array(w * h).fill(NaN);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!M.m[y * w + x]) continue;
    const i = (Math.min(H - 1, Math.floor((y + 0.5) * f)) * W + Math.min(W - 1, Math.floor((x + 0.5) * f))) * 4;
    if (chroma(data, i) >= minChroma) out[y * w + x] = (hueOf([data[i], data[i + 1], data[i + 2]]) * 255) / 360;
  }
  return out;
}

// ---- the curve model: x = x0 + A·u (u in spans), y = Catmull-Rom through Y[1..n+1], hue = k·u + c ----

const M = 20;                                     // samples per span in the fit
const BASIS = Array.from({ length: M + 1 }, (_, k) => {
  const t = k / M, t2 = t * t, t3 = t2 * t;
  return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2];
});
const cr = (Y: Float64Array, j: number, b: number[]) => Y[j] * b[0] + Y[j + 1] * b[1] + Y[j + 2] * b[2] + Y[j + 3] * b[3];
const sample = (a: Float32Array, F: Mask, x: number, y: number) => {
  const fx = Math.min(Math.max(x - 0.5, 0), F.w - 1.001), fy = Math.min(Math.max(y - 0.5, 0), F.h - 1.001);
  const X = fx | 0, Y = fy | 0, u = fx - X, v = fy - Y, i = Y * F.w + X;
  return (a[i] * (1 - u) + a[i + 1] * u) * (1 - v) + (a[i + F.w] * (1 - u) + a[i + F.w + 1] * u) * v;
};
const wrap = (d: number) => ((d % 255) + 382.5) % 255 - 127.5;      // hue difference in −127.5..127.5
export interface Ramp { k: number; c: number; R: number }

const BLOCK = 5, NB = M / BLOCK;                  // pieces per block (bounding boxes speed up distances)

class Fitter {
  Y: Float64Array;
  px: Float64Array; py: Float64Array;              // curve samples, span j at j·(M+1)
  lo: Float64Array; hi: Float64Array;              // y range of each block of pieces
  inCost: Float64Array;                            // inside and colour cost per span
  rin: number; rcov: number; cap: number;
  constructor(readonly F: Field, readonly n: number, readonly x0: number, readonly A: number, Y0: Float64Array,
    readonly ramp: Ramp | null = null, readonly back = 0) {
    this.Y = Y0; this.px = new Float64Array(n * (M + 1)); this.py = new Float64Array(n * (M + 1)); this.inCost = new Float64Array(n);
    this.lo = new Float64Array(n * NB); this.hi = new Float64Array(n * NB);
    this.rin = F.r * 0.85; this.rcov = F.r + 0.75; this.cap = F.r;
    for (let j = 0; j < n; j++) this.span(j);
  }
  span(j: number) {
    const { px, py, Y, F, ramp } = this, hue = F.hue;
    let c = 0;
    for (let k = 0; k <= M; k++) {
      const i = j * (M + 1) + k;
      px[i] = this.x0 + this.A * (j + k / M); py[i] = cr(Y, j, BASIS[k]);
      if (!k) continue;
      const dx = px[i] - px[i - 1], dy = py[i] - py[i - 1], ds = Math.hypot(dx, dy), x = (px[i] + px[i - 1]) / 2, y = (py[i] + py[i - 1]) / 2;
      const e = Math.max(0, this.rin - sample(F.din, F, x, y)) + sample(F.dout, F, x, y);
      c += 2 * e * e * ds;
      if (ramp && hue && ds) {
        // the colour just behind the dot is the dot's own (nothing drawn later reaches there)
        const bx = Math.floor(x - (dx / ds) * this.back), by = Math.floor(y - (dy / ds) * this.back);
        const v = bx >= 0 && by >= 0 && bx < F.w && by < F.h ? hue[by * F.w + bx] : NaN;
        if (v === v) { const ec = Math.min(this.cap, (Math.abs(wrap(v - ramp.k * (j + (k - 0.5) / M) - ramp.c)) / Math.abs(ramp.k)) * this.A); c += ec * ec * ds; }
      }
    }
    for (let b = 0; b < NB; b++) {
      let lo = Infinity, hi = -Infinity;
      for (let k = b * BLOCK; k <= (b + 1) * BLOCK; k++) { const v = py[j * (M + 1) + k]; if (v < lo) lo = v; if (v > hi) hi = v; }
      this.lo[j * NB + b] = lo; this.hi[j * NB + b] = hi;
    }
    this.inCost[j] = c;
  }
  /** squared distance from (x, y) to span j, if under `best` */
  dist2(j: number, x: number, y: number, best: number): number {
    const { px, py } = this, step = this.A / M, xs = this.x0 + this.A * j;
    for (let b = 0; b < NB; b++) {
      const bx0 = xs + b * BLOCK * step, bx1 = bx0 + BLOCK * step, lo = this.lo[j * NB + b], hi = this.hi[j * NB + b];
      const dx0 = x < bx0 ? bx0 - x : x > bx1 ? x - bx1 : 0, dy0 = y < lo ? lo - y : y > hi ? y - hi : 0;
      if (dx0 * dx0 + dy0 * dy0 >= best) continue;
      for (let k = b * BLOCK; k < (b + 1) * BLOCK; k++) {
        const i = j * (M + 1) + k, ax = px[i], ay = py[i], dx = px[i + 1] - ax, dy = py[i + 1] - ay;
        const L = dx * dx + dy * dy, t = L ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
        const ex = ax + t * dx - x, ey = ay + t * dy - y, d = ex * ex + ey * ey;
        if (d < best) best = d;
      }
    }
    return best;
  }
  /** coverage cost of the edge cells with x in [xa, xb], spans limited to [j0, j1] (others: `base`) */
  cover(xa: number, xb: number, base: Float64Array | null, j0 = 0, j1 = this.n - 1): number {
    const F = this.F, R = this.rcov + this.cap, R2 = R * R, ok = this.rcov * this.rcov;
    const c0 = Math.max(0, Math.floor(xa)), c1 = Math.min(F.w - 1, Math.floor(xb));
    let cost = 0;
    for (let i = F.col[c0]; i < F.col[c1 + 1]; i++) {
      let best = base ? base[i - F.col[c0]] : R2;
      if (best > ok) {
        const x = F.bx[i], y = F.by[i];
        const ja = Math.max(j0, Math.floor((x - R - this.x0) / this.A)), jb = Math.min(j1, Math.floor((x + R - this.x0) / this.A));
        for (let j = ja; j <= jb && best > ok; j++) best = this.dist2(j, x, y, best);
        const e = Math.min(this.cap, Math.sqrt(best) - this.rcov);
        if (e > 0) cost += e * e;
      }
    }
    return cost;
  }
  total(): number { return this.inCost.reduce((a, b) => a + b, 0) + this.cover(0, this.F.w, null); }
  /** move knot k to the height `pick` finds, given the cost of a height; true when it moved */
  knot(k: number, pick: (cost: (y: number) => number, y: number) => number): boolean {
    const { n, A, x0, F } = this, j0 = Math.max(0, k - 3), j1 = Math.min(n - 1, k);
    if (j0 > j1) return false;
    const R = this.rcov + this.cap, xa = x0 + A * j0 - R, xb = x0 + A * (j1 + 1) + R;
    // distances to the spans this knot doesn't move, once
    const c0 = Math.max(0, Math.floor(xa)), c1 = Math.min(F.w - 1, Math.floor(xb)), base = new Float64Array(Math.max(0, F.col[c1 + 1] - F.col[c0]));
    for (let i = F.col[c0]; i < F.col[c1 + 1]; i++) {
      const x = F.bx[i], y = F.by[i];
      let best = R * R;
      const ja = Math.max(0, Math.floor((x - R - x0) / A)), jb = Math.min(n - 1, Math.floor((x + R - x0) / A));
      for (let j = ja; j <= jb; j++) if (j < j0 || j > j1) best = this.dist2(j, x, y, best);
      base[i - F.col[c0]] = best;
    }
    const cost = (y: number) => { this.Y[k] = y; let c = 0; for (let j = j0; j <= j1; j++) { this.span(j); c += this.inCost[j]; } return c + this.cover(xa, xb, base, j0, j1); };
    const old = this.Y[k], y = pick(cost, old);
    cost(y);
    return y !== old;
  }
}

/** the best of `ys` (and the current height) */
const scan = (ys: number[]) => (cost: (y: number) => number, y0: number) => {
  let by = y0, bc = cost(y0);
  for (const y of ys) { const c = cost(y); if (c < bc - 1e-9) { bc = c; by = y; } }
  return by;
};
/** pattern search: step to a better neighbour while there is one, then halve the step */
const walk = (steps: number[]) => (cost: (y: number) => number, y0: number) => {
  let y = y0, c = cost(y0);
  for (const s of steps) for (let moved = true, n = 0; moved && n < 20; n++) {
    moved = false;
    for (const t of [y - s, y + s]) { const ct = cost(t); if (ct < c - 1e-9) { c = ct; y = t; moved = true; break; } }
  }
  return y;
};

/** quick: a coarse pass, enough to compare span counts. init: heights to start from (polish: only nudge
 *  them). ramp, back: the colour term, for the first scan only (a rough ramp would bias the fine fit) */
interface FitOpts { quick?: boolean; init?: Float64Array; ramp?: Ramp | null; back?: number; polish?: boolean }

/** Fit the heights for `n` spans from x0, A wide. */
function fitCurve(F: Field, n: number, x0: number, A: number, o: FitOpts = {}): Fitter {
  const ramp = o.ramp && Math.abs(o.ramp.k) < 150 && o.ramp.R > 0.4 ? o.ramp : null;
  const col = (k: number) => Math.min(F.w - 1, Math.max(0, Math.floor(x0 + A * (k - 1))));
  const stride = Math.max(1.5, F.r / (o.quick ? 4 : 6)), [, by0, , by1] = F.box, span = (F.h * 2) / 3;
  /** every height the stroke allows on the knot's column (the end tangents: any height) */
  const heights = (k: number) => {
    const ys: number[] = [];
    if (k === 0 || k === n + 2) for (let y = Math.max(0, by0 - span / 2); y <= Math.min(F.h, by1 + span / 2); y += stride) ys.push(y);
    else { const c = col(k); for (let y = 0.5; y < F.h; y += stride) if (F.din[Math.floor(y) * F.w + c] >= F.r * 0.45) ys.push(y); }
    return ys;
  };
  let Y: Float64Array;
  if (o.init && o.init.length === n + 3) Y = Float64Array.from(o.init);
  else {
    // the most inner point of each knot's column, then a scan of each knot, colours helping
    Y = new Float64Array(n + 3);
    for (let k = 1; k <= n + 1; k++) {
      const c = col(k);
      let by = F.h / 2, bd = -1;
      for (let y = 0; y < F.h; y++) if (F.din[y * F.w + c] > bd) { bd = F.din[y * F.w + c]; by = y + 0.5; }
      Y[k] = by;
    }
    Y[0] = 2 * Y[1] - Y[2]; Y[n + 2] = 2 * Y[n + 1] - Y[n];
    const f0 = new Fitter(F, n, x0, A, Y, ramp, o.back ?? 0);
    for (let k = 0; k <= n + 2; k++) f0.knot(k, scan(heights(k)));
    Y = f0.Y;
  }
  // then the stroke alone: walk each knot to its best height, and rescan them all until nothing moves
  const f = new Fitter(F, n, x0, A, Y);
  const steps = o.polish ? [1] : o.init ? [2, 1] : [4, 2, 1];
  for (let round = 0; round < (o.quick ? 1 : 3); round++) {
    for (let sweep = 0; sweep < 2; sweep++) {
      let moved = false;
      for (let k = 0; k <= n + 2; k++) moved = f.knot(k, walk(steps)) || moved;
      if (!moved) break;
    }
    if (o.quick || o.init) break;
    let moved = false;
    for (let k = 0; k <= n + 2; k++) moved = f.knot(k, scan(heights(k))) || moved;
    if (!moved) break;
  }
  if (!o.quick) for (let k = 0; k <= n + 2; k++) f.knot(k, walk([0.5, 0.25, 0.125]));
  return f;
}

/**
 * Points of the line, from the colours: every coloured cell shows the dot drawn last over it (or, for
 * rings, the ring through it) and lies on that dot's rim, `rc` from its centre. Cells of nearly the same
 * colour (a thin slice of the ramp) come from neighbouring dots: the centre their rims share (a circle
 * Hough transform) is a point of the line. The ramp only groups the cells, so a rough one will do.
 * Fuzzy (`cloud`): a cell's colour is the mean of the dots around it, so the middle of the cells of one
 * colour is a point of the line of the cloud's centres.
 */
function centres(F: Field, ramp: Ramp, rc: number, cloud = false): { x: number; y: number; w: number }[] {
  const hue = F.hue!, period = 255 / Math.abs(ramp.k), cells: { x: number; y: number; u: number }[] = [];
  for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) {
    const v = hue[y * F.w + x];
    if (v === v) cells.push({ x: x + 0.5, y: y + 0.5, u: (((v - ramp.c) / ramp.k) % period + period) % period });
  }
  cells.sort((a, b) => a.u - b.u);
  const slice = 0.02, out: { x: number; y: number; w: number }[] = [], nt = Math.max(24, Math.ceil(2 * Math.PI * rc));
  const cos = Float64Array.from({ length: nt }, (_, i) => rc * Math.cos((2 * Math.PI * i) / nt)), sin = Float64Array.from({ length: nt }, (_, i) => rc * Math.sin((2 * Math.PI * i) / nt));
  const med = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
  let acc = new Float32Array(0);
  for (let i = 0; i < cells.length;) {
    let j = i;
    while (j < cells.length && cells[j].u < cells[i].u + slice) j++;
    let group = cells.slice(i, j); i = j;
    if (group.length < 5) continue;
    // one colour can come back further along the line: keep the cells near the slice's middle
    const mx = med(group.map(c => c.x));
    group = group.filter(c => Math.abs(c.x - mx) < 2.5 * rc);
    if (group.length < 5) continue;
    if (cloud) { out.push({ x: med(group.map(c => c.x)), y: med(group.map(c => c.y)), w: group.length }); continue; }
    let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
    for (const c of group) { gx0 = Math.min(gx0, c.x); gy0 = Math.min(gy0, c.y); gx1 = Math.max(gx1, c.x); gy1 = Math.max(gy1, c.y); }
    const ax = Math.floor(gx0 - rc - 2), ay = Math.floor(gy0 - rc - 2), aw = Math.ceil(gx1 + rc + 2) - ax, ah = Math.ceil(gy1 + rc + 2) - ay;
    if (acc.length < aw * ah) acc = new Float32Array(aw * ah); else acc.fill(0, 0, aw * ah);
    for (const c of group) for (let t = 0; t < nt; t++) acc[Math.floor(c.y + sin[t] - ay) * aw + Math.floor(c.x + cos[t] - ax)]++;
    let best = 0, bi = 0;
    for (let y = 1; y < ah - 1; y++) for (let x = 1; x < aw - 1; x++) {
      const k = y * aw + x, s = acc[k] + acc[k - 1] + acc[k + 1] + acc[k - aw] + acc[k + aw];
      if (s > best) { best = s; bi = k; }
    }
    if (best < 0.8 * group.length) continue;
    // the centre: weighted mean of the 3×3 around the peak
    let sx = 0, sy = 0, sw = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = bi + dy * aw + dx, v = acc[k]; sx += v * ((k % aw) + 0.5 + ax); sy += v * (Math.floor(k / aw) + 0.5 + ay); sw += v; }
    out.push({ x: sx / sw, y: sy / sw, w: best / 5 });
  }
  return out;
}

/**
 * The knots through points of the line: least squares on the Catmull-Rom basis, three times (then without
 * the far-off points), `prior` weakly where no point is. `res`: the mean distance left, cells.
 */
function fitKnots(pts: { x: number; y: number; w: number }[], n: number, x0: number, A: number, prior: Float64Array): { Y: Float64Array; res: number } | null {
  const meas = pts.map(p => ({ u: (p.x - x0) / A, y: p.y, w: p.w })).filter(m => m.u >= 0 && m.u <= n);
  if (meas.length < n * 5) return null;
  const N = n + 3;
  let Y: Float64Array | null = null, fitRes = 0;
  for (let pass = 0; pass < 3; pass++) {
    const Mx = new Float64Array(N * N), v = new Float64Array(N);
    const lam = 0.02 * Math.max(...meas.map(m => m.w));
    for (let k = 0; k < N; k++) { Mx[k * N + k] += lam; v[k] += lam * prior[k]; }
    const res: number[] = Y ? meas.map(m => Math.abs(m.y - crAt(Y!, m.u))) : [];
    const lim = Y ? Math.max(1.5, 3 * [...res].sort((a, b) => a - b)[res.length >> 1]) : Infinity;
    if (Y) { let sw = 0, sr = 0; meas.forEach((m, i) => { if (res[i] <= lim) { sw += m.w; sr += m.w * res[i]; } }); fitRes = sr / sw; }
    meas.forEach((m, i) => {
      if (Y && res[i] > lim) return;
      const j = Math.min(n - 1, Math.floor(m.u)), t = m.u - j, t2 = t * t, t3 = t2 * t;
      const b = [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2];
      for (let p = 0; p < 4; p++) { v[j + p] += m.w * b[p] * m.y; for (let q = 0; q < 4; q++) Mx[(j + p) * N + j + q] += m.w * b[p] * b[q]; }
    });
    Y = solve(Mx, v, N);
    if (!Y) return null;
  }
  return { Y: Y!, res: fitRes };
}

function crAt(Y: Float64Array, u: number): number {
  const n = Y.length - 3, j = Math.min(n - 1, Math.max(0, Math.floor(u))), t = u - j, t2 = t * t, t3 = t2 * t;
  return Y[j] * (-0.5 * t3 + t2 - 0.5 * t) + Y[j + 1] * (1.5 * t3 - 2.5 * t2 + 1) + Y[j + 2] * (-1.5 * t3 + 2 * t2 + 0.5 * t) + Y[j + 3] * (0.5 * t3 - 0.5 * t2);
}

/** Gaussian elimination with partial pivoting; null when singular */
function solve(Mx: Float64Array, v: Float64Array, N: number): Float64Array | null {
  const a = Float64Array.from(Mx), b = Float64Array.from(v);
  for (let c = 0; c < N; c++) {
    let p = c;
    for (let r = c + 1; r < N; r++) if (Math.abs(a[r * N + c]) > Math.abs(a[p * N + c])) p = r;
    if (Math.abs(a[p * N + c]) < 1e-12) return null;
    if (p !== c) { for (let k = 0; k < N; k++) { const t = a[c * N + k]; a[c * N + k] = a[p * N + k]; a[p * N + k] = t; } const t = b[c]; b[c] = b[p]; b[p] = t; }
    for (let r = c + 1; r < N; r++) {
      const q = a[r * N + c] / a[c * N + c];
      if (!q) continue;
      for (let k = c; k < N; k++) a[r * N + k] -= q * a[c * N + k];
      b[r] -= q * b[c];
    }
  }
  const x = new Float64Array(N);
  for (let r = N - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < N; k++) s -= a[r * N + k] * x[k]; x[r] = s / a[r * N + r]; }
  return x;
}

/** median distance from the stroke's edge cells to the fitted line: the band radius, in cells */
function edgeRadius(f: Fitter): number {
  const F = f.F, d: number[] = [], R = F.r * 3;
  for (let i = 0; i < F.bx.length; i += 2) {
    const x = F.bx[i], y = F.by[i];
    let best = R * R;
    const ja = Math.max(0, Math.floor((x - R - f.x0) / f.A)), jb = Math.min(f.n - 1, Math.floor((x + R - f.x0) / f.A));
    for (let j = ja; j <= jb; j++) best = f.dist2(j, x, y, best);
    d.push(Math.sqrt(best));
  }
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}

// ---- colours: the script's hue ramp, hue = k·u + c (mod 255), u in spans ----

function circ(samples: { u: number; hue: number }[], k: number): Ramp {
  const TAU = (2 * Math.PI) / 255;
  let cx = 0, cy = 0;
  for (const s of samples) { const a = (s.hue - k * s.u) * TAU; cx += Math.cos(a); cy += Math.sin(a); }
  return { k, c: ((Math.atan2(cy, cx) / TAU) % 255 + 255) % 255, R: Math.hypot(cx, cy) / samples.length };
}

/** the slope and offset that fit the samples best: the script's slopes ((steps + 1) / spread), then ± a few % */
function fitHue(samples: { u: number; hue: number }[], steps: number): Ramp | null {
  if (samples.length < 20) return null;
  const spreads = [0.5]; for (let b = 3; b < 256; b++) spreads.push(5 + (b * 45) / 255);
  const slopes = new Set<number>();
  for (const S of new Set([steps, 50, 200, 1000])) for (const s of spreads) slopes.add((S + 1) / s);
  const few = samples.length > 600 ? samples.filter((_, i) => i % Math.ceil(samples.length / 600) === 0) : samples;
  const top: Ramp[] = [];
  for (const k0 of slopes) for (const k of [k0, -k0]) {
    top.push(circ(few, k));
    if (top.length > 24) { top.sort((a, b) => b.R - a.R); top.length = 8; }
  }
  top.sort((a, b) => b.R - a.R);
  let best = circ(samples, top[0].k);
  for (const t of top.slice(0, 8)) for (let e = -0.03; e <= 0.03; e += 0.001) { const c = circ(few, t.k * (1 + e)); if (c.R > best.R) best = c; }
  return circ(samples, best.k);
}

/** A first ramp from the colours seen across the stroke: a dot at u only paints within its radius of x0 + A·u. */
function rampFromColumns(F: Field, x0: number, A: number, n: number, steps: number): Ramp | null {
  const hue = F.hue!, samples: { u: number; hue: number }[] = [];
  for (let y = 0; y < F.h; y += 2) for (let x = 0; x < F.w; x += 2) {
    const v = hue[y * F.w + x];
    if (v === v) samples.push({ u: Math.min(n, Math.max(0, (x + 0.5 - x0) / A)), hue: v });
  }
  return fitHue(samples, steps);
}

// ---- the two ends ----

/**
 * The first x (dir 1: from the left, −1: from the right) where a row turns from background to stroke,
 * searched between source columns xa and xb, sub-pixel (the stroke's edge), or null.
 */
function edgeX(img: RGBAImage, bg: number[], xa: number, xb: number, dir: 1 | -1, T = 64): number | null {
  const { width: W, height: H, data } = img;
  xa = Math.max(1, Math.floor(xa)); xb = Math.min(W - 2, Math.ceil(xb));
  let best: number | null = null;
  for (let y = 0; y < H; y++) {
    let prev = diff(data, (y * W + (dir > 0 ? xa - 1 : xb + 1)) * 4, bg);
    if (prev >= T) continue;
    for (let k = 0; k <= xb - xa; k++) {
      const x = dir > 0 ? xa + k : xb - k, d = diff(data, (y * W + x) * 4, bg);
      if (d >= T) {
        // T/255 of a pixel covered: the edge is a little further in
        const e = dir > 0 ? x - 0.5 + (T - prev) / (d - prev) + 0.25 : x + 1.5 - (T - prev) / (d - prev) - 0.25;
        if (best === null || (dir > 0 ? e < best : e > best)) best = e;
        break;
      }
      prev = d;
    }
  }
  return best;
}

// ---- the whole reader ----

export function curveFromImage(img: RGBAImage, o: { id?: number } = {}): ImageCurve {
  return read(img, o, 0, 6)!;
}

/** depth: pictures cut out so far; tol: strokeMask's `off`; strict: an anchored read or none (null) */
function read(img: RGBAImage, o: { id?: number }, depth: number, tol: number, strict = false): ImageCurve | null {
  const { width: W, height: H, data } = img;
  const { bg, agree } = corners(img), dark = bg[0] + bg[1] + bg[2] < 3 * 60;
  const mask = strokeMask(img, bg, false, tol);
  // a Squiggle lies on a plain background: corners that agree, and much of the picture
  if (agree < 2 || mask.plain < 0.1) throw new SourceError(NOT_FOUND);
  const F = field(mask);
  const { f, w, h } = F;
  const frame = innerPicture(img, F, bg);
  if (frame) {
    if (depth >= 2) throw new SourceError('Crop your picture to the Squiggle itself and try again.');
    if (frame[2] < 60 || frame[3] < 40) throw new SourceError(NOT_FOUND);      // a bar, a button: no picture
    const r = read(cropImage(img, frame), o, depth + 1, tol)!;
    r.crop = r.crop ? [r.crop[0] + frame[0], r.crop[1] + frame[1], r.crop[2], r.crop[3]] : frame;
    if (!depth) r.notes.push('The Squiggle’s own picture was cut out of yours first.');
    return r;
  }

  // what the band is made of, at full resolution: holes (rings), solid colour, pale colour (Fuzzy), greys
  const st = { hole: 0, solid: 0, partial: 0, gray: 0, dark: 0, all: 0 };
  const grays: number[] = [];
  const sstep = Math.max(1, Math.round(Math.sqrt((W * H) / 400000)));
  for (let y = 0; y < H; y += sstep) for (let x = 0; x < W; x += sstep) {
    const c = Math.min(w - 1, Math.floor(x / f)) + Math.min(h - 1, Math.floor(y / f)) * w;
    if (!F.m[c] || F.din[c] < 1.5) continue;
    const i = (y * W + x) * 4, dd = diff(data, i, bg), ch = chroma(data, i);
    st.all++;
    if (dd <= 12) st.hole++;
    else if (ch < 30) { st.gray++; grays.push((data[i] + data[i + 1] + data[i + 2]) / 3); if (grays[grays.length - 1] < 70) st.dark++; }
    else if (ch > 200) st.solid++;
    else st.partial++;
  }
  const frac = (v: number) => v / Math.max(1, st.all);
  const stats = { hole: frac(st.hole), solid: frac(st.solid), partial: frac(st.partial), gray: frac(st.gray), dark: frac(st.dark), radius: 0 };
  grays.sort((a, b) => a - b);
  const ribGray = grays.length ? Math.round(grays[grays.length >> 1]) : 0;
  let type: SquiggleType = stats.hole > 0.08 ? 'Slinky' : stats.partial > 0.3 ? 'Fuzzy' : stats.gray > 0.06 ? 'Ribbed' : 'Normal';

  // Spans. The script's x runs from w/4 + A to w/4 + A·(n + 1), A = w / 2·segments, n = ceil(segments − 2)
  // in 10..18. On the whole canvas (3:2), the stroke's two ends give n and A: the end dots' edges sit one
  // dot radius out, and that radius is one of the script's (h/26, ribs h/24, Bold h/10, Pipe rings h/14).
  // Fuzzy's cloud starts 0.021 h before its first point and ends 0.106 h after its last.
  const canvas = Math.abs(W / H - 1.5) < 0.02;
  const [bxl, , bxr] = F.box;
  const cands: { n: number; A: number; x0: number; res: number; band?: SquiggleType; R?: number }[] = [];
  const tryEnds = (xs: number, xe: number, band?: SquiggleType, R?: number) => {
    const s1 = xs - W / 4, s2 = xe - W / 4;
    for (let n = 10; n <= 18; n++) {
      const A = (s1 + (n + 1) * s2) / (1 + (n + 1) ** 2);
      if (A > 0) cands.push({ n, A: A / f, x0: (W / 4 + A) / f, res: Math.hypot(s1 - A, s2 - (n + 1) * A) / f, band, R });
    }
  };
  if (canvas) {
    const g = (bg[0] + bg[1] + bg[2]) / 3, T = type === 'Ribbed' ? Math.max(10, Math.min(64, Math.abs(ribGray - g) * 0.5)) : 64;
    const le = edgeX(img, bg, (bxl - 2) * f, (bxl + 3) * f, 1, T), re = edgeX(img, bg, (bxr - 2) * f, (bxr + 3) * f, -1, T);
    const ring = H / 2400, bands: Record<string, [SquiggleType, number][]> = {
      Normal: [['Normal', H / 26], ['Bold', H / 10]],
      Ribbed: [['Ribbed', H / 24], ['Normal', H / 26], ['Pipe', H / 14 + ring]],
      Slinky: [['Slinky', H / 26 + ring], ['Pipe', H / 14 + ring]],
    };
    // a small picture blurs rings into a cloud: Fuzzy only if no crisp end fits
    bands.Fuzzy = [...bands.Normal, ...bands.Ribbed, ...bands.Slinky];
    // the band's radius must be about the one the stroke shows (a cropped 3:2 picture fits nothing well)
    if (le !== null && re !== null) for (const [band, R] of bands[type]) if (R / f > 0.6 * F.r && R / f < 1.65 * F.r) tryEnds(le + R, re - R, band, R);
    cands.sort((a, b) => a.res - b.res);
    if (type === 'Fuzzy') {
      const c = cands[0];
      const fits = c && c.res < 0.05 * c.A && (c.band === 'Pipe' ? stats.dark > 0.15 : c.band === 'Ribbed' ? stats.gray > 0.06 : c.band === 'Slinky' && stats.hole > 0.03);
      if (fits) type = c.band!;
      else { cands.length = 0; tryEnds(bxl * f + 0.021 * H, (bxr + 1) * f - 0.106 * H); }
    }
  }
  cands.sort((a, b) => a.res - b.res);
  const anchored = !!cands[0] && type !== 'Fuzzy' && cands[0].res < 0.08 * cands[0].A;
  // a whole canvas whose ends fit nothing: often a JPEG, whose halo fattens the stroke. Read it again with
  // only what clearly differs from the background as stroke, and keep that read if its ends fit.
  if (strict && !anchored) return null;
  if (canvas && !anchored && type !== 'Fuzzy') for (const t of [16, 24]) {
    let again: ImageCurve | null = null;
    try { again = read(img, o, depth, t, true); } catch { /* keep this read */ }
    if (again) return again;
  }
  if (anchored && (cands[0].band === 'Bold' || cands[0].band === 'Pipe')) type = cands[0].band;
  // rings with black ones: Pipe (only Pipe has black)
  if (!anchored && type === 'Slinky' && stats.dark > 0.15) type = 'Pipe';
  // on the canvas, the band's radius is the script's own
  if (anchored) F.r = cands[0].R! / f;
  const S = STEPS[type];
  const off = type === 'Fuzzy' ? (canvas ? (FUZZ * H) / f : (FUZZ / BAND.Fuzzy) * F.r) : 0;   // cells
  // the coloured dot's radius, source px
  const colourRadius = () => canvas ? H * (type === 'Bold' ? 1 / 10 : 1 / 26) : F.r * f * (type === 'Pipe' ? 14 / 26 : 1);
  // how far behind a dot its own colour shows: its radius, a little in (Pipe: its colour ring inside the
  // black one; Fuzzy: the middle of its cloud)
  const back = () => type === 'Fuzzy' ? 0 : (F.r + 0.5) * (type === 'Pipe' && !dark ? 14 / 26 : 1) - 1.5 / f;
  F.hue = hueGrid(img, F, type === 'Fuzzy' ? 40 : 100);

  // colours seen just behind each dot along the fitted line, and the ramp through them
  const colours = (ft: Fitter, b = back()) => {
    const out: { u: number; hue: number }[] = [];
    for (let j = 0; j < ft.n; j++) for (let k = 1; k <= M; k++) {
      const i = j * (M + 1) + k, dx = ft.px[i] - ft.px[i - 1], dy = ft.py[i] - ft.py[i - 1], ds = Math.hypot(dx, dy) || 1;
      const sx = Math.round(((ft.px[i] + ft.px[i - 1]) / 2 - (dx / ds) * b) * f), sy = Math.round(((ft.py[i] + ft.py[i - 1]) / 2 - (dy / ds) * b) * f);
      let cx = 0, cy = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const X = sx + ox, Y = sy + oy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const p = (Y * W + X) * 4, ch = chroma(data, p);
        if (ch < (type === 'Fuzzy' ? 40 : 100)) continue;
        const a = (hueOf([data[p], data[p + 1], data[p + 2]]) / 360) * 2 * Math.PI;
        cx += ch * Math.cos(a); cy += ch * Math.sin(a);
      }
      if (cx || cy) out.push({ u: j + (k - 0.5) / M, hue: ((Math.atan2(cy, cx) / (2 * Math.PI)) * 255 + 255) % 255 });
    }
    return out;
  };
  /** the hue (p5) of the pixels within `rho` of (cx, cy), source px, when most of them have colour */
  const hueAround = (cx: number, cy: number, rho: number): number | null => {
    let sx = 0, sy = 0, got = 0, all = 0;
    for (let y = Math.max(0, Math.floor(cy - rho)); y <= Math.min(H - 1, Math.ceil(cy + rho)); y++)
      for (let x = Math.max(0, Math.floor(cx - rho)); x <= Math.min(W - 1, Math.ceil(cx + rho)); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > rho * rho) continue;
        all++;
        const p = (y * W + x) * 4, ch = chroma(data, p);
        if (ch < 100) continue;
        const a = (hueOf([data[p], data[p + 1], data[p + 2]]) / 360) * 2 * Math.PI;
        sx += ch * Math.cos(a); sy += ch * Math.sin(a); got++;
      }
    return got >= Math.max(12, 0.3 * all) ? ((Math.atan2(sy, sx) / (2 * Math.PI)) * 255 + 255) % 255 : null;
  };
  let fit: Fitter;
  if (anchored) {
    const c = cands[0], ramp = rampFromColumns(F, c.x0, c.A, c.n, S);
    fit = fitCurve(F, c.n, c.x0, c.A, { ramp, back: back() });
  } else {
    // the span counts that agree best with the ends of a whole canvas, and every span count over the
    // stroke's extent (the picture may be cropped; not for Fuzzy, whose noisy points would take the most)
    const tries = cands.filter(c => c.res < 0.5 * c.A).slice(0, 3);
    const r = F.r, [a, b] = type === 'Fuzzy' ? [0.56 * r, 2.83 * r] : [r, r], ex0 = F.box[0] + 0.5 + a, ex1 = F.box[2] + 0.5 - b;
    if (!tries.length || type !== 'Fuzzy') for (let n = 10; n <= 18; n++) tries.push({ n, A: (ex1 - ex0) / n, x0: ex0, res: 0 });
    // the points the colours give (see centres) tell the span width best: the knots must fit them
    const c0 = tries[0], ramp0 = rampFromColumns(F, c0.x0 + off, c0.A, c0.n, S);
    const pts = ramp0 && ramp0.R > 0.5 ? centres(F, ramp0, F.r * (type === 'Pipe' ? 14 / 26 : 1), type === 'Fuzzy') : [];
    let bestCost = Infinity, pick: Fitter | null = null;
    for (const c of tries) {
      const x0 = c.x0 + off, flat = new Float64Array(c.n + 3).fill((F.box[1] + F.box[3]) / 2), k = fitKnots(pts, c.n, x0, c.A, flat);
      const ff = k ? new Fitter(F, c.n, x0, c.A, k.Y) : fitCurve(F, c.n, x0, c.A, { quick: true, ramp: rampFromColumns(F, x0, c.A, c.n, S), back: back() });
      const cost = k ? k.res : 1e6 + ff.total();
      if (cost < bestCost) { bestCost = cost; pick = ff; }
    }
    fit = fitCurve(F, pick!.n, pick!.x0, pick!.A, { init: pick!.Y });
  }
  const spans = fit.n, A = fit.A, x0 = fit.x0;

  // the band radius measured from the edge to the line, the ramp from the line, and the final fit
  if (!anchored) { F.r = edgeRadius(fit); fit = fitCurve(F, spans, x0, A, { init: fit.Y }); }
  let samples = colours(fit), hf = fitHue(samples, S);
  if (hf && hf.R > 0.7 && type === 'Fuzzy') {
    // Fuzzy: the colours place the cloud
    const Yc = fitKnots(centres(F, hf, F.r, true), spans, x0, A, fit.Y);
    if (Yc) { fit = new Fitter(F, spans, x0, A, Yc.Y); samples = colours(fit); hf = fitHue(samples, S) ?? hf; }
  } else if (hf && hf.R > 0.7) {
    // then the colours place the line: each dot's colour shows on an arc one dot radius behind it
    const Yc = fitKnots(centres(F, hf, colourRadius() / f), spans, x0, A, fit.Y)?.Y;
    if (Yc) {
      const alt = fitCurve(F, spans, x0, A, { init: Yc, polish: true });
      if (alt.total() <= fit.total() * 1.5 + 50) { fit = alt; samples = colours(fit); hf = fitHue(samples, S) ?? hf; }
    }
  }
  // HyperRainbow (Color Spread 0.5): the hue climbs 2 a step, 2·(S + 1) a span, round the wheel again and again.
  // The colours along the line give that slope, not a fair phase (rings show the dots before theirs, Ribbed's band
  // is its ribs, wider than its dots, a Bold line is too loose). The end dot, drawn last and filled (Pipe, Slinky: the
  // one before the last ring), shows its own colour: the phase from it, else from the colours at the dots' rim.
  const HK = 2 * (S + 1), snap = !!hf && type !== 'Fuzzy' && hf.R > 0.2 && Math.abs(Math.abs(hf.k) / HK - 1) < 0.02;
  if (snap) {
    const k = Math.sign(hf!.k) * HK, i = type === 'Pipe' || type === 'Slinky' ? S - 1 : S, u = spans - 1 + i / S;
    const e = hueAround((x0 + A * u) * f, crAt(fit.Y, u) * f, 0.6 * colourRadius());
    const rim = anchored && cands[0].band === 'Ribbed' ? colours(fit, (F.r * 24) / 26 + 0.5 - 1.5 / f) : samples;
    hf = { k, c: e === null ? circ(rim, k).c : e - k * (spans - 1 + i / (S + 1)), R: circ(samples, k).R };
  }
  const r = F.r;
  stats.radius = r;
  if (!anchored) {
    // Bold's band is 1.6 to 2.7 spans wide, Pipe's rings 1.1 to 1.9, the others about one
    if ((type === 'Normal' || type === 'Ribbed') && r / A > 1.3) type = type === 'Ribbed' && stats.dark > 0.15 ? 'Pipe' : 'Bold';
    else if (type === 'Ribbed' && stats.dark > 0.15 && r / A > 1.12) type = 'Pipe';
  }

  // to the 1200 × 800 canvas: the picture's own when it is the canvas, else scaled by the stroke
  const s = canvas ? (CANVAS.w * f) / W : (BAND[type] * CANVAS.h) / r;
  const ox = canvas ? 0 : CANVAS.w / 4 + A * s - (x0 - off) * s;
  let oy = 0;
  if (!canvas) { let lo = Infinity, hi = -Infinity; for (let i = 0; i < fit.py.length; i++) { lo = Math.min(lo, fit.py[i]); hi = Math.max(hi, fit.py[i]); } oy = CANVAS.h / 2 - ((lo + hi) / 2 - off) * s; }

  // the curve at the script's own step count, coloured by the ramp (or, without a clean one, as seen)
  const ramp = !!hf && (snap || hf.R > 0.75);
  samples.sort((a, b) => a.u - b.u);
  /** step i of span j: the ramp's hue (snapped: the script's own, step by step), or the nearest colour seen */
  const hueAt = (j: number, i: number): number => {
    const u = j + i / S;
    if (ramp) return hueOf(hsbToRgb(((hf!.k * (snap ? j + i / (S + 1) : u) + hf!.c) % 255 + 255) % 255, 255, 255));
    let lo = 0, hi = samples.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (samples[mid].u < u) lo = mid; else hi = mid; }
    const sm = samples.length ? (Math.abs(samples[lo].u - u) < Math.abs(samples[hi].u - u) ? samples[lo] : samples[hi]) : null;
    return sm ? hueOf(hsbToRgb(sm.hue, 255, 255)) : 0;
  };
  const div = 4, points: CurvePoint[] = [], Y = fit.Y;
  for (let j = 0; j < spans; j++) for (let i = j ? 1 : 0; i <= S; i++) {
    const t = i / S, t2 = t * t, t3 = t2 * t, u = j + t;
    const y = Y[j] * (-0.5 * t3 + t2 - 0.5 * t) + Y[j + 1] * (1.5 * t3 - 2.5 * t2 + 1) + Y[j + 2] * (-1.5 * t3 + 2 * t2 + 0.5 * t) + Y[j + 3] * (0.5 * t3 - 0.5 * t2);
    const pt: CurvePoint = { x: (x0 + A * u - off) * s + ox, y: (y - off) * s + oy, hue: hueAt(j, i) };
    if ((type === 'Pipe' || type === 'Slinky') && (i === 0 || i === S - 1 || (i === S && j < spans - 1))) pt.end = true;
    if (type === 'Ribbed' && (i % div === 0 || i === S - 1)) pt.rib = true;
    points.push(pt);
  }
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const p of points) { bx0 = Math.min(bx0, p.x); by0 = Math.min(by0, p.y); bx1 = Math.max(bx1, p.x); by1 = Math.max(by1, p.y); }
  const hyper = ramp && Math.abs(hf!.k) > S + 1;     // other spreads: (S + 1) / 5 at most
  const curve: Curve = {
    id: o.id ?? 0, type, spectrum: hyper ? 'HyperRainbow' : 'Normal',
    canvas: { ...CANVAS }, points, stroke: STROKE[type] * CANVAS.h,
    outline: type === 'Pipe' ? CANVAS.h / 7 : null, ribGray: type === 'Ribbed' ? ribGray : null,
    box: { x0: bx0, y0: by0, x1: bx1, y1: by1 },
  };
  const features: Record<string, string | number> = { Type: type, Segments: spans + 1 };
  if (hyper) features.Spectrum = 'HyperRainbow';
  if (ramp) features['Color Direction'] = hf!.k > 0 ? 'Forward' : 'Reverse';
  const notes = [!ramp ? 'The line follows the original closely, but its colours could only be read roughly: their order along the line is approximate.'
    : hyper ? 'The line follows the original closely and its HyperRainbow colours come in the same order, but where each one falls along the line is approximate.'
    : 'The line and its colours follow the original closely, though the exact position of each point is approximate.'];
  return { curve, features, notes, fit: { spans, anchored, radius: r * f, cost: fit.total(), hueFit: hf?.R ?? 0, stats } };
}
