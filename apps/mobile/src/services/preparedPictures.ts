/** @file Downloads negotiated preparation results before publishing saveable drafts and follows one cancellable board batch. */

import { pictureBatchSchema, applyProposal, speechKey, speechSource, type Board, type BoardProposal, type Settings } from '@little-say/core';
import { apiFetch, backendUrl } from './api';
import { savePictureAsset, saveSpeechAsset } from '../data/storage';
import { type PictureWorkOptions } from './pictures';

/**
 * Download pictures concurrently and publish only verified local assets as saveable draft references.
 * Follow one active batch; immediate results need no polling. Cancellation freezes the last published
 * draft and stops server work, preventing late picture mutation after save. Unsuitable results remain
 * explicit fallbacks. Cached speech downloads independently and never delay picture readiness.
 */
export async function prepareServerPictures(source: Board | undefined, envelope: BoardProposal, settings: Settings, options: PictureWorkOptions, previous?: BoardProposal | null): Promise<{ proposal: BoardProposal; issues: string[] }> {
  let batch = pictureBatchSchema.parse(envelope.preparation);
  const id = batch.id;
  let index = 0;
  const board = applyProposal(source ?? null, { ...envelope, pictures: undefined }, () => `draft-${index++}`);
  const signature = (tile: BoardProposal['proposal']['tiles'][number]) => JSON.stringify([tile.existingId, tile.pictureConcept, tile.emoji, tile.pictureOptions]);
  board.tiles = board.tiles.map((tile, index) => {
    const proposed = envelope.proposal.tiles[index];
    const mode = proposed.pictureOptions?.mode ?? envelope.proposal.picturePolicy?.mode ?? 'auto';
    if (mode === 'emoji') return tile;
    const original = source?.tiles.find(value => value.id === proposed.existingId);
    if (original && proposed.replacePicture) return { ...tile, illustration: original.illustration, pictureConcept: original.pictureConcept };
    const oldIndex = !proposed.replacePicture && JSON.stringify(previous?.proposal.picturePolicy) === JSON.stringify(envelope.proposal.picturePolicy) ? previous?.proposal.tiles.findIndex(value => signature(value) === signature(proposed)) : -1;
    const retained = previous?.pictures?.find(value => value.index === oldIndex);
    return retained ? { ...tile, illustration: retained.illustration, pictureConcept: retained.concept } : tile;
  });
  const downloaded = new Set<string>();
  const failed = new Set<number>();
  const cancel = () => { void apiFetch(settings.backendUrl, `/api/pictures/batches/${id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  const check = () => { if (options.signal?.aborted) throw new Error('Picture work stopped.'); };
  const publish = () => { check(); options.preview?.({ ...board, tiles: [...board.tiles] }); };
  const merge = async () => {
    if (batch.tiles.length !== board.tiles.length || new Set(batch.tiles.map(tile => tile.index)).size !== batch.tiles.length || batch.tiles.some(tile => tile.index >= board.tiles.length)) throw new Error('Invalid picture batch.');
    await Promise.all(batch.tiles.map(async state => {
      const tile = board.tiles[state.index];
      const proposed = envelope.proposal.tiles[state.index];
      const mode = proposed.pictureOptions?.mode ?? envelope.proposal.picturePolicy?.mode ?? 'auto';
      const style = proposed.pictureOptions?.style ?? envelope.proposal.picturePolicy?.style ?? 'color';
      const picture = state.result;
      const key = `${state.index}:${picture && picture.kind !== 'unresolved' ? picture.assetId : ''}`;
      if (picture && picture.kind !== 'unresolved' && !downloaded.has(key) && !failed.has(state.index)) {
        try {
          if ((proposed.existingId && !proposed.replacePicture) || mode === 'emoji' || picture.style !== style || (mode === 'library' && picture.kind === 'generated') || (mode === 'generated' && picture.kind !== 'generated')) throw new Error('Picture source mismatch.');
          await savePictureAsset(picture.assetId, `${backendUrl(settings.backendUrl)}/api/pictures/assets/${picture.assetId}.png`, options.signal);
          check();
          board.tiles = board.tiles.map((value, i) => i === state.index ? { ...value, illustration: picture, pictureConcept: proposed.pictureConcept } : value);
          downloaded.add(key);
        } catch { check(); failed.add(state.index); }
      }
      check(); options.tileProgress?.(tile.id, failed.has(state.index) ? 'fallback' : state.state);
    }));
    publish();
  };
  const pause = () => new Promise<void>((resolve, reject) => {
    const stop = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', stop); reject(new Error('Picture work stopped.')); };
    const timer = setTimeout(() => { options.signal?.removeEventListener('abort', stop); resolve(); }, 350);
    options.signal?.addEventListener('abort', stop, { once: true }); if (options.signal?.aborted) stop();
  });
  try {
    check();
    // Cached speech is useful immediately but never holds up picture readiness or a save.
    void Promise.allSettled((envelope.speech ?? []).filter(clip => speechSource(settings, clip.language) === 'ai').map(async clip => {
      if (options.signal?.aborted) return;
      await saveSpeechAsset(speechKey(clip), clip.id, `${backendUrl(settings.backendUrl)}/api/speech/${clip.id}.wav`);
    })).then(() => options.speechReady?.()).catch(() => {});
    await merge(); options.available?.();
    while (batch.state === 'working') {
      options.progress?.(`Improving pictures · ${batch.tiles.filter(tile => tile.state === 'ready').length} of ${board.tiles.length} ready`);
      await pause();
      const next = pictureBatchSchema.parse(await apiFetch(settings.backendUrl, `/api/pictures/batches/${id}`, {}, options.signal));
      if (next.id !== id) throw new Error('Picture batch belongs to another draft.');
      batch = next; await merge();
    }
    const incomplete = new Set([...failed, ...batch.tiles.filter(tile => tile.state !== 'ready').map(tile => tile.index)]);
    return { proposal: { ...envelope, preparation: batch, pictures: board.tiles.map((tile, index) => ({ index, illustration: tile.illustration, concept: envelope.proposal.tiles[index].pictureConcept })) }, issues: incomplete.size ? ['Some cards still use fallback pictures. You can save this board and improve them later.'] : [] };
  } catch (error) { cancel(); throw error; }
  finally { options.signal?.removeEventListener('abort', cancel); }
}
