/** @file Keeps both configured providers on the illustrated welcome and email registration, sign-in, and reset on separate forms. */
import { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Mail } from 'lucide-react-native';
import type { AccountController } from '../../services/useAccount';
import type { Provider } from '../../services/firebaseAccount';
import type { AccountEntryMode } from '../../services/accountRoute';
import { Button, Field, Notice } from '../components';
import { styles } from '../theme';
import { supportsProvider } from './components';
import { AccountWelcome } from './AccountWelcome';
import { ProviderSignInButton } from './ProviderSignInButton';

/** Keep both providers reachable on welcome, ordering Google first on Android and Apple first elsewhere. Email forms never repeat provider entry. */
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
  const providerOrder = Platform.OS === 'android' ? ['google.com', 'apple.com'] as const : ['apple.com', 'google.com'] as const;
  const socialProviders = providerOrder.filter(provider => providers.includes(provider) && supportsProvider(provider));
  const clear = () => { setPassword(''); setConfirmation(''); };
  const signIn = (provider: Provider, credentials = { email, password }) => void account.authenticate(mode === 'register' ? 'register' : 'login', credentials.email, credentials.password, provider).then(() => { if (mounted.current) clear(); }).catch(() => {});
  const feedback = <>
    {Boolean(account.error) && <Notice>{account.error}</Notice>}
    {Boolean(account.message) && <Text accessibilityLiveRegion="polite" style={styles.body}>{account.message}</Text>}
    {!account.config && Boolean(account.error) && <Button kind="secondary" disabled={account.busy} onPress={() => void account.prepare().catch(() => {})}>Retry sign-in options</Button>}
  </>;
  const recovery = <>
    {!account.socialAvailable && !mode && socialProviders.length > 0 && <Text style={styles.small}>Use a development build for Google and Apple sign-in. Email works in Expo Go.</Text>}
    {account.needsLogin && <Button kind="ghost" disabled={account.busy} onPress={() => void account.disconnect().then(clear).catch(() => {})}>Sign out and keep local boards</Button>}
  </>;
  if (!mode) return <AccountWelcome actionCount={socialProviders.length + 2}>
    {feedback}
    {socialProviders.map(provider => <ProviderSignInButton key={provider} provider={provider} disabled={!account.ready || !account.socialAvailable} busy={account.busy} onPress={() => signIn(provider, { email: '', password: '' })} />)}
    <Button disabled={!account.ready || account.busy} onPress={() => setMode('register')}>Create Little Say account</Button>
    <Button kind="outline" icon={Mail} disabled={!account.ready || account.busy} onPress={() => setMode('login')}>Sign in with Email</Button>
    {recovery}
  </AccountWelcome>;
  return <View style={{ gap: 12 }}>
    {feedback}
    <Text style={styles.body}>Create soundboards for your family. Sign in or register for automatic backup and sync across devices.</Text>
    {mode === 'login' && developmentAccount && <View style={{ gap: 6 }}>
      <Button kind="secondary" busy={account.busy} disabled={!account.ready} onPress={() => signIn('password', developmentAccount)}>Sign in with test account</Button>
      <Text style={styles.small}>Local development · {developmentAccount.email}</Text>
    </View>}
    <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
    {mode !== 'reset' && <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} maxLength={128} />}
    {mode === 'register' && <><Text style={styles.small}>Use at least 12 characters.</Text><Field label="Confirm password" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" maxLength={128} /></>}
    {mode === 'reset' ? <Button busy={account.busy} disabled={!email.trim()} onPress={() => void account.resetPassword(email).then(() => { if (mounted.current) { setMode('login'); clear(); } }).catch(() => {})}>Send password reset email</Button> : <>
      <Button busy={account.busy} disabled={!account.ready || !account.config || !email.trim() || !password || (mode === 'register' && (password.length < 12 || password !== confirmation))} onPress={() => signIn('password')}>{mode === 'register' ? 'Create account' : 'Sign in'}</Button>
      {mode === 'login' && <Button kind="ghost" disabled={account.busy} onPress={() => { setMode('reset'); clear(); }}>Forgot password?</Button>}
    </>}
    <Button kind="ghost" disabled={account.busy} onPress={() => { setMode(null); clear(); }}>Cancel</Button>
    {recovery}
  </View>;
}
