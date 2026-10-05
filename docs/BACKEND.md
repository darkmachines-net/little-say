# Firebase and Postgres operation

The backend uses PostgreSQL 17 through pg and versioned SQL migrations through node-pg-migrate. Device SQLite/IndexedDB libraries remain local. No server SQLite migration/import is provided because there is no deployed data to preserve. Old SQLite files/volumes are not automatically erased.

## One database configuration

| Setting | Meaning |
| --- | --- |
| PGHOST | localhost, Compose service postgres, or /cloudsql/PROJECT:REGION:INSTANCE |
| PGPORT | TCP port; default 5432 |
| PGDATABASE, PGUSER, PGPASSWORD | Required database credentials; server only |
| PGPOOL_MAX | Maximum pooled connections per process; default 3 |
| PGSSLMODE | disable for local/private Compose/proxy sockets; verify-full for remote direct TCP |
| PGSSLROOTCERT | Optional external CA certificate path for verified TLS |
| PGOPTIONS | Optional administrator connection options; tests use an isolated search_path |

Remote direct TCP cannot disable certificate verification. Cloud SQL sockets rely on the platform's authenticated encrypted proxy connection; no application ORM, Cloud SQL-specific SQL, or permanent VPC connector is required.

Run npm run db:migrate explicitly before starting a standalone server. npm run db:status checks reachability and exact schema compatibility. The image contains node server/database-cli.js migrate and status. Migrations are transactional and advisory-locked, never automatically reversed. Application startup and /api/ready reject an unavailable/incompatible schema; /api/health retains its existing contract. Append new migrations rather than editing an applied migration, and update the supported schema list/version when adding one.

## Local development

Run npm ci, npm run dev:setup, and either start your installed Postgres or run npm run db:up. Then npm run dev starts the Auth emulator, prepares the selected database and starts API/Expo. Docker is optional. The database helper publishes only to loopback and preserves the development-postgres volume. Set PGPORT if port 5432 is occupied.

Local auth defaults to demo-little-say; emulator data is imported/exported under ignored .cache/firebase-auth. Email verification/reset links appear in emulator output and the local UI at http://127.0.0.1:4000. The API connects to 127.0.0.1:9099; device configuration uses the launcher's detected LAN IP so physical phones and Android emulators can reach it. Only use the emulator on a trusted LAN.

The launcher owns its emulator process and refuses an occupied port instead of attaching to an unknown service. npm run auth:emulator is available for standalone test/manual operation; stop it before starting the full local launcher. For an Android emulator without LAN access, set the explicit client emulator URL to http://10.0.2.2:9099 when running the API manually. Browser localhost tests use http://127.0.0.1:9099.

Set DEV_AUTH_MODE=hosted and the hosted Firebase settings below for real provider testing. No emulator setting is permitted in production; hosted and demo project IDs cannot be mixed. Use a separate local database for demo and real testing to keep test backups distinct. npm run dev:remote starts only Expo and uses remote Firebase configuration.

Expo Go supports guest/email flows. npm run dev -- --dev-client starts a custom development client for social sign-in. Native provider modules load lazily; adding or changing them requires a new binary, never an OTA to an incompatible binary.

## Shared hosted Firebase project

Configure one trusted shared Firebase project for self-hosting and eventual production:

1. Register a web app. Set FIREBASE_PROJECT_ID, FIREBASE_API_KEY, FIREBASE_APP_ID and optionally FIREBASE_AUTH_DOMAIN. These are public client identifiers.
2. Enable Email/Password, Google and Apple. FIREBASE_AUTH_PROVIDERS is the comma-separated advertised subset (default password,google.com,apple.com). Set a Firebase password policy of at least 12 characters and enable email enumeration protection. The app also checks 12 characters for registration/linking.
3. Add the actual HTTPS web domains and localhost development domain to Firebase authorized domains. Configure Firebase's hosted email verification/password-reset action handler and email templates. Keep the app's ALLOWED_ORIGINS restricted to its actual browser origins.
4. Register Android package and signing SHA-1/SHA-256 fingerprints for development, locally signed release, and Play App Signing as applicable. Set FIREBASE_GOOGLE_WEB_CLIENT_ID. Register the iOS bundle and set FIREBASE_GOOGLE_IOS_CLIENT_ID.
5. For iOS builds, set public LITTLE_SAY_GOOGLE_IOS_URL_SCHEME to the reversed iOS client ID (com.googleusercontent.apps.…), including in the selected readable EAS environment. The config plugin adds its callback scheme; release tooling fingerprints it and requires it for iOS builds.
6. Configure Sign in with Apple for the native bundle and an Apple Services ID for browser/Android flows. Enter the Apple Team ID, key ID and private key in Firebase's Apple provider settings; do not put them in the app. Register Firebase's HTTPS auth handler and the exact Android callback URI. Set FIREBASE_APPLE_SERVICE_ID and FIREBASE_APPLE_REDIRECT_URI. Enable Apple private email relay for Firebase's email sender when using relay addresses.
7. Enable the iOS Sign in with Apple capability. The app config supplies its entitlement; regenerate the native binary/provisioning as required. Verify sign-in, linking, reauthentication and authorization revocation with real Apple/Google test accounts before distribution.

All backends trust this shared identity directory. Admin credentials on any trusted backend can delete shared identities; SQL backup data stays in that backend's database. Global account deletion from one backend does not discover or erase other databases.

On GCP, use an attached least-privilege service account with Firebase Authentication administration permissions through application default credentials. Locally/self-hosted, GOOGLE_APPLICATION_CREDENTIALS points to an external Admin JSON key; use the optional read-only Compose secret overlay. Firebase Admin keys, database passwords and ChatGPT encryption/client secrets must never enter Expo/EAS variables. The launcher and release scripts scrub/reject them.

## Self-hosted Compose

Set hosted Firebase settings, a unique PGPASSWORD, PGDATABASE/PGUSER, ALLOWED_ORIGINS and the external Admin credential path in .env for a source build. Run npm run server:local. It builds, starts healthy Postgres, runs migrations, and starts the app. Use npm run server:local -- --external-db to omit the Postgres service and use configured PG settings.

For published images, configure server:configure with --database compose (default) or --database external, plus the existing immutable-image/context/origin/external-env-file settings. server:deploy includes the private Postgres overlay by default and the credential mount when configured. It runs the selected image's migration command before replacing the application, then checks /api/health and /api/ready.

A failed migration leaves the current application in place. A failed application rollout attempts the previous image only after its database status command confirms compatibility. Database migrations are never rolled back, and no volume is removed. There is no automatic rollback to an old SQLite image.

The source and published app manifests are bases; use the helpers above or explicitly combine them with compose.postgres.yaml. compose.firebase-credentials.yaml mounts the external key. Neither production stack publishes a database port. Media caches remain separate volumes; SQL owns account snapshots, private assets, encrypted ChatGPT sessions, browser bindings and deletion work.

## Backup and Cloud SQL

Back up Postgres using pg_dump in custom format and restore with pg_restore into a separately provisioned database. For a local container, docker compose exec postgres pg_dump -U USER -d DATABASE -Fc -f /tmp/backup.dump writes the dump inside the container; copy it with docker compose cp rather than redirecting binary output through older PowerShell. Use the same project/overlay options as deployment. Protect and test restore of the dump, and preserve the separate speech/picture cache volumes and CHATGPT_ENCRYPTION_KEY. Losing that key makes saved ChatGPT grants unreadable. Database backups contain private family media.

For future Cloud Run, enable the Cloud SQL Admin API, grant the runtime identity Cloud SQL Client, attach the instance connection name, and set PGHOST=/cloudsql/PROJECT:REGION:INSTANCE with database/user/password secrets and PGSSLMODE=disable. Run migrations as a separate deployment job with the same connection settings. For access from a development machine, run the authenticated Cloud SQL Auth Proxy on a local TCP port and point PGHOST/PGPORT at it. No production database is provisioned by this change.

This is the auth/database foundation. Cloud Run rollout, object storage for media, durable picture-job scheduling and public AI access controls are still separate work. Filesystem caches and background workers mean a configurable Cloud SQL connection is not proof that this image is ready for unrestricted autoscaling.
