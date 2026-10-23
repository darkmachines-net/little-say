# Fast board preparation validation

Validation performed locally on Windows with headless Chromium and live OpenAI requests on 2026-10-22. The feature remains disabled by default through `AAC_FAST_BOARD_PREPARATION=false`. This is measured development evidence, not a production or physical-device latency guarantee.

## Scope and reproducibility

The benchmark drives the production web application from Send through six displayed, decoded pictures and an enabled save action. Every context starts with fresh browser storage. Cold requests each receive a separate empty server reuse cache; shipped assets remain available, as they would on a fresh deployment. Warm requests follow five fixture warmup attempts. Concurrent requests use four browser sessions and a shared server that starts with an empty reuse cache. Warmups, incomplete pictures, HTTP failures and timeouts remain in the raw report.

Fixtures cover farm animals, food, household objects, routines and construction vehicles, twenty requests per family in each 100-request population. New image generation is disabled in these populations to demonstrate that common requests resolve without buying artwork. Sources comprise 29 licensed, rasterized Mulberry symbols and five validated medium-quality construction illustrations from this task's isolated evaluation. The latter retain generated provenance and are excluded by library-only policy.

The harness records source hashes and the web entrypoint hash in `manifest.json`, copies the web build into its run directory, and writes `results.json`, `summary.json`, and fixture screenshots beneath ignored `artifacts/board-preparation/`. Model metrics include reported token usage; a cancelled request without a provider response has unknown token usage. Asset-download time is the sum of concurrent resource durations, not additional sequential latency. Application readiness is measured separately from draft response time. No personal prompts or account backups are used.

```powershell
npm run build
npm run eval:boards -- --samples 100 --conditions cold --timeout 20000
npm run eval:boards -- --samples 100 --conditions warm,concurrent --timeout 20000
npm run eval:ai -- --prepared
```

The benchmark exits unsuccessfully if any measured request fails or the p95 reaches ten seconds. It never retries a paid request automatically. Earlier exploratory populations are retained in artifacts but are not substitutes for the final populations. One earlier browser setup collided with a web rebuild; the harness now serves its own immutable copy.

## Measured common-board results

The final full population is [run 1792729730044-a48000ea](../artifacts/board-preparation/1792729730044-a48000ea/summary.json). Readiness requires all six actual images to be mounted, loaded and decoded, in addition to suitable-picture states and an enabled save action.

| Cache condition | Suitable and under 10s | Picture readiness p50 | Picture readiness p95 | Draft response p95 | Complete-template hits |
| --- | ---: | ---: | ---: | ---: | ---: |
| Empty reuse cache | 100/100 | 4.278s | **4.661s** | 4.625s | 0/100 |
| Populated reuse cache | 100/100 | 0.084s | **0.099s** | 0.060s | 100/100 |
| Four concurrent users, initially empty shared cache | 100/100 | 0.097s | **4.210s** | 4.167s | 94/100 |

All five warmups also completed successfully. The measured populations required **zero new image-generation calls**. Cold requests made 100 drafting calls; measured warm requests made none, with five calls during warmup; the concurrent population made six drafting calls. The six initial concurrent misses explain why its p95 is much higher than its median. No matching or final-review calls were needed for these trusted pictures.

Reported input/output tokens were 196,180/56,064 for cold requests, 10,319/2,804 for warmup, and 11,777/3,391 for concurrent requests. The p95 sum of concurrent asset-download durations was 37ms, 22ms and 46ms respectively. These localhost download figures must not be treated as WAN performance.

An earlier complete cold population, [run 1792729184746-330f49a1](../artifacts/board-preparation/1792729184746-330f49a1/summary.json), had **96/100 successes and a 5.051s p95**, including four requests without a valid draft. The investigation below narrows the failure boundary and fixes misleading benchmark reporting; the later passing run does not establish that request reliability is fixed. Those failures remain in the raw evidence. Human quality review and deployment reliability checks remain rollout gates.

The full population's manifest identifies its exact sources. A final semantic guard subsequently excluded ambiguous English concept descriptions `chat`, `pain` and `pan` from foreign-language alias shortcuts and required the correct language when admitting those template labels. Its focused 15-test server suite, server type check/build and a five-fixture browser rerun all passed; [that final smoke run](../artifacts/board-preparation/1792730375940-5119fd2b/summary.json) completed 5/5 with a 4.360s maximum. This guard does not alter the canonical fixture meanings used by the 300-request population.

## Investigation of the four earlier drafting failures

On 2026-10-23, the retained results, private batch state and provider metrics from `1792729184746-330f49a1` were correlated by cold-cache directory (one request per directory). Sample numbers below are one-based.

| Sample / fixture | Observed response time | Durable state | What the evidence establishes |
| --- | ---: | --- | --- |
| 11 / farm | No response by 20.040s | Cancelled, no envelope or tiles | The benchmark cancelled an unfinished draft. This is not evidence of the provider's 45-second timeout firing. |
| 40 / construction | 10.302s | Error, no envelope or tiles | The server returned before the benchmark deadline; no validated draft was produced. |
| 47 / food | 7.059s | Error, no envelope or tiles | Same pre-draft failure boundary. |
| 82 / food | 6.759s | Error, no envelope or tiles | Same pre-draft failure boundary. |

There are exactly 96 provider-completion metrics, 96 validated-draft metrics and 576 seed hits (six for each successful request). None of the failed attempts reached a validated draft or picture preparation. This rules out downstream meaning checks, picture reuse, generation scheduling and asset downloads as the cause of these four failures. The three error responses are consistent with the route's generic 502 catch, but the old harness did not retain HTTP status.

The old provider emitted metrics only after `responses.parse()` succeeded. Transport errors, malformed JSON and structured-output schema failures were therefore indistinguishable, and the API intentionally hid exception details. Earlier local setup/lookup errors were also not logged. No original provider request IDs, HTTP error codes or exception classes survive. **A transient-provider-only explanation cannot be proved retrospectively. No reproducible defect in the new drafting/picture pipeline has been established.** A later successful population alone is not proof that the failure cause was fixed.

One definite bug was in the benchmark: after an error response it continued waiting for six pictures until 20 seconds, labeling early HTTP errors as picture-readiness timeouts. The harness now stops on HTTP failure, records status, UUID request ID, timestamped server namespace/source and failed screenshots. Provider diagnostics distinguish request transport, response status/refusal, JSON parsing, schema validation and normalization; preparation diagnostics distinguish lookup, drafting, validation, pictures, speech and persistence. Only bounded categories, optional HTTP status/provider request ID, timing and available token usage are retained. No prompts, model output, exception messages, headers or validation values are logged. Missing token usage remains unknown. Paid retries remain disabled.

Regression coverage uses the actual SDK transport boundary with injected HTTP 503/429, malformed JSON/schema, incomplete output and refusal responses, plus cancellation, connection/timeout classification, and downstream validation failure. It verifies one request per attempt, no replay of a failed preparation ID, and no private content in diagnostics. Response creation and local validation are separated solely to observe the failure stage; the same strict schema, prompt, model settings and semantic validation remain in force.

The instrumented follow-up, [run 1792776635795-ed6c1807](../artifacts/board-preparation/1792776635795-ed6c1807/summary.json), completed **100/100 cold-cache requests**, twenty per fixture, all HTTP 200 with suitable pictures decoded in under ten seconds. Readiness p50 was **4.965s** and p95 **5.877s**; all 100 provider events were successful, with 196,180 input and 56,076 output tokens. It made zero new image-generation calls and reproduced no transport, JSON/schema or preparation failures. Some local validation work ran concurrently, so this is a separate development population, not a controlled model-latency comparison. It supports continued evaluation with diagnostics, not a retrospective claim that the four earlier failures were provider outages.

## Fresh generation and larger boards

Before construction seeds were bundled, a complete six-vehicle board took **19.444 seconds with low quality** and **20.803 seconds with medium quality**, one fresh sample of each. Each used one library picture and five concurrent generated pictures. The generated assets were checked once by the lightweight matcher, and both complete boards were visually inspected in this task. These are individual observations, not generation p95 estimates. Medium remains the default; this evidence does not justify changing quality automatically.

The low/medium captures are in runs `1792728352379-394b002a` and `1792728487889-ed48de12`. Future generation comparisons must use `--generate --unseeded` to bypass the bundled generated pictures. Their construction drawings distinguish the mixer drum, excavator arm/bucket, bulldozer blade, crane boom/hook and road-roller drum.

The combined drafting semantic evaluation passed all twelve fixtures and their follow-up checks, including explicit counts, language profiles, French/Spanish translations, German overrides, mixed English/Russian speech and retained source tiles. Median fixture response time was 3.881 seconds. The separate 24-tile draft took about 11.5 seconds and is outside the six-tile target; its full picture readiness was not benchmarked.

## Functional validation and rollout

The implementation's original full unit suite passed 545 tests in 60 files. The investigation added diagnostic coverage; the final suite contains 556 tests in 61 files, including the semantic ambiguity guard. Type checks, the release consistency check and production server/web builds pass. All 30 affected browser scenarios passed, including the new legacy/prepared screenshot comparison after correcting its status-text selector. Coverage includes generic reuse, sense distinctions, additional constraints, source policies, private-draft retention, explicit regeneration, shared cancellation, fair bounded scheduling, restart recovery, corrupt assets, cached speech, capability negotiation and saving without late mutation. Screenshot comparison captures use the same 1180×900 viewport and two-card fixture, with legacy and prepared protocols on the same source; they do not represent a historical build timing comparison.

The combined [picture contact sheet](../artifacts/picture-seeds/contact-sheet.png) contains all 34 shipped assets. Library provenance remains in the catalog; generated provenance and validation version remain with the seed data. Agent visual inspection has been performed; human acceptance is still required. Inspect action clarity, speech/label meaning, distinctions between similar vehicles and multilingual use before enabling the capability. Real-device, WAN and sustained deployment-load checks remain outside this local run.

Enable the capability only after the measured latency and human quality gates are accepted. Disabling it restores the legacy proposal path. Keep `OPENAI_IMAGE_QUALITY=medium` unless a broader human-reviewed comparison supports low quality. Shared-cache admission is deliberately limited to the reviewed generic vocabulary; other concepts still work but do not enter cross-user reuse automatically.
