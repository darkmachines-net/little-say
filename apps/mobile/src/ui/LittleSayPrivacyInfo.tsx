/** @file Presents local, offline-readable data-use information without implying a finalized legal policy. */
import { Text, View } from 'react-native';
import { Button, Sheet } from './components';
import { privacyInfo } from './privacyInfo';
import { styles } from './theme';

/** Show factual privacy information and return to the unchanged settings draft when dismissed. */
export function LittleSayPrivacyInfo({ onClose }: { onClose: () => void }) {
  return <Sheet title="Little Say privacy information" onClose={onClose} footer={<Button onPress={onClose}>Back to settings</Button>}>
    <Text style={styles.body}>How Little Say handles your data. This information describes the app; it is not a finalized privacy policy for a hosted service.</Text>
    {privacyInfo.map(section => <View key={section.title} style={{ gap: 8 }}><Text accessibilityRole="header" style={styles.title}>{section.title}</Text><Text style={styles.body}>{section.text}</Text></View>)}
  </Sheet>;
}
