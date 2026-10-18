# Little Say release hooks

`release.config.json` declares components, version mappings, EAS profiles, store destinations, runtime policy and deployment settings. `@mchartier/expo-release` owns the CLI, selection, version reservations, candidate lifecycle, provider operations, retention, journals, recovery and reusable workflows. Its package and workflow references pin the same full commit; there is no copied engine or separate EAS installation.

| File | Application responsibility |
| --- | --- |
| `hooks.ts` | JSON protocol for source inspection, validation and Expo export |
| `app-inputs.ts` | Platform/web input exclusions and workspace dependency closure |
| `fingerprint.ts` | Real Expo fingerprint using the application's native policy |
| `local-native.ts` | Generated Android Gradle build and APK/AAB/IPA identity checks |
| `verify-android.ts`, `verify-ios.ts` | Application identity, signing and embedded release checks |
| `native-tools.ts` | Developer tool checks, external signing setup and in-place APK installation |
| `source-common.ts` | Source-tool I/O; hook logs use stderr |

Hooks accept one versioned JSON request on stdin and return one JSON result on stdout. They do not journal, retry, publish OTA, submit stores or deploy. Hosted native targets use EAS cloud builds; explicit local builders select command Android builds or the shared macOS EAS invocation. Android `prepare` generates source before the shared runner admits external signing inputs to `compile`. Canonical local receipts drive device installation. Source hooks exclude inherited publication credentials. EAS cloud builds and macOS EAS local builds retain their authenticated app-configuration evaluation boundary.

The fingerprint policy explicitly uses the `strict` preset. SDK 58 defaults to `balanced`, which omits version fields and hashes native dependencies by package identity; our release gate retains full native source/configuration sensitivity.

Native runtimes remain `appVersion`. Normalized fingerprints are selection inputs; full fingerprints prove native compatibility. Retained-runtime exports overlay only the original three version fields through `apps/mobile/release-metadata.cjs`. The shared runner checks ancestry, environment, full fingerprint and explicit retirement policy. A new Android build does not authorize changing an unchanged iOS runtime.

`hooks.test.ts` exercises the real application configuration against shared planner scenarios. Fingerprint and pod tests exercise Expo itself. Generic journal/provider/recovery tests live upstream. See [release operations](../../docs/releases.md) and [deployment settings](../../deploy/self-hosted/README.md).
