// The Squiggle palette: 11 spectrum colours + white + black, and the colour of
// every point of the curve. The spectrum order along the curve wins over the
// exact hue: the colour moves one palette step at a time, never skips one, and
// each colour runs for a minimum length.
import { arcLength, type Curve } from './curve';

/** BrickLink colour IDs, in spectrum order, with the Squiggle hue each one stands for. */
export const SPECTRUM: { id: number; name: string; hue: number }[] = [
  { id: 5, name: 'Red', hue: 0 },
  { id: 4, name: 'Orange', hue: 28 },
  { id: 3, name: 'Yellow', hue: 52 },
  { id: 34, name: 'Lime', hue: 78 },
  { id: 36, name: 'Bright Green', hue: 125 },
  { id: 39, name: 'Dark Turquoise', hue: 172 },
  { id: 153, name: 'Dark Azure', hue: 198 },
  { id: 7, name: 'Blue', hue: 225 },
  { id: 89, name: 'Dark Purple', hue: 258 },   // violet
  { id: 71, name: 'Magenta', hue: 292 },
  { id: 47, name: 'Dark Pink', hue: 325 },     // pink
];
export const WHITE = 1, BLACK = 11;
export const SQUIGGLE_COLORS = [...SPECTRUM.map(s => s.id), WHITE, BLACK];
const N = SPECTRUM.length;

/** position of a hue on the palette wheel: anchor k at k, linear in between (0..N) */
export function paletteCoord(hue: number): number {
  const h = ((hue % 360) + 360) % 360;
  for (let k = 0; k < N; k++) {
    const a = SPECTRUM[k].hue, b = k + 1 < N ? SPECTRUM[k + 1].hue : 360;
    if (h >= a && h < b) return k + (h - a) / (b - a);
  }
  return 0;
}

/**
 * Palette colour (BrickLink ID) of every curve point. `minRun` is the shortest
 * run of one colour along the curve, in pixels.
 */
export function curveColors(c: Curve, minRun: number): number[] {
  const pts = c.points, s = arcLength(pts);
  // unwrapped palette coordinate along the curve (hue steps are small between points)
  const u: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const v = paletteCoord(pts[i].hue);
    if (!i) { u.push(v); continue; }
    let d = v - (u[i - 1] % N + N) % N;
    if (d > N / 2) d -= N; else if (d < -N / 2) d += N;
    u.push(u[i - 1] + d);
  }
  const out: number[] = [];
  let cur = Math.round(u[0]), since = 0;
  for (let i = 0; i < pts.length; i++) {
    const want = Math.round(u[i]);
    if (want !== cur && s[i] - since >= minRun) { cur += Math.sign(want - cur); since = s[i]; }
    out.push(SPECTRUM[((cur % N) + N) % N].id);
  }
  return out;
}
