/** @file Hosts full-screen account forms under one route header without discarding local settings drafts. */
import { useState } from 'react';
import { Modal, Platform, ScrollView } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { type AccountController } from '../services/useAccount';
import { AccountPanel } from './AccountPanel';
import { AppHeader } from './AppHeader';
import { Notice } from './components';
import { styles, theme } from './theme';

/**
 * Open account forms with a single route heading and insets measured in the native modal window.
 * Back leaves forms before returning to the caller; scrolling stays within the system bars.
 * Web fades in place so the safe-area provider never measures a sliding, offscreen viewport.
 */
export function AccountScreen({ account, onClose }: { account: AccountController; onClose: () => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (saving || account.busy) return;
    setSaving(true); setError('');
    void onClose().catch(() => setError('Your choice could not be saved. Check device storage and try again.')).finally(() => setSaving(false));
  };
  const back = () => { if (!account.busy && !saving) { if (mode) setMode(mode === 'reset' ? 'login' : null); else close(); } };
  const title = account.session && !account.needsLogin ? 'Account & backup' : mode === 'register' ? 'Create an account' : mode === 'login' ? 'Log in' : mode === 'reset' ? 'Reset your password' : 'Welcome to Little Say';
  return <Modal visible animationType={Platform.OS === 'web' ? 'fade' : 'slide'} presentationStyle="fullScreen" onRequestClose={back} statusBarTranslucent navigationBarTranslucent>
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        <AppHeader key={title} title={title} onBack={back} backDisabled={account.busy || saving} />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.container, { maxWidth: 620, paddingVertical: 28, gap: 20 }]}>
          {Boolean(error) && <Notice>{error}</Notice>}
          <AccountPanel key={mode ?? (account.session && !account.needsLogin ? 'signed-in' : 'choices')} account={account} mode={mode} setMode={setMode} onContinue={close} />
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}
