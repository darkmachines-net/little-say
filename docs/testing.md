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

Website tests in `tests/web/landing.spec.ts` cover desktop and phone layouts, keyboard navigation, inactive store placeholders, no library/API initialization on the homepage, direct `/app` access, and older installed-web-app launches. App scenarios start at `/app`. Landing-page captures are under ignored `artifacts/screenshots/landing/`; reviewed PR evidence is retained in [the website screenshot index](screenshots/website-landing/README.md). The native entry (`src/Entry.tsx`) exports only the shared app; after entry changes, export iOS and Android with source maps and confirm neither `Entry.web.tsx` nor `src/website/` appears in either native bundle's sources.

## Live AI evaluation

```sh
npm run eval:ai
npm run eval:ai -- --filter profile
npm run eval:ai -- --filter setup
```

This opt-in script makes billable backend model calls using the same key resolution as local development. It checks complete boards, clarification/refinement, language profiles, explicit language overrides and retained card/photo references, and reports correctness and duration. Some cases make multiple conversational turns. It does not run in ordinary tests or CI, and it does not measure real-device speech quality.

## Native and deployment checks

Picture unit and browser tests cover ambiguity, gap-only generation, direct first-send and voice actions without an opt-in screen, library-only requests, legacy settings, emoji fallback, immutable downloads, source attribution, draft retention, migration, explained source selectors, keyboard dismissal/focus, and card inheritance. Workspace scenarios check separate manual creation, conversational suggestions, complete emoji boards without illustration prompts, deliberate picture changes through settings, full-page navigation, reload and Back behavior, independently completed pictures, queued versus active indicators, animation across frames and reduced motion, settings during generation, clarification with a retained canvas, and offline playback of fallback boards. Partial previews cannot mutate saved boards or earlier preview snapshots. `npm run eval:pictures -- --generate` is an opt-in billable six-vehicle evaluation that saves pictures and an HTML contact sheet under `artifacts/picture-evaluation/`; inspect the actual output for the required vehicle structures. Run `npm run eval:pictures -- --animals --generate` to prepare a same-label emoji/library/generated comparison with six real Mulberry assets and up to six generated color pictures. Automated model review is evidence to inspect, not a guarantee of semantic correctness. Native checks also include transparent PNG framing, offline restart and picture-save failures.

After both evaluations and a web build, `npx tsx scripts/capture-picture-evidence.ts` captures the construction board, all three animal visualizations, collapsed and expanded source selectors, and editing controls in isolated tablet/phone browser sessions without further AI calls. The [picture evidence index](screenshots/card-pictures/README.md) distinguishes live generated assets, real library artwork, emoji comparisons, automated checks, and physical-device follow-ups. Compare the previous PR commit's control captures with the new selectors; do not present a content comparison as an older application build.

`npx tsx scripts/capture-workspace-evidence.ts` uses the retained construction PNGs to capture desktop, tablet, and phone workspaces during partial completion, after completion, during clarification, and after fallback. Job timing and responses are controlled fixtures; these screenshots demonstrate presentation, not live latency or matching accuracy. Set `WEB_ROOT` to an isolated production-build copy when other development tasks are rebuilding the shared output. See the [workspace evidence index](screenshots/board-workspace/README.md).

Before distribution, exercise a signed native build on iPad and Android: tap/swipe/multitouch, unlock, system containment, selected-language pronunciation and offline voices, generated audio and volume/silent-mode behavior, microphone permissions, native photo cropping, background/restart recovery, and local save failures. Expo Go does not demonstrate standalone launcher/splash, signing, OTA or system-containment behavior.

Validate server connectivity and HTTPS from the actual tablet. Native signing, store submission, OTA application, and server deployment need their configured targets and the checks in [the release guide](releases.md). Browser or unit-test success does not prove installation or rollout. Use `npm audit` for current dependency advisories rather than a checked-in audit snapshot.
