# Little Say

A local-first AAC soundboard for parents and toddlers, built with Expo, React Native, TypeScript, and Fastify. Families create boards with emoji, licensed illustrations, generated pictures, or their own photos, then play words in their preferred languages. Boards and downloaded media work offline; account backup is optional.

## License

Little Say is developed in public and made available under the [PolyForm Shield License 1.0.0](LICENSE), except where separate terms are stated. See [NOTICE](NOTICE) for the copyright holder, required notice and third-party license boundaries.

You may use, study, modify and redistribute the software for purposes permitted by the license, including personal use and noncompeting commercial work. The license restricts using the software to provide competing products or services, including renamed apps, hosted services and free offerings. Its full terms, including the new-product and discontinued-product provisions, govern what is permitted.

Shield does not generally require you to publish your source code or modifications. Its protection is the restriction on competing products. Redistributions must include the license text or its URL and the `Required Notice:` line in [NOTICE](NOTICE). Uses outside the license require separate permission from the relevant copyright holder.

Dependencies, Unicode/CLDR data and third-party picture libraries retain their own licenses and attribution requirements; see [NOTICE](NOTICE) and [picture sources](apps/server/src/pictures/README.md#catalog-and-attribution). The software license does not grant trademark rights in the Little Say name or mountain identity, or permission to imply official endorsement.

## Run locally

Use Node 24 and Docker Desktop with Linux containers. No cloud account is needed. From the repository root:

```powershell
npm.cmd ci
npm.cmd run dev
```

On macOS/Linux, use `npm` instead of `npm.cmd`. Scan Expo's QR code on a device on the same LAN. For client-only work against the deployed backend, use `npm run dev:remote`; no local API key is needed. `dev:web` and `dev:web:remote` open the browser version. Verified sign-in enables AI when a developer key is configured, or set `AAC_AI_FIXTURES=true` for synthetic local responses. Without AI, choose **Start without starter boards** and build manually. Backup consent is separate.

See [development tooling](scripts/README.md) for SDK compatibility, environment resolution, device connectivity, and troubleshooting. For the full containerized browser stack, run `docker compose up --build` and open [localhost:8787](http://localhost:8787).

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
| [GCP deployment](deploy/gcp/README.md) | Terraform, Firebase/Cloud Run, release protection, recovery and launch acceptance |
| [Prompt resources](prompts/README.md) | Maintained AI instructions and packaging |
| [Brand assets](apps/mobile/assets/brand/README.md) | Mountain artwork, palette, and asset generation |

## Contributing

Run `npm run check` for lint, release-contract checks, TypeScript, unit tests, and production builds. [Testing](tests/README.md) explains the browser and service suites.

Keep live contracts in code comments or the owning module's README, following [AGENTS.md](AGENTS.md). Temporary investigations, screenshots, and validation reports belong in ignored `artifacts/` or PR attachments.
