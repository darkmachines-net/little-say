# Firebase and Postgres account evidence

Browser captures were refreshed on 2026-10-05 from application commit `4fc31c7` against PostgreSQL 17 and the Firebase Auth emulator. The native capture is from the 2026-10-04 runtime validation, before the inherited Settings label change. All identities shown are test fixtures.

- `create-tablet.png`: Chromium tablet account creation with email/password and optional backup consent.
- `restored-phone.png`: Chromium phone library after restoring the account backup, including local media.
- `native-persisted.png`: Android Pixel_10 emulator running Expo Go SDK 57 after restarting the app; the securely persisted email session syncs without entering credentials again.

The browser captures come from `tests/web/accounts.spec.ts`. The Android capture documents manual emulator validation. These images do not establish real Google/Apple provider support or physical-device validation. See [the validation record](../../FIREBASE_POSTGRES_VALIDATION.md) for checks and remaining external dependencies.
