# Changelog

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
