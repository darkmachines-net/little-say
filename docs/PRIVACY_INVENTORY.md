# Privacy data-flow inventory

Source preparation only. The in-app **Little Say privacy information** is locally readable factual information, not a published legal policy. [The policy draft](PRIVACY_POLICY_DRAFT.md) remains explicitly incomplete.

| Flow | Data and destination | Current retention/deletion behavior | Source |
| --- | --- | --- | --- |
| Guest library | Boards, photos, downloaded pictures/speech in device SQLite/files or browser IndexedDB | Local until removed/cleared; uninstall or browser eviction can remove data. No guest account is created. | `apps/mobile/src/data/storage.ts`, `storage.web.ts`, `useLibrary.ts` |
| AI boards/translation | Prompts, necessary board words/history through selected backend to OpenAI | Responses calls use `store: false`; that is not a provider-wide zero-retention promise. Application logs exclude content. | `apps/server/src/provider.ts`, `app.ts` |
| Voice prompts | Microphone recording through backend to OpenAI transcription | Request is processed in memory, not stored as a microphone recording by the application server. Provider retention requires separate assessment. | `apps/server/src/app.ts`, `provider.ts` |
| Picture matching/generation | Descriptions and library/generated picture pixels through backend to OpenAI | Pictures, concept descriptions and job metadata remain in shared picture caches without automatic expiry. Personal photos are excluded from AI. | `apps/mobile/src/services/pictures.ts`, `packages/core/src/pictures.ts`, `apps/server/src/picture-provider.ts`, `picture-jobs.ts` |
| Generated speech | Tile text/language through backend to OpenAI | Server speech cache plus downloaded device audio; no automatic cache expiry. Local device voices are the fallback. | `apps/server/src/synthesis.ts`, `speech-cache.ts` |
| Identity | Email/name/provider identity with Firebase; ID proof exchanged with selected backend | Native refresh credentials in SecureStore; browser session uses protected cookies. Firebase identity is deleted by account deletion. | `apps/mobile/src/services/firebaseAccount.ts`, `firebasePersistence.ts`, `apps/server/src/firebase.ts` |
| Opt-in backup | Boards, personal photos, illustrations and saved voices to selected Postgres backend after verification | Administrator-accessible, not end-to-end encrypted. Account deletion removes selected-server backup; other servers need separate cleanup. Local copies/shared AI caches remain. | `apps/server/src/accounts.ts`, `account-routes.ts`, migrations; `docs/ACCOUNTS.md` |
| Deletion recovery | Minimal Firebase project/UID tombstone and pending deletion job | Retries cleanup; tombstone prevents recreation races. No email/name/media in tombstone; no automatic tombstone expiry is specified. | `apps/server/src/accounts.ts`, accounts migration |
| Device preferences/history | Settings, consent, favorites, play history, drafts and undo | Device-local, excluded from account backup. | `docs/ACCOUNTS.md`, `apps/mobile/src/services/accountSync.ts` |

No source assertion establishes the operator's infrastructure logs, database backups, region, access policy or legal retention commitment. Before publication, the owner must identify operator and contact, hosting/regions/subprocessors, backup/log deletion schedules, cache policy, handling of other-server copies and tombstones, intended audience, support/deletion contact, and the final authorized public policy location. Public backend/project identity does not answer these questions.

## Locked SDK manifest inspection

Inspected the installed root lockfile packages on 2026-10-09 without modifying dependencies. Expo is 57.0.26, React Native 0.86.3, Firebase JS 12.19.0, native Apple authentication 2.5.1 and Google sign-in 2.3.0. The npm sources contain these native manifests/reasons:

| Package/path beneath `node_modules` | Declared required-reason categories/codes |
| --- | --- |
| `expo-constants/ios/PrivacyInfo.xcprivacy` | UserDefaults: CA92.1 |
| `expo-file-system/ios/PrivacyInfo.xcprivacy` | FileTimestamp: 0A2A.1, 3B52.1; DiskSpace: E174.1, 85F4.1 |
| `react-native/React/Resources/PrivacyInfo.xcprivacy` | FileTimestamp: C617.1; UserDefaults: CA92.1 |
| `react-native/ReactCommon/cxxreact/PrivacyInfo.xcprivacy` | FileTimestamp: C617.1 |
| `react-native/ReactCommon/react/timing/PrivacyInfo.xcprivacy` | SystemBootTime: 35F9.1 |
| `react-native/third-party-podspecs/boost/PrivacyInfo.xcprivacy` | FileTimestamp: C617.1; SystemBootTime: 35F9.1 |
| `react-native/third-party-podspecs/glog/PrivacyInfo.xcprivacy` | FileTimestamp: C617.1 |
| `react-native/third-party-podspecs/RCT-Folly/PrivacyInfo.xcprivacy` | FileTimestamp: C617.1 |

The `re2/vendor/abseil-cpp` manifest is a Node tooling dependency, not proof of an iOS-linked SDK. Other CocoaPods/transitive binary manifests, Hermes and Google SDK contents must be inspected in the actual resolved native build; the npm inventory is not an archive inventory. Firebase JS alone does not prove native FirebaseAuth linkage. This work has no generated iOS project/IPA to inspect and adds no speculative app-level reason declarations.

Keep four assessments separate: (1) generated SDK/app manifest content and applicable required-reason API use/signatures, (2) App Store data labels and tracking based on actual collection, (3) export compliance based on actual cryptography, (4) runtime permissions and their effective purpose strings. None is established by passing another.

Official references: [Expo manifest guide](https://docs.expo.dev/guides/apple-privacy/), [Apple listed SDKs](https://developer.apple.com/support/third-party-SDK-requirements/), [privacy labels](https://developer.apple.com/app-store/app-privacy-details/), [beta export compliance](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-export-compliance-information-for-beta-builds/).
