---
# spec-16
title: API routes
status: todo
type: task
priority: critical
parent: spec-E4
depends_on: spec-12, spec-14, spec-15, spec-03
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

## Purpose

Seven Hono route modules provide the full REST API surface for the web frontend and CLI. Routes are thin orchestration layers that instantiate services per-request, validate input, call service methods, and return JSON responses. Two modules include SSE streaming (sync events and job updates). All routes follow a consistent error format (`{ error: string }` with HTTP status code) and obey Hono's static-before-parameterized ordering rule.

## Public Interface

Each file exports a single `Hono` instance:

```ts
// playlists.ts
export const playlistRoutes: Hono

// tracks.ts
export const trackRoutes: Hono

// matches.ts
export const matchRoutes: Hono

// downloads.ts
export const downloadRoutes: Hono

// status.ts
export const statusRoutes: Hono

// sync.ts
export const syncRoutes: Hono

// jobs.ts
export const jobRoutes: Hono
```

### Shared state module (`src/api/state.ts`)

```ts
export interface SyncEvent {
  type: string;
  data: unknown;
}

export type SyncStatus = "running" | "awaiting-review" | "done" | "error";

export interface SyncState {
  playlistId: string;
  status: SyncStatus;
  events: SyncEvent[];
  listeners: Set<(event: SyncEvent) => Promise<void>>;
  reviewDecisions?: Array<{ dbTrackId: string; accepted: boolean }>;
}

/** Active sync sessions keyed by syncId. */
export const syncState: Map<string, SyncState>
```

## Dependencies

### By route file

| Route file | Key imports |
|---|---|
| `playlists.ts` | `Hono`, `loadConfig`, `getDb`, `PlaylistService`, `SpotifyService`, `SyncPipeline`, schema (`playlists`, `playlistTracks`, `tracks`), `eq`, `sql` |
| `tracks.ts` | `Hono`, `getDb`, schema (`tracks`, `matches`, `downloads`, `jobs`, `playlistTracks`, `playlists`), `eq`, `like`, `or`, `and`, `desc`, `sql` |
| `matches.ts` | `Hono`, `getDb`, schema (`matches`, `tracks`), `eq`, `and`, `sql`, `loadConfig`, `LexiconService` |
| `downloads.ts` | `Hono`, `getDb`, schema (`downloads`, `tracks`), `eq`, `desc` |
| `status.ts` | `Hono`, `loadConfig`, `saveConfig`, `Config`, `checkHealth`, `SpotifyService`, `waitForAuthCallback`, `SoulseekService`, `getDb`, schema (`playlists`, `tracks`, `matches`, `downloads`), `sql` |
| `sync.ts` | `Hono`, `streamSSE`, `crypto`, `getDb`, `PlaylistService`, `loadConfig`, `Config`, `SyncPipeline`, `PhaseOneResult`, `syncState`, `createJob` |
| `jobs.ts` | `Hono`, `streamSSE`, `eq`, `and`, `desc`, `asc`, `sql`, `getDb`, schema (`jobs`), `onJobEvent` |

### Helper patterns

**`getService()`** (playlists.ts only): factory function that returns `new PlaylistService(getDb())`. Called per-request.

**`formatJob(job)`** (jobs.ts only): parses `job.payload` and `job.result` from JSON strings to objects (or null).

## Behavior

### Playlist Routes (`/api/playlists`)

Route ordering: literal routes first (`/sync`, `/duplicates`, `/stats`, `/bulk-rename`), then `:id/subpath` routes, then bare `:id` routes last.

---

**GET `/api/playlists`**

Returns all playlists enriched with track counts.

- Response: `Array<Playlist & { trackCount: number }>`
- Enrichment: for each playlist, count rows in `playlistTracks` where `playlistId` matches.

---

**POST `/api/playlists/sync`**

Re-sync all playlists from Spotify.

- Requires `config.spotify.clientId` and `clientSecret` (returns 400 if missing).
- Checks `spotify.isAuthenticated()` (returns 401 if not).
- Calls `spotify.syncToDb()`.
- Response: `{ ok: true, added: N, updated: N, unchanged: N }`

---

**GET `/api/playlists/duplicates`**

Cross-playlist duplicate detection.

- Calls `svc.findDuplicatesAcrossPlaylists()`.
- Response: result from service.

---

**GET `/api/playlists/stats`**

Library-wide statistics.

- Response: `{ totalPlaylists: N, totalTracks: N, totalDurationMs: N }`
- `totalTracks` = count of distinct trackIds across all playlistTracks.
- `totalDurationMs` = sum of track durations via inner join.

---

**POST `/api/playlists/bulk-rename`**

Bulk rename playlists.

- Request body: `{ mode: "find-replace" | "prefix" | "suffix", find?: string, replace?: string, value?: string, action?: "add" | "remove", dryRun: boolean, pushToSpotify?: boolean }`
- Validation: `find` required for find-replace mode (400), `value` required for prefix/suffix (400), `action` required for prefix/suffix (400).
- Modes:
  - `find-replace`: `name.split(find).join(replace ?? "")`
  - `prefix` + `add`: `value + name`
  - `prefix` + `remove`: strip leading `value`
  - `suffix` + `add`: `name + value`
  - `suffix` + `remove`: strip trailing `value`
- Only includes playlists where `newName !== name`.
- If `!dryRun`: applies renames via `svc.renamePlaylist()`.
- Response: `Array<{ id, name, newName }>`

---

**PUT `/api/playlists/:id/rename`**

Rename a single playlist.

- Request body: `{ name: string }`
- Validates playlist exists (404) and name is non-empty (400).
- Response: `{ ok: true }`

---

**POST `/api/playlists/:id/push`**

Push local changes to Spotify.

- Validates playlist exists (404), has spotifyId (400), Spotify authenticated (401).
- Computes diff between local and Spotify track lists via `svc.getPlaylistDiff()`.
- Always pushes description via `updatePlaylistDetails()` (cheap call, avoids HTML entity diff issues).
- If name changed: includes name in update.
- Removes tracks first, then adds.
- Refreshes snapshot ID after push.
- Response: `{ ok: true, renamed: boolean, descriptionUpdated: true, added: N, removed: N }`
- No changes response: `{ ok: true, renamed: false, descriptionUpdated: true, added: 0, removed: 0, message: "Description synced, no other changes" }`

---

**POST `/api/playlists/:id/repair`**

Run Phase 1 match pipeline.

- Creates `SyncPipeline(config)`, calls `matchPlaylist()`.
- Response: `{ ok: true, playlistName, total, found, needsReview, notFound }`

---

**POST `/api/playlists/:id/merge`**

Merge tracks from source playlists.

- Request body: `{ sourceIds: string[] }`
- Validates sourceIds non-empty (400).
- Response: `{ ok: true, ...mergeResult }`

---

**GET `/api/playlists/:id/tracks`**

Get tracks for a playlist.

- Response: track array from `svc.getPlaylistTracks()`.

---

**GET `/api/playlists/:id/duplicates`**

Within-playlist duplicates.

- Response: result from `svc.findDuplicatesInPlaylist()`.

---

**GET `/api/playlists/:id`**

Get playlist detail with stats.

- Response: `Playlist & { trackCount: N, totalDurationMs: N }`
- Stats via inner join of playlistTracks + tracks.

---

**PATCH `/api/playlists/:id`**

Update playlist metadata.

- Request body: `{ tags?: string[], notes?: string, pinned?: boolean }`
- `tags` stored as `JSON.stringify(tags)`.
- `pinned` stored as `1` or `0`.
- Only updates fields present in body.
- Response: `{ ok: true }`

---

**DELETE `/api/playlists/:id`**

Delete a playlist.

- Calls `svc.removePlaylist()`.
- Response: `{ ok: true }`

---

### Track Routes (`/api/tracks`)

**GET `/api/tracks`**

Search/list tracks.

- Query params: `q` (search string), `limit` (default 50, max 200), `offset` (default 0).
- If `q` provided: WHERE title LIKE, artist LIKE, or album LIKE `%q%`.
- Response: `Track[]`

---

**GET `/api/tracks/:id`**

Get single track.

- Response: `Track` or 404.

---

**GET `/api/tracks/:id/lifecycle`**

Full lifecycle view for a track.

- Response: `{ track, playlists: [{playlistId, position, playlistName}], matches: Match[], downloads: Download[], jobs: Job[] }`
- Playlists: inner join playlistTracks + playlists.
- Matches: where sourceType="spotify" and sourceId=trackId.
- Downloads: where trackId matches, ordered by createdAt desc.
- Jobs: where `json_extract(payload, '$.trackId') = trackId`, ordered by createdAt desc. Payload and result fields parsed from JSON.

---

### Match Routes (`/api/matches`)

**GET `/api/matches`**

List matches with optional status filter.

- Query param: `status` ("pending" | "confirmed" | "rejected").
- Enriches each match with `sourceTrack` (from tracks table) and `targetTrack` (from Lexicon API if available).
- Lexicon enrichment: fetches all Lexicon tracks once, builds map of needed IDs. On Lexicon error, enriches without target info.
- Response: `Array<Match & { sourceTrack, targetTrack }>`

---

**PUT `/api/matches/:id`**

Update match status.

- Request body: `{ status: "confirmed" | "rejected" }`
- Validates status value (400). Validates match exists (404).
- Updates status and `updatedAt = Date.now()`.
- Response: updated `Match`.

---

### Download Routes (`/api/downloads`)

**GET `/api/downloads`**

List downloads with optional filters.

- Query params: `status` (pending|searching|downloading|validating|moving|done|failed), `playlistId`.
- Ordered by `createdAt DESC`.
- Enriched with track info from tracks table.
- Response: `Array<Download & { track }>`

---

**GET `/api/downloads/:id`**

Get single download with track info.

- Response: `Download & { track }` or 404.

---

### Status Routes (`/api/status`)

**GET `/api/status`**

Health check with database stats.

- Calls `checkHealth(config)` for service connectivity.
- Queries counts from playlists, tracks, matches, downloads tables.
- On DB error: `{ ok: false, error: "Not available" }`.
- Response: `{ ...health, database: { ok, playlists, tracks, matches, downloads } }`

---

**GET `/api/status/config`**

Return non-sensitive configuration.

- Response: `{ lexicon: { url, downloadRoot }, soulseek: { slskdUrl, searchDelayMs }, matching, download }`
- Omits secrets (clientId, clientSecret, apiKey, tokens).

---

**PUT `/api/status/config`**

Update safe config values.

- Request body: `Partial<Pick<Config, "matching" | "download">>`
- Updates only: `matching.autoAcceptThreshold`, `matching.reviewThreshold`, `download.formats`, `download.minBitrate`, `download.concurrency`.
- Calls `saveConfig(config)`.
- Response: `{ ok: true }`

---

**POST `/api/status/spotify/login`**

Start Spotify OAuth flow.

- Validates Spotify credentials in config (400).
- Generates random state, builds auth URL.
- Starts callback server via `waitForAuthCallback(port)` (background).
- Does NOT await the flow (user must visit URL).
- Auto-cleans `pendingSpotifyAuth` on completion/error.
- Response: `{ ok: true, authUrl: string }`

---

**GET `/api/status/spotify/auth-status`**

Check OAuth flow status.

- Response: `{ authenticated: boolean, pending: boolean }`

---

**DELETE `/api/status/spotify/login`**

Clear Spotify tokens.

- Deletes `~/.config/crate-sync/spotify-tokens.json` if exists.
- Response: `{ ok: true }`

---

**PUT `/api/status/soulseek/connect`**

Save slskd credentials and test connection.

- Request body: `{ slskdUrl?: string, slskdApiKey?: string }`
- Validates API key required (400).
- Tests connection via `service.ping()` (400 on unreachable).
- Saves config on success.
- Response: `{ ok: true }` or `{ ok: false, error: string }`

---

**DELETE `/api/status/soulseek/connect`**

Clear slskd credentials.

- Sets `slskdApiKey` to empty string, saves config.
- Response: `{ ok: true }`

---

### Sync Routes (`/api/sync`)

**POST `/api/sync/:playlistId`**

Start a full sync via job queue + in-process pipeline.

- Validates playlist exists (404).
- Prevents concurrent syncs for the same playlist (409 if already running).
- Creates `syncState` entry with `status: "running"`.
- Creates root `spotify_sync` job via `createJob()` with `priority: 10`.
- Runs legacy in-process pipeline in background via `runSync()` (for SSE events).
- Response: `{ syncId: string, jobId: string }`

---

**POST `/api/sync/:playlistId/dry-run`**

Phase 1 only, returns JSON.

- Creates `SyncPipeline(config)`, calls `matchPlaylist()`.
- Response: `PhaseOneResult`

---

**GET `/api/sync/:syncId/events`**

SSE stream for sync progress.

- Returns 404 if syncId not found.
- Replays all buffered events first.
- If sync is already done/error, replays only (no blocking).
- Adds a listener to `state.listeners` for new events.
- SSE format: `event: {type}\ndata: {JSON.stringify(data)}\n\n`
- Keeps stream open via polling interval (500ms) until sync completes or client aborts.
- Cleans up listener on stream abort or sync completion.

Events emitted by `runSync()`:
- `phase`: `{ phase: "match" | "review" | "download" | "done" }`
- `match-complete`: `{ found, review, notFound }`
- `review-needed`: `{ items: [{ dbTrackId, title, artist, score, confidence, method }] }`
- `download-progress`: `{ completed, total, trackTitle, success, error }`
- `sync-complete`: `{ found, downloaded, failed, notFound }`
- `error`: `{ message }`

---

**POST `/api/sync/:syncId/review`**

Submit review decisions during sync.

- Validates sync session exists (404) and is in `"awaiting-review"` status (400).
- Request body: `{ decisions: Array<{ dbTrackId: string, accepted: boolean }> }`
- Sets `state.reviewDecisions = decisions`, changes status to `"running"`.
- Response: `{ ok: true }`

---

**GET `/api/sync/:syncId`**

Get sync status.

- Response: `{ syncId, playlistId, status, eventCount }`

---

**Internal helpers** in sync.ts:

- `pushEvent(syncId, type, data)`: appends to `state.events`, calls all listeners (fire-and-forget with `.catch(() => {})`).
- `runSync(syncId, playlistId, config)`: orchestrates Phase 1 (match) -> optional review pause -> Phase 3 (download) -> done. On error, pushes error event and sets status to "error".

The `runSync()` review-wait mechanism: sets `state.status = "awaiting-review"`, polls every 500ms checking if status changed back to `"running"` with `reviewDecisions` populated, then continues.

---

### Job Routes (`/api/jobs`)

**GET `/api/jobs`**

List jobs with filters.

- Query params: `type`, `status`, `parentJobId`, `limit` (default 100), `offset` (default 0).
- Ordered by `createdAt DESC`.
- Returns total count for pagination.
- Response: `{ jobs: FormattedJob[], total: N, limit: N, offset: N }`

---

**GET `/api/jobs/stats`**

Job statistics.

- Response: `{ byStatus: Record<status, count>, byType: Record<type, count> }`

---

**GET `/api/jobs/stream`**

SSE stream for real-time job updates.

- Subscribes to `onJobEvent()`.
- SSE format: `event: {event.type}\ndata: {JSON.stringify(event)}\n\n`
- Stream stays open until client aborts. Unsubscribes on abort.

---

**POST `/api/jobs/retry-all`**

Re-queue all failed jobs, optionally filtered by type.

- Request body: `{ type?: string }` (body parse failure defaults to `{ type: undefined }`).
- Updates all matching failed jobs: `status = "queued"`, `error = null`, `runAfter = null`.
- Response: `{ retried: N }`

---

**GET `/api/jobs/:id`**

Job detail with children.

- Fetches child jobs where `parentJobId = id`, ordered by `createdAt ASC`.
- Response: `{ ...FormattedJob, children: FormattedJob[] }`

---

**POST `/api/jobs/:id/retry`**

Re-queue a single failed job.

- Validates job exists (404) and status is "failed" (400).
- Updates: `status = "queued"`, `error = null`, `runAfter = null`.
- Response: `{ ok: true }`

---

**DELETE `/api/jobs/:id`**

Cancel a queued job.

- Validates job exists (404) and status is "queued" (400).
- Deletes the job row.
- Response: `{ ok: true }`

---

**Note on route ordering in jobs.ts**: `/stats`, `/stream`, and `/retry-all` are registered before `/:id` routes to avoid Hono matching them as an `:id` parameter.

## Error Handling

All routes follow this pattern:

| HTTP Status | Meaning | Response body |
|---|---|---|
| 400 | Validation error (missing/invalid input) | `{ error: "descriptive message" }` |
| 401 | Authentication required (Spotify not authenticated) | `{ error: "Spotify not authenticated" }` |
| 404 | Resource not found | `{ error: "{Resource} not found" }` |
| 409 | Conflict (concurrent sync) | `{ error: "Sync already in progress for this playlist" }` |
| 500 | Unhandled error (caught by Hono onError) | `{ error: "error message" }` |

The global `onError` handler in `server.ts` catches unhandled exceptions, logs them, and returns 500 with `{ error: message }`.

## Tests

### Test approach

- Create a test Hono app via `createApp()` or mount individual route modules.
- Use `app.request()` (Hono's built-in test helper) for HTTP assertions.
- Mock `getDb()` with an in-memory SQLite database.
- Mock external services (`SpotifyService`, `LexiconService`, `SoulseekService`, `SyncPipeline`, `DownloadService`, `PlaylistService`) to avoid network calls.
- For SSE tests: read the response body as a stream and parse SSE frames.

### Key test scenarios

**Playlist routes**:
- GET / returns playlists with trackCount
- POST /sync returns 400 without Spotify config, 401 without auth
- GET /duplicates returns cross-playlist duplicates
- GET /stats returns correct aggregate counts
- POST /bulk-rename in dry-run mode returns preview; in non-dry-run applies changes
- PUT /:id/rename validates name, returns 404 for missing playlist
- POST /:id/push computes diff and pushes to Spotify, handles no-changes case
- POST /:id/repair runs Phase 1 pipeline
- POST /:id/merge validates sourceIds
- GET /:id/tracks returns ordered tracks
- PATCH /:id updates tags/notes/pinned
- DELETE /:id removes playlist

**Track routes**:
- GET / with q param filters by title/artist/album; respects limit/offset
- GET /:id returns 404 for missing track
- GET /:id/lifecycle returns full lifecycle with playlists, matches, downloads, jobs

**Match routes**:
- GET / with status filter returns enriched matches (sourceTrack + targetTrack)
- GET / handles Lexicon unavailable gracefully (enriches without target)
- PUT /:id validates status values, returns 404 for missing match

**Download routes**:
- GET / filters by status and playlistId, enriched with track info
- GET /:id returns 404 for missing download

**Status routes**:
- GET / returns health + DB stats; handles DB error
- GET /config returns non-sensitive config
- PUT /config updates only safe values
- POST /spotify/login validates credentials, returns authUrl
- GET /spotify/auth-status returns authenticated and pending flags
- DELETE /spotify/login removes token file
- PUT /soulseek/connect tests connection before saving
- DELETE /soulseek/connect clears API key

**Sync routes**:
- POST /:playlistId creates sync session + job, returns syncId + jobId
- POST /:playlistId returns 409 if sync already running
- POST /:playlistId/dry-run returns PhaseOneResult
- GET /:syncId/events replays buffered events then streams new ones
- POST /:syncId/review validates awaiting-review status
- GET /:syncId returns sync status summary

**Job routes**:
- GET / with type/status/parentJobId filters, pagination
- GET /stats returns byStatus and byType aggregations
- GET /stream returns SSE job events
- POST /retry-all re-queues failed jobs, optional type filter
- GET /:id returns job with children
- POST /:id/retry validates failed status
- DELETE /:id validates queued status

## Acceptance Criteria

- [ ] 7 route modules, each exporting a single `Hono` instance
- [ ] Playlist routes: GET /, POST /sync, GET /duplicates, GET /stats, POST /bulk-rename, PUT /:id/rename, POST /:id/push, POST /:id/repair, POST /:id/merge, GET /:id/tracks, GET /:id/duplicates, GET /:id, PATCH /:id, DELETE /:id
- [ ] Track routes: GET / (with search/pagination), GET /:id, GET /:id/lifecycle
- [ ] Match routes: GET / (with status filter + Lexicon enrichment), PUT /:id
- [ ] Download routes: GET / (with status/playlistId filters), GET /:id
- [ ] Status routes: GET /, GET /config, PUT /config, POST /spotify/login, GET /spotify/auth-status, DELETE /spotify/login, PUT /soulseek/connect, DELETE /soulseek/connect
- [ ] Sync routes: POST /:playlistId (creates job + SSE session), POST /:playlistId/dry-run, GET /:syncId/events (SSE), POST /:syncId/review, GET /:syncId
- [ ] Job routes: GET / (filtered, paginated), GET /stats, GET /stream (SSE), POST /retry-all, GET /:id (with children), POST /:id/retry, DELETE /:id
- [ ] `syncState` map in `state.ts` for in-memory sync session management
- [ ] Static routes registered before parameterized routes in all modules
- [ ] SSE event format: `event: type\ndata: JSON\n\n`
- [ ] Consistent error responses: `{ error: string }` with appropriate HTTP status
- [ ] Services instantiated per-request, no long-lived singletons
- [ ] All enrichment queries handle missing/unavailable data gracefully
