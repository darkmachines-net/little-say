# Independent QA: PR36 / issue30

**Verdict: evidence-incomplete.** No source defect found in the full one-commit, 13-file child scope or targeted browser review. Native acceptance evidence remains missing; PR34's own native deferral does not extend to this child.

The requested direct parent-hold-to-editor and return flow is worthwhile and proportionate. All nine product files and four maintained test files map to issue30; no development/evidence churn, packages, sibling commits or unrelated account/audio work entered the product history. The actual target and merge-base are parent PR34 at b21d3ba, not master; full immutable identities are in [record.json](record.json).

## Findings

**F1 — native validation missing.** The new native unlock/countdown, cancel/focus and transition behavior has only mocked events and bundle compilation behind it. Native rotation, OS text scaling, VoiceOver and TalkBack were not executed; no native target was connected. Removing the confirmation makes real assistive activation/focus validation consequential. Obtain the scoped native evidence, or an explicit human decision for PR36. No source correction is currently demonstrated. Any later correction belongs to the existing PR36 owner through the coordinator and requires affected issue32 child gates to be invalidated.

## Independently checked

- All live issue/PR conversation bodies, submitted reviews and inline threads; every item has a disposition in the detailed record. Actual bot review completed on this head and reported no major issues. Exact-head CI passed. Retained225 unit / 19 browser and native-JS-export logs verified; unaffected suites not duplicated.
- All 80 bound artifact hashes and 13 API-accessible original image/provenance files. Opened six genuine Before/After images plus four supplementary endpoint views. Default-size wide/portrait views are readable; short landscape keeps Return to play fixed and other controls reachable by scroll.
- Twelve browser combinations:4 / 7 / 24 cards across wide/portrait/tablet/short landscape. Last-card editing and idle return passed. Tested minimum editor side was57.65625px (phone 24: 64 px); dense text can ellipsize, with full accessible/edit labels available.
- Exact hold boundary, outside/resize cancellation, keyboard focus, three real-clock assistive start/cancel/complete cases, failed save/retry/reload, pending speech/late completion, reduced motion/transition resize, photo crop and IDs/order/media/draft/consent preservation. Initial synchronization diagnostics are retained and explained; unchanged product source passed settled checks.
- Decoded the original immutable motion video using existing FFmpeg: [4.2s](probe/decoded-motion-4.2.png), [4.4s](probe/decoded-motion-4.4.png), [4.6s](probe/decoded-motion-4.6.png). These actual frames show source, intermediate shrink and finalpreview. Original video SHA-256: 248246968f345b700dbb6915c2bda60612c9238518d493e0b6a735a270a45458. Command: ffmpeg -i after-wide-motion.webm -ss TIME -frames:v 1 OUTPUT.png (no pixel editing). Browser-compositor frame attempts were blank and were rejected.

The final issue uses the fixed requirements/plan/task/PR template. PR Summary and behavior table explain the actual parent-to-final outcome, with genuine visible pairs and honest native/browser limits. Its later parent-ready sentence is bound by the preserved4808b714 correction; old records are historical, not rewritten. Actual GitHub rendered-page inspection alone uses the explicit waiver; no baseline waiver exists.

## Retention and authority

Independent reviewer task 01a1144e-7290-74f6-9f05-1ad82d3e2018 on the verified designated host, separate detached clean source worktree. Execution pins f0919b184 and 97e5583 plus supplied human amendments unchanged. This dedicated evidence ref is nonmerged, owned by this QA task, retained through review/merge and until explicit human archival/removal authorization. Preserve all earlier receipts and exact records.

Coordinator owns readiness/draft transitions and independent receipt/full-feedback pre/post checks. No readiness label, draft, source, product branch, installation, merge or deployment changed. The audio-completion hang remains separate and unresolved; synthetic voice tests do not establish a native fix.
