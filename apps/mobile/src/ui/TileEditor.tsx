/** @file Edits card words, media, and languages, with a validated handoff to scoped AI assistance. */

import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { ArrowLeft, ArrowRight, Copy, Crop, ImagePlus, Sparkles, Trash2, Volume2 } from 'lucide-react-native';
import { speechSource, assertTranslationSourceLanguageChange, canonicalLanguage, colors, editTileTranslation, languageName, languageSchema, profileLanguages, storedTileTranslation, tileSource, tileSchema, type Tile, type Settings } from '@little-say/core';
import { type SpeechLibrary } from '../services/speechLibrary';
import { chooseTilePhoto, type TilePhoto } from '../services/photos';
import { Button, Field, Notice, Sheet } from './components';
import { TileFace } from './TileFace';
import { EmojiPicker } from './EmojiPicker';
import { PhotoCropEditor } from './PhotoCropEditor';
import { LanguageChoices } from './LanguageChoices';
import { palettes, styles, theme } from './theme';
import { type Board } from '@little-say/core';
import { CardPictures } from './CardPictures';
import { EditingLanguages } from './EditingLanguages';

/**
 * Stage card edits and previews in a dialog, exposing save, reorder, duplicate, delete, and
 * per-language audio actions through the supplied callbacks. A scoped AI handoff validates and saves
 * the current card before returning to the shared composer.
 */
export function TileEditor({ tile, board, playLanguages = [], editingLanguage = null, onEditingLanguage, onStopPreview, settings, audio, onConsent, canDelete, canDuplicate, onSave, onAskAi, onDelete, onDuplicate, onClose, onPreview, position, tileCount, onMove }: { tile: Tile; board: Board; playLanguages?: string[]; editingLanguage?: string | null; onEditingLanguage?: (language: string | null) => void; onStopPreview: () => void; settings: Settings; audio: SpeechLibrary; onConsent: () => Promise<void>; canDelete: boolean; canDuplicate: boolean; onSave: (tile: Tile) => void;
  /** Save validated card edits before focusing AI on this card in the shared workspace. */
  onAskAi?: (tile: Tile) => void;
  onDelete: () => void; onDuplicate: (tile: Tile) => void; onClose: () => void; onPreview: (tile: Tile) => void; position?: number; tileCount?: number; onMove?: (offset: number) => void }) {
  const [draft, setDraft] = useState(tile);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showPictures, setShowPictures] = useState(false);
  const [sourceLanguageOpen, setSourceLanguageOpen] = useState(false);
  const [pictureBusy, setPictureBusy] = useState(false);
  const [audioLanguage, setAudioLanguage] = useState<string | null>(editingLanguage);
  const [cropping, setCropping] = useState<TilePhoto | null>(null);
  const [photoReady, setPhotoReady] = useState(false);
  const operation = useRef(0);
  const voiceOperation = useRef(0);
  const picking = useRef(false);
  // Only departure cancels pending work; use the latest callback without running cleanup on rerenders.
  const stopPreview = useRef(onStopPreview); stopPreview.current = onStopPreview;
  const { width } = useWindowDimensions();
  useEffect(() => () => { operation.current++; voiceOperation.current++; stopPreview.current(); }, []);
  const update = (value: Partial<Tile>) => { voiceOperation.current++; onStopPreview(); setError(''); setDraft(current => ({ ...current, ...value })); };
  const selectLanguage = (language: string | null) => { voiceOperation.current++; onStopPreview(); setAudioLanguage(language); onEditingLanguage?.(language); setError(''); };
  const validLanguage = languageSchema.safeParse(draft.language).success;
  const validated = tileSchema.safeParse(draft);
  const target = draft.languageMode === 'board' && validLanguage && audioLanguage && canonicalLanguage(audioLanguage) !== canonicalLanguage(draft.language) && playLanguages.some(tag => canonicalLanguage(tag) === canonicalLanguage(audioLanguage)) ? audioLanguage : null;
  const translation = target ? storedTileTranslation(draft, target) : undefined;
  const stale = Boolean(translation && translation.source !== tileSource(draft));
  const voiceTile = target ? { ...draft, label: translation?.label ?? '', speech: translation?.speech ?? '', language: target } : draft;
  const voiceReady = validLanguage && !stale && Boolean(voiceTile.label.trim() && voiceTile.speech.trim());
  const speech = audio.status(voiceTile);
  const editTranslation = (field: 'label' | 'speech', value: string) => {
    if (!target) return;
    voiceOperation.current++; onStopPreview(); setError('');
    setDraft(current => editTileTranslation(current, target, { [field]: value }));
  };
  const photo = draft.illustration.kind === 'photo' ? draft.illustration : null;
  const openCrop = (photo: TilePhoto) => { setPhotoReady(false); setCropping(photo); };
  const attachPhoto = async () => {
    if (picking.current) return;
    picking.current = true;
    const attempt = ++operation.current;
    setError(''); setBusy(true);
    try {
      const selected = await chooseTilePhoto();
      if (!selected || attempt !== operation.current) return;
      setShowEmoji(false);
      if (Platform.OS === 'web') openCrop(selected);
      else update({ illustration: selected, pictureOptions: { ...draft.pictureOptions, locked: true, instruction: draft.pictureOptions?.instruction ?? '' } });
    } catch { if (attempt === operation.current) setError('That photo could not be added. Check photo permissions and free storage, then try again.'); }
    finally { picking.current = false; if (attempt === operation.current) setBusy(false); }
  };
  return <Sheet title={cropping ? 'Crop photo' : 'Edit tile'} onClose={cropping ? () => setCropping(null) : onClose} footer={cropping ? <View style={[styles.row, { justifyContent: 'flex-end' }]}><Button kind="ghost" onPress={() => setCropping(null)}>Cancel</Button><Button disabled={!photoReady} onPress={() => { update({ illustration: cropping, pictureOptions: { ...draft.pictureOptions, locked: true, instruction: draft.pictureOptions?.instruction ?? '' } }); setCropping(null); }}>Use photo</Button></View> : <View style={styles.row}><Button kind="ghost" onPress={onClose}>Cancel</Button><Button onPress={() => { try { if (validated.success) { assertTranslationSourceLanguageChange(tile, validated.data, validated.data.translations); onSave(validated.data); } else setError('Complete both text fields for each translation before saving. ' + validated.error.issues[0].message); } catch (error) { setError((error as Error).message); } }} disabled={busy || pictureBusy}>Save tile</Button></View>}>
    {cropping ? <PhotoCropEditor tile={draft} photo={cropping} onChange={setCropping} onReady={setPhotoReady} /> : <>
    {onAskAi && <Button kind="secondary" icon={Sparkles} disabled={busy || pictureBusy} onPress={() => { try { const valid = tileSchema.parse(draft); assertTranslationSourceLanguageChange(tile, valid, valid.translations); onAskAi(valid); } catch (error) { setError((error as Error).message); } }}>Ask AI about this card</Button>}
    {onMove && position !== undefined && tileCount !== undefined && <View style={[styles.row, { justifyContent: 'space-between' }]}><Button compact kind="secondary" icon={ArrowLeft} disabled={position === 0} accessibilityLabel={`Move ${tile.label} earlier`} onPress={() => onMove(-1)} /><Text style={styles.small}>Position {position + 1} of {tileCount}</Text><Button compact kind="secondary" icon={ArrowRight} disabled={position === tileCount - 1} accessibilityLabel={`Move ${tile.label} later`} onPress={() => onMove(1)} /></View>}
    {draft.languageMode === 'board' && validLanguage && <EditingLanguages languages={playLanguages} selected={audioLanguage} onChange={selectLanguage} />}
    {target && !translation && <Notice>No {languageName(target)} translation yet. Enter both fields, or prepare missing translations in Languages.</Notice>}
    {stale && <Notice action={<Button kind="secondary" onPress={() => { if (target) { voiceOperation.current++; onStopPreview(); setDraft(current => editTileTranslation(current, target, {})); } }}>Use reviewed translation</Button>}>The original words changed. Your saved translation is kept below. Review it before using its audio.</Notice>}
    <View style={{ gap: 14 }}>
      <View testID="tile-photo-preview" style={{ width: photo ? Math.min(290, width - 100) : 150, height: photo ? Math.min(290, width - 100) + 56 : 150, alignSelf: 'center' }}><TileFace tile={voiceTile} size={photo ? 70 : 65} /></View>
      <View style={[styles.wrap, { justifyContent: 'center' }]}><Button kind="secondary" icon={ImagePlus} onPress={() => void attachPhoto()} busy={busy}>{photo ? 'Change photo' : 'Choose photo'}</Button>{photo && <Button kind="secondary" icon={Crop} disabled={busy} onPress={() => openCrop(photo)}>Adjust crop</Button>}<Button kind="ghost" disabled={busy} onPress={() => setShowEmoji(value => !value)}>{showEmoji ? 'Hide emoji' : 'Choose emoji'}</Button></View>
    </View>
    {showEmoji && <EmojiPicker selected={draft.illustration.kind === 'emoji' ? draft.illustration.emoji : undefined} onSelect={emoji => { update({ illustration: { kind: 'emoji', emoji }, pictureOptions: { ...draft.pictureOptions, locked: true, instruction: draft.pictureOptions?.instruction ?? '' } }); setShowEmoji(false); }} />}
    <Button kind="secondary" disabled={pictureBusy} onPress={() => setShowPictures(value => !value)}>{showPictures ? 'Hide picture options' : 'Picture options'}</Button>
    {showPictures && <CardPictures tile={draft} board={board} settings={settings} onConsent={onConsent} onChange={value => update({ illustration: value.illustration, pictureOptions: value.pictureOptions, pictureConcept: value.pictureConcept })} onBusy={setPictureBusy} />}
    <Field label={target ? `${languageName(target)} words on the tile` : 'Words on the tile'} value={voiceTile.label} maxLength={80} onChangeText={label => target ? editTranslation('label', label) : update({ label, ...(draft.speech === draft.label ? { speech: label } : {}) })} />
    <Field label={target ? `${languageName(target)} spoken words` : 'What it says'} value={voiceTile.speech} maxLength={200} onChangeText={speech => target ? editTranslation('speech', speech) : update({ speech })} />
    <Text style={styles.small}>{target ? 'Edits change this translation only. The label and spoken words can differ.' : 'These are the original words. Translation edits never replace them.'}</Text>
    <Button kind="secondary" icon={Volume2} disabled={!voiceReady} onPress={() => onPreview(voiceTile)}>{target ? 'Listen to translation' : 'Listen to this tile'}</Button>
    {!target && <><Button kind="ghost" onPress={() => setSourceLanguageOpen(value => !value)}>{sourceLanguageOpen ? 'Hide original language' : 'Change original language'}</Button>{sourceLanguageOpen && <View style={{ gap: 8 }}><Text style={styles.label}>Original spoken language</Text><Text style={styles.small}>This changes pronunciation metadata for the original words, not the editing translation. Saved translations may need review.</Text><LanguageChoices selected={[draft.language]} preferred={[...profileLanguages(settings), ...playLanguages]} onChoose={language => update({ language })} label="tile language" customInput={false} /><Field label="Language tag" value={draft.language} onChangeText={language => update({ language })} autoCapitalize="none" placeholder="e.g. es-MX" /></View>}</>}
    <View style={{ gap: 10 }}>
      <Text style={styles.label}>Board language behavior</Text>
      <View style={[styles.row, { flexWrap: 'wrap' }]}><Button kind={draft.languageMode !== 'board' ? 'primary' : 'secondary'} onPress={() => { update({ languageMode: 'fixed' }); selectLanguage(null); }}>Keep this card’s language</Button><Button kind={draft.languageMode === 'board' ? 'primary' : 'secondary'} onPress={() => update({ languageMode: 'board' })}>Follow board language</Button></View>
      {draft.languageMode !== 'board' && <Text style={styles.small}>This card keeps its original words when the board language changes.</Text>}
      {draft.languageMode === 'board' && !playLanguages.length && <Text style={styles.small}>Choose play languages in the board editor to add translations.</Text>}
      {speechSource(settings, voiceTile.language) === 'ai' ? <>
      <Text style={styles.label}>Natural voice{target ? ` · ${languageName(target)}` : ''}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.small}>{stale ? 'Review the saved translation before preparing audio.' : !voiceReady && target ? 'Add both translated fields to prepare audio.' : speech.state === 'preparing' ? (speech.asset ? 'Preparing a fresh take. Your current audio is still available.' : 'Preparing AI audio… You can save the tile and keep going.') : speech.asset ? 'AI-generated voice saved on this device for offline play.' : 'Using the device voice until AI audio is ready.'}</Text>
      <Text style={styles.small}>{target ? `Uses the ${languageName(target)} spoken words.` : 'Uses “What it says” and the original language.'}</Text>
      <Button kind="secondary" icon={Volume2} disabled={!voiceReady} busy={voiceReady && speech.state === 'preparing'} onPress={() => {
        setError('');
        const attempt = voiceOperation.current;
        void (async () => {
          if (attempt !== voiceOperation.current) return;
          await audio.generate(voiceTile, settings.backendUrl, Boolean(speech.asset));
        })().catch(error => { if (attempt === voiceOperation.current) setError((error as Error).message); });
      }}>{voiceReady && speech.asset ? 'Regenerate audio' : 'Generate audio'}</Button>
      {Boolean(speech.error) && <Notice>{speech.error}</Notice>}
      </> : <Text style={styles.small}>Uses the device voice selected in Settings → Voices.</Text>}
    </View>
    <View><Text style={styles.label}>Tile color</Text><View style={styles.row}>{colors.map(color => <Pressable key={color} accessibilityLabel={`${color} tile color`} accessibilityRole="button" accessibilityState={{ selected: draft.color === color }} onPress={() => update({ color })} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: palettes[color].background, borderWidth: draft.color === color ? 3 : 1, borderColor: draft.color === color ? theme.accent : theme.line }} />)}</View></View>
    {Boolean(error) && error !== speech.error && <Notice>{error}</Notice>}
    <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Button kind="ghost" icon={Copy} disabled={!canDuplicate || !validated.success} onPress={() => { try { if (validated.success) { assertTranslationSourceLanguageChange(tile, validated.data, validated.data.translations); onDuplicate(validated.data); } } catch (error) { setError((error as Error).message); } }}>Duplicate tile</Button><Button kind="danger" icon={Trash2} disabled={!canDelete} onPress={onDelete}>Remove tile</Button></View>
    </>}
  </Sheet>;
}
