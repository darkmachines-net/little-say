/** @file Reconciles AI suggestions with direct card and shared-language subset edits while enforcing selected-card scope. */

import { assertTranslationSourceLanguageChange, boardSchema, tileSource, type Board, type Tile } from './schema';

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Keep a card-scoped suggestion within that card; reject removal and ignore unrelated model changes. */
export function scopeBoardSuggestion(source: Board, proposed: Board, tileId: string | null): Board {
  if (!tileId) return proposed;
  const tile = proposed.tiles.find(tile => tile.id === tileId);
  if (!tile || !source.tiles.some(tile => tile.id === tileId)) throw new Error('The selected card was removed. Ask for a change to its words or picture.');
  return { ...source, tiles: source.tiles.map(current => current.id === tileId ? tile : current) };
}

/**
 * Merge only fields changed by the suggestion, retaining newer direct edits and additions.
 * Play-language subsets merge independently from the proposal's language generation context.
 * Conflicts, including newer picture protection or source choices, default to current values.
 * They must be reviewed before committing. An explicit choice
 * resolves only overlapping changes; it never replaces the entire current board with an old snapshot.
 */
export function mergeBoardSuggestion(base: Board, proposed: Board, current: Board, choice?: 'current' | 'suggested') {
  if (base.id !== current.id || proposed.id !== current.id) throw new Error('This suggestion belongs to another board.');
  const conflicts: string[] = [];
  const merge = <T,>(before: T, after: T, latest: T, label: string): T => {
    if (equal(before, after)) return latest;
    if (!equal(before, latest) && !equal(after, latest)) { conflicts.push(label); return choice === 'suggested' ? after : latest; }
    return after;
  };
  const tiles: Tile[] = [];
  for (const latest of current.tiles) {
    const before = base.tiles.find(tile => tile.id === latest.id);
    const after = proposed.tiles.find(tile => tile.id === latest.id);
    if (!before) { tiles.push(latest); continue; }
    if (!after) {
      if (!equal(before, latest)) { conflicts.push(`${latest.label}: removal`); if (choice !== 'suggested') tiles.push(latest); }
      continue;
    }
    const next = { ...latest };
    for (const key of ['label', 'speech', 'language', 'color', 'languageMode', 'translations', 'pictureOptions', 'pictureConcept', 'illustration'] as const) {
      const semanticPictureConflict = ['illustration', 'pictureConcept'].includes(key) && tileSource(before) !== tileSource(latest) && !equal(before[key], after[key]);
      if (semanticPictureConflict) { conflicts.push(`${latest.label}: picture meaning`); if (choice !== 'suggested') continue; }
      const pictureSettingsConflict = ['illustration', 'pictureConcept'].includes(key) && !equal(before[key], after[key]) && (!equal(before.pictureOptions, latest.pictureOptions) || !equal(base.picturePolicy, current.picturePolicy));
      if (pictureSettingsConflict) { conflicts.push(`${latest.label}: picture settings`); if (choice !== 'suggested') continue; }
      Object.assign(next, { [key]: merge(before[key], after[key], latest[key], `${latest.label}: ${key}`) });
    }
    assertTranslationSourceLanguageChange(latest, next, next.translations);
    tiles.push(next);
  }
  for (const after of proposed.tiles) {
    if (current.tiles.some(tile => tile.id === after.id)) continue;
    const before = base.tiles.find(tile => tile.id === after.id);
    if (!before) tiles.push(after);
    else if (!equal(before, after)) { conflicts.push(`${before.label}: deleted card`); if (choice === 'suggested') tiles.push(after); }
  }
  const shared = new Set(base.tiles.filter(tile => proposed.tiles.some(value => value.id === tile.id) && current.tiles.some(value => value.id === tile.id)).map(tile => tile.id));
  const order = (board: Board) => board.tiles.filter(tile => shared.has(tile.id)).map(tile => tile.id);
  const chosenOrder = merge(order(base), order(proposed), order(current), 'Card order');
  const ordered = new Map(tiles.map(tile => [tile.id, tile]));
  // Reorder only common slots. New direct cards keep their positions.
  let index = 0;
  const arranged = tiles.filter(tile => current.tiles.some(value => value.id === tile.id)).map(tile => shared.has(tile.id) ? ordered.get(chosenOrder[index++])! : tile);
  // Insert suggested additions beside their proposed neighbors without moving new direct cards.
  for (const tile of proposed.tiles) {
    if (arranged.some(value => value.id === tile.id) || !ordered.has(tile.id)) continue;
    const position = proposed.tiles.findIndex(value => value.id === tile.id);
    const following = proposed.tiles.slice(position + 1).find(value => arranged.some(current => current.id === value.id));
    const preceding = proposed.tiles.slice(0, position).reverse().find(value => arranged.some(current => current.id === value.id));
    const insertion = following ? arranged.findIndex(value => value.id === following.id) : preceding ? arranged.findIndex(value => value.id === preceding.id) + 1 : arranged.length;
    arranged.splice(insertion, 0, tile);
  }
  const result = boardSchema.parse({ ...current,
    title: merge(base.title, proposed.title, current.title, 'Board title'),
    playLanguages: merge(base.playLanguages, proposed.playLanguages, current.playLanguages, 'Board languages'),
    playLanguageSubset: merge(base.playLanguageSubset, proposed.playLanguageSubset, current.playLanguageSubset, 'Play language choices'),
    picturePolicy: merge(base.picturePolicy, proposed.picturePolicy, current.picturePolicy, 'Picture settings'),
    translateLabels: merge(base.translateLabels, proposed.translateLabels, current.translateLabels, 'Label translations'),
    tiles: arranged,
    revision: current.revision + 1, updatedAt: new Date().toISOString(),
  });
  return { board: result, conflicts: [...new Set(conflicts)] };
}
