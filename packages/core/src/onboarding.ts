/**
 * @file Defines resumable first-use setup and validates generated starter boards against selected
 * languages.
 */

import { applyProposal, languageProfileSchema, starterTopicsSchema, type Board, type BoardProposal, type LanguageProfile, type Library, type StarterTopic } from './schema';
import { canonicalLanguage, hasTileLanguage } from './boardLanguages';
import { getLanguageProfile, initialLanguageProfile, profileLanguages } from './languageProfile';

export const starterTopics: { id: StarterTopic; title: string; emoji: string; prompt: string }[] = [
  { id: 'farm', title: 'Farm animals', emoji: '🐄', prompt: 'cow, sheep, horse, pig, chicken, and duck' },
  { id: 'everyday', title: 'Everyday words', emoji: '👋', prompt: 'more, water, help, all done, eat, and love you' },
  { id: 'family', title: 'Family', emoji: '🏠', prompt: 'mother, father, grandmother, grandfather, sister, and brother' },
];

/** Create an empty library with setup pending and language preferences derived from the device locale. */
export function newLibrary(locale?: string): Library {
  return { version: 1, boards: [], settings: { backendUrl: '', voices: {}, activeBoardId: null, aiConsent: false, autoSpeech: true, languageProfile: initialLanguageProfile(locale) }, setup: { stage: 'languages', topics: starterTopics.map(topic => topic.id), drafts: [] } };
}

/** Build the six-card generation prompt for a supported starter topic. */
export function starterPrompt(topic: StarterTopic): string {
  const content = starterTopics.find(value => value.id === topic)!;
  return `Create a starter soundboard with exactly six cards for these concepts: ${content.prompt}. Use the device language profile. Write the board title and base words in the default language. Every card must work in every selected language, with natural spoken words and labels in each language. Set every card to follow the board language when multiple languages are selected. Family words are generic roles, not specific people's names. Use a clear emoji per card.`;
}

/**
 * Apply a new-board proposal and require six cards covering every selected language; keep only the
 * chosen language variants.
 */
export function starterBoard(proposal: BoardProposal, profile: LanguageProfile, id: () => string): Board {
  const board = applyProposal(null, proposal, id);
  const languages = profileLanguages({ languageProfile: profile });
  if (board.tiles.length !== 6 || board.tiles.some(tile => canonicalLanguage(tile.language) !== profile.defaultLanguage || languages.some(tag => !hasTileLanguage(tile, tag)))) throw new Error('Some cards or language versions were missing. Please retry this board.');
  // The setup choices are authoritative; never add an unselected language.
  return { ...board, playLanguages: languages, tiles: board.tiles.map(tile => ({ ...tile, languageMode: languages.length > 1 ? 'board' : 'fixed', translations: tile.translations?.filter(translation => languages.includes(canonicalLanguage(translation.language)) && canonicalLanguage(translation.language) !== profile.defaultLanguage) })) };
}

/**
 * Save validated setup preferences and server address, discarding generated drafts when the language
 * profile changes.
 */
export function configureSetup(library: Library, profile: LanguageProfile, backendUrl: string): Library {
  if (!library.setup) throw new Error('Setup is already complete.');
  const valid = languageProfileSchema.parse(profile);
  const changed = JSON.stringify(getLanguageProfile(library.settings)) !== JSON.stringify(valid);
  return { ...library, settings: { ...library.settings, languageProfile: valid, backendUrl: backendUrl.trim().replace(/\/+$/, '') }, setup: { ...library.setup, stage: 'boards', drafts: changed ? [] : library.setup.drafts } };
}

/** Replace the draft for one topic only while setup and the original language profile remain current. */
export function saveStarterDraft(library: Library, topic: StarterTopic, board: Board, profile: LanguageProfile): Library {
  if (!library.setup || JSON.stringify(getLanguageProfile(library.settings)) !== JSON.stringify(profile)) throw new Error('Language preferences changed. Generate the board again.');
  return { ...library, setup: { ...library.setup, drafts: [...library.setup.drafts.filter(draft => draft.topic !== topic), { topic, board }] } };
}

/**
 * Complete setup with the selected drafts or an empty start, rejecting missing drafts when requested
 * and avoiding duplicate board IDs.
 */
export function finishSetup(library: Library, topics: StarterTopic[], useDrafts = true): Library {
  if (!library.setup) return library;
  starterTopicsSchema.parse(topics);
  const boards = useDrafts ? topics.map(topic => {
    const draft = library.setup!.drafts.find(value => value.topic === topic);
    if (!draft) throw new Error('Finish generating these boards or choose to start without them.');
    return draft.board;
  }) : [];
  return { ...library, setup: undefined, boards: [...library.boards, ...boards.filter(board => !library.boards.some(existing => existing.id === board.id))] };
}
