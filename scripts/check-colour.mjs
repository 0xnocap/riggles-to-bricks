// Checks the centre line's colours against the art engine itself.
//
// The engine is driven with a stub 2D context that records every stamp and
// gradient it paints, then each painted sample is matched to its place on the
// wave and compared with what src/riggle/curve.ts says the colour there is.
// No canvas, no network: it runs anywhere Node does.
//
//   npm run check:colour            every riggle
//   npm run check:colour -- 1 2 3   just these
//
// Pixelated and Smoking bodies vary each stamp by design, so they are reported
// but not expected to match a single centre line colour.

// Drives the real engine with a stub 2D context, captures every stamp it paints,
// and compares the colours against the adapter's transcription.
import { parseHash, buildGeom, cumOf, drawRiggle, typeLabel } from '../src/riggle/engine.js';
import { inkOf, colourParam, bodyLightOf, RIB_LIGHT } from '../src/riggle/curve.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(readFileSync(join(HERE, '..', 'src', 'data', 'riggles.json'), 'utf8'));
const parseHsl = (css) => {
  const m = /hsl\(([-\d.]+),\s*([\d.]+)%,\s*([-\d.]+)%\)/.exec(css);
  return m ? { hue: ((+m[1] % 360) + 360) % 360, sat: +m[2], light: +m[3] } : null;
};

function stubCtx(sink) {
  const noop = () => {};
  const ctx = {
    canvas: { width: 0, height: 0 },
    _fill: null, _stroke: null, _tx: 0, _ty: 0,
    save: noop, restore: noop, beginPath: noop, closePath: noop, clip: noop,
    moveTo: noop, lineTo: noop, arc: noop, ellipse: noop, rect: noop, quadraticCurveTo: noop,
    bezierCurveTo: noop, drawImage: noop, clearRect: noop, setTransform: noop, scale: noop,
    rotate: noop, measureText: () => ({ width: 0 }), fillText: noop, strokeText: noop,
    createLinearGradient(x0, y0, x1, y1) {
      const gr = { _grad: true, x0: x0 + ctx._tx, y0: y0 + ctx._ty, x1: x1 + ctx._tx, y1: y1 + ctx._ty, stops: [] };
      gr.addColorStop = (o, css) => gr.stops.push({ o, css });
      return gr;
    },
    createRadialGradient: () => { const gr = { _grad: true, radial: true, stops: [] }; gr.addColorStop = (o, css) => gr.stops.push({ o, css }); return gr; },
    translate(x, y) { this._tx += x; this._ty += y; },
    fill() { if (this._fill && this._fill._grad) sink.push({ kind: 'grad', grad: this._fill }); },
    stroke() {},
    fillRect(x, y, w, h) {
      if (this._fill && this._fill._grad) sink.push({ kind: 'grad', grad: this._fill, x: x + this._tx, y: y + this._ty, w, h });
      else sink.push({ kind: 'fill', x: x + this._tx, y: y + this._ty, w, h, css: this._fill });
    },
    strokeRect(x, y, w, h) { sink.push({ kind: 'stroke', x: x + this._tx, y: y + this._ty, w, h, css: this._stroke }); },
  };
  Object.defineProperty(ctx, 'fillStyle', { get() { return this._fill; }, set(v) { this._fill = v; } });
  Object.defineProperty(ctx, 'strokeStyle', { get() { return this._stroke; }, set(v) { this._stroke = v; } });
  Object.defineProperty(ctx, 'lineWidth', { get() { return 1; }, set() {} });
  Object.defineProperty(ctx, 'lineJoin', { get() { return 'miter'; }, set() {} });
  Object.defineProperty(ctx, 'lineCap', { get() { return 'butt'; }, set() {} });
  Object.defineProperty(ctx, 'miterLimit', { get() { return 8; }, set() {} });
  Object.defineProperty(ctx, 'globalAlpha', { get() { return 1; }, set() {} });
  Object.defineProperty(ctx, 'globalCompositeOperation', { get() { return 'source-over'; }, set() {} });
  Object.defineProperty(ctx, 'filter', { get() { return 'none'; }, set() {} });
  Object.defineProperty(ctx, 'shadowBlur', { get() { return 0; }, set() {} });
  Object.defineProperty(ctx, 'shadowColor', { get() { return ''; }, set() {} });
  Object.defineProperty(ctx, 'font', { get() { return ''; }, set() {} });
  Object.defineProperty(ctx, 'textAlign', { get() { return 'left'; }, set() {} });
  Object.defineProperty(ctx, 'textBaseline', { get() { return 'top'; }, set() {} });
  return ctx;
}

const SIZE = 1200;
const argv = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const ids = argv.length ? argv : Object.keys(DATA.riggles).map(Number);
const byFamily = {};
let worstAll = 0;

for (const id of ids) {
  const hash = DATA.riggles[id].h;
  const t = parseHash(hash);
  const g = buildGeom(t, SIZE, SIZE, true);
  const V = g.V.map((v) => ({ x: v.x + g.originX, y: v.y + g.offsetY }));
  const cum = cumOf(V);
  const waveLen = cum[cum.length - 1] || 1;
  const ink = inkOf(t);
  const param = colourParam(t, cum, waveLen);
  const bodyL = bodyLightOf(t);

  const stamps = [];
  drawRiggle(stubCtx(stamps), t, SIZE, SIZE, {});
  // first fillRect is the background field
  // Every painted sample, tied to the segment it belongs to.
  //  - solid stamps (accordion squares, coil outlines): nearest point on the line
  //  - gradient fills: the gradient is built on the segment's own endpoints
  //    (engine.js:540), so stop 0 is that segment's start and stop 1 its end
  const nearSeg = (x, y) => {
    let best = Infinity, k0 = -1, arc = 0;
    for (let k = 0; k + 1 < V.length; k++) {
      const a = V[k], b = V[k + 1];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), L2 = len * len || 1;
      let u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L2));
      const d = Math.hypot(x - (a.x + dx * u), y - (a.y + dy * u));
      if (d < best) { best = d; k0 = k; arc = cum[k] + len * u; }
    }
    return { d: best, seg: k0, arc };
  };
  const segOfGradient = (gr) => {
    for (let k = 0; k + 1 < V.length; k++) {
      if (Math.hypot(V[k].x - gr.x0, V[k].y - gr.y0) < 1.5 && Math.hypot(V[k + 1].x - gr.x1, V[k + 1].y - gr.y1) < 1.5) return k;
      if (Math.hypot(V[k].x - gr.x1, V[k].y - gr.y1) < 1.5 && Math.hypot(V[k + 1].x - gr.x0, V[k + 1].y - gr.y0) < 1.5) return -k - 100;
    }
    return null;
  };

  const body = [];
  let skippedGrad = 0;
  for (const s of stamps) {
    if ((s.kind === 'fill' || s.kind === 'stroke') && s.w !== SIZE && parseHsl(s.css)) {
      const n = nearSeg(s.x + s.w / 2, s.y + s.h / 2);
      if (n.d <= g.wS) body.push({ css: s.css, seg: n.seg, arc: n.arc, L: s.kind === 'stroke' && t.ribbed && !t.bold ? RIB_LIGHT : bodyL });
      continue;
    }
    if (s.kind === 'grad' && !s.grad.radial) {
      const k = segOfGradient(s.grad);
      if (k === null) { skippedGrad++; continue; }
      const flip = k <= -100, seg = flip ? -(k + 100) : k;
      const len = cum[seg + 1] - cum[seg];
      for (const st of s.grad.stops) {
        if (!parseHsl(st.css)) continue;
        const o = flip ? 1 - st.o : st.o;
        body.push({ css: st.css, seg, arc: cum[seg] + len * o, L: bodyL });
      }
    }
  }
  if (!body.length) { console.log(`#${id} ${typeLabel(t)}: nothing captured (${stamps.length} ops)`); continue; }

  let worst = 0, n = 0;
  for (const s of body) {
    const got = parseHsl(s.css);
    const want = ink(param(s.arc, s.seg), s.L);
    if (want.grey) { const dl = Math.abs(got.light - want.light); if (dl > 1.5) worst = Math.max(worst, dl); n++; continue; }
    let d = Math.abs(got.hue - want.hue);
    if (d > 180) d = 360 - d;
    worst = Math.max(worst, d); n++;
  }
  worstAll = Math.max(worstAll, worst);
  const fam = typeLabel(t) + (t.legendary !== 'none' ? ' / ' + t.legendary : '') + (t.spectrum === 'grey' ? ' / grey' : '');
  byFamily[fam] = Math.max(byFamily[fam] ?? 0, worst);
  console.log(`#${String(id).padStart(4)} ${fam.padEnd(34)} samples ${String(n).padStart(4)}${skippedGrad ? ' (' + skippedGrad + ' unmatched)' : ''}  worst ${worst.toFixed(2)}`);
}
console.log('\nworst across all:', worstAll.toFixed(2));
for (const [k, v] of Object.entries(byFamily).sort((a, b) => b[1] - a[1])) console.log('  ' + k.padEnd(34) + v.toFixed(2));
