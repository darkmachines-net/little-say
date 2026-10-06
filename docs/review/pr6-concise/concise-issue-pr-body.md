## Problem

Ambiguous emoji can make a child's communication board harder to understand. Parents also need enough room to review a draft while refining it.

## Proposed change

[PR #6](https://github.com/MChartier/little-say/pull/6) adds automatic emoji/library/generated-picture selection and a full-page draft workspace. Keep explicit save and stop controls, source choices, protected personal photos, offline saved pictures and clear picture-data disclosure. The published web introduction and `/app` entry are included. This tracks the existing implementation, not additional scope.

## Acceptance and proof

- Pictures clarify ambiguous cards without replacing suitable emoji or protected photos.
- Fallback, stopped work and save/retry leave usable boards; saved pictures work offline.
- Genuine matched Before/After screenshots and behavioral checks demonstrate the result in [PR #6](https://github.com/MChartier/little-say/pull/6).

Current CI and focused browser checks passed. [Independent QA](https://github.com/MChartier/little-say/pull/6#issuecomment-6002210899) found no product defect but could not inspect the authenticated GitHub page. That visual gate and review of the revised summaries remain outstanding; physical-device and live-provider testing are not claimed.

Review PR #6 before dependent foundation PR #15. TestFlight preparation stays separate in #12. [Preserved original requirements and tracking history](https://github.com/MChartier/little-say/tree/6600f14dbc81aa9fd034885d162dde14a0535d41/docs/review/pr6-concise/original-issue.md).
