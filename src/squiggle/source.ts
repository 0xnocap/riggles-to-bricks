// Fetch a Chromie Squiggle from Art Blocks' public endpoints (token data, its
// generator page, its picture) and redraw it in the browser with its original
// p5.js script, inside a sandboxed iframe. Besides the picture, we record every
// circle the script draws (position, size, colour, in drawing order): that is
// the Squiggle as geometry, with its spectrum in order along the curve.

export const SQUIGGLE_CONTRACT = '0x059edd72cd353df5106d2b9cc5ab83a52287ac3a';

export interface SquiggleToken {
  id: number;
  hash: string;
  features: Record<string, string | number>;
  script: string;          // the project's script, as served by the generator
  p5: string;              // p5.js URL the generator uses
  imageUrl: string;        // Art Blocks' static render
}

export interface Dot {
  x: number; y: number; d: number;   // canvas pixels
  fill: string | null;               // CSS colour, or null when not filled
  stroke: string | null;             // CSS colour, or null when not stroked
  order: number;                     // drawing order
}

export interface Render {
  width: number; height: number;
  png: string;                       // data URL of the redraw
  dots: Dot[];
}

export class SourceError extends Error {}

const TOKEN = (id: number) => `https://token.artblocks.io/1/${SQUIGGLE_CONTRACT}/${id}`;
const GENERATOR = (id: number) => `https://generator.artblocks.io/1/${SQUIGGLE_CONTRACT}/${id}`;
/** Art Blocks' static picture of a Squiggle (its address needs no token data) */
export const imageUrl = (id: number) => `https://media-proxy.artblocks.io/1/${SQUIGGLE_CONTRACT}/${id}.png`;
/** where a script may read that picture: media-proxy's redirect has no CORS header (a fetch of it always fails, with a
 *  console error), so only for <img>; its next hops, core-api then S3, send one */
export const imageSources = (id: number) => [`https://core-api.artblocks.io/media/1/${SQUIGGLE_CONTRACT}/${id}.png`, `https://artblocks-mainnet.s3.amazonaws.com/${id}.png`];
const P5 = 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.0.0/p5.min.js';

export function checkId(id: number) {
  if (!Number.isInteger(id) || id < 0 || id > 9999) throw new SourceError('Type a Squiggle number from 0 to 9999.');
}

async function get(url: string, ms: number): Promise<Response> {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r;
}

/** The token's data: hash, features, where its generator and picture are. `ms`: how long to wait for it. */
export async function fetchToken(id: number, ms = 8000): Promise<{ id: number; hash: string; features: Record<string, string | number>; generator: string; imageUrl: string }> {
  checkId(id);
  let meta: { token_hash?: string; features?: Record<string, string | number>; image?: string; generator_url?: string; project_id?: string };
  try { meta = await (await get(TOKEN(id), ms)).json(); } catch { throw new SourceError('We couldn’t reach Art Blocks to get this Squiggle.'); }
  if (meta.project_id !== undefined && String(meta.project_id) !== '0') throw new SourceError('That token is not a Chromie Squiggle.');
  if (!/^0x[0-9a-f]{64}$/i.test(meta.token_hash ?? '')) throw new SourceError('Art Blocks sent unexpected data for this Squiggle.');
  return { id, hash: meta.token_hash!, features: meta.features ?? {}, generator: meta.generator_url ?? GENERATOR(id), imageUrl: meta.image ?? imageUrl(id) };
}

/** The generator page: the project's script, the p5.js it runs on, and the hash it was given. Its address
 *  follows from the id alone (the token data gives the same), so it can be asked for alongside the token data. */
export async function fetchScript(id: number, generator = GENERATOR(id), ms = 8000): Promise<{ script: string; p5: string; hash: string | null }> {
  let html: string;
  try { html = await (await get(generator, ms)).text(); } catch { throw new SourceError('We couldn’t load the Squiggle’s script from Art Blocks.'); }
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const script = scripts.find(s => /function\s+draw\s*\(/.test(s));
  if (!script) throw new SourceError('Art Blocks sent an unexpected page for this Squiggle.');
  return { script, p5: html.match(/<script src="([^"]*p5[^"]*)"/)?.[1] ?? P5, hash: html.match(/"(0x[0-9a-f]{64})"/i)?.[1] ?? null };
}

/** Token metadata + original script. Throws SourceError when Art Blocks can't be reached. */
export async function fetchSquiggle(id: number): Promise<SquiggleToken> {
  const [t, g] = await Promise.all([fetchToken(id), fetchScript(id)]);
  return { id, hash: t.hash, features: t.features, script: g.script, p5: g.p5, imageUrl: t.imageUrl };
}

/**
 * Run the original script once in a sandboxed iframe (no access to this page)
 * and return the frame plus every circle drawn. `background` picks the
 * Squiggle's own background: 0 = black (its space-bar variant), 255 = white.
 */
export function renderSquiggle(t: SquiggleToken, width = 1500, background: 0 | 255 = 0, timeoutMs = 20000): Promise<Render> {
  const height = Math.round((width * 2) / 3);
  const bgIndex = background === 0 ? 10 : 0;   // index in the script's backgroundArray
  const nonce = Math.random().toString(36).slice(2);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:#000}</style>
<script>
// p5 listens to the motion sensors, which this frame may not use (the browser logs a policy violation)
(function () { var add = window.addEventListener; window.addEventListener = function (type) { if (type === 'devicemotion' || type === 'deviceorientation') return; return add.apply(this, arguments); }; })();
</script>
<script src="${t.p5}"></script>
<script>let tokenData = ${JSON.stringify({ tokenId: String(t.id), hashes: [t.hash] })};</script>
<script>${t.script.replace(/<\/script/gi, '<\\/script')}</script>
<script>
(function () {
  window.onerror = function (m) { parent.postMessage({ nonce: '${nonce}', error: String(m) }, '*'); };
  var rec = [], order = 0;
  var circle0 = p5.prototype.circle;
  p5.prototype.circle = function (x, y, d) {
    var m = this.drawingContext.getTransform(), r = this._renderer;
    rec.push([m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f, d * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)),
      r._doFill ? this.drawingContext.fillStyle : null, r._doStroke ? this.drawingContext.strokeStyle : null, order++]);
    return circle0.call(this, x, y, d);
  };
  var setup0 = window.setup, draw0 = window.draw;
  // noLoop() here makes p5 draw the first frame at once, without waiting for an
  // animation frame (browsers pause those in hidden frames).
  // the script sizes its canvas from the window: some browsers report 0 for a
  // hidden frame, so give it the size we want
  window.setup = function () { windowWidth = ${width}; windowHeight = ${height}; setup0(); pixelDensity(1); backgroundIndex = ${bgIndex}; noLoop(); };
  window.draw = function () {
    rec.length = 0; order = 0;
    draw0();
    var c = document.querySelector('canvas');
    parent.postMessage({ nonce: '${nonce}', width: c.width, height: c.height, png: c.toDataURL('image/png'), dots: rec }, '*');
  };
})();
</script></head><body></body></html>`;
  return new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.style.cssText = `position:fixed;left:-${width + 100}px;top:0;width:${width}px;height:${height}px;border:0;visibility:hidden`;
    const done = (fn: () => void) => { clearTimeout(timer); window.removeEventListener('message', onMsg); f.remove(); fn(); };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== f.contentWindow || e.data?.nonce !== nonce) return;
      if (e.data.error) return done(() => reject(new SourceError('The Squiggle’s script failed: ' + e.data.error)));
      const d = e.data as { width: number; height: number; png: string; dots: [number, number, number, string | null, string | null, number][] };
      if (!(d.width > 100 && d.height > 50 && d.dots.length)) return done(() => reject(new SourceError('The Squiggle’s script drew an empty picture.')));
      done(() => resolve({ width: d.width, height: d.height, png: d.png, dots: d.dots.map(([x, y, dd, fill, stroke, order]) => ({ x, y, d: dd, fill, stroke, order })) }));
    };
    const timer = setTimeout(() => done(() => reject(new SourceError('The Squiggle’s script took too long to draw.'))), timeoutMs);
    window.addEventListener('message', onMsg);
    f.srcdoc = doc;
    document.body.append(f);
  });
}
