## Summary

Little Say's model instructions and starter messages are embedded in business logic, making prompt changes difficult to find and review. This moves the existing text into documented top-level JSON resources with typed validation and literal substitution. Models receive the same requests, and parents see the same presets and behavior.

Server prompts stay server-only; shared presets use the existing Node/Expo loading paths. The current account exports are preserved. Deferred ChatGPT grants in PR20 remain outside this change.

Closes #23.

## Test plan and behavior evidence

| Scenario | Expected and observed | Evidence |
| --- | --- | --- |
| Run matching synthetic requests against actual master and the extracted resources, including Unicode, quotes, dollar signs, braces and newlines. | Complete serialized payloads and all starter/preset outputs are byte-identical across affected operations, both picture styles, speech languages and default/configured models. | [Fresh Before/After captures and comparison](https://github.com/MChartier/little-say/blob/524cf7aa5866abf105537e882192325ca812615e/README.md#observable-contract) |
| Load from source and source-free ESM; export clients. | Loading passes; relocated production server returns HTTP 200 with AI disabled. Web/Android contain shared presets and no server prompt markers. Invalid resources/substitutions fail clearly. iOS is blocked as described below. | [Runtime and bundle results](https://github.com/MChartier/little-say/blob/524cf7aa5866abf105537e882192325ca812615e/runtime-report.json) |
| Create/refine starter boards and conversations with mocked providers, including cancellation and failed saves. | All 17 Chromium scenarios pass; prompts, drafts, consent and recovery remain intact. | [Browser results](https://github.com/MChartier/little-say/blob/524cf7aa5866abf105537e882192325ca812615e/browser-final.log) |

### Non-UI observable contract

This is text/resource separation with unchanged UI and request behavior; exact payload comparison is the relevant Before/After evidence. Fresh captures compare actual master `fabb925c` with corrected source `608b8847`. [Full source/harness bindings](https://github.com/MChartier/little-say/blob/524cf7aa5866abf105537e882192325ca812615e/manifest.json) and [historical identities](https://github.com/MChartier/little-say/blob/524cf7aa5866abf105537e882192325ca812615e/retained-originals.json) are retained outside product history.

## Supporting checks and limitations

`npm run check` passed: metadata, types, 294 tests, server build and web export. Android export and source-free ESM checks passed. **iOS export fails on both actual master and this source** because Apple authentication imports missing `prop-types`; [both reproduction logs](https://github.com/MChartier/little-say/blob/524cf7aa5866abf105537e882192325ca812615e/README.md#results) are retained. No dependency fix or iOS pass is claimed.

Docker execution remains unperformed; its unchanged dist-copy contract and relocated runtime were checked. Native-device checks are deferred, and live inference was not run. [Current-revision CI](https://github.com/MChartier/little-say/actions/runs/37821917724) and revision-scoped independent QA verdicts are recorded separately; the quota-refused bot did not complete review.
