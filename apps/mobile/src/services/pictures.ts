/** @file Resolves staged board pictures with bounded jobs, local downloads, cancellation, and revision-safe proposal previews. */

import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { applyProposal, defaultPicturePolicy, pictureAnalysisSchema, pictureJobSchema, pictureTargets, resolvedPictureSchema, catalogEntrySchema, type Board, type BoardProposal, type PicturePolicy, type Settings, type Tile } from '@little-say/core';
import { apiFetch, backendUrl } from './api';
import { savePictureAsset } from '../data/storage';

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export interface PictureWorkOptions {
  signal?: AbortSignal;
  targetIds?: Set<string>;
  restyle?: boolean;
  regenerate?: boolean;
  forceIds?: Set<string>;
  replaceProtected?: boolean;
  expandConsistency?: boolean;
  allowGeneration?: boolean;
  /** Report parent-facing progress without publishing draft changes to the saved board. */
  progress?: (message: string) => void;
}

/** Download a resolved picture before its reference is eligible for a board save. */
export async function storeResolvedPicture(server: string, picture: Tile['illustration'], signal?: AbortSignal): Promise<void> {
  if (picture.kind === 'library' || picture.kind === 'generated') await savePictureAsset(picture.assetId, `${backendUrl(server)}/api/pictures/assets/${picture.assetId}.png`, signal);
}

/** Search the trusted catalog; descriptions and licensing information come from the server. */
export async function searchLibraryPictures(server: string, query: string, style: PicturePolicy['style'], signal?: AbortSignal) {
  return z.object({ entries: z.array(catalogEntrySchema) }).parse(await apiFetch(server, `/api/pictures/search?q=${encodeURIComponent(query)}&style=${style}`, {}, signal)).entries;
}

/** Select a library asset manually and save its verified bytes locally before returning the illustration. */
export async function chooseLibraryPicture(server: string, id: string, signal?: AbortSignal) {
  const result = z.object({ picture: resolvedPictureSchema }).parse(await apiFetch(server, `/api/pictures/library/${encodeURIComponent(id)}`, {}, signal));
  await storeResolvedPicture(server, result.picture, signal); return result.picture;
}

function pause(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(new Error('Picture work stopped.')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, 1000);
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  });
}

/** Prepare a detached board draft; failures retain saved images and never mutate the supplied board. */
export async function prepareBoardPictures(board: Board, settings: Settings, options: PictureWorkOptions = {}): Promise<{ board: Board; issues: string[] }> {
  // Old saved styles remain readable, but all newly prepared artwork uses the simple color presentation.
  const policy: PicturePolicy = { ...(board.picturePolicy ?? settings.pictureDefaults ?? defaultPicturePolicy), style: 'color' };
  const result: Board = { ...board, picturePolicy: policy, tiles: board.tiles.map(tile => ({ ...tile })) };
  const issues: string[] = [];
  const eligible = board.tiles.filter(tile => (!options.targetIds || options.targetIds.has(tile.id) || (options.expandConsistency && policy.consistent && tile.illustration.kind === 'emoji')) && ((!tile.pictureOptions?.locked && tile.illustration.kind !== 'photo') || (options.replaceProtected && options.targetIds?.has(tile.id))));
  if (!eligible.length) return { board: result, issues };
  if (!settings.aiConsent) return { board: result, issues: ['Automatic matching needs AI consent. You can choose pictures manually.'] };
  options.progress?.('Checking picture meanings…');
  let analysis: z.infer<typeof pictureAnalysisSchema>;
  try {
    analysis = pictureAnalysisSchema.parse(await apiFetch(settings.backendUrl, '/api/pictures/analyze', json({ tiles: board.tiles.map(tile => ({ id: tile.id, label: tile.label, language: tile.language, emoji: tile.illustration.kind === 'emoji' ? tile.illustration.emoji : '', instruction: tile.pictureOptions?.instruction ?? '' })) }), options.signal));
    if (analysis.tiles.length !== board.tiles.length || new Set(analysis.tiles.map(tile => tile.id)).size !== board.tiles.length || analysis.tiles.some(tile => !board.tiles.some(input => input.id === tile.id))) throw new Error('Incomplete picture meanings.');
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { board: result, issues: [(error as Error).message] };
  }
  const concepts = new Map(analysis.tiles.map(tile => [tile.id, tile.concept]));
  const emoji = new Map(analysis.tiles.map(tile => [tile.id, tile.emoji]));
  const targets = pictureTargets(board.tiles.map(tile => ({ id: tile.id, emoji: tile.illustration.kind === 'emoji' ? tile.illustration.emoji : '', concept: concepts.get(tile.id)!, locked: !eligible.some(value => value.id === tile.id), mode: tile.pictureOptions?.mode })), policy);
  // A restyle or explicit regenerate resolves the complete eligible illustration set.
  if (options.restyle || options.regenerate) for (const tile of eligible) if ((tile.pictureOptions?.mode ?? policy.mode) !== 'emoji') targets.add(tile.id);
  for (const id of options.forceIds ?? []) if (eligible.some(tile => tile.id === id && (tile.pictureOptions?.mode ?? policy.mode) !== 'emoji')) targets.add(id);
  const forceIds = new Set(options.forceIds);
  const existing = eligible.flatMap(tile => tile.illustration.kind === 'library' || tile.illustration.kind === 'generated' ? [{ id: tile.id, assetId: tile.illustration.assetId, concept: concepts.get(tile.id)! }] : []);
  if (existing.length && !options.restyle && !options.regenerate) {
    try {
      const review = z.object({ rejected: z.array(z.string()) }).parse(await apiFetch(settings.backendUrl, '/api/pictures/review', json({ cards: existing }), options.signal));
      for (const id of review.rejected) if (existing.some(card => card.id === id)) { targets.add(id); forceIds.add(id); }
    } catch (error) { if (options.signal?.aborted) throw error; issues.push('Existing pictures could not be checked. They have been kept.'); }
  }
  for (const tile of result.tiles) tile.pictureConcept = concepts.get(tile.id);
  for (const tile of result.tiles) if (eligible.some(value => value.id === tile.id) && (tile.pictureOptions?.mode ?? policy.mode) === 'emoji') {
    tile.illustration = { kind: 'emoji', emoji: emoji.get(tile.id)! };
    if (!concepts.get(tile.id)!.emojiAccurate) issues.push(`${tile.label}: the closest emoji is approximate. Emoji-only mode keeps your choice.`);
  }
  const todo = eligible.filter(tile => (tile.pictureOptions?.mode ?? policy.mode) !== 'emoji' && targets.has(tile.id) && (options.restyle || options.regenerate || forceIds.has(tile.id) || tile.illustration.kind === 'emoji' || tile.illustration.kind === 'unresolved'));
  const draftId = Crypto.randomUUID(); let cursor = 0; let done = 0;
  const changed = new Set<string>();
  const worker = async () => {
    while (cursor < todo.length && !options.signal?.aborted) {
      const tile = todo[cursor++]; const id = Crypto.randomUUID();
      const cancel = () => { void apiFetch(settings.backendUrl, `/api/pictures/jobs/${id}/cancel`, json({})).catch(() => {}); };
      options.signal?.addEventListener('abort', cancel, { once: true });
      try {
        const mode = tile.pictureOptions?.mode ?? policy.mode;
        let job = pictureJobSchema.parse(await apiFetch(settings.backendUrl, '/api/pictures/jobs', json({ requestId: id, draftId, tileId: tile.id, concept: concepts.get(tile.id), style: 'color', mode: mode === 'emoji' ? 'auto' : mode, allowGeneration: Boolean(options.allowGeneration ?? settings.autoImages), regenerate: Boolean(options.regenerate), neighbors: board.tiles.filter(other => other.id !== tile.id).map(other => concepts.get(other.id)!.description) }), options.signal));
        while (job.state === 'queued' || job.state === 'working') { await pause(options.signal); job = pictureJobSchema.parse(await apiFetch(settings.backendUrl, `/api/pictures/jobs/${id}`, {}, options.signal)); }
        if (job.id !== id || job.draftId !== draftId || job.tileId !== tile.id) throw new Error('This picture belongs to an older draft.');
        if (job.state !== 'complete' || !job.result) throw new Error(job.error || 'Picture work stopped.');
        const picture = job.result;
        if (picture.kind === 'unresolved') throw new Error(picture.reason);
        if (picture.kind === 'generated' && (mode === 'library' || !(options.allowGeneration ?? settings.autoImages))) throw new Error('This picture does not match your source permission.');
        await storeResolvedPicture(settings.backendUrl, picture, options.signal);
        result.tiles = result.tiles.map(value => value.id === tile.id ? { ...value, illustration: picture } : value); changed.add(tile.id);
      } catch (error) {
        if (options.signal?.aborted) { cancel(); throw error; }
        const reason = (error as Error).message; issues.push(`${tile.label}: ${reason}`);
        // Existing asset-backed pictures survive unsuccessful replacement attempts.
        if (tile.illustration.kind === 'emoji' || tile.illustration.kind === 'unresolved') result.tiles = result.tiles.map(value => value.id === tile.id ? { ...value, illustration: { kind: 'unresolved', reason: reason.slice(0, 300) } } : value);
      } finally { options.signal?.removeEventListener('abort', cancel); done++; options.progress?.(`Preparing pictures · ${done} of ${todo.length}`); }
    }
  };
  await Promise.all([worker(), worker()]);
  if (options.signal?.aborted) throw new Error('Picture work stopped.');
  if (changed.size) {
    options.progress?.('Checking the pictures together…');
    const cards = result.tiles.flatMap(tile => (tile.illustration.kind === 'library' || tile.illustration.kind === 'generated') ? [{ id: tile.id, assetId: tile.illustration.assetId, concept: concepts.get(tile.id)! }] : []);
    try {
      const review = z.object({ rejected: z.array(z.string()) }).parse(await apiFetch(settings.backendUrl, '/api/pictures/review', json({ cards }), options.signal));
      if (review.rejected.some(id => !cards.some(card => card.id === id))) throw new Error('Invalid picture review.');
      for (const id of review.rejected) {
        const original = board.tiles.find(tile => tile.id === id)!;
        issues.push(`${original.label}: this picture may be inaccurate or hard to distinguish.`);
        if (changed.has(id)) result.tiles = result.tiles.map(tile => tile.id === id ? { ...tile, illustration: original.illustration.kind !== 'emoji' && original.illustration.kind !== 'unresolved' ? original.illustration : { kind: 'unresolved', reason: 'Choose a clearer, distinguishable picture.' } } : tile);
      }
    } catch (error) { if (options.signal?.aborted) throw error; issues.push('The final picture review was unavailable. Check each picture before saving.'); }
  }
  return { board: result, issues };
}

/** Build the exact preview used for applying an AI proposal, including staged picture overrides. */
export function proposalPreview(source: Board | undefined, proposal: BoardProposal): Board {
  let index = 0; return applyProposal(source ?? null, proposal, () => `draft-${index++}`);
}

/** Resolve new/requested AI pictures while retaining matching images from prior conversational drafts. */
export async function prepareProposalPictures(source: Board | undefined, envelope: BoardProposal, settings: Settings, options: PictureWorkOptions = {}, previous?: BoardProposal | null) {
  let board = proposalPreview(source, envelope);
  const targetIds = new Set<string>();
  const forceIds = new Set<string>();
  const signature = (tile: BoardProposal['proposal']['tiles'][number]) => JSON.stringify([tile.existingId, tile.label, tile.language, tile.pictureOptions, tile.replacePicture]);
  board.tiles = board.tiles.map((tile, index) => {
    const proposed = envelope.proposal.tiles[index];
    const oldIndex = previous?.proposal.tiles.findIndex(old => signature(old) === signature(proposed)) ?? -1;
    const old = previous?.pictures?.find(picture => picture.index === oldIndex);
    if (old && JSON.stringify(previous?.proposal.picturePolicy) === JSON.stringify(envelope.proposal.picturePolicy)) return { ...tile, illustration: old.illustration, pictureConcept: old.concept };
    if (!proposed.existingId || proposed.replacePicture) {
      targetIds.add(tile.id);
      if (proposed.replacePicture) forceIds.add(tile.id);
      const original = source?.tiles.find(value => value.id === proposed.existingId);
      return proposed.replacePicture ? { ...tile, illustration: original?.illustration ?? tile.illustration } : tile;
    }
    return tile;
  });
  const prepared = await prepareBoardPictures(board, settings, { ...options, targetIds, forceIds, replaceProtected: true, expandConsistency: !source });
  return { proposal: { ...envelope, pictures: prepared.board.tiles.map((tile, index) => ({ index, illustration: tile.illustration, concept: tile.pictureConcept })) }, issues: prepared.issues };
}
