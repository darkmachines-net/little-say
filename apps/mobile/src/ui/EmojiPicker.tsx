/** @file Provides searchable Unicode emoji selection with a compact set of suggested visuals. */

import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { searchEmoji } from '@little-say/core';
import { Button, Field } from './components';
import { styles, theme } from './theme';

const PAGE_SIZE = 64;
/** Show searchable emoji choices and report the chosen glyph without changing the tile directly. */
export function EmojiPicker({ selected, onSelect }: { selected?: string; onSelect: (emoji: string) => void }) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const results = useMemo(() => searchEmoji(query), [query]);
  return <View style={{ gap: 12 }}>
    <Field label="Search emoji" value={query} onChangeText={text => { setQuery(text); setLimit(PAGE_SIZE); }} placeholder="Search by name or paste an emoji" maxLength={100} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" />
    <Text accessibilityLiveRegion="polite" style={styles.small}>{results.length ? `${Math.min(limit, results.length)} of ${results.length} emoji` : 'No matching emoji. Try another word or paste an emoji.'}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {results.slice(0, limit).map(({ emoji, label }) => <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`Use ${label} emoji`} accessibilityState={{ selected: selected === emoji }} onPress={() => onSelect(emoji)} style={({ pressed }) => ({ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: selected === emoji ? theme.accentSoft : theme.surface, borderWidth: 1, borderColor: selected === emoji ? theme.accent : theme.line, opacity: pressed ? 0.65 : 1 })}>
        <Text accessible={false} style={{ fontSize: 28 }}>{emoji}</Text>
      </Pressable>)}
    </View>
    {limit < results.length && <Button kind="secondary" onPress={() => setLimit(value => value + PAGE_SIZE)}>Show more emoji</Button>}
  </View>;
}
