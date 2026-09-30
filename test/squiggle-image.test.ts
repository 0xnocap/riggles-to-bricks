import { readdirSync, readFileSync } from 'node:fs';
import * as jpeg from 'jpeg-js';
import { afterAll, describe, expect, it } from 'vitest';
import { readCurve, type Curve } from '../src/squiggle/curve';
import { buildRelief } from '../src/squiggle/display';
import { curveFromImage, type RGBAImage } from '../src/squiggle/fromImage';
import { buildMosaic } from '../src/squiggle/mosaic';
import { portLine, portSquiggle, squiggleParams } from '../src/squiggle/port';
import { SourceError, type Dot } from '../src/squiggle/source';

const DIR = 'test/fixtures/squiggles';
const IDS = readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => +f.slice(0, -5)).sort((a, b) => a - b);
const fixture = (id: number) => JSON.parse(readFileSync(`${DIR}/${id}.json`, 'utf8'));

/** the circles drawn like a canvas does (fill, then a hairline stroke), antialiased, on white (or `bg`) */
function rasterize(src: { width: number; height: number; dots: Dot[] | unknown[][] }, scale = 1, bg = 255): RGBAImage {
  const W = Math.round(src.width * scale), H = Math.round(src.height * scale), buf = new Float32Array(W * H * 3).fill(bg);
  const parse = (css: string | null) => {
    if (!css) return null;
    if (css[0] === '#') { const n = parseInt(css.slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255, 1]; }
    const v = css.match(/rgba?\(([^)]+)\)/)![1].split(',').map(Number);
    return [v[0], v[1], v[2], v[3] ?? 1];
  };
  const sw = (src.height / 1200) * scale;
  const paint = (i: number, c: number[], a: number) => { for (let k = 0; k < 3; k++) buf[i + k] += (c[k] - buf[i + k]) * a; };
  for (const d of src.dots) {
    const [x, y, dd, fill, stroke] = (Array.isArray(d) ? d : [(d as Dot).x, (d as Dot).y, (d as Dot).d, (d as Dot).fill, (d as Dot).stroke]) as [number, number, number, string | null, string | null];
    const cx = x * scale, cy = y * scale, R = (dd / 2) * scale, F = parse(fill), S = parse(stroke);
    for (let py = Math.max(0, Math.floor(cy - R - 2)); py <= Math.min(H - 1, Math.ceil(cy + R + 2)); py++)
      for (let px = Math.max(0, Math.floor(cx - R - 2)); px <= Math.min(W - 1, Math.ceil(cx + R + 2)); px++) {
        const dist = Math.hypot(px + 0.5 - cx, py + 0.5 - cy), i = (py * W + px) * 3;
        if (F && dist < R + 0.5) paint(i, F, Math.min(1, R + 0.5 - dist) * F[3]);
        if (S && Math.abs(dist - R) < sw / 2 + 0.5) paint(i, S, Math.min(sw, sw / 2 + 0.5 - Math.abs(dist - R)) * S[3]);
      }
  }
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data.set([buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]], i * 4); data[i * 4 + 3] = 255; }
  return { width: W, height: H, data };
}

/** `pic` at (x, y) on a page of colour `bg`, with bits of interface under it: text lines (`ink`), a blue button */
function onPage(pic: RGBAImage, W: number, H: number, x: number, y: number, bg: number[], ink = [20, 20, 20]): RGBAImage {
  const data = new Uint8ClampedArray(W * H * 4);
  const rect = (x0: number, y0: number, w: number, h: number, c: number[]) => {
    for (let Y = Math.max(0, y0); Y < Math.min(H, y0 + h); Y++) for (let X = Math.max(0, x0); X < Math.min(W, x0 + w); X++) data.set([c[0], c[1], c[2], 255], (Y * W + X) * 4);
  };
  rect(0, 0, W, H, bg);
  for (let r = 0; r < pic.height; r++) data.set(pic.data.subarray(r * pic.width * 4, (r + 1) * pic.width * 4), ((y + r) * W + x) * 4);
  const below = y + pic.height + 30;
  rect(x, below, Math.round(pic.width * 0.6), 28, ink); rect(x, below + 50, Math.round(pic.width * 0.4), 20, ink); rect(x, below + 100, pic.width, 60, [37, 99, 235]);
  return { width: W, height: H, data };
}

/** mean distance from the points of `a` to the polyline `b`, both ways, the worse */
function lineDistance(a: { x: number; y: number }[], b: { x: number; y: number }[]): number {
  const one = (p: typeof a, q: typeof b) => {
    let s = 0, n = 0;
    for (let i = 0; i < p.length; i += 7, n++) {
      let best = Infinity;
      for (let j = 0; j + 1 < q.length; j++) {
        const dx = q[j + 1].x - q[j].x, dy = q[j + 1].y - q[j].y, L = dx * dx + dy * dy;
        const t = L ? Math.max(0, Math.min(1, ((p[i].x - q[j].x) * dx + (p[i].y - q[j].y) * dy) / L)) : 0;
        best = Math.min(best, Math.hypot(q[j].x + t * dx - p[i].x, q[j].y + t * dy - p[i].y));
      }
      s += best;
    }
    return s / n;
  };
  return Math.max(one(a, b), one(b, a));
}

const summary: string[] = [];
afterAll(() => { if (summary.length) console.log(`picture → curve: id, type (read), spans (true), mean distance / stroke, hue fit, ms\n${summary.join('\n')}`); });
const traced = new Map<number, Curve>();

describe('curve from a picture', () => {
  for (const id of IDS) {
    const fx = fixture(id), normal = fx.features.Spectrum === 'Normal';
    it(`#${id} ${fx.features.Type}/${fx.features.Spectrum}: the line${normal ? ', its type and span count' : ''}`, () => {
      const img = rasterize(fx), t0 = performance.now(), r = curveFromImage(img, { id }), ms = performance.now() - t0;
      const truth = readCurve(fx), S = squiggleParams(fx.hash), spans = Math.ceil(S.segments - 2);
      const d = lineDistance(portLine(fx.hash, fx.width), r.curve.points) / truth.stroke;
      summary.push(`#${id}\t${r.curve.type} (${fx.features.Type})\t${r.fit.spans} (${spans})\t${d.toFixed(3)}\t${r.fit.hueFit.toFixed(2)}\t${Math.round(ms)}`);
      traced.set(id, r.curve);
      expect(r.curve.points.length).toBeGreaterThan(500);
      expect(r.curve.canvas).toEqual({ w: 1200, h: 800 });
      expect(r.notes.join(' ')).toMatch(/approximate/);
      // every Squiggle's line is found; for the Normal spectrum ones, closely
      expect(d).toBeLessThan(normal ? 0.6 : 1);
      if (normal) {
        expect(d).toBeLessThan(fx.features.Type === 'Fuzzy' ? 0.35 : 0.15);
        expect(r.curve.type).toBe(fx.features.Type);
        if (fx.features.Type !== 'Fuzzy') expect(r.fit.spans).toBe(spans);
        // colours: the script's hue ramp, found again (Fuzzy's cloud blends a few spans of it)
        if (fx.features.Type !== 'Fuzzy') expect(r.fit.hueFit).toBeGreaterThan(0.8);
        let dh = 0;
        for (let i = 0; i < truth.points.length; i += 50) {
          const q = truth.points[i], p = r.curve.points[Math.round((i / truth.points.length) * r.curve.points.length)];
          const e = Math.abs(p.hue - q.hue); dh += Math.min(e, 360 - e);
        }
        expect(dh / Math.ceil(truth.points.length / 50)).toBeLessThan(fx.features.Type === 'Fuzzy' ? 60 : 20);
      }
    }, 30000);
  }

  it('HyperRainbow: the script’s hue step by step, its phase from the end dot, and a note that says what is approximate', () => {
    // Pipe (its rings show the dots before theirs: 23° off before), Ribbed (ribs wider than the dots)
    for (const id of [3784, 2483, 255]) {
      const fx = fixture(id), r = curveFromImage(rasterize(fx), { id }), truth = readCurve(fx);
      expect(r.features.Spectrum).toBe('HyperRainbow');
      expect(r.curve.points.length).toBe(truth.points.length);
      const dh = truth.points.map((q, i) => { const e = Math.abs(r.curve.points[i].hue - q.hue) % 360; return Math.min(e, 360 - e); }).sort((a, b) => a - b);
      expect(dh[dh.length >> 1], `#${id} median hue error`).toBeLessThan(5);
      expect(r.notes[0]).toMatch(/HyperRainbow colours come in the same order, but where each one falls along the line is approximate/);
    }
    // a Bold one whose colours can't be told apart along its wide stroke: said so
    expect(curveFromImage(rasterize(fixture(442)), { id: 442 }).notes[0]).toMatch(/colours could only be read roughly/);
  }, 30000);

  it('reads a smaller picture, a JPEG-like blur and a crop', () => {
    const fx = fixture(7583), line = portLine(fx.hash, 1200), stroke = readCurve(fx).stroke;
    // 600 × 400
    const small = curveFromImage(rasterize(fx, 0.5));
    expect(small.curve.type).toBe('Normal');
    expect(lineDistance(line, small.curve.points) / stroke).toBeLessThan(0.15);
    // cropped to its middle (not the whole canvas any more): same shape, placed on a canvas of its own
    const big = rasterize(portSquiggle(fx.hash, 1500)), [cw, ch, ox, oy] = [1300, 760, 100, 120];
    const data = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) data.set(big.data.subarray(((y + oy) * big.width + ox) * 4, ((y + oy) * big.width + ox + cw) * 4), y * cw * 4);
    const crop = curveFromImage({ width: cw, height: ch, data });
    expect(crop.fit.anchored).toBe(false);
    expect(crop.fit.spans).toBe(Math.ceil(squiggleParams(fx.hash).segments - 2));
    expect(crop.curve.type).toBe('Normal');
    // stroke at its true proportion: the canvas it was put on is the original's, give or take 5%
    const k = (crop.curve.box.x1 - crop.curve.box.x0) / (line[line.length - 1].x - line[0].x);
    expect(Math.abs(k - 1)).toBeLessThan(0.05);
  }, 30000);

  it('a screenshot: the Squiggle’s own picture is cut out of the page, then read as the whole canvas', () => {
    const fx = fixture(1234), line = portLine(fx.hash, 1200), stroke = readCurve(fx).stroke, spans = Math.ceil(squiggleParams(fx.hash).segments - 2);
    // on a grey page, on a black page (dark mode), and the Squiggle on black (its space-bar look) on a white page
    for (const [pic, bg, ink] of [[rasterize(fx), [212, 211, 215], [20, 20, 20]], [rasterize(fx), [0, 0, 0], [240, 240, 240]], [rasterize(fx, 1, 0), [255, 255, 255], [20, 20, 20]]]) {
      const r = curveFromImage(onPage(pic as RGBAImage, 1400, 1300, 110, 170, bg as number[], ink as number[]));
      expect(r.crop).toEqual([110, 170, 1200, 800]);
      expect(r.fit.anchored).toBe(true);
      expect([r.curve.type, r.fit.spans]).toEqual(['Normal', spans]);
      expect(lineDistance(line, r.curve.points) / stroke).toBeLessThan(0.1);
      expect(r.notes.join(' ')).toMatch(/cut out/);
    }
  }, 30000);

  it('a small JPEG on a grey ground: cut out, and read again past the JPEG halo', () => {
    for (const id of [1234, 102]) {
      const fx = fixture(id), line = portLine(fx.hash, 1200), stroke = readCurve(fx).stroke;
      const j = jpeg.decode(jpeg.encode(onPage(rasterize(fx, 640 / 1200), 900, 800, 130, 140, [154, 154, 154]), 65).data, { useTArray: true });
      const r = curveFromImage({ width: j.width, height: j.height, data: j.data });
      expect(r.crop).toEqual([130, 140, 640, 427]);
      expect(r.fit.anchored).toBe(true);
      expect([r.curve.type, r.fit.spans]).toEqual([fx.features.Type, Math.ceil(squiggleParams(fx.hash).segments - 2)]);
      expect(lineDistance(line, r.curve.points) / stroke).toBeLessThan(0.15);
    }
  }, 30000);

  it('says so when there is no Squiggle', () => {
    const blank: RGBAImage = { width: 300, height: 200, data: new Uint8ClampedArray(300 * 200 * 4).fill(255) };
    expect(() => curveFromImage(blank)).toThrow(SourceError);
    expect(() => curveFromImage({ width: 20, height: 20, data: new Uint8ClampedArray(1600) })).toThrow(SourceError);
    // a colourful picture with no plain background (a gradient under coloured tiles), alone or on a page
    const W = 900, H = 600, data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const tile = (x % 90 < 50 && (y + x) % 120 < 60) ? [(x * 7) % 256, (y * 5) % 256, 255 - ((x + y) % 256)] : [255 - x / 4, 90 + y / 5, x / 4];
      data.set([...tile, 255], (y * W + x) * 4);
    }
    const junk: RGBAImage = { width: W, height: H, data };
    expect(() => curveFromImage(junk)).toThrow(/couldn’t find a Squiggle/);
    expect(() => curveFromImage(onPage(junk, 1300, 1000, 200, 150, [255, 255, 255]))).toThrow(/couldn’t find a Squiggle/);
    // pictures in pictures in pictures: too deep, ask for a crop
    let nest = rasterize(fixture(1234), 0.5);
    for (const g of [210, 160, 100]) nest = onPage(nest, Math.round(nest.width * 1.3), Math.round(nest.height * 1.6), Math.round(nest.width * 0.15), Math.round(nest.height * 0.1), [g, g, g], [g - 60, g - 60, g - 60]);
    expect(() => curveFromImage(nest)).toThrow(/Crop your picture/);
  }, 30000);

  it('takes a Bold Squiggle cropped tight to its stroke', () => {
    const fx = fixture(8016), img = rasterize(fx);
    let x0 = img.width, y0 = img.height, x1 = 0, y1 = 0;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.data[(y * img.width + x) * 4 + 2] < 250 || img.data[(y * img.width + x) * 4] < 250) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const w = x1 - x0 + 5, h = y1 - y0 + 5, data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let r = 0; r < h - 4; r++) data.set(img.data.subarray(((y0 + r) * img.width + x0) * 4, ((y0 + r) * img.width + x1 + 1) * 4), ((r + 2) * w + 2) * 4);
    const r = curveFromImage({ width: w, height: h, data });
    expect(r.curve.type).toBe('Bold');
    expect(r.crop).toBeUndefined();
  }, 30000);
});

describe('models from a traced curve', () => {
  // one of each type: the ribbon (Frame) and the Mosaic built on it pass their checks
  for (const id of [1234, 102, 10, 1000, 1047, 1004]) it(`#${id}: Frame and Mosaic, large`, () => {
    const fx = fixture(id), curve = traced.get(id) ?? curveFromImage(rasterize(fx), { id }).curve, meta = { id, hash: fx.hash };
    for (const m of [buildRelief(curve, 'frame', 'large', meta), buildMosaic(curve, 'large', meta)]) {
      const c = m.checks;
      expect(c.collisions, `${m.format} collisions`).toBe(0);
      expect(c.floating, `${m.format} floating`).toBe(0);
      if (m.format === 'relief') expect(c.twoStud).toBe(0);
      expect(c.rules.filter(r => !r.ok).map(r => r.name)).toEqual([]);
      expect(new Set(m.steps.flat()).size).toBe(m.pieces.length);
    }
  }, 30000);
});
