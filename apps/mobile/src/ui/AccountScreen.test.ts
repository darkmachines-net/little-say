/** @file Verifies required sign-in with shared headers, device providers, emulator login, and cloud restoration gating. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AccountController } from '../services/useAccount';
import type { AccountMode } from '../services/accountRoute';
import { AccountScreen } from './AccountScreen';

const native = vi.hoisted(() => ({ OS: 'android' }));
vi.mock('react-native', () => ({ Platform: native, Modal: 'Modal', ScrollView: 'ScrollView', View: 'View', Text: 'Text', useWindowDimensions: () => ({ width: 390 }), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('lucide-react-native', () => ({ ArrowLeft: 'ArrowLeft' }));
vi.mock('./screenFocus', () => ({ useScreenFocus: () => null }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' }));
vi.mock('./Brand', () => ({ Brand: 'Brand' }));
vi.mock('./components', () => ({ Button: 'Button', Field: 'Field', Notice: 'Notice' }));

let screen: ReactTestRenderer | undefined;
const close = vi.fn(), back = vi.fn(), modeChange = vi.fn();
const prepare = vi.fn(async () => {}), authenticate = vi.fn(async () => {});
const account = { ready: true, session: null, needsLogin: false, busy: false, error: '', message: '', socialAvailable: true, prepare, authenticate,
  config: { providers: ['password', 'google.com', 'apple.com'] } } as unknown as AccountController;
function buttons() { return screen!.root.findAllByType('Button' as any); }
function button(label: string) { return buttons().find(node => (node.props.accessibilityLabel || React.Children.toArray(node.props.children).join('')) === label)!; }
async function mount(mode: AccountMode = null, controller = account) {
  await act(async () => { screen = create(React.createElement(AccountScreen, { account: controller, mode, onMode: modeChange, onBack: back, onClose: close })); });
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('__DEV__', false); vi.clearAllMocks(); native.OS = 'android'; });
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

it('requires web sign-in and cannot dismiss welcome', async () => {
  native.OS = 'web'; await mount();
  expect(prepare).toHaveBeenCalledOnce();
  expect(button('Continue without an account')).toBeUndefined(); expect(button('Back')).toBeUndefined();
  await act(async () => screen!.root.findByType('Modal' as any).props.onRequestClose());
  expect(close).not.toHaveBeenCalled();
});

it('waits for cloud restoration before allowing an empty device into boards and offers retry', async () => {
  const session = { account: { id: 'family', providers: ['password'], emailVerified: true } } as AccountController['session'];
  const retrySync = vi.fn();
  await mount(null, { ...account, session, restoring: true, error: 'Offline', retrySync });
  expect(button('Continue to boards').props.disabled).toBe(true); expect(button('Back')).toBeUndefined();
  await act(async () => button('Retry loading boards').props.onPress()); expect(retrySync).toHaveBeenCalledOnce();
});

it('offers both configured web providers and retries unavailable sign-in options', async () => {
  native.OS = 'web'; await mount('login');
  expect(button('Continue with Apple')).toBeDefined(); expect(button('Continue with Google')).toBeDefined();
  await act(async () => screen!.update(React.createElement(AccountScreen, { account: { ...account, config: undefined, error: 'Offline' }, mode: 'login', onMode: modeChange, onBack: back, onClose: close })));
  await act(async () => button('Retry sign-in options').props.onPress());
  expect(prepare).toHaveBeenCalledTimes(2);
});

it('leaves authentication forms after sign-in and restores welcome after sign-out', async () => {
  const session = { account: { id: 'family', providers: ['password'], emailVerified: true } } as AccountController['session'];
  await mount('login', { ...account, session });
  expect(modeChange).toHaveBeenCalledWith(null);
  await act(async () => button('Continue to boards').props.onPress());
  expect(close).toHaveBeenCalledOnce();
  await act(async () => screen!.update(React.createElement(AccountScreen, { account, mode: null, onMode: modeChange, onBack: back, onClose: close })));
  expect(button('Register')).toBeDefined(); expect(button('Continue to boards')).toBeUndefined();
  expect(button('Continue without an account')).toBeUndefined();
});

it.each(['ios', 'android', 'web'])('shows automatic backup status without backup or storage controls on %s', async platform => {
  native.OS = platform;
  const session = { account: { id: 'family', providers: ['password'], emailVerified: true } } as AccountController['session'];
  await mount(null, { ...account, session });
  for (const label of ['Enable backup on this device', 'Pause backup', 'Sync now', 'Request persistent browser storage']) expect(button(label)).toBeUndefined();
  expect(JSON.stringify(screen!.toJSON())).toContain('back up and sync automatically');
  expect(JSON.stringify(screen!.toJSON())).not.toContain('Storage on this device');
  await act(async () => screen!.update(React.createElement(AccountScreen, { account, mode: null, onMode: modeChange, onBack: back, onClose: close })));
  expect(button('Request persistent browser storage')).toBeUndefined();
  expect(JSON.stringify(screen!.toJSON())).not.toContain('Storage on this device');
});

const developmentAccount = { email: 'tester@little-say.test', password: 'little-say-local-test-only' };
const localConfig = { projectId: 'demo-little-say', apiKey: 'demo-key', appId: 'demo-app', authDomain: 'demo-little-say.firebaseapp.com',
  providers: ['password'] as const, emulatorUrl: 'http://127.0.0.1:9099', developmentAccount };
const localAccount = { ...account, config: { ...localConfig, providers: ['password'] } } as AccountController;

it.each(['ios', 'android', 'web'])('signs into the preconfigured emulator account on %s without typing credentials', async platform => {
  native.OS = platform; vi.stubGlobal('__DEV__', true);
  await mount('login', localAccount);
  expect(button('Sign in').props.disabled).toBe(true);
  await act(async () => button('Sign in with test account').props.onPress());
  expect(authenticate).toHaveBeenCalledWith('login', developmentAccount.email, developmentAccount.password, 'password');
  expect(modeChange).toHaveBeenCalledWith(null);
});

it.each([
  { label: 'release build', dev: false, config: localAccount.config },
  { label: 'hosted backend', dev: true, config: { ...localAccount.config!, emulatorUrl: undefined } },
  { label: 'non-demo project', dev: true, config: { ...localAccount.config!, projectId: 'hosted-little-say' } },
  { label: 'missing fixture', dev: true, config: { ...localAccount.config!, developmentAccount: undefined } },
  { label: 'unavailable backend', dev: true, config: undefined },
  { label: 'disabled password provider', dev: true, config: { ...localAccount.config!, providers: [] } },
])('hides the development shortcut for a $label', async ({ dev, config }) => {
  vi.stubGlobal('__DEV__', dev); await mount('login', { ...account, config });
  expect(button('Sign in with test account')).toBeUndefined();
});

it.each([null, 'register', 'reset'] as const)('limits the development shortcut to login, excluding %s', async mode => {
  vi.stubGlobal('__DEV__', true); await mount(mode, localAccount);
  expect(button('Sign in with test account')).toBeUndefined();
});

it('keeps failed test sign-in on the form for retry and reflects the account busy state', async () => {
  vi.stubGlobal('__DEV__', true); authenticate.mockRejectedValueOnce(new Error('Offline'));
  await mount('login', localAccount);
  await act(async () => button('Sign in with test account').props.onPress());
  expect(modeChange).not.toHaveBeenCalled();
  await act(async () => button('Sign in with test account').props.onPress());
  expect(modeChange).toHaveBeenCalledWith(null);
  await act(async () => screen!.update(React.createElement(AccountScreen, { account: { ...localAccount, busy: true }, mode: 'login', onMode: modeChange, onBack: back, onClose: close })));
  expect(button('Sign in with test account').props.busy).toBe(true);
});
