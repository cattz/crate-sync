---
# crate-sync-bg44
title: "Playlist source column, filter, and file import in web UI"
status: completed
type: task
priority: normal
created_at: 2026-04-08T00:00:00Z
updated_at: 2026-04-08T00:00:00Z
---

## Description

Add a `source` column to playlists so users can distinguish where a playlist came from (Spotify, file import, or manually created). Expose in the Playlists page with a filter, and add an "Import" button to the web UI.

## Changes

1. **DB migration** — add `source` text column to playlists table (nullable, backfill existing: spotify if `spotifyId` is set, otherwise `local`)
2. **Schema + types** — add `source` to schema, Playlist type, API response
3. **Set source on creation** — `importTracks` sets `"file"`, Spotify sync sets `"spotify"`, `createLocalPlaylist` sets `"local"`
4. **Web UI** — add Source filter buttons (All / Spotify / File / Local) to Playlists page, show source as a column
5. **Import modal** — "Import" button on Playlists page with file upload, format selector, and preview
