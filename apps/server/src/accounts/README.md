# Optional accounts and private backups

`routes.ts` owns `/api/account`, `firebase.ts` verifies identity, and `store.ts` owns PostgreSQL persistence. Firebase provides identity only: no Firestore or Firebase Storage. The [client services](../../../mobile/src/services/README.md) own launch consent, sync scheduling, and device credentials. Shared payloads and three-way merge behavior are defined in `packages/core/src/account.ts`.

## Configuration and identity

`src/index.ts` requires Firebase and PostgreSQL, then checks schema compatibility before listening. The local launcher supplies both dependencies and applies [migrations](../../migrations/README.md). Hosted production rejects all emulator settings.

Hosted identity needs public `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, and `FIREBASE_AUTH_DOMAIN`, plus operator-managed application default credentials for Admin verification. `FIREBASE_AUTH_PROVIDERS` selects enabled methods. Google uses `FIREBASE_GOOGLE_WEB_CLIENT_ID` / `FIREBASE_GOOGLE_IOS_CLIENT_ID`; Apple uses `FIREBASE_APPLE_SERVICE_ID` / `FIREBASE_APPLE_REDIRECT_URI`. Provision providers outside the application. `firebaseConfig` validates this contract and rejects emulator settings in production.

Accounts have internal UUIDs and unique Firebase project/UID mappings. Emails are contact/display data, never backup identity or merge keys. Linking a provider requires proof of the existing identity; a credential owned by another Firebase user must be resolved by signing into that account. Verification checks project, signature, expiry, disabled/deleted users, and revocation.

## Session and API boundaries

- `GET /api/account/config` returns public client settings only. Passwords stay with Firebase.
- `POST /session` exchanges an explicitly supplied Firebase ID token for the application account. Native requests subsequently use refreshed bearer tokens.
- Browser authentication uses one 14-day opaque `__session` cookie, HttpOnly, SameSite=Strict, Secure in production, scoped to `/api`. PostgreSQL stores the Firebase session token and CSRF state; no JWT is carried in the browser cookie. Firebase Hosting forwards this single cookie. Logout revokes only that login.
- Browser mutations require the server-side token bound to `__session` from `GET /csrf`, the app header, and exact allowed-origin checks. Bearer requests do not use browser cookie authority. The expected-account header rejects cross-tab account changes.
- `GET /session`, `POST /logout`, `POST /delete`, `GET/POST /backup`, and `GET/POST /assets/:hash` complete the API under `/api/account`. Responses are `no-store`; errors are sanitized. Email verification gates backup access and paid AI. Shared access checks also protect AI jobs, cancellation and personal generated media.

## Backup persistence

Backups include boards, personal photos, illustrations, and downloaded speech. They are visible to the server operator and are not end-to-end encrypted. Sign-in enables identity only; a separate per-device choice enables backup. Device settings, consent, favorites, play history, drafts, and undo remain local. Account sign-out preserves downloaded data.

The account row is locked before revision, completeness, and quota checks. Stale writers receive HTTP 409. Limits are 500 boards, 10 MB per asset, and 256 MB of private assets per account. Assets are owner-scoped even for identical bytes; unreferenced uploads count against quota until deletion. Snapshots have a relational revision and JSONB boards/manifest; immutable bytes currently live in `bytea`. There is no automatic eviction or history UI.

## Deletion

Deleting requires fresh proof of the same Firebase UID within five minutes and Apple authorization revocation for linked Apple identities. It removes the Firebase login globally and this server's private backup; private job/batch records and cache metadata are removed too. The worker deletes unowned private media; approved public generic assets and downloaded device copies remain. GCS soft deletion retains a seven-day recovery window.

Deletion intent commits before Apple revocation and blocks backup access immediately. Interrupted Apple confirmation must be resumed with fresh Apple authentication; short-lived grants are never stored. After confirmation, the shared worker retries Firebase/PostgreSQL/media cleanup through local polling or five-minute scheduled maintenance. A minimal project/UID tombstone with no email or media prevents a racing request from recreating the account. Signing in to resume confirmation does not restore backup access.

See [service validation](../../../../tests/README.md#service-tests) for disposable PostgreSQL and Firebase-emulator checks. Emulator tests do not establish real provider consent or device SecureStore behavior.
