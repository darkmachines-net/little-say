# Release implementation

The only publication workflow is `.github/workflows/cut-release.yml`. `npm run release:cut -- <stage>` invokes `unified.ts`; `release:plan` runs the read-only plan/check/export path. Use the workflow for mutations. All provider commands use pinned dependencies and the exact protected source tree.

| File | Responsibility |
| --- | --- |
| `contract.ts` | Versioned plan, portable native baseline, operation journal, and completion receipt contracts |
| `inputs.ts`, `planner.ts` | Committed component/dependency identities, per-profile comparisons, selective/forced operations and independent version allocation |
| `metadata.ts`, `candidate.ts` | Combined version-only PR, normal protection/review, full repository/PostgreSQL checks, and exact merged-tree validation |
| `journal.ts`, `operation.ts` | Immutable draft-release assets, per-operation sequence/IDs, recovery reconciliation and ambiguity stops |
| `image.ts` | Legacy image verification, multi-architecture immutable publication, and guarded `latest` promotion |
| `expo.ts`, `eas-credentials.ts`, `environment.ts` | Pinned EAS reads, remote identities/credentials/environment, runtime resolution and export |
| `cloud.ts` | Finished platform builds, artifact SHA-256 proof, and exact-ID production submissions |
| `ota.ts` | Runtime eligibility/retirement/deduplication, validated exports, raw group/payload verification |
| `unified.ts` | Stage boundaries, source/destination guards, completed baseline selection and final release readback |
| `native.ts`, `native-contract.ts` | Existing local build/install/submit operations and local/cloud baseline OTA validation |
| `deploy.ts` | Separate explicit server deployment and health-checked rollback |

`apps/mobile/fingerprint.config.js` is shared by EAS and the local fingerprint subprocess. It includes native modules/plugins, resolved Expo configuration, native identity, selected build profile/toolchain, and its own policy. Version-only overlays flow through `release-metadata.cjs`. Raw metadata is replaced with resolved content so an older runtime can be checked without editing tracked source. The hook excludes only other-platform/web configuration and non-native scripts; full fingerprints retain the selected runtime and native settings. The selected platform is passed explicitly by wrappers. `.gitattributes` keeps tracked text bytes portable across operating systems.

Planning normalizes the three allocated version fields; publication never treats that normalized identity as full runtime proof. Each OTA baseline also requires full fingerprint equality after resolving its own native version metadata, same project/server/profile/environment, and source ancestry. The committed `release-policy.json` lists imported verified cloud baselines and retired runtimes. Retirement is explicit and does not delete prior evidence.

Candidate assets are append-only and operation keys have one writer each. `intent` records precede remote requests; `running` records persist accepted IDs; `complete` records contain verified evidence. A failed request response is not evidence that no operation occurred. Recovery queries exact run markers or build-associated submissions; zero matches after an unresolved intent, or multiple matches, stop for operator reconciliation. Only a terminal provider failure permits automatic replacement. Normal retries cannot change the run's input plan or allocated versions.

Completion is deliberately last. A published receipt, not a server Git tag, workflow start, queued build, or candidate draft, advances client baselines. Partial artifacts remain visible while the unresolved candidate blocks subsequent cuts. Provider operations and aliases cannot be one atomic transaction; the journal preserves enough evidence to finish safely after a crash. See [the operator recovery guide](../../docs/releases.md#workflow-and-recovery).

Tests use in-memory provider/journal failure injection and temporary Git repositories, plus the real Expo fingerprint library. Keep acceptance tests focused on source movement, version allocation, provider identity, and recovery rather than reproducing implementation details. Run `npm run check`, `npm run test:integration`, and `actionlint` before changing the workflow contract. Actual EAS signing/build/submission/OTA onboarding is a separate publishing validation stage.
