/** @file Adds shared languages through an always-visible search field and dismissible result dropdown. */

import { useEffect, useId, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View, type TextInputInstance, type ViewInstance } from 'react-native';
import { Plus, Search } from 'lucide-react-native';
import { canonicalLanguage, languageName, languageRegion, languageSchema, languages } from '@little-say/core';
import { styles, theme } from './theme';

/**
 * Search unselected names or BCP-47 tags directly. Enter adds the first result; Escape closes the web
 * dropdown with focus in the search field. Outside focus/taps dismiss it. Native expands the results
 * inside the parent's touch bounds and supports nested Android scrolling. Choosing clears and blurs search.
 */
export function LanguagePicker({ selected, onChoose, disabled = false }: { selected: string[]; onChoose: (tag: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [search, setSearch] = useState('');
  const container = useRef<ViewInstance>(null);
  const input = useRef<TextInputInstance>(null);
  const firstOption = useRef<ViewInstance>(null);
  const resultsId = useId();
  const chosen = selected.map(canonicalLanguage);
  const query = search.trim().toLocaleLowerCase();
  const matches = languages.filter(({ tag, name }) => `${name} ${tag} ${languageRegion(tag)}`.toLocaleLowerCase().includes(query));
  const choices = matches.filter(({ tag }) => !chosen.includes(tag));
  const parsed = languageSchema.safeParse(search.trim());
  const custom = parsed.success ? canonicalLanguage(parsed.data) : null;
  const customChoice = custom && !matches.length && !chosen.includes(custom) ? custom : null;
  const visible = open && !disabled;
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const outside = (event: Event) => {
      const element = container.current as unknown as HTMLElement | null;
      if (event.target instanceof Node && !element?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); input.current?.focus(); setOpen(false); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape); };
  }, [visible]);
  const choose = (tag: string) => {
    if (disabled) return;
    setOpen(false); setSearch(''); input.current?.blur(); onChoose(tag);
  };
  return <View ref={container} style={{ zIndex: 1 }}>
    <View style={[styles.row, { minHeight: 54, paddingHorizontal: 15, borderWidth: 1, borderColor: visible || focused ? theme.accent : theme.line, borderRadius: 12, backgroundColor: theme.background, opacity: disabled ? 0.5 : 1, boxShadow: focused ? `0 0 0 1px ${theme.accent}` : undefined }]}>
      <Search size={18} color={theme.muted} accessible={false} />
      <TextInput ref={input} accessibilityLabel="Add a language" accessibilityHint="Search by language name, region, or language tag" accessibilityState={{ expanded: visible, disabled }} aria-controls={visible ? resultsId : undefined} placeholder="Add a language…" placeholderTextColor={theme.muted} autoCapitalize="none" autoCorrect={false} value={search} editable={!disabled} onFocus={() => { setOpen(true); setFocused(true); }} onPressIn={() => { if (!disabled) setOpen(true); }} onBlur={() => { setFocused(false); if (Platform.OS !== 'web') setOpen(false); }} onChangeText={text => { setSearch(text); setOpen(true); }} onKeyPress={event => { if (event.nativeEvent.key === 'ArrowDown' && visible) { event.preventDefault(); firstOption.current?.focus(); } }} onSubmitEditing={() => { const first = choices[0]?.tag ?? customChoice; if (visible && first) choose(first); }} style={{ flex: 1, minWidth: 0, minHeight: 52, paddingVertical: 14, color: theme.ink, fontSize: 16, outlineStyle: 'solid', outlineWidth: 0 }} />
    </View>
    {visible && <View nativeID={resultsId} style={[Platform.OS === 'web' ? { position: 'absolute', top: 60, left: 0, right: 0 } : { marginTop: 6 }, { borderWidth: 1, borderColor: theme.line, borderRadius: 14, backgroundColor: theme.surface, padding: 6, boxShadow: '0 8px 20px rgba(32, 59, 53, 0.12)' }]}>
      <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {choices.map(({ tag, name }, index) => <Pressable ref={index === 0 ? firstOption : undefined} key={tag} accessibilityRole="button" accessibilityLabel={`Add language ${name}`} disabled={disabled} onPress={() => choose(tag)} style={({ pressed }) => [styles.row, { minHeight: 62, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: pressed ? theme.accentSoft : 'transparent' }]}><View style={{ flex: 1, gap: 2 }}><Text style={{ fontSize: 16, fontWeight: '600', color: theme.ink }}>{name}</Text><Text style={styles.small}>{languageRegion(tag)}</Text></View><Plus size={18} color={theme.accent} accessible={false} /></Pressable>)}
        {customChoice && <Pressable ref={firstOption} accessibilityRole="button" accessibilityLabel={`Add language ${customChoice}`} disabled={disabled} onPress={() => choose(customChoice)} style={[styles.row, { minHeight: 62, paddingHorizontal: 12, paddingVertical: 10 }]}><View style={{ flex: 1, gap: 2 }}><Text style={{ color: theme.ink, fontSize: 16 }}>{languageName(customChoice)}</Text><Text style={styles.small}>{languageRegion(customChoice)}</Text></View><Plus size={18} color={theme.accent} accessible={false} /></Pressable>}
        {!choices.length && !customChoice && <Text accessibilityLiveRegion="polite" style={[styles.small, { padding: 12 }]}>{matches.length || (custom && chosen.includes(custom)) ? 'This language is already selected.' : 'No matching languages. You can also enter a language tag, such as es-MX.'}</Text>}
      </ScrollView>
    </View>}
  </View>;
}
