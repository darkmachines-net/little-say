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

## Live AI evaluation

```sh
npm run eval:ai
npm run eval:ai -- --filter profile
npm run eval:ai -- --filter setup
```

This opt-in script makes billable backend model calls using the same key resolution as local development. It checks complete boards, clarification/refinement, language profiles, explicit language overrides and retained card/photo references, and reports correctness and duration. Some cases make multiple conversational turns. It does not run in ordinary tests or CI, and it does not measure real-device speech quality.

## Native and deployment checks

Before distribution, exercise a signed native build on iPad and Android: tap/swipe/multitouch, unlock, system containment, selected-language pronunciation and offline voices, generated audio and volume/silent-mode behavior, microphone permissions, native photo cropping, background/restart recovery, and local save failures. Expo Go does not demonstrate standalone launcher/splash, signing, OTA or system-containment behavior.

Validate server connectivity and HTTPS from the actual tablet. Native signing, store submission, OTA application, and server deployment need their configured targets and the checks in [the release guide](releases.md). Browser or unit-test success does not prove installation or rollout. Use `npm audit` for current dependency advisories rather than a checked-in audit snapshot.
