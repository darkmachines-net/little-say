# Little Say accounts and backup

Little Say works without an account. Guest boards, photos, illustrations and speech stay in the existing local library, and no account endpoint is contacted. Uninstalling or clearing that storage removes guest data.

In Settings, open **Little Say account** to create an account or sign in. First-time setup also offers **Sign in or restore boards**. Accounts use a case-insensitive name (3–40 letters, numbers, underscores or hyphens), a 12–128 character password, and a recovery code. Save the code outside the device: there is no email service or email password reset. Resetting with the code rotates it and signs out all old sessions.

Signing in explicitly enables uploading this device's saved boards and their photos, illustrations and downloaded speech to the selected server. Existing account boards are merged into this device. Use the same server and account on another device or after a reinstall. Boards already downloaded remain playable offline. AI consent is independent of account consent, and backups do not send photos to OpenAI. Server administrators can access stored backups; this is not end-to-end encrypted storage.

Sync runs after board changes when you return to the library, every 30 seconds while the library is active, on app foreground/reconnection, and through **Sync now**. Pending downloads finish before boards are shown. Sync waits while playing or editing; it never interrupts a child session to sign in. Device settings, voice choices, consent, favorites, play history, setup drafts and undo history stay local. Downloaded speech for current board languages is included, without generating missing audio or requiring AI access.

**All boards and assets are synced** means the server acknowledged a complete backup. Offline changes and failed uploads remain on the device until a successful sync. Errors and expired sessions appear under Little Say account, with a notice on the library. Sign out keeps local boards and files; signing into another account explicitly adds those local boards to that account. Account deletion requires the password and removes the server account, sessions and private backup files; it does not erase downloaded copies on other devices or the separate shared AI caches.

## Merge and storage contract

- Backups contain up to 500 boards with all card content, translations, image attribution and photo framing, plus an asset manifest. Individual assets are limited to 10 MB; total private asset storage is limited to 256 MB per account. Unreferenced uploads and old assets are retained within that quota until the account is deleted; there is no automatic eviction or version-history UI.
- The last acknowledged snapshot is saved atomically with the merged local library. A three-way merge propagates deletions against that baseline, retains edits racing deletion, and preserves simultaneous edits as separate boards named **(conflict copy)**. Stable conflict IDs avoid duplicate copies when retrying a lost response.
- The server compares a monotonically increasing revision in a SQLite transaction. A stale writer gets HTTP 409 and pulls/merges again. It rejects missing asset references and incomplete backups. SHA-256 identities verify transfers, with assets scoped to their owner even when different accounts upload identical bytes.
- The client uploads missing files first, downloads and verifies restored files, then publishes the snapshot. Local changes made during transfer are merged again before saving the acknowledgement. In-flight work never clears the local library after a network failure.
- A different configured server pauses sync; existing credentials are bound to the original server. Browser requests also identify the expected account, preventing another tab's sign-in from syncing one family's library into a different account.

## Server operation

`ACCOUNT_DB_PATH` selects the SQLite database; the default is `../../.cache/accounts/accounts.sqlite` relative to `apps/server`. The database contains accounts, salted scrypt password hashes, hashed opaque sessions, board snapshots and private asset bytes. Sessions expire after 90 days. Browser sessions use HttpOnly, SameSite=Strict cookies (Secure in production); native sessions use Expo SecureStore and bearer authentication. Password work and authentication requests are bounded. Account responses are `no-store` and request logging excludes credentials and content.

Both Compose manifests mount `account-data` at `/app/data/accounts`; the Docker image creates it for the non-root user. Preserve this volume during upgrades. For a consistent filesystem backup, stop the server before copying the entire account directory (including any SQLite journal files), then restart it. Restore with the server stopped, preserving ownership. Protect server backups as private family data. A device reinstall is recoverable only while the original server's account data remains available.

Use HTTPS for production. Accounts protect backup routes; the existing AI routes still assume a trusted private deployment and remain usable by guests. Adding this feature does not deploy a public identity provider or change that network trust model. Remote web development's fixed proxy forwards only the Little Say account cookie and expected account ID, removing Secure solely on the trusted HTTP development hop. It continues stripping unrelated cookies and authorization headers.

The native SecureStore module requires a new native build; do not send this feature as an OTA-only update to a binary that lacks the module. Prepare native versions and distribution through the existing release flow.
