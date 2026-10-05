/**
 * @file Hosts parent AI conversations with voice input, editable board drafts, and explicit apply
 * controls.
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ArrowUp, Mic, Plus, ShieldCheck, Square, X } from 'lucide-react-native';
import { MAX_AI_TURNS, boardContext, defaultPicturePolicy, getLanguageProfile, languageName, profileLanguages, validateGeneratedBoard, type Board, type BoardProposal, type ConversationTurn, type Settings } from '@little-say/core';
import { apiFetch, proposeBoard } from '../services/api';
import { useRecording } from '../services/useRecording';
import { Button, ModalBackdrop, Notice } from './components';
import { TileFace } from './TileFace';
import { theme, styles } from './theme';
import { MountainMark } from './Brand';
import { PicturePermission, PicturePreferences } from './PicturePreferences';
import { prepareProposalPictures, proposalPreview } from '../services/pictures';

function Working({ label }: { label: string }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    let live = true;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: true, isInteraction: false }),
      Animated.timing(pulse, { toValue: 0, duration: 750, useNativeDriver: true, isInteraction: false }),
    ]));
    const motion = (reduce: boolean) => { if (!live) return; animation.stop(); pulse.setValue(0); if (!reduce) animation.start(); };
    void AccessibilityInfo.isReduceMotionEnabled().then(motion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', motion);
    return () => { live = false; clearInterval(timer); animation.stop(); subscription.remove(); };
  }, [pulse]);
  return <View testID="ai-working" accessibilityLabel={label} style={{ padding: 18, backgroundColor: theme.surface, borderRadius: 20, gap: 12, alignSelf: 'flex-start' }}>
    <View accessible={false} style={styles.row}>{['#CCEFDF', '#FFDCC2', '#E2D8FF'].map((color, i) => <Animated.View key={color} style={{ width: 22, height: 22, borderRadius: 8, backgroundColor: color, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: i === 1 ? [1, 0.45] : [0.45, 1] }), transform: [{ translateY: pulse.interpolate({ inputRange: [0, 1], outputRange: i === 1 ? [-3, 0] : [0, -3] }) }] }} />)}</View>
    <Text style={styles.body}>{label}{seconds > 0 ? ` · ${seconds}s` : ''}</Text>
    {seconds >= 15 && <Text style={styles.small}>Still waiting for a reply. You can stop and try again.</Text>}
  </View>;
}

/**
 * Render a creation or editing conversation that preserves the source board until Apply, supports
 * follow-up prompts, and cancels outstanding work when dismissed by the close button or outside tap.
 * Dismissal is disabled during an in-progress save or consent update.
 */
export function AiConversation({ settings, board, onApply, onConsent, onClose, onManual }: { settings: Settings; board?: Board; onApply: (proposal: BoardProposal) => Promise<void>; onConsent: () => Promise<void>; onClose: () => void; onManual?: () => void }) {
  // Keep IDs/revision stable throughout all turns, even as background audio updates.
  const [source] = useState(board);
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<ConversationTurn[]>([]);
  const [draft, setDraft] = useState<BoardProposal | null>(null);
  const [picturePolicy, setPicturePolicy] = useState(source?.picturePolicy ?? settings.pictureDefaults ?? defaultPicturePolicy);
  const [pictureOptionsOpen, setPictureOptionsOpen] = useState(false);
  const [allowPictures, setAllowPictures] = useState(Boolean(settings.autoImages && settings.aiConsent));
  const [pictureMessage, setPictureMessage] = useState('');
  const [pictureIssues, setPictureIssues] = useState<string[]>([]);
  const [clarifying, setClarifying] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [busy, setBusy] = useState<'generate' | 'transcribe' | 'microphone' | 'save' | null>(null);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [consenting, setConsenting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const pending = useRef<(() => void) | null>(null);
  const request = useRef<AbortController | null>(null);
  const live = useRef(true);
  const saving = useRef(false);
  const transcript = useRef<ScrollView>(null);
  const input = useRef<TextInput>(null);
  const nearBottom = useRef(true);
  const recording = useRecording(setError);
  const finishRef = useRef<() => void>(() => {});
  const { width, height } = useWindowDimensions();
  const title = source ? 'Edit with AI' : 'New board';
  const atLimit = history.length >= MAX_AI_TURNS;
  const picturesChanged = Boolean(draft?.proposal.picturePolicy && JSON.stringify(picturePolicy) !== JSON.stringify(draft.proposal.picturePolicy));
  useEffect(() => { live.current = true; return () => { live.current = false; request.current?.abort(); }; }, []);
  useEffect(() => {
    if (!recording.recording) return;
    setSeconds(0);
    const started = Date.now();
    const timer = setInterval(() => { const elapsed = Math.floor((Date.now() - started) / 1000); setSeconds(elapsed); if (elapsed >= 60) { clearInterval(timer); finishRef.current(); } }, 250);
    return () => clearInterval(timer);
  }, [recording.recording]);
  const allowed = (action: () => void) => { if (settings.aiConsent) action(); else { pending.current = action; setConsent(true); } };
  const close = () => { if (saving.current || consenting) return; request.current?.abort(); void recording.cleanup(); onClose(); };
  const cancel = () => {
    request.current?.abort(); request.current = null;
    void recording.cleanup(); setBusy(null);
    if (submitted) setPrompt(submitted);
    setSubmitted(null); setError('Stopped. You can edit your message and send it again.');
  };
  const generate = async () => {
    const message = prompt.trim();
    if (!message || request.current || saving.current || atLimit) return;
    const controller = new AbortController(); request.current = controller;
    nearBottom.current = true;
    setError(''); setPictureMessage(''); setPictureIssues([]); setBusy('generate'); setSubmitted(message); setPrompt('');
    try {
      const response = await proposeBoard(settings.backendUrl, {
        prompt: message, board: source ? boardContext(source) : null, languageProfile: getLanguageProfile(settings),
        picturePolicy, pictureCapability: 1,
        conversation: { history, draft: draft ? { ...draft.proposal, ...(draft.proposal.picturePolicy ? { picturePolicy } : {}) } : null },
      }, controller.signal);
      if (!live.current || request.current !== controller) return;
      if (response.boardId !== (source?.id ?? null) || response.baseRevision !== (source?.revision ?? null)) throw new Error('This reply refers to a different board. Please try again.');
      validateGeneratedBoard(response.proposal, source ? boardContext(source) : null);
      setHistory(old => [...old, { prompt: message, reply: response.proposal.explanation }]);
      setClarifying(response.proposal.needsClarification);
      setSubmitted(null);
      if (!response.proposal.needsClarification) {
        setDraft(response);
        if (response.proposal.picturePolicy) {
          setPicturePolicy(response.proposal.picturePolicy);
          const prepared = await prepareProposalPictures(source, response, { ...settings, aiConsent: true }, { signal: controller.signal, allowGeneration: allowPictures, progress: setPictureMessage }, draft);
          if (!live.current || request.current !== controller) return;
          setDraft(prepared.proposal); setPictureIssues(prepared.issues);
        }
      }
    } catch (e) {
      if (live.current && request.current === controller) { setError((e as Error).message); setPrompt(message); }
    } finally {
      if (live.current && request.current === controller) { request.current = null; setBusy(null); setSubmitted(null); }
    }
  };
  const start = async () => {
    if (request.current || saving.current) return;
    const controller = new AbortController(); request.current = controller;
    setError(''); setBusy('microphone');
    try { await recording.start(); } catch (e) { if (live.current && request.current === controller) setError((e as Error).message); }
    finally { if (live.current && request.current === controller) { request.current = null; setBusy(null); } }
  };
  const finish = async () => {
    if (request.current || saving.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy('transcribe'); setError(''); nearBottom.current = true;
    try {
      const body = await recording.stop();
      if (controller.signal.aborted || !live.current) return;
      const result = await apiFetch(settings.backendUrl, '/api/transcribe', { method: 'POST', body }, controller.signal);
      if (live.current && request.current === controller) {
        setPrompt(current => (current.trim() ? `${current.trim()} ${result.text}` : result.text).slice(0, 4000));
        input.current?.focus();
      }
    } catch (e) { if (live.current && request.current === controller) setError((e as Error).message); }
    finally { if (request.current === controller) { await recording.cleanup(); if (live.current) { request.current = null; setBusy(null); } } }
  };
  finishRef.current = () => { void finish(); };
  const updatePictures = async () => {
    if (!draft || request.current) return;
    const controller = new AbortController(); request.current = controller; setBusy('generate'); setPictureIssues([]);
    try {
      const preview = proposalPreview(source, draft);
      const next = { ...draft, pictures: undefined, proposal: { ...draft.proposal, picturePolicy, tiles: draft.proposal.tiles.map((tile, index) => ({ ...tile, replacePicture: !preview.tiles[index].pictureOptions?.locked && preview.tiles[index].illustration.kind !== 'photo' })) } };
      const prepared = await prepareProposalPictures(source, next, { ...settings, aiConsent: true }, { signal: controller.signal, allowGeneration: allowPictures, progress: setPictureMessage });
      if (live.current && request.current === controller) { setDraft(prepared.proposal); setPictureIssues(prepared.issues); }
    } catch (error) { if (!controller.signal.aborted) setError((error as Error).message); }
    finally { if (request.current === controller) { request.current = null; setBusy(null); setPictureMessage(''); } }
  };
  const apply = async () => {
    if (!draft || request.current || saving.current) return;
    saving.current = true; setBusy('save'); setError('');
    try { await onApply(draft); if (live.current) onClose(); }
    catch (e) { if (live.current) setError((e as Error).message || 'The board could not be saved. Please try again.'); }
    finally { saving.current = false; if (live.current) setBusy(null); }
  };
  return <Modal transparent animationType="fade" visible onRequestClose={close} statusBarTranslucent>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined} style={{ flex: 1, backgroundColor: theme.scrim, justifyContent: 'center', alignItems: 'center', padding: width < 600 ? 8 : 24 }}>
      <ModalBackdrop onClose={close} />
      <View accessibilityViewIsModal testID="ai-conversation" style={{ width: '100%', maxWidth: 760, height: Math.min(860, height - (width < 600 ? 24 : 64)), maxHeight: '100%', backgroundColor: theme.background, borderRadius: 24, overflow: 'hidden' }}>
        <View style={[styles.row, { backgroundColor: theme.surface, padding: 16, borderBottomWidth: 1, borderColor: theme.line }]}>
          <MountainMark size={44} />
          <View style={{ flex: 1, gap: 3 }}><Text accessibilityRole="header" style={styles.title}>{title}</Text><Text numberOfLines={1} style={styles.small}>{source?.title ?? profileLanguages(settings).map(languageName).join(' · ')}</Text></View>
          <Button kind="ghost" compact icon={X} disabled={busy === 'save' || consenting} accessibilityLabel={`Close ${title}`} onPress={close} />
        </View>
        {consent ? <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
          <ShieldCheck size={32} color={theme.accent} /><Text accessibilityRole="header" style={styles.title}>Use AI services?</Text>
          <Text style={styles.body}>Your messages and board words go through your home server to OpenAI. Voice prompts also send your microphone recording for transcription. Photos are not sent to AI. Optional account sync can back them up to your server.</Text>
          <Text style={styles.body}>Generated voices are saved on your server and device for reuse. You can turn automatic audio off in Parent settings. Microphone recordings aren’t retained by this app, and message content isn’t logged. OpenAI’s data retention policies still apply.</Text>
          {Boolean(error) && <Notice>{error}</Notice>}
          <Button busy={consenting} onPress={() => { setConsenting(true); void onConsent().then(() => { if (!live.current) return; setConsent(false); const action = pending.current; pending.current = null; action?.(); }).catch(() => { if (live.current) setError('Could not save this preference. Check device storage.'); }).finally(() => { if (live.current) setConsenting(false); }); }}>Continue with AI</Button>
          <Button kind="ghost" disabled={consenting} onPress={() => { pending.current = null; setConsent(false); setError(''); }}>Back to message</Button>
        </ScrollView> : <>
          <ScrollView ref={transcript} testID="ai-transcript" keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ padding: 18, gap: 18 }} scrollEventThrottle={100} onScroll={event => { const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent; nearBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80; }} onContentSizeChange={() => { if (nearBottom.current) transcript.current?.scrollToEnd({ animated: false }); }}>
            {!history.length && !submitted && <View style={{ gap: 16 }}>
              <Text style={styles.body}>{source ? 'What would you like to change? You can review the draft and keep adjusting it here.' : 'What would you like on your board? Type a message or use the microphone.'}</Text>
              {!source && <View style={styles.wrap}>{[['🐾 Farm animals', 'Create six farm animal tiles including cow, sheep, and horse.'], ['🥣 Snack time', 'Create six things a toddler might ask for at snack time.'], ['👋 My family', 'Create six family tiles for mother, father, grandmother, grandfather, sister, and brother.']].map(([label, value]) => <Button key={label} kind="secondary" disabled={Boolean(busy) || recording.recording} onPress={() => { setPrompt(value); input.current?.focus(); }}>{label}</Button>)}</View>}
              {onManual && <Button kind="ghost" icon={Plus} onPress={onManual}>Build manually</Button>}
            </View>}
            {history.map((turn, index) => <View key={index} style={{ gap: 14 }}>
              <View style={{ alignSelf: 'flex-end', maxWidth: '92%', borderRadius: 18, borderBottomRightRadius: 5, padding: 14, backgroundColor: theme.accentSoft }}><Text style={{ ...styles.body, color: theme.ink }}>{turn.prompt}</Text></View>
              <View style={{ alignSelf: 'flex-start', maxWidth: '96%', borderRadius: 18, borderBottomLeftRadius: 5, padding: 14, backgroundColor: theme.surface }}><Text accessibilityLiveRegion={index === history.length - 1 ? 'polite' : 'none'} style={styles.body}>{turn.reply}</Text></View>
            </View>)}
            {submitted && <View style={{ alignSelf: 'flex-end', maxWidth: '92%', borderRadius: 18, padding: 14, backgroundColor: theme.accentSoft }}><Text style={{ ...styles.body, color: theme.ink }}>{submitted}</Text></View>}
            <Button compact kind="secondary" disabled={Boolean(busy)} onPress={() => setPictureOptionsOpen(value => !value)}>{pictureOptionsOpen ? 'Hide picture settings' : 'Picture settings'}</Button>
            {pictureOptionsOpen && <View style={{ gap: 12 }}><PicturePreferences value={picturePolicy} onChange={setPicturePolicy} disabled={Boolean(busy)} /><PicturePermission enabled={allowPictures} onChange={setAllowPictures} disabled={Boolean(busy)} />{draft && <Button disabled={Boolean(busy)} onPress={() => void updatePictures()}>Update draft pictures</Button>}</View>}
            {pictureIssues.map((issue, index) => <Notice key={index}>{issue}</Notice>)}
            {busy && busy !== 'save' && <Working key={busy} label={busy === 'generate' ? pictureMessage || 'Working on your draft…' : busy === 'transcribe' ? 'Transcribing your recording…' : 'Opening microphone…'} />}
            {draft && <View testID="ai-draft" style={{ padding: 12, borderRadius: 20, backgroundColor: theme.surface, gap: 10, opacity: busy === 'generate' ? 0.6 : 1 }}>
              <View style={{ gap: 3 }}><Text accessibilityRole="header" style={styles.title}>{draft.proposal.title}</Text><Text style={styles.small}>{draft.proposal.tiles.length} tiles · {clarifying || busy === 'generate' ? 'Previous draft' : 'Draft preview'}</Text></View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -3 }}>{draft.proposal.tiles.map((_tile, index) => {
                const preview = proposalPreview(source, draft).tiles[index];
                return <View key={index} style={{ width: width < 600 ? '33.3333%' : '25%', height: 96, padding: 3 }}><TileFace tile={preview} compact size={38} /></View>;
              })}</View>
            </View>}
          </ScrollView>
          <View style={{ padding: width < 600 ? 12 : 18, paddingTop: 12, gap: 10, backgroundColor: theme.surface, borderTopWidth: 1, borderColor: theme.line }}>
            {Boolean(error) && <Notice>{error}</Notice>}
            {draft && !clarifying && <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={[styles.small, { flex: 1 }]}>{picturesChanged ? 'Update draft pictures to apply these settings.' : prompt.trim() ? 'Send your message to update the draft.' : 'Ready to save, or keep adjusting below.'}</Text><Button disabled={Boolean(busy) || recording.recording || Boolean(prompt.trim()) || picturesChanged} busy={busy === 'save'} onPress={() => void apply()}>{source ? 'Apply changes' : 'Use this board'}</Button></View>}
            {atLimit ? <Text style={styles.body}>{draft && !clarifying ? 'Save this draft to continue in a new conversation.' : 'This conversation has reached its limit. Close it and start a new one.'}</Text> : <>
              <TextInput ref={input} accessibilityLabel="Message to AI" value={prompt} onChangeText={setPrompt} multiline maxLength={4000} editable={!busy && !recording.recording} placeholder={history.length ? 'Ask for a change or answer a question…' : source ? 'Add a goat, and keep everything else…' : 'A board with cow, sheep, horse…'} placeholderTextColor={theme.muted} style={[styles.field, { minHeight: 58, maxHeight: 112, textAlignVertical: 'top' }]} />
              <View style={[styles.row, { justifyContent: 'space-between' }]}>
                <Button kind={recording.recording ? 'danger' : 'ghost'} icon={recording.recording ? Square : Mic} onPress={() => recording.recording ? void finish() : allowed(() => void start())} disabled={Boolean(busy)} compact>{recording.recording ? `Stop · ${seconds}s / 60s` : 'Voice prompt'}</Button>
                {busy && busy !== 'save' ? <Button kind="secondary" icon={Square} onPress={cancel}>Stop request</Button> : <Button icon={ArrowUp} onPress={() => allowed(() => void generate())} disabled={Boolean(busy) || !prompt.trim() || recording.recording}>Send message</Button>}
              </View>
            </>}
          </View>
        </>}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
