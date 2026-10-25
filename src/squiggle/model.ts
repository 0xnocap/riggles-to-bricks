// A Squiggle brick model (Mosaic, or Relief in one of its displays) and the
// figures shown for it: parts list split into Squiggle and Display, weight,
// size, cost estimate.
import type { Checks } from '../core/check';
import { COLOR_BY_ID } from '../core/palette';
import { partName, type Kind, type Piece } from '../core/parts';
import { partGrams, partPrice } from './partinfo';

export type Format = 'mosaic' | 'relief';
export type Display = 'frame' | 'floating' | 'backdrop';
/** The panel or grid the model was built on, in studs. Set by the builder, never assumed. */
export type Scale = 'small' | 'large';
export type Role = 'squiggle' | 'display';

export interface SqBomLine {
  part: string; kind: Kind; name: string; w: number; d: number; h: number;
  color: number; colorName: string; hex: string;
  qty: number; role: Role;
  hidden: boolean;               // Trans-Clear supports ("hidden supports")
  grams: number;                 // per piece
  price: number;                 // estimate per piece, USD
}
export interface Subtotal { pieces: number; lots: number; grams: number; cost: number }

export interface SqChecks extends Checks {
  /** Frame: ribbon pieces held by fewer than 2 studs (must be 0) */
  twoStud: number | null;
  /** Floating/Backdrop: is the centre of mass over the socle? null when not relevant */
  comInside: boolean | null;
  /** extra named checks (support spacing, margins, seams...), all must be true */
  rules: { name: string; ok: boolean; detail?: string }[];
}

export interface SqModel {
  id: number;
  format: Format;
  display: Display | null;
  scale: Scale;
  pieces: Piece[];
  /** build steps, each a list of piece indices, in order */
  steps: number[][];
  /** text shown with a step, by step index (hidden supports, lighting notes...) */
  stepNotes: Record<number, string>;
  bom: SqBomLine[];
  subtotals: Record<Role, Subtotal>;
  colors: Record<number, string>;
  checks: SqChecks;
  notes: string[];
  /** size in cm as displayed: width, depth, height */
  dims: [number, number, number];
  /** the panel or grid this model was built on, studs */
  panel?: { w: number; h: number };
  grams: number;
  cost: number;                  // order of magnitude, USD
  /**
   * How to show it. 'table': as built, y up. 'wall': the model's y axis points
   * out of the wall towards the viewer and its z axis points up (Frame, hung).
   */
  pose: 'table' | 'wall';
  nameplate: { lines: [string, string]; piece: number } | null;
  /** Frame: the hanging points at the back (piece indices) and advice */
  hanging: { points: number[]; advice: string } | null;
}

export const STUD_CM = 0.8, PLATE_CM = 0.32;

/** Parts list, subtotals, weight, cost and size of a list of pieces. */
export function summarize(pieces: Piece[], pose: SqModel['pose']) {
  const map = new Map<string, SqBomLine>();
  for (const p of pieces) {
    const role: Role = p.role ?? 'squiggle';
    const k = `${p.part}|${p.c}|${role}`;
    let line = map.get(k);
    if (!line) {
      const col = COLOR_BY_ID.get(p.c);
      if (!col) throw new Error(`unknown colour ${p.c}`);
      line = {
        part: p.part, kind: p.kind, name: partName(p.kind, p.w, p.d, p.h), w: Math.min(p.w, p.d), d: Math.max(p.w, p.d), h: p.h,
        color: p.c, colorName: col.name, hex: col.hex, qty: 0, role, hidden: !!p.support,
        grams: partGrams(p.part, p.kind, p.w, p.d, p.h), price: partPrice(p.part, p.kind, p.w, p.d, p.h),
      };
      map.set(k, line);
    }
    line.qty++;
  }
  const bom = [...map.values()].sort((a, b) => (a.role === b.role ? 0 : a.role === 'squiggle' ? -1 : 1) || b.qty - a.qty);
  const sub = (r: Role): Subtotal => {
    const ls = bom.filter(l => l.role === r);
    return {
      pieces: ls.reduce((a, l) => a + l.qty, 0), lots: ls.length,
      grams: Math.round(ls.reduce((a, l) => a + l.qty * l.grams, 0)), cost: Math.round(ls.reduce((a, l) => a + l.qty * l.price, 0)),
    };
  };
  const subtotals = { squiggle: sub('squiggle'), display: sub('display') };
  const colors: Record<number, string> = {};
  for (const p of pieces) colors[p.c] = COLOR_BY_ID.get(p.c)!.name;
  const x0 = Math.min(...pieces.map(p => p.x)), x1 = Math.max(...pieces.map(p => p.x + p.w));
  const z0 = Math.min(...pieces.map(p => p.z)), z1 = Math.max(...pieces.map(p => p.z + p.d));
  const y0 = Math.min(...pieces.map(p => p.y)), y1 = Math.max(...pieces.map(p => p.y + p.h));
  const [W, D, H] = [(x1 - x0) * STUD_CM, (z1 - z0) * STUD_CM, (y1 - y0) * PLATE_CM].map(v => Math.round(v * 10) / 10);
  // hung on a wall: width, thickness (off the wall), height
  const dims: [number, number, number] = pose === 'wall' ? [W, H, D] : [W, D, H];
  return {
    bom, subtotals, colors, dims,
    grams: subtotals.squiggle.grams + subtotals.display.grams,
    cost: subtotals.squiggle.cost + subtotals.display.cost,
  };
}
