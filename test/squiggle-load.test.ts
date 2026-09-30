import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAll } from '../src/squiggle/builder';
import { readCurve } from '../src/squiggle/curve';
import { failFromUrl, loadSquiggle, type Loaded } from '../src/squiggle/load';
import { SourceError } from '../src/squiggle/source';

const fixture = (id: number) => JSON.parse(readFileSync(`test/fixtures/squiggles/${id}.json`, 'utf8'));
const fx = fixture(1234);

// Art Blocks, faked: token JSON, generator page and pictures, each can be down
let down = new Set<string>(), calls: string[] = [];
const generatorPage = `<html><script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.0.0/p5.min.js"></script><script>let tokenData = {"tokenId":"1234","hashes":["${fx.hash}"]}</script><script>function setup() {} function draw() {}</script></html>`;
async function fakeFetch(input: string | URL | Request): Promise<Response> {
  const url = String(input);
  calls.push(url);
  const kind = url.includes('token.artblocks') ? 'token' : url.includes('generator.artblocks') ? 'generator' : 'image';
  if (down.has(kind)) return new Response('', { status: 503 });
  if (kind === 'token') return Response.json({ token_hash: fx.hash, features: fx.features, project_id: url.endsWith('/77') ? '1' : '0' });
  if (kind === 'generator') return new Response(generatorPage, { headers: { 'content-type': 'text/html' } });
  return new Response('', { status: 404 });
}
// no DOM in Node: a canvas that draws nothing (the iframe of the original script can't run here)
const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
const fakeDocument = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,AAAA' }) };

beforeEach(() => { down = new Set(); calls = []; vi.stubGlobal('fetch', fakeFetch); vi.stubGlobal('document', fakeDocument); });
afterEach(() => vi.unstubAllGlobals());

describe('load chain', () => {
  it('reads the ?fail= test hook', () => {
    expect(failFromUrl('?fail=token,Generator')).toEqual(['token', 'generator']);
    expect(failFromUrl('?id=3')).toEqual([]);
  });

  it('refuses a wrong number or a token that is not a Squiggle, without fallbacks', async () => {
    await expect(loadSquiggle(10000)).rejects.toThrow(/0 to 9999/);
    await expect(loadSquiggle(1.5)).rejects.toBeInstanceOf(SourceError);
    expect(calls).toEqual([]);
    await expect(loadSquiggle(77)).rejects.toThrow(/not a Chromie Squiggle/);
  });

  it('script out of reach → the port draws the same circles from the token hash', async () => {
    const L = await loadSquiggle(1234, { fail: ['generator'] });
    expect(L.origin).toBe('port');
    expect([L.id, L.hash]).toEqual([1234, fx.hash]);
    expect(L.features).toEqual(fx.features);
    expect(L.original).toMatch(/^data:image\/png/);
    expect(L.source!.dots.length).toBe(fx.dots.length);
    const want = readCurve(fx);
    expect(L.curve.points.length).toBe(want.points.length);
    expect(L.curve.type).toBe(want.type);
    expect(Math.abs(L.curve.points[500].x - want.points[500].x)).toBeLessThan(0.5);
    expect(L.notes.join(' ')).toMatch(/exact copy of the Squiggle’s script/);
    expect(L.notes.join(' ')).not.toMatch(/TypeScript/);
    expect(calls.some(u => u.includes('generator'))).toBe(false);
  });

  it('token data out of reach → the generator page still gives the hash', async () => {
    down.add('token');
    const steps: string[] = [];
    const L = await loadSquiggle(1234, { onStep: s => steps.push(s) });
    // the sandboxed redraw can't run in Node, so the port takes over, with the hash from the generator
    expect(L.origin).toBe('port');
    expect(L.hash).toBe(fx.hash);
    expect(L.features.Type).toBe('Normal');
    expect(steps).toEqual(['script', 'port']);
  });

  it('token and generator out of reach → the picture; no picture either → ask for an upload', async () => {
    const e = await loadSquiggle(1234, { fail: ['token', 'generator'] }).catch(x => x);
    expect(e).toBeInstanceOf(SourceError);
    expect(e.message).toMatch(/upload an image/);
    // both CORS-open addresses of the picture were tried, never media-proxy (its redirect has no CORS header)
    expect(calls.filter(u => /\.png$/.test(u)).length).toBe(2);
    expect(calls.some(u => u.includes('media-proxy'))).toBe(false);
    calls = [];
    await expect(loadSquiggle(1234, { fail: ['token', 'generator', 'image'] })).rejects.toThrow(/upload an image/);
    expect(calls.filter(u => /\.png$/.test(u))).toEqual([]);
  });

  it('Art Blocks hanging: asked all at once, "slow" after 10 s, the upload offer within 20 s', async () => {
    vi.useFakeTimers();
    // AbortSignal.timeout runs on the real clock: the same on the fake one
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const c = new AbortController(); setTimeout(() => c.abort(new DOMException('timeout', 'TimeoutError')), ms); return c.signal; });
    const t0 = Date.now(), asked: [string, number][] = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => new Promise((_, ko) => {
      asked.push([url, Date.now() - t0]);
      init?.signal?.addEventListener('abort', () => ko(new Error('aborted')));
    }));
    try {
      let slow = -1, gaveUp = -1;
      const p = loadSquiggle(1234, { onSlow: () => { slow = Date.now() - t0; } }).catch(e => { gaveUp = Date.now() - t0; return e; });
      await vi.advanceTimersByTimeAsync(30000);
      const e = await p;
      expect(e).toBeInstanceOf(SourceError);
      expect(e.message).toMatch(/upload an image/);
      expect(slow).toBe(10000);
      expect(gaveUp).toBeLessThanOrEqual(20000);
      const at = (re: RegExp) => asked.filter(([u]) => re.test(u)).map(([, t]) => t);
      expect([at(/token\.artblocks/), at(/generator\.artblocks/)]).toEqual([[0], [0]]);
      expect(at(/\.png$/)).toEqual([8000, 8000]);
    } finally { vi.useRealTimers(); vi.restoreAllMocks(); }
  });

  it('the first picture address that answers is used, the others are cancelled', async () => {
    down.add('token'); down.add('generator');
    const cancelled: string[] = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => new Promise((ok, ko) => {
      calls.push(url);
      init?.signal?.addEventListener('abort', () => { cancelled.push(url); ko(new Error('aborted')); });
      if (/token|generator/.test(url)) ok(new Response('', { status: 503 }));
      else if (url.includes('s3.amazonaws')) setTimeout(() => ok(new Response(new Uint8Array(8), { headers: { 'content-type': 'image/png' } })), 5);
    }));
    // no picture decoding in Node: the chain gets as far as reading the picture
    const e = await loadSquiggle(1234).catch(x => x);
    expect(e).toBeInstanceOf(SourceError);
    expect(e.message).toMatch(/couldn’t open this picture/);
    expect(cancelled.filter(u => u.endsWith('.png'))).toEqual([expect.stringContaining('core-api')]);
  });
});

describe('models of a loaded Squiggle', () => {
  const loaded = (o: Partial<Loaded> = {}): Loaded => ({
    id: 1234, hash: fx.hash, features: fx.features, origin: 'port', original: '', source: fx, curve: readCurve(fx), notes: [], ...o,
  });

  it('builds on first ask, once, and keeps them', async () => {
    const b = buildAll(loaded());
    const p = b.get({ format: 'relief', display: 'frame', scale: 'small' });
    expect(b.get({ format: 'relief', scale: 'small' })).toBe(p);
    const m = await p;
    expect(m.display).toBe('frame');
    expect(b.relief.small?.frame).toBe(m);
    expect(m.checks.floating).toBe(0);
    expect(m.checks.collisions).toBe(0);
    expect(m.checks.twoStud).toBe(0);
    expect(m.nameplate?.lines[1]).toContain(fx.hash.slice(2, 10));
    expect(b.ms['relief-frame-small']).toBeGreaterThan(0);
    const mo = await b.get({ format: 'mosaic', scale: 'small' });
    expect(b.mosaic.small).toBe(mo);
    expect(structuredClone(mo)).toEqual(mo);       // plain data, as a worker sends it
  }, 60000);

  it('a traced picture: the nameplate says what is known', async () => {
    const up = await buildAll(loaded({ id: null, hash: null, origin: 'upload' })).get({ format: 'relief', display: 'floating', scale: 'small' });
    expect(up.nameplate!.lines).toEqual(['Chromie Squiggle', 'Snowfro · Art Blocks · 2020']);
    const img = await buildAll(loaded({ hash: null, origin: 'image' })).get({ format: 'relief', display: 'frame', scale: 'small' });
    expect(img.nameplate!.lines).toEqual(['Chromie Squiggle #1234', 'Snowfro · Art Blocks · 2020']);
  }, 60000);
});
