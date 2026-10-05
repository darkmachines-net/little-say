/** @file Groups explained picture selectors and independent switches for board defaults, card overrides, and generation permission. */

import { useState } from 'react';
import { Linking, Switch, Text, View } from 'react-native';
import { type PicturePolicy, type Tile } from '@little-say/core';
import { Button } from './components';
import { PictureChoiceField, type PictureChoice } from './PictureChoiceField';
import { styles, theme } from './theme';

const pictureModes: readonly PictureChoice<PicturePolicy['mode']>[] = [
  { value: 'auto', label: 'Automatic', description: 'Keep clear emoji, find library pictures, or generate a clearer illustration. Use emoji if pictures are unavailable.' },
  { value: 'library', label: 'Library only', description: 'Use free library pictures, with emoji when there is no good match. Never generate new images.' },
  { value: 'generated', label: 'AI illustrations', description: 'Create illustrations with your server’s AI service. Keep emoji if generation is unavailable.' },
  { value: 'emoji', label: 'Emoji only', description: 'Use emoji, even when the closest match is approximate.' },
];

function PictureSwitch({ label, description, value, onChange, disabled = false }: { label: string; description: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16, opacity: disabled ? 0.5 : 1 }}><View style={{ flex: 1, gap: 5 }}><Text style={[styles.label, { marginBottom: 0 }]}>{label}</Text><Text style={styles.small}>{description}</Text></View><View style={{ minHeight: 44, justifyContent: 'center' }}><Switch accessibilityLabel={label} accessibilityHint={description} value={value} onValueChange={onChange} disabled={disabled} trackColor={{ false: theme.line, true: theme.accent }} /></View></View>;
}

/** Edit draft picture preferences; these controls never start work or change saved pictures themselves. */
export function PicturePreferences({ value, onChange, disabled = false }: { value: PicturePolicy; onChange: (value: PicturePolicy) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return <View style={{ gap: 20 }}>
    <PictureChoiceField label="Picture source" value={value.mode} choices={pictureModes} expanded={open} onExpand={setOpen} disabled={disabled} onChange={mode => onChange({ ...value, mode, style: 'color' })} />
    {value.mode !== 'emoji' && <PictureSwitch label="Keep pictures consistent" description="Use illustrations throughout when emoji cannot cover the board." value={value.consistent} disabled={disabled} onChange={consistent => onChange({ ...value, consistent, style: 'color' })} />}
  </View>;
}

/** Make card overrides explicit, including the current inherited board choice and a separate protection switch. */
export function CardPicturePreferences({ options, policy, onChange, disabled = false }: { options: NonNullable<Tile['pictureOptions']>; policy: PicturePolicy; onChange: (changes: Partial<NonNullable<Tile['pictureOptions']>>) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const boardMode = pictureModes.find(choice => choice.value === policy.mode)!;
  return <View style={{ gap: 20 }}>
    <PictureSwitch label="Keep this picture" description="Protect this card from board-wide picture changes." value={options.locked} disabled={disabled} onChange={locked => onChange({ locked })} />
    <PictureChoiceField<PicturePolicy['mode'] | 'board'> label="Picture source for this card" value={options.mode ?? 'board'} choices={[{ value: 'board', label: `Follow board · ${boardMode.label}`, description: boardMode.description }, ...pictureModes]} expanded={open} onExpand={setOpen} disabled={disabled} onChange={mode => onChange({ mode: mode === 'board' ? undefined : mode, style: undefined })} />
  </View>;
}

/** Explain the generation included in Automatic and how to choose a source that never generates images. */
export function PictureGenerationInfo() {
  return <Text style={styles.small}>Automatic and AI illustrations can use your server’s paid AI service. Choose Library only or Emoji only to avoid image generation. Pictures are downloaded for offline play.</Text>;
}

/** Show source and license links in parent controls rather than covering children's cards with credits. */
export function PictureCredits() {
  return <View style={{ gap: 6 }}><Text style={styles.label}>Picture credits</Text><Text style={styles.small}>Mulberry Symbols by Steve Lee and OpenMoji by HfG Schwäbisch Gmünd and contributors. Both sets use CC BY-SA 4.0. Downloaded symbols are rasterized with transparent padding; their original artwork is unchanged.</Text><View style={styles.wrap}><Button compact kind="ghost" onPress={() => void Linking.openURL('https://mulberrysymbols.org/')}>Mulberry</Button><Button compact kind="ghost" onPress={() => void Linking.openURL('https://openmoji.org/')}>OpenMoji</Button><Button compact kind="ghost" onPress={() => void Linking.openURL('https://creativecommons.org/licenses/by-sa/4.0/')}>CC BY-SA 4.0</Button></View></View>;
}
