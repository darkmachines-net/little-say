/** @file Hosts full-screen account navigation with shared app chrome without discarding local settings drafts. */
import { useState } from 'react';
import { Modal, Platform, ScrollView } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { type AccountController } from '../services/useAccount';
import { AccountPanel } from './AccountPanel';
import { AppHeader } from './AppHeader';
import { Button, Notice } from './components';
import { styles, theme } from './theme';

/**
 * Open full-screen account navigation with the shared app header and insets measured in its own native modal window.
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
  return <Modal visible animationType={Platform.OS === 'web' ? 'fade' : 'slide'} presentationStyle="fullScreen" onRequestClose={back} statusBarTranslucent navigationBarTranslucent>
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        <AppHeader actions={<Button compact kind="ghost" icon={ArrowLeft} disabled={account.busy || saving} onPress={back}>Back</Button>} />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.container, { maxWidth: 620, paddingVertical: 28, gap: 20 }]}>
          {Boolean(error) && <Notice>{error}</Notice>}
          <AccountPanel key={mode ?? (account.session && !account.needsLogin ? 'signed-in' : 'choices')} account={account} mode={mode} setMode={setMode} onContinue={close} />
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}
