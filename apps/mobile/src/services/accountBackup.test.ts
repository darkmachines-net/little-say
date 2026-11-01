/** @file Verifies backup-state precedence so account gates, failures, and unsynced edits cannot be hidden by a prior success. */
import { expect, it } from 'vitest';
import { accountBackupState, backupConnectionFailure } from './accountBackup';

const healthy = { needsLogin: false, deletionPending: false, verified: true, offline: false, error: false, restoring: false, syncing: false, pending: false };

it('never reports pending local edits as up to date', () => {
  expect(accountBackupState(healthy)).toBe('synced');
  expect(accountBackupState({ ...healthy, pending: true })).toBe('pending');
  expect(accountBackupState({ ...healthy, pending: true, syncing: true })).toBe('syncing');
});
it('prioritizes account gates and failed restoration over stale sync activity', () => {
  expect(accountBackupState({ ...healthy, verified: false, offline: true })).toBe('unverified');
  expect(accountBackupState({ ...healthy, deletionPending: true, verified: false })).toBe('deletion-pending');
  expect(accountBackupState({ ...healthy, needsLogin: true, deletionPending: true })).toBe('sign-in-required');
  expect(accountBackupState({ ...healthy, restoring: true, syncing: true })).toBe('restoring');
  expect(accountBackupState({ ...healthy, restoring: true, error: true })).toBe('error');
  expect(accountBackupState({ ...healthy, restoring: true, error: true, offline: true })).toBe('offline');
});
it('separates network transport failures from server or data failures', () => {
  expect(backupConnectionFailure(new TypeError('Failed to fetch'))).toBe(true);
  expect(backupConnectionFailure(new Error('Cannot reach service', { cause: new TypeError('Network request failed') }))).toBe(true);
  expect(backupConnectionFailure({ code: 'auth/network-request-failed' })).toBe(true);
  expect(backupConnectionFailure(new Error('Backup file failed verification'))).toBe(false);
});
