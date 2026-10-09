## Summary

Parents selecting Russian for a board could hear Russian while its editor preview and primary card fields still showed English. Translation fields existed farther down the card dialog, making corrections difficult to follow.

The board and card editors now show the selected language in their main controls. Corrections survive switching, saving and reloading while preserving source words, other languages and fixed cards. Saved corrections require an explicit AI replacement decision; audio follows the exact selected words and language.

Closes #32. Targets current **master**; no unmerged prerequisite.

## Test plan and behavior evidence

| Scenario | Expected and observed on the current build | Evidence |
| --- | --- | --- |
| Select Russian, correct a card, switch languages, save and reload; enter directly from Play. | Main controls show Russian and retain corrections. Source English, Spanish, fixed cards and media remain intact. Cancel discards drafts. | Matched pairs below and [browser checks](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/records/integration-browser.log). |
| Clear both Russian fields, switch Spanish, and try Save/Duplicate; then cancel or complete the draft and reload. | Save refuses incomplete fields and Duplicate is disabled. Manual and legacy saved words remain intact; completed corrections persist with source/Spanish/media unchanged. | [17 focused browser scenarios](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/records/integration-browser.log) and [refusal capture](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/captures/after-empty-correction-refused.png). |
| Delay audio, change words/language, then fail and retry; fail a local save. | Old audio never appears ready for new input. Retry uses corrected Russian; label-only changes reuse speech. Failed writes stay visibly unsaved and retry persists them. | [Failure capture](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/captures/after-corrected-audio-failure.png) and controlled-response browser checks. |
| Change source words, cancel/retry translation preparation, and review AI wording. | Saved corrections remain for review. AI replacement requires a separate draft-bound choice; manual and AI source-language collisions are refused, including corrections made in the same unsaved draft. | [Replacement review](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/captures/after-ai-replacement-review.png), [AI refusal](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/captures/after-ai-source-collision.png), [manual refusal](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/captures/after-manual-source-collision.png), and passing merge/browser regressions. |
| Visit and cancel account login after a correction; round-trip an account snapshot and sync conflict. | Guest edits survive navigation/reload; snapshot and conflict copies preserve correction provenance and exact audio keys. | Focused browser/unit checks; current CI also exercises account backup/restore. |

### Before / After

Actual master `18aa7c08615ecf60c8583f0590dcce8ed389f0ea` to final head `6db60bbf2f7c43a4d9f88c4b22d5b9c2a4e4edef`. Fresh isolated builds in Edge 154 on Windows use the same synthetic English/Russian/Spanish library, account-entry setup, 1180×1000 viewport, scale 1, light theme and controlled starting clock. Play labels intentionally remain English; fixed Sheep stays English.

| Before: actual master | After: proposed change |
| --- | --- |
| ![Before: source labels in board editor](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/captures/before-board.png?raw=true) | ![After: selected Russian label with fixed Sheep preserved](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/captures/after-board.png?raw=true) |
| ![Before: English primary card fields](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/captures/before-card.png?raw=true) | ![After: Russian primary card fields](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/captures/after-card.png?raw=true) |

The pairs show the selected language becoming visible in the main workflow. The baseline already had [lower translation controls](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/captures/before-existing-translation-controls.png). Both card captures start at the Position row. [Bound provenance](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/README.md) identifies source, served bundles, fixture, harness and image hashes. Providers/voices are controlled, fullscreen neutralized, and service workers blocked equally to exclude stale bundles/PWA notices; no compared UI or image pixels were edited.

## Supporting checks and limitations

Passed: 325 unit tests, TypeScript, release-contract checks, server/web builds, and final iOS and Android exports. All 17 affected translation browser scenarios passed. Another 105 previously passing browser scenarios remain applicable under the [impact assessment](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/README.md). [Final-head CI](https://github.com/MChartier/little-say/actions/runs/37870039933) passed, including 25 service tests and five account browser scenarios.

The integrated iOS export now passes after the runtime dependency fix merged into master. [Independent QA](https://github.com/MChartier/little-say/pull/38#issuecomment-6072652174) verified the integrated iOS export, R1 boundaries, four fresh Edge scenarios, 19 focused unit tests, all 12 captures and provenance, complete published scope and current CI. The current-head review bot returned a [quota-only refusal](https://github.com/MChartier/little-say/pull/38#issuecomment-6072408054); no bot review completed on this head. The independent assessment records that refusal under the scoped quota amendment; prior actionable findings remain fixed.

Native-device/emulator and live-provider execution remain unrun; [native checks are deferred](https://github.com/MChartier/calibrate-health/issues/405#issuecomment-6041659686). GitHub rendered-page inspection is [waived](https://github.com/MChartier/calibrate-health/issues/405#issuecomment-6022754087); genuine captures were inspected.

[Complete thirteen-commit/15-file scope, fresh provenance and retained original descriptions](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/README.md). Historical stack and capture records remain preserved separately.
