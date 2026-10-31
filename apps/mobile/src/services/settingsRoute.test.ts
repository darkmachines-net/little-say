/** @file Verifies Settings and About destinations, retired media links, separate account routes, and web/native parent navigation. */

import { expect, it } from 'vitest';
import { readSettingsRoute, settingsParent, settingsPath } from './settingsRoute';

it('round-trips all current Settings destinations', () => {
  for (const url of ['/app/settings', '/app/settings/languages', '/app/settings/screen-guidance', '/app/settings/privacy', '/app/settings/updates', '/app/settings/about']) {
    expect(settingsPath(readSettingsRoute(url)!)).toBe(url);
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
});
