// Weight and price estimate of one part.
// Grams: BrickLink catalogue "Weight" (catalogitem.page?P=<part>), read 2026-09-29.
// 3062b and 6141 are catalogued by BrickLink as 3062 and 4073.
// EUR: LEGO Pick a Brick, lego.com/fr-fr, black element unless noted, read 2026-09-29
// (after the 14 Sep 2026 price change). Reference points: plate 1×1 0.06, brick 2×4 0.22,
// tile 2×2 0.08, tile 1×6 0.16, plate 16×16 3.40, Technic brick 1×16 0.94.
// Prices vary by colour and over time: an order of magnitude, never an exact price.
import { PARTS, type Kind } from '../core/parts';

// part: [grams, EUR]
const TABLE: Record<string, [number, number]> = {
  // bricks
  3005: [0.44, 0.07], 3004: [0.83, 0.11], 3622: [1.24, 0.14], 3010: [1.64, 0.16], 3009: [2.42, 0.25],
  3008: [3.21, 0.28], 3003: [1.35, 0.13], 3002: [1.92, 0.17], 3001: [2.32, 0.22], 2456: [3.74, 0.32],
  3007: [4.75, 0.41], 6112: [4.8, 0.38], 2465: [6.2, 0.72],
  // plates
  3024: [0.2, 0.06], 3023: [0.36, 0.08], 3623: [0.53, 0.08], 3710: [0.71, 0.12], 3666: [1.06, 0.17],
  3460: [1.36, 0.19], 3022: [0.64, 0.1], 3021: [0.93, 0.13], 3020: [1.2, 0.14], 3795: [1.74, 0.19],
  3034: [2.27, 0.29], 3832: [2.91, 0.34], 2445: [3.5, 0.38], 91988: [3.89, 0.41], 4282: [4.5, 0.58],
  3031: [2.22, 0.24], 3032: [3.3, 0.41], 3035: [4.7, 0.53], 3030: [5.55, 0.64], 3029: [6.76, 0.71],
  3958: [4.71, 0.61], 3036: [6.4, 0.71], 3033: [7.95, 0.82], 3028: [9.47, 1.87], 3027: [13.27, 2.41],
  3026: [19.43, 3.5], // price estimated from 6×12 / 6×16: not listed on Pick a Brick on 2026-09-29
  41539: [9.4, 1.13], 92438: [17, 2.47], 91405: [35, 3.4],
  // tiles
  3070: [0.16, 0.06], 3069: [0.26, 0.08], 63864: [0.4, 0.12], 2431: [0.54, 0.14], 6636: [0.83, 0.16],
  4162: [1.06, 0.17], 3068: [0.49, 0.08], 26603: [0.68, 0.13], 87079: [0.9, 0.18], 69729: [1.35, 0.26],
  // curved slope 2×2
  15068: [0.57, 0.13],
  // Technic bricks 1×N
  3700: [0.82, 0.12], 3701: [1.46, 0.17], 3894: [2.2, 0.29], 3702: [2.85, 0.44], 2730: [3.67, 0.55],
  3895: [4.2, 0.61], 32018: [4.92, 0.62], 3703: [5.87, 0.94],
  // round 1×1, Trans-Clear prices (the supports)
  '3062b': [0.28, 0.08], 6141: [0.12, 0.05],
};

// fallback, fitted on the table above: grams = a·n^p, EUR = b·n^q, n = studs
const RULE: Record<Exclude<Kind, 'round'>, [number, number, number, number]> = {
  brick: [0.44, 0.9, 0.061, 0.72],
  technic: [0.41, 0.94, 0.053, 1],
  plate: [0.19, 0.92, 0.035, 0.81],
  tile: [0.15, 0.89, 0.056, 0.55],
  slope: [0.143, 1, 0.065, 0.5],
};

function lookup(part: string, kind: Kind, w: number, d: number, h: number): [number, number] {
  const hit = TABLE[part] ?? TABLE[PARTS[kind]?.[`${Math.min(w, d)}x${Math.max(w, d)}${kind === 'round' && h === 1 ? 'p' : ''}`] ?? ''];
  if (hit) return hit;
  if (kind === 'round') return h === 1 ? [0.12, 0.05] : [0.28, 0.08];
  const [a, p, b, q] = RULE[kind] ?? RULE.brick;
  const n = Math.max(1, w * d || 1);
  return [a * n ** p, Math.max(0.05, b * n ** q)];
}

/** grams per piece */
export const partGrams = (part: string, kind: Kind, w: number, d: number, h: number): number => lookup(part, kind, w, d, h)[0];

/** EUR per piece, order of magnitude of a Pick a Brick price */
export const partPrice = (part: string, kind: Kind, w: number, d: number, h: number): number => lookup(part, kind, w, d, h)[1];
