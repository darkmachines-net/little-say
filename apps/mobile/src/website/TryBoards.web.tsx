/** @file Offers disposable public starter boards with prepared AI audio and device fallback, without account or generation services. */

import { useEffect, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Plus from 'lucide-react-native/icons/plus';
import { createStarterBoards } from '@little-say/core/starterBoards';
import { type Board, type Settings } from '@little-say/core';
import { accountPath } from '../services/accountRoute';
import { getVoices, type Voice } from '../services/speech.web';
import { AppHeader } from '../ui/AppHeader';
import { BoardCard } from '../ui/BoardCard';
import { PlayBoard } from '../ui/PlayBoard';
import { Button, Sheet } from '../ui/components';
import { styles, theme } from '../ui/theme';
import { useStarterAudio } from './useStarterAudio.web';

const settings: Settings = {
  backendUrl: '', voices: {}, activeBoardId: null, aiConsent: false, autoSpeech: false,
  voiceSources: { 'en-US': 'ai' }, languageProfile: { languages: ['en-US'], defaultLanguage: 'en-US' },
};
const keepLanguage = async () => {};

function StarterTrial() {
  const audioAsset = useStarterAudio();
  const { width } = useWindowDimensions();
  const [boards] = useState(() => {
    let id = 0;
    return createStarterBoards(() => `trial-${id++}`);
  });
  const [playing, setPlaying] = useState<Board | null>(null);
  const [accountRequired, setAccountRequired] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const columns = width > 1050 ? 3 : width > 620 ? 2 : 1;
  const requireAccount = () => setAccountRequired(true);
  useEffect(() => {
    let active = true;
    const refresh = () => { void getVoices().then(next => { if (active) setVoices(current => JSON.stringify(current) === JSON.stringify(next) ? current : next); }).catch(() => {}); };
    refresh();
    const timer = setTimeout(refresh, 1000);
    window.speechSynthesis?.addEventListener('voiceschanged', refresh);
    return () => { active = false; clearTimeout(timer); window.speechSynthesis?.removeEventListener('voiceschanged', refresh); };
  }, []);
  useEffect(() => {
    if (!accountRequired) return;
    // React Native Web enables its modal Escape handler after the opening animation completes.
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setAccountRequired(false); } };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [accountRequired]);
  if (playing) return <PlayBoard board={playing} settings={settings} voices={voices} audioAsset={audioAsset} onLanguageChange={keepLanguage} backLabel="Back to starter boards" onEdit={() => setPlaying(null)} />;
  return <View style={styles.page}>
    <AppHeader actions={<Button kind="secondary" onPress={() => window.location.assign(accountPath('login'))}>Sign in</Button>} />
    <ScrollView testID="starter-trial" style={{ flex: 1 }} contentContainerStyle={[styles.container, { paddingTop: 24, paddingBottom: 32, gap: 24 }]}>
      <View style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={styles.heading}>Try a starter board</Text>
        <Text style={styles.body}>Choose Play, then tap the pictures to hear the words. No account needed.</Text>
        <View style={[styles.row, { flexWrap: 'wrap', justifyContent: 'space-between', gap: 16 }]}>
          <Text style={[styles.small, { flexShrink: 1 }]}>Make these boards your own with a free account.</Text>
          <Button icon={Plus} onPress={requireAccount}>New board</Button>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8, rowGap: 16 }}>
        {boards.map(board => <View key={board.id} style={{ width: `${100 / columns}%`, paddingHorizontal: 8 }}>
          <BoardCard board={board} wide={width > 620} onPlay={() => setPlaying(board)} onEdit={requireAccount} onMore={requireAccount} onFavorite={requireAccount} />
        </View>)}
      </View>
    </ScrollView>
    {accountRequired && <Sheet title="Make it yours" onClose={() => setAccountRequired(false)}>
      <Text style={styles.body}>Create a free account to create, edit, and save your own boards. You can keep playing these starter boards without an account.</Text>
      <Button onPress={() => window.location.assign(accountPath('register'))}>Create a free account</Button>
      <Button kind="ghost" onPress={() => setAccountRequired(false)}>Keep trying</Button>
    </Sheet>}
  </View>;
}

/** Mount the web-only trial with the same safe-area layout and player as the signed-in app; all trial state is disposable. */
export default function TryBoards() {
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}><SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}><StarterTrial /></SafeAreaView></SafeAreaProvider>;
}
