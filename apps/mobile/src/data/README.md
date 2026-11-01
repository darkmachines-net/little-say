# Local library and media

`useLibrary` owns the in-memory library and one serialized write queue. Storage adapters validate through core's `migrateLibrary`; corrupt or unreadable data produces a retryable load error rather than an empty replacement library.

| Operation | Visibility and failure contract |
| --- | --- |
| `change(update)` / `mergeSync(update)` | Apply immediately, then queue that snapshot for storage. A failed save leaves the visible edits available for retry. |
| `commit(update)` / `commitSetup(update)` | Evaluate the updater when its queued turn begins and publish only after storage succeeds. Use for setup, settings, and reviewed AI results; callers must block conflicting foreground edits during the write. |
| `retry()` | Queue the latest visible state again. Earlier failures do not poison the queue. |
| `flush()` | Await the currently queued tail, rejecting if that write fails. Call before navigation that requires durable edits; it does not prevent new writes. |

Only the newest queued write changes the visible saving/error status. Board revisions belong to core and callers, not the storage queue. Account snapshots use the optimistic path so edits arriving while a sync write is pending remain newer in memory. The [client services](../services/README.md#accounts-and-sync) own network synchronization and asset verification.

`storage.ts` uses SQLite for the native library and speech index, plus document files for JPEG photos, PNG pictures, and WAV clips. `storage.web.ts` uses IndexedDB and caches blob URLs for playback/rendering; pruning or replacing an asset revokes its old URL. Media must be saved before publishing a board reference.

Pruning runs only when the library loads, before transient drafts and undo history exist. Retained assets include saved boards, starter drafts, and both current and legacy saved creation drafts. Do not prune during editing without also retaining transient and undo references. Creation drafts remain device-local and are excluded from account snapshots. Deleting browser storage or uninstalling without a complete backup loses local data.
