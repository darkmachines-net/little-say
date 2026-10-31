/**
 * @file Hosts a cancellable board conversation with explicit board saves and Save draft or Discard exits.
 */

import { conversationPrompts } from '@little-say/core';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, BackHandler, Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View, useWindowDimensions, type ScrollViewInstance, type TextInputInstance } from 'react-native';
import { ArrowLeft, ArrowUp, SlidersHorizontal, Square } from 'lucide-react-native';
import { MAX_AI_TURNS, boardContext, boardCreationDraftSchema, defaultPicturePolicy, getLanguageProfile, languageName, profileLanguages, proposalTranslationReplacements, validateGeneratedBoard, type Board, type BoardCreationDraft, type BoardProposal, type ConversationTurn, type Settings } from '@little-say/core';
import { proposeBoard } from '../services/api';
import { Button, Notice, Sheet } from './components';
import { DraftCanvas } from './DraftCanvas';
import { theme, styles } from './theme';
import { MountainMark } from './Brand';
import { PictureGenerationInfo, PicturePreferences, pictureDataDisclosure } from './PicturePreferences';
import { prepareProposalPictures, proposalPreview, type PictureTileState } from '../services/pictures';

function Working({ label, pictures = false }: { label: string; pictures?: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    let live = true;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: Platform.OS !== 'web', isInteraction: false }),
      Animated.timing(pulse, { toValue: 0, duration: 750, useNativeDriver: Platform.OS !== 'web', isInteraction: false }),
    ]));
    const motion = (reduce: boolean) => { if (!live) return; animation.stop(); pulse.setValue(0); if (!reduce) { animation.reset(); animation.start(); } };
    void AccessibilityInfo.isReduceMotionEnabled().then(motion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', motion);
    return () => { live = false; clearInterval(timer); animation.stop(); subscription.remove(); };
  }, [pulse]);
  return <View testID="ai-working" accessibilityLabel={label} style={{ padding: 18, backgroundColor: theme.surface, borderRadius: 20, gap: 12, alignSelf: 'flex-start' }}>
    <View accessible={false} style={styles.row}>{['#CCEFDF', '#FFDCC2', '#E2D8FF'].map((color, i) => <Animated.View key={color} style={{ width: 22, height: 22, borderRadius: 8, backgroundColor: color, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: i === 1 ? [1, 0.45] : [0.45, 1] }), transform: [{ translateY: pulse.interpolate({ inputRange: [0, 1], outputRange: i === 1 ? [-3, 0] : [0, -3] }) }] }} />)}</View>
    <Text style={styles.body}>{label}{seconds > 0 ? ` · ${seconds}s` : ''}</Text>
    {seconds >= 15 && <Text style={styles.small}>{pictures ? 'Clear pictures stay in place while the remaining cards get pictures. You can stop at any time.' : 'Still working. You can stop and try again.'}</Text>}
  </View>;
}

/**
 * Render a creation or editing conversation that preserves the source board until Apply, supports
 * follow-up prompts, and cancels outstanding work when the parent leaves the workspace.
 * Text entry supports system keyboard dictation; explicit sends enable AI without an interstitial.
 * Creation exits cancel pending work and ask whether to save the last completed draft or discard.
 * Empty drafts cannot be saved. Failed writes leave the workspace open for retry. Saved creation
 * state is restored only on mount; editing existing boards retains its direct cancellation path.
 * onSaveDraft/onDiscardDraft resolve after durable retention/removal; onBeforeClose registers the
 * browser exit guard and clears it on unmount. Successful board application bypasses this prompt.
 * onAiUse persists the legacy AI-enabled preference.
 * onApply's second argument authorizes replacing protected manual/legacy translations for this
 * draft only; it is true only after explicit parent review and must not authorize another draft.
 */
export function AiConversation({ settings, board, savedDraft, onSaveDraft, onDiscardDraft, onBeforeClose, onApply, onAiUse, onClose, onSpeechReady }: { settings: Settings; board?: Board; savedDraft?: BoardCreationDraft; onSaveDraft: (draft: BoardCreationDraft) => Promise<void>; onDiscardDraft: () => Promise<void>; onBeforeClose: (request: (() => void) | null) => void; onApply: (proposal: BoardProposal, replaceTranslations?: boolean) => Promise<void>; onAiUse: () => Promise<void>; onClose: () => void; onSpeechReady?: () => Promise<void> }) {
  // Keep IDs/revision stable throughout all turns, even as background audio updates.
  const [source] = useState(board);
  const [prompt, setPrompt] = useState(savedDraft?.prompt ?? '');
  const [history, setHistory] = useState<ConversationTurn[]>(savedDraft?.history ?? []);
  const [draft, setDraft] = useState<BoardProposal | null>(savedDraft?.draft ?? null);
  const [translationReview, setTranslationReview] = useState(false);
  const [reviewedDraft, setReviewedDraft] = useState<BoardProposal | null>(null);
  const [picturePolicy, setPicturePolicy] = useState(savedDraft?.picturePolicy ?? source?.picturePolicy ?? settings.pictureDefaults ?? defaultPicturePolicy);
  const [pictureOptionsOpen, setPictureOptionsOpen] = useState(false);
  const [pictureMessage, setPictureMessage] = useState('');
  const [pictureIssues, setPictureIssues] = useState<string[]>([]);
  const [tileStates, setTileStates] = useState<Record<string, PictureTileState>>({});
  const policyRef = useRef(picturePolicy); policyRef.current = picturePolicy;
  const draftBeforeRequest = useRef<BoardProposal | null>(null);
  const [clarifying, setClarifying] = useState(savedDraft?.clarifying ?? false);
  const [leaving, setLeaving] = useState(false);
  const [exitError, setExitError] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [busy, setBusy] = useState<'generate' | 'save' | null>(null);
  const [saveable, setSaveable] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const live = useRef(true);
  const saving = useRef(false);
  const transcript = useRef<ScrollViewInstance>(null);
  const input = useRef<TextInputInstance>(null);
  const nearBottom = useRef(true);
  const { width, height } = useWindowDimensions();
  const title = source ? 'Edit with AI' : 'New board';
  const atLimit = history.length >= MAX_AI_TURNS;
  const sideBySide = width >= 800;
  const picturesChanged = Boolean(draft?.proposal.picturePolicy && JSON.stringify(picturePolicy) !== JSON.stringify(draft.proposal.picturePolicy));
  useEffect(() => { live.current = true; return () => { live.current = false; request.current?.abort(); }; }, []);
  const close = () => {
    if (saving.current) return;
    if (source) { request.current?.abort(); onClose(); return; }
    if (request.current) { cancel(); setError(''); }
    Keyboard.dismiss();
    setPictureOptionsOpen(false); setTranslationReview(false);
    setExitError(''); setLeaving(true);
  };
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => { const subscription = BackHandler.addEventListener('hardwareBackPress', () => { closeRef.current(); return true; }); return () => subscription.remove(); }, []);
  useEffect(() => {
    if (source) return;
    onBeforeClose(() => closeRef.current());
    return () => onBeforeClose(null);
  }, [source, onBeforeClose]);
  const enableAi = async (controller: AbortController) => {
    if (!settings.aiConsent) await onAiUse();
    return live.current && request.current === controller && !controller.signal.aborted;
  };
  const pictureCallbacks = (controller: AbortController, envelope: BoardProposal) => ({
    available: () => { if (live.current && request.current === controller) setSaveable(true); },
    speechReady: onSpeechReady,
    progress: (message: string) => { if (live.current && request.current === controller) setPictureMessage(message); },
    tileProgress: (id: string, state: PictureTileState) => { if (live.current && request.current === controller) setTileStates(old => ({ ...old, [id]: state })); },
    preview: (board: Board) => { if (live.current && request.current === controller) setDraft({ ...envelope, pictures: board.tiles.map((tile, index) => ({ index, illustration: tile.illustration, concept: tile.pictureConcept })) }); },
  });
  const cancel = () => {
    request.current?.abort(); request.current = null;
    setBusy(null); setPictureMessage(''); setSaveable(false);
    if (busy === 'generate') {
      setTileStates({}); setDraft(draftBeforeRequest.current);
      if (!submitted && draftBeforeRequest.current?.proposal.picturePolicy) setPicturePolicy(draftBeforeRequest.current.proposal.picturePolicy);
    }
    if (submitted) setPrompt(submitted);
    setSubmitted(null); setError('Stopped. You can edit your message and send it again.');
  };
  const generate = async () => {
    const message = prompt.trim();
    if (!message || request.current || saving.current || atLimit) return;
    const controller = new AbortController(); request.current = controller;
    nearBottom.current = true;
    draftBeforeRequest.current = draft;
    const requestedPolicy = picturePolicy;
    setError(''); setPictureMessage(''); setPictureIssues([]); setTileStates({}); setSaveable(false); setBusy('generate'); setSubmitted(message); setPrompt('');
    try {
      if (!await enableAi(controller)) return;
      const response = await proposeBoard(settings.backendUrl, {
        prompt: message, board: source ? boardContext(source) : null, languageProfile: getLanguageProfile(settings),
        picturePolicy, pictureCapability: 1,
        ...(draft?.preparation ? { previousPreparationId: draft.preparation.id } : {}),
        conversation: { history, draft: draft ? { ...draft.proposal, ...(draft.proposal.picturePolicy ? { picturePolicy } : {}) } : null },
      }, controller.signal);
      if (!live.current || request.current !== controller) return;
      if (response.boardId !== (source?.id ?? null) || response.baseRevision !== (source?.revision ?? null)) throw new Error('This reply refers to a different board. Please try again.');
      validateGeneratedBoard(response.proposal, source ? boardContext(source) : null);
      if (!response.proposal.needsClarification) {
        // Validate the retained-translation merge before rendering or downloading pictures.
        proposalPreview(source, response);
        if (!response.preparation) setDraft(response);
        if (response.proposal.picturePolicy) {
          if (policyRef.current === requestedPolicy) setPicturePolicy(response.proposal.picturePolicy);
          const prepared = await prepareProposalPictures(source, response, { ...settings, aiConsent: true }, { signal: controller.signal, ...pictureCallbacks(controller, response) }, draft);
          if (!live.current || request.current !== controller) return;
          setDraft(prepared.proposal); setPictureIssues(prepared.issues);
        }
      }
      // A stopped picture request discards the whole turn, including its conversation context.
      setHistory(old => [...old, { prompt: message, reply: response.proposal.explanation }]);
      setClarifying(response.proposal.needsClarification);
      setSubmitted(null);
    } catch (e) {
      if (live.current && request.current === controller) { setError((e as Error).message); setPrompt(message); }
    } finally {
      if (live.current && request.current === controller) { request.current = null; setBusy(null); setSubmitted(null); }
    }
  };
  const updatePictures = async (policy = picturePolicy) => {
    if (!draft || request.current) return;
    setError(''); setPicturePolicy(policy);
    const controller = new AbortController(); request.current = controller; draftBeforeRequest.current = draft; setSaveable(false); setBusy('generate'); setPictureIssues([]); setTileStates({});
    try {
      if (!await enableAi(controller)) return;
      const preview = proposalPreview(source, draft);
      const next = { ...draft, preparation: undefined, proposal: { ...draft.proposal, picturePolicy: policy, tiles: draft.proposal.tiles.map((tile, index) => ({ ...tile, replacePicture: !preview.tiles[index].pictureOptions?.locked && preview.tiles[index].illustration.kind !== 'photo' })) } };
      const prepared = await prepareProposalPictures(source, next, { ...settings, aiConsent: true }, { signal: controller.signal, ...pictureCallbacks(controller, next) });
      if (live.current && request.current === controller) { setDraft(prepared.proposal); setPictureIssues(prepared.issues); }
    } catch (error) { if (!controller.signal.aborted) setError((error as Error).message); }
    finally { if (request.current === controller) { request.current = null; setBusy(null); setPictureMessage(''); } }
  };
  const apply = async () => {
    if (!draft || (request.current && !saveable) || saving.current) return;
    const visible = draft;
    // Detach before aborting so rejected polls and late downloads cannot change the saved snapshot.
    const pending = request.current; request.current = null; pending?.abort(); setSaveable(false); setSubmitted(null); setPictureMessage('');
    setTileStates(old => Object.fromEntries(Object.entries(old).map(([id, state]) => [id, state === 'ready' ? state : 'fallback'])));
    saving.current = true; setBusy('save'); setError('');
    try { await onApply(visible, reviewedDraft === visible); if (live.current) onClose(); }
    catch (e) { if (live.current) setError((e as Error).message || 'The board could not be saved. Please try again.'); }
    finally { saving.current = false; if (live.current) setBusy(null); }
  };
  const hasProgress = Boolean(prompt.trim() || history.length || draft);
  const leave = async (saveDraft: boolean) => {
    if (saving.current || (saveDraft && !hasProgress)) return;
    saving.current = true; setBusy('save'); setExitError('');
    try {
      if (saveDraft) await onSaveDraft(boardCreationDraftSchema.parse({ prompt, history, draft, picturePolicy, clarifying }));
      else await onDiscardDraft();
      if (live.current) onClose();
    } catch { if (live.current) setExitError(saveDraft ? 'Your draft could not be saved. Please try again.' : 'Your draft could not be discarded. Please try again.'); }
    finally { saving.current = false; if (live.current) setBusy(null); }
  };
  const keepEditing = () => { if (!saving.current) { setLeaving(false); setExitError(''); } };
  const replacements = draft ? proposalTranslationReplacements(source, draft) : [];
  const preview = draft ? proposalPreview(source, draft, reviewedDraft === draft) : source ?? null;
  const canvasMessage = busy === 'generate' ? pictureMessage || 'Updating your board…' : clarifying ? 'Waiting for your answer · Your current draft stays here.' : '';
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined} testID="ai-conversation" style={{ flex: 1, backgroundColor: theme.background }}>
    <View style={{ backgroundColor: theme.surface, borderBottomWidth: 1, borderColor: theme.line }}><View style={[styles.row, { width: '100%', maxWidth: 1440, alignSelf: 'center', padding: width < 600 ? 10 : 16, gap: 10 }]}>
      <Button kind="ghost" compact icon={ArrowLeft} disabled={busy === 'save'} accessibilityLabel={source ? 'Back to board' : 'Back to boards'} onPress={close} />
      {sideBySide && <MountainMark size={40} />}
      <View style={{ flex: 1, gap: 3 }}><Text accessibilityRole="header" style={styles.title}>{title}</Text><Text numberOfLines={1} style={styles.small}>{source?.title ?? profileLanguages(settings).map(languageName).join(' · ')}</Text></View>
      <Button kind="ghost" compact icon={SlidersHorizontal} disabled={busy === 'save'} accessibilityLabel="Picture settings" onPress={() => setPictureOptionsOpen(true)}>{sideBySide ? 'Picture settings' : undefined}</Button>
    </View></View>
    <View style={{ flex: 1, minHeight: 0, width: '100%', maxWidth: 1440, alignSelf: 'center', padding: width < 600 ? 8 : 18, gap: 16, flexDirection: sideBySide ? 'row' : 'column-reverse' }}>
      <View testID="ai-chat-panel" style={{ flex: sideBySide ? 0.85 : 1, minHeight: 0, minWidth: 0, backgroundColor: theme.surface, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: theme.line }}>
        <ScrollView ref={transcript} testID="ai-transcript" keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 18 }} scrollEventThrottle={100} onScroll={event => { const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent; nearBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80; }} onContentSizeChange={() => { if (nearBottom.current && (history.length > 0 || submitted || busy)) transcript.current?.scrollToEnd({ animated: false }); }}>
          {!history.length && !submitted && <View style={{ gap: 16 }}>
            <Text style={styles.body}>{source ? 'What would you like to change? Your board will update alongside the conversation.' : 'What would you like on your board? Type a message or use your keyboard’s dictation.'}</Text>
            <Text style={styles.small}>Messages and board words go to AI. {pictureDataDisclosure}</Text>
            {!source && <View style={{ gap: 8 }}>{[['🐾 Farm animals', conversationPrompts.farm], ['🥣 Snack time', conversationPrompts.snack], ['👋 My family', conversationPrompts.family]].map(([label, value]) => <Button key={label} kind="secondary" disabled={Boolean(busy)} onPress={() => { setPrompt(value); input.current?.focus(); }}>{label}</Button>)}</View>}
          </View>}
          {history.map((turn, index) => <View key={index} style={{ gap: 14 }}>
            <View style={{ alignSelf: 'flex-end', maxWidth: '96%', borderRadius: 18, borderBottomRightRadius: 5, padding: 14, backgroundColor: theme.accentSoft }}><Text style={{ ...styles.body, color: theme.ink }}>{turn.prompt}</Text></View>
            <View style={{ alignSelf: 'flex-start', borderRadius: 18, borderBottomLeftRadius: 5, padding: 4 }}><Text accessibilityLiveRegion={index === history.length - 1 ? 'polite' : 'none'} style={styles.body}>{turn.reply}</Text></View>
          </View>)}
          {submitted && <View style={{ alignSelf: 'flex-end', maxWidth: '96%', borderRadius: 18, padding: 14, backgroundColor: theme.accentSoft }}><Text style={{ ...styles.body, color: theme.ink }}>{submitted}</Text></View>}
          {busy === 'generate' && <Working pictures={Boolean(pictureMessage)} label={pictureMessage || 'Working on your draft…'} />}
        </ScrollView>
        <View style={{ padding: width < 600 ? 10 : 16, gap: 10, borderTopWidth: 1, borderColor: theme.line }}>
          {Boolean(error) && <Notice>{error}</Notice>}
          {atLimit ? <Text style={styles.body}>{draft && !clarifying ? 'Save this draft to continue in a new conversation.' : 'This conversation has reached its limit. Go back and start a new one.'}</Text> : <>
            <TextInput ref={input} accessibilityLabel="Message to AI" accessibilityHint="Type or use your keyboard’s dictation, then send your message." value={prompt} onChangeText={setPrompt} multiline maxLength={4000} editable={!busy} placeholder={history.length ? 'Ask for a change or answer a question…' : source ? 'Add a goat, and keep everything else…' : 'A board with cow, sheep, horse…'} placeholderTextColor={theme.muted} style={[styles.field, { minHeight: 58, maxHeight: 112, textAlignVertical: 'top' }]} />
            <View style={[styles.row, { justifyContent: 'flex-end' }]}>
              {busy === 'generate' ? <Button compact kind="secondary" icon={Square} onPress={cancel}>Stop request</Button> : <Button compact icon={ArrowUp} onPress={() => void generate()} disabled={Boolean(busy) || !prompt.trim()}>Send message</Button>}
            </View>
          </>}
        </View>
      </View>
      <View style={{ flex: sideBySide ? 1.15 : undefined, height: sideBySide ? undefined : Math.min(preview ? 480 : 170, height * (preview ? 0.5 : 0.25)), minHeight: 0, minWidth: 0, gap: 10 }}>
        <DraftCanvas board={preview} states={tileStates} message={canvasMessage} compact={!sideBySide} />
        {replacements.length > 0 && <View style={{ gap: 6 }}><Text style={styles.small}>{reviewedDraft === draft ? 'Reviewed translation replacements will be applied.' : `${replacements.length} saved translations will be kept. Review proposed replacements separately.`}</Text><Button compact kind="secondary" disabled={Boolean(busy)} onPress={() => setTranslationReview(true)}>Review translation replacements</Button></View>}
        {pictureIssues.length > 0 && <Text testID="picture-summary" accessibilityLiveRegion="polite" style={styles.small}>{pictureIssues.join(' ')}</Text>}
        {draft && !clarifying && <View style={{ gap: 6 }}>{(!pictureIssues.length || Boolean(busy) || picturesChanged || Boolean(prompt.trim())) && <Text style={styles.small}>{busy === 'generate' ? saveable ? 'You can save these pictures now. Saving stops remaining picture work.' : 'Improving the remaining pictures. Clear pictures stay in place.' : picturesChanged ? 'Update draft pictures to apply your source choice.' : prompt.trim() ? 'Send your message to update the draft.' : 'Ready to save, or keep adjusting in the conversation.'}</Text>}<Button disabled={(Boolean(busy) && !saveable) || Boolean(prompt.trim()) || picturesChanged} busy={busy === 'save'} onPress={() => void apply()}>{source ? 'Apply changes' : 'Use this board'}</Button></View>}
      </View>
    </View>
    {leaving && <Sheet title="Save your draft?" onClose={keepEditing} footer={<>
      <Button disabled={!hasProgress || busy === 'save'} onPress={() => void leave(true)}>Save draft</Button>
      <Button kind="danger" disabled={busy === 'save'} onPress={() => void leave(false)}>Discard</Button>
      <Button kind="ghost" disabled={busy === 'save'} onPress={keepEditing}>Keep editing</Button>
    </>}>
      <Text style={styles.body}>{hasProgress ? 'Save your progress to finish this board later, or discard it and start fresh.' : 'There’s nothing to save yet. Discard to return to your boards, or keep editing.'}</Text>
      {busy === 'save' && <Text accessibilityLiveRegion="polite" style={styles.small}>Saving…</Text>}
      {Boolean(exitError) && <Notice>{exitError}</Notice>}
    </Sheet>}
    {translationReview && draft && <Sheet title="Review translation replacements" onClose={() => setTranslationReview(false)} footer={<><Button kind="secondary" onPress={() => { setReviewedDraft(null); setTranslationReview(false); }}>Keep saved translations</Button><Button onPress={() => { setReviewedDraft(draft); setTranslationReview(false); }}>Use proposed translations</Button></>}>
      <Text style={styles.body}>These saved words are protected. Compare each change before choosing replacements. Nothing is saved until you apply the board.</Text>
      {replacements.map(({ tileId, card, saved, proposed }) => <View key={`${tileId}:${saved.language}`} style={[styles.card, { gap: 8 }]}><Text style={styles.label}>{card} - {languageName(saved.language)}</Text><Text style={styles.body}>Saved: {saved.label} / {saved.speech}</Text><Text style={styles.body}>Proposed: {proposed.label} / {proposed.speech}</Text></View>)}
    </Sheet>}
    {pictureOptionsOpen && <Sheet title="Picture settings" onClose={() => setPictureOptionsOpen(false)} footer={<Button onPress={() => setPictureOptionsOpen(false)}>Done</Button>}>
      <PicturePreferences value={picturePolicy} onChange={setPicturePolicy} disabled={busy === 'save'} /><PictureGenerationInfo />
      {busy === 'generate' && <Text style={styles.small}>Current pictures are still being prepared. Changes here apply to your next update.</Text>}
      {draft && <Button disabled={Boolean(busy)} onPress={() => { setPictureOptionsOpen(false); void updatePictures(); }}>Update draft pictures</Button>}
    </Sheet>}
  </KeyboardAvoidingView>;
}
