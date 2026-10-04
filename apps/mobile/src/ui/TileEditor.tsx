import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { ArrowLeft, ArrowRight, Copy, Crop, ImagePlus, Trash2, Volume2 } from 'lucide-react-native';
import { canonicalLanguage, colors, languageName, languageSchema, profileLanguages, tileInLanguage, tileSource, tileTranslation, tileSchema, type Tile, type Settings } from '@little-say/core';
import { type SpeechLibrary } from '../services/speechLibrary';
import { chooseTilePhoto, type TilePhoto } from '../services/photos';
import { Button, Field, Notice, Sheet } from './components';
import { TileFace } from './TileFace';
import { EmojiPicker } from './EmojiPicker';
import { PhotoCropEditor } from './PhotoCropEditor';
import { LanguageChoices } from './LanguageChoices';
import { palettes, styles, theme } from './theme';

export function TileEditor({ tile, playLanguages = [], settings, audio, onConsent, canDelete, canDuplicate, onSave, onDelete, onDuplicate, onClose, onPreview, position, tileCount, onMove }: { tile: Tile; playLanguages?: string[]; settings: Settings; audio: SpeechLibrary; onConsent: () => Promise<void>; canDelete: boolean; canDuplicate: boolean; onSave: (tile: Tile) => void; onDelete: () => void; onDuplicate: (tile: Tile) => void; onClose: () => void; onPreview: (tile: Tile) => void; position?: number; tileCount?: number; onMove?: (offset: number) => void }) {
  const [draft, setDraft] = useState(tile);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [audioLanguage, setAudioLanguage] = useState<string | null>(null);
  const [cropping, setCropping] = useState<TilePhoto | null>(null);
  const [photoReady, setPhotoReady] = useState(false);
  const operation = useRef(0);
  const picking = useRef(false);
  const { width } = useWindowDimensions();
  useEffect(() => () => { operation.current++; }, []);
  const update = (value: Partial<Tile>) => setDraft(current => ({ ...current, ...value }));
  const validLanguage = languageSchema.safeParse(draft.language).success;
  const cleanDraft = { ...draft, translations: validLanguage ? draft.translations?.filter(t => t.source === tileSource(draft)) : draft.translations };
  const validated = tileSchema.safeParse(cleanDraft);
  const target = draft.languageMode === 'board' && validLanguage && audioLanguage && canonicalLanguage(audioLanguage) !== canonicalLanguage(draft.language) && playLanguages.includes(audioLanguage) ? audioLanguage : null;
  const translation = target ? tileTranslation(draft, target) : undefined;
  const voiceTile = validLanguage ? tileInLanguage(draft, target) : draft;
  const voiceReady = validated.success && (!target || Boolean(translation?.label.trim() && translation.speech.trim()));
  const speech = audio.status(voiceTile);
  const editTranslation = (field: 'label' | 'speech', value: string) => {
    if (!target) return;
    const next = { language: target, label: translation?.label ?? '', speech: translation?.speech ?? '', source: tileSource(draft), [field]: value };
    update({ translations: [...(draft.translations ?? []).filter(t => t.source === tileSource(draft) && canonicalLanguage(t.language) !== canonicalLanguage(target) && playLanguages.some(tag => canonicalLanguage(tag) === canonicalLanguage(t.language))), ...(next.label || next.speech ? [next] : [])] });
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
      else update({ illustration: selected });
    } catch { if (attempt === operation.current) setError('That photo could not be added. Check photo permissions and free storage, then try again.'); }
    finally { picking.current = false; if (attempt === operation.current) setBusy(false); }
  };
  return <Sheet title={cropping ? 'Crop photo' : 'Edit tile'} onClose={cropping ? () => setCropping(null) : onClose} footer={cropping ? <View style={[styles.row, { justifyContent: 'flex-end' }]}><Button kind="ghost" onPress={() => setCropping(null)}>Cancel</Button><Button disabled={!photoReady} onPress={() => { update({ illustration: cropping }); setCropping(null); }}>Use photo</Button></View> : <Button onPress={() => { if (validated.success) onSave(validated.data); else setError(validated.error.issues[0].message); }} disabled={busy}>Save tile</Button>}>
    {cropping ? <PhotoCropEditor tile={draft} photo={cropping} onChange={setCropping} onReady={setPhotoReady} /> : <>
    {onMove && position !== undefined && tileCount !== undefined && <View style={[styles.row, { justifyContent: 'space-between' }]}><Button compact kind="secondary" icon={ArrowLeft} disabled={position === 0} accessibilityLabel={`Move ${tile.label} earlier`} onPress={() => onMove(-1)} /><Text style={styles.small}>Position {position + 1} of {tileCount}</Text><Button compact kind="secondary" icon={ArrowRight} disabled={position === tileCount - 1} accessibilityLabel={`Move ${tile.label} later`} onPress={() => onMove(1)} /></View>}
    <View style={{ gap: 14 }}>
      <View testID="tile-photo-preview" style={{ width: photo ? Math.min(290, width - 100) : 150, height: photo ? Math.min(290, width - 100) + 56 : 150, alignSelf: 'center' }}><TileFace tile={draft} size={photo ? 70 : 65} /></View>
      <View style={[styles.wrap, { justifyContent: 'center' }]}><Button kind="secondary" icon={ImagePlus} onPress={() => void attachPhoto()} busy={busy}>{photo ? 'Change photo' : 'Choose photo'}</Button>{photo && <Button kind="secondary" icon={Crop} disabled={busy} onPress={() => openCrop(photo)}>Adjust crop</Button>}<Button kind="ghost" disabled={busy} onPress={() => setShowEmoji(value => !value)}>{showEmoji ? 'Hide emoji' : 'Choose emoji'}</Button></View>
    </View>
    {showEmoji && <EmojiPicker selected={draft.illustration.kind === 'emoji' ? draft.illustration.emoji : undefined} onSelect={emoji => { update({ illustration: { kind: 'emoji', emoji } }); setShowEmoji(false); }} />}
    <Field label="Words on the tile" value={draft.label} maxLength={80} onChangeText={label => update({ label, ...(draft.speech === draft.label ? { speech: label } : {}) })} />
    <Field label="What it says" value={draft.speech} maxLength={200} onChangeText={speech => update({ speech })} />
    <View style={{ gap: 8 }}><Text style={styles.label}>Language for this tile</Text><LanguageChoices selected={[draft.language]} preferred={[...profileLanguages(settings), ...playLanguages]} onChoose={language => update({ language })} label="tile language" customInput={false} /><Field label="Language tag" value={draft.language} onChangeText={language => update({ language })} autoCapitalize="none" placeholder="e.g. es-MX" /><Text style={styles.small}>The label and spoken words can differ. Choose the language of the spoken words and preview to check pronunciation.</Text><Button kind="secondary" icon={Volume2} disabled={!validated.success} onPress={() => onPreview(draft)}>Listen to this tile</Button></View>
    <View style={{ gap: 10 }}>
      <Text style={styles.label}>Board language behavior</Text>
      <View style={[styles.row, { flexWrap: 'wrap' }]}><Button kind={draft.languageMode !== 'board' ? 'primary' : 'secondary'} onPress={() => { update({ languageMode: 'fixed' }); setAudioLanguage(null); }}>Keep this card’s language</Button><Button kind={draft.languageMode === 'board' ? 'primary' : 'secondary'} onPress={() => update({ languageMode: 'board' })}>Follow board language</Button></View>
      {draft.languageMode === 'board' && <><Text style={styles.small}>The words above are the original version. Choose a language below to edit its translation and saved voice. Changing the original words makes old translations need updating.</Text><View style={[styles.row, { flexWrap: 'wrap' }]}><Button kind={!target ? 'primary' : 'secondary'} onPress={() => setAudioLanguage(null)}>Original words</Button>{validLanguage && playLanguages.filter(tag => canonicalLanguage(tag) !== canonicalLanguage(draft.language)).map(tag => <Button key={tag} kind={target === tag ? 'primary' : 'secondary'} onPress={() => setAudioLanguage(tag)}>{languageName(tag)}</Button>)}</View>{!playLanguages.length && <Text style={styles.small}>Choose play languages in the board editor to add translations.</Text>}</>}
      {target && <><Field label={`${languageName(target)} words on the tile`} value={translation?.label ?? ''} maxLength={80} onChangeText={value => editTranslation('label', value)} /><Field label={`${languageName(target)} spoken words`} value={translation?.speech ?? ''} maxLength={200} onChangeText={value => editTranslation('speech', value)} /><Text style={styles.small}>Enter both fields, or prepare translations from the board editor.</Text><Button kind="secondary" icon={Volume2} disabled={!voiceReady} onPress={() => onPreview(voiceTile)}>Listen to translation</Button></>}
      <Text style={styles.label}>Natural voice{target ? ` · ${languageName(target)}` : ''}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.small}>{!voiceReady && target ? 'Add both translated fields to prepare audio.' : speech.state === 'preparing' ? (speech.asset ? 'Preparing a fresh take. Your current audio is still available.' : 'Preparing AI audio… You can save the tile and keep going.') : speech.asset ? 'AI-generated voice saved on this device for offline play.' : 'Using the device voice until AI audio is ready.'}</Text>
      <Text style={styles.small}>{target ? `Uses the ${languageName(target)} spoken words.` : 'Uses “What it says” and the original language.'}</Text>{!settings.aiConsent && <Text style={styles.small}>Words go to OpenAI through your server. Generated audio is saved on the server and this device.</Text>}
      <Button kind="secondary" icon={Volume2} disabled={!voiceReady} busy={voiceReady && speech.state === 'preparing'} onPress={() => {
        void (async () => {
          if (!settings.aiConsent) await onConsent();
          await audio.generate(voiceTile, settings.backendUrl, Boolean(speech.asset));
        })().catch(() => {});
      }}>{voiceReady && speech.asset ? 'Regenerate audio' : 'Generate audio'}</Button>
      {Boolean(speech.error) && <Notice>{speech.error}</Notice>}
    </View>
    <View><Text style={styles.label}>Tile color</Text><View style={styles.row}>{colors.map(color => <Pressable key={color} accessibilityLabel={`${color} tile color`} accessibilityRole="button" accessibilityState={{ selected: draft.color === color }} onPress={() => update({ color })} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: palettes[color].background, borderWidth: draft.color === color ? 3 : 1, borderColor: draft.color === color ? theme.accent : theme.line }} />)}</View></View>
    {Boolean(error) && <Notice>{error}</Notice>}
    <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Button kind="ghost" icon={Copy} disabled={!canDuplicate || !validated.success} onPress={() => { if (validated.success) onDuplicate(validated.data); }}>Duplicate tile</Button><Button kind="danger" icon={Trash2} disabled={!canDelete} onPress={onDelete}>Remove tile</Button></View>
    </>}
  </Sheet>;
}
