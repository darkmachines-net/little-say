/** @file Renders library cards with adaptive title/actions above unobstructed previews and a full-width Play button. */

import { Platform, Pressable, Text, View } from 'react-native';
import { Ellipsis, Heart, Pencil, Play } from 'lucide-react-native';
import { type Board } from '@little-say/core';
import { Button } from './components';
import { TileFace } from './TileFace';
import { palettes, styles, theme } from './theme';

/**
 * Keep short titles beside the management actions on native and web; wrap the intact action group
 * below longer titles so they can use the full card width. Play sits below the preview, and featured
 * boards retain their larger tiles and heading on wide screens.
 */
export function BoardCard({ board, featured = false, favorite = false, wide = false, onPlay, onEdit, onMore, onFavorite }: {
  board: Board; featured?: boolean; favorite?: boolean; wide?: boolean; onPlay: () => void; onEdit: () => void; onMore: () => void; onFavorite: () => void;
}) {
  return <View testID="library-board" style={{ flex: 1 }}>
    <View testID={featured ? 'recent-board' : undefined} style={{ flex: 1, backgroundColor: featured ? theme.accentSoft : theme.surface, borderRadius: featured ? 28 : 24, padding: featured ? 16 : 12, gap: 10 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 4, alignItems: 'center' }}>
        {/* An automatic basis preserves the title's natural width before the action group wraps. */}
        <Text testID="board-card-title" style={{ flexBasis: 'auto', flexGrow: 1, flexShrink: 1, maxWidth: '100%', paddingHorizontal: 4, fontSize: featured && wide ? 30 : 20, fontWeight: '800', color: theme.ink, letterSpacing: featured ? -0.5 : 0 }}>{board.title}</Text>
        <View style={[styles.row, { gap: 4, flexShrink: 0, marginLeft: 'auto' }]}>
          <Button kind="ghost" compact icon={Pencil} accessibilityLabel={`Edit ${board.title}`} onPress={onEdit} />
          <Pressable accessibilityRole="button" accessibilityLabel={favorite ? `Remove ${board.title} from favorites` : `Add ${board.title} to favorites`} accessibilityState={{ selected: favorite }} {...(Platform.OS === 'web' ? { 'aria-pressed': favorite } : {})} onPress={onFavorite} style={({ pressed }) => ({ width: 44, height: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: favorite ? palettes.rose.background : 'transparent', opacity: pressed ? 0.7 : 1 })}>
            <Heart size={23} color={favorite ? theme.red : theme.muted} fill={favorite ? theme.red : 'none'} strokeWidth={2} />
          </Pressable>
          <Button kind="ghost" compact icon={Ellipsis} accessibilityLabel={`More options for ${board.title}`} onPress={onMore} />
        </View>
      </View>
      <View testID="board-card-preview" accessible accessibilityRole="image" accessibilityLabel={`Preview of ${board.title}`} style={{ minHeight: 94 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -3 }}>
          {board.tiles.slice(0, 6).map(tile => <View key={tile.id} style={{ width: '33.3333%', height: featured ? (wide ? 132 : 116) : 94, padding: 3 }}><TileFace tile={tile} compact={!featured || !wide} size={featured ? 46 : 37} /></View>)}
        </View>
      </View>
      <View style={{ marginTop: 'auto' }}><Button icon={Play} accessibilityLabel={`Play ${board.title}`} onPress={onPlay}>Play</Button></View>
    </View>
  </View>;
}
