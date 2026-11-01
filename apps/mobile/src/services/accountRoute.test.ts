/** @file Verifies entry and management URLs, logical parents, legacy redirects, and rejection of malformed account paths. */
import { expect, it } from 'vitest';
import { accountParent, accountPath, isAccountEntryMode, readAccountRoute } from './accountRoute';

it('restores every account form and maps older links to canonical URLs', () => {
  for (const mode of [null, 'login', 'register', 'reset', 'backup', 'sign-in-methods', 'verify-email', 'sign-out', 'delete', 'link-email', 'link-google', 'link-apple'] as const) {
    const path = accountPath(mode);
    expect(readAccountRoute(path)).toEqual({ mode });
    expect(readAccountRoute(path.replace('/app/', '/app/settings/'))).toEqual({ mode });
  }
});
it('keeps direct management links inside account navigation', () => {
  expect(accountParent('link-apple')).toBe('sign-in-methods');
  expect(accountParent('backup')).toBeNull();
  expect(accountParent('reset')).toBe('login');
  expect(isAccountEntryMode('register')).toBe(true);
  expect(isAccountEntryMode('delete')).toBe(false);
});
it('does not treat preferences or malformed URLs as account forms', () => {
  for (const path of ['/app', '/app/settings', '/app/settings/privacy', '/app/account-other', '/app/account/login/more']) expect(readAccountRoute(path)).toBeNull();
});
