# Client services and platform adapters

These services connect the UI to the shared core, backend, device storage, and operating system. `*.web.ts` implementations replace native adapters at bundle time. The [UI module](../ui/README.md) owns interaction conventions; [server modules](../../../server/README.md) own HTTP security, caches, and retention.

## Installed app information

`appInfo` reads the active bundle's `extra.releaseVersion` (falling back to Expo config version), plus the installed binary's version and platform build number from `expo-application`. It never substitutes the config's build counters, which can differ from EAS-managed binary counters. Enabled release updates also expose the active channel, runtime, source, and update ID from `expo-updates`. Expo Go is labeled explicitly and hides its host binary metadata; development builds are labeled and omit release-update details. Missing versions show **Unavailable**. The web adapter reports only the loaded bundle version and environment, including when cached offline; neither adapter queries a server.

## Accounts and sync

`useAccount` coordinates explicit account actions with `firebaseAccount`, `firebaseProviders`, platform session storage, and `accountSync`. On the first launch without a saved sign-in, account choices offer login, registration, or guest use. Continuing as guest persists only a launch preference and makes no account request. Existing boards and resumed play are preserved. Signing out keeps downloaded data and returns to account choices.

AI use automatically establishes a Firebase anonymous session without registration. Guest ownership persists across reloads through the browser cookie or native SecureStore; it never creates saved account consent or enables backup. Signing in changes the owner for new work; already downloaded boards and media remain on device. Clearing storage, an expired browser cookie, or switching identity cannot recover unfinished guest work. Backup requires explicit sign-in, verified email and a separate per-device choice. Pausing backup stops future synchronization without removing existing server copies. Native refresh credentials use chunked, atomically committed SecureStore records. Browser Firebase credentials exist only in memory during authentication; after the server issues a cookie, the client signs out of Firebase JS. Expo Go supports guest/email flows; Google and Apple require a development or release binary. Server identity, uploaded data, linking, and deletion guarantees live in the [account module](../../../server/src/accounts/README.md).

With backup consent enabled, sync runs after library changes when the parent returns to the dashboard, every 30 seconds while it is active, on foreground/reconnection, or through **Sync now**. It waits during play/editing and never interrupts a child session to sign in. Downloads are verified before acknowledging a snapshot; the complete-backup status requires that acknowledgment. Offline/failed changes remain local.

Core merges compare the last acknowledged snapshot, propagate deletions, preserve edits racing deletion, and retain concurrent edits as stable **(conflict copy)** boards. `accountSync` restores assets before exposing their references, and retains retryable local work on failure.

`backendConfig` resolves the compiled native origin, same-origin production web, or a launcher-supplied development origin. Legacy saved `backendUrl` values are cleared on load and ignored even before migration. Credentials remain pinned to the issuing origin; an old session cannot silently sync to another service. The origin change requires explicit sign-in and renewed backup consent; local boards remain untouched. `requestAuth` lazily attaches origin-bound guest or account credentials to AI and media requests; `apiFetch` polls durable `202` job responses and forwards cancellation.

## Speech

Android clips use the [local tile-audio module](../../modules/tile-audio/README.md); that module owns native playback behavior, build requirements, and device validation.

`hybridSpeech` selects downloaded AI clips or device TTS. `speechLibrary` prepares missing clips without blocking editing; `useSpeechLibrary` owns lifecycle and progress, resolving effective profile languages and board play subsets before planning clips. Playback finishes the current utterance and retains only the latest queued selection. Clip identity must match the current text, language, model, voice, and format; never play an old clip for changed words. Downloaded media works offline; AI failure falls back to a matching device voice. Parents should review pronunciation.

`settings.voiceSources` selects `ai` or `device` for each canonical language tag; AI is the default. `settings.voices` retains device voice IDs for explicit device speech and AI fallback. Device-selected languages bypass cached AI and skip automatic/board-level generation. AI speech preparation does not consult legacy `aiConsent`.

On load, legacy `autoSpeech: false` maps profile languages, spoken board languages, and saved voice-language keys to device speech. Preserve voice IDs and boards; removing a profile language does not remove board content or saved voice preferences. Preview uses the same playback path, stops on page exit/backgrounding, and ignores late synthesis completion. Refresh device voices on foreground.

## Picture drafts

`pictures.ts` prepares detached previews, protects saved boards from partial work, and reports per-card progress. Shared source selection in core checks meaning and neighboring ambiguity; one missing picture never promotes an entire board to generated illustrations, including older `consistent: true` boards. Different labels for the same meaning may share a picture.

Board defaults apply unless a card overrides them. Unrelated text edits preserve pictures; photos and protected choices are excluded from board-wide replacement unless the parent explicitly targets them. After a saved tile edit, optional improvements are staged against that saved revision. Closing/stopping keeps the saved words and original picture; applying checks the revision again.

Explicit AI use permits the picture preparation flow; the legacy `autoImages` flag no longer gates Automatic. Server capabilities still limit availability. Missing analysis/matches, failed downloads, unavailable generation, and rejected pictures retain the best analyzed/original emoji or existing asset-backed picture. No automatic paid retries occur. The board remains usable and saveable.

PNG downloads are digest-verified before references are saveable. `data/storage.ts` keeps native PNGs separate from cropped JPEG photos; `storage.web.ts` uses IndexedDB v3. Library v2 migrates v1 without changing board appearance. Initial-load pruning retains board/starter-draft assets; active drafts and undo are not pruned mid-session. Deleting browser storage or uninstalling without a complete backup loses local data.

The [server picture module](../../../server/src/pictures/README.md) owns protocol compatibility, catalog licenses, queue behavior, and retention. UI source controls are documented only in the [UI module](../ui/README.md#picture-controls).
