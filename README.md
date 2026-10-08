# PR35 integration evidence

Retained nonmerged evidence, owned by task 01a11ca6-7faa-7628-8031-ac89bc018019. Keep this ref and immutable commits for review and audit. Original worktrees, source, capture records and QA receipts remain preserved.

Actual master: fabb925cf5ee11171d5668af7c2bab44ec9fc613. Corrected source: 0e2758de446674c4874bbce1df4eb51abaee35f4. No stacked parent.

## Observable contract

This extraction changes no meaningful UI flow. Fresh synthetic captures on isolated actual-master and corrected checkouts are byte-identical: [comparison](comparison.json), [before requests](before/payloads.json), [after requests](after/payloads.json), [before presets](before/presets.json), [after presets](after/presets.json). Thirty serialized request/options captures cover all affected operations, both picture styles, three speech languages and literal hostile-looking data, default/configured models, transport and cache profile. Three starter topics/templates and all conversation presets match. Callbacks and AbortSignal internals are not JSON; maintained tests assert signal identity. These fresh captures also match original e652fa1 evidence bytes; historical sources are not relabeled.

[Capture harness](capture-current.mjs) copies maintained tests into temporary capture files and restores/removes only its own files. Baseline uses identical locked dependencies via a junction, with explicit Vitest core alias to baseline source. Only capture sinks and original UI literal reading differ. Each executed harness and config is retained in before/after.

## Results

- [npm run check](check-final.log) passed: release metadata, workspace/script types, 294 tests in 43 files, production server and web build. Includes resource invalid/missing-field boundaries and source-free ESM test.
- [17 mocked Chromium setup/conversation scenarios](browser-final.log) passed on dedicated port 4598, Chromium 153.0.8010.12. Setup languages, partial success, failed saves, cancellation and conversation behavior remain intact. No UI screenshot comparison is claimed.
- [Runtime report](runtime-report.json): source tsx loading passes; relocated production dist returns HTTP 200 with AI disabled on port 4599 and no source/prompts directories copied. The unchanged Docker dist-copy contract is checked, but no Docker run is claimed.
- [Android export](android-export.log) passes. Runtime verifier finds shared presets and no server prompt markers in web and Android bundles, with exact hashes recorded.
- **iOS export remains blocked**: [corrected-source failure](native-export.log) and [actual-master failure](baseline-ios-export.log) both show missing prop-types imported by @invertase/react-native-apple-authentication/lib/AppleButton.ios.js. The account dependency/configuration is identical to master. No unrelated dependency fix or iOS pass is claimed. Native-device execution remains deferred.

## Reproduction and scope

Run npm ci with locked dependencies, npm run check, then capture-current.mjs from the task workspace. Export Android from apps/mobile with npm exec -- expo export --platform android --output-dir dist-native --max-workers 2. Repeat with --platform ios to reproduce the blocker. Browser config differs only in isolated paths/port and explicitly disabled providers. Run verify-runtime-current.mjs after builds. Full harnesses, logs and hashes are retained. Native/web bundles remain locally retained under the task clone; their immutable identities are in runtime-report.json.

[Complete published scope](scope-assessment.json) maps every live API path and both published commits; [incoming target history](incoming-target-history.txt) explicitly inventories all five already-merged target commits and their paths. Final actual-target scope remains 21 files, +342/-30. Original extraction plus ordinary integration merge preserve all prior history. No evidence churn or unrelated commit is introduced into the published range.

[Historical identities](retained-originals.json), [environment and ownership](environment.json), [live bindings](bindings.json), full feedback and review readbacks are retained here. Current PR body and final CI readback are recorded separately after publication. Same independent QA task 01a11c7c-11db-70b8-ba73-efe3693b003e must reassess; this is implementation evidence, not a readiness verdict.
