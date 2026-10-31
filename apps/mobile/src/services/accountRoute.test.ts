/** @file Verifies account form URLs, legacy Settings links, and separation from other application routes. */
import { expect, it } from 'vitest';
import { accountPath, readAccountRoute } from './accountRoute';

it('restores every account form and maps older links to canonical URLs', () => {
  for (const mode of [null, 'login', 'register', 'reset'] as const) {
    const path = accountPath(mode);
    expect(readAccountRoute(path)).toEqual({ mode });
    expect(readAccountRoute(path.replace('/app/', '/app/settings/'))).toEqual({ mode });
  }
});
it('does not treat preferences or malformed URLs as account forms', () => {
  for (const path of ['/app', '/app/settings', '/app/settings/privacy', '/app/account-other', '/app/account/login/more']) expect(readAccountRoute(path)).toBeNull();
});
