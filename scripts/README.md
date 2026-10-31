# Development and maintenance tools

Run commands from the repository root. Use `npm.cmd` / `npx.cmd` in Windows PowerShell and `npm` / `npx` elsewhere. Install with `npm ci`; Node 24 is the normal development runtime. `package.json` records the supported Node range. Docker Desktop (Linux containers) is also required locally; Java runs inside the Auth container. No GCP account or credentials are needed. Use an Expo Go build compatible with the SDK in `apps/mobile/package.json`; native dependency/SDK changes require a replacement development or release binary before loading the new bundle.

## Development launcher

`dev.ts` owns child processes and connectivity checks, `dev-config.ts` resolves environment/LAN settings, `dev-proxy.cjs` forwards browser API calls, and `dev-firewall.ps1` provides an optional Windows firewall rule. The root launcher is the supported connected development entry point: bare `expo start` does not inject the API address.

| Command | Purpose |
| --- | --- |
| `npm run dev` / `dev:local` | PostgreSQL/Auth + watched API/worker + Expo Go on the LAN |
| `npm run dev:remote` | Expo Go against `https://littlesay.app`, without a local API/key |
| `npm run dev:web` / `dev:web:remote` | Corresponding backend mode plus browser launch |
| `npm run dev:server` / `dev:app` | Dependencies + watched API/worker / Expo against an existing local API |
| `npm run dev:setup` | Create an optional ignored root `.env` only if absent |
| `npm run dev:doctor` | Check migrations, worker, emulator, selected addresses and API/Metro; add `-- --remote` for remote health/proxy |
| `npm run dev -- --clear` | Restart with Metro cache reset; also accepted by local/remote aliases |

Run one launcher at a time. It checks ports without terminating existing owners, starts checkout-owned Compose dependencies, waits for their health, runs local migrations, then waits for API health, and starts Expo in Go/LAN mode. Ctrl+C stops only its child process trees. Restart when changing networks, environment settings, or backend modes, then reload the app. Remote health failure stops startup; it never silently falls back to another backend. Doctor/startup make no model calls; actual remote AI use uses the deployed server's billing and caches.

The `.codex/environments/environment.toml` actions invoke these same commands through Node; install dependencies once before using them. Local API binds only the selected LAN address on port `8788`, Expo to `8081`, and the app receives the chosen LAN URL. Standalone production server defaults are separate.

Development accounts/database persist in checkout-named Docker volumes and media in `.cache/media`. Test runners use separate disposable projects and directories. Port conflicts fail without killing their owner; select unused ports for another checkout. `docker compose up --build` also provides a complete built browser/API/worker stack on localhost:8787. Do not delete volumes to fix startup problems.

For one-tap local sign-in, run `npm run dev` or `npm run dev:web`, open **Sign in**, then choose **Sign in with test account**. The development API creates the verified `tester@little-say.test` account with password `little-say-local-test-only` if absent and reuses it across restarts; no registration or verification email is needed. Its boards and backup belong to the same account on every device using that emulator. Backup still requires a separate opt-in. These are public local fixture credentials, not a hosted account. The shortcut requires both a development app build (including Expo Go) and the local emulator configuration; it is absent in release exports and remote-backend mode. Local authentication continues to use email/password; Google and Apple are not simulated by this shortcut.

## Environment and browser proxy

Resolution order is inherited process environment, `.env.local`, then `.env`. Local mode prefers `AAC_OPENAI_KEY` over `OPENAI_API_KEY`, with Windows User environment fallback only when no explicit process/file key exists. Keys are never printed or written by the launcher. Remote mode does not look up local keys or create `.env`.

Only API/worker children receive the server environment. PostgreSQL and Auth always use local demo settings, overriding inherited hosted configuration. Expo has `AAC_OPENAI_KEY`, `OPENAI_*`, and inherited `EXPO_PUBLIC_*` removed, with dotenv disabled; the launcher supplies only public `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_WEB_API_URL` for the same-origin browser proxy.

| Optional setting | Contract |
| --- | --- |
| `DEV_HOST` | This machine's assigned LAN IPv4; empty selects Wi-Fi/Ethernet ahead of virtual/VPN adapters |
| `DEV_API_PORT` | Local API port, default 8788; ignored entirely in remote mode |
| `DEV_PG_PORT` / `DEV_AUTH_PORT` | Loopback PostgreSQL / selected-LAN Auth ports, defaults 15432 / 9099 |
| `AAC_AI_FIXTURES` | Explicit synthetic local AI, default false; no provider key needed |
| `DEV_EXPO_PORT` | Expo port, default 8081 |
| `DEV_REMOTE_API_URL` | Remote HTTPS origin without credentials, path, query, or fragment |

Remote native requests use HTTPS directly. Browser `/api/` requests stream through Metro to that fixed backend, including JSON, speech, and pictures. The proxy accepts exact configured development origins and the app POST header, rejects redirects, and strips unrelated cookies/authorization/origin. AI, media and account paths relay only the opaque `__session` cookie plus explicit CSRF/account headers; Secure is removed only on the trusted HTTP development hop. Production exports contain no development proxy.

## Device connectivity

Keep computer and device on the same reachable trusted LAN; wired computer plus Wi-Fi tablet is fine. Scan the QR code with Expo Go on Android or Camera on iOS and allow local-network access. On physical iOS, sign the CLI (`npx expo login` in `apps/mobile`) and Expo Go into the same Expo account when required by Expo Go. This is separate from Little Say sign-in.

Run doctor, then open the printed `/api/health` URL on the actual device: success on the computer alone does not prove LAN access. Check `status: ok` and, for AI, `aiConfigured: true`. If the address is wrong, choose an assigned `DEV_HOST`; check VPN/WSL/Docker adapters. For timeouts, check local-network permissions and guest/client-isolated Wi-Fi. Expo's bundler tunnel does not tunnel this API.

Allow Node only on a trusted Private Windows network. If needed, use an Administrator PowerShell:

```powershell
.\scripts\dev-firewall.ps1
# Custom ports; supports -WhatIf.
.\scripts\dev-firewall.ps1 -ApiPort 9000 -ExpoPort 9001
.\scripts\dev-firewall.ps1 -Remove
```

The helper allows inbound Node TCP for the selected ports from the local subnet on the Private profile. It never changes the network profile, disables the firewall, or runs automatically. Mark a trusted home network Private through Windows Settings if needed.

After connecting, create/refine a board, check undo, save audio, then disconnect and play it. Confirm changed words never reuse mismatched speech and keyboard dictation sends only reviewed text. Expo Go differs from a signed app in identity, permissions, splash, system containment, and OTA; follow [device validation](../tests/README.md#live-ai-and-device-validation).

## Maintenance tools

- `update-emoji-catalog.ts` (`npm run emoji:update`) regenerates offline Unicode/CLDR metadata; retain `packages/core/src/data/UNICODE-LICENSE.txt`.
- `update-picture-catalog.ts` (`npm run pictures:update`) owns the [licensed catalog's pinned inputs and output](../apps/server/src/pictures/README.md).
- `brand-assets.mjs` (`npm run brand:assets`) regenerates variants from the committed [mountain master](../apps/mobile/assets/brand/README.md); normal builds use committed assets.
- `evaluate-ai.ts` and `evaluate-pictures.ts` are opt-in billable [evaluation tools](../tests/README.md#live-ai-and-device-validation).
- `test-services.ts` owns disposable Compose dependencies/ports/media for service and browser suites; `test-server.ts` owns their API and schema. See [service tests](../tests/README.md#service-tests).
- [Release tooling](release/README.md) owns versioning, provider publication, and recovery.

## Linting

Run `npm run lint` for ESLint alone or `npm run lint -- --fix` to apply available fixes. Both use `--max-warnings 0`, so any warning or error fails the command. The root `eslint.config.mjs` covers authored JavaScript and TypeScript in applications, shared packages, tests, configuration, and scripts. It checks recommended JavaScript/TypeScript rules, React Hook ordering and dependencies, and file/public-callable documentation using existing JSDoc rules.

Generated native projects, dependencies, caches, build/test output, and ignored evidence are excluded. Explicit `any` remains permitted in release-provider JSON handling and test fixtures; application code uses the recommended TypeScript rules. Static PNG `require` calls remain supported for Metro assets.

Other languages use native header comments as required by [AGENTS.md](../AGENTS.md). Review prose accuracy when changing behavior; JSDoc lint checks comment presence, not correctness. See [validation](../tests/README.md) for CI checks and branch protection.
