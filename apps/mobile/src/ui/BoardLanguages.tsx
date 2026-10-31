/** @file Selects a nonempty set of user languages for board play; closing delegates missing-translation preparation. */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { boardPlayLanguages, canonicalLanguage, languageName, profileLanguages, type Board, type BoardChanges, type Settings } from '@little-say/core';
import { Button, Notice, Sheet } from './components';
import { styles, theme } from './theme';

/**
 * Toggle play languages directly, retaining at least one. Selecting all removes the explicit subset
 * so future user languages are inherited. Close/Done/backdrop share the caller's preparation action;
 * card labels, spoken words and fixed-language behavior remain in the individual card editor.
 */
export function BoardLanguages({ board, settings, onManageLanguages, onChange, onClose }: { board: Board; settings: Settings; onManageLanguages: () => void; onChange: (changes: BoardChanges) => void; onClose: () => void }) {
  const [error, setError] = useState('');
  const selected = boardPlayLanguages(board, settings);
  const preferred = profileLanguages(settings);
  const contains = (tag: string) => selected.some(value => canonicalLanguage(value) === canonicalLanguage(tag));
  const toggle = (tag: string) => {
    const languages = preferred.filter(value => value === tag ? !contains(value) : contains(value));
    if (!languages.length) { setError('Keep at least one language for play.'); return; }
    setError('');
    onChange({ playLanguageSubset: languages.length === preferred.length ? undefined : languages });
  };
  const finish = (next: () => void) => {
    if (board.playLanguageSubset && selected.length === preferred.length) onChange({ playLanguageSubset: undefined });
    next();
  };
  return <Sheet title="Board languages" onClose={() => finish(onClose)} footer={<Button onPress={() => finish(onClose)}>Done</Button>}>
    <Text style={styles.body}>Choose which of your languages are available for play.</Text>
    {Boolean(error) && <Notice>{error}</Notice>}
    <View style={{ backgroundColor: theme.surface, borderRadius: 14, paddingHorizontal: 14 }}>
      {preferred.map((tag, index) => <Pressable key={tag} accessibilityRole="checkbox" accessibilityLabel={`Play language ${languageName(tag)}`} aria-checked={contains(tag)} accessibilityState={{ checked: contains(tag) }} onPress={() => toggle(tag)} style={[styles.row, { minHeight: 58, paddingVertical: 12, borderBottomWidth: index === preferred.length - 1 ? 0 : 1, borderColor: theme.line }]}>
        <Text style={{ color: theme.ink, fontSize: 16, flex: 1 }}>{languageName(tag)}</Text>
        <View style={{ width: 24, height: 24, borderWidth: 1, borderColor: contains(tag) ? theme.accent : theme.line, borderRadius: 6, backgroundColor: contains(tag) ? theme.accent : theme.surface, alignItems: 'center', justifyContent: 'center' }}>{contains(tag) && <Check size={17} color={theme.surface} accessible={false} />}</View>
      </Pressable>)}
    </View>
    <Text style={styles.small}>{settings.aiConsent ? 'Missing translations are added automatically when you close.' : 'Uses OpenAI to add missing translations when you close.'}</Text>
    <Button kind="ghost" onPress={() => finish(onManageLanguages)}>Manage your languages in Settings</Button>
  </Sheet>;
}
