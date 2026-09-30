// Order files: LEGO Pick a Brick upload list, and what's left for BrickLink.
// They take any parts list made of lots (see Lot).
import { elementId } from '../core/lego';
import { brickLinkXML, mergeLots, type Lot } from './parts';

/** Pick a Brick "Upload List" limits (stated on the upload dialog, Sept 2026). */
export const PAB_MAX_LINES = 400;
export const PAB_MAX_QTY = 999;

export interface OrderSummary<L extends Lot = Lot> {
  lego: (L & { elementId: string })[];   // lots with a LEGO Element ID
  brickLinkOnly: L[];                    // lots not available at LEGO
  legoPieces: number;
  brickLinkOnlyPieces: number;
}

export function orderSummary<L extends Lot>(m: { bom: L[] }): OrderSummary<L> {
  const lego: OrderSummary<L>['lego'] = [], brickLinkOnly: L[] = [];
  for (const b of m.bom) {
    const id = elementId(b.part, b.color);
    if (id) lego.push({ ...b, elementId: id }); else brickLinkOnly.push(b);
  }
  return {
    lego, brickLinkOnly,
    legoPieces: lego.reduce((a, b) => a + b.qty, 0),
    brickLinkOnlyPieces: brickLinkOnly.reduce((a, b) => a + b.qty, 0),
  };
}

/**
 * Pick a Brick upload files, in the exact format of LEGO's own CSV template:
 * header "elementId,quantity", comma separated, CRLF line breaks, no trailing
 * line break. At most 400 references per file and 999 units per reference:
 * a reference needing more is split into 999-unit lines spread over files.
 * Lots sharing an Element ID (one per section) are ordered as one line.
 */
export function pickABrickFiles(m: { bom: Lot[] }): string[] {
  const chunks: { id: string; qty: number; round: number }[] = [];
  for (const l of mergeLots(orderSummary(m).lego, l => l.elementId))
    for (let left = l.qty, round = 0; left > 0; left -= PAB_MAX_QTY) chunks.push({ id: l.elementId, qty: Math.min(PAB_MAX_QTY, left), round: round++ });
  // every element's first line, then the second lines...: the fewest files
  chunks.sort((a, b) => a.round - b.round);
  const files: { id: string; qty: number }[][] = [];
  for (const c of chunks) {
    // first file with room that doesn't already list this element
    let f = files.find(f => f.length < PAB_MAX_LINES && !f.some(x => x.id === c.id));
    if (!f) files.push(f = []);
    f.push(c);
  }
  return files.map(f => ['elementId,quantity', ...f.map(c => `${c.id},${c.qty}`)].join('\r\n'));
}

/** BrickLink wanted list of only the lots LEGO doesn't sell. */
export function brickLinkRemainderXML(m: { bom: Lot[] }): string {
  return brickLinkXML({ bom: orderSummary(m).brickLinkOnly });
}
