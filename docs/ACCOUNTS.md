# Optional Firebase accounts and backup

Little Say works without an account. Guest boards, photos, illustrations and speech remain in the existing device library. Guest setup makes no account request. Firebase is used for identity only; no Firestore or Firebase Storage is involved.

In **Settings → Account & backup**, choose email/password, Google, or Apple. Continuing explicitly connects this device's boards and assets to the selected server. Email/password users must verify their email before backup starts; password reset and verification use Firebase email actions. Local editing and playback remain available while verification or sign-in is pending. Expo Go supports guest and email flows; Google/Apple require a development or release build.

Signing in merges existing server boards into this device and uploads local boards, personal photos, illustrations and downloaded speech. Backups are visible to the server administrator and are not end-to-end encrypted. Device settings, consent, favorites, play history, drafts and undo history remain local. AI consent/billing is independent of account consent.

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
- GET /api/account/session, POST /logout, POST /delete, GET/POST /backup and GET/POST /assets/:hash remain under /api/account. The legacy register/login/recover password endpoints are removed.
- Account profiles contain id, nullable email/displayName, emailVerified and providers. No password, recovery code or opaque native session token is stored by this backend.
- Admin verification checks project, signature, expiry, disabled/deleted users and Firebase token revocation. Account responses are no-store; credentials and request contents are excluded from logs.

The development web proxy forwards only account session/CSRF cookies and account/CSRF headers on account paths. It strips unrelated cookies and bearer headers, and removes Secure only on the trusted HTTP development hop.

See [database and Firebase operation](BACKEND.md) for environment configuration, provider setup, backups and Cloud SQL. Account protection does not change the existing trusted-private-network access model of guest AI endpoints.
