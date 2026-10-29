/** @file Renders the compact AI composer and contextual review actions without a conversation transcript. */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View, type TextInputInstance } from 'react-native';
import { ArrowUp, Info, Square, X } from 'lucide-react-native';
import { conversationPrompts, languageName } from '@little-say/core';
import { type useBoardAssistant } from '../services/useBoardAssistant';
import { Button, Notice, Sheet } from './components';
import { pictureDataDisclosure } from './PicturePreferences';
import { styles, theme } from './theme';

/** Keep prompting beside the editable canvas, with only the current question or suggestion visible. */
export function BoardAssistant({ assistant, disabled = false }: { assistant: ReturnType<typeof useBoardAssistant>; disabled?: boolean }) {
  const input = useRef<TextInputInstance>(null);
  useEffect(() => { if (assistant.scope) input.current?.focus(); }, [assistant.scope]);
  const [info, setInfo] = useState(false);
  const [translations, setTranslations] = useState(false);
  const selected = assistant.preview.tiles.find(tile => tile.id === assistant.scope);
  const busy = Boolean(assistant.busy);
  const fill = (text: string) => { assistant.setPrompt(text); input.current?.focus(); };
  return <View testID="board-assistant" style={{ backgroundColor: theme.surface, borderRadius: 18, padding: 12, gap: 10, borderWidth: 1, borderColor: theme.line }}>
    {selected && <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.small}>{selected.label}</Text><Button compact kind="ghost" icon={X} accessibilityLabel="Apply AI request to the whole board" onPress={() => assistant.setScope(null)} /></View>}
    {Boolean(assistant.reply) && <Text accessibilityLiveRegion="polite" style={styles.body}>{assistant.reply}</Text>}
    {assistant.busy === 'generate' && <View testID="ai-working" style={styles.row}><ActivityIndicator color={theme.accent} /><Text accessibilityLiveRegion="polite" style={[styles.small, { flex: 1 }]}>{assistant.progress || 'Working…'}</Text></View>}
    {Boolean(assistant.error || assistant.mergeError) && <Notice>{assistant.error || assistant.mergeError}</Notice>}
    {assistant.suggestion && <View style={{ gap: 8 }}>
      {assistant.conflicts.length > 0 ? <><Notice>{assistant.conflicts.join(', ')} changed while AI was working.</Notice><View style={[styles.row, { flexWrap: 'wrap' }]}><Button compact kind="secondary" disabled={disabled || assistant.busy === 'save'} onPress={() => void assistant.accept('current')}>Keep my edits</Button><Button compact disabled={disabled || assistant.busy === 'save'} onPress={() => void assistant.accept('suggested')}>Use suggested changes</Button></View></> : <View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap' }]}><Button compact kind="ghost" disabled={assistant.busy === 'save'} onPress={assistant.clear}>Dismiss</Button><Button compact busy={assistant.busy === 'save'} disabled={disabled || Boolean(assistant.mergeError)} onPress={() => void assistant.accept()}>Keep changes</Button></View>}
      {assistant.conflicts.length > 0 && <Button compact kind="ghost" disabled={assistant.busy === 'save'} onPress={assistant.clear}>Dismiss</Button>}
      {assistant.suggestion.base.tiles.some(tile => !assistant.suggestion!.board.tiles.some(next => next.id === tile.id)) && <Text style={styles.small}>Removing: {assistant.suggestion.base.tiles.filter(tile => !assistant.suggestion!.board.tiles.some(next => next.id === tile.id)).map(tile => tile.label).join(', ')}</Text>}
      {assistant.translations.length > 0 && <Button compact kind="secondary" disabled={busy} onPress={() => setTranslations(true)}>Review translation replacements</Button>}
    </View>}
    {!busy && Boolean(assistant.progress) && <Text testID="picture-summary" style={styles.small}>{assistant.progress}</Text>}
    <View style={[styles.row, { alignItems: 'flex-end' }]}>
      <TextInput ref={input} accessibilityLabel="Message to AI" accessibilityHint="Type or use your keyboard’s dictation, then send." value={assistant.prompt} onChangeText={assistant.setPrompt} editable={!disabled && assistant.busy !== 'save'} multiline maxLength={3800} placeholder={assistant.preview.tiles.length ? 'Ask AI for a change…' : 'Describe a board…'} placeholderTextColor={theme.muted} style={{ flex: 1, color: theme.ink, fontSize: 16, minHeight: 58, maxHeight: 110, padding: 4, textAlignVertical: 'top' }} />
      {assistant.busy === 'generate' ? <Button compact kind="secondary" icon={Square} accessibilityLabel="Stop request" onPress={assistant.stop} /> : <Button compact icon={ArrowUp} accessibilityLabel="Send message" disabled={disabled || busy || !assistant.prompt.trim()} onPress={() => void assistant.generate()} />}
    </View>
    <View style={[styles.row, { flexWrap: 'wrap', gap: 6 }]}>{(assistant.preview.tiles.length ? [['Add a drink', 'Add a drink and keep the other cards.'], ['Shorter words', 'Use shorter spoken words and keep the cards in place.']] : [['Farm animals', conversationPrompts.farm], ['Snack time', conversationPrompts.snack]]).map(([label, prompt]) => <Button key={label} compact kind="secondary" disabled={disabled || busy} onPress={() => fill(prompt)}>{label}</Button>)}<Button kind="ghost" compact icon={Info} accessibilityLabel="About AI" onPress={() => setInfo(true)} /></View>
    {info && <Sheet title="About AI" onClose={() => setInfo(false)}><Text style={styles.body}>Messages and board words go to AI when you send. {pictureDataDisclosure}</Text></Sheet>}
    {translations && <Sheet title="Review translation replacements" onClose={() => setTranslations(false)} footer={<><Button kind="secondary" onPress={() => setTranslations(false)}>Keep saved translations</Button><Button onPress={() => { assistant.useTranslations(); setTranslations(false); }}>Use proposed translations</Button></>}>
      {assistant.translations.map(({ tileId, card, saved, proposed }) => <View key={`${tileId}:${saved.language}`} style={{ gap: 8 }}><Text style={styles.label}>{card} · {languageName(saved.language)}</Text><Text style={styles.body}>Saved: {saved.label} / {saved.speech}</Text><Text style={styles.body}>Proposed: {proposed.label} / {proposed.speech}</Text></View>)}
    </Sheet>}
  </View>;
}
