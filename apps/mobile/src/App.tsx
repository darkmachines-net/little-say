/**
 * @file Coordinates library persistence, board navigation, playback previews, and parent editing
 * actions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import * as Speech from 'expo-speech';
import { applyProposal, boardPlayTiles, firstWord, getLanguageProfile, languageName, profileLanguages, reviseBoard, type Board, type BoardProposal, type Settings, type Tile } from '@little-say/core';
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
import { ParentSettings } from './ui/ParentSettings';
import { FirstTimeSetup } from './ui/FirstTimeSetup';
import { Button, Notice, Sheet } from './ui/components';
import { theme, styles } from './ui/theme';
import { Brand } from './ui/Brand';
import { defaultPicturePolicy } from '@little-say/core';

function Application() {
  const store = useLibrary();
  const draftRoute = useBoardDraftRoute();
  const audio = useSpeechLibrary(store.library);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { if (draftRoute.route?.boardId) setSelectedId(draftRoute.route.boardId); }, [draftRoute.route?.boardId]);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const previewQueue = useMemo(() => speechQueue(voices, store.library?.settings.voices ?? {}, () => {}, () => setError('This audio could not play. Check your device’s volume and voice settings.'), audio.asset), [voices, store.library?.settings.voices, audio]);
  useEffect(() => () => previewQueue.stop(), [previewQueue]);
  const consent = () => store.change(current => ({ ...current, settings: { ...current.settings, aiConsent: true } }));
  useEffect(() => {
    let active = true;
    const refresh = () => { void getVoices().then(list => { if (active) setVoices(old => JSON.stringify(old) === JSON.stringify(list) ? old : list); }).catch(() => {}); };
    refresh();
    const timer = setTimeout(refresh, 1000);
    if (Platform.OS === 'web') window.speechSynthesis?.addEventListener('voiceschanged', refresh);
    let cleanup: (() => void) | undefined;
    void initializeUpdates(() => setUpdateReady(true)).then(fn => { if (active) cleanup = fn; else fn(); }).catch(() => {});
    return () => { active = false; clearTimeout(timer); cleanup?.(); if (Platform.OS === 'web') window.speechSynthesis?.removeEventListener('voiceschanged', refresh); };
  }, []);
  const remember = (board: Board) => setUndo(current => ({ ...current, [board.id]: [...(current[board.id] ?? []).slice(-19), board] }));
  const setSettings = (settings: Settings) => store.change(current => ({ ...current, settings: { ...settings, activeBoardId: current.settings.activeBoardId } }));
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
    if (boardPlayTiles(latest, current.settings).some(tile => !audio.asset(tile) && !matchingVoice(tile, voices, current.settings.voices))) setSoundCheck(latest);
    else void play(latest).catch(() => setError('The play session could not be saved. Your edits are still here. Retry saving, then try again.'));
  };
  const preview = (tile: Tile) => { previewQueue.stop(); previewQueue.enqueue(tile); };
  const previewSystem = (tile: Tile) => {
    previewQueue.stop();
    const settings = store.current.current!.settings;
    const voice = matchingVoice(tile, voices, settings.voices);
    void Speech.stop().then(() => Speech.speak(tile.speech, { language: tile.language, voice: voice?.identifier, rate: 0.88, onError: () => setError('This voice could not play. Check your device’s voice settings and volume.') }));
  };
  if (store.loadError) return <View style={[styles.page, { justifyContent: 'center', padding: 30, gap: 20 }]}><Notice>{store.loadError}</Notice><Button onPress={() => void store.reload()}>Try opening again</Button></View>;
  if (!store.library) return <View style={[styles.page, { justifyContent: 'center', alignItems: 'center', gap: 24 }]}><Brand stacked /><View style={styles.row}><ActivityIndicator color={theme.accent} /><Text style={styles.body}>Loading boards…</Text></View></View>;
  const library = store.library;
  if (library.setup) return <FirstTimeSetup library={library} onCommit={store.commitSetup} />;
  const activeBoard = library.boards.find(board => board.id === library.settings.activeBoardId);
  const selected = library.boards.find(board => board.id === selectedId);
  if (activeBoard) return <PlayBoard board={activeBoard} settings={library.settings} voices={voices} audioAsset={audio.asset} onLanguageChange={language => store.change(current => ({ ...current, settings: { ...current.settings, boardLanguages: { ...current.settings.boardLanguages, [activeBoard.id]: language } } }))} onEdit={snapshot => {
    setSelectedId(activeBoard.id); setReturnBoardId(activeBoard.id); setTransition(snapshot);
    void store.change(current => ({ ...current, boardLastPlayedAt: { ...current.boardLastPlayedAt, [activeBoard.id]: Date.now() }, settings: { ...current.settings, activeBoardId: null } })).catch(() => {});
  }} />;
  const accept = async (proposal: BoardProposal) => {
    let candidate!: Board;
    let original: Board | null = null;
    await store.commit(lib => {
      const current = lib.boards.find(b => b.id === proposal.boardId) ?? null;
      if (proposal.boardId && !current) throw new Error('The original board was deleted. Please create a new proposal.');
      candidate = applyProposal(current, proposal, () => Crypto.randomUUID());
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
    return <AiConversation key={source?.id ?? 'new'} settings={library.settings} board={source} onApply={proposal => draftRoute.save(() => accept(proposal))} onAiUse={consent} onClose={draftRoute.close} />;
  }
  return <View style={styles.page}>
    <StatusBar style="dark" />
    {Boolean(store.error) && <View style={{ padding: 10 }}><Notice action={<Button kind="secondary" onPress={() => void store.retry().catch(() => {})}>Retry saving</Button>}>{store.error}</Notice></View>}
    {updateReady && <View style={{ padding: 10 }}><Notice action={<Button kind="secondary" onPress={() => { void store.flush().then(applyUpdate).catch(() => setError('Save your changes before updating.')); }}>Update now</Button>}>A new version is ready. Your locally saved boards will stay here.</Notice></View>}
    {Boolean(error) && <View style={{ padding: 10 }}><Notice action={<Button kind="ghost" onPress={() => setError('')}>Dismiss</Button>}>{error}</Notice></View>}
    {selected ? <BoardEditor key={selected.id} board={selected} settings={library.settings} audio={audio} onStopPreview={() => previewQueue.stop()} saving={store.saving} startingPlay={startingPlay} returnToPlay={returnBoardId === selected.id} transition={transition} onTransitionDone={finishTransition} onBack={() => { if (playRequest.current) return; previewQueue.stop(); setTransition(null); setReturnBoardId(null); setSelectedId(null); if (Platform.OS === 'web' && document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }} onPlay={() => preparePlay(selected)} onChange={changes => {
      const current = store.current.current!.boards.find(b => b.id === selected.id)!;
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
    }} /> : <Dashboard library={library} audio={audio} saving={store.saving} onOpen={setSelectedId} onPlay={preparePlay} onSettings={() => setSettingsOpen(true)} onCompose={() => draftRoute.open()} onManual={manual} onConsent={consent} onDelete={deleteBoard} onFavorite={id => {
      void store.change(current => {
        const favorites = new Set(current.favoriteBoardIds);
        if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
        return { ...current, favoriteBoardIds: [...favorites] };
      }).catch(() => {});
    }} />}
    {settingsOpen && <ParentSettings settings={library.settings} voices={voices} languages={Array.from(new Set(library.boards.flatMap(b => [...(b.playLanguages ?? []), ...b.tiles.map(t => t.language)])))} onSave={setSettings} onPreview={previewSystem} onClose={() => { previewQueue.stop(); setSettingsOpen(false); }} />}
    {soundCheck && <Sheet title="A quick sound check" onClose={() => setSoundCheck(null)}><Notice>Some tiles have neither saved audio nor a matching device voice for {Array.from(new Set(boardPlayTiles(soundCheck, library.settings).filter(t => !audio.asset(t) && !matchingVoice(t, voices, library.settings.voices)).map(t => languageName(t.language)))).join(', ')}. Playback may be silent or use an unsuitable voice.</Notice><Text style={styles.body}>Generate audio in the tile editor or install the missing voices in your device’s speech settings. On iPad, also check the volume and silent mode.</Text><Button onPress={() => { setSoundCheck(null); setSettingsOpen(true); }}>Check parent settings</Button><Button kind="ghost" onPress={() => void play(soundCheck).catch(() => setError('The session could not be saved.'))}>Continue to board</Button></Sheet>}
  </View>;
}
/**
 * Mount the app with safe-area support and the library-driven setup, dashboard, editor, and play
 * screens.
 */
export default function App() { return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}><Application /></SafeAreaView></SafeAreaProvider>; }
