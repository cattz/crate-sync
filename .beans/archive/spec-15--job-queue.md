---
# spec-15
title: "Job queue: runner and handlers"
status: todo
type: task
priority: critical
parent: spec-E4
depends_on: spec-14, spec-09, spec-04, spec-03
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

## Purpose

The job queue provides a SQLite-backed polling runner that claims, executes, and finalizes asynchronous work items. Seven specialized handlers implement the actual job logic, composing lower-level services. The runner emits events via a listener-set pattern so SSE endpoints can stream real-time updates. Jobs support parent-child relationships, priority ordering, exponential backoff on failure, and a wishlist scanner that periodically re-queues eligible failed jobs.

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

// Mark a job as failed; if below max_attempts, re-queue with backoff
export function failJob(jobId: string, error: string, requeue?: boolean): void

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
  match: handleMatch,
  search: handleSearch,
  download: handleDownload,
  validate: handleValidate,
  lexicon_sync: handleLexiconSync,
  wishlist_scan: handleWishlistScan,
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
| `match` | `SyncPipeline`, `completeJob`, `createJob` |
| `search` | `DownloadService`, `generateSearchQueries`, `completeJob`, `failJob`, `createJob` |
| `download` | `DownloadService`, `completeJob`, `createJob`, schema, drizzle-orm |
| `validate` | `DownloadService`, `completeJob` |
| `lexicon-sync` | `SyncPipeline`, `completeJob`, schema, drizzle-orm |
| `wishlist-scan` | `completeJob`, `createJob`, `createLogger`, schema, drizzle-orm |

## Behavior

### Job claiming (atomic)

`claimNextJob(db)`:

1. SELECT the first job where `status = "queued"` AND (`runAfter IS NULL` OR `runAfter <= now`), ordered by `priority DESC, createdAt ASC`. LIMIT 1.
2. Atomically UPDATE the candidate: set `status = "running"`, `startedAt = Date.now()`, with a WHERE clause that re-checks `status = "queued"` to prevent double-processing.
3. Returns the claimed job via `.returning().get()`, or `undefined` if no eligible job or claim failed.

### Backoff calculation

`getBackoffMs(attempt)` uses a fixed schedule array:

| Attempt | Backoff |
|---|---|
| 1 | 1 hour (3,600,000 ms) |
| 2 | 6 hours (21,600,000 ms) |
| 3 | 24 hours (86,400,000 ms) |
| 4+ | 7 days (604,800,000 ms) |

Clamped via `Math.min(attempt - 1, schedule.length - 1)`.

### Event emitter

- `eventListeners` is a module-level `Set<JobEventListener>`.
- `onJobEvent(listener)` adds to the set, returns an unsubscribe function that calls `delete`.
- `emitJobEvent(jobId, type, status, payload?)` iterates the set, calling each listener in a try/catch (listener errors silently ignored).

Events emitted:
- `completeJob` -> `emitJobEvent(jobId, "job-done", "done", result)`
- `failJob` (requeue) -> `emitJobEvent(jobId, "job-requeued", "queued", { error, attempt, backoffMs })`
- `failJob` (terminal) -> `emitJobEvent(jobId, "job-failed", "failed", { error })`
- Poll loop (on claim) -> `emitJobEvent(job.id, "job-started", "running")`

### completeJob(jobId, result?)

Updates the job: `status = "done"`, `result = JSON.stringify(result)` (or null), `completedAt = Date.now()`. Emits `"job-done"` event.

### failJob(jobId, error, requeue = true)

1. Fetch the job to read current `attempt` and `maxAttempts`.
2. Compute `nextAttempt = attempt + 1`.
3. If `requeue && nextAttempt < maxAttempts`:
   - Compute `backoffMs = getBackoffMs(nextAttempt)`.
   - Update: `status = "queued"`, `error`, `attempt = nextAttempt`, `runAfter = Date.now() + backoffMs`, `completedAt = Date.now()`.
   - Emit `"job-requeued"` with `{ error, attempt: nextAttempt, backoffMs }`.
4. Otherwise:
   - Update: `status = "failed"`, `error`, `attempt = nextAttempt`, `completedAt = Date.now()`.
   - Emit `"job-failed"` with `{ error }`.

### createJob(input)

Insert into `jobs` table with the provided input. Returns the full job row via `.returning().get()`.

### startJobRunner(config)

1. Guards with `running` flag. No-op if already running.
2. Sets `running = true`. Logs start with poll and wishlist intervals.
3. Defines an async `poll()` function:
   - If `!running`, return.
   - Call `claimNextJob(db)`.
   - If a job is claimed: log it, emit `"job-started"`, look up handler from the `handlers` record by `job.type`.
   - If handler not found: `failJob(job.id, "Unknown job type: {type}", false)` (no requeue).
   - If handler found: `await handler(job, config)`. On exception, `failJob(job.id, message)` (with requeue).
   - On poll-level catch (e.g., DB error): log error, continue.
   - If still `running`: schedule next `poll()` via `setTimeout(poll, config.jobRunner.pollIntervalMs)`.
4. Call `poll()` to start the loop.
5. Start wishlist scanner interval: `setInterval` at `config.jobRunner.wishlistIntervalMs` that creates a `wishlist_scan` job with `priority: -1`.

### stopJobRunner()

Sets `running = false`. Clears `pollTimer` (setTimeout) and `wishlistTimer` (setInterval) if set. Logs stop.

### Handler: spotify-sync

**Payload**: `{ playlistId: string }`

**Behavior**:
1. Parse payload from `job.payload`.
2. Fetch playlist from DB by ID. Throw if not found.
3. If playlist has a `spotifyId`, create `SpotifyService(config.spotify)` and call `syncPlaylistTracks(spotifyId)` to refresh from Spotify API.
4. Create a child `match` job: `{ type: "match", status: "queued", priority: 5, payload: { playlistId }, parentJobId: job.id }`.
5. `completeJob(job.id, { playlistId })`.

### Handler: match

**Payload**: `{ playlistId: string }`

**Behavior**:
1. Parse payload. Create `SyncPipeline(config)`.
2. Call `pipeline.matchPlaylist(playlistId)`.
3. For each item in `result.notFound`, create a child `search` job: `{ type: "search", status: "queued", priority: 3, payload: { trackId, playlistId, title, artist, album, durationMs, queryIndex: 0 }, parentJobId: job.id }`.
4. `completeJob(job.id, { playlistId, found: N, needsReview: N, notFound: N, total: N })`.

### Handler: search

**Payload**: `{ trackId, playlistId, title, artist, album?, durationMs?, queryIndex }`

**Behavior**:
1. Parse payload. Build track object. Call `generateSearchQueries(track)` to get strategy list.
2. If `queryIndex >= strategies.length`: `failJob(job.id, "All N search strategies exhausted", false)` (no requeue). Return.
3. Create `DownloadService(config.soulseek, config.download, config.lexicon)`.
4. Call `downloadService.searchAndRank(track)` which returns `{ ranked, diagnostics, strategy, strategyLog }`.
5. If `ranked.length > 0 && ranked[0].score >= 0.3`:
   - Create child `download` job: `{ type: "download", status: "queued", priority: 4, payload: { trackId, playlistId, title, artist, album, durationMs, file: { filename, size, username, bitRate }, score, strategy }, parentJobId: job.id }`.
   - `completeJob(job.id, { strategy, strategyLog, candidates: N, bestScore })`.
6. Otherwise: `failJob(job.id, "No viable results: {diagnostics}. Strategies tried: {labels}")` (with default requeue).

### Handler: download

**Payload**: `{ trackId, playlistId, title, artist, album?, durationMs?, file: { filename, size, username, bitRate? }, score, strategy? }`

**Behavior**:
1. Parse payload. Insert a `downloads` row with `status: "downloading"`, `soulseekPath`, `startedAt: Date.now()`. Get back the row ID.
2. Look up playlist name from DB.
3. Create `DownloadService`. Build track and slskd file objects (with `code: "1"` and undefined sampleRate/bitDepth/length).
4. Call `downloadService.acquireAndMove(slskdFile, track, playlistName, trackId)`.
5. On success: update download row to `status: "done"`, `filePath`, `completedAt`. `completeJob(job.id, { trackId, filePath, strategy })`.
6. On failure: update download row to `status: "failed"`, `error`, `completedAt`. Throw error to trigger `failJob` in the runner.

### Handler: validate

**Payload**: `{ trackId, filePath, title, artist, album?, durationMs? }`

**Behavior**:
1. Parse payload. Create `DownloadService`.
2. Call `downloadService.validateDownload(filePath, track)`.
3. If `!valid`: throw `Error("File failed metadata validation: {filePath}")` to trigger failJob.
4. If valid: `completeJob(job.id, { trackId, valid: true })`.

### Handler: lexicon-sync

**Payload**: `{ playlistId: string, syncTags?: boolean }`

**Behavior**:
1. Parse payload. Fetch playlist from DB. Throw if not found.
2. Fetch all `playlistTracks` track IDs for this playlist.
3. Query all confirmed matches (`sourceType="spotify"`, `targetType="lexicon"`, `status="confirmed"`), then filter to only those whose `sourceId` is in the playlist's track set.
4. Extract `lexiconTrackIds` from filtered matches.
5. If no confirmed matches: `completeJob(job.id, { synced: 0 })`. Return.
6. Create `SyncPipeline(config)`. Call `pipeline.syncToLexicon(playlistId, playlistName, lexiconTrackIds)`.
7. If `payload.syncTags`: build minimal `MatchedTrack[]` from confirmed matches (with `track: { title: "", artist: "" }` placeholders). Call `pipeline.syncTags(playlistName, confirmedTracks)`.
8. `completeJob(job.id, { synced: N })`.

### Handler: wishlist-scan

**Payload**: `null` (no payload required)

**Behavior**:
1. Query all failed jobs where `type IN ('search', 'download')` and `attempt < maxAttempts`.
2. For each failed job, compute cooldown via `getCooldownMs(attempt)`:
   - Schedule: 1h -> 6h -> 24h -> 7d. If `attempt > schedule.length`, return -1 (skip permanently).
   - `completedAt` (or `createdAt` if null) must be older than `cooldownMs` from now.
3. If past cooldown: update job to `status: "queued"`, `runAfter: null`. Increment `requeued`.
4. Otherwise: increment `skipped`.
5. `completeJob(job.id, { scanned: N, requeued: N, skipped: N })`.

## Error Handling

| Scenario | Behavior |
|---|---|
| Unknown job type | `failJob(id, "Unknown job type: {type}", false)` — no requeue |
| Handler throws | Runner catches, calls `failJob(id, message)` with default requeue |
| Poll-level error (e.g., DB down) | Logged, loop continues on next interval |
| Job already claimed (race condition) | Atomic UPDATE WHERE status='queued' returns undefined; no double-processing |
| Playlist not found (spotify-sync, lexicon-sync) | Handler throws; runner calls failJob |
| All search strategies exhausted | `failJob` with `requeue = false` |
| Download acquireAndMove fails | Handler throws; download row marked "failed"; runner calls failJob |
| Validate fails | Handler throws `"File failed metadata validation"`; runner calls failJob |
| Wishlist scan with no eligible jobs | completeJob with `{ scanned: 0, requeued: 0, skipped: 0 }` |
| Event listener throws | Silently ignored (try/catch in emitJobEvent) |

## Tests

### Test approach

- Use in-memory SQLite for the jobs table.
- Mock services (`SpotifyService`, `SyncPipeline`, `DownloadService`) to avoid network calls.
- Test `claimNextJob` atomicity by verifying a claimed job cannot be re-claimed.
- Test each handler in isolation by constructing a mock `Job` object and `Config`.

### Key test scenarios

- **claimNextJob**: returns highest-priority, oldest job; respects `runAfter`; returns undefined when no eligible jobs
- **claimNextJob**: atomic — second call returns undefined for the same job
- **completeJob**: sets status to "done", serializes result, sets completedAt, emits event
- **failJob**: re-queues with backoff when below maxAttempts
- **failJob**: marks as "failed" when at maxAttempts or requeue=false
- **failJob**: emits "job-requeued" or "job-failed" events
- **createJob**: inserts and returns full row
- **startJobRunner**: processes queued jobs on poll interval
- **startJobRunner**: creates periodic wishlist_scan jobs
- **stopJobRunner**: clears timers, stops polling
- **onJobEvent**: listener receives events, unsubscribe works
- **spotify-sync handler**: syncs from Spotify, creates child match job
- **match handler**: runs matchPlaylist, creates search jobs for notFound
- **search handler**: exhausted strategies -> failJob with no requeue
- **search handler**: good result -> creates download child job
- **download handler**: success -> updates download row + completeJob
- **download handler**: failure -> updates download row + throws for failJob
- **validate handler**: valid -> completeJob; invalid -> throws
- **lexicon-sync handler**: syncs to Lexicon, optional tag sync
- **wishlist-scan handler**: re-queues eligible failed jobs, respects cooldown schedule

## Acceptance Criteria

- [ ] `claimNextJob()` uses atomic UPDATE WHERE pattern to prevent double-processing
- [ ] Jobs ordered by `priority DESC, createdAt ASC`
- [ ] `runAfter` respected: jobs not claimed before their scheduled time
- [ ] `completeJob()` sets status/result/completedAt and emits "job-done"
- [ ] `failJob()` re-queues with schedule-based backoff (1h/6h/24h/7d) when below maxAttempts
- [ ] `failJob()` marks terminal failure when at maxAttempts or requeue=false
- [ ] `createJob()` inserts and returns the full job row
- [ ] Event emitter: `onJobEvent()` returns unsubscribe function, `emitJobEvent()` is error-tolerant
- [ ] `startJobRunner()` polls at `config.jobRunner.pollIntervalMs`, creates wishlist_scan at `config.jobRunner.wishlistIntervalMs`
- [ ] `stopJobRunner()` clears all timers and sets running=false
- [ ] Handler: `spotify-sync` refreshes from API + creates child match job
- [ ] Handler: `match` runs matchPlaylist + creates search jobs for notFound items
- [ ] Handler: `search` uses query builder strategies, creates download job on match (score >= 0.3), fails with no requeue when exhausted
- [ ] Handler: `download` inserts download row, calls acquireAndMove, updates row on success/failure
- [ ] Handler: `validate` checks metadata, throws on invalid
- [ ] Handler: `lexicon-sync` syncs confirmed matches to Lexicon playlist, optional tag sync
- [ ] Handler: `wishlist-scan` re-queues failed search/download jobs past cooldown period
- [ ] All handlers parse payload from `job.payload` (JSON string)
- [ ] All handlers call `completeJob` or throw (letting runner call `failJob`)
