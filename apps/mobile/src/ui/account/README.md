# Account entry and management

`AccountScreen` supplies the native safe-area modal and route boundary, with the shared header on forms and management pages. This directory owns its contents: `AccountEntry` handles authentication, `AccountWelcome` presents the illustrated entry screen, `AccountOverview` leads with backup status and links to details, and `AccountManagement` handles one account action per page. The [account service](../../services/README.md#accounts-and-sync) owns authentication, backup scheduling, state derivation, and data retention; UI never infers backup health from message text.

The headerless welcome centers the bundled mountain, decorative word cards, and **Little Say: Learn to Talk!** heading on a warm cream canvas. Register is the primary action and Log in the secondary action, grouped at the bottom with configured native providers and account feedback. The artwork scales to the safe viewport; the entire screen scrolls when small windows or larger text need more room. Decorative art is static and hidden from assistive technology, while the heading receives screen focus. Forms retain their shared route headers and credential lifecycle.

Sign-in is required before setup or saved boards on web, iOS, and Android. Welcome offers email registration/sign-in and the configured device provider (Apple on iOS, Google on Android); browser forms offer both configured social providers. Successful authentication closes entry immediately and returns Home. Empty devices defer setup and board creation until cloud restoration succeeds. Home centers a large spinner and **Syncing your content…** heading in the available page below its header, replacing board headings and creation controls; failure offers **Retry sync** in that same area. Restored boards appear automatically, or setup opens when the cloud library is empty. Cached libraries remain usable during background sync and offline. Home's **Refresh content** navbar button starts a manual sync and replaces its icon with an indeterminate spinner while syncing or saving locally; its fixed footprint keeps the header and board list stationary. It stays disabled while busy or when sign-in, verification, or deletion blocks backup. Explicitly opened account pages stay open and remain dismissible during restoration. Dashboard and setup headers use an accessible account icon.

The signed-in overview shows current backup status, account identity, linked-method summary, and navigation to sign-out and deletion. Healthy backup has no primary action. Verification, connection failures, failed backup, and pending deletion expose their relevant recovery action. Backup details show the last acknowledged sync, included/local-only data, server errors, and conflict-copy information. There is no backup toggle, browser-storage permission section, or redundant Continue button; header Back returns to boards or setup.

Account routes live under `/app/account`:

| Suffix | Screen |
| --- | --- |
| none | Status-first overview when signed in; welcome otherwise |
| `login`, `register`, `reset` | Authentication forms |
| `backup` | Backup details and recovery |
| `sign-in-methods` | Linked and available methods |
| `link-email`, `link-google`, `link-apple` | Fresh identity confirmation and provider linking |
| `verify-email` | Check verification or resend email |
| `sign-out` | Confirm sign-out and retention of downloaded boards |
| `delete` | Explain deletion and require fresh identity proof |

Web routes support direct links, refresh, and Back/Forward. Older `/app/settings/account` links resolve to their account counterparts. Native navigation retains an in-memory page stack; direct links fall back to logical parents, with linking returning to sign-in methods. Signed-out management links show required entry. Page remounts discard credentials; credentials never enter history or persisted UI state. Authentication actions guard in-app Back; background sync allows navigation while blocking overlapping account mutations.

Provider linking requires a currently linked method. Deletion always confirms with Apple when Apple is linked, even if a password is also available. Pending deletion blocks verification and linking, leaving retry and sign-out available. Expo Go explains unavailable social actions at the action that needs them.
