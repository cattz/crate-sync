---
# crate-sync-hezr
title: Implement push to Spotify
status: completed
type: task
priority: normal
created_at: 2026-03-10T04:21:31Z
updated_at: 2026-03-10T05:56:00Z
parent: crate-sync-5kpz
---

## Summary of Changes
Implemented `playlists push [id]` command with `--all` flag. Compares local DB tracks against Spotify API state via new PlaylistService.getPlaylistDiff(). Applies renames, track additions, and removals. Updates snapshot_id after push.
