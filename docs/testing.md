# Testing

See [Firebase/Postgres validation](FIREBASE_POSTGRES_VALIDATION.md) for the completed local, Compose, browser, and Expo Go checks and the remaining real-provider/Cloud SQL validation.

Run from the repository root with Node 24 (`npm.cmd`/`npx.cmd` on Windows):

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:services
npx firebase emulators:exec --only auth --project demo-little-say "npm run test:web"
```

`check` validates release-version mirrors, TypeScript (including unused locals/parameters), unit/component/service tests, and server/web builds. GitHub runs this check plus required Postgres/Auth-emulator integration and browser tests for pull requests. Browser tests use the production web build from `check`, start a temporary API on port 4175, and use isolated device libraries. They run without an API key and mock AI, speech and microphone services where appropriate. Existing development processes and user boards are not used.

The suites cover touch gestures, unlock timing, bounded speech, persistence and failed saves, setup, multilingual boards, conversational editing, photo framing, offline playback, and release-contract guards. Browser screenshots, traces, builds and temporary fixtures belong under ignored `artifacts/`, `test-results/` or `playwright-report/`. Selected [PR review screenshots](screenshots/little-say-branding/README.md) are retained separately.

Website tests in `tests/web/landing.spec.ts` cover desktop and phone layouts, keyboard navigation, inactive store placeholders, no library/API initialization on the homepage, direct `/app` access, and older installed-web-app launches. App scenarios start at `/app`. Landing-page captures are under `artifacts/screenshots/landing/`. The native entry (`src/Entry.tsx`) exports only the shared app; after entry changes, export iOS and Android with source maps and confirm neither `Entry.web.tsx` nor `src/website/` appears in either native bundle's sources.

Account integration tests use real Postgres and the Firebase Auth emulator for owner isolation, cookie revocation/CSRF, complete-backup validation, concurrent revisions/quotas, verification/reset/deletion and persistence. `tests/web/accounts.spec.ts` uses two isolated browser devices and the real API to restore photos, illustrations and downloaded speech byte-for-byte, merge offline edits, preserve boards after sign-out, and verify account-free setup makes no account request. Each test creates its own generated schema inside an explicitly named test database; it never uses development account data. Review captures are under `artifacts/screenshots/accounts/`. Native SecureStore, reinstall recovery, and restored playback still need validation in new signed Android/iOS builds before distribution.


## Required local test services

Unit tests remain service-independent. Integration and browser tests fail if their required services are missing; they never silently skip. Set TEST_PGDATABASE to a database whose name ends in _test, TEST_PGUSER and TEST_PGPASSWORD. Optional TEST_PGHOST/TEST_PGPORT select its host/port. These never inherit application PG settings. PostgreSQL 17 is required for CI parity.

For example, create an isolated local container on an available loopback port:

```powershell
docker run -d --name little-say-test-postgres -p 127.0.0.1:15432:5432 -e POSTGRES_USER=little_say_test -e POSTGRES_PASSWORD=little_say_test -e POSTGRES_DB=little_say_test postgres:17-bookworm
$env:TEST_PGDATABASE='little_say_test'
$env:TEST_PGUSER='little_say_test'
$env:TEST_PGPASSWORD='little_say_test'
$env:TEST_PGPORT='15432'
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099'
npm.cmd run test:services
npx.cmd firebase emulators:exec --only auth --project demo-little-say "npm run test:web"
```

Do not run emulators:exec while another Auth emulator owns 9099; use npm run test:integration / test:web directly with an already-running local emulator. Fixtures drop only their own random schema. No real Firebase project, Google/Apple identity or OpenAI request is used.

SecureStore adapter tests cover large records, concurrent writes, interruption before commit, and sign-out. Google/Apple production sign-in, linking and revocation require actual provider configuration and Android/iOS device tests. Native bundle export checks module resolution, not provider credentials or device behavior. Cloud SQL connectivity likewise needs a provisioned instance and its runtime identity; local Postgres is not evidence of a successful cloud connection.

## Live AI evaluation

ChatGPT connection tests use mocked OpenAI endpoints and real test JWT signatures to check identity validation, one-use callbacks, encrypted storage, isolated visitor billing, renewal, and refusal to spend the server API key. `tests/web/chatgpt.spec.ts` checks browser settings and composer behavior without external sign-in. A real hosted OAuth round trip and ChatGPT-funded inference remain separate rollout checks requiring an approved client; see [ChatGPT configuration](CHATGPT.md).

```sh
npm run eval:ai
npm run eval:ai -- --filter profile
npm run eval:ai -- --filter setup
```

This opt-in script makes billable backend model calls using the same key resolution as local development. It checks complete boards, clarification/refinement, language profiles, explicit language overrides and retained card/photo references, and reports correctness and duration. Some cases make multiple conversational turns. It does not run in ordinary tests or CI, and it does not measure real-device speech quality.

## Native and deployment checks

Picture unit and browser tests cover ambiguity, gap-only generation, direct first-send and voice actions without an opt-in screen, library-only requests, legacy settings, emoji fallback, immutable downloads, source attribution, draft retention, migration, explained source selectors, keyboard dismissal/focus, and card inheritance. Workspace scenarios check separate manual creation, conversational suggestions, complete emoji boards without illustration prompts, deliberate picture changes through settings, full-page navigation, reload and Back behavior, independently completed pictures, queued versus active indicators, animation across frames and reduced motion, settings during generation, clarification with a retained canvas, and offline playback of fallback boards. Partial previews cannot mutate saved boards or earlier preview snapshots. `npm run eval:pictures -- --generate` is an opt-in billable six-vehicle evaluation that saves pictures and an HTML contact sheet under `artifacts/picture-evaluation/`; inspect the actual output for the required vehicle structures. Run `npm run eval:pictures -- --animals --generate` to prepare a same-label emoji/library/generated comparison with six real Mulberry assets and up to six generated color pictures. Automated model review is evidence to inspect, not a guarantee of semantic correctness. Native checks also include transparent PNG framing, offline restart and picture-save failures.

After both evaluations and a web build, `npx tsx scripts/capture-picture-evidence.ts` captures the construction board, all three animal visualizations, collapsed and expanded source selectors, and editing controls in isolated tablet/phone browser sessions without further AI calls. The [picture evidence index](screenshots/card-pictures/README.md) distinguishes live generated assets, real library artwork, emoji comparisons, automated checks, and physical-device follow-ups. Compare the previous PR commit's control captures with the new selectors; do not present a content comparison as an older application build.

`npx tsx scripts/capture-workspace-evidence.ts` uses the retained construction PNGs to capture desktop, tablet, and phone workspaces during partial completion, after completion, during clarification, and after fallback. Job timing and responses are controlled fixtures; these screenshots demonstrate presentation, not live latency or matching accuracy. Set `WEB_ROOT` to an isolated production-build copy when other development tasks are rebuilding the shared output. See the [workspace evidence index](screenshots/board-workspace/README.md).

Before distribution, exercise a signed native build on iPad and Android: tap/swipe/multitouch, unlock, system containment, selected-language pronunciation and offline voices, generated audio and volume/silent-mode behavior, microphone permissions, native photo cropping, background/restart recovery, and local save failures. Expo Go does not demonstrate standalone launcher/splash, signing, OTA or system-containment behavior.

Validate server connectivity and HTTPS from the actual tablet. Native signing, store submission, OTA application, and server deployment need their configured targets and the checks in [the release guide](releases.md). Browser or unit-test success does not prove installation or rollout. Use `npm audit` for current dependency advisories rather than a checked-in audit snapshot.
