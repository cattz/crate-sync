---
# crate-sync-r45y
title: Accept full Spotify URLs as playlist ID
status: completed
type: task
created_at: 2026-03-10T06:51:01Z
updated_at: 2026-03-10T06:51:01Z
---

Extract playlist ID from full Spotify URLs so users can paste URLs directly into CLI commands

## Summary of Changes

- Added `extractPlaylistId()` utility in `src/utils/spotify-url.ts` that parses Spotify playlist URLs and extracts the ID, or passes through bare IDs unchanged.
- Integrated into `PlaylistService.getPlaylist()` so all lookup-by-id flows automatically accept full URLs.
- Added tests in `src/utils/__tests__/spotify-url.test.ts` covering full URLs, URLs with query params, bare IDs, empty input, whitespace, and non-playlist URLs.
