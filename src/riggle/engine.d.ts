// Types for the vendored riggles art engine (engine.js). The engine itself is
// plain JavaScript, published as it runs onchain; this file describes only the
// parts the brick builder uses.

export interface Vertex { x: number; y: number }

/** Everything the 32 byte token hash decides. */
export interface Traits {
  D: number[];
  steps: number; ht: number; hyper: boolean; spread: number;
  startColor: number; reverse: boolean;
  bold: boolean; pipe: boolean; slinky: boolean; ribbed: boolean; ribDiv: number;
  dotCol: number; fuzzy: boolean; smoke: boolean;
  spectrum: 'full' | 'narrow' | 'mono' | 'grey';
  treatment: 'smooth' | 'soft' | 'hard';
  path: 'LR' | 'RL' | 'TB' | 'BT' | 'orbit';
  envelope: 'even' | 'cresc' | 'dim' | 'bulge' | 'pinch';
  drift: number; fillDial: number;
  legendary: 'inverted' | 'outline' | 'duotone' | 'none';
  intensity: string; satPct: number; lightMul: number;
  spreadEff: number; wheels: number;
  voltOk: boolean; bgBit: 0 | 1;
}

/**
 * The square wave itself. `V` is the centre line in drawing order, in local
 * pixels: add `originX` and `offsetY` for canvas coordinates. Runs are exactly
 * horizontal and risers exactly vertical, every vertex an integer.
 * `S` is the stamp size, `wS` the stroke width.
 */
export interface Geom { V: Vertex[]; S: number; wS: number; originX: number; offsetY: number }

export const PALETTE: [string, string];

export function parseHash(hash: string): Traits;
export function buildGeom(t: Traits, W: number, H: number, circleSafe?: boolean): Geom;
export function cumOf(pts: Vertex[]): number[];
export function drawRiggle(ctx: CanvasRenderingContext2D, t: Traits, W: number, H: number, opts?: Record<string, unknown>): void;
export function renderRiggle(canvas: HTMLCanvasElement, hash: string, bg: number | string, size: number): void;

export function typeLabel(t: Traits): string;
export function spectrumLabel(t: Traits): string;
export function spreadLabel(t: Traits): string;
export function treatmentLabel(t: Traits): string;
export function pathLabel(t: Traits): string;
export function envelopeLabel(t: Traits): string;
export function driftLabel(t: Traits): string;
export function legendaryLabel(t: Traits): string;
export function familyLabel(t: Traits): string;
export function directionLabel(t: Traits): string;
export function cycleLabel(t: Traits): string;
