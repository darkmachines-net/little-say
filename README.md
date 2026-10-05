# Little Say

A local-first AAC soundboard app for parents and toddlers, built with Expo, React Native, TypeScript and a Fastify backend. The friendly mountain identity draws on the Pacific Northwest's Little Si.

## Run locally

Use Node 24. Set `AAC_OPENAI_KEY` in your environment (or `OPENAI_API_KEY` in an ignored root `.env`), then:

```powershell
npm.cmd ci
npm.cmd run dev:setup
npm.cmd run db:up # optional if you already run local Postgres
npm.cmd run dev
```

On macOS/Linux, use `npm` instead of `npm.cmd`. Scan Expo's QR code on a tablet on the same LAN. The launcher prepares Postgres, starts the Firebase Auth emulator on 9099, the API on 8788 and Expo on 8081, and injects the backend URL. The key stays on the backend. Windows User environment variables are supported even when the current terminal has not inherited them.

Choose `npm run dev:local` (also `npm run dev`) for full-stack changes, or `npm run dev:remote` for client changes against **https://littlesay.darkmachines.net**. Remote mode starts only Expo and needs no local API key. Stop the current session with Ctrl+C before switching modes; the selected backend overrides the saved app address for that development session.

`npm run dev:web` opens the website with the local API; choose **Open web app** to enter the app at `/app`. `npm run dev:web:remote` uses the deployed API through Expo's development proxy. `npm run dev:doctor` checks local connectivity; append `-- --remote` for the deployed backend. The same launchers are available as Codex environment actions. See [local development](docs/LOCAL_DEVELOPMENT.md) for commands, device setup and troubleshooting. Without a local key, choose **Start without starter boards** and create boards manually.

## Using the app

The website homepage (`/`) introduces Little Say and its features, with **Coming soon** placeholders for the App Store and Google Play. **Open web app** enters the browser app at `/app`; existing boards remain in the same origin's storage. Installed web apps launch directly into the app. The homepage uses a separate web entry and is neither accessible nor bundled in native iOS/Android apps.

- Choose preferred languages on first launch and optionally generate starter boards. Each device keeps boards, settings, photos and downloaded speech locally. Accounts are optional; **Account & backup** in Settings enables backup and sync, and **Sign in or restore boards** is available during setup.
- **New board** and **Edit with AI** open a full-page conversation beside a live draft canvas, stacked on phones. Pictures appear as they finish, with active and queued cards identified. Review transcripts and drafts, refine them, then explicitly save. Manual editing supports 1–24 cards, searchable emoji, local photos and cropping.
- The website can optionally connect a visitor's ChatGPT plan for board drafts and translations under **Settings → AI requests**. This requires an approved hosted OpenAI client and is disabled until configured. Speech and automatic picture generation are unavailable while connected; failed requests never switch to the server API key. See [ChatGPT setup and limitations](docs/CHATGPT.md).
- **Picture settings** in the workspace header and **Pictures** in the board editor choose automatic, library-only, generated, or emoji-only output. Matching detects inaccurate or ambiguous emoji, searches licensed illustrations, and optionally generates missing pictures in a consistent style. Cards offer **Picture options** to search, describe, replace or protect pictures. Automatic keeps good emoji, fills gaps from the library, and generates only missing pictures. Completed drafts do not prompt for AI illustrations; deliberate changes remain available in Picture settings. Library only and Emoji only avoid new generation; unavailable pictures fall back to useful emoji. See [pictures, sources and configuration](docs/PICTURES.md).
- The library spotlights the most recently used board and puts favorites immediately below it. Each board's **…** menu includes deletion and missing-audio generation.
- Set a board's **Languages** to offer a toggle during play. Individual cards can follow that toggle or keep their own language, useful for family names. Review generated translations or edit them manually.
- Playback accepts taps and swipes that start or end on a tile. It finishes the current utterance and keeps only the latest queued selection. Touch feedback and the speaking highlight are separate. Hold **Hold to unlock**, release when prompted, then confirm to leave.
- Synthetic speech is prepared in the background and saved for offline playback. Tile editors support **Generate audio** and **Regenerate audio** for the selected text/language; board controls fill missing clips. Device TTS is the fallback. **Automatic AI audio** in Settings controls background generation.

Photos use the platform picker/cropper on native and an in-app cropper on web. Later adjustments support dragging, pinch/slider zoom, and a preview matching the board framing. Photos stay on the device unless a parent enables account sync. Native adjustment starts from the system crop; choose the original again to recover cropped-out areas.

Use iOS Guided Access or Android screen pinning to restrict system navigation during play. The app cannot suppress operating-system gestures. Browser storage is tied to the URL's origin; development and production URLs have separate libraries. Without an account, uninstalling or clearing storage removes local boards and assets. With an account, sign in on the same server to restore the last successful backup. Wait for **All boards and assets are synced** before uninstalling; offline or failed changes have not been backed up. See [accounts and sync](docs/ACCOUNTS.md).

## Backend and privacy

OpenAI requests go through the backend using the following configuration. No secret belongs in `EXPO_PUBLIC_*` variables or the app.

| Variable | Default |
| --- | --- |
| `AAC_OPENAI_KEY` | Preferred backend key; falls back to `OPENAI_API_KEY` |
| `OPENAI_BOARD_MODEL` | `gpt-6.1-sol` |
| `OPENAI_REASONING_EFFORT` | `low` |
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-transcribe` |
| `OPENAI_SPEECH_MODEL` | `gpt-realtime-2.1-mini` |
| `OPENAI_SPEECH_VOICE` | `marin` |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.5-flare` |
| `AAC_IMAGE_GENERATION` | `true`; parents must also allow generation; `false` disables new generation |
| `PICTURE_CACHE_DIR` | `../../.cache/pictures` from the server working directory; `/app/data/pictures` in Docker |
| `SPEECH_CACHE_DIR` | `../../.cache/speech` from the server working directory; `/app/data/speech` in Docker |
| `PGHOST` / `PGPORT` | `127.0.0.1` / `5432`; Compose uses its private `postgres` service |
| `PGDATABASE` / `PGUSER` / `PGPASSWORD` | Required; server-only database configuration |
| `FIREBASE_PROJECT_ID` / `FIREBASE_API_KEY` / `FIREBASE_APP_ID` | Hosted Firebase project and public web app configuration |
| `HOST` / `PORT` | `127.0.0.1` / `8787` outside Docker |
| `ALLOWED_ORIGINS` | Local development origins; set explicitly for deployment |

AI actions start directly when requested, with an inline explanation instead of an opt-in screen. Only parent prompts, necessary board text and explicit microphone recordings are sent. Photo paths/content are excluded. Responses use Structured Outputs and `store: false`. The server does not retain microphone recordings or log prompts, transcripts, board text or provider error bodies. Provider retention follows [OpenAI's data policies](https://developers.openai.com/api/docs/guides/your-data).

Generated speech is retained in a shared server cache and can contain family names or other private tile words. Cache identity includes text, language, model, voice and format. Identical requests reuse clips; regeneration preserves old clip URLs for other devices. Downloaded speech works offline. The cache has no automatic eviction. Parents should review generated words and pronunciation.

## Private server

Illustration downloads and generated pictures use a separate server cache, including their concept descriptions and job metadata. Saved PNGs are also retained on the device for offline use. Personal photos remain local unless a parent enables account sync; account backups are separate from the AI caches. The cache has no automatic eviction; see [picture privacy and storage](docs/PICTURES.md).

For a source-built Docker deployment:

```powershell
Copy-Item .env.example .env
# Set hosted Firebase configuration, an external Admin credential file,
# a unique Postgres password, and ALLOWED_ORIGINS=https://your-private-hostname
npm.cmd run server:local
```

AI services remain available without accounts on a trusted private network. Account backups and their assets require authentication; adding accounts does not make the AI endpoints suitable for an open public service. Docker binds to `127.0.0.1:8787` by default. Route a private HTTPS origin through your reverse proxy and use that URL in Settings; web uses its own origin. Browser microphone access needs HTTPS outside localhost. If binding to another host interface, restrict access to the trusted network.

The container runs as a non-root user with a read-only filesystem. Its named `speech-cache`, `picture-cache`, and `postgres-data` volumes preserve cached assets and private account backups across replacements. Removing volumes deletes that data. Back up the account database as described in [accounts and sync](docs/ACCOUNTS.md); losing the server volume also loses the account backups.

For a web preview without Docker, configure Postgres and hosted Firebase (or explicitly run the development Auth emulator), run `npm run db:migrate`, then `npm run build` and `npm start` and open [localhost:8787](http://localhost:8787). Visit online once to cache the web shell before testing offline. Web updates wait for a parent's **Update now** action.

## Development and releases

- [Local development](docs/LOCAL_DEVELOPMENT.md): Expo Go, environment resolution, ports and device connectivity.
- [Testing](docs/testing.md): automated checks, opt-in live AI evaluation and native validation.
- [Releases](docs/releases.md): GitHub server-image publication; local native builds/submissions, OTA updates and server deployment.
- [Interface conventions](docs/DESIGN.md) and [mountain assets](apps/mobile/assets/brand/README.md).

`apps/mobile` contains the UI and platform adapters, `apps/server` the API and web host, and `packages/core` the schemas and shared behavior. `tests/fixtures` contains sample libraries used only by tests and evaluations. Native projects, build output, recordings, local credentials and generated test artifacts are ignored.

`npm run emoji:update` regenerates the offline catalog from pinned Unicode/CLDR data under the [Unicode License V3](packages/core/src/data/UNICODE-LICENSE.txt). `npm run brand:assets` regenerates icon sizes from the saved mountain master. Normal builds use the committed assets and need neither download nor image generation.


Firebase setup, provider callbacks, native build requirements, Compose/external database selection, backup/restore, and the future Cloud SQL connection are documented in [backend operation](docs/BACKEND.md).
