// The riggle instruction booklet: cover, parts inventory (riggle then
// Display), one page per build step, Nameplate, Hanging (Frame), last page.
// Steps are drawn flat, with rulers: seen from above (the Mosaic's bands, every
// ribbon layer, the Frame's backing, panel, Technic rows and cap, the base), the
// Backdrop's wall from the front, course by course; the display's pieces carry
// their size. A raised ribbon (Floating, Backdrop) is built on the table, then placed
// on its supports (a page of its own). Pages are drawn on demand on a 1600×1131
// canvas (A4 landscape) for the on-page reader, and packed into an A4 PDF where
// the nameplates print at real size.
import type { jsPDF } from 'jspdf';
import { elementId } from '../core/lego';
import { COLOR_BY_ID, renderHex, TRANS_CLEAR } from '../core/palette';
import type { Kind, Piece } from '../core/parts';
import type { Curve } from './curve';
import { RIGGLE_GRID, RIGGLE_PANEL } from '../riggle/build';
import { SITE_NAME, squiggleName } from './exports';
import { STUD_CM, type Role, type SqBomLine, type SqModel } from './model';
import { drawNameplate, NAMEPLATE_MM } from './nameplate';
import { BLACK, SPECTRUM, WHITE } from './spectrum';
import type { View } from './stage';
import type { P3, Pt, Shot, Side, StepRender } from './stepRender';

/** What the booklet needs of a loaded riggle. */
export interface BookletSource {
  id: number | null; hash: string | null;
  features: Record<string, string | number>;
  origin?: 'script' | 'port' | 'image' | 'upload' | 'engine';
  /** the original picture: URL or data URL */
  original: string;
  curve?: Curve;
}
export interface BookletOptions {
  /** supersampling of the 3D views (1 on phones, 1.5 default) */
  quality?: number;
}

export const PAGE_PX: [number, number] = [1600, 1131];
export const PAGE_MM: [number, number] = [297, 210];
const [PW, PH] = PAGE_PX, MM = PW / PAGE_MM[0];
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const INK = '#1d3b5c', SUB = '#4b6378', BAND = '#E8F1F8', BOX = '#D6E8F5', BOXLINE = '#9fbfd8', VIEW = '#F1F5F8', FOOT = 90;
const NOTE = '#FFF6DC', NOTELINE = '#E8C766', NOTEINK = '#6b4e00';
/** a step's new pieces are outlined in gold, in navy on the yellowish colours (Orange, Yellow, Lime) */
export const GOLD = '#F5B800', NAVY_ON = new Set([3, 4, 34]);
type Ctx = CanvasRenderingContext2D;

// ---------- page plan (no DOM: tested in Node) ----------

export type PageKind = 'cover' | 'parts' | 'step' | 'place' | 'nameplate' | 'hanging' | 'end';
export interface PagePlan { kind: PageKind; index: number; label: string }

/** a raised ribbon (Floating, Backdrop): its pieces, its bottom (plates) and its steps, built on the table; else null */
export function raisedRibbon(m: SqModel): { ids: number[]; y: number; steps: number[] } | null {
  const P = m.pieces, ids = P.flatMap((p, i) => (p.role === 'squiggle' ? [i] : []));
  if (!ids.length || !P.some(p => p.support)) return null;
  const steps = m.steps.flatMap((s, si) => (s.every(i => P[i].role === 'squiggle') ? [si] : []));
  return { ids, y: Math.min(...ids.map(i => P[i].y)), steps };
}

export function bookletPlan(m: SqModel): PagePlan[] {
  const inv = inventoryPages(m), out: PagePlan[] = [{ kind: 'cover', index: 0, label: 'Cover' }], rr = raisedRibbon(m);
  inv.forEach((_, i) => out.push({ kind: 'parts', index: i, label: inv.length > 1 ? `Parts ${i + 1}/${inv.length}` : 'Parts' }));
  m.steps.forEach((_, i) => {
    out.push({ kind: 'step', index: i, label: `Step ${i + 1}` });
    if (rr && i === rr.steps.at(-1)) out.push({ kind: 'place', index: 0, label: 'Place ribbon' });
  });
  if (m.nameplate) out.push({ kind: 'nameplate', index: 0, label: 'Nameplate' });
  if (m.hanging) out.push({ kind: 'hanging', index: 0, label: 'Hanging' });
  out.push({ kind: 'end', index: 0, label: 'Finished' });
  return out;
}

const ORDER = [...SPECTRUM.map(s => s.id), WHITE, BLACK, TRANS_CLEAR];
const colourRank = (c: number) => { const i = ORDER.indexOf(c); return i < 0 ? ORDER.length : i; };
const KIND_RANK: Record<Kind, number> = { plate: 0, tile: 1, brick: 2, technic: 3, round: 4, slope: 5 };

/** one kind of piece and how many: a = short side, b = long side (studs), h in plates */
export interface PartCount { kind: Kind; c: number; a: number; b: number; h: number; part: string; qty: number; support: boolean }
const byLook = (p: { c: number; kind: Kind; a: number; b: number; h: number }, q: typeof p) =>
  colourRank(p.c) - colourRank(q.c) || KIND_RANK[p.kind] - KIND_RANK[q.kind] || p.h - q.h || q.b - p.b || q.a - p.a;

/** The pieces of a step, by kind, colour and size, in spectrum order. */
export function stepParts(m: SqModel, si: number): PartCount[] {
  const map = new Map<string, PartCount>();
  for (const i of m.steps[si]) {
    const p = m.pieces[i], a = Math.min(p.w, p.d), b = Math.max(p.w, p.d), k = `${p.part}|${p.c}|${p.h}`;
    const e = map.get(k) ?? { kind: p.kind, c: p.c, a, b, h: p.h, part: p.part, qty: 0, support: !!p.support };
    e.qty++; map.set(k, e);
  }
  return [...map.values()].sort(byLook);
}

/** The pieces of step `si` worth a close-up (a few small pieces, clear supports, the nameplate): the front-most one
 *  and those touching it, or the Frame's first hanging point (on the right as the back lies turned over). Null when
 *  the step's pieces show well enough. */
export function zoomFocus(m: SqModel, si: number): number[] | null {
  const P = m.pieces, ids = m.steps[si];
  if (!(ids.length <= 6 || ids.every(i => P[i].support)) || ids.some(i => P[i].w * P[i].d > 16)) return null;
  const hang = ids.filter(i => m.hanging?.points.includes(i)).sort((i, j) => P[i].x - P[j].x);
  const A = P[hang[0] ?? [...ids].sort((i, j) => P[i].z - P[j].z || P[i].x - P[j].x)[0]];
  return ids.filter(i => { const p = P[i]; return p.x <= A.x + A.w && A.x <= p.x + p.w && p.z <= A.z + A.d && A.z <= p.z + p.d; });
}

const CROSS = ', crosswise to the layer below';
/** "Slab 2 of 2 · layer 1 of 3 · plates, crosswise to the layer below · part 1 of 2": which layer of the ribbon a step
 *  lays, what with, and which of the layer's steps it is. Null: not a ribbon step. */
export function layerCaption(m: SqModel, si: number): string | null {
  const P = m.pieces, S = m.steps[si].map(i => P[i]), ys = new Set(S.map(p => p.y));
  if (m.format === 'mosaic' || !S.length || !S.every(p => p.role === 'squiggle') || ys.size > 1) return null;
  const rib = P.filter(p => p.role === 'squiggle'), y0 = Math.min(...rib.map(p => p.y)), y = S[0].y, l = y - y0;
  const slabs = Math.ceil((Math.max(...rib.map(p => p.y + p.h)) - y0) / 3), where = slabs > 1 ? `Slab ${Math.floor(l / 3) + 1} of ${slabs} · layer ${(l % 3) + 1} of 3` : `Layer ${l + 1} of 3`;
  const tiles = S.filter(p => p.kind === 'tile').length, what = !tiles ? 'plates' : tiles === S.length ? 'tiles' : 'tiles, plates under the next slab';
  // the way most pieces run, against the layer below's
  const way = (q: Piece[]) => { const a = q.filter(p => p.w > p.d).length, b = q.filter(p => p.d > p.w).length; return a > 1.5 * b ? 'x' : b > 1.5 * a ? 'z' : ''; };
  const below = way(rib.filter(p => p.y === y - 1)), mine = way(S), cross = below && mine && below !== mine ? CROSS : '';
  const same = m.steps.flatMap((s, k) => (s.length && s.every(i => P[i].role === 'squiggle' && P[i].y === y) ? [k] : []));
  return `${where} · ${what}${cross}${same.length > 1 ? ` · part ${same.indexOf(si) + 1} of ${same.length}` : ''}`;
}

/** The Backdrop's wall as seen from the front: its row (z), the white pieces there (bricks, the ties' front ends, the
 *  tile cap), its bottom and top (plates) and its courses. Null: no wall. */
export function wallFace(m: SqModel): { z: number; ids: number[]; bottom: number; top: number; courses: number } | null {
  const P = m.pieces, br = P.filter(p => p.role === 'display' && p.kind === 'brick' && p.c === WHITE);
  if (!br.length) return null;
  const z = Math.min(...br.map(p => p.z)), ids = P.flatMap((p, i) => (p.role === 'display' && p.c === WHITE && p.kind !== 'plate' && p.z === z ? [i] : []));
  const bottom = Math.min(...br.map(p => p.y));
  return { z, ids, bottom, top: Math.max(...ids.map(i => P[i].y + P[i].h)), courses: new Set(br.filter(p => p.z === z).map(p => p.y)).size };
}

/**
 * A step drawn flat: seen from above, or the Backdrop's wall from the front (`front`: z is then the height, in studs, a
 * plate 0.4, and `rows` the courses the step lays, 1 = the bottom one). The area shown (studs), where the rulers count
 * from (on the Frame's back, turned over, `flip`: mirrored, from its right edge), the rows a Mosaic band covers (1 = the
 * bottom row), whether it is the raised ribbon alone on the table, a caption (the ribbon layer, the wall's courses),
 * and `sizes`: each new piece carries its size. Null: a 3D view.
 */
export interface StepPlan {
  x0: number; z0: number; x1: number; z1: number; ox: number; oz: number; rows: [number, number] | null; sub: boolean; ruler: string;
  flip: boolean; caption: string | null; front: boolean; sizes: boolean;
}
export function stepPlan(m: SqModel, si: number): StepPlan | null {
  const P = m.pieces, S = m.steps[si].map(i => P[i]);
  const box = (q: Piece[]) => ({ x0: Math.min(...q.map(p => p.x)), z0: Math.min(...q.map(p => p.z)), x1: Math.max(...q.map(p => p.x + p.w)), z1: Math.max(...q.map(p => p.z + p.d)) });
  const plan = (b: ReturnType<typeof box>, ox: number, oz: number, ruler: string, more: Partial<StepPlan> = {}): StepPlan =>
    ({ ...b, ox, oz, rows: null, sub: false, ruler, flip: false, caption: null, front: false, sizes: false, ...more });
  if (S.some(p => p.nameplate)) return null;
  if (m.format === 'mosaic') {
    if (!S.every(p => p.kind === 'tile')) return null;
    const b = box(P);
    return plan(b, b.x0, b.z0, 'studs from the bottom left corner', { rows: [Math.min(...S.map(p => p.z)) - b.z0 + 1, Math.max(...S.map(p => p.z + p.d)) - b.z0] });
  }
  const rr = raisedRibbon(m), caption = layerCaption(m, si), wall = wallFace(m);
  if (caption) {
    if (rr) { const b = box(P.filter(p => p.role === 'squiggle')); return plan({ x0: b.x0 - 1, z0: b.z0 - 1, x1: b.x1 + 1, z1: b.z1 + 1 }, b.x0, b.z0, 'studs from the ribbon’s left and front edges', { sub: true, caption }); }
    if (m.pose !== 'wall') return null;
    const pb = box(P.filter(p => p.role === 'display' && p.kind === 'plate' && p.c === WHITE));
    return plan(box(P.filter(p => p.y >= 0)), pb.x0, pb.z0, 'studs on the white panel, from its bottom left corner', { caption });
  }
  // the Backdrop's wall, from the front: the courses this step lays
  const mine = wall ? S.filter(p => p.z === wall.z && p.kind === 'brick' && p.c === WHITE) : [];
  if (wall && mine.length) {
    const course = (p: Piece) => (p.y - wall.bottom) / 3 + 1, a = Math.min(...mine.map(course)), b = Math.max(...mine.map(course)), W = wall.ids.map(i => P[i]);
    const more = [S.some(p => p.kind === 'tile' && p.z === wall.z) ? 'white tiles on top' : '', S.some(p => p.kind === 'brick' && p.c === BLACK) ? 'two black braces behind' : ''].filter(Boolean);
    return plan({ x0: Math.min(...W.map(p => p.x)), z0: 0, x1: Math.max(...W.map(p => p.x + p.w)), z1: wall.top * 0.4 + 1 }, Math.min(...W.map(p => p.x)), 0,
      'studs from the wall’s left end, courses from the bottom', { front: true, sizes: true, rows: [a, b], caption: [`Courses ${a}–${b} of ${wall.courses}`, ...more].join(' · ') });
  }
  if (rr) {
    const tiles = S.every(p => p.kind === 'tile' && p.role === 'display' && p.y === 1), base = S.every(p => p.kind === 'plate' && p.y === 0);
    if (!S.every(p => p.support) && !tiles && !base) return null;
    const b = box(P.filter(p => p.y === 0));
    return plan(b, b.x0, b.z0, 'studs from the base’s front left corner', { sizes: tiles || base });
  }
  // the Frame's back, turned over: the picture's right edge is on the left now
  if (m.hanging && S.every(p => p.y < 0)) { const b = box(P); return plan(b, b.x1, b.z0, 'studs from the corner on the left, as it lies', { flip: true }); }
  // the Frame's backing, white panel, Technic rows and cap, as it lies on the table
  if (m.pose === 'wall' && S.every(p => p.y >= 0 && p.role === 'display')) { const b = box(P.filter(p => p.y >= 0)); return plan(b, b.x0, b.z0, 'studs from the frame’s bottom left corner', { sizes: true }); }
  return null;
}

/**
 * A step's close-up in 3D: pieces `ids` (framed within `box`, x0 z0 x1 z1 studs, when set: its corner is the spot shown)
 * and `pad` studs around,
 * turned `turn`° further than the step's camera. `context`: beside a plan that says where (a column of its own), with a
 * `label` over it; `point`: a line from it to the spot it shows. A few small pieces (zoomFocus); on a ribbon layer above
 * the first, the step's pieces; on the Frame's Technic rows, a corner; on the Backdrop's lower courses, a brace from
 * behind. Null: none.
 */
export interface CloseUp {
  ids: number[]; context: boolean; label: string | null; point: boolean; pad: number; turn: number; box: [number, number, number, number] | null;
  /** over the plan, beside the spot it shows (where the plan holds nothing new: the Frame's panel), not in a column */
  inside: boolean;
  /** the pieces are hidden behind what the plan shows: their outline is dashed on it, the line goes there */
  behind: number[] | null;
}
export function closeUp(m: SqModel, si: number, plan: StepPlan | null): CloseUp | null {
  const f = zoomFocus(m, si), P = m.pieces, ids = m.steps[si], S = ids.map(i => P[i]);
  const cu = (o: Partial<CloseUp> & { ids: number[] }): CloseUp => ({ context: true, label: null, point: true, pad: 1, turn: 0, box: null, inside: false, behind: null, ...o });
  if (f) { const technic = f.some(i => P[i].kind === 'technic'); return cu({ ids: f, context: false, pad: technic ? 2 : 2.5, turn: technic ? -32 : 0 }); }
  if (!plan) return null;
  if (S.every(p => p.role === 'squiggle')) {
    const low = Math.min(...P.filter(p => p.role === 'squiggle').map(p => p.y));
    return plan.caption && S[0].y > low ? cu({ ids, label: 'These pieces, in 3D', point: false }) : null;
  }
  if (m.pose === 'wall' && !plan.flip && S.every(p => p.kind === 'technic')) {
    const n = 5, near = ids.filter(i => P[i].x < plan.x0 + n && P[i].z < plan.z0 + n);
    return cu({ ids: near, label: 'A corner, in 3D', box: [plan.x0, plan.z0, plan.x0 + n, plan.z0 + n], turn: -30, inside: true });
  }
  const br = ids.filter(i => P[i].kind === 'brick' && P[i].c === BLACK);
  if (plan.front && br.length) {
    const bx = Math.min(...br.map(i => P[i].x)), one = ids.filter(i => P[i].x < bx + 4 && P[i].x + P[i].w > bx && (P[i].c === BLACK || P[i].d > 1));
    return cu({ ids: one, label: 'A brace, from behind', pad: 1.5, behind: one.filter(i => P[i].c === BLACK) });
  }
  return null;
}

/** A step's note: the model's, else one the booklet adds where the drawing needs words (the Frame's panel and rows). */
export function stepNote(m: SqModel, si: number): string | undefined {
  if (m.stepNotes[si]) return m.stepNotes[si];
  const P = m.pieces, S = m.steps[si].map(i => P[i]);
  if (m.format === 'mosaic' || m.pose !== 'wall' || !S.length) return undefined;
  const panel = P.filter(p => p.kind === 'plate' && p.c === WHITE && p.role === 'display'), ring = Math.min(...panel.map(p => p.x)) - Math.min(...P.map(p => p.x));
  if (S.every(p => p.kind === 'plate' && p.c === WHITE)) return `Lay the white plates ${ring} studs in from every edge, as the rulers show: the black border left around them takes the frame.`;
  if (S.every(p => p.kind === 'technic' && p.y >= 0)) return 'Two rows of black Technic bricks run all around the white panel, holes facing out. Put each brick where the plan shows it, by its length: the joints of each row are staggered against the row beside it and the plates below, which makes the frame rigid.';
  return undefined;
}

/** the inventory's layout: a row of lots is `row` px high, `line` more where a name takes two lines */
export const INV = { cols: 7, top: 196, bottom: PH - FOOT - 22, head: 62, gap: 16, row: 100, line: 20 };
export type InvRow = { head: Role; cont: boolean } | { lines: SqBomLine[] };
/** a lot's name as drawn in the inventory: on two lines, before its size, when two words come before it */
export const lotLines = (l: Pick<SqBomLine, 'kind' | 'w' | 'd' | 'h'>): string[] => {
  const name = lotName(l.kind, l.w, l.d, l.h), mt = /^(\S+ \S+) (\d+×\d+)$/.exec(name);
  return mt ? [mt[1], mt[2]] : [name];
};
export const invRowHeight = (lines: SqBomLine[]) => INV.row + (lines.some(l => lotLines(l).length > 1) ? INV.line : 0);

/** The inventory's pages: riggle then Display, each headed by its subtotal, lots in rows. */
export function inventoryPages(m: SqModel): InvRow[][] {
  const pages: InvRow[][] = [[]];
  let page = pages[0], y = INV.top;
  for (const role of ['squiggle', 'display'] as const) {
    const lines = m.bom.filter(l => l.role === role).sort((p, q) => byLook({ ...p, c: p.color, a: p.w, b: p.d }, { ...q, c: q.color, a: q.w, b: q.d }));
    for (let k = 0; k * INV.cols < lines.length; k++) {
      const gap = k === 0 && page.length ? INV.gap : 0, head = k === 0 || !page.length, row = lines.slice(k * INV.cols, (k + 1) * INV.cols), rh = invRowHeight(row);
      if (y + gap + (head ? INV.head : 0) + rh > INV.bottom) { page = []; pages.push(page); y = INV.top; }
      else y += gap;
      if (k === 0 || !page.length) { page.push({ head: role, cont: k > 0 }); y += INV.head; }
      page.push({ lines: row }); y += rh;
    }
  }
  return pages;
}

/** "Plate 2×6", "Technic brick 1×16", "Round plate 1×1" */
export function shortName(kind: Kind, a: number, b: number, h: number): string {
  if (kind === 'round') return h === 1 ? 'Round plate 1×1' : 'Round brick 1×1';
  if (kind === 'technic') return `Technic brick ${a}×${b}`;
  if (kind === 'slope') return `Curved slope ${a}×${b}`;
  return `${kind[0].toUpperCase()}${kind.slice(1)} ${a}×${b}`;
}
/** a lot's name in the inventory: the page's shopping list's for a Technic brick ("Technic Brick 1×16", the part's
 *  catalogue name without "with Holes"), else the short one */
export const lotName = (kind: Kind, a: number, b: number, h: number): string =>
  (kind === 'technic' ? `Technic Brick ${a}×${b}` : shortName(kind, a, b, h));

/** the fixing the advice names, by weight: one picture hook (under 1 kg), two picture hooks (1–3 kg, or one screw
 *  with a wall plug), two screws with wall plugs (above 3 kg) */
export type Fixing = 'hook' | 'hooks' | 'screws';
export const fixingOf = (advice: string): Fixing => (/\btwo screws\b/i.test(advice) ? 'screws' : /\btwo (picture )?hooks\b/i.test(advice) ? 'hooks' : 'hook');
/** how many hooks the Hanging page draws for the fixing advice: two when it says two hooks or two screws */
export const hooksFor = (advice: string): 1 | 2 => (fixingOf(advice) === 'hook' ? 1 : 2);

/**
 * The Hanging page's words, one instruction that the drawing shows: the model's advice (the cord through both top
 * Technic bricks, the fixing for the weight), then where each fixing goes. `alt`: two hooks, or one screw with a wall
 * plug at the cord's apex (1–3 kg). Items: [bold lead, text].
 */
export function hangingText(m: SqModel): { advice: string; fixing: Fixing; alt: boolean; items: [string, string][] } {
  const hp = m.hanging!, [a, b] = hp.points.map(i => m.pieces[i]).sort((p, q) => p.x - q.x), fixing = fixingOf(hp.advice);
  const alt = fixing === 'hooks' && /\bscrew\b/i.test(hp.advice), apex = 'in the middle, at the cord’s apex, just under the frame’s top edge. Tie the cord tight and short so it stays hidden.';
  const items: [string, string][] = fixing === 'hook' ? [['One picture hook:', apex]]
    : [[fixing === 'hooks' ? 'Two picture hooks:' : 'Two screws with wall plugs:', `one straight above each highlighted brick, about ${Math.round((b.x - a.x - a.w) * STUD_CM)} cm apart, just under the frame’s top edge. The cord pulls straight up; the ${fixing === 'hooks' ? 'hooks' : 'screws'} stay hidden.`]];
  if (alt) items.push(['Or one screw with a wall plug:', apex]);
  return { advice: hp.advice.replace(/^About [\d.]+ kg:\s*/, '').replace(/^./, c => c.toUpperCase()), fixing, alt, items };
}

/** Where the step page puts its parts box, the 3D view and the step number. */
export interface StepLayout {
  box: { x: number; y: number; w: number; h: number; cols: number; cw: number; rh: number; icon: number; font: number };
  view: { x: number; y: number; w: number; h: number };
  num: { x: number; y: number };
}
const CELLS = [{ cw: 160, rh: 92, icon: 78, font: 27 }, { cw: 132, rh: 78, icon: 62, font: 24 }, { cw: 112, rh: 66, icon: 52, font: 21 }];
export const NUM_SIZE = 104;

/**
 * The layout that shows the model biggest: the parts box down the left side under the step number, or across
 * the top next to it. `n` kinds of parts, `noteH` px of note at the bottom, `aspect` = the model's width / height.
 */
export function stepLayout(n: number, digits: number, noteH: number, aspect: number): StepLayout {
  const L = 40, R = PW - 40, T = 24, B = PH - FOOT - 20 - (noteH ? noteH + 14 : 0), numW = digits * 62;
  let best: (StepLayout & { score: number }) | null = null;
  CELLS.forEach((cell, ci) => {
    const pad = 28, pick = (s: StepLayout, extra = 0) => {
      const score = Math.min(s.view.w / aspect, s.view.h) * (1 - 0.05 * ci - extra) - (Math.min(s.view.w, s.view.h) < 200 ? 1e4 : 0);
      if (!best || score > best.score) best = { ...s, score };
    };
    for (let cols = 1; cols <= 4; cols++) {           // down the left
      const rows = Math.ceil(n / cols), w = cols * cell.cw + pad, h = rows * cell.rh + pad, y = T + NUM_SIZE + 22;
      if (y + h > B) continue;
      pick({ box: { x: L, y, w, h, cols, ...cell }, view: { x: L + Math.max(w, numW) + 24, y: T, w: R - L - Math.max(w, numW) - 24, h: B - T }, num: { x: L + 14, y: T + NUM_SIZE - 12 } });
    }
    const x = L + numW + 36, cols = Math.max(1, Math.min(n, Math.floor((R - x - pad) / cell.cw))), rows = Math.ceil(n / cols);
    const h = rows * cell.rh + pad, top = T + Math.max(h, NUM_SIZE) + 18;   // across the top
    pick({ box: { x, y: T, w: cols * cell.cw + pad, h, cols, ...cell }, view: { x: L, y: top, w: R - L, h: B - top }, num: { x: L + 14, y: T + NUM_SIZE - 12 } }, 0.02);
  });
  return best!;
}

/** Nameplate page: top-left corners of the real-size copies and the 50 mm scale bar, in mm on the page. */
export const PRINT = { slots: [[24, 121], [88, 121], [24, 150], [88, 150]] as Pt[], bar: [24, 181] as Pt, gap: 2, mark: 3.5, bleed: 1 };

// ---------- drawing helpers ----------

const blank = (bg = '#ffffff'): [HTMLCanvasElement, Ctx] => {
  const c = document.createElement('canvas'); c.width = PW; c.height = PH;
  const x = c.getContext('2d')!; x.fillStyle = bg; x.fillRect(0, 0, PW, PH);
  return [c, x];
};
const font = (x: Ctx, size: number, weight = 400) => { x.font = `${weight} ${size}px ${FONT}`; };
function wrap(x: Ctx, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (line && x.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
/** words, bold or not, wrapped to maxW at `size` px: each line's words and where they start */
function wrapRich(x: Ctx, words: { t: string; b: boolean }[], maxW: number, size: number): { t: string; b: boolean; dx: number }[][] {
  const len = (t: string, b: boolean) => { font(x, size, b ? 700 : 400); return x.measureText(t).width; };
  const out: { t: string; b: boolean; dx: number }[][] = [[]];
  let at = 0;
  for (const w of words) {
    const wide = len(w.t, w.b);
    if (at && at + len(' ', false) + wide > maxW) { out.push([]); at = 0; } else if (at) at += len(' ', false);
    out.at(-1)!.push({ ...w, dx: at }); at += wide;
  }
  return out;
}
/** text shrunk (down to 60 %) to fit maxW */
function fitText(x: Ctx, text: string, X: number, Y: number, maxW: number, size: number, weight = 400) {
  font(x, size, weight);
  const w = x.measureText(text).width;
  if (w > maxW) font(x, Math.max(size * 0.6, (size * maxW) / w), weight);
  x.fillText(text, X, Y);
}
function footer(x: Ctx, n: number, title: string) {
  x.fillStyle = BAND; x.fillRect(0, PH - FOOT, PW, FOOT);
  x.fillStyle = INK; font(x, 26, 700); x.textAlign = 'left'; x.fillText(title, 60, PH - 36);
  x.textAlign = 'right'; x.fillText(String(n), PW - 60, PH - 36);
  font(x, 20); x.fillStyle = SUB; x.fillText(SITE_NAME, PW - 120, PH - 37); x.textAlign = 'left';
}
/** the finished model's render, its background colour, and how far its top and bottom edges may fade (px) */
interface Hero { img: HTMLCanvasElement; bg: string; fade: number }
/** a render drawn across the page at y, its top and bottom edges faded into the page: a soft shadow that reaches an
 *  edge ends there without a line */
function drawHero(x: Ctx, { img, bg, fade }: Hero, y: number) {
  x.drawImage(img, 0, y);
  if (fade < 4) return;
  const a = (t: number) => bg.replace(/^rgb\((.*)\)$/, `rgba($1,${t})`), H = img.height;
  for (const [from, to] of [[y, y + fade], [y + H, y + H - fade]]) {
    const g = x.createLinearGradient(0, from, 0, to);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) g.addColorStop(t, a(1 - t * t * (3 - 2 * t)));
    x.fillStyle = g; x.fillRect(0, Math.min(from, to), img.width, fade);
  }
}
const kg = (g: number) => (g >= 995 ? `${(g / 1000).toFixed(1)} kg` : `${Math.round(g / 10) * 10} g`);
const cm = (v: number) => (Math.round(v * 10) / 10).toLocaleString('en');
function sizeText(m: SqModel) {
  const [a, b, c] = m.dims;
  return m.pose === 'wall' ? `${cm(a)} × ${cm(c)} cm, ${cm(b)} cm deep` : `${cm(a)} × ${cm(b)} cm, ${cm(c)} cm high`;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
/** "Frame · Large · 64 × 32 studs" (the white panel), "Floating · Large · 48 × 40 studs" (the base), "Mosaic · 96 × 48 studs" */
export function modelTitle(m: SqModel): string {
  // The panel comes off the model that was actually built. A copy of the
  // constants here went stale the moment the panels were recut for riggles,
  // and every booklet cover then claimed a size the model did not have.
  const p = m.panel;
  if (m.format === 'mosaic') return `Mosaic · ${p ? `${p.w} × ${p.h}` : `${RIGGLE_GRID[m.scale][0]} × ${RIGGLE_GRID[m.scale][1]}`} studs`;
  const d = m.display ?? 'frame', size = m.scale === 'large' ? 'Large' : 'Small';
  if (d === 'frame') return `Frame · ${size} · ${p ? `${p.w} × ${p.h}` : `${RIGGLE_PANEL[m.scale].w} × ${RIGGLE_PANEL[m.scale].h}`} studs`;
  const base = m.pieces.filter(p => p.y === 0), ext = (a: 'x' | 'z', b: 'w' | 'd') => Math.max(...base.map(p => p[a] + p[b])) - Math.min(...base.map(p => p[a]));
  return `${cap(d)} · ${size} · ${ext('x', 'w')} × ${ext('z', 'd')} studs`;
}

// ---------- isometric part icons ----------

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16), k = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${k(n >> 16)},${k((n >> 8) & 255)},${k(n & 255)})`;
}

/**
 * A piece drawn isometric, fitting maxW × maxH and centred on (cx, cy): long side b to the lower right, short
 * side a to the lower left. Studs on top (not on tiles), pin holes on a Technic brick's long side, round pieces
 * as cylinders, Trans-Clear as pale glass.
 */
export function partIcon(x: Ctx, cx: number, cy: number, kind: Kind, a: number, b: number, h: number, c: number, maxW: number, maxH = maxW) {
  const c30 = Math.cos(Math.PI / 6), w = b, d = a, hh = kind === 'slope' ? 0.8 : h * 0.4;
  const s = Math.min(24, maxW / ((w + d) * c30), maxH / ((w + d) * 0.5 + hh));
  const X = cx - ((w + d) * c30 * s) / 2 + d * c30 * s, Y = cy - (((w + d) * 0.5 + hh) * s) / 2 + hh * s;
  const P = (u: number, y: number, z: number): Pt => [X + (u - z) * c30 * s, Y + (u + z) * 0.5 * s - y * s];
  const clear = c === TRANS_CLEAR || !!COLOR_BY_ID.get(c)?.trans, hex = clear ? '#cfe2ee' : renderHex(c);
  const n = parseInt(hex.slice(1), 16), dark = 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255) < 0x38, top = dark ? 2.4 : 1.12, left = dark ? 1.6 : 0.9, right = dark ? 1.2 : 0.72;
  const edge = clear ? 'rgba(40,80,105,.55)' : 'rgba(0,0,0,.38)';
  x.save();
  x.lineJoin = 'round';
  if (clear) x.globalAlpha = 0.92;
  const poly = (pts: Pt[], fill: string) => {
    x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(...p) : x.moveTo(...p))); x.closePath();
    x.fillStyle = fill; x.fill(); x.strokeStyle = edge; x.lineWidth = 1; x.stroke();
  };
  const R2 = Math.SQRT2;
  const stud = (u: number, z: number, y: number) => {
    const [px, py] = P(u, y, z), rx = 0.3 * s * c30 * R2, ry = 0.3 * s * 0.5 * R2, sh = 0.17 * s;
    if (s < 3) return;
    x.fillStyle = shade(hex, right); x.beginPath(); x.ellipse(px, py - sh, rx, ry, 0, 0, Math.PI * 2); x.rect(px - rx, py - sh, rx * 2, sh); x.fill();
    x.beginPath(); x.ellipse(px, py, rx, ry, 0, 0, Math.PI); x.fill();
    x.fillStyle = shade(hex, top * 1.06); x.beginPath(); x.ellipse(px, py - sh, rx, ry, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = edge; x.lineWidth = s < 6 ? 0.6 : 1; x.stroke();
  };
  if (kind === 'round') {
    const [px, py] = P(0.5, 0, 0.5), [, ty] = P(0.5, hh, 0.5), rx = 0.49 * s * c30 * R2, ry = 0.49 * s * 0.5 * R2;
    const g = x.createLinearGradient(px - rx, 0, px + rx, 0);
    g.addColorStop(0, shade(hex, left)); g.addColorStop(0.55, shade(hex, dark ? 1.7 : 0.95)); g.addColorStop(1, shade(hex, right));
    x.beginPath(); x.moveTo(px - rx, ty); x.lineTo(px - rx, py); x.ellipse(px, py, rx, ry, 0, Math.PI, 0, true); x.lineTo(px + rx, ty); x.closePath();
    x.fillStyle = g; x.fill(); x.strokeStyle = edge; x.lineWidth = 1; x.stroke();
    x.beginPath(); x.ellipse(px, ty, rx, ry, 0, 0, Math.PI * 2); x.fillStyle = shade(hex, top); x.fill(); x.stroke();
    stud(0.5, 0.5, hh);
    x.restore();
    return;
  }
  if (kind === 'slope') {
    poly([P(0, 0, d), P(w, 0, d), P(w, 0.1, d), P(0, hh, d)], shade(hex, left));
    poly([P(w, 0, 0), P(w, 0, d), P(w, 0.1, d), P(w, 0.1, 0)], shade(hex, right));
    poly([P(0, hh, 0), P(0, hh, d), P(w, 0.1, d), P(w, 0.1, 0)], shade(hex, top));
    x.restore();
    return;
  }
  poly([P(0, hh, 0), P(w, hh, 0), P(w, hh, d), P(0, hh, d)], shade(hex, top));
  poly([P(0, 0, d), P(w, 0, d), P(w, hh, d), P(0, hh, d)], shade(hex, left));
  poly([P(w, 0, 0), P(w, 0, d), P(w, hh, d), P(w, hh, 0)], shade(hex, right));
  if (kind === 'technic') for (let i = 1; i < w; i++) {
    // pin hole on the long face: a rim and a dark hole, drawn in the face's plane
    const [hx, hy] = P(i, hh * 0.6, d);
    x.save(); x.transform(c30 * s, 0.5 * s, 0, -s, hx, hy);
    x.beginPath(); x.arc(0, 0, 0.36, 0, Math.PI * 2); x.fillStyle = shade(hex, dark ? 2.2 : 1.05); x.fill();
    x.beginPath(); x.arc(0, 0, 0.26, 0, Math.PI * 2); x.fillStyle = '#0b0b0b'; x.fill();
    x.restore();
  }
  if (kind !== 'tile') for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) stud(i + 0.5, j + 0.5, hh);
  x.restore();
}

// ---------- close-up insets ----------

interface Rect { x: number; y: number; w: number; h: number }
/** where a round inset of radius r covers least of the model in a view, clear of `f` (the spot it shows) and of
 *  the `avoid` points (page coordinates) */
function insetSpot(img: HTMLCanvasElement, v: Rect, f: Pt, r: number, avoid: Pt[] = []): Pt {
  const d = img.getContext('2d')!.getImageData(0, 0, img.width, img.height).data, m = 22;
  let best: Pt = [v.x + r + m, v.y + r + m], bestScore = Infinity;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 2; j++) {
    const cx = r + m + ((v.w - 2 * r - 2 * m) * i) / 4, cy = r + m + ((v.h - 2 * r - 2 * m) * j) / 2;
    let hit = 0;
    for (let y = cy - r; y < cy + r; y += 6) for (let X = cx - r; X < cx + r; X += 6)
      if ((X - cx) ** 2 + (y - cy) ** 2 <= r * r && d[(Math.round(y) * img.width + Math.round(X)) * 4 + 3] > 150) hit++;
    const at: Pt = [cx + v.x, cy + v.y], dist = Math.hypot(f[0] - at[0], f[1] - at[1]);
    const score = hit + (dist < r + 50 ? 1e6 : 0) + avoid.filter(p => Math.hypot(p[0] - at[0], p[1] - at[1]) < r + 24).length * 1e5 + dist * 0.3;
    if (score < bestScore) { bestScore = score; best = at; }
  }
  return best;
}
/** a round close-up at c, a ring on `f` (the spot it shows; none when not `ring`) and a line between them; `over` draws
 *  on the close-up */
function drawInset(x: Ctx, img: HTMLCanvasElement, c: Pt, r: number, f: Pt | null, over?: (x: Ctx) => void, withRing = true) {
  x.save();
  x.strokeStyle = INK; x.lineWidth = 3;
  if (f) {
    const a = Math.atan2(f[1] - c[1], f[0] - c[0]), ring = withRing ? 18 : 0;
    x.beginPath(); x.moveTo(c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)); x.lineTo(f[0] - ring * Math.cos(a), f[1] - ring * Math.sin(a)); x.stroke();
    if (ring) { x.beginPath(); x.arc(f[0], f[1], ring, 0, Math.PI * 2); x.stroke(); }
  }
  x.save(); x.shadowColor = 'rgba(20,35,50,.3)'; x.shadowBlur = 20; x.shadowOffsetY = 6;
  x.fillStyle = '#fff'; x.beginPath(); x.arc(c[0], c[1], r, 0, Math.PI * 2); x.fill(); x.restore();
  x.save(); x.beginPath(); x.arc(c[0], c[1], r, 0, Math.PI * 2); x.clip();
  x.fillStyle = VIEW; x.fillRect(c[0] - r, c[1] - r, 2 * r, 2 * r);
  x.drawImage(img, c[0] - r, c[1] - r, 2 * r, 2 * r);
  if (over) { x.translate(c[0] - r, c[1] - r); over(x); }
  x.restore();
  x.lineWidth = 5; x.beginPath(); x.arc(c[0], c[1], r, 0, Math.PI * 2); x.stroke();
  x.restore();
}
const centre = (m: SqModel, ids: number[]): [number, number, number] => {
  const P = ids.map(i => m.pieces[i]), mid = (a: number[], b: number[]) => (Math.min(...a) + Math.max(...b)) / 2;
  return [mid(P.map(p => p.x), P.map(p => p.x + p.w)), mid(P.map(p => p.y), P.map(p => p.y + p.h)), mid(P.map(p => p.z), P.map(p => p.z + p.d))];
};

// ---------- plans, view tags, notes ----------

/** an earlier piece's colour: duller and closer to a mid grey, so black stays dark and a colour stays itself */
export function ghost(hex: string): string {
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255], l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const t = 0.38 - 0.18 * (l / 255), g = [0x9a, 0xa4, 0xad];
  return '#' + c.map((v, i) => Math.round((v + (l - v) * 0.45) * (1 - t) + g[i] * t).toString(16).padStart(2, '0')).join('');
}
/** a colour mixed `t` of the way to white */
export const tint = (hex: string, t: number) => {
  const n = parseInt(hex.slice(1), 16), f = (v: number) => Math.round(v + (255 - v) * t);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};
const luma = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255); };

/** room around a plan in its view: the tag strip above, the rulers left and below, the band bracket right */
export const PLAN = { left: 58, right: 34, top: 76, bottom: 46 };
export const planAspect = (p: StepPlan) => (p.x1 - p.x0 + 6) / (p.z1 - p.z0 + 8);
/** the plan's scale (px per stud) and where its area's top-left corner goes in a w × h view */
export function planFit(p: StepPlan, w: number, h: number) {
  const W = p.x1 - p.x0, D = p.z1 - p.z0, s = Math.min((w - PLAN.left - PLAN.right) / W, (h - PLAN.top - PLAN.bottom) / D);
  return { s, left: PLAN.left + (w - PLAN.left - PLAN.right - W * s) / 2, top: PLAN.top + (h - PLAN.top - PLAN.bottom - D * s) / 2 };
}

/** a step view's close-up: its radius, and on a plan the column kept for it on the right, the plan shrunk to no less
 *  than 72 % or 14 px a stud (0: it goes over the view). A `context` close-up (a ribbon layer in 3D) shrinks the plan
 *  less, to 86 %, and is left out (r 0) when that leaves no room. One `inside` the plan takes no room. */
export function insetRoom(p: StepPlan | null, w: number, h: number, context = false, inside = false): { r: number; side: number } {
  const over = { r: Math.round(Math.min(215, 0.27 * Math.min(w, h))), side: 0 };
  if (inside) return { r: Math.round(Math.min(180, 0.25 * Math.min(w, h))), side: 0 };
  if (!p) return over;
  const s0 = planFit(p, w, h).s, s = Math.min(s0, Math.max((context ? 0.86 : 0.72) * s0, 14)), left = w - PLAN.left - PLAN.right - (p.x1 - p.x0) * s;
  const r = Math.floor(Math.min(context ? 170 : 190, 0.25 * Math.min(w, h), (left - 36) / 2));
  return r >= (context ? 100 : 110) ? { r, side: 2 * r + 36 } : context ? { r: 0, side: 0 } : over;
}

/**
 * The pieces shown, seen from above, in a w × h view: those placed before muted, the step's own in colour with an
 * outline, a faint stud grid with a firmer line every 4 studs from the rulers' zero, rulers numbered every 4 studs
 * along the bottom and left, a Mosaic band's rows bracketed on the right. Turned over (`flip`): mirrored, the pieces
 * nearest the table under the others, no studs. Returns where a point (x, z studs) lands.
 */
function drawPlan(x: Ctx, m: SqModel, p: StepPlan, state: (i: number) => number, w: number, h: number): (px: number, pz: number) => Pt {
  const P = m.pieces, W = p.x1 - p.x0, D = p.z1 - p.z0, { s, left, top } = planFit(p, w, h), dir = p.flip ? -1 : 1;
  const X = (v: number) => left + (p.flip ? p.x1 - v : v - p.x0) * s, Y = (v: number) => top + (p.z1 - v) * s;
  const ids = P.map((_, i) => i).filter(i => state(i)).sort((i, j) => (p.flip ? P[j].y - P[i].y : P[i].y + P[i].h - P[j].y - P[j].h));
  const box = (q: Piece, e: number): [number, number, number, number] => [Math.min(X(q.x), X(q.x + q.w)) + e, Y(q.z + q.d) + e, q.w * s - 2 * e, q.d * s - 2 * e];
  x.save();
  x.fillStyle = '#fbfcfd'; x.fillRect(left, top, W * s, D * s);
  x.save(); x.beginPath(); x.rect(left, top, W * s, D * s); x.clip();
  const draw = (i: number) => {
    const q = P[i], clear = q.c === TRANS_CLEAR || !!COLOR_BY_ID.get(q.c)?.trans;
    const hex = clear ? '#d3e7f3' : state(i) === 2 ? renderHex(q.c) : ghost(renderHex(q.c)), dark = luma(hex) < 0x70;
    if (q.kind === 'round') {
      x.beginPath(); x.arc(X(q.x + 0.5), Y(q.z + 0.5), 0.44 * s, 0, Math.PI * 2);
      x.fillStyle = hex; x.fill(); x.strokeStyle = 'rgba(40,80,105,.65)'; x.lineWidth = 1.3; x.stroke();
      return;
    }
    x.fillStyle = hex; x.fillRect(...box(q, 0));
    if (q.kind !== 'tile' && q.kind !== 'slope' && s >= 5 && !p.flip) {
      x.fillStyle = dark ? tint(hex, 0.14) : shade(hex, 1.04); x.strokeStyle = dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.2)'; x.lineWidth = 1;
      for (let a = 0; a < q.w; a++) for (let b = 0; b < q.d; b++) { x.beginPath(); x.arc(X(q.x + a + 0.5), Y(q.z + b + 0.5), 0.29 * s, 0, Math.PI * 2); x.fill(); x.stroke(); }
    }
    x.strokeStyle = dark ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.3)'; x.lineWidth = 1; x.strokeRect(...box(q, 0.5));
  };
  ids.filter(i => state(i) === 1).forEach(draw);
  for (const [n, a] of [[1, 0.09], [4, 0.36]] as const) {
    x.strokeStyle = `rgba(80,115,150,${a})`; x.lineWidth = n === 4 ? 1.5 : 1; x.beginPath();
    for (let v = Math.ceil(p.x0); v <= p.x1; v++) if (!((v - p.ox) % n)) { x.moveTo(X(v), Y(p.z0)); x.lineTo(X(v), Y(p.z1)); }
    for (let v = Math.ceil(p.z0); v <= p.z1; v++) if (!((v - p.oz) % n)) { x.moveTo(X(p.x0), Y(v)); x.lineTo(X(p.x1), Y(v)); }
    x.stroke();
  }
  const full = ids.filter(i => state(i) === 2);
  full.forEach(draw);
  x.lineWidth = Math.max(1.6, Math.min(2.6, s / 7.5));
  if (p.sizes && !p.flip) for (const i of full) sizeTag(x, P[i], box(P[i], 0));
  for (const i of full) {
    const q = P[i], e = x.lineWidth / 2 + 0.5;
    x.strokeStyle = NAVY_ON.has(q.c) ? INK : GOLD; x.beginPath();
    if (q.kind === 'round') x.arc(X(q.x + 0.5), Y(q.z + 0.5), 0.44 * s + e, 0, Math.PI * 2); else x.rect(...box(q, e));
    x.stroke();
  }
  x.restore();
  // rulers: a tick every stud (when they are far enough apart), a number every 4; mirrored, they count from the right edge
  const by = Y(p.z0) + 7, lx = left - 7, every = s >= 5 ? 1 : 4, inX = (v: number) => (p.ox + dir * v - p.x0) * (p.x1 - p.ox - dir * v) >= -1e-9;
  x.strokeStyle = SUB; x.fillStyle = SUB; x.lineWidth = 1.5; font(x, 16, 600);
  x.beginPath(); x.moveTo(X(p.flip ? Math.min(p.x1, p.ox) : Math.max(p.x0, p.ox)), by); x.lineTo(left + W * s, by); x.moveTo(lx, Y(Math.max(p.z0, p.oz))); x.lineTo(lx, Y(p.z1));
  for (let v = 0; inX(v); v += every) { const big = v % 4 === 0; x.moveTo(X(p.ox + dir * v), by); x.lineTo(X(p.ox + dir * v), by + (big ? 11 : 5)); }
  for (let v = 0; p.oz + v <= p.z1; v += every) { const big = v % 4 === 0; x.moveTo(lx, Y(p.oz + v)); x.lineTo(lx - (big ? 11 : 5), Y(p.oz + v)); }
  x.stroke();
  x.textAlign = 'center';
  for (let v = 0; inX(v); v += 4) x.fillText(String(v), X(p.ox + dir * v), by + 29);
  x.textAlign = 'right';
  for (let v = 0; p.oz + v <= p.z1; v += 4) x.fillText(String(v), lx - 15, Y(p.oz + v) + 6);
  x.textAlign = 'left';
  if (p.rows) {
    const bx = left + W * s + 14, y0 = Y(p.oz + p.rows[1]), y1 = Y(p.oz + p.rows[0] - 1);
    x.strokeStyle = GOLD; x.lineWidth = 5; x.lineCap = 'round'; x.beginPath();
    x.moveTo(bx - 8, y0 + 2); x.lineTo(bx, y0 + 2); x.lineTo(bx, y1 - 2); x.lineTo(bx - 8, y1 - 2); x.stroke();
  }
  x.restore();
  return (px, pz) => [X(px), Y(pz)];
}

/** "1×16" on a piece drawn as the rectangle r (page px), along its long side, on a patch of its colour over the studs;
 *  just "16" on a 1×N when "1×16" does not fit; nothing when that does not fit either. `thin`: a tile seen from the
 *  front, too thin for it: the size goes just above. */
function sizeTag(x: Ctx, q: Piece, [bx, by, bw, bh]: [number, number, number, number], thin = Infinity) {
  if (q.kind === 'round' || q.nameplate) return;
  const a = Math.min(q.w, q.d), b = Math.max(q.w, q.d), up = bh > bw * 1.01, long = up ? bh : bw, short = up ? bw : bh, lw = x.lineWidth;
  const above = thin < 12, room = long - 2 * lw - 8;
  let fs = above ? 15 : Math.min(22, short * 0.78), t = `${a}×${b}`;
  x.save();
  // shrunk to fit its length, down to 9 px; a 1×N then shows its length alone
  const fit = (text: string) => { font(x, fs, 800); const w = x.measureText(text).width; return above || w <= room ? fs : Math.max(0, (fs * room) / w); };
  let f = fit(t);
  if (f < 9 && a === 1) { t = String(b); f = fit(t); }
  if (f < 9) { x.restore(); return; }
  fs = f; font(x, fs, 800);
  const tw = x.measureText(t).width, turn = up && tw > short - 2 * lw - 6;
  const hex = renderHex(q.c), dark = luma(hex) < 0x70;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  if (above) { x.fillStyle = INK; x.fillText(`${t} ${q.kind}`, bx + bw / 2, by - 12); x.restore(); return; }
  x.translate(bx + bw / 2, by + bh / 2);
  if (turn) x.rotate(-Math.PI / 2);
  const ph = Math.min(fs * 1.3, short - 2), pw = Math.min(tw + fs * 0.8, (turn ? long : up ? short : long) - 2 * lw - 4);
  x.fillStyle = hex; x.beginPath(); x.roundRect(-pw / 2, -ph / 2, pw, ph, Math.min(ph / 2, 6)); x.fill();
  x.fillStyle = dark ? '#fff' : INK; x.fillText(t, 0, fs * 0.04);
  x.restore();
}

/**
 * The Backdrop's wall seen from the front, flat: the courses built before muted, the step's own in colour with an
 * outline and their size, the studs of the top course, the wall to come dashed, the base's plate under it; courses
 * numbered up the left, studs along the bottom from the wall's left end, the step's courses bracketed on the right.
 * Returns where a point (x studs, y plates) lands.
 */
function drawFront(x: Ctx, m: SqModel, p: StepPlan, state: (i: number) => number, w: number, h: number): (px: number, py: number) => Pt {
  const P = m.pieces, wall = wallFace(m)!, W = p.x1 - p.x0, { s, left, top } = planFit(p, w, h);
  const X = (v: number) => left + (v - p.x0) * s, Y = (y: number) => top + (p.z1 - y * 0.4) * s;
  const rect = (q: Piece, e = 0): [number, number, number, number] => [X(q.x) + e, Y(q.y + q.h) + e, q.w * s - 2 * e, q.h * 0.4 * s - 2 * e];
  const shown = wall.ids.filter(i => state(i)), full = shown.filter(i => state(i) === 2), n = wall.courses, cy = (c: number) => Y(wall.bottom + 3 * c);
  x.save();
  x.fillStyle = '#fbfcfd'; x.fillRect(left, top, W * s, (p.z1 - p.z0) * s);
  // the wall to come, dashed; the base's plate it stands on
  if (shown.length < wall.ids.length) { x.strokeStyle = 'rgba(80,115,150,.5)'; x.lineWidth = 1.5; x.setLineDash([7, 6]); x.strokeRect(X(p.x0), Y(wall.top), W * s, Y(wall.bottom) - Y(wall.top)); x.setLineDash([]); }
  x.fillStyle = ghost(renderHex(BLACK)); x.fillRect(X(p.x0), Y(wall.bottom), W * s, Y(0) - Y(wall.bottom));
  const draw = (i: number) => {
    const q = P[i];
    x.fillStyle = state(i) === 2 ? renderHex(q.c) : ghost(renderHex(q.c)); x.fillRect(...rect(q));
    x.strokeStyle = 'rgba(0,0,0,.32)'; x.lineWidth = 1; x.strokeRect(...rect(q, 0.5));
  };
  shown.filter(i => state(i) === 1).forEach(draw);
  // a faint line every stud, firmer every 4 from the wall's end, and one between courses
  for (const [k, a] of [[1, 0.1], [4, 0.34]] as const) {
    x.strokeStyle = `rgba(80,115,150,${a})`; x.lineWidth = k === 4 ? 1.5 : 1; x.beginPath();
    for (let v = p.x0; v <= p.x1; v++) if (!((v - p.ox) % k)) { x.moveTo(X(v), Y(wall.top)); x.lineTo(X(v), Y(wall.bottom)); }
    if (k === 1) for (let c = 1; c < n; c++) { x.moveTo(X(p.x0), cy(c)); x.lineTo(X(p.x1), cy(c)); }
    x.stroke();
  }
  full.forEach(draw);
  // studs along the top of what is built (on the pieces nothing shown stands on)
  const on = new Set(shown.flatMap(i => { const q = P[i]; return Array.from({ length: q.w }, (_, a) => `${q.x + a},${q.y}`); }));
  for (const i of shown) {
    const q = P[i];
    if (q.kind === 'tile') continue;
    x.fillStyle = state(i) === 2 ? renderHex(q.c) : ghost(renderHex(q.c)); x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 1;
    for (let a = 0; a < q.w; a++) if (!on.has(`${q.x + a},${q.y + q.h}`)) { const r: [number, number, number, number] = [X(q.x + a + 0.2), Y(q.y + q.h) - 0.21 * s, 0.6 * s, 0.21 * s]; x.fillRect(...r); x.strokeRect(...r); }
  }
  x.lineWidth = Math.max(1.6, Math.min(2.6, s / 7.5));
  for (const i of full) sizeTag(x, P[i], rect(P[i]), P[i].h * 0.4 * s);
  x.strokeStyle = GOLD;
  for (const i of full) { const e = x.lineWidth / 2 + 0.5; x.strokeRect(...rect(P[i], e)); }
  // rulers: studs along the bottom, courses up the left
  const by = Y(0) + 7, lx = left - 7, every = s >= 5 ? 1 : 4;
  x.strokeStyle = SUB; x.fillStyle = SUB; x.lineWidth = 1.5; font(x, 16, 600);
  x.beginPath(); x.moveTo(X(p.ox), by); x.lineTo(X(p.x1), by); x.moveTo(lx, cy(0)); x.lineTo(lx, cy(n));
  for (let v = 0; p.ox + v <= p.x1; v += every) { x.moveTo(X(p.ox + v), by); x.lineTo(X(p.ox + v), by + (v % 4 ? 5 : 11)); }
  for (let c = 0; c <= n; c++) { x.moveTo(lx, cy(c)); x.lineTo(lx - 8, cy(c)); }
  x.stroke();
  x.textAlign = 'center';
  for (let v = 0; p.ox + v <= p.x1; v += 4) x.fillText(String(v), X(p.ox + v), by + 29);
  x.textAlign = 'right'; x.textBaseline = 'middle'; font(x, Math.min(16, 0.85 * 1.2 * s), 600);
  for (let c = 0; c < n; c++) x.fillText(String(c + 1), lx - 12, (cy(c) + cy(c + 1)) / 2);
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  if (p.rows) {
    const capped = full.some(i => P[i].kind === 'tile'), bx = left + W * s + 14, y0 = capped ? Y(wall.top) : cy(p.rows[1]), y1 = cy(p.rows[0] - 1);
    x.strokeStyle = GOLD; x.lineWidth = 5; x.lineCap = 'round'; x.beginPath();
    x.moveTo(bx - 8, y0 + 2); x.lineTo(bx, y0 + 2); x.lineTo(bx, y1 - 2); x.lineTo(bx - 8, y1 - 2); x.stroke();
  }
  x.restore();
  return (px, py) => [X(px), Y(py)];
}

/** a fat arrow from a to b, with a white halo */
function arrow(x: Ctx, a: Pt, b: Pt) {
  const t = Math.atan2(b[1] - a[1], b[0] - a[0]), hd = 26, e: Pt = [b[0] - hd * 0.7 * Math.cos(t), b[1] - hd * 0.7 * Math.sin(t)];
  x.save(); x.lineCap = x.lineJoin = 'round';
  for (const [col, lw] of [['#fff', 7], [INK, 0]] as const) {
    x.strokeStyle = x.fillStyle = col;
    x.lineWidth = 7 + lw; x.beginPath(); x.moveTo(...a); x.lineTo(...e); x.stroke();
    x.lineWidth = 1 + lw; x.beginPath(); x.moveTo(...b);
    for (const d of [-0.45, 0.45]) x.lineTo(b[0] - hd * Math.cos(t + d), b[1] - hd * Math.sin(t + d));
    x.closePath(); x.fill(); x.stroke();
  }
  x.restore();
}

/** a white pill centred on (cx, cy) with a few bold words, an arrow pointing up before them when `up` */
function pill(x: Ctx, text: string, cx: number, cy: number, up = false) {
  font(x, 24, 800);
  const a = up ? 28 : 0, w = x.measureText(text).width + 28 + a;
  x.save();
  x.fillStyle = '#fff'; x.strokeStyle = INK; x.lineWidth = 2.5; x.beginPath(); x.roundRect(cx - w / 2, cy - 21, w, 42, 21); x.fill(); x.stroke();
  x.fillStyle = INK; x.fillText(text, cx - w / 2 + 14 + a, cy + 8);
  if (up) {
    const ax = cx - w / 2 + 26;
    x.lineWidth = 3.5; x.lineCap = 'round'; x.beginPath(); x.moveTo(ax, cy + 12); x.lineTo(ax, cy - 4); x.stroke();
    x.beginPath(); x.moveTo(ax - 8, cy - 2); x.lineTo(ax, cy - 13); x.lineTo(ax + 8, cy - 2); x.closePath(); x.fill();
  }
  x.restore();
}
/** a pill at (tx, ty) with a line and a dot to each point of `to` */
function callout(x: Ctx, text: string, tx: number, ty: number, to: Pt[]) {
  x.save(); x.strokeStyle = x.fillStyle = INK; x.lineWidth = 2.5;
  for (const t of to) { x.beginPath(); x.moveTo(tx, ty); x.lineTo(...t); x.stroke(); x.beginPath(); x.arc(t[0], t[1], 5, 0, Math.PI * 2); x.fill(); }
  x.restore();
  pill(x, text, tx, ty);
}

type TagIcon = 'turn' | 'top' | 'table' | 'front';
/** a pill in a view's corner: an icon and a few words; returns its width */
function viewTag(x: Ctx, X0: number, Y0: number, text: string, icon: TagIcon): number {
  font(x, 22, 700);
  const w = x.measureText(text).width + 74, cx = X0 + 30, cy = Y0 + 22;
  x.save();
  x.fillStyle = '#fff'; x.strokeStyle = INK; x.lineWidth = 2.5; x.beginPath(); x.roundRect(X0, Y0, w, 44, 22); x.fill(); x.stroke();
  x.strokeStyle = x.fillStyle = INK; x.lineWidth = 2.6; x.lineCap = x.lineJoin = 'round';
  if (icon === 'turn') {
    const a0 = -Math.PI * 0.95, a1 = Math.PI * 0.55, r = 10;
    x.beginPath(); x.arc(cx, cy, r, a0, a1); x.stroke();
    const ex = cx + r * Math.cos(a1), ey = cy + r * Math.sin(a1), t = a1 + Math.PI / 2;
    x.beginPath(); x.moveTo(ex + 6 * Math.cos(t), ey + 6 * Math.sin(t)); x.lineTo(ex + 6 * Math.cos(t + 2.3), ey + 6 * Math.sin(t + 2.3)); x.lineTo(ex + 6 * Math.cos(t - 2.3), ey + 6 * Math.sin(t - 2.3)); x.closePath(); x.fill();
  } else if (icon === 'top') {
    x.strokeRect(cx - 10, cy - 4, 20, 14); x.beginPath(); x.moveTo(cx, cy - 4); x.lineTo(cx, cy + 10); x.moveTo(cx - 10, cy + 3); x.lineTo(cx + 10, cy + 3); x.stroke();
    x.beginPath(); x.moveTo(cx - 5, cy - 15); x.lineTo(cx + 5, cy - 15); x.lineTo(cx, cy - 8); x.closePath(); x.fill();
  } else if (icon === 'front') {
    // an eye over a little wall
    x.lineWidth = 2; x.strokeRect(cx - 12, cy - 1, 24, 13); x.beginPath();
    x.moveTo(cx - 12, cy + 5.5); x.lineTo(cx + 12, cy + 5.5); x.moveTo(cx - 2, cy - 1); x.lineTo(cx - 2, cy + 5.5); x.moveTo(cx + 5, cy + 5.5); x.lineTo(cx + 5, cy + 12); x.moveTo(cx - 7, cy + 5.5); x.lineTo(cx - 7, cy + 12); x.stroke();
    x.beginPath(); x.ellipse(cx, cy - 11, 8, 4.5, 0, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.arc(cx, cy - 11, 2.2, 0, Math.PI * 2); x.fill();
  } else {
    x.beginPath(); x.moveTo(cx - 13, cy + 8); x.lineTo(cx + 13, cy + 8); x.moveTo(cx - 9, cy + 8); x.lineTo(cx - 9, cy + 14); x.moveTo(cx + 9, cy + 8); x.lineTo(cx + 9, cy + 14); x.stroke();
    x.fillRect(cx - 8, cy - 4, 16, 9);
  }
  x.fillStyle = INK; x.fillText(text, X0 + 56, Y0 + 30);
  x.restore();
  return w;
}

/** the booklet says "base" for the black stand of Floating and Backdrop (a model's step notes may say "socle") */
export const visitorText = <T extends string | undefined>(t: T): T => t?.replace(/\b([Ss])ocle(s?)\b/g, (_, s: string, n: string) => `${s === 'S' ? 'B' : 'b'}ase${n}`) as T;

/** a step note's bold lead ("Hidden supports: …", "Lighting notes: …") and its text, which starts with a capital */
export function splitNote(note: string): { lead: string; body: string } {
  const mt = /^([A-Z][A-Za-z ]{2,24}):\s+/.exec(note);
  return mt ? { lead: mt[1], body: note.slice(mt[0].length).replace(/^./, c => c.toUpperCase()) } : { lead: '', body: note };
}
/** a note across the bottom of a page: the lead in bold capitals over the text */
function noteOf(x: Ctx, note: string | undefined) {
  const { lead, body } = splitNote(note ?? '');
  font(x, 25);
  const lines = note ? wrap(x, body, PW - 80 - 150) : [];
  return { lead, lines, h: note ? lines.length * 34 + (lead ? 40 : 0) + 34 : 0 };
}
function drawNote(x: Ctx, n: ReturnType<typeof noteOf>) {
  if (!n.h) return;
  const y0 = PH - FOOT - 20 - n.h;
  x.fillStyle = NOTE; x.strokeStyle = NOTELINE; x.lineWidth = 2.5;
  x.beginPath(); x.roundRect(40, y0, PW - 80, n.h, 16); x.fill(); x.stroke();
  x.fillStyle = NOTELINE; x.beginPath(); x.arc(40 + 50, y0 + n.h / 2, 24, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#fff'; font(x, 32, 800); x.textAlign = 'center'; x.fillText(n.lead ? '!' : 'i', 90, y0 + n.h / 2 + 11); x.textAlign = 'left';
  let ty = y0 + 17;
  if (n.lead) { x.fillStyle = NOTEINK; font(x, 21, 800); x.fillText(n.lead.toUpperCase(), 150, ty + 22); ty += 40; }
  x.fillStyle = '#3d3320'; font(x, 25);
  n.lines.forEach((l, i) => x.fillText(l, 150, ty + 26 + i * 34));
}

// ---------- the page maker ----------

/**
 * Draws any page of the booklet on demand (1-based): cover, parts, one page per step, nameplate, hanging
 * (Frame), finished. Used by the PDF and the on-page reader (which draws only the pages looked at).
 */
export class SqPageMaker {
  readonly total: number;
  /** number of build steps, and the page of step 1 */
  readonly steps: number;
  readonly firstStep: number;
  readonly plan: PagePlan[];
  private sr: Promise<StepRender> | null = null;
  private heroes = new Map<string, Promise<Hero>>();
  private orig: Promise<HTMLCanvasElement> | null = null;
  /** "Riggle #1234 · Frame · Large · 60 × 40 studs", in every footer */
  readonly title: string;
  private disposed = false;
  private stepOf: number[] = [];

  constructor(private m: SqModel, private src: BookletSource, private o: BookletOptions = {}) {
    this.plan = bookletPlan(m);
    this.total = this.plan.length;
    this.steps = m.steps.length;
    this.firstStep = this.plan.findIndex(p => p.kind === 'step') + 1;
    this.title = `${squiggleName(src)} · ${modelTitle(m)}`;
    m.steps.forEach((s, si) => s.forEach(i => { this.stepOf[i] = si; }));
  }

  /** "Cover", "Parts 1/2", "Step 12", "Nameplate", "Hanging", "Finished" */
  label(n: number): string { return this.plan[n - 1]?.label ?? ''; }
  kind(n: number): PageKind { return this.plan[n - 1].kind; }

  async page(n: number): Promise<HTMLCanvasElement> {
    const p = this.plan[n - 1];
    if (!p) throw new Error(`no page ${n}`);
    switch (p.kind) {
      case 'cover': return this.cover();
      case 'parts': return this.parts(p.index, n);
      case 'step': return this.step(p.index, n);
      case 'place': return this.place(n);
      case 'nameplate': return this.nameplate(n);
      case 'hanging': return this.hanging(n);
      default: return this.end(n);
    }
  }

  private renderer(): Promise<StepRender> {
    return this.sr ??= import('./stepRender').then(({ StepRender }) => new StepRender(this.m, this.o.quality ?? 1.5));
  }

  /** the finished model staged like the site's main view, w × h, its background colour (read once: the page behind it
   *  takes it) and how far its top and bottom edges may fade into the page (px) */
  private hero(which: 'cover' | 'end', w: number, h: number): Promise<Hero> {
    const k = `${which}${w}x${h}`;
    if (!this.heroes.has(k)) this.heroes.set(k, import('./stage').then(({ Stage, defaultView }) => {
      const st = new Stage(w, h), m = this.m;
      // the Mosaic's board fills the cover's wide box both ways: more room, so its shadow on the table fades out
      const view: Partial<View> = which === 'cover' ? (m.format === 'mosaic' ? { margin: 0.18 } : {}) : m.pose === 'wall' ? { az: -34, el: 8 } : m.format === 'mosaic' ? { az: -24, el: 38 } : { az: 30, el: 28 };
      const margin = view.margin ?? defaultView(m).margin;
      st.setModel(m, view);
      st.render();
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d')!;
      x.imageSmoothingQuality = 'high'; x.drawImage(st.renderer.domElement, 0, 0, w, h);
      st.dispose();
      const [r, g, b] = x.getImageData(2, 2, 1, 1).data;
      // the fit keeps the model margin·h/2 px off the top and bottom edges: fade less than that
      return { img: c, bg: `rgb(${r},${g},${b})`, fade: Math.max(0, Math.floor((margin * h) / 2) - 8) };
    }));
    return this.heroes.get(k)!;
  }

  /** the riggle as a canvas (the picture, else redrawn from the curve) */
  private original(): Promise<HTMLCanvasElement> {
    return this.orig ??= new Promise<HTMLImageElement | null>(ok => {
      if (!this.src.original) return ok(null);
      const img = new Image(), t = setTimeout(() => ok(null), 8000);
      if (!this.src.original.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.onload = () => { clearTimeout(t); ok(img); };
      img.onerror = () => { clearTimeout(t); ok(null); };
      img.src = this.src.original;
    }).then(img => {
      const c = document.createElement('canvas'), x = c.getContext('2d')!;
      if (img) {
        c.width = img.naturalWidth; c.height = img.naturalHeight; x.drawImage(img, 0, 0);
        try { x.getImageData(0, 0, 1, 1); return c; } catch { /* tainted: redraw */ }
      }
      c.width = 900; c.height = 600; x.fillStyle = '#ffffff'; x.fillRect(0, 0, 900, 600);
      const cv = this.src.curve;
      if (cv) {
        const k = 900 / cv.canvas.w;
        for (const p of cv.points) { x.fillStyle = `hsl(${p.hue} 90% 52%)`; x.beginPath(); x.arc(p.x * k, p.y * k, (cv.stroke * k) / 2, 0, Math.PI * 2); x.fill(); }
      }
      return c;
    });
  }

  private async cover(): Promise<HTMLCanvasElement> {
    const { m, src } = this, [hero, orig] = await Promise.all([this.hero('cover', PW, 640), this.original()]);
    const [pg, x] = blank(hero.bg);
    drawHero(x, hero, 158);
    x.fillStyle = INK; font(x, 22, 700); x.fillText(`${SITE_NAME.toUpperCase()} · BUILDING INSTRUCTIONS`, 64, 62);
    font(x, 70, 800); x.fillText(squiggleName(src), 60, 138);
    font(x, 30); x.fillStyle = SUB; x.textAlign = 'right';
    x.fillText(m.format === 'mosaic' ? modelTitle(m) : `Relief · ${modelTitle(m)}`, PW - 64, 136); x.textAlign = 'left';
    // the original, framed like a print
    const k = Math.min(330 / orig.width, 230 / orig.height), ow = Math.round(orig.width * k), oh = Math.round(orig.height * k), ox = 64, oy = PH - 58 - oh;
    x.save(); x.shadowColor = 'rgba(20,35,50,.25)'; x.shadowBlur = 18; x.shadowOffsetY = 6;
    x.fillStyle = '#fff'; x.fillRect(ox - 10, oy - 10, ow + 20, oh + 20); x.restore();
    x.drawImage(orig, ox, oy, ow, oh);
    x.fillStyle = SUB; font(x, 19, 600); x.fillText('THE RIGGLE · ONCHAIN', ox - 8, oy - 24);
    // key figures
    const figs: [string, string][] = [
      [m.pieces.length.toLocaleString('en'), `pieces (riggle ${m.subtotals.squiggle.pieces} · display ${m.subtotals.display.pieces})`],
      [sizeText(m).split(',')[0], sizeText(m).split(', ')[1]],
      [kg(m.grams), 'estimated weight'],
      [`≈ €${Math.round(m.cost)}`, 'order of magnitude, Pick a Brick prices'],
      [String(m.steps.length), 'build steps'],
    ];
    // three columns as wide as their text, spread over the space right of the original
    const wide = (i: number) => { font(x, 44, 800); const a = x.measureText(figs[i][0]).width; font(x, 20); return Math.max(a, x.measureText(figs[i][1]).width); };
    const cols = [0, 1, 2].map(c => Math.max(...[c, c + 3].filter(i => i < figs.length).map(wide)));
    const fx0 = ox + ow + 64, gap = Math.max(24, (PW - 64 - fx0 - cols[0] - cols[1] - cols[2]) / 2);
    figs.forEach(([v, l], i) => {
      const c = i % 3, X = fx0 + cols.slice(0, c).reduce((a, w) => a + w + gap, 0), Y = oy + 42 + Math.floor(i / 3) * 112;
      x.fillStyle = INK; fitText(x, v, X, Y, cols[c] + gap / 2, 44, 800);
      x.fillStyle = SUB; fitText(x, l, X, Y + 34, cols[c] + gap / 2, 20);
    });
    font(x, 16); x.fillStyle = SUB; x.textAlign = 'right';
    x.fillText('Not affiliated with the LEGO Group or BrickLink · computer-checked, not physically built · personal use only', PW - 64, PH - 24);
    x.textAlign = 'left';
    return pg;
  }

  private parts(pi: number, n: number): HTMLCanvasElement {
    const { m } = this, pages = inventoryPages(m), rows = pages[pi], [pg, x] = blank();
    x.fillStyle = INK; font(x, 52, 800); x.fillText('Parts inventory' + (pages.length > 1 ? ` (${pi + 1}/${pages.length})` : ''), 60, 92);
    x.fillStyle = SUB; font(x, 23);
    x.fillText(`${m.pieces.length.toLocaleString('en')} pieces · ${m.bom.length} lots · ${kg(m.grams)} · ${sizeText(m)} · cost ≈ €${Math.round(m.cost)}, an order-of-magnitude estimate of LEGO Pick a Brick prices`, 60, 132);
    font(x, 18); x.fillText(`Under each part: BrickLink part number / LEGO Element ID.${m.pieces.some(p => p.support) ? ' Clear pieces are the hidden supports.' : ''}`, 60, 162);
    const cw = (PW - 120) / INV.cols;
    let y = INV.top;
    rows.forEach((r, k) => {
      if ('head' in r) {
        if (k) y += INV.gap;
        const s = m.subtotals[r.head];
        x.fillStyle = BAND; x.beginPath(); x.roundRect(52, y, PW - 104, INV.head - 12, 12); x.fill();
        x.fillStyle = INK; font(x, 27, 800); x.fillText(r.head === 'squiggle' ? 'Squiggle' : 'Display', 72, y + 34);
        const lead = x.measureText(r.head === 'squiggle' ? 'Squiggle' : 'Display').width;
        const what = r.head === 'squiggle' ? (m.format === 'mosaic' ? 'the coloured tiles' : 'the ribbon of colour')
          : m.format === 'mosaic' ? 'the black base and background' : m.display === 'frame' ? 'the frame, panel, nameplate and hanging bricks'
          : `the base, supports${m.display === 'backdrop' ? ', wall' : ''} and nameplate`;
        font(x, 21); x.fillStyle = SUB;
        x.fillText(`${r.cont ? '(continued) · ' : ''}${s.pieces} pieces · ${s.lots} lots · ${kg(s.grams)} · ≈ €${s.cost} · ${what}`, 88 + lead, y + 33);
        y += INV.head;
        return;
      }
      r.lines.forEach((l, i) => {
        const X0 = 60 + i * cw, Y0 = y, name = lotLines(l), dy = (name.length - 1) * INV.line;
        partIcon(x, X0 + 44, Y0 + 44, l.kind, l.w, l.d, l.h, l.color, 80, 70);
        const tx = X0 + 94, tw = cw - 100;
        x.fillStyle = '#111'; fitText(x, `${l.qty}x`, tx, Y0 + 24, tw, 25, 800);
        x.fillStyle = '#222'; name.forEach((t, j) => fitText(x, t, tx, Y0 + 47 + j * INV.line, tw, 17, 600));
        x.fillStyle = SUB; fitText(x, l.colorName, tx, Y0 + 68 + dy, tw, 16);
        x.fillStyle = '#7890a4'; fitText(x, `${l.part} / ${elementId(l.part, l.color) ?? '—'}`, tx, Y0 + 88 + dy, tw, 14);
      });
      y += invRowHeight(r.lines);
    });
    footer(x, n, this.title);
    return pg;
  }

  private async step(si: number, n: number): Promise<HTMLCanvasElement> {
    const { m } = this, items = stepParts(m, si), plan = stepPlan(m, si), cu = closeUp(m, si, plan);
    const sr = plan && !cu ? null : await this.renderer(), [pg, x] = blank(), note = noteOf(x, visitorText(stepNote(m, si)));
    // (a plan with a close-up keeps a column for it on its right: about half the view's height)
    const L = stepLayout(items.length, String(si + 1).length, note.h, plan ? planAspect(plan) + (cu && !cu.inside ? 0.5 : 0) : sr!.aspect(si)), v = L.view;
    // the view on a pale panel: a plan seen from above, or the 3D view
    let img: HTMLCanvasElement, at: (ids: number[]) => Pt, onPlan: ((px: number, pz: number) => Pt) | null = null;
    const room = cu ? insetRoom(plan, v.w, v.h, cu.context, cu.inside) : { r: 0, side: 0 };
    if (plan) {
      img = document.createElement('canvas'); img.width = v.w; img.height = v.h;
      const P = m.pieces, st = (i: number) => (plan.sub && P[i].role !== 'squiggle' ? 0 : this.stepOf[i] < si ? 1 : this.stepOf[i] === si ? 2 : 0);
      const pr = (plan.front ? drawFront : drawPlan)(img.getContext('2d')!, m, plan, st, v.w - room.side, v.h);
      onPlan = (px, pz) => { const [a, b] = pr(px, pz); return [a + v.x, b + v.y]; };
      at = ids => { const [cx, cy, cz] = centre(m, ids); return onPlan!(cx, plan.front ? cy : cz); };
    } else {
      const shot = sr!.step(si, v.w, v.h), dy = sr!.sub(si) ? -sr!.lift : 0;
      img = shot.canvas;
      at = ids => { const [cx, cy, cz] = centre(m, ids), [a, b] = shot.project(cx, cy + dy, cz); return [a + v.x, b + v.y]; };
    }
    x.fillStyle = VIEW; x.beginPath(); x.roundRect(v.x, v.y, v.w, v.h, 18); x.fill();
    x.drawImage(img, v.x, v.y);
    if (plan?.flip && onPlan) this.backLabels(x, plan, onPlan);
    // a close-up: a few small pieces, or in 3D beside the plan what it cannot show (a ribbon layer, a corner, a brace)
    if (cu && room.r) {
      const { r, side } = room, technic = cu.ids.some(i => m.pieces[i].kind === 'technic');
      let f = !cu.point ? null : cu.box && onPlan ? onPlan(cu.box[0] + 1, cu.box[1] + 1) : at(cu.ids);
      if (cu.behind && onPlan) {
        // hidden pieces, dashed where they stand behind the wall, the line to the middle of their top edge
        const Q = cu.behind.map(i => m.pieces[i]), [ax, ay] = onPlan(Math.min(...Q.map(p => p.x)), Math.max(...Q.map(p => p.y + p.h)));
        const [bx, by] = onPlan(Math.max(...Q.map(p => p.x + p.w)), Math.min(...Q.map(p => p.y)));
        x.save(); x.strokeStyle = INK; x.lineWidth = 3; x.setLineDash([9, 6]); x.strokeRect(ax, ay, bx - ax, by - ay); x.restore();
        f = [(ax + bx) / 2, ay];
      }
      const c: Pt = cu.inside ? [Math.min(f![0] + r + 70, v.x + v.w - r - 20), Math.max(f![1] - r - 60, v.y + PLAN.top + r + 40)]
        : side ? [v.x + v.w - side / 2, v.y + (v.h + PLAN.top - PLAN.bottom) / 2] : insetSpot(img, v, f!, r, m.steps[si].map(i => at([i])));
      const zoom = sr!.stepZoom(si, cu.ids, 2 * r, 2 * r, cu.pad, cu.turn, cu.box), q = m.pieces[cu.ids[0]];
      // the Frame's hanging brick: its pin hole's axis, both ways, through the brick
      const axis = plan?.flip && technic ? (z: Ctx) => {
        const y = q.y + q.h * 0.6, along = q.d > q.w, at = (t: number) => zoom.project(...(along ? [q.x + t, y, q.z + q.d / 2] : [q.x + q.w / 2, y, q.z + t]) as P3), n = along ? q.w : q.d;
        arrow(z, at(-0.2), at(-1.5)); arrow(z, at(n + 0.2), at(n + 1.5));
      } : undefined;
      drawInset(x, zoom.canvas, c, r, f, axis, !cu.behind);
      if (cu.label) { x.fillStyle = SUB; font(x, 20, 700); x.textAlign = 'center'; x.fillText(cu.label, c[0], c[1] - r - 18); x.textAlign = 'left'; }
    }
    // where it is seen from: above (with what the rulers count, and the ribbon layer), from the back, turned over
    const tag = this.tag(si, plan, sr);
    if (tag) {
      const w = viewTag(x, v.x + 18, v.y + 16, ...tag), tx = v.x + 34 + w, tw = v.w - w - 60;
      if (plan) {
        const rulers = `Rulers: ${plan.ruler}${plan.rows && !plan.front ? ` · this step: rows ${plan.rows[0]}–${plan.rows[1]} from the bottom` : ''}`;
        if (plan.caption) {
          font(x, 19, 800);
          const text = x.measureText(plan.caption).width > tw ? plan.caption.replace(CROSS, '') : plan.caption;
          x.fillStyle = INK; fitText(x, text, tx, v.y + 35, tw, 23, 800); x.fillStyle = SUB; fitText(x, rulers, tx, v.y + 62, tw, 18, 600);
        }
        else { x.fillStyle = SUB; fitText(x, rulers, tx, v.y + 46, tw, 20, 600); }
      }
    }
    // step number
    x.fillStyle = INK; font(x, NUM_SIZE, 800); x.fillText(String(si + 1), L.num.x, L.num.y);
    // parts box
    const b = L.box;
    x.fillStyle = BOX; x.strokeStyle = BOXLINE; x.lineWidth = 3;
    x.beginPath(); x.roundRect(b.x, b.y, b.w, b.h, 18); x.fill(); x.stroke();
    items.forEach((it, k) => {
      const X0 = b.x + 14 + (k % b.cols) * b.cw, Y0 = b.y + 14 + Math.floor(k / b.cols) * b.rh, cy = Y0 + b.rh / 2;
      partIcon(x, X0 + 6 + b.icon / 2, cy, it.kind, it.a, it.b, it.h, it.c, b.icon, b.rh - 20);
      const tx = X0 + b.icon + 14, tw = b.cw - b.icon - 18, small = Math.round(b.font * 0.62), lh = small * 1.12;
      const lines = it.kind === 'round' ? ['round', it.h === 1 ? '1×1 plate' : '1×1 brick'] : [`${it.a}×${it.b}`], ty = cy + 4 - ((lines.length - 1) * lh) / 2;
      x.fillStyle = '#111'; fitText(x, `${it.qty}x`, tx, ty, tw, b.font, 800);
      font(x, small, 600);
      const fs = Math.max(small * 0.6, Math.min(small, (small * tw) / Math.max(...lines.map(l => x.measureText(l).width))));
      x.fillStyle = SUB; font(x, fs, 600); lines.forEach((l, k) => x.fillText(l, tx, ty + b.font * 0.85 + k * lh));
    });
    drawNote(x, note);
    footer(x, n, this.title);
    return pg;
  }

  /** the tag of step `si`'s view: seen from above, from the back (and the front again), turned over (and back), or the
   *  raised ribbon on the table */
  private tag(si: number, plan: StepPlan | null, sr: StepRender | null): [string, TagIcon] | null {
    if (plan) {
      if (plan.flip) return ['Turned over', 'turn'];
      if (plan.front) return ['Seen from the front', 'front'];
      return si > 0 && stepPlan(this.m, si - 1)?.flip ? ['Turned back over, seen from above', 'turn'] : ['Seen from above', 'top'];
    }
    const side = (k: number): Side => { const p = k < 0 ? null : stepPlan(this.m, k); return k < 0 ? 'front' : p ? (p.flip ? 'under' : 'front') : sr!.side(k); };
    const now = side(si), before = side(si - 1);
    if (now === 'back') return ['Seen from the back', 'turn'];
    if (now === 'under') return ['Turned over', 'turn'];
    if (sr!.sub(si)) return ['The ribbon, on the table', 'table'];
    if (before === 'back') return ['Seen from the front again', 'turn'];
    if (before === 'under') return ['Turned back over', 'turn'];
    return null;
  }

  /** The Frame's back turned over, on its plan: the edge that is the picture's top, the bricks the cord goes through,
   *  the spacers. */
  private backLabels(x: Ctx, p: StepPlan, at: (px: number, pz: number) => Pt) {
    const P = this.m.pieces, hp = this.m.hanging!.points, back = P.flatMap((q, i) => (q.y < 0 ? [i] : []));
    const mid = (ids: number[]) => ids.map(i => at(P[i].x + P[i].w / 2, P[i].z + P[i].d / 2));
    const [cx, ty] = at((p.x0 + p.x1) / 2, p.z1);
    pill(x, 'Top of the picture', cx, ty + 40, true);
    const top = mid(back.filter(i => hp.includes(i))), low = mid(back.filter(i => !hp.includes(i))), avg = (q: Pt[]) => q.reduce((a, b) => a + b[0], 0) / q.length;
    if (top.length) callout(x, 'Hanging points: the cord goes through their holes', avg(top), top[0][1] + 150, top);
    if (low.length) callout(x, 'Spacers', avg(low), low[0][1] - 150, low);
  }

  /** Floating, Backdrop: the finished ribbon above the base, arrows down onto its clear supports. */
  private async place(n: number): Promise<HTMLCanvasElement> {
    const { m } = this, sr = await this.renderer(), [pg, x] = blank(), P = m.pieces, rr = raisedRibbon(m)!;
    x.fillStyle = INK; font(x, 52, 800); x.fillText('Place the ribbon', 60, 92);
    x.fillStyle = SUB; font(x, 25); x.fillText('Lift the finished ribbon off the table and press it onto the clear supports.', 60, 134);
    const note = noteOf(x, 'Hold the ribbon level over the base, as shown, and lower it until it rests on every clear column. Then press gently all along, from one end to the other, until every column has clicked in.');
    const V = { x: 40, y: 164, w: PW - 80, h: PH - FOOT - 20 - note.h - 14 - 164 }, up = 16, shot = sr.place(V.w, V.h, up);
    x.fillStyle = VIEW; x.beginPath(); x.roundRect(V.x, V.y, V.w, V.h, 18); x.fill();
    x.drawImage(shot.canvas, V.x, V.y);
    // arrows at a few columns spread along the ribbon: from under the raised ribbon down to the column's top
    const cols = [...new Map(P.filter(p => p.support).map(p => [`${p.x},${p.z}`, p] as const)).values()].sort((a, b) => a.x - b.x || a.z - b.z);
    const pick = [...new Set([0, 0.33, 0.67, 1].map(t => Math.round(t * (cols.length - 1))))].map(k => cols[k]);
    const at = (p: P3): Pt => { const [u, w] = shot.project(...p); return [u + V.x, w + V.y]; };
    for (const c of pick) arrow(x, at([c.x + 0.5, rr.y + up - 2, c.z + 0.5]), at([c.x + 0.5, rr.y + 1.5, c.z + 0.5]));
    drawNote(x, note);
    footer(x, n, this.title);
    return pg;
  }

  private async nameplate(n: number): Promise<HTMLCanvasElement> {
    const { m } = this, sr = await this.renderer(), lines = m.nameplate!.lines, [pg, x] = blank();
    x.fillStyle = INK; font(x, 52, 800); x.fillText('Nameplate', 60, 92);
    const where = m.format === 'mosaic' ? 'in the bottom-right corner of the mosaic' : m.display === 'frame' ? 'at the bottom right of the frame' : 'in the middle of the base’s front edge';
    x.fillStyle = SUB; font(x, 25); x.fillText(`The label for the black 2×6 tile ${where}: print it and stick it on, or have it engraved.`, 60, 134);
    // a big preview
    const pw = 820, ph = Math.round((pw * NAMEPLATE_MM[1]) / NAMEPLATE_MM[0]);
    x.save(); x.shadowColor = 'rgba(20,35,50,.3)'; x.shadowBlur = 24; x.shadowOffsetY = 8; x.fillStyle = '#111'; x.fillRect(60, 180, pw, ph); x.restore();
    x.save(); x.translate(60, 180); drawNameplate(x, pw, ph, lines); x.restore();
    x.fillStyle = SUB; font(x, 20); x.fillText(`Enlarged. Real size: ${NAMEPLATE_MM[0]} × ${NAMEPLATE_MM[1]} mm, the face of tile 69729.`, 60, 180 + ph + 40);
    // where it goes, on the finished model
    const W = { x: 940, y: 172, w: PW - 60 - 940, h: ph + 16 }, zoom = sr.finishedZoom([m.nameplate!.piece], W.w, W.h, 5);
    x.fillStyle = VIEW; x.beginPath(); x.roundRect(W.x, W.y, W.w, W.h, 16); x.fill();
    x.save(); x.beginPath(); x.roundRect(W.x, W.y, W.w, W.h, 16); x.clip(); x.drawImage(zoom.canvas, W.x, W.y); x.restore();
    x.fillStyle = SUB; font(x, 20); x.fillText('Where it goes', W.x, W.y + W.h + 32);
    // real-size copies with cut marks, and a 50 mm bar to check the print scale
    const mm = (v: number) => v * MM, [fw, fh] = NAMEPLATE_MM;
    x.fillStyle = INK; font(x, 30, 800); x.fillText('Print it at real size', mm(PRINT.slots[0][0]), mm(PRINT.slots[0][1]) - 60);
    for (const [sx, sy] of PRINT.slots) {
      x.fillStyle = renderHex(BLACK); x.fillRect(mm(sx - PRINT.bleed), mm(sy - PRINT.bleed), mm(fw + 2 * PRINT.bleed), mm(fh + 2 * PRINT.bleed));
      x.save(); x.translate(mm(sx), mm(sy)); drawNameplate(x, mm(fw), mm(fh), lines); x.restore();
      x.strokeStyle = '#8c8c8c'; x.lineWidth = 1; x.beginPath();
      for (const [X, Y, dx, dy] of cutMarks(sx, sy)) { x.moveTo(mm(X), mm(Y)); x.lineTo(mm(X + dx), mm(Y + dy)); }
      x.stroke();
    }
    const [bx, by] = PRINT.bar;
    x.strokeStyle = '#222'; x.lineWidth = 2; x.beginPath();
    for (const [X1, Y1, X2, Y2] of scaleBar()) { x.moveTo(mm(X1), mm(Y1)); x.lineTo(mm(X2), mm(Y2)); }
    x.stroke();
    x.fillStyle = '#222'; font(x, 18); x.fillText('This bar must measure exactly 50 mm', mm(bx + 54), mm(by) + 6);
    // how to
    const tx = mm(160), tw = PW - 60 - tx;
    let y = mm(PRINT.slots[0][1]) - 60;
    const para = (head: string, text: string[]) => {
      x.fillStyle = INK; font(x, 30, 800); x.fillText(head, tx, y); y += 44;
      font(x, 23); x.fillStyle = '#26394a';
      text.forEach((t, i) => {
        const ls = wrap(x, t, tw - 34);
        if (text.length > 1) { font(x, 23, 800); x.fillText(`${i + 1}`, tx, y); font(x, 23); }
        ls.forEach((l, j) => x.fillText(l, tx + (text.length > 1 ? 34 : 0), y + j * 32));
        y += ls.length * 32 + 10;
      });
      y += 22;
    };
    para('How', [
      'Print this page at 100 % (“Actual size”, not “Fit to page”) on A4 or US Letter. Check the bar with a ruler.',
      'Use white sticker paper (the label prints its own black), or plain paper and thin double-sided tape.',
      'Cut along the grey marks through the black edge, then press the label onto the tile.',
    ]);
    para('Or have it engraved', ['A laser-engraving or UV-printing shop can work from the nameplate PNG files in the kit (600 dpi, with and without cut marks), on a black 2×6 tile (69729).']);
    footer(x, n, this.title);
    return pg;
  }

  private async hanging(n: number): Promise<HTMLCanvasElement> {
    const { m } = this, sr = await this.renderer(), [pg, x] = blank(), hp = m.hanging!, P = m.pieces, say = hangingText(m);
    const [ia, ib] = [...hp.points].sort((i, j) => P[i].x - P[j].x), [a, b] = [P[ia], P[ib]], spacers = P.filter((p, i) => p.y < 0 && !hp.points.includes(i));
    const z1 = Math.max(...P.map(p => p.z + p.d)), wall = Math.min(...P.map(p => p.y));
    // the cord leaves both holes (they run along x) inwards; the fixings go on the wall a little above the bricks, under
    // the frame's top edge, hidden behind it: one hook at the cord's apex in the middle, or two hooks or screws straight
    // above the bricks, the cord pulling straight up (1–3 kg: or one screw at the apex, drawn dashed)
    const two = say.fixing !== 'hook', hz = Math.min(z1 - 0.4, Math.max(a.z + a.d, b.z + b.d) + 0.6);
    const hole = (p: typeof a): P3 => [p === a ? p.x + p.w : p.x, p.y + p.h * 0.6, p.z + p.d / 2];
    const apex: P3 = [(a.x + a.w + b.x) / 2, wall, hz], fixings: P3[] = two ? [[a.x + a.w, wall, hz], [b.x, wall, hz]] : [apex];
    const V = { x: 600, y: 24, w: PW - 640, h: PH - FOOT - 48 };
    const shot: Shot = sr.hanging(V.w, V.h, [...fixings, apex]);
    x.fillStyle = VIEW; x.beginPath(); x.roundRect(V.x, V.y, V.w, V.h, 18); x.fill();
    x.drawImage(shot.canvas, V.x, V.y);
    const at = (p: P3): Pt => { const [u, v] = shot.project(...p); return [u + V.x, v + V.y]; };
    const [L, R, Hs, A] = [at(hole(a)), at(hole(b)), fixings.map(at), at(apex)];
    const cord = (x: Ctx, pts: Pt[], k = 1) => {
      x.lineCap = x.lineJoin = 'round';
      for (const [col, lw] of [['#4a3418', 8 * k], ['#c49a5c', 4.5 * k]] as const) {
        x.strokeStyle = col; x.lineWidth = lw; x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(...p) : x.moveTo(...p))); x.stroke();
      }
    };
    // a hook: a nail head, its shank and the cup the cord rests in (at H)
    const hook = (x: Ctx, H: Pt, k = 1) => {
      x.save(); x.lineCap = 'round';
      for (const [col, e] of [['#fff', 3], ['#2c3845', 0]] as const) {
        x.fillStyle = x.strokeStyle = col; x.lineWidth = (6 + e) * k;
        x.beginPath(); x.arc(H[0] - 9 * k, H[1] - 28 * k, (11 + e / 2) * k, 0, Math.PI * 2); x.fill();
        x.beginPath(); x.moveTo(H[0] - 9 * k, H[1] - 22 * k); x.lineTo(H[0] - 9 * k, H[1] - 9 * k); x.arc(H[0], H[1] - 9 * k, 9 * k, Math.PI, 0, true); x.lineTo(H[0] + 9 * k, H[1] - 17 * k); x.stroke();
      }
      x.restore();
    };
    // a screw in its wall plug: the head, the cord on its shank just under it (at H); `ghost`: the other way, dashed
    const screw = (x: Ctx, H: Pt, k = 1, ghost = false) => {
      const [cx, cy] = [H[0], H[1] - 10 * k], r = 11 * k;
      x.save();
      if (ghost) { x.strokeStyle = INK; x.lineWidth = 2.5; x.setLineDash([7, 5]); x.beginPath(); x.arc(cx, cy + 3 * k, r + 13 * k, 0, Math.PI * 2); x.stroke(); x.setLineDash([]); }
      x.fillStyle = '#fff'; x.beginPath(); x.arc(cx, cy, r + 3 * k, 0, Math.PI * 2); x.fill();
      const g = x.createRadialGradient(cx - 4 * k, cy - 4 * k, 1, cx, cy, r);
      g.addColorStop(0, '#e9eef2'); g.addColorStop(1, '#8a96a2');
      x.fillStyle = g; x.strokeStyle = '#2c3845'; x.lineWidth = 2.5 * k; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); x.stroke();
      x.lineWidth = 2.6 * k; x.lineCap = 'round'; x.beginPath();
      x.moveTo(cx - 6 * k, cy); x.lineTo(cx + 6 * k, cy); x.moveTo(cx, cy - 6 * k); x.lineTo(cx, cy + 6 * k); x.stroke();
      x.restore();
    };
    const fix = say.fixing === 'screws' ? screw : hook;
    cord(x, [L, ...Hs, R]);
    Hs.forEach(H => fix(x, H, 0.85));
    if (say.alt) screw(x, A, 0.85, true);
    const tag = (text: string, tx: number, ty: number, to: Pt[]) => callout(x, text, tx, ty, to);
    const brick = (p: typeof a) => at([p.x + p.w / 2, p.y, p.z + p.d / 2]);
    tag('Hanging points', (L[0] + R[0]) / 2, (L[1] + R[1]) / 2 + 210, [brick(a), brick(b)]);
    if (spacers.length) { const s = spacers.map(brick), cx = s.reduce((t, p) => t + p[0], 0) / s.length, cy = Math.max(...s.map(p => p[1])); tag('Spacers', cx, Math.min(V.y + V.h - 40, cy + 90), s); }
    // the cord's label: halfway to the hook, between the two fixings, or (the screw instead drawn in the middle, its label
    // above, under the hooks') a third of the way from the one on the left (seen from behind, the model's right)
    const lr = [...Hs].sort((p, q) => p[0] - q[0]), [H0, H1] = [lr[0], lr.at(-1)!], t = say.alt ? 0.35 : 0.5, M: Pt = two ? [H0[0] + (H1[0] - H0[0]) * t, H0[1] + (H1[1] - H0[1]) * t] : [(L[0] + H0[0]) / 2, (L[1] + H0[1]) / 2];
    tag('Picture cord', M[0], M[1] + 90, [M]);
    if (say.alt) tag('Or: one screw + wall plug', A[0], A[1] - 80, [[A[0], A[1] - 27]]);
    const up = say.fixing === 'screws' ? 22 : 14;
    tag(say.fixing === 'hook' ? 'Picture hook, on the wall' : say.fixing === 'hooks' ? 'Picture hooks, on the wall' : 'Screws + wall plugs, on the wall',
      (H0[0] + H1[0]) / 2, Math.min(H0[1], H1[1]) - (say.alt ? 150 : 90), Hs.map(H => [H[0], H[1] - up] as Pt));
    // text: the advice, then where each fixing goes (a bold lead, the text)
    x.fillStyle = INK; font(x, 52, 800); x.fillText('Hanging', 60, 92);
    x.fillStyle = SUB; font(x, 24); x.fillText('The back of the frame, as it hangs', 60, 132);
    x.fillStyle = INK; font(x, 86, 800); x.fillText(kg(m.grams), 60, 262);
    x.fillStyle = SUB; font(x, 22); x.fillText('estimated weight', 64, 296);
    let y = 358;
    const tw = V.x - 150;
    x.fillStyle = INK; font(x, 25, 700);
    for (const l of wrap(x, say.advice, tw)) { x.fillText(l, 60, y); y += 35; }
    y += 16;
    for (const [lead, body] of say.items) {
      const words = [...lead.split(' ').map(t => ({ t, b: true })), ...body.split(/\s+/).map(t => ({ t, b: false }))];
      for (const line of wrapRich(x, words, tw, 22)) {
        for (const w of line) { font(x, 22, w.b ? 700 : 400); x.fillStyle = w.b ? INK : '#26394a'; x.fillText(w.t, 60 + w.dx, y); }
        y += 31;
      }
      y += 12;
    }
    // close-up of the hanging point nearer the text column: the cord through its pin hole
    const r = Math.max(110, Math.min(180, (PH - FOOT - 36 - y) / 2)), c: Pt = [V.x - 36 - r, PH - FOOT - 26 - r];
    const [iz, pz] = brick(a)[0] < brick(b)[0] ? [ia, a] : [ib, b], zoom = sr.hanging(2 * r, 2 * r, two ? [[hole(pz)[0], wall, hz + 2]] : [], [iz]);
    drawInset(x, zoom.canvas, c, r, brick(pz), z => {
      const h0 = zoom.project(...hole(pz)), path = (pz === a ? fixings : [...fixings].reverse()).map(h => zoom.project(...h));
      cord(z, [h0, ...path], 1.8);
      z.fillStyle = '#4a3418'; z.beginPath(); z.arc(h0[0], h0[1], 11, 0, Math.PI * 2); z.fill();
      fix(z, path[0], 1.6);
    });
    footer(x, n, this.title);
    return pg;
  }

  private async end(n: number): Promise<HTMLCanvasElement> {
    const { src } = this, hero = await this.hero('end', PW, 740);
    const [pg, x] = blank(hero.bg);
    drawHero(x, hero, 110);
    x.fillStyle = INK; font(x, 56, 800); x.fillText(`${squiggleName(src)}, in bricks`, 60, 92);
    x.fillStyle = SUB; font(x, 26); x.textAlign = 'right'; x.fillText('Finished', PW - 64, 90); x.textAlign = 'left';
    const origin = {
      engine: 'Redrawn from its onchain hash by the collection’s own engine.',
      script: 'Redrawn from Art Blocks’ public API with the Squiggle’s own script.',
      port: 'Redrawn from Art Blocks’ token data with a port of the Squiggle’s script.',
      image: 'Read from Art Blocks’ picture of the token: the variant details are approximate.',
      upload: 'Read from an uploaded picture: the variant details are approximate.',
    };
    const rows = [
      'Riggles is an onchain collection on Robinhood Chain. Built on Squiggle to Bricks by John Karp.',
      ...(src.origin ? [origin[src.origin]] : []),
      'For personal use only, not for sale. Not affiliated with, sponsored or endorsed by the LEGO Group or BrickLink.',
      'Models are generated automatically and checked by software only: they have not been physically built. Provided “as is”, without warranty of any kind.',
      'LEGO® is a trademark of the LEGO Group. Parts data: Rebrickable. Source: github.com/0xnocap/riggles-to-bricks (MIT License).',
    ];
    let y = 890;
    font(x, 21);
    for (const r of rows) for (const l of wrap(x, r, PW - 128)) { x.fillStyle = y === 890 ? INK : '#3a4f62'; font(x, 21, y === 890 ? 700 : 400); x.fillText(l, 64, y); y += 32; }
    font(x, 20); x.fillStyle = SUB; x.textAlign = 'right'; x.fillText(String(n), PW - 64, PH - 34); x.textAlign = 'left';
    return pg;
  }

  /** PDF only: the nameplate page's copies and scale bar again, sharp (600 dpi) and in vector, at real size. */
  printNameplate(pdf: jsPDF) {
    if (!this.m.nameplate) return;
    const [fw, fh] = NAMEPLATE_MM, e = PRINT.bleed, px = (v: number) => Math.round((v / 25.4) * 600);
    const c = document.createElement('canvas'); c.width = px(fw + 2 * e); c.height = px(fh + 2 * e);
    const x = c.getContext('2d')!;
    x.fillStyle = renderHex(BLACK); x.fillRect(0, 0, c.width, c.height);
    x.translate(px(e), px(e)); drawNameplate(x, px(fw), px(fh), this.m.nameplate.lines);
    const data = c.toDataURL('image/png');
    pdf.setDrawColor(140, 140, 140); pdf.setLineWidth(0.1);
    for (const [sx, sy] of PRINT.slots) {
      pdf.addImage(data, 'PNG', sx - e, sy - e, fw + 2 * e, fh + 2 * e, 'nameplate', 'FAST');
      for (const [X, Y, dx, dy] of cutMarks(sx, sy)) pdf.line(X, Y, X + dx, Y + dy);
    }
    pdf.setDrawColor(34, 34, 34); pdf.setLineWidth(0.35);
    for (const [X1, Y1, X2, Y2] of scaleBar()) pdf.line(X1, Y1, X2, Y2);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.sr?.then(r => r.dispose());
  }
}

/** crop marks around a copy at (sx, sy) mm: [x, y, dx, dy] */
function cutMarks(sx: number, sy: number): [number, number, number, number][] {
  const [fw, fh] = NAMEPLATE_MM, { gap: g, mark: l } = PRINT, out: [number, number, number, number][] = [];
  for (const X of [sx, sx + fw]) for (const Y of [sy, sy + fh]) {
    const dx = X === sx ? -1 : 1, dy = Y === sy ? -1 : 1;
    out.push([X, Y + dy * g, 0, dy * l], [X + dx * g, Y, dx * l, 0]);
  }
  return out;
}
/** the 50 mm bar with a tick every 10 mm: segments [x1, y1, x2, y2] in mm */
function scaleBar(): [number, number, number, number][] {
  const [bx, by] = PRINT.bar, out: [number, number, number, number][] = [[bx, by, bx + 50, by]];
  for (let t = 0; t <= 50; t += 5) out.push([bx + t, by - (t % 10 ? 1.2 : 2.2), bx + t, by]);
  return out;
}

/** The whole booklet as an A4 landscape PDF (jsPDF is loaded on demand). */
export async function makeBooklet(m: SqModel, src: BookletSource, onProgress?: (done: number, total: number) => void, o: BookletOptions = {}): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pm = new SqPageMaker(m, src, o);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: `${squiggleName(src)} in bricks · ${modelTitle(m)} · building instructions`, creator: SITE_NAME });
  try {
    for (let n = 1; n <= pm.total; n++) {
      if (n > 1) pdf.addPage('a4', 'landscape');
      const pg = await pm.page(n);
      pdf.addImage(pg.toDataURL('image/jpeg', 0.86), 'JPEG', 0, 0, PAGE_MM[0], PAGE_MM[1], undefined, 'FAST');
      if (pm.kind(n) === 'nameplate') pm.printNameplate(pdf);
      onProgress?.(n, pm.total);
      await new Promise(r => setTimeout(r, 0));
    }
  } finally { pm.dispose(); }
  return pdf.output('blob');
}
