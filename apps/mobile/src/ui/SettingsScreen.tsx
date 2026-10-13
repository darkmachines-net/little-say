/** @file Organizes Settings into grouped links and focused pages with durable per-page preference changes. */

import { useRef, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { CircleUserRound, Download, Image, Languages, ShieldCheck, Smartphone, Volume2 } from 'lucide-react-native';
import { defaultPicturePolicy, getLanguageProfile, languageName, speechSource, voiceLanguages, type Library, type Settings } from '@little-say/core';
import type { AccountController } from '../services/useAccount';
import type { SettingsRoute } from '../services/settingsRoute';
import type { Voice } from '../services/speech';
import type { SpeechLibrary } from '../services/speechLibrary';
import { requestPersistence } from '../data/storage';
import { AccountPanel } from './AccountPanel';
import { AppUpdateSettings } from './AppUpdateSettings';
import { Button, Notice } from './components';
import { LanguageProfileEditor } from './LanguageProfileEditor';
import { PictureCredits, PicturePreferences } from './PicturePreferences';
import { PrivacyPolicy } from './PrivacyPolicy';
import { SettingsGroup, SettingsPage, SettingsRow } from './SettingsPage';
import { VoiceSettings } from './VoiceSettings';
import { styles } from './theme';

const pictureNames = { auto: 'Automatic', library: 'Library only', generated: 'AI illustrations', emoji: 'Emoji only' };
const titles = { overview: 'Settings', languages: 'Languages', voices: 'Voices', pictures: 'Pictures', account: 'Account & backup', 'screen-guidance': 'Keep the app on screen', privacy: 'Privacy Policy', updates: 'App updates' };

/** Render the selected Settings route; preference writes are atomic, with failed changes available to retry. */
export function SettingsScreen({ route, library, account, voices, audio, returnLabel = 'Boards', onNavigate, onBack, onSave, onBeforeRestart }: {
  route: SettingsRoute; library: Library; account: AccountController; voices: Voice[]; audio: SpeechLibrary;
  returnLabel?: string; onNavigate: (route: SettingsRoute) => void; onBack: () => void; onSave: (patch: Partial<Settings>) => Promise<void>; onBeforeRestart: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);
  const [failed, setFailed] = useState<Partial<Settings> | null>(null);
  const [storageMessage, setStorageMessage] = useState('');
  const settings = library.settings;
  const profile = getLanguageProfile(settings);
  const pictureDefaults = settings.pictureDefaults ?? defaultPicturePolicy;
  const save = (patch: Partial<Settings>) => {
    if (savingNow.current) return;
    savingNow.current = true; setSaving(true); setFailed(null);
    void onSave(patch).catch(() => setFailed(patch)).finally(() => { savingNow.current = false; setSaving(false); });
  };
  const guidance = Platform.OS === 'ios' ? 'Guided Access on iPhone & iPad' : Platform.OS === 'android' ? 'Screen pinning on Android' : 'Browser & full-screen guidance';
  const accountSummary = account.error ? 'Backup needs attention' : account.needsLogin ? 'Sign in again' : !account.session ? 'Not signed in' : !account.session.account.emailVerified ? 'Verify your email' : account.busy ? 'Syncing…' : account.savedAt ? 'Backup enabled' : 'Backup pending';
  const title = route.language ? languageName(route.language) : route.mode === 'login' ? 'Log in' : route.mode === 'register' ? 'Create an account' : route.mode === 'reset' ? 'Reset your password' : titles[route.page];
  const backLabel = route.language ? 'Voices' : route.mode ? 'Back' : route.page === 'overview' ? returnLabel : 'Settings';
  return <SettingsPage key={`${route.page}:${route.language ?? ''}:${route.mode ?? ''}`} title={title} backLabel={backLabel} onBack={onBack} busy={saving} status={saving ? 'Saving…' : undefined}>
    {failed && <Notice action={<Button kind="secondary" onPress={() => save(failed)}>Retry saving</Button>}>That change could not be saved. Your previous preference is still in use. Check device storage and retry.</Notice>}
    {route.page === 'overview' && <>
      <SettingsGroup title="Preferences">
        <SettingsRow label="Languages" icon={Languages} summary={profile.languages.map(tag => `${languageName(tag)}${tag === profile.defaultLanguage ? ' (default)' : ''}`).join(' · ')} onPress={() => onNavigate({ page: 'languages' })} />
        <SettingsRow label="Voices" icon={Volume2} summary="AI or device voices by language" onPress={() => onNavigate({ page: 'voices' })} />
        <SettingsRow label="Pictures" icon={Image} summary={`${pictureNames[pictureDefaults.mode]} · for new boards`} onPress={() => onNavigate({ page: 'pictures' })} last />
      </SettingsGroup>
      <SettingsGroup title="Account & help">
        <SettingsRow label="Account & backup" icon={CircleUserRound} summary={accountSummary} onPress={() => onNavigate({ page: 'account' })} />
        <SettingsRow label="Keep the app on screen" icon={Smartphone} summary={guidance} onPress={() => onNavigate({ page: 'screen-guidance' })} />
        {Platform.OS !== 'web' && <SettingsRow label="App updates" icon={Download} summary="Check for a newer version" onPress={() => onNavigate({ page: 'updates' })} />}
        <SettingsRow label="Privacy Policy" icon={ShieldCheck} summary="Data, storage & AI" onPress={() => onNavigate({ page: 'privacy' })} last />
      </SettingsGroup>
    </>}
    {route.page === 'languages' && <><LanguageProfileEditor value={profile} onChange={languageProfile => save({ languageProfile })} disabled={saving} /><Text style={styles.body}>Choose up to six languages. The default is used for new cards and boards. Existing boards keep their own languages.</Text></>}
    {route.page === 'voices' && (route.language ? <VoiceSettings language={route.language} settings={settings} voices={voices} audio={audio} busy={saving} onChange={save} /> : <SettingsGroup title="By language">{voiceLanguages(library).map((language, index, list) => <SettingsRow key={language} label={languageName(language)} summary={speechSource(settings, language) === 'ai' ? 'AI voice' : settings.voices[language] ? voices.find(voice => voice.identifier === settings.voices[language])?.name ?? 'Device voice · saved voice unavailable' : 'Device voice · automatic'} onPress={() => onNavigate({ page: 'voices', language })} last={index === list.length - 1} />)}</SettingsGroup>)}
    {route.page === 'pictures' && <><PicturePreferences value={pictureDefaults} onChange={value => save({ pictureDefaults: value })} disabled={saving} /><Text style={styles.body}>Applies to new boards. Existing boards keep their pictures and source preferences.</Text><Text style={styles.body}>Automatic can fill gaps with AI illustrations. Downloaded pictures remain available offline.</Text><PictureCredits /></>}
    {route.page === 'account' && <>
      <AccountPanel key={route.mode ?? (account.session && !account.needsLogin ? 'signed-in' : 'choices')} account={account} mode={route.mode ?? null} setMode={mode => mode ? onNavigate({ page: 'account', mode }) : onBack()} onContinue={onBack} settingsPage />
      {!route.mode && <View style={{ gap: 12 }}><Text accessibilityRole="header" style={styles.title}>Storage on this device</Text><Text style={styles.body}>Without a saved account backup, clearing app storage or uninstalling removes local boards, pictures and audio.</Text>{Platform.OS === 'web' && <Button kind="secondary" onPress={() => void requestPersistence().then(persistent => setStorageMessage(persistent ? 'Persistent browser storage is enabled.' : 'This browser has not granted persistent storage. It may remove data when storage is low.')).catch(() => setStorageMessage('Persistent storage is unavailable in this browser.'))}>Request persistent browser storage</Button>}{Boolean(storageMessage) && <Text accessibilityLiveRegion="polite" style={styles.body}>{storageMessage}</Text>}</View>}
    </>}
    {route.page === 'screen-guidance' && <>
      <View style={{ gap: 10 }}><Text accessibilityRole="header" style={styles.title}>{Platform.OS === 'ios' ? 'Guided Access' : Platform.OS === 'android' ? 'Screen pinning' : 'In your browser'}</Text><Text style={styles.body}>{Platform.OS === 'web' ? 'Little Say requests full screen when a board starts playing, where supported. Browser and system controls can still leave the app. Install Little Say from your browser for a dedicated app window.' : `Use ${Platform.OS === 'ios' ? 'Guided Access' : 'screen pinning'} to keep Little Say on screen during play. Set it up in your device settings.`}</Text>{Platform.OS !== 'web' && <Button kind="secondary" onPress={() => void Linking.openURL(Platform.OS === 'ios' ? 'https://support.apple.com/en-us/111795' : 'https://support.google.com/android/answer/9455138?hl=en')}>{Platform.OS === 'ios' ? 'Guided Access instructions' : 'Screen pinning instructions'}</Button>}</View>
      <View style={{ gap: 10 }}><Text accessibilityRole="header" style={styles.title}>Return to editing</Text><Text style={styles.body}>Hold the edit control for two seconds, then release. With a screen reader, activate it to start the two-second unlock; activate again to cancel.</Text></View>
    </>}
    {route.page === 'privacy' && <PrivacyPolicy />}
    {route.page === 'updates' && (Platform.OS === 'web' ? <Text style={styles.body}>Browser updates download automatically. When an update is ready, return to Boards to install it.</Text> : <AppUpdateSettings visible showHeading={false} onBeforeRestart={onBeforeRestart} />)}
  </SettingsPage>;
}
