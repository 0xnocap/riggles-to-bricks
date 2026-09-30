// The Chromie Squiggle script, ported to TypeScript: from the token hash, the
// same circles in the same order, sizes and colours as the original p5.js 1.0.0
// sketch (curvePoint, map, HSB at 255, the xorshift rnd() of Fuzzy). Used when
// the token is known but the generator or p5 can't run. No DOM: runs in Node.
import type { Dot } from './source';
import type { SquiggleType } from './curve';

export interface SquiggleParams {
  type: SquiggleType;
  segments: number;          // real, 12..20 (the loop draws ceil(segments − 2) spans)
  ht: number;                // amplitude divisor, 3..4
  spread: number;            // hue step divisor (0.5 = HyperRainbow)
  startColor: number;
  reverse: boolean;
  steps: number;             // circles per span − 1 (Slinky/Pipe 50, Fuzzy 1000, else 200)
  div: number;               // Ribbed: a rib every `div` steps
  ribGray: number;
}

const pairs = (hash: string) => Array.from({ length: 32 }, (_, j) => parseInt(hash.slice(2 + j * 2, 4 + j * 2), 16));
const map = (n: number, a1: number, b1: number, a2: number, b2: number) => (n - a1) / (b1 - a1) * (b2 - a2) + a2;
const curvePoint = (a: number, b: number, c: number, d: number, t: number) => {
  const t3 = t * t * t, t2 = t * t;
  return a * (-0.5 * t3 + t2 - 0.5 * t) + b * (1.5 * t3 - 2.5 * t2 + 1.0) + c * (-1.5 * t3 + 2.0 * t2 + 0.5 * t) + d * (0.5 * t3 - 0.5 * t2);
};

export function squiggleParams(hash: string): SquiggleParams {
  const p = pairs(hash);
  const slinky = p[31] < 35, pipe = p[22] < 32, bold = p[23] < 15, segmented = p[24] < 30, fuzzy = pipe && !slinky;
  const type: SquiggleType = fuzzy ? 'Fuzzy' : slinky ? (pipe ? 'Pipe' : 'Slinky') : bold ? 'Bold' : segmented ? 'Ribbed' : 'Normal';
  return {
    type, segments: map(p[26], 0, 255, 12, 20), ht: map(p[27], 0, 255, 3, 4),
    spread: p[28] < 3 ? 0.5 : map(p[28], 0, 255, 5, 50), startColor: p[29], reverse: p[30] < 128,
    steps: slinky ? 50 : fuzzy ? 1000 : 200, div: Math.floor(map(Math.round(p[24]), 0, 230, 3, 20)), ribGray: p[25],
  };
}

/** p5's HSB (all at 255) to 8-bit RGB, rounding as p5.Color does */
export function hsbToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = (x: number) => Math.min(1, Math.max(0, x / 255));
  const hue = c(h) * 6, sat = c(s), val = c(v);
  let rgb: number[];
  if (sat === 0) rgb = [val, val, val];
  else {
    const sector = Math.floor(hue), t1 = val * (1 - sat), t2 = val * (1 - sat * (hue - sector)), t3 = val * (1 - sat * (1 + sector - hue));
    rgb = sector === 1 ? [t2, val, t1] : sector === 2 ? [t1, val, t3] : sector === 3 ? [t1, t2, val]
      : sector === 4 ? [t3, t1, val] : sector === 5 ? [val, t1, t2] : [val, t3, t1];
  }
  return rgb.map(x => Math.round(x * 255)) as [number, number, number];
}

/** how a canvas reads back a colour: #rrggbb when opaque, else rgba(r, g, b, a) with a short alpha */
function css([r, g, b]: number[], alpha = 255): string {
  if (alpha >= 255) return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  let a = Math.round(alpha / 255 * 100) / 100;
  if (Math.round(a * 255) !== alpha) a = Math.round(alpha / 255 * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Every circle the original script draws for this hash on a `width` × 2/3 canvas, in drawing order. */
export function portSquiggle(hash: string, width = 1200): { width: number; height: number; dots: Dot[] } {
  const P = pairs(hash), S = squiggleParams(hash), height = (width * 2) / 3;
  const { steps, spread, startColor, reverse, type } = S;
  const wt = 2, amp = 1, index = 0, ox = width / 2 - width / wt / 2, oy = height / 2;
  const fuzzy = type === 'Fuzzy', slinky = type === 'Slinky' || type === 'Pipe', pipe = type === 'Pipe';
  const ribs = type === 'Ribbed', d0 = type === 'Bold' ? height / 5 : height / 13;
  const seed0 = parseInt(hash.slice(0, 16), 16);
  let seed = seed0;
  const rnd = () => {
    seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
    return (((seed < 0) ? ~seed + 1 : seed) % 1000) / 1000;
  };
  const dots: Dot[] = [];
  const push = (x: number, y: number, d: number, fill: string | null, stroke: string | null) => dots.push({ x: x + ox, y: y + oy, d, fill, stroke, order: dots.length });
  const Y = (j: number) => map(P[j], 0, 255, -height / S.ht, height / S.ht) * amp;
  const black = css([0, 0, 0]), gray = css([S.ribGray, S.ribGray, S.ribGray]);
  let color = 0;
  for (let j = 0; j < S.segments - 2; j++) {
    const u = width / S.segments / wt;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = curvePoint(u * j, u * (j + 1), u * (j + 2), u * (j + 3), t);
      const y = curvePoint(Y(j), Y(j + 1), Y(j + 2), Y(j + 3), t);
      const hue = reverse ? 255 - (((color / spread) + startColor + index) % 255) : (((color / spread) + startColor) + index) % 255;
      const rgb = hsbToRgb(hue, 255, 255), end = i === 0 || i === steps - 1;
      if (fuzzy) {
        const fx = x + map(rnd(), 0, 1, 0, height / 10), fy = y + map(rnd(), 0, 1, 0, height / 10);
        if (Math.hypot(fx - x, fy - y) < height / 11.5) push(fx, fy, map(rnd(), 0, 1, height / 160, height / 16), css(rgb, 20), null);
      } else {
        if (pipe) push(x, y, height / 7, end ? black : null, black);
        if (slinky) push(x, y, d0, end ? css(rgb) : null, css(rgb));
        else push(x, y, d0, css(rgb), null);
        if (ribs && (i % S.div === 0 || end)) push(x, y, height / 12, gray, null);
      }
      color++;
    }
    seed = seed0;
  }
  return { width, height, dots };
}

/** The script's centre line itself (before Fuzzy scatters its dots), one point per step, canvas pixels. */
export function portLine(hash: string, width = 1200): { x: number; y: number }[] {
  const P = pairs(hash), S = squiggleParams(hash), height = (width * 2) / 3, u = width / S.segments / 2, out: { x: number; y: number }[] = [];
  const Y = (j: number) => map(P[j], 0, 255, -height / S.ht, height / S.ht);
  for (let j = 0; j < S.segments - 2; j++) for (let i = j ? 1 : 0; i <= S.steps; i++) {
    const t = i / S.steps;
    out.push({ x: width / 4 + curvePoint(u * j, u * (j + 1), u * (j + 2), u * (j + 3), t), y: height / 2 + curvePoint(Y(j), Y(j + 1), Y(j + 2), Y(j + 3), t) });
  }
  return out;
}

/** The Art Blocks features the hash decides on its own (Spectrum only when it is HyperRainbow). */
export function portFeatures(hash: string): Record<string, string | number> {
  const S = squiggleParams(hash);
  return {
    Type: S.type, Height: Math.floor(S.ht), Segments: Math.floor(S.segments), ...(S.spread === 0.5 ? { Spectrum: 'HyperRainbow' } : {}),
    'Start Color': S.startColor, 'Color Spread': S.spread === 0.5 ? 0.5 : Math.floor(S.spread), 'Steps Between': S.steps,
    'Color Direction': S.reverse ? 'Reverse' : 'Forward',
  };
}

/** Draw circles like p5 does (fill, then a hairline stroke) on a 2D context of the canvas size. */
export function drawDots(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, r: { width: number; height: number; dots: Dot[] }, background = '#fff') {
  ctx.fillStyle = background; ctx.fillRect(0, 0, r.width, r.height);
  ctx.lineWidth = r.height / 1200;
  for (const d of r.dots) {
    ctx.beginPath(); ctx.arc(d.x, d.y, d.d / 2, 0, Math.PI * 2);
    if (d.fill) { ctx.fillStyle = d.fill; ctx.fill(); }
    if (d.stroke) { ctx.strokeStyle = d.stroke; ctx.stroke(); }
  }
}
