# Development and maintenance tools

Run commands from the repository root. Use `npm.cmd` / `npx.cmd` in Windows PowerShell and `npm` / `npx` elsewhere. Install with `npm ci`; Node 24 is the normal development runtime. `package.json` records the supported Node range. Docker Desktop (Linux containers) is also required locally; Java runs inside the Auth container. No GCP account or credentials are needed. Use an Expo Go build compatible with the SDK in `apps/mobile/package.json`; native dependency/SDK changes require a replacement development or release binary before loading the new bundle.

The mobile entrypoint uses the toolkit's [early compatibility check](https://github.com/darkmachines-net/expo-release-template/blob/main/src/consumer/README.md#early-development-client-compatibility-check): a stale development client shows rebuild instructions before app imports run. After native changes, restart Metro and reopen its QR/link; Fast Refresh is not a compatibility check.

## Development launcher

`dev.ts` owns child processes and connectivity checks, `dev-ports.ts` coordinates worktree port assignments, `dev-config.ts` resolves environment/LAN settings, `dev-expo.ts` prepares Go or toolkit-owned native launches, `dev-proxy.cjs` forwards browser API calls, and `dev-firewall.ps1` provides optional Windows firewall rules. The root launcher is the supported connected development entry point: bare `expo start` does not inject the API address.

| Command | Purpose |
| --- | --- |
| `npm run dev` / `dev:local` | PostgreSQL/Auth + watched API/worker + Expo Go on the LAN |
| `npm run dev:native` | The same local stack with the installed Little Say Dev client |
| `npm run dev:native -- --remote` | Installed development client against the hosted backend |
| `npm run dev:remote` | Expo Go against `https://littlesay.app`, without a local API/key |
| `npm run dev:web` / `dev:web:remote` | Corresponding backend mode plus browser launch |
| `npm run dev:server` / `dev:app` | Dependencies + watched API/worker / Expo against an existing local API |
| `npm run dev:setup` | Create an optional ignored root `.env` only if absent |
| `npm run dev:doctor` | Check migrations, worker, emulator, selected addresses and API/Metro; add `-- --remote` for remote health/proxy |
| `npm run dev -- --clear` | Restart with Metro cache reset; also accepted by local/remote aliases |
| `npm run dev:app -- --dev-client` | Installed client against this worktree's existing local API |

Run the same command in each worktree to test changes concurrently. Each launcher selects its ports, starts checkout-owned Compose dependencies, waits for their health, runs local migrations, waits for API health, then starts Expo on the LAN. Add `-- --dev-client` to any app launch to target the installed development client. Its native identity comes from the pinned toolkit; [development previews](release/README.md#development-previews) explains installing a compatible binary. Ctrl+C stops only the launcher's child process trees. Restart when changing networks, environment settings, or backend modes, then reload the app. Remote health failure stops startup; it never silently falls back to another backend. Doctor/startup make no model calls; actual remote AI use uses the deployed server's billing and caches.

The `.codex/environments/environment.toml` actions invoke these same commands through Node, including actions for the installed development client; install dependencies once before using them. The API binds only the selected LAN address, PostgreSQL stays on loopback, and the app receives the chosen API and device-facing Auth URLs. The terminal identifies the worktree, branch, Compose project, selected ports and client target. Scan that terminal's QR code to switch the phone to that worktree. Development-client bundles share the installed app's on-device library; ports do not create separate device storage. Native dependency/configuration changes still require a compatible development binary.

Development accounts/database persist in checkout-named Docker volumes and media in `.cache/media`. Test runners use separate disposable projects and directories. `docker compose up --build` provides a separate complete built browser/API/worker stack on localhost:8787; its fixed application port is independent of the Expo launcher. Do not delete volumes to fix startup problems.

### Port selection and cleanup

The launcher prefers remembered ports, then the familiar defaults (Expo 8081, API 8788, PostgreSQL 15432, Auth 9099), scanning for available alternatives. Exact `DEV_*_PORT` overrides take precedence and fail clearly when occupied. Existing `.env` files may still pin the old defaults: remove or comment out those four assignments to enable automatic selection. User environment files are never rewritten. Remote sessions select only Expo; `dev:server` and `dev:app` can share one worktree's backend while owning separate process claims. Starting the same service twice in one worktree fails with a diagnostic.

Each worktree stores port preferences in its own `.cache/dev/ports.json`. Coordination lives in `little-say-dev/claims.json` under `git rev-parse --path-format=absolute --git-common-dir`, shared by the primary checkout and every linked worktree. A short interprocess lock serializes allocation and atomic file updates; it is refreshed while held and expires after ten seconds without a heartbeat. Neither path is tracked. `dev:doctor` reads the saved choices without allocating ports or writing state.

Normal shutdown releases only that launcher's claims. The next mutation prunes claims whose launcher and recorded children have exited, including records for deleted worktrees. Surviving children keep their claims; IPv4/IPv6 socket probes additionally protect occupied ports. Docker's published TCP ports are also excluded because Windows Docker reservations can pass a host socket probe. Saved preferences are reusable hints, not reservations: they remain until their file/worktree is removed. Existing owned PostgreSQL/Auth containers are inspected and reused, so a restart does not mistake them for another stack. An external process can still bind during startup; the launcher reports conflicts and stops its children. If interactive Expo offers a replacement port, decline and restart so all URLs stay consistent.

PostgreSQL/Auth containers continue running after Ctrl+C or an abrupt launcher exit. To stop them, use the exact project printed by that worktree: `docker compose --project-name little-say-<checkout-hash> --file compose.yaml stop postgres auth`. Allow Auth's graceful export to finish. This preserves volumes. Before deleting a worktree, stop its launcher/containers and optionally remove its firewall rules with `dev-firewall.ps1 -Remove`. Removing a directory alone does not remove Docker resources or firewall rules. No daemon or automatic volume deletion is involved.

For one-tap local sign-in, run `npm run dev` or `npm run dev:web`, open **Sign in**, then choose **Sign in with test account**. The development API creates the verified `tester@little-say.test` account with password `little-say-local-test-only` if absent and reuses it across restarts; no registration or verification email is needed. Its boards and backup belong to the same account on every device using that emulator, following the normal [automatic backup behavior](../apps/mobile/src/services/README.md#accounts-and-sync). These are public local fixture credentials, not a hosted account. The shortcut requires both a development app build (including Expo Go) and the local emulator configuration; it is absent in release exports and remote-backend mode. Local authentication continues to use email/password; Google and Apple are not simulated by this shortcut.

## Environment and browser proxy

Resolution order is inherited process environment, `.env.local`, then `.env`. Local mode prefers `AAC_OPENAI_KEY` over `OPENAI_API_KEY`, with Windows User environment fallback only when no explicit process/file key exists. Keys are never printed or written by the launcher. Remote mode does not look up local keys or create `.env`.

Only API/worker children receive the server environment. PostgreSQL and Auth always use local demo settings, overriding inherited hosted configuration. Expo has `AAC_OPENAI_KEY`, `OPENAI_*`, and inherited `EXPO_PUBLIC_*` removed, with dotenv disabled; the launcher supplies only public `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_WEB_API_URL` for the same-origin browser proxy.

| Optional setting | Contract |
| --- | --- |
| `DEV_HOST` | This machine's assigned LAN IPv4; empty selects Wi-Fi/Ethernet ahead of virtual/VPN adapters |
| `DEV_API_PORT` | Exact local API port; otherwise automatically selected starting at 8788; ignored in remote mode |
| `DEV_PG_PORT` / `DEV_AUTH_PORT` | Exact PostgreSQL / Auth ports; otherwise remembered/owned ports or available ports starting at 15432 / 9099 |
| `AAC_AI_FIXTURES` | Explicit synthetic local AI, default false; no provider key needed |
| `DEV_EXPO_PORT` | Exact Expo port; otherwise automatically selected starting at 8081 |
| `DEV_REMOTE_API_URL` | Remote HTTPS origin without credentials, path, query, or fragment |

Remote native requests use HTTPS directly. Browser `/api/` requests stream through Metro to that fixed backend, including JSON, speech, and pictures. The proxy accepts exact configured development origins and the app POST header, rejects redirects, and strips unrelated cookies/authorization/origin. AI, media and account paths relay only the opaque `__session` cookie plus explicit CSRF/account headers; Secure is removed only on the trusted HTTP development hop. Production exports contain no development proxy.

## Device connectivity

Keep computer and device on the same reachable trusted LAN; wired computer plus Wi-Fi tablet is fine. Scan the QR code for the selected target (Expo Go or the installed Little Say Dev client) and allow local-network access. For the development client, its launcher can also accept the printed HTTP client-server URL. On physical iOS, sign the CLI (`npx expo login` in `apps/mobile`) and Expo Go into the same Expo account when required by Expo Go. This is separate from Little Say sign-in.

Run doctor, then open the printed `/api/health` URL on the actual device: success on the computer alone does not prove LAN access. Check `status: ok` and, for AI, `aiConfigured: true`. If the address is wrong, choose an assigned `DEV_HOST`; check VPN/WSL/Docker adapters. For timeouts, check local-network permissions and guest/client-isolated Wi-Fi. Expo's bundler tunnel does not tunnel this API.

Allow Node only on a trusted Private Windows network. If needed, use an Administrator PowerShell:

```powershell
.\scripts\dev-firewall.ps1
# Hosted backend: allow only the selected Metro port.
.\scripts\dev-firewall.ps1 -Remote
# Custom ports; supports -WhatIf without changing any rules.
.\scripts\dev-firewall.ps1 -ApiPort 9000 -ExpoPort 9001 -AuthPort 9100 -WhatIf
.\scripts\dev-firewall.ps1 -Remove
```

The helper reads this worktree's remembered ports unless explicit parameters are supplied. Its worktree-named Node rule permits API/Expo; a separate exact-port rule permits Docker-published Auth because that listener is not Node. Both are restricted to the Private profile and local subnet; PostgreSQL is never exposed. Updating/removing one worktree's rules leaves other worktrees' rules intact. Rerun the helper if selected ports change. It never changes the network profile, disables the firewall, or runs automatically. Mark a trusted home network Private through Windows Settings if needed. The legacy `LittleSay-LocalDevelopment` rule is left intact; remove it manually if replacing an older setup.

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
