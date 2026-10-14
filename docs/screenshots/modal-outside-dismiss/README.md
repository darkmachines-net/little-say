# Outside-tap dismissal evidence

Captured on October 4, 2026 in Chromium against the production web build using synthetic starter boards and stubbed speech. Each pair shows the same implementation with a dialog open, then immediately after tapping outside it. These are interaction-state comparisons, not screenshots of an older implementation. Finite fade animations are completed before capture.

| Flow | Viewport | Dialog open | After outside tap |
| --- | --- | --- | --- |
| Leave play mode | 390 × 700 | [Confirmation](leave-dialog-390.png) | [Still playing](still-playing-390.png) |
| Leave play mode | 1180 × 900 | [Confirmation](leave-dialog-1180.png) | [Still playing](still-playing-1180.png) |
| Edit tile | 390 × 700 | [Unsaved tile edit](tile-dialog-390.png) | [Editor with original tile](tile-dismissed-390.png) |
| Edit tile | 1180 × 900 | [Unsaved tile edit](tile-dialog-1180.png) | [Editor with original tile](tile-dismissed-1180.png) |
| Edit board with AI | 390 × 700 | [Unsent message](ai-dialog-390.png) | [Unchanged board](ai-dismissed-390.png) |
| Edit board with AI | 1180 × 900 | [Unsent message](ai-dialog-1180.png) | [Unchanged board](ai-dismissed-1180.png) |

The screenshot scenarios also assert that tapping inside a dialog keeps it open, repeated outside dismissal preserves play mode, no tile underneath the scrim speaks, explicit confirmation still leaves play mode, and canceled tile edits/deletions preserve the original board. The historical conversation suite also verified microphone cleanup; app recording has since been removed in favor of text entry and system keyboard dictation.

To regenerate the captures after building the app:

```sh
npm run build
npm run test:web -- tests/web/app.spec.ts --grep "outside modal dismissal"
```

Images are generated under `artifacts/screenshots/modal-outside-dismiss/`; the reviewed copies are retained here. The app and conversation browser suites passed all 34 checks. Browser evidence does not establish physical Android/iPad touch behavior or system keyboard dictation; those remain device-validation follow-ups.
