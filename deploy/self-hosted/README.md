# Automatic private-server deployment

GitHub-hosted Actions connect over WireGuard and SSH to the existing Linux Compose host. The fixed host command
pulls the image configured in Compose, upgrades only `little-say`, waits for Docker health, and checks `/api/ready`
inside the container. The Compose files and environment stay unchanged; configure the application image as
`ghcr.io/mchartier/little-say:latest`.

**Cut release** promotes a verified server image to `latest` before deployment. Server releases and OTA releases
run this deployment; internal and production OTA publication wait for its success. Native-only releases and
no-op cuts do not deploy. **Deploy self-hosted server** also runs the same upgrade independently. The local
`npm run ota:publish` command dispatches that workflow and waits for its exact successful run before uploading.
Its `--dry-run` only validates/exports and does not deploy. There is no opt-out switch for the OTA gate.

This follows [GitHub's WireGuard networking guidance](https://docs.github.com/en/actions/how-tos/manage-runners/github-hosted-runners/connect-to-a-private-network/connect-with-wireguard).
The application and SSH ports can remain private; only the VPN endpoint's UDP port needs to be reachable by
the GitHub runner. No persistent GitHub Actions runner is installed on the application host.

## Install the host upgrade command

The host needs Docker Engine, Compose v2 with `pull --policy always` and `up --wait`, OpenSSH, `sudo`, and Node 24
at `/usr/bin/node`. Provision the database, proxy, service environment and existing stack normally first.
The CI command neither builds source nor manages database/proxy services. Accounts require their configured
database and explicit migrations before the new server starts; see [accounts](../../docs/ACCOUNTS.md) and
[database commands](../../docs/POSTGRES.md#explicit-migrations).

From a reviewed checkout on the host:

```sh
sudo install -d -o root -g root -m 0700 /etc/little-say /etc/little-say/registry
sudo install -o root -g root -m 0644 deploy/scripts/self-hosted-deploy.mjs /usr/local/lib/little-say-deploy.mjs
sudo install -o root -g root -m 0755 deploy/self-hosted/little-say-deploy /usr/local/sbin/little-say-deploy
sudo install -o root -g root -m 0600 deploy/self-hosted/deploy.example.json /etc/little-say/deploy.json
sudoedit /etc/little-say/deploy.json
```

Set `projectName` to the existing name from `docker compose ls`; changing it changes the named cache volumes.
Set `projectDirectory` to the existing stack directory and `composeFiles` / `envFile` to the files used by your
normal Compose command (relative to that directory). The example uses `/srv/little-say/compose.yaml` and `.env`.
Keep existing proxy/network/credential-mount overrides in `composeFiles`. `waitTimeoutSeconds` defaults in the
example to 300 and accepts 1–480 seconds. The fixed service name must be `little-say`.

If setting up a new published-image stack, install `deploy/compose.yaml` as `/srv/little-say/compose.yaml`.
The root-level repository Compose file builds source and is for local development. For the published-image file,
use a root-owned `/srv/little-say/.env` such as:

```dotenv
LITTLE_SAY_SERVER_IMAGE=ghcr.io/mchartier/little-say:latest
LITTLE_SAY_SERVER_ENV_FILE=/etc/little-say/server.env
BIND_ADDRESS=127.0.0.1
PORT=8787
```

Create `/etc/little-say/server.env` with the existing application settings: backend API key, `ALLOWED_ORIGINS`,
model settings, and any Firebase/PostgreSQL configuration. Keep any required credential mounts in your existing
Compose override. Do not copy server secrets into GitHub or Git. Start a new stack manually before enabling CI.
For private GHCR packages, provision a read-only pull credential on the host using
`sudo docker --config /etc/little-say/registry login ghcr.io`; public packages need no login.

Keep the wrapper, module, config, Compose files, application environment and all their parent directories owned
by root and unwritable by the deployment account. The wrapper clears its environment, ignores stdin and accepts
no arguments. The remote caller cannot choose a command, image, environment file, or Docker context.

## Restrict SSH

Create a dedicated account and separate unencrypted Ed25519 CI key. Example Debian/Ubuntu setup:

```sh
sudo useradd --create-home --shell /bin/sh little-say-deploy
sudo install -d -o root -g root -m 0755 /etc/ssh/authorized_keys
sudoedit /etc/ssh/authorized_keys/little-say-deploy
```

The root-owned authorized-keys file contains only the CI public key with this forced command:

```text
restrict,command="sudo -n /usr/local/sbin/little-say-deploy" ssh-ed25519 REPLACE_WITH_CI_PUBLIC_KEY little-say-ci
```

Add `/etc/ssh/sshd_config.d/little-say-deploy.conf`:

```text
Match User little-say-deploy
    AuthorizedKeysFile /etc/ssh/authorized_keys/little-say-deploy
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitTTY no
    AllowTcpForwarding no
    AllowAgentForwarding no
    X11Forwarding no
Match all
```

Validate with `sudo sshd -t`, then reload the distribution's SSH service while retaining your administrative
session. Ensure the dedicated account can authenticate under the host's account policy. It must not belong to
the Docker group or have other sudo privileges. With `sudo visudo -f /etc/sudoers.d/little-say-deploy`, add:

```sudoers
little-say-deploy ALL=(root) NOPASSWD: /usr/local/sbin/little-say-deploy ""
```

The empty argument string permits the wrapper only without arguments.

## Configure WireGuard and GitHub

Use a **separate little-say CI peer/key/address**, even if Calibrate uses the same VPN gateway. The two repositories'
concurrency groups cannot serialize a shared peer. On the gateway, configure this peer's allowed source as its
unique `/32`. Firewall its traffic to TCP port 22 on the little-say Docker host only, including forwarded traffic
if gateway and host differ. Client `AllowedIPs` routing is not a firewall.

Create GitHub environment **`self-hosted-testing`**. Under deployment branches/tags, select only branch **`master`**
(or the repository's actual default branch), with no tag rules. Protect that branch and review workflow changes.
Leave reviewers/wait timers off if deployments should run automatically. Store deployment credentials only in this
environment. The reusable deployment job receives these explicitly forwarded names as described by
[GitHub's environment-secret rules](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows#using-inputs-and-secrets-in-a-reusable-workflow).

| Environment variable | Value |
| --- | --- |
| `DEPLOY_HOST` | Docker host's reachable IPv4, e.g. `192.168.1.10` |
| `DEPLOY_SSH_USER` | `little-say-deploy` |
| `DEPLOY_WG_ADDRESS` | Dedicated little-say CI peer IPv4 without CIDR, e.g. `10.8.0.21` |
| `DEPLOY_WG_PUBLIC_KEY` | WireGuard gateway's public key |

| Environment secret | Value |
| --- | --- |
| `DEPLOY_WG_ENDPOINT` | Public VPN hostname/IPv4 and UDP port, e.g. `vpn.example.com:51820` |
| `DEPLOY_WG_PRIVATE_KEY` | Dedicated little-say CI peer private key |
| `DEPLOY_SSH_PRIVATE_KEY` | Dedicated unencrypted CI SSH private key |
| `DEPLOY_SSH_KNOWN_HOSTS` | Verified host-key line for `DEPLOY_HOST`, e.g. `192.168.1.10 ssh-ed25519 AAAA...` |

Obtain the SSH host key through a trusted administrative connection. CI requires that pinned key and never trusts
an in-job `ssh-keyscan`. Keep existing `EXPO_TOKEN` and EAS settings for OTA; the deployment job does not receive
Expo credentials. Local OTA additionally needs `gh` authenticated for this repository with Actions read/write
permission to dispatch and inspect the deployment workflow. VPN and SSH private keys stay in GitHub's environment.

## Rollout and recovery

1. Install the host files and configure Compose, application settings, SSH restrictions and WireGuard routing.
2. Apply any required schema migration explicitly with the release image before upgrading an accounts-enabled
   server. The helper does not run migrations or roll them back. `/api/ready` fails if the configured database
   is unavailable or its migration history differs from the server.
3. Run `sudo /usr/local/sbin/little-say-deploy` on the host. This performs a real upgrade to the configured image.
4. Configure the protected GitHub environment, merge the workflow, then run **Deploy self-hosted server** on
   `master` (leave `request_id` blank). Confirm a successful run before using **Cut release** or local OTA publication.

The host command is identical for manual and CI upgrades:

```sh
docker compose pull --policy always little-say
docker compose up -d --no-deps --no-build --pull never --wait --wait-timeout 300 little-say
```

The installed helper supplies your configured project/file arguments, then requires exactly one healthy container
and a successful in-container `/api/ready` response. It does not test proxy/DNS/TLS availability, external AI/Firebase
requests, or exact OTA/server version identity. It follows whatever `latest` resolves to when pulled.

A connection, pull, startup or readiness failure blocks OTA and release completion. Inspect the stack locally with
the usual Compose `ps` and `logs --tail 100 little-say` commands. Fix the cause and rerun failed jobs in the original
release, or rerun the standalone deployment. A standalone success does not resume a failed release/OTA command.
Each deployment pulls the current configured image again. `latest` can already be advanced and the server upgraded
even if a later OTA/build/submission fails; retry the original release to finish its existing operations.

There are no deployment locks, backup prerequisites, image overrides, deployment receipts, automatic rollback,
volume removal or image pruning. Avoid overlapping manual upgrades with CI. GitHub serializes this repository's
deploy jobs and does not cancel a running upgrade when a new one is queued. Local OTA times out rather than publish
when deployment cannot be confirmed; the dispatched job may still run and must be inspected before retrying.

The older `server:deploy --digest ...` command remains an explicit local operation with its existing image rollback
behavior. Use the installed host wrapper for routine upgrades to this managed stack so manual and CI paths agree.
Install later host helper/config updates explicitly; the workflow never updates installed host code.

## Validation

`npm run check` includes mocked Docker/SSH/WireGuard failure and cleanup coverage, affirmative readiness checks,
workflow gating, promotion ordering and the local OTA dispatch gate. These checks do not deploy to the private
server. Host setup and the successful standalone workflow run above are required rollout checks.
