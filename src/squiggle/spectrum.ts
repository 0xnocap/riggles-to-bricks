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
 * The brick a Pastel riggle wears in each family.
 *
 * A pastel riggle is painted at 62 saturation and 70 lightness: bright, not
 * dusty. Every family now gets a brick of its own hue at about that strength,
 * which only became possible once the palette held the bricks' real values.
 * Chosen before it did, against numbers that said the bright bricks were dull
 * ones, this table reached for the greyest bricks in the set, and a pastel
 * riggle came out the colour of a nursery blanket: Sand Green at 17
 * saturation standing in for a mint the art paints at 62.
 *
 * The warm end shares one brick. LEGO sells exactly two colours in that band
 * of hue at a pastel's lightness, Bright Pink and Coral, and Coral is
 * saturation 100: dropped among these it reads as an orange red, where the
 * art paints a soft salmon. Red and Dark Pink sit either side of the wheel
 * from each other, so both take the pink.
 *
 * The bricks are also kept near one lightness, because the art keeps them
 * there: every pastel colour it paints is lightness 70, whatever its hue. A
 * brick well below that reads as a hole rather than a shade. That is what
 * rules out the Bright Green brick, which is the right hue and lightness 49:
 * dropped into a piece built at 80 it looked like a neon block. LEGO makes no
 * lighter green in plates and tiles, Medium Green being sold in one plate and
 * no tiles at all, so the green families take the pale yellow green and the
 * pale mint on either side of them.
 */
export const PASTEL_OF: Record<number, number> = {
  5: 104,      // Red            -> Bright Pink         (shared: see below)
  4: 28,       // Orange         -> Nougat
  3: 103,      // Yellow         -> Bright Light Yellow
  34: 158,     // Lime           -> Yellowish Green
  36: 158,     // Bright Green   -> Yellowish Green     (shared: see below)
  6: 152,      // Green          -> Light Aqua
  39: 156,     // Dark Turquoise -> Medium Azure
  153: 105,    // Dark Azure     -> Bright Light Blue
  7: 42,       // Blue           -> Medium Blue
  89: 154,     // Dark Purple    -> Lavender
  71: 157,     // Magenta        -> Medium Lavender
  47: 104,     // Dark Pink      -> Bright Pink
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
  6: 6,        // Green          -> Green              (already the deep green; Dark Green is darker than the art)
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
  5: 28, 4: 90, 3: 103, 34: 103, 36: 152, 39: 152, 153: 105, 7: 105, 89: 157, 71: 157, 47: 104,
  // the pastel bricks
  220: 90, 28: 90, 103: 1, 158: 1, 152: 1, 156: 152, 105: 1, 42: 105, 154: 1, 157: 154, 104: 1, 90: 1, 2: 90,
  // the deep bricks
  59: 5, 68: 4, 155: 2, 6: 36, 80: 6, 63: 7,
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
 * The families a riggle is built from: the eleven of the spectrum, and Green.
 *
 * Green is here because the spectrum leaves sixty seven degrees of hue empty
 * between Bright Green and Dark Turquoise, and a tenth of the colour the
 * collection paints falls in it. Every spring green was being built in Dark
 * Turquoise, more than thirty degrees away, which is why a green riggle came
 * out teal. Green's own hue is 141, and it is anchored at 148, the middle of
 * the gap.
 *
 * The anchors are the spectrum's own numbers rather than the hue each brick
 * measures, which is a designed wheel and not a description of the bricks.
 * Measuring instead moved the boundary between Blue and Dark Purple by
 * fifteen degrees and put a violet tip on a riggle the art ends in blue.
 */
export const RIGGLE_FAMILIES: { id: number; hue: number }[] = [
  ...SPECTRUM.slice(0, 5).map(p => ({ id: p.id, hue: p.hue })),   // Red to Bright Green
  { id: 6, hue: 148 },                                            // Green
  ...SPECTRUM.slice(5).map(p => ({ id: p.id, hue: p.hue })),      // Dark Turquoise on
];

/** The family a hue belongs to: the nearest of them around the wheel. */
export function spectrumOf(hue: number): number {
  const h = ((hue % 360) + 360) % 360;
  let best = RIGGLE_FAMILIES[0].id, bd = Infinity;
  for (const f of RIGGLE_FAMILIES) {
    let d = Math.abs(f.hue - h); if (d > 180) d = 360 - d;
    if (d < bd) { bd = d; best = f.id; }
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

/**
 * The shortest stretch one colour may cover, in studs: a section under this is
 * merged into its neighbour rather than built.
 *
 * Two studs, which is what the Relief can actually build. It lays no 1x1
 * piece, so that every piece sits on at least two studs and the ribbon holds
 * together as one body, and a cell it cannot tie in that way is dropped. A
 * one stud section therefore does not come out short, it comes out missing:
 * at one stud the riggle was severed into pieces with holes between them,
 * while the checks still passed, every piece being held by the panel beneath
 * it rather than by the riggle.
 *
 * The length of a section is governed by the merging in curveColors rather
 * than by this number. Holding the colour in hand and then taking whatever
 * the hue had become made sections far longer than the art's; merging the
 * short runs away instead brings them back to the art's own length at the
 * same two studs.
 */
export const minSection = () => 2;

export function curveColors(c: Curve, minRun: number): number[] {
  const pts = c.points, s = arcLength(pts);
  // A riggle takes the brick its hue and its Intensity name. A Squiggle carries
  // only a hue and walks the spectrum wheel below.
  //
  // Each colour then has to hold for minRun, and how that is done decides
  // whether a section covers the stretch of the riggle the art gives it.
  // Holding the colour in hand until minRun has passed, then taking whatever
  // the hue happens to be at that moment, chops the piece into slivers: where
  // a sweeping hue sits on the line between two families the brick alternates
  // between them, and the hold turns that alternation into a stripe of each,
  // every one exactly minRun long. The art has no boundary there at all, only
  // a ramp.
  //
  // So the runs are taken as the hue gives them and the short ones are merged
  // away, shortest first, each into whichever neighbour is longer. A run the
  // art really does hold keeps its own length, and an alternation collapses
  // into the colour around it instead of becoming a stripe.
  if (c.sat != null && c.light?.length === pts.length) {
    const want = pts.map(p => brickFor(p.hue, c.tone));
    const runs: { c: number; i0: number; i1: number }[] = [];
    for (let i = 0; i < pts.length; i++) {
      const last = runs[runs.length - 1];
      if (!last || last.c !== want[i]) runs.push({ c: want[i], i0: i, i1: i + 1 });
      else last.i1 = i + 1;
    }
    const len = (r: { i0: number; i1: number }) => s[r.i1 - 1] - s[r.i0];
    const join = () => {
      for (let i = runs.length - 1; i > 0; i--) {
        if (runs[i].c !== runs[i - 1].c) continue;
        runs[i - 1].i1 = runs[i].i1; runs.splice(i, 1);
      }
    };
    // A run too short to build first tries to borrow the length it needs from
    // a neighbour that can spare it, and only joins one when none can. The
    // riggle usually has the room: #13 wants 68 sections and two studs each
    // comes to 136 of its 160, so every colour the art paints can be built.
    //
    // Merging on sight loses colours, and merging into the longer neighbour
    // loses them unevenly: the longest run swallows each sliver beside it,
    // grows, and so wins the next merge too, which took Yellowish Green from
    // the 19 per cent of #13 the art gives it to 54 and left five of its
    // eleven colours out of the model altogether. Where a merge is still
    // needed the run joins the neighbour whose brick is nearest its own.
    const near = (a: number, b: number) => {
      const [ar, ag, ab] = RGB.get(a) ?? [0, 0, 0], [br, bg, bb] = RGB.get(b) ?? [0, 0, 0];
      return 3 * (ar - br) ** 2 + 4 * (ag - bg) ** 2 + 2 * (ab - bb) ** 2;
    };
    const shortest = () => {
      let m = -1, ml = Infinity;
      for (let i = 0; i < runs.length; i++) { const L = len(runs[i]); if (L < ml) { ml = L; m = i; } }
      return ml < minRun ? m : -1;
    };
    for (let guard = 0; guard < 4 * pts.length; guard++) {
      const m = shortest();
      if (m < 0 || runs.length < 2) break;
      let grew = true;
      while (len(runs[m]) < minRun && grew) {
        const left = m > 0 ? runs[m - 1] : null, right = m < runs.length - 1 ? runs[m + 1] : null;
        const slackL = left && left.i1 - left.i0 > 1 ? len(left) - minRun : -1;
        const slackR = right && right.i1 - right.i0 > 1 ? len(right) - minRun : -1;
        if (slackL <= 0 && slackR <= 0) { grew = false; break; }
        if (slackL >= slackR) { left!.i1--; runs[m].i0--; } else { right!.i0++; runs[m].i1++; }
      }
      if (grew) continue;
      const left = m > 0 ? runs[m - 1] : null, right = m < runs.length - 1 ? runs[m + 1] : null;
      const into = !left ? right! : !right ? left
        : near(runs[m].c, left.c) !== near(runs[m].c, right.c)
          ? (near(runs[m].c, left.c) < near(runs[m].c, right.c) ? left : right)
          : (len(left) >= len(right) ? left : right);
      into.i0 = Math.min(into.i0, runs[m].i0);
      into.i1 = Math.max(into.i1, runs[m].i1);
      runs.splice(m, 1);
      join();
    }
    const out = new Array<number>(pts.length);
    for (const r of runs) for (let i = r.i0; i < r.i1; i++) out[i] = r.c;
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
