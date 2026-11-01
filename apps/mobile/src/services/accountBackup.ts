/** @file Derives honest backup status from account gates, transport results, and acknowledged board snapshots. */

export type BackupState = 'sign-in-required' | 'deletion-pending' | 'unverified' | 'offline' | 'error' | 'restoring' | 'syncing' | 'pending' | 'synced';

/** Prioritize blocking conditions over stale success timestamps; unsynced edits never appear up to date. */
export function accountBackupState(input: {
  needsLogin: boolean; deletionPending: boolean; verified: boolean; offline: boolean;
  error: boolean; restoring: boolean; syncing: boolean; pending: boolean;
}): BackupState {
  if (input.needsLogin) return 'sign-in-required';
  if (input.deletionPending) return 'deletion-pending';
  if (!input.verified) return 'unverified';
  if (input.offline) return 'offline';
  if (input.error) return 'error';
  if (input.restoring) return 'restoring';
  if (input.syncing) return 'syncing';
  return input.pending ? 'pending' : 'synced';
}

/** Recognize fetch transport failures (including apiFetch's wrapped cause), without classifying HTTP errors as offline. */
export function backupConnectionFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && error.cause instanceof TypeError)
    || (typeof error === 'object' && error !== null && 'code' in error && error.code === 'auth/network-request-failed');
}
