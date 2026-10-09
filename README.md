# Issue 12 partial preparation evidence

Owner: Codex task `01a11f2d-be63-7093-9808-bad0818a3032`, authorized MCHARTIER_ZBOOK. Retain this dedicated evidence ref for PR/issue review and any receipts referring to it. It is not a merge target. No product-history capture commits, credentials, signing, provider configuration, deployment or release are included.

Execution standard: workflow-v3 at f0919b184b6344d6279178b2388190936ca432a9; pr-review-v3 at 97e5583c8355f3673aad0835c0ce3ca1486aeb8b, with all supplied human amendments. Root admitted only the disjoint subset after the clean acceptance-gap checkpoint.

## Source and scope

Baseline is actual master `b46e9e83ffacb2e3846486fb7a64a57d1203f372`. Final source, ordered commits/parents and every changed path are recorded in `scope.json`; there is no unmerged parent. PR 38 (`9cada3111541357bc720b9ad66ccfeaa7081171e`) and PR 49 (`d88515b08e012acceadeeb9497f062d1964685f8`) were neither imported nor edited. Their reserved AI-disclosure and shared release paths remain pending coordination. Exact source files used at capture are hashed in `capture-record.json`; both worktrees were clean.

The merge diff contains only the 14 admitted maintained source/test/documentation paths. The Apple component embeds a 9,454-byte official button image to work offline without contacting Apple before authentication; the source URL/query is documented there and original bytes are retained as `apple-button-reference.png`. No generic artwork or authentication implementation was copied.

## Genuine matched browser evidence

`capture-record.json` identifies both full source SHAs, each image digest, environment, viewport, fixture and actual HTTP-served JavaScript digests. `manifest.json` binds the harness, provenance, logs and every retained build/image byte. Builds under `builds/before` and `builds/after` are the exact exported files served, not reconstructed mockups. The iOS export is unsigned JavaScript/Hermes output, not a native archive.

Capture used installed Chrome 155.0.8059.39 / Playwright 1.63.0 on Windows. Both sides use fresh contexts, 390×844 phone and 820×1180 tablet viewports, scale 1, light theme, en-US/UTC, fixed 2026-10-09T06:00:00Z clock, empty local library, identical synthetic public provider configuration and synthetic failed-password responses. All other external requests are blocked. No real account or provider authentication occurred.

Service workers are blocked identically to avoid stale bundles; no UI is hidden, cropped, redacted or edited. Screenshots disable animations; loading is awaited by actionable controls. Native/animated spinner phase is not used to claim a visual change. Login states use the same scroll-to-Apple action. Retry states scroll to the error; privacy-entry states scroll to OpenAI's existing policy action, which anchors both views at the same bottom area. Adding the new entry naturally moves earlier content upward; this is the intended layout difference, not a fixture change.

Representative paired states: login, busy login, failed-login retry, and privacy entry, at both widths. `after-*-privacy-content.png` are supplemental views of the new sheet, not mislabeled Before comparisons. The author inspected actual pixels: account controls remain readable, the black Apple action has its official logo/title, busy layout remains stable, error recovery restores actions, and privacy content scrolls with an available close/back action. Native screen-reader/text-scaling/real-device execution remains deferred. GitHub PR-page image rendering uses the supplied general waiver; no rendering pass is claimed.

Reproduction from the workspace containing `little-say/` and `before/`:

1. Check out the two recorded source revisions separately. Install the unchanged lockfile with Node 24 and `npm ci --ignore-scripts`. The captured Windows baseline reused the candidate `node_modules` through a junction; shared workspace core source is unchanged between revisions and both exported outputs are retained.
2. In each checkout run `npm run build:web -w @little-say/app`. Candidate also ran `npm run build` for server/web. The final web export was built immediately before capture; clean source hashes and served-JS hashes bind it to the final commit. Earlier build logs were replaced only before publication; no assessed evidence identity was replaced.
3. Run `node evidence/serve.mjs`, then `node evidence/capture.mjs`. The retained harness contains the exact synthetic configuration, request gates, clock setup, navigation and screenshot commands.
4. Candidate browser tests: `node node_modules/@playwright/test/cli.js test --config ../evidence/playwright.config.mjs --grep 'preparation:'`. This runs the maintained tests against local exports, not PostgreSQL/emulator integration.

## Validation and limitations

- Final types and release metadata passed. The full unit/regression suite passed 331 tests before the final verifier/visual refinements; the affected verifier was rerun (3 tests), and final provider/privacy browser tests passed (2). Six focused provider/verifier tests also passed during development. No unaffected full-suite rerun was needed.
- Server/web build passed; final web export and unsigned iOS JavaScript export passed. These are not native compilation, signing or device execution.
- Synthetic tests demonstrate unsupported host/toolchain, missing purpose/manifest/configuration, signing-type and signed-identity failures. Existing retained-artifact/checksum safeguards are unchanged. macOS `codesign`/`security`/`plutil` integration is unexecuted.
- Focused browser tests demonstrate keyboard focus/activation, busy/disabled controls, failed login/retry, mode Back/Cancel, and offline privacy navigation retaining an unsaved settings address at phone/tablet widths. No real social popup/provider cancellation or signed-provider success is claimed.
- The first browser launch failed because matching bundled Chromium was absent. Installed Chrome was used instead. A subsequent test exposed missing browser aria-busy and drove its correction. Final results are in `browser-tests-final.log`; earlier logs remain supporting history only.
- Dependency install reported existing audit findings; dependencies and lockfile were not changed. No PostgreSQL/Auth-emulator integration, native permission denial, Mac archive, real device tests, provider/account setup, store answers, upload/processing/group/install or release was performed.

Remaining issue work: immediate AI recipient/data/permission disclosure, shared release documentation/test integration, and any demonstrated additional source gap after coordination. Remaining distribution gates: actual authorized toolchain/archive, SDK manifests and reasons, signing/provider/device tests, backend suitability, owner/operator/privacy decisions, store/export answers and explicitly authorized upload/processing/testing. This partial draft must not close issue 12.
