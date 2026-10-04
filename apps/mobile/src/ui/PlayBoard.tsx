import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { gridLayout, hasTileLanguage, languageName, selectedBoardLanguage, tileInLanguage, type Board, type Settings, type Tile, type TileRect, type SpeechAsset } from '@little-say/core';
import { speechQueue, type Voice } from '../services/speech';
import { TouchSurface } from './TouchSurface';
import { ParentControl } from './ParentControl';
import { Button, Notice, Sheet } from './components';
import { styles, theme } from './theme';

export function PlayBoard({ board, settings, voices, audioAsset, onLanguageChange, onExit }: { board: Board; settings: Settings; voices: Voice[]; audioAsset: (tile: Tile) => SpeechAsset | undefined; onLanguageChange: (language: string) => Promise<void>; onExit: () => Promise<void> }) {
  useKeepAwake('soundboard', { suppressDeactivateWarnings: true });
  const { width } = useWindowDimensions();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [active, setActive] = useState<Tile | null>(null);
  const [pending, setPending] = useState<Tile | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [exit, setExit] = useState(false);
  const [cancelToken, setCancelToken] = useState(0);
  const [error, setError] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const language = selectedBoardLanguage(board, settings);
  const playLanguages = board.playLanguages ?? [];
  const compactLanguages = width < 700 || playLanguages.length > 3;
  const tiles = useMemo(() => board.tiles.map(tile => tileInLanguage(tile, language, board.translateLabels !== false)), [board.tiles, board.translateLabels, language]);
  const untranslated = language ? board.tiles.filter(t => t.languageMode === 'board' && !hasTileLanguage(t, language)).length : 0;
  const queue = useMemo(() => speechQueue(voices, settings.voices, (a, p) => { setActive(a); setPending(p); }, () => setError('Sound is unavailable. A parent can check the volume and selected voice.'), audioAsset), [voices, settings.voices, audioAsset]);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => true);
    const appState = AppState.addEventListener('change', state => { if (state !== 'active') { queue.stop(); clearTimeout(flashTimer.current); setFlash(null); setCancelToken(t => t + 1); setExit(false); } });
    return () => { back.remove(); appState.remove(); queue.stop(); clearTimeout(flashTimer.current); };
  }, [queue]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const visibility = () => { if (document.hidden) { queue.stop(); clearTimeout(flashTimer.current); setFlash(null); setExit(false); setCancelToken(t => t + 1); } };
    const historyGuard = () => { if (document.visibilityState === 'visible') history.pushState({ soundboard: true }, '', location.href); };
    history.pushState({ soundboard: true }, '', location.href);
    window.addEventListener('popstate', historyGuard); document.addEventListener('visibilitychange', visibility);
    return () => { document.body.style.overflow = style; window.removeEventListener('popstate', historyGuard); document.removeEventListener('visibilitychange', visibility); };
  }, [queue]);
  const layout = useMemo(() => gridLayout(board.tiles.length, size.width, size.height), [board.tiles.length, size]);
  const rects = useMemo<TileRect[]>(() => tiles.map((tile, i) => ({ id: tile.id, x: i % layout.columns * (layout.width + 12), y: Math.floor(i / layout.columns) * (layout.height + 12), width: Math.max(0, layout.width), height: Math.max(0, layout.height) })), [tiles, layout]);
  const activate = useCallback((id: string) => {
    if (exit) return;
    const tile = tiles.find(t => t.id === id); if (!tile) return;
    setFlash(id); clearTimeout(flashTimer.current); flashTimer.current = setTimeout(() => setFlash(null), 180);
    queue.enqueue(tile);
  }, [tiles, exit, queue]);
  return <View style={[styles.page, { paddingHorizontal: 16, paddingBottom: 16 }]} testID="play-board">
    <StatusBar hidden />
    <View style={{ minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={{ flex: 1, minWidth: 0, color: theme.ink, fontSize: 32, fontWeight: '800', letterSpacing: -0.6 }}>{board.title}</Text>
      {playLanguages.length > 1 && <View style={{ maxWidth: width * 0.4, flexShrink: 0, backgroundColor: theme.accentSoft, borderRadius: 15, padding: 3 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false} style={{ height: 44, flexGrow: 0 }} contentContainerStyle={{ gap: 2 }}>
          {playLanguages.map(tag => {
            const selected = language === tag;
            const sameName = playLanguages.some(other => other !== tag && languageName(other) === languageName(tag));
            const sameShort = playLanguages.some(other => other !== tag && other.split('-')[0] === tag.split('-')[0]);
            const label = sameName || (compactLanguages && sameShort) ? tag.toUpperCase() : compactLanguages ? tag.split('-')[0].toUpperCase() : languageName(tag);
            return <Pressable key={tag} accessibilityRole="button" accessibilityLabel={`Play in ${sameName ? `${languageName(tag)} (${tag})` : languageName(tag)}`} accessibilityState={{ selected }} onPress={() => {
              if (selected) return;
              queue.stop(); clearTimeout(flashTimer.current); setFlash(null); setCancelToken(t => t + 1); setExit(false);
              void onLanguageChange(tag).catch(() => setError('Could not save the play language. Check device storage.'));
            }} style={({ pressed }) => ({ minWidth: 44, minHeight: 44, paddingHorizontal: compactLanguages ? 10 : 14, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: selected ? theme.accent : 'transparent', opacity: pressed ? 0.75 : 1 })}>
              <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700', color: selected ? 'white' : theme.accent }}>{label}</Text>
            </Pressable>;
          })}
        </ScrollView>
      </View>}
      <ParentControl cancelToken={cancelToken} onExitRequest={() => setExit(true)} />
    </View>
    <View style={{ flex: 1 }} onLayout={event => { const { width, height } = event.nativeEvent.layout; setSize(current => current.width === width && current.height === height ? current : { width, height }); setCancelToken(t => t + 1); }}>
      {size.width > 0 && size.height > 0 && <TouchSurface tiles={tiles} rects={rects} playingId={active?.id ?? null} tappedId={flash} pendingId={pending?.id ?? null} onActivate={activate} onContact={() => setCancelToken(t => t + 1)} />}
    </View>
    {exit && <Sheet title="Leave this board?" onClose={() => setExit(false)}>
      {Boolean(error) && <Notice>{error}</Notice>}
      {untranslated > 0 && <Notice>{untranslated} switchable cards still use their original words. Prepare missing translations in the board editor.</Notice>}
      <View style={{ gap: 14 }}><Button onPress={() => setExit(false)}>Keep playing</Button><Button kind="secondary" onPress={() => { queue.stop(); void onExit().catch(() => setError('Could not save your session. Check device storage and try again.')); }}>Leave board</Button></View>
    </Sheet>}
  </View>;
}
