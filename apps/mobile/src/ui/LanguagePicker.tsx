/** @file Adds languages through a searchable dropdown with named choices and regional/custom tags. */

import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, type ViewInstance } from 'react-native';
import { ChevronDown, Plus } from 'lucide-react-native';
import { canonicalLanguage, languageName, languageSchema, languages } from '@little-say/core';
import { Field } from './components';
import { styles, theme } from './theme';

/**
 * Search unselected languages by name or BCP-47 tag, including custom regional tags. Close after
 * choosing; Enter adds the first result, and Escape closes and restores focus to the trigger on web.
 * Native supports nested Android scrolling and keeps options tappable while the keyboard is open.
 */
export function LanguagePicker({ selected, onChoose, disabled = false }: { selected: string[]; onChoose: (tag: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const trigger = useRef<ViewInstance>(null);
  const chosen = selected.map(canonicalLanguage);
  const query = search.trim().toLocaleLowerCase();
  const matches = languages.filter(({ tag, name }) => `${name} ${tag}`.toLocaleLowerCase().includes(query));
  const choices = matches.filter(({ tag }) => !chosen.includes(tag));
  const parsed = languageSchema.safeParse(search.trim());
  const custom = parsed.success ? canonicalLanguage(parsed.data) : null;
  const customChoice = custom && !matches.length && !chosen.includes(custom) ? custom : null;
  const close = () => { setOpen(false); setSearch(''); trigger.current?.focus(); };
  const choose = (tag: string) => { if (disabled) return; onChoose(tag); close(); };
  return <View style={{ gap: 8 }}>
    <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel="Add language" accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => { setOpen(value => !value); setSearch(''); }} style={[styles.row, { minHeight: 50, padding: 14, borderWidth: 1, borderColor: theme.line, borderRadius: 14, backgroundColor: theme.surface, opacity: disabled ? 0.5 : 1 }]}>
      <Plus size={18} color={theme.accent} /><Text style={{ ...styles.body, flex: 1, color: theme.accent, fontWeight: '700' }}>Add language</Text><ChevronDown size={18} color={theme.accent} />
    </Pressable>
    {open && <View style={{ borderWidth: 1, borderColor: theme.line, borderRadius: 14, backgroundColor: theme.surface, padding: 12, gap: 8 }}>
      <Field label="Search languages" placeholder="Search by name or language tag" autoFocus autoCapitalize="none" autoCorrect={false} value={search} editable={!disabled} onChangeText={setSearch} onKeyPress={event => { if (event.nativeEvent.key === 'Escape') close(); }} onSubmitEditing={() => { const first = choices[0]?.tag ?? customChoice; if (first) choose(first); }} />
      <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {choices.map(({ tag, name }) => <Pressable key={tag} accessibilityRole="button" accessibilityLabel={`Add language ${name}`} disabled={disabled} onPress={() => choose(tag)} style={({ pressed }) => ({ minHeight: 50, padding: 12, borderRadius: 10, backgroundColor: pressed ? theme.accentSoft : 'transparent', justifyContent: 'center' })}><Text style={styles.body}>{name}</Text><Text style={styles.small}>{tag}</Text></Pressable>)}
        {customChoice && <Pressable accessibilityRole="button" accessibilityLabel={`Add language ${customChoice}`} disabled={disabled} onPress={() => choose(customChoice)} style={{ minHeight: 50, padding: 12, gap: 2 }}><Text style={styles.body}>{languageName(customChoice)}</Text><Text style={styles.small}>{customChoice} · language tag</Text></Pressable>}
        {!choices.length && !customChoice && <Text accessibilityLiveRegion="polite" style={[styles.small, { padding: 12 }]}>{matches.length || (custom && chosen.includes(custom)) ? 'This language is already selected.' : 'No matching languages. You can also enter a language tag, such as es-MX.'}</Text>}
      </ScrollView>
    </View>}
  </View>;
}
