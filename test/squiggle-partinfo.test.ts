import { describe, expect, it } from 'vitest';
import { PARTS, type Kind } from '../src/core/parts';
import { partGrams, partPrice } from '../src/squiggle/partinfo';

// every PARTS entry as [kind, part, w, d, h]
const ALL = (Object.entries(PARTS) as [Kind, Record<string, string>][]).flatMap(([kind, t]) => Object.entries(t).map(([k, part]) => {
  const [w, d] = k.replace('p', '').split('x').map(Number);
  const h = kind === 'brick' || kind === 'technic' || (kind === 'round' && !k.endsWith('p')) ? 3 : kind === 'slope' ? 2 : 1;
  return [kind, part, w, d, h] as const;
}));

describe('part weights and prices', () => {
  it('every PARTS entry has a positive weight and price', () => {
    expect(ALL.length).toBeGreaterThan(60);
    for (const [kind, part, w, d, h] of ALL) {
      expect(partGrams(part, kind, w, d, h), part).toBeGreaterThan(0);
      expect(partPrice(part, kind, w, d, h), part).toBeGreaterThan(0.03);
      expect(partPrice(part, kind, w, d, h), part).toBeLessThan(5);
    }
  });
  it('matches the BrickLink weights', () => {
    expect(partGrams('3005', 'brick', 1, 1, 3)).toBeCloseTo(0.44, 2);
    const g = partGrams('3024', 'plate', 1, 1, 1);
    expect(g).toBeGreaterThanOrEqual(0.15); expect(g).toBeLessThanOrEqual(0.2);
    expect(partGrams('3001', 'brick', 2, 4, 3)).toBeCloseTo(2.32, 2);
    expect(partGrams('91405', 'plate', 16, 16, 1)).toBeCloseTo(35, 0);
    expect(partGrams('3703', 'technic', 1, 16, 3)).toBeCloseTo(5.87, 2);
    expect(partGrams('69729', 'tile', 2, 6, 1)).toBeCloseTo(1.35, 2);
    expect(partGrams('3062b', 'round', 1, 1, 3)).toBeGreaterThan(partGrams('6141', 'round', 1, 1, 1));
  });
  it('prices are Pick a Brick orders of magnitude', () => {
    expect(partPrice('3024', 'plate', 1, 1, 1)).toBeCloseTo(0.06, 2);
    expect(partPrice('3001', 'brick', 2, 4, 3)).toBeCloseTo(0.22, 2);
    expect(partPrice('91405', 'plate', 16, 16, 1)).toBeGreaterThan(2);
    expect(partPrice('3703', 'technic', 1, 16, 3)).toBeGreaterThan(partPrice('3700', 'technic', 1, 2, 3));
  });
  it('the fallback rule stays within a factor 2 of the table', () => {
    // a size just off the PARTS table forces the formula
    const within2 = (a: number, b: number) => a / b > 0.5 && a / b < 2;
    for (const [kind, part, w, d, h] of ALL) {
      if (kind === 'round') continue;
      expect(within2(partGrams('?', kind, w + 1e-9, d, h), partGrams(part, kind, w, d, h)), part).toBe(true);
      expect(within2(partPrice('?', kind, w + 1e-9, d, h), partPrice(part, kind, w, d, h)), part).toBe(true);
    }
  });
  it('never throws on unknown parts', () => {
    for (const kind of ['brick', 'plate', 'tile', 'slope', 'technic', 'round', 'nope'] as Kind[]) {
      expect(partGrams('?', kind, 3, 5, 1)).toBeGreaterThan(0);
      expect(partPrice('?', kind, 3, 5, 1)).toBeGreaterThan(0);
      expect(partGrams('?', kind, 0, 0, 1)).toBeGreaterThan(0);
    }
    // unknown part number of a known size: the table part of that size
    expect(partGrams('44237', 'brick', 2, 6, 3)).toBe(partGrams('2456', 'brick', 2, 6, 3));
  });
});
