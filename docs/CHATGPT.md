# Visitor ChatGPT plan usage

Little Say can offer **Continue with ChatGPT** under **Parent settings → AI requests** on its website. This connection is independent of local board storage and does not upload the saved library. A connected visitor's board drafts and translations use their own OAuth access token; the server's API key remains the default for visitors who have not selected ChatGPT.

## Availability and activation

Rollout is on hold until Little Say has its intended managed hosting, an approved OpenAI client with plan-usage permission, and a successful live OAuth/inference test. Managed hosting is the project’s deployment prerequisite; the linked OpenAI documentation requires an approved client, registered HTTPS callback, and suitable backend without prescribing a managed hosting vendor. Keep `CHATGPT_ENABLED=false` until those conditions are met.

This integration is prepared for an **approved, registered hosted OpenAI client**. It is disabled by default. OpenAI's [website sign-in guide](https://developers.openai.com/siwc/website) describes client provisioning, while the [plan-usage overview](https://developers.openai.com/siwc/token-sharing-open-source) directs remotely hosted apps to the interest form. An identity-only sign-in registration does not authorize inference. Confirm the hosted client's approval for `resource.invoke` and `chatgpt.tokens.use.direct` with OpenAI before enabling this feature. The open-source dynamic registration and loopback callback must not be substituted for hosted approval.

Set these values in server secrets, never `EXPO_PUBLIC_*` variables:

| Variable | Purpose |
| --- | --- |
| `CHATGPT_ENABLED=true` | Explicitly enables the registered hosted flow |
| `CHATGPT_CLIENT_ID` | Approved `oaiapp_…` client |
| `CHATGPT_CLIENT_SECRET` | Only for a confidential client provisioned with `client_secret_basic`; leave empty for a registered public client |
| `CHATGPT_REDIRECT_URI` | Exact registered `https://your-host/api/chatgpt/callback` |
| `CHATGPT_ENCRYPTION_KEY` | Independent random 32-byte key, encoded as 64 hexadecimal characters |
| `CHATGPT_DB_PATH` | Encrypted session database; Compose uses `/app/data/chatgpt/sessions.sqlite` |

Generate the encryption key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and place its output directly in your secret manager. Back up this key separately from the database. Losing or changing it invalidates access to stored sessions. Run one Little Say server process per ChatGPT database; token refresh is serialized within that process. Multi-replica deployments require distributed renewal coordination before using this implementation.

The site, API, and callback must share one origin, listed in `ALLOWED_ORIGINS`. HTTPS is required in production. Register a separate loopback HTTP callback for non-production integration testing if OpenAI permits it for your hosted client. Expo's remote proxy cannot act as the production callback. Native apps continue to use server AI and do not share browser sessions.

## Visitor behavior and billing

- Connection opens OpenAI sign-in and returns to Parent settings. Save any changed settings before leaving. OAuth tokens never enter browser JavaScript or board backups.
- The first successful connection explains plan usage. The composer shows **Using ChatGPT plan** and links to [Manage usage](https://chatgpt.com/settings/usage).
- Eligible text requests use the account's model catalog, preferring `OPENAI_BOARD_MODEL` only when listed, otherwise choosing its first visible model. An unavailable model or failed request produces an error, with no API-key fallback.
- Missing plan consent, expired credentials, revocation, unavailable service, and usage limits stop ChatGPT requests. Reconnect or explicitly choose **Disconnect ChatGPT & use server AI** to change billing. A non-secret per-origin browser preference preserves that choice if cookies disappear.
- [Current preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) exclude transcription, speech, and image generation. While ChatGPT is selected, the server rejects voice prompts, new AI audio, and automatic picture work before calling an API-key provider. Existing audio, device speech, emoji, photos, and manual symbol-library selection remain available. Already-running work cannot be retroactively cancelled by switching providers.
- Disconnect deletes the local server session and attempts renewable-session revocation. If remote revocation cannot be confirmed, the app directs the visitor to disconnect Little Say in ChatGPT settings. No other visitor or saved local board is affected.

## Security and validation

The server uses discovery, Authorization Code + S256 PKCE, independent browser-cookie/state binding, ten-minute one-use transactions, nonce validation, and signed JWT issuer/audience/expiry checks. SQLite contains only hashed session identifiers and AES-256-GCM encrypted credentials and transactions. Browser cookies are HttpOnly, SameSite=Lax and Secure in production. Connection routes use `no-store`; callback redirects do not contain codes or tokens. Keep reverse-proxy access logs from recording the callback query string, which contains a short-lived authorization code.

Only `chatgpt.tokens.use.direct` grants enable inference; identity consent alone is retained with plan usage disabled. Responses use array input, `instructions`, `store: false`, and `stream: true`; a successful terminal `response.completed` is required before accepting structured output. Partial responses and streamed usage errors never become board drafts.

Automated tests mock OpenAI, verify real JWT signatures against a test JWKS, and cover transaction replay/expiry, browser isolation, encrypted restart, rotation, missing consent, unsupported operations, and billing fallback refusal. Browser tests cover available/unavailable options, connected settings, first-use confirmation, composer state, limits, and explicit disconnection. They do not establish production client approval, account eligibility, or a real ChatGPT-funded inference. Those require the configured client and a consenting test account before rollout.
