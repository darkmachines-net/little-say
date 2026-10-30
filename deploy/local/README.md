# Local dependencies

`Dockerfile.auth` bundles Node, Firebase CLI and Java 21 so developers need only Node and Docker on their host. The emulator uses the `demo-little-say` project and imports/exports accounts to its Compose-owned `/data` volume. Allow graceful shutdown to finish exports; Compose gives it 60 seconds.

The [root Compose file](../../compose.yaml) owns PostgreSQL, Auth, migrations, API, worker and media volumes. [Development scripts](../../scripts/README.md) use the same dependency services while running watched Node/Expo processes on the host. Local dependency settings always override inherited cloud database/auth settings. Tests use new project names, ports, schemas and media directories and never remove development volumes.

The full container stack serves the browser at `http://localhost:8787`. Physical-device development uses `npm run dev` and the selected trusted LAN host; PostgreSQL remains bound to loopback. Firebase emulator email actions are available through the emulator's local API/logs. Production cannot accept emulator credentials or fixture AI.
