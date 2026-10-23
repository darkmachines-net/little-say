# Little Say release cutover

Install the pinned shared package with npm, then run `npm run release -- setup`. Local and hosted execution share the official locked EAS toolchain in an external cache. The package and reusable workflows must reference the same full reviewed SHA.

The new system starts fresh release history. It does not read old journals, imported baselines, old local settings or pending requests; those releases cannot be recovered or promoted through it. Do not resume a legacy request during migration. New releases keep immutable plans, receipts and provider IDs, with reconciliation required before retrying unknown outcomes.

Allocation floors: Server 0.3.3; native 0.1.4; Android code 5 and iOS build number 5. Read-only EAS inventory of all 14 builds confirms both platform maxima at 5; platform counters remain independent. Published Git tags were inspected during migration. EAS inventory and committed reservations were checked; direct Play/App Store high-water verification remains a live-cutover prerequisite. Recheck provider high-water marks if another release runs before cutover; raising a floor requires no legacy reader. No store submission, OTA update or deployment is performed by this migration.

Reconfigure existing external signing paths in `expo-release.json`; preserve the existing key and application identity. Local setup must not manufacture a new key or adopt old artifact caches. Existing installations can receive OTA updates when their runtime matches a newly verified release. No artificial runtime change is required. Only runtimes established by the new history are enumerated for future updates.

Hosted builds remain EAS cloud builds. Local Android uses the existing command builder; local iOS remains macOS-only. Keep appVersion runtime policy, existing EAS destinations, approval environments and the server-or-OTA deployment prerequisite. The retirement policy now contains only retiredRuntimes; importedBaselines is removed.

The first release establishes fresh applicable native/server baselines through the existing candidate and approval flow. Future recovery and retained submit/promote/deploy operations use the new receipts. Local receipts never grant hosted provenance. Physical device acceptance and live cutover remain separate human actions.
