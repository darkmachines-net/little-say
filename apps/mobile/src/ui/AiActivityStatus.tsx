/** @file Shows quiet background AI activity on parent screens only when work is pending. */

import { Text } from 'react-native';
import type { AiActivity } from '../services/aiActivity';
import type { SpeechLibrary } from '../services/speechLibrary';
import { styles } from './theme';

const total = (jobs?: { queued: number; working: number }) => jobs ? jobs.queued + jobs.working : 0;

/** Announce waiting or active jobs, counting overlapping local and server speech once. */
export function AiActivityStatus({ activity, audio, hideBoards = false, hideOther = false }: {
  activity?: AiActivity; audio: SpeechLibrary; hideBoards?: boolean; hideOther?: boolean;
}) {
  const local = audio.backgroundWork();
  const messages: string[] = [];
  const boards = total(activity?.boards);
  if (boards && !hideBoards) {
    const subject = boards === 1 ? '1 board request' : `${boards} board requests`;
    messages.push(`${subject} ${activity?.boards.working ? 'in progress' : 'waiting to start'}.`);
  }
  const clips = Math.max(local.pending, total(activity?.speech));
  if (clips) {
    if (local.state === 'preparing' || activity?.speech.working) messages.push(`Preparing ${clips === 1 ? '1 audio clip' : `${clips} audio clips`} in the background.`);
    else if (local.state === 'offline') messages.push('Audio preparation will resume when you’re back online.');
    else messages.push('Audio preparation is queued and will resume automatically.');
  }
  const other = total(activity?.other);
  if (other && !hideOther) messages.push(`${other === 1 ? '1 other AI task' : `${other} other AI tasks`} ${activity?.other.working ? 'in progress' : 'waiting to start'}.`);
  return messages.length > 0 ? <Text testID="background-ai-status" accessibilityLiveRegion="polite" style={styles.small}>{messages.join(' ')}</Text> : null;
}
