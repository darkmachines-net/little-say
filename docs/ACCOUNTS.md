# Optional Firebase accounts and backup

Parent settings includes offline-readable **Little Say privacy information**. The [data-flow inventory](PRIVACY_INVENTORY.md) and [unpublished policy draft](PRIVACY_POLICY_DRAFT.md) separate observed application behavior from unresolved operator commitments.

Login and registration use locally bundled official Apple Continue artwork with one accessible action; busy/disabled states suppress activation. No image request to Apple occurs merely to display it. Advertised providers remain selected by server configuration. Native Google login requires its public web client ID and, on iOS, iOS client ID; Android Apple login requires its service ID and callback. Known missing public prerequisites are explained before activation. These checks cannot establish remote provider activation, callback correctness, provisioning, or signed-device support. Account linking and reauthentication retain their existing adapter validation.

Auth-emulator tests validate application identity/session/backup behavior against synthetic accounts. Expo Go supports guest/email behavior, while custom development/release binaries are required for native social modules. Neither emulator nor browser checks prove real Google/Apple credentials, signed callbacks, cancellation/relaunch, linking, revocation or deletion on devices. These remain explicit [TestFlight validation gates](TESTFLIGHT_PREPARATION.md); no provider setup is performed by source preparation.

Little Say works without an account. Guest boards, photos, illustrations and speech remain in the existing device library. Guest setup makes no account request. Firebase is used for identity only; no Firestore or Firebase Storage is involved.

On the first launch without a saved sign-in, a dedicated welcome screen offers **Log in**, **Create an account**, and **Continue without an account**. Continuing saves only a device-local launch preference; subsequent guest launches open the existing setup/library directly. Existing signed-in users and resumed play sessions are not interrupted. Existing guest libraries receive the choice without replacing their boards or settings.

**Parent settings** links to the same full-screen account experience instead of embedding authentication fields. Back/cancel leaves the form, then returns to the previous screen with local data and settings drafts intact. Sign-out from settings keeps downloaded boards and opens the login/create choices. Choosing guest makes no account request. Email/password, Google and Apple actions still require explicit consent to the selected server; email verification gates backup. Expo Go supports guest and email flows; Google/Apple require a development or release build.

Signing in merges existing server boards into this device and uploads local boards, personal photos, illustrations and downloaded speech. Backups are visible to the server administrator and are not end-to-end encrypted. Device settings, consent, favorites, play history, drafts and undo history remain local. AI consent is independent of account consent.

## Sync and account lifecycle

Sync runs after changes when the parent returns to the library, every 30 seconds while that library is active, on foreground/reconnection, and through **Sync now**. It waits during play/editing and never interrupts a child session to sign in. Files download and verify before a snapshot is acknowledged. **All boards and assets are synced** means a complete backup was acknowledged; offline and failed changes remain local.

Three-way merges use the last acknowledged snapshot, propagate deletions, preserve edits racing deletion, and retain concurrent edits as stable **(conflict copy)** boards. Limits remain 500 boards, 10 MB per asset, and 256 MB of private assets per account. Unreferenced uploads remain within the quota until deletion; there is no automatic eviction or history UI.

The Postgres transaction locks the account row before checking revisions, asset completeness, and upload quotas. Concurrent stale writers receive HTTP 409. Assets are scoped to their owner, even when another owner uploads identical bytes. Snapshots store a relational revision plus JSONB boards/manifest; immutable file contents currently use bytea. Object storage is a later deployment phase.

Accounts use internal UUIDs and unique Firebase project/UID mappings. Emails are display/contact information, never identity keys for merging backups. **Manage sign-in methods** requires authentication with an existing method before linking another provider. A credential already belonging to another Firebase user must be resolved by signing into that account; application backups are never merged by matching emails.

Changing backend pauses synchronization. Connecting another backend or account explicitly enables uploading local boards there. The expected-account header rejects cross-tab account changes. Sign-out preserves local boards and files.

**Delete account** requires fresh authentication to the same Firebase UID (within five minutes), including Apple authorization revocation for linked Apple accounts. It removes the shared Firebase login globally and the selected server's backup. Backups on other servers require separate cleanup; downloaded device copies and shared AI caches remain. The UI states this before confirmation. A durable deletion request blocks access immediately and retries failures in bounded batches at startup and every 30 seconds. A minimal project/UID tombstone prevents a previously verified request from recreating the deleted account during a race; it contains no email, name or media.

Deletion intent is committed before Apple revocation. An interrupted or failed Apple confirmation leaves the backup blocked; retry **Delete account** with fresh Apple authentication. Signing in again can resume this confirmation without restoring backup access. Short-lived Apple grants are never stored. Workers wait for successful Apple confirmation, then retry Firebase and Postgres cleanup automatically.

## Authentication and API

- Public Firebase configuration: GET /api/account/config. Admin credentials are never returned.
- Explicit sign-in: POST /api/account/session with a Firebase ID token and native flag; returns the application account.
- Native: the Firebase JS SDK refreshes ID tokens; each request checks the opted-in Firebase UID and backend. Refresh credentials are stored in chunked, atomically committed Expo SecureStore records.
- Browser: Firebase credentials exist in memory only during authentication. The server exchanges them for a 14-day HttpOnly, SameSite=Strict cookie, Secure in production, then the client signs out of Firebase JS. A random database-backed browser binding makes logout local to that login even if Firebase issues identical JWTs.
- Browser mutations require a double-submit token obtained from GET /api/account/csrf plus the exact allowed-origin/app-header checks. Native bearer requests do not use browser cookie authority.
- GET /api/account/session, POST /logout, POST /delete, GET/POST /backup and GET/POST /assets/:hash remain under /api/account. Passwords are handled by Firebase, not by application password endpoints.
- Account profiles contain id, nullable email/displayName, emailVerified and providers. No password, recovery code or opaque native session token is stored by this backend.
- Admin verification checks project, signature, expiry, disabled/deleted users and Firebase token revocation. Account responses are no-store; credentials and request contents are excluded from logs.

The development web proxy forwards only account session/CSRF cookies and account/CSRF headers on account paths. It strips unrelated cookies and bearer headers, and removes Secure only on the trusted HTTP development hop.

See [PostgreSQL operation](POSTGRES.md) for the existing database contract. Configure Firebase identity using public FIREBASE_PROJECT_ID, FIREBASE_API_KEY, FIREBASE_APP_ID and FIREBASE_AUTH_DOMAIN values and platform-specific provider IDs; hosted Admin verification uses application default credentials managed by the operator. No provider activation or provisioning is performed by this change. Without Firebase configuration, guest services remain available. Apply the appended accounts migration explicitly before enabling accounts. Account protection does not change the existing trusted-private-network access model of guest AI endpoints.
