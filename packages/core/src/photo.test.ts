/** @file Verifies crop geometry, bounded movement, anchored zoom, and pan/pinch transitions. */

import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_ZOOM, PhotoGesture, panPhoto, photoGeometry, zoomPhoto } from './photo';

describe('photo framing', () => {
  const source = { width: 1200, height: 800 }, frame = { width: 300, height: 300 };
  it('shows exactly the same source region at thumbnail, editor and play sizes', () => {
    const crop = { zoom: 2.13, x: -0.42, y: 0.63 };
    const regions = [70, 290, 540].map(size => { const image = photoGeometry(source, { width: size, height: size }, crop); return [-image.left / image.width, -image.top / image.height, size / image.width, size / image.height]; });
    for (const region of regions.slice(1)) region.forEach((value, i) => expect(value).toBeCloseTo(regions[0][i], 8));
  });
  it('pans smoothly and clamps at all four edges without exposing blank space', () => {
    const crop = { zoom: 2, x: 0, y: 0 };
    const shifted = panPhoto(source, frame, crop, 1, 1);
    const image = photoGeometry(source, frame, shifted), original = photoGeometry(source, frame, crop);
    expect(image.left - original.left).toBeCloseTo(1); expect(image.top - original.top).toBeCloseTo(1);
    for (const delta of [-10000, 10000]) {
      const bounds = photoGeometry(source, frame, panPhoto(source, frame, crop, delta, delta));
      expect(bounds.left).toBeLessThanOrEqual(0); expect(bounds.top).toBeLessThanOrEqual(0);
      expect(bounds.left + bounds.width).toBeGreaterThanOrEqual(frame.width); expect(bounds.top + bounds.height).toBeGreaterThanOrEqual(frame.height);
    }
  });
  it('keeps the image point under an off-center pinch stationary while zooming', () => {
    const crop = { zoom: 2, x: 0.1, y: -0.2 }, anchor = { x: 220, y: 110 };
    const before = photoGeometry(source, frame, crop), after = photoGeometry(source, frame, zoomPhoto(source, frame, crop, 3.4, anchor));
    expect((anchor.x - before.left) / before.width).toBeCloseTo((anchor.x - after.left) / after.width, 8);
    expect((anchor.y - before.top) / before.height).toBeCloseTo((anchor.y - after.top) / after.height, 8);
  });
  it('limits zoom and does not divide by zero when one dimension has no overflow', () => {
    expect(zoomPhoto(source, frame, { zoom: 1, x: 0, y: 0 }, 100).zoom).toBe(MAX_PHOTO_ZOOM);
    const crop = zoomPhoto(source, frame, { zoom: 2, x: 0, y: 0 }, 0);
    expect(crop.zoom).toBe(1); expect(panPhoto(source, frame, crop, 5, 5).y).toBe(0);
  });
  it('rebases between one-finger dragging and two-finger pinching without a jump', () => {
    const gesture = new PhotoGesture(source, frame);
    let crop = { zoom: 2, x: 0, y: 0 };
    gesture.move(crop, [{ x: 100, y: 100 }]);
    crop = gesture.move(crop, [{ x: 110, y: 105 }]);
    expect(crop.x).toBeGreaterThan(0);
    expect(gesture.move(crop, [{ x: 110, y: 105 }, { x: 210, y: 105 }])).toEqual(crop);
    crop = gesture.move(crop, [{ x: 60, y: 105 }, { x: 260, y: 105 }]);
    expect(crop.zoom).toBe(4);
    expect(gesture.move(crop, [{ x: 260, y: 105 }])).toEqual(crop);
    const next = gesture.move(crop, [{ x: 255, y: 105 }]); expect(next.x).toBeLessThan(crop.x);
    gesture.reset(); expect(gesture.move(next, [{ x: 200, y: 20 }])).toEqual(next);
  });
});
