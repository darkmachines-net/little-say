/** @file Groups manual Accept/Add Card controls beside AI composition, with Undo/Redo, quiet saved state, and bounded keyboard layout. */

import { useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions, type ViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Copy, Languages, Plus, Redo2, Settings as SettingsIcon, Trash2, Undo2 } from 'lucide-react-native';
import * as Crypto from 'expo-crypto';
import { MAX_TILES, colors, gridLayout, hasTileLanguage, newTileLanguage, selectedBoardLanguage, tileInLanguage, tileSchema, type BoardChanges, type Board, type Settings, type Tile, type CreationDraft, type BoardSuggestion } from '@little-say/core';
import { AppHeader } from './AppHeader';
import { BoardLanguages } from './BoardLanguages';
import { BoardAudio } from './BoardAudio';
import { TileFace } from './TileFace';
import { TileEditor } from './TileEditor';
import { Button, Confirm, Notice, Sheet } from './components';
import { styles, theme } from './theme';
import { type SpeechLibrary } from '../services/speechLibrary';
import type { BoardTranslationStatus } from '../services/useBoardTranslations';
import { BoardPictures } from './BoardPictures';
import { BoardTransition, type BoardGeometry, type BoardSnapshot } from './BoardTransition';
import { BoardAssistant } from './BoardAssistant';
import { useBoardAssistant } from '../services/useBoardAssistant';

/**
 * Keep manual edits and streamed AI previews on one canvas. New cards reserve picture space while
 * their words are ready and artwork is pending; replacements fade existing pictures under a centered indicator. Each completed or stopped AI turn saves
 * automatically through the parent's shared Undo/Redo history; only conflicts and failed writes need action.
 * Both history actions stay disabled during AI work, unresolved previews, playback startup, and dialogs.
 * The route heading is Create for unfinished drafts and Edit for saved boards to leave room for toolbar actions.
 * The canvas uses the first effective board/profile language; language variants are selected inside each
 * tile editor. Pictures, languages, audio, and board management live behind the toolbar settings gear.
 * Closing language choices starts app-owned translation work; shared preferences return to this board.
 * Accept and Add Card share a manual-edit section above the AI composer. Accept flushes edits before
 * opening the board for play; empty boards and unresolved AI previews cannot be accepted.
 * Add Card stays available at capacity and explains the limit only when another card is requested.
 * Saved boards show no idle status; only pending saves, write failures, and unsaved AI previews are announced.
 * Tile and translation saves pass expectedRevision to onChange; the parent must throw on a
 * revision mismatch. The save error keeps the editor draft open instead of applying stale changes.
 * The app root owns all safe-area insets. Keyboard padding consumes only overlap with that inset
 * viewport on both native platforms, including Android windows that already resize for the IME.
 * Toolbar and composer are outside scrolling content; only the canvas and bounded AI context scroll.
 * Typing collapses secondary chrome without remounting the input or caching a screen-height baseline.
 */
export function BoardEditor({ board: savedBoard, settings, audio, translationStatus, onPrepareTranslations, onCancelTranslations, onManageLanguages, draft, onDraft, onSaveDraft, onDiscardDraft, onBeforeClose, onAccept, onStopPreview, onBack, onChange: saveChanges, onPlay, onDelete, onDuplicate, onConsent, onUndo, canUndo, onRedo, canRedo, onPreview, saving, saveError, startingPlay, returnToPlay, transition, onTransitionDone }: { board: Board; settings: Settings; audio: SpeechLibrary; translationStatus?: BoardTranslationStatus; draft?: CreationDraft;
  /** Prepare missing words for the saved board through the app-owned translation job. */
  onPrepareTranslations: () => void;
  /** Cancel only this board's translation job. */
  onCancelTranslations: () => void;
  /** Open shared language preferences and return to the current board afterward. */
  onManageLanguages: () => void;
  /** Update creation progress in memory without persisting unsaved input. */
  onDraft: (state: Pick<CreationDraft, 'prompt' | 'suggestion' | 'history' | 'reply'>) => void;
  /** Persist an explicitly retained creation session; reject to keep the exit dialog open. */
  onSaveDraft: (snapshot: CreationDraft) => Promise<void>;
  /** Remove any previously saved creation session; reject to allow retry. */
  onDiscardDraft: () => Promise<void>;
  /** Register the browser-exit guard, or clear it on promotion and unmount. */
  onBeforeClose: (request: (() => void) | null) => void;
  /** Apply an AI turn against the latest saved board and record a normal Undo step. */
  onAccept: (suggestion: BoardSuggestion, choice?: 'current' | 'suggested') => Promise<void>;
  /** Restore the preceding board snapshot, retaining the current board for Redo. */
  onUndo: () => void;
  /** Restore the next undone snapshot without starting a new history branch. */
  onRedo: () => void;
  canUndo: boolean; canRedo: boolean;
  onStopPreview: () => void; onBack: () => void; onChange: (changes: BoardChanges, expectedRevision?: number) => Board; onPlay: () => void; onDelete: () => void; onDuplicate: () => void; onConsent: () => Promise<void>; onPreview: (tile: Tile) => void; saving: boolean; saveError?: string; startingPlay: boolean; returnToPlay: boolean; transition: BoardSnapshot | null; onTransitionDone: () => void }) {
  const assistant = useBoardAssistant({ board: savedBoard, settings, draft, onDraft, onAccept, onConsent, onSpeechReady: () => audio.reload() });
  const board = assistant.preview;
  const onChange = (changes: BoardChanges, revision?: number) => {
    if (revision !== undefined && revision !== board.revision) throw new Error('This board changed while you were editing. Close and reopen these controls before saving.');
    return assistant.suggestion ? assistant.edit(changes) : saveChanges(changes, revision);
  };
  const { width, height } = useWindowDimensions();
  const { top: safeAreaTop } = useSafeAreaInsets();
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState('');
  const exitWriting = useRef(false);
  const [area, setArea] = useState({ width: 600, height: 400 });
  const [contentHeight, setContentHeight] = useState(400);
  const [promptFocused, setPromptFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  const wide = width >= 900 || (width >= 600 && height < 600);
  const short = height < 600;
  const typing = promptFocused && (keyboardVisible || short);
  const blocked = startingPlay || assistant.busy === 'save';
  const historyBlocked = Boolean(assistant.busy || assistant.suggestion);
  const undo = () => { assistant.clear(); onUndo(); };
  const redo = () => { assistant.clear(); onRedo(); };
  const back = () => {
    if (blocked || exitWriting.current || leaving) return;
    void assistant.stop().then(saved => {
      if (!saved) return;
      if (draft && !board.tiles.length) {
        Keyboard.dismiss(); onStopPreview(); setEditing(null); setAdding(false); setSettingsOpen(false); setLanguagesOpen(false); setPictures(null); setLimitOpen(false); setDeleting(false);
        setExitError(''); setLeaving(true);
      }
      else { onBeforeClose(null); onBack(); }
    });
  };
  const finishCreation = async (save: boolean) => {
    if (exitWriting.current) return;
    exitWriting.current = true; setExitBusy(true); setExitError('');
    try {
      if (save) await onSaveDraft({ board, prompt: assistant.prompt, suggestion: assistant.suggestion, history: assistant.history, reply: assistant.reply });
      else await onDiscardDraft();
      onBeforeClose(null); onBack();
    } catch { setExitError(`Your draft could not be ${save ? 'saved' : 'discarded'}. Please try again.`); }
    finally { exitWriting.current = false; setExitBusy(false); }
  };
  const keepEditing = () => { if (!exitWriting.current) { setLeaving(false); setExitError(''); } };
  const hasProgress = Boolean(assistant.prompt.trim() || assistant.history.length || assistant.suggestion || board.title !== 'New board');
  const finishEditing = () => { void assistant.stop().then(saved => { if (saved) onPlay(); }); };
  const backRef = useRef(back); backRef.current = back;
  const creating = Boolean(draft);
  useEffect(() => { onBeforeClose(creating ? () => backRef.current() : null); return () => onBeforeClose(null); }, [creating, onBeforeClose]);
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
    const tile: Tile = { id: Crypto.randomUUID(), label: '', speech: '', language, languageMode: 'board', color: colors[board.tiles.length % colors.length], illustration: { kind: 'emoji', emoji: '➕' } };
    setAdding(true); setEditing(tile);
  };
  const layout = gridLayout(board.tiles.length, Math.max(44, area.width - 24), Math.max(1, area.height - 24), 8,
    { minHeight: 64, maxWidth: 164, maxHeight: 148, scroll: true });
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
  const modalOpen = Boolean(editing || limitOpen || settingsOpen || languagesOpen || pictures || deleting || leaving);
  const playLanguage = selectedBoardLanguage(board, settings);
  const untranslated = playLanguage ? board.tiles.filter(tile => tile.languageMode === 'board' && !hasTileLanguage(tile, playLanguage)).length : 0;
  const saveStatus = saving ? 'Saving…' : saveError ? 'Not saved — retry saving' : assistant.suggestion ? 'AI changes not saved' : '';
  return <KeyboardAvoidingView testID="board-workspace" behavior={Platform.OS === 'web' ? undefined : 'padding'} keyboardVerticalOffset={Platform.OS === 'web' ? 0 : safeAreaTop} style={styles.page}>
    <AppHeader title={draft ? 'Create' : 'Edit'} onBack={back} backLabel="Boards" backDisabled={blocked || modalOpen} actions={typing ? undefined : <>
      <Button kind="ghost" compact icon={Undo2} accessibilityLabel="Undo last board change" disabled={blocked || historyBlocked || !canUndo || modalOpen} onPress={undo} />
      <Button kind="ghost" compact icon={Redo2} accessibilityLabel="Redo last board change" disabled={blocked || historyBlocked || !canRedo || modalOpen} onPress={redo} />
      <Button kind="ghost" compact icon={SettingsIcon} accessibilityLabel="Board settings" disabled={blocked || modalOpen} onPress={() => setSettingsOpen(true)} />
    </>} />
    <View style={[styles.container, { flex: 1, minHeight: 0, paddingTop: typing ? 8 : 14, paddingBottom: typing ? 8 : 16, gap: typing ? 8 : 14 }]}>
      {!typing && <View testID="editor-heading" style={{ gap: 4 }}><TextInput accessibilityLabel="Board title" editable={!blocked} value={title} maxLength={100} onChangeText={value => { setTitle(value); if (value.trim()) onChange({ title: value }); }} onBlur={() => { if (!title.trim()) setTitle(board.title); }} style={{ color: theme.ink, fontSize: width < 600 ? 24 : 30, fontWeight: '800', paddingVertical: 4 }} />{Boolean(saveStatus) && <Text testID="board-save-status" accessibilityLiveRegion="polite" style={styles.small}>{saveStatus}</Text>}</View>}
      {!typing && translationStatus?.busy && <View style={[styles.row, { justifyContent: 'space-between' }]}><Text accessibilityLiveRegion="polite" style={styles.body}>Adding missing translations…</Text><Button kind="ghost" compact onPress={onCancelTranslations}>Cancel translations</Button></View>}
      {!typing && translationStatus?.error && <Notice action={<Button kind="secondary" onPress={onPrepareTranslations}>Retry translations</Button>}>{translationStatus.error}</Notice>}
      {!typing && returnToPlay && untranslated > 0 && !translationStatus?.busy && <Notice>{untranslated} cards still use their original words. Close Languages in Board settings to fill missing translations, or review saved words in each card.</Notice>}
      <View testID="editor-content" onLayout={event => setContentHeight(event.nativeEvent.layout.height)} style={{ flex: 1, minHeight: 0, flexDirection: wide ? 'row' : 'column', gap: typing ? 8 : 14 }}>
        <View testID="editor-preview" onLayout={event => setArea(event.nativeEvent.layout)} style={{ flex: 1, minWidth: 0, minHeight: 0, borderRadius: typing ? 14 : 22, backgroundColor: theme.surface, overflow: 'hidden' }}>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, minHeight: 0, opacity: transition ? 0 : 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 12 }}>
            {!board.tiles.length && <Text style={styles.body}>Add a card or describe a board below.</Text>}
            <View ref={previewGrid} collapsable={false} onLayout={() => { if (transition) previewGrid.current?.measureInWindow((x, y, width, height) => setTarget({ x, y, width, height, rects: layout.rects.map((rect, i) => ({ ...rect, id: board.tiles[i].id })) })); }} style={{ width: layout.width, height: layout.height }}>
              {board.tiles.map((tile, index) => { const rect = layout.rects[index]; const shown = tileInLanguage(tile, primaryLanguage); const missing = primaryLanguage && tile.languageMode === 'board' && !hasTileLanguage(tile, primaryLanguage); const changed = assistant.suggestion && JSON.stringify(savedBoard.tiles.find(t => t.id === tile.id)) !== JSON.stringify(tile); const pictureState = assistant.states[tile.id]; return rect && <Pressable key={tile.id} accessibilityRole="button" accessibilityLabel={`Edit tile ${shown.label}${changed ? ', suggested change' : ''}${missing ? ', translation needs attention' : ''}`} disabled={blocked} onPress={() => { setAdding(false); setEditing(tile); }} style={({ pressed }) => ({ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height, opacity: pressed ? 0.75 : 1, borderWidth: changed ? 2 : 0, borderColor: theme.accent, borderStyle: changed ? 'dashed' : 'solid', borderRadius: 18 })}><TileFace tile={shown} compact pictureState={pictureState} picturePending={Boolean(pictureState && pictureState !== 'ready' && pictureState !== 'fallback' && tile.illustration.kind === 'emoji' && !savedBoard.tiles.some(saved => saved.id === tile.id))} size={Math.min(64, rect.height * 0.43)} />{missing ? <Text style={{ ...styles.small, position: 'absolute', bottom: 2, alignSelf: 'center', backgroundColor: theme.surface }}>Needs translation</Text> : null}</Pressable>; })}
            </View>
          </ScrollView>
        </View>
        <View testID="editor-actions" style={{ width: wide ? 280 : '100%', flexShrink: 0, minHeight: 0, gap: typing ? 0 : 12 }}>
          {!typing && <View testID="manual-edit-controls" style={{ backgroundColor: theme.surface, borderRadius: 18, borderWidth: 1, borderColor: theme.line, padding: 12 }}>
            <View style={[styles.row, { gap: 8 }]}>
              <View style={{ flex: 1 }}><Button compact kind="secondary" icon={Plus} disabled={blocked || modalOpen} onPress={addTile}>Add Card</Button></View>
              <View style={{ flex: 1 }}><Button compact icon={Check} disabled={modalOpen || !savedBoard.tiles.length || Boolean(assistant.suggestion)} busy={blocked} onPress={finishEditing}>Accept</Button></View>
            </View>
          </View>}
          <BoardAssistant assistant={assistant} disabled={blocked || modalOpen} compact={typing} maxHeight={Math.max(96, wide ? contentHeight - (typing ? 0 : 88) : contentHeight * 0.5)} onFocusChange={setPromptFocused} />
        </View>
      </View>
    </View>
    {transition && <BoardTransition source={transition} target={target} onDone={onTransitionDone} />}
    {leaving && <Sheet title="Save your draft?" onClose={keepEditing} footer={<>
      <Button disabled={exitBusy || !hasProgress} onPress={() => finishCreation(true)}>Save draft</Button>
      <Button kind="danger" disabled={exitBusy} onPress={() => finishCreation(false)}>Discard</Button>
      <Button kind="ghost" disabled={exitBusy} onPress={keepEditing}>Keep editing</Button>
    </>}><Text style={styles.body}>Save this unfinished draft to continue later, or discard it.</Text>{Boolean(exitError) && <Notice>{exitError}</Notice>}</Sheet>}
    {limitOpen && <Sheet title="Board is full" onClose={() => setLimitOpen(false)} footer={<Button onPress={() => setLimitOpen(false)}>Got it</Button>}><Text style={styles.body}>{limitMessage}</Text></Sheet>}
    {settingsOpen && <Sheet title="Board settings" onClose={() => setSettingsOpen(false)}>
      <Button kind="secondary" icon={Languages} disabled={blocked || !board.tiles.length} onPress={() => { setSettingsOpen(false); setLanguagesOpen(true); }}>Languages</Button>
      <Button kind="secondary" disabled={blocked || Boolean(assistant.suggestion)} onPress={() => { setSettingsOpen(false); setAutomaticPictures(false); setPictureTarget(undefined); setPictures(board); }}>Pictures</Button>
      <BoardAudio board={board} settings={settings} audio={audio} disabled={blocked} />
      <View style={{ gap: 8 }}><Button kind="ghost" icon={Copy} disabled={blocked || !savedBoard.tiles.length || Boolean(assistant.suggestion)} onPress={() => { setSettingsOpen(false); onDuplicate(); }}>Duplicate board</Button><Button kind="danger" icon={Trash2} disabled={blocked} onPress={() => { setSettingsOpen(false); setDeleting(true); }}>Delete board</Button></View>
    </Sheet>}
    {languagesOpen && <BoardLanguages board={board} settings={settings} onChange={onChange} onManageLanguages={() => { setLanguagesOpen(false); onPrepareTranslations(); onStopPreview(); onManageLanguages(); }} onClose={() => { setLanguagesOpen(false); onPrepareTranslations(); }} />}
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
