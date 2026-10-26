// The Squiggle palette: 11 spectrum colours + white + black, and the colour of
// every point of the curve. The spectrum order along the curve wins over the
// exact hue: the colour moves one palette step at a time, never skips one, and
// each colour runs for a minimum length.
import { arcLength, type Curve } from './curve';
import { COLOR_BY_ID } from '../core/palette';

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
 * The brick a Pastel riggle wears in each spectrum family.
 *
 * Chosen one family at a time against the colour the collection actually
 * paints there, pale first, and judged against the art rather than by a
 * distance formula. Two findings shaped it. Hue true bricks are wrong when
 * they are full strength: Bright Light Yellow and Lime put two vivid blocks
 * in the middle of a soft piece. And the nearest brick by distance is wrong
 * when it brings in a colour the art never shows: the warm end of a pastel
 * riggle is salmon pink, so Nougat measured closest to it and read as orange
 * against a piece that has no orange in it.
 *
 * The palette holds about eight genuinely pale bricks for eleven families, so
 * three families share one with a neighbour. Being the right tone matters
 * more than holding eleven separate steps.
 */
export const PASTEL_OF: Record<number, number> = {
  5: 104,      // Red            -> Bright Pink        (the salmon pink the art paints)
  4: 90,       // Orange         -> Light Nougat
  3: 2,        // Yellow         -> Tan
  34: 48,      // Lime           -> Sand Green
  36: 152,     // Bright Green   -> Light Aqua
  39: 152,     // Dark Turquoise -> Light Aqua         (shared: no second pale aqua)
  153: 105,    // Dark Azure     -> Bright Light Blue
  7: 105,      // Blue           -> Bright Light Blue  (shared: no second pale blue)
  89: 154,     // Dark Purple    -> Lavender
  71: 157,     // Magenta        -> Medium Lavender
  47: 104,     // Dark Pink      -> Bright Pink        (shared with Red, either side of the wheel)
};

/**
 * The brick a Deep riggle wears in each spectrum family. Where the palette has
 * no darker sibling of that hue the colour stands as it is, which is why Dark
 * Turquoise, Dark Azure and Dark Purple repeat: each is already the deepest
 * brick of its hue. Magenta serves both the magenta and the pink family, being
 * the nearest brick to each of them once they darken.
 */
export const DEEP_OF: Record<number, number> = {
  5: 59,       // Red            -> Dark Red
  4: 68,       // Orange         -> Dark Orange
  3: 155,      // Yellow         -> Olive Green
  34: 36,      // Lime           -> Bright Green
  36: 6,       // Bright Green   -> Green
  39: 39,      // Dark Turquoise -> Dark Turquoise
  153: 153,    // Dark Azure     -> Dark Azure
  7: 63,       // Blue           -> Dark Blue
  89: 89,      // Dark Purple    -> Dark Purple
  71: 71,      // Magenta        -> Magenta
  47: 71,      // Dark Pink      -> Magenta
};

/**
 * The brick an Accordion's ribs are built in, for every brick a body can be.
 *
 * This is a different question from Intensity and needs its own table: the
 * engine outlines each stamped square a shade lighter than its fill, so a rib
 * answers to the colour of the body it sits on, whatever tone that body is.
 * Reading it off the family instead put a pastel Lime body and its ribs on the
 * same brick, which draws no rib at all. White is the fallback, being lighter
 * than every body brick.
 */
export const RIB_OF: Record<number, number> = {
  // the spectrum
  5: 28, 4: 90, 3: 103, 34: 103, 36: 48, 39: 152, 153: 105, 7: 105, 89: 157, 71: 157, 47: 104,
  // the pastel bricks
  28: 90, 2: 90, 48: 152, 152: 1, 156: 105, 105: 1, 154: 1, 157: 154, 104: 1, 90: 1,
  // the deep bricks
  59: 5, 68: 4, 155: 2, 6: 36, 63: 7,
  // the greys
  85: 86, 86: 1, 1: 1,
};

/**
 * A riggle's Intensity, which the chain rolls alongside its hues: Neon as the
 * spectrum is, Pastel a shade lighter, Deep a shade darker. Ignoring it built
 * every pastel riggle in full strength colours, which is half the collection
 * wearing the wrong tone.
 */
export function toned(col: number, tone: 'pastel' | 'deep' | null | undefined): number {
  if (tone === 'pastel') return PASTEL_OF[col] ?? col;
  if (tone === 'deep') return DEEP_OF[col] ?? col;
  return col;
}

export const SQUIGGLE_COLORS = [...SPECTRUM.map(s => s.id), ...GREYS, ...Object.values(PASTEL_OF), ...Object.values(DEEP_OF), ...Object.values(RIB_OF), WHITE, BLACK];
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
/**
 * The bricks a riggle may be built from: the spectrum, each colour's lighter
 * and deeper sibling, and the greys. Black is left out, being the usual field.
 */
export const RIGGLE_BRICKS = [...new Set([
  ...SPECTRUM.map(p => p.id), ...Object.values(PASTEL_OF), ...Object.values(DEEP_OF),
  ...Object.values(RIB_OF), ...GREYS,
])];

const RGB = new Map<number, [number, number, number]>();
for (const id of RIGGLE_BRICKS) {
  const h = (COLOR_BY_ID.get(id)?.hex ?? '#000000').slice(1);
  RGB.set(id, [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);
}

/** hsl as the engine writes it, to rgb */
export function hslRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return [f(0), f(8), f(4)];
}

/** rgb to hue 0..360, saturation and lightness 0..1 */
function hsl([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn, l = (mx + mn) / 2;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [((h * 60) % 360 + 360) % 360, s, l];
}

const HSL = new Map<number, [number, number, number]>();
for (const id of RIGGLE_BRICKS) HSL.set(id, hsl(RGB.get(id)!));

/** A riggle's Intensity, as the curve carries it. */
export type Tone = 'pastel' | 'deep' | null | undefined;

/**
 * The spectrum colour a hue belongs to: the nearest of the eleven anchors
 * around the wheel.
 */
export function spectrumOf(hue: number): number {
  const h = ((hue % 360) + 360) % 360;
  let best = SPECTRUM[0].id, bd = Infinity;
  for (const p of SPECTRUM) {
    let d = Math.abs(p.hue - h); if (d > 180) d = 360 - d;
    if (d < bd) { bd = d; best = p.id; }
  }
  return best;
}

/**
 * The brick a painted colour is built in: its hue picks the family, the
 * riggle's own Intensity picks the member of it.
 *
 * This is the engine's own structure rather than a guess at it. A riggle's
 * hue sweeps along its length while its Intensity is one roll for the whole
 * piece (engine.js:66), which sets saturation and a lightness multiplier and
 * nothing else. So lightness does not vary along a riggle: measured over
 * eighty-one of them, not one moves by more than twelve points. Matching each
 * point to its nearest brick by colour distance therefore spent its whole
 * budget on a difference the art does not have, and sent pale riggles to Red
 * and Dark Red because hue agreed and lightness was outvoted.
 *
 * Reading the tone straight off the piece puts a pastel riggle on pale bricks
 * and a deep one on deep bricks by construction, and it is checkable: eleven
 * families, three members each, in PASTEL_OF and DEEP_OF above.
 */
export function brickFor(hue: number, tone: Tone): number {
  return toned(spectrumOf(hue), tone);
}

export function curveColors(c: Curve, minRun: number): number[] {
  const pts = c.points, s = arcLength(pts);
  // A riggle takes the brick its hue and its Intensity name, and holds it for at
  // least minRun, which keeps a gradient from flickering between two neighbours.
  // A Squiggle carries only a hue and walks the spectrum wheel below.
  if (c.sat != null && c.light?.length === pts.length) {
    const want = pts.map(p => brickFor(p.hue, c.tone));
    const out: number[] = [];
    let cur = want[0], since = 0;
    for (let i = 0; i < pts.length; i++) {
      if (want[i] !== cur && s[i] - since >= minRun) { cur = want[i]; since = s[i]; }
      out.push(cur);
    }
    return out;
  }
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
