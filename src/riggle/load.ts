// Getting a riggle, with no network call and no key.
//
// Every token hash was read from the Riggles API once, at build time, into
// src/data/riggles.json. From the hash alone the vendored engine derives the
// traits and draws the art, exactly as the contracts do onchain, so the page
// needs nothing from a server: type a number and it builds.

import type { Curve } from '../squiggle/curve';
import RIGGLES from '../data/riggles.json';
import {
  parseHash, drawRiggle, typeLabel, spectrumLabel, spreadLabel, treatmentLabel, pathLabel,
  envelopeLabel, driftLabel, legendaryLabel, familyLabel, directionLabel, cycleLabel,
} from './engine.js';
import type { Traits } from './engine.js';
import { riggleCurve, type RiggleCurve } from './curve';
import { recordRiggle } from './pixels';

const TABLE = RIGGLES as unknown as {
  generatedAt: string; chainId: number; block: number;
  first: number; last: number; count: number;
  riggles: Record<string, { h: string; bg: number }>;
};

export const FIRST_ID = TABLE.first, LAST_ID = TABLE.last, SUPPLY = TABLE.count;
export const COLLECTED_AT = TABLE.generatedAt;

export class UnknownRiggle extends Error {
  constructor(public readonly id: number) {
    super(`There is no riggle #${id}. The collection runs from ${FIRST_ID} to ${LAST_ID}.`);
    this.name = 'UnknownRiggle';
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The riggle's traits, named as the collection names them. Derived here from
 * the hash by the same engine the chain runs, so they match what the API and
 * the marketplaces show without asking either.
 */
export function riggleFeatures(t: Traits, background: number): Record<string, string | number> {
  const f: Record<string, string | number> = {
    'Type': typeLabel(t),
    'Spectrum': spectrumLabel(t),
    'Color Spread': spreadLabel(t),
    'Color Family': familyLabel(t),
    'Color Direction': directionLabel(t),
    'Treatment': treatmentLabel(t),
    'Steps': t.steps,
    'Animation Path': pathLabel(t),
    'Color Cycle': cycleLabel(t),
    'Intensity': cap(t.intensity),
    'Envelope': envelopeLabel(t),
    'Baseline': driftLabel(t),
    'Background': background === 1 ? 'Volt' : 'Black',
  };
  if (t.legendary !== 'none') f['Legendary'] = legendaryLabel(t);
  return f;
}

/**
 * The riggle, drawn here, as a data URL. Nothing is fetched. Browser only,
 * since it needs a canvas; in Node it answers an empty string.
 *
 * `shape` picks the canvas. "wide" is the one the collection publishes,
 * 1800 x 1200, which is what a link preview or a social card should carry.
 * "square" is the riggle's own composition: the engine always draws it inside
 * a centred square, so a wide canvas only adds plain background at the sides,
 * and in a small panel beside the brick model that background reads as empty
 * margin. The drawing itself is identical either way.
 */
export function riggleImage(hash: string, background: number, width = 900, shape: 'wide' | 'square' | 'crop' = 'wide'): string {
  if (typeof document === 'undefined') return '';
  const t = parseHash(hash);
  if (shape !== 'crop') {
    const c = document.createElement('canvas');
    c.width = width; c.height = shape === 'square' ? width : Math.round((width * 2) / 3);
    drawRiggle(c.getContext('2d')!, t, c.width, c.height, { bg: background });
    return c.toDataURL();
  }
  // Cropped to what the engine actually paints. The riggle is composed inside a
  // square with a generous margin of its own, so in a small panel beside the
  // model most of the picture is empty field. The bounds come from the rectangles
  // the engine paints, not from the wave's own line, so a Pixelated riggle's
  // scattered cells and a Smoking one's vapour are inside them too.
  const S = 1400;
  const full = document.createElement('canvas');
  full.width = S; full.height = S;
  drawRiggle(full.getContext('2d')!, t, S, S, { bg: background });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of recordRiggle(t, S, S)) {
    if (o.w === S && o.h === S) continue;                 // the field itself
    x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y);
    x1 = Math.max(x1, o.x + o.w); y1 = Math.max(y1, o.y + o.h);
  }
  if (!Number.isFinite(x0)) return full.toDataURL();
  const pad = Math.round(S * 0.03);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(S, x1 + pad); y1 = Math.min(S, y1 + pad);
  const sw = Math.max(1, x1 - x0), sh = Math.max(1, y1 - y0);
  const out = document.createElement('canvas');
  out.width = width; out.height = Math.max(1, Math.round((width * sh) / sw));
  const x = out.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  x.drawImage(full, x0, y0, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL();
}

export interface LoadedRiggle {
  id: number;
  hash: string;
  features: Record<string, string | number>;
  curve: Curve & RiggleCurve;
  /** 0 black, 1 volt */
  background: 0 | 1;
  traits: Traits;
  notes: string[];
  /** how it got here, for the line under the picture. Always the one answer. */
  origin: 'engine';
  /** the riggle itself, drawn here, for the page, the booklet and the share picture */
  original: string;
  /** the Squiggle tool kept recorded circles here; a riggle needs none */
  source: null;
}

export const isRiggle = (id: number) => Object.prototype.hasOwnProperty.call(TABLE.riggles, String(id));

export function hashOfRiggle(id: number): string {
  const row = TABLE.riggles[String(id)];
  if (!row) throw new UnknownRiggle(id);
  return row.h;
}

/** Everything the page needs about one riggle. Synchronous: it is all local. */
export function loadRiggle(id: number): LoadedRiggle {
  const row = TABLE.riggles[String(id)];
  if (!row) throw new UnknownRiggle(id);
  const background = (row.bg === 1 ? 1 : 0) as 0 | 1;
  const curve = riggleCurve({ id, hash: row.h, background });
  return {
    id,
    hash: row.h,
    features: riggleFeatures(curve.traits, background),
    curve,
    background,
    traits: curve.traits,
    notes: [],
    origin: 'engine',
    original: riggleImage(row.h, background),
    source: null,
  };
}

/** A riggle nobody asked for, for the landing page. */
export const someRiggle = () => FIRST_ID + Math.floor(Math.random() * SUPPLY);
