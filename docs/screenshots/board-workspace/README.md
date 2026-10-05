# Live board workspace evidence

Captured October 4, 2026 in Chromium from an isolated production build. Desktop: 1280 × 900; tablet: 820 × 1180; phone: 430 × 932. These are synthetic boards with no personal data. Picture settings are accessible in the page header while work continues.

| State | Desktop | Tablet | Phone |
| --- | --- | --- | --- |
| Two pictures ready, two active, two queued | [Progress](progress-desktop.png) | [Progress](progress-tablet.png) | [Progress](progress-phone.png) |
| All pictures ready to save | [Ready](ready-desktop.png) | [Ready](ready-tablet.png) | [Ready](ready-phone.png) |
| Clarification with the current canvas retained | [Clarification](clarification-desktop.png) | [Clarification](clarification-tablet.png) | [Clarification](clarification-phone.png) |
| Images unavailable; usable emoji fallback | [Fallback](fallback-desktop.png) | [Fallback](fallback-tablet.png) | [Fallback](fallback-phone.png) |

[Picture settings during active generation](settings-during-work.png) shows the source control available and explains that changes apply to the next update. Generation has no separate permission switch. The existing AI-services consent still applies; Library only and Emoji only avoid new image generation.

## Compare the previous flow

The [previous phone conversation](https://github.com/MChartier/little-say/blob/deaa91286df82f1b2e9ee1677dc79aab78eddcc0/docs/screenshots/card-pictures/prompt-controls-phone.png) and [tablet conversation](https://github.com/MChartier/little-say/blob/deaa91286df82f1b2e9ee1677dc79aab78eddcc0/docs/screenshots/card-pictures/prompt-controls-tablet.png) show the old modal layout. The new route uses an independent canvas beside the conversation on wider screens and above it on phones. A fallback produces one short summary instead of an error for every card.

The [source comparison](../card-pictures/README.md) includes emoji, real Mulberry library pictures, and generated illustrations for the same six animal labels, plus the construction example and updated source selectors.

Release metadata, TypeScript, 183 unit tests, production server/web builds, and all 62 Chromium scenarios passed. The final browser run includes the landing-page commit already merged into the PR branch.

## Evidence boundaries and reproduction

The six construction PNGs are retained real outputs from the earlier live evaluation. Their identities are verified against [the evaluation report](../card-pictures/evaluation.json) with SHA-256 before capture. Proposal text, job responses, completion timing, clarification, and service failure are controlled fixtures. These screenshots demonstrate the UI states; they do not measure live generation speed or automatic matching accuracy. Capture makes no AI calls and blocks the service worker so it cannot intercept fixtures. Separate browser tests cover offline storage and playback.

```sh
npm run build
npx tsx scripts/capture-workspace-evidence.ts
```

The script requires `artifacts/picture-evaluation/color/report.json` and its six PNGs, then writes thirteen captures under `artifacts/screenshots/board-workspace/`. Set `WEB_ROOT` to a production-build copy if needed. Copy only inspected captures into this directory. The browser suite checks out-of-order completion, two repeated animation cycles, reduced motion, source changes during work, cancellation after partial completion, reload and Back navigation, unchanged saved boards, and a saveable offline emoji fallback. Native Android/iPad keyboard, navigation, animation, and touch behavior still need physical-device validation.
