## Summary

Emoji can be too ambiguous for a child's communication board, and the existing draft modal makes it difficult to review a board while refining it.

This adds automatic pictures and a full-page draft workspace. It keeps suitable emoji, fills gaps with licensed artwork, and generates pictures only when needed. Parents can choose picture sources, stop work and explicitly save the draft. Failed picture work leaves usable cards; personal photos, protected pictures and saved offline PNGs are preserved. Inline notices explain picture processing before use.

New board opens the conversation; Build manually remains available separately. The web introduction lives at `/`, with the app at `/app` and existing installed-app entry preserved. [Picture behavior and configuration](https://github.com/MChartier/little-say/blob/2be85f0cb02cd5ba464f46c623b9b19cf5061231/docs/PICTURES.md).

Tracks #16. Targets master; review this before dependent #15.

## Test plan and evidence

- **Create a board:** requesting cow, sheep and a dump truck retained the animal emoji and added the distinct truck picture, as shown below.
- **Recover safely:** browser tests confirmed fallback cards remain saveable, stopped work releases capacity, failed saves can be retried, and saved cards survive reload/offline use. Source restrictions and protected photos remain respected.
- **Edit and disclose:** saved words survive dismissal of optional pictures; duplicate-label cards retain the correct pictures. Setup and parent settings explain picture-data use before generation.

Current CI passed **205 unit/server tests**, type/release checks and builds. **32 browser scenarios** passed on the unchanged mobile source. [Checks and recovery](https://github.com/MChartier/little-say/pull/6#issuecomment-6001954640) · [Detailed results and source applicability](https://github.com/MChartier/little-say/blob/1fd973b318313dc1f1e524f7a1e71f245380d29b/docs/review/pr6-catalog-cancel/README.md).

The genuine pairs compare master with the proposed behavior using matched synthetic data and viewports. Controlled service replies demonstrate UI behavior, not live AI accuracy. Captures predate backend-only fixes or changes outside the shown state; their original revisions and applicability remain recorded in the [draft/web capture manifest](https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/manifest.json), [disclosure evidence](https://github.com/MChartier/little-say/tree/c5b713150eee315fc6ddb5ea62cb4ff071e5bbcb/docs/review/pr6-disclosure) and [preserved provenance explanation](https://github.com/MChartier/little-say/tree/6600f14dbc81aa9fd034885d162dde14a0535d41/docs/review/pr6-concise/original-pr.md). No pixels were edited. Truck artwork: Mulberry Symbols, Steve Lee, CC BY-SA 4.0.

### picture draft

Automatic pictures replace the ambiguous truck emoji while the full-page workspace keeps the draft beside the conversation.

| Before — modal with generic truck, 1280×900 | After — gap-only library picture and separate canvas, 1280×900 |
| --- | --- |
| ![Before: master emoji draft](https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/before-ready-1280.png?raw=true) | ![After: animal emoji retained and dump-truck picture ready](https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/after-ready-1280.png?raw=true) |

### unavailable picture

When pictures are unavailable, the phone draft keeps usable emoji and can still be saved.

| Before — emoji draft | After — saveable fallback with one explanation |
| --- | --- |
| <img src="https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/before-fallback-390.png?raw=true" alt="Before: master phone draft" width="300" /> | <img src="https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/after-fallback-390.png?raw=true" alt="After: phone draft retains emoji and can be saved" width="300" /> |

### web entry

A fresh visit now introduces the app before opening setup.

| Before — setup immediately | After — introduction and Open web app |
| --- | --- |
| ![Before: master language setup at root](https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/before-home-1280.png?raw=true) | ![After: website introduction at root](https://github.com/MChartier/little-say/blob/7a0e75f01b51550c1027e640e67b118faceb2e65/docs/review/pr6-save/after-home-1280.png?raw=true) |

### picture-data disclosure

Parent settings explain picture processing, offline storage and server-cache retention.

| Before — earlier prompt/audio disclosure | After — picture flow and retention disclosed |
| --- | --- |
| ![Before: master parent privacy](https://github.com/MChartier/little-say/blob/c5b713150eee315fc6ddb5ea62cb4ff071e5bbcb/docs/review/pr6-disclosure/base-privacy.png?raw=true) | ![After: picture-data privacy disclosure](https://github.com/MChartier/little-say/blob/c5b713150eee315fc6ddb5ea62cb4ff071e5bbcb/docs/review/pr6-disclosure/after-privacy.png?raw=true) |

### first-run disclosure

First-run setup discloses picture processing and potential generation cost before generation.

| Before — earlier setup disclosure | After — picture use explained before generation |
| --- | --- |
| <img src="https://github.com/MChartier/little-say/blob/c5b713150eee315fc6ddb5ea62cb4ff071e5bbcb/docs/review/pr6-disclosure/base-setup-phone.png?raw=true" alt="Before: master starter setup disclosure" width="300" /> | <img src="https://github.com/MChartier/little-say/blob/c5b713150eee315fc6ddb5ea62cb4ff071e5bbcb/docs/review/pr6-disclosure/after-setup-phone.png?raw=true" alt="After: picture processing disclosed before starter generation" width="300" /> |

## Limitations

Browser evidence only; physical Android/iPad and live paid-provider accuracy were not tested. Unsaved conversation drafts remain in memory. The API-rendered body is inspectable, but authenticated GitHub-page inspection remains blocked by browser access. [Independent QA](https://github.com/MChartier/little-say/pull/6#issuecomment-6002210899) must reassess the revised presentation before readiness. [Original description and requirements](https://github.com/MChartier/little-say/tree/6600f14dbc81aa9fd034885d162dde14a0535d41/docs/review/pr6-concise).
