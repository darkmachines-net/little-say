# Parent and child interface

This directory owns app screens and shared controls for native and `/app` on web. `App.tsx` composes these flows with the library and service hooks. Platform-suffixed files adapt touch, photos, speech previews, and updates without changing the shared contracts. Use the [client services](../services/README.md) for persistence and network work.

## Visual and interaction conventions

- Use `theme.ts` and the shared [brand palette and assets](../../assets/brand/README.md): evergreen text, forest-green actions, warm cream backgrounds, white parent-control groups, and bright tiles. Use the system sans-serif font, compact bold titles, generous targets, and restrained borders/shadows.
- Keep the mountain decorative in parent headers, loading, and empty states. Keep play focused on the family's cards. Name actions directly, without slogans, decorative eyebrows, achievement systems, or progress metaphors. Explain data use, missing translations, and save failures where they affect a decision.
- `AppHeader` owns the white surface, bottom border, and aligned mountain/name/navigation row for the dashboard, Settings, account, setup, editor, and AI workspace. Below 600 units it uses a 64-unit row and 36-unit mark; larger screens use 76 and 56. Page-specific tools can sit beneath that row; editor tools move there below 800 units. Screens own safe-area insets. `PlayBoard` keeps its separate full-screen controls.
- `Dashboard` puts the latest played board in a spotlight; its preview and **Play again** both start play. Favorites follow without duplicating the spotlight, then other boards, ordered by recent play. Favorites/play history are device metadata, independent of board edits and undo. Board menus own deletion and missing-audio generation.
- `Sheet` and `ModalBackdrop` route outside taps through the same cancellation path as Close/Back. Inside gestures never dismiss. A gesture must start on the backdrop to dismiss, and underlying tiles must not activate.
- Keep controls inside system-bar and cutout insets on every edge. Each native modal owns a separate safe-area provider; backdrops may extend under bars, while headers, scrollable bodies, and fixed actions remain reachable after rotation and with gesture or three-button navigation.
- Preserve accessible labels, visible selected states, large touch targets, reduced-motion behavior, and keyboard focus restoration. Use [browser and device checks](../../../../tests/README.md) to validate both layout and interaction.

## Setup, editing, and play

`FirstTimeSetup` selects languages and optional starter boards. Persist completed drafts for resuming, show generated words, offer manual start when AI is unavailable, and never advance past a failed save or overwrite an existing library.

**New board** and **Edit with AI** open `AiConversation`, a full-page workspace with an independently scrolling canvas/transcript and message controls above the keyboard. Tablets show them side by side; phones stack the canvas above the conversation and size it from the measured space below the header. Clarification preserves the canvas. Browser routes use `#boards/new` and `#boards/<id>/ai`; Back cancels active work and retains save guards, while reload starts a fresh conversation without saving partial output. Suggestions only fill the message field. **Build manually** remains a separate dashboard action.

Prompts use editable text and the system keyboard's dictation. Parents review and send the text; there is no app recording or dictation button. Native plugins disable microphone permissions and web hosting disallows page microphone access. Removing permissions from an already installed native app requires a replacement binary.

`BoardEditor` keeps a compact responsive preview and its AI/add/audio/board actions on one tablet page: beside the preview in landscape, below it in portrait. Small previews may scroll without hiding actions. Tile ordering belongs in `TileEditor`; manual boards support 1–24 cards. Cards follow the user's languages unless explicitly fixed to one language. Generated translations remain editable.

User languages in Settings supply the play choices for all boards, including existing boards; adding a language in Settings never initiates translation. `BoardLanguages` directly toggles a nonempty subset of those languages, with no enabling switch, separate catalog or custom-tag entry. Selecting all resumes inheritance, including future additions. Removed profile languages are ignored in subsets; if none remain, play uses the user default. Saved words and audio remain available if the language is selected again. Legacy `playLanguages` records generation context; `playLanguageSubset` alone restricts play.

Closing the board language panel (Done, Close, backdrop, system Back, or the Settings link) starts [automatic missing-translation preparation](../services/README.md#board-translations). It closes immediately; progress, cancellation and retry appear in the editor, with no separate preparation/review step. Card labels, spoken words and fixed-language behavior belong to the individual card editor. New manual and starter cards follow the board even with only one user language; legacy fixed cards keep their words until individually changed. Audio follows each language's AI/device voice choice and prepares automatically after translated words are saved; downloaded clips remain usable offline. The language panel has no audio controls.

`PlayBoard` prioritizes the grid. Boards open unlocked. The compact header reserves fixed 48-unit slots for Back on the left and the lock icon on the right, with the title and optional language toggle between them. Locking hides Back without collapsing its slot. Status and hold progress sit below the title, outside the lock target, in space reserved in every state. Play and editor use the shared measured, ordered rectangles in core: balanced rows, soft preference for square cards, and 44-unit minimum targets. Play fills the space without scrolling; if it cannot fit, explain the need for more room and recover after resize. Reflow cancels contacts tied to old geometry without restarting speech or reordering cards.

Tile speech feedback is a green outer outline and speaker badge; brief touch feedback is an amber inset outline. Both may appear without changing geometry. The parent hold uses one gesture state and monotonic clock for its one-second threshold and progress. Movement, extra touches, cancellation, backgrounding, or board interaction reset its timer and feedback together. Holding unlocks automatically at one second without leaving the board or showing a dialog; a separate press of Back opens the editor. Android system Back uses the same editor-return action while unlocked and is blocked only while locked. Lock changes do not interrupt speech. Early release cancels. The lock control stays mounted and ignores the completing contact's release/click so only a fresh tap can relock. Preserve the cancellable one-second assistive alternative.

Photos use native picker/cropper or the browser cropper. Later adjustment supports direct drag/pinch and fine zoom, previews the actual square region, and preserves it across views and rotation. Canceling leaves the original intact; duplicates have independent framing. Native adjustments start from the system crop, so recovering cropped-out content requires choosing the original again.

## Picture controls

`PicturePreferences` supplies new-board defaults; `BoardPictures` and `CardPictures` provide deliberate board/card changes. The workspace header keeps **Picture settings** reachable during work; changes apply to the next update. Use one labeled source selector with vertically expanded descriptions and current-value guidance, separate protection switches, and explicit inherited card source. Do not restore wrapping chips, the legacy consistency switch, or a style selector. New artwork uses simple color; existing artwork stays readable.

Automatic keeps accurate, unambiguous emoji, uses the library for gaps, and generates only remaining gaps. Library only and Emoji only never generate. Completed drafts go to save/refinement without illustration upsells. Parents may deliberately choose AI illustrations and **Update draft pictures**, or board **Improve pictures** / **Restyle board**, with preview and explicit apply. Card options include library search, description, overrides, and **Keep this picture**. Credits belong in parent controls.

Show queued, active, ready, and fallback cards distinctly; animate only active work and honor reduced motion. Stream completed downloads into a reviewable draft, support stop/retry, and save only on explicit apply. Retain useful emoji or previous images on failure with one concise fallback summary. Contain illustrations so identifying features remain visible; photos retain their crop treatment. Play never initiates picture work. [Picture draft services](../services/README.md#picture-drafts) define protection, revision checks, and download ownership.

## Settings

`SettingsScreen` is a grouped navigation page with **Preferences** and **Account & help**. `SettingsPage` owns the surrounding page chrome; route parsing and history live in `services/settingsRoute.ts` and `useSettingsRoute.ts`.

| Route under `/app/settings` | Responsibility |
| --- | --- |
| root | Overview and current language/account summaries |
| `/languages` | One to six shared languages; direct search with a result dropdown, divided rows, removal under Edit, and one default selector |
| `/voices`, `/voices/:language` | Profile and board languages; per-language source, device voice, and cancellable preview |
| `/pictures` | New-board picture defaults and credits |
| `/account`, `/account/login`, `/account/register`, `/account/reset` | Account backup, forms, deletion, and browser storage controls |
| `/screen-guidance` | Platform-specific Guided Access/screen-pinning links or browser guidance |
| `/updates` | Installed native update check/download/restart; disabled in development or when updates are unavailable |
| `/privacy` | Storage, backup, AI processing, photos, dictation, and retention disclosures |
| `/about` | Selectable running version, environment, and available native build/update details |

`LanguageProfileEditor` shares the simple-list controls with first-time setup. Search accepts names, regions, and language tags, excludes selected choices, and closes after adding. Web uses a floating result dropdown with Enter, Escape, and keyboard focus dismissal; native expands results inside the parent's touch bounds. Region names replace raw tags where Intl supports them. **Edit** reveals removal controls, retaining one language; removing the default uses the first remaining choice. The single default control uses a browser select on web and a cancellable option sheet on native.

Browser pages support direct links, refresh, history, and offline fallback. Native uses a stack and Android Back. Direct links without app-owned history return to their logical parent. Play keeps its exit protection; Privacy remains available before sign-in/setup. Preferences save individually through durable library commits. Controls/navigation wait for a write; failure preserves the previous value and offers Retry saving. Preference patches preserve boards, playback, and account launch state; there is no overview-level save action.

Native manual updates wait for pending local writes before restart. Leaving the page cancels further actions, though an active download may finish for a later launch. Web retains its service-worker update banner. Settings never edits the service origin. Use OS Guided Access or Android screen pinning for system containment; app controls cannot suppress system navigation.

`AboutSettings` reads local metadata through [`appInfo`](../services/README.md#installed-app-information), so identifying the installed release works offline. Version describes the running bundle; installed version and build number describe the native binary and may differ after an app update. Values are selectable for support requests.
