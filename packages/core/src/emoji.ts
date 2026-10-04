/** @file Searches the generated Unicode emoji catalog by glyph, name, and keywords. */

import data from './data/emoji-catalog.json';
import { commonEmojiKeywords } from './emoji-favorites';

export interface EmojiEntry { emoji: string; label: string; }
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\uFE0F/g, '').replace(/ё/g, 'е').replace(/[-_\s]+/g, ' ').trim();
function createIndex() {
  const common = new Map(commonEmojiKeywords.map(([emoji, keywords], index) => [emoji, { keywords, index }]));
  return data.emoji.map(([emoji, label, keywords], index) => ({
    emoji, label, normalizedEmoji: normalize(emoji), name: normalize(label), search: normalize(`${emoji} ${keywords} ${common.get(emoji)?.keywords ?? ''}`),
    order: common.get(emoji)?.index ?? common.size + index,
  })).sort((a, b) => a.order - b.order);
}
// Permit server builds to omit this client-only catalog when tree-shaking core exports.
const indexed = /* @__PURE__ */ createIndex();
export const emojiCatalog: readonly EmojiEntry[] = /* @__PURE__ */ indexed.map(({ emoji, label }) => ({ emoji, label }));

/** Search bundled names and keywords, including Russian and pasted emoji.
 * The UI pages these results; filtering must still include the entire catalog. */
export function searchEmoji(query: string): readonly EmojiEntry[] {
  const normalized = normalize(query);
  if (!normalized) return emojiCatalog;
  const words = normalized.split(' ');
  const score = (entry: typeof indexed[number]) => entry.normalizedEmoji === normalized ? 0 : entry.name === normalized ? 1 : entry.name.startsWith(normalized) ? 2 : 3;
  return indexed.filter(entry => words.every(word => entry.search.includes(word)))
    .sort((a, b) => score(a) - score(b) || a.order - b.order)
    .map(({ emoji, label }) => ({ emoji, label }));
}
