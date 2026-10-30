/** @file Presents optional backup accounts and verification while keeping local boards and AI available to guests. */
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { type AccountController } from '../services/useAccount';
import { type Provider } from '../services/firebaseAccount';
import { Button, Field, Notice } from './components';
import { styles } from './theme';
const names: Record<Provider, string> = { password: 'email and password', 'google.com': 'Google', 'apple.com': 'Apple' };

/** Keep guest use available and disclose exactly where boards upload and what account deletion removes. */
export function AccountPanel({ account, mode, setMode, onContinue, settingsPage = false }: { account: AccountController; mode: 'login' | 'register' | 'reset' | null; setMode: (mode: 'login' | 'register' | 'reset' | null) => void; onContinue: () => void; settingsPage?: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [manage, setManage] = useState(false);
  const [chosen, setChosen] = useState<Provider | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const signedIn = account.session && !account.needsLogin;
  const providers = account.config?.providers ?? ['password'];
  const currentProviders = (account.session?.account.providers ?? []).filter((value): value is Provider => value in names);
  const current = chosen && currentProviders.includes(chosen) ? chosen : currentProviders[0] ?? 'password';
  const passwordNeeded = current === 'password';
  const clear = () => { setPassword(''); setConfirmation(''); setNewPassword(''); };
  const begin = (next: 'login' | 'register') => { setMode(next); void account.prepare().catch(() => {}); };
  const signIn = (provider: Provider) => void account.authenticate(mode === 'register' ? 'register' : 'login', email, password, provider).then(() => { if (mounted.current) { clear(); setMode(null); } }).catch(() => {});
  return <View style={{ gap: 12 }}>
    {!settingsPage && <Text accessibilityRole="header" style={styles.heading}>{signedIn ? 'Account & backup' : mode === 'register' ? 'Create an account' : mode === 'login' ? 'Log in' : mode === 'reset' ? 'Reset your password' : 'Welcome to Little Say'}</Text>}
    {Boolean(account.error) && <Notice>{account.error}</Notice>}
    {Boolean(account.message) && <Text accessibilityLiveRegion="polite" style={styles.body}>{account.message}</Text>}
    {signedIn ? <>
      <Text style={styles.body}>Signed in as {account.session!.account.displayName || account.session!.account.email || 'your account'}</Text>
      <Text style={styles.small}>{account.session!.backupEnabled ? 'Backup is enabled on this device.' : 'Your boards stay on this device until you enable backup.'}</Text>
      {account.session!.account.deletionPending ? <Notice>Backup access is blocked while deletion is pending. Retry Delete account to finish Apple confirmation.</Notice> : !account.session!.account.emailVerified ? <>
        <Notice>Verify your email to enable backup. AI is available now, and your boards still work offline.</Notice>
        {passwordNeeded && <Field label="Password for verification" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />}
        <Button disabled={account.busy || (passwordNeeded ? !password : !account.socialAvailable)} onPress={() => void account.verifyEmail(password, false, current).then(clear).catch(() => {})}>Check email verification</Button>
        <Button kind="secondary" disabled={account.busy || (passwordNeeded ? !password : !account.socialAvailable) || !account.session!.account.email} onPress={() => void account.verifyEmail(password, true, current).then(clear).catch(() => {})}>Resend verification email</Button>
      </> : <>
        {account.session!.backupEnabled ? <>
          {account.savedAt && <Text style={styles.small}>Last synced: {new Date(account.savedAt).toLocaleString()}</Text>}
          <Button busy={account.busy} onPress={() => void account.sync()}>Sync now</Button>
          <Button kind="secondary" disabled={account.busy} onPress={() => void account.setBackupEnabled(false).catch(() => {})}>Pause backup</Button>
        </> : <>
          <Text style={styles.body}>Enable backup to upload this device’s boards, personal photos and saved voices to Little Say and restore existing account boards here. Little Say’s service can access backups.</Text>
          <Button busy={account.busy} onPress={() => void account.setBackupEnabled(true).catch(() => {})}>Enable backup on this device</Button>
        </>}
      </>}
      <Button kind="secondary" disabled={account.busy} onPress={onContinue}>{settingsPage ? 'Back to Settings' : 'Continue to boards'}</Button>
      <Button kind="secondary" disabled={account.busy} onPress={() => void account.disconnect().then(clear).catch(() => {})}>Sign out and keep local boards</Button>
      <Button kind="ghost" disabled={account.busy || account.session!.account.deletionPending} onPress={() => { setManage(!manage); setDeleting(false); clear(); }}>Manage sign-in methods</Button>
      {(manage || deleting) && <>
        <Text style={styles.small}>Confirm your identity with an existing sign-in method.</Text>
        {currentProviders.map(provider => <Button key={provider} kind={current === provider ? 'primary' : 'secondary'} disabled={account.busy || (provider !== 'password' && !account.socialAvailable)} onPress={() => { setChosen(provider); clear(); }}>Use {names[provider]}</Button>)}
        {passwordNeeded && <Field label="Current password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />}
      </>}
      {manage && <>
        <Text style={styles.small}>Linked: {currentProviders.map(provider => names[provider]).join(', ')}</Text>
        {!currentProviders.includes('password') && providers.includes('password') && <>
          <Field label="Email to link" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
          <Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" />
          <Button disabled={account.busy || !email.trim() || newPassword.length < 12 || (passwordNeeded && !password)} onPress={() => void account.link('password', email, newPassword, current, password).then(clear).catch(() => {})}>Link email and password</Button>
        </>}
        {(['google.com', 'apple.com'] as const).filter(provider => providers.includes(provider) && !currentProviders.includes(provider)).map(provider => <Button key={provider} disabled={account.busy || !account.socialAvailable || (passwordNeeded && !password)} onPress={() => void account.link(provider, '', '', current, password).then(clear).catch(() => {})}>Link {names[provider]}</Button>)}
      </>}
      {deleting ? <>
        <Notice>Deleting your account removes your login and Little Say backup. Downloaded copies remain on your devices.</Notice>
        {currentProviders.includes('apple.com') && <Text style={styles.small}>Continue with Apple again to revoke its authorization.</Text>}
        <Button kind="danger" busy={account.busy} disabled={(currentProviders.includes('apple.com') || !passwordNeeded) ? !account.socialAvailable : !password} onPress={() => void account.disconnect(true, password, current).then(() => { setDeleting(false); clear(); }).catch(() => {})}>Permanently delete account</Button>
        <Button kind="ghost" disabled={account.busy} onPress={() => { setDeleting(false); clear(); }}>Cancel deletion</Button>
      </> : <Button kind="ghost" disabled={account.busy} onPress={() => { setDeleting(true); setManage(false); clear(); }}>Delete account…</Button>}
      {!account.socialAvailable && <Text style={styles.small}>Google and Apple account actions require a development build. Email sign-in and local boards work in Expo Go.</Text>}
    </> : <>
      <Text style={styles.body}>Create boards and use AI without an account. Sign in to back up boards across devices.</Text>
      <Text style={styles.small}>Without a backup, removing the app or clearing its storage removes these boards.</Text>
      {mode ? <>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
        {mode !== 'reset' && <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} maxLength={128} />}
        {mode === 'register' && <><Text style={styles.small}>Use at least 12 characters.</Text><Field label="Confirm password" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" maxLength={128} /></>}
        {mode === 'reset' ? <Button busy={account.busy} disabled={!email.trim()} onPress={() => void account.resetPassword(email).then(() => { if (mounted.current) { setMode('login'); clear(); } }).catch(() => {})}>Send password reset email</Button> : <>
          <Button busy={account.busy} disabled={!account.ready || !account.config || !email.trim() || !password || (mode === 'register' && (password.length < 12 || password !== confirmation))} onPress={() => signIn('password')}>{mode === 'register' ? 'Create account' : 'Sign in'}</Button>
          {(['google.com', 'apple.com'] as const).filter(provider => providers.includes(provider)).map(provider => <Button key={provider} kind="secondary" disabled={account.busy || !account.socialAvailable} onPress={() => signIn(provider)}>Continue with {names[provider]}</Button>)}
          {!account.socialAvailable && <Text style={styles.small}>Use a development build for Google and Apple sign-in. Email works in Expo Go.</Text>}
          {mode === 'login' && <Button kind="ghost" disabled={account.busy} onPress={() => { setMode('reset'); clear(); }}>Forgot password?</Button>}
        </>}
        <Button kind="ghost" disabled={account.busy} onPress={() => { setMode(null); clear(); }}>Cancel</Button>
      </> : <><Button disabled={!account.ready || account.busy} onPress={() => begin('login')}>Log in</Button><Button kind="secondary" disabled={!account.ready || account.busy} onPress={() => begin('register')}>Create an account</Button><Button kind="ghost" disabled={account.busy} onPress={onContinue}>{settingsPage ? 'Back to Settings' : 'Continue without an account'}</Button></>}
      {account.needsLogin && <Button kind="ghost" disabled={account.busy} onPress={() => void account.disconnect().then(clear).catch(() => {})}>Sign out and keep local boards</Button>}
    </>}
  </View>;
}
