/** @file Edits a primary-language board in a bounded keyboard viewport with a scrolling canvas and fixed prompt controls. */

import { useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions, type ViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Copy, Languages, Play, Plus, Settings as SettingsIcon, Trash2, Undo2, Volume2 } from 'lucide-react-native';
import * as Crypto from 'expo-crypto';
import { MAX_TILES, speechSource, boardAudioTiles, colors, gridLayout, hasTileLanguage, newTileLanguage, selectedBoardLanguage, tileInLanguage, tileSchema, type BoardChanges, type Board, type Settings, type Tile, type CreationDraft, type BoardSuggestion } from '@little-say/core';
import { BoardLanguages } from './BoardLanguages';
import { TileFace } from './TileFace';
import { TileEditor } from './TileEditor';
import { Button, Confirm, Notice, Sheet } from './components';
import { styles, theme } from './theme';
import { type SpeechLibrary } from '../services/speechLibrary';
import { BoardPictures } from './BoardPictures';
import { BoardTransition, type BoardGeometry, type BoardSnapshot } from './BoardTransition';
import { useScreenFocus } from './screenFocus';
import { PictureStatus } from './PictureStatus';
import { BoardAssistant } from './BoardAssistant';
import { useBoardAssistant } from '../services/useBoardAssistant';

/**
 * Keep manual edits and streamed AI previews on one canvas. Each completed or stopped AI turn saves
 * automatically through the parent's normal Undo history; only conflicts and failed writes need action.
 * The canvas uses the first configured board language; language variants are selected inside each
 * tile editor. Pictures, languages, audio, and board management live behind the toolbar settings gear.
 * Manual Add card stays available at capacity and explains the limit only when another card is requested.
 * Tile and translation saves pass expectedRevision to onChange; the parent must throw on a
 * revision mismatch. The save error keeps the editor draft open instead of applying stale changes.
 * The app root owns all safe-area insets. Keyboard padding consumes only overlap with that inset
 * viewport on both native platforms, including Android windows that already resize for the IME.
 * Toolbar and composer are outside scrolling content; only the canvas and bounded AI context scroll.
 * Typing collapses secondary chrome without remounting the input or caching a screen-height baseline.
 */
export function BoardEditor({ board: savedBoard, settings, audio, draft, onDraft, onAccept, onStopPreview, onBack, onChange: saveChanges, onPlay, onDelete, onDuplicate, onConsent, onUndo, canUndo, onPreview, saving, saveError, startingPlay, returnToPlay, transition, onTransitionDone }: { board: Board; settings: Settings; audio: SpeechLibrary; draft?: CreationDraft;
  /** Persist the local creation session while it remains outside the playable library. */
  onDraft: (state: Pick<CreationDraft, 'prompt' | 'suggestion'>) => void;
  /** Apply an AI turn against the latest saved board and record a normal Undo step. */
  onAccept: (suggestion: BoardSuggestion, choice?: 'current' | 'suggested') => Promise<void>;
  onStopPreview: () => void; onBack: () => void; onChange: (changes: BoardChanges, expectedRevision?: number) => Board; onPlay: () => void; onDelete: () => void; onDuplicate: () => void; onConsent: () => Promise<void>; onUndo: () => void; canUndo: boolean; onPreview: (tile: Tile) => void; saving: boolean; saveError?: string; startingPlay: boolean; returnToPlay: boolean; transition: BoardSnapshot | null; onTransitionDone: () => void }) {
  const assistant = useBoardAssistant({ board: savedBoard, settings, draft, onDraft, onAccept, onConsent, onSpeechReady: () => audio.reload() });
  const board = assistant.preview;
  const onChange = (changes: BoardChanges, revision?: number) => {
    if (revision !== undefined && revision !== board.revision) throw new Error('This board changed while you were editing. Close and reopen these controls before saving.');
    return assistant.suggestion ? assistant.edit(changes) : saveChanges(changes, revision);
  };
  const { width, height } = useWindowDimensions();
  const { top: safeAreaTop } = useSafeAreaInsets();
  const heading = useScreenFocus();
  const previewGrid = useRef<ViewInstance>(null);
  const [target, setTarget] = useState<BoardGeometry | null>(null);
  const [editing, setEditing] = useState<Tile | null>(null);
  const [adding, setAdding] = useState(false);
  const primaryLanguage = board.playLanguages?.[0] ?? null;
  const [title, setTitle] = useState(board.title);
  const [deleting, setDeleting] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [languagesOpen, setLanguagesOpen] = useState(false);
  const [pictures, setPictures] = useState<Board | null>(null);
  const [automaticPictures, setAutomaticPictures] = useState(false);
  const [pictureTarget, setPictureTarget] = useState<string | undefined>();
  const [audioError, setAudioError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [area, setArea] = useState({ width: 600, height: 400 });
  const [contentHeight, setContentHeight] = useState(400);
  const [promptFocused, setPromptFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  const wide = width >= 900 || (width >= 600 && height < 600);
  const short = height < 600;
  const typing = promptFocused && (keyboardVisible || short);
  const blocked = startingPlay || assistant.busy === 'save';
  const undoAvailable = canUndo && !assistant.busy && !assistant.suggestion;
  const undo = () => { assistant.clear(); onUndo(); };
  const back = () => { if (!blocked) void assistant.stop().then(saved => { if (saved) onBack(); }); };
  const play = () => { void assistant.stop().then(saved => { if (saved) onPlay(); }); };
  const backRef = useRef(back); backRef.current = back;
  useEffect(() => { const listener = BackHandler.addEventListener('hardwareBackPress', () => { backRef.current(); return true; }); return () => listener.remove(); }, []);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => { setTitle(board.title); }, [board.title]);
  const setTiles = (tiles: Tile[]) => onChange({ tiles }, board.revision);
  const limitMessage = `Boards can have up to ${MAX_TILES} cards. Remove a card before adding another.`;
  const addTile = () => {
    if (board.tiles.length >= MAX_TILES) { setLimitOpen(true); return; }
    const language = newTileLanguage(board, settings);
    const tile: Tile = { id: Crypto.randomUUID(), label: '', speech: '', language, languageMode: board.playLanguages?.length ? 'board' : 'fixed', color: colors[board.tiles.length % colors.length], illustration: { kind: 'emoji', emoji: '➕' } };
    setAdding(true); setEditing(tile);
  };
  const layout = gridLayout(board.tiles.length, Math.max(44, area.width - 24), Math.max(1, area.height - 24), 8,
    { minHeight: 64, maxWidth: 164, maxHeight: 148, scroll: true });
  const audioTiles = boardAudioTiles(board).filter(tile => speechSource(settings, tile.language) === 'ai');
  const readyAudio = audioTiles.filter(tile => audio.asset(tile)).length;
  const preparingAudio = audioTiles.filter(tile => audio.status(tile).state === 'preparing').length;
  const failedAudio = audioTiles.filter(tile => audio.status(tile).state === 'error' && !audio.asset(tile)).length;
  const missingAudio = audioTiles.filter(tile => !audio.asset(tile) && audio.status(tile).state !== 'preparing');
  const closeTile = () => { onStopPreview(); setEditing(null); setAdding(false); };
  const assertCurrentTile = (tile: Tile) => {
    const current = board.tiles.find(value => value.id === tile.id);
    if (!adding && (!current || JSON.stringify(tileSchema.parse(current)) !== JSON.stringify(tileSchema.parse(editing)))) throw new Error('This card changed while you were editing. Your draft is still here. Cancel and reopen the current card before saving.');
  };
  const editingIndex = board.tiles.findIndex(t => t.id === editing?.id);
  const reorder = (offset: number) => {
    if (editingIndex < 0 || editingIndex + offset < 0 || editingIndex + offset >= board.tiles.length) return;
    const next = [...board.tiles]; [next[editingIndex], next[editingIndex + offset]] = [next[editingIndex + offset], next[editingIndex]]; setTiles(next);
  };
  const modalOpen = Boolean(editing || limitOpen || settingsOpen || languagesOpen || pictures || deleting);
  const playLanguage = selectedBoardLanguage(board, settings);
  const untranslated = playLanguage ? board.tiles.filter(tile => tile.languageMode === 'board' && !hasTileLanguage(tile, playLanguage)).length : 0;
  return <KeyboardAvoidingView testID="board-workspace" behavior={Platform.OS === 'web' ? undefined : 'padding'} keyboardVerticalOffset={Platform.OS === 'web' ? 0 : safeAreaTop} style={styles.page}>
    <View style={{ flexShrink: 0, backgroundColor: theme.surface, borderBottomWidth: 1, borderColor: theme.line }}><View style={[styles.container, styles.row, { justifyContent: 'space-between', paddingVertical: typing ? 0 : 10, gap: 6 }]}>
      <Button kind="ghost" compact={width < 600} icon={ChevronLeft} accessibilityLabel="Boards" disabled={blocked || modalOpen} onPress={back}>{typing ? undefined : 'Boards'}</Button>
      {typing ? <Text numberOfLines={1} style={[styles.label, { flex: 1, marginBottom: 0 }]}>{board.title}</Text> : <View style={[styles.row, { gap: 6 }]}><Button kind="ghost" compact icon={Undo2} accessibilityLabel="Undo last board change" disabled={blocked || !undoAvailable || modalOpen} onPress={undo} /><Button kind="ghost" compact icon={SettingsIcon} accessibilityLabel="Board settings" disabled={blocked || modalOpen} onPress={() => setSettingsOpen(true)} /><Button icon={Play} compact={width < 600} disabled={modalOpen || !savedBoard.tiles.length || Boolean(assistant.suggestion)} busy={blocked} onPress={play}>{returnToPlay ? 'Return to play' : 'Play board'}</Button></View>}
    </View></View>
    <View style={[styles.container, { flex: 1, minHeight: 0, paddingTop: typing ? 8 : 14, paddingBottom: typing ? 8 : 16, gap: typing ? 8 : 14 }]}>
      {!typing && <View ref={heading} testID="editor-heading" accessibilityRole="header" accessibilityLabel="Board editor" tabIndex={-1} style={{ gap: 4 }}><TextInput accessibilityLabel="Board title" editable={!blocked} value={title} maxLength={100} onChangeText={value => { setTitle(value); if (value.trim()) onChange({ title: value }); }} onBlur={() => { if (!title.trim()) setTitle(board.title); }} style={{ color: theme.ink, fontSize: width < 600 ? 24 : 30, fontWeight: '800', paddingVertical: 4 }} /><View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.small}>{saving ? 'Saving…' : saveError ? 'Not saved — retry saving' : assistant.suggestion ? 'AI changes not saved' : draft ? 'Draft saved' : 'Saved on this device'}</Text></View></View>}
      {!typing && returnToPlay && untranslated > 0 && <Notice>{untranslated} switchable cards still use their original words. Prepare missing translations in Board settings.</Notice>}
      <View testID="editor-content" onLayout={event => setContentHeight(event.nativeEvent.layout.height)} style={{ flex: 1, minHeight: 0, flexDirection: wide ? 'row' : 'column', gap: typing ? 8 : 14 }}>
        <View testID="editor-preview" onLayout={event => setArea(event.nativeEvent.layout)} style={{ flex: 1, minWidth: 0, minHeight: 0, borderRadius: typing ? 14 : 22, backgroundColor: theme.surface, overflow: 'hidden' }}>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, minHeight: 0, opacity: transition ? 0 : 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 12 }}>
            {!board.tiles.length && <Text style={styles.body}>Add a card or describe a board below.</Text>}
            <View ref={previewGrid} collapsable={false} onLayout={() => { if (transition) previewGrid.current?.measureInWindow((x, y, width, height) => setTarget({ x, y, width, height, rects: layout.rects.map((rect, i) => ({ ...rect, id: board.tiles[i].id })) })); }} style={{ width: layout.width, height: layout.height }}>
              {board.tiles.map((tile, index) => { const rect = layout.rects[index]; const shown = tileInLanguage(tile, primaryLanguage); const missing = primaryLanguage && tile.languageMode === 'board' && !hasTileLanguage(tile, primaryLanguage); const changed = assistant.suggestion && JSON.stringify(savedBoard.tiles.find(t => t.id === tile.id)) !== JSON.stringify(tile); const pictureState = assistant.states[tile.id]; return rect && <Pressable key={tile.id} accessibilityRole="button" accessibilityLabel={`Edit tile ${shown.label}${changed ? ', suggested change' : ''}${missing ? ', translation needs attention' : ''}`} disabled={blocked} onPress={() => { setAdding(false); setEditing(tile); }} style={({ pressed }) => ({ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height, opacity: pressed ? 0.75 : 1, borderWidth: changed ? 2 : 0, borderColor: theme.accent, borderStyle: changed ? 'dashed' : 'solid', borderRadius: 18 })}><TileFace tile={shown} compact size={Math.min(64, rect.height * 0.43)} />{pictureState ? <PictureStatus state={pictureState} /> : missing ? <Text style={{ ...styles.small, position: 'absolute', bottom: 2, alignSelf: 'center', backgroundColor: theme.surface }}>Needs translation</Text> : null}</Pressable>; })}
            </View>
          </ScrollView>
        </View>
        <View testID="editor-actions" style={{ width: wide ? 280 : '100%', flexShrink: 0, minHeight: 0, gap: typing ? 0 : 12 }}>
          {!typing && <View style={[styles.row, { justifyContent: 'space-between' }]}><Button kind="secondary" icon={Plus} disabled={blocked} onPress={addTile}>Add card</Button></View>}
          <BoardAssistant assistant={assistant} disabled={blocked || modalOpen} compact={typing} maxHeight={Math.max(96, wide ? contentHeight - (typing ? 0 : 62) : contentHeight * 0.5)} onFocusChange={setPromptFocused} />
        </View>
      </View>
    </View>
    {transition && <BoardTransition source={transition} target={target} onDone={onTransitionDone} />}
    {limitOpen && <Sheet title="Board is full" onClose={() => setLimitOpen(false)} footer={<Button onPress={() => setLimitOpen(false)}>Got it</Button>}><Text style={styles.body}>{limitMessage}</Text></Sheet>}
    {settingsOpen && <Sheet title="Board settings" onClose={() => setSettingsOpen(false)}>
      <Button kind="secondary" icon={Languages} disabled={blocked || !board.tiles.length} onPress={() => { setSettingsOpen(false); setLanguagesOpen(true); }}>Languages</Button>
      <Button kind="secondary" disabled={blocked || Boolean(assistant.suggestion)} onPress={() => { setSettingsOpen(false); setAutomaticPictures(false); setPictureTarget(undefined); setPictures(board); }}>Pictures</Button>
      {audioTiles.length > 0 && <View style={{ backgroundColor: theme.surface, padding: 14, borderRadius: 18, gap: 8 }}>
        <Text accessibilityLiveRegion="polite" style={styles.small}>{readyAudio} of {audioTiles.length} voices saved{preparingAudio ? ` · Preparing ${preparingAudio}…` : ''}{failedAudio ? ` · ${failedAudio} failed. Check your connection and retry.` : ''}</Text>
        <Button kind="secondary" icon={Volume2} disabled={startingPlay || !missingAudio.length} onPress={() => { setAudioError(''); void (async () => { await Promise.allSettled(missingAudio.map(tile => audio.generate(tile, settings.backendUrl))); })().catch(() => setAudioError('Could not prepare audio. Check storage and try again.')); }}>{missingAudio.length ? `${failedAudio ? 'Retry' : 'Prepare'} missing audio (${missingAudio.length})` : preparingAudio ? 'Preparing audio…' : 'All audio saved'}</Button>
        {Boolean(audioError) && <Notice>{audioError}</Notice>}
      </View>}
      <View style={{ gap: 8 }}><Button kind="ghost" icon={Copy} disabled={blocked || !savedBoard.tiles.length || Boolean(assistant.suggestion)} onPress={() => { setSettingsOpen(false); onDuplicate(); }}>Duplicate board</Button><Button kind="danger" icon={Trash2} disabled={blocked} onPress={() => { setSettingsOpen(false); setDeleting(true); }}>Delete board</Button></View>
    </Sheet>}
    {languagesOpen && <BoardLanguages board={board} settings={settings} onChange={onChange} onConsent={onConsent} onClose={() => setLanguagesOpen(false)} />}
    {editing && <TileEditor key={editing.id} board={board} tile={editing} editingLanguage={adding ? null : primaryLanguage} onStopPreview={onStopPreview} position={adding ? undefined : editingIndex} tileCount={board.tiles.length} onMove={adding ? undefined : reorder} playLanguages={board.playLanguages} settings={settings} audio={audio} onConsent={onConsent} canDelete={!adding && board.tiles.length > 1} canDuplicate={!adding && board.tiles.length < MAX_TILES} onClose={closeTile} onPreview={onPreview} onAskAi={adding ? undefined : tile => { assertCurrentTile(tile); setTiles(board.tiles.map(current => current.id === tile.id ? tile : current)); assistant.setScope(tile.id); closeTile(); }} onSave={tile => {
      if (adding && board.tiles.length >= MAX_TILES) throw new Error(limitMessage);
      assertCurrentTile(tile);
      const tiles = adding ? [...board.tiles, tile] : board.tiles.map(t => t.id === tile.id ? tile : t);
      const changedMeaning = tile.label !== editing.label || tile.language !== editing.language || JSON.stringify(tile.pictureOptions) !== JSON.stringify(editing.pictureOptions);
      const saved = setTiles(tiles);
      if (!assistant.suggestion && changedMeaning && !tile.pictureOptions?.locked && tile.illustration.kind !== 'photo' && settings.aiConsent) { setAutomaticPictures(true); setPictureTarget(tile.id); setPictures(saved); }
      closeTile();
    }} onDelete={() => { setTiles(board.tiles.filter(t => t.id !== editing.id)); closeTile(); }} onDuplicate={tile => { setTiles([...board.tiles, { ...tile, id: Crypto.randomUUID() }]); closeTile(); }} />}
    {pictures && <BoardPictures board={pictures} currentRevision={board.revision} automatic={automaticPictures} changedTileId={pictureTarget} settings={settings} onConsent={onConsent} onApply={(draft, revision) => { if (board.revision === revision) onChange({ tiles: draft.tiles, picturePolicy: draft.picturePolicy }); }} onClose={() => setPictures(null)} />}
    {deleting && <Confirm title={`Delete ${board.title}?`} message="This board is stored only on this device. Deleting it cannot be undone." confirmLabel="Delete board" danger onConfirm={onDelete} onClose={() => setDeleting(false)} />}
  </KeyboardAvoidingView>;
}
