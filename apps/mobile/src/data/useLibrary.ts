/** @file Loads the local library and serializes optimistic edits and durable commits through one save queue. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { type Library, newLibrary, migrateDeviceSettings } from '@little-say/core';
import * as storage from './storage';

/**
 * Load the local library without resetting failures. Serialize optimistic edits and
 * save-before-display commits in one queue; expose retry and flushing of the queued tail.
 */
export function useLibrary() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const latest = useRef<Library | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const sequence = useRef(0);
  const load = useCallback(async () => {
    setLoadError('');
    try {
      let value = await storage.loadLibrary();
      if (!value) { value = newLibrary(Intl.DateTimeFormat().resolvedOptions().locale); await storage.saveLibrary(value); }
      const migrated = migrateDeviceSettings(value);
      if (migrated !== value) { await storage.saveLibrary(migrated); value = migrated; }
      // Prune only during initial load, before transient drafts and undo history exist.
      const boards = [...value.boards, ...(value.setup?.drafts.map(draft => draft.board) ?? []), ...(value.creationDraft ? [value.creationDraft.board, ...(value.creationDraft.suggestion ? [value.creationDraft.suggestion.base, value.creationDraft.suggestion.board] : [])] : [])];
      const draftPictures = value.boardCreationDraft?.draft?.pictures?.map(picture => picture.illustration) ?? [];
      const ids = new Set(boards.flatMap(b => b.tiles.flatMap(t => t.illustration.kind === 'photo' ? [t.illustration.assetId] : [])));
      await storage.pruneAssets(ids).catch(() => {});
      await storage.prunePictures(new Set([...boards.flatMap(b => b.tiles.map(t => t.illustration)), ...draftPictures].flatMap(illustration => illustration.kind === 'library' || illustration.kind === 'generated' ? [illustration.assetId] : []))).catch(() => {});
      latest.current = value; setLibrary(value);
    } catch { setLoadError('Your saved boards could not be opened. They have not been reset. Check available device storage and try again.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const enqueue = useCallback((write: () => Promise<void>, failureMessage: string): Promise<void> => {
    setSaving(true);
    const currentSequence = ++sequence.current;
    // A failed write must not block retries. Only the newest queued write owns the visible status.
    const next = writes.current.catch(() => {}).then(write);
    writes.current = next;
    const settled = (message: string) => {
      if (currentSequence !== sequence.current) return;
      setError(message);
      setSaving(false);
    };
    void next.then(() => settled(''), () => settled(failureMessage));
    return next;
  }, []);
  const change = useCallback((update: (current: Library) => Library): Promise<void> => {
    if (!latest.current) return Promise.reject(new Error('The library is still opening.'));
    const value = update(latest.current);
    latest.current = value;
    setLibrary(value);
    return enqueue(() => storage.saveLibrary(value), 'Changes are on screen but could not be saved. Free some device storage, then retry before closing the app.');
  }, [enqueue]);
  const retry = useCallback(() => change(current => current), [change]);
  // Reviewed drafts and setup become visible only after storage succeeds. Serializing the
  // updater too keeps concurrent generated drafts from overwriting one another.
  const commit = useCallback((update: (current: Library) => Library, failureMessage = 'Changes could not be saved. Check available device storage and try again.'): Promise<void> => {
    return enqueue(async () => {
      if (!latest.current) throw new Error('The library is still opening.');
      const value = update(latest.current);
      await storage.saveLibrary(value);
      latest.current = value; setLibrary(value);
    }, failureMessage);
  }, [enqueue]);
  const commitSetup = useCallback((update: (current: Library) => Library) => commit(update, 'Setup could not be saved. Check available device storage and try again.'), [commit]);
  // Sync uses the optimistic serialized path: a foreground edit during the disk write stays newer
  // than the downloaded snapshot, and the cloud acknowledgement is saved alongside its merge.
  const mergeSync = change;
  return { library, current: latest, change, commit, commitSetup, mergeSync, saving, error, loadError, reload: load, retry, flush: () => writes.current };
}
