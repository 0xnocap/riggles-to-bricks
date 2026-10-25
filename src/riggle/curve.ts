// A riggle as geometry: its square wave read straight out of the art engine,
// in the same shape the brick builders already consume.
//
// The engine draws a riggle by marching stamps along a polyline whose runs are
// exactly horizontal and whose risers are exactly vertical. buildGeom gives us
// that polyline; walking it at a fixed step and taking the engine's colour at
// each arc position produces the same centre line the Squiggle builders got
// from recorded circles. Everything downstream (ribbon, mosaic, displays,
// booklet, exports) keeps working unchanged.
//
// There is no network call here and no key: the hash comes from the baked
// collection file, the engine is vendored, and the art is redrawn in the
// visitor's browser.

import { parseHash, buildGeom, cumOf, typeLabel, spectrumLabel } from './engine.js';
import type { Traits, Geom } from './engine.js';
import type { Curve, CurvePoint, SquiggleType } from '../squiggle/curve';

/** Hue span constant, engine.js:8. The pixel test guards this against drift. */
const COLORSPAN = 7000;

/** One centre-line point every half pixel: dense enough that the mosaic's discs overlap. */
const STEP_PX = 0.5;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrap = (v: number) => ((v % 255) + 255) % 255;

export interface Ink { hue: number; light: number; grey: boolean }

/**
 * The colour the engine paints at arc parameter `tt` (0 at the start of the
 * wave, 1 at its end), transcribed from colorWith in engine.js:631 plus the
 * legendary overrides just below it. `L` is the engine's lightness channel,
 * which the treatments use for ribs and ring shading.
 */
export function inkOf(t: Traits): (tt: number, L?: number) => Ink {
  const startC = t.startColor % 255;
  const spanK = COLORSPAN / t.spreadEff;

  const base = (tt: number, sc: number, L?: number): Ink => {
    if (t.spectrum === 'grey') {
      const v = wrap(tt * spanK + sc);
      const lf = L == null ? 1 : L / 50;
      return { hue: 0, grey: true, light: clamp((38 + ((t.reverse ? 255 - v : v) / 255) * 54) * lf, 0, 100) };
    }
    let h = wrap(tt * spanK + sc);
    if (t.reverse) h = 255 - h;
    return { hue: (h / 255) * 360, grey: false, light: clamp((L == null ? 50 : L) * t.lightMul, 12, 88) };
  };

  // photo negative: complement hue, flipped lightness (greyscale flips value)
  const negate = (c: Ink): Ink => ({ ...c, hue: (c.hue + 180) % 360, light: clamp(100 - c.light, 8, 92) });

  if (t.legendary === 'duotone') return (tt, L) => base(tt < 0.5 ? 0.12 : 0.88, startC, L);
  if (t.legendary === 'inverted') return (tt, L) => negate(base(tt, startC, L));
  return (tt, L) => base(tt, startC, L);
}

/** The engine's own name for the body, mapped onto the builders' variants. */
export function variantOf(t: Traits): SquiggleType {
  if (t.slinky && t.pipe) return 'Pipe';
  if (t.slinky) return 'Slinky';
  if (t.fuzzy) return 'Fuzzy';
  if (t.bold) return 'Bold';
  if (t.ribbed) return 'Ribbed';
  return 'Normal';
}

/** Stroke and outline diameters in canvas pixels, matching how drawSpan stamps each body. */
function strokeOf(t: Traits, g: Geom): { stroke: number; outline: number | null } {
  if (t.slinky) {
    const coil = g.S * 1.5;
    return { stroke: coil, outline: t.pipe ? coil * 1.12 : null };
  }
  return { stroke: g.wS, outline: null };
}

/**
 * Which colour param the engine uses at a point on the wave.
 *
 * Only the plain body is faceted: it fills one rectangle per run or riser and
 * holds a single colour across it when the treatment is Hard Facet, nearly so
 * for Soft Facet (engine.js:535-537). Every textured body - the corrugated
 * coil, the accordion squares, pixelated, smoking - stamps along the line and
 * asks for the colour at its own arc position (engine.js:509, :518), so those
 * ramp continuously no matter what the treatment says.
 */
export function colourParam(t: Traits, cum: number[], waveLen: number): (arc: number, seg: number) => number {
  const stamped = t.slinky || (t.ribbed && !t.bold) || t.fuzzy || t.smoke;
  if (stamped || t.treatment === 'smooth') return (arc) => arc / waveLen;
  return (arc, seg) => {
    const rm = ((cum[seg] + cum[seg + 1]) / 2) / waveLen;
    return t.treatment === 'hard' ? rm : 0.72 * rm + 0.28 * arc / waveLen;
  };
}

/** The engine's lightness channel for the body, and for an accordion rib (engine.js:292, :521-522). */
export function bodyLightOf(t: Traits): number {
  return t.ribbed && !t.bold ? 46 : 50;
}
export const RIB_LIGHT = 72;

export interface RiggleCurve extends Curve {
  hash: string;
  traits: Traits;
  /** background the chain picked for this riggle: 0 black, 1 volt */
  background: 0 | 1;
  /** lightness per point, parallel to points, 0..100 (greyscale riggles live here) */
  light: number[];
}

/**
 * The canvas the collection publishes: 1800 x 1200, as the onchain renderer
 * draws it (RigglesRenderer.sol:392) and as riggles.xyz/i/<id>.png serves it.
 * The wave itself is composed in the centred 1200 square, so a wider canvas
 * only adds background at the sides. Measuring here keeps every coordinate in
 * step with the published art; the wave's shape does not depend on it.
 */
export const ART_CANVAS = { w: 1800, h: 1200 } as const;

export interface RiggleCurveOptions {
  id: number;
  hash: string;
  /** canvas the wave is measured on, defaulting to the published one */
  canvas?: { w: number; h: number };
  background?: 0 | 1;
}

export function riggleCurve({ id, hash, canvas = ART_CANVAS, background }: RiggleCurveOptions): RiggleCurve {
  const t = parseHash(hash);
  const g = buildGeom(t, canvas.w, canvas.h, true);
  const ink = inkOf(t);
  const { stroke, outline } = strokeOf(t, g);

  // absolute canvas coordinates
  const V = g.V.map((v) => ({ x: v.x + g.originX, y: v.y + g.offsetY }));
  const cum = cumOf(V);
  const waveLen = cum[cum.length - 1] || 1;

  // Accordion stamps squares every S/3.2 along the wave (engine.js:518); those
  // square edges are its ribs.
  const ribPitch = t.ribbed && !t.bold ? g.S / 3.2 : 0;
  let nextRib = ribPitch;

  const param = colourParam(t, cum, waveLen);
  const bodyL = bodyLightOf(t);

  const points: CurvePoint[] = [];
  const light: number[] = [];
  let seg = 0;

  for (let s = 0; s <= waveLen; s += STEP_PX) {
    while (seg + 2 < V.length && cum[seg + 1] < s) seg++;
    const a = V[seg], b = V[seg + 1];
    const span = Math.max(1e-6, cum[seg + 1] - cum[seg]);
    const u = clamp((s - cum[seg]) / span, 0, 1);
    const ribHere = !!ribPitch && s >= nextRib;
    const c = ink(param(s, seg), ribHere ? RIB_LIGHT : bodyL);
    const p: CurvePoint = {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      hue: c.hue,
    };
    if (ribHere) { p.rib = true; nextRib += ribPitch; }
    if (s === 0) p.end = true;
    points.push(p);
    light.push(c.light);
  }
  if (points.length) points[points.length - 1].end = true;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of V) {
    if (v.x < x0) x0 = v.x; if (v.x > x1) x1 = v.x;
    if (v.y < y0) y0 = v.y; if (v.y > y1) y1 = v.y;
  }

  return {
    id,
    hash,
    traits: t,
    background: (background ?? t.bgBit) as 0 | 1,
    type: variantOf(t),
    spectrum: spectrumLabel(t),
    canvas: { w: canvas.w, h: canvas.h },
    points,
    light,
    stroke,
    outline,
    ribGray: null,          // riggle ribs are a brighter step of the body colour, not grey
    box: { x0, y0, x1, y1 },
  };
}

/** The engine's full name for a body, for the UI ("Corrugated Pipe Riggle"). */
export const bodyName = (t: Traits) => typeLabel(t);
