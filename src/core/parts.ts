// Piece model and BrickLink part numbers.

// technic: Technic brick 1×N with pin holes (studs on top, like a brick).
// round: round 1×1 (h 3 = brick 3062b, h 1 = plate 6141).
export type Kind = 'brick' | 'plate' | 'tile' | 'slope' | 'technic' | 'round';

/**
 * One piece. Units: x and z in studs (x to the right, z towards the back,
 * z = 0 is the front face), y and h in plates (a brick is 3 plates tall).
 * w is the size along x, d along z.
 */
export interface Piece {
  x: number; z: number; y: number; h: number; w: number; d: number;
  c: number;               // BrickLink colour ID
  kind: Kind;
  part: string;            // BrickLink part number
  dir?: 'N' | 'S' | 'E' | 'W';   // curved slope: which side goes down (N = front)
  group?: 'base' | 'body' | 'top';
  support?: boolean;       // added only to hold something up
  nameplate?: boolean;
  /** Squiggle models: part of the Squiggle itself, or of its display (socle, frame, wall...) */
  role?: 'squiggle' | 'display';
}

export const SIZES: [number, number][] = [[1, 1], [1, 2], [1, 3], [1, 4], [1, 6], [1, 8], [2, 2], [2, 3], [2, 4], [2, 6], [2, 8]];
export const TILE_SIZES: [number, number][] = [[1, 1], [1, 2], [1, 3], [1, 4], [1, 6], [1, 8], [2, 2], [2, 3], [2, 4], [2, 6]];

export const PARTS: Record<Kind, Record<string, string>> = {
  brick: { '1x1': '3005', '1x2': '3004', '1x3': '3622', '1x4': '3010', '1x6': '3009', '1x8': '3008', '2x2': '3003', '2x3': '3002', '2x4': '3001', '2x6': '2456', '2x8': '3007' },
  plate: { '1x1': '3024', '1x2': '3023', '1x3': '3623', '1x4': '3710', '1x6': '3666', '1x8': '3460', '2x2': '3022', '2x3': '3021', '2x4': '3020', '2x6': '3795', '2x8': '3034' },
  tile: { '1x1': '3070', '1x2': '3069', '1x3': '63864', '1x4': '2431', '1x6': '6636', '1x8': '4162', '2x2': '3068', '2x3': '26603', '2x4': '87079', '2x6': '69729' },
  slope: { '2x2': '15068' },
  technic: { '1x2': '3700', '1x4': '3701', '1x6': '3894', '1x8': '3702', '1x10': '2730', '1x12': '3895', '1x14': '32018', '1x16': '3703' },
  round: { '1x1': '3062b', '1x1p': '6141' },
};
// large sizes, used by the Squiggle displays (panels, socles, walls)
Object.assign(PARTS.brick, { '1x12': '6112', '1x16': '2465' });
Object.assign(PARTS.plate, {
  '2x10': '3832', '2x12': '2445', '2x14': '91988', '2x16': '4282', '4x4': '3031', '4x6': '3032', '4x8': '3035', '4x10': '3030', '4x12': '3029',
  '6x6': '3958', '6x8': '3036', '6x10': '3033', '6x12': '3028', '6x16': '3027', '6x24': '3026', '8x8': '41539', '8x16': '92438', '16x16': '91405',
});

export function partId(kind: Kind, w: number, d: number, h = 3): string {
  const id = PARTS[kind][`${Math.min(w, d)}x${Math.max(w, d)}${kind === 'round' && h === 1 ? 'p' : ''}`];
  if (!id) throw new Error(`no ${kind} ${w}x${d}`);
  return id;
}

export function partName(kind: Kind, w: number, d: number, h = 3): string {
  const a = Math.min(w, d), b = Math.max(w, d);
  if (kind === 'slope') return `Slope, Curved ${a} x ${b}`;
  if (kind === 'technic') return `Technic Brick ${a} x ${b} with Holes`;
  if (kind === 'round') return h === 1 ? 'Plate, Round 1 x 1' : 'Brick, Round 1 x 1';
  return `${kind[0].toUpperCase()}${kind.slice(1)} ${a} x ${b}`;
}
