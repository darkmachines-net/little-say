/**
 * @file Stores reviewed generic pictures/templates through shared metadata storage; private account backups never feed reuse.
 */

import { createHash } from 'node:crypto';
import { cacheStore, type CacheStore } from './hosting/storage';
import { generatedBoardSchema, resolvedPictureSchema, type GeneratedBoard, type ProposalRequest, type ResolvedPicture } from '@little-say/core';
import { canonicalPictureConcept, genericConcept, genericConcepts, genericWords, type GenericConcept } from './generic-concepts';

/** Bump when cache/schema or semantic-approval rules invalidate previously admitted records. */
const version = 1;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Template = { key: string; terms: string[]; board: GeneratedBoard; pictures: { index: number; picture: ResolvedPicture }[] };
const filler = new Set('a an the make create board soundboard with of for tiles cards tile card six 6 exactly including and please in english animals animal farm food snack household object objects routines routine construction vehicles vehicle'.split(' '));
const genericTokens = new Set(genericConcepts.flatMap(item => item.aliases.flatMap(alias => alias.split(' '))));

/** Stores approved records independently of accounts; malformed or older cache entries are ignored. */
export class GenericContent {
  private templates = new Map<string, Template>();
  private pictures = new Map<string, ResolvedPicture>();
  private ready: Promise<void>;
  private storage: CacheStore;
  /** Initialize a dedicated cache directory; never scan account backups or legacy picture jobs. */
  constructor(directory: string | CacheStore) { this.storage = cacheStore(directory); this.ready = this.restore(); }
  private async restore() {
    for (const name of await this.storage.list()) {
      if (!/^(template|picture)-[a-f0-9]{64}\.json$/.test(name)) continue;
      try {
        const data = JSON.parse((await this.storage.read(name)).toString());
        if (data.version !== version) continue;
        if (name.startsWith('template-')) {
          const board = this.sanitize(generatedBoardSchema.parse(data.board));
          if (board && /^[a-f0-9]{64}$/.test(data.key) && name === `template-${data.key}.json` && Array.isArray(data.terms) && data.terms.every((term: unknown) => typeof term === 'string' && genericTokens.has(term))) {
            const pictures: Template['pictures'] = [];
            for (const entry of data.pictures ?? []) {
              const picture = resolvedPictureSchema.parse(entry.picture);
              if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index >= board.tiles.length || pictures.some(value => value.index === entry.index)) throw new Error('Invalid template picture reference.');
              pictures.push({ index: entry.index, picture });
            }
            this.templates.set(data.key, { key: data.key, terms: data.terms, board, pictures });
          }
        } else if (genericConcepts.some(item => ['color', 'line'].some(style => this.pictureKey(item, style) === data.key))) this.pictures.set(data.key, resolvedPictureSchema.parse(data.picture));
      } catch { /* Corruption is a cache miss, never permission to publish raw data. */ }
    }
  }
  private async write(name: string, value: unknown) {
    await this.storage.write(name, JSON.stringify({ version, ...value as object }));
  }
  private requestKey(request: ProposalRequest): string | undefined {
    if (request.board || request.previousPreparationId || request.conversation?.draft || request.conversation?.history.length) return undefined;
    // A closed vocabulary admits generic English requests only. Other requests still draft normally.
    const words = genericWords(request.prompt).replace(/[.,!?:;]/g, '').split(/\s+/);
    if (!words.length || words.some(word => !filler.has(word) && !genericTokens.has(word))) return undefined;
    return digest({ version, prompt: genericWords(request.prompt), languages: request.languageProfile ?? null, pictures: request.picturePolicy ?? null });
  }
  /**
   * Admit only reviewed concepts, approved labels/speech and public language tags. Reconstruct titles,
   * emoji and concept metadata; exclude personal instructions, protected pictures and existing IDs.
   * Model vocabulary and client flags alone cannot authorize cross-user reuse.
   */
  private sanitize(board: GeneratedBoard): GeneratedBoard | undefined {
    if (board.needsClarification || !board.tiles.length) return undefined;
    const reusableLanguage = (language: string) => /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?$/.test(language);
    if (board.playLanguages?.some(language => !reusableLanguage(language))) return undefined;
    const tiles = [];
    for (const tile of board.tiles) {
      const item = tile.pictureConcept && genericConcept(tile.pictureConcept, tile.pictureOptions?.instruction);
      if (!item || tile.existingId || tile.replacePicture || tile.pictureOptions?.locked) return undefined;
      // Short display labels are safe only after the picture concept has established its full sense.
      const validWord = (word: string, language: string) => {
        const normalized = genericWords(word);
        const requiredLanguage = ({ chat: 'fr', pain: 'fr', pan: 'es' } as Record<string, string>)[normalized];
        if (requiredLanguage && language.split('-')[0] !== requiredLanguage) return false;
        return item.aliases.includes(normalized) || (item.id === 'chicken animal' && normalized === 'chicken') || (item.id === 'concrete mixer truck' && normalized === 'concrete mixer');
      };
      if (!reusableLanguage(tile.language) || !validWord(tile.label, tile.language) || !validWord(tile.speech, tile.language) || tile.translations?.some(value => !reusableLanguage(value.language) || !validWord(value.label, value.language) || !validWord(value.speech, value.language))) return undefined;
      tiles.push({ ...tile, existingId: null, emoji: item.emoji, pictureConcept: canonicalPictureConcept(item), pictureOptions: { locked: false, instruction: '', ...(tile.pictureOptions?.mode ? { mode: tile.pictureOptions.mode } : {}), ...(tile.pictureOptions?.style ? { style: tile.pictureOptions.style } : {}) } });
    }
    return { ...board, title: tiles.slice(0, 3).map(tile => tile.label).join(', ').slice(0, 100), explanation: 'Your board is ready to review.', tiles };
  }
  private pictureKey(item: GenericConcept, style: string) { return digest({ version, concept: item.id, features: item.features, style }); }
  /** Read a canonical picture without model, neighboring-tile, or request wording fragmentation. */
  async picture(item: GenericConcept, style = 'color'): Promise<ResolvedPicture | undefined> { await this.ready; return this.pictures.get(this.pictureKey(item, style)); }
  /** Publish only a validated canonical asset; descriptions are reconstructed without private context. */
  async rememberPicture(item: GenericConcept, raw: ResolvedPicture): Promise<void> {
    await this.ready;
    if (raw.kind === 'unresolved') return;
    const picture = raw.kind === 'generated' ? { ...raw, description: item.id } : raw;
    const key = this.pictureKey(item, raw.style);
    await this.write(`picture-${key}.json`, { key, picture }); this.pictures.set(key, picture);
  }
  /**
   * Return a detached template only for an eligible initial request with the same normalized prompt,
   * language profile and picture settings. Conversation edits cannot take this shortcut.
   */
  async exact(request: ProposalRequest): Promise<Pick<Template, 'board' | 'pictures'> | undefined> {
    await this.ready; const key = this.requestKey(request);
    const template = key && this.templates.get(key);
    return template ? structuredClone({ board: template.board, pictures: template.pictures }) : undefined;
  }
  /** Supply at most three generic examples; callers must still honor every requested constraint. */
  async related(request: ProposalRequest): Promise<GeneratedBoard[]> {
    await this.ready;
    if (request.board || request.conversation?.draft) return [];
    const words = new Set(genericWords(request.prompt).split(/[^\p{L}\p{N}]+/u));
    return [...this.templates.values()].map(item => ({ item, score: item.terms.filter(term => words.has(term)).length })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(({ item }) => structuredClone(item.board));
  }
  /** Remember a newly completed generic board, without persisting the original prompt, title, or ownership. */
  async remember(request: ProposalRequest, proposal: GeneratedBoard): Promise<void> {
    await this.ready; const key = this.requestKey(request); const board = this.sanitize(proposal);
    if (!key || !board) return;
    const terms = [...new Set(board.tiles.flatMap(tile => genericWords(tile.pictureConcept!.description).split(' ')).filter(term => genericTokens.has(term)))];
    const pictures: Template['pictures'] = [];
    for (const [index, tile] of board.tiles.entries()) {
      const item = genericConcept(tile.pictureConcept!)!;
      const mode = tile.pictureOptions?.mode ?? board.picturePolicy?.mode ?? 'auto';
      const picture = await this.picture(item, tile.pictureOptions?.style ?? board.picturePolicy?.style ?? 'color');
      if (picture && picture.kind !== 'unresolved' && mode !== 'emoji' && (mode !== 'library' || picture.kind === 'library') && (mode !== 'generated' || picture.kind === 'generated')) pictures.push({ index, picture });
    }
    const record = { key, terms, board, pictures }; await this.write(`template-${key}.json`, record); this.templates.set(key, record);
  }
}
