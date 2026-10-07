# Issue 28 investigation checkpoint

Owner: Codex task 01a111cd-7184-7671-9c7b-1e95a7719032. Retention: keep this nonmerged evidence ref for the lifetime of issue 28 and its reviews; coordinator owns future retention decisions. Never merge this evidence branch into the product.

## Finding and limits

The reported post-completion hang was NOT reproduced. This checkpoint fixes a separately evidenced native error-routing defect within the requested investigation: expo-audio 57.0.5 emits `AudioStatus.error`, whereas the adapter tested `playbackState === 'error'`. Android maps native states to ready/buffering/idle/ended/unknown and merges an error string into status. iOS maps a failed player to `failed` and also emits an error string. The adapter now handles that field immediately through existing speech fallback. No timeout or queue-policy change was made. Relevant package source bytes and tarball integrity are bound in manifest.json; install exactly package-lock.json at the product source revision to inspect them.

Full target/master and merge-base: 1f0329052bd46b1e953c5adb5ad7e59ba2f2dcc4. Product head: c3bc7b2777708e8c79f15f530a42b0c89fb48271. No parent PR or stack dependency. The entire proposed history is one commit with three files, listed in commits.txt and changed-files.txt. The native adapter is the product fix; its new maintained test verifies terminal/error/cancel boundaries; the existing browser test now verifies real ended events, idle indicator, repeat and other-card playback. No PlayBoard, grid, editor or shared queue file changed.

## Reproduction and checks

- `native-baseline-final-tests.txt`: final audioPlayback.test.ts copied as a test-only overlay into a detached worktree at the exact baseline. Production files unchanged. Dependency directory junction points to the implementation checkout's pinned npm-ci install; shared core production source is identical in both trees. Run from implementation root: `node node_modules/vitest/vitest.mjs run --root ../little-say-baseline apps/mobile/src/services/audioPlayback.test.ts --reporter=verbose`. Three native error-path tests fail, normal completion and late-cancellation tests pass. The third failure is an absent fallback callback, not a native-device crash.
- `native-after.txt`: `npx vitest run apps/mobile/src/services/audioPlayback.test.ts apps/mobile/src/services/hybridSpeech.test.ts packages/core/src/interaction.test.ts --reporter=verbose`: 27 passed after fix. Expo player/status callbacks and system TTS are mocks; these are deterministic adapter/queue contract tests, not physical playback.
- `check.txt`: `npm run check`: release mirrors, types, 215 tests and server/web build pass. This run preceded addition of one further native double-failure test. Final focused tests (27) and `typecheck-final.txt` include that added test. CI must verify the final complete suite.
- `browser-final.txt`: `npx playwright test --config artifacts/playback/playwright.config.ts tests/web/speech.spec.ts`: two passed in installed Chrome using isolated loopback port 4188. Config retained here; place it at the recorded relative path to rerun. No live AI/provider calls. Saved audio uses a real 0.5-second synthetic WAV via HTMLMediaElement; system TTS is stubbed. The test observes real ended events and idle UI before same/other-card playback. Background preparation may legitimately have cached the other card; the test validates that source or the expected fallback. This is functional browser evidence, not an auditory human assessment or native reproduction.

The unchanged baseline browser suite also passed in installed Chrome before assertions were strengthened. Initial Playwright launch lacked its bundled Chromium; installed Chrome was used without installing browsers. One intermediate strengthened test wrongly assumed the other card was uncached; that fixture assumption was corrected, with no production browser changes. No passing native-device or iOS check is claimed.

## UI evidence remains incomplete

There is no genuine matched native Before/After pair: adb reported no attached devices, and Windows provides no iOS runtime. No app/device installation was performed. Browser output is unchanged by this native adapter fix and cannot substitute for evidence of the native changed state. Do not treat this as a non-UI exception or apply a baseline waiver. The general GitHub rendered-image-page waiver does not waive actual captures or independent pixel QA. Issue 28 remains open. Need an authorized native runtime and the reported platform/build/audio source to verify the original hang and capture native recovery. No screenshots were manufactured.

## Policy

workflow-v3 execution f0919b184b6344d6279178b2388190936ca432a9; pr-review-v3 / queue-v1 correction 97e5583c8355f3673aad0835c0ce3ca1486aeb8b; supplied direct amendments govern. No readiness, merge, release or deployment asserted. Existing layout issue 31 remains separately owned.
