## Problem

Parents can select Russian for speech while the board preview and primary card fields still show English. Translation fields exist farther down the card editor, making it difficult to see and correct the selected language consistently.

## Requirements and acceptance

- Show the selected editing language's labels and spoken words in both editors, including direct entry from Play. Keep original-language metadata and play-label preferences separate.
- Preserve corrections through language switches, save/reopen/reload and account context changes. Keep original words, other languages, IDs/order, media and fixed-language cards intact. Cancel must discard unsaved changes.
- Identify missing/stale translations honestly. Retain saved corrections for review after source edits; never pass source English off as a translation or silently delete variants.
- Protect manual and legacy translations during preparation and AI merges. Replacement needs an explicit reviewed decision. Manual or AI source-language changes must not hide a protected translation.
- Bind generated/preview audio and asynchronous results to exact spoken text, language, card and revision. Label-only edits may reuse matching audio; delayed or cancelled work must not affect another variant.
- Failed saves and translation/audio requests must retain corrections and support retry. Preserve consent, automatic-audio preferences and existing account backup/restore behavior.

## Implementation plan

1. Reuse the existing board/card editors and per-language storage with one explicit editing-language context and guarded variant updates.
2. Preserve manual corrections in translation/proposal merges and share source-language collision validation across manual and AI paths.
3. Validate editor entry, correction persistence, cancellation/retry, exact audio identity and account integration. Compare genuine current-master and proposed UI builds; native-device execution remains deferred.

Original requirements, detailed plan and superseded stack context are preserved in the [original issue record](https://github.com/MChartier/little-say/blob/c2331b99cc3bc6a71b84ac79442beb8fc45e6222/refresh/records/issue-body-before-refresh.md) and [source analysis](https://github.com/MChartier/little-say/issues/32#issuecomment-6029282445). Prompt extraction, release retirement and unrelated playback work remain separate.

## Implementing Codex task

Current replacement implementation owner: verified task `01a11cbb-ec94-715f-a3e4-7aa82a416016`. The original owner's task and checkpoint are preserved in the linked historical record.

## Implementing PR

[PR #38 — Edit translations in the selected board and card language](https://github.com/MChartier/little-say/pull/38) (draft), targeting current master. PR34 and PR36 are merged; there is no unmerged prerequisite. Independent QA and review readiness remain coordinator-owned.
