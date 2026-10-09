# Current-target metadata and evidence assessment

Read-only source assessment on verified `mchartier_zbook`, 2026-10-09 UTC, by existing implementation owner `01a11cbb-ec94-715f-a3e4-7aa82a416016`. Full supplied execution pin `f0919b184b6344d6279178b2388190936ca432a9`, communication pin `97e5583c8355f3673aad0835c0ce3ca1486aeb8b` and direct amendments acknowledged. Current repository AGENTS unchanged. Existing task ownership and other idle Little Say owners were checked; only this task writes PR38 metadata. Source comparison uses an isolated detached checkout under the allocated task directory.

## Exact source distinction

PR head remains `9cada3111541357bc720b9ad66ccfeaa7081171e`, parents `6db60bbf2f7c43a4d9f88c4b22d5b9c2a4e4edef` and `768811832bd0b389ba7e24738fb58800ea145000`. Actual master is `b46e9e83ffacb2e3846486fb7a64a57d1203f372`; API base and merge-base remain `768811832bd0b389ba7e24738fb58800ea145000`. No source integration or product commit occurred.

[Live compare](records/compare.json) and [complete incoming diff](records/incoming.diff) show two merged commits: PR46 `1f598940a5c692a4e5ae5f5c4956e34cd6c94340` and version-only PR47 `b46e9e83ffacb2e3846486fb7a64a57d1203f372`. Fourteen incoming paths are disjoint from all fifteen translation paths. All fourteen published PR commits and fifteen files remain identical to the prior inventory, +675/-69. The actual-target three-dot PR range remains fifteen files; a direct comparison of diverged tree tips additionally includes target-only release/version differences and is not the proposed merge scope. No conflict probe or synthetic merge is presented as validation.

PR46 replaces the release validator's bare integration call with the maintained Auth-emulator service wrapper and introduces an isolated manual validation-only job. Its workflow, tests and documentation are release-tooling paths; normal PR CI is unchanged. Issue45's fix is now merged. This assessment does not run release validation, providers or release operations.

## Dependency and build identity effects

After removing only root/mobile/server workspace version fields, the two package-lock JSON objects are deeply identical: no resolved dependency, integrity, package graph or runtime dependency changed. App/server/core runtime sources, browser tests, shared prompts and app config code are unchanged.

Versions do change: mobile 0.1.1→0.1.2, native build numbers 2→3, root/server 0.2.1→0.3.0. The unchanged app config reads native-release.json and uses appVersion for OTA runtime identity. Parent Settings displays the app version; server health/readiness responses embed release.json's version. Therefore actual b46 builds can have different configuration/manifest/bundle bytes and identities. Prior export/build hashes are valid only for their recorded sources, never claimed as b46 or a combined b46+translation build. No new build, export, native compile or signing run was performed.

## Translation evidence applicability

Selected-language fields, empty-correction refusal, source/other-language preservation, account persistence, exact-text/language audio identity and explicit AI replacement code remain unchanged. The twelve genuine images show translation/editor/correction states, not the Settings version label or health/readiness output. Their data, fixture, viewport, theme, controlled clock and harness are unchanged. No new screenshots or expensive test reruns are warranted solely for these metadata changes.

Captures stay at original Before `18aa7c08615ecf60c8583f0590dcce8ed389f0ea` and After `6db60bbf2f7c43a4d9f88c4b22d5b9c2a4e4edef`, retained at [19e49364a5814ba30e77e53c96f6f0f72437cdef](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/README.md). Manifest SHA256 `bba7939383d7f597e6e2c8ed54019faa2f29582cd2e9f6f0240c972f0ee64eae`; all original image, fixture, harness and served-build identities are preserved and reverified. Their representative translation behavior remains applicable; they do not certify changed build metadata or the separate native toolchain.

The 331 units/34 affected browser cases, CI run37873230024, iOS/Android exports, and independent 17 tests/four Edge cases retain their original 9cada/768 source bindings. None was executed against b46 in this continuation. Historical [QA6073011337](https://github.com/MChartier/little-say/pull/38#issuecomment-6073011337) and immutable `841d692fb92a531f9ac5f3fe27cafc2d59523b27/verdict.json` are preserved exactly in this record; the prior ready assessment is not silently rebound to the newer target.

## Preservation and limits

Exact previous PR body SHA256 `5fd67eab73c71f355b718235d14d9d9afdb4afb5a4a6561223eb18b14009e7ee` and issue body SHA256 `5506a33cded0cec3774a18dfe49884443a5573d3d02ea3991921c0768297234c` are retained before editing. Prior impact `a42da943d5bfbed0d2faf452e0f7833a65f3bc55/prompt-integration/README.md` and receipt `df823a0631fdf947ad1ce52ba98058b2fabecedc/prompt-publication/record.json` remain untouched, along with all earlier originals. Retain these records on the existing nonmerged evidence branch for repository reviewers.

[PR49](https://github.com/MChartier/little-say/pull/49) is open, not in master. Its missing-OAuth CocoaPods fix is separate. Successful JavaScript exports do not establish pod installation, native compilation/signing or provider success. Native-device/live-provider testing remains deferred/unrun; GitHub rendering check remains waived.

No translation source correction was established by this comparison. No merge/rebase/cherry-pick, product commit, release, deployment, installation, readiness, lifecycle or Project change occurred. Same independent QA must assess the current-target applicability and final description; any subsequently required source integration needs a separate ROOT admission.
