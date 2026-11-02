/** @file Hosts illustrated required entry and authentication forms in a native-safe modal; signed-in controls live in Settings. */
import { Modal, Platform, ScrollView } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { type AccountController } from '../services/useAccount';
import type { AccountEntryMode } from '../services/accountRoute';
import { AccountEntry } from './account/AccountEntry';
import { welcomeBackground } from './account/AccountWelcome';
import { AppHeader } from './AppHeader';
import { styles, theme } from './theme';

const titles = { login: 'Sign in', register: 'Create an account', reset: 'Reset your password' };

/**
 * Show a headerless welcome or authentication forms under the shared route header, with native modal safe-area insets.
 * Back leaves child forms first; welcome cannot be dismissed and authentication actions guard navigation until they settle.
 * Web fades in place so the safe-area provider never measures a sliding, offscreen viewport.
 */
export function AccountScreen({ account, mode, onMode, onBack }: { account: AccountController; mode: AccountEntryMode; onMode: (mode: AccountEntryMode) => void; onBack: () => void }) {
  const welcome = !mode;
  const navigationBusy = account.busy && !account.syncing;
  const back = () => { if (!navigationBusy && mode) { account.clearFeedback(); onBack(); } };
  const title = mode ? titles[mode] : undefined;
  return <Modal visible animationType={Platform.OS === 'web' ? 'fade' : 'slide'} presentationStyle="fullScreen" onRequestClose={back} statusBarTranslucent navigationBarTranslucent>
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: welcome ? welcomeBackground : theme.background }}>
        {welcome ? <AccountEntry key="welcome" account={account} mode={null} setMode={onMode} /> : <>
          <AppHeader key={title} title={title} onBack={back} backDisabled={navigationBusy} />
          <ScrollView key={mode} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.container, { maxWidth: 520, paddingTop: 24, paddingBottom: 36, gap: 24 }]}>
            <AccountEntry account={account} mode={mode} setMode={onMode} />
          </ScrollView>
        </>}
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}
