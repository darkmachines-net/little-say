# TestFlight source preparation

This is a partial source-preparation checklist, not evidence of a signed iOS build or TestFlight readiness. Follow [the existing release architecture](releases.md): the authorized cloud release workflow and optional local tooling remain unchanged. Running any build, provider setup, submission or release needs its own authorization.

## Toolchain choice

Checked against official documentation on 2026-10-09:

- Apple's upload floor is Xcode 26 with the iOS/iPadOS 26 SDK, effective April 28, 2026 ([Apple requirements](https://developer.apple.com/news/upcoming-requirements/)). This is separate from the app's minimum device OS.
- The locked Expo 57.0.26 / React Native 0.86.3 app requires Xcode 26.4+ and supports iOS 16.4+ ([SDK compatibility](https://docs.expo.dev/versions/v57.0.0/)). The least invasive preparation route is Xcode 26.4 or a compatible 26.x release with its iOS 26.x SDK. No actual Mac/toolchain has been validated by this preparation.
- Do not choose an unspecified latest Xcode. SDK 57 needs explicit scene support when building with Xcode 27/iOS 27 SDK. Expo 57.0.23+ supports the opt-in through compatible `expo-build-properties`; this app has not added it ([SDK 57 guidance](https://expo.dev/changelog/sdk-57), [scene instructions](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27)).
- A future plugin/configuration/dependency change requires regenerated native inspection, focused checks and a fresh native binary/runtime under the repository fingerprint policy. An OTA cannot introduce native capabilities.

The bundle remains `net.darkmachines.littlesay`. EAS `internal` is ad hoc distribution, requiring registered devices; it is **not TestFlight internal testing**. TestFlight uses a store-signed `production` build. No provider set, signing profile, EAS image, entitlement configuration or dependency was changed here.

## What the local IPA verifier checks

`scripts/release/verify-ios.ts` retains signature, bundle/version and Expo project/runtime/channel checks. On macOS it additionally reads the artifact's SDK/Xcode metadata, provisioning distribution/expiry, signed application and Apple sign-in entitlements, microphone/photo purpose strings, and paths of bundled privacy manifests. It rejects development/enterprise signing for these distribution profiles and ad hoc signing for production. Only public summary fields are printed, not the provisioning profile, device identifiers or credentials.

Manifest presence is an inspection gate, not a declaration that every required reason is correct. The report keeps required-reason assessment, App Store labels, export compliance and signed runtime tests pending. Existing wrappers still bind clean source, explicit profile, exact artifacts/build IDs and checksums. The new metadata checks use synthetic fixtures on Windows; macOS extraction/tool integration remains unexecuted. The cloud artifact verification path is unchanged and does not automatically run this local IPA inspector.

## Distribution checklist — all unverified until observed

- [ ] Record the authorized Mac or build environment, exact Xcode/SDK/macOS versions and supported scene route.
- [ ] Verify Apple membership/team, exact bundle ownership, App Store Connect app/build history, Expo project/profile/environment and intended tester audience. Do not create accounts or credentials from this checklist.
- [ ] Verify advertised Firebase/Google/Apple configuration and signed capabilities; see [accounts](ACCOUNTS.md). Emulator results do not establish provider success.
- [ ] Resolve operator/contact/public policy location, hosting and retention facts in the [privacy inventory](PRIVACY_INVENTORY.md). Assess store privacy labels, audience/category, age rating, claims, tracking and export compliance separately; no answers are preselected.
- [ ] Under explicit build authorization, produce a clean production archive and retain source, exact artifact/build identity, checksum and verifier output. Inspect effective permissions, entitlements, SDK manifests/reasons and signing.
- [ ] Exercise iPhone/iPad launch, offline boards/photos/audio, persistence, rotation/layout, text scaling and accessibility. Exercise permission denial/cancellation, photo import/crop, recording interruption and speech fallback.
- [ ] Exercise signed email/Google/Apple login, cancellation/retry/relaunch, linking, reauthentication, Apple revocation and deletion. Verify advertised backend access without opening unauthenticated paid AI endpoints.
- [ ] Only after explicit distribution authorization: upload the exact retained artifact, observe processing and export-compliance disposition, assign the intended tester group, and observe TestFlight installation. Submission success alone does not prove processing or installation.

## Remaining source coordination

Issue 12 also requires immediate recipient/data/action-permission disclosure in `AiConversation.tsx` and shared release-guide/test integration. Those paths are reserved by PR 38 and PR 49 respectively. This partial preparation does not close issue 12 or import the AppCheck pod correction from PR 49. The existing runtime dependency correction and Auth-emulator validation path remain intact.
