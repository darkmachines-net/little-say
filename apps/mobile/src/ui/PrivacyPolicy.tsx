/** @file Presents default AI processing, device-local draft storage, automatic account backup, credits, and retention disclosures with Settings deletion guidance. */

import { Linking, Text, View } from 'react-native';
import { Button } from './components';
import { PictureCredits } from './PicturePreferences';
import { styles } from './theme';

/** Explain backup, storage, AI processing, and Settings account deletion; keep picture source/license credits reachable. */
export function PrivacyPolicy() {
  const sections = [
    ['On this device', 'Boards, explicitly saved creation drafts, personal photos, downloaded pictures and saved speech are stored on this device for offline use. Saved drafts include your prompt and conversation. Uninstalling the app or clearing its storage removes these local copies. Browsers may also remove data when storage is low.'],
    ['Automatic account backup', 'After signing in and verifying your email, boards, photos, illustrations and saved speech automatically back up and sync across your devices. Backups restore your boards after reinstalling. Device preferences and unfinished creation drafts stay on each device. Little Say’s service can access saved backups. Signing out stops synchronization on this device and keeps its downloaded copies.'],
    ['AI processing', 'Board prompts and necessary card words are sent through Little Say to OpenAI. Speech uses AI-generated audio by default, with a matching device voice as fallback. Picture matching and generation also send card descriptions and library or generated picture pixels.'],
    ['Photos and dictation', 'Personal photos are included in automatic account backups while signed in with a verified email; they are not sent to AI. Little Say does not record microphone audio or log prompt content. Use text entry or your keyboard’s dictation for prompts; dictation is handled by your device or keyboard provider.'],
    ['Retained audio and pictures', 'Generated speech is retained in the service’s audio cache. Library and generated pictures, concept descriptions and picture-job metadata are cached without automatic deletion. Downloaded copies support offline play.'],
    ['Account deletion', 'Open Settings from the app header, then choose Delete account in the Account group to remove your account and its backup. Downloaded copies remain on your devices. Shared speech and picture caches are separate from account backups.'],
  ];
  return <View style={{ gap: 24 }}>{sections.map(([title, text]) => <View key={title} style={{ gap: 8 }}><Text accessibilityRole="header" style={styles.title}>{title}</Text><Text style={styles.body}>{text}</Text></View>)}<PictureCredits /><Button kind="ghost" onPress={() => void Linking.openURL('https://developers.openai.com/api/docs/guides/your-data')}>OpenAI data policy</Button></View>;
}
