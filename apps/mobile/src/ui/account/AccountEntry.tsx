/** @file Presents signed-out welcome and authentication, leaving successful Home navigation to the application session boundary. */
import { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import type { AccountController } from '../../services/useAccount';
import type { Provider } from '../../services/firebaseAccount';
import type { AccountEntryMode } from '../../services/accountRoute';
import { Button, Field, Notice } from '../components';
import { styles } from '../theme';
import { providerNames } from './components';

/** Render required account entry; clear local credentials on success while the application returns Home as soon as the session is saved. */
export function AccountEntry({ account, mode, setMode }: { account: AccountController; mode: AccountEntryMode; setMode: (mode: AccountEntryMode) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const prepare = useRef(account.prepare); prepare.current = account.prepare;
  useEffect(() => { void prepare.current().catch(() => {}); }, [mode]);
  const providers = account.config?.providers ?? ['password'];
  const developmentAccount = __DEV__ && account.config?.emulatorUrl && account.config.projectId.startsWith('demo-') && providers.includes('password') ? account.config.developmentAccount : undefined;
  const socialProviders = (['apple.com', 'google.com'] as const).filter(provider => providers.includes(provider) && (Platform.OS === 'web' || provider === (Platform.OS === 'ios' ? 'apple.com' : 'google.com')));
  const clear = () => { setPassword(''); setConfirmation(''); };
  const signIn = (provider: Provider, credentials = { email, password }) => void account.authenticate(mode === 'register' ? 'register' : 'login', credentials.email, credentials.password, provider).then(() => { if (mounted.current) clear(); }).catch(() => {});
  return <View style={{ gap: 12 }}>
    {Boolean(account.error) && <Notice>{account.error}</Notice>}
    {Boolean(account.message) && <Text accessibilityLiveRegion="polite" style={styles.body}>{account.message}</Text>}
    <Text style={[styles.body, !mode && { textAlign: 'center' }]}>Create soundboards for your family. Sign in or register for automatic backup and sync across devices.</Text>
    {!account.config && Boolean(account.error) && <Button kind="secondary" disabled={account.busy} onPress={() => void account.prepare().catch(() => {})}>Retry sign-in options</Button>}
    {mode === 'login' && developmentAccount && <View style={{ gap: 6 }}>
      <Button kind="secondary" busy={account.busy} disabled={!account.ready} onPress={() => signIn('password', developmentAccount)}>Sign in with test account</Button>
      <Text style={styles.small}>Local development · {developmentAccount.email}</Text>
    </View>}
    {mode ? <>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
      {mode !== 'reset' && <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} maxLength={128} />}
      {mode === 'register' && <><Text style={styles.small}>Use at least 12 characters.</Text><Field label="Confirm password" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" maxLength={128} /></>}
      {mode === 'reset' ? <Button busy={account.busy} disabled={!email.trim()} onPress={() => void account.resetPassword(email).then(() => { if (mounted.current) { setMode('login'); clear(); } }).catch(() => {})}>Send password reset email</Button> : <>
        <Button busy={account.busy} disabled={!account.ready || !account.config || !email.trim() || !password || (mode === 'register' && (password.length < 12 || password !== confirmation))} onPress={() => signIn('password')}>{mode === 'register' ? 'Create account' : 'Sign in'}</Button>
        {socialProviders.map(provider => <Button key={provider} kind="secondary" disabled={account.busy || !account.socialAvailable} onPress={() => signIn(provider)}>Continue with {providerNames[provider]}</Button>)}
        {mode === 'login' && <Button kind="ghost" disabled={account.busy} onPress={() => { setMode('reset'); clear(); }}>Forgot password?</Button>}
      </>}
      <Button kind="ghost" disabled={account.busy} onPress={() => { setMode(null); clear(); }}>Cancel</Button>
    </> : <>
      <Button disabled={!account.ready || account.busy} onPress={() => setMode('login')}>Sign in</Button>
      <Button kind="secondary" disabled={!account.ready || account.busy} onPress={() => setMode('register')}>Register</Button>
      {Platform.OS !== 'web' && socialProviders.map(provider => <Button key={provider} kind="secondary" disabled={account.busy || !account.socialAvailable} onPress={() => signIn(provider)}>Continue with {providerNames[provider]}</Button>)}
    </>}
    {!account.socialAvailable && mode !== 'reset' && <Text style={styles.small}>Use a development build for Google and Apple sign-in. Email works in Expo Go.</Text>}
    {account.needsLogin && <Button kind="ghost" disabled={account.busy} onPress={() => void account.disconnect().then(clear).catch(() => {})}>Sign out and keep local boards</Button>}
  </View>;
}
