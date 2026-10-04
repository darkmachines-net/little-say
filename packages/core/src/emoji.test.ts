/** @file Verifies searchable Unicode coverage, keyword matching, and common emoji ordering. */

import { describe, expect, it } from 'vitest';
import { emojiCatalog, searchEmoji } from './emoji';
import { illustrationSchema } from './schema';

describe('offline emoji search', () => {
  it('finds blueberries by singular, plural, Russian, and pasted emoji', () => {
    for (const query of ['blueberry', 'blueberries', ' BLUEBERRY ', 'голубика', 'черника', '🫐']) {
      expect(searchEmoji(query)[0]?.emoji, query).toBe('🫐');
    }
  });

  it('includes previously omitted emoji across categories and combined sequences', () => {
    for (const [query, emoji] of [['peach', '🍑'], ['kiwi', '🥝'], ['otter', '🦦'], ['turtle', '🐢'], ['👨‍👩‍👧‍👦', '👨‍👩‍👧‍👦'], ['👋🏽', '👋🏽']]) {
      expect(searchEmoji(query).map(result => result.emoji), query).toContain(emoji);
    }
    expect(searchEmoji('👋🏽')[0]?.emoji).toBe('👋🏽');
    expect(searchEmoji('❤')[0]?.emoji).toBe('❤️');
  });

  it('keeps familiar common choices and child-friendly aliases', () => {
    expect(searchEmoji('')[0]?.emoji).toBe('🐄');
    expect(searchEmoji('potty').map(result => result.emoji)).toContain('🚽');
    expect(searchEmoji('grandma').map(result => result.emoji)).toContain('👵');
  });

  it('matches multiple search words and handles no matches', () => {
    expect(searchEmoji('blue berry').map(result => result.emoji)).toContain('🫐');
    expect(searchEmoji('no-such-emoji-xyz')).toEqual([]);
  });

  it('bundles a complete, unique catalog that can be saved on cards', () => {
    expect(emojiCatalog.length).toBeGreaterThan(3900);
    expect(new Set(emojiCatalog.map(entry => entry.emoji)).size).toBe(emojiCatalog.length);
    for (const { emoji, label } of emojiCatalog) {
      expect(label.length).toBeGreaterThan(0);
      expect(illustrationSchema.safeParse({ kind: 'emoji', emoji }).success, label).toBe(true);
    }
  });
});
