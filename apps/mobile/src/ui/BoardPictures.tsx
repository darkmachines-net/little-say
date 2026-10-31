/** @file Edits empty-board picture defaults and stages picture improvements for revision-checked apply. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { defaultPicturePolicy, type Board, type Settings } from '@little-say/core';
import { prepareBoardPictures } from '../services/pictures';
import { Button, Notice, Sheet } from './components';
import { PictureGenerationInfo, PicturePreferences } from './PicturePreferences';
import { TileFace } from './TileFace';
import { styles } from './theme';

/** Set defaults before creating cards, or prepare a detached picture draft for the revision originally opened. */
export function BoardPictures({ board, currentRevision, automatic = false, changedTileId, settings, onConsent, onApply, onClose }: { board: Board; currentRevision: number; automatic?: boolean; changedTileId?: string; settings: Settings; onConsent: () => Promise<void>; onApply: (draft: Board, baseRevision: number) => void; onClose: () => void }) {
  const [source] = useState(board);
  const [draft, setDraft] = useState(board);
  const [policy, setPolicy] = useState(board.picturePolicy ?? settings.pictureDefaults ?? defaultPicturePolicy);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [prepared, setPrepared] = useState(false);
  const request = useRef<AbortController | null>(null);
  const started = useRef(false);
  useEffect(() => () => request.current?.abort(), []);
  const close = () => { request.current?.abort(); onClose(); };
  const prepare = useCallback(async (restyle: boolean) => {
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setIssues([]); setPrepared(false);
    try {
      if (!settings.aiConsent) await onConsent();
      const result = await prepareBoardPictures({ ...source, picturePolicy: policy }, { ...settings, aiConsent: true }, { restyle, forceIds: changedTileId ? new Set([changedTileId]) : undefined, signal: controller.signal, progress: setMessage });
      if (request.current !== controller || controller.signal.aborted) return;
      setDraft(result.board); setIssues(result.issues); setPrepared(true);
    } catch (error) { if (!controller.signal.aborted) setIssues([(error as Error).message]); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); setMessage(''); } }
  }, [changedTileId, onConsent, policy, settings, source]);
  useEffect(() => { if (automatic && !started.current) { started.current = true; void prepare(false); } }, [automatic, prepare]);
  return <Sheet title="Board pictures" onClose={close} wide footer={<Button disabled={busy || (Boolean(source.tiles.length) && !prepared)} onPress={() => { if (currentRevision !== source.revision) { setIssues(['This board changed. Close and reopen Pictures to keep your latest edits.']); return; } onApply(source.tiles.length ? draft : { ...source, picturePolicy: policy }, source.revision); onClose(); }}>{source.tiles.length ? 'Apply pictures' : 'Save picture settings'}</Button>}>
    <PicturePreferences value={policy} disabled={busy} onChange={value => { setPolicy(value); setPrepared(false); }} />
    <PictureGenerationInfo />
    <Text style={styles.small}>Improve pictures keeps suitable saved illustrations. Restyle board revisits all pictures that follow the board. Your photos and pictures marked “Keep this picture” stay in place.</Text>
    {source.tiles.length > 0 && <View style={styles.wrap}><Button busy={busy} onPress={() => void prepare(false)}>Improve pictures</Button><Button disabled={busy} kind="secondary" onPress={() => void prepare(true)}>Restyle board</Button>{busy && <Button kind="ghost" onPress={() => request.current?.abort()}>Stop pictures</Button>}</View>}
    {Boolean(message) && <Text accessibilityLiveRegion="polite" style={styles.small}>{message}</Text>}
    {issues.map((issue, index) => <Notice key={index}>{issue}</Notice>)}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{draft.tiles.map(tile => <View key={tile.id} style={{ width: 140, height: 150 }}><TileFace tile={tile} compact size={64} /></View>)}</View>
  </Sheet>;
}
