# Testing

Run from the repository root with Node 24 (`npm.cmd`/`npx.cmd` on Windows):

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:web
```

Settings navigation, preference migration and per-language voice-source contracts are described in [SETTINGS.md](SETTINGS.md). Run `npm run test:web -- tests/web/settings.spec.ts` after building for grouped phone/desktop screenshots and focused route, save-failure, offline and speech-source checks.

`check` validates release-version mirrors, TypeScript (including unused locals/parameters), unit/component/service tests, and server/web builds. GitHub runs this check for pull requests. Browser tests use the production web build from `check`, start a temporary API on port 4175, and use isolated device libraries. They run without an API key and mock AI and speech services where appropriate. Existing development processes and user boards are not used.

The suites cover touch gestures, unlock timing, bounded speech, persistence and failed saves, setup, multilingual boards, conversational editing, photo framing, offline playback, and release-contract guards. Browser screenshots, traces, builds and temporary fixtures belong under ignored `artifacts/`, `test-results/` or `playwright-report/`. CI runs the conversation scenarios and uploads their screenshots as the `conversation-screenshots` artifact with seven-day retention.

CI runs `tests/web/safe-area.spec.ts`, which overrides browser safe-area environment values to check account/setup,
dialog close/save, and play control bounds, including changing bottom insets and rotating an open
dialog. This exercises real layout but does not replace Android checks: verify status-bar/cutout and
gesture/three-button navigation clearance in portrait and landscape, open a long settings or tile
dialog, scroll it to the end, rotate it, and enter/leave play with the status bar hidden/restored.

Website tests in `tests/web/landing.spec.ts` cover desktop and phone layouts, keyboard navigation, inactive store placeholders, no library/API initialization on the homepage, direct `/app` access, and older installed-web-app launches. App scenarios start at `/app`. Landing-page captures are under ignored `artifacts/screenshots/landing/`; reviewed PR evidence is retained on the [non-product evidence ref](https://github.com/MChartier/little-say/tree/77dd5092a4e952f08a75da2351a6262e365a117b/docs/review/pr6-zbook). The native entry (`src/Entry.tsx`) exports only the shared app; after entry changes, export iOS and Android with source maps and confirm neither `Entry.web.tsx` nor `src/website/` appears in either native bundle's sources.

## PostgreSQL foundation tests

Unit tests remain independent of external services. `npm run test:integration`
requires PostgreSQL 17 and fails when the test service or explicit test settings
are missing. CI supplies a disposable PostgreSQL service for this suite.

For an isolated local test container on an available loopback port:

```powershell
docker run -d --name little-say-test-postgres -p 127.0.0.1:15432:5432 -e POSTGRES_USER=little_say_test -e POSTGRES_PASSWORD=little_say_test -e POSTGRES_DB=little_say_test postgres:17-bookworm
$env:TEST_PGDATABASE='little_say_test'
$env:TEST_PGUSER='little_say_test'
$env:TEST_PGPASSWORD='little_say_test'
$env:TEST_PGPORT='15432'
npm.cmd run test:integration
```

The fixtures require `TEST_PGDATABASE` ending in `_test` and `TEST_PGPASSWORD`;
they never inherit application `PG*` settings. Optional `TEST_PGHOST`,
`TEST_PGPORT`, `TEST_PGUSER` and `TEST_PGSSLMODE` select the test connection.
Each fixture migrates its own random schema and drops only that schema on close.
Tests cover repeat migrations, migration lock contention/recovery, absent/unsupported histories, committed work,
rollback and connection reuse after an error, and separation of fixtures. No
Firebase project, account data, external AI service or running application is
needed. [The foundation contract](POSTGRES.md) describes migration ordering and
pool ownership. Stop/remove only a test container you created when finished.

## Account validation

`npm run test:services` runs the PostgreSQL integration suites with the loopback
Firebase Auth emulator (`demo-little-say`). It requires the explicit `TEST_PG*`
settings above and the Java runtime required by Firebase tools. It does not use
hosted identities or provider credentials. The accounts migration suite verifies
an upgrade from the existing foundation ledger as well as empty-database initialization.

After building, run `npx firebase emulators:exec --only auth --project demo-little-say
"npm run test:accounts:web"` with those same database settings. This separate
browser suite owns its API process and random database schema, tests verification,
complete media restoration, offline conflict copies, sign-out, and server/account
isolation. Ordinary guest browser tests do not require Firebase. Do not reuse an
unowned server on the configured test ports.

Provider-adapter unit tests and synthetic emulator credentials cannot establish
real Google/Apple consent, native SecureStore behavior on a device, or interrupted
Apple-provider revocation. Those checks require a separately authorized provider
configuration and native build. See [the account contract](ACCOUNTS.md).

## Live AI evaluation

```sh
npm run eval:ai
npm run eval:ai -- --filter profile
npm run eval:ai -- --filter setup
```

This opt-in script makes billable backend model calls using the same key resolution as local development. It checks complete boards, clarification/refinement, language profiles, explicit language overrides and retained card/photo references, and reports correctness and duration. Some cases make multiple conversational turns. It does not run in ordinary tests or CI, and it does not measure real-device speech quality.

## Native and deployment checks

Picture unit and browser tests cover ambiguity, gap-only generation, direct first-send actions without an opt-in screen, library-only requests, legacy settings, emoji fallback, immutable downloads, source attribution, draft retention, migration, explained source selectors, keyboard dismissal/focus, and card inheritance. Workspace scenarios check separate manual creation, conversational suggestions, complete emoji boards without illustration prompts, deliberate picture changes through settings, full-page navigation, reload and Back behavior, independently completed pictures, queued versus active indicators, animation across frames and reduced motion, settings during generation, clarification with a retained canvas, and offline playback of fallback boards. Partial previews cannot mutate saved boards or earlier preview snapshots. `npm run eval:pictures -- --generate` is an opt-in billable six-vehicle evaluation that saves pictures and an HTML contact sheet under `artifacts/picture-evaluation/`; inspect the actual output for the required vehicle structures. Run `npm run eval:pictures -- --animals --generate` to prepare a same-label emoji/library/generated comparison with six real Mulberry assets and up to six generated color pictures. Automated model review is evidence to inspect, not a guarantee of semantic correctness. Native checks also include transparent PNG framing, offline restart and picture-save failures.

Keep screenshots, manifests, build logs and ad-hoc capture code under ignored `artifacts/` during development. Review evidence belongs in PR attachments or expiring CI artifacts, not committed documentation or evidence branches. The Check workflow runs the Settings browser suite and uploads its synthetic-library phone (390 × 844) and desktop (1280 × 900) captures as `settings-browser-<source SHA>`, retained for 14 days. Link the run's artifact from the PR; rerun validation if fresh evidence is needed after expiry. The maintained browser scenarios remain the regression contract.

Before distribution, exercise a signed native build on iPad and Android: tap/swipe/multitouch, unlock, system containment, selected-language pronunciation and offline voices, generated audio and volume/silent-mode behavior, system keyboard dictation into prompt text, absence of app microphone permission requests, native photo cropping, background/restart recovery, and local save failures. Expo Go does not demonstrate standalone launcher/splash, signing, OTA or system-containment behavior.

Validate server connectivity and HTTPS from the actual tablet. Native signing, store submission, OTA application, and server deployment need their configured targets and the checks in [the release guide](releases.md). Browser or unit-test success does not prove installation or rollout. Use `npm audit` for current dependency advisories rather than a checked-in audit snapshot.
