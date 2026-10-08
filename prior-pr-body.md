## Summary

Little Say's model instructions and starter messages are embedded in business logic, making prompt changes difficult to find and review. This moves the existing text into documented top-level JSON resources with typed validation and literal substitution. Models receive the same requests, and parents see the same presets and behavior.

Server prompts stay server-only; shared presets work through the existing Node/Expo builds without Docker or package-script changes. Deferred ChatGPT grants in PR20 are outside this change. PR26 is merged; account PR24 was replaced by PR29 and is not a prerequisite.

Closes #23.

## Test plan and behavior evidence

| Scenario | Expected and observed | Evidence |
| --- | --- | --- |
| Run the same synthetic requests against master and this extraction, including Unicode, quotes, dollar signs, braces and newlines. | Complete serialized model payloads and all starter/preset outputs are byte-identical. Both picture styles, speech languages, and default/configured models are covered. Deliberately removing the addendum newline fails the maintained regression test. | [Before/After captures and comparison](https://github.com/MChartier/little-say/blob/e652fa1ed0bd9c8f4d59f7eae05ac9abdb22264f/README.md#observable-contract) |
| Load prompts from source and a relocated ESM bundle; export web, iOS and Android. | Source and bundled loading pass. The relocated production server returns HTTP 200 with AI disabled. Client bundles contain shared presets and no server prompt markers. Invalid resources/substitutions fail clearly. | [Runtime and bundle results](https://github.com/MChartier/little-say/blob/e652fa1ed0bd9c8f4d59f7eae05ac9abdb22264f/runtime-report.json) |
| Create/refine starter boards and conversations with mocked providers, including cancellation and failed saves. | All 17 existing Chromium scenarios pass; prompts, drafts, consent and recovery behavior remain intact. | [Browser results](https://github.com/MChartier/little-say/blob/e652fa1ed0bd9c8f4d59f7eae05ac9abdb22264f/browser-final.log) |

### Non-UI observable contract

This is text/resource separation with unchanged UI and request behavior. Exact payload comparison is the relevant Before/After evidence; no visual change or screenshot comparison is claimed. Baseline is master `1f032905`; source under review is `ea87b78e`. [Immutable provenance and full source bindings](https://github.com/MChartier/little-say/blob/e652fa1ed0bd9c8f4d59f7eae05ac9abdb22264f/manifest.json) preserve the capture inputs, harnesses and build identities outside product history.

## Supporting checks and limitations

`npm run check` passed: release metadata, types, 217 tests, server bundle and web export. iOS/Android Metro exports and the source-free prompt bundle test passed. Docker's engine was unavailable, so no container build/run is claimed; resource inclusion was verified through the unchanged dist-copy layout and relocated runtime. Native device execution and live inference were not run. Revision-scoped independent QA verdicts are recorded in the PR discussion.