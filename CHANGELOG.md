# Changelog

## 0.1.1 — 2026-03-10

### Added
- **Retry utility** (`src/utils/retry.ts`) — exponential backoff with jitter for transient network failures
- **Health check utility** (`src/utils/health.ts`) — check Spotify, Lexicon, and Soulseek connectivity
- **`crate-sync status` command** — show service connectivity and database stats at a glance
- Pre-flight health checks in `sync`, `download playlist`, and `lexicon match/sync` commands
- Retry wrapping on all external API calls (Spotify, Lexicon, Soulseek)

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
