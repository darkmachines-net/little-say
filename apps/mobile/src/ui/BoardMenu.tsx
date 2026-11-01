/** @file Provides missing-speech generation and confirmation of synced board deletion from the dashboard. */

import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AudioLines, Trash2 } from 'lucide-react-native';
import { boardAudioTiles, speechSource, type Board, type Settings } from '@little-say/core';
import { type SpeechLibrary } from '../services/speechLibrary';
import { Button, Notice, Sheet } from './components';
import { styles } from './theme';

/**
 * Show board actions, offering audio preparation only when clips are missing and requiring confirmation
 * before deletion, including its effect on other synced devices.
 */
export function BoardMenu({ board, settings, audio, onDelete, onClose }: {
  board: Board; settings: Settings; audio: SpeechLibrary; onDelete: () => void; onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const tiles = boardAudioTiles(board).filter(tile => speechSource(settings, tile.language) === 'ai');
  const missing = tiles.filter(tile => !audio.asset(tile));
  const waiting = missing.filter(tile => audio.status(tile).state !== 'preparing');
  const preparing = tiles.filter(tile => audio.status(tile).state === 'preparing').length;
  const failed = missing.some(tile => audio.status(tile).state === 'error');
  const generate = async () => {
    setBusy(true); setError('');
    try {
      const results = await Promise.allSettled(waiting.map(tile => audio.generate(tile, settings.backendUrl)));
      if (live.current && results.some(result => result.status === 'rejected')) setError('Some audio could not be generated. Check your connection and try again.');
    } catch { if (live.current) setError('Could not start audio generation. Please try again.'); }
    finally { if (live.current) setBusy(false); }
  };
  return <Sheet title={deleting ? 'Delete board?' : board.title} onClose={onClose}>
    {deleting ? <>
      <Text style={styles.body}>Delete “{board.title}”? This cannot be undone. The deletion syncs to your other devices.</Text>
      <View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap' }]}>
        <Button kind="ghost" onPress={() => setDeleting(false)}>Keep board</Button>
        <Button kind="danger" icon={Trash2} onPress={onDelete}>Delete board</Button>
      </View>
    </> : <>
      {(Boolean(error) || (failed && !busy)) && <Notice>{error || 'Some audio could not be generated. Check your connection and try again.'}</Notice>}
      {missing.length > 0 && <Button kind="secondary" icon={AudioLines} busy={busy || (waiting.length === 0 && preparing > 0)} onPress={() => void generate()}>{`Generate missing audio (${missing.length})`}</Button>}
      <Text accessibilityLiveRegion="polite" style={styles.small}>{preparing ? `Generating audio… ${tiles.length - missing.length} of ${tiles.length} saved.` : missing.length ? `${tiles.length - missing.length} of ${tiles.length} voices saved on this device.` : tiles.length ? 'All AI audio saved on this device.' : 'This board uses device voices.'}</Text>
      <Button kind="danger" icon={Trash2} onPress={() => setDeleting(true)}>Delete board</Button>
    </>}
  </Sheet>;
}
