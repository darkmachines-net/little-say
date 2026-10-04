/** @file Searches licensed pictures and stages generated card replacements with explicit overrides and attribution. */

import { useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { defaultPicturePolicy, type Board, type CatalogEntry, type Settings, type Tile } from '@little-say/core';
import { chooseLibraryPicture, prepareBoardPictures, searchLibraryPictures } from '../services/pictures';
import { Button, Field, Notice } from './components';
import { CardPicturePreferences, PicturePermission } from './PicturePreferences';
import { PictureImage } from './PictureImage';
import { styles } from './theme';

/** Stage card-only picture choices; asynchronous results cannot replace a newer description or unmounted editor. */
export function CardPictures({ tile, board, settings, onConsent, onChange, onBusy }: { tile: Tile; board: Board; settings: Settings; onConsent: () => Promise<void>; onChange: (tile: Tile) => void; onBusy: (busy: boolean) => void }) {
  const [query, setQuery] = useState(tile.label);
  const [results, setResults] = useState<CatalogEntry[]>([]);
  const [previews, setPreviews] = useState<Record<string, Tile['illustration']>>({});
  const [allow, setAllow] = useState(Boolean(settings.autoImages && settings.aiConsent));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef<AbortController | null>(null);
  const current = useRef(tile); current.current = tile;
  useEffect(() => () => request.current?.abort(), []);
  const options = tile.pictureOptions ?? { locked: tile.illustration.kind === 'photo', instruction: '' };
  const updateOptions = (changes: Partial<typeof options>) => onChange({ ...tile, pictureOptions: { ...options, ...changes } });
  const work = async (operation: (controller: AbortController) => Promise<void>) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); onBusy(true); setMessage('');
    try { await operation(controller); }
    catch (error) { if (!controller.signal.aborted) setMessage((error as Error).message); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); onBusy(false); } }
  };
  const find = () => work(async controller => {
    const entries = await searchLibraryPictures(settings.backendUrl, query, 'color', controller.signal); setResults(entries); setPreviews({});
    setMessage(entries.length ? 'Choose the picture that shows the exact meaning.' : 'No library matches. Try another description or generate a picture.');
    // Two downloads at a time avoid flooding the server while making manual search usable without AI.
    let next = 0;
    const worker = async () => { while (next < entries.length && !controller.signal.aborted) { const entry = entries[next++]; try { const picture = await chooseLibraryPicture(settings.backendUrl, entry.id, controller.signal); if (!controller.signal.aborted) setPreviews(old => ({ ...old, [entry.id]: picture })); } catch { /* Missing sources remain unavailable, never substituted. */ } } };
    await Promise.all([worker(), worker()]);
  });
  const generate = (regenerate: boolean) => work(async controller => {
    if (!settings.aiConsent) await onConsent();
    const snapshot = current.current;
    const candidate = { ...snapshot, pictureOptions: { ...options, locked: false } };
    const draft = { ...board, picturePolicy: board.picturePolicy ?? settings.pictureDefaults ?? defaultPicturePolicy, tiles: board.tiles.map(value => value.id === tile.id ? candidate : value) };
    const result = await prepareBoardPictures(draft, { ...settings, aiConsent: true }, { signal: controller.signal, targetIds: new Set([tile.id]), replaceProtected: true, restyle: true, regenerate, allowGeneration: allow, progress: setMessage });
    if (controller.signal.aborted || current.current !== snapshot) return;
    const replacement = result.board.tiles.find(value => value.id === tile.id)!;
    onChange({ ...replacement, pictureOptions: { ...replacement.pictureOptions, instruction: options.instruction, locked: true } });
    setMessage(result.issues.join('\n') || 'Picture ready. Review it, then save the tile.');
  });
  return <View style={{ gap: 10 }}>
    <CardPicturePreferences options={options} policy={board.picturePolicy ?? settings.pictureDefaults ?? defaultPicturePolicy} onChange={updateOptions} disabled={busy} />
    <Field label="Describe this picture" editable={!busy} value={options.instruction} maxLength={500} onChangeText={instruction => updateOptions({ instruction })} placeholder="An excavator with tracks and a long digging arm" />
    <Field label="Search picture library" editable={!busy} value={query} maxLength={150} onChangeText={setQuery} />
    <Button disabled={busy || !query.trim()} kind="secondary" onPress={() => void find()}>Search pictures</Button>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{results.map(entry => { const picture = previews[entry.id]; return <View key={entry.id} style={{ width: 132, gap: 4 }}>{picture && (picture.kind === 'library' || picture.kind === 'generated') && <View style={{ width: 120, height: 100 }}><PictureImage assetId={picture.assetId} /></View>}<Button compact kind="secondary" disabled={!picture || picture.kind === 'unresolved'} onPress={() => { request.current?.abort(); onChange({ ...current.current, illustration: picture!, pictureOptions: { ...options, locked: true } }); setResults([]); }}>{entry.name}</Button></View>; })}</View>
    <PicturePermission enabled={allow} disabled={busy} onChange={setAllow} />
    <View style={styles.wrap}><Button disabled={busy} onPress={() => void generate(false)}>Find best picture</Button><Button disabled={busy || !allow || (options.mode ?? board.picturePolicy?.mode) === 'library' || (options.mode ?? board.picturePolicy?.mode) === 'emoji'} kind="secondary" onPress={() => void generate(true)}>Generate new picture</Button>{busy && <Button kind="ghost" onPress={() => request.current?.abort()}>Stop pictures</Button>}</View>
    {Boolean(message) && <Notice>{message}</Notice>}
    {tile.illustration.kind === 'library' && <><Text style={styles.small}>{tile.illustration.provenance.author} · {tile.illustration.provenance.license}. {tile.illustration.provenance.modified}</Text><Button compact kind="ghost" onPress={() => { if (tile.illustration.kind === 'library') void Linking.openURL(tile.illustration.provenance.sourceUrl); }}>Original picture</Button></>}
    {tile.illustration.kind === 'generated' && <Text style={styles.small}>AI-generated illustration · {tile.illustration.model}</Text>}
  </View>;
}
