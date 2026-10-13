# Android safe-area evidence for PR #59

Source comparison: base `7b718764bc865ca0ed102e68f68bc675d1000898` to PR head `bc0d642dc5fb2edee02330a4d19899e6bf761ce3`. Captured 2026-10-13 UTC. These files are retained on a separate evidence ref, outside the product branch.

## Android comparison

Pixel_10 Android 16 / API 36 emulator, x86_64, 1080 × 2424 portrait and 2424 × 1080 landscape. App `net.darkmachines.littlesay`, version 0.1.3 (4). Both builds use the same generated native project and debug signing with embedded production JavaScript (`--dev false`); they are not distribution builds. The synthetic fixture is an English guest with setup complete and an empty local library. No account or AI-generated content was used.

Each `build.json` records the source commit, JavaScript SHA-256 and APK SHA-256. Each screenshot has a matching UI hierarchy (`.xml`) and measured button bounds plus Android window insets (`.json`). Pixels are unedited captures from `adb exec-out screencap -p`.

| Scenario | Base | PR head |
| --- | --- | --- |
| Portrait, gesture navigation | [Screenshot](baseline/settings-gesture.png) | [Screenshot](head/settings-gesture.png) |
| Portrait, three-button navigation | [Screenshot](baseline/settings-threebutton.png) | [Screenshot](head/settings-threebutton.png) |
| Rotate the open dialog to landscape | [Screenshot](baseline/settings-landscape.png) | [Screenshot](head/settings-landscape.png) |
| Return to portrait and open account navigation | [Screenshot](baseline/account-threebutton.png) | [Screenshot](head/account-threebutton.png) |

Portrait status/cutout ends at y=142. The base Close hit area starts at y=129, overlapping it by 13 pixels; the head starts at y=240. With three-button navigation, the system bar starts at y=2298. The base Save hit area ends at y=2306, overlapping it by 8 pixels; the head ends at y=2212. Switching the open head dialog from gesture to three-button navigation moves Save from y=2274 to y=2212. In landscape, the status bar ends at y=137, the cutout occupies x=0..142, and navigation occupies x=2298..2424. Head Close and Save remain inside that safe rectangle. Account Back remains at y=176..307 on both builds, confirming no doubled top padding in this fixture.

## Reproduction

At the PR head, run `npm ci`, then generate the native project with `npx expo prebuild --platform android --no-install` from `apps/mobile`. The build harness temporarily substitutes the three changed runtime files with their exact base bytes for the baseline export and restores them in `finally`; all other production source is identical between these commits. The baseline ref used for these captures was `origin/master` at the base SHA above. Pin that ref before reproducing, or change the helper to use the recorded SHA if master has moved.

Run the retained helpers from the repository root after placing them at `artifacts/safe-area/`:

```powershell
node artifacts/safe-area/bundle-review.mjs baseline
# From apps/mobile/android, with ANDROID_HOME and JAVA_HOME configured:
.\gradlew.bat :app:assembleDebug '-PreactNativeArchitectures=x86_64' '-Pkotlin.compiler.execution.strategy=in-process' --max-workers=2 --no-daemon --console=plain --quiet
# Back at the repository root, with the synthetic guest setup complete:
node artifacts/safe-area/capture-review.mjs baseline
node artifacts/safe-area/bundle-review.mjs head
# Repeat the same Gradle command, then:
node artifacts/safe-area/capture-review.mjs head
```

The capture helper targets `emulator-5554`, derives taps from the live UI hierarchy, changes navigation mode and rotation while the dialog is open, and restores the emulator's original navigation/rotation settings. It installs only into the emulator. No APK is retained in this evidence ref.

## Validation and review

[CI run 38339235776](https://github.com/MChartier/little-say/actions/runs/38339235776) passed on this PR head: release mirrors, TypeScript, all 537 unit tests, server/web production builds, 25 PostgreSQL/Firebase integration tests, all 3 safe-area browser tests, and all 5 account browser tests.

The local full guest browser run passed 119/125. The following six failures were separately reproduced against the base production web UI with the same assertions:

| Existing test | Failure on both base and head |
| --- | --- |
| `recents.spec.ts:37`, recent play order | Keyboard unlock remained “Hold to unlock” instead of “Release to edit”. |
| `recents.spec.ts:102`, favorites order | Same keyboard-unlock assertion. |
| `translationEditing.spec.ts:92`, empty manual corrections | Immediate reload retained the prior Russian translation instead of corrected values. |
| `translationEditing.spec.ts:92`, empty legacy corrections | Same persisted-translation assertion. |
| `translationEditing.spec.ts:126`, newly corrected generated translation collision | Immediate reload retained the prior Spanish translation. |
| `translationEditing.spec.ts:126`, new translation collision | Immediate reload did not contain the new Spanish translation. |

These are recorded as baseline failures, not green tests. The new long-dialog safe-area test failed against base and passed against head. The final head web artifact was rebuilt after the baseline comparison and all three safe-area tests passed again. Browser safe-area coverage includes changing insets, rotating an open dialog, scrolling to its final field, saving, outside dismissal, account/setup and play-control bounds. The complete guest run also covered existing modal dismissal and settings/account draft preservation scenarios.

Code review covered all eight changed files, modal window ownership, dynamic insets, fixed action reachability, backdrop hit testing, account navigation lifecycle, portable browser speech fixtures, OTA component-test isolation, documentation and release policy. No remaining actionable finding was identified in this change. There is no independent human approval yet. Release versions and dependencies are unchanged; generated native projects and this evidence are excluded from the product diff.

Limits: this is Android emulator and browser evidence. Physical Android, signed release, native iOS, and deployment validation were not performed. Android account screenshots are a regression check; the reproduced overlap is in shared dialogs. The retained browser tests exercise native-equivalent layout constraints but do not replace device validation.
