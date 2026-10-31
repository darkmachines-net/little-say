/** @file Prepares missing board translations after closing language controls, retaining edits and jobs across navigation. */

import { useEffect, useRef, useState } from 'react';
import { applyTranslations, boardWithProfileLanguages, missingTranslations, reviseBoard, type Board } from '@little-say/core';
import type { useLibrary } from '../data/useLibrary';
import { prepareTranslations } from './api';

export type BoardTranslationStatus = { busy: boolean; error?: string };

/**
 * Own per-board background requests for the app lifetime. Flush selection saves before translating,
 * coalesce identical pending requests, and apply only if the latest missing-word request still matches.
 * Cancelled, superseded or unmounted jobs cannot apply. Failed work is retryable; successful updates
 * use the optimistic serialized store so subsequent editor changes stay newer during disk writes.
 */
export function useBoardTranslations(store: Pick<ReturnType<typeof useLibrary>, 'current' | 'change' | 'flush'>, onApplied: (previous: Board) => void) {
  const [status, setStatus] = useState<Record<string, BoardTranslationStatus>>({});
  const jobs = useRef(new Map<string, { controller: AbortController; key: string }>());
  const latest = useRef({ store, onApplied });
  latest.current = { store, onApplied };
  useEffect(() => {
    const active = jobs.current;
    return () => { active.forEach(job => job.controller.abort()); active.clear(); };
  }, []);
  /** Cancel one board's pending request and clear its status without changing its saved language choices. */
  const cancel = (id: string) => {
    jobs.current.get(id)?.controller.abort(); jobs.current.delete(id);
    setStatus(current => ({ ...current, [id]: { busy: false } }));
  };
  /** Fill the board's current gaps; record request/save failures in status for an explicit retry. */
  const prepare = async (id: string) => {
    const library = latest.current.store.current.current;
    const source = library?.boards.find(board => board.id === id);
    if (!source || !library) return;
    const board = boardWithProfileLanguages(source, library.settings);
    const request = missingTranslations(board);
    const key = JSON.stringify(request);
    if (jobs.current.get(id)?.key === key) return;
    cancel(id);
    if (!request) return;
    const controller = new AbortController();
    jobs.current.set(id, { controller, key });
    const active = () => jobs.current.get(id)?.controller === controller && !controller.signal.aborted;
    setStatus(current => ({ ...current, [id]: { busy: true } }));
    try {
      await latest.current.store.flush();
      if (!active()) return;
      if (!latest.current.store.current.current?.settings.aiConsent) {
        await latest.current.store.change(current => ({ ...current, settings: { ...current.settings, aiConsent: true } }));
      }
      if (!active()) return;
      const result = await prepareTranslations(library.settings.backendUrl, request, controller.signal);
      if (!active()) return;
      let previous: Board | undefined;
      const saving = latest.current.store.change(current => {
        const saved = current.boards.find(candidate => candidate.id === id);
        const effective = saved && boardWithProfileLanguages(saved, current.settings);
        if (!active() || !effective || JSON.stringify(missingTranslations(effective)) !== key) throw new Error('This board or its languages changed while translating. Your edits are kept; retry to fill any remaining gaps.');
        const tiles = applyTranslations(effective, result);
        previous = saved;
        const next = reviseBoard(saved!, { tiles });
        return { ...current, boards: current.boards.map(candidate => candidate.id === id ? next : candidate) };
      });
      if (previous) latest.current.onApplied(previous);
      await saving;
      if (active()) setStatus(current => ({ ...current, [id]: { busy: false } }));
    } catch (error) {
      if (active()) setStatus(current => ({ ...current, [id]: { busy: false, error: (error as Error).message } }));
    } finally { if (active()) jobs.current.delete(id); }
  };
  return { status, prepare, cancel };
}
