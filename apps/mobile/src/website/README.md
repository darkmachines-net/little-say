# Public web experience

`Entry.web.tsx` loads the welcome page at `/` and the read-only starter trial at `/app/try` (including its trailing-slash form). The welcome's **Try Little Say on the web** link opens the trial. `/app` and authentication links retain the normal account flow; installed web apps still launch there. Native `Entry.tsx` does not import this module.

Ordinary trial-link clicks navigate within the loaded page, and Back/Forward restores the public route without restarting JavaScript. The link retains its real URL for modified clicks and new tabs. Hover or keyboard focus preloads the trial module without mounting services. A full-screen indeterminate spinner stays centered while either the trial or account app code loads, with an accessible loading label and no visible loading text. The starter catalog itself is synchronous bundled data; development builds may spend additional time compiling the lazy module on first access.

`TryBoards.web.tsx` uses the shared [starter catalog](../../../../packages/core/README.md) and the app's `BoardCard` and `PlayBoard` controls. Guests can play all three boards, tap or swipe cards, lock the player, and return to the list. English browser speech supplies audio; unavailable speech uses the player's normal error message. The trial does not start account, sync, translation, or AI-generation services, and it does not read or write saved libraries, preferences, or media. Its board selection is discarded on reload.

New board, Edit, Favorite, and More open the same dismissible account prompt before any mutation controls appear. **Create a free account** opens `/app/account/register`; **Sign in** opens `/app/account/login`. Dismissing the prompt leaves the trial unchanged. Guest state is never copied into an account.

`landing.css` belongs only to the welcome page. Reuse the [shared UI conventions](../ui/README.md) for the trial. Browser coverage in `tests/web/trial.spec.ts` checks speech, gates, navigation, responsive layout, and absence of service/storage side effects; `landing.spec.ts` owns welcome and installed-app routing.
