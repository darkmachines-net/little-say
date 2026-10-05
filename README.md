# Little Say

A local-first AAC soundboard app for children and the people supporting them, built with Expo, React Native, TypeScript and a Fastify backend. The friendly mountain identity draws on the Pacific Northwest's Little Si.

## Run locally

Use Node 24. Set `AAC_OPENAI_KEY` in your environment (or `OPENAI_API_KEY` in an ignored root `.env`), then:

```powershell
npm.cmd ci
npm.cmd run dev
```

On macOS/Linux, use `npm` instead of `npm.cmd`. Scan Expo's QR code on a tablet on the same LAN. The launcher starts the API on port 8788 and Expo on 8081, and injects the backend URL. The key stays on the backend. Windows User environment variables are supported even when the current terminal has not inherited them.

Choose `npm run dev:local` (also `npm run dev`) for full-stack changes, or `npm run dev:remote` for client changes against **https://littlesay.darkmachines.net**. Remote mode starts only Expo and needs no local API key. Stop the current session with Ctrl+C before switching modes; the selected backend overrides the saved app address for that development session.

`npm run dev:web` opens the browser app with the local API; `npm run dev:web:remote` uses the deployed API through Expo's development proxy. `npm run dev:doctor` checks local connectivity; append `-- --remote` for the deployed backend. The same launchers are available as Codex environment actions. See [local development](docs/LOCAL_DEVELOPMENT.md) for commands, device setup and troubleshooting. Without a local key, choose **Start without starter boards** and create boards manually.

## Using the app

- Choose preferred languages on first launch and optionally generate starter boards. Each device keeps boards, settings, photos and downloaded speech locally. Accounts are optional; **Little Say account** in Settings enables backup and sync, and **Sign in or restore boards** is available during setup.
- **New board** and **Edit with AI** open a conversation for typed or spoken prompts. Review transcripts and drafts, refine them, then explicitly save. Manual editing supports 1–24 cards, searchable emoji, local photos and cropping.
- **Picture settings** in a conversation and **Pictures** in the board editor choose automatic, library-only, generated, or emoji-only output. Matching detects inaccurate or ambiguous emoji, searches licensed illustrations, and optionally generates missing pictures in a consistent style. Cards offer **Picture options** to search, describe, replace or protect pictures. Automatic paid generation starts off. See [pictures, sources and configuration](docs/PICTURES.md).
- The library spotlights the most recently used board and puts favorites immediately below it. Each board's **…** menu includes deletion and missing-audio generation.
- Set a board's **Languages** to offer a toggle during play. Individual cards can follow that toggle or keep their own language, useful for family names. Review generated translations or edit them manually.
- Playback accepts taps and swipes that start or end on a tile. It finishes the current utterance and keeps only the latest queued selection. Touch feedback and the speaking highlight are separate. Hold **Hold to unlock**, release when prompted, then confirm to leave.
- Synthetic speech is prepared in the background and saved for offline playback. Tile editors support **Generate audio** and **Regenerate audio** for the selected text/language; board controls fill missing clips. Device TTS is the fallback. **Automatic AI audio** in Settings controls background generation.

Photos use the platform picker/cropper on native and an in-app cropper on web. Later adjustments support dragging, pinch/slider zoom, and a preview matching the board framing. Photos stay on the device unless you enable account sync. Native adjustment starts from the system crop; choose the original again to recover cropped-out areas.

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
| `AAC_IMAGE_GENERATION` | `true`; you must also allow generation; `false` disables new generation |
| `PICTURE_CACHE_DIR` | `../../.cache/pictures` from the server working directory; `/app/data/pictures` in Docker |
| `SPEECH_CACHE_DIR` | `../../.cache/speech` from the server working directory; `/app/data/speech` in Docker |
| `ACCOUNT_DB_PATH` | `../../.cache/accounts/accounts.sqlite` from the server working directory; `/app/data/accounts/accounts.sqlite` in Docker |
| `HOST` / `PORT` | `127.0.0.1` / `8787` outside Docker |
| `ALLOWED_ORIGINS` | Local development origins; set explicitly for deployment |

AI consent covers your prompts, necessary board text and explicit microphone recordings. Photo paths/content are excluded. Responses use Structured Outputs and `store: false`. The server does not retain microphone recordings or log prompts, transcripts, board text or provider error bodies. Provider retention follows [OpenAI's data policies](https://developers.openai.com/api/docs/guides/your-data).

Generated speech is retained in a shared server cache and can contain family names or other private tile words. Cache identity includes text, language, model, voice and format. Identical requests reuse clips; regeneration preserves old clip URLs for other devices. Downloaded speech works offline. The cache has no automatic eviction. Review generated words and pronunciation.

## Private server

Illustration downloads and generated pictures use a separate server cache, including their concept descriptions and job metadata. Saved PNGs are also retained on the device for offline use. Personal photos remain local unless you enable account sync; account backups are separate from the AI caches. The cache has no automatic eviction; see [picture privacy and storage](docs/PICTURES.md).

For a source-built Docker deployment:

```powershell
Copy-Item .env.example .env
# Set the backend key and ALLOWED_ORIGINS=https://your-private-hostname
docker compose up -d --build
```

AI services remain available without accounts on a trusted private network. Account backups and their assets require authentication; adding accounts does not make the AI endpoints suitable for an open public service. Docker binds to `127.0.0.1:8787` by default. Route a private HTTPS origin through your reverse proxy and use that URL in Settings; web uses its own origin. Browser microphone access needs HTTPS outside localhost. If binding to another host interface, restrict access to the trusted network.

The container runs as a non-root user with a read-only filesystem. Its named `speech-cache`, `picture-cache`, and `account-data` volumes preserve cached assets and private account backups across replacements. Removing volumes deletes that data. Back up the account database as described in [accounts and sync](docs/ACCOUNTS.md); losing the server volume also loses the account backups.

For a production web preview without Docker, run `npm run build` then `npm start` and open [localhost:8787](http://localhost:8787). Visit online once to cache the web shell before testing offline. Web updates wait for the **Update now** action.

## Development and releases

- [Local development](docs/LOCAL_DEVELOPMENT.md): Expo Go, environment resolution, ports and device connectivity.
- [Testing](docs/testing.md): automated checks, opt-in live AI evaluation and native validation.
- [Releases](docs/releases.md): GitHub server-image publication; local native builds/submissions, OTA updates and server deployment.
- [Interface conventions](docs/DESIGN.md) and [mountain assets](apps/mobile/assets/brand/README.md).

`apps/mobile` contains the UI and platform adapters, `apps/server` the API and web host, and `packages/core` the schemas and shared behavior. `tests/fixtures` contains sample libraries used only by tests and evaluations. Native projects, build output, recordings, local credentials and generated test artifacts are ignored.

`npm run emoji:update` regenerates the offline catalog from pinned Unicode/CLDR data under the [Unicode License V3](packages/core/src/data/UNICODE-LICENSE.txt). `npm run brand:assets` regenerates icon sizes from the saved mountain master. Normal builds use the committed assets and need neither download nor image generation.
