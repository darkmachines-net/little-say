/**
 * @file Coordinates child playback, independent touch and speech feedback, board languages, and guarded
 * exit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { gridLayout, speechSource, languageName, selectedBoardLanguage, tileInLanguage, type Board, type Settings, type Tile, type TileRect, type SpeechAsset } from '@little-say/core';
import { speechQueue, type Voice } from '../services/speech';
import { TouchSurface } from './TouchSurface';
import { ParentControl } from './ParentControl';
import { Notice } from './components';
import type { BoardSnapshot } from './BoardTransition';
import { useScreenFocus } from './screenFocus';
import { styles, theme } from './theme';

/**
 * Fit the board to the available screen, queue tile speech, and keep language and exit actions in the
 * header. Stop playback when the app backgrounds, the web page hides, or the screen unmounts.
 */
export function PlayBoard({ board, settings, voices, audioAsset, onLanguageChange, onEdit }: { board: Board; settings: Settings; voices: Voice[]; audioAsset: (tile: Tile) => SpeechAsset | undefined; onLanguageChange: (language: string) => Promise<void>; onEdit: (snapshot: BoardSnapshot | null) => void }) {
  useKeepAwake('soundboard', { suppressDeactivateWarnings: true });
  const { width, height } = useWindowDimensions();
  const heading = useScreenFocus();
  const surface = useRef<View>(null);
  const leaving = useRef(false);
  const live = useRef(true);
  const measureTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { live.current = true; return () => { live.current = false; clearTimeout(measureTimer.current); }; }, []);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [active, setActive] = useState<Tile | null>(null);
  const [pending, setPending] = useState<Tile | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [cancelToken, setCancelToken] = useState(0);
  const [error, setError] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const language = selectedBoardLanguage(board, settings);
  const playLanguages = board.playLanguages ?? [];
  const compactLanguages = width < 700 || playLanguages.length > 3;
  const tiles = useMemo(() => board.tiles.map(tile => tileInLanguage(tile, language, board.translateLabels !== false)), [board.tiles, board.translateLabels, language]);
  const queue = useMemo(() => speechQueue(voices, settings.voices, (a, p) => { setActive(a); setPending(p); }, () => setError('Sound is unavailable. Check the volume and selected voice in Settings.'), audioAsset, tag => speechSource(settings, tag)), [voices, settings, audioAsset]);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => true);
    const appState = AppState.addEventListener('change', state => { if (state !== 'active') { queue.stop(); clearTimeout(flashTimer.current); setFlash(null); setCancelToken(t => t + 1); } });
    return () => { back.remove(); appState.remove(); queue.stop(); clearTimeout(flashTimer.current); };
  }, [queue]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const visibility = () => { if (document.hidden) { queue.stop(); clearTimeout(flashTimer.current); setFlash(null); setCancelToken(t => t + 1); } };
    const historyGuard = () => { if (document.visibilityState === 'visible') history.pushState({ soundboard: true }, '', location.href); };
    history.pushState({ soundboard: true }, '', location.href);
    window.addEventListener('popstate', historyGuard); document.addEventListener('visibilitychange', visibility);
    return () => { document.body.style.overflow = style; window.removeEventListener('popstate', historyGuard); document.removeEventListener('visibilitychange', visibility); };
  }, [queue]);
  const layout = useMemo(() => gridLayout(board.tiles.length, size.width, size.height), [board.tiles.length, size]);
  const rects = useMemo<TileRect[]>(() => layout.rects.map((rect, i) => ({ ...rect, id: tiles[i].id })), [tiles, layout]);
  const activate = useCallback((id: string) => {
    if (leaving.current) return;
    const tile = tiles.find(t => t.id === id); if (!tile) return;
    setFlash(id); clearTimeout(flashTimer.current); flashTimer.current = setTimeout(() => setFlash(null), 180);
    queue.enqueue(tile);
  }, [tiles, queue]);
  const edit = () => {
    if (leaving.current) return;
    leaving.current = true;
    queue.stop(); clearTimeout(flashTimer.current); setFlash(null); setCancelToken(t => t + 1);
    let delivered = false;
    const deliver = (snapshot: BoardSnapshot | null) => {
      if (delivered || !live.current) return;
      delivered = true; clearTimeout(measureTimer.current); onEdit(snapshot);
    };
    // Navigation still works if an interrupted native measurement never returns.
    measureTimer.current = setTimeout(() => deliver(null), 100);
    surface.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => deliver({ x, y, width: measuredWidth, height: measuredHeight, rects, tiles, viewport: { width, height } }));
  };
  return <View style={[styles.page, { paddingHorizontal: 16, paddingBottom: 16 }]} testID="play-board" onTouchStart={event => { if (event.nativeEvent.touches.length > 1) setCancelToken(t => t + 1); }}>
    <StatusBar hidden />
    <View style={{ minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View ref={heading} accessible accessibilityRole="header" tabIndex={-1} style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={{ flex: 1, minWidth: 0, color: theme.ink, fontSize: 32, fontWeight: '800', letterSpacing: -0.6 }}>{board.title}</Text></View>
      {playLanguages.length > 1 && <View style={{ maxWidth: width * 0.4, flexShrink: 0, backgroundColor: theme.accentSoft, borderRadius: 15, padding: 3 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false} style={{ height: 44, flexGrow: 0 }} contentContainerStyle={{ gap: 2 }}>
          {playLanguages.map(tag => {
            const selected = language === tag;
            const sameName = playLanguages.some(other => other !== tag && languageName(other) === languageName(tag));
            const sameShort = playLanguages.some(other => other !== tag && other.split('-')[0] === tag.split('-')[0]);
            const label = sameName || (compactLanguages && sameShort) ? tag.toUpperCase() : compactLanguages ? tag.split('-')[0].toUpperCase() : languageName(tag);
            return <Pressable key={tag} accessibilityRole="button" accessibilityLabel={`Play in ${sameName ? `${languageName(tag)} (${tag})` : languageName(tag)}`} accessibilityState={{ selected }} onPress={() => {
              if (selected) return;
              queue.stop(); clearTimeout(flashTimer.current); setFlash(null); setCancelToken(t => t + 1);
              void onLanguageChange(tag).catch(() => setError('Could not save the play language. Check device storage.'));
            }} style={({ pressed }) => ({ minWidth: 44, minHeight: 44, paddingHorizontal: compactLanguages ? 10 : 14, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: selected ? theme.accent : 'transparent', opacity: pressed ? 0.75 : 1 })}>
              <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700', color: selected ? 'white' : theme.accent }}>{label}</Text>
            </Pressable>;
          })}
        </ScrollView>
      </View>}
      <ParentControl cancelToken={cancelToken} onExitRequest={edit} />
    </View>
    <View ref={surface} collapsable={false} style={{ flex: 1 }} onLayout={event => { const { width, height } = event.nativeEvent.layout; setSize(current => current.width === width && current.height === height ? current : { width, height }); setCancelToken(t => t + 1); }}>
      {size.width > 0 && size.height > 0 && (layout.fits
        ? <TouchSurface tiles={tiles} rects={rects} playingId={active?.id ?? null} tappedId={flash} pendingId={pending?.id ?? null} onActivate={activate} onContact={() => setCancelToken(t => t + 1)} />
        : <Notice>More room is needed for this board. Rotate your device or enlarge the window.</Notice>)}
    </View>
    {Boolean(error) && <Notice>{error}</Notice>}
  </View>;
}
