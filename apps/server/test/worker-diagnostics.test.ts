/** @file Exercises worker failure reporting and terminal settlement under the default capacity policy. */

import { afterEach, expect, test, vi } from 'vitest';
import { APIError, APIUserAbortError } from 'openai';
import { DatabaseError } from 'pg';
import { runJob, type Runtime } from '../src/hosting/runtime';
import { type Job } from '../src/hosting/jobs';
import { readAiLimits } from '../src/hosting/limits';

const translate = vi.hoisted(() => vi.fn());
vi.mock('../src/provider', () => ({ openAIProvider: () => ({ translate }) }));

const job: Job = {
  id: '10000000-0000-4000-8000-000000000001', account_id: 'synthetic-owner',
  kind: 'translation', input: { text: 'private prompt' }, state: 'working', result: null,
  error: null, claim: 'test-claim', cancel_requested: false,
};

function fixture() {
  const jobs = { limits: readAiLimits({}), finish: vi.fn().mockResolvedValue(undefined), heartbeat: vi.fn().mockResolvedValue('active') };
  const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  const runtime = { jobs, pool, env: {}, objects: {} } as unknown as Runtime;
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warningLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
  return { jobs, runtime, errorLog, warningLog, stop: new AbortController() };
}

function pendingProvider() {
  let reject!: (error: Error) => void;
  const promise = new Promise<never>((_resolve, fail) => { reject = fail; });
  return { promise, reject };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); translate.mockReset(); });

test('emits provider HTTP status without logging error content or replaying the claim', async () => {
  const { jobs, runtime, errorLog, stop } = fixture();
  translate.mockRejectedValueOnce(new APIError(429, { message: 'private provider body' }, 'private error', new Headers({ 'x-request-id': 'req_private' })));
  await runJob(runtime, job, stop.signal);

  expect(errorLog).toHaveBeenCalledTimes(1);
  expect(JSON.parse(errorLog.mock.calls[0][0])).toEqual({
    severity: 'ERROR', message: 'AI operation interrupted; automatic provider retry disabled.',
    jobId: job.id, kind: 'translation', stage: 'execute', category: 'provider-http', status: 429,
  });
  expect(jobs.finish.mock.calls).toEqual([[job, null, true]]);
  expect(translate).toHaveBeenCalledTimes(1);
});

test('reports a heartbeat database failure as an error even when provider work aborts', async () => {
  vi.useFakeTimers();
  const { jobs, runtime, errorLog, warningLog, stop } = fixture();
  const probeError = new DatabaseError('secret connection details', 0, 'error');
  probeError.code = '08006';
  jobs.heartbeat.mockRejectedValueOnce(probeError);
  const pending = pendingProvider();
  translate.mockReturnValueOnce(pending.promise);

  const work = runJob(runtime, job, stop.signal);
  await vi.advanceTimersByTimeAsync(2000);
  pending.reject(new APIUserAbortError());
  await work;

  expect(warningLog).not.toHaveBeenCalled();
  expect(errorLog).toHaveBeenCalledTimes(1);
  expect(JSON.parse(errorLog.mock.calls[0][0])).toMatchObject({ severity: 'ERROR', stage: 'heartbeat', category: 'database', code: '08006' });
  expect(errorLog.mock.calls[0][0]).not.toContain('secret');
  expect(jobs.finish.mock.calls).toEqual([[job, null, true]]);
});

test.each([
  { state: 'cancelled', severity: 'WARNING', category: 'cancelled' },
  { state: 'lost', severity: 'ERROR', category: 'claim-lost' },
])('distinguishes claim state $state from unexpected operation failures', async ({ state, severity, category }) => {
  vi.useFakeTimers();
  const { jobs, runtime, errorLog, warningLog, stop } = fixture();
  const pending = pendingProvider();
  translate.mockReturnValueOnce(pending.promise);
  jobs.heartbeat.mockResolvedValueOnce(state);
  const work = runJob(runtime, job, stop.signal);
  await vi.advanceTimersByTimeAsync(2000);
  pending.reject(new APIUserAbortError());
  await work;

  const [expectedLog, otherLog] = severity === 'WARNING' ? [warningLog, errorLog] : [errorLog, warningLog];
  expect(otherLog).not.toHaveBeenCalled();
  expect(JSON.parse(expectedLog.mock.calls[0][0])).toMatchObject({ severity, category });
  expect(jobs.finish.mock.calls).toEqual([[job, null, true]]);
});

test('shutdown stops a claim before provider work and emits a warning', async () => {
  const { jobs, runtime, errorLog, warningLog, stop } = fixture();
  stop.abort();
  await runJob(runtime, job, stop.signal);

  expect(errorLog).not.toHaveBeenCalled();
  expect(JSON.parse(warningLog.mock.calls[0][0])).toMatchObject({ severity: 'WARNING', category: 'shutdown' });
  expect(translate).not.toHaveBeenCalled();
  expect(jobs.finish.mock.calls).toEqual([[job, null, true]]);
});
