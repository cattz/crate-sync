---
# crate-sync-q1l8
title: Wire playlist rename command
status: completed
type: task
priority: normal
created_at: 2026-03-10T04:21:31Z
updated_at: 2026-03-10T04:28:05Z
parent: crate-sync-5kpz
---

## Summary of Changes
- Implemented `playlists rename <id> <name>` command with `--push` flag
- Added `renamePlaylist` method to PlaylistService
- Added name-based playlist lookup to `getPlaylist`
- Resolves playlist by id, spotify_id, or name
