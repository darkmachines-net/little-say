/** @file Presents Little Say accounts, backup consent, recovery codes, sync status, and account removal. */

import { useState } from 'react';
import { Text, View } from 'react-native';
import { type AccountController } from '../services/useAccount';
import { Button, Field, Notice } from './components';
import { styles } from './theme';

/** Offer account-free use equally, and disclose photo/audio uploads before enabling account sync. */
export function AccountPanel({ account }: { account: AccountController }) {
  const [mode, setMode] = useState<'login' | 'register' | 'recover' | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [deleting, setDeleting] = useState(false);
  const signedIn = account.session && !account.needsLogin;
  return <View style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={styles.title}>Little Say account</Text>
    {Boolean(account.error) && <Notice>{account.error}</Notice>}
    {Boolean(account.message) && <Text accessibilityLiveRegion="polite" style={styles.body}>{account.message}</Text>}
    {account.recoveryCode ? <>
      <Text style={styles.body}>Keep this recovery code somewhere safe, separate from this device. It is the only way to reset a forgotten password; Little Say does not send recovery emails.</Text>
      <Field label="Recovery code" value={account.recoveryCode} editable={false} selectTextOnFocus />
      <Text selectable style={styles.small}>{account.recoveryCode}</Text>
      <Button onPress={account.acknowledgeRecovery}>I saved my recovery code</Button>
    </> : signedIn ? <>
      <Text style={styles.body}>Signed in as {account.session!.account.username}</Text>
      {account.savedAt && <Text style={styles.small}>Last synced: {new Date(account.savedAt).toLocaleString()}</Text>}
      <Text style={styles.small}>Boards, photos, illustrations and downloaded voices sync to your account on this server. Sign in on another device to restore them. Device settings stay here.</Text>
      <Button busy={account.busy} onPress={() => void account.sync()}>Sync now</Button>
      <Button kind="secondary" disabled={account.busy} onPress={() => void account.disconnect().catch(() => {})}>Sign out and keep local boards</Button>
      {deleting ? <>
        <Notice>Deleting your account permanently removes its server backup and signs out all devices. Boards already downloaded on devices remain there.</Notice>
        <Field label="Password to delete account" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
        <Button kind="danger" busy={account.busy} disabled={!password} onPress={() => void account.disconnect(password).then(() => { setDeleting(false); setPassword(''); }).catch(() => {})}>Permanently delete account</Button>
        <Button kind="ghost" disabled={account.busy} onPress={() => { setDeleting(false); setPassword(''); }}>Cancel deletion</Button>
      </> : <Button kind="ghost" disabled={account.busy} onPress={() => setDeleting(true)}>Delete account…</Button>}
    </> : <>
      <Text style={styles.body}>Save your soundboards, photos and voices to your Little Say account. Access them on other devices or restore them after reinstalling the app.</Text>
      <Text style={styles.small}>You can use Little Say without an account. Your boards stay on this device and are lost if the app or its storage is removed.</Text>
      {mode ? <>
        <Field label="Account name" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} autoComplete="username" maxLength={40} />
        <Text style={styles.small}>3–40 letters, numbers, underscores or hyphens. Accounts belong to the server selected in Settings.</Text>
        <Field label={mode === 'recover' ? 'New password' : 'Password'} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} maxLength={128} />
        {mode !== 'login' && <><Text style={styles.small}>Use at least 12 characters. Save the recovery code provided next.</Text><Field label="Confirm password" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" maxLength={128} /></>}
        {mode === 'recover' && <Field label="Saved recovery code" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} />}
        <Text style={styles.body}>Continuing uploads the boards on this device, including personal photos and saved voices, to your private account on this server. Existing account boards are added here. The server administrator can access backups.</Text>
        <Button busy={account.busy} disabled={!account.ready || !username.trim() || password.length < 12 || (mode !== 'login' && password !== confirmation) || (mode === 'recover' && !code.trim())} onPress={() => void account.authenticate(mode, username, password, code).then(() => { setPassword(''); setConfirmation(''); setCode(''); setMode(null); }).catch(() => {})}>{mode === 'register' ? 'Create account & enable sync' : mode === 'recover' ? 'Reset password & enable sync' : 'Sign in & sync this device'}</Button>
        <Button kind="ghost" disabled={account.busy} onPress={() => { setMode(null); setPassword(''); setConfirmation(''); setCode(''); }}>Continue without signing in</Button>
        {mode === 'login' && <Button kind="ghost" disabled={account.busy} onPress={() => { setMode('recover'); setPassword(''); }}>Forgot password?</Button>}
      </> : <View style={{ gap: 8 }}><Button kind="secondary" disabled={!account.ready || account.busy} onPress={() => setMode('login')}>Sign in</Button><Button kind="ghost" disabled={!account.ready || account.busy} onPress={() => setMode('register')}>Create account</Button></View>}
      {account.needsLogin && <Button kind="ghost" disabled={account.busy} onPress={() => void account.disconnect().catch(() => {})}>Sign out and keep local boards</Button>}
    </>}
  </View>;
}
