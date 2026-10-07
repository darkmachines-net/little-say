## Problem

A four-card storyboard works well as 2×2 in portrait but becomes 3+1 in landscape, leaving an unbalanced row and unused space. Families need large, readable cards that use the available board area sensibly in either orientation.

This is user-reported behavior. Running the current sizing function on synthetic tablet bounds reproduced the column choice; the installed app/device has not been reproduced.

## Requirements and acceptance

- At representative tablet viewports 820×1180 and 1180×820, four cards form 2×2 within the measured board area, preserving the good portrait layout. Cards may be rectangular; neither exact squares nor two columns everywhere are required.
- Adapt to 1–24 cards and the actual available width/height after headers, controls and safe areas. Nonempty rows have equal card counts or differ by one; preserve saved order, avoid stranded cards/unused slots, and use consistent gaps.
- Check 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 23 and 24 cards across those tablets and phone viewports 390×844 / 844×390. Wider layouts may use more columns. Cards stay within bounds without overlap or play scrolling on these supported sizes.
- Preserve the existing minimum 44×44 logical-unit touch target, full accessible names, keyboard/screen-reader activation and forgiving gestures. Long/multilingual labels, larger text, emoji, illustrations and photos remain usable without overlapping controls; preserve photo crops and make any label truncation deliberate.
- Rotation/resize reflows promptly and deterministically, without changing card IDs/order, language, content or active/pending playback. Cancel contacts/parent holds tied to old geometry so release cannot activate the wrong card.
- Editor previews use the shared geometry while retaining reachable edit actions, compact sizing and their existing small-window scrolling behavior. Library thumbnails, AI draft layouts, playback recovery #28 and the hold-to-editor transition #30 are outside this change.

## Implementation plan

1. Replace the regular-grid-only result with a deterministic row/per-card rectangle contract. Enumerate row counts, distribute cards by quotient/remainder, and rank viable arrangements by usable size, a soft preference for square-ish cards and balanced presentation. Prefer uniform rows among similarly usable options; do not trade readable targets for decorative shape.
2. Make `PlayBoard` and `BoardEditor` consume that geometry; use the same rectangles for rendering and hit testing. Allow shorter rows to use their width without creating disproportionately large content. Keep play fitted and non-scrolling; document infeasible tiny-window limits instead of silently shrinking below the touch floor.
3. Extend focused layout/gesture regressions and browser rotation/preview checks, then validate representative native rotation and accessibility behavior. The eventual PR should show genuine matched baseline/final UI evidence and functional playback checks; these are prospective checks.

Settle this geometry before #30's transition implementation, using a merged base or coordinator-pinned parent. No dependency on accounts PR #29 or deferred grants PR #20 is established.

[Source request, inspected code and planning experiment](https://github.com/MChartier/little-say/issues/31#issuecomment-6029167414).

## Implementing Codex task

Verified implementation task ID: `01a11405-db71-76ed-9ec6-44717ef3402a`. No verified shareable URL was returned. [Implementation checkpoint](https://github.com/MChartier/little-say/issues/31#issuecomment-6029662109).

## Implementing PR

[PR #34 — Balance storyboard cards across portrait and landscape](https://github.com/MChartier/little-say/pull/34) (draft).