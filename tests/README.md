# Tests

Run from the repository root with Node 24 (`npm.cmd` / `npx.cmd` on Windows):

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:web
```

`check` runs [lint](../scripts/README.md#linting), [release-contract checks](../scripts/release/README.md#fresh-releases-after-failure-and-validation), TypeScript including unused code, unit/component tests, and production server/web builds. The [Check workflow](../.github/workflows/ci.yml) splits these validations into jobs and adds browser and service suites.

## Pull request merge requirements

**Check** runs on pull requests and manual dispatch, without a push trigger that would repeat validation after merging. `Lint` runs ESLint independently. `Build` runs type checks and production server/web builds, then passes those outputs to `Tests` through the run's `test-build` artifact. `Tests` starts only after Build succeeds and runs release-contract, unit/component, service and browser tests against those outputs without rebuilding them.

GitHub branch protection for `master` must require `Lint`, `Build` and `Tests` from the GitHub Actions app, with branches up to date before merging and enforcement for administrators. Requiring Build explicitly also blocks merging when its failure causes Tests to be skipped. These are exact job check names, not the workflow name. Preserve them when editing the workflow, or update branch protection alongside any rename. Manage required checks in the repository's branch-protection settings; workflow YAML alone does not make a check required.

## Coverage ownership

| Layer | Location and purpose |
| --- | --- |
| Core | `packages/core/src/*.test.ts`: schemas, migrations, board merges, translation protection, layout, and gesture/queue state |
| Client | `apps/mobile/src/**/*.test.ts`: hooks, native component wiring, platform adapters, storage, and account/media lifecycles |
| Server | `apps/server/test/` and colocated tests: provider boundaries, API validation, caches, and durable service integration |
| Tooling | `scripts/*.test.ts`, `scripts/release/*.test.mjs`: launcher isolation, bundled resources, lint configuration, and release integration |
| Browser | `tests/web/`: user flows against the production web build, with isolated account and device data |

Prefer assertions about observable behavior and failure recovery. Keep pure edge cases in unit tests and browser coverage for platform wiring and user flows. Before removing a scenario, compare its assertions with the owning feature suite; similar names alone do not establish duplication. Avoid opaque hashes of requests or source-text assertions when the runtime contract can be tested directly.

## Browser scenarios and evidence

Browser feature suites own their named behavior: `conversation` and `creation-drafts` cover AI turns, shared Undo/Redo, and explicit draft saves; `pictures` and `preparation` cover image previews and cancellation; `photos`, `grid`, `speech`, and `translationEditing` cover those flows. `editor-transition` owns play/editor handoff and unlock cancellation. `headers` owns shared navigation geometry, including the unified Settings action. `dashboard` owns responsive creation actions, draft resumption, and final-row clearance. `safe-area` checks inset and keyboard-sized viewport changes. `app.spec.ts` retains cross-feature editing, language, playback, and persistence scenarios. File headers and test names describe the individual contracts.

`App.test.ts` owns history ordering, branching, board isolation, and failed-write behavior; `BoardEditor.test.ts` checks history action availability. The [UI module](../apps/mobile/src/ui/README.md) owns the Undo/Redo behavior contract.

The browser runner starts its own API on a free loopback port and creates unique verified emulator accounts. It disables provider keys and isolates libraries/media from development processes. Feature scenarios mock AI/speech; unavailable speech responses exercise device fallback. Service-worker/offline checks use the production build, not Metro. Account scenarios use real isolated PostgreSQL and Firebase Auth services.

For focused browser runs after building:

```sh
npm run test:web -- tests/web/settings.spec.ts
npm run test:web -- tests/web/editor-transition.spec.ts
npm run test:web -- tests/web/app.spec.ts --grep "outside modal dismissal"
```

Keep screenshots, traces, build logs, and ad-hoc capture code in ignored `artifacts/`, `test-results/`, or `playwright-report/`. Attach review images to the PR with the source revision and matching before/after fixtures. Maintained assertions are the regression contract; do not commit capture galleries or generated reports.

## Service tests

`npm run test:services` starts PostgreSQL 17 and Firebase Auth containers with bundled Java, uses random loopback ports and disposable database/media storage, runs integration tests, and removes only its own project volumes and files. Node and Docker with Linux containers are required; no cloud account is needed. The runner clears AI keys and uses synthetic providers.

After `npm run build`, `npm run test:accounts:web` runs account flows against the same isolated dependencies: verified sign-in, restoration, automatic backup, conflicts, sign-out, and account/server boundaries. `npm run test:web -- <scenario>` uses the same service isolation for other browser tests. Both refuse unrelated listeners on their selected API port.

`npm run test:integration` is for an explicitly provisioned harness. It requires `TEST_PGDATABASE` ending in `_test` and `TEST_PGPASSWORD`; it never infers a target from application `PG*`. Optional `TEST_PGHOST`, `TEST_PGPORT`, `TEST_PGUSER`, and `TEST_PGSSLMODE` select the test database. Each fixture migrates a random schema and drops only that schema. Firebase tests require a local loopback emulator host.

Integration coverage includes migrations/locks, owner isolation, concurrent quotas, durable dispatch, cancellation, interrupted jobs without paid replay, private media, session/CSRF handling, and account deletion. Real Hosting cookies, provider OAuth, GCS recovery, and store-installed flows require separate [deployment acceptance checks](../deploy/gcp/README.md#recovery-and-acceptance).

## Live AI and device validation

`npm run eval:ai` makes billable model calls for board creation/refinement and language/photo retention. `-- --filter profile` or `-- --filter setup` narrows cases. `npm run eval:pictures` checks concept/library matches; `-- --generate` permits up to six generated pictures, and `-- --animals --generate` produces an animal comparison. Picture evaluation writes its results under ignored `artifacts/picture-evaluation/`. Ordinary tests and CI never run live evaluations. Inspect the actual artwork and pronunciation; model review alone does not establish suitability for a child.

Native component tests mock React Native primitives. Browser inset/keyboard overrides verify layout constraints, not Android IME geometry. Before distribution, exercise a signed build on iPad and Android: touch/swipe/multitouch, parent holds and containment, language pronunciation, offline clips, volume/silent mode, native photo crop, background/restart recovery, and failed saves. Check status bars, cutouts, gesture/three-button navigation, long dialogs, and rotation.

For the editor, repeatedly open/close the keyboard with a multiline prompt and long AI reply, rotate while typing, and hand a card edit to AI. The complete input and Send must remain above the keyboard, the preview must remain scrollable, and dismissal must restore the toolbar without losing text or leaving a large gap. Exercise resized and overlay keyboard behavior where supported; verify connectivity from the actual device.

After changing the web/native entry split, export iOS and Android with source maps and confirm `Entry.web.tsx` and `src/website/` are absent from native sources. Expo Go does not validate installed identity, signing, OTA, or containment. Distribution and update application need [release validation](../scripts/release/README.md); a passing build does not establish rollout.
