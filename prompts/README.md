# Prompt resources

Application-authored model instructions and starter prompts live here as UTF-8 JSON strings. JSON preserves significant leading/trailing whitespace and newlines independently of checkout line endings. Edit the values, not the loaders; do not trim, reflow or unify wording as part of a refactor.

| Resource | Caller | Substitutions |
| --- | --- | --- |
| `server/board.json` | `apps/server/src/provider.ts`: board instructions, picture addendum, translation | None; the picture addendum starts with a newline |
| `server/pictures.json` | `apps/server/src/pictures/provider.ts`: analysis, selection, generation, review, both style briefs | `visualRules` in selection/review; `look` and JSON-serialized `concept` in generation |
| `server/preparation.json` | Negotiated combined drafting and batch picture selection | `concepts` is the server-owned, reviewed generic vocabulary |
| `server/speech.json` | `apps/server/src/synthesis.ts`: Realtime speech instructions | `language` |
| `shared/onboarding.json` | `packages/core/src/onboarding.ts`: starter concept lists and template | `concepts` |

`packages/core/src/promptResources.ts` checks required text and template fields at initialization. `{{field}}` substitution runs once with a callback, so dollar signs and template-looking text in supplied values remain literal. Request data stays in its existing JSON user message; schemas, models, options, consent, cache versions and UI labels remain with their existing owners.

Shared/mobile code imports only `shared/` through `promptPresets.ts`, with no filesystem access. Server resources enter only through `apps/server/src/prompts.ts`. Static JSON imports work in `tsx` and Expo/Metro; tsup embeds them in the Node ESM output already copied by Docker. No resource reads depend on the runtime working directory or source tree.

Provider tests use mocked transports to verify request data, configured models, structured output, image options, and cancellation without live inference. Resource tests protect literal substitutions and clear failures; the bundle test runs outside the checkout to verify embedded resources and the shared/server import boundary. Review wording changes directly in the JSON diff. Run `npm run check`, the setup/conversation browser tests, and web/iOS/Android exports when changing the loading boundary.
