# Fresh major-runtime cutover

Merge the toolkit first, then this consumer at the same immutable SHA. Do not dispatch a release during PR validation. No old plans, receipts, pending requests or runtime baselines are imported. Both consumers require a new native installation before receiving subsequent OTA updates.

The semantic floors are server 0.3.3 and mobile 0.1.4. Read-only EAS history on 2026-10-24 UTC verified successful Android/iOS 0.1.4 builds with build number 5. Managed counters are currently uninitialized. Initialize each to at least 5 using official eas build:version:set after confirming store high-water marks; the workflow refuses missing or lower counters. Configure production.submit.ios.ascAppId in apps/mobile/eas.json with the existing numeric App Store Connect app ID before submitting iOS. Preserve existing EAS signing and submission credentials.

Keep existing application/project IDs, channels, webhook destinations, WireGuard peer and protected environments. Standard workflow signing secret names are ANDROID_KEYSTORE_BASE64, ANDROID_STORE_PASSWORD, ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD; ordinary EAS builds use their managed credentials. Expo operations use EXPO_TOKEN. WireGuard variables and secrets retain their existing DEPLOY_* names.

Confirm public EAS inputs are declared readable strings. Create protected environment gates before allowing workflow dispatch. A human performs the first release and verifies real native installation, store handoff and server health. This PR does not perform those live actions.
