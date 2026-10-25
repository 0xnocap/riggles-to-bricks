// The Squiggle as geometry: its centre line in drawing order, the colour at
// every point, and what its variant adds (bold stroke, black pipe rings,
// ribs), read from the circles its own script draws.
import type { Dot } from './source';

export type SquiggleType = 'Normal' | 'Bold' | 'Ribbed' | 'Slinky' | 'Pipe' | 'Fuzzy';

export interface CurvePoint {
  x: number; y: number;      // canvas pixels, y down
  hue: number;               // 0..360
  rib?: boolean;             // Ribbed: a rib is drawn here
  end?: boolean;             // first or last point of a segment (drawn filled on Pipe and Slinky)
}

export interface Curve {
  id: number;
  /** the piece has no hue: lightness carries it, and `light` says how */
  greyscale?: boolean;
  /** lightness per point, 0 to 100, parallel to `points` */
  light?: number[];
  /** the piece's Intensity: a shade lighter, a shade darker, or as the spectrum is */
  tone?: 'pastel' | 'deep' | null;
  type: SquiggleType;
  spectrum: string;            // Art Blocks feature, e.g. "Normal", "HyperRainbow"
  canvas: { w: number; h: number };
  points: CurvePoint[];        // centre line, in drawing order (later points are drawn on top)
  stroke: number;              // diameter of the coloured stroke, pixels
  outline: number | null;      // Pipe: diameter of the black rings around it, pixels
  ribGray: number | null;      // Ribbed: grey level of the ribs, 0..255
  /** bounding box of the centre line (not the stroke), pixels */
  box: { x0: number; y0: number; x1: number; y1: number };
}

/** The fields of a token and its recorded circles that the curve needs (a fixture or a live render). */
export interface CurveSource {
  id: number;
  features: Record<string, string | number>;
  width: number; height: number;
  dots: Dot[] | [number, number, number, string | null, string | null][];
}

const parse = (css: string | null): [number, number, number] | null => {
  if (!css) return null;
  if (css[0] === '#') { const n = parseInt(css.slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b] = m[1].split(',').map(Number);
  return [r, g, b];
};
const isGray = (c: [number, number, number]) => c[0] === c[1] && c[1] === c[2];
export function hueOf([r, g, b]: [number, number, number]): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

export function readCurve(src: CurveSource): Curve {
  const dots: Dot[] = (src.dots as unknown[]).map((d, order) => Array.isArray(d)
    ? { x: d[0], y: d[1], d: d[2], fill: d[3], stroke: d[4], order }
    : d as Dot);
  const h = src.height;
  const type = String(src.features.Type ?? 'Normal') as SquiggleType;
  const points: CurvePoint[] = [];
  let outline: number | null = null, ribGray: number | null = null;

  if (type === 'Fuzzy') {
    // dots scattered below and right of the line (offsets 0..h/10): the line
    // is their running mean, shifted back by the mean offset
    const win = 40;
    for (let i = 0; i < dots.length; i += 4) {
      let sx = 0, sy = 0, n = 0;
      for (let j = Math.max(0, i - win); j < Math.min(dots.length, i + win); j++) { sx += dots[j].x; sy += dots[j].y; n++; }
      const c = parse(dots[i].fill)!;
      points.push({ x: sx / n - h / 20, y: sy / n - h / 20, hue: hueOf(c) });
    }
    return finish(src, type, points, h / 13 * 4 / 3, null, null);
  }

  // the coloured circles are the stroke; black (Pipe) and grey (ribs) ones are extras
  const sizes = new Map<number, number>();
  for (const d of dots) {
    const c = parse(d.fill) ?? parse(d.stroke);
    if (c && !isGray(c)) sizes.set(Math.round(d.d), (sizes.get(Math.round(d.d)) ?? 0) + 1);
  }
  const stroke = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  for (const d of dots) {
    const fill = parse(d.fill), line = parse(d.stroke), c = fill ?? line!;
    if (!isGray(c)) {
      const last = points[points.length - 1];
      // Pipe and Slinky fill the circle at the first and last step of each segment
      const end = !!fill && (type === 'Pipe' || type === 'Slinky');
      if (last && Math.abs(last.x - d.x) < 1e-6 && Math.abs(last.y - d.y) < 1e-6) { if (end) last.end = true; continue; }
      points.push({ x: d.x, y: d.y, hue: hueOf(c), ...(end ? { end } : {}) });
    } else if (type === 'Pipe') {
      outline = Math.max(outline ?? 0, d.d);
    } else if (type === 'Ribbed' && fill) {
      ribGray = fill[0];
      if (points.length) points[points.length - 1].rib = true;
    }
  }
  return finish(src, type, points, stroke, outline, ribGray);
}

function finish(src: CurveSource, type: SquiggleType, points: CurvePoint[], stroke: number, outline: number | null, ribGray: number | null): Curve {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return {
    id: src.id, type, spectrum: String(src.features.Spectrum ?? 'Normal'),
    canvas: { w: src.width, h: src.height }, points, stroke, outline, ribGray,
    box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
  };
}

/** cumulative length along the curve at each point, pixels */
export function arcLength(points: CurvePoint[]): number[] {
  const s = [0];
  for (let i = 1; i < points.length; i++) s.push(s[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  return s;
}
