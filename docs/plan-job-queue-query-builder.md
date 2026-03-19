# Crate-Sync Architecture: Job Queue with Query Builder

## Context

The current sync pipeline is a monolithic CLI command running 3 phases sequentially (match → interactive review → download). Problems: 10min+ blocking searches, interactive review blocks downloads, no resume on crash, naive search queries returning 0 results for remix titles, no observability, no automatic retry (wishlists), download state not tracked.

**Decision:** Option B (Job Queue) with SQLite polling, designed so migration to a message broker (Option D) is ~2-3 days if ever needed. Query builder ships first as a standalone win. Both CLI and Web UI have full feature parity.

## Phase 1: Query Builder + Download State (2-3 days)

Standalone improvements to search quality and state tracking. No structural changes.

### 1.1 Multi-strategy search query builder

**New file:** `src/search/query-builder.ts`

```typescript
generateSearchQueries(track: TrackInfo): string[]
```

Strategies (ordered, stop at first with results):
1. `"{artist} {title}"` — current behavior but cleaned (strip dashes, parens)
2. `"{artist} {baseTitle}"` — strip remix/edit suffix via existing `stripRemixSuffix()` from `src/matching/normalize.ts`
3. `"{title}"` — title only (handles different artist spellings on Soulseek)
4. `"{artist} {keyword1} {keyword2}"` — first 2 significant words from title (handles long titles)

**Cleaning function** (applied to all strategies):
- Replace `" - "` with `" "`
- Remove parenthetical content: `(Remix)`, `(feat. X)`, `(Extended Mix)`
- Collapse multiple spaces

**New file:** `src/search/__tests__/query-builder.test.ts`
- Test with known failures: "Reliquia - German Brigante Remix", "Mr. Brightside", "Linger - SiriusXM Session"
- Test cleaning edge cases: unicode, multiple parens, nested parens

### 1.2 Use query builder in download service

**Modify:** `src/services/download-service.ts`
- `searchAndRank()` and `searchAndRankBatch()` use `generateSearchQueries()` instead of naive `"${artist} ${title}"`
- Try strategies sequentially: search with strategy 1, if 0 candidates try strategy 2, etc.
- Log which strategy succeeded (for observability)

### 1.3 Proper download state tracking

**Modify:** `src/services/download-service.ts`
- `acquireAndMove()` writes state transitions to `downloads` table: `searching` → `downloading` → `validating` → `moving` → `done`/`failed`
- On failure, record which query strategies were tried and what results came back
- On crash/resume, the `downloads` table shows exactly where it stopped

### 1.4 Verbose CLI output

**Modify:** `src/commands/sync.ts`
- Add `--verbose` flag to `sync` command
- Per-track: show query used, results count, filter breakdown (format/bitrate/artist), top 3 candidates with scores
- Show which query strategy succeeded

### Verification (Phase 1)
1. `npx vitest run` — all tests pass
2. Unit test query builder with problematic tracks
3. `pnpm dev --verbose sync <playlist>` — shows per-track search diagnostics
4. Compare results: tracks that returned 0 now find matches with fallback strategies

---

## Phase 2: Job Queue Architecture (1-2 weeks)

Decompose the pipeline into independent jobs. Single process (`crate-sync serve`) with in-process job runner. CLI becomes thin client.

### 2.1 Database: `jobs` table

**Modify:** `src/db/schema.ts`

```
jobs table:
  id (PK, UUID)
  type: 'spotify_sync' | 'match' | 'search' | 'download' | 'validate' | 'lexicon_sync' | 'wishlist_scan'
  status: 'queued' | 'running' | 'done' | 'failed'
  priority (int, higher = first)
  payload (JSON text) — { trackId, playlistId, query, queryIndex, ... }
  result (JSON text) — outcome data
  error (text)
  attempt (int, default 0)
  max_attempts (int, default 3)
  run_after (timestamp) — don't run before this time (for wishlist backoff)
  parent_job_id (FK, nullable) — links child jobs to parent
  created_at, started_at, completed_at
```

Generate migration via `drizzle-kit generate`.

### 2.2 Job runner

**New file:** `src/jobs/runner.ts`

Simple polling loop running in the Hono server process:

```
while (true):
  job = SELECT FROM jobs WHERE status='queued' AND run_after <= now()
        ORDER BY priority DESC, created_at ASC LIMIT 1
  if (!job) { sleep 1s; continue }
  UPDATE SET status='running', started_at=now() WHERE id=job.id AND status='queued'
  try { await handler(job) } catch { mark failed, maybe requeue }
```

Atomic claim via `UPDATE ... WHERE status='queued'` prevents double-processing.

### 2.3 Job handlers

**New directory:** `src/jobs/handlers/`

Each handler is a function `(job: Job, deps: Services) => Promise<void>`:

- **`spotify-sync.ts`** — fetch playlist from Spotify API, upsert to DB, create `match` job
- **`match.ts`** — run `matchPlaylist()`, create `search` jobs for not-found tracks, high-confidence auto-confirm
- **`search.ts`** — run search with query builder strategies. On results: create `download` job. On failure: re-queue with next strategy or mark failed with `run_after` backoff
- **`download.ts`** — `acquireAndMove()` for a single track
- **`validate.ts`** — post-download validation + move to Lexicon folder
- **`lexicon-sync.ts`** — sync confirmed matches to Lexicon playlist + tags
- **`wishlist-scan.ts`** — query failed search jobs past cooldown, re-queue them

Handlers reuse existing service methods:
- `SyncPipeline.matchPlaylist()` → match handler
- `DownloadService.rankResults()`, `acquireAndMove()` → search/download handlers
- `SoulseekService.rateLimitedSearch()` → search handler
- `LexiconService.*` → lexicon-sync handler

### 2.4 CLI thin client mode

**Modify:** `src/commands/sync.ts`

When server is running (`crate-sync serve`):
- `crate-sync sync <playlist>` → POST to `/api/sync`, streams job progress via SSE
- `crate-sync sync --standalone <playlist>` → runs ephemeral server, executes jobs, exits (backward compat)

### 2.5 API routes for jobs

**New file:** `src/api/routes/jobs.ts`
- `GET /api/jobs` — list jobs, filterable by type/status/playlist
- `GET /api/jobs/:id` — job detail with result/error
- `POST /api/jobs/:id/retry` — re-queue a failed job
- `DELETE /api/jobs/:id` — cancel a queued job
- `GET /api/jobs/stream` — SSE for real-time job updates

**Modify:** `src/api/routes/sync.ts`
- `POST /api/sync/:playlistId` — creates the job chain instead of running pipeline directly

### 2.6 Web UI enhancements

**Modify:** `web/src/pages/`

- **Queue page** — live job list with status, filterable, retry/cancel buttons
- **Track detail page** — for any track: full lifecycle (imported → matched → searched → downloaded → synced)
- **Review panel** — pending matches with side-by-side Spotify vs Lexicon, accept/reject. Also pending download candidates with Soulseek file details.
- **Dashboard** — job stats (queued/running/done/failed), worker status

### 2.7 Wishlist

Built into the server via `setInterval`:

```typescript
setInterval(async () => {
  // Find failed search/download jobs past cooldown
  const retryable = db.select().from(jobs).where(
    status = 'failed' AND
    attempt < max_attempts AND
    completed_at < now() - backoff(attempt)
  );
  // Re-queue with next query strategy
  for (const job of retryable) { ... }
}, 6 * 60 * 60 * 1000); // every 6 hours
```

Backoff schedule: 1h → 6h → 24h → 7d → mark as skipped.

### 2.8 CLI parity

All web UI features are also available via CLI:
- `crate-sync jobs list [--status failed] [--type search]`
- `crate-sync jobs retry <id>`
- `crate-sync jobs retry-all --type search`
- `crate-sync wishlist run` — manual trigger (also works via cron)
- `crate-sync review` — interactive terminal review (matches + download candidates)

### Verification (Phase 2)
1. `npx vitest run` — all tests pass
2. `pnpm dev serve` — server starts, job runner picks up work
3. `pnpm dev sync <playlist>` — creates jobs, streams progress
4. Web UI: review matches without blocking downloads
5. Kill server mid-download → restart → resumes from DB state
6. Failed search → wishlist re-queues after cooldown → finds track with different query
7. `pnpm dev sync --standalone <playlist>` — still works without server

---

## Design for D migration

If we later want a message broker, these seams are pre-built:

| Option B component | Option D replacement |
|---|---|
| `db.insert(jobs)` | `queue.add(jobType, payload)` |
| `SELECT WHERE status='queued'` polling | `worker.process(handler)` subscription |
| `setInterval` wishlist | Delayed/scheduled jobs in BullMQ |
| SSE from job table changes | Redis pub/sub events |

All job handlers stay identical. Schema stays (durable state). UI stays.

---

## Files summary

### Phase 1
| File | Action |
|---|---|
| `src/search/query-builder.ts` | NEW — multi-strategy query generation |
| `src/search/__tests__/query-builder.test.ts` | NEW — unit tests |
| `src/services/download-service.ts` | MODIFY — use query builder, log strategy |
| `src/commands/sync.ts` | MODIFY — add `--verbose` flag |

### Phase 2
| File | Action |
|---|---|
| `src/db/schema.ts` | MODIFY — add `jobs` table |
| `src/jobs/runner.ts` | NEW — job polling loop |
| `src/jobs/handlers/spotify-sync.ts` | NEW |
| `src/jobs/handlers/match.ts` | NEW |
| `src/jobs/handlers/search.ts` | NEW |
| `src/jobs/handlers/download.ts` | NEW |
| `src/jobs/handlers/validate.ts` | NEW |
| `src/jobs/handlers/lexicon-sync.ts` | NEW |
| `src/jobs/handlers/wishlist-scan.ts` | NEW |
| `src/api/routes/jobs.ts` | NEW — job queue API |
| `src/api/routes/sync.ts` | MODIFY — create jobs |
| `src/commands/sync.ts` | MODIFY — thin client + standalone mode |
| `src/commands/jobs.ts` | NEW — CLI job management |
| `src/commands/serve.ts` | MODIFY — start job runner |
| `web/src/pages/Queue.tsx` | NEW |
| `web/src/pages/TrackDetail.tsx` | NEW |
| `web/src/pages/Review.tsx` | NEW/MODIFY |

### Reused as-is
- `src/matching/*` — all matching logic
- `src/services/soulseek-service.ts` — called by handlers
- `src/services/lexicon-service.ts` — called by handlers
- `src/services/spotify-service.ts` — called by handlers
- `src/services/download-service.ts` — `rankResults()`, `validateDownload()`, `moveToPlaylistFolder()`, `findDownloadedFile()`, `acquireAndMove()`
- `src/config.ts` — add job runner config fields
- `src/utils/*` — all utilities
- `src/db/client.ts` — unchanged
