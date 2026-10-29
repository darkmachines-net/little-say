/** @file Unifies empty-board creation, direct card edits, compact AI suggestions, media, and playback. */

import { useEffect, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions, type ViewInstance } from 'react-native';
import { ChevronLeft, Copy, Languages, Play, Plus, Trash2, Undo2, Volume2 } from 'lucide-react-native';
import * as Crypto from 'expo-crypto';
import { MAX_TILES, speechSource, boardAudioTiles, canonicalLanguage, colors, gridLayout, hasTileLanguage, newTileLanguage, selectedBoardLanguage, tileInLanguage, tileSchema, type BoardChanges, type Board, type Settings, type Tile, type CreationDraft, type BoardSuggestion } from '@little-say/core';
import { BoardLanguages } from './BoardLanguages';
import { TileFace } from './TileFace';
import { TileEditor } from './TileEditor';
import { Button, Confirm, Notice } from './components';
import { styles, theme } from './theme';
import { type SpeechLibrary } from '../services/speechLibrary';
import { BoardPictures } from './BoardPictures';
import { BoardTransition, type BoardGeometry, type BoardSnapshot } from './BoardTransition';
import { useScreenFocus } from './screenFocus';
import { EditingLanguages } from './EditingLanguages';
import { PictureStatus } from './PictureStatus';
import { BoardAssistant } from './BoardAssistant';
import { useBoardAssistant } from '../services/useBoardAssistant';

/**
 * Keep manual edits and AI previews on one canvas. Pending AI edits stay staged until Keep changes;
 * accepted manual edits, undo, and durable suggestion commits belong to the parent.
 * Tile and translation saves pass expectedRevision to onChange; the parent must throw on a
 * revision mismatch. The save error keeps the editor draft open instead of applying stale changes.
 */
export function BoardEditor({ board: savedBoard, settings, audio, draft, onDraft, onAccept, onStopPreview, onBack, onChange: saveChanges, onPlay, onDelete, onDuplicate, onConsent, onUndo, canUndo, onPreview, saving, saveError, startingPlay, returnToPlay, transition, onTransitionDone }: { board: Board; settings: Settings; audio: SpeechLibrary; draft?: CreationDraft;
  /** Persist the local creation session while it remains outside the playable library. */
  onDraft: (state: Pick<CreationDraft, 'prompt' | 'suggestion'>) => void;
  /** Save a reviewed suggestion against the latest accepted board. */
  onAccept: (suggestion: BoardSuggestion, choice?: 'current' | 'suggested') => Promise<void>;
  onStopPreview: () => void; onBack: () => void; onChange: (changes: BoardChanges, expectedRevision?: number) => Board; onPlay: () => void; onDelete: () => void; onDuplicate: () => void; onConsent: () => Promise<void>; onUndo: () => void; canUndo: boolean; onPreview: (tile: Tile) => void; saving: boolean; saveError?: string; startingPlay: boolean; returnToPlay: boolean; transition: BoardSnapshot | null; onTransitionDone: () => void }) {
  const assistant = useBoardAssistant({ board: savedBoard, settings, draft, onDraft, onAccept, onConsent, onSpeechReady: () => audio.reload() });
  const board = assistant.preview;
  const onChange = (changes: BoardChanges, revision?: number) => {
    if (revision !== undefined && revision !== board.revision) throw new Error('This board changed while you were editing. Close and reopen these controls before saving.');
    return assistant.suggestion ? assistant.edit(changes) : saveChanges(changes, revision);
  };
  const { width, height } = useWindowDimensions();
  const heading = useScreenFocus();
  const previewGrid = useRef<ViewInstance>(null);
  const [target, setTarget] = useState<BoardGeometry | null>(null);
  const [editing, setEditing] = useState<Tile | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingLanguage, setEditingLanguage] = useState<string | null>(() => selectedBoardLanguage(board, settings));
  const [title, setTitle] = useState(board.title);
  const [deleting, setDeleting] = useState(false);
  const [languagesOpen, setLanguagesOpen] = useState(false);
  const [pictures, setPictures] = useState<Board | null>(null);
  const [automaticPictures, setAutomaticPictures] = useState(false);
  const [pictureTarget, setPictureTarget] = useState<string | undefined>();
  const [audioError, setAudioError] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [area, setArea] = useState({ width: 600, height: 400 });
  const [contentHeight, setContentHeight] = useState(400);
  const [actionsHeight, setActionsHeight] = useState(280);
  const wide = width >= 900;
  const short = height < 600;
  const blocked = startingPlay || assistant.busy === 'save';
  const back = () => { if (!blocked) { assistant.stop(); onBack(); } };
  const backRef = useRef(back); backRef.current = back;
  useEffect(() => { const listener = BackHandler.addEventListener('hardwareBackPress', () => { backRef.current(); return true; }); return () => listener.remove(); }, []);
  useEffect(() => { setTitle(board.title); }, [board.title]);
  useEffect(() => {
    if (editingLanguage && !board.playLanguages?.some(tag => canonicalLanguage(tag) === canonicalLanguage(editingLanguage))) { onStopPreview(); setEditingLanguage(null); }
  }, [board.playLanguages, editingLanguage, onStopPreview]);
  const setTiles = (tiles: Tile[]) => onChange({ tiles }, board.revision);
  const addTile = () => {
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
  const modalOpen = Boolean(editing || languagesOpen || pictures || deleting);
  const playLanguage = selectedBoardLanguage(board, settings);
  const untranslated = playLanguage ? board.tiles.filter(tile => tile.languageMode === 'board' && !hasTileLanguage(tile, playLanguage)).length : 0;
  const selectLanguage = (language: string | null) => { onStopPreview(); setEditingLanguage(language); };
  return <KeyboardAvoidingView testID="board-workspace" behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined} style={styles.page}>
    <View style={{ backgroundColor: theme.surface, borderBottomWidth: 1, borderColor: theme.line }}><View style={[styles.container, styles.row, { justifyContent: 'space-between', paddingVertical: 10, gap: 6 }]}>
      <Button kind="ghost" compact={width < 600} icon={ChevronLeft} disabled={blocked || modalOpen} onPress={back}>Boards</Button>
      <View style={[styles.row, { gap: 6 }]}><Button kind="ghost" compact icon={Undo2} accessibilityLabel="Undo last board change" disabled={blocked || !canUndo || modalOpen} onPress={() => { assistant.clear(); onUndo(); }} /><Button kind="secondary" compact={width < 600} icon={Languages} accessibilityLabel="Languages" disabled={blocked || !board.tiles.length} onPress={() => setLanguagesOpen(true)}>{width >= 600 ? 'Languages' : undefined}</Button><Button icon={Play} compact={width < 600} disabled={modalOpen || !savedBoard.tiles.length || Boolean(assistant.suggestion)} busy={blocked} onPress={() => { assistant.stop(); onPlay(); }}>{returnToPlay ? 'Return to play' : 'Play board'}</Button></View>
    </View></View>
    <View style={[styles.container, { flex: 1, minHeight: 0, paddingTop: 14, paddingBottom: 16, gap: 14 }]}>
      <View ref={heading} testID="editor-heading" accessibilityRole="header" accessibilityLabel="Board editor" tabIndex={-1} style={{ gap: 4 }}><TextInput accessibilityLabel="Board title" editable={!blocked} value={title} maxLength={100} onChangeText={value => { setTitle(value); if (value.trim()) onChange({ title: value }); }} onBlur={() => { if (!title.trim()) setTitle(board.title); }} style={{ color: theme.ink, fontSize: width < 600 ? 24 : 30, fontWeight: '800', paddingVertical: 4 }} /><View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.small}>{board.tiles.length} / 24</Text><Text style={styles.small}>{saving ? 'Saving…' : saveError ? 'Not saved — retry saving' : assistant.suggestion ? 'AI suggestion' : draft ? 'Draft saved' : 'Saved on this device'}</Text></View></View>
      {returnToPlay && untranslated > 0 && <Notice>{untranslated} switchable cards still use their original words. Prepare missing translations in Languages.</Notice>}
      {Boolean(board.playLanguages?.length) && <EditingLanguages languages={board.playLanguages ?? []} selected={editingLanguage} onChange={selectLanguage} disabled={startingPlay || modalOpen} />}
      <ScrollView keyboardShouldPersistTaps="handled" onLayout={event => setContentHeight(event.nativeEvent.layout.height)} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, flexDirection: wide ? 'row' : 'column', gap: 14 }}>
        <View testID="editor-preview" onLayout={event => setArea(event.nativeEvent.layout)} style={{ flex: wide ? 1 : undefined, height: wide ? Math.max(180, contentHeight) : Math.max(short ? 200 : 180, contentHeight - actionsHeight - 14), borderRadius: 22, backgroundColor: theme.surface, overflow: 'hidden' }}>
          <ScrollView style={{ opacity: transition ? 0 : 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 12 }}>
            {!board.tiles.length && <Text style={styles.body}>Add a card or describe a board below.</Text>}
            <View ref={previewGrid} collapsable={false} onLayout={() => { if (transition) previewGrid.current?.measureInWindow((x, y, width, height) => setTarget({ x, y, width, height, rects: layout.rects.map((rect, i) => ({ ...rect, id: board.tiles[i].id })) })); }} style={{ width: layout.width, height: layout.height }}>
              {board.tiles.map((tile, index) => { const rect = layout.rects[index]; const shown = tileInLanguage(tile, editingLanguage); const missing = editingLanguage && tile.languageMode === 'board' && !hasTileLanguage(tile, editingLanguage); const changed = assistant.suggestion && JSON.stringify(savedBoard.tiles.find(t => t.id === tile.id)) !== JSON.stringify(tile); const pictureState = assistant.states[tile.id]; return rect && <Pressable key={tile.id} accessibilityRole="button" accessibilityLabel={`Edit tile ${shown.label}${changed ? ', suggested change' : ''}${missing ? ', translation needs attention' : ''}`} disabled={blocked} onPress={() => { setAdding(false); setEditing(tile); }} style={({ pressed }) => ({ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height, opacity: pressed ? 0.75 : 1, borderWidth: changed ? 2 : 0, borderColor: theme.accent, borderStyle: changed ? 'dashed' : 'solid', borderRadius: 18 })}><TileFace tile={shown} compact size={Math.min(64, rect.height * 0.43)} />{pictureState ? <PictureStatus state={pictureState} /> : missing ? <Text style={{ ...styles.small, position: 'absolute', bottom: 2, alignSelf: 'center', backgroundColor: theme.surface }}>Needs translation</Text> : null}</Pressable>; })}
            </View>
          </ScrollView>
        </View>
        <View testID="editor-actions" onLayout={event => setActionsHeight(event.nativeEvent.layout.height)} style={{ width: wide ? 280 : '100%', gap: 12 }}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>{board.tiles.length < MAX_TILES && <Button kind="secondary" icon={Plus} disabled={blocked} onPress={addTile}>Add card</Button>}<Button compact kind="ghost" onPress={() => setMoreOpen(value => !value)}>Board options</Button></View>
          <BoardAssistant assistant={assistant} disabled={blocked || modalOpen} />
          {moreOpen && <>
          <Button kind="secondary" disabled={blocked} onPress={() => { assistant.stop(); setAutomaticPictures(false); setPictureTarget(undefined); setPictures(board); }}>Pictures</Button>
          {audioTiles.length > 0 && <View style={{ backgroundColor: theme.surface, padding: 14, borderRadius: 18, gap: 8 }}>
            <Text accessibilityLiveRegion="polite" style={styles.small}>{readyAudio} of {audioTiles.length} voices saved{preparingAudio ? ` · Preparing ${preparingAudio}…` : ''}{failedAudio ? ` · ${failedAudio} failed. Check your connection and retry.` : ''}</Text>
            <Button kind="secondary" icon={Volume2} disabled={startingPlay || !missingAudio.length} onPress={() => { setAudioError(''); void (async () => { await Promise.allSettled(missingAudio.map(tile => audio.generate(tile, settings.backendUrl))); })().catch(() => setAudioError('Could not prepare audio. Check storage and try again.')); }}>{missingAudio.length ? `${failedAudio ? 'Retry' : 'Prepare'} missing audio (${missingAudio.length})` : preparingAudio ? 'Preparing audio…' : 'All audio saved'}</Button>
            {Boolean(audioError) && <Notice>{audioError}</Notice>}
          </View>}
          <View style={{ flexDirection: wide ? 'column' : 'row', justifyContent: 'space-between', gap: 8, ...(wide ? { marginTop: 'auto' } : {}) }}><Button kind="ghost" icon={Copy} disabled={blocked || !savedBoard.tiles.length || Boolean(assistant.suggestion)} onPress={onDuplicate}>Duplicate board</Button><Button kind="danger" icon={Trash2} disabled={blocked} onPress={() => setDeleting(true)}>Delete board</Button></View>
          </>}
        </View>
      </ScrollView>
    </View>
    {transition && <BoardTransition source={transition} target={target} onDone={onTransitionDone} />}
    {languagesOpen && <BoardLanguages board={board} settings={settings} onChange={onChange} onConsent={onConsent} onClose={() => setLanguagesOpen(false)} />}
    {editing && <TileEditor key={editing.id} board={board} tile={editing} editingLanguage={editingLanguage} onEditingLanguage={selectLanguage} onStopPreview={onStopPreview} position={adding ? undefined : editingIndex} tileCount={board.tiles.length} onMove={adding ? undefined : reorder} playLanguages={board.playLanguages} settings={settings} audio={audio} onConsent={onConsent} canDelete={!adding && board.tiles.length > 1} canDuplicate={!adding && board.tiles.length < MAX_TILES} onClose={closeTile} onPreview={onPreview} onAskAi={adding ? undefined : tile => { assertCurrentTile(tile); setTiles(board.tiles.map(current => current.id === tile.id ? tile : current)); assistant.setScope(tile.id); closeTile(); }} onSave={tile => {
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
