/** @file Lists the user's shared languages, default and removal actions, with a searchable add dropdown. */

import { useState } from 'react';
import { Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { languageName, languageProfileSchema, type LanguageProfile } from '@little-say/core';
import { LanguagePicker } from './LanguagePicker';
import { Button, Notice } from './components';
import { styles } from './theme';

/** Report validated user-language changes, retaining at least one language and a selected default. */
export function LanguageProfileEditor({ value, onChange, disabled = false }: { value: LanguageProfile; onChange: (profile: LanguageProfile) => void; disabled?: boolean }) {
  const [error, setError] = useState('');
  const toggle = (tag: string) => {
    const languages = value.languages.includes(tag) ? value.languages.filter(language => language !== tag) : [...value.languages, tag];
    const next = languageProfileSchema.safeParse({ languages, defaultLanguage: languages.includes(value.defaultLanguage) ? value.defaultLanguage : languages[0] });
    if (!next.success) { setError(languages.length ? 'Choose up to six languages.' : 'Keep at least one language.'); return; }
    setError(''); onChange(next.data);
  };
  return <View style={{ gap: 14 }}>
    {Boolean(error) && <Notice>{error}</Notice>}
    <Text style={styles.label}>Your languages</Text>
    <View style={{ gap: 8 }}>{value.languages.map(tag => <View key={tag} style={[styles.row, { padding: 12, backgroundColor: 'white', borderRadius: 16, flexWrap: 'wrap' }]}>
      <View style={{ flex: 1, minWidth: 100, gap: 2 }}><Text style={styles.label}>{languageName(tag)}</Text><Text style={styles.small}>{tag}</Text></View>
      <Button compact disabled={disabled} kind={tag === value.defaultLanguage ? 'primary' : 'secondary'} accessibilityLabel={`Default language ${languageName(tag)}`} onPress={() => { if (tag !== value.defaultLanguage) onChange({ ...value, defaultLanguage: tag }); }}>{tag === value.defaultLanguage ? 'Default' : 'Make default'}</Button>
      <Button compact icon={X} disabled={disabled || value.languages.length === 1} kind="ghost" accessibilityLabel={`Remove language ${languageName(tag)}`} onPress={() => toggle(tag)} />
    </View>)}</View>
    <LanguagePicker selected={value.languages} onChoose={toggle} disabled={disabled || value.languages.length >= 6} />
    <Text style={styles.small}>{value.languages.length} of 6 languages selected. The default is used first for new boards and cards.</Text>
  </View>;
}
