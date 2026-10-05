# Testing

Run from the repository root with Node 24 (`npm.cmd`/`npx.cmd` on Windows):

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:web
```

`check` validates release-version mirrors, TypeScript (including unused locals/parameters), unit/component/service tests, and server/web builds. GitHub runs this check for pull requests. Browser tests use the production web build from `check`, start a temporary API on port 4175, and use isolated device libraries. They run without an API key and mock AI, speech and microphone services where appropriate. Existing development processes and user boards are not used.

The suites cover touch gestures, unlock timing, bounded speech, persistence and failed saves, setup, multilingual boards, conversational editing, photo framing, offline playback, and release-contract guards. Browser screenshots, traces, builds and temporary fixtures belong under ignored `artifacts/`, `test-results/` or `playwright-report/`. Selected [PR review screenshots](screenshots/little-say-branding/README.md) are retained separately.

Account tests cover authenticated asset isolation, recovery/session revocation, complete-backup validation, revision conflicts, and durability after restarting SQLite. `tests/web/accounts.spec.ts` uses two isolated browser devices and the real API to restore photos, illustrations and downloaded speech byte-for-byte, merge offline edits, preserve boards after sign-out, and verify account-free setup makes no account request. Its separate database lives at `.cache/test-accounts.sqlite`; it never uses development account data. Review captures are under `artifacts/screenshots/accounts/`. Native SecureStore, reinstall recovery, and restored playback still need validation in new signed Android/iOS builds before distribution.

## Live AI evaluation

```sh
npm run eval:ai
npm run eval:ai -- --filter profile
npm run eval:ai -- --filter setup
```

This opt-in script makes billable backend model calls using the same key resolution as local development. It checks complete boards, clarification/refinement, language profiles, explicit language overrides and retained card/photo references, and reports correctness and duration. Some cases make multiple conversational turns. It does not run in ordinary tests or CI, and it does not measure real-device speech quality.

## Native and deployment checks

Picture unit and browser tests cover ambiguity, opt-in generation, immutable downloads, source attribution, draft retention, migration, explained source selectors, keyboard dismissal/focus, and card inheritance. `npm run eval:pictures -- --generate` is an opt-in billable six-vehicle evaluation that saves pictures and an HTML contact sheet under `artifacts/picture-evaluation/`; inspect the actual output for the required vehicle structures. Run `npm run eval:pictures -- --animals --generate` to prepare a same-label emoji/library/generated comparison with six real Mulberry assets and up to six generated color pictures. Automated model review is evidence to inspect, not a guarantee of semantic correctness. Native checks also include transparent PNG framing, offline restart and picture-save failures.

After both evaluations and a web build, `npx tsx scripts/capture-picture-evidence.ts` captures the construction board, all three animal visualizations, collapsed and expanded source selectors, and editing controls in isolated tablet/phone browser sessions without further AI calls. The [picture evidence index](screenshots/card-pictures/README.md) distinguishes live generated assets, real library artwork, emoji comparisons, automated checks, and physical-device follow-ups. Compare the previous PR commit's control captures with the new selectors; do not present a content comparison as an older application build.

Before distribution, exercise a signed native build on iPad and Android: tap/swipe/multitouch, unlock, system containment, selected-language pronunciation and offline voices, generated audio and volume/silent-mode behavior, microphone permissions, native photo cropping, background/restart recovery, and local save failures. Expo Go does not demonstrate standalone launcher/splash, signing, OTA or system-containment behavior.

Validate server connectivity and HTTPS from the actual tablet. Native signing, store submission, OTA application, and server deployment need their configured targets and the checks in [the release guide](releases.md). Browser or unit-test success does not prove installation or rollout. Use `npm audit` for current dependency advisories rather than a checked-in audit snapshot.
