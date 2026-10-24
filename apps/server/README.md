# API and web host

`src/index.ts` loads the environment and owns the HTTP listener, provider adapters, caches, and optional account infrastructure. `src/app.ts` registers the API and serves the exported browser app. `/api/health` reports capabilities; `/api/ready` also checks the database and exact migration history when accounts are enabled. Shutdown drains requests and closes owned resources.

Guest AI endpoints assume a trusted private network. Enabling [accounts](src/accounts/README.md) protects private backups; it does not turn guest AI into an authenticated public service. Never expose backend keys through `EXPO_PUBLIC_*`, client bundles, responses, or logs.

## Configuration

Run from the workspace root with the [development launcher](../../scripts/README.md), or build and start with `npm run build` and `npm start`. The standalone server loads the repository `.env` and its working-directory `.env`. Defaults below are defined by the corresponding adapters:

| Variable | Contract |
| --- | --- |
| `AAC_OPENAI_KEY` / `OPENAI_API_KEY` | Preferred server key / fallback; absent keys leave manual board use available |
| `OPENAI_BOARD_MODEL` | `gpt-6.1-sol`, used by board proposals and picture analysis |
| `OPENAI_REASONING_EFFORT` | `low` for board proposals |
| `OPENAI_SPEECH_MODEL` / `OPENAI_SPEECH_VOICE` | `gpt-realtime-2.1-mini` / `marin` |
| `OPENAI_IMAGE_MODEL`, `AAC_IMAGE_GENERATION`, `PICTURE_CACHE_DIR` | Owned by the [picture service](src/pictures/README.md) |
| `SPEECH_CACHE_DIR` | `../../.cache/speech` from the server working directory; `/app/data/speech` in Docker |
| `HOST` / `PORT` | `127.0.0.1` / `8787`; the development launcher supplies its own values |
| `ALLOWED_ORIGINS` | Comma-separated exact browser origins; set explicitly for deployment |
| `WEB_ROOT` | Optional exported web directory; see static-host resolution in `src/app.ts` |
| `FIREBASE_*`, `PG*` | Optional [accounts](src/accounts/README.md) and [database](migrations/README.md) configuration |

## Processing and retention

`provider.ts` sends parent prompts and necessary board text through Structured Outputs with `store: false`. Personal photos and local photo paths are excluded from AI requests. There is no microphone upload or transcription endpoint; parents use text or system keyboard dictation. Prompts, board text, credentials, and provider error bodies are excluded from logs. Provider retention is governed by [OpenAI's data policies](https://developers.openai.com/api/docs/guides/your-data).

`speech-cache.ts` retains shared generated clips, which may contain names or private words. Identity includes text, language, model, voice, and format. Identical requests reuse clips; regeneration preserves old immutable URLs for other devices. There is no automatic eviction. The [picture service](src/pictures/README.md) owns separate image/job retention, and [account storage](src/accounts/README.md) owns explicitly uploaded backups.

## Hosting

For a source-built private deployment:

```powershell
Copy-Item .env.example .env
# Set the backend key and ALLOWED_ORIGINS=https://your-private-hostname.
docker compose up -d --build
```

The root Compose file builds the app, binds to host loopback by default, and persists speech and picture caches in named volumes. The image runs as a non-root user with a read-only filesystem. Removing volumes removes cached media; device libraries are independent. Configure a private HTTPS reverse proxy and the production native origin in `native-release.json`. Restrict access if exposing another host interface.

Accounts require externally configured PostgreSQL and Firebase plus explicit migrations before startup. The image contains `server/database-cli.js` and SQL migrations; the ordinary server entry never migrates automatically. See [migration operation](migrations/README.md) and the [production deployment module](../../deploy/self-hosted/README.md) for the shared host's startup/readiness contract.

The web homepage `/` and browser app `/app` share an origin but have separate entries. Visit the built app online once before testing offline. Service-worker updates wait for a parent's action; browser storage belongs to the origin, so development and production have separate libraries.
