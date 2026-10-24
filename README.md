# Little Say

A local-first AAC soundboard for parents and toddlers, built with Expo, React Native, TypeScript, and Fastify. Families create boards with emoji, licensed illustrations, generated pictures, or their own photos, then play words in their preferred languages. Boards and downloaded media work offline; account backup is optional.

## Run locally

Use Node 24. Set `AAC_OPENAI_KEY` in your environment (or `OPENAI_API_KEY` in an ignored root `.env`), then run from the repository root:

```powershell
npm.cmd ci
npm.cmd run dev
```

On macOS/Linux, use `npm` instead of `npm.cmd`. Scan Expo's QR code on a device on the same LAN. For client-only work against the deployed backend, use `npm run dev:remote`; no local API key is needed. `dev:web` and `dev:web:remote` open the browser version. Without AI, choose **Start without starter boards** and build manually.

See [development tooling](scripts/README.md) for SDK compatibility, environment resolution, device connectivity, and troubleshooting. For a production web preview, run `npm run build` then `npm start` and open [localhost:8787](http://localhost:8787).

## Find the owning code

| Module | Maintained guidance |
| --- | --- |
| [Parent and child UI](apps/mobile/src/ui/README.md) | Interaction, layout, Settings, pictures, and accessibility conventions |
| [Client services](apps/mobile/src/services/README.md) | Account sync, media preparation, speech, and platform boundaries |
| [Shared core](packages/core/src/index.ts) | Schemas, migrations of device data, and pure board behavior; contracts on exports |
| [Server](apps/server/README.md) | API lifecycle, configuration, privacy, and hosting |
| [Accounts](apps/server/src/accounts/README.md) | Firebase identity, session security, private backups, and deletion |
| [Pictures](apps/server/src/pictures/README.md) | Licensed catalog, job protocol, generation, and cache ownership |
| [Database migrations](apps/server/migrations/README.md) | PostgreSQL configuration, ordered history, and explicit migration commands |
| [Tests](tests/README.md) | Automated checks, disposable service fixtures, and device validation |
| [Release tooling](scripts/release/README.md) | Release selection, signing, publication, and recovery |
| [Self-hosted deployment](deploy/self-hosted/README.md) | Shared deployment webhook, connectivity, and readiness |
| [Prompt resources](prompts/README.md) | Maintained AI instructions and packaging |
| [Brand assets](apps/mobile/assets/brand/README.md) | Mountain artwork, palette, and asset generation |

## Contributing

Run `npm run check` for lint, release-contract checks, TypeScript, unit tests, and production builds. [Testing](tests/README.md) explains the browser and service suites.

Keep live contracts in code comments or the owning module's README, following [AGENTS.md](AGENTS.md). Temporary investigations, screenshots, and validation reports belong in ignored `artifacts/` or PR attachments.
