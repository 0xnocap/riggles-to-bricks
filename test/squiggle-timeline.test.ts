import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readCurve } from '../src/squiggle/curve';
import { buildRelief } from '../src/squiggle/display';
import type { SqModel } from '../src/squiggle/model';
import { buildMosaic } from '../src/squiggle/mosaic';
import { makeTimeline, pieceState } from '../src/squiggle/timeline';

const fx = JSON.parse(readFileSync('test/fixtures/squiggles/1234.json', 'utf8')), curve = readCurve(fx), meta = { id: fx.id, hash: fx.hash };
const models: [string, SqModel][] = [
  ['frame', buildRelief(curve, 'frame', 'large', meta)],
  ['floating', buildRelief(curve, 'floating', 'small', meta)],
  ['backdrop', buildRelief(curve, 'backdrop', 'large', meta)],
  ['mosaic', buildMosaic(curve, 'small', meta)],
];

describe('build animation timeline', () => {
  for (const [name, m] of models) it(name, () => {
    const tl = makeTimeline(m), P = m.pieces, land = Array.from(tl.start, s => s + tl.drop);
    expect(tl.built).toBeGreaterThan(7.5);
    expect(tl.built).toBeLessThan(12.5);
    expect(tl.order.slice().sort((a, b) => a - b)).toEqual(P.map((_, i) => i));
    // the wall's backing (and the bricks behind it) is hung from the start; nothing else is in place at 0
    const hung = new Set(m.pose === 'wall' ? [...m.steps[0], ...P.flatMap((p, i) => (p.y < 0 ? [i] : []))] : []);
    P.forEach((_, i) => expect(pieceState(tl, i, 0).landed).toBe(hung.has(i)));
    P.forEach((_, i) => expect(pieceState(tl, i, tl.built + 1e-3)).toEqual({ visible: true, landed: true, off: 0, speed: 0 }));
    // steps in order: every piece of a step lands before any piece of the next one (a hung ribbon's steps are one sweep)
    const rib = (s: number[]) => m.pose === 'wall' && s.every(i => P[i].role === 'squiggle');
    const merged = m.steps.reduce<number[][]>((a, s, j) => (j && rib(s) && rib(m.steps[j - 1]) ? a.at(-1)!.push(...s) : a.push([...s]), a), []);
    const moving = merged.map(s => s.filter(i => !hung.has(i)).map(i => land[i])).filter(s => s.length);
    for (let s = 0; s + 1 < moving.length; s++) expect(Math.max(...moving[s])).toBeLessThan(Math.min(...moving[s + 1]));
    // no piece lands before the pieces under it
    for (const [i, p] of P.entries()) for (const [j, q] of P.entries())
      if (q.y + q.h === p.y && q.x < p.x + p.w && p.x < q.x + q.w && q.z < p.z + p.d && p.z < q.z + q.d) expect(land[j]).toBeLessThanOrEqual(land[i]);
    // on its way a piece comes from above (or the viewer's side), and slows down as it lands
    const k = P.findIndex((_, i) => !hung.has(i)), a = pieceState(tl, k, tl.start[k] + tl.drop * 0.2), b = pieceState(tl, k, tl.start[k] + tl.drop * 0.8);
    expect(a.off).toBeGreaterThan(b.off); expect(b.off).toBeGreaterThan(0); expect(a.speed).toBeGreaterThan(b.speed);
  });

  it('builds a hung ribbon as a sweep: its colour grows until the end', () => {
    const m = models[0][1], P = m.pieces, rib = P.flatMap((p, i) => (p.role === 'squiggle' ? [i] : [])), y0 = Math.min(...rib.map(i => P[i].y));
    const at = (tl: ReturnType<typeof makeTimeline>) => {
      const land = (i: number) => tl.start[i] + tl.drop, a = Math.min(...rib.map(i => tl.start[i])), b = Math.max(...rib.map(land));
      return (Math.max(...rib.filter(i => P[i].y === y0).map(land)) - a) / (b - a);
    };
    // the first layer covers the whole footprint late in the sweep, early layer by layer (the booklet's steps)
    const sweep = makeTimeline(m), layers = makeTimeline(m, { sweep: false });
    expect(at(sweep)).toBeGreaterThan(0.6);
    expect(at(layers)).toBeLessThan(0.35);
    expect(Math.abs(sweep.built - layers.built)).toBeLessThan(0.3);
    // from left to right: the ribbon's left half lands, on the whole, before its right half
    const xs = rib.map(i => P[i].x + P[i].w / 2), mid = (Math.min(...xs) + Math.max(...xs)) / 2, mean = (ids: number[]) => ids.reduce((a, i) => a + sweep.start[i], 0) / ids.length;
    expect(mean(rib.filter(i => P[i].x + P[i].w / 2 < mid))).toBeLessThan(mean(rib.filter(i => P[i].x + P[i].w / 2 >= mid)) - 2);
  });

  it('fits the asked build time', () => {
    const tl = makeTimeline(models[0][1], { build: 11.6 });
    expect(Math.abs(tl.built - 11.6)).toBeLessThan(0.6);
  });
});
