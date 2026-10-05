# Board creation refinements

Captured October 4, 2026 in Chromium at 1280 × 900 (desktop) and 390 × 844 (phone). Baselines come from PR #6 at `1d1afe04e5224d162e9a120d4c24bb88208a8b9b`; updated captures use the current PR implementation. The built app runs on an isolated temporary server with synthetic boards and controlled replies. No AI calls are made.

| State | Before | Desktop after | Phone after |
| --- | --- | --- | --- |
| Manual entry is separate from conversational creation | [Phone](before/boards-phone.png) | [Boards](after/boards-desktop.png) | [Boards](after/boards-phone.png) |
| Suggestions stay within the conversation | [Phone](before/conversation-phone.png) | [Conversation](after/conversation-desktop.png) | [Conversation](after/conversation-phone.png) |
| First send starts immediately, with no opt-in interstitial | [Desktop](before/first-send-desktop.png) | [Choosing pictures](after/first-send-desktop.png) | [Choosing pictures](after/first-send-phone.png) |
| Accurate emoji are ready to save without image jobs | — | [Emoji ready](after/emoji-ready-desktop.png) | [Emoji ready](after/emoji-ready-phone.png) |
| Only the excavator gap searches for a library picture | — | [Library search](after/gap-library-search-desktop.png) | [Library search](after/gap-library-search-phone.png) |
| Only that gap generates an illustration after lookup fails | — | [Generating](after/gap-generating-desktop.png) | [Generating](after/gap-generating-phone.png) |
| Usable mixed board; matching illustrations remain optional | — | [Ready](after/gap-ready-desktop.png) | [Ready](after/gap-ready-phone.png) |

The excavator is a retained real image from the earlier [evaluation](../card-pictures/evaluation.json), verified against its SHA-256 digest before capture. Lookup and generation timing are controlled, so this demonstrates targeted work and status presentation, not live service latency or matching accuracy. [All three sources](../card-pictures/README.md) include actual library artwork alongside emoji and generated pictures.

Validation: 194 unit/service tests, TypeScript, release checks, production builds, and 64 Chromium scenarios passed. The final layout and cancellation adjustments also passed the 20 conversation/picture scenarios. Coverage includes zero picture jobs for accurate emoji, retaining good pictures when another card has a gap, using a library match without generation, phase-aware feedback, and cancelling an optional illustration upgrade while keeping the original draft saveable. Physical-device validation remains outstanding.

```sh
npm run build
npx tsx scripts/capture-creation-entry-evidence.ts
```

The script requires the retained `artifacts/picture-evaluation/color/report.json` and PNGs. It writes fourteen updated captures under `artifacts/screenshots/creation-entry/after`. Use `--before` only against the baseline build to capture its six entry/first-send states. Review before copying assets into this directory.
