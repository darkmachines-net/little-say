# Issue43: restore iOS JavaScript export

Retained nonmerged evidence owned by task 01a11ca6-7faa-7628-8031-ac89bc018019. Keep this ref and immutable commits for review/audit; never merge it into a product branch. Original account history and PR35 remain untouched.

Baseline actual master: fabb925cf5ee11171d5668af7c2bab44ec9fc613. Final source: a570b52c357cddf45d2f5371842e8855f32be8b3. No stacked parent.

## Before and after observable contract

A fresh locked baseline install cannot resolve the prop-types import from the exact AppleButton.ios.js package location: [baseline probe](issue43-baseline-probe.json). Its full iOS export fails with that error: [baseline export](issue43-baseline-ios.log).

A separate fresh locked final install resolves prop-types15.8.1 and the oneOf/number APIs used by the same unchanged AppleButton file: [final probe](issue43-final-probe.json). Both complete native JavaScript exports pass: [iOS/Android log](issue43-native-exports.log). [Repository check log](issue43-check.log) includes web export, server build, release metadata, types and unit checks.

Both installations began without node_modules and have distinct real directories, verified in the probes; neither is a dependency junction. The integrity-checked npm download cache was reused. Baseline used master before the two manifest/lockfile edits; the final source was committed and cloned independently before npm ci. Exact install logs, commands, source identities and output hashes are in [provenance](provenance.json). The earlier junction-based investigation remains linked with its original identities and is not relabeled as a fresh installation.

## Dependency choice and scope

Apple authentication2.5.1 imports prop-types but does not declare it. The app now supplies ^15.8.1 as a production dependency, matching the app's semver conventions. The lock pins prop-types15.8.1 and nested react-is16.13.1 to npm registry URLs and integrity hashes. Existing loose-envify, object-assign and js-tokens are reused. [Complete lock audit](issue43-lock-audit.json) verifies every existing entry's version, integrity and classification stays unchanged. The final product commit changes only apps/mobile/package.json and package-lock.json, +19/-0. No tests, providers, core/package exports, release workflows or unrelated dependencies are altered.

## Reproduce and limitations

In independent clean checkouts of both source SHAs, run npm ci with Node24/npm12.0.1 (repository has no exact npm pin), then run the recorded Expo export command from apps/mobile. Run npm run check on final. Probe with node probe-issue43.mjs <checkout> <phase> from an external scratch directory. Harness and log bytes are bound by manifest.json. Build bundle files remain retained in the validation checkout; provenance records exact SHA256 hashes.

This is genuinely non-UI dependency resolution. Actual CLI/module-resolution output establishes the before/after contract; no fabricated UI capture is needed. Export success does not establish a signed native build, device behavior, TestFlight readiness or actual Apple sign-in. No credentials, providers, cloud builds, releases, uploads, deployments or merges were performed.
