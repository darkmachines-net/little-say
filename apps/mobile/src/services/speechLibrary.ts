import { speechKey, type SpeechInput, type SpeechAsset, type Tile } from '@little-say/core';

export const tileSpeech = (tile: Pick<Tile, 'speech' | 'language'>): SpeechInput => ({ text: tile.speech, language: tile.language });
export type SpeechState = { state: 'missing' | 'preparing' | 'ready' | 'error'; error?: string; asset?: SpeechAsset };
type Dependencies = {
  load(): Promise<Record<string, SpeechAsset>>;
  generate(input: SpeechInput, server: string, regenerate: boolean): Promise<SpeechAsset>;
};

/** Audio is indexed independently of boards, so async completion cannot overwrite
 * an edit, advance board revisions, or attach an old pronunciation to new text. */
export class SpeechLibrary {
  private assets: Record<string, SpeechAsset> = {};
  private errors = new Map<string, string>();
  private jobs = new Map<string, Promise<SpeechAsset>>();
  private waiting: { key: string; automatic: boolean; run(): void; cancel(): void }[] = [];
  private automaticKeys = new Set<string>();
  private preparation = 0;
  private active = 0;
  private listeners = new Set<() => void>();
  private revision = 0;
  private ready: Promise<void>;
  constructor(private dependencies: Dependencies) {
    this.ready = dependencies.load().then(assets => { this.assets = assets; this.changed(); }).catch(() => {});
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  private changed() { this.revision++; this.listeners.forEach(listener => listener()); }
  status(tile: Pick<Tile, 'speech' | 'language'>): SpeechState {
    let key: string;
    try { key = speechKey(tileSpeech(tile)); } catch { return { state: 'missing' }; }
    const asset = this.assets[key];
    if (this.jobs.has(key)) return { state: 'preparing', asset };
    if (this.errors.has(key)) return { state: 'error', error: this.errors.get(key), asset };
    return { state: asset ? 'ready' : 'missing', asset };
  }
  asset = (tile: Pick<Tile, 'speech' | 'language'>) => this.status(tile).asset;
  async prepare(tiles: Tile[], server: string, retry = false) {
    const preparation = ++this.preparation;
    this.automaticKeys = new Set(tiles.map(tile => speechKey(tileSpeech(tile))));
    const obsolete = this.waiting.filter(job => job.automatic && !this.automaticKeys.has(job.key));
    this.waiting = this.waiting.filter(job => !obsolete.includes(job));
    obsolete.forEach(job => job.cancel());
    await this.ready;
    if (preparation !== this.preparation) return;
    for (const tile of tiles) {
      const status = this.status(tile);
      if (!status.asset && (status.state === 'missing' || (retry && status.state === 'error'))) void this.generate(tile, server, false, false).catch(() => {});
    }
  }
  async generate(tile: Pick<Tile, 'speech' | 'language'>, server: string, regenerate = false, prioritize = true): Promise<SpeechAsset> {
    const input = tileSpeech(tile);
    const key = speechKey(input);
    await this.ready;
    const existing = this.jobs.get(key);
    if (existing) {
      const waiting = this.waiting.find(job => job.key === key);
      if (prioritize && waiting) {
        waiting.automatic = false;
        this.waiting = [waiting, ...this.waiting.filter(job => job !== waiting)];
      }
      return existing;
    }
    if (!prioritize && !this.automaticKeys.has(key)) throw new Error('Automatic audio preparation cancelled.');
    if (!regenerate && this.assets[key]) return this.assets[key];
    let resolve!: (asset: SpeechAsset) => void;
    let reject!: (error: Error) => void;
    const job = new Promise<SpeechAsset>((yes, no) => { resolve = yes; reject = no; });
    this.jobs.set(key, job); this.errors.delete(key);
    const run = () => {
      this.active++;
      void this.dependencies.generate(input, server, regenerate).then(asset => {
        this.assets[key] = asset; resolve(asset);
      }, error => {
        const message = error instanceof Error ? error.message : 'Audio could not be prepared. Device speech is still available.';
        this.errors.set(key, message); reject(new Error(message));
      }).finally(() => { this.active--; this.jobs.delete(key); this.changed(); this.pump(); });
    };
    const queued = { key, automatic: !prioritize, run, cancel: () => {
      this.jobs.delete(key); reject(new Error('Automatic audio preparation cancelled.')); this.changed();
    } };
    if (prioritize) this.waiting.unshift(queued); else this.waiting.push(queued);
    this.changed(); this.pump();
    return job;
  }
  private pump() { while (this.active < 2 && this.waiting.length) this.waiting.shift()!.run(); }
}
