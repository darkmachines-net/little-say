/** @file Verifies deep-link parsing and parent destinations for the Settings web/native route contract. */

import { expect, it } from 'vitest';
import { readSettingsRoute, settingsParent, settingsPath } from './settingsRoute';

it('round-trips all Settings destinations including language and account children', () => {
  for (const url of ['/app/settings', '/app/settings/languages', '/app/settings/voices', '/app/settings/voices/es-MX', '/app/settings/pictures', '/app/settings/account', '/app/settings/account/login', '/app/settings/account/register', '/app/settings/account/reset', '/app/settings/screen-guidance', '/app/settings/privacy', '/app/settings/updates']) {
    expect(settingsPath(readSettingsRoute(url)!)).toBe(url);
  }
});
it('handles malformed deep links without crashing or classifying the board workspace as Settings', () => {
  expect(readSettingsRoute('/app/settings/voices/%zz')).toEqual({ page: 'voices' });
  expect(readSettingsRoute('/app/settings/unknown')).toEqual({ page: 'overview' });
  expect(readSettingsRoute('/app/settings/voices/es-mx')).toEqual({ page: 'voices', language: 'es-MX' });
  expect(readSettingsRoute('/app')).toBeNull();
  expect(readSettingsRoute('/app/settings-other')).toBeNull();
});
it('returns sensible parents when a direct link has no app-owned browser history', () => {
  expect(settingsParent({ page: 'voices', language: 'es-MX' })).toEqual({ page: 'voices' });
  expect(settingsParent({ page: 'account', mode: 'reset' })).toEqual({ page: 'account', mode: 'login' });
  expect(settingsParent({ page: 'account', mode: 'login' })).toEqual({ page: 'account' });
  expect(settingsParent({ page: 'privacy' })).toEqual({ page: 'overview' });
  expect(settingsParent({ page: 'overview' })).toBeNull();
});
