// Parts list helpers and the XML "wanted list" for BrickLink (Want → Upload).
// They take any parts list made of lots (part, colour, quantity).

/** One line of a parts list, as the order files need it: BrickLink part and colour, quantity */
export interface Lot { part: string; color: number; qty: number }

/** Our part numbers that BrickLink files under another number (theirs lists ours as alternates, which uploads don't resolve) */
export const BRICKLINK_ID: Record<string, string> = { '3062b': '3062', 6141: '4073' };
export const brickLinkId = (part: string) => BRICKLINK_ID[part] ?? part;

/** Lots with the same key merged (a part and colour can be listed once per section), in first-seen order. */
export function mergeLots<L extends Lot>(bom: L[], key: (l: L) => string = l => `${l.part}|${l.color}`): L[] {
  const map = new Map<string, L>();
  for (const l of bom) {
    const k = key(l), seen = map.get(k);
    if (seen) seen.qty += l.qty; else map.set(k, { ...l });
  }
  return [...map.values()];
}

export const csvCell = (v: string | number) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** BrickLink wanted list: condition "any" (X), one item per part and colour. */
export function brickLinkXML(m: { bom: Lot[] }): string {
  const items = mergeLots(m.bom).map(b => `<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${brickLinkId(b.part)}</ITEMID><COLOR>${b.color}</COLOR><MINQTY>${b.qty}</MINQTY><CONDITION>X</CONDITION></ITEM>`);
  return `<INVENTORY>\n${items.join('\n')}\n</INVENTORY>\n`;
}
