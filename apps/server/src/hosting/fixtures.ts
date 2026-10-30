/** @file Supplies explicit non-production AI fixtures for local end-to-end checks without network calls or charges. */
import { type AiProvider } from '../provider';
import { type PictureProvider } from '../pictures/provider';
import { pcmToWav } from '../synthesis';
import { type GeneratedBoard } from '@little-say/core';

/** Return deterministic data; hosted configuration rejects fixture mode in production. */
export function fixtureProviders() {
  const board: GeneratedBoard = { title: 'Local test board', explanation: 'Local fixture; no AI service was called.', needsClarification: false, tiles: [{ existingId: null, label: 'Hello', speech: 'Hello', language: 'en-US', emoji: '👋', color: 'sage' }] };
  const boards: AiProvider = {
    /** Return a detached single-card fixture. */
    async propose() { return structuredClone(board); },
  };
  const pictures: PictureProvider = {
    model: 'local-fixture',
    /** Return fixture concepts for the submitted card identities. */
    async analyze(input) { return { tiles: input.tiles.map(tile => ({ id: tile.id, emoji: tile.emoji, concept: { description: tile.label, searchTerms: [tile.label], features: [], emojiAccurate: true } })) }; },
    /** Choose only an offered catalog candidate. */
    async select(_concept, candidates) { return candidates[0]?.id ?? null; },
    /** Return a synthetic one-pixel PNG solely for storage and download contracts. */
    async generate() { return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XcAAAAASUVORK5CYII=', 'base64'); },
    /** Preserve supplied pictures in the deterministic fixture. */
    async review() { return []; },
  };
  return { boards, pictures,
    /** Produce a short silent WAV exclusively for fixture persistence checks. */
    speech: async () => pcmToWav(Buffer.alloc(480)),
  };
}
