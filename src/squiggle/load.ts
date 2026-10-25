// The Squiggle to build, whatever it takes. From best to last resort: its own
// script redrawn in a sandbox (`script`), the TypeScript port of that script
// fed with the token's hash (`port`), Art Blocks' picture of it traced back
// into a curve (`image`), the visitor's own picture (`upload`). Token data and
// generator page are asked together, the picture's addresses too, so when Art
// Blocks hangs the upload offer comes within about 20 s. The test hook
// ?fail=token,generator,port,image makes those steps fail on purpose.
import { readCurve, type Curve, type CurveSource } from './curve';
import type { ImageCurve } from './fromImage';
import { drawDots, portFeatures, portSquiggle } from './port';
import { checkId, fetchScript, fetchToken, imageSources, imageUrl, renderSquiggle, SourceError } from './source';
import { traceImage } from './builder';

export { SourceError };

export interface Loaded {
  id: number | null;
  hash: string | null;
  features: Record<string, string | number>;
  origin: 'script' | 'port' | 'image' | 'upload' | 'engine';
  original: string;                 // image URL or data URL shown as "Original"
  source: CurveSource | null;       // the recorded circles (script, port), for readCurve
  curve: Curve;
  notes: string[];                  // what adds to the origin (how close, what is missing), never the origin itself: the page says that
}

/** fail: steps to skip ('token', 'generator', 'port', 'image'); onStep: the step being tried, for a progress
 *  line; onSlow: called once when Art Blocks keeps us waiting (the page can offer an upload meanwhile) */
export type LoadOptions = { fail?: string[]; onStep?: (step: Loaded['origin']) => void; onSlow?: () => void };

const WIDTH = 1200;                 // the canvas the curves are read on (the fixtures' too)
/** ms to wait for the token data and the generator page (asked together), the redraw, Art Blocks' picture
 *  (its addresses asked together), and before saying it is slow: at worst about 20 s to the upload offer */
const WAIT = { page: 8000, draw: 10000, image: 12000, slow: 10000 };

/** The steps ?fail= asks to skip, e.g. "?fail=token,generator". */
export function failFromUrl(search = typeof location === 'undefined' ? '' : location.search): string[] {
  return (new URLSearchParams(search).get('fail') ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

export async function loadSquiggle(id: number, o: LoadOptions = {}): Promise<Loaded> {
  checkId(id);
  const slow = o.onSlow ? setTimeout(o.onSlow, WAIT.slow) : undefined;
  try { return await chain(id, new Set(o.fail ?? []), o); } finally { clearTimeout(slow); }
}

type Settled<T> = { ok: true; v: T } | { ok: false; e: unknown };
const settle = <T>(p: Promise<T>): Promise<Settled<T>> => p.then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));

async function chain(id: number, fail: Set<string>, o: LoadOptions): Promise<Loaded> {
  const notes: string[] = [];
  // 1. the token's data and the generator page, together: either one gives the hash
  const token = fail.has('token') ? null : settle(fetchToken(id, WAIT.page));
  const page = fail.has('generator') ? null : settle(fetchScript(id, undefined, WAIT.page));
  let hash: string | null = null, features: Record<string, string | number> = {};
  const t = await token;
  if (t?.ok) ({ hash, features } = t.v);
  else if (t && isFatal(t.e)) throw t.e;
  // 2. the original script, in a sandbox
  const g = await page;
  if (g?.ok && (hash ??= g.v.hash)) {
    try {
      o.onStep?.('script');
      if (!Object.keys(features).length) features = portFeatures(hash);
      const r = await renderSquiggle({ id, hash, features, script: g.v.script, p5: g.v.p5, imageUrl: imageUrl(id) }, WIDTH, 255, WAIT.draw);
      const source: CurveSource = { id, features, width: r.width, height: r.height, dots: r.dots };
      return { id, hash, features, origin: 'script', original: r.png, source, curve: readCurve(source), notes };
    } catch { /* next */ }
  }
  // 3. the port of the script
  if (hash && !fail.has('port')) {
    o.onStep?.('port');
    if (!Object.keys(features).length) features = portFeatures(hash);
    const r = portSquiggle(hash, WIDTH), source: CurveSource = { id, features, ...r };
    notes.push('Nothing about the line is approximate: an exact copy of the Squiggle’s script draws the original’s circles, in the same order, sizes and colours.');
    return { id, hash, features, origin: 'port', original: picture(r), source, curve: readCurve(source), notes };
  }
  // 4. Art Blocks' picture
  let blob: Blob | null = null;
  if (!fail.has('image')) { o.onStep?.('image'); blob = await fetchImage(id, WAIT.image); }
  if (!blob) throw new SourceError('We couldn’t reach Art Blocks to get this Squiggle. You can upload an image of it instead.');
  const p = await trace(blob, id);
  if (!hash) notes.push('Art Blocks’ token data couldn’t be reached: its hash, and the features a picture doesn’t show, are unknown, so the nameplate goes without the hash.');
  notes.push(...p.notes);
  return { id, hash: null, features: p.features, origin: 'image', original: p.original, source: null, curve: p.curve, notes };
}

/** Art Blocks' picture of a Squiggle from whichever address answers first (the others are then cancelled) */
async function fetchImage(id: number, ms: number): Promise<Blob | null> {
  const urls = imageSources(id), stop = urls.map(() => new AbortController());
  const timer = setTimeout(() => stop.forEach(c => c.abort()), ms);
  let won = -1;
  try {
    return await Promise.any(urls.map(async (url, i) => {
      const r = await fetch(url, { signal: stop[i].signal });
      if (!r.ok || !(r.headers.get('content-type') ?? 'image').startsWith('image') || won >= 0) throw new Error(url);
      won = i;
      stop.forEach((c, j) => { if (j !== i) c.abort(); });
      return await r.blob();
    }));
  } catch { return null; } finally { clearTimeout(timer); }
}

/** A picture of a Squiggle, from the visitor. */
export async function loadUpload(file: Blob): Promise<Loaded> {
  if (file.type && !file.type.startsWith('image/')) throw new SourceError('That file is not an image.');
  const t = await trace(file, null);
  return { id: null, hash: null, features: t.features, origin: 'upload', original: t.original, source: null, curve: t.curve, notes: [...t.notes, 'A picture doesn’t carry the token’s number or hash: the nameplate goes without them.'] };
}

/** a wrong number or a token that is not a Squiggle: no fallback can help */
const isFatal = (e: unknown) => e instanceof SourceError && /not a Chromie Squiggle|from 0 to 9999/.test(e.message);

/** the port's circles drawn on white, as a PNG data URL */
function picture(r: ReturnType<typeof portSquiggle>): string {
  const c = document.createElement('canvas');
  c.width = r.width; c.height = r.height;
  drawDots(c.getContext('2d')!, r);
  return c.toDataURL('image/png');
}

/** decode a picture, trace it (off the main thread); the original shown: the Squiggle's own picture (cut out of
 *  a screenshot if need be), at most 1200 px wide */
async function trace(blob: Blob, id: number | null): Promise<ImageCurve & { original: string }> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(blob); } catch { throw new SourceError('We couldn’t open this picture. Try a PNG or JPEG.'); }
  const draw = ([sx, sy, sw, sh]: number[], maxW: number) => {
    const k = Math.min(1, maxW / sw), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);     // transparent pictures read as white
    x.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return { c, x };
  };
  try {
    const all = [0, 0, bmp.width, bmp.height], big = draw(all, 2400), k = big.c.width / bmp.width;
    const t = await traceImage({ width: big.c.width, height: big.c.height, data: big.x.getImageData(0, 0, big.c.width, big.c.height).data }, id);
    return { ...t, original: draw(t.crop ? t.crop.map(v => v / k) : all, WIDTH).c.toDataURL('image/png') };
  } finally { bmp.close(); }
}
