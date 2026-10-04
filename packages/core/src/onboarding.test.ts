import { describe, expect, it } from 'vitest';
import { configureSetup, finishSetup, newLibrary, saveStarterDraft, starterBoard } from './onboarding';
import { migrateLibrary, type BoardProposal } from './schema';
import { starterLibrary } from './starter';

const profile = { languages: ['fr-FR', 'es-ES'], defaultLanguage: 'fr-FR' };
const proposal = (): BoardProposal => ({ boardId: null, baseRevision: null, proposal: { title: 'Animaux', explanation: 'Six animaux.', needsClarification: false, tiles: Array.from({ length: 6 }, (_, i) => ({ existingId: null, label: `Mot ${i}`, speech: `Mot ${i}`, language: 'fr-FR', emoji: '🐄', color: 'sage', languageMode: 'board', translations: [{ language: 'es-ES', label: `Palabra ${i}`, speech: `Palabra ${i}` }] })) } });
const makeBoard = () => { let id = 0; return starterBoard(proposal(), profile, () => `board-${id++}`); };

describe('first-time setup', () => {
  it('starts a fresh device empty while existing and previously emptied libraries skip setup', () => {
    expect(newLibrary('fr-FR')).toMatchObject({ boards: [], setup: { stage: 'languages', drafts: [] }, settings: { languageProfile: { defaultLanguage: 'fr-FR' } } });
    const old = starterLibrary();
    expect(migrateLibrary(old).setup).toBeUndefined();
    expect(migrateLibrary({ ...old, boards: [] }).setup).toBeUndefined();
  });
  it('requires six cards in the default language and complete translations', () => {
    let next = 0; const id = () => `id-${next++}`;
    const board = makeBoard();
    expect(board.playLanguages).toEqual(['fr-FR', 'es-ES']);
    expect(board.tiles.every(tile => tile.languageMode === 'board')).toBe(true);
    const partial = proposal(); partial.proposal.tiles[0].translations = [];
    expect(() => starterBoard(partial, profile, id)).toThrow('missing');
    const wrong = proposal(); wrong.proposal.tiles[0].language = 'en-US';
    expect(() => starterBoard(wrong, profile, id)).toThrow('missing');
    const short = proposal(); short.proposal.tiles.pop();
    expect(() => starterBoard(short, profile, id)).toThrow('missing');
  });
  it('persists completed drafts for retry without publishing or duplicating them', () => {
    const configured = configureSetup(newLibrary(), profile, ' http://localhost:8788/ ');
    const saved = saveStarterDraft(configured, 'farm', makeBoard(), profile);
    const restored = migrateLibrary(JSON.parse(JSON.stringify(saved)));
    expect(restored.boards).toEqual([]);
    expect(restored.settings.backendUrl).toBe('http://localhost:8788');
    expect(saveStarterDraft(restored, 'farm', makeBoard(), profile).setup?.drafts).toHaveLength(1);
    expect(() => finishSetup(restored, ['farm', 'family'])).toThrow('Finish generating');
    const done = finishSetup(restored, ['farm']);
    expect(done.setup).toBeUndefined(); expect(done.boards).toHaveLength(1);
    expect(finishSetup(done, ['farm'])).toEqual(done);
  });
  it('invalidates old drafts after a language change and rejects late results', () => {
    const saved = saveStarterDraft(configureSetup(newLibrary(), profile, ''), 'farm', makeBoard(), profile);
    expect(configureSetup(saved, profile, 'http://other').setup?.drafts).toHaveLength(1);
    const changed = configureSetup(saved, { languages: ['de-DE'], defaultLanguage: 'de-DE' }, '');
    expect(changed.setup?.drafts).toEqual([]);
    expect(() => saveStarterDraft(changed, 'family', makeBoard(), profile)).toThrow('changed');
  });
  it('allows an offline empty start without inventing English starter content', () => {
    const configured = configureSetup(newLibrary(), profile, '');
    const done = finishSetup(configured, ['farm'], false);
    expect(done.setup).toBeUndefined(); expect(done.boards).toEqual([]);
    expect(done.settings.languageProfile).toEqual(profile);
    expect(done.settings.aiConsent).toBe(false);
  });
});
