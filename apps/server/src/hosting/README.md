# Shared hosting runtime

`runtime.ts` wires the same PostgreSQL jobs, account authorization, caches and provider execution for local development and deployment. `worker.ts` runs polling locally or IAM-authenticated HTTP delivery on Cloud Run. The API never performs slow AI work in its HTTP request. All runtimes require migrated PostgreSQL and configured Firebase; local setup supplies the emulator without credentials.

## Durable operations

`POST /api/ai/jobs` accepts `{id,kind,input}` and returns `202` with a UUID job ID. Kinds are `proposal`, `translation`, `analysis`, `review`, `speech`, and `picture`. GET `/api/ai/jobs/:id` reads owner-only state/result; POST `/:id/cancel` records cancellation. Legacy board, picture, batch, and speech endpoints use this repository too. Legacy non-picture submissions supply `X-Little-Say-Request` or `preparationId`; picture IDs and draft/tile bindings are preserved. Completed payloads retain their existing schemas. Board preparation can publish a partial result while its batch continues.

Admission locks each request and account, enforces immutable request content, 30 new submissions/minute and two outstanding operations per account. Two global execution claims bound provider work. Cancellation arriving before submission leaves an owner-bound tombstone. Delivery duplicates return existing state; a claim is never purchased twice. Every accepted queued row is dispatch intent: commit followed by queue failure remains discoverable by maintenance. Cloud Tasks carries only an ID. Its retries repeat delivery, never a claimed generation.

Workers heartbeat every two seconds. Lost claims become `interrupted` after 90 seconds and cannot publish late results or be reclaimed. Uncertain provider failures also become interrupted. A new attempt requires a new explicit request ID. Cancellation aborts supported provider calls and prevents result publication; an already sent provider request may still be billable. A release or process restart does not replay uncertain provider calls.

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

Private cache metadata is owner-scoped and cascades on account deletion. Media grants authorize exact accounts; trusted worker reuse adds a grant. Public catalog assets and generic assets admitted by the closed-vocabulary `GenericContent` sanitizer are public. Downloads use private browser caching and explicit authentication; API readers cannot grant themselves access. Maintenance removes orphaned private objects under database locks, preserving objects still owned by another account or approved for public reuse. GCS soft-deleted objects remain recoverable for seven days; local files have no recovery window.

Maintenance retries pending dispatch and confirmed account deletion and reconciles interrupted work. Local workers run it every 15 seconds; Cloud Scheduler calls the private worker every five minutes. No required maintenance runs after an API response or relies on scale-to-zero instances remaining alive. [GCP operations](../../../../deploy/gcp/README.md) owns provisioning and recovery.
