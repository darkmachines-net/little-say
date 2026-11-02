/**
 * @file Exercises API validation including the shared language cap, origins, concurrency, retired audio input, and static web
 * serving.
 */

import { starterLibrary } from '../../../tests/fixtures/library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/app';
import release from '../../../release.json';
import { type AiProvider } from '../src/provider';
import { type GeneratedBoard, boardContext } from '@little-say/core';
import { fileURLToPath } from 'node:url';
const draft: GeneratedBoard = { title: 'Farm', explanation: 'A cow to start with.', needsClarification: false, tiles: [{ existingId: null, label: 'Cow', speech: 'Cow', language: 'en-US', emoji: '🐄', color: 'sage' }] };
const headers = { 'X-Little-Say': '1', 'content-type': 'application/json' };
const servers: Awaited<ReturnType<typeof createServer>>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(app => app.close())); });
async function server(provider: AiProvider | null = { propose: vi.fn(async () => draft) }) {
  const app = await createServer({ provider }); servers.push(app); await app.ready(); return app;
}
describe('private generation API', () => {
  it('passes clarification history and the latest draft while retaining the original revision', async () => {
    const board = boardContext(starterLibrary().boards[0]);
    const propose = vi.fn(async () => draft);
    const app = await server({ propose });
    const history = [{ prompt: 'Make a board with lots of animals', reply: 'How many tiles would you like?' }];
    const payload = { prompt: 'Six, please', board, conversation: { history, draft: null } };
    expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers, payload })).json()).toMatchObject({ boardId: board.id, baseRevision: board.revision });
    expect(propose).toHaveBeenLastCalledWith(payload);
    const refinement = { ...payload, prompt: 'Make the cow blue', conversation: { history: [...history, { prompt: 'Six, please', reply: draft.explanation }], draft } };
    expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers, payload: refinement })).statusCode).toBe(200);
    expect(propose).toHaveBeenLastCalledWith(refinement);
  });
  it('rejects forged draft references, unbounded history and invalid drafts before spending on AI', async () => {
    const propose = vi.fn(async () => draft);
    const app = await server({ propose });
    const payload = { prompt: 'Change it', board: boardContext(starterLibrary().boards[0]) };
    const invalid = [
      { history: [], draft: { ...draft, tiles: [{ ...draft.tiles[0], existingId: 'temporary-draft-id' }] } },
      { history: Array(20).fill({ prompt: 'More', reply: 'Done' }), draft },
      { history: [{ prompt: 'x'.repeat(4001), reply: 'Done' }], draft },
      { history: [], draft: { ...draft, needsClarification: true } },
      { history: [], draft: { ...draft, tiles: Array(25).fill(draft.tiles[0]) } },
    ];
    for (const conversation of invalid) expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers, payload: { ...payload, conversation } })).statusCode).toBe(400);
    expect(propose).not.toHaveBeenCalled();
  });
  it('forwards device languages to generation and rejects invalid preferences before AI', async () => {
    const propose = vi.fn(async () => draft);
    const app = await server({ propose });
    const payload = { prompt: 'Animals', board: null, languageProfile: { languages: ['es-MX', 'fr-FR', 'en-US'], defaultLanguage: 'es-MX' } };
    expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers, payload })).statusCode).toBe(200);
    expect(propose).toHaveBeenCalledWith(payload);
    expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers, payload: { ...payload, languageProfile: { ...payload.languageProfile, defaultLanguage: 'not_a_tag' } } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers, payload: { ...payload, languageProfile: { ...payload.languageProfile, languages: [...payload.languageProfile.languages, 'de-DE'] } } })).statusCode).toBe(400);
    expect(propose).toHaveBeenCalledOnce();
  });
  it('translates only requested tile-language pairs and ties results to the board revision', async () => {
    const translate = vi.fn(async () => ({ translations: [{ tileId: 'cow', language: 'ru-RU', label: 'Корова', speech: 'корова' }] }));
    const app = await server({ propose: vi.fn(), translate });
    const payload = { boardId: 'farm', baseRevision: 7, tiles: [{ id: 'cow', label: 'Cow', speech: 'Cow', language: 'en-US', targets: ['ru-RU'] }] };
    const result = await app.inject({ method: 'POST', url: '/api/boards/translate', headers, payload });
    expect(result.statusCode).toBe(200); expect(result.json()).toMatchObject({ boardId: 'farm', baseRevision: 7, translations: [{ speech: 'корова' }] });
    expect(translate).toHaveBeenCalledWith(payload);
    expect((await app.inject({ method: 'POST', url: '/api/boards/translate', headers, payload: { ...payload, tiles: [{ ...payload.tiles[0], targets: ['invalid_tag'] }] } })).statusCode).toBe(400);
    expect(translate).toHaveBeenCalledOnce();
  });
  it('rejects partial translations and hides provider error details', async () => {
    const translate = vi.fn().mockResolvedValueOnce({ translations: [] }).mockRejectedValueOnce(new Error('private words and key'));
    const app = await server({ propose: vi.fn(), translate });
    const payload = { boardId: 'farm', baseRevision: 0, tiles: [{ id: 'cow', label: 'Cow', speech: 'Cow', language: 'en-US', targets: ['ru-RU'] }] };
    for (let i = 0; i < 2; i++) {
      const result = await app.inject({ method: 'POST', url: '/api/boards/translate', headers, payload });
      expect(result.statusCode).toBe(502); expect(result.body).not.toContain('private');
    }
  });
  it('serves the web shell repeatedly without AI throttling and sets valid response headers', async () => {
    const app = await createServer({ provider: null, webRoot: fileURLToPath(new URL('./fixtures', import.meta.url)) }); servers.push(app);
    for (let i = 0; i < 40; i++) {
      const response = await app.inject('/'); expect(response.statusCode).toBe(200); expect(response.body).toContain('Soundboards'); expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['permissions-policy']).toBe('microphone=(), camera=()');
    }
    expect((await app.inject('/api/missing')).statusCode).toBe(404);
    expect((await app.inject('/missing.js')).statusCode).toBe(404);
  });
  it('never spends the AI rate-limit quota on opening the app or readiness checks', async () => {
    const app = await server();
    for (let i = 0; i < 40; i++) expect((await app.inject('/api/health')).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers, payload: { prompt: 'Cow', board: null } })).statusCode).toBe(200);
  });
  it('reports readiness without keys and preserves a usable manual-only app', async () => {
    const app = await server(null);
    expect((await app.inject('/api/health')).json()).toEqual({ status: 'ok', aiConfigured: false, version: release.version, pictures: { version: 1, catalog: false, analysis: false, generation: false } });
    const result = await app.inject({ method: 'POST', url: '/api/boards/propose', headers, payload: { prompt: 'Farm', board: null } });
    expect(result.statusCode).toBe(503); expect(result.json().error).toContain('manually');
  });
  it('returns a bounded proposal tied to the source revision', async () => {
    const app = await server(); const board = starterLibrary().boards[0];
    const response = await app.inject({ method: 'POST', url: '/api/boards/propose', headers, payload: { prompt: 'Replace the board with one cow', board: boardContext(board) } });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ boardId: board.id, baseRevision: 0, proposal: draft });
  });
  it('rejects malformed requests before invoking AI', async () => {
    const propose = vi.fn(async () => draft); const app = await server({ propose });
    for (const prompt of ['', 'x'.repeat(4001)]) {
      const response = await app.inject({ method: 'POST', url: '/api/boards/propose', headers, payload: { prompt, board: null } }); expect(response.statusCode).toBe(400);
    }
    expect(propose).not.toHaveBeenCalled();
  });
  it('rejects foreign browser origins and missing non-simple request headers', async () => {
    const propose = vi.fn(async () => draft); const app = await server({ propose });
    const payload = { prompt: 'Cow', board: null };
    expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers: { ...headers, origin: 'https://unrelated.example' }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/boards/propose', payload })).statusCode).toBe(403);
    expect(propose).not.toHaveBeenCalled();
  });
  it('rejects invented tile references and keeps provider details out of errors', async () => {
    const app = await server({ propose: vi.fn(async () => ({ ...draft, tiles: [{ ...draft.tiles[0], existingId: 'invented' }] })) });
    expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers, payload: { prompt: 'Cow', board: null } })).statusCode).toBe(502);
    const failing = await server({ propose: vi.fn(async () => { throw new Error('private prompt and key'); }) });
    const response = await failing.inject({ method: 'POST', url: '/api/boards/propose', headers, payload: { prompt: 'Cow', board: null } });
    expect(response.statusCode).toBe(502); expect(response.body).not.toContain('private prompt');
  });
  it('caps concurrent provider calls and frees capacity after failures', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const app = await server({ propose: vi.fn(async () => { await gate; return draft; }) });
    const options = { method: 'POST' as const, url: '/api/boards/propose', headers, payload: { prompt: 'Cow', board: null } };
    const first = app.inject(options); const second = app.inject(options);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect((await app.inject(options)).statusCode).toBe(429);
    release(); await Promise.all([first, second]); expect((await app.inject(options)).statusCode).toBe(200);
  });
  it('rejects retired transcription requests without spending on AI, including legacy uploads', async () => {
    const propose = vi.fn();
    // An older provider implementation must never be reached through the retired route.
    const transcribe = vi.fn();
    const provider = { propose, transcribe };
    const app = await server(provider);
    expect((await app.inject({ method: 'POST', url: '/api/transcribe', headers, payload: {} })).statusCode).toBe(404);
    const payload = Buffer.from(`--boundary\r\nContent-Disposition: form-data; name="audio"; filename="prompt.webm"\r\nContent-Type: audio/webm\r\n\r\n${'a'.repeat(200)}\r\n--boundary--\r\n`);
    const response = await app.inject({ method: 'POST', url: '/api/transcribe', headers: { 'x-little-say': '1', 'content-type': 'multipart/form-data; boundary=boundary' }, payload });
    expect(response.statusCode).toBe(404);
    expect(propose).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
  });
});
