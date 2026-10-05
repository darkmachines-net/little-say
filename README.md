# PR6 independent QA retained evidence

Purpose: preserve independently reproduced checks and the exact remaining rendered-PR access blocker. This is an evidence-only ref, never a product merge target.

Owner: independent QA native task 01a10da8-bad8-77a2-bdd7-09d4bb04c02f on MCHARTIER_ZBOOK. Retain through PR6 review/merge/closure and until the human or coordinator explicitly retires this evidence; preserve all historical source references.

Assessed source: 2be85f0cb02cd5ba464f46c623b9b19cf5061231. Actual master/base: 5d72992c77fbb09195518e257d799501b7db4d04. No parents. PR body SHA256: 2fe5278a6f2294df4b46fa2016e05f469a143f0a054d82b65bfc50267e9628f2.

Fresh isolated detached checkout, clean throughout product review. npm ci --ignore-scripts --no-audit --no-fund; npm exec vitest run apps/server/test/pictures.test.ts apps/mobile/src/services/pictures.test.ts packages/core/src/pictures.test.ts passed 38 tests (including 16 server picture tests). npm run build passed. npm exec playwright test -- --config artifacts/qa/playwright.config.ts tests/web/pictures.spec.ts tests/web/conversation.spec.ts tests/web/setup.spec.ts --max-failures=1 passed all 32 scenarios. Chromium 153.0.8010.12 with existing browser cache, production app on isolated port43167. Initial default-port collision and missing default browser binary were recovered without stopping another worker or downloading a browser. No live paid AI calls.

CI run37364731059 attempt2 succeeded at the same source; job111953412751 logs were independently API-read and show 205 tests across23 files. This full count is CI evidence, not a repeated full local suite. Configured latest engineering review reports no major findings on this head.

All ten images in the main PR body were opened and their pixels inspected. Exact bytes were verified against immutable refs and authenticated GitHub Contents API. The two provenance indexes verified all32 and26 referenced files, with manifest/harness/fixture contents independently read. See provenance-verified.json and images-verified.json.

Required actual rendered PR remains unverified. Attempt1 CUA inventory and attempt2 CUA reset plus fresh Edge tab failed kernel initialization with deny-read ACL errors. Distinct attempt3 fresh Chromium reached the actual GitHub URL but received404 because it had no authenticated private-repository session. github-access.png was visually inspected: GitHub404/Sign in, not the PR. No user browser profile, credentials, or tokens were extracted. API Markdown rendering is not substituted for the actual page.

Expected next action: restore authorized authenticated browser control; inspect the unchanged final GitHub PR, all embedded pairs, labels and layout, then publish a superseding scoped verdict. No baseline waiver or human readiness is claimed.
