# Validation

Unit tests live beside the core/client/scripts or in `apps/server/test`; `tests/web` owns browser scenarios and `tests/fixtures` contains synthetic libraries. Run from the repository root with Node 24 (`npm.cmd` / `npx.cmd` on Windows):

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:web
```

`check` runs [lint with zero warnings](../scripts/README.md#linting), [release-contract checks](../scripts/release/README.md#recovery-and-validation), TypeScript (including unused code), unit/component/service tests, and server/web builds. The `Check` workflow runs this command and a separate `Lint` job for pull requests and pushes to `master`/`main`. Keep `Lint` required for `master`, require branches to be up to date, and enforce checks for administrators in GitHub's repository settings; protection is configured separately from the workflow. Existing PR branches must include the job to satisfy that required check.

Browser tests use the production build, own an API on port 4175, and isolate device libraries. Ordinary guest tests disable API keys and mock AI/speech; they never use development processes or user boards. Service-worker/offline behavior must be tested against the built app, not Metro.

## Browser scenarios and evidence

`settings.spec.ts` covers routes, preference migration, save retry, AI/device source selection, canceled preview, and offline links. `safe-area.spec.ts` overrides browser insets to check controls after resizing/rotation. Conversation/picture scenarios cover revision-safe partial previews, direct first-send behavior, protected pictures, gap-only generation, source controls/focus, reduced motion, cancellation, downloads, attribution, migration, and offline fallback. Photo, grid, speech, translation, setup, and account scenarios cover their corresponding flows; file headers describe their responsibility.

`landing.spec.ts` checks desktop/phone layouts, keyboard navigation, inactive store placeholders, direct `/app` access, older installed-web-app launches, and absence of library/API initialization on `/`. After changing the entry split, export iOS and Android with source maps and confirm `Entry.web.tsx` and `src/website/` are absent from native sources.

Keep screenshots, traces, manifests, build logs, and ad-hoc capture code under ignored `artifacts/`, `test-results/`, or `playwright-report/`. Attach review images directly to the PR with matching before/after viewports and fixtures and identify captured source revisions. Do not commit evidence to documentation or evidence branches. Where supported, `gh pr edit <number> --body-file <markdown> --attach <image>` uploads local images referenced by the comparison table; repeat `--attach` per image. CI retains Settings captures for 14 days and conversation captures for seven; maintained scenarios are the regression contract.

For focused runs after building:

```sh
npm run test:web -- tests/web/settings.spec.ts
npm run test:web -- tests/web/safe-area.spec.ts
npm run test:web -- tests/web/app.spec.ts --grep "outside modal dismissal"
```

## Service tests

`npm run test:integration` requires disposable PostgreSQL 17; account/Firebase cases also need the loopback Auth emulator. `npm run test:services` starts that emulator for the whole integration suite, using `demo-little-say` and the Java runtime required by Firebase tools. No hosted identities or provider credentials are needed. CI supplies PostgreSQL; unit tests remain independent of external services.

Example local PostgreSQL on an available loopback port:

```powershell
docker run -d --name little-say-test-postgres -p 127.0.0.1:15432:5432 -e POSTGRES_USER=little_say_test -e POSTGRES_PASSWORD=little_say_test -e POSTGRES_DB=little_say_test postgres:17-bookworm
$env:TEST_PGDATABASE='little_say_test'
$env:TEST_PGUSER='little_say_test'
$env:TEST_PGPASSWORD='little_say_test'
$env:TEST_PGPORT='15432'
npm.cmd run test:services
```

Fixtures require `TEST_PGDATABASE` ending in `_test` and `TEST_PGPASSWORD`; they never inherit application `PG*`. Optional `TEST_PGHOST`, `TEST_PGPORT`, `TEST_PGUSER`, and `TEST_PGSSLMODE` choose the test connection. Every fixture migrates its own random schema and drops only that schema on close. Stop/remove only a container you created.

Coverage includes repeat migrations, lock contention/recovery, incompatible histories, transactions/rollback/connection reuse, fixture isolation, and accounts upgrade from the foundation ledger. The [migration module](../apps/server/migrations/README.md) owns the database contract.

After building, run `npx firebase emulators:exec --only auth --project demo-little-say "npm run test:accounts:web"` with the same database settings. This separate browser suite owns its API and schema and checks verification, media restoration, offline conflicts, sign-out, and server/account isolation. Do not reuse an unowned process on its test ports. Synthetic credentials cannot establish real Google/Apple consent, SecureStore behavior, or interrupted Apple revocation.

## Live AI and device validation

`npm run eval:ai` uses development key resolution for billable model calls, checking board creation/refinement, language profiles/overrides, and retained card/photo references. `-- --filter profile` or `-- --filter setup` narrows cases. It reports correctness and duration; ordinary tests/CI never run it.

`npm run eval:pictures` checks six construction-vehicle concepts/library matches; `-- --generate` permits up to six new pictures. `-- --animals --generate` produces a six-animal emoji/library/generated comparison. Output and an HTML contact sheet live under ignored `artifacts/picture-evaluation/`. Inspect actual artwork for semantic distinctions; model review is fallible and cannot establish a child's understanding.

Before distribution, exercise a signed build on iPad and Android: tap/swipe/multitouch, hold/release/confirm, system containment, selected-language pronunciation, offline clips, volume/silent mode, keyboard dictation without app microphone requests, native photo crop, transparent PNG framing, background/restart recovery, and failed saves. Check status-bar/cutout clearance, gesture and three-button navigation, portrait/landscape, scrolling long dialogs, and rotation while open. Validate HTTPS/connectivity from the actual tablet.

Browser inset overrides do not prove Android window behavior. Expo Go does not prove signed launcher/splash, signing, OTA, or containment. Installation, submission, deployment, and applying an update require separate [release validation](../scripts/release/README.md); a passing test/build alone does not prove rollout. Use `npm audit` for current advisory results rather than committing an audit snapshot.
