/** @file Composes the compact board editor and its tile, language, AI, and audio actions. */

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ChevronLeft, Copy, Languages, Play, Plus, Trash2, Undo2, Volume2, WandSparkles } from 'lucide-react-native';
import * as Crypto from 'expo-crypto';
import { MAX_TILES, boardAudioTiles, colors, firstWord, gridLayout, newTileLanguage, type BoardChanges, type Board, type Settings, type Tile } from '@little-say/core';
import { BoardLanguages } from './BoardLanguages';
import { TileFace } from './TileFace';
import { TileEditor } from './TileEditor';
import { Button, Confirm, Notice } from './components';
import { styles, theme } from './theme';
import { type SpeechLibrary } from '../services/speechLibrary';
import { BoardPictures } from './BoardPictures';

/**
 * Show the editable board preview and contextual controls, delegating durable changes, undo, and
 * playback to the parent.
 */
export function BoardEditor({ board, settings, audio, onStopPreview, onBack, onChange, onPlay, onDelete, onDuplicate, onCompose, onConsent, onUndo, canUndo, onPreview, saving }: { board: Board; settings: Settings; audio: SpeechLibrary; onStopPreview: () => void; onBack: () => void; onChange: (changes: BoardChanges) => Board; onPlay: () => void; onDelete: () => void; onDuplicate: () => void; onCompose: () => void; onConsent: () => Promise<void>; onUndo: () => void; canUndo: boolean; onPreview: (tile: Tile) => void; saving: boolean }) {
  const { width } = useWindowDimensions();
  const [editing, setEditing] = useState<Tile | null>(null);
  const [title, setTitle] = useState(board.title);
  const [deleting, setDeleting] = useState(false);
  const [languagesOpen, setLanguagesOpen] = useState(false);
  const [pictures, setPictures] = useState<Board | null>(null);
  const [automaticPictures, setAutomaticPictures] = useState(false);
  const [pictureTarget, setPictureTarget] = useState<string | undefined>();
  const [audioError, setAudioError] = useState('');
  const [area, setArea] = useState({ width: 600, height: 400 });
  const wide = width >= 900;
  useEffect(() => { setTitle(board.title); }, [board.title]);
  const setTiles = (tiles: Tile[]) => onChange({ tiles });
  const addTile = () => {
    const language = newTileLanguage(board, settings);
    const word = firstWord(language);
    const tile: Tile = { id: Crypto.randomUUID(), label: word.label, speech: word.speech, language, languageMode: board.playLanguages?.length ? 'board' : 'fixed', color: colors[board.tiles.length % colors.length], illustration: { kind: 'emoji', emoji: word.emoji } };
    setTiles([...board.tiles, tile]); setEditing(tile);
  };
  const layout = gridLayout(board.tiles.length, Math.max(100, area.width - 24), Math.max(100, area.height - 24), 8);
  const cellWidth = Math.max(44, Math.min(164, layout.width));
  const cellHeight = Math.max(64, Math.min(148, layout.height));
  const audioTiles = boardAudioTiles(board);
  const readyAudio = audioTiles.filter(tile => audio.asset(tile)).length;
  const preparingAudio = audioTiles.filter(tile => audio.status(tile).state === 'preparing').length;
  const failedAudio = audioTiles.filter(tile => audio.status(tile).state === 'error' && !audio.asset(tile)).length;
  const missingAudio = audioTiles.filter(tile => !audio.asset(tile) && audio.status(tile).state !== 'preparing');
  const closeTile = () => { onStopPreview(); setEditing(null); };
  const editingIndex = board.tiles.findIndex(t => t.id === editing?.id);
  const reorder = (offset: number) => {
    if (editingIndex < 0 || editingIndex + offset < 0 || editingIndex + offset >= board.tiles.length) return;
    const next = [...board.tiles]; [next[editingIndex], next[editingIndex + offset]] = [next[editingIndex + offset], next[editingIndex]]; setTiles(next);
  };
  return <View style={styles.page}>
    <View style={{ backgroundColor: theme.surface, borderBottomWidth: 1, borderColor: theme.line }}><View style={[styles.container, styles.row, { justifyContent: 'space-between', paddingVertical: 10, gap: 6 }]}>
      <Button kind="ghost" compact={width < 600} icon={ChevronLeft} onPress={onBack}>Boards</Button>
      <View style={[styles.row, { gap: 6 }]}><Button kind="ghost" compact icon={Undo2} accessibilityLabel="Undo last board change" disabled={!canUndo} onPress={onUndo} /><Button kind="secondary" compact={width < 600} icon={Languages} accessibilityLabel="Languages" onPress={() => setLanguagesOpen(true)}>{width >= 600 ? 'Languages' : undefined}</Button><Button icon={Play} compact={width < 600} onPress={onPlay}>Play board</Button></View>
    </View></View>
    <View style={[styles.container, { flex: 1, minHeight: 0, paddingTop: 14, paddingBottom: 16, gap: 14 }]}>
      <View style={{ gap: 4 }}><TextInput accessibilityLabel="Board title" value={title} maxLength={100} onChangeText={value => { setTitle(value); if (value.trim()) onChange({ title: value }); }} onBlur={() => { if (!title.trim()) setTitle(board.title); }} style={{ color: theme.ink, fontSize: width < 600 ? 24 : 30, fontWeight: '800', paddingVertical: 4, borderBottomWidth: 1, borderColor: theme.line }} /><View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.small}>{board.tiles.length} / 24 tiles · tap to edit</Text><Text style={styles.small}>{saving ? 'Saving…' : 'Saved on this device'}</Text></View></View>
      <View style={{ flex: 1, minHeight: 0, flexDirection: wide ? 'row' : 'column', gap: 14 }}>
        <View testID="editor-preview" onLayout={event => setArea(event.nativeEvent.layout)} style={{ flex: 1, minHeight: 80, borderRadius: 22, backgroundColor: theme.surface, overflow: 'hidden' }}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 12 }}>
            <View style={{ width: layout.columns * cellWidth + (layout.columns - 1) * 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {board.tiles.map(tile => <Pressable key={tile.id} accessibilityRole="button" accessibilityLabel={`Edit tile ${tile.label}`} onPress={() => setEditing(tile)} style={({ pressed }) => ({ width: cellWidth, height: cellHeight, opacity: pressed ? 0.75 : 1 })}><TileFace tile={tile} compact size={Math.min(64, cellHeight * 0.43)} /></Pressable>)}
            </View>
          </ScrollView>
        </View>
        <View testID="editor-actions" style={{ width: wide ? 280 : '100%', gap: 12 }}>
          <Button kind="secondary" onPress={() => { setAutomaticPictures(false); setPictureTarget(undefined); setPictures(board); }}>Pictures</Button>
          <View style={{ flexDirection: wide ? 'column' : 'row', gap: 10 }}><View style={{ flex: wide ? undefined : 1 }}><Button icon={WandSparkles} onPress={() => { onStopPreview(); onCompose(); }}>Edit with AI</Button></View>{board.tiles.length < MAX_TILES && <View style={{ flex: wide ? undefined : 1 }}><Button kind="secondary" icon={Plus} onPress={addTile}>Add a tile</Button></View>}</View>
          <View style={{ backgroundColor: theme.surface, padding: 14, borderRadius: 18, gap: 8 }}>
            <Text accessibilityLiveRegion="polite" style={styles.small}>{readyAudio} of {audioTiles.length} voices saved{preparingAudio ? ` · Preparing ${preparingAudio}…` : ''}{failedAudio ? ` · ${failedAudio} failed. Check your connection and retry.` : ''}</Text>
            {!settings.aiConsent && <Text style={styles.small}>Words go to OpenAI. Audio is saved for offline play.</Text>}
            <Button kind="secondary" icon={Volume2} disabled={!missingAudio.length} onPress={() => { setAudioError(''); void (async () => { if (!settings.aiConsent) await onConsent(); await Promise.allSettled(missingAudio.map(tile => audio.generate(tile, settings.backendUrl))); })().catch(() => setAudioError('Could not prepare audio. Check storage and try again.')); }}>{missingAudio.length ? `${failedAudio ? 'Retry' : 'Prepare'} missing audio (${missingAudio.length})` : preparingAudio ? 'Preparing audio…' : 'All audio saved'}</Button>
            {Boolean(audioError) && <Notice>{audioError}</Notice>}
          </View>
          <View style={{ flexDirection: wide ? 'column' : 'row', justifyContent: 'space-between', gap: 8, ...(wide ? { marginTop: 'auto' } : {}) }}><Button kind="ghost" icon={Copy} onPress={onDuplicate}>Duplicate board</Button><Button kind="danger" icon={Trash2} onPress={() => setDeleting(true)}>Delete board</Button></View>
        </View>
      </View>
    </View>
    {languagesOpen && <BoardLanguages board={board} settings={settings} onChange={onChange} onConsent={onConsent} onClose={() => setLanguagesOpen(false)} />}
    {editing && <TileEditor key={editing.id} board={board} tile={editing} position={editingIndex} tileCount={board.tiles.length} onMove={reorder} playLanguages={board.playLanguages} settings={settings} audio={audio} onConsent={onConsent} canDelete={board.tiles.length > 1} canDuplicate={board.tiles.length < MAX_TILES} onClose={closeTile} onPreview={onPreview} onSave={tile => {
      const tiles = board.tiles.map(t => t.id === tile.id ? tile : t);
      const changedMeaning = tile.label !== editing.label || tile.language !== editing.language || JSON.stringify(tile.pictureOptions) !== JSON.stringify(editing.pictureOptions);
      const saved = setTiles(tiles);
      if (changedMeaning && !tile.pictureOptions?.locked && tile.illustration.kind !== 'photo' && settings.aiConsent) { setAutomaticPictures(true); setPictureTarget(tile.id); setPictures(saved); }
      closeTile();
    }} onDelete={() => { setTiles(board.tiles.filter(t => t.id !== editing.id)); closeTile(); }} onDuplicate={tile => { setTiles([...board.tiles, { ...tile, id: Crypto.randomUUID() }]); closeTile(); }} />}
    {pictures && <BoardPictures board={pictures} currentRevision={board.revision} automatic={automaticPictures} changedTileId={pictureTarget} settings={settings} onConsent={onConsent} onApply={(draft, revision) => { if (board.revision === revision) onChange({ tiles: draft.tiles, picturePolicy: draft.picturePolicy }); }} onClose={() => setPictures(null)} />}
    {deleting && <Confirm title={`Delete ${board.title}?`} message="This board is stored only on this device. Deleting it cannot be undone." confirmLabel="Delete board" danger onConfirm={onDelete} onClose={() => setDeleting(false)} />}
  </View>;
}
