## Summary

Parents currently reach a “Leave this board?” confirmation after an intentional hold, and dashboard-started or resumed play can return to the dashboard instead of the editor. This opens the same board's existing editor directly, animates its cards into the responsive preview, and provides **Return to play** with accepted edits and idle audio. The existing two-second threshold is preserved; accidental/interrupted input does not unlock.

Closes #30. **Review #34 first:** this draft targets `feat/balanced-storyboard-grid` at `b21d3ba7370c08468b868385ce9df3d875eee799`. Ultimate target: master `1f0329052bd46b1e953c5adb5ad7e59ba2f2dcc4`. Parent changes require coordinated revalidation. Independent account PR #29 and audio PR #33 are excluded.

## Test plan and behavior evidence

| Scenario | Intended and observed result at `7e8ab5993503419e5945c8f304ffab3a6fc91f56` | Evidence |
| --- | --- | --- |
| Hold for two seconds and release from dashboard-started or resumed play | Same-board editor opens once without a dialog; measured cards shrink while existing controls are enabled. Wide preview sits beside controls; narrow/short layouts remain scrollable. | Matched screenshots below; [actual motion recording](https://github.com/MChartier/little-say/blob/e4eb01aa9a31ad4c288c9268af9cd6ee4dd4d59a/after-wide-motion.webm); intermediate-frame and responsive browser checks. |
| Release early/outside, add a contact, blur/background, or use keyboard/assistive input | The 1,999 ms release fails; 2,000 ms ready release succeeds. Interruption cancels. Keyboard repeats do not accumulate time; assistive activation starts a cancellable two-second countdown. Focus lands on non-editable headings; reduced motion/resize settles safely. | Nine native-component unit tests with mocked events plus browser pointer, keyboard, assistive-event and motion checks. These are not native screen-reader execution. |
| Edit, open card/AI drafts, return during pending/failed saves, or leave active/pending speech | Existing draft/consent/voice guards remain; board identity/content and chosen play language persist. Failed writes retain visible edits and retry. Pending return prevents competing edits. Return starts idle, and late speech completion cannot restart the queue. | [19 passing current-head browser checks](https://github.com/MChartier/little-say/blob/e4eb01aa9a31ad4c288c9268af9cd6ee4dd4d59a/validation/browser-head.log), including injected storage failures and synthetic speech. |

### Before / After UI evidence

Same synthetic four-card board and action: a 2.1-second hold followed by release. **Before:** actual pinned parent `b21d3ba7370c08468b868385ce9df3d875eee799`. **After:** final source `7e8ab5993503419e5945c8f304ffab3a6fc91f56`. Edge 154.0.4258.62 on Windows, light theme, scale 1, matched viewport/fixture; controlled advancing clock, synthetic speech, normalized fullscreen and blocked service workers on both sides. No image editing.

At 1180×820, the extra confirmation becomes the existing editor with its side preview and actions:

| Before | After |
| --- | --- |
| ![Before: confirmation after the hold at 1180 by 820](https://github.com/MChartier/little-say/blob/e4eb01aa9a31ad4c288c9268af9cd6ee4dd4d59a/before-wide-hold-release.png?raw=true) | ![After: same board editor and return action at 1180 by 820](https://github.com/MChartier/little-say/blob/e4eb01aa9a31ad4c288c9268af9cd6ee4dd4d59a/after-wide-hold-release.png?raw=true) |

At 390×844, the same direct handoff stacks the readable preview above the existing controls:

| Before | After |
| --- | --- |
| ![Before: phone confirmation after the hold](https://github.com/MChartier/little-say/blob/e4eb01aa9a31ad4c288c9268af9cd6ee4dd4d59a/before-portrait-hold-release.png?raw=true) | ![After: phone editor with direct return to play](https://github.com/MChartier/little-say/blob/e4eb01aa9a31ad4c288c9268af9cd6ee4dd4d59a/after-portrait-hold-release.png?raw=true) |

[Exact source/build/fixture/capture provenance, originals, short-landscape pair and returned-idle views](https://github.com/MChartier/little-say/blob/e4eb01aa9a31ad4c288c9268af9cd6ee4dd4d59a/README.md). Manifest SHA-256: `b2bb771301b2b907748ae92b808e73dc767d4fcffc6df3e324bdff2f50160796`; the linked commit binds its harness and all image/build identities. The implementer inspected genuine pixels and motion; independent inspection remains required.

## Supporting checks and limitations

225 unit tests, 19 affected browser scenarios, typecheck, release-metadata validation, web build and iOS/Android bundle exports pass. [CI passed at the final head](https://github.com/MChartier/little-say/actions/runs/37567933495). [Codex engineering review completed at the final head](https://github.com/MChartier/little-say/pull/36#issuecomment-6030553625), reporting no major issues; current submitted reviews and inline threads contain no findings. The full child scope is one commit, nine product files and four maintained test files; [complete inventory](https://github.com/MChartier/little-say/blob/e4eb01aa9a31ad4c288c9268af9cd6ee4dd4d59a/source-scope.json). Evidence and build outputs are retained on a separate non-merged ref. No packages added.

**Not ready:** independent QA is pending. Native rotation, OS text scaling, VoiceOver and TalkBack are unexecuted; bundle export is not native execution. Parent #34 remains evidence-incomplete, and no native deferral is assumed. This does not reproduce or fix the separate iPad Expo Go audio-completion hang. Actual GitHub image-page rendering uses the [explicit human waiver](https://github.com/MChartier/calibrate-health/issues/405#issuecomment-6022754087); it is not claimed as performed. Genuine matched captures and independent provenance/pixel checks remain required.
