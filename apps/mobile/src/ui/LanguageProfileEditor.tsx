/** @file Edits a capped shared language profile with inline search, explicit removal mode, and one default selector. */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CircleMinus } from 'lucide-react-native';
import { MAX_PROFILE_LANGUAGES, languageName, languageRegion, languageProfileSchema, type LanguageProfile } from '@little-say/core';
import { DefaultLanguagePicker } from './DefaultLanguagePicker';
import { LanguagePicker } from './LanguagePicker';
import { Notice } from './components';
import { styles, theme } from './theme';

/**
 * Report validated shared-language changes from Settings or setup within the profile cap.
 * Edit reveals removals, retaining one language; removing the default selects the first remaining
 * language without deleting saved words.
 */
export function LanguageProfileEditor({ value, onChange, disabled = false }: { value: LanguageProfile; onChange: (profile: LanguageProfile) => void; disabled?: boolean }) {
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const toggle = (tag: string) => {
    const languages = value.languages.includes(tag) ? value.languages.filter(language => language !== tag) : [...value.languages, tag];
    const next = languageProfileSchema.safeParse({ languages, defaultLanguage: languages.includes(value.defaultLanguage) ? value.defaultLanguage : languages[0] });
    if (!next.success) { setError(languages.length ? `Choose up to ${MAX_PROFILE_LANGUAGES} languages.` : 'Keep at least one language.'); return; }
    setError(''); onChange(next.data);
  };
  return <View style={{ gap: 24 }}>
    {Boolean(error) && <Notice>{error}</Notice>}
    <View style={{ gap: 8, zIndex: 1 }}>
      <LanguagePicker selected={value.languages} onChoose={toggle} disabled={disabled || value.languages.length >= MAX_PROFILE_LANGUAGES} />
      {value.languages.length >= MAX_PROFILE_LANGUAGES && <Text style={styles.small}>Remove a language to add another.</Text>}
    </View>
    <View>
      <View style={[styles.row, { minHeight: 44 }]}>
        <Text accessibilityRole="header" style={{ flex: 1, fontSize: 16, fontWeight: '700', color: theme.ink }}>Your languages</Text>
        <Text style={styles.small}>{value.languages.length} of {MAX_PROFILE_LANGUAGES}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={editing ? 'Done editing languages' : 'Edit languages'} disabled={disabled} accessibilityState={{ disabled, expanded: editing }} onPress={() => setEditing(current => !current)} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end', opacity: disabled ? 0.5 : 1 }}><Text style={{ color: theme.accent, fontSize: 14, fontWeight: '700' }}>{editing ? 'Done' : 'Edit'}</Text></Pressable>
      </View>
      {value.languages.map((tag, index) => <View key={tag} style={[styles.row, { minHeight: 72, paddingVertical: 12, borderBottomWidth: index === value.languages.length - 1 ? 0 : 1, borderColor: theme.line }]}>
        <View style={{ flex: 1, gap: 3 }}><Text style={{ fontSize: 16, fontWeight: '700', color: theme.ink }}>{languageName(tag)}</Text><Text style={styles.small}>{languageRegion(tag)}</Text></View>
        {tag === value.defaultLanguage && <Text style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6, backgroundColor: theme.accentSoft, color: theme.accent, fontSize: 12, fontWeight: '600' }}>Default</Text>}
        {editing && <Pressable accessibilityRole="button" accessibilityLabel={`Remove language ${languageName(tag)}`} accessibilityState={{ disabled: disabled || value.languages.length === 1 }} disabled={disabled || value.languages.length === 1} onPress={() => toggle(tag)} style={{ minHeight: 44, width: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled || value.languages.length === 1 ? 0.4 : 1 }}><CircleMinus size={20} color={theme.red} /></Pressable>}
      </View>)}
      {editing && <Text style={[styles.small, { marginTop: 8 }]}>Removing a language keeps its saved words and audio.</Text>}
    </View>
    <View style={{ gap: 9, paddingTop: 20, borderTopWidth: 1, borderColor: theme.line }}>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
        <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700' }}>Default language</Text>
        <DefaultLanguagePicker languages={value.languages} value={value.defaultLanguage} disabled={disabled} onChange={defaultLanguage => { setError(''); onChange({ ...value, defaultLanguage }); }} />
      </View>
      <Text style={styles.small}>Used first on new boards and cards.</Text>
    </View>
  </View>;
}
