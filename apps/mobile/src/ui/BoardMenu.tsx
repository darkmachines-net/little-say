/** @file Provides dashboard overflow actions for board deletion and missing speech generation. */

import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AudioLines, Trash2 } from 'lucide-react-native';
import { boardAudioTiles, type Board, type Settings } from '@little-say/core';
import { type SpeechLibrary } from '../services/speechLibrary';
import { Button, Notice, Sheet } from './components';
import { styles } from './theme';

/**
 * Show board actions, offering audio preparation only when clips are missing and requiring confirmation
 * before deletion.
 */
export function BoardMenu({ board, settings, audio, onConsent, onDelete, onClose }: {
  board: Board; settings: Settings; audio: SpeechLibrary; onConsent: () => Promise<void>; onDelete: () => void; onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const tiles = boardAudioTiles(board);
  const missing = tiles.filter(tile => !audio.asset(tile));
  const waiting = missing.filter(tile => audio.status(tile).state !== 'preparing');
  const preparing = tiles.filter(tile => audio.status(tile).state === 'preparing').length;
  const failed = missing.some(tile => audio.status(tile).state === 'error');
  const generate = async () => {
    setBusy(true); setError('');
    try {
      if (!settings.aiConsent) await onConsent();
      const results = await Promise.allSettled(waiting.map(tile => audio.generate(tile, settings.backendUrl)));
      if (live.current && results.some(result => result.status === 'rejected')) setError('Some audio could not be generated. Check your connection and try again.');
    } catch { if (live.current) setError('Could not start audio generation. Please try again.'); }
    finally { if (live.current) setBusy(false); }
  };
  return <Sheet title={deleting ? 'Delete board?' : board.title} onClose={onClose}>
    {deleting ? <>
      <Text style={styles.body}>Delete “{board.title}” from this device? This cannot be undone.</Text>
      <View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap' }]}>
        <Button kind="ghost" onPress={() => setDeleting(false)}>Keep board</Button>
        <Button kind="danger" icon={Trash2} onPress={onDelete}>Delete board</Button>
      </View>
    </> : <>
      {(Boolean(error) || (failed && !busy)) && <Notice>{error || 'Some audio could not be generated. Check your connection and try again.'}</Notice>}
      {missing.length > 0 && <Button kind="secondary" icon={AudioLines} busy={busy || (waiting.length === 0 && preparing > 0)} onPress={() => void generate()}>{`Generate missing audio (${missing.length})`}</Button>}
      <Text accessibilityLiveRegion="polite" style={styles.small}>{preparing ? `Generating audio… ${tiles.length - missing.length} of ${tiles.length} saved.` : missing.length ? `${tiles.length - missing.length} of ${tiles.length} voices saved on this device.` : 'All audio saved on this device.'}</Text>
      {missing.length > 0 && !settings.aiConsent && <Text style={styles.small}>Generating audio sends the card words to OpenAI through your server and saves the clips for offline play.</Text>}
      <Button kind="danger" icon={Trash2} onPress={() => setDeleting(true)}>Delete board</Button>
    </>}
  </Sheet>;
}
