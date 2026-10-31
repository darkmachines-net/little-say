/** @file Verifies mobile welcome cannot be dismissed, platform provider choices, and web-only guest continuation. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AccountController } from '../services/useAccount';
import type { AccountMode } from '../services/accountRoute';
import { AccountScreen } from './AccountScreen';

const native = vi.hoisted(() => ({ OS: 'android' }));
vi.mock('react-native', () => ({ Platform: native, Modal: 'Modal', ScrollView: 'ScrollView', View: 'View', Text: 'Text', StyleSheet: { create: (value: unknown) => value } }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' }));
vi.mock('../data/storage', () => ({ requestPersistence: vi.fn() }));
vi.mock('./Brand', () => ({ Brand: 'Brand' }));
vi.mock('./components', () => ({ Button: 'Button', Field: 'Field', Notice: 'Notice' }));

let screen: ReactTestRenderer | undefined;
const close = vi.fn(async () => {}), back = vi.fn(), modeChange = vi.fn();
const prepare = vi.fn(async () => {}), authenticate = vi.fn(async () => {});
const account = { ready: true, session: null, needsLogin: false, busy: false, error: '', message: '', socialAvailable: true, prepare, authenticate,
  config: { providers: ['password', 'google.com', 'apple.com'] } } as unknown as AccountController;
function buttons() { return screen!.root.findAllByType('Button' as any); }
function button(label: string) { return buttons().find(node => React.Children.toArray(node.props.children).join('') === label)!; }
async function mount(mode: AccountMode = null, controller = account) {
  await act(async () => { screen = create(React.createElement(AccountScreen, { account: controller, mode, onMode: modeChange, onBack: back, onClose: close })); });
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); native.OS = 'android'; });
afterEach(async () => { if (screen) await act(async () => screen!.unmount()); screen = undefined; vi.unstubAllGlobals(); });

it.each(['ios', 'android'])('requires sign-in on %s and offers the device provider', async platform => {
  native.OS = platform; await mount();
  expect(button('Continue without an account')).toBeUndefined();
  expect(button('Back')).toBeUndefined();
  expect(button('Sign in')).toBeDefined(); expect(button('Register')).toBeDefined();
  const provider = platform === 'ios' ? 'Apple' : 'Google';
  expect(button(`Continue with ${provider}`)).toBeDefined();
  expect(button(`Continue with ${platform === 'ios' ? 'Google' : 'Apple'}`)).toBeUndefined();
  expect(prepare).toHaveBeenCalledOnce();
  await act(async () => screen!.root.findByType('Modal' as any).props.onRequestClose());
  expect(close).not.toHaveBeenCalled();
  await act(async () => button(`Continue with ${provider}`).props.onPress());
  expect(authenticate).toHaveBeenCalledWith('login', '', '', platform === 'ios' ? 'apple.com' : 'google.com');
});

it('returns from native forms to welcome without allowing dismissal', async () => {
  await mount('register');
  await act(async () => button('Back').props.onPress());
  expect(back).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  await act(async () => button('Cancel').props.onPress());
  expect(modeChange).toHaveBeenCalledWith(null);
});

it('allows web guest continuation without an account request', async () => {
  native.OS = 'web'; await mount();
  expect(prepare).not.toHaveBeenCalled();
  await act(async () => button('Continue without an account').props.onPress());
  expect(close).toHaveBeenCalledOnce();
});

it('offers both configured web providers and retries unavailable sign-in options', async () => {
  native.OS = 'web'; await mount('login');
  expect(button('Continue with Apple')).toBeDefined(); expect(button('Continue with Google')).toBeDefined();
  await act(async () => screen!.update(React.createElement(AccountScreen, { account: { ...account, config: undefined, error: 'Offline' }, mode: 'login', onMode: modeChange, onBack: back, onClose: close })));
  await act(async () => button('Retry sign-in options').props.onPress());
  expect(prepare).toHaveBeenCalledTimes(2);
});

it('leaves authentication forms after sign-in and restores welcome after sign-out', async () => {
  const session = { account: { id: 'family', providers: ['password'], emailVerified: true }, backupEnabled: false } as AccountController['session'];
  await mount('login', { ...account, session });
  expect(modeChange).toHaveBeenCalledWith(null);
  await act(async () => button('Continue to boards').props.onPress());
  expect(close).toHaveBeenCalledOnce();
  await act(async () => screen!.update(React.createElement(AccountScreen, { account, mode: null, onMode: modeChange, onBack: back, onClose: close })));
  expect(button('Register')).toBeDefined(); expect(button('Continue to boards')).toBeUndefined();
  expect(button('Continue without an account')).toBeUndefined();
});
