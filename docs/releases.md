# Releases

Use the pinned shared toolkit through the **Release** GitHub Actions workflow, dispatched from the protected default branch. The package and reusable workflow must reference the same reviewed full SHA. Install with npm normally; the toolkit's scripts/sync-engine.mjs updates pins and regenerates locks without copying snapshots.

Preview with npm run release -- plan --profile production, or validate configuration with npm run release -- validate. The public CLI is read-only. GitHub owns execution and approvals. The hosted workflow installs official EAS CLI 25.3.0 through Expo's action.

Native fingerprint changes allocate a new mobile major and build every enabled platform. A requested compatible rebuild allocates a minor and same-runtime OTA. JS/assets changes allocate a patch OTA. Expo runtime is the explicit mobile major. Older binaries sharing that major remain eligible; distinct older runtimes receive no automatic backports. Server inputs use a separate patch version and successful deployment baseline.

Versions are stamped into a tagged child build commit; default-branch files are not bumped. Failed reservations consume their numbers. Source checks, Docker production and OTA export have no publishing credentials. Selected server deployment must succeed before native delivery and OTA publication.

There are no candidate/version PRs, retained-artifact commands, promotions, local release wrappers, history imports or replay CLI. An uncertain request leaves its GitHub deployment record blocking. Inspect GitHub/EAS/store/deployer evidence and record a confirmed outcome before starting another dispatch; a timeout is not proof of failure. Store review and later promotions use EAS/store tooling.

Little Say uses EAS cloud builds for Android and iOS with one mobile semantic version, independent managed build counters and the existing net.darkmachines.littlesay identity. The internal profile distributes internally without submission; production submits through the configured EAS profiles. Both use the existing self-hosted-testing WireGuard deployment. GitHub internal/production environments must be restricted to the protected default branch. EAS environments remain preview/production. Source validation remains npm run check plus the existing service integration checks in CI.

See [fresh cutover](release-cutover.md) before the first dispatch.
