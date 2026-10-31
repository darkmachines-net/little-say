/** @file Uses the browser's keyboard- and touch-accessible select for the shared default language. */

import { languageName } from '@little-say/core';
import { theme } from './theme';

/** Select only from the user's chosen languages; the controlled value follows the durable parent save. */
export function DefaultLanguagePicker({ languages, value, disabled, onChange }: { languages: string[]; value: string; disabled: boolean; onChange: (language: string) => void }) {
  return <select aria-label="Default language" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} style={{ minHeight: 44, maxWidth: '100%', padding: '0 10px', border: `1px solid ${theme.line}`, borderRadius: 9, backgroundColor: theme.surface, color: theme.accent, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', fontSize: 14, opacity: disabled ? 0.5 : 1 }}>{languages.map(language => <option key={language} value={language}>{languageName(language)}</option>)}</select>;
}
