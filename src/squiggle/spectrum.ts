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

/**
 * The greys a Greyscale riggle is built from, darkest first.
 *
 * Such a riggle has no hue at all: its engine answers hsl(0, 0%, L), and hue 0
 * is Red, which is how every Greyscale riggle came out a solid red piece.
 * Lightness carries the whole drawing, so it maps here instead. Black is left
 * out on purpose: it is the mosaic's own background, and the engine keeps a
 * stroke well clear of the background so it always reads.
 */
export const GREYS = [85, 86, 1];   // Dark Bluish Gray, Light Bluish Gray, White

/** The engine's greyscale lightness runs 38 to 92 (engine.js:631). */
const GREY_LO = 38, GREY_HI = 92;

/** position of a lightness on the grey ramp, 0 to GREYS.length - 1 */
export function greyCoord(light: number): number {
  const t = Math.max(0, Math.min(1, (light - GREY_LO) / (GREY_HI - GREY_LO)));
  return t * (GREYS.length - 1);
}
/**
 * The lightest brick of each spectrum colour's own family, for an Accordion's
 * ribs: the engine strokes each square's edge brighter than its fill, same hue.
 * Red, Orange, Lime and Bright Green have no lighter sibling in the palette and
 * fall back to white.
 */
export const LIGHT_OF: Record<number, number> = {
  5: 4,        // Red            -> Orange (no lighter red exists)
  4: 3,        // Orange       -> Yellow
  3: 103,      // Yellow         -> Bright Light Yellow
  34: 103,     // Lime           -> Bright Light Yellow
  36: 152,     // Bright Green   -> Light Aqua
  39: 152,     // Dark Turquoise -> Light Aqua
  153: 156,    // Dark Azure   -> Medium Azure
  7: 105,      // Blue         -> Bright Light Blue
  89: 157,     // Dark Purple  -> Medium Lavender
  71: 104,     // Magenta      -> Bright Pink
  47: 104,     // Dark Pink    -> Bright Pink
};

/**
 * The deepest brick of each spectrum colour's own family, for a Deep riggle.
 * Where the palette has no darker sibling the colour stands as it is.
 */
export const DARK_OF: Record<number, number> = {
  5: 59,       // Red            -> Dark Red
  4: 68,       // Orange         -> Dark Orange
  3: 69,       // Yellow         -> Dark Tan
  34: 155,     // Lime           -> Olive Green
  36: 80,      // Bright Green   -> Dark Green
  153: 63,     // Dark Azure     -> Dark Blue
  7: 63,       // Blue           -> Dark Blue
  47: 71,      // Dark Pink      -> Magenta
};

/**
 * A riggle's Intensity, which the chain rolls alongside its hues: Neon as the
 * spectrum is, Pastel a shade lighter, Deep a shade darker. Ignoring it built
 * every pastel riggle in full strength colours, which is half the collection
 * wearing the wrong tone.
 */
export function toned(col: number, tone: 'pastel' | 'deep' | null | undefined): number {
  if (tone === 'pastel') return LIGHT_OF[col] ?? col;
  if (tone === 'deep') return DARK_OF[col] ?? col;
  return col;
}

export const SQUIGGLE_COLORS = [...SPECTRUM.map(s => s.id), ...GREYS, ...Object.values(LIGHT_OF), ...Object.values(DARK_OF), WHITE, BLACK];
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
  // A Greyscale riggle walks the grey ramp by lightness. That ramp is a line,
  // not a wheel: it does not wrap from white back to dark.
  const grey = !!c.greyscale && c.light?.length === pts.length;
  const ramp = grey ? GREYS : SPECTRUM.map(p => p.id);
  const n = ramp.length;
  const coord = grey ? (i: number) => greyCoord(c.light![i]) : (i: number) => paletteCoord(pts[i].hue);
  // unwrapped palette coordinate along the curve (steps are small between points)
  const u: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const v = coord(i);
    if (!i) { u.push(v); continue; }
    if (grey) { u.push(v); continue; }
    let d = v - (u[i - 1] % n + n) % n;
    if (d > n / 2) d -= n; else if (d < -n / 2) d += n;
    u.push(u[i - 1] + d);
  }
  const out: number[] = [];
  let cur = Math.round(u[0]), since = 0;
  for (let i = 0; i < pts.length; i++) {
    const want = Math.round(u[i]);
    if (want !== cur && s[i] - since >= minRun) { cur += Math.sign(want - cur); since = s[i]; }
    const pick = grey ? ramp[Math.max(0, Math.min(n - 1, cur))] : ramp[((cur % n) + n) % n];
    out.push(grey ? pick : toned(pick, c.tone));
  }
  return out;
}
