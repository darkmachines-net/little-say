# Pilot validation

Checked locally on October 3, 2026. This is a private pilot, with no accounts or shared board storage.

## Release tooling checks (October 3)

- `npm run check` passes: version mirrors, TypeScript, 134 tests (including 18 release regressions), server compilation and Expo web export.
- GitHub workflows pass actionlint 1.7.7, including shellcheck. Build and submit profiles pass the pinned EAS CLI 22.4.0 schema validation.
- Android and iOS native fingerprint generation succeeds. Unconfigured Expo output disables OTA and retains a blank default server address, so Expo Go remains usable before release onboarding.
- The server image builds locally. A temporary read-only container served both `/api/health` (version `0.1.0`, no AI key) and the web app; it was removed afterward. Deployment tests cover successful verification and restoring the previous image after a failed public health check.
- GitHub publication, remote deployment, EAS credential retrieval for this app, signed native builds/submissions and device OTA delivery have not run. The repository still needs its initial commit/remote, Expo owner/project/server URL, signing/store setup and self-host Docker context. No existing server or device installation was replaced.

The earlier feature checks below remain separate evidence; browser/device tests were not rerun for this release tooling change.

## Completed checks

| Check | Evidence |
| --- | --- |
| TypeScript | All three workspaces pass `npm run typecheck`. |
| Core, backend, speech, and development tools | 116 tests pass, including native unlock feedback at the hold boundary, cancellation and stale timers, shared photo geometry, pan/pinch transitions, native picker configuration and cancellation, bounded conversation requests, original tile references, retained-photo validation, first-time setup compatibility, complete starter translations, durable draft resume, language preferences, speech caching, and audio/TTS playback. |
| Browser | 41 Playwright scenarios pass, including unlock timing and cancellation feedback, favorites and recent-play ordering, spotlight layouts, photo drag/pinch/fine zoom, crop consistency across views and orientation, cancelled replacements, independent duplicate-card framing, multi-turn clarification/refinement, voice transcript review, failed final saves, compact tablet editing, and the existing setup, bilingual playback, offline storage, board menus, and speech regressions. |
| Android build | Local release variant builds for the x86_64 emulator. This uses the generated development signing key; it is not a signed distribution build. |
| Android runtime | App installed and launched on `emulator-5580`. Verified a six-tile tablet layout, Android Back staying in play, hold then separate parent confirmation, and child-session restoration after force-stop/relaunch. |
| Android recording | System microphone permission appears. Android app-ops reports recording active, then stopped after backgrounding. The 60-second cap also stopped recording (measured duration about 60.3 seconds). No microphone permission is requested at startup. |
| Native configuration | Merged release manifest contains `RECORD_AUDIO` and disables Android backup. |
| iOS bundle | Expo successfully exports the iOS Hermes bundle. Native Xcode compilation and an iOS device run remain unverified. |
| Docker | Image builds and starts as a non-root user with a read-only filesystem and no added capabilities. Web root and service worker return 200, health returns `aiConfigured: false`, and generation returns the expected explanatory 503 without a key. |

The regular browser suite simulates speech so tests can assert exact language, utterance order, and queue behavior, and its AI preview tests use controlled server responses. Additional live-service checks are recorded below. The emulator was launched without host audio, so its TTS engine connection is verified but pronunciation is not.

Screenshots are generated under the ignored `artifacts/screenshots/` directory. Browser screenshots cover the library, tablet play, and 24-tile play; Android has a six-tile tablet screenshot. The emulator's temporary display overrides were restored afterward.

## Local development and live API checks

- `npm run dev` detects the physical Ethernet LAN address and starts the API on 8788 plus Expo Go/Metro on 8081. `dev:doctor` confirms localhost and LAN API access and Metro readiness. Ctrl+C was verified to close both ports; restarting works.
- The Windows User variable `AAC_OPENAI_KEY` was detected even though the parent process did not inherit it. Its value was not written to `.env`, logs, or documentation.
- Expo's native manifest advertises SDK 57 and the selected LAN host. The actual native development bundle contains the injected API URL. The real key was checked for absence in the native manifest/bundle and web scripts.
- A live local HTTP generation request returned six requested farm animals in approximately **5.3 seconds**. The development web UI also tested its injected connection and generated/applied a mixed-language family board through the real backend.
- All **five live model fixtures passed** with `gpt-6.1-sol`, low reasoning: explicit items, English/Russian family tiles, preserving unrelated tiles during revision, 24 tiles, and clarification for more than 24. Observed durations were 2.2–9.2 seconds; median 4.0 seconds. This small sample is not a latency guarantee.
- Local `/api/transcribe` returned the correct transcript from a Windows-generated WAV test phrase in approximately **1.1 seconds**, using `gpt-transcribe`. This verifies the upload/provider path; it is not a physical microphone test.
- The optional Windows firewall helper was run with `-WhatIf` only. No firewall rule or network profile was changed.

The user's iPad has connected to Expo Go and loaded the app from Metro. See [the development guide](docs/LOCAL_DEVELOPMENT.md).

## iPad voice-input correction

- The reported `Unsupported FormDataPart implementation` error was reproduced with the installed Expo multipart encoder: it rejects the previous React Native `{ uri, name, type }` upload object. Native voice prompts now append an `expo-file-system` `File`, whose bytes Expo can upload.
- Metro captured repeated native shared-object errors. Recording teardown was reading `recorder.uri` after Expo's own hook released the recorder. Teardown now uses a saved path and leaves unmount stop/release to Expo; pending permission, preparation, and stop operations check the component lifecycle before accessing the recorder.
- Ten new regression tests exercise the installed Expo FormData patch and encoder, the old failing payload, unmount before/after recording, pending async operations, background/resume, and start failure. TypeScript and all 50 tests pass, and the updated iOS Hermes bundle exports successfully.
- A synthetic WAV encoded by Expo's actual multipart converter returned HTTP 200 and the correct transcript through the local API in approximately **1.7 seconds**. This verifies the encoder/server/provider path, not physical microphone capture.
- Reload was sent to the connected Expo app and Metro successfully rebuilt the iOS development bundle. The user subsequently confirmed voice input was working.

## Saved synthetic speech

- The local backend successfully generated `Cow` in `en-US` and `бабушка` in `ru-RU` using `gpt-realtime-2.1-mini` with Marin. Generated transcripts matched the requested words before the audio was accepted. A later `Cow` request, after backend restarts, returned the same audio ID with `cacheHit: true`.
- After the final development-service restart, live regeneration of `Cow` returned a different audio ID; the next normal request returned that new ID from cache. The API and Expo Go server remain running on ports 8788 and 8081. No device was connected when the reload command was sent, so the iPad must reopen/reload the project.
- Server regressions cover cache separation by text/language/model/voice/prompt version, concurrent deduplication, persistent reuse without a key, successful and failed regeneration, preserving old URLs, malformed audio, bounded concurrency, and sanitized API errors.
- Client regressions cover two-worker background preparation, duplicate words, retaining existing audio on failure, no stale attachment after editing text/language, explicit retries, cancelling queued automatic work, and fallback/cancellation within the existing bounded playback queue.
- Chromium exercised the card controls, correct Russian request payload, real HTML audio playback from an IndexedDB Blob after an offline reload, and device TTS when audio playback was deliberately rejected. This test uses a generated tone fixture to isolate application behavior; it is not an assessment of the AI voice's acoustic quality.
- Both iOS and Android Hermes bundles compile with the new local audio storage/player. Physical iPad/Android generated-clip playback, pronunciation, and silent-mode behavior still need device confirmation.
- The updated Docker image builds with zero production dependency advisories. A disposable named cache volume was writable as UID 1000 with a read-only root filesystem and retained its data across replacement containers; the test volume was removed afterward. The existing preview/deployment was not replaced.

## Play controls, board languages, and app design

- The library now opens directly to saved boards. Creation lives in a New board sheet. Shared colors, typography, controls, and plain functional copy replace the landing-page layout. Tablet portrait/landscape screenshots were visually checked.
- Play uses a larger board title with no status subtitle and a Hold to unlock control. Current speech and recent touches have independent indicators; repeated rapid taps keep the speaking outline stable with no label movement.
- Core tests cover legacy fixed-card behavior, translated label/speech selection, speech-only switching, stale translations, removed language preferences, exact response validation, and audio deduplication across variants. Server tests validate translation requests/results and sanitize failures.
- Chromium configured English/Russian through the board editor, kept Sheep fixed, reviewed translations, edited and generated a Russian variant, switched during queued English speech, and replayed the saved Russian clip after an offline reload. A separate check retried only the failed clip with automatic preparation disabled.
- Updated iOS and Android Hermes bundles export successfully. The new language controls and visual design still need physical-device usability confirmation.
- A live request through the local backend translated Elephant and Zebra into Russian in about 6 seconds using the configured GPT-6 board model. No model key was copied into client code or output.
- Live board creation also returned two English/Russian switchable animal cards with translations and a fixed Russian Babushka card in about 10 seconds.
- Language setup is now in a visible **Languages** toolbar button beside Play. **English + Russian** stages all cards and their translations together for review, then applies them as one undoable board change. Failure/cancellation before applying preserves the original board.
- The numbers regression starts with nine fixed cards, retries a failed translation request, verifies no partial setup before review, requests nine clips per language, and switches the spoken word/language while retaining digit labels. Live translation returned labels 1–9 with Russian speech один–девять. The local backend also successfully synthesized English `1` and Russian `один` as separate clips.

## Conversational creation and editing

- Chromium checks cover clarification → draft → refinement → explicit save, preserving the original board and local photo references across turns, undo, cancellation followed by retry without duplicate history, failed follow-ups, and retrying a failed durable save without creating duplicate boards. Voice transcription is mocked to verify editable review before sending, follow-up context, and microphone cleanup on close.
- The editor's preview and main actions fit at 820×1180, 1180×820, and 1024×768, including every tile in a 24-card board. Tile reordering works in its dialog. Conversation controls also fit at 390×700 with reduced motion. Screenshots are in `artifacts/screenshots/ai-conversation-*.png` and `editor-*.png`.
- Live checks with `gpt-6.1-sol` passed a three-turn French/Spanish conversation (over-limit clarification, choosing three animals, then replacing one while preserving translations) and a two-turn existing-board edit (new goat, followed by title/color changes while retaining original photo references). Successful turns took roughly 3.5–7.1 seconds. These use fixture words and the configured backend key.
- A live photo edit exposed empty unused emoji values on retained photo cards. Validation now checks the retained illustration correctly and still requires an emoji for new/replacement cards; the live two-turn retry and a regression test pass.
- TypeScript, server/web builds, and final iOS/Android Hermes exports pass. The local API reports ready with AI configured, Expo serves the app on 8081, and a reload was sent. Physical iPad keyboard/voice behavior in this new modal still needs device confirmation.

## Photo selection and framing

- iOS/Android selection requests Expo's native square cropper and stores its returned image. Service tests mock the picker and verify the platform options, cancellation without writes, selected URI, resize bounds, and resource release on failure. These do not exercise the operating system's picker UI.
- Chromium verifies continuous dragging, 1% zoom adjustment, a two-finger pinch followed by one-finger panning, and keyboard positioning. It compares the actual source region across crop preview, tile editor, board editor, library thumbnail, portrait/landscape play, and an offline reload. Cancelling an adjustment or replacement preserves the original card; duplicated cards share the local asset while retaining independent crops.
- The crop editor, larger tile preview, and play layouts at 820×1180 and 1180×820 were visually inspected. Screenshots are `photo-crop.png`, `photo-tile-preview.png`, and `photo-play-*.png` in `artifacts/screenshots/`. The fixture is an asymmetric synthetic face illustration, not a family photo.
- TypeScript, the server/web build, and updated iOS/Android Hermes exports pass. Native cropping and the slider use modules available in Expo Go. Actual iPad/Android photo permissions, cloud-photo download, native cropping, and subsequent drag/pinch adjustment still need a physical-device check.

## Recent boards

- Play-session timestamps are stored locally outside board content. Browser checks cover most-recent-first ordering, offline reload, active-session restoration, independence from editing/undo/copying, deleting the current spotlight, and starting play directly from its preview. Returning from a saved session without prior history creates the first timestamp.
- The spotlight and all its controls fit at 1180×820, 820×1180, and 390×844. Screenshots are `recent-board-*.png` under `artifacts/screenshots/`. It uses the board's actual tiles and a Play again button; boards with no recorded play history retain their existing order below played boards.
- The 35 existing browser regressions pass, and both new scenarios pass after correcting a test to wait for the save indicator before reloading. TypeScript, 109 unit/service tests, server/web builds, and iOS/Android Hermes exports pass. Physical iPad interaction with the updated dashboard remains unverified.

## Favorites

- A heart control marks boards as favorites, stored as library metadata outside board content. The latest played board remains in the spotlight, favorites follow it, and other boards follow those. Recent play order is preserved within each group, and a favorite spotlight board appears only once.
- Browser checks cover adding/removing favorites, moving a favorite out of the spotlight after another board plays, offline reload, favorites before any play history, failed saves and retry, editing/undo, copies starting unfavorited, and removing deleted IDs. The heart exposes native selected state and browser pressed state; the browser check caught the missing web state and passes after the correction.
- All four favorites/recent-board scenarios pass alongside the 35 existing scenarios. TypeScript, 109 unit/service tests, and server/web builds pass; iOS/Android Hermes bundles export. Screenshots with filled/unfilled hearts were reviewed at tablet and phone sizes. Physical-device interaction remains unverified.

## Unlock feedback correction

- Previously the two-second label timer could announce readiness after movement had already cancelled the gesture. Native and web controls now share one hold state and monotonic clock. An early callback reschedules until the threshold; readiness is latched for release, while movement, additional contacts, and cancellation reset both the gesture and feedback together. Stale timers cannot mark a newer hold ready.
- Mounted native-component tests cover release immediately at the ready label, early callbacks, wall-clock changes, movement, early release/repress, a second finger, native/external cancellation, and unmount cleanup. These mock the native view layer and do not replace a physical iPad test.
- Browser checks cover repeated immediate release at exactly two seconds, cancellation before/after readiness, real touch-event multitouch, and normal session restoration. The touch test explicitly waits for the initial holding label before advancing its mocked clock. The full suite's other scenarios passed, and the four final unlock/session scenarios pass after this test timing correction.
- TypeScript, 116 unit/component/service tests, server/web builds, and final iOS/Android Hermes exports pass. The connected development app was reloaded; physical iPad confirmation of the fix remains pending.

## Required before handing it to a family

- Configure the API key on the deployment host and repeat the connection and live-service checks there. Local model access and text/transcription paths are now verified; device microphone quality and pronunciation still need a real tablet.
- Install a native build on an iPad and Android tablet. Check actual tap/swipe/multitouch behavior, screen readers, audio latency, volume and silent-mode behavior, English/Russian offline voices, photo selection, microphone recording, and background/restart recovery.
- Configure a trusted private HTTPS origin on the home server. Check it from the tablets, including microphone permissions on the web app. Home-server deployment and private TLS were not performed locally.
- Enable Guided Access or Android screen pinning when system-level confinement is needed. An ordinary app or browser cannot suppress every operating-system gesture.

## Dependency audit

The Docker server-only production dependency installation reports **zero npm vulnerabilities**. The full Expo/build/test workspace audit reports 24 affected packages, including transitive parent packages: 16 high, 7 moderate, and 1 low. These trace to `braces`, `node-forge`, `uuid` through Xcode tooling, and a nested development-only `esbuild`.

The registry's offered automatic remediation includes downgrading Expo to SDK 44, which is incompatible with this implementation. That downgrade was not applied. Patched root overrides do not eliminate every nested package with the current lockfile. Revisit upstream fixes before distribution; do not expose development servers publicly. See `npm audit` for the current advisory details, since the status can change.

## Device language profiles

Device language profiles were checked with French/Spanish settings and a Mexican Spanish default. Preferences survive offline reload, new cards inherit the default, AI requests carry the profile, and subsequent preference changes preserve existing board language toggles and fixed Russian family cards. The iOS and Android Hermes bundles export successfully; physical tablet interaction with these settings remains unverified.

Three live profile fixtures passed using `gpt-6.1-sol` with low reasoning: French base words plus Spanish translations (4.6 s), an explicit German-only override (3.5 s), and an edit preserving an existing English board under a French/Spanish profile (5.6 s). The existing-board check led to making empty play-language configuration explicit in the request and instructions.

## First-time setup

First-time setup also passed live generation checks with `gpt-6.1-sol`, low reasoning, and French/Spanish preferences: a complete six-card farm board in 8.3 s and a six-card family board in 7.3 s. Both passed the setup validator requiring every selected language on every card. Native iOS/Android Hermes exports passed; first-time setup on physical tablets remains unverified. Browser screenshots are `first-time-languages.png` and `first-time-boards-ready.png` under `artifacts/screenshots/`.

## Little Say mountain branding

- The shared mountain mark, wordmark, forest-green controls and warm background were reviewed at 1180×820 and 390×844. Setup, the board-creation dialog, loading/empty-library states, install assets and the existing play layout use the shared identity. Play retains its board-focused layout. Screenshots are under `artifacts/screenshots/brand/`.
- `npm run check` passes, including TypeScript, all 134 unit/component/service tests, and server/web builds. All seven setup and recent-board browser scenarios pass. A separate browser check verified no page errors or phone overflow, successful install-icon responses, and the mountain loading after an offline reload; its readback is `artifacts/screenshots/brand/verification.json`.
- Expo config introspection accepts the iOS/Android icon and splash configuration. Generated Android foreground artwork fits within the adaptive icon safe circle; opaque app/PWA icons and transparent UI artwork were checked. Native launcher and splash appearance still require a new native build and device inspection; Expo Go retains its own launcher identity. No native build or OTA publication was performed for this change.
- PR preparation rechecked release mirrors, TypeScript and all 134 unit/component/service tests. The sandbox prevented esbuild from reading a parent directory; the production build passed when rerun on the host. All 41 Chromium browser scenarios passed. Five refreshed review captures and their scope are saved in `docs/screenshots/little-say-branding/`; no physical-device validation is implied.

## Reproduce

```powershell
npm.cmd ci
npm.cmd run check
npx.cmd playwright install chromium
npm.cmd run test:web
docker build -t little-say:pilot .
```

Native build and private-server configuration instructions are in [README.md](README.md).
