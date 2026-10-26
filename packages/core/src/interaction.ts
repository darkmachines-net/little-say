/**
 * @file Defines platform-independent tile hit testing, bounded speech queuing, parent holds, and grid
 * sizing.
 */

export type Point = { x: number; y: number };
export type TileRect = Point & { id: string; width: number; height: number };
/** Find the first tile containing the point, including left/top edges and excluding right/bottom edges. */
export function hitTest(point: Point, rects: TileRect[]): string | null {
  return rects.find(r => point.x >= r.x && point.x < r.x + r.width && point.y >= r.y && point.y < r.y + r.height)?.id ?? null;
}

/** One activation per contact: start tile wins, otherwise only the release tile. */
export class BoardTouchController {
  private contacts = new Map<number | string, boolean>();
  /** Bind tile activation and a live rectangle provider so hit testing uses current layout measurements. */
  constructor(private activate: (id: string) => void, private rects: () => TileRect[]) {}
  /** Track a new contact and activate its starting tile once, if any; ignore duplicate contact IDs. */
  down(pointer: number | string, point: Point) {
    if (this.contacts.has(pointer)) return;
    const tile = hitTest(point, this.rects());
    this.contacts.set(pointer, tile !== null);
    if (tile) this.activate(tile);
  }
  /** Finish a known contact, activating its ending tile only when no tile was activated at the start. */
  up(pointer: number | string, point: Point) {
    if (!this.contacts.has(pointer)) return;
    const activated = this.contacts.get(pointer);
    this.contacts.delete(pointer);
    if (!activated) { const tile = hitTest(point, this.rects()); if (tile) this.activate(tile); }
  }
  /** Forget one contact, or all contacts when no ID is supplied, without activating a tile. */
  cancel(pointer?: number | string) { if (pointer === undefined) this.contacts.clear(); else this.contacts.delete(pointer); }
}

export interface SpeechDriver<T> {
  /**
   * Start an item and signal completion or failure through the corresponding callback so the queue can
   * advance.
   */
  speak(item: T, finished: () => void, failed: () => void): void;
  /** Cancel playback and release driver-owned resources. */
  stop(): void;
}
/** Only the current utterance is sent to the platform; the latest pending item stays here. */
export class LatestSpeechQueue<T> {
  private active: T | null = null;
  private pending: T | null = null;
  private epoch = 0;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  /**
   * Bind the playback driver, active/pending state notifications, and an optional per-item failure
   * callback.
   */
  constructor(private driver: SpeechDriver<T>, private changed: (active: T | null, pending: T | null) => void, private error: (item: T) => void = () => {}) {}
  /** Start an item if idle; otherwise replace the pending item without interrupting current speech. */
  enqueue(item: T) {
    if (this.active !== null) { this.pending = item; this.changed(this.active, this.pending); }
    else this.start(item);
  }
  private start(item: T) {
    const epoch = ++this.epoch;
    this.active = item;
    this.changed(this.active, this.pending);
    let settled = false;
    const finish = (failed = false) => {
      if (settled || epoch !== this.epoch) return;
      settled = true;
      clearTimeout(this.watchdog);
      if (failed) { this.driver.stop(); this.error(item); }
      const next = this.pending;
      this.pending = null;
      this.active = null;
      if (next !== null) this.start(next); else this.changed(null, null);
    };
    this.watchdog = setTimeout(() => finish(true), 20000);
    try { this.driver.speak(item, () => finish(), () => finish(true)); } catch { finish(true); }
  }
  /**
   * Cancel active and pending speech, clear the watchdog, and invalidate callbacks from earlier
   * playback.
   */
  stop() {
    this.epoch++;
    clearTimeout(this.watchdog);
    this.active = null; this.pending = null;
    this.driver.stop(); this.changed(null, null);
  }
}

export const PARENT_HOLD_MS = 1000;
export type ParentHoldState = 'idle' | 'holding' | 'ready';
export class ParentExitGesture {
  private contact: { id: number | string; point: Point; time: number; ready: boolean } | null = null;
  /** Read the latched hold state; elapsed time is applied separately by advance or up. */
  get state(): ParentHoldState { return this.contact ? this.contact.ready ? 'ready' : 'holding' : 'idle'; }
  /**
   * Return milliseconds until the active hold is ready, using the supplied monotonic time; return zero
   * when idle or already ready.
   */
  remaining(time: number) { return this.contact && !this.contact.ready ? Math.max(0, PARENT_HOLD_MS - (time - this.contact.time)) : 0; }
  /** Latch readiness once the hold threshold is reached at the supplied monotonic time in milliseconds. */
  advance(time: number): ParentHoldState {
    if (this.contact && this.remaining(time) === 0) this.contact.ready = true;
    return this.state;
  }
  /**
   * Begin a hold at the given position and monotonic time; an additional contact cancels the current
   * hold.
   */
  down(id: number | string, point: Point, time: number) {
    if (this.contact) { this.cancel(); return; }
    this.contact = { id, point, time, ready: false };
  }
  /** Cancel the matching hold if the contact moves beyond the permitted distance. */
  move(id: number | string, point: Point) {
    if (this.contact?.id === id && Math.hypot(point.x - this.contact.point.x, point.y - this.contact.point.y) > 12) this.cancel();
  }
  /** Consume a matching ready contact from the timer or release fallback, then clear the hold state. */
  up(id: number | string, time: number): boolean {
    const valid = this.contact?.id === id && this.advance(time) === 'ready';
    this.cancel(); return Boolean(valid);
  }
  /** Reset any active hold without requesting exit. */
  cancel() { this.contact = null; }
}

export { gridLayout, type CardRect, type GridLayout, type GridOptions } from './boardLayout';
