/** @file Hosts dedicated account navigation above the current app screen without discarding local settings drafts. */
import { useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type AccountController } from '../services/useAccount';
import { AccountPanel } from './AccountPanel';
import { Brand } from './Brand';
import { Button, Notice } from './components';
import { styles, theme } from './theme';

/** Open full-screen login, registration or account management; back leaves forms before returning to the caller. */
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
  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={back}>
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={[styles.container, styles.row, { minHeight: 76, justifyContent: 'space-between' }]}><Brand /><Button kind="ghost" disabled={account.busy || saving} onPress={back}>Back</Button></View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.container, { maxWidth: 620, paddingVertical: 28, gap: 20 }]}>
        {Boolean(error) && <Notice>{error}</Notice>}
        <AccountPanel key={mode ?? (account.session && !account.needsLogin ? 'signed-in' : 'choices')} account={account} mode={mode} setMode={setMode} onContinue={close} />
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}
