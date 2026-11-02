/** @file Verifies unified Settings destinations, legacy account redirects, authentication boundaries, and logical parents. */

import { expect, it } from 'vitest';
import { readSettingsRoute, settingsParent, settingsPath } from './settingsRoute';

it('round-trips all current Settings destinations', () => {
  for (const url of ['/app/settings', '/app/settings/languages', '/app/settings/screen-guidance', '/app/settings/privacy', '/app/settings/updates', '/app/settings/about', '/app/settings/backup', ...['sign-in-methods', 'verify-email', 'sign-out', 'delete', 'link-email', 'link-google', 'link-apple'].map(mode => `/app/settings/account/${mode}`)]) {
    expect(settingsPath(readSettingsRoute(url)!)).toBe(url);
  }
});
it('folds former account overviews and child links into Settings', () => {
  for (const prefix of ['/app/account', '/app/settings/account']) {
    expect(settingsPath(readSettingsRoute(prefix)!)).toBe('/app/settings');
    expect(settingsPath(readSettingsRoute(`${prefix}/backup`)!)).toBe('/app/settings/backup');
    for (const mode of ['sign-in-methods', 'verify-email', 'sign-out', 'delete', 'link-email', 'link-google', 'link-apple']) {
      expect(settingsPath(readSettingsRoute(`${prefix}/${mode}`)!)).toBe(`/app/settings/account/${mode}`);
    }
  }
});
it('handles malformed deep links without crashing or classifying the board workspace as Settings', () => {
  for (const path of ['voices', 'voices/es-mx', 'voices/%zz', 'pictures']) {
    expect(readSettingsRoute(`/app/settings/${path}`)).toEqual({ page: 'overview' });
  }
  expect(readSettingsRoute('/app/settings/unknown')).toEqual({ page: 'overview' });
  expect(readSettingsRoute('/app')).toBeNull();
  expect(readSettingsRoute('/app/account/login')).toBeNull();
  expect(readSettingsRoute('/app/settings/account/login')).toBeNull();
  expect(readSettingsRoute('/app/settings-other')).toBeNull();
});
it('returns sensible parents when a direct link has no app-owned browser history', () => {
  expect(settingsParent({ page: 'privacy' })).toEqual({ page: 'overview' });
  expect(settingsParent({ page: 'about' })).toEqual({ page: 'overview' });
  expect(settingsParent({ page: 'overview' })).toBeNull();
  expect(settingsParent({ page: 'account', mode: 'backup' })).toEqual({ page: 'overview' });
  expect(settingsParent({ page: 'account', mode: 'delete' })).toEqual({ page: 'overview' });
  expect(settingsParent({ page: 'account', mode: 'link-apple' })).toEqual({ page: 'account', mode: 'sign-in-methods' });
});
