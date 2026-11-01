/** @file Presents the status-first account overview and detailed automatic backup coverage and recovery. */
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { CloudCheck, CloudOff, CloudAlert, CloudDownload, RefreshCw, Mail, CircleAlert, Clock3, UserRound, KeyRound, LogOut, ChevronRight, LayoutGrid, Image, Volume2 } from 'lucide-react-native';
import type { AccountMode } from '../../services/accountRoute';
import type { AccountController } from '../../services/useAccount';
import type { BackupState } from '../../services/accountBackup';
import { Button, Notice } from '../components';
import { styles, theme } from '../theme';
import { AccountGroup, AccountRow, linkedProviders, providerNames } from './components';

const presentations = {
  synced: { title: 'Up to date', badge: 'Automatic', icon: CloudCheck, tone: 'good' },
  syncing: { title: 'Backing up…', badge: 'Automatic', icon: RefreshCw, tone: 'good' },
  pending: { title: 'Waiting to back up', badge: 'Automatic', icon: Clock3, tone: 'neutral' },
  offline: { title: 'Waiting for connection', badge: 'Connection', icon: CloudOff, tone: 'neutral' },
  error: { title: 'Backup needs attention', badge: 'Will retry', icon: CloudAlert, tone: 'warning' },
  unverified: { title: 'Verify email to back up', badge: 'Action needed', icon: Mail, tone: 'warning' },
  restoring: { title: 'Restoring your boards…', badge: 'First sync', icon: CloudDownload, tone: 'neutral' },
  'deletion-pending': { title: 'Deletion needs confirmation', badge: 'Paused', icon: CircleAlert, tone: 'warning' },
  'sign-in-required': { title: 'Sign in to resume backup', badge: 'Paused', icon: KeyRound, tone: 'warning' },
} satisfies Record<BackupState, { title: string; badge: string; icon: typeof CloudCheck; tone: string }>;

type AccountPageProps = { account: AccountController; onNavigate: (mode: AccountMode) => void };

/** Summarize current backup state and only its relevant action; routine sync never produces stacked notices. */
export function BackupStatusCard({ account, onNavigate, details = true }: AccountPageProps & { details?: boolean }) {
  const { state, savedAt, pending } = account.backup;
  const presentation = presentations[state];
  const Icon = presentation.icon;
  const description = state === 'synced' ? (savedAt ? `Last synced ${new Date(savedAt).toLocaleString()}` : 'Your boards are backed up.')
    : state === 'syncing' ? 'Saving your latest changes.'
    : state === 'restoring' ? 'Getting your backup ready on this device.'
    : state === 'deletion-pending' ? 'Backup is blocked until deletion is confirmed.'
    : state === 'unverified' ? 'Your boards are only saved on this device.'
    : account.restoring ? 'Connect to finish loading your saved boards.'
    : pending ? 'Your latest changes are saved on this device.' : 'Your downloaded boards are available on this device.';
  return <View testID="backup-status" style={{ backgroundColor: presentation.tone === 'warning' ? '#F7EEDD' : presentation.tone === 'good' ? theme.accentSoft : theme.surface, borderRadius: 22, padding: 22, gap: 18 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
      <View style={styles.row}><Icon size={19} color={presentation.tone === 'warning' ? theme.clay : theme.accent} accessible={false} /><Text style={{ color: theme.ink, fontSize: 13, fontWeight: '700' }}>Backup & sync</Text></View>
      <Text style={{ color: theme.muted, fontSize: 12, backgroundColor: theme.surface, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 }}>{presentation.badge}</Text>
    </View>
    <View accessibilityLiveRegion="polite" style={{ gap: 8 }}><View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><Text accessibilityRole="header" style={{ color: theme.ink, fontSize: 25, fontWeight: '800', letterSpacing: -0.5, flex: 1 }}>{presentation.title}</Text>{account.syncing && <ActivityIndicator color={theme.accent} />}</View><Text style={styles.body}>{description}</Text></View>
    {state === 'unverified' && <Button onPress={() => onNavigate('verify-email')}>Verify email</Button>}
    {state === 'deletion-pending' && <Button onPress={() => onNavigate('delete')}>Finish deletion</Button>}
    {state === 'sign-in-required' && <Button onPress={() => onNavigate('login')}>Sign in</Button>}
    {(state === 'error' || state === 'offline') && <Button kind="secondary" disabled={account.busy} onPress={() => void account.retrySync()}>{account.restoring ? 'Retry loading boards' : 'Try again'}</Button>}
    {details && <View style={{ alignItems: 'flex-start', marginLeft: -12, marginBottom: -10 }}><Button kind="ghost" compact icon={ChevronRight} onPress={() => onNavigate('backup')}>Backup details</Button></View>}
  </View>;
}

/** Lead with backup health, group identity and sign-in methods, and put consequential actions on separate routes. */
export function AccountOverview({ account, onNavigate }: AccountPageProps) {
  const identity = account.session!.account;
  return <View style={{ gap: 24 }}>
    <BackupStatusCard account={account} onNavigate={onNavigate} />
    <AccountGroup title="Account">
      <AccountRow label={identity.displayName || identity.email || 'Your account'} summary={identity.displayName ? identity.email ?? undefined : undefined} icon={UserRound} />
      <AccountRow label="Sign-in methods" summary={linkedProviders(account).map(provider => providerNames[provider]).join(' · ')} icon={KeyRound} disabled={identity.deletionPending} onPress={() => onNavigate('sign-in-methods')} last />
    </AccountGroup>
    <AccountGroup><AccountRow label="Sign out" summary="Boards stay on this device" icon={LogOut} onPress={() => onNavigate('sign-out')} last /></AccountGroup>
    <Button kind="ghost" onPress={() => onNavigate('delete')}>Delete account…</Button>
  </View>;
}

/** Explain acknowledged backup time, included data, local-only data, and actionable recovery without adding a backup preference. */
export function BackupDetails({ account, onNavigate }: AccountPageProps) {
  const [explain, setExplain] = useState(false);
  return <View style={{ gap: 24 }}>
    <BackupStatusCard account={account} onNavigate={onNavigate} details={false} />
    {Boolean(account.backup.error) && <Notice>{account.backup.error}</Notice>}
    <View style={[styles.card, { gap: 12 }]}><Text style={styles.small}>Last successful sync</Text><Text selectable style={{ color: theme.ink, fontSize: 15, fontWeight: '600' }}>{account.savedAt ? new Date(account.savedAt).toLocaleString() : 'Not yet'}</Text></View>
    <AccountGroup title="Included in your backup"><AccountRow label="Boards" icon={LayoutGrid} /><AccountRow label="Photos & illustrations" icon={Image} /><AccountRow label="Downloaded voices" icon={Volume2} last /></AccountGroup>
    <Text style={styles.small}>Device settings, favorites and unfinished drafts stay on this device.</Text>
    {account.backup.conflicts && <Notice>Conflicting edits were kept as separate boards marked “conflict copy”.</Notice>}
    <Button kind="ghost" onPress={() => setExplain(!explain)}>{explain ? 'Hide backup information' : 'How backup works'}</Button>
    {explain && <Text style={styles.body}>Backup runs automatically while you’re signed in with a verified email. Changes sync across your devices when you leave play or editing. Failed backups retry automatically. Downloaded boards work offline.</Text>}
  </View>;
}
