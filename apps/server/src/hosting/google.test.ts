/** @file Checks filesystem and Google object contracts plus authenticated task delivery without cloud credentials or provider calls. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileObjects } from './storage';
import { GoogleObjects, GoogleDispatch } from './google';

vi.mock('firebase-admin/app', () => ({ applicationDefault: vi.fn(() => ({ getAccessToken: vi.fn(async () => ({ access_token: 'fixture-credential' })) })) }));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const action of cleanup.splice(0)) await action(); });

describe.each(['files', 'google'])('%s object storage', kind => {
  it('round trips bytes across adapter instances and treats repeated deletion as success', async () => {
    const root = await mkdtemp(join(tmpdir(), 'little-say-objects-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const data = new Map<string, Buffer>();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject({ Authorization: 'Bearer fixture-credential' });
      const parsed = new URL(url), key = parsed.searchParams.get('name') ?? decodeURIComponent(parsed.pathname.split('/o/')[1]);
      if (init.method === 'POST') { data.set(key, Buffer.from(init.body as Uint8Array)); return new Response('{}'); }
      if (init.method === 'DELETE') return new Response(null, { status: data.delete(key) ? 204 : 404 });
      return data.has(key) ? new Response(new Uint8Array(data.get(key)!)) : new Response(null, { status: 404 });
    }));
    const create = () => kind === 'files' ? new FileObjects(root) : new GoogleObjects('fixture-bucket');
    expect(await create().read('pictures/absent.png')).toBeNull();
    await create().write('pictures/content.png', Buffer.from([0, 1, 255]));
    expect(await create().read('pictures/content.png')).toEqual(Buffer.from([0, 1, 255]));
    await create().remove('pictures/content.png'); await create().remove('pictures/content.png');
    expect(await create().read('pictures/content.png')).toBeNull();
  });
});
it('does not confuse a Google authorization or transient failure with a cache miss', async () => {
  for (const status of [403, 429, 503]) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
    await expect(new GoogleObjects('fixture-bucket').read('speech/sample.wav')).rejects.toThrow(`(${status})`);
  }
});
it('dispatches duplicate-safe authenticated notifications without job inputs and retains failures for reconciliation', async () => {
  const request = vi.fn(async () => new Response(null, { status: 409 })); vi.stubGlobal('fetch', request);
  const dispatch = new GoogleDispatch('projects/little-say/locations/us-central1/queues/ai', 'https://worker.run.app', 'tasks@little-say.iam.gserviceaccount.com');
  await dispatch.send('00000000-0000-0000-0000-000000000000');
  const [, init] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(init.body)).task.httpRequest).toMatchObject({
    url: 'https://worker.run.app/internal/jobs/00000000-0000-0000-0000-000000000000', body: 'e30=',
    oidcToken: { audience: 'https://worker.run.app', serviceAccountEmail: 'tasks@little-say.iam.gserviceaccount.com' },
  });
  request.mockImplementation(async () => new Response(null, { status: 503 }));
  await expect(dispatch.send('00000000-0000-0000-0000-000000000000')).rejects.toThrow('(503)');
});
