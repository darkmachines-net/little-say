/** @file Connects library loading and serialized durable writes to React state. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { type Library, newLibrary } from '@little-say/core';
import * as storage from './storage';

/**
 * Load the local library without silently resetting failures. Expose optimistic edits,
 * save-before-display commits, retry, and pending-write flushing.
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
      // Prune only during initial load, before transient drafts and undo history exist.
      const boards = [...value.boards, ...(value.setup?.drafts.map(draft => draft.board) ?? [])];
      const ids = new Set(boards.flatMap(b => b.tiles.flatMap(t => t.illustration.kind === 'photo' ? [t.illustration.assetId] : [])));
      await storage.pruneAssets(ids).catch(() => {});
      await storage.prunePictures(new Set(boards.flatMap(b => b.tiles.flatMap(t => t.illustration.kind === 'library' || t.illustration.kind === 'generated' ? [t.illustration.assetId] : [])))).catch(() => {});
      latest.current = value; setLibrary(value);
    } catch { setLoadError('Your saved boards could not be opened. They have not been reset. Check available device storage and try again.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const change = useCallback((update: (current: Library) => Library): Promise<void> => {
    if (!latest.current) return Promise.reject(new Error('The library is still opening.'));
    const value = update(latest.current);
    latest.current = value; setLibrary(value); setSaving(true);
    const currentSequence = ++sequence.current;
    const next = writes.current.catch(() => {}).then(() => storage.saveLibrary(value));
    writes.current = next;
    void next.then(() => { if (currentSequence === sequence.current) { setError(''); setSaving(false); } }, () => {
      if (currentSequence === sequence.current) { setError('Changes are on screen but could not be saved. Free some device storage, then retry before closing the app.'); setSaving(false); }
    });
    return next;
  }, []);
  const retry = useCallback(() => change(current => current), [change]);
  // Reviewed drafts and setup become visible only after storage succeeds. Serializing the
  // updater too keeps concurrent generated drafts from overwriting one another.
  const commit = useCallback((update: (current: Library) => Library, failureMessage = 'Changes could not be saved. Check available device storage and try again.'): Promise<void> => {
    setSaving(true);
    const currentSequence = ++sequence.current;
    const next = writes.current.catch(() => {}).then(async () => {
      if (!latest.current) throw new Error('The library is still opening.');
      const value = update(latest.current);
      await storage.saveLibrary(value);
      latest.current = value; setLibrary(value);
    });
    writes.current = next;
    void next.then(() => { if (currentSequence === sequence.current) { setError(''); setSaving(false); } }, () => {
      if (currentSequence === sequence.current) { setError(failureMessage); setSaving(false); }
    });
    return next;
  }, []);
  const commitSetup = useCallback((update: (current: Library) => Library) => commit(update, 'Setup could not be saved. Check available device storage and try again.'), [commit]);
  // Sync uses the optimistic serialized path: a foreground edit during the disk write stays newer
  // than the downloaded snapshot, and the cloud acknowledgement is saved alongside its merge.
  const mergeSync = change;
  return { library, current: latest, change, commit, commitSetup, mergeSync, saving, error, loadError, reload: load, retry, flush: () => writes.current };
}
