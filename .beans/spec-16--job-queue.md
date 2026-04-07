---
# spec-16
title: "Job queue: runner and handlers"
status: completed
type: task
priority: critical
parent: spec-E4
depends_on: spec-04
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Purpose

The job queue provides a SQLite-backed polling runner that claims, executes, and finalizes asynchronous work items. Seven specialized handlers implement the actual job logic, composing lower-level services. The runner emits events via a listener-set pattern so SSE endpoints can stream real-time updates. Jobs support parent-child relationships, priority ordering, and a configurable poll interval. Failed jobs stay failed — there is no automatic backoff or requeue. Retries are explicit (manual via API/CLI or via `wishlist_run`).

## Public Interface

### Types

```ts
export type JobHandler = (job: schema.Job, config: Config) => Promise<void>;

export type JobEventListener = (event: {
  jobId: string;
  type: string;
  status: string;
  payload?: unknown;
}) => void;
```

### Runner functions

```ts
// Claim the next queued job atomically (internal, not exported)
function claimNextJob(db: ReturnType<typeof getDb>): schema.Job | undefined

// Mark a job as done with an optional result
export function completeJob(jobId: string, result?: unknown): void

// Mark a job as failed — no automatic requeue
export function failJob(jobId: string, error: string): void

// Create a new job
export function createJob(input: Omit<schema.NewJob, "id" | "createdAt">): schema.Job

// Start the polling loop
export function startJobRunner(config: Config): void

// Stop the polling loop
export function stopJobRunner(): void

// Subscribe to job events; returns unsubscribe function
export function onJobEvent(listener: JobEventListener): () => void
```

### Handler registry

```ts
const handlers: Record<string, JobHandler> = {
  spotify_sync: handleSpotifySync,
  lexicon_match: handleLexiconMatch,
  search: handleSearch,
  download: handleDownload,
  validate: handleValidate,
  lexicon_tag: handleLexiconTag,
  wishlist_run: handleWishlistRun,
};
```

## Dependencies

### Runner (`src/jobs/runner.ts`)

| Import | Source |
|---|---|
| `eq`, `and`, `lte`, `sql`, `desc`, `asc` | `drizzle-orm` |
| `Config` | `../config.js` |
| `getDb` | `../db/client.js` |
| `jobs`, `Job`, `NewJob` (via `* as schema`) | `../db/schema.js` |
| `createLogger` | `../utils/logger.js` |
| All 7 handlers | `./handlers/*.js` |

### Handler dependencies

| Handler | Key imports |
|---|---|
| `spotify-sync` | `SpotifyService`, `completeJob`, `createJob`, schema, drizzle-orm |
| `lexicon-match` | `SyncPipeline`, `completeJob`, `createJob` |
| `search` | `DownloadPipeline`, `generateSearchQueries`, `completeJob`, `failJob`, `createJob` |
| `download` | `DownloadPipeline`, `completeJob`, `createJob`, schema, drizzle-orm |
| `validate` | `DownloadPipeline`, `completeJob` |
| `lexicon-tag` | `SyncPipeline`, `completeJob`, schema, drizzle-orm |
| `wishlist-run` | `completeJob`, `createJob`, `createLogger`, schema, drizzle-orm |

## Behavior

### Job claiming (atomic)

`claimNextJob(db)`:

1. SELECT the first job where `status = "queued"` AND (`runAfter IS NULL` OR `runAfter <= now`), ordered by `priority DESC, createdAt ASC`. LIMIT 1.
2. Atomically UPDATE the candidate: set `status = "running"`, `startedAt = Date.now()`, with a WHERE clause that re-checks `status = "queued"` to prevent double-processing.
3. Returns the claimed job via `.returning().get()`, or `undefined` if no eligible job or claim failed.

### Event emitter

- `eventListeners` is a module-level `Set<JobEventListener>`.
- `onJobEvent(listener)` adds to the set, returns an unsubscribe function that calls `delete`.
- `emitJobEvent(jobId, type, status, payload?)` iterates the set, calling each listener in a try/catch (listener errors silently ignored).

Events emitted:
- `completeJob` -> `emitJobEvent(jobId, "job-done", "done", result)`
- `failJob` -> `emitJobEvent(jobId, "job-failed", "failed", { error })`
- Poll loop (on claim) -> `emitJobEvent(job.id, "job-started", "running")`

### completeJob(jobId, result?)

Updates the job: `status = "done"`, `result = JSON.stringify(result)` (or null), `completedAt = Date.now()`. Emits `"job-done"` event.

### failJob(jobId, error)

Failed jobs stay failed — no automatic backoff or requeue.

1. Fetch the job to read current `attempt`.
2. Compute `nextAttempt = attempt + 1`.
3. Update: `status = "failed"`, `error`, `attempt = nextAttempt`, `completedAt = Date.now()`.
4. Emit `"job-failed"` with `{ error }`.

### createJob(input)

Insert into `jobs` table with the provided input. Returns the full job row via `.returning().get()`.

### startJobRunner(config)

1. Guards with `running` flag. No-op if already running.
2. Sets `running = true`. Logs start with poll interval.
3. Defines an async `poll()` function:
   - If `!running`, return.
   - Call `claimNextJob(db)`.
   - If a job is claimed: log it, emit `"job-started"`, look up handler from the `handlers` record by `job.type`.
   - If handler not found: `failJob(job.id, "Unknown job type: {type}")`.
   - If handler found: `await handler(job, config)`. On exception, `failJob(job.id, message)`.
   - On poll-level catch (e.g., DB error): log error, continue.
   - If still `running`: schedule next `poll()` via `setTimeout(poll, config.jobRunner.pollIntervalMs)`.
4. Call `poll()` to start the loop.

No wishlist interval timer — `wishlist_run` is manual-only (triggered via API or CLI).

### stopJobRunner()

Sets `running = false`. Clears `pollTimer` (setTimeout) if set. Logs stop.

### Handler: spotify_sync

**Payload**: `{ playlistId: string }`

**Behavior**:
1. Parse payload from `job.payload`.
2. Fetch playlist from DB by ID. Throw if not found.
3. If playlist has a `spotifyId`, create `SpotifyService(config.spotify)` and call `syncPlaylistTracks(spotifyId)` to refresh from Spotify API.
4. Create a child `lexicon_match` job: `{ type: "lexicon_match", status: "queued", priority: 5, payload: { playlistId }, parentJobId: job.id }`.
5. `completeJob(job.id, { playlistId })`.

### Handler: lexicon_match

**Payload**: `{ playlistId: string }`

**Behavior**:
1. Parse payload. Create `SyncPipeline(config)`.
2. Call `pipeline.matchPlaylist(playlistId)`.
3. For each item in `result.notFound`, create a child `search` job: `{ type: "search", status: "queued", priority: 3, payload: { trackId, playlistId, title, artist, album, durationMs, queryIndex: 0 }, parentJobId: job.id }`.
4. `completeJob(job.id, { playlistId, confirmed: N, pending: N, notFound: N, total: N })`.

Note: confirmed tracks are tagged immediately by the sync pipeline. Pending matches are parked for async review.

### Handler: search

**Payload**: `{ trackId, playlistId, title, artist, album?, durationMs?, queryIndex }`

**Behavior**:
1. Parse payload. Build track object. Call `generateSearchQueries(track)` to get strategy list.
2. If `queryIndex >= strategies.length`: `failJob(job.id, "All N search strategies exhausted")`. Return.
3. Create `DownloadPipeline(config.soulseek, config.download, config.lexicon)`.
4. Call `downloadPipeline.searchAndRank(track)` which returns `{ ranked, diagnostics, strategy, strategyLog }`.
5. If `ranked.length > 0 && ranked[0].score >= 0.3`:
   - Create child `download` job: `{ type: "download", status: "queued", priority: 4, payload: { trackId, playlistId, title, artist, album, durationMs, file: { filename, size, username, bitRate }, score, strategy }, parentJobId: job.id }`.
   - `completeJob(job.id, { strategy, strategyLog, candidates: N, bestScore })`.
6. Otherwise: `failJob(job.id, "No viable results: {diagnostics}. Strategies tried: {labels}")`.

### Handler: download

**Payload**: `{ trackId, playlistId, title, artist, album?, durationMs?, file: { filename, size, username, bitRate? }, score, strategy? }`

**Behavior**:
1. Parse payload. Insert a `downloads` row with `status: "downloading"`, `soulseekPath`, `startedAt: Date.now()`, `origin` (from parent context: `"not_found"` or `"review_rejected"`). Get back the row ID.
2. Look up playlist name from DB.
3. Create `DownloadPipeline`. Build track and slskd file objects (with `code: "1"` and undefined sampleRate/bitDepth/length).
4. Call `downloadPipeline.acquireAndMove(slskdFile, track, playlistName, trackId)`.
5. On success: update download row to `status: "done"`, `filePath`, `completedAt`. `completeJob(job.id, { trackId, filePath, strategy })`.
6. On failure: update download row to `status: "failed"`, `error`, `completedAt`. Throw error to trigger `failJob` in the runner.

### Handler: validate

**Payload**: `{ trackId, filePath, title, artist, album?, durationMs? }`

**Behavior**:
1. Parse payload. Create `DownloadPipeline`.
2. Call `downloadPipeline.validateDownload(filePath, track)`.
3. If `!valid`: throw `Error("File failed metadata validation: {filePath}")` to trigger failJob.
4. If valid: `completeJob(job.id, { trackId, valid: true })`.

### Handler: lexicon_tag

**Payload**: `{ playlistId: string }`

**Behavior**:
1. Parse payload. Fetch playlist from DB. Throw if not found.
2. Fetch all `playlistTracks` track IDs for this playlist.
3. Query all confirmed matches (`sourceType="spotify"`, `targetType="lexicon"`, `status="confirmed"`), then filter to only those whose `sourceId` is in the playlist's track set.
4. Extract `lexiconTrackIds` from filtered matches.
5. If no confirmed matches: `completeJob(job.id, { tagged: 0 })`. Return.
6. Create `SyncPipeline(config)`. Call `pipeline.syncTags(playlistName, confirmedTracks)` — tags each Lexicon track under the configured category, scoped to only touch that category's tags.
7. `completeJob(job.id, { tagged: N })`.

Note: no Lexicon playlist creation — only category-scoped tagging.

### Handler: wishlist_run

**Payload**: `null` (no payload required)

**Behavior**:
1. Query all failed jobs where `type IN ('search', 'download')`.
2. For each failed job: re-queue by updating `status = "queued"`, `error = null`, `runAfter = null`. Increment `requeued` counter.
3. `completeJob(job.id, { scanned: N, requeued: N })`.

`wishlist_run` is manual-only — triggered explicitly via `POST /api/wishlist/run` or `crate-sync wishlist run`. There is no automatic interval timer.

## Error Handling

| Scenario | Behavior |
|---|---|
| Unknown job type | `failJob(id, "Unknown job type: {type}")` |
| Handler throws | Runner catches, calls `failJob(id, message)` |
| Poll-level error (e.g., DB down) | Logged, loop continues on next interval |
| Job already claimed (race condition) | Atomic UPDATE WHERE status='queued' returns undefined; no double-processing |
| Playlist not found (spotify_sync, lexicon_tag) | Handler throws; runner calls failJob |
| All search strategies exhausted | `failJob` — job stays failed until manual retry or wishlist_run |
| Download acquireAndMove fails | Handler throws; download row marked "failed"; runner calls failJob |
| Validate fails | Handler throws `"File failed metadata validation"`; runner calls failJob |
| Wishlist run with no eligible jobs | completeJob with `{ scanned: 0, requeued: 0 }` |
| Event listener throws | Silently ignored (try/catch in emitJobEvent) |

## Tests

### Test approach

- Use in-memory SQLite for the jobs table.
- Mock services (`SpotifyService`, `SyncPipeline`, `DownloadPipeline`) to avoid network calls.
- Test `claimNextJob` atomicity by verifying a claimed job cannot be re-claimed.
- Test each handler in isolation by constructing a mock `Job` object and `Config`.

### Key test scenarios

- **claimNextJob**: returns highest-priority, oldest job; respects `runAfter`; returns undefined when no eligible jobs
- **claimNextJob**: atomic — second call returns undefined for the same job
- **completeJob**: sets status to "done", serializes result, sets completedAt, emits event
- **failJob**: marks as "failed", sets error, increments attempt, emits "job-failed" — no requeue
- **createJob**: inserts and returns full row
- **startJobRunner**: processes queued jobs on poll interval
- **startJobRunner**: does NOT create periodic wishlist jobs (no interval timer)
- **stopJobRunner**: clears poll timer, stops polling
- **onJobEvent**: listener receives events, unsubscribe works
- **spotify_sync handler**: syncs from Spotify, creates child lexicon_match job
- **lexicon_match handler**: runs matchPlaylist, creates search jobs for notFound
- **search handler**: exhausted strategies -> failJob (stays failed)
- **search handler**: good result -> creates download child job
- **download handler**: success -> updates download row + completeJob
- **download handler**: failure -> updates download row + throws for failJob
- **validate handler**: valid -> completeJob; invalid -> throws
- **lexicon_tag handler**: tags confirmed matches under configured category
- **lexicon_tag handler**: no confirmed matches -> completeJob with tagged: 0
- **wishlist_run handler**: re-queues all eligible failed search/download jobs
- **wishlist_run handler**: no eligible jobs -> completeJob with requeued: 0

## Acceptance Criteria

- [ ] `claimNextJob()` uses atomic UPDATE WHERE pattern to prevent double-processing
- [ ] Jobs ordered by `priority DESC, createdAt ASC`
- [ ] `runAfter` respected: jobs not claimed before their scheduled time
- [ ] `completeJob()` sets status/result/completedAt and emits "job-done"
- [ ] `failJob()` marks job as "failed" immediately — no automatic backoff or requeue
- [ ] `failJob()` emits "job-failed" event
- [ ] `createJob()` inserts and returns the full job row
- [ ] Event emitter: `onJobEvent()` returns unsubscribe function, `emitJobEvent()` is error-tolerant
- [ ] `startJobRunner()` polls at `config.jobRunner.pollIntervalMs`
- [ ] `startJobRunner()` does NOT create any wishlist interval timer
- [ ] `stopJobRunner()` clears poll timer and sets running=false
- [ ] 7 handlers registered: `spotify_sync`, `lexicon_match`, `search`, `download`, `validate`, `lexicon_tag`, `wishlist_run`
- [ ] Handler: `spotify_sync` refreshes from API + creates child `lexicon_match` job
- [ ] Handler: `lexicon_match` runs matchPlaylist + creates search jobs for notFound items
- [ ] Handler: `search` uses query builder strategies, creates download job on match (score >= 0.3), fails when exhausted
- [ ] Handler: `download` inserts download row with `origin`, calls acquireAndMove, updates row on success/failure
- [ ] Handler: `validate` checks metadata, throws on invalid
- [ ] Handler: `lexicon_tag` tags confirmed matches under configured category — no Lexicon playlist creation
- [ ] Handler: `wishlist_run` re-queues all failed search/download jobs (manual trigger only)
- [ ] All handlers parse payload from `job.payload` (JSON string)
- [ ] All handlers call `completeJob` or throw (letting runner call `failJob`)
