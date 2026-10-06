## Problem and solution

Families need to recover boards and saved media after reinstalling or moving devices without giving up local, offline use. Optional Firebase sign-in enables consent-based backups to the selected server; guest libraries stay local and sign-out keeps downloaded boards.

[Draft PR24](https://github.com/MChartier/little-say/pull/24) carries the accounts-only implementation on [PR20](https://github.com/MChartier/little-say/pull/20). Review and merge the parent first. Original [PR11](https://github.com/MChartier/little-say/pull/11) and its evidence remain preserved; the former unknown-owner hold is resolved by the separately owned continuation.

## Verification and remaining gates

[Current-head CI](https://github.com/MChartier/little-say/actions/runs/37415135338) passed 235 unit tests, 40 PostgreSQL/Auth-emulator contracts, and three account-browser scenarios. [Genuine consent, restore and offline-recovery evidence](https://github.com/MChartier/little-say/blob/be04838347a23a3055d0874f0761f22a4112ff99/v2/README.md) shows the new flow against the actual parent baseline.

Same-owner corrections await independent QA reassessment. Actual authenticated GitHub rendering remains unverified; real-provider and native-hardware checks are unperformed. No provisioning, provider activation, legacy migration, release, deployment or TestFlight work is included. Only the coordinator can award readiness.

[Entire original issue body, preserved before this update](https://github.com/MChartier/little-say/blob/be04838347a23a3055d0874f0761f22a4112ff99/v2/issue19-original.md).
