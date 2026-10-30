# Picture catalog and durable jobs

`catalog.ts` searches licensed metadata and downloads trusted artwork. `provider.ts` owns concept analysis, pixel review, and image generation. `jobs.ts` owns picture resolution and the immutable PNG cache. Production/local runtime queues use the shared [job repository](../hosting/README.md); its file-backed queue remains only for isolated fixtures. Routes are registered by `../app.ts`; payload schemas and source selection are in `packages/core/src/pictures.ts`. [Client services](../../../mobile/src/services/README.md#picture-drafts) own revision-safe drafts and offline downloads.

## Catalog and attribution

`npm run pictures:update` regenerates `data/catalog.json` through `scripts/update-picture-catalog.ts`. It pins Mulberry Symbols v3.6.1 at `9cbab9f400c5de44e2bc58839cca07294aadb086` and OpenMoji 17.0.0 at `f9fc506a3f913be9897ab0181d611d4c910a4104`. Mulberry color symbols are by Steve Lee; OpenMoji artwork is by HfG Schwäbisch Gmünd and contributors. Both use [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

Preserve author, original source URL, license, and rasterization/padding notice on each asset and in parent-facing credits. Adapted artwork retains its license; pinned source URLs provide the original vectors. The current app searches color symbols; outline metadata remains readable for older saved pictures.

Only catalog-owned URLs may be downloaded. Redirects and external SVG resources are rejected, sizes are bounded, and output is rasterized to PNG. First use of an uncached symbol outside the bundled seeds needs server access to GitHub. Library selection needs no OpenAI key; saved board PNGs work offline. The seed-generation and reviewed-import contracts live beside their scripts in `scripts/prepare-picture-seeds.ts` and `scripts/import-reviewed-picture-seeds.ts`.

## Protocol

`/api/health` advertises picture protocol 1 and catalog/analysis/generation capabilities. Clients send `pictureCapability: 1` for extended board proposals; older clients retain the original emoji shape.

When AI is configured, health also advertises preparation protocol 1 for combined drafting and aggregate picture work. [`../board-preparation.ts`](../board-preparation.ts) documents batch ownership, private draft retention, generic reuse and cancellation; [`packages/core/src/schema.ts`](../../../../packages/core/src/schema.ts) defines the negotiated proposal contract.

| Endpoint under `/api/pictures` | Responsibility |
| --- | --- |
| `GET /search`, `GET /library/:id` | Search metadata or download a selected licensed symbol |
| `POST /analyze`, `POST /review` | Analyze meanings or review actual board pictures |
| `POST /jobs`, `GET /jobs/:id`, `POST /jobs/:id/cancel` | Start, observe, or cancel durable work |
| `GET /batches/:id`, `POST /batches/:id/cancel` | Observe or cancel aggregate proposal picture work |
| `GET /assets/:digest.png` | Serve immutable verified PNG bytes |

A request UUID is bound to its payload, draft, and card identity; reusing it for changed content fails. Optional phases distinguish `finding` from `generating`. Cancellation removes queued work and attempts to abort active generation, which may already have incurred a charge. Restarted unfinished jobs become interrupted and require an explicit new attempt. Failures never automatically purchase another generation.

## Configuration and retention

`OPENAI_IMAGE_MODEL` defaults to `gpt-image-2.5-flare` with medium-quality, transparent, 1024-square PNG output. `AAC_IMAGE_GENERATION=false` disables new generation independently of catalog/analysis availability. The shared runtime permits two executing jobs globally and two outstanding jobs per account. A prepared board performs picture work sequentially within its claim. Backend keys never reach the client.

Runtime storage uses `MEDIA_DIRECTORY` or `MEDIA_BUCKET` for PNGs and PostgreSQL for private owner-bound descriptions/job state and shared approved generic metadata. [Storage/deletion](../hosting/README.md#storage-and-deletion) defines ownership and cleanup. Personal photos and their paths are excluded from picture requests; explicit account backups are a separate contract. Requests and provider bodies are not logged. AI routes accept automatic guest sessions without registration. Private assets and jobs require their owner; catalog access remains public.

Use [picture evaluation](../../../../tests/README.md#live-ai-and-device-validation) for billable visual checks. Model review and automated tests cannot establish whether a child understands a picture.
