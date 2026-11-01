/** @file Keeps bounded, session-local undo and redo snapshots independently for each board. */

import { useRef, useState } from 'react';
import type { Board } from '@little-say/core';

type History = { undo: Board[]; redo: Board[] };
type Direction = keyof History;
const empty: History = { undo: [], redo: [] };
const append = (snapshots: Board[], board: Board) => [...snapshots.slice(-19), board];

/**
 * Retain up to 20 changes per board until the app unmounts. New edits discard only that board's
 * redo branch. A synchronous ref keeps consecutive operations ordered before React renders.
 * Callers own persistence and must record edits only after validation or a successful AI commit.
 */
export function useBoardHistory() {
  const [entries, setEntries] = useState<Record<string, History>>({});
  const latest = useRef(entries);
  const update = (next: Record<string, History>) => { latest.current = next; setEntries(next); };

  /** Record the board before a new edit and discard its remaining redo steps. */
  const remember = (board: Board) => {
    const history = latest.current[board.id] ?? empty;
    update({ ...latest.current, [board.id]: { undo: append(history.undo, board), redo: [] } });
  };

  /**
   * Move one snapshot in either direction, retaining the current board for the reverse operation.
   * Return null at the history boundary; restored content gets a fresh revision and edit timestamp.
   */
  const restore = (board: Board, direction: Direction): Board | null => {
    const history = latest.current[board.id] ?? empty;
    const target = history[direction].at(-1);
    if (!target) return null;
    const reverse = direction === 'undo' ? 'redo' : 'undo';
    update({ ...latest.current, [board.id]: {
      ...history, [direction]: history[direction].slice(0, -1), [reverse]: append(history[reverse], board),
    } });
    return { ...target, revision: board.revision + 1, updatedAt: new Date().toISOString() };
  };

  /** Release both history branches when a board or unfinished draft is deleted. */
  const forget = (id: string) => {
    const next = { ...latest.current }; delete next[id]; update(next);
  };

  return { entries, remember, restore, forget };
}
