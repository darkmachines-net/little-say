/** @file Keeps the prompt row fixed while AI replies and recovery controls scroll within the editor's height budget. */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, ScrollView, Text, TextInput, View, type TextInputInstance } from 'react-native';
import { ArrowUp, Keyboard as KeyboardIcon, Square, X } from 'lucide-react-native';
import { languageName } from '@little-say/core';
import { type useBoardAssistant } from '../services/useBoardAssistant';
import { Button, Notice, Sheet } from './components';
import { styles, theme } from './theme';

/**
 * Keep one mounted input and Send row outside the scrolling AI context. The editor supplies the
 * available height; long text scrolls in the input and long replies scroll above it, preserving the
 * prompt's full touch targets even when a keyboard leaves little room. Completed turns auto-apply.
 */
export function BoardAssistant({ assistant, disabled = false, compact = false, maxHeight, onFocusChange }: { assistant: ReturnType<typeof useBoardAssistant>; disabled?: boolean; compact?: boolean; maxHeight?: number;
  /** Report prompt focus without replacing the mounted input when the keyboard changes layout. */
  onFocusChange?: (focused: boolean) => void;
}) {
  const input = useRef<TextInputInstance>(null);
  useEffect(() => { if (assistant.scope) input.current?.focus(); }, [assistant.scope]);
  const [translations, setTranslations] = useState(false);
  const selected = assistant.preview.tiles.find(tile => tile.id === assistant.scope);
  const busy = Boolean(assistant.busy);
  const finishTyping = () => { input.current?.blur(); Keyboard.dismiss(); onFocusChange?.(false); };
  const context = Boolean(selected || assistant.reply || assistant.busy || assistant.error || assistant.mergeError || assistant.suggestion || assistant.progress || assistant.translations.length);
  const padding = compact ? 8 : 12;
  const inputHeight = Math.min(compact ? 86 : 110, Math.max(50, (maxHeight ?? 200) - padding * 2 - 2 - (context ? compact ? 6 : 10 : 0)));
  return <View testID="board-assistant" style={{ backgroundColor: theme.surface, borderRadius: 18, padding: compact ? 8 : 12, gap: compact ? 6 : 10, borderWidth: 1, borderColor: theme.line, maxHeight }}>
    {context && <ScrollView testID="assistant-context" keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ gap: compact ? 6 : 10 }}>
    {selected && <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.small}>{selected.label}</Text><Button compact kind="ghost" icon={X} accessibilityLabel="Apply AI request to the whole board" onPress={() => assistant.setScope(null)} /></View>}
    {Boolean(assistant.reply) && <Text accessibilityLiveRegion="polite" style={styles.body}>{assistant.reply}</Text>}
    {assistant.busy === 'generate' && <View testID="ai-working" style={styles.row}><ActivityIndicator color={theme.accent} /><Text accessibilityLiveRegion="polite" style={[styles.small, { flex: 1 }]}>{assistant.progress || 'Working…'}</Text></View>}
    {assistant.busy === 'save' && <Text accessibilityLiveRegion="polite" style={styles.small}>Saving changes…</Text>}
    {Boolean(assistant.error || assistant.mergeError) && <Notice>{assistant.error || assistant.mergeError}</Notice>}
    {assistant.suggestion && <View style={{ gap: 8 }}>
      {!busy && (assistant.conflicts.length > 0 ? <><Notice>{assistant.conflicts.join(', ')} changed while AI was working.</Notice><View style={[styles.row, { flexWrap: 'wrap' }]}><Button compact kind="secondary" disabled={disabled} onPress={() => void assistant.accept('current')}>Keep my edits</Button><Button compact disabled={disabled} onPress={() => void assistant.accept('suggested')}>Use suggested changes</Button></View></> : <Button compact disabled={disabled || Boolean(assistant.mergeError)} onPress={() => void assistant.accept()}>Retry saving AI changes</Button>)}
      {assistant.suggestion.base.tiles.some(tile => !assistant.suggestion!.board.tiles.some(next => next.id === tile.id)) && <Text style={styles.small}>Removing: {assistant.suggestion.base.tiles.filter(tile => !assistant.suggestion!.board.tiles.some(next => next.id === tile.id)).map(tile => tile.label).join(', ')}</Text>}
    </View>}
    {assistant.translations.length > 0 && <Button compact kind="secondary" disabled={busy || Boolean(assistant.suggestion)} onPress={() => setTranslations(true)}>Review translation replacements</Button>}
    {!busy && Boolean(assistant.progress) && <Text testID="picture-summary" style={styles.small}>{assistant.progress}</Text>}
    </ScrollView>}
    <View style={[styles.row, { alignItems: 'flex-end', flexShrink: 0, gap: compact ? 6 : 10 }]}>
      <TextInput ref={input} accessibilityLabel="Message to AI" accessibilityHint="Type or use your keyboard’s dictation, then send." value={assistant.prompt} onChangeText={assistant.setPrompt} onFocus={() => onFocusChange?.(true)} onBlur={() => onFocusChange?.(false)} editable={!disabled && assistant.busy !== 'save'} multiline maxLength={3800} placeholder={selected ? 'Change this card, e.g. “Say moo twice”' : assistant.preview.tiles.length ? 'Ask for a change, e.g. “Add a water card”' : 'Describe a board, e.g. “Six farm animals”'} placeholderTextColor={theme.muted} style={{ flex: 1, color: theme.ink, fontSize: 16, minHeight: Math.min(58, inputHeight), maxHeight: inputHeight, padding: 4, textAlignVertical: 'top' }} />
      {compact && <Button compact kind="ghost" icon={KeyboardIcon} accessibilityLabel="Done typing" onPress={finishTyping} />}
      {assistant.busy === 'generate' ? <Button compact kind="secondary" icon={Square} accessibilityLabel="Stop request" onPress={() => void assistant.stop()} /> : <Button compact icon={ArrowUp} accessibilityLabel="Send message" disabled={disabled || busy || Boolean(assistant.suggestion) || !assistant.prompt.trim()} onPress={() => { finishTyping(); void assistant.generate(); }} />}
    </View>
    {translations && <Sheet title="Review translation replacements" onClose={() => setTranslations(false)} footer={<><Button kind="secondary" onPress={() => setTranslations(false)}>Keep saved translations</Button><Button onPress={() => { void assistant.useTranslations(); setTranslations(false); }}>Use proposed translations</Button></>}>
      {assistant.translations.map(({ tileId, card, saved, proposed }) => <View key={`${tileId}:${saved.language}`} style={{ gap: 8 }}><Text style={styles.label}>{card} · {languageName(saved.language)}</Text><Text style={styles.body}>Saved: {saved.label} / {saved.speech}</Text><Text style={styles.body}>Proposed: {proposed.label} / {proposed.speech}</Text></View>)}
    </Sheet>}
  </View>;
}
