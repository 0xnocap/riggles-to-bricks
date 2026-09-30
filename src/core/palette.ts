// Short list of common brick colours (BrickLink colour IDs and names), and how
// each one is drawn on screen.

export interface BrickColor {
  id: number;          // BrickLink colour ID
  name: string;        // BrickLink colour name
  hex: string;         // BrickLink colour value, used for matching
  render?: string;     // how the real brick looks on screen, if different
  trans?: boolean;
}

export const BRICK_COLORS: BrickColor[] = [
  { id: 1, name: 'White', hex: '#F4F4F4' },
  { id: 11, name: 'Black', hex: '#1B1B1B' },
  { id: 86, name: 'Light Bluish Gray', hex: '#A0A5A9' },
  { id: 85, name: 'Dark Bluish Gray', hex: '#6C6E68' },
  { id: 5, name: 'Red', hex: '#C91A09' },
  { id: 59, name: 'Dark Red', hex: '#720E0F' },
  { id: 4, name: 'Orange', hex: '#FE8A18' },
  { id: 3, name: 'Yellow', hex: '#F2CD37' },
  { id: 103, name: 'Bright Light Yellow', hex: '#FFF03A' },
  { id: 2, name: 'Tan', hex: '#E4CD9E' },
  { id: 69, name: 'Dark Tan', hex: '#958A73' },
  { id: 90, name: 'Light Nougat', hex: '#F6D7B3' },
  { id: 28, name: 'Nougat', hex: '#D09168' },
  { id: 150, name: 'Medium Nougat', hex: '#AA7D55' },
  { id: 68, name: 'Dark Orange', hex: '#A95500' },
  { id: 88, name: 'Reddish Brown', hex: '#582A12' },
  { id: 120, name: 'Dark Brown', hex: '#352100' },
  { id: 34, name: 'Lime', hex: '#BBE90B' },
  { id: 36, name: 'Bright Green', hex: '#4B9F4A' },
  { id: 6, name: 'Green', hex: '#237841' },
  { id: 80, name: 'Dark Green', hex: '#184632' },
  { id: 155, name: 'Olive Green', hex: '#9B9A5A' },
  { id: 48, name: 'Sand Green', hex: '#A0BCAC' },
  { id: 152, name: 'Light Aqua', hex: '#ADC3C0', render: '#C9EDE6' },
  { id: 156, name: 'Medium Azure', hex: '#36AEBF' },
  { id: 39, name: 'Dark Turquoise', hex: '#008F9B' },
  { id: 153, name: 'Dark Azure', hex: '#078BC9' },
  { id: 105, name: 'Bright Light Blue', hex: '#9FC3E9' },
  { id: 7, name: 'Blue', hex: '#0055BF' },
  { id: 63, name: 'Dark Blue', hex: '#0A3463' },
  { id: 55, name: 'Sand Blue', hex: '#6074A1' },
  { id: 104, name: 'Bright Pink', hex: '#E4ADC8' },
  { id: 47, name: 'Dark Pink', hex: '#C870A0' },
  { id: 71, name: 'Magenta', hex: '#923978' },
  { id: 89, name: 'Dark Purple', hex: '#4B2E8C' },
  { id: 157, name: 'Medium Lavender', hex: '#AC78BA' },
  { id: 154, name: 'Lavender', hex: '#E1D5ED' },
  { id: 12, name: 'Trans-Clear', hex: '#EEEEEE', trans: true },
  { id: 15, name: 'Trans-Light Blue', hex: '#AEEFEC', trans: true },
  { id: 17, name: 'Trans-Red', hex: '#C91A09', trans: true },
];

export const COLOR_BY_ID = new Map(BRICK_COLORS.map(c => [c.id, c]));
export const BLACK = 11, TRANS_CLEAR = 12;
/** Colour to draw a brick with (3D view, instructions). */
export const renderHex = (id: number) => { const c = COLOR_BY_ID.get(id)!; return c.render ?? c.hex; };
