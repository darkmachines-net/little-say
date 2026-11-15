/** @file Polls owner-only AI activity when a parent screen is visible. */

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { z } from 'zod';
import { ApiError, apiFetch } from './api';

const counts = z.object({ queued: z.number().int().nonnegative(), working: z.number().int().nonnegative() });
const activitySchema = z.object({ boards: counts, speech: counts, other: counts });
export type AiActivity = z.infer<typeof activitySchema>;
const total = (jobs?: { queued: number; working: number }) => jobs ? jobs.queued + jobs.working : 0;

/** Refresh the current account's counts on visible parent screens and discard results after a scope change. */
export function useAiActivity(server: string, accountId: string | undefined, visible: boolean) {
  const scope = visible && accountId ? JSON.stringify([accountId, server]) : null;
  const [snapshot, setSnapshot] = useState<{ scope: string; activity: AiActivity } | null>(null);
  useEffect(() => {
    if (!scope) return;
    let request: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let supported = true;
    const pause = () => { clearTimeout(timer); request?.abort(); request = undefined; };
    const refresh = async () => {
      if (!supported || request) return;
      const pending = request = new AbortController();
      let delay = 60_000;
      try {
        const activity = activitySchema.parse(await apiFetch(server, '/api/ai/activity', {}, pending.signal));
        if (pending.signal.aborted) return;
        setSnapshot({ scope, activity });
        if (total(activity.boards) + total(activity.speech) + total(activity.other)) delay = 5000;
      } catch (error) {
        if (pending.signal.aborted) return;
        setSnapshot(null);
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) supported = false;
      } finally {
        if (request === pending) {
          request = undefined;
          if (supported) timer = setTimeout(() => void refresh(), delay);
        }
      }
    };
    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') void refresh();
    const lifecycle = AppState.addEventListener('change', state => {
      if (state === 'active') { clearTimeout(timer); void refresh(); }
      else pause();
    });
    return () => { pause(); lifecycle.remove(); };
  }, [scope, server]);
  return scope && snapshot?.scope === scope ? snapshot.activity : undefined;
}
