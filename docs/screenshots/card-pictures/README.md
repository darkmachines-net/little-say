# Card picture evidence

Captured on October 4, 2026 in Chromium against the production web build, with isolated synthetic construction boards. The tablet viewport is 820 × 1180; the phone viewport is 430 × 932. Images, fonts, layout and modal animations settle before capture. No personal photo or existing device library is included.

The six illustrations are actual outputs from the live `gpt-image-2.5-flare` color evaluation. They were downloaded and inserted into isolated browser storage for these captures. The screenshot capture does not make AI calls. The [evaluation report](evaluation.json) records six completed pictures, no final visual-review rejections, and approximately 61 seconds for the evaluation. Model acceptance is not proof of a child's understanding.

The emoji comparison uses the original mapping from the reported problem: two generic trucks, three tractors and a construction crane. Both columns render the same six labels in this feature build; this is a content comparison, not a screenshot of an older build. The feature branch starts from [the dialog-dismissal PR #5](https://github.com/MChartier/little-say/pull/5), commit [3b39998](https://github.com/MChartier/little-say/commit/3b39998ff8c21f75283de6a8220d1ac0f8f8ec22).

| Viewport | Original emoji mapping | Generated pictures | Board controls | Card controls | Prompt controls |
| --- | --- | --- | --- | --- | --- |
| Tablet | [Comparison](emoji-comparison-tablet.png) | [Saved board](generated-board-tablet.png) | [Improve/restyle](board-controls-tablet.png) | [Card override](card-controls-tablet.png) | [Source/style choices](prompt-controls-tablet.png) |
| Phone | [Comparison](emoji-comparison-phone.png) | [Saved board](generated-board-phone.png) | [Improve/restyle](board-controls-phone.png) | [Card override](card-controls-phone.png) | [Source/style choices](prompt-controls-phone.png) |

The editing screenshots show unsaved controls. The board's Apply action stays disabled until preparation completes. The prompt is composed but not submitted; live prompt interpretation was validated separately for library-only black-and-white output and an excavator-only generated-color override. Card previews retain the existing narrow label wrapping; the saved tablet/430px phone boards show all six vehicle labels.

Local validation passed release metadata, TypeScript, 178 unit tests, 51 browser scenarios, and server/web production builds. Picture scenarios cover offline reload, permission enforcement, cancellation without a partial save, protected-card restyling, returning to emoji, manual library selection without AI consent, and preserving pictures during unrelated AI edits. Live catalog downloads/rasterization passed for a Mulberry dumper truck, Mulberry cow, and OpenMoji black tractor.

Physical Android/iPad validation and deployment remain outstanding. The live generated-image evaluation covered color pictures; black-and-white source/style behavior is covered by automated tests and the live text-proposal evaluation, not a second live generation run.

To capture again from retained local evaluation artifacts:

```sh
npm run build
npx tsx scripts/capture-picture-evidence.ts
```

The capture script requires `artifacts/picture-evaluation/color/report.json` and its six PNGs, verifies their SHA-256 identities, starts an isolated temporary server without an AI provider, and writes under `artifacts/screenshots/card-pictures/`. To create new evaluation artifacts first, run `npm run eval:pictures -- --generate`; this is billable and may produce different variants. Copy reviewed captures into this directory when updating PR evidence.
