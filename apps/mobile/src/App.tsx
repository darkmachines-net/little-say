/**
 * @file Coordinates library persistence, board navigation, playback previews, and parent editing
 * actions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Text, View } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { applyProposal, speechSource, boardPlayTiles, firstWord, getLanguageProfile, languageName, profileLanguages, reviseBoard, type Board, type BoardProposal, type Settings, type Tile } from '@little-say/core';
import { useLibrary } from './data/useLibrary';
import { getVoices, matchingVoice, speechQueue, type Voice } from './services/speech';
import { useSpeechLibrary } from './services/useSpeechLibrary';
import { initializeUpdates, applyUpdate } from './services/updates';
import { Dashboard } from './ui/Dashboard';
import { AiConversation } from './ui/AiConversation';
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
  useEffect(() => { if (draftRoute.route?.boardId) setSelectedId(draftRoute.route.boardId); }, [draftRoute.route?.boardId]);
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
  const setSettings = (patch: Partial<Settings>) => settingsRoute.save(() => store.commit(current => ({ ...current, settings: { ...current.settings, ...patch, activeBoardId: current.settings.activeBoardId, accountChoiceMade: current.settings.accountChoiceMade } })));
  const deleteBoard = (id: string) => {
    previewQueue.stop();
    void store.change(current => {
      const boardLanguages = { ...current.settings.boardLanguages }; delete boardLanguages[id];
      const boardLastPlayedAt = { ...current.boardLastPlayedAt }; delete boardLastPlayedAt[id];
      return { ...current, boards: current.boards.filter(board => board.id !== id), boardLastPlayedAt, favoriteBoardIds: current.favoriteBoardIds?.filter(boardId => boardId !== id), settings: { ...current.settings, boardLanguages, activeBoardId: current.settings.activeBoardId === id ? null : current.settings.activeBoardId } };
    }).catch(() => {});
    setSelectedId(current => current === id ? null : current);
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
  if (settingsRoute.route && !library.settings.activeBoardId) return <SettingsScreen route={settingsRoute.route} library={library} account={account} voices={voices} audio={audio} returnLabel={selectedId ? 'Back to board' : 'Boards'} onNavigate={settingsRoute.open} onBack={settingsRoute.back} onSave={setSettings} onBeforeRestart={store.flush} />;
  if (library.setup) return <><FirstTimeSetup library={library} onCommit={store.commitSetup} onAccount={() => setAccountOpen(true)} />{accountScreen}</>;
  const activeBoard = library.boards.find(board => board.id === library.settings.activeBoardId);
  const selected = library.boards.find(board => board.id === selectedId);
  if (activeBoard) return <PlayBoard board={activeBoard} settings={library.settings} voices={voices} audioAsset={audio.asset} onLanguageChange={language => store.change(current => ({ ...current, settings: { ...current.settings, boardLanguages: { ...current.settings.boardLanguages, [activeBoard.id]: language } } }))} onEdit={snapshot => {
    setSelectedId(activeBoard.id); setReturnBoardId(activeBoard.id); setTransition(snapshot);
    void store.change(current => ({ ...current, boardLastPlayedAt: { ...current.boardLastPlayedAt, [activeBoard.id]: Date.now() }, settings: { ...current.settings, activeBoardId: null } })).catch(() => {});
  }} />;
  const accept = async (proposal: BoardProposal, replaceTranslations = false) => {
    let candidate!: Board;
    let original: Board | null = null;
    await store.commit(lib => {
      const current = lib.boards.find(b => b.id === proposal.boardId) ?? null;
      if (proposal.boardId && !current) throw new Error('The original board was deleted. Please create a new proposal.');
      candidate = applyProposal(current, proposal, () => Crypto.randomUUID(), undefined, replaceTranslations);
      original = current;
      return { ...lib, boards: current ? lib.boards.map(b => b.id === candidate.id ? candidate : b) : [...lib.boards, candidate] };
    });
    if (original) remember(original);
    setSelectedId(candidate.id);
  };
  const manual = () => {
    const now = new Date().toISOString();
    const settings = store.current.current!.settings;
    const language = getLanguageProfile(settings).defaultLanguage;
    const word = firstWord(language);
    const playLanguages = profileLanguages(settings);
    const board: Board = { id: Crypto.randomUUID(), title: 'Our new board', revision: 0, createdAt: now, updatedAt: now, playLanguages, picturePolicy: settings.pictureDefaults ?? defaultPicturePolicy, tiles: [{ id: Crypto.randomUUID(), label: word.label, speech: word.speech, language, languageMode: playLanguages.length > 1 ? 'board' : 'fixed', color: 'sage', illustration: { kind: 'emoji', emoji: word.emoji } }] };
    void store.change(current => ({ ...current, boards: [...current.boards, board] })).catch(() => {}); setSelectedId(board.id);
  };
  if (draftRoute.route) {
    const source = draftRoute.route.boardId ? library.boards.find(board => board.id === draftRoute.route!.boardId) : undefined;
    if (draftRoute.route.boardId && !source) return <View style={[styles.page, { padding: 24, gap: 16 }]}><Notice>This board is no longer available.</Notice><Button onPress={draftRoute.close}>Back to boards</Button></View>;
    return <AiConversation key={source?.id ?? 'new'} settings={library.settings} board={source} onApply={(proposal, replaceTranslations) => draftRoute.save(() => accept(proposal, replaceTranslations))} onAiUse={consent} onClose={draftRoute.close} />;
  }
  return <><View style={styles.page}>
    <StatusBar style="dark" />
    {!selected && account.session && <View style={{ paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><Text style={styles.small}>{account.error ? 'Backup needs attention' : account.busy ? 'Syncing account backup…' : account.savedAt ? 'Account backup enabled' : 'Account backup pending'}</Text><Button compact kind="ghost" onPress={() => settingsRoute.open({ page: 'account' })}>Account & backup</Button></View>}
    {Boolean(store.error) && <View style={{ padding: 10 }}><Notice action={<Button kind="secondary" onPress={() => void store.retry().catch(() => {})}>Retry saving</Button>}>{store.error}</Notice></View>}
    {updateReady && <View style={{ padding: 10 }}><Notice action={<Button kind="secondary" onPress={() => { void store.flush().then(applyUpdate).catch(() => setError('Save your changes before updating.')); }}>Update now</Button>}>A new version is ready. Your locally saved boards will stay here.</Notice></View>}
    {Boolean(error) && <View style={{ padding: 10 }}><Notice action={<Button kind="ghost" onPress={() => setError('')}>Dismiss</Button>}>{error}</Notice></View>}
    {selected ? <BoardEditor key={selected.id} board={selected} settings={library.settings} audio={audio} onStopPreview={() => previewQueue.stop()} saving={store.saving} saveError={store.error} startingPlay={startingPlay} returnToPlay={returnBoardId === selected.id} transition={transition} onTransitionDone={finishTransition} onBack={() => { if (playRequest.current) return; previewQueue.stop(); setTransition(null); setReturnBoardId(null); setSelectedId(null); if (Platform.OS === 'web' && document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }} onPlay={() => preparePlay(selected)} onChange={(changes, expectedRevision) => {
      const current = store.current.current!.boards.find(b => b.id === selected.id)!;
      if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error('This board changed while editing. Your saved changes are kept; reopen the current card or prepare translations again.');
      remember(current);
      const next = reviseBoard(current, changes);
      void store.change(lib => ({ ...lib, boards: lib.boards.map(b => b.id === next.id ? next : b) })).catch(() => {});
      return next;
    }} onDelete={() => deleteBoard(selected.id)} onDuplicate={() => {
      const copy = { ...selected, id: Crypto.randomUUID(), title: `${selected.title.slice(0, 90)} (copy)`, revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tiles: selected.tiles.map(t => ({ ...t, id: Crypto.randomUUID() })) };
      void store.change(lib => ({ ...lib, boards: [...lib.boards, copy] })).catch(() => {}); setSelectedId(copy.id);
    }} onCompose={() => draftRoute.open(selected.id)} onConsent={consent} onPreview={preview} canUndo={Boolean(undo[selected.id]?.length)} onUndo={() => {
      const history = undo[selected.id] ?? []; const previous = history.at(-1); if (!previous) return;
      const current = store.current.current!.boards.find(b => b.id === selected.id)!;
      const restored = { ...previous, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      void store.change(lib => ({ ...lib, boards: lib.boards.map(b => b.id === selected.id ? restored : b) })).catch(() => {});
      setUndo(old => ({ ...old, [selected.id]: history.slice(0, -1) }));
    }} /> : <Dashboard library={library} audio={audio} saving={store.saving} onOpen={setSelectedId} onPlay={preparePlay} onSettings={() => settingsRoute.open()} onCompose={() => draftRoute.open()} onManual={manual} onDelete={deleteBoard} onFavorite={id => {
      void store.change(current => {
        const favorites = new Set(current.favoriteBoardIds);
        if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
        return { ...current, favoriteBoardIds: [...favorites] };
      }).catch(() => {});
    }} />}

    {soundCheck && <Sheet title="A quick sound check" onClose={() => setSoundCheck(null)}><Notice>Some tiles have neither saved audio nor a matching device voice for {Array.from(new Set(boardPlayTiles(soundCheck, library.settings).filter(t => (speechSource(library.settings, t.language) === 'device' || !audio.asset(t)) && !matchingVoice(t, voices, library.settings.voices)).map(t => languageName(t.language)))).join(', ')}. Playback may be silent or use an unsuitable voice.</Notice><Text style={styles.body}>Generate audio in the tile editor or install the missing voices in your device’s speech settings. On iPad, also check the volume and silent mode.</Text><Button onPress={() => { setSoundCheck(null); settingsRoute.open({ page: 'voices' }); }}>Check voices</Button><Button kind="ghost" onPress={() => void play(soundCheck).catch(() => setError('The session could not be saved.'))}>Continue to board</Button></Sheet>}
  </View>{accountScreen}</>;
}
/**
 * Mount the app with safe-area support and the library-driven setup, dashboard, editor, and play
 * screens. Seed the stable root provider with native window insets for the first render; subsequent
 * system-bar visibility and orientation changes are measured by the provider.
 */
export default function App() { return <SafeAreaProvider initialMetrics={initialWindowMetrics}><SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}><Application /></SafeAreaView></SafeAreaProvider>; }
