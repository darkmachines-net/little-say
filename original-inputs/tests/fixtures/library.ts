/**
 * @file Provides a deterministic existing library for tests without depending on generated onboarding
 * content.
 */

import { colors, type Board, type Library, type LanguageProfile } from '../../packages/core/src/schema';
import { initialLanguageProfile } from '../../packages/core/src/languageProfile';

// Representative existing-device content for tests and opt-in live evaluations.
// Production first launch creates boards through the language-aware setup flow.
/** Create a fresh sample library with stable board content for isolated test setup. */
export function starterLibrary(languageProfile: LanguageProfile = initialLanguageProfile()): Library {
  const now = new Date().toISOString();
  const board = (id: string, title: string, entries: string[][]): Board => ({ id, title, revision: 0, createdAt: now, updatedAt: now,
    tiles: entries.map(([label, emoji, speech, language], i) => ({ id: `${id}-${i}`, label, speech: speech ?? label, language: language ?? 'en-US', color: colors[i % colors.length], illustration: { kind: 'emoji', emoji } })) });
  return { version: 2, settings: { backendUrl: '', voices: {}, activeBoardId: null, aiConsent: false, autoSpeech: true, languageProfile }, boards: [
    board('starter-farm', 'Farmyard friends', [['Cow','🐄'],['Sheep','🐑'],['Horse','🐴'],['Pig','🐷'],['Chicken','🐔'],['Duck','🦆']]),
    board('starter-everyday', 'My little words', [['More','➕'],['Water','💧'],['Help','🙋'],['All done','👋'],['Eat','🍽️'],['Love you','❤️']]),
    board('starter-family', 'Our family', [['Mama','👩'],['Papa','👨'],['Grandma','👵'],['Grandpa','👴'],['Babushka','👵','бабушка','ru-RU'],['Dedushka','👴','дедушка','ru-RU']]),
  ] };
}
