## Problem

During board play, a card can remain in its playing state after its sound has finished, preventing further use of other cards. This interrupts the child's communication/play session and requires parent intervention.

**Reported workaround:** switching languages unblocks playback; otherwise the user must leave the board and restart.

**Expected:** when playback ends, the playing indicator clears or advances to the latest queued card, and the same or another card can play without resetting the session. This is a human-reported defect; it has not yet been reproduced during investigation.

## Requirements and acceptance

- After genuine sound completion, replay the same card and then a different card successfully; the playing/pending indicators agree with audible playback without language switching or leaving the board.
- Rapid and repeated taps finish the current word and retain only the newest pending card, without overlap, double completion or a permanent busy state.
- Playback/load errors, fallback speech, cancellation and app/page interruption recover to usable controls; late events cannot clear or restart a newer playback.
- Language changes and leaving/reopening a board cancel old work cleanly, including pending speech; new playback uses the current language and session.
- Add focused regressions for the evidenced failure. Eventual UI QA must show genuine matched Before/After screenshots plus functional evidence that sound completion releases interactions, on the affected platform/source. Record actual build/source provenance; distinguish browser, emulator and physical-device results. Suggested checks are pending, not executed.

[Source analysis, hypotheses and detailed investigation plan](https://github.com/MChartier/little-say/issues/28#issuecomment-6019573351).

Direct human request, 2026-10-06 15:18 UTC: "Scope issue following up on little say bug observed where card can get stuck in playing state after sound completed, blocking further interaction with other cards. Switching languages unblocks, but otherwise necessary to leave board and restart."

Investigation and implementation authorized by the subsequent human backlog instruction, recorded in [claim](https://github.com/MChartier/little-say/issues/28#issuecomment-6029221413). Reproduction is pending; release and deployment remain outside scope.

## Implementation plan

Trace the affected playback source through completion, error and cancellation into board state; fix the evidenced lifecycle failure while preserving the current-word-plus-latest-pending sequencing. Check language, navigation and interruption cleanup and stale callbacks. Do not presume an arbitrary timeout workaround or change queue policy.

Reported environment: generated audio on iPad hardware running Expo Go, clarified by the user at 2026-10-07 02:30:56 UTC ([clarification record](https://github.com/MChartier/little-say/issues/28#issuecomment-6029682192)). The iPadOS/Expo Go versions, served app revision, affected clip, frequency and stuck duration remain unknown. Trace iOS completion/status delivery and cleanup during reproduction, including whether the stall persists beyond the existing queue watchdog.

[Pre-created investigation plan](https://github.com/MChartier/little-say/issues/28#issuecomment-6019573351).

[Exact original requirements, plan and history](https://github.com/MChartier/agentic-development-workflow/blob/be7f2a00cbf9ced12d4b1a7a52f28e455695d7e3/issue-template-migration/little-say-28-original.md).

## Implementing Codex task

Verified task ID: `01a111cd-7184-7671-9c7b-1e95a7719032`. Partial implementation checkpoint published; native reproduction/evidence remains blocked. A shareable URL is unavailable.

## Implementing PR

[Draft PR #33 - native audio error recovery](https://github.com/MChartier/little-say/pull/33). Partial checkpoint; original completion hang and matched native UI evidence remain unresolved. This PR does not close the issue.
