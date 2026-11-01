/** @file Hosts an illustrated welcome and shared account route navigation inside a native-safe full-screen modal. */
import { useEffect } from 'react';
import { Modal, Platform, ScrollView } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { type AccountController } from '../services/useAccount';
import { isAccountEntryMode, type AccountMode } from '../services/accountRoute';
import { AccountEntry } from './account/AccountEntry';
import { welcomeBackground } from './account/AccountWelcome';
import { AccountOverview, BackupDetails } from './account/AccountOverview';
import { AccountManagement } from './account/AccountManagement';
import { AppHeader } from './AppHeader';
import { styles, theme } from './theme';

const titles = { login: 'Sign in', register: 'Create an account', reset: 'Reset your password', backup: 'Backup & sync', 'sign-in-methods': 'Sign-in methods', 'verify-email': 'Verify email', 'sign-out': 'Sign out', delete: 'Delete account', 'link-email': 'Link email & password', 'link-google': 'Link Google', 'link-apple': 'Link Apple' };

/**
 * Open a headerless welcome or account pages under the shared route header, with insets measured in the native modal window.
 * Back leaves child pages first; signed-out users cannot dismiss entry, while signed-in users can return during restoration.
 * Background sync permits navigation; authentication actions guard navigation until they settle.
 * Web fades in place so the safe-area provider never measures a sliding, offscreen viewport.
 */
export function AccountScreen({ account, mode, onMode, onBack, onClose }: { account: AccountController; mode: AccountMode; onMode: (mode: AccountMode) => void; onBack: () => void; onClose: () => void }) {
  const signedIn = Boolean(account.session && !account.needsLogin);
  const incompatible = signedIn ? mode !== null && isAccountEntryMode(mode) : !isAccountEntryMode(mode);
  useEffect(() => { if (incompatible && !signedIn) onMode(null); }, [incompatible, signedIn, onMode]);
  const page = incompatible ? null : mode;
  const clearFeedback = account.clearFeedback;
  useEffect(() => { if (signedIn) clearFeedback(); }, [page, signedIn, clearFeedback]);
  const canClose = signedIn;
  const welcome = !signedIn && !page;
  const navigationBusy = account.busy && !account.syncing;
  const close = () => {
    if (!navigationBusy && canClose) onClose();
  };
  const navigate = (next: AccountMode) => { if (!navigationBusy) { account.clearFeedback(); onMode(next); } };
  const back = () => { if (!navigationBusy) { if (page) { account.clearFeedback(); onBack(); } else close(); } };
  const title = page ? titles[page] : 'Account & backup';
  return <Modal visible animationType={Platform.OS === 'web' ? 'fade' : 'slide'} presentationStyle="fullScreen" onRequestClose={back} statusBarTranslucent navigationBarTranslucent>
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: welcome ? welcomeBackground : theme.background }}>
        {welcome ? <AccountEntry key="welcome" account={account} mode={null} setMode={onMode} /> : <>
          <AppHeader key={title} title={title} onBack={canClose || page ? back : undefined} backDisabled={navigationBusy} />
          <ScrollView key={page ?? 'account'} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.container, { maxWidth: 520, paddingTop: 24, paddingBottom: 36, gap: 24 }]}>
            {!signedIn ? <AccountEntry account={account} mode={isAccountEntryMode(page) ? page : null} setMode={onMode} />
              : page === 'backup' ? <BackupDetails account={account} onNavigate={navigate} />
              : !isAccountEntryMode(page) ? <AccountManagement account={account} mode={page} onNavigate={navigate} onBack={back} />
              : <AccountOverview account={account} onNavigate={navigate} />}
          </ScrollView>
        </>}
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}
