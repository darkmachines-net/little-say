/** @file Provides consistent parent-facing picture modes, styles, and explicit image-generation permission. */

import { Linking, Text, View } from 'react-native';
import { type PicturePolicy } from '@little-say/core';
import { Button } from './components';
import { styles } from './theme';

export const pictureModes: [PicturePolicy['mode'], string][] = [['auto', 'Automatic'], ['library', 'Library only'], ['generated', 'Generated illustrations'], ['emoji', 'Emoji only']];
export const pictureStyles: [PicturePolicy['style'], string][] = [['color', 'Simple color'], ['line', 'Black and white']];

/** Edit draft picture preferences; these controls never start work or change saved pictures themselves. */
export function PicturePreferences({ value, onChange, disabled = false }: { value: PicturePolicy; onChange: (value: PicturePolicy) => void; disabled?: boolean }) {
  return <View style={{ gap: 10 }}>
    <Text style={styles.label}>Picture source</Text><View style={styles.wrap}>{pictureModes.map(([mode, label]) => <Button key={mode} compact disabled={disabled} kind={value.mode === mode ? 'primary' : 'secondary'} onPress={() => onChange({ ...value, mode })}>{label}</Button>)}</View>
    {value.mode !== 'emoji' && <><Text style={styles.label}>Illustration style</Text><View style={styles.wrap}>{pictureStyles.map(([style, label]) => <Button key={style} compact disabled={disabled} kind={value.style === style ? 'primary' : 'secondary'} onPress={() => onChange({ ...value, style })}>{label}</Button>)}</View><Button disabled={disabled} kind="secondary" onPress={() => onChange({ ...value, consistent: !value.consistent })}>{value.consistent ? 'Consistent pictures: on' : 'Consistent pictures: off'}</Button></>}
  </View>;
}

/** Disclose image costs and retention beside the permission control, without silently enabling generation. */
export function PicturePermission({ enabled, onChange, disabled = false }: { enabled: boolean; onChange: (enabled: boolean) => void; disabled?: boolean }) {
  return <View style={{ gap: 8 }}><Text style={styles.small}>AI pictures send concept descriptions and picture instructions to OpenAI through your server. Generation uses your server’s paid API account. Pictures and descriptions are cached on the server and downloaded for offline play. Personal photos stay on this device.</Text><Button kind="secondary" disabled={disabled} onPress={() => onChange(!enabled)}>{enabled ? 'AI pictures allowed' : 'Allow AI pictures'}</Button></View>;
}

/** Show source and license links in parent controls rather than covering children's cards with credits. */
export function PictureCredits() {
  return <View style={{ gap: 6 }}><Text style={styles.label}>Picture credits</Text><Text style={styles.small}>Mulberry Symbols by Steve Lee and OpenMoji by HfG Schwäbisch Gmünd and contributors. Both sets use CC BY-SA 4.0. Downloaded symbols are rasterized with transparent padding; their original artwork is unchanged.</Text><View style={styles.wrap}><Button compact kind="ghost" onPress={() => void Linking.openURL('https://mulberrysymbols.org/')}>Mulberry</Button><Button compact kind="ghost" onPress={() => void Linking.openURL('https://openmoji.org/')}>OpenMoji</Button><Button compact kind="ghost" onPress={() => void Linking.openURL('https://creativecommons.org/licenses/by-sa/4.0/')}>CC BY-SA 4.0</Button></View></View>;
}
