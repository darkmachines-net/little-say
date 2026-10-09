## Summary

The iOS release build fails during CocoaPods installation when optional Google OAuth settings are absent. The native Google Sign-In dependency still autolinks, but its configuration plugin—and required AppCheck dependency module maps—are omitted.

Add a targeted Expo build-properties fallback for GoogleUtilities and RecaptchaInterop while preserving configured Google sign-in. Include an isolated, manual macOS pod diagnostic in the existing workflow; it excludes every release job and does not build or sign an app.

Closes #48. Original failure: [release run 37874954697](https://github.com/MChartier/little-say/actions/runs/37874954697), [iOS build adde78c5](https://expo.dev/accounts/matthewchartier/projects/little-say/builds/adde78c5-19e6-40d5-8e58-d3b89abf6d46).

## Test plan and behavior evidence

- **Missing OAuth settings, real macOS:** [diagnostic run 37881372074](https://github.com/MChartier/little-say/actions/runs/37881372074) reproduced the exact AppCheckCore module-map error on baseline `b46e9e8` (`pod install` exit 1). Source `06b4b00` completed prebuild and `pod install` (exit 0; 116 pods), with the same relevant pod versions.
- **Diagnostic limitation:** that workflow concluded **failure** because its version parser selected nested dependency constraints from the successful lockfile. The parser is corrected at final head `d88515b`; its new regression fails before the correction and passes afterward. Local replay of the retained lockfile agrees with independent YAML parsing. No hosted rerun occurred. Application configuration is unchanged from the macOS-tested source.
- **Configured sign-in and Android:** the existing Nitro pod directives remain unchanged; all 44 baseline/final Android prebuild files are byte-identical. The maintained configuration regression fails on the original missing-scheme case and passes with the fix.
- **Local checks:** 34 focused release/configuration/diagnostic/isolation tests and script typechecking pass. Release metadata and application/server/core typechecks passed. [Final-head CI passed](https://github.com/MChartier/little-say/actions/runs/37881717383), including repository checks/builds, service integration and account-browser tests.

This is a non-UI build-configuration change. [Original generated evidence](https://github.com/MChartier/little-say/tree/92f219f4fd3bcac29a935726cfb2b74ce699663d) and [raw macOS results, versions, hashes and parser replay](https://github.com/MChartier/little-say/blob/73a48868d6df246f4f9b8951dfa4dd8542afe16c/macos-run-37881372074.md) are retained outside product history. The raw failed diagnostic results are preserved unchanged.

## Supporting checks and limitations

The macOS check used Xcode 26.4.1 and CocoaPods 1.16.2; all seven non-diagnostic jobs skipped. Successful pod installation is not native compilation or signed-build validation. No archive, EAS build, release retry, store submission or deployment occurred. Independent final QA remains pending.
