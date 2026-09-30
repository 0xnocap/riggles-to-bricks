// The nameplate: a 2×6 black tile (69729) with the Squiggle's name, in white.
// One drawing serves the printable PNG (real size, for sticker paper or an
// engraver) and the texture of the tile in the 3D view.
import { renderHex } from '../core/palette';
import { BLACK } from './spectrum';

export type NameplateLines = [string, string];
/** top face of the 2×6 tile, mm */
export const NAMEPLATE_MM: [number, number] = [47.8, 15.8];
const MARGIN = 0.06, FACE = renderHex(BLACK), INK = '#ffffff';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function nameplateLines(id: number, hash: string): NameplateLines {
  return [`Chromie Squiggle #${id}`, `Snowfro · Art Blocks · 2020 · 0x${hash.replace(/^0x/, '').slice(0, 8)}`];
}

/** Largest size ≤ `size` at which `text` is at most `maxW` wide. Leaves ctx.font set to it. */
function fitText(ctx: Ctx, text: string, weight: string, size: number, maxW: number): number {
  const set = () => ctx.font = `${weight} ${size.toFixed(2)}px ${FONT}`;
  for (let i = 0; i < 12; i++) {
    set();
    const m = ctx.measureText(text), tw = Math.max(m.width, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
    if (tw <= maxW) return size;
    size *= Math.max(0.5, maxW / tw) * 0.995;
  }
  set();
  return size;
}

const capHeight = (ctx: Ctx, size: number) => ctx.measureText('H').actualBoundingBoxAscent || size * 0.7;

/**
 * The tile face in (0, 0, w, h): black, slightly rounded corners, line 1 bold and
 * bigger, line 2 smaller, white, centred; both shrink to keep ≥ 6% side margins.
 */
export function drawNameplate(ctx: Ctx, w: number, h: number, lines: NameplateLines) {
  const maxW = w * (1 - 2 * MARGIN);
  ctx.save();
  ctx.fillStyle = FACE;
  ctx.beginPath(); ctx.roundRect(0, 0, w, h, h * 0.04); ctx.fill();
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const s1 = fitText(ctx, lines[0], '700', h * 0.3, maxW), c1 = capHeight(ctx, s1);
  const s2 = fitText(ctx, lines[1], '400', Math.min(h * 0.19, s1 * 0.66), maxW), c2 = capHeight(ctx, s2);
  // centre the block from the cap top of line 1 to the baseline of line 2 (line 1's descenders sit in the gap)
  const gap = s1 * 0.5, y1 = (h - (c1 + gap + c2)) / 2 + c1;
  ctx.fillText(lines[1], w / 2, y1 + gap + c2);
  ctx.font = `700 ${s1.toFixed(2)}px ${FONT}`;
  ctx.fillText(lines[0], w / 2, y1);
  ctx.restore();
}

/** The face on a canvas `pxWidth` wide, corners filled, for the 3D tile's texture. */
export function nameplateCanvas(lines: NameplateLines, pxWidth = 1024): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(pxWidth); c.height = Math.round(pxWidth * NAMEPLATE_MM[1] / NAMEPLATE_MM[0]);
  const x = c.getContext('2d')!;
  x.fillStyle = FACE; x.fillRect(0, 0, c.width, c.height);
  drawNameplate(x, c.width, c.height, lines);
  return c;
}

/**
 * Printable PNG at real size (47.8 × 15.8 mm at `dpi`, resolution stored in the
 * file). `cutMarks`: on a white sheet with thin grey crop marks around the face,
 * and 1 mm of black bleed so a cut slightly off the line leaves no white edge.
 */
export async function nameplatePNG(lines: NameplateLines, dpi = 600, opts: { cutMarks?: boolean } = {}): Promise<Blob> {
  const px = (mm: number) => mm / 25.4 * dpi;
  const [fw, fh] = NAMEPLATE_MM.map(v => Math.round(px(v))), m = opts.cutMarks ? Math.round(px(6)) : 0;
  const c = document.createElement('canvas'); c.width = fw + 2 * m; c.height = fh + 2 * m;
  const x = c.getContext('2d')!;
  if (opts.cutMarks) {
    const bleed = Math.round(px(1)), g = px(2), l = px(3.5);
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = FACE; x.fillRect(m - bleed, m - bleed, fw + 2 * bleed, fh + 2 * bleed);
    x.strokeStyle = x.fillStyle = '#8c8c8c'; x.lineWidth = Math.max(1, px(0.1));
    x.beginPath();
    for (const X of [m, m + fw]) for (const Y of [m, m + fh]) {
      const sx = X === m ? -1 : 1, sy = Y === m ? -1 : 1;
      x.moveTo(X, Y + sy * g); x.lineTo(X, Y + sy * (g + l));
      x.moveTo(X + sx * g, Y); x.lineTo(X + sx * (g + l), Y);
    }
    x.stroke();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const note = `${NAMEPLATE_MM[0]} × ${NAMEPLATE_MM[1]} mm · print at 100 %`;
    fitText(x, note, '400', px(1.6), fw - 2 * (g + l));
    x.fillText(note, m + fw / 2, m + fh + px(3.4));
  }
  x.translate(m, m);
  drawNameplate(x, fw, fh, lines);
  const blob = await new Promise<Blob>((ok, ko) => c.toBlob(b => b ? ok(b) : ko(new Error('PNG encoding failed')), 'image/png'));
  return new Blob([pngDpi(new Uint8Array(await blob.arrayBuffer()), dpi)], { type: 'image/png' });
}

/** Set a PNG's resolution (pHYs chunk, replacing any) so it prints at real size. */
export function pngDpi(png: Uint8Array, dpi: number): Uint8Array<ArrayBuffer> {
  const ppm = Math.round(dpi / 0.0254), phys = new Uint8Array(21), v = new DataView(phys.buffer);
  v.setUint32(0, 9); phys.set([0x70, 0x48, 0x59, 0x73], 4); v.setUint32(8, ppm); v.setUint32(12, ppm); phys[16] = 1;
  v.setUint32(17, crc32(phys.subarray(4, 17)));
  const d = new DataView(png.buffer, png.byteOffset, png.byteLength), parts = [png.subarray(0, 8)];
  for (let i = 8; i + 12 <= png.length;) {
    const n = 12 + d.getUint32(i), type = String.fromCharCode(...png.subarray(i + 4, i + 8));
    if (type !== 'pHYs') parts.push(png.subarray(i, i + n));
    if (type === 'IHDR') parts.push(phys);
    i += n;
  }
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  parts.reduce((o, p) => (out.set(p, o), o + p.length), 0);
  return out;
}

let CRC: Uint32Array | null = null;
function crc32(b: Uint8Array): number {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
  }
  let c = ~0;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}
