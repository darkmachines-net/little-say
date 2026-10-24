/** @file Edits one language's AI/device speech source and previews the selected voice without changing board content. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, Text, View } from 'react-native';
import { Check, Volume2 } from 'lucide-react-native';
import { firstWord, languageName, speechSource, type Settings, type Tile } from '@little-say/core';
import { matchingVoice, speechQueue, type Voice } from '../services/speech';
import type { SpeechLibrary } from '../services/speechLibrary';
import { Button, Field, Notice } from './components';
import { styles, theme } from './theme';

/** Save source and device voice per locale; cancel preview playback and ignore late generation on departure. */
export function VoiceSettings({ language, settings, voices, audio, busy, onChange }: { language: string; settings: Settings; voices: Voice[]; audio: SpeechLibrary; busy: boolean; onChange: (patch: Partial<Settings>) => void }) {
  const [sample, setSample] = useState(() => firstWord(language).speech);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const source = speechSource(settings, language);
  const matches = voices.filter(voice => voice.language.split('-')[0].toLowerCase() === language.split('-')[0].toLowerCase());
  const queue = useMemo(() => speechQueue(voices, settings.voices, active => setPlaying(Boolean(active)), () => { setPlaying(false); setError('This voice could not play. Check the volume and device speech settings.'); }, audio.asset, tag => speechSource(settings, tag)), [voices, settings, audio]);
  useEffect(() => {
    const cancelPreview = () => { request.current++; queue.stop(); };
    const stop = () => { cancelPreview(); setPlaying(false); };
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') stop(); });
    const hidden = () => { if (document.hidden) stop(); };
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', hidden);
    return () => { cancelPreview(); subscription.remove(); if (Platform.OS === 'web') document.removeEventListener('visibilitychange', hidden); };
  }, [queue]);
  const preview = async () => {
    const current = ++request.current;
    queue.stop(); setError(''); setPlaying(true);
    const tile: Tile = { id: 'voice-preview', label: 'Voice preview', speech: sample.trim(), language, color: 'sage', illustration: { kind: 'emoji', emoji: '👋' } };
    if (source === 'ai') {
      try { await audio.generate(tile, settings.backendUrl); }
      catch {
        if (current !== request.current) return;
        if (!matchingVoice(tile, voices, settings.voices)) { setError('AI speech is unavailable right now. Try again when connected.'); setPlaying(false); return; }
        setError('AI speech is unavailable right now. Previewing the device fallback.');
      }
    }
    if (current === request.current) queue.enqueue(tile);
  };
  return <View style={{ gap: 22 }}>
    <View style={{ gap: 10 }}><Text style={styles.label}>Speech source</Text><View style={styles.wrap}>{(['ai', 'device'] as const).map(value => <Button key={value} disabled={busy || playing} kind={source === value ? 'primary' : 'secondary'} onPress={() => onChange({ voiceSources: { ...settings.voiceSources, [language]: value } })}>{value === 'ai' ? 'AI voice' : 'Device voice'}</Button>)}</View>
      <Text style={styles.body}>{source === 'ai' ? 'Natural speech is saved for offline play. Device speech is used while audio is unavailable.' : 'Use this device’s speech engine for this language, including cards with downloaded AI audio.'}</Text>
    </View>
    <View style={{ gap: 10 }}><Text style={styles.label}>{source === 'ai' ? 'Device fallback' : 'Device voice'}</Text>
      <Button disabled={busy || playing} kind={!settings.voices[language] ? 'primary' : 'secondary'} onPress={() => { const selected = { ...settings.voices }; delete selected[language]; onChange({ voices: selected }); }}>Automatic matching voice</Button>
      {settings.voices[language] && !matches.some(voice => voice.identifier === settings.voices[language]) && <Notice>The saved voice is unavailable on this device. A matching voice will be used when possible.</Notice>}
      {matches.map(voice => <Pressable key={voice.identifier} accessibilityRole="radio" accessibilityLabel={voice.name} accessibilityState={{ checked: settings.voices[language] === voice.identifier, disabled: busy || playing }} disabled={busy || playing} onPress={() => onChange({ voices: { ...settings.voices, [language]: voice.identifier } })} style={{ backgroundColor: theme.surface, borderRadius: 14, padding: 16, minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ flex: 1, gap: 4 }}><Text style={{ color: theme.ink, fontSize: 16 }}>{voice.name}</Text><Text style={styles.small}>{voice.language}{voice.localService === false ? ' · Needs internet' : ''}</Text></View>{settings.voices[language] === voice.identifier && <Check size={20} color={theme.accent} />}</Pressable>)}
      {!matches.length && <Notice>No {languageName(language)} voice is available from this device. Install a matching voice in system speech settings, then return to Little Say.</Notice>}
    </View>
    <Field label="Preview words" value={sample} onChangeText={setSample} maxLength={200} editable={!playing} />
    {Boolean(error) && <Notice>{error}</Notice>}
    {playing ? <Button kind="secondary" onPress={() => { request.current++; queue.stop(); setPlaying(false); }}>Stop preview</Button> : <Button icon={Volume2} disabled={busy || !sample.trim() || (source === 'device' && !matches.length)} onPress={() => void preview()}>Preview voice</Button>}
  </View>;
}
