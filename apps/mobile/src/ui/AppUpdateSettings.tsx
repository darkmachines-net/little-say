/** @file Provides parent-initiated OTA checks, downloads, and restarts for installed mobile apps. */

import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { Button, Notice } from './components';
import { styles, theme } from './theme';

export interface AppUpdateSettingsProps {
  visible: boolean;
  showHeading?: boolean;
  /** Await durable local writes before allowing an update restart. */
  onBeforeRestart: () => Promise<void>;
}

/**
 * Check and install compatible native updates only on a parent press. Save before restarting, and
 * abandon further actions when settings are hidden or unmounted; Expo downloads cannot be cancelled.
 */
export function AppUpdateSettings({ visible, onBeforeRestart, showHeading = true }: AppUpdateSettingsProps) {
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const request = useRef<object | null>(null);
  const beforeRestart = useRef(onBeforeRestart);
  beforeRestart.current = onBeforeRestart;
  const enabled = !__DEV__ && Updates.isEnabled;

  useEffect(() => {
    setProgress('');
    return () => { request.current = null; };
  }, [visible]);

  const check = async () => {
    if (!visible || !enabled || request.current) return;
    const current = {};
    request.current = current;
    const active = () => request.current === current;
    setError(''); setMessage(''); setProgress('Checking for updates…');
    let failure = 'Could not check for updates. Check your internet connection and try again.';
    try {
      const available = await Updates.checkForUpdateAsync();
      if (!active()) return;
      if (available.isAvailable || available.isRollBackToEmbedded) {
        setProgress('Downloading update…');
        failure = 'Could not download the update. Check your internet connection and try again.';
        const downloaded = await Updates.fetchUpdateAsync();
        if (!active()) return;
        if (downloaded.isNew || downloaded.isRollBackToEmbedded) {
          setProgress('Saving settings…');
          failure = 'The update is downloaded, but your settings could not be saved. Check your device storage and try again.';
          await beforeRestart.current();
          if (!active()) return;
          setProgress('Restarting to install…');
          failure = 'The update is downloaded, but the app could not restart. Try again or close and reopen the app.';
          await Updates.reloadAsync();
          return;
        }
      }
      setMessage('Little Say is up to date.');
    } catch {
      if (!active()) return;
      setError(failure);
    }
    request.current = null;
    setProgress('');
  };

  return <View style={{ gap: 12 }}>
    {showHeading && <Text accessibilityRole="header" style={styles.title}>App updates</Text>}
    <Text style={styles.body}>If an update is available, your settings will be saved and the app will restart to install it. Saved boards stay on this device.</Text>
    <Button kind="secondary" disabled={!enabled} busy={Boolean(progress)} onPress={() => void check()}>{progress || 'Check for updates'}</Button>
    {!enabled && <Text style={styles.small}>Update checks are unavailable in this build. Use an installed release build with app updates enabled.</Text>}
    {Boolean(progress || message) && <Text accessibilityLiveRegion="polite" style={{ color: theme.accent, lineHeight: 22 }}>{progress || message}</Text>}
    {Boolean(error) && <Notice>{error}</Notice>}
  </View>;
}
