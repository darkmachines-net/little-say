# Releases

Little Say consumes the pinned `@mchartier/expo-release` pipeline. `release.config.json` is the application contract; the package and reusable-workflow callers must pin the same full Git commit. Use Node 24 and `npm ci` to install the shared CLI and locked EAS tooling. No separate EAS installation or engine synchronization is needed.

## Commands

Start from a clean committed checkout with GitHub CLI authentication. Planning reads release history and EAS public inputs without publication. Source validation needs the disposable PostgreSQL/Firebase services described in [testing](testing.md).

```sh
npm run release -- validate
npm run release -- validate --source
npm run release -- plan --profile internal
npm run release -- run
npm run release -- status
npm run release -- status --release-id RELEASE_ID
```

`validate` checks configuration, version mirrors and toolkit pins. `--source` additionally runs `npm run check` and the service integration suite. `plan` writes `.release/plan.json`; `run` dispatches that exact request through Actions. Use `--profile production` and `--bump patch|minor|major` when planning to choose distribution and version increment.

**Release request** records an unprivileged request. **Handle release request** independently verifies its original default-branch run and toolkit, prepares the candidate and performs shared stages. Required review, branch protections and environment approvals remain authoritative. The local CLI cannot bypass them.

Explicit operations use the same interface:

```sh
npm run release -- plan --operation ota --targets android.ota --profile internal
npm run release -- plan --operation build --targets android --profile internal
npm run release -- plan --operation submit --release-id RELEASE_ID --targets android
npm run release -- plan --operation deploy --release-id RELEASE_ID
npm run release -- plan --operation promote --release-id RELEASE_ID --targets server
npm run release -- run
```

Run the desired plan before creating another; each `plan` command replaces the local proposal. Submission, promotion and deployment require finalized hosted release evidence and create a separate protected operation. They retain the original artifact producer, allocate no versions and do not advance build baselines. Developer setup and device installation remain separate. This interface replaces the previous `release:*`, `native:build`, `native:submit`, `ota:publish` and `server:*` aliases.

## Application behavior

Server/web, Android native, iOS native and each platform's JavaScript inputs are compared independently. Only selected native build counters advance; native semantic versions remain shared. Internal and production client histories stay separate, while server image history is global.

Hosted native builds remain EAS cloud builds. Runtimes remain **appVersion**; this adoption does not migrate installed apps to fingerprint runtimes. Full fingerprints still guard compatibility. Environment-only changes require native builds without adding unchanged OTA publications. Retained-runtime exports use the exact baseline's version metadata, including unchanged platforms and eligible older runtimes. `release-policy.json` retains imported cloud baselines and explicitly retired runtimes.

Selected server or OTA work retains the existing self-hosted deployment prerequisite. Native-only and no-op releases skip deployment. Server publication/promotion precede deployment. Production submissions retain exact artifact/destination identity; acceptance differs from completion. OTA requires verified retained export bytes and the supported native handoff prerequisite. Final success requires all selected stages.

## EAS and signing

`native-release.json` owns the Expo project, owner, server origin and native counters. `apps/mobile/eas.json` defines build profiles and destinations. Production iOS submission requires explicit App Store Connect `ascAppId`. Required Apple sign-in entitlements are checked in the selected unexpired provisioning profile. Android keeps its existing default EAS key.

Repository `EXPO_TOKEN` authorizes shared EAS jobs. Remote variables must be reproducible readable strings with public names declared in `release.config.json`. Backend credentials and executable process overrides are rejected. The declared Google iOS URL scheme may be supplied through EAS.

Source installation, inspection, validation and exports receive no publication credentials. OTA/store publishers use verified retained files and data-only Expo configuration. EAS cloud builds necessarily evaluate authenticated app configuration; that existing boundary remains. New durable receipts omit temporary signed download URLs.

## Local builds and devices

Android requires a JDK, Android SDK Build Tools and `ANDROID_HOME` or `ANDROID_SDK_ROOT`. Local iOS requires macOS, Xcode and CocoaPods. Setup checks use the package's pinned EAS executable:

```sh
npm run native:setup -- --login
npm run native:configure
npm run release -- plan --operation build --targets android --profile internal
npm run release -- run --local
npm run native:install -- --receipt .release/artifacts-PLAN_DIGEST.json --device DEVICE_SERIAL
```

`native:configure` downloads the exact project's default Android key outside the repository. Alternatively use `--credentials C:/PRIVATE/credentials.json` with an absolute external keystore path. Existing `native.json` credential paths remain readable; a fresh configure writes the shared settings format. Prebuild runs before Gradle receives signing material. APK/AAB signatures and app versions are verified. `adb install -r` preserves data; the installed version is read back.

On macOS, use `native:setup -- --platform ios` and plan target `ios`. The shared runner invokes EAS `--local`; only that invocation receives Expo authentication. The credential-free IPA verifier checks bundle/version/runtime/channel identity. Install internal IPAs through Xcode on registered devices. Local receipts retain explicit local origin and cannot become protected hosted provenance. Store/OTA publication dispatches through Actions.

## Recovery and evidence

```sh
npm run release -- recover --release-id RELEASE_ID
npm run release -- recover --release-id RELEASE_ID --resume
npm run release -- recover --release-id RELEASE_ID --retry --stage android:submit
npm run release -- recover --release-id RELEASE_ID --reconcile reviewed-evidence.json
npm run release -- recover --release-id RELEASE_ID --complete
npm run release -- recover --release-id RELEASE_ID --abandon --reason 'Retire this attempt after verified terminal provider outcomes.'
```

Inspection is read-only. Mutation requires one explicit action and a protected hosted request. GitHub Releases are the durable ledger; caches are not another publication history. Intents precede requests and accepted IDs precede readback. A lost response or empty search cannot authorize duplicate uploads. Provider-supported submission retries reverify the exact failed request, destination, original build and bytes immediately before mutation.

Shared compatibility readers preserve historical `candidate/`, `release/` and `abandoned/` plans, workflow identities, IDs, artifacts and reservations. Successful independent operations survive recovery; ambiguous evidence remains blocking. Historical finalization/reconciliation must satisfy the original workflow and live provider contract. Do not edit or delete journal assets to unblock a release. Abandonment preserves reservations and successful artifacts without claiming completion; later source fixes need another plan.

Historical continuation selects one original stage with `--resume --stage submit-android`, `submit-ios`, `promote-server`, `deploy`, or `ota`. Each uses its own credential boundary. `ota` only finalizes a complete inventory of already verified original publications. Missing original fingerprints or payload receipts remain blocking. A failed or timed-out deployment does not authorize another POST without reconciliation.

The deployment webhook's healthy response is health evidence, not an exact deployed image digest. Store processing/review, public rollout, device installation and OTA uptake remain separate from pipeline completion. See [private deployment settings](../deploy/self-hosted/README.md).
