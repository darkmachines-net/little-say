## Summary

Parents correcting translated cards could choose Russian for speech while the board preview and primary card fields still showed English. Separate translation fields existed lower in the card dialog, making the selected language hard to follow.

Both editors now expose an editing-language choice and show that variant's label and spoken words in their main controls. Corrections survive language switches and saving without replacing source English or other languages. Saved corrections are protected from automatic replacement; source changes retain them for review. AI cannot change a card's source language to hide a protected translation. Preview and generated audio follow the exact displayed spoken text and language, including delayed responses and retries.

Closes #32.

**Stack: #34 → #36 → this PR.** Targets `feat/direct-board-editor-issue30`, pinned parent `7e8ab5993503419e5945c8f304ffab3a6fc91f56`. This child is not independently mergeable. Implementation task: `01a1140f-ccd2-765d-a393-3ad6dd4ec02b`.

## Test plan and behavior evidence

| Scenario | Expected and observed result | Evidence |
| --- | --- | --- |
| Open a Russian-selected board, edit a card, switch languages, save and reload; also enter directly from Play. | Russian appears in both editors; corrected words persist. English, Spanish, media and fixed cards stay intact. Cancel discards the draft; play can retain English labels. | Matched captures below; passing browser correction and direct-entry scenarios in the [validation record](https://github.com/MChartier/little-say/blob/9a8f7318d925dab559f2992a2b47525f691d18ff/validation-current.json). |
| Delay audio, change spoken text/language, then fail and retry; change only the label. | Old completion never marks the new input ready. Retry sends corrected Russian; unchanged spoken text reuses audio. Failed saving remains visible and retry persists the correction. | Passing controlled-response browser checks and [retained failure state](https://github.com/MChartier/little-say/blob/9a8f7318d925dab559f2992a2b47525f691d18ff/review-fix/after-corrected-audio-failure.png). |
| Change source words, prepare a missing language, cancel/retry translation, or apply an AI proposal. | Saved corrections remain available for review; missing fields stay blank. Stale requests cannot replace current work. Replacing protected words requires a separate decision bound to that AI draft; a source-language change that would hide a saved translation is refused. | Passing merge/browser regressions; [stale review](https://github.com/MChartier/little-say/blob/9a8f7318d925dab559f2992a2b47525f691d18ff/review-fix/after-stale-correction.png) and [replacement review](https://github.com/MChartier/little-say/blob/9a8f7318d925dab559f2992a2b47525f691d18ff/review-fix/after-ai-replacement-review.png). |

### Before / After UI evidence

**Before:** `7e8ab5993503419e5945c8f304ffab3a6fc91f56`, the actual direct parent. **After:** `a08a723d87cee4bbb3026f11b3fcfa8c63c6f2ce`, this PR head.

Real isolated builds in Edge 154.0.4258.62 on Windows; identical synthetic library, 1180×1000 viewport, scale 1, light theme and controlled starting clock. Russian is selected; play labels deliberately remain English. Both card dialogs start at the Position row. Service workers are blocked equally; providers/device voices are mocked and fullscreen is neutralized. No image or compared-DOM editing.

| Before | After |
| --- | --- |
| ![Before: board editor shows source Cow](https://github.com/MChartier/little-say/blob/9a8f7318d925dab559f2992a2b47525f691d18ff/review-fix/before-board.png?raw=true) | ![After: Russian board label; fixed Sheep unchanged](https://github.com/MChartier/little-say/blob/9a8f7318d925dab559f2992a2b47525f691d18ff/review-fix/after-board.png?raw=true) |
| ![Before: main card fields stay English](https://github.com/MChartier/little-say/blob/9a8f7318d925dab559f2992a2b47525f691d18ff/review-fix/before-card.png?raw=true) | ![After: selected Russian in primary card fields](https://github.com/MChartier/little-say/blob/9a8f7318d925dab559f2992a2b47525f691d18ff/review-fix/after-card.png?raw=true) |

The board and primary fields now agree with the selected language. The baseline's [existing lower translation controls](https://github.com/MChartier/little-say/blob/9a8f7318d925dab559f2992a2b47525f691d18ff/review-fix/before-existing-translation-controls.png) are retained separately; this change does not claim translation editing was entirely absent.

[Capture provenance and reproduction](https://github.com/MChartier/little-say/blob/9a8f7318d925dab559f2992a2b47525f691d18ff/README-current.md) bind source, running bundles, fixture, harness and image hashes. [Manifest](https://github.com/MChartier/little-say/blob/9a8f7318d925dab559f2992a2b47525f691d18ff/review-fix/manifest.json) SHA-256: `240f2955b99d138d9b3382762a97de7e33d3a47731597458236a860b2a9135a8`. Authenticated GitHub reads verified all linked capture artifacts byte-for-byte; the author inspected genuine pixels.

## Supporting checks and limitations

Passed: 231 unit tests, 116 browser scenarios, TypeScript, release-contract validation, server/web builds and both native bundle exports. [Logs and scope inventory](https://github.com/MChartier/little-say/blob/9a8f7318d925dab559f2992a2b47525f691d18ff/README-current.md) are on a separate non-merged evidence ref; the product history contains only nine product and five maintained regression files.

Live providers and native-device/emulator execution were not tested. Native testing is [explicitly deferred for review readiness](https://github.com/MChartier/calibrate-health/issues/405#issuecomment-6041659686); exports do not establish device behavior. Actual GitHub page rendering was not inspected under the [recorded waiver](https://github.com/MChartier/calibrate-health/issues/405#issuecomment-6022754087). [Exact-head CI](https://github.com/MChartier/little-say/actions/runs/37710438617) passed, including nine PostgreSQL integration tests. [Codex engineering review](https://github.com/MChartier/little-say/pull/38#issuecomment-6049983045) completed with no major issues. Independent QA remains the coordinator's gate.