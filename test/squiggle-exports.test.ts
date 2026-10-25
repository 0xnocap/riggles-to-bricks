import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import data from '../src/data/elements.json';
import { elementId } from '../src/core/lego';
import { TRANS_CLEAR } from '../src/core/palette';
import { PAB_MAX_LINES, PAB_MAX_QTY } from '../src/export/order';
import { readCurve } from '../src/squiggle/curve';
import { buildRelief } from '../src/squiggle/display';
import { brickLinkXML, fileBase, fitInto, kitReadme, makeKit, partsCSV, pickABrickFiles, pickABrickNames, shareView, sizeText, type SquiggleInfo } from '../src/squiggle/exports';
import type { Display, Scale, SqBomLine, SqModel } from '../src/squiggle/model';
import { buildMosaic } from '../src/squiggle/mosaic';

const fixture = (id: number) => JSON.parse(readFileSync(`test/fixtures/squiggles/${id}.json`, 'utf8'));
const models = new Map<string, SqModel>();
function model(id: number, kind: Display | 'mosaic', scale: Scale): SqModel {
  const k = `${id}-${kind}-${scale}`;
  if (!models.has(k)) {
    const fx = fixture(id), curve = readCurve(fx), meta = { id: fx.id, hash: fx.hash };
    models.set(k, kind === 'mosaic' ? buildMosaic(curve, scale, meta) : buildRelief(curve, kind, scale, meta));
  }
  return models.get(k)!;
}
const info = (id: number): SquiggleInfo => ({ id, hash: fixture(id).hash, original: 'data:image/png;base64,', origin: 'script' });

const lot = (part: string, color: number, qty: number, role: SqBomLine['role'] = 'display', more: Partial<SqBomLine> = {}) =>
  ({ part, color, qty, role, kind: 'tile', name: `Part ${part}`, colorName: `Colour ${color}`, hex: '#000', w: 1, d: 1, h: 1, hidden: false, grams: 1, price: 0.1, ...more }) as SqBomLine;
const bomModel = (bom: SqBomLine[]) => ({ bom }) as unknown as SqModel;

/** Pick a Brick rows, checking LEGO's template on the way */
function pabRows(files: string[]) {
  return files.flatMap(f => {
    expect(f.startsWith('elementId,quantity\r\n')).toBe(true);
    expect(f.endsWith('\r\n') || f.endsWith('\n')).toBe(false);
    expect(f.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(f.charCodeAt(0)).not.toBe(0xfeff);
    const rows = f.split('\r\n').slice(1).map(l => { const [id, q, ...rest] = l.split(','); expect(rest).toEqual([]); return { id, qty: +q }; });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(PAB_MAX_LINES);
    for (const r of rows) { expect(r.id).toMatch(/^\d+$/); expect(Number.isInteger(r.qty) && r.qty >= 1 && r.qty <= PAB_MAX_QTY).toBe(true); }
    expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);
    return rows;
  });
}

/** a strict little XML check: only <TAG>…</TAG> elements, properly nested, one root, no stray markup in text */
function xmlTree(xml: string) {
  const stack: { tag: string; kids: { tag: string; text: string }[]; text: string }[] = [], items: Record<string, string>[] = [];
  let roots = 0;
  for (const tok of xml.split(/(<[^>]*>)/)) {
    if (!tok.startsWith('<')) {
      expect(tok).not.toMatch(/[<>&]/);
      if (!stack.length) expect(tok.trim()).toBe('');
      else stack[stack.length - 1].text += tok;
      continue;
    }
    const m = tok.match(/^<(\/?)([A-Z]+)>$/);
    expect(m, tok).not.toBeNull();
    if (!m![1]) { if (!stack.length) roots++; stack.push({ tag: m![2], kids: [], text: '' }); continue; }
    const el = stack.pop()!;
    expect(el?.tag).toBe(m![2]);
    if (el.tag === 'ITEM') items.push(Object.fromEntries(el.kids.map(k => [k.tag, k.text])));
    stack[stack.length - 1]?.kids.push({ tag: el.tag, text: el.text });
  }
  expect(stack.length).toBe(0);
  expect(roots).toBe(1);
  expect(xml.trimStart().startsWith('<INVENTORY>')).toBe(true);
  return items;
}

function parseCSV(csv: string): string[][] {
  expect(csv.endsWith('\r\n')).toBe(true);
  return csv.slice(0, -2).split('\r\n').map(line => {
    const out: string[] = [];
    for (let i = 0; i <= line.length;) {
      if (line[i] === '"') { let v = ''; i++; for (; i < line.length; i++) { if (line[i] === '"') { if (line[i + 1] === '"') { v += '"'; i++; } else break; } else v += line[i]; } out.push(v); i += 2; } else { const j = line.indexOf(',', i); const e = j < 0 ? line.length : j; out.push(line.slice(i, e)); i = e + 1; }
    }
    return out;
  });
}

/** the files of a stored (uncompressed) ZIP, as makeZip writes it */
function unzip(buf: Uint8Array) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), out: { name: string; data: Uint8Array }[] = [];
  for (let i = 0; v.getUint32(i, true) === 0x04034b50;) {
    const size = v.getUint32(i + 18, true), n = v.getUint16(i + 26, true), x = v.getUint16(i + 28, true);
    out.push({ name: new TextDecoder().decode(buf.subarray(i + 30, i + 30 + n)), data: buf.subarray(i + 30 + n + x, i + 30 + n + x + size) });
    i += 30 + n + x + size;
  }
  return out;
}

describe('Pick a Brick files', () => {
  it('match LEGO\'s template byte for byte, one line per element', () => {
    const m = bomModel([lot('3069', 11, 12, 'squiggle'), lot('69729', 11, 1), lot('3069', 11, 30), lot('6141', TRANS_CLEAR, 21), lot('3062b', TRANS_CLEAR, 42)]);
    const files = pickABrickFiles(m);
    expect(files).toEqual(['elementId,quantity\r\n306926,42\r\n6318582,1\r\n6514052,21\r\n6514232,42']);
    expect([...new TextEncoder().encode(files[0])]).toEqual([...Buffer.from('656c656d656e7449642c7175616e746974790d0a3330363932362c34320d0a363331383538322c310d0a363531343035322c32310d0a363531343233322c3432', 'hex')]);
  });

  it('split at 400 lines per file and 999 units per line', () => {
    const keys = Object.keys(data.elements).slice(0, 450).map(k => k.split('|'));
    const exact = pickABrickFiles(bomModel(keys.slice(0, 400).map(([p, c]) => lot(p, +c, 999))));
    expect(exact.length).toBe(1);
    expect(pabRows(exact).every(r => r.qty === 999)).toBe(true);
    const over = pickABrickFiles(bomModel(keys.slice(0, 401).map(([p, c]) => lot(p, +c, 1000))));
    const rows = pabRows(over);
    expect(over.map(f => f.split('\r\n').length - 1)).toEqual([400, 400, 2]);   // 401 × (999 + 1) = 802 lines
    for (const [p, c] of keys.slice(0, 401)) expect(rows.filter(r => r.id === elementId(p, +c)).map(r => r.qty).sort((a, b) => a - b)).toEqual([1, 999]);
    const bom = keys.map(([p, c], i) => lot(p, +c, i === 7 ? 2500 : 1 + (i % 5)));
    const big = pickABrickFiles(bomModel(bom));
    expect(big.length).toBe(3);                                                 // 2,500 units need 3 lines of ≤ 999, one per file
    const r2 = pabRows(big);
    for (const l of bom) expect(r2.filter(r => r.id === elementId(l.part, l.color)).reduce((a, r) => a + r.qty, 0)).toBe(l.qty);
    expect(pickABrickNames(bomModel(bom), { id: 1234, hash: null, original: '' }, 3).map(n => n.replace(/^.*-pick/, 'pick')))
      .toEqual(['pick-a-brick-1-of-3.csv', 'pick-a-brick-2-of-3.csv', 'pick-a-brick-3-of-3.csv']);
  });
});

describe('Squiggle exports on real models', () => {
  const cases: [number, Display | 'mosaic', Scale][] = [[1234, 'frame', 'large'], [7583, 'backdrop', 'large'], [1004, 'floating', 'small'], [1047, 'mosaic', 'large']];
  for (const [id, kind, scale] of cases) it(`#${id} ${kind} ${scale}: CSV, XML and Pick a Brick add up to the model`, () => {
    const m = model(id, kind, scale), n = m.pieces.length;
    // CSV: one line per lot with its section, then TOTAL
    const rows = parseCSV(partsCSV(m)), [head, ...body] = rows, total = body.pop()!;
    expect(head).toEqual(['Section', 'BrickLink part', 'Part', 'Colour', 'BrickLink colour', 'Qty', 'LEGO Element ID', 'Grams', 'Est. price (EUR)']);
    expect(rows.every(r => r.length === head.length)).toBe(true);
    expect(body.length).toBe(m.bom.length);
    const q = head.indexOf('Qty');
    expect(body.reduce((a, r) => a + +r[q], 0)).toBe(n);
    expect(total[0]).toBe('TOTAL');
    expect(+total[q]).toBe(n);
    for (const [role, name] of [['squiggle', 'Riggle'], ['display', 'Display']] as const) {
      const sec = body.filter(r => r[0] === name);
      expect(sec.length).toBe(m.subtotals[role].lots);
      expect(sec.reduce((a, r) => a + +r[q], 0)).toBe(m.subtotals[role].pieces);
    }
    expect(Math.abs(+total[7] - m.grams)).toBeLessThanOrEqual(1);
    expect(Math.abs(+total[8] - m.cost)).toBeLessThanOrEqual(1);
    expect(body.every(r => /^\d+$/.test(r[6]))).toBe(true);                 // every lot has a LEGO Element ID
    // BrickLink XML: well formed, every piece, BrickLink's own numbers
    const items = xmlTree(brickLinkXML(m));
    expect(items.every(i => i.ITEMTYPE === 'P' && /^\w+$/.test(i.ITEMID) && /^\d+$/.test(i.COLOR) && +i.MINQTY >= 1 && i.CONDITION === 'X')).toBe(true);
    expect(items.reduce((a, i) => a + +i.MINQTY, 0)).toBe(n);
    expect(new Set(items.map(i => `${i.ITEMID}|${i.COLOR}`)).size).toBe(items.length);
    expect(items.some(i => i.ITEMID === '3062b' || i.ITEMID === '6141')).toBe(false);
    if (kind === 'floating' || kind === 'backdrop') {
      expect(items.find(i => i.ITEMID === '3062' && +i.COLOR === TRANS_CLEAR)).toBeTruthy();
      expect(items.find(i => i.ITEMID === '4073' && +i.COLOR === TRANS_CLEAR)).toBeTruthy();
      expect(body.some(r => r[2].includes('hidden support') && r[3] === 'Trans-Clear')).toBe(true);
    }
    // Pick a Brick: every piece, since every lot has an Element ID
    expect(pabRows(pickABrickFiles(m)).reduce((a, r) => a + r.qty, 0)).toBe(n);
    expect(sizeText(m)).toMatch(/^\d+ × \d+( × \d+)? cm$/);
  });

  it('the kit ZIP holds every file, the README explains them', async () => {
    const m = model(1234, 'frame', 'large'), src = info(1234), base = fileBase(m, src);
    expect(base).toBe('riggle-1234-frame-large');
    const booklet = new Blob(['%PDF-1.4 booklet'], { type: 'application/pdf' });
    const png = (s: string) => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47]), s], { type: 'image/png' });
    const zip = await makeKit(m, src, booklet, { share: png('share'), nameplate: { plain: png('plain'), cutMarks: png('cut') } });
    const files = unzip(new Uint8Array(await zip.arrayBuffer())), text = (name: string) => new TextDecoder().decode(files.find(f => f.name === name)!.data);
    expect(files.map(f => f.name)).toEqual([
      `${base}-instructions.pdf`, `${base}-parts.csv`, `${base}-pick-a-brick.csv`, `${base}-bricklink.xml`,
      `${base}-nameplate.png`, `${base}-nameplate-cut-marks.png`, `${base}-share.png`, 'README.txt',
    ]);
    expect(text(`${base}-instructions.pdf`)).toBe('%PDF-1.4 booklet');
    expect(text(`${base}-parts.csv`)).toBe(partsCSV(m));
    expect(text(`${base}-pick-a-brick.csv`)).toBe(pickABrickFiles(m)[0]);
    expect(text(`${base}-bricklink.xml`)).toBe(brickLinkXML(m));
    expect(text(`${base}-share.png`).endsWith('share')).toBe(true);
    const readme = text('README.txt');
    for (const f of files) expect(readme).toContain(f.name);
    for (const s of ['Riggle #1234 in bricks', `${m.pieces.length} pieces`, 'Upload List', 'Want → Upload', 'HANGING THE FRAME', m.hanging!.advice,
      'NOT been physically built', 'Personal use only', 'Not affiliated with, sponsored or endorsed by the LEGO Group or BrickLink',
      'LEGO® is a trademark of the LEGO Group', 'Riggles is an onchain collection on Robinhood Chain', 'Built on Squiggle to Bricks by John Karp', 'MIT License'])
      expect(readme).toContain(s);
    expect(readme.split(m.hanging!.advice).length).toBe(2);                 // once, not repeated in the notes
    expect(readme).not.toMatch(/\bLEGO (set|kit|model)/);
    expect(readme.replace(/\r\n/g, '')).not.toContain('\n');
    // several Pick a Brick files are listed one by one
    const two = kitReadme(m, src, [{ name: 'a-pick-a-brick-1-of-2.csv', about: '' }, { name: 'a-pick-a-brick-2-of-2.csv', about: '' }]);
    expect(two).toContain('one after the other (2 files');
  });
});

describe('share image framing', () => {
  const region = { x0: 300, y0: 30, x1: 1160, y1: 500 };
  /** the box after the zoom k about the render's centre and the shift */
  const place = (b: typeof region, w: number, h: number) => {
    const { k, dx, dy } = fitInto(b, region, w, h), f = (v: number, c: number, d: number) => c + (v - c) * k + d;
    return { x0: f(b.x0, w / 2, dx), x1: f(b.x1, w / 2, dx), y0: f(b.y0, h / 2, dy), y1: f(b.y1, h / 2, dy) };
  };
  it('fits the model into the region, as large as it goes, centred', () => {
    for (const b of [{ x0: 327, y0: 37, x1: 1155, y1: 490 }, { x0: 455, y0: 28, x1: 1025, y1: 500 }, { x0: 10, y0: 200, x1: 400, y1: 260 }]) {
      const r = place(b, 1200, 630);
      expect((r.x0 + r.x1) / 2).toBeCloseTo(730, 6);
      expect((r.y0 + r.y1) / 2).toBeCloseTo(265, 6);
      expect(r.x0).toBeGreaterThanOrEqual(region.x0 - 1e-6); expect(r.x1).toBeLessThanOrEqual(region.x1 + 1e-6);
      expect(r.y0).toBeGreaterThanOrEqual(region.y0 - 1e-6); expect(r.y1).toBeLessThanOrEqual(region.y1 + 1e-6);
      expect(Math.max(r.x1 - r.x0 - 860, r.y1 - r.y0 - 470)).toBeCloseTo(0, 6);   // touches the region on one axis
    }
  });
  it('shows the Frame from the front, the Mosaic almost from above, the Backdrop low', () => {
    expect(shareView(model(1234, 'frame', 'large'))).toEqual({});
    expect(shareView(model(1047, 'mosaic', 'large')).el).toBeGreaterThanOrEqual(70);
    expect(shareView(model(7583, 'backdrop', 'large')).el).toBeLessThan(shareView(model(1004, 'floating', 'small')).el!);
  });
});
