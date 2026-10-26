// The brick colours the generator may use: BrickLink colour IDs, names and
// values, taken from BrickLink's own colour list.
//
// Every value here was wrong before: the list carried old LDraw style numbers,
// darker and flatter than the bricks really are, and both the matching and the
// render read from them. Light Aqua was held as #ADC3C0, a grey, when the brick
// is #C0F4E7, a bright mint; Medium Azure as #36AEBF when it is #70DCF3. Pastel
// riggles came out muddy because the palette said the bright bricks were dull
// ones, so they were never chosen and never drawn as themselves.

export interface BrickColor {
  id: number;          // BrickLink colour ID
  name: string;        // BrickLink colour name
  hex: string;         // BrickLink colour value, used for matching
  render?: string;     // how the real brick looks on screen, if different
  trans?: boolean;
}

export const BRICK_COLORS: BrickColor[] = [
  { id: 1, name: 'White', hex: '#F3F4EF' },
  { id: 11, name: 'Black', hex: '#2E2E2E' },
  { id: 86, name: 'Light Bluish Gray', hex: '#B9B9B9' },
  { id: 85, name: 'Dark Bluish Gray', hex: '#7D7C78' },
  { id: 5, name: 'Red', hex: '#D82424' },
  { id: 59, name: 'Dark Red', hex: '#83211F' },
  { id: 4, name: 'Orange', hex: '#FF8D34' },
  { id: 3, name: 'Yellow', hex: '#FFDA19' },
  { id: 103, name: 'Bright Light Yellow', hex: '#FCEB82' },
  { id: 2, name: 'Tan', hex: '#E1D19D' },
  { id: 69, name: 'Dark Tan', hex: '#A98F6A' },
  { id: 90, name: 'Light Nougat', hex: '#F7CFB4' },
  { id: 28, name: 'Nougat', hex: '#F1A56B' },
  { id: 150, name: 'Medium Nougat', hex: '#D59459' },
  { id: 68, name: 'Dark Orange', hex: '#AC5112' },
  { id: 88, name: 'Reddish Brown', hex: '#7C442C' },
  { id: 120, name: 'Dark Brown', hex: '#50372F' },
  { id: 34, name: 'Lime', hex: '#BEE13C' },
  { id: 36, name: 'Bright Green', hex: '#2BD043' },
  { id: 6, name: 'Green', hex: '#009D48' },
  { id: 80, name: 'Dark Green', hex: '#30533B' },
  { id: 155, name: 'Olive Green', hex: '#A9A45A' },
  { id: 48, name: 'Sand Green', hex: '#98B69C' },
  { id: 152, name: 'Light Aqua', hex: '#C0F4E7' },
  { id: 156, name: 'Medium Azure', hex: '#70DCF3' },
  { id: 39, name: 'Dark Turquoise', hex: '#0BABA8' },
  { id: 153, name: 'Dark Azure', hex: '#38AEEB' },
  { id: 105, name: 'Bright Light Blue', hex: '#B5D6FF' },
  { id: 7, name: 'Blue', hex: '#196BCF' },
  { id: 63, name: 'Dark Blue', hex: '#234065' },
  { id: 55, name: 'Sand Blue', hex: '#93ABB9' },
  { id: 104, name: 'Bright Pink', hex: '#FCB1DB' },
  { id: 47, name: 'Dark Pink', hex: '#EF5BB3' },
  { id: 71, name: 'Magenta', hex: '#BA177E' },
  { id: 89, name: 'Dark Purple', hex: '#7045BA' },
  { id: 157, name: 'Medium Lavender', hex: '#C38BD4' },
  { id: 154, name: 'Lavender', hex: '#D0B8ED' },
  { id: 220, name: 'Coral', hex: '#FF765C' },
  { id: 110, name: 'Bright Light Orange', hex: '#FDBF0E' },
  { id: 158, name: 'Yellowish Green', hex: '#DBED94' },
  { id: 42, name: 'Medium Blue', hex: '#81B0E4' },
  { id: 12, name: 'Trans-Clear', hex: '#EEEEEE', trans: true },
  { id: 15, name: 'Trans-Light Blue', hex: '#68BCC5', trans: true },
  { id: 17, name: 'Trans-Red', hex: '#9C0010', trans: true },
];

export const COLOR_BY_ID = new Map(BRICK_COLORS.map(c => [c.id, c]));
export const BLACK = 11, TRANS_CLEAR = 12;
/** Colour to draw a brick with (3D view, instructions). */
export const renderHex = (id: number) => { const c = COLOR_BY_ID.get(id)!; return c.render ?? c.hex; };
