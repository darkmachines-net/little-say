/** @file Collects device language, speech, backend, storage, and platform-specific parent settings. */

import { useState } from 'react';
import Constants from 'expo-constants';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { Check, Globe, Volume2, Wifi } from 'lucide-react-native';
import { firstWord, getLanguageProfile, languageName, type Settings, type Tile } from '@little-say/core';
import { apiFetch, developmentApiUrl } from '../services/api';
import { type Voice } from '../services/speech';
import { requestPersistence } from '../data/storage';
import { Button, Field, Notice, Sheet } from './components';
import { styles, theme } from './theme';
import { LanguageProfileEditor } from './LanguageProfileEditor';
import { defaultPicturePolicy } from '@little-say/core';
import { PictureCredits, PictureGenerationInfo, PicturePreferences } from './PicturePreferences';

/**
 * Edit settings in a local draft, preview voices, and save through the supplied callback; show
 * navigation-lock instructions only on applicable native platforms.
 */
export function ParentSettings({ settings, languages, voices, onSave, onPreview, onClose }: { settings: Settings; languages: string[]; voices: Voice[]; onSave: (settings: Settings) => Promise<void>; onPreview: (tile: Tile) => void; onClose: () => void }) {
  const [url, setUrl] = useState(settings.backendUrl);
  const [selected, setSelected] = useState(settings.voices);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState(() => getLanguageProfile(settings));
  const [language, setLanguage] = useState(() => getLanguageProfile(settings).defaultLanguage);
  const [sample, setSample] = useState(() => firstWord(getLanguageProfile(settings).defaultLanguage).speech);
  const [voiceList, setVoiceList] = useState(false);
  const [pictureDefaults, setPictureDefaults] = useState(settings.pictureDefaults ?? defaultPicturePolicy);
  const matches = voices.filter(v => v.language.split('-')[0] === language.split('-')[0]);
  const testConnection = async () => {
    setBusy(true); setError(''); setMessage('');
    try { const health = await apiFetch(url, '/api/health'); setMessage(health.aiConfigured ? 'Connected. Your home server is ready to create boards.' : 'Connected. Add OPENAI_API_KEY on the home server to enable AI.'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <Sheet title="Parent settings" onClose={onClose} footer={<Button onPress={() => { void onSave({ ...settings, backendUrl: url.trim().replace(/\/+$/, ''), voices: selected, languageProfile: profile, pictureDefaults }).then(onClose).catch(() => setError('Settings could not be saved. Check your device storage.')); }}>Save settings</Button>}>
    {Boolean(error) && <Notice>{error}</Notice>}
    <View style={{ gap: 14 }}>
      <View style={styles.row}><Globe size={20} color={theme.accent} /><Text style={{ fontSize: 17, color: theme.ink, fontWeight: '700' }}>Languages on this device</Text></View>
      <Text style={styles.body}>Choose up to six languages for new boards and quick setup. Existing boards keep their own languages.</Text>
      <LanguageProfileEditor value={profile} onChange={setProfile} />
      <Text style={styles.small}>Used for new cards and AI drafts unless you choose another language. Preferences are saved only on this device.</Text>
    </View>
    <View style={styles.divider} />
    <View style={{ gap: 14 }}>
      <View style={styles.row}><Wifi size={20} color={theme.accent} /><Text style={{ fontSize: 17, color: theme.ink, fontWeight: '700' }}>{developmentApiUrl ? 'Local development server' : 'Your home server'}</Text></View>
      <Text style={styles.body}>AI creation, voice prompts, and generating natural voices need the server. Boards, photos, and downloaded audio stay available on this device.</Text>
      {developmentApiUrl ? <><Field label="Development server address" value={developmentApiUrl} editable={false} /><Text style={styles.small}>Connected automatically by the development launcher. Your saved server address is preserved for normal builds.</Text></> : <Field label="Private server address" value={url} onChangeText={setUrl} placeholder={Platform.OS === 'web' ? 'Automatic — this website’s server' : 'https://say.your-home-domain.com'} autoCapitalize="none" autoCorrect={false} keyboardType="url" />}
      <Button kind="secondary" busy={busy} onPress={() => void testConnection()}>Test connection</Button>
      {Boolean(message) && <Text accessibilityLiveRegion="polite" style={{ color: theme.accent, lineHeight: 22 }}>{message}</Text>}
    </View>
    <View style={styles.divider} />
    <View style={{ gap: 12 }}><Text style={{ fontSize: 17, color: theme.ink, fontWeight: '700' }}>AI-generated voices</Text><Text style={styles.body}>Prepare natural speech in the background when boards are saved. Each tile’s words and language go through your server to OpenAI. Generated audio is saved on the server for reuse and downloaded for offline play. Device voices are the fallback.</Text><Button kind="secondary" onPress={() => {
      const enabled = settings.aiConsent && settings.autoSpeech;
      void onSave({ ...settings, autoSpeech: !enabled, aiConsent: settings.aiConsent || !enabled }).catch(() => setError('Could not save the audio preference.'));
    }}>{settings.aiConsent && settings.autoSpeech ? 'Automatic AI audio: on' : 'Enable automatic AI audio'}</Button><Text style={styles.small}>You can generate a fresh take in each tile’s editor. Turning this off keeps audio already saved.</Text></View>
    <View style={styles.divider} />
    <View style={{ gap: 14 }}><View style={styles.row}><Volume2 size={20} color={theme.accent} /><Text style={{ fontSize: 17, color: theme.ink, fontWeight: '700' }}>Voices & pronunciation</Text></View><Text style={styles.body}>Choose voices for your preferred languages and those already used by your boards. Download matching voices in your device’s speech settings for offline fallback. Check the volume and turn silent mode off if there’s no sound.</Text><View style={[styles.row, { flexWrap: 'wrap' }]}>{Array.from(new Set([...profile.languages, ...languages])).map(tag => <Button key={tag} compact kind={tag === language ? 'primary' : 'secondary'} onPress={() => { setLanguage(tag); setSample(firstWord(tag).speech); setVoiceList(false); }}>{languageName(tag)}</Button>)}</View>
      <Button kind="secondary" onPress={() => setVoiceList(value => !value)}>{selected[language] ? voices.find(v => v.identifier === selected[language])?.name || 'Previously selected voice unavailable' : 'Automatic matching voice'}</Button>
      {voiceList && <View style={{ gap: 4 }}><Button kind="ghost" onPress={() => { setSelected(current => { const next = { ...current }; delete next[language]; return next; }); setVoiceList(false); }}>Use automatic matching</Button>{matches.map(voice => <Pressable key={voice.identifier} accessibilityRole="button" accessibilityState={{ selected: selected[language] === voice.identifier }} onPress={() => { setSelected(current => ({ ...current, [language]: voice.identifier })); setVoiceList(false); }} style={{ padding: 13, minHeight: 48, backgroundColor: 'white', borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 9 }}><View style={{ flex: 1 }}><Text style={{ color: theme.ink, fontSize: 14 }}>{voice.name}</Text><Text style={styles.small}>{voice.language}{voice.localService === false ? ' · needs internet' : ''}</Text></View>{selected[language] === voice.identifier && <Check size={17} color={theme.accent} />}</Pressable>)}</View>}
      {!matches.length && <Notice>No matching {languageName(language)} voice was reported by this device. Install a voice in system settings, then reopen the app.</Notice>}
      <Field label="Voice test words" value={sample} onChangeText={setSample} maxLength={200} />
      <Button kind="ghost" icon={Volume2} disabled={!sample.trim()} onPress={() => { void onSave({ ...settings, voices: selected }).then(() => onPreview({ id: 'voice-test', label: 'Voice test', speech: sample.trim(), language, color: 'sage', illustration: { kind: 'emoji', emoji: '👋' } })).catch(() => setError('Could not save the selected voice.')); }}>Test selected voice</Button>
    </View>
    <View style={styles.divider} />
    <View style={{ gap: 12 }}><Text style={styles.title}>Pictures for new boards</Text><PicturePreferences value={pictureDefaults} onChange={setPictureDefaults} /><PictureGenerationInfo /><Text style={styles.small}>Source choices apply to new boards. Existing boards keep their saved pictures.</Text><PictureCredits /></View>
    {(Platform.OS === 'ios' || Platform.OS === 'android') && <>
      <View style={styles.divider} />
      <View style={{ gap: 12 }}><Text style={{ fontSize: 17, color: theme.ink, fontWeight: '700' }}>Lock the screen</Text><Text style={styles.body}>Hold the parent button for two seconds and release to edit. With a screen reader, activation starts a two-second unlock; activate again to cancel. To prevent system gestures from leaving the app, enable {Platform.OS === 'ios' ? 'Guided Access' : 'screen pinning'} before handing it over.</Text>{Platform.OS === 'ios' ? <Button kind="secondary" onPress={() => void Linking.openURL('https://support.apple.com/en-us/111795')}>Guided Access instructions</Button> : <Button kind="secondary" onPress={() => void Linking.openURL('https://support.google.com/android/answer/9455138?hl=en')}>Screen pinning instructions</Button>}</View>
    </>}
    <View style={styles.divider} />
    <View style={{ gap: 12 }}><Text style={{ fontSize: 17, color: theme.ink, fontWeight: '700' }}>Storage & privacy</Text><Text style={styles.body}>There are no accounts or board backups in this pilot. Uninstalling the app or clearing its storage deletes the boards, photos, downloaded pictures, and audio on this device.</Text>{Platform.OS === 'web' && <Button kind="secondary" onPress={() => { void requestPersistence().then(persistent => setMessage(persistent ? 'Persistent storage is enabled for this browser.' : 'This browser has not granted persistent storage. It may clear local data when storage is low.')).catch(() => setError('Persistent storage is unavailable in this browser.')); }}>Request persistent browser storage</Button>}<Text style={styles.small}>AI sends parent prompts, microphone recordings, and necessary board words through your server to OpenAI. Picture matching and generation also send card descriptions and library or generated picture pixels through your server to OpenAI. Personal photos stay on this device. Downloaded pictures are saved here for offline play. The app does not log prompt content or retain microphone recordings on the server. Generated speech is retained in the server’s audio cache. Library and generated pictures, concept descriptions, and picture-job metadata remain in the server’s picture cache without automatic deletion.</Text><Button kind="ghost" onPress={() => void Linking.openURL('https://developers.openai.com/api/docs/guides/your-data')}>OpenAI data policy</Button><Text style={styles.small}>Little Say · private pilot · {Constants.expoConfig?.version}</Text></View>
  </Sheet>;
}
