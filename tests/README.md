# Validation

Unit tests live beside the core/client/scripts or in `apps/server/test`; `tests/web` owns browser scenarios and `tests/fixtures` contains synthetic libraries. Run from the repository root with Node 24 (`npm.cmd` / `npx.cmd` on Windows):

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:web
```

`check` runs [lint with zero warnings](../scripts/README.md#linting), [release-contract checks](../scripts/release/README.md#recovery-and-validation), TypeScript (including unused code), unit/component/service tests, and server/web builds. The `Check` workflow runs this command and a separate `Lint` job for pull requests and pushes to `master`/`main`. Keep `Lint` required for `master`, require branches to be up to date, and enforce checks for administrators in GitHub's repository settings; protection is configured separately from the workflow. Existing PR branches must include the job to satisfy that required check.

Browser tests use the production build, own an API on a selected free loopback port, and isolate device libraries. Feature tests create unique verified emulator accounts, disable API keys, and mock AI/speech; they never use development processes or user boards. Scenarios asserting Web Speech calls return an unavailable speech response to exercise automatic device fallback; app-wide voice overrides are reset on load. Scenarios supplying successful speech responses can verify cached AI playback. Service-worker/offline behavior must be tested against the built app, not Metro.

## Browser scenarios and evidence

`App.test.ts` covers shared Undo/Redo ordering, branch invalidation after manual/AI/translation changes, rejected edits, write failures, empty-draft restoration, board isolation, and bounded rapid traversal. `BoardEditor.test.ts` checks history action availability and blocking states. `conversation.spec.ts` exercises Undo/Redo through the browser, including persisted draft promotion and a new AI turn after partial redo. The [UI module](../apps/mobile/src/ui/README.md) owns the history behavior contract.

`settings.spec.ts` covers the simplified menu, About version information, retired media links, default media migration, language save retry, cached AI playback, offline links, and header-only account navigation. Native App and AccountScreen component tests cover account gating and device-provider choices. `safe-area.spec.ts` overrides browser insets to check controls after resizing/rotation, including repeated keyboard-sized editor resizes with multiline prompts and long AI replies. It checks the entire composer and live preview against all four safe edges. `BoardEditor.test.ts` exercises Android/iOS keyboard events, overlay and resized window dimensions, rotation offsets, persistent input identity, and the rule that no scrolling ancestor may contain the composer. Native components are mocked there; these tests do not measure Android IME window geometry. `creation-drafts.spec.ts` verifies explicit Save/Discard, page/browser exits, reload isolation, clarification resumption, and write retries. Conversation/picture scenarios cover automatically saved AI turns, shared chronological Undo, conflict/save recovery, keyboard-sized viewports, revision-safe partial previews, protected pictures, gap-only generation, source controls/focus, reduced motion, cancellation, downloads, attribution, migration, and offline fallback. `boardEditor.ts` navigates the toolbar settings gear and waits for durable AI application without an acceptance button. Photo, grid, speech, translation, setup, and account scenarios cover their corresponding flows; file headers describe their responsibility.

`headers.spec.ts` verifies a single navigation row across phone and desktop widths: branding only on Home, Back and one route heading on the left of subpages, and page actions on the right. It checks header touch targets, account/setup resizing, and the separate play header.

`account-management.spec.ts` checks the status-first overview at phone and desktop widths, management routes and direct-link refresh, browser Back/Forward credential clearing, sign-out/deletion confirmation, and offline/server-error recovery. `accounts.spec.ts` exercises verified-email entry, complete media restoration, conflict copies, and local-preserving sign-out against real isolated account services. Native component/service tests cover provider confirmation, account-state precedence, raced edits, and the native page stack.

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

After `npm run build`, run `npm run test:accounts:web` for required sign-in, registered-account AI, session persistence, verification, first-device cloud restoration, automatic account backup, media restoration, offline conflicts, sign-out and server/account isolation. Unit tests also cover old paused-backup preferences, automatic retries, and play/edit deferral. `npm run test:web -- <scenario>` uses the same dependency isolation for ordinary browser scenarios. Each runner selects a free API port and refuses an unrelated listener if that port becomes occupied. Test media never uses development cache directories.

`npm run test:integration` remains available to a deliberately provisioned test harness. It requires `TEST_PGDATABASE` ending in `_test` and `TEST_PGPASSWORD`; it never infers a target from application `PG*`. Optional `TEST_PGHOST`, `TEST_PGPORT`, `TEST_PGUSER`, `TEST_PGSSLMODE` select that test database. Each fixture migrates a random schema and drops only its own schema. Firebase cases require an explicitly local loopback emulator host.

Coverage includes migrations/locks, concurrent quotas, owner boundaries, durable dispatch, cancellation before/after claims, duplicate delivery, interruption without paid replay, persisted fixture media, single-cookie CSRF, account deletion and isolated cleanup. Emulator/browser success does not prove real Hosting cookie behavior, provider OAuth, GCS recovery, or store-installed device flows; those are separate [deployment acceptance checks](../deploy/gcp/README.md#recovery-and-acceptance).

## Live AI and device validation

`npm run eval:ai` uses development key resolution for billable model calls, checking board creation/refinement, language profiles/overrides, and retained card/photo references. `-- --filter profile` or `-- --filter setup` narrows cases. It reports correctness and duration; ordinary tests/CI never run it.

`npm run eval:pictures` checks six construction-vehicle concepts/library matches; `-- --generate` permits up to six new pictures. `-- --animals --generate` produces a six-animal emoji/library/generated comparison. Output and an HTML contact sheet live under ignored `artifacts/picture-evaluation/`. Inspect actual artwork for semantic distinctions; model review is fallible and cannot establish a child's understanding.

Before distribution, exercise a signed build on iPad and Android: tap/swipe/multitouch, hold/release/confirm, system containment, selected-language pronunciation, offline clips, volume/silent mode, keyboard dictation without app microphone requests, native photo crop, transparent PNG framing, background/restart recovery, and failed saves. Check status-bar/cutout clearance, gesture and three-button navigation, portrait/landscape, scrolling long dialogs, and rotation while open. In the board editor, repeatedly open/close the keyboard before and after an AI turn, type a multiline prompt with a long reply present, rotate while typing, and hand a card edit to AI. Verify that the full input and Send remain above the keyboard, the live preview remains visible and scrollable, no oversized keyboard gap appears, and dismissing restores the toolbar without losing text. Exercise both resizing and edge-to-edge/overlay keyboard behavior when supported. Validate HTTPS/connectivity from the actual tablet.

Browser inset overrides do not prove Android window behavior. Expo Go does not prove signed launcher/splash, signing, OTA, or containment. Installation, submission, deployment, and applying an update require separate [release validation](../scripts/release/README.md); a passing test/build alone does not prove rollout. Use `npm audit` for current advisory results rather than committing an audit snapshot.
