/** @file Selects an editing variant without changing a card's source language or board play settings. */

import { Platform, Pressable, Text, View } from 'react-native';
import { canonicalLanguage, languageName } from '@little-say/core';
import { styles, theme } from './theme';

/** Show accessible language choices; null selects each card's original words. */
export function EditingLanguages({ languages, selected, onChange, disabled = false }: { languages: string[]; selected: string | null; onChange: (language: string | null) => void; disabled?: boolean }) {
  const choices = [{ language: null, label: 'Original words' }, ...languages.map(language => ({ language, label: languageName(language) }))];
  return <View style={{ gap: 8 }}><Text style={styles.label}>Editing language</Text><View style={[styles.wrap, { gap: 8 }]}>{choices.map(({ language, label }) => {
    const active = language === null ? selected === null : Boolean(selected && canonicalLanguage(selected) === canonicalLanguage(language));
    // Web toggle buttons expose pressed state; native accessibility uses selected state.
    const webState = Platform.OS === 'web' ? { 'aria-pressed': active } : {};
    return <Pressable {...webState} key={language ?? 'original'} accessibilityRole="button" accessibilityLabel={language ? `Edit in ${label}` : label} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={() => onChange(language)} style={{ minHeight: 44, padding: 12, borderRadius: 14, justifyContent: 'center', backgroundColor: active ? theme.accent : theme.accentSoft, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: active ? 'white' : theme.accent, fontWeight: '700' }}>{label}</Text></Pressable>;
  })}</View></View>;
}
