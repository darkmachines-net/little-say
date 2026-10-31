/** @file Offers the shared default-language choice in a compact native control with an accessible option sheet. */

import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';
import { languageName } from '@little-say/core';
import { Sheet } from './components';
import { styles, theme } from './theme';

/** Choose one selected language on native; cancellation leaves the default unchanged and choosing closes the sheet. */
export function DefaultLanguagePicker({ languages, value, disabled, onChange }: { languages: string[]; value: string; disabled: boolean; onChange: (language: string) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Default language, ${languageName(value)}`} accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen(true)} style={[styles.row, { minHeight: 44, maxWidth: '100%', borderWidth: 1, borderColor: theme.line, borderRadius: 9, paddingHorizontal: 12, backgroundColor: theme.surface, opacity: disabled ? 0.5 : 1 }]}><Text style={{ color: theme.accent, fontSize: 14, flexShrink: 1 }}>{languageName(value)}</Text><ChevronDown color={theme.accent} size={16} /></Pressable>
    {open && <Sheet title="Default language" onClose={() => setOpen(false)}>{languages.map(language => <Pressable key={language} accessibilityRole="radio" accessibilityLabel={languageName(language)} accessibilityState={{ checked: language === value, disabled }} disabled={disabled} onPress={() => { setOpen(false); if (language !== value) onChange(language); }} style={[styles.row, { minHeight: 48, justifyContent: 'space-between' }]}><Text style={{ color: theme.ink, fontSize: 16 }}>{languageName(language)}</Text>{language === value && <Check color={theme.accent} size={20} />}</Pressable>)}</Sheet>}
  </>;
}
