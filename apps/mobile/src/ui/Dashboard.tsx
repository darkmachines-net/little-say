/** @file Organizes saved boards by recent use and favorites and exposes creation and settings. */

import { useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Plus, Settings as SettingsIcon } from 'lucide-react-native';
import { type Board, type Library } from '@little-say/core';
import { BoardMenu } from './BoardMenu';
import { BoardCard } from './BoardCard';
import { type SpeechLibrary } from '../services/speechLibrary';
import { Button } from './components';
import { theme, styles } from './theme';
import { Brand, MountainMark } from './Brand';

/**
 * Spotlight the most recently played board, place favorites next, and present library actions and the
 * AI creation workspace, with a separate manual creation entry.
 */
export function Dashboard({ library, audio, onOpen, onPlay, onSettings, onCompose, onManual, onConsent, onDelete, onFavorite, saving }: { library: Library; audio: SpeechLibrary; onOpen: (id: string) => void; onPlay: (board: Board) => void; onSettings: () => void; onCompose: () => void; onManual: () => void; onConsent: () => Promise<void>; onDelete: (id: string) => void; onFavorite: (id: string) => void; saving: boolean }) {
  const { width } = useWindowDimensions();
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuBoard = library.boards.find(board => board.id === menuId);
  const columns = width > 1050 ? 3 : width > 620 ? 2 : 1;
  // Stable ties preserve the existing order for boards with no play history.
  const boards = [...library.boards].sort((a, b) => (library.boardLastPlayedAt?.[b.id] ?? 0) - (library.boardLastPlayedAt?.[a.id] ?? 0));
  const recent = boards[0] && library.boardLastPlayedAt?.[boards[0].id] !== undefined ? boards[0] : undefined;
  const favorites = new Set(library.favoriteBoardIds);
  const remaining = boards.filter(board => board.id !== recent?.id).sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)));
  const card = (board: Board, featured = false) => <BoardCard board={board} featured={featured} favorite={favorites.has(board.id)} wide={width > 620} onPlay={() => onPlay(board)} onEdit={() => onOpen(board.id)} onMore={() => setMenuId(board.id)} onFavorite={() => onFavorite(board.id)} />;
  return <View style={styles.page}>
    <View style={{ backgroundColor: theme.surface, borderBottomWidth: 1, borderColor: theme.line }}>
      <View style={[styles.container, { minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }]}>
        <Brand />
        <View style={styles.row}>{saving && <Text style={styles.small}>Saving…</Text>}<Button kind="secondary" icon={SettingsIcon} compact onPress={onSettings} accessibilityLabel="Settings" /></View>
      </View>
    </View>
    <ScrollView contentContainerStyle={[styles.container, { paddingTop: 24, paddingBottom: 32, gap: 20 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <Text accessibilityRole="header" style={styles.heading}>Your soundboards</Text>
        <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}><Button icon={Plus} onPress={onCompose}>New board</Button><Button kind="ghost" compact onPress={onManual}>Build manually</Button></View>
      </View>
      {recent && card(recent, true)}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8 }}>
        {remaining.map(board => <View key={board.id} style={{ width: `${100 / columns}%`, padding: 8 }}>{card(board)}</View>)}
      </View>
      {library.boards.length === 0 && <View style={[styles.card, { gap: 12, alignItems: 'center', paddingVertical: 28 }]}><MountainMark size={112} /><Text style={styles.title}>No boards yet</Text><Button icon={Plus} onPress={onCompose}>Create your first board</Button></View>}
    </ScrollView>
    {menuBoard && <BoardMenu key={menuBoard.id} board={menuBoard} settings={library.settings} audio={audio} onConsent={onConsent} onDelete={() => { onDelete(menuBoard.id); setMenuId(null); }} onClose={() => setMenuId(null)} />}
  </View>;
}
