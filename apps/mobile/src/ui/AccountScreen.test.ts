/** @file Verifies illustrated required authentication and Settings account groups without routine sync status, including navigation guards and credential lifetimes. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AccountController } from '../services/useAccount';
import { isAccountEntryMode, type AccountMode } from '../services/accountRoute';
import { AccountScreen } from './AccountScreen';
import { SettingsScreen } from './SettingsScreen';
import { starterLibrary } from '../../../../tests/fixtures/library';
import { SettingsGroup } from './SettingsPage';
vi.mock('./LanguageProfileEditor', () => ({ LanguageProfileEditor: 'LanguageProfileEditor' }));
vi.mock('./AboutSettings', () => ({ AboutSettings: 'AboutSettings' }));
vi.mock('./AppUpdateSettings', () => ({ AppUpdateSettings: 'AppUpdateSettings' }));
vi.mock('./PrivacyPolicy', () => ({ PrivacyPolicy: 'PrivacyPolicy' }));

const native = vi.hoisted(() => ({ OS: 'android' }));
vi.mock('react-native', () => ({ Platform: native, Modal: 'Modal', ScrollView: 'ScrollView', View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', useWindowDimensions: () => ({ width: 390, height: 844 }), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('lucide-react-native', () => Object.fromEntries(['ArrowLeft', 'ChevronRight', 'CloudCheck', 'CloudOff', 'CloudAlert', 'CloudDownload', 'RefreshCw', 'Mail', 'CircleAlert', 'Clock3', 'UserRound', 'KeyRound', 'LogOut', 'LayoutGrid', 'Image', 'Volume2', 'Trash2', 'Download', 'Info', 'Languages', 'ShieldCheck', 'Smartphone'].map(name => [name, name])));
vi.mock('./screenFocus', () => ({ useScreenFocus: () => null }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 48, bottom: 34, left: 0, right: 0 }) }));
vi.mock('./Brand', () => ({ Brand: 'Brand', MountainMark: 'MountainMark' }));
vi.mock('./components', () => ({ Button: 'Button', Field: 'Field', Notice: 'Notice' }));

let screen: ReactTestRenderer | undefined;
const close = vi.fn(), back = vi.fn(), modeChange = vi.fn();
const prepare = vi.fn(async () => {}), authenticate = vi.fn(async () => {});
const account = { ready: true, session: null, needsLogin: false, busy: false, error: '', message: '', socialAvailable: true, prepare, authenticate,
  syncing: false, backup: { state: 'synced', pending: false, error: '', conflicts: false }, clearFeedback: vi.fn(),
  config: { providers: ['password', 'google.com', 'apple.com'] } } as unknown as AccountController;
function buttons() { return screen!.root.findAllByType('Button' as any); }
function button(label: string) { return buttons().find(node => (node.props.accessibilityLabel || React.Children.toArray(node.props.children).join('')) === label)!; }
function view(mode: AccountMode, controller: AccountController) {
  return controller.session && !controller.needsLogin
    ? React.createElement(SettingsScreen, { account: controller, library: starterLibrary(), route: isAccountEntryMode(mode) ? { page: 'overview' } : { page: 'account', mode }, onNavigate: route => modeChange(route.page === 'account' ? route.mode : null), onBack: mode ? back : close, onSave: async () => {}, onBeforeRestart: async () => {} })
    : React.createElement(AccountScreen, { account: controller, mode: isAccountEntryMode(mode) ? mode : null, onMode: modeChange, onBack: back });
}
async function mount(mode: AccountMode = null, controller = account) {
  await act(async () => { screen = create(view(mode, controller)); });
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('__DEV__', false); vi.clearAllMocks(); native.OS = 'android'; });
afterEach(async () => { if (screen) await act(async () => screen!.unmount()); screen = undefined; vi.unstubAllGlobals(); });

it.each(['ios', 'android'])('requires sign-in on %s and offers the device provider', async platform => {
  native.OS = platform; await mount();
  expect(button('Continue without an account')).toBeUndefined();
  expect(button('Back')).toBeUndefined();
  expect(button('Log in')).toBeDefined(); expect(button('Register')).toBeDefined();
  expect(screen!.root.findAllByProps({ testID: 'app-header' })).toHaveLength(0);
  expect(screen!.root.findByProps({ accessibilityLabel: 'Little Say: Learn to Talk!' }).props.accessibilityRole).toBe('header');
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

it('allows returning Home from account settings while cloud restoration is running', async () => {
  const session = { account: { id: 'family', providers: ['password'], emailVerified: true } } as AccountController['session'];
  const retrySync = vi.fn();
  await mount(null, { ...account, session, restoring: true, syncing: true, busy: true, retrySync });
  expect(button('Continue to boards')).toBeUndefined(); expect(button('Boards').props.disabled).toBeFalsy();
  await act(async () => button('Boards').props.onPress()); expect(close).toHaveBeenCalledOnce();
});

it('offers both configured web providers and retries unavailable sign-in options', async () => {
  native.OS = 'web'; await mount('login');
  expect(button('Continue with Apple')).toBeDefined(); expect(button('Continue with Google')).toBeDefined();
  await act(async () => screen!.update(view('login', { ...account, config: undefined, error: 'Offline' })));
  await act(async () => button('Retry sign-in options').props.onPress());
  expect(prepare).toHaveBeenCalledTimes(2);
});

it('shows signed-in management and restores welcome after sign-out', async () => {
  const session = { account: { id: 'family', providers: ['password'], emailVerified: true } } as AccountController['session'];
  await mount(null, { ...account, session });
  await act(async () => button('Boards').props.onPress());
  expect(close).toHaveBeenCalledOnce();
  await act(async () => screen!.update(view(null, account)));
  expect(button('Register')).toBeDefined(); expect(button('Continue to boards')).toBeUndefined();
  expect(button('Continue without an account')).toBeUndefined();
});

it.each(['ios', 'android', 'web'])('omits routine backup status and storage controls from Settings on %s', async platform => {
  native.OS = platform;
  const session = { account: { id: 'family', providers: ['password'], emailVerified: true } } as AccountController['session'];
  await mount(null, { ...account, session });
  for (const label of ['Enable backup on this device', 'Pause backup', 'Sync now', 'Request persistent browser storage']) expect(button(label)).toBeUndefined();
  expect(JSON.stringify(screen!.toJSON())).not.toContain('backup-status');
  expect(button('Backup details')).toBeUndefined();
  expect(JSON.stringify(screen!.toJSON())).not.toContain('Storage on this device');
  await act(async () => screen!.update(view(null, account)));
  expect(button('Request persistent browser storage')).toBeUndefined();
  expect(JSON.stringify(screen!.toJSON())).not.toContain('Storage on this device');
});

it('keeps sign-out and deletion inside the Account group without executing them', async () => {
  const session = { account: { id: 'family', email: 'parent@example.test', providers: ['password'], emailVerified: true } } as AccountController['session'];
  const disconnect = vi.fn();
  await mount(null, { ...account, session, disconnect });
  const groups = screen!.root.findAllByType(SettingsGroup);
  expect(groups.map(group => group.props.title)).toEqual(['Preferences', 'Account', 'Help']);
  const rows = groups[1].findAllByType('Pressable' as any);
  expect(rows.map(row => row.props.accessibilityLabel)).toEqual(['Sign-in methods', 'Sign out', 'Delete account']);
  expect(JSON.stringify(screen!.toJSON())).not.toContain('backup-status');
  await act(async () => rows[1].props.onPress());
  expect(modeChange).toHaveBeenLastCalledWith('sign-out');
  await act(async () => rows[2].props.onPress());
  expect(modeChange).toHaveBeenLastCalledWith('delete');
  expect(disconnect).not.toHaveBeenCalled();
});

it('opens child account pages and returns through their route history during background sync', async () => {
  const session = { account: { id: 'family', email: 'parent@example.test', providers: ['password'], emailVerified: true } } as AccountController['session'];
  await mount(null, { ...account, session, busy: true, syncing: true, backup: { ...account.backup, state: 'syncing' } });
  await act(async () => screen!.root.findAllByType('Pressable' as any).find(node => node.props.accessibilityLabel === 'Sign-in methods')!.props.onPress());
  expect(modeChange).toHaveBeenCalledWith('sign-in-methods');
  await act(async () => screen!.update(view('sign-in-methods', { ...account, session })));
  expect(button('Current password')).toBeUndefined();
  await act(async () => button('Settings').props.onPress());
  expect(back).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
});

it('requires verification credentials on the separate page and discards them when leaving', async () => {
  const session = { account: { id: 'family', providers: ['password'], email: 'parent@example.test', emailVerified: false } } as AccountController['session'];
  const verifyEmail = vi.fn(async () => {});
  const controller = { ...account, session, verifyEmail, backup: { ...account.backup, state: 'unverified' as const } };
  await mount(null, controller);
  await act(async () => screen!.root.findAllByType('Pressable' as any).find(node => node.props.accessibilityLabel === 'Verify email')!.props.onPress());
  expect(modeChange).toHaveBeenCalledWith('verify-email');
  await act(async () => screen!.update(view('verify-email', controller)));
  expect(button('I’ve verified my email').props.disabled).toBe(true);
  await act(async () => screen!.root.findByType('Field' as any).props.onChangeText('my password'));
  await act(async () => button('I’ve verified my email').props.onPress());
  expect(verifyEmail).toHaveBeenCalledWith('my password', false, 'password');
  await act(async () => screen!.root.findByType('Field' as any).props.onChangeText('another password'));
  await act(async () => screen!.update(view('delete', controller)));
  expect(screen!.root.findByType('Field' as any).props.value).toBe('');
});

it('requires Apple confirmation for deletion even when a password is also linked', async () => {
  const session = { account: { id: 'family', providers: ['password', 'apple.com'], emailVerified: true } } as AccountController['session'];
  const disconnect = vi.fn(async () => {});
  await mount('delete', { ...account, session, disconnect });
  expect(screen!.root.findAllByType('Field' as any)).toHaveLength(0);
  await act(async () => button('Permanently delete account').props.onPress());
  expect(disconnect).toHaveBeenCalledWith(true, '', 'apple.com');
});

it('finishes verification by returning through history instead of adding another Settings overview', async () => {
  const session = { account: { id: 'family', providers: ['password'], emailVerified: true } } as AccountController['session'];
  await mount('verify-email', { ...account, session });
  await act(async () => button('Done').props.onPress());
  expect(back).toHaveBeenCalledOnce();
  expect(modeChange).not.toHaveBeenCalled();
});

it('confirms sign-out on its own screen and does not disconnect merely by navigating there', async () => {
  const session = { account: { id: 'family', providers: ['password'], emailVerified: true } } as AccountController['session'];
  const disconnect = vi.fn(async () => {});
  await mount('sign-out', { ...account, session, disconnect, backup: { ...account.backup, pending: true } });
  expect(disconnect).not.toHaveBeenCalled();
  expect(JSON.stringify(screen!.toJSON())).toContain('Some changes haven’t backed up yet');
  await act(async () => button('Sign out').props.onPress());
  expect(disconnect).toHaveBeenCalledOnce();
});

it('blocks Settings navigation during account mutations', async () => {
  await mount(); expect(button('Register')).toBeDefined();
  const session = { account: { id: 'family', providers: ['password'], emailVerified: true } } as AccountController['session'];
  await act(async () => screen!.update(view('delete', { ...account, session, busy: true })));
  await act(async () => button('Settings').props.onPress());
  expect(back).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
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
  expect(modeChange).not.toHaveBeenCalled();
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
  expect(authenticate).toHaveBeenCalledTimes(2);
  expect(modeChange).not.toHaveBeenCalled();
  await act(async () => screen!.update(view('login', { ...localAccount, busy: true })));
  expect(button('Sign in with test account').props.busy).toBe(true);
});
