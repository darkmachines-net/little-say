# Translation integration evidence

Owner: implementation task `01a11cbb-ec94-715f-a3e4-7aa82a416016`, verified host `mchartier_zbook`. Retain this nonmerged evidence branch and all ancestor records for PR38 review and historical receipts; do not merge it into product history or delete prior captures. Authenticated repository reviewers have the same access as the product repository.

## Source and scope

Final head `6db60bbf2f7c43a4d9f88c4b22d5b9c2a4e4edef` has parents `6990cbbbeeb70c0c77d50b9c5e15a1fb835c183f` and actual master `18aa7c08615ecf60c8583f0590dcce8ed389f0ea`. Actual target, API base and merge-base agree. The additive, conflict-free merge incorporates human-merged PR42 and PR44. No force-push or branch restructuring occurred. No unmerged prerequisite or PR35 prompt extraction was imported.

[Complete ordered commits, parents and paths](records/integration-scope.json): 13 commits, 15 net files, +675/-69, comprising nine product files and six maintained regression files. The prior twelve-commit inventory is unchanged. Incoming release orchestration and prop-types dependency are master-owned; translation runtime and tests are byte-unchanged from the previously assessed head. No release/provider operation was executed.

## Executed validation and impact

- [Full check](records/integration-check.log): 325 unit tests across 41 files, TypeScript, release contract, server and web builds passed. The 26 additional cases are inherited release retirement regressions using controlled tests.
- [17 affected browser scenarios](records/integration-browser.log) passed on the integrated web build: manual and legacy empty drafts, Save/Duplicate refusal, cancellation, completion/reload, same-session source collisions, explicit AI replacement, failed saves, account navigation, direct entry and delayed/retried exact-text audio. Account snapshots/conflicts are covered by the full unit suite.
- [iOS export](records/integration-ios.log) and [Android export](records/integration-android.log) both passed on this exact head. PR44's runtime dependency resolves the former iOS export failure; this is author evidence for E1, not an independent QA verdict. Exact bundle paths, byte counts and SHA256 are in [identities.json](identities.json); original outputs remain in the task's local records directories for same-host QA.
- Current-head CI run [37870039933](https://github.com/MChartier/little-say/actions/runs/37870039933) passed. Its complete log and job readback are retained here.
- The 105 other previously passing browser cases are reused, not claimed rerun. Incoming changes modify release scripts and add a native Apple-auth dependency, with no translation UI/core/test changes. Fresh web builds, all 17 affected browser cases, current CI account/service checks and matching fresh captures support continued applicability. Prior reports remain at `6aa90658b6de8a015f955f386bafce365d996c83/qa-r1-final`.

## Genuine fresh Before/After captures

Before is isolated actual master `18aa7c08615ecf60c8583f0590dcce8ed389f0ea`; After is isolated final head `6db60bbf2f7c43a4d9f88c4b22d5b9c2a4e4edef`. [Manifest](captures/manifest.json) binds clean source status, build commands, export file hashes, server listener/process identity and browser-observed bundle bytes. [Harness](capture.mjs) and fixture content are retained. Run from the task root with `node capture-integration.mjs`, using its two isolated source paths and installed dependencies.

Manifest SHA256: `bba7939383d7f597e6e2c8ed54019faa2f29582cd2e9f6f0240c972f0ee64eae`.
Harness SHA256: `d8611e6380f4e73f6fea0279b6ae569fad265bceb1c082e51736960f6211e222`.
Fixture SHA256: `efb05254fa5cc816101e79e886fae48cea49f56457b0fc618801831725cdf193`.

All 12 images were freshly captured in Edge 154.0.4258.62 on Windows, 1180x1000, scale 1, light theme, en-US and UTC. Both use the same synthetic English/Russian/Spanish Cow and fixed Sheep, account-choice setup and controlled starting clock 2026-10-08T00:00:00Z with advancing timers. Provider/speech responses are mocked; fullscreen is neutralized and service workers blocked equally to exclude stale bundles/PWA notices. No compared UI or image pixels were edited. Play labels intentionally remain English. Both card views start at Position.

Board/card pairs demonstrate Russian in the primary controls while fixed/source words remain intact. The remaining images cover existing lower translation controls, protected replacement, source collisions, failed audio, restored corrections and empty-draft refusal. Author reopened and inspected fresh Before/After board/card images and empty-draft refusal: the latter shows both empty fields, the completion warning and disabled duplication/audio, with the label caption above the viewport. All twelve exact PNG hashes match the earlier independently inspected captures, as individually recorded in identities.json. This is fresh provenance, not relabeling old captures; independent QA must assess applicability/pixels for this integration.

## Feedback, preserved originals and limitations

Same-QA [6068206900](https://github.com/MChartier/little-say/pull/38#issuecomment-6068206900) cleared R1/C1 and left E1 only on the previous revision. The integrated iOS export now passes; same-QA integration reassessment remains pending. All six prior engineering threads remain resolved. Full issue/PR comments, submitted reviews and inline findings are retained in records. The current-head bot request received quota-only refusal [6072408054](https://github.com/MChartier/little-say/pull/38#issuecomment-6072408054); no current-head bot review completed, and no retry or billing change was made. Amendment6006523068 permits independent review despite this specific refusal.

Exact prior PR description is [preserved](pr-body-before.md), SHA256 `1c3c4fc6211ccec443bf32e19304ae38e875fb0c6a3ca467a24935920ff3aad1`. Prior publication `d43e8482912e87d7f7c422770c163590e4e54ee1/qa-r1-publication/record.json` and prior capture commit `6aa90658b6de8a015f955f386bafce365d996c83` remain retained unchanged. Original evidence `9a8f7318d925dab559f2992a2b47525f691d18ff/README-current.md`, publication `b2f37412d8449e1c4a38d358612711b794c4fb8d/publication/record.json`, source `a08a723d87cee4bbb3026f11b3fcfa8c63c6f2ce` (parent `7e8ab5993503419e5945c8f304ffab3a6fc91f56`) and manifest `240f2955b99d138d9b3382762a97de7e33d3a47731597458236a860b2a9135a8` are unchanged and remain under retained evidence refs.

Native-device/emulator and live-provider execution remain unrun. Native checks are deferred by the human; browser/export checks are not native execution. GitHub rendered-page inspection is waived, not claimed passed. PR38 stays draft without human-ready. Root owns independent QA and any readiness transition. No merge, deployment, release or Project mutation occurred.
