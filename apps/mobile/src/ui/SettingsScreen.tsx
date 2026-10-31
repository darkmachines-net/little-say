/** @file Organizes shared languages, help, and About settings while media uses app defaults. */

import { useRef, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { Download, Info, Languages, ShieldCheck, Smartphone } from 'lucide-react-native';
import { getLanguageProfile, languageName, type Library, type Settings } from '@little-say/core';
import type { SettingsRoute } from '../services/settingsRoute';
import { AboutSettings } from './AboutSettings';
import { AppUpdateSettings } from './AppUpdateSettings';
import { Button, Notice } from './components';
import { LanguageProfileEditor } from './LanguageProfileEditor';
import { PrivacyPolicy } from './PrivacyPolicy';
import { SettingsGroup, SettingsPage, SettingsRow } from './SettingsPage';
import { styles, theme } from './theme';

const titles = { overview: 'Settings', languages: 'Languages', 'screen-guidance': 'Keep the app on screen', privacy: 'Privacy Policy', updates: 'App updates', about: 'About' };

/** Render shared-language, help, and About pages; save preferences atomically with retry after failure. */
export function SettingsScreen({ route, library, returnLabel = 'Boards', onNavigate, onBack, onSave, onBeforeRestart }: {
  route: SettingsRoute; library: Library;
  returnLabel?: string; onNavigate: (route: SettingsRoute) => void; onBack: () => void; onSave: (patch: Partial<Settings>) => Promise<void>; onBeforeRestart: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);
  const [failed, setFailed] = useState<Partial<Settings> | null>(null);
  const settings = library.settings;
  const profile = getLanguageProfile(settings);
  const save = (patch: Partial<Settings>) => {
    if (savingNow.current) return;
    savingNow.current = true; setSaving(true); setFailed(null);
    void onSave(patch).catch(() => setFailed(patch)).finally(() => { savingNow.current = false; setSaving(false); });
  };
  const guidance = Platform.OS === 'ios' ? 'Guided Access on iPhone & iPad' : Platform.OS === 'android' ? 'Screen pinning on Android' : 'Browser & full-screen guidance';
  const title = titles[route.page];
  const backLabel = route.page === 'overview' ? returnLabel : 'Settings';
  return <SettingsPage key={route.page} title={title} description={route.page === 'languages' ? 'The languages you use on your boards.' : undefined} backgroundColor={route.page === 'languages' ? theme.surface : undefined} backLabel={backLabel} onBack={onBack} busy={saving} status={saving ? 'Saving…' : undefined}>
    {failed && <Notice action={<Button kind="secondary" onPress={() => save(failed)}>Retry saving</Button>}>That change could not be saved. Your previous preference is still in use. Check device storage and retry.</Notice>}
    {route.page === 'overview' && <>
      <SettingsGroup title="Preferences">
        <SettingsRow label="Languages" icon={Languages} summary={profile.languages.map(tag => `${languageName(tag)}${tag === profile.defaultLanguage ? ' (default)' : ''}`).join(' · ')} onPress={() => onNavigate({ page: 'languages' })} last />
      </SettingsGroup>
      <SettingsGroup title="Help">
        <SettingsRow label="Keep the app on screen" icon={Smartphone} summary={guidance} onPress={() => onNavigate({ page: 'screen-guidance' })} />
        {Platform.OS !== 'web' && <SettingsRow label="App updates" icon={Download} summary="Check for a newer version" onPress={() => onNavigate({ page: 'updates' })} />}
        <SettingsRow label="Privacy Policy" icon={ShieldCheck} summary="Data, storage & AI" onPress={() => onNavigate({ page: 'privacy' })} />
        <SettingsRow label="About" icon={Info} summary="Version & build information" onPress={() => onNavigate({ page: 'about' })} last />
      </SettingsGroup>
    </>}
    {route.page === 'languages' && <LanguageProfileEditor value={profile} onChange={languageProfile => save({ languageProfile })} disabled={saving} />}
    {route.page === 'screen-guidance' && <>
      <View style={{ gap: 10 }}><Text accessibilityRole="header" style={styles.title}>{Platform.OS === 'ios' ? 'Guided Access' : Platform.OS === 'android' ? 'Screen pinning' : 'In your browser'}</Text><Text style={styles.body}>{Platform.OS === 'web' ? 'Little Say requests full screen when a board starts playing, where supported. Browser and system controls can still leave the app. Install Little Say from your browser for a dedicated app window.' : `Use ${Platform.OS === 'ios' ? 'Guided Access' : 'screen pinning'} to keep Little Say on screen during play. Set it up in your device settings.`}</Text>{Platform.OS !== 'web' && <Button kind="secondary" onPress={() => void Linking.openURL(Platform.OS === 'ios' ? 'https://support.apple.com/en-us/111795' : 'https://support.google.com/android/answer/9455138?hl=en')}>{Platform.OS === 'ios' ? 'Guided Access instructions' : 'Screen pinning instructions'}</Button>}</View>
      <View style={{ gap: 10 }}><Text accessibilityRole="header" style={styles.title}>Return to editing</Text><Text style={styles.body}>Boards open unlocked. Tap the lock icon to lock navigation. Hold it for one second to unlock automatically, then tap Back to edit. With a screen reader, activate the lock control to start the one-second unlock; activate again to cancel.</Text></View>
    </>}
    {route.page === 'privacy' && <PrivacyPolicy />}
    {route.page === 'about' && <AboutSettings />}
    {route.page === 'updates' && (Platform.OS === 'web' ? <Text style={styles.body}>Browser updates download automatically. When an update is ready, return to Boards to install it.</Text> : <AppUpdateSettings visible showHeading={false} onBeforeRestart={onBeforeRestart} />)}
  </SettingsPage>;
}
