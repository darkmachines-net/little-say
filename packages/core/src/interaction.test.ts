/**
 * @file Verifies touch hit testing, latest-pending speech, parent exit timing, and responsive grid
 * layout.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardTouchController, LatestSpeechQueue, ParentExitGesture, gridLayout } from './interaction';
const rects = [{ id: 'cow', x: 10, y: 10, width: 100, height: 100 }, { id: 'sheep', x: 130, y: 10, width: 100, height: 100 }];
describe('forgiving child gestures', () => {
  it.each([
    ['tap', { x: 50, y: 50 }, { x: 50, y: 50 }, ['cow']],
    ['swipe between tiles', { x: 50, y: 50 }, { x: 150, y: 50 }, ['cow']],
    ['start on tile, release outside', { x: 50, y: 50 }, { x: 400, y: 50 }, ['cow']],
    ['gap to tile', { x: 120, y: 50 }, { x: 150, y: 50 }, ['sheep']],
    ['outside to outside', { x: 0, y: 0 }, { x: 300, y: 0 }, []],
  ])('%s', (_, start, end, expected) => {
    const calls: string[] = []; const controller = new BoardTouchController(id => calls.push(id), () => rects);
    controller.down(1, start); controller.up(1, end); expect(calls).toEqual(expected);
  });
  it('activates on down, ignores duplicate downs and never replays a held tile on release', () => {
    const action = vi.fn(); const controller = new BoardTouchController(action, () => rects);
    controller.down('native-id', { x: 50, y: 50 }); expect(action).toHaveBeenCalledWith('cow');
    controller.down('native-id', { x: 150, y: 50 }); controller.up('native-id', { x: 150, y: 50 }); expect(action).toHaveBeenCalledTimes(1);
  });
  it('cancellation, including layout changes, cannot activate on a later release', () => {
    const action = vi.fn(); const controller = new BoardTouchController(action, () => rects);
    controller.down(1, { x: 120, y: 50 }); controller.cancel(); controller.up(1, { x: 50, y: 50 }); expect(action).not.toHaveBeenCalled();
  });
  it('tracks multiple fingers independently', () => {
    const action = vi.fn(); const controller = new BoardTouchController(action, () => rects);
    controller.down(1, { x: 50, y: 50 }); controller.down(2, { x: 120, y: 50 }); controller.up(1, { x: 150, y: 50 }); controller.up(2, { x: 150, y: 50 });
    expect(action.mock.calls.flat()).toEqual(['cow', 'sheep']);
  });
});
describe('bounded speech', () => {
  afterEach(() => vi.useRealTimers());
  it('finishes the word and retains only the most recent next word', () => {
    const callbacks: (() => void)[] = []; const spoken: string[] = [];
    const queue = new LatestSpeechQueue<string>({ speak: (word, done) => { spoken.push(word); callbacks.push(done); }, stop: vi.fn() }, vi.fn());
    queue.enqueue('cow'); queue.enqueue('sheep'); queue.enqueue('horse');
    expect(spoken).toEqual(['cow']); callbacks[0](); expect(spoken).toEqual(['cow', 'horse']); callbacks[1](); queue.stop();
  });
  it('allows deliberate repeats without an unbounded queue', () => {
    const callbacks: (() => void)[] = []; const speak = vi.fn((_: string, done: () => void) => callbacks.push(done));
    const queue = new LatestSpeechQueue({ speak, stop: vi.fn() }, vi.fn());
    for (let i = 0; i < 10; i++) queue.enqueue('cow');
    callbacks[0](); callbacks[1](); expect(speak).toHaveBeenCalledTimes(2); queue.stop();
  });
  it('ignores stale callbacks after stopping and resumes from an engine timeout', () => {
    vi.useFakeTimers(); const callbacks: (() => void)[] = []; const spoken: string[] = []; const error = vi.fn();
    const queue = new LatestSpeechQueue<string>({ speak: (word, done) => { spoken.push(word); callbacks.push(done); }, stop: vi.fn() }, vi.fn(), error);
    queue.enqueue('old'); queue.enqueue('discard'); queue.stop(); queue.enqueue('new'); callbacks[0]();
    expect(spoken).toEqual(['old', 'new']); vi.advanceTimersByTime(20001); expect(error).toHaveBeenCalledOnce(); queue.enqueue('recovered'); expect(spoken.at(-1)).toBe('recovered'); queue.stop();
  });
});
describe('parent hold and fixed layout', () => {
  it('requires a full stationary hold and release', () => {
    const gate = new ParentExitGesture(); gate.down(1, { x: 0, y: 0 }, 0); expect(gate.up(1, 1999)).toBe(false);
    gate.down(1, { x: 0, y: 0 }, 3000); expect(gate.up(1, 5000)).toBe(true); expect(gate.up(1, 6000)).toBe(false);
  });
  it('uses one latched readiness state for feedback and release', () => {
    const gate = new ParentExitGesture(); gate.down(1, { x: 0, y: 0 }, 1000);
    expect(gate.advance(2999)).toBe('holding'); expect(gate.remaining(2999)).toBe(1);
    expect(gate.advance(3000)).toBe('ready'); expect(gate.remaining(3000)).toBe(0);
    expect(gate.up(1, 2999)).toBe(true); // Readiness cannot disagree with a later clock sample.
    expect(gate.state).toBe('idle');
    gate.down(1, { x: 0, y: 0 }, 4000); gate.move(1, { x: 13, y: 0 });
    expect(gate.advance(6000)).toBe('idle'); expect(gate.up(1, 6000)).toBe(false);
  });
  it('movement, another contact, or a board touch cancels the hold', () => {
    const gate = new ParentExitGesture(); gate.down(1, { x: 0, y: 0 }, 0); gate.move(1, { x: 13, y: 0 }); expect(gate.up(1, 3000)).toBe(false);
    gate.down(1, { x: 0, y: 0 }, 0); gate.down(2, { x: 0, y: 0 }, 0); expect(gate.up(1, 3000)).toBe(false);
    gate.down(1, { x: 0, y: 0 }, 0); gate.cancel(); expect(gate.up(1, 3000)).toBe(false);
  });
  it.each([[768, 880], [1120, 650], [360, 670]])('fits every tile without scrolling at %i × %i', (width, height) => {
    for (let count = 1; count <= 24; count++) {
      const layout = gridLayout(count, width, height);
      expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(count);
      expect(layout.width * layout.columns + 12 * (layout.columns - 1)).toBeLessThanOrEqual(width + 0.01);
      expect(layout.height * layout.rows + 12 * (layout.rows - 1)).toBeLessThanOrEqual(height + 0.01);
      expect(Math.min(layout.width, layout.height)).toBeGreaterThan(44);
    }
  });
});
