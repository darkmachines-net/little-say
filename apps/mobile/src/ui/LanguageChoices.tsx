import React, { useState } from 'react';
import { View } from 'react-native';
import { canonicalLanguage, languageName, languageSchema, languages } from '@little-say/core';
import { Button, Field, Notice } from './components';
import { styles } from './theme';

export function LanguageChoices({ selected, preferred, onChoose, label, multiple = false, disabled = false, customInput = true, initiallyExpanded = false }: {
  selected: string[]; preferred: string[]; onChoose: (tag: string) => void; label: string; multiple?: boolean; disabled?: boolean; customInput?: boolean; initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');
  const validSelected = selected.filter(tag => languageSchema.safeParse(tag).success).map(canonicalLanguage);
  const choices = Array.from(new Set([...preferred, ...validSelected, ...(expanded ? languages.map(language => language.tag) : [])].map(canonicalLanguage)));
  return <View style={{ gap: 10 }}>
    <View style={[styles.row, { flexWrap: 'wrap' }]}>{choices.map(tag => {
      const active = validSelected.includes(tag);
      return <Button key={tag} compact disabled={disabled} kind={active ? 'primary' : 'secondary'} accessibilityLabel={`${multiple ? active ? 'Remove' : 'Add' : 'Choose'} ${label} ${languageName(tag)}`} onPress={() => onChoose(tag)}>{`${multiple && active ? '✓ ' : ''}${languageName(tag)}`}</Button>;
    })}</View>
    <Button kind="ghost" disabled={disabled} onPress={() => setExpanded(value => !value)}>{expanded ? 'Fewer languages' : 'More languages'}</Button>
    {expanded && customInput && <View style={[styles.row, { alignItems: 'flex-end' }]}>
      <View style={{ flex: 1 }}><Field label={`Another ${label} tag`} placeholder="e.g. es-MX" autoCapitalize="none" autoCorrect={false} value={custom} editable={!disabled} onChangeText={setCustom} /></View>
      <Button kind="secondary" disabled={disabled} onPress={() => {
        const parsed = languageSchema.safeParse(custom.trim());
        if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
        const tag = canonicalLanguage(parsed.data);
        if (!validSelected.includes(tag)) onChoose(tag);
        setCustom(''); setError('');
      }}>Add language</Button>
    </View>}
    {Boolean(error) && <Notice>{error}</Notice>}
  </View>;
}
