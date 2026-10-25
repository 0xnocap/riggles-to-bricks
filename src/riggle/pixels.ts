// Reading a Pixelated riggle's own pixels out of the engine.
//
// The Pixelated body does not draw a stroke at all. It dissolves the riggle
// into a constellation of grid-aligned cells, keeps or drops each one on noise
// seeded by the hash, and paints the survivors (engine.js, the t.fuzzy branch).
// Following the centre line instead gave back a solid ribbon, which is the one
// thing a Pixelated riggle is not.
//
// So the engine draws it and we watch: a stub 2D context records every cell it
// paints, and those cells become the brick picture. It is the real engine, so
// the pattern cannot drift from the art, and it needs no canvas, so it runs in
// a worker and in Node alike.
//
// This is a Mosaic treatment. A Relief cannot use it: the cells are deliberately
// disconnected, and a raised ribbon has to hold together. In a Mosaic every tile
// sits on a base plate, so the gaps are free.

import { drawRiggle } from './engine.js';
import type { Traits } from './engine.js';

export interface Pixel {
  /** centre of the cell, canvas pixels */
  x: number; y: number;
  /** cell side, canvas pixels */
  size: number;
  hue: number;
  light: number;
  grey: boolean;
}

export interface Op { x: number; y: number; w: number; h: number; css: string; stroke?: boolean }

const HSL = /hsl\(\s*([-\d.]+)\s*,\s*([\d.]+)%\s*,\s*([-\d.]+)%\s*\)/;

/** A 2D context that paints nothing and remembers every solid rectangle. */
function recorder(out: Op[]) {
  const noop = () => {};
  const grad = () => ({ _grad: true, addColorStop: noop });
  const ctx: Record<string, unknown> & { _fill: unknown; _stroke: unknown; _tx: number; _ty: number } = {
    _fill: null, _stroke: null, _tx: 0, _ty: 0,
    canvas: { width: 0, height: 0 },
    save: noop, restore: noop, beginPath: noop, closePath: noop, clip: noop, fill: noop, stroke: noop,
    moveTo: noop, lineTo: noop, arc: noop, ellipse: noop, rect: noop, quadraticCurveTo: noop,
    bezierCurveTo: noop, drawImage: noop, clearRect: noop, setTransform: noop, scale: noop, rotate: noop,
    fillText: noop, strokeText: noop,
    strokeRect(x: number, y: number, w: number, h: number) {
      // the Accordion's bright square edge lives here
      const css = ctx._stroke;
      if (typeof css === 'string') out.push({ x: x + ctx._tx, y: y + ctx._ty, w, h, css, stroke: true });
    },
    measureText: () => ({ width: 0 }),
    createLinearGradient: grad, createRadialGradient: grad, createPattern: () => null,
    translate(x: number, y: number) { ctx._tx += x; ctx._ty += y; },
    fillRect(x: number, y: number, w: number, h: number) {
      const css = ctx._fill;
      if (typeof css === 'string') out.push({ x: x + ctx._tx, y: y + ctx._ty, w, h, css });
    },
  };
  for (const k of ['lineWidth', 'lineJoin', 'lineCap', 'miterLimit', 'globalAlpha',
    'globalCompositeOperation', 'filter', 'shadowBlur', 'shadowColor', 'font', 'textAlign', 'textBaseline']) {
    Object.defineProperty(ctx, k, { get: () => '', set: noop });
  }
  Object.defineProperty(ctx, 'fillStyle', { get: () => ctx._fill, set: (v) => { ctx._fill = v; } });
  Object.defineProperty(ctx, 'strokeStyle', { get: () => ctx._stroke, set: (v) => { ctx._stroke = v; } });
  return ctx as unknown as CanvasRenderingContext2D;
}

/**
 * Every cell a Pixelated riggle paints, on a `w` by `h` canvas. Empty for any
 * other body. The charcoal mute the engine lays over each cell is skipped: the
 * bricks carry the colour underneath it.
 */
/** Every rectangle the real engine paints, in order, fills and outlines alike. */
export function recordRiggle(t: Traits, w: number, h: number): Op[] {
  const ops: Op[] = [];
  drawRiggle(recorder(ops), t, w, h, {});
  return ops;
}

export function rigglePixels(t: Traits, w: number, h: number): Pixel[] {
  if (!t.fuzzy) return [];
  const ops = recordRiggle(t, w, h).filter((o) => !o.stroke);
  const out: Pixel[] = [];
  for (const o of ops) {
    if (o.w === w && o.h === h) continue;              // the background field
    if (o.w !== o.h || o.w <= 0) continue;             // a cell is square
    const m = HSL.exec(o.css);
    if (!m) continue;                                  // the charcoal mute is rgba, and is skipped
    out.push({
      x: o.x + o.w / 2, y: o.y + o.h / 2, size: o.w,
      hue: ((+m[1] % 360) + 360) % 360,
      light: +m[3],
      grey: +m[2] === 0,
    });
  }
  return out;
}
