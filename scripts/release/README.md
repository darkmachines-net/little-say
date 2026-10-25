# Release integration

The protected [Release workflow](../../.github/workflows/release.yml) invokes the shared Expo release toolkit. [release.config.json](../../release.config.json) owns application identities, source boundaries, destinations, profiles, and version floors. The package and reusable workflow must reference the same reviewed full toolkit SHA; use the toolkit's `scripts/sync-engine.mjs` pin updater to update both references and regenerate locks without copying implementation snapshots.

`hooks.mjs` owns only application-specific behavior: `identity` hashes tracked inputs while excluding tests, Markdown, other-platform files, and allocated versions; `stamp` mirrors allocated versions into declared metadata; `applicationHook` dispatches inspection, stamping, script type validation, and isolated server health/version checks. Lifecycle, providers, approval, persistence, and uncertain-outcome handling belong to the shared toolkit.

## Preview and execution

Install with `npm ci`, then use the read-only CLI:

```sh
npm run release -- validate
npm run release -- plan --profile production
```

GitHub owns execution and approvals. Dispatch **Release** from the protected default branch, selecting `internal` or `production` and optionally a compatible rebuild. The hosted workflow installs the official EAS CLI version pinned by [eas.json](../../apps/mobile/eas.json). Android and iOS use EAS cloud builds, one mobile semantic version, independent managed build counters, and the existing application/project identities. Both profiles build store-distributable binaries and submit selected native releases through EAS; there is no direct-install release profile.

`internal` delivers an Android AAB to Play's **internal testing** track with release status **completed**, and an iOS store-signed build to **TestFlight** for Apple ID `6826487372`. It retains the `internal` OTA channel, EAS `preview` environment and GitHub `internal` approval gate. `production` retains its configured Play internal-track draft and App Store Connect destination. Store review and public rollout remain store operations. OTA-only releases publish updates without resubmitting binaries.

| Source change or request | Mobile version and delivery |
| --- | --- |
| Native fingerprint change | New major runtime and builds for every enabled platform |
| Compatible rebuild | New minor, compatible binaries, and same-runtime OTA |
| JavaScript/assets change | Patch OTA within the current major runtime |

Expo runtime is the explicit mobile major. Binaries sharing that major remain eligible; distinct older runtimes receive no automatic backports. [fingerprint.config.js](../../apps/mobile/fingerprint.config.js) retains strict native compatibility checks while excluding allocated version fields. Server inputs use a separate patch version and successful-deployment baseline.

Versions are stamped into a tagged child build commit; default-branch files are not bumped. Failed reservations consume their numbers. Source checks, Docker production builds, and OTA export have no publishing credentials. Selected server deployment must succeed before native delivery and OTA publication; the [deployment module](../../deploy/self-hosted/README.md) owns the webhook and WireGuard contract.

## Provider setup and runtime transition

Preserve the configured application/project IDs, channels, signing/submission credentials, webhook destination, and WireGuard peer. GitHub `internal` and `production` environments must restrict deployment branches to `master` and require the intended reviewers. Their EAS environments are `preview` and `production`. Deployment credentials remain in the protected `self-hosted-testing` environment.

Expo operations use `EXPO_TOKEN`. Ordinary EAS builds use managed signing credentials. Configure store signing/provisioning and assign the app's Google Play service-account key and App Store Connect API key in EAS before running noninteractive submission. Build-signing and store-submission credentials are separate. The shared workflow's Android signing secret names, where required, are `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Public EAS inputs must be declared readable strings.

Manage tester membership in the stores: Play internal testers must join the configured tester list and opt in. In App Store Connect, create a TestFlight internal group with [automatic distribution](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/) and invite the intended team members. The toolkit uploads builds but does not create groups or invite testers. Testers outside the App Store Connect team require an [external group and TestFlight review](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/); submission success alone does not establish tester availability. Complete any store-required processing or export-compliance information.

Before the first release under the major-runtime policy, verify EAS-managed Android `versionCode` and iOS `buildNumber` meet the configured floors. Retain higher provider/store counters; missing or lower counters block preflight. The semantic and build-number floors live in `release.config.json`. Counter setup does not build or submit an application. Preserve both profiles' iOS submission targets in `apps/mobile/eas.json`. Build distribution is part of the native fingerprint: switching from direct-install to store binaries establishes a new major runtime and requires fresh native builds.

Existing plans, receipts, pending requests, and old runtime baselines are not imported. Existing installations need a new native binary before receiving OTA updates under this policy. Before dispatch, verify the repository has Actions write access to the configured GHCR image and the deployer pulls that image; a repository transfer does not authorize changing the image destination. A human performs the first release and verifies real native installation, store handoff where applicable, and server health.

## Fresh releases after failure and validation

After fixing a failed job, use **Re-run failed jobs**. The shared toolkit retains the original plan and versions, restores completed artifacts, reconnects to accepted EAS builds and skips confirmed submissions or other provider operations. Android and iOS successes are recorded independently. A lost acknowledgement without a durable receipt can still cause redundant delivery on an explicit retry. A fresh dispatch also remains available without cleaning deployment records; prior reservations remain consumed. See [toolkit workflow operations](https://github.com/darkmachines-net/expo-release-template/blob/main/.github/workflows/README.md#immutable-evidence-and-job-retries) for the retry contract. Existing runs retain their original toolkit pin; the updated behavior starts with a new dispatch after this change is merged.

Use EAS/store tooling for store review and later promotions. The integration has no candidate/version PRs, local release wrappers, retained-artifact commands, history imports, or replay CLI. Do not add consumer lifecycle or recovery implementations.
