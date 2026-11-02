/** @file Hosts one account or backup action inside Settings and clears credentials and feedback between routes. */
import { useEffect } from 'react';
import type { AccountManagementMode, AccountMode } from '../../services/accountRoute';
import type { AccountController } from '../../services/useAccount';
import { SettingsPage } from '../SettingsPage';
import { AccountManagement } from './AccountManagement';
import { BackupDetails } from './AccountOverview';

const titles = { backup: 'Backup & sync', 'sign-in-methods': 'Sign-in methods', 'verify-email': 'Verify email', 'sign-out': 'Sign out', delete: 'Delete account', 'link-email': 'Link email & password', 'link-google': 'Link Google', 'link-apple': 'Link Apple' };

/** Keep background sync navigable while account mutations guard Back; remount action content to discard credentials. */
export function AccountSettingsPage({ account, mode, onNavigate, onBack }: {
  account: AccountController; mode: AccountManagementMode; onNavigate: (mode: AccountMode) => void; onBack: () => void;
}) {
  const clearFeedback = account.clearFeedback;
  useEffect(() => { clearFeedback(); }, [mode, clearFeedback]);
  const busy = account.busy && !account.syncing;
  const navigate = (next: AccountMode) => { if (!busy) onNavigate(next); };
  const back = () => { if (!busy) onBack(); };
  return <SettingsPage title={titles[mode]} backLabel={mode.startsWith('link-') ? 'Sign-in methods' : 'Settings'} onBack={back} busy={busy}>
    {mode === 'backup' ? <BackupDetails account={account} onNavigate={navigate} />
      : <AccountManagement key={mode} account={account} mode={mode} onNavigate={navigate} onBack={back} />}
  </SettingsPage>;
}
