# Releases

Run **Cut release** in GitHub Actions on the repository default branch (`master`). Choose only the version increment and native distribution channel. The workflow pins the dispatch commit, detects changed artifacts, prepares any required version PR, and publishes the required GHCR image, EAS cloud builds, store submissions, and compatible OTA updates. Server and OTA releases also upgrade the private Compose server and require readiness before OTA publication. All required operations run in the same cut. Merges run CI only; device installation remains separate.

| Input | Choices | Default |
| --- | --- | --- |
| Version increment (`bump`) | `patch`, `minor`, `major` | `patch` |
| Native distribution channel (`profile`) | `internal`, `production` | `internal` |

There are no source SHA, validation, pod-comparison, force-all, or dry-run inputs. GitHub's standard branch selector remains; publication requires the default branch. Checks, source verification, native compatibility, protected merges, and artifact readback run automatically. The run summary lists each component's selected/skipped status, reason, version/runtime, and verified artifact links after completion.

For standalone source validation, run the existing **Check** workflow on the desired branch. Locally, `npm run release:validate` runs repository checks and PostgreSQL/Auth-emulator integration tests using the disposable services described in [testing](testing.md). These checks require no release credentials. Permanent iOS pod-configuration regression tests remain part of the test suite; the one-off baseline/fix comparison is retired.

`internal` means EAS internal distribution, the `preview` environment, the `internal` OTA channel, and **no submissions**. `production` means store builds, the production environment/channel, and exact-build-ID submissions to Play's **internal draft** configuration and App Store Connect/TestFlight. EAS submission completion does not mean store processing or public rollout completed.

## First-time setup

1. Merge this workflow into the default branch before using **Cut release**. Preview with `npm run release:plan`, then use the internal channel for initial publication.
2. In GitHub **Settings → Actions → General → Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**. The workflow creates release PRs but does not approve reviews. Keep the default token permissions read-only: the jobs explicitly request `contents: write`, `pull-requests: write`, and `checks: write` for cutting a release, and `packages: write` for publication. All use `GITHUB_TOKEN`. Enable squash merges. Keep any required reviews; the workflow never bypasses them.
3. Use the committed Expo project in `native-release.json`: `@matthewchartier/little-say`, UUID `a0336055-a9d6-46b1-8eb4-120944304685`, server `https://littlesay.darkmachines.net`. The workflow verifies the remote project identity. Add an Expo access token as the GitHub repository secret `EXPO_TOKEN`; keep signing and submission credentials in EAS. Put deployment credentials only in the protected `self-hosted-testing` environment as described in the [webhook configuration guide](../deploy/self-hosted/README.md).
4. Install locked dependencies and CLI, then configure **both** platforms' EAS-managed internal signing. Register iOS test devices and ensure an unexpired ad hoc provisioning profile includes them and the `com.apple.developer.applesignin: ["Default"]` entitlement required by the app. Planning checks the selected distribution profile's entitlement in memory without logging its contents. Android needs one default keystore. Perform Expo's initial interactive cloud-build setup before relying on noninteractive CI; see [Expo CI prerequisites](https://docs.expo.dev/build/building-on-ci/). Queuing a build alone is not successful onboarding.

```powershell
npm ci
npm ci --prefix tools/eas-cli
cd apps/mobile
node ../../tools/eas-cli/node_modules/eas-cli/bin/run credentials --platform android
node ../../tools/eas-cli/node_modules/eas-cli/bin/run credentials --platform ios
node ../../tools/eas-cli/node_modules/eas-cli/bin/run channel:create internal --branch internal
cd ../..
```

Use an existing channel/branch if already configured; do not recreate or repoint it. The release workflow requires a single active, unconditional branch mapping and pins that destination in its plan. Configure the `preview` EAS environment with reproducible readable strings. `LITTLE_SAY_CHANNEL`, if set remotely, must equal `internal`; keep backend keys and development URL overrides out of EAS. Secret/file EAS variables cannot be reproduced for compatibility proof and are rejected. A drifted environment requires new native builds.

5. Confirm the repository/package grants `GITHUB_TOKEN` pull/push access to its GHCR namespace. Keep normal branch protection and required reviews. There is one concurrency group for all profiles with cancellation disabled; an unresolved candidate draft also blocks subsequent cuts.
6. For production only, complete Play's initial app/upload setup, store its submission service-account key in EAS, configure App Store Connect app/signing/submission API key, and commit the numeric `submit.production.ios.ascAppId` in `apps/mobile/eas.json`. Create/verify the production channel and environment. Play remains `track: internal`, `releaseStatus: draft`. See [Expo submission behavior](https://docs.expo.dev/build/automate-submissions/). Production prerequisites are not required for internal releases.
7. Supply the existing WireGuard peer settings and Little Say's scoped webhook token through the three deployment environment secrets and four variables. The operator deploys the shared service from darkmachines and provisions connectivity separately; this repository requires no host helper or SSH account. Follow the [deployment rollout checklist](../deploy/self-hosted/README.md#rollout-and-recovery), including publishing the image readiness check before relying on database health.

Verify onboarding credentials and actual provider/device results before declaring the pipeline operational. Source tests alone do not establish that signing or submission is configured.

### Optional local build tooling

Android needs a JDK, Android Studio SDK/Build Tools, and `ANDROID_HOME` (or `ANDROID_SDK_ROOT`). `native:setup -- --check` checks the existing tools without installing npm dependencies. The Gradle wrapper downloads its required Gradle version. SDK packages must be installed and their licenses accepted. Use Node 24 and `npm ci` for the root dependencies.

For a new Expo project, set up its Android keystore once using the **pinned** CLI, then rerun `native:configure`:

```powershell
cd apps/mobile
node ../../tools/eas-cli/node_modules/eas-cli/bin/run credentials --platform android
cd ../..
npm run native:configure
```

The wrapper downloads the default EAS signing key for **net.darkmachines.littlesay**. It saves it outside the repository, alongside the machine configuration. Existing signing credentials can instead be supplied with `native:configure -- --credentials C:/PRIVATE/credentials.json`; that EAS-format JSON must reference an absolute external keystore path. Never change the signing key of an already installed app to solve an installation error.

Local iOS builds need macOS, Xcode and CocoaPods. Run `native:setup -- --platform ios` there and add `--platform ios` to `native:configure`. Configure Apple signing with the pinned CLI's `credentials --platform ios`; register test devices for the `internal` ad hoc profile. No command falls back to a cloud build. See [Expo local build prerequisites](https://docs.expo.dev/build-reference/local-builds/).

## Selection, versions, and supported runtimes

Automatic selection hashes committed source and resolved dependency inputs, including deletions, renames, platform-specific files, shared workspace packages, and server-embedded web assets. Unrelated lockfile entries, documentation, tests, and allocated version fields are excluded. Native selection uses Expo fingerprints with allocated versions normalized before comparison. The machine-readable schema-1 `ReleasePlan` includes pinned source, profile/mode, comparison IDs, changed input identities, allocated versions, operations, OTA targets/exclusions, and reasons. It is printed to the run log and written to `artifacts/release-plan.json`.

| Changed input | Image | Native | OTA |
| --- | --- | --- | --- |
| API/migrations/server dependency | Yes | No | No |
| Web-only source/assets | Yes | No | No |
| Shared client JavaScript/assets | When web inputs change | No | Affected compatible platforms |
| Native module/plugin/permission/config | When image inputs change | Affected platforms | When bundle inputs also change |
| Docs/tests/version bookkeeping | No | No | No |

The selected increment applies independently to server and native versions only when that component needs a release. For example, a minor cut can take server `0.3.0` to `0.4.0` and native `0.1.2` to `0.2.0` if both need publication. Native builds increment only the selected platforms' build numbers; an unchanged platform keeps its build number and installed runtime. OTA-only cuts keep all versions and build numbers unchanged. Internal and production client baselines are independent; the server namespace is shared. An automatic no-op creates no version commit, candidate draft, or completion tag. Verified legacy `vX.Y.Z` image tags can bootstrap server history; a platform/profile without verifiable native evidence requires an initial build.

New plans always record `mode: "auto"`. Historical schema-1 plans/receipts, including `force_all` and native patch allocations, remain readable. Retries use their recorded operations, versions, image/build/submission IDs, and update groups without applying today's allocation rules again.

Runtimes retain Expo's `appVersion` policy. Cloud builds produce portable schema-2 `NativeBuildBaseline` records containing source, identity, environment, full/normalized fingerprints, exact build ID, artifact URL and SHA-256, and any submission ID. Completed receipts retain older verified baselines until explicitly retired in `release-policy.json` with `{ "profile": "internal", "platform": "android", "runtimeVersion": "0.1.0" }`. A compatible older runtime is exported using only its allocated version fields; current native configuration must still reproduce its **full** fingerprint. Changing the runtime string cannot make an incompatible app eligible. Equivalent platform/runtime targets are deduplicated, conflicting native fingerprints fail, and incompatible/retired targets are reported. Historical-source backports are outside this workflow. See [Expo runtime rules](https://docs.expo.dev/eas-update/runtime-versions/).

To bootstrap an existing cloud build, commit its verified schema-2 record under `release-policy.json` → `importedBaselines`. A runtime name, local file path, or build URL alone is insufficient: preflight verifies the exact finished build, source ancestry, identity, full fingerprint and downloaded artifact digest. Existing local schema-1 baselines remain usable by the local tooling with their original artifact-integrity checks.

## Workflow and recovery

1. **Plan/preflight:** pin source and destination, verify remote project/environment/signing prerequisites, and print the complete operation list. The separate developer command `npm run release:plan` previews automatic selection, runs checks for selected work, and exports selected new/compatible runtime bundles without creating PRs, versions, journals, builds, submissions, or publications. It needs a clean committed checkout, `GITHUB_REPOSITORY`, authenticated GitHub/GHCR and Expo reads, and the selected EAS environment; set `RELEASE_PROFILE` and `RELEASE_BUMP` to preview non-default choices. It does not reconcile or retire existing candidates.
2. **Prepare:** write the immutable plan in a draft `candidate/<run-id>` GitHub Release, create `release/unified-run-<run-id>`, and prepare only permitted server/native version fields together. Run `npm run check` and PostgreSQL integration tests; record `check` on the exact bot-created PR head because `GITHUB_TOKEN` pushes do not trigger normal PR CI. Attempt an ordinary squash merge without bypassing reviews.
3. **Validate merged source:** require the merged tree to exactly equal the planned version candidate and still be on the default branch, then rerun checks. Functional changes during merge stop before publication and require a fresh cut.
4. **Publish:** build the multi-platform GHCR image and selected EAS platforms in parallel. Wait for finished builds; verify source/project/app/profile/version/runtime/fingerprint and downloadable artifact bytes. Internal builds never submit. Production submits the exact successful IDs and waits for finished EAS submissions.
5. **Promote and deploy:** after server publication, verify its image and advance the shared `latest` alias. Server and OTA releases call the shared darkmachines webhook over WireGuard. It upgrades only the configured `little-say` Compose service and confirms Docker health. The image's `/api/ready` healthcheck covers database/schema readiness when enabled. The caller requires HTTP 200 and a completed healthy result for `little-say`. An OTA-only release still deploys the current `latest`; native-only releases skip deployment. Compose and its environment remain unchanged.
6. **OTA:** after deployment and required image/build/submission jobs succeed, export each compatible target and upload with `--skip-bundler`. Read back raw update groups and verify source, runtime, environment, destination, embedded identity, and uploaded launch/asset hashes against the export.
7. **Finalize:** read back results and publish `release/<profile>/<run-id>` with schema-1 `receipt.json` (`ReleaseReceipt`). Only published completion records advance baselines. The receipt retains unchanged component references. The candidate draft is removed only after completion readback succeeds. Required deployment failure blocks completion even for a server-only cut.

Image names remain `ghcr.io/<owner>/<repository>:vX.Y.Z`, `:sha-<full-commit>`, and `:latest`, with matching `vX.Y.Z` Git tags. Both Linux architectures and OCI labels are checked. Existing immutable names with conflicting content cause a hard failure. A later completed release or newer prepared server version prevents a stale retry from moving aliases/channels backwards. Deployment follows the configured tag at pull time and confirms readiness, not exact digest/version identity. It does not test proxy/DNS/TLS or external provider availability.

The `latest` alias and running server can advance before native/OTA work finishes. A later failure leaves those changes in place and the candidate recoverable. The existing darkmachines Compose startup command runs application migrations; no automatic server or database rollback is attempted. A timeout or lost webhook response can mean deployment is still running: inspect the shared service before explicitly retrying the original release. The caller never retries POST automatically. See the [deployment guide](../deploy/self-hosted/README.md) for the supplied environment settings, health limits and recovery.

For review or a merge queue whose source remains valid, complete the normal review/merge process and select **Re-run failed jobs on the original run**. Do the same for reconciled provider failures or queued builds that outlive the job's bounded wait. Re-running all jobs also reuses the run's immutable plan. Resume the original run for a recoverable cut instead of dispatching a duplicate release. A moved base or different merged tree is terminal for that immutable plan; do not rerun it.

If Xcode reports that the provisioning profile lacks Sign In with Apple, refresh the selected profile through `credentials:configure-build --platform ios --profile internal` (or `production`) after authenticating with Apple. Preserve the distribution certificate and, for internal distribution, the registered devices. Decline reuse of the stale profile, select the same devices, and verify the regenerated profile contains the entitlement before retrying the failed jobs. Keep the original candidate and successful operations. Changing signing credentials does not require changing the saved source, version, or release plan; disabling the app capability is not a signing repair. See [Expo's capability synchronization guide](https://docs.expo.dev/build-reference/ios-capabilities/).

The pinned EAS 22.4.0 client can fail Apple login with `iTunes service key is empty`; Expo [fixed that authentication failure in 24.4.2](https://github.com/expo/eas-cli/issues/4394). For this credential-only repair, install the exact fixed version into an ignored recovery directory, temporarily allow that version only for the interactive credential command, and restore the environment afterward:

```powershell
# Run from the repository root. This installs a separate credential-repair client.
npm install --prefix artifacts/eas-login-cli --no-save --package-lock=false --ignore-scripts --no-audit --no-fund eas-cli@24.4.2
$previousVersionCheck = $env:EAS_SKIP_CLI_VERSION_CHECK
Push-Location apps/mobile
try {
  $env:EAS_SKIP_CLI_VERSION_CHECK = '1'
  node ../../artifacts/eas-login-cli/node_modules/eas-cli/bin/run credentials:configure-build --platform ios --profile internal
} finally {
  $env:EAS_SKIP_CLI_VERSION_CHECK = $previousVersionCheck
  Pop-Location
}
```

Enter the Apple password and verification code only in the CLI. This command manages credentials; it does not start a build. Release publication continues to use the locked 22.4.0 toolchain and original plan.

Base movement is terminal before the version PR merges, or when it changes the merged tree. Once the exact validated candidate has merged, later default-branch commits alone do not invalidate that source. Its retry still requires source ancestry, unchanged artifacts/environment and no newer completed release; retain this recoverable journal rather than automatically retiring it by age or default-head inequality.

The draft journal uses immutable `plan.json`, `candidate.json`, `prepared.json`, `ota.json`, `receipt.json`, and append-only `op.<key>.<six-digit-sequence>.json` assets. Each operation has its own writer, so parallel platform jobs cannot overwrite each other's evidence. Intent is recorded before a request, its provider ID immediately after acceptance, and verified results before dependent work. Lost build/update responses are reconciled by exact run/source/payload markers; submissions are found on the exact build. Successful operations are never repeated. Partial publication is visible and is not an atomic transaction across providers.

Finalization verifies published OTA metadata and downloads every asset to compare its bytes with the original export hashes retained in the operation receipts. It does not recompile Hermes for this readback: Hermes embeds temporary source filenames in bytecode, so identical JavaScript can produce different binary hashes. Initial OTA publication still compares the uploaded manifest with its validated local export. Completion publishes both `receipt.json` and a full `journal.json` archive before removing the candidate draft, preserving failed-provider and recovery history.

If an older pinned cut published and deployed all artifacts but failed only at finalization, use **Recover release completion** on `master` with its original `run_id`. Leave `apply` false for a read-only audit, then run with `apply` true after that audit succeeds. This workflow shares the release concurrency group and supports only internal server-plus-both-new-native/OTA cuts with no submissions or imported baselines. It requires successful original preparation, server publication/promotion, deployment/readiness, native builds, and OTA jobs; any active cut, missing job proof, unknown journal data, unrecorded provider operation, changed artifact, destination, or environment blocks recovery. It reads both image architectures, all exact build IDs, artifact hashes, and OTA asset bytes, then repeats the journal/job audit before appending `completion-recovery.json` and publishing the original receipt. It does not rebuild, redeploy, republish OTA, change the plan, or advance aliases. The published receipt establishes completion; the original failed workflow can then rerun its finalization job, which recognizes that receipt and performs no provider operations.

If an outcome is **unknown or ambiguous**, the workflow sends no second request. Keep the candidate draft. Inspect its latest operation asset and the EAS dashboard/API (build marker `little-say:<run-id>:build:<platform>`, OTA marker `little-say:<run-id>:ota:<platform>-<runtime>:<payload-hash>`, or submissions attached to the recorded build). Retry after the unique accepted operation becomes visible. If the provider confirms no operation was accepted, an operator can append the next operation asset with `status: "failed"`, preserving all earlier IDs, together with a separate recovery-evidence JSON asset; this explicitly authorizes retry after reconciliation. Never edit/clobber earlier journal assets or mark an existing successful operation failed. Multiple matching operations, changed artifacts, or immutable-tag conflicts require resolving the provider state, not blind uploads.

Terminal stale-source candidates now retire automatically when the workflow can prove publication never started. Preparation rechecks the default branch immediately before requesting a normal merge and retains the exact post-merge tree and metadata guards for a later race. Retirement records its reason and original asset identities in `retirement.json`, then preserves the same draft release and assets under `abandoned/<run-id>`. It closes an open version PR only after checking bot ownership, repository, base, and exact candidate; merged metadata and branches are never reverted or deleted. A verified `retirement-complete.json` receipt makes the abandoned journal nonblocking.

The workflow-wide `little-say-release` concurrency group serializes cuts. A fresh publication run reconciles prior candidates **before planning**, including stale runs whose runner was interrupted before its failure handler ran. Cancellation before a version PR can also be retired. The audit checks every workflow attempt: the run must be terminal, its source/workflow must match, and no provider job may have executed. Prepared state, any operation intent/receipt, partial completion, unknown assets, active runs, and automatic/queued merges remain blocking. Missing success receipts do not establish that nothing was published. Review/check/transport failures with an unchanged base remain retryable rather than expiring by age.

Cleanup writes a durable tombstone before changing the PR or release. Lost responses, failed closure, missing assets, or uncertain readback leave the candidate/abandoned record blocking; a subsequent fresh run rechecks and finishes verified cleanup. Abandoned IDs are rejected before planning or journal creation and cannot be resurrected by the new code. **Never rerun an abandoned historical workflow:** old checkouts do not inherit this safeguard. Do not delete recovery evidence or manually remove the blocker to start a duplicate publication. Ambiguous provider outcomes and expired/unreadable run history still require operator reconciliation.

The investigation on October 10, 2026 found [run 37874954697](https://github.com/MChartier/little-say/actions/runs/37874954697) partially published: server `0.3.0` and Android build `d7f73be2-de65-4016-a0f2-5ec7317905b0` succeeded; iOS build `adde78c5-19e6-40d5-8e58-d3b89abf6d46` failed. On October 12, explicit reconciliation verified the terminal provider outcomes and all workflow attempts, then preserved all 11 original assets in the same draft under `abandoned/37874954697`, with reconciliation and retirement evidence. No completion receipt or baseline was created. Never rerun that abandoned run. [GitHub reruns retain the original source](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs), so it cannot acquire the later iOS source fix.

### Explicit recovery of a terminal partial internal cut

When the remaining native work requires a source fix, the immutable old plan cannot acquire it. `npm run release:reconcile` provides a separate operator path for abandoning that remaining work while preserving successful publications. Automatic preparation still refuses to retire partial publications. Its error identifies the actual blocking journal and run, which may differ from the run currently failing preparation.

The supported scope is deliberately narrow: an internal server-plus-Android/iOS cut with a verified server receipt, terminal recorded builds, and no executed deployment, promotion, OTA, submission, or unknown jobs across **any** attempt. The command verifies journal ownership, original asset identities and hashes, workflow history, the server Git tag, every recorded EAS build's identity/status, marker matches, and absence of submissions. Missing IDs, extra matching builds, active operations, unknown assets, and changed evidence stop recovery. Other partial cuts require separate operator reconciliation.

Keep release dispatches stopped throughout this manual operation. Both preview and apply check for active cuts; this local command does not acquire GitHub's workflow concurrency lock. Install locked root/EAS dependencies and authenticate `gh` and EAS for repository and project reads. GitHub release write access is needed only for apply.

```powershell
$env:GITHUB_REPOSITORY = 'MChartier/little-say'
$reason = 'Abandon remaining internal work so a fresh cut can include the merged iOS pod fix.'
npm run release:reconcile -- --run 37874954697 --reason $reason
# Review artifacts/reconciliation-37874954697.json, then explicitly apply that same evidence.
npm run release:reconcile -- --run 37874954697 --reason $reason --apply
```

Apply repeats the audit and requires it to match the preview. It appends `reconciliation.json`, then a `retirement.json` tombstone with `kind: "reconciled-partial"`, preserves the same draft and every original asset under `abandoned/<run-id>`, and verifies `retirement-complete.json`. If interrupted, repeat the same apply command with the retained evidence; never delete or overwrite assets. Ordinary automatic retirement cannot finish an interrupted partial reconciliation. Successful artifacts, version tags, branches, running servers, and channel mappings are left in place. No provider request, deployment, rollback, or completion receipt is created.

This audit relies on the original successful server job and verified journal receipt to establish its terminal outcome; it does not revalidate GHCR artifact bytes or promote the server. It checks native identity and status without downloading the build again. Future planning must still independently verify any image or explicitly imported native baseline it reuses. The abandoned draft never advances completion baselines. A fresh cut may allocate new native versions; retaining an old build's evidence does not automatically import it as an OTA target.

After confirmed archival, use **Cut release** from current `master`. A recent run that stopped solely at reconciliation, created no candidate, and still pins current `master` can instead rerun its failed jobs. Never rerun the abandoned partial run. The original successful publications remain available for audit.

## Build, install and submit native apps

Native version and runtime live in `native-release.json`, independently of server releases. To allocate the next native version/build numbers, start with a clean committed checkout:

```powershell
npm run release:prepare -- native --bump patch
# Review and commit the version changes, then:
npm run native:build -- --platform android --profile production
npm run native:install -- --platform android --profile production --device DEVICE_SERIAL
npm run native:submit -- --platform android --profile production --dry-run
npm run native:submit -- --platform android --profile production
```

Build never increments versions automatically. Android uses local Gradle with EAS-managed signing and produces both an APK for in-place installation and an AAB for Play from the same source/configuration. Signatures, application ID, and APK versions are checked. `adb install -r` preserves local boards; a signer mismatch is an error, never an uninstall/reinstall fallback. If Play App Signing uses a different app-signing certificate, use the Play internal track to upgrade an existing Play installation rather than sideloading an upload-key APK.

`--profile internal` uses channel `internal` / EAS environment `preview`. `--profile production` uses channel/environment `production`. The production Android submission initially targets a **draft on Play's internal track**, not an automatic public rollout. Adjust the committed submission profile when ready. Play requires an initial manual app/upload setup and an authorized service-account key; EAS Submit prompts for or reuses that credential. Follow [Expo's Android submission setup](https://docs.expo.dev/submit/android/).

On a Mac:

```sh
npm run native:build -- --platform ios --profile production
npm run native:submit -- --platform ios --profile production --dry-run
npm run native:submit -- --platform ios --profile production
```

iOS builds run `eas build --local`. Production IPAs go through EAS Submit to App Store Connect/TestFlight. Complete App Store Connect app setup and Apple credentials; you can set `ascAppId` in the production submission profile to avoid selecting the app each time. An `internal` iOS IPA uses ad hoc signing and cannot be submitted to the store. Install it with Xcode Devices on a registered device; the wrapper's `native:install` currently handles Android only.

Builds, baseline JSON files and receipts are retained under `%LOCALAPPDATA%/little-say` on Windows or `$XDG_CONFIG_HOME/little-say` (default `~/.config/little-say`) elsewhere. They survive `expo prebuild --clean` and worktree cleanup. Copy the entire build directory when transferring it between machines, and pass `--baseline /path/to/baseline.json`. Install/submit require the original clean build commit and verify artifact hashes; they never rebuild or choose an unspecified latest EAS build. EAS submission completion is separate from store processing, approval, availability, and device installation.

## Publish an OTA update locally

Install or distribute a native build containing `expo-updates` first. Expo Go and previous binaries lacking this module are not OTA targets. Start from a clean committed JS change descended from that native build:

```powershell
npm run ota:publish -- --platform android --profile production --message "Improve board editing" --dry-run
npm run ota:publish -- --platform android --profile production --message "Improve board editing"
```

Repeat for `--platform ios` with that platform's retained baseline. Use `--baseline` to select a retained local build or a schema-2 cloud baseline extracted from a completed receipt. Cloud baselines download and verify the exact finished build artifact; local baselines retain file-hash verification. A default baseline records the most recent successful local build; it does **not** prove that a device has installed it.

The wrapper verifies clean source, baseline ancestry, Expo owner/project, server URL, native version/build numbers, channel/environment, retained artifact hashes, and Expo's native fingerprint. It reads the selected EAS environment through the pinned CLI adapter and verifies it matches the build. The environment must be reproducible locally: no unreadable secret or file variables, no backend OpenAI keys, and no `EXPO_PUBLIC_*` URL overrides. The compiled server origin comes from `native-release.json`; parent settings can still override it on a device. Local `.env` files and development API URLs are excluded from native release commands.

A dry run exports the actual JS bundle but neither deploys nor publishes. Real publication requires authenticated `gh` access to the checkout's GitHub repository with Actions read/write permission. It dispatches **Deploy self-hosted server** on the default branch and waits up to 40 minutes for that exact run's success. Failure, cancellation or an unconfirmed result blocks upload. WireGuard and webhook credentials stay in GitHub's environment. Source, EAS environment and channel are rechecked after deployment; then publication uploads the already exported bundle, verifies the raw group's payload/platform/runtime/source/destination, and saves a receipt. Local and CI OTA share fingerprint and baseline validation: only target version fields can be overlaid, and the full native fingerprint must match. Changed native dependencies, plugins, permissions, or selected native configuration require a new build. Committed runtime retirements apply to local OTA too.

Native updates check/download on launch and apply on a subsequent launch, without forcing a reload during a child's board session. A successful publication does not prove that a specific device has downloaded or applied it. Validate the actual target device after reopening the app.

## Deploy the server from your machine

For routine manual upgrades through the shared service, dispatch **Deploy self-hosted server**. The optional explicit digest deployment below is independent of the webhook path and retains its existing rollback behavior.

Docker Compose v2 and a Docker context targeting the server are required. For an SSH host, create the context locally (the host needs Docker and your SSH key access):

```powershell
docker context create little-say-host --docker host=ssh://USER@HOST
npm run server:configure -- --context little-say-host --image ghcr.io/OWNER/REPO --server-url https://YOUR_SERVER --env-file C:/PRIVATE/little-say-server.env
npm run server:deploy -- --digest sha256:DIGEST_FROM_GITHUB_SUMMARY --version 0.1.1 --dry-run
npm run server:deploy -- --digest sha256:DIGEST_FROM_GITHUB_SUMMARY --version 0.1.1
```

For a local Docker engine, use `--context default`. The external environment file contains `AAC_OPENAI_KEY` (or `OPENAI_API_KEY`), `ALLOWED_ORIGINS=https://YOUR_SERVER`, and any model settings from `.env.example`. Docker binds to `127.0.0.1:8787` by default for a reverse proxy; use `BIND_ADDRESS`/`PORT` only as needed. Authenticate the local Docker client to GHCR if the package is private. The local Compose client reads the external env file and sends the service configuration to the selected Docker engine; no secret files enter Git or the image.

For an existing Compose deployment, set `--project` to its existing project name so its `<project>_speech-cache` volume is reused. The default is `little-say`. This command never removes volumes. It pulls by immutable digest, checks image version/revision labels, replaces only the service, waits for container health, and verifies `/api/health` through the configured server origin. On failure it restores the previous image when one exists; it does not roll back edits to the external environment file. First-deployment failures remain available for inspection. Successful image publication, container deployment, and external health verification are distinct events.

## Validation and limits

`npm run check` validates version mirrors, TypeScript, unit/regression tests, server build and web export. `npm run test:integration` requires a disposable PostgreSQL test database; CI supplies one. Release tests cover detection, lockfile resolution, version-only transitions, the two-input dispatch contract, all three version increments, historical forced-plan compatibility, protected merge recovery, provider timeouts/ambiguity, exact submissions, payload integrity, runtime retirement, and durable journal immutability. The fingerprint tests execute the real Expo implementation. Workflow validation must also pass `actionlint`; check file headers and public-function JSDoc when changing release tooling. See [the implementation map](../scripts/release/README.md).

After onboarding, record evidence from an internal cut, a compatible JavaScript-only OTA cut, an automatic no-change cut, and a combined cut when real changes require multiple artifacts. Resolve any existing partial-release blocker first. Verify image digests, finished Android/iOS IDs, supported-runtime update groups, and unchanged/allocated versions in their receipts. Validate production exact-ID submissions separately once store credentials are configured. These are real publishing operations, not unit tests; credentials, signing, store processing, actual devices, and deployment cannot be proven by local checks alone.
