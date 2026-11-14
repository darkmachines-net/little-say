# Shared hosting runtime

`runtime.ts` wires the same PostgreSQL jobs, account authorization, caches and provider execution for local development and deployment. `worker.ts` runs polling locally or IAM-authenticated HTTP delivery on Cloud Run. The API never performs slow AI work in its HTTP request. All runtimes require migrated PostgreSQL and configured Firebase; local setup supplies the emulator without credentials.

## Durable operations

`POST /api/ai/jobs` accepts `{id,kind,input}` and returns `202` with a UUID job ID. Kinds are `proposal`, `translation`, `analysis`, `review`, `speech`, and `picture`. GET `/api/ai/jobs/:id` reads owner-only state/result; POST `/:id/cancel` records cancellation. Legacy board, picture, batch, and speech endpoints use this repository too. Legacy non-picture submissions supply `X-Little-Say-Request` or `preparationId`; picture IDs and draft/tile bindings are preserved. Completed payloads retain their existing schemas. Board preparation publishes validated words and translations as a partial result before picture resolution. Its complete tile-indexed batch is persisted first, so clients can immediately display words and poll picture work; the worker retains its claim until the batch settles. Clarifications and invalid proposals never publish a partial board.

Admission locks each request and account and enforces immutable request content. Each account has separate allowances for speech and interactive work (all other kinds): each permits 30 new submissions/minute and two outstanding operations. Automatic speech preparation therefore cannot reject a board prompt by filling its admission slots or rate allowance. Admission 429 responses describe recent request volume separately from outstanding work and include `Retry-After` in whole seconds. The header gives the time until the rolling rate limit clears or a short wait before rechecking outstanding work. A rejected admission queues no new job. Two global execution claims still bound provider work across both allowances; accepted requests wait in the queue when those claims are occupied. Cancellation arriving before submission leaves an owner-bound tombstone. Delivery duplicates return existing state; a claim is never purchased twice. Every accepted queued row is dispatch intent: commit followed by queue failure remains discoverable by maintenance. Cloud Tasks carries only an ID. Its retries repeat delivery, never a claimed generation.

Matching normalized speech text/language requests are claimed one at a time across workers and accounts; other words can use the remaining execution slot. After the first request publishes its clip, queued matches use the shared cache. Explicit regeneration still requests a new take. Interrupted work releases the matching queue without replaying its original request. `POST /api/speech` also returns `200` immediately for an existing, non-regenerating starter-vocabulary clip, including anonymous requests. This cache-only path creates no job and grants public access to that exact take; all other submissions retain account authorization. See [starter speech initialization](../../seeds/speech/README.md).

Workers heartbeat every two seconds. Claims whose heartbeat is more than 90 seconds old become `interrupted` (or `cancelled` when cancellation was requested) and cannot publish late results or be reclaimed. Admission and status reads settle the account's expired claims, and claim attempts settle expired global slots, so a delayed maintenance run does not leave stale busy state. Healthy claims and queued delivery intent are retained. Uncertain provider failures also become interrupted. A new attempt requires a new explicit request ID. Cancellation aborts supported provider calls and prevents result publication; an already sent provider request may still be billable. A release or process restart does not replay uncertain provider calls.

Worker interruption events include job ID and kind, execution stage, and a bounded failure category. Known PostgreSQL errors include SQLSTATE and provider HTTP errors include status. Neither error messages nor response bodies are logged. Cancellation and shutdown are logged at warning severity. Lost claims, heartbeat failures, and other unexpected failures still trigger the Cloud Run worker error alert.

## Configuration

| Setting | Contract |
| --- | --- |
| `MEDIA_DIRECTORY` | Owned local/Render media directory; runtime metadata remains in PostgreSQL |
| `MEDIA_BUCKET` | Private GCS bucket; when set, attached ADC selects the Google adapter |
| `WORKER_MODE` | `poll` locally/Render; `cloud` requires production Cloud Run |
| `TASKS_QUEUE`, `WORKER_URL`, `TASKS_INVOKER` | Full queue name, HTTPS worker origin and invoking service-account email |
| `AAC_AI_ENABLED=false` | Operator admission/claim kill switch; change both API and worker configurations |
| `AAC_AI_FIXTURES=true` | Explicit local/test synthetic boards, pictures and silent WAVs; forbidden in production |
| `AAC_AI_WORKER_CONFIGURED=true` | Cloud API capability advertisement after the worker key is provisioned; the API does not receive that key |

Without a provider key or explicit fixtures, local AI is unavailable. Public catalog lookups, manual boards, device speech, and downloaded content remain available. AI requires a registered account under [account authorization](../accounts/README.md), including requests to direct Cloud Run URLs. Email verification gates backup rather than AI access; anonymous identities are rejected.

## Storage and deletion

`ObjectStore` contains whole media objects; `CacheStore` separates binary media from JSON metadata. Filesystem writes use same-directory atomic rename. GCS stores private objects with infrastructure-managed soft deletion. Existing content digests and download paths remain unchanged. PostgreSQL stores jobs, batch records, cache pointers and generic-content metadata. Private account backup bytes remain in PostgreSQL.

Speech cache pointers use the service-wide `speech` namespace with no account owner. Identity includes normalized text, language, model, voice, output format and instruction version; board and tile IDs do not affect reuse. `service_owned` media and shared pointers survive account deletion. The [shared-speech migration](../../migrations/README.md#applying-schema-changes) promotes existing owner pointers, keeps an already shared take when present, and retains older pointers for rolling deployments. Regeneration updates the shared pointer while old audio URLs stay immutable.

Other private cache metadata is owner-scoped and cascades on account deletion. Media grants authorize exact accounts; a trusted worker grants the requesting account access when it reuses speech. Ordinary shared speech remains private; only closed starter vocabulary, public catalog assets, and generic pictures admitted by the `GenericContent` sanitizer receive public grants. Jobs, boards, and backups remain private. Downloads use private browser caching and require an exact owner or public grant. Maintenance removes orphaned private objects under database locks, preserving service-owned speech, surviving owners and public assets. GCS soft-deleted objects remain recoverable for seven days; local files have no recovery window.

Maintenance retries pending dispatch and confirmed account deletion and reconciles interrupted work. Local workers run it every 15 seconds; Cloud Scheduler calls the private worker every five minutes. No required maintenance runs after an API response or relies on scale-to-zero instances remaining alive. [GCP operations](../../../../deploy/gcp/README.md) owns provisioning and recovery.
