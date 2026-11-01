# Account entry and management

`AccountScreen` supplies the shared header, native safe-area modal, and route boundary. This directory owns its contents: `AccountEntry` handles authentication, `AccountOverview` leads with backup status and links to details, and `AccountManagement` handles one account action per page. The [account service](../../services/README.md#accounts-and-sync) owns authentication, backup scheduling, state derivation, and data retention; UI never infers backup health from message text.

Sign-in is required before setup or saved boards on web, iOS, and Android. Welcome offers email registration/sign-in and the configured device provider (Apple on iOS, Google on Android); browser forms offer both configured social providers. Empty devices cannot leave account navigation until cloud restoration succeeds. Cached libraries remain usable offline after session restoration. Dashboard and setup headers use an accessible account icon.

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
