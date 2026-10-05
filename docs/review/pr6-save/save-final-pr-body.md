## Summary

Parents building a board on master can use emoji and personal photos, but a generic truck emoji cannot distinguish a dump truck from other vehicles. AI drafts also share a modal with the conversation, leaving less room to review the board while refining it.

This change adds automatic picture selection and a full-page draft workspace. Automatic keeps accurate emoji, fills gaps with licensed library artwork, and generates an illustration only when a gap still needs one. Pictures appear as they finish; parents can stop work, adjust source choices, and explicitly save the reviewed draft. Failed picture work keeps a usable emoji or existing saved picture. Photos and protected pictures survive board-wide changes, and downloaded PNGs remain available offline.

New board opens the conversation directly; Build manually is a separate entry. Sending or recording uses an inline data-use explanation. Source choices are available for the draft, board, card, and new-board defaults. This diff also includes the web introduction at `/`, with the application at `/app` and unchanged entry behavior for existing installed web apps.

**Target:** `master` at `5d72992c77fbb09195518e257d799501b7db4d04`; no parent PR. Review PR6 before dependent #13. Current head: `02cb85c5e4aaaae056ace73ef6fda591bd0bc500`. [Picture behavior and configuration](https://github.com/MChartier/little-say/blob/02cb85c5e4aaaae056ace73ef6fda591bd0bc500/docs/PICTURES.md).

## Test plan and behavior evidence

| Scenario | Intended outcome and actual observation | Evidence |
| --- | --- | --- |
| Existing library; request “Cow, sheep, and a dump truck” | Keep the two accurate animal emoji and improve only the truck. The production web app requested one picture job and displayed the real library symbol in its separate canvas; master displayed three emoji in a modal. | Matched desktop pair below; retained fixture and served-bundle hashes. Controlled service selection demonstrates presentation and targeting, not live AI accuracy. |
| No suitable library picture and generation unavailable | Keep the draft usable. The phone app retained the truck emoji, showed one fallback explanation, and enabled Use this board. Browser regression also saved the fallback board, reloaded offline, and found every card. | Matched phone pair below; fallback browser scenario in the [test log](https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/save-browser.log). |
| Stop partial picture work; change source; protect a card; retry a failed save | Stop cancels outstanding jobs without saving a partial draft, restores the prompt, and excludes discarded turns from retry context; source changes wait for an explicit update; protected pictures remain; browser Back/Forward cannot discard a pending save, and retry saves exactly once. The 23 affected Chromium scenarios passed, including offline PNG persistence, reduced motion, keyboard selectors, reload/Back and microphone cleanup. | [Maintained scenarios](https://github.com/MChartier/little-say/tree/02cb85c5e4aaaae056ace73ef6fda591bd0bc500/tests/web) and the same executed test log. |
| Fresh visit to `/`; open the web app | Explain the app before setup. The new homepage links to `/app`; master immediately opens language setup. Browser tests confirmed no homepage library/API initialization and preserved legacy standalone launches. | Matched homepage pair below and landing-page scenarios. |

### Before / After: picture draft

**Before:** actual master `5d72992c77fbb09195518e257d799501b7db4d04`. **After captured source:** `02cb85c5e4aaaae056ace73ef6fda591bd0bc500`, the current PR head. Both sides are genuine isolated production builds.

Both isolated production builds used identical synthetic boards, prompts, viewport, light theme, DPR 1, en-US/UTC, fixed Date, and reduced motion. Service workers were blocked; no DOM/CSS hiding or pixel edits. AI/job replies were controlled. The truck is real pinned Mulberry artwork rasterized by the production library path, not a generated mockup. Mulberry Symbols by Steve Lee, CC BY-SA 4.0.

[Exact capture manifest, image hashes and running-build verification](https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/manifest.json) · [Reproduction, fixture/harness identities and coverage limits](https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/README.md). Provenance commit: `7a0e75f01b51550c1027e640e67b118faceb2e65`.

| Before — modal with generic truck, 1280×900 | After — gap-only library picture and separate canvas, 1280×900 |
| --- | --- |
| ![Before: master emoji draft](https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/before-ready-1280.png?raw=true) | ![After: animal emoji retained and dump-truck picture ready](https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/after-ready-1280.png?raw=true) |

### Before / After: unavailable picture

Same request and 390×844 phone viewport. Master has no automatic picture service; After explains the unavailable improvement without blocking the usable draft.

| Before — emoji draft | After — saveable fallback with one explanation |
| --- | --- |
| <img src="https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/before-fallback-390.png?raw=true" alt="Before: master phone draft" width="300" /> | <img src="https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/after-fallback-390.png?raw=true" alt="After: phone draft retains emoji and can be saved" width="300" /> |

### Before / After: web entry

Fresh storage and the same `/` route at 1280×900. The new introduction provides an explicit path into the application.

| Before — setup immediately | After — introduction and Open web app |
| --- | --- |
| ![Before: master language setup at root](https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/before-home-1280.png?raw=true) | ![After: website introduction at root](https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/after-home-1280.png?raw=true) |

## Supporting checks and limitations

On MCHARTIER_ZBOOK, the final captured revision passed release metadata, TypeScript, **194 unit/service tests**, server/web builds, and **23 affected Chromium picture/conversation scenarios**. The broader **65-scenario Chromium suite** passed on original source `4cdeb323fb8ebfa5247193e47cf73d56f025e007`; unchanged landing-page and unrelated behavior checks are reused with that scope. The cancellation regression failed on the prior implementation and passed after the repair, including repeated stops and clean retry context. Pending-write browser history regressions also failed before repair and passed after it for success, failure/retry, repeated navigation, and ordinary navigation after completion. [Exact logs and retained historical evidence](https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/README.md). Current-revision CI appears in [Checks](https://github.com/MChartier/little-say/pull/6/checks); engineering review, independent QA verdicts and coordinator receipts are recorded separately in the [PR conversation](https://github.com/MChartier/little-say/pull/6#discussion_bucket).

These are browser captures, not physical-device evidence. Live AI matching/generation accuracy and latency were not re-evaluated; synthetic replies and a real retained library PNG establish the shown behavior. Android/iPad checks remain outstanding. Unsaved conversation drafts remain in memory. The exact API-rendered PR body and embedded image pixels were inspected; full authenticated GitHub-page layout remains unverified because the browser UI tool failed to initialize. No baseline waiver or readiness is implied. Original iteration evidence is retained in the [cleanup record](https://github.com/MChartier/little-say/pull/6#issuecomment-6000259404), outside the main base-to-final comparison.
