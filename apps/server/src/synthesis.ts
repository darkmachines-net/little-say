/**
 * @file Generates bounded WAV speech through OpenAI Realtime and classifies media failures without response content.
 */

import { speechInstructions } from './prompts';
import OpenAI from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import { openAICredential } from './openai-auth';
import { type SpeechInput } from '@little-say/core';

export const MAX_SPEECH_BYTES = 960044; // At most 20 seconds of 24 kHz mono PCM.
/** Resolve the model, voice, and output format identity used to distinguish cached pronunciations. */
export function speechProfile(env: NodeJS.ProcessEnv) {
  return { model: env.OPENAI_SPEECH_MODEL || 'gpt-realtime-2.1-mini', voice: env.OPENAI_SPEECH_VOICE || 'marin', version: 1, format: 'wav-24000-mono' };
}
export type SpeechProfile = ReturnType<typeof speechProfile>;

type SpeechFailure = 'timeout' | 'realtime-connection' | 'realtime-provider' | 'audio-limit' | 'audio-invalid' | 'incomplete' | 'transcript-mismatch';

/** A bounded speech failure that can be reported without retaining a provider event or spoken text. */
export class SpeechSynthesisError extends Error {
  /** Store the failure category alongside the existing safe error message. */
  constructor(readonly category: SpeechFailure, message: string) { super(message); }
}
/**
 * Compare nonempty requested text and transcript after Unicode, case, punctuation, symbol, and
 * whitespace normalization.
 */
export function transcriptMatches(text: string, transcript: string) {
  const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
  return normalized(text).length > 0 && normalized(text) === normalized(transcript);
}
/** Wrap 24 kHz mono signed 16-bit PCM in a WAV header; reject empty, misaligned, or oversized audio. */
export function pcmToWav(pcm: Buffer): Buffer {
  if (!pcm.length || pcm.length % 2 || pcm.length + 44 > MAX_SPEECH_BYTES) throw new Error('Invalid speech audio.');
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Return a speech generator or null without configured credentials. Each request resolves its credential
 * before opening a connection it owns and closes, rejecting timeout, oversized output, or a mismatched transcript.
 */
export function openAISynthesis(env: NodeJS.ProcessEnv, profile: SpeechProfile) {
  const apiKey = openAICredential(env);
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey });
  return (input: SpeechInput): Promise<Buffer> => OpenAIRealtimeWS.create(client, {
    model: profile.model, options: { handshakeTimeout: 10000 },
  }).then(connection => new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let transcript = '';
    let settled = false;
    const finish = (error?: Error, audio?: Buffer) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); connection.close();
      if (error) reject(error); else resolve(audio!);
    };
    const timeout = setTimeout(() => finish(new SpeechSynthesisError('timeout', 'Speech generation timed out.')), 45000);
    connection.on('error', error => finish(new SpeechSynthesisError(error.error ? 'realtime-provider' : 'realtime-connection', 'Speech generation failed.')));
    connection.socket.on('close', () => finish(new SpeechSynthesisError('realtime-connection', 'Speech connection closed before completion.')));
    connection.on('session.created', () => {
      connection.send({ type: 'response.create', response: {
        conversation: 'none', output_modalities: ['audio'], max_output_tokens: 1024,
        audio: { output: { voice: profile.voice, format: { type: 'audio/pcm', rate: 24000 } } },
        instructions: speechInstructions(input.language),
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
      } });
    });
    connection.on('response.output_audio.delta', event => {
      if (settled) return;
      const chunk = Buffer.from(event.delta, 'base64'); bytes += chunk.length;
      if (bytes + 44 > MAX_SPEECH_BYTES) finish(new SpeechSynthesisError('audio-limit', 'Speech audio exceeded its limit.'));
      else chunks.push(chunk);
    });
    connection.on('response.output_audio_transcript.done', event => { transcript += event.transcript; });
    connection.on('response.done', event => {
      if (settled) return;
      if (event.response.status !== 'completed' || !transcriptMatches(input.text, transcript)) {
        finish(new SpeechSynthesisError(event.response.status === 'completed' ? 'transcript-mismatch' : 'incomplete', 'Speech did not match the requested words.')); return;
      }
      try { finish(undefined, pcmToWav(Buffer.concat(chunks))); } catch { finish(new SpeechSynthesisError('audio-invalid', 'Speech audio was invalid.')); }
    });
  }));
}
