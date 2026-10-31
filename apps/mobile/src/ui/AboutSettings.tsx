/** @file Presents selectable version and build details for the running Little Say installation. */

import { Text, View } from 'react-native';
import { getAppInfo } from '../services/appInfo';
import { styles } from './theme';

/** Show local release details, keeping the running version distinct from the installed native binary after an OTA update. */
export function AboutSettings() {
  const info = getAppInfo();
  const details: [string, string | undefined][] = [
    ['Version', info.version],
    ['Environment', info.environment],
    ['Installed version', info.nativeVersion],
    ['Build number', info.buildNumber],
    ['Update channel', info.channel],
    ['Runtime version', info.runtimeVersion],
    ['Update source', info.updateSource],
    ['Update ID', info.updateId],
  ];
  return <View style={{ gap: 16 }}>
    <Text accessibilityRole="header" style={styles.title}>Little Say</Text>
    <Text style={styles.body}>Version and build details for the app running on this device.</Text>
    <View style={[styles.card, { gap: 18 }]}>
      {details.filter(([, value]) => value !== undefined).map(([label, value]) => <View key={label} style={{ gap: 4 }}>
        <Text style={styles.label}>{label}</Text>
        <Text selectable style={styles.body}>{value}</Text>
      </View>)}
    </View>
    {info.nativeVersion !== undefined && <Text style={styles.small}>App updates can change Version without changing the installed version or build number.</Text>}
  </View>;
}
