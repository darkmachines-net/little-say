export type Point = { x: number; y: number };
export type TileRect = Point & { id: string; width: number; height: number };
export function hitTest(point: Point, rects: TileRect[]): string | null {
  return rects.find(r => point.x >= r.x && point.x < r.x + r.width && point.y >= r.y && point.y < r.y + r.height)?.id ?? null;
}

/** One activation per contact: start tile wins, otherwise only the release tile. */
export class BoardTouchController {
  private contacts = new Map<number | string, boolean>();
  constructor(private activate: (id: string) => void, private rects: () => TileRect[]) {}
  down(pointer: number | string, point: Point) {
    if (this.contacts.has(pointer)) return;
    const tile = hitTest(point, this.rects());
    this.contacts.set(pointer, tile !== null);
    if (tile) this.activate(tile);
  }
  up(pointer: number | string, point: Point) {
    if (!this.contacts.has(pointer)) return;
    const activated = this.contacts.get(pointer);
    this.contacts.delete(pointer);
    if (!activated) { const tile = hitTest(point, this.rects()); if (tile) this.activate(tile); }
  }
  cancel(pointer?: number | string) { if (pointer === undefined) this.contacts.clear(); else this.contacts.delete(pointer); }
}

export interface SpeechDriver<T> { speak(item: T, finished: () => void, failed: () => void): void; stop(): void; }
/** Only the current utterance is sent to the platform; the latest pending item stays here. */
export class LatestSpeechQueue<T> {
  private active: T | null = null;
  private pending: T | null = null;
  private epoch = 0;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  constructor(private driver: SpeechDriver<T>, private changed: (active: T | null, pending: T | null) => void, private error: (item: T) => void = () => {}) {}
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
  stop() {
    this.epoch++;
    clearTimeout(this.watchdog);
    this.active = null; this.pending = null;
    this.driver.stop(); this.changed(null, null);
  }
}

export const PARENT_HOLD_MS = 2000;
export type ParentHoldState = 'idle' | 'holding' | 'ready';
export class ParentExitGesture {
  private contact: { id: number | string; point: Point; time: number; ready: boolean } | null = null;
  get state(): ParentHoldState { return this.contact ? this.contact.ready ? 'ready' : 'holding' : 'idle'; }
  remaining(time: number) { return this.contact && !this.contact.ready ? Math.max(0, PARENT_HOLD_MS - (time - this.contact.time)) : 0; }
  advance(time: number): ParentHoldState {
    if (this.contact && this.remaining(time) === 0) this.contact.ready = true;
    return this.state;
  }
  down(id: number | string, point: Point, time: number) {
    if (this.contact) { this.cancel(); return; }
    this.contact = { id, point, time, ready: false };
  }
  move(id: number | string, point: Point) {
    if (this.contact?.id === id && Math.hypot(point.x - this.contact.point.x, point.y - this.contact.point.y) > 12) this.cancel();
  }
  up(id: number | string, time: number): boolean {
    const valid = this.contact?.id === id && this.advance(time) === 'ready';
    this.cancel(); return Boolean(valid);
  }
  cancel() { this.contact = null; }
}

export function gridLayout(count: number, width: number, height: number, gap = 12) {
  let best = { columns: 1, rows: count, width, height: height / count, score: -Infinity };
  for (let columns = 1; columns <= Math.min(count, 8); columns++) {
    const rows = Math.ceil(count / columns);
    const w = (width - gap * (columns - 1)) / columns;
    const h = (height - gap * (rows - 1)) / rows;
    const score = Math.min(w, h) - Math.abs(Math.log(Math.max(w, 1) / Math.max(h, 1))) * 20 - (rows * columns - count) * 2;
    if (score > best.score) best = { columns, rows, width: w, height: h, score };
  }
  return best;
}
