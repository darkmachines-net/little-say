# Card picture evidence

Captured on October 4, 2026 in Chromium against the production web build, with isolated synthetic boards. Tablet: 820 × 1180. Phone: 430 × 932. Images, fonts, layout and modal animations settle before capture. No personal photos or existing device libraries are included.

## Compare all three picture sources

Each column shows the same six labels: Cow, Sheep, Horse, Rabbit, Chicken, Duck. These are content comparisons in the current feature build, not screenshots of different app versions.

| Viewport | Emoji | Free library pictures | Generated illustrations |
| --- | --- | --- | --- |
| Tablet | [Emoji](animals-emoji-tablet.png) | [Mulberry library](animals-library-tablet.png) | [AI illustrations](animals-generated-tablet.png) |
| Phone | [Emoji](animals-emoji-phone.png) | [Mulberry library](animals-library-phone.png) | [AI illustrations](animals-generated-phone.png) |

The library column uses six actual pinned Mulberry assets, selected explicitly for this comparison and downloaded through the production library/rasterization path. Chicken uses the live-animal symbol; the catalog's exact “chicken” entry depicts prepared food. This column demonstrates library rendering and provenance, not automatic matching accuracy. The generated column uses six actual outputs from the live `gpt-image-2.5-flare` evaluation, deliberately requested even though animal emoji are available. The [animal evaluation report](animal-evaluation.json) records six completed generations, no final model-review rejections, approximately 51 seconds, and all library source identities. The pictures were visually inspected; model acceptance does not establish a child's understanding.

## Original construction ambiguity

The emoji column retains the reported mapping: two generic trucks, three tractors and a construction crane. Both columns render the same six labels in the current feature build. The [construction evaluation report](evaluation.json) records six completed illustrations, no final model-review rejections, and approximately 61 seconds.

| Viewport | Original emoji mapping | Generated pictures |
| --- | --- | --- |
| Tablet | [Emoji](emoji-comparison-tablet.png) | [Illustrations](generated-board-tablet.png) |
| Phone | [Emoji](emoji-comparison-phone.png) | [Illustrations](generated-board-phone.png) |

## Controls before and after

The **before** links point to the earlier PR implementation at commit [6a5e3fe](https://github.com/MChartier/little-say/commit/6a5e3fe06f349cbc3c283212b5b56bf236f7d465). The current controls replace wrapping choices with one labeled source field and an explained vertical list. Independent settings use switches. There is no illustration-style selector; new picture work uses color.

| Viewport | Before: wrapping choices | After: collapsed selector | After: explained choices | Card controls | Prompt controls |
| --- | --- | --- | --- | --- | --- |
| Tablet | [Before](https://github.com/MChartier/little-say/blob/6a5e3fe06f349cbc3c283212b5b56bf236f7d465/docs/screenshots/card-pictures/board-controls-tablet.png) | [Board settings](board-controls-tablet.png) | [Source list](source-options-tablet.png) | [Card override](card-controls-tablet.png) | [Prompt settings](prompt-controls-tablet.png) |
| Phone | [Before](https://github.com/MChartier/little-say/blob/6a5e3fe06f349cbc3c283212b5b56bf236f7d465/docs/screenshots/card-pictures/board-controls-phone.png) | [Board settings](board-controls-phone.png) | [Source list](source-options-phone.png) | [Card override](card-controls-phone.png) | [Prompt settings](prompt-controls-phone.png) |

Editing screenshots show unsaved controls. Apply remains disabled until picture preparation completes. The example prompt is composed but not submitted; live prompt interpretation was checked separately for library-only output and an excavator-only generated override. Existing narrow card-editor previews can wrap “Excavator” mid-word; saved boards show all six full labels. Phone board titles use the existing ellipsis treatment.

## Validation and follow-up

Release metadata, TypeScript, 179 feature-branch unit tests, and server/web production builds passed locally. The final full Chromium run passed all 53 scenarios using an isolated production-build copy. An earlier run hit a transient 404 while the shared build directory was being rebuilt; that failure did not recur in the isolated run. Browser coverage includes offline reload, permission enforcement, cancellation without a partial save, protected-card restyling, returning to emoji, manual library selection without AI consent, and picture retention through unrelated edits. The new selector checks cover mobile list layout, Enter/Escape, focus return, and inherited card sources. Legacy outline preferences are read compatibly, while new artwork requests use color.

The screenshot capture makes no AI calls and verifies the SHA-256 identity of every seeded PNG. Physical Android/iPad validation and deployment remain outstanding. The feature is stacked on [dialog-dismissal PR #5](https://github.com/MChartier/little-say/pull/5), base commit [3b39998](https://github.com/MChartier/little-say/commit/3b39998ff8c21f75283de6a8220d1ac0f8f8ec22).

## Library artwork credits

Animal symbols are **Mulberry Symbols by Steve Lee**, under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Original artwork is unchanged; the app rasterizes and fits it on transparent PNGs. The library artwork and its adaptations retain that license. Original pinned sources: [cow](https://raw.githubusercontent.com/mulberrysymbols/mulberry-symbols/9cbab9f400c5de44e2bc58839cca07294aadb086/EN/cow.svg), [sheep](https://raw.githubusercontent.com/mulberrysymbols/mulberry-symbols/9cbab9f400c5de44e2bc58839cca07294aadb086/EN/sheep.svg), [horse](https://raw.githubusercontent.com/mulberrysymbols/mulberry-symbols/9cbab9f400c5de44e2bc58839cca07294aadb086/EN/horse.svg), [rabbit](https://raw.githubusercontent.com/mulberrysymbols/mulberry-symbols/9cbab9f400c5de44e2bc58839cca07294aadb086/EN/rabbit.svg), [live chicken](https://raw.githubusercontent.com/mulberrysymbols/mulberry-symbols/9cbab9f400c5de44e2bc58839cca07294aadb086/EN/chicken_live.svg), [duck](https://raw.githubusercontent.com/mulberrysymbols/mulberry-symbols/9cbab9f400c5de44e2bc58839cca07294aadb086/EN/duck.svg).

## Reproduce the eighteen captures

With both retained local evaluations available:

```sh
npm run build
npx tsx scripts/capture-picture-evidence.ts
```

The capture script requires `artifacts/picture-evaluation/color/report.json`, `artifacts/picture-evaluation/animals/report.json`, and their corresponding generated/library PNGs. It starts an isolated temporary server without an AI provider and writes under `artifacts/screenshots/card-pictures/`. Copy reviewed captures and reports into this directory when updating PR evidence.

To create new evaluation inputs, run `npm run eval:pictures -- --generate` and `npm run eval:pictures -- --animals --generate`. These are billable and may produce different variants.
