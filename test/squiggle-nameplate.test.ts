import { readdirSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { drawNameplate, NAMEPLATE_MM, nameplateLines, pngDpi, type NameplateLines } from '../src/squiggle/nameplate';

const DIR = 'test/fixtures/squiggles';
const fixture = (id: number) => JSON.parse(readFileSync(`${DIR}/${id}.json`, 'utf8')) as { id: number; hash: string };

/** A 2D context that records what is drawn; text is 0.55 em per character, caps 0.7 em. */
function fakeCtx() {
  const texts: { text: string; x: number; y: number; font: string; size: number; align: string }[] = [];
  const size = (f: string) => +/([\d.]+)px/.exec(f)![1];
  const ctx = {
    font: '10px sans-serif', fillStyle: '', textAlign: 'start', textBaseline: 'alphabetic',
    save() {}, restore() {}, beginPath() {}, roundRect() {}, fill() {},
    measureText(t: string) {
      const s = size(ctx.font), w = t.length * s * 0.55;
      return { width: w, actualBoundingBoxLeft: w / 2, actualBoundingBoxRight: w / 2, actualBoundingBoxAscent: s * 0.7 };
    },
    fillText(text: string, x: number, y: number) { texts.push({ text, x, y, font: ctx.font, size: size(ctx.font), align: ctx.textAlign }); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

describe('nameplate', () => {
  it('reads "Riggle #id" and "riggles · 2026 · 0x" + 8 hex chars', () => {
    expect(nameplateLines(1234, fixture(1234).hash)).toEqual(['Riggle #1234', 'riggles · 2026 · 0xd553fb67']);
    for (const f of readdirSync(DIR).map(n => fixture(+n.replace('.json', '')))) {
      const [a, b] = nameplateLines(f.id, f.hash);
      expect(a).toBe(`Riggle #${f.id}`);
      expect(b).toMatch(/^riggles · 2026 · 0x[0-9a-f]{8}$/);
      expect(b.endsWith(f.hash.slice(2, 10))).toBe(true);
    }
  });

  it('takes the hash with or without its 0x prefix', () => {
    const h = fixture(1234).hash;
    expect(nameplateLines(1234, h.slice(2))).toEqual(nameplateLines(1234, h));
    expect(nameplateLines(0, '0x0123456789')[1]).toBe('riggles · 2026 · 0x01234567');
    expect(nameplateLines(0, '0123456789')[1]).toBe('riggles · 2026 · 0x01234567');
    expect(nameplateLines(0, '0x0123456789')[0]).toBe('Riggle #0');
  });

  it('draws both lines centred, line 1 bold and bigger, inside ≥ 6% side margins', () => {
    const lines: NameplateLines = nameplateLines(9999, 'ffffffffffffffff');
    for (const w of [1129, 1024, 256]) {
      const h = w * NAMEPLATE_MM[1] / NAMEPLATE_MM[0], { ctx, texts } = fakeCtx();
      drawNameplate(ctx, w, h, lines);
      const t1 = texts.find(t => t.text === lines[0])!, t2 = texts.find(t => t.text === lines[1])!;
      expect(texts.length).toBe(2);
      expect(t1.font).toMatch(/^700 /);
      expect(t1.size).toBeGreaterThan(t2.size * 1.3);
      for (const t of [t1, t2]) {
        expect(t.align).toBe('center');
        expect(t.x).toBeCloseTo(w / 2, 6);
        expect(t.text.length * t.size * 0.55).toBeLessThanOrEqual(w * 0.88 + 1e-6);
      }
      expect(t1.y).toBeLessThan(t2.y);
      expect(t1.y - t1.size * 0.7).toBeGreaterThan(h * 0.1);
      expect(t2.y).toBeLessThan(h * 0.9);
    }
  });

  it('stores the resolution in the PNG (valid CRCs, one pHYs)', () => {
    const img = new PNG({ width: 4, height: 2 });
    img.data.fill(255);
    const once = pngDpi(PNG.sync.write(img), 600), twice = pngDpi(once, 300);
    const phys = (b: Uint8Array) => {
      const out: number[] = [], d = new DataView(b.buffer, b.byteOffset, b.byteLength);
      for (let i = 8; i < b.length; i += 12 + d.getUint32(i))
        if (String.fromCharCode(...b.subarray(i + 4, i + 8)) === 'pHYs') out.push(d.getUint32(i + 8));
      return out;
    };
    expect(phys(once)).toEqual([23622]);
    expect(phys(twice)).toEqual([11811]);
    const back = PNG.sync.read(Buffer.from(twice));
    expect([back.width, back.height]).toEqual([4, 2]);
  });
});
