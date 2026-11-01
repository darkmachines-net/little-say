/** @file Renders compact, playable library previews with grouped edit, favorite, and overflow actions. */

import { Platform, Pressable, Text, View } from 'react-native';
import { Ellipsis, Heart, Pencil, Play } from 'lucide-react-native';
import { type Board } from '@little-say/core';
import { Button } from './components';
import { TileFace } from './TileFace';
import { palettes, styles, theme } from './theme';

/**
 * Start play from the preview and keep management actions together beside the title. Featured boards
 * retain a larger preview, with the title and actions alongside it on wide screens.
 */
export function BoardCard({ board, featured = false, favorite = false, wide = false, onPlay, onEdit, onMore, onFavorite }: {
  board: Board; featured?: boolean; favorite?: boolean; wide?: boolean; onPlay: () => void; onEdit: () => void; onMore: () => void; onFavorite: () => void;
}) {
  const horizontal = featured && wide;
  return <View testID="library-board" style={{ flex: 1 }}>
    <View testID={featured ? 'recent-board' : undefined} style={{ flex: 1, flexDirection: horizontal ? 'row' : 'column', backgroundColor: featured ? theme.accentSoft : theme.surface, borderRadius: featured ? 28 : 24, padding: featured ? 16 : 12, gap: horizontal ? 20 : 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Play ${board.title}`} onPress={onPlay} style={({ pressed }) => ({ width: horizontal ? '56%' : '100%', minHeight: 94, borderRadius: featured && wide ? 24 : 14, opacity: pressed ? 0.7 : 1 })}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -3 }}>
          {board.tiles.slice(0, 6).map(tile => <View key={tile.id} style={{ width: '33.3333%', height: featured ? (wide ? 132 : 116) : 94, padding: 3 }}><TileFace tile={tile} compact={!featured || !wide} size={featured ? 46 : 37} /></View>)}
        </View>
        <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: theme.accent, borderWidth: 3, borderColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}><Play size={24} color="white" fill="white" style={{ marginLeft: 3 }} /></View>
        </View>
      </Pressable>
      <View style={{ flex: 1, flexDirection: horizontal ? 'column' : 'row', gap: horizontal ? 16 : 8, alignItems: horizontal ? 'flex-start' : 'center', justifyContent: 'center', minWidth: 0 }}>
        <Text testID="board-card-title" style={{ flex: horizontal ? undefined : 1, minWidth: 0, paddingHorizontal: 4, fontSize: horizontal ? 30 : 20, fontWeight: '800', color: theme.ink, letterSpacing: featured ? -0.5 : 0 }} numberOfLines={horizontal ? 3 : 2}>{board.title}</Text>
        <View style={[styles.row, { gap: 4, flexShrink: 0 }]}>
          <Button kind="ghost" compact icon={Pencil} accessibilityLabel={`Edit ${board.title}`} onPress={onEdit} />
          <Pressable accessibilityRole="button" accessibilityLabel={favorite ? `Remove ${board.title} from favorites` : `Add ${board.title} to favorites`} accessibilityState={{ selected: favorite }} {...(Platform.OS === 'web' ? { 'aria-pressed': favorite } : {})} onPress={onFavorite} style={({ pressed }) => ({ width: 44, height: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: favorite ? palettes.rose.background : 'transparent', opacity: pressed ? 0.7 : 1 })}>
            <Heart size={23} color={favorite ? theme.red : theme.muted} fill={favorite ? theme.red : 'none'} strokeWidth={2} />
          </Pressable>
          <Button kind="ghost" compact icon={Ellipsis} accessibilityLabel={`More options for ${board.title}`} onPress={onMore} />
        </View>
      </View>
    </View>
  </View>;
}
