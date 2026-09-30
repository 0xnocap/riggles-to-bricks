import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readCurve } from '../src/squiggle/curve';
import { hsbToRgb, portFeatures, portSquiggle } from '../src/squiggle/port';

const DIR = 'test/fixtures/squiggles';
const IDS = readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => +f.slice(0, -5)).sort((a, b) => a - b);
const fixture = (id: number) => JSON.parse(readFileSync(`${DIR}/${id}.json`, 'utf8'));

describe('port of the Squiggle script', () => {
  for (const id of IDS) it(`#${id}: same circles, order, sizes and colours as the recorded original`, () => {
    const fx = fixture(id), p = portSquiggle(fx.hash, fx.width);
    expect([p.width, p.height]).toEqual([fx.width, fx.height]);
    expect(p.dots.length).toBe(fx.dots.length);
    let far = 0, colours = 0;
    p.dots.forEach((d, i) => {
      const [x, y, dd, fill, stroke] = fx.dots[i];
      if (Math.abs(d.x - x) > 0.5 || Math.abs(d.y - y) > 0.5 || Math.abs(d.d - dd) > 0.5) far++;
      if (d.fill !== fill || d.stroke !== stroke) colours++;
    });
    expect(far).toBe(0);
    expect(colours).toBe(0);
    const f = portFeatures(fx.hash);
    for (const k of Object.keys(f)) expect(f[k], k).toBe(fx.features[k]);
    // the curve read from the port is the curve read from the recording
    const a = readCurve({ ...fx, dots: p.dots }), b = readCurve(fx);
    expect(a.points.length).toBe(b.points.length);
    expect(a.type).toBe(b.type);
    expect(Math.abs(a.stroke - b.stroke)).toBeLessThan(0.5);
  });

  it('HSB at 255 like p5', () => {
    expect(hsbToRgb(0, 255, 255)).toEqual([255, 0, 0]);
    expect(hsbToRgb(255, 255, 255)).toEqual([255, 0, 0]);
    expect(hsbToRgb(85, 255, 255)).toEqual([0, 255, 0]);
    expect(hsbToRgb(0, 0, 128)).toEqual([128, 128, 128]);
  });
});
