/** @file Resolves backend OpenAI credentials and shares renewable Cloud Run tokens across providers. */

import { gcpIDTokenProvider } from 'openai/auth';
import { WorkloadIdentityAuth } from 'openai/auth/workload-identity-auth';

type TokenSource = () => Promise<string>;
const sources = new WeakMap<NodeJS.ProcessEnv, { identityProviderId: string; serviceAccountId: string; token: TokenSource }>();

/** Resolve a local key or a shared, lazy federated token source. Partial federation settings disable the provider. */
export function openAICredential(env: NodeJS.ProcessEnv): string | TokenSource | undefined {
  const identityProviderId = env.OPENAI_IDENTITY_PROVIDER_ID?.trim();
  const serviceAccountId = env.OPENAI_SERVICE_ACCOUNT_ID?.trim();
  if (!identityProviderId && !serviceAccountId) return env.AAC_OPENAI_KEY?.trim() || env.OPENAI_API_KEY?.trim() || undefined;
  if (!identityProviderId || !serviceAccountId) return undefined;

  const existing = sources.get(env);
  if (existing?.identityProviderId === identityProviderId && existing.serviceAccountId === serviceAccountId) return existing.token;

  // The SDK's Realtime factory resolves function credentials before the WebSocket handshake.
  const auth = new WorkloadIdentityAuth({ identityProviderId, serviceAccountId,
    provider: gcpIDTokenProvider(), refreshBufferSeconds: 60,
  }, (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }));
  const token = () => auth.getToken();
  sources.set(env, { identityProviderId, serviceAccountId, token });
  return token;
}
