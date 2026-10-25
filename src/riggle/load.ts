// Getting a riggle, with no network call and no key.
//
// Every token hash was read from the Riggles API once, at build time, into
// src/data/riggles.json. From the hash alone the vendored engine derives the
// traits and draws the art, exactly as the contracts do onchain, so the page
// needs nothing from a server: type a number and it builds.

import type { Curve } from '../squiggle/curve';
import RIGGLES from '../data/riggles.json';
import {
  typeLabel, spectrumLabel, spreadLabel, treatmentLabel, pathLabel,
  envelopeLabel, driftLabel, legendaryLabel, familyLabel, directionLabel, cycleLabel,
} from './engine.js';
import type { Traits } from './engine.js';
import { riggleCurve, type RiggleCurve } from './curve';

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

export interface LoadedRiggle {
  id: number;
  hash: string;
  features: Record<string, string | number>;
  curve: Curve & RiggleCurve;
  /** 0 black, 1 volt */
  background: 0 | 1;
  traits: Traits;
  notes: string[];
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
  };
}

/** A riggle nobody asked for, for the landing page. */
export const someRiggle = () => FIRST_ID + Math.floor(Math.random() * SUPPLY);
