/** @file Defines ready-to-play English sample boards with built-in symbols and no generated-media dependencies. */

import { colors, type Board } from './schema';

const templates = [
  { title: 'Farm Animals', entries: [['Horse', '🐎'], ['Pig', '🐖'], ['Goat', '🐐'], ['Chicken', '🐔'], ['Sheep', '🐑'], ['Cow', '🐄']] },
  { title: 'Rainbow', entries: [['Red', '🔴'], ['Orange', '🟠'], ['Yellow', '🟡'], ['Green', '🟢'], ['Blue', '🔵'], ['Purple', '🟣']] },
  { title: 'Shapes', entries: [['Circle', '🔴'], ['Triangle', '🔺'], ['Square', '🟦'], ['Rectangle', '▬'], ['Diamond', '🔶'], ['Heart', '❤️']] },
] as const;

/**
 * Create independent, editable copies for a newly provisioned account. The caller supplies unique
 * IDs; English words retain English pronunciation until board-language translations are added.
 * Pictures need no downloads, and normal device speech can play before AI audio is available.
 */
export function createStarterBoards(id: () => string, now = new Date().toISOString()): Board[] {
  return templates.map(template => ({
    id: id(), title: template.title, revision: 0, createdAt: now, updatedAt: now, playLanguages: ['en-US'],
    tiles: template.entries.map(([label, emoji], index) => ({
      id: id(), label, speech: label, language: 'en-US', languageMode: 'board',
      color: colors[index], illustration: { kind: 'emoji', emoji },
    })),
  }));
}
