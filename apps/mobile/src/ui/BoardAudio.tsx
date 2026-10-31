/** @file Shows saved board audio coverage and retries only missing clips for languages using AI voices. */

import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Volume2 } from 'lucide-react-native';
import { boardAudioTiles, speechSource, type Board, type Settings } from '@little-say/core';
import type { SpeechLibrary } from '../services/speechLibrary';
import { Button, Notice } from './components';
import { styles } from './theme';

/**
 * Prepare missing AI audio for an effective-language board without regenerating saved clips. Report
 * partial failure and ignore completion after leaving; synthesis may finish and cache for later use.
 */
export function BoardAudio({ board, settings, audio, disabled = false }: { board: Board; settings: Settings; audio: SpeechLibrary; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const tiles = boardAudioTiles(board).filter(tile => speechSource(settings, tile.language) === 'ai');
  const missing = tiles.filter(tile => !audio.asset(tile) && audio.status(tile).state !== 'preparing');
  const ready = tiles.filter(tile => audio.asset(tile)).length;
  const preparing = tiles.filter(tile => audio.status(tile).state === 'preparing').length;
  const failed = missing.some(tile => audio.status(tile).state === 'error');
  const generate = async () => {
    setBusy(true); setError('');
    const results = await Promise.allSettled(missing.map(tile => audio.generate(tile, settings.backendUrl)));
    if (!live.current) return;
    if (results.some(result => result.status === 'rejected')) setError('Some audio could not be generated. Check your connection and try again.');
    setBusy(false);
  };
  return <View style={{ gap: 8 }}>
    <Text accessibilityLiveRegion="polite" style={styles.small}>{tiles.length ? `${ready} of ${tiles.length} voices saved${preparing ? ` · Preparing ${preparing}…` : ''}` : 'This board uses device voices. No audio downloads are needed.'}</Text>
    {tiles.length > 0 && <Button kind="secondary" icon={Volume2} busy={busy} disabled={disabled || !missing.length} onPress={() => void generate()}>{missing.length ? `${failed ? 'Retry' : 'Prepare'} missing audio (${missing.length})` : preparing ? 'Preparing audio…' : 'All audio saved'}</Button>}
    {Boolean(error) && <Notice>{error}</Notice>}
  </View>;
}
