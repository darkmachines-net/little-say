# Settings

The grouped Settings page replaces the former Parent settings dialog. It contains only navigation rows and short summaries, with **Preferences** and **Account & help** groups. All labels, including the dashboard's accessible button name, use **Settings**.

| Route | Responsibility |
| --- | --- |
| `/app/settings` | Grouped overview and current language/account summaries |
| `/app/settings/languages` | One to six device languages and their default; existing board languages stay unchanged |
| `/app/settings/voices` | Preferred languages plus language variants already spoken by boards |
| `/app/settings/voices/:language` | AI/device source, available device voice or automatic matching, and cancellable preview |
| `/app/settings/pictures` | New-board picture defaults and picture credits |
| `/app/settings/account` | Optional account backup, sign-in choices, deletion and browser storage controls |
| `/app/settings/account/login`, `/register`, `/reset` | Account forms under the account route |
| `/app/settings/screen-guidance` | Native platform-specific screen pinning/Guided Access links, or browser guidance |
| `/app/settings/updates` | Installed native app update checks, downloads and restart after pending local writes finish |
| `/app/settings/privacy` | Local storage, backup, AI processing, photo and dictation handling and cache-retention disclosures |

Browser pages support history, direct links, refresh and the existing offline service-worker fallback. Native navigation maintains a page stack and handles Android Back. Direct links with no app-owned history return to their logical parent. An active play session retains its exit protection. The privacy page can be read without signing in or completing setup. Installed native apps also show an App updates row in Account & help. It retains manual update checks and cancels further actions when leaving its page; web keeps the existing service-worker update banner.

## Saving and playback

Preferences save individually through durable library commits. Controls and navigation wait during a write; a failed write keeps the previous preference and offers Retry saving. Settings updates patch only preferences, preserving board content and current playback/account launch state. There is no overview-level save action.

`settings.voiceSources` maps canonical language tags to `ai` or `device`. AI is the default for newly selected languages. `settings.voices` retains the selected device voice identifier for both explicit device speech and AI fallback. AI languages prepare missing clips automatically without consulting legacy `aiConsent`; device languages skip automatic and board-level generation and bypass cached AI during playback. Preview uses the same playback path, stops when leaving its page or backgrounding, and ignores late synthesis completion. AI audio still falls back to matching device speech when unavailable. Available device voices refresh when the app returns to the foreground.

On load, legacy `autoSpeech: false` migrates the current profile, spoken board languages and stored voice-language keys to device speech. Existing device voice IDs and board content are preserved. The legacy flag remains readable but is no longer an exposed setting. Removing a profile language does not remove its board content or saved voice preference.

## Managed service

The native origin comes from build metadata; hosted web uses its own origin. Development launchers may inject a development origin. User-editable server controls, connection testing and onboarding URL entry are removed. Legacy stored `backendUrl` values are cleared on load and ignored by ordinary API resolution even before migration. The field remains in the stored schema only for compatibility.

Account credentials remain pinned to the origin they were issued for. A session for another origin cannot silently sync to the build's service; the user signs out and signs in again. Settings migration preserves local boards, media and account snapshots.

## Verification

`tests/web/settings.spec.ts` covers grouped navigation, narrow/desktop screenshots, default-language persistence, browser history, failed-save retry, explicit device playback over downloaded AI, skipping generation for device languages, AI preview cancellation and fallback, and offline direct links. Core and mobile unit tests cover migration, exact-locale source selection, cached playback fallback, route parsing and Android Back during pending writes. Existing board language and account browser scenarios use the new routes.

Physical device speech-engine availability and OS screen-pinning/Guided Access behavior require device testing; the app only links to the platform instructions.
