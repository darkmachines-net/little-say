# Manual OTA update settings — review evidence

These are unedited screenshots of the actual `ParentSettings` and `AppUpdateSettings` components rendered with React Native Web in Microsoft Edge. They are **browser UI fixtures, not screenshots from Android or iOS runtimes**. OTA responses, account data, storage, and reload are simulated. No OTA was published, downloaded from Expo, or installed during this capture.

Source: `929321bbba82c93b8cc1f0d7539fb5277d1c778f`. Baseline: `b394f50e35771aa7494058c24f5705486717ff8b`. Only the baseline `ParentSettings.tsx` is substituted for the before capture; the other rendered components are identical. The phone viewport is 390 × 844, the tablet is 820 × 1180, and device pixel ratio is 1. `Platform.OS` is adapted to exercise Android or iOS conditional content. The standard React Native Web renderer and SVG web implementation draw the components.

The capture script navigates to the settings section and clicks the real button. The success fixture checks the sequence `check → fetch → save → reload-requested` and verifies that the real settings callback trims the server URL before persisting. Reload is recorded and left pending so its UI can be captured. External requests are blocked. No private boards, accounts, or user data are used.

All nine original images were opened and visually inspected by the implementing agent: the new section, button, status messages, error notice, and fixed Save settings footer are readable. This is implementer inspection, not independent QA.

| Screenshot | Scenario |
| --- | --- |
| [Before](screenshots/before-android-phone.png) | Baseline settings at the insertion point |
| [After](screenshots/after-android-phone-idle.png) | New check action and restart explanation |
| [Checking](screenshots/after-android-phone-checking.png) | Busy, disabled button |
| [Downloading](screenshots/after-android-phone-downloading.png) | Busy download feedback |
| [Up to date](screenshots/after-android-phone-up-to-date.png) | No-update response |
| [Error](screenshots/after-android-phone-error.png) | Failed check and retry action |
| [Restart](screenshots/after-android-phone-restart.png) | Save completed before simulated reload |
| [Unavailable](screenshots/after-android-phone-disabled.png) | Updates disabled in this build |
| [Tablet](screenshots/after-ios-tablet-idle.png) | iOS conditional content at tablet width |

`manifest.json` records source, bundle, and image hashes, browser version, capture time, viewport dimensions, and fixture call traces. `builds/` retains the exact browser fixture output. `capture.mjs` and `fixture.tsx` reproduce the capture with the matching repository dependencies:

```powershell
node capture.mjs C:/path/to/source-checkout C:/path/to/dependency-checkout
```

The dependency checkout provides `node_modules` and `apps/mobile/node_modules`. The source checkout must be at the recorded source commit with `origin/master` at the recorded baseline. This run reused the existing installation. Its lockfile differs from the PR base in workspace version numbers and an additional direct `@expo/plist` development dependency declaration; the resolved package entries are unchanged. The PR itself does not change dependencies.

Validation logs in `validation/` retain the original full-check result and retry. Release metadata and full TypeScript checks passed. The default unit run passed 478 tests and timed out in two existing Git-based release-planner cases at 10 seconds; all 24 planner tests then passed with a 30-second timeout and one worker. Server and production web builds passed separately. Native platform export results are retained alongside those logs.

Live native layout, accessibility behavior, and real OTA installation on a release device remain unverified. No Android SDK/emulator was available on this machine. These screenshots support UI review and simulated control-flow review only. This evidence branch is separate from the product PR and should not be merged into the app.
