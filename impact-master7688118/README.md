# Actual-target reconciliation after PR35 merge

Original PR46 head373fc57 and original body are preserved, as are manual run37871534382, local PostgreSQL17/Auth validation, and all prior evidence commits. Human-merged master768811832bd0b389ba7e24738fb58800ea145000 adds21 prompt-resource paths: server JSON imports and substitutions, shared preset exports and mobile imports, exact-payload/preset tests, and a source-free bundle regression.

The release validator, emulator wrapper, package scripts/dependencies, Firebase config, release guards and all eight PR46 product files are unchanged from373fc57. Earlier missing-emulator reproduction, controlled startup/test failure propagation, real UTF8-fixture correction, lifecycle cleanup and isolation evidence still apply to these unchanged paths. They are not claimed to certify the new combined application builds.

Because check builds/imports the changed source, the owner integrated master additively in0ba43ba036dddc1ff60dea4b82ee7c8f495066d2. Parents are373fc57b9bee58160cbe924019f41161d4c02e48 and768811832bd0b389ba7e24738fb58800ea145000. Merge-base and actual target are7688118. The complete live PR range contains two commits (original correction, additive integration), with only the same eight changed files; merged PR35 files are part of the base, not additional PR scope.

Local affected checks passed11 tests in5 files: exact payload/preset/resource validation, real source-free Node ESM bundles, and validation command/isolated job guards. No provider request or device check was run. The authorized validation-only run37872957939 re-exercises the combined source checks, builds, PostgreSQL17 and demo Auth on the exact new published head. Existing PR CI is unchanged and runs independently. Final run receipts and logs accompany this record.

No Project mutation was performed in this reconciliation. No normal release, candidate, registry, signing, publishing, deployment or credential operation was added. The original quota-only bot refusal remains historical at373fc57; it is not represented as a completed current-head review and was not retried. Same independent QA must assess the final combined source and body.

Final results: manual run37872957939 passed325 unit tests,25 PostgreSQL/Auth integration tests, types and builds with emulator/database shutdown; all six release jobs skipped. Current PR CI37872940191 passed the combined source on merge3f2169fc93c7344f6081ef0eead21442842febb1, including its five account-browser scenarios. No extra automatic CI execution was introduced.
