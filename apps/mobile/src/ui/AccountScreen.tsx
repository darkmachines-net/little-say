/** @file Hosts the mobile welcome gate and header account pages, including backup and device storage controls. */
import { useEffect, useState } from 'react';
import { Modal, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { type AccountController } from '../services/useAccount';
import { type AccountMode } from '../services/accountRoute';
import { requestPersistence } from '../data/storage';
import { AccountPanel } from './AccountPanel';
import { Brand } from './Brand';
import { Button, Notice } from './components';
import { styles, theme } from './theme';

/**
 * Open full-screen account navigation with insets measured in its own native modal window.
 * Back leaves forms first; signed-out native users cannot dismiss the welcome gate.
 * Web fades in place so the safe-area provider never measures a sliding, offscreen viewport.
 */
export function AccountScreen({ account, mode, onMode, onBack, onClose }: { account: AccountController; mode: AccountMode; onMode: (mode: AccountMode) => void; onBack: () => void; onClose: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [storageMessage, setStorageMessage] = useState('');
  const signedIn = Boolean(account.session && !account.needsLogin);
  useEffect(() => { if (signedIn && mode) onMode(null); }, [signedIn, mode, onMode]);
  const canClose = Platform.OS === 'web' || signedIn;
  const welcome = !signedIn && !mode;
  const close = () => {
    if (saving || account.busy || !canClose) return;
    setSaving(true); setError('');
    void onClose().catch(() => setError('Your choice could not be saved. Check device storage and try again.')).finally(() => setSaving(false));
  };
  const back = () => { if (!account.busy && !saving) { if (mode && !signedIn) onBack(); else close(); } };
  return <Modal visible animationType={Platform.OS === 'web' ? 'fade' : 'slide'} presentationStyle="fullScreen" onRequestClose={back} statusBarTranslucent navigationBarTranslucent>
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        <View style={[styles.container, styles.row, { minHeight: 76, justifyContent: 'space-between' }]}>{welcome ? <View /> : <Brand />}{(canClose || mode) && <Button kind="ghost" disabled={account.busy || saving} onPress={back}>Back</Button>}</View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.container, { maxWidth: 520, paddingTop: 24, paddingBottom: 36, gap: 24, flexGrow: welcome ? 1 : undefined, justifyContent: welcome ? 'center' : undefined }]}>
          {welcome && <Brand stacked />}
          {Boolean(error) && <Notice>{error}</Notice>}
          <AccountPanel key={mode ?? (signedIn ? 'signed-in' : 'choices')} account={account} mode={mode} setMode={onMode} onContinue={close} />
          {(signedIn || (Platform.OS === 'web' && !mode)) && <View style={{ gap: 12 }}><Text accessibilityRole="header" style={styles.title}>Storage on this device</Text><Text style={styles.body}>Without a saved account backup, clearing app storage or uninstalling removes local boards, pictures and audio.</Text>{Platform.OS === 'web' && <Button kind="secondary" onPress={() => void requestPersistence().then(persistent => setStorageMessage(persistent ? 'Persistent browser storage is enabled.' : 'This browser has not granted persistent storage. It may remove data when storage is low.')).catch(() => setStorageMessage('Persistent storage is unavailable in this browser.'))}>Request persistent browser storage</Button>}{Boolean(storageMessage) && <Text accessibilityLiveRegion="polite" style={styles.body}>{storageMessage}</Text>}</View>}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}
