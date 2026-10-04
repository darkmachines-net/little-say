import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { languageName, languageProfileSchema, type LanguageProfile } from '@little-say/core';
import { LanguageChoices } from './LanguageChoices';
import { Button, Notice } from './components';
import { styles } from './theme';

export function LanguageProfileEditor({ value, onChange, disabled = false, expanded = false }: { value: LanguageProfile; onChange: (profile: LanguageProfile) => void; disabled?: boolean; expanded?: boolean }) {
  const [error, setError] = useState('');
  const toggle = (tag: string) => {
    const languages = value.languages.includes(tag) ? value.languages.filter(language => language !== tag) : [...value.languages, tag];
    const next = languageProfileSchema.safeParse({ languages, defaultLanguage: languages.includes(value.defaultLanguage) ? value.defaultLanguage : languages[0] });
    if (!next.success) { setError(languages.length ? 'Choose up to six languages for this device.' : 'Keep at least one language.'); return; }
    setError(''); onChange(next.data);
  };
  return <View style={{ gap: 14 }}>
    {Boolean(error) && <Notice>{error}</Notice>}
    <LanguageChoices selected={value.languages} preferred={value.languages} onChoose={toggle} label="device language" multiple disabled={disabled} initiallyExpanded={expanded} />
    <Text style={styles.label}>Default language</Text>
    <View style={[styles.row, { flexWrap: 'wrap' }]}>{value.languages.map(tag => <Button key={tag} compact disabled={disabled} kind={tag === value.defaultLanguage ? 'primary' : 'secondary'} accessibilityLabel={`Default language ${languageName(tag)}`} onPress={() => onChange({ ...value, defaultLanguage: tag })}>{`${tag === value.defaultLanguage ? '✓ ' : ''}${languageName(tag)}`}</Button>)}</View>
  </View>;
}
