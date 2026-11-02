# API and web host

`src/index.ts` starts the API using shared PostgreSQL and Firebase configuration. `src/worker.ts` executes durable AI jobs and maintenance. `src/app.ts` registers HTTP routes and serves the built browser app; its injectable provider mode is retained for isolated unit fixtures. `/api/health` reports capabilities; `/api/ready` verifies the additive migration prefix. Shutdown drains owned resources.

Registered account identities own server-funded AI requests. Owner checks protect jobs, cancellation and personal generated-media downloads, including direct Cloud Run URLs. Downloaded content remains available offline. [Account sessions](src/accounts/README.md) and the [shared hosting runtime](src/hosting/README.md) own these contracts; [client services](../mobile/src/services/README.md#accounts-and-sync) own sign-in and automatic backup behavior.

## Public starter audio

`src/starter-audio.ts` exposes `GET /api/starter-boards/audio` as `{ clips: [{ text, language, id }] }` and `GET /api/starter-boards/audio/:id.wav` for the [public trial](../mobile/src/website/README.md). Only the fixed English starter vocabulary can resolve to public clips under the active synthesis profile. Neither route accepts generation inputs or starts synthesis. The manifest lookup is coalesced and cached for 30 seconds; WAVs are immutable and publicly cacheable. Other speech URLs retain account authorization, and unrelated clips cannot be downloaded through the public route.

Prepared clips use the [shared speech cache](src/hosting/README.md#storage-and-deletion), so normal signed-in starter preparation populates them once. An OpenAI key is needed to generate missing clips, but reading already prepared clips works with generation disabled. Empty/missing caches produce an empty index; the trial uses device speech. Changing the speech profile requires clips prepared for that profile.

## Configuration

Use the [development launcher](../../scripts/README.md) for the complete local stack. It needs Node and Docker, with no cloud account. `docker compose up --build` starts PostgreSQL, Auth, migrations, API, worker and the built web app at localhost:8787. Development accounts/media persist in checkout-owned volumes; ordinary shutdown never deletes them. PostgreSQL is loopback-only.

| Variable | Contract |
| --- | --- |
| `AAC_OPENAI_KEY` / `OPENAI_API_KEY` | Worker key / fallback; missing keys disable paid AI |
| `AAC_AI_FIXTURES=true` | Explicit local synthetic responses; forbidden in production |
| `AAC_AI_ENABLED=false` | Operator kill switch for API admission and worker claims |
| `OPENAI_BOARD_MODEL` / `OPENAI_REASONING_EFFORT` | `gpt-6.1-sol` / `low` |
| `OPENAI_SPEECH_MODEL` / `OPENAI_SPEECH_VOICE` | `gpt-realtime-2.1-mini` / `marin` |
| `OPENAI_IMAGE_MODEL`, `AAC_IMAGE_GENERATION` | [Picture provider settings](src/pictures/README.md) |
| `MEDIA_DIRECTORY` / `MEDIA_BUCKET` | Local disk / private GCS objects; metadata stays in PostgreSQL |
| `HOST` / `PORT` | API listener; launcher supplies the selected trusted LAN address |
| `ALLOWED_ORIGINS` | Exact comma-separated browser origins; never `*` for authenticated use |
| `WEB_ROOT` | Optional browser export; image uses `/app/web` |
| `FIREBASE_*`, `PG*` | Required [identity](src/accounts/README.md) and [database](migrations/README.md) settings |

The standalone entry loads root/working-directory `.env` files. Production rejects emulator and fixture settings. Server secrets never belong in `EXPO_PUBLIC_*`, bundles, responses or logs. Cloud workers use attached service accounts; local Firebase emulation needs no credentials.

## Processing and retention

`provider.ts` sends parent prompts and necessary board text through Structured Outputs with `store:false`. Personal photos and local paths are excluded from AI requests. There is no microphone upload/transcription endpoint. Logs exclude prompts, boards, credentials and provider bodies. Provider retention follows [OpenAI data policies](https://developers.openai.com/api/docs/guides/your-data).

Generated speech is reused across accounts through the [service-wide cache](src/hosting/README.md#storage-and-deletion); authenticated requests grant access to the reused clip. Immutable digests and existing download routes are preserved. JSON indexes, job/batch state and generic metadata live in PostgreSQL, binary generated media in the selected object store. Private backup bytes remain in PostgreSQL.

## Deployment

[GCP operations](../../deploy/gcp/README.md) owns Terraform, bootstrap, credentials, recovery and launch acceptance. The application image is shared by API, worker and migration job. Ordinary API startup never migrates. The protected [release toolkit](../../scripts/release/README.md) deploys backend before mobile/OTA.

The homepage `/` and app `/app` share an origin with separate entries. Visit the browser app online before testing offline. Service-worker updates wait for parent action. Browser storage belongs to its origin, so development and production libraries are separate.
