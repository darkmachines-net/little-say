/**
 * @file Guides device language selection and review of generated starter boards before entering the
 * library.
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Check, ChevronLeft, WandSparkles } from 'lucide-react-native';
import * as Crypto from 'expo-crypto';
import { configureSetup, finishSetup, getLanguageProfile, languageName, profileLanguages, saveStarterDraft, starterBoard, starterPrompt, starterTopics, type Library, type StarterTopic } from '@little-say/core';
import { developmentApiUrl, proposeBoard } from '../services/api';
import { LanguageProfileEditor } from './LanguageProfileEditor';
import { Button, Field, Notice } from './components';
import { styles, theme } from './theme';
import { Brand } from './Brand';
import { defaultPicturePolicy } from '@little-say/core';
import { prepareProposalPictures } from '../services/pictures';

/**
 * Resume saved setup progress, generate starter drafts for the chosen languages, and commit the
 * parent-approved result through onCommit.
 */
export function FirstTimeSetup({ library, onCommit }: { library: Library; onCommit: (update: (current: Library) => Library) => Promise<void> }) {
  const setup = library.setup!;
  const [profile, setProfile] = useState(() => getLanguageProfile(library.settings));
  const [topics, setTopics] = useState(setup.topics);
  const [url, setUrl] = useState(library.settings.backendUrl);
  const [connection, setConnection] = useState(false);
  const [working, setWorking] = useState<'saving' | 'generating' | null>(null);
  const [error, setError] = useState('');
  const [jobs, setJobs] = useState<Partial<Record<StarterTopic, string>>>({});
  const controller = useRef<AbortController | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; controller.current?.abort(); }; }, []);
  const ready = topics.filter(topic => setup.drafts.some(draft => draft.topic === topic));
  const missing = topics.filter(topic => !ready.includes(topic));
  const persist = async (update: (current: Library) => Library) => {
    try { await onCommit(update); } catch { throw new Error('Setup could not be saved. Check available device storage and try again.'); }
  };
  const saveStep = async (update: (current: Library) => Library) => {
    setWorking('saving'); setError('');
    try { await persist(update); }
    catch (e) { if (live.current) setError((e as Error).message); }
    finally { if (live.current) setWorking(null); }
  };
  const generate = async () => {
    setWorking('generating'); setError(''); setJobs({});
    const abort = new AbortController(); controller.current = abort;
    try {
      await persist(current => ({ ...current, settings: { ...current.settings, backendUrl: url.trim().replace(/\/+$/, ''), aiConsent: true }, setup: { ...current.setup!, topics } }));
      let next = 0;
      const worker = async () => {
        while (next < missing.length && !abort.signal.aborted) {
          const topic = missing[next++];
          if (live.current) setJobs(current => ({ ...current, [topic]: 'Creating…' }));
          try {
            let proposal = await proposeBoard(url, { prompt: starterPrompt(topic), board: null, languageProfile: profile, pictureCapability: 1, picturePolicy: library.settings.pictureDefaults ?? defaultPicturePolicy }, abort.signal);
            if (proposal.proposal.picturePolicy) proposal = (await prepareProposalPictures(undefined, proposal, { ...library.settings, backendUrl: url, aiConsent: true }, { signal: abort.signal, progress: message => { if (live.current) setJobs(current => ({ ...current, [topic]: message })); } })).proposal;
            if (abort.signal.aborted) return;
            const board = starterBoard(proposal, profile, () => Crypto.randomUUID());
            await persist(current => saveStarterDraft(current, topic, board, profile));
            if (live.current) setJobs(current => ({ ...current, [topic]: 'Ready' }));
          } catch (e) {
            if (abort.signal.aborted) return;
            if (live.current) setJobs(current => ({ ...current, [topic]: (e as Error).message }));
          }
        }
      };
      await Promise.all([worker(), worker()]);
    } catch (e) { if (live.current && !abort.signal.aborted) setError((e as Error).message); }
    finally {
      if (live.current) { setWorking(null); if (abort.signal.aborted) setJobs({}); }
      if (controller.current === abort) controller.current = null;
    }
  };
  const languageStep = setup.stage === 'languages';
  return <View style={styles.page}>
    <View style={{ borderBottomWidth: 1, borderColor: theme.line, backgroundColor: theme.surface }}>
      <View style={[styles.container, styles.row, { minHeight: 76 }]}><Brand /></View>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.container, { maxWidth: 760, paddingVertical: 28, gap: 22 }]}>
      <View style={{ gap: 8 }}><Text style={styles.small}>{languageStep ? '1 of 2' : '2 of 2'}</Text><Text accessibilityRole="header" style={styles.heading}>{languageStep ? 'Choose your languages' : 'Your first boards'}</Text><Text style={styles.body}>{languageStep ? 'Choose the languages you use together, then pick a default. You can change these later in Parent settings.' : `Six cards per board, in ${profileLanguages({ languageProfile: profile }).map(languageName).join(' · ')}.`}</Text></View>
      {Boolean(error) && <Notice>{error}</Notice>}
      {languageStep ? <LanguageProfileEditor value={profile} onChange={setProfile} disabled={Boolean(working)} expanded /> : <>
        {starterTopics.map(topic => {
          const selected = topics.includes(topic.id);
          const draft = setup.drafts.find(value => value.topic === topic.id)?.board;
          return <View key={topic.id} style={[styles.card, { gap: 12, borderWidth: 2, borderColor: selected ? theme.accent : theme.line }]}>
            <Pressable accessibilityRole="checkbox" accessibilityLabel={`Include ${topic.title}`} accessibilityState={{ checked: selected, disabled: Boolean(working) }} disabled={Boolean(working)} onPress={() => {
              if (selected && topics.length === 1) { setError('Choose at least one board, or start without starter boards.'); return; }
              setTopics(current => selected ? current.filter(value => value !== topic.id) : [...current, topic.id]); setError('');
            }} style={[styles.row, { minHeight: 48 }]}>
              <Text accessible={false} style={{ fontSize: 36 }}>{topic.emoji}</Text><View style={{ flex: 1, gap: 4 }}><Text style={styles.title}>{draft?.title ?? topic.title}</Text>{draft && <Text style={styles.small}>{topic.title}</Text>}</View>{selected && <Check color={theme.accent} size={23} />}
            </Pressable>
            {selected && <Text accessibilityLiveRegion="polite" style={styles.small}>{draft ? `Ready · ${draft.tiles.map(tile => tile.label).join(' · ')}` : jobs[topic.id] ?? '6 cards'}</Text>}
          </View>;
        })}
        {working !== 'generating' && <View style={{ gap: 12 }}>
          <Button kind="ghost" disabled={Boolean(working)} onPress={() => setConnection(value => !value)}>Connection settings</Button>
          {connection && (developmentApiUrl ? <Field label="Development server address" value={developmentApiUrl} editable={false} /> : <Field label="Private server address" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder={Platform.OS === 'web' ? 'Automatic — this website’s server' : 'https://say.your-home-domain.com'} />)}
          {missing.length > 0 && <Text style={styles.small}>Generation uses OpenAI through your server. Your language choices and board topics are sent to create the cards. Boards stay on this device. AI audio prepares in the background after setup; device speech works while clips are missing.</Text>}
        </View>}
      </>}
    </ScrollView>
    <View style={{ borderTopWidth: 1, borderColor: theme.line, backgroundColor: theme.surface }}><View style={[styles.container, { maxWidth: 760, paddingVertical: 16, gap: 10 }]}>
      {languageStep ? <Button busy={Boolean(working)} onPress={() => { setJobs({}); void saveStep(current => configureSetup(current, profile, url)); }}>Continue</Button> : <>
        {working === 'generating' ? <View style={[styles.row, { justifyContent: 'space-between' }]}><View style={styles.row}><ActivityIndicator color={theme.accent} /><Text accessibilityLiveRegion="polite" style={styles.body}>{ready.length} of {topics.length} boards ready</Text></View><Button kind="ghost" onPress={() => controller.current?.abort()}>Stop</Button></View> : <>
          {missing.length > 0 ? <Button icon={WandSparkles} disabled={Boolean(working)} onPress={() => void generate()}>{ready.length || Object.keys(jobs).length ? 'Retry missing boards' : 'Generate starter boards'}</Button> : <Button busy={Boolean(working)} onPress={() => void saveStep(current => finishSetup({ ...current, settings: { ...current.settings, backendUrl: url.trim().replace(/\/+$/, '') } }, topics))}>Open my boards</Button>}
          {ready.length > 0 && missing.length > 0 && <Button kind="secondary" disabled={Boolean(working)} onPress={() => void saveStep(current => finishSetup(current, ready))}>{`Use ${ready.length} ready ${ready.length === 1 ? 'board' : 'boards'}`}</Button>}
          <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Button kind="ghost" icon={ChevronLeft} disabled={Boolean(working)} onPress={() => void saveStep(current => ({ ...current, setup: { ...current.setup!, stage: 'languages' } }))}>Languages</Button><Button kind="ghost" disabled={Boolean(working)} onPress={() => void saveStep(current => finishSetup({ ...current, settings: { ...current.settings, backendUrl: url.trim().replace(/\/+$/, '') } }, topics, false))}>Start without starter boards</Button></View>
        </>}
      </>}
    </View></View>
  </View>;
}
