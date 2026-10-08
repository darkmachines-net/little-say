## Summary

Parents selecting Russian for a board could hear Russian while its editor preview and primary card fields still showed English. Translation fields existed farther down the card dialog, making corrections difficult to follow.

The board and card editors now show the selected language in their main controls. Corrections survive switching, saving and reloading while preserving source words, other languages and fixed cards. Saved corrections require an explicit AI replacement decision; audio follows the exact selected words and language.

Closes #32. Targets current **master**; no unmerged prerequisite.

## Test plan and behavior evidence

| Scenario | Expected and observed on the current build | Evidence |
| --- | --- | --- |
| Select Russian, correct a card, switch languages, save and reload; enter directly from Play. | Main controls show Russian and retain corrections. Source English, Spanish, fixed cards and media remain intact. Cancel discards drafts. | Matched pairs below and [browser checks](https://github.com/MChartier/little-say/blob/c2331b99cc3bc6a71b84ac79442beb8fc45e6222/refresh/records/browser-review-fix.log). |
| Delay audio, change words/language, then fail and retry; fail a local save. | Old audio never appears ready for new input. Retry uses corrected Russian; label-only changes reuse speech. Failed writes stay visibly unsaved and retry persists them. | [Failure capture](https://github.com/MChartier/little-say/blob/c2331b99cc3bc6a71b84ac79442beb8fc45e6222/refresh/current-captures/after-corrected-audio-failure.png) and controlled-response browser checks. |
| Change source words, cancel/retry translation preparation, and review AI wording. | Saved corrections remain for review. AI replacement requires a separate draft-bound choice; manual and AI source-language collisions are refused. | [Replacement review](https://github.com/MChartier/little-say/blob/c2331b99cc3bc6a71b84ac79442beb8fc45e6222/refresh/current-captures/after-ai-replacement-review.png), [AI refusal](https://github.com/MChartier/little-say/blob/c2331b99cc3bc6a71b84ac79442beb8fc45e6222/refresh/current-captures/after-ai-source-collision.png), [manual refusal](https://github.com/MChartier/little-say/blob/c2331b99cc3bc6a71b84ac79442beb8fc45e6222/refresh/current-captures/after-manual-source-collision.png), and passing merge/browser regressions. |
| Visit and cancel account login after a correction; round-trip an account snapshot and sync conflict. | Guest edits survive navigation/reload; snapshot and conflict copies preserve correction provenance and exact audio keys. | Focused browser/unit checks; current CI also exercises account backup/restore. |

### Before / After

Actual master `fabb925cf5ee11171d5668af7c2bab44ec9fc613` → captured After `1a7fa5e960f200fdae35339972cddad871ea0f06`. Current head `1b4d2ebf0d5f046eef3dec1d03834e7b09bb707f` adds only JSDoc for translation-replacement permission; executable behavior is unchanged and these captures remain applicable. Fresh isolated builds in Edge 154 on Windows use the same synthetic English/Russian/Spanish library, account-entry setup, 1180×1000 viewport, scale 1, light theme and controlled starting clock. Play labels intentionally remain English; fixed Sheep stays English.

| Before: actual master | After: proposed change |
| --- | --- |
| ![Before: source labels in board editor](https://github.com/MChartier/little-say/blob/c2331b99cc3bc6a71b84ac79442beb8fc45e6222/refresh/current-captures/before-board.png?raw=true) | ![After: selected Russian label with fixed Sheep preserved](https://github.com/MChartier/little-say/blob/c2331b99cc3bc6a71b84ac79442beb8fc45e6222/refresh/current-captures/after-board.png?raw=true) |
| ![Before: English primary card fields](https://github.com/MChartier/little-say/blob/c2331b99cc3bc6a71b84ac79442beb8fc45e6222/refresh/current-captures/before-card.png?raw=true) | ![After: Russian primary card fields](https://github.com/MChartier/little-say/blob/c2331b99cc3bc6a71b84ac79442beb8fc45e6222/refresh/current-captures/after-card.png?raw=true) |

The pairs show the selected language becoming visible in the main workflow. The baseline already had [lower translation controls](https://github.com/MChartier/little-say/blob/c2331b99cc3bc6a71b84ac79442beb8fc45e6222/refresh/current-captures/before-existing-translation-controls.png). Both card captures start at the Position row. [Bound provenance](https://github.com/MChartier/little-say/blob/c2331b99cc3bc6a71b84ac79442beb8fc45e6222/refresh/README.md) identifies source, served bundles, fixture, harness and image hashes. Providers/voices are controlled, fullscreen neutralized, and service workers blocked equally to exclude stale bundles/PWA notices; no compared UI or image pixels were edited.

## Supporting checks and limitations

Passed: 296 unit tests, TypeScript, release-contract checks, server/web builds and final Android export. All 69 affected browser scenarios passed after the review fix; 49 unaffected scenarios remain applicable under the [documented impact assessment](https://github.com/MChartier/little-say/blob/c2331b99cc3bc6a71b84ac79442beb8fc45e6222/refresh/README.md). [Final-head CI](https://github.com/MChartier/little-say/actions/runs/37825498340) passed, including service/account integration and account browser checks. [Engineering review](https://github.com/MChartier/little-say/pull/38#issuecomment-6066627102) completed with no major issues; both new findings have fixes and resolved dispositions.

iOS bundle export failed on actual master and the integrated build because the unchanged Apple authentication dependency cannot resolve `prop-types`; [matched failure logs](https://github.com/MChartier/little-say/blob/c2331b99cc3bc6a71b84ac79442beb8fc45e6222/refresh/README.md) preserve the existing baseline problem for separate coordination. Native-device/emulator and live-provider execution remain unrun; [native checks are deferred](https://github.com/MChartier/calibrate-health/issues/405#issuecomment-6041659686). GitHub rendered-page inspection is [waived](https://github.com/MChartier/calibrate-health/issues/405#issuecomment-6022754087); genuine captures were inspected, and independent QA remains pending.

[Complete eight-commit/15-file scope and retained original descriptions](https://github.com/MChartier/little-say/blob/c2331b99cc3bc6a71b84ac79442beb8fc45e6222/refresh/README.md). Historical stack and capture records remain preserved separately.
