# Crate Sync — Feature Set

## Overview

Unified CLI tool to manage Spotify playlists and sync them with Lexicon DJ.
Downloads missing tracks from Soulseek. Single TypeScript codebase.

## Architecture Principles

- **CLI + Web UI** — Full feature parity between CLI and web dashboard
- **Local-first** — SQLite for all persistent state (playlists, tracks, matches, jobs, config)
- **Pluggable matching** — Song matching is a core abstraction, used across all sync flows
- **Job queue** — Background processing with retry, backoff, and observability
- **Source-agnostic** — Spotify first, Tidal later (same interfaces)
- **Offline-friendly** — Work from local DB whenever possible, sync with APIs on demand

---

## Feature Groups

### 1. Local Database & Sync

Cache Spotify data locally to avoid API throttling and enable offline workflows.

- **F1.1** Import user's Spotify playlists and tracks into SQLite
- **F1.2** Incremental sync — only fetch changes since last sync
- **F1.3** Store track metadata: title, artist, album, duration, ISRC, Spotify URI
- **F1.4** Store playlist metadata: name, description, track order, snapshot ID
- **F1.5** Track sync history (last synced timestamp, change log)

### 2. Playlist Management

Manage Spotify playlists from the CLI, operating on local data and pushing changes back.

- **F2.1** List playlists (with search/filter)
- **F2.2** Rename playlist (single)
- **F2.3** Bulk rename playlists (pattern-based)
- **F2.4** Merge two or more playlists
- **F2.5** Detect duplicates within a playlist
- **F2.6** Detect duplicates across playlists
- **F2.7** Remove duplicates (interactive confirmation)
- **F2.8** Repair playlist — fix broken/unplayable tracks by re-matching
- **F2.9** Delete playlist
- **F2.10** Push local changes back to Spotify

### 3. Song Matching Engine

Central, pluggable matching system used across all sync and dedup flows.

- **F3.1** Fuzzy matching on title + artist (weighted scoring)
- **F3.2** Exact matching on ISRC when available
- **F3.3** Configurable match thresholds (auto-accept, review, reject)
- **F3.4** Match strategy interface — pluggable for different contexts:
  - Spotify ↔ Spotify (dedup)
  - Spotify ↔ Lexicon (sync)
  - Spotify ↔ Soulseek (search)
  - Downloaded file ↔ Spotify (post-download tagging)
- **F3.5** Central false-match registry — persist known bad matches in DB
- **F3.6** Central confirmed-match registry — persist known good matches
- **F3.7** Interactive review for uncertain matches (CLI prompts)

### 4. Lexicon DJ Integration

Unidirectional sync: Spotify → Lexicon DJ. Lexicon is the target, not the source.

- **F4.1** Read Lexicon library (track listing)
- **F4.2** Match Spotify tracks against Lexicon library
- **F4.3** Create playlists in Lexicon from Spotify playlists
- **F4.4** Update existing Lexicon playlists (add/remove tracks)
- **F4.5** Report: tracks in Spotify but missing from Lexicon
- **F4.6** Sync status tracking (Spotify → Lexicon)

### 5. Soulseek Downloading

Download tracks missing from Lexicon via Soulseek P2P network.

- **F5.1** Search Soulseek for a track (by title + artist)
- **F5.2** Filter results by file conditions (format, bitrate, quality)
- **F5.3** Rank results using match scoring
- **F5.4** Download best match
- **F5.5** Concurrent downloads (no rate limit on downloads; rate limit on searches)
- **F5.6** Post-download validation: verify MP3/FLAC tags (artist, title) match expected track
- **F5.7** Rename file to `<Artist> - <Title>.<ext>` and move to `<download_root>/<playlist_name>/`
- **F5.8** Lexicon watches the download root and auto-imports new files
- **F5.9** Persistent download state — resume interrupted sessions
- **F5.10** Skip tracks already in Lexicon library

### 6. End-to-End Pipeline

Orchestrate the full flow: Spotify → match → download → Lexicon.

- **F6.1** `sync <playlist>` — Full pipeline for a single playlist (or `--all`):

  **Phase 1 — Match (batch, non-blocking):**
  1. Fetch/update playlist from Spotify
  2. Match all tracks against Lexicon in bulk
  3. Categorize results: ✅ found, ⚠️ needs confirmation, ❌ not found

  **Phase 2 — Review (interactive, one-time):**
  4. Present all ⚠️ uncertain matches for user confirmation at once
  5. Update match registry with confirmations/rejections
  6. Produce final "missing" list (rejected + not found)

  **Phase 3 — Download (batch, autonomous):**
  7. Search Soulseek for all missing tracks (rate-limited searches)
  8. Download matches concurrently
  9. Validate downloads, move to `<download_root>/<playlist_name>/`
  10. Re-match against Lexicon once auto-imported
  11. Add imported tracks to Lexicon playlist, preserving Spotify track order

- **F6.2** Dry-run mode — show what would happen without making changes
- **F6.3** Progress reporting and activity logging
- **F6.4** Batch processing — efficient workflow where user reviews all matches upfront, then downloads run unattended
- **F6.5** Preserve Spotify playlist track order in Lexicon playlists

### 7. Multi-Strategy Search

Improve Soulseek search hit rate for difficult track names.

- **F7.1** Multi-strategy query builder (full, base-title, title-only, keywords)
- **F7.2** Automatic fallback — try strategies in order, stop at first with results
- **F7.3** Strategy logging — track which strategy succeeded for observability
- **F7.4** `--verbose` flag — show per-track search diagnostics in CLI

### 8. Job Queue

Background processing with automatic retry and observability.

- **F8.1** SQLite-backed job queue with atomic claim, priority ordering
- **F8.2** Job types: spotify_sync, match, search, download, validate, lexicon_sync, wishlist_scan
- **F8.3** Parent-child job relationships (sync → match → search → download)
- **F8.4** Exponential backoff on failure (1h → 6h → 24h → 7d)
- **F8.5** Wishlist — periodic scanner re-queues failed searches past cooldown
- **F8.6** CLI: `jobs list`, `jobs retry`, `jobs retry-all`, `jobs stats`, `wishlist run`
- **F8.7** REST API: list, filter, retry, cancel, stats, SSE stream
- **F8.8** Web UI: Queue page with live job list, filters, drill-down, retry/cancel

### 9. Web UI

Dashboard for browsing, reviewing, and monitoring.

- **F9.1** Dashboard — stats cards, service status
- **F9.2** Playlist browsing with track listings
- **F9.3** Match review (confirm/reject from the browser)
- **F9.4** Download monitoring with status filters
- **F9.5** Job queue page with filters, stats, retry/cancel, job detail drill-down
- **F9.6** Settings editor for matching thresholds and download config
- **F9.7** SSE-based real-time sync progress streaming

---

## Deferred (Future)

- **Tidal support** — Same interfaces, different extractor (keep door open)
- **TUI** — Textual/Ink interactive interface on top of CLI
- **Smart playlists** — Auto-categorization by BPM, key, genre
- **Multi-user** — Auth and per-user state (only needed for Web UI)

---

## CLI Command Structure (Draft)

```
crate-sync
├── auth
│   ├── login              # Spotify OAuth flow
│   └── status             # Show auth status
├── db
│   ├── sync               # Sync Spotify → local DB
│   └── status             # Show DB stats
├── playlists
│   ├── list               # List playlists
│   ├── show <id>          # Show playlist details
│   ├── rename <id> <name> # Rename playlist
│   ├── bulk-rename        # Pattern-based rename
│   ├── merge <ids...>     # Merge playlists
│   ├── dupes [<id>]       # Find duplicates (within or across)
│   ├── dedup <id>         # Remove duplicates
│   ├── delete <id>        # Delete playlist
│   └── push               # Push local changes to Spotify
├── lexicon
│   ├── status             # Show Lexicon connection status
│   ├── match <playlist>   # Match playlist against Lexicon
│   └── sync <playlist>    # Sync playlist to Lexicon
├── download
│   ├── search <query>     # Search Soulseek
│   ├── playlist <id>      # Download missing tracks for playlist
│   └── resume             # Resume interrupted downloads
├── matches
│   ├── list               # Show match registry
│   ├── confirm <id>       # Confirm a match
│   └── reject <id>        # Reject a match (false match)
├── sync <playlist|--all>  # Full end-to-end pipeline
│   ├── --dry-run          # Phase 1 only, no changes
│   ├── --verbose          # Per-track search diagnostics
│   └── --tags             # Sync playlist name segments as Lexicon tags
├── serve                  # Start API server + job runner
│   ├── --port <n>         # Port (default: 3100)
│   └── --no-jobs          # Disable background job runner
├── jobs
│   ├── list               # List jobs (--status, --type filters)
│   ├── retry <id>         # Re-queue a failed job
│   ├── retry-all          # Re-queue all failed jobs (--type filter)
│   └── stats              # Job statistics
└── wishlist
    └── run                # Manually trigger wishlist scan
```

---

## Data Model (Core Entities)

- **Playlist** — id, spotify_id, name, description, snapshot_id, last_synced
- **Track** — id, spotify_id, title, artist, album, duration_ms, isrc, spotify_uri
- **PlaylistTrack** — playlist_id, track_id, position, added_at
- **LexiconTrack** — id, file_path, title, artist, album, duration_ms
- **Match** — id, source_type, source_id, target_type, target_id, score, status (confirmed/rejected/pending)
- **Download** — id, track_id, status, soulseek_path, file_path, started_at, completed_at
- **Job** — id, type, status, priority, payload (JSON), result (JSON), error, attempt, max_attempts, run_after, parent_job_id, timestamps
- **SyncLog** — id, playlist_id, action, details, timestamp
