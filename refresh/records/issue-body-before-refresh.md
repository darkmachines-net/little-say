## Problem

The user reports that selecting a language in the board or individual-card editor changes speech generation while the text stays English. Parents need to see the generated translation, correct its label or spoken words, and regenerate pronunciation from those corrections.

Source review found existing translation editing in a separate card section, but the main language picker changes the source language and the board preview renders source text. The affected runtime/build has not been reproduced.

## Requirements and acceptance

- After translations are accepted, selecting an editing language shows that language's card labels and editable label/spoken-text fields. Opening a card from the board preserves that selection. Selecting English/original restores the source fields without rewriting them.
- Correct a translated label and spoken phrase, switch languages, save, reopen and reload: the correction persists; source English, other translations, card IDs/order and media remain intact. Language switching retains unsaved drafts; Cancel retains the existing saved content.
- Missing or stale translations are clearly identified and can be entered or prepared. Never present English as an existing translation or silently synthesize it with the target-language voice. Preserve fixed-language cards and the separate play setting for switching speech only.
- Manual corrections survive missing-translation preparation and unrelated AI edits. Source changes mark affected translations for review and retain corrected text; replacing a correction requires an explicit reviewed choice.
- Generate/regenerate and preview use the selected variant's exact current spoken text and language. A spoken-text/language change makes earlier audio unavailable for that new input; label-only edits need not regenerate unchanged speech. Old requests cannot overwrite text or appear ready for another variant.
- Switch language/card during delayed generation, cancel, fail and retry: drafts and saved corrections survive, responses remain tied to their original inputs, and status belongs to the displayed variant. Failed saves remain visibly unsaved and retryable; translation/audio failures do not erase text. Existing consent and automatic-audio preferences remain respected.

## Implementation plan

1. Give the existing board/card editors one explicit editing-language context, separate from source-language metadata and enabled play languages. Render resolved variants while editing the original card by ID; make source-language changes deliberate.
2. Reuse per-language storage and serialized persistence. Centralize variant updates and protect manual corrections in translation/proposal merges; preserve stale corrected text for review and read older libraries without loss.
3. Keep existing normalized text-plus-language audio identity and response validation. Bind asynchronous translation work to board revision, card/source, target language and draft generation; invalidate obsolete UI completions and stop obsolete previews.
4. Extend current language/audio regressions with both editor entry paths, correction/save/reload, protected merges, missing translations, delayed results and failure/retry. Validate representative browser and native flows with synthetic data; these checks are prospective.

Coordinate shared `BoardEditor` geometry with #31 and selected-language/draft handoff with #30. Their layout, hold and navigation changes remain separate. PR #29 overlaps persistence/schema/audio files and keeps its existing owner; no dependency on accounts or deferred grants PR #20 is established. Playback recovery #28 is excluded.

[Source findings and detailed plan](https://github.com/MChartier/little-say/issues/32#issuecomment-6029282445).

## Implementing Codex task

Implementation owner: verified Codex task `01a1140f-ccd2-765d-a393-3ad6dd4ec02b`. The later [implementation and draft-PR authorization](https://github.com/MChartier/little-say/issues/32#issuecomment-6049549105) supersedes the original planning-only assignment.

## Implementing PR

[PR #38 — Edit translations in the selected board and card language](https://github.com/MChartier/little-say/pull/38) (draft). Review order: #34 → #36 → #38; this child targets #36.
