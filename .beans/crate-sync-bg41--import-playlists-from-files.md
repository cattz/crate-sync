---
# crate-sync-bg41
title: Import playlists from filesystem files (CSV, M3U, TXT)
status: completed
type: task
priority: normal
created_at: 2026-04-06T00:00:00Z
updated_at: 2026-04-06T00:00:00Z
---

## Description

Allow importing playlists from filesystem files as an alternative to Spotify. Supports common playlist formats:
- **M3U/M3U8**: standard playlist format with file paths or URLs
- **CSV**: columns for artist, title, album (flexible column mapping)
- **TXT**: one track per line, "Artist - Title" format

## Behavior

1. Point to a folder or file
2. Parse the playlist name from filename
3. Parse tracks from file content
4. Create a local playlist with the parsed tracks
5. Optionally search Spotify for matching tracks and link them

## Interfaces

- **CLI**: `playlists import <path>` — imports a single file or all files in a folder
- **Web**: "Import Playlist" button on Playlists page with file upload or path input
- **API**: `POST /api/playlists/import` with file content or path

## Key Files

- `src/services/playlist-service.ts` — create playlist from parsed data
- `src/commands/playlists.ts` — import CLI command
- `src/api/routes/playlists.ts` — import endpoint
