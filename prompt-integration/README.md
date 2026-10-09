# Actual-master prompt integration

Implementation owner `01a11cbb-ec94-715f-a3e4-7aa82a416016`, verified `mchartier_zbook`, 2026-10-09 UTC. Unchanged workflow-v3 and pr-review-v3 pins/amendments. Retain this record and every ancestor on the existing nonmerged evidence branch; originals and prior receipts remain historical.

## Source and full published scope

Final head `9cada3111541357bc720b9ad66ccfeaa7081171e`; actual master/API base/merge-base `768811832bd0b389ba7e24738fb58800ea145000`. Immediate parents are `6db60bbf2f7c43a4d9f88c4b22d5b9c2a4e4edef` and `768811832bd0b389ba7e24738fb58800ea145000`. No unmerged prerequisite.

[Complete ordered scope](records/prompt-scope.json): 14 commits, 15 files, +675/-69. All prior thirteen commits/parents/path inventories are unchanged. The new additive merge imports the 21-file human-merged PR35 patch exactly (equal stable patch IDs), with automatic AiConversation merge and no manual conflict resolution. The actual-master-to-final range still consists of nine translation product files and six maintained regression files. Prompt extraction is now target ancestry, not a new PR38 outcome. No evidence churn or branch rewriting entered product history.

## Affected validation

[Full check](records/prompt-integration-check.log) passes: 331 units across 45 files, TypeScript, release-contract check, server and web builds. It includes complete mocked provider-payload snapshots for translation, board generation, pictures, transcription and exact speech instructions, starter/conversation byte snapshots, invalid-resource/single-pass substitution tests, and a source-free bundled-resource process check.

[34 Edge scenarios](records/prompt-integration-browser.log) pass on the final build: all 17 translation cases, fourteen conversation cases and three setup cases. They exercise protected/manual/legacy drafts, exact-language audio retries, source collisions, explicit AI decisions, direct-entry/cancellation/save failures, preset loading, multilingual setup and account navigation. Another 88 previously passing browser cases are reused: their source and product paths are unaffected, while final-head CI exercises account/service integration. Do not describe those 88 as rerun.

[iOS](records/prompt-integration-ios.log) and [Android](records/prompt-integration-android.log) exports pass on final head with the new shared JSON imports. [Exact output identities](identities.json) bind every artifact; originals remain in the task-local export directories for same-host QA. Lockfile/dependencies are unchanged. An initial merge command stopped before mutation because local commit identity was absent; its prematurely started old-head check was interrupted and is retained as such, not a validation result. The merge then used command-local author identity and every result above ran after final commit creation.

This ordinary release-contract check does not certify separate issue45's release-validator scenario. No release, provider, deployment or credential operation ran.

## Existing captures remain applicable

The twelve genuine captures remain unchanged at [19e49364a5814ba30e77e53c96f6f0f72437cdef](https://github.com/MChartier/little-say/blob/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/README.md): actual captured Before `18aa7c08615ecf60c8583f0590dcce8ed389f0ea`, After `6db60bbf2f7c43a4d9f88c4b22d5b9c2a4e4edef`. They are not recaptured or relabeled. Manifest SHA256 `bba7939383d7f597e6e2c8ed54019faa2f29582cd2e9f6f0240c972f0ee64eae`; fixture, harness, image and running-build identities remain exactly as previously independently verified.

Incoming UI changes consist solely of an import plus three existing conversation preset strings loaded from validated JSON. The impact script checks every extracted value occurs byte-identically in both original baseline and original head. Board/card editors, account routes, translation schema/merge/audio keys and all capture fixture/harness inputs are unchanged. Server prompt text is preserved by complete request snapshots. Preset/resource paths now have final-head unit, browser, web/server and native-export validation. Therefore no captured text, layout, fixture, navigation state or baseline behavior changed. The previous independent pixel assessment applies to the same exact artifacts; same QA must confirm this new-target applicability.

## Feedback and publication

[QA6072748216](https://github.com/MChartier/little-say/pull/38#issuecomment-6072748216) cleared C1 and retained prior technical assessment for its original target, then correctly withheld readiness for actual-target drift E2. Its exact comment and verdict hashes were verified. This record supplies the new-target integration and impact evidence; it does not self-award QA or readiness. All full issue/PR comments, submitted reviews and inline findings were reread; prior content is unchanged and only C1 handoff/E2 comments were added. The quota-only bot refusal remains historical; no bot review is claimed on new head and no quota retries were sent.

Exact pre-edit body is [retained](prior-pr-body.md), SHA256 `9d785993081bb52f119546e001a9ef62a69b6cb90d2dc28f6d365d77006d1ee8`, also preserved at `08ba41a38c2be8adb78b6624eec45f44c73808e0/description-correction/description-corrected.md`. Earlier originals remain under `9a8f7318d925dab559f2992a2b47525f691d18ff`, `b2f37412d8449e1c4a38d358612711b794c4fb8d`, and source `a08a723d87cee4bbb3026f11b3fcfa8c63c6f2ce`; no identity was replaced.

Native-device/emulator/live-provider testing remains unrun; native checks deferred and rendered-GitHub inspection waived. Draft remains true without human-ready. Coordinator/Project/readiness mutations remain untouched. Root owns same-QA rebind and any eventual readiness action.
