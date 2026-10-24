# Optional accounts and private backups

`routes.ts` owns `/api/account`, `firebase.ts` verifies identity, and `store.ts` owns PostgreSQL persistence. Firebase provides identity only: no Firestore or Firebase Storage. The [client services](../../../mobile/src/services/README.md) own launch consent, sync scheduling, and device credentials. Shared payloads and three-way merge behavior are defined in `packages/core/src/account.ts`.

## Configuration and identity

`src/index.ts` enables accounts when `FIREBASE_PROJECT_ID` or `FIREBASE_AUTH_EMULATOR_HOST` is present, creates the database pool, and checks schema compatibility before listening. Without these settings, guest services remain available and no pool is created. Apply [migrations](../../migrations/README.md) before enabling accounts.

Hosted identity needs public `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, and `FIREBASE_AUTH_DOMAIN`, plus operator-managed application default credentials for Admin verification. `FIREBASE_AUTH_PROVIDERS` selects enabled methods. Google uses `FIREBASE_GOOGLE_WEB_CLIENT_ID` / `FIREBASE_GOOGLE_IOS_CLIENT_ID`; Apple uses `FIREBASE_APPLE_SERVICE_ID` / `FIREBASE_APPLE_REDIRECT_URI`. Provision providers outside the application. `firebaseConfig` validates this contract and rejects emulator settings in production.

Accounts have internal UUIDs and unique Firebase project/UID mappings. Emails are contact/display data, never backup identity or merge keys. Linking a provider requires proof of the existing identity; a credential owned by another Firebase user must be resolved by signing into that account. Verification checks project, signature, expiry, disabled/deleted users, and revocation.

## Session and API boundaries

- `GET /api/account/config` returns public client settings only. Passwords stay with Firebase.
- `POST /session` exchanges an explicitly supplied Firebase ID token for the application account. Native requests subsequently use refreshed bearer tokens.
- Browser authentication exchanges the ID token for a 14-day HttpOnly, SameSite=Strict cookie, Secure in production. A random database binding makes logout local to that login even if Firebase returns identical JWTs.
- Browser mutations require a double-submit token from `GET /csrf`, the app header, and exact allowed-origin checks. Bearer requests do not use browser cookie authority. The expected-account header rejects cross-tab account changes.
- `GET /session`, `POST /logout`, `POST /delete`, `GET/POST /backup`, and `GET/POST /assets/:hash` complete the API under `/api/account`. Responses are `no-store`; errors are sanitized. Email verification gates backup access.

## Backup persistence

Backups include boards, personal photos, illustrations, and downloaded speech. They are visible to the server operator and are not end-to-end encrypted. Device settings, consent, favorites, play history, drafts, and undo remain local. Account sign-out preserves downloaded data.

The account row is locked before revision, completeness, and quota checks. Stale writers receive HTTP 409. Limits are 500 boards, 10 MB per asset, and 256 MB of private assets per account. Assets are owner-scoped even for identical bytes; unreferenced uploads count against quota until deletion. Snapshots have a relational revision and JSONB boards/manifest; immutable bytes currently live in `bytea`. There is no automatic eviction or history UI.

## Deletion

Deleting requires fresh proof of the same Firebase UID within five minutes and Apple authorization revocation for linked Apple identities. It removes the Firebase login globally and this server's private backup; other servers' backups, downloaded device copies, and shared AI caches are outside that deletion.

Deletion intent commits before Apple revocation and blocks backup access immediately. Interrupted Apple confirmation must be resumed with fresh Apple authentication; short-lived grants are never stored. After confirmation, bounded workers retry Firebase and PostgreSQL cleanup at startup and every 30 seconds. A minimal project/UID tombstone with no email or media prevents a racing request from recreating the account. Signing in to resume confirmation does not restore backup access.

See [service validation](../../../../tests/README.md#service-tests) for disposable PostgreSQL and Firebase-emulator checks. Emulator tests do not establish real provider consent or device SecureStore behavior.
