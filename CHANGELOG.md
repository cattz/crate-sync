# Changelog

## 0.2.0 — 2026-03-10

### Added
- **`playlists repair <id>`** — re-match playlist tracks against Lexicon library, report status, optionally download missing tracks via `--download`
- **`playlists push [id]`** — push local playlist changes (renames, track additions/removals) back to Spotify API, with `--all` flag for bulk push
- **`PlaylistService.getPlaylistDiff()`** — compare local tracks against Spotify state to detect additions/removals
- **`PlaylistService.updateSnapshotId()`** — update Spotify snapshot_id after push

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
