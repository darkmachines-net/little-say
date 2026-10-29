/** @file Verifies concurrent manual/AI edits, scoped changes, deletions, ordering, and local-only empty drafts. */

import { describe, expect, it } from 'vitest';
import { starterLibrary } from '../../../tests/fixtures/library';
import { mergeBoardSuggestion, scopeBoardSuggestion } from './boardWorkspace';
import { boardSchema, migrateLibrary, syncSnapshotSchema } from './schema';

describe('shared board workspace', () => {
  it('merges disjoint fields and retains direct additions without replacing current content', () => {
    const base = starterLibrary().boards[0];
    const proposed = structuredClone(base); proposed.tiles[0].speech = 'Hello cow';
    const current = structuredClone(base); current.title = 'Our animals'; current.tiles[1].label = 'My sheep'; current.tiles.push({ ...base.tiles[0], id: 'manual-card', label: 'Water' });
    const result = mergeBoardSuggestion(base, proposed, current);
    expect(result.conflicts).toEqual([]); expect(result.board.title).toBe('Our animals');
    expect(result.board.tiles[0].speech).toBe('Hello cow'); expect(result.board.tiles[1].label).toBe('My sheep'); expect(result.board.tiles.at(-1)?.id).toBe('manual-card');
  });
  it('reports overlapping edits and applies only the explicitly selected conflicting fields', () => {
    const base = starterLibrary().boards[0];
    const proposed = structuredClone(base); proposed.tiles[0].label = 'AI cow'; proposed.tiles[1].color = 'sky';
    const current = structuredClone(base); current.tiles[0].label = 'My cow'; current.title = 'Keep this title';
    expect(mergeBoardSuggestion(base, proposed, current).conflicts).toContain('My cow: label');
    expect(mergeBoardSuggestion(base, proposed, current, 'current').board.tiles[0].label).toBe('My cow');
    const accepted = mergeBoardSuggestion(base, proposed, current, 'suggested').board;
    expect(accepted.tiles[0].label).toBe('AI cow'); expect(accepted.tiles[1].color).toBe('sky'); expect(accepted.title).toBe(current.title);
  });
  it('does not silently delete a directly edited card or resurrect a directly deleted one', () => {
    const base = starterLibrary().boards[0];
    const proposed = structuredClone(base); proposed.tiles.shift();
    const current = structuredClone(base); current.tiles[0].speech = 'My cow';
    expect(mergeBoardSuggestion(base, proposed, current).board.tiles[0].id).toBe(base.tiles[0].id);
    const changed = structuredClone(base); changed.tiles[0].speech = 'AI cow';
    const deleted = { ...base, tiles: base.tiles.slice(1) };
    const result = mergeBoardSuggestion(base, changed, deleted);
    expect(result.conflicts).toContain('Cow: deleted card'); expect(result.board.tiles).toHaveLength(deleted.tiles.length);
  });
  it('preserves concurrent order and limits a scoped model response to its selected card', () => {
    const base = starterLibrary().boards[0];
    const proposed = structuredClone(base); proposed.title = 'Unrequested title'; proposed.tiles.reverse(); proposed.tiles.forEach(tile => { tile.speech = 'Changed'; });
    const scoped = scopeBoardSuggestion(base, proposed, base.tiles[0].id);
    expect(scoped.title).toBe(base.title); expect(scoped.tiles.map(t => t.id)).toEqual(base.tiles.map(t => t.id));
    expect(scoped.tiles[0].speech).toBe('Changed'); expect(scoped.tiles[1]).toEqual(base.tiles[1]);
    expect(() => scopeBoardSuggestion(base, { ...proposed, tiles: [] }, base.tiles[0].id)).toThrow('removed');
  });
  it('flags a stale picture prepared for words that were directly changed', () => {
    const base = starterLibrary().boards[0];
    const proposed = structuredClone(base); proposed.tiles[0].illustration = { kind: 'emoji', emoji: '🐮' };
    const current = structuredClone(base); current.tiles[0].label = 'Water'; current.tiles[0].illustration = { kind: 'emoji', emoji: '💧' };
    const result = mergeBoardSuggestion(base, proposed, current);
    expect(result.conflicts).toContain('Water: picture meaning'); expect(result.board.tiles[0].illustration).toEqual(current.tiles[0].illustration);
  });
  it('inserts AI additions beside requested neighbors while preserving direct additions and conflicting order', () => {
    const base = starterLibrary().boards[0]; base.tiles = base.tiles.slice(0, 3);
    const [a, b, c] = base.tiles;
    const added = { ...a, id: 'ai-added' }; const direct = { ...b, id: 'direct-added' };
    const current = { ...base, tiles: [c, direct, a, b] };
    const proposed = { ...base, tiles: [added, b, a, c] };
    const merged = mergeBoardSuggestion(base, proposed, current);
    expect(merged.conflicts).toContain('Card order');
    expect(merged.board.tiles.map(t => t.id)).toEqual([c.id, direct.id, a.id, added.id, b.id]);
    expect(mergeBoardSuggestion(base, proposed, base).board.tiles.map(t => t.id)).toEqual([added.id, b.id, a.id, c.id]);
  });
  it('protects pictures locked or given new source preferences while AI was working', () => {
    const base = starterLibrary().boards[0];
    const proposed = structuredClone(base); proposed.tiles[0].illustration = { kind: 'emoji', emoji: '🐮' };
    const current = structuredClone(base); current.tiles[0].pictureOptions = { locked: true, instruction: '' };
    const locked = mergeBoardSuggestion(base, proposed, current);
    expect(locked.conflicts).toContain('Cow: picture settings'); expect(locked.board.tiles[0].illustration).toEqual(base.tiles[0].illustration);
    expect(mergeBoardSuggestion(base, proposed, current, 'suggested').board.tiles[0].illustration).toEqual(proposed.tiles[0].illustration);
    current.tiles[0].pictureOptions = undefined; current.picturePolicy = { mode: 'emoji', style: 'color', consistent: false };
    expect(mergeBoardSuggestion(base, proposed, current).conflicts).toContain('Cow: picture settings');
  });
  it('round-trips empty local drafts without allowing empty playable or synced boards', () => {
    const library = starterLibrary(); const empty = { ...library.boards[0], id: 'draft', tiles: [] };
    const draft = { board: empty, prompt: 'A snack board', suggestion: null };
    expect(migrateLibrary({ ...library, creationDraft: draft }).creationDraft).toEqual(draft);
    expect(boardSchema.safeParse(empty).success).toBe(false);
    expect(syncSnapshotSchema.safeParse({ revision: 0, boards: [empty], assets: [] }).success).toBe(false);
    const proposed = { ...empty, tiles: [{ ...library.boards[0].tiles[0], id: 'new-card' }] };
    expect(mergeBoardSuggestion(empty, proposed, empty).board.tiles).toHaveLength(1);
  });
});
