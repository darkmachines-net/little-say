# Optional account and sync evidence

Captured October 4, 2026 from the production web build at application commit [`45a87f3`](https://github.com/MChartier/little-say/commit/45a87f3d6a5b114aeccf171a90458a630f54591e). The subsequent evidence commit adds only these screenshots and this index; application code is unchanged. Phone viewport: 390 × 844. Tablet viewport: 1180 × 900. All four captures were visually inspected after modal animations settled.

| State | Phone | Tablet |
| --- | --- | --- |
| Account remains optional | [Account choices](optional-phone.png) | — |
| Create an account and enable uploads | — | [Account form and consent](create-tablet.png) |
| Restored and synced on another device | [Restored account](restored-phone.png) | [Restored account](restored-tablet.png) |

These are real UI captures using an isolated local account API and two fresh Chromium contexts. The account, board words, and media are synthetic test fixtures. The first two card pictures are deliberately minimal one-pixel PNG fixtures for byte-level restore verification, not missing downloads. No personal photos, production account, password, session token, or recovery code is shown. AI requests are disabled.

The account scenario creates an optional account, acknowledges its recovery code, uploads a local board with photo framing and generated-picture metadata, and restores it in the second browser. It verifies identical photo, illustration and speech bytes, preserved device consent, concurrent offline edits retained as conflict copies, and local boards surviving sign-out and offline reload. The companion scenario confirms that completing setup without an account makes no account API request.

## Reproduce

```sh
npm ci
npm run check
npm run test:web -- tests/web/accounts.spec.ts
```

The test writes images to `artifacts/screenshots/accounts/`; review them before copying into this directory. The retained capture used port 4196 and an isolated test output directory to avoid interfering with another workspace. The committed test's default port is 4175; behavior and assertions are the same.

Native SecureStore, signed installation, physical-device playback and recovery after a real Android/iOS reinstall remain release checks. Browser evidence does not establish those results. Server deployment was not performed.
