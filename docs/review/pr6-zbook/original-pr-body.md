Generic truck and tractor emoji can represent several different construction cards. Automatic picture selection now prioritizes a usable first draft: keep accurate emoji, use library artwork for gaps, and generate only what is still missing. This adds automatic picture selection from a licensed library and generated illustrations, with source controls in prompts, board settings, card settings, and defaults for new boards.

AI board creation and editing now use a full-page workspace. The conversation stays beside a persistent draft canvas on desktop/tablet and below it on phones. Pictures appear individually after download; active cards pulse, queued cards are labeled, and completed images remain visible during clarification. Back cancels outstanding work; saving remains explicit. Reload opens a fresh conversation for the route's source board.

New board starts the conversation directly. Build manually is a separate, quieter entry on the boards screen. Sending or recording starts immediately with an inline data-use explanation and no opt-in interstitial. Automatic includes generation only for gaps; legacy consistency preferences no longer promote the rest of the board. Completed drafts do not suggest AI illustrations. Parents can deliberately choose them through Picture settings; cancelling that change restores the usable draft. Library only and Emoji only avoid new generation. When a clearer picture is unavailable, the board keeps the best emoji or an existing saved picture and shows one concise summary. Source choices use an explained selector; there is no color/black-and-white style option. Header settings remain available during work, with changes applied on the next update. Progress counts only targeted cards; library lookup and image generation have distinct labels.

Photos and protected pictures remain intact during board-wide changes. Verified PNGs persist offline with source credits. The backend provides a pinned catalog, bounded durable jobs, cancellation, immutable assets, and visual review. Existing boards keep their appearance. [Picture contracts and configuration](https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/PICTURES.md).

**Base:** current master, including the development launchers from #7. The landing-page change already merged into this branch (#8) is preserved.

### Validation

- Release metadata, TypeScript, **194 unit/service tests**, and production server/web builds passed in an isolated PR copy.
- **64 Chromium scenarios passed** on the preceding build. After removing unsolicited illustration suggestions, the rebuilt app passed all **10 picture scenarios**, including a six-animal board that produces zero image jobs and saves without an illustration prompt. Coverage includes out-of-order picture completion, two animation cycles, reduced motion, source changes during generation, cancellation after partial completion, reload/Back navigation, microphone cleanup, failed saves, offline fallback playback, protected pictures, keyboard source selection, and landing-page routing.
- Captured **20 new before/after screenshots** for entry points, direct first-send, emoji readiness and a single picture gap. Refreshed the 31 workspace and visualization/control comparisons. Captures check the SHA-256 identities of retained real picture assets and make no AI calls.
- Earlier live evaluations produced six construction and six animal illustrations with no final model-review rejections; six real Mulberry animal assets were also downloaded through the production library path. Reports and licensing are linked below. These outputs were visually inspected; automated review does not establish semantic correctness for every card.

Physical Android/iPad validation and deployment remain outstanding. Workspace screenshots use controlled proposal/job timing and failures with retained real PNGs; they demonstrate presentation, not live generation speed or automatic matching accuracy. Browser tests separately verify offline persistence. Unsaved conversation drafts remain in memory.

### Fast first draft and clearer entry points

Complete emoji and mixed-picture boards go straight to save or further conversation. [The previous illustration suggestion](https://github.com/MChartier/little-say/blob/bac81796235ecef4647f7584d6ecfac6a8b0d80e/docs/screenshots/creation-entry/after/emoji-ready-phone.png) has been removed; deliberate source changes remain in Picture settings.

| Before · interrupted first send | After · ready with emoji | After · only the gap gets an illustration |
| --- | --- | --- |
| <img src="https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/creation-entry/before/first-send-phone.png?raw=true" alt="Previous first-send opt-in interruption" width="230" /> | <img src="https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/creation-entry/after/emoji-ready-phone.png?raw=true" alt="Six-animal emoji draft ready to save without an illustration suggestion" width="230" /> | <img src="https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/creation-entry/after/gap-ready-phone.png?raw=true" alt="Three accurate animal emoji retained with one excavator illustration" width="230" /> |

[Separate manual entry](https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/creation-entry/after/boards-desktop.png) · [Conversation suggestions](https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/creation-entry/after/conversation-phone.png) · [Library lookup for one gap](https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/creation-entry/after/gap-library-search-desktop.png) · [Generating only that illustration](https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/creation-entry/after/gap-generating-desktop.png) · [Evidence and reproduction](https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/creation-entry/README.md)

Account compatibility was checked against #9's snapshot schema: board picture policy and card source/protection choices survive the JSON round-trip. No persistent settings are added; device defaults remain local under that sync contract. #9 merged into its account stack base rather than master, so account implementation changes are not bundled into this PR.

### Live draft canvas

<img src="https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/board-workspace/progress-desktop.png?raw=true" alt="Full-page workspace showing two pictures ready, two active, and two queued beside the conversation" width="960" />

| Phone · pictures arriving | Phone · usable fallback | Tablet · complete draft |
| --- | --- | --- |
| <img src="https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/board-workspace/progress-phone.png?raw=true" alt="Phone draft with individual picture progress" width="230" /> | <img src="https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/board-workspace/fallback-phone.png?raw=true" alt="Saveable emoji board with one fallback summary" width="230" /> | <img src="https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/board-workspace/ready-tablet.png?raw=true" alt="Completed construction draft beside the tablet conversation" width="270" /> |

[Previous modal flow](https://github.com/MChartier/little-say/blob/deaa91286df82f1b2e9ee1677dc79aab78eddcc0/docs/screenshots/card-pictures/prompt-controls-phone.png) · [Settings during generation](https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/board-workspace/settings-during-work.png) · [Clarification with a retained canvas](https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/board-workspace/clarification-desktop.png) · [All workspace evidence and reproduction](https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/board-workspace/README.md)

### All three visualization types

Every column uses Cow, Sheep, Horse, Rabbit, Chicken, and Duck. Library symbols are actual Mulberry artwork explicitly selected for this rendering comparison; generated pictures are retained live evaluation outputs. These are content comparisons, not older-build screenshots.

| Emoji | Library images | Generated images |
| --- | --- | --- |
| <img src="https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/card-pictures/animals-emoji-tablet.png?raw=true" alt="Animal cards using emoji" width="235" /> | <img src="https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/card-pictures/animals-library-tablet.png?raw=true" alt="Same animal cards using Mulberry symbols" width="235" /> | <img src="https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/card-pictures/animals-generated-tablet.png?raw=true" alt="Same animal cards using generated illustrations" width="235" /> |

Mulberry Symbols by Steve Lee, CC BY-SA 4.0; original artwork unchanged, rasterized with transparent padding. [Phone comparisons, construction example, evaluation reports, original sources and license links](https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/card-pictures/README.md).

### Source controls before and after

| Before · wrapping source/style buttons | After · explained source field | After · vertical choices |
| --- | --- | --- |
| <img src="https://github.com/MChartier/little-say/blob/6a5e3fe06f349cbc3c283212b5b56bf236f7d465/docs/screenshots/card-pictures/board-controls-phone.png?raw=true" alt="Earlier wrapping source and style buttons" width="230" /> | <img src="https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/card-pictures/board-controls-phone.png?raw=true" alt="Board source selector with generation included in Automatic" width="230" /> | <img src="https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/card-pictures/source-options-phone.png?raw=true" alt="Explained source options in a vertical list" width="230" /> |

[Card settings](https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/card-pictures/card-controls-phone.png) · [Prompt settings](https://github.com/MChartier/little-say/blob/4cdeb323fb8ebfa5247193e47cf73d56f025e007/docs/screenshots/card-pictures/prompt-controls-phone.png). Control captures show unsaved choices; the example prompt is composed but not submitted.
