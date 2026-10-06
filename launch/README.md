# Dedicated account screens: retained evidence for PR29

This is nonmerged review evidence owned by the existing issue19 accounts implementation task. Retain it for current and historical review. Earlier evidence at 5731b0dafacd0553b538c3f9d824348c75ce92b5 and fa01515ad5200d3d17931d36c7e375d511f526cf remains unchanged and historical. issue19-before.json and pr29-before.json preserve exact API-decoded descriptions before this update; human-feedback.json preserves the request.

## Sources and reproduction

Before: actual landed master **1f0329052bd46b1e953c5adb5ad7e59ba2f2dcc4**, extracted with `git archive` into accounts-launch-before. After: **ddad8685c60bb390eacf81613249584eae55eb1e**, the clean owned little-say-accounts-master worktree. Master was merged additively; the landed native-release.json is unchanged. No deferred PR20 OAuth code was added.

Both isolated sources used `npm ci --ignore-scripts --no-audit --no-fund` and production server/web builds. Current validation used `npm run check`; the final modal visibility change was rebuilt with `npm run build:web -w @little-say/app`. Run the retained outer `run-accounts-launch-evidence.cjs` in the surrounding workspace. It creates a fresh owned PostgreSQL17 cluster (refusing reused state), migrates only its disposable database, runs the demo-little-say Auth emulator, and invokes the complete inner harness. The inner script starts and stops its own APIs on 4191/4192. No hosted identity, real provider, production database, device installation or inference was used. Owned services were stopped after capture.

manifest.json records full source identities, server PIDs, server bundle hashes, capture time, Chromium version, nonempty actually-loaded App bundle hashes checked against each build, fixture/harness hashes and image hashes. Runtime identities are retained in runtime.json. These immutable records bind exact content, not mutable filenames alone.

## Matched captures and observations

All images are actual application screenshots at phone width **390×1050**, scale 1, light theme, en-US, UTC and one shared fixed current clock. The suite additionally exercised 390×844. No screenshot pixel editing, cropping, API mocking or capture-only UI hiding was used. Native full-screen modal behavior is represented by the real web implementation; these are browser screenshots, not emulator/device proof.

The launch pair starts from fresh device storage. The settings pair uses identical Farmyard friends boards/media with AI consent false. After's device-local accountChoiceMade preference is set only after the harness explicitly selects guest; baseline lacks that new field. The full fixture is retained. Blank-looking Cow/Sheep thumbnails are deliberate one-pixel synthetic assets, not failed downloads. Baseline has no login/restore action, so the fresh-device comparison finishes guest setup without starter boards; After logs into the verified account. This necessary navigation difference is disclosed.

- before-launch.png / after-launch.png: master opens language setup; After first offers Log in, Create an account and Continue without an account on its own screen.
- before-consent-unavailable.png / after-settings.png: master settings lacks account entry; After settings contains a navigation link and guest status, with no inline email/password fields.
- after-backup-consent.png: supplemental current dedicated registration screen shows server-backup disclosure, explicit submit and cancel. It is not labeled a baseline image.
- before-fresh-device.png / after-restored-device.png: empty master device versus exact restored boards and photo/picture/audio bytes. AI consent stays false.
- after-offline-retry.png / after-recovered.png: supplemental same-head failure/reconnection sequence. The harness asserts local boards stay unchanged and successful sync returns.

The implementer opened and inspected all nine originals. Visible states match the descriptions; controls and consent are legible, registration is separate from settings, and backup failure/recovery is visible. Actual GitHub page rendering is **waived, not performed**, under [the general human amendment](https://github.com/MChartier/calibrate-health/issues/405#issuecomment-6022754087). Independent QA must still verify images, provenance, scope, behavior and final presentation.

## UX decisions and validation

The first guest choice is remembered locally to avoid repeated launch interruptions. Existing signed-ins and active play sessions bypass the welcome screen. Back leaves a form before returning to the caller; cancellation clears form secrets without changing boards. Settings' modal is hidden while the account screen is open but its local draft remains mounted. Sign-out from settings retains local data and opens account choices. Loading public provider configuration does not disable guest navigation on an unavailable server. The launch preference does not enable AI or backup consent and is not part of the server snapshot.

Current release/type/unit/build validation passed (228 unit tests). PostgreSQL17/Auth-emulator integration passed 25 contracts. Five real account-browser scenarios passed, including launch/back/cancel, offline/relaunch, settings drafts, failed local persistence, settings sign-out, exact restoration, conflicts and server/account isolation. Final guest/browser and CI results are bound in the publication record. Android JavaScript export is not native hardware or real provider evidence.

Human request 6025763278 is implemented; QA withdrawal 6026527381 requires an independent fresh review rather than inheriting prior readiness. Real Google/Apple authorization, hardware SecureStore and provider revocation remain unperformed. No readiness transition is claimed.
