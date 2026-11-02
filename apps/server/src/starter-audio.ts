/** @file Publishes cached audio only for the fixed starter vocabulary; public requests never synthesize or expose arbitrary private clips. */

import type { FastifyInstance } from 'fastify';
import { createStarterBoards } from '@little-say/core';
import type { SpeechCache } from './speech-cache';

const vocabulary = createStarterBoards(() => 'public').flatMap(board => board.tiles.map(tile => ({ text: tile.speech, language: tile.language })));

/** Register anonymous, cache-only starter audio with a bounded 30-second lookup cache; the caller owns the speech cache. */
export function starterAudioRoutes(app: FastifyInstance, cache?: SpeechCache) {
  let expires = 0;
  let pending: ReturnType<SpeechCache['lookup']> | undefined;
  const clips = () => {
    if (!pending || Date.now() >= expires) {
      expires = Infinity;
      pending = (cache?.lookup(vocabulary) ?? Promise.resolve([])).then(result => {
        expires = Date.now() + 30000; return result;
      }, error => { pending = undefined; expires = 0; throw error; });
    }
    return pending;
  };
  const limits = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
  app.get('/api/starter-boards/audio', limits, async (_request, reply) => {
    return reply.header('Cache-Control', 'public, max-age=30').send({ clips: await clips() });
  });
  app.get<{ Params: { file: string } }>('/api/starter-boards/audio/:file', limits, async (request, reply) => {
    const match = /^([a-f0-9]{64})\.wav$/.exec(request.params.file);
    const allowed = match && (await clips()).some(clip => clip.id === match[1]);
    const audio = allowed && await cache?.read(match[1]);
    if (!audio) return reply.code(404).send({ error: 'Starter audio unavailable.' });
    return reply.header('Cache-Control', 'public, max-age=31536000, immutable').header('X-Content-Type-Options', 'nosniff').type('audio/wav').send(audio);
  });
}
