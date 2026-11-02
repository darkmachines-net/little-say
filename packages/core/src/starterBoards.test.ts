/** @file Verifies starter content, independent editable copies, valid snapshots, and safe non-English playback fallback. */

import { expect, it } from 'vitest';
import { boardAssetKeys } from './account';
import { boardPlayTiles } from './boardLanguages';
import { newLibrary } from './onboarding';
import { createStarterBoards } from './starterBoards';
import { syncSnapshotSchema } from './schema';

let nextId = 0;
const id = () => `starter-${nextId++}`;

it('provides the three six-card boards without downloadable pictures', () => {
  const boards = createStarterBoards(id);
  expect(boards.map(board => [board.title, board.tiles.map(tile => tile.label)])).toEqual([
    ['Farm Animals', ['Horse', 'Pig', 'Goat', 'Chicken', 'Sheep', 'Cow']],
    ['Rainbow', ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple']],
    ['Shapes', ['Circle', 'Triangle', 'Square', 'Rectangle', 'Diamond', 'Heart']],
  ]);
  expect(syncSnapshotSchema.parse({ revision: 0, boards, assets: [] }).boards).toEqual(boards);
  expect(boardAssetKeys(boards).images.size).toBe(0);
  expect(new Set(boards.flatMap(board => [board.id, ...board.tiles.map(tile => tile.id)])).size).toBe(21);
});

it('keeps accounts independent and English words correctly pronounced under another device language', () => {
  const first = createStarterBoards(id), second = createStarterBoards(id);
  first[0].title = 'My animals'; first[0].tiles[0].label = 'Pony';
  expect(second[0].title).toBe('Farm Animals'); expect(second[0].tiles[0].label).toBe('Horse');
  expect(second.every(board => !first.some(other => other.id === board.id))).toBe(true);
  const tiles = boardPlayTiles(second[0], newLibrary('fr-FR').settings);
  expect(tiles.every(tile => tile.language === 'en-US' && tile.languageMode === 'board')).toBe(true);
});
