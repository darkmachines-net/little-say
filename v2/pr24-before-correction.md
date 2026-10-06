## Summary

Families currently keep boards and saved media only on each device, so reinstalling or moving to another device can lose their library. This adds optional Firebase sign-in and consent-based backup to the selected server, while preserving guest use, offline playback, and local boards after sign-out.

Backups validate media with SHA-256, retain conflicting edits, enforce per-account quotas, and retry interrupted deletion. Browser sessions use HttpOnly cookies; native credentials use SecureStore. A new accounts migration follows the existing foundation and grant migrations without replacing them.

Issue: #19. Depends on #20; review and merge that parent first. Ultimate target: master. Original #11 remains preserved.

## Test plan and behavior evidence

| Scenario | Expected and observed result | Evidence |
| --- | --- | --- |
| Register, verify email, then sign in on a fresh browser | Backup waits for verification; photos, pictures and saved speech restore byte-for-byte | Three real-browser account scenarios passed in [disposable CI](https://github.com/MChartier/little-say/actions/runs/37415135338). |
| Edit offline on two devices, reconnect, then sign out | Both edits survive as conflict copies; local boards remain usable offline | The same browser suite passed, including account/server-switch isolation and guest setup without account requests. |
| Upgrade populated grant tables; upload corrupt media; race revisions/quotas; interrupt deletion | Preserve grants, reject unsafe/incomplete writes, and retain durable deletion work | 40 PostgreSQL17/Auth-emulator integration tests and 235 unit tests passed. Provider linking uses synthetic emulator identities. |

### Before / After UI evidence

The same fresh guest setup gains an optional restoration entry; Parent settings gains account choices while retaining the grant controls. Captured baseline: corrected parent `344aded`; captured/current head: `74b721d`. Identical 1180×900 viewport, fresh storage, UTC clock, locale, scale and theme; no UI hiding or image alterations. These pairs demonstrate account entry, not provider authentication or restore completion.

| Before: setup | After: setup |
| --- | --- |
| ![Before: guest setup](https://github.com/MChartier/little-say/blob/792b93c433c0be238224140ebd509302eeab7986/before-setup.png?raw=true) | ![After: optional restoration entry](https://github.com/MChartier/little-say/blob/792b93c433c0be238224140ebd509302eeab7986/after-setup.png?raw=true) |

| Before: Parent settings | After: Parent settings |
| --- | --- |
| ![Before: existing settings](https://github.com/MChartier/little-say/blob/792b93c433c0be238224140ebd509302eeab7986/before-settings.png?raw=true) | ![After: optional account choices](https://github.com/MChartier/little-say/blob/792b93c433c0be238224140ebd509302eeab7986/after-settings.png?raw=true) |

[Immutable provenance, full source/build identities, capture harness, and complete published scope](https://github.com/MChartier/little-say/blob/792b93c433c0be238224140ebd509302eeab7986/README.md). Loaded application bundles were asserted nonempty and matched each isolated build. Original image pixels and remote bytes were inspected; rendered private-PR inspection remains unverified because the browser tool failed to start.

## Supporting checks and limitations

CI also passed release consistency, types and server/web builds. Local checks passed 32 guest/offline/grant browser scenarios and an Android JavaScript export; export is not native-device execution. PostgreSQL evidence is from CI because the local Docker engine is unavailable.

Real Google/Apple consent, hardware SecureStore persistence, and Apple revocation remain unverified. No provider activation, provisioning, migration rollout, deployment, or installation is included. This remains a draft: rendered evidence and independent QA—including whether additional recovery-state captures are required—are pending; only the coordinator can award readiness.
