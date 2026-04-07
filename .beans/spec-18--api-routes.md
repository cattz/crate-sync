---
# spec-18
title: API routes
status: completed
type: task
priority: critical
parent: spec-E4
depends_on: spec-06, spec-07, spec-08, spec-09, spec-10, spec-11, spec-12, spec-13, spec-14, spec-15, spec-16
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Purpose

Eight Hono route modules provide the full REST API surface for the web frontend and CLI. Routes are thin orchestration layers that instantiate services per-request, validate input, call service methods, and return JSON responses. Two modules include SSE streaming (sync events and job updates). All routes follow a consistent error format (`{ error: string }` with HTTP status code) and obey Hono's static-before-parameterized ordering rule.

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

// review.ts
export const reviewRoutes: Hono
```

### Shared state module (`src/api/state.ts`)

```ts
export interface SyncEvent {
  type: string;
  data: unknown;
}

export type SyncStatus = "running" | "done" | "error";

export interface SyncState {
  playlistId: string;
  status: SyncStatus;
  events: SyncEvent[];
  listeners: Set<(event: SyncEvent) => Promise<void>>;
}

/** Active sync sessions keyed by syncId. */
export const syncState: Map<string, SyncState>
```

Note: `SyncStatus` no longer includes `"awaiting-review"` — the sync pipeline is non-blocking and review happens asynchronously.

## Dependencies

### By route file

| Route file | Key imports |
|---|---|
| `playlists.ts` | `Hono`, `loadConfig`, `getDb`, `PlaylistService`, `SpotifyService`, `SyncPipeline`, schema (`playlists`, `playlistTracks`, `tracks`), `eq`, `sql` |
| `tracks.ts` | `Hono`, `getDb`, schema (`tracks`, `matches`, `downloads`, `jobs`, `playlistTracks`, `playlists`, `rejections`), `eq`, `like`, `or`, `and`, `desc`, `sql` |
| `matches.ts` | `Hono`, `getDb`, schema (`matches`, `tracks`, `downloads`), `eq`, `and`, `sql`, `loadConfig`, `LexiconService`, `createJob` |
| `downloads.ts` | `Hono`, `getDb`, schema (`downloads`, `tracks`), `eq`, `desc` |
| `status.ts` | `Hono`, `loadConfig`, `saveConfig`, `Config`, `checkHealth`, `SpotifyService`, `waitForAuthCallback`, `SoulseekService`, `getDb`, schema (`playlists`, `tracks`, `matches`, `downloads`), `sql` |
| `sync.ts` | `Hono`, `streamSSE`, `crypto`, `getDb`, `PlaylistService`, `loadConfig`, `Config`, `SyncPipeline`, `syncState`, `createJob` |
| `jobs.ts` | `Hono`, `streamSSE`, `eq`, `and`, `desc`, `asc`, `sql`, `getDb`, schema (`jobs`), `onJobEvent` |
| `review.ts` | `Hono`, `getDb`, `ReviewService`, `loadConfig`, schema (`matches`, `tracks`), `eq`, `and` |

### Helper patterns

**`getService()`** (playlists.ts only): factory function that returns `new PlaylistService(getDb())`. Called per-request.

**`formatJob(job)`** (jobs.ts only): parses `job.payload` and `job.result` from JSON strings to objects (or null).

## Behavior

### Playlist Routes (`/api/playlists`)

Route ordering: literal routes first (`/sync`, `/bulk-rename`), then `:id/subpath` routes, then bare `:id` routes last.

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

**POST `/api/playlists/bulk-rename`**

Bulk rename playlists.

- Request body: `{ pattern: string, replacement: string, regex?: boolean, dryRun?: boolean, pushToSpotify?: boolean }`
- Validation: `pattern` required (400).
- If `regex` is true: uses `new RegExp(pattern)` for matching, `name.replace(re, replacement)`.
- If `regex` is false (default): uses `name.split(pattern).join(replacement ?? "")`.
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

**GET `/api/playlists/:id/tracks`**

Get tracks for a playlist.

- Response: track array from `svc.getPlaylistTracks()`.

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

- Response: `{ track, playlists: [{playlistId, position, playlistName}], matches: Match[], downloads: Download[], jobs: Job[], rejections: Rejection[] }`
- Playlists: inner join playlistTracks + playlists.
- Matches: where sourceType="spotify" and sourceId=trackId.
- Downloads: where trackId matches, ordered by createdAt desc.
- Jobs: where `json_extract(payload, '$.trackId') = trackId`, ordered by createdAt desc. Payload and result fields parsed from JSON.
- Rejections: where trackId matches, ordered by createdAt desc.

---

**GET `/api/tracks/:id/rejections`**

Rejection history for a track.

- Response: `Rejection[]` where `trackId` matches, ordered by `createdAt DESC`.
- Includes both Soulseek download rejections (from `rejections` table) and Lexicon match rejections (from `matches` table where `status = "rejected"` and `sourceId = trackId`).

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
- **On rejection**: auto-queues a download by creating a `search` job for the source track: `{ type: "search", status: "queued", priority: 3, payload: { trackId, playlistId, title, artist, album, durationMs, queryIndex: 0 } }`.
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
- Updates only: `matching.autoAcceptThreshold`, `matching.reviewThreshold`, `download.formats`, `download.minBitrate`, `download.concurrency`, `download.validationStrictness`.
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

Start a full sync via job queue.

- Validates playlist exists (404).
- Prevents concurrent syncs for the same playlist (409 if already running).
- Creates `syncState` entry with `status: "running"`.
- Creates root `spotify_sync` job via `createJob()` with `priority: 10`.
- Non-blocking — sync runs asynchronously via job queue. No blocking review step.
- Response: `{ syncId: string, jobId: string }`

---

**POST `/api/sync/:playlistId/dry-run`**

Match phase only, returns JSON.

- Creates `SyncPipeline(config)`, calls `matchPlaylist()`.
- Response: match result with confirmed/pending/notFound counts.

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

Events emitted:
- `phase`: `{ phase: "match" | "download" | "done" }`
- `match-complete`: `{ confirmed, pending, notFound }`
- `download-progress`: `{ completed, total, trackTitle, success, error }`
- `sync-complete`: `{ confirmed, pending, downloaded, failed, notFound }`
- `error`: `{ message }`

Note: no `"review"` phase or `"review-needed"` event — review is async and decoupled from the sync session.

---

**GET `/api/sync/:syncId`**

Get sync status.

- Response: `{ syncId, playlistId, status, eventCount }`

---

**Internal helpers** in sync.ts:

- `pushEvent(syncId, type, data)`: appends to `state.events`, calls all listeners (fire-and-forget with `.catch(() => {})`).

---

### Review Routes (`/api/review`) — NEW

**GET `/api/review`**

List pending review items.

- Query param: `playlistId` (optional filter to scope to a single playlist).
- Uses `ReviewService.getPending(playlistId?)`.
- Enriches each match with source track info (title, artist, album) and target Lexicon track info when available.
- Response: `Array<Match & { sourceTrack, targetTrack }>`

---

**POST `/api/review/:id/confirm`**

Confirm a pending match.

- Validates match exists (404) and status is "pending" (400).
- Calls `ReviewService.confirm(id)`.
- Response: `{ ok: true, match: Match }`

---

**POST `/api/review/:id/reject`**

Reject a pending match — auto-queues download.

- Validates match exists (404) and status is "pending" (400).
- Calls `ReviewService.reject(id)` which sets status to "rejected" and creates a `search` job for the source track.
- Response: `{ ok: true, match: Match, downloadQueued: true }`

---

**POST `/api/review/bulk`**

Bulk review action.

- Request body: `{ matchIds: string[], action: "confirm" | "reject" }`
- Validates `matchIds` non-empty (400), `action` valid (400).
- Calls `ReviewService.bulkConfirm(matchIds)` or `ReviewService.bulkReject(matchIds)`.
- Response: `{ ok: true, processed: N }`

---

**GET `/api/review/stats`**

Review queue statistics.

- Calls `ReviewService.getStats()`.
- Response: `{ pending: N, confirmed: N, rejected: N, byPlaylist: Array<{ playlistId, playlistName, pending: N }> }`

---

### Wishlist Routes (`/api/wishlist`)

**POST `/api/wishlist/run`**

Manually trigger a wishlist run.

- Creates a `wishlist_run` job via `createJob()` with `priority: -1`.
- Response: `{ ok: true, jobId: string }`

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
- Mock external services (`SpotifyService`, `LexiconService`, `SoulseekService`, `SyncPipeline`, `DownloadPipeline`, `PlaylistService`, `ReviewService`) to avoid network calls.
- For SSE tests: read the response body as a stream and parse SSE frames.

### Key test scenarios

**Playlist routes**:
- GET / returns playlists with trackCount
- POST /sync returns 400 without Spotify config, 401 without auth
- POST /bulk-rename with regex=true uses RegExp; dryRun returns preview; non-dry-run applies changes
- PUT /:id/rename validates name, returns 404 for missing playlist
- POST /:id/push computes diff and pushes to Spotify, handles no-changes case
- GET /:id/tracks returns ordered tracks
- PATCH /:id updates tags/notes/pinned
- DELETE /:id removes playlist

**Track routes**:
- GET / with q param filters by title/artist/album; respects limit/offset
- GET /:id returns 404 for missing track
- GET /:id/lifecycle returns full lifecycle with playlists, matches, downloads, jobs, rejections
- GET /:id/rejections returns combined rejection history

**Match routes**:
- GET / with status filter returns enriched matches (sourceTrack + targetTrack)
- GET / handles Lexicon unavailable gracefully (enriches without target)
- PUT /:id validates status values, returns 404 for missing match
- PUT /:id with status "rejected" auto-queues search job for the source track

**Download routes**:
- GET / filters by status and playlistId, enriched with track info
- GET /:id returns 404 for missing download

**Status routes**:
- GET / returns health + DB stats; handles DB error
- GET /config returns non-sensitive config
- PUT /config updates only safe values (including validationStrictness)
- POST /spotify/login validates credentials, returns authUrl
- GET /spotify/auth-status returns authenticated and pending flags
- DELETE /spotify/login removes token file
- PUT /soulseek/connect tests connection before saving
- DELETE /soulseek/connect clears API key

**Sync routes**:
- POST /:playlistId creates sync session + job, returns syncId + jobId
- POST /:playlistId returns 409 if sync already running
- POST /:playlistId/dry-run returns match results
- GET /:syncId/events replays buffered events then streams new ones
- GET /:syncId returns sync status summary

**Review routes**:
- GET / returns pending matches, optional playlistId filter
- GET / enriches with source and target track info
- POST /:id/confirm validates pending status, confirms match
- POST /:id/reject validates pending status, rejects match, queues download
- POST /bulk with action "confirm" confirms all specified matches
- POST /bulk with action "reject" rejects all and queues downloads
- GET /stats returns pending/confirmed/rejected counts and per-playlist breakdown

**Wishlist routes**:
- POST /api/wishlist/run creates wishlist_run job

**Job routes**:
- GET / with type/status/parentJobId filters, pagination
- GET /stats returns byStatus and byType aggregations
- GET /stream returns SSE job events
- POST /retry-all re-queues failed jobs, optional type filter
- GET /:id returns job with children
- POST /:id/retry validates failed status
- DELETE /:id validates queued status

## Acceptance Criteria

- [ ] 8 route modules, each exporting a single `Hono` instance
- [ ] Playlist routes: GET /, POST /sync, POST /bulk-rename, PUT /:id/rename, POST /:id/push, GET /:id/tracks, GET /:id, PATCH /:id, DELETE /:id
- [ ] Track routes: GET / (with search/pagination), GET /:id, GET /:id/lifecycle (includes rejections), GET /:id/rejections
- [ ] Match routes: GET / (with status filter + Lexicon enrichment), PUT /:id (rejection auto-queues download)
- [ ] Download routes: GET / (with status/playlistId filters), GET /:id
- [ ] Status routes: GET /, GET /config, PUT /config, POST /spotify/login, GET /spotify/auth-status, DELETE /spotify/login, PUT /soulseek/connect, DELETE /soulseek/connect
- [ ] Sync routes: POST /:playlistId (non-blocking, creates job), POST /:playlistId/dry-run, GET /:syncId/events (SSE), GET /:syncId
- [ ] Review routes: GET / (with optional playlistId filter), POST /:id/confirm, POST /:id/reject (auto-queues download), POST /bulk, GET /stats
- [ ] Wishlist route: POST /api/wishlist/run creates wishlist_run job
- [ ] Job routes: GET / (filtered, paginated), GET /stats, GET /stream (SSE), POST /retry-all, GET /:id (with children), POST /:id/retry, DELETE /:id
- [ ] `syncState` map in `state.ts` for in-memory sync session management — no "awaiting-review" status
- [ ] Static routes registered before parameterized routes in all modules
- [ ] SSE event format: `event: type\ndata: JSON\n\n`
- [ ] Consistent error responses: `{ error: string }` with appropriate HTTP status
- [ ] Services instantiated per-request, no long-lived singletons
- [ ] All enrichment queries handle missing/unavailable data gracefully
- [ ] Removed endpoints: no `/playlists/duplicates`, `/playlists/similar`, `/playlists/stats`, `/playlists/:id/merge`, `/playlists/:id/duplicates`, `/playlists/:id/repair`
- [ ] No blocking review step in sync flow — review is fully async via `/api/review`
