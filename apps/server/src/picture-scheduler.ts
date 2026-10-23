/** @file Schedules bounded image generation fairly across boards and shares generic work with subscriber-owned cancellation. */

type Work = { key: string; board: string; controller: AbortController; subscribers: number; starts: Set<() => void>; run: (signal: AbortSignal) => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void; promise: Promise<unknown>; active: boolean };

/** A process-local fair scheduler whose bounded jobs never retry paid provider requests automatically. */
export class PictureScheduler {
  private pending: Work[] = [];
  private work = new Map<string, Work>();
  private active = 0;
  private lastBoard = '';
  private closed = false;
  /** Limit paid concurrency independently from fast catalog lookup and reuse. */
  constructor(private concurrency = 6, private capacity = 48) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 24) throw new Error('Picture concurrency must be 1–24.');
  }
  /** Share equivalent work and report when it starts; only the last departing subscriber aborts the provider request. */
  async subscribe<T>(key: string, board: string, signal: AbortSignal, run: (signal: AbortSignal) => Promise<T>, onStart?: () => void): Promise<T> {
    if (signal.aborted || this.closed) throw new Error('Cancelled');
    let item = this.work.get(key);
    if (item?.controller.signal.aborted) item = undefined;
    if (!item) {
      if (this.pending.length >= this.capacity) throw new Error('Picture service is busy.');
      let resolve!: Work['resolve'], reject!: Work['reject'];
      const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
      item = { key, board, controller: new AbortController(), subscribers: 0, starts: new Set(), run, resolve, reject, promise, active: false };
      this.work.set(key, item); this.pending.push(item);
    }
    const shared = item; shared.subscribers++;
    if (onStart) { shared.starts.add(onStart); if (shared.active) onStart(); }
    const result = new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown, value?: unknown) => {
        if (settled) return; settled = true; signal.removeEventListener('abort', cancel); shared.subscribers--;
        if (onStart) shared.starts.delete(onStart);
        if (!shared.subscribers) {
          shared.controller.abort();
          if (!shared.active) { this.pending = this.pending.filter(item => item !== shared); if (this.work.get(key) === shared) this.work.delete(key); shared.reject(new Error('Cancelled')); }
        }
        error ? reject(error) : resolve(value as T);
      };
      const cancel = () => finish(new Error('Cancelled'));
      signal.addEventListener('abort', cancel, { once: true });
      shared.promise.then(value => finish(undefined, value), error => finish(error));
      if (signal.aborted) cancel();
    });
    this.pump(); return result;
  }
  private pump() {
    while (!this.closed && this.active < this.concurrency && this.pending.length) {
      const other = this.pending.findIndex(item => item.board !== this.lastBoard);
      const item = this.pending.splice(other < 0 ? 0 : other, 1)[0];
      this.lastBoard = item.board; item.active = true; this.active++;
      for (const start of item.starts) start();
      void item.run(item.controller.signal).then(item.resolve, item.reject).finally(() => { this.active--; if (this.work.get(item.key) === item) this.work.delete(item.key); this.pump(); });
    }
  }
  /** Abort active and queued work on shutdown; persisted batches become interrupted on restart. */
  close(): void { this.closed = true; for (const item of this.work.values()) { item.controller.abort(); item.reject(new Error('Cancelled')); } this.pending = []; this.work.clear(); }
}
