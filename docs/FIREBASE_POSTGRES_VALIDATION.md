# Firebase and Postgres validation

Validated locally on Windows on 2026-10-04 using PostgreSQL 17, the Firebase Auth emulator, Chromium, Docker Compose, and the Pixel_10 Android emulator. Release metadata, types, unit tests, builds, integration tests, and browser checks were rerun on 2026-10-05 after combining the account and ChatGPT branch histories.

## Automated checks

- Type checking, release metadata checks, unit tests, server/web builds, and Android bundle export pass.
- 219 unit tests cover the existing application plus database configuration, secure credential persistence, unsupported native-module guards, secret scrubbing, cookie proxying, and deployment failure/rollback ordering.
- 29 required integration tests run against real Postgres and Auth emulator services. These cover fresh/repeat migrations, account isolation, complete backups, restart persistence, competing revisions/quotas, deletion retries, resumable Apple confirmation, Firebase verification/reset/cookies/CSRF/revocation, provider linking/conflicts, and ChatGPT transaction/refresh/disconnect races. Missing services fail the suite.
- The final full Chromium suite passed all 74 tests, including cross-tab identity/server switching and the inherited ChatGPT picture regression. Restore compares photo, illustration, and audio bytes and exercises offline conflict recovery and local-preserving sign-out.
- CI supplies Postgres and runs the Auth emulator for integration and browser suites. This record describes local evidence; the PR check status reports CI results separately.

## Runtime checks

The packaged image built and ran its explicit migrations twice, then reported a compatible schema. Compose retained the account UUID, snapshot revision, and private asset bytes after recreating both database and app containers. Postgres published no host port. Stopping only the test database made readiness return 503. A production-mode image rejected emulator configuration. A separate app-only Compose project connected to the existing test database without owning a Postgres service.

The normal local launcher migrated the selected database, started demo-little-say auth, advertised its LAN emulator address, and reported readiness. Restart imported its saved emulator state. Shutdown waits for emulator export before terminating the owned process tree.

Expo Go SDK 57 launched without loading native Google/Apple modules. Email sign-in and sync succeeded against the emulator and Compose API. After stopping and relaunching Expo Go, the saved Firebase session synced again without entering credentials. Unit tests separately check chunked SecureStore writes, failed-write recovery and credential removal. [Reviewer screenshots](screenshots/firebase-postgres/README.md) include the persisted native session; ReactNativeJS/AndroidRuntime error capture was empty.

## Outstanding external validation

Real Google and Apple provider flows, cancellation, linking, reauthentication and Apple authorization revocation need configured provider projects and signed development/release binaries. The emulator's synthetic provider test does not validate those external providers. iOS build/device validation needs a Mac and Apple provisioning. Cloud SQL connection configuration is implemented and documented, but no Cloud SQL instance or GCP credentials were available for a connectivity test. No production deployment was performed.

The dependency audit is not clean: the workspace reports upstream Expo/build-tool and optional Firebase dependency advisories. The production server audit reports two moderate findings in the optional Firebase Storage dependency chain (gaxios/uuid); this foundation uses Firebase Auth and does not invoke Firebase Storage or Firestore. No forced dependency downgrades were applied.
