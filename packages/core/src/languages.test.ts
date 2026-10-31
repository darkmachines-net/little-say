/** @file Verifies readable regions for ordinary/custom tags and safe display fallbacks on limited Intl runtimes. */

import { afterEach, expect, it, vi } from 'vitest';
import { languageRegion } from './languages';

afterEach(() => vi.restoreAllMocks());

it('names regions without inferring a country for a language-only tag', () => {
  expect(languageRegion('en-US')).toBe('United States');
  expect(languageRegion('es-MX')).toBe('Mexico');
  expect(languageRegion('zh-Hant-TW')).toBe('Taiwan');
  expect(languageRegion('en')).toBe('en');
  expect(languageRegion('invalid_tag')).toBe('invalid_tag');
});

it('keeps tags readable when the platform lacks region display data', () => {
  vi.spyOn(Intl, 'DisplayNames').mockImplementation(() => { throw new Error('Unavailable'); });
  expect(languageRegion('es-MX')).toBe('es-MX');
});
