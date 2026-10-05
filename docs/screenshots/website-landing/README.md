# Website landing page review

Captured on October 4, 2026 in Chromium against this PR's production web build. The homepage uses an illustrative six-card board, with no family photos, personal library, or live AI requests. Screenshots show the website, not native app screens.

| View | Viewport | Screenshot |
| --- | --- | --- |
| Homepage and sample board | 1440 × 1000 | [Desktop homepage](home-1440.png) |
| Feature overview | 1440 × 1000 | [Desktop features](features-1440.png) |
| Homepage and store placeholders | 390 × 844 | [Phone homepage](home-390.png) |
| Feature overview | 390 × 844 | [Phone features](features-390.png) |
| Final call to action, store placeholders, and footer | 390 × 844 | [Phone store section](stores-390.png) |
| Compact header and homepage | 320 × 740 | [Narrow phone homepage](home-320.png) |

The website opens at `/`; its calls to action enter the browser app at `/app`. App Store and Google Play placeholders are disabled links labeled **Coming soon**, without destination URLs. Installed web apps start directly in the app, including older standalone installs that still use `/`.

Validation on the isolated PR branch passed `npm run check` (release metadata, TypeScript, 179 unit/service tests, and server/web production builds) and all 59 Chromium scenarios. Browser coverage includes keyboard navigation, 1440/390/320-pixel layouts, disabled store links, no homepage library/API initialization, direct app entry, legacy standalone launches, and offline app reload/playback.

## Native exclusion

Expo's platform resolver selects `src/Entry.tsx` for native builds and `src/Entry.web.tsx` for web. The native entry re-exports only the shared app. Fresh Android and iOS JavaScript exports with source maps contain the native entry and no `Entry.web.tsx`, `src/website/`, or `landing.css` sources. [The source-map audit](native-bundle-audit.json) records the source counts and exported bundle hashes. This verifies the bundle boundary; it is not a signed-device installation or a physical-device test.

## Reproduce

From the repository root, run `npm run check`, then `npm run test:web -- tests/web/landing.spec.ts`. Screenshots are written to ignored `artifacts/screenshots/landing/`; copy reviewed captures into this directory when updating the PR.

From `apps/mobile`, export native JavaScript with `npx expo export --platform ios --platform android --source-maps --no-bytecode --output-dir ../../artifacts/landing-native`. Inspect each generated source map's `sources` list for the native entry and the absence of website modules. The `--no-bytecode` flag is for inspection only, not a release setting.
