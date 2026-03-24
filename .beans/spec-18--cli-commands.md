---
# spec-18
title: CLI commands
status: todo
type: task
priority: high
parent: spec-E4
depends_on: spec-09, spec-12, spec-14, spec-15, spec-05
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

# CLI Commands

## Purpose

Define every CLI command registered by `crate-sync`, including its arguments, options, service calls, output formatting, interactive prompts, and error handling. This spec is the single source of truth for re-implementing all command handlers in `src/commands/`.

---

## Public Interface

### Command Tree

```
crate-sync [--debug] <command>

  status                          Check connectivity to all external services
  auth login                      Start Spotify OAuth flow
  auth status                     Show authentication status
  db sync                         Sync Spotify playlists to local DB
  db status                       Show database statistics
  playlists list                  List playlists from local DB
  playlists show <id>             Show playlist details and tracks
  playlists rename <id> <name>    Rename a playlist
  playlists merge <ids...>        Merge multiple playlists into one
  playlists dupes [id]            Find duplicate tracks
  playlists delete <id>           Delete a playlist
  playlists repair <id>           Fix broken/unplayable tracks
  playlists push [id]             Push local playlist changes back to Spotify
  lexicon status                  Test Lexicon connection
  lexicon match <playlist>        Match playlist tracks against Lexicon library
  lexicon sync <playlist>         Sync matched tracks to a Lexicon playlist
  download search <query>         Search Soulseek for a track
  download playlist <id>          Download missing tracks for a playlist
  download resume                 Resume pending or failed downloads
  matches list                    List matches from the database
  matches confirm <id>            Confirm a match
  matches reject <id>             Reject a match
  review                          Interactively review pending matches
  sync [playlist]                 Run the full sync pipeline for a playlist
  serve                           Start the web UI API server with job runner
  jobs list                       List jobs
  jobs retry <id>                 Re-queue a failed job
  jobs retry-all                  Re-queue all failed jobs
  jobs stats                      Show job statistics
  wishlist run                    Manually trigger a wishlist scan
```

---

## Behavior

### `status` (top-level, defined in index.ts)

- **Description:** Check connectivity to all external services.
- **Arguments:** None.
- **Options:** None.
- **Service calls:** `loadConfig()`, `checkHealth(config)`, `getDb()`, `sql count(*)` on `playlists` and `tracks` tables.
- **Output format:**
  - One line per service: `  Spotify     {green checkmark} Authenticated` or `  Spotify     {red X} {error}`.
  - Services checked: Spotify, Lexicon (shows URL), Soulseek (shows URL), Database (shows playlist + track counts).
- **Error handling:** Wraps in try/catch; prints `chalk.red("Status check failed: {message}")`.

---

### `auth login`

- **Description:** Start Spotify OAuth flow.
- **Arguments:** None.
- **Options:** None.
- **Service calls:** `loadConfig()`, `getConfigPath()`, `new SpotifyService(config.spotify)`, `spotify.getAuthUrl(state)`, `waitForAuthCallback(port)`, `spotify.exchangeCode(code)`.
- **Output format:**
  - If missing credentials: prints `chalk.red("Missing Spotify credentials.")` + dim config path + example JSON config.
  - Otherwise: prints bold "Spotify Authorization", the auth URL in `chalk.cyan`, dim "Waiting for callback on port {port}...".
  - On success: `chalk.green("Authenticated successfully!")` + dim "Tokens saved."
- **Error handling:** `chalk.red("Login failed: {message}")`.

### `auth status`

- **Description:** Show authentication status.
- **Arguments:** None.
- **Options:** None.
- **Service calls:** `loadConfig()`, `getConfigPath()`, `new SpotifyService(config.spotify)`, `spotify.isAuthenticated()`.
- **Output format:**
  - Bold "Spotify Auth Status" header.
  - `  Client ID      {green "configured"} | {red "missing"}`.
  - `  Client Secret  {green "configured"} | {red "missing"}`.
  - `  Redirect URI   {dim value}`.
  - `  Authenticated  {green "yes"} | {red "no"}`.
  - If missing creds: dim config path.
  - If not authenticated but creds present: dim hint to run `crate-sync auth login`.
- **Error handling:** `chalk.red("Failed to check auth status: {message}")`.

---

### `db sync`

- **Description:** Sync Spotify playlists to local DB.
- **Arguments:** None.
- **Options:** None.
- **Service calls:** `loadConfig()`, `new SpotifyService(config.spotify)`, `spotify.isAuthenticated()`, `spotify.syncToDb()`, `getDb()`, `db.select().from(schema.playlists).all()`, `spotify.syncPlaylistTracks(pl.spotifyId!)`, `isShutdownRequested()`.
- **Output format:**
  - Dim "Syncing playlists from Spotify...".
  - Bold "Playlist sync complete" with added (green), updated (yellow), unchanged (dim).
  - Dim "Syncing tracks for {N} playlist(s)...".
  - Progress bar (Progress utility) per playlist: shows playlist name (truncated to 30 chars) + `+{added}/{~updated}` or error message.
  - Final `chalk.green("Sync complete.")`.
- **Shutdown handling:** Checks `isShutdownRequested()` in loop; prints yellow "Shutdown requested, stopping playlist sync." and breaks.
- **Error handling:**
  - Not authenticated: `chalk.red("Not authenticated. Run 'crate-sync auth login' first.")`.
  - Top-level: `chalk.red("Sync failed: {message}")`.
  - Per-playlist errors are shown inline in progress output.

### `db status`

- **Description:** Show database statistics.
- **Arguments:** None.
- **Options:** None.
- **Service calls:** `getDb()`, `count()` on `playlists`, `tracks`, `matches`, `downloads` tables.
- **Output format:**
  - Bold "Database Status" header.
  - `  Playlists   {cyan count, right-padded 6}`.
  - `  Tracks      {cyan count}`.
  - `  Matches     {cyan count}`.
  - `  Downloads   {cyan count}`.

---

### `playlists list`

- **Description:** List playlists from local DB.
- **Arguments:** None.
- **Options:** None.
- **Service calls:** `getDb()`, `new PlaylistService(db)`, `service.getPlaylists()`, `service.getPlaylistTracks(row.id)` per row.
- **Output format:**
  - Table with columns: ID (8 chars), Name (40 chars), Tracks (8 chars), Last Synced (20 chars).
  - Bold header + dim separator line.
  - ID shown as first 8 chars of UUID in dim. Name truncated to 40 chars. Track count in cyan right-aligned. Synced formatted as `YYYY-MM-DDTHH:MM` or dim "never".
  - Footer: dim "{N} playlist(s)".
- **Empty state:** Dim "No playlists in database. Run `crate-sync db sync` first."

### `playlists show <id>`

- **Description:** Show playlist details and tracks.
- **Arguments:** `<id>` -- playlist ID (UUID, spotify ID, or name match via service).
- **Options:** None.
- **Service calls:** `PlaylistService.getPlaylist(id)`, `PlaylistService.getPlaylistTracks(id)`.
- **Output format:**
  - Bold playlist name.
  - Metadata: ID (dim), Spotify ID (dim or dash), Description (dim, if exists), Tracks (cyan), Last Synced.
  - Track table with columns: # (4 chars, right-aligned), Title (35), Artist (25, dim), Album (20, dim).
  - Bold header + dim separator line.
- **Error handling:** `chalk.red("Playlist not found: {id}")` + dim hint.

### `playlists rename <id> <name>`

- **Description:** Rename a playlist.
- **Arguments:** `<id>`, `<name>`.
- **Options:** `--push` -- Also rename on Spotify.
- **Service calls:** `PlaylistService.getPlaylist(id)`, `PlaylistService.renamePlaylist(id, name)`, optionally `SpotifyService.renamePlaylist(spotifyId, name)`.
- **Output format:**
  - `chalk.green('Renamed "{oldName}" -> "{name}" in local DB.')`.
  - With `--push`: `chalk.green("Renamed on Spotify.")`.
- **Error handling:**
  - Playlist not found: red + dim hint.
  - `--push` without Spotify ID: yellow warning.
  - `--push` not authenticated: red + dim hint.

### `playlists merge <ids...>`

- **Description:** Merge multiple playlists into one.
- **Arguments:** `<ids...>` -- variadic, at least 2 playlist IDs.
- **Options:** `--target <id>` -- Playlist to merge into (default: first one). `--name <name>` -- Create a new playlist with this name instead.
- **Service calls:** `PlaylistService.getPlaylist()` per ID, `PlaylistService.getPlaylistTracks()`, `PlaylistService.createPlaylist(name)` (if `--name`), `PlaylistService.mergePlaylistTracks(targetId, sourceIds)`.
- **Output format:**
  - Bold "Merging {N} playlists" with dim total/unique track counts.
  - Lists each source playlist with name (cyan) + track count.
  - Dim "Creating new playlist" or "Merging into".
  - Green "Done." with cyan added count, dim duplicates skipped, bold final track count.
- **Error handling:** Needs at least 2 IDs; each playlist not found prints red.

### `playlists dupes [id]`

- **Description:** Find duplicate tracks.
- **Arguments:** `[id]` -- optional playlist ID.
- **Options:** None.
- **Service calls:** If `id`: `PlaylistService.getPlaylist(id)`, `PlaylistService.findDuplicatesInPlaylist(id)`. Else: `PlaylistService.findDuplicatesAcrossPlaylists()`.
- **Output format:**
  - **Within playlist:** Bold "Duplicates in {name}". Each group: track title (cyan) + artist (dim) + yellow copy count. Footer: dim "{N} duplicate group(s) found."
  - **Across playlists:** Bold "Tracks in multiple playlists". Each: track (cyan) + artist (dim), then indent with dim "in:" + playlist names. Footer: dim "{N} track(s) found."
  - Green message if no duplicates.

### `playlists delete <id>`

- **Description:** Delete a playlist.
- **Arguments:** `<id>`.
- **Options:** `--spotify` -- Also delete (unfollow) on Spotify.
- **Interactive prompt:** Uses `readline.createInterface` to ask `Delete playlist "{name}" with {N} tracks? [y/N]`. Only proceeds on `y`.
- **Service calls:** `PlaylistService.getPlaylist(id)`, `PlaylistService.getPlaylistTracks(id)`, `PlaylistService.removePlaylist(id)`, optionally `SpotifyService.deletePlaylist(spotifyId)`.
- **Output format:**
  - Yellow confirmation prompt.
  - On cancel: dim "Cancelled."
  - Green "Deleted {name} from local DB."
  - With `--spotify`: green "Unfollowed on Spotify."
- **Error handling:** Not found, no Spotify ID for `--spotify`, not authenticated.

### `playlists repair <id>`

- **Description:** Fix broken/unplayable tracks by re-matching against Lexicon.
- **Arguments:** `<id>`.
- **Options:** `--download` -- Download missing tracks via Soulseek.
- **Service calls:** `PlaylistService.getPlaylist(id)`, `new SyncPipeline(config, { db })`, `pipeline.matchPlaylist(playlistId)`, optionally `pipeline.applyReviewDecisions(result, [])`, `pipeline.downloadMissing(phaseTwo, playlistName, callback)`.
- **Output format:**
  - Bold "Repairing {name}..."
  - Phase 1 results: green OK count, yellow review count (if any), red missing count, dim total.
  - "Needs review:" section with yellow `?` prefix per track + dim score.
  - "Not found in Lexicon:" section with red `x` prefix per track.
  - With `--download`: downloads with `v` (green) or `x` (red) per track + counts.
  - Without `--download` and missing tracks: dim hint about `--download` flag.

### `playlists push [id]`

- **Description:** Push local playlist changes back to Spotify.
- **Arguments:** `[id]` -- optional playlist ID.
- **Options:** `--all` -- Push all playlists.
- **Service calls:** `SpotifyService.isAuthenticated()`, `PlaylistService.getPlaylists()` or `getPlaylist(id)`, `spotify.getPlaylistTracks(spotifyId)`, `PlaylistService.getPlaylistDiff(id, spotifyTracks)`, `spotify.getPlaylists()`, `spotify.renamePlaylist()`, `spotify.removeTracksFromPlaylist()`, `spotify.addTracksToPlaylist()`, `PlaylistService.updateSnapshotId()`.
- **Output format:**
  - Bold "Pushing {N} playlist(s) to Spotify..."
  - Per playlist: dim "no changes" or cyan name with indented green/yellow actions (renamed, removed, added).
  - Final green "Done."
- **Error handling:** Must provide ID or `--all`. Not authenticated. Per-playlist errors shown in red.

---

### `lexicon status`

- **Description:** Test Lexicon connection.
- **Arguments:** None.
- **Options:** None.
- **Service calls:** `loadConfig()`, `new LexiconService(config.lexicon)`, `service.ping()`.
- **Output format:**
  - Dim "Connecting to {url}..."
  - Green "Lexicon is reachable." or red "Could not connect to Lexicon." + dim hint.
- **Error handling:** `chalk.red("Connection failed: {message}")`.

### `lexicon match <playlist>`

- **Description:** Match playlist tracks against Lexicon library.
- **Arguments:** `<playlist>` -- resolved by ID, spotify ID, or name (case-insensitive).
- **Options:** None.
- **Service calls:** `checkHealth(config)`, `PlaylistService.getPlaylist()` (with name fallback), `new SyncPipeline(config)`, `pipeline.matchPlaylist(id)`.
- **Output format:**
  - Checks Lexicon health first; prints red if not available.
  - Bold "Matching {name} against Lexicon library..."
  - Bold "Match results": Total (cyan), Found (green), Needs review (yellow), Not found (red).
  - "Needs review:" section with yellow percentage + track info.
  - "Not found:" section with red `x` prefix.
- **Error handling:** `chalk.red("Match failed: {message}")`.

### `lexicon sync <playlist>`

- **Description:** Sync matched tracks to a Lexicon playlist.
- **Arguments:** `<playlist>`.
- **Options:** None.
- **Note:** Currently a stub. Prints `chalk.yellow("Not yet implemented.")` + dim explanation.

---

### `download search <query>`

- **Description:** Search Soulseek for a track.
- **Arguments:** `<query>` -- free-text search string.
- **Options:** None.
- **Service calls:** `loadConfig()`, `new SoulseekService(config.soulseek)`, `soulseek.search(query)`.
- **Output format:**
  - Checks for slskd API key; prints red + dim hint if missing.
  - Dim "Searching Soulseek for {query}..."
  - Table: Filename (50 chars, last path component), User (16), Size (10, in MB), BR (6, bitrate).
  - Shows top 25 results.
  - Footer: dim "{N} result(s) total, showing top {M}."
  - Yellow "No results found." if empty.
- **Error handling:** `chalk.red("Search failed: {message}")`.

### `download playlist <id>`

- **Description:** Download missing tracks for a playlist.
- **Arguments:** `<id>` -- resolved by ID, spotify ID, or name.
- **Options:** None.
- **Service calls:** `PlaylistService.getPlaylist()` (with name fallback), `PlaylistService.getPlaylistTracks()`, `new SyncPipeline(config)`, `pipeline.matchPlaylist(id)`, `checkHealth(config)`, `new DownloadService(config.soulseek, config.download, config.lexicon)`, `downloadService.downloadBatch(items, callback)`, `db.insert(schema.downloads)` per result.
- **Output format:**
  - Dim "Matching tracks in {name} against Lexicon..."
  - Summary: Total (cyan), Already in Lexicon (green), To download (yellow).
  - Green "All tracks are already in Lexicon." if nothing to download.
  - Checks Soulseek health; red if not available.
  - Progress bar during download: green "done" or red "fail" per track with artist/title.
  - Bold "Download complete" with green downloaded + red failed counts.
- **Error handling:** `chalk.red("Download failed: {message}")`.

### `download resume`

- **Description:** Resume pending or failed downloads.
- **Arguments:** None.
- **Options:** None.
- **Service calls:** `getDb()`, queries `downloads` where status in `["pending", "failed"]`, queries `tracks` and `playlists` for metadata, `new SoulseekService(config.soulseek)`, `soulseek.ping()`, `new DownloadService(...)`, `downloadService.downloadBatch()`, `db.update(schema.downloads)` per result.
- **Output format:**
  - Green "No pending or failed downloads to resume." if empty.
  - Dim "Resuming {N} download(s)..."
  - Checks slskd reachability; red if unreachable.
  - Progress bar: green "done" / red "fail" per track.
  - Bold "Resume complete" with succeeded + failed counts.
- **Error handling:** `chalk.red("Resume failed: {message}")`.

---

### `matches list`

- **Description:** List matches from the database.
- **Arguments:** None.
- **Options:** `-s, --status <status>` -- Filter by status (pending|confirmed|rejected).
- **Service calls:** `getDb()`, queries `matches` table with optional `where` clause.
- **Output format:**
  - Table: ID (8 chars, cyan), Source (10), Target (10), Score (6, right-aligned), Conf (8, color-coded: high=green, low=red, else yellow), Status (10, color-coded: confirmed=green, rejected=red, pending=yellow), Method (8, dim).
  - Footer: dim "{N} match(es)".
- **Empty state:** Dim "No matches found."

### `matches confirm <id>`

- **Description:** Confirm a match.
- **Arguments:** `<id>` -- prefix-matched against all match IDs.
- **Options:** None.
- **Service calls:** `getDb()`, fetches all matches, finds one with `id.startsWith(id)`, updates status to "confirmed".
- **Output format:** `chalk.green("Match {shortId} confirmed.")`.
- **Error handling:** `chalk.red('No match found with ID starting with "{id}".')`.

### `matches reject <id>`

- **Description:** Reject a match.
- **Arguments:** `<id>` -- prefix-matched.
- **Options:** None.
- **Service calls:** Same as confirm but sets status to "rejected".
- **Output format:** `chalk.green("Match {shortId} rejected.")`.

---

### `review`

- **Description:** Interactively review pending matches.
- **Arguments:** None.
- **Options:** None.
- **Service calls:** `getDb()`, queries `matches` where `status="pending" AND sourceType="spotify" AND targetType="lexicon"`, `loadConfig()`, `new LexiconService(config.lexicon)`, `lexicon.getTracks()` to enrich targets, `db.select().from(schema.tracks)` for source enrichment, `db.update(schema.matches)` per decision.
- **Interactive prompts:** Uses `createInterface({ input: stdin, output: stdout })`.
  - Per match: `Accept? (y/n/a=all/q=quit/s=skip):`.
  - `y` = confirm, `n` = reject, `a` = accept this + all remaining, `q` = quit (stop iteration), `s` = skip (leave pending).
- **Output format:**
  - Header: bold "{N} pending match(es) to review".
  - Dim "Fetching Lexicon library..." + dim loaded count.
  - Per match: bold `[{i}/{total}] Match at {yellow score%} ({method})`.
  - Source info (cyan "Spotify:" label): artist, title, album (dim), duration (dim), ISRC (dim).
  - Target info (magenta "Lexicon:" label): artist, title, album (dim), duration (dim), file path (dim).
  - Final summary: "Confirmed {green N}, rejected {red N}".
- **Helper:** `formatDuration(ms)` converts milliseconds to `M:SS` format.
- **Lexicon unavailable:** Yellow warning, target details will be limited (shows raw ID instead).

---

### `sync [playlist]`

- **Description:** Run the full sync pipeline for a playlist.
- **Arguments:** `[playlist]` -- optional playlist name/ID.
- **Options:**
  - `--all` -- Sync all playlists.
  - `--dry-run` -- Show what would happen without making changes.
  - `--tags` -- Sync Spotify playlist name segments as Lexicon custom tags.
  - `--verbose` -- Show per-track search diagnostics (query strategies, candidate counts).
  - `--standalone` -- Force standalone mode (skip server detection).
  - `--server <url>` -- Server URL to connect to (default: `http://localhost:3100`).

#### Thin-Client Mode

When `--standalone` is NOT set, the command first attempts to detect a running crate-sync server:

1. Calls `tryDetectServer(opts.server)` which sends `GET {serverUrl}/api/status` with a 2s timeout.
2. If server detected: prints dim "Server detected at {url} -- using thin-client mode" + hint about `--standalone`.
3. Resolves playlists locally, then for each playlist calls `runThinClientSync(serverUrl, playlistId, playlistName, opts)`.

**`runThinClientSync` behavior:**
- **Dry run:** `POST /api/sync/{playlistId}/dry-run`, prints match summary.
- **Full sync:** `POST /api/sync/{playlistId}`, receives `{ syncId }`, then connects to SSE at `GET /api/sync/{syncId}/events`.
- **SSE event handling:**
  - `phase`: prints cyan phase label ("Phase 1 -- Match", "Phase 2 -- Review", "Phase 3 -- Download").
  - `match-complete`: prints total/found/review/notFound summary.
  - `review-needed`: calls `promptReviewDecisions(items)` interactively, then POSTs decisions to `POST /api/sync/{syncId}/review`.
  - `download-progress`: prints green checkmark or red X per track with progress `[{completed}/{total}]`.
  - `sync-complete`: prints download summary + green "Sync pipeline complete." and stops SSE.
  - `error`: prints red error and stops SSE.
- **SSE parsing:** Manual chunked reader with `eventRes.body.getReader()`, parses `event:` and `data:` lines from buffer.

**`promptReviewDecisions` interactive prompt:**
- Same `y/n/a/q` pattern as standalone review.
- Shows track title, artist, confidence, method per item.

#### Standalone Mode

Falls through to standalone when `--standalone` is set or no server detected:

1. **Pre-flight health checks:** Warns (yellow) if Lexicon or Soulseek unavailable.
2. **Playlist resolution:** By ID, spotify ID, or name (case-insensitive). With `--all`, syncs all playlists.
3. **Per playlist:**
   - **Dry run:** `pipeline.dryRun(playlistId)`, prints phase-one summary.
   - **Phase 1 -- Match:** `pipeline.matchPlaylist(playlistId)`, prints summary.
   - **Phase 2 -- Review:** Interactive review with `y/n/a/q` prompts. Shows Spotify vs Lexicon side-by-side: artist, title, album (dim), duration (dim). Prints accepted/rejected counts.
   - **Phase 3 -- Download:** Interactive download review (`downloadReview` callback): shows "Looking for" vs "Found" with file details (filename, bitrate, duration). Accepts `y/n/a/q`. Downloads with progress callback showing checkmark/X per track. With `--verbose`: prints strategy, strategy log (label, query, result count), top 3 candidates with scores.
   - **Sync to Lexicon:** `pipeline.syncToLexicon(playlistId, name, matchedIds)`.
   - **Tag sync:** If `--tags`, `pipeline.syncTags(name, confirmed)`.
4. Final green "Sync pipeline complete."

- **Error handling:** `chalk.red("Sync failed: {message}")`.
- **Service calls:** `loadConfig()`, `getDb()`, `PlaylistService`, `SyncPipeline`, `checkHealth()`.

---

### `serve`

- **Description:** Start the web UI API server with job runner.
- **Arguments:** None.
- **Options:**
  - `-p, --port <port>` -- Port to listen on (default: `"3100"`).
  - `--no-jobs` -- Disable the background job runner.
- **Service calls:** `loadConfig()`, `startServer(port)`, `startJobRunner(config)`, `onShutdown(stopJobRunner)`.
- **Behavior:**
  - Always starts the HTTP server on specified port via `startServer(port)`.
  - Unless `--no-jobs` is passed, starts the background job runner and registers its cleanup on shutdown.
  - The `opts.jobs !== false` check handles Commander's boolean negation pattern where `--no-jobs` sets `opts.jobs = false`.

---

### `jobs list`

- **Description:** List jobs.
- **Arguments:** None.
- **Options:**
  - `--status <status>` -- Filter by status (queued/running/done/failed).
  - `--type <type>` -- Filter by type (spotify_sync/match/search/download/...).
  - `--limit <n>` -- Max results (default: `"20"`).
- **Service calls:** `getDb()`, queries `jobs` table with optional `where` conditions, `orderBy desc(createdAt)`, `.limit(limit)`. Also queries aggregate stats `groupBy status`.
- **Output format:**
  - Dim header: `ID(10) TYPE(14) STATUS(9) ATTEMPT(9) CREATED(18) ERROR`.
  - Per row: ID (first 8 chars), type (padded 14), status (color-coded: queued=blue, running=yellow, done=green, failed=red, padded 7), attempt `{n}/{max}` (padded 9), created (formatted with `toLocaleString` month/day/hour/min, padded 18), error (dim, truncated to 60 chars).
  - Footer: dim "Total: " + status counts joined by dim commas, each color-coded.
- **Empty state:** Dim "No jobs found."

### `jobs retry <id>`

- **Description:** Re-queue a failed job.
- **Arguments:** `<id>` -- prefix-matched via `LIKE {id}%`.
- **Options:** None.
- **Service calls:** `getDb()`, queries job, validates `status === "failed"`, updates to `status: "queued", error: null, runAfter: null`.
- **Output format:** `chalk.green("Re-queued job {shortId} ({type})")`.
- **Error handling:** `chalk.red("Job not found: {id}")`, `chalk.red("Can only retry failed jobs (current: {status})")`.

### `jobs retry-all`

- **Description:** Re-queue all failed jobs.
- **Arguments:** None.
- **Options:** `--type <type>` -- Only retry jobs of this type.
- **Service calls:** `getDb()`, bulk update `jobs` where `status="failed"` (+ optional type filter) to `status: "queued", error: null, runAfter: null`, returns count via `.returning().all()`.
- **Output format:** `chalk.green("Re-queued {N} failed job(s)")`.

### `jobs stats`

- **Description:** Show job statistics.
- **Arguments:** None.
- **Options:** None.
- **Service calls:** `getDb()`, two `groupBy` queries on `jobs`: one by `status`, one by `type`.
- **Output format:**
  - Bold "By status:" with each status (color-coded, padded 7) + count.
  - Bold "By type:" with each type (padded 14) + count.

### `wishlist run`

- **Description:** Manually trigger a wishlist scan.
- **Arguments:** None.
- **Options:** None.
- **Note:** Registered as a top-level command `wishlist` with subcommand `run`.
- **Service calls:** `getDb()`, `db.insert(schema.jobs).values({ type: "wishlist_scan", status: "queued", priority: -1, payload: null })`.
- **Output format:** `chalk.green("Created wishlist scan job: {shortId}")` + dim "The job runner will pick it up shortly."

---

## Dependencies

- `commander` -- Command parsing and registration.
- `chalk` -- Terminal color output.
- `node:readline/promises` -- Interactive prompts (review, delete confirmation, sync review).
- `drizzle-orm` -- Database queries (`eq`, `and`, `desc`, `inArray`, `count`, `sql`).
- `src/config.js` -- `loadConfig()`, `getConfigPath()`.
- `src/db/client.js` -- `getDb()`.
- `src/db/schema.js` -- All table schemas.
- `src/services/spotify-service.js` -- `SpotifyService`.
- `src/services/spotify-auth-server.js` -- `waitForAuthCallback`.
- `src/services/playlist-service.js` -- `PlaylistService`.
- `src/services/lexicon-service.js` -- `LexiconService`.
- `src/services/soulseek-service.js` -- `SoulseekService`.
- `src/services/download-service.js` -- `DownloadService`, `DownloadReviewFn`, `DownloadCandidate`.
- `src/services/sync-pipeline.js` -- `SyncPipeline`, `PhaseOneResult`, `ReviewDecision`, `PhaseTwoResult`.
- `src/utils/progress.js` -- `Progress` utility.
- `src/utils/health.js` -- `checkHealth`.
- `src/utils/shutdown.js` -- `isShutdownRequested`, `onShutdown`.
- `src/api/server.js` -- `startServer`.
- `src/jobs/runner.js` -- `startJobRunner`, `stopJobRunner`.
- `src/commands/sync-client.js` -- `tryDetectServer`, `runThinClientSync`.

---

## Error Handling

All command actions follow a consistent pattern:
1. Wrap the entire action body in `try/catch`.
2. Extract message: `err instanceof Error ? err.message : String(err)`.
3. Print with `chalk.red("{CommandContext} failed: {message}")` or `chalk.red("Error: {message}")`.
4. For sub-operations (e.g., per-playlist in `db sync`, per-playlist in `push`), errors are caught per-iteration and reported inline without stopping the loop.

---

## Tests

### Unit Tests

- Test that each register function adds the expected command tree to a Commander program (inspect `program.commands`).
- For synchronous commands (`db status`, `matches list`, `jobs stats`): mock `getDb()` and verify correct queries and output.
- For interactive commands (`review`, `sync`, `playlists delete`): mock `readline.createInterface` and simulate user input sequences.

### Integration Tests

- With a seeded test database, verify `playlists list` output matches expected table format.
- With mocked services, verify `sync` in standalone mode progresses through phases.
- Verify `serve` calls `startServer` with correct port and conditionally starts job runner.
- Verify thin-client mode: mock `fetch` for server detection and SSE stream.

---

## Acceptance Criteria

1. Every command in the tree above is registered with the exact name, description, arguments, and options specified.
2. Output formatting matches the chalk color scheme and column widths described for each command.
3. Interactive prompts accept the documented key sequences (y/n/a/q/s) and behave correctly for each.
4. `sync` correctly detects a running server and delegates via thin-client mode, falling through to standalone when `--standalone` is set or no server is found.
5. `serve` starts the HTTP server and conditionally starts the job runner based on `--no-jobs`.
6. All error messages match the documented patterns.
7. Shutdown handling in `db sync` checks `isShutdownRequested()` and exits gracefully.
8. `matches confirm` and `matches reject` support prefix-matching on match IDs.
9. `jobs retry` supports prefix-matching on job IDs via `LIKE`.
10. `wishlist run` is registered under a top-level `wishlist` command group.
