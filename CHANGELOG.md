# Changelog

## Unreleased

### Added
- **Remove duplicate tracks** — `playlists dedup <id> [--all] [--apply]` CLI command and `POST /api/playlists/:id/dedup` endpoint. Detects duplicates by same URI, same ISRC, or normalized title+artist. Dry-run by default, keeps first occurrence. 9 tests covering URI/ISRC/fuzzy dupes, no false positives, and dry-run safety.
- **Import playlists from files** — `playlists import <path>` CLI command and `POST /api/playlists/import` endpoint. Supports M3U/M3U8 (EXTINF), CSV (flexible column mapping), and TXT (Artist - Title) formats. Can import a single file or all supported files in a directory. `--dry-run` flag for preview.
- **Merge dry-run** — `--dry-run` flag on CLI and `dryRun` option on API to preview merge without modifying data.
- **Merge push** — `--push` flag on CLI to push merged playlist to Spotify after merge.
- **Per-playlist merge endpoint** — `POST /api/playlists/:id/merge` as alternative to bulk `/merge`.
- **Self-merge guard** — reject merging a playlist into itself (API 400, CLI error, service throws).

### Fixed
- **Candidate fallback on download failure** — when a Soulseek download fails (timeout, peer rejection), the next-ranked candidate is tried automatically instead of giving up. Download failures are now recorded as rejections so the same user is skipped on retry. All candidates are tried before marking a track as failed.
- **slskd destination not used in batch downloads** — `acquireAndMove()` now passes the playlist name as the slskd `destination` parameter, so batch downloads land in `downloads/{playlist}/` instead of the default remote-path location.

### Tests
- **API route tests** — added test suites for downloads, review, and status API routes covering request/response shape, filtering, error cases, and config updates.
- **Webhook API tests** — POST with valid download match, missing fields, no matching download, and non-downloading state.

### Added
- **Multi-source search in job handler (Phase 3)** — search handler queries local filesystem sources (via AcquisitionService) before falling back to Soulseek. Local matches are validated and placed directly in Lexicon/Incoming, skipping the download job. New `sourceId`/`sourceKey` columns on downloads table track which source found each track. Backward compatible with existing Soulseek-only workflows.
- **slskd webhook integration (Phase 2)** — `POST /api/webhooks/slskd/download-complete` endpoint for immediate download notification from slskd. Shell script hook for slskd's `DownloadFileComplete` event. When webhook is enabled, download scanner interval increases to 60s (safety net). Webhook config in `soulseek.webhook` section.
- **Job queue cleanup** — "Clear Done" and "Clear Failed" buttons on Queue page, auto-purge of completed/failed jobs older than configurable retention period (default 7 days), "Job Retention (days)" setting in Settings page.
- **Cleanup failed download files and empty folders** — `DELETE /api/downloads/:id/file` endpoint to delete physical files for failed downloads. "Delete File" button in web UI for failed downloads. `downloads clean --failed --empty-dirs` CLI command. Auto-cleanup of empty source directories after file moves.
- **Single track sync with Lexicon** — `matchTrack()` method on SyncPipeline, `POST /api/sync/track/:id` endpoint, "Sync with Lexicon" button on TrackDetail page, and `sync track <id>` CLI subcommand. Matches one track, tags if confirmed, respects rejection memory.
- **Multi-select and bulk toolbar** in web UI — reusable `useMultiSelect` hook, floating `BulkToolbar` component, checkbox selection in playlist table with select-all toggle, bulk delete and bulk merge actions.
- **Bulk rename** — `POST /api/playlists/bulk-rename` with find-replace, prefix, and suffix modes. Mandatory dry-run preview before applying. Web UI modal with mode selector and preview table.
- **Playlist statistics and dashboard** — `GET /api/playlists/stats` for library-wide stats (total playlists, tracks, duration). PlaylistDetail stats section with track count, total duration, unique artists, and top artist. Dashboard library stats cards including total duration.
- **Playlist metadata (tags, notes, pinning)** — new `tags` (JSON text), `notes` (text), and `pinned` (integer) columns on `playlists` table. `PATCH /api/playlists/:id` endpoint for metadata updates. Pinned playlists sort to top. Tag badges on playlist rows with tag-based filtering. PlaylistDetail: editable notes textarea (saves on blur), tag editor with autocomplete, pin/unpin toggle.

## 0.4.0 — 2026-03-17

### Added
- **Multi-strategy search query builder** — searches now try up to 4 strategies (full, base-title without remix suffix, title-only, keywords) and stop at the first that returns results. Fixes 0-result searches for remixes, live sessions, and long titles.
- **Job queue architecture** — background job runner with SQLite polling, exponential backoff, and parent-child job relationships. Decomposes the sync pipeline into independent jobs (spotify_sync → match → search → download → validate → lexicon_sync).
- **Job CLI commands** — `jobs list`, `jobs retry`, `jobs retry-all`, `jobs stats` for managing background work from the terminal.
- **Wishlist** — automatic retry of failed searches on a backoff schedule (1h → 6h → 24h → 7d). Runs periodically via the job runner or manually via `wishlist run`.
- **Queue page** in web UI — live job list with status filters, stats cards, retry/cancel actions, and drill-down to job details with payload/result/child jobs.
- **`--verbose` flag** for `sync` command — shows per-track search diagnostics: which query strategy succeeded, all strategies tried with result counts, top candidates.
- **Job runner config** — `jobRunner.pollIntervalMs` and `jobRunner.wishlistIntervalMs` in config.json.
- **`--no-jobs` flag** for `serve` command — start the API server without the background job runner.
- **Jobs API** — REST endpoints for listing, filtering, retrying, cancelling jobs, plus SSE stream for real-time updates.

- **Review page** in web UI — side-by-side Spotify vs Lexicon comparison for pending matches with confirm/reject and bulk actions.
- **Track detail page** in web UI — full lifecycle view: Spotify metadata, playlist membership, matches, downloads, related jobs.
- **`review` CLI command** — interactive terminal review of pending matches with side-by-side comparison (y/n/a=all/q=quit/s=skip).
- **Track lifecycle API** — `GET /api/tracks/:id/lifecycle` aggregates data from tracks, matches, downloads, and jobs tables.
- **Match API enrichment** — `GET /api/matches` now includes `targetTrack` (Lexicon track info) alongside `sourceTrack`.

### Changed
- `serve` command now starts the job runner alongside the API server by default.
- `POST /api/sync/:playlistId` now also creates a root job in the queue.
- `acquireAndMove` in DownloadService is now public (used by job handlers).
- `DownloadResult` includes `strategy` and `strategyLog` fields for observability.

## 0.3.0 — 2026-03-15

### Added
- **Web UI** — Hono API server (`crate-sync serve`) + React/Vite frontend
  - Dashboard with service status and stats
  - Playlist browsing with track listings
  - Interactive match review (confirm/reject)
  - Download monitoring with status filters
  - Settings editor for matching thresholds and download config
  - SSE-based real-time sync progress streaming
- **Improved track matching** — ported techniques from slsk-batchdl
  - Damerau-Levenshtein edit distance (handles transpositions)
  - Unicode/diacritics normalization, artist normalization ("the", "&")
  - Stopword removal for Jaccard similarity
  - Artist containment floor for "feat." cases
  - Remix suffix stripping with fallback matching
  - Context-aware weight profiles (lexicon, soulseek, post-download)
  - Album dimension with proportional weight redistribution
  - Configurable artist reject gate for Soulseek

## 0.2.0 — 2026-03-10

### Fixed
- **Lexicon API endpoints** — corrected `getTrack`, `createPlaylist`, `addTracksToPlaylist`, and `setPlaylistTracks` to use proper paths (`/track?id=`, `/playlist`), methods (`PATCH` instead of `PUT`), and integer track IDs
- **Lexicon track field mapping** — read `location`, `albumTitle`, `duration` (seconds) instead of wrong field names
- **Lexicon `searchTracks`** — use client-side filtering (API has no search endpoint)
- **Lexicon `getPlaylistByName`** — recursively traverse playlist tree instead of only checking top level

### Added
- **`playlists repair <id>`** — re-match playlist tracks against Lexicon, optionally download missing via `--download`
- **`playlists push [id]`** — push local changes back to Spotify API, with `--all` for bulk
- **`crate-sync status`** — show service connectivity and database stats
- **Retry utility** — exponential backoff with jitter for transient network failures
- **Health checks** — pre-flight connectivity checks in sync, download, and lexicon commands
- **Progress bars** — visual progress indicators for sync and download operations
- **Graceful shutdown** — Ctrl+C handling with cleanup during long operations

## 0.1.0 — 2026-03-09

Initial implementation of the unified crate-sync CLI.

### Added
- **CLI framework** with Commander.js — all command groups registered
- **Local SQLite database** with Drizzle ORM for persisting Spotify data
- **Spotify integration** — OAuth flow, playlist/track sync to local DB
- **Lexicon DJ integration** — REST API client for reading library and managing playlists
- **Soulseek integration** — slskd REST API wrapper for searching and downloading
- **Matching engine** — pluggable strategy system (ISRC exact, fuzzy weighted scoring, composite)
- **3-phase sync pipeline** — batch match → interactive review → concurrent download
- **Download service** — search, filter, rank, download, validate tags, move to playlist folder
- **CLI commands**: auth, db, playlists, lexicon, download, matches, sync
- **17 tests** for the matching engine
