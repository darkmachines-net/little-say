/**
 * @file Coordinates library persistence, board navigation, playback previews, and parent editing
 * actions, effective shared languages, and background translations within one board workspace.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Text, View } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { mergeBoardSuggestion, draftBoardSchema, speechSource, boardPlayTiles, boardWithProfileLanguages, languageName, profileLanguages, reviseBoard, type Board, type BoardSuggestion, type Settings, type Tile } from '@little-say/core';
import { useLibrary } from './data/useLibrary';
import { getVoices, matchingVoice, speechQueue, type Voice } from './services/speech';
import { useSpeechLibrary } from './services/useSpeechLibrary';
import { useBoardTranslations } from './services/useBoardTranslations';
import { initializeUpdates, applyUpdate } from './services/updates';
import { Dashboard } from './ui/Dashboard';
import { useBoardDraftRoute } from './services/useBoardDraftRoute';
import { BoardEditor } from './ui/BoardEditor';
import type { BoardSnapshot } from './ui/BoardTransition';
import { PlayBoard } from './ui/PlayBoard';
import { SettingsScreen } from './ui/SettingsScreen';
import { useSettingsRoute } from './services/useSettingsRoute';
import { FirstTimeSetup } from './ui/FirstTimeSetup';
import { Button, Notice, Sheet } from './ui/components';
import { theme, styles } from './ui/theme';
import { Brand } from './ui/Brand';
import { defaultPicturePolicy } from '@little-say/core';
import { useAccount } from './services/useAccount';
import { AccountScreen } from './ui/AccountScreen';

function Application() {
  const store = useLibrary();
  const draftRoute = useBoardDraftRoute();
  const audio = useSpeechLibrary(store.library);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { setSelectedId(draftRoute.route?.boardId ?? null); }, [draftRoute.route?.boardId]);
  useEffect(() => {
    if (!store.library || !draftRoute.route || draftRoute.route.boardId || store.library.creationDraft) return;
    const now = new Date().toISOString();
    void store.change(current => current.creationDraft ? current : { ...current, creationDraft: {
      board: { id: Crypto.randomUUID(), title: 'New board', revision: 0, createdAt: now, updatedAt: now, tiles: [], playLanguages: profileLanguages(current.settings), picturePolicy: current.settings.pictureDefaults ?? defaultPicturePolicy },
      prompt: '', suggestion: null,
    } }).catch(() => {});
  }, [draftRoute.route, store]);
  const settingsRoute = useSettingsRoute();
  const [accountOpen, setAccountOpen] = useState(false);
  const [entryChecked, setEntryChecked] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [error, setError] = useState('');
  const [soundCheck, setSoundCheck] = useState<Board | null>(null);
  const [startingPlay, setStartingPlay] = useState(false);
  const playRequest = useRef(false);
  const [returnBoardId, setReturnBoardId] = useState<string | null>(null);
  const [transition, setTransition] = useState<BoardSnapshot | null>(null);
  const finishTransition = useCallback(() => setTransition(null), []);
  const [updateReady, setUpdateReady] = useState(false);
  const [undo, setUndo] = useState<Record<string, Board[]>>({});
  const account = useAccount(store, !draftRoute.route && !selectedId && !store.library?.settings.activeBoardId, () => audio.reload());
  useEffect(() => {
    if (entryChecked || !store.library || !account.ready) return;
    setEntryChecked(true);
    if (!account.session && !store.library.settings.accountChoiceMade && !store.library.settings.activeBoardId && !draftRoute.route && !settingsRoute.route) setAccountOpen(true);
  }, [entryChecked, store.library, account.ready, account.session, draftRoute.route, settingsRoute.route]);
  const previewSettings = store.library?.settings;
  const previewQueue = useMemo(() => speechQueue(voices, previewSettings?.voices ?? {}, () => {}, () => setError('This audio could not play. Check your device’s volume and voice settings.'), audio.asset, tag => previewSettings ? speechSource(previewSettings, tag) : 'ai'), [voices, previewSettings, audio]);
  useEffect(() => () => previewQueue.stop(), [previewQueue]);
  const consent = () => store.change(current => ({ ...current, settings: { ...current.settings, aiConsent: true } }));
  useEffect(() => {
    let active = true;
    const refresh = () => { void getVoices().then(list => { if (active) setVoices(old => JSON.stringify(old) === JSON.stringify(list) ? old : list); }).catch(() => {}); };
    refresh();
    const timer = setTimeout(refresh, 1000);
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    if (Platform.OS === 'web') window.speechSynthesis?.addEventListener('voiceschanged', refresh);
    let cleanup: (() => void) | undefined;
    void initializeUpdates(() => setUpdateReady(true)).then(fn => { if (active) cleanup = fn; else fn(); }).catch(() => {});
    return () => { active = false; clearTimeout(timer); foreground.remove(); cleanup?.(); if (Platform.OS === 'web') window.speechSynthesis?.removeEventListener('voiceschanged', refresh); };
  }, []);
  const remember = (board: Board) => setUndo(current => ({ ...current, [board.id]: [...(current[board.id] ?? []).slice(-19), board] }));
  const translations = useBoardTranslations(store, remember);
  const setSettings = (patch: Partial<Settings>) => settingsRoute.save(() => store.commit(current => ({ ...current, settings: { ...current.settings, ...patch, activeBoardId: current.settings.activeBoardId, accountChoiceMade: current.settings.accountChoiceMade } })));
  const deleteBoard = (id: string) => {
    previewQueue.stop();
    void store.change(current => {
      const boardLanguages = { ...current.settings.boardLanguages }; delete boardLanguages[id];
      const boardLastPlayedAt = { ...current.boardLastPlayedAt }; delete boardLastPlayedAt[id];
      return { ...current, creationDraft: current.creationDraft?.board.id === id ? undefined : current.creationDraft, boards: current.boards.filter(board => board.id !== id), boardLastPlayedAt, favoriteBoardIds: current.favoriteBoardIds?.filter(boardId => boardId !== id), settings: { ...current.settings, boardLanguages, activeBoardId: current.settings.activeBoardId === id ? null : current.settings.activeBoardId } };
    }).catch(() => {});
    draftRoute.close(); setSelectedId(current => current === id ? null : current);
    setUndo(current => { const next = { ...current }; delete next[id]; return next; });
  };
  const play = async (board: Board) => {
    if (playRequest.current) return;
    playRequest.current = true; setStartingPlay(true); previewQueue.stop(); setTransition(null);
    if (Platform.OS === 'web' && document.documentElement.requestFullscreen && !document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {});
    try {
      // Keep the editor and its in-memory edits visible until every required write succeeds.
      await store.flush();
      await store.commit(current => {
        if (!current.boards.some(candidate => candidate.id === board.id)) throw new Error('This board is no longer available.');
        return { ...current, boardLastPlayedAt: { ...current.boardLastPlayedAt, [board.id]: Date.now() }, settings: { ...current.settings, activeBoardId: board.id } };
      });
      setSoundCheck(null); setError('');
    } finally { playRequest.current = false; setStartingPlay(false); }
  };
  const preparePlay = (board: Board) => {
    const current = store.current.current!;
    const latest = current.boards.find(candidate => candidate.id === board.id);
    if (!latest || playRequest.current) return;
    previewQueue.stop();
    if (boardPlayTiles(latest, current.settings).some(tile => (speechSource(current.settings, tile.language) === 'device' || !audio.asset(tile)) && !matchingVoice(tile, voices, current.settings.voices))) setSoundCheck(latest);
    else void play(latest).catch(() => setError('The play session could not be saved. Your edits are still here. Retry saving, then try again.'));
  };
  const preview = (tile: Tile) => { previewQueue.stop(); previewQueue.enqueue(tile); };
  if (store.loadError) return <View style={[styles.page, { justifyContent: 'center', padding: 30, gap: 20 }]}><Notice>{store.loadError}</Notice><Button onPress={() => void store.reload()}>Try opening again</Button></View>;
  if (!store.library || !entryChecked) return <View style={[styles.page, { justifyContent: 'center', alignItems: 'center', gap: 24 }]}><Brand stacked /><View style={styles.row}><ActivityIndicator color={theme.accent} /><Text style={styles.body}>Loading boards…</Text></View></View>;
  const library = store.library;
  const accountScreen = accountOpen && <AccountScreen account={account} onClose={async () => {
    if (!store.current.current!.settings.accountChoiceMade) await store.commit(current => ({ ...current, settings: { ...current.settings, accountChoiceMade: true } }));
    setAccountOpen(false);
  }} />;
  if (settingsRoute.route && !library.settings.activeBoardId) return <SettingsScreen route={settingsRoute.route} library={library} account={account} returnLabel={selectedId ? 'Back to board' : 'Boards'} onNavigate={settingsRoute.open} onBack={settingsRoute.back} onSave={setSettings} onBeforeRestart={store.flush} />;
  if (library.setup) return <><FirstTimeSetup library={library} onCommit={store.commitSetup} onAccount={() => setAccountOpen(true)} />{accountScreen}</>;
  const boards = library.boards.map(board => boardWithProfileLanguages(board, library.settings));
  const activeBoard = boards.find(board => board.id === library.settings.activeBoardId);
  const selected = boards.find(board => board.id === (draftRoute.route?.boardId ?? selectedId)) ?? (draftRoute.route && !draftRoute.route.boardId && library.creationDraft ? boardWithProfileLanguages(library.creationDraft.board, library.settings) : undefined);
  if (activeBoard) return <PlayBoard board={activeBoard} settings={library.settings} voices={voices} audioAsset={audio.asset} onLanguageChange={language => store.change(current => ({ ...current, settings: { ...current.settings, boardLanguages: { ...current.settings.boardLanguages, [activeBoard.id]: language } } }))} onEdit={snapshot => {
    if (draftRoute.route?.boardId !== activeBoard.id) draftRoute.open(activeBoard.id); setSelectedId(activeBoard.id); setReturnBoardId(activeBoard.id); setTransition(snapshot);
    void store.change(current => ({ ...current, boardLastPlayedAt: { ...current.boardLastPlayedAt, [activeBoard.id]: Date.now() }, settings: { ...current.settings, activeBoardId: null } })).catch(() => {});
  }} />;
  const accept = async (suggestion: BoardSuggestion, choice?: 'current' | 'suggested') => {
    let original!: Board;
    await draftRoute.save(() => store.commit(lib => {
      const current = lib.boards.find(b => b.id === suggestion.base.id) ?? (lib.creationDraft?.board.id === suggestion.base.id ? lib.creationDraft.board : undefined);
      if (!current) throw new Error('The original board was deleted.');
      const merged = mergeBoardSuggestion(suggestion.base, suggestion.board, current, choice);
      if (merged.conflicts.length && !choice) throw new Error('Newer edits need review. Choose which changes to keep.');
      original = current;
      const exists = lib.boards.some(b => b.id === current.id);
      return { ...lib, creationDraft: lib.creationDraft?.board.id === current.id ? undefined : lib.creationDraft, boards: exists ? lib.boards.map(b => b.id === current.id ? merged.board : b) : [...lib.boards, merged.board] };
    }));
    remember(original); setSelectedId(original.id); draftRoute.replace(original.id);
  };
  if (draftRoute.route?.boardId && !selected) return <View style={[styles.page, { padding: 24, gap: 16 }]}><Notice>This board is no longer available.</Notice><Button onPress={draftRoute.close}>Back to boards</Button></View>;
  return <><View style={styles.page}>
    <StatusBar style="dark" />
    {!selected && account.session && <View style={{ paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><Text style={styles.small}>{account.error ? 'Backup needs attention' : account.busy ? 'Syncing account backup…' : account.savedAt ? 'Account backup enabled' : 'Account backup pending'}</Text><Button compact kind="ghost" onPress={() => settingsRoute.open({ page: 'account' })}>Account & backup</Button></View>}
    {Boolean(store.error) && <View style={{ padding: 10 }}><Notice action={<Button kind="secondary" onPress={() => void store.retry().catch(() => {})}>Retry saving</Button>}>{store.error}</Notice></View>}
    {updateReady && <View style={{ padding: 10 }}><Notice action={<Button kind="secondary" onPress={() => { void store.flush().then(applyUpdate).catch(() => setError('Save your changes before updating.')); }}>Update now</Button>}>A new version is ready. Your locally saved boards will stay here.</Notice></View>}
    {Boolean(error) && <View style={{ padding: 10 }}><Notice action={<Button kind="ghost" onPress={() => setError('')}>Dismiss</Button>}>{error}</Notice></View>}
    {selected ? <BoardEditor key={selected.id} board={selected} settings={library.settings} audio={audio} translationStatus={translations.status[selected.id]} onPrepareTranslations={() => void translations.prepare(selected.id)} onCancelTranslations={() => translations.cancel(selected.id)} onManageLanguages={() => settingsRoute.open({ page: 'languages' })} draft={library.creationDraft?.board.id === selected.id ? library.creationDraft : undefined} onAccept={accept} onDraft={state => {
      const current = store.current.current?.creationDraft;
      if (!current || current.board.id !== selected.id || JSON.stringify({ prompt: current.prompt, suggestion: current.suggestion }) === JSON.stringify(state)) return;
      void store.change(lib => lib.creationDraft?.board.id === selected.id ? { ...lib, creationDraft: { ...lib.creationDraft, ...state } } : lib).catch(() => {});
    }} onStopPreview={() => previewQueue.stop()} saving={store.saving} saveError={store.error} startingPlay={startingPlay} returnToPlay={returnBoardId === selected.id} transition={transition} onTransitionDone={finishTransition} onBack={() => { if (playRequest.current) return; void store.flush().then(() => { previewQueue.stop(); setTransition(null); setReturnBoardId(null); setSelectedId(null); draftRoute.close(); if (Platform.OS === 'web' && document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }).catch(() => setError('Your changes could not be saved. Retry saving before leaving.')); }} onPlay={() => preparePlay(selected)} onChange={(changes, expectedRevision) => {
      const current = store.current.current!.boards.find(b => b.id === selected.id) ?? store.current.current!.creationDraft!.board;
      if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error('This board changed while editing. Your saved changes are kept; reopen the current card or prepare translations again.');
      remember(current);
      const next = (changes.tiles ?? current.tiles).length ? reviseBoard(current, changes) : draftBoardSchema.parse({ ...current, ...changes, revision: current.revision + 1, updatedAt: new Date().toISOString() });
      void store.change(lib => next.tiles.length ? { ...lib, creationDraft: lib.creationDraft?.board.id === next.id ? undefined : lib.creationDraft, boards: lib.boards.some(b => b.id === next.id) ? lib.boards.map(b => b.id === next.id ? next : b) : [...lib.boards, next] } : { ...lib, creationDraft: { board: next, prompt: lib.creationDraft?.prompt ?? '', suggestion: null } }).catch(() => {});
      if (next.tiles.length && !draftRoute.route?.boardId) { setSelectedId(next.id); draftRoute.replace(next.id); }
      return next;
    }} onDelete={() => deleteBoard(selected.id)} onDuplicate={() => {
      if (!selected.tiles.length) return;
      const copy = { ...selected, id: Crypto.randomUUID(), title: `${selected.title.slice(0, 90)} (copy)`, revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tiles: selected.tiles.map(t => ({ ...t, id: Crypto.randomUUID() })) };
      void store.change(lib => ({ ...lib, boards: [...lib.boards, copy] })).catch(() => {}); setSelectedId(copy.id); draftRoute.open(copy.id);
    }} onConsent={consent} onPreview={preview} canUndo={Boolean(undo[selected.id]?.length)} onUndo={() => {
      const history = undo[selected.id] ?? []; const previous = history.at(-1); if (!previous) return;
      const current = store.current.current!.boards.find(b => b.id === selected.id) ?? store.current.current!.creationDraft!.board;
      const restored = { ...previous, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      void store.change(lib => restored.tiles.length ? { ...lib, boards: lib.boards.map(b => b.id === selected.id ? restored : b) } : { ...lib, boards: lib.boards.filter(b => b.id !== selected.id), creationDraft: { board: restored, prompt: '', suggestion: null } }).catch(() => {});
      if (!restored.tiles.length) draftRoute.replace(null);
      setUndo(old => ({ ...old, [selected.id]: history.slice(0, -1) }));
    }} /> : <Dashboard library={library} audio={audio} saving={store.saving} onOpen={id => { setSelectedId(id); draftRoute.open(id); }} onPlay={preparePlay} onSettings={() => settingsRoute.open()} onCompose={() => draftRoute.open()} onDelete={deleteBoard} onFavorite={id => {
      void store.change(current => {
        const favorites = new Set(current.favoriteBoardIds);
        if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
        return { ...current, favoriteBoardIds: [...favorites] };
      }).catch(() => {});
    }} />}

    {soundCheck && <Sheet title="A quick sound check" onClose={() => setSoundCheck(null)}><Notice>Some tiles have neither saved audio nor a matching device voice for {Array.from(new Set(boardPlayTiles(soundCheck, library.settings).filter(t => (speechSource(library.settings, t.language) === 'device' || !audio.asset(t)) && !matchingVoice(t, voices, library.settings.voices)).map(t => languageName(t.language)))).join(', ')}. Playback may be silent or use an unsuitable voice.</Notice><Text style={styles.body}>Generate audio in the tile editor or install the missing voices in your device’s speech settings. On iPad, also check the volume and silent mode.</Text><Button onPress={() => setSoundCheck(null)}>Go back</Button><Button kind="ghost" onPress={() => void play(soundCheck).catch(() => setError('The session could not be saved.'))}>Continue to board</Button></Sheet>}
  </View>{accountScreen}</>;
}
/**
 * Mount the app with safe-area support and the library-driven setup, dashboard, editor, and play
 * screens. Seed the stable root provider with native window insets for the first render; subsequent
 * system-bar visibility and orientation changes are measured by the provider.
 */
export default function App() { return <SafeAreaProvider initialMetrics={initialWindowMetrics}><SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}><Application /></SafeAreaView></SafeAreaProvider>; }
