# PR24 account entry evidence

Purpose: retain matched UI evidence and complete published scope for the separately owned issue19 continuation. This evidence ref is not a merge target. Owner: accounts continuation task `01a10f7a-bf1e-7154-8695-468b946d4021`. Retain through review and any later historical-evidence needs; do not delete or rewrite without coordinated retention review. Original PR11 and its evidence remain unchanged.

Before: `344aded5566e310a703ffe48312bb26d8de77fef`, corrected PR20 parent. After/head: `74b721d095d0bd867ecaf5c093bfcf2c03e87eec`. Ultimate target master was `842ac7fc016fc708060886c1fe59271b7021fbb5`. The initial extraction checkpoint was `709fd719d7fcd579002bb57ecce20bc673ab01b8`; parent integration was additive. Published source was `f48a34cc501f54d05b8af1f4e3ee507372e3df3a`; its combined range was not copied into this PR.

## What the images establish

The setup pair shows the same fresh English-language setup with a new optional restoration entry. The settings pair shows the same empty guest library and open Parent settings: account/backup choices appear above the retained grant settings. Both screenshots are full 1180×900 originals at scale 1. The author inspected all four images. No UI was hidden, cropped, altered, or generated. These pairs demonstrate entry and optionality, not successful provider authentication or restoration.

`manifest.json` binds exact loaded bundle identities, server bundle identities, capture times, owned process IDs, browser version, fixtures, harness, and image hashes. The harness asserts a nonempty actually loaded App bundle for each source and compares downloaded bytes with the corresponding isolated build. Fresh browser contexts isolate storage and service workers. Both servers were spawned by this harness and stopped afterward. Fixed UTC clock, en-US locale, light theme, reduced motion, viewport and scale are identical. No account service is configured for either entry capture, and no remote provider is called.

## Reproduction

On the confirmed ZBook host, the baseline was created with `git archive --format=zip 344aded5566e310a703ffe48312bb26d8de77fef`, extracted into `accounts-before`, then `npm ci --ignore-scripts --no-audit --no-fund` and `npm run build` ran there. The After source uses the accounts worktree's own dependencies and `npm run build`. Its final type-only server annotation was followed by `npm run build -w @little-say/server`; it does not affect the web bundle. Each app uses its own core workspace, dependencies and build output. The archive digest in the manifest identifies the local source input; the source itself is retained by the immutable parent commit.

The adjacent `capture-accounts.cjs` contains complete setup, server environment, browser navigation, capture, byte comparison and teardown instructions. Run it from a directory containing `accounts-before`, `little-say-accounts` and a task-owned Playwright Chromium cache `browsers`; ports 4191 and 4192 must be free. Paths are runtime inputs, not deployed configuration.

## Behavioral verification and limits

[CI run 37415135338](https://github.com/MChartier/little-say/actions/runs/37415135338) passed at the After head: release/type/build checks, 235 unit tests, 40 PostgreSQL17/Auth-emulator integration tests, and three account browser scenarios. The browser scenarios verify email verification, complete photo/picture/speech restoration, offline conflict copies, local-preserving sign-out, guest setup without account requests, and account/server isolation. PostgreSQL tests include upgrade from populated grant tables and interrupted Apple-confirmation deletion work. Google linking uses synthetic emulator identity data, not a real provider.

Local checks also passed 32 guest/offline/grant Chromium scenarios and an Android JavaScript export. Export is not device execution, SecureStore hardware validation, native provider consent, Apple revocation, or installation. Docker was unavailable locally; PostgreSQL results above came from disposable CI. The local demo Auth emulator started and stopped successfully.

Rendered private GitHub PR inspection remains unverified: the in-app browser runtime exited on both attempts. Authenticated API retrieval is checked separately and does not satisfy rendered-page inspection. Independent QA must verify pixels, full published scope, provenance, rendered images, and any additional representative recovery evidence needed before readiness.
