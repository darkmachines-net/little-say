/**
 * @file Coordinates child playback, independent touch and speech feedback, board languages, and optional
 * locking with fixed header slots, user-language subsets, and lock-aware Android back navigation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, Pressable, ScrollView, Text, View, useWindowDimensions, type ViewInstance } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { boardPlayLanguages, gridLayout, speechSource, languageName, selectedBoardLanguage, tileInLanguage, type Board, type Settings, type Tile, type TileRect, type SpeechAsset } from '@little-say/core';
import { speechQueue, type Voice } from '../services/speech';
import { TouchSurface } from './TouchSurface';
import { ParentControl } from './ParentControl';
import { useParentHold } from './useParentHold';
import { Notice } from './components';
import type { BoardSnapshot } from './BoardTransition';
import { useScreenFocus } from './screenFocus';
import { styles, theme } from './theme';

/**
 * Fit the board to the available screen, queue tile speech, and show the effective user-language
 * subset beside exit actions. Open unlocked; a tap locks navigation and a one-second hold reveals back.
 * Android Back returns to the editor while unlocked and is consumed without leaving while locked.
 * Stop playback when the app backgrounds, the web page hides, or the screen unmounts.
 */
export function PlayBoard({ board, settings, voices, audioAsset, onLanguageChange, onEdit }: { board: Board; settings: Settings; voices: Voice[]; audioAsset: (tile: Tile) => SpeechAsset | undefined; onLanguageChange: (language: string) => Promise<void>; onEdit: (snapshot: BoardSnapshot | null) => void }) {
  useKeepAwake('soundboard', { suppressDeactivateWarnings: true });
  const { width, height } = useWindowDimensions();
  const heading = useScreenFocus();
  const surface = useRef<ViewInstance>(null);
  const leaving = useRef(false);
  const live = useRef(true);
  const measureTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { live.current = true; return () => { live.current = false; clearTimeout(measureTimer.current); }; }, []);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [active, setActive] = useState<Tile | null>(null);
  const [pending, setPending] = useState<Tile | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [cancelToken, setCancelToken] = useState(0);
  const [locked, setLocked] = useState(false);
  const hold = useParentHold(cancelToken, () => setLocked(false));
  useEffect(() => { setLocked(false); setCancelToken(t => t + 1); }, [board.id]);
  const [error, setError] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const language = selectedBoardLanguage(board, settings);
  const playLanguages = boardPlayLanguages(board, settings);
  const compactLanguages = width < 700 || playLanguages.length > 3;
  const tiles = useMemo(() => board.tiles.map(tile => tileInLanguage(tile, language, board.translateLabels !== false)), [board.tiles, board.translateLabels, language]);
  const queue = useMemo(() => speechQueue(voices, settings.voices, (a, p) => { setActive(a); setPending(p); }, () => setError('Sound is unavailable. Check the volume and selected voice in Settings.'), audioAsset, tag => speechSource(settings, tag)), [voices, settings, audioAsset]);
  useEffect(() => {
    const appState = AppState.addEventListener('change', state => { if (state !== 'active') { queue.stop(); clearTimeout(flashTimer.current); setFlash(null); setCancelToken(t => t + 1); } });
    return () => { appState.remove(); queue.stop(); clearTimeout(flashTimer.current); };
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
  const edit = useCallback(() => {
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
  }, [queue, onEdit, rects, tiles, width, height]);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!locked) edit();
      return true;
    });
    return () => back.remove();
  }, [locked, edit]);
  return <View style={[styles.page, { paddingHorizontal: 16, paddingBottom: 16 }]} testID="play-board" onTouchStart={event => { if (event.nativeEvent.touches.length > 1) setCancelToken(t => t + 1); }}>
    <StatusBar hidden />
    <View testID="board-header" style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 48, height: 48 }}>{!locked && <Pressable testID="board-back" accessibilityRole="button" accessibilityLabel="Back to editor" onPress={edit} style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accentSoft, opacity: pressed ? 0.75 : 1 })}><ArrowLeft size={24} color={theme.accent} /></Pressable>}</View>
      <View ref={heading} testID="board-title" accessible accessibilityRole="header" tabIndex={-1} style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ minWidth: 0, color: theme.ink, fontSize: 24, fontWeight: '800', letterSpacing: -0.6 }}>{board.title}</Text></View>
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
      <ParentControl locked={locked} hold={hold} onLock={() => { setCancelToken(t => t + 1); setLocked(true); }} />
    </View>
    <View style={{ height: 32, gap: 4 }}>
      <Text testID="board-lock-status" accessibilityLiveRegion="polite" style={{ textAlign: 'center', fontSize: 12, color: theme.accent }}>{locked ? hold.label : 'Unlocked'}</Text>
      <View testID="board-unlock-progress" accessible={locked} aria-hidden={!locked} accessibilityRole="progressbar" accessibilityLabel="Unlock progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hold.progress * 100)} style={{ height: 4, borderRadius: 2, backgroundColor: theme.accentSoft, overflow: 'hidden', opacity: locked ? 1 : 0 }}>
        <View style={{ height: 4, width: `${hold.progress * 100}%`, backgroundColor: theme.accent }} />
      </View>
    </View>
    <View ref={surface} collapsable={false} style={{ flex: 1 }} onLayout={event => { const { width, height } = event.nativeEvent.layout; setSize(current => current.width === width && current.height === height ? current : { width, height }); setCancelToken(t => t + 1); }}>
      {size.width > 0 && size.height > 0 && (layout.fits
        ? <TouchSurface tiles={tiles} rects={rects} playingId={active?.id ?? null} tappedId={flash} pendingId={pending?.id ?? null} onActivate={activate} onContact={() => setCancelToken(t => t + 1)} />
        : <Notice>More room is needed for this board. Rotate your device or enlarge the window.</Notice>)}
    </View>
    {Boolean(error) && <Notice>{error}</Notice>}
  </View>;
}
