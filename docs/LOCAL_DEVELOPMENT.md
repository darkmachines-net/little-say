# Development with Expo Go and local or self-hosted backends

Run this from the repository root in a terminal on your computer:

```powershell
npm.cmd ci                 # first checkout only
npm.cmd run dev:local      # watched local API + Expo
# Or, for client-only changes against the existing deployment:
npm.cmd run dev:remote     # Expo + https://littlesay.darkmachines.net
```

On macOS/Linux, use `npm` in place of `npm.cmd`. Keep the terminal open. Scan Expo's QR code using Expo Go on Android or the Camera app on iOS. The computer and device must be on the same reachable LAN; a wired computer and a Wi-Fi tablet are fine. There is no Docker, native build, or deployment step for this flow.

Choose one command at a time. `dev` remains an alias for the local full-stack flow. Ctrl+C stops the services owned by that launcher; run the other command and reload the app to switch backends. Both modes use Expo port 8081 by default, and neither stops an existing port owner. Existing boards and saved server preferences are preserved.

## Self-hosted backend

`npm.cmd run dev:remote` checks `https://littlesay.darkmachines.net/api/health`, then starts Expo Go in LAN mode. It does not start a local backend, reserve its port, create `.env`, or look up a Windows User API key. The deployed server supplies its own credentials and model configuration. Health failures stop startup with a remote-specific error; the launcher never silently falls back to a different backend.

Native clients connect directly to the HTTPS backend. For browser testing, use `npm.cmd run dev:web:remote` or press **w** in the remote Expo session. The development web app sends `/api/` calls to its own Metro origin; a development-only middleware streams them to the selected remote backend. This covers JSON, recorded audio uploads, speech downloads, and picture assets without changing the deployment's allowed origins. The proxy accepts only the configured localhost/LAN origins and the app's POST header, strips unrelated browser cookies/authorization/origin, and does not follow redirects. Account routes relay only the Little Say session cookie and expected account ID; the cookie retains HttpOnly and SameSite, with Secure removed only for the HTTP development hop. Other requests continue to Metro. Production exports do not include this proxy or use these development overrides.

AI requests made while testing use the deployed server and its normal billing/caches. Startup and doctor checks only request health/status endpoints. Stop and restart Expo when switching modes or changing the remote origin; append `-- --clear` if a device still has a stale bundle.

## Codex actions

The repository's `.codex/environments/environment.toml` defines **Expo + local backend**, **Expo + self-hosted backend**, and corresponding **Web** actions. These invoke the same launchers from the repository root. The actions use Node directly so they work in Windows PowerShell as well as macOS/Linux shells. Run `npm.cmd ci` once for a fresh checkout before using an action.

Select the Little Say development environment in Codex's local-environment settings if it is not already selected, then choose an action from the top bar. Keep its terminal open; Ctrl+C stops that session before choosing another mode. See the [official local-environment documentation](https://learn.chatgpt.com/docs/environments/local-environment).

This project uses SDK 57; install its compatible [Expo Go version](https://expo.dev/go). On physical iOS devices, the current Expo Go flow requires the CLI and Expo Go to be signed in to the same Expo account: run `npx.cmd expo login` from `apps/mobile`, then sign in on the device. This is an [Expo Go requirement](https://docs.expo.dev/get-started/start-developing/), not an account requirement in Little Say. Allow local-network and microphone access when requested.

## API key

The **local** backend uses **`AAC_OPENAI_KEY`**, with `OPENAI_API_KEY` as a fallback. On Windows, the local launcher can read a User environment variable even when the current terminal predates that change. It never prints the key or writes it to disk. Remote mode needs no local key.

Alternatively, run `npm.cmd run dev:setup` and put `OPENAI_API_KEY` in the root `.env`. Setup creates that ignored file only if it is missing. `.env.local` can override `.env`; the current process environment takes precedence over both. An explicit key in the process/files takes precedence over the Windows User fallback. Restart the launcher after changing a key or environment setting.

Only the local API process receives the resolved server environment. The Expo process has `AAC_OPENAI_KEY`, `OPENAI_*`, and inherited `EXPO_PUBLIC_*` values removed, with dotenv loading disabled. The launcher adds `EXPO_PUBLIC_API_URL` and, for remote browser sessions, `EXPO_PUBLIC_WEB_API_URL`. Both are public addresses. Never put a secret in an `EXPO_PUBLIC_*` variable.

## What the local launcher does

1. Detects a LAN IPv4 address, preferring Wi-Fi/Ethernet over virtual/VPN adapters.
2. Checks that both selected ports are free, without stopping an existing process.
3. Starts the API in watch mode on `0.0.0.0:8788` and waits for its health endpoint.
4. Starts Expo explicitly in **Expo Go / LAN** mode on port `8081`, advertising the same host address.
5. Injects `http://<computer-LAN-IP>:8788` into the development app. No manual URL entry is needed.

The development API uses port 8788, separate from the production server's default 8787. Browser requests are allowed from the exact localhost/LAN origins for these ports. Native Expo Go requests do not require browser CORS headers. The API remains an unauthenticated service for a trusted private network.

In a development build, the injected address overrides a saved deployment address. **Parent settings → Test connection** shows and tests the current address. It does not overwrite the saved address; production builds ignore the development injection and retain their normal settings/same-origin behavior.

Ctrl+C stops the launcher and both child process trees. Frontend edits use Fast Refresh; server source edits restart the API. Changing networks or `.env` requires restarting `npm run dev` and reloading the app.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm.cmd run dev` | API + interactive Expo Go QR code |
| `npm.cmd run dev:local` | Explicit local full-stack mode, same as `dev` |
| `npm.cmd run dev:remote` | Expo Go + self-hosted backend, no local API or key |
| `npm.cmd run dev:web` | Same setup, also open the development web app |
| `npm.cmd run dev:web:remote` | Browser app + self-hosted API through Metro's proxy |
| `npm.cmd run dev -- --clear` | Same setup, clear Metro's cache |
| `npm.cmd run dev:setup` | Create optional root `.env` without replacing existing values |
| `npm.cmd run dev:doctor` | Show selected addresses and check API/Metro connectivity; no model calls |
| `npm.cmd run dev:doctor -- --remote` | Check self-hosted health, Metro, and its browser API proxy |
| `npm.cmd run dev:server` | API only, useful in its own terminal |
| `npm.cmd run dev:app` | Expo only, waiting for the separately running API |
| `npm.cmd run eval:ai` | Opt-in **billable** live model evaluations using the same key resolution |

In `.env`, optional overrides are:

```dotenv
DEV_HOST=
DEV_API_PORT=8788
DEV_EXPO_PORT=8081
DEV_REMOTE_API_URL=https://littlesay.darkmachines.net
```

Leave `DEV_HOST` blank for detection. If set, it must be an IPv4 address currently assigned to this computer. `DEV_API_PORT` applies only to local mode; remote mode ignores it, including conflicts with the Expo port. `DEV_REMOTE_API_URL` applies only to remote mode and must be an HTTPS origin without credentials, paths, queries, or fragments. These `DEV_*` settings are independent of production `HOST`, `PORT`, and `ALLOWED_ORIGINS`. The root launcher is the supported way to start connected development; a bare `expo start` does not inject the API URL.

## Check the full flow

1. Start `npm run dev`. The console should say **API ready. AI configured.**
2. On the device's browser, open the printed `/api/health` link. It should show `"status":"ok"` and `"aiConfigured":true`.
3. Open the Expo QR code. In Parent settings, run **Test connection**.
4. Ask for six farm animals, review the draft, apply it, and play a tile.
5. Ask to replace one animal. Check that the rest stay intact, then test undo.
6. Use **Voice prompt**, allow the microphone, stop recording, review the transcript, and submit it.
7. In a board editor, watch the saved AI voice count increase without blocking editing. Open a tile and choose **Generate audio** or **Regenerate audio**, then **Listen to this tile**. Check an English word and a Russian word such as `бабушка` with `ru-RU`.
8. After audio is saved, disconnect the tablet from Wi-Fi and play it again. Edit the spoken text or language to confirm an old clip is never played for new words; device TTS is the fallback until matching audio is prepared.

Generated audio is stored in the repository's ignored `.cache/speech` directory by default. Restarting `npm run dev` reuses it. `OPENAI_SPEECH_MODEL` and `OPENAI_SPEECH_VOICE` are optional server settings; the defaults are `gpt-realtime-2.1-mini` and `marin`. `SPEECH_CACHE_DIR` can point to another persistent directory. The Expo app receives only the backend URL and downloaded audio, never the key.

The web app on `localhost:8081` also supports recording. A device browser using a plain LAN HTTP URL generally cannot access its microphone; use the native Expo Go app for this local voice test. Browser offline/service-worker behavior is tested against the built app, not Metro.

## If the device cannot connect

Run `npm run dev:doctor` while the local launcher is running, or `npm run dev:doctor -- --remote` during a remote session. A successful check on the computer does not prove another device can reach it. Check the printed health URL on the device first, then the Expo connection.

- Wrong address: use the interface list in `dev:doctor` and set `DEV_HOST`. VPNs, Docker, and WSL can advertise unusable addresses.
- Timeout from the device: confirm both devices use the same trusted network, allow Expo Go local-network permission, and avoid guest/client-isolated Wi-Fi.
- Windows firewall: allow Node on your **Private** network when prompted. If needed, run the following once in an **Administrator PowerShell** from this repository. The helper adds only inbound Node TCP access for these ports, on the Private profile, from the local subnet. It does not change the network profile or disable the firewall.

```powershell
.\scripts\dev-firewall.ps1
# If you changed ports:
.\scripts\dev-firewall.ps1 -ApiPort 9000 -ExpoPort 9001
# Remove the helper's rule afterward:
.\scripts\dev-firewall.ps1 -Remove
```

The helper supports `-WhatIf`. No firewall rule is installed automatically. Mark your home network Private using Windows Settings if it is currently Public and you trust it.

Expo's `--tunnel` tunnels the bundler only; it does not make this local API reachable. This launcher intentionally uses LAN mode so the bundle and API use one working network path.

Expo Go includes this app's [SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/) and [audio](https://docs.expo.dev/versions/latest/sdk/audio/) modules. Its permission text, development menu, app identity, and system containment can differ from a standalone build. Test final child-mode containment and distribution behavior in a native build before the family pilot.


## Firebase and Postgres

Local API development now requires Postgres. Run `npm run db:up` for the optional Docker database, or set the PG variables for your installed database. The local launcher runs migrations and starts its own demo Auth emulator. Use `DEV_AUTH_MODE=hosted` with Firebase settings for real-provider testing. Remote mode starts neither service. See [backend operation](BACKEND.md) for setup, ports, demo identities and hosted settings.

Expo Go continues to support guest and email/password flows. For Google/Apple, install a development build containing the native modules and run `npm run dev -- --dev-client` (or `dev:remote -- --dev-client`). Public iOS Google callback configuration must be supplied when generating/building the native app. Native configuration changes require a new binary and the existing release/runtime checks.
