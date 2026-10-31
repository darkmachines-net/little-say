/** @file Limits board play to user languages and stages missing translations and audio for preparation. */

import { useEffect, useRef, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { applyLanguageSetup, applyTranslations, canonicalLanguage, hasTileLanguage, languageName, missingTranslations, profileLanguages, storedTileTranslation, tileInLanguage, tileSource, type Board, type BoardChanges, type Settings } from '@little-say/core';
import { prepareTranslations } from '../services/api';
import type { SpeechLibrary } from '../services/speechLibrary';
import { BoardAudio } from './BoardAudio';
import { Button, Notice, Sheet } from './components';
import { styles, theme } from './theme';

/**
 * Restrict play to a nonempty subset of the user profile without editing that profile or deleting
 * saved words. Prepare only missing translations for switchable cards; review before applying to
 * the original revision. Audio generation fills missing clips independently of translation review.
 */
export function BoardLanguages({ board, settings, audio, onManageLanguages, onChange, onConsent, onClose }: { board: Board; settings: Settings; audio: SpeechLibrary; onManageLanguages: () => void; onChange: (changes: BoardChanges, expectedRevision?: number) => void; onConsent: () => Promise<void>; onClose: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Board | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const selected = board.playLanguages ?? [];
  const contains = (tag: string) => selected.some(value => canonicalLanguage(value) === canonicalLanguage(tag));
  const preferred = profileLanguages(settings);
  const limited = Boolean(board.playLanguageSubset);
  const toggle = (tag: string) => {
    setError('');
    const languages = contains(tag) ? selected.filter(value => canonicalLanguage(value) !== canonicalLanguage(tag)) : [...selected, tag];
    if (!languages.length) { setError('Keep at least one language for play.'); return; }
    onChange({ playLanguageSubset: languages });
  };
  const prepare = async () => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError('');
    try {
      const request = missingTranslations(board);
      let ready = board;
      if (request) {
        if (!settings.aiConsent) await onConsent();
        if (abort.signal.aborted) return;
        const result = await prepareTranslations(settings.backendUrl, request, abort.signal);
        ready = { ...board, tiles: applyTranslations(board, result) };
      }
      if (controller.current === abort && !abort.signal.aborted) setProposal(ready);
    } catch (e) { if (controller.current === abort && !abort.signal.aborted) setError((e as Error).message); }
    finally { if (controller.current === abort && !abort.signal.aborted) setBusy(false); }
  };
  const missing = missingTranslations(board);
  const switchable = board.tiles.filter(tile => tile.languageMode === 'board').length;
  const needsReview = board.tiles.filter(tile => tile.languageMode === 'board').flatMap(tile => (tile.translations ?? []).filter(value => contains(value.language) && value.origin !== 'generated' && value.source !== tileSource(tile))).length;
  if (proposal) return <Sheet title="Review translations" subtitle="Review the words before saving them to this board." onClose={() => setProposal(null)} footer={<Button onPress={() => {
    try { onChange(applyLanguageSetup(board, proposal), proposal.revision); setProposal(null); }
    catch (e) { setError((e as Error).message); setProposal(null); }
  }}>Use translations</Button>}>
    <Text style={styles.body}>{proposal.title} · {proposal.tiles.length} cards</Text>
    {proposal.tiles.filter(tile => tile.languageMode === 'board').map(tile => <View key={tile.id} style={[styles.card, { gap: 8 }]}>
      <Text style={styles.label}>{tile.label}</Text>
      {(proposal.playLanguages ?? []).map(tag => {
        if (!hasTileLanguage(tile, tag)) {
          const saved = storedTileTranslation(tile, tag);
          return <View key={tag} style={{ gap: 2 }}><Text style={styles.small}>{languageName(tag)} — {saved ? 'saved words need review' : 'translation missing'}</Text>{saved && <Text style={styles.body}>{saved.label} · says "{saved.speech}"</Text>}</View>;
        }
        const version = tileInLanguage(tile, tag);
        return <View key={tag} style={{ gap: 2 }}><Text style={styles.small}>{languageName(tag)}</Text><Text style={styles.body}>{version.label}{version.speech !== version.label ? ` · says “${version.speech}”` : ''}</Text></View>;
      })}
    </View>)}
    <Text style={styles.small}>Audio for AI voices prepares in the background after saving. Device speech works while clips are missing.</Text>
  </Sheet>;
  return <Sheet title="Board languages" onClose={onClose}>
    {busy && <View style={styles.row}><Text accessibilityLiveRegion="polite" style={styles.body}>Preparing translations…</Text><Button kind="ghost" onPress={() => { controller.current?.abort(); setBusy(false); }}>Cancel</Button></View>}
    {Boolean(error) && <Notice>{error}</Notice>}
    {needsReview > 0 && <Notice>{needsReview} saved translations need review after an original-word change. They are protected from automatic replacement; review them in their card editors.</Notice>}
    <View style={{ gap: 14 }}>
      <Text style={styles.label}>Languages for play</Text>
      <Text style={styles.body}>{limited ? 'Choose which of your languages are available for play.' : 'This board follows your languages in Settings, including languages you add later.'}</Text>
      <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={[styles.body, { flex: 1 }]}>Limit languages for this board</Text><Switch accessibilityLabel="Limit languages for this board" disabled={busy} value={limited} onValueChange={value => { setError(''); onChange({ playLanguageSubset: value ? selected : undefined }); }} /></View>
      {limited ? <View style={{ gap: 8 }}>{preferred.map(tag => <Pressable key={tag} accessibilityRole="checkbox" accessibilityLabel={`Play language ${languageName(tag)}`} aria-checked={contains(tag)} accessibilityState={{ checked: contains(tag), disabled: busy }} disabled={busy} onPress={() => toggle(tag)} style={[styles.row, { minHeight: 50, padding: 14, borderRadius: 14, backgroundColor: contains(tag) ? theme.accentSoft : theme.surface }]}><Text style={{ ...styles.body, color: theme.accent }}>{contains(tag) ? '✓' : '○'}</Text><Text style={styles.body}>{languageName(tag)}</Text></Pressable>)}</View> : <Text style={styles.body}>{selected.map(languageName).join(' · ')}</Text>}
      <Button kind="ghost" disabled={busy} onPress={onManageLanguages}>Manage your languages in Settings</Button>
    </View>
    <View style={{ gap: 14 }}>
        <Text style={styles.label}>Translations</Text>
        <Text style={styles.small}>{switchable} of {board.tiles.length} cards follow the board language. Change individual cards in their editor.</Text>
        {switchable < board.tiles.length && <Button kind="secondary" disabled={busy} onPress={() => onChange({ tiles: board.tiles.map(t => ({ ...t, languageMode: 'board' })) })}>Make all cards switchable</Button>}
        <Button disabled={busy} kind="ghost" onPress={() => onChange({ translateLabels: board.translateLabels === false })}>{board.translateLabels === false ? 'Switch spoken words only' : 'Switch labels and spoken words'}</Button>
        {!settings.aiConsent && <Text style={styles.small}>Translates with OpenAI. Review words before saving.</Text>}
        <Button kind="secondary" busy={busy} disabled={!missing} onPress={() => void prepare()}>{missing ? `Prepare translations (${missing.tiles.reduce((sum, t) => sum + t.targets.length, 0)})` : needsReview ? 'Saved translations need review' : switchable ? 'Translations ready' : 'No switchable cards'}</Button>
    </View>
    <View style={{ gap: 14 }}><Text style={styles.label}>Audio</Text><BoardAudio board={board} settings={settings} audio={audio} disabled={busy} /><Text style={styles.small}>Missing translations must be saved before their audio can be prepared. Device speech works while clips are missing.</Text></View>
  </Sheet>;
}
