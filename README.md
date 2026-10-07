# Independent QA for Little Say PR35

Verdict: **changes-required**, communication only, for the exact revision/body in [qa-verdict.json](qa-verdict.json). No product defect or scope finding.

Independent ZBook QA recaptured all 30 request/profile/transport records and all presets against actual master and the final head. Both captures match byte-for-byte, including whitespace, Unicode and literal substitutions. Six focused maintained tests passed. Fresh source/ESM runtime and invalid-resource checks passed; exact retained Metro bundle bytes match their recorded hashes and keep server prompts out. [Behavior reproduction](reproduction.json), [boundary results](boundaries.json), [complete scope](scope.json) and [full feedback dispositions](feedback.json).

Docker execution remains unperformed: its engine is unavailable. The unchanged Docker copy contract, static resource embedding and source-free production runtime cover the changed packaging boundary. This is a genuinely non-UI extraction; no screenshot comparison or native device run is claimed. Current-head CI includes the complete check and PostgreSQL integration; the retained 17 mocked Chromium tests and web/iOS/Android exports were assessed, not unnecessarily repeated.

C1: remove the final PR-body sentence saying independent QA is pending. It becomes stale with this completed assessment. The existing owner should make this narrow correction and this same reviewer should recheck the new exact body and full feedback, with no unrelated test repeat. The supplied pr-review-v3 standard requires removing stale QA-pending status; readiness is withheld until that final communication gate passes.

## Retention

Evidence-only ref: evidence/qa-pr35-20261007. Owner: independent QA task 01a11461-180f-73dd-8d1c-3e2f64ae7027. Keep this ref and immutable commits for PR review and audit; never merge into product branches. Existing owner evidence and old receipts are preserved. No source/readiness/draft/merge/release/deploy mutation is performed by this review.

## Reproduction

The original task used clean detached qa-base and qa-head worktrees at the full SHAs in scope.json. npm ci --ignore-scripts installed locked external dependencies in qa-head. The capture harness shares these external dependencies but explicitly aliases @little-say/core to each corresponding source checkout. Run node reproduce.cjs with those checkouts, then the four maintained prompt test files with one Vitest worker. Run the existing server build followed by node boundaries.mjs; that harness records its read-only retained client bundle inputs. Source capture and fault harnesses are retained here for audit only.
