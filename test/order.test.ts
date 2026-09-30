import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { brickLinkXML, type Lot } from '../src/export/parts';
import { brickLinkRemainderXML, orderSummary, PAB_MAX_LINES, PAB_MAX_QTY, pickABrickFiles } from '../src/export/order';
import { readCurve } from '../src/squiggle/curve';
import { buildRelief } from '../src/squiggle/display';
import { buildMosaic } from '../src/squiggle/mosaic';

// LEGO's own template, copied from the Pick a Brick "Upload List" dialog (CSV Template link)
const LEGO_CSV_TEMPLATE = 'elementId,quantity\r\n300321,18\r\n300121,999';

const xmlTotal = (x: string) => [...x.matchAll(/<MINQTY>(\d+)<\/MINQTY>/g)].reduce((a, m) => a + +m[1], 0);
function parsePab(files: string[]) {
  return files.map(f => {
    expect(f.startsWith('elementId,quantity\r\n')).toBe(true);
    expect(f.endsWith('\r\n')).toBe(false);
    expect(f.replace(/\r\n/g, '')).not.toContain('\n');           // CRLF only
    const rows = f.split('\r\n').slice(1).map(l => { const [id, q] = l.split(','); return { id, qty: +q }; });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(PAB_MAX_LINES);
    for (const r of rows) {
      expect(r.id).toMatch(/^\d+$/);
      expect(Number.isInteger(r.qty) && r.qty >= 1 && r.qty <= PAB_MAX_QTY).toBe(true);
    }
    expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);   // one line per element per file
    return rows;
  }).flat();
}
type Model = { bom: Lot[] };
function expectOrderFilesMatch(m: Model, pieces: number) {
  const total = m.bom.reduce((a, b) => a + b.qty, 0);
  expect(total).toBe(pieces);
  const s = orderSummary(m);
  const rows = parsePab(pickABrickFiles(m));
  // every LEGO element is ordered in full, across files (a part in both sections is one element)
  const want = new Map<string, number>();
  for (const l of s.lego) want.set(l.elementId, (want.get(l.elementId) ?? 0) + l.qty);
  for (const [id, qty] of want) expect(rows.filter(r => r.id === id).reduce((a, r) => a + r.qty, 0)).toBe(qty);
  expect(rows.reduce((a, r) => a + r.qty, 0)).toBe(s.legoPieces);
  expect(s.legoPieces + s.brickLinkOnlyPieces).toBe(total);
  expect(xmlTotal(brickLinkXML(m))).toBe(total);
  expect(xmlTotal(brickLinkRemainderXML(m))).toBe(s.brickLinkOnlyPieces);
}

describe('order files', () => {
  it('reproduces LEGO\'s CSV template byte for byte', () => {
    const m = { bom: [
      { part: '3003', kind: 'brick', name: 'Brick 2 x 2', color: 5, colorName: 'Red', hex: '', w: 2, d: 2, qty: 18 },
      { part: '3001', kind: 'brick', name: 'Brick 2 x 4', color: 5, colorName: 'Red', hex: '', w: 2, d: 4, qty: 999 },
    ] } as unknown as Model;
    expect(pickABrickFiles(m)).toEqual([LEGO_CSV_TEMPLATE]);
  });

  it('splits over 400 references and 999 units', () => {
    const bom = Array.from({ length: 450 }, (_, i) => ({ part: i % 2 ? '3001' : '3003', color: [1, 11, 5, 3, 7, 2, 28, 150, 69, 85, 86, 6, 4, 88, 120][i % 15], qty: 1 }))
      .filter((b, i, a) => a.findIndex(o => o.part === b.part && o.color === b.color) === i);
    const big = { part: '3001', color: 11, qty: 2500 };
    const m = { bom: [...bom.filter(b => !(b.part === '3001' && b.color === 11)), big] } as unknown as Model;
    const files = pickABrickFiles(m);
    const rows = parsePab(files);
    expect(files.length).toBeGreaterThanOrEqual(3);                // 2,500 units need 3 lines of ≤999
    expect(rows.filter(r => r.id === '300126').reduce((a, r) => a + r.qty, 0)).toBe(2500);
    const many = { bom: Array.from({ length: 900 }, (_, i) => ({ part: '3003', color: 5, qty: 1, i })).map((b, i) => ({ ...b, part: String(i) })) } as unknown as Model;
    expect(pickABrickFiles(many)).toEqual([]);                    // unknown parts: nothing for LEGO
  });

  it('sends the lots LEGO does not sell to BrickLink', () => {
    const m = { bom: [{ part: '3001', color: 5, qty: 4 }, { part: '99999', color: 5, qty: 3 }] };
    expect(orderSummary(m).brickLinkOnly).toHaveLength(1);
    expectOrderFilesMatch(m, 7);
  });

  for (const id of [1234, 3784, 102]) {
    const fx = JSON.parse(readFileSync(`test/fixtures/squiggles/${id}.json`, 'utf8')), curve = readCurve(fx), meta = { id, hash: fx.hash };
    it(`#${id}: Pick a Brick + BrickLink files add up to the parts list, every model`, () => {
      for (const m of [buildRelief(curve, 'frame', 'large', meta), buildRelief(curve, 'backdrop', 'small', meta), buildMosaic(curve, 'large', meta)])
        expectOrderFilesMatch(m, m.pieces.length);
    });
  }
});
