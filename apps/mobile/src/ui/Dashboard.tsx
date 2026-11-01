/** @file Shows first-restore recovery or playable board previews with responsive creation actions. */

import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Plus, UserRound, Settings as SettingsIcon } from 'lucide-react-native';
import { boardWithProfileLanguages, type Board, type Library } from '@little-say/core';
import { BoardMenu } from './BoardMenu';
import { BoardCard } from './BoardCard';
import { type SpeechLibrary } from '../services/speechLibrary';
import { type AccountController } from '../services/useAccount';
import { Button, Notice } from './components';
import { styles, theme } from './theme';
import { MountainMark } from './Brand';
import { AppHeader } from './AppHeader';

const floatingInset = 24;
const floatingClearance = 16;

/**
 * Keep cached boards usable during sync; first restoration replaces creation and previews with progress/recovery.
 * Resolve profile languages for previews and audio actions, with recent boards before favorites.
 * Reserve the measured floating action height below the list; the app root owns native/web safe-area insets.
 */
export function Dashboard({ library, audio, sync, onOpen, onPlay, onSettings, onAccount, accountLabel, onCompose, onDelete, onFavorite, saving }: { library: Library; audio: SpeechLibrary; sync: Pick<AccountController, 'restoring' | 'syncing' | 'retrySync'> & { backup: Pick<AccountController['backup'], 'error' | 'state'> }; onOpen: (id: string) => void; onPlay: (board: Board) => void; onSettings: () => void; onAccount: () => void; accountLabel: string; onCompose: () => void; onDelete: (id: string) => void; onFavorite: (id: string) => void; saving: boolean }) {
  const syncError = sync.backup.error || (sync.backup.state === 'offline' ? 'Waiting for a connection. Your content will sync when you’re back online.' : '');
  const { width } = useWindowDimensions();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [creationHeight, setCreationHeight] = useState(50);
  const menuSource = library.boards.find(board => board.id === menuId);
  const menuBoard = menuSource && boardWithProfileLanguages(menuSource, library.settings);
  const wide = width > 620;
  const columns = width > 1050 ? 3 : wide ? 2 : 1;
  const createLabel = library.creationDraft || library.boardCreationDraft ? 'Resume draft' : 'New board';
  // Stable ties preserve the existing order for boards with no recorded creation or play.
  const boards = [...library.boards].sort((a, b) => (library.boardLastPlayedAt?.[b.id] ?? 0) - (library.boardLastPlayedAt?.[a.id] ?? 0));
  const recent = boards[0] && library.boardLastPlayedAt?.[boards[0].id] !== undefined ? boards[0] : undefined;
  const favorites = new Set(library.favoriteBoardIds);
  const remaining = boards.filter(board => board.id !== recent?.id).sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)));
  const card = (board: Board, featured = false) => <BoardCard board={boardWithProfileLanguages(board, library.settings)} featured={featured} favorite={favorites.has(board.id)} wide={wide} onPlay={() => onPlay(board)} onEdit={() => onOpen(board.id)} onMore={() => setMenuId(board.id)} onFavorite={() => onFavorite(board.id)} />;
  return <View style={styles.page}>
    <AppHeader actions={<>{saving && <ActivityIndicator size="small" accessibilityLabel="Saving changes" />}<Button kind="ghost" icon={UserRound} compact onPress={onAccount} accessibilityLabel={accountLabel} /><Button kind="secondary" icon={SettingsIcon} compact onPress={onSettings} accessibilityLabel="Settings" /></>} />
    <ScrollView testID="dashboard-scroll" style={{ flex: 1 }} contentContainerStyle={[styles.container, { paddingTop: 16, paddingBottom: wide ? creationHeight + floatingInset + floatingClearance : 32, gap: 16 }, sync.restoring && { flexGrow: 1, paddingTop: 32, paddingBottom: 32, justifyContent: 'center', alignItems: 'center' }]}>
      {sync.restoring ? <View testID="initial-sync-state" style={{ width: '100%', maxWidth: 520, alignItems: 'center', gap: 24 }}>
        {syncError ? <Notice action={<Button kind="secondary" onPress={() => void sync.retrySync()}>Retry sync</Button>}>{`Your content couldn’t sync. ${syncError}`}</Notice> : <>
          <View style={{ width: 80, height: 80, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color={theme.accent} accessibilityLabel="Syncing content" style={{ transform: [{ scale: 1.6 }] }} />
          </View>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.heading, { fontSize: width < 600 ? 28 : 32, textAlign: 'center' }]}>Syncing your content…</Text>
          <Text style={[styles.body, { maxWidth: 360, fontSize: 16, lineHeight: 24, textAlign: 'center' }]}>Your boards, photos and saved voices will appear here.</Text>
        </>}
      </View> : <>
      {!wide && <Button icon={Plus} onPress={onCompose}>{createLabel}</Button>}
      {sync.syncing && <View style={[styles.card, styles.row, { gap: 12 }]}>
        <ActivityIndicator color={theme.accent} accessibilityLabel="Syncing content" />
        <Text accessibilityLiveRegion="polite" style={[styles.body, { flex: 1 }]}>Syncing your content…</Text>
      </View>}
      <View style={{ gap: 28 }}>
        {recent && card(recent, true)}
        {remaining.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8, rowGap: 16 }}>
          {remaining.map(board => <View key={board.id} style={{ width: `${100 / columns}%`, paddingHorizontal: 8 }}>{card(board)}</View>)}
        </View>}
        {library.boards.length === 0 && <View style={[styles.card, { gap: 12, alignItems: 'center', paddingVertical: 28 }]}><MountainMark size={112} /><Text style={styles.title}>No boards yet</Text></View>}
      </View>
      </>}
    </ScrollView>
    {!sync.restoring && wide && <View pointerEvents="box-none" style={{ position: 'absolute', left: floatingInset, right: floatingInset, bottom: floatingInset, alignItems: 'flex-end' }}>
      <View onLayout={event => setCreationHeight(event.nativeEvent.layout.height)} style={{ maxWidth: '100%', borderRadius: 15, backgroundColor: theme.accent, boxShadow: '0 4px 16px rgba(32, 59, 53, 0.24)' }}>
        <Button icon={Plus} onPress={onCompose}>{createLabel}</Button>
      </View>
    </View>}
    {menuBoard && <BoardMenu key={menuBoard.id} board={menuBoard} settings={library.settings} audio={audio} onDelete={() => { onDelete(menuBoard.id); setMenuId(null); }} onClose={() => setMenuId(null)} />}
  </View>;
}
