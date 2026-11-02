/** @file Provides Settings pages for verification, linked-method, provider-linking, sign-out, and deletion pages with fresh identity checks. */
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Mail, KeyRound, UserRound } from 'lucide-react-native';
import type { AccountController } from '../../services/useAccount';
import type { AccountManagementMode, AccountMode } from '../../services/accountRoute';
import type { Provider } from '../../services/firebaseAccount';
import { Button, Field, Notice } from '../components';
import { styles, theme } from '../theme';
import { AccountFeedback, AccountGroup, AccountRow, linkedProviders, providerNames } from './components';

const linkRoutes: Record<Provider, AccountManagementMode> = { password: 'link-email', 'google.com': 'link-google', 'apple.com': 'link-apple' };

/**
 * Render one signed-in Settings action at a time. Route remounts discard credentials; reauthentication stays
 * bound to an existing provider, and deletion always uses Apple when Apple is linked. Verification returns to its caller.
 */
export function AccountManagement({ account, mode, onNavigate, onBack }: {
  account: AccountController; mode: Exclude<AccountManagementMode, 'backup'>; onNavigate: (mode: AccountMode) => void; onBack: () => void;
}) {
  const providers = linkedProviders(account);
  const available = account.config?.providers ?? [];
  const [chosen, setChosen] = useState<Provider | null>(null);
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState(account.session?.account.email ?? '');
  const [newPassword, setNewPassword] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const identity = account.session!.account;
  const appleDeletion = mode === 'delete' && providers.includes('apple.com');
  const current = appleDeletion ? 'apple.com' : chosen && providers.includes(chosen) ? chosen : providers.find(provider => provider === 'password' || account.socialAvailable) ?? providers[0];
  const canConfirm = Boolean(current && (current === 'password' ? password : account.socialAvailable));
  const target = (Object.keys(linkRoutes) as Provider[]).find(provider => linkRoutes[provider] === mode);
  const perform = (action: () => Promise<void>, complete?: () => void) => {
    void action().then(() => { if (mounted.current) { setPassword(''); setNewPassword(''); complete?.(); } }).catch(() => {});
  };
  const confirmation = <View style={{ gap: 12 }}>
    {providers.length > 1 && !appleDeletion && <><Text style={styles.small}>Confirm your identity with a linked sign-in method.</Text>{providers.map(provider => <Button key={provider} kind={current === provider ? 'primary' : 'secondary'} disabled={account.busy || (provider !== 'password' && !account.socialAvailable)} onPress={() => { setChosen(provider); setPassword(''); }}>Use {providerNames[provider]}</Button>)}</>}
    {current === 'password' && <Field label="Current password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" editable={!account.busy} />}
    {current && current !== 'password' && <Text style={styles.small}>Continue with {providerNames[current]} to confirm your identity{appleDeletion ? ' and revoke its authorization' : ''}.</Text>}
    {!account.socialAvailable && (current !== 'password' || target && target !== 'password') && <Notice>Google and Apple account actions require a development or installed app build. Email works in Expo Go.</Notice>}
  </View>;
  if (identity.deletionPending && mode !== 'delete' && mode !== 'sign-out') return <View style={{ gap: 16 }}><Notice>Account deletion is pending. Backup and sign-in changes are blocked.</Notice><Button onPress={() => onNavigate('delete')}>Finish deletion</Button></View>;
  if (mode === 'sign-in-methods') {
    const additions = available.filter(provider => !providers.includes(provider));
    return <View style={{ gap: 24 }}>
      <Text style={styles.body}>Use any linked method to sign in to this account.</Text>
      <AccountGroup title="Linked">{providers.map((provider, index) => <AccountRow key={provider} label={providerNames[provider]} summary={provider === 'password' ? identity.email ?? undefined : 'Linked to this account'} icon={provider === 'password' ? Mail : UserRound} last={index === providers.length - 1} />)}</AccountGroup>
      {additions.length > 0 && <AccountGroup title="Add another method">{additions.map((provider, index) => <AccountRow key={provider} label={`Link ${providerNames[provider]}`} icon={provider === 'password' ? Mail : KeyRound} onPress={() => onNavigate(linkRoutes[provider])} last={index === additions.length - 1} />)}</AccountGroup>}
      <AccountFeedback account={account} />
    </View>;
  }
  if (mode === 'sign-out') return <View style={{ gap: 24 }}>
    <View style={{ gap: 10 }}><Text accessibilityRole="header" style={styles.title}>Sign out on this device?</Text><Text style={styles.body}>Your downloaded boards stay here. Backup pauses until you sign in again.</Text></View>
    <Notice>You’ll need to sign in to use Little Say.</Notice>
    {account.backup.pending && <Text style={styles.body}>Some changes haven’t backed up yet. They’ll stay on this device.</Text>}
    <AccountFeedback account={account} />
    <Button busy={account.busy} onPress={() => perform(() => account.disconnect())}>Sign out</Button>
    <Button kind="secondary" disabled={account.busy && !account.syncing} onPress={onBack}>Stay signed in</Button>
  </View>;
  if (mode === 'delete') return <View style={{ gap: 24 }}>
    <View style={{ gap: 10 }}><Text accessibilityRole="header" style={[styles.title, { color: theme.red }]}>{identity.deletionPending ? 'Finish deleting your account' : 'Delete your account?'}</Text><Text style={styles.body}>This removes your sign-in and cloud backup. Downloaded copies remain on your devices.</Text></View>
    {confirmation}<AccountFeedback account={account} />
    <Button kind="danger" busy={account.busy} disabled={!canConfirm} onPress={() => perform(() => account.disconnect(true, password, current!))}>Permanently delete account</Button>
    <Button kind="secondary" disabled={account.busy && !account.syncing} onPress={onBack}>{identity.deletionPending ? 'Back to Settings' : 'Cancel deletion'}</Button>
  </View>;
  if (mode === 'verify-email') return <View style={{ gap: 24 }}>
    {identity.emailVerified ? <><Text style={styles.body}>Your email is verified. Backup starts automatically.</Text><Button onPress={onBack}>Done</Button></> : <>
      <View style={{ gap: 10 }}><Text accessibilityRole="header" style={styles.title}>Start automatic backup</Text><Text style={styles.body}>Open the verification link sent to {identity.email || 'your email address'}.</Text></View>
      <Notice>Your boards work on this device while you verify.</Notice>
      {confirmation}<AccountFeedback account={account} />
      <Button busy={account.busy} disabled={!canConfirm} onPress={() => perform(() => account.verifyEmail(password, false, current!))}>I’ve verified my email</Button>
      <Button kind="secondary" disabled={account.busy || !canConfirm || !identity.email} onPress={() => perform(() => account.verifyEmail(password, true, current!))}>Resend email</Button>
    </>}
  </View>;
  if (!target || !available.includes(target) || providers.includes(target)) return <View style={{ gap: 16 }}><Text style={styles.body}>{target && providers.includes(target) ? 'This sign-in method is already linked.' : 'This sign-in method is unavailable.'}</Text><Button kind="secondary" onPress={() => onNavigate('sign-in-methods')}>Back to sign-in methods</Button></View>;
  return <View style={{ gap: 24 }}>
    <Text style={styles.body}>Confirm your current sign-in, then link {providerNames[target]}. You’ll keep the same account and backup.</Text>
    {confirmation}
    {target === 'password' && <><Field label="Email to link" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" editable={!account.busy} /><Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" maxLength={128} editable={!account.busy} /><Text style={styles.small}>Use at least 12 characters.</Text></>}
    <AccountFeedback account={account} />
    <Button busy={account.busy} disabled={!canConfirm || (target === 'password' ? !email.trim() || newPassword.length < 12 : !account.socialAvailable)} onPress={() => perform(() => account.link(target, email, newPassword, current!, password), () => onNavigate('sign-in-methods'))}>Link {providerNames[target]}</Button>
  </View>;
}
