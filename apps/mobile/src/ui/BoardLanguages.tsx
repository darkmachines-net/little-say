import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { applyLanguageSetup, applyTranslations, canonicalLanguage, languageName, missingTranslations, profileLanguages, suggestedPlayLanguages, tileInLanguage, type Board, type BoardChanges, type Settings } from '@little-say/core';
import { prepareTranslations } from '../services/api';
import { Button, Notice, Sheet } from './components';
import { styles } from './theme';
import { LanguageChoices } from './LanguageChoices';

export function BoardLanguages({ board, settings, onChange, onConsent, onClose }: { board: Board; settings: Settings; onChange: (changes: BoardChanges) => void; onConsent: () => Promise<void>; onClose: () => void }) {
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<{ board: Board; setup: boolean } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const selected = board.playLanguages ?? [];
  const contains = (tag: string) => selected.some(value => canonicalLanguage(value) === canonicalLanguage(tag));
  const suggested = suggestedPlayLanguages(board, settings);
  const quickSetup = suggested.length > 1 && (selected.length < 2 || board.tiles.every(tile => tile.languageMode !== 'board'));
  const setupLabel = suggested.map(languageName).join(' + ');
  const toggle = (tag: string) => {
    setError('');
    if (!contains(tag) && selected.length >= 6) { setError('Choose up to six languages for this board.'); return; }
    onChange({ playLanguages: contains(tag) ? selected.filter(value => canonicalLanguage(value) !== canonicalLanguage(tag)) : [...selected, canonicalLanguage(tag)] });
  };
  const prepare = async (candidate: Board, setup = false) => {
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError('');
    try {
      const request = missingTranslations(candidate);
      let ready = candidate;
      if (request) {
        if (!settings.aiConsent) await onConsent();
        if (abort.signal.aborted) return;
        const result = await prepareTranslations(settings.backendUrl, request, abort.signal);
        ready = { ...candidate, tiles: applyTranslations(candidate, result) };
      }
      if (!abort.signal.aborted) setProposal({ board: ready, setup });
    } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  };
  const missing = missingTranslations(board);
  if (proposal) return <Sheet title={proposal.setup ? 'Review board languages' : 'Review translations'} subtitle="The language buttons will appear above the tiles in Play." onClose={() => setProposal(null)} footer={<Button onPress={() => {
    try { onChange(applyLanguageSetup(board, proposal.board)); onClose(); }
    catch (e) { setError((e as Error).message); setProposal(null); }
  }}>{proposal.setup ? 'Use these languages' : 'Use translations'}</Button>}>
    <Text style={styles.body}>{proposal.board.title} · {proposal.board.tiles.length} cards</Text>
    {proposal.board.tiles.filter(tile => tile.languageMode === 'board').map(tile => <View key={tile.id} style={[styles.card, { gap: 8 }]}>
      <Text style={styles.label}>{tile.label}</Text>
      {(proposal.board.playLanguages ?? []).map(tag => {
        const version = tileInLanguage(tile, tag);
        return <View key={tag} style={{ gap: 2 }}><Text style={styles.small}>{languageName(tag)}</Text><Text style={styles.body}>{version.label}{version.speech !== version.label ? ` · says “${version.speech}”` : ''}</Text></View>;
      })}
    </View>)}
    <Text style={styles.small}>Audio prepares in the background when automatic AI audio is enabled. Device speech works while clips are missing.</Text>
  </Sheet>;
  return <Sheet title="Board languages" onClose={onClose}>
    {quickSetup && <View style={[styles.card, { gap: 12 }]}>
      <Button busy={busy} onPress={() => void prepare({ ...board, playLanguages: suggested, tiles: board.tiles.map(tile => ({ ...tile, languageMode: 'board' })) }, true)}>{setupLabel}</Button>
      <Text style={styles.body}>Make all {board.tiles.length} cards switch between {suggested.map(languageName).join(', ')}. Review the words before saving.</Text>
      <Text style={styles.small}>You can keep individual cards in one language from their tile editor.</Text>
      {!settings.aiConsent && <Text style={styles.small}>Tile words are sent to OpenAI through your server for translation.</Text>}
    </View>}
    {busy && <View style={styles.row}><Text accessibilityLiveRegion="polite" style={styles.body}>Preparing translations…</Text><Button kind="ghost" onPress={() => { controller.current?.abort(); setBusy(false); }}>Cancel</Button></View>}
    {Boolean(error) && <Notice>{error}</Notice>}
    <View style={{ gap: 14 }}>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Text style={styles.label}>Play languages</Text><Button disabled={busy} kind="secondary" onPress={() => setChoosing(value => !value)}>{choosing ? 'Done choosing' : 'Choose languages'}</Button></View>
      {!choosing && <Text style={styles.body}>{selected.length ? selected.map(languageName).join(' · ') : 'No language toggle set up yet'}</Text>}
      {choosing && <><Text style={styles.small}>Choose up to six languages to switch between during play. Your device languages appear first.</Text><LanguageChoices selected={selected} preferred={profileLanguages(settings)} onChoose={toggle} label="play language" multiple disabled={busy} /></>}
      {selected.length > 0 && <>
        <Text style={styles.small}>{board.tiles.filter(t => t.languageMode === 'board').length} of {board.tiles.length} cards follow the board language. Change individual cards in their editor.</Text>
        <Button kind="secondary" disabled={busy || board.tiles.every(t => t.languageMode === 'board')} onPress={() => onChange({ tiles: board.tiles.map(t => ({ ...t, languageMode: 'board' })) })}>Make all cards switchable</Button>
        <Button disabled={busy} kind="ghost" onPress={() => onChange({ translateLabels: board.translateLabels === false })}>{board.translateLabels === false ? 'Switch spoken words only' : 'Switch labels and spoken words'}</Button>
        {!settings.aiConsent && <Text style={styles.small}>Translates with OpenAI. Review words before saving.</Text>}
        <Button kind="secondary" busy={busy} disabled={!missing} onPress={() => void prepare(board)}>{missing ? `Prepare translations (${missing.tiles.reduce((sum, t) => sum + t.targets.length, 0)})` : 'Translations ready'}</Button>
      </>}
    </View>
  </Sheet>;
}
