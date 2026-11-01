# Release integration

The protected [Release workflow](../../.github/workflows/release.yml) invokes the shared Expo release toolkit. [release.config.json](../../release.config.json) owns application identities, source boundaries, destinations, profiles, and version floors. The package and reusable workflow must reference the same reviewed full toolkit SHA; use the toolkit's `scripts/sync-engine.mjs` pin updater to update both references and regenerate locks without copying implementation snapshots.

`hooks.mjs` owns only application-specific behavior: `identity` hashes tracked inputs while excluding tests, Markdown, other-platform files, and allocated versions; `stamp` mirrors allocated versions into declared metadata; `applicationHook` dispatches inspection, stamping, script type validation, and isolated server health/version checks. Lifecycle, providers, approval, persistence, and uncertain-outcome handling belong to the shared toolkit.

GCP deployment is selected for the shared `https://littlesay.app` backend. The toolkit runs migrations, verifies immutable API/worker revisions and publishes revision-pinned Firebase Hosting before native/OTA delivery. The protected `gcp-production` environment supplies federated deployment identity; [GCP operations](../../deploy/gcp/README.md#release-protection) owns setup and recovery. The application owns no deployment wrapper.

## Preview and execution

Install with `npm ci`, then use the read-only CLI:

```sh
npm run release -- validate
npm run release -- plan --profile beta
```

GitHub owns execution and approvals. Every push to `master`, including a merged PR, starts **Release** for the exact pushed commit. Android and iOS development candidates are prepared first, then the workflow waits for manual approval in the `beta` environment before running the existing coordinated release. Manual dispatch remains available from the protected default branch, selecting a destination and optionally a compatible release rebuild:

| Workflow destination | Toolkit profile and delivery |
| --- | --- |
| `production` (default) | Deploy to GCP and Expo's `beta` channel using the existing `beta` profile; native builds go to TestFlight and Play internal testing when needed |
| `public-stores` | Use the existing `production` profile for GCP, the production OTA channel and store drafts; store review and public promotion remain separate |

The default run appears as **Continuous delivery (Development → approval → beta)**. The `production` dispatch destination still selects the existing `beta` toolkit profile and GCP backend; `public-stores` remains an explicit production release. CLI planning still uses `--profile beta` or `--profile production`. API/CLI dispatch callers use the `destination` input.

## Development preparation and beta approval

Before beta promotion, the toolkit compares each platform's native fingerprint and mobile bundle inputs with its last confirmed development successes. When a client check is needed, it reuses a compatible finished EAS Dev client across commits, waits for a matching build already in progress, or builds a new client if none exists. This also recovers clients missing from GitHub's success records; the [shared continuous-delivery contract](https://github.com/darkmachines-net/expo-release-template/blob/main/src/consumer/README.md#continuous-delivery-to-beta) defines the identity checks. JavaScript/assets-only changes publish the current commit's bundle to the `development` channel using a compatible existing Dev client. Unchanged mobile inputs skip both operations, so server-only and documentation-only changes do not rebuild the Dev client. The first run establishes these development baselines. A failed build or update prevents promotion; successful platform operations remain reusable on retries and future runs even if another operation failed.

Install the Dev client linked in the workflow summary when a native build was needed. Open the summary's development-update QR code, or refresh Updates in the client and select the published update, to test the exact source commit shown. Native compatibility still uses fingerprint runtimes: an old client cannot run a bundle requiring new native inputs. The Dev candidate uses the currently deployed backend; changed server code is built and deployed only after beta approval.

The `development.promotionEnvironment` setting names the `beta` GitHub environment. It must require a reviewer and restrict deployments to `master`. The toolkit verifies that required reviewers exist before starting; a missing or unprotected promotion environment fails the run. Dev preparation uses the reviewer-free `internal` environment and repository `EXPO_TOKEN`. After testing, approve **Approve tested development candidate for beta** in that run to continue. Rejecting or leaving approval pending does not publish to beta. Later merges can prepare new Dev candidates while earlier runs await approval; approve the run whose exact commit you tested.

Only post-approval delivery is serialized. It reads fresh release history, builds/deploys the server if needed, and builds/submits native clients or publishes beta OTA updates as selected by the existing toolkit. Existing GCP and other environment protections still apply. Development success does not advance beta/production release baselines or consume release versions.

The hosted workflow installs the official EAS CLI version pinned by [eas.json](../../apps/mobile/eas.json). Android and iOS use EAS cloud builds, one mobile semantic version, independent managed build counters, and the existing application/project identities. Both profiles build store-distributable binaries and submit selected native releases through EAS. The toolkit selects required backend, native and OTA operations; a production deployment is a full coordinated release, not an OTA-only command. Backend deployment must succeed before mobile delivery.

`beta` delivers an Android AAB to Play's **internal testing** track with release status **completed**, and an iOS store-signed build to **TestFlight** for Apple ID `6826487372`. It uses the `beta` OTA channel, EAS `preview` environment and GitHub `internal` approval gate. `production` uses its own OTA channel, a Play production-track draft and the App Store Connect destination. Store review and public rollout remain store operations. OTA-only releases publish updates without resubmitting binaries.

| Source change or request | Mobile version and delivery |
| --- | --- |
| Native fingerprint change | New major runtime and builds for every enabled platform |
| Compatible rebuild | New minor, compatible binaries, and same-runtime OTA |
| JavaScript/assets change | Patch OTA within the current major runtime |

Expo runtime is the explicit mobile major. Binaries sharing that major remain eligible; distinct older runtimes receive no automatic backports. [fingerprint.config.js](../../apps/mobile/fingerprint.config.js) retains strict native compatibility checks while excluding allocated version fields. Server inputs use a separate patch version and successful-deployment baseline.

Versions are stamped into a tagged child build commit; default-branch files are not bumped. Failed reservations consume their numbers. Source checks, Docker production builds, and OTA export have no publishing credentials. Selected server deployment must succeed before native delivery and OTA publication; the [GCP module](../../deploy/gcp/README.md) owns infrastructure and operational configuration.

## Provider setup and runtime transition

Preserve the configured application/project IDs and signing/submission credentials. Use the beta and production OTA channels for release builds. Restrict the `internal` and `production` GitHub environments to `master`; keep `internal` reviewer-free for automatic Dev preparation and require the intended reviewers for `production`. The separate beta promotion gate is defined above. Their EAS environments are `preview` and `production`. Deployment credentials remain in the protected `gcp-production` environment.

Expo operations use `EXPO_TOKEN`. Ordinary EAS builds use managed signing credentials. Configure store signing/provisioning and assign the app's Google Play service-account key and App Store Connect API key in EAS before running noninteractive submission. Build-signing and store-submission credentials are separate. The shared workflow's Android signing secret names, where required, are `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Public EAS inputs must be declared readable strings.

Manage tester membership in the stores: Play internal testers must join the configured tester list and opt in. In App Store Connect, create a TestFlight internal group with [automatic distribution](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/) and invite the intended team members. The toolkit uploads builds but does not create groups or invite testers. Testers outside the App Store Connect team require an [external group and TestFlight review](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/); submission success alone does not establish tester availability. Complete any store-required processing. [app.config.js](../../apps/mobile/app.config.js) owns the iOS export-compliance declaration and its encryption assumptions; new binaries embed the answer to avoid repeated TestFlight compliance prompts. Already uploaded builds still require their existing compliance answer, and OTA updates cannot change it.

Before the first release under the major-runtime policy, verify EAS-managed Android `versionCode` and iOS `buildNumber` meet the configured floors. Retain higher provider/store counters; missing or lower counters block preflight. The semantic and build-number floors live in `release.config.json`. Counter setup does not build or submit an application. Preserve both profiles' iOS submission targets in `apps/mobile/eas.json`. Build distribution is part of the native fingerprint: switching from direct-install to store binaries establishes a new major runtime and requires fresh native builds.

Existing plans, receipts, pending requests, and old runtime baselines are not imported. Existing installations need a new native binary before receiving OTA updates under this policy. Before dispatch, verify the repository has Actions write access to the configured GHCR image and the deployer pulls that image; a repository transfer does not authorize changing the image destination. A human performs the first release and verifies real native installation, store handoff where applicable, and server health.

## Fresh releases after failure and validation

After fixing a failed job, use **Re-run failed jobs**. The shared toolkit retains the original plan and versions, restores completed artifacts, reconnects to accepted EAS builds and skips confirmed submissions or other provider operations. Android and iOS successes are recorded independently. A lost acknowledgement without a durable receipt can still cause redundant delivery on an explicit retry. A fresh dispatch also remains available without cleaning deployment records; prior reservations remain consumed. See [toolkit workflow operations](https://github.com/darkmachines-net/expo-release-template/blob/main/.github/workflows/README.md#immutable-evidence-and-job-retries) for the retry contract. Existing runs retain their original toolkit pin; the updated behavior starts with a new dispatch after this change is merged.

Use EAS/store tooling for store review and later promotions. The integration has no candidate/version PRs, local release wrappers, retained-artifact commands, history imports, or replay CLI. Do not add consumer lifecycle or recovery implementations.

## Development previews

Run **Development → build** from master to build a separate Little Say Dev phone app and publish its matching hosted JavaScript preview after configuring EAS signing. The workflow summary provides both links: install the client, then open its preview by scanning the development-build QR code or refreshing the client's Updates tab and selecting the named branch. No Metro server or second update dispatch is needed. Publication requires the finished client's runtime to match the exported bundle; a failed export, build or publication leaves the workflow incomplete. Retry failed jobs to reuse completed outputs.

The development application ID is net.darkmachines.littlesay.development. Android uses an APK; iOS uses registered-device ad hoc distribution. Dev clients can open any fingerprint-compatible preview, including the Release workflow's `development` channel. Manual **Development** runs publish isolated preview branches. Keep **Use workflow from** set to master; to include pending changes, set **Source** to their pushed branch name (for example, codex/android-tile-audio) or full commit SHA. A blank Source builds the master dispatch commit. **Development → update** publishes another preview for an existing compatible client. If the client says “No compatible update found,” older branches may target different native inputs; publish from the client's source commit or run build to produce a new matched pair.

With that app installed, run `npm run preview -- --platform android` (or ios) from your working copy before review. Uncommitted edits are included. Open the printed EAS dashboard link and scan its development-build preview QR code. Native changes require another development build; JavaScript-only changes reuse it. For Metro live reload and concurrent worktrees, follow the [development launcher](../README.md#development-launcher), which uses the toolkit's public native-launch preparation interface. The [shared development contract](https://github.com/darkmachines-net/expo-release-template/blob/main/src/consumer/README.md#development-previews) owns native setup and compatibility. Hosted previews require EAS CLI 25.3.0 and EAS login locally.

Beta follows channel beta and submits to Play internal testing and TestFlight. Production follows channel production and creates a Play production draft; App Store review/public release remains a provider operation. Store processing and tester-group availability must be checked separately. Beta delivery and Dev preparation use the existing `internal` credentials environment; the separate beta promotion gate is described above. Production requires a protected `production` environment before first use. The manual Development workflow is optional; the local preview command remains available before review.
