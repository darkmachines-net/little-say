# Shared board behavior

This private workspace package contains platform-independent schemas and pure board operations. Import through `@little-say/core`; keep React, storage, network calls, and provider SDKs in their owning app modules.

`schema.ts` defines persisted libraries and request/response boundaries. `migrateLibrary` reads older device data without inventing boards or resetting failures. A playable board has 1–24 uniquely identified cards; empty creation drafts use a separate schema and remain outside account snapshots. Device usage and account acknowledgments live on the library, outside board revisions.

Use `reviseBoard` for manual changes and `applyProposal` for revision-bound AI output. `boardWorkspace.ts` merges suggestions against their original snapshot so newer direct edits survive; unresolved conflicts require the caller to obtain a choice before committing. Photo IDs and local paths never enter `boardContext`.

The user language profile and optional board subset determine available play languages. Historical generated languages do not restrict that selection. `boardLanguages.ts` prepares only missing or stale generated translations; manual and unknown-origin words stay protected for review. A translation's source signature ties it to the original label, speech, and language. Playback falls back to the original words when a requested translation is missing or stale.

`interaction.ts` owns bounded speech queuing and gesture state; `boardLayout.ts` computes grid geometry. Platform adapters provide playback and measurements. `pictures.ts` owns picture schemas and source selection, while server/client services own generation, downloads, and persistence. Maintained model text belongs to [prompt resources](../../prompts/README.md).

Tests beside each module exercise these data and state contracts. Use [browser and service suites](../../tests/README.md) to verify platform wiring, durable storage, and user flows.
