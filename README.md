# Little Say

Release workflows and local native/OTA/server commands are documented in [docs/releases.md](docs/releases.md).

A private, local-first toddler soundboard app built with Expo, React Native, TypeScript, and a small Fastify server. Little Say's friendly mountain identity draws on the Pacific Northwest's Little Si, with a winding trail toward an approachable summit.

## Start locally

Requires Node 22.13+ (Node 24 recommended).

Use [the Expo Go development guide](docs/LOCAL_DEVELOPMENT.md) to test on a physical device with a local API. Your `AAC_OPENAI_KEY` environment variable is supported; on Windows the launcher also checks the User variable if the current session has not inherited it.

```powershell
npm.cmd ci
npm.cmd run dev
```

Scan the terminal's Expo Go QR code on a device on the same LAN. The launcher starts the API on port **8788**, detects your LAN address, and injects it into the app automatically. `npm.cmd run dev:web` also opens [the development web app](http://localhost:8081); `npm.cmd run dev:doctor` checks the connection. The key stays on the backend. Without a key, choose **Start without starter boards** during setup; manual editing, photos, device speech, and already-saved boards still work.

The earlier Docker preview may still run on port 8787; it is separate from development and was started without a key. Stop that container with `docker stop little-say-preview` before starting another production server on port 8787.

For the built app and its offline web shell:

```powershell
npm.cmd run build
npm.cmd start
```

Open [the built app](http://localhost:8787). Browser content is tied to its origin: development and production URLs have separate board libraries. Visit the built app online once and let its service worker install before trying an offline reload. Updates wait for a parent to choose **Update now**.

## What is implemented

- First-time language selection and optional AI-generated starter boards, followed by the board library, manual creation, duplication, deletion, and undo of edits.
- A conversation dialog for creating and editing boards, with typed messages, editable voice transcripts, animated waiting feedback, clarification questions, draft previews, and follow-up revisions before saving.
- 1–24 tiles on a fixed screen, six by default for AI creation. Parent editing supports tile reordering, labels, spoken text, language tags, full offline emoji search by English/Russian names or pasted emoji, photos, and photo framing.
- A tile may show “Babushka” while speaking “бабушка” with a Russian voice. Voice preferences are stored per language.
- Each board can offer up to six language choices during Play. Cards either follow that choice or keep their own language. AI translations are reviewed before saving and remain editable in each card.
- Natural AI speech is prepared in the background and downloaded for offline playback. Each tile editor can generate or regenerate audio for its spoken text and language. Missing or failed clips fall back to device TTS.
- Child mode activates the starting tile immediately, or the ending tile when a gesture starts in a gap. Each contact activates once. Crossing intermediate tiles does not play them.
- Speech finishes the current utterance and retains only the latest pending tile. No overlapping audio or long queue.
- Touch feedback and the speaking indicator are independent, so a queued tap never steals the playing card’s outline.
- A two-second stationary hold followed by a separate confirmation exits play. **Release to continue** appears only when that same gesture is ready to release; movement or cancellation resets the label immediately. Keyboard and screen-reader users can activate the parent control to open that same confirmation.
- Play state survives restarts; app navigation and Android Back are blocked during play. System Home/notification/browser controls require Guided Access or Android pinning.
- Native SQLite and app-owned photos; IndexedDB and image blobs on web. Autosave writes are serialized. Failed writes remain visible with retry; unknown/corrupt storage is never silently reset.

After setup, the app opens directly to the board library. **New board** opens creation; each saved board has Play, Edit, and **…** controls. The **…** menu offers **Delete board** with confirmation and **Generate missing audio** when clips are missing, including prepared translations. Generation continues after closing the menu; saved clips are reused and failed clips can be retried. Interface conventions are recorded in [the design guide](docs/DESIGN.md).

The most recently played board appears in a larger card with **Play again**; tapping its preview also starts play. Tap a board's **heart** to mark it as a favorite. Favorites stay immediately below the spotlight, followed by the other boards. Each group is ordered by recent play, with unplayed boards retaining their existing order. A favorite in the spotlight appears only once.

Favorites and play history stay on this device and survive offline reloads. Editing and undo do not change them; copies start without either. Older libraries start recording play history with their next session.

### Create and edit with AI

Choose **New board**, or **Edit with AI** in a board editor. Type a message or choose **Voice prompt**; stop recording to review and edit the transcript before **Send message**. Replies and clarification questions stay in the same dialog. A draft preview appears when a complete board is ready, and further messages refine that draft. **Stop request** restores the message for retry. Waiting feedback shows elapsed time rather than invented progress stages.

Choose **Use this board** or **Apply changes** to save the final draft. Nothing is applied while chatting; closing discards the conversation. Saving waits for local storage, and a failed save keeps the draft available to retry. Edits retain original card references and local photos, and Apply checks that the source revision is still current. One applied conversation is one undo step. Audio preparation starts after saving.

The conversation sends bounded text history and the latest draft with each request, using the existing model and `store: false`. No server-side conversation or account is created. After 20 replies, save the draft and reopen AI editing to continue. First-time starter-board generation continues to use its separate resumable flow.

The board editor fits its preview and actions on one tablet screen in either orientation, including 24-card boards. Tap a tile to edit or move its position; **Add a tile**, **Languages**, missing audio, duplicate, delete, and AI editing remain available without scrolling through full-size cards.

### Family photos

In a tile editor, choose **Choose photo** or **Change photo**. iOS and Android open the system photo picker and native square cropper through Expo. The browser opens an in-app crop editor. The selected photo is saved on this device and is never uploaded to the AI service.

**Adjust crop** lets you drag, pinch, or use a fine zoom slider on an existing photo. The browser also supports arrow keys. The larger tile preview uses the same square framing as the library and play board, so rotating the tablet does not cut off a different part of someone's face. **Use photo** accepts the adjustment; **Save tile** saves the card. Cancelling leaves the previous photo and framing intact.

The saved image remains available for further adjustments, and duplicate cards can frame it independently. On native, this image already includes the system crop; choose the original from the photo library again to recover areas outside that crop. Expo exposes native cropping during selection, so adjusting an already-saved image uses the app's drag/pinch controls. Photos are resized to at most 1600 pixels on the longest edge for local storage.

### First launch

Choose preferred languages and a default, then select **Farm animals**, **Everyday words**, and/or **Family**. **Generate starter boards** creates six editable cards per board, with spoken words and labels for every selected language. Ready boards show their words before **Open my boards** saves them to the library. AI audio starts afterward in the background.

Generation runs at most two requests at once. Each completed draft is saved locally, so **Retry missing boards** and reopening the app reuse completed work. Changing the language profile clears the old drafts for regeneration. Connection settings are available during setup; **Start without starter boards** saves the language preferences and opens an empty library without requiring AI or a connection. Setup does not advance until its writes succeed.

Existing libraries, including empty ones, bypass setup and keep their content. To test first launch without disturbing saved boards, use a separate browser profile or another device.

### Languages during play

In **Parent settings → Languages on this device**, choose up to six preferred languages and one default. **More languages** offers additional choices and custom regional tags such as `es-MX`. Fresh installations start with the runtime's locale; older libraries without a profile retain English as the creation default until configured. Preferences stay on this device and never rewrite existing boards or fixed-language cards.

Manual boards and AI drafts use these preferences; explicit language instructions in a prompt override them. New cards use the default when it belongs to the board's language set, otherwise the board's first language. In a board editor, tap **Languages** beside **Play board**. The quick setup button uses the board's selected languages or your device preferences, such as **French + Spanish**. Review and choose **Use these languages**. Setup is applied only after review, so a failed request leaves the original board unchanged. A numbers board can keep digit labels like **1–9** while switching the spoken words.

For other combinations, use **Choose languages** and select up to six. Use **Make all cards switchable**, then set exceptions such as family names to **Keep this card’s language** in their tile editor. New cards on a configured board follow the board language.

**Prepare translations** creates missing word versions for review. Each tile editor also lets you edit a translated label and spoken text manually. The default switches both labels and speech; the board setting can switch speech only. Changing the original label, spoken text, or language invalidates its translations until updated. A missing translation uses the original words and their original voice language.

The language toggle appears in the Play navbar, immediately left of **Hold to unlock**, when two or more languages are configured. Switching stops the current/pending audio, preserves tile positions, and remembers the selection on this device. Translations and downloaded clips work offline. `POST /api/boards/translate` uses the configured board model and returns results tied to the board revision; outdated results cannot overwrite a newer edit.

## Private Docker deployment

```powershell
Copy-Item .env.example .env
# Set OPENAI_API_KEY and ALLOWED_ORIGINS=https://your-private-hostname
docker compose up -d --build
```

The default host binding is `127.0.0.1:8787`, suitable for a reverse proxy on the same host. If the proxy is on another private host, set `BIND_ADDRESS` to the server’s private interface and restrict access with the home firewall. This is a trusted-private-network service, not an authenticated public endpoint. Do not forward it to the public internet.

Terminate HTTPS at your home server’s reverse proxy using a certificate trusted by the tablets. Route the entire origin to port 8787 and set `ALLOWED_ORIGINS` to that exact HTTPS origin. Browser microphone access requires HTTPS outside localhost. Native release builds should also use HTTPS. In the app’s **Parent settings**, enter the same private URL; web defaults to its own origin.

The server stores no board library. Content and photos belong to each device; there is no export, cloud sync, or in-app backup. Android app backup is disabled; other OS backup behavior follows device settings. The runtime image contains only the server’s production dependencies, runs as a non-root user, and supports a read-only filesystem.

Generated speech is the exception to device-only storage: Compose mounts the named `speech-cache` volume at `/app/data/speech`. It survives container recreation and is writable by the non-root server while the rest of the container stays read-only. Do not use `docker compose down --volumes` if you want to keep this cache.

## AI configuration and privacy

| Variable | Default |
| --- | --- |
| `OPENAI_API_KEY` | Unset; manual features remain available |
| `AAC_OPENAI_KEY` | App-specific key; preferred over `OPENAI_API_KEY` |
| `OPENAI_BOARD_MODEL` | `gpt-6.1-sol` |
| `OPENAI_REASONING_EFFORT` | `low` |
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-transcribe` |
| `OPENAI_SPEECH_MODEL` | `gpt-realtime-2.1-mini` |
| `OPENAI_SPEECH_VOICE` | `marin` |
| `SPEECH_CACHE_DIR` | `../../.cache/speech` relative to server working directory; `/app/data/speech` in Docker |
| `HOST` / `PORT` | `127.0.0.1` / `8787` outside Docker |
| `ALLOWED_ORIGINS` | Local development origins; set explicitly in production |

OpenAI calls occur only in the backend. Never put the API key in `EXPO_PUBLIC_*` or the mobile app. The Responses request uses Structured Outputs, `store: false`, and no automatic retries. Server configuration controls model choice; there is no silent fallback to an older model.

The parent opts in before the first AI request. Generation sends the parent prompt and necessary board text, including opaque tile IDs but no photo paths or photo content. Voice transcription sends a parent recording. Recording is explicit, capped at 60 seconds in the UI, and stops when leaving the app. The server accepts at most 10 MiB per recording, two concurrent AI requests, and 30 requests/minute per endpoint and client IP. Static assets and health checks do not consume the AI quota.

The app does not persist microphone recordings on the server or log prompts, transcripts, generated board text, or provider error bodies. Generated speech is intentionally retained in the shared server cache, so it can include spoken family names or other private tile words. OpenAI has its own [data controls and retention policies](https://developers.openai.com/api/docs/guides/your-data); `store: false` is not a promise of zero provider retention. Only deterministic schema/semantic validation is enforced locally; parents still review generated content and pronunciation.

### Saved speech

Once AI is enabled, saving/applying boards queues missing audio without blocking editing or Play. **Parent settings → Automatic AI audio** can disable automatic preparation. **Generate audio** in a tile editor uses its current, possibly unsaved, “What it says” and language. **Regenerate audio** requests a fresh take; existing audio stays usable if that request fails. **Listen to this tile** uses the same saved-clip/device-fallback path as Play.

**Saved voices → Prepare missing audio** (or **Retry missing audio**) fills gaps across the board’s original words and prepared translations, reusing server clips and keeping downloaded audio. It also works with automatic generation disabled. In a switchable card’s editor, select a translation before generating or regenerating its audio.

The server uses the [current recommended replacement for deprecated TTS models](https://developers.openai.com/api/docs/deprecations), `gpt-realtime-2.1-mini`, over a server-only WebSocket. It asks for the exact words in the chosen language, checks the returned transcript, and stores bounded 24 kHz mono WAV audio. There are two concurrent speech generations and a separate limit of 120 speech requests/minute per client IP; speech does not consume the board/transcription concurrency slots.

`POST /api/speech` accepts `{ text, language, regenerate? }` and returns `{ text, language, id, cacheHit }`. `GET /api/speech/{id}.wav` serves immutable audio. Cache lookups include normalized text, canonical language, model, voice, prompt version, and audio format. Simultaneous identical requests share one generation. Successful regeneration atomically updates the lookup while preserving old clip URLs. Cached clips can still be served without an API key.

Native downloads live in app-owned document storage with a SQLite index; web clips are blobs in IndexedDB. Audio is indexed by text and language independently of the board document, so generation cannot overwrite a newer edit or disturb undo/revision tracking. Local playback needs no server. Changing server voice/model affects future generation; use **Regenerate audio** to replace an already downloaded take. The cache has no automatic age-based eviction in this pilot; regenerated old takes remain available to other devices.

## Native builds

Expo SDK 57 / React Native 0.86 are pinned through `package-lock.json`. Native folders are generated and ignored; change `app.json` or source instead of treating generated projects as canonical.

```powershell
cd apps/mobile
npx.cmd expo prebuild --platform android --no-install
npx.cmd expo run:android
```

For an emulator release variant with the JavaScript bundled:

```powershell
cd apps/mobile/android
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NODE_ENV = "production"
.\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=x86_64 --console=plain
```

The generated local release variant above uses Expo’s development signing key and is for local testing, not store distribution. The `x86_64` APK is emulator-only. For signed device builds, use the `native:build` command with the `internal` or `production` profile described in [the release guide](docs/releases.md). It uses EAS-managed credentials with local Gradle on Android and local EAS builds on macOS for iOS. Builds and submissions never run in GitHub. No EAS project/account is guessed or created automatically.

## Validation

See [VALIDATION.md](VALIDATION.md) for the measured results, dependency audit, and remaining physical-device and live-service checks.

```powershell
npm.cmd run check
npx.cmd playwright install chromium
npm.cmd run test:web
# Optional, billable, requires an actual server-side API key:
npm.cmd run eval:ai
```

Core tests exercise start/end gesture semantics, multitouch, cancellation, bounded playback, engine timeout recovery, parent exit, grid fitting, photo preservation, mixed-language data, stale proposals, and storage validation. API tests inject a controlled provider and cover input validation, origin protection, concurrency, error handling, audio upload, and static serving. Browser tests use a simulated speech engine and mocked AI proposals where indicated; they prove application behavior, not acoustic quality or live model accuracy.

The live evaluation makes nine real model calls for first-time setup, device language defaults, explicit language overrides, explicit items, mixed languages, revision preservation, 24-tile boards, and over-limit clarification, reporting measured duration and correctness. `npm.cmd run eval:ai -- --filter profile` runs the three profile-related cases; `--filter setup` runs two complete bilingual starter-board cases. It does not run as part of normal tests.

Before a physical pilot, check both an iPad and Android tablet: tap/swipe/multitouch, parent hold, system containment, English/Russian pronunciation, installed offline voices, iPad silent mode, microphone permission/recording, photo selection, interrupted saves, and background/restart. Target visual feedback is under 100 ms and typical six-tile generation under 10 seconds; real TTS and model latency must be measured on the actual devices/service.

## Structure and next steps

- `apps/mobile`: parent UI, protected player, platform storage/recording/speech adapters, offline web shell.
- `apps/server`: private API, strict AI provider, static web hosting, metadata-only operational logs.
- `packages/core`: schemas, stable tile identity, proposal application, gestures, playback scheduling, starter content.
- `scripts/evaluate-ai.ts`: opt-in live quality/latency fixtures.
- `scripts/update-emoji-catalog.ts`: `npm.cmd run emoji:update` rebuilds the bundled emoji catalog from pinned Unicode 17.0 and CLDR 48 English/Russian annotations. Normal builds and emoji search require no download. Unicode data is used under the [Unicode License V3](packages/core/src/data/UNICODE-LICENSE.txt); source URLs are recorded in the generated catalog.

Recorded tile sounds, generated illustrations, export/import, sync, community boards, accounts, and sentence construction are deliberately deferred. Playback and tile illustration boundaries allow those additions later.
