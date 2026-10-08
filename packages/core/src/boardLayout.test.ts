/** @file Protects balanced occupied rows, usable bounds, compact preview scrolling, and rotation hit geometry. */

import { describe, expect, it } from 'vitest';
import { gridLayout } from './boardLayout';
import { hitTest } from './interaction';

describe('balanced board geometry', () => {
  it.each([[788, 1088], [1148, 728], [868, 508]])('keeps four cards in two complete rows at %i x %i', (width, height) => {
    expect(gridLayout(4, width, height).rowCounts).toEqual([2, 2]);
  });

  it('adapts beyond two columns and balances partial rows', () => {
    expect(gridLayout(4, 812, 298).rowCounts).toEqual([4]);
    expect(gridLayout(5, 1148, 728).rowCounts).toEqual([3, 2]);
    expect(gridLayout(7, 1148, 728).rowCounts).toEqual([4, 3]);
    expect(gridLayout(24, 1148, 728).rowCounts).toEqual([6, 6, 6, 6]);
    // A nearly tied score must not introduce a 2+1+1 phone layout for four cards.
    const phone = gridLayout(4, 358, 752).rowCounts;
    expect(new Set(phone).size).toBe(1);
  });

  it.each([[788, 1088], [1148, 728], [358, 752], [812, 298], [992, 676]])('fits all supported counts without empty slots or overlapping hit targets at %i x %i', (width, height) => {
    for (let count = 1; count <= 24; count++) {
      const layout = gridLayout(count, width, height);
      expect(layout.fits).toBe(true);
      expect(layout.rects).toHaveLength(count);
      expect(Math.max(...layout.rowCounts) - Math.min(...layout.rowCounts)).toBeLessThanOrEqual(1);
      const rects = layout.rects.map((rect, i) => ({ ...rect, id: `card-${i}` }));
      for (const [i, rect] of rects.entries()) {
        expect(rect.x).toBeGreaterThanOrEqual(-0.01);
        expect(rect.y).toBeGreaterThanOrEqual(-0.01);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width + 0.01);
        expect(rect.y + rect.height).toBeLessThanOrEqual(height + 0.01);
        expect(Math.min(rect.width, rect.height)).toBeGreaterThanOrEqual(44);
        expect(hitTest({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, rects)).toBe(`card-${i}`);
        for (const other of rects.slice(i + 1)) {
          expect(rect.x + rect.width <= other.x || other.x + other.width <= rect.x ||
            rect.y + rect.height <= other.y || other.y + other.height <= rect.y).toBe(true);
        }
      }
      for (const y of new Set(rects.map(rect => rect.y))) {
        const row = rects.filter(rect => rect.y === y);
        expect(row[0].x).toBeCloseTo(0);
        expect(row.at(-1)!.x + row.at(-1)!.width).toBeCloseTo(width);
      }
    }
  });

  it('uses the same ordered geometry in bounded and scrolling previews', () => {
    const options = { minHeight: 64, maxWidth: 164, maxHeight: 148, scroll: true };
    for (const height of [700, 80]) {
      const layout = gridLayout(24, 300, height, 8, options);
      expect(layout.fits).toBe(true);
      expect(layout.rects).toHaveLength(24);
      expect(layout.height).toBeGreaterThanOrEqual(height);
      for (const rect of layout.rects) {
        expect(rect.width).toBeGreaterThanOrEqual(44);
        expect(rect.width).toBeLessThanOrEqual(164);
        expect(rect.height).toBeGreaterThanOrEqual(64);
        expect(rect.height).toBeLessThanOrEqual(148);
        expect(rect.x + rect.width).toBeLessThanOrEqual(300.01);
        expect(rect.y + rect.height).toBeLessThanOrEqual(layout.height + 0.01);
      }
    }
    expect(gridLayout(24, 300, 80, 8, options).height).toBeGreaterThan(80);
  });

  it('reports impossible or unmeasured bounds without rendering undersized targets', () => {
    for (const [count, width, height] of [[24, 288, 228], [4, 0, 0], [0, 800, 600], [4, NaN, 600], [4, 800, -1]]) {
      expect(gridLayout(count, width, height)).toMatchObject({ fits: false, rects: [] });
    }
    expect(gridLayout(4, 800, 600, -1).fits).toBe(false);
    expect(gridLayout(4, 800, 600, 12, { maxWidth: 20 }).fits).toBe(false);
  });
});
