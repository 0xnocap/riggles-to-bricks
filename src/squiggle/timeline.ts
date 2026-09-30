// Build animation of a Squiggle model: its steps one after the other, each piece
// dropping into place on a table, or pressed onto the hung panel from the
// viewer's side (pose 'wall': the model's y axis points at the viewer; the first
// step, the backing, and the back bricks under it are hung from the start).
// Other pieces under the model's floor would come from below. A hung ribbon goes
// up as one sweep from left to right, like the drawing, each layer a few studs
// behind the one under it: seen from the front, layers laid one after the other
// across the whole ribbon would hide each other, and half the build would show
// nothing new. (The booklet keeps its layer by layer steps.) A flat model (the
// Mosaic) is seen from above: its pieces drop from just above the board and fade in
// on the way, else those falling at its far edge would float over the studio.
// Pure maths, shared by the page's Stage and the video: seconds and stud units.
import { PL } from '../viewer/timeline';

export { PL };
export const DROP = 0.38;           // seconds a piece takes to land

export interface TimelinePiece { x: number; z: number; y: number; h: number; w: number; d: number; role?: string }
export interface TimelineInput { pieces: TimelinePiece[]; steps: number[][]; pose?: 'table' | 'wall' }
export interface TimelineOptions {
  /** seconds from the first piece setting off to the last one landing (default: 8–12 s by piece count) */
  build?: number;
  /** travel of a piece, stud units (default: from the model's size) */
  fall?: number;
  drop?: number;
  /** a hung ribbon as one sweep (default true; false: layer by layer, the booklet's steps) */
  sweep?: boolean;
  /** the steps before the Squiggle's first piece (the empty panel, the base) in place from the start (the video) */
  base?: boolean;
}

export interface SqTimeline {
  start: Float32Array;              // when each piece sets off (−Infinity: in place from the start)
  dir: Int8Array;                   // +1 from above / the viewer's side, −1 from below / behind
  drop: number;
  fall: number;
  fade: number;                     // part of the drop a piece takes to fade in (0: none)
  steps: [number, number][];        // first start and last landing of each step
  built: number;                    // the last piece lands
  order: number[];                  // piece indices in build order
}

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const ease = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeIO = (t: number) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** LAG: studs a layer of a sweeping ribbon trails the one under it; TURN: seconds a hung model's camera takes to face it */
const PAUSE = 0.12, MIN_STEP = 0.3, LAG = 3, TURN = 2.2;
/** a flat model (at most FLAT plates high): travel of its pieces (studs) and the part of the drop they fade in over */
const FLAT = 3, FLAT_FALL = 1.2, FLAT_FADE = 0.6;

/** The ribbon's pieces in sweep order: by the middle of the piece from left to right, each layer LAG studs behind
 *  the one under it, never before a piece it rests on. */
function sweep(P: TimelinePiece[], ids: number[]): number[] {
  const ys = [...new Set(ids.map(i => P[i].y))].sort((a, b) => a - b), key = new Map<number, number>(), top = new Map<string, number>();
  for (const i of [...ids].sort((a, b) => P[a].y - P[b].y)) {
    const p = P[i];
    let k = p.x + p.w / 2 + LAG * ys.indexOf(p.y);
    for (let x = p.x; x < p.x + p.w; x++) for (let z = p.z; z < p.z + p.d; z++) {
      const j = top.get(`${x},${z},${p.y}`);
      if (j !== undefined) k = Math.max(k, key.get(j)! + 0.01);
    }
    key.set(i, k);
    for (let x = p.x; x < p.x + p.w; x++) for (let z = p.z; z < p.z + p.d; z++) top.set(`${x},${z},${p.y + p.h}`, i);
  }
  return [...ids].sort((a, b) => key.get(a)! - key.get(b)! || P[a].y - P[b].y || P[a].z - P[b].z);
}

export function makeTimeline(m: TimelineInput, o: TimelineOptions = {}): SqTimeline {
  const P = m.pieces, n = P.length, drop = o.drop ?? DROP;
  const start = new Float32Array(n), dir = new Int8Array(n).fill(1);
  const x0 = Math.min(...P.map(p => p.x)), x1 = Math.max(...P.map(p => p.x + p.w));
  const z0 = Math.min(...P.map(p => p.z)), z1 = Math.max(...P.map(p => p.z + p.d));
  const wall = m.pose === 'wall', span = Math.max(x1 - x0, z1 - z0);
  const flat = !wall && Math.max(...P.map(p => p.y + p.h)) - Math.min(...P.map(p => p.y)) <= FLAT;
  const fall = o.fall ?? (wall ? Math.min(10, Math.max(5, 0.12 * span)) : flat ? FLAT_FALL : Math.min(14, Math.max(6, 0.16 * span)));
  const build = o.build ?? Math.min(12, Math.max(8, 6 + n / 120));
  const lead = o.base ? Math.max(0, m.steps.findIndex(s => s.some(i => P[i].role === 'squiggle'))) : 0;
  const hung = new Set([...(wall ? [...(m.steps[0] ?? []), ...P.flatMap((p, i) => (p.y < 0 ? [i] : []))] : []), ...m.steps.slice(0, lead).flat()]);
  P.forEach((p, i) => { if (p.y < 0) dir[i] = -1; if (hung.has(i)) start[i] = -Infinity; });
  // hidden pieces (under the floor) set off with the step before them and take no time of their own; in a step,
  // the lower pieces first (a step may list a brick before the one it rests on)
  const seen = m.steps.map(s => s.filter(i => dir[i] > 0 && !hung.has(i)).sort((a, b) => P[a].y - P[b].y));
  const weight = seen.map(s => Math.pow(s.length, 0.75));
  // steps timed as one: a hung ribbon's (all 'squiggle', over several layers) sweep, else each step on its own
  const groups: { steps: number[]; rib: boolean; ids: number[]; w: number; extra: number }[] = [];
  m.steps.forEach((s, j) => {
    const rib = wall && o.sweep !== false && s.length > 0 && s.every(i => P[i].role === 'squiggle'), g = groups.at(-1);
    if (rib && g?.rib) g.steps.push(j); else groups.push({ steps: [j], rib, ids: [], w: 0, extra: 0 });
  });
  for (const g of groups) {
    const ids = g.steps.flatMap(j => seen[j]), live = g.steps.filter(j => seen[j].length).length;
    g.ids = g.rib && new Set(ids.map(i => P[i].y)).size > 1 ? sweep(P, ids) : ids;
    // a sweep takes the time of the steps it merges, their pauses included
    g.w = g.steps.reduce((a, j) => a + weight[j], 0); g.extra = PAUSE * Math.max(0, live - 1);
  }
  const live = groups.filter(g => g.ids.length);
  // group lengths ∝ count^0.75 (at least MIN_STEP), fitted to the build time
  const room = Math.max(0.1, build - PAUSE * Math.max(0, live.length - 1) - drop - live.reduce((a, g) => a + g.extra, 0));
  let k = room / Math.max(1e-6, live.reduce((a, g) => a + g.w, 0));
  for (let it = 0; it < 30; it++) k *= Math.max(0.2, room / live.reduce((a, g) => a + Math.max(MIN_STEP, k * g.w), 1e-6));
  let t = 0;
  for (const g of groups) {
    const ids = g.ids, len = ids.length ? Math.max(MIN_STEP, k * g.w) + g.extra : 0, a = t;
    ids.forEach((i, r) => { start[i] = a + (len * r) / ids.length; });
    for (const j of g.steps) for (const i of m.steps[j]) if (dir[i] < 0 && !hung.has(i)) start[i] = Math.max(0, a - PAUSE);
    if (ids.length) t = a + len + PAUSE;
  }
  const steps = m.steps.map((s): [number, number] => {
    const a = Math.max(0, Math.min(...s.map(i => start[i])));
    return [a, Math.max(a, ...s.map(i => start[i] + drop))];
  });
  const built = Math.max(0, ...Array.from(start, v => v + drop));
  return { start, dir, drop, fall, fade: flat ? FLAT_FADE : 0, steps, built, order: P.map((_, i) => i).sort((a, b) => start[a] - start[b]) };
}

/** The camera during the build, from its own angle (0) to the default view (1): a hung model is watched from the
 *  side while it goes up (from the front, its layers would hide each other), drifting a little, and faced in the last
 *  TURN seconds; round a model on a table over the whole build. */
export function buildTurn(t: number, built: number, wall: boolean): number {
  if (!wall) return easeIO(t / built);
  const turn = Math.min(TURN, built * 0.4);
  return 0.2 * clamp01(t / built) + 0.8 * easeIO((t - built + turn) / turn);
}

/** `alpha`: set (< 1) while the piece fades in */
export interface PieceState { visible: boolean; landed: boolean; off: number; speed: number; alpha?: number }

/** Piece i at time t: shown yet?, in place?, how far it still has to travel (units, along +y of the model; − from below) and its speed. */
export function pieceState(tl: SqTimeline, i: number, t: number): PieceState {
  const u = (t - tl.start[i]) / tl.drop;
  if (u <= 0) return { visible: false, landed: false, off: 0, speed: 0 };
  if (u >= 1) return { visible: true, landed: true, off: 0, speed: 0 };
  const s: PieceState = { visible: true, landed: false, off: tl.dir[i] * tl.fall * (1 - ease(u)), speed: (tl.fall * 3 * (1 - u) * (1 - u)) / tl.drop };
  if (u < tl.fade) s.alpha = easeIO(u / tl.fade);
  return s;
}
