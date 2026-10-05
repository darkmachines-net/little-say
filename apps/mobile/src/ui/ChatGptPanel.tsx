/** @file Offers an optional browser ChatGPT plan connection, explicit billing changes, and first-connection confirmation. */

import { Linking, Platform, Text, View } from 'react-native';
import { useState } from 'react';
import { useChatGpt } from '../services/useChatGpt';
import { Button, Notice, Sheet } from './components';
import { styles } from './theme';

/** Present the supported hosted connection independently of local board storage. */
export function ChatGptPanel({ server }: { server: string }) {
  const connection = useChatGpt(server);
  const [callbackError] = useState(() => Platform.OS === 'web' && new URLSearchParams(window.location.search).get('chatgpt') === 'error');
  if (Platform.OS !== 'web') return null;
  const { status, busy, error, message } = connection;
  return <View style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={styles.title}>AI requests</Text>
    {callbackError && <Notice>ChatGPT connection was cancelled or could not be verified. Your previous AI setting is unchanged. You can try again.</Notice>}
    {error && <Notice>{error}</Notice>}
    {message && <Text accessibilityLiveRegion="polite" style={styles.body}>{message}</Text>}
    <Text style={styles.body}>Use your ChatGPT plan for board drafts and translations. Eligible usage counts toward your ChatGPT plan or available credits. Connecting does not upload your saved boards.</Text>
    {!connection.supported ? <Text style={styles.small}>To connect, open Little Say at your server’s website address.</Text> : connection.loading ? <Text style={styles.small}>Checking AI connection…</Text> : <>
      <Text style={styles.body}>{connection.selected ? status?.planEnabled ? 'Using ChatGPT plan' : 'ChatGPT selected — reconnect or allow plan usage' : 'Using the server’s API key'}</Text>
      {status?.email && <Text style={styles.small}>{status.email}</Text>}
      {status?.model && <Text style={styles.small}>{status.model}</Text>}
      <Text style={styles.small}>While connected, AI audio, voice prompts, and automatic pictures are unavailable. Saved audio, device voices, emoji, photos, and manually chosen library pictures still work. Failed requests never switch to the server’s API key.</Text>
      {status?.available ? (!status.planEnabled || status.needsLogin) && <Button busy={busy} onPress={() => void connection.connect()}>Continue with ChatGPT</Button> : <Text style={styles.small}>ChatGPT connection has not been enabled on this server.</Text>}
      {connection.selected && <>
        <Button kind="secondary" onPress={() => void Linking.openURL('https://chatgpt.com/settings/usage')}>Manage usage</Button>
        <Button kind="ghost" busy={busy} onPress={() => void connection.disconnect()}>Disconnect ChatGPT & use server AI</Button>
      </>}
    </>}
    {status?.welcome && <Sheet title="You’re using your ChatGPT plan" onClose={() => void connection.acknowledge()}>
      <Text style={styles.body}>Eligible board drafts and translations now use your ChatGPT plan or available credits. You can manage this app’s usage and access in ChatGPT settings.</Text>
      {error && <Notice>{error}</Notice>}
      <Button busy={busy} onPress={() => void connection.acknowledge()}>Got it</Button>
    </Sheet>}
  </View>;
}
