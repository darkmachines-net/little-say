## Summary

Cut release failed on current master because its integration command did not start the required Firebase Auth emulator. Reuse the maintained demo-emulator wrapper while keeping every PostgreSQL and authentication test mandatory.

A manual **validation_only** option now runs the same source-validation boundary on a selected branch with disposable PostgreSQL. It uses read-only checkout permissions without persisted credentials; every candidate, registry and provider/release job is excluded. Normal releases remain restricted to master. Existing PR CI is unchanged.

Closes #45.

## Test plan

- **Missing prerequisite → complete validation:** the unchanged Auth suite reproduced six missing-emulator failures. On the proposed source, the real local PostgreSQL 17/demo-Auth run and the [manual branch run](https://github.com/MChartier/little-say/actions/runs/37871534382/job/113630526873) both pass **319 unit tests and all 25 integration tests**, plus types and builds. Emulator cleanup ran; local fixture schemas were removed and PostgreSQL stopped.
- **Failure and isolation:** the lightweight subprocess regression rejects the old command and propagates startup/test failures. A real local fixture-encoding failure also stopped validation and cleaned up the emulator. The corrected UTF8 fixture passed. All six release jobs were verified skipped in the manual run. [Reproduction, raw results, exact source/base and cleanup evidence](https://github.com/MChartier/little-say/blob/42cfe8fa1b9fd748476253d60d126a913e2c6b5a/README.md).

[Existing PR CI passed](https://github.com/MChartier/little-say/actions/runs/37871489555), including five account-browser scenarios. The configured review bot [refused solely for quota](https://github.com/MChartier/little-say/pull/46#issuecomment-6072598630); independent review/QA remains required.

This non-UI change validates the real source-check boundary, **not a complete release**: candidate creation/retirement, signing, providers, publishing and deployment were not exercised. PR42's retained evidence covered normal CI and release safeguards but missed this separate command path; the original failure and historical evidence remain preserved.
