# Issue45 validation evidence

Owner: existing release task01a11c57-01a2-71f9-b53f-cbdee7d9b02e. Retain this evidence branch and all commit-addressed records for PR46/issue45 review and future audit; do not merge it into product history or delete without human authorization.

## Observable Before/After

On actual master18aa7c0, the release validator called bare integration tests; the original hosted prepare log and local unchanged Auth test reproduction show six missing-emulator failures. The corrected373fc57 source uses the maintained test:services wrapper through the source-only release:validate entry point.

The real local PostgreSQL17.6/demo-Auth run and authorized hosted validation-only run37871534382 both pass319 unit tests and25 integration tests, plus type checks and builds. Hosted normal PR CI37871489555 also passes its five account-browser scenarios. The local first run failed on a WIN1252 fixture; its failure propagation and emulator shutdown remain recorded. A fresh UTF8 database then passed; no product code or test was weakened. Local cleanup confirms no fixture schemas or Auth listener and stops PostgreSQL.

## Reproduce without release operations

Install locked dependencies with npm ci. Start disposable PostgreSQL17, create an empty UTF8 database ending in _test, and set TEST_PGHOST/PORT/USER/PASSWORD/DATABASE to that fixture. Run npm run release:validate. The command runs check then test:services; the latter starts demo-little-say Auth at127.0.0.1:9099, runs all integration tests and stops the emulator. Stop the disposable database afterward. Never use release:cut or its dry_run for this credential-free check.

For hosted reproduction, manually select validation_only=true on Cut release at the reviewed branch. dispatch-graph-review.json binds the inspected workflow and gated job graph. manual-jobs-final.json proves validation succeeded while prepare/server/native/submit/ota/finalize were skipped. The hosted log records emulator and PostgreSQL shutdown. No automatic PR gate was added.

The lightweight maintained subprocess regression proves actual command selection and propagates controlled startup/test exits. old-command-regression.log shows it rejecting the old call. These synthetic assertions are distinct from real emulator/database evidence and neither establishes provider/publication behavior.

## Boundaries and retained history

This validates the actual release-source validation boundary, not the complete release pipeline. No live candidate, release journal, registry, provider build, signing, store, deployment or secret operation was exercised. Review bot comment6072598630 is a quota-only refusal, not a completed engineering review; same independent QA remains required.

PR42's original final-report172cd5b96b020b8c82fe14f09b29ec253d0d5b53/final-report.md and closed issue41 remain preserved. That evidence covered normal CI and retirement/source safeguards but missed the direct release validation prerequisites. The original dirty PR42 checkout is unchanged. The full source/base/parents/file inventory, fixture/build hashes, original log digest and evidence hashes are in manifest.json. Non-UI behavior is demonstrated through real command results; no screenshots or device execution are claimed.
