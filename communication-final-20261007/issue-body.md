## Problem

Parents must confirm “Leave this board?” after an intentional unlock before reaching editing. Replace that interruption with a direct transition into the existing storyboard editor, so they can adjust the current board and return to the child's play session quickly.

Direct human request: a two-second intentional hold, a smooth shrink into the editor preview, existing controls immediately available, and a clear return to play. Source inspection found current master already uses **2,000 ms**; preserve that timing rather than claim a three-to-two-second code change.

## Requirements and acceptance

- A continuous two-second hold followed by release opens the **same board's existing editor once**, with no leave confirmation or dashboard detour. Short/repeated taps do not unlock. Early release, leaving the control, excessive movement, another contact, cancellation, blur/backgrounding or rotation invalidate the attempt; a fresh hold is required.
- The storyboard visibly shrinks into its measured preview area as existing controls appear: individual cards, Edit with AI, Languages, pictures/audio and other current board actions. Use a side preview when space permits; stack preview and reachable controls on narrow/short screens. Preserve readable content and touch targets through resize/rotation.
- Keyboard and assistive-technology users have a deliberate, explained unlock path; ordinary click/activation cannot bypass the parent gate. Focus moves to the editor without opening the keyboard or activating a card. Reduced motion reaches the same usable state without a scaling animation.
- A clear **Return to play** action restores the same board with accepted edits, selected play language and settings; no navigation confirmation or dashboard detour. Existing missing-voice safeguards remain. Play resumes idle, with no automatic speech, stale highlight or pending utterance.
- Switching modes preserves board/card IDs, order, media, undo and in-memory edits. Pending/failed saves retain data and a usable retry path. Card/AI drafts keep their existing explicit save/cancel rules; mode switching must not silently discard or apply them. Entering edit does not grant AI consent, initiate new AI work or weaken revision/security guards.

## Implementation plan

1. Reuse `BoardEditor` and its existing handlers. Add a small App-level play/edit transition state; select the active board explicitly before leaving play, including dashboard-started and reload-resumed sessions.
2. Keep the shared two-second gesture clock, tighten interruption/bounds handling, and replace dialog callbacks with one guarded edit transition. Remove the activation shortcuts that currently rely on the confirmation dialog; update unlock help text.
3. Stop playback and clear contacts/highlights before handoff. Animate an inert board presentation between measured play/preview bounds using existing animation facilities; mount controls immediately. Settle safely on resize, interruption or reduced motion, with one interactive/accessibility tree.
4. Reuse serialized persistence, editor save/AI routes and the play preparation path. Keep edits visible on write failure; return only after required writes succeed, then restore play focus and input.
5. Validate threshold/cancellation and input paths, dashboard/reload entry, edit/AI/save-failure/return, active/pending audio, and portrait/landscape/reduced-motion behavior with synthetic boards. These are prospective checks, not executed results.

Coordinate shared `gridLayout`, `PlayBoard` and `BoardEditor` geometry with the separate balanced-grid plan; row balancing is excluded here. Prefer its settled geometry first, then this transition against that base or a coordinator-pinned parent. Account PR #29 shares `App.tsx`; playback defect #28 remains separate. No editor rebuild or new package is planned.

[Source findings and detailed transition design](https://github.com/MChartier/little-say/issues/30#issuecomment-6029143002).

## Implementing Codex task

Implementation owner: verified task ID `01a11406-66b3-71fb-a4cc-2aad6d51802c`, continued from the original planner under the [coordinator dispatch](https://github.com/MChartier/little-say/issues/30#issuecomment-6029841739). Source checkpoint: `7e8ab5993503419e5945c8f304ffab3a6fc91f56`. Related grid task: `01a11405-db71-76ed-9ec6-44717ef3402a`; parent PR #34 is pinned at `b21d3ba7370c08468b868385ce9df3d875eee799`. No verified shareable task URL was issued.

## Implementing PR

[Draft PR #36 — Open the existing board editor directly from the parent hold](https://github.com/MChartier/little-say/pull/36). Review PR #34 first; native closing association to this issue is recorded. [Retained source/build/fixture evidence and validation](https://github.com/MChartier/little-say/blob/e4eb01aa9a31ad4c288c9268af9cd6ee4dd4d59a/README.md). No readiness, merge or release is claimed.