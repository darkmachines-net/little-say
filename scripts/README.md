# Development and maintenance tools

Run commands from the repository root. Use `npm.cmd` / `npx.cmd` in Windows PowerShell and `npm` / `npx` elsewhere. Install with `npm ci`; Node 24 is the normal development runtime. `package.json` records the supported Node range. Use an Expo Go build compatible with the SDK in `apps/mobile/package.json`; native dependency/SDK changes require a replacement development or release binary before loading the new bundle.

## Development launcher

`dev.ts` owns child processes and connectivity checks, `dev-config.ts` resolves environment/LAN settings, `dev-proxy.cjs` forwards browser API calls, and `dev-firewall.ps1` provides an optional Windows firewall rule. The root launcher is the supported connected development entry point: bare `expo start` does not inject the API address.

| Command | Purpose |
| --- | --- |
| `npm run dev` / `dev:local` | Watched local API + Expo Go on the LAN |
| `npm run dev:remote` | Expo Go against `https://littlesay.darkmachines.net`, without a local API/key |
| `npm run dev:web` / `dev:web:remote` | Corresponding backend mode plus browser launch |
| `npm run dev:server` / `dev:app` | API only / Expo waiting for a separately running local API |
| `npm run dev:setup` | Create an optional ignored root `.env` only if absent |
| `npm run dev:doctor` | Check selected addresses and local API/Metro; add `-- --remote` for remote health/proxy |
| `npm run dev -- --clear` | Restart with Metro cache reset; also accepted by local/remote aliases |

Run one launcher at a time. It checks ports without terminating existing owners, waits for API health, and starts Expo in Go/LAN mode. Ctrl+C stops only its child process trees. Restart when changing networks, environment settings, or backend modes, then reload the app. Remote health failure stops startup; it never silently falls back to another backend. Doctor/startup make no model calls; actual remote AI use uses the deployed server's billing and caches.

The `.codex/environments/environment.toml` actions invoke these same commands through Node; install dependencies once before using them. Local API defaults to `0.0.0.0:8788`, Expo to `8081`, and the app receives the chosen LAN URL. Standalone production server defaults are separate.

## Environment and browser proxy

Resolution order is inherited process environment, `.env.local`, then `.env`. Local mode prefers `AAC_OPENAI_KEY` over `OPENAI_API_KEY`, with Windows User environment fallback only when no explicit process/file key exists. Keys are never printed or written by the launcher. Remote mode does not look up local keys or create `.env`.

Only the API child receives the server environment. Expo has `AAC_OPENAI_KEY`, `OPENAI_*`, and inherited `EXPO_PUBLIC_*` removed, with dotenv disabled; the launcher supplies only public `EXPO_PUBLIC_API_URL` and, for remote browser sessions, `EXPO_PUBLIC_WEB_API_URL`.

| Optional setting | Contract |
| --- | --- |
| `DEV_HOST` | This machine's assigned LAN IPv4; empty selects Wi-Fi/Ethernet ahead of virtual/VPN adapters |
| `DEV_API_PORT` | Local API port, default 8788; ignored entirely in remote mode |
| `DEV_EXPO_PORT` | Expo port, default 8081 |
| `DEV_REMOTE_API_URL` | Remote HTTPS origin without credentials, path, query, or fragment |

Remote native requests use HTTPS directly. Browser `/api/` requests stream through Metro to that fixed backend, including JSON, speech, and pictures. The proxy accepts exact configured development origins and the app POST header, rejects redirects, and strips unrelated cookies/authorization/origin. Only account paths relay account session/CSRF cookies and account headers; Secure is removed only on the trusted HTTP development hop. Production exports contain no development proxy.

## Device connectivity

Keep computer and device on the same reachable trusted LAN; wired computer plus Wi-Fi tablet is fine. Scan the QR code with Expo Go on Android or Camera on iOS and allow local-network access. On physical iOS, sign the CLI (`npx expo login` in `apps/mobile`) and Expo Go into the same Expo account when required by Expo Go. This is separate from optional Little Say accounts.

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
- `test-server.ts` owns the isolated account-browser API and disposable schema. See [service tests](../tests/README.md#service-tests).
- [Release tooling](release/README.md) owns versioning, provider publication, and recovery.

## Linting

Run `npm run lint` for ESLint alone or `npm run lint -- --fix` to apply available fixes. Both use `--max-warnings 0`, so any warning or error fails the command. The root `eslint.config.mjs` covers authored JavaScript and TypeScript in applications, shared packages, tests, configuration, and scripts. It checks recommended JavaScript/TypeScript rules, React Hook ordering and dependencies, and file/public-callable documentation using existing JSDoc rules.

Generated native projects, dependencies, caches, build/test output, and ignored evidence are excluded. Explicit `any` remains permitted in release-provider JSON handling and test fixtures; application code uses the recommended TypeScript rules. Static PNG `require` calls remain supported for Metro assets.

Other languages use native header comments as required by [AGENTS.md](../AGENTS.md). Review prose accuracy when changing behavior; JSDoc lint checks comment presence, not correctness. See [validation](../tests/README.md) for CI checks and branch protection.
