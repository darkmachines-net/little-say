/** @file Tracks speech assets and reports background preparation, throttling, and connectivity waits. */

import { speechKey } from '@little-say/core/speech';
import type { SpeechInput, SpeechAsset, Tile } from '@little-say/core';

/** Extract the spoken text and language used to identify a tile pronunciation. */
export const tileSpeech = (tile: Pick<Tile, 'speech' | 'language'>): SpeechInput => ({ text: tile.speech, language: tile.language });
export type SpeechState = { state: 'missing' | 'preparing' | 'ready' | 'error'; error?: string; asset?: SpeechAsset };
export type SpeechActivity = { pending: number; state: 'preparing' | 'waiting' | 'offline' };
type Dependencies = {
  /** Restore device clips indexed by pronunciation. */
  load(): Promise<Record<string, SpeechAsset>>;
  /** Submit one synthesis attempt and save its resulting clip. */
  generate(input: SpeechInput, server: string, regenerate: boolean): Promise<SpeechAsset>;
  /** Return the minimum wait in milliseconds only for work rejected before admission. */
  admissionDelay?(error: unknown): number | undefined;
  /** Return false when the platform knows the network is offline. */
  isOnline?(): boolean;
};

type PendingSpeech = {
  key: string;
  server: string;
  automatic: boolean;
  /** Start one attempt using the selected backend. */
  run(server: string): Promise<void>;
  /** Discard obsolete automatic work before its next attempt. */
  cancel(): void;
};

/** Audio is indexed independently of boards, so async completion cannot overwrite
 * an edit, advance board revisions, or attach an old pronunciation to new text. */
export class SpeechLibrary {
  private assets: Record<string, SpeechAsset> = {};
  private errors = new Map<string, string>();
  private jobs = new Map<string, Promise<SpeechAsset>>();
  private waiting: PendingSpeech[] = [];
  private automaticKeys = new Set<string>();
  private automaticServer = '';
  private cooldowns = new Map<string, { until: number; backoff: number }>();
  private wake?: ReturnType<typeof setTimeout>;
  private preparation = 0;
  private active = 0;
  private listeners = new Set<() => void>();
  private revision = 0;
  private ready: Promise<void>;
  /**
   * Begin restoring persisted audio through the supplied storage and generation adapters; a load
   * failure leaves an empty cache.
   */
  constructor(private dependencies: Dependencies) {
    this.ready = dependencies.load().then(assets => { this.assets = assets; this.changed(); }).catch(() => {});
  }
  /** Register a state-change listener and return its unsubscribe callback. */
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  /** Return the revision token used by React external-store subscriptions. */
  snapshot = () => this.revision;
  /** Summarize still-needed local clips, including pending downloads that the server may already have finished. */
  backgroundWork(): SpeechActivity {
    const pending = [...this.jobs.keys()].filter(key => this.automaticKeys.has(key)).length;
    return { pending, state: this.active ? 'preparing' : this.dependencies.isOnline?.() === false ? 'offline' : 'waiting' };
  }
  /** Refresh restored offline clips without discarding in-flight synthesis or changing board revisions. */
  async reload() { this.assets = { ...this.assets, ...await this.dependencies.load() }; this.changed(); }
  private changed() { this.revision++; this.listeners.forEach(listener => listener()); }
  /**
   * Read preparation, error, and cached-asset state for the current text and language; invalid input is
   * treated as missing.
   */
  status(tile: Pick<Tile, 'speech' | 'language'>): SpeechState {
    let key: string;
    try { key = speechKey(tileSpeech(tile)); } catch { return { state: 'missing' }; }
    const asset = this.assets[key];
    if (this.jobs.has(key)) return { state: 'preparing', asset };
    if (this.errors.has(key)) return { state: 'error', error: this.errors.get(key), asset };
    return { state: asset ? 'ready' : 'missing', asset };
  }
  /** Return any cached clip for the current pronunciation, including while its replacement is preparing. */
  asset = (tile: Pick<Tile, 'speech' | 'language'>) => this.status(tile).asset;
  /**
   * Schedule missing clips for the latest tile set and backend, discarding obsolete queued work.
   * Admission deferrals resume from the shared cooldown. Other failures require an explicit retry.
   * Resolves after scheduling, not synthesis.
   */
  async prepare(tiles: Tile[], server: string) {
    const preparation = ++this.preparation;
    this.automaticKeys = new Set(tiles.map(tile => speechKey(tileSpeech(tile))));
    this.automaticServer = server;
    const obsolete = this.waiting.filter(job => job.automatic && !this.automaticKeys.has(job.key));
    this.waiting = this.waiting.filter(job => !obsolete.includes(job));
    obsolete.forEach(job => job.cancel());
    this.pump();
    this.changed();
    await this.ready;
    if (preparation !== this.preparation) return;
    for (const tile of tiles) {
      const status = this.status(tile);
      if (status.state === 'missing') void this.generate(tile, server, false, false).catch(() => {});
    }
  }
  /**
   * Return a cached clip or queue synthesis, sharing in-flight work for identical text and language.
   * Regeneration bypasses stored audio. Prioritized requests move ahead of automatic jobs and
   * return an error if their admission retries are exhausted.
   */
  async generate(tile: Pick<Tile, 'speech' | 'language'>, server: string, regenerate = false, prioritize = true): Promise<SpeechAsset> {
    const input = tileSpeech(tile);
    const key = speechKey(input);
    await this.ready;
    const existing = this.jobs.get(key);
    if (existing) {
      const waiting = this.waiting.find(job => job.key === key);
      if (prioritize && waiting) {
        waiting.automatic = false;
        waiting.server = server;
        this.waiting = [waiting, ...this.waiting.filter(job => job !== waiting)];
        this.pump();
      }
      return existing;
    }
    if (!prioritize && !this.automaticKeys.has(key)) throw new Error('Automatic audio preparation cancelled.');
    if (!regenerate && this.assets[key]) return this.assets[key];
    let resolve!: (asset: SpeechAsset) => void;
    let reject!: (error: Error) => void;
    const job = new Promise<SpeechAsset>((yes, no) => { resolve = yes; reject = no; });
    this.jobs.set(key, job); this.errors.delete(key);
    let throttledAttempts = 0;
    const queued: PendingSpeech = {
      key, server, automatic: !prioritize,
      run: async target => {
        this.active++;
        this.changed();
        let deferred = false;
        try {
          const asset = await this.dependencies.generate(input, target, regenerate);
          const cooldown = this.cooldowns.get(target);
          if (cooldown && cooldown.until <= Date.now()) this.cooldowns.delete(target);
          this.assets[key] = asset;
          resolve(asset);
        } catch (error) {
          const minimumDelay = this.dependencies.admissionDelay?.(error);
          if (minimumDelay !== undefined) {
            this.recordThrottle(target, minimumDelay);
            throttledAttempts++;
            if (queued.automatic && !this.automaticKeys.has(key)) {
              queued.cancel();
              return;
            }
            if (queued.automatic || throttledAttempts <= 3) {
              deferred = true;
              if (queued.automatic) this.waiting.push(queued);
              else this.waiting.unshift(queued);
              return;
            }
          }
          const message = error instanceof Error ? error.message : 'Audio could not be prepared. Device speech is still available.';
          this.errors.set(key, message);
          reject(new Error(message));
        } finally {
          this.active--;
          if (!deferred) this.jobs.delete(key);
          this.changed();
          this.pump();
        }
      },
      cancel: () => {
        this.jobs.delete(key);
        reject(new Error('Automatic audio preparation cancelled.'));
        this.changed();
      },
    };
    if (prioritize) this.waiting.unshift(queued); else this.waiting.push(queued);
    this.changed(); this.pump();
    return job;
  }
  private serverFor(job: PendingSpeech) { return job.automatic ? this.automaticServer : job.server; }

  private recordThrottle(server: string, minimumDelay: number) {
    const now = Date.now();
    const current = this.cooldowns.get(server);
    // Concurrent rejections share a cooldown. A rejected attempt after it expires grows the wait.
    const backoff = current && current.until > now ? current.backoff : Math.min((current?.backoff ?? 1000) * 2, 60_000);
    const until = now + Math.max(minimumDelay, backoff);
    this.cooldowns.set(server, { until: Math.max(until, current?.until ?? 0), backoff });
  }

  private pump() {
    clearTimeout(this.wake);
    this.wake = undefined;
    const online = this.dependencies.isOnline?.() !== false;
    const now = Date.now();
    while (this.active < 2 && this.waiting.length) {
      let next = Infinity;
      const index = this.waiting.findIndex(job => {
        if (!online && job.automatic) return false;
        const cooldown = this.cooldowns.get(this.serverFor(job));
        if (!cooldown || cooldown.until <= now) return true;
        next = Math.min(next, cooldown.until);
        return false;
      });
      if (index === -1) {
        if (Number.isFinite(next)) this.wake = setTimeout(() => this.pump(), Math.min(next - now, 2_147_483_647));
        return;
      }
      const [job] = this.waiting.splice(index, 1);
      void job.run(this.serverFor(job));
    }
  }
}
