// Squiggle downloads: parts list (CSV), BrickLink wanted list (XML), LEGO Pick a
// Brick upload files, the share image (1200×630), the printable nameplate and the
// full kit (ZIP with the booklet, every list, the nameplate and a README).
import { elementId } from '../core/lego';
import { renderHex } from '../core/palette';
import type { Piece } from '../core/parts';
import { pickABrickFiles as pabFiles } from '../export/order';
import { brickLinkId, brickLinkXML as blXML, csvCell } from '../export/parts';
import { makeZip } from '../export/zip';
import type { Role, SqModel } from './model';
import type { View } from './stage';
import { NAMEPLATE_MM, nameplatePNG } from './nameplate';
import { SPECTRUM, WHITE } from './spectrum';

/** What the exports need from the loaded Squiggle (load.ts's Loaded fits) */
export interface SquiggleInfo {
  id: number | null; hash: string | null;
  original: string;                 // image URL or data URL of the original
  origin?: 'script' | 'port' | 'image' | 'upload' | 'engine';
  notes?: string[];
}

export const SITE_NAME = 'Riggles to Bricks';
export const SITE_URL = 'https://0xnocap.github.io/riggles-to-bricks/';
const SOURCE_URL = 'https://github.com/0xnocap/riggles-to-bricks';
const SECTION: Record<Role, string> = { squiggle: 'Riggle', display: 'Display' };
const DISPLAY = { frame: 'Frame', floating: 'Floating', backdrop: 'Backdrop' };

// ---------- names and figures ----------

/** "Riggle #1234" */
export const squiggleName = (src: SquiggleInfo) => (src.id !== null ? `Riggle #${src.id}` : 'Riggle');

/** Base of every file name: riggle-1234-frame-large, riggle-1234-mosaic-small… */
export const fileBase = (m: SqModel, src: SquiggleInfo) =>
  `riggle-${src.id ?? 0}-${m.format === 'mosaic' ? 'mosaic' : m.display ?? 'relief'}-${m.scale}`;

/** "Frame · Large", "Mosaic · 96 × 48 studs" */
export function modelLabel(m: SqModel): string {
  const scale = m.scale === 'large' ? 'Large' : 'Small';
  if (m.format === 'relief') return `${DISPLAY[m.display ?? 'frame']} · ${scale}`;
  const ext = (a: 'x' | 'z', b: 'w' | 'd') => Math.max(...m.pieces.map(p => p[a] + p[b])) - Math.min(...m.pieces.map(p => p[a]));
  return `Mosaic · ${ext('x', 'w')} × ${ext('z', 'd')} studs`;
}

/** "54 × 29 cm": on the wall width × height, a Mosaic width × depth, else width × depth × height */
export function sizeText(m: SqModel): string {
  const [a, b, c] = m.dims.map(v => Math.round(v));
  return m.pose === 'wall' ? `${a} × ${c} cm` : m.format === 'mosaic' ? `${a} × ${b} cm` : `${a} × ${b} × ${c} cm`;
}

const pieces = (m: SqModel) => m.bom.reduce((a, l) => a + l.qty, 0);
const fix = (v: number, d: number) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
/** "1.2 kg", "750 g": as on the page and in the booklet */
const kg = (g: number) => (g >= 995 ? `${(g / 1000).toFixed(1)} kg` : `${Math.round(g / 10) * 10} g`);

// ---------- parts and order files ----------

/**
 * Parts list for people: one line per lot, its section (Squiggle or Display),
 * BrickLink part and colour, LEGO Element ID, weight and estimated price of the
 * lot, then a TOTAL line. CRLF, UTF-8.
 */
export function partsCSV(m: SqModel): string {
  const rows: (string | number)[][] = [['Section', 'BrickLink part', 'Part', 'Colour', 'BrickLink colour', 'Qty', 'LEGO Element ID', 'Grams', 'Est. price (EUR)']];
  let g = 0, eur = 0;
  for (const l of m.bom) {
    rows.push([SECTION[l.role], brickLinkId(l.part), l.hidden ? `${l.name} (hidden support)` : l.name, l.colorName, l.color, l.qty,
      elementId(l.part, l.color) ?? '', fix(l.qty * l.grams, 1), fix(l.qty * l.price, 2)]);
    g += l.qty * l.grams; eur += l.qty * l.price;
  }
  rows.push(['TOTAL', '', `${m.bom.length} lots`, '', '', pieces(m), '', fix(g, 1), fix(eur, 2)]);
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** BrickLink wanted list (Want → Upload, "BrickLink XML format") with every lot, merged by part and colour. */
export const brickLinkXML = (m: SqModel): string => blXML(m);

/** LEGO Pick a Brick upload files ("Upload List"), in LEGO's exact template. */
export const pickABrickFiles = (m: SqModel): string[] => pabFiles(m);

/** "-pick-a-brick.csv", or "-pick-a-brick-1-of-2.csv"… when the list needs several files */
export const pickABrickNames = (m: SqModel, src: SquiggleInfo, n = pickABrickFiles(m).length) =>
  Array.from({ length: n }, (_, i) => `${fileBase(m, src)}-pick-a-brick${n > 1 ? `-${i + 1}-of-${n}` : ''}.csv`);

// ---------- nameplate ----------

/** The nameplate at real size (600 dpi): plain, and on a white sheet with cut marks. */
export async function nameplateFiles(m: SqModel): Promise<{ plain: Blob; cutMarks: Blob }> {
  const lines = m.nameplate?.lines ?? [`Chromie Squiggle #${m.id}`, 'Snowfro · Art Blocks · 2020'];
  const [plain, cutMarks] = await Promise.all([nameplatePNG(lines), nameplatePNG(lines, 600, { cutMarks: true })]);
  return { plain, cutMarks };
}

// ---------- share image ----------

const SHARE = { w: 1200, h: 630, band: 102 }, INK = '#16242f', MUTED = '#5a6b78';
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, Helvetica, Arial, sans-serif';

/** a box in pixels */
export interface Box { x0: number; y0: number; x1: number; y1: number }

/**
 * The share image's camera: the page's default view, but a table display lower
 * and more from the front (the Squiggle spreads across the picture; the Backdrop
 * a little lower still, its wall rising behind the Squiggle) and the Mosaic
 * almost from the front, like a picture.
 */
export function shareView(m: SqModel): Partial<View> {
  if (m.pose === 'wall') return {};
  if (m.format === 'mosaic') return { az: -4, el: 78 };
  return m.display === 'backdrop' ? { az: -10, el: 24 } : { az: -10, el: 30 };
}

/**
 * What the share image frames: the whole model, but on a table display only the
 * Squiggle (ribbon, clear supports, nameplate) from side to side and at the top,
 * so that it fills the picture: the base runs off the side. The Backdrop adds its
 * wall up to a brick above the Squiggle's top: standing behind the Squiggle, the
 * wall shows a few rows above it, and the rest runs off the picture's top edge
 * (shareImage). The bottom is always the model's (the base's front edge stays
 * clear of the caption), and no piece goes behind the original's print (renderModel).
 */
export function shareSubject(m: SqModel): (p: Piece) => boolean {
  if (m.format !== 'relief' || (m.display !== 'floating' && m.display !== 'backdrop')) return () => true;
  const squiggle = (p: Piece) => p.role === 'squiggle' || !!p.support || !!p.nameplate;
  if (m.display === 'floating') return squiggle;
  const top = Math.max(...m.pieces.filter(p => p.role === 'squiggle').map(p => p.y + p.h)) + 3;
  return p => squiggle(p) || (p.role === 'display' && p.c === WHITE && p.y + p.h <= top);
}

/** "674 pieces · Frame · 54 × 29 cm", like the video's titles */
export const figuresText = (m: SqModel) =>
  `${pieces(m).toLocaleString('en')} pieces · ${m.format === 'mosaic' ? 'Mosaic' : DISPLAY[m.display ?? 'frame']} · ${sizeText(m)}`;

/**
 * Zoom (about the centre of a w×h render) and shift (px) that bring `box`, the
 * model as rendered, into `region` as large as it fits, centred.
 */
export function fitInto(box: Box, region: Box, w: number, h: number): { k: number; dx: number; dy: number } {
  const k = Math.min((region.x1 - region.x0) / (box.x1 - box.x0), (region.y1 - region.y0) / (box.y1 - box.y0));
  const to = (a0: number, a1: number, r0: number, r1: number, c: number) => (r0 + r1) / 2 - (c + ((a0 + a1) / 2 - c) * k);
  return { k, dx: to(box.x0, box.x1, region.x0, region.x1, w / 2), dy: to(box.y0, box.y1, region.y0, region.y1, h / 2) };
}

/**
 * How far (px) the model, placed by `f`, reaches left of the right edge of a box
 * of `clear` within that box's rows, at most (≤ 0: it stays clear of them all).
 * `segs`: the pieces' box edges as rendered, x0 y0 x1 y1 each (a box's outline
 * is made of its edges, and x runs linearly along an edge: the leftmost point in
 * the rows is at an end of an edge's part in them).
 */
export function reach(segs: ArrayLike<number>, f: { k: number; dx: number; dy: number }, clear: Box[], w: number, h: number): number {
  const X = (v: number) => w / 2 + (v - w / 2) * f.k + f.dx, Y = (v: number) => h / 2 + (v - h / 2) * f.k + f.dy;
  const min = clear.map(() => Infinity);
  for (let i = 0; i + 3 < segs.length; i += 4) {
    let ax = X(segs[i]), ay = Y(segs[i + 1]), bx = X(segs[i + 2]), by = Y(segs[i + 3]);
    if (ay > by) [ax, ay, bx, by] = [bx, by, ax, ay];
    clear.forEach((r, j) => {
      const y0 = Math.max(ay, r.y0), y1 = Math.min(by, r.y1);
      if (y0 <= y1) for (const y of [y0, y1]) min[j] = Math.min(min[j], by === ay ? Math.min(ax, bx) : ax + ((bx - ax) * (y - ay)) / (by - ay));
    });
  }
  return Math.max(-Infinity, ...clear.map((r, j) => r.x1 - min[j]));
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  if (/^https?:/.test(url)) img.crossOrigin = 'anonymous';
  img.src = url;
  return img.decode().then(() => img);
}

/**
 * The model on the Stage (studio light, Frame hung on the wall), off-screen, w×h: the `subject` pieces fill
 * `region` from side to side and at the top, no piece goes below its bottom, and none into `clear` (the
 * original's print, left of the region: the model moves right, and shrinks if it must, until it stays clear).
 */
async function renderModel(m: SqModel, w: number, h: number, region: Box, view: Partial<View>, subject: (p: Piece) => boolean, clear: Box[]): Promise<string> {
  const [{ Stage }, { Vector3 }] = await Promise.all([import('./stage'), import('three')]);
  const st = new Stage(w, h), cam = st.camera, v = new Vector3(), box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const segs = new Float64Array(m.pieces.length * 48), c = new Float64Array(16);
  try {
    st.setModel(m, view);
    cam.updateMatrixWorld();
    // where the pieces' corners land, then the same camera zoomed (field of view) and shifted (view offset): the
    // perspective stays that of the view
    m.pieces.forEach((p, i) => {
      const { min: a, max: b } = st.pieceBox([i]), s = subject(p);
      for (let j = 0; j < 8; j++) {
        v.set(j & 1 ? b.x : a.x, j & 2 ? b.y : a.y, j & 4 ? b.z : a.z).project(cam);
        const px = ((v.x + 1) / 2) * w, py = ((1 - v.y) / 2) * h;
        c[2 * j] = px; c[2 * j + 1] = py;
        box.y1 = Math.max(box.y1, py);
        if (s) { box.x0 = Math.min(box.x0, px); box.x1 = Math.max(box.x1, px); box.y0 = Math.min(box.y0, py); }
      }
      let n = i * 48;   // the box's 12 edges: corners one bit apart
      for (let j = 0; j < 8; j++) for (const e of [1, 2, 4]) if (!(j & e)) { segs[n++] = c[2 * j]; segs[n++] = c[2 * j + 1]; segs[n++] = c[2 * (j | e)]; segs[n++] = c[2 * (j | e) + 1]; }
    });
    let f = fitInto(box, region, w, h);
    for (let i = 0, x0 = region.x0, over: number; i < 24 && (over = reach(segs, f, clear, w, h)) > 0.5; i++) f = fitInto(box, { ...region, x0: (x0 += over) }, w, h);
    cam.fov = (Math.atan(Math.tan((cam.fov * Math.PI) / 360) / f.k) * 360) / Math.PI;
    cam.setViewOffset(w, h, -f.dx, -f.dy, w, h);
    return st.toDataURL('image/png');
  } finally { st.dispose(); }   // dispose() frees its own context
}

type Ctx = CanvasRenderingContext2D;
/** Largest font size ≤ size (px) at which text fits maxW; leaves ctx.font set. */
function fit(x: Ctx, text: string, weight: number, size: number, maxW: number): number {
  for (; size > 10; size -= 1) { x.font = `${weight} ${size}px ${FONT}`; if (x.measureText(text).width <= maxW) break; }
  return size;
}

/**
 * Share image, 1200×630 PNG: the model render on the light grey studio, the
 * original Squiggle as a small framed print beside it, and a caption band: name,
 * pieces, display and size on the left, the site's name and address on the
 * right. The model fills the space right of the print and above the caption,
 * centred, and never runs behind the print or its label.
 */
export async function shareImage(m: SqModel, src: SquiggleInfo, o: { view?: Partial<View> } = {}): Promise<Blob> {
  const { w: W, h: H, band } = SHARE;
  const original = await loadImage(src.original).catch(() => null);
  const region = { x0: original ? 300 : 64, y0: 30, x1: W - 40, y1: H - band - 28 };
  const cx = (region.x0 + region.x1) / 2, cy = (region.y0 + region.y1) / 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d')!;

  // the original, a small framed print on the studio's wall, its label under it; the model keeps clear of both
  const maxW = 196, maxH = 150, fr = 7, k = original ? Math.min(maxW / original.naturalWidth, maxH / original.naturalHeight) : 0;
  const iw = Math.round((original?.naturalWidth ?? 0) * k), ih = Math.round((original?.naturalHeight ?? 0) * k);
  const ix = Math.round(64 + (maxW - iw) / 2), iy = Math.round(cy - ih / 2 - 10), lx = ix + iw / 2 + 1, ly = iy + ih + fr + 34;
  x.font = `600 14px ${FONT}`; x.letterSpacing = '0.14em';
  const lw = x.measureText('ORIGINAL').width, gap = 18;
  const clear = original ? [{ x0: 0, y0: iy - fr - gap, x1: ix + iw + fr + gap, y1: iy + ih + fr + gap }, { x0: 0, y0: ly - 16 - gap, x1: lx + lw / 2 + gap, y1: ly + 4 + gap }] : [];
  // the Backdrop's wall runs off the top: its framed part may reach the top edge
  const top = m.format === 'relief' && m.display === 'backdrop' ? 0 : region.y0;
  const shot = await loadImage(await renderModel(m, W, H, { ...region, y0: top }, { ...shareView(m), ...o.view }, shareSubject(m), clear));

  // the studio, a soft vignette lighter around the model
  x.drawImage(shot, 0, 0);
  const vg = x.createRadialGradient(cx, cy, 120, cx, cy, 900);
  vg.addColorStop(0, 'rgba(255,255,255,0.10)'); vg.addColorStop(0.55, 'rgba(255,255,255,0)'); vg.addColorStop(1, 'rgba(24,34,44,0.09)');
  x.fillStyle = vg; x.fillRect(0, 0, W, H);

  if (original) {
    x.save();
    x.shadowColor = 'rgba(20,28,36,0.30)'; x.shadowBlur = 22; x.shadowOffsetX = 5; x.shadowOffsetY = 9;
    x.fillStyle = '#161616'; x.fillRect(ix - fr, iy - fr, iw + 2 * fr, ih + 2 * fr);
    x.restore();
    x.strokeStyle = 'rgba(255,255,255,0.3)'; x.lineWidth = 1.5; x.strokeRect(ix - fr - 0.75, iy - fr - 0.75, iw + 2 * fr + 1.5, ih + 2 * fr + 1.5);
    x.fillStyle = '#2a2a2a'; x.fillRect(ix - 1, iy - 1, iw + 2, ih + 2);
    x.imageSmoothingQuality = 'high';
    x.drawImage(original, ix, iy, iw, ih);
    x.font = `600 14px ${FONT}`; x.fillStyle = MUTED; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.fillText('ORIGINAL', lx, ly);
  }
  x.letterSpacing = '0px';

  // caption band: name, pieces · size | site
  const pad = 64, base1 = H - 66, base2 = H - 30;
  x.textBaseline = 'alphabetic';
  x.textAlign = 'right'; x.fillStyle = INK; x.font = `800 24px ${FONT}`;
  const siteW = x.measureText(SITE_NAME).width;
  x.fillText(SITE_NAME, W - pad, base1);
  const url = SITE_URL.replace(/^https:\/\/|\/$/g, '');
  x.fillStyle = MUTED; fit(x, url, 500, 17, 400);
  const urlW = x.measureText(url).width;
  x.fillText(url, W - pad, base2);
  // the mark: a little squiggle of eleven bricks, one per spectrum colour, stepping up and down
  const bw = 7, mw = SPECTRUM.length * bw, sx = W - pad - siteW - 14 - mw;
  SPECTRUM.forEach((s, i) => { x.fillStyle = renderHex(s.id); x.fillRect(sx + i * bw, base1 - 17 + Math.round(Math.sin(i * 0.7) * 4), bw, 12); });
  const room = W - pad - Math.max(siteW + 14 + mw, urlW) - 48 - pad;
  const title = `${squiggleName(src)} in bricks`, figures = figuresText(m);
  x.textAlign = 'left'; x.fillStyle = INK; fit(x, title, 800, 42, room);
  x.fillText(title, pad, base1);
  x.fillStyle = MUTED; fit(x, figures, 500, 24, room);
  x.fillText(figures, pad, base2);
  return new Promise<Blob>((ok, ko) => c.toBlob(b => (b ? ok(b) : ko(new Error('PNG encoding failed'))), 'image/png'));
}

// ---------- the kit ----------

/** README.txt of the kit: what each file is, how to order, the nameplate, hanging, disclaimer, credits. */
export function kitReadme(m: SqModel, src: SquiggleInfo, files: { name: string; about: string }[]): string {
  const s = m.subtotals, pab = files.filter(f => f.name.includes('-pick-a-brick'));
  // the figures as the page shows them, with what each one measures
  const thick = m.dims[1] < 10 ? m.dims[1].toFixed(1) : String(Math.round(m.dims[1]));
  const size = `${sizeText(m)} (${m.pose === 'wall' ? `wide × high), ${thick} cm thick` : m.format === 'mosaic' ? 'wide × deep)' : 'wide × deep × high)'}`;
  const w = Math.max(...files.map(f => f.name.length)) + 3;
  const out = [
    `${squiggleName(src)} in bricks: ${modelLabel(m)}`,
    `Made with ${SITE_NAME}: ${SITE_URL}`,
    '',
    `${pieces(m).toLocaleString('en')} pieces in ${m.bom.length} lots (Squiggle ${s.squiggle.pieces.toLocaleString('en')} · Display ${s.display.pieces.toLocaleString('en')}) · ${m.steps.length} build steps`,
    `Size ≈ ${size} · Weight ≈ ${kg(m.grams)}`,
    `Cost ≈ €${m.cost}: an estimate from LEGO Pick a Brick prices (Sept 2026), an order of magnitude, not a quote.`,
    '',
    'FILES',
    ...files.map(f => `${f.name.padEnd(w)}${f.about}`),
    '',
    'HOW TO ORDER THE BRICKS',
    `LEGO Pick a Brick, LEGO's own shop for single pieces: open https://www.lego.com/pick-and-build/pick-a-brick, click "Upload List" next to the search bar and choose ${pab.length > 1 ? `the Pick a Brick files, one after the other (${pab.length} files: at most 400 references per file)` : 'the Pick a Brick file'}. LEGO adds every piece it has to your bag and lists any it couldn't add: get those on BrickLink. Uploading a list isn't available in every country.`,
    'BrickLink, a marketplace of independent shops: sign in, open Want → Upload (https://www.bricklink.com/v2/wanted/upload.page), choose "Upload BrickLink XML format", paste the content of the .xml file, then open the new wanted list and use "Buy All" to find shops.',
    'Always review your cart carefully before paying. You buy directly from LEGO or from BrickLink sellers: prices, availability, shipping, returns and customer service are entirely theirs.',
    '',
    'THE NAMEPLATE',
    `The black 2 × 6 tile carries the Squiggle's name: "${m.nameplate?.lines.join(' / ') ?? squiggleName(src)}". Print the nameplate PNG at 100 % (not "fit to page": it is ${NAMEPLATE_MM[0]} × ${NAMEPLATE_MM[1]} mm at 600 dpi) on white sticker paper, cut it along the marks and stick it on the tile. Or have a black 2 × 6 tile engraved with the same text.`,
  ];
  if (m.hanging) out.push('', 'HANGING THE FRAME', `${m.hanging.advice} The instructions show where, on the "Hanging" page.`);
  if (m.bom.some(l => l.hidden)) out.push('', 'THE CLEAR PIECES', 'The Trans-Clear round pieces are the hidden supports: they hold the Squiggle above the base and almost disappear.');
  const notes = [...(src.notes ?? []), ...m.notes.filter(n => n !== m.hanging?.advice)];
  if (src.origin === 'image' || src.origin === 'upload') notes.unshift('The Squiggle was read from an image: its variant details are approximate.');
  if (notes.length) out.push('', 'NOTES', ...notes.map(n => `- ${n}`));
  out.push('', 'PLEASE READ',
    'Models are generated automatically and checked by software only. They have NOT been physically built. Parts may be missing, wrong or unavailable, and the result may not hold together.',
    'Weights and prices are estimates. Provided "as is", without warranty of any kind. Use at your own risk.',
    'Personal use only: do not sell the models, the instructions or kits made from them.',
    'Unofficial fan project · Not affiliated with, sponsored or endorsed by Art Blocks, the LEGO Group or BrickLink. LEGO® is a trademark of the LEGO Group. Parts data: Rebrickable.',
    '', 'CREDITS',
    "Chromie Squiggle by Snowfro / Art Blocks. Made by John Karp. Inspired by @victormustar's Microduck (https://x.com/victormustar).",
    `Source code (MIT License): ${SOURCE_URL}`, '');
  return out.join('\r\n');
}

/**
 * The full kit as a ZIP: instructions PDF (`booklet`), parts list, BrickLink and
 * Pick a Brick lists, nameplate PNGs, share image and README.txt. The share image
 * and the nameplate are drawn unless given.
 */
export async function makeKit(m: SqModel, src: SquiggleInfo, booklet: Blob, o: { share?: Blob; nameplate?: { plain: Blob; cutMarks: Blob } } = {}): Promise<Blob> {
  const base = fileBase(m, src), pab = pickABrickFiles(m), pabNames = pickABrickNames(m, src, pab.length);
  const [share, np] = await Promise.all([o.share ?? shareImage(m, src), o.nameplate ?? nameplateFiles(m)]);
  const files: { name: string; data: Blob | string; about: string }[] = [
    { name: `${base}-instructions.pdf`, data: booklet, about: 'step-by-step building instructions, with the parts list and the nameplate to print' },
    { name: `${base}-parts.csv`, data: partsCSV(m), about: 'parts list, one line per lot, Squiggle and Display sections: BrickLink part and colour, LEGO Element ID, weight, estimated price' },
    ...pab.map((data, i) => ({ name: pabNames[i], data, about: `LEGO Pick a Brick upload list (Element IDs and quantities)${pab.length > 1 ? `, file ${i + 1} of ${pab.length}` : ''}` })),
    { name: `${base}-bricklink.xml`, data: brickLinkXML(m), about: 'BrickLink wanted list with every lot' },
    { name: `${base}-nameplate.png`, data: np.plain, about: `the nameplate at real size (${NAMEPLATE_MM[0]} × ${NAMEPLATE_MM[1]} mm, 600 dpi)` },
    { name: `${base}-nameplate-cut-marks.png`, data: np.cutMarks, about: 'the same on a white sheet, with cut marks' },
    { name: `${base}-share.png`, data: share, about: 'a picture to share (1200 × 630)' },
  ];
  const readme = kitReadme(m, src, [...files, { name: 'README.txt', about: 'this file' }]);
  return makeZip([...files.map(({ name, data }) => ({ name, data })), { name: 'README.txt', data: readme }]);
}
