// Stage 2 — Mosaic: the Squiggle as a flat picture, 1 stud = 1 cell, on black.
// Black base plates (16×16), a layer of tiles on top merged into the largest
// pieces each colour allows, placed so they bridge every base plate seam.
import { checkModel } from '../core/check';
import { availableAtLego, elementId } from '../core/lego';
import { partId, TILE_SIZES, type Piece } from '../core/parts';
import { arcLength, type Curve } from './curve';
import type { Pixel } from '../riggle/pixels';
import { GREYS as GREY_RAMP, greyCoord } from './spectrum';
import { summarize, type Scale, type SqModel } from './model';
import { nameplateLines } from './nameplate';
import { endCap } from './ribbon';
import { BLACK, GREYS, LIGHT_OF, SPECTRUM, WHITE, curveColors, hslRgb, nearestBrick } from './spectrum';

export const MOSAIC_GRID: Record<Scale, [number, number]> = { small: [64, 32], large: [96, 48] };
const PLATE = 16, MARGIN = 2, BAND = 8, NAMEPLATE: [number, number] = [6, 2];

export interface MosaicPicture {
  w: number; h: number;
  /** colour per cell, index x + z·w, z = 0 at the front (bottom of the picture) */
  cells: number[];
  /** the curve point drawn on top of each cell, -1 for the background */
  last: Int32Array;
  k: number;                 // studs per canvas pixel
  stroke: number;            // stroke width, studs
  /**
   * Keep every piece inside one cell of `last`.
   *
   * A Pixelated riggle is drawn as squares, and the tiler's job is normally to
   * merge neighbours of a colour into the longest piece it can. Those two pull
   * against each other: merged across its squares, a pixelated riggle comes out
   * as bars and stops reading as pixels. With this set a piece may not cross
   * from one of the engine's cells into the next, so the grid survives.
   */
  perCell?: boolean;
}

export interface PictureOptions {
  /**
   * Stamp a square at every point instead of a disc, and leave the end dot off.
   *
   * A Squiggle is a smooth curve drawn as a chain of overlapping circles, so a
   * disc is what its stroke really is. A riggle is a square wave the engine
   * draws as axis-aligned rectangles with mitred joins and flat ends, so discs
   * round off the one thing that makes it a riggle. Marching a square gives the
   * straight runs, the mitred corners and the flat ends all at once, because
   * the squares of two runs overlap across their corner.
   */
  square?: boolean;
  /**
   * Accordion ribs: a band one stud long across the stroke, every `pitch`
   * studs of arc length, in `colour`.
   *
   * The engine stamps the accordion's squares every S/3.2 along the wave,
   * which lands at about 1.6 studs on the large mosaic and under one stud on
   * some riggles. Nothing finer than a stud can be built, so the ribs here
   * keep the segmented look at a pitch bricks can hold rather than copying a
   * spacing that would come out as noise.
   */
  ribs?: { pitch: number; colour: number | 'step' | 'light' };
  /**
   * A Pixelated riggle's own cells, straight from the engine, in canvas
   * pixels. When these are given the picture is built from them instead of
   * from the stroke: that body paints a constellation of grid-aligned cells
   * and has no stroke to follow, so marching the centre line gave back a solid
   * ribbon, the one thing it is not.
   */
  pixels?: Pixel[];
  /**
   * The brick the field behind the riggle is built in. Black unless the riggle
   * says otherwise: the chain picks black or volt per piece, and an Inverted
   * one sits on its own anchor colour, so the model sits on the field the art
   * sits on. It can be a spectrum colour, so what counts as field is read off
   * the picture's `last`, never off a tile's colour.
   */
  field?: number;
  /**
   * Hollow the riggle out, leaving a contour one stud thick: the Outline
   * legendary draws the wave and then fills its inside with the background,
   * so what you see is a thin edge. The engine's contour is about a tenth of
   * the stroke, under a stud, and one stud is the thinnest a brick goes.
   */
  hollow?: boolean;
}

/** One brick colour for a cell the engine painted: its hue, or its lightness when the riggle has no hue. */
function brickOf(p: Pixel, sat: number): number {
  if (p.grey) return GREY_RAMP[Math.max(0, Math.min(GREY_RAMP.length - 1, Math.round(greyCoord(p.light))))];
  return nearestBrick(hslRgb(p.hue, sat, p.light));
}

/**
 * A Pixelated riggle: the engine's own cells, fitted to the grid. Each cell
 * covers at least one stud, so a riggle whose cells fall below a stud comes
 * out coarser than the render rather than disappearing.
 */
function pixelPicture(pixels: Pixel[], W: number, H: number, pad: number, field: number, sat: number): MosaicPicture {
  // The engine lays this body on a grid of equal squares, so the bricks go on
  // one too. Scaling each cell's own rectangle gave squares of one size and
  // oblongs of another, depending where the rounding fell, and a pixelated
  // riggle made of oblongs is not pixelated. Cells are placed by their index
  // on that grid instead, every one the same square.
  const size = pixels[0].size;
  let gx0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gz1 = -Infinity;
  const at = pixels.map((p) => {
    const gx = Math.round(p.x / size), gz = Math.round(p.y / size);
    gx0 = Math.min(gx0, gx); gx1 = Math.max(gx1, gx);
    gz0 = Math.min(gz0, gz); gz1 = Math.max(gz1, gz);
    return { gx, gz };
  });
  const rawW = gx1 - gx0 + 1, rawH = gz1 - gz0 + 1;
  // A stud is the smallest a cell goes, so a grid wider than the panel has to
  // be coarsened rather than squeezed: whole cells are grouped, which keeps them
  // square and keeps the margin, instead of letting the art run to the edge.
  const group = Math.max(1, Math.ceil(rawW / (W - 2 * pad)), Math.ceil(rawH / (H - 2 * pad)));
  const gw = Math.ceil(rawW / group), gh = Math.ceil(rawH / group);
  const side = Math.max(1, Math.floor(Math.min((W - 2 * pad) / gw, (H - 2 * pad) / gh)));
  const ox = Math.floor((W - gw * side) / 2), oz = Math.floor((H - gh * side) / 2);
  const last = new Int32Array(W * H).fill(-1);
  const cells = new Array<number>(W * H).fill(field);
  pixels.forEach((p, i) => {
    const col = brickOf(p, sat);
    const x0 = ox + Math.floor((at[i].gx - gx0) / group) * side;
    const z0 = oz + Math.floor((gz1 - at[i].gz) / group) * side;   // z counts from the front
    for (let dx = 0; dx < side; dx++) for (let dz = 0; dz < side; dz++) {
      const x = x0 + dx, z = z0 + dz;
      if (x < 0 || z < 0 || x >= W || z >= H) continue;
      last[x + z * W] = i; cells[x + z * W] = col;
    }
  });
  return { w: W, h: H, cells, last, k: side / size, stroke: side, perCell: true };
}

/** The picture: every cell takes the colour of the last curve point whose stroke covers its centre. */
export function mosaicPicture(curve: Curve, scale: Scale, grid?: [number, number], opts: PictureOptions = {}): MosaicPicture {
  const [W, H] = grid ?? MOSAIC_GRID[scale], { box, points } = curve;
  // A square stamp reaches the full half-width in both axes at once, so at the
  // extremes it can claim a stud a disc would have left as margin. Half a stud
  // of extra budget keeps the black border the rule asks for.
  const pad = MARGIN + (opts.square ? 1 : 0);
  const k = Math.min((W - 2 * pad) / (box.x1 - box.x0 + curve.stroke), (H - 2 * pad) / (box.y1 - box.y0 + curve.stroke));
  const pcx = (box.x0 + box.x1) / 2, pcy = (box.y0 + box.y1) / 2, r = curve.stroke * k / 2;
  const X = points.map(p => W / 2 + (p.x - pcx) * k), Z = points.map(p => H / 2 + (pcy - p.y) * k);
  // the end cap the original draws over everything (Ribbed: rib disc and dense-rib tail, Pipe: filled end dot),
  // from the end point on: its disc is the dot; the colours before it catch up with its colour one step a stud
  if (opts.pixels?.length) return pixelPicture(opts.pixels, W, H, pad, opts.field ?? BLACK, curve.sat ?? 100);

  const plain = curveColors(curve, 2 / k);
  const colors = opts.square ? plain : endCap(curve, plain, 0, 1 / k);
  const last = new Int32Array(W * H).fill(-1);
  points.forEach((_, i) => {
    const cx = X[i], cz = Z[i];
    for (let x = Math.max(0, Math.ceil(cx - r - 0.5)); x <= Math.min(W - 1, Math.floor(cx + r - 0.5)); x++)
      for (let z = Math.max(0, Math.ceil(cz - r - 0.5)); z <= Math.min(H - 1, Math.floor(cz + r - 0.5)); z++) {
        const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
        const inside = opts.square ? Math.abs(dx) <= r && Math.abs(dz) <= r : dx * dx + dz * dz <= r * r;
        if (inside) last[x + z * W] = i;
      }
  });
  const cells = [...last].map(i => (i < 0 ? (opts.field ?? BLACK) : colors[i]));
  // Accordion ribs.
  //
  // The engine stamps this body as a row of squares along the wave, and what
  // you see are their bright leading edges. So a rib is a LINE ACROSS the
  // stroke, square to the direction of travel: upright while the wave runs
  // sideways, flat while it climbs. The count runs along the whole wave, so at
  // a corner the upright ribs of the run and the flat ribs of the riser both
  // carry on through it and cross.
  //
  // Deciding a rib per cell, from the nearest point on the line, cannot do
  // that: every cell around a corner reads the same arc position, so the whole
  // corner ribs or does not as one block and the rib never turns. Walking the
  // wave and drawing each rib as a line is what the art does.
  //
  // A rib needs a colour the background does not use. A Squiggle's are grey and
  // ribGray says which way they go; a riggle's are its own colour a shade
  // lighter. Black would paint the background through the body, so the caller
  // says what the ribs are or there are none.
  const ribSpec = opts.ribs ?? (curve.ribGray !== null ? { pitch: 2, colour: (curve.ribGray ?? 0) < 128 ? BLACK : WHITE } : null);
  if (curve.type === 'Ribbed' && ribSpec) {
    const ribOf = (c: number) => {
      if (ribSpec.colour === 'light') return LIGHT_OF[c] ?? GREYS[GREYS.length - 1];
      if (ribSpec.colour !== 'step') return ribSpec.colour;
      const g = GREYS.indexOf(c);
      if (g >= 0) return GREYS[(g + 1) % GREYS.length];
      const i = SPECTRUM.findIndex(v => v.id === c);
      return i < 0 ? c : SPECTRUM[(i + 1) % SPECTRUM.length].id;
    };
    const s = arcLength(points).map(v => v * k);           // arc along the wave, in studs
    const total = s[s.length - 1] ?? 0;
    const pitch = Math.max(2, Math.round(ribSpec.pitch));
    if (!opts.square) {
      // A curve's ribs lie square to its tangent, which swings through every
      // angle, so they cannot be drawn as upright or flat lines. Each cell
      // takes its band from the nearest point on the pass drawn over it, as
      // the Squiggle tool has always done.
      last.forEach((i, key) => {
        if (i < 0) return;
        const x = key % W + 0.5, z = Math.floor(key / W) + 0.5;
        let best = i, bd = Infinity;
        for (let j = i; j >= 0 && s[i] - s[j] <= 2 * r; j--) { const d = (X[j] - x) ** 2 + (Z[j] - z) ** 2; if (d < bd) { bd = d; best = j; } }
        for (let j = i + 1; j < points.length && s[j] - s[i] <= 2 * r; j++) { const d = (X[j] - x) ** 2 + (Z[j] - z) ** 2; if (d < bd) { bd = d; best = j; } }
        if (Math.floor(s[best]) % pitch === pitch - 1) cells[key] = ribOf(cells[key]);
      });
      return { w: W, h: H, cells, last, k, stroke: curve.stroke * k };
    }
    let at = 0;
    // The square wave's ribs, laid down the way the engine lays them.
    //
    // Each stamp is a square the full width of the stroke, filled with the body
    // colour and OUTLINED a shade lighter, marched along the wave and drawn OVER
    // the one before. Doing the same here, in order, is what makes a corner
    // right: the later square covers the earlier one, so the rib arriving on top
    // cuts off the rib underneath instead of gridding across it. Drawing ribs
    // that only ever add light left both directions showing and crossed.
    //
    // The edges that run with the stroke pile up into an unbroken bright line
    // down each side; the leading edges become the ticks across it.
    const base = cells.slice();                 // body colours, before any rib
    const side = Math.max(2, Math.round(curve.stroke * k));
    const step = Math.max(2, Math.round(side / 3.2));       // engine: one stamp every S/3.2
    for (let a = 0; a <= total + step; a += step) {
      while (at + 1 < s.length && s[at + 1] < a) at++;
      const cx = Math.min(W - 1, Math.max(0, Math.floor(X[at])));
      const cz = Math.min(H - 1, Math.max(0, Math.floor(Z[at])));
      const body = base[cx + cz * W];
      if (last[cx + cz * W] < 0) continue;
      const lit = ribOf(body);
      const x0 = Math.round(X[at] - side / 2), z0 = Math.round(Z[at] - side / 2);
      for (let dx = 0; dx < side; dx++) for (let dz = 0; dz < side; dz++) {
        const x = x0 + dx, z = z0 + dz;
        if (x < 0 || z < 0 || x >= W || z >= H) continue;
        const i = x + z * W;
        if (last[i] < 0) continue;              // only where the riggle is
        const edge = dx === 0 || dz === 0 || dx === side - 1 || dz === side - 1;
        cells[i] = edge ? lit : base[i];        // the fill restores the body, erasing any rib under it
      }
    }
  }
  if (opts.hollow) {
    const filled = cells.slice();                 // colours before the inside is emptied
    const solidAt = (x: number, z: number) => filled[x + z * W];
    // The Outline legendary: every cell of the riggle that does not touch the
    // background is inside it, and the engine fills the inside with the
    // background, leaving a contour. A stud is the thinnest that contour goes.
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const i = x + z * W;
      if (last[i] < 0) continue;
      const open = x === 0 || z === 0 || x === W - 1 || z === H - 1
        || last[i - 1] < 0 || last[i + 1] < 0 || last[i - W] < 0 || last[i + W] < 0;
      if (!open) cells[i] = opts.field ?? BLACK;
    }
    // Square the corners. Hollowing can pinch the contour down to two cells
    // that meet only at their corner, which reads as a diagonal and, in bricks,
    // is not a join at all. Where a 2x2 holds one diagonal pair of contour and
    // one of background, the contour gets the cell that turns it into a right
    // angle.
    const bg = opts.field ?? BLACK;
    const solid = (x: number, z: number) =>
      x >= 0 && z >= 0 && x < W && z < H && last[x + z * W] >= 0 && cells[x + z * W] !== bg;
    for (let z = 0; z + 1 < H; z++) for (let x = 0; x + 1 < W; x++) {
      const a = solid(x, z), b = solid(x + 1, z), c = solid(x, z + 1), d = solid(x + 1, z + 1);
      if (a === d && b === c && a !== b) {
        // the pair to fill in is whichever diagonal is empty, and only where
        // the riggle actually runs
        const [p1, p2]: [number, number][] = a ? [[x + 1, z], [x, z + 1]] : [[x, z], [x + 1, z + 1]];
        for (const [px, pz] of [p1, p2]) {
          const i = px + pz * W;
          if (last[i] >= 0) { cells[i] = solidAt(px, pz); break; }
        }
      }
    }
  }
  return { w: W, h: H, cells, last, k, stroke: curve.stroke * k };
}

interface Rect { x: number; z: number; w: number; d: number; c: number; fixed?: boolean }
/** a base plate seam: the pairs of cells facing each other across it, and how many tiles must cross it */
interface Seam { pairs: [number, number][]; vertical: boolean; at: number; need: number }
/** base plate layout: where the columns of plates are cut along x, and each column's plates along z */
interface Layout { xs: number[]; zs: number[][] }

/** plate sides that come 16 long in black (2×16, 6×16, 8×16, 16×16): any two of them make a plate */
const SIDES = [2, 6, 8, PLATE];
const split = (w: number) => (!w || SIDES.includes(w) ? [w] : w === 4 ? [2, 2] : w === 10 ? [2, 8] : w === 12 ? [6, 6] : [6, 8]);
/** cuts of a length n: 16-stud strips from offset o, the strips left at both ends split into plate sides */
function cuts(n: number, o: number): number[] {
  const tail = (n - o) % PLATE, ws: number[] = [...split(o), ...Array((n - o - tail) / PLATE).fill(PLATE), ...split(tail).reverse()];
  return ws.filter(w => w).reduce((c, w) => [...c, c[c.length - 1] + w], [0]);
}
const span = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);
/** the z cuts on either side of column boundary c: its seam runs in segments between them */
const joints = ({ zs }: Layout, c: number) => [...new Set([...zs[c - 1], ...zs[c]])].sort((a, b) => a - b);
function seamsOf(W: number, L: Layout): Seam[] {
  const out: Seam[] = [];
  const seam = (vertical: boolean, at: number, pairs: [number, number][]) => out.push({ vertical, at, pairs, need: Math.ceil(pairs.length / 2) });
  L.xs.slice(0, -1).forEach((x0, c) => {
    for (const z of L.zs[c].slice(1, -1)) seam(false, z, span(x0, L.xs[c + 1]).map(x => [x + (z - 1) * W, x + z * W]));
    if (c) { const j = joints(L, c); for (let i = 0; i + 1 < j.length; i++) seam(true, x0, span(j[i], j[i + 1]).map(z => [x0 - 1 + z * W, x0 + z * W])); }
  });
  return out;
}
/** pairs of each seam held by one tile */
const bridgedBy = (seams: Seam[], own: ArrayLike<number>) => seams.map(s => s.pairs.filter(([a, b]) => own[a] === own[b]).length);

/** Tile the whole picture. `pre` = pieces placed first (the nameplate). */
function tilePicture(pic: MosaicPicture, layout: Layout, seams: Seam[], pre: Rect[], quick = false) {
  const { w: W, h: H, cells: col } = pic;
  const owner = new Int32Array(W * H).fill(-1), rects: (Rect | null)[] = [];
  const sizeCache = new Map<number, [number, number][]>();
  /** tile sizes sold in a colour, both orientations, largest first */
  const sizesOf = (c: number) => {
    let s = sizeCache.get(c);
    if (!s) {
      s = TILE_SIZES.filter(([a, b]) => a * b === 1 || availableAtLego('tile', a, b, c))
        .flatMap(([a, b]): [number, number][] => (a === b ? [[a, b]] : [[b, a], [a, b]])).sort((p, q) => q[0] * q[1] - p[0] * p[1]);
      sizeCache.set(c, s);
    }
    return s;
  };
  const free = (x: number, z: number, c: number) => x >= 0 && z >= 0 && x < W && z < H && owner[x + z * W] < 0 && col[x + z * W] === c;
  /** the engine cell a stud belongs to, when pieces must stay inside one */
  const cellOf = (x: number, z: number) => (pic.perCell ? pic.last[x + z * W] : 0);
  // The one place a piece is allowed out of its cell: a base plate joint has to
  // be crossed by tiles or the mosaic comes apart, and a grid of single studs
  // can never cross one.
  const seamX = new Set(seams.filter(q => q.vertical).map(q => q.at));
  const seamZ = new Set(seams.filter(q => !q.vertical).map(q => q.at));
  const spansSeam = (X: number, Z: number, w: number, d: number) => {
    for (let i = 1; i < w; i++) if (seamX.has(X + i)) return true;
    for (let j = 1; j < d; j++) if (seamZ.has(Z + j)) return true;
    return false;
  };
  const fits = (X: number, Z: number, w: number, d: number, c: number) => {
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) if (!free(X + i, Z + j, c)) return false;
    if (!pic.perCell) return true;
    const g = cellOf(X, Z);
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
      if (cellOf(X + i, Z + j) !== g && !spansSeam(X, Z, w, d)) return false;
    }
    return true;
  };
  const cellsOf = (r: Rect) => { const o: number[] = []; for (let j = 0; j < r.d; j++) for (let i = 0; i < r.w; i++) o.push(r.x + i + (r.z + j) * W); return o; };
  const put = (r: Rect) => { for (const k of cellsOf(r)) owner[k] = rects.length; rects.push(r); };
  const inside = (X: number, Z: number, w: number, d: number, x: number, z: number) => x >= X && z >= Z && x < X + w && z < Z + d;
  /** free same-colour cells next to the rectangle that it would leave with no free same-colour neighbour */
  const strands = (X: number, Z: number, w: number, d: number, c: number) => {
    let n = 0;
    const nb = (x: number, z: number) => free(x, z, c) && !inside(X, Z, w, d, x, z);
    const lone = (x: number, z: number) => nb(x, z) && !nb(x - 1, z) && !nb(x + 1, z) && !nb(x, z - 1) && !nb(x, z + 1);
    for (let i = 0; i < w; i++) n += +lone(X + i, Z - 1) + +lone(X + i, Z + d);
    for (let j = 0; j < d; j++) n += +lone(X - 1, Z + j) + +lone(X + w, Z + j);
    return n;
  };
  const better = (a: number[], b: number[] | null) => { if (!b) return true; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };

  // facing cells across the seams: cell -> [seam, the cell facing it]
  const facing = new Map<number, [number, number][]>();
  const face = (a: number, q: [number, number]) => { let l = facing.get(a); if (!l) facing.set(a, l = []); l.push(q); };
  seams.forEach((s, i) => { for (const [a, b] of s.pairs) { face(a, [i, b]); face(b, [i, a]); } });

  for (const r of pre) put({ ...r, fixed: true });

  // 1) seams first: a piece across every pair of facing cells that can still take one,
  // starting where plates meet at a corner, without taking a cell from a pair still to bridge
  type Line = { vertical: boolean; at: number };
  const blocks = (X: number, Z: number, w: number, d: number, c: number) => {
    let n = 0;
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) for (const [, b] of facing.get(X + i + (Z + j) * W) ?? [])
      if (!inside(X, Z, w, d, b % W, Math.floor(b / W)) && owner[b] < 0 && col[b] === c) n++;
    return n;
  };
  const cross = (s: Line, X: number, Z: number, w: number, d: number) =>
    s.vertical ? Math.min(s.at - X, X + w - s.at) * d : Math.min(s.at - Z, Z + d - s.at) * w;
  const bridge = (need: number[], lines: Line[]) => {
    const c = col[need[0]];
    if (need.some(k => col[k] !== c || owner[k] >= 0)) return;
    const xs = need.map(k => k % W), zs = need.map(k => Math.floor(k / W));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    let best: { s: number[]; r: Rect } | null = null;
    for (const [w, d] of sizesOf(c)) for (let X = x1 - w + 1; X <= x0; X++) for (let Z = z1 - d + 1; Z <= z0; Z++) {
      if (!fits(X, Z, w, d, c)) continue;
      const bal = Math.min(...lines.map(q => cross(q, X, Z, w, d)));
      const sc = [-blocks(X, Z, w, d, c), -strands(X, Z, w, d, c), bal >= 2 ? 1 : 0, w * d, bal];
      if (better(sc, best && best.s)) best = { s: sc, r: { x: X, z: Z, w, d, c } };
    }
    if (best) put(best.r);
  };
  layout.xs.slice(1, -1).forEach((x, c) => { for (const z of joints(layout, c + 1).slice(1, -1))
    bridge([x - 1 + (z - 1) * W, x + (z - 1) * W, x - 1 + z * W, x + z * W], [{ vertical: true, at: x }, { vertical: false, at: z }]); });
  for (const s of [...seams.filter(q => !q.vertical), ...seams.filter(q => q.vertical)])
    for (const [a, b] of s.pairs) bridge([a, b], [s]);

  // 2) everything else, row by row from the front; the scan cell is the piece's corner
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (owner[x + z * W] >= 0) continue;
    const c = col[x + z * W];
    let best: { s: number[]; r: Rect } | null = null;
    for (const [w, d] of sizesOf(c)) {
      if (!fits(x, z, w, d, c)) continue;
      const sc = [-strands(x, z, w, d, c), w * d, w >= d ? 1 : 0];
      if (better(sc, best && best.s)) best = { s: sc, r: { x, z, w, d, c } };
    }
    put(best!.r);
  }
  if (quick) return { rects: rects as Rect[], bridged: bridgedBy(seams, owner) };

  // 3) a 1×1 next to a cell of its colour: cut it again with the pieces around it, without
  // any 1×1 and without leaving a seam under-bridged
  const count = bridgedBy(seams, owner);
  /** bridged pairs inside U, per seam */
  const inU = (U: Set<number>, own: (k: number) => number | undefined) => {
    const m = new Map<number, number>();
    for (const a of U) for (const [s, b] of facing.get(a) ?? []) if (a < b && U.has(b) && own(a) === own(b)) m.set(s, (m.get(s) ?? 0) + 1);
    return m;
  };
  function recut(ids: number[], c: number): boolean {
    const U = new Set(ids.flatMap(j => cellsOf(rects[j]!))), order = [...U].sort((a, b) => a - b);
    if (U.size > 40) return false;
    const old = inU(U, k => owner[k]);
    const sizes = sizesOf(c).filter(([w, d]) => w * d > 1), done = new Set<number>(), who = new Map<number, number>();
    const best = { n: Infinity, b: -1, r: null as Rect[] | null }, cur: Rect[] = [];
    let calls = 0;
    const rec = () => {
      if (++calls > 20000 || cur.length > best.n) return;
      const u = order.find(k => !done.has(k));
      if (u === undefined) {
        const now = inU(U, k => who.get(k));
        const ok = [...new Set([...old.keys(), ...now.keys()])].every(s => {
          const d = (now.get(s) ?? 0) - (old.get(s) ?? 0);
          return d >= 0 || count[s] + d >= seams[s].need;
        });
        const b = [...now.values()].reduce((p, q) => p + q, 0);
        if (ok && (cur.length < best.n || b > best.b)) Object.assign(best, { n: cur.length, b, r: [...cur] });
        return;
      }
      const x = u % W, z = Math.floor(u / W);
      for (const [w, d] of sizes) {
        if (x + w > W) continue;
        const ks: number[] = [];
        for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) ks.push(x + i + (z + j) * W);
        if (ks.some(k => !U.has(k) || done.has(k))) continue;
        ks.forEach(k => { done.add(k); who.set(k, cur.length); });
        cur.push({ x, z, w, d, c }); rec(); cur.pop();
        ks.forEach(k => done.delete(k));
      }
    };
    rec();
    if (!best.r) return false;
    for (const [s, n] of old) count[s] -= n;
    for (const j of ids) rects[j] = null;
    for (const r of best.r) put(r);
    for (const [s, n] of inU(U, k => owner[k])) count[s] += n;
    return true;
  }
  /** the movable pieces of colour c touching a piece */
  const around = (r: Rect, c: number) => {
    const ks: number[] = [];
    for (let i = 0; i < r.w; i++) { if (r.z > 0) ks.push(r.x + i + (r.z - 1) * W); if (r.z + r.d < H) ks.push(r.x + i + (r.z + r.d) * W); }
    for (let j = 0; j < r.d; j++) { if (r.x > 0) ks.push(r.x - 1 + (r.z + j) * W); if (r.x + r.w < W) ks.push(r.x + r.w + (r.z + j) * W); }
    return [...new Set(ks.filter(k => col[k] === c).map(k => owner[k]))].filter(j => !rects[j]!.fixed);
  };
  for (let pass = 0, changed = true; changed && pass < 4; pass++) {
    changed = false;
    for (let i = 0; i < rects.length; i++) {
      const t = rects[i];
      if (!t || t.w * t.d !== 1 || t.fixed) continue;
      const nbs = around(t, t.c), far = (j: number) => [j, ...around(rects[j]!, t.c)];
      const tries = [...nbs.map(j => [j]), ...nbs.flatMap((a, p) => nbs.slice(p + 1).map(b => [a, b])), ...nbs.map(far), nbs.flatMap(far)];
      for (const js of tries) if (recut([i, ...new Set(js.filter(j => j !== i))], t.c)) { changed = true; break; }
    }
  }

  /**
   * A 1×1 still there: the tiles of its colour within two rings of pieces around it (a smaller patch past 40
   * cells) cut again exactly, 1×1 allowed but fewer of them, then fewer pieces, every seam still bridged.
   */
  const SHAPES: [number, number][] = [[1, 2], [1, 3], [1, 4], [1, 6], [1, 8], [2, 2], [2, 3], [2, 4], [2, 6]].flatMap(([a, b]): [number, number][] => (a === b ? [[a, b]] : [[a, b], [b, a]]));
  function fewer(i: number): boolean {
    const t = rects[i]!, c = t.c, shapes: [number, number][] = [...SHAPES.filter(([w, d]) => availableAtLego('tile', w, d, c)), [1, 1]];
    const nbs = (k: number) => [k % W > 0 && k - 1, k % W < W - 1 && k + 1, k >= W && k - W, k < W * (H - 1) && k + W].filter((q): q is number => q !== false);
    let set = new Set([i]);
    for (let ring = 0; ring < 2; ring++) for (const j of [...set]) for (const k of cellsOf(rects[j]!)) for (const q of nbs(k)) {
      const o = owner[q];
      if (o >= 0 && rects[o]!.c === c && !rects[o]!.fixed) set.add(o);
    }
    if ([...set].reduce((n, j) => n + rects[j]!.w * rects[j]!.d, 0) > 40) set = new Set([...set].filter(j => Math.abs(rects[j]!.x - t.x) + Math.abs(rects[j]!.z - t.z) <= 3));
    const ids = [...set], U = new Set(ids.flatMap(j => cellsOf(rects[j]!))), order = [...U].sort((a, b) => a - b);
    const old = inU(U, k => owner[k]), was = ids.filter(j => rects[j]!.w * rects[j]!.d === 1).length, who = new Map<number, number>(), cur: Rect[] = [];
    const best = { ones: was, n: Infinity, r: null as Rect[] | null };
    let nodes = 0;
    const rec = (p: number, ones: number): void => {
      if (++nodes > 50000 || ones > best.ones || (ones === best.ones && (best.r === null || cur.length >= best.n))) return;
      while (p < order.length && who.has(order[p])) p++;
      if (p === order.length) {
        const now = inU(U, k => who.get(k));
        if ([...new Set([...old.keys(), ...now.keys()])].every(s => count[s] + (now.get(s) ?? 0) - (old.get(s) ?? 0) >= seams[s].need || (now.get(s) ?? 0) >= (old.get(s) ?? 0)))
          Object.assign(best, { ones, n: cur.length, r: [...cur] });
        return;
      }
      const k = order[p], x = k % W, z = Math.floor(k / W);
      for (const [w, d] of shapes) {
        if (x + w > W) continue;
        const ks: number[] = [];
        for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) ks.push(x + a + (z + b) * W);
        if (ks.some(q => !U.has(q) || who.has(q))) continue;
        ks.forEach(q => who.set(q, cur.length));
        cur.push({ x, z, w, d, c });
        rec(p + 1, ones + (w * d === 1 ? 1 : 0));
        cur.pop();
        ks.forEach(q => who.delete(q));
      }
    };
    rec(0, 0);
    if (!best.r) return false;
    for (const [s, n] of old) count[s] -= n;
    for (const j of ids) rects[j] = null;
    for (const r of best.r) put(r);
    for (const [s, n] of inU(U, k => owner[k])) count[s] += n;
    return true;
  }

  // 4) merge neighbours of one colour into a bigger piece when one exists; then the 1×1 left, and again
  for (let round = 0; ; round++) {
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < rects.length; i++) {
        const a = rects[i];
        if (!a || a.fixed) continue;
        for (const [x, z] of [[a.x + a.w, a.z], [a.x, a.z + a.d]]) {
          if (x >= W || z >= H) continue;
          const j = owner[x + z * W], b = rects[j];
          if (!b || b.fixed || b.c !== a.c) continue;
          const along = x > a.x;
          if (along ? b.z !== a.z || b.d !== a.d : b.x !== a.x || b.w !== a.w) continue;
          if (pic.perCell && cellOf(a.x, a.z) !== cellOf(x, z) && !spansSeam(Math.min(a.x, x), Math.min(a.z, z), along ? a.w + b.w : a.w, along ? a.d : a.d + b.d)) continue;
          const m: Rect = { x: a.x, z: a.z, w: along ? a.w + b.w : a.w, d: along ? a.d : a.d + b.d, c: a.c };
          if (!sizesOf(a.c).some(([w, d]) => w === m.w && d === m.d)) continue;
          rects[i] = rects[j] = null; put(m); changed = true; break;
        }
      }
    }
    if (round === 4) break;
    let again = false;
    bridgedBy(seams, owner).forEach((n, s) => { count[s] = n; });
    for (let i = 0; i < rects.length; i++) { const t = rects[i]; if (t && t.w * t.d === 1 && !t.fixed && t.c !== BLACK && fewer(i)) again = true; }
    if (!again) break;
  }
  return { rects: rects.filter((r): r is Rect => !!r), bridged: bridgedBy(seams, owner) };
}

/** a recoloured cell weighs as much as this many more base plates; layouts tiled after the plain grid */
const CELL = 4, TRIES = 3;

/**
 * Base layouts, best first by the crossings their seams would lack if every pair of one colour across
 * them were bridged (read from the picture, before tiling), plus a quarter per plate: for every offset
 * of the columns of plates, the row offsets column by column (each column's own) that do best.
 */
function layouts(pic: MosaicPicture, np: Rect): { layout: Layout; est: number }[] {
  const { w: W, h: H } = pic, col = [...pic.cells];
  for (let i = 0; i < np.w; i++) for (let j = 0; j < np.d; j++) col[np.x + i + (np.z + j) * W] = -1;
  /** crossings a seam would lack; a pair half under the nameplate cannot be recoloured into one */
  const lack = (pairs: [number, number][]) => {
    let same = 0, fix = 0;
    for (const [a, b] of pairs) if (col[a] === col[b]) same++; else if (col[a] >= 0 && col[b] >= 0) fix++;
    const d = Math.max(0, Math.ceil(pairs.length / 2) - same);
    return d + 100 * Math.max(0, d - fix);
  };
  const rows = Array.from({ length: PLATE / 2 }, (_, i) => cuts(H, 2 * i)), out: { layout: Layout; est: number }[] = [];
  for (let ox = 0; ox < PLATE; ox += 2) {
    const xs = cuts(W, ox), f: number[][] = [], from: number[][] = [];
    xs.slice(0, -1).forEach((x0, c) => {
      f.push([]); from.push([]);
      rows.forEach((zq, q) => {
        let v = (zq.length - 1) / CELL, b = -1;
        for (const z of zq.slice(1, -1)) v += lack(span(x0, xs[c + 1]).map(x => [x + (z - 1) * W, x + z * W]));
        if (c) {
          let m = Infinity;
          rows.forEach((zp, p) => {
            const j = joints({ xs, zs: [zp, zq] }, 1);
            let u = f[c - 1][p];
            for (let i = 0; i + 1 < j.length; i++) u += lack(span(j[i], j[i + 1]).map(z => [x0 - 1 + z * W, x0 + z * W]));
            if (u < m) { m = u; b = p; }
          });
          v += m;
        }
        f[c][q] = v; from[c][q] = b;
      });
    });
    const n = f.length - 1, zs: number[][] = [];
    let q = f[n].indexOf(Math.min(...f[n]));
    const est = f[n][q];
    for (let c = n; c >= 0; q = from[c][q], c--) zs.unshift(rows[q]);
    out.push({ layout: { xs, zs }, est });
  }
  return out.sort((a, b) => a.est - b.est);
}

/**
 * Tile the picture on the base layout that needs the fewest recoloured cells (an extra plate costs a
 * quarter of one): 16×16 plates from the corner, else the best few of `layouts`. Where a seam still
 * falls short (dense ribs or colour bands across it), cells on one side of it take the colour of the
 * other: first the cells whose change leaves the other seams' matching pairs alone (at a corner, two
 * seams used to take turns flipping one cell), and never the same cell twice.
 */
function tileOnBase(pic: MosaicPicture, np: Rect) {
  const plates = (L: Layout) => L.zs.reduce((n, z) => n + z.length - 1, 0);
  const settle = (layout: Layout) => {
    const p = { ...pic, cells: [...pic.cells], last: Int32Array.from(pic.last) }, seams = seamsOf(pic.w, layout);
    const run = () => { const t = tilePicture(p, layout, seams, [np], true); return { ...t, short: seams.reduce((n, s, i) => n + Math.max(0, s.need - t.bridged[i]), 0) }; };
    let t = run();
    const moved = new Set<number>(), across = new Map<number, number[]>();
    for (const s of seams) for (const [a, b] of s.pairs) { across.set(a, [...across.get(a) ?? [], b]); across.set(b, [...across.get(b) ?? [], a]); }
    /** matching pairs across the seams that recolouring `from` would break */
    const loss = (from: number, to: number) => across.get(from)!.filter(q => q !== to && p.cells[q] === p.cells[from]).length;
    for (let round = 0; t.short && round < 6; round++) {
      seams.forEach((s, i) => {
        let lack = s.need - t.bridged[i];
        if (lack <= 0) return;
        // inside the stroke first (a rib gives way to the colour), then on the stroke's edge (the stroke grows)
        const cand = s.pairs.filter(([a, b]) => p.cells[a] !== p.cells[b]).flatMap(([a, b]) => {
          const inA = p.last[a] >= 0, inB = p.last[b] >= 0;
          const [from, to] = !inA ? [a, b] : !inB ? [b, a] : p.cells[a] === BLACK || p.cells[a] === WHITE ? [a, b] : [b, a];
          const opts = inA && inB ? [{ from, to, rank: 0 }, { from: to, to: from, rank: 2 }] : [{ from, to, rank: 1 }];
          return opts.filter(q => !moved.has(q.from)).map(q => ({ ...q, loss: loss(q.from, q.to) }));
        }).sort((u, v) => u.loss - v.loss || u.rank - v.rank);
        for (const { from, to } of cand) {
          if (lack <= 0) break;
          if (p.cells[from] === p.cells[to]) continue;
          p.cells[from] = p.cells[to]; p.last[from] = p.last[to]; moved.add(from); lack--;
        }
      });
      t = run();
    }
    const recoloured = pic.cells.filter((c, k) => c !== p.cells[k]).length;
    return { layout, seams, p, recoloured, cost: recoloured + 100 * t.short + plates(layout) / CELL };
  };
  const xs = cuts(pic.w, 0), grid = { xs, zs: xs.slice(1).map(() => cuts(pic.h, 0)) }, seen = new Set([JSON.stringify(grid)]);
  let best = settle(grid);
  if (best.cost > plates(grid) / CELL) for (const { layout, est } of layouts(pic, np).slice(0, TRIES)) {
    if (est >= best.cost) break;
    if (seen.has(JSON.stringify(layout))) continue;
    seen.add(JSON.stringify(layout));
    const t = settle(layout);
    if (t.cost < best.cost) best = t;
  }
  const { layout, seams, p, recoloured } = best;
  return { layout, seams, ...tilePicture(p, layout, seams, [np]), cells: p.cells, recoloured };
}

export function buildMosaic(curve: Curve, scale: Scale, meta: { id: number; hash: string }, grid?: [number, number], opts: PictureOptions = {}): SqModel {
  const field = opts.field ?? BLACK;
  const want = grid ?? MOSAIC_GRID[scale];
  const pic = mosaicPicture(curve, scale, grid, opts), { w: W, h: H } = pic;
  // the nameplate: a black 2×6 tile in the bottom-right corner of the margin
  const np: Rect = { x: W - NAMEPLATE[0], z: 0, w: NAMEPLATE[0], d: NAMEPLATE[1], c: BLACK };
  const { layout: { xs, zs }, seams, rects, cells, recoloured } = tileOnBase(pic, np);
  const pieces: Piece[] = [], steps: number[][] = [[]];
  const base = xs.slice(0, -1).flatMap((x, i) => zs[i].slice(0, -1).map((z, j) => ({ x, z, w: xs[i + 1] - x, d: zs[i][j + 1] - z })));
  for (const { x, z, w, d } of base.sort((a, b) => a.z - b.z || a.x - b.x)) {
    steps[0].push(pieces.length);
    // the base is covered by tiles, so it stays black whatever the field is:
    // volt's Lime does not come in plates this big
    pieces.push({ x, z, y: 0, h: 1, w, d, c: BLACK, kind: 'plate', part: partId('plate', w, d), group: 'base', role: 'display' });
  }
  // the tiles in bands of rows, front to back, then the nameplate
  // A tile belongs to the field when it is the field's colour. Reading that off
  // the picture instead looks safer but is not: tiles bridging a base plate seam
  // are recoloured after the picture is made, so the two disagree.
  //
  // Volt builds its field in Lime, which is also a spectrum colour, but a riggle
  // never wears both: the chain only picks volt when the piece's hues stay clear
  // of the yellow-greens, which is what voltOk tests for.
  const tile = (r: Rect): Piece => ({ x: r.x, z: r.z, y: 1, h: 1, w: r.w, d: r.d, c: r.c, kind: 'tile', part: partId('tile', r.w, r.d), role: r.c === field ? 'display' : 'squiggle' });
  const bands = new Map<number, number[]>();
  for (const r of rects) {
    if (r.fixed) continue;
    const b = Math.floor(r.z / BAND);
    if (!bands.has(b)) bands.set(b, []);
    bands.get(b)!.push(pieces.length);
    pieces.push(tile(r));
  }
  for (const b of [...bands.keys()].sort((p, q) => p - q)) steps.push(bands.get(b)!);
  const npIndex = pieces.length;
  pieces.push({ ...tile(np), nameplate: true });
  steps.push([npIndex]);

  // rules, read back from the pieces
  const own = new Int32Array(W * H).fill(-1);
  let overlap = 0;
  pieces.forEach((p, i) => { if (p.y === 1) for (let a = 0; a < p.w; a++) for (let b = 0; b < p.d; b++) { const k = p.x + a + (p.z + b) * W; if (own[k] >= 0) overlap++; own[k] = i; } });
  const covered = own.every(v => v >= 0) && !overlap && pieces.filter(p => p.y === 0).reduce((n, p) => n + p.w * p.d, 0) === W * H;
  const lit = cells.map((c, k) => (c === field ? null : [k % W, Math.floor(k / W)])).filter((v): v is number[] => !!v);
  const m = lit.length ? [Math.min(...lit.map(v => v[0])), W - 1 - Math.max(...lit.map(v => v[0])), Math.min(...lit.map(v => v[1])), H - 1 - Math.max(...lit.map(v => v[1]))] : [W, W, H, H];
  const across = bridgedBy(seams, own), short = across.filter((n, i) => n < seams[i].need).length;
  const bare = own.filter(v => v < 0).length, sides = ['left', 'right', 'bottom', 'top'], near = m.indexOf(Math.min(...m));
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const checks = {
    ...checkModel(pieces, { root: (_, i) => i === 0 }),
    twoStud: null, comInside: null,
    rules: [
      {
        name: 'Every stud covered', ok: covered && W === want[0] && H === want[1],
        detail: covered ? `Tiles cover the whole ${W}×${H} mosaic, with no gap or overlap`
          : bare || overlap ? `${plural(bare, 'stud')} left bare, ${overlap} covered twice` : `The base plates don’t fill the ${W}×${H} mosaic`,
      },
      {
        name: 'Room around the Squiggle', ok: Math.min(...m) >= MARGIN,
        detail: Math.min(...m) >= MARGIN ? `At least ${MARGIN} studs of background between the riggle and every edge` : `Only ${plural(m[near], 'stud')} of background between the riggle and the ${sides[near]} edge`,
      },
      {
        name: 'Base plates held together', ok: !short,
        detail: !short ? `Tiles cross every joint between the ${steps[0].length} base plates, along at least half its length`
          : `${plural(short, 'joint')} between the base plates crossed by tiles along less than half ${short === 1 ? 'its' : 'their'} length`,
      },
    ],
  };

  const s = summarize(pieces, 'table');
  const notes = [`Each stud stands for ${(1 / pic.k).toFixed(1)} pixels of the original; the line is ${pic.stroke.toFixed(1)} studs wide.`];
  if (xs[1] !== PLATE || zs.some(z => z[1] !== PLATE)) notes.push(`The base plates are shifted from the corner${zs.some(z => z.join() !== zs[0].join()) ? ' and staggered' : ''} so the tiles can cross every joint between them.`);
  if (recoloured) notes.push(`${plural(recoloured, 'cell')} along base plate seams recoloured to match ${recoloured > 1 ? 'their neighbours' : 'its neighbour'}, so a tile can cross the joint there.`);
  if (curve.type === 'Pipe') notes.push('The black rings of the Pipe vanish on the black background: only the colour core shows.');
  if (curve.type === 'Ribbed') notes.push(`Ribbed: ${(curve.ribGray ?? 0) < 128 ? 'black ribs show as gaps across the line' : 'white ribs across the line'}, 1 stud every 2 studs.`);
  const singles = pieces.filter(p => p.kind === 'tile' && p.w * p.d === 1 && p.c !== BLACK).length;
  if (singles) notes.push(`${plural(singles, 'spot')} of colour ${singles > 1 ? 'use 1×1 tiles' : 'uses a 1×1 tile'}: no longer tile in that colour fits there.`);
  const missing = s.bom.filter(l => !elementId(l.part, l.color));
  if (missing.length) notes.push(`Not sold by LEGO Pick a Brick: ${missing.map(l => `${l.name} ${l.colorName}`).join(', ')}.`);

  return {
    id: meta.id, format: 'mosaic', display: null, scale, pieces, steps, panel: { w: W, h: H },
    stepNotes: { 0: `Lay the ${steps[0].length} base plates edge to edge on a flat table: the tiles on top join them.` },
    bom: s.bom, subtotals: s.subtotals, colors: s.colors, checks, notes, dims: s.dims, grams: s.grams, cost: s.cost,
    pose: 'table', nameplate: { lines: nameplateLines(meta.id, meta.hash), piece: npIndex }, hanging: null,
  };
}
