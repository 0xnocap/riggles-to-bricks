// Building a riggle: the panels it is built on, and how wide its ribbon comes out.
//
// A Squiggle is always a long, thin curve, so the tool could cut one panel at
// 2:1 and give every Squiggle a 3 stud ribbon. Riggles are not like that. Their
// waves run from square to three times as wide as they are tall, and the stroke
// is set by the riggle's own step count and body, so a Thick riggle is many
// times chunkier than a dense Normal one. Two things follow:
//
//   - the panels are cut at 3:2, the shape the collection publishes, instead of
//     the Squiggle's 2:1, so a squarish riggle is not shrunk to fit a letterbox
//   - the ribbon width is worked out per riggle from how its stroke fits the
//     panel, instead of read off a table by body type
//
// The panels themselves are fixed: every riggle at a given size builds the same
// frame, so piece counts and cost stay predictable.

import { buildRelief } from '../squiggle/display';
import { buildMosaic } from '../squiggle/mosaic';
import type { Curve } from '../squiggle/curve';
import type { Display, Format, Scale, SqModel } from '../squiggle/model';
import { MX, MZ } from '../squiggle/ribbon';
import { riggleCurve, type RiggleCurve } from './curve';

/** Relief panel, studs. 3:2, and 0.8 cm a stud: 36 x 24 cm and 48 x 32 cm. */
export const RIGGLE_PANEL: Record<Scale, { w: number; h: number }> = {
  small: { w: 45, h: 30 },
  large: { w: 60, h: 40 },
};

/** Mosaic grid, studs. Also 3:2: 38.4 x 25.6 cm and 57.6 x 38.4 cm. */
export const RIGGLE_GRID: Record<Scale, [number, number]> = {
  small: [48, 32],
  large: [72, 48],
};

/** Narrowest ribbon worth building: below this the tiler is left making 1x1s. */
const MIN_WIDTH = 2;
/** Widest ribbon: past this a Thick riggle swallows its own gaps. */
const MAX_WIDTH = 16;

/**
 * How wide the ribbon comes out, in studs.
 *
 * buildRibbon fits the wave with k = min((W - 2MX - width)/bw, (H - 2MZ - width)/bh)
 * and we want width = stroke x k, so the two are solved together: the stroke
 * simply joins the bounding box in the denominator.
 */
export function ribbonWidthFor(curve: Curve, panel: { w: number; h: number }): number {
  const { x0, y0, x1, y1 } = curve.box;
  const bw = Math.max(x1 - x0, 1), bh = Math.max(y1 - y0, 1);
  const k = Math.min((panel.w - 2 * MX) / (bw + curve.stroke), (panel.h - 2 * MZ) / (bh + curve.stroke));
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(curve.stroke * k)));
}

export interface RiggleBuild {
  format: Format;
  display?: Display;
  scale: Scale;
  /** show the studs on top instead of a smooth tiled finish */
  studs?: boolean;
}

export interface BuiltRiggle { curve: RiggleCurve; model: SqModel; width: number }

/**
 * One model from a curve that is already in hand. This is the single place the
 * riggle fit is applied, so the page, the workers and the scripts all build the
 * same thing.
 */
export function buildRiggleModel(curve: Curve, meta: { id: number; hash: string }, opts: RiggleBuild): SqModel {
  if (opts.format === 'mosaic') return buildMosaic(curve, opts.scale, meta, RIGGLE_GRID[opts.scale], { square: true });
  const panel = RIGGLE_PANEL[opts.scale];
  return buildRelief(curve, opts.display ?? 'frame', opts.scale, meta, {
    studs: opts.studs, panel, width: ribbonWidthFor(curve, panel), square: true,
  });
}

export function buildRiggle(id: number, hash: string, opts: RiggleBuild): BuiltRiggle {
  const curve = riggleCurve({ id, hash });
  const model = buildRiggleModel(curve, { id, hash }, opts);
  return { curve, model, width: opts.format === 'mosaic' ? 0 : ribbonWidthFor(curve, RIGGLE_PANEL[opts.scale]) };
}
