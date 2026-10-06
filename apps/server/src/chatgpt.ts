/** @file Stores encrypted visitor ChatGPT sessions in Postgres and serializes OAuth renewal/disconnection across processes. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { type Pool, type PoolClient } from 'pg';
import { ChatGptError, chatGptResource, chatGptScope, openAIChatGptOAuth, type ChatGptOAuth, type ChatGptTokens } from './chatgpt-oauth';
import { chatGptProvider } from './chatgpt-provider';
import { type AiProvider } from './provider';

const secret = () => randomBytes(32).toString('hex');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sessionLifetime = 30 * 86400000;
type Session = { sub: string; email?: string; tokens: ChatGptTokens; expiresAt: number; model?: string; modelName?: string; welcomed: boolean };
type Transaction = { session: string; verifier: string; nonce: string; expectedSub?: string };
export interface ChatGptConfig { clientId: string; clientSecret?: string; redirectUri: string; encryptionKey: string; preferredModel?: string; }

/** Require complete opt-in configuration before exposing hosted ChatGPT connection flows. */
export function chatGptConfig(env: NodeJS.ProcessEnv): ChatGptConfig | null {
  if (env.CHATGPT_ENABLED !== 'true') return null;
  if (!env.CHATGPT_CLIENT_ID?.startsWith('oaiapp_') || !/^[a-f0-9]{64}$/i.test(env.CHATGPT_ENCRYPTION_KEY ?? '')) throw new Error('ChatGPT requires an approved CHATGPT_CLIENT_ID and a 64-character hexadecimal CHATGPT_ENCRYPTION_KEY.');
  const redirect = new URL(env.CHATGPT_REDIRECT_URI || '');
  if ((redirect.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && redirect.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(redirect.hostname))) || redirect.pathname !== '/api/chatgpt/callback' || redirect.search || redirect.hash || redirect.username || redirect.password) throw new Error('CHATGPT_REDIRECT_URI must be the registered HTTPS /api/chatgpt/callback URL.');
  return { clientId: env.CHATGPT_CLIENT_ID, clientSecret: env.CHATGPT_CLIENT_SECRET || undefined, redirectUri: redirect.href, encryptionKey: env.CHATGPT_ENCRYPTION_KEY!, preferredModel: env.OPENAI_BOARD_MODEL };
}

/** Uses the server-owned pool; grants stay encrypted independently of Firebase parent accounts. */
export class ChatGptConnections {
  private key: Buffer;
  /** Inject shared storage and replaceable OAuth/provider adapters for offline integration tests. */
  constructor(readonly config: ChatGptConfig, private db: Pool, private oauth: ChatGptOAuth = openAIChatGptOAuth(config), private providerFactory: (token: string, model: string) => AiProvider = chatGptProvider) {
    this.key = Buffer.from(config.encryptionKey, 'hex');
    if (this.key.length !== 32) throw new Error('Invalid ChatGPT encryption key.');
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
  private async read(id: string, db: Pool | PoolClient = this.db): Promise<Session | null> {
    const row = (await db.query('SELECT value FROM chatgpt_sessions WHERE id=$1 AND expires>$2', [hash(id), Date.now()])).rows[0];
    return row ? this.decrypt<Session>(row.value) : null;
  }
  private async save(id: string, value: Session, db: PoolClient) {
    await db.query('INSERT INTO chatgpt_sessions VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value,expires=EXCLUDED.expires', [hash(id), this.encrypt(value), Date.now() + sessionLifetime]);
  }
  private async locked<T>(id: string, action: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.db.connect();
    let locked = false;
    try { await db.query('SELECT pg_advisory_lock(hashtextextended($1,0))', ['chatgpt:' + hash(id)]); locked = true; return await action(db); }
    finally {
      let broken = false;
      if (locked) { try { await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', ['chatgpt:' + hash(id)]); } catch { broken = true; } }
      db.release(broken);
    }
  }
  /** Begin browser-bound PKCE without replacing a working connection. */
  async start(currentId: string) {
    const previous = await this.read(currentId);
    const state = secret(), binding = secret(), verifier = secret(), nonce = secret();
    const url = new URL(await this.oauth.authorizationEndpoint());
    url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: 'code', scope: chatGptScope, resource: chatGptResource, state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), ...(previous && !this.enabled(previous) ? { prompt: 'consent' } : {}) }).toString();
    await this.db.query('DELETE FROM chatgpt_transactions WHERE expires<=$1', [Date.now()]);
    // Bound opportunistic cleanup so abandoned grants do not accumulate indefinitely.
    await this.db.query('DELETE FROM chatgpt_sessions WHERE id IN (SELECT id FROM chatgpt_sessions WHERE expires<=$1 ORDER BY expires LIMIT 100)', [Date.now()]);
    await this.db.query('INSERT INTO chatgpt_transactions VALUES($1,$2,$3,$4)', [hash(binding), hash(state), this.encrypt({ session: previous ? currentId : secret(), verifier, nonce, expectedSub: previous?.sub } satisfies Transaction), Date.now() + 600000]);
    return { binding, url: url.href };
  }
  /** Atomically consume OAuth state and never resurrect a session disconnected during code exchange. */
  async complete(binding: string, query: { state?: string; code?: string; error?: string; client_id?: string }) {
    const row = (await this.db.query('DELETE FROM chatgpt_transactions WHERE binding=$1 AND state=$2 AND expires>$3 RETURNING value', [hash(binding), hash(query.state ?? ''), Date.now()])).rows[0];
    if (!row) throw new ChatGptError('ChatGPT sign-in expired or could not be verified. Try connecting again.', 400);
    if (query.error || !query.code || (query.client_id && query.client_id !== this.config.clientId)) throw new ChatGptError('ChatGPT connection was cancelled or could not be verified.', 400);
    const transaction = this.decrypt<Transaction>(row.value);
    if (transaction.expectedSub && !await this.read(transaction.session)) throw new ChatGptError('This ChatGPT connection was disconnected. Start a new connection.', 401);
    const tokens = await this.oauth.exchange(query.code, transaction.verifier);
    if (!tokens.id_token) throw new ChatGptError('ChatGPT did not return a verified identity.', 401);
    const identity = await this.oauth.identity(tokens.id_token, transaction.nonce);
    if (transaction.expectedSub && identity.sub !== transaction.expectedSub) throw new ChatGptError('A different ChatGPT account was selected. Disconnect the current account before switching.', 409);
    return this.locked(transaction.session, async db => {
      const previous = await this.read(transaction.session, db);
      if (transaction.expectedSub && !previous) throw new ChatGptError('This ChatGPT connection was disconnected. Start a new connection.', 401);
      await this.save(transaction.session, { ...identity, tokens: { ...tokens, id_token: undefined }, expiresAt: Date.now() + (tokens.expires_in ?? 0) * 1000, welcomed: previous?.welcomed ?? false }, db);
      return transaction.session;
    });
  }
  private enabled(session: Session) { return Boolean(session.tokens.access_token && session.tokens.token_type?.toLowerCase() === 'bearer' && session.tokens.scope?.split(' ').includes('chatgpt.tokens.use.direct')); }
  /** Return display-safe visitor state without exposing grants or subject identifiers. */
  async status(id: string) {
    const session = await this.read(id);
    return { available: true, selected: Boolean(id), connected: Boolean(session), planEnabled: Boolean(session && this.enabled(session)), email: session?.email, model: session?.modelName, needsLogin: Boolean(id && (!session || !session.tokens.access_token)), welcome: Boolean(session && this.enabled(session) && !session.welcomed) };
  }
  /** Persist the visitor's dismissal without overwriting a concurrent refresh. */
  async acknowledge(id: string) { await this.locked(id, async db => { const session = await this.read(id, db); if (session) { session.welcomed = true; await this.save(id, session, db); } }); }
  private async credentials(id: string): Promise<Session> {
    return this.locked(id, async db => {
      const session = await this.read(id, db);
      if (!session) throw new ChatGptError('Reconnect ChatGPT in Settings. The server API key was not used.', 401);
      if (!this.enabled(session)) throw new ChatGptError('Allow ChatGPT plan usage in Settings before sending AI requests.', 403);
      try {
        if (session.expiresAt <= Date.now() + 60000) {
          if (!session.tokens.refresh_token) throw new ChatGptError('Reconnect ChatGPT in Settings to continue.', 401, true);
          const tokens = await this.oauth.refresh(session.tokens.refresh_token);
          if (!tokens.access_token || !tokens.expires_in) throw new ChatGptError('ChatGPT could not renew this session. Try again later.');
          session.tokens = { ...session.tokens, ...tokens, id_token: undefined };
          session.expiresAt = Date.now() + tokens.expires_in * 1000;
          await this.save(id, session, db);
        }
        if (!this.enabled(session)) throw new ChatGptError('ChatGPT plan permission is no longer enabled. Reconnect in Settings.', 403);
        if (!session.model) {
          const models = await this.oauth.models(session.tokens.access_token!);
          const model = models.find(value => value.slug === this.config.preferredModel) ?? models[0];
          if (!model) throw new ChatGptError('No eligible ChatGPT model is available for this account.', 403);
          session.model = model.slug; session.modelName = model.display_name;
        }
        await this.save(id, session, db);
        return session;
      } catch (error) {
        if (error instanceof ChatGptError && error.terminal) { session.tokens = {}; await this.save(id, session, db); }
        throw error;
      }
    });
  }
  /** Use only this visitor's grant; errors never fall back to server billing. */
  async provider(id: string) {
    const session = await this.credentials(id);
    if (!await this.read(id)) throw new ChatGptError('This ChatGPT session was disconnected.', 401);
    const provider = this.providerFactory(session.tokens.access_token!, session.model!);
    const invoke = async <T>(operation: () => Promise<T>) => {
      try { return await operation(); }
      catch (error) {
        if (error instanceof ChatGptError && error.terminal) await this.locked(id, async db => {
          const current = await this.read(id, db);
          if (current && current.tokens.access_token === session.tokens.access_token) { current.tokens = {}; await this.save(id, current, db); }
        });
        throw error;
      }
    };
    return { propose: request => invoke(() => provider.propose(request)), translate: provider.translate ? request => invoke(() => provider.translate!(request)) : undefined, transcribe: (audio, filename, mime) => invoke(() => provider.transcribe(audio, filename, mime)) } satisfies AiProvider;
  }
  /** Serialize with renewal, delete durable access, and then revoke the latest refresh grant. */
  async disconnect(id: string) {
    return this.locked(id, async db => {
      const session = await this.read(id, db);
      await db.query('DELETE FROM chatgpt_sessions WHERE id=$1', [hash(id)]);
      return { revoked: session?.tokens.refresh_token ? await this.oauth.revoke(session.tokens.refresh_token) : !session?.tokens.access_token };
    });
  }
}
