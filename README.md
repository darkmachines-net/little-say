# Issue 41 implementation evidence

Owner: Codex task 01a11c57-01a2-71f9-b53f-cbdee7d9b02e on verified mchartier_zbook. Retain this nonmerged evidence ref for independent QA and human review; never merge it into product history.

Product head: ca7066cffbee8f5b83cf126eb9e89c7e78a8db76
Actual target/base/merge-base: fabb925cf5ee11171d5668af7c2bab44ec9fc613 (master). One product commit; no stack/parent PR.

All 11 changed local source files were matched to the published Git blob IDs after normalizing Windows CRLF to repository LF. See scope.json. Tests used these source contents on Windows, Node 24.19.0, Vitest 4.1.11, installed with npm ci --ignore-scripts --no-audit --no-fund.

## Observable contracts

The previous candidate path only checked the base before preparation. The maintained candidate regression moves the base during validation; the new path rejects it before a merge request. A separate late-race case changes the merged tree after the last check; exact-tree rejection remains. The real Git fixture in planner.test.ts creates a legitimate dependency change between candidate validation and a squash merge, retaining the metadata guard's original unexpected-metadata failure. That fixture is locally blocked before assertions by captured subprocess EPERM, and remains required in CI.

Retirement fixtures execute the real retirement and Journal adapters against injected GitHub/Git responses: terminal stale source preserves the same draft release/assets under abandoned/123; old ID creation/read/planning fails; fresh ID creation succeeds only after verified retirement. Lost rename responses, denied rename, missing readback, mutated assets, absent byte digests and duplicate identity remain blocking. A subsequent fresh run completes an interrupted cleanup. Cancellation before plan upload is recoverable. Active runs, review waits, queued merges, prepared state, every provider operation state (including intent), unknown assets and possible provider-job execution are retained. An open PR is closed only after exact bot/repository/base/head checks; branches and merged versions are retained.

## Executed checks

- All four TypeScript projects passed with direct node node_modules/typescript/bin/tsc -p <project> --noEmit: packages/core, apps/server, apps/mobile, scripts.
- Final focused suite: 40 passed. Command: node node_modules/vitest/vitest.mjs run scripts/release/candidate.test.ts scripts/release/journal.test.ts scripts/release/unified.test.ts scripts/release/retirement.test.ts --configLoader native --pool threads --maxWorkers 1 --reporter verbose. Raw output: focused-tests.txt.
- Full suite: 304 passed, 10 execution failures across three files. Command: node node_modules/vitest/vitest.mjs run --configLoader native --pool threads --maxWorkers 1. Raw output: unit-tests.txt. All ten failures are captured Git/Node child-process EPERM; they are not passing or waived tests.
- git diff --check passed. File-level/public-function documentation reviewed.

Default Vite config bundling failed in its Windows net-use subprocess. Supported native config loading fixed startup without changing sandbox settings. A separate read-only probe verified child Git --version succeeds with inherited stdio and returns EPERM with pipe stdio. tsx/esbuild also fails at pipe startup. No escalation was used for tests.

## Unrun gates and boundaries

Local server/web builds, PostgreSQL/Auth-emulator integration, account-browser flows and actionlint remain unexecuted. CI is requested by the product draft PR; consult its current exact-head result. actionlint was not on PATH or in the checked local tool locations. No real release, candidate retirement, provider request, EAS spend, deployment, merge, secret retrieval or credential setup occurred. No meaningful UI change exists; CLI/state contract evidence applies, not screenshots.

## Historical failure (read-only refresh)

Run 37716705314: source b0d2df116db2f5a4e7aaf4edd56017d3d9f664f1; failed preparation, all five downstream jobs skipped. Account merge da45fbdef33cd78abcbbd6a8216ac9b34d460e22 intervened. Version PR40 candidate c63fc27fdc2d4d4a1932db4ef2951f7752ab9907 merged as fabb925cf5ee11171d5668af7c2bab44ec9fc613. Existing draft release ID 406337325 retains candidate.json asset620451605 and plan.json asset620446963. These were not mutated. The new code must be merged and a separately authorized fresh cut dispatched to use reconciliation; abandoned historical runs must never be rerun because old checkouts lack tombstones.
