# ChatGPT plan connection evidence

Captured on 2026-10-04 from this PR's production web build using Chromium at 1180 × 900 and 390 × 900. The connected identity and usage-limit response are mocked; these images do not demonstrate an approved OAuth client or a real ChatGPT-funded request.

| State | Desktop | Phone |
| --- | --- | --- |
| Connected settings and explicit billing switch | [Desktop](settings-1180.png) | [Phone](settings-390.png) |
| Usage limit, retained prompt, disabled voice action | [Desktop](limit-1180.png) | [Phone](limit-390.png) |

Reproduce with `npm run build`, then `npm run test:web -- tests/web/chatgpt.spec.ts`. The tests save originals under ignored `artifacts/screenshots/chatgpt/`.

Validation: `npm run check` passed (210 tests, release metadata, types, and server/web builds); `npm run test:web -- tests/web/chatgpt.spec.ts tests/web/conversation.spec.ts` passed (17 scenarios).

Captured source SHA-256:

- `apps/mobile/src/ui/AiConversation.tsx`: `43bc28f0de1a9d38257abab99fad390afd686964b65f40cb88f2140f67906e9b`
- `apps/mobile/src/ui/ChatGptPanel.tsx`: `dd2916bd7ae85797493d0658f362d93a3fce5ec290ffc736f14f3f1075e6ad26`
- `apps/mobile/src/services/useChatGpt.ts`: `56ede8438d0ded168fc05fc2d7f1b1087681208c4b68a975a72f537038be3c00`

The PR remains disabled by default, pending the hosting and OpenAI onboarding prerequisites in [the setup guide](../../CHATGPT.md).
