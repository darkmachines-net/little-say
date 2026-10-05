/** @file Stores isolated, encrypted visitor ChatGPT sessions and one-use OAuth transactions; owns refresh serialization and provider selection. */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ChatGptError, chatGptResource, chatGptScope, openAIChatGptOAuth, type ChatGptOAuth, type ChatGptTokens } from './chatgpt-oauth';
import { chatGptProvider } from './chatgpt-provider';
import { type AiProvider } from './provider';

const secret = () => randomBytes(32).toString('hex');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sessionLifetime = 30 * 86400000;
type Session = { sub: string; email?: string; tokens: ChatGptTokens; expiresAt: number; model?: string; modelName?: string; welcomed: boolean };
type Transaction = { session: string; verifier: string; nonce: string; expectedSub?: string };
export interface ChatGptConfig { clientId: string; clientSecret?: string; redirectUri: string; encryptionKey: string; database: string; preferredModel?: string; }

/** Read explicit hosted integration configuration; partial configuration fails startup instead of exposing a broken connection button. */
export function chatGptConfig(env: NodeJS.ProcessEnv): ChatGptConfig | null {
  if (env.CHATGPT_ENABLED !== 'true') return null;
  if (!env.CHATGPT_CLIENT_ID?.startsWith('oaiapp_') || !/^[a-f0-9]{64}$/i.test(env.CHATGPT_ENCRYPTION_KEY ?? '')) throw new Error('ChatGPT requires an approved CHATGPT_CLIENT_ID and a 64-character hexadecimal CHATGPT_ENCRYPTION_KEY.');
  const redirect = new URL(env.CHATGPT_REDIRECT_URI || '');
  if ((redirect.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && redirect.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(redirect.hostname))) || redirect.pathname !== '/api/chatgpt/callback' || redirect.search || redirect.hash || redirect.username || redirect.password) throw new Error('CHATGPT_REDIRECT_URI must be the registered HTTPS /api/chatgpt/callback URL.');
  return { clientId: env.CHATGPT_CLIENT_ID, clientSecret: env.CHATGPT_CLIENT_SECRET || undefined, redirectUri: redirect.href, encryptionKey: env.CHATGPT_ENCRYPTION_KEY!, database: env.CHATGPT_DB_PATH || '../../.cache/chatgpt/sessions.sqlite', preferredModel: env.OPENAI_BOARD_MODEL };
}

/** Owns one server process's durable encrypted sessions. Run one service instance per database and close after requests finish. */
export class ChatGptConnections {
  private db: DatabaseSync;
  private key: Buffer;
  private refreshes = new Map<string, Promise<Session>>();
  private disconnecting = new Set<string>();
  /** Open private SQLite storage and inject OAuth/provider adapters for offline security tests. */
  constructor(readonly config: ChatGptConfig, private oauth: ChatGptOAuth = openAIChatGptOAuth(config), private providerFactory: (token: string, model: string) => AiProvider = chatGptProvider) {
    if (config.database !== ':memory:') mkdirSync(dirname(config.database), { recursive: true, mode: 0o700 });
    this.key = Buffer.from(config.encryptionKey, 'hex');
    if (this.key.length !== 32) throw new Error('Invalid ChatGPT encryption key.');
    this.db = new DatabaseSync(config.database);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS chatgpt_sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS chatgpt_transactions (binding TEXT PRIMARY KEY, state TEXT NOT NULL, value TEXT NOT NULL, expires INTEGER NOT NULL);`);
  }
  private encrypt(value: unknown) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }
  private decrypt<T>(value: string): T {
    const bytes = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString()) as T;
  }
  private read(id: string): Session | null {
    const row = this.db.prepare('SELECT value FROM chatgpt_sessions WHERE id = ? AND expires > ?').get(hash(id), Date.now());
    return row ? this.decrypt<Session>(row.value as string) : null;
  }
  private save(id: string, value: Session) {
    this.db.prepare('INSERT OR REPLACE INTO chatgpt_sessions VALUES (?, ?, ?)').run(hash(id), this.encrypt(value), Date.now() + sessionLifetime);
  }
  /** Begin browser-bound PKCE without replacing a working connection; the callback must present both cookie and state. */
  async start(currentId: string) {
    const previous = this.read(currentId);
    const state = secret(), binding = secret(), verifier = secret(), nonce = secret();
    const url = new URL(await this.oauth.authorizationEndpoint());
    url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: 'code', scope: chatGptScope, resource: chatGptResource, state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), ...(previous && !this.enabled(previous) ? { prompt: 'consent' } : {}) }).toString();
    this.db.prepare('DELETE FROM chatgpt_transactions WHERE expires <= ?').run(Date.now());
    this.db.prepare('DELETE FROM chatgpt_sessions WHERE expires <= ?').run(Date.now());
    this.db.prepare('INSERT INTO chatgpt_transactions VALUES (?, ?, ?, ?)').run(hash(binding), hash(state), this.encrypt({ session: previous ? currentId : secret(), verifier, nonce, expectedSub: previous?.sub } satisfies Transaction), Date.now() + 600000);
    return { binding, url: url.href };
  }
  /** Atomically consume the transaction, validate identity, and save only the grants returned by OpenAI. */
  async complete(binding: string, query: { state?: string; code?: string; error?: string; client_id?: string }) {
    const row = this.db.prepare('DELETE FROM chatgpt_transactions WHERE binding = ? AND state = ? AND expires > ? RETURNING value').get(hash(binding), hash(query.state ?? ''), Date.now());
    if (!row) throw new ChatGptError('ChatGPT sign-in expired or could not be verified. Try connecting again.', 400);
    if (query.error || !query.code || (query.client_id && query.client_id !== this.config.clientId)) throw new ChatGptError('ChatGPT connection was cancelled or could not be verified.', 400);
    const transaction = this.decrypt<Transaction>(row.value as string);
    if (transaction.expectedSub && !this.read(transaction.session)) throw new ChatGptError('This ChatGPT connection was disconnected. Start a new connection.', 401);
    const tokens = await this.oauth.exchange(query.code, transaction.verifier);
    if (!tokens.id_token) throw new ChatGptError('ChatGPT did not return a verified identity.', 401);
    const identity = await this.oauth.identity(tokens.id_token, transaction.nonce);
    if (transaction.expectedSub && identity.sub !== transaction.expectedSub) throw new ChatGptError('A different ChatGPT account was selected. Disconnect the current account before switching.', 409);
    if (transaction.expectedSub && !this.read(transaction.session)) throw new ChatGptError('This ChatGPT connection was disconnected. Start a new connection.', 401);
    // Retain identity-only consent, but never use it to pay for inference.
    const session: Session = { ...identity, tokens: { ...tokens, id_token: undefined }, expiresAt: Date.now() + (tokens.expires_in ?? 0) * 1000, welcomed: this.read(transaction.session)?.welcomed ?? false };
    this.save(transaction.session, session);
    return transaction.session;
  }
  private enabled(session: Session) { return Boolean(session.tokens.access_token && session.tokens.token_type?.toLowerCase() === 'bearer' && session.tokens.scope?.split(' ').includes('chatgpt.tokens.use.direct')); }
  /** Return display-safe connection state without exposing tokens, subject IDs, PKCE, or provider details. */
  status(id: string) {
    const session = this.read(id);
    return { available: true, selected: Boolean(id), connected: Boolean(session), planEnabled: Boolean(session && this.enabled(session)), email: session?.email, model: session?.modelName, needsLogin: Boolean(id && (!session || !session.tokens.access_token)), welcome: Boolean(session && this.enabled(session) && !session.welcomed) };
  }
  /** Persist dismissal of the first successful plan-use confirmation. */
  acknowledge(id: string) { const session = this.read(id); if (session) { session.welcomed = true; this.save(id, session); } }
  private async credentials(id: string): Promise<Session> {
    if (this.disconnecting.has(id)) throw new ChatGptError('This ChatGPT session is being disconnected.', 401);
    const pending = this.refreshes.get(id);
    if (pending) return pending;
    const session = this.read(id);
    if (!session) throw new ChatGptError('Reconnect ChatGPT in Parent settings. The server API key was not used.', 401);
    if (!this.enabled(session)) throw new ChatGptError('Allow ChatGPT plan usage in Parent settings before sending AI requests.', 403);
    const operation = (async () => {
      try {
        if (session.expiresAt <= Date.now() + 60000) {
          if (!session.tokens.refresh_token) throw new ChatGptError('Reconnect ChatGPT in Parent settings to continue.', 401, true);
          const tokens = await this.oauth.refresh(session.tokens.refresh_token);
          if (!tokens.access_token || !tokens.expires_in) throw new ChatGptError('ChatGPT could not renew this session. Try again later.');
          session.tokens = { ...session.tokens, ...tokens, id_token: undefined };
          session.expiresAt = Date.now() + tokens.expires_in * 1000;
          if (!this.read(id)) throw new ChatGptError('This ChatGPT session was disconnected.', 401);
          this.save(id, session);
        }
        if (!this.enabled(session)) throw new ChatGptError('ChatGPT plan permission is no longer enabled. Reconnect in Parent settings.', 403);
        if (!session.model) {
          const models = await this.oauth.models(session.tokens.access_token!);
          const model = models.find(value => value.slug === this.config.preferredModel) ?? models[0];
          if (!model) throw new ChatGptError('No eligible ChatGPT model is available for this account.', 403);
          session.model = model.slug; session.modelName = model.display_name;
        }
        if (!this.read(id)) throw new ChatGptError('This ChatGPT session was disconnected.', 401);
        this.save(id, session);
        return session;
      } catch (error) {
        if (error instanceof ChatGptError && error.terminal && this.read(id)) { session.tokens = {}; this.save(id, session); }
        throw error;
      }
    })();
    this.refreshes.set(id, operation);
    try { return await operation; } finally { this.refreshes.delete(id); }
  }
  /** Resolve only this visitor's bearer credential and entitled model; failure never falls back to the server provider. */
  async provider(id: string) {
    const session = await this.credentials(id);
    if (this.disconnecting.has(id) || !this.read(id)) throw new ChatGptError('This ChatGPT session was disconnected.', 401);
    const provider = this.providerFactory(session.tokens.access_token!, session.model!);
    const invoke = async <T>(operation: () => Promise<T>) => {
      try { return await operation(); }
      catch (error) {
        const current = this.read(id);
        if (error instanceof ChatGptError && error.terminal && current && current.tokens.access_token === session.tokens.access_token) { current.tokens = {}; this.save(id, current); }
        throw error;
      }
    };
    return { propose: request => invoke(() => provider.propose(request)), translate: provider.translate ? request => invoke(() => provider.translate!(request)) : undefined, transcribe: (audio, filename, mime) => invoke(() => provider.transcribe(audio, filename, mime)) } satisfies AiProvider;
  }
  /** Stop future inference immediately, revoke renewal with bounded retries, then report whether revocation was confirmed. */
  async disconnect(id: string) {
    this.disconnecting.add(id);
    // Let an in-flight rotation finish so revocation uses its latest refresh token.
    await this.refreshes.get(id)?.catch(() => {});
    const session = this.read(id);
    this.db.prepare('DELETE FROM chatgpt_sessions WHERE id = ?').run(hash(id));
    try { return { revoked: session?.tokens.refresh_token ? await this.oauth.revoke(session.tokens.refresh_token) : !session?.tokens.access_token }; }
    finally { this.disconnecting.delete(id); }
  }
  /** Release SQLite after Fastify has drained requests. */
  close() { this.db.close(); }
}
