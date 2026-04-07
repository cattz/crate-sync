---
# spec-19
title: "CLI: commands and entry point"
status: completed
type: task
priority: high
parent: spec-E4
depends_on: spec-06, spec-07, spec-08, spec-09, spec-10, spec-11, spec-12, spec-13, spec-14, spec-15, spec-16
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Purpose

Define every CLI command registered by `crate-sync`, the program entry point, global options, and process lifecycle management. This spec is the single source of truth for both the command handlers in `src/commands/` and the main `src/index.ts` entry point.

---

## Public Interface

### Entry Point (`src/index.ts`)

The built file is executed as a CLI binary with a shebang line.

```
#!/usr/bin/env node
```

#### Program Metadata

| Property    | Value                                                    |
|-------------|----------------------------------------------------------|
| name        | `"crate-sync"`                                           |
| description | `"Manage Spotify playlists and sync them with Lexicon DJ"` |
| version     | `"0.1.0"`                                                |

#### Global Option

| Option    | Description                                      |
|-----------|--------------------------------------------------|
| `--debug` | Enable debug logging to `./data/crate-sync.log`  |

The `--debug` option is handled via a Commander `preAction` hook that fires before every command action. When set:
1. Calls `setLogLevel("debug")`.
2. Calls `setLogFile("./data/crate-sync.log")`.

### Command Tree

```
crate-sync [--debug] <command>

  status                                          Check connectivity to all external services
  auth login                                      Start Spotify OAuth flow
  auth status                                     Show authentication status
  db sync                                         Sync Spotify playlists to local DB
  db status                                       Show database statistics
  playlists list                                  List playlists from local DB
  playlists show <id>                             Show playlist details and tracks
  playlists rename <id> <name>                    Rename a playlist
  playlists bulk-rename <pattern> <replacement>   Bulk rename playlists
  playlists delete <id>                           Delete a playlist
  playlists push [id]                             Push local playlist changes to Spotify
  lexicon status                                  Test Lexicon connection
  lexicon match <playlist>                        Match playlist tracks against Lexicon library
  matches list                                    List matches from the database
  matches confirm <id>                            Confirm a match
  matches reject <id>                             Reject a match
  review list                                     List pending review items
  review confirm <id>                             Confirm a pending review match
  review reject <id>                              Reject a pending review match (queues download)
  review bulk-confirm                             Bulk confirm pending matches
  review bulk-reject                              Bulk reject pending matches (queues downloads)
  sync [playlist]                                 Run the non-blocking sync pipeline
  serve                                           Start the web UI API server with job runner
  jobs list                                       List jobs
  jobs retry <id>                                 Re-queue a failed job
  jobs retry-all                                  Re-queue all failed jobs
  jobs stats                                      Show job statistics
  wishlist run                                    Manually trigger a wishlist run
```

---

## Behavior

### Entry Point Initialization

The following happens at module load time, before any command is parsed:

1. **Shutdown handler setup:** `setupShutdownHandler()` is called to register process signal handlers (SIGINT, SIGTERM).
2. **Database cleanup registration:** `onShutdown(closeDb)` ensures the SQLite database connection is closed on process exit.
3. **Log cleanup registration:** `onShutdown(closeLog)` ensures the log file handle is closed on process exit.
4. **Commander program instantiation:** `const program = new Command()`.
5. **Program configuration:** `.name()`, `.description()`, `.version()`, `.option("--debug", ...)`.
6. **PreAction hook:** `.hook("preAction", ...)` reads `program.opts()` and conditionally enables debug logging.

### Command Registration Order

Commands are registered in this exact order after the `status` command definition:

1. `registerAuthCommands(program)` — `auth login`, `auth status`
2. `registerDbCommands(program)` — `db sync`, `db status`
3. `registerPlaylistCommands(program)` — `playlists list/show/rename/bulk-rename/delete/push`
4. `registerLexiconCommands(program)` — `lexicon status/match`
5. `registerMatchCommands(program)` — `matches list/confirm/reject`
6. `registerReviewCommands(program)` — `review list/confirm/reject/bulk-confirm/bulk-reject`
7. `registerSyncCommand(program)` — `sync [playlist]`
8. `registerServeCommand(program)` — `serve`
9. `registerJobCommands(program)` — `jobs list/retry/retry-all/stats` + `wishlist run`

### Program Execution

```typescript
program.parse();
```

Called at the very end with no arguments, which defaults to parsing `process.argv`.

---

### `status` (top-level, defined in index.ts)

- **Description:** Check connectivity to all external services.
- **Arguments:** None.
- **Options:** None.
- **Service calls:** `loadConfig()`, `checkHealth(config)`, `getDb()`, `sql count(*)` on `playlists` and `tracks` tables.
- **Output format:**
  - One line per service: `  Spotify     {green checkmark} Authenticated` or `  Spotify     {red X} {error}`.
  - Services checked: Spotify, Lexicon (shows URL), Soulseek (shows URL), Database (shows playlist + track counts).
  - Database check is wrapped in its own try/catch to handle the case where the DB is not initialized.
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
- **Arguments:** `<id>` — playlist ID (UUID, spotify ID, or name match via service).
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
- **Options:** `--push` — Also rename on Spotify.
- **Service calls:** `PlaylistService.getPlaylist(id)`, `PlaylistService.renamePlaylist(id, name)`, optionally `SpotifyService.renamePlaylist(spotifyId, name)`.
- **Output format:**
  - `chalk.green('Renamed "{oldName}" -> "{name}" in local DB.')`.
  - With `--push`: `chalk.green("Renamed on Spotify.")`.
- **Error handling:**
  - Playlist not found: red + dim hint.
  - `--push` without Spotify ID: yellow warning.
  - `--push` not authenticated: red + dim hint.

### `playlists bulk-rename <pattern> <replacement>`

- **Description:** Bulk rename playlists matching a pattern.
- **Arguments:** `<pattern>` — string or regex to match, `<replacement>` — replacement string.
- **Options:**
  - `--regex` — Treat pattern as a regular expression.
  - `--dry-run` — Show what would be renamed without applying changes.
- **Service calls:** `PlaylistService.getPlaylists()`, `PlaylistService.renamePlaylist()` per affected playlist.
- **Output format:**
  - Bold "Bulk rename preview:" or "Bulk rename results:".
  - Per affected playlist: `  "{oldName}" -> "{newName}"`.
  - Footer: dim "{N} playlist(s) affected" or "No playlists matched.".
  - With `--dry-run`: dim "(dry run — no changes applied)".
- **Error handling:** Invalid regex: `chalk.red("Invalid regex: {message}")`.

### `playlists delete <id>`

- **Description:** Delete a playlist.
- **Arguments:** `<id>`.
- **Options:** `--spotify` — Also delete (unfollow) on Spotify.
- **Interactive prompt:** Uses `readline.createInterface` to ask `Delete playlist "{name}" with {N} tracks? [y/N]`. Only proceeds on `y`.
- **Service calls:** `PlaylistService.getPlaylist(id)`, `PlaylistService.getPlaylistTracks(id)`, `PlaylistService.removePlaylist(id)`, optionally `SpotifyService.deletePlaylist(spotifyId)`.
- **Output format:**
  - Yellow confirmation prompt.
  - On cancel: dim "Cancelled."
  - Green "Deleted {name} from local DB."
  - With `--spotify`: green "Unfollowed on Spotify."
- **Error handling:** Not found, no Spotify ID for `--spotify`, not authenticated.

### `playlists push [id]`

- **Description:** Push local playlist changes back to Spotify (includes description sync by default).
- **Arguments:** `[id]` — optional playlist ID.
- **Options:** `--all` — Push all playlists.
- **Service calls:** `SpotifyService.isAuthenticated()`, `PlaylistService.getPlaylists()` or `getPlaylist(id)`, `PlaylistService.composeDescription()`, `spotify.getPlaylistTracks(spotifyId)`, `PlaylistService.getPlaylistDiff(id, spotifyTracks)`, `spotify.getPlaylists()`, `spotify.renamePlaylist()`, `spotify.updatePlaylistDetails()`, `spotify.removeTracksFromPlaylist()`, `spotify.addTracksToPlaylist()`, `PlaylistService.updateSnapshotId()`.
- **Output format:**
  - Bold "Pushing {N} playlist(s) to Spotify..."
  - Per playlist: dim "no changes" or cyan name with indented green/yellow actions (renamed, description synced, removed, added).
  - Final green "Done."
- **Note:** Description sync (tags + notes) is always included — no opt-in flag needed.
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
- **Arguments:** `<playlist>` — resolved by ID, spotify ID, or name (case-insensitive).
- **Options:** None.
- **Service calls:** `checkHealth(config)`, `PlaylistService.getPlaylist()` (with name fallback), `new SyncPipeline(config)`, `pipeline.matchPlaylist(id)`.
- **Output format:**
  - Checks Lexicon health first; prints red if not available.
  - Bold "Matching {name} against Lexicon library..."
  - Bold "Match results": Total (cyan), Confirmed (green), Pending review (yellow), Not found (red).
  - "Pending review:" section with yellow percentage + track info.
  - "Not found:" section with red `x` prefix.
- **Error handling:** `chalk.red("Match failed: {message}")`.

---

### `matches list`

- **Description:** List matches from the database.
- **Arguments:** None.
- **Options:** `-s, --status <status>` — Filter by status (pending|confirmed|rejected).
- **Service calls:** `getDb()`, queries `matches` table with optional `where` clause.
- **Output format:**
  - Table: ID (8 chars, cyan), Source (10), Target (10), Score (6, right-aligned), Conf (8, color-coded: high=green, low=red, else yellow), Status (10, color-coded: confirmed=green, rejected=red, pending=yellow), Method (8, dim).
  - Footer: dim "{N} match(es)".
- **Empty state:** Dim "No matches found."

### `matches confirm <id>`

- **Description:** Confirm a match.
- **Arguments:** `<id>` — prefix-matched against all match IDs.
- **Options:** None.
- **Service calls:** `getDb()`, fetches all matches, finds one with `id.startsWith(id)`, updates status to "confirmed".
- **Output format:** `chalk.green("Match {shortId} confirmed.")`.
- **Error handling:** `chalk.red('No match found with ID starting with "{id}".')`.

### `matches reject <id>`

- **Description:** Reject a match.
- **Arguments:** `<id>` — prefix-matched.
- **Options:** None.
- **Service calls:** Same as confirm but sets status to "rejected".
- **Output format:** `chalk.green("Match {shortId} rejected.")`.

---

### `review list`

- **Description:** List pending review items.
- **Arguments:** None.
- **Options:** `--playlist <id>` — Filter to a specific playlist.
- **Service calls:** `ReviewService.getPending(playlistId?)`, `getDb()` for track enrichment, optionally `LexiconService.getTracks()` for target enrichment.
- **Output format:**
  - Header: bold "{N} pending match(es) to review".
  - Per match: bold `[{i}] Match at {yellow score%} ({method})`.
  - Source info (cyan "Spotify:" label): artist, title, album (dim), duration (dim).
  - Target info (magenta "Lexicon:" label): artist, title, album (dim), duration (dim), file path (dim).
  - If Lexicon unavailable: yellow warning, target details show raw ID.
- **Empty state:** Green "No pending matches to review."

### `review confirm <id>`

- **Description:** Confirm a pending review match.
- **Arguments:** `<id>` — match ID (prefix-matched).
- **Options:** None.
- **Service calls:** `ReviewService.confirm(id)`.
- **Output format:** `chalk.green("Match {shortId} confirmed.")`.
- **Error handling:** Not found or not pending: red error.

### `review reject <id>`

- **Description:** Reject a pending review match. Auto-queues download.
- **Arguments:** `<id>` — match ID (prefix-matched).
- **Options:** None.
- **Service calls:** `ReviewService.reject(id)`.
- **Output format:**
  - `chalk.green("Match {shortId} rejected.")`.
  - `chalk.yellow("Download queued for this track.")` — warning that a download job has been created.
- **Error handling:** Not found or not pending: red error.

### `review bulk-confirm`

- **Description:** Bulk confirm all pending matches.
- **Arguments:** None.
- **Options:** `--playlist <id>` — Scope to a specific playlist.
- **Service calls:** `ReviewService.getPending(playlistId?)`, `ReviewService.bulkConfirm(matchIds)`.
- **Interactive prompt:** `Confirm {N} pending match(es)? [y/N]`. Only proceeds on `y`.
- **Output format:** `chalk.green("Confirmed {N} match(es).")`.

### `review bulk-reject`

- **Description:** Bulk reject all pending matches. Auto-queues downloads.
- **Arguments:** None.
- **Options:** `--playlist <id>` — Scope to a specific playlist.
- **Service calls:** `ReviewService.getPending(playlistId?)`, `ReviewService.bulkReject(matchIds)`.
- **Interactive prompt:** `Reject {N} pending match(es)? This will queue downloads for all. [y/N]`. Only proceeds on `y`.
- **Output format:**
  - `chalk.green("Rejected {N} match(es).")`.
  - `chalk.yellow("{N} download(s) queued.")`.

---

### `sync [playlist]`

- **Description:** Run the non-blocking sync pipeline for a playlist.
- **Arguments:** `[playlist]` — optional playlist name/ID.
- **Options:**
  - `--all` — Sync all playlists.
  - `--dry-run` — Show what would happen without making changes.
  - `--tags` — Sync Spotify playlist name segments as Lexicon custom tags.
  - `--verbose` — Show per-track search diagnostics (query strategies, candidate counts).
  - `--standalone` — Force standalone mode (skip server detection).
  - `--server <url>` — Server URL to connect to (default: `http://localhost:3100`).

#### Thin-Client Mode

When `--standalone` is NOT set, the command first attempts to detect a running crate-sync server:

1. Calls `tryDetectServer(opts.server)` which sends `GET {serverUrl}/api/status` with a 2s timeout.
2. If server detected: prints dim "Server detected at {url} -- using thin-client mode" + hint about `--standalone`.
3. Resolves playlists locally, then for each playlist calls `runThinClientSync(serverUrl, playlistId, playlistName, opts)`.

**`runThinClientSync` behavior:**
- **Dry run:** `POST /api/sync/{playlistId}/dry-run`, prints match summary.
- **Full sync:** `POST /api/sync/{playlistId}`, receives `{ syncId }`, then connects to SSE at `GET /api/sync/{syncId}/events`.
- **SSE event handling:**
  - `phase`: prints cyan phase label ("Phase 1 — Match", "Phase 2 — Download").
  - `match-complete`: prints total/confirmed/pending/notFound summary.
  - `download-progress`: prints green checkmark or red X per track with progress `[{completed}/{total}]`.
  - `sync-complete`: prints summary (N confirmed, N pending review, N queued for download) + green "Sync pipeline complete." and stops SSE.
  - `error`: prints red error and stops SSE.
- **SSE parsing:** Manual chunked reader with `eventRes.body.getReader()`, parses `event:` and `data:` lines from buffer.

Note: no interactive review prompts during sync — review is async. Pending matches are reported in the summary.

#### Standalone Mode

Falls through to standalone when `--standalone` is set or no server detected:

1. **Pre-flight health checks:** Warns (yellow) if Lexicon or Soulseek unavailable.
2. **Playlist resolution:** By ID, spotify ID, or name (case-insensitive). With `--all`, syncs all playlists.
3. **Per playlist:**
   - **Dry run:** `pipeline.dryRun(playlistId)`, prints match summary.
   - **Phase 1 — Match:** `pipeline.matchPlaylist(playlistId)`, prints summary: confirmed (green), pending review (yellow), not found (red).
   - **Tag sync:** If `--tags` and confirmed matches exist, `pipeline.syncTags(name, confirmed)`.
   - Prints summary: `{N} confirmed and tagged, {N} pending review, {N} queued for download`.
4. Non-blocking — the command prints the summary and exits. Review happens asynchronously via `crate-sync review` commands or the web UI.

- **Error handling:** `chalk.red("Sync failed: {message}")`.
- **Service calls:** `loadConfig()`, `getDb()`, `PlaylistService`, `SyncPipeline`, `checkHealth()`.

---

### `serve`

- **Description:** Start the web UI API server with job runner.
- **Arguments:** None.
- **Options:**
  - `-p, --port <port>` — Port to listen on (default: `"3100"`).
  - `--no-jobs` — Disable the background job runner.
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
  - `--status <status>` — Filter by status (queued/running/done/failed).
  - `--type <type>` — Filter by type (spotify_sync/lexicon_match/search/download/...).
  - `--limit <n>` — Max results (default: `"20"`).
- **Service calls:** `getDb()`, queries `jobs` table with optional `where` conditions, `orderBy desc(createdAt)`, `.limit(limit)`. Also queries aggregate stats `groupBy status`.
- **Output format:**
  - Dim header: `ID(10) TYPE(14) STATUS(9) ATTEMPT(9) CREATED(18) ERROR`.
  - Per row: ID (first 8 chars), type (padded 14), status (color-coded: queued=blue, running=yellow, done=green, failed=red, padded 7), attempt `{n}/{max}` (padded 9), created (formatted with `toLocaleString` month/day/hour/min, padded 18), error (dim, truncated to 60 chars).
  - Footer: dim "Total: " + status counts joined by dim commas, each color-coded.
- **Empty state:** Dim "No jobs found."

### `jobs retry <id>`

- **Description:** Re-queue a failed job.
- **Arguments:** `<id>` — prefix-matched via `LIKE {id}%`.
- **Options:** None.
- **Service calls:** `getDb()`, queries job, validates `status === "failed"`, updates to `status: "queued", error: null, runAfter: null`.
- **Output format:** `chalk.green("Re-queued job {shortId} ({type})")`.
- **Error handling:** `chalk.red("Job not found: {id}")`, `chalk.red("Can only retry failed jobs (current: {status})")`.

### `jobs retry-all`

- **Description:** Re-queue all failed jobs.
- **Arguments:** None.
- **Options:** `--type <type>` — Only retry jobs of this type.
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

- **Description:** Manually trigger a wishlist run.
- **Arguments:** None.
- **Options:** None.
- **Note:** Registered as a top-level command `wishlist` with subcommand `run`.
- **Service calls:** `getDb()`, `db.insert(schema.jobs).values({ type: "wishlist_run", status: "queued", priority: -1, payload: null })`.
- **Output format:** `chalk.green("Created wishlist run job: {shortId}")` + dim "The job runner will pick it up shortly."

---

## Dependencies

### Entry Point Imports

| Module                            | Imports                                    |
|-----------------------------------|--------------------------------------------|
| `commander`                       | `Command`                                  |
| `chalk`                           | `chalk` (default)                          |
| `drizzle-orm`                     | `sql`                                      |
| `./commands/auth.js`              | `registerAuthCommands`                     |
| `./commands/db.js`                | `registerDbCommands`                       |
| `./commands/playlists.js`         | `registerPlaylistCommands`                 |
| `./commands/lexicon.js`           | `registerLexiconCommands`                  |
| `./commands/matches.js`           | `registerMatchCommands`                    |
| `./commands/review.js`            | `registerReviewCommands`                   |
| `./commands/sync.js`              | `registerSyncCommand`                      |
| `./commands/serve.js`             | `registerServeCommand`                     |
| `./commands/jobs.js`              | `registerJobCommands`                      |
| `./utils/shutdown.js`             | `setupShutdownHandler`, `onShutdown`       |
| `./db/client.js`                  | `closeDb`, `getDb`                         |
| `./config.js`                     | `loadConfig`                               |
| `./utils/health.js`              | `checkHealth`                              |
| `./db/schema.js`                  | `playlists`, `tracks`                      |
| `./utils/logger.js`              | `setLogLevel`, `setLogFile`, `closeLog`    |

### Command Handler Imports

- `commander` — Command parsing and registration.
- `chalk` — Terminal color output.
- `node:readline/promises` — Interactive prompts (review, delete confirmation).
- `drizzle-orm` — Database queries (`eq`, `and`, `desc`, `inArray`, `count`, `sql`).
- `src/config.js` — `loadConfig()`, `getConfigPath()`.
- `src/db/client.js` — `getDb()`.
- `src/db/schema.js` — All table schemas.
- `src/services/spotify-service.js` — `SpotifyService`.
- `src/services/spotify-auth-server.js` — `waitForAuthCallback`.
- `src/services/playlist-service.js` — `PlaylistService`.
- `src/services/lexicon-service.js` — `LexiconService`.
- `src/services/soulseek-service.js` — `SoulseekService`.
- `src/services/review-service.js` — `ReviewService`.
- `src/services/sync-pipeline.js` — `SyncPipeline`.
- `src/utils/progress.js` — `Progress` utility.
- `src/utils/health.js` — `checkHealth`.
- `src/utils/shutdown.js` — `isShutdownRequested`, `onShutdown`.
- `src/api/server.js` — `startServer`.
- `src/jobs/runner.js` — `startJobRunner`, `stopJobRunner`.
- `src/commands/sync-client.js` — `tryDetectServer`, `runThinClientSync`.

---

## Error Handling

All command actions follow a consistent pattern:
1. Wrap the entire action body in `try/catch`.
2. Extract message: `err instanceof Error ? err.message : String(err)`.
3. Print with `chalk.red("{CommandContext} failed: {message}")` or `chalk.red("Error: {message}")`.
4. For sub-operations (e.g., per-playlist in `db sync`, per-playlist in `push`), errors are caught per-iteration and reported inline without stopping the loop.

The `status` command has a nested try/catch for the database section so that a missing or uninitialized database does not prevent reporting on other services.

Commander itself handles unknown commands and missing required arguments.

---

## Tests

### Unit Tests

- Test that each register function adds the expected command tree to a Commander program (inspect `program.commands`).
- For synchronous commands (`db status`, `matches list`, `jobs stats`): mock `getDb()` and verify correct queries and output.
- For interactive commands (`review bulk-confirm`, `playlists delete`): mock `readline.createInterface` and simulate user input sequences.

### Integration Tests

- With a seeded test database, verify `playlists list` output matches expected table format.
- With mocked services, verify `sync` in standalone mode runs match phase, prints summary, and exits (non-blocking).
- Verify `serve` calls `startServer` with correct port and conditionally starts job runner.
- Verify thin-client mode: mock `fetch` for server detection and SSE stream.
- Verify `review list` shows pending matches with enriched track info.
- Verify `review reject` shows download-queued warning.
- Verify `playlists bulk-rename --dry-run` shows preview without applying.
- Verify `wishlist run` creates a `wishlist_run` job.

---

## Acceptance Criteria

1. The file starts with `#!/usr/bin/env node` shebang.
2. `setupShutdownHandler()` is called before any command registration.
3. `onShutdown(closeDb)` and `onShutdown(closeLog)` are registered before any command registration.
4. The Commander program is configured with name `"crate-sync"`, version `"0.1.0"`, and the exact description.
5. The `--debug` option triggers `setLogLevel("debug")` and `setLogFile("./data/crate-sync.log")` via a `preAction` hook.
6. The top-level `status` command checks Spotify, Lexicon, Soulseek, and Database, with the database check isolated in its own try/catch.
7. All 9 command registration functions are called in the documented order.
8. `program.parse()` is the final statement in the file.
9. Every command in the tree above is registered with the exact name, description, arguments, and options specified.
10. Output formatting matches the chalk color scheme and column widths described for each command.
11. Interactive prompts accept the documented key sequences and behave correctly.
12. `sync` is non-blocking — runs match + tag for confirmed, prints summary (N confirmed, N pending review, N queued for download), exits. Review happens asynchronously.
13. `playlists push` includes description sync by default.
14. `review reject` shows auto-download warning.
15. `review bulk-reject` shows interactive confirmation and download-queued count.
16. `playlists bulk-rename` supports `--regex` and `--dry-run` options.
17. `serve` starts the HTTP server and conditionally starts the job runner based on `--no-jobs`.
18. All error messages match the documented patterns.
19. Shutdown handling in `db sync` checks `isShutdownRequested()` and exits gracefully.
20. `matches confirm` and `matches reject` support prefix-matching on match IDs.
21. `jobs retry` supports prefix-matching on job IDs via `LIKE`.
22. `wishlist run` is registered under a top-level `wishlist` command group.
23. Removed commands: no `playlists merge`, `playlists fix-duplicates`, `playlists repair`, `playlists dupes`, `download search`, `download playlist`, `download resume`, `lexicon sync`.
