# Validation

Unit tests live beside the core/client/scripts or in `apps/server/test`; `tests/web` owns browser scenarios and `tests/fixtures` contains synthetic libraries. Run from the repository root with Node 24 (`npm.cmd` / `npx.cmd` on Windows):

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:web
```

`check` runs [lint with zero warnings](../scripts/README.md#linting), [release-contract checks](../scripts/release/README.md#recovery-and-validation), TypeScript (including unused code), unit/component/service tests, and server/web builds. The `Check` workflow runs this command and a separate `Lint` job for pull requests and pushes to `master`/`main`. Keep `Lint` required for `master`, require branches to be up to date, and enforce checks for administrators in GitHub's repository settings; protection is configured separately from the workflow. Existing PR branches must include the job to satisfy that required check.

Browser tests use the production build, own an API on a selected free loopback port, and isolate device libraries. Ordinary guest tests disable API keys and mock AI/speech; they never use development processes or user boards. Scenarios asserting Web Speech calls must seed `voiceSources` as `device` for the tested locales through `openExistingLibrary`; background AI clips can otherwise satisfy playback without calling Web Speech. Service-worker/offline behavior must be tested against the built app, not Metro.

## Browser scenarios and evidence

`settings.spec.ts` covers routes, About version information, preference migration, save retry, AI/device source selection, canceled preview, and offline links. `safe-area.spec.ts` overrides browser insets to check controls after resizing/rotation. Conversation/picture scenarios cover revision-safe partial previews, direct first-send behavior, protected pictures, gap-only generation, source controls/focus, reduced motion, cancellation, downloads, attribution, migration, and offline fallback. Photo, grid, speech, translation, setup, and account scenarios cover their corresponding flows; file headers describe their responsibility.

`landing.spec.ts` checks desktop/phone layouts, keyboard navigation, inactive store placeholders, direct `/app` access, older installed-web-app launches, and absence of library/API initialization on `/`. After changing the entry split, export iOS and Android with source maps and confirm `Entry.web.tsx` and `src/website/` are absent from native sources.

Keep screenshots, traces, manifests, build logs, and ad-hoc capture code under ignored `artifacts/`, `test-results/`, or `playwright-report/`. Attach review images directly to the PR with matching before/after viewports and fixtures and identify captured source revisions. Do not commit evidence to documentation or evidence branches. Where supported, `gh pr edit <number> --body-file <markdown> --attach <image>` uploads local images referenced by the comparison table; repeat `--attach` per image. CI retains Settings captures for 14 days and conversation captures for seven; maintained scenarios are the regression contract.

For focused runs after building:

```sh
npm run test:web -- tests/web/settings.spec.ts
npm run test:web -- tests/web/safe-area.spec.ts
npm run test:web -- tests/web/app.spec.ts --grep "outside modal dismissal"
```

## Service tests

`npm run test:services` starts checkout-independent PostgreSQL 17 and Firebase Auth containers with bundled Java, uses random loopback ports and a disposable database/media directory, runs integration tests, then removes only its own project volumes and files. It clears AI keys and uses explicit synthetic fixtures. Node and Docker are the only local service-test prerequisites; no cloud account is required. CI uses the same runner.

After `npm run build`, run `npm run test:accounts:web` for automatic guest AI, session persistence, verification, explicit backup consent, media restoration, offline conflicts, sign-out and server/account isolation. `npm run test:web -- <scenario>` uses the same dependency isolation for ordinary browser scenarios. Each runner selects a free API port and refuses an unrelated listener if that port becomes occupied. Test media never uses development cache directories.

`npm run test:integration` remains available to a deliberately provisioned test harness. It requires `TEST_PGDATABASE` ending in `_test` and `TEST_PGPASSWORD`; it never infers a target from application `PG*`. Optional `TEST_PGHOST`, `TEST_PGPORT`, `TEST_PGUSER`, `TEST_PGSSLMODE` select that test database. Each fixture migrates a random schema and drops only its own schema. Firebase cases require an explicitly local loopback emulator host.

Coverage includes migrations/locks, concurrent quotas, owner boundaries, durable dispatch, cancellation before/after claims, duplicate delivery, interruption without paid replay, persisted fixture media, single-cookie CSRF, account deletion and isolated cleanup. Emulator/browser success does not prove real Hosting cookie behavior, provider OAuth, GCS recovery, or store-installed device flows; those are separate [deployment acceptance checks](../deploy/gcp/README.md#recovery-and-acceptance).

## Live AI and device validation

`npm run eval:ai` uses development key resolution for billable model calls, checking board creation/refinement, language profiles/overrides, and retained card/photo references. `-- --filter profile` or `-- --filter setup` narrows cases. It reports correctness and duration; ordinary tests/CI never run it.

`npm run eval:pictures` checks six construction-vehicle concepts/library matches; `-- --generate` permits up to six new pictures. `-- --animals --generate` produces a six-animal emoji/library/generated comparison. Output and an HTML contact sheet live under ignored `artifacts/picture-evaluation/`. Inspect actual artwork for semantic distinctions; model review is fallible and cannot establish a child's understanding.

Before distribution, exercise a signed build on iPad and Android: tap/swipe/multitouch, hold/release/confirm, system containment, selected-language pronunciation, offline clips, volume/silent mode, keyboard dictation without app microphone requests, native photo crop, transparent PNG framing, background/restart recovery, and failed saves. Check status-bar/cutout clearance, gesture and three-button navigation, portrait/landscape, scrolling long dialogs, and rotation while open. Validate HTTPS/connectivity from the actual tablet.

Browser inset overrides do not prove Android window behavior. Expo Go does not prove signed launcher/splash, signing, OTA, or containment. Installation, submission, deployment, and applying an update require separate [release validation](../scripts/release/README.md); a passing test/build alone does not prove rollout. Use `npm audit` for current advisory results rather than committing an audit snapshot.
