# Releases

GitHub publishes the server image. A developer machine builds and submits native apps, publishes OTA updates, and deploys a published server image. None of those local operations run in GitHub Actions.

## First-time setup

1. Merge the app and release workflow into the repository's default branch before using **Cut server release**.
2. In GitHub **Settings → Actions → General → Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**. The workflow creates release PRs but does not approve reviews. Keep the default token permissions read-only: the jobs explicitly request `contents: write`, `pull-requests: write`, and `checks: write` for cutting a release, and `packages: write` for publication. All use `GITHUB_TOKEN`. Enable squash merges. Keep any required reviews; the workflow never bypasses them.
3. Create/link an Expo project with slug `little-say` in the intended account. Supply its owner, UUID, and the public HTTPS server origin:

```powershell
npm ci
npm run native:setup
npm run native:configure -- --owner YOUR_EXPO_ACCOUNT --project-id YOUR_PROJECT_UUID --server-url https://YOUR_SERVER
```

The values above are placeholders. `native-release.json` deliberately has no guessed account, project, or server. Configuration reads back the exact Expo project. Review and commit that file before a build.

Android needs a JDK, Android Studio SDK/Build Tools, and `ANDROID_HOME` (or `ANDROID_SDK_ROOT`). `native:setup -- --check` checks the existing tools without installing npm dependencies. The Gradle wrapper downloads its required Gradle version. SDK packages must be installed and their licenses accepted. Use Node 24 and `npm ci` for the root dependencies.

For a new Expo project, set up its Android keystore once using the **pinned** CLI, then rerun `native:configure`:

```powershell
cd apps/mobile
node ../../tools/eas-cli/node_modules/eas-cli/bin/run credentials --platform android
cd ../..
npm run native:configure
```

The wrapper downloads the default EAS signing key for **net.darkmachines.littlesay**. It saves it outside the repository, alongside the machine configuration. Existing signing credentials can instead be supplied with `native:configure -- --credentials C:/PRIVATE/credentials.json`; that EAS-format JSON must reference an absolute external keystore path. Never change the signing key of an already installed app to solve an installation error.

Local iOS builds need macOS, Xcode and CocoaPods. Run `native:setup -- --platform ios` there and add `--platform ios` to `native:configure`. Configure Apple signing with the pinned CLI's `credentials --platform ios`; register test devices for the `internal` ad hoc profile. No command falls back to a cloud build. See [Expo local build prerequisites](https://docs.expo.dev/build-reference/local-builds/).

## Cut a server release

Ordinary feature commits do not bump or publish server versions. In GitHub Actions, run **Cut server release** on the default branch, choosing `patch`, `minor`, or `major`. Its `prepare` and `publish` jobs handle the entire release; there is no separate publishing workflow to launch or commit SHA to enter.

The workflow invokes `npm run release:cut`, which supplies `npm_execpath` for nested validation commands on the Ubuntu runner. This entry point requires GitHub Actions; do not launch `server-cut.ts` directly with Node.

The action:

1. Increments `release.json` and its root/server package and lockfile mirrors, leaving native versions unchanged.
2. Validates the version-only commit with `npm run check`, pushes a branch named `release/server-run-<run-id>` and records the same `check` result on that exact commit. The run ID lets retries find the same candidate. This explicit check is needed because `GITHUB_TOKEN` pushes do not trigger normal PR workflows.
3. Creates a release PR and attempts a normal squash merge. Required reviews and other protection rules still apply.
4. Publishes the merged release commit as a multi-platform (`linux/amd64`, `linux/arm64`) GHCR image, creates Git tag `vX.Y.Z`, and reads back the image digest.

The image repository is `ghcr.io/<github-owner>/<github-repository>`. Tags are `vX.Y.Z`, `sha-<full-release-commit>`, and `latest`. Existing version/SHA tags are checked and reused, never rebuilt over. Recovering an older release cannot move `latest` backwards. Publication creates a Git tag and container image, not a GitHub Release object. No Expo or server deployment secrets are needed in GitHub.

If a review, required workflow, or merge queue prevents an immediate merge, the action leaves the PR and its URL in the run summary. Complete the normal review/merge process, then select **Re-run failed jobs** on that same **Cut server release** run. Preparation resumes its existing PR and passes the validated merged commit directly to publication. A closed, unmerged release PR is treated as abandoned; it is never silently replaced by a retry.

After a tag or image publishing failure, select **Re-run failed jobs** on the original run to retry publication of the same commit. Re-running all jobs also reuses that run's release rather than bumping another version. Existing immutable image tags are verified and reused. Start a new workflow run only when you intend to prepare a new release; close any abandoned open release PR first. GitHub supports [re-running jobs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs) for 30 days after the original run.

The GitHub repository/package must permit `GITHUB_TOKEN` to publish to its GHCR namespace. First publication may be private; set package visibility or give the deployment machine pull access as intended. Publication alone does not change a running server.

## Build, install and submit native apps

Native version and runtime live in `native-release.json`, independently of server releases. To allocate the next native version/build numbers, start with a clean committed checkout:

```powershell
npm run release:prepare -- native --bump patch
# Review and commit the version changes, then:
npm run native:build -- --platform android --profile production
npm run native:install -- --platform android --profile production --device DEVICE_SERIAL
npm run native:submit -- --platform android --profile production --dry-run
npm run native:submit -- --platform android --profile production
```

Build never increments versions automatically. Android uses local Gradle with EAS-managed signing and produces both an APK for in-place installation and an AAB for Play from the same source/configuration. Signatures, application ID, and APK versions are checked. `adb install -r` preserves local boards; a signer mismatch is an error, never an uninstall/reinstall fallback. If Play App Signing uses a different app-signing certificate, use the Play internal track to upgrade an existing Play installation rather than sideloading an upload-key APK.

`--profile internal` uses channel `internal` / EAS environment `preview`. `--profile production` uses channel/environment `production`. The production Android submission initially targets a **draft on Play's internal track**, not an automatic public rollout. Adjust the committed submission profile when ready. Play requires an initial manual app/upload setup and an authorized service-account key; EAS Submit prompts for or reuses that credential. Follow [Expo's Android submission setup](https://docs.expo.dev/submit/android/).

On a Mac:

```sh
npm run native:build -- --platform ios --profile production
npm run native:submit -- --platform ios --profile production --dry-run
npm run native:submit -- --platform ios --profile production
```

iOS builds run `eas build --local`. Production IPAs go through EAS Submit to App Store Connect/TestFlight. Complete App Store Connect app setup and Apple credentials; you can set `ascAppId` in the production submission profile to avoid selecting the app each time. An `internal` iOS IPA uses ad hoc signing and cannot be submitted to the store. Install it with Xcode Devices on a registered device; the wrapper's `native:install` currently handles Android only.

Builds, baseline JSON files and receipts are retained under `%LOCALAPPDATA%/little-say` on Windows or `$XDG_CONFIG_HOME/little-say` (default `~/.config/little-say`) elsewhere. They survive `expo prebuild --clean` and worktree cleanup. Copy the entire build directory when transferring it between machines, and pass `--baseline /path/to/baseline.json`. Install/submit require the original clean build commit and verify artifact hashes; they never rebuild or choose an unspecified latest EAS build. EAS submission completion is separate from store processing, approval, availability, and device installation.

## Publish an OTA update locally

Install or distribute a native build containing `expo-updates` first. Expo Go and previous binaries lacking this module are not OTA targets. Start from a clean committed JS change descended from that native build:

```powershell
npm run ota:publish -- --platform android --profile production --message "Improve board editing" --dry-run
npm run ota:publish -- --platform android --profile production --message "Improve board editing"
```

Repeat for `--platform ios` with that platform's retained baseline. Use `--baseline` to select a particular installed/distributed build. A default baseline records the most recent successful local build; it does **not** prove that a device has installed it.

The wrapper verifies clean source, baseline ancestry, Expo owner/project, server URL, native version/build numbers, channel/environment, retained artifact hashes, and Expo's native fingerprint. It reads the selected EAS environment through the pinned CLI adapter and verifies it matches the build. The environment must be reproducible locally: no unreadable secret or file variables, no backend OpenAI keys, and no `EXPO_PUBLIC_*` URL overrides. The compiled server origin comes from `native-release.json`; settings can still override it on a device. Local `.env` files and development API URLs are excluded from native release commands.

A dry run exports the actual JS bundle but publishes nothing. Publication uploads that already exported bundle, waits for EAS, reads the resulting group back, checks platform/runtime/source, and saves a receipt. A changed native dependency, plugin, permission, app configuration, or runtime requires a new native version/build. JavaScript and board UI changes with an unchanged native fingerprint can use OTA. Source and environment must stay unchanged throughout the command.

Native updates check/download on launch and apply on a subsequent launch, without forcing a reload during a child's board session. A successful publication does not prove that a specific device has downloaded or applied it. Validate the actual target device after reopening the app.

## Deploy the server from your machine

Docker Compose v2 and a Docker context targeting the server are required. For an SSH host, create the context locally (the host needs Docker and your SSH key access):

```powershell
docker context create little-say-host --docker host=ssh://USER@HOST
npm run server:configure -- --context little-say-host --image ghcr.io/OWNER/REPO --server-url https://YOUR_SERVER --env-file C:/PRIVATE/little-say-server.env
npm run server:deploy -- --digest sha256:DIGEST_FROM_GITHUB_SUMMARY --version 0.1.1 --dry-run
npm run server:deploy -- --digest sha256:DIGEST_FROM_GITHUB_SUMMARY --version 0.1.1
```

For a local Docker engine, use `--context default`. The external environment file contains `AAC_OPENAI_KEY` (or `OPENAI_API_KEY`), `ALLOWED_ORIGINS=https://YOUR_SERVER`, and any model settings from `.env.example`. Docker binds to `127.0.0.1:8787` by default for a reverse proxy; use `BIND_ADDRESS`/`PORT` only as needed. Authenticate the local Docker client to GHCR if the package is private. The local Compose client reads the external env file and sends the service configuration to the selected Docker engine; no secret files enter Git or the image.

For an existing Compose deployment, set `--project` to its existing project name so its `<project>_speech-cache` volume is reused. The default is `little-say`. This command never removes volumes. It pulls by immutable digest, checks image version/revision labels, replaces only the service, waits for container health, and verifies `/api/health` through the configured server origin. On failure it restores the previous image when one exists; it does not roll back edits to the external environment file. First-deployment failures remain available for inspection. Successful image publication, container deployment, and external health verification are distinct events.

## Validation and limits

`npm run check` validates version mirrors, TypeScript, unit/regression tests, server build and web export. Release tests exercise version-only transitions, dirty-source rejection, OTA baseline guards, artifact tampering, environment separation and workflow permissions/triggers. Native credentials, an actual EAS project, GitHub repository permissions, signing/builds on each host, and the self-host target must be validated during onboarding; local tests cannot prove store or device rollout.
