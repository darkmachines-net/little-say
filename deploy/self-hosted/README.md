# Private deployment webhook

GitHub-hosted Actions open a temporary WireGuard tunnel using the supplied peer settings and call the shared
[darkmachines deployer service](https://github.com/MChartier/darkmachines/pull/5). That service owns the fixed Compose
upgrade for `little-say` on the Debian host. This repository contains only the caller; it does not provision
peers, install a host helper, configure accounts, run SSH, or change homelab settings.

**Cut release** promotes its verified server image to `latest` before calling the webhook. Server and OTA releases
require successful deployment; native-only releases and no-op cuts do not deploy. Both internal and production
OTA publication, and required release completion, depend on deployment success. **Deploy self-hosted server**
also invokes the same caller independently. Local `npm run ota:publish` dispatches that workflow and waits for
its exact successful run before uploading. Local `--dry-run` validates/exports without deploying or publishing.

## Request and success contract

The runner sends one empty HTTPS request with Little Say's scoped token:

```http
POST /deploy/little-say
Authorization: Bearer <little-say-scoped-token>
```

Only HTTP 200 with this JSON result permits the release to continue:

```json
{"service":"little-say","status":"succeeded","healthy":true}
```

The shared service pulls the configured `latest` image, recreates only the existing `little-say` Compose service,
and requires exactly one running container with the expected project/service labels and affirmative Docker
health. It owns Compose paths, registry access and server-side configuration. There are no caller-selected
commands, images, request parameters or deployment jobs to poll. The token authorizes only `/deploy/little-say`,
and must differ from Calibrate's token. It is separate from the WireGuard key and any GHCR pull credential.

The caller rejects redirects, non-200 results (including 202/409), malformed or incomplete JSON, wrong service
identity and negative health. It makes no automatic retry. Curl verifies HTTPS normally, pins the endpoint
hostname to `DEPLOY_HOST` for this request with `--resolve`, disables proxies, and routes only that private IPv4
through WireGuard. No DNS changes, default tunnel route or insecure TLS option is needed. Authorization is
passed on stdin rather than in process arguments; response bodies and raw subprocess errors are not logged.

The HTTP deadline is 780 seconds, exceeding the service's 660-second maximum subprocess budget and Traefik's
720-second response-header timeout. The Actions job is bounded to 20 minutes. The existing
`little-say-self-hosted-deploy` concurrency group serializes all callers in this repository without cancelling
an active upgrade. Runner keys and the temporary interface are removed after success or failure; the workflow
also removes the interface after cancellation. Hard runner termination can skip cleanup; the hosted runner
is ephemeral.

## GitHub configuration

The operator deploys the shared service, provisions reachable WireGuard peers, and supplies the values below.
Create/use GitHub environment **`self-hosted-testing`**, restricted to branch **`master`** (the repository's protected
default branch), with no tag rules. Keep required review policy as desired; unattended deployment requires no
environment approval/wait timer. Put deployment credentials at environment scope. The reusable workflow's caller
explicitly forwards the three secret names; values resolve from the deployment job's protected environment.

These names and value formats match Calibrate's webhook client:

| Environment variable | Value |
| --- | --- |
| `DEPLOY_HOST` | Private IPv4 of the reachable Traefik HTTPS endpoint |
| `DEPLOY_URL` | Full URL: `https://deployer.darkmachines.net/deploy/little-say` |
| `DEPLOY_WG_ADDRESS` | Supplied little-say runner IPv4 **without** CIDR suffix |
| `DEPLOY_WG_PUBLIC_KEY` | WireGuard server public key |

| Environment secret | Value |
| --- | --- |
| `DEPLOY_WG_ENDPOINT` | Reachable VPN hostname/IPv4 and UDP port, e.g. `vpn.example.com:51820` |
| `DEPLOY_WG_PRIVATE_KEY` | Supplied little-say runner peer's private key |
| `DEPLOY_TOKEN` | Little Say's token from the shared service, 43–128 base64url characters (64-character hex also works) |

`DEPLOY_HOST` is the private HTTPS destination and can differ from the VPN gateway. The endpoint URL includes
the application's path; it is not just an origin. The runner address has no `/32` suffix because the caller
adds it. Use Little Say's separate supplied peer/address and token; concurrency groups do not coordinate peers
across repositories. The shared service's Traefik allowlist must see the configured runner source address.

To replace the previous SSH configuration, add `DEPLOY_URL` and `DEPLOY_TOKEN`, remove `DEPLOY_SSH_USER`,
`DEPLOY_SSH_PRIVATE_KEY`, and `DEPLOY_SSH_KNOWN_HOSTS`, and point `DEPLOY_HOST` at the HTTPS destination. Keep the
existing WireGuard setting names. Keep repository `EXPO_TOKEN` and EAS settings for publication; the webhook job
receives no Expo credentials. Local OTA additionally needs authenticated `gh` with repository Actions read/write
permission. WireGuard and webhook secrets are never downloaded to the developer machine.

## Rollout and recovery

1. Complete the shared service's [operator rollout](https://github.com/MChartier/darkmachines/blob/3d4c4ae688be4d4ea9202a0c0158e68e34cd7151/deployer/ROLLOUT.md)
   in darkmachines and supply the environment values above. No
   little-say-specific server installer, user, sudo rule or SSH key is required.
2. Publish a Little Say image containing the Dockerfile's `/api/ready` healthcheck before relying on database
   readiness. The existing `/api/health` image probe checks HTTP responsiveness only. The new probe requires
   JSON `status: ok` and checks database/schema readiness when accounts/database integration is enabled.
   A source change alone does not change the published image. **Cut release** publishes/promotes this image
   before its deployment step; standalone deployment uses whatever `latest` currently contains.
3. After merge, dispatch **Deploy self-hosted server** from `master` with `request_id` blank, or use a server cut
   that publishes the readiness image first. Confirm the webhook reports success. Verify a failed deployment
   blocks OTA before relying on the full release path.

The shared service uses the existing darkmachines Compose file unchanged. That stack already runs Little Say's
database migration in its application startup command. Startup may therefore change the schema; deployment
failure is not an automatic database or image rollback. The controller itself neither migrates nor upgrades
database/proxy services, rewrites application configuration, nor installs application code on the host.

A connection failure, timeout, cancellation or lost response can leave the server still deploying even though
Actions failed. Inspect the shared service's logs and the application state before explicitly retrying. The
controller continues accepted work after a caller disconnects. HTTP 409 can mean an overlapping deployment or
`deployment_requires_reconciliation` after an uncertain Docker command. Follow `deployer/ROLLOUT.md` to reconcile
and clear that service-side block; restarting the controller alone does not establish successful deployment.
Once reconciled, rerun the failed job in the original release or dispatch the standalone workflow again. A
standalone success does not resume an older failed release or local OTA command. The local OTA command waits up
to 40 minutes including queue time and blocks publication if the exact run cannot be confirmed.

`latest` and the server can advance before a later native/OTA operation fails; retry the original release using
its retained journal. Docker health confirms the image's configured probe, not exact image/OTA version identity,
public application proxy/DNS/TLS availability, or external AI/Firebase health. The older explicit local
`server:deploy --digest ...` command retains its existing behavior and is separate from this webhook path.

## Validation

`npm run check` includes mocked webhook/connection failures, strict completed-success validation, token handling,
tunnel cleanup, workflow dependency gates and local OTA run correlation. Tests make no homelab calls and change
no real secrets. Live shared-service, routing, registry and application health checks remain operator rollout work.
