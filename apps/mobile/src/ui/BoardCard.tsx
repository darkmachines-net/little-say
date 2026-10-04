import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Ellipsis, Heart, Pencil, Play } from 'lucide-react-native';
import { languageName, type Board } from '@little-say/core';
import { Button } from './components';
import { TileFace } from './TileFace';
import { palettes, styles, theme } from './theme';

export function BoardCard({ board, featured = false, favorite = false, wide = false, onPlay, onEdit, onMore, onFavorite }: {
  board: Board; featured?: boolean; favorite?: boolean; wide?: boolean; onPlay: () => void; onEdit: () => void; onMore: () => void; onFavorite: () => void;
}) {
  const languages = Array.from(new Set([...(board.playLanguages ?? []), ...board.tiles.filter(t => t.languageMode !== 'board' || !board.playLanguages?.length).map(t => t.language)].map(languageName))).join(', ');
  const horizontal = featured && wide;
  return <View testID="library-board" style={{ flex: 1 }}>
    <View testID={featured ? 'recent-board' : undefined} style={{ flex: 1, flexDirection: horizontal ? 'row' : 'column', backgroundColor: featured ? theme.accentSoft : theme.surface, borderRadius: featured ? 28 : 24, padding: featured ? 20 : 12, gap: featured ? 24 : 14 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${featured ? 'Resume' : 'Edit'} ${board.title}`} onPress={featured ? onPlay : onEdit} style={({ pressed }) => ({ width: horizontal ? '56%' : '100%', opacity: pressed ? 0.7 : 1 })}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -3 }}>
          {board.tiles.slice(0, 6).map(tile => <View key={tile.id} style={{ width: '33.3333%', height: featured ? (wide ? 132 : 116) : 94, padding: 3 }}><TileFace tile={tile} compact={!featured || !wide} size={featured ? 46 : 37} /></View>)}
        </View>
      </Pressable>
      <View style={{ flex: 1, gap: featured ? 24 : 14, justifyContent: 'center', minWidth: 0 }}>
        <View style={[styles.row, { alignItems: 'flex-start' }]}>
          <View style={{ flex: 1, paddingHorizontal: 4, gap: 6 }}><Text testID="board-card-title" style={{ fontSize: featured ? 30 : 20, fontWeight: '800', color: theme.ink, letterSpacing: featured ? -0.5 : 0 }} numberOfLines={featured ? 3 : 1}>{board.title}</Text><Text style={styles.small} numberOfLines={featured ? 2 : 1}>{board.tiles.length} tiles · {languages}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={favorite ? `Remove ${board.title} from favorites` : `Add ${board.title} to favorites`} accessibilityState={{ selected: favorite }} {...(Platform.OS === 'web' ? { 'aria-pressed': favorite } : {})} onPress={onFavorite} hitSlop={4} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: favorite ? palettes.rose.background : 'transparent', opacity: pressed ? 0.7 : 1 })}>
            <Heart size={23} color={favorite ? theme.red : theme.muted} fill={favorite ? theme.red : 'none'} strokeWidth={2} />
          </Pressable>
        </View>
        <View style={[styles.row, { flexWrap: featured ? 'wrap' : 'nowrap' }]}>
          <View style={{ flex: 1, minWidth: featured ? 145 : 0 }}><Button icon={Play} onPress={onPlay} accessibilityLabel={`Play ${board.title}`}>{featured ? 'Play again' : 'Play'}</Button></View>
          <Button kind="secondary" compact icon={Pencil} accessibilityLabel={`Edit ${board.title}${featured ? '' : ' details'}`} onPress={onEdit} />
          <Button kind="ghost" compact icon={Ellipsis} accessibilityLabel={`More options for ${board.title}`} onPress={onMore} />
        </View>
      </View>
    </View>
  </View>;
}
