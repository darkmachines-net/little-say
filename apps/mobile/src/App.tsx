/**
 * @file Requires sign-in, shows cloud restoration on Home, and coordinates library persistence, board navigation, playback, and normal Undo for manual edits
 * and automatically saved AI turns, explicit creation-draft saves, creation/play recency, shared languages, and translations.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Text, View } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { applyProposal, mergeBoardSuggestion, draftBoardSchema, speechSource, boardPlayTiles, boardWithProfileLanguages, languageName, profileLanguages, reviseBoard, type Board, type BoardSuggestion, type CreationDraft, type Settings, type Tile } from '@little-say/core';
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
import { useAccountRoute } from './services/useAccountRoute';
import { isAccountEntryMode } from './services/accountRoute';

function Application() {
  const store = useLibrary();
  const draftRoute = useBoardDraftRoute();
  const settingsRoute = useSettingsRoute();
  const accountRoute = useAccountRoute();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workingDraft, setWorkingDraft] = useState<CreationDraft | null>(null);
  const workingDraftRef = useRef(workingDraft);
  const updateDraft = (next: CreationDraft | null) => {
    if (JSON.stringify(workingDraftRef.current) === JSON.stringify(next)) return;
    workingDraftRef.current = next; setWorkingDraft(next);
  };
  // Settings has its own URL without the board hash. Keep the caller until its history restores the
  // editor route; ordinary browser Back/Forward still updates selection outside Settings.
  useEffect(() => { if (!settingsRoute.route) setSelectedId(draftRoute.route?.boardId ?? null); }, [draftRoute.route?.boardId, settingsRoute.route]);
  useEffect(() => {
    if (!store.library || !draftRoute.route || draftRoute.route.boardId || workingDraftRef.current) return;
    if (store.library.creationDraft) { updateDraft(store.library.creationDraft); return; }
    const now = new Date().toISOString();
    const legacy = store.library.boardCreationDraft;
    const board: Board = { id: Crypto.randomUUID(), title: 'New board', revision: 0, createdAt: now, updatedAt: now, tiles: [], playLanguages: profileLanguages(store.library.settings), picturePolicy: legacy?.picturePolicy ?? store.library.settings.pictureDefaults ?? defaultPicturePolicy };
    // Read older saved creation sessions without restoring an active provider operation.
    const suggestion = legacy?.draft ? { base: board, board: { ...applyProposal(null, legacy.draft, () => Crypto.randomUUID()), id: board.id, createdAt: now } } : null;
    updateDraft({ board, prompt: legacy?.prompt ?? '', suggestion, history: legacy?.history ?? [], reply: legacy?.clarifying ? legacy.history.at(-1)?.reply ?? '' : '' });
  }, [draftRoute.route, store.library]);
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
  const requiresAccount = !account.session || account.needsLogin;
  const signedInPreviously = useRef<boolean | null>(null);
  useEffect(() => {
    if (!account.ready) return;
    const signedIn = !requiresAccount;
    // Authentication returns to Home immediately; explicitly opened account settings stay open.
    if (signedIn && (signedInPreviously.current === false || (accountRoute.route?.mode && isAccountEntryMode(accountRoute.route.mode)))) accountRoute.close();
    signedInPreviously.current = signedIn;
  }, [account.ready, requiresAccount, accountRoute]);
  const audio = useSpeechLibrary(account.ready && !requiresAccount ? store.library : null);
  const openAccount = accountRoute.open;
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
  const setSettings = (patch: Partial<Settings>) => settingsRoute.save(() => store.commit(current => ({ ...current, settings: { ...current.settings, ...patch, activeBoardId: current.settings.activeBoardId } })));
  const deleteBoard = (id: string) => {
    previewQueue.stop();
    void store.change(current => {
      const boardLanguages = { ...current.settings.boardLanguages }; delete boardLanguages[id];
      const boardLastPlayedAt = { ...current.boardLastPlayedAt }; delete boardLastPlayedAt[id];
      const deletingDraft = workingDraftRef.current?.board.id === id;
      return { ...current, creationDraft: current.creationDraft?.board.id === id ? undefined : current.creationDraft, boardCreationDraft: deletingDraft ? undefined : current.boardCreationDraft, boards: current.boards.filter(board => board.id !== id), boardLastPlayedAt, favoriteBoardIds: current.favoriteBoardIds?.filter(boardId => boardId !== id), settings: { ...current.settings, boardLanguages, activeBoardId: current.settings.activeBoardId === id ? null : current.settings.activeBoardId } };
    }).catch(() => {});
    if (workingDraftRef.current?.board.id === id) updateDraft(null);
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
  if (!store.library || !account.ready) return <View style={[styles.page, { justifyContent: 'center', alignItems: 'center', gap: 24 }]}><Brand stacked /><View style={styles.row}><ActivityIndicator color={theme.accent} /><Text style={styles.body}>Loading boards…</Text></View></View>;
  const library = store.library;
  const accountScreen = (accountRoute.route || requiresAccount) && <AccountScreen account={account} mode={accountRoute.route?.mode ?? null} onMode={mode => openAccount(mode, mode === null)} onBack={accountRoute.back} onClose={() => {
    if (requiresAccount) return;
    accountRoute.close();
  }} />;
  if (requiresAccount) return accountScreen;
  const accountLabel = account.session && !account.needsLogin ? 'Account & backup' : 'Sign in / Register';
  if (settingsRoute.route && !library.settings.activeBoardId) return <SettingsScreen route={settingsRoute.route} library={library} returnLabel={selectedId ? 'Back to board' : 'Boards'} onNavigate={settingsRoute.open} onBack={settingsRoute.back} onSave={setSettings} onBeforeRestart={store.flush} />;
  if (library.setup && !account.restoring) return <><FirstTimeSetup library={library} onCommit={store.commitSetup} onAccount={() => openAccount()} accountLabel={accountLabel} />{accountScreen}</>;
  const boards = library.boards.map(board => boardWithProfileLanguages(board, library.settings));
  const activeBoard = boards.find(board => board.id === library.settings.activeBoardId);
  const selected = account.restoring ? undefined : boards.find(board => board.id === (draftRoute.route?.boardId ?? selectedId)) ?? (draftRoute.route && !draftRoute.route.boardId && workingDraft ? boardWithProfileLanguages(workingDraft.board, library.settings) : undefined);
  if (activeBoard && accountScreen) return accountScreen;
  if (activeBoard) return <PlayBoard board={activeBoard} settings={library.settings} voices={voices} audioAsset={audio.asset} onLanguageChange={language => store.change(current => ({ ...current, settings: { ...current.settings, boardLanguages: { ...current.settings.boardLanguages, [activeBoard.id]: language } } }))} onEdit={snapshot => {
    if (draftRoute.route?.boardId !== activeBoard.id) draftRoute.open(activeBoard.id); setSelectedId(activeBoard.id); setReturnBoardId(activeBoard.id); setTransition(snapshot);
    void store.change(current => ({ ...current, boardLastPlayedAt: { ...current.boardLastPlayedAt, [activeBoard.id]: Date.now() }, settings: { ...current.settings, activeBoardId: null } })).catch(() => {});
  }} />;
  const accept = async (suggestion: BoardSuggestion, choice?: 'current' | 'suggested') => {
    let original!: Board;
    await draftRoute.save(() => store.commit(lib => {
      const current = lib.boards.find(b => b.id === suggestion.base.id) ?? (workingDraftRef.current?.board.id === suggestion.base.id ? workingDraftRef.current.board : undefined);
      if (!current) throw new Error('The original board was deleted.');
      const merged = mergeBoardSuggestion(suggestion.base, suggestion.board, current, choice);
      if (merged.conflicts.length && !choice) throw new Error('Newer edits need review. Choose which changes to keep.');
      original = current;
      const exists = lib.boards.some(b => b.id === current.id);
      return { ...lib, creationDraft: exists ? lib.creationDraft : undefined, boardCreationDraft: exists ? lib.boardCreationDraft : undefined,
        boardLastPlayedAt: exists ? lib.boardLastPlayedAt : { ...lib.boardLastPlayedAt, [current.id]: Date.now() },
        boards: exists ? lib.boards.map(b => b.id === current.id ? merged.board : b) : [...lib.boards, merged.board] };
    }));
    remember(original); updateDraft(null); setSelectedId(original.id); draftRoute.replace(original.id);
  };
  if (!account.restoring && draftRoute.route?.boardId && !selected) return <View style={[styles.page, { padding: 24, gap: 16 }]}><Notice>This board is no longer available.</Notice><Button onPress={draftRoute.close}>Back to boards</Button></View>;
  return <><View style={styles.page}>
    <StatusBar style="dark" />
    {Boolean(store.error) && <View style={{ padding: 10 }}><Notice action={<Button kind="secondary" onPress={() => void store.retry().catch(() => {})}>Retry saving</Button>}>{store.error}</Notice></View>}
    {updateReady && <View style={{ padding: 10 }}><Notice action={<Button kind="secondary" onPress={() => { void store.flush().then(applyUpdate).catch(() => setError('Save your changes before updating.')); }}>Update now</Button>}>A new version is ready. Your locally saved boards will stay here.</Notice></View>}
    {Boolean(error) && <View style={{ padding: 10 }}><Notice action={<Button kind="ghost" onPress={() => setError('')}>Dismiss</Button>}>{error}</Notice></View>}
    {selected ? <BoardEditor key={selected.id} board={selected} settings={library.settings} audio={audio} translationStatus={translations.status[selected.id]} onPrepareTranslations={() => void translations.prepare(selected.id)} onCancelTranslations={() => translations.cancel(selected.id)} onManageLanguages={() => settingsRoute.open({ page: 'languages' })} draft={workingDraft?.board.id === selected.id ? workingDraft : undefined} onAccept={accept} onDraft={state => {
      const current = workingDraftRef.current;
      if (current?.board.id === selected.id) updateDraft({ ...current, ...state });
    }} onBeforeClose={draftRoute.beforeClose} onSaveDraft={snapshot => draftRoute.save(() => store.commit(lib => ({ ...lib, creationDraft: snapshot, boardCreationDraft: undefined })))} onDiscardDraft={() => draftRoute.save(async () => {
      if (store.current.current?.creationDraft || store.current.current?.boardCreationDraft || store.error) await store.commit(lib => ({ ...lib, creationDraft: undefined, boardCreationDraft: undefined }));
    })} onStopPreview={() => previewQueue.stop()} saving={store.saving} saveError={store.error} startingPlay={startingPlay} returnToPlay={returnBoardId === selected.id} transition={transition} onTransitionDone={finishTransition} onBack={() => { if (playRequest.current) return; void store.flush().then(() => { previewQueue.stop(); setTransition(null); setReturnBoardId(null); updateDraft(null); setSelectedId(null); draftRoute.close(); if (Platform.OS === 'web' && document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }).catch(() => setError('Your changes could not be saved. Retry saving before leaving.')); }} onPlay={() => preparePlay(selected)} onChange={(changes, expectedRevision) => {
      const current = store.current.current!.boards.find(b => b.id === selected.id) ?? workingDraftRef.current!.board;
      if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error('This board changed while editing. Your saved changes are kept; reopen the current card or prepare translations again.');
      remember(current);
      const next = (changes.tiles ?? current.tiles).length ? reviseBoard(current, changes) : draftBoardSchema.parse({ ...current, ...changes, revision: current.revision + 1, updatedAt: new Date().toISOString() });
      if (!next.tiles.length) {
        updateDraft({ ...workingDraftRef.current!, board: next });
      } else {
        void store.change(lib => {
          const exists = lib.boards.some(b => b.id === next.id);
          return { ...lib, creationDraft: exists ? lib.creationDraft : undefined, boardCreationDraft: exists ? lib.boardCreationDraft : undefined,
            boardLastPlayedAt: exists ? lib.boardLastPlayedAt : { ...lib.boardLastPlayedAt, [next.id]: Date.now() },
            boards: exists ? lib.boards.map(b => b.id === next.id ? next : b) : [...lib.boards, next] };
        }).catch(() => {});
        if (!draftRoute.route?.boardId) { updateDraft(null); setSelectedId(next.id); draftRoute.replace(next.id); }
      }
      return next;
    }} onDelete={() => deleteBoard(selected.id)} onDuplicate={() => {
      if (!selected.tiles.length) return;
      const copy = { ...selected, id: Crypto.randomUUID(), title: `${selected.title.slice(0, 90)} (copy)`, revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tiles: selected.tiles.map(t => ({ ...t, id: Crypto.randomUUID() })) };
      void store.change(lib => ({ ...lib, boards: [...lib.boards, copy], boardLastPlayedAt: { ...lib.boardLastPlayedAt, [copy.id]: Date.now() } })).catch(() => {}); setSelectedId(copy.id); draftRoute.open(copy.id);
    }} onConsent={consent} onPreview={preview} canUndo={Boolean(undo[selected.id]?.length)} onUndo={() => {
      const history = undo[selected.id] ?? []; const previous = history.at(-1); if (!previous) return;
      const current = store.current.current!.boards.find(b => b.id === selected.id) ?? workingDraftRef.current!.board;
      const restored = { ...previous, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      if (restored.tiles.length) void store.change(lib => ({ ...lib, boards: lib.boards.map(b => b.id === selected.id ? restored : b) })).catch(() => {});
      else {
        updateDraft({ board: restored, prompt: '', suggestion: null });
        void store.change(lib => ({ ...lib, boards: lib.boards.filter(b => b.id !== selected.id) })).catch(() => {});
        setSelectedId(null); draftRoute.replace(null);
      }
      setUndo(old => ({ ...old, [selected.id]: history.slice(0, -1) }));
    }} /> : <Dashboard library={library} audio={audio} sync={account} saving={store.saving} onOpen={id => { setSelectedId(id); draftRoute.open(id); }} onPlay={preparePlay} onAccount={() => openAccount()} accountLabel={accountLabel} onSettings={() => settingsRoute.open()} onCompose={() => draftRoute.open()} onDelete={deleteBoard} onFavorite={id => {
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
 * Mount the app with safe-area support for account entry, setup, dashboard, editor, and play.
 * Seed the stable root provider with native window insets for the first render; subsequent
 * system-bar visibility and orientation changes are measured by the provider.
 */
export default function App() { return <SafeAreaProvider initialMetrics={initialWindowMetrics}><SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}><Application /></SafeAreaView></SafeAreaProvider>; }
