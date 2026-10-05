/** @file Verifies ChatGPT inference request compatibility and requires a successful terminal stream event before accepting a draft. */

import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { chatGptProvider } from '../src/chatgpt-provider';

const draft = { title: 'Farm', explanation: 'A cow.', needsClarification: false, playLanguages: ['en-US'], tiles: [{ existingId: null, label: 'Cow', speech: 'Cow', language: 'en-US', emoji: '🐄', color: 'sage', languageMode: 'fixed', translations: [] }] };
const completed = { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(draft) }] }] } };
function setup(events: unknown[]) {
  const create = vi.fn(async function* () { for (const event of events) yield event; });
  const client = { responses: { create } } as unknown as OpenAI;
  return { provider: chatGptProvider('visitor-token', 'entitled-model', client), create };
}
describe('ChatGPT streaming provider', () => {
  it('uses array input, instructions, streaming and no storage or unsupported parameters', async () => {
    const { provider, create } = setup([completed]);
    expect(await provider.propose({ prompt: 'A cow', board: null })).toMatchObject({ title: 'Farm' });
    const request = (create.mock.calls as unknown as [[Record<string, unknown>]])[0][0];
    expect(request).toMatchObject({ model: 'entitled-model', store: false, stream: true });
    expect(request.instructions).toBeTypeOf('string');
    expect(request.input).toEqual([{ role: 'user', content: JSON.stringify({ prompt: 'A cow', board: null }) }]);
    expect(request).not.toHaveProperty('max_output_tokens');
    expect(request).not.toHaveProperty('previous_response_id');
  });
  it('rejects interrupted or incomplete streams and surfaces limits arriving after text', async () => {
    for (const events of [[], [{ type: 'response.output_text.delta', delta: '{}' }], [{ type: 'response.incomplete' }]]) {
      await expect(setup(events).provider.propose({ prompt: 'A cow', board: null })).rejects.toThrow();
    }
    await expect(setup([{ type: 'response.output_text.delta', delta: 'Partial' }, { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }]).provider.propose({ prompt: 'A cow', board: null })).rejects.toMatchObject({ statusCode: 429 });
    await expect(setup([completed]).provider.transcribe(Buffer.alloc(0), 'prompt.wav', 'audio/wav')).rejects.toMatchObject({ statusCode: 409 });
  });
});
