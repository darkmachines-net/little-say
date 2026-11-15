# Shared hosting runtime

`runtime.ts` wires the same PostgreSQL jobs, account authorization, caches and provider execution for local development and deployment. `worker.ts` runs polling locally or IAM-authenticated HTTP delivery on Cloud Run. The API never performs slow AI work in its HTTP request. All runtimes require migrated PostgreSQL and configured Firebase; local setup supplies the emulator without credentials.

## Durable operations

`POST /api/ai/jobs` accepts `{id,kind,input}` and returns `202` with a UUID job ID. Kinds are `proposal`, `translation`, `analysis`, `review`, `speech`, and `picture`. GET `/api/ai/jobs/:id` reads owner-only state/result; POST `/:id/cancel` records cancellation. Legacy board, picture, batch, and speech endpoints use this repository too. Legacy non-picture submissions supply `X-Little-Say-Request` or `preparationId`; picture IDs and draft/tile bindings are preserved. Completed payloads retain their existing schemas. Board preparation publishes validated words and translations as a partial result before picture resolution. Its complete tile-indexed batch is persisted first, so clients can immediately display words and poll picture work; the worker retains its claim until the batch settles. Clarifications and invalid proposals never publish a partial board.

Admission locks each request and account and enforces immutable request content. A board proposal or refinement uses one board start. Its pictures are part of that job and consume no additional board starts. Speech and other standalone AI actions each have their own backlog and rate budget. Admission 429 responses include `Retry-After` and JSON `retryAfterSeconds` in whole seconds. The JSON `reason` distinguishes `rate-limit` (rolling budget) from `queue-full` (recheck after a short wait). Cancellation arriving before submission leaves an owner-bound tombstone. A committed queued row is dispatch intent, and maintenance can recover a missed notification. Repeated delivery returns existing state and never repeats a provider call.

`GET /api/ai/activity` returns uncached queued and working counts for `boards`, `speech`, and `other` for the authenticated account. It omits expired claims and carries no job identifiers or payloads. Reads leave queue state unchanged.

An admitted job starts in `queued` until a worker claims it. Delivery can take time, and a job waits for capacity if its service worker slots are full. A second board on the same account can also wait while the first is running, for example when two tabs submit or a previous request is still settling after cancellation. The outstanding cap includes both waiting and active board jobs.

PostgreSQL reserves separate worker slots for foreground jobs (proposals, translations, picture analysis or review, and standalone picture jobs) and speech jobs (one clip each). Polling workers favor runnable board proposals, and Cloud Tasks can reserve delivery capacity with separate queues. A board keeps one foreground slot through image completion, while its individual image calls use the separate image budgets below.

Independent image misses enter the board's scheduler together. Across boards, worker processes, and explicit single-card generation, `ImageCapacity` grants slots under a PostgreSQL lock. When capacity opens, it favors accounts with fewer active image calls and uses arrival order for ties. Account and service caps apply to paid image calls. Catalog lookups, reuse, and validation do not require a slot. An available account can run nine image calls at once with the defaults. Slots release when the call settles. Reconciliation removes abandoned tickets once their job claim is no longer active.

Matching normalized speech text/language requests are claimed one at a time across workers and accounts. Other words can run in parallel when speech capacity allows. After the first request publishes its clip, queued matches use the shared cache. Explicit regeneration still requests a new take. Interrupted work releases the matching queue without replaying its original request. `POST /api/speech` also returns `200` immediately for an existing, non-regenerating starter-vocabulary clip, including anonymous requests. This cache-only path creates no job and grants public access to that exact take; all other submissions retain account authorization. See [starter speech initialization](../../seeds/speech/README.md).

Workers heartbeat every two seconds. Claims whose heartbeat is more than 90 seconds old become `interrupted` (or `cancelled` when cancellation was requested) and cannot publish late results or be reclaimed. Admission and status reads settle the account's expired claims, and claim attempts settle expired global slots, so a delayed maintenance run does not leave stale busy state. Healthy claims and queued delivery intent are retained. Uncertain provider failures also become interrupted. A new attempt requires a new explicit request ID. Cancellation aborts supported provider calls and prevents result publication; an already sent provider request may still be billable. A release or process restart does not replay uncertain provider calls.

Worker interruption events include job ID and kind, execution stage, and a bounded failure category. Known PostgreSQL errors include SQLSTATE and provider HTTP errors include status. Neither error messages nor response bodies are logged. Cancellation and shutdown are logged at warning severity. Lost claims, heartbeat failures, and other unexpected failures still trigger the Cloud Run worker error alert.

## Configuration

Set these server-only whole numbers consistently on the API and every worker. The deployment settings are [`ai_limits`](../../../../deploy/gcp/README.md#ai-capacity).

| Setting | Default | Range and meaning |
| --- | ---: | --- |
| `AAC_AI_ACCOUNT_BOARD_STARTS_PER_MINUTE` | 2 | 1–120 new proposals/refinements per account in a rolling minute |
| `AAC_AI_ACCOUNT_BOARD_OUTSTANDING` | 2 | 1–24 queued and active board jobs combined per account |
| `AAC_AI_ACCOUNT_BOARD_CONCURRENCY` | 1 | 1–8 active boards per account, at most the outstanding limit |
| `AAC_AI_ACCOUNT_JOB_STARTS_PER_MINUTE` | 30 | 1–240 starts per account per rolling minute, counted separately for speech and other standalone AI actions |
| `AAC_AI_ACCOUNT_JOB_OUTSTANDING` | 2 | 1–24 queued and active jobs per account, counted separately for speech and other standalone AI actions |
| `AAC_AI_SERVICE_FOREGROUND_CONCURRENCY` | 8 | 1–16 executing foreground jobs across all workers |
| `AAC_AI_SERVICE_SPEECH_CONCURRENCY` | 4 | 1–8 executing speech jobs across all workers |
| `AAC_AI_ACCOUNT_IMAGE_CONCURRENCY` | 9 | 1–24 paid image calls at once per account across its jobs |
| `AAC_AI_SERVICE_IMAGE_CONCURRENCY` | 50 | 1–100 paid image calls at once across the service |

| Setting | Contract |
| --- | --- |
| `MEDIA_DIRECTORY` | Owned local/Render media directory; runtime metadata remains in PostgreSQL |
| `MEDIA_BUCKET` | Private GCS bucket; when set, attached ADC selects the Google adapter |
| `WORKER_MODE` | `poll` locally/Render; `cloud` requires production Cloud Run |
| `TASKS_QUEUE`, `WORKER_URL`, `TASKS_INVOKER` | Full queue name, HTTPS worker origin and invoking service-account email |
| `TASKS_SPEECH_QUEUE` | Dedicated speech queue; deployments with only `TASKS_QUEUE` share task delivery |
| `AAC_AI_ENABLED=false` | Operator admission/claim kill switch; change both API and worker configurations |
| `AAC_AI_FIXTURES=true` | Explicit local/test synthetic boards, pictures and silent WAVs; forbidden in production |
| `AAC_AI_WORKER_CONFIGURED=true` | Cloud API capability advertisement after the worker key is provisioned; the API does not receive that key |

Without a provider key or explicit fixtures, local AI is unavailable. Public catalog lookups, manual boards, device speech, and downloaded content remain available. AI requires a registered account under [account authorization](../accounts/README.md), including requests to direct Cloud Run URLs. Email verification gates backup rather than AI access; anonymous identities are rejected.

## Storage and deletion

`ObjectStore` contains whole media objects; `CacheStore` separates binary media from JSON metadata. Filesystem writes use same-directory atomic rename. GCS stores private objects with infrastructure-managed soft deletion. Existing content digests and download paths remain unchanged. PostgreSQL stores jobs, batch records, cache pointers and generic-content metadata. Private account backup bytes remain in PostgreSQL.

Speech cache pointers use the service-wide `speech` namespace with no account owner. Identity includes normalized text, language, model, voice, output format and instruction version; board and tile IDs do not affect reuse. `service_owned` media and shared pointers survive account deletion. The [shared-speech migration](../../migrations/README.md#applying-schema-changes) promotes existing owner pointers, keeps an already shared take when present, and retains older pointers for rolling deployments. Regeneration updates the shared pointer while old audio URLs stay immutable.

Other private cache metadata is owner-scoped and cascades on account deletion. Media grants authorize exact accounts; a trusted worker grants the requesting account access when it reuses speech. Ordinary shared speech remains private; only closed starter vocabulary, public catalog assets, and generic pictures admitted by the `GenericContent` sanitizer receive public grants. Jobs, boards, and backups remain private. Downloads use private browser caching and require an exact owner or public grant. Maintenance removes orphaned private objects under database locks, preserving service-owned speech, surviving owners and public assets. GCS soft-deleted objects remain recoverable for seven days; local files have no recovery window.

Maintenance retries pending dispatch and confirmed account deletion and reconciles interrupted work. Local workers run it every 15 seconds; Cloud Scheduler calls the private worker every five minutes. No required maintenance runs after an API response or relies on scale-to-zero instances remaining alive. [GCP operations](../../../../deploy/gcp/README.md) owns provisioning and recovery.
