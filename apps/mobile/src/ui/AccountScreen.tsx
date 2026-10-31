/** @file Hosts required sign-in and first cloud restoration on every platform, plus header account navigation. */
import { useEffect } from 'react';
import { Modal, Platform, ScrollView } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { type AccountController } from '../services/useAccount';
import { type AccountMode } from '../services/accountRoute';
import { AccountPanel } from './AccountPanel';
import { Brand } from './Brand';
import { AppHeader } from './AppHeader';
import { styles, theme } from './theme';

/**
 * Open full-screen account navigation under the shared route header, with insets measured in its native modal window.
 * Back leaves forms first; signed-out users and empty devices awaiting cloud restoration cannot dismiss the gate.
 * Web fades in place so the safe-area provider never measures a sliding, offscreen viewport.
 */
export function AccountScreen({ account, mode, onMode, onBack, onClose }: { account: AccountController; mode: AccountMode; onMode: (mode: AccountMode) => void; onBack: () => void; onClose: () => void }) {
  const signedIn = Boolean(account.session && !account.needsLogin);
  useEffect(() => { if (signedIn && mode) onMode(null); }, [signedIn, mode, onMode]);
  const canClose = signedIn && !account.restoring;
  const welcome = !signedIn && !mode;
  const close = () => {
    if (!account.busy && canClose) onClose();
  };
  const back = () => { if (!account.busy) { if (mode && !signedIn) onBack(); else close(); } };
  const title = signedIn ? 'Account & backup' : mode === 'register' ? 'Create an account' : mode === 'login' ? 'Sign in' : mode === 'reset' ? 'Reset your password' : 'Welcome to Little Say';
  return <Modal visible animationType={Platform.OS === 'web' ? 'fade' : 'slide'} presentationStyle="fullScreen" onRequestClose={back} statusBarTranslucent navigationBarTranslucent>
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        <AppHeader key={title} title={title} onBack={canClose || mode ? back : undefined} backDisabled={account.busy} />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.container, { maxWidth: 520, paddingTop: 24, paddingBottom: 36, gap: 24, flexGrow: welcome ? 1 : undefined, justifyContent: welcome ? 'center' : undefined }]}>
          {welcome && <Brand stacked />}
          <AccountPanel key={mode ?? (signedIn ? 'signed-in' : 'choices')} account={account} mode={mode} setMode={onMode} onContinue={close} />
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}
