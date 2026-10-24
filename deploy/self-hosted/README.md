# Private deployment webhook

The shared Expo pipeline opens a temporary WireGuard tunnel and calls the existing [darkmachines deployer](https://github.com/MChartier/darkmachines/tree/4ae5621727b21dddf0614059046bad991cdd97e2/deployer). The service owns the fixed Compose upgrade for `little-say` on Debian. This migration changes the caller implementation; Compose, startup database migrations and host provisioning remain in place.

Changed server inputs build and publish an image, then invoke the configured webhook once. Selected native and OTA delivery waits for that deployment. Unchanged server inputs skip deployment; there is no standalone retained-image deploy command.

## Endpoint and configuration

The worker sends an empty authenticated `POST /deploy/little-say`. Only HTTP 200 with `{"service":"little-say","status":"succeeded","healthy":true}` permits continuation. The service pulls its configured image, recreates the existing service and checks Docker health. It accepts no arbitrary commands or Compose paths. The response proves health, not an exact image digest.

Transport, HTTPS validation, deadlines, cleanup and uncertain-outcome handling belong upstream. WireGuard/webhook credentials stay in GitHub environment **self-hosted-testing**, restricted to the protected default branch with the desired approval policy. The deployment job receives no Expo credentials.

| Environment variable | Existing value contract |
| --- | --- |
| `DEPLOY_HOST` | Private IPv4 of the HTTPS endpoint |
| `DEPLOY_URL` | `https://deployer.darkmachines.net/deploy/little-say` |
| `DEPLOY_WG_ADDRESS` | Little Say runner IPv4 without CIDR suffix |
| `DEPLOY_WG_PUBLIC_KEY` | WireGuard server public key |

| Environment secret | Existing value contract |
| --- | --- |
| `DEPLOY_WG_ENDPOINT` | Reachable VPN host and UDP port |
| `DEPLOY_WG_PRIVATE_KEY` | Little Say runner peer private key |
| `DEPLOY_TOKEN` | Little Say's scoped deployment token |

Keep the separate Little Say peer/address and token; another repository's concurrency cannot serialize this peer. The reusable worker applies the protected environment and receives explicit named forwarding from the thin caller. Local commands cannot bypass it.

## Recovery

A timeout, lost response or cancellation may leave deployment running. Inspect deployer logs and app state before recovery. HTTP 409 may indicate overlapping work or a reconciliation block. Follow the existing [operator guide](https://github.com/MChartier/darkmachines/blob/4ae5621727b21dddf0614059046bad991cdd97e2/deployer/ROLLOUT.md); restarting the controller alone does not prove success.

Use GitHub deployment records and provider/deployer logs to resolve an interrupted operation. Missing evidence never permits another webhook request. Application startup can migrate schema; failure is not an automatic database or image rollback.

Mocked transport/failure tests live upstream. Application checks remain in `npm run check` and `npm run test:services`. Real routing, registry, server health and device uptake need separate operator validation; none is claimed by this extraction.
