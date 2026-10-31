/** @file Presents Little Say's data-processing, default AI speech, storage, backup, and retention disclosures. */

import { Linking, Text, View } from 'react-native';
import { Button } from './components';
import { PictureCredits } from './PicturePreferences';
import { styles } from './theme';

/** Explain storage and default AI processing, and keep picture source/license credits reachable from Settings. */
export function PrivacyPolicy() {
  const sections = [
    ['On this device', 'Boards, personal photos, downloaded pictures and saved speech are stored on this device for offline use. Uninstalling the app or clearing its storage removes these local copies. Browsers may also remove data when storage is low.'],
    ['Optional account backup', 'Signing in enables backup of boards, photos, illustrations and saved speech after email verification. Backups restore your boards after reinstalling and sync them across devices. Device preferences stay on each device. Little Say’s service can access saved backups.'],
    ['AI processing', 'Board prompts and necessary card words are sent through Little Say to OpenAI. Speech uses AI-generated audio by default, with a matching device voice as fallback. Picture matching and generation also send card descriptions and library or generated picture pixels.'],
    ['Photos and dictation', 'Personal photos stay on this device unless you enable account backup; they are not sent to AI. Little Say does not record microphone audio or log prompt content. Use text entry or your keyboard’s dictation for prompts; dictation is handled by your device or keyboard provider.'],
    ['Retained audio and pictures', 'Generated speech is retained in the service’s audio cache. Library and generated pictures, concept descriptions and picture-job metadata are cached without automatic deletion. Downloaded copies support offline play.'],
    ['Account deletion', 'Delete account in Account & backup removes your account and its backup. Downloaded copies remain on your devices. Shared speech and picture caches are separate from account backups.'],
  ];
  return <View style={{ gap: 24 }}>{sections.map(([title, text]) => <View key={title} style={{ gap: 8 }}><Text accessibilityRole="header" style={styles.title}>{title}</Text><Text style={styles.body}>{text}</Text></View>)}<PictureCredits /><Button kind="ghost" onPress={() => void Linking.openURL('https://developers.openai.com/api/docs/guides/your-data')}>OpenAI data policy</Button></View>;
}
